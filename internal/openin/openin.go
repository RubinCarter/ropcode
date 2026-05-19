//go:build !windows

package openin

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func openPlatform(app AppType, path string) error {
	switch app {
	case AppWindsurf:
		// Bundle ID launch with -a fallback (use Run to detect bundle miss).
		primary := exec.Command("open", "-b", "com.exafunction.windsurf", path)
		if err := primary.Run(); err == nil {
			return nil
		}
		return exec.Command("open", "-a", "Windsurf", path).Start()

	case AppSublime:
		// Try Sublime Text 4 first, fall through to 3 (legacy behavior).
		cmd := exec.Command("open", "-b", "com.sublimetext.4", path)
		if err := cmd.Start(); err == nil {
			return nil
		}
		return exec.Command("open", "-b", "com.sublimetext.3", path).Start()

	case AppPyCharm, AppIDEA, AppCLion, AppAndroidStudio, AppWebStorm, AppGoLand:
		cmd, err := buildJetBrainsCmd(app, path)
		if err != nil {
			return err
		}
		return cmd.Start()

	default:
		cmd, err := buildCmd(app, path)
		if err != nil {
			return err
		}
		return cmd.Start()
	}
}

// buildCmd constructs the command for app types that have a single
// deterministic invocation. Returns ErrUnsupported for app types that aren't
// implemented on this OS, and routes IDE searches through buildJetBrainsCmd.
func buildCmd(app AppType, path string) (*exec.Cmd, error) {
	switch app {
	case AppFileManager:
		return exec.Command("open", path), nil

	case AppMacTerminal:
		script := fmt.Sprintf(`tell application "Terminal"
    activate
    do script "cd '%s'"
end tell`, path)
		return exec.Command("osascript", "-e", script), nil

	case AppITerm:
		script := fmt.Sprintf(`tell application "iTerm"
    activate
    try
        tell current window
            create tab with default profile
            tell current session
                write text "cd '%s'"
            end tell
        end tell
    on error
        create window with default profile
        tell current session of current window
            write text "cd '%s'"
        end tell
    end try
end tell`, path, path)
		return exec.Command("osascript", "-e", script), nil

	case AppVSCode:
		return exec.Command("open", "-b", "com.microsoft.VSCode", path), nil

	case AppCursor:
		return exec.Command("open", "-b", "com.todesktop.230313mzl4w4u92", path), nil

	case AppWindsurf:
		return exec.Command("open", "-b", "com.exafunction.windsurf", path), nil

	case AppSublime:
		return exec.Command("open", "-b", "com.sublimetext.4", path), nil

	case AppPyCharm, AppIDEA, AppCLion, AppAndroidStudio, AppWebStorm, AppGoLand:
		return buildJetBrainsCmd(app, path)

	case AppCmd, AppPowerShell, AppGitBash, AppWinTerm:
		return nil, &ErrUnsupported{App: app, OS: "darwin"}
	}
	return nil, &ErrUnsupported{App: app, OS: "darwin"}
}

func buildJetBrainsCmd(app AppType, path string) (*exec.Cmd, error) {
	patterns := map[AppType]string{
		AppPyCharm:       "PyCharm",
		AppIDEA:          "IntelliJ IDEA",
		AppCLion:         "CLion",
		AppAndroidStudio: "Android Studio",
		AppWebStorm:      "WebStorm",
		AppGoLand:        "GoLand",
	}
	pattern, ok := patterns[app]
	if !ok {
		return nil, &ErrUnsupported{App: app, OS: "darwin"}
	}

	homeDir, _ := os.UserHomeDir()
	searchDirs := []string{"/Applications", filepath.Join(homeDir, "Applications")}
	for _, dir := range searchDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			name := entry.Name()
			if strings.HasPrefix(name, pattern) && strings.HasSuffix(name, ".app") {
				fullPath := filepath.Join(dir, name)
				return exec.Command("open", "-na", fullPath, "--args", path), nil
			}
		}
	}
	return nil, &ErrNotInstalled{App: app, Executable: pattern + ".app"}
}

func listPlatform() []AppType {
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

func availablePlatform(app AppType) bool {
	for _, a := range listPlatform() {
		if a == app {
			return true
		}
	}
	return false
}

func defaultTerminalPlatform() AppType { return AppMacTerminal }
