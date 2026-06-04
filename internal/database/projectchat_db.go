package database

import (
	"database/sql"
	"time"
)

func (d *Database) CreateProjectChat(chat *ProjectChat) error {
	now := time.Now().Unix()
	if chat.CreatedAt == 0 {
		chat.CreatedAt = now
	}
	chat.UpdatedAt = now
	_, err := d.db.Exec(`
		INSERT INTO project_chats (id, project_path, title, active_provider, active_segment_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		chat.ID, chat.ProjectPath, chat.Title, chat.ActiveProvider, chat.ActiveSegmentID, chat.CreatedAt, chat.UpdatedAt)
	return err
}

func (d *Database) GetProjectChat(id string) (*ProjectChat, error) {
	row := d.db.QueryRow(`SELECT id, project_path, title, active_provider, active_segment_id, created_at, updated_at FROM project_chats WHERE id = ?`, id)
	return scanProjectChat(row)
}

func (d *Database) GetActiveChatForProject(projectPath string) (*ProjectChat, error) {
	row := d.db.QueryRow(`SELECT id, project_path, title, active_provider, active_segment_id, created_at, updated_at FROM project_chats WHERE project_path = ? ORDER BY updated_at DESC LIMIT 1`, projectPath)
	return scanProjectChat(row)
}

func (d *Database) ListProjectChats(projectPath string) ([]*ProjectChat, error) {
	rows, err := d.db.Query(`SELECT id, project_path, title, active_provider, active_segment_id, created_at, updated_at FROM project_chats WHERE project_path = ? ORDER BY updated_at DESC`, projectPath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var chats []*ProjectChat
	for rows.Next() {
		chat, err := scanProjectChatRow(rows)
		if err != nil {
			return nil, err
		}
		chats = append(chats, chat)
	}
	return chats, rows.Err()
}

func (d *Database) UpdateProjectChatActive(id, provider, segmentID string) error {
	now := time.Now().Unix()
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if segmentID != "" {
		if _, err := tx.Exec(
			`UPDATE chat_segments SET status = ?, completed_at = COALESCE(completed_at, ?) WHERE project_chat_id = ? AND id != ? AND status = ?`,
			SegmentStatusInterrupted, now, id, segmentID, SegmentStatusActive,
		); err != nil {
			return err
		}
		if _, err := tx.Exec(
			`UPDATE chat_segments SET status = ?, completed_at = NULL WHERE project_chat_id = ? AND id = ?`,
			SegmentStatusActive, id, segmentID,
		); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(`UPDATE project_chats SET active_provider = ?, active_segment_id = ?, updated_at = ? WHERE id = ?`,
		provider, segmentID, now, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (d *Database) UpdateProjectChatTitle(id, title string) error {
	_, err := d.db.Exec(`UPDATE project_chats SET title = ?, updated_at = ? WHERE id = ?`,
		title, time.Now().Unix(), id)
	return err
}

func (d *Database) DeleteProjectChat(id string) error {
	_, err := d.db.Exec(`DELETE FROM chat_segments WHERE project_chat_id = ?`, id)
	if err != nil {
		return err
	}
	_, err = d.db.Exec(`DELETE FROM project_chats WHERE id = ?`, id)
	return err
}

// --- ChatSegment CRUD ---

func (d *Database) CreateChatSegment(seg *ChatSegment) error {
	now := time.Now().Unix()
	if seg.CreatedAt == 0 {
		seg.CreatedAt = now
	}
	contextInjected := 0
	if seg.ContextInjected {
		contextInjected = 1
	}
	_, err := d.db.Exec(`
		INSERT INTO chat_segments (id, project_chat_id, provider, model, runtime_session_id, provider_session_id, seq, status, context_injected, created_at, completed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		seg.ID, seg.ProjectChatID, seg.Provider, seg.Model, seg.RuntimeSessionID, seg.ProviderSessionID,
		seg.Seq, seg.Status, contextInjected, seg.CreatedAt, seg.CompletedAt)
	return err
}

func (d *Database) GetChatSegment(id string) (*ChatSegment, error) {
	row := d.db.QueryRow(`SELECT id, project_chat_id, provider, model, runtime_session_id, provider_session_id, seq, status, context_injected, created_at, completed_at FROM chat_segments WHERE id = ?`, id)
	return scanChatSegment(row)
}

func (d *Database) ListChatSegments(chatID string) ([]*ChatSegment, error) {
	rows, err := d.db.Query(`SELECT id, project_chat_id, provider, model, runtime_session_id, provider_session_id, seq, status, context_injected, created_at, completed_at FROM chat_segments WHERE project_chat_id = ? ORDER BY seq ASC`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var segments []*ChatSegment
	for rows.Next() {
		seg, err := scanChatSegmentRow(rows)
		if err != nil {
			return nil, err
		}
		segments = append(segments, seg)
	}
	return segments, rows.Err()
}

func (d *Database) GetActiveSegment(chatID string) (*ChatSegment, error) {
	row := d.db.QueryRow(`SELECT id, project_chat_id, provider, model, runtime_session_id, provider_session_id, seq, status, context_injected, created_at, completed_at FROM chat_segments WHERE project_chat_id = ? AND status = ? ORDER BY seq DESC LIMIT 1`, chatID, SegmentStatusActive)
	return scanChatSegment(row)
}

func (d *Database) FindChatSegmentByProviderSession(projectPath, provider, providerSessionID string) (*ProjectChat, *ChatSegment, error) {
	row := d.db.QueryRow(`
		SELECT
			c.id, c.project_path, c.title, c.active_provider, c.active_segment_id, c.created_at, c.updated_at,
			s.id, s.project_chat_id, s.provider, s.model, s.runtime_session_id, s.provider_session_id, s.seq, s.status, s.context_injected, s.created_at, s.completed_at
		FROM chat_segments s
		JOIN project_chats c ON c.id = s.project_chat_id
		WHERE c.project_path = ? AND s.provider = ? AND s.provider_session_id = ?
		ORDER BY c.updated_at DESC, s.seq DESC
		LIMIT 1`, projectPath, provider, providerSessionID)

	c := &ProjectChat{}
	s := &ChatSegment{}
	var title, activeSegmentID sql.NullString
	var model, runtimeSID, providerSID sql.NullString
	var contextInjected int
	var completedAt sql.NullInt64
	if err := row.Scan(
		&c.ID, &c.ProjectPath, &title, &c.ActiveProvider, &activeSegmentID, &c.CreatedAt, &c.UpdatedAt,
		&s.ID, &s.ProjectChatID, &s.Provider, &model, &runtimeSID, &providerSID, &s.Seq, &s.Status, &contextInjected, &s.CreatedAt, &completedAt,
	); err != nil {
		return nil, nil, err
	}
	c.Title = title.String
	c.ActiveSegmentID = activeSegmentID.String
	s.Model = model.String
	s.RuntimeSessionID = runtimeSID.String
	s.ProviderSessionID = providerSID.String
	s.ContextInjected = contextInjected != 0
	if completedAt.Valid {
		s.CompletedAt = &completedAt.Int64
	}
	return c, s, nil
}

func (d *Database) UpdateChatSegmentStatus(id, status string, completedAt *int64) error {
	_, err := d.db.Exec(`UPDATE chat_segments SET status = ?, completed_at = ? WHERE id = ?`, status, completedAt, id)
	return err
}

func (d *Database) UpdateChatSegmentRuntime(id, runtimeSessionID, providerSessionID string) error {
	_, err := d.db.Exec(`UPDATE chat_segments SET runtime_session_id = ?, provider_session_id = ? WHERE id = ?`, runtimeSessionID, providerSessionID, id)
	return err
}

func (d *Database) UpdateChatSegmentContextDelivered(id string) error {
	_, err := d.db.Exec(`UPDATE chat_segments SET context_injected = 0 WHERE id = ?`, id)
	return err
}

// --- Scan helpers ---

func scanProjectChat(row *sql.Row) (*ProjectChat, error) {
	c := &ProjectChat{}
	var title, activeSegmentID sql.NullString
	err := row.Scan(&c.ID, &c.ProjectPath, &title, &c.ActiveProvider, &activeSegmentID, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	c.Title = title.String
	c.ActiveSegmentID = activeSegmentID.String
	return c, nil
}

func scanProjectChatRow(rows *sql.Rows) (*ProjectChat, error) {
	c := &ProjectChat{}
	var title, activeSegmentID sql.NullString
	err := rows.Scan(&c.ID, &c.ProjectPath, &title, &c.ActiveProvider, &activeSegmentID, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	c.Title = title.String
	c.ActiveSegmentID = activeSegmentID.String
	return c, nil
}

func scanChatSegment(row *sql.Row) (*ChatSegment, error) {
	s := &ChatSegment{}
	var contextInjected int
	var completedAt sql.NullInt64
	var model, runtimeSID, providerSID sql.NullString
	err := row.Scan(&s.ID, &s.ProjectChatID, &s.Provider, &model, &runtimeSID, &providerSID, &s.Seq, &s.Status, &contextInjected, &s.CreatedAt, &completedAt)
	if err != nil {
		return nil, err
	}
	s.Model = model.String
	s.RuntimeSessionID = runtimeSID.String
	s.ProviderSessionID = providerSID.String
	s.ContextInjected = contextInjected != 0
	if completedAt.Valid {
		s.CompletedAt = &completedAt.Int64
	}
	return s, nil
}

func scanChatSegmentRow(rows *sql.Rows) (*ChatSegment, error) {
	s := &ChatSegment{}
	var contextInjected int
	var completedAt sql.NullInt64
	var model, runtimeSID, providerSID sql.NullString
	err := rows.Scan(&s.ID, &s.ProjectChatID, &s.Provider, &model, &runtimeSID, &providerSID, &s.Seq, &s.Status, &contextInjected, &s.CreatedAt, &completedAt)
	if err != nil {
		return nil, err
	}
	s.Model = model.String
	s.RuntimeSessionID = runtimeSID.String
	s.ProviderSessionID = providerSID.String
	s.ContextInjected = contextInjected != 0
	if completedAt.Valid {
		s.CompletedAt = &completedAt.Int64
	}
	return s, nil
}
