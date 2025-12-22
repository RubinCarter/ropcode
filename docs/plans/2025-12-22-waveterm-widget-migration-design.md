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

## 详细移植方案

### Phase 1: Terminal Widget 增强 [workspace: terminal-enhance]

**目标**: 增强现有 Terminal，借鉴 waveterm 特性

**当前状态**: `XtermTerminal.tsx` 基础功能完整

#### waveterm Terminal 核心实现分析

**源文件**: `waveterm/frontend/app/view/term/term-model.ts`, `termwrap.ts`

**关键组件**:

1. **TermViewModel** (term-model.ts:40-918)
   - 实现 `ViewModel` 接口
   - 管理 terminal 状态：主题、字体大小、透明度
   - 提供设置菜单 (`getSettingsMenuItems`)
   - 键盘事件处理 (`keyDownHandler`, `handleTerminalKeydown`)
   - Shell 进程状态监控 (`shellProcStatus`)

2. **TermWrap** (termwrap.ts:365-807)
   - xterm.js Terminal 实例封装
   - 加载多个 addons: WebGL, Search, Serialize, WebLinks, Fit
   - OSC 命令处理 (7, 9283, 16162)
   - IME 输入法处理 (`handleComposition*`)
   - 粘贴处理 (`pasteHandler`)
   - 数据缓存和序列化 (`processAndCacheData`)

#### 移植步骤

**Step 1: 添加 xterm addons**
```bash
npm install @xterm/addon-webgl @xterm/addon-search @xterm/addon-serialize @xterm/addon-web-links
```

**Step 2: 创建 TermWrap 适配层**
```typescript
// widgets/terminal/TermWrap.ts
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { FitAddon } from '@xterm/addon-fit';

export class TermWrap {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  serializeAddon: SerializeAddon;

  constructor(container: HTMLDivElement, options: ITerminalOptions) {
    this.terminal = new Terminal(options);
    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    this.serializeAddon = new SerializeAddon();

    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.searchAddon);
    this.terminal.loadAddon(this.serializeAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    // WebGL 检测和加载
    if (this.detectWebGLSupport()) {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      this.terminal.loadAddon(webglAddon);
    }

    this.terminal.open(container);
  }

  private detectWebGLSupport(): boolean {
    try {
      const canvas = document.createElement('canvas');
      return !!canvas.getContext('webgl');
    } catch {
      return false;
    }
  }

  // 搜索功能
  search(query: string): void {
    this.searchAddon.findNext(query);
  }

  // 序列化状态
  serialize(): string {
    return this.serializeAddon.serialize();
  }

  // 自适应大小
  fit(): void {
    this.fitAddon.fit();
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
```

**Step 3: 创建 TerminalModel (Zustand store)**
```typescript
// widgets/terminal/TerminalModel.ts
import { create } from 'zustand';

interface TerminalState {
  // 配置
  fontSize: number;
  themeName: string;
  transparency: number;
  allowBracketedPaste: boolean;

  // 状态
  isLoading: boolean;
  shellStatus: 'init' | 'running' | 'done';

  // Actions
  setFontSize: (size: number) => void;
  setTheme: (name: string) => void;
  setTransparency: (value: number) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  fontSize: 12,
  themeName: 'default',
  transparency: 0.5,
  allowBracketedPaste: true,
  isLoading: false,
  shellStatus: 'init',

  setFontSize: (size) => set({ fontSize: size }),
  setTheme: (name) => set({ themeName: name }),
  setTransparency: (value) => set({ transparency: value }),
}));
```

**Step 4: 集成到现有 XtermTerminal.tsx**
```typescript
// 在现有组件中使用 TermWrap
import { TermWrap } from '@/widgets/terminal/TermWrap';
import { useTerminalStore } from '@/widgets/terminal/TerminalModel';

export function XtermTerminal({ sessionId }: Props) {
  const termWrapRef = useRef<TermWrap | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { fontSize, themeName } = useTerminalStore();

  useEffect(() => {
    if (containerRef.current && !termWrapRef.current) {
      termWrapRef.current = new TermWrap(containerRef.current, {
        fontSize,
        theme: getTheme(themeName),
      });
    }
    return () => termWrapRef.current?.dispose();
  }, []);

  // 字体大小变化时更新
  useEffect(() => {
    if (termWrapRef.current) {
      termWrapRef.current.terminal.options.fontSize = fontSize;
      termWrapRef.current.fit();
    }
  }, [fontSize]);

  return <div ref={containerRef} className="terminal-container" />;
}
```

