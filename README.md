# Ropcode

[English](#english) | [中文](#中文)

---

<a name="english"></a>

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

---

<a name="中文"></a>

## 中文

一个用于并行运行 AI 编程代理的 Mac 桌面应用，基于 Electron 和内嵌的 Go 后端构建。

## 为什么选择 Ropcode？

Ropcode 将 Claude Code 从命令行工具转变为强大的可视化开发环境。

### 核心功能

**并行代理执行**
同时在不同项目中运行多个 AI 编程代理，无需等待一个任务完成后再开始另一个。

**可视化工作区管理**
- 多标签页界面，轻松管理多个项目
- 实时终端集成，完整 PTY 支持
- 并排代码差异查看器，支持变更导航
- 集成文件浏览器和 Git 状态面板

**实时 Git 集成**
自动文件监听，即时检测变更。无需手动刷新即可查看 Git 状态更新。

**多 AI 提供商支持**
不锁定单一 AI。根据需求在 Claude、Gemini、Codex 等提供商之间自由切换。

> **注意**：Ropcode 是一个 GUI 封装器，您需要单独安装底层 AI 编程工具：
> - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) - `npm install -g @anthropic-ai/claude-code`
> - [Gemini CLI](https://github.com/google-gemini/gemini-cli) - `npm install -g @anthropic-ai/gemini-cli`
> - [Codex](https://github.com/openai/codex) - 请参照 OpenAI 的安装指南

**MCP 协议支持**
完整的 Model Context Protocol 集成，可通过自定义工具和数据源扩展 AI 能力。

**开发者优先架构**
- Electron + Go 后端，原生桌面性能
- 基于 WebSocket 的实时通信
- SQLite 快速本地数据存储
- SSH 远程项目同步

## 致谢

本项目受 [opcode](https://github.com/winfunc/opcode)（AGPL-3.0）启发，opcode 是由 [winfunc](https://github.com/winfunc) 创建的基于 Tauri 的 Claude Code 桌面 GUI。UI/UX 概念和部分架构设计受到 opcode 设计的影响。我们感谢原作者对开源社区的贡献。

### 技术差异

虽然目标相似，但 Ropcode 是使用不同技术栈的完全重写版本：

| 组件 | Ropcode | opcode |
|------|---------|--------|
| **桌面框架** | Electron | Tauri |
| **后端语言** | Go | Rust |
| **进程通信** | WebSocket RPC | Tauri Commands |
| **数据库** | SQLite (Go) | SQLite (Rust) |

### Ropcode 的附加功能

- 实时 Git 文件监听和状态跟踪
- SSH 远程项目同步
- Model Context Protocol (MCP) 集成
- 多 AI 提供商支持（Claude、Gemini 等）
- 自定义 WebSocket 事件系统

出于对原项目的尊重，Ropcode 采用相同的 AGPL-3.0 许可证发布。

## 架构

- **前端**：React + TypeScript + Vite
- **桌面**：Electron
- **后端**：Go（作为 WebSocket 服务嵌入）

## 开发模式

运行开发模式：

```bash
make dev
```

或直接：

```bash
cd electron && npm run dev
```

这将：
1. 启动 Go 后端服务器
2. 启动 Vite 开发服务器
3. 打开 Electron 窗口

## 构建

构建可分发的生产包：

```bash
make build
```

或直接：

```bash
cd electron && npm run build
```

## 许可证

本项目采用 GNU Affero 通用公共许可证 v3.0 (AGPL-3.0) 授权 - 详见 [LICENSE](LICENSE) 文件。

```
版权所有 (C) 2024-2025 Rubin

本程序是自由软件：您可以根据自由软件基金会发布的 GNU Affero 通用公共许可证
的条款重新分发和/或修改它，可以是许可证的第 3 版，或（由您选择）任何更高版本。
```
