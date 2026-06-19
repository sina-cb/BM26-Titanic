/* Timeline Companion monitor — vanilla JS, no build step, offline.
   Connects to /ws, renders the timelineState, and posts mode/hold/resume/fire. */
'use strict';

const $ = (id) => document.getElementById(id);
let lastState = null;

// ── ticking local clock ───────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }
function tickClock() {
  const d = new Date();
  $('clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  // Live-decrement the next-cue countdown between server frames.
  if (lastState && lastState.nextCue) renderNextCue(lastState, true);
}
setInterval(tickClock, 1000);
tickClock();

function fmtCountdown(sec) {
  if (sec == null) return '—';
  if (sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${pad(s)}`;
}

// ── render ─────────────────────────────────────────────────────────────────────
let nextCueBaseSec = null;
let nextCueStamp = 0;

function renderNextCue(st, localOnly) {
  const nc = st.nextCue;
  if (!nc) { $('nextCue').textContent = 'no upcoming cue today'; return; }
  let sec = nc.inSec;
  if (localOnly) {
    sec = Math.max(0, Math.round(nextCueBaseSec - (Date.now() - nextCueStamp) / 1000));
  } else {
    nextCueBaseSec = nc.inSec;
    nextCueStamp = Date.now();
  }
  $('nextCue').textContent = `${fmtCountdown(sec)} · ${nc.label}`;
}

function render(st) {
  lastState = st;

  $('planName').textContent = st.activePlan || '—';
  if (st.scene) $('planName').textContent = `${st.activePlan} · ${st.scene}`;

  const modePill = $('modePill');
  const mode = (st.mode || 'armed').toUpperCase();
  modePill.textContent = mode;
  modePill.className = `pill mode ${st.mode || 'armed'}`;

  const dot = $('engineDot');
  dot.className = st.engineConnected ? 'dot up' : 'dot';
  $('engineLabel').textContent = st.engineConnected ? 'engine connected' : 'engine offline';

  const moodPill = $('moodPill');
  if (st.party) { moodPill.textContent = '● PARTY'; moodPill.className = 'pill mood party'; }
  else { moodPill.textContent = '● CALM'; moodPill.className = 'pill mood calm'; }

  $('bootError').textContent = st.lastError ? `⚠ ${st.lastError}` : '';

  if (st.waiting) {
    $('nextCue').textContent = 'waiting for engine…';
  } else {
    renderNextCue(st, false);
  }

  renderRibbon(st);
  renderCues(st);
  renderRecent(st);
}

const SUN_META = {
  sunrise: { icon: '🌅', label: 'sunrise' },
  goldenHourEnd: { icon: '☀', label: 'golden hour end' },
  solarNoon: { icon: '🌞', label: 'solar noon' },
  goldenHourStart: { icon: '☀', label: 'golden hour' },
  sunset: { icon: '🌇', label: 'sunset' },
  civilDusk: { icon: '🌃', label: 'civil dusk' },
  nauticalDusk: { icon: '🌌', label: 'nautical dusk' },
};

function renderRibbon(st) {
  const body = $('ribbonBody');
  body.innerHTML = '';

  // Phase bands first (labeled windows).
  for (const [name, win] of Object.entries(st.phases || {})) {
    const band = document.createElement('div');
    band.className = 'phase-band';
    band.innerHTML = `<span class="pname">${name}</span> <span class="pwin">${win.start || '—'} → ${win.end || '—'}</span>`;
    body.appendChild(band);
  }

  // Build a sorted list of sun events + the NOW marker, by HH:MM.
  const rows = [];
  for (const [key, hhmm] of Object.entries(st.sun || {})) {
    const meta = SUN_META[key] || { icon: '·', label: key };
    rows.push({ time: hhmm, icon: meta.icon, label: meta.label });
  }
  const now = new Date();
  const nowStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  rows.push({ time: nowStr, icon: '▶', label: `NOW${st.currentPhase ? ' · ' + st.currentPhase : ''}`, now: true });
  rows.sort((a, b) => a.time.localeCompare(b.time));

  for (const r of rows) {
    const div = document.createElement('div');
    div.className = `ribbon-row${r.now ? ' now' : ''}`;
    div.innerHTML = `<span class="ribbon-time">${r.time}</span><span class="ribbon-icon">${r.icon}</span><span class="ribbon-label">${r.label}</span>`;
    body.appendChild(div);
  }
}

function renderCues(st) {
  const body = $('cuesBody');
  body.innerHTML = '';
  for (const cue of st.cues || []) {
    const div = document.createElement('div');
    div.className = `cue${cue.lastError ? ' err' : ''}${cue.enabled ? '' : ' disabled'}`;
    const count = cue.nextInSec != null ? fmtCountdown(cue.nextInSec) : '';
    div.innerHTML = `
      <div class="cue-main">
        <div class="cue-label">${escapeHtml(cue.label)}</div>
        <div class="cue-trig">${escapeHtml(cue.trigger)}</div>
        ${cue.lastError ? `<div class="cue-err">⚠ ${escapeHtml(cue.lastError)}</div>` : ''}
      </div>
      <div class="cue-count">${count}</div>
      <button class="btn fire" data-cue="${escapeHtml(cue.id)}">FIRE</button>`;
    body.appendChild(div);
  }
  body.querySelectorAll('button.fire').forEach((b) => {
    b.addEventListener('click', () => fireCue(b.dataset.cue));
  });
}

function renderRecent(st) {
  const body = $('recentBody');
  body.innerHTML = '';
  const fires = (st.recentFires || []).slice().reverse();
  if (!fires.length) { body.innerHTML = '<div class="rf">no fires yet</div>'; return; }
  for (const f of fires) {
    const t = new Date(f.atMs);
    const div = document.createElement('div');
    div.className = 'rf';
    div.innerHTML = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())} · <span class="rfcue">${escapeHtml(f.cueId)}</span> · ${escapeHtml(f.reason)}`;
    body.appendChild(div);
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── actions ────────────────────────────────────────────────────────────────────
async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) console.warn(`POST ${path} → ${data.error || res.status}`);
  return data;
}

function fireCue(id) { post(`/cues/${id}/fire`); }
$('btnPause').addEventListener('click', () => post('/mode', { mode: 'paused' }));
$('btnResume').addEventListener('click', () => post('/resume'));
$('btnHold').addEventListener('click', () => post('/hold', { minutes: 30 }));

// ── websocket ──────────────────────────────────────────────────────────────────
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'timelineState') render(msg);
    // wouldFire frames are informational; the next timelineState reflects state.
  };
  ws.onclose = () => setTimeout(connect, 1000);
  ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
}
connect();
