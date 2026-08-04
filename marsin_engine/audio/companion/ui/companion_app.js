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
  osc: { host: '127.0.0.1', port: 10000, rateHz: 60 },
  oscRateBuilt: false,
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
  // Server-built one-liner of the input gain actually in force ("×2.50").
  // Re-sent with every `inputGain` frame + on hello, so the MIC TUNE page can
  // always show what the gain IS — including right after an app reload
  // (report 20260725_131, same contract as `gatesSummary`).
  gainSummary: '',
  // Outcome of the last input-gain apply (server read-back, not a local echo).
  // { ok, text, source, stale } — a SUCCESS line is transient, a FAILURE line
  // stays until the next apply so it can't be missed.
  gainApply: null,
  sourceSmoothHz: 12000,
  engineLinkConnected: false,   // SHARED-tuning sync to the engine is live
  cal: { phase: 'idle', result: null },
  dom: { f1: 0, e1: 0, f2: 0, e2: 0 },
  struct: { state: 0, build: 0, energy: 0, pulse: 0, slow: 0 },
  dropFlash: 0,
  spectrum: [],
  wave: [],
  derived: {
    bpm: 0, beat: 0, party: 0, note: 0, hue: 0, sp: 0, sc: 0, genre: null, genreConf: null,
    // NEW Round-2/Wave-D derived signals (null until the server publishes them).
    riserScore: null, buildEta: null, riserConf: null, dropCountdown: null,
    climax: null, phrasePhase: null, phraseBoundary: null, silence: null, trackChange: null,
    onsetLow: null, onsetMid: null, onsetHigh: null, chestHit: null,
  },
  spFlash: 0, scFlash: 0,
  // Decaying flash levels for the NEW pulse keys (armed on the rising edge in the
  // frame drain, decayed each render so a one-hop pulse stays visible).
  countdownFlash: 0, boundaryFlash: 0, trackChangeFlash: 0,
  onsetLowFlash: 0, onsetMidFlash: 0, onsetHighFlash: 0, chestFlash: 0,
  genreNames: [],      // index-aligned GENRE name list (from the server)
  page: 'design',      // 'design' | 'mic' | 'osc' | 'party' — top-bar nav
  // ── PARTY page (report 20260725_19) ────────────────────────────────────────
  partyTunables: [],   // [{key,kind,label,unit,min,max,step,hint}] from the server
  partyParams: null,   // live detector thresholds (server truth)
  partyEdits: {},      // operator's un-applied editor values (key → value)
  partyState: null,    // 10 Hz meter snapshot
  partyOverride: 'auto',
  partyValidation: false,
  partyCaptures: { ambient: null, party: null },
  partySuggestions: null,
  partySession: null,  // last GET /party/session (engine timeline state)
  partyConfig: null,   // last GET /party/config (engine party authority)
  partySessionError: null,
  partyBuilt: false,
  oscAcc: null,        // latest OSC OUT accounting snapshot { target, totalSent, outputs }
  // MIC TUNE page (report 20260621_5): noise gate state (global + per-band; null
  // per-band → uses the global gate), live band levels for the meters, and the
  // noise-floor auto-calibration phase/result.
  gates: { noiseGate: 0.04, lowGate: null, midGate: null, highGate: null },
  // Server-built one-liner of the gates actually in force ("low … · mid … ·
  // high … · global …"). Re-sent with every `gates` frame + on hello, so the
  // MIC TUNE page can always show what the noise floor IS — including right
  // after an app reload (operator request 2026-08-03).
  gatesSummary: '',
  liveBands: { low: 0, mid: 0, high: 0 },
  noiseCal: { phase: 'idle', result: null },
  // Outcome of the last noise-floor apply (server read-back, not a local echo).
  // { ok, text, source, stale } — a SUCCESS line is transient (clears itself
  // after APPLY_CONFIRM_MS, per the operator's "keep it quiet" directive); a
  // FAILURE line stays until the next apply so it can't be missed.
  noiseApply: null,
  micBuilt: false,
  // MIC TUNE calibration profiles (named venue/condition states) + the active one.
  profiles: [],
  activeProfileId: null,
};

