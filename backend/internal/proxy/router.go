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

type RouterConfig struct {
	PrimaryURL     string
	SecondaryURL   string
	Timeout        time.Duration
	MaxConcurrency int
}

type Router struct {
	primaryURL   *url.URL
	secondaryURL *url.URL
	cb           *circuitbreaker.CircuitBreaker
	client       *http.Client
	metrics      *telemetry.MetricsCollector
	sem          chan struct{}
	bufferPool   sync.Pool
}

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
		cfg.Timeout = 200 * time.Millisecond
	}
	if cfg.MaxConcurrency <= 0 {
		cfg.MaxConcurrency = 1000
	}

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
				buf := make([]byte, 32*1024)
				return &buf
			},
		},
	}

	return r, nil
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	select {
	case r.sem <- struct{}{}:
		defer func() { <-r.sem }()
	default:
		http.Error(w, "Sentinel: Server Overloaded", http.StatusServiceUnavailable)
		return
	}

	startTime := time.Now()
	r.metrics.IncrementRPS()

	var bodyBytes []byte
	if req.Body != nil {
		var err error
		bodyBytes, err = io.ReadAll(http.MaxBytesReader(w, req.Body, 10*1024*1024))
		if err != nil {
			http.Error(w, "Sentinel: Request Body Too Large or Unreadable", http.StatusBadRequest)
			return
		}
		_ = req.Body.Close()
	}

	cbErr := r.cb.Allow()
	if cbErr == nil {
		success := r.tryPrimary(w, req, bodyBytes, startTime)
		if success {
			return
		}
	}

	r.executeFallback(w, req, bodyBytes, startTime, cbErr)
}

func (r *Router) tryPrimary(w http.ResponseWriter, req *http.Request, bodyBytes []byte, startTime time.Time) bool {
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

	if resp.StatusCode >= 500 {
		r.cb.RecordFailure()
		r.metrics.RecordRequest("primary", resp.StatusCode, time.Since(startTime), false, "status_5xx")
		return false
	}

	r.cb.RecordSuccess()
	r.metrics.RecordRequest("primary", resp.StatusCode, time.Since(startTime), true, "")

	w.Header().Set("X-Sentinel-Route", "PRIMARY")
	w.Header().Set("X-Sentinel-Circuit", string(r.cb.State()))
	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)

	bufPtr := r.bufferPool.Get().(*[]byte)
	io.CopyBuffer(w, resp.Body, *bufPtr)
	r.bufferPool.Put(bufPtr)

	return true
}

func (r *Router) executeFallback(w http.ResponseWriter, req *http.Request, bodyBytes []byte, startTime time.Time, cbErr error) {
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
