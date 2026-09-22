package circuitbreaker

import (
	"errors"
	"sync"
	"time"
)

// State represents the state of the circuit breaker.
type State string

const (
	StateClosed   State = "CLOSED"
	StateHalfOpen State = "HALF_OPEN"
	StateOpen     State = "OPEN"
)

var (
	// ErrCircuitOpen is returned when the circuit breaker is in OPEN state.
	ErrCircuitOpen = errors.New("circuit breaker is open; traffic routed to fallback")
	// ErrTooManyRequests is returned when HALF_OPEN state max trial requests are reached.
	ErrTooManyRequests = errors.New("circuit breaker is half-open; max trial requests exceeded")
)

// Config holds configuration parameters for the CircuitBreaker.
type Config struct {
	// FailureThreshold is the number of consecutive failures needed to trip from CLOSED to OPEN.
	FailureThreshold int
	// SuccessThreshold is the number of consecutive successes in HALF_OPEN to transition back to CLOSED.
	SuccessThreshold int
	// Timeout is the cooldown duration the circuit stays OPEN before entering HALF_OPEN.
	Timeout time.Duration
	// MaxHalfOpenRequests is how many concurrent trial requests are permitted in HALF_OPEN state.
	MaxHalfOpenRequests int
}

// DefaultConfig provides standard, production-ready defaults.
func DefaultConfig() Config {
	return Config{
		FailureThreshold:    5,
		SuccessThreshold:    2,
		Timeout:             5 * time.Second,
		MaxHalfOpenRequests: 1,
	}
}

// CircuitBreaker manages resilient execution across states.
type CircuitBreaker struct {
	mu                  sync.RWMutex
	state               State
	failureThreshold    int
	successThreshold    int
	timeout             time.Duration
	maxHalfOpenRequests int

	consecutiveFailures  int
	consecutiveSuccesses int
	activeHalfOpenTrials int
	lastStateChange      time.Time
}

// New creates a new CircuitBreaker with the provided configuration.
func New(cfg Config) *CircuitBreaker {
	if cfg.FailureThreshold <= 0 {
		cfg.FailureThreshold = 5
	}
	if cfg.SuccessThreshold <= 0 {
		cfg.SuccessThreshold = 2
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 5 * time.Second
	}
	if cfg.MaxHalfOpenRequests <= 0 {
		cfg.MaxHalfOpenRequests = 1
	}

	return &CircuitBreaker{
		state:               StateClosed,
		failureThreshold:    cfg.FailureThreshold,
		successThreshold:    cfg.SuccessThreshold,
		timeout:             cfg.Timeout,
		maxHalfOpenRequests: cfg.MaxHalfOpenRequests,
		lastStateChange:     time.Now(),
	}
}

// State returns the current circuit breaker state, automatically checking for timeout expiration.
func (cb *CircuitBreaker) State() State {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.checkStateTransitionLocked()
	return cb.state
}

// Allow checks if a request is permitted to reach the primary target.
// Returns an error if the circuit is OPEN or if max trials in HALF_OPEN are exceeded.
func (cb *CircuitBreaker) Allow() error {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.checkStateTransitionLocked()

	switch cb.state {
	case StateClosed:
		return nil
	case StateOpen:
		return ErrCircuitOpen
	case StateHalfOpen:
		if cb.activeHalfOpenTrials >= cb.maxHalfOpenRequests {
			return ErrTooManyRequests
		}
		cb.activeHalfOpenTrials++
		return nil
	default:
		return nil
	}
}

// RecordSuccess records a successful execution to the primary API.
func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		cb.consecutiveSuccesses++
		cb.consecutiveFailures = 0
	case StateHalfOpen:
		if cb.activeHalfOpenTrials > 0 {
			cb.activeHalfOpenTrials--
		}
		cb.consecutiveSuccesses++
		if cb.consecutiveSuccesses >= cb.successThreshold {
			cb.toStateLocked(StateClosed)
		}
	}
}

// RecordFailure records a failed execution to the primary API (timeout, 5xx, or network failure).
func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		cb.consecutiveFailures++
		cb.consecutiveSuccesses = 0
		if cb.consecutiveFailures >= cb.failureThreshold {
			cb.toStateLocked(StateOpen)
		}
	case StateHalfOpen:
		if cb.activeHalfOpenTrials > 0 {
			cb.activeHalfOpenTrials--
		}
		// Any failure during trial immediately trips back to OPEN
		cb.toStateLocked(StateOpen)
	}
}

// Snapshot returns a copy of current metrics for telemetry/WebSocket export.
type Snapshot struct {
	State                State         `json:"state"`
	ConsecutiveFailures  int           `json:"consecutive_failures"`
	ConsecutiveSuccesses int           `json:"consecutive_successes"`
	LastStateChange      time.Time     `json:"last_state_change"`
	TimeoutRemaining     time.Duration `json:"timeout_remaining_ms"`
}

// Snapshot returns the current status snapshot of the circuit breaker.
func (cb *CircuitBreaker) Snapshot() Snapshot {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.checkStateTransitionLocked()

	var remaining time.Duration
	if cb.state == StateOpen {
		elapsed := time.Since(cb.lastStateChange)
		if elapsed < cb.timeout {
			remaining = cb.timeout - elapsed
		}
	}

	return Snapshot{
		State:                cb.state,
		ConsecutiveFailures:  cb.consecutiveFailures,
		ConsecutiveSuccesses: cb.consecutiveSuccesses,
		LastStateChange:      cb.lastStateChange,
		TimeoutRemaining:     remaining / time.Millisecond,
	}
}

// Internal helper must be called while holding cb.mu Lock.
func (cb *CircuitBreaker) checkStateTransitionLocked() {
	if cb.state == StateOpen && time.Since(cb.lastStateChange) >= cb.timeout {
		cb.toStateLocked(StateHalfOpen)
	}
}

// Internal transition handler must be called while holding cb.mu Lock.
func (cb *CircuitBreaker) toStateLocked(target State) {
	cb.state = target
	cb.lastStateChange = time.Now()
	cb.consecutiveFailures = 0
	cb.consecutiveSuccesses = 0
	cb.activeHalfOpenTrials = 0
}