// ── THEME (TASK 2) ───────────────────────────────────────────────────────────
// The companion mirrors CaptainPad's theme set (CaptainPad/constants/theme.ts).
// The palettes themselves live in companion_app.css ([data-theme="…"]); here we
// only carry the picker order + labels and persist the choice. Default: gruvbox.
const THEME_ORDER = ['light', 'dark', 'midnight', 'sunset', 'gruvbox'];
const THEME_LABELS = {
  light: 'LIGHT', dark: 'DARK', midnight: 'MIDNIGHT', sunset: 'SUNSET', gruvbox: 'GRUVBOX',
};
const THEME_KEY = 'companion.theme';
const DEFAULT_THEME = 'gruvbox';
function currentTheme() {
  let t = null;
  try { t = localStorage.getItem(THEME_KEY); } catch { /* storage blocked */ }
  return THEME_ORDER.includes(t) ? t : DEFAULT_THEME;
}
function applyTheme(t) {
  const theme = THEME_ORDER.includes(t) ? t : DEFAULT_THEME;
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage blocked */ }
  const sel = document.getElementById('theme-select');
  if (sel && sel.value !== theme) sel.value = theme;
}
function buildThemePicker() {
  const sel = document.getElementById('theme-select');
  if (!sel) return;
  sel.innerHTML = '';
  for (const t of THEME_ORDER) {
    const o = document.createElement('option');
    o.value = t; o.textContent = THEME_LABELS[t] || t;
    sel.appendChild(o);
  }
  sel.value = currentTheme();
  sel.onchange = () => applyTheme(sel.value);
}
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
      S.genreNames = m.genreNames || [];
      S.source = m.source;
      if (m.mode) S.mode = m.mode;
      if (m.device != null) S.device = m.device;
      if (m.datasetsDir) { S.datasetsDir = m.datasetsDir; S.browseDir = m.datasetsDir; }
      if (m.inputGain != null) S.inputGain = m.inputGain;
      if (m.sourceSmoothHz != null) S.sourceSmoothHz = m.sourceSmoothHz;
      if (m.gates) S.gates = { ...S.gates, ...m.gates };
      if (m.gatesSummary) S.gatesSummary = m.gatesSummary;
      // A FAILED last apply survives the reload (the operator still needs to
      // know it didn't land); a successful one doesn't re-announce itself —
      // the always-visible gate summary already states the truth.
      S.noiseApply = (m.lastNoiseApply && !m.lastNoiseApply.ok)
        ? { ...m.lastNoiseApply, stale: true } : null;
      if (m.gainSummary) S.gainSummary = m.gainSummary;
      // Same rule for the gain apply: a FAILED one survives the reload, a
      // successful one doesn't re-announce itself (the always-visible readout
      // under the gain card already states the truth).
      S.gainApply = (m.lastGainApply && !m.lastGainApply.ok)
        ? { ...m.lastGainApply, stale: true } : null;
      if (Array.isArray(m.profiles)) { S.profiles = m.profiles; S.activeProfileId = m.activeProfileId || null; }
      if (m.engineLink) S.engineLinkConnected = !!m.engineLink.connected;
      // PARTY page seed (report 20260725_19).
      if (Array.isArray(m.partyTunables)) S.partyTunables = m.partyTunables;
      if (m.partyParams) { S.partyParams = m.partyParams; S.partyEdits = { ...m.partyParams }; }
      if (m.partyOverride) S.partyOverride = m.partyOverride;
      S.partyValidation = !!m.partyValidationMode;
      if (m.partyCaptures) S.partyCaptures = m.partyCaptures;
      S.partySuggestions = m.partySuggestions || null;
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
    } else if (m.type === 'oscAccounting') {
      S.oscAcc = m;
      if (Number.isFinite(m.rateHz)) S.osc.rateHz = m.rateHz;
      if (S.page === 'osc') renderOscPage();
    } else if (m.type === 'oscRate') {
      S.osc.rateHz = m.rateHz;
      if (S.page === 'osc') syncOscRateControl();
    } else if (m.type === 'partyState') {
      S.partyState = m;
      if (S.page === 'party') renderPartyMeters();
    } else if (m.type === 'partyParams') {
      S.partyParams = m.params;
      // Adopt server truth for any field the operator has NOT edited away from
      // the previous server value — never stomp a half-typed edit.
      for (const k of Object.keys(m.params)) {
        if (S.partyEdits[k] === undefined) S.partyEdits[k] = m.params[k];
      }
      if (S.page === 'party') { renderPartyEditors(); renderPartyDirty(); }
    } else if (m.type === 'partyOverride') {
      S.partyOverride = m.mode;
      if (S.page === 'party') renderPartyOverride();
    } else if (m.type === 'partyCapStatus') {
      if (S.page === 'party') renderPartyCalib();
    } else if (m.type === 'partyCapResult') {
      if (m.ok) {
        S.partyCaptures[m.kind] = m.stats;
        S.partySuggestions = m.suggestions || null;
        flash(`${m.kind} capture done (${m.stats.n} samples)`);
      } else {
        flash(`capture failed: ${m.error}`, true);
      }
      if (S.page === 'party') renderPartyCalib();
    } else if (m.type === 'partyPersisted') {
      if (S.page === 'party') renderPartyDirty();
    } else if (m.type === 'dropFired') {
      S.dropFlash = 1; flash('▼ DROP ' + (m.confidence != null ? m.confidence.toFixed(2) : ''));
    } else if (m.type === 'sourceStatus') {
      S.mode = m.mode; buildSourceBar();
      frameQueue.length = 0;
      if (m.status && m.status.error) flash((m.status.needsDevice ? 'pick an input device — ' : 'source: ') + m.status.error, true);
    } else if (m.type === 'inputGain') {
      S.inputGain = m.value;
      if (m.summary) S.gainSummary = m.summary;
      buildGainBar();
      if (S.page === 'mic') { refreshMicControls(); renderGainApplyState(); }
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
      if (S.page === 'mic') renderGainCal();
    } else if (m.type === 'calResult') {
      S.cal.result = m; renderCal();
      if (S.page === 'mic') renderGainCal();
    } else if (m.type === 'gates') {
      S.gates = { noiseGate: m.noiseGate, lowGate: m.lowGate, midGate: m.midGate, highGate: m.highGate };
      if (m.summary) S.gatesSummary = m.summary;
      if (S.page === 'mic') { refreshMicControls(); renderNoiseFloorState(); }
    } else if (m.type === 'noiseApplyResult') {
      // The APPLY confirmation (server read-back of what the engine/analyzer
      // now actually holds). Success auto-clears; failure stays put.
      S.noiseApply = { ...m, stale: false };
      clearTimeout(noiseApplyT);
      if (m.ok) noiseApplyT = setTimeout(() => { S.noiseApply = null; renderNoiseFloorState(); }, APPLY_CONFIRM_MS);
      renderNoiseFloorState();
    } else if (m.type === 'gainApplyResult') {
      // The gain APPLY confirmation (server read-back of what the engine/
      // analyzer now actually holds). Success auto-clears; failure stays put.
      S.gainApply = { ...m, stale: false };
      clearTimeout(gainApplyT);
      if (m.ok) gainApplyT = setTimeout(() => { S.gainApply = null; renderGainApplyState(); }, APPLY_CONFIRM_MS);
      renderGainApplyState();
      // The DESIGN page's compact gain bar has no line of its own — the same
      // apply can be triggered from there, so surface the outcome as a flash.
      if (S.page !== 'mic') flash(m.text, !m.ok);
    } else if (m.type === 'profiles') {
      S.profiles = m.profiles || []; S.activeProfileId = m.activeId || null;
      if (S.page === 'mic') renderProfiles();
    } else if (m.type === 'noiseCalStatus') {
      S.noiseCal.phase = m.phase; if (m.phase === 'recording') S.noiseCal.result = null;
      if (S.page === 'mic') renderNoiseCal();
    } else if (m.type === 'noiseCalResult') {
      S.noiseCal.phase = 'done'; S.noiseCal.result = m;
      if (S.page === 'mic') renderNoiseCal();
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
// Read a theme CSS var (so flash/canvas colours follow the active theme instead
// of hardcoded hex — report 20260616_3 §UI: move JS hex accents to CSS vars).
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function flash(t, bad) {
  const e = $('flash'); e.textContent = t;
  e.style.color = bad ? cssVar('--err', '#ff5d6c') : cssVar('--ok', '#34d3b5');
  clearTimeout(flashT); flashT = setTimeout(() => e.textContent = '', 1800);
}
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
  // [×] tap is otherwise unrecoverable). Themed modal, NOT a native dialog.
  const v = viewById(id);
  const doRemove = () => {
    if (S.selected === id) S.selected = 'input';
    send({ type: 'removeView', id });
  };
  if (!v) { doRemove(); return; }
  confirmModal(`Remove view "${v.label}"?`, doRemove);
}

// Themed confirm dialog — the designer must NEVER use a native window.confirm/
// alert/prompt (they ignore the theme + block the event loop). Shows the message
// in the #confirm-modal and runs `onConfirm` only when the operator hits Remove.
// `_confirmCb` holds the pending action; the buttons are wired once at boot.
let _confirmCb = null;
function confirmModal(message, onConfirm, okLabel = 'Remove') {
  $('confirm-msg').textContent = message;
  $('confirm-ok').textContent = okLabel;
  _confirmCb = onConfirm;
  $('confirm-modal').style.display = 'flex';
}
function closeConfirm() { _confirmCb = null; $('confirm-modal').style.display = 'none'; }

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
  const doRemove = () => {
    if (S.selected === id) S.selected = 'input';
    send({ type: 'removeSignal', id });
  };
  if (!sig) { doRemove(); return; }
  confirmModal(`Remove signal "${signalName(sig)}"?`, doRemove);
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
      // VERIFIED apply, same as the MIC TUNE card's ✓ Apply gain: the flash
      // comes from the server's READ-BACK (gainApplyResult), never from an
      // optimistic echo of the number we just sent (report 20260725_131).
      const apply = el('button', 'cal-apply', 'Apply'); apply.onclick = () => {
        send({ type: 'applyInputGain', value: r.recommendedGain });
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
    // Math.round (NOT toFixed) so this matches CaptainPad's OSC BPM readout
    // and the rounded value the Companion emits over OSC byte-for-byte — same
    // source float, same rounding method, same integer (2026-06-29).
    $('bpm-val').textContent = dv.bpm > 0 ? String(Math.round(dv.bpm)) : '—';
    const pp = $('party-pill'); pp.textContent = dv.party > 0.5 ? 'PARTY' : 'calm'; pp.className = 'party-pill' + (dv.party > 0.5 ? ' on' : '');
    const nn = $('note-val'); const pc = Math.round(dv.note);
    const noteColor = `hsl(${(dv.hue * 360).toFixed(0)},70%,60%)`;
    nn.textContent = NOTE_NAMES[pc] || '—'; nn.style.color = noteColor;
    // NOTE color SWATCH — the live audioNoteHue rendered as a colour chip so the
    // operator can see the note→colour mapping the engine is driving.
    const sw = $('note-swatch'); if (sw) sw.style.background = noteColor;
    // GENRE — index → human name via the server's GENRE_NAMES. `genre` is null
    // until the sibling detector publishes audioGenre (then it lights up). An
    // index-to-name map is display, not a forbidden value fallback.
    const gv = $('genre-val'), gc = $('genre-conf');
    if (gv) {
      const gi = dv.genre;
      const name = (gi != null && Number.isFinite(gi)) ? S.genreNames[Math.round(gi)] : null;
      gv.textContent = name ? name.replace(/_/g, ' ') : '—';
    }
    if (gc) {
      gc.textContent = (dv.genreConf != null && Number.isFinite(dv.genreConf))
        ? clamp01(dv.genreConf).toFixed(2) : '';
    }
    $('beat-dot').style.opacity = clamp01(dv.beat).toFixed(2);
    // COLOR/PATTERN switch cues — a visible FLASH when audioSwitchPattern /
    // audioSwitchColor pulse (operator: the colour-change feedback wasn't
    // visible). The flash is armed in the frame drain (rising edge) and decays
    // here; the `.lit` class makes it pop fully opaque while hot.
    S.spFlash *= 0.85; S.scFlash *= 0.85;
    const spEl = $('sp-flash'), scEl = $('sc-flash');
    if (spEl) { spEl.style.opacity = S.spFlash.toFixed(2); spEl.classList.toggle('lit', S.spFlash > 0.5); }
    if (scEl) { scEl.style.opacity = S.scFlash.toFixed(2); scEl.classList.toggle('lit', S.scFlash > 0.5); }
  }
  renderDerived2(dv);
}

