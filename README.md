# Project Sentinel

[![Go](https://img.shields.io/badge/Go-1.22-00ADD8?style=flat&logo=go)](https://golang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react)](https://react.dev)
[![Docker](https://img.shields.io/badge/Docker-Multi--Stage-2496ED?style=flat&logo=docker)](https://docker.com)
[![Memory Limit](https://img.shields.io/badge/Memory_Limit-128_MB-critical)](https://github.com)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A high-performance, fault-tolerant API gateway and reverse proxy built from scratch in Go. Project Sentinel multiplexes upstream traffic with a zero-dependency Circuit Breaker state machine, strict 200ms context timeouts, zero-allocation buffer pooling under a strict 128 MB RAM constraint, and a real-time observability dashboard built with React.

---

## Architecture

```
                      +-----------------------------+
                      |   Client / Load Generator   |
                      +--------------+--------------+
                                     |
                                     v
                      +-----------------------------+
                      |   Sentinel Gateway Proxy    |
                      |          (:8080)            |
                      |   [128 MB Memory Limit]     |
                      +--------------+--------------+
                                     |
               +---------------------+---------------------+
               | (Circuit CLOSED & Latency < 200ms)        | (Circuit OPEN or Timeout > 200ms)
               v                                           v
+-----------------------------+             +-----------------------------+
|    Toxiproxy Upstream       |             |   Secondary Fallback API    |
|          (:8475)            |             |           (:8082)           |
+--------------+--------------+             +-----------------------------+
               |
               v
+-----------------------------+
|      Primary API Mock       |
|          (:8081)            |
+-----------------------------+
```

---

## Key Features

- **Custom Circuit Breaker:** Zero-dependency implementation supporting `CLOSED`, `OPEN`, and `HALF-OPEN` states with thread-safe atomic transitions via `sync.RWMutex`.
- **Strict 200ms Context Deadlines:** Requests to upstream Primary APIs are cancelled immediately if processing exceeds 200ms, seamlessly failing over to redundant secondary services.
- **Rewindable Request Bodies:** Request bodies for `POST`/`PUT`/`PATCH` are buffered in memory once, ensuring requests can be cleanly replayed to fallback targets on timeout.
- **Memory Optimization (128 MB Ceiling):** Utilizes `sync.Pool` 32KB streaming buffers (`io.CopyBuffer`) and connection pooling, keeping steady-state heap usage under 15 MB.
- **Live WebSocket Telemetry:** Streams system statistics, route distributions, latencies, and runtime memory metrics to connected dashboards at 10 Hz.
- **High-Frequency Observability Dashboard:** Built with React and Vite, utilizing `requestAnimationFrame` render throttling to ingest real-time metrics without main-thread jank.
- **Integrated Chaos Engineering:** Turnkey Toxiproxy integration simulating 500ms latency and 20% packet loss to validate automated failover under adverse network conditions.

---

## Quickstart

### Prerequisites
- Docker & Docker Compose
- Go 1.22+ (for local development)
- Node.js 20+ (for frontend development)

### Running with Docker Compose

To start the entire cluster (Gateway, Mock Services, Toxiproxy, and Dashboard):

```bash
docker compose up -d --build
```

### Endpoints

| Service | Port | Description |
| :--- | :--- | :--- |
| **Sentinel Gateway** | `http://localhost:8080` | Reverse proxy entrypoint |
| **Observability Dashboard** | `http://localhost:3000` | Real-time monitoring UI |
| **Primary Mock API** | `http://localhost:8081` | Upstream service (~15ms response) |
| **Secondary Fallback API** | `http://localhost:8082` | Redundant fallback service |
| **Toxiproxy API** | `http://localhost:8474` | Chaos engineering control plane |
| **Toxiproxy Ingress** | `http://localhost:8475` | Ingress proxy to Primary API |

---

## Chaos Engineering & Resilience Verification

You can simulate upstream failure either directly from the web dashboard or using the provided automation scripts.

### 1. In the Dashboard
- Navigate to `http://localhost:3000`.
- Click **"Simulate Traffic (50 RPS)"** to establish baseline traffic through the Primary API.
- Click **"Inject Chaos (500ms Latency)"** to trigger upstream degradation.
- Observe the gateway cancel requests at 200ms, trip the circuit breaker to `OPEN`, and route 100% of traffic to the Secondary fallback.
- Click **"Heal Primary"** to observe `HALF-OPEN` trial probes and automatic recovery back to `CLOSED`.

### 2. Using CLI Scripts

```bash
# Inject 500ms latency and 20% packet drop
./chaos/inject_chaos.sh     # Linux / macOS
.\chaos\inject_chaos.ps1   # Windows PowerShell

# Reset upstream back to healthy ~15ms latency
./chaos/reset_chaos.sh      # Linux / macOS
.\chaos\reset_chaos.ps1    # Windows PowerShell
```

---

## Testing

Run unit tests across all backend packages:

```bash
cd backend
go test -v ./...
```

The test suite validates:
- State transitions (`CLOSED` -> `OPEN` -> `HALF-OPEN` -> `CLOSED`).
- Immediate re-trip to `OPEN` on failed trial request in `HALF-OPEN`.
- Context deadline enforcement and seamless failover to secondary.
- Request body rewind and replay on fallback.
- Thread-safe telemetry snapshotting and RPS window calculation.

---

## Project Structure

```
.
├── backend/
│   ├── cmd/
│   │   ├── sentinel/          # Gateway entrypoint & HTTP multiplexer
│   │   ├── primary-mock/      # Primary upstream service mock
│   │   └── secondary-mock/    # Fallback upstream service mock
│   ├── internal/
│   │   ├── circuitbreaker/    # Custom 3-state Circuit Breaker
│   │   ├── proxy/             # Reverse proxy router & connection pool
│   │   └── telemetry/         # Metrics collector & WebSocket hub
│   ├── Dockerfile
│   ├── go.mod
│   └── go.sum
├── chaos/
│   ├── inject_chaos.ps1       # PowerShell chaos trigger
│   ├── inject_chaos.sh        # Bash chaos trigger
│   ├── reset_chaos.ps1        # PowerShell chaos reset
│   └── reset_chaos.sh         # Bash chaos reset
├── frontend/
│   ├── public/                # Static assets & icons
│   ├── src/
│   │   ├── App.jsx            # Observability dashboard component
│   │   ├── index.css          # Design tokens & styles
│   │   └── main.jsx           # React root mounting
│   ├── Dockerfile             # Multi-stage Nginx container
│   ├── nginx.conf             # Reverse proxy configuration
│   └── vite.config.js
├── docker-compose.yml         # Container orchestration spec
├── .gitignore
└── README.md
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.
