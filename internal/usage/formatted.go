package usage

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type FormattedModelStat struct {
	Model               string  `json:"model"`
	TotalTokens         int64   `json:"total_tokens"`
	TotalInputTokens    int64   `json:"total_input_tokens"`
	TotalOutputTokens   int64   `json:"total_output_tokens"`
	TotalCacheCreation  int64   `json:"total_cache_creation_tokens"`
	TotalCacheRead      int64   `json:"total_cache_read_tokens"`
	SessionCount        int     `json:"session_count"`
	TotalCost           float64 `json:"total_cost"`
	InputTokens         int64   `json:"input_tokens"`
	OutputTokens        int64   `json:"output_tokens"`
	CacheCreationTokens int64   `json:"cache_creation_tokens"`
	CacheReadTokens     int64   `json:"cache_read_tokens"`
}

type FormattedStats struct {
	TotalTokens              int64                `json:"total_tokens"`
	TotalInputTokens         int64                `json:"total_input_tokens"`
	TotalOutputTokens        int64                `json:"total_output_tokens"`
	TotalSessions            int                  `json:"total_sessions"`
	TotalCacheCreationTokens int64                `json:"total_cache_creation_tokens"`
	TotalCacheReadTokens     int64                `json:"total_cache_read_tokens"`
	TotalCost                float64              `json:"total_cost"`
	ByModel                  []FormattedModelStat `json:"by_model"`
	ByDay                    []*DayStats          `json:"by_day"`
	ByDate                   []*DayStats          `json:"by_date"`
	ByProject                []*ProjectStats      `json:"by_project"`
}

const formattedStatsCacheTTL = 30 * time.Second

var formattedStatsCache = struct {
	sync.Mutex
	items map[string]formattedStatsCacheEntry
}{
	items: make(map[string]formattedStatsCacheEntry),
}

type formattedStatsCacheEntry struct {
	value     any
	createdAt time.Time
}

func getFormattedStatsCache[T any](key string) (T, bool) {
	formattedStatsCache.Lock()
	defer formattedStatsCache.Unlock()

	var zero T
	entry, ok := formattedStatsCache.items[key]
	if !ok || time.Since(entry.createdAt) > formattedStatsCacheTTL {
		return zero, false
	}
	value, ok := entry.value.(T)
	if !ok {
		return zero, false
	}
	return value, true
}

func setFormattedStatsCache(key string, value any) {
	formattedStatsCache.Lock()
	defer formattedStatsCache.Unlock()
	formattedStatsCache.items[key] = formattedStatsCacheEntry{
		value:     value,
		createdAt: time.Now(),
	}
}

func GetFormattedStats() (*FormattedStats, error) {
	if cached, ok := getFormattedStatsCache[*FormattedStats]("stats:all"); ok {
		return cached, nil
	}

	claudeDir, err := claudeHomeDir()
	if err != nil {
		return nil, err
	}
	collector := NewCollector(claudeDir)
	stats, err := collector.CollectStats()
	if err != nil {
		return nil, fmt.Errorf("failed to collect usage stats: %w", err)
	}
	formatted := formatStats(stats)
	setFormattedStatsCache("stats:all", formatted)
	return formatted, nil
}

func GetFormattedStatsByDateRange(start, end string) (*FormattedStats, error) {
	cacheKey := fmt.Sprintf("stats:%s:%s", start, end)
	if cached, ok := getFormattedStatsCache[*FormattedStats](cacheKey); ok {
		return cached, nil
	}

	startDate, err := time.Parse("2006-01-02", start)
	if err != nil {
		return nil, fmt.Errorf("invalid start date format: %w", err)
	}
	endDate, err := time.Parse("2006-01-02", end)
	if err != nil {
		return nil, fmt.Errorf("invalid end date format: %w", err)
	}
	endDate = endDate.Add(24*time.Hour - time.Second)

	claudeDir, err := claudeHomeDir()
	if err != nil {
		return nil, err
	}
	collector := NewCollector(claudeDir)
	stats, err := collector.CollectStatsByDateRange(startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("failed to collect usage stats: %w", err)
	}
	formatted := formatStats(stats)
	setFormattedStatsCache(cacheKey, formatted)
	return formatted, nil
}

