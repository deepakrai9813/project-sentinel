package telemetry

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

type Hub struct {
	collector  *MetricsCollector
	clients    map[*websocket.Conn]bool
	broadcast  chan []byte
	register   chan *websocket.Conn
	unregister chan *websocket.Conn
	mu         sync.Mutex
	quit       chan struct{}
}

func NewHub(collector *MetricsCollector) *Hub {
	return &Hub{
		collector:  collector,
		clients:    make(map[*websocket.Conn]bool),
		broadcast:  make(chan []byte, 100),
		register:   make(chan *websocket.Conn, 10),
		unregister: make(chan *websocket.Conn, 10),
		quit:       make(chan struct{}),
	}
}

func (h *Hub) Run() {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-h.quit:
			return

		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				client.Close()
			}
			h.mu.Unlock()

		case <-ticker.C:
			h.mu.Lock()
			clientCount := len(h.clients)
			h.mu.Unlock()

			if clientCount > 0 {
				metrics := h.collector.GetSnapshot()
				data, err := json.Marshal(metrics)
				if err == nil {
					h.broadcastToAll(data)
				}
			}
		}
	}
}

func (h *Hub) broadcastToAll(message []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()

	var failedClients []*websocket.Conn

	for client := range h.clients {
		client.SetWriteDeadline(time.Now().Add(200 * time.Millisecond))
		err := client.WriteMessage(websocket.TextMessage, message)
		if err != nil {
			log.Printf("[WebSocket] Client write error: %v", err)
			client.Close()
			failedClients = append(failedClients, client)
		}
	}

	for _, client := range failedClients {
		delete(h.clients, client)
	}
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WebSocket] Upgrade error: %v", err)
		return
	}

	h.register <- conn

	go func() {
		defer func() {
			h.unregister <- conn
		}()
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				break
			}
		}
	}()
}
