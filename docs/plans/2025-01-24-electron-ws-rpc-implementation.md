# Electron + WebSocket RPC 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Ropcode 从 Wails 迁移到 Electron + 嵌入式 Go 服务，采用 WebSocket RPC 通信。

**Architecture:** Go 后端添加 WebSocket 端点，前端创建适配层替代 wailsjs 调用，Electron 作为壳启动 Go 服务并管理窗口。

**Tech Stack:** Go (gorilla/websocket), TypeScript, Electron, electron-builder

---

## 阶段一：Go WebSocket 服务器

### Task 1: 添加 gorilla/websocket 依赖

**Files:**
- Modify: `go.mod`

**Step 1: 添加依赖**

```bash
go get github.com/gorilla/websocket
```

**Step 2: 验证依赖已添加**

Run: `grep gorilla go.mod`
Expected: `github.com/gorilla/websocket v1.x.x`

**Step 3: Commit**

```bash
git add go.mod go.sum
git commit -m "deps: add gorilla/websocket for WebSocket RPC"
```

---

### Task 2: 创建 WebSocket 消息类型定义

**Files:**
- Create: `internal/websocket/types.go`

**Step 1: 创建目录和文件**

```go
// internal/websocket/types.go
package websocket

// RPCRequest 表示从前端发来的 RPC 请求
type RPCRequest struct {
	ID     string        `json:"id"`     // 请求 ID，用于匹配响应
	Method string        `json:"method"` // 方法名，如 "CreatePtySession"
	Params []interface{} `json:"params"` // 参数数组
}

// RPCResponse 表示返回给前端的 RPC 响应
type RPCResponse struct {
	ID     string      `json:"id"`               // 对应请求的 ID
	Result interface{} `json:"result,omitempty"` // 成功时的返回值
	Error  string      `json:"error,omitempty"`  // 失败时的错误信息
}

// WSEvent 表示后端主动推送的事件
type WSEvent struct {
	Type    string      `json:"type"`    // 事件类型，如 "claude-output"
	Payload interface{} `json:"payload"` // 事件数据
}

// WSMessage 是 WebSocket 消息的统一封装
type WSMessage struct {
	// 消息类型: "rpc_request", "rpc_response", "event"
	Kind string `json:"kind"`

	// RPC 请求 (kind == "rpc_request")
	Request *RPCRequest `json:"request,omitempty"`

	// RPC 响应 (kind == "rpc_response")
	Response *RPCResponse `json:"response,omitempty"`

	// 事件 (kind == "event")
	Event *WSEvent `json:"event,omitempty"`
}
```

**Step 2: 验证编译**

Run: `go build ./internal/websocket/...`
Expected: 无错误

**Step 3: Commit**

```bash
git add internal/websocket/types.go
git commit -m "feat(ws): add WebSocket message type definitions"
```

---

### Task 3: 创建 WebSocket 客户端管理

**Files:**
- Create: `internal/websocket/client.go`

**Step 1: 创建客户端管理文件**

```go
// internal/websocket/client.go
package websocket

import (
	"encoding/json"
	"sync"

	"github.com/gorilla/websocket"
)

// Client 表示一个 WebSocket 客户端连接
type Client struct {
	ID   string
	Conn *websocket.Conn
	Send chan []byte
	mu   sync.Mutex
}

// NewClient 创建新的客户端
func NewClient(id string, conn *websocket.Conn) *Client {
	return &Client{
		ID:   id,
		Conn: conn,
		Send: make(chan []byte, 256),
	}
}

// SendMessage 向客户端发送消息
func (c *Client) SendMessage(msg *WSMessage) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	select {
	case c.Send <- data:
		return nil
	default:
		return ErrClientBufferFull
	}
}

// SendEvent 向客户端发送事件
func (c *Client) SendEvent(eventType string, payload interface{}) error {
	return c.SendMessage(&WSMessage{
		Kind: "event",
		Event: &WSEvent{
			Type:    eventType,
			Payload: payload,
		},
	})
}

// SendResponse 向客户端发送 RPC 响应
func (c *Client) SendResponse(id string, result interface{}, errMsg string) error {
	resp := &RPCResponse{ID: id}
	if errMsg != "" {
		resp.Error = errMsg
	} else {
		resp.Result = result
	}
	return c.SendMessage(&WSMessage{
		Kind:     "rpc_response",
		Response: resp,
	})
}

// WritePump 将 Send 通道中的消息写入 WebSocket
func (c *Client) WritePump() {
	defer c.Conn.Close()

	for message := range c.Send {
		if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
			return
		}
	}
}

// Close 关闭客户端连接
func (c *Client) Close() {
	close(c.Send)
}

// 错误定义
var ErrClientBufferFull = &ClientError{Message: "client send buffer full"}

type ClientError struct {
	Message string
}

func (e *ClientError) Error() string {
	return e.Message
}
```

**Step 2: 验证编译**

Run: `go build ./internal/websocket/...`
Expected: 无错误

**Step 3: Commit**

```bash
git add internal/websocket/client.go
git commit -m "feat(ws): add WebSocket client management"
```

---

### Task 4: 创建 RPC 方法路由器

**Files:**
- Create: `internal/websocket/router.go`

**Step 1: 创建路由器文件**

```go
// internal/websocket/router.go
package websocket

import (
	"fmt"
	"reflect"
)

// Router 将 RPC 方法名映射到 App 方法
type Router struct {
	app     interface{}
	methods map[string]reflect.Method
}

// NewRouter 创建新的路由器
func NewRouter(app interface{}) *Router {
	r := &Router{
		app:     app,
		methods: make(map[string]reflect.Method),
	}

	// 通过反射获取所有公开方法
	appType := reflect.TypeOf(app)
	for i := 0; i < appType.NumMethod(); i++ {
		method := appType.Method(i)
		// 只注册公开方法（首字母大写）
		if method.IsExported() {
			r.methods[method.Name] = method
		}
	}

	return r
}

// Call 调用指定的 RPC 方法
func (r *Router) Call(methodName string, params []interface{}) (interface{}, error) {
	method, ok := r.methods[methodName]
	if !ok {
		return nil, fmt.Errorf("method not found: %s", methodName)
	}

	// 准备参数
	methodType := method.Type
	numIn := methodType.NumIn() - 1 // 减去 receiver

	if len(params) != numIn {
		return nil, fmt.Errorf("method %s expects %d params, got %d", methodName, numIn, len(params))
	}

	// 构建调用参数
	args := make([]reflect.Value, numIn+1)
	args[0] = reflect.ValueOf(r.app)

	for i, param := range params {
		expectedType := methodType.In(i + 1)
		paramValue, err := convertParam(param, expectedType)
		if err != nil {
			return nil, fmt.Errorf("param %d: %w", i, err)
		}
		args[i+1] = paramValue
	}

	// 调用方法
	results := method.Func.Call(args)

	// 处理返回值
	return processResults(results)
}

// convertParam 将 JSON 解析的值转换为目标类型
func convertParam(param interface{}, targetType reflect.Type) (reflect.Value, error) {
	if param == nil {
		return reflect.Zero(targetType), nil
	}

	paramValue := reflect.ValueOf(param)

	// 如果类型直接匹配，直接返回
	if paramValue.Type().AssignableTo(targetType) {
		return paramValue, nil
	}

	// 处理数字类型转换（JSON 数字默认是 float64）
	if paramValue.Kind() == reflect.Float64 {
		switch targetType.Kind() {
		case reflect.Int:
			return reflect.ValueOf(int(param.(float64))), nil
		case reflect.Int64:
			return reflect.ValueOf(int64(param.(float64))), nil
		case reflect.Int32:
			return reflect.ValueOf(int32(param.(float64))), nil
		case reflect.Uint:
			return reflect.ValueOf(uint(param.(float64))), nil
		case reflect.Uint32:
			return reflect.ValueOf(uint32(param.(float64))), nil
		case reflect.Uint64:
			return reflect.ValueOf(uint64(param.(float64))), nil
		}
	}

	// 尝试类型转换
	if paramValue.Type().ConvertibleTo(targetType) {
		return paramValue.Convert(targetType), nil
	}

	return reflect.Value{}, fmt.Errorf("cannot convert %T to %s", param, targetType)
}

// processResults 处理方法返回值
func processResults(results []reflect.Value) (interface{}, error) {
	switch len(results) {
	case 0:
		return nil, nil
	case 1:
		// 检查是否是 error
		if results[0].Type().Implements(reflect.TypeOf((*error)(nil)).Elem()) {
			if !results[0].IsNil() {
				return nil, results[0].Interface().(error)
			}
			return nil, nil
		}
		return results[0].Interface(), nil
	case 2:
		// 假设第二个是 error
		var err error
		if !results[1].IsNil() {
			err = results[1].Interface().(error)
		}
		if err != nil {
			return nil, err
		}
		return results[0].Interface(), nil
	default:
		// 多个返回值，返回数组
		var result []interface{}
		for i := 0; i < len(results)-1; i++ {
			result = append(result, results[i].Interface())
		}
		// 检查最后一个是否是 error
		last := results[len(results)-1]
		if last.Type().Implements(reflect.TypeOf((*error)(nil)).Elem()) && !last.IsNil() {
			return nil, last.Interface().(error)
		}
		return result, nil
	}
}
```

