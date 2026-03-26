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
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  64 * 1024,
	WriteBufferSize: 64 * 1024,
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

const (
	maxFilenameLength = 200
	defaultFilename   = "unnamed_file"
)

// NewServer 创建新的 WebSocket 服务器
func NewServer(app interface{}) *Server {
	authKey := os.Getenv("ROPCODE_AUTH_KEY")

	return &Server{
		authKey: authKey,
		router:  NewRouter(app),
		clients: make(map[string]*Client),
	}
}

// defaultPort is the preferred port for the server.
const defaultPort = 5173

// Start 启动 WebSocket 服务器
func (s *Server) Start(ctx context.Context) (int, error) {
	// Try fixed port first, fallback to random
	listener, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", defaultPort))
	if err != nil {
		log.Printf("Port %d occupied, falling back to random port", defaultPort)
		listener, err = net.Listen("tcp", "0.0.0.0:0")
		if err != nil {
			return 0, fmt.Errorf("failed to find available port: %w", err)
		}
	}

	s.port = listener.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/api/upload-attachment", s.handleUploadAttachment)
	mux.HandleFunc("/local-file/", s.handleLocalFile)
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
		client.Close()
	}()

	// Configure ping/pong keepalive
	client.Conn.SetReadDeadline(time.Now().Add(pongWait))
	client.Conn.SetPongHandler(func(string) error {
		client.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

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
		go s.handleRPCRequest(client, msg.Request)
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
// In dev mode (ROPCODE_VITE_URL set): reverse proxy to Vite dev server,
// including WebSocket upgrade requests (for Vite HMR).
// In production (ROPCODE_FRONTEND_DIR set): serve static files from disk.
// In both cases, index.html responses are injected with wsPort and authKey.
func (s *Server) frontendHandler() http.Handler {
	viteURL := os.Getenv("ROPCODE_VITE_URL")
	frontendDir := os.Getenv("ROPCODE_FRONTEND_DIR")

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

		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// WebSocket upgrade on non-/ws paths → proxy to Vite (HMR)
			if isWebSocketUpgrade(r) {
				s.proxyWebSocket(w, r, target)
				return
			}
			proxy.ServeHTTP(w, r)
		})
	} else if frontendDir != "" {
		// Production: serve static files with HTML injection
		return s.staticFrontendHandler(frontendDir)
	}

	// No frontend configured
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "Ropcode server running on port %d. No frontend configured.", s.port)
	})
}

// isWebSocketUpgrade checks if the request is a WebSocket upgrade.
func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket") &&
		strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade")
}

// proxyWebSocket proxies a WebSocket upgrade request to a backend target
// at the TCP level, preserving all headers (including Sec-WebSocket-Protocol).
// It hijacks the client connection and dials the backend as raw TCP, then
// copies bytes bidirectionally without any WebSocket frame parsing.
func (s *Server) proxyWebSocket(w http.ResponseWriter, r *http.Request, target *url.URL) {
	// Build backend address
	backendAddr := target.Host
	if !strings.Contains(backendAddr, ":") {
		if target.Scheme == "https" {
			backendAddr += ":443"
		} else {
			backendAddr += ":80"
		}
	}

	// Dial backend as raw TCP
	backendConn, err := net.Dial("tcp", backendAddr)
	if err != nil {
		log.Printf("WS proxy: failed to dial backend %s: %v", backendAddr, err)
		http.Error(w, "WebSocket proxy failed", http.StatusBadGateway)
		return
	}
	defer backendConn.Close()

	// Rewrite the request URL path for the backend
	r.URL.Scheme = target.Scheme
	r.URL.Host = target.Host
	r.Host = target.Host

	// Write the original HTTP upgrade request to the backend
	if err := r.Write(backendConn); err != nil {
		log.Printf("WS proxy: failed to write request to backend: %v", err)
		http.Error(w, "WebSocket proxy failed", http.StatusBadGateway)
		return
	}

	// Hijack the client connection
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		log.Printf("WS proxy: ResponseWriter does not support hijacking")
		http.Error(w, "WebSocket proxy failed", http.StatusInternalServerError)
		return
	}
	clientConn, _, err := hijacker.Hijack()
	if err != nil {
		log.Printf("WS proxy: failed to hijack client connection: %v", err)
		return
	}
	defer clientConn.Close()

	// Bidirectional copy at TCP level
	done := make(chan struct{}, 2)
	go func() {
		io.Copy(backendConn, clientConn)
		done <- struct{}{}
	}()
	go func() {
		io.Copy(clientConn, backendConn)
		done <- struct{}{}
	}()
	<-done
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

