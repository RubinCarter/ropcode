# Electron + WebSocket RPC 前端迁移方案

## 概述

将 Ropcode 从 Wails 框架迁移到 Electron + 嵌入式 Go 服务架构，采用最小改动策略。

**核心决策：**
- Go 后端保持业务逻辑不变，只添加 WebSocket 端点
- 前端创建适配层，将 `wailsjs/` 调用转换为 WebSocket RPC
- Go 二进制放入 Electron extraResources
- RPC 调用和事件推送共用同一个 WebSocket 连接

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────┐
│                    Electron                          │
│  ┌───────────────────────────────────────────────┐  │
│  │              Main Process                      │  │
│  │  • 启动/停止 Go 服务                           │  │
│  │  • 窗口管理                                    │  │
│  │  • 传递 AuthKey 环境变量                       │  │
│  └───────────────────────────────────────────────┘  │
│                        │                             │
│  ┌───────────────────────────────────────────────┐  │
│  │           Renderer (React 前端)                │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │      WebSocket RPC 适配层                │  │  │
│  │  │  (替代 wailsjs/go/main/App.ts)          │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │                    │                          │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │      现有业务组件 (基本不改)             │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                         │ WebSocket (ws://localhost:PORT)
                         ▼
┌─────────────────────────────────────────────────────┐
│                 Go 服务 (独立进程)                   │
│  ┌─────────────────────────────────────────────────┐│
│  │  新增: WebSocket 端点 + JSON-RPC 处理           ││
│  └─────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────┐│
│  │  现有: PTYManager, ClaudeManager, EventHub...   ││
│  │        (完全复用，不改动)                        ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

---

## 二、Go 后端改动

### 2.1 新增文件

**`internal/websocket/server.go`**

```go
type WSServer struct {
    port      int
    authKey   string           // 从环境变量读取
    clients   map[string]*WSClient
    app       *App             // 复用现有的 App 结构体
}

// RPC 消息格式
type RPCMessage struct {
    ID      string      `json:"id"`      // 请求 ID
    Method  string      `json:"method"`  // 方法名，如 "CreatePtySession"
    Params  interface{} `json:"params"`  // 参数
    Result  interface{} `json:"result"`  // 响应结果
    Error   string      `json:"error"`   // 错误信息
}

// 事件推送格式
type WSEvent struct {
    Type    string      `json:"type"`    // 如 "claude-output", "pty-output"
    Payload interface{} `json:"payload"` // 事件数据
}
```

### 2.2 关键改动点

1. **`app.go`**：添加 `StartWSServer()` 方法
2. **`eventhub/hub.go`**：添加 WebSocket 广播钩子
3. **现有管理器**：零改动

### 2.3 启动流程变化

```
原 Wails 模式:  wails.Run() → 内部启动 HTTP + WebView
新 Electron 模式: StartWSServer() → 返回端口号 → Electron 连接
```

---

## 三、前端适配层

### 3.1 WebSocket RPC 客户端

**`frontend/src/lib/ws-rpc-client.ts`**

```typescript
class WSRpcClient {
  private ws: WebSocket;
  private pending: Map<string, { resolve, reject }>;
  private eventListeners: Map<string, Set<Function>>;

  async call<T>(method: string, ...params: any[]): Promise<T> {
    const id = crypto.randomUUID();
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  on(eventType: string, callback: Function) {
    // 事件监听
  }
}
```

### 3.2 Wails 兼容层

**`frontend/src/lib/wails-compat.ts`**

```typescript
import { wsClient } from './ws-rpc-client';

// 保持与 wailsjs/go/main/App.ts 相同的导出接口
export function CreatePtySession(cwd: string, rows: number, cols: number) {
  return wsClient.call('CreatePtySession', cwd, rows, cols);
}

export function WriteToPty(sessionId: string, data: string) {
  return wsClient.call('WriteToPty', sessionId, data);
}

// ... 其他约 50+ 方法，保持签名完全一致
```

### 3.3 迁移方式

```typescript
// 只需修改 import 路径
- import { CreatePtySession } from '../../wailsjs/go/main/App';
+ import { CreatePtySession } from '@/lib/wails-compat';

// 事件系统同样兼容
- import { EventsOn } from '../../wailsjs/runtime/runtime';
+ import { EventsOn } from '@/lib/wails-compat';
```

---

## 四、Electron 主进程

### 4.1 目录结构

```
electron/
├── main.ts              # 主进程入口
├── preload.ts           # 预加载脚本
├── go-server.ts         # Go 服务管理
└── package.json         # Electron 依赖
```

### 4.2 Go 服务管理

**`electron/go-server.ts`**

```typescript
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

let goProcess: ChildProcess | null = null;

export function startGoServer(): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    const goBinary = path.join(
      process.resourcesPath,
      'bin',
      process.platform === 'win32' ? 'ropcode-server.exe' : 'ropcode-server'
    );

    const authKey = crypto.randomUUID();

    goProcess = spawn(goBinary, [], {
      env: {
        ...process.env,
        ROPCODE_AUTH_KEY: authKey,
        ROPCODE_MODE: 'websocket'
      }
    });

    goProcess.stdout.on('data', (data) => {
      const match = data.toString().match(/WS_PORT:(\d+)/);
      if (match) {
        resolve({ port: parseInt(match[1]) });
      }
    });
  });
}

export function stopGoServer() {
  goProcess?.kill();
}
```

### 4.3 主进程入口

**`electron/main.ts`**

```typescript
import { app, BrowserWindow } from 'electron';
import { startGoServer, stopGoServer } from './go-server';

let mainWindow: BrowserWindow;

app.whenReady().then(async () => {
  const { port } = await startGoServer();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const url = isDev
    ? `http://localhost:5173?wsPort=${port}`
    : `file://${__dirname}/frontend/index.html?wsPort=${port}`;

  mainWindow.loadURL(url);
});

