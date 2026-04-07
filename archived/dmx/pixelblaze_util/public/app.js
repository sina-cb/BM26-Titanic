/**
 * PixelBlaze Utility — Client-side App
 *
 * Connects to the backend via WebSocket, fetches universes + presets,
 * and lets the user edit / run / stop PixelBlaze patterns on physical fixtures.
 */

// ── DOM refs ───────────────────────────────────────────────────────────────
const universeSelect  = document.getElementById('universe-select');
const presetList      = document.getElementById('preset-list');
const codeEditor      = document.getElementById('code-editor');
const btnRun          = document.getElementById('btn-run');
const btnStop         = document.getElementById('btn-stop');
const statusPill      = document.getElementById('status-pill');
const statusText      = document.getElementById('status-text');
const statusBar       = document.getElementById('status-bar');
const statusMsg       = document.getElementById('status-msg');

// ── Default pattern ────────────────────────────────────────────────────────
const DEFAULT_CODE = `export function beforeRender(delta) {
  t1 = time(0.1)
}
export function render(index) {
  hsv(t1 + index / pixelCount, 1, 1)
}
`;

codeEditor.value = DEFAULT_CODE;

// ── State ──────────────────────────────────────────────────────────────────
let ws = null;
let isRunning = false;
let presets = [];

// ── WebSocket ──────────────────────────────────────────────────────────────
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener('open', () => {
    setConnectionStatus('connected', 'Connected');
    btnRun.disabled = !universeSelect.value;
  });

  ws.addEventListener('close', () => {
    setConnectionStatus('', 'Disconnected');
    btnRun.disabled = true;
    btnStop.disabled = true;
    setTimeout(connectWs, 2000);
  });

  ws.addEventListener('error', () => {
    setConnectionStatus('error', 'Connection error');
  });

  ws.addEventListener('message', (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }

    switch (msg.type) {
      case 'status':
        if (msg.running) setRunning(true, msg.universe);
        break;
      case 'running':
        setRunning(true, msg.universeId);
        setStatusBar('running', '▶ Running', `Pattern active on "${msg.universeId}"`);
        break;
      case 'stopped':
        setRunning(false);
        setStatusBar('ok', '✓', 'Stopped — fixtures blacked out');
        break;
      case 'error':
        setRunning(false);
        setStatusBar('error', '✗', msg.error);
        break;
    }
  });
}

function setConnectionStatus(cls, text) {
  statusPill.className = 'status-pill ' + cls;
  statusText.textContent = text;
}

function setRunning(running, universeId) {
  isRunning = running;
  btnRun.disabled = running || !universeSelect.value;
  btnStop.disabled = !running;
  if (running) {
    statusPill.className = 'status-pill running';
    statusText.textContent = 'Running';
  }
}

function setStatusBar(cls, icon, msg) {
  statusBar.className = 'status-bar ' + cls;
  statusBar.querySelector('.status-icon').textContent = icon;
  statusMsg.textContent = msg;
}

// ── Actions ────────────────────────────────────────────────────────────────
function runPattern() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const code = codeEditor.value.trim();
  const universeId = universeSelect.value;
  if (!code || !universeId) return;

  setStatusBar('neutral', '⟳', 'Compiling…');
  ws.send(JSON.stringify({ type: 'compile', code, universeId }));
}

function stopPattern() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'stop' }));
}

btnRun.addEventListener('click', runPattern);
btnStop.addEventListener('click', stopPattern);

// Ctrl+Enter to run
codeEditor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runPattern();
  }
  // Tab inserts two spaces
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = codeEditor.selectionStart;
    const end   = codeEditor.selectionEnd;
    codeEditor.value = codeEditor.value.substring(0, start) + '  ' + codeEditor.value.substring(end);
    codeEditor.selectionStart = codeEditor.selectionEnd = start + 2;
  }
});

// ── Fetch Universes ────────────────────────────────────────────────────────
async function loadUniverses() {
  try {
    const resp = await fetch('/api/universes');
    const data = await resp.json();
    universeSelect.innerHTML = '';

    if (!data.universes || data.universes.length === 0) {
      universeSelect.innerHTML = '<option value="">No universes found</option>';
      return;
    }

    for (const u of data.universes) {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${u.name} (${u.fixtureCount} fixtures)`;
      universeSelect.appendChild(opt);
    }

    universeSelect.disabled = false;
    btnRun.disabled = !ws || ws.readyState !== WebSocket.OPEN;
  } catch (err) {
    universeSelect.innerHTML = '<option value="">Error loading</option>';
    console.error('Failed to load universes:', err);
  }
}

// Universe select change enables the Run button
universeSelect.addEventListener('change', () => {
  if (!isRunning && ws && ws.readyState === WebSocket.OPEN && universeSelect.value) {
    btnRun.disabled = false;
  }
});

// ── Fetch Presets ──────────────────────────────────────────────────────────
async function loadPresets() {
  try {
    const resp = await fetch('/api/presets');
    const data = await resp.json();
    presets = data.presets || [];

    presetList.innerHTML = '';

    for (const p of presets) {
      const btn = document.createElement('button');
      btn.className = 'preset-btn';
      btn.textContent = p.name;
      btn.addEventListener('click', () => {
        codeEditor.value = p.code;
        // Highlight active
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      presetList.appendChild(btn);
    }
  } catch (err) {
    console.error('Failed to load presets:', err);
  }
}

// ── Init ───────────────────────────────────────────────────────────────────
loadUniverses();
loadPresets();
connectWs();