// ── NEW Round-2/Wave-D derived signals: BUILD · STRUCTURE · ONSETS ───────────
// `null` for any key means the server didn't publish it (key not registered in
// this build) → render an honest idle/"—", NOT a value fallback. Continuous keys
// meter; pulse keys flash (armed on the rising edge in the frame drain, decayed
// here so a single-hop pulse stays visible).
const PHRASE_RING_CIRC = 2 * Math.PI * 16;   // r=16 in the SVG viewBox

// Arm a decaying flash when a pulse key rises past 0.5 (a null reads as 0).
function armPulse(cur, key, flashKey) {
  const c = cur[key], p = S.derived[key];
  if ((c || 0) > 0.5 && (p || 0) <= 0.5) S[flashKey] = 1;
}

// Decay a flash level + drive an element's opacity + .lit (for text cue badges
// that fade fully out, like the existing PATTERN/COLOR cues).
function tickFlash(elId, flashKey, decay) {
  S[flashKey] *= decay; if (S[flashKey] < 0.02) S[flashKey] = 0;
  const el = $(elId);
  if (el) { el.style.opacity = S[flashKey].toFixed(2); el.classList.toggle('lit', S[flashKey] > 0.4); }
}

// Decay a flash level + toggle only `.lit` (for always-visible glyphs like the
// onset dots / chest thump — they stay dim at rest, light up on a pulse). No
// opacity drive so the resting glyph never disappears.
function tickLit(elId, flashKey, decay) {
  S[flashKey] *= decay; if (S[flashKey] < 0.02) S[flashKey] = 0;
  const el = $(elId);
  if (el) el.classList.toggle('lit', S[flashKey] > 0.4);
}

function renderDerived2(dv) {
  // BUILD — riser meter + ETA + confidence + countdown flash.
  const riserBar = $('riser-bar');
  if (riserBar) riserBar.style.width = (clamp01(dv.riserScore) * 100).toFixed(0) + '%';
  const etaEl = $('eta-val');
  if (etaEl) {
    // audioBuildEta carries SECONDS (0 = no honest estimate). Show "—" when 0/absent.
    etaEl.textContent = (dv.buildEta != null && dv.buildEta > 0.05)
      ? dv.buildEta.toFixed(1) + 's' : '—';
  }
  const confEl = $('riser-conf');
  if (confEl) {
    confEl.textContent = (dv.riserConf != null && Number.isFinite(dv.riserConf))
      ? clamp01(dv.riserConf).toFixed(2) : '—';
  }
  tickFlash('countdown-flash', 'countdownFlash', 0.82);

  // STRUCTURE — phrase ring + climax meter + silence/track-change cues.
  const ring = $('phrase-ring-fill');
  if (ring) {
    const phase = (dv.phrasePhase != null) ? clamp01(dv.phrasePhase) : 0;
    ring.style.strokeDashoffset = (PHRASE_RING_CIRC * (1 - phase)).toFixed(2);
  }
  const climaxBar = $('climax-bar');
  if (climaxBar) climaxBar.style.width = (clamp01(dv.climax) * 100).toFixed(0) + '%';
  const silPill = $('silence-pill');
  if (silPill) {
    const sil = (dv.silence || 0) > 0.5;
    silPill.textContent = sil ? 'SILENCE' : 'live';
    silPill.classList.toggle('on', sil);
  }
  tickFlash('boundary-flash', 'boundaryFlash', 0.85);
  tickFlash('trackchange-flash', 'trackChangeFlash', 0.9);

  // ONSETS — 3 per-band dots + a chest-hit thump (dim at rest, light on a pulse).
  tickLit('onset-low', 'onsetLowFlash', 0.7);
  tickLit('onset-mid', 'onsetMidFlash', 0.7);
  tickLit('onset-high', 'onsetHighFlash', 0.7);
  tickLit('chest-thump', 'chestFlash', 0.72);
}

// ── OSC OUT accounting page (TASK 1) ─────────────────────────────────────────
// Render the live table of every signal the companion sends to the engine. The
// data is GENERIC — whatever `oscAccounting` the server enumerated (designed
// output signals + built-in emits like BPM + any sibling-added derived output).
// OSC OUTPUT RATE control (report 20260621_6). Slider + number + fps presets,
// all driving setOscRate. Built once; values synced from S.osc.rateHz.
const OSC_RATE_PRESETS = [30, 60, 86];
function buildOscRateControl() {
  if (S.oscRateBuilt) { syncOscRateControl(); return; }
  const slider = $('osc-rate-slider'), num = $('osc-rate-num'), presets = $('osc-rate-presets');
  if (!slider || !num) return;
  const apply = (v) => {
    let n = Math.round(+v);
    if (!Number.isFinite(n)) return;
    n = Math.max(1, Math.min(120, n));
    S.osc.rateHz = n;
    syncOscRateControl();
    send({ type: 'setOscRate', value: n });
  };
  slider.oninput = () => apply(slider.value);
  num.onchange = () => apply(num.value);
  if (presets) {
    presets.innerHTML = '';
    for (const p of OSC_RATE_PRESETS) {
      const b = el('button', 'orc-preset', p === 86 ? 'MAX' : String(p));
      b.title = p === 86 ? 'every analyzer hop (~86 fps)' : `${p} fps`;
      b.onclick = () => apply(p);
      presets.appendChild(b);
    }
  }
  S.oscRateBuilt = true;
  syncOscRateControl();
}
function syncOscRateControl() {
  const slider = $('osc-rate-slider'), num = $('osc-rate-num'), presets = $('osc-rate-presets');
  const r = S.osc.rateHz || 60;
  if (slider) slider.value = Math.min(90, r);
  if (num) num.value = r;
  if (presets) for (const b of presets.children) {
    const pv = b.textContent === 'MAX' ? 86 : +b.textContent;
    b.classList.toggle('active', pv === r);
  }
}

