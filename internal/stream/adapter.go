package stream

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func aliasFrameID(aliasID string, source SessionFrame) string {
	identity := aliasFrameIdentity(aliasID, source)
	return frameIDFromIdentity(identity)
}

func stableFrameID(streamID string, source SessionFrame) string {
	identity := frameIdentity("stream", streamID, source)
	return frameIDFromIdentity(identity)
}

func frameIDFromIdentity(identity []string) string {
	sum := sha1.Sum([]byte(strings.Join(identity, "\x00")))
	return hex.EncodeToString(sum[:8])
}

func aliasFrameIdentity(aliasID string, source SessionFrame) []string {
	return frameIdentity("alias", aliasID, source)
}

func frameIdentity(scopeKind, scopeValue string, source SessionFrame) []string {
	scopeID := firstNonEmpty(source.ProviderSessionID, source.RuntimeSessionID, source.StreamID)
	identity := []string{
		scopeKind, scopeValue,
		"provider", source.Provider,
		"scope", scopeID,
		"kind", string(source.Kind),
		"role", string(source.Role),
		"subtype", source.Subtype,
	}

	nativeEventID := nativeFrameEventID(source)
	switch {
	case source.MessageID != "":
		return append(identity, "message", source.MessageID)
	case nativeEventID != "":
		return append(identity, "event", nativeEventID)
	case source.ToolUseID != "":
		return append(identity, "tool", source.ToolUseID, "content", frameContentIdentity(source.Content), "result", source.Result, "error", source.Error)
	case source.ParentToolUseID != "":
		return append(identity, "parent", source.ParentToolUseID, "content", frameContentIdentity(source.Content))
	}

	contentID := frameContentIdentity(source.Content)
	if contentID == "" && source.Result == "" && source.Error == "" {
		rawID := frameRawIdentity(source.Meta.Raw)
		if rawID == "" {
			return append(identity, "empty")
		}
		return append(identity, "raw", rawID)
	}
	return append(identity,
		"task", source.TaskID,
		"agent", source.AgentID,
		"content", contentID,
		"result", source.Result,
		"error", source.Error,
	)
}

func nativeFrameEventID(source SessionFrame) string {
	raw := source.Meta.Raw
	if len(raw) == 0 {
		return ""
	}

	if id := firstNonEmpty(
		stringFromMap(raw, "uuid"),
		stringFromMap(raw, "event_id"),
		stringFromMap(raw, "eventId"),
		stringFromMap(raw, "item_id"),
		stringFromMap(raw, "itemId"),
		stringFromMap(raw, "call_id"),
		stringFromMap(raw, "callId"),
		stringFromMap(raw, "request_id"),
		stringFromMap(raw, "requestId"),
		stringFromMap(raw, "id"),
	); id != "" {
		return id
	}

	if itemID := stringFromMap(mapFromAny(raw["item"]), "id"); itemID != "" {
		return itemID
	}
	if payloadID := firstNonEmpty(
		stringFromMap(mapFromAny(raw["payload"]), "id"),
		stringFromMap(mapFromAny(raw["payload"]), "call_id"),
		stringFromMap(mapFromAny(raw["payload"]), "callId"),
	); payloadID != "" {
		return payloadID
	}
	if turnID := stringFromMap(mapFromAny(raw["turn"]), "id"); turnID != "" {
		return turnID
	}
	if messageID := messageIDFromProviderMessage(raw); messageID != "" {
		return messageID
	}
	return ""
}

func frameContentIdentity(content []ContentBlock) string {
	if len(content) == 0 {
		return ""
	}
	data, err := json.Marshal(content)
	if err != nil {
		return fmt.Sprintf("%#v", content)
	}
	sum := sha1.Sum(data)
	return hex.EncodeToString(sum[:8])
}

func frameRawIdentity(raw map[string]any) string {
	if len(raw) == 0 {
		return ""
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return fmt.Sprintf("%#v", raw)
	}
	sum := sha1.Sum(data)
	return hex.EncodeToString(sum[:8])
}

func RebaseFramesToStream(streamID string, frames []SessionFrame) []SessionFrame {
	if len(frames) == 0 {
		return nil
	}
	rebased := make([]SessionFrame, len(frames))
	baseSeq := int64(-len(frames))
	for i, frame := range frames {
		frameID := aliasFrameID(streamID, frame)
		seq := baseSeq + int64(i)
		frame.StreamID = streamID
		frame.Seq = seq
		frame.FrameID = frameID
		rebased[i] = frame
	}
	return rebased
}

func nowTimestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
