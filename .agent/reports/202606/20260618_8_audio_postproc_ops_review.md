# 2026-06-18 — Audio post-processing op-chain code review (signal-designer)

Cold-start deep review of the AUDIO POST-PROCESSING OP CHAIN on branch
`claude/audio-corpus-tuning-olcd6i` (main worktree `C:/Users/sina_/workspace/
BM26-Titanic`, HEAD `2c3f052`). Review-only — no source edits, no git mutation.
Scope: the op-chain engine + ops, signal definitions, and the signal-designer
wiring (companion server / bpm emit / engine config link / companion config).
OUT of scope (another agent): raw FFT/analysis.

## VERDICT: MERGE-READY (post-proc): WITH-FIXES

The op-chain DSP is sound for the shipped default chains and the realistic
operator-authored chains. All 233 tests pass. Two real defects exist (one DSP
correctness, one wiring/contract), neither in the default path, both
operator-reachable through the designer UI. They are fix-before-relying-on,
not merge-blocking for the curated defaults.

## Files reviewed
- `marsin_engine/audio/postproc/signal_post_processor.js` (op-chain engine + all ops)
- `marsin_engine/audio/postproc/audio_signals.js` (signal family / live-key set)
- `marsin_engine/audio/companion/companion_server.js` (sources→ops→osc_out, manifest, OSC emit)
- `marsin_engine/audio/companion/companion_config.js` (osc_out name→cpcKey→address, validateSignal, FREQUENCY_OPS)
- `marsin_engine/audio/companion/bpm_emit.js`
- `marsin_engine/audio/companion/engine_config_link.js`

## Checks performed
- `node --check` on all 6 files — clean.
- `node --test` on all 10 requested suites — **233 pass / 0 fail** (~0.99s).
- Hand-traced each op's math vs its cited source and re-derived the
  frame-rate-independence of every time-domain op (lpf/envelope/schmitt/hold/
  slew/compressor/biquad/danceMaker/normalizer/slope).
- Numerically reproduced the danceMaker high-omega instability (script below).
- Traced osc_out name→slug→cpcKey→address derivation, collision guard, and the
  manifest build/push path.
- Adjudicated the two gate-flagged empty catches.

## Tests — coverage assessment
Coverage genuinely exercises the op MATH, not just happy path:
- NaN/finite guards: gain `value:NaN`, curve `gamma:NaN`, slope dt=0 floor all
  asserted to reject/clamp (signal_post_processor.test.js:214, 951, 1272).
- Slew clamps ±step/tick both directions; out-of-range param rejection across ops.
- Normalizer: constant convergence, step-up re-normalization, strength=0 identity,
  strength=0.5 blend, divide-guard (peak==floor), patchOp state preservation.
- danceMaker: bit-for-bit parity with the legacy spring at default AND a
  non-default omega, glide/no-overshoot, larger-omega-settles-faster, type gating.
- freq mode: clamp Hz bounds accepted/[0,1] rejected, slew Hz/s rate.

Two coverage GAPS (tie directly to the findings below):
1. danceMaker omega is only tested up to 12; the divergent high-omega regime
   (ω ≳ 86 at the 11.6 ms hop) is untested.
2. `freq_ops_synthetic.test.js:220` explicitly skips `kalman`
   (`FREQUENCY_OPS.filter(t => t !== 'kalman' …)`) — the authors know it has no
   implementation, so the palette/validator contradiction is never asserted.

## Empty-catch adjudication (gate-flagged, in-domain)
- **`signal_post_processor.js:407` `catch { return false; }`** — ACCEPTABLE,
  not a P0 violation. This is the final probe in `_paramCenterHasKey`: it calls
  `paramCenter.get(key)` purely to discover whether the key exists, and the real
  ParamCenter's documented contract is to THROW on an unknown key. The throw IS
  the signal; catching it to return `false` ("unknown key") is the intended
  boolean probe, not a swallowed error. The unknown key is then surfaced loudly
  by the caller as a 400 ("unknown CPC key"). This is legitimate input
  validation, not a masked fault.
