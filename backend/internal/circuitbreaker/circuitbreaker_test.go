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

	// 1. Initial State should be CLOSED
	if s := cb.State(); s != StateClosed {
		t.Fatalf("expected initial state CLOSED, got %s", s)
	}

	// 2. Allow should succeed in CLOSED
	if err := cb.Allow(); err != nil {
		t.Fatalf("expected Allow() to succeed, got %v", err)
	}
	cb.RecordSuccess()

	// 3. Record failures up to threshold - 1 (should stay CLOSED)
	cb.RecordFailure()
	cb.RecordFailure()
	if s := cb.State(); s != StateClosed {
		t.Fatalf("expected state CLOSED after 2 failures, got %s", s)
	}

	// 4. 3rd failure trips the breaker to OPEN
	cb.RecordFailure()
	if s := cb.State(); s != StateOpen {
		t.Fatalf("expected state OPEN after 3 failures, got %s", s)
	}

	// 5. While OPEN, Allow() must reject
	if err := cb.Allow(); err != ErrCircuitOpen {
		t.Fatalf("expected ErrCircuitOpen, got %v", err)
	}

	// 6. Wait for Timeout (cooldown) to expire -> should transition to HALF_OPEN
	time.Sleep(60 * time.Millisecond)
	if s := cb.State(); s != StateHalfOpen {
		t.Fatalf("expected state HALF_OPEN after timeout, got %s", s)
	}

	// 7. In HALF_OPEN, trial request is allowed
	if err := cb.Allow(); err != nil {
		t.Fatalf("expected trial request to be allowed in HALF_OPEN, got %v", err)
	}

	// Additional concurrent trial should be rejected (MaxHalfOpenRequests = 1)
	if err := cb.Allow(); err != ErrTooManyRequests {
		t.Fatalf("expected ErrTooManyRequests, got %v", err)
	}

	// 8. 1st trial succeeds (threshold is 2) -> still HALF_OPEN
	cb.RecordSuccess()
	if s := cb.State(); s != StateHalfOpen {
		t.Fatalf("expected state HALF_OPEN after 1 success, got %s", s)
	}

	// 9. 2nd trial allowed and succeeds -> should transition to CLOSED
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

	// Trip to OPEN
	cb.RecordFailure()
	if s := cb.State(); s != StateOpen {
		t.Fatalf("expected OPEN, got %s", s)
	}

	// Wait for HALF_OPEN
	time.Sleep(30 * time.Millisecond)
	if s := cb.State(); s != StateHalfOpen {
		t.Fatalf("expected HALF_OPEN, got %s", s)
	}

	// Trial request fails -> immediately returns to OPEN
	if err := cb.Allow(); err != nil {
		t.Fatalf("unexpected error on Allow: %v", err)
	}
	cb.RecordFailure()

	if s := cb.State(); s != StateOpen {
		t.Fatalf("expected OPEN after trial failure, got %s", s)
	}
}
