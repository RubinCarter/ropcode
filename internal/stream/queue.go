package stream

type streamQueue struct {
	frames []SessionFrame
}

func (q *streamQueue) append(frame SessionFrame) {
	if frame.Operation == FrameOperationUpsert {
		if idx := q.upsertIndex(frame); idx >= 0 {
			q.frames[idx] = frame
			return
		}
	}
	q.frames = append(q.frames, frame)
}

func (q *streamQueue) upsertIndex(frame SessionFrame) int {
	for idx, existing := range q.frames {
		if existing.FrameID == frame.FrameID || canUpsertQueuedFrame(existing, frame) {
			return idx
		}
	}
	return -1
}

func canUpsertQueuedFrame(existing, frame SessionFrame) bool {
	return existing.MessageID != "" &&
		existing.MessageID == frame.MessageID &&
		existing.Role == frame.Role &&
		existing.Sidechain == frame.Sidechain &&
		existing.ParentToolUseID == frame.ParentToolUseID &&
		existing.TaskID == frame.TaskID &&
		existing.AgentID == frame.AgentID
}

func (q *streamQueue) len() int {
	return len(q.frames)
}

func (q *streamQueue) reset() {
	q.frames = nil
}

func (q *streamQueue) snapshot() []SessionFrame {
	frames := make([]SessionFrame, len(q.frames))
	copy(frames, q.frames)
	return frames
}
