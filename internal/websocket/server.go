// internal/websocket/server.go
package websocket

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
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
	mux.Handle("/", s.frontendHandler())

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
	// 验证 authKey - 支持 Header 和 URL 参数两种方式
	if s.authKey != "" {
		authHeader := r.Header.Get("X-Auth-Key")
		authQuery := r.URL.Query().Get("authKey")
		authKey := authHeader
		if authKey == "" {
			authKey = authQuery
		}
		if authKey != s.authKey {
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

// frontendHandler returns an http.Handler that serves the frontend.
// In dev mode (ROPCODE_VITE_URL set): reverse proxy to Vite dev server.
// In production (ROPCODE_FRONTEND_DIR set): serve static files from disk.
// In both cases, index.html responses are injected with wsPort and authKey.
func (s *Server) frontendHandler() http.Handler {
	viteURL := os.Getenv("ROPCODE_VITE_URL")
	frontendDir := os.Getenv("ROPCODE_FRONTEND_DIR")

	var handler http.Handler

	if viteURL != "" {
		// Dev mode: reverse proxy to Vite dev server
		target, err := url.Parse(viteURL)
		if err != nil {
			log.Printf("Invalid ROPCODE_VITE_URL: %v", err)
			return http.NotFoundHandler()
		}
		proxy := httputil.NewSingleHostReverseProxy(target)
		originalDirector := proxy.Director
		proxy.Director = func(req *http.Request) {
			originalDirector(req)
			req.Host = target.Host
		}
		// Intercept responses to inject script into HTML
		proxy.ModifyResponse = func(resp *http.Response) error {
			ct := resp.Header.Get("Content-Type")
			if !strings.Contains(ct, "text/html") {
				return nil
			}
			return s.injectScriptIntoResponse(resp)
		}
		handler = proxy
	} else if frontendDir != "" {
		// Production: serve static files with HTML injection
		handler = s.staticFrontendHandler(frontendDir)
	} else {
		// No frontend configured
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, "Ropcode server running on port %d. No frontend configured.", s.port)
		})
	}

	return handler
}

// staticFrontendHandler serves static files and injects script into index.html.
func (s *Server) staticFrontendHandler(dir string) http.Handler {
	fs := http.Dir(dir)
	fileServer := http.FileServer(fs)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// For SPA: if file doesn't exist, serve index.html
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}

		// Check if the requested file exists
		fullPath := filepath.Join(dir, filepath.Clean(path))
		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			// SPA fallback: serve index.html for non-file routes
			path = "/index.html"
		}

		// If serving index.html, inject the script
		if path == "/index.html" {
			htmlPath := filepath.Join(dir, "index.html")
			data, err := os.ReadFile(htmlPath)
			if err != nil {
				http.Error(w, "index.html not found", http.StatusNotFound)
				return
			}
			injected := s.injectScriptIntoHTML(data)
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(injected)
			return
		}

		fileServer.ServeHTTP(w, r)
	})
}

// connectInfoScript returns the <script> tag to inject into index.html.
func (s *Server) connectInfoScript() string {
	return fmt.Sprintf(`<script>window.__ROPCODE_WS_PORT__=%d;window.__ROPCODE_AUTH_KEY__="%s";</script>`, s.port, s.authKey)
}

// injectScriptIntoHTML inserts the connect info script before </head>.
func (s *Server) injectScriptIntoHTML(html []byte) []byte {
	script := s.connectInfoScript()
	return bytes.Replace(html, []byte("</head>"), []byte(script+"\n</head>"), 1)
}

// injectScriptIntoResponse reads the response body, injects the script, and replaces the body.
func (s *Server) injectScriptIntoResponse(resp *http.Response) error {
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return err
	}

	injected := s.injectScriptIntoHTML(body)
	resp.Body = io.NopCloser(bytes.NewReader(injected))
	resp.ContentLength = int64(len(injected))
	resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(injected)))
	return nil
}
