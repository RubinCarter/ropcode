// internal/websocket/client.go
package websocket

import (
	"encoding/json"
	"sync"

	"github.com/gorilla/websocket"
)

// Client 表示一个 WebSocket 客户端连接
type Client struct {
	ID   string
	Conn *websocket.Conn
	Send chan []byte
	mu   sync.Mutex
}

// NewClient 创建新的客户端
func NewClient(id string, conn *websocket.Conn) *Client {
	return &Client{
		ID:   id,
		Conn: conn,
		Send: make(chan []byte, 256),
	}
}

// SendMessage 向客户端发送消息
func (c *Client) SendMessage(msg *WSMessage) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	select {
	case c.Send <- data:
		return nil
	default:
		return ErrClientBufferFull
	}
}

// SendEvent 向客户端发送事件
func (c *Client) SendEvent(eventType string, payload interface{}) error {
	return c.SendMessage(&WSMessage{
		Kind: "event",
		Event: &WSEvent{
			Type:    eventType,
			Payload: payload,
		},
	})
}

// SendResponse 向客户端发送 RPC 响应
func (c *Client) SendResponse(id string, result interface{}, errMsg string) error {
	resp := &RPCResponse{ID: id}
	if errMsg != "" {
		resp.Error = errMsg
	} else {
		resp.Result = result
	}
	return c.SendMessage(&WSMessage{
		Kind:     "rpc_response",
		Response: resp,
	})
}

// WritePump 将 Send 通道中的消息写入 WebSocket
func (c *Client) WritePump() {
	defer c.Conn.Close()

	for message := range c.Send {
		if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
			return
		}
	}
}

// Close 关闭客户端连接
func (c *Client) Close() {
	close(c.Send)
}

// 错误定义
var ErrClientBufferFull = &ClientError{Message: "client send buffer full"}

type ClientError struct {
	Message string
}

func (e *ClientError) Error() string {
	return e.Message
}