function renderOscPage() {
  buildOscRateControl();
  const acc = S.oscAcc;
  const tgt = $('osc-target'), cnt = $('osc-count'), tot = $('osc-total'), rate = $('osc-rate');
  const tbody = $('osc-rows'), empty = $('osc-empty');
  if (!tbody) return;
  if (!acc) {
    if (tgt) tgt.textContent = `${S.osc.host}:${S.osc.port}`;
    return;
  }
  if (tgt) tgt.textContent = `${acc.target.host}:${acc.target.port}`;
  if (cnt) cnt.textContent = String(acc.outputs.length);
  if (tot) tot.textContent = acc.totalSent.toLocaleString();
  const aggRate = acc.outputs.reduce((s, o) => s + (o.rateHz || 0), 0);
  if (rate) rate.textContent = aggRate.toFixed(0) + '/s';
  if (empty) empty.style.display = acc.outputs.length ? 'none' : 'block';
  // Max rate for the inline rate bar scaling.
  const maxRate = Math.max(1, ...acc.outputs.map(o => o.rateHz || 0));
  // Don't rebuild the table while the operator is mid-edit in an ADDRESS FIELD —
  // a re-render (accounting broadcasts ~4×/s) would steal focus and discard the
  // half-typed path. SCOPED to the rename input only: a focused checkbox must
  // NOT freeze the table, or toggling SEND would look dead (the rate would never
  // fall to 0 and the row would never dim while the checkbox held focus).
  const ae = document.activeElement;
  if (ae && ae.classList && ae.classList.contains('osc-addr-edit') && tbody.contains(ae)) return;
  // The per-signal SEND filter is temporarily disabled server-side (all signals
  // send) — grey the checkboxes out so they don't read as live controls.
  const filterOn = acc.sendFilterEnabled !== false;
  const hint = $('osc-list-hint');
  if (hint) hint.classList.toggle('osc-filter-off', !filterOn);
  tbody.innerHTML = '';
  for (const o of acc.outputs) {
    const tr = document.createElement('tr');
    if (!o.enabled) tr.className = 'osc-off';
    const valTxt = (o.value == null) ? '—'
      : (Math.abs(o.value) >= 100 ? o.value.toFixed(0) : o.value.toFixed(3));
    const barW = ((o.rateHz || 0) / maxRate * 100).toFixed(0);
    // DYNAMIC outputs (operator-added) can rename their path — editable input;
    // the engine re-binds the new path to the same CPC key via the manifest.
    // Built-in / curated / derived paths are bound to FIXED engine addresses, so
    // they render as locked plain text.
    const addrCell = o.editable
      ? `<input class="osc-addr-edit" data-id="${attr(o.id)}" data-addr="${attr(o.address)}" value="${attr(o.address)}" spellcheck="false" title="rename this OSC path — the engine re-binds it to the same CPC key">`
      : `${o.address}<span class="osc-addr-lock" title="built-in path — bound to a fixed engine address, not renameable">🔒</span>`;
    tr.innerHTML = `<td class="osc-on"><input type="checkbox" class="osc-send-cb" data-addr="${attr(o.address)}"${o.enabled ? ' checked' : ''}${filterOn ? '' : ' disabled'} title="${filterOn ? 'send this signal over OSC' : 'send filter temporarily disabled — all signals send'}"></td>`
      + `<td class="osc-sig">${o.label || o.address}</td>`
      + `<td class="osc-addr">${addrCell}</td>`
      + `<td class="osc-key">${o.cpcKey || '—'}</td>`
      + `<td class="osc-kind">${o.kind || ''}</td>`
      + `<td class="num osc-val">${valTxt}</td>`
      + `<td class="num osc-bar-cell"><span class="osc-bar" style="width:${barW}%"></span><span>${(o.rateHz || 0).toFixed(1)}/s</span></td>`
      + `<td class="num">${(o.count || 0).toLocaleString()}</td>`;
    tbody.appendChild(tr);
  }
  bindOscRowEvents(tbody);
}

