//go:build wails

package main

import (
	"bufio"
	"bytes"
	"context"
	"embed"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"ropcode/internal/logging"
)

//go:embed all:frontend/dist
var wailsFrontend embed.FS

type wailsShell struct {
	ctx         context.Context
	cancel      context.CancelFunc
	serverCmd   *exec.Cmd
	serverDone  chan struct{}
	serverReady chan struct{}
	serverPort  int
	authKey     string
	mu          sync.RWMutex
}

func main() {
	attachHiddenConsole()

	shell := &wailsShell{}

	if err := wails.Run(&options.App{
		Title:     "Ropcode",
		Width:     1100,
		Height:    700,
		MinWidth:  900,
		MinHeight: 560,
		AssetServer: &assetserver.Options{
			Assets:     wailsFrontend,
			Handler:    shell.proxyRuntimeRequests(),
			Middleware: shell.injectRuntimeMiddleware,
		},
		BackgroundColour:         &options.RGBA{R: 18, G: 18, B: 18, A: 1},
		OnStartup:                shell.startup,
		OnDomReady:               shell.domReady,
		OnShutdown:               shell.shutdown,
		EnableDefaultContextMenu: true,
		Debug: options.Debug{
			OpenInspectorOnStartup: true,
		},
		LogLevelProduction: logger.ERROR,
		Windows: &windows.Options{
			WebviewIsTransparent: false,
		},
		Mac: &mac.Options{
			TitleBar: &mac.TitleBar{
				TitlebarAppearsTransparent: true,
				HideTitle:                  true,
				HideTitleBar:               false,
				FullSizeContent:            true,
				UseToolbar:                 false,
			},
			WindowIsTranslucent: false,
		},
		Bind: []interface{}{
			shell,
		},
	}); err != nil {
		fmt.Fprintf(os.Stderr, "wails shell failed: %v\n", err)
		os.Exit(1)
	}
}

func (s *wailsShell) startup(ctx context.Context) {
	s.ctx, s.cancel = context.WithCancel(ctx)

	logPath, cleanupLogging, err := logging.ConfigureServerLogging()
	if err != nil {
		log.Printf("Failed to configure logging: %v", err)
	} else {
		log.Printf("[wails] logging to %s", logPath)
		_ = cleanupLogging
	}

	serverPath, err := findServerBinary()
	if err != nil {
		log.Printf("Failed to find ropcode-server: %v", err)
		wailsRuntime.Quit(ctx)
		return
	}
	log.Printf("[wails] using ropcode-server binary: %s", serverPath)

	authKey := strconv.FormatInt(time.Now().UnixNano(), 36)
	cmd := exec.CommandContext(s.ctx, serverPath)
	if err := configureServerProcess(cmd); err != nil {
		log.Printf("Failed to configure server process: %v", err)
		wailsRuntime.Quit(ctx)
		return
	}
	cmd.Env = append(os.Environ(),
		"ROPCODE_AUTH_KEY="+authKey,
		"ROPCODE_MODE=websocket",
		"ROPCODE_FRONTEND_DIR="+findFrontendDir(),
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Printf("Failed to get stdout pipe: %v", err)
		wailsRuntime.Quit(ctx)
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		log.Printf("Failed to get stderr pipe: %v", err)
		wailsRuntime.Quit(ctx)
		return
	}

	if err := startServerProcess(cmd); err != nil {
		log.Printf("Failed to start ropcode-server: %v", err)
		wailsRuntime.Quit(ctx)
		return
	}
	s.serverCmd = cmd
	s.serverDone = make(chan struct{})
	s.serverReady = make(chan struct{})
	s.authKey = authKey

	go logPipe("[ropcode-server stderr] ", stderr)
	go func() {
		_ = cmd.Wait()
		cleanupServerProcess(cmd)
		close(s.serverDone)
	}()

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		log.Printf("[ropcode-server stdout] %s", line)
		if port, ok := parseWSPort(line); ok {
			s.mu.Lock()
			s.serverPort = port
			s.mu.Unlock()
			s.closeServerReady()
			go logScanner("[ropcode-server stdout] ", scanner)
			log.Printf("[wails] ropcode-server listening on port %d", port)
			return
		}
	}
	if err := scanner.Err(); err != nil {
		log.Printf("Failed reading server stdout: %v", err)
	}
	log.Printf("ropcode-server exited before reporting WS_PORT")
	s.closeServerReady()
	wailsRuntime.Quit(ctx)
}

