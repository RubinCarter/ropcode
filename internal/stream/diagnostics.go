package stream

type Diagnostics struct {
	QueueLength int `json:"queueLength"`
	Subscribers int `json:"subscribers"`
}
