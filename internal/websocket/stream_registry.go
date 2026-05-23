package websocket

import "ropcode/internal/stream"

type sessionStreamHubProvider interface {
	SessionStreamHub() *stream.Hub
}

type syncHubProvider interface {
	SyncHub() *stream.SyncHub
}

type bulkHubProvider interface {
	BulkHub() *stream.BulkHub
}

func (s *Server) sessionStreamHub() *stream.Hub {
	if provider, ok := s.router.app.(sessionStreamHubProvider); ok {
		return provider.SessionStreamHub()
	}
	return nil
}

func (s *Server) syncHub() *stream.SyncHub {
	if provider, ok := s.router.app.(syncHubProvider); ok {
		return provider.SyncHub()
	}
	return nil
}

func (s *Server) bulkHub() *stream.BulkHub {
	if provider, ok := s.router.app.(bulkHubProvider); ok {
		return provider.BulkHub()
	}
	return nil
}