- **`companion_server.js:893` `let m; try { m = JSON.parse(raw); } catch { return; }`**
  — ACCEPTABLE, not a P0 violation. `/ws/control`-style inbound is operator UI
  traffic; a malformed/partial WS text frame is untrusted input, and dropping a
  frame that isn't valid JSON is correct boundary handling (the next valid frame
  is processed normally). It masks no internal computation and no dead source —
  the analyzer path is entirely separate. (Same justification as the
  engine-link `ws.on('message')` JSON guard at engine_config_link.js:125, which
  is also fine.)

## Findings (prioritized)

### P1 — danceMaker explicit-Euler spring diverges at high omega → garbage Hz over OSC
`signal_post_processor.js:65-70` (`danceSpringStep`), validated range
`signal_post_processor.js:249` (`omega max 100`), emit path
`companion_server.js:525,540`.

The spring integrates with explicit (forward) Euler:
`v += (k·(target−x) − c·v)·dt; x += v·dt`, with `c = 2ω`. Forward Euler on the
velocity-damping term is only stable while `c·dt < 2`, i.e. `ω < 1/dt`. The
analyzer hop is `HOP/SR = 512/44100 ≈ 0.0116 s`, so the stability ceiling is
`ω ≈ 86`. The validator allows `ω` up to 100. Reproduced (constant 440 Hz target):

```
omega=7    x=440.00          (stable)
omega=50   x=440.00          (stable)
omega=86   x=-3.69e+43       (DIVERGED)
omega=100  x=-6.68e+72       (DIVERGED)
dt=0.03 (frame hiccup): omega=50 → x=-5.49e+117 (diverges well below 86)
```

The divergent values are FINITE (≈1e43–1e227), so the frequency-mode
non-finite guard in `process()` (`signal_post_processor.js:923`,
`isFiniteNumber(val) ? val : 0`) does NOT catch them — a nonsense ~1e72 "Hz"
is sent over OSC to `/marsin/dom/freqN` and into the dom-dance visualizer
(`danceFromOp`, companion_server.js:534-535,579-580). On a real playa where a
frame can stall to 30 ms, even ω≈50 diverges. This is operator-reachable: the
danceMaker omega slider/typed input accepts up to 100.

FIX (pick one):
- Tighten the validated `omega` max in `OP_SCHEMA.danceMaker` to a value safe at
  the worst expected `dt` (e.g. `max: 40` gives margin to ~50 ms hops), OR
- Make the spring step unconditionally stable: use semi-implicit (symplectic)
  Euler — update `v` first, then `x += v·dt` using the NEW v
  (`x += v*dt` after `v += …` already does this, so the real fix is to damp
  implicitly: `v = (v + k·(target−x)·dt) / (1 + c·dt)`), which is A-stable for
  any dt. The symplectic form keeps the "no overshoot, glide" character while
  removing the dt/omega stability cliff. Re-pin the bit-for-bit parity test to
  the new step (the visualizer shares `danceSpringStep`, so both move together —
  codex P0 one-source-of-truth is preserved).

### P2 — `kalman` advertised in FREQUENCY_OPS but no kalman op exists → UI offers an op the validator always rejects
`companion_config.js:186` (`FREQUENCY_OPS` includes `'kalman'`) vs
`signal_post_processor.js:164-319` (`OP_SCHEMA` has no `kalman`).

`validateSignal` (companion_config.js:302-307) gates a frequency signal's ops
against `FREQUENCY_OPS` — which lists `kalman` — then hands the chain to
`validateChain` → `_validateOp`, which rejects any type not in `OP_SCHEMA`
("unknown op type"). So a `kalman` op passes the type-gate and is then refused
by the engine validator. The companion `/state` payload also surfaces
`frequencyOps` (companion_server.js:880,1029) to the designer UI, so the UI will
offer `kalman` in the frequency palette and adding it 400s. It fails LOUD (no
silent fallback — codex-compliant), but it is a broken/dead menu entry. The
contract doc itself hedges it: "kalman (if available)". The test suite already
works around it (freq_ops_synthetic.test.js:220 filters it out), confirming the
gap is known.

