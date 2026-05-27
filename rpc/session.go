package rpc

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"ropcode/internal/claude"
	"ropcode/internal/claudeactivity"
	"ropcode/internal/database"
	"ropcode/internal/provider"
	"ropcode/internal/stream"
)

const freshSessionSentinel = "__ROP_FRESH_SESSION__"

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
			if err != nil {
				return []any{}, nil
			}
			return sessions, nil
		},
		// --- Session Lifecycle ---
		"StartProviderSession": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return "", fmt.Errorf("provider manager not initialized")
			}
			config := buildUnifiedConfig(d, argString(p, 0), argString(p, 1), argString(p, 2), argString(p, 3), argString(p, 4), argString(p, 5), "", false)
			return d.Provider.StartSession(argString(p, 0), config)
		},
		"ResumeProviderSession": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return "", fmt.Errorf("provider manager not initialized")
			}
			providerName := argString(p, 0)
			config := buildUnifiedConfig(d, providerName, argString(p, 1), argString(p, 2), argString(p, 3), argString(p, 5), argString(p, 6), argString(p, 4), true)
			return d.Provider.StartSession(providerName, config)
		},
		"SendProviderSessionMessage": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return "", fmt.Errorf("provider manager not initialized")
			}
			providerName := argString(p, 0)
			projectPath := argString(p, 1)
			sessionID := argString(p, 2)
			if providerName == "pi" {
				if resolved := d.Provider.ResolveRunningSessionID("pi", projectPath, sessionID); resolved != "" {
					sessionID = resolved
				}
			}
			if err := d.Provider.SendMessage(sessionID, argString(p, 3)); err != nil {
				return "", err
			}
			return sessionID, nil
		},
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
		"CancelClaudeExecutionByProject": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, nil
			}
			projectPath := argString(p, 0)
			for _, prov := range []string{"claude", "codex", "gemini", "deepseek"} {
				if d.Provider.IsRunningForProject(prov, projectPath) {
					if err := d.Provider.TerminateByProject(prov, projectPath); err != nil {
						if !strings.Contains(err.Error(), "no running sessions found for project:") {
							return nil, err
						}
					}
					return nil, nil
				}
			}
			if sessionID := d.Provider.GetRunningSessionForProject("pi", projectPath); sessionID != "" {
				return nil, d.Provider.InterruptSession(sessionID)
			}
			return nil, nil
		},
		// --- Interactive Claude Session ---
		"StartInteractiveClaudeSession": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return "", fmt.Errorf("provider manager not initialized")
			}
			return startInteractiveSession(d, argString(p, 0), argString(p, 1), argString(p, 2), argString(p, 3))
		},
		"SendClaudeMessage": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, fmt.Errorf("provider manager not initialized")
			}
			projectPath := argString(p, 0)
			sessionID := argString(p, 1)
			if resolved := d.Provider.ResolveRunningSessionID("claude", projectPath, sessionID); resolved != "" {
				sessionID = resolved
			}
			return nil, d.Provider.SendMessage(sessionID, argString(p, 2))
		},
		"SetClaudeSessionModel": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, fmt.Errorf("provider manager not initialized")
			}
			return nil, d.Provider.SetModel(argString(p, 0), argString(p, 1))
		},
		"SetClaudeSessionPermissionMode": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, fmt.Errorf("provider manager not initialized")
			}
			return nil, d.Provider.SetPermissionMode(argString(p, 0), argString(p, 1))
		},
		"InterruptClaudeSession": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, fmt.Errorf("provider manager not initialized")
			}
			return nil, d.Provider.InterruptSession(argString(p, 0))
		},
		"UpdateClaudeSessionEnvironment": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, fmt.Errorf("provider manager not initialized")
			}
			return nil, d.Provider.UpdateEnvironmentVariables(argString(p, 0), argObject[map[string]string](p, 1))
		},
		"SwitchClaudeSessionProviderApi": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, fmt.Errorf("provider manager not initialized")
			}
			return nil, switchSessionProviderApi(d, argString(p, 0), argString(p, 1))
		},
		"IsClaudeSessionRunning": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return false, nil
			}
			return d.Provider.IsRunning(argString(p, 0)), nil
		},
		"IsClaudeSessionRunningForProject": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return false, nil
			}
			projectPath := argString(p, 0)
			providerOrSessionID := argString(p, 1)
			switch providerOrSessionID {
			case "gemini", "codex", "deepseek", "pi":
				return d.Provider.IsRunningForProject(providerOrSessionID, projectPath), nil
			default:
				if d.Provider.IsRunning(providerOrSessionID) {
					return true, nil
				}
				return d.Provider.IsRunningForProject("claude", projectPath), nil
			}
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

// --- Session helpers ---

