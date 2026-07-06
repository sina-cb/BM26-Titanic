# 2026-06-16 — Audio framework: 4-review consolidation + build priorities

**Author:** developer agent (branch `claude/audio-corpus-tuning-olcd6i`)
**Inputs:** 4 independent reviews of `docs/37_marsin_audio_framework.md` + the
`marsin_engine/audio/` code — one external (GPT) doc review, and 3 cold reviewers
(stability, mic/realtime, UI). This report consolidates them, records root-cause
diagnoses, and orders the build. Companion to the design doc (docs/37) and the
build plan (`20260616_2_marsin_audio_framework_plan.md`).

## TL;DR

The design and DSP are sound and well-documented; the "one source of truth"
discipline holds. Three things are genuinely wrong with the **current code** and
must be fixed before this is rig-ready:

1. **The default drop detector fires 0 drops** (the `kalman` edge is mistuned).
2. **Mic signals are "discretized"** because analysis is clocked by ffmpeg bursts
   and `dt` is corrupted — a jitter buffer + steady clock fixes it.
3. **The design doc over-promised** (detector "validated," UI features "built,"
   config "live-tunable") — already corrected in docs/37 this pass.

No code was changed yet — these are for review + the build phase.

## Root-cause diagnoses (the two real bugs)

### A. Drop detector under-fires (P0) — `audio_structure_detector.js`
Confirmed by instrumenting the chain on the corpus. In steady state the
innovation variance `S = (P+Q)+R` collapses toward `Q = KALMAN_Q = 0.01` (P→~1e-6,
adaptive R→~1e-6 on flat input). So a signal needs a single-hop step of
`y ≥ √(6.63·0.01) ≈ 0.257` to clear `dropNisThreshold`. The synthetic drop's
`micLow` ramps ~0.33→0.68 over ~3 hops (8 ms attack envelope) → max single-hop
innovation ≈0.21 → NIS ≈4.5, **never reaching 6.63**. `micFlux` NIS does spike but
1–2 hops *after* the low step, and the gate requires `kLow.nis ∧ kFlux.nis` on the
**same hop** → 0 fires. The 3 red integration tests are asserting correct behavior.
**Fix:** lower `KALMAN_Q` (≈1e-4–1e-3 so adaptive-R sets the NIS scale) and/or
relax to a ±N-hop **co-occurrence** window; re-validate on the corpus until
`tests/integration/audio_analysis_validation.test.mjs` passes. `level`/`windowed`
modes are unaffected.

### B. "Discretized packets" (P1) — capture/analyzer clocking
ffmpeg stdout chunks carry many hops; `audio_capture.js` drains them synchronously
so the whole DSP chain runs in bursts. `dt` is taken from wall-clock between bursts
(`engine.js:1440`, `companion_server.js`), so the first hop of a burst gets a large
`dt` and the rest `dt≈0` — corrupting every dt-driven filter (dance spring no
longer critically damped, structure IIRs lurch, BPM PLL smears). The 60 Hz
broadcast hides it in the UI only; the engine→CPC→pattern path still gets
burst-timed updates. **Fix:** sample FIFO + drift-corrected hop clock in the
capture layer, feed the analyzer one hop per nominal `HOP/SR`, hand the chain a
**fixed** `dt`. Underrun → skip (no zero-fill). Add ffmpeg low-latency flags
(`-flush_packets 1`, `-flags low_delay`) — currently absent. Full spec + the
operator smoothness-test thresholds are now in **docs/37 §13**.

## All findings by source (deduped)

### External (GPT) doc review — ALL FIXED this pass
- OSC "landed in CPC" over-promised vs docs/24 (no UDP ack) → split Sent vs
  WS-read-back confirmation (§7). ✅
- OSC port split 6970/10000 → docs/24 corrected to 10000. ✅
- Native-signals list didn't match registry (missing audioVocalsHot/tempoBpm) →
  enumerate from registry; mark external-source keys (§3). ✅
- Typed graph couldn't express DanceMaker windows → added `freqWindow` port (§2.1). ✅
- `audioCompanion.*` duplicated `audio.*` tuning → tuning stays under `audio.*` (§8.1). ✅