**Step 2: 验证编译**

Run: `go build ./internal/websocket/...`
Expected: 无错误

**Step 3: Commit**

```bash
git add internal/websocket/router.go
git commit -m "feat(ws): add RPC method router with reflection"
```

---

### Task 5: 创建 WebSocket 服务器

**Files:**
- Create: `internal/websocket/server.go`

**Step 1: 创建服务器文件**

```go
// internal/websocket/server.go
package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许所有来源（仅本地使用）
	},
}

// Server WebSocket 服务器
type Server struct {
	port       int
	authKey    string
	router     *Router
	clients    map[string]*Client
	clientsMu  sync.RWMutex
	httpServer *http.Server
}

// NewServer 创建新的 WebSocket 服务器
func NewServer(app interface{}) *Server {
	authKey := os.Getenv("ROPCODE_AUTH_KEY")

	return &Server{
		authKey: authKey,
		router:  NewRouter(app),
		clients: make(map[string]*Client),
	}
}

// Start 启动 WebSocket 服务器
func (s *Server) Start(ctx context.Context) (int, error) {
	// 找到可用端口
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("failed to find available port: %w", err)
	}

	s.port = listener.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.HandleFunc("/health", s.handleHealth)

	s.httpServer = &http.Server{Handler: mux}

	go func() {
		if err := s.httpServer.Serve(listener); err != http.ErrServerClosed {
			log.Printf("WebSocket server error: %v", err)
		}
	}()

	// 输出端口号供 Electron 读取
	fmt.Printf("WS_PORT:%d\n", s.port)

	return s.port, nil
}

// Stop 停止服务器
func (s *Server) Stop(ctx context.Context) error {
	// 关闭所有客户端
	s.clientsMu.Lock()
	for _, client := range s.clients {
		client.Close()
	}
	s.clientsMu.Unlock()

	return s.httpServer.Shutdown(ctx)
}

// handleHealth 健康检查端点
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

// handleWebSocket 处理 WebSocket 连接
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	// 验证 authKey
	if s.authKey != "" {
		authHeader := r.Header.Get("X-Auth-Key")
		if authHeader != s.authKey {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	clientID := uuid.New().String()
	client := NewClient(clientID, conn)

	s.clientsMu.Lock()
	s.clients[clientID] = client
	s.clientsMu.Unlock()

	// 启动写入协程
	go client.WritePump()

	// 读取消息
	s.readPump(client)
}

// readPump 从客户端读取消息
func (s *Server) readPump(client *Client) {
	defer func() {
		s.clientsMu.Lock()
		delete(s.clients, client.ID)
		s.clientsMu.Unlock()
		client.Conn.Close()
	}()

	for {
		_, message, err := client.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			}
			break
		}

		s.handleMessage(client, message)
	}
}

// handleMessage 处理收到的消息
func (s *Server) handleMessage(client *Client, message []byte) {
	var msg WSMessage
	if err := json.Unmarshal(message, &msg); err != nil {
		log.Printf("Invalid message format: %v", err)
		return
	}

	if msg.Kind == "rpc_request" && msg.Request != nil {
		s.handleRPCRequest(client, msg.Request)
	}
}

// handleRPCRequest 处理 RPC 请求
func (s *Server) handleRPCRequest(client *Client, req *RPCRequest) {
	result, err := s.router.Call(req.Method, req.Params)

	var errMsg string
	if err != nil {
		errMsg = err.Error()
	}

	if err := client.SendResponse(req.ID, result, errMsg); err != nil {
		log.Printf("Failed to send response: %v", err)
	}
}

// BroadcastEvent 向所有客户端广播事件
func (s *Server) BroadcastEvent(eventType string, payload interface{}) {
	s.clientsMu.RLock()
	defer s.clientsMu.RUnlock()

	for _, client := range s.clients {
		client.SendEvent(eventType, payload)
	}
}

// GetPort 返回服务器端口
func (s *Server) GetPort() int {
	return s.port
}
```

**Step 2: 验证编译**

Run: `go build ./internal/websocket/...`
Expected: 无错误

**Step 3: Commit**

```bash
git add internal/websocket/server.go
git commit -m "feat(ws): add WebSocket server with RPC handling"
```

---

### Task 6: 修改 EventHub 支持 WebSocket 广播

**Files:**
- Modify: `internal/eventhub/hub.go`

**Step 1: 添加 WebSocket 广播接口**

在文件顶部添加 Broadcaster 接口：

```go
// Broadcaster 事件广播接口
type Broadcaster interface {
	BroadcastEvent(eventType string, payload interface{})
}
```

修改 EventHub 结构体：

```go
type EventHub struct {
	ctx         context.Context
	broadcaster Broadcaster
}

func New(ctx context.Context) *EventHub {
	return &EventHub{ctx: ctx}
}

// SetBroadcaster 设置 WebSocket 广播器
func (h *EventHub) SetBroadcaster(b Broadcaster) {
	h.broadcaster = b
}

// emit 统一的事件发送方法
func (h *EventHub) emit(eventName string, payload interface{}) {
	// Wails 模式
	if h.ctx != nil {
		runtime.EventsEmit(h.ctx, eventName, payload)
	}
	// WebSocket 模式
	if h.broadcaster != nil {
		h.broadcaster.BroadcastEvent(eventName, payload)
	}
}
```

修改所有 Emit 方法使用新的 emit：

```go
func (h *EventHub) EmitGitChanged(event GitChangedEvent) {
	h.emit("git:changed", event)
}

func (h *EventHub) EmitProcessChanged(event ProcessChangedEvent) {
	h.emit("process:changed", event)
}

func (h *EventHub) EmitSessionChanged(event SessionChangedEvent) {
	h.emit("session:changed", event)
}

func (h *EventHub) EmitWorktreeChanged(event WorktreeChangedEvent) {
	h.emit("worktree:changed", event)
}
```

**Step 2: 验证编译**

Run: `go build ./internal/eventhub/...`
Expected: 无错误

**Step 3: Commit**

```bash
git add internal/eventhub/hub.go
git commit -m "feat(eventhub): add WebSocket broadcaster support"
```

---

### Task 7: 添加更多事件发送方法到 EventHub

**Files:**
- Modify: `internal/eventhub/hub.go`

**Step 1: 添加 Claude/PTY 相关事件方法**

```go
// Claude 输出事件
func (h *EventHub) EmitClaudeOutput(sessionID string, output interface{}) {
	h.emit("claude-output", map[string]interface{}{
		"session_id": sessionID,
		"output":     output,
	})
}

// Claude 错误事件
func (h *EventHub) EmitClaudeError(sessionID string, err string) {
	h.emit("claude-error", map[string]interface{}{
		"session_id": sessionID,
		"error":      err,
	})
}

// Claude 完成事件
func (h *EventHub) EmitClaudeComplete(sessionID string, result interface{}) {
	h.emit("claude-complete", map[string]interface{}{
		"session_id": sessionID,
		"result":     result,
	})
}

// PTY 输出事件
func (h *EventHub) EmitPtyOutput(sessionID string, data string) {
	h.emit("pty-output", map[string]interface{}{
		"session_id": sessionID,
		"data":       data,
	})
}

// 文件拖放事件
func (h *EventHub) EmitFileDrop(paths []string) {
	h.emit("file-drop", paths)
}
```

**Step 2: 验证编译**

Run: `go build ./internal/eventhub/...`
Expected: 无错误

**Step 3: Commit**

```bash
git add internal/eventhub/hub.go
git commit -m "feat(eventhub): add Claude and PTY event methods"
```

---

### Task 8: 创建独立服务入口点

**Files:**
- Create: `cmd/server/main.go`

**Step 1: 创建目录和文件**

```go
// cmd/server/main.go
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"ropcode/internal/websocket"
)

func main() {
	// 检查运行模式
	mode := os.Getenv("ROPCODE_MODE")
	if mode != "websocket" {
		fmt.Println("Error: ROPCODE_MODE must be 'websocket'")
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 创建 App 实例（复用现有的 App）
	app := NewApp()
	app.startup(ctx)

	// 创建并启动 WebSocket 服务器
	wsServer := websocket.NewServer(app)

	// 将 WebSocket 服务器设置为事件广播器
	app.eventHub.SetBroadcaster(wsServer)

	port, err := wsServer.Start(ctx)
	if err != nil {
		fmt.Printf("Failed to start WebSocket server: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("ROPCODE_WS_READY:port=%d\n", port)

	// 等待退出信号
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	fmt.Println("Shutting down...")
	wsServer.Stop(ctx)
	app.shutdown(ctx)
}
```

**注意**: 这需要将 `app.go` 中的 App 结构体和相关方法移到可导出的位置，或者在 `cmd/server` 中复用。

