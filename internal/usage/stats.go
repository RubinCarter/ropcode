// internal/usage/stats.go
package usage

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Claude 4 pricing constants (per million tokens)
const (
	// Opus 4
	Opus4InputPrice      = 15.0
	Opus4OutputPrice     = 75.0
	Opus4CacheWritePrice = 18.75
	Opus4CacheReadPrice  = 1.50

	// Sonnet 4
	Sonnet4InputPrice      = 3.0
	Sonnet4OutputPrice     = 15.0
	Sonnet4CacheWritePrice = 3.75
	Sonnet4CacheReadPrice  = 0.30

	// Haiku 4
	Haiku4InputPrice      = 0.80
	Haiku4OutputPrice     = 4.0
	Haiku4CacheWritePrice = 1.0
	Haiku4CacheReadPrice  = 0.08
)

// calculateCost calculates cost based on model and token usage
func calculateCost(model string, inputTokens, outputTokens, cacheCreation, cacheRead int64) float64 {
	var inputPrice, outputPrice, cacheWritePrice, cacheReadPrice float64

	switch {
	case strings.Contains(model, "opus-4") || strings.Contains(model, "claude-opus-4"):
		inputPrice = Opus4InputPrice
		outputPrice = Opus4OutputPrice
		cacheWritePrice = Opus4CacheWritePrice
		cacheReadPrice = Opus4CacheReadPrice
	case strings.Contains(model, "sonnet-4") || strings.Contains(model, "claude-sonnet-4"):
		inputPrice = Sonnet4InputPrice
		outputPrice = Sonnet4OutputPrice
		cacheWritePrice = Sonnet4CacheWritePrice
		cacheReadPrice = Sonnet4CacheReadPrice
	case strings.Contains(model, "haiku") || strings.Contains(model, "claude-haiku"):
		inputPrice = Haiku4InputPrice
		outputPrice = Haiku4OutputPrice
		cacheWritePrice = Haiku4CacheWritePrice
		cacheReadPrice = Haiku4CacheReadPrice
	default:
		// Return 0 for unknown models
		return 0.0
	}

	// Calculate cost (prices are per million tokens)
	cost := (float64(inputTokens) * inputPrice / 1_000_000.0) +
		(float64(outputTokens) * outputPrice / 1_000_000.0) +
		(float64(cacheCreation) * cacheWritePrice / 1_000_000.0) +
		(float64(cacheRead) * cacheReadPrice / 1_000_000.0)

	return cost
}

// UsageEntry represents a single usage record from Claude JSONL logs
type UsageEntry struct {
	Model         string    `json:"model"`
	InputTokens   int64     `json:"input_tokens"`
	OutputTokens  int64     `json:"output_tokens"`
	CacheCreation int64     `json:"cache_creation_tokens"`
	CacheRead     int64     `json:"cache_read_tokens"`
	Timestamp     time.Time `json:"timestamp"`
	SessionID     string    `json:"session_id"`
	ProjectPath   string    `json:"project_path"`
	CostUSD       float64   `json:"cost_usd"`
}

// ModelStats represents aggregated statistics for a specific model
type ModelStats struct {
	Model              string `json:"model"`
	TotalTokens        int64  `json:"total_tokens"`
	TotalInputTokens   int64  `json:"total_input_tokens"`
	TotalOutputTokens  int64  `json:"total_output_tokens"`
	TotalCacheCreation int64  `json:"total_cache_creation_tokens"`
	TotalCacheRead     int64  `json:"total_cache_read_tokens"`
	SessionCount       int    `json:"session_count"`
}

// DayStats represents aggregated statistics for a specific day
type DayStats struct {
	Date        string   `json:"date"`
	TotalTokens int64    `json:"total_tokens"`
	TotalCost   float64  `json:"total_cost"`
	ModelsUsed  []string `json:"models_used"`
}

// ProjectStats represents aggregated statistics for a specific project
type ProjectStats struct {
	ProjectPath  string  `json:"project_path"`
	ProjectName  string  `json:"project_name"`
	TotalCost    float64 `json:"total_cost"`
	TotalTokens  int64   `json:"total_tokens"`
	SessionCount int     `json:"session_count"`
	LastUsed     string  `json:"last_used"`
}

