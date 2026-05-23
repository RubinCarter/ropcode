package stream

type ProviderAdapter interface {
	ToFrame(ctx ProviderOutputContext, event ProviderOutput) (SessionFrame, error)
}

type ProviderOutput struct {
	Type      string
	Subtype   string
	SessionID string
	Provider  string
	Message   map[string]any
	IsDelta   bool
	Raw       string
}
