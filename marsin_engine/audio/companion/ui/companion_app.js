/*
 * companion_app.js — Audio Companion frontend.
 *
 * A TouchDesigner-flavoured editor for the engine's audio signal chains:
 * pick a signal, build its op pipeline (the REAL engine ops), tweak params and
 * the test source, watch the RAW→POST trace update live, and export the chain
 * config the engine loads. All DSP is server-side (the engine's real code);
 * this file only renders + sends edits. Vanilla JS, no deps.
 */
'use strict';

const SIGNAL_META = {
  micLow:  { label: 'LOW',  accent: '#34d3b5' },
  micMid:  { label: 'MID',  accent: '#4ea1ff' },
  micHigh: { label: 'HIGH', accent: '#8b9bff' },
  micKick: { label: 'KICK', accent: '#ff5d6c' },
  micFlux: { label: 'FLUX', accent: '#c084fc' },
};
const TRAIL = 360;

const S = {
  signals: [], ops: {}, chains: {}, source: {}, gains: {},
  selected: 'micLow',
  trace: {},          // signal -> {raw:Float32Array, post:Float32Array}
  head: 0,
  live: {},           // signal -> {raw, post}
  connected: false,
  mode: 'test',       // 'test' | 'mic' | 'file'
  filePath: '',
  datasetsDir: '',    // server default browse dir
  browseDir: '',      // current browser dir
  devices: [],        // [{ id, label, ffmpegDevice, inputFormat }]
  device: '',         // selected ffmpegDevice ('' = platform default)
  dom: { f1: 0, e1: 0, f2: 0, e2: 0 },
  struct: { state: 0, build: 0, energy: 0, pulse: 0, slow: 0 },
  dropFlash: 0,
};
const STATE_NAME = { 0: 'THIN', 1: 'BUILD', 2: 'SUSTAIN' };
let ws = null;

// ── WS ─────────────────────────────────────────────────────────────────────
function connect() {
  const url = `ws://${location.hostname || 'localhost'}:${location.port || 6970}/ws`;
  ws = new WebSocket(url);
  ws.onopen = () => { S.connected = true; setStatus('● live', 'ok'); };
  ws.onclose = () => { S.connected = false; setStatus('disconnected', 'err'); setTimeout(connect, 1500); };
  ws.onerror = () => setStatus('ws error', 'err');
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'hello') {
      S.signals = m.signals; S.ops = m.ops; S.chains = m.chains; S.source = m.source; S.gains = m.gains;
      if (m.mode) S.mode = m.mode;
      if (m.datasetsDir) { S.datasetsDir = m.datasetsDir; S.browseDir = m.datasetsDir; }
      for (const s of S.signals) S.trace[s] = { raw: new Float32Array(TRAIL), post: new Float32Array(TRAIL) };
      buildSidebar(); buildSource(); renderChain(); buildSourceBar();
    } else if (m.type === 'frame') {
      for (const s of S.signals) {
        const v = m.signals[s]; if (!v) continue;
        S.live[s] = v;
        const tr = S.trace[s];
        tr.raw[S.head] = clamp01(v.raw); tr.post[S.head] = clamp01(v.post);
      }
      S.head = (S.head + 1) % TRAIL;
      if (m.dom) S.dom = m.dom;
      if (m.struct) S.struct = m.struct;
    } else if (m.type === 'dropFired') {
      S.dropFlash = 1; flash('▼ DROP ' + (m.confidence != null ? m.confidence.toFixed(2) : ''));
    } else if (m.type === 'sourceStatus') {
      S.mode = m.mode; buildSourceBar();
      if (m.status && m.status.error) flash('source: ' + m.status.error, true);
    } else if (m.type === 'devices') {
      S.devices = m.devices || [];
      if (m.error) flash('devices: ' + m.error, true);
      buildSourceBar();
    } else if (m.type === 'chainResult') {
      if (m.ok) { S.chains[m.signal] = m.chain; if (m.signal === S.selected) renderChain(); flash('saved'); }
      else { flash('invalid: ' + m.error, true); }
    } else if (m.type === 'export') {
      showExport(m.yaml);
    }
  };
}
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const pushChain = (sig) => send({ type: 'setChain', signal: sig, chain: S.chains[sig] });

