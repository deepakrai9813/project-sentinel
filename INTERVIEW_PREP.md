# 🎓 Project Sentinel: Complete Interview Preparation & Technical Defense Guide

This document is your secret weapon. When the recruiter or engineering team asks you to walk them through your take-home assignment, this guide provides the exact terminology, engineering concepts, trade-offs, and model answers to ace the technical interview.

---

## ⚡ The 60-Second "Elevator Pitch"

When the interviewer asks:  
> *"Can you give us a quick overview of what you built for Project Sentinel?"*

### Your Answer:
> *"I built Project Sentinel, a high-performance, fault-tolerant API multiplexer and reverse proxy written in Go, paired with a real-time React observability dashboard and a containerized chaos-testing environment.*
>
> *At its core, Sentinel acts as a resilient buffer between clients and downstream microservices. If the Primary API experiences slowdowns exceeding 200 milliseconds, or starts throwing errors, Sentinel's custom zero-dependency Circuit Breaker trips to OPEN and seamlessly reroutes traffic to a Secondary fallback cluster without dropping client requests.*
>
> *Because it runs in a Docker container constrained to a hard 128 MB RAM ceiling, I engineered the Go service with strict memory controls—utilizing pooled streaming buffers, HTTP transport socket reuse, and a concurrency semaphore to prevent Goroutine leaks and OOM crashes.*
>
> *On the frontend, I built a 'War Room' dashboard in React that ingests high-frequency WebSocket metrics at 60 FPS without UI jank, and integrated Toxiproxy to simulate hostile network conditions like 500ms latency and 20% packet drops to prove the system's resilience."*

---

## 🧠 Question & Answer Deep Dives

### Category 1: Golang Concurrency & Circuit Breaker Architecture

#### Q1: "Why did you build the Circuit Breaker from scratch instead of using an existing library like Hystrix-Go or GoBreaker?"
**Model Answer:**
> *"The assignment explicitly forbade external resilience libraries, but building it from scratch also gave me full control over concurrency safety and memory overhead.*
>
> *Libraries often introduce heavy dependency trees or complex sliding-window bucketing that allocate substantial memory on the heap. By writing a bespoke Circuit Breaker using Go's `sync.RWMutex`, I implemented a lightweight finite-state machine with atomic counters and explicit state transitions (`CLOSED`, `OPEN`, and `HALF-OPEN`) that operates with near-zero allocations."*

#### Q2: "Can you explain the 3 states of your Circuit Breaker and how transitions work?"
**Model Answer:**
> * **`CLOSED` (Normal Operations)**:
>   * Traffic is routed to the Primary API.
>   * Every successful call resets the consecutive failure counter to 0.
>   * If consecutive failures (timeouts or 5xx) hit the threshold (5), the breaker trips to `OPEN`.
> * **`OPEN` (Tripped / Failure Mode)**:
>   * The Primary API is recognized as unhealthy.
>   * Incoming requests bypass the Primary API immediately without waiting or making network calls, routing directly to Secondary fallback.
>   * A cooldown timer begins (5 seconds).
> * **`HALF-OPEN` (Probing Recovery)**:
>   * After the 5s cooldown expires, the breaker enters `HALF-OPEN`.
>   * It permits limited trial requests (controlled by `maxHalfOpenRequests`) to probe the Primary API.
>   * If the trial requests succeed (2 consecutive successes), the breaker resets to `CLOSED`.
>   * If **any** trial request fails or times out, the breaker immediately trips back to `OPEN` for another cooldown cycle."*

#### Q3: "What happens if 500 concurrent requests arrive at the exact millisecond the breaker enters HALF-OPEN? How do you prevent a 'Thundering Herd'?"
**Model Answer:**
> *"If all 500 requests were allowed to probe the recovering Primary API simultaneously, they would overwhelm the struggling service—a classic Thundering Herd problem.*
>
> *In `circuitbreaker.go`, I guard the trial phase using an active trial counter (`activeHalfOpenTrials`). While in `HALF-OPEN`, only `maxHalfOpenRequests` (configured to 1) is allowed to reach the Primary API. All other concurrent requests receive `ErrTooManyRequests` and are immediately routed to the Secondary fallback until the trial request successfully completes and resets the circuit."*

