package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsSpecificCodeLivesInWinFiles(t *testing.T) {
	checks := map[string][]string{
		"bindings.go": {
			`goruntime.GOOS != "windows"`,
			`goruntime.GOOS == "windows"`,
			`path[0] == '/' &&`,
		},
		"internal/pty/session.go": {
			`runtime.GOOS != "windows"`,
			`runtime.GOOS == "windows"`,
			`COMSPEC`,
			`cmd.exe`,
			`powershell.exe`,
		},
	}

	for filePath, forbidden := range checks {
		t.Run(filePath, func(t *testing.T) {
			data, err := os.ReadFile(filePath)
			if err != nil {
				t.Fatalf("ReadFile failed: %v", err)
			}
			source := string(data)
			for _, needle := range forbidden {
				if strings.Contains(source, needle) {
					t.Fatalf("expected %s to keep platform-specific code in win files; found %q", filePath, needle)
				}
			}
		})
	}
}

func TestPlatformFileNamesUseWinSuffix(t *testing.T) {
	err := filepath.WalkDir(".", func(filePath string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			switch d.Name() {
			case ".git", ".ropcode", "node_modules", "dist", "release", "bin":
				return filepath.SkipDir
			}
			return nil
		}

		name := d.Name()
		if strings.Contains(name, "_windows.") || strings.Contains(name, "_unix.") {
			t.Fatalf("platform-specific files must keep Unix/default names and use _win for Windows, found %s", filePath)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("WalkDir failed: %v", err)
	}
}
