//go:build wails

package main

import (
	"bytes"
	"context"
	"embed"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"ropcode/internal/logging"
	"ropcode/internal/websocket"
)

//go:embed all:frontend/dist
var wailsFrontend embed.FS

type wailsShell struct {
	ctx         context.Context
	cancel      context.CancelFunc
	app         *App
	shutdownApp func(context.Context)
	wsServer    *websocket.Server
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
		EnableDefaultContextMenu: false,
		LogLevelProduction:       logger.ERROR,
		Windows: &windows.Options{
			WebviewIsTransparent: false,
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

	if err := os.Setenv("ROPCODE_AUTH_KEY", ""); err != nil {
		log.Printf("Failed to clear auth key: %v", err)
	}
	_ = os.Unsetenv("ROPCODE_AUTH_KEY")
	_ = os.Setenv("ROPCODE_MODE", "websocket")

	app, shutdownApp, err := BootstrapRuntime(s.ctx)
	if err != nil {
		log.Printf("Failed to bootstrap runtime: %v", err)
		wailsRuntime.Quit(ctx)
		return
	}
	s.app = app
	s.shutdownApp = shutdownApp

	s.wsServer = websocket.NewServer(app)
	s.wsServer.SetAuthKey("")
	app.SetBroadcaster(s.wsServer)

	port, err := s.wsServer.Start(s.ctx)
	if err != nil {
		log.Printf("Failed to start WebSocket server: %v", err)
		wailsRuntime.Quit(ctx)
		return
	}
	log.Printf("[wails] WebSocket server listening on %d", port)
}

func (s *wailsShell) domReady(ctx context.Context) {
	if s.wsServer == nil {
		return
	}
	wailsRuntime.WindowExecJS(ctx, s.runtimeScript())
}

func (s *wailsShell) shutdown(ctx context.Context) {
	if s.cancel != nil {
		s.cancel()
	}
	if s.wsServer != nil {
		if err := s.wsServer.Stop(ctx); err != nil {
			log.Printf("Failed to stop WebSocket server: %v", err)
		}
		s.wsServer = nil
	}
	if s.shutdownApp != nil {
		s.shutdownApp(ctx)
		s.shutdownApp = nil
	}
}

func (s *wailsShell) proxyRuntimeRequests() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.wsServer == nil {
			http.NotFound(w, r)
			return
		}

		switch {
		case r.URL.Path == "/ws":
			s.wsServer.ServeHTTP(w, r)
		case r.URL.Path == "/health":
			s.wsServer.ServeHTTP(w, r)
		case r.URL.Path == "/api/upload-attachment":
			s.wsServer.ServeHTTP(w, r)
		case len(r.URL.Path) >= len("/local-file/") && r.URL.Path[:len("/local-file/")] == "/local-file/":
			s.wsServer.ServeHTTP(w, r)
		default:
			http.NotFound(w, r)
		}
	})
}

func (s *wailsShell) injectRuntimeMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || (r.URL.Path != "/" && r.URL.Path != "/index.html") {
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

func (s *wailsShell) runtimeScript() string {
	port := 5173
	authKey := ""
	if s.wsServer != nil {
		port = s.wsServer.GetPort()
		authKey = s.wsServer.GetAuthKey()
	}
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
    onFullscreenChanged: () => () => {},
    openExternal: (url) => call('OpenExternal', url)
  };
})();`, port, authKey, port, authKey)
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
		return
	}
	wailsRuntime.WindowUnfullscreen(s.ctx)
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