// OverallStats represents the overall usage statistics
type OverallStats struct {
	TotalTokens            int64           `json:"total_tokens"`
	TotalInputTokens       int64           `json:"total_input_tokens"`
	TotalOutputTokens      int64           `json:"total_output_tokens"`
	TotalCacheCreation     int64           `json:"total_cache_creation_tokens"`
	TotalCacheRead         int64           `json:"total_cache_read_tokens"`
	TotalCost              float64         `json:"total_cost"`
	TotalSessions          int             `json:"total_sessions"`
	ByModel                []*ModelStats   `json:"by_model"`
	ByDay                  []*DayStats     `json:"by_day"`
	ByProject              []*ProjectStats `json:"by_project"`
}

// SessionDetail represents detailed information about a session
type SessionDetail struct {
	SessionID    string    `json:"session_id"`
	Model        string    `json:"model"`
	TotalTokens  int64     `json:"total_tokens"`
	InputTokens  int64     `json:"input_tokens"`
	OutputTokens int64     `json:"output_tokens"`
	TotalCost    float64   `json:"total_cost"`
	StartTime    time.Time `json:"start_time"`
	LastActivity time.Time `json:"last_activity"`
	MessageCount int       `json:"message_count"`
	ProjectPath  string    `json:"project_path,omitempty"`
	ProjectName  string    `json:"project_name,omitempty"`
}

// Collector collects usage statistics from Claude session logs
type Collector struct {
	claudeDir string
}

// NewCollector creates a new usage stats collector
func NewCollector(claudeDir string) *Collector {
	return &Collector{
		claudeDir: claudeDir,
	}
}

// parseJSONLLine parses a single line from a JSONL file
func parseJSONLLine(line string) (*UsageEntry, error) {
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		return nil, err
	}

	entry := &UsageEntry{}

	// Extract model from message
	if msg, ok := raw["message"].(map[string]interface{}); ok {
		if model, ok := msg["model"].(string); ok {
			entry.Model = model
		}

		// Extract usage information
		if usage, ok := msg["usage"].(map[string]interface{}); ok {
			if inputTokens, ok := usage["input_tokens"].(float64); ok {
				entry.InputTokens = int64(inputTokens)
			}
			if outputTokens, ok := usage["output_tokens"].(float64); ok {
				entry.OutputTokens = int64(outputTokens)
			}
			if cacheCreationTokens, ok := usage["cache_creation_input_tokens"].(float64); ok {
				entry.CacheCreation = int64(cacheCreationTokens)
			}
			if cacheReadTokens, ok := usage["cache_read_input_tokens"].(float64); ok {
				entry.CacheRead = int64(cacheReadTokens)
			}
		}
	}

	// Extract timestamp
	if timestampStr, ok := raw["timestamp"].(string); ok {
		if t, err := time.Parse(time.RFC3339, timestampStr); err == nil {
			entry.Timestamp = t
		}
	}

	// Extract session ID
	if sessionID, ok := raw["sessionId"].(string); ok {
		entry.SessionID = sessionID
	}

	// Extract project path from cwd
	if cwd, ok := raw["cwd"].(string); ok {
		entry.ProjectPath = cwd
	}

	// Extract cost from costUSD if available, otherwise calculate it
	if costUSD, ok := raw["costUSD"].(float64); ok {
		entry.CostUSD = costUSD
	} else if entry.Model != "" {
		// Calculate cost based on model and token usage
		entry.CostUSD = calculateCost(entry.Model, entry.InputTokens, entry.OutputTokens, entry.CacheCreation, entry.CacheRead)
	}

	return entry, nil
}