// ── helpers ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp01 = (x) => (x > 1 ? 1 : x > 0 ? x : 0);
const accent = (s) => (SIGNAL_META[s]?.accent || '#9aa');
function setStatus(t, c) { const e = $('status'); e.textContent = t; e.className = 'status ' + (c || ''); }
let flashT = 0;
function flash(t, bad) { const e = $('flash'); e.textContent = t; e.style.color = bad ? '#ff5d6c' : '#34d3b5'; clearTimeout(flashT); flashT = setTimeout(() => e.textContent = '', 1800); }

// ── sidebar (signal list) ──────────────────────────────────────────────────
function buildSidebar() {
  const box = $('signals'); box.innerHTML = '';
  for (const s of S.signals) {
    const row = el('button', 'sig-row' + (s === S.selected ? ' active' : ''));
    row.style.setProperty('--acc', accent(s));
    row.innerHTML = `<span class="sig-name">${SIGNAL_META[s]?.label || s}</span>
      <span class="sig-mini"><canvas id="mini-${s}" width="120" height="26"></canvas></span>
      <span class="sig-val" id="sv-${s}">0.00</span>`;
    row.onclick = () => { S.selected = s; buildSidebar(); renderChain(); };
    box.appendChild(row);
  }
}

// ── source panel ────────────────────────────────────────────────────────────
function buildSource() {
  const box = $('source'); box.innerHTML = '';
  const knobs = [
    ['subLevel', 'SUB', 0, 1], ['midLevel', 'MID', 0, 1], ['highLevel', 'HIGH', 0, 1],
    ['kickLevel', 'KICK', 0, 1], ['kickHz', 'KICK/s', 0, 8], ['noiseLevel', 'NOISE', 0, 0.2],
    ['inputGain', 'INPUT GAIN', 0, 10],
  ];
  for (const [key, label, min, max] of knobs) {
    const row = el('div', 'knob');
    const val = S.source[key] ?? 0;
    row.innerHTML = `<div class="knob-head"><span>${label}</span><span id="src-${key}">${(+val).toFixed(2)}</span></div>`;
    const r = el('input'); r.type = 'range'; r.min = min; r.max = max; r.step = (max - min) / 200; r.value = val;
    r.oninput = () => { S.source[key] = +r.value; $('src-' + key).textContent = (+r.value).toFixed(2); send({ type: 'setSource', source: { [key]: +r.value } }); };
    row.appendChild(r); box.appendChild(row);
  }
}

// ── chain pipeline (the op nodes) ───────────────────────────────────────────
function renderChain() {
  const box = $('chain'); box.innerHTML = '';
  const sig = S.selected;
  $('chain-title').textContent = (SIGNAL_META[sig]?.label || sig) + ' · chain';
  $('chain-title').style.color = accent(sig);
  const chain = S.chains[sig] || [];
  chain.forEach((op, i) => {
    const card = el('div', 'op');
    card.style.setProperty('--acc', accent(sig));
    const head = el('div', 'op-head', `<span class="op-type">${op.type}</span>`);
    const tools = el('div', 'op-tools');
    const mk = (txt, fn, title) => { const b = el('button', 'op-btn', txt); b.title = title; b.onclick = fn; return b; };
    tools.appendChild(mk('◀', () => moveOp(i, -1), 'move left'));
    tools.appendChild(mk('▶', () => moveOp(i, 1), 'move right'));
    tools.appendChild(mk('✕', () => removeOp(i), 'remove'));
    head.appendChild(tools); card.appendChild(head);
    card.appendChild(opParams(sig, op, i));
    box.appendChild(card);
    if (i < chain.length - 1) box.appendChild(el('div', 'op-arrow', '→'));
  });
  // add-op button + palette
  const add = el('div', 'op op-add');
  const sel = el('select', 'add-sel');
  sel.appendChild(el('option', null, '+ add op'));
  for (const t of Object.keys(S.ops)) sel.appendChild(el('option', null, t));
  sel.onchange = () => { if (sel.value && sel.value !== '+ add op') { addOp(sig, sel.value); sel.value = '+ add op'; } };
  add.appendChild(sel);
  const resetBtn = el('button', 'reset-btn', 'reset to default');
  resetBtn.onclick = () => send({ type: 'reset', signal: sig });
  add.appendChild(resetBtn);
  box.appendChild(add);
}