#### 特性迁移清单
| waveterm 特性 | 优先级 | 移植方案 |
|--------------|--------|----------|
| WebGL 加速 | P0 | 直接使用 @xterm/addon-webgl |
| 搜索功能 | P1 | 使用 @xterm/addon-search |
| 主题系统 | P1 | 从 waveterm 提取主题配置 |
| 字体大小控制 | P1 | Zustand store 管理 |
| 序列化/恢复 | P2 | 使用 @xterm/addon-serialize |
| Shell Integration (OSC 16162) | P3 | 参考 termwrap.ts:247-363 实现 |
| IME 输入处理 | P1 | 参考 termwrap.ts:491-508 |

---

### Phase 2: Files Widget [workspace: files-widget]

**目标**: 实现完整的文件浏览器

**当前状态**: `FilePicker.tsx` 仅支持简单选择

#### waveterm Files 核心实现分析

**源文件**: `waveterm/frontend/app/view/preview/preview-directory.tsx`

**关键组件**:

1. **DirectoryPreview** (preview-directory.tsx:566-910)
   - 主组件，管理目录浏览状态
   - 搜索过滤 (`searchText`, `filteredData`)
   - 键盘导航 (`directoryKeyDownHandler`)
   - 拖放支持 (`useDrag`, `useDrop`)

2. **DirectoryTable** (preview-directory.tsx:99-300)
   - 使用 @tanstack/react-table
   - 列定义：图标、名称、权限、修改时间、大小、类型
   - 列宽调整 (`columnResizeMode`)
   - 排序功能 (`getSortedRowModel`)

3. **TableRow** (preview-directory.tsx:496-555)
   - 单行渲染
   - 拖拽支持
   - 双击打开、右键菜单

#### 移植步骤

**Step 1: Go 后端文件服务**
```go
// internal/fileops/fileops.go
package fileops

import (
    "io/fs"
    "mime"
    "os"
    "path/filepath"
    "time"
)

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

type FileOps struct{}

func (f *FileOps) ListDirectory(path string, showHidden bool) ([]FileInfo, error) {
    entries, err := os.ReadDir(path)
    if err != nil {
        return nil, err
    }

    var files []FileInfo
    for _, entry := range entries {
        if !showHidden && entry.Name()[0] == '.' {
            continue
        }

        info, err := entry.Info()
        if err != nil {
            continue
        }

        fullPath := filepath.Join(path, entry.Name())
        mimeType := ""
        if !entry.IsDir() {
            mimeType = mime.TypeByExtension(filepath.Ext(entry.Name()))
        } else {
            mimeType = "directory"
        }

        files = append(files, FileInfo{
            Name:     entry.Name(),
            Path:     fullPath,
            Dir:      path,
            Size:     info.Size(),
            ModeStr:  info.Mode().String(),
            ModTime:  info.ModTime(),
            IsDir:    entry.IsDir(),
            MimeType: mimeType,
            Readonly: info.Mode()&0200 == 0,
        })
    }

    return files, nil
}

func (f *FileOps) CreateFile(path string) error {
    file, err := os.Create(path)
    if err != nil {
        return err
    }
    return file.Close()
}

func (f *FileOps) CreateDirectory(path string) error {
    return os.MkdirAll(path, 0755)
}

func (f *FileOps) DeleteFile(path string, recursive bool) error {
    if recursive {
        return os.RemoveAll(path)
    }
    return os.Remove(path)
}

func (f *FileOps) Rename(oldPath, newPath string) error {
    return os.Rename(oldPath, newPath)
}

func (f *FileOps) Copy(src, dst string) error {
    // 实现文件/目录复制
    // ...
}
```