// Attribute-escape a value going into an HTML attribute (operator names/paths).
const attr = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Delegate the OSC-row interactions ONCE (rows are rebuilt each broadcast, so
// per-row handlers would leak; one delegated listener on the tbody survives).
function bindOscRowEvents(tbody) {
  if (tbody._oscBound) return;
  tbody._oscBound = true;
  // SEND checkbox → mute / unmute this address on the wire.
  tbody.addEventListener('change', (e) => {
    const cb = e.target.closest('.osc-send-cb');
    if (cb) send({ type: 'setOscSend', address: cb.dataset.addr, enabled: cb.checked });
  });
  // RENAME path: Enter commits (via blur), Esc reverts to the last value.
  tbody.addEventListener('keydown', (e) => {
    const inp = e.target.closest('.osc-addr-edit'); if (!inp) return;
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    else if (e.key === 'Escape') { inp.value = inp.dataset.addr; inp.blur(); }
  });
  // Commit on blur (capture — blur doesn't bubble). No-op when unchanged.
  tbody.addEventListener('blur', (e) => {
    const inp = e.target.closest && e.target.closest('.osc-addr-edit'); if (!inp) return;
    const next = inp.value.trim();
    if (next !== inp.dataset.addr) send({ type: 'setOscAddress', id: inp.dataset.id, address: next });
  }, true);
}

// ── top-bar page nav (DESIGN / OSC OUT) ──────────────────────────────────────
// ── MIC TUNE page (report 20260621_5) ───────────────────────────────────────
const METER_MAX = 0.6;   // meter + slider full-scale (so the gate line aligns)
const BANDS3 = ['low', 'mid', 'high'];
// How long a ✓ apply confirmation stays up (noise floor AND input gain).
// Operator directive: keep it QUIET — a few seconds, then gone. The persistent
// summary line under each card carries the value from then on, so nothing is
// lost when this clears. FAILURES never auto-clear.
const APPLY_CONFIRM_MS = 5000;
let noiseApplyT = null;
let gainApplyT = null;
// Effective gate for a band = its per-band override, or the global gate.
function effGate(band) {
  const v = S.gates[band + 'Gate'];
  return (v === null || v === undefined) ? S.gates.noiseGate : v;
}
// Whether a band currently has an explicit override (vs. inheriting the global).
function hasOverride(band) {
  const v = S.gates[band + 'Gate'];
  return !(v === null || v === undefined);
}

function buildMicPage() {
  if (!S.micBuilt) {
    // One-time wiring. Calibrations.
    $('noisecal-btn').onclick = () => send({ type: 'startNoiseCal' });
    $('noisecal-apply').onclick = () => {
      const r = S.noiseCal.result; if (!r) return;
      send({ type: 'applyNoiseGates', gates: { low: r.recommended.low, mid: r.recommended.mid, high: r.recommended.high } });
    };
    $('gaincal-btn').onclick = () => send({ type: 'calibrate' });
    $('noisecal-save').onclick = () => {
      const r = S.noiseCal.result; if (!r) return;
      // Calibrate INTO the active profile: apply the recommended band gates AND
      // persist them (+ current gain) into the active profile.
      send({ type: 'saveActiveProfile', gates: {
        lowGate: r.recommended.low, midGate: r.recommended.mid, highGate: r.recommended.high } });
    };
    $('gaincal-apply').onclick = () => {
      const r = S.cal.result; if (!r) return;
      // VERIFIED apply (report 20260725_131): the server writes through, awaits
      // the engine, reads the resulting gain back and answers with what really
      // landed — not the fire-and-forget setInputGain the slider uses.
      send({ type: 'applyInputGain', value: r.recommendedGain });
    };
    $('gaincal-save').onclick = () => {
      const r = S.cal.result; if (!r) return;
      // Calibrate the GAIN INTO the active profile — the mirror of the noise
      // card's 💾 Save (report 20260725_132). The server routes it through the
      // SAME verified apply and only snapshots the profile once the read-back
      // proves the gain landed, so the ✓/✗ line answers this button too.
      send({ type: 'saveActiveProfile', inputGain: r.recommendedGain });
    };
    // Profiles: add (saves current gates+gain under a name).
    const nameInp = $('mp-name');
    $('mp-add-btn').onclick = () => {
      const name = nameInp.value.trim();
      if (!name) { flash('name the profile first', true); return; }
      send({ type: 'addProfile', name });
      nameInp.value = '';
    };
    nameInp.onkeydown = (e) => { if (e.key === 'Enter') $('mp-add-btn').click(); };
    // Per-band gate sliders + clear buttons.
    for (const b of BANDS3) {
      const sl = $('bs-' + b);
      sl.oninput = () => send({ type: 'setBandGate', band: b, value: +sl.value });
      $('bc-' + b).onclick = () => send({ type: 'setBandGate', band: b, value: null });
    }
    // Global gate + input gain.
    $('mg-gate').oninput = () => send({ type: 'setNoiseGate', value: +$('mg-gate').value });
    $('mg-gain').oninput = () => send({ type: 'setInputGain', value: +$('mg-gain').value });
    S.micBuilt = true;
  }
  refreshMicControls();
  renderNoiseCal();
  renderNoiseFloorState();
  renderGainCal();
  renderGainApplyState();
  renderProfiles();
}

// The two feedback lines under the noise-floor calibration (operator request
// 2026-08-03 — "applying it shows nothing"):
//   • #noisecal-current — ALWAYS there: the gates actually in force, as the
//     SERVER reports them (`gates.summary`, re-seeded on hello → survives a
//     reload). This is the "what is my noise floor set to?" readout.
//   • #noisecal-applied — the transient one-line apply confirmation carrying
//     the server's READ-BACK numbers, or a loud failure line that stays until
//     the next apply.
function renderNoiseFloorState() {
  const cur = $('noisecal-current');
  if (!cur) return;
  cur.textContent = S.gatesSummary ? `noise floor now: ${S.gatesSummary}` : 'noise floor: —';
  const line = $('noisecal-applied');
  const a = S.noiseApply;
  let text = a ? a.text : '';
  if (a && a.savedTo) text += ` · saved to "${a.savedTo}"`;
  if (a && a.stale) text += ' (last apply)';
  line.textContent = text;
  line.className = 'mac-applied' + (a ? (a.ok ? ' ok' : ' err') : '');
}

// The same two lines under the GAIN calibration (report 20260725_131):
//   • #gaincal-current — ALWAYS there: the input gain actually in force, as the
//     SERVER reports it (`inputGain.summary`, re-seeded on hello → survives a
//     reload). This is the "what is my gain set to?" readout.
//   • #gaincal-applied — the transient one-line apply confirmation carrying the
//     server's READ-BACK value, or a loud failure line that stays until the
//     next apply.
function renderGainApplyState() {
  const cur = $('gaincal-current');
  if (!cur) return;
  cur.textContent = S.gainSummary ? `input gain now: ${S.gainSummary}` : 'input gain: —';
  const line = $('gaincal-applied');
  const a = S.gainApply;
  let text = a ? a.text : '';
  if (a && a.savedTo) text += ` · saved to "${a.savedTo}"`;
  if (a && a.stale) text += ' (last apply)';
  line.textContent = text;
  line.className = 'mac-applied' + (a ? (a.ok ? ' ok' : ' err') : '');
}

// Render the profile chips + the active-profile detail row.
function renderProfiles() {
  const chips = $('mp-chips'); if (!chips) return;
  chips.innerHTML = '';
  for (const p of S.profiles) {
    const chip = el('button', 'mp-chip' + (p.id === S.activeProfileId ? ' active' : ''), p.name);
    chip.title = `apply "${p.name}"`;
    chip.onclick = () => send({ type: 'applyProfile', id: p.id });
    chips.appendChild(chip);
  }
  const active = S.profiles.find((p) => p.id === S.activeProfileId);
  const det = $('mp-active');
  if (det) {
    if (active) {
      const g = active.gates;
      const gv = (v) => (v === null || v === undefined) ? 'global' : (+v).toFixed(3);
      det.innerHTML = `<span class="mp-active-name">▶ ${active.name}</span>
        <span class="mp-active-vals">gates ${gv(g.lowGate)}/${gv(g.midGate)}/${gv(g.highGate)} · global ${(+g.noiseGate).toFixed(3)} · gain ×${(+active.inputGain).toFixed(1)}</span>`;
      const del = el('button', 'mp-del', '× delete');
      del.title = `delete "${active.name}"`;
      del.disabled = S.profiles.length <= 1;
      del.onclick = () => send({ type: 'deleteProfile', id: active.id });
      det.appendChild(del);
    } else {
      det.innerHTML = '<span class="mp-active-vals">no profile selected</span>';
    }
  }
  // Keep both calibrations' "Save to <profile>" button labels current.
  const label = active ? `"${active.name}"` : 'profile';
  const sn = $('noisecal-save-name');
  if (sn) sn.textContent = label;
  const gsn = $('gaincal-save-name');
  if (gsn) gsn.textContent = label;
}

// Reflect S.gates / S.inputGain into the sliders + labels + gate lines.
function refreshMicControls() {
  if (!$('mg-gate')) return;
  $('mg-gate').value = S.gates.noiseGate;
  $('mg-gate-val').textContent = S.gates.noiseGate.toFixed(3);
  $('mg-gain').value = S.inputGain;
  $('mg-gain-val').textContent = '×' + S.inputGain.toFixed(1);
  for (const b of BANDS3) {
    const g = effGate(b);
    $('bs-' + b).value = g;
    const lab = $('bg-' + b);
    lab.textContent = g.toFixed(3);
    lab.classList.toggle('inherit', !hasOverride(b));
    $('bc-' + b).classList.toggle('active', hasOverride(b));
    const line = $('bm-' + b + '-gate');
    if (line) line.style.left = (100 * Math.min(1, g / METER_MAX)) + '%';
  }
  const ls = $('mic-link-state');
  if (ls) {
    ls.textContent = S.engineLinkConnected ? '● mirrored to engine' : '○ local only (engine offline)';
    ls.className = 'mic-link-state ' + (S.engineLinkConnected ? 'ok' : 'warn');
  }
}

function renderNoiseCal() {
  const st = $('noisecal-status'), res = $('noisecal-result'), btn = $('noisecal-btn');
  if (!st) return;
  const phase = S.noiseCal.phase;
  if (phase === 'recording') { st.textContent = '● listening to the room… keep the music OFF'; st.className = 'mac-status rec'; btn.disabled = true; }
  else { st.textContent = ''; btn.disabled = false; }
  if (S.noiseCal.result && phase !== 'recording') {
    const r = S.noiseCal.result;
    res.style.display = 'flex';
    $('nc-low').textContent = r.recommended.low.toFixed(3);
    $('nc-mid').textContent = r.recommended.mid.toFixed(3);
    $('nc-high').textContent = r.recommended.high.toFixed(3);
  } else {
    res.style.display = 'none';
  }
}

function renderGainCal() {
  const st = $('gaincal-status'), res = $('gaincal-result'), btn = $('gaincal-btn');
  if (!st) return;
  const phase = S.cal.phase;
  if (phase === 'recording') { st.textContent = '● measuring peak… play the music LOUD'; st.className = 'mac-status rec'; btn.disabled = true; }
  else if (phase === 'replaying') { st.textContent = '↻ replaying capture…'; st.className = 'mac-status'; btn.disabled = true; }
  else { st.textContent = ''; btn.disabled = false; }
  if (S.cal.result) {
    const r = S.cal.result;
    res.style.display = 'flex';
    $('gc-peak').textContent = r.peak != null ? r.peak.toFixed(2) : '—';
    $('gc-verdict').textContent = r.verdict || '—';
    $('gc-rec').textContent = r.recommendedGain != null ? r.recommendedGain.toFixed(1) : '—';
  } else {
    res.style.display = 'none';
  }
}

// Per-frame meter update (called from draw when the mic page is visible).
function updateMicMeters() {
  for (const b of BANDS3) {
    const lvl = clamp01(S.liveBands[b] || 0);
    const fill = $('bm-' + b + '-fill');
    if (fill) {
      fill.style.width = (100 * Math.min(1, lvl / METER_MAX)) + '%';
      // Colour the bar by whether it's currently above its gate (passing) or
      // below (gated to silence) — instant visual of what the gate is doing.
      fill.classList.toggle('passing', lvl > effGate(b));
    }
    const val = $('bm-' + b + '-val');
    if (val) val.textContent = lvl.toFixed(2);
  }
}

// ── PARTY page (report 20260725_19) ──────────────────────────────────────────
// THE place party detection is tuned. Report 20260725_12 §6's curl-loop
// procedure, as a UI: live meters drawn against the live thresholds, editors
// with APPLY (runtime) + PERSIST (surgical config.yaml write), the §6.2 capture
// helpers, read-only engine session context, validation mode and FAKE TRIGGER.

// Meter full-scales. Loudness is auto-ranged off the threshold so a 0.002
// ambient floor is still readable; the rest are their natural [0,1] / kicks-s.
const PARTY_KICK_MAX = 8;

const pctOf = (v, max) => (100 * Math.max(0, Math.min(1, (v || 0) / max))).toFixed(1) + '%';
const fmtMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms) + 'ms');
const fmtSec = (s) => (s == null ? '—' : (s >= 60 ? `${Math.round(s / 60)}min ${s % 60 ? (s % 60) + 's' : ''}`.trim() : `${s}s`));

