/*
 * tools/pattern_derived_harness.mjs — prove a pattern's DERIVED-signal reactivity
 * OFFLINE, end to end through the REAL engine audio chain, driven by the test
 * SYNTHESIZER bank. This is the committed, reproducible companion to
 * tools/pattern_audio_harness.mjs (which only drives the FIVE raw analyzer bands
 * micLow/Mid/High/Kick/Flux). The Round-2 / Wave-D patterns 64–68 (and 59) react
 * to the SECOND-TIER derived signals — audioDropCountdown, audioClimax,
 * audioPhrasePhase/Boundary, audioSilence/TrackChange, audioRiserScore,
 * micOnsetLow/Mid/High, … — which are computed engine-INTERNAL by the
 * AudioStructureDetector + DerivedSignals (NOT OSC-routed). Before this file the
 * only proof those patterns reacted lived in a gitignored ~/tmp harness; this
 * promotes that proof into the tree.
 *
 *   synth (audio/synth/test_synths.js)
 *     → real AudioAnalyzer  (the engine DSP, fftSize 2048)               [→ ParamCenter]
 *     → real AudioStructureDetector  (build/drop/slow-zone/energy)       [→ ParamCenter]
 *     → real DerivedSignals  (riser/climax/phrase/countdown/track-change/onsets/…)
 *     → derived-signal OVERRIDE map (signal → pattern slider, range-normalised,
 *        exactly like lib/modulation_engine.js does on the rig)
 *     → MarsinVM render on the chosen model  → brightness series + correlations.
 *
 * No engine process, no ports, no mic — but EVERY stage is the genuine engine
 * module, so a pattern that reacts to audioDropCountdown really reacts to the
 * countdown the detector+riser emit on a synthesized riser→drop.
 *
 * The signal→slider map + each slider's declared 0..1 range are auto-discovered
 * from the pattern's `AUDIO_MODULATION_V1` doc block (the modulators-only
 * contract), so the harness drives each pattern exactly as the engine would with
 * no hand-written --mod. Override with --mod to force a mapping.
 *
 * Usage:
 *   node tools/pattern_derived_harness.mjs --pattern patterns/64_drop_countdown.js \
 *        --synth edm_drop --model titanic --frames 240
 *
 *   --pattern  pattern file (required).
 *   --synth    one of audio/synth/test_synths.js SYNTHS (default full_track).
 *   --model    rig model in models/<name>.js (default test_bench). FAILS LOUDLY
 *              if missing or its pixels[] lack required fields (codex P0: no
 *              silent fallback to test_bench).
 *   --frames   render frames at the internal 40 fps DT (default 240 ≈ 6 s).
 *   --mod      override the auto-discovered map: comma list of
 *              <derivedKey>:<sliderExport>[:<min>:<max>]. Default range 0..1.
 *   --set      static control presets (export=value), comma list.
 *   --bpm      override synth bpm.
 *   --out      write a brightness+signal trace JSON here (default ~/tmp/derived_vis.json).
 *
 * Exit 0 on success. Any compile / model / synth / mapping failure prints a
 * *_FAIL line and exits 2 (fail loud).
 */
import { AudioAnalyzer } from '../audio/analyzer/audio_analyzer.js';
import { AudioStructureDetector } from '../audio/detector/audio_structure_detector.js';
import { DerivedSignals } from '../audio/signals/derived_signals.js';
import { ParamCenter } from '../lib/param_center.js';
import { fillFrame, SYNTHS } from '../audio/synth/test_synths.js';
import { createWasmRuntime } from '../lib/marsin_wasm_runtime.js';
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : 'true']);
  return a;
}, []));

if (!A.pattern || A.pattern === 'true') { console.log('ARG_FAIL: --pattern <file> is required'); process.exit(2); }
const patternPath = path.resolve(A.pattern);
if (!fs.existsSync(patternPath)) { console.log('PATTERN_FAIL: no pattern file ' + patternPath); process.exit(2); }
const synth = A.synth || 'full_track';
if (!SYNTHS[synth]) { console.log('SYNTH_FAIL: unknown synth ' + synth + ' (have: ' + Object.keys(SYNTHS).join(',') + ')'); process.exit(2); }
const frames = parseInt(A.frames || '240', 10);
if (!(frames > 0)) { console.log('FRAMES_FAIL: --frames must be > 0'); process.exit(2); }
const modelName = (A.model && A.model !== 'true') ? A.model : 'test_bench';
if (!/^[A-Za-z0-9._-]+$/.test(modelName)) { console.log('MODEL_FAIL: bad model name ' + modelName); process.exit(2); }
const out = A.out || (process.env.HOME + '/tmp/derived_vis.json');

