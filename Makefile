# Ropcode Makefile
# Build commands for the Electron application

.PHONY: dev build clean help

# Default target
help:
	@echo "Ropcode Build Commands:"
	@echo ""
	@echo "  make dev       - Run in development mode"
	@echo "  make build     - Build the application"
	@echo "  make clean     - Clean build artifacts"
	@echo ""

# Development mode
dev:
	cd electron && npm run dev

# Build the application
build:
	cd electron && npm run build

# Clean build artifacts
clean:
	rm -rf electron/out
	rm -rf electron/dist
	rm -rf frontend/dist
