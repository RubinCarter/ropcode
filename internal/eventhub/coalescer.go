package eventhub

import (
	"sync"
	"time"
)

// EmitterFunc adapts plain emitter implementations (e.g. ropcode's
// app.eventEmitter that wraps EventHub.Emit) to a function value so the
// coalescer can call them without depending on a specific interface.
type EmitterFunc func(eventName string, payload interface{})

const (
	// claudeOutputCoalesceWindow is the maximum age of a buffered claude-output
	// line before it gets flushed. 16ms ≈ one frame, which is the practical
	// floor for "feels live" streaming on the front-end while still cutting
	// the WebSocket frame rate by 10-20x for chatty sessions.
	claudeOutputCoalesceWindow = 16 * time.Millisecond

	// claudeOutputCoalesceMax bounds the number of buffered lines per session
	// to keep latency bounded when an upstream emitter goes wild.
	claudeOutputCoalesceMax = 256
)

// ClaudeOutputCoalescer batches "claude-output" events per session_id and
// emits a single "claude-output-batch" frame containing the JSONL payloads
// in order. Other event types pass through unchanged but trigger a flush of
// any pending claude-output buffer first so the front-end always sees the
// stream events before any sentinel event (claude-complete, claude-error,
// init messages, etc).
//
// Producer side semantics:
//
//   - Multiple goroutines may call Emit concurrently; the coalescer guards
//     its own per-session state.
//   - When a single payload pushes the buffer over claudeOutputCoalesceMax,
//     the buffer is flushed synchronously inside Emit so we never grow
//     without bound.
//   - The 16ms timer per session uses a fixed window: it starts on the first
//     push and fires once regardless of subsequent pushes. This bounds
//     latency to at most 16ms from the first buffered line.
//   - Close() must be called on shutdown to flush any pending lines.
type ClaudeOutputCoalescer struct {
	emit EmitterFunc

	mu       sync.Mutex
	sessions map[string]*claudeOutputBuffer
}

type claudeOutputBuffer struct {
	lines []string
	timer *time.Timer
}

// NewClaudeOutputCoalescer wraps the given emitter so high-frequency
// "claude-output" events are merged into "claude-output-batch" frames. All
// other event types pass through directly.
func NewClaudeOutputCoalescer(emit EmitterFunc) *ClaudeOutputCoalescer {
	return &ClaudeOutputCoalescer{
		emit:     emit,
		sessions: make(map[string]*claudeOutputBuffer),
	}
}

// Emit forwards an event onto the underlying emitter. Claude-output frames
// are buffered per session_id (extracted from the JSONL payload); everything
// else flushes pending buffers first to preserve relative ordering.
func (c *ClaudeOutputCoalescer) Emit(eventName string, payload interface{}) {
	if c == nil || c.emit == nil {
		return
	}

	if eventName == "claude-output" {
		line, ok := payload.(string)
		if !ok {
			// Non-string payloads (legacy paths) bypass batching. Flush first
			// so order is preserved.
			c.flushAll()
			c.emit(eventName, payload)
			return
		}
		c.push(line)
		return
	}

	// Sentinel / state events: flush so the front-end never sees, e.g.,
	// claude-complete arrive before its preceding stream messages.
	c.flushAll()
	c.emit(eventName, payload)
}

// Close flushes every pending buffer. After Close further Emit calls behave
// as a normal pass-through emitter.
func (c *ClaudeOutputCoalescer) Close() {
	c.flushAll()
}

func (c *ClaudeOutputCoalescer) push(line string) {
	sessionID := extractSessionIDFromJSON(line)

	c.mu.Lock()
	buf, ok := c.sessions[sessionID]
	if !ok {
		buf = &claudeOutputBuffer{lines: make([]string, 0, 8)}
		c.sessions[sessionID] = buf
	}
	buf.lines = append(buf.lines, line)
	shouldFlushNow := len(buf.lines) >= claudeOutputCoalesceMax
	if !shouldFlushNow {
		if buf.timer == nil {
			buf.timer = time.AfterFunc(claudeOutputCoalesceWindow, func() {
				c.flushSession(sessionID)
			})
		}
	}
	c.mu.Unlock()

	if shouldFlushNow {
		c.flushSession(sessionID)
	}
}

// flushSession atomically removes a session's pending buffer and emits a
// claude-output-batch event for it. Safe to call when nothing is buffered.
func (c *ClaudeOutputCoalescer) flushSession(sessionID string) {
	c.mu.Lock()
	buf, ok := c.sessions[sessionID]
	if !ok {
		c.mu.Unlock()
		return
	}
	if buf.timer != nil {
		buf.timer.Stop()
		buf.timer = nil
	}
	if len(buf.lines) == 0 {
		c.mu.Unlock()
		return
	}
	lines := buf.lines
	buf.lines = make([]string, 0, 8)
	c.mu.Unlock()

	c.emit("claude-output-batch", map[string]interface{}{
		"session_id": sessionID,
		"lines":      lines,
	})
}

// flushAll drains every session buffer in arbitrary order. Used before
// non-batched events and on shutdown.
func (c *ClaudeOutputCoalescer) flushAll() {
	if c == nil {
		return
	}
	c.mu.Lock()
	ids := make([]string, 0, len(c.sessions))
	for id := range c.sessions {
		ids = append(ids, id)
	}
	c.mu.Unlock()

	for _, id := range ids {
		c.flushSession(id)
	}
}

// extractSessionIDFromJSON pulls "session_id":"..." out of a JSONL line
// without doing a full JSON parse. Stream lines emitted by the providers
// always include the field after enrichOutputMessage runs, but we degrade
// gracefully to an empty string if the field is missing — the front-end
// already handles cwd-only routing for those legacy frames.
func extractSessionIDFromJSON(line string) string {
	const key = `"session_id":"`
	idx := indexOfASCII(line, key)
	if idx < 0 {
		return ""
	}
	start := idx + len(key)
	end := indexOfByte(line, '"', start)
	if end < 0 {
		return ""
	}
	return line[start:end]
}

func indexOfASCII(s, substr string) int {
	if len(substr) == 0 || len(substr) > len(s) {
		return -1
	}
	limit := len(s) - len(substr)
	for i := 0; i <= limit; i++ {
		if s[i] == substr[0] && s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

func indexOfByte(s string, target byte, start int) int {
	for i := start; i < len(s); i++ {
		if s[i] == target {
			return i
		}
	}
	return -1
}
