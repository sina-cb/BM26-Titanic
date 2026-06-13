/**
 * sacn_monitor.js — Floating sACN monitor panel.
 *
 * Shows connection status, stats, and activity log for the sACN input source.
 * Appears when sacn_in lighting mode is selected; hides otherwise.
 */
import { lightingMode } from '../core/state.js';

const MAX_LOG_ENTRIES = 20;
let _updateIntervalIn = null;
let _updateIntervalOut = null;

// A connected socket whose frames stop arriving is a silent failure
// (task 021: 40 s of frozen frames with zero indication). Age past
// this threshold flips the IN monitor to a loud STALLED state.
const IN_STALL_MS = 2000;
let _inStalled = false;
// Out targets older than this drop off the display (sender went idle).
const OUT_TARGET_TTL_MS = 5000;

// ─── sACN IN Monitor ──────────────────────────────────────────────────────────

export function setupSacnInMonitor() {
  const panel = document.getElementById('sacn-in-monitor-panel');
  const header = document.getElementById('sacn-in-drag-handle');
  const collapseBtn = document.getElementById('sacn-in-collapse-btn');
  if (!panel || !header) return;

  let isCollapsed = window.innerWidth <= 768; // Start collapsed on small screens
  if (isCollapsed) {
    panel.classList.add('collapsed');
    collapseBtn.textContent = '□';
  }
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isCollapsed = !isCollapsed;
    panel.classList.toggle('collapsed', isCollapsed);
    collapseBtn.textContent = isCollapsed ? '□' : '─';
  });
  header.addEventListener('dblclick', () => {
    isCollapsed = !isCollapsed;
    panel.classList.toggle('collapsed', isCollapsed);
    collapseBtn.textContent = isCollapsed ? '□' : '─';
  });

  let isDragging = false, dragOX = 0, dragOY = 0;
  header.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    const r = panel.getBoundingClientRect();
    dragOX = e.clientX - r.left;
    dragOY = e.clientY - r.top;
    document.body.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    // Stuck-drag guard: a move with no button held means the mouseup was
    // lost (released outside the window) — end the drag.
    if ((e.buttons & 1) === 0) {
      isDragging = false;
      document.body.style.cursor = '';
      return;
    }
    panel.style.left = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOX)) + 'px';
    panel.style.top = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOY)) + 'px';
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => {
    if (isDragging) { isDragging = false; document.body.style.cursor = ''; }
  });

  window.showSacnInMonitor = (show) => {
    panel.classList.toggle('hidden', !show);
    if (show) startUpdatingIn(); else stopUpdatingIn();
  };
}

export function sacnInLog(msg, type = 'info') {
  const logEl = document.getElementById('sacn-in-log');
  if (!logEl) return;
  const entry = document.createElement('div');
  entry.className = 'sacn-entry' + (type !== 'info' ? ' ' + type : '');
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `${time} ${msg}`;
  logEl.appendChild(entry);
  while (logEl.children.length > MAX_LOG_ENTRIES) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

function updateInStats() {
  const sacn = window.sacnInput;
  if (!sacn) return;
  const st = sacn.stats;
  const dot = document.getElementById('sacn-in-conn-dot');
  const statusEl = document.getElementById('sacn-in-st-status');
  const fpsEl = document.getElementById('sacn-in-st-fps');
  const framesEl = document.getElementById('sacn-in-st-frames');
  const univEl = document.getElementById('sacn-in-st-universe');
  const priEl = document.getElementById('sacn-in-st-priority');
  const ageEl = document.getElementById('sacn-in-st-age');

  // Freshness + stall detection: connected but frames aging = the
  // bridge link silently died upstream. Loud in the panel AND the log
  // (once per transition, with a recovery line) so a frozen rig is
  // diagnosable at a glance instead of looking like a mapping bug.
  const age = st.lastFrameAt > 0 ? Date.now() - st.lastFrameAt : null;
  // Stall clock runs from the last frame OR the last (re)connect,
  // whichever is later — framesReceived is cumulative, so a fresh
  // reconnect would otherwise flag STALLED before its first frame.
  const lastActivity = Math.max(st.lastFrameAt, st.connectedAt || 0);
  const stalled = !!(st.connected && st.framesReceived > 0 && lastActivity > 0 &&
    Date.now() - lastActivity > IN_STALL_MS);
  if (stalled !== _inStalled) {
    _inStalled = stalled;
    if (stalled) sacnInLog(`⚠ STALLED — no frames for ${(age / 1000).toFixed(1)}s (socket still connected)`, 'warn');
    else sacnInLog('✅ Frames resumed', 'info');
  }
  if (ageEl) {
    if (age === null) ageEl.textContent = '—';
    else if (age < 1500) ageEl.textContent = `${age} ms`;
    else ageEl.textContent = `${(age / 1000).toFixed(1)} s`;
    ageEl.style.color = stalled ? '#f66' : '';
  }
  if (statusEl) {
    statusEl.textContent = stalled ? '⚠ STALLED' : (st.connected ? 'Connected' : 'Disconnected');
    statusEl.style.color = stalled ? '#f66' : '';
  }
  if (fpsEl) fpsEl.textContent = st.fps;
  if (framesEl) framesEl.textContent = st.framesReceived.toLocaleString();
  if (univEl) {
    const unis = st.activeUniverses;
    if (unis && unis.size > 0) {
      const sorted = [...unis].sort((a, b) => a - b);
      univEl.textContent = `${sorted.length} [${sorted.join(',')}]`;
    } else univEl.textContent = '—';
  }
  if (priEl) priEl.textContent = st.lastPriority || '—';

  if (dot) {
    dot.className = 'sacn-status-dot';
    if (st.connected && st.fps > 0) dot.classList.add('receiving');
    else if (st.connected) dot.classList.add('connected');
  }
}

function startUpdatingIn() { if (!_updateIntervalIn) _updateIntervalIn = setInterval(updateInStats, 500); }
function stopUpdatingIn() { if (_updateIntervalIn) { clearInterval(_updateIntervalIn); _updateIntervalIn = null; } }


// ─── sACN OUT Monitor ─────────────────────────────────────────────────────────

export function setupSacnOutMonitor() {
  const panel = document.getElementById('sacn-out-monitor-panel');
  const header = document.getElementById('sacn-out-drag-handle');
  const collapseBtn = document.getElementById('sacn-out-collapse-btn');
  if (!panel || !header) return;

  let isCollapsed = true; // Always start collapsed by default
  if (isCollapsed) {
    panel.classList.add('collapsed');
    collapseBtn.textContent = '□';
  }
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isCollapsed = !isCollapsed;
    panel.classList.toggle('collapsed', isCollapsed);
    collapseBtn.textContent = isCollapsed ? '□' : '─';
  });
  header.addEventListener('dblclick', () => {
    isCollapsed = !isCollapsed;
    panel.classList.toggle('collapsed', isCollapsed);
    collapseBtn.textContent = isCollapsed ? '□' : '─';
  });

  let isDragging = false, dragOX = 0, dragOY = 0;
  header.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    const r = panel.getBoundingClientRect();
    dragOX = e.clientX - r.left;
    dragOY = e.clientY - r.top;
    document.body.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    // Stuck-drag guard: a move with no button held means the mouseup was
    // lost (released outside the window) — end the drag.
    if ((e.buttons & 1) === 0) {
      isDragging = false;
      document.body.style.cursor = '';
      return;
    }
    panel.style.left = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOX)) + 'px';
    panel.style.top = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOY)) + 'px';
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => {
    if (isDragging) { isDragging = false; document.body.style.cursor = ''; }
  });

  window.showSacnOutMonitor = (show) => {
    panel.classList.toggle('hidden', !show);
    if (show) startUpdatingOut(); else stopUpdatingOut();
  };

  // Ensure it displays immediately
  window.showSacnOutMonitor(true);
}