func (s *wailsShell) domReady(ctx context.Context) {
	s.mu.RLock()
	port := s.serverPort
	s.mu.RUnlock()
	if port == 0 {
		return
	}
	wailsRuntime.WindowExecJS(ctx, s.runtimeScript())
	wailsRuntime.EventsOn(ctx, "fullscreen-changed", func(optionalData ...interface{}) {
		isFS := false
		if len(optionalData) > 0 {
			isFS, _ = optionalData[0].(bool)
		}
		wailsRuntime.WindowExecJS(ctx, fmt.Sprintf(`if(window.__ropcode_fullscreen_cb) window.__ropcode_fullscreen_cb(%v);`, isFS))
	})
}

func (s *wailsShell) shutdown(ctx context.Context) {
	if s.cancel != nil {
		s.cancel()
	}
	if s.serverCmd != nil && s.serverCmd.Process != nil {
		_ = terminateServerProcess(s.serverCmd, s.serverDone)
	}
}

func (s *wailsShell) proxyRuntimeRequests() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/ws",
			r.URL.Path == "/ws/rpc",
			r.URL.Path == "/ws/sync",
			strings.HasPrefix(r.URL.Path, "/ws/session-stream/"),
			strings.HasPrefix(r.URL.Path, "/ws/bulk-stream/"),
			r.URL.Path == "/health",
			r.URL.Path == "/api/upload-attachment",
			strings.HasPrefix(r.URL.Path, "/local-file/"):
		default:
			http.NotFound(w, r)
			return
		}

		port, ok := s.waitForServerPort(15 * time.Second)
		if !ok {
			http.Error(w, "server not ready", http.StatusServiceUnavailable)
			return
		}
		target, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", port))
		proxy := httputil.NewSingleHostReverseProxy(target)
		proxy.Director = func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host
			if s.authKey != "" && req.Header.Get("X-Auth-Key") == "" && req.URL.Query().Get("authKey") == "" {
				req.Header.Set("X-Auth-Key", s.authKey)
			}
		}
		proxy.ServeHTTP(w, r)
	})
}

func (s *wailsShell) injectRuntimeMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || (r.URL.Path != "/" && r.URL.Path != "/index.html") {
			next.ServeHTTP(w, r)
			return
		}

		if _, ok := s.waitForServerPort(15 * time.Second); !ok {
			http.Error(w, "server not ready", http.StatusServiceUnavailable)
			return
		}

		recorder := &responseRecorder{header: make(http.Header), statusCode: http.StatusOK}
		next.ServeHTTP(recorder, r)
		body := recorder.body.Bytes()
		if recorder.statusCode == http.StatusOK && bytes.Contains(body, []byte("</head>")) {
			body = bytes.Replace(body, []byte("</head>"), []byte("<script>"+s.runtimeScript()+"</script>\n</head>"), 1)
			recorder.header.Set("Content-Length", fmt.Sprintf("%d", len(body)))
		}

		for key, values := range recorder.header {
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
		w.WriteHeader(recorder.statusCode)
		_, _ = w.Write(body)
	})
}

func (s *wailsShell) runtimeScript() string {
	s.mu.RLock()
	port := s.serverPort
	s.mu.RUnlock()
	authKey := s.authKey
	return fmt.Sprintf(`(() => {
  window.__ROPCODE_WS_PORT__ = %d;
  window.__ROPCODE_AUTH_KEY__ = %q;
  const call = (method, ...args) => window.go.main.wailsShell[method](...args);
  window.electronAPI = {
    wsPort: %d,
    authKey: %q,
    writeRendererLog: (level, scope, args) => call('WriteRendererLog', level, scope, args),
    minimizeWindow: () => call('MinimizeWindow'),
    maximizeWindow: () => call('MaximizeWindow'),
    unmaximizeWindow: () => call('UnmaximizeWindow'),
    toggleMaximizeWindow: () => call('ToggleMaximizeWindow'),
    setFullscreen: (fullscreen) => call('SetFullscreen', fullscreen),
    isFullscreen: () => call('IsFullscreen'),
    isMaximized: () => call('IsMaximized'),
    isMinimized: () => call('IsMinimized'),
    isNormal: () => call('IsNormal'),
    closeWindow: () => call('CloseWindow'),
    hideWindow: () => call('HideWindow'),
    showWindow: () => call('ShowWindow'),
    centerWindow: () => call('CenterWindow'),
    setTitle: (title) => call('SetTitle', title),
    setSize: (width, height) => call('SetSize', width, height),
    getSize: () => call('GetSize'),
    setPosition: (x, y) => call('SetPosition', x, y),
    getPosition: () => call('GetPosition'),
    setMinSize: (width, height) => call('SetMinSize', width, height),
    setMaxSize: (width, height) => call('SetMaxSize', width, height),
    setAlwaysOnTop: (flag) => call('SetAlwaysOnTop', flag),
    quit: () => call('Quit'),
    openDirectory: () => call('OpenDirectory'),
    openFile: (options) => call('OpenFile', options || {}),
    getWebviewPreload: () => Promise.resolve(''),
    setWebviewFocus: () => {},
    clearWebviewStorage: () => Promise.resolve(),
    onWebviewElementSelected: () => {},
    sendToWebview: () => {},
    onFullscreenChanged: (cb) => {
      window.__ropcode_fullscreen_cb = cb;
      return () => { delete window.__ropcode_fullscreen_cb; };
    },
    openExternal: (url) => call('OpenExternal', url)
  };
})();`, port, authKey, port, authKey)
}

