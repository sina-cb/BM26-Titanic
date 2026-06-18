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
 *   --mod     comma list of <signal>:<sliderExport>; signal ∈
 *             micLow|micMid|micHigh|micKick|micFlux
 *   --set     static control presets (export=value)
 *   --frames  render frames at 40 fps (default 80 ≈ 2 s)
 *   --bpm     override synth bpm
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
const frames = parseInt(A.frames || '80', 10);
const out = A.out || (process.env.HOME + '/tmp/genkit/out/vis.json');
const SR = 44100, FFT = 1024, HOP = 512, DT = 0.025;
const SIG_FIELD = { micLow: 'low', micMid: 'mid', micHigh: 'high', micKick: 'kick', micFlux: 'flux' };

const mods = [];
if (A.mod) for (const m of A.mod.split(',')) { const [sig, target] = m.split(':');
  if (!SIG_FIELD[sig]) { console.log('MOD_FAIL: unknown signal ' + sig); process.exit(2); }
  mods.push({ sig, target }); }

// ── model + VM ───────────────────────────────────────────────────────────────
const model = await import(pathToFileURL(path.join(ENGINE_DIR, 'models', 'test_bench.js')).href);
const px = model.pixels; const N = px.length;
const rt = await createWasmRuntime(N);
rt.setCoords(px.map(p => ({ nx: p.nx, ny: p.ny, nz: p.nz })));
rt.setPixelMeta(px.map(p => ({ controllerId: p.cId || 0, sectionId: p.sId || 0, fixtureId: p.fId || 0, viewMask: p.vMask || 0 })));
const r = rt.compile(fs.readFileSync(patternPath, 'utf8'));
if (!r.ok) { console.log('COMPILE_FAIL: ' + r.error); process.exit(2); }
console.log('COMPILE_OK');
const exps = rt.getExports();
const idOf = name => { const e = exps.find(e => e.name === name); return e ? e.id : null; };
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

const meta = px.map(p => ({ i: p.i, fId: p.fId || 0, sId: p.sId || 0, nx: p.nx, ny: p.ny, nz: p.nz }));
const frameData = []; const totals = []; const sigLog = []; const everLit = new Array(N).fill(false);
for (let f = 0; f < frames; f++) {
  advanceAudio();
  for (const m of mods) { const id = idOf(m.target); if (id != null) rt.setControl(id, sig[SIG_FIELD[m.sig]]); }
  rt.beginFrame(f * DT);
  const rgb = fold(rt.renderAll6ch());
  let tot = 0; for (let i = 0; i < N; i++) { const s = rgb[i][0] + rgb[i][1] + rgb[i][2]; tot += s; if (s > 8) everLit[i] = true; }
  frameData.push(rgb); totals.push(tot); sigLog.push({ ...sig });
}
fs.writeFileSync(out, JSON.stringify({ pattern: path.basename(patternPath, '.js'), buffer: 'harness', model: 'test_bench', meta, frames: frameData }));

// ── assertions ───────────────────────────────────────────────────────────────
const litCount = everLit.filter(Boolean).length;
const maxChan = Math.max(...frameData.flat().map(c => Math.max(...c)));
const minT = Math.min(...totals), maxT = Math.max(...totals), avgT = totals.reduce((a, b) => a + b, 0) / totals.length;
const bySec = {}; px.forEach((p, i) => { if (everLit[i]) bySec[p.sId] = (bySec[p.sId] || 0) + 1; });
console.log(`SYNTH=${synth} FRAMES=${frames} PIX=${N} LIT=${litCount}/${N} maxChan=${maxChan}`);
console.log(`TOTAL_BRI min/avg/max=${Math.round(minT)}/${Math.round(avgT)}/${Math.round(maxT)} (${maxT - minT > avgT * 0.15 ? 'ANIMATING' : 'LOW-VARIATION'})`);
console.log(`LIT_BY_SECTION pars=${bySec[1] || 0} vintage=${bySec[2] || 0} bars=${bySec[3] || 0}`);
// correlation of each modulated signal with total brightness
function corr(xs, ys) { const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let nu = 0, dx = 0, dy = 0; for (let i = 0; i < xs.length; i++) { nu += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return nu / (Math.sqrt(dx * dy) || 1); }
for (const m of mods) { const xs = sigLog.map(s => s[SIG_FIELD[m.sig]]);
  const c = corr(xs, totals);
  console.log(`AUDIO_REACT ${m.sig}->${m.target}: corr(signal,brightness)=${c.toFixed(2)} signalRange=${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)} ${Math.abs(c) > 0.35 ? '(REACTIVE)' : '(weak/indirect)'}`); }
console.log('OUT=' + out);
rt.destroy();
