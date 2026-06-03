package main

import (
	"bufio"
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"log/slog"
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

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend bin/*
var resources embed.FS

type shell struct {
	app                   *application.App
	window                application.Window
	serverCmd             *exec.Cmd
	serverDone            chan struct{}
	serverPort            int
	authKey               string
	rendererLogger        *rendererLogger
	rendererLoggerCleanup func()
	mu                    sync.RWMutex
}

func main() {
	attachHiddenConsole()

	s := &shell{}
	app := application.New(application.Options{
		Name:        "RopcodeWails3",
		Description: "Ropcode Wails v3 shell",
		Assets: application.AssetOptions{
			Handler:    http.FileServer(http.FS(resources)),
			Middleware: s.middleware,
		},
		Logger: application.DefaultLogger(slog.LevelError),
		Windows: application.WindowsOptions{
			WndClass: "RopcodeWails3Window",
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		OnShutdown: func() {
			s.closeRendererLogger()
			s.stopServer()
		},
	})
	s.app = app

	if err := s.openRendererLogger(); err != nil {
		log.Printf("failed to configure renderer logging: %v", err)
	}

	if err := s.startServer(app.Context()); err != nil {
		fmt.Fprintf(os.Stderr, "failed to start ropcode-server: %v\n", err)
		os.Exit(1)
	}

	s.window = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:                      "Ropcode",
		Width:                      1100,
		Height:                     700,
		MinWidth:                   900,
		MinHeight:                  560,
		URL:                        "/frontend/",
		BackgroundColour:           application.NewRGB(18, 18, 18),
		DefaultContextMenuDisabled: true,
		JS:                         s.runtimeScript(),
	})

	if err := app.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "wails3 shell failed: %v\n", err)
		os.Exit(1)
	}
}

func (s *shell) startServer(ctx context.Context) error {
	tempDir, err := os.MkdirTemp("", "ropcode-wails3-*")
	if err != nil {
		return err
	}

	frontendDir := filepath.Join(tempDir, "frontend")
	if err := copyEmbeddedDir("frontend", frontendDir); err != nil {
		return fmt.Errorf("extract frontend: %w", err)
	}

	serverName := "ropcode-server"
	if runtime.GOOS == "windows" {
		serverName += ".exe"
	}
	serverPath := filepath.Join(tempDir, serverName)
	if err := copyEmbeddedFile(filepath.ToSlash(filepath.Join("bin", serverName)), serverPath, 0755); err != nil {
		return fmt.Errorf("extract server: %w", err)
	}

	authKey := strconv.FormatInt(time.Now().UnixNano(), 36)
	cmd := exec.CommandContext(ctx, serverPath)
	if err := configureServerProcess(cmd); err != nil {
		return fmt.Errorf("configure server process: %w", err)
	}
	cmd.Env = append(os.Environ(),
		"ROPCODE_AUTH_KEY="+authKey,
		"ROPCODE_MODE=websocket",
		"ROPCODE_FRONTEND_DIR="+frontendDir,
		"ROPCODE_NOTIFICATION_ACTIVATION_EXE="+shellExecutablePath(),
	)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := startServerProcess(cmd); err != nil {
		return err
	}
	s.serverCmd = cmd
	s.serverDone = make(chan struct{})
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
			go logScanner("[ropcode-server stdout] ", scanner)
			return nil
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return fmt.Errorf("server exited before reporting WS_PORT")
}

func shellExecutablePath() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	return exe
}

func (s *shell) stopServer() {
	if s.serverCmd == nil || s.serverCmd.Process == nil {
		return
	}
	done := s.serverDone
	if done == nil {
		done = make(chan struct{})
		close(done)
	}
	_ = terminateServerProcess(s.serverCmd, done)
}

func (s *shell) openRendererLogger() error {
	logger, cleanup, err := createRendererLoggerForCurrentUser()
	if err != nil {
		return err
	}
	s.rendererLogger = logger
	s.rendererLoggerCleanup = cleanup
	log.Printf("[wails3] renderer logging to %s", logger.path)
	return nil
}

func (s *shell) closeRendererLogger() {
	if s.rendererLoggerCleanup != nil {
		s.rendererLoggerCleanup()
		s.rendererLoggerCleanup = nil
	}
	s.rendererLogger = nil
}

func (s *shell) writeRendererLog(level string, scope string, value interface{}) {
	args, ok := value.([]interface{})
	if !ok {
		args = []interface{}{value}
	}
	s.rendererLogger.write(level, scope, args)
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

func (s *shell) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/ropcode-shell/") {
			s.handleShellBridge(w, r)
			return
		}
		if s.proxyServerRequest(w, r) {
			return
		}
		if r.Method != http.MethodGet || (r.URL.Path != "/frontend/" && r.URL.Path != "/frontend/index.html") {
			next.ServeHTTP(w, r)
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

func (s *shell) proxyServerRequest(w http.ResponseWriter, r *http.Request) bool {
	switch {
	case r.URL.Path == "/ws",
		r.URL.Path == "/ws/rpc",
		r.URL.Path == "/ws/sync",
		strings.HasPrefix(r.URL.Path, "/ws/stream/session/"),
		strings.HasPrefix(r.URL.Path, "/ws/stream/bulk/"),
		r.URL.Path == "/health",
		r.URL.Path == "/api/upload-attachment",
		strings.HasPrefix(r.URL.Path, "/local-file/"):
	default:
		return false
	}

	s.mu.RLock()
	port := s.serverPort
	s.mu.RUnlock()
	if port == 0 {
		http.Error(w, "server not ready", http.StatusServiceUnavailable)
		return true
	}
	target, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", port))
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ServeHTTP(w, r)
	return true
}

func (s *shell) handleShellBridge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	action := strings.TrimPrefix(r.URL.Path, "/ropcode-shell/")
	var payload struct {
		Args []interface{} `json:"args"`
	}
	if r.Body != nil {
		defer r.Body.Close()
		_ = json.NewDecoder(r.Body).Decode(&payload)
	}
	result, err := s.dispatch(action, payload.Args)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if result == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

func (s *shell) dispatch(action string, args []interface{}) (interface{}, error) {
	switch action {
	case "write-renderer-log":
		s.writeRendererLog(stringArg(args, 0), stringArg(args, 1), argsAt(args, 2))
		log.Printf("[renderer:%s:%s] %v", stringArg(args, 0), stringArg(args, 1), argsAt(args, 2))
	case "minimize-window":
		if s.window != nil {
			s.window.Minimise()
		}
	case "maximize-window":
		if s.window != nil {
			s.window.Maximise()
		}
	case "unmaximize-window":
		if s.window != nil {
			s.window.UnMaximise()
		}
	case "toggle-maximize-window":
		if s.window != nil {
			s.window.ToggleMaximise()
		}
	case "set-fullscreen":
		if s.window != nil && boolArg(args, 0) {
			s.window.Fullscreen()
		} else if s.window != nil {
			s.window.UnFullscreen()
		}
	case "is-fullscreen":
		return s.window != nil && s.window.IsFullscreen(), nil
	case "is-maximized":
		return s.window != nil && s.window.IsMaximised(), nil
	case "is-minimized":
		return s.window != nil && s.window.IsMinimised(), nil
	case "is-normal":
		return s.window == nil || (!s.window.IsFullscreen() && !s.window.IsMaximised() && !s.window.IsMinimised()), nil
	case "close-window", "quit":
		if s.app != nil {
			s.app.Quit()
		}
	case "hide-window":
		if s.window != nil {
			s.window.Hide()
		}
	case "show-window":
		if s.window != nil {
			s.window.Show()
		}
	case "center-window":
		if s.window != nil {
			s.window.Center()
		}
	case "set-title":
		if s.window != nil {
			s.window.SetTitle(stringArg(args, 0))
		}
	case "set-size":
		if s.window != nil {
			s.window.SetSize(intArg(args, 0), intArg(args, 1))
		}
	case "get-size":
		if s.window == nil {
			return []int{0, 0}, nil
		}
		width, height := s.window.Size()
		return []int{width, height}, nil
	case "set-position":
		if s.window != nil {
			s.window.SetPosition(intArg(args, 0), intArg(args, 1))
		}
	case "get-position":
		if s.window == nil {
			return []int{0, 0}, nil
		}
		x, y := s.window.Position()
		return []int{x, y}, nil
	case "set-min-size":
		if s.window != nil {
			s.window.SetMinSize(intArg(args, 0), intArg(args, 1))
		}
	case "set-max-size":
		if s.window != nil {
			s.window.SetMaxSize(intArg(args, 0), intArg(args, 1))
		}
	case "set-always-on-top":
		if s.window != nil {
			s.window.SetAlwaysOnTop(boolArg(args, 0))
		}
	case "open-external":
		if s.app != nil {
			return nil, s.app.Browser.OpenURL(stringArg(args, 0))
		}
	case "open-directory":
		return s.openDirectory(), nil
	case "open-file":
		options, _ := argsAt(args, 0).(map[string]interface{})
		return s.openFile(options), nil
	default:
		return nil, fmt.Errorf("unknown shell action %q", action)
	}
	return nil, nil
}

func (s *shell) openDirectory() map[string]interface{} {
	if s.app == nil {
		return map[string]interface{}{"canceled": true}
	}
	path, err := s.app.Dialog.OpenFile().CanChooseDirectories(true).CanChooseFiles(false).PromptForSingleSelection()
	if err != nil || path == "" {
		return map[string]interface{}{"canceled": true}
	}
	return map[string]interface{}{"canceled": false, "filePaths": []string{path}}
}

func (s *shell) openFile(options map[string]interface{}) map[string]interface{} {
	if s.app == nil {
		return map[string]interface{}{"canceled": true}
	}
	dialog := s.app.Dialog.OpenFile().CanChooseFiles(true)
	if multiple, _ := options["multiple"].(bool); multiple {
		paths, err := dialog.PromptForMultipleSelection()
		if err != nil || len(paths) == 0 {
			return map[string]interface{}{"canceled": true}
		}
		return map[string]interface{}{"canceled": false, "filePaths": paths}
	}
	path, err := dialog.PromptForSingleSelection()
	if err != nil || path == "" {
		return map[string]interface{}{"canceled": true}
	}
	return map[string]interface{}{"canceled": false, "filePaths": []string{path}}
}

func (s *shell) runtimeScript() string {
	s.mu.RLock()
	port := s.serverPort
	s.mu.RUnlock()
	return fmt.Sprintf(`(() => {
  window.__ROPCODE_WS_PORT__ = %d;
  window.__ROPCODE_AUTH_KEY__ = %q;
  const call = async (method, ...args) => {
    const response = await fetch('/ropcode-shell/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args })
    });
    if (response.status === 204) return undefined;
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };
  window.electronAPI = {
    wsPort: %d,
    authKey: %q,
    writeRendererLog: (level, scope, args) => call('write-renderer-log', level, scope, args),
    minimizeWindow: () => call('minimize-window'),
    maximizeWindow: () => call('maximize-window'),
    unmaximizeWindow: () => call('unmaximize-window'),
    toggleMaximizeWindow: () => call('toggle-maximize-window'),
    setFullscreen: (fullscreen) => call('set-fullscreen', fullscreen),
    isFullscreen: () => call('is-fullscreen'),
    isMaximized: () => call('is-maximized'),
    isMinimized: () => call('is-minimized'),
    isNormal: () => call('is-normal'),
    closeWindow: () => call('close-window'),
    hideWindow: () => call('hide-window'),
    showWindow: () => call('show-window'),
    centerWindow: () => call('center-window'),
    setTitle: (title) => call('set-title', title),
    setSize: (width, height) => call('set-size', width, height),
    getSize: () => call('get-size'),
    setPosition: (x, y) => call('set-position', x, y),
    getPosition: () => call('get-position'),
    setMinSize: (width, height) => call('set-min-size', width, height),
    setMaxSize: (width, height) => call('set-max-size', width, height),
    setAlwaysOnTop: (flag) => call('set-always-on-top', flag),
    quit: () => call('quit'),
    openDirectory: () => call('open-directory'),
    openFile: (options) => call('open-file', options || {}),
    getWebviewPreload: () => Promise.resolve(''),
    setWebviewFocus: () => {},
    clearWebviewStorage: () => Promise.resolve(),
    onWebviewElementSelected: () => {},
    sendToWebview: () => {},
    onFullscreenChanged: () => () => {},
    openExternal: (url) => call('open-external', url)
  };
})();`, port, s.authKey, port, s.authKey)
}

func copyEmbeddedDir(src, dst string) error {
	entries, err := resources.ReadDir(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dst, 0755); err != nil {
		return err
	}
	for _, entry := range entries {
		srcPath := src + "/" + entry.Name()
		dstPath := filepath.Join(dst, entry.Name())
		if entry.IsDir() {
			if err := copyEmbeddedDir(srcPath, dstPath); err != nil {
				return err
			}
			continue
		}
		if err := copyEmbeddedFile(srcPath, dstPath, 0644); err != nil {
			return err
		}
	}
	return nil
}

func copyEmbeddedFile(src, dst string, mode os.FileMode) error {
	data, err := resources.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	return os.WriteFile(dst, data, mode)
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

func argsAt(args []interface{}, index int) interface{} {
	if index < 0 || index >= len(args) {
		return nil
	}
	return args[index]
}

func stringArg(args []interface{}, index int) string {
	value, _ := argsAt(args, index).(string)
	return value
}

func boolArg(args []interface{}, index int) bool {
	value, _ := argsAt(args, index).(bool)
	return value
}

func intArg(args []interface{}, index int) int {
	switch value := argsAt(args, index).(type) {
	case int:
		return value
	case float64:
		return int(value)
	default:
		return 0
	}
}
