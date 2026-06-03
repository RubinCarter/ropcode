package notifications

func notificationTitle(event SessionFinished) string {
	provider := event.Provider
	if provider == "" {
		provider = "AI"
	}
	switch event.Status {
	case "completed":
		return "Ropcode: " + provider + " session completed"
	case "cancelled":
		return "Ropcode: " + provider + " session cancelled"
	case "failed":
		return "Ropcode: " + provider + " session failed"
	default:
		return "Ropcode: " + provider + " session finished"
	}
}

func notificationBody(event SessionFinished) string {
	return ProjectLabel(event.Cwd)
}
