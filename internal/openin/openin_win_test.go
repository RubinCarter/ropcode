//go:build windows

package openin

import (
	"errors"
	"os/exec"
	"strings"
	"testing"
)

func platformExpectedList(_ *testing.T) []AppType {
	return []AppType{
		AppFileManager,
		AppVSCode,
		AppCursor,
		AppWindsurf,
		AppCmd,
		AppPowerShell,
		AppGitBash,
		AppWinTerm,
	}
}

func platformExpectedDefaultTerminal() AppType { return AppCmd }

func TestBuildCmd_WindowsAlwaysAvailable(t *testing.T) {
	// explorer.exe and cmd.exe are guaranteed on every Windows install.
	cmd, err := buildCmd(AppFileManager, `C:\proj`)
	if err != nil {
		t.Fatalf("buildCmd(filemanager): %v", err)
	}
	if !strings.HasSuffix(strings.ToLower(cmd.Path), "explorer.exe") {
		t.Errorf("filemanager Path = %q, want explorer.exe", cmd.Path)
	}
	if len(cmd.Args) < 2 || cmd.Args[len(cmd.Args)-1] != `C:\proj` {
		t.Errorf("filemanager Args = %v, expected last arg = path", cmd.Args)
	}

	cmd, err = buildCmd(AppCmd, `C:\proj`)
	if err != nil {
		t.Fatalf("buildCmd(cmd): %v", err)
	}
	if !strings.HasSuffix(strings.ToLower(cmd.Path), "cmd.exe") {
		t.Errorf("cmd Path = %q, want cmd.exe", cmd.Path)
	}
	want := []string{"cmd.exe", "/c", "start", "", "/D", `C:\proj`, "cmd.exe"}
	if len(cmd.Args) != len(want) {
		t.Fatalf("cmd Args = %v, want %v", cmd.Args, want)
	}
	for i, w := range want {
		if cmd.Args[i] != w {
			t.Errorf("cmd Args[%d] = %q, want %q", i, cmd.Args[i], w)
		}
	}
}

func TestBuildCmd_WindowsLookPathBacked(t *testing.T) {
	// For LookPath-backed apps, accept either a successful command (if installed)
	// or *ErrNotInstalled (if missing). Anything else is a bug.
	cases := []struct {
		app  AppType
		exec string
	}{
		{AppVSCode, "code.cmd"},
		{AppCursor, "cursor.cmd"},
		{AppWindsurf, "windsurf.cmd"},
		{AppGitBash, "git-bash.exe"},
		{AppWinTerm, "wt.exe"},
	}
	for _, tc := range cases {
		cmd, err := buildCmd(tc.app, `C:\proj`)
		if err != nil {
			var ni *ErrNotInstalled
			if !errors.As(err, &ni) {
				t.Errorf("buildCmd(%q) err = %T, want *ErrNotInstalled", tc.app, err)
				continue
			}
			if ni.App != tc.app {
				t.Errorf("ErrNotInstalled.App = %q, want %q", ni.App, tc.app)
			}
			continue
		}
		// If the binary IS installed, sanity-check the cmd shape.
		if cmd == nil {
			t.Errorf("buildCmd(%q) returned nil cmd, nil err", tc.app)
			continue
		}
		if cmd.Args[len(cmd.Args)-1] != `C:\proj` && !endsWithCdFlag(cmd.Args, `C:\proj`) {
			t.Errorf("buildCmd(%q).Args = %v, expected path tail", tc.app, cmd.Args)
		}
	}
}

func TestBuildCmd_WindowsRejectsMacTypes(t *testing.T) {
	for _, app := range []AppType{AppPyCharm, AppIDEA, AppCLion, AppAndroidStudio,
		AppWebStorm, AppGoLand, AppSublime, AppITerm, AppMacTerminal} {
		_, err := buildCmd(app, `C:\proj`)
		if err == nil {
			t.Errorf("buildCmd(%q) returned nil err on Windows", app)
			continue
		}
		var ue *ErrUnsupported
		if !errors.As(err, &ue) {
			t.Errorf("buildCmd(%q) err = %T, want *ErrUnsupported", app, err)
		}
	}
}

func TestLookFirst(t *testing.T) {
	// cmd.exe is always present.
	got, err := lookFirst("definitely-missing-binary.exe", "cmd.exe")
	if err != nil {
		t.Fatalf("lookFirst err: %v", err)
	}
	if !strings.HasSuffix(strings.ToLower(got), "cmd.exe") {
		t.Errorf("lookFirst returned %q, expected cmd.exe", got)
	}

	_, err = lookFirst("definitely-missing-1.exe", "definitely-missing-2.exe")
	if err == nil {
		t.Fatal("lookFirst with all missing returned nil err")
	}
}

func endsWithCdFlag(args []string, path string) bool {
	for _, a := range args {
		if a == "--cd="+path || a == "-d" {
			return true
		}
	}
	return false
}

// silence unused-import nag on builds where exec isn't otherwise referenced.
var _ = exec.LookPath
