import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Activity, 
  Cpu, 
  Server, 
  Zap, 
  Flame, 
  RotateCcw, 
  Clock, 
  Send, 
  Layers, 
  HelpCircle, 
  X, 
  CheckCircle2, 
  Play, 
  Pause 
} from 'lucide-react';

// Design Theme Tokens based on Circuit State - Warm Carbon / Amber / Emerald / Tangerine (No Blue / Purple)
const STATE_THEMES = {
  CLOSED: {
    name: 'CLOSED',
    statusText: 'Healthy • Normal Operations',
    description: 'All traffic routes to Primary API (:8081). Resiliency buffer operational.',
    color: '#10b981',
    glow: 'rgba(16, 185, 129, 0.25)',
    bg: 'rgba(16, 185, 129, 0.08)',
    border: '#10b981',
    icon: ShieldCheck,
  },
  HALF_OPEN: {
    name: 'HALF-OPEN',
    statusText: 'Probing Recovery • Trial Mode',
    description: 'Allowing controlled trial probe to Primary API to test upstream stability.',
    color: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.25)',
    bg: 'rgba(245, 158, 11, 0.08)',
    border: '#f59e0b',
    icon: Activity,
  },
  OPEN: {
    name: 'OPEN',
    statusText: 'Primary Severed • 100% Fallback',
    description: 'Primary exceeded 200ms threshold. Bypassing upstream; routing 100% to Secondary.',
    color: '#ef4444',
    glow: 'rgba(239, 68, 68, 0.3)',
    bg: 'rgba(239, 68, 68, 0.08)',
    border: '#ef4444',
    icon: ShieldAlert,
  },
};

