# Waveterm Widget 渐进式移植设计文档

## 概述

本文档描述如何将 waveterm 的四个核心 widget（Terminal、Web、Files、Preview）渐进式移植到 ropcode 项目中，同时保持现有架构的稳定性。

## 技术栈对比

| 维度 | ropcode 现有 | waveterm | 移植策略 |
|------|-------------|----------|----------|
| 桌面框架 | Wails (Go + WebView) | Electron | 保持 Wails |
| 前端框架 | React 18 | React 19 | 保持 React 18 |
| 状态管理 | Zustand + Context | Jotai (原子状态) | 保持 Zustand |
| Terminal | xterm.js 5.5.0 | xterm.js + WebGL | 添加 addons |
| Webview | iframe | Electron webview | 保持 iframe + 增强 |
| 文件操作 | Wails bindings | wsh RPC | 扩展 bindings |
| 事件通信 | Wails Events | WebSocket RPC | 扩展 EventHub |

## 架构设计原则

### 1. 保持现有抽象层
- 继续使用 `App.go` 作为 Go 层入口
- 继续使用 Wails bindings 进行前后端通信
- 继续使用 `EventHub` 进行事件分发

### 2. 引入 Widget 抽象层
借鉴 waveterm 的 ViewModel 模式，但适配到 Zustand：

```typescript
// 新增: Widget 基础接口
interface WidgetModel {
  widgetType: string;
  widgetId: string;

  // 生命周期
  initialize(): Promise<void>;
  dispose(): void;

  // 焦点管理
  giveFocus(): boolean;

  // 键盘处理
  keyDownHandler?(event: KeyboardEvent): boolean;
}
```

### 3. 渐进式模块化
每个 widget 作为独立模块开发，可以在不同 workspace 并行进行。

---

## 移植阶段规划

### Phase 0: 基础设施准备 [workspace: infra-prep]

**目标**: 建立移植所需的基础设施

**任务**:
1. 创建 `frontend/src/widgets/` 目录结构
2. 定义 `WidgetModel` 接口
3. 扩展 Go 后端的文件操作 API
4. 添加 xterm.js 增强依赖

**文件结构**:
```
frontend/src/widgets/
├── types.ts              # Widget 类型定义
├── base/
│   ├── WidgetModel.ts    # 基础 Widget 模型
│   └── WidgetContext.tsx # Widget Context Provider
├── terminal/             # Phase 1
├── files/                # Phase 2
├── preview/              # Phase 3
└── web/                  # Phase 4
```

**Go 后端扩展**:
```go
// internal/fileops/fileops.go (新增)
type FileOps struct {
    // 文件操作服务
}

func (f *FileOps) ReadFile(path string) (*FileData, error)
func (f *FileOps) WriteFile(path string, content []byte) error
func (f *FileOps) ListDirectory(path string, showHidden bool) ([]FileInfo, error)
func (f *FileOps) GetFileInfo(path string) (*FileInfo, error)
func (f *FileOps) CreateFile(path string) error
func (f *FileOps) CreateDirectory(path string) error
func (f *FileOps) DeleteFile(path string) error
func (f *FileOps) RenameFile(oldPath, newPath string) error
func (f *FileOps) CopyFile(src, dst string) error
func (f *FileOps) MoveFile(src, dst string) error
```

---

### Phase 1: Terminal Widget 增强 [workspace: terminal-enhance]

**目标**: 增强现有 Terminal，借鉴 waveterm 特性

**当前状态**: `XtermTerminal.tsx` 基础功能完整

**移植内容**:

#### 1.1 添加 xterm addons
```typescript
// 新增依赖
"@xterm/addon-webgl": "^0.18.0"    // GPU 加速
"@xterm/addon-search": "^0.15.0"   // 搜索功能
"@xterm/addon-serialize": "^0.13.0" // 状态持久化
```

#### 1.2 创建 TerminalModel
```typescript
// widgets/terminal/TerminalModel.ts
interface TerminalModel extends WidgetModel {
  widgetType: 'terminal';

  // xterm 引用
  termRef: React.RefObject<Terminal>;

  // 状态
  fontSize: number;
  themeName: string;

  // 方法
  write(data: string): void;
  resize(rows: number, cols: number): void;
  search(query: string): void;
  serialize(): string;
  restore(state: string): void;
}
```

