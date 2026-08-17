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
 *   --time-scale pattern-clock multiplier (default 1). Audio and clip duration
 *             remain real time; only the VM clock is scaled, matching the
 *             live global-speed control for exact playlist review.
 *   --max-cells  big-rig safety cap on emitted color cells (frames×pixels,
 *             default 150000). When a clip would exceed it, out-fps is lowered
 *             and/or pixels are strided for the clip — PRINTED loudly, never a
 *             silent truncation. test_bench (52 px) keeps full fidelity.
 *   --bpm     override synth bpm
 *   --model   rig model in models/<name>.js (default test_bench), loaded
 *             through the ENGINE's own `loadModelForGauge()` so the group
 *             bits, the `<model>.viewmasks.js` sidecar presets and the
 *             two-word viewMask/viewMaskHi packing are byte-identical to the
 *             live runtime. FAILS LOUDLY if the file is missing, the model
 *             does not resolve, or its pixels[] lack the required fields —
 *             never silently falls back to test_bench (codex P0).
 *
 *   ── TARGETING PARITY (report _140) ──────────────────────────────────────
 *   The pattern is compiled through `lib/wasm_host.js` `WasmHost.compile()`,
 *   the SAME entry point the engine uses, so all THREE source-injection
 *   passes run here in the same order: `inView("Authored Name")` folding →
 *   `MASK_*` constants → `FIX_*` constants. An `inView()`/`MASK_*`-targeted
 *   pattern therefore compiles and renders offline exactly as it does on the
 *   rig, and an unknown view name is a LOUD COMPILE_FAIL naming the view
 *   (never a silent constant-false test).
 *
 *   The view CATALOG the fold resolves against is assembled by the shared
 *   `lib/view_catalog.js` primitives engine.js itself calls (report _147), so
 *   the Tier-A auto-views are present here too: `inView("LEFT")`,
 *   `inView("Strands")`, `inView("CTRL_7")` resolve offline exactly as on the
 *   rig (titanic: 58 names, not the 31 a hand-built table used to hold).
 *
 *   ── GATE (redteam _112 F7/I4) — makes the verdict TRUSTWORTHY ──
 *   --gate    Enforce the pass/fail bars: exit 3 (non-zero) with a NAMED reason
 *             when the pattern FAILS. The GATE_PASS/GATE_FAIL verdict always
 *             PRINTS; --gate only changes the EXIT CODE, so existing clip/gif
 *             tooling that spawns this harness is unaffected. USE --gate in the
 *             `_90` ChatGPT loop. Bars:
 *               DARK        — > --max-dark-frac of the gate window renders
 *                             essentially black (peak channel < 8). A 100%-black
 *                             pattern fails (violates R4 "never fully black").
 *               BLACK_LATCH — lit early then latches black later (a "sleeper"
 *                             that behaves for the audited window). Caught by
 *                             rendering >= --gate-frames past the clip.
 *               OVER_BUDGET — MEAN VM render time > (--budget-ms / --mix-channels)
 *                             per-channel budget. Shipped patterns stay green.
 *             GATE_WARN DIM (peak < 200) is advisory, never a failure.
 *   --gate-frames    min frames rendered for the latch check (default 600 = 15 s)
 *   --budget-ms      whole-mix frame budget (default 25 = 40 fps)
 *   --mix-channels   channels sharing the budget (default 4) → per-channel bar
 *   --max-dark-frac  black-frame fraction that fails DARK (default 0.5)
 */
import { AudioAnalyzer } from '../audio/analyzer/audio_analyzer.js';
import { fillFrame, SYNTHS } from '../audio/synth/test_synths.js';
import { WasmHost } from '../lib/wasm_host.js';
import { buildMetaArray, loadModelForGauge } from '../lib/model_loader.js';
import { buildViewCatalog } from '../lib/view_catalog.js';
import { buildMaskConstants } from '../lib/view_mask_constants.js';
import { createBitFreeViewPromoter } from '../lib/in_view_intrinsic.js';
import { micSignalShortNames } from '../audio/postproc/audio_signals.js';
import { fileURLToPath } from 'url';
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
const SR = 44100, FFT = 2048, HOP = 512, DT = 0.025;  // FFT matches config.yaml audio.fftSize

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
const timeScale = (A['time-scale'] !== undefined && A['time-scale'] !== 'true')
  ? parseFloat(A['time-scale']) : 1;
