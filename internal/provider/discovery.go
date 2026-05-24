package provider

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// DiscoverBinary finds a provider binary using a unified discovery strategy.
// Priority: PATH → common paths → provider-specific candidates → Windows glob expansion
func DiscoverBinary(binaryName string, extraCandidates []string) (string, error) {
	if path, err := exec.LookPath(binaryName); err == nil {
		return path, nil
	}

	candidates := commonBinaryCandidates(binaryName)
	candidates = append(candidates, extraCandidates...)

	for _, candidate := range candidates {
		if isExecutable(candidate) {
			return candidate, nil
		}
	}

	if runtime.GOOS == "windows" {
		for _, candidate := range candidates {
			if strings.Contains(candidate, "*") {
				matches, _ := filepath.Glob(candidate)
				for _, m := range matches {
					if isExecutable(m) {
						return m, nil
					}
				}
			}
		}
	}

	return "", fmt.Errorf("binary %q not found", binaryName)
}

func commonBinaryCandidates(binaryName string) []string {
	home, _ := os.UserHomeDir()
	candidates := []string{
		"/opt/homebrew/bin/" + binaryName,
		"/usr/local/bin/" + binaryName,
		"/usr/bin/" + binaryName,
	}

	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".local", "bin", binaryName),
			filepath.Join(home, ".npm-global", "bin", binaryName),
			filepath.Join(home, ".cargo", "bin", binaryName),
		)
	}

	return candidates
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	if info.IsDir() {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	return info.Mode()&0111 != 0
}