**Step 2: 前端 FilesWidget**
```typescript
// widgets/files/FilesWidget.tsx
import { useReactTable, getCoreRowModel, getSortedRowModel } from '@tanstack/react-table';
import { useDrag, useDrop } from 'react-dnd';

interface FileInfo {
  name: string;
  path: string;
  dir: string;
  size: number;
  modestr: string;
  modtime: string;
  isdir: boolean;
  mimetype: string;
  readonly: boolean;
}

export function FilesWidget({ initialPath = '~' }: Props) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<FileInfo[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [showHidden, setShowHidden] = useState(false);

  // 加载目录
  const loadDirectory = useCallback(async (path: string) => {
    const files = await window.go.main.App.FileList(path, { showHidden });
    setEntries(files);
    setCurrentPath(path);
    setFocusIndex(0);
  }, [showHidden]);

  // 过滤数据
  const filteredData = useMemo(() => {
    return entries.filter(f =>
      f.name.toLowerCase().includes(searchText.toLowerCase())
    );
  }, [entries, searchText]);

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          setFocusIndex(i => Math.max(0, i - 1));
          break;
        case 'ArrowDown':
          setFocusIndex(i => Math.min(filteredData.length - 1, i + 1));
          break;
        case 'Enter':
          const selected = filteredData[focusIndex];
          if (selected?.isdir) {
            loadDirectory(selected.path);
          }
          break;
        case 'Backspace':
          if (searchText) {
            setSearchText(s => s.slice(0, -1));
          } else {
            // 返回上级目录
            const parentDir = currentPath.split('/').slice(0, -1).join('/') || '/';
            loadDirectory(parentDir);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredData, focusIndex, searchText, currentPath]);

  // 表格定义
  const columns = useMemo(() => [
    { accessorKey: 'mimetype', header: '', size: 25, cell: IconCell },
    { accessorKey: 'name', header: 'Name', size: 200 },
    { accessorKey: 'modestr', header: 'Perm', size: 91 },
    { accessorKey: 'modtime', header: 'Modified', size: 91 },
    { accessorKey: 'size', header: 'Size', size: 55 },
  ], []);

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
  });

  return (
    <div className="files-widget">
      <FilesToolbar
        path={currentPath}
        showHidden={showHidden}
        onToggleHidden={() => setShowHidden(!showHidden)}
        onRefresh={() => loadDirectory(currentPath)}
      />
      {searchText && (
        <div className="search-indicator">
          Searching: "{searchText}"
        </div>
      )}
      <FilesTable
        table={table}
        focusIndex={focusIndex}
        onRowClick={setFocusIndex}
        onRowDoubleClick={(row) => {
          if (row.original.isdir) {
            loadDirectory(row.original.path);
          }
        }}
      />
    </div>
  );
}
```

**Step 3: 右键菜单**
```typescript
// widgets/files/FileContextMenu.tsx
export function useFileContextMenu(
  onNewFile: () => void,
  onNewFolder: () => void,
  onRename: (file: FileInfo) => void,
  onDelete: (file: FileInfo) => void,
) {
  return useCallback((e: React.MouseEvent, file: FileInfo) => {
    e.preventDefault();

    const menu: ContextMenuItem[] = [
      { label: 'New File', onClick: onNewFile },
      { label: 'New Folder', onClick: onNewFolder },
      { type: 'separator' },
      { label: 'Rename', onClick: () => onRename(file) },
      { label: 'Copy Path', onClick: () => navigator.clipboard.writeText(file.path) },
      { type: 'separator' },
      { label: 'Delete', onClick: () => onDelete(file), className: 'danger' },
    ];

    showContextMenu(menu, { x: e.clientX, y: e.clientY });
  }, [onNewFile, onNewFolder, onRename, onDelete]);
}
```

#### 特性迁移清单
| waveterm 特性 | 优先级 | 移植方案 |
|--------------|--------|----------|
| 目录浏览 | P0 | Go FileOps.ListDirectory |
| 文件 CRUD | P0 | Go FileOps.Create/Delete/Rename |
| 键盘导航 | P0 | useEffect 监听 keydown |
| 排序功能 | P1 | @tanstack/react-table getSortedRowModel |
| 右键菜单 | P1 | 自定义 ContextMenu 组件 |
| 拖拽复制 | P2 | react-dnd |
| 书签导航 | P2 | Zustand store 保存常用路径 |
| MIME 图标 | P2 | 根据 mimetype 映射图标 |

