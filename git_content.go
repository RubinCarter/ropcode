package main

import (
	"ropcode/internal/gitcontent"
)

func (a *App) ReadGitFileAtHead(workspacePath, gitPath string) (string, error) {
	return gitcontent.ReadGitFileAtHead(workspacePath, gitPath)
}
