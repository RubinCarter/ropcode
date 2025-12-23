//go:build server

// +build server

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
	app.Startup(ctx)

	// 创建并启动 WebSocket 服务器
	wsServer := websocket.NewServer(app)

	// 将 WebSocket 服务器设置为事件广播器
	app.SetEventHubBroadcaster(wsServer)

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
	app.Shutdown(ctx)
}
