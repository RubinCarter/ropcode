# Ropcode

A Mac desktop application for running AI coding agents in parallel, built with Electron and an embedded Go backend.

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
