package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

type Response struct {
	Status    string    `json:"status"`
	Service   string    `json:"service"`
	Timestamp time.Time `json:"timestamp"`
	Message   string    `json:"message"`
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8082"
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("healthy"))
	})

	handleRequest := func(w http.ResponseWriter, r *http.Request) {
		// Fallback service responds quickly (10ms)
		time.Sleep(10 * time.Millisecond)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)

		resp := Response{
			Status:    "fallback_fulfilled",
			Service:   "secondary-api",
			Timestamp: time.Now(),
			Message:   "Served from secondary redundant fallback cluster",
		}
		json.NewEncoder(w).Encode(resp)
	}

	mux.HandleFunc("/data", handleRequest)
	mux.HandleFunc("/data/", handleRequest)
	mux.HandleFunc("/", handleRequest)

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}

	log.Printf("[Secondary API] Listening on :%s", port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[Secondary API] Server error: %v", err)
	}
}
