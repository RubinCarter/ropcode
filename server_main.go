//go:build server

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"ropcode/internal/logging"
	"ropcode/internal/websocket"
	"ropcode/rpc"
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

	// Wire up new RPC dispatch — no fallback, missing = dead
	methods := rpc.Build(app.RPCDeps())

	// Methods still on *App (session_title.go, space_sessions.go, app.go)
	methods["ListSpaceSessions"] = func(p json.RawMessage) (any, error) {
		return app.ListSpaceSessions(rpc.ArgString(p, 0), rpc.ArgInt(p, 1))
	}
	methods["GenerateSessionTitle"] = func(p json.RawMessage) (any, error) {
		return app.GenerateSessionTitle(rpc.ArgString(p, 0))
	}
	methods["GenerateSessionTitleAsync"] = func(p json.RawMessage) (any, error) {
		return app.GenerateSessionTitle(rpc.ArgString(p, 0))
	}
	methods["GenerateSessionTitleForSession"] = func(p json.RawMessage) (any, error) {
		return app.GenerateSessionTitleForSession(rpc.ArgString(p, 0), rpc.ArgString(p, 1), rpc.ArgString(p, 2))
	}
	methods["GenerateSessionTitleForSessionAsync"] = func(p json.RawMessage) (any, error) {
		return app.GenerateSessionTitleForSession(rpc.ArgString(p, 0), rpc.ArgString(p, 1), rpc.ArgString(p, 2))
	}
	methods["GetSessionTitleAvailableModels"] = func(p json.RawMessage) (any, error) {
		return app.GetSessionTitleAvailableModels()
	}
	methods["GetSessionTitleProviderOptions"] = func(p json.RawMessage) (any, error) {
		return app.GetSessionTitleProviderOptions()
	}
	methods["GenerateBranchName"] = func(p json.RawMessage) (any, error) {
		return app.GenerateBranchName(rpc.ArgString(p, 0))
	}
	methods["GenerateBranchNameAsync"] = func(p json.RawMessage) (any, error) {
		return app.GenerateBranchName(rpc.ArgString(p, 0))
	}
	methods["RenameGitBranch"] = func(p json.RawMessage) (any, error) {
		return app.RenameGitBranch(rpc.ArgString(p, 0), rpc.ArgString(p, 1))
	}
	methods["SaveGeneratedSessionTitle"] = func(p json.RawMessage) (any, error) {
		return nil, app.SaveGeneratedSessionTitle(rpc.ArgString(p, 0), rpc.ArgString(p, 1), rpc.ArgString(p, 2))
	}
	methods["WatchGitWorkspace"] = func(p json.RawMessage) (any, error) {
		return nil, app.WatchGitWorkspace(rpc.ArgString(p, 0))
	}
	methods["UnwatchGitWorkspace"] = func(p json.RawMessage) (any, error) {
		app.UnwatchGitWorkspace(rpc.ArgString(p, 0))
		return nil, nil
	}
	methods["SyncProviderModelsFromAPI"] = func(p json.RawMessage) (any, error) {
		return app.SyncProviderModelsFromAPI(rpc.ArgString(p, 0), rpc.ArgString(p, 1))
	}
	methods["ExecuteAgent"] = func(p json.RawMessage) (any, error) {
		return app.ExecuteAgent(int64(rpc.ArgInt(p, 0)), rpc.ArgString(p, 1), rpc.ArgString(p, 2), rpc.ArgString(p, 3))
	}
	methods["Greet"] = func(p json.RawMessage) (any, error) {
		return app.Greet(rpc.ArgString(p, 0)), nil
	}

	wsServer.SetDispatch(func(method string, params json.RawMessage) (any, error) {
		fn := methods[method]
		if fn == nil {
			return nil, fmt.Errorf("method not found: %s", method)
		}
		return fn(params)
	})

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