// handleUploadAttachment handles file uploads via HTTP multipart/form-data
func (s *Server) handleUploadAttachment(w http.ResponseWriter, r *http.Request) {
	// 1. Validate request method
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 2. Parse multipart form (max 50MB)
	err := r.ParseMultipartForm(50 << 20) // 50MB
	if err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	// 3. Get uploaded file
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// 4. Get optional projectPath
	projectPath := r.FormValue("projectPath")

	// 5. Generate safe filename: timestamp_originalname
	timestamp := time.Now().Format("20060102-150405")
	safeFilename := sanitizeFilename(header.Filename)
	finalFilename := fmt.Sprintf("%s_%s", timestamp, safeFilename)

	// 6. Ensure storage directory exists
	homeDir, err := os.UserHomeDir()
	if err != nil {
		http.Error(w, "Failed to get home directory", http.StatusInternalServerError)
		return
	}
	attachmentsDir := filepath.Join(homeDir, ".claude", "attachments")
	err = os.MkdirAll(attachmentsDir, 0755)
	if err != nil {
		http.Error(w, "Failed to create directory", http.StatusInternalServerError)
		return
	}

	// 7. Create destination file
	destPath := filepath.Join(attachmentsDir, finalFilename)
	dest, err := os.Create(destPath)
	if err != nil {
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}
	defer dest.Close()

	// 8. Write file content
	written, err := io.Copy(dest, file)
	if err != nil {
		os.Remove(destPath) // Clean up incomplete file
		http.Error(w, "Failed to write file", http.StatusInternalServerError)
		return
	}

	// 9. Return file path
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]string{
		"filePath": destPath,
		"filename": finalFilename,
	}); err != nil {
		log.Printf("Failed to encode upload response: %v", err)
	}

	log.Printf("Uploaded attachment: %s (%d bytes, projectPath: %s)", finalFilename, written, projectPath)
}

// sanitizeFilename cleans a filename to prevent path traversal attacks
// and ensure it's safe to use for storage.
func sanitizeFilename(filename string) string {
	// 1. Extract base filename (removes any path components)
	filename = filepath.Base(filename)

	// 2. Remove any remaining path separators and special characters
	filename = strings.Map(func(r rune) rune {
		// Allow alphanumeric, dots, hyphens, underscores
		if unicode.IsLetter(r) || unicode.IsNumber(r) || r == '.' || r == '-' || r == '_' {
			return r
		}
		// Replace other characters with underscore
		return '_'
	}, filename)

	// 3. Limit filename length to maxFilenameLength characters
	if len(filename) > maxFilenameLength {
		originalExt := filepath.Ext(filename)
		ext := originalExt
		// Limit extension length to prevent panic
		if len(ext) > maxFilenameLength/2 {
			ext = ext[:maxFilenameLength/2]
		}
		nameWithoutExt := strings.TrimSuffix(filename, originalExt)
		maxNameLength := maxFilenameLength - len(ext)
		if len(nameWithoutExt) > maxNameLength {
			nameWithoutExt = nameWithoutExt[:maxNameLength]
		}
		filename = nameWithoutExt + ext
	}

	// 4. Ensure filename is not empty
	if filename == "" || filename == "." || filename == ".." {
		filename = defaultFilename
	}

	return filename
}

// handleLocalFile serves local files by path for image preview.
// URL format: /local-file/<url-encoded-absolute-path>
// This allows iOS and other remote clients to load local images via HTTP.
func (s *Server) handleLocalFile(w http.ResponseWriter, r *http.Request) {
	// Extract and decode the file path from URL
	encodedPath := strings.TrimPrefix(r.URL.Path, "/local-file/")
	filePath, err := url.QueryUnescape(encodedPath)
	if err != nil {
		http.Error(w, "Invalid file path", http.StatusBadRequest)
		return
	}

	// Security: only allow files under home directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		http.Error(w, "Internal error", http.StatusInternalServerError)
		return
	}
	if !strings.HasPrefix(filePath, homeDir+"/") && !strings.HasPrefix(filePath, "/tmp/") {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Serve the file
	http.ServeFile(w, r, filePath)
}
