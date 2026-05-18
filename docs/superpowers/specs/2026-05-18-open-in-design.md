# Open In: Windows 平台支持与编辑器扩展

**Date**: 2026-05-18
**Status**: Approved (design)
**Scope**: 给 ropcode "Open in" 菜单加 Windows 支持（Explorer + 4 个终端），并把 VSCode/Cursor/Windsurf 接入跨平台菜单。

## 背景

`bindings.go` 当前 5866 行，其中三个 RPC 全部 macOS 硬编码：

- `OpenInExternalApp` (4703) — 多 app 分发器，使用 `open` / `osascript` / `/Applications` 探测
- `OpenInTerminal` (3270) — 仅打开 macOS Terminal.app（前端无调用方但 RPC 暴露）
- `OpenInEditor` (3277) — 仅启动 VS Code（前端无调用方但 RPC 暴露）

前端菜单 `frontend/src/components/CustomTitlebar.tsx:567` 静态硬编码 7 个条目，且 VSCode/Cursor 后端有实现但菜单未挂出来；Windsurf 完全缺位。Windows 用户无法使用任何 "Open in" 功能。

## 目标

- Windows 上提供：Explorer + VS Code + Cursor + Windsurf + cmd + PowerShell + Git Bash + Windows Terminal
- macOS 行为零回归：现有所有条目原样保留 + 新增 VSCode/Cursor/Windsurf 已存在的实现挂出菜单
- 把"Open in" 相关代码从 `bindings.go` 拆出去到独立子包，遵循 CLAUDE.md 的 platform-split 规范
- JetBrains 系列 Windows 端**不实现**（用户暂无需求），调用时返回 `ErrUnsupported`

## 非目标

- 不做 Linux 支持（等真有需求再把默认文件改名 `_darwin` 并新增 `_linux`）
- 不删除/修改前端无人调用的 `OpenInTerminal` / `OpenInEditor` RPC（搬迁顺手修跨平台，但不删 RPC 表面）
- 不引入新的 toast/通知组件，错误处理沿用现有 `try/catch + console.error`
- 不改 `OpenFileDialog` (820)、不动其他 `bindings.go` 内容

## 架构

### 目录结构

```
internal/openin/
  openin.go          // 公共接口：AppType 常量、ErrUnsupported / ErrNotInstalled、Open / List / Available
  openin_unix.go     // //go:build !windows  → macOS 实现（原 bindings.go 逻辑平移）
  openin_win.go      // //go:build windows   → Windows 实现
  openin_test.go     // 平台无关：List 内容、Open 不支持类型；命令构造单测（buildCmd 抽出来）
```

文件命名理由：用户拆分原则——mac/linux 接口/机制相同就用默认名（无后缀），不同再拆。当前 mac 实现 Linux 跑不动，但还没真正引入 Linux 分支，**保持默认名 `openin_unix.go`**（覆盖非 Windows 全部）；以后做 Linux 时再改名 `openin_darwin.go` + 新增 `openin_linux.go`。

### 公共接口

```go
// internal/openin/openin.go
package openin

type AppType string

const (
    AppFileManager AppType = "filemanager" // mac→Finder, win→Explorer

    AppVSCode    AppType = "vscode"
    AppCursor    AppType = "cursor"
    AppWindsurf  AppType = "windsurf"

    // mac-only
    AppPyCharm       AppType = "pycharm"
    AppIDEA          AppType = "idea"
    AppCLion         AppType = "clion"
    AppAndroidStudio AppType = "android-studio"
    AppWebStorm      AppType = "webstorm"
    AppGoLand        AppType = "goland"
    AppSublime       AppType = "sublime"
    AppITerm         AppType = "iterm"
    AppMacTerminal   AppType = "terminal"

    // win-only 终端
    AppCmd        AppType = "cmd"
    AppPowerShell AppType = "powershell"
    AppGitBash    AppType = "gitbash"
    AppWinTerm    AppType = "wt"
)

type ErrUnsupported struct{ App AppType; OS string }
type ErrNotInstalled struct{ App AppType; Executable string }

func Open(app AppType, path string) error  // 平台分派；老别名 "finder" 兼容
func List() []AppType                       // 当前平台支持的 AppType（决定菜单顺序）
func Available(app AppType) bool            // 检查 PATH 是否能找到对应可执行
func DefaultTerminal() AppType              // mac→AppMacTerminal, win→AppCmd
```

### bindings.go 集成

```go
// bindings.go（瘦身后）
func (a *App) OpenInExternalApp(appType, path string) error {
    return openin.Open(openin.AppType(appType), path)
}
func (a *App) OpenInTerminal(path string) error {
    return openin.Open(openin.DefaultTerminal(), path)
}
func (a *App) OpenInEditor(path string) error {
    return openin.Open(openin.AppVSCode, path)
}
func (a *App) ListOpenInApps() []string {
    items := openin.List()
    out := make([]string, len(items))
    for i, it := range items { out[i] = string(it) }
    return out
}
```

`DefaultTerminal()` 由 `internal/openin/openin_unix.go` / `openin_win.go` 各自定义为常量级表达式（mac→`AppMacTerminal`, win→`AppCmd`）。

### Windows 启动命令

| AppType | 命令 |
|---|---|
| `filemanager` | `explorer.exe <path>` |
| `vscode` | `<lookpath:code.cmd> <path>` |
| `cursor` | `<lookpath:cursor.cmd> <path>` |
| `windsurf` | `<lookpath:windsurf.cmd> <path>` |
| `cmd` | `cmd.exe /c start "" /D <path> cmd.exe` |
| `powershell` | LookPath 顺序 `pwsh.exe`→`powershell.exe`，再 `cmd.exe /c start "" /D <path> <ps>` |
| `gitbash` | `<lookpath:git-bash.exe> --cd=<path>`（**不**用 `bash.exe`，会撞 WSL） |
| `wt` | `<lookpath:wt.exe> -d <path>` |

