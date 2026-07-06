# 2026-06-20 — Adversarial wave (5 agents): consolidated P0/P1 findings

**Author:** instigator, consolidating 5 read-only adversarial auditors of the merged
`feat/audio_analysis_2` (lenses: DSP/analyzer, detection/scoring/genre, derived-signals,
companion/OSC/UI, robustness/tests/offline). Each agent stress-tested the freshly-merged
work. Status legend: ✅ FIXED (this run) · 🔭 BACKLOG (coordinated follow-up, documented).

## Cleared by the auditors (good news)
- **Offline-readiness CLEAN** — no CDN/font/network/telemetry in the new companion UI
  (theming, accounting) or wiring; 5 theme blocks are inline CSS vars.
- **Mic-failure / device-loss / underrun CLEAN** (capture + jitter buffer unmodified;
  exp-backoff, fail-loud on no-device, NaN-guarded).
- **Tracked-state CLEAN** — new tests leave `states/*.yaml` untouched.
- **No fallback-behavior (codex P0) violations** in the genuinely-new signal code.
- **Perf budget NOT blown** — auditor measured `DerivedSignals.tick()` (genre+onsets+sub+
  bpm+note+party+switch all hot) at p50 ~0.002 ms / p99 ~0.38 ms over 200k hops.
- **The `audio_analysis_validation` perf-p99 "flake" is NOT real** — ran 3× concurrently,
  35/35 every time. (Earlier caution retracted.)
- Full committed-tree audio suite: **295 pass / 0 fail** (auditor-observed).

## ✅ FIXED THIS RUN (signals P1 batch — commit `a775398`)
1. **Dead startup guard** (`switch_signals.js`) — compared the absolute epoch clock to
   `startupGuardMs` so it never fired; opening transient could burn a pattern swap.
   Anchored on first tick (`_firstTickMs`). + regression test. *(Confirmed by 2 auditors.)*
2. **PartyMode no warmup** — a lone opening spike could latch+hold party with no music.
   Added a `warmupMs` (1500) gate. + new `party_mode.test.js` (module had zero tests).
3. **Genre confidence always 0 when deep_house wins** — argmax self-seeded `bestS=score[1]`
   → spread 0 → `audioGenreConf` structurally 0 for genre 1. Seed `-Infinity`. + test.
4. **Dead `PARAMS.bpm`** (`derived_signals.js`) — never passed to BpmTracker, carried stale
   v1-only keys; + `audioBpm` doc range `[0,300]→[0,180]`.

## ✅ ROUTED TO IMPLEMENTATION (disjoint, safe — companion/CaptainPad worktree)
5. **OSC accounting `rateHz` never decays** (`companion_server.js`) — a stopped stream
   (disabled tap, BPM during silence) reports its last rate forever; observability that
   lies (codex P0). Decay the EWMA by idle time at read; + a "stops → rate→0" test.
6. **Light-theme on-accent contrast fails WCAG AA** (`companion_app.css`) — 3 controls
   hardcode `#1a1205` on the light accent `#006875` = 2.86:1. Add a per-theme `--on-accent`
   token (light → `#ffffff`), route the literals through it.
7. **CaptainPad `isGenreKey` over-matches `audioGenreConf`** (`utils/audioSignals.ts`) —
   `/genre/i` matches the conf key too → would render confidence as a fake genre name.
   Exclude `conf`.
8. **CaptainPad `curateDeckSignals` token collision** — `'low'` matches `audioSlowZone`
   ("s**low**zone"); anchor band tokens to word boundaries.
9. **Native `window.confirm()` dialogs remain** (`companion_app.js:423,445`) — contract says
   no native dialogs; route remove-view/remove-signal through the themed modal.
10. **Test gaps** (auditor 5): no perf-budget assertion driving the real `DerivedSignals.tick()`
    (genre+shapers uncovered), and no end-to-end finiteness sweep for the new keys
    (`micOnset*`, `audioChestHit`, `audioGenre/Conf`). Add both.

## 🔭 BACKLOG — coordinated follow-ups (do NOT land piecemeal; need real audio / HIL)
- **FFT 1024→2048** (auditors 1+5, P1) — single highest-leverage quality change: at 1024,
  one bin = 43 Hz so `audioNote`/`audioNoteHue` is quantization noise below ~110 Hz and the
  **`sub` window (30–60 Hz) actually measures 43–86 Hz — overlapping the kick**, so
  `audioChestHit` is a near-duplicate of the kick, not the body-felt slam. Bumping to 2048
  (keep `hopSize:512`) fixes dom/note/sub but **re-tunes** `DominantFreqTracker` bins, the
  genre profiles (measured at 1024), and the sub/kick windows — must be ONE coordinated
  re-validation slice, not an independent drop. ~1 day.
- **Fixed-`dt` to signal consumers** (auditors 1+3, P1) — the JitterBuffer drains multiple
  hops per timer tick so wall-clock `dt` is uneven (2nd hop dt≈0, 1st dt≈2×). Feed the
  nominal `hopSize/sampleRate` to detector/derived/party/genre. engine.js change; validate
  on HIL. ~2–3 h.
- **Genre v2 robustness** (auditor 2, P0-class for real audio) — (a) `melodic≈0 ⇒ techno`
  misclassifies any non-melodic / mic-gated (`pitchClass=-1`) section as techno conf 1.0;
  feed a *note-present* flag distinct from *note-flipped*, and require corroborating techno
  features. (b) `confSpread=0.12` is too wide for the house-family score gaps (~0.02–0.04)
  so confidence is bimodal (only techno reads high) — recalibrate or use softmax. **Needs
  real labelled per-genre audio to tune (datacenter-gated) — the documented genre follow-up.**
- **Detector scoring honesty** (auditor 2, P1) — `detection_eval.mjs` excludes phantom
  drops on negative clips (`negFp`) from precision/F1, so "precision 1.00" can hide false
  fires on calm audio; fold `negFp` into precision and make false-fires/min a headline
  metric. Also: `dropMinLevel`/`slowFluxFloor`/`slowZoneRef` are ABSOLUTE levels calibrated
  against the harness's SNR-renormalization — a real mic-gain/AGC venue isn't testable by
  the current tiers; add an absolute-level tier and consider a relative drop gate. And the
  second-drop / breakdown→drop recall hole (missed even at 4.5 s spacing). ~M each.
- **P3 cleanups** — dom2 retarget assigns a raw (un-Kalman'd) peak (`dominant_freq_tracker.js:399`,
  discontinuous `micDomFreq2`); stale `useKalman` comment vs `useKalman:true`
  (`audio_analyzer.js:73-78`); `_kalmanNis(dt)` ignores `dt` (latent at fixed rate);
  genre_classifier header claims it uses build/energy scores (stale doc); duplicated genre
  name list in 3 places (drift risk).

## Notes
- The 5 auditors made NO repo edits (read-only); auditor 5 stashed/popped the in-flight
  signals batch to test the committed tree, restoring it intact.
- Scratch harnesses (auditor 2's adversarial synths under `~/tmp/adv_audit/`) are worth
  promoting into `detector_scenarios.mjs` when the detector-scoring follow-up lands.