**Step 2: 调整构建方式**

由于 `cmd/server/main.go` 需要访问 `App`，有两种方案：

**方案 A**: 在同一个 main 包中构建（简单）
- 将 `cmd/server/main.go` 改为在根目录创建 `server.go`
- 通过 build tag 区分

**方案 B**: 将 App 逻辑移到 internal 包（更清晰）
- 创建 `internal/app/app.go`
- 主包和 cmd/server 都引用它

**推荐方案 A**，在根目录创建：

```go
// server.go
//go:build server

package main

// ... 上面的代码
```

构建时：
```bash
go build -tags server -o bin/ropcode-server ./...
```

**Step 3: Commit**

```bash
git add cmd/server/main.go  # 或 server.go
git commit -m "feat: add standalone WebSocket server entry point"
```

---

## 阶段二：前端适配层

### Task 9: 创建 WebSocket RPC 客户端

**Files:**
- Create: `frontend/src/lib/ws-rpc-client.ts`

**Step 1: 创建 WebSocket RPC 客户端**

```typescript
// frontend/src/lib/ws-rpc-client.ts

export interface RPCRequest {
  id: string;
  method: string;
  params: any[];
}

export interface RPCResponse {
  id: string;
  result?: any;
  error?: string;
}

export interface WSEvent {
  type: string;
  payload: any;
}

export interface WSMessage {
  kind: 'rpc_request' | 'rpc_response' | 'event';
  request?: RPCRequest;
  response?: RPCResponse;
  event?: WSEvent;
}

type EventHandler = (payload: any) => void;

class WSRpcClient {
  private ws: WebSocket | null = null;
  private pending: Map<string, { resolve: (value: any) => void; reject: (reason: any) => void }> = new Map();
  private eventListeners: Map<string, Set<EventHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private wsUrl: string = '';
  private authKey: string = '';

  /**
   * 初始化连接
   */
  async connect(port: number, authKey?: string): Promise<void> {
    this.wsUrl = `ws://127.0.0.1:${port}/ws`;
    this.authKey = authKey || '';
    return this.doConnect();
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          console.log('[WSRpc] Connected');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = () => {
          console.log('[WSRpc] Disconnected');
          this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('[WSRpc] Error:', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WSRpc] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[WSRpc] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.doConnect().catch(console.error);
    }, delay);
  }

  private handleMessage(data: string) {
    try {
      const msg: WSMessage = JSON.parse(data);

      if (msg.kind === 'rpc_response' && msg.response) {
        const { id, result, error } = msg.response;
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          if (error) {
            pending.reject(new Error(error));
          } else {
            pending.resolve(result);
          }
        }
      } else if (msg.kind === 'event' && msg.event) {
        const { type, payload } = msg.event;
        const listeners = this.eventListeners.get(type);
        if (listeners) {
          listeners.forEach((handler) => {
            try {
              handler(payload);
            } catch (e) {
              console.error(`[WSRpc] Event handler error for ${type}:`, e);
            }
          });
        }
      }
    } catch (e) {
      console.error('[WSRpc] Failed to parse message:', e);
    }
  }

  /**
   * 发送 RPC 调用
   */
  async call<T = any>(method: string, ...params: any[]): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const id = crypto.randomUUID();
    const request: WSMessage = {
      kind: 'rpc_request',
      request: { id, method, params },
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      // 设置超时
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`RPC call ${method} timed out`));
        }
      }, 30000);

      this.ws!.send(JSON.stringify(request));
    });
  }

  /**
   * 监听事件
   */
  on(eventType: string, handler: EventHandler): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(handler);

    // 返回取消监听函数
    return () => {
      this.eventListeners.get(eventType)?.delete(handler);
    };
  }

  /**
   * 移除事件监听
   */
  off(eventType: string, handler?: EventHandler) {
    if (handler) {
      this.eventListeners.get(eventType)?.delete(handler);
    } else {
      this.eventListeners.delete(eventType);
    }
  }

  /**
   * 关闭连接
   */
  close() {
    this.maxReconnectAttempts = 0; // 防止重连
    this.ws?.close();
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// 单例导出
export const wsClient = new WSRpcClient();
```

**Step 2: 验证 TypeScript 编译**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误（或只有无关的现有错误）

**Step 3: Commit**

```bash
git add frontend/src/lib/ws-rpc-client.ts
git commit -m "feat(frontend): add WebSocket RPC client"
```

---

### Task 10: 创建 Wails API 兼容层

**Files:**
- Create: `frontend/src/lib/wails-compat.ts`

**Step 1: 创建兼容层文件**

```typescript
// frontend/src/lib/wails-compat.ts
/**
 * Wails API 兼容层
 *
 * 提供与 wailsjs/go/main/App 相同的接口，
 * 内部通过 WebSocket RPC 调用后端。
 */

import { wsClient } from './ws-rpc-client';

// ============ PTY 管理 ============

export function CreatePtySession(
  sessionId: string,
  cwd: string,
  rows: number,
  cols: number,
  shell: string = ''
) {
  return wsClient.call('CreatePtySession', sessionId, cwd, rows, cols, shell);
}

export function WriteToPty(sessionId: string, data: string) {
  return wsClient.call('WriteToPty', sessionId, data);
}

export function ResizePty(sessionId: string, rows: number, cols: number) {
  return wsClient.call('ResizePty', sessionId, rows, cols);
}

export function ClosePtySession(sessionId: string) {
  return wsClient.call('ClosePtySession', sessionId);
}

export function ListPtySessions() {
  return wsClient.call<string[]>('ListPtySessions');
}

export function IsPtySessionAlive(id: string) {
  return wsClient.call<boolean>('IsPtySessionAlive', id);
}

// ============ 进程管理 ============

export function SpawnProcess(
  key: string,
  command: string,
  args: string[],
  cwd: string,
  env: string[]
) {
  return wsClient.call('SpawnProcess', key, command, args, cwd, env);
}

export function KillProcess(key: string) {
  return wsClient.call('KillProcess', key);
}

export function IsProcessAlive(key: string) {
  return wsClient.call<boolean>('IsProcessAlive', key);
}

export function ListProcesses() {
  return wsClient.call<string[]>('ListProcesses');
}

// ============ 窗口控制 ============

export function ToggleFullscreen() {
  return wsClient.call('ToggleFullscreen');
}

export function IsFullscreen() {
  return wsClient.call<boolean>('IsFullscreen');
}

// ============ 配置管理 ============

export function SaveSetting(key: string, value: string) {
  return wsClient.call('SaveSetting', key, value);
}

export function GetSetting(key: string) {
  return wsClient.call<string>('GetSetting', key);
}

export function GetConfig() {
  return wsClient.call<Record<string, string>>('GetConfig');
}

export function GetHomeDirectory() {
  return wsClient.call<string>('GetHomeDirectory');
}

// ============ Provider API 配置 ============

export function SaveProviderApiConfig(config: any) {
  return wsClient.call('SaveProviderApiConfig', config);
}

export function GetProviderApiConfig(id: string) {
  return wsClient.call('GetProviderApiConfig', id);
}

export function GetAllProviderApiConfigs() {
  return wsClient.call('GetAllProviderApiConfigs');
}

export function DeleteProviderApiConfig(id: string) {
  return wsClient.call('DeleteProviderApiConfig', id);
}

export function CreateProviderApiConfig(config: any) {
  return wsClient.call('CreateProviderApiConfig', config);
}

export function UpdateProviderApiConfig(id: string, updates: any) {
  return wsClient.call('UpdateProviderApiConfig', id, updates);
}

export function GetProjectProviderApiConfig(projectPath: string, providerName: string) {
  return wsClient.call('GetProjectProviderApiConfig', projectPath, providerName);
}

export function SetProjectProviderApiConfig(projectPath: string, providerName: string, config: any) {
  return wsClient.call('SetProjectProviderApiConfig', projectPath, providerName, config);
}

// ============ 项目管理 ============

export function ListProjects() {
  return wsClient.call('ListProjects');
}

export function AddProjectToIndex(path: string) {
  return wsClient.call('AddProjectToIndex', path);
}

export function RemoveProjectFromIndex(id: string) {
  return wsClient.call('RemoveProjectFromIndex', id);
}

export function UpdateProjectAccessTime(id: string) {
  return wsClient.call('UpdateProjectAccessTime', id);
}

export function UpdateProjectFields(path: string, updates: any) {
  return wsClient.call('UpdateProjectFields', path, updates);
}

export function UpdateWorkspaceFields(path: string, updates: any) {
  return wsClient.call('UpdateWorkspaceFields', path, updates);
}

export function CreateProject(path: string) {
  return wsClient.call('CreateProject', path);
}

export function CreateWorkspace(parent: string, branch: string, name: string) {
  return wsClient.call('CreateWorkspace', parent, branch, name);
}

export function RemoveWorkspace(id: string) {
  return wsClient.call('RemoveWorkspace', id);
}

export function AddProviderToProject(path: string, provider: string) {
  return wsClient.call('AddProviderToProject', path, provider);
}

export function UpdateProjectLastProvider(path: string, provider: string) {
  return wsClient.call('UpdateProjectLastProvider', path, provider);
}

export function UpdateWorkspaceLastProvider(path: string, provider: string) {
  return wsClient.call('UpdateWorkspaceLastProvider', path, provider);
}

export function UpdateProviderSession(path: string, provider: string, session: string) {
  return wsClient.call('UpdateProviderSession', path, provider, session);
}

// ============ Claude 会话 ============

export function ExecuteClaudeCode(
  projectPath: string,
  prompt: string,
  model: string,
  sessionId: string,
  providerApiId: string
) {
  return wsClient.call('ExecuteClaudeCode', projectPath, prompt, model, sessionId, providerApiId);
}

export function StartProviderSession(
  provider: string,
  projectPath: string,
  prompt: string,
  model: string,
  providerApiId: string
) {
  return wsClient.call('StartProviderSession', provider, projectPath, prompt, model, providerApiId);
}

export function ResumeProviderSession(
  provider: string,
  projectPath: string,
  prompt: string,
  model: string,
  sessionId: string,
  providerApiId: string
) {
  return wsClient.call('ResumeProviderSession', provider, projectPath, prompt, model, sessionId, providerApiId);
}

export function ResumeClaudeCode(
  projectPath: string,
  prompt: string,
  model: string,
  sessionId: string,
  providerApiId: string
) {
  return wsClient.call('ResumeClaudeCode', projectPath, prompt, model, sessionId, providerApiId);
}

export function ContinueClaudeCode(
  projectPath: string,
  prompt: string,
  model: string,
  sessionId: string,
  providerApiId: string
) {
  return wsClient.call('ContinueClaudeCode', projectPath, prompt, model, sessionId, providerApiId);
}

export function CancelClaudeExecution(sessionId: string) {
  return wsClient.call('CancelClaudeExecution', sessionId);
}

export function CancelClaudeExecutionByProject(projectPath: string) {
  return wsClient.call('CancelClaudeExecutionByProject', projectPath);
}

export function IsClaudeSessionRunning(sessionId: string) {
  return wsClient.call<boolean>('IsClaudeSessionRunning', sessionId);
}

export function IsClaudeSessionRunningForProject(projectPath: string, provider: string) {
  return wsClient.call<boolean>('IsClaudeSessionRunningForProject', projectPath, provider);
}

export function ListRunningClaudeSessions() {
  return wsClient.call('ListRunningClaudeSessions');
}

export function GetClaudeSessionOutput(sessionId: string) {
  return wsClient.call<string>('GetClaudeSessionOutput', sessionId);
}

export function ListProviderSessions(projectPath: string, provider: string) {
  return wsClient.call('ListProviderSessions', projectPath, provider);
}

export function LoadProviderSessionHistory(sessionId: string, projectId: string, provider: string) {
  return wsClient.call('LoadProviderSessionHistory', sessionId, projectId, provider);
}

export function OpenNewSession(path: string) {
  return wsClient.call<string>('OpenNewSession', path);
}

// ============ Claude 设置 ============

export function GetClaudeSettings() {
  return wsClient.call('GetClaudeSettings');
}

export function SaveClaudeSettings(settings: any) {
  return wsClient.call('SaveClaudeSettings', settings);
}

export function GetSystemPrompt() {
  return wsClient.call<string>('GetSystemPrompt');
}

export function SaveSystemPrompt(content: string) {
  return wsClient.call('SaveSystemPrompt', content);
}

export function GetProviderSystemPrompt(provider: string) {
  return wsClient.call<string>('GetProviderSystemPrompt', provider);
}

export function SaveProviderSystemPrompt(provider: string, content: string) {
  return wsClient.call<string>('SaveProviderSystemPrompt', provider, content);
}

export function GetClaudeBinaryPath() {
  return wsClient.call<string>('GetClaudeBinaryPath');
}

export function SetClaudeBinaryPath(path: string) {
  return wsClient.call('SetClaudeBinaryPath', path);
}

export function CheckClaudeVersion() {
  return wsClient.call('CheckClaudeVersion');
}

export function ListClaudeInstallations() {
  return wsClient.call('ListClaudeInstallations');
}

// ============ Claude MD 文件 ============

export function FindClaudeMdFiles(projectPath: string) {
  return wsClient.call('FindClaudeMdFiles', projectPath);
}

export function ReadClaudeMdFile(path: string) {
  return wsClient.call<string>('ReadClaudeMdFile', path);
}

export function SaveClaudeMdFile(path: string, content: string) {
  return wsClient.call('SaveClaudeMdFile', path, content);
}

// ============ Git 操作 ============

export function GetGitStatus(path: string) {
  return wsClient.call('GetGitStatus', path);
}

export function GetCurrentBranch(path: string) {
  return wsClient.call<string>('GetCurrentBranch', path);
}

export function GetGitDiff(path: string, cached: boolean) {
  return wsClient.call<string>('GetGitDiff', path, cached);
}

export function IsGitRepository(path: string) {
  return wsClient.call<boolean>('IsGitRepository', path);
}

export function DetectWorktree(path: string) {
  return wsClient.call('DetectWorktree', path);
}

export function PushToMainWorktree(path: string) {
  return wsClient.call<string>('PushToMainWorktree', path);
}

export function GetUnpushedCommitsCount(path: string) {
  return wsClient.call<number>('GetUnpushedCommitsCount', path);
}

export function PushToRemote(path: string) {
  return wsClient.call<string>('PushToRemote', path);
}

export function GetUnpushedToRemoteCount(path: string) {
  return wsClient.call<number>('GetUnpushedToRemoteCount', path);
}

export function CheckWorkspaceClean(path: string) {
  return wsClient.call('CheckWorkspaceClean', path);
}

export function CleanupWorkspace(path: string) {
  return wsClient.call<string>('CleanupWorkspace', path);
}

export function InitLocalGit(path: string, commitAll: boolean) {
  return wsClient.call('InitLocalGit', path, commitAll);
}

export function UpdateWorkspaceBranch(path: string, branch: string) {
  return wsClient.call('UpdateWorkspaceBranch', path, branch);
}

export function WatchGitWorkspace(workspacePath: string) {
  return wsClient.call('WatchGitWorkspace', workspacePath);
}

export function UnwatchGitWorkspace(workspacePath: string) {
  return wsClient.call('UnwatchGitWorkspace', workspacePath);
}

export function NotifyBranchRenamed(path: string, branch: string) {
  return wsClient.call('NotifyBranchRenamed', path, branch);
}

export function CloneRepository(repoUrl: string, destPath: string, branch: string) {
  return wsClient.call('CloneRepository', repoUrl, destPath, branch);
}

// ============ 文件操作 ============

export function ListDirectoryContents(path: string) {
  return wsClient.call('ListDirectoryContents', path);
}

export function ReadFile(path: string) {
  return wsClient.call<string>('ReadFile', path);
}

export function WriteFile(path: string, content: string) {
  return wsClient.call('WriteFile', path, content);
}

export function SearchFiles(basePath: string, query: string) {
  return wsClient.call('SearchFiles', basePath, query);
}

export function SavePastedImage(base64Data: string, filename: string) {
  return wsClient.call<string>('SavePastedImage', base64Data, filename);
}

// ============ 命令执行 ============

export function ExecuteCommand(command: string, cwd: string) {
  return wsClient.call('ExecuteCommand', command, cwd);
}

export function ExecuteCommandWithArgs(command: string, args: string[], cwd: string) {
  return wsClient.call<string>('ExecuteCommandWithArgs', command, args, cwd);
}

export function ExecuteCommandAsync(command: string, args: string[], cwd: string) {
  return wsClient.call<string>('ExecuteCommandAsync', command, args, cwd);
}

export function KillCommand(id: string) {
  return wsClient.call('KillCommand', id);
}

// ============ 外部应用 ============

export function OpenInTerminal(path: string) {
  return wsClient.call('OpenInTerminal', path);
}

export function OpenInEditor(path: string) {
  return wsClient.call('OpenInEditor', path);
}

export function OpenUrl(url: string) {
  return wsClient.call('OpenUrl', url);
}

export function OpenInExternalApp(appType: string, path: string) {
  return wsClient.call('OpenInExternalApp', appType, path);
}

// ============ Model 配置 ============

export function GetAllModelConfigs() {
  return wsClient.call('GetAllModelConfigs');
}

export function GetEnabledModelConfigs() {
  return wsClient.call('GetEnabledModelConfigs');
}

export function GetModelConfigsByProvider(providerId: string) {
  return wsClient.call('GetModelConfigsByProvider', providerId);
}

export function GetModelConfig(id: string) {
  return wsClient.call('GetModelConfig', id);
}

export function GetModelConfigByModelID(modelId: string) {
  return wsClient.call('GetModelConfigByModelID', modelId);
}

export function GetDefaultModelConfig(providerId: string) {
  return wsClient.call('GetDefaultModelConfig', providerId);
}

export function CreateModelConfig(config: any) {
  return wsClient.call('CreateModelConfig', config);
}

export function UpdateModelConfig(id: string, config: any) {
  return wsClient.call('UpdateModelConfig', id, config);
}

export function DeleteModelConfig(id: string) {
  return wsClient.call('DeleteModelConfig', id);
}

export function SetModelConfigEnabled(id: string, enabled: boolean) {
  return wsClient.call('SetModelConfigEnabled', id, enabled);
}

export function SetModelConfigDefault(id: string) {
  return wsClient.call('SetModelConfigDefault', id);
}

export function GetModelThinkingLevels(modelId: string) {
  return wsClient.call('GetModelThinkingLevels', modelId);
}

export function GetDefaultThinkingLevel(modelId: string) {
  return wsClient.call('GetDefaultThinkingLevel', modelId);
}

// ============ Agent 管理 ============

export function ListAgents() {
  return wsClient.call('ListAgents');
}

export function GetAgent(id: number) {
  return wsClient.call('GetAgent', id);
}

export function CreateAgent(
  name: string,
  icon: string,
  systemPrompt: string,
  defaultTask: string,
  model: string,
  providerApiId: string,
  hooks: any
) {
  return wsClient.call<number>('CreateAgent', name, icon, systemPrompt, defaultTask, model, providerApiId, hooks);
}

export function UpdateAgent(
  id: number,
  name: string,
  icon: string,
  systemPrompt: string,
  defaultTask: string,
  model: string,
  providerApiId: string,
  hooks: any
) {
  return wsClient.call('UpdateAgent', id, name, icon, systemPrompt, defaultTask, model, providerApiId, hooks);
}

export function DeleteAgent(id: number) {
  return wsClient.call('DeleteAgent', id);
}

export function ExportAgent(id: number) {
  return wsClient.call<string>('ExportAgent', id);
}

export function ExportAgentToFile(id: number, path: string) {
  return wsClient.call('ExportAgentToFile', id, path);
}

export function ImportAgent(data: string) {
  return wsClient.call('ImportAgent', data);
}

export function ImportAgentFromFile(path: string) {
  return wsClient.call('ImportAgentFromFile', path);
}

export function ExecuteAgent(agentId: number, projectPath: string, task: string, model: string) {
  return wsClient.call('ExecuteAgent', agentId, projectPath, task, model);
}

export function ListAgentRuns(agentId: number, limit: number) {
  return wsClient.call('ListAgentRuns', agentId, limit);
}

export function GetAgentRun(id: number) {
  return wsClient.call('GetAgentRun', id);
}

export function GetAgentRunBySessionID(sessionId: string) {
  return wsClient.call('GetAgentRunBySessionID', sessionId);
}

export function ListRunningAgentRuns() {
  return wsClient.call('ListRunningAgentRuns');
}

export function CancelAgentRun(runId: number) {
  return wsClient.call('CancelAgentRun', runId);
}

export function DeleteAgentRun(id: number) {
  return wsClient.call('DeleteAgentRun', id);
}

export function GetAgentRunOutput(runId: number) {
  return wsClient.call<string>('GetAgentRunOutput', runId);
}

export function LoadAgentSessionHistory(sessionId: string) {
  return wsClient.call('LoadAgentSessionHistory', sessionId);
}

export function ListClaudeAgents() {
  return wsClient.call('ListClaudeAgents');
}

export function SearchClaudeAgents(query: string) {
  return wsClient.call('SearchClaudeAgents', query);
}

export function FetchGitHubAgents() {
  return wsClient.call('FetchGitHubAgents');
}

export function FetchGitHubAgentContent(url: string) {
  return wsClient.call('FetchGitHubAgentContent', url);
}

export function ImportAgentFromGitHub(url: string) {
  return wsClient.call('ImportAgentFromGitHub', url);
}

// ============ Claude Config Agents ============

export function ListClaudeConfigAgents(projectPath: string) {
  return wsClient.call('ListClaudeConfigAgents', projectPath);
}

export function GetClaudeConfigAgent(scope: string, name: string, projectPath: string) {
  return wsClient.call('GetClaudeConfigAgent', scope, name, projectPath);
}

export function SaveClaudeConfigAgent(agent: any, projectPath: string) {
  return wsClient.call('SaveClaudeConfigAgent', agent, projectPath);
}

export function DeleteClaudeConfigAgent(scope: string, name: string, projectPath: string) {
  return wsClient.call('DeleteClaudeConfigAgent', scope, name, projectPath);
}

// ============ Slash Commands ============

export function ListSlashCommands(projectPath: string) {
  return wsClient.call('ListSlashCommands', projectPath);
}

export function GetSlashCommand(name: string, projectPath: string) {
  return wsClient.call('GetSlashCommand', name, projectPath);
}

export function SaveSlashCommand(name: string, content: string, scope: string, projectPath: string) {
  return wsClient.call('SaveSlashCommand', name, content, scope, projectPath);
}

export function DeleteSlashCommand(name: string, scope: string, projectPath: string) {
  return wsClient.call('DeleteSlashCommand', name, scope, projectPath);
}

// ============ Skills ============

export function SkillsList(projectPath: string) {
  return wsClient.call('SkillsList', projectPath);
}

export function SkillGet(id: string, projectPath: string) {
  return wsClient.call('SkillGet', id, projectPath);
}

// ============ Hooks ============

export function GetHooks() {
  return wsClient.call('GetHooks');
}

export function SaveHooks(hooks: any) {
  return wsClient.call('SaveHooks', hooks);
}

export function GetHooksByType(hookType: string) {
  return wsClient.call('GetHooksByType', hookType);
}

export function ValidateHookCommand(cmd: string) {
  return wsClient.call('ValidateHookCommand', cmd);
}

export function GetMergedHooksConfig(projectPath: string) {
  return wsClient.call('GetMergedHooksConfig', projectPath);
}

// ============ MCP ============

export function ListMcpServers() {
  return wsClient.call('ListMcpServers');
}

export function GetMcpServer(name: string) {
  return wsClient.call('GetMcpServer', name);
}

export function SaveMcpServer(name: string, config: any) {
  return wsClient.call('SaveMcpServer', name, config);
}

export function DeleteMcpServer(name: string) {
  return wsClient.call('DeleteMcpServer', name);
}

export function GetMcpServerStatus(name: string) {
  return wsClient.call('GetMcpServerStatus', name);
}

export function McpAdd(name: string, command: string, args: string[], env: Record<string, string>, scope: string) {
  return wsClient.call('McpAdd', name, command, args, env, scope);
}

export function McpAddJson(name: string, configJson: string) {
  return wsClient.call('McpAddJson', name, configJson);
}

export function McpAddFromClaudeDesktop(scope: string) {
  return wsClient.call('McpAddFromClaudeDesktop', scope);
}

export function McpServe() {
  return wsClient.call<string>('McpServe');
}

export function McpTestConnection(name: string) {
  return wsClient.call<string>('McpTestConnection', name);
}

export function McpResetProjectChoices() {
  return wsClient.call<string>('McpResetProjectChoices');
}

export function McpReadProjectConfig(projectPath: string) {
  return wsClient.call('McpReadProjectConfig', projectPath);
}

export function McpSaveProjectConfig(projectPath: string, config: any) {
  return wsClient.call<string>('McpSaveProjectConfig', projectPath, config);
}

// ============ Actions ============

export function GetActions(projectPath: string, workspacePath: string) {
  return wsClient.call('GetActions', projectPath, workspacePath);
}

export function UpdateProjectActions(projectPath: string, actions: any[]) {
  return wsClient.call('UpdateProjectActions', projectPath, actions);
}

export function UpdateWorkspaceActions(workspacePath: string, actions: any[]) {
  return wsClient.call('UpdateWorkspaceActions', workspacePath, actions);
}

export function GetGlobalActions() {
  return wsClient.call('GetGlobalActions');
}

export function UpdateGlobalActions(actions: any[]) {
  return wsClient.call('UpdateGlobalActions', actions);
}

// ============ SSH ============

export function ListGlobalSshConnections() {
  return wsClient.call('ListGlobalSshConnections');
}

export function AddGlobalSshConnection(conn: any) {
  return wsClient.call('AddGlobalSshConnection', conn);
}

export function DeleteGlobalSshConnection(name: string) {
  return wsClient.call('DeleteGlobalSshConnection', name);
}

export function SyncFromSSH(localPath: string, remotePath: string, connectionName: string) {
  return wsClient.call('SyncFromSSH', localPath, remotePath, connectionName);
}

export function SyncToSSH(localPath: string, remotePath: string, connectionName: string) {
  return wsClient.call('SyncToSSH', localPath, remotePath, connectionName);
}

export function StartAutoSync(localPath: string, remotePath: string, connectionName: string) {
  return wsClient.call('StartAutoSync', localPath, remotePath, connectionName);
}

export function StopAutoSync(localPath: string) {
  return wsClient.call('StopAutoSync', localPath);
}

export function TestSshConnection(conn: any) {
  return wsClient.call('TestSshConnection', conn);
}

export function PauseSshSync(localPath: string) {
  return wsClient.call('PauseSshSync', localPath);
}

export function ResumeSshSync(localPath: string) {
  return wsClient.call('ResumeSshSync', localPath);
}

export function CancelSshSync(localPath: string) {
  return wsClient.call('CancelSshSync', localPath);
}

export function GetAutoSyncStatus(localPath: string) {
  return wsClient.call('GetAutoSyncStatus', localPath);
}

// ============ Plugin ============

export function ListInstalledPlugins() {
  return wsClient.call('ListInstalledPlugins');
}

export function GetPluginDetails(id: string) {
  return wsClient.call('GetPluginDetails', id);
}

export function GetPluginContents(id: string) {
  return wsClient.call('GetPluginContents', id);
}

export function ListPluginAgents(pluginId: string) {
  return wsClient.call('ListPluginAgents', pluginId);
}

export function ListPluginCommands(pluginId: string) {
  return wsClient.call('ListPluginCommands', pluginId);
}

export function ListPluginSkills(pluginId: string) {
  return wsClient.call('ListPluginSkills', pluginId);
}

export function ListPluginHooks(pluginId: string) {
  return wsClient.call('ListPluginHooks', pluginId);
}

export function GetPluginAgent(pluginId: string, agentName: string) {
  return wsClient.call('GetPluginAgent', pluginId, agentName);
}

export function GetPluginCommand(pluginId: string, commandName: string) {
  return wsClient.call('GetPluginCommand', pluginId, commandName);
}

export function GetPluginSkill(pluginId: string, skillName: string) {
  return wsClient.call('GetPluginSkill', pluginId, skillName);
}

// ============ Usage ============

export function GetUsageStats() {
  return wsClient.call('GetUsageStats');
}

export function GetUsageByDateRange(start: string, end: string) {
  return wsClient.call('GetUsageByDateRange', start, end);
}

export function GetUsageDetails(limit: number) {
  return wsClient.call('GetUsageDetails', limit);
}

export function GetSessionStats(sessionId: string, projectId: string) {
  return wsClient.call('GetSessionStats', sessionId, projectId);
}

// ============ Storage ============

export function StorageListTables() {
  return wsClient.call<string[]>('StorageListTables');
}

export function StorageReadTable(table: string, page: number, pageSize: number) {
  return wsClient.call('StorageReadTable', table, page, pageSize);
}

export function StorageInsertRow(table: string, data: any) {
  return wsClient.call<number>('StorageInsertRow', table, data);
}

export function StorageUpdateRow(table: string, id: number, data: any) {
  return wsClient.call('StorageUpdateRow', table, id, data);
}

export function StorageDeleteRow(table: string, id: number) {
  return wsClient.call('StorageDeleteRow', table, id);
}

export function StorageExecuteSql(sql: string) {
  return wsClient.call('StorageExecuteSql', sql);
}

export function StorageResetDatabase() {
  return wsClient.call('StorageResetDatabase');
}

// ============ 其他 ============

export function CleanupFinishedProcesses() {
  return wsClient.call<string[]>('CleanupFinishedProcesses');
}

export function GetProjectSessions(id: string) {
  return wsClient.call<string[]>('GetProjectSessions', id);
}

export function GetSessionMessageIndex(projectId: string, sessionId: string) {
  return wsClient.call<number[]>('GetSessionMessageIndex', projectId, sessionId);
}

export function GetSessionMessagesRange(projectId: string, sessionId: string, start: number, end: number) {
  return wsClient.call('GetSessionMessagesRange', projectId, sessionId, start, end);
}

export function StreamSessionOutput(projectId: string, sessionId: string) {
  return wsClient.call('StreamSessionOutput', projectId, sessionId);
}

export function LoadSessionHistory(sessionId: string, projectId: string) {
  return wsClient.call('LoadSessionHistory', sessionId, projectId);
}
```

**Step 2: 验证 TypeScript 编译**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

**Step 3: Commit**

```bash
git add frontend/src/lib/wails-compat.ts
git commit -m "feat(frontend): add Wails API compatibility layer (143 methods)"
```

---

### Task 11: 创建事件系统兼容层

**Files:**
- Create: `frontend/src/lib/wails-events-compat.ts`

**Step 1: 创建事件兼容层**

```typescript
// frontend/src/lib/wails-events-compat.ts
/**
 * Wails 事件系统兼容层
 *
 * 提供与 wailsjs/runtime/runtime 相同的事件 API，
 * 内部通过 WebSocket 接收后端事件。
 */

import { wsClient } from './ws-rpc-client';

export interface UnlistenFn {
  (): void;
}

/**
 * 监听事件
 */
export function EventsOn(eventName: string, handler: (data: any) => void): UnlistenFn {
  return wsClient.on(eventName, handler);
}

/**
 * 移除事件监听
 */
export function EventsOff(eventName: string, handler?: (data: any) => void): void {
  wsClient.off(eventName, handler);
}

/**
 * 监听事件一次
 */
export function EventsOnce(eventName: string, handler: (data: any) => void): UnlistenFn {
  const unlisten = wsClient.on(eventName, (data) => {
    unlisten();
    handler(data);
  });
  return unlisten;
}

/**
 * 发送事件（前端到前端，不经过后端）
 * 注意：这个在 WebSocket 模式下可能需要特殊处理
 */
export function EventsEmit(eventName: string, ...data: any[]): void {
  // 在纯 WebSocket 模式下，前端发送的事件可以通过自定义事件系统处理
  // 或者发送到后端再广播回来
  const event = new CustomEvent(eventName, { detail: data.length === 1 ? data[0] : data });
  window.dispatchEvent(event);
}

/**
 * Tauri 兼容的 listen 函数
 */
export async function listen<T = any>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  return Promise.resolve(EventsOn(event, handler));
}

