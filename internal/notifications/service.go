package notifications

import (
	"encoding/json"
	"path/filepath"
	"strings"

	"ropcode/internal/database"
)

const SessionFinishedEnabledKey = "system_notifications_session_finished"

type SessionFinished struct {
	Provider string
	Status   string
	Cwd      string
}

type Sender interface {
	Send(event SessionFinished) error
}

type Service struct {
	db     *database.Database
	sender Sender
}

func NewService(db *database.Database, sender Sender) *Service {
	if sender == nil {
		sender = NewPlatformSender()
	}
	return &Service{db: db, sender: sender}
}

func (s *Service) NotifySessionFinished(event SessionFinished) error {
	if s == nil || s.db == nil || s.sender == nil {
		return nil
	}
	enabled, err := s.isSessionFinishedEnabled()
	if err != nil || !enabled {
		return err
	}
	return s.sender.Send(event)
}

func (s *Service) NotifyClaudeComplete(payload any) error {
	event, ok := SessionFinishedFromPayload(payload)
	if !ok {
		return nil
	}
	return s.NotifySessionFinished(event)
}

func SessionFinishedFromPayload(payload any) (SessionFinished, bool) {
	switch value := payload.(type) {
	case map[string]interface{}:
		return sessionFinishedFromMap(value)
	case string:
		return sessionFinishedFromJSON([]byte(value))
	case []byte:
		return sessionFinishedFromJSON(value)
	default:
		return SessionFinished{}, false
	}
}

func sessionFinishedFromJSON(data []byte) (SessionFinished, bool) {
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return SessionFinished{}, false
	}
	return sessionFinishedFromMap(payload)
}

func sessionFinishedFromMap(payload map[string]any) (SessionFinished, bool) {
	provider, _ := payload["provider"].(string)
	status, _ := payload["status"].(string)
	cwd, _ := payload["cwd"].(string)
	if status == "" {
		if exitCode, ok := intFromAny(payload["exit_code"]); ok && exitCode != 0 {
			status = "failed"
		} else {
			status = "completed"
		}
	}
	if provider == "" {
		provider = "AI"
	}
	return SessionFinished{Provider: provider, Status: status, Cwd: cwd}, true
}

func intFromAny(value any) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case int32:
		return int(v), true
	case int64:
		return int(v), true
	case float64:
		return int(v), true
	default:
		return 0, false
	}
}

func (s *Service) isSessionFinishedEnabled() (bool, error) {
	value, err := s.db.GetSetting(SessionFinishedEnabledKey)
	if err != nil {
		return false, err
	}
	return strings.EqualFold(strings.TrimSpace(value), "true"), nil
}

func ProjectLabel(cwd string) string {
	if cwd == "" {
		return "Unknown project"
	}
	base := filepath.Base(cwd)
	if base == "." || base == string(filepath.Separator) {
		return cwd
	}
	return base
}
