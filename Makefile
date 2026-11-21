.PHONY: help test test-unit test-native test-integration emulator-up emulator-down build-extension

CARGO_PROFILE ?= dev

ifeq ($(CARGO_PROFILE),release)
    # Production: Full LTO
    OPTIMIZATION_FLAGS := CARGO_PROFILE_RELEASE_LTO=true
else
    # Default (dev): Thin LTO
    OPTIMIZATION_FLAGS := CARGO_PROFILE_DEV_LTO=thin
endif

EMULATOR_IMAGE ?= ghcr.io/xsavikx/aws-emulator:latest
EMULATOR_PORT ?= 9297
EMULATOR_NAME ?= wws-aws-emulator
EMULATOR_DIR := $(HOME)/.aws/emulator/$(EMULATOR_PORT)
# Default target
help:
	@echo "Available targets:"
	@echo "  make test               - Run all tests (unit tests + wasip2 integration)"
	@echo "  make test-native        - Run only unit tests on native target (fastest, ~20ms)"
	@echo "  make test-unit          - Run unit tests on all targets"
	@echo "  make test-integration   - Run integration tests against the AWS emulator (needs Docker and the aws CLI)"
	@echo "  make emulator-up        - Start the AWS emulator container"
	@echo "  make emulator-down      - Stop the AWS emulator container"
	@echo "  make build-wasi-engine  - Build components for wasip2"
	@echo "  make build-components   - Build all WASM components"
	@echo "  make build-extension    - Build the Chrome extension with embedded web shell"

# Build components for wasip2 (default target)
build-components:
	@echo "Building providers-adapter for wasip2..."
	@${OPTIMIZATION_FLAGS} cargo component build -p providers-adapter --target wasm32-wasip2 --profile "$(CARGO_PROFILE)"
	@echo "Building aws-cli for wasip2..."
	@${OPTIMIZATION_FLAGS} cargo component build -p aws-cli --target wasm32-wasip2 --profile "$(CARGO_PROFILE)"

# Run unit tests on native target
test-native:
	@echo "Running unit tests on native target..."
	@cargo test -p aws-cli --lib --profile "$(CARGO_PROFILE)"

# Run unit tests on all targets
test-unit: test-native
	@echo "Running unit tests on wasip2 target..."
	@cargo test -p simple-http-proxy --target wasm32-wasip2 --profile "$(CARGO_PROFILE)"

# Build for wasi-engine to validate compilation
build-wasi-engine: build-components
	@echo "Building wasi-engine..."
	@CARGO_PROFILE="$(CARGO_PROFILE)" cargo build -p wasi-engine

# Start the AWS emulator (https://xsavikx.github.io/aws-emulator-docker/) and wait until it is healthy
emulator-up:
	@docker rm -f $(EMULATOR_NAME) >/dev/null 2>&1 || true
	@mkdir -p "$(HOME)/.aws/emulator"
	@docker run -d --name $(EMULATOR_NAME) --memory=2g --memory-swap=2g \
		-p 127.0.0.1:$(EMULATOR_PORT):$(EMULATOR_PORT) \
		--user "$$(id -u):$$(id -g)" -e HOME="$(HOME)" -e EMULATOR_TELEMETRY=off \
		-e EMULATOR_HEALTHCHECK_PORT=$(EMULATOR_PORT) \
		-v "$(HOME)/.aws/emulator:$(HOME)/.aws/emulator" \
		$(EMULATOR_IMAGE) -p $(EMULATOR_PORT) >/dev/null
	@echo "Waiting for the AWS emulator..."
	@for i in $$(seq 1 60); do \
		[ "$$(docker inspect -f '{{.State.Health.Status}}' $(EMULATOR_NAME))" = "healthy" ] && exit 0; \
		sleep 1; \
	done; \
	docker logs $(EMULATOR_NAME); \
	echo "The AWS emulator did not become healthy"; exit 1
# Stop the AWS emulator
emulator-down:
	@docker rm -f $(EMULATOR_NAME) >/dev/null 2>&1 || true
# Run integration tests against the AWS emulator, then stop it
test-integration: build-wasi-engine emulator-up
	@AWS_ENDPOINT_URL=https://127.0.0.1:$(EMULATOR_PORT) \
	AWS_CA_BUNDLE=$(EMULATOR_DIR)/ca.pem \
	AWS_SHARED_CREDENTIALS_FILE=$(EMULATOR_DIR)/emulator_credentials \
	AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1 \
	cargo test -p aws-cli-integration-tests; \
	status=$$?; $(MAKE) --no-print-directory emulator-down; exit $$status
# Run all tests (native unit + emulator integration)
test: test-unit test-integration

# Clean composed artifacts
clean-composed:
	@rm -rf target/composed
	@echo "Cleaned composed artifacts"

# Generate operation code from aws-cli-operations.csv
generate-ops:
	@echo "Generating operation code..."
	@cargo run --manifest-path tools/generate-ops/Cargo.toml
	@echo "Done. Review generated files and run: cargo check -p aws-cli --lib"

# Build the Web Shell
build-shell:
	@echo "Building extension..."
	@cd www && npm run build

# Build the Chrome extension (extension files)
build-extension: build-shell
	@echo "Building extension..."
	@cd www && npm run build:extension
	@echo "Extension ready at extension/"
