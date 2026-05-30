package rpc

import (
	"bufio"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"ropcode/internal/claude"
	"ropcode/internal/claudeactivity"
	"ropcode/internal/stream"
)

func SessionHandlers(d *Deps) map[string]Handler {
	return map[string]Handler{
		// --- Session History ---
		"GetSessionMessageIndex": func(p json.RawMessage) (any, error) {
			return d.Provider.GetMessageIndex("claude", argString(p, 0), argString(p, 1))
		},
		"GetSessionMessagesRange": func(p json.RawMessage) (any, error) {
			return d.Provider.GetMessagesRange("claude", argString(p, 0), argString(p, 1), argInt(p, 2), argInt(p, 3))
		},
		"StreamSessionOutput": func(p json.RawMessage) (any, error) {
			projectID := argString(p, 0)
			sessionID := argString(p, 1)
			messages, err := d.Provider.LoadSessionHistory("claude", projectID, sessionID)
			if err != nil {
				return nil, err
			}
			go func() {
				for _, msg := range messages {
					if d.BulkHub != nil {
						if data, err := json.Marshal(msg); err == nil {
							d.BulkHub.Append(stream.BulkFrame{
								Source:    "agent",
								ID:        sessionID,
								FrameID:   msg.UUID,
								Seq:       time.Now().UnixNano(),
								Timestamp: msg.Timestamp,
								Data:      string(data),
								Meta:      map[string]interface{}{"projectId": projectID},
							})
						}
					}
				}
			}()
			return nil, nil
		},
		"LoadProviderSessionHistory": func(p json.RawMessage) (any, error) {
			sessionID := argString(p, 0)
			projectID := argString(p, 1)
			providerName := argString(p, 2)
			return d.Provider.LoadSessionHistory(providerName, projectID, sessionID)
		},
		"LoadProviderSessionHistoryFrames": func(p json.RawMessage) (any, error) {
			sessionID := argString(p, 0)
			projectID := argString(p, 1)
			providerName := argString(p, 2)
			events, err := d.Provider.LoadHistoryEvents(providerName, projectID, sessionID)
			if err != nil {
				return nil, err
			}
			return stream.FramesFromEvents(providerName, stream.ProviderOutputContext{
				RuntimeSessionID: sessionID,
				ProjectPath:      projectID,
			}, events)
		},
		"LoadAgentSessionHistory": func(p json.RawMessage) (any, error) {
			return d.Provider.LoadSessionHistory("claude", "", argString(p, 0))
		},
		"LoadSubagentTranscripts": func(p json.RawMessage) (any, error) {
			sessionID := argString(p, 0)
			projectID := argString(p, 1)
			for _, providerID := range []string{"claude", "codex"} {
				transcripts, err := d.Provider.LoadSubagentTranscripts(providerID, projectID, sessionID)
				if err == nil && len(transcripts) > 0 {
					return transcripts, nil
				}
			}
			return map[string][]claude.Message{}, nil
		},
		"ListProviderSessions": func(p json.RawMessage) (any, error) {
			projectPath := argString(p, 0)
			providerName := argString(p, 1)
			sessions, err := d.Provider.ListProviderSessions(providerName, projectPath)
			if err != nil || sessions == nil {
				return []any{}, nil
			}
			return sessions, nil
		},
		// --- Session Lifecycle ---
		"ListRunningProviderSessions": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return []any{}, nil
			}
			sessions := d.Provider.ListAllSessions()
			result := make([]map[string]any, 0, len(sessions))
			for _, s := range sessions {
				result = append(result, map[string]any{
					"session_id":          s.SessionID,
					"provider_session_id": s.ProviderSessionID,
					"project_path":        s.ProjectPath,
					"model":               s.Model,
					"status":              s.Status,
					"started_at":          s.StartedAt,
					"pid":                 s.PID,
					"provider":            s.ProviderID,
				})
			}
			return result, nil
		},
		"GetProviderSessionOutput": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return "", fmt.Errorf("provider manager not initialized")
			}
			return d.Provider.GetSessionOutput(argString(p, 0))
		},
		"StopProviderSession": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, fmt.Errorf("provider manager not initialized")
			}
			return nil, d.Provider.TerminateSession(argString(p, 0))
		},
		"StopProviderSessionsByProject": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, nil
			}
			return nil, d.Provider.TerminateByProjectAll(argString(p, 0))
		},
		"SetProviderSessionModel": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, fmt.Errorf("provider manager not initialized")
			}
			return nil, d.Provider.SetModel(argString(p, 0), argString(p, 1))
		},
		"SetProviderSessionPermissionMode": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, fmt.Errorf("provider manager not initialized")
			}
			return nil, d.Provider.SetPermissionMode(argString(p, 0), argString(p, 1))
		},
		"InterruptProviderSession": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, fmt.Errorf("provider manager not initialized")
			}
			return nil, d.Provider.InterruptSession(argString(p, 0))
		},
		"UpdateProviderSessionEnvironment": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, fmt.Errorf("provider manager not initialized")
			}
			return nil, d.Provider.UpdateEnvironmentVariables(argString(p, 0), argObject[map[string]string](p, 1))
		},
		"SwitchProviderSessionApi": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, fmt.Errorf("provider manager not initialized")
			}
			return nil, switchSessionProviderApi(d, argString(p, 0), argString(p, 1))
		},
		"IsProviderSessionRunning": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return false, nil
			}
			return d.Provider.IsRunning(argString(p, 0)), nil
		},
		"IsProviderSessionRunningForProject": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return false, nil
			}
			return d.Provider.IsProviderSessionRunningForProject(argString(p, 0), argString(p, 1)), nil
		},
		"QueryProviderSessionActivityForProject": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, fmt.Errorf("provider manager not initialized")
			}
			return d.Provider.QueryProviderSessionActivityForProject(argString(p, 0), argString(p, 1), 2*time.Second)
		},
		// --- Claude Activity ---
		"GetClaudeSessionActivities": func(p json.RawMessage) (any, error) {
			if d.Activity == nil {
				return claudeactivity.Snapshot{}, fmt.Errorf("claude activity service not initialized")
			}
			sessionID := argString(p, 0)
			snapshot, err := d.Activity.GetSnapshot(sessionID)
			if err != nil {
				return claudeactivity.Snapshot{}, err
			}
			if len(snapshot.Activities) == 0 && d.Provider != nil {
				if output, outputErr := d.Provider.GetSessionOutput(sessionID); outputErr == nil && output != "" {
					replayActivityOutput(d.Activity, sessionID, output)
					if replayed, replayErr := d.Activity.GetSnapshot(sessionID); replayErr == nil {
						snapshot = replayed
					}
				}
			}
			return snapshot, nil
		},
		"GetClaudeActivityLogTail": func(p json.RawMessage) (any, error) {
			if d.Activity == nil {
				return claudeactivity.LogTail{}, fmt.Errorf("claude activity service not initialized")
			}
			return d.Activity.GetLogTail(argString(p, 0), argString(p, 1), argInt(p, 2))
		},
		"StopClaudeActivity": func(p json.RawMessage) (any, error) {
			if d.Activity == nil {
				return nil, fmt.Errorf("claude activity service not initialized")
			}
			return nil, d.Activity.StopActivity(argString(p, 0), argString(p, 1))
		},
		"ReadClaudeSubagentLog": func(p json.RawMessage) (any, error) {
			if d.Activity == nil {
				return claudeactivity.SubagentLogChunk{}, fmt.Errorf("claude activity service not initialized")
			}
			return d.Activity.ReadSubagentLog(argString(p, 0), argString(p, 1), argInt(p, 2))
		},
		// --- Capability Discovery ---
		"GetCachedClaudeCapabilityLayers": func(p json.RawMessage) (any, error) {
			if d.CapDiscovery == nil {
				return nil, nil
			}
			layers, ok := d.CapDiscovery.Cached(argString(p, 0))
			if !ok {
				return nil, nil
			}
			return formatCapabilityLayers(layers), nil
		},
		"PrewarmClaudeCapabilityLayers": func(p json.RawMessage) (any, error) {
			if d.CapDiscovery == nil {
				return nil, nil
			}
			projectPath := argString(p, 0)
			go d.CapDiscovery.PrewarmSystem()
			go d.CapDiscovery.PrewarmUser()
			if strings.TrimSpace(projectPath) != "" {
				go d.CapDiscovery.PrewarmProject(projectPath)
			}
			return nil, nil
		},
		"GetClaudeCapabilityLayers": func(p json.RawMessage) (any, error) {
			if d.CapDiscovery == nil {
				return nil, nil
			}
			layers, err := d.CapDiscovery.Discover(argString(p, 0))
			if err != nil {
				return nil, err
			}
			return formatCapabilityLayers(layers), nil
		},
		"RefreshClaudeCapabilityLayers": func(p json.RawMessage) (any, error) {
			if d.CapDiscovery == nil {
				return nil, nil
			}
			layers, err := d.CapDiscovery.Refresh(argString(p, 0))
			if err != nil {
				return nil, err
			}
			return formatCapabilityLayers(layers), nil
		},
		// --- Binary Path ---
		"GetClaudeBinaryPath": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return "", nil
			}
			path, _ := d.Provider.DiscoverBinary("claude")
			return path, nil
		},
		"SetClaudeBinaryPath": func(p json.RawMessage) (any, error) {
			path := argString(p, 0)
			if d.Provider != nil {
				d.Provider.SetBinaryPath("claude", path)
			}
			if d.MCP != nil {
				d.MCP.SetClaudeBinary(path)
			}
			return nil, nil
		},
	}
}