// scanJSONLFile scans a single JSONL file and extracts usage entries
func (c *Collector) scanJSONLFile(path string) ([]*UsageEntry, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var entries []*UsageEntry
	scanner := bufio.NewScanner(file)

	// Increase buffer size for large lines
	const maxCapacity = 1024 * 1024 // 1MB
	buf := make([]byte, maxCapacity)
	scanner.Buffer(buf, maxCapacity)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		entry, err := parseJSONLLine(line)
		if err != nil {
			// Skip invalid lines
			continue
		}

		// Only include entries with usage data
		if entry.Model != "" && (entry.InputTokens > 0 || entry.OutputTokens > 0) {
			entries = append(entries, entry)
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return entries, nil
}

// scanAllJSONLFiles scans all JSONL files in the Claude projects directory
func (c *Collector) scanAllJSONLFiles() ([]*UsageEntry, error) {
	projectsDir := filepath.Join(c.claudeDir, "projects")

	// Check if projects directory exists
	if _, err := os.Stat(projectsDir); os.IsNotExist(err) {
		return []*UsageEntry{}, nil
	}

	var allEntries []*UsageEntry

	err := filepath.Walk(projectsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}

		// Only process .jsonl files
		if !info.IsDir() && strings.HasSuffix(path, ".jsonl") {
			entries, err := c.scanJSONLFile(path)
			if err != nil {
				// Log error but continue
				return nil
			}
			allEntries = append(allEntries, entries...)
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return allEntries, nil
}

// CollectStats collects overall usage statistics
func (c *Collector) CollectStats() (*OverallStats, error) {
	entries, err := c.scanAllJSONLFiles()
	if err != nil {
		return nil, err
	}

	return c.aggregateStats(entries), nil
}

// CollectStatsByDateRange collects usage statistics for a specific date range
func (c *Collector) CollectStatsByDateRange(startDate, endDate time.Time) (*OverallStats, error) {
	entries, err := c.scanAllJSONLFiles()
	if err != nil {
		return nil, err
	}

	// Filter by date range
	var filtered []*UsageEntry
	for _, entry := range entries {
		if !entry.Timestamp.IsZero() &&
			!entry.Timestamp.Before(startDate) &&
			!entry.Timestamp.After(endDate) {
			filtered = append(filtered, entry)
		}
	}

	return c.aggregateStats(filtered), nil
}

// aggregateStats aggregates usage entries into overall statistics
func (c *Collector) aggregateStats(entries []*UsageEntry) *OverallStats {
	stats := &OverallStats{
		ByModel:   make([]*ModelStats, 0),
		ByDay:     make([]*DayStats, 0),
		ByProject: make([]*ProjectStats, 0),
	}

	if len(entries) == 0 {
		return stats
	}

	// Aggregate by model
	modelMap := make(map[string]*ModelStats)
	sessionsByModel := make(map[string]map[string]bool)

	// Aggregate by day
	dayMap := make(map[string]*DayStats)
	modelsPerDay := make(map[string]map[string]bool)

	// Aggregate by project
	projectMap := make(map[string]*ProjectStats)

	for _, entry := range entries {
		// Total tokens
		totalTokens := entry.InputTokens + entry.OutputTokens + entry.CacheCreation + entry.CacheRead
		stats.TotalTokens += totalTokens
		stats.TotalInputTokens += entry.InputTokens
		stats.TotalOutputTokens += entry.OutputTokens
		stats.TotalCacheCreation += entry.CacheCreation
		stats.TotalCacheRead += entry.CacheRead
		stats.TotalCost += entry.CostUSD

		// By model
		if entry.Model != "" {
			if _, exists := modelMap[entry.Model]; !exists {
				modelMap[entry.Model] = &ModelStats{
					Model: entry.Model,
				}
				sessionsByModel[entry.Model] = make(map[string]bool)
			}
			ms := modelMap[entry.Model]
			ms.TotalTokens += totalTokens
			ms.TotalInputTokens += entry.InputTokens
			ms.TotalOutputTokens += entry.OutputTokens
			ms.TotalCacheCreation += entry.CacheCreation
			ms.TotalCacheRead += entry.CacheRead

			if entry.SessionID != "" {
				sessionsByModel[entry.Model][entry.SessionID] = true
			}
		}

		// By day
		if !entry.Timestamp.IsZero() {
			dateStr := entry.Timestamp.Format("2006-01-02")
			if _, exists := dayMap[dateStr]; !exists {
				dayMap[dateStr] = &DayStats{
					Date: dateStr,
				}
				modelsPerDay[dateStr] = make(map[string]bool)
			}
			ds := dayMap[dateStr]
			ds.TotalTokens += totalTokens
			ds.TotalCost += entry.CostUSD

			if entry.Model != "" {
				modelsPerDay[dateStr][entry.Model] = true
			}
		}

		// By project
		if entry.ProjectPath != "" {
			if _, exists := projectMap[entry.ProjectPath]; !exists {
				// Extract project name from path
				projectName := entry.ProjectPath
				if idx := strings.LastIndex(entry.ProjectPath, "/"); idx >= 0 {
					projectName = entry.ProjectPath[idx+1:]
				}
				projectMap[entry.ProjectPath] = &ProjectStats{
					ProjectPath: entry.ProjectPath,
					ProjectName: projectName,
				}
			}
			ps := projectMap[entry.ProjectPath]
			ps.TotalTokens += totalTokens
			ps.TotalCost += entry.CostUSD
			ps.SessionCount++
			// Update last used timestamp
			if !entry.Timestamp.IsZero() {
				timestampStr := entry.Timestamp.Format(time.RFC3339)
				if timestampStr > ps.LastUsed {
					ps.LastUsed = timestampStr
				}
			}
		}
	}

	// Convert maps to slices and count sessions
	allSessions := make(map[string]bool)
	for model, ms := range modelMap {
		ms.SessionCount = len(sessionsByModel[model])
		stats.ByModel = append(stats.ByModel, ms)

		// Track all unique sessions
		for sessionID := range sessionsByModel[model] {
			allSessions[sessionID] = true
		}
	}
	stats.TotalSessions = len(allSessions)

	for dateStr, ds := range dayMap {
		for model := range modelsPerDay[dateStr] {
			ds.ModelsUsed = append(ds.ModelsUsed, model)
		}
		sort.Strings(ds.ModelsUsed)
		stats.ByDay = append(stats.ByDay, ds)
	}

	for _, ps := range projectMap {
		stats.ByProject = append(stats.ByProject, ps)
	}

	// Sort results
	sort.Slice(stats.ByModel, func(i, j int) bool {
		return stats.ByModel[i].TotalTokens > stats.ByModel[j].TotalTokens
	})
	sort.Slice(stats.ByDay, func(i, j int) bool {
		return stats.ByDay[i].Date > stats.ByDay[j].Date
	})
	sort.Slice(stats.ByProject, func(i, j int) bool {
		return stats.ByProject[i].TotalCost > stats.ByProject[j].TotalCost
	})

	return stats
}

// CollectSessionStats collects statistics for individual sessions
func (c *Collector) CollectSessionStats() ([]*SessionDetail, error) {
	entries, err := c.scanAllJSONLFiles()
	if err != nil {
		return nil, err
	}

	return c.aggregateSessionDetails(entries), nil
}

// aggregateSessionDetails aggregates usage entries into session details
func (c *Collector) aggregateSessionDetails(entries []*UsageEntry) []*SessionDetail {
	sessionMap := make(map[string]*SessionDetail)

	for _, entry := range entries {
		if entry.SessionID == "" {
			continue
		}

		if _, exists := sessionMap[entry.SessionID]; !exists {
			// Extract project name from path
			projectName := ""
			if entry.ProjectPath != "" {
				if idx := strings.LastIndex(entry.ProjectPath, "/"); idx >= 0 {
					projectName = entry.ProjectPath[idx+1:]
				} else {
					projectName = entry.ProjectPath
				}
			}

			sessionMap[entry.SessionID] = &SessionDetail{
				SessionID:    entry.SessionID,
				Model:        entry.Model,
				StartTime:    entry.Timestamp,
				LastActivity: entry.Timestamp,
				ProjectPath:  entry.ProjectPath,
				ProjectName:  projectName,
			}
		}

		detail := sessionMap[entry.SessionID]
		detail.TotalTokens += entry.InputTokens + entry.OutputTokens + entry.CacheCreation + entry.CacheRead
		detail.InputTokens += entry.InputTokens
		detail.OutputTokens += entry.OutputTokens
		detail.TotalCost += entry.CostUSD
		detail.MessageCount++

		// Update model if not set
		if detail.Model == "" && entry.Model != "" {
			detail.Model = entry.Model
		}

		// Update project path if not set but entry has one
		if detail.ProjectPath == "" && entry.ProjectPath != "" {
			detail.ProjectPath = entry.ProjectPath
			if idx := strings.LastIndex(entry.ProjectPath, "/"); idx >= 0 {
				detail.ProjectName = entry.ProjectPath[idx+1:]
			} else {
				detail.ProjectName = entry.ProjectPath
			}
		}

		// Update timestamps
		if entry.Timestamp.Before(detail.StartTime) {
			detail.StartTime = entry.Timestamp
		}
		if entry.Timestamp.After(detail.LastActivity) {
			detail.LastActivity = entry.Timestamp
		}
	}

	// Convert map to slice
	var sessions []*SessionDetail
	for _, detail := range sessionMap {
		sessions = append(sessions, detail)
	}

	// Sort by last activity (most recent first)
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].LastActivity.After(sessions[j].LastActivity)
	})

	return sessions
}

// CollectUsageDetails collects detailed usage records with a limit
func (c *Collector) CollectUsageDetails(limit int) ([]*UsageEntry, error) {
	entries, err := c.scanAllJSONLFiles()
	if err != nil {
		return nil, err
	}

	// Sort by timestamp (most recent first)
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Timestamp.After(entries[j].Timestamp)
	})

	// Apply limit
	if limit > 0 && limit < len(entries) {
		entries = entries[:limit]
	}

	return entries, nil
}
