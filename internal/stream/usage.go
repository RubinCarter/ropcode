package stream

type Usage struct {
	InputTokens      int `json:"inputTokens,omitempty"`
	OutputTokens     int `json:"outputTokens,omitempty"`
	CacheReadTokens  int `json:"cacheReadTokens,omitempty"`
	CacheWriteTokens int `json:"cacheWriteTokens,omitempty"`
	TotalTokens      int `json:"totalTokens,omitempty"`
	ToolUseCount     int `json:"toolUseCount,omitempty"`
}

type RuntimeSnapshot struct {
	Phase        string         `json:"phase,omitempty"`
	ActiveTool   string         `json:"activeTool,omitempty"`
	ProgressText string         `json:"progressText,omitempty"`
	Retry        *RetrySnapshot `json:"retry,omitempty"`
	RateLimit    *RateLimit     `json:"rateLimit,omitempty"`
	WaitingOn    string         `json:"waitingOn,omitempty"`
}

type RetrySnapshot struct {
	Attempt     int   `json:"attempt,omitempty"`
	MaxAttempts int   `json:"maxAttempts,omitempty"`
	NextRetryMs int64 `json:"nextRetryMs,omitempty"`
}

type RateLimit struct {
	ResetAt     string `json:"resetAt,omitempty"`
	RemainingMs int64  `json:"remainingMs,omitempty"`
}
