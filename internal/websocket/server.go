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