### Stability cold review
- **P1:** drop detector broken (diagnosis A above). — *doc downgraded; code fix pending.*
- **P1:** §12 overstated `kalman` as validated best-F1 → ⚠ defect note added (§12.2). ✅(doc)
- **P2:** `_kalmanNis(dt)` ignores `dt` — latent bug under the planned jitter buffer
  (variable rate); fine at fixed 86 Hz today. Noted in §13. *code: fold dt into predict.*
- **P2:** Companion hardwires `dropEdgeMode` (no UI knob) — operator can't work around. *build.*
- **P3:** `audio.dom.*`/`drop.*` config exposure promised but no validators exist →
  §12.3 marked target. ✅(doc) *code: add validators.*
- **P3:** dom `_emit` separation retarget assigns raw (un-Kalman'd) peak → dom2 can
  jump on retarget hop. *small code follow-up.*
- **P3:** §7/§8 OSC resilience + engine-supervised subprocess unbuilt (target). Noted.

### Mic/realtime cold review
- **P1:** burst-clocked analysis + `dt` corruption (diagnosis B). — *spec in §13; code pending.*
- **P1:** `{type:'diag'}` measures capture arrival (always bursty), not the
  post-buffer analyzer cadence → add analyzer-cadence + `micLowStepP95` metrics +
  pass/fail thresholds. ✅(doc §13) *code: extend diag.*
- **P2:** no ffmpeg low-latency flags; Windows AGC/DSP not actually disabled by code
  (OS-side; runbook item). ✅(doc §13/§10.3) *code: add flags.*
- **P1.3:** dom Kalman (Q4/R80, laggy) + dance spring (~0.4 s) stack two heavy
  smoothers in series on the same signal → laggy *and* jittery. Consider lightening
  one. *tuning.*
- **DOC/CODE CONFLICT:** `audio_analyzer.js:73-78` comment says "EMA beat the
  Kalman… useKalman:false" but `DOM_FREQ_PARAMS` ships `useKalman:true` (and §12
  agrees). **Stale comment — fix in code** (not done; flagged for review).
- **P3:** `specAnalyzer` runs a 4096 FFT/hop for the visualizer (Companion-only;
  costly on a Pi if ever embedded).

### UI cold review
- **P1:** §11 "Built" overstated the UI (no graph, no Output/OSC, no theme, fixed
  axes) → §11 split into Built vs Target-not-yet-built. ✅(doc)
- **P1:** node-graph editor is the hardest piece and is **unscoped** → flagged in
  §11 as needing its own plan slice or a descope to linear-chains+Output-list. ✅(doc)
- **P1:** reuse the Sim's `theme.js`/token pipeline for the rehaul (palettes already
  in `CaptainPad/constants/theme.ts`); move JS hex accents to CSS vars. ✅(doc §11)
- **P1:** canvases ignore `devicePixelRatio` + never resize (blur on iPad/HiDPI). *build.*
- **P2:** no a11y (focus-trap modals, Escape, aria-labels, AA contrast on dim axis
  labels), no view-state persistence, silent lossy reconnect. *build.*
- **Kept (good):** rAF/network decoupling, offline cleanliness, spectrum/wave render
  quality, calibration flow, server-side chain validation.

## Build order (recommended)

- **P0 — Drop detector re-tune** (diagnosis A) + re-validate corpus + fix the stale
  `useKalman` comment. Smallest change, biggest correctness win, unblocks the 3 tests.
- **P1 — Realtime: jitter buffer + steady clock + nominal `dt`** (diagnosis B, §13)
  + extend `{type:'diag'}` for the smoothness test + ffmpeg low-latency flags.
- **P1 — Config exposure** (`audio.dom.*`, `audio.structureDetector.drop.*`) via
  `audio_config.js` validators + Companion tuning UI (also the field workaround for P0).
- **P2 — Framework core**: typed-port op graph runtime + Kalman/DanceMaker ops +
  DanceMaker **parity test**; then OscSink + Output UI + engine-supervised subprocess.
- **P2 — UI**: HiDPI/resize fix, theme rehaul on Sim tokens, a11y, configurable axes.
  Decide graph-editor scope (full node graph vs linear-chains+Output) before building.

## State of the branch
Rebased onto `origin/main` (clean; 0 new test failures vs pre-rebase — the 22 reds
are 19 HIL-need-live-engine + 3 drop-detector P0). docs/37 (renumbered from 36)
updated for all 4 reviews. No production code changed pending operator review.
