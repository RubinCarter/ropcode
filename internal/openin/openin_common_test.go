package openin

import (
	"errors"
	"runtime"
	"testing"
)

func TestList_NonEmpty(t *testing.T) {
	got := List()
	if len(got) == 0 {
		t.Fatalf("List() returned empty slice on %s", runtime.GOOS)
	}
}

func TestList_PerOS(t *testing.T) {
	got := List()
	want := platformExpectedList(t)
	if len(got) != len(want) {
		t.Fatalf("List() length = %d, want %d (got %v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("List()[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestList_NoDuplicates(t *testing.T) {
	seen := map[AppType]bool{}
	for _, a := range List() {
		if seen[a] {
			t.Errorf("duplicate AppType in List: %q", a)
		}
		seen[a] = true
	}
}

func TestOpen_FinderAlias(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("finder alias only meaningful on macOS")
	}
	// On macOS the legacy "finder" key must route to AppFileManager.
	cmd, err := buildCmd(AppFileManager, "/tmp")
	if err != nil {
		t.Fatalf("buildCmd(filemanager) returned err: %v", err)
	}
	if cmd == nil {
		t.Fatal("buildCmd(filemanager) returned nil cmd")
	}
}

func TestOpen_UnsupportedReturnsTypedError(t *testing.T) {
	var unsupported AppType
	switch runtime.GOOS {
	case "windows":
		unsupported = AppPyCharm
	default:
		unsupported = AppCmd
	}
	err := Open(unsupported, "/tmp")
	if err == nil {
		t.Fatalf("Open(%q) on %s returned nil err", unsupported, runtime.GOOS)
	}
	var ue *ErrUnsupported
	if !errors.As(err, &ue) {
		t.Fatalf("Open(%q) error = %T, want *ErrUnsupported", unsupported, err)
	}
	if ue.App != unsupported {
		t.Errorf("ErrUnsupported.App = %q, want %q", ue.App, unsupported)
	}
}

func TestDefaultTerminal(t *testing.T) {
	got := DefaultTerminal()
	want := platformExpectedDefaultTerminal()
	if got != want {
		t.Errorf("DefaultTerminal() = %q, want %q on %s", got, want, runtime.GOOS)
	}
}
