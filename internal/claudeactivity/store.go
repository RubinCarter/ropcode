package claudeactivity

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

const maxActivitiesPerSession = 50
const ActivityServiceBuild = "async-tool-result-v2"

type ControlSender interface {
	SendStopTask(requestID, taskID string) error
}

type sessionBucket struct {
	sessionID     string
	projectPath   string
	interactive   bool
	controlSender ControlSender
	activities    map[string]*Activity
	order         []string
}

type Service struct {
	mu            sync.RWMutex
	buckets       map[string]*sessionBucket
	requests      map[string]controlRequest
	nextID        int64
	now           func() time.Time
	claudeHomeDir string
}

type controlRequest struct {
	SessionID  string
	ActivityID string
}

func NewService() *Service {
	return &Service{
		buckets:       make(map[string]*sessionBucket),
		requests:      make(map[string]controlRequest),
		now:           func() time.Time { return time.Now().UTC() },
		claudeHomeDir: defaultClaudeHomeDir(),
	}
}

func (s *Service) EnsureSession(sessionID, projectPath string, interactive bool, sender ControlSender) {
	if sessionID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	bucket := s.ensureBucketLocked(sessionID)
	bucket.projectPath = projectPath
	bucket.interactive = interactive
	bucket.controlSender = sender
}

func (s *Service) ensureBucketLocked(sessionID string) *sessionBucket {
	bucket := s.buckets[sessionID]
	if bucket == nil {
		bucket = &sessionBucket{
			sessionID:  sessionID,
			activities: make(map[string]*Activity),
		}
		s.buckets[sessionID] = bucket
	}
	return bucket
}

func (b *sessionBucket) ensureActivity(id, taskType string, now time.Time) *Activity {
	if id == "" {
		return nil
	}
	activity := b.activities[id]
	if activity == nil {
		started := now
		activity = &Activity{
			ID:        id,
			TaskType:  taskType,
			Type:      classifyTaskType(taskType),
			Status:    ActivityStatusRunning,
			StartedAt: &started,
			UpdatedAt: now,
			PID:       nil,
		}
		b.activities[id] = activity
		b.order = append(b.order, id)
		b.trimOldest()
	}
	if taskType != "" {
		activity.TaskType = taskType
		activity.Type = classifyTaskType(taskType)
	}
	return activity
}

func (b *sessionBucket) trimOldest() {
	for len(b.order) > maxActivitiesPerSession {
		oldest := b.order[0]
		b.order = b.order[1:]
		delete(b.activities, oldest)
	}
}

func classifyTaskType(taskType string) ActivityType {
	switch taskType {
	case "local_agent":
		return ActivityTypeLocalAgent
	case "local_bash":
		return ActivityTypeLocalBash
	case "":
		return ActivityTypeOther
	default:
		return ActivityTypeOther
	}
}

func (s *Service) GetSnapshot(sessionID string) (Snapshot, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	bucket := s.buckets[sessionID]
	if bucket == nil {
		return Snapshot{}, fmt.Errorf("session not found: %s", sessionID)
	}
	return bucket.snapshot(), nil
}

func (b *sessionBucket) snapshot() Snapshot {
	snapshot := Snapshot{
		SessionID:       b.sessionID,
		ProjectPath:     b.projectPath,
		Activities:      make([]Activity, 0, len(b.activities)),
		Subagents:       make([]Activity, 0),
		BackgroundTasks: make([]Activity, 0),
		Other:           make([]Activity, 0),
	}
	for _, id := range b.order {
		activity := b.activities[id]
		if activity == nil {
			continue
		}
		copy := *activity
		copy.CanStop = b.canStop(activity)
		snapshot.Activities = append(snapshot.Activities, copy)
		switch copy.Type {
		case ActivityTypeLocalAgent:
			snapshot.Subagents = append(snapshot.Subagents, copy)
		case ActivityTypeLocalBash:
			if copy.Async {
				snapshot.BackgroundTasks = append(snapshot.BackgroundTasks, copy)
			} else {
				snapshot.Other = append(snapshot.Other, copy)
			}
		default:
			snapshot.Other = append(snapshot.Other, copy)
		}
		switch copy.Status {
		case ActivityStatusRunning:
			snapshot.RunningCount++
		case ActivityStatusStopping:
			snapshot.StoppingCount++
		case ActivityStatusFailed:
			snapshot.FailedCount++
		}
	}
	sort.SliceStable(snapshot.Activities, func(i, j int) bool {
		return snapshot.Activities[i].UpdatedAt.After(snapshot.Activities[j].UpdatedAt)
	})
	sort.SliceStable(snapshot.Subagents, func(i, j int) bool {
		return snapshot.Subagents[i].UpdatedAt.After(snapshot.Subagents[j].UpdatedAt)
	})
	sort.SliceStable(snapshot.BackgroundTasks, func(i, j int) bool {
		return snapshot.BackgroundTasks[i].UpdatedAt.After(snapshot.BackgroundTasks[j].UpdatedAt)
	})
	sort.SliceStable(snapshot.Other, func(i, j int) bool {
		return snapshot.Other[i].UpdatedAt.After(snapshot.Other[j].UpdatedAt)
	})
	return snapshot
}

func (b *sessionBucket) canStop(activity *Activity) bool {
	return b.interactive && b.controlSender != nil && activity.Status == ActivityStatusRunning
}

func (s *Service) CompleteSession(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	bucket := s.buckets[sessionID]
	if bucket == nil {
		return
	}
	now := s.now()
	for _, activity := range bucket.activities {
		if activity.Status == ActivityStatusRunning || activity.Status == ActivityStatusStopping {
			activity.Status = ActivityStatusStale
			activity.UpdatedAt = now
			activity.EndedAt = &now
		}
	}
	bucket.interactive = false
	bucket.controlSender = nil
}
