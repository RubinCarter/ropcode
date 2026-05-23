package stream

import "fmt"

func StreamIDForSession(provider string, runtimeSessionID string) string {
	if provider == "" {
		return runtimeSessionID
	}
	return fmt.Sprintf("%s:%s", provider, runtimeSessionID)
}