if (!(timeScale > 0) || !isFinite(timeScale)) {
  console.log('TIMESCALE_FAIL: --time-scale must be > 0, got ' + A['time-scale']);
  process.exit(2);
}
const maxCells = (A['max-cells'] !== undefined && A['max-cells'] !== 'true') ? parseInt(A['max-cells'], 10) : 150000;
if (!(maxCells > 0)) { console.log('MAXCELLS_FAIL: --max-cells must be > 0, got ' + A['max-cells']); process.exit(2); }
// signal key -> the analyzer/synth field it reads. DERIVED from the
// authoritative registry (audio/postproc/audio_signals.js) instead of
// hand-listed, so this harness, audio_mod_spec.mjs's VALID_SIGNALS and the
// Companion's curated outputs can never disagree about the family (the
// disagreement that hid the missing FLUX publisher — report 20260806_184).
const SIG_FIELD = micSignalShortNames();

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
// Load models/<modelName>.js through the ENGINE's loader (lib/model_loader.js),
// not a bare `import` of the model file: the raw module carries UNRESOLVED
// pixels (vMask = 0, no sidecar presets), so a view-targeted pattern would
// render against an empty view world here and a populated one on the rig.
// loadModelForGauge reproduces engine.js's group-bit assignment, the
// <model>.viewmasks.js sidecar merge and the two-word viewMask/viewMaskHi
// packing. FAIL LOUDLY if the file is missing, the model does not resolve, or
// its pixels[] lack the fields meta/coords need — never silently use test_bench.
const modelPath = path.join(ENGINE_DIR, 'models', modelName + '.js');
if (!fs.existsSync(modelPath)) { console.log('MODEL_FAIL: no model file ' + modelPath); process.exit(2); }
let loaded;
try {
  loaded = await loadModelForGauge(modelName);
} catch (err) { console.log('MODEL_FAIL: ' + modelName + ' failed to load: ' + err.message); process.exit(2); }
if (!Array.isArray(loaded.pixels) || loaded.pixels.length === 0) {
  console.log('MODEL_FAIL: ' + modelName + '.js exports no non-empty pixels[]'); process.exit(2); }
const REQUIRED_PIXEL_FIELDS = ['i', 'fId', 'sId', 'nx', 'ny', 'nz'];
for (const f of REQUIRED_PIXEL_FIELDS) {
  if (loaded.pixels[0][f] === undefined) {
    console.log('MODEL_FAIL: ' + modelName + '.js pixels[] missing required field "' + f + '"'); process.exit(2); } }
const px = loaded.pixels; const N = px.length;
// The clip/gate loops index px[0..N); the host packs coords+meta for
// `pixelCount`. A model whose declared pixelCount disagrees with its pixels[]
// length would render a different pixel set here than on the rig — loud, not
// silently reconciled.
if (loaded.pixelCount !== N) {
  console.log('MODEL_FAIL: ' + modelName + ' declares pixelCount ' + loaded.pixelCount
    + ' but exports ' + N + ' pixels'); process.exit(2); }

// AUTHORED-name -> { bit, word } table for the `inView("Name")` intrinsic.
// Built by the SHARED lib/view_catalog.js primitives engine.js itself calls,
// so the offline table is byte-equivalent to the rig's: the Tier-A auto-views
// (LEFT / RIGHT / FRONT / BACK / Strands / TE Signs / @BAR / CTRL_n …)
// are appended to loaded.viewMasks first, then base groups land at word 0 and
// every resolved preset/auto-view at its authored word. loadModelForGauge()
// alone does NOT derive the auto-views, so hand-building the table here held
// 31 of titanic's 58 names and made a documented view a COMPILE_FAIL offline
// while it compiled on the rig (reports 20260804_146 §4, 20260804_147).
const { viewTable, autoViews } = buildViewCatalog(loaded);
// Auto-view warnings (non-exhaustive halves, a controller straddling the
// centreline, a structural view retired as a duplicate of an authored one)
// are the engine's own; surface them on stderr with the engine's wording
// rather than dropping them — stdout stays byte-stable for callers.
for (const w of autoViews.warnings) console.warn('[Model] auto-view: ' + w);

