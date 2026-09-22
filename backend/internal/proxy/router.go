package proxy

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"sentinel/internal/circuitbreaker"
	"sentinel/internal/telemetry"
)

// RouterConfig contains addresses and resilience parameters for Sentinel proxy.
type RouterConfig struct {
	PrimaryURL     string
	SecondaryURL   string
	Timeout        time.Duration
	MaxConcurrency int
}

// Router dispatches incoming requests to Primary or Fallback based on Circuit Breaker and Timeouts.
type Router struct {
	primaryURL     *url.URL
	secondaryURL   *url.URL
	cb             *circuitbreaker.CircuitBreaker
	client         *http.Client
	metrics        *telemetry.MetricsCollector
	sem            chan struct{} // Concurrency limiter to protect the 128MB RAM limit
	bufferPool     sync.Pool
}

// NewRouter constructs an optimized router.
func NewRouter(cfg RouterConfig, cb *circuitbreaker.CircuitBreaker, metrics *telemetry.MetricsCollector) (*Router, error) {
	pURL, err := url.Parse(cfg.PrimaryURL)
	if err != nil {
		return nil, err
	}
	sURL, err := url.Parse(cfg.SecondaryURL)
	if err != nil {
		return nil, err
	}

	if cfg.Timeout <= 0 {
		cfg.Timeout = 200 * time.Millisecond // Exactly 200ms per assignment spec
	}
	if cfg.MaxConcurrency <= 0 {
		cfg.MaxConcurrency = 1000 // Prevent unbounded Goroutines
	}

	// Highly optimized Transport for connection reuse and low memory footprint
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   500 * time.Millisecond,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:        500,
		MaxIdleConnsPerHost: 250,
		IdleConnTimeout:     90 * time.Second,
		DisableCompression: false,
	}

	client := &http.Client{
		Transport: transport,
		// Note: We manage per-request timeouts explicitly via context.WithTimeout(..., 200ms)
	}

	r := &Router{
		primaryURL:   pURL,
		secondaryURL: sURL,
		cb:           cb,
		client:       client,
		metrics:      metrics,
		sem:          make(chan struct{}, cfg.MaxConcurrency),
		bufferPool: sync.Pool{
			New: func() interface{} {
				buf := make([]byte, 32*1024) // 32KB buffer for streaming
				return &buf
			},
		},
	}

	return r, nil
}

// ServeHTTP handles each incoming client request.
func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	// 1. Concurrency control: Enforce memory ceiling under heavy traffic
	select {
	case r.sem <- struct{}{}:
		defer func() { <-r.sem }()
	default:
		// Saturated; reject early to prevent OOM
		http.Error(w, "Sentinel: Server Overloaded", http.StatusServiceUnavailable)
		return
	}

	startTime := time.Now()
	r.metrics.IncrementRPS()

	// Read and buffer request body once so it can be replayed to Secondary if Primary fails
	var bodyBytes []byte
	if req.Body != nil {
		var err error
		// 10MB limit protects the 128MB container ceiling from memory exhaustion
		bodyBytes, err = io.ReadAll(http.MaxBytesReader(w, req.Body, 10*1024*1024))
		if err != nil {
			http.Error(w, "Sentinel: Request Body Too Large or Unreadable", http.StatusBadRequest)
			return
		}
		_ = req.Body.Close()
	}

	// 2. Check Circuit Breaker permission
	cbErr := r.cb.Allow()
	if cbErr == nil {
		// Circuit is CLOSED or allowing a trial request in HALF_OPEN
		success := r.tryPrimary(w, req, bodyBytes, startTime)
		if success {
			return
		}
	}

	// 3. Fallback to Secondary API (either because Breaker is OPEN or Primary timed out/failed)
	r.executeFallback(w, req, bodyBytes, startTime, cbErr)
}