/**
 * Tauri 兼容的 once 函数
 */
export async function once<T = any>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  return Promise.resolve(EventsOnce(event, handler));
}

/**
 * Tauri 兼容的 emit 函数
 */
export function emit(event: string, payload?: any): void {
  EventsEmit(event, payload);
}

/**
 * 解除指定事件的所有监听器
 */
export function unlisten(event: string): void {
  EventsOff(event);
}
```

**Step 2: 验证 TypeScript 编译**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

**Step 3: Commit**

```bash
git add frontend/src/lib/wails-events-compat.ts
git commit -m "feat(frontend): add Wails events compatibility layer"
```

---

### Task 12: 创建窗口控制兼容层

**Files:**
- Create: `frontend/src/lib/wails-window-compat.ts`

**Step 1: 创建窗口控制兼容层**

```typescript
// frontend/src/lib/wails-window-compat.ts
/**
 * Wails 窗口控制兼容层
 *
 * 在 Electron 模式下，这些函数需要通过 IPC 调用 Electron 主进程。
 * 暂时提供空实现或 console.warn。
 */

// 这些函数在 Electron 中需要通过 preload 脚本暴露的 API 调用
// 暂时提供占位实现

export function WindowMinimise(): void {
  window.electronAPI?.minimizeWindow?.();
}

