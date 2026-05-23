package stream

type ContentType string

const (
	ContentText       ContentType = "text"
	ContentThinking   ContentType = "thinking"
	ContentToolUse    ContentType = "tool_use"
	ContentToolResult ContentType = "tool_result"
	ContentSystem     ContentType = "system"
	ContentResult     ContentType = "result"
	ContentError      ContentType = "error"
)

type ContentBlock struct {
	Type      ContentType    `json:"type"`
	Text      string         `json:"text,omitempty"`
	ToolUseID string         `json:"toolUseId,omitempty"`
	Name      string         `json:"name,omitempty"`
	Input     map[string]any `json:"input,omitempty"`
	Output    any            `json:"output,omitempty"`
	IsError   bool           `json:"isError,omitempty"`
}
