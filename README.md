# 🛡️ Project Sentinel: High-Performance API Multiplexer & Chaos-Resilient Circuit Breaker

[![Go Version](https://img.shields.io/badge/Go-1.22-00ADD8?style=flat&logo=go)](https://golang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react)](https://react.dev)
[![Docker](https://img.shields.io/badge/Docker-Multi--Stage-2496ED?style=flat&logo=docker)](https://docker.com)
[![Memory Limit](https://img.shields.io/badge/Memory_Limit-128_MB-critical)](https://github.com)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> **Engineering Intern Assessment:** A high-concurrency API multiplexer featuring a custom zero-dependency Circuit Breaker, strict 200ms context timeouts, real-time WebSocket telemetry, a high-frequency React "War Room" dashboard, and automated Toxiproxy chaos engineering.

---

## 📑 Table of Contents
- [Architecture & Packet Flow](#-architecture--packet-flow)
- [Key Engineering Requirements Met](#-key-engineering-requirements-met)
- [Architectural Choices & Deep-Dive](#-architectural-choices--deep-dive)
  - [1. Custom Circuit Breaker State Machine](#1-custom-circuit-breaker-state-machine)
  - [2. Context Timeouts & Goroutine Safety](#2-context-timeouts--goroutine-safety)
  - [3. Enforcing the 128 MB Memory Ceiling](#3-enforcing-the-128-mb-memory-ceiling)
  - [4. High-Frequency React Rendering (Zero-Lag UI)](#4-high-frequency-react-rendering-zero-lag-ui)
- [Quickstart via Docker Compose](#-quickstart-via-docker-compose)
- [Triggering the Toxiproxy Chaos Test](#-triggering-the-toxiproxy-chaos-test)
- [Manual Testing & Verification](#-manual-testing--verification)
- [Interview & Recruiter Discussion Guide](#-interview--recruiter-discussion-guide)

---

## 🏛 Architecture & Packet Flow

```
                      +-----------------------------+
                      |   Client / Load Simulator   |
                      +--------------+--------------+
                                     | Continuous Traffic
                                     v
                      +-----------------------------+
                      |   Sentinel Reverse Proxy    |
                      |          (:8080)            |
                      |   [128 MB Memory Limit]     |
                      +--------------+--------------+
                                     |
              +----------------------+----------------------+
              | (Breaker CLOSED & Latency < 200ms)          | (Breaker OPEN or Timeout > 200ms)
              v                                             v
+-----------------------------+               +-----------------------------+
|    Toxiproxy Proxy Port     |               |    Secondary Fallback API   |
|          (:8475)            |               |           (:8082)           |
+--------------+--------------+               +-----------------------------+
              |                                     (Guaranteed 200 OK)
              v
+-----------------------------+
|      Primary Mock API       |
|          (:8081)            |
+-----------------------------+
```

---

## 🎯 Key Engineering Requirements Met

| Requirement | Implementation Detail |
| :--- | :--- |
| **HTTP Reverse Proxy** | Built using Go standard library (`net/http`) with custom `RoundTripper` connection pooling. |
| **Custom Circuit Breaker** | Built completely from scratch without external resilience libraries. Tracks `CLOSED`, `OPEN`, and `HALF-OPEN` states with thread-safe `sync.RWMutex`. |
| **Context Timeouts** | Strict `context.WithTimeout(req.Context(), 200*time.Millisecond)` on Primary API calls. Cancels immediately to prevent blocking. |
| **128 MB Memory Limit** | Enforced via Docker Compose (`mem_limit: 128m`). Zero memory leaks, zero-copy buffer streaming (`io.CopyBuffer`), and concurrency semaphores. |
| **Real-Time Telemetry** | High-frequency telemetry (RPS, state, latencies, Go runtime memory) streamed via WebSockets (`/ws`). |
| **React "War Room"** | Real-time visual state machine, animated network topology, and 60 FPS frame-throttled WebSocket ingestion. |
| **Chaos Engineering** | Toxiproxy integration with pre-built scripts to inject 500ms latency and 20% packet loss. |

---

## 🔬 Architectural Choices & Deep-Dive

### 1. Custom Circuit Breaker State Machine
Instead of relying on external libraries (like `hystrix-go` or `gobreaker`), Sentinel implements an explicit finite-state machine in `internal/circuitbreaker/circuitbreaker.go`:

* **`CLOSED` (Normal Operations)**:
  * Traffic flows directly to the Primary API.
  * Every successful call resets the consecutive failure counter.
  * If consecutive failures reach `FailureThreshold` (default: 5), the breaker trips immediately to `OPEN`.
* **`OPEN` (Hostile / Degraded State)**:
  * Upstream Primary is marked unhealthy.
  * All incoming requests bypass the Primary API with zero network overhead and route straight to the Secondary Fallback API.
  * Remains in `OPEN` for a configurable cooldown `Timeout` (default: 5 seconds).
* **`HALF-OPEN` (Probing Recovery)**:
  * Once the 5s cooldown elapses, the breaker enters `HALF-OPEN`.
  * It permits a restricted trial request (`MaxHalfOpenRequests: 1`) to probe the Primary API.
  * If the trial succeeds `SuccessThreshold` consecutive times (default: 2), the breaker resets to `CLOSED`.
  * If **any** trial fails or times out, the breaker immediately trips back to `OPEN`.

### 2. Context Timeouts & Goroutine Safety
In microservice proxies, slow downstreams cause "Goroutine explosions": worker threads pile up waiting for slow sockets, exhausting memory until the container crashes (OOM).

To solve this:
1. Every call to the Primary API is wrapped in a Go context:
   ```go
   ctx, cancel := context.WithTimeout(req.Context(), 200*time.Millisecond)
   defer cancel()
   ```
2. If the Primary API exceeds 200ms, Go's runtime cancels the context (`context.DeadlineExceeded`).
3. The underlying HTTP transport closes the socket, releasing the Goroutine immediately.
4. Sentinel catches the timeout, increments the breaker's failure counter, and immediately dispatches the request to the Secondary API without the client ever receiving an error.

### 3. Enforcing the 128 MB Memory Ceiling
To ensure Sentinel never exceeds the strict 128 MB Docker memory limit under heavy loads (e.g., 2,000+ RPS):
* **No `io.ReadAll`**: Reading entire response bodies into memory creates massive heap spikes. Sentinel uses `io.CopyBuffer` with a pooled 32KB buffer (`sync.Pool`) to stream bytes directly from upstream to the client.
* **Tuned HTTP Connection Pooling**: The custom `http.Transport` reuses TCP sockets (`MaxIdleConns: 500`, `MaxIdleConnsPerHost: 250`, `IdleConnTimeout: 90s`), eliminating OS socket allocation overhead.
* **Concurrency Semaphore**: A buffered channel semaphore enforces a hard ceiling on concurrent inflight Goroutines.
* **Runtime Telemetry**: Sentinel exposes live `runtime.MemStats` (`AllocMB`, `SysMB`, `NumGoroutine`) over WebSockets so memory health can be actively monitored in the dashboard.

### 4. High-Frequency React Rendering (Zero-Lag UI)
The Go backend streams telemetry updates every 100ms (10 updates/sec). In standard React applications, triggering `setState` on every incoming WebSocket packet causes severe frame drops, UI freezes, and high CPU usage.

**The Solution:**
1. Incoming WebSocket packets are written directly into a mutable `useRef` (`latestDataRef.current = JSON.parse(event.data)`) without triggering a component re-render.
2. A `requestAnimationFrame` loop with a 50ms render throttle flushes the latest snapshot to React state at a buttery smooth 20–60 FPS.
3. This completely decouples network packet ingestion from the React rendering pipeline.

---

## 🚀 Quickstart via Docker Compose

### Prerequisites
* [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, macOS, or Linux) with Docker Compose v2+.

### 1. Launch the Entire Stack
From the project root directory, run:
```bash
docker compose up --build
```

Docker will automatically spin up:
* **React "War Room" Dashboard**: [http://localhost:3000](http://localhost:3000)
* **Sentinel Multiplexer Proxy**: [http://localhost:8080](http://localhost:8080)
* **Primary Mock API**: Port 8081 (Internal)
* **Secondary Fallback API**: [http://localhost:8082](http://localhost:8082)
* **Toxiproxy Management API**: [http://localhost:8474](http://localhost:8474)
* **Toxiproxy Upstream Port**: Port 8475 (Proxies to Primary API)

---

## ⚡ Triggering the Toxiproxy Chaos Test

To demonstrate the circuit breaker under hostile conditions, we inject **500 ms of latency** (exceeding the 200 ms timeout) and a **20% packet drop rate** into the Primary API.

### Option A: Using the React Dashboard UI (One-Click)
1. Open the War Room at [http://localhost:3000](http://localhost:3000).
2. Click **"⚡ Simulate Traffic (50 RPS)"** to start continuous requests.
3. Click **"💣 Inject Chaos (500ms Latency)"**.
4. **Watch what happens:**
   * Primary latency exceeds 200ms.
   * Sentinel context timeout cancels the slow requests.
   * Circuit Breaker trips from `CLOSED` $\to$ `OPEN`.
   * Traffic is seamlessly diverted 100% to Secondary Fallback API without any client 500 errors!
5. Click **"🛡️ Heal Primary"** to remove the chaos.
6. The breaker transitions to `HALF-OPEN`, probes the healed Primary API, and resets to `CLOSED`.

### Option B: Using Automated Terminal Scripts
* **On Windows (PowerShell):**
  ```powershell
  # Inject 500ms latency + 20% packet loss
  .\chaos\inject_chaos.ps1

  # Reset/Heal Primary API
  .\chaos\reset_chaos.ps1
  ```

* **On Linux / macOS (Bash):**
  ```bash
  # Inject chaos
  chmod +x ./chaos/*.sh
  ./chaos/inject_chaos.sh

  # Reset/Heal Primary API
  ./chaos/reset_chaos.sh
  ```

---

## 🧪 Manual Testing & Verification

### Test 1: Fast Healthy Request (Primary API)
```bash
curl -i http://localhost:8080/data
```
**Expected Response:**
```http
HTTP/1.1 200 OK
X-Sentinel-Route: PRIMARY
X-Sentinel-Circuit: CLOSED
Content-Type: application/json

{"status":"success","service":"primary-api","message":"Processed primary business transaction"}
```

### Test 2: Fallback Verification (Secondary API)
When the Primary API is down or when chaos is active:
```bash
curl -i http://localhost:8080/data
```
**Expected Response:**
```http
HTTP/1.1 200 OK
X-Sentinel-Route: SECONDARY_FALLBACK
X-Sentinel-Circuit: OPEN
Content-Type: application/json

{"status":"fallback_fulfilled","service":"secondary-api","message":"Served from secondary redundant fallback cluster"}
```

---

## 📚 Deliverables Summary
* **Source Code**: Fully modular Go proxy, custom Circuit Breaker, React War Room, and multi-stage Dockerfiles.
* **Testing Suite**: Comprehensive unit tests (`circuitbreaker_test.go`, `router_test.go`) and Toxiproxy integration tests.
* **Interview Preparation Guide**: See [INTERVIEW_PREP.md](INTERVIEW_PREP.md) for in-depth technical interview questions, architecture rationales, and model answers.