export function WindowMaximise(): void {
  window.electronAPI?.maximizeWindow?.();
}

export function WindowUnmaximise(): void {
  window.electronAPI?.unmaximizeWindow?.();
}

export function WindowToggleMaximise(): void {
  window.electronAPI?.toggleMaximizeWindow?.();
}

export function WindowFullscreen(): void {
  window.electronAPI?.setFullscreen?.(true);
}

export function WindowUnfullscreen(): void {
  window.electronAPI?.setFullscreen?.(false);
}

export function WindowIsFullscreen(): Promise<boolean> {
  return window.electronAPI?.isFullscreen?.() ?? Promise.resolve(false);
}

export function WindowIsMaximised(): Promise<boolean> {
  return window.electronAPI?.isMaximized?.() ?? Promise.resolve(false);
}

export function WindowIsMinimised(): Promise<boolean> {
  return window.electronAPI?.isMinimized?.() ?? Promise.resolve(false);
}

export function WindowIsNormal(): Promise<boolean> {
  return window.electronAPI?.isNormal?.() ?? Promise.resolve(true);
}

export function WindowCenter(): void {
  window.electronAPI?.centerWindow?.();
}

export function WindowSetTitle(title: string): void {
  document.title = title;
  window.electronAPI?.setTitle?.(title);
}