// Audio constants — MUST match config.yaml so the offline DSP equals the rig.
const SR = 44100, FFT = 2048, HOP = 512, DT = 0.025;

const src = fs.readFileSync(patternPath, 'utf8');

// ── Auto-discover the signal→slider map from the AUDIO_MODULATION_V1 block ─────
// Each mapping line reads `sliderX <- audioKey range A..B curve C`. We pull the
// derivedKey, the slider export, and the declared range so we can apply the
// engine's OVERRIDE (slider = lerp(min,max, keyNorm)) where keyNorm scales the
// raw key into 0..1 by the declared range — IDENTICAL to lib/modulation_engine.js.
function discoverMods(source) {
  const mods = [];
  const reLine = /(slider[A-Za-z0-9_]+)\s*<-\s*([A-Za-z0-9_]+)\s+range\s+(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = reLine.exec(source))) {
    mods.push({ target: m[1], key: m[2], min: parseFloat(m[3]), max: parseFloat(m[4]) });
  }
  return mods;
}
let mods = discoverMods(src);
if (A.mod && A.mod !== 'true') {
  mods = A.mod.split(',').map(tok => {
    const p = tok.split(':');
    if (p.length < 2) { console.log('MOD_FAIL: --mod token needs key:slider — ' + tok); process.exit(2); }
    return { key: p[0], target: p[1], min: p.length >= 4 ? parseFloat(p[2]) : 0, max: p.length >= 4 ? parseFloat(p[3]) : 1 };
  });
}
if (mods.length === 0) { console.log('MOD_FAIL: no AUDIO_MODULATION_V1 mappings found and no --mod given'); process.exit(2); }

// ── ParamCenter + full audio chain (analyzer → detector → derived) ────────────
const paramCenter = new ParamCenter(null);
// Sanity: every derived key we will read must exist in the registry (fail loud).
for (const mod of mods) { try { paramCenter.get(mod.key); } catch (e) { console.log('MOD_FAIL: derived key not in ParamCenter registry: ' + mod.key); process.exit(2); } }

let clock = 0;
const events = [];
const structureDetector = new AudioStructureDetector({
  paramCenter,
  broadcast: (msg) => { if (msg && msg.type) events.push(msg.type); },
  // Enable the detector with its shipped DEFAULT thresholds (the constructor
  // merges DETECTOR_DEFAULTS under whatever getConfig returns) — just flip it on.
  getConfig: () => ({ enabled: true }),
});
const derived = new DerivedSignals({ paramCenter });

const analyzer = new AudioAnalyzer({
  sampleRate: SR, fftSize: FFT, hopSize: HOP,
  bands: { lowMaxHz: 200, midMaxHz: 4000, attackMs: 6, releaseMs: 180, noiseGate: 0.04, inputGain: 1.0, sourceSmoothHz: 12000 },
  kick: { minHz: 50, maxHz: 110, threshold: 2.4, refractoryMs: 220, decayMs: 70 },
  sub: { minHz: 20, maxHz: 60 },
  nowFn: () => clock,
  onAnalysis: (a) => {
    // Mirror the engine onAnalysis bundle: write raw + (here, identity) post keys
    // plus dom/onset/sub mirrors, then tick the detector and derived chain —
    // EXACTLY the engine's order (engine.js onAnalysis). Post == raw here (no
    // signalPostProcessor node chain offline), which is the default rig state.
    const nowMs = clock;
    const dt = lastHopMs === 0 ? 0 : Math.max(0, (nowMs - lastHopMs) / 1000);
    lastHopMs = nowMs;
    paramCenter.setMany([
      { kind: 'scalar', key: 'micLow', value: a.low }, { kind: 'scalar', key: 'micMid', value: a.mid },
      { kind: 'scalar', key: 'micHigh', value: a.high }, { kind: 'scalar', key: 'micKick', value: a.kick },
      { kind: 'scalar', key: 'micFlux', value: a.flux },
      { kind: 'scalar', key: 'micLowRaw', value: a.low }, { kind: 'scalar', key: 'micMidRaw', value: a.mid },
      { kind: 'scalar', key: 'micHighRaw', value: a.high }, { kind: 'scalar', key: 'micKickRaw', value: a.kick },
      { kind: 'scalar', key: 'micFluxRaw', value: a.flux },
      { kind: 'scalar', key: 'micDomFreq1', value: a.domFreq1 }, { kind: 'scalar', key: 'micDomEnergy1', value: a.domEnergy1 },
      { kind: 'scalar', key: 'micDomFreq2', value: a.domFreq2 }, { kind: 'scalar', key: 'micDomEnergy2', value: a.domEnergy2 },
      { kind: 'scalar', key: 'micOnsetLowRaw', value: a.onsetLow }, { kind: 'scalar', key: 'micOnsetMidRaw', value: a.onsetMid },
      { kind: 'scalar', key: 'micOnsetHighRaw', value: a.onsetHigh }, { kind: 'scalar', key: 'micSubRaw', value: a.micSub },
    ], 'audio', 'audio:mic');
    structureDetector.tick(nowMs, dt);
    derived.tick(nowMs, dt);
  },
});
let lastHopMs = 0;