#### 1.3 特性迁移清单
| waveterm 特性 | 优先级 | 说明 |
|--------------|--------|------|
| WebGL 加速 | P0 | 性能关键 |
| 搜索功能 | P1 | 用户体验 |
| 主题系统 | P1 | 可配置性 |
| 字体大小控制 | P1 | 可配置性 |
| 序列化/恢复 | P2 | 会话持久化 |
| Shell Integration | P3 | 高级功能 |

---

### Phase 2: Files Widget [workspace: files-widget]

**目标**: 实现完整的文件浏览器

**当前状态**: `FilePicker.tsx` 仅支持简单选择

**移植内容**:

#### 2.1 Go 后端文件服务
```go
// bindings.go 新增方法
func (a *App) FileList(path string, showHidden bool) ([]FileInfo, error)
func (a *App) FileInfo(path string) (*FileInfo, error)
func (a *App) FileRead(path string) (*FileData, error)
func (a *App) FileWrite(path string, content []byte) error
func (a *App) FileCreate(path string) error
func (a *App) FileDelete(path string) error
func (a *App) FileRename(oldPath, newPath string) error
func (a *App) FileCopy(src, dst string) error
func (a *App) FileMove(src, dst string) error
func (a *App) DirCreate(path string) error
```

#### 2.2 前端 FilesWidget
```typescript
// widgets/files/FilesModel.ts
interface FilesModel extends WidgetModel {
  widgetType: 'files';

  // 状态
  currentPath: string;
  entries: FileInfo[];
  selectedIndex: number;
  showHidden: boolean;

  // 方法
  navigate(path: string): Promise<void>;
  refresh(): Promise<void>;
  createFile(name: string): Promise<void>;
  createDirectory(name: string): Promise<void>;
  deleteSelected(): Promise<void>;
  renameSelected(newName: string): Promise<void>;
}
```

#### 2.3 依赖添加
```typescript
"@tanstack/react-table": "^8.21.0"  // 表格组件
```

#### 2.4 特性迁移清单
| waveterm 特性 | 优先级 | 说明 |
|--------------|--------|------|
| 目录浏览 | P0 | 核心功能 |
| 文件操作 (CRUD) | P0 | 核心功能 |
| 拖拽排序 | P1 | 用户体验 |
| 右键菜单 | P1 | 用户体验 |
| 书签系统 | P2 | 便捷导航 |
| 键盘导航 | P1 | 效率 |
| MIME 类型图标 | P2 | 视觉体验 |

---

### Phase 3: Preview Widget [workspace: preview-widget]

**目标**: 实现统一的文件预览系统

**当前状态**:
- `FileViewer.tsx` 仅支持代码高亮
- `WebViewer.tsx` 支持 HTML 预览

**移植内容**:

#### 3.1 Preview 类型系统
```typescript
// widgets/preview/types.ts
type PreviewType =
  | 'code'      // 代码文件 (Monaco)
  | 'markdown'  // Markdown 渲染
  | 'image'     // 图片预览
  | 'video'     // 视频播放
  | 'audio'     // 音频播放
  | 'pdf'       // PDF 查看
  | 'csv'       // CSV 表格
  | 'unknown';  // 未知类型

interface PreviewModel extends WidgetModel {
  widgetType: 'preview';

  // 状态
  filePath: string;
  mimeType: string;
  previewType: PreviewType;
  content: string | null;
  editMode: boolean;

  // 方法
  loadFile(path: string): Promise<void>;
  save(): Promise<void>;
  toggleEditMode(): void;
}
```

#### 3.2 MIME 类型检测
```typescript
// widgets/preview/mime-utils.ts
function detectPreviewType(mimeType: string, fileName: string): PreviewType {
  if (mimeType.startsWith('text/markdown')) return 'markdown';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'text/csv') return 'csv';
  if (isTextFile(mimeType)) return 'code';
  return 'unknown';
}
```

#### 3.3 特性迁移清单
| waveterm 特性 | 优先级 | 说明 |
|--------------|--------|------|
| 代码预览/编辑 | P0 | 核心功能 |
| Markdown 渲染 | P0 | 常用 |
| 图片预览 | P0 | 常用 |
| PDF 查看 | P1 | 常用 |
| 视频/音频 | P2 | 媒体支持 |
| CSV 表格 | P2 | 数据查看 |
| 编辑模式切换 | P1 | 实用功能 |

---

### Phase 4: Web Widget 增强 [workspace: web-enhance]

**目标**: 增强现有 WebViewer

