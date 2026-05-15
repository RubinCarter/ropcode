package claudeactivity

import "fmt"

func (s *Service) StopActivity(sessionID, activityID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bucket := s.buckets[sessionID]
	if bucket == nil {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	activity := bucket.activities[activityID]
	if activity == nil {
		return fmt.Errorf("activity not found: %s", activityID)
	}
	if !bucket.canStop(activity) {
		return fmt.Errorf("activity cannot be stopped: %s", activityID)
	}

	s.nextID++
	requestID := fmt.Sprintf("ropcode-stop-%d", s.nextID)
	if err := bucket.controlSender.SendStopTask(requestID, activityID); err != nil {
		return err
	}
	activity.Status = ActivityStatusStopping
	activity.UpdatedAt = s.now()
	s.requests[requestID] = controlRequest{SessionID: sessionID, ActivityID: activityID}
	return nil
}

func (s *Service) HandleControlResponse(sessionID string, response map[string]interface{}) {
	requestID := stringField(response, "request_id")
	if requestID == "" {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	request, ok := s.requests[requestID]
	if !ok {
		return
	}
	delete(s.requests, requestID)
	if sessionID != "" && request.SessionID != sessionID {
		return
	}
	bucket := s.buckets[request.SessionID]
	if bucket == nil {
		return
	}
	activity := bucket.activities[request.ActivityID]
	if activity == nil {
		return
	}

	if errText := responseError(response); errText != "" {
		activity.Status = ActivityStatusRunning
		activity.Error = errText
	} else {
		activity.Status = ActivityStatusStopped
		now := s.now()
		activity.EndedAt = &now
	}
	activity.UpdatedAt = s.now()
}

func (s *Service) IsKnownControlRequest(requestID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.requests[requestID]
	return ok
}

func responseError(response map[string]interface{}) string {
	if value := stringField(response, "error"); value != "" {
		return value
	}
	if result, ok := response["response"].(map[string]interface{}); ok {
		if value := stringField(result, "error"); value != "" {
			return value
		}
	}
	return ""
}