export function sacnOutLog(msg, type = 'info') {
  const logEl = document.getElementById('sacn-out-log');
  if (!logEl) return;
  const entry = document.createElement('div');
  entry.className = 'sacn-entry' + (type !== 'info' ? ' ' + type : '');
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `${time} ${msg}`;
  logEl.appendChild(entry);
  while (logEl.children.length > MAX_LOG_ENTRIES) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

function updateOutStats() {
  const sacn = window.sacnOutput;
  if (!sacn) return;
  const st = sacn.stats;
  const dot = document.getElementById('sacn-out-conn-dot');
  const statusEl = document.getElementById('sacn-out-st-status');
  const fpsEl = document.getElementById('sacn-out-st-fps');
  const framesEl = document.getElementById('sacn-out-st-frames');
  const univEl = document.getElementById('sacn-out-st-universe');
  const modeEl = document.getElementById('sacn-out-st-mode');
  const targetsEl = document.getElementById('sacn-out-st-targets');

  // What the output path is doing right now, in operator terms. In
  // sacn_in mode the sim deliberately RELAYS the engine's frames to the
  // real controllers (it is the engine→hardware bridge on playa) —
  // task 021 flagged that this was happening invisibly.
  if (modeEl) {
    modeEl.textContent = lightingMode === 'sacn_in'
      ? 'RELAY (engine → controllers)'
      : 'SIM RENDER (local patterns)';
  }
  // Live send targets (universe → controller IP); idle ones age out.
  if (targetsEl && st.targets) {
    const now = Date.now();
    const live = [];
    for (const [key, at] of st.targets) {
      if (now - at > OUT_TARGET_TTL_MS) st.targets.delete(key);
      else live.push(key);
    }
    targetsEl.textContent = live.length > 0 ? live.sort().join('  ') : '—';
  }

  if (statusEl) statusEl.textContent = st.connected ? 'Connected' : 'Disconnected';
  if (fpsEl) fpsEl.textContent = st.fps;
  if (framesEl) framesEl.textContent = st.framesSent?.toLocaleString() || '0';
  if (univEl) {
    const unis = st.activeUniverses;
    if (unis && unis.size > 0) {
      const sorted = [...unis].sort((a, b) => a - b);
      univEl.textContent = `${sorted.length} [${sorted.join(',')}]`;
    } else univEl.textContent = '—';
  }

  if (dot) {
    dot.className = 'sacn-status-dot';
    if (st.connected && st.fps > 0) dot.classList.add('receiving');
    else if (st.connected) dot.classList.add('connected');
  }
}

function startUpdatingOut() { if (!_updateIntervalOut) _updateIntervalOut = setInterval(updateOutStats, 500); }
function stopUpdatingOut() { if (_updateIntervalOut) { clearInterval(_updateIntervalOut); _updateIntervalOut = null; } }

// Expose globally
window.sacnInLog = sacnInLog;
window.setupSacnInMonitor = setupSacnInMonitor;
window.sacnOutLog = sacnOutLog;
window.setupSacnOutMonitor = setupSacnOutMonitor;

// Aliases for backwards compatibility with sacn_client.js logs temporarily
window.sacnLog = sacnInLog;
