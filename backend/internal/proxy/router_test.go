package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"sentinel/internal/circuitbreaker"
	"sentinel/internal/telemetry"
)

func TestRouter_PrimaryFastSuccess(t *testing.T) {
	// Fast Primary server
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("from primary"))
	}))
	defer primary.Close()

	// Secondary server
	secondary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("from fallback"))
	}))
	defer secondary.Close()

	cb := circuitbreaker.New(circuitbreaker.DefaultConfig())
	metrics := telemetry.NewMetricsCollector(cb)

	router, err := NewRouter(RouterConfig{
		PrimaryURL:   primary.URL,
		SecondaryURL: secondary.URL,
		Timeout:      200 * time.Millisecond,
	}, cb, metrics)
	if err != nil {
		t.Fatalf("failed to create router: %v", err)
	}

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", w.Code)
	}
	if route := w.Header().Get("X-Sentinel-Route"); route != "PRIMARY" {
		t.Fatalf("expected X-Sentinel-Route PRIMARY, got %s", route)
	}
	if body := w.Body.String(); body != "from primary" {
		t.Fatalf("expected body 'from primary', got '%s'", body)
	}
}

func TestRouter_ContextTimeoutFallsBackToSecondary(t *testing.T) {
	// Slow Primary server (>200ms)
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(350 * time.Millisecond) // Exceeds 200ms
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("slow primary"))
	}))
	defer primary.Close()

	// Secondary server responds quickly
	secondary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("from fallback"))
	}))
	defer secondary.Close()

	cb := circuitbreaker.New(circuitbreaker.DefaultConfig())
	metrics := telemetry.NewMetricsCollector(cb)

	router, err := NewRouter(RouterConfig{
		PrimaryURL:   primary.URL,
		SecondaryURL: secondary.URL,
		Timeout:      200 * time.Millisecond,
	}, cb, metrics)
	if err != nil {
		t.Fatalf("failed to create router: %v", err)
	}

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()

	start := time.Now()
	router.ServeHTTP(w, req)
	elapsed := time.Since(start)

	// Primary timed out around ~200ms, and fallback took minimal time (< 300ms total)
	if elapsed > 400*time.Millisecond {
		t.Fatalf("expected request to complete around ~200-300ms, took %v", elapsed)
	}

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from fallback, got %d", w.Code)
	}
	if route := w.Header().Get("X-Sentinel-Route"); route != "SECONDARY_FALLBACK" {
		t.Fatalf("expected X-Sentinel-Route SECONDARY_FALLBACK, got %s", route)
	}
	if body := w.Body.String(); body != "from fallback" {
		t.Fatalf("expected body 'from fallback', got '%s'", body)
	}
}