func switchSessionProviderApi(d *Deps, sessionID, providerApiID string) error {
	variables := map[string]string{
		"BASE_URL":   "",
		"AUTH_TOKEN": "",
	}
	if providerApiID != "" {
		if d.DB == nil {
			return fmt.Errorf("database not initialized")
		}
		apiConfig, err := d.DB.GetProviderApiConfig(providerApiID)
		if err != nil {
			return fmt.Errorf("failed to load provider api config %q: %w", providerApiID, err)
		}
		if apiConfig == nil {
			return fmt.Errorf("provider api config not found: %s", providerApiID)
		}
		variables["BASE_URL"] = apiConfig.BaseURL
		variables["AUTH_TOKEN"] = apiConfig.AuthToken
	}
	return d.Provider.UpdateEnvironmentVariables(sessionID, variables)
}

func formatCapabilityLayers(layers claude.CapabilityLayers) map[string]any {
	return map[string]any{
		"system":       layers.System,
		"user_only":    layers.UserOnly,
		"project_only": layers.ProjectOnly,
		"all_visible":  layers.AllVisible,
		"fetched_at":   time.Now().UTC(),
	}
}

func replayActivityOutput(activity *claudeactivity.Service, sessionID, output string) {
	if activity == nil || sessionID == "" || output == "" {
		return
	}
	scanner := bufio.NewScanner(strings.NewReader(output))
	scanner.Buffer(make([]byte, 64*1024), 10*1024*1024)
	for scanner.Scan() {
		var msg map[string]interface{}
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			continue
		}
		activity.ObserveClaudeEvent(sessionID, msg)
	}
}
