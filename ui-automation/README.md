# Ropcode UI Automation

This directory contains browser-layer UI automation for Ropcode. It starts the latest local Go server and Vite frontend, then drives the UI through Microsoft Edge with Playwright. It does not start Electron and does not use desktop mouse or keyboard control.

## Run

```powershell
cd E:\bit_master\ropcode
npm --prefix ui-automation install
npm --prefix ui-automation run test
```

The runner:

1. Builds `bin\ropcode-server.exe` and `bin\win32\x64\ropcode.exe` from current source.
2. Starts Vite with HMR disabled.
3. Starts `ropcode-server.exe` with `ROPCODE_VITE_URL` pointing to that Vite process.
4. Opens the served app in headless Microsoft Edge.
5. Verifies injected WebSocket config, an authenticated RPC call, and navigation through Projects, Settings, and Agents.

Artifacts are written to `ui-automation\artifacts\`.

## Headed Debug

Use this only when you want to watch the browser:

```powershell
npm --prefix ui-automation run test:headed
```

## Playwright CLI Spot Checks

For manual browser inspection with the `playwright-cli` skill:

```powershell
playwright-cli open --browser=msedge http://127.0.0.1:<WS_PORT>/
playwright-cli snapshot
playwright-cli click <ref>
playwright-cli close
```

Prefer the automated `npm --prefix ui-automation run test` path for final validation because it owns startup, ports, auth, assertions, and cleanup.

## Scope

This is not a full desktop automation replacement. It validates the browser/WebContents layer and the real Go RPC server without interfering with the user's desktop. Use `agent-cu` separately for Electron window, accessibility-tree, or native desktop behavior.
