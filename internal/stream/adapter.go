package stream

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"time"
)

func nextFrameID(streamID string, seq int64) string {
	sum := sha1.Sum([]byte(fmt.Sprintf("%s:%d", streamID, seq)))
	return hex.EncodeToString(sum[:8])
}

func nowTimestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
