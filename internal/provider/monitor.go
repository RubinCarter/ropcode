package provider

import (
	"context"
	"sync"
	"time"
)

// MonitorConfig 监控配置。
type MonitorConfig struct {
	CheckInterval  time.Duration
	SlowThreshold  time.Duration
	StuckThreshold time.Duration
	HangThreshold  time.Duration
}

// DefaultMonitorConfig 返回默认监控配置。
func DefaultMonitorConfig() MonitorConfig {
	return MonitorConfig{
		CheckInterval:  5 * time.Second,
		SlowThreshold:  30 * time.Second,
		StuckThreshold: 120 * time.Second,
		HangThreshold:  300 * time.Second,
	}
}

type monitoredSession struct {
	lastOutput time.Time
	health     ProcessHealth
}

// Monitor 负责所有 provider 进程的健康监控。
type Monitor struct {
	sessions map[string]*monitoredSession
	mu       sync.RWMutex
	config   MonitorConfig
	onChange func(sessionID string, health ProcessHealth)
	ctx      context.Context
	cancel   context.CancelFunc
}

// NewMonitor 创建监控实例并启动后台扫描。
func NewMonitor(ctx context.Context, config MonitorConfig, onChange func(string, ProcessHealth)) *Monitor {
	mctx, cancel := context.WithCancel(ctx)
	m := &Monitor{
		sessions: make(map[string]*monitoredSession),
		config:   config,
		onChange: onChange,
		ctx:      mctx,
		cancel:   cancel,
	}
	go m.loop()
	return m
}

// Register 注册一个会话到监控。
func (m *Monitor) Register(sessionID string) {
	m.mu.Lock()
	m.sessions[sessionID] = &monitoredSession{
		lastOutput: time.Now(),
		health:     HealthOK,
	}
	m.mu.Unlock()
}

// Unregister 从监控中移除会话。
func (m *Monitor) Unregister(sessionID string) {
	m.mu.Lock()
	delete(m.sessions, sessionID)
	m.mu.Unlock()
}

// RecordOutput 记录会话收到输出的时间。
func (m *Monitor) RecordOutput(sessionID string) {
	m.mu.Lock()
	if s, ok := m.sessions[sessionID]; ok {
		s.lastOutput = time.Now()
		if s.health != HealthOK {
			s.health = HealthOK
			m.mu.Unlock()
			if m.onChange != nil {
				m.onChange(sessionID, HealthOK)
			}
			return
		}
	}
	m.mu.Unlock()
}

// Stop 停止监控。
func (m *Monitor) Stop() {
	m.cancel()
}

func (m *Monitor) loop() {
	ticker := time.NewTicker(m.config.CheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-m.ctx.Done():
			return
		case <-ticker.C:
			m.check()
		}
	}
}

func (m *Monitor) check() {
	now := time.Now()
	m.mu.Lock()
	var changes []struct {
		id     string
		health ProcessHealth
	}

	for id, s := range m.sessions {
		elapsed := now.Sub(s.lastOutput)
		var newHealth ProcessHealth

		switch {
		case elapsed >= m.config.HangThreshold:
			newHealth = HealthHanging
		case elapsed >= m.config.StuckThreshold:
			newHealth = HealthStuck
		case elapsed >= m.config.SlowThreshold:
			newHealth = HealthSlow
		default:
			newHealth = HealthOK
		}

		if newHealth != s.health {
			s.health = newHealth
			changes = append(changes, struct {
				id     string
				health ProcessHealth
			}{id, newHealth})
		}
	}
	m.mu.Unlock()

	for _, c := range changes {
		if m.onChange != nil {
			m.onChange(c.id, c.health)
		}
	}
}
