package main

import (
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"ropcode/internal/claude"
	"ropcode/internal/codex"
)

type SpaceSessionsResult struct {
	Sessions []ProviderSessionSummary `json:"sessions"`
	HasMore  bool                     `json:"has_more"`
}

type ProviderSessionSummary struct {
	ID           string `json:"id"`
	Provider     string `json:"provider"`
	ProjectPath  string `json:"project_path"`
	ProjectID    string `json:"project_id,omitempty"`
	CreatedAt    int64  `json:"created_at"`
	LastActivity int64  `json:"last_activity"`
	Title        string `json:"title,omitempty"`
	FirstMessage string `json:"first_message,omitempty"`
	IsRunning    bool   `json:"is_running"`
}

type spaceSessionScanner struct {
	provider string
	scan     func(projectPath string, limit int) (spaceSessionScanResult, error)
}

type spaceSessionScanResult struct {
	sessions []ProviderSessionSummary
	hasMore  bool
}

func buildSpaceSessions(sessions []ProviderSessionSummary, limit int) SpaceSessionsResult {
	sort.SliceStable(sessions, func(i, j int) bool {
		if sessions[i].LastActivity == sessions[j].LastActivity {
			return sessions[i].CreatedAt > sessions[j].CreatedAt
		}
		return sessions[i].LastActivity > sessions[j].LastActivity
	})

	hasMore := false
	if limit > 0 && len(sessions) > limit {
		hasMore = true
		sessions = sessions[:limit]
	}

	return SpaceSessionsResult{
		Sessions: sessions,
		HasMore:  hasMore,
	}
}

func listSpaceSessionsFromScanners(projectPath string, limit int, scanners []spaceSessionScanner) (SpaceSessionsResult, error) {
	sessions := make([]ProviderSessionSummary, 0)
	failures := 0
	providerHasMore := false

	for _, scanner := range scanners {
		providerResult, err := scanner.scan(projectPath, limit)
		if err != nil {
			failures++
			log.Printf("[ListSpaceSessions] Failed to list %s sessions for %s: %v", scanner.provider, projectPath, err)
			continue
		}
		sessions = append(sessions, providerResult.sessions...)
		providerHasMore = providerHasMore || providerResult.hasMore
	}

	if failures == len(scanners) && len(scanners) > 0 {
		return SpaceSessionsResult{}, fmt.Errorf("failed to list sessions from all providers")
	}

	result := buildSpaceSessions(sessions, limit)
	result.HasMore = result.HasMore || providerHasMore
	return result, nil
}

func newClaudeSpaceSessionSummary(s claude.SessionInfo, isRunning bool) ProviderSessionSummary {
	lastActivity := parseSessionActivityTime(s.MessageTimestamp, s.CreatedAt)
	title := strings.TrimSpace(s.FirstMessage)
	return ProviderSessionSummary{
		ID:           s.ID,
		Provider:     "claude",
		ProjectPath:  s.ProjectPath,
		ProjectID:    s.ProjectID,
		CreatedAt:    s.CreatedAt,
		LastActivity: lastActivity,
		Title:        title,
		FirstMessage: title,
		IsRunning:    isRunning,
	}
}

func newCodexSpaceSessionSummary(s codex.SessionInfo, isRunning bool) ProviderSessionSummary {
	title := strings.TrimSpace(s.FirstMessage)
	return ProviderSessionSummary{
		ID:           s.ID,
		Provider:     "codex",
		ProjectPath:  s.ProjectPath,
		ProjectID:    s.ProjectID,
		CreatedAt:    s.CreatedAt,
		LastActivity: parseSessionActivityTime(s.MessageTimestamp, s.CreatedAt),
		Title:        title,
		FirstMessage: title,
		IsRunning:    isRunning,
	}
}

func parseSessionActivityTime(timestamp string, fallback int64) int64 {
	if strings.TrimSpace(timestamp) == "" {
		return fallback
	}
	formats := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.000Z",
		"2006-01-02T15:04:05Z",
	}
	for _, format := range formats {
		if t, err := time.Parse(format, timestamp); err == nil {
			return t.Unix()
		}
	}
	return fallback
}
