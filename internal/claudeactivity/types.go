package claudeactivity

import "time"

type ActivityStatus string

const (
	ActivityStatusRunning     ActivityStatus = "running"
	ActivityStatusStopping    ActivityStatus = "stopping"
	ActivityStatusCompleted   ActivityStatus = "completed"
	ActivityStatusFailed      ActivityStatus = "failed"
	ActivityStatusStopped     ActivityStatus = "stopped"
	ActivityStatusStale       ActivityStatus = "stale"
	ActivityStatusStopUnknown ActivityStatus = "stop_unknown"
)

type ActivityType string

const (
	ActivityTypeLocalAgent ActivityType = "local_agent"
	ActivityTypeLocalBash  ActivityType = "local_bash"
	ActivityTypeOther      ActivityType = "other"
)

type Usage struct {
	InputTokens              int `json:"input_tokens,omitempty"`
	OutputTokens             int `json:"output_tokens,omitempty"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens,omitempty"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens,omitempty"`
	TotalTokens              int `json:"total_tokens,omitempty"`
	ToolUses                 int `json:"tool_uses,omitempty"`
}

type Activity struct {
	ID           string         `json:"id"`
	Type         ActivityType   `json:"type"`
	TaskType     string         `json:"task_type"`
	Description  string         `json:"description,omitempty"`
	Summary      string         `json:"summary,omitempty"`
	Status       ActivityStatus `json:"status"`
	StartedAt    *time.Time     `json:"started_at,omitempty"`
	UpdatedAt    time.Time      `json:"updated_at"`
	EndedAt      *time.Time     `json:"ended_at,omitempty"`
	OutputFile   string         `json:"output_file,omitempty"`
	Async        bool           `json:"async,omitempty"`
	LastActivity string         `json:"last_activity,omitempty"`
	Usage        Usage          `json:"usage,omitempty"`
	PID          *int           `json:"pid"`
	CanStop      bool           `json:"can_stop"`
	Error        string         `json:"error,omitempty"`
}

type Snapshot struct {
	SessionID       string     `json:"session_id"`
	ProjectPath     string     `json:"project_path"`
	Activities      []Activity `json:"activities"`
	Subagents       []Activity `json:"subagents"`
	BackgroundTasks []Activity `json:"background_tasks"`
	Other           []Activity `json:"other"`
	RunningCount    int        `json:"running_count"`
	StoppingCount   int        `json:"stopping_count"`
	FailedCount     int        `json:"failed_count"`
}

type LogTail struct {
	SessionID      string `json:"session_id"`
	ActivityID     string `json:"activity_id"`
	Path           string `json:"path,omitempty"`
	Content        string `json:"content"`
	LineCount      int    `json:"line_count"`
	TruncatedLines int    `json:"truncated_lines"`
	TruncatedBytes int64  `json:"truncated_bytes"`
	Error          string `json:"error,omitempty"`
	PathExists     bool   `json:"path_exists"`
	BytesRead      int64  `json:"bytes_read"`
	RequestedLines int    `json:"requested_lines"`
	ResolvedBy     string `json:"resolved_by,omitempty"`
}

type SubagentLogChunk struct {
	SessionID       string   `json:"session_id"`
	ActivityID      string   `json:"activity_id"`
	Lines           []string `json:"lines"`
	NextLineIndex   int      `json:"next_line_index"`
	TotalLines      int      `json:"total_lines"`
	TruncatedBefore int      `json:"truncated_before"`
	FileMissing     bool     `json:"file_missing"`
	Path            string   `json:"path,omitempty"`
	ResolvedBy      string   `json:"resolved_by,omitempty"`
}
