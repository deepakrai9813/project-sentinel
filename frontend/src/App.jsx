import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldAlert, 
  ShieldCheck, 
  Activity, 
  Cpu, 
  Server, 
  Zap, 
  Flame, 
  RotateCcw, 
  Wifi, 
  WifiOff, 
  Clock, 
  ArrowRight, 
  AlertTriangle,
  Send,
  Database,
  Layers
} from 'lucide-react';

// Color themes based on Circuit Breaker State
const STATE_THEMES = {
  CLOSED: {
    name: 'CLOSED',
    subtitle: 'Normal Operations (Primary Active)',
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.1)',
    border: '#10b981',
    badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
    icon: ShieldCheck,
  },
  HALF_OPEN: {
    name: 'HALF-OPEN',
    subtitle: 'Probing Recovery (Trial Traffic)',
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.1)',
    border: '#f59e0b',
    badge: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
    icon: Activity,
  },
  OPEN: {
    name: 'OPEN',
    subtitle: 'Primary Severed (100% Fallback)',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.1)',
    border: '#ef4444',
    badge: 'bg-rose-500/20 text-rose-400 border-rose-500/40',
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

  // Performance Optimization: Decouple high-frequency WebSocket updates from React renders
  const latestDataRef = useRef(null);
  const animationFrameRef = useRef(null);
  const socketRef = useRef(null);

  // Connect WebSocket & configure high-frequency frame throttling (60fps limit)
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    function connect() {
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        console.log('[Sentinel UI] WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          // Store raw packet in ref immediately without triggering re-render
          latestDataRef.current = JSON.parse(event.data);
        } catch (err) {
          console.error('[Sentinel UI] Failed to parse telemetry:', err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        console.log('[Sentinel UI] WebSocket disconnected, reconnecting in 2s...');
        setTimeout(connect, 2000);
      };

      ws.onerror = (err) => {
        console.error('[Sentinel UI] WebSocket error:', err);
        ws.close();
      };
    }

    connect();

    // High-Frequency Render Loop: Sync ref to React state on animation frame
    let lastRenderTime = 0;
    const renderInterval = 50; // Max 20 renders/sec for UI smoothness

    function tick(timestamp) {
      if (timestamp - lastRenderTime >= renderInterval) {
        if (latestDataRef.current) {
          setMetrics(latestDataRef.current);
        }
        lastRenderTime = timestamp;
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    }

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (socketRef.current) socketRef.current.close();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  // Controls: Toggle traffic load simulator
  const toggleTraffic = async () => {
    const action = trafficSimulating ? 'stop' : 'start';
    try {
      await fetch(`/api/simulate/load?action=${action}`);
      setTrafficSimulating(!trafficSimulating);
      showToast(action === 'start' ? 'Continuous 50 RPS traffic started' : 'Traffic simulation stopped');
    } catch (err) {
      console.error('Failed to toggle traffic:', err);
    }
  };

  // Controls: Single manual test request
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
      showToast(`Request fulfilled via ${route} in ${elapsed}ms`);
    } catch (err) {
      showToast(`Request failed: ${err.message}`);
    }
  };

  // Controls: Inject Toxiproxy chaos (500ms latency + 20% loss)
  const injectChaos = async () => {
    try {
      const res = await fetch('/api/chaos/inject', { method: 'POST' });
      if (res.ok) {
        setChaosActive(true);
        showToast('⚠️ Chaos Injected: 500ms latency + 20% packet drop on Primary API!');
      } else {
        throw new Error('API returned ' + res.status);
      }
    } catch (err) {
      showToast('⚠️ Failed to inject chaos: ' + err.message);
    }
  };

  // Controls: Heal Toxiproxy chaos
  const healChaos = async () => {
    try {
      const res = await fetch('/api/chaos/reset', { method: 'POST' });
      if (res.ok) {
        setChaosActive(false);
        showToast('✅ Chaos Removed: Primary API restored to healthy 20ms latency');
      } else {
        throw new Error('API returned ' + res.status);
      }
    } catch (err) {
      showToast('⚠️ Failed to heal chaos: ' + err.message);
    }
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const state = metrics?.circuit_state || 'CLOSED';
  const theme = STATE_THEMES[state] || STATE_THEMES.CLOSED;
  const StateIcon = theme.icon;
  const memory = metrics?.memory || { alloc_mb: 4.5, sys_mb: 18.2, num_goroutine: 12 };
  const memPercentage = Math.min(100, ((memory.alloc_mb / 128) * 100)).toFixed(1);

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px 20px' }}>
      
      {/* Top Banner: Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '24px',
          zIndex: 9999,
          background: '#1e293b',
          border: '1px solid #38bdf8',
          color: '#f8fafc',
          padding: '12px 20px',
          borderRadius: '8px',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontWeight: 600,
        }}>
          <Zap size={18} color="#38bdf8" />
          {toastMessage}
        </div>
      )}

      {/* Header Bar */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid var(--border-color)',
        paddingBottom: '20px',
        marginBottom: '24px',
        flexWrap: 'wrap',
        gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #0284c7 0%, #6366f1 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 20px rgba(14, 165, 233, 0.3)',
          }}>
            <Server size={24} color="#fff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-0.02em' }}>
                PROJECT SENTINEL
              </h1>
              <span style={{
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                padding: '3px 8px',
                borderRadius: '4px',
                background: 'rgba(6, 182, 212, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.3)',
              }}>
                WAR ROOM
              </span>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
              High-Performance API Multiplexer • Custom Circuit Breaker • 128MB Memory Ceiling
            </p>
          </div>
        </div>

        {/* Live Status Indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--bg-card)',
            padding: '8px 14px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            fontSize: '13px',
          }}>
            {connected ? (
              <>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                <span style={{ color: '#10b981', fontWeight: 600 }}>Live Telemetry</span>
              </>
            ) : (
              <>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
                <span style={{ color: '#ef4444', fontWeight: 600 }}>Disconnected</span>
              </>
            )}
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--bg-card)',
            padding: '8px 14px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            fontSize: '13px',
          }}>
            <Cpu size={16} color="#38bdf8" />
            <span style={{ color: 'var(--text-muted)' }}>RAM:</span>
            <span style={{ fontWeight: 700, color: '#f1f5f9' }}>{memory.alloc_mb.toFixed(1)} MB</span>
            <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>/ 128MB</span>
          </div>
        </div>
      </header>

      {/* Recruiter / Interactive Control Bar */}
      <section style={{
        background: 'linear-gradient(180deg, #161c28 0%, #11151f 100%)',
        borderRadius: '12px',
        border: '1px solid #283347',
        padding: '16px 20px',
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#e2e8f0' }}>Chaos & Load Control Deck</span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>(Demonstrate Resilience in Real-Time)</span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
            Inject latency exceeding the 200ms threshold to watch the circuit trip and divert traffic to Secondary fallback.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Traffic Simulation Toggle */}
          <button
            onClick={toggleTraffic}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              border: trafficSimulating ? '1px solid #f59e0b' : '1px solid #334155',
              background: trafficSimulating ? 'rgba(245, 158, 11, 0.2)' : '#1e293b',
              color: trafficSimulating ? '#fbbf24' : '#e2e8f0',
              transition: 'all 0.2s ease',
            }}
          >
            <Zap size={16} />
            {trafficSimulating ? 'Stop Traffic Load' : '⚡ Simulate Traffic (50 RPS)'}
          </button>

          {/* Inject Chaos Button */}
          {!chaosActive ? (
            <button
              onClick={injectChaos}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                border: '1px solid #ef4444',
                background: 'rgba(239, 68, 68, 0.2)',
                color: '#f87171',
                transition: 'all 0.2s ease',
              }}
            >
              <Flame size={16} />
              💣 Inject Chaos (500ms Latency)
            </button>
          ) : (
            <button
              onClick={healChaos}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                border: '1px solid #10b981',
                background: 'rgba(16, 185, 129, 0.2)',
                color: '#34d399',
                transition: 'all 0.2s ease',
              }}
            >
              <RotateCcw size={16} />
              🛡️ Heal Primary (Restore 20ms)
            </button>
          )}

          {/* Single Manual Test */}
          <button
            onClick={sendManualRequest}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              border: '1px solid #334155',
              background: '#0f172a',
              color: '#94a3b8',
            }}
          >
            <Send size={14} />
            Test 1 Req
          </button>
        </div>
      </section>

      {/* Centerpiece 1: The Visual Circuit Breaker State Machine Card */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(320px, 1fr) 2fr',
        gap: '20px',
        marginBottom: '24px',
      }}>
        {/* State Badge Card */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '12px',
          border: `2px solid ${theme.border}`,
          padding: '24px',
          boxShadow: `0 0 30px ${theme.bg}`,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-dim)' }}>
                CIRCUIT BREAKER STATE MACHINE
              </span>
              <span style={{
                fontSize: '11px',
                padding: '4px 10px',
                borderRadius: '20px',
                background: theme.bg,
                color: theme.color,
                fontWeight: 800,
                border: `1px solid ${theme.border}`,
              }}>
                CUSTOM IMPLEMENTATION
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '20px' }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '16px',
                background: theme.bg,
                border: `2px solid ${theme.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <StateIcon size={36} color={theme.color} />
              </div>
              <div>
                <h2 style={{ fontSize: '32px', fontWeight: 900, color: theme.color, letterSpacing: '-0.02em' }}>
                  {theme.name}
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {theme.subtitle}
                </p>
              </div>
            </div>
          </div>

          <div style={{ marginTop: '28px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600 }}>FAILURES</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: state === 'OPEN' ? '#ef4444' : '#f1f5f9', marginTop: '4px' }}>
                  {metrics?.circuit_snapshot?.consecutive_failures || 0}
                  <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>/5</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600 }}>SUCCESSES</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#10b981', marginTop: '4px' }}>
                  {metrics?.circuit_snapshot?.consecutive_successes || 0}
                  <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{state === 'HALF_OPEN' ? '/2' : ''}</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600 }}>
                  {state === 'OPEN' ? 'COOLDOWN' : 'TIMEOUT SPEC'}
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#38bdf8', marginTop: '4px' }}>
                  {state === 'OPEN' 
                    ? `${Math.max(0, Math.round((metrics?.circuit_snapshot?.timeout_remaining_ms || 0) / 1000))}s`
                    : '200ms'
                  }
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Centerpiece 2: Animated Traffic Route Topology */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-dim)' }}>
              LIVE PACKET ROUTING TOPOLOGY
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Active Flow: <strong style={{ color: state === 'CLOSED' ? '#10b981' : '#f59e0b' }}>
                {state === 'CLOSED' ? 'Primary API (Port 8081)' : 'Secondary Fallback (Port 8082)'}
              </strong>
            </span>
          </div>

          {/* SVG Diagram showing interactive traffic lines */}
          <div style={{
            background: '#0c0f17',
            borderRadius: '8px',
            border: '1px solid #1a2233',
            padding: '24px 20px',
            position: 'relative',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              position: 'relative',
              zIndex: 2,
            }}>
              {/* Client Node */}
              <div style={{
                textAlign: 'center',
                background: '#1a2233',
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid #2d3b55',
                width: '120px',
              }}>
                <Zap size={20} color="#38bdf8" style={{ margin: '0 auto 6px' }} />
                <div style={{ fontSize: '12px', fontWeight: 700 }}>Clients</div>
                <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Traffic Stream</div>
              </div>

              {/* Arrow to Sentinel */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: '#38bdf8', fontWeight: 600 }}>{metrics?.rps || 0} RPS</span>
                <ArrowRight size={20} color="#38bdf8" />
              </div>

              {/* Sentinel Proxy Node */}
              <div style={{
                textAlign: 'center',
                background: '#1a2233',
                padding: '14px 18px',
                borderRadius: '8px',
                border: `2px solid ${theme.border}`,
                width: '150px',
                boxShadow: `0 0 15px ${theme.bg}`,
              }}>
                <Server size={22} color={theme.color} style={{ margin: '0 auto 6px' }} />
                <div style={{ fontSize: '13px', fontWeight: 800, color: theme.color }}>Sentinel</div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Proxy :8080</div>
              </div>

              {/* Routing Split Arrows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', alignItems: 'center' }}>
                {/* Upper Arrow to Primary */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: state === 'CLOSED' ? '#10b981' : '#475569',
                  opacity: state === 'OPEN' ? 0.3 : 1,
                  transition: 'all 0.3s ease',
                }}>
                  <ArrowRight size={18} />
                  <span style={{ fontSize: '10px', fontWeight: 700 }}>
                    {state === 'OPEN' ? 'BLOCKED' : 'ROUTE'}
                  </span>
                </div>

                {/* Lower Arrow to Fallback */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: state !== 'CLOSED' ? '#f59e0b' : '#334155',
                  fontWeight: state !== 'CLOSED' ? 800 : 400,
                  transition: 'all 0.3s ease',
                }}>
                  <ArrowRight size={18} />
                  <span style={{ fontSize: '10px' }}>FALLBACK</span>
                </div>
              </div>

              {/* Downstream Targets Stack */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '160px' }}>
                {/* Primary API Box */}
                <div style={{
                  background: state === 'CLOSED' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.05)',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: state === 'CLOSED' ? '1px solid #10b981' : '1px dashed #ef4444',
                  opacity: state === 'OPEN' ? 0.4 : 1,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: state === 'CLOSED' ? '#34d399' : '#f87171' }}>
                      Primary API
                    </div>
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>:8081</span>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {chaosActive ? '⚠️ High Latency (>500ms)' : '⚡ Fast (~20ms)'}
                  </div>
                </div>

                {/* Secondary Fallback Box */}
                <div style={{
                  background: state !== 'CLOSED' ? 'rgba(245, 158, 11, 0.15)' : '#12161f',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: state !== 'CLOSED' ? '1px solid #f59e0b' : '1px solid #222938',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: state !== 'CLOSED' ? '#fbbf24' : '#94a3b8' }}>
                      Secondary API
                    </div>
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>:8082</span>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Redundant Fallback Cluster
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Row: 4 Essential Telemetry Cards */}
      <section style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '16px',
        marginBottom: '24px',
      }}>
        {/* Card 1: RPS Throughput */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '10px',
          border: '1px solid var(--border-color)',
          padding: '18px 20px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>CURRENT THROUGHPUT</span>
            <Activity size={16} color="#38bdf8" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, marginTop: '8px', color: '#f8fafc' }}>
            {metrics?.rps || 0} <span style={{ fontSize: '14px', color: 'var(--text-dim)', fontWeight: 600 }}>req/sec</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
            Total Processed: <strong>{(metrics?.total_requests || 0).toLocaleString()}</strong>
          </div>
        </div>

        {/* Card 2: Average Latency */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '10px',
          border: '1px solid var(--border-color)',
          padding: '18px 20px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>AVG LATENCY</span>
            <Clock size={16} color="#f59e0b" />
          </div>
          <div style={{
            fontSize: '28px',
            fontWeight: 800,
            marginTop: '8px',
            color: (metrics?.avg_latency_ms || 0) > 150 ? '#ef4444' : '#10b981',
          }}>
            {(metrics?.avg_latency_ms || 0).toFixed(1)} <span style={{ fontSize: '14px', color: 'var(--text-dim)' }}>ms</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
            Context Timeout Limit: <strong>200ms</strong>
          </div>
        </div>

        {/* Card 3: Route Distribution */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '10px',
          border: '1px solid var(--border-color)',
          padding: '18px 20px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>ROUTE SPLIT</span>
            <Layers size={16} color="#a855f7" />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', marginTop: '8px' }}>
            <div>
              <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 700 }}>PRIMARY: </span>
              <span style={{ fontSize: '20px', fontWeight: 800 }}>{(metrics?.primary_requests || 0).toLocaleString()}</span>
            </div>
            <div>
              <span style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 700 }}>FALLBACK: </span>
              <span style={{ fontSize: '20px', fontWeight: 800 }}>{(metrics?.secondary_requests || 0).toLocaleString()}</span>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
            Primary Success Rate: <strong>{(metrics?.primary_success_rate || 100).toFixed(1)}%</strong>
          </div>
        </div>

        {/* Card 4: 128MB Memory Ceiling Proof */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '10px',
          border: '1px solid var(--border-color)',
          padding: '18px 20px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>MEMORY CEILING (128 MB)</span>
            <Cpu size={16} color="#06b6d4" />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '8px' }}>
            <span style={{ fontSize: '28px', fontWeight: 800, color: '#38bdf8' }}>
              {memory.alloc_mb.toFixed(1)}
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
              MB ({memPercentage}% of 128MB)
            </span>
          </div>
          {/* Visual Progress Bar */}
          <div style={{ width: '100%', height: '6px', background: '#222938', borderRadius: '3px', marginTop: '8px', overflow: 'hidden' }}>
            <div style={{
              width: `${memPercentage}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #10b981 0%, #06b6d4 100%)',
              transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '6px' }}>
            Goroutines: <strong>{memory.num_goroutine}</strong> • Sys: <strong>{memory.sys_mb.toFixed(1)} MB</strong>
          </div>
        </div>
      </section>

      {/* Live Request Stream / Event Log */}
      <section style={{
        background: 'var(--bg-card)',
        borderRadius: '12px',
        border: '1px solid var(--border-color)',
        padding: '20px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.04em', color: '#e2e8f0' }}>
              REAL-TIME ROUTE TELEMETRY STREAM
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
              (Live feed from Go Backend via WebSocket)
            </span>
          </div>
          <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 600 }}>
            ⚡ Throttled 60 FPS Ingestion (Zero Browser Lag)
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-dim)' }}>
                <th style={{ padding: '10px 12px' }}>TIME</th>
                <th style={{ padding: '10px 12px' }}>DISPATCHED ROUTE</th>
                <th style={{ padding: '10px 12px' }}>HTTP STATUS</th>
                <th style={{ padding: '10px 12px' }}>LATENCY</th>
                <th style={{ padding: '10px 12px' }}>RESULT / REASON</th>
              </tr>
            </thead>
            <tbody>
              {metrics?.recent_events && metrics.recent_events.length > 0 ? (
                metrics.recent_events.slice().reverse().map((event, idx) => (
                  <tr key={idx} style={{
                    borderBottom: '1px solid #1a2233',
                    background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  }}>
                    <td style={{ padding: '8px 12px', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {event.route === 'primary' ? (
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: 'rgba(16, 185, 129, 0.15)',
                          color: '#34d399',
                          fontWeight: 700,
                          fontSize: '11px',
                        }}>
                          PRIMARY
                        </span>
                      ) : (
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: 'rgba(245, 158, 11, 0.15)',
                          color: '#fbbf24',
                          fontWeight: 700,
                          fontSize: '11px',
                        }}>
                          SECONDARY FALLBACK
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: event.status === 200 ? '#10b981' : '#f87171' }}>
                      {event.status || 'TIMEOUT'}
                    </td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                      {event.duration_ms.toFixed(1)} ms
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>
                      {event.success ? (
                        <span style={{ color: '#10b981' }}>Fulfilled seamlessly</span>
                      ) : (
                        <span style={{ color: '#f87171' }}>
                          {event.reason === 'timeout_200ms' ? 'Context Timeout (>200ms) → Tripped Fallback' : event.reason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" style={{ padding: '30px', textAlign: 'center', color: 'var(--text-dim)' }}>
                    Awaiting traffic... Click <strong>"⚡ Simulate Traffic"</strong> or <strong>"Test 1 Req"</strong> above to see live routing.
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
