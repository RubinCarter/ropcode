package watcher

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestNew(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "watcher-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	w, err := New(tmpDir, 100*time.Millisecond, func(e Event) {})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Close()

	if w == nil {
		t.Fatal("New() returned nil watcher")
	}
}

func TestNewInvalidPath(t *testing.T) {
	_, err := New("/nonexistent/path/that/does/not/exist", 100*time.Millisecond, func(e Event) {})
	if err == nil {
		t.Fatal("New() should return error for invalid path")
	}
}

func TestWatcherCreateEvent(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "watcher-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	var mu sync.Mutex
	var events []Event

	w, err := New(tmpDir, 50*time.Millisecond, func(e Event) {
		mu.Lock()
		events = append(events, e)
		mu.Unlock()
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Close()

	err = w.Start()
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	// Give the watcher time to start
	time.Sleep(100 * time.Millisecond)

	// Create a file
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// Wait for debounce and event processing
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	if len(events) == 0 {
		t.Fatal("Expected at least one event, got none")
	}

	found := false
	for _, e := range events {
		if e.Type == EventCreate && e.Path == testFile {
			found = true
			break
		}
	}

	if !found {
		t.Errorf("Expected create event for %s, got events: %+v", testFile, events)
	}
}

func TestWatcherModifyEvent(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "watcher-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("initial"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	var mu sync.Mutex
	var events []Event

	w, err := New(tmpDir, 50*time.Millisecond, func(e Event) {
		mu.Lock()
		events = append(events, e)
		mu.Unlock()
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Close()

	err = w.Start()
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	// Give the watcher time to start
	time.Sleep(100 * time.Millisecond)

	// Clear any initial events
	mu.Lock()
	events = nil
	mu.Unlock()

	// Modify the file
	if err := os.WriteFile(testFile, []byte("modified"), 0644); err != nil {
		t.Fatalf("Failed to modify test file: %v", err)
	}

	// Wait for debounce and event processing
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	if len(events) == 0 {
		t.Fatal("Expected at least one event, got none")
	}

	found := false
	for _, e := range events {
		if e.Type == EventModify && e.Path == testFile {
			found = true
			break
		}
	}

	if !found {
		t.Errorf("Expected modify event for %s, got events: %+v", testFile, events)
	}
}

func TestWatcherDeleteEvent(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "watcher-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	var mu sync.Mutex
	var events []Event

	w, err := New(tmpDir, 50*time.Millisecond, func(e Event) {
		mu.Lock()
		events = append(events, e)
		mu.Unlock()
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Close()

	err = w.Start()
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	// Give the watcher time to start
	time.Sleep(100 * time.Millisecond)

	// Clear any initial events
	mu.Lock()
	events = nil
	mu.Unlock()

	// Delete the file
	if err := os.Remove(testFile); err != nil {
		t.Fatalf("Failed to delete test file: %v", err)
	}

	// Wait for debounce and event processing
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	if len(events) == 0 {
		t.Fatal("Expected at least one event, got none")
	}

	found := false
	for _, e := range events {
		if e.Type == EventDelete && e.Path == testFile {
			found = true
			break
		}
	}

	if !found {
		t.Errorf("Expected delete event for %s, got events: %+v", testFile, events)
	}
}

func TestWatcherRenameEvent(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "watcher-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	var mu sync.Mutex
	var events []Event

	w, err := New(tmpDir, 50*time.Millisecond, func(e Event) {
		mu.Lock()
		events = append(events, e)
		mu.Unlock()
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Close()

	err = w.Start()
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	// Give the watcher time to start
	time.Sleep(100 * time.Millisecond)

	// Clear any initial events
	mu.Lock()
	events = nil
	mu.Unlock()

	// Rename the file
	newFile := filepath.Join(tmpDir, "renamed.txt")
	if err := os.Rename(testFile, newFile); err != nil {
		t.Fatalf("Failed to rename test file: %v", err)
	}

	// Wait for debounce and event processing
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	if len(events) == 0 {
		t.Fatal("Expected at least one event, got none")
	}

	found := false
	for _, e := range events {
		if e.Type == EventRename && (e.Path == testFile || e.Path == newFile) {
			found = true
			break
		}
	}

	if !found {
		t.Errorf("Expected rename event for %s or %s, got events: %+v", testFile, newFile, events)
	}
}

func TestWatcherDebouncing(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "watcher-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	var mu sync.Mutex
	var events []Event

	w, err := New(tmpDir, 100*time.Millisecond, func(e Event) {
		mu.Lock()
		events = append(events, e)
		mu.Unlock()
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Close()

	err = w.Start()
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	// Give the watcher time to start
	time.Sleep(100 * time.Millisecond)

	testFile := filepath.Join(tmpDir, "test.txt")

	// Create and modify the file rapidly
	for i := 0; i < 10; i++ {
		if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
			t.Fatalf("Failed to write test file: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Wait for debounce
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	eventCount := len(events)
	mu.Unlock()

	// Due to debouncing, we should get significantly fewer events than 10
	// The exact number depends on timing, but it should be much less than 10
	if eventCount >= 10 {
		t.Errorf("Expected debouncing to reduce events, got %d events", eventCount)
	}
}

func TestWatcherClose(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "watcher-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	w, err := New(tmpDir, 100*time.Millisecond, func(e Event) {})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	err = w.Start()
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	err = w.Close()
	if err != nil {
		t.Errorf("Close() error = %v", err)
	}

	// Calling Close again should not panic or error
	err = w.Close()
	if err != nil {
		t.Errorf("Second Close() error = %v", err)
	}
}
