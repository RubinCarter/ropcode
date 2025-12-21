# Ropcode Makefile
# Build commands for the Wails application

.PHONY: dev build build-dmg clean help

# Default target
help:
	@echo "Ropcode Build Commands:"
	@echo ""
	@echo "  make dev        - Run in development mode"
	@echo "  make build      - Build the application"
	@echo "  make build-dmg  - Build and create DMG installer"
	@echo "  make clean      - Clean build artifacts"
	@echo ""

# Development mode
dev:
	wails dev

# Build the application
build:
	wails build -clean

# Build and create DMG
build-dmg:
	./scripts/build-dmg.sh

# Build DMG without rebuilding app (use existing build)
build-dmg-only:
	./scripts/build-dmg.sh --no-build

# Clean build artifacts
clean:
	rm -rf build/bin
	rm -rf frontend/dist
