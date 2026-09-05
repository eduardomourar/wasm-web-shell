.PHONY: help test test-unit test-native test-integration build-extension

CARGO_PROFILE ?= dev

ifeq ($(CARGO_PROFILE),release)
    # Production: Full LTO
    OPTIMIZATION_FLAGS := CARGO_PROFILE_RELEASE_LTO=true
else
    # Default (dev): Thin LTO
    OPTIMIZATION_FLAGS := CARGO_PROFILE_DEV_LTO=thin
endif

# Default target
help:
	@echo "Available targets:"
	@echo "  make test               - Run all tests (unit tests + wasip2 integration)"
	@echo "  make test-native        - Run only unit tests on native target (fastest, ~20ms)"
	@echo "  make test-unit          - Run unit tests on all targets"
	@echo "  make test-integration   - Run integration tests with composed WASM"
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

# Run integration tests with composed WASM component
test-integration: build-wasi-engine
	@echo "Running integration tests with composed wasip2 component..."
	@cargo test -p aws-cli --test integration_test -- --test-threads=2

# Run all tests (native unit + wasip2 integration)
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

# Build the Chrome extension (web shell + extension files)
build-extension:
	@echo "Building extension..."
	@cd www && npm run build:extension
	@echo "Extension ready at extension/"
