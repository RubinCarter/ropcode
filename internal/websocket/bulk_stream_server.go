package websocket

import (
	"log"
	"net/http"
	"strings"
)

const bulkStreamPrefix = "/ws/stream/bulk/"

func (s *Server) handleBulkStreamWebSocket(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeWebSocket(w, r) {
		return
	}
	hub := s.bulkHub()
	if hub == nil {
		http.Error(w, "bulk hub unavailable", http.StatusServiceUnavailable)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, bulkStreamPrefix)
	if rest == "" || rest == r.URL.Path {
		http.Error(w, "missing bulk stream key", http.StatusBadRequest)
		return
	}
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		http.Error(w, "missing bulk stream key", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Bulk stream WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	sub := hub.Subscribe(parts[0], parts[1])
	defer sub.Close()
	writeStreamLoop(conn, sub.C)
}
