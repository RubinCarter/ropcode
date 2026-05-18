package codex

import (
	"path/filepath"
	"runtime"
	"testing"
)

func TestWindowsCodexBinaryCandidatesPreferNativeExeBeforeNpmShim(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows-only binary discovery")
	}

	candidates := windowsCodexBinaryCandidates("C:\\Users\\tester", "C:\\Users\\tester\\AppData\\Local", "C:\\Users\\tester\\AppData\\Roaming", "C:\\ProgramData")
	if len(candidates) == 0 {
		t.Fatal("expected windows candidates")
	}

	npmShimIndex := -1
	nativeIndex := -1
	for i, candidate := range candidates {
		if candidate == filepath.Clean("C:\\ProgramData\\npm\\npm\\codex.cmd") {
			npmShimIndex = i
		}
		if filepath.Base(candidate) == "codex.exe" {
			nativeIndex = i
		}
	}

	if npmShimIndex < 0 {
		t.Fatal("expected npm shim candidate")
	}
	if nativeIndex < 0 {
		t.Fatal("expected native codex.exe candidate")
	}
	if nativeIndex > npmShimIndex {
		t.Fatalf("expected native codex.exe before npm shim, native=%d npm=%d", nativeIndex, npmShimIndex)
	}
}
