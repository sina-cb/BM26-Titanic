/**
 * sacn_monitor.js — Floating sACN monitor panel.
 *
 * Shows connection status, stats, and activity log for the sACN input source.
 * Appears when sacn_in lighting mode is selected; hides otherwise.
 */

const MAX_LOG_ENTRIES = 20;
let _updateIntervalIn = null;
let _updateIntervalOut = null;

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

  if (statusEl) statusEl.textContent = st.connected ? 'Connected' : 'Disconnected';
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