FIX: either implement a `kalman` op in `OP_SCHEMA` + `_applyOp` + `_initRuntime`
(a 1-D constant-velocity Kalman smoother on the Hz value, runtime = {x, P}),
or remove `'kalman'` from `FREQUENCY_OPS` until it exists. Removing is the
lower-risk pre-merge choice; keep the doc's "if available" note.

### P3 (nit) — `_paramCenterHasKey` "under-featured stub → return true" is a deliberate fallback
`signal_post_processor.js:404-409` (and the docstring at 386-392). If a
paramCenter exposes neither `.has` nor `.getSchema`, the function probes `.get`
and treats a throw as "unknown". The constructor already guarantees `.get`
exists, so the only reachable path is the throw→false probe. This is fine, but
note the docstring's stated "return true so we don't block PUTs on an
under-featured stub" branch is actually unreachable given the `.get` fallback —
the comment overstates a fallback that the code doesn't take. Cosmetic; no
behavior change needed, but the comment is misleading for a future maintainer.

## Things checked and found CORRECT (no action)
- LPF / envelope / compressor / normalizer time constants are all
  `α = 1 − exp(−dt/τ)` (or `−2π·fc·dt`) — exact frame-rate independence, no
  per-frame-count assumptions.
- Normalizer divide-by-zero guard (`denom = span > eps ? span : eps`,
  signal_post_processor.js:1268-1269) is correct; flat input converges to 0, no
  NaN/Inf. Floor-fast-down / peak-fast-up asymmetry matches the cited adaptive-
  level topology. Frequency-mode dry blend toward 0.5 keeps output in [0,1].
- Compressor attack/release selection (`targetGrDb < rt.grDb ? attack : release`,
  signal_post_processor.js:1152) is correct: grDb ≤ 0, louder input ⇒ more
  negative target ⇒ attack. `eps=1e-9` guards `log10(0)`.
- Biquad recomputes coefficients per-sample from current dt (correct for a
  varying-dt source); Direct-Form-1 history shifted correctly.
- Schmitt/hold use an accumulating `rt.clock` (dt-summed ms), so refractory and
  hold windows are wall-clock-correct regardless of frame rate; `lastFireAt =
  −Infinity` fires correctly on first sample.
- Slope dt floor (`safeDt = dt > 1e-6 ? dt : 1e-6`, line 1219) prevents the
  zero-dt blow-up; bipolar/unipolar clamps correct.
- `clamp01` (line 637) handles NaN (`!(v>0)` → 0) and the entry guard
  (`isFiniteNumber(rawValue) ? rawValue : 0`, line 903) keeps NaN out of state.
- osc_out is a true identity in `_applyOp` (line 1291) and terminal-only +
  at-most-one (validateChain 623-631); name→slug→cpcKey/address derivation is
  consistent across signal_post_processor.slug and companion_config.resolveOscOut,
  with curated keys preserved (CURATED_OUTPUTS) so the mission-critical
  audio→light addresses are never slug-mangled. Empty-slug names rejected loudly
  in both places. Cross-signal cpcKey collisions rejected
  (validateCompanionConfig 399-407).
- bpm_emit fails SAFE (drops non-finite / out-of-(0,300] BPM, no stale send).
- engine_config_link degrades gracefully (background reconnect; `patch()`
  rejects loudly rather than pretending success) — codex-compliant, not a silent
  fallback.
- All imports at top of file; no runtime network/CDN deps (vendored `ws`,
  `osc-min`, `js-yaml`, Node built-in fetch) — offline-safe for the playa.

## Reproduction script (P1)
```bash
cd marsin_engine && node --input-type=module -e "
import { danceSpringStep } from './audio/postproc/signal_post_processor.js';
const dt = 512/44100;
for (const w of [7,50,86,100]) { let x=0,v=0;
  for (let i=0;i<200;i++)[x,v]=danceSpringStep(x,v,440,dt,w);
  console.log('omega='+w, Number.isFinite(x)?x.toFixed(2):x); }"
```
