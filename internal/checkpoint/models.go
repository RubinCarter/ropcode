// internal/checkpoint/models.go
package checkpoint

import "time"

// Checkpoint represents a saved checkpoint in a session
type Checkpoint struct {
	ID                 string    `json:"id"`
	SessionID          string    `json:"session_id"`
	ParentCheckpointID string    `json:"parent_checkpoint_id,omitempty"`
	MessageIndex       int       `json:"message_index"`
	Timestamp          time.Time `json:"timestamp"`
	Description        string    `json:"description,omitempty"`
	TriggerType        string    `json:"trigger_type"`
}

// FileSnapshot represents a file at a specific checkpoint
type FileSnapshot struct {
	CheckpointID string `json:"checkpoint_id"`
	FilePath     string `json:"file_path"`
	Content      string `json:"content"`
	Hash         string `json:"hash"`
	IsDeleted    bool   `json:"is_deleted"`
	Permissions  uint32 `json:"permissions,omitempty"`
	Size         int64  `json:"size"`
}

// CheckpointResult represents the result of a checkpoint operation
type CheckpointResult struct {
	Checkpoint     *Checkpoint `json:"checkpoint"`
	FilesProcessed int         `json:"files_processed"`
	Warnings       []string    `json:"warnings,omitempty"`
}

// SessionTimeline represents the checkpoint timeline for a session
type SessionTimeline struct {
	SessionID           string        `json:"session_id"`
	RootNode            *TimelineNode `json:"root_node,omitempty"`
	CurrentCheckpointID string        `json:"current_checkpoint_id,omitempty"`
	TotalCheckpoints    int           `json:"total_checkpoints"`
}

// TimelineNode represents a node in the checkpoint tree
type TimelineNode struct {
	Checkpoint      Checkpoint     `json:"checkpoint"`
	Children        []TimelineNode `json:"children"`
	FileSnapshotIDs []string       `json:"file_snapshot_ids"`
}
