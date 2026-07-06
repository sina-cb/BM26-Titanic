# 2026-06-20 — Audio Analysis: FINAL summary (feat/audio_analysis_2)

Supersedes the interim summary `20260620_11`. This is the complete, honest arc of
the multi-wave autonomous effort. **Deliverable: branch `feat/audio_analysis_2`,
pushed to origin, full audio suite 300 green.** No PR opened (not requested).

## Headline outcomes
| Area | Result | Honesty note |
|---|---|---|
| **Genre detection** | 7-genre party-mode classifier, **63.9% on real audio** (60-track CC corpus) | 63.9% is the proven CEILING on these features/labels (independently reproduced); cold-start melodic_house bug fixed |
| **Drop detection** | **0.12 phantom drops/min on real music** (precision-first) | Honest Pareto: synthetic recall 0.94→0.28 — mic-only drop detection on continuous music has a hard frontier; a phantom drop is worse than a miss (codex). Operators can revert per-scene |
| **Note→colour** | root-cause fixed (blocked changes were dropped) + validated | |
| **Slow-zone / build** | super-tuned, real scoring (acc 0.46→0.91) | |
| **BPM** | octave-doubling fixed + fast-tempo (170/DnB) de-halved for fast BM EDM | residual 3:2/6:5 metric-ratio errors out of ±1-octave scope |
| **New signals** | per-band onsets, sub-bass chest-hit, riser/anticipation, drop-countdown, phrase, climax, silence/track-change — all real-corpus-validated (no over-firing) | |
| **FFT** | 1024→2048: dom-freq err 4.46→0.66 Hz, note 5/8→8/8, sub de-bleeds from kick | |
| **Patterns** | 10 new reactive looks (59–68); silence floors lifted for night visibility | |
| **Companion** | OSC-OUT accounting page + 5 CaptainPad themes + all new signals displayed + engine-internal label | no headless screenshot (no chromium) — verify visually before playa |
| **CaptainPad** | dynamic audio signals, genre name, scrollable grid, rich modulation popup, pulse-flash | |
| **Engineering** | deterministic test suite, allocation-free hot path, fail-loud per-signal, real CC corpus + eval harnesses | |

## The arc (waves)
1. **Round 2 (Wave A–C + safe pass):** genre + note/colour, companion accounting + theming, detector super-tuning + eval harness, per-band onsets + sub-bass, CaptainPad UI, 2 discovery + 5 adversarial agents, safe quality pass.
2. **Wave D (real-audio unblocked):** built a real 60-track CC corpus + genre_eval; FFT-2048; 9 new derived signals; 5 more patterns; detector recall; genre v2 (real-audio re-tune to 63.9%); BPM octave fix.
3. **Adversarial re-wave 2 (5 auditors on real corpus):** caught that several Wave-D signals + the detector were broken on REAL music despite synthetic green — the key lesson.
4. **Wave E (real-audio fixes):** detector false-fires 1.48→0.12/min; climax/countdown/eta/track-change over-firing fixed; deterministic perf + alloc-free + fail-loud; pattern night-visibility + observability.
5. **F-wave:** BPM fast-tempo recovery; CaptainPad pulse-flash.
6. **Integration gate:** full-suite run caught + fixed 2 cross-slice regressions (config-contract snapshot; detector↔signal-test coupling).

~35 merges. Process: instigator + worktree sub-agents (per `13_multi_agent.md`),
real-corpus verification bar, every task proof-logged in `20260620_1_verification.md`.
2 sub-agents stalled mid-task and were taken over + finished by the instigator;
1 node_modules self-symlink incident fixed; 1 inflated-accuracy claim (44.4 vs the
honest 63.9) and 1 detector synthetic-vs-real gap caught by re-verification.

## Honest open items / follow-ups (documented, NOT silently shipped)
- **Detector recall**: precision-first means it UNDER-fires real drops. The riser/
  anticipation signals still *lead* into builds, but the hard drop-cue is conservative.
  A stems-aware or learned detector is the path to recall without false-fires.
- **Genre 63.9%** is the ceiling on the current features; techno/downtempo (33%) need
  a real harmonic/timbre feature (chroma) that doesn't exist yet.
- **Fixed-`dt`** (wall-clock → hopSize/SR under jitter-buffer multi-hop drain): the
  remaining robustness "sleeper"; deferred because it shifts the time-base every
  signal was just tuned against — do it as its own slice with full re-validation.
- **BPM metric-ratio** (3:2/6:5) errors on some fast tracks — out of ±1-octave scope.
- **Visual verification**: companion theme switch + the lifted pattern floors need an
  eyes-on check on a browser/the rig (no chromium in this datacenter).

## Datasets used
60-track CC dance-music corpus from archive.org netlabels (per-track license/id/url in
`marsin_engine/datasets/genre_corpus_manifest.json`; audio in ~/tmp, never committed),
+ the deterministic synth bank. See `datasets/README.md`.

## Operator action
Review `feat/audio_analysis_2` (pushed, 300 green). Open a PR when you want it toward
main. Highest-value next session: a recall-capable detector (stems/learned) and the
fixed-`dt` robustness slice, both wanting the real corpus + ideally live-mic validation.