export function WindowSetSize(width: number, height: number): void {
  window.electronAPI?.setSize?.(width, height);
}

export function WindowGetSize(): Promise<{ width: number; height: number }> {
  return window.electronAPI?.getSize?.() ?? Promise.resolve({ width: window.innerWidth, height: window.innerHeight });
}

export function WindowSetPosition(x: number, y: number): void {
  window.electronAPI?.setPosition?.(x, y);
}

export function WindowGetPosition(): Promise<{ x: number; y: number }> {
  return window.electronAPI?.getPosition?.() ?? Promise.resolve({ x: 0, y: 0 });
}

export function WindowSetMinSize(width: number, height: number): void {
  window.electronAPI?.setMinSize?.(width, height);
}

export function WindowSetMaxSize(width: number, height: number): void {
  window.electronAPI?.setMaxSize?.(width, height);
}

export function WindowHide(): void {
  window.electronAPI?.hideWindow?.();
}

export function WindowShow(): void {
  window.electronAPI?.showWindow?.();
}

export function WindowSetAlwaysOnTop(alwaysOnTop: boolean): void {
  window.electronAPI?.setAlwaysOnTop?.(alwaysOnTop);
}

export function WindowReload(): void {
  window.location.reload();
}

export function Quit(): void {
  window.electronAPI?.quit?.();
}

