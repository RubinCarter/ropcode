package database

// ProjectChat represents a unified chat session bound to a project,
// spanning multiple provider sessions (segments).
type ProjectChat struct {
	ID              string `json:"id"`
	ProjectPath     string `json:"project_path"`
	Title           string `json:"title,omitempty"`
	ActiveProvider  string `json:"active_provider"`
	ActiveSegmentID string `json:"active_segment_id,omitempty"`
	CreatedAt       int64  `json:"created_at"`
	UpdatedAt       int64  `json:"updated_at"`
}

// ChatSegment represents one provider session within a ProjectChat.
type ChatSegment struct {
	ID                string `json:"id"`
	ProjectChatID     string `json:"project_chat_id"`
	Provider          string `json:"provider"`
	Model             string `json:"model,omitempty"`
	RuntimeSessionID  string `json:"runtime_session_id,omitempty"`
	ProviderSessionID string `json:"provider_session_id,omitempty"`
	Seq               int    `json:"seq"`
	Status            string `json:"status"`
	ContextInjected   bool   `json:"context_injected"`
	CreatedAt         int64  `json:"created_at"`
	CompletedAt       *int64 `json:"completed_at,omitempty"`
}

const (
	SegmentStatusActive      = "active"
	SegmentStatusCompleted   = "completed"
	SegmentStatusInterrupted = "interrupted"
)