策略：所有 LookPath 失败 → `ErrNotInstalled{App, Executable}`；不做安装路径回退（用户决定）。

### macOS 实现

把 `bindings.go:4703-4798` 的整个 switch 原样平移到 `openin_unix.go`，函数签名改成 `Open(app AppType, path string) error`。新增 Windsurf 分支：

```go
case AppWindsurf:
    cmd := exec.Command("open", "-b", "com.exafunction.windsurf", path)
    return cmd.Start()
```

（bundle ID 是社区已知值；若启动失败用 `open -a Windsurf <path>` 兜底——加一层 retry 逻辑。）

### 前端

`CustomTitlebar.tsx`：

1. 组件挂载时调 `api.listOpenInApps()`，缓存为 state
2. 静态 `LABELS` map（key→display string）
3. `filemanager` 的 label 按 `navigator.userAgent` 判平台（mac→Finder, win→Explorer），其余直接查 map
4. Workspace 名按钮的 onClick 与 title 都改成 `filemanager`
5. 渲染时按 `List()` 顺序生成 `DropdownMenuItem`

```ts
const LABELS: Record<string, string | { mac: string; win: string }> = {
  filemanager: { mac: "Finder", win: "Explorer" },
  vscode: "VS Code",
  cursor: "Cursor",
  windsurf: "Windsurf",
  pycharm: "PyCharm",
  idea: "IntelliJ IDEA",
  "android-studio": "Android Studio",
  clion: "CLion",
  webstorm: "WebStorm",
  goland: "GoLand",
  sublime: "Sublime Text",
  iterm: "iTerm",
  terminal: "Terminal",
  cmd: "Command Prompt",
  powershell: "PowerShell",
  gitbash: "Git Bash",
  wt: "Windows Terminal",
};
```

## 数据流

```
DropdownMenu mount
  ↓ api.listOpenInApps()
  ↓ WS RPC ListOpenInApps
  ↓ App.ListOpenInApps → openin.List() → 平台对应数组
  ↓ 缓存到 state
  ↓ 渲染 menu items（按 LABELS）
User click
  ↓ api.openInExternalApp(appType, path)
  ↓ WS RPC OpenInExternalApp
  ↓ App.OpenInExternalApp → openin.Open(...)
  ↓ 平台 switch → exec.Command(...).Start()
错误向前端传，UI toast 失败
```

## 错误处理

- `ErrUnsupported` (`mac 上调用 cmd` 这种)：理论上不会发生（菜单已经按平台过滤）；走到这里说明前端越权或老前端，给可读错误
- `ErrNotInstalled` (LookPath 失败)：前端显示 `"<Label> 不在 PATH 中"`
- `cmd.Start()` 失败：原始错误透传到前端
- 不改既有的 toast 行为（沿用 `console.error`）

## 安全性

- 所有 path 来自后端持有的项目目录，不是用户文本输入
- 全部走 `exec.Command(name, args...)` 数组形式，无 shell 注入风险
- 唯一例外 `cmd.exe /c start "" /D <path> <prog>` 中 path 仍作为独立 arg 传，由 Go runtime 自动加引号

## 测试

`internal/openin/openin_test.go`：

- `TestList_macOS` / `TestList_windows`：用 `runtime.GOOS` 判平台跑哪一组，断言列表内容
- `TestOpen_Unsupported`：mac 上 `Open(AppCmd, p)` 期望 `ErrUnsupported`；win 上 `Open(AppPyCharm, p)` 期望 `ErrUnsupported`
- `TestBuildCmd_Windows` / `TestBuildCmd_macOS`：把命令构造抽成 `buildCmd(app, path) (*exec.Cmd, error)`，断言 `cmd.Path` / `cmd.Args` 内容（不真启动子进程）

不做 e2e。手测脚本：在 Windows 上用 `npm run dev`，逐项点击菜单确认。

## 改动量

| 区域 | 行数 |
|---|---|
| 新增 `internal/openin/openin.go` | ~50 |
| 新增 `internal/openin/openin_unix.go`（平移 bindings.go macOS 逻辑） | ~120 |
| 新增 `internal/openin/openin_win.go` | ~120 |
| 新增 `internal/openin/openin_test.go` | ~80 |
| `bindings.go` 删除 `OpenInExternalApp`/`OpenInTerminal`/`OpenInEditor` 内部 | -130 |
| `bindings.go` 新增 4 个 wrapper（含 `ListOpenInApps`） | +30 |
| `frontend/src/components/CustomTitlebar.tsx` 调整菜单为动态 | ~60 |
| `frontend/src/lib/rpc-client.ts` 新增 `ListOpenInApps` | ~5 |
| `frontend/src/lib/api.ts` 注册 `listOpenInApps` | ~2 |

净 `bindings.go` 减约 100 行；整体新增约 250 行（含测试）。

## 验收标准

- Windows: 菜单显示 8 项（Explorer / VS Code / Cursor / Windsurf / cmd / PowerShell / Git Bash / Windows Terminal）；逐项可启动；缺失 CLI 时报可读错误
- macOS: 菜单条目=旧条目+VSCode/Cursor/Windsurf 共 13 项；旧条目行为零回归
- `go test ./internal/openin/...` 在两平台均通过
- `bindings.go` 行数下降；新代码遵循 platform-split 规范
