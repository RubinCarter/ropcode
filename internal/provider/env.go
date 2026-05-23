package provider

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// BuildProcessEnv 构建进程环境变量。
// 分层：基础环境 → 平台 PATH 增强 → provider 特有变量
func BuildProcessEnv(driverEnvVars map[string]string) []string {
	env := os.Environ()
	env = enhancePATH(env)
	env = applyEnvVars(env, driverEnvVars)
	return env
}

// enhancePATH 为 .app 打包环境补充常用工具路径。
func enhancePATH(env []string) []string {
	if runtime.GOOS == "windows" {
		return env
	}

	home, _ := os.UserHomeDir()
	additionalPaths := []string{
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		"/usr/sbin",
		"/sbin",
	}

	if home != "" {
		additionalPaths = append(additionalPaths,
			filepath.Join(home, ".local", "bin"),
			filepath.Join(home, ".npm-global", "bin"),
			filepath.Join(home, ".cargo", "bin"),
		)
	}

	for i, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			currentPath := strings.TrimPrefix(e, "PATH=")
			pathSet := make(map[string]bool)
			for _, p := range strings.Split(currentPath, ":") {
				pathSet[p] = true
			}

			var toAdd []string
			for _, p := range additionalPaths {
				if !pathSet[p] {
					toAdd = append(toAdd, p)
				}
			}

			if len(toAdd) > 0 {
				env[i] = "PATH=" + currentPath + ":" + strings.Join(toAdd, ":")
			}
			return env
		}
	}

	env = append(env, "PATH="+strings.Join(additionalPaths, ":"))
	return env
}

// applyEnvVars 将 driver 提供的环境变量合并到 env 中。
// 已存在的 key 会被覆盖。
func applyEnvVars(env []string, vars map[string]string) []string {
	for key, val := range vars {
		prefix := key + "="
		found := false
		for i, e := range env {
			if strings.HasPrefix(e, prefix) {
				env[i] = prefix + val
				found = true
				break
			}
		}
		if !found {
			env = append(env, prefix+val)
		}
	}
	return env
}
