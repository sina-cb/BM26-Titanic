/*
 * tools/pattern_audio_harness.mjs — test a pattern's audio reactivity OFFLINE,
 * end to end through the REAL DSP, driven by the test SYNTHESIZER bank.
 *
 *   synth (audio/synth/test_synths.js)  →  real AudioAnalyzer (the engine DSP)
 *     →  CPC signal series (micLow/micMid/micHigh/micKick/micFlux)
 *     →  modulation map (source → pattern slider, the modulators-only contract)
 *     →  MarsinVM render on the test_bench model  →  capture JSON (+ assertions)
 *
 * No engine, no ports, no mic — but the audio path is the genuine analyzer, so
 * a pattern that reacts to micKick really reacts to a synthesized kick drum.
 * Pair the JSON with tools/make_vis_clip.mjs to get a widget.
 *
 * Usage:
 *   node tools/pattern_audio_harness.mjs --pattern patterns/28_x.js \
 *        --synth edm_drop --frames 80 \
 *        --mod micLow:sliderAudioLevel,micKick:sliderBeat \
 *        [--set sliderLocalSpeed=0.6] [--out ~/tmp/vis.json]
 *
 *   --synth   one of audio/synth/test_synths.js SYNTHS (default full_track)
 *   --mod     comma list of <signal>:<sliderExport>[:<min>:<max>[:<curve>]];
 *             signal ∈ micLow|micMid|micHigh|micKick|micFlux. The optional
 *             range+curve make the offline reactive capture match the engine's
 *             OVERRIDE modulation: each frame the slider = lerp(min, max,
 *             curve(signalNorm)), curve ∈ linear|pow2(x²)|ease(1-(1-x)²).
 *             Backward-compatible: a bare `signal:slider` token = range 0..1
 *             linear (identity), i.e. slider := signal as before.
 *   --set     static control presets (export=value)
 *   --frames  render frames at 40 fps (default 80 ≈ 2 s). Ignored if --seconds.
 *   --seconds real-time clip length in seconds (wins over --frames). The audio
 *             analyzer + VM still step at the internal 40 fps DT for fidelity;
 *             we EMIT one stored frame every round((1/F)/DT) internal steps,
 *             for round(S*F) stored frames — a true S-second clip, not slo-mo.
 *   --out-fps clip playback frame rate (default 20) for --seconds (the stored
 *             frame cadence). Stamped into the JSON as `fps`.
 *   --max-cells  big-rig safety cap on emitted color cells (frames×pixels,
 *             default 150000). When a clip would exceed it, out-fps is lowered
 *             and/or pixels are strided for the clip — PRINTED loudly, never a
 *             silent truncation. test_bench (52 px) keeps full fidelity.
 *   --bpm     override synth bpm
 *   --model   rig model in models/<name>.js (default test_bench). FAILS LOUDLY
 *             if the file is missing or its pixels[] lack the required fields —
 *             never silently falls back to test_bench (codex P0).
 */
import { AudioAnalyzer } from '../audio/analyzer/audio_analyzer.js';
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

const patternPath = path.resolve(A.pattern);
const synth = A.synth || 'full_track';
if (!SYNTHS[synth]) { console.log('SYNTH_FAIL: unknown synth ' + synth); process.exit(2); }
const framesArg = parseInt(A.frames || '80', 10);
const modelName = (A.model && A.model !== 'true') ? A.model : 'test_bench';
if (!/^[A-Za-z0-9._-]+$/.test(modelName)) { console.log('MODEL_FAIL: bad model name ' + modelName); process.exit(2); }
const out = A.out || (process.env.HOME + '/tmp/genkit/out/vis.json');
const SR = 44100, FFT = 1024, HOP = 512, DT = 0.025;

// ── recording length / cadence ────────────────────────────────────────────────
// Internal stepping always runs at the DT (40 fps) cadence for audio fidelity.
// --seconds (real-time clip length) wins over --frames. --out-fps is the clip's
// playback frame rate (the stored-frame cadence). Without --seconds, behavior is
// unchanged: emit `--frames` stored frames, one per internal step.
const useSeconds = A.seconds !== undefined && A.seconds !== 'true';
const seconds = useSeconds ? parseFloat(A.seconds) : null;
if (useSeconds && (!(seconds > 0) || !isFinite(seconds))) { console.log('SECONDS_FAIL: --seconds must be > 0, got ' + A.seconds); process.exit(2); }
let outFps = (A['out-fps'] !== undefined && A['out-fps'] !== 'true') ? parseFloat(A['out-fps']) : 20;
if (!(outFps > 0) || !isFinite(outFps)) { console.log('OUTFPS_FAIL: --out-fps must be > 0, got ' + A['out-fps']); process.exit(2); }
const maxCells = (A['max-cells'] !== undefined && A['max-cells'] !== 'true') ? parseInt(A['max-cells'], 10) : 150000;
if (!(maxCells > 0)) { console.log('MAXCELLS_FAIL: --max-cells must be > 0, got ' + A['max-cells']); process.exit(2); }
const SIG_FIELD = { micLow: 'low', micMid: 'mid', micHigh: 'high', micKick: 'kick', micFlux: 'flux' };