export default function App() {
  const [connected, setConnected] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [trafficSimulating, setTrafficSimulating] = useState(false);
  const [chaosActive, setChaosActive] = useState(false);
  const [manualResult, setManualResult] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [eventFilter, setEventFilter] = useState('all');
  const [isStreamPaused, setIsStreamPaused] = useState(false);

  // High-Frequency Render Decoupling: Ingest at network speed, render at 60 FPS
  const latestDataRef = useRef(null);
  const animationFrameRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    function connect() {
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          latestDataRef.current = JSON.parse(event.data);
        } catch (err) {
          console.error('[Sentinel UI] Parse error:', err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    // 50ms render loop (~20–60 FPS) prevents React reconciliation jank
    let lastRender = 0;
    function renderLoop(now) {
      if (now - lastRender >= 50) {
        if (latestDataRef.current && !isStreamPaused) {
          setMetrics(latestDataRef.current);
        }
        lastRender = now;
      }
      animationFrameRef.current = requestAnimationFrame(renderLoop);
    }
    animationFrameRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (socketRef.current) socketRef.current.close();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isStreamPaused]);

  // Actions
  const toggleTraffic = async () => {
    const action = trafficSimulating ? 'stop' : 'start';
    try {
      await fetch(`/api/simulate/load?action=${action}`);
      setTrafficSimulating(!trafficSimulating);
      showToast(action === 'start' ? '⚡ 50 RPS continuous client traffic started' : 'Traffic simulation paused');
    } catch (err) {
      showToast('Error toggling traffic: ' + err.message);
    }
  };

  const sendManualRequest = async () => {
    try {
      const start = performance.now();
      const res = await fetch('/data');
      const elapsed = Math.round(performance.now() - start);
      const route = res.headers.get('X-Sentinel-Route') || 'UNKNOWN';
      const circuit = res.headers.get('X-Sentinel-Circuit') || 'UNKNOWN';
      const body = await res.json().catch(() => ({}));
      
      setManualResult({
        status: res.status,
        route,
        circuit,
        elapsed,
        message: body.message || 'OK',
      });
      showToast(`Request handled by ${route} in ${elapsed}ms`);
    } catch (err) {
      showToast('Request failed: ' + err.message);
    }
  };

  const injectChaos = async () => {
    try {
      const res = await fetch('/api/chaos/inject', { method: 'POST' });
      if (res.ok) {
        setChaosActive(true);
        showToast('💣 Chaos Active: 500ms Latency + 20% Packet Drop injected');
      } else {
        throw new Error('API returned ' + res.status);
      }
    } catch (err) {
      showToast('Chaos inject failed: ' + err.message);
    }
  };

  const healChaos = async () => {
    try {
      const res = await fetch('/api/chaos/reset', { method: 'POST' });
      if (res.ok) {
        setChaosActive(false);
        showToast('🛡️ Chaos Removed: Primary API restored to ~15ms latency');
      } else {
        throw new Error('API returned ' + res.status);
      }
    } catch (err) {
      showToast('Chaos heal failed: ' + err.message);
    }
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const state = metrics?.circuit_state || 'CLOSED';
  const theme = STATE_THEMES[state] || STATE_THEMES.CLOSED;
  const StateIcon = theme.icon;
  const memory = metrics?.memory || { alloc_mb: 6.8, sys_mb: 16.4, num_goroutine: 12 };
  const memPct = Math.min(100, ((memory.alloc_mb / 128) * 100)).toFixed(1);

  // Filtered recent events for the table
  const filteredEvents = useMemo(() => {
    if (!metrics?.recent_events) return [];
    let list = metrics.recent_events.slice().reverse();
    if (eventFilter === 'primary') list = list.filter(e => e.route === 'primary');
    if (eventFilter === 'secondary') list = list.filter(e => e.route === 'secondary');
    if (eventFilter === 'timeouts') list = list.filter(e => !e.success || e.reason?.includes('timeout'));
    return list;
  }, [metrics?.recent_events, eventFilter]);

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px 24px 60px' }}>
      
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '24px',
          right: '24px',
          zIndex: 9999,
          background: 'rgba(24, 24, 27, 0.95)',
          backdropFilter: 'blur(12px)',
          border: '1px solid #f59e0b',
          color: '#fafafa',
          padding: '14px 22px',
          borderRadius: '12px',
          boxShadow: '0 20px 40px -15px rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '13px',
          fontWeight: 600,
        }}>
          <Zap size={18} color="#fbbf24" />
          {toastMessage}
        </div>
      )}

      {/* Recruiter Guide Modal */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          background: 'rgba(9, 9, 11, 0.85)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}>
          <div className="glass-card" style={{
            maxWidth: '780px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            background: '#121215',
            border: '1px solid #27272a',
            padding: '32px',
            position: 'relative',
          }}>
            <button 
              onClick={() => setIsModalOpen(false)}
              className="clickable"
              style={{
                position: 'absolute',
                top: '24px',
                right: '24px',
                background: 'rgba(255,255,255,0.06)',
                border: 'none',
                color: '#a1a1aa',
                borderRadius: '8px',
                padding: '6px',
              }}
            >
              <X size={20} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <HelpCircle size={24} color="#fbbf24" />
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#fafafa' }}>
                Recruiter Demo & Technical Defense Guide
              </h2>
            </div>
            <p style={{ fontSize: '13px', color: '#a1a1aa', marginBottom: '24px' }}>
              Use this script to deliver an unforgettable 3-minute demonstration to your interviewer.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Step 1 */}
              <div style={{ background: '#18181b', padding: '16px', borderRadius: '12px', border: '1px solid #27272a' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: '#10b981', fontSize: '14px' }}>
                  <CheckCircle2 size={18} /> Step 1: Explain The Architecture (60 seconds)
                </div>
                <p style={{ fontSize: '13px', color: '#d4d4d8', marginTop: '6px', lineHeight: 1.5 }}>
                  "Project Sentinel sits between clients and microservices. It multiplexes incoming requests with a custom zero-dependency Circuit Breaker in Go. It operates with a strict 200ms context timeout on the Primary API. Under load, it enforces a 128 MB RAM ceiling using pooled streaming buffers and socket reuse."
                </p>
              </div>

              {/* Step 2 */}
              <div style={{ background: '#18181b', padding: '16px', borderRadius: '12px', border: '1px solid #27272a' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: '#f59e0b', fontSize: '14px' }}>
                  <Flame size={18} /> Step 2: Trigger Live Toxiproxy Chaos
                </div>
                <p style={{ fontSize: '13px', color: '#d4d4d8', marginTop: '6px', lineHeight: 1.5 }}>
                  "Click <strong>'Simulate Traffic'</strong> (50 RPS) to establish normal green flow. Then click <strong>'Inject Chaos'</strong>. Toxiproxy injects 500ms latency and 20% packet drop. Point out that Sentinel cancels requests at 200ms, trips the breaker to <strong>OPEN</strong>, and diverts 100% to Secondary fallback with <strong>zero client 500 errors</strong>."
                </p>
              </div>

              {/* Step 3 */}
              <div style={{ background: '#18181b', padding: '16px', borderRadius: '12px', border: '1px solid #27272a' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: '#fbbf24', fontSize: '14px' }}>
                  <RotateCcw size={18} /> Step 3: Show Automatic Recovery
                </div>
                <p style={{ fontSize: '13px', color: '#d4d4d8', marginTop: '6px', lineHeight: 1.5 }}>
                  "Click <strong>'Heal Primary'</strong>. Explain that after the 5s cooldown, Sentinel enters <strong>HALF-OPEN</strong>, tests the healed service with trial requests, and cleanly resets back to <strong>CLOSED</strong>."
                </p>
              </div>

              {/* Step 4: Talking points */}
              <div style={{ background: 'rgba(245, 158, 11, 0.06)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                <div style={{ fontWeight: 700, color: '#fbbf24', fontSize: '13px', marginBottom: '8px' }}>
                  💡 Top Interview Talking Points:
                </div>
                <ul style={{ fontSize: '12px', color: '#d4d4d8', paddingLeft: '20px', lineHeight: 1.6 }}>
                  <li><strong>Memory Limit (128 MB)</strong>: Highlight that the dashboard proves Sentinel runs at ~8–15 MB RAM using <code>io.CopyBuffer</code> and <code>sync.Pool</code>.</li>
                  <li><strong>Concurrency Safety</strong>: Custom circuit breaker uses <code>sync.RWMutex</code> so read checks (99.9% of traffic) never block each other.</li>
                  <li><strong>React Performance</strong>: Decoupled WebSockets with <code>useRef</code> + <code>requestAnimationFrame</code> 50ms throttle prevents browser freezing.</li>
                </ul>
              </div>
            </div>

            <div style={{ marginTop: '24px', textAlign: 'right' }}>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="clickable"
                style={{
                  background: '#f59e0b',
                  color: '#09090b',
                  border: 'none',
                  padding: '10px 24px',
                  borderRadius: '8px',
                  fontWeight: 800,
                  fontSize: '13px',
                }}
              >
                Got It, Let's Demo!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modern Executive Header */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: '24px',
        marginBottom: '24px',
        borderBottom: '1px solid var(--border-subtle)',
        flexWrap: 'wrap',
        gap: '20px',
      }}>
        {/* Brand identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 24px rgba(245, 158, 11, 0.4)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
          }}>
            <Server size={26} color="#09090b" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-0.03em', color: '#fafafa' }}>
                PROJECT SENTINEL
              </h1>
              <span style={{
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.08em',
                padding: '3px 10px',
                borderRadius: '6px',
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#fbbf24',
                border: '1px solid rgba(245, 158, 11, 0.3)',
              }}>
                WAR ROOM HUD
              </span>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '3px' }}>
              High-Performance API Multiplexer • Custom Circuit Breaker • 128 MB Memory Budget
            </p>
          </div>
        </div>

        {/* Header Right Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          {/* Live WebSocket Status Pill */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--bg-glass)',
            padding: '8px 16px',
            borderRadius: '10px',
            border: '1px solid var(--border-subtle)',
            fontSize: '12px',
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: connected ? '#10b981' : '#ef4444',
              boxShadow: connected ? '0 0 10px #10b981' : '0 0 10px #ef4444',
            }} />
            <span style={{ color: connected ? '#10b981' : '#ef4444', fontWeight: 700 }}>
              {connected ? 'Live Telemetry' : 'Connecting...'}
            </span>
          </div>

          {/* RAM Ceiling Tag */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--bg-glass)',
            padding: '8px 16px',
            borderRadius: '10px',
            border: '1px solid var(--border-subtle)',
            fontSize: '12px',
          }}>
            <Cpu size={15} color="#f59e0b" />
            <span style={{ color: 'var(--text-dim)' }}>RAM:</span>
            <span className="font-mono" style={{ fontWeight: 700, color: '#fafafa' }}>
              {memory.alloc_mb.toFixed(1)} MB
            </span>
            <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>/ 128MB</span>
          </div>

          {/* Interviewer Guide Button */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="clickable"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              color: '#fbbf24',
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: 700,
            }}
          >
            <HelpCircle size={16} />
            Recruiter Demo Guide
          </button>
        </div>
      </header>

      {/* Control Deck Bento Bar */}
      <section className="glass-card" style={{
        padding: '20px 24px',
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '20px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 800, color: '#fafafa', letterSpacing: '0.02em' }}>
              INTERACTIVE CHAOS & LOAD CONTROL DECK
            </span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Trigger 50 RPS traffic or inject Toxiproxy latency to demonstrate automatic fallback in real time.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Traffic Simulator Button */}
          <button
            onClick={toggleTraffic}
            className="clickable"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 18px',
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: 700,
              border: trafficSimulating ? '1px solid #f59e0b' : '1px solid #3f3f46',
              background: trafficSimulating ? 'rgba(245, 158, 11, 0.2)' : '#18181b',
              color: trafficSimulating ? '#fbbf24' : '#fafafa',
              boxShadow: trafficSimulating ? '0 0 20px rgba(245, 158, 11, 0.25)' : 'none',
              transition: 'all 0.2s ease',
            }}
          >
            <Zap size={16} />
            {trafficSimulating ? 'Stop Traffic Load' : '⚡ Simulate Traffic (50 RPS)'}
          </button>

          {/* Chaos Injection Button */}
          {!chaosActive ? (
            <button
              onClick={injectChaos}
              className="clickable"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 18px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 700,
                border: '1px solid #ef4444',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                boxShadow: '0 0 20px rgba(239, 68, 68, 0.15)',
                transition: 'all 0.2s ease',
              }}
            >
              <Flame size={16} />
              💣 Inject Chaos (500ms Latency)
            </button>
          ) : (
            <button
              onClick={healChaos}
              className="clickable"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 18px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 700,
                border: '1px solid #10b981',
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#34d399',
                boxShadow: '0 0 20px rgba(16, 185, 129, 0.2)',
                transition: 'all 0.2s ease',
              }}
            >
              <RotateCcw size={16} />
              🛡️ Heal Primary (Restore 15ms)
            </button>
          )}

          {/* Single Probe Button */}
          <button
            onClick={sendManualRequest}
            className="clickable"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: 600,
              border: '1px solid #27272a',
              background: '#18181b',
              color: '#d4d4d8',
            }}
          >
            <Send size={14} />
            Test 1 Probe
          </button>
        </div>
      </section>

      {/* Manual Probe Result Card */}
      {manualResult && (
        <section className="glass-card" style={{
          padding: '16px 20px',
          marginBottom: '24px',
          background: '#18181b',
          border: '1px solid #27272a',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-dim)', fontWeight: 700 }}>LAST PROBE:</span>
            <span style={{
              fontSize: '12px',
              padding: '3px 8px',
              borderRadius: '6px',
              fontWeight: 700,
              background: manualResult.route === 'primary' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(249, 115, 22, 0.15)',
              color: manualResult.route === 'primary' ? '#10b981' : '#f97316',
              border: `1px solid ${manualResult.route === 'primary' ? '#10b981' : '#f97316'}`,
            }}>
              ROUTE: {manualResult.route.toUpperCase()}
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Circuit: <strong style={{ color: '#fafafa' }}>{manualResult.circuit}</strong>
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Latency: <strong className="font-mono" style={{ color: '#fbbf24' }}>{manualResult.elapsed} ms</strong>
            </span>
          </div>
          <button 
            onClick={() => setManualResult(null)}
            className="clickable"
            style={{ background: 'transparent', border: 'none', color: '#71717a', fontSize: '12px' }}
          >
            Clear
          </button>
        </section>
      )}

      {/* Bento Tier 1: State Machine Card + SVG Network Topology */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(340px, 1fr) 2fr',
        gap: '24px',
        marginBottom: '24px',
      }}>
        {/* State Machine Status Card */}
        <div className="glass-card" style={{
          padding: '28px',
          border: `2px solid ${theme.border}`,
          boxShadow: `0 0 32px ${theme.glow}`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-dim)' }}>
                CIRCUIT BREAKER STATE
              </span>
              <span style={{
                fontSize: '11px',
                fontWeight: 800,
                padding: '3px 8px',
                borderRadius: '6px',
                background: theme.bg,
                color: theme.color,
                border: `1px solid ${theme.border}`,
              }}>
                FROM SCRATCH
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '18px', marginTop: '24px' }}>
              <div style={{
                width: '68px',
                height: '68px',
                borderRadius: '18px',
                background: theme.bg,
                border: `2px solid ${theme.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 0 20px ${theme.glow}`,
              }}>
                <StateIcon size={38} color={theme.color} />
              </div>
              <div>
                <h2 style={{ fontSize: '34px', fontWeight: 900, color: theme.color, letterSpacing: '-0.03em' }}>
                  {theme.name}
                </h2>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#e4e4e7', marginTop: '2px' }}>
                  {theme.statusText}
                </div>
              </div>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '14px', lineHeight: 1.5 }}>
              {theme.description}
            </p>
          </div>

          {/* Counters Grid */}
          <div style={{
            marginTop: '28px',
            paddingTop: '20px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '12px',
            textAlign: 'center',
          }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 700 }}>FAILURES</div>
              <div className="font-mono" style={{ fontSize: '22px', fontWeight: 800, color: state === 'OPEN' ? '#ef4444' : '#fafafa', marginTop: '4px' }}>
                {metrics?.circuit_snapshot?.consecutive_failures || 0}
                <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>/5</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 700 }}>PROBES</div>
              <div className="font-mono" style={{ fontSize: '22px', fontWeight: 800, color: '#10b981', marginTop: '4px' }}>
                {metrics?.circuit_snapshot?.consecutive_successes || 0}
                <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{state === 'HALF_OPEN' ? '/2' : ''}</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 700 }}>
                {state === 'OPEN' ? 'COOLDOWN' : 'TIMEOUT'}
              </div>
              <div className="font-mono" style={{ fontSize: '22px', fontWeight: 800, color: '#fbbf24', marginTop: '4px' }}>
                {state === 'OPEN' 
                  ? `${Math.max(0, Math.round((metrics?.circuit_snapshot?.timeout_remaining_ms || 0) / 1000))}s`
                  : '200ms'
                }
              </div>
            </div>
          </div>
        </div>

        {/* SVG Network Topology Canvas */}
        <div className="glass-card" style={{
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-dim)' }}>
              LIVE NETWORK TOPOLOGY & ACTIVE LASER PATH
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Dispatched Route: <strong style={{ color: state === 'CLOSED' ? '#10b981' : '#f97316' }}>
                {state === 'CLOSED' ? 'Primary API (:8081)' : 'Secondary Fallback (:8082)'}
              </strong>
            </span>
          </div>

          {/* Real Interactive SVG Path Diagram - Zero Blue/Purple */}
          <div style={{
            background: '#121215',
            borderRadius: '14px',
            border: '1px solid #27272a',
            padding: '20px',
            position: 'relative',
          }}>
            <svg viewBox="0 0 800 240" style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
              {/* Path 1: Client to Sentinel (Direct Line) */}
              <line 
                x1="120" y1="120" 
                x2="280" y2="120" 
                stroke="#f59e0b" 
                strokeWidth="3" 
                strokeDasharray="6,6"
                className={trafficSimulating ? 'laser-active' : ''}
              />

              {/* Path 2: Sentinel to Primary (Upper Curved Arc) */}
              <path 
                d="M 400 120 C 470 120, 500 50, 620 50" 
                fill="none" 
                stroke={state === 'OPEN' ? '#ef4444' : '#10b981'} 
                strokeWidth={state === 'OPEN' ? '2' : '3'}
                strokeDasharray={state === 'OPEN' ? '4,4' : '8,8'}
                className={state === 'CLOSED' && trafficSimulating ? 'laser-active' : ''}
                opacity={state === 'OPEN' ? 0.35 : 1}
              />

              {/* Path 3: Sentinel to Secondary Fallback (Lower Curved Arc) */}
              <path 
                d="M 400 120 C 470 120, 500 190, 620 190" 
                fill="none" 
                stroke={state !== 'CLOSED' ? '#f97316' : '#3f3f46'} 
                strokeWidth={state !== 'CLOSED' ? '3' : '2'}
                strokeDasharray="8,8"
                className={state !== 'CLOSED' && trafficSimulating ? 'laser-active' : ''}
                opacity={state !== 'CLOSED' ? 1 : 0.35}
              />

              {/* Barrier marker on Primary when OPEN */}
              {state === 'OPEN' && (
                <g transform="translate(500, 75)">
                  <circle cx="0" cy="0" r="14" fill="#ef4444" />
                  <line x1="-6" y1="-6" x2="6" y2="6" stroke="#fff" strokeWidth="3" />
                  <line x1="6" y1="-6" x2="-6" y2="6" stroke="#fff" strokeWidth="3" />
                </g>
              )}

              {/* Node 1: Client Node */}
              <g transform="translate(40, 80)">
                <rect width="110" height="80" rx="10" fill="#18181b" stroke="#3f3f46" strokeWidth="2" />
                <text x="55" y="36" textAnchor="middle" fill="#fbbf24" fontSize="13" fontWeight="bold">Clients</text>
                <text x="55" y="56" textAnchor="middle" fill="#a1a1aa" fontSize="10">{metrics?.rps || 0} RPS</text>
              </g>

              {/* Node 2: Sentinel Proxy Node */}
              <g transform="translate(280, 70)">
                <rect 
                  width="130" height="100" rx="14" 
                  fill="#18181b" 
                  stroke={theme.border} 
                  strokeWidth="2.5" 
                  filter="drop-shadow(0 0 10px rgba(245, 158, 11, 0.2))" 
                />
                <text x="65" y="42" textAnchor="middle" fill={theme.color} fontSize="14" fontWeight="900">Sentinel</text>
                <text x="65" y="62" textAnchor="middle" fill="#d4d4d8" fontSize="11">Proxy :8080</text>
                <text x="65" y="82" textAnchor="middle" fill="#71717a" fontSize="10">200ms Timeout</text>
              </g>

              {/* Node 3: Primary API (Top Right) */}
              <g transform="translate(620, 15)">
                <rect 
                  width="140" height="70" rx="10" 
                  fill={state === 'CLOSED' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.08)'} 
                  stroke={state === 'CLOSED' ? '#10b981' : '#ef4444'} 
                  strokeWidth="2" 
                />
                <text x="70" y="32" textAnchor="middle" fill={state === 'CLOSED' ? '#34d399' : '#f87171'} fontSize="13" fontWeight="bold">
                  Primary API
                </text>
                <text x="70" y="52" textAnchor="middle" fill="#a1a1aa" fontSize="10">
                  {chaosActive ? '⚠️ Hostile (500ms)' : '⚡ Fast (~15ms)'}
                </text>
              </g>

              {/* Node 4: Secondary Fallback API (Bottom Right) */}
              <g transform="translate(620, 155)">
                <rect 
                  width="140" height="70" rx="10" 
                  fill={state !== 'CLOSED' ? 'rgba(249, 115, 22, 0.15)' : '#18181b'} 
                  stroke={state !== 'CLOSED' ? '#f97316' : '#27272a'} 
                  strokeWidth="2" 
                />
                <text x="70" y="32" textAnchor="middle" fill={state !== 'CLOSED' ? '#fb923c' : '#71717a'} fontSize="13" fontWeight="bold">
                  Secondary API
                </text>
                <text x="70" y="52" textAnchor="middle" fill="#71717a" fontSize="10">
                  Fallback Cluster :8082
                </text>
              </g>
            </svg>
          </div>
        </div>
      </div>

      {/* Bento Tier 2: 4 Telemetry Metrics Cards */}
      <section style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '20px',
        marginBottom: '24px',
      }}>
        {/* Metric 1: Throughput */}
        <div className="glass-card" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)' }}>CURRENT THROUGHPUT</span>
            <Activity size={18} color="#10b981" />
          </div>
          <div className="font-mono" style={{ fontSize: '32px', fontWeight: 800, marginTop: '8px', color: '#fafafa' }}>
            {metrics?.rps || 0} <span style={{ fontSize: '14px', color: 'var(--text-dim)', fontWeight: 600 }}>req/s</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Total Processed: <strong className="font-mono" style={{ color: '#fafafa' }}>{(metrics?.total_requests || 0).toLocaleString()}</strong>
          </div>
        </div>

        {/* Metric 2: Average Latency */}
        <div className="glass-card" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)' }}>AVERAGE LATENCY</span>
            <Clock size={18} color="#fbbf24" />
          </div>
          <div className="font-mono" style={{
            fontSize: '32px',
            fontWeight: 800,
            marginTop: '8px',
            color: (metrics?.avg_latency_ms || 0) > 150 ? '#ef4444' : '#10b981',
          }}>
            {(metrics?.avg_latency_ms || 0).toFixed(1)} <span style={{ fontSize: '14px', color: 'var(--text-dim)' }}>ms</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Context Timeout Threshold: <strong style={{ color: '#fafafa' }}>200 ms</strong>
          </div>
        </div>

        {/* Metric 3: Route Split Breakdown */}
        <div className="glass-card" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)' }}>ROUTE DISTRIBUTION</span>
            <Layers size={18} color="#f97316" />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', marginTop: '8px' }}>
            <div>
              <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 700 }}>PRIMARY: </span>
              <span className="font-mono" style={{ fontSize: '20px', fontWeight: 800, color: '#34d399' }}>{(metrics?.primary_requests || 0).toLocaleString()}</span>
            </div>
            <div>
              <span style={{ fontSize: '11px', color: '#f97316', fontWeight: 700 }}>FALLBACK: </span>
              <span className="font-mono" style={{ fontSize: '20px', fontWeight: 800, color: '#fb923c' }}>{(metrics?.secondary_requests || 0).toLocaleString()}</span>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Primary Success Ratio: <strong style={{ color: '#fafafa' }}>{(metrics?.primary_success_rate || 100).toFixed(1)}%</strong>
          </div>
        </div>

        {/* Metric 4: 128 MB Memory Ceiling Proof */}
        <div className="glass-card" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)' }}>CONTAINER MEMORY (128 MB)</span>
            <Cpu size={18} color="#f59e0b" />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '8px' }}>
            <span className="font-mono" style={{ fontSize: '32px', fontWeight: 800, color: '#fbbf24' }}>
              {memory.alloc_mb.toFixed(1)}
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
              MB ({memPct}% of 128MB)
            </span>
          </div>
          {/* Progress Bar */}
          <div style={{ width: '100%', height: '6px', background: '#27272a', borderRadius: '3px', marginTop: '10px', overflow: 'hidden' }}>
            <div style={{
              width: `${memPct}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #10b981 0%, #f59e0b 70%, #f97316 100%)',
              transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '8px' }}>
            Active Goroutines: <strong style={{ color: '#fafafa' }}>{memory.num_goroutine}</strong> • Sys: <strong>{memory.sys_mb.toFixed(1)} MB</strong>
          </div>
        </div>
      </section>

      {/* Bento Tier 3: Telemetry Stream Table with UI/UX Filters */}
      <section className="glass-card" style={{ padding: '24px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '16px',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '14px', fontWeight: 800, color: '#fafafa', letterSpacing: '0.04em' }}>
                REAL-TIME ROUTE TELEMETRY STREAM
              </span>
              <span style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '4px',
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#fbbf24',
                fontWeight: 700,
              }}>
                60 FPS THROTTLED
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '3px' }}>
              Live packet decisions streamed from Go backend via WebSockets
            </p>
          </div>

          {/* Filters & Pause Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {['all', 'primary', 'secondary', 'timeouts'].map((f) => (
              <button
                key={f}
                onClick={() => setEventFilter(f)}
                className="clickable"
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  border: eventFilter === f ? '1px solid #f59e0b' : '1px solid #27272a',
                  background: eventFilter === f ? 'rgba(245, 158, 11, 0.15)' : '#18181b',
                  color: eventFilter === f ? '#fbbf24' : '#a1a1aa',
                }}
              >
                {f}
              </button>
            ))}

            <button
              onClick={() => setIsStreamPaused(!isStreamPaused)}
              className="clickable"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                border: '1px solid #27272a',
                background: isStreamPaused ? '#f59e0b' : '#18181b',
                color: isStreamPaused ? '#09090b' : '#a1a1aa',
                marginLeft: '6px',
              }}
            >
              {isStreamPaused ? <Play size={12} /> : <Pause size={12} />}
              {isStreamPaused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>

        {/* Event Log Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #27272a', color: 'var(--text-dim)' }}>
                <th style={{ padding: '12px 14px' }}>TIMESTAMP</th>
                <th style={{ padding: '12px 14px' }}>DISPATCHED ROUTE</th>
                <th style={{ padding: '12px 14px' }}>HTTP STATUS</th>
                <th style={{ padding: '12px 14px' }}>LATENCY</th>
                <th style={{ padding: '12px 14px' }}>DIAGNOSTIC REASON</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.length > 0 ? (
                filteredEvents.map((event, idx) => (
                  <tr key={idx} style={{
                    borderBottom: '1px solid #27272a',
                    background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  }}>
                    <td className="font-mono" style={{ padding: '10px 14px', color: 'var(--text-dim)' }}>
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {event.route === 'primary' ? (
                        <span style={{
                          padding: '3px 10px',
                          borderRadius: '6px',
                          background: 'rgba(16, 185, 129, 0.15)',
                          color: '#34d399',
                          fontWeight: 700,
                          fontSize: '11px',
                        }}>
                          PRIMARY API
                        </span>
                      ) : (
                        <span style={{
                          padding: '3px 10px',
                          borderRadius: '6px',
                          background: 'rgba(249, 115, 22, 0.15)',
                          color: '#fb923c',
                          fontWeight: 700,
                          fontSize: '11px',
                        }}>
                          SECONDARY FALLBACK
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: event.status === 200 ? '#10b981' : '#ef4444' }}>
                      {event.status || 'TIMEOUT'}
                    </td>
                    <td className="font-mono" style={{ padding: '10px 14px' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: event.duration_ms > 150 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.12)',
                        color: event.duration_ms > 150 ? '#ef4444' : '#fbbf24',
                        fontWeight: 600,
                      }}>
                        {event.duration_ms.toFixed(1)} ms
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>
                      {event.success ? (
                        <span style={{ color: '#10b981' }}>Fulfilled seamlessly</span>
                      ) : (
                        <span style={{ color: '#ef4444', fontWeight: 600 }}>
                          {event.reason === 'timeout_200ms' ? 'Context Timeout (>200ms) → Tripped Fallback' : event.reason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" style={{ padding: '36px', textAlign: 'center', color: 'var(--text-dim)' }}>
                    No events match current filter. Click <strong>"⚡ Simulate Traffic"</strong> or <strong>"Test 1 Probe"</strong> above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