func GetSessionStats() ([]interface{}, error) {
	if cached, ok := getFormattedStatsCache[[]interface{}]("sessions:all"); ok {
		return cached, nil
	}

	claudeDir, err := claudeHomeDir()
	if err != nil {
		return nil, err
	}
	collector := NewCollector(claudeDir)
	sessions, err := collector.CollectSessionStats()
	if err != nil {
		return nil, fmt.Errorf("failed to collect session stats: %w", err)
	}
	result := make([]interface{}, 0, len(sessions))
	for _, s := range sessions {
		result = append(result, s)
	}
	setFormattedStatsCache("sessions:all", result)
	return result, nil
}

func GetSessionStatsByDateRange(start, end string) ([]interface{}, error) {
	cacheKey := fmt.Sprintf("sessions:%s:%s", start, end)
	if cached, ok := getFormattedStatsCache[[]interface{}](cacheKey); ok {
		return cached, nil
	}

	startDate, err := time.Parse("2006-01-02", start)
	if err != nil {
		return nil, fmt.Errorf("invalid start date format: %w", err)
	}
	endDate, err := time.Parse("2006-01-02", end)
	if err != nil {
		return nil, fmt.Errorf("invalid end date format: %w", err)
	}
	endDate = endDate.Add(24*time.Hour - time.Second)

	claudeDir, err := claudeHomeDir()
	if err != nil {
		return nil, err
	}
	collector := NewCollector(claudeDir)
	sessions, err := collector.CollectSessionStatsByDateRange(startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("failed to collect session stats: %w", err)
	}
	result := make([]interface{}, 0, len(sessions))
	for _, s := range sessions {
		result = append(result, s)
	}
	setFormattedStatsCache(cacheKey, result)
	return result, nil
}

func GetUsageDetails(limit int) ([]interface{}, error) {
	claudeDir, err := claudeHomeDir()
	if err != nil {
		return nil, err
	}
	collector := NewCollector(claudeDir)
	entries, err := collector.CollectUsageDetails(limit)
	if err != nil {
		return nil, fmt.Errorf("failed to collect usage details: %w", err)
	}
	result := make([]interface{}, 0, len(entries))
	for _, e := range entries {
		result = append(result, e)
	}
	return result, nil
}

func formatStats(stats *OverallStats) *FormattedStats {
	var totalCost float64

	byModel := make([]FormattedModelStat, 0, len(stats.ByModel))
	for _, ms := range stats.ByModel {
		modelCost := calculateCost(ms.Model, ms.TotalInputTokens, ms.TotalOutputTokens, ms.TotalCacheCreation, ms.TotalCacheRead)
		totalCost += modelCost
		byModel = append(byModel, FormattedModelStat{
			Model:               ms.Model,
			TotalTokens:         ms.TotalTokens,
			TotalInputTokens:    ms.TotalInputTokens,
			TotalOutputTokens:   ms.TotalOutputTokens,
			TotalCacheCreation:  ms.TotalCacheCreation,
			TotalCacheRead:      ms.TotalCacheRead,
			SessionCount:        ms.SessionCount,
			TotalCost:           modelCost,
			InputTokens:         ms.TotalInputTokens,
			OutputTokens:        ms.TotalOutputTokens,
			CacheCreationTokens: ms.TotalCacheCreation,
			CacheReadTokens:     ms.TotalCacheRead,
		})
	}

	byDay := stats.ByDay
	for _, ds := range byDay {
		if ds.TotalCost == 0 {
			ds.TotalCost = float64(ds.TotalTokens) * 9.0 / 1_000_000
		}
	}

	if stats.TotalCost > 0 {
		totalCost = stats.TotalCost
	}

	return &FormattedStats{
		TotalTokens:              stats.TotalTokens,
		TotalInputTokens:         stats.TotalInputTokens,
		TotalOutputTokens:        stats.TotalOutputTokens,
		TotalSessions:            stats.TotalSessions,
		TotalCacheCreationTokens: stats.TotalCacheCreation,
		TotalCacheReadTokens:     stats.TotalCacheRead,
		TotalCost:                totalCost,
		ByModel:                  byModel,
		ByDay:                    byDay,
		ByDate:                   byDay,
		ByProject:                stats.ByProject,
	}
}

func claudeHomeDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	return filepath.Join(homeDir, ".claude"), nil
}
