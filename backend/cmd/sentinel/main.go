package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"sentinel/internal/circuitbreaker"
	"sentinel/internal/proxy"
	"sentinel/internal/telemetry"
)

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func main() {
	port := getEnv("PORT", "8080")
	primaryURL := getEnv("PRIMARY_URL", "http://localhost:8081")
	secondaryURL := getEnv("SECONDARY_URL", "http://localhost:8082")

	log.Printf("[Sentinel] Starting Project Sentinel Multiplexer on port :%s", port)
	log.Printf("[Sentinel] Primary Target:   %s", primaryURL)
	log.Printf("[Sentinel] Secondary Target: %s", secondaryURL)

	// 1. Initialize Circuit Breaker from scratch
	cbConfig := circuitbreaker.Config{
		FailureThreshold:    5,
		SuccessThreshold:    2,
		Timeout:             5 * time.Second,
		MaxHalfOpenRequests: 1,
	}
	cb := circuitbreaker.New(cbConfig)

	// 2. Initialize Telemetry & WebSocket Hub
	metricsCollector := telemetry.NewMetricsCollector(cb)
	hub := telemetry.NewHub(metricsCollector)
	go hub.Run()

	// 3. Initialize Proxy Router
	routerConfig := proxy.RouterConfig{
		PrimaryURL:     primaryURL,
		SecondaryURL:   secondaryURL,
		Timeout:        200 * time.Millisecond, // Strict 200ms context timeout per spec
		MaxConcurrency: 2000,                   // Strict Goroutine ceiling for 128MB limit
	}
	router, err := proxy.NewRouter(routerConfig, cb, metricsCollector)
	if err != nil {
		log.Fatalf("[Sentinel] Failed to initialize router: %v", err)
	}

	// 4. Set up HTTP Handlers
	mux := http.NewServeMux()

	// WebSocket Telemetry endpoint
	mux.HandleFunc("/ws", hub.ServeWS)

	// REST Metrics snapshot endpoint
	mux.HandleFunc("/api/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(metricsCollector.GetSnapshot())
	})

	// Built-in Load Simulator trigger (great for live recruiter demo)
	var (
		loadMu     sync.Mutex
		loadCancel context.CancelFunc
	)
	mux.HandleFunc("/api/simulate/load", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		action := r.URL.Query().Get("action")

		loadMu.Lock()
		defer loadMu.Unlock()

		if action == "stop" {
			if loadCancel != nil {
				loadCancel()
				loadCancel = nil
			}
			w.Write([]byte(`{"status":"stopped"}`))
			return
		}

		if loadCancel != nil {
			w.Write([]byte(`{"status":"already_running"}`))
			return
		}

		ctx, cancel := context.WithCancel(context.Background())
		loadCancel = cancel

		// Run simulated client traffic (e.g. 50 requests/sec)
		go func() {
			ticker := time.NewTicker(20 * time.Millisecond) // ~50 RPS
			defer ticker.Stop()
			client := &http.Client{Timeout: 1 * time.Second}
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					go func() {
						resp, err := client.Get("http://localhost:" + port + "/data")
						if err == nil {
							resp.Body.Close()
						}
					}()
				}
			}
		}()

		w.Write([]byte(`{"status":"started"}`))
	})

	// Explicit route mappings for proxied data endpoints
	mux.Handle("/data", router)
	mux.Handle("/data/", router)

	// All other incoming requests fall through to Sentinel Proxy router
	mux.Handle("/", router)

	// Wrap mux with CORS middleware for frontend flexibility
	corsHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		mux.ServeHTTP(w, r)
	})

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           corsHandler,
		ReadHeaderTimeout: 3 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// 5. Graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("[Sentinel] Proxy listening on :%s", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[Sentinel] Listen error: %v", err)
		}
	}()

	<-stop
	log.Println("[Sentinel] Shutting down gracefully...")

	// Cancel any active load simulation goroutines
	loadMu.Lock()
	if loadCancel != nil {
		loadCancel()
		loadCancel = nil
	}
	loadMu.Unlock()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("[Sentinel] Forced shutdown: %v", err)
	}
	log.Println("[Sentinel] Server exited successfully.")
}