---

### Phase 3: Preview Widget [workspace: preview-widget]

**目标**: 实现统一的文件预览系统

**当前状态**:
- `FileViewer.tsx` 仅支持代码高亮
- `WebViewer.tsx` 支持 HTML 预览

#### waveterm Preview 核心实现分析

**源文件**: `waveterm/frontend/app/view/preview/preview-model.tsx`

**关键组件**:

1. **PreviewModel** (preview-model.tsx:118-500+)
   - MIME 类型检测 (`isTextFile`, `isStreamingType`, `isMarkdownLike`)
   - 文件图标映射 (`iconForFile`)
   - 编辑模式切换 (`editMode`)
   - 文件保存 (`handleFileSave`)

2. **预览类型**:
   - `codeedit` - Monaco Editor
   - `markdown` - Markdown 渲染
   - `directory` - 目录浏览 (→ Phase 2)
   - `image` - 图片预览
   - `video/audio` - 媒体播放
   - `pdf` - PDF 查看
   - `csv` - CSV 表格

#### 移植步骤

**Step 1: MIME 类型工具**
```typescript
// widgets/preview/mime-utils.ts
const textApplicationMimetypes = [
  'application/json',
  'application/javascript',
  'application/typescript',
  'application/xml',
  'application/yaml',
  'application/sql',
  'application/x-sh',
  'application/x-python',
];

export function isTextFile(mimeType: string): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith('text/') ||
    textApplicationMimetypes.includes(mimeType) ||
    mimeType.includes('json') ||
    mimeType.includes('yaml') ||
    mimeType.includes('xml')
  );
}

export function isStreamingType(mimeType: string): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith('application/pdf') ||
    mimeType.startsWith('video/') ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('image/')
  );
}

export type PreviewType =
  | 'code'
  | 'markdown'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'csv'
  | 'directory'
  | 'unknown';

export function detectPreviewType(mimeType: string): PreviewType {
  if (!mimeType) return 'unknown';
  if (mimeType === 'directory') return 'directory';
  if (mimeType.startsWith('text/markdown')) return 'markdown';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'text/csv') return 'csv';
  if (isTextFile(mimeType)) return 'code';
  return 'unknown';
}

export function iconForFile(mimeType: string): string {
  const type = detectPreviewType(mimeType);
  const iconMap: Record<PreviewType, string> = {
    directory: 'folder',
    markdown: 'file-lines',
    image: 'image',
    video: 'film',
    audio: 'headphones',
    pdf: 'file-pdf',
    csv: 'file-csv',
    code: 'file-code',
    unknown: 'file',
  };
  return iconMap[type];
}
```

**Step 2: PreviewWidget 主组件**
```typescript
// widgets/preview/PreviewWidget.tsx
import { CodePreview } from './previews/CodePreview';
import { MarkdownPreview } from './previews/MarkdownPreview';
import { ImagePreview } from './previews/ImagePreview';
import { MediaPreview } from './previews/MediaPreview';
import { PdfPreview } from './previews/PdfPreview';
import { CsvPreview } from './previews/CsvPreview';

interface PreviewWidgetProps {
  filePath: string;
  onEdit?: (content: string) => void;
}

export function PreviewWidget({ filePath, onEdit }: PreviewWidgetProps) {
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadFile() {
      setLoading(true);
      setError(null);
      try {
        const info = await window.go.main.App.FileInfo(filePath);
        setFileInfo(info);

        // 只有文本类型才加载内容
        if (isTextFile(info.mimetype) && info.size < 10 * 1024 * 1024) {
          const data = await window.go.main.App.FileRead(filePath);
          setContent(data.content);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    loadFile();
  }, [filePath]);

  if (loading) return <div className="preview-loading">Loading...</div>;
  if (error) return <div className="preview-error">{error}</div>;
  if (!fileInfo) return null;

  const previewType = detectPreviewType(fileInfo.mimetype);

  const previewComponents: Record<PreviewType, React.FC<any>> = {
    code: CodePreview,
    markdown: MarkdownPreview,
    image: ImagePreview,
    video: MediaPreview,
    audio: MediaPreview,
    pdf: PdfPreview,
    csv: CsvPreview,
    directory: () => null, // 使用 FilesWidget
    unknown: () => <div>Cannot preview this file type</div>,
  };

  const PreviewComponent = previewComponents[previewType];

  return (
    <div className="preview-widget">
      <PreviewToolbar
        fileInfo={fileInfo}
        editMode={editMode}
        canEdit={previewType === 'code' || previewType === 'markdown'}
        onToggleEdit={() => setEditMode(!editMode)}
        onSave={() => {/* save logic */}}
      />
      <PreviewComponent
        fileInfo={fileInfo}
        content={content}
        editMode={editMode}
        onChange={setContent}
      />
    </div>
  );
}
```