function buildPartyPage() {
  if (!S.partyBuilt) {
    $('party-apply').onclick = () => {
      send({ type: 'setPartyParams', params: partyEditPayload() });
    };
    $('party-persist').onclick = () => {
      confirmModal(
        'Write these thresholds into marsin_engine/config.yaml → party: ?\n\n'
        + 'Only the individual value lines are replaced — comments and formatting survive.',
        () => send({ type: 'persistPartyParams', params: partyEditPayload() }),
        'Write',
      );
    };
    $('party-revert').onclick = () => {
      if (S.partyParams) S.partyEdits = { ...S.partyParams };
      renderPartyEditors(); renderPartyDirty();
    };
    $('party-validation').onchange = () => {
      send({ type: 'setPartyValidationMode', on: $('party-validation').checked });
    };
    $('party-cap-ambient').onclick = () => startCapture('ambient');
    $('party-cap-party').onclick = () => startCapture('party');
    $('party-cap-cancel').onclick = () => send({ type: 'cancelPartyCapture' });
    $('party-fake-clear').onclick = () => send({ type: 'setPartyOverride', mode: 'auto' });
    for (const b of document.querySelectorAll('.pfake-btn')) {
      b.onclick = () => send({ type: 'setPartyOverride', mode: b.dataset.mode });
    }
    $('party-arm-toggle').onclick = () => {
      const cfg = S.partyConfig;
      if (!cfg) { flash('party config not loaded from the engine yet', true); return; }
      const next = !cfg.enabled;
      confirmModal(
        next
          ? 'ARM party mode? Detection-driven party sessions will be allowed to fire.'
          : 'DISABLE party mode? No party session can fire, and a live session ends immediately.',
        () => putPartyConfig({ enabled: next }),
        next ? 'Arm' : 'Disable',
      );
    };
    S.partyBuilt = true;
  }
  renderPartyEditors();
  renderPartyDirty();
  renderPartyOverride();
  renderPartyCalib();
  renderPartyMeters();
  refreshPartySession();
}

/** The editor values to send — numbers coerced, booleans as-is. */
function partyEditPayload() {
  const out = {};
  for (const t of S.partyTunables) {
    const v = S.partyEdits[t.key];
    if (v === undefined) continue;
    out[t.key] = t.kind === 'boolean' ? !!v : Number(v);
  }
  return out;
}

function startCapture(kind) {
  const seconds = Number($('party-cap-sec').value);
  send({ type: 'startPartyCapture', kind, seconds });
}

function renderPartyEditors() {
  const grid = $('party-editors');
  if (!grid || !S.partyTunables.length) return;
  // Don't rebuild under a focused input — it would eat a half-typed number.
  const ae = document.activeElement;
  if (ae && grid.contains(ae)) return;
  grid.innerHTML = '';
  for (const t of S.partyTunables) {
    const row = el('div', 'pe-row');
    row.appendChild(el('span', 'pe-lab', `${t.label}<span class="pe-key">${t.key}</span>`));
    if (t.kind === 'boolean') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'pe-check';
      cb.checked = !!S.partyEdits[t.key];
      cb.onchange = () => { S.partyEdits[t.key] = cb.checked; renderPartyDirty(); };
      row.appendChild(cb);
      row.appendChild(el('span', 'pe-unit', ''));
    } else {
      const num = document.createElement('input');
      num.type = 'number';
      num.className = 'pe-num';
      num.min = t.min; num.max = t.max; num.step = t.step;
      const v = S.partyEdits[t.key];
      num.value = v === undefined ? '' : v;
      num.oninput = () => { S.partyEdits[t.key] = num.value === '' ? undefined : Number(num.value); renderPartyDirty(); };
      row.appendChild(num);
      row.appendChild(el('span', 'pe-unit', t.unit || ''));
    }
    row.appendChild(el('span', 'pe-hint', t.hint || ''));
    grid.appendChild(row);
  }
  const chk = $('party-validation');
  if (chk) chk.checked = S.partyValidation;
}

/** Show which editor values differ from what the detector is actually running. */
function renderPartyDirty() {
  const out = $('party-dirty');
  if (!out || !S.partyParams) return;
  const changed = S.partyTunables
    .filter((t) => S.partyEdits[t.key] !== undefined
      && String(S.partyEdits[t.key]) !== String(S.partyParams[t.key]))
    .map((t) => t.key);
  out.textContent = changed.length ? `${changed.length} unapplied: ${changed.join(', ')}` : 'in sync with the live detector';
  out.classList.toggle('on', changed.length > 0);
}

function renderPartyOverride() {
  const banner = $('party-fake-banner');
  const active = S.partyOverride !== 'auto';
  if (banner) banner.style.display = active ? 'flex' : 'none';
  for (const b of document.querySelectorAll('.pfake-btn')) {
    b.classList.toggle('active', b.dataset.mode === S.partyOverride);
    b.classList.toggle('forced', b.dataset.mode !== 'auto' && b.dataset.mode === S.partyOverride);
  }
}

