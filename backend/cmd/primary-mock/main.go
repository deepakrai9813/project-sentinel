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
		port = "8081"
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("healthy"))
	})

	handleRequest := func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(15 * time.Millisecond)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)

		resp := Response{
			Status:    "success",
			Service:   "primary-api",
			Timestamp: time.Now(),
			Message:   "Processed primary business transaction",
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

	log.Printf("[Primary API] Listening on :%s", port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[Primary API] Server error: %v", err)
	}
}
