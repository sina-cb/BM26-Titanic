/**
 * sacn_monitor_panel.js — Modern (Preact) sACN IN/OUT monitors.
 *
 * The sim's sACN IN/OUT monitors. Preserves every external contract the
 * former vanilla-DOM panels exposed:
 *   - `window.showSacnInMonitor(show)` / `window.showSacnOutMonitor(show)`
 *   - `window.sacnInLog(msg, type)` / `window.sacnOutLog` / `window.sacnLog`
 *   - IN stats read from `window.sacnInput.stats` on a 500 ms cadence, only
 *     while the panel is shown (the OUT panel has no stats: the browser has no
 *     transmit path to measure — report 20260805_171)
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
import { benchMirrorControlState } from '../bench_mirror_control.js';

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
    // Bench-mirror arm state rides the same 500 ms poll (report 20260804_151).
    // `undefined` on the OUT monitor, which simply does not render the row.
    benchMirror: st.benchMirror,
    dot,
  };
}

// ── BENCH MIRROR: READ-ONLY here (report 20260805_155 §8.5) ────────────────
//
// This panel used to own the ARM/DISARM button. It does NOT any more, and the
// reason is the defect: this panel is rendered only while the lighting engine
// mode is `sacn_in` (gui_builder.js / pattern_editor.js gate it), and `sacn_in`
// is precisely the mode that turns every sim window into a hard-coded
// priority-150 sACN writer to the ship's real controllers. The operator could
// not reach the button without being in the exact mode that outranked the mirror
// at the box. The placement was part of the defect.
//
// The control now lives in the 🎛 Controllers view header, which is available
// regardless of lighting mode. What stays here is TRUTH, not action: a read-only
// status row, plus the bridge's own transition/refusal lines in the activity
// log. There is deliberately NO actionable bench-mirror control anywhere in this
// file — a duplicate control is a second place for the two to disagree.

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
    // No stats poll: `window.sacnOutput` is gone with the browser's transmit
    // path (report 20260805_171). This panel is the engine-blackout control now.
    sacnOutStore.visible.value = !!show;
  };
  window.sacnInLog = (msg, type = 'info') => sacnInStore.pushLog(msg, type);
  window.sacnOutLog = (msg, type = 'info') => sacnOutStore.pushLog(msg, type);
  // Legacy alias kept for sacn_client.js call sites.
  window.sacnLog = window.sacnInLog;

  // The OUT monitor boots visible (it has always shown on load).
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
  // Read-only projection of the same pure state the Controllers header renders,
  // so the two can never describe different bridges.
  const bm = benchMirrorControlState(st.benchMirror, { connected: st.status === 'Connected' });
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
          <${StatRow} label="Bench Mirror" value=${bm.statusText}
                      title=${`${bm.title} — ARM/DISARM lives in the 🎛 Controllers view header.`} />
          <${StatRow} label="Mirror State" value=${bm.noticeText}
                      title="Read-only. The bench mirror is armed and disarmed from the Controllers view header." />
        </div>
        <div class="sacn-log-title" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 5px;">
          <span>Activity Log</span>
          <span style="cursor:pointer; color:var(--secondary);" onClick=${s.clearLog}>Clear</span>
        </div>
        <${ActivityLog} store=${s} />
      </div>
    <//>
  `;
}

/**
 * The panel formerly known as the sACN OUT Monitor.
 *
 * It monitored the browser's own hardware transmit — frames sent, universes
 * pushed, connection to :6972. That transmit is GONE (report 20260805_171): the
 * browser is not the router, so every one of those numbers would now read zero
 * forever, and a panel of permanent zeros is worse than no panel — it invites
 * someone to "fix" it by restoring the writer.
 *
 * What it keeps is the one thing in it that was never a :6972 control: the
 * BLACKOUT button, which POSTs the ENGINE's `/global-blackout` on :6968. Its id
 * is load-bearing (`engine_blackout_warning.js` pokes it) and so is
 * `window.triggerSacnBlackout`, so both are preserved verbatim.
 */
export function EngineBlackoutPanel() {
  const s = sacnOutStore;
  return html`
    <${FloatingPanel}
      id="sacn-out-monitor-panel"
      headerClass="sacn-header" titleClass="sacn-title"
      title="🔌 Engine Blackout"
      hidden=${!s.visible.value}
      collapsed=${s.collapsed.value}
      onToggleCollapse=${() => { s.collapsed.value = !s.collapsed.value; }}
    >
      <div class="sacn-body">
        <div class="sacn-stats">
          <${StatRow} label="Output path"
                      value="engine → bridge → controllers"
                      title="The engine renders, the sACN INPUT bridge (:6971) routes to the
                             controllers. This browser renders and controls; it never transmits
                             DMX to hardware." />
        </div>
        <div class="sacn-log-title" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 5px;">
          <span>Activity Log</span>
          <div>
            <button id="sacn-out-blackout-btn" class="pe-btn"
                    style="background:var(--error); color:var(--surface-container-lowest); border:1px solid var(--error-container-border); padding: 2px 6px; margin-right: 5px;"
                    title="Toggle the ENGINE's global blackout (POST /global-blackout on :6968)"
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

/** Back-compat alias: the panel moved role, not identity. */
export const SacnOutMonitor = EngineBlackoutPanel;