function renderPartyMeters() {
  const st = S.partyState;
  if (!st || !$('pm-loud-fill')) return;
  const p = st.params || {};

  // LOUDNESS — auto-ranged so a tiny calibrated floor is still legible: full
  // scale is 2× the threshold (never below 0.05, so an idle room isn't jumpy).
  const thr = st.levelThreshold || 0;
  const loudMax = Math.max(0.05, thr * 2, (st.loudness || 0) * 1.2);
  $('pm-loud-fill').style.width = pctOf(st.loudness, loudMax);
  $('pm-loud-fill').classList.toggle('ok', !!st.levelOk);
  $('pm-loud-line').style.left = pctOf(thr, loudMax);
  $('pm-loud-val').textContent = (st.loudness || 0).toFixed(4);
  $('pm-loud-thr').textContent = `≥ ${thr.toFixed(4)} (floor ${(p.ambientFloor ?? 0)} × ${(p.marginX ?? 0)})`;

  // KICK RATE — shaded acceptance window between min and max.
  $('pm-kr-fill').style.width = pctOf(st.kickRate, PARTY_KICK_MAX);
  $('pm-kr-fill').classList.toggle('ok', !!st.beatOk);
  const bandEl = $('pm-kr-band');
  const lo = (p.kickRateMin ?? 0) / PARTY_KICK_MAX, hi = (p.kickRateMax ?? 0) / PARTY_KICK_MAX;
  bandEl.style.left = (100 * lo).toFixed(1) + '%';
  bandEl.style.width = (100 * Math.max(0, hi - lo)).toFixed(1) + '%';
  $('pm-kr-val').textContent = (st.kickRate || 0).toFixed(2);
  $('pm-kr-thr').textContent = `${p.kickRateMin ?? '—'}–${p.kickRateMax ?? '—'} /s`;

  const line = (fillId, lineId, valId, thrId, value, limit, ok, digits = 2) => {
    $(fillId).style.width = pctOf(value, 1);
    $(fillId).classList.toggle('ok', !!ok);
    $(lineId).style.left = pctOf(limit, 1);
    $(valId).textContent = (value || 0).toFixed(digits);
    $(thrId).textContent = `≥ ${limit ?? '—'}`;
  };
  line('pm-reg-fill', 'pm-reg-line', 'pm-reg-val', 'pm-reg-thr', st.kickReg, p.kickRegMin, st.kickReg >= (p.kickRegMin ?? 1));
  line('pm-low-fill', 'pm-low-line', 'pm-low-val', 'pm-low-thr', st.lowShare, p.shapeLowMin, st.lowShare >= (p.shapeLowMin ?? 1));
  line('pm-high-fill', 'pm-high-line', 'pm-high-val', 'pm-high-thr', st.highShare, p.shapeHighMin, st.highShare >= (p.shapeHighMin ?? 1));

  const locked = (st.bpmLocked || 0) >= 0.5;
  const lockEl = $('pm-lock');
  lockEl.textContent = locked ? 'BPM LOCKED' : 'BPM UNLOCKED';
  lockEl.classList.toggle('ok', locked);
  lockEl.classList.toggle('off', !locked);
  lockEl.classList.toggle('muted', p.requireBpmLock === false);
  lockEl.title = p.requireBpmLock === false ? 'requireBpmLock is off — this term is not gating' : 'the BPM tracker lock state';

  const sil = (st.silence || 0);
  const silEl = $('pm-silence');
  silEl.textContent = st.quietOk ? 'NOT SILENT' : 'SILENT';
  silEl.classList.toggle('ok', !!st.quietOk);
  silEl.classList.toggle('off', !st.quietOk);
  silEl.title = `audioSilence ${sil} (must be < ${p.silenceMax})`;
  $('pm-conf').textContent = 'conf ' + (st.bpmConf == null ? '—' : st.bpmConf.toFixed(2));

  const term = (id, ok) => {
    const e = $(id);
    e.classList.toggle('ok', !!ok);
    e.classList.toggle('off', !ok);
  };
  term('pm-term-level', st.levelOk); term('pm-term-beat', st.beatOk);
  term('pm-term-shape', st.shapeOk); term('pm-term-quiet', st.quietOk);
  term('pm-term-qualify', st.qualify);

  // DEBOUNCE progress — qualifying toward ON, or disqualifying toward OFF.
  const onMs = p.onSustainMs || 1, offMs = p.offConfirmMs || 1;
  let label, num, frac;
  if (!st.party && st.qualifyingForMs > 0) {
    label = 'qualifying → ON'; frac = st.qualifyingForMs / onMs;
    num = `${fmtMs(st.qualifyingForMs)} / ${fmtMs(onMs)}`;
  } else if (st.party && st.disqualifyingForMs > 0) {
    label = 'disqualifying → OFF'; frac = st.disqualifyingForMs / offMs;
    num = `${fmtMs(st.disqualifyingForMs)} / ${fmtMs(offMs)}`;
  } else {
    label = st.party ? 'PARTY held' : (st.warmedUp ? 'idle — not qualifying' : 'warming up');
    frac = st.party ? 1 : 0; num = '—';
  }
  $('pm-deb-label').textContent = label;
  $('pm-deb-num').textContent = num;
  const debFill = $('pm-deb-fill');
  debFill.style.width = pctOf(frac, 1);
  debFill.classList.toggle('ok', !!st.party);

  // GATE pill = the PUBLISHED value; the truth line appears only when forced.
  const gate = $('party-gate-pill');
  const published = st.publishedParty;
  gate.textContent = 'GATE ' + (published ? '1' : '0');
  gate.classList.toggle('on', !!published);
  const truth = $('pm-truth');
  if (st.overrideMode && st.overrideMode !== 'auto') {
    truth.style.display = 'block';
    truth.innerHTML = `detector says <b>${st.party ? 'PARTY' : 'no party'}</b> · `
      + `publishing <b>${published ? '1' : '0'}</b> (FORCED — ${st.overrideMode})`;
  } else {
    truth.style.display = 'none';
  }

  if (S.partyValidation !== !!st.validationMode) {
    S.partyValidation = !!st.validationMode;
    const chk = $('party-validation'); if (chk) chk.checked = S.partyValidation;
  }
  renderPartyCaptureProgress(st.capture);
}

function renderPartyCaptureProgress(cap) {
  const wrap = $('pcal-prog');
  if (!wrap || !cap) return;
  wrap.style.display = cap.recording ? 'flex' : 'none';
  if (!cap.recording) return;
  $('pcal-prog-lab').textContent = `recording ${cap.kind}… ${(cap.elapsedMs / 1000).toFixed(0)}s / ${(cap.durationMs / 1000).toFixed(0)}s`;
  $('pcal-prog-fill').style.width = pctOf(cap.elapsedMs / (cap.durationMs || 1), 1);
}

function renderPartyCalib() {
  for (const kind of ['ambient', 'party']) {
    const out = $('pcal-res-' + kind);
    if (!out) continue;
    const st = S.partyCaptures[kind];
    if (!st) { out.textContent = 'not captured'; out.classList.remove('on'); continue; }
    out.classList.add('on');
    out.innerHTML = kind === 'ambient'
      ? `<b>P95 ${st.p95.toFixed(4)}</b> · median ${st.p50.toFixed(4)} · max ${st.max.toFixed(4)} · n=${st.n}`
      : `<b>P5 ${st.p5.toFixed(4)}</b> · median ${st.p50.toFixed(4)} · kickReg ${st.kickReg == null ? '—' : st.kickReg.toFixed(2)}`
        + ` · bpm locked ${(st.bpmLockedFrac * 100).toFixed(0)}% · n=${st.n}`;
  }
  const sg = $('pcal-sugg');
  if (!sg) return;
  const s = S.partySuggestions;
  if (!s) {
    sg.innerHTML = '<span class="pcal-sugg-none">capture BOTH baselines to get a suggestion</span>';
    return;
  }
  sg.innerHTML = '<span class="pcal-sugg-lab">SUGGESTED</span>';
  const vals = el('span', 'pcal-sugg-vals',
    `ambientFloor <b>${s.ambientFloor.toFixed(4)}</b> · marginX <b>${s.marginX.toFixed(2)}</b>`
    + (s.kickRegMin !== undefined ? ` · kickRegMin <b>${s.kickRegMin.toFixed(2)}</b>` : ''));
  sg.appendChild(vals);
  const btn = el('button', 'primary', '↧ load into the editors');
  btn.title = 'fills the editors above — nothing is applied until you press APPLY';
  btn.onclick = () => {
    S.partyEdits.ambientFloor = +s.ambientFloor.toFixed(4);
    S.partyEdits.marginX = +s.marginX.toFixed(2);
    if (s.kickRegMin !== undefined) S.partyEdits.kickRegMin = +s.kickRegMin.toFixed(2);
    renderPartyEditors(); renderPartyDirty();
    flash('suggestions loaded — press APPLY to make them live');
  };
  sg.appendChild(btn);
}

// ── engine-owned session context (read-only) + the arm/disable authority ─────
// Both go through the companion's own /party/* proxies (the engine lives on a
// different port). Polled slowly — this is show state, not a meter.
const PARTY_SESSION_POLL_MS = 3000;
let partySessionTimer = null;

