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
  dom1:    { label: 'DOM1', accent: '#f0a23b' },
  dom2:    { label: 'DOM2', accent: '#c084fc' },
};
const DOM_SIGNALS = ['dom1', 'dom2'];          // derived from the frame's dom{}
const VIEWS = [{ id: 'spectrum', label: 'SPECTRUM' }, { id: 'wave', label: 'WAVEFORM' }];
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
  inputGain: 1.0,     // global software preamp (analyzer bands.inputGain)
  cal: { phase: 'idle', result: null },
  dom: { f1: 0, e1: 0, f2: 0, e2: 0 },
  struct: { state: 0, build: 0, energy: 0, pulse: 0, slow: 0 },
  dropFlash: 0,
  spectrum: [],       // full freq-band visualizer (log-spaced magnitudes)
  wave: [],           // audio-signal visualizer (oscilloscope)
  derived: { bpm: 0, beat: 0, party: 0, note: 0, hue: 0, sp: 0, sc: 0 },
  spFlash: 0, scFlash: 0,
};
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
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
      S.signals = [...m.signals, ...DOM_SIGNALS]; S.chainable = m.signals;
      S.ops = m.ops; S.chains = m.chains; S.source = m.source; S.gains = m.gains;
      if (m.mode) S.mode = m.mode;
      if (m.datasetsDir) { S.datasetsDir = m.datasetsDir; S.browseDir = m.datasetsDir; }
      if (m.inputGain != null) S.inputGain = m.inputGain;
      for (const s of S.signals) S.trace[s] = { raw: new Float32Array(TRAIL), post: new Float32Array(TRAIL) };
      buildSidebar(); buildSource(); renderChain(); buildSourceBar(); buildGainBar();
    } else if (m.type === 'frame') {
      // Only update the LATEST value here; the scrolling trace is advanced in
      // the draw loop at a steady 60 fps. Mic capture delivers frames in
      // bursts, so advancing the trace per-message made the scroll jerky.
      for (const s in m.signals) { const v = m.signals[s]; if (v) S.live[s] = v; }
      if (m.dom) {
        S.dom = m.dom;
        S.live.dom1 = { raw: m.dom.e1, post: m.dom.e1 };   // dom energy as a signal
        S.live.dom2 = { raw: m.dom.e2, post: m.dom.e2 };
      }
      if (m.struct) S.struct = m.struct;
      if (m.spectrum) S.spectrum = m.spectrum;
      if (m.wave) S.wave = m.wave;
      if (m.derived) {
        if (m.derived.sp > 0.5 && S.derived.sp <= 0.5) S.spFlash = 1;
        if (m.derived.sc > 0.5 && S.derived.sc <= 0.5) S.scFlash = 1;
        S.derived = m.derived;
      }
    } else if (m.type === 'dropFired') {
      S.dropFlash = 1; flash('▼ DROP ' + (m.confidence != null ? m.confidence.toFixed(2) : ''));
    } else if (m.type === 'sourceStatus') {
      S.mode = m.mode; buildSourceBar();
      if (m.status && m.status.error) flash((m.status.needsDevice ? 'pick an input device — ' : 'source: ') + m.status.error, true);
    } else if (m.type === 'inputGain') {
      S.inputGain = m.value; buildGainBar();
    } else if (m.type === 'calStatus') {
      S.cal.phase = m.phase; if (m.phase === 'recording') S.cal.result = null; renderCal();
    } else if (m.type === 'calResult') {
      S.cal.result = m; renderCal();
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
  // dom1/dom2 + the visualizer views are read-only — no editable chain.
  if (!S.chainable || !S.chainable.includes(sig)) {
    box.appendChild(el('div', 'chain-note', 'read-only signal — no post-processing chain'));
    return;
  }
  const chain = S.chains[sig] || [];
  chain.forEach((op, i) => {
    const card = el('div', 'op');
    card.style.setProperty('--acc', accent(sig));
    const opLabel = op.type === 'lpf' ? 'lpf <span class="op-tag">(smooth)</span>' : op.type;
    const head = el('div', 'op-head', `<span class="op-type">${opLabel}</span>`);
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
      const min = pdef.min ?? 0, max = pdef.max ?? 1, step = stepFor(min, max);
      const head = el('div', 'param-head');
      head.appendChild(el('span', 'pn', pname));
      // Editable number box — type an exact value (server validateChain still
      // bounds it; an invalid entry flashes via chainResult).
      const num = el('input', 'pv-input'); num.type = 'number'; num.step = step; num.value = fmt(cur);
      head.appendChild(num);
      row.appendChild(head);
      const r = el('input', 'param-range'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = cur;
      r.oninput = () => { op.params[pname] = +r.value; num.value = fmt(+r.value); };
      r.onchange = () => pushChain(sig);
      num.onchange = () => {
        let v = parseFloat(num.value); if (Number.isNaN(v)) { num.value = fmt(op.params[pname] ?? cur); return; }
        op.params[pname] = v;
        r.value = Math.max(min, Math.min(max, v));   // clamp the SLIDER only; param keeps the typed value
        pushChain(sig);
      };
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
  const go = el('button', 'file-go', 'Load'); go.onclick = () => { const f = inp.value.trim(); if (f) { send({ type: 'setMode', mode: 'file', file: f }); const bm = $('browse-modal'); if (bm) bm.style.display = 'none'; } };
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

// ── input gain + calibration ────────────────────────────────────────────────
function buildGainBar() {
  const box = $('gainbar'); if (!box) return; box.innerHTML = '';
  const gw = el('span', 'gain-wrap', '<span class="gain-lab">INPUT GAIN</span>');
  const r = el('input', 'gain-range'); r.type = 'range'; r.min = 0; r.max = 16; r.step = 0.1; r.value = S.inputGain ?? 1;
  const val = el('span', 'gain-val'); val.id = 'gain-val'; val.textContent = '×' + (S.inputGain ?? 1).toFixed(1);
  r.oninput = () => { S.inputGain = +r.value; val.textContent = '×' + (+r.value).toFixed(1); send({ type: 'setInputGain', value: +r.value }); };
  gw.appendChild(r); gw.appendChild(val); box.appendChild(gw);
  const cal = el('button', 'cal-btn', '● Calibrate (5s)'); cal.id = 'cal-btn';
  cal.onclick = () => send({ type: 'calibrate' });
  box.appendChild(cal);
  const res = el('span', 'cal-res'); res.id = 'cal-res'; box.appendChild(res);
  renderCal();
}
function renderCal() {
  const btn = $('cal-btn'), res = $('cal-res'); if (!btn || !res) return;
  const ph = S.cal.phase;
  btn.classList.toggle('rec', ph === 'recording');
  btn.textContent = ph === 'recording' ? '● recording…' : ph === 'replaying' ? '▷ replaying…' : '● Calibrate (5s)';
  res.innerHTML = '';
  const r = S.cal.result;
  if (r && ph !== 'recording') {
    const txt = el('span', null, `peak <b>${r.peak.toFixed(2)}</b> · ${r.verdict} · suggest <b>×${r.recommendedGain.toFixed(1)}</b> `);
    res.appendChild(txt);
    if (Math.abs(r.recommendedGain - r.currentGain) > 0.05) {
      const apply = el('button', 'cal-apply', 'Apply'); apply.onclick = () => {
        S.inputGain = r.recommendedGain; send({ type: 'setInputGain', value: r.recommendedGain });
        buildGainBar(); flash('gain → ×' + r.recommendedGain.toFixed(1));
      };
      res.appendChild(apply);
    }
  }
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
  // derived signals
  const dv = S.derived;
  if ($('bpm-val')) {
    $('bpm-val').textContent = dv.bpm > 0 ? dv.bpm.toFixed(0) : '—';
    const pp = $('party-pill'); pp.textContent = dv.party > 0.5 ? 'PARTY' : 'calm'; pp.className = 'party-pill' + (dv.party > 0.5 ? ' on' : '');
    const nn = $('note-val'); const pc = Math.round(dv.note);
    nn.textContent = NOTE_NAMES[pc] || '—'; nn.style.color = `hsl(${(dv.hue * 360).toFixed(0)},70%,60%)`;
    $('beat-dot').style.opacity = clamp01(dv.beat).toFixed(2);
    S.spFlash *= 0.85; S.scFlash *= 0.85;
    $('sp-flash').style.opacity = S.spFlash.toFixed(2);
    $('sc-flash').style.opacity = S.scFlash.toFixed(2);
  }
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
  // Advance the scrolling trace at the steady render rate from the latest
  // values (decoupled from bursty WS arrival → smooth animation on mic too).
  if (S.signals.length) {
    for (const s of S.signals) {
      const tr = S.trace[s]; if (!tr) continue;
      const lv = S.live[s] || { raw: 0, post: 0 };
      tr.raw[S.head] = clamp01(lv.raw); tr.post[S.head] = clamp01(lv.post);
    }
    S.head = (S.head + 1) % TRAIL;
  }
  // selected signal trace (main panel)
  const sig = S.selected;
  const tr = S.trace[sig];
  if (tr) drawTrace($('trace').getContext('2d'), tr, accent(sig), 2);
  const lv = S.live[sig] || { raw: 0, post: 0 };
  // dom1/dom2 show their frequency in the readout; bands show raw/post.
  if (sig === 'dom1' || sig === 'dom2') {
    $('big-raw').textContent = (sig === 'dom1' ? S.dom.f1 : S.dom.f2).toFixed(0) + ' Hz';
  } else {
    $('big-raw').textContent = clamp01(lv.raw).toFixed(2);
  }
  $('big-post').textContent = clamp01(lv.post).toFixed(2);
  $('big-post').style.color = accent(sig);
  // GLOBAL visualizers (always on, for every signal view)
  drawSpectrum($('spectrum').getContext('2d'), S.spectrum, S.dom);
  drawWave($('wave').getContext('2d'), S.wave);
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

// ── spectrum + waveform (global visualizers) ────────────────────────────────
const SPEC_MIN_HZ = 20, SPEC_MAX_HZ = 22050;
const freqToX = (f, W) => (f <= SPEC_MIN_HZ ? 0 : Math.log(f / SPEC_MIN_HZ) / Math.log(SPEC_MAX_HZ / SPEC_MIN_HZ) * W);
let specSmooth = null;   // temporal EMA of the spectrum bins (smooth bars)
function drawSpectrum(ctx, spec, dom) {
  const W = ctx.canvas.width, H = ctx.canvas.height; ctx.clearRect(0, 0, W, H);
  // log-frequency grid + labels
  ctx.font = '9px monospace';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const x = freqToX(f, W);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.fillStyle = '#556'; ctx.fillText(f >= 1000 ? (f / 1000) + 'k' : String(f), x + 2, H - 3);
  }
  // dom cluster windows (shaded) behind the bars
  if (dom) {
    drawWindow(ctx, dom.lo1, dom.hi1, '240,162,59', W, H);
    drawWindow(ctx, dom.lo2, dom.hi2, '192,132,252', W, H);
  }
  // spectrum as a SMOOTH FILLED CURVE (not bars): temporal EMA (no flicker) +
  // light 3-tap spatial smoothing (no stair-steps) + quadratic curve through
  // the bin tops with a gradient fill.
  if (spec && spec.length) {
    const n = spec.length;
    if (!specSmooth || specSmooth.length !== n) specSmooth = new Float32Array(n);
    const a = 0.35;
    for (let i = 0; i < n; i++) specSmooth[i] = a * clamp01(spec[i]) + (1 - a) * specSmooth[i];
    const px = new Array(n), py = new Array(n);
    for (let i = 0; i < n; i++) {
      const v = 0.25 * specSmooth[Math.max(0, i - 1)] + 0.5 * specSmooth[i] + 0.25 * specSmooth[Math.min(n - 1, i + 1)];
      px[i] = (i / (n - 1)) * W; py[i] = H - v * H;
    }
    const curve = () => { ctx.moveTo(px[0], py[0]); for (let i = 0; i < n - 1; i++) { const mx = (px[i] + px[i + 1]) / 2, my = (py[i] + py[i + 1]) / 2; ctx.quadraticCurveTo(px[i], py[i], mx, my); } ctx.lineTo(px[n - 1], py[n - 1]); };
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(px[0], py[0]); curve(); ctx.lineTo(W, H); ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(78,161,255,0.45)'); grad.addColorStop(1, 'rgba(78,161,255,0.03)');
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = '#6db0ff'; ctx.lineWidth = 1.5; ctx.beginPath(); curve(); ctx.stroke();
  }
  // dom1/dom2 location markers
  if (dom) {
    drawMarker(ctx, dom.f1, '#f0a23b', 'dom1', W, H);
    drawMarker(ctx, dom.f2, '#c084fc', 'dom2', W, H);
  }
}
function drawWindow(ctx, lo, hi, rgb, W, H) {
  if (!(hi > lo)) return; const x0 = freqToX(lo, W), x1 = freqToX(hi, W);
  ctx.fillStyle = `rgba(${rgb},0.15)`; ctx.fillRect(x0, 0, Math.max(2, x1 - x0), H);
}
function drawMarker(ctx, f, color, label, W, H) {
  if (!(f > 0)) return; const x = freqToX(f, W);
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  ctx.fillStyle = color; ctx.font = '10px monospace'; ctx.fillText(`${label} ${f.toFixed(0)}Hz`, x + 3, 11);
}
function drawWave(ctx, wave) {
  const W = ctx.canvas.width, H = ctx.canvas.height; ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  if (!wave || !wave.length) return;
  ctx.strokeStyle = '#34d3b5'; ctx.lineWidth = 1.3; ctx.beginPath();
  const n = wave.length, step = W / (n - 1), yOf = (v) => H / 2 - v * (H / 2 * 0.92);
  // quadratic-smoothed polyline through the samples → a continuous wave, not steps
  ctx.moveTo(0, yOf(wave[0]));
  for (let i = 0; i < n - 1; i++) {
    const x1 = i * step, y1 = yOf(wave[i]), mx = (x1 + (i + 1) * step) / 2, my = (y1 + yOf(wave[i + 1])) / 2;
    ctx.quadraticCurveTo(x1, y1, mx, my);
  }
  ctx.lineTo(W, yOf(wave[n - 1]));
  ctx.stroke();
}

connect();
requestAnimationFrame(draw);
