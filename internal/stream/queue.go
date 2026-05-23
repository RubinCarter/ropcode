package stream

type streamQueue struct {
	frames []SessionFrame
}

func (q *streamQueue) append(frame SessionFrame) {
	q.frames = append(q.frames, frame)
}

func (q *streamQueue) len() int {
	return len(q.frames)
}

func (q *streamQueue) snapshot() []SessionFrame {
	frames := make([]SessionFrame, len(q.frames))
	copy(frames, q.frames)
	return frames
}
