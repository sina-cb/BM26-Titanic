/*
 * companion_app.js — Audio Companion SIGNAL DESIGNER frontend.
 *
 * A TouchDesigner-flavoured designer for the engine's audio signals: ADD a
 * signal from a raw source (intensity band or dom frequency), build its op
 * pipeline (the REAL engine ops, TYPE-AWARE), terminate it with an `osc_out`
 * tap to send it to the engine over OSC, watch the RAW→POST trace live, and
 * export the design to companion_config.yaml. All DSP is server-side (the
 * engine's real code); this file only renders + sends edits. Vanilla JS, no
 * deps, offline (no CDNs/fonts).
 */
'use strict';

// Per-source accent colors for the sidebar / traces.
const SOURCE_ACCENT = {
  rawLow: '#34d3b5', rawMid: '#4ea1ff', rawHigh: '#8b9bff',
  rawKick: '#ff5d6c', rawFlux: '#c084fc', rawDom1: '#f0a23b', rawDom2: '#c084fc',
  rawDom1Energy: '#f0c23b', rawDom2Energy: '#d0a4fc',
};
// Per-view-signal overlay palette (trace-overlay colours, cycled per signal).
const OVERLAY_COLORS = ['#34d3b5', '#4ea1ff', '#f0a23b', '#ff5d6c', '#c084fc', '#8b9bff', '#7CFC00'];
const TRAIL = 360;

const S = {
  ops: {}, frequencyOps: [], frequencyOnlyOps: [], rawSources: {}, signalTypes: [],
  synths: [],          // [{ name, label, description }] — selectable test synths

  signals: [],         // [{ id, label, source, type, chain, output }]
  views: [],           // [{ id, label, type, signals:[signalId...] }] — VISUALIZERS
  viewTypes: {},       // { typeId: { label, accepts } } — viz type registry
  osc: { host: '127.0.0.1', port: 10000 },
  selected: 'input',
  trace: {},           // signalId -> {raw:Float32Array, post:Float32Array}
  head: 0,
  live: {},            // signalId -> {raw, post}
  connected: false,
  mode: 'test',
  filePath: '',
  datasetsDir: '',
  browseDir: '',
  devices: [],
  device: '',
  inputGain: 1.0,
  sourceSmoothHz: 12000,
  engineLinkConnected: false,   // SHARED-tuning sync to the engine is live
  cal: { phase: 'idle', result: null },
  dom: { f1: 0, e1: 0, f2: 0, e2: 0 },
  struct: { state: 0, build: 0, energy: 0, pulse: 0, slow: 0 },
  dropFlash: 0,
  spectrum: [],
  wave: [],
  derived: { bpm: 0, beat: 0, party: 0, note: 0, hue: 0, sp: 0, sc: 0 },
  spFlash: 0, scFlash: 0,
};
// Per-op-param SANE slider ranges (a UI concern — client-side).
const UI_RANGE = {
  gain:       { value: { min: 0, max: 4, step: 0.05 } },
  bias:       { value: { min: -1, max: 1, step: 0.01 } },
  clamp:      { min: { min: 0, max: 1, step: 0.01 }, max: { min: 0, max: 1, step: 0.01 } },
  lpf:        { cutoffHz: { min: 0.1, max: 40, step: 0.1 } },
  envelope:   { attackMs: { min: 0, max: 200, step: 1 }, releaseMs: { min: 0, max: 600, step: 1 } },
  schmitt:    { tHigh: { min: 0, max: 1, step: 0.01 }, tLow: { min: 0, max: 1, step: 0.01 }, refractoryMs: { min: 0, max: 1000, step: 5 } },
  hold:       { timeoutMs: { min: 0, max: 2000, step: 10 }, decayMs: { min: 0, max: 2000, step: 10 } },
  curve:      { gamma: { min: 0.1, max: 5, step: 0.1 } },
  slew:       { maxStepPerSec: { min: 0, max: 20, step: 0.1 } },
  compressor: { threshold: { min: 0, max: 1, step: 0.01 }, ratio: { min: 1, max: 20, step: 0.1 }, attackMs: { min: 0, max: 200, step: 1 }, releaseMs: { min: 0, max: 600, step: 1 } },
  biquad:     { cutoffHz: { min: 0.1, max: 40, step: 0.1 }, Q: { min: 0.1, max: 10, step: 0.05 } },
  slope:      { scale: { min: 0, max: 20, step: 0.1 } },
  normalizer: { windowSec: { min: 1, max: 60, step: 1 }, strength: { min: 0, max: 1, step: 0.01 } },
};
// Hz-domain slider ranges for clamp/slew when they sit on a FREQUENCY signal.
// On an intensity signal clamp's min/max live in [0,1] and slew's rate in
// [0,20] Hz/s — but on a frequency signal the value is Hz (up to Nyquist), so
// those intensity ranges squash/freeze the dom freq. The typed number input is
// still unbounded (the validator allows Hz up to Nyquist); this only widens the
// SLIDER so the operator can actually reach Hz-sane values. Intensity ranges
// (UI_RANGE) are untouched. (2026-06-17 contract §"freq-domain clamp/slew".)
const UI_RANGE_HZ = {
  clamp: { min: { min: 0, max: 8000, step: 10 }, max: { min: 0, max: 8000, step: 10 } },
  slew:  { maxStepPerSec: { min: 0, max: 5000, step: 10 } },
};
function sliderRange(opType, pname, pdef, signalType) {
  if (signalType === 'frequency') {
    const hzUi = UI_RANGE_HZ[opType]?.[pname];
    if (hzUi) return hzUi;
  }
  const ui = UI_RANGE[opType]?.[pname];
  if (ui) return ui;
  const min = pdef.min ?? 0, max = pdef.max ?? 1;
  return { min, max, step: stepFor(min, max) };
}
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
let ws = null;
const frameQueue = [];