#### Q4: "Why did you choose `sync.RWMutex` over a standard `sync.Mutex` or atomic values?"
**Model Answer:**
> *"In a reverse proxy handling high RPS, the vast majority of requests are read operations (`Allow()` checking if state is `CLOSED`).*
>
> *`sync.RWMutex` allows multiple Goroutines to acquire read locks (`RLock`) simultaneously without blocking each other. A write lock (`Lock`) is only acquired when recording state mutations (e.g., incrementing failures or changing states). This prevents lock contention under high concurrency while maintaining thread safety."*

---

### Category 2: Context Timeouts & Goroutine Safety

#### Q5: "How did you implement the strict 200ms timeout for the Primary API?"
**Model Answer:**
> *"I used Go's standard library context package. For every call directed to the Primary API, I derive a child context with a 200ms deadline from the incoming request's context:*
> ```go
> ctx, cancel := context.WithTimeout(req.Context(), 200*time.Millisecond)
> defer cancel()
> ```
> *I pass this context into `http.NewRequestWithContext`. If the Primary API takes 201ms, Go's runtime immediately cancels the context with `context.DeadlineExceeded`, aborts the outgoing HTTP transaction, and allows Sentinel to route to Secondary fallback within ~205ms."*

#### Q6: "What is a Goroutine leak, and how does your code ensure Goroutines don't leak on timeout?"
**Model Answer:**
> *"A Goroutine leak occurs when a Goroutine is spawned to do work (like an HTTP call) but never terminates—usually because it is blocked waiting on an unbuffered channel or an unresponsive network socket.*
>
> *In Sentinel, leaks are prevented in three ways:*
> 1. *Always calling `defer cancel()` on the timeout context so timer resources are freed as soon as the function returns.*
> 2. *Passing the context directly to `http.NewRequestWithContext`, which instructs Go's HTTP transport to abort the socket connection if the context expires.*
> 3. *Always draining and closing response bodies using `io.Copy(io.Discard, resp.Body)` and `resp.Body.Close()`, which releases the connection back to the pool rather than leaking open file descriptors."*

---

### Category 3: Memory Optimization & the 128 MB Limit

#### Q7: "Why do Go HTTP proxies often get killed by OOM (Out Of Memory) in Docker, and how did you prevent it?"
**Model Answer:**
> *"The two primary culprits for Go proxies exceeding memory limits are:*
> 1. **Unbounded Buffering with `io.ReadAll`**: Reading entire request or response payloads into byte slices allocates dynamic heap buffers. Under 1,000 RPS, thousands of multi-kilobyte buffers quickly exhaust 128 MB.
> 2. **Unbounded Goroutines**: Spawning a new Goroutine per request during an upstream slowdown causes Goroutines to stack up. Each Goroutine stack starts at ~2KB to 8KB; 20,000 piled-up Goroutines consume 100+ MB in stack space alone.
>
> *To stay well within 128 MB:*
> * *I replaced `io.ReadAll` with `io.CopyBuffer` using a reusable 32KB buffer managed by `sync.Pool`. This streams data chunks directly to the client without accumulating in memory.*
> * *I configured a custom `http.Transport` with connection pooling (`MaxIdleConns: 500`, `MaxIdleConnsPerHost: 250`, `IdleConnTimeout: 90s`) to reuse TCP connections rather than allocating new sockets per request.*
> * *I added a concurrency semaphore channel (`chan struct{}`) to cap the maximum simultaneous inflight proxy operations."*

