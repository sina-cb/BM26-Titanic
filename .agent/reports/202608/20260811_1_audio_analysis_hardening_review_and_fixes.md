# Audio-analysis hardening: hostile review + fix campaign

**Date:** 2026-08-11 · **Worktree:** `BM26-Titanic-worktrees/audio_analysis_hardening` (branch `feat/audio_analysis_hardening`, HEAD `11a1a962` + uncommitted work) · **Coordinator:** Claude (manager), 6 Opus agents (3 review, 3 implement/validate)

## What happened

The ChatGPT review packet (`~/tmp/audio_analysis_hardening/claude_review_packet.md`) asked for a
hostile independent review of the uncommitted audio hardening work. Three review agents ran
(BPM tracker, Companion safety, evidence audit), then three implementation agents fixed the
findings, added an operator-requested BPM output slew, and validated the combined result.
Review contract honored throughout: no git write ops, no engine boot, no mic, no bare
`node --test`, production checkout untouched.

## Key findings (all now fixed)

- **P0 — false parity claim.** `minBpm: 70→60` was an always-on DSP change (lag range 74→87)
  shipping under a "legacy path unchanged" label, and the benchmark was rewritten in the same
  change to drop the at-risk fast tempos (124/128/150/174).
- **P0 resolution — A/B decided minBpm stays 70.** Identical evaluator, all tiers:
  60 regressed moderate-174 → 112.1 (−35.6%) and heavy-124 → 96.4 (−22.3%) for a win on the
  single 60 BPM row. Tables in the fix agent report; rationale comment in `config.yaml`.
- **Pure-hypothesis experiment removed** (reviewer verdict: remove until redesigned). Its
  `purePeakRatio: 0.94` threshold straddled an autocorrelation taper artifact ((N−lag)/N ≈
  0.93–0.94), not a musical quantity; confidence described the discarded comb winner;
  `octMigrateEvidenceRatio` was provably dead code. Redesign diagnosis kept as a comment in
  `bpm_tracker.js` DEFAULTS (lag-normalized AC + explicit metrical-grid model).
- **`--no-mic` was airtight for the mic but not for the network.** It now enforces three
  boot interlocks: explicit `--source test|file`, explicit `--osc-port`+`--engine-port`
  (loopback ≠ isolation — the production engine lives on the loopback interface at its standard port), and loopback-host
  checks on shared target resolvers.
- **Silent-zero publish path removed** (`?? 0` → throw, consistent with raw path);
  live-edit collision checks added; `/signal_snapshot` now reports real per-key write counts
  instead of a static "registered" flag.
- **Incident root cause:** `tests/hil/hil_audio_realtime_test.mjs` — matched the default test
  glob, defaulted to `--source mic` bound to all interfaces on its designer port, no liveness assert. Now gated behind
  `BM26_HIL_OK=1` before any spawn. Note: `run_hil.mjs run-all` therefore now *skips* it —
  deliberate coverage change, operator informed.
- **Evaluator had no gates.** Now: 14-tempo grid, subgroup gates with exit 1 naming the
  failure, 6-way alias classification (×2, ÷2, 3/2, 2/3, 4/3, 3/4).
- **Config hygiene:** `DerivedSignals` requires tracker options (no `{}` fallback);
  `hopsPerSec` derived from `sampleRate/hopSize` (no default); unknown `bpmTracker` yaml keys
  rejected by name; `activityThreshold` bounded.
- **Manifest checksum "failure" was a misread** — it hashes the built corpus manifest in
  `~/tmp`, not the repo sibling. Now tool-written, LF/BOM-normalized, verifiable offline via
  tracked copy `datasets/audio_hardening_corpus_manifest.json`, pinned by tests.

## New feature: BPM output slew (operator request)

Published BPM walks to new targets at `outputSlewBpmPerSec` (default 16; 124→140 ≈ 1.0 s)
instead of jumping — no visual glitches. Tracker internals and beat phase stay exact;
`bpmRaw` preserved for tooling; acquisition/loss snap (no fake ramp through 5→120 BPM).
Live-tunable from the Companion OSC page via `setBpmSlew` → PATCH (only the two slew keys are
live; tempo-model keys 400). `config.yaml`: `outputSlewEnabled: true`, `outputSlewBpmPerSec: 16`.
UI control is syntax-checked but **not visually verified** (server boot was out of contract) —
eyeball the OSC page on next real run.

## Final state

- Full safe suite: **733/733 pass** (companion 99, audio 564, tools 9, integration 61),
  zero residue, `node --check` clean on all 28 touched JS files.
- `tools/bpm_tune_eval.mjs --tiers clean` → exit 0, GATES PASSED (the 60 BPM row locks ×2 by
  design — outside the 70–180 band).
- Worktree: 34 modified + 2 untracked files. **Operator must `git add`:**
  `marsin_engine/datasets/audio_hardening_corpus_manifest.json`,
  `marsin_engine/tests/companion/companion_live_edit_collisions.test.js`.
- All git operations (add/commit/branch) left to the operator per P0 rules.

## Open items / follow-ups (candidates for Notion backlog)

1. Visual check of the BPM SLEW UI control on next Companion boot.
2. `run_hil.mjs run-all` no longer runs the realtime HIL test without `BM26_HIL_OK=1` — decide
   if run-all should set it.
3. Known gaps documented (not fixed) in companion README: inert `setOscSend` checkbox,
   event-envelope vs UI-pulse divergence, stale `audioVocalsHot` in `states/*/globals_state.yaml`.
4. Latent test tension: a scene-scoped PATCH of slew keys persists a `bpmTracker` block into
   that scene's `audio_state.yaml`, which would break `audio_analysis_config.test.js`'s
   identity assertion for `test_bench` (passing today).
5. Heavy-tier weaknesses remain (75→111, 150→~102, 160→~146) — pre-existing, now honestly
   measured and report-only; a future campaign can attack them with the gated evaluator.
6. BPM redesign idea preserved in `bpm_tracker.js` DEFAULTS comment: lag-normalized AC with
   explicit metrical-grid hypotheses.