// ── --mod grammar (RANGE-AWARE) ───────────────────────────────────────────────
// Token: `sig:slider[:min:max[:curve]]`. Bare `sig:slider` = range 0..1 linear
// (identity — slider := signal, the legacy behaviour). With a range, the slider
// each frame = lerp(min, max, curve(signalNorm)), matching the engine's OVERRIDE
// modulation so the offline reactive capture looks like the deployed pattern.
// curve ∈ linear | pow2(x²) | ease(easeOut = 1-(1-x)²). Default curve = linear.
const CURVES = {
  linear: (x) => x,
  pow2: (x) => x * x,
  ease: (x) => 1 - (1 - x) * (1 - x),
};
const mods = [];
if (A.mod) for (const m of A.mod.split(',')) {
  const parts = m.split(':');
  const sig = parts[0];
  const target = parts[1];
  if (!SIG_FIELD[sig]) { console.log('MOD_FAIL: unknown signal ' + sig); process.exit(2); }
  if (!target) { console.log('MOD_FAIL: --mod token missing slider target: ' + m); process.exit(2); }
  let min = 0, max = 1, curveName = 'linear';
  if (parts.length >= 4) {
    min = parseFloat(parts[2]); max = parseFloat(parts[3]);
    if (!isFinite(min) || !isFinite(max)) { console.log('MOD_FAIL: bad range in --mod token: ' + m); process.exit(2); }
    if (parts[4] !== undefined && parts[4] !== '') curveName = parts[4];
  } else if (parts.length === 3) {
    console.log('MOD_FAIL: --mod range needs both min and max (sig:slider:min:max[:curve]): ' + m); process.exit(2);
  }
  if (!CURVES[curveName]) { console.log('MOD_FAIL: unknown curve "' + curveName + '" in --mod token: ' + m + ' (valid: linear, pow2, ease)'); process.exit(2); }
  mods.push({ sig, target, min, max, curve: CURVES[curveName], curveName });
}

// ── model + VM ───────────────────────────────────────────────────────────────
// Load models/<modelName>.js. FAIL LOUDLY if the file is missing or its
// pixels[] lack the fields meta/coords need — never silently use test_bench.
const modelPath = path.join(ENGINE_DIR, 'models', modelName + '.js');
if (!fs.existsSync(modelPath)) { console.log('MODEL_FAIL: no model file ' + modelPath); process.exit(2); }
const model = await import(pathToFileURL(modelPath).href);
if (!Array.isArray(model.pixels) || model.pixels.length === 0) {
  console.log('MODEL_FAIL: ' + modelName + '.js exports no non-empty pixels[]'); process.exit(2); }
const REQUIRED_PIXEL_FIELDS = ['i', 'fId', 'sId', 'nx', 'ny', 'nz'];
for (const f of REQUIRED_PIXEL_FIELDS) {
  if (model.pixels[0][f] === undefined) {
    console.log('MODEL_FAIL: ' + modelName + '.js pixels[] missing required field "' + f + '"'); process.exit(2); } }
const px = model.pixels; const N = px.length;
const rt = await createWasmRuntime(N);
rt.setCoords(px.map(p => ({ nx: p.nx, ny: p.ny, nz: p.nz })));
rt.setPixelMeta(px.map(p => ({ controllerId: p.cId || 0, sectionId: p.sId || 0, fixtureId: p.fId || 0, viewMask: p.vMask || 0 })));
const r = rt.compile(fs.readFileSync(patternPath, 'utf8'));
if (!r.ok) { console.log('COMPILE_FAIL: ' + r.error); process.exit(2); }
console.log('COMPILE_OK');
const exps = rt.getExports();
const idOf = name => { const e = exps.find(e => e.name === name); return e ? e.id : null; };

