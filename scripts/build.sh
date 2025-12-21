#!/bin/bash
# Build for current platform
wails build

# Or specify platforms:
# macOS: wails build -platform darwin/amd64
# macOS ARM: wails build -platform darwin/arm64
# macOS Universal: wails build -platform darwin/universal
# Windows: wails build -platform windows/amd64
# Linux: wails build -platform linux/amd64
