package main

import (
	"fmt"
	"os"
)

func main() {
	if err := runCLIArgs(os.Args[1:], os.Stdout, os.Stderr, defaultCLIDeps()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
