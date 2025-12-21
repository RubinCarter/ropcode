// internal/database/db.go
package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Database wraps the SQLite database connection
type Database struct {
	db *sql.DB
}

// Open creates or opens a SQLite database at the given path
func Open(path string) (*Database, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}

	d := &Database{db: db}
	if err := d.init(); err != nil {
		db.Close()
		return nil, err
	}

	return d, nil
}

// init creates the database schema
func (d *Database) init() error {
	schema := `
	CREATE TABLE IF NOT EXISTS provider_api_configs (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		provider_id TEXT NOT NULL,
		base_url TEXT,
		auth_token TEXT,
		is_default INTEGER DEFAULT 0,
		is_builtin INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS project_indexes (
		name TEXT PRIMARY KEY,
		data TEXT NOT NULL,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_provider_api_configs_provider ON provider_api_configs(provider_id);
	CREATE INDEX IF NOT EXISTS idx_provider_api_configs_default ON provider_api_configs(is_default);

	CREATE TABLE IF NOT EXISTS agents (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		icon TEXT NOT NULL DEFAULT '🤖',
		system_prompt TEXT NOT NULL,
		default_task TEXT,
		model TEXT NOT NULL DEFAULT 'sonnet',
		provider_api_id TEXT,
		hooks TEXT,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS agent_runs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		agent_id INTEGER NOT NULL,
		agent_name TEXT NOT NULL,
		agent_icon TEXT NOT NULL,
		task TEXT NOT NULL,
		model TEXT NOT NULL,
		project_path TEXT NOT NULL,
		session_id TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		pid INTEGER,
		process_started_at INTEGER,
		created_at INTEGER NOT NULL,
		completed_at INTEGER,
		FOREIGN KEY (agent_id) REFERENCES agents(id)
	);
	`

	_, err := d.db.Exec(schema)
	return err
}

// Close closes the database connection
func (d *Database) Close() error {
	return d.db.Close()
}