**当前状态**: `WebViewer.tsx` 基于 iframe

**移植内容**:

#### 4.1 WebModel
```typescript
// widgets/web/WebModel.ts
interface WebModel extends WidgetModel {
  widgetType: 'web';

  // 状态
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;

  // 方法
  loadUrl(url: string): void;
  goBack(): void;
  goForward(): void;
  refresh(): void;
}
```

#### 4.2 限制说明
由于 Wails 使用系统 WebView 而非 Electron，以下 waveterm 特性**无法直接移植**：
- User Agent 模拟 (需要系统级 API)
- 媒体控制 (静音/播放)
- 完整的 DevTools

#### 4.3 可移植特性
| waveterm 特性 | 可行性 | 说明 |
|--------------|--------|------|
| URL 导航 | ✓ | iframe 支持 |
| 历史导航 | ✓ | 使用 postMessage |
| 书签系统 | ✓ | 前端实现 |
| 本地文件预览 | ✓ | 通过 Go 中转 |
| 搜索功能 | 部分 | iframe 限制 |

---

## 并行开发工作流

### Workspace 管理策略

```
main (稳定分支)
├── infra-prep          # Phase 0: 基础设施
├── terminal-enhance    # Phase 1: Terminal 增强
├── files-widget        # Phase 2: Files Widget
├── preview-widget      # Phase 3: Preview Widget
└── web-enhance         # Phase 4: Web 增强
```

### 依赖关系

```
Phase 0 (infra-prep)
    │
    ├──> Phase 1 (terminal-enhance)  [独立]
    │
    ├──> Phase 2 (files-widget)      [独立]
    │         │
    │         └──> Phase 3 (preview-widget) [依赖 Phase 2 的 FileInfo]
    │
    └──> Phase 4 (web-enhance)       [独立]
```

### 每个 Workspace 的交付标准

1. **单元测试**: 核心逻辑覆盖
2. **集成测试**: 与现有组件兼容
3. **文档**: 使用说明和 API 文档
4. **迁移指南**: 如何替换现有组件

---

## Go 后端 API 设计

### 文件操作服务 (Phase 0 准备)

```go
// internal/fileops/types.go
type FileInfo struct {
    Name     string    `json:"name"`
    Path     string    `json:"path"`
    Dir      string    `json:"dir"`
    Size     int64     `json:"size"`
    ModeStr  string    `json:"modestr"`
    ModTime  time.Time `json:"modtime"`
    IsDir    bool      `json:"isdir"`
    MimeType string    `json:"mimetype"`
    Readonly bool      `json:"readonly"`
}

type FileData struct {
    Path     string `json:"path"`
    Content  []byte `json:"content"`
    MimeType string `json:"mimetype"`
}

type FileListOptions struct {
    ShowHidden bool `json:"showHidden"`
}
```

### Wails Bindings 扩展

```go
// bindings.go 新增
// 文件操作
func (a *App) FileList(path string, opts FileListOptions) ([]FileInfo, error)
func (a *App) FileInfo(path string) (*FileInfo, error)
func (a *App) FileRead(path string, maxSize int64) (*FileData, error)
func (a *App) FileWrite(path string, content []byte) error
func (a *App) FileCreate(path string, content []byte) error
func (a *App) FileDelete(path string, recursive bool) error
func (a *App) FileRename(oldPath, newPath string) error
func (a *App) FileCopy(src, dst string) error
func (a *App) FileMove(src, dst string) error
func (a *App) DirCreate(path string) error
func (a *App) GetMimeType(path string) (string, error)

// 路径工具
func (a *App) GetHomePath() string
func (a *App) GetDesktopPath() string
func (a *App) GetDownloadsPath() string
func (a *App) GetDocumentsPath() string
func (a *App) JoinPath(parts ...string) string
func (a *App) ResolvePath(path string) string
```

---

## 前端组件结构

### 目录结构 (最终状态)

