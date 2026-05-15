//go:build windows

package claude

func ensureFullShellPath(env []string) []string {
	return env
}
