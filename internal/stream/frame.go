package stream

type FrameKind string

const (
	FrameKindInit     FrameKind = "init"
	FrameKindMessage  FrameKind = "message"
	FrameKindDelta    FrameKind = "delta"
	FrameKindTool     FrameKind = "tool"
	FrameKindResult   FrameKind = "result"
	FrameKindError    FrameKind = "error"
	FrameKindMetadata FrameKind = "metadata"
)

type FrameOperation string

const (
	FrameOperationAppend FrameOperation = "append"
	FrameOperationUpsert FrameOperation = "upsert"
)

type Role string

const (
	RoleAssistant Role = "assistant"
	RoleUser      Role = "user"
	RoleSystem    Role = "system"
	RoleTool      Role = "tool"
)

type SessionFrame struct {
	StreamID          string           `json:"streamId"`
	FrameID           string           `json:"frameId"`
	MessageID         string           `json:"messageId,omitempty"`
	Operation         FrameOperation   `json:"operation,omitempty"`
	Provider          string           `json:"provider"`
	RuntimeSessionID  string           `json:"runtimeSessionId"`
	ProviderSessionID string           `json:"providerSessionId,omitempty"`
	Cwd               string           `json:"cwd,omitempty"`
	ProjectPath       string           `json:"projectPath,omitempty"`
	Seq               int64            `json:"seq"`
	Timestamp         string           `json:"timestamp,omitempty"`
	Kind              FrameKind        `json:"kind"`
	Role              Role             `json:"role,omitempty"`
	Subtype           string           `json:"subtype,omitempty"`
	Content           []ContentBlock   `json:"content"`
	ParentToolUseID   string           `json:"parentToolUseId,omitempty"`
	TaskID            string           `json:"taskId,omitempty"`
	ToolUseID         string           `json:"toolUseId,omitempty"`
	AgentID           string           `json:"agentId,omitempty"`
	Sidechain         bool             `json:"sidechain,omitempty"`
	Success           *bool            `json:"success,omitempty"`
	Error             string           `json:"error,omitempty"`
	IsError           bool             `json:"isError,omitempty"`
	DurationMs        int64            `json:"durationMs,omitempty"`
	Result            string           `json:"result,omitempty"`
	Usage             *Usage           `json:"usage,omitempty"`
	Runtime           *RuntimeSnapshot `json:"runtime,omitempty"`
	Meta              Meta             `json:"meta,omitempty"`
}

type Meta struct {
	Raw map[string]any `json:"raw,omitempty"`
}
