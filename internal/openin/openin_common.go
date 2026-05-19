// Package openin opens project paths in external applications (file managers,
// editors, terminals). Platform-specific implementations live in openin_unix.go
// and openin_win.go; this file declares the common surface.
package openin

import "fmt"

// AppType identifies an external application target. Values are stable strings
// shared with the frontend.
type AppType string

const (
	AppFileManager AppType = "filemanager"

	AppVSCode   AppType = "vscode"
	AppCursor   AppType = "cursor"
	AppWindsurf AppType = "windsurf"

	// macOS-only IDEs and terminals.
	AppPyCharm       AppType = "pycharm"
	AppIDEA          AppType = "idea"
	AppCLion         AppType = "clion"
	AppAndroidStudio AppType = "android-studio"
	AppWebStorm      AppType = "webstorm"
	AppGoLand        AppType = "goland"
	AppSublime       AppType = "sublime"
	AppITerm         AppType = "iterm"
	AppMacTerminal   AppType = "terminal"

	// Windows-only terminals.
	AppCmd        AppType = "cmd"
	AppPowerShell AppType = "powershell"
	AppGitBash    AppType = "gitbash"
	AppWinTerm    AppType = "wt"
)

// ErrUnsupported is returned when an AppType is not implemented on the current
// OS (e.g. cmd on macOS, pycharm on Windows).
type ErrUnsupported struct {
	App AppType
	OS  string
}

func (e *ErrUnsupported) Error() string {
	return fmt.Sprintf("openin: %q is not supported on %s", e.App, e.OS)
}

// ErrNotInstalled is returned when an app's executable cannot be located via
// PATH lookup (Windows side) or installation search (macOS side).
type ErrNotInstalled struct {
	App        AppType
	Executable string
}

func (e *ErrNotInstalled) Error() string {
	if e.Executable != "" {
		return fmt.Sprintf("openin: %q not found (missing %s)", e.App, e.Executable)
	}
	return fmt.Sprintf("openin: %q not installed", e.App)
}

// Open launches the requested app pointed at path. Legacy "finder" alias is
// rewritten to AppFileManager for backwards compatibility with old frontends.
func Open(app AppType, path string) error {
	if app == "finder" {
		app = AppFileManager
	}
	return openPlatform(app, path)
}

// List returns the AppTypes supported on the current OS, in the order the menu
// should render them.
func List() []AppType {
	return listPlatform()
}

// Available reports whether the executable backing app is locatable on PATH.
// On macOS this is a best-effort PATH check; the actual launch goes through
// `open` so a false result does not always mean Open will fail.
func Available(app AppType) bool {
	return availablePlatform(app)
}

// DefaultTerminal returns the AppType that should be opened when "open in
// terminal" is requested without a specific choice.
func DefaultTerminal() AppType {
	return defaultTerminalPlatform()
}