async function refreshPartySession() {
  try {
    const [sess, cfg] = await Promise.all([
      fetch('/party/session').then((r) => r.json()),
      fetch('/party/config').then((r) => r.json()),
    ]);
    if (sess && sess.error) throw new Error(sess.error);
    if (cfg && cfg.error) throw new Error(cfg.error);
    S.partySession = sess; S.partyConfig = cfg; S.partySessionError = null;
  } catch (e) {
    S.partySession = null; S.partyConfig = null;
    S.partySessionError = String(e && e.message);
  }
  renderPartySession();
}

async function putPartyConfig(patch) {
  try {
    const r = await fetch('/party/config', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    S.partyConfig = j; S.partySessionError = null;
    flash(`party mode ${j.enabled ? 'ARMED' : 'DISABLED'}`);
    renderPartySession();
  } catch (e) {
    flash('party config: ' + (e && e.message), true);
  }
}

const EFFECTIVE_LABEL = {
  armed: 'ARMED — a real party can start a session',
  disabled: 'DISABLED by the operator',
  no_plan: 'no plan driving — the mood trigger lives in the plan, so nothing can fire',
  manual: 'a human has taken over — the plan (and party) yields',
  in_session: 'PARTY SESSION RUNNING',
  cooldown: 'cooling down since the last session',
};

function renderPartySession() {
  const err = $('psx-err');
  if (!err) return;
  if (S.partySessionError) {
    err.style.display = 'block';
    err.textContent = 'engine unreachable: ' + S.partySessionError;
  } else {
    err.style.display = 'none';
  }
  const cfg = S.partyConfig, sess = S.partySession;
  const armPill = $('party-arm-pill'), armBtn = $('party-arm-toggle');
  if (cfg) {
    const on = !!cfg.enabled;
    armPill.textContent = on ? 'ARMED' : 'DISABLED';
    armPill.classList.toggle('on', on);
    armPill.classList.toggle('off', !on);
    armPill.title = EFFECTIVE_LABEL[cfg.effectiveState] || cfg.effectiveState || '';
    armBtn.textContent = on ? '⏻ DISABLE party mode' : '⏻ ARM party mode';
    armBtn.classList.toggle('danger', on);
    $('psx-eff').textContent = EFFECTIVE_LABEL[cfg.effectiveState] || cfg.effectiveState || '—';
    $('psx-playlist').textContent = cfg.playlist || '—';
    $('psx-dwell').textContent = fmtSec(cfg.minDwellSec) + ' (always enforced)';
    // FOLLOW-THE-MUSIC: no fixed length, and the release sustain is the
    // detector's own offConfirmMs — the editor above, not a second timer.
    if (cfg.durationEnabled === false) {
      const off = S.partyParams ? S.partyParams.offConfirmMs : null;
      $('psx-dur').textContent = 'follow the music — ends ~'
        + (off == null ? 'offConfirmMs' : fmtSec(Math.round(off / 1000)))
        + ' after the music stops (that is offConfirmMs above)';
      $('psx-cool').textContent = 'none in follow-the-music mode';
    } else {
      $('psx-dur').textContent = cfg.durationMin == null ? '—' : `${cfg.durationMin} min`;
      $('psx-cool').textContent = cfg.effectiveCooldownEnabled === false
        ? 'off'
        : fmtSec(cfg.cooldownSec)
          + (cfg.cooldownRemainingSec > 0 ? ` (${fmtSec(cfg.cooldownRemainingSec)} left)` : '');
    }
  } else {
    armPill.textContent = '—'; armPill.classList.remove('on', 'off');
    armBtn.textContent = '—';
    for (const id of ['psx-eff', 'psx-playlist', 'psx-dwell', 'psx-dur', 'psx-cool']) $(id).textContent = '—';
  }
  if (sess) {
    $('psx-mood').textContent = `${sess.currentMood || '—'} (value ${sess.moodValue ?? '—'}, key ${sess.moodKey || '—'})`;
    $('psx-cue').textContent = sess.activeCue ? `${sess.activeCue.label} [${sess.activeCue.id}]` : 'none (baseline)';
    const stale = $('psx-stale');
    stale.style.display = sess.moodStale ? 'inline-block' : 'none';
    stale.textContent = `⚠ moodStale ${sess.moodStaleForSec ?? '?'}s — party detection looks DOWN, the show is on ambient because of it`;
    const plan = $('psx-plan');
    const driving = sess.planActive === true;
    plan.style.display = driving ? 'none' : 'inline-block';
    plan.textContent = sess.inFestivalWindow === false
      ? `plan dormant — festival starts in ${sess.festivalStartsInDays ?? '?'} days`
      : `plan not driving (controller ${sess.controller || '—'})`;
  } else {
    $('psx-mood').textContent = '—';
    $('psx-cue').textContent = '—';
  }
}

function setPage(page) {
  S.page = (page === 'osc' || page === 'mic' || page === 'party') ? page : 'design';
  const design = $('page-design'), osc = $('page-osc'), mic = $('page-mic'), party = $('page-party');
  if (design) design.style.display = S.page === 'design' ? '' : 'none';
  if (osc) osc.style.display = S.page === 'osc' ? 'flex' : 'none';
  if (mic) mic.style.display = S.page === 'mic' ? 'flex' : 'none';
  if (party) party.style.display = S.page === 'party' ? 'flex' : 'none';
  for (const b of document.querySelectorAll('.nav-btn')) {
    b.classList.toggle('active', b.dataset.page === S.page);
  }
  if (S.page === 'osc') renderOscPage();
  if (S.page === 'mic') buildMicPage();
  // The session poll only runs while the PARTY page is open — off the page it
  // is pure noise on the engine.
  if (partySessionTimer) { clearInterval(partySessionTimer); partySessionTimer = null; }
  if (S.page === 'party') {
    buildPartyPage();
    partySessionTimer = setInterval(refreshPartySession, PARTY_SESSION_POLL_MS);
  }
}
function buildNav() {
  for (const b of document.querySelectorAll('.nav-btn')) {
    b.onclick = () => setPage(b.dataset.page);
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
// Themed confirm dialog wiring (Cancel/✕/backdrop dismiss; Remove runs the cb).
$('confirm-cancel').onclick = closeConfirm;
$('confirm-x').onclick = closeConfirm;
$('confirm-ok').onclick = () => { const cb = _confirmCb; closeConfirm(); if (cb) cb(); };
// Click the dark backdrop (outside the box) to dismiss any modal.
for (const mid of ['add-modal', 'export-modal', 'browse-modal', 'view-modal', 'confirm-modal']) {
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
    if (m.bands) S.liveBands = m.bands;
    if (m.struct) S.struct = m.struct;
    if (m.spectrum) S.spectrum = m.spectrum;
    if (m.wave) S.wave = m.wave;
    if (m.derived) {
      if (m.derived.sp > 0.5 && S.derived.sp <= 0.5) S.spFlash = 1;
      if (m.derived.sc > 0.5 && S.derived.sc <= 0.5) S.scFlash = 1;
      // Arm the NEW pulse-key flashes on the rising edge (one-hop pulses would
      // otherwise blink past a 60 fps render). null prev/cur reads as 0 → no arm.
      armPulse(m.derived, 'dropCountdown', 'countdownFlash');
      armPulse(m.derived, 'phraseBoundary', 'boundaryFlash');
      armPulse(m.derived, 'trackChange', 'trackChangeFlash');
      armPulse(m.derived, 'onsetLow', 'onsetLowFlash');
      armPulse(m.derived, 'onsetMid', 'onsetMidFlash');
      armPulse(m.derived, 'onsetHigh', 'onsetHighFlash');
      armPulse(m.derived, 'chestHit', 'chestFlash');
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
  if (S.page === 'mic') updateMicMeters();
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

// Theme + nav are pure client UI — wire them before the socket so the picked
// theme is applied immediately on load (no flash of the default palette).
applyTheme(currentTheme());
buildThemePicker();
buildNav();

connect();
requestAnimationFrame(draw);
