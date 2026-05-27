package websocket

import (
	"log"
	"net/http"
	"strings"
)

const sessionStreamPrefix = "/ws/stream/session/"

func (s *Server) handleSessionStreamWebSocket(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeWebSocket(w, r) {
		return
	}
	hub := s.sessionStreamHub()
	if hub == nil {
		http.Error(w, "session stream hub unavailable", http.StatusServiceUnavailable)
		return
	}
	streamID := strings.TrimPrefix(r.URL.Path, sessionStreamPrefix)
	if streamID == "" || streamID == r.URL.Path {
		http.Error(w, "missing stream id", http.StatusBadRequest)
		return
	}
	diagnostics := hub.Diagnostics(streamID)
	log.Printf("[session-stream] connect stream=%s remote=%s replay_queue=%d subscribers_before=%d",
		streamID,
		r.RemoteAddr,
		diagnostics.QueueLength,
		diagnostics.Subscribers,
	)
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Session stream WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	sub := hub.Subscribe(streamID)
	defer sub.Close()
	defer log.Printf("[session-stream] disconnect stream=%s remote=%s", streamID, r.RemoteAddr)
	writeStreamLoop(conn, sub.C)
}