```
frontend/src/
├── components/
│   └── ... (现有组件保持不变)
│
├── widgets/
│   ├── types.ts                    # 公共类型定义
│   │
│   ├── base/
│   │   ├── WidgetModel.ts          # Widget 基础模型
│   │   ├── WidgetContext.tsx       # Widget Context
│   │   └── useWidget.ts            # Widget hooks
│   │
│   ├── terminal/
│   │   ├── index.ts                # 导出
│   │   ├── TerminalWidget.tsx      # 主组件
│   │   ├── TerminalModel.ts        # Model
│   │   ├── TerminalToolbar.tsx     # 工具栏
│   │   ├── useTerminal.ts          # Hooks
│   │   ├── themes/                 # 主题定义
│   │   └── terminal.scss           # 样式
│   │
│   ├── files/
│   │   ├── index.ts
│   │   ├── FilesWidget.tsx         # 主组件
│   │   ├── FilesModel.ts           # Model
│   │   ├── FilesTable.tsx          # 表格组件
│   │   ├── FileContextMenu.tsx     # 右键菜单
│   │   ├── Bookmarks.tsx           # 书签
│   │   ├── useFiles.ts             # Hooks
│   │   └── files.scss
│   │
│   ├── preview/
│   │   ├── index.ts
│   │   ├── PreviewWidget.tsx       # 主组件
│   │   ├── PreviewModel.ts         # Model
│   │   ├── previews/
│   │   │   ├── CodePreview.tsx     # 代码
│   │   │   ├── MarkdownPreview.tsx # Markdown
│   │   │   ├── ImagePreview.tsx    # 图片
│   │   │   ├── MediaPreview.tsx    # 视频/音频
│   │   │   ├── PdfPreview.tsx      # PDF
│   │   │   └── CsvPreview.tsx      # CSV
│   │   ├── usePreview.ts
│   │   └── preview.scss
│   │
│   └── web/
│       ├── index.ts
│       ├── WebWidget.tsx           # 主组件
│       ├── WebModel.ts             # Model
│       ├── WebToolbar.tsx          # 导航栏
│       ├── useWeb.ts
│       └── web.scss
│
└── store/
    └── widgets.ts                  # Widget 状态管理 (Zustand)
```

---

## 迁移路径

### 从现有组件到新 Widget

1. **XtermTerminal.tsx** → **TerminalWidget**
   - 保持 API 兼容
   - 增量添加功能

2. **FilePicker.tsx** → **FilesWidget**
   - FilePicker 保留用于简单选择
   - FilesWidget 作为完整浏览器

3. **FileViewer.tsx** → **PreviewWidget (CodePreview)**
   - 整合进 Preview 系统

4. **WebViewer.tsx** → **WebWidget**
   - 增强导航功能

---

## 实施建议

### 立即可开始的工作

1. **Phase 0 (infra-prep)**:
   - 创建 `widgets/` 目录结构
   - 定义 TypeScript 类型
   - 添加依赖

2. **Phase 1 (terminal-enhance)**:
   - 添加 xterm addons
   - 实现 TerminalModel

### 需要设计决策的问题

1. **状态持久化**: 是否需要保存 terminal 状态到数据库？
2. **多窗口同步**: widget 状态是否需要跨 tab 同步？
3. **wsh 命令**: 是否需要类似 wsh 的命令行接口？

---

## 参考资源

### waveterm 关键文件

| 功能 | 文件路径 |
|------|----------|
| Terminal Model | `waveterm/frontend/app/view/term/term-model.ts` |
| Terminal Wrap | `waveterm/frontend/app/view/term/termwrap.ts` |
| Web Widget | `waveterm/frontend/app/view/webview/webview.tsx` |
| Preview Model | `waveterm/frontend/app/view/preview/preview-model.tsx` |
| Files Table | `waveterm/frontend/app/view/preview/preview-directory.tsx` |
| RPC API | `waveterm/frontend/app/store/wshclientapi.ts` |

### 推荐依赖版本

```json
{
  "@xterm/xterm": "5.5.0",
  "@xterm/addon-webgl": "^0.18.0",
  "@xterm/addon-search": "^0.15.0",
  "@xterm/addon-serialize": "^0.13.0",
  "@xterm/addon-fit": "^0.10.0",
  "@xterm/addon-web-links": "^0.11.0",
  "@tanstack/react-table": "^8.21.0",
  "react-markdown": "^9.0.0",
  "rehype-highlight": "^7.0.0"
}
```

---

## 总结

这个渐进式移植方案：

1. **保持稳定性**: 不破坏现有功能
2. **支持并行开发**: 4 个 widget 可以在不同 workspace 同时开发
3. **模块化设计**: 每个 widget 独立，易于测试和维护
4. **渐进式交付**: 每个 phase 都有可交付的成果

下一步：在 main 分支创建 `infra-prep` workspace，开始 Phase 0 的基础设施准备工作。
