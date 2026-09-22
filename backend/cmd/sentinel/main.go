package main

import (
	"bytes"
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

	log.Printf("[Sentinel] Starting on port :%s", port)
	log.Printf("[Sentinel] Primary Target:   %s", primaryURL)
	log.Printf("[Sentinel] Secondary Target: %s", secondaryURL)

	cbConfig := circuitbreaker.Config{
		FailureThreshold:    5,
		SuccessThreshold:    2,
		Timeout:             5 * time.Second,
		MaxHalfOpenRequests: 1,
	}
	cb := circuitbreaker.New(cbConfig)

	metricsCollector := telemetry.NewMetricsCollector(cb)
	hub := telemetry.NewHub(metricsCollector)
	go hub.Run()

	routerConfig := proxy.RouterConfig{
		PrimaryURL:     primaryURL,
		SecondaryURL:   secondaryURL,
		Timeout:        200 * time.Millisecond,
		MaxConcurrency: 2000,
	}
	router, err := proxy.NewRouter(routerConfig, cb, metricsCollector)
	if err != nil {
		log.Fatalf("[Sentinel] Failed to initialize router: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/ws", hub.ServeWS)

	mux.HandleFunc("/api/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(metricsCollector.GetSnapshot())
	})

	toxiURL := getEnv("TOXIPROXY_URL", "http://localhost:8474")
	mux.HandleFunc("/api/chaos/inject", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		client := &http.Client{Timeout: 3 * time.Second}

		lBody := bytes.NewBufferString(`{"name":"latency_chaos","type":"latency","stream":"downstream","toxicity":1.0,"attributes":{"latency":500,"jitter":0}}`)
		req1, _ := http.NewRequest("POST", toxiURL+"/proxies/primary_api/toxics", lBody)
		req1.Header.Set("Content-Type", "application/json")
		req1.Header.Set("User-Agent", "sentinel-chaos")
		client.Do(req1)

		pBody := bytes.NewBufferString(`{"name":"loss_chaos","type":"timeout","stream":"downstream","toxicity":0.2,"attributes":{"timeout":1000}}`)
		req2, _ := http.NewRequest("POST", toxiURL+"/proxies/primary_api/toxics", pBody)
		req2.Header.Set("Content-Type", "application/json")
		req2.Header.Set("User-Agent", "sentinel-chaos")
		client.Do(req2)

		w.Write([]byte(`{"status":"chaos_injected","latency_ms":500,"loss_percent":20}`))
	})

	mux.HandleFunc("/api/chaos/reset", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		client := &http.Client{Timeout: 3 * time.Second}

		req1, _ := http.NewRequest("DELETE", toxiURL+"/proxies/primary_api/toxics/latency_chaos", nil)
		req1.Header.Set("User-Agent", "sentinel-chaos")
		client.Do(req1)

		req2, _ := http.NewRequest("DELETE", toxiURL+"/proxies/primary_api/toxics/loss_chaos", nil)
		req2.Header.Set("User-Agent", "sentinel-chaos")
		client.Do(req2)

		w.Write([]byte(`{"status":"chaos_healed"}`))
	})

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

		go func() {
			ticker := time.NewTicker(20 * time.Millisecond)
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

	mux.Handle("/data", router)
	mux.Handle("/data/", router)
	mux.Handle("/", router)

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
	log.Println("[Sentinel] Server exited.")
}