// Apply the pattern's DECLARED export-var defaults (the standalone VM inits all
// control slots to 0 — the engine applies these on load, so we must too or the
// palette reads black/red and sliders sit at 0). Parse `export var X = NUM`,
// then: hsvPicker (colorPalette1/2) gets cp{1,2}{H,S,V}; each sliderFoo gets the
// default of its `foo` var (identity-slider convention). --set and --mod override.
const src = fs.readFileSync(patternPath, 'utf8');
const defs = {}; const re = /export\s+var\s+([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)/g; let mm;
while ((mm = re.exec(src))) defs[mm[1]] = parseFloat(mm[2]);
function applyPalette(fn, h, s, v) { const id = idOf(fn); if (id == null) return; rt.setControl(id, h, s, v); }
if (idOf('colorPalette1') != null) applyPalette('colorPalette1', defs.cp1H ?? 0, defs.cp1S ?? 1, defs.cp1V ?? 1);
if (idOf('colorPalette2') != null) applyPalette('colorPalette2', defs.cp2H ?? 0, defs.cp2S ?? 1, defs.cp2V ?? 1);
for (const e of exps) { if (e.name.startsWith('slider')) { const varName = e.name.slice(6, 7).toLowerCase() + e.name.slice(7);
  if (defs[varName] != null) rt.setControl(e.id, defs[varName]); } }

for (const m of mods) if (idOf(m.target) == null) console.log('WARN: --mod target export not found: ' + m.target);
if (A.set) for (const kv of A.set.split(',')) { const [k, v] = kv.split('='); const id = idOf(k);
  if (id == null) { console.log('WARN: no export ' + k); continue; } rt.setControl(id, parseFloat(v)); }

// ── real analyzer fed by the synth ───────────────────────────────────────────
let clock = 0; const sig = { low: 0, mid: 0, high: 0, kick: 0, flux: 0 };
const analyzer = new AudioAnalyzer({ sampleRate: SR, fftSize: FFT, hopSize: HOP,
  bands: { lowMaxHz: 200, midMaxHz: 4000, attackMs: 6, releaseMs: 180, noiseGate: 0.04, inputGain: 1.0, sourceSmoothHz: 12000 },
  kick: { minHz: 50, maxHz: 110, threshold: 2.4, refractoryMs: 220, decayMs: 70 },
  nowFn: () => clock,
  onAnalysis: (a) => { sig.low = a.low; sig.mid = a.mid; sig.high = a.high; sig.kick = a.kick; sig.flux = a.flux; } });
const bpm = A.bpm ? { bpm: parseFloat(A.bpm) } : {};
const samplesPerFrame = Math.round(SR * DT);
const sbuf = new Int16Array(HOP); let cursor = 0;
function advanceAudio() { // push ~one render-frame of audio through the analyzer
  let remaining = samplesPerFrame;
  while (remaining > 0) { const n = Math.min(HOP, remaining);
    fillFrame(sbuf.subarray(0, n), synth, cursor, SR, bpm); cursor += n; clock += (n / SR) * 1000;
    analyzer.pushSamples(sbuf.subarray(0, n)); remaining -= n; }
}

// ── 6ch → display rgb (engine RGB fallback for W/A/U) ─────────────────────────
const fold = b6 => { const o = []; for (let i = 0; i < N; i++) { const k = i * 6;
  const R = b6[k], G = b6[k + 1], B = b6[k + 2], W = b6[k + 3], Am = b6[k + 4], U = b6[k + 5];
  o.push([Math.min(255, Math.round(R + W + Am * 0.8 + U * 0.1)), Math.min(255, Math.round(G + W + Am * 0.4)), Math.min(255, Math.round(B + W + U * 0.5))]); }
  return o; };

// ── plan the clip: internal steps, emit cadence, stored-frame count ────────────
// Two modes:
//   --frames N  (legacy)  : N internal steps, emit every step → N stored frames,
//                           stamped fps = legacy 40 (DT cadence).
//   --seconds S           : real-time S-second clip at outFps. Emit one stored
//                           frame every `emitEvery = round((1/F)/DT)` internal
//                           steps, for `round(S*F)` stored frames spanning S real
//                           seconds of pattern+audio time.
// BIG-RIG SAFETY: cap emitted color cells (storedFrames × emittedPixels) at
// maxCells. First lower outFps (seconds mode only), then stride pixels for the
// clip. Always PRINT what was done — never a silent misleading truncation.
let emitEvery, storedFrames, internalSteps, stampFps;
if (useSeconds) {
  emitEvery = Math.max(1, Math.round((1 / outFps) / DT));
  storedFrames = Math.max(1, Math.round(seconds * outFps));
  internalSteps = storedFrames * emitEvery;          // run the audio/VM in real time
  stampFps = outFps;
} else {
  emitEvery = 1;
  storedFrames = framesArg;
  internalSteps = framesArg;
  stampFps = Math.round(1 / DT);                       // legacy clips play at 40 fps DT cadence
}

// Big-rig cell-cap: storedFrames × N must stay ≲ maxCells.
let pixelStride = 1; let downsampleNote = '';
if (storedFrames * N > maxCells) {
  if (useSeconds) {
    // 1) try lowering outFps (and thus storedFrames) down to a floor of 8 fps.
    const minFps = 8;
    while (outFps > minFps && storedFrames * N > maxCells) {
      outFps = Math.max(minFps, Math.floor(outFps) - 1);
      emitEvery = Math.max(1, Math.round((1 / outFps) / DT));
      storedFrames = Math.max(1, Math.round(seconds * outFps));
      internalSteps = storedFrames * emitEvery;
      stampFps = outFps;
    }
  }
  // 2) if still over, stride pixels for the clip (keep every Kth pixel).
  if (storedFrames * N > maxCells) {
    pixelStride = Math.ceil((storedFrames * N) / maxCells);
  }
  const emittedPx = Math.ceil(N / pixelStride);
  downsampleNote = `DOWNSAMPLED: ${storedFrames}f×${N}px=${storedFrames * N} cells > cap ${maxCells}; `
    + `using out-fps=${outFps}` + (pixelStride > 1 ? `, pixelStride=${pixelStride} (→ ${emittedPx} px/frame)` : ' (no pixel striding)')
    + ` → ${storedFrames}f×${emittedPx}px=${storedFrames * emittedPx} cells.`;
  console.log(downsampleNote);
}

// Indices of the pixels we actually store (strided if downsampling).
const keepIdx = []; for (let i = 0; i < N; i++) if (i % pixelStride === 0) keepIdx.push(i);

const meta = keepIdx.map(i => { const p = px[i]; return { i: p.i, fId: p.fId || 0, sId: p.sId || 0, nx: p.nx, ny: p.ny, nz: p.nz }; });
const frameData = []; const totals = []; const sigLog = []; const everLit = new Array(N).fill(false);
let internalT = 0;
for (let step = 0; step < internalSteps; step++) {
  advanceAudio();
  // Apply each modulation as the engine's OVERRIDE: slider = lerp(min, max,
  // curve(signal)). Bare tokens default to min=0,max=1,linear => identity (the
  // legacy slider := signal behaviour).
  for (const m of mods) { const id = idOf(m.target); if (id != null) {
    const s = sig[SIG_FIELD[m.sig]];
    // clamp01 to match the deployed engine's OVERRIDE (lib/modulation_engine.js),
    // so an inverted (min>max) or over-range mapping renders the SAME offline as
    // on the rig — never a quietly different result.
    const v01 = m.min + (m.max - m.min) * m.curve(s);
    rt.setControl(id, v01 < 0 ? 0 : (v01 > 1 ? 1 : v01));
  } }
  rt.beginFrame(internalT * DT);
  const rgb = fold(rt.renderAll6ch());
  internalT++;
  // brightness/lit accounting runs over the full pixel set every internal step.
  let tot = 0; for (let i = 0; i < N; i++) { const s = rgb[i][0] + rgb[i][1] + rgb[i][2]; tot += s; if (s > 8) everLit[i] = true; }
  if (step % emitEvery === 0 && frameData.length < storedFrames) {
    frameData.push(keepIdx.map(i => rgb[i]));          // store only the kept (strided) pixels
    totals.push(tot); sigLog.push({ ...sig });
  }
}
const frames = frameData.length;

// Raw physical axis spreads (from the un-normalized model coords if present) so
// the clip generator's `--view auto` can pick the two physically-widest axes for
// the top-down/front projection — nx/ny/nz are normalized per-axis and lose the
// real-world aspect, so we carry the raw ranges here.
function rawSpread(ax) { const v = px.map(p => p[ax]).filter(x => typeof x === 'number'); return v.length ? (Math.max(...v) - Math.min(...v)) : 0; }
const coordSpread = (typeof px[0].x === 'number') ? { x: rawSpread('x'), y: rawSpread('y'), z: rawSpread('z') } : null;

fs.writeFileSync(out, JSON.stringify({
  pattern: path.basename(patternPath, '.js'), buffer: 'harness', model: modelName,
  fps: stampFps, seconds: useSeconds ? seconds : +(storedFrames / stampFps).toFixed(3),
  coordSpread, pixelStride, meta, frames: frameData,
}));

// ── assertions ───────────────────────────────────────────────────────────────
const litCount = everLit.filter(Boolean).length;
let maxChan = 0; for (const fr of frameData) for (const c of fr) { if (c[0] > maxChan) maxChan = c[0]; if (c[1] > maxChan) maxChan = c[1]; if (c[2] > maxChan) maxChan = c[2]; }
const minT = Math.min(...totals), maxT = Math.max(...totals), avgT = totals.reduce((a, b) => a + b, 0) / totals.length;
const bySec = {}; px.forEach((p, i) => { if (everLit[i]) bySec[p.sId] = (bySec[p.sId] || 0) + 1; });
console.log(`SYNTH=${synth} FRAMES=${frames}@${stampFps}fps${useSeconds ? ` (${seconds}s real-time, emitEvery=${emitEvery} internal steps)` : ''} MODEL=${modelName} PIX=${N}${pixelStride > 1 ? ` (stored ${keepIdx.length}/${N}, stride ${pixelStride})` : ''} LIT=${litCount}/${N} maxChan=${maxChan}`);
console.log(`TOTAL_BRI min/avg/max=${Math.round(minT)}/${Math.round(avgT)}/${Math.round(maxT)} (${maxT - minT > avgT * 0.15 ? 'ANIMATING' : 'LOW-VARIATION'})`);
// Model-agnostic per-section lit counts (test_bench labels its 1/2/3 as
// pars/vintage/bars; any other section id reports as "s<id>").
const TEST_BENCH_SECTION_NAMES = { 1: 'pars', 2: 'vintage', 3: 'bars' };
const secReport = Object.keys(bySec).sort((a, b) => a - b)
  .map(sId => `${(modelName === 'test_bench' && TEST_BENCH_SECTION_NAMES[sId]) || ('s' + sId)}=${bySec[sId]}`)
  .join(' ');
console.log(`LIT_BY_SECTION ${secReport}`);
// ── QUALITY: two-color use (hue spread), contrast (dark/bright split), peak ────
function rgb2hue(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 1) return -1; let h; if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h /= 6; if (h < 0) h += 1; return h; }
let sumS = 0, sumC = 0, hueCnt = 0, darkPF = 0, brightPF = 0, totPF = 0;
for (const fr of frameData) for (const c of fr) { totPF++; const sum = c[0] + c[1] + c[2];
  if (sum < 24) darkPF++; if (Math.max(c[0], c[1], c[2]) > 128) brightPF++;
  const h = rgb2hue(c[0], c[1], c[2]); if (h >= 0 && sum > 24) { sumS += Math.sin(h * 2 * Math.PI); sumC += Math.cos(h * 2 * Math.PI); hueCnt++; } }