**Step 3: 各类型预览组件**

```typescript
// widgets/preview/previews/CodePreview.tsx
import MonacoEditor from '@monaco-editor/react';

export function CodePreview({ content, editMode, onChange, fileInfo }) {
  const language = detectLanguage(fileInfo.name);

  return (
    <MonacoEditor
      value={content}
      language={language}
      options={{
        readOnly: !editMode,
        minimap: { enabled: false },
        lineNumbers: 'on',
        wordWrap: 'on',
      }}
      onChange={onChange}
    />
  );
}

// widgets/preview/previews/MarkdownPreview.tsx
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';

export function MarkdownPreview({ content, editMode, onChange }) {
  if (editMode) {
    return (
      <textarea
        className="markdown-editor"
        value={content}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className="markdown-preview">
      <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

// widgets/preview/previews/ImagePreview.tsx
export function ImagePreview({ fileInfo }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    // 通过 Go 后端读取图片并转为 data URL
    async function loadImage() {
      const data = await window.go.main.App.FileReadBase64(fileInfo.path);
      setImageUrl(`data:${fileInfo.mimetype};base64,${data}`);
    }
    loadImage();
  }, [fileInfo.path]);

  return (
    <div className="image-preview">
      {imageUrl && <img src={imageUrl} alt={fileInfo.name} />}
    </div>
  );
}
```

#### 特性迁移清单
| waveterm 特性 | 优先级 | 移植方案 |
|--------------|--------|----------|
| 代码预览 | P0 | Monaco Editor |
| 代码编辑 | P0 | Monaco Editor + editMode |
| Markdown 渲染 | P0 | react-markdown + rehype-highlight |
| 图片预览 | P0 | Go 读取 + base64 |
| 文件保存 | P1 | Go FileOps.WriteFile |
| PDF 查看 | P1 | react-pdf 或 pdfjs |
| 视频/音频 | P2 | HTML5 video/audio |
| CSV 表格 | P2 | @tanstack/react-table |

---

### Phase 4: Web Widget 增强 [workspace: web-enhance]

**目标**: 增强现有 WebViewer

**当前状态**: `WebViewer.tsx` 基于 iframe

#### waveterm Web 核心实现分析

**源文件**: `waveterm/frontend/app/view/webview/webview.tsx`

**关键组件**:

1. **WebViewModel** (webview.tsx:45-500+)
   - URL 管理 (`url`, `homepageUrl`)
   - 导航控制 (`handleBack`, `handleForward`, `handleHome`)
   - 加载状态 (`isLoading`, `refreshIcon`)
   - 媒体控制 (`mediaPlaying`, `mediaMuted`)
   - User Agent 模拟 (Electron 特有)
   - 书签建议 (`fetchBookmarkSuggestions`)

2. **导航栏元素**:
   - 后退/前进/主页按钮
   - URL 输入框
   - 刷新/停止按钮
   - 外部浏览器打开按钮

#### 移植限制

由于 Wails 使用系统 WebView 而非 Electron webview，以下特性**无法移植**：
- `setAudioMuted()` - 媒体静音控制
- `setUserAgent()` - User Agent 模拟
- `openDevTools()` - 开发者工具

