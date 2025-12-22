package watcher

import (
	"fmt"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// EventType represents the type of file system event
type EventType string

const (
	EventCreate EventType = "create"
	EventModify EventType = "modify"
	EventDelete EventType = "delete"
	EventRename EventType = "rename"
)

// Event represents a file system event
type Event struct {
	Path string
	Type EventType
}

// Watcher watches a directory for file system events with debouncing
type Watcher struct {
	path       string
	debounce   time.Duration
	callback   func(Event)
	watcher    *fsnotify.Watcher
	done       chan struct{}
	started    bool
	closed     bool
	mu         sync.Mutex
	debouncer  map[string]*time.Timer
	debounceMu sync.Mutex
}

// New creates a new Watcher for the given path
func New(path string, debounce time.Duration, callback func(Event)) (*Watcher, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("failed to create fsnotify watcher: %w", err)
	}

	err = watcher.Add(path)
	if err != nil {
		watcher.Close()
		return nil, fmt.Errorf("failed to watch path %s: %w", path, err)
	}

	return &Watcher{
		path:      path,
		debounce:  debounce,
		callback:  callback,
		watcher:   watcher,
		done:      make(chan struct{}),
		debouncer: make(map[string]*time.Timer),
	}, nil
}

// AddPath adds an additional path to watch
func (w *Watcher) AddPath(path string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.closed {
		return fmt.Errorf("watcher is closed")
	}

	return w.watcher.Add(path)
}

// Start starts watching for events
func (w *Watcher) Start() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.closed {
		return fmt.Errorf("watcher is closed")
	}

	if w.started {
		return fmt.Errorf("watcher already started")
	}

	w.started = true

	go w.watch()

	return nil
}

// Close stops watching and cleans up resources
func (w *Watcher) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.closed {
		return nil
	}

	w.closed = true

	if w.started {
		close(w.done)
	}

	// Cancel all pending debounce timers
	w.debounceMu.Lock()
	for _, timer := range w.debouncer {
		timer.Stop()
	}
	w.debouncer = make(map[string]*time.Timer)
	w.debounceMu.Unlock()

	return w.watcher.Close()
}

// watch is the main event loop
func (w *Watcher) watch() {
	for {
		select {
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			w.handleEvent(event)

		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			// Log error but continue watching
			fmt.Printf("watcher error: %v\n", err)

		case <-w.done:
			return
		}
	}
}

// handleEvent processes a fsnotify event with debouncing
func (w *Watcher) handleEvent(event fsnotify.Event) {
	var eventType EventType

	switch {
	case event.Op&fsnotify.Create == fsnotify.Create:
		eventType = EventCreate
	case event.Op&fsnotify.Write == fsnotify.Write:
		eventType = EventModify
	case event.Op&fsnotify.Remove == fsnotify.Remove:
		eventType = EventDelete
	case event.Op&fsnotify.Rename == fsnotify.Rename:
		eventType = EventRename
	default:
		// Unknown event type, ignore
		return
	}

	e := Event{
		Path: event.Name,
		Type: eventType,
	}

	// Debounce the event
	w.debounceEvent(e)
}

// debounceEvent debounces events for the same file
func (w *Watcher) debounceEvent(e Event) {
	w.debounceMu.Lock()
	defer w.debounceMu.Unlock()

	// Cancel existing timer for this path if any
	if timer, exists := w.debouncer[e.Path]; exists {
		timer.Stop()
	}

	// Create new timer
	w.debouncer[e.Path] = time.AfterFunc(w.debounce, func() {
		// Remove timer from map
		w.debounceMu.Lock()
		delete(w.debouncer, e.Path)
		w.debounceMu.Unlock()

		// Call the callback
		w.callback(e)
	})
}