// ── WS ─────────────────────────────────────────────────────────────────────
function connect() {
  const url = `ws://${location.hostname || 'localhost'}:${location.port || 6973}/ws`;
  ws = new WebSocket(url);
  ws.onopen = () => { S.connected = true; setStatus('● live', 'ok'); };
  ws.onclose = () => { S.connected = false; setStatus('disconnected', 'err'); setTimeout(connect, 1500); };
  ws.onerror = () => setStatus('ws error', 'err');
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'hello') {
      S.ops = m.ops; S.frequencyOps = m.frequencyOps || []; S.frequencyOnlyOps = m.frequencyOnlyOps || []; S.rawSources = m.rawSources || {};
      S.signalTypes = m.signalTypes || []; S.signals = m.signals || []; S.osc = m.osc || S.osc;
      S.views = m.views || []; S.viewTypes = m.viewTypes || {};
      S.synths = m.synths || [];
      S.source = m.source;
      if (m.mode) S.mode = m.mode;
      if (m.device != null) S.device = m.device;
      if (m.datasetsDir) { S.datasetsDir = m.datasetsDir; S.browseDir = m.datasetsDir; }
      if (m.inputGain != null) S.inputGain = m.inputGain;
      if (m.sourceSmoothHz != null) S.sourceSmoothHz = m.sourceSmoothHz;
      if (m.engineLink) S.engineLinkConnected = !!m.engineLink.connected;
      seedTraces();
      frameQueue.length = 0;
      buildSidebar(); buildSource(); renderChain(); buildSourceBar(); buildGainBar();
      // Boot in mic mode → load the device list so the dropdown resolves the
      // configured device (hello.device) to its real label and shows it
      // selected, instead of stranding on "Default input".
      if (S.mode === 'mic') send({ type: 'listDevices' });
    } else if (m.type === 'frame') {
      frameQueue.push(m);
    } else if (m.type === 'frames') {
      frameQueue.push(...m.frames);
    } else if (m.type === 'dropFired') {
      S.dropFlash = 1; flash('▼ DROP ' + (m.confidence != null ? m.confidence.toFixed(2) : ''));
    } else if (m.type === 'sourceStatus') {
      S.mode = m.mode; buildSourceBar();
      frameQueue.length = 0;
      if (m.status && m.status.error) flash((m.status.needsDevice ? 'pick an input device — ' : 'source: ') + m.status.error, true);
    } else if (m.type === 'inputGain') {
      S.inputGain = m.value; buildGainBar();
    } else if (m.type === 'smooth') {
      S.sourceSmoothHz = m.value; if (S.selected === 'input') renderChain();
    } else if (m.type === 'engineLink') {
      // Engine SHARED-tuning sync status (single source of truth). When
      // connected, gain/smooth/device mirror the engine + CaptainPad live.
      // When down, we degrade gracefully (analyzing on local tuning). Surface
      // errors / offline notes so a local-only divergence can't hide.
      S.engineLinkConnected = !!m.connected;
      if (m.error) flash('engine sync: ' + m.error, true);
      else if (m.note) flash(m.note, true);
    } else if (m.type === 'engineDevice') {
      // Shared mic device pushed from the engine (CaptainPad / engine picked
      // it). Mirror the picker selection.
      if (m.device != null) S.device = m.device;
      buildSourceBar();
    } else if (m.type === 'flash') {
      flash(m.text, !!m.error);
    } else if (m.type === 'calStatus') {
      S.cal.phase = m.phase; if (m.phase === 'recording') S.cal.result = null; renderCal();
    } else if (m.type === 'calResult') {
      S.cal.result = m; renderCal();
    } else if (m.type === 'devices') {
      S.devices = m.devices || [];
      if (m.error) flash('devices: ' + m.error, true);
      buildSourceBar();
    } else if (m.type === 'signals') {
      S.signals = m.signals || []; seedTraces();
      if (!signalById(S.selected) && S.selected !== 'input' && !viewById(S.selected)) S.selected = 'input';
      buildSidebar(); renderChain();
    } else if (m.type === 'views') {
      S.views = m.views || [];
      // The selected view may have been removed (or never existed) — fall back
      // to INPUT so the stage never points at a dead view.
      if (!signalById(S.selected) && S.selected !== 'input' && !viewById(S.selected)) S.selected = 'input';
      buildSidebar(); renderChain();
    } else if (m.type === 'addViewResult') {
      if (m.ok) { S.selected = m.view.id; buildSidebar(); renderChain(); flash('added view ' + m.view.label); }
      else flash('add view failed: ' + m.error, true);
    } else if (m.type === 'removeViewResult') {
      if (!m.ok) flash('remove view failed: ' + m.error, true);
    } else if (m.type === 'addResult') {
      if (m.ok) { S.selected = m.signal.id; buildSidebar(); renderChain(); flash('added ' + m.signal.label); }
      else flash('add failed: ' + m.error, true);
    } else if (m.type === 'removeResult') {
      if (!m.ok) flash('remove failed: ' + m.error, true);
    } else if (m.type === 'chainResult') {
      if (m.ok) {
        const sig = signalById(m.id); if (sig) { sig.chain = m.signal.chain; sig.output = m.signal.output; }
        if (m.id === S.selected) renderChain();
        flash('saved');
      } else flash('invalid: ' + m.error, true);
    } else if (m.type === 'export') {
      showExport(m.yaml);
    } else if (m.type === 'exportSaved') {
      if (m.ok) flash('written → ' + (m.path || 'companion_config.yaml'));
      else flash('write failed: ' + m.error, true);
    }
  };
}
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const pushChain = (id) => { const sig = signalById(id); if (sig) send({ type: 'setChain', id, chain: sig.chain }); };

// ── helpers ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp01 = (x) => (x > 1 ? 1 : x > 0 ? x : 0);
const signalById = (id) => S.signals.find(s => s.id === id);
const viewById = (id) => S.views.find(v => v.id === id);
const accent = (id) => { const s = signalById(id); return s ? (SOURCE_ACCENT[s.source] || '#9aa') : '#9aa'; };
// A signal's DISPLAY NAME is its osc_out `name` (single-name rehaul) — the one
// operator-facing identifier that ALSO derives the engine cpcKey + OSC address
// and is the label shown in CaptainPad. Falls back to the source label when
// the chain has no osc_out tap. The internal id is never the name.
function signalName(sig) {
  if (!sig) return '';
  const tap = sig.chain && sig.chain.find(o => o.type === 'osc_out');
  const name = tap && tap.params && tap.params.name;
  return (typeof name === 'string' && name.trim()) ? name.trim() : sig.label;
}