func (s *wailsShell) waitForServerPort(timeout time.Duration) (int, bool) {
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()

	for {
		s.mu.RLock()
		port := s.serverPort
		ready := s.serverReady
		s.mu.RUnlock()
		if port != 0 {
			return port, true
		}
		if ready == nil {
			return 0, false
		}
		select {
		case <-ready:
			continue
		case <-deadline.C:
			return 0, false
		}
	}
}

func (s *wailsShell) closeServerReady() {
	s.mu.Lock()
	ready := s.serverReady
	s.serverReady = nil
	s.mu.Unlock()
	if ready == nil {
		return
	}
	close(ready)
}

func findFrontendDir() string {
	exe, err := os.Executable()
	if err == nil {
		// Prod: frontend next to the wails executable
		candidate := filepath.Join(filepath.Dir(exe), "frontend")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
		// macOS .app bundle: Contents/MacOS/../Resources/frontend/
		candidate = filepath.Join(filepath.Dir(exe), "..", "Resources", "frontend")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}

	// Dev: frontend/dist relative to working directory
	cwd, _ := os.Getwd()
	candidate := filepath.Join(cwd, "frontend", "dist")
	if info, err := os.Stat(candidate); err == nil && info.IsDir() {
		return candidate
	}

	return ""
}

func findServerBinary() (string, error) {
	name := "ropcode-server"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}

	if candidate, ok := findDevServerBinary(name); ok {
		return candidate, nil
	}

	exe, err := os.Executable()
	if err == nil {
		// Prod: binary next to the wails executable
		candidate := filepath.Join(filepath.Dir(exe), name)
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
		// macOS .app bundle: Contents/MacOS/../Resources/bin/
		candidate = filepath.Join(filepath.Dir(exe), "..", "Resources", "bin", name)
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}

	// Dev: bin/ relative to working directory
	cwd, _ := os.Getwd()
	candidate := filepath.Join(cwd, "bin", name)
	if _, err := os.Stat(candidate); err == nil {
		return candidate, nil
	}

	return "", fmt.Errorf("%s not found (checked next to exe, .app Resources, and ./bin/)", name)
}

func findDevServerBinary(name string) (string, bool) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", false
	}
	if _, err := os.Stat(filepath.Join(cwd, "go.mod")); err != nil {
		return "", false
	}
	if _, err := os.Stat(filepath.Join(cwd, "wails.json")); err != nil {
		return "", false
	}
	candidate := filepath.Join(cwd, "bin", name)
	if _, err := os.Stat(candidate); err == nil {
		return candidate, true
	}
	return "", false
}

func parseWSPort(output string) (int, bool) {
	idx := strings.Index(output, "WS_PORT:")
	if idx < 0 {
		return 0, false
	}
	start := idx + len("WS_PORT:")
	end := start
	for end < len(output) && output[end] >= '0' && output[end] <= '9' {
		end++
	}
	if end == start {
		return 0, false
	}
	port, err := strconv.Atoi(output[start:end])
	return port, err == nil
}

func logPipe(prefix string, reader io.Reader) {
	scanner := bufio.NewScanner(reader)
	logScanner(prefix, scanner)
}

func logScanner(prefix string, scanner *bufio.Scanner) {
	for scanner.Scan() {
		log.Printf("%s%s", prefix, scanner.Text())
	}
}

type responseRecorder struct {
	header     http.Header
	body       bytes.Buffer
	statusCode int
}

func (r *responseRecorder) Header() http.Header {
	return r.header
}

func (r *responseRecorder) WriteHeader(statusCode int) {
	r.statusCode = statusCode
}

func (r *responseRecorder) Write(data []byte) (int, error) {
	return r.body.Write(data)
}

