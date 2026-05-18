# Screenshots

把截图按下列文件名放在本目录下，主 README 会自动引用。

建议尺寸：宽屏 1600×900 或 1920×1080，PNG，深色主题，单张控制在 ~300 KB（用 https://tinypng.com 压一下）。

## 当前已使用

| 文件名 | 内容 | 在 README 的位置 |
| --- | --- | --- |
| `hero.png` | 首屏主图：左侧项目栏 + 中间 Claude 流式响应 + 右侧 diff viewer 三栏同框 | 顶部 Hero |

## 后续可选补充

下面这些目前 **没有** 在 README 里引用——加进来时记得在主 README 对应章节插一行 `<p align="center"><img src="docs/screenshots/<name>.png" ... /></p>`。

| 文件名 | 内容建议 | 适合放进哪一节 |
| --- | --- | --- |
| `provider-selector.png` | ProviderApiSelector / ModelManager，展示在 Claude / Gemini / Codex 之间切换 | 多 provider AI |
| `parallel-sessions.png` | 上方 tab bar 同时挂 3+ 个项目，每个 tab 是不同 provider 的会话 | 并行代理会话 |
| `subagent-panel.png` | 右栏 SubagentLogView 展开，分组显示子代理 + 实时 transcript | 实时子代理进度 |
| `diff-viewer.png` | 右栏 DiffViewer 显示一个真实文件的 +/- 改动 | 并排 diff 查看器 |
| `terminal.png` | 右栏 TerminalPane 跑着 `npm run dev` 之类的真实命令 | 集成终端 |
| `git-status.png` | 右栏 GitStatusPane 显示一堆 modified / staged / untracked 文件 | 实时 Git 状态 |
| `capability-picker.png` | 输入框里输入 `/` 后弹出的 slash command picker | 斜杠命令与能力选择器 |
| `mcp-manager.png` | MCPManager 页面，挂载了几个 server | MCP 服务器管理 |
| `instance-switcher.png` | 标题栏的 InstanceSwitcher 下拉展开，显示多个实例 | 多实例切换 |
| `usage-dashboard.png` | UsageDashboard：token 消耗 / 模型分布 / 趋势 | 用量分析 |
| `mobile.png` | 在浏览器把窗口缩到手机宽（或真在手机上访问），底部 tab bar | 移动端友好 |
| `cli.png` | 终端里跑 `ropcode workspace send` / `ropcode runtime tui`，能看到输出 | CLI |
| `workspace-multi-cli.png` | **强烈推荐**：同一个工作区里同时挂 Claude + Gemini + Codex 三个会话，三个会话引用同一份文件 | 工作区：一个项目，多个代理 |

如果有 GIF 演示，建议放成 `hero.gif` 并把 README 顶部 `<img src="docs/screenshots/hero.png">` 换成 `hero.gif`，控制在 5 MB 以内。
