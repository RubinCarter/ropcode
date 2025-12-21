package main

// This file ensures core dependencies are included as direct dependencies in go.mod
import (
	_ "github.com/aymanbagabas/go-pty"
	_ "github.com/fsnotify/fsnotify"
	_ "github.com/go-git/go-git/v5"
	_ "github.com/google/uuid"
	_ "github.com/klauspost/compress/zstd"
	_ "golang.org/x/crypto/ssh"
	_ "modernc.org/sqlite"
)