// 类型声明
declare global {
  interface Window {
    electronAPI?: {
      minimizeWindow?: () => void;
      maximizeWindow?: () => void;
      unmaximizeWindow?: () => void;
      toggleMaximizeWindow?: () => void;
      setFullscreen?: (fullscreen: boolean) => void;
      isFullscreen?: () => Promise<boolean>;
      isMaximized?: () => Promise<boolean>;
      isMinimized?: () => Promise<boolean>;
      isNormal?: () => Promise<boolean>;
      centerWindow?: () => void;
      setTitle?: (title: string) => void;
      setSize?: (width: number, height: number) => void;
      getSize?: () => Promise<{ width: number; height: number }>;
      setPosition?: (x: number, y: number) => void;
      getPosition?: () => Promise<{ x: number; y: number }>;
      setMinSize?: (width: number, height: number) => void;
      setMaxSize?: (width: number, height: number) => void;
      hideWindow?: () => void;
      showWindow?: () => void;
      setAlwaysOnTop?: (alwaysOnTop: boolean) => void;
      quit?: () => void;
    };
  }
}
```

**Step 2: 验证编译**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

**Step 3: Commit**

```bash
git add frontend/src/lib/wails-window-compat.ts
git commit -m "feat(frontend): add Wails window control compatibility layer"
```

---

## 阶段三：Electron 主进程

### Task 13: 初始化 Electron 项目

**Files:**
- Create: `electron/package.json`
- Create: `electron/tsconfig.json`

**Step 1: 创建 electron 目录和 package.json**

```json
{
  "name": "ropcode-electron",
  "version": "0.2.1",
  "description": "Ropcode Electron Shell",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc",
    "start": "electron .",
    "dev": "tsc && electron ."
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "electron": "^28.0.0",
    "typescript": "^5.3.0"
  }
}
```

**Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

**Step 3: 安装依赖**

Run: `cd electron && npm install`
Expected: 依赖安装成功

**Step 4: Commit**

```bash
git add electron/package.json electron/tsconfig.json
git commit -m "feat(electron): initialize Electron project structure"
```

---

### Task 14: 创建 Go 服务管理模块

**Files:**
- Create: `electron/src/go-server.ts`

**Step 1: 创建 go-server.ts**

```typescript
// electron/src/go-server.ts
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { randomUUID } from 'crypto';

let goProcess: ChildProcess | null = null;
let authKey: string = '';

export interface GoServerInfo {
  port: number;
  authKey: string;
}

export function getAuthKey(): string {
  return authKey;
}

export function startGoServer(): Promise<GoServerInfo> {
  return new Promise((resolve, reject) => {
    // 生成认证密钥
    authKey = randomUUID();

    // 确定 Go 二进制路径
    const isDev = !app.isPackaged;
    let goBinaryPath: string;

    if (isDev) {
      // 开发模式：从项目根目录查找
      goBinaryPath = path.join(__dirname, '..', '..', 'bin', 'ropcode-server');
    } else {
      // 生产模式：从 resources 目录查找
      const ext = process.platform === 'win32' ? '.exe' : '';
      goBinaryPath = path.join(process.resourcesPath, 'bin', `ropcode-server${ext}`);
    }

    console.log('[GoServer] Starting:', goBinaryPath);

    goProcess = spawn(goBinaryPath, [], {
      env: {
        ...process.env,
        ROPCODE_AUTH_KEY: authKey,
        ROPCODE_MODE: 'websocket',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;

    // 监听 stdout 获取端口号
    goProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      console.log('[GoServer stdout]', output);

      // 解析端口号
      const portMatch = output.match(/WS_PORT:(\d+)/);
      if (portMatch && !resolved) {
        resolved = true;
        const port = parseInt(portMatch[1], 10);
        console.log('[GoServer] Started on port:', port);
        resolve({ port, authKey });
      }
    });

    goProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[GoServer stderr]', data.toString());
    });

    goProcess.on('error', (err) => {
      console.error('[GoServer] Process error:', err);
      if (!resolved) {
        reject(err);
      }
    });

    goProcess.on('exit', (code, signal) => {
      console.log('[GoServer] Process exited:', { code, signal });
      goProcess = null;
      if (!resolved) {
        reject(new Error(`Go server exited with code ${code}`));
      }
    });

    // 超时处理
    setTimeout(() => {
      if (!resolved) {
        reject(new Error('Go server startup timeout'));
        stopGoServer();
      }
    }, 30000);
  });
}

export function stopGoServer(): void {
  if (goProcess) {
    console.log('[GoServer] Stopping...');
    goProcess.kill('SIGTERM');

    // 给进程时间优雅退出
    setTimeout(() => {
      if (goProcess) {
        goProcess.kill('SIGKILL');
        goProcess = null;
      }
    }, 5000);
  }
}

export function isGoServerRunning(): boolean {
  return goProcess !== null;
}
```

**Step 2: 验证编译**

Run: `cd electron && npx tsc --noEmit`
Expected: 无错误

**Step 3: Commit**

```bash
git add electron/src/go-server.ts
git commit -m "feat(electron): add Go server management module"
```

---

### Task 15: 创建 Electron 主进程

**Files:**
- Create: `electron/src/main.ts`

**Step 1: 创建 main.ts**

```typescript
// electron/src/main.ts
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { startGoServer, stopGoServer, getAuthKey, GoServerInfo } from './go-server';

let mainWindow: BrowserWindow | null = null;
let goServerInfo: GoServerInfo | null = null;

const isDev = !app.isPackaged;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 1100,
    minHeight: 700,
    frame: false, // 无边框，与 Wails 保持一致
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 10, y: 10 },
  });

  // 构建加载 URL
  let loadUrl: string;
  if (isDev) {
    // 开发模式：连接 Vite 开发服务器
    loadUrl = `http://localhost:5173?wsPort=${goServerInfo!.port}&authKey=${goServerInfo!.authKey}`;
  } else {
    // 生产模式：加载打包的前端
    loadUrl = `file://${path.join(__dirname, '..', 'frontend', 'index.html')}?wsPort=${goServerInfo!.port}&authKey=${goServerInfo!.authKey}`;
  }

  console.log('[Electron] Loading URL:', loadUrl);
  await mainWindow.loadURL(loadUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 注册 IPC 处理器
function registerIpcHandlers() {
  // 窗口控制
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => mainWindow?.maximize());
  ipcMain.handle('window:unmaximize', () => mainWindow?.unmaximize());
  ipcMain.handle('window:toggleMaximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle('window:setFullscreen', (_, fullscreen: boolean) => mainWindow?.setFullScreen(fullscreen));
  ipcMain.handle('window:isFullscreen', () => mainWindow?.isFullScreen());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());
  ipcMain.handle('window:isMinimized', () => mainWindow?.isMinimized());
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:hide', () => mainWindow?.hide());
  ipcMain.handle('window:show', () => mainWindow?.show());
  ipcMain.handle('window:center', () => mainWindow?.center());
  ipcMain.handle('window:setTitle', (_, title: string) => mainWindow?.setTitle(title));
  ipcMain.handle('window:setSize', (_, width: number, height: number) => mainWindow?.setSize(width, height));
  ipcMain.handle('window:getSize', () => mainWindow?.getSize());
  ipcMain.handle('window:setPosition', (_, x: number, y: number) => mainWindow?.setPosition(x, y));
  ipcMain.handle('window:getPosition', () => mainWindow?.getPosition());
  ipcMain.handle('window:setAlwaysOnTop', (_, flag: boolean) => mainWindow?.setAlwaysOnTop(flag));

  // 应用控制
  ipcMain.handle('app:quit', () => app.quit());
}

