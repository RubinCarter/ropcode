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

	// Buffer sizes are tuned for the workload split between RPC responses
	// (small, infrequent) and high-frequency push events (claude-output /
	// pty-output during streaming).
	responseBufferSize = 1024
	eventBufferSize    = 4096
)

// Client 表示一个 WebSocket 客户端连接.
//
// RPC responses and push events are queued on separate channels so a flood of
// streaming events cannot starve button RPC responses. WritePump drains the
// response channel with priority over the event channel; the event buffer is
// large enough to absorb a typical Claude streaming burst before any frame is
// dropped.
type Client struct {
	ID   string
	Conn *websocket.Conn

	// Responses carries RPC responses to the peer. Drained with priority.
	Responses chan []byte
	// Events carries push events (claude-output / pty-output / git:changed
	// etc). Larger buffer because the producer side is bursty.
	Events chan []byte

	mu     sync.Mutex
	closed bool
}

// NewClient 创建新的客户端
func NewClient(id string, conn *websocket.Conn) *Client {
	return &Client{
		ID:        id,
		Conn:      conn,
		Responses: make(chan []byte, responseBufferSize),
		Events:    make(chan []byte, eventBufferSize),
	}
}

// SendMessage routes a message onto the appropriate queue based on Kind.
// Kept as the unified entry point for callers that already build WSMessage
// values.
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

	target := c.Events
	if msg != nil && msg.Kind == "rpc_response" {
		target = c.Responses
	}

	select {
	case target <- data:
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

// WritePump drains pending response and event frames onto the WebSocket,
// preferring responses, and sends periodic pings to keep the connection alive
// across mobile NAT and proxy timeouts.
//
// The two-phase select ensures responses always win when both queues have
// data: phase A is a non-blocking peek at the response queue; phase B blocks
// on either queue plus the ping ticker.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		if c.Conn != nil {
			c.Conn.Close()
		}
	}()

	respClosed := false
	eventClosed := false

	for {
		// Phase A: prefer responses if any are queued. Returns to the outer
		// loop without blocking when the queue is empty.
		select {
		case message, ok := <-c.Responses:
			if !ok {
				respClosed = true
				if eventClosed {
					c.writeClose()
					return
				}
				// Responses channel closed but events may still arrive.
				// Disable the case by zeroing the channel so phase B never
				// triggers it again.
				c.Responses = nil
				continue
			}
			if !c.writeFrame(message) {
				return
			}
			continue
		default:
		}

		// Phase B: block on either queue, ping, or shutdown signal.
		select {
		case message, ok := <-c.Responses:
			if !ok {
				respClosed = true
				c.Responses = nil
				if eventClosed {
					c.writeClose()
					return
				}
				continue
			}
			if !c.writeFrame(message) {
				return
			}
		case message, ok := <-c.Events:
			if !ok {
				eventClosed = true
				c.Events = nil
				if respClosed {
					c.writeClose()
					return
				}
				continue
			}
			if !c.writeFrame(message) {
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

// writeFrame writes a single text frame and reports whether the pump should
// continue running. Returns false on any write error so the caller exits the
// loop and lets the deferred cleanup close the connection.
func (c *Client) writeFrame(message []byte) bool {
	if c.Conn == nil {
		return false
	}
	c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
	if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
		return false
	}
	return true
}

// writeClose sends a close frame so the peer learns the connection is going
// away cleanly. Errors are ignored — the deferred Conn.Close handles teardown.
func (c *Client) writeClose() {
	if c.Conn == nil {
		return
	}
	c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
	_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
}

// Close 关闭客户端连接 (safe to call multiple times)
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return
	}
	c.closed = true
	close(c.Responses)
	close(c.Events)
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
