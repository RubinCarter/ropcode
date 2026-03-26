package rpc

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	ws "ropcode/internal/websocket"
)

var ErrClientClosed = errors.New("rpc client closed")

type responseEnvelope struct {
	result json.RawMessage
	err    string
}

type EventHandler func(payload json.RawMessage)

type Client struct {
	conn *websocket.Conn

	writeMu sync.Mutex
	mu      sync.RWMutex
	closed  bool

	pending  map[string]chan responseEnvelope
	handlers map[string][]EventHandler
	closeCh  chan struct{}
	doneCh   chan struct{}
}

func Dial(wsURL string, authKey string) (*Client, error) {
	parsed, err := url.Parse(wsURL)
	if err != nil {
		return nil, fmt.Errorf("parse websocket url: %w", err)
	}
	if authKey != "" {
		query := parsed.Query()
		if query.Get("authKey") == "" {
			query.Set("authKey", authKey)
			parsed.RawQuery = query.Encode()
		}
	}

	headers := http.Header{}
	if authKey != "" {
		headers.Set("X-Auth-Key", authKey)
	}

	conn, _, err := websocket.DefaultDialer.Dial(parsed.String(), headers)
	if err != nil {
		return nil, fmt.Errorf("dial websocket: %w", err)
	}

	client := &Client{
		conn:     conn,
		pending:  make(map[string]chan responseEnvelope),
		handlers: make(map[string][]EventHandler),
		closeCh:  make(chan struct{}),
		doneCh:   make(chan struct{}),
	}

	go client.readLoop()

	return client, nil
}

func (c *Client) Call(method string, params []any, out any) error {
	responseCh := make(chan responseEnvelope, 1)
	requestID := uuid.NewString()

	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return ErrClientClosed
	}
	c.pending[requestID] = responseCh
	c.mu.Unlock()

	msg := &ws.WSMessage{
		Kind: "rpc_request",
		Request: &ws.RPCRequest{
			ID:     requestID,
			Method: method,
			Params: toInterfaces(params),
		},
	}

	if err := c.writeJSON(msg); err != nil {
		c.mu.Lock()
		delete(c.pending, requestID)
		c.mu.Unlock()
		return err
	}

	response, ok := <-responseCh
	if !ok {
		return ErrClientClosed
	}
	if response.err != "" {
		return errors.New(response.err)
	}
	if out == nil || len(response.result) == 0 || string(response.result) == "null" {
		return nil
	}
	if err := json.Unmarshal(response.result, out); err != nil {
		return fmt.Errorf("decode rpc response: %w", err)
	}
	return nil
}

func (c *Client) OnEvent(eventType string, handler func(payload json.RawMessage)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	c.handlers[eventType] = append(c.handlers[eventType], handler)
}

func (c *Client) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	close(c.closeCh)
	pending := c.pending
	c.pending = make(map[string]chan responseEnvelope)
	c.mu.Unlock()

	for _, ch := range pending {
		close(ch)
	}

	err := c.conn.Close()
	<-c.doneCh
	return err
}

func (c *Client) readLoop() {
	defer close(c.doneCh)

	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			c.failPending()
			return
		}

		var msg ws.WSMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		switch msg.Kind {
		case "rpc_response":
			c.handleResponse(msg.Response)
		case "event":
			c.handleEvent(msg.Event)
		}
	}
}

func (c *Client) handleResponse(resp *ws.RPCResponse) {
	if resp == nil {
		return
	}

	c.mu.Lock()
	ch, ok := c.pending[resp.ID]
	if ok {
		delete(c.pending, resp.ID)
	}
	c.mu.Unlock()
	if !ok {
		return
	}

	result, err := json.Marshal(resp.Result)
	if err != nil {
		result = nil
	}
	if resp.Result == nil {
		result = []byte("null")
	}

	ch <- responseEnvelope{result: result, err: resp.Error}
	close(ch)
}

func (c *Client) handleEvent(event *ws.WSEvent) {
	if event == nil {
		return
	}

	c.mu.RLock()
	handlers := append([]EventHandler(nil), c.handlers[event.Type]...)
	c.mu.RUnlock()

	payload, err := json.Marshal(event.Payload)
	if err != nil {
		return
	}

	for _, handler := range handlers {
		handler(append(json.RawMessage(nil), payload...))
	}
}

func (c *Client) failPending() {
	c.mu.Lock()
	pending := c.pending
	c.pending = make(map[string]chan responseEnvelope)
	c.mu.Unlock()

	for _, ch := range pending {
		close(ch)
	}
}

func (c *Client) writeJSON(msg *ws.WSMessage) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	select {
	case <-c.closeCh:
		return ErrClientClosed
	default:
	}

	if err := c.conn.WriteJSON(msg); err != nil {
		return fmt.Errorf("write rpc request: %w", err)
	}
	return nil
}

func toInterfaces(params []any) []interface{} {
	if len(params) == 0 {
		return nil
	}
	result := make([]interface{}, len(params))
	for i, param := range params {
		result[i] = param
	}
	return result
}
