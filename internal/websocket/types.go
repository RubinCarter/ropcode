// internal/websocket/types.go
package websocket

// RPCRequest 表示从前端发来的 RPC 请求
type RPCRequest struct {
	ID     string        `json:"id"`     // 请求 ID，用于匹配响应
	Method string        `json:"method"` // 方法名，如 "CreatePtySession"
	Params []interface{} `json:"params"` // 参数数组
}

// RPCResponse 表示返回给前端的 RPC 响应
type RPCResponse struct {
	ID     string      `json:"id"`               // 对应请求的 ID
	Result interface{} `json:"result,omitempty"` // 成功时的返回值
	Error  string      `json:"error,omitempty"`  // 失败时的错误信息
}

// WSEvent 表示后端主动推送的事件
type WSEvent struct {
	Type    string      `json:"type"`    // 事件类型，如 "claude-output"
	Payload interface{} `json:"payload"` // 事件数据
}

// WSMessage 是 WebSocket 消息的统一封装
type WSMessage struct {
	// 消息类型: "rpc_request", "rpc_response", "event"
	Kind string `json:"kind"`

	// RPC 请求 (kind == "rpc_request")
	Request *RPCRequest `json:"request,omitempty"`

	// RPC 响应 (kind == "rpc_response")
	Response *RPCResponse `json:"response,omitempty"`

	// 事件 (kind == "event")
	Event *WSEvent `json:"event,omitempty"`
}
