//go:build server

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
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 创建 App 实��
	app := NewApp()
	app.Startup(ctx)

	// 创建并启动 WebSocket 服务器
	wsServer := websocket.NewServer(app)
	app.SetBroadcaster(wsServer)

	// 启动服务器
	port, err := wsServer.Start(ctx)
	if err != nil {
		fmt.Printf("Failed to start WebSocket server: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("WS_PORT:%d\n", port)

	// 等待退出信号
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	fmt.Println("Shutting down...")
	wsServer.Stop(ctx)
	app.Shutdown(ctx)
}