function opParams(sig, op, i) {
  const wrap = el('div', 'op-params');
  const schema = S.ops[op.type]?.params || {};
  // gain's paramKey case → show the live gain knob value (read-only label)
  for (const [pname, pdef] of Object.entries(schema)) {
    if (op.params[pname] === undefined && pdef.optional) continue;
    if (op.type === 'gain' && pname === 'paramKey') {
      if (op.params.paramKey) { wrap.appendChild(el('div', 'param-static', `gain ← <b>${op.params.paramKey}</b>`)); }
      continue;
    }
    if (op.type === 'gain' && pname === 'value' && op.params.paramKey) continue;
    const row = el('div', 'param');
    const cur = op.params[pname] ?? pdef.default;
    if (pdef.type === 'string') {
      row.innerHTML = `<span class="pn">${pname}</span>`;
      const sel = el('select');
      for (const o of (pdef.oneOf || [cur])) { const opt = el('option', null, o); if (o === cur) opt.selected = true; sel.appendChild(opt); }
      sel.onchange = () => { op.params[pname] = sel.value; pushChain(sig); };
      row.appendChild(sel);
    } else {
      const min = pdef.min ?? 0, max = pdef.max ?? 1;
      row.innerHTML = `<span class="pn">${pname}</span><span class="pv" id="pv-${i}-${pname}">${fmt(cur)}</span>`;
      const r = el('input'); r.type = 'range'; r.min = min; r.max = max; r.step = stepFor(min, max); r.value = cur;
      r.oninput = () => { op.params[pname] = +r.value; $(`pv-${i}-${pname}`).textContent = fmt(+r.value); };
      r.onchange = () => pushChain(sig);
      row.appendChild(r);
    }
    wrap.appendChild(row);
  }
  return wrap;
}
const fmt = (v) => (Number.isInteger(v) ? String(v) : (+v).toFixed(2));
const stepFor = (min, max) => { const span = max - min; return span > 100 ? 1 : span > 5 ? 0.1 : span / 200; };

function uid(t) { return t + '_' + Math.random().toString(36).slice(2, 7); }
function addOp(sig, type) {
  const schema = S.ops[type]?.params || {};
  const params = {};
  for (const [pn, pd] of Object.entries(schema)) if (!pd.optional) params[pn] = pd.default;
  if (type === 'gain' && !('value' in params)) params.value = 1.0;
  S.chains[sig] = [...(S.chains[sig] || []), { id: uid(type), type, enabled: true, params }];
  renderChain(); pushChain(sig);
}
function removeOp(i) { S.chains[S.selected].splice(i, 1); renderChain(); pushChain(S.selected); }
function moveOp(i, d) { const c = S.chains[S.selected]; const j = i + d; if (j < 0 || j >= c.length) return; [c[i], c[j]] = [c[j], c[i]]; renderChain(); pushChain(S.selected); }