// Client-side mirror of the server's resolveOscOut (companion_config.js) — used
// ONLY for the read-only "→ address" hint under the name field. A curated name
// keeps its canonical engine-bound address; any other name slug-derives. Keep
// in sync with CURATED_OUTPUTS / slug there.
const CURATED_OUTPUTS = {
  micLow: '/marsin/mic/low', micMid: '/marsin/mic/mid', micHigh: '/marsin/mic/high',
  micKick: '/marsin/mic/kick', micDomFreq1: '/marsin/dom/freq1', micDomFreq2: '/marsin/dom/freq2',
  micDomEnergy1: '/marsin/dom/energy1', micDomEnergy2: '/marsin/dom/energy2',
};
function slugName(name) {
  return (typeof name === 'string' ? name : '')
    .trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
function oscAddressForName(name) {
  if (CURATED_OUTPUTS[name]) return CURATED_OUTPUTS[name];
  const s = slugName(name);
  return s ? `/marsin/audio/${s}` : '(invalid name)';
}
function setStatus(t, c) { const e = $('status'); e.textContent = t; e.className = 'status ' + (c || ''); }
let flashT = 0;
function flash(t, bad) { const e = $('flash'); e.textContent = t; e.style.color = bad ? '#ff5d6c' : '#34d3b5'; clearTimeout(flashT); flashT = setTimeout(() => e.textContent = '', 1800); }
function seedTraces() {
  const next = {};
  // Dom split (2026-06-17): freq and energy are now SEPARATE ordinary signals,
  // so every signal carries a single value trace (raw + post) — no per-signal
  // energy overlay. A dom freq signal is freq-only; the dom energy signal is an
  // ordinary intensity signal with its own trace.
  for (const s of S.signals) next[s.id] = S.trace[s.id]
    || { raw: new Float32Array(TRAIL), post: new Float32Array(TRAIL) };
  S.trace = next;
}

// Which op types a signal of the given TYPE may use (contract §type-aware ops).
// Frequency signals only offer Hz-valid ops; intensity signals offer the full
// intensity palette. osc_out is offered to both (terminal tap).
function paletteFor(type) {
  const all = Object.keys(S.ops);
  if (type === 'frequency') return all.filter(t => S.frequencyOps.includes(t));
  // intensity: full palette MINUS frequency-only ops (e.g. danceMaker — the
  // dom-dance spring is meaningless on a [0,1] band; validator rejects it too).
  const freqOnly = S.frequencyOnlyOps || [];
  return all.filter(t => !freqOnly.includes(t));
}

// ── sidebar (signal list) ──────────────────────────────────────────────────
function buildSidebar() {
  const box = $('signals'); box.innerHTML = '';
  // header with the ADD [+] button
  const head = el('div', 'sigs-head');
  head.appendChild(el('span', 'panel-label', 'SIGNALS'));
  const add = el('button', 'sig-add', '+'); add.title = 'add a signal';
  add.onclick = promptAddSignal;
  head.appendChild(add);
  box.appendChild(head);

  // INPUT — the source post-proc stage (gain + smoothing) feeding the pipeline.
  const inRow = el('button', 'sig-row input-row' + ('input' === S.selected ? ' active' : ''));
  inRow.innerHTML = '<span class="sig-name">◤ INPUT</span><span class="sig-sub">source · pre-FFT</span>';
  inRow.onclick = () => { S.selected = 'input'; buildSidebar(); renderChain(); };
  box.appendChild(inRow);

  for (const s of S.signals) {
    const row = el('button', 'sig-row' + (s.id === S.selected ? ' active' : ''));
    row.style.setProperty('--acc', SOURCE_ACCENT[s.source] || '#9aa');
    row.innerHTML = `<span class="sig-name">${signalName(s)}<span class="sig-type">${s.type}${s.output ? ' · out' : ''}</span></span>
      <span class="sig-mini"><canvas id="mini-${s.id}" width="110" height="26"></canvas></span>
      <span class="sig-val" id="sv-${s.id}">0.00</span>`;
    row.onclick = (e) => { if (e.target.classList.contains('sig-x')) return; S.selected = s.id; buildSidebar(); renderChain(); };
    const x = el('button', 'sig-x', '×'); x.title = 'remove signal';
    x.onclick = (e) => { e.stopPropagation(); removeSignal(s.id); };
    row.appendChild(x);
    box.appendChild(row);
  }
  // VISUALIZERS — custom VIEWS that MIX/overlay a chosen subset of signals
  // (contract §"Companion custom VIEWS"). Each view is a saved object
  // { id, label, type, signals:[...] }: add via the themed "+ add view" modal,
  // remove via [×], select to show its mixed plot in the main stage. The DOM
  // DANCE is now a dancing-balls view instance (fed dom1+dom2), not a one-off.
  const vhead = el('div', 'sigs-head views-label');
  vhead.appendChild(el('span', 'panel-label', 'VISUALIZERS'));
  const vadd = el('button', 'sig-add', '+'); vadd.title = 'add a view';
  vadd.onclick = promptAddView;
  vhead.appendChild(vadd);
  box.appendChild(vhead);
  for (const v of S.views) {
    const spec = S.viewTypes[v.type];
    const row = el('button', 'sig-row view-row' + (v.id === S.selected ? ' active' : ''));
    row.title = `${spec ? spec.label : v.type} · ${v.signals.length} signal(s)`;
    row.innerHTML = `<span class="sig-name">${v.label}<span class="sig-type">${spec ? spec.label : v.type}</span></span>`;
    row.onclick = (e) => { if (e.target.classList.contains('sig-x')) return; S.selected = v.id; buildSidebar(); renderChain(); };
    const x = el('button', 'sig-x', '×'); x.title = 'remove view';
    x.onclick = (e) => { e.stopPropagation(); removeView(v.id); };
    row.appendChild(x);
    box.appendChild(row);
  }
}

// Adding a VIEW opens a themed modal (no native prompt): a viz-TYPE selector, a
// name field, and a signal MULTI-SELECT filtered to the type's accepted signal
// type (dancing-balls → frequency signals only; trace-overlay → any). Reuses
// the modal/add-card theme. (contract §"Companion custom VIEWS".)
let _addViewType = '';
let _addViewPicked = new Set();
function promptAddView() {
  const types = Object.keys(S.viewTypes);
  _addViewType = types[0] || '';
  _addViewPicked = new Set();
  // Pre-fill a sensible default name from the type label. Clear `touched` so
  // re-opening the modal (after a prior create set it) lets the name keep
  // auto-tracking the selected TYPE again until the operator edits it.
  const nameInp = $('view-name');
  if (nameInp) { delete nameInp.dataset.touched; nameInp.value = S.viewTypes[_addViewType]?.label || 'view'; }
  renderAddViewTypes();
  renderAddViewSignals();
  $('view-modal').style.display = 'flex';
}
function renderAddViewTypes() {
  const wrap = $('view-types'); if (!wrap) return; wrap.innerHTML = '';
  for (const t of Object.keys(S.viewTypes)) {
    const spec = S.viewTypes[t];
    const b = el('button', 'view-type-btn' + (t === _addViewType ? ' active' : ''));
    b.innerHTML = `<span class="vt-label">${spec.label}</span><span class="vt-sub">${spec.accepts ? spec.accepts + ' signals' : 'any signals'}</span>`;
    b.onclick = () => {
      _addViewType = t;
      // Dropping to a type with a stricter accepted type prunes now-invalid picks.
      const acc = S.viewTypes[t].accepts;
      if (acc) for (const id of [..._addViewPicked]) { const s = signalById(id); if (!s || s.type !== acc) _addViewPicked.delete(id); }
      const nameInp = $('view-name');
      if (nameInp && !nameInp.dataset.touched) nameInp.value = spec.label;
      renderAddViewTypes(); renderAddViewSignals();
    };
    wrap.appendChild(b);
  }
}
function renderAddViewSignals() {
  const wrap = $('view-signals'); if (!wrap) return; wrap.innerHTML = '';
  const accepts = S.viewTypes[_addViewType]?.accepts || null;
  const eligible = S.signals.filter(s => !accepts || s.type === accepts);
  if (!eligible.length) {
    wrap.appendChild(el('div', 'browse-empty', accepts ? `no ${accepts} signals to add` : 'no signals to add'));
    return;
  }
  for (const s of eligible) {
    const on = _addViewPicked.has(s.id);
    const card = el('button', 'view-sig-card' + (on ? ' on' : ''));
    card.style.setProperty('--src-accent', SOURCE_ACCENT[s.source] || '#9aa');
    card.innerHTML = `<span class="add-card-label">${signalName(s)}</span><span class="add-card-type">${s.type}</span>`;
    card.onclick = () => { if (_addViewPicked.has(s.id)) _addViewPicked.delete(s.id); else _addViewPicked.add(s.id); renderAddViewSignals(); };
    wrap.appendChild(card);
  }
}
function removeView(id) {
  // Confirm before destroying a view (parity with removeSignal — an accidental
  // [×] tap is otherwise unrecoverable).
  const v = viewById(id);
  if (v && !window.confirm(`Remove view "${v.label}"?`)) return;
  if (S.selected === id) S.selected = 'input';
  send({ type: 'removeView', id });
}

// Adding a signal opens a themed picker (no native prompt) — a grid of the raw
// sources, each card showing its label + type; click adds it and closes.
function promptAddSignal() {
  const grid = $('add-grid');
  grid.innerHTML = '';
  for (const id of Object.keys(S.rawSources)) {
    const src = S.rawSources[id];
    const card = el('button', 'add-card');
    card.style.setProperty('--src-accent', SOURCE_ACCENT[id] || '#9aa');
    card.innerHTML = `<span class="add-card-label">${src.label}</span><span class="add-card-type">${src.type}</span>`;
    card.onclick = () => { send({ type: 'addSignal', source: id }); $('add-modal').style.display = 'none'; };
    grid.appendChild(card);
  }
  $('add-modal').style.display = 'flex';
}
function removeSignal(id) {
  const sig = signalById(id);
  if (sig && !window.confirm(`Remove signal "${signalName(sig)}"?`)) return;
  if (S.selected === id) S.selected = 'input';
  send({ type: 'removeSignal', id });
}

// ── source panel ────────────────────────────────────────────────────────────
function buildSource() {
  const box = $('source'); box.innerHTML = '';
  // SYNTH selector — pick which test SYNTHESIZER drives the 'test' source.
  // Populated from the server catalog (hello.synths); the choice is sent over
  // the same `setSource` WS path as the param knobs.
  if (S.synths && S.synths.length) {
    const cur = (S.source && S.source.synth) || 'tone';
    const sel = el('div', 'synth-select');
    sel.innerHTML = '<div class="synth-head">SYNTH</div>';
    const dd = el('select', 'synth-dd');
    for (const s of S.synths) {
      const o = el('option'); o.value = s.name; o.textContent = s.label || s.name;
      if (s.description) o.title = s.description;
      if (s.name === cur) o.selected = true;
      dd.appendChild(o);
    }
    dd.onchange = () => { S.source.synth = dd.value; send({ type: 'setSource', source: { synth: dd.value } }); };
    sel.appendChild(dd);
    box.appendChild(sel);
  }
  const knobs = [
    ['subLevel', 'SUB', 0, 1], ['midLevel', 'MID', 0, 1], ['highLevel', 'HIGH', 0, 1],
    ['kickLevel', 'KICK', 0, 1], ['kickHz', 'KICK/s', 0, 8], ['noiseLevel', 'NOISE', 0, 0.2],
  ];
  for (const [key, label, min, max] of knobs) {
    const row = el('div', 'knob');
    const val = (S.source && S.source[key]) ?? 0;
    row.innerHTML = `<div class="knob-head"><span>${label}</span><span id="src-${key}">${(+val).toFixed(2)}</span></div>`;
    const r = el('input'); r.type = 'range'; r.min = min; r.max = max; r.step = (max - min) / 200; r.value = val;
    r.oninput = () => { S.source[key] = +r.value; $('src-' + key).textContent = (+r.value).toFixed(2); send({ type: 'setSource', source: { [key]: +r.value } }); };
    row.appendChild(r); box.appendChild(row);
  }
}

// ── chain pipeline (the op nodes — HORIZONTAL row) ──────────────────────────
function renderChain() {
  const box = $('chain'); box.innerHTML = '';
  const sel = S.selected;
  if (sel === 'input') {
    $('chain-title').textContent = 'INPUT · source post-proc → FFT';
    $('chain-title').style.color = '#34d3b5';
    box.appendChild(inputControls());
    return;
  }
  const selView = viewById(sel);
  if (selView) {
    const spec = S.viewTypes[selView.type];
    $('chain-title').textContent = `${selView.label} · ${spec ? spec.label : selView.type} VIEW (read-only)`;
    $('chain-title').style.color = '#f0a23b';
    const names = selView.signals.map(id => { const s = signalById(id); return s ? signalName(s) : id; });
    box.appendChild(el('div', 'chain-note',
      `A VISUALIZER mixing <b>${names.length}</b> signal(s): ${names.length ? names.join(', ') : '<i>none — edit the view</i>'}. `
      + 'Read-only — no editable chain. Remove via [×] in the sidebar.'));
    return;
  }
  const sig = signalById(sel);
  if (!sig) { box.appendChild(el('div', 'chain-note', 'select a signal')); return; }
  const acc = SOURCE_ACCENT[sig.source] || '#9aa';
  $('chain-title').textContent = `${signalName(sig)} · ${sig.type} signal${sig.output ? ' · OUTPUT' : ''}`;
  $('chain-title').style.color = acc;

  // SOURCE HEAD — the raw input that enters the row.
  const srcCard = el('div', 'op op-source');
  srcCard.innerHTML = `<div class="op-head"><span class="op-type">${S.rawSources[sig.source]?.label || sig.source}</span></div>
    <div class="op-src-sub">${sig.source} · ${sig.type}</div>`;
  box.appendChild(srcCard);
  box.appendChild(el('div', 'op-arrow', '→'));

  // The terminal osc_out tap (if any) is ALWAYS the LAST element of the row,
  // and the "+ add op" control sits JUST BEFORE it — so adding an op inserts it
  // into the chain ahead of the tap (contract 2026-06-17). Render order:
  //   source → [ops…] → [+ add op] → osc_out
  const hasOut = sig.chain.length > 0 && sig.chain[sig.chain.length - 1].type === 'osc_out';
  const opCount = hasOut ? sig.chain.length - 1 : sig.chain.length;

  const renderOpCard = (op, i) => {
    const isOut = op.type === 'osc_out';
    const card = el('div', 'op' + (isOut ? ' osc-out' : ''));
    if (!isOut) card.style.setProperty('--acc', acc);
    const opLabel = op.type === 'lpf' ? 'lpf <span class="op-tag">(smooth)</span>'
      : op.type === 'osc_out' ? 'osc_out <span class="op-tag">(→ engine)</span>'
      : op.type === 'danceMaker' ? 'danceMaker <span class="op-tag">(spring OP)</span>' : op.type;
    const head = el('div', 'op-head', `<span class="op-type">${opLabel}</span>`);
    const tools = el('div', 'op-tools');
    const mk = (txt, fn, title) => { const b = el('button', 'op-btn', txt); b.title = title; b.onclick = fn; return b; };
    // osc_out is terminal — it can't move right past itself; allow left moves
    // for non-terminal ops only (osc_out always last).
    if (!isOut) {
      tools.appendChild(mk('◀', () => moveOp(i, -1), 'move left'));
      tools.appendChild(mk('▶', () => moveOp(i, 1), 'move right'));
    }
    tools.appendChild(mk('✕', () => removeOp(i), 'remove'));
    head.appendChild(tools); card.appendChild(head);
    card.appendChild(opParams(sig, op, i));
    box.appendChild(card);
  };

  // Non-terminal ops first (everything before any osc_out tap).
  for (let i = 0; i < opCount; i++) {
    renderOpCard(sig.chain[i], i);
    box.appendChild(el('div', 'op-arrow', '→'));
  }

  // add-op palette — TYPE-AWARE (filtered by the signal's type). It sits BEFORE
  // the terminal osc_out so a new op lands ahead of the tap. (When the chain has
  // no tap yet, this is the last element, as before.)
  const add = el('div', 'op op-add');
  const palette = paletteFor(sig.type);
  const sel2 = el('select', 'add-sel');
  sel2.appendChild(el('option', null, `+ add op (${sig.type})`));
  for (const t of palette) {
    // osc_out is terminal: only offer it if the chain has no tap yet.
    if (t === 'osc_out' && hasOut) continue;
    sel2.appendChild(el('option', null, t));
  }
  sel2.onchange = () => { if (sel2.value && !sel2.value.startsWith('+ add')) { addOp(sig, sel2.value); sel2.selectedIndex = 0; } };
  add.appendChild(sel2);
  box.appendChild(add);

  // The terminal tap LAST (after the add control).
  if (hasOut) {
    box.appendChild(el('div', 'op-arrow', '→'));
    renderOpCard(sig.chain[sig.chain.length - 1], sig.chain.length - 1);
  }
}

function opParams(sig, op, i) {
  const wrap = el('div', 'op-params');
  const schema = S.ops[op.type]?.params || {};
  for (const [pname, pdef] of Object.entries(schema)) {
    if (op.params[pname] === undefined && pdef.optional) continue;
    if (op.type === 'gain' && pname === 'paramKey') {
      if (op.params.paramKey) wrap.appendChild(el('div', 'param-static', `gain ← <b>${op.params.paramKey}</b>`));
      continue;
    }
    if (op.type === 'gain' && pname === 'value' && op.params.paramKey) continue;
    const row = el('div', 'param');
    const cur = op.params[pname] ?? pdef.default;
    if (pdef.type === 'string') {
      row.innerHTML = `<span class="pn">${pname}</span>`;
      if (Array.isArray(pdef.oneOf)) {
        const sel = el('select');
        for (const o of pdef.oneOf) { const opt = el('option', null, o); if (o === cur) opt.selected = true; sel.appendChild(opt); }
        sel.onchange = () => { op.params[pname] = sel.value; pushChain(sig.id); };
        row.appendChild(sel);
      } else {
        // free text — osc_out `name` (the single operator-facing identifier).
        const inp = el('input', 'pv-input'); inp.type = 'text'; inp.style.width = '120px'; inp.style.textAlign = 'left';
        inp.value = cur != null ? cur : '';
        inp.placeholder = (op.type === 'osc_out' && pname === 'name') ? '(name)' : '';
        inp.onchange = () => {
          const v = inp.value.trim();
          if (v === '' && pdef.optional) delete op.params[pname];
          else op.params[pname] = v;
          pushChain(sig.id);
          // The osc_out `name` IS the signal's display name AND derives the
          // CPC key + address — live-update the sidebar label + chain header
          // (and the derived-address hint) the moment it's edited.
          if (op.type === 'osc_out' && pname === 'name') { buildSidebar(); renderChain(); }
        };
        row.appendChild(inp);
        // Read-only derived-address hint: the name SETS the address (the
        // operator never edits it). Shows where this output routes.
        if (op.type === 'osc_out' && pname === 'name') {
          row.appendChild(el('span', 'param-derived', `→ ${oscAddressForName(cur)}`));
        }
      }
    } else {
      const { min, max, step } = sliderRange(op.type, pname, pdef, sig.type);
      const head = el('div', 'param-head');
      head.appendChild(el('span', 'pn', pname));
      const num = el('input', 'pv-input'); num.type = 'number'; num.step = step; num.value = fmt(cur);
      head.appendChild(num);
      row.appendChild(head);
      const r = el('input', 'param-range'); r.type = 'range'; r.min = min; r.max = max; r.step = step;
      r.value = Math.max(min, Math.min(max, cur));
      r.oninput = () => { op.params[pname] = +r.value; num.value = fmt(+r.value); };
      r.onchange = () => pushChain(sig.id);
      num.onchange = () => {
        let v = parseFloat(num.value); if (Number.isNaN(v)) { num.value = fmt(op.params[pname] ?? cur); return; }
        op.params[pname] = v;
        r.value = Math.max(min, Math.min(max, v));
        pushChain(sig.id);
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
// Hz-sane defaults for the Hz-domain ops (clamp/slew) when they're added to a
// FREQUENCY signal. The op-catalog defaults are tuned for [0,1] intensity:
// clamp {min:0,max:1} squashes a dom Hz into [0,1] (kills it) and slew
// {maxStepPerSec:4} freezes the dom freq at 4 Hz/s. On a frequency signal we
// instead default to an audible-band clamp + a rate fast enough to track a dom
// freq. (2026-06-17 contract §"freq-domain clamp/slew".)
const HZ_OP_DEFAULTS = {
  clamp: { min: 20, max: 8000 },
  slew:  { maxStepPerSec: 2000 },
};
function addOp(sig, type) {
  const schema = S.ops[type]?.params || {};
  const params = {};
  for (const [pn, pd] of Object.entries(schema)) if (!pd.optional) params[pn] = pd.default;
  if (type === 'gain' && !('value' in params)) params.value = 1.0;
  // Frequency signal → override the Hz-domain ops' intensity defaults so the
  // dom freq survives (clamp) and isn't frozen (slew).
  if (sig.type === 'frequency' && HZ_OP_DEFAULTS[type]) Object.assign(params, HZ_OP_DEFAULTS[type]);
  const newOp = { id: uid(type), type, enabled: true, params };
  // Keep osc_out terminal: insert new ops BEFORE any existing tap.
  const tapIdx = sig.chain.findIndex(o => o.type === 'osc_out');
  if (type !== 'osc_out' && tapIdx >= 0) sig.chain.splice(tapIdx, 0, newOp);
  else sig.chain.push(newOp);
  renderChain(); pushChain(sig.id);
}
function removeOp(i) { const sig = signalById(S.selected); if (!sig) return; sig.chain.splice(i, 1); renderChain(); pushChain(sig.id); }
function moveOp(i, d) {
  const sig = signalById(S.selected); if (!sig) return;
  const c = sig.chain; const j = i + d;
  if (j < 0 || j >= c.length) return;
  if (c[j].type === 'osc_out') return;   // can't move past the terminal tap
  [c[i], c[j]] = [c[j], c[i]]; renderChain(); pushChain(sig.id);
}

// ── file player (BROWSER-SOURCED file mode) ─────────────────────────────────
const PCM_SR = 44100;
const filePlayer = {
  audio: null, ctx: null, node: null, srcNode: null, path: '', ready: false,
  _workletCode: `
    class PcmTap extends AudioWorkletProcessor {
      process(inputs, outputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch && ch.length) {
          const i16 = new Int16Array(ch.length);
          for (let i = 0; i < ch.length; i++) {
            let s = ch[i]; s = s > 1 ? 1 : s < -1 ? -1 : s;
            i16[i] = s < 0 ? s * 32768 : s * 32767;
          }
          this.port.postMessage(i16, [i16.buffer]);
          const out = outputs[0];
          if (out) for (let c = 0; c < out.length; c++) out[c].set(ch);
        }
        return true;
      }
    }
    registerProcessor('pcm-tap', PcmTap);
  `,
  async load(path) {
    this.stop();
    this.path = path;
    const a = new Audio();
    a.src = '/file?path=' + encodeURIComponent(path);
    a.preload = 'auto'; a.crossOrigin = 'anonymous';
    this.audio = a;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ sampleRate: PCM_SR });
    this.ctx = ctx;
    const srcNode = ctx.createMediaElementSource(a);
    this.srcNode = srcNode;
    let tap;
    try {
      const url = URL.createObjectURL(new Blob([this._workletCode], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      tap = new AudioWorkletNode(ctx, 'pcm-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      tap.port.onmessage = (ev) => sendPcm(ev.data);
    } catch (e) {
      // AudioWorklet unavailable on this browser — fall back to the deprecated
      // ScriptProcessorNode so file replay still taps PCM, but tell the operator
      // (no silent degrade): the fallback works but is higher-latency.
      flash('audio worklet unavailable — using legacy ScriptProcessor (file mode, higher latency)', true);
      const sp = ctx.createScriptProcessor(1024, 1, 1);
      sp.onaudioprocess = (ev) => {
        const ch = ev.inputBuffer.getChannelData(0);
        const i16 = new Int16Array(ch.length);
        for (let i = 0; i < ch.length; i++) { let s = ch[i]; s = s > 1 ? 1 : s < -1 ? -1 : s; i16[i] = s < 0 ? s * 32768 : s * 32767; }
        sendPcm(i16);
        ev.outputBuffer.getChannelData(0).set(ch);
      };
      tap = sp;
    }
    this.node = tap;
    srcNode.connect(tap);
    tap.connect(ctx.destination);
    this.ready = true;
    a.ontimeupdate = () => renderTransport();
    a.onplay = () => { ctx.resume(); renderTransport(); };
    a.onpause = () => renderTransport();
    a.onended = () => renderTransport();
    a.onloadedmetadata = () => renderTransport();
    send({ type: 'setMode', mode: 'file', file: path });
    try { await a.play(); } catch { /* autoplay may need a gesture; play btn covers it */ }
    renderTransport();
  },
  play() { if (this.audio) { this.ctx?.resume(); this.audio.play().catch(() => {}); } },
  pause() { if (this.audio) this.audio.pause(); },
  toggle() { if (!this.audio) return; this.audio.paused ? this.play() : this.pause(); },
  seek(frac) { if (this.audio && this.audio.duration) this.audio.currentTime = frac * this.audio.duration; },
  stop() {
    if (this.audio) { try { this.audio.pause(); } catch { /* ignore */ } this.audio.src = ''; this.audio = null; }
    if (this.node) { try { this.node.disconnect(); } catch { /* ignore */ } this.node = null; }
    if (this.srcNode) { try { this.srcNode.disconnect(); } catch { /* ignore */ } this.srcNode = null; }
    if (this.ctx) { try { this.ctx.close(); } catch { /* ignore */ } this.ctx = null; }
    this.ready = false; this.path = '';
  },
};
function sendPcm(i16) {
  if (ws && ws.readyState === 1 && S.mode === 'file') ws.send(i16.buffer);
}
const fmtTime = (s) => { if (!Number.isFinite(s)) return '0:00'; const m = Math.floor(s / 60), x = Math.floor(s % 60); return m + ':' + (x < 10 ? '0' : '') + x; };
function renderTransport() {
  const box = $('transport'); if (!box) return;
  const inFile = S.mode === 'file' && filePlayer.audio;
  box.style.display = inFile ? 'flex' : 'none';
  if (!inFile) { box.innerHTML = ''; delete box.dataset.built; return; }
  const a = filePlayer.audio;
  const dur = a.duration || 0, cur = a.currentTime || 0;
  const frac = dur ? cur / dur : 0;
  if (!box.dataset.built) {
    box.innerHTML = '';
    const playBtn = el('button', 'tp-btn', '▶'); playBtn.id = 'tp-play';
    playBtn.onclick = () => filePlayer.toggle();
    const seek = el('input', 'tp-seek'); seek.id = 'tp-seek'; seek.type = 'range'; seek.min = 0; seek.max = 1000; seek.step = 1; seek.value = 0;
    seek.oninput = () => filePlayer.seek(+seek.value / 1000);
    const time = el('span', 'tp-time'); time.id = 'tp-time';
    box.appendChild(playBtn); box.appendChild(seek); box.appendChild(time);
    box.dataset.built = '1';
  }
  $('tp-play').textContent = a.paused ? '▶' : '⏸';
  const seek = $('tp-seek'); if (document.activeElement !== seek) seek.value = Math.round(frac * 1000);
  $('tp-time').textContent = fmtTime(cur) + ' / ' + fmtTime(dur);
}

// ── source selector (Test / Mic / File) ─────────────────────────────────────
function syncSourcePanel() {
  const panel = $('source-panel'); if (!panel) return;
  const showSource = S.mode === 'test';
  panel.style.display = showSource ? '' : 'none';
  // When the TEST SOURCE panel is hidden it drops out of the `.lower` grid;
  // flag the grid so the chain-panel keeps (and reclaims) the full width
  // instead of collapsing into the 230px column (which wrapped the op row
  // vertically). See `.lower.no-source` in the CSS.
  const lower = panel.closest('.lower');
  if (lower) lower.classList.toggle('no-source', !showSource);
}
function buildSourceBar() {
  syncSourcePanel();
  const box = $('sourcebar'); if (!box) return; box.innerHTML = '';
  const seg = el('div', 'seg');
  for (const [m, label] of [['test', 'Test'], ['mic', 'Mic / Line'], ['file', 'File']]) {
    const b = el('button', 'seg-btn' + (S.mode === m ? ' active' : ''), label);
    b.onclick = () => {
      if (m === 'file') {
        S.mode = 'file'; buildSourceBar();
        openBrowse(S.browseDir || S.datasetsDir);
        return;
      }
      filePlayer.stop();
      if (m === 'mic') {
        S.mode = 'mic'; buildSourceBar();
        send({ type: 'listDevices' });
        send({ type: 'setMode', mode: 'mic', device: S.device || null });
        return;
      }
      send({ type: 'setMode', mode: m }); S.mode = m; buildSourceBar();
    };
    seg.appendChild(b);
  }
  box.appendChild(seg);

  const fwrap = el('span', 'file-wrap' + (S.mode === 'file' ? ' show' : ''));
  const inp = el('input', 'file-input'); inp.id = 'file-path'; inp.placeholder = '/path/to/track.mp3'; inp.value = S.filePath || '';
  inp.oninput = () => { S.filePath = inp.value; };
  const go = el('button', 'file-go', 'Load'); go.onclick = () => { const f = inp.value.trim(); if (f) { S.filePath = f; filePlayer.load(f); const bm = $('browse-modal'); if (bm) bm.style.display = 'none'; flash('loaded ' + f.split(/[/\\]/).pop()); } };
  fwrap.appendChild(inp); fwrap.appendChild(go); box.appendChild(fwrap);

  const tp = el('div', 'transport'); tp.id = 'transport'; box.appendChild(tp);
  renderTransport();

  // Device picker (shown in mic mode) — honors the config device.
  const mwrap = el('span', 'mic-wrap' + (S.mode === 'mic' ? ' show' : ''));
  const sel = el('select', 'device-select'); sel.id = 'device-select';
  const def = el('option', null, 'Default input'); def.value = ''; if (!S.device) def.selected = true; sel.appendChild(def);
  let matched = false;
  for (const d of (S.devices || [])) {
    const o = el('option', null, d.label || d.id); o.value = d.ffmpegDevice || '';
    if (d.ffmpegDevice && d.ffmpegDevice === S.device) { o.selected = true; matched = true; }
    sel.appendChild(o);
  }
  // Config device set but not in the (possibly not-yet-loaded) list — still
  // show it SELECTED so the dropdown reflects the configured mic on boot
  // rather than silently falling back to "Default input". Refresh resolves it
  // to the real label once the device list lands.
  if (S.device && !matched) {
    const o = el('option', null, S.device); o.value = S.device; o.selected = true; sel.appendChild(o);
  }
  sel.onchange = () => { S.device = sel.value; send({ type: 'setMode', mode: 'mic', device: sel.value || null }); flash('input: ' + (sel.selectedOptions[0]?.textContent || 'default')); };
  const refresh = el('button', 'file-go', '⟳'); refresh.title = 'refresh device list'; refresh.onclick = () => send({ type: 'listDevices' });
  mwrap.appendChild(sel); mwrap.appendChild(refresh);
  box.appendChild(mwrap);

  const tag = el('span', 'src-tag', S.mode === 'test' ? 'synthetic source' : S.mode === 'mic' ? `live input · ${S.devices.length} device${S.devices.length === 1 ? '' : 's'}` : 'file replay');
  box.appendChild(tag);
}

// ── INPUT source post-proc controls (gain + pre-FFT smoothing) ──────────────
function inputControls() {
  const wrap = el('div', 'input-ctrls');
  const oscNote = el('div', 'chain-note', `OUTPUTS → engine OSC at <b>${S.osc.host}:${S.osc.port}</b> · ${S.signals.filter(s => s.output).length} output signal(s)`);
  wrap.appendChild(oscNote);
  const gain = el('div', 'param');
  gain.innerHTML = `<div class="param-head"><span class="pn">INPUT GAIN</span><span class="pv" id="ic-gain">×${S.inputGain.toFixed(1)}</span></div>`;
  const gr = el('input', 'param-range'); gr.type = 'range'; gr.min = 0; gr.max = 16; gr.step = 0.1; gr.value = S.inputGain;
  gr.oninput = () => { S.inputGain = +gr.value; $('ic-gain').textContent = '×' + (+gr.value).toFixed(1); send({ type: 'setInputGain', value: +gr.value }); buildGainBar(); };
  gain.appendChild(gr); wrap.appendChild(gain);
  const sm = el('div', 'param');
  const fmtHz = (v) => (v ? (v / 1000).toFixed(1) + ' kHz' : 'off');
  sm.innerHTML = `<div class="param-head"><span class="pn">SMOOTH <span class="op-tag">(pre-FFT denoise)</span></span><span class="pv" id="ic-sm">${fmtHz(S.sourceSmoothHz)}</span></div>`;
  const sr = el('input', 'param-range'); sr.type = 'range'; sr.min = 0; sr.max = 22050; sr.step = 250; sr.value = S.sourceSmoothHz;
  sr.oninput = () => { S.sourceSmoothHz = +sr.value; $('ic-sm').textContent = fmtHz(+sr.value); send({ type: 'setSmooth', value: +sr.value }); };
  sm.appendChild(sr); wrap.appendChild(sm);
  wrap.appendChild(el('div', 'chain-note', 'Audio source → [gain + smoothing] → FFT → every designed signal. Lower SMOOTH cutoff = more denoise (0 = off).'));
  return wrap;
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
  filePlayer.load(p);
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
  S.dropFlash *= 0.9; if (S.dropFlash < 0.02) S.dropFlash = 0;
  const glow = Math.max(clamp01(st.pulse), S.dropFlash);
  $('drop-flash').style.opacity = glow.toFixed(2);
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
const saveBtn = $('export-save'); if (saveBtn) saveBtn.onclick = () => send({ type: 'exportSave' });
$('add-close').onclick = () => $('add-modal').style.display = 'none';
$('view-close').onclick = () => $('view-modal').style.display = 'none';
const viewName = $('view-name');
if (viewName) viewName.oninput = () => { viewName.dataset.touched = viewName.value.trim() ? '1' : ''; };
$('view-create').onclick = () => {
  const label = ($('view-name').value || '').trim();
  if (!label) { flash('name the view', true); return; }
  if (!_addViewType) { flash('pick a view type', true); return; }
  send({ type: 'addView', label, viewType: _addViewType, signals: [..._addViewPicked] });
  $('view-modal').style.display = 'none';
};
// Click the dark backdrop (outside the box) to dismiss any modal.
for (const mid of ['add-modal', 'export-modal', 'browse-modal', 'view-modal']) {
  const m = $(mid); if (m) m.onclick = (e) => { if (e.target === m) m.style.display = 'none'; };
}

// ── render loop (canvases) ──────────────────────────────────────────────────
function draw() {
  // The ANALYSIS is server-side and always live (independent of this UI). If a
  // backlog of frames piled up while this tab was backgrounded (rAF pauses but
  // the WS keeps receiving), DON'T replay it — JUMP TO LIVE by dropping all but
  // the most recent couple of frames. A small queue (normal jitter) still
  // smooth-plays one per rAF.
  const LIVE_BACKLOG = 6;   // ~100 ms — beyond this we're catching up, so skip
  if (frameQueue.length > LIVE_BACKLOG) {
    frameQueue.splice(0, frameQueue.length - 2);   // keep only the latest 2
  }
  // Drain up to 2/frame so the steady ~86→60 Hz inflow doesn't slowly accumulate;
  // the splice above bounds any large backlog. Result: always live, never replays.
  let limit = frameQueue.length > 1 ? 2 : 1;

  for (let k = 0; k < limit; k++) {
    if (frameQueue.length === 0) break;
    const m = frameQueue.shift();
    for (const id in m.signals) { const v = m.signals[id]; if (v) S.live[id] = v; }
    if (m.dom) S.dom = m.dom;
    if (m.struct) S.struct = m.struct;
    if (m.spectrum) S.spectrum = m.spectrum;
    if (m.wave) S.wave = m.wave;
    if (m.derived) {
      if (m.derived.sp > 0.5 && S.derived.sp <= 0.5) S.spFlash = 1;
      if (m.derived.sc > 0.5 && S.derived.sc <= 0.5) S.scFlash = 1;
      S.derived = m.derived;
    }
    // Advance the scrolling trace for EVERY designed signal.
    for (const s of S.signals) {
      const tr = S.trace[s.id]; if (!tr) continue;
      const lv = S.live[s.id] || { raw: 0, post: 0 };
      // Frequency signals carry Hz — normalize to [0,1] for the trace display.
      const norm = s.type === 'frequency' ? clamp01((lv.post || 0) / 4000) : clamp01(lv.post);
      const rawN = s.type === 'frequency' ? clamp01((lv.raw || 0) / 4000) : clamp01(lv.raw);
      tr.raw[S.head] = rawN; tr.post[S.head] = norm;
    }
    S.head = (S.head + 1) % TRAIL;
  }

  const sel = S.selected;
  const ctx = $('trace').getContext('2d');
  const selView = viewById(sel);
  if (selView) {
    drawView(ctx, selView);
  } else if (sel === 'input') {
    drawWave(ctx, S.wave);
    $('big-raw').textContent = 'source';
    $('big-post').textContent = '×' + S.inputGain.toFixed(1);
    $('big-post').style.color = '#34d3b5';
  } else {
    const sig = signalById(sel);
    const tr = S.trace[sel];
    // Dom split: every signal is an ordinary single-value card now — one trace
    // (raw ghost + post). Dom freq is freq-only; dom energy is an ordinary
    // intensity signal with its own trace.
    if (tr) drawTrace(ctx, tr, accent(sel), 2);
    const lv = S.live[sel] || { raw: 0, post: 0 };
    if (sig && sig.type === 'frequency') {
      $('big-raw').textContent = (lv.raw || 0).toFixed(0) + ' Hz';
      $('big-post').textContent = (lv.post || 0).toFixed(0) + ' Hz';
    } else {
      $('big-raw').textContent = clamp01(lv.raw).toFixed(2);
      $('big-post').textContent = clamp01(lv.post).toFixed(2);
    }
    $('big-post').style.color = accent(sel);
    const leg = document.querySelector('.ro-legend');
    if (leg) leg.innerHTML = '<span class="dot ghost"></span>raw &nbsp; <span class="dot solid"></span>post';
  }
  drawSpectrum($('spectrum').getContext('2d'), S.spectrum, S.dom);
  drawWave($('wave').getContext('2d'), S.wave);
  for (const s of S.signals) {
    const c = document.getElementById('mini-' + s.id); if (c && S.trace[s.id]) drawMini(c.getContext('2d'), S.trace[s.id], SOURCE_ACCENT[s.source] || '#9aa');
    const v = document.getElementById('sv-' + s.id);
    if (v) {
      const lv = S.live[s.id] || {};
      v.textContent = s.type === 'frequency' ? (lv.post || 0).toFixed(0) : clamp01(lv.post || 0).toFixed(2);
    }
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
let specSmooth = null;
function drawSpectrum(ctx, spec, dom) {
  const W = ctx.canvas.width, H = ctx.canvas.height; ctx.clearRect(0, 0, W, H);
  ctx.font = '9px monospace';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const x = freqToX(f, W);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.fillStyle = '#556'; ctx.fillText(f >= 1000 ? (f / 1000) + 'k' : String(f), x + 2, H - 3);
  }
  if (dom) {
    drawWindow(ctx, dom.lo1, dom.hi1, '240,162,59', W, H);
    drawWindow(ctx, dom.lo2, dom.hi2, '192,132,252', W, H);
  }
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
  if (dom) {
    drawGhost(ctx, dom.danceF1, dom.danceW1, '240,162,59', W, H);
    drawGhost(ctx, dom.danceF2, dom.danceW2, '192,132,252', W, H);
    drawMarker(ctx, dom.f1, '#f0a23b', 'dom1', W, H);
    drawMarker(ctx, dom.f2, '#c084fc', 'dom2', W, H);
  }
}
function drawGhost(ctx, f, w, rgb, W, H) {
  if (!(f > 0)) return;
  const xc = freqToX(f, W), x0 = freqToX(Math.max(SPEC_MIN_HZ, f - w / 2), W), x1 = freqToX(f + w / 2, W);
  const grad = ctx.createLinearGradient(x0, 0, x1, 0);
  grad.addColorStop(0, `rgba(${rgb},0)`); grad.addColorStop(0.5, `rgba(${rgb},0.28)`); grad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = grad; ctx.fillRect(x0, 0, Math.max(2, x1 - x0), H);
  ctx.strokeStyle = `rgba(${rgb},0.7)`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xc, 0); ctx.lineTo(xc, H); ctx.stroke();
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
const DANCE_MIN_HZ = 30, DANCE_MAX_HZ = 8000;
const danceX = (f, W) => (f <= DANCE_MIN_HZ ? 0 : Math.log(f / DANCE_MIN_HZ) / Math.log(DANCE_MAX_HZ / DANCE_MIN_HZ) * W);
function drawOrb(ctx, trail, x, y, widthHz, energy, rgb, freq, label) {
  const r = 7 + energy * 30 + Math.min(38, widthHz / 9);
  trail.push({ x, y, r }); if (trail.length > 36) trail.shift();
  for (let i = 0; i < trail.length; i++) { const t = trail[i]; ctx.fillStyle = `rgba(${rgb},${(i / trail.length) * 0.3})`; ctx.beginPath(); ctx.arc(t.x, t.y, t.r * 0.65, 0, Math.PI * 2); ctx.fill(); }
  const g = ctx.createRadialGradient(x, y, 1, x, y, r);
  g.addColorStop(0, `rgba(${rgb},0.95)`); g.addColorStop(0.5, `rgba(${rgb},0.4)`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgb(${rgb})`; ctx.font = '11px monospace'; ctx.fillText(`${label} ${(freq || 0).toFixed(0)}Hz`, x + r + 5, y + 3);
}

// ── custom VIEWS rendering (reuse the dance + trace renderers) ───────────────
// "#rrggbb" → "r,g,b" for the orb gradients (which take an rgb triple string).
function hexToRgb(hex) {
  const h = (hex || '#9aa9b8').replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(f, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
// Per-view-signal orb trails (id → trail array), so each orb keeps its glide.
const viewOrbTrails = {};
// A dancing-balls view: one gliding orb per fed FREQUENCY signal. Reuses the
// dom-dance orb renderer (drawOrb). Dom signals use their spring-smoothed dance
// freq + cluster width (S.dom) so the legacy DOM DANCE looks identical; non-dom
// frequency signals glide on their live post Hz (width 0).
function drawDancingBalls(ctx, view) {
  const W = ctx.canvas.width, H = ctx.canvas.height; ctx.clearRect(0, 0, W, H);
  ctx.font = '9px monospace';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000]) {
    const x = danceX(f, W);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.fillStyle = '#556'; ctx.fillText(f >= 1000 ? (f / 1000) + 'k' : String(f), x + 2, H - 4);
  }
  const fed = view.signals.map(id => signalById(id)).filter(s => s && s.type === 'frequency');
  if (!fed.length) { ctx.fillStyle = '#667'; ctx.font = '12px monospace'; ctx.fillText('no frequency signals fed to this view', 12, H / 2); return; }
  fed.forEach((s, i) => {
    const lv = S.live[s.id] || {};
    // Dom signals carry a spring-smoothed dance freq + cluster width + energy
    // (S.dom). Any OTHER frequency signal has no separate energy in its frame
    // (payloads are {raw,post}), so its orb uses a fixed visible brightness and
    // the live post Hz for position.
    let freq = lv.post || 0, widthHz = 0, energy = 0.7;
    if (s.source === 'rawDom1') { freq = S.dom.danceF1 || freq; widthHz = S.dom.danceW1 || 0; energy = clamp01(S.dom.e1); }
    else if (s.source === 'rawDom2') { freq = S.dom.danceF2 || freq; widthHz = S.dom.danceW2 || 0; energy = clamp01(S.dom.e2); }
    const trail = viewOrbTrails[s.id] || (viewOrbTrails[s.id] = []);
    const y = H * (fed.length === 1 ? 0.5 : (0.28 + 0.44 * (i / (fed.length - 1))));
    const rgb = hexToRgb(SOURCE_ACCENT[s.source] || '#9aa');
    drawOrb(ctx, trail, danceX(freq, W), y, widthHz, energy, rgb, freq, signalName(s));
  });
}
// A trace-overlay view: overlaid colour-per-signal POST traces on one shared
// axis. Reuses the per-signal trace buffers + trLine. Frequency traces are
// already normalized to [0,1] in the frame drain (Hz/4000), intensity in [0,1].
function drawOverlay(ctx, view) {
  const W = ctx.canvas.width, H = ctx.canvas.height; ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  for (let g = 1; g < 4; g++) { const y = H * g / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  const fed = view.signals.map(id => signalById(id)).filter(Boolean);
  if (!fed.length) { ctx.fillStyle = '#667'; ctx.font = '12px monospace'; ctx.fillText('no signals fed to this view', 12, H / 2); return; }
  ctx.font = '10px monospace';
  fed.forEach((s, i) => {
    const tr = S.trace[s.id]; if (!tr) return;
    const color = OVERLAY_COLORS[i % OVERLAY_COLORS.length];
    ctx.strokeStyle = color; trLine(ctx, tr.post, W, H, 1.6, 1);
    // Inline legend entry.
    ctx.fillStyle = color; ctx.fillText('— ' + signalName(s), 10, 14 + i * 14);
  });
}
function drawView(ctx, view) {
  if (view.type === 'dancing-balls') drawDancingBalls(ctx, view);
  else drawOverlay(ctx, view);
  // Compact stage readout: first fed signal's live value.
  const first = view.signals.map(id => signalById(id)).find(Boolean);
  const lv = first ? (S.live[first.id] || {}) : {};
  $('big-raw').textContent = view.signals.length + ' sig';
  $('big-post').textContent = first
    ? (first.type === 'frequency' ? (lv.post || 0).toFixed(0) + ' Hz' : clamp01(lv.post || 0).toFixed(2))
    : '—';
  $('big-post').style.color = '#f0a23b';
  const leg = document.querySelector('.ro-legend');
  if (leg) leg.innerHTML = `<span class="dot solid" style="background:#f0a23b"></span>${S.viewTypes[view.type]?.label || view.type}`;
}
function drawWave(ctx, wave) {
  const W = ctx.canvas.width, H = ctx.canvas.height; ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  if (!wave || !wave.length) return;
  ctx.strokeStyle = '#34d3b5'; ctx.lineWidth = 1.3; ctx.beginPath();
  const n = wave.length, step = W / (n - 1), yOf = (v) => H / 2 - v * (H / 2 * 0.92);
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
