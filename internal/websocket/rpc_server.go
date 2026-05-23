package websocket

import (
	"log"
	"net/http"

	"github.com/google/uuid"
)

func (s *Server) handleRPCWebSocket(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeWebSocket(w, r) {
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	clientID := uuid.New().String()
	client := NewClient(clientID, conn)

	s.clientsMu.Lock()
	s.clients[clientID] = client
	s.clientsMu.Unlock()

	go client.WritePump()
	s.readPump(client)
}
