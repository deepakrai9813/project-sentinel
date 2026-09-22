package telemetry

import (
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"sentinel/internal/circuitbreaker"
)

// RequestEvent logs an individual routed request for the live feed.
type RequestEvent struct {
	Timestamp time.Time `json:"timestamp"`
	Route     string    `json:"route"` // "primary" or "secondary"
	Status    int       `json:"status"`
	DurationMs float64   `json:"duration_ms"`
	Success   bool      `json:"success"`
	Reason    string    `json:"reason,omitempty"`
}

// MemoryMetrics tracks Go runtime footprint to prove 128MB constraint compliance.
type MemoryMetrics struct {
	AllocMB      float64 `json:"alloc_mb"`
	TotalAllocMB float64 `json:"total_alloc_mb"`
	SysMB        float64 `json:"sys_mb"`
	NumGoroutine int     `json:"num_goroutine"`
	NumGC        uint32  `json:"num_gc"`
}

// SystemMetrics is the complete telemetry payload broadcast to the frontend.
type SystemMetrics struct {
	Timestamp          time.Time                `json:"timestamp"`
	RPS                int64                    `json:"rps"`
	TotalRequests      uint64                   `json:"total_requests"`
	PrimaryRequests    uint64                   `json:"primary_requests"`
	SecondaryRequests  uint64                   `json:"secondary_requests"`
	CircuitState       circuitbreaker.State     `json:"circuit_state"`
	CircuitSnapshot    circuitbreaker.Snapshot  `json:"circuit_snapshot"`
	AvgLatencyMs       float64                  `json:"avg_latency_ms"`
	PrimarySuccessRate float64                  `json:"primary_success_rate"`
	Memory             MemoryMetrics            `json:"memory"`
	RecentEvents       []RequestEvent           `json:"recent_events"`
}

// MetricsCollector accumulates thread-safe statistics.
type MetricsCollector struct {
	cb *circuitbreaker.CircuitBreaker

	// Atomic counters for high performance
	totalRequests     uint64
	primaryRequests   uint64
	secondaryRequests uint64
	primarySuccesses  uint64
	primaryFailures   uint64

	// Sliding window for RPS
	rpsCounter int64
	currentRPS int64

	mu           sync.RWMutex
	recentEvents []RequestEvent
	maxEvents    int
	totalLatency time.Duration
	latencyCount uint64
}

// NewMetricsCollector constructs a collector.
func NewMetricsCollector(cb *circuitbreaker.CircuitBreaker) *MetricsCollector {
	mc := &MetricsCollector{
		cb:           cb,
		maxEvents:    40,
		recentEvents: make([]RequestEvent, 0, 40),
	}

	// Background ticker to compute RPS every second
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			count := atomic.SwapInt64(&mc.rpsCounter, 0)
			atomic.StoreInt64(&mc.currentRPS, count)
		}
	}()

	return mc
}

// IncrementRPS records an incoming hit for RPS calculation.
func (m *MetricsCollector) IncrementRPS() {
	atomic.AddInt64(&m.rpsCounter, 1)
	atomic.AddUint64(&m.totalRequests, 1)
}

// RecordRequest updates counters and adds an event to the ring buffer.
func (m *MetricsCollector) RecordRequest(route string, status int, duration time.Duration, success bool, reason string) {
	durationMs := float64(duration.Microseconds()) / 1000.0

	if route == "primary" {
		atomic.AddUint64(&m.primaryRequests, 1)
		if success {
			atomic.AddUint64(&m.primarySuccesses, 1)
		} else {
			atomic.AddUint64(&m.primaryFailures, 1)
		}
	} else {
		atomic.AddUint64(&m.secondaryRequests, 1)
	}

	event := RequestEvent{
		Timestamp:  time.Now(),
		Route:      route,
		Status:     status,
		DurationMs: durationMs,
		Success:    success,
		Reason:     reason,
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	m.totalLatency += duration
	m.latencyCount++

	if len(m.recentEvents) >= m.maxEvents {
		m.recentEvents = m.recentEvents[1:]
	}
	m.recentEvents = append(m.recentEvents, event)
}

// GetSnapshot generates the telemetry payload for WebSocket broadcast.
func (m *MetricsCollector) GetSnapshot() SystemMetrics {
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	m.mu.RLock()
	var avgLatency float64
	if m.latencyCount > 0 {
		avgLatency = float64(m.totalLatency.Milliseconds()) / float64(m.latencyCount)
	}
	eventsCopy := make([]RequestEvent, len(m.recentEvents))
	copy(eventsCopy, m.recentEvents)
	m.mu.RUnlock()

	pReqs := atomic.LoadUint64(&m.primaryRequests)
	pSuccess := atomic.LoadUint64(&m.primarySuccesses)
	var successRate float64 = 100.0
	if pReqs > 0 {
		successRate = (float64(pSuccess) / float64(pReqs)) * 100.0
	}

	return SystemMetrics{
		Timestamp:          time.Now(),
		RPS:                atomic.LoadInt64(&m.currentRPS),
		TotalRequests:      atomic.LoadUint64(&m.totalRequests),
		PrimaryRequests:    pReqs,
		SecondaryRequests:  atomic.LoadUint64(&m.secondaryRequests),
		CircuitState:       m.cb.State(),
		CircuitSnapshot:    m.cb.Snapshot(),
		AvgLatencyMs:       avgLatency,
		PrimarySuccessRate: successRate,
		Memory: MemoryMetrics{
			AllocMB:      float64(memStats.Alloc) / 1024 / 1024,
			TotalAllocMB: float64(memStats.TotalAlloc) / 1024 / 1024,
			SysMB:        float64(memStats.Sys) / 1024 / 1024,
			NumGoroutine: runtime.NumGoroutine(),
			NumGC:        memStats.NumGC,
		},
		RecentEvents: eventsCopy,
	}
}
