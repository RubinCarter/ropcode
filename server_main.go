//go:build server

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"ropcode/internal/logging"
	"ropcode/internal/websocket"
)

func main() {
	logPath, cleanupLogging, err := logging.ConfigureServerLogging()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to configure logging: %v\n", err)
	} else {
		defer cleanupLogging()
		log.Printf("[server] logging to %s", logPath)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	app, shutdownApp, err := BootstrapRuntime(ctx)
	if err != nil {
		fmt.Printf("Failed to bootstrap runtime: %v\n", err)
		os.Exit(1)
	}
	defer shutdownApp(ctx)

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
	_ = wsServer.Stop(ctx)
}
