package rpc

import "testing"

func TestBuildIncludesProviderCapabilityHandlers(t *testing.T) {
	methods := Build(&Deps{})
	for _, method := range []string{
		"GetCachedProviderCapabilityLayers",
		"GetProviderCapabilityLayers",
		"RefreshProviderCapabilityLayers",
	} {
		if methods[method] == nil {
			t.Fatalf("missing RPC handler %s", method)
		}
	}
}
