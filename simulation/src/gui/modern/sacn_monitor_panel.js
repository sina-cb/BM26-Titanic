/**
 * sacn_monitor_panel.js — Modern (Preact) sACN IN/OUT monitors.
 *
 * Strangler replacement for src/gui/sacn_monitor.js. Preserves every
 * external contract of the legacy panels:
 *   - `window.showSacnInMonitor(show)` / `window.showSacnOutMonitor(show)`
 *   - `window.sacnInLog(msg, type)` / `window.sacnOutLog` / `window.sacnLog`
 *   - stats read from `window.sacnInput.stats` / `window.sacnOutput.stats`
 *     on the same 500 ms cadence, only while the panel is shown
 *   - panel ids, `hidden`/`collapsed` classes, drag/collapse behavior,
 *     BLACKOUT button id (`sacn-out-blackout-btn`, poked by
 *     engine_blackout_warning.js) and `window.triggerSacnBlackout`
 *   - IN starts collapsed on small screens; OUT starts collapsed + visible
 */

import { html } from 'htm/preact';
import { useEffect, useRef } from 'preact/hooks';
import { signal } from '@preact/signals';

import { FloatingPanel } from './floating_panel.js';
import { getStoredGeometry } from '../panel_layout.js';

const MAX_LOG_ENTRIES = 20;
const STATS_POLL_MS = 500;