#### 移植步骤

**Step 1: WebModel (Zustand store)**
```typescript
// widgets/web/WebModel.ts
import { create } from 'zustand';

interface WebState {
  url: string;
  homepageUrl: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;

  setUrl: (url: string) => void;
  setHomepage: (url: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useWebStore = create<WebState>((set) => ({
  url: '',
  homepageUrl: 'https://www.google.com',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,

  setUrl: (url) => set({ url }),
  setHomepage: (url) => set({ homepageUrl: url }),
  setLoading: (loading) => set({ isLoading: loading }),
}));
```

**Step 2: WebWidget 组件**
```typescript
// widgets/web/WebWidget.tsx
import { useWebStore } from './WebModel';

export function WebWidget({ initialUrl }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { url, setUrl, isLoading, setLoading, homepageUrl } = useWebStore();
  const [urlInput, setUrlInput] = useState(initialUrl || homepageUrl);

  // 确保 URL 有协议
  const ensureScheme = (inputUrl: string): string => {
    if (/^https?:\/\//.test(inputUrl)) return inputUrl;
    if (/^localhost|^\d{1,3}\.\d{1,3}/.test(inputUrl)) {
      return `http://${inputUrl}`;
    }
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(inputUrl.split('/')[0])) {
      return `https://${inputUrl}`;
    }
    // 搜索查询
    return `https://www.google.com/search?q=${encodeURIComponent(inputUrl)}`;
  };

  const loadUrl = useCallback((newUrl: string) => {
    const finalUrl = ensureScheme(newUrl);
    setUrl(finalUrl);
    setUrlInput(finalUrl);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      loadUrl(urlInput);
    }
  };

  // iframe 加载事件
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => setLoading(false);
    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, []);

  return (
    <div className="web-widget">
      <WebToolbar
        url={urlInput}
        onUrlChange={setUrlInput}
        onUrlSubmit={() => loadUrl(urlInput)}
        onBack={() => {/* iframe history.back 受限 */}}
        onForward={() => {/* iframe history.forward 受限 */}}
        onHome={() => loadUrl(homepageUrl)}
        onRefresh={() => iframeRef.current?.contentWindow?.location.reload()}
        isLoading={isLoading}
      />
      <iframe
        ref={iframeRef}
        src={url}
        className="web-iframe"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        onLoadStart={() => setLoading(true)}
      />
    </div>
  );
}
```

**Step 3: 书签系统**
```typescript
// widgets/web/bookmarks.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Bookmark {
  id: string;
  url: string;
  title: string;
  favicon?: string;
}

interface BookmarkState {
  bookmarks: Bookmark[];
  addBookmark: (bookmark: Omit<Bookmark, 'id'>) => void;
  removeBookmark: (id: string) => void;
}

