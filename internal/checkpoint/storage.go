// internal/checkpoint/storage.go
package checkpoint

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/klauspost/compress/zstd"
)

// Storage manages checkpoint persistence
type Storage struct {
	baseDir          string
	compressionLevel int
	mu               sync.RWMutex
	encoder          *zstd.Encoder
	decoder          *zstd.Decoder
}

// NewStorage creates a new checkpoint storage
func NewStorage(baseDir string, compressionLevel int) *Storage {
	encoder, _ := zstd.NewWriter(nil, zstd.WithEncoderLevel(zstd.EncoderLevelFromZstd(compressionLevel)))
	decoder, _ := zstd.NewReader(nil)

	return &Storage{
		baseDir:          baseDir,
		compressionLevel: compressionLevel,
		encoder:          encoder,
		decoder:          decoder,
	}
}

// checkpointsDir returns the path for checkpoints
func (s *Storage) checkpointsDir(projectID, sessionID string) string {
	return filepath.Join(s.baseDir, "checkpoints", projectID, sessionID)
}

// Save saves a checkpoint with its files and messages
func (s *Storage) Save(projectID, sessionID string, checkpoint *Checkpoint, files []FileSnapshot, messages string) (*CheckpointResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Set timestamp if not set
	if checkpoint.Timestamp.IsZero() {
		checkpoint.Timestamp = time.Now()
	}

	baseDir := s.checkpointsDir(projectID, sessionID)
	checkpointDir := filepath.Join(baseDir, checkpoint.ID)

	// Create directories
	if err := os.MkdirAll(checkpointDir, 0755); err != nil {
		return nil, fmt.Errorf("create checkpoint dir: %w", err)
	}

	// Save metadata
	metadataPath := filepath.Join(checkpointDir, "metadata.json")
	metadataJSON, err := json.MarshalIndent(checkpoint, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal metadata: %w", err)
	}
	if err := os.WriteFile(metadataPath, metadataJSON, 0644); err != nil {
		return nil, fmt.Errorf("write metadata: %w", err)
	}

	// Compress and save messages
	messagesPath := filepath.Join(checkpointDir, "messages.zst")
	compressed := s.encoder.EncodeAll([]byte(messages), nil)
	if err := os.WriteFile(messagesPath, compressed, 0644); err != nil {
		return nil, fmt.Errorf("write messages: %w", err)
	}

	// Save file snapshots (with content-addressable storage)
	result := &CheckpointResult{
		Checkpoint: checkpoint,
	}

	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, file := range files {
		wg.Add(1)
		go func(f FileSnapshot) {
			defer wg.Done()
			if err := s.saveFileSnapshot(baseDir, &f); err != nil {
				mu.Lock()
				result.Warnings = append(result.Warnings, fmt.Sprintf("Failed to save %s: %v", f.FilePath, err))
				mu.Unlock()
			} else {
				mu.Lock()
				result.FilesProcessed++
				mu.Unlock()
			}
		}(file)
	}

	wg.Wait()

	return result, nil
}

// saveFileSnapshot saves a file using content-addressable storage
func (s *Storage) saveFileSnapshot(baseDir string, snapshot *FileSnapshot) error {
	contentPoolDir := filepath.Join(baseDir, "content_pool")
	if err := os.MkdirAll(contentPoolDir, 0755); err != nil {
		return err
	}

	// Content-addressable: store by hash to avoid duplicates
	contentFile := filepath.Join(contentPoolDir, snapshot.Hash)
	if _, err := os.Stat(contentFile); os.IsNotExist(err) {
		compressed := s.encoder.EncodeAll([]byte(snapshot.Content), nil)
		if err := os.WriteFile(contentFile, compressed, 0644); err != nil {
			return err
		}
	}

	// Save reference metadata
	refsDir := filepath.Join(baseDir, "refs", snapshot.CheckpointID)
	if err := os.MkdirAll(refsDir, 0755); err != nil {
		return err
	}

	refMeta := map[string]interface{}{
		"path":        snapshot.FilePath,
		"hash":        snapshot.Hash,
		"is_deleted":  snapshot.IsDeleted,
		"permissions": snapshot.Permissions,
		"size":        snapshot.Size,
	}

	// Use sanitized filename for reference
	safeName := filepath.Base(snapshot.FilePath)
	refPath := filepath.Join(refsDir, safeName+".json")
	refJSON, _ := json.MarshalIndent(refMeta, "", "  ")
	return os.WriteFile(refPath, refJSON, 0644)
}

// Load loads a checkpoint with its messages
func (s *Storage) Load(projectID, sessionID, checkpointID string) (*Checkpoint, []FileSnapshot, string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	checkpointDir := filepath.Join(s.checkpointsDir(projectID, sessionID), checkpointID)

	// Load metadata
	metadataPath := filepath.Join(checkpointDir, "metadata.json")
	metadataJSON, err := os.ReadFile(metadataPath)
	if err != nil {
		return nil, nil, "", fmt.Errorf("read metadata: %w", err)
	}

	var checkpoint Checkpoint
	if err := json.Unmarshal(metadataJSON, &checkpoint); err != nil {
		return nil, nil, "", fmt.Errorf("unmarshal metadata: %w", err)
	}

	// Load and decompress messages
	messagesPath := filepath.Join(checkpointDir, "messages.zst")
	compressed, err := os.ReadFile(messagesPath)
	if err != nil {
		return nil, nil, "", fmt.Errorf("read messages: %w", err)
	}

	messagesBytes, err := s.decoder.DecodeAll(compressed, nil)
	if err != nil {
		return nil, nil, "", fmt.Errorf("decompress messages: %w", err)
	}

	return &checkpoint, nil, string(messagesBytes), nil
}

// List lists all checkpoints for a session
func (s *Storage) List(projectID, sessionID string) ([]Checkpoint, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	checkpointsDir := s.checkpointsDir(projectID, sessionID)
	entries, err := os.ReadDir(checkpointsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var checkpoints []Checkpoint
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		metadataPath := filepath.Join(checkpointsDir, entry.Name(), "metadata.json")
		metadataJSON, err := os.ReadFile(metadataPath)
		if err != nil {
			continue
		}

		var cp Checkpoint
		if json.Unmarshal(metadataJSON, &cp) == nil {
			checkpoints = append(checkpoints, cp)
		}
	}

	return checkpoints, nil
}

// Delete removes a checkpoint
func (s *Storage) Delete(projectID, sessionID, checkpointID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	checkpointDir := filepath.Join(s.checkpointsDir(projectID, sessionID), checkpointID)
	return os.RemoveAll(checkpointDir)
}

// GenerateID generates a new checkpoint ID
func GenerateID() string {
	return uuid.New().String()
}

// CalculateHash calculates SHA256 hash of content
func CalculateHash(content string) string {
	h := sha256.Sum256([]byte(content))
	return fmt.Sprintf("%x", h)
}
