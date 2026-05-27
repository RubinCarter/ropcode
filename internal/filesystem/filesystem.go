package filesystem

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"ropcode/internal/pathutil"
)

type FileEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	IsDirectory bool   `json:"is_directory"`
	Size        int64  `json:"size"`
	Extension   string `json:"extension,omitempty"`
}

type FileMetadata struct {
	Size        int64  `json:"size"`
	IsDirectory bool   `json:"is_directory"`
	IsWritable  bool   `json:"is_writable"`
	IsBinary    bool   `json:"is_binary"`
	Extension   string `json:"extension,omitempty"`
}

func ListDirectory(path string) ([]FileEntry, error) {
	path = pathutil.NormalizeClientPath(path)
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	result := make([]FileEntry, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		ext := ""
		if !entry.IsDir() {
			ext = strings.TrimPrefix(filepath.Ext(entry.Name()), ".")
		}
		result = append(result, FileEntry{
			Name:        entry.Name(),
			Path:        filepath.Join(path, entry.Name()),
			IsDirectory: entry.IsDir(),
			Size:        info.Size(),
			Extension:   ext,
		})
	}
	return result, nil
}

func ReadFile(path string) (string, error) {
	path = pathutil.NormalizeClientPath(path)
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func WriteFile(path, content string) error {
	path = pathutil.NormalizeClientPath(path)
	return os.WriteFile(path, []byte(content), 0644)
}

func GetMetadata(path string) (*FileMetadata, error) {
	path = pathutil.NormalizeClientPath(path)

	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}

	metadata := &FileMetadata{
		Size:        info.Size(),
		IsDirectory: info.IsDir(),
		IsWritable:  true,
		Extension:   strings.TrimPrefix(filepath.Ext(path), "."),
	}

	if info.IsDir() {
		return metadata, nil
	}

	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	buf := make([]byte, 8000)
	n, readErr := file.Read(buf)
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		return nil, readErr
	}
	metadata.IsBinary = isBinaryContent(buf[:n])

	if f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0); err == nil {
		f.Close()
	} else {
		metadata.IsWritable = false
	}

	return metadata, nil
}

func Search(basePath, query string) ([]FileEntry, error) {
	basePath = pathutil.NormalizeClientPath(basePath)
	var results []FileEntry
	query = strings.ToLower(query)

	err := filepath.WalkDir(basePath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if strings.HasPrefix(name, ".") || name == "node_modules" || name == "vendor" || name == "__pycache__" {
				return filepath.SkipDir
			}
		}
		if strings.Contains(strings.ToLower(d.Name()), query) {
			info, err := d.Info()
			if err != nil {
				return nil
			}
			ext := ""
			if !d.IsDir() {
				ext = strings.TrimPrefix(filepath.Ext(d.Name()), ".")
			}
			results = append(results, FileEntry{
				Name:        d.Name(),
				Path:        path,
				IsDirectory: d.IsDir(),
				Size:        info.Size(),
				Extension:   ext,
			})
			if len(results) >= 100 {
				return filepath.SkipAll
			}
		}
		return nil
	})

	if err != nil && err != filepath.SkipAll {
		return nil, err
	}
	return results, nil
}

func isBinaryContent(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	limit := len(data)
	if limit > 8000 {
		limit = 8000
	}
	for _, b := range data[:limit] {
		if b == 0 {
			return true
		}
	}
	return false
}
