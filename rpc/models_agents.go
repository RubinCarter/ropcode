package rpc

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"ropcode/internal/database"
)

func ModelHandlers(d *Deps) map[string]Handler {
	return map[string]Handler{
		"GetAllModelConfigs": func(p json.RawMessage) (any, error) {
			if d.Models == nil {
				return []*database.ModelConfig{}, nil
			}
			configs, err := d.Models.GetAllModels()
			if err != nil || configs == nil {
				return []*database.ModelConfig{}, err
			}
			return configs, nil
		},
		"GetEnabledModelConfigs": func(p json.RawMessage) (any, error) {
			if d.Models == nil {
				return []*database.ModelConfig{}, nil
			}
			configs, err := d.Models.GetEnabledModels()
			if err != nil || configs == nil {
				return []*database.ModelConfig{}, err
			}
			return configs, nil
		},
		"GetModelConfigsByProvider": func(p json.RawMessage) (any, error) {
			if d.Models == nil {
				return []*database.ModelConfig{}, nil
			}
			configs, err := d.Models.GetModelsByProvider(argString(p, 0))
			if err != nil || configs == nil {
				return []*database.ModelConfig{}, err
			}
			return configs, nil
		},
		"GetModelConfig": func(p json.RawMessage) (any, error) {
			if d.Models == nil {
				return nil, nil
			}
			return d.Models.GetModel(argString(p, 0))
		},
		"GetModelConfigByModelID": func(p json.RawMessage) (any, error) {
			if d.Models == nil {
				return nil, nil
			}
			return d.Models.GetModelByModelID(argString(p, 0))
		},
		"GetDefaultModelConfig": func(p json.RawMessage) (any, error) {
			if d.Models == nil {
				return nil, nil
			}
			return d.Models.GetDefaultModel(argString(p, 0))
		},
		"CreateModelConfig": func(p json.RawMessage) (any, error) {
			if d.Models == nil {
				return nil, nil
			}
			config := argObject[database.ModelConfig](p, 0)
			return nil, d.Models.CreateModel(&config)
		},
		"UpdateModelConfig": func(p json.RawMessage) (any, error) {
			if d.Models == nil {
				return nil, nil
			}
			id := argString(p, 0)
			config := argObject[database.ModelConfig](p, 1)
			return nil, d.Models.UpdateModel(id, &config)
		},
		"DeleteModelConfig": func(p json.RawMessage) (any, error) {
			if d.Models == nil {
				return nil, nil
			}
			return nil, d.Models.DeleteModel(argString(p, 0))
		},
		"SetModelConfigEnabled": func(p json.RawMessage) (any, error) {
			if d.Models == nil {
				return nil, nil
			}
			return nil, d.Models.SetModelEnabled(argString(p, 0), argBool(p, 1))
		},
		"SetModelConfigDefault": func(p json.RawMessage) (any, error) {
			if d.Models == nil {
				return nil, nil
			}
			return nil, d.Models.SetDefaultModel(argString(p, 0))
		},
		"GetModelThinkingLevels": func(p json.RawMessage) (any, error) {
			if d.Models == nil {
				return []database.ThinkingLevel{}, nil
			}
			levels, err := d.Models.GetThinkingLevels(argString(p, 0))
			if err != nil || levels == nil {
				return []database.ThinkingLevel{}, err
			}
			return levels, nil
		},
		"GetDefaultThinkingLevel": func(p json.RawMessage) (any, error) {
			if d.Models == nil {
				return nil, nil
			}
			return d.Models.GetDefaultThinkingLevel(argString(p, 0))
		},
		"SyncProviderModelsFromAPI": func(p json.RawMessage) (any, error) {
			if d.Models == nil || d.DB == nil {
				return []*database.ModelConfig{}, nil
			}
			return []*database.ModelConfig{}, fmt.Errorf("SyncProviderModelsFromAPI must be registered via server_main.go")
		},
	}
}