app.whenReady().then(async () => {
  try {
    console.log('[Electron] Starting Go server...');
    goServerInfo = await startGoServer();
    console.log('[Electron] Go server started:', goServerInfo);

    registerIpcHandlers();
    await createWindow();
  } catch (error) {
    console.error('[Electron] Failed to start:', error);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('[Electron] Stopping Go server...');
  stopGoServer();
});
```

**Step 2: 验证编译**

Run: `cd electron && npx tsc --noEmit`
Expected: 无错误

**Step 3: Commit**

```bash
git add electron/src/main.ts
git commit -m "feat(electron): add main process with window management"
```

---

### Task 16: 创建 Preload 脚本

**Files:**
- Create: `electron/src/preload.ts`

**Step 1: 创建 preload.ts**

```typescript
// electron/src/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  unmaximizeWindow: () => ipcRenderer.invoke('window:unmaximize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  setFullscreen: (fullscreen: boolean) => ipcRenderer.invoke('window:setFullscreen', fullscreen),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  isMinimized: () => ipcRenderer.invoke('window:isMinimized'),
  isNormal: async () => {
    const isMax = await ipcRenderer.invoke('window:isMaximized');
    const isMin = await ipcRenderer.invoke('window:isMinimized');
    const isFull = await ipcRenderer.invoke('window:isFullscreen');
    return !isMax && !isMin && !isFull;
  },
  closeWindow: () => ipcRenderer.invoke('window:close'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  showWindow: () => ipcRenderer.invoke('window:show'),
  centerWindow: () => ipcRenderer.invoke('window:center'),
  setTitle: (title: string) => ipcRenderer.invoke('window:setTitle', title),
  setSize: (width: number, height: number) => ipcRenderer.invoke('window:setSize', width, height),
  getSize: () => ipcRenderer.invoke('window:getSize'),
  setPosition: (x: number, y: number) => ipcRenderer.invoke('window:setPosition', x, y),
  getPosition: () => ipcRenderer.invoke('window:getPosition'),
  setMinSize: (width: number, height: number) => ipcRenderer.invoke('window:setMinSize', width, height),
  setMaxSize: (width: number, height: number) => ipcRenderer.invoke('window:setMaxSize', width, height),
  setAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),

  // 应用控制
  quit: () => ipcRenderer.invoke('app:quit'),
});
```

**Step 2: 验证编译**

Run: `cd electron && npx tsc --noEmit`
Expected: 无错误

**Step 3: Commit**

```bash
git add electron/src/preload.ts
git commit -m "feat(electron): add preload script for secure IPC"
```

---

## 阶段四：Import 替换

### Task 17: 创建 Import 替换脚本

**Files:**
- Create: `scripts/migrate-imports.sh`

**Step 1: 创建替换脚本**

```bash
#!/bin/bash
# scripts/migrate-imports.sh
# 将 wailsjs 导入替换为兼容层

FRONTEND_SRC="frontend/src"

echo "Migrating wailsjs imports to compatibility layer..."

# 替换 wailsjs/go/main/App 导入
find "$FRONTEND_SRC" -name "*.ts" -o -name "*.tsx" | xargs sed -i '' \
  "s|from ['\"].*wailsjs/go/main/App['\"]|from '@/lib/wails-compat'|g"

# 替换 wailsjs/runtime/runtime 导入（EventsOn, EventsOff 等）
find "$FRONTEND_SRC" -name "*.ts" -o -name "*.tsx" | xargs sed -i '' \
  "s|from ['\"].*wailsjs/runtime/runtime['\"]|from '@/lib/wails-events-compat'|g"

# 特殊处理：wails-api.ts 和 wails-events.ts 本身不需要替换
# 这些文件保留作为 Wails 模式的实现

echo "Done! Please review the changes."
echo "Files modified:"
git status --porcelain | grep "^ M"
```

**Step 2: 设置执行权限**

Run: `chmod +x scripts/migrate-imports.sh`

**Step 3: Commit**

```bash
git add scripts/migrate-imports.sh
git commit -m "feat(scripts): add import migration script"
```

---

### Task 18: 修改 App.tsx 初始化 WebSocket 连接

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: 添加 WebSocket 初始化逻辑**

在 App.tsx 顶部添加初始化代码：

```typescript
import { wsClient } from '@/lib/ws-rpc-client';

// 从 URL 参数获取 WebSocket 配置
const urlParams = new URLSearchParams(window.location.search);
const wsPort = urlParams.get('wsPort');
const authKey = urlParams.get('authKey');

// 初始化 WebSocket 连接
if (wsPort) {
  wsClient.connect(parseInt(wsPort, 10), authKey || undefined)
    .then(() => console.log('[App] WebSocket connected'))
    .catch((err) => console.error('[App] WebSocket connection failed:', err));
}
```

**Step 2: 验证编译**

Run: `cd frontend && npm run build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): add WebSocket initialization in App.tsx"
```

---

## 阶段五：打包配置

### Task 19: 创建 electron-builder 配置

**Files:**
- Create: `electron-builder.yml`

**Step 1: 创建配置文件**

```yaml
# electron-builder.yml
appId: com.ropcode.app
productName: Ropcode
copyright: Copyright © 2024

directories:
  output: release
  buildResources: assets

files:
  - electron/dist/**/*
  - frontend/dist/**/*
  - "!**/*.map"

extraResources:
  - from: bin/${os}/${arch}/ropcode-server${ext}
    to: bin/ropcode-server${ext}
    filter:
      - "**/*"

mac:
  target:
    - target: dmg
      arch: [arm64, x64]
    - target: zip
      arch: [arm64, x64]
  icon: assets/icon.icns
  category: public.app-category.developer-tools
  darkModeSupport: true
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: entitlements.mac.plist
  entitlementsInherit: entitlements.mac.plist

dmg:
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications

win:
  target:
    - target: nsis
      arch: [x64]
  icon: assets/icon.ico

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true

linux:
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
  icon: assets/icon.png
  category: Development
```

**Step 2: Commit**

```bash
git add electron-builder.yml
git commit -m "feat: add electron-builder configuration"
```

---

### Task 20: 创建构建脚本

**Files:**
- Create: `scripts/build-electron.sh`

**Step 1: 创建构建脚本**

```bash
#!/bin/bash
# scripts/build-electron.sh
# 完整的 Electron 构建流程

set -e

echo "=== Ropcode Electron Build ==="

# 1. 构建 Go 服务器
echo "Building Go server..."
mkdir -p bin/darwin/arm64 bin/darwin/x64 bin/linux/x64 bin/win32/x64

if [[ "$OSTYPE" == "darwin"* ]]; then
  GOOS=darwin GOARCH=arm64 go build -o bin/darwin/arm64/ropcode-server ./cmd/server
  GOOS=darwin GOARCH=amd64 go build -o bin/darwin/x64/ropcode-server ./cmd/server
elif [[ "$OSTYPE" == "linux"* ]]; then
  GOOS=linux GOARCH=amd64 go build -o bin/linux/x64/ropcode-server ./cmd/server
fi

# 跨平台编译 Windows（可选）
# GOOS=windows GOARCH=amd64 go build -o bin/win32/x64/ropcode-server.exe ./cmd/server

echo "Go server built."

# 2. 构建前端
echo "Building frontend..."
cd frontend
npm ci
npm run build
cd ..
echo "Frontend built."

# 3. 构建 Electron
echo "Building Electron..."
cd electron
npm ci
npm run build
cd ..
echo "Electron built."

# 4. 复制前端到 Electron
echo "Copying frontend to Electron..."
mkdir -p electron/dist/frontend
cp -r frontend/dist/* electron/dist/frontend/
echo "Frontend copied."

# 5. 打包
echo "Packaging with electron-builder..."
npx electron-builder --config electron-builder.yml

echo "=== Build Complete ==="
```

**Step 2: 设置执行权限**

Run: `chmod +x scripts/build-electron.sh`

**Step 3: Commit**

```bash
git add scripts/build-electron.sh
git commit -m "feat(scripts): add Electron build script"
```

---

## 验证检查清单

### Task 21: 端到端验证

**Step 1: 构建 Go 服务器**

```bash
ROPCODE_MODE=websocket go run ./cmd/server
```

Expected: 输出 `WS_PORT:xxxxx`

**Step 2: 测试 WebSocket 连接**

```bash
# 使用 websocat 或类似工具
websocat ws://127.0.0.1:<PORT>/ws
```

**Step 3: 前端开发模式测试**

```bash
cd frontend && npm run dev
# 浏览器访问 http://localhost:5173?wsPort=<PORT>
```

**Step 4: Electron 开发模式测试**

```bash
cd electron && npm run dev
```

**Step 5: 完整构建测试**

```bash
./scripts/build-electron.sh
```

---

## 总结

| 阶段 | 任务数 | 新增文件 | 修改文件 |
|------|--------|----------|----------|
| Go WebSocket | 8 | 5 | 2 |
| 前端适配层 | 4 | 4 | 1 |
| Electron | 4 | 4 | 0 |
| Import 替换 | 2 | 1 | ~50 |
| 打包配置 | 2 | 2 | 0 |
| **总计** | **21** | **16** | **~53** |

**关键成功指标：**
1. Go 服务器独立启动，输出 WebSocket 端口
2. 前端通过 WebSocket 调用所有 143 个方法
3. 事件系统正常工作（claude-output, pty-output 等）
4. Electron 窗口控制正常
5. 打包后的应用能正常运行
