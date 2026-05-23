package websocket

import (
	"log"
	"net/http"
)

func (s *Server) authorizeWebSocket(w http.ResponseWriter, r *http.Request) bool {
	if s.authKey == "" {
		return true
	}
	authHeader := r.Header.Get("X-Auth-Key")
	authQuery := r.URL.Query().Get("authKey")
	authKey := authHeader
	if authKey == "" {
		authKey = authQuery
	}
	if authKey != s.authKey {
		log.Printf("WS auth mismatch: expected=%q header=%q query=%q path=%s", s.authKey, authHeader, authQuery, r.URL.Path)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}