#### Q8: "How does the interviewer know you actually stayed under 128 MB?"
**Model Answer:**
> *"In `telemetry/metrics.go`, I poll Go's runtime memory statistics via `runtime.ReadMemStats(&memStats)` and stream `AllocMB`, `SysMB`, and `NumGoroutine` over WebSockets.*
>
> *The React War Room dashboard features a live memory meter showing that Sentinel runs at approximately **8 to 15 MB of heap memory** under load—utilizing less than 12% of the 128 MB limit!"*

---

### Category 4: Frontend Performance & High-Frequency Rendering

#### Q9: "The Go backend streams dozens of updates per second over WebSockets. Why doesn't the React UI freeze or drop frames?"
**Model Answer:**
> *"In React, calling `setState` directly on every incoming WebSocket message causes dozens of re-renders per second. The browser's main JavaScript thread becomes completely blocked by React's reconciliation engine, leading to frozen animations and delayed click interactions.*
>
> *To eliminate this, I decoupled the network stream from the rendering loop:*
> 1. *When a WebSocket message arrives, it is parsed and written directly into a mutable React `useRef` (`latestDataRef.current`). This operation is synchronous, lightweight, and triggers zero re-renders.*
> 2. *I established a rendering loop driven by `requestAnimationFrame` with a 50ms throttle. The loop reads the latest snapshot from the ref and triggers a single state update at a smooth 20 to 60 FPS.*
> 3. *This guarantees that no matter how many hundreds of updates the backend sends, React only renders at the display's optimal refresh rate."*

---

### Category 5: DevOps, Docker & Chaos Engineering (Toxiproxy)

#### Q10: "Explain your multi-stage Docker build for Go. What is the advantage?"
**Model Answer:**
> *"In `backend/Dockerfile`, I implemented a two-stage build:*
> * **Stage 1 (Builder)**: Uses `golang:1.22-alpine` containing the Go compiler, SDK, and build tools (~300MB). It compiles static, standalone Go binaries with `CGO_ENABLED=0` and strips debug symbols with `-ldflags="-s -w"`.*
> * **Stage 2 (Runtime)**: Uses a clean, minimal `alpine:3.20` image (~7MB) and copies only the compiled binaries.*
>
> *This produces a secure, production-grade container image under **20 MB total**, drastically reducing attack surface and container startup latency."*

#### Q11: "How does Toxiproxy work, and what happened when you injected chaos?"
**Model Answer:**
> *"Toxiproxy is a framework built by Shopify for simulating network anomalies in TCP connections. In our Docker network, Sentinel doesn't talk directly to the Primary API; it talks to Toxiproxy on port 8475, which proxies to Primary on port 8081.*
>
> *During the chaos test, our script calls Toxiproxy's HTTP API (`:8474`) to inject two 'toxics':*
> 1. `latency`: 500 ms delay.
> 2. `loss`: 20% packet drop rate.
>
> *Because 500ms exceeds Sentinel's 200ms context timeout, the Go proxy cancels the requests, increments the failure counter, trips the Circuit Breaker to `OPEN`, and immediately switches 100% of traffic to the Secondary fallback API.*
>
> *Clients observe 0 dropped requests and 0 HTTP 500 errors throughout the entire chaos event."*

---

## 🎯 Final Checklist for Your Recruiter Demo
1. [ ] Have Docker Compose running (`docker compose up`).
2. [ ] Open Dashboard at `http://localhost:3000`.
3. [ ] Explain the 4 cards (RPS, Latency, Route Split, Memory under 128MB).
4. [ ] Click "Simulate Traffic" to show steady green state.
5. [ ] Click "Inject Chaos" to show latency spike, breaker tripping to OPEN (Red), and traffic diverting to Secondary.
6. [ ] Click "Heal Primary" to show recovery into HALF-OPEN (Yellow) and back to CLOSED (Green).
7. [ ] Point out that memory stayed under 15 MB throughout the entire demonstration!
