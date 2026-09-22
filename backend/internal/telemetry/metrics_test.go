package telemetry

import (
	"testing"
	"time"

	"sentinel/internal/circuitbreaker"
)

func TestMetricsCollector_RecordAndSnapshot(t *testing.T) {
	cb := circuitbreaker.New(circuitbreaker.DefaultConfig())
	collector := NewMetricsCollector(cb)

	collector.IncrementRPS()
	collector.IncrementRPS()
	collector.RecordRequest("primary", 200, 15*time.Millisecond, true, "")
	collector.RecordRequest("secondary", 200, 25*time.Millisecond, true, "")

	snapshot := collector.GetSnapshot()

	if snapshot.TotalRequests != 2 {
		t.Fatalf("expected total requests 2, got %d", snapshot.TotalRequests)
	}
	if snapshot.PrimaryRequests != 1 {
		t.Fatalf("expected primary requests 1, got %d", snapshot.PrimaryRequests)
	}
	if snapshot.SecondaryRequests != 1 {
		t.Fatalf("expected secondary requests 1, got %d", snapshot.SecondaryRequests)
	}
	if snapshot.CircuitState != circuitbreaker.StateClosed {
		t.Fatalf("expected circuit state CLOSED, got %s", snapshot.CircuitState)
	}
	if snapshot.Memory.AllocMB <= 0 {
		t.Fatalf("expected positive memory allocation, got %f", snapshot.Memory.AllocMB)
	}
	if len(snapshot.RecentEvents) != 2 {
		t.Fatalf("expected 2 recent events, got %d", len(snapshot.RecentEvents))
	}
}
