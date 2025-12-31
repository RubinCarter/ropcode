# Ropcode

[English](README.md) | [中文](README_CN.md)

---

A Mac desktop application for running AI coding agents in parallel, built with Electron and an embedded Go backend.

## Why Ropcode?

Ropcode transforms Claude Code from a command-line tool into a powerful visual development environment.

### Key Features

**Parallel Agent Execution**
Run multiple AI coding agents simultaneously across different projects. No more waiting for one task to finish before starting another.

**Visual Workspace Management**
- Multi-tab interface for managing multiple projects
- Real-time terminal integration with full PTY support
- Side-by-side code diff viewer with change navigation
- Integrated file browser and Git status panel

**Real-time Git Integration**
Automatic file watching detects changes instantly. See Git status updates as you work, without manual refresh.

**Multi-Provider AI Support**
Not locked to a single AI. Switch between Claude, Gemini, Codex and other providers based on your needs.

> **Note**: Ropcode is a GUI wrapper. You need to install the underlying AI coding tools separately:
> - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) - `npm install -g @anthropic-ai/claude-code`
> - [Gemini CLI](https://github.com/google-gemini/gemini-cli) - `npm install -g @anthropic-ai/gemini-cli`
> - [Codex](https://github.com/openai/codex) - Follow OpenAI's installation guide

**MCP Protocol Support**
Full Model Context Protocol integration for extending AI capabilities with custom tools and data sources.

**Developer-First Architecture**
- Native desktop performance with Electron + Go backend
- WebSocket-based real-time communication
- SQLite for fast local data storage
- SSH remote project synchronization

## Acknowledgments

This project was inspired by [opcode](https://github.com/winfunc/opcode) (AGPL-3.0), a Tauri-based desktop GUI for Claude Code created by [winfunc](https://github.com/winfunc). The UI/UX concepts and some architectural ideas were influenced by opcode's design. We thank the original authors for their contributions to the open-source community.

### Technical Differences

While sharing similar goals, Ropcode is a complete rewrite with a different technology stack:

| Component | Ropcode | opcode |
|-----------|---------|--------|
| **Desktop Framework** | Electron | Tauri |
| **Backend Language** | Go | Rust |
| **IPC Mechanism** | WebSocket RPC | Tauri Commands |
| **Database** | SQLite (Go) | SQLite (Rust) |

### Additional Features in Ropcode

- Real-time Git file watching and status tracking
- SSH remote project synchronization
- Model Context Protocol (MCP) integration
- Multi-provider AI support (Claude, Gemini, etc.)
- Custom WebSocket-based event system

In respect to the original project, Ropcode is released under the same AGPL-3.0 license.

## Architecture

- **Frontend**: React + TypeScript + Vite
- **Desktop**: Electron
- **Backend**: Go (embedded as a WebSocket service)

## Live Development

To run in development mode:

```bash
make dev
```

Or directly:

```bash
cd electron && npm run dev
```

This will:
1. Start the Go backend server
2. Launch the Vite development server
3. Open the Electron window

## Building

To build a redistributable production package:

```bash
make build
```

Or directly:

```bash
cd electron && npm run build
```

## Project Structure

```
├── electron/          # Electron main process
│   ├── src/          # Main process TypeScript code
│   └── package.json
├── frontend/         # React frontend
│   ├── src/
│   │   ├── components/
│   │   ├── lib/
│   │   └── ...
│   └── package.json
├── internal/         # Go backend packages
├── app.go           # Go app initialization
├── bindings.go      # Go API bindings (WebSocket RPC)
└── go.mod           # Go module definition
```

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0) - see the [LICENSE](LICENSE) file for details.

```
Copyright (C) 2024-2025 Rubin

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
```
