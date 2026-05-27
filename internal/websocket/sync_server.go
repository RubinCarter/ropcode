package websocket

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

func (s *Server) handleSyncWebSocket(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeWebSocket(w, r) {
		return
	}
	hub := s.syncHub()
	if hub == nil {
		http.Error(w, "sync hub unavailable", http.StatusServiceUnavailable)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Sync WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	sub := hub.Subscribe()
	defer sub.Close()
	writeStreamLoop(conn, sub.C)
}

func writeStreamLoop[T any](conn *websocket.Conn, ch <-chan T) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case frame, ok := <-ch:
			if !ok {
				writeCloseFrame(conn)
				return
			}
			data, err := json.Marshal(frame)
			if err != nil {
				log.Printf("[websocket] stream marshal failed type=%T err=%v", frame, err)
				return
			}
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				log.Printf("[websocket] stream write failed type=%T bytes=%d err=%v", frame, len(data), err)
				return
			}
		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func writeCloseFrame(conn *websocket.Conn) {
	conn.SetWriteDeadline(time.Now().Add(writeWait))
	_ = conn.WriteMessage(websocket.CloseMessage, []byte{})
}