func buildUnifiedConfig(d *Deps, providerID, projectPath, prompt, model, providerApiID, reasoningEffort, sessionID string, resume bool) provider.SessionConfig {
	config := provider.SessionConfig{
		ProjectPath:     projectPath,
		Prompt:          prompt,
		Model:           model,
		ProviderApiID:   providerApiID,
		ResumeSessionID: sessionID,
		Resume:          resume,
	}
	if reasoningEffort != "" {
		if config.Extra == nil {
			config.Extra = make(map[string]string)
		}
		config.Extra["reasoning_effort"] = reasoningEffort
	}
	if providerID == "pi" {
		config.Interactive = true
		if reasoningEffort != "" {
			if config.Extra == nil {
				config.Extra = make(map[string]string)
			}
			config.Extra["thinking_level"] = reasoningEffort
		}
	}
	if providerApiID != "" && d.DB != nil {
		apiConfig, err := d.DB.GetProviderApiConfig(providerApiID)
		if err == nil && apiConfig != nil {
			config.AuthToken = apiConfig.AuthToken
			config.BaseURL = apiConfig.BaseURL
		}
	} else if (providerID == "deepseek" || providerID == "pi") && d.DB != nil {
		if apiConfig, _ := resolveRuntimeAPIConfig(d, providerID, providerApiID); apiConfig != nil {
			config.ProviderApiID = apiConfig.ID
			config.AuthToken = apiConfig.AuthToken
			config.BaseURL = apiConfig.BaseURL
		}
	}
	return config
}

func resolveRuntimeAPIConfig(d *Deps, providerID, providerApiID string) (*database.ProviderApiConfig, error) {
	if d.DB == nil {
		return nil, nil
	}
	if strings.TrimSpace(providerApiID) != "" {
		return d.DB.GetProviderApiConfig(providerApiID)
	}
	if cfg, err := d.DB.GetDefaultProviderApiConfig(providerID); err == nil && cfg != nil {
		return cfg, nil
	}
	all, err := d.DB.GetAllProviderApiConfigs()
	if err != nil {
		return nil, err
	}
	for _, cfg := range all {
		if cfg != nil && cfg.ProviderID == providerID {
			return cfg, nil
		}
	}
	return nil, nil
}

func startInteractiveSession(d *Deps, projectPath, model, providerApiID, resumeSessionID string) (string, error) {
	existingSessionID := d.Provider.GetRunningSessionForProject("claude", projectPath)
	resolvedResume, reuseExisting, terminateExisting, allowAutoResume := resolveInteractiveStart(resumeSessionID, existingSessionID != "")
	resumeSessionID = resolvedResume

	if reuseExisting && existingSessionID != "" {
		return existingSessionID, nil
	}
	if terminateExisting && existingSessionID != "" {
		d.Provider.TerminateSession(existingSessionID)
	}

	config := buildUnifiedConfig(d, "claude", projectPath, "", model, providerApiID, "", resumeSessionID, resumeSessionID != "")
	config.Interactive = true
	if !allowAutoResume {
		if config.Extra == nil {
			config.Extra = make(map[string]string)
		}
		config.Extra["disable_auto_resume"] = "true"
	}

	sessionID, err := d.Provider.StartSession("claude", config)
	if err != nil {
		return "", err
	}

	if d.Activity != nil {
		d.Activity.EnsureSession(sessionID, projectPath, true, claudeControlSender{mgr: d.Provider, sessionID: sessionID})
	}

	if err := d.Provider.WaitForInit(sessionID, 30*time.Second); err != nil {
		d.Provider.TerminateSession(sessionID)
		if resumeSessionID != "" && (strings.HasPrefix(err.Error(), "session init timeout") || strings.HasPrefix(err.Error(), "session exited before initialization")) {
			log.Printf("[StartInteractiveClaudeSession] Resume failed (%v), retrying without resume", err)
			config.ResumeSessionID = ""
			config.Resume = false
			retryID, retryErr := d.Provider.StartSession("claude", config)
			if retryErr != nil {
				return "", fmt.Errorf("interactive session initialization failed: %w", retryErr)
			}
			if initErr := d.Provider.WaitForInit(retryID, 30*time.Second); initErr != nil {
				d.Provider.TerminateSession(retryID)
				return "", fmt.Errorf("interactive session initialization failed: %w", initErr)
			}
			return retryID, nil
		}
		return "", fmt.Errorf("interactive session initialization failed: %w", err)
	}

	return sessionID, nil
}

func resolveInteractiveStart(resumeSessionID string, hasExisting bool) (string, bool, bool, bool) {
	forceFresh := resumeSessionID == freshSessionSentinel
	if forceFresh {
		resumeSessionID = ""
	}
	if !hasExisting {
		return resumeSessionID, false, false, !forceFresh
	}
	if forceFresh {
		return resumeSessionID, false, true, false
	}
	return resumeSessionID, true, false, true
}

func switchSessionProviderApi(d *Deps, sessionID, providerApiID string) error {
	variables := map[string]string{
		"ANTHROPIC_BASE_URL":   "",
		"ANTHROPIC_AUTH_TOKEN": "",
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
		variables["ANTHROPIC_BASE_URL"] = apiConfig.BaseURL
		variables["ANTHROPIC_AUTH_TOKEN"] = apiConfig.AuthToken
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

type claudeControlSender struct {
	mgr       *provider.Manager
	sessionID string
}

func (s claudeControlSender) SendStopTask(requestID, taskID string) error {
	if s.mgr == nil {
		return fmt.Errorf("provider manager not initialized")
	}
	envelope := map[string]interface{}{
		"type":       "control_request",
		"request_id": requestID,
		"request": map[string]interface{}{
			"subtype": "stop_task",
			"task_id": taskID,
		},
	}
	data, _ := json.Marshal(envelope)
	data = append(data, '\n')
	return s.mgr.WriteStdin(s.sessionID, data)
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
