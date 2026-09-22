package circuitbreaker

import (
	"testing"
	"time"
)

func TestCircuitBreaker_Transitions(t *testing.T) {
	cfg := Config{
		FailureThreshold:    3,
		SuccessThreshold:    2,
		Timeout:             50 * time.Millisecond,
		MaxHalfOpenRequests: 1,
	}
	cb := New(cfg)

	if s := cb.State(); s != StateClosed {
		t.Fatalf("expected initial state CLOSED, got %s", s)
	}

	if err := cb.Allow(); err != nil {
		t.Fatalf("expected Allow() to succeed, got %v", err)
	}
	cb.RecordSuccess()

	cb.RecordFailure()
	cb.RecordFailure()
	if s := cb.State(); s != StateClosed {
		t.Fatalf("expected state CLOSED after 2 failures, got %s", s)
	}

	cb.RecordFailure()
	if s := cb.State(); s != StateOpen {
		t.Fatalf("expected state OPEN after 3 failures, got %s", s)
	}

	if err := cb.Allow(); err != ErrCircuitOpen {
		t.Fatalf("expected ErrCircuitOpen, got %v", err)
	}

	time.Sleep(60 * time.Millisecond)
	if s := cb.State(); s != StateHalfOpen {
		t.Fatalf("expected state HALF_OPEN after timeout, got %s", s)
	}

	if err := cb.Allow(); err != nil {
		t.Fatalf("expected trial request to be allowed in HALF_OPEN, got %v", err)
	}

	if err := cb.Allow(); err != ErrTooManyRequests {
		t.Fatalf("expected ErrTooManyRequests, got %v", err)
	}

	cb.RecordSuccess()
	if s := cb.State(); s != StateHalfOpen {
		t.Fatalf("expected state HALF_OPEN after 1 success, got %s", s)
	}

	if err := cb.Allow(); err != nil {
		t.Fatalf("expected 2nd trial to be allowed, got %v", err)
	}
	cb.RecordSuccess()
	if s := cb.State(); s != StateClosed {
		t.Fatalf("expected state CLOSED after 2 consecutive successes, got %s", s)
	}
}

func TestCircuitBreaker_HalfOpenFailureTripsToOpen(t *testing.T) {
	cfg := Config{
		FailureThreshold:    1,
		SuccessThreshold:    2,
		Timeout:             20 * time.Millisecond,
		MaxHalfOpenRequests: 1,
	}
	cb := New(cfg)

	cb.RecordFailure()
	if s := cb.State(); s != StateOpen {
		t.Fatalf("expected OPEN, got %s", s)
	}

	time.Sleep(30 * time.Millisecond)
	if s := cb.State(); s != StateHalfOpen {
		t.Fatalf("expected HALF_OPEN, got %s", s)
	}

	if err := cb.Allow(); err != nil {
		t.Fatalf("unexpected error on Allow: %v", err)
	}
	cb.RecordFailure()

	if s := cb.State(); s != StateOpen {
		t.Fatalf("expected OPEN after trial failure, got %s", s)
	}
}