// Drive the REAL host (lib/wasm_host.js), the same class the engine compiles
// through, so `WasmHost.compile()` applies all three source-injection passes
// in the engine's order: inView() folding -> MASK_* -> FIX_*.
const host = new WasmHost();
await host.init(N);
host.setCoords(px.map(p => ({ nx: p.nx, ny: p.ny, nz: p.nz })));
host.setPixelMeta(loaded.metaArray);
host.setMaskConstants(buildMaskConstants({ groupBits: loaded.groupBits, viewMasks: loaded.viewMasks }));
host.setFixtureConstants(loaded.fixtureConstants);
host.setViewTable(viewTable);
// Bit-free (Tier-A) views carry no in-VM bit; `inView()` promotes one on
// demand and sets it on the member pixels. Without this the promoter is
// absent and such a view is a loud compile error rather than a silent
// constant test — the engine wires the same promoter (codex P0).
// `groupBits` is passed for the same reason engine.js passes its whole model:
// the promoter seeds its allocator with every bit already claimed, and a
// promotion that skipped the base group bits could hand a bit-free view a bit
// a group already owns.
host.setBitFreeViewPromoter(createBitFreeViewPromoter(
  { pixels: px, viewMasks: loaded.viewMasks, groupBits: loaded.groupBits }, host));

// Named, loud missing-pattern failure. (Before the WasmHost switch this was an
// accidental byproduct of the injector try/catch; a raw ENOENT stack trace is
// not a diagnosis.)
if (!fs.existsSync(patternPath)) { console.log('PATTERN_FAIL: no pattern file ' + patternPath); process.exit(2); }
const r = host.compile(fs.readFileSync(patternPath, 'utf8'));
if (!r.ok) { console.log('COMPILE_FAIL: ' + r.error); process.exit(2); }
const handle = r.handle;
// A compile that promoted a bit-free view mutated px in place, so the meta
// array packed above is stale — re-pack before the first render (mirrors
// engine.js repackMetaIfDirty).
if (host.metaDirty) { host.setPixelMeta(buildMetaArray(px)); host.metaDirty = false; }
console.log('COMPILE_OK');
const exps = host.getExports(handle);
const idOf = name => { const e = exps.find(e => e.name === name); return e ? e.id : null; };

// Apply the pattern's DECLARED export-var defaults (the standalone VM inits all
// control slots to 0 — the engine applies these on load, so we must too or the
// palette reads black/red and sliders sit at 0). Parse `export var X = NUM`,
// then: hsvPicker (colorPalette1/2) gets cp{1,2}{H,S,V}; each sliderFoo gets the
// default of its `foo` var (identity-slider convention). --set and --mod override.
const src = fs.readFileSync(patternPath, 'utf8');
const defs = {}; const re = /export\s+var\s+([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)/g; let mm;
while ((mm = re.exec(src))) defs[mm[1]] = parseFloat(mm[2]);
function applyPalette(fn, h, s, v) { const id = idOf(fn); if (id == null) return; host.setControl(handle, id, h, s, v); }
if (idOf('colorPalette1') != null) applyPalette('colorPalette1', defs.cp1H ?? 0, defs.cp1S ?? 1, defs.cp1V ?? 1);
if (idOf('colorPalette2') != null) applyPalette('colorPalette2', defs.cp2H ?? 0, defs.cp2S ?? 1, defs.cp2V ?? 1);
for (const e of exps) { if (e.name.startsWith('slider')) { const varName = e.name.slice(6, 7).toLowerCase() + e.name.slice(7);
  if (defs[varName] != null) host.setControl(handle, e.id, defs[varName]); } }

for (const m of mods) if (idOf(m.target) == null) {
  console.log('CONTROL_FAIL: --mod target export not found: ' + m.target); process.exit(2);
}
if (A.set) for (const kv of A.set.split(',')) { const [k, raw] = kv.split('='); const id = idOf(k);
  const v = Number(raw);
  if (id == null) { console.log('CONTROL_FAIL: --set export not found: ' + k); process.exit(2); }
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    console.log('CONTROL_FAIL: --set ' + k + ' must be a finite value in [0, 1]'); process.exit(2);
  }
  host.setControl(handle, id, v); }

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

const meta = keepIdx.map(i => {
  const p = px[i];
  return {
    i: p.i,
    fId: p.fId || 0,
    sId: p.sId || 0,
    nx: p.nx,
    ny: p.ny,
    nz: p.nz,
    fixtureType: p.fixtureType,
    name: p.name,
    group: p.group,
    localIndex: p.localIndex,
  };
});

