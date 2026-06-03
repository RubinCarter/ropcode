package pty

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrepareShellIntegrationFilesWritesStartupFiles(t *testing.T) {
	for _, tc := range []struct {
		name      string
		shell     string
		path      func(*shellIntegrationFiles) string
		mustHave  []string
		mustAvoid []string
	}{
		{
			name:  "bash",
			shell: "/bin/bash",
			path:  func(files *shellIntegrationFiles) string { return files.bashRC },
			mustHave: []string{
				`"shell":"bash"`,
				"]16162;M;",
				"]16162;A",
				"]16162;C;",
				"]16162;D;",
				"]7;file://localhost/",
				"precmd_functions+=(__ropcode_si_precmd)",
				"preexec_functions+=(__ropcode_si_preexec)",
			},
			mustAvoid: []string{"trap '__ropcode_si_preexec' DEBUG"},
		},
		{
			name:  "zsh",
			shell: "/bin/zsh",
			path:  func(files *shellIntegrationFiles) string { return filepath.Join(files.zdotdir, ".zshrc") },
			mustHave: []string{
				`"shell":"zsh"`,
				"]16162;M;",
				"]16162;A",
				"]16162;C;",
				"]16162;D;",
				"]7;file://localhost/",
			},
		},
		{
			name:  "fish",
			shell: "/usr/bin/fish",
			path:  func(files *shellIntegrationFiles) string { return files.fishInit },
			mustHave: []string{
				`"shell":"fish"`,
				"]16162;M;",
				"]16162;A",
				"]16162;C;",
				"]16162;D;",
				"]7;file://localhost/",
			},
		},
		{
			name:  "powershell",
			shell: "/usr/bin/pwsh",
			path:  func(files *shellIntegrationFiles) string { return files.pwshInit },
			mustHave: []string{
				"shell",
				"pwsh",
				"integration",
				"false",
				"]16162;M;",
				"]7;file://localhost/",
				"function Global:prompt",
			},
			mustAvoid: []string{"]16162;C;", "]16162;D;"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files, err := prepareShellIntegrationFiles(tc.shell)
			if err != nil {
				t.Fatalf("prepare shell integration: %v", err)
			}
			if files == nil {
				t.Fatal("expected integration files")
			}
			defer files.cleanup()

			contentBytes, err := os.ReadFile(tc.path(files))
			if err != nil {
				t.Fatalf("read startup file: %v", err)
			}
			content := string(contentBytes)
			for _, want := range tc.mustHave {
				if !strings.Contains(content, want) {
					t.Fatalf("startup file missing %q:\n%s", want, content)
				}
			}
			for _, avoid := range tc.mustAvoid {
				if strings.Contains(content, avoid) {
					t.Fatalf("startup file should avoid %q:\n%s", avoid, content)
				}
			}
			if tc.name == "bash" {
				if _, err := os.Stat(filepath.Join(files.dir, "bash_preexec.sh")); err != nil {
					t.Fatalf("expected bash_preexec.sh: %v", err)
				}
			}
		})
	}
}

func TestPrepareShellIntegrationFilesSkipsUnknownShell(t *testing.T) {
	files, err := prepareShellIntegrationFiles("/bin/sh")
	if err != nil {
		t.Fatalf("prepare unknown shell: %v", err)
	}
	if files != nil {
		defer files.cleanup()
		t.Fatalf("expected no integration files for sh, got %#v", files)
	}
}
