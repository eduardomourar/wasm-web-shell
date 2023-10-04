.PHONY: help test test-unit test-native test-integration

# Default target
help:
	@echo "Available targets:"
	@echo "  make test               - Run all tests (unit tests + wasip2 integration)"
	@echo "  make test-native        - Run only unit tests on native target (fastest, ~20ms)"
	@echo "  make test-unit          - Run unit tests on all targets"
	@echo "  make test-integration   - Run integration tests with composed WASM"
	@echo "  make build-wasi-engine  - Build components for wasip2"
	@echo "  make build-components   - Build all WASM components"

# Build components for wasip2 (default target)
build-components:
	@echo "Building credentials-adapter for wasip2..."
	@cargo component build -p credentials-adapter --target wasm32-wasip2
	@echo "Building aws-cli for wasip2..."
	@cargo component build -p aws-cli --target wasm32-wasip2

# Run unit tests on native target
test-native:
	@echo "Running unit tests on native target..."
	@cargo test -p aws-cli --lib

# Run unit tests on all targets
test-unit: test-native
	@echo "Running unit tests on wasip2 target..."
	@cargo test -p simple-http-proxy --target wasm32-wasip2

# Build for wasi-engine to validate compilation
build-wasi-engine: build-components
	@echo "Building wasi-engine..."
	@cargo build -p wasi-engine

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
