package main

import (
	"encoding/json"

	"ropcode/rpc"
)

// RPCMethods returns the explicit RPC method table used by every in-process
// server entrypoint. Keep provider behavior behind rpc.Build and only add
// root App methods here while they are still being migrated.
func (a *App) RPCMethods() map[string]rpc.Handler {
	methods := rpc.Build(a.RPCDeps())

	methods["ListSpaceSessions"] = func(p json.RawMessage) (any, error) {
		return a.ListSpaceSessions(rpc.ArgString(p, 0), rpc.ArgInt(p, 1))
	}
	methods["GenerateSessionTitle"] = func(p json.RawMessage) (any, error) {
		return a.GenerateSessionTitle(rpc.ArgString(p, 0))
	}
	methods["GenerateSessionTitleAsync"] = func(p json.RawMessage) (any, error) {
		return a.GenerateSessionTitleAsync(rpc.ArgString(p, 0))
	}
	methods["GenerateSessionTitleForSession"] = func(p json.RawMessage) (any, error) {
		return a.GenerateSessionTitleForSession(rpc.ArgString(p, 0), rpc.ArgString(p, 1), rpc.ArgString(p, 2))
	}
	methods["GenerateSessionTitleForSessionAsync"] = func(p json.RawMessage) (any, error) {
		return a.GenerateSessionTitleForSessionAsync(rpc.ArgString(p, 0), rpc.ArgString(p, 1), rpc.ArgString(p, 2))
	}
	methods["GetSessionTitleAvailableModels"] = func(p json.RawMessage) (any, error) {
		return a.GetSessionTitleAvailableModels()
	}
	methods["GetSessionTitleProviderOptions"] = func(p json.RawMessage) (any, error) {
		return a.GetSessionTitleProviderOptions()
	}
	methods["GenerateBranchName"] = func(p json.RawMessage) (any, error) {
		return a.GenerateBranchName(rpc.ArgString(p, 0))
	}
	methods["GenerateBranchNameAsync"] = func(p json.RawMessage) (any, error) {
		return a.GenerateBranchNameAsync(rpc.ArgString(p, 0))
	}
	methods["RenameGitBranch"] = func(p json.RawMessage) (any, error) {
		return a.RenameGitBranch(rpc.ArgString(p, 0), rpc.ArgString(p, 1))
	}
	methods["SaveGeneratedSessionTitle"] = func(p json.RawMessage) (any, error) {
		return nil, a.SaveGeneratedSessionTitle(rpc.ArgString(p, 0), rpc.ArgString(p, 1), rpc.ArgString(p, 2))
	}
	methods["WatchGitWorkspace"] = func(p json.RawMessage) (any, error) {
		return nil, a.WatchGitWorkspace(rpc.ArgString(p, 0))
	}
	methods["UnwatchGitWorkspace"] = func(p json.RawMessage) (any, error) {
		a.UnwatchGitWorkspace(rpc.ArgString(p, 0))
		return nil, nil
	}
	methods["SyncProviderModelsFromAPI"] = func(p json.RawMessage) (any, error) {
		return a.SyncProviderModelsFromAPI(rpc.ArgString(p, 0), rpc.ArgString(p, 1))
	}
	methods["ExecuteAgent"] = func(p json.RawMessage) (any, error) {
		return a.ExecuteAgent(int64(rpc.ArgInt(p, 0)), rpc.ArgString(p, 1), rpc.ArgString(p, 2), rpc.ArgString(p, 3))
	}
	methods["Greet"] = func(p json.RawMessage) (any, error) {
		return a.Greet(rpc.ArgString(p, 0)), nil
	}

	return methods
}