// tryPrimary attempts to fulfill the request via Primary API with a strict 200ms context timeout.
// Returns true if successfully fulfilled, false if we need to fall back.
func (r *Router) tryPrimary(w http.ResponseWriter, req *http.Request, bodyBytes []byte, startTime time.Time) bool {
	// Strict 200ms Context Timeout
	ctx, cancel := context.WithTimeout(req.Context(), 200*time.Millisecond)
	defer cancel()

	targetURL := *r.primaryURL
	targetURL.Path = req.URL.Path
	targetURL.RawQuery = req.URL.RawQuery

	var bodyReader io.Reader
	if len(bodyBytes) > 0 {
		bodyReader = bytes.NewReader(bodyBytes)
	}

	outReq, err := http.NewRequestWithContext(ctx, req.Method, targetURL.String(), bodyReader)
	if err != nil {
		r.cb.RecordFailure()
		r.metrics.RecordRequest("primary", 0, time.Since(startTime), false, "req_create_fail")
		return false
	}

	copyHeaders(outReq.Header, req.Header)
	outReq.Header.Set("X-Forwarded-For", req.RemoteAddr)

	resp, err := r.client.Do(outReq)
	if err != nil {
		// Timeout or network failure occurred!
		r.cb.RecordFailure()
		isTimeout := errors.Is(err, context.DeadlineExceeded)
		reason := "network_err"
		if isTimeout {
			reason = "timeout_200ms"
		}
		r.metrics.RecordRequest("primary", 0, time.Since(startTime), false, reason)
		return false
	}
	defer func() {
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}()

	// Treat 5xx server errors as failure to protect downstream
	if resp.StatusCode >= 500 {
		r.cb.RecordFailure()
		r.metrics.RecordRequest("primary", resp.StatusCode, time.Since(startTime), false, "status_5xx")
		return false
	}

	// Primary Succeeded! Record success in Circuit Breaker
	r.cb.RecordSuccess()
	r.metrics.RecordRequest("primary", resp.StatusCode, time.Since(startTime), true, "")

	// Stream response back to client
	w.Header().Set("X-Sentinel-Route", "PRIMARY")
	w.Header().Set("X-Sentinel-Circuit", string(r.cb.State()))
	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)

	bufPtr := r.bufferPool.Get().(*[]byte)
	io.CopyBuffer(w, resp.Body, *bufPtr)
	r.bufferPool.Put(bufPtr)

	return true
}

// executeFallback routes the request seamlessly to the Secondary API.
func (r *Router) executeFallback(w http.ResponseWriter, req *http.Request, bodyBytes []byte, startTime time.Time, cbErr error) {
	// Secondary API call (with generous 2s context timeout for resilience)
	ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
	defer cancel()

	targetURL := *r.secondaryURL
	targetURL.Path = req.URL.Path
	targetURL.RawQuery = req.URL.RawQuery

	var bodyReader io.Reader
	if len(bodyBytes) > 0 {
		bodyReader = bytes.NewReader(bodyBytes)
	}

	outReq, err := http.NewRequestWithContext(ctx, req.Method, targetURL.String(), bodyReader)
	if err != nil {
		http.Error(w, "Sentinel: Failed to create fallback request", http.StatusBadGateway)
		r.metrics.RecordRequest("secondary", 0, time.Since(startTime), false, "fallback_err")
		return
	}

	copyHeaders(outReq.Header, req.Header)
	outReq.Header.Set("X-Forwarded-For", req.RemoteAddr)

	resp, err := r.client.Do(outReq)
	if err != nil {
		http.Error(w, "Sentinel: Fallback API unreachable", http.StatusServiceUnavailable)
		r.metrics.RecordRequest("secondary", 0, time.Since(startTime), false, "secondary_down")
		return
	}
	defer func() {
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}()

	r.metrics.RecordRequest("secondary", resp.StatusCode, time.Since(startTime), true, "")

	// Indicate to client that fallback was used
	w.Header().Set("X-Sentinel-Route", "SECONDARY_FALLBACK")
	w.Header().Set("X-Sentinel-Circuit", string(r.cb.State()))
	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)

	bufPtr := r.bufferPool.Get().(*[]byte)
	io.CopyBuffer(w, resp.Body, *bufPtr)
	r.bufferPool.Put(bufPtr)
}

func copyHeaders(dst, src http.Header) {
	for k, vv := range src {
		for _, v := range vv {
			dst.Add(k, v)
		}
	}
}
