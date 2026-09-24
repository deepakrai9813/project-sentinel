# Project Sentinel

A lightweight, fault-tolerant API gateway and reverse proxy with a custom Circuit Breaker and real-time dashboard, built in Go and React.

I built Project Sentinel to tackle a common problem in backend microservices: when one service slows down or crashes, it shouldn't bring down your whole platform. Sentinel sits between clients and backend services, catching slow requests (>200ms) and automatically routing traffic to a backup service without dropping user requests.

---

## Video Demo
I recorded a quick video walkthrough demonstrating the dashboard, injecting chaos with Toxiproxy, and showing how Sentinel automatically recovers:

**[Watch the Demo Video (docs/demo.mp4)](./docs/demo.mp4)**

---

## What It Does

- **Custom Circuit Breaker (built from scratch in Go):**
  - **CLOSED (Green):** Normal state. All requests go to the Primary API (~15ms).
  - **OPEN (Red):** If the Primary API takes longer than 200ms or fails 5 times in a row, Sentinel stops sending traffic there and routes 100% of requests to the backup Secondary API.
  - **HALF-OPEN (Yellow):** After a 5-second cooldown, Sentinel sends a couple of trial requests to test if the Primary API is healthy again. If they succeed, it switches back to CLOSED automatically.
- **Strict 200ms Timeout:** Never leaves users hanging. If the primary service is slow, the request is cancelled at 200ms and immediately tried on the backup.
- **Rewindable Request Body:** For `POST` and `PUT` requests, the request body is buffered so it can be replayed to the fallback server without data loss.
- **Low Memory Footprint (~8–10 MB):** Built with `sync.Pool` buffer reuse to easily stay well within a 128 MB Docker memory limit.
- **Live Dashboard:** A real-time React UI that connects via WebSockets and updates at 60 FPS without browser lag.
- **Chaos Testing with Toxiproxy:** Simulates real-world network issues (500ms lag and 20% packet drops) to prove resilience.

---

## Tech Stack

- **Backend:** Go (Standard library `net/http`, Gorilla WebSocket, `sync.RWMutex`)
- **Frontend:** React, Vite, Lucide icons
- **DevOps & Testing:** Docker, Docker Compose, Toxiproxy

---

## Architecture

```
                        [ Client / Traffic ]
                                 │
                                 ▼
                     [ Sentinel Gateway :8080 ]
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
         (Fast & Healthy)                (Slow > 200ms / Down)
                 │                               │
                 ▼                               ▼
       [ Primary API :8081 ]           [ Secondary API :8082 ]
       (via Toxiproxy :8475)                 (Fallback)
```

---

## How to Run

The easiest way to start all services (Gateway, Primary API, Secondary API, Toxiproxy, and Dashboard) is with Docker Compose:

```bash
docker compose up -d --build
```

Once running, you can access:
- **Dashboard:** [http://localhost:3000](http://localhost:3000)
- **Gateway Proxy:** [http://localhost:8080](http://localhost:8080)
- **Primary Mock API:** [http://localhost:8081](http://localhost:8081)
- **Secondary Mock API:** [http://localhost:8082](http://localhost:8082)

---

## Testing Chaos & Recovery

You can test the automatic failover right from the web dashboard:

1. Open `http://localhost:3000`.
2. Click **"Simulate Traffic"** to send ~50 requests per second. You will see green traffic flowing to the Primary API.
3. Click **"Inject Chaos"**. This uses Toxiproxy to add a 500ms delay to the Primary API.
4. Sentinel's 200ms timeout kicks in, the circuit trips to **OPEN (Red)**, and traffic automatically diverts to the Secondary API. Notice that **every request still returns 200 OK**—zero dropped requests.
5. Click **"Heal Primary"**. After a 5-second cooldown, Sentinel sends test probes in **HALF-OPEN (Yellow)** and automatically switches back to **CLOSED (Green)** once healthy.

You can also run the chaos scripts from the terminal:

```bash
# Inject 500ms lag & 20% loss
./chaos/inject_chaos.sh     # Linux / macOS
.\chaos\inject_chaos.ps1   # Windows PowerShell

# Restore normal speed
./chaos/reset_chaos.sh      # Linux / macOS
.\chaos\reset_chaos.ps1    # Windows PowerShell
```

---

## Running Backend Tests

```bash
cd backend
go test -v ./...
```

The unit tests verify:
- Circuit breaker transitions (`CLOSED` → `OPEN` → `HALF-OPEN` → `CLOSED`).
- Immediate re-trip to `OPEN` if a test probe fails in `HALF-OPEN`.
- 200ms context timeout handling and fallback execution.
- Body rewinding for POST requests on fallback.
- Thread-safe metrics and RPS tracking.

---

## Project Structure

```
.
├── backend/
│   ├── cmd/
│   │   ├── sentinel/          # Gateway entrypoint & routing
│   │   ├── primary-mock/      # Primary API mock (~15ms)
│   │   └── secondary-mock/    # Backup API mock (~10ms)
│   ├── internal/
│   │   ├── circuitbreaker/    # Custom circuit breaker state machine
│   │   ├── proxy/             # Reverse proxy router & timeout logic
│   │   └── telemetry/         # Metrics collector & WebSocket hub
│   ├── Dockerfile
│   └── go.mod
├── frontend/
│   ├── src/                   # React dashboard
│   ├── Dockerfile
│   └── package.json
├── chaos/                     # Chaos test scripts
├── docs/                      # Demo video (demo.mp4)
├── docker-compose.yml
├── .gitignore
└── README.md
```

---

## License

MIT
