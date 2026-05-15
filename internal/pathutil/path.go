//go:build !windows

package pathutil

func NormalizeClientPath(path string) string {
	return path
}
