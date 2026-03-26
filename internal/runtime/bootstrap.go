package runtime

import "context"

// Lifecycle defines the minimal runtime lifecycle needed by bootstrap helpers.
type Lifecycle interface {
	Startup(context.Context)
	Shutdown(context.Context)
}

// Start initializes an application runtime using the provided constructor.
func Start[T Lifecycle](ctx context.Context, newApp func() T) (T, func(context.Context), error) {
	app := newApp()
	app.Startup(ctx)
	return app, app.Shutdown, nil
}

// StartForTest mirrors Start while keeping a test-friendly name at call sites.
func StartForTest[T Lifecycle](ctx context.Context, newApp func() T) (T, func(context.Context), error) {
	return Start(ctx, newApp)
}