// ── model + VM ────────────────────────────────────────────────────────────────
const modelPath = path.join(ENGINE_DIR, 'models', modelName + '.js');
if (!fs.existsSync(modelPath)) { console.log('MODEL_FAIL: no model file ' + modelPath); process.exit(2); }
const model = await import(pathToFileURL(modelPath).href);
if (!Array.isArray(model.pixels) || model.pixels.length === 0) { console.log('MODEL_FAIL: ' + modelName + '.js exports no non-empty pixels[]'); process.exit(2); }
const REQUIRED_PIXEL_FIELDS = ['i', 'fId', 'sId', 'nx', 'ny', 'nz'];
for (const f of REQUIRED_PIXEL_FIELDS) {
  if (model.pixels[0][f] === undefined) { console.log('MODEL_FAIL: ' + modelName + '.js pixels[] missing required field "' + f + '"'); process.exit(2); }
}
const px = model.pixels; const N = px.length;
const rt = await createWasmRuntime(N);
rt.setCoords(px.map(p => ({ nx: p.nx, ny: p.ny, nz: p.nz })));
rt.setPixelMeta(px.map(p => ({ controllerId: p.cId || 0, sectionId: p.sId || 0, fixtureId: p.fId || 0, viewMask: p.vMask || 0 })));
const cr = rt.compile(src);
if (!cr.ok) { console.log('COMPILE_FAIL: ' + cr.error); process.exit(2); }
console.log('COMPILE_OK');
const exps = rt.getExports();
const idOf = name => { const e = exps.find(e => e.name === name); return e ? e.id : null; };

