package circuitbreaker

import (
	"errors"
	"sync"
	"time"
)

type State string

const (
	StateClosed   State = "CLOSED"
	StateHalfOpen State = "HALF_OPEN"
	StateOpen     State = "OPEN"
)

var (
	ErrCircuitOpen     = errors.New("circuit breaker is open; traffic routed to fallback")
	ErrTooManyRequests = errors.New("circuit breaker is half-open; max trial requests exceeded")
)

type Config struct {
	FailureThreshold    int
	SuccessThreshold    int
	Timeout             time.Duration
	MaxHalfOpenRequests int
}

func DefaultConfig() Config {
	return Config{
		FailureThreshold:    5,
		SuccessThreshold:    2,
		Timeout:             5 * time.Second,
		MaxHalfOpenRequests: 1,
	}
}

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

func (cb *CircuitBreaker) State() State {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.checkStateTransitionLocked()
	return cb.state
}

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

func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		cb.consecutiveFailures = 0
		cb.consecutiveSuccesses = 0
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
		cb.toStateLocked(StateOpen)
	}
}

type Snapshot struct {
	State                State         `json:"state"`
	ConsecutiveFailures  int           `json:"consecutive_failures"`
	ConsecutiveSuccesses int           `json:"consecutive_successes"`
	LastStateChange      time.Time     `json:"last_state_change"`
	TimeoutRemaining     time.Duration `json:"timeout_remaining_ms"`
}

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

	consecutiveSuccesses := cb.consecutiveSuccesses
	if cb.state == StateClosed {
		consecutiveSuccesses = 0
	}

	return Snapshot{
		State:                cb.state,
		ConsecutiveFailures:  cb.consecutiveFailures,
		ConsecutiveSuccesses: consecutiveSuccesses,
		LastStateChange:      cb.lastStateChange,
		TimeoutRemaining:     remaining / time.Millisecond,
	}
}

func (cb *CircuitBreaker) checkStateTransitionLocked() {
	if cb.state == StateOpen && time.Since(cb.lastStateChange) >= cb.timeout {
		cb.toStateLocked(StateHalfOpen)
	}
}

func (cb *CircuitBreaker) toStateLocked(target State) {
	cb.state = target
	cb.lastStateChange = time.Now()
	cb.consecutiveFailures = 0
	cb.consecutiveSuccesses = 0
	cb.activeHalfOpenTrials = 0
}