const Rlen = hueCnt ? Math.hypot(sumS, sumC) / hueCnt : 1; const hueSpread = 1 - Rlen;
const meanHue = hueCnt ? ((Math.atan2(sumS, sumC) / (2 * Math.PI)) + 1) % 1 : -1;
console.log(`QUALITY hueSpread=${hueSpread.toFixed(2)} (2-color if >0.06) meanHue=${meanHue.toFixed(2)} darkFrac=${(darkPF / totPF).toFixed(2)} brightFrac=${(brightPF / totPF).toFixed(2)} peakMaxChan=${maxChan} ${maxChan >= 200 ? '' : '(DIM: lift peak toward 255)'}`);
// correlation of each modulated signal with total brightness
function corr(xs, ys) { const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let nu = 0, dx = 0, dy = 0; for (let i = 0; i < xs.length; i++) { nu += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return nu / (Math.sqrt(dx * dy) || 1); }
for (const m of mods) { const xs = sigLog.map(s => s[SIG_FIELD[m.sig]]);
  const c = corr(xs, totals);
  console.log(`AUDIO_REACT ${m.sig}->${m.target}: corr(signal,brightness)=${c.toFixed(2)} signalRange=${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)} ${Math.abs(c) > 0.35 ? '(REACTIVE)' : '(weak/indirect)'}`); }
console.log('OUT=' + out);
rt.destroy();