var _ http.ResponseWriter = (*responseRecorder)(nil)
var _ io.Writer = (*responseRecorder)(nil)

func (s *wailsShell) WriteRendererLog(level string, scope string, args []interface{}) {
	log.Printf("[renderer:%s:%s] %v", level, scope, args)
}

func (s *wailsShell) MinimizeWindow() {
	wailsRuntime.WindowMinimise(s.ctx)
}

func (s *wailsShell) MaximizeWindow() {
	wailsRuntime.WindowMaximise(s.ctx)
}

func (s *wailsShell) UnmaximizeWindow() {
	wailsRuntime.WindowUnmaximise(s.ctx)
}

func (s *wailsShell) ToggleMaximizeWindow() {
	wailsRuntime.WindowToggleMaximise(s.ctx)
}

func (s *wailsShell) SetFullscreen(fullscreen bool) {
	if fullscreen {
		wailsRuntime.WindowFullscreen(s.ctx)
	} else {
		wailsRuntime.WindowUnfullscreen(s.ctx)
	}
	wailsRuntime.EventsEmit(s.ctx, "fullscreen-changed", fullscreen)
}

func (s *wailsShell) IsFullscreen() bool {
	return wailsRuntime.WindowIsFullscreen(s.ctx)
}

func (s *wailsShell) IsMaximized() bool {
	return wailsRuntime.WindowIsMaximised(s.ctx)
}

func (s *wailsShell) IsMinimized() bool {
	return wailsRuntime.WindowIsMinimised(s.ctx)
}

func (s *wailsShell) IsNormal() bool {
	return wailsRuntime.WindowIsNormal(s.ctx)
}

func (s *wailsShell) CloseWindow() {
	wailsRuntime.Quit(s.ctx)
}

func (s *wailsShell) HideWindow() {
	wailsRuntime.WindowHide(s.ctx)
}

func (s *wailsShell) ShowWindow() {
	wailsRuntime.WindowShow(s.ctx)
}

func (s *wailsShell) CenterWindow() {
	wailsRuntime.WindowCenter(s.ctx)
}

func (s *wailsShell) SetTitle(title string) {
	wailsRuntime.WindowSetTitle(s.ctx, title)
}

func (s *wailsShell) SetSize(width int, height int) {
	wailsRuntime.WindowSetSize(s.ctx, width, height)
}

func (s *wailsShell) GetSize() []int {
	width, height := wailsRuntime.WindowGetSize(s.ctx)
	return []int{width, height}
}

func (s *wailsShell) SetPosition(x int, y int) {
	wailsRuntime.WindowSetPosition(s.ctx, x, y)
}

func (s *wailsShell) GetPosition() []int {
	x, y := wailsRuntime.WindowGetPosition(s.ctx)
	return []int{x, y}
}

func (s *wailsShell) SetMinSize(width int, height int) {
	wailsRuntime.WindowSetMinSize(s.ctx, width, height)
}

func (s *wailsShell) SetMaxSize(width int, height int) {
	wailsRuntime.WindowSetMaxSize(s.ctx, width, height)
}

func (s *wailsShell) SetAlwaysOnTop(flag bool) {
	wailsRuntime.WindowSetAlwaysOnTop(s.ctx, flag)
}

func (s *wailsShell) Quit() {
	wailsRuntime.Quit(s.ctx)
}

func (s *wailsShell) OpenDirectory() map[string]interface{} {
	path, err := wailsRuntime.OpenDirectoryDialog(s.ctx, wailsRuntime.OpenDialogOptions{})
	if err != nil || path == "" {
		return map[string]interface{}{"canceled": true}
	}
	return map[string]interface{}{"canceled": false, "filePaths": []string{path}}
}

func (s *wailsShell) OpenFile(options map[string]interface{}) map[string]interface{} {
	multiple, _ := options["multiple"].(bool)
	if multiple {
		paths, err := wailsRuntime.OpenMultipleFilesDialog(s.ctx, wailsRuntime.OpenDialogOptions{})
		if err != nil || len(paths) == 0 {
			return map[string]interface{}{"canceled": true}
		}
		return map[string]interface{}{"canceled": false, "filePaths": paths}
	}
	path, err := wailsRuntime.OpenFileDialog(s.ctx, wailsRuntime.OpenDialogOptions{})
	if err != nil || path == "" {
		return map[string]interface{}{"canceled": true}
	}
	return map[string]interface{}{"canceled": false, "filePaths": []string{path}}
}

func (s *wailsShell) OpenExternal(rawURL string) {
	wailsRuntime.BrowserOpenURL(s.ctx, rawURL)
}
