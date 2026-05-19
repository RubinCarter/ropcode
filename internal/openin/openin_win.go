//go:build windows

package openin

import (
	"os/exec"
)

func openPlatform(app AppType, path string) error {
	cmd, err := buildCmd(app, path)
	if err != nil {
		return err
	}
	return cmd.Start()
}

// buildCmd resolves the executable for app via LookPath and constructs the
// launch command. Returns ErrNotInstalled when the backing binary cannot be
// found and ErrUnsupported when app is not implemented on Windows.
func buildCmd(app AppType, path string) (*exec.Cmd, error) {
	switch app {
	case AppFileManager:
		return exec.Command("explorer.exe", path), nil

	case AppVSCode:
		return lookAndCommand(app, "code.cmd", path)

	case AppCursor:
		return lookAndCommand(app, "cursor.cmd", path)

	case AppWindsurf:
		return lookAndCommand(app, "windsurf.cmd", path)

	case AppCmd:
		return exec.Command("cmd.exe", "/c", "start", "", "/D", path, "cmd.exe"), nil

	case AppPowerShell:
		ps, err := lookFirst("pwsh.exe", "powershell.exe")
		if err != nil {
			return nil, &ErrNotInstalled{App: app, Executable: "pwsh.exe / powershell.exe"}
		}
		return exec.Command("cmd.exe", "/c", "start", "", "/D", path, ps), nil

	case AppGitBash:
		// Resolve git-bash.exe explicitly; bash.exe in PATH usually means WSL.
		exe, err := exec.LookPath("git-bash.exe")
		if err != nil {
			return nil, &ErrNotInstalled{App: app, Executable: "git-bash.exe"}
		}
		return exec.Command(exe, "--cd="+path), nil

	case AppWinTerm:
		exe, err := exec.LookPath("wt.exe")
		if err != nil {
			return nil, &ErrNotInstalled{App: app, Executable: "wt.exe"}
		}
		return exec.Command(exe, "-d", path), nil

	case AppPyCharm, AppIDEA, AppCLion, AppAndroidStudio, AppWebStorm, AppGoLand,
		AppSublime, AppITerm, AppMacTerminal:
		return nil, &ErrUnsupported{App: app, OS: "windows"}
	}
	return nil, &ErrUnsupported{App: app, OS: "windows"}
}

func lookAndCommand(app AppType, exe, path string) (*exec.Cmd, error) {
	resolved, err := exec.LookPath(exe)
	if err != nil {
		return nil, &ErrNotInstalled{App: app, Executable: exe}
	}
	return exec.Command(resolved, path), nil
}

func lookFirst(candidates ...string) (string, error) {
	var lastErr error
	for _, c := range candidates {
		if p, err := exec.LookPath(c); err == nil {
			return p, nil
		} else {
			lastErr = err
		}
	}
	if lastErr == nil {
		lastErr = exec.ErrNotFound
	}
	return "", lastErr
}

func listPlatform() []AppType {
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

func availablePlatform(app AppType) bool {
	switch app {
	case AppFileManager, AppCmd:
		return true
	case AppVSCode:
		return lookOk("code.cmd")
	case AppCursor:
		return lookOk("cursor.cmd")
	case AppWindsurf:
		return lookOk("windsurf.cmd")
	case AppPowerShell:
		return lookOk("pwsh.exe") || lookOk("powershell.exe")
	case AppGitBash:
		return lookOk("git-bash.exe")
	case AppWinTerm:
		return lookOk("wt.exe")
	}
	return false
}

func lookOk(exe string) bool {
	_, err := exec.LookPath(exe)
	return err == nil
}

func defaultTerminalPlatform() AppType { return AppCmd }