// ── I4 GATE accounting (redteam _112 F7) ──────────────────────────────────────
// The harness used to ALWAYS exit 0 with no failing bar: a 100%-black pattern
// passed, and a "sleeper" that renders perfectly for the audited window then
// latches black afterwards cleared every documented bar (evil_black.js /
// evil_sleeper.js). That made the operator's only gate on ChatGPT-authored
// patterns untrustworthy. We now:
//   • time ONLY the VM work (beginFrame + renderAll6ch) per frame — the same
//     "pattern render only" quantity the perf audit measured;
//   • render a GUARANTEED-LONG window (>= --gate-frames) so a post-window
//     black-latch is caught even when --frames is short;
//   • track a per-frame "essentially black" flag (peak channel < DARK_CHAN);
//   • print a GATE_PASS / GATE_FAIL verdict with a NAMED reason, and under
//     --gate set a non-zero exit code so automation can trust it.
// Shipped patterns (mean 0.75 ms / worst 5.67 ms on titanic, always lit) stay
// green: darkFrac ~0, no latch, mean well under the per-channel budget.
const gate = A.gate !== undefined && A.gate !== 'false';   // --gate → non-zero exit on FAIL
const budgetMs = (A['budget-ms'] !== undefined && A['budget-ms'] !== 'true') ? parseFloat(A['budget-ms']) : 25;
const mixChannels = (A['mix-channels'] !== undefined && A['mix-channels'] !== 'true') ? parseInt(A['mix-channels'], 10) : 4;
const maxDarkFrac = (A['max-dark-frac'] !== undefined && A['max-dark-frac'] !== 'true') ? parseFloat(A['max-dark-frac']) : 0.5;
if (!(budgetMs > 0) || !(mixChannels > 0) || !(maxDarkFrac >= 0 && maxDarkFrac <= 1)) {
  console.log('GATEARG_FAIL: --budget-ms>0, --mix-channels>0, --max-dark-frac in [0,1]'); process.exit(2); }
// Render at least this many frames so a sleeper latching after the audited
// window is caught. evil_sleeper latches at frame 200; 600 (15 s @ 40 fps) is
// comfortably past any plausible audit window a pattern could sleep through.
const gateFramesTarget = Math.max(internalSteps, (A['gate-frames'] !== undefined && A['gate-frames'] !== 'true') ? parseInt(A['gate-frames'], 10) : 600);
const DARK_CHAN = 8;              // a frame whose peak channel is below this is "essentially black"
const frameDark = [];            // per-gate-frame black flag (main window + tail)
let gatePeak = 0, sumFrameMs = 0, worstFrameMs = 0, timedFrames = 0;

// Apply this step's --mod OVERRIDEs (shared by the main + tail render loops).
function applyStepMods() {
  for (const m of mods) { const id = idOf(m.target); if (id != null) {
    const s = sig[SIG_FIELD[m.sig]];
    // clamp01 to match the deployed engine's OVERRIDE (lib/modulation_engine.js),
    // so an inverted (min>max) or over-range mapping renders the SAME offline as
    // on the rig — never a quietly different result.
    const v01 = m.min + (m.max - m.min) * m.curve(s);
    host.setControl(handle, id, v01 < 0 ? 0 : (v01 > 1 ? 1 : v01));
  } }
}
// Render one frame, TIMING only the VM work; fold to rgb; roll gate accounting
// (peak, per-frame black flag, frame time excluding a 2-frame warmup).
function renderGateFrame() {
  const t0 = process.hrtime.bigint();
  host.beginFrame(handle, internalT * DT * timeScale);
  const raw6 = host.renderAll6ch(handle);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const rgb = fold(raw6);
  internalT++;
  let frameMax = 0;
  for (let i = 0; i < N; i++) { const c = rgb[i]; if (c[0] > frameMax) frameMax = c[0]; if (c[1] > frameMax) frameMax = c[1]; if (c[2] > frameMax) frameMax = c[2]; }
  if (frameMax > gatePeak) gatePeak = frameMax;
  frameDark.push(frameMax < DARK_CHAN);
  if (frameDark.length > 2) { sumFrameMs += ms; if (ms > worstFrameMs) worstFrameMs = ms; timedFrames++; }
  return rgb;
}