function timestamp() {
  return new Date().toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatUniverses(unis) {
  if (unis && unis.size > 0) {
    const sorted = [...unis].sort((a, b) => a - b);
    return `${sorted.length} [${sorted.join(',')}]`;
  }
  return '—';
}

/** Shared store/behavior for one monitor direction. */
function createMonitorStore({ collapsedDefault }) {
  const store = {
    visible: signal(false),
    collapsed: signal(collapsedDefault),
    log: signal([]),
    stats: signal({ status: 'Disconnected', fps: 0, frames: '0', universes: '—', priority: '—', dot: '' }),
    _interval: null,
  };
  store.pushLog = (msg, type = 'info') => {
    const entry = { time: timestamp(), msg, type };
    store.log.value = [...store.log.value, entry].slice(-MAX_LOG_ENTRIES);
  };
  store.clearLog = () => { store.log.value = []; };
  return store;
}

function startPolling(store, readStats) {
  if (store._interval) return;
  store._interval = setInterval(() => {
    const next = readStats();
    if (next) store.stats.value = next;
  }, STATS_POLL_MS);
}

function stopPolling(store) {
  if (store._interval) { clearInterval(store._interval); store._interval = null; }
}

function readDirectionStats(source, framesField) {
  const sacn = source();
  if (!sacn) return null;
  const st = sacn.stats;
  let dot = '';
  if (st.connected && st.fps > 0) dot = 'receiving';
  else if (st.connected) dot = 'connected';
  return {
    status: st.connected ? 'Connected' : 'Disconnected',
    fps: st.fps,
    frames: st[framesField]?.toLocaleString() || '0',
    universes: formatUniverses(st.activeUniverses),
    priority: st.lastPriority || '—',
    dot,
  };
}

// ── Stores (module-level: external globals need them before mount) ─────
// Operator decision 2026-06-12: both monitors default collapsed.
export const sacnInStore = createMonitorStore({ collapsedDefault: true });
export const sacnOutStore = createMonitorStore({ collapsedDefault: true });

/** Default slot for the IN monitor when it has no operator-saved geometry:
 *  bottom-left, stacked directly above and left-aligned with sACN OUT. */
function placeSacnInMonitor() {
  const el = document.getElementById('sacn-in-monitor-panel');
  if (!el || getStoredGeometry('sacn-in-monitor-panel')) return;
  const out = document.getElementById('sacn-out-monitor-panel');
  let bottom = 44;
  if (out) {
    const r = out.getBoundingClientRect();
    if (r.height > 0) bottom = Math.round(window.innerHeight - r.top + 6);
  }
  el.style.left = '0';
  el.style.bottom = `${bottom}px`;
  el.style.top = 'auto';
  el.style.right = 'auto';
}

export function registerSacnGlobals() {
  window.showSacnInMonitor = (show) => {
    sacnInStore.visible.value = !!show;
    if (show) {
      startPolling(sacnInStore, () => readDirectionStats(() => window.sacnInput, 'framesReceived'));
      requestAnimationFrame(placeSacnInMonitor);
    } else stopPolling(sacnInStore);
  };
  window.showSacnOutMonitor = (show) => {
    sacnOutStore.visible.value = !!show;
    if (show) startPolling(sacnOutStore, () => readDirectionStats(() => window.sacnOutput, 'framesSent'));
    else stopPolling(sacnOutStore);
  };
  window.sacnInLog = (msg, type = 'info') => sacnInStore.pushLog(msg, type);
  window.sacnOutLog = (msg, type = 'info') => sacnOutStore.pushLog(msg, type);
  // Legacy alias kept for sacn_client.js call sites.
  window.sacnLog = window.sacnInLog;

  // Same boot behavior as legacy setupSacnOutMonitor().
  window.showSacnOutMonitor(true);
}

// ── Components ──────────────────────────────────────────────────────────

function StatRow({ label, value, title }) {
  return html`
    <div class="sacn-stat-row" title=${title}>
      <span class="sacn-label">${label}</span>
      <span class="sacn-value">${value}</span>
    </div>
  `;
}

function ActivityLog({ store }) {
  const logRef = useRef(null);
  const entries = store.log.value;
  // Legacy pinned the log to the newest entry on every append — keep that.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [entries]);
  return html`
    <div class="sacn-log" ref=${logRef}>
      ${entries.map((e) => html`
        <div class=${`sacn-entry${e.type !== 'info' ? ` ${e.type}` : ''}`}>${e.time} ${e.msg}</div>
      `)}
    </div>
  `;
}

export function SacnInMonitor() {
  const s = sacnInStore;
  const st = s.stats.value;
  return html`
    <${FloatingPanel}
      id="sacn-in-monitor-panel"
      headerClass="sacn-header" titleClass="sacn-title"
      title="📡 sACN IN Monitor (6971)"
      hidden=${!s.visible.value}
      collapsed=${s.collapsed.value}
      onToggleCollapse=${() => { s.collapsed.value = !s.collapsed.value; }}
      headerExtra=${html`<span class=${`sacn-status-dot ${st.dot}`} id="sacn-in-conn-dot" />`}
    >
      <div class="sacn-body">
        <div class="sacn-stats">
          <${StatRow} label="Status" value=${st.status} title="WebSocket connection to the sACN IN bridge server" />
          <${StatRow} label="FPS" value=${st.fps} title="Incoming sACN frames per second (measured over 5s window)" />
          <${StatRow} label="Frames" value=${st.frames} title="Total DMX frames received since connection" />
          <${StatRow} label="Universes" value=${st.universes} title="Number of active sACN universes being received" />
          <${StatRow} label="Priority" value=${st.priority} title="sACN source priority (higher priority wins in multi-source merge)" />
        </div>
        <div class="sacn-log-title" style="display:flex; justify-content:space-between;">
          <span>Activity Log</span>
          <span style="cursor:pointer; color:var(--secondary);" onClick=${s.clearLog}>Clear</span>
        </div>
        <${ActivityLog} store=${s} />
      </div>
    <//>
  `;
}

export function SacnOutMonitor() {
  const s = sacnOutStore;
  const st = s.stats.value;
  return html`
    <${FloatingPanel}
      id="sacn-out-monitor-panel"
      headerClass="sacn-header" titleClass="sacn-title"
      title="📡 sACN OUT Monitor (6972)"
      hidden=${!s.visible.value}
      collapsed=${s.collapsed.value}
      onToggleCollapse=${() => { s.collapsed.value = !s.collapsed.value; }}
      headerExtra=${html`<span class=${`sacn-status-dot ${st.dot}`} id="sacn-out-conn-dot" />`}
    >
      <div class="sacn-body">
        <div class="sacn-stats">
          <${StatRow} label="Status" value=${st.status} title="WebSocket connection to the sACN OUT bridge server" />
          <${StatRow} label="FPS" value=${st.fps} title="Outgoing sACN frames per second" />
          <${StatRow} label="Frames" value=${st.frames} title="Total DMX frames sent since connection" />
          <${StatRow} label="Universes" value=${st.universes} title="Number of active sACN universes being pushed" />
        </div>
        <div class="sacn-log-title" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 5px;">
          <span>Activity Log</span>
          <div>
            <button id="sacn-out-blackout-btn" class="pe-btn"
                    style="background:var(--error); color:var(--surface-container-lowest); border:1px solid var(--error-container-border); padding: 2px 6px; margin-right: 5px;"
                    title="Send 0 to all Universes and Disable Output"
                    onClick=${() => { if (window.triggerSacnBlackout) window.triggerSacnBlackout(); }}>
              BLACKOUT
            </button>
            <span style="cursor:pointer; color:var(--secondary);" onClick=${s.clearLog}>Clear</span>
          </div>
        </div>
        <${ActivityLog} store=${s} />
      </div>
    <//>
  `;
}
