package main

import "ropcode/internal/logging"

func configureServerLogging() (string, func(), error) {
	return logging.ConfigureServerLogging()
}