const frameData = []; const totals = []; const sigLog = []; const everLit = new Array(N).fill(false);
let internalT = 0;
for (let step = 0; step < internalSteps; step++) {
  advanceAudio();
  applyStepMods();
  const rgb = renderGateFrame();
  // brightness/lit accounting runs over the full pixel set every internal step.
  let tot = 0; for (let i = 0; i < N; i++) { const s = rgb[i][0] + rgb[i][1] + rgb[i][2]; tot += s; if (s > 8) everLit[i] = true; }
  if (step % emitEvery === 0 && frameData.length < storedFrames) {
    frameData.push(keepIdx.map(i => rgb[i]));          // store only the kept (strided) pixels
    totals.push(tot); sigLog.push({ ...sig });
  }
}
// Extended latch window — keep stepping (audio + VM clock continue) past the
// captured clip so a pattern that latches black AFTER the audited window is
// caught. No clip storage, just gate accounting.
for (let step = internalSteps; step < gateFramesTarget; step++) {
  advanceAudio();
  applyStepMods();
  const rgb = renderGateFrame();
  for (let i = 0; i < N; i++) { const s = rgb[i][0] + rgb[i][1] + rgb[i][2]; if (s > 8) everLit[i] = true; }
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
  timeScale,
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

// ── I4 GATE verdict (redteam _112 F7) ─────────────────────────────────────────
// Evaluate the failing bars over the full gate window (main clip + tail):
//   BLACK_LATCH — lit early, latches black later (the sleeper);
//   DARK        — mostly/fully black across the window (evil_black);
//   OVER_BUDGET — mean VM render time over the per-channel frame budget.
// GATE_WARN DIM is advisory (peak < 200). Under --gate a FAIL sets exit 3 so
// automation (and the operator's `_90` loop) can trust the verdict; without
// --gate the verdict still PRINTS but the exit code is unchanged, so existing
// clip/gif tooling that spawns the harness is not broken.
const gateFrames = frameDark.length;
const darkCount = frameDark.reduce((a, b) => a + (b ? 1 : 0), 0);
const gateDarkFrac = gateFrames ? darkCount / gateFrames : 1;
const third = Math.max(1, Math.floor(gateFrames / 3));
const headDark = frameDark.slice(0, third).reduce((a, b) => a + (b ? 1 : 0), 0) / third;
const tailDark = frameDark.slice(gateFrames - third).reduce((a, b) => a + (b ? 1 : 0), 0) / third;
const meanFrameMs = timedFrames ? sumFrameMs / timedFrames : 0;
const perChannelBudget = budgetMs / mixChannels;
console.log(`GATE window=${gateFrames}f darkFrac=${gateDarkFrac.toFixed(2)} headDark=${headDark.toFixed(2)} tailDark=${tailDark.toFixed(2)} peak=${gatePeak} meanMs=${meanFrameMs.toFixed(2)} worstMs=${worstFrameMs.toFixed(2)} budget/ch=${perChannelBudget.toFixed(2)}ms`);
const gateReasons = [];
if (headDark < 0.2 && tailDark > 0.8) {
  gateReasons.push(`BLACK_LATCH: lit early (head ${(headDark * 100) | 0}% dark) then latches black (tail ${(tailDark * 100) | 0}% dark) over ${gateFrames} frames`);
} else if (gateDarkFrac > maxDarkFrac) {
  gateReasons.push(`DARK: ${(gateDarkFrac * 100) | 0}% of ${gateFrames} frames render essentially black (peak channel < ${DARK_CHAN}) — violates R4 "never fully black"`);
}
if (meanFrameMs > perChannelBudget) {
  gateReasons.push(`OVER_BUDGET: mean ${meanFrameMs.toFixed(2)} ms/frame > ${perChannelBudget.toFixed(2)} ms per-channel budget (${budgetMs} ms / ${mixChannels} mixer channels); worst ${worstFrameMs.toFixed(2)} ms`);
}
if (gatePeak < 200) console.log(`GATE_WARN DIM: peak ${gatePeak} < 200 (lift toward 255)`);
if (gateReasons.length) {
  console.log('GATE_FAIL ' + gateReasons.join(' | '));
  if (gate) process.exitCode = 3;   // named non-zero only under --gate
} else {
  console.log('GATE_PASS');
}

console.log('OUT=' + out);
host.destroy(handle);
host.shutdown();
