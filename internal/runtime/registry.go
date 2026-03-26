package runtime

import "ropcode/internal/database"

// Registry wraps instance registry persistence with runtime-specific semantics.
type Registry struct {
	db *database.Database
}

// NewRegistry creates a runtime instance registry helper.
func NewRegistry(db *database.Database) *Registry {
	return &Registry{db: db}
}

// RegisterInstance stores or updates an instance record.
func (r *Registry) RegisterInstance(record *database.InstanceRecord) error {
	return r.db.SaveInstanceRecord(record)
}

// Heartbeat refreshes heartbeat metadata and ensures the instance remains alive.
func (r *Registry) Heartbeat(id string, heartbeatAt int64) error {
	record, err := r.db.GetInstanceRecord(id)
	if err != nil {
		return err
	}

	record.HeartbeatAt = heartbeatAt
	record.Status = "alive"
	return r.db.SaveInstanceRecord(record)
}

// ListAliveInstances sweeps stale records before returning alive instances.
func (r *Registry) ListAliveInstances(cutoff int64) ([]*database.InstanceRecord, error) {
	if _, err := r.MarkStaleInstances(cutoff); err != nil {
		return nil, err
	}

	records, err := r.db.ListInstanceRecords()
	if err != nil {
		return nil, err
	}

	alive := make([]*database.InstanceRecord, 0, len(records))
	for _, record := range records {
		if record.Status == "alive" {
			alive = append(alive, record)
		}
	}
	return alive, nil
}

// MarkStaleInstances marks outdated alive instances as stale.
func (r *Registry) MarkStaleInstances(cutoff int64) (int64, error) {
	return r.db.MarkInstanceStaleBefore(cutoff)
}
