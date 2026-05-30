package rpc

import (
	"encoding/json"
	"fmt"
)

// Dispatch executes a method from the direct RPC table. It is shared by the
// production server and tests so neither path falls back to reflected App
// methods.
func Dispatch(methods map[string]Handler, method string, params json.RawMessage) (any, error) {
	fn := methods[method]
	if fn == nil {
		return nil, fmt.Errorf("method not found: %s", method)
	}
	return fn(params)
}
