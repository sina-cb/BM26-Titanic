# Merge Summary — Audio Analysis Improvements (4-slice multi-agent run)

- **Date:** 2026-06-13
- **Parent / PR branch:** `claude/laughing-lamport-tb6cc9`
- **Origin base at start:** `719e151` (audio review report)
- **Merged tip:** see `git log` below
- **Instigator:** orchestrated 4 sub-agents in isolated worktrees per `.agent/00_gol/13_multi_agent.md`, merged safest-first, verified on the merged tip.

## What shipped

Implements the improvement suggestions from
`.agent/02_reports/202606/20260612_2_audio_analysis_review_docs30_feasibility.md`.
Deliberately **excluded**: vendoring Meyda (the report recommended against adding a
vendored dependency with no consumer yet — it stays a future option, documented in
`docs/34`).

| Slot | Branch | Slice | Outcome |
|---|---|---|---|
| 1 | `dev/claude/audio_normalizer_calib` | Normalizer (AGC) chain op + `tools/audio_calibrate.js` + `docs/34` OSC-sidecar extension-point doc | success — 118/0 |
| 0 | `dev/claude/audio_file_replay` | File-replay capture source (`file:<path>` device + `--audio_file` flag, loops by default) | success — 42/0 |
| 2 | `dev/claude/audio_structure_detector` | `micFlux` spectral-flux primitive + docs/30 Phase-1 Audio Structure Detector (THIN/BUILD/SUSTAIN + `dropFired`) | success — 182/0 |
| 3 | `dev/claude/declarative_signal_table` | Declarative audio signal table (single source of truth) + schema-seeded CaptainPad live keys | success — byte-identical refactor |

## Merge order (safest-first, §8.2)

1. `merge(claude): audio normalizer op + calibration tool + OSC-sidecar doc [slot 1]` — pure additive
2. `merge(claude): file-replay capture source (file: device + --audio_file) [slot 0]` — localized
3. `merge(claude): micFlux primitive + audio structure detector (docs/30 Phase 1) [slot 2]` — cross-cutting
4. `merge(claude): declarative audio signal table + schema-seeded iPad live keys [slot 3]` — cross-cutting, on cleanest tip

All four merged with **zero conflicts**.

## Post-merge fix (instigator)

`test(hil): sync ws topic snapshot with routing table` — the HIL
`EXPECTED_TOPIC_BY_TYPE` snapshot in `hil_ws_topic_split_test.mjs` had drifted from the
real `TOPIC_BY_TYPE`: it was missing `groupFixedColors`, `scheduledTasks`,
`modulationState`, `signalChain` (pre-existing drift, present on the base branch) plus the
newly added `audioChainsChanged` and the docs/30 `dropFired`. Reconciled the snapshot so
the routing pin guards every classified type.

## Verification on the merged tip

- **Unit:** `node --test marsin_engine/tests/*.test.js` → **585 pass / 0 fail**
  (baseline at 719e151 was 526 with 1 pre-existing fail — the stale `AUDIO_LIVE_FIELDS`
  contract test, now fixed; +59 net new/fixed).
- **HIL:** `hil_ws_topic_split_test.mjs` → **39/39 assertions, 1/1 test pass**.
- **CaptainPad:** `npx tsc --noEmit` → only the **2 pre-existing** `components/Modulation.tsx`
  `transitionDuration` errors (present on base, unrelated); **0 new**. `expo lint` 0 errors.
- **Engine boot:** `node engine.js --list` → rc 0, 74 patterns.
- **Tree:** clean (test-run state/scene residue restored, not committed).
- **`git diff --check`:** clean.

## Known limitations / follow-ups

- **Structure detector** is disabled by default (observe-and-publish only; never triggers
  any irreversible action). Accuracy is bounded by engineering priors, not measured —
  docs/30 Phase 3 (labelled-dataset validation, now unblocked by the file-replay capture
  source) gates any show-critical automation. `barPhase` is not exposed by this rig
  (`getStatus().barPhaseAvailable === false`), so false-positive rate is the no-gate prior.
- **Normalizer op** uses a per-sample peak/floor envelope approximation (O(1), no history
  buffer) rather than a true sliding-percentile — appropriate for the hot path; tune
  `windowSec`/`strength` per venue.
- **Commits are Unverified on GitHub** — this container has no usable commit-signing key
  (`commit_signing_key.pub` is an empty placeholder, no private key). Identity is correct
  (`Claude <noreply@anthropic.com>`); the badge is environment-only, not an authorship issue.

## Worktrees (cleanup pending operator confirmation)

`audio_review`, `audio_file_replay`, `audio_normalizer_calib`, `audio_structure_detector`,
`declarative_signal_table` under `~/BM26-Titanic-worktrees/`. Remove with
`git worktree remove` once the PR is approved.
