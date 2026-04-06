/**
 * sacn_monitor.js — Floating sACN monitor panel.
 *
 * Shows connection status, stats, and activity log for the sACN input source.
 * Appears when sacn_in lighting mode is selected; hides otherwise.
 */

const MAX_LOG_ENTRIES = 50;
let _updateInterval = null;

/**
 * Setup the sACN monitor panel (drag, collapse, show/hide).
 */
export function setupSacnMonitor() {
  const panel = document.getElementById('sacn-monitor-panel');
  const header = document.getElementById('sacn-drag-handle');
  const collapseBtn = document.getElementById('sacn-collapse-btn');
  if (!panel || !header) return;

  // ── Collapse ──
  let isCollapsed = false;
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

  // ── Drag ──
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

  // ── Show/hide hook ──
  window.showSacnMonitor = (show) => {
    panel.classList.toggle('hidden', !show);
    if (show) {
      startUpdating();
    } else {
      stopUpdating();
    }
  };
}

/**
 * Add a log entry to the sACN monitor.
 * @param {string} msg
 * @param {'info'|'source'|'warn'|'error'} [type='info']
 */
export function sacnLog(msg, type = 'info') {
  const logEl = document.getElementById('sacn-log');
  if (!logEl) return;

  const entry = document.createElement('div');
  entry.className = 'sacn-entry' + (type !== 'info' ? ' ' + type : '');
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `${time} ${msg}`;
  logEl.appendChild(entry);

  // Trim old entries
  while (logEl.children.length > MAX_LOG_ENTRIES) {
    logEl.removeChild(logEl.firstChild);
  }

  // Auto-scroll
  logEl.scrollTop = logEl.scrollHeight;
}

/**
 * Update the stats display from the sacnInput singleton.
 */
function updateStats() {
  const sacn = window.sacnInput;
  if (!sacn) return;

  const st = sacn.stats;
  const dot = document.getElementById('sacn-conn-dot');
  const statusEl = document.getElementById('sacn-st-status');
  const fpsEl = document.getElementById('sacn-st-fps');
  const framesEl = document.getElementById('sacn-st-frames');
  const univEl = document.getElementById('sacn-st-universe');
  const priEl = document.getElementById('sacn-st-priority');

  if (statusEl) statusEl.textContent = st.connected ? 'Connected' : 'Disconnected';
  if (fpsEl) fpsEl.textContent = st.fps;
  if (framesEl) framesEl.textContent = st.framesReceived.toLocaleString();
  if (univEl) univEl.textContent = st.lastUniverse || '—';
  if (priEl) priEl.textContent = st.lastPriority || '—';

  if (dot) {
    dot.className = 'sacn-status-dot';
    if (st.connected && st.fps > 0) {
      dot.classList.add('receiving');
    } else if (st.connected) {
      dot.classList.add('connected');
    }
  }
}

function startUpdating() {
  if (_updateInterval) return;
  _updateInterval = setInterval(updateStats, 500);
}

function stopUpdating() {
  if (_updateInterval) {
    clearInterval(_updateInterval);
    _updateInterval = null;
  }
}

// Expose globally
window.sacnLog = sacnLog;
window.setupSacnMonitor = setupSacnMonitor;