app.on('quit', stopGoServer);
```

---

## 五、打包与构建

### 5.1 目录结构变化

```
ropcode/
├── electron/                  # 新增
│   ├── main.ts
│   ├── go-server.ts
│   └── package.json
├── frontend/                  # 保持不变
├── internal/                  # 基本不变
├── cmd/
│   └── server/
│       └── main.go           # 新增：独立服务模式入口
├── scripts/
│   └── build-electron.sh     # 新增
└── electron-builder.yml      # 新增
```

### 5.2 打包配置

**`electron-builder.yml`**

```yaml
appId: com.ropcode.app
productName: Ropcode

files:
  - electron/dist/**/*
  - frontend/dist/**/*

extraResources:
  - from: bin/${os}/${arch}/ropcode-server${ext}
    to: bin/ropcode-server${ext}

mac:
  target: [dmg, zip]
  icon: assets/icon.icns

win:
  target: [nsis]
  icon: assets/icon.ico
```

### 5.3 构建流程

```bash
# 1. 构建 Go 服务二进制
GOOS=darwin GOARCH=arm64 go build -o bin/darwin/arm64/ropcode-server ./cmd/server

# 2. 构建前端
cd frontend && npm run build

# 3. 构建 Electron
cd electron && npm run build

# 4. 打包
electron-builder --mac
```

---

## 六、迁移步骤与改动清单

### 阶段一：基础设施（Go 后端）

```
改动文件：
├── cmd/server/main.go          # 新增：独立服务入口
├── internal/websocket/
│   ├── server.go               # 新增：WebSocket 服务器
│   ├── handler.go              # 新增：RPC 消息处理
│   └── events.go               # 新增：事件广播适配
└── internal/eventhub/hub.go    # 小改：添加 WS 广播钩子
```

### 阶段二：前端适配层

```
改动文件：
├── frontend/src/lib/
│   ├── ws-rpc-client.ts        # 新增：WebSocket 客户端
│   ├── wails-compat.ts         # 新增：Wails API 兼容层
│   └── wails-events-compat.ts  # 新增：事件系统兼容层
└── frontend/src/App.tsx        # 小改：初始化 WS 连接
```

### 阶段三：Electron 壳

```
新增文件：
├── electron/
│   ├── main.ts
│   ├── go-server.ts
│   ├── preload.ts
│   ├── package.json
│   └── tsconfig.json
└── electron-builder.yml
```

### 阶段四：Import 路径替换

```
批量替换（可用脚本自动化）：
- from '../../wailsjs/go/main/App'  →  from '@/lib/wails-compat'
- from '../../wailsjs/runtime/runtime'  →  from '@/lib/wails-compat'
```

### 预估改动量

| 类别 | 新增 | 修改 | 说明 |
|------|------|------|------|
| Go 后端 | ~4 文件 | ~2 文件 | WebSocket 层 + EventHub 钩子 |
| 前端适配 | ~3 文件 | ~1 文件 | 适配层 + App.tsx 初始化 |
| Electron | ~5 文件 | 0 | 全新增 |
| Import 替换 | 0 | ~50 文件 | 批量脚本替换 |

**现有业务逻辑代码：零改动**

---

## 七、参考资料

- Waveterm WebSocket RPC 实现：`waveterm/pkg/wshrpc/`、`waveterm/frontend/app/store/ws.ts`
- 当前 Ropcode 架构：`frontend/src/lib/api.ts`、`internal/eventhub/`
