//go:build !server

// +build !server

package main

import (
	"embed"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

// FileLoader handles serving local files for the frontend
type FileLoader struct{}

// NewFileLoader creates a new FileLoader instance
func NewFileLoader() *FileLoader {
	return &FileLoader{}
}

// ServeHTTP handles HTTP requests for local files
// Based on Wails official FileLoader example
func (f *FileLoader) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Log the incoming request for debugging
	fmt.Printf("[FileLoader] Request: %s %s\n", r.Method, r.URL.Path)

	// Check if this is a request for local file (with /wails-local-file/ prefix)
	if !strings.HasPrefix(r.URL.Path, "/wails-local-file/") {
		// Not a local file request, return 404
		w.WriteHeader(http.StatusNotFound)
		return
	}

	// Remove the /wails-local-file prefix to get the actual file path
	requestedPath := strings.TrimPrefix(r.URL.Path, "/wails-local-file")

	// URL decode the path
	decodedPath, err := url.PathUnescape(requestedPath)
	if err != nil {
		fmt.Printf("[FileLoader] PathUnescape error: %v\n", err)
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(fmt.Sprintf("Could not decode path: %s", requestedPath)))
		return
	}

	fmt.Printf("[FileLoader] Decoded path: %s\n", decodedPath)

	// Only allow access to specific directories for security
	homeDir, _ := os.UserHomeDir()
	allowedPrefixes := []string{
		homeDir + "/.ropcode/temp-images/",
		homeDir + "/.ropcode/",
		"/Users/",
		"/tmp/",
	}

	allowed := false
	for _, prefix := range allowedPrefixes {
		if strings.HasPrefix(decodedPath, prefix) {
			allowed = true
			break
		}
	}

	if !allowed {
		fmt.Printf("[FileLoader] Forbidden: %s (homeDir=%s)\n", decodedPath, homeDir)
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(fmt.Sprintf("Forbidden: %s", decodedPath)))
		return
	}

	// Read the file using os.ReadFile (Wails recommended approach)
	fileData, err := os.ReadFile(decodedPath)
	if err != nil {
		fmt.Printf("[FileLoader] ReadFile error: %v\n", err)
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(fmt.Sprintf("Could not load file: %s", decodedPath)))
		return
	}

	// Detect content type based on file extension
	ext := strings.ToLower(filepath.Ext(decodedPath))
	contentType := "application/octet-stream"
	switch ext {
	case ".png":
		contentType = "image/png"
	case ".jpg", ".jpeg":
		contentType = "image/jpeg"
	case ".gif":
		contentType = "image/gif"
	case ".webp":
		contentType = "image/webp"
	case ".svg":
		contentType = "image/svg+xml"
	case ".ico":
		contentType = "image/x-icon"
	case ".bmp":
		contentType = "image/bmp"
	}

	fmt.Printf("[FileLoader] Serving file: %s (size=%d, type=%s)\n", decodedPath, len(fileData), contentType)

	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	w.Write(fileData)
}

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "ropcode",
		Width:     1100,
		Height:    700,
		MinWidth:  1100,
		MinHeight: 700,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: NewFileLoader(),
		},
		BackgroundColour:         &options.RGBA{R: 0, G: 0, B: 0, A: 0},
		Frameless:                true,
		StartHidden:              false,
		EnableDefaultContextMenu: true,
		LogLevel:                 logger.DEBUG,
		LogLevelProduction:       logger.INFO,
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
		Mac: &mac.Options{
			TitleBar: &mac.TitleBar{
				TitlebarAppearsTransparent: true,
				HideTitle:                  true,
				HideTitleBar:               false,
				FullSizeContent:            true,
			},
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: true,
			WindowIsTranslucent:  false,
			DisableWindowIcon:    false,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