// Apply the pattern's declared export-var defaults (palette + identity sliders),
// matching pattern_audio_harness.mjs so the palette is not black at rest.
const defs = {}; const reDef = /export\s+var\s+([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)/g; let dm;
while ((dm = reDef.exec(src))) defs[dm[1]] = parseFloat(dm[2]);
function applyPalette(fn, h, s, v) { const id = idOf(fn); if (id == null) return; rt.setControl(id, h, s, v); }
if (idOf('colorPalette1') != null) applyPalette('colorPalette1', defs.cp1H ?? 0, defs.cp1S ?? 1, defs.cp1V ?? 1);
if (idOf('colorPalette2') != null) applyPalette('colorPalette2', defs.cp2H ?? 0, defs.cp2S ?? 1, defs.cp2V ?? 1);
for (const e of exps) {
  if (e.name.startsWith('slider')) {
    const varName = e.name.slice(6, 7).toLowerCase() + e.name.slice(7);
    if (defs[varName] != null) rt.setControl(e.id, defs[varName]);
  }
}
for (const mod of mods) if (idOf(mod.target) == null) console.log('WARN: --mod target export not found on pattern: ' + mod.target);
if (A.set && A.set !== 'true') for (const kv of A.set.split(',')) { const [k, v] = kv.split('='); const id = idOf(k);
  if (id == null) { console.log('WARN: no export ' + k); continue; } rt.setControl(id, parseFloat(v)); }

console.log('DERIVED_MAP ' + mods.map(m => `${m.key}->${m.target}[${m.min}..${m.max}]`).join(' '));

// ── audio advance: push ~one render-frame of synth through the analyzer ────────
const bpm = (A.bpm && A.bpm !== 'true') ? { bpm: parseFloat(A.bpm) } : {};
const samplesPerFrame = Math.round(SR * DT);
const sbuf = new Int16Array(HOP); let cursor = 0;
function advanceAudio() {
  let remaining = samplesPerFrame;
  while (remaining > 0) {
    const n = Math.min(HOP, remaining);
    fillFrame(sbuf.subarray(0, n), synth, cursor, SR, bpm); cursor += n; clock += (n / SR) * 1000;
    analyzer.pushSamples(sbuf.subarray(0, n)); remaining -= n;
  }
}

// ── 6ch → display rgb (engine RGB fallback for W/A/U) ─────────────────────────
const fold = b6 => { const o = []; for (let i = 0; i < N; i++) { const k = i * 6;
  const R = b6[k], G = b6[k + 1], B = b6[k + 2], W = b6[k + 3], Am = b6[k + 4], U = b6[k + 5];
  o.push([Math.min(255, Math.round(R + W + Am * 0.8 + U * 0.1)), Math.min(255, Math.round(G + W + Am * 0.4)), Math.min(255, Math.round(B + W + U * 0.5))]); }
  return o; };

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

// ── render loop: drive each derived signal into its slider as the engine does ──
const totals = []; const sigSeries = {}; for (const m of mods) sigSeries[m.key] = [];
const trace = [];
let peakChan = 0;
for (let f = 0; f < frames; f++) {
  advanceAudio();
  for (const m of mods) {
    const raw = paramCenter.get(m.key);
    sigSeries[m.key].push(raw);
    const id = idOf(m.target);
    if (id != null) {
      // Engine OVERRIDE: keyNorm = (raw - min) / (max - min), clamp01; slider :=
      // lerp(min,max,keyNorm) == clamp(raw) for a 0..1 range. (For an index key
      // declared 0..1 the pattern rescales internally; matches the rig.)
      const span = (m.max - m.min) || 1;
      const keyNorm = clamp01((raw - m.min) / span);
      const v = m.min + (m.max - m.min) * keyNorm;
      rt.setControl(id, clamp01(v));
    }
  }
  rt.beginFrame(f * DT);
  const rgb = fold(rt.renderAll6ch());
  let tot = 0;
  for (let i = 0; i < N; i++) { const s = rgb[i][0] + rgb[i][1] + rgb[i][2]; tot += s;
    if (rgb[i][0] > peakChan) peakChan = rgb[i][0]; if (rgb[i][1] > peakChan) peakChan = rgb[i][1]; if (rgb[i][2] > peakChan) peakChan = rgb[i][2]; }
  totals.push(tot);
  const row = { f, totalBri: tot };
  for (const m of mods) row[m.key] = sigSeries[m.key][sigSeries[m.key].length - 1];
  trace.push(row);
}

// ── trace JSON for inspection ─────────────────────────────────────────────────
fs.writeFileSync(out, JSON.stringify({ pattern: path.basename(patternPath, '.js'), synth, model: modelName, frames, fps: Math.round(1 / DT), mods, trace }, null, 0));

// ── report ────────────────────────────────────────────────────────────────────
function stats(xs) { const mn = Math.min(...xs), mx = Math.max(...xs), mean = xs.reduce((a, b) => a + b, 0) / xs.length; return { mn, mx, mean }; }
function corr(xs, ys) { const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let nu = 0, dx = 0, dy = 0; for (let i = 0; i < xs.length; i++) { nu += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return nu / (Math.sqrt(dx * dy) || 1); }

const tStat = stats(totals);
console.log(`SYNTH=${synth} MODEL=${modelName} PIX=${N} FRAMES=${frames}@${Math.round(1 / DT)}fps peakChan=${peakChan}`);
console.log(`TOTAL_BRI min/avg/max=${Math.round(tStat.mn)}/${Math.round(tStat.mean)}/${Math.round(tStat.mx)} ${tStat.mx - tStat.mn > tStat.mean * 0.15 ? '(ANIMATING)' : '(LOW-VARIATION)'}`);
if (events.length) {
  const counts = {}; for (const e of events) counts[e] = (counts[e] || 0) + 1;
  console.log('DETECTOR_EVENTS ' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
}
for (const m of mods) {
  const xs = sigSeries[m.key]; const s = stats(xs); const c = corr(xs, totals);
  const fired = s.mx > (m.min + 0.5 * ((m.max - m.min) || 1)) ? 'FIRED' : 'flat';
  console.log(`DERIVED_REACT ${m.key}->${m.target}: corr(signal,brightness)=${c.toFixed(2)} signalRange=${s.mn.toFixed(2)}..${s.mx.toFixed(2)} mean=${s.mean.toFixed(2)} [${fired}] ${Math.abs(c) > 0.35 ? '(REACTIVE)' : (s.mx <= s.mn + 1e-6 ? '(signal never moved — pick a synth that drives it)' : '(weak/indirect)')}`);
}
console.log('OUT=' + out);
rt.destroy();
