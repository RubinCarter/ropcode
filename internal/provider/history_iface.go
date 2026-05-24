package provider

type HistoryProvider interface {
	LoadSessionHistory(projectID, sessionID string) ([]Message, error)
	LoadHistoryEvents(projectID, sessionID string) ([]OutputEvent, error)
	ListProjectSessions(projectPath string) ([]HistorySessionInfo, error)
	ListProjectSessionsLimit(projectPath string, limit int) (HistorySessionsResult, error)
	GetMessageIndex(projectID, sessionID string) ([]int, error)
	GetMessagesRange(projectID, sessionID string, start, end int) ([]Message, error)
	LoadSubagentTranscripts(projectID, sessionID string) (map[string][]Message, error)
}