// ── source selector (Test / Mic / File) ─────────────────────────────────────
function buildSourceBar() {
  const box = $('sourcebar'); if (!box) return; box.innerHTML = '';
  const seg = el('div', 'seg');
  for (const [m, label] of [['test', 'Test'], ['mic', 'Mic / Line'], ['file', 'File']]) {
    const b = el('button', 'seg-btn' + (S.mode === m ? ' active' : ''), label);
    b.onclick = () => {
      if (m === 'file') {
        S.mode = 'file'; buildSourceBar();           // reveal inline input
        openBrowse(S.browseDir || S.datasetsDir);    // and open the file browser
        return;
      }
      if (m === 'mic') {
        S.mode = 'mic'; buildSourceBar();            // reveal the device picker
        send({ type: 'listDevices' });               // populate it (like CaptainPad)
        send({ type: 'setMode', mode: 'mic', device: S.device || null });
        return;
      }
      send({ type: 'setMode', mode: m }); S.mode = m; buildSourceBar();
    };
    seg.appendChild(b);
  }
  box.appendChild(seg);

  // File input (shown in file mode).
  const fwrap = el('span', 'file-wrap' + (S.mode === 'file' ? ' show' : ''));
  const inp = el('input', 'file-input'); inp.id = 'file-path'; inp.placeholder = '/path/to/track.mp3'; inp.value = S.filePath || '';
  inp.oninput = () => { S.filePath = inp.value; };
  const go = el('button', 'file-go', 'Load'); go.onclick = () => { const f = inp.value.trim(); if (f) send({ type: 'setMode', mode: 'file', file: f }); };
  fwrap.appendChild(inp); fwrap.appendChild(go); box.appendChild(fwrap);

  // Device picker (shown in mic mode) — CaptainPad-style: list inputs, pick one.
  const mwrap = el('span', 'mic-wrap' + (S.mode === 'mic' ? ' show' : ''));
  const sel = el('select', 'device-select'); sel.id = 'device-select';
  const def = el('option', null, 'Default input'); def.value = ''; if (!S.device) def.selected = true; sel.appendChild(def);
  for (const d of (S.devices || [])) {
    const o = el('option', null, d.label || d.id); o.value = d.ffmpegDevice || '';
    if (d.ffmpegDevice && d.ffmpegDevice === S.device) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => { S.device = sel.value; send({ type: 'setMode', mode: 'mic', device: sel.value || null }); flash('input: ' + (sel.selectedOptions[0]?.textContent || 'default')); };
  const refresh = el('button', 'file-go', '⟳'); refresh.title = 'refresh device list'; refresh.onclick = () => send({ type: 'listDevices' });
  mwrap.appendChild(sel); mwrap.appendChild(refresh);
  box.appendChild(mwrap);

  const tag = el('span', 'src-tag', S.mode === 'test' ? 'synthetic source' : S.mode === 'mic' ? `live input · ${S.devices.length} device${S.devices.length === 1 ? '' : 's'}` : 'file replay');
  box.appendChild(tag);
}

// ── server-side file browser (defaults to the datasets dir) ─────────────────
function openBrowse(dir) {
  $('browse-modal').style.display = 'flex';
  fetch('/browse?dir=' + encodeURIComponent(dir || ''))
    .then(r => r.json())
    .then((d) => {
      if (d.error) { flash('browse: ' + d.error, true); return; }
      S.browseDir = d.dir;
      $('browse-path').textContent = d.dir;
      $('browse-up').onclick = () => openBrowse(d.parent);
      const list = $('browse-list'); list.innerHTML = '';
      if (!d.entries.length) list.appendChild(el('div', 'browse-empty', 'no folders or audio files here'));
      for (const e of d.entries) {
        const row = el('button', 'browse-row ' + (e.isDir ? 'dir' : 'file'),
          `<span class="bi">${e.isDir ? '📁' : '♪'}</span><span class="bn">${e.name}</span>`);
        row.onclick = e.isDir ? () => openBrowse(e.path) : () => pickFile(e.path);
        list.appendChild(row);
      }
    })
    .catch(err => flash('browse failed: ' + err.message, true));
}
function pickFile(p) {
  S.filePath = p; S.mode = 'file';
  send({ type: 'setMode', mode: 'file', file: p });
  $('browse-modal').style.display = 'none';
  buildSourceBar(); flash('loaded ' + p.split(/[/\\]/).pop());
}
$('browse-close').onclick = () => $('browse-modal').style.display = 'none';

// ── live readouts: dom-freq + structure ─────────────────────────────────────
function renderLive() {
  const d = S.dom, st = S.struct;
  $('dom1-f').textContent = (d.f1 || 0).toFixed(0) + ' Hz';
  $('dom2-f').textContent = (d.f2 || 0).toFixed(0) + ' Hz';
  $('dom1-bar').style.width = (clamp01(d.e1) * 100).toFixed(0) + '%';
  $('dom2-bar').style.width = (clamp01(d.e2) * 100).toFixed(0) + '%';
  $('dom1-e').textContent = clamp01(d.e1).toFixed(2);
  $('dom2-e').textContent = clamp01(d.e2).toFixed(2);
  const SN = { 0: 'THIN', 1: 'BUILD', 2: 'SUSTAIN' };
  const sName = SN[Math.round(st.state)] || 'THIN';
  const pill = $('state-pill'); pill.textContent = sName; pill.className = 'state-pill s-' + sName.toLowerCase();
  $('build-bar').style.width = (clamp01(st.build) * 100).toFixed(0) + '%';
  $('energy-bar').style.width = (clamp01(st.energy) * 100).toFixed(0) + '%';
  $('slow-bar').style.width = (clamp01(st.slow) * 100).toFixed(0) + '%';
  // drop pulse / fired flash
  S.dropFlash *= 0.9; if (S.dropFlash < 0.02) S.dropFlash = 0;
  const glow = Math.max(clamp01(st.pulse), S.dropFlash);
  $('drop-flash').style.opacity = glow.toFixed(2);
}

// ── export modal ────────────────────────────────────────────────────────────
function showExport(text) {
  $('export-text').value = text;
  $('export-modal').style.display = 'flex';
}
$('export-btn').onclick = () => send({ type: 'export' });
$('export-close').onclick = () => $('export-modal').style.display = 'none';
$('export-copy').onclick = () => { navigator.clipboard?.writeText($('export-text').value); flash('copied'); };

// ── render loop (canvases) ──────────────────────────────────────────────────
function draw() {
  // main trace (S.trace is empty until the first `hello` populates it).
  const sig = S.selected;
  const tr = S.trace[sig];
  if (tr) drawTrace($('trace').getContext('2d'), tr, accent(sig), 2);
  const lv = S.live[sig] || { raw: 0, post: 0 };
  $('big-raw').textContent = clamp01(lv.raw).toFixed(2);
  $('big-post').textContent = clamp01(lv.post).toFixed(2);
  $('big-post').style.color = accent(sig);
  // sidebar minis + values
  for (const s of S.signals) {
    const c = document.getElementById('mini-' + s); if (c && S.trace[s]) drawMini(c.getContext('2d'), S.trace[s], accent(s));
    const v = document.getElementById('sv-' + s); if (v) v.textContent = clamp01((S.live[s] || {}).post || 0).toFixed(2);
  }
  renderLive();
  requestAnimationFrame(draw);
}
function trLine(ctx, buf, W, H, lw, alpha) {
  const step = W / (TRAIL - 1);
  ctx.globalAlpha = alpha; ctx.lineWidth = lw; ctx.beginPath();
  for (let i = 0; i < TRAIL; i++) { const idx = (S.head + i) % TRAIL; const x = i * step, y = H * (1 - buf[idx]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
  ctx.stroke(); ctx.globalAlpha = 1;
}
function drawTrace(ctx, tr, color, lw) {
  const W = ctx.canvas.width, H = ctx.canvas.height; ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  for (let g = 1; g < 4; g++) { const y = H * g / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.strokeStyle = color; trLine(ctx, tr.raw, W, H, 1, 0.30); trLine(ctx, tr.post, W, H, lw, 1);
}
function drawMini(ctx, tr, color) {
  const W = ctx.canvas.width, H = ctx.canvas.height; ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = color; trLine(ctx, tr.post, W, H, 1.3, 1);
}

connect();
requestAnimationFrame(draw);