func AgentHandlers(d *Deps) map[string]Handler {
	return map[string]Handler{
		"ListAgents": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return d.DB.ListAgents()
		},
		"GetAgent": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return d.DB.GetAgent(int64(argInt(p, 0)))
		},
		"CreateAgent": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return 0, nil
			}
			agent := &database.Agent{
				Name:          argString(p, 0),
				Icon:          argString(p, 1),
				SystemPrompt:  argString(p, 2),
				DefaultTask:   argString(p, 3),
				Model:         argString(p, 4),
				ProviderApiID: argString(p, 5),
				Hooks:         argString(p, 6),
			}
			return d.DB.CreateAgent(agent)
		},
		"UpdateAgent": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			agent := &database.Agent{
				ID:            int64(argInt(p, 0)),
				Name:          argString(p, 1),
				Icon:          argString(p, 2),
				SystemPrompt:  argString(p, 3),
				DefaultTask:   argString(p, 4),
				Model:         argString(p, 5),
				ProviderApiID: argString(p, 6),
				Hooks:         argString(p, 7),
			}
			return nil, d.DB.UpdateAgent(agent)
		},
		"DeleteAgent": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return nil, d.DB.DeleteAgent(int64(argInt(p, 0)))
		},
		"ExportAgent": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return "", nil
			}
			return d.DB.ExportAgent(int64(argInt(p, 0)))
		},
		"ExportAgentToFile": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return nil, d.DB.ExportAgentToFile(int64(argInt(p, 0)), argString(p, 1))
		},
		"ImportAgent": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return d.DB.ImportAgent(argString(p, 0))
		},
		"ImportAgentFromFile": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return d.DB.ImportAgentFromFile(argString(p, 0))
		},
		"ListAgentRuns": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			agentID := int64(argInt(p, 0))
			limit := argInt(p, 1)
			if limit <= 0 {
				limit = 50
			}
			var agentIDPtr *int64
			if agentID > 0 {
				agentIDPtr = &agentID
			}
			return d.DB.ListAgentRuns(agentIDPtr, limit)
		},
		"GetAgentRun": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return d.DB.GetAgentRun(int64(argInt(p, 0)))
		},
		"GetAgentRunBySessionID": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return d.DB.GetAgentRunBySessionID(argString(p, 0))
		},
		"ListRunningAgentRuns": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			runs, err := d.DB.ListRunningAgentRuns()
			if err != nil {
				return nil, err
			}
			if d.Provider == nil {
				return runs, nil
			}
			activeRuns := make([]*database.AgentRun, 0, len(runs))
			for _, run := range runs {
				if run == nil || run.SessionID == "" {
					activeRuns = append(activeRuns, run)
					continue
				}
				session := d.Provider.GetSession(run.SessionID)
				if session != nil {
					switch session.Status {
					case "running", "starting", "created", "cancelling":
						activeRuns = append(activeRuns, run)
					case "completed", "failed", "cancelled":
						completedAt := time.Now()
						_ = d.DB.UpdateAgentRunStatus(run.ID, session.Status, run.PID, run.ProcessStartedAt, &completedAt)
					default:
						activeRuns = append(activeRuns, run)
					}
					continue
				}
				completedAt := time.Now()
				_ = d.DB.UpdateAgentRunStatus(run.ID, "failed", run.PID, run.ProcessStartedAt, &completedAt)
			}
			return activeRuns, nil
		},
		"CancelAgentRun": func(p json.RawMessage) (any, error) {
			if d.DB == nil || d.Provider == nil {
				return nil, nil
			}
			runID := int64(argInt(p, 0))
			run, err := d.DB.GetAgentRun(runID)
			if err != nil {
				return nil, err
			}
			if run.SessionID != "" {
				d.Provider.TerminateSession(run.SessionID)
			}
			now := run.CreatedAt
			return nil, d.DB.UpdateAgentRunStatus(runID, "cancelled", run.PID, run.ProcessStartedAt, &now)
		},
		"DeleteAgentRun": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return nil, d.DB.DeleteAgentRun(int64(argInt(p, 0)))
		},
		"GetAgentRunOutput": func(p json.RawMessage) (any, error) {
			if d.DB == nil || d.Provider == nil {
				return "", nil
			}
			run, err := d.DB.GetAgentRun(int64(argInt(p, 0)))
			if err != nil {
				return "", err
			}
			if run.SessionID == "" {
				return "", nil
			}
			output, outputErr := d.Provider.GetSessionOutput(run.SessionID)
			if outputErr != nil && strings.Contains(outputErr.Error(), "session not found:") && (run.Status == "running" || run.Status == "pending") {
				completedAt := time.Now()
				_ = d.DB.UpdateAgentRunStatus(run.ID, "failed", run.PID, run.ProcessStartedAt, &completedAt)
			}
			return output, outputErr
		},
	}
}
