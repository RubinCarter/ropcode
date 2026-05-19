//go:build !windows

package openin

import (
	"strings"
	"testing"
)

func platformExpectedList(_ *testing.T) []AppType {
	return []AppType{
		AppFileManager,
		AppVSCode,
		AppCursor,
		AppWindsurf,
		AppPyCharm,
		AppIDEA,
		AppAndroidStudio,
		AppCLion,
		AppWebStorm,
		AppGoLand,
		AppSublime,
		AppITerm,
		AppMacTerminal,
	}
}

func platformExpectedDefaultTerminal() AppType { return AppMacTerminal }

func TestBuildCmd_macOSDeterministicLaunches(t *testing.T) {
	cases := []struct {
		app      AppType
		wantBin  string
		wantArgs []string
	}{
		{AppFileManager, "open", []string{"open", "/proj"}},
		{AppVSCode, "open", []string{"open", "-b", "com.microsoft.VSCode", "/proj"}},
		{AppCursor, "open", []string{"open", "-b", "com.todesktop.230313mzl4w4u92", "/proj"}},
		{AppWindsurf, "open", []string{"open", "-b", "com.exafunction.windsurf", "/proj"}},
		{AppSublime, "open", []string{"open", "-b", "com.sublimetext.4", "/proj"}},
	}
	for _, tc := range cases {
		cmd, err := buildCmd(tc.app, "/proj")
		if err != nil {
			t.Errorf("buildCmd(%q): unexpected err: %v", tc.app, err)
			continue
		}
		if !strings.HasSuffix(cmd.Path, tc.wantBin) {
			t.Errorf("buildCmd(%q).Path = %q, want suffix %q", tc.app, cmd.Path, tc.wantBin)
		}
		if !equalStrings(cmd.Args, tc.wantArgs) {
			t.Errorf("buildCmd(%q).Args = %v, want %v", tc.app, cmd.Args, tc.wantArgs)
		}
	}
}

func TestBuildCmd_macOSAppleScript(t *testing.T) {
	cmd, err := buildCmd(AppMacTerminal, "/proj")
	if err != nil {
		t.Fatalf("buildCmd(terminal): %v", err)
	}
	if len(cmd.Args) != 3 || cmd.Args[1] != "-e" {
		t.Fatalf("Terminal args = %v, want [osascript -e <script>]", cmd.Args)
	}
	if !strings.Contains(cmd.Args[2], "Terminal") || !strings.Contains(cmd.Args[2], "/proj") {
		t.Errorf("Terminal script missing app/path: %q", cmd.Args[2])
	}

	cmd, err = buildCmd(AppITerm, "/proj")
	if err != nil {
		t.Fatalf("buildCmd(iterm): %v", err)
	}
	if !strings.Contains(cmd.Args[2], "iTerm") || !strings.Contains(cmd.Args[2], "/proj") {
		t.Errorf("iTerm script missing app/path: %q", cmd.Args[2])
	}
}

func TestBuildCmd_macOSRejectsWindowsTypes(t *testing.T) {
	for _, app := range []AppType{AppCmd, AppPowerShell, AppGitBash, AppWinTerm} {
		_, err := buildCmd(app, "/proj")
		if err == nil {
			t.Errorf("buildCmd(%q) returned nil err on macOS", app)
			continue
		}
		if _, ok := err.(*ErrUnsupported); !ok {
			t.Errorf("buildCmd(%q) err = %T, want *ErrUnsupported", app, err)
		}
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
