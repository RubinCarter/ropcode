package rpc

import (
	"encoding/json"
	"fmt"

	"ropcode/internal/agentpacks"
)

func AgentPackHandlers(d *Deps) map[string]Handler {
	managerFor := func() (*agentpacks.Manager, error) {
		if d.AgentPacks != nil {
			return d.AgentPacks, nil
		}
		if d.Config == nil || d.Config.RopcodeDir == "" {
			return nil, fmt.Errorf("agent pack manager not initialized")
		}
		return agentpacks.NewManager(d.Config.RopcodeDir), nil
	}

	return map[string]Handler{
		"ListAgentPacks": func(p json.RawMessage) (any, error) {
			m, err := managerFor()
			if err != nil {
				return nil, err
			}
			return m.ListInstalled()
		},
		"GetAgentPack": func(p json.RawMessage) (any, error) {
			m, err := managerFor()
			if err != nil {
				return nil, err
			}
			return m.GetInstalled(argString(p, 0))
		},
		"ListRemoteAgentPacks": func(p json.RawMessage) (any, error) {
			m, err := managerFor()
			if err != nil {
				return nil, err
			}
			return m.ListRemoteIndex(argObject[agentpacks.InstallSource](p, 0))
		},
		"InstallAgentPack": func(p json.RawMessage) (any, error) {
			m, err := managerFor()
			if err != nil {
				return nil, err
			}
			return m.Install(argObject[agentpacks.InstallOptions](p, 0))
		},
		"CreateLocalAgentPack": func(p json.RawMessage) (any, error) {
			m, err := managerFor()
			if err != nil {
				return nil, err
			}
			return m.CreateLocal(argObject[agentpacks.CreateLocalPackRequest](p, 0))
		},
		"InstallLocalAgentPack": func(p json.RawMessage) (any, error) {
			m, err := managerFor()
			if err != nil {
				return nil, err
			}
			return m.InstallLocal(
				argString(p, 0),
				argObject[map[string]agentpacks.InstalledAgentConfig](p, 1),
				argBool(p, 2),
			)
		},
		"SaveAgentPackConfig": func(p json.RawMessage) (any, error) {
			m, err := managerFor()
			if err != nil {
				return nil, err
			}
			return m.SaveInstallConfig(argString(p, 0), argObject[map[string]agentpacks.InstalledAgentConfig](p, 1))
		},
		"CheckAgentPackUpdate": func(p json.RawMessage) (any, error) {
			m, err := managerFor()
			if err != nil {
				return nil, err
			}
			return m.CheckUpdate(argString(p, 0))
		},
		"UpdateAgentPack": func(p json.RawMessage) (any, error) {
			m, err := managerFor()
			if err != nil {
				return nil, err
			}
			return m.Update(argString(p, 0))
		},
		"UninstallAgentPack": func(p json.RawMessage) (any, error) {
			m, err := managerFor()
			if err != nil {
				return nil, err
			}
			return nil, m.Uninstall(argString(p, 0))
		},
	}
}