// SaveProviderApiConfig saves or updates a provider API config
func (d *Database) SaveProviderApiConfig(config *ProviderApiConfig) error {
	now := time.Now()
	config.UpdatedAt = now
	if config.CreatedAt.IsZero() {
		config.CreatedAt = now
	}

	_, err := d.db.Exec(`
		INSERT OR REPLACE INTO provider_api_configs
		(id, name, provider_id, base_url, auth_token, is_default, is_builtin, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		config.ID, config.Name, config.ProviderID, config.BaseURL, config.AuthToken,
		config.IsDefault, config.IsBuiltin, config.CreatedAt, config.UpdatedAt)
	return err
}

// ClearDefaultProviderApiConfig clears the is_default flag for all configs of a given provider
func (d *Database) ClearDefaultProviderApiConfig(providerID string) error {
	_, err := d.db.Exec(`UPDATE provider_api_configs SET is_default = 0 WHERE provider_id = ?`, providerID)
	return err
}

// GetProviderApiConfig retrieves a provider API config by ID
func (d *Database) GetProviderApiConfig(id string) (*ProviderApiConfig, error) {
	row := d.db.QueryRow(`
		SELECT id, name, provider_id, base_url, auth_token, is_default, is_builtin, created_at, updated_at
		FROM provider_api_configs WHERE id = ?`, id)

	config := &ProviderApiConfig{}
	err := row.Scan(&config.ID, &config.Name, &config.ProviderID, &config.BaseURL, &config.AuthToken,
		&config.IsDefault, &config.IsBuiltin, &config.CreatedAt, &config.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return config, nil
}

// GetAllProviderApiConfigs retrieves all provider API configs
func (d *Database) GetAllProviderApiConfigs() ([]*ProviderApiConfig, error) {
	rows, err := d.db.Query(`
		SELECT id, name, provider_id, base_url, auth_token, is_default, is_builtin, created_at, updated_at
		FROM provider_api_configs ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var configs []*ProviderApiConfig
	for rows.Next() {
		config := &ProviderApiConfig{}
		err := rows.Scan(&config.ID, &config.Name, &config.ProviderID, &config.BaseURL, &config.AuthToken,
			&config.IsDefault, &config.IsBuiltin, &config.CreatedAt, &config.UpdatedAt)
		if err != nil {
			return nil, err
		}
		configs = append(configs, config)
	}
	return configs, rows.Err()
}

// DeleteProviderApiConfig deletes a provider API config by ID
func (d *Database) DeleteProviderApiConfig(id string) error {
	_, err := d.db.Exec("DELETE FROM provider_api_configs WHERE id = ?", id)
	return err
}

// GetDefaultProviderApiConfig retrieves the default config for a provider
func (d *Database) GetDefaultProviderApiConfig(providerID string) (*ProviderApiConfig, error) {
	row := d.db.QueryRow(`
		SELECT id, name, provider_id, base_url, auth_token, is_default, is_builtin, created_at, updated_at
		FROM provider_api_configs WHERE provider_id = ? AND is_default = 1`, providerID)

	config := &ProviderApiConfig{}
	err := row.Scan(&config.ID, &config.Name, &config.ProviderID, &config.BaseURL, &config.AuthToken,
		&config.IsDefault, &config.IsBuiltin, &config.CreatedAt, &config.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return config, nil
}

// SaveSetting saves or updates a setting
func (d *Database) SaveSetting(key, value string) error {
	_, err := d.db.Exec(`
		INSERT OR REPLACE INTO settings (key, value, updated_at)
		VALUES (?, ?, ?)`, key, value, time.Now())
	return err
}

// GetSetting retrieves a setting by key
func (d *Database) GetSetting(key string) (string, error) {
	var value string
	err := d.db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&value)
	return value, err
}

// SaveProjectIndex saves a project index
func (d *Database) SaveProjectIndex(project *ProjectIndex) error {
	data, err := json.Marshal(project)
	if err != nil {
		return err
	}
	_, err = d.db.Exec(`
		INSERT OR REPLACE INTO project_indexes (name, data, updated_at)
		VALUES (?, ?, ?)`, project.Name, string(data), time.Now())
	return err
}

// GetProjectIndex retrieves a project index by name
func (d *Database) GetProjectIndex(name string) (*ProjectIndex, error) {
	var data string
	err := d.db.QueryRow("SELECT data FROM project_indexes WHERE name = ?", name).Scan(&data)
	if err != nil {
		return nil, err
	}

	project := &ProjectIndex{}
	if err := json.Unmarshal([]byte(data), project); err != nil {
		return nil, err
	}
	return project, nil
}

// GetAllProjectIndexes retrieves all project indexes
func (d *Database) GetAllProjectIndexes() ([]*ProjectIndex, error) {
	rows, err := d.db.Query("SELECT data FROM project_indexes ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []*ProjectIndex
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		project := &ProjectIndex{}
		if err := json.Unmarshal([]byte(data), project); err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

// DeleteProjectIndex deletes a project index by name
func (d *Database) DeleteProjectIndex(name string) error {
	_, err := d.db.Exec("DELETE FROM project_indexes WHERE name = ?", name)
	return err
}

// ListAgents retrieves all agents from the database
func (d *Database) ListAgents() ([]*Agent, error) {
	rows, err := d.db.Query(`
		SELECT id, name, icon, system_prompt, default_task, model, provider_api_id, hooks, created_at, updated_at
		FROM agents ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var agents []*Agent
	for rows.Next() {
		agent := &Agent{}
		var createdAt, updatedAt int64
		err := rows.Scan(&agent.ID, &agent.Name, &agent.Icon, &agent.SystemPrompt,
			&agent.DefaultTask, &agent.Model, &agent.ProviderApiID, &agent.Hooks,
			&createdAt, &updatedAt)
		if err != nil {
			return nil, err
		}
		agent.CreatedAt = time.Unix(createdAt, 0)
		agent.UpdatedAt = time.Unix(updatedAt, 0)
		agents = append(agents, agent)
	}
	return agents, rows.Err()
}

// GetAgent retrieves an agent by ID
func (d *Database) GetAgent(id int64) (*Agent, error) {
	row := d.db.QueryRow(`
		SELECT id, name, icon, system_prompt, default_task, model, provider_api_id, hooks, created_at, updated_at
		FROM agents WHERE id = ?`, id)

	agent := &Agent{}
	var createdAt, updatedAt int64
	err := row.Scan(&agent.ID, &agent.Name, &agent.Icon, &agent.SystemPrompt,
		&agent.DefaultTask, &agent.Model, &agent.ProviderApiID, &agent.Hooks,
		&createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	agent.CreatedAt = time.Unix(createdAt, 0)
	agent.UpdatedAt = time.Unix(updatedAt, 0)
	return agent, nil
}

// CreateAgent creates a new agent in the database
func (d *Database) CreateAgent(agent *Agent) (int64, error) {
	now := time.Now()
	agent.CreatedAt = now
	agent.UpdatedAt = now

	result, err := d.db.Exec(`
		INSERT INTO agents (name, icon, system_prompt, default_task, model, provider_api_id, hooks, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		agent.Name, agent.Icon, agent.SystemPrompt, agent.DefaultTask, agent.Model,
		agent.ProviderApiID, agent.Hooks, agent.CreatedAt.Unix(), agent.UpdatedAt.Unix())
	if err != nil {
		return 0, err
	}

	id, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	agent.ID = id
	return id, nil
}

// UpdateAgent updates an existing agent in the database
func (d *Database) UpdateAgent(agent *Agent) error {
	agent.UpdatedAt = time.Now()

	_, err := d.db.Exec(`
		UPDATE agents SET name = ?, icon = ?, system_prompt = ?, default_task = ?,
		model = ?, provider_api_id = ?, hooks = ?, updated_at = ?
		WHERE id = ?`,
		agent.Name, agent.Icon, agent.SystemPrompt, agent.DefaultTask, agent.Model,
		agent.ProviderApiID, agent.Hooks, agent.UpdatedAt.Unix(), agent.ID)
	return err
}

// DeleteAgent deletes an agent by ID
func (d *Database) DeleteAgent(id int64) error {
	_, err := d.db.Exec("DELETE FROM agents WHERE id = ?", id)
	return err
}

// AgentExport represents the export format for an agent
type AgentExport struct {
	Version    int       `json:"version"`
	ExportedAt time.Time `json:"exported_at"`
	Agent      struct {
		Name         string `json:"name"`
		Icon         string `json:"icon"`
		SystemPrompt string `json:"system_prompt"`
		DefaultTask  string `json:"default_task,omitempty"`
		Model        string `json:"model"`
		Hooks        string `json:"hooks,omitempty"`
	} `json:"agent"`
}

// ExportAgent exports an agent as JSON string
func (d *Database) ExportAgent(id int64) (string, error) {
	agent, err := d.GetAgent(id)
	if err != nil {
		return "", err
	}

	export := AgentExport{
		Version:    1,
		ExportedAt: time.Now(),
	}
	export.Agent.Name = agent.Name
	export.Agent.Icon = agent.Icon
	export.Agent.SystemPrompt = agent.SystemPrompt
	export.Agent.DefaultTask = agent.DefaultTask
	export.Agent.Model = agent.Model
	export.Agent.Hooks = agent.Hooks

	data, err := json.MarshalIndent(export, "", "  ")
	if err != nil {
		return "", err
	}

	return string(data), nil
}

// ExportAgentToFile exports an agent to a file
func (d *Database) ExportAgentToFile(id int64, path string) error {
	data, err := d.ExportAgent(id)
	if err != nil {
		return err
	}

	return writeFile(path, []byte(data))
}

// ImportAgent imports an agent from JSON string
func (d *Database) ImportAgent(data string) (*Agent, error) {
	var export AgentExport
	if err := json.Unmarshal([]byte(data), &export); err != nil {
		return nil, err
	}

	agent := &Agent{
		Name:         export.Agent.Name,
		Icon:         export.Agent.Icon,
		SystemPrompt: export.Agent.SystemPrompt,
		DefaultTask:  export.Agent.DefaultTask,
		Model:        export.Agent.Model,
		Hooks:        export.Agent.Hooks,
	}

	id, err := d.CreateAgent(agent)
	if err != nil {
		return nil, err
	}
	agent.ID = id

	return agent, nil
}

// ImportAgentFromFile imports an agent from a file
func (d *Database) ImportAgentFromFile(path string) (*Agent, error) {
	data, err := readFile(path)
	if err != nil {
		return nil, err
	}

	return d.ImportAgent(string(data))
}

// ===== AgentRun CRUD =====

// CreateAgentRun creates a new agent run record
func (d *Database) CreateAgentRun(run *AgentRun) (int64, error) {
	now := time.Now()
	run.CreatedAt = now

	result, err := d.db.Exec(`
		INSERT INTO agent_runs (agent_id, agent_name, agent_icon, task, model, project_path, session_id, status, pid, process_started_at, created_at, completed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		run.AgentID, run.AgentName, run.AgentIcon, run.Task, run.Model, run.ProjectPath,
		run.SessionID, run.Status, run.PID, nullableTime(run.ProcessStartedAt),
		run.CreatedAt.Unix(), nullableTime(run.CompletedAt))
	if err != nil {
		return 0, err
	}

	id, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	run.ID = id
	return id, nil
}

// GetAgentRun retrieves an agent run by ID
func (d *Database) GetAgentRun(id int64) (*AgentRun, error) {
	row := d.db.QueryRow(`
		SELECT id, agent_id, agent_name, agent_icon, task, model, project_path, session_id, status, pid, process_started_at, created_at, completed_at
		FROM agent_runs WHERE id = ?`, id)

	return scanAgentRun(row)
}

// GetAgentRunBySessionID retrieves an agent run by session ID
func (d *Database) GetAgentRunBySessionID(sessionID string) (*AgentRun, error) {
	row := d.db.QueryRow(`
		SELECT id, agent_id, agent_name, agent_icon, task, model, project_path, session_id, status, pid, process_started_at, created_at, completed_at
		FROM agent_runs WHERE session_id = ?`, sessionID)

	return scanAgentRun(row)
}

// ListAgentRuns retrieves all agent runs, optionally filtered by agent ID
func (d *Database) ListAgentRuns(agentID *int64, limit int) ([]*AgentRun, error) {
	var query string
	var args []interface{}

	if agentID != nil {
		query = `SELECT id, agent_id, agent_name, agent_icon, task, model, project_path, session_id, status, pid, process_started_at, created_at, completed_at
			FROM agent_runs WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`
		args = []interface{}{*agentID, limit}
	} else {
		query = `SELECT id, agent_id, agent_name, agent_icon, task, model, project_path, session_id, status, pid, process_started_at, created_at, completed_at
			FROM agent_runs ORDER BY created_at DESC LIMIT ?`
		args = []interface{}{limit}
	}

	rows, err := d.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var runs []*AgentRun
	for rows.Next() {
		run, err := scanAgentRunRow(rows)
		if err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

// ListRunningAgentRuns retrieves all currently running agent runs
func (d *Database) ListRunningAgentRuns() ([]*AgentRun, error) {
	rows, err := d.db.Query(`
		SELECT id, agent_id, agent_name, agent_icon, task, model, project_path, session_id, status, pid, process_started_at, created_at, completed_at
		FROM agent_runs WHERE status = 'running' ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var runs []*AgentRun
	for rows.Next() {
		run, err := scanAgentRunRow(rows)
		if err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

// UpdateAgentRunStatus updates the status of an agent run
func (d *Database) UpdateAgentRunStatus(id int64, status string, pid int, processStartedAt, completedAt *time.Time) error {
	_, err := d.db.Exec(`
		UPDATE agent_runs SET status = ?, pid = ?, process_started_at = ?, completed_at = ?
		WHERE id = ?`,
		status, pid, nullableTime(processStartedAt), nullableTime(completedAt), id)
	return err
}

// DeleteAgentRun deletes an agent run by ID
func (d *Database) DeleteAgentRun(id int64) error {
	_, err := d.db.Exec("DELETE FROM agent_runs WHERE id = ?", id)
	return err
}

// DeleteAgentRunsByAgentID deletes all runs for an agent
func (d *Database) DeleteAgentRunsByAgentID(agentID int64) error {
	_, err := d.db.Exec("DELETE FROM agent_runs WHERE agent_id = ?", agentID)
	return err
}

// Helper functions

func nullableTime(t *time.Time) interface{} {
	if t == nil {
		return nil
	}
	return t.Unix()
}

func scanAgentRun(row *sql.Row) (*AgentRun, error) {
	run := &AgentRun{}
	var createdAt int64
	var processStartedAt, completedAt sql.NullInt64
	var pid sql.NullInt64

	err := row.Scan(&run.ID, &run.AgentID, &run.AgentName, &run.AgentIcon, &run.Task,
		&run.Model, &run.ProjectPath, &run.SessionID, &run.Status, &pid,
		&processStartedAt, &createdAt, &completedAt)
	if err != nil {
		return nil, err
	}

	run.CreatedAt = time.Unix(createdAt, 0)
	if pid.Valid {
		run.PID = int(pid.Int64)
	}
	if processStartedAt.Valid {
		t := time.Unix(processStartedAt.Int64, 0)
		run.ProcessStartedAt = &t
	}
	if completedAt.Valid {
		t := time.Unix(completedAt.Int64, 0)
		run.CompletedAt = &t
	}

	return run, nil
}

func scanAgentRunRow(rows *sql.Rows) (*AgentRun, error) {
	run := &AgentRun{}
	var createdAt int64
	var processStartedAt, completedAt sql.NullInt64
	var pid sql.NullInt64

	err := rows.Scan(&run.ID, &run.AgentID, &run.AgentName, &run.AgentIcon, &run.Task,
		&run.Model, &run.ProjectPath, &run.SessionID, &run.Status, &pid,
		&processStartedAt, &createdAt, &completedAt)
	if err != nil {
		return nil, err
	}

	run.CreatedAt = time.Unix(createdAt, 0)
	if pid.Valid {
		run.PID = int(pid.Int64)
	}
	if processStartedAt.Valid {
		t := time.Unix(processStartedAt.Int64, 0)
		run.ProcessStartedAt = &t
	}
	if completedAt.Valid {
		t := time.Unix(completedAt.Int64, 0)
		run.CompletedAt = &t
	}

	return run, nil
}

// ===== Storage Operations =====

// ListTables returns all table names in the database
func (d *Database) ListTables() ([]string, error) {
	rows, err := d.db.Query(`
		SELECT name FROM sqlite_master
		WHERE type='table' AND name NOT LIKE 'sqlite_%'
		ORDER BY name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tables = append(tables, name)
	}
	return tables, rows.Err()
}

// TableData represents paginated table data
type TableData struct {
	Data     []map[string]interface{} `json:"data"`
	Total    int                      `json:"total"`
	Page     int                      `json:"page"`
	PageSize int                      `json:"page_size"`
}

// ReadTable reads table data with pagination
func (d *Database) ReadTable(table string, page, pageSize int) (*TableData, error) {
	// Validate table name exists
	var exists bool
	err := d.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM sqlite_master
			WHERE type='table' AND name = ?
		)
	`, table).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, sql.ErrNoRows
	}

	// Get total count
	var total int
	err = d.db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&total)
	if err != nil {
		return nil, err
	}

	// Calculate offset
	offset := (page - 1) * pageSize

	// Query data with pagination
	rows, err := d.db.Query("SELECT * FROM "+table+" LIMIT ? OFFSET ?", pageSize, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Get column names
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	// Read rows
	var data []map[string]interface{}
	for rows.Next() {
		// Create a slice of interface{} to hold each column value
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range columns {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, err
		}

		// Create a map for this row
		rowMap := make(map[string]interface{})
		for i, col := range columns {
			var v interface{}
			val := values[i]
			b, ok := val.([]byte)
			if ok {
				v = string(b)
			} else {
				v = val
			}
			rowMap[col] = v
		}
		data = append(data, rowMap)
	}

	return &TableData{
		Data:     data,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, rows.Err()
}

// InsertRow inserts a new row into the specified table
func (d *Database) InsertRow(table string, data map[string]interface{}) (int64, error) {
	// Validate table name exists
	var exists bool
	err := d.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM sqlite_master
			WHERE type='table' AND name = ?
		)
	`, table).Scan(&exists)
	if err != nil {
		return 0, err
	}
	if !exists {
		return 0, sql.ErrNoRows
	}

	// Build INSERT query
	var columns []string
	var placeholders []string
	var values []interface{}

	for col, val := range data {
		columns = append(columns, col)
		placeholders = append(placeholders, "?")
		values = append(values, val)
	}

	query := "INSERT INTO " + table + " (" +
		join(columns, ", ") + ") VALUES (" +
		join(placeholders, ", ") + ")"

	result, err := d.db.Exec(query, values...)
	if err != nil {
		return 0, err
	}

	return result.LastInsertId()
}

// UpdateRow updates a row in the specified table by ID
func (d *Database) UpdateRow(table string, id int64, data map[string]interface{}) error {
	// Validate table name exists
	var exists bool
	err := d.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM sqlite_master
			WHERE type='table' AND name = ?
		)
	`, table).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return sql.ErrNoRows
	}

	// Build UPDATE query
	var setClauses []string
	var values []interface{}

	for col, val := range data {
		setClauses = append(setClauses, col+" = ?")
		values = append(values, val)
	}
	values = append(values, id)

	query := "UPDATE " + table + " SET " + join(setClauses, ", ") + " WHERE id = ?"

	_, err = d.db.Exec(query, values...)
	return err
}

// DeleteRow deletes a row from the specified table by ID
func (d *Database) DeleteRow(table string, id int64) error {
	// Validate table name exists
	var exists bool
	err := d.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM sqlite_master
			WHERE type='table' AND name = ?
		)
	`, table).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return sql.ErrNoRows
	}

	_, err = d.db.Exec("DELETE FROM "+table+" WHERE id = ?", id)
	return err
}

// ExecuteSQL executes a read-only SQL query (SELECT only)
func (d *Database) ExecuteSQL(query string) (*TableData, error) {
	// Basic validation - only allow SELECT statements
	trimmed := strings.TrimSpace(strings.ToUpper(query))
	if !strings.HasPrefix(trimmed, "SELECT") {
		return nil, fmt.Errorf("only SELECT queries are allowed")
	}

	rows, err := d.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Get column names
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	// Read rows
	var data []map[string]interface{}
	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range columns {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, err
		}

		rowMap := make(map[string]interface{})
		for i, col := range columns {
			var v interface{}
			val := values[i]
			b, ok := val.([]byte)
			if ok {
				v = string(b)
			} else {
				v = val
			}
			rowMap[col] = v
		}
		data = append(data, rowMap)
	}

	return &TableData{
		Data:     data,
		Total:    len(data),
		Page:     1,
		PageSize: len(data),
	}, rows.Err()
}

// ResetDatabase drops all tables and reinitializes the schema
func (d *Database) ResetDatabase() error {
	// Get all table names
	tables, err := d.ListTables()
	if err != nil {
		return err
	}

	// Drop all tables
	for _, table := range tables {
		_, err = d.db.Exec("DROP TABLE IF EXISTS " + table)
		if err != nil {
			return err
		}
	}

	// Reinitialize schema
	return d.init()
}

// Helper function to join strings
func join(strs []string, sep string) string {
	result := ""
	for i, str := range strs {
		if i > 0 {
			result += sep
		}
		result += str
	}
	return result
}

// Helper functions for file I/O

func readFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}

func writeFile(path string, data []byte) error {
	return os.WriteFile(path, data, 0644)
}