export const useBookmarkStore = create<BookmarkState>()(
  persist(
    (set) => ({
      bookmarks: [],
      addBookmark: (bookmark) => set((state) => ({
        bookmarks: [...state.bookmarks, { ...bookmark, id: Date.now().toString() }],
      })),
      removeBookmark: (id) => set((state) => ({
        bookmarks: state.bookmarks.filter(b => b.id !== id),
      })),
    }),
    { name: 'web-bookmarks' }
  )
);
```

#### 特性迁移清单
| waveterm 特性 | 可行性 | 移植方案 |
|--------------|--------|----------|
| URL 导航 | ✓ | iframe src |
| URL 输入框 | ✓ | 自定义组件 |
| 刷新按钮 | ✓ | contentWindow.location.reload |
| 主页按钮 | ✓ | 加载 homepageUrl |
| 书签系统 | ✓ | Zustand + persist |
| 外部打开 | ✓ | Wails runtime.BrowserOpenURL |
| 历史导航 | 部分 | iframe 跨域限制 |
| 媒体静音 | ✗ | Electron 特有 API |
| User Agent | ✗ | Electron 特有 API |
| DevTools | ✗ | Electron 特有 API |

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
func (a *App) FileReadBase64(path string) (string, error)  // 用于图片
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
│   │   ├── TermWrap.ts             # xterm 封装
│   │   ├── TerminalModel.ts        # Zustand store
│   │   ├── TerminalToolbar.tsx     # 工具栏
│   │   ├── themes/                 # 主题定义
│   │   └── terminal.scss           # 样式
│   │
│   ├── files/
│   │   ├── index.ts
│   │   ├── FilesWidget.tsx         # 主组件
│   │   ├── FilesModel.ts           # Zustand store
│   │   ├── FilesTable.tsx          # 表格组件
│   │   ├── FileContextMenu.tsx     # 右键菜单
│   │   ├── Bookmarks.tsx           # 书签
│   │   └── files.scss
│   │
│   ├── preview/
│   │   ├── index.ts
│   │   ├── PreviewWidget.tsx       # 主组件
│   │   ├── PreviewModel.ts         # Zustand store
│   │   ├── mime-utils.ts           # MIME 工具
│   │   ├── previews/
│   │   │   ├── CodePreview.tsx     # 代码
│   │   │   ├── MarkdownPreview.tsx # Markdown
│   │   │   ├── ImagePreview.tsx    # 图片
│   │   │   ├── MediaPreview.tsx    # 视频/音频
│   │   │   ├── PdfPreview.tsx      # PDF
│   │   │   └── CsvPreview.tsx      # CSV
│   │   └── preview.scss
│   │
│   └── web/
│       ├── index.ts
│       ├── WebWidget.tsx           # 主组件
│       ├── WebModel.ts             # Zustand store
│       ├── WebToolbar.tsx          # 导航栏
│       ├── bookmarks.ts            # 书签存储
│       └── web.scss
│
└── store/
    └── widgets.ts                  # Widget 公共状态
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

## 参考资源

### waveterm 关键文件

| 功能 | 文件路径 | 行数范围 |
|------|----------|----------|
| Terminal ViewModel | `waveterm/frontend/app/view/term/term-model.ts` | 40-918 |
| Terminal Wrap | `waveterm/frontend/app/view/term/termwrap.ts` | 365-807 |
| Web ViewModel | `waveterm/frontend/app/view/webview/webview.tsx` | 45-500 |
| Preview Model | `waveterm/frontend/app/view/preview/preview-model.tsx` | 118-400 |
| Files Table | `waveterm/frontend/app/view/preview/preview-directory.tsx` | 99-555 |
| RPC API | `waveterm/frontend/app/store/wshclientapi.ts` | 全文件 |

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
  "@monaco-editor/react": "^4.6.0",
  "react-markdown": "^9.0.0",
  "rehype-highlight": "^7.0.0",
  "react-dnd": "^16.0.0",
  "react-dnd-html5-backend": "^16.0.0"
}
```

---

## 远期愿景：rsh 项目管理系统

> **注意**: 本节描述的是远期规划，当前阶段仅需在架构设计中预留扩展点。
> 详细设计请参阅 [rsh 项目管理系统设计文档](./2025-12-22-rsh-project-manager-design.md)

Widget 移植完成后，可以基于这些组件构建 rsh 项目管理系统：

- **Terminal Widget** → 运行 AI CLI (Claude/Codex/Gemini)
- **Files Widget** → 浏览 worktree 文件
- **Preview Widget** → 查看代码变更、审核提交
- **Web Widget** → 显示文档、PR 预览

rsh 的核心理念：
- Main Project 作为"项目经理"角色
- Sub Workspaces 使用 git worktree + AI Provider 并行开发
- 任务拆解、分配、验收的完整工作流

---

## 总结

这个渐进式移植方案：

1. **保持稳定性**: 不破坏现有功能
2. **支持并行开发**: 4 个 widget 可以在不同 workspace 同时开发
3. **模块化设计**: 每个 widget 独立，易于测试和维护
4. **渐进式交付**: 每个 phase 都有可交付的成果
5. **预留扩展**: 为 rsh 项目管理系统预留架构支持

下一步：在 main 分支创建 `infra-prep` workspace，开始 Phase 0 的基础设施准备工作。
