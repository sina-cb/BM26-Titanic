/*
 * audio_companion.js — live audio visualiser for the marsin audio engine.
 *
 * Standalone, offline (no CDN, no build step): open index.html in a browser
 * and it connects to the engine's `/ws/signals` socket (the same coalesced
 * `liveParams` frame CaptainPad's meters consume) and draws the analyser
 * output in real time. Read-only / observe — a companion dashboard for
 * tuning the audio engine independent of the iPad app.
 *
 * EXPERIMENTAL (marsin_engine/audio/experimental/). Vanilla JS, no deps.
 */
'use strict';

// The live signals we draw. `post` is the chain output (what patterns react
// to); `raw` is the pre-chain analyser mirror, drawn as a faint ghost so the
// gain/smoothing divergence is visible. Order = display order.
const SIGNALS = [
  { key: 'micLow',  raw: 'micLowRaw',  label: 'LOW',  accent: '#34d3b5' },
  { key: 'micMid',  raw: 'micMidRaw',  label: 'MID',  accent: '#4ea1ff' },
  { key: 'micHigh', raw: 'micHighRaw', label: 'HIGH', accent: '#8b9bff' },
  { key: 'micKick', raw: 'micKickRaw', label: 'KICK', accent: '#ff5d6c' },
  { key: 'micFlux', raw: 'micFluxRaw', label: 'FLUX', accent: '#c084fc' },
];

const TRAIL_LEN = 240;           // samples kept per signal trail
const DEFAULT_HOST = location.hostname || 'localhost';
const DEFAULT_PORT = 6968;       // engine HTTP/WS port (engine.js default)

// ── State ────────────────────────────────────────────────────────────────
const latest = Object.create(null);                 // key -> current value
const trails = Object.create(null);                 // key -> Float32Array ring
for (const s of SIGNALS) { trails[s.key] = new Float32Array(TRAIL_LEN); trails[s.raw] = new Float32Array(TRAIL_LEN); }
let trailHead = 0;
let ws = null;
let connected = false;
let framesSeen = 0;
let lastFrameAt = 0;

// ── DOM build ──────────────────────────────────────────────────────────────
const grid = document.getElementById('grid');
const cards = {};
for (const s of SIGNALS) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-head">
      <span class="label" style="color:${s.accent}">${s.label}</span>
      <span class="value" id="val-${s.key}">0.00</span>
    </div>
    <div class="bar"><div class="bar-fill" id="bar-${s.key}" style="background:${s.accent}"></div></div>
    <canvas class="trail" id="cv-${s.key}" width="480" height="120"></canvas>`;
  grid.appendChild(card);
  cards[s.key] = {
    val: card.querySelector(`#val-${s.key}`),
    bar: card.querySelector(`#bar-${s.key}`),
    cv: card.querySelector(`#cv-${s.key}`).getContext('2d'),
  };
}

const elHost = document.getElementById('host');
const elPort = document.getElementById('port');
const elBtn = document.getElementById('connectBtn');
const elStatus = document.getElementById('status');
const elRate = document.getElementById('rate');
elHost.value = DEFAULT_HOST;
elPort.value = String(DEFAULT_PORT);

// ── WebSocket ────────────────────────────────────────────────────────────
function setStatus(text, cls) {
  elStatus.textContent = text;
  elStatus.className = 'status ' + (cls || '');
}

function connect() {
  disconnect();
  const host = elHost.value.trim() || DEFAULT_HOST;
  const port = parseInt(elPort.value, 10) || DEFAULT_PORT;
  const url = `ws://${host}:${port}/ws/signals`;
  setStatus(`connecting ${url} …`, 'warn');
  try {
    ws = new WebSocket(url);
  } catch (e) {
    setStatus(`bad URL: ${e.message}`, 'err');
    return;
  }
  ws.onopen = () => { connected = true; setStatus(`● connected ${url}`, 'ok'); elBtn.textContent = 'Disconnect'; };
  ws.onclose = () => { connected = false; setStatus('disconnected', 'err'); elBtn.textContent = 'Connect'; };
  ws.onerror = () => { setStatus(`error connecting to ${url} — is the engine running?`, 'err'); };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg || msg.type !== 'liveParams') return;
    framesSeen++; lastFrameAt = performance.now();
    for (const k in msg) { if (k !== 'type') latest[k] = +msg[k]; }
    // push this frame into the trails (one column per liveParams frame)
    for (const s of SIGNALS) {
      trails[s.key][trailHead] = clamp01(latest[s.key] ?? 0);
      trails[s.raw][trailHead] = clamp01(latest[s.raw] ?? 0);
    }
    trailHead = (trailHead + 1) % TRAIL_LEN;
  };
}

function disconnect() {
  if (ws) { try { ws.onclose = null; ws.close(); } catch {} ws = null; }
  connected = false;
}

elBtn.addEventListener('click', () => { connected ? (disconnect(), setStatus('disconnected', 'err'), elBtn.textContent = 'Connect') : connect(); });

// ── Render loop ──────────────────────────────────────────────────────────
function clamp01(x) { return x > 1 ? 1 : x > 0 ? x : 0; }

function render() {
  for (const s of SIGNALS) {
    const v = clamp01(latest[s.key] ?? 0);
    const c = cards[s.key];
    c.val.textContent = v.toFixed(2);
    c.bar.style.width = (v * 100).toFixed(1) + '%';
    drawTrail(c.cv, trails[s.key], trails[s.raw], s.accent);
  }
  // rate read-out (frames/s over the last second)
  if (framesSeen && performance.now() - lastFrameAt < 2000) {
    elRate.textContent = '';
  }
  requestAnimationFrame(render);
}

function drawTrail(ctx, post, raw, accent) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  // baseline grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let g = 1; g < 4; g++) { const y = (H * g) / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  const stepX = W / (TRAIL_LEN - 1);
  const plot = (buf, color, width, alpha) => {
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < TRAIL_LEN; i++) {
      const idx = (trailHead + i) % TRAIL_LEN;          // oldest→newest left→right
      const x = i * stepX, y = H * (1 - buf[idx]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  };
  plot(raw, accent, 1, 0.35);   // raw ghost behind
  plot(post, accent, 2, 1);     // post solid
}

// frames/sec ticker
setInterval(() => {
  const fps = framesSeen; framesSeen = 0;
  elRate.textContent = connected ? `${fps} fps` : '';
}, 1000);

render();
connect();   // auto-connect on load
