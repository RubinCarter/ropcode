// internal/websocket/client.go
package websocket

import (
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second
	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second
	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = 25 * time.Second
)

// Client 表示一个 WebSocket 客户端连接
type Client struct {
	ID     string
	Conn   *websocket.Conn
	Send   chan []byte
	mu     sync.Mutex
	closed bool
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

	if c.closed {
		return ErrClientClosed
	}

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

// WritePump 将 Send 通道中的消息写入 WebSocket, and sends periodic pings
// to keep the connection alive across mobile NAT and proxy timeouts.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		if c.Conn != nil {
			c.Conn.Close()
		}
	}()

	for {
		select {
		case message, ok := <-c.Send:
			if c.Conn == nil {
				return
			}
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Channel closed — send close frame
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			if c.Conn == nil {
				return
			}
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Close 关闭客户端连接 (safe to call multiple times)
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return
	}
	c.closed = true
	close(c.Send)
}

// 错误定义
var (
	ErrClientBufferFull = &ClientError{Message: "client send buffer full"}
	ErrClientClosed     = &ClientError{Message: "client closed"}
)

type ClientError struct {
	Message string
}

func (e *ClientError) Error() string {
	return e.Message
}

func (e *ClientError) Is(target error) bool {
	var other *ClientError
	if !errors.As(target, &other) {
		return false
	}
	return e.Message == other.Message
}
