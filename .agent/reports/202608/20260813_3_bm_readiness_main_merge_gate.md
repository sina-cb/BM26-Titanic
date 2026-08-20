# BM readiness local — main merge gate

**Date:** 2026-08-13  
**Branch:** `dev/bm_readiness_local`  
**Base/head at review start:** `3a4d559d feat: converge BM readiness local integration`  
**Status:** code gates green; operator manual/iPad acceptance and durable-branch publish remain gated.

## Scope and history proof

The branch contains the intended BM readiness, Misha Live Touch, Audio
Companion/audio-hardening, Spotlight Sampling, and Baby Reveal work. History
and worktree comparison found no later authored source left behind. The old
Misha tip is represented by patch-equivalent rebased commits plus the later
production-hardening commit; Baby Reveal is atomically renumbered to 131–133
while Live Touch owns 128–130. `origin/main` is an ancestor of this integration.

## Merge-review fixes

- Fixed persisted `capture.platform: auto` device enumeration on the host OS.
- Separated Companion source sentinels (`test`, `file:`) from physical mic
  names; invalid source-mode requests now fail before mutating/persisting.
- Pinned the launcher architecture to one analyzer: Audio Companion owns live
  analysis and the engine's legacy analyzer stays disabled.
- Closed same-owner ARM socket replacement races and preserved Timeline-yielded
  armed sessions across Wi-Fi reconnects.
- Made Timeline activity renewal success-owned: malformed/rejected Live Touch
  mutations do not reacquire the operator lease; valid owner mutations do.
- Added atomic Live Touch prepare rejection/rollback for partial controller
  writes and loud brightness/model remap refusal while armed.
- Made the pixel preview truthful for up to ten simultaneous touches and kept
  the browser paint path rAF-coalesced and bounded.
- Added keyboard/ARIA semantics and window-level final flush to group faders.
- Fixed CaptainPad's conditional-hook lint error.
- Fixed stale full-suite assertions for legal subdirectory patterns and the
  repaired `dev_test_bench` sidecar.
- Repaired stems-fed evaluation: the harness now registers Companion-manifest
  stem keys before scoring, instead of silently ignoring unknown writes. The
  synthetic affirmative detector threshold was recalibrated against the real
  production analyzer configuration; production precision-first tuning is
  unchanged.
- Fixed a Windows address-conflict assertion and a fast-child exit-listener
  race in the config boot matrix.
- Made VSN1 dependencies part of the engine's locked root install so clean
  installs can run the deploy-template gate offline after dependency install.
- Capped engine test-file concurrency at four, eliminating Node 24 IPC/port
  contention while retaining parallel execution.

## Verification evidence

- MarsinEngine exact `npm test`: **3204/3204 pass**.
- CaptainPad: **1034 pass, 6 hardware-gated skips**; TypeScript pass; full lint
  **0 errors, 13 existing warnings**; web export pass with all 25 routes.
- Simulation `npm run check`: **2237 pass, 6 long-documented bench-sync
  baseline failures, 1 todo**; no integration-specific regression.
- Canonical pixel/export and projection suites: **15/15 pass**.
- Live brush/browser gate: 1,200 samples, 599 preview composites/600 rAF,
  zero canvas reallocations/static reprojections/long tasks, bounded 240 ink
  stamps, and zero ink/pending rAF after the 1.5 s maximum fade.
- Responsive geometry: root/body equals viewport at 640/768/1024/1366; group
  bank scroll stays internal. Multitouch preview union and fullscreen pass.
- Four canonical view screenshots visually inspected:
  `.agent_renders/live_touch_view_top_down.png`,
  `live_touch_view_front.png`, `live_touch_view_strands.png`, and
  `live_touch_view_te_sign.png`.
- Titanic engine list/dry-run and focused real-engine Live/Timeline/brightness/
  reconnect/rollback gates pass.
- `git diff --check origin/main` passes.
- `python scripts/security_check.py --all` passes with gitleaks **8.28.0**;
  no leaks found in ~75.96 MB.
- Launcher stopped; no listeners on 6966–6972 at handoff.

## Operator gates before commit/main

1. Launch `node launcher.js dev --scene titanic` from this worktree and perform
   the manual/iPad matrix: Deck↔Mixer, Live ARM/paint/multitouch/fullscreen,
   non-Layers navigation, Dimmer authority, Timeline inactivity handback and
   mutation reclaim, Audio Companion mic switching and live signal response.
   Record the results in
   `.agent/reports/202608/20260813_4_bm_readiness_operator_test_matrix.md`.
2. Explicitly accept or reject tonight's LAN policy. The production launcher
   passes Audio Companion `--host 0.0.0.0` so the iPad can reach it, but its WS
   mutation surface has no authentication. Loopback-only would break that iPad
   workflow; authenticated pairing is a separate design, not silently added.
3. Preserve/exclude tracked runtime residue in Titanic `audio_state`,
   `deck_state`, `globals_state`, `mixer_state`, and the status-only manifest.
   The intentional single-analyzer `audio.enabled: false` change shares the
   audio-state file with the operator's current Amazon USB microphone choice,
   so stage it deliberately.
4. Promote local-only `dev/bm_readiness_local` to a durable descriptive
   `feat/<snake_case>` branch before pushing. Re-run `security_check.py
   --staged`, commit, push, and merge only after operator approval.

## Exact eventual commit boundary

The source, UI, dependency-lock, test, Agent OS dashboard/report, and
whitespace-only merge-gate fixes listed by `git diff` belong in the eventual
commit, together with the new single-analyzer contract test and this report.
The following tracked paths require special handling:

- `marsin_engine/states/titanic/deck_state.yaml`, `globals_state.yaml`, and
  `mixer_state.yaml` are operator/runtime residue and must remain unstaged.
- `marsin_engine/patterns/manifest.json` is status/stat-only with no content
  diff and must remain unstaged.
- `marsin_engine/states/titanic/audio_state.yaml` is mixed. Stage the updated
  source-of-truth writer commentary and the portable `enabled: false` change
  against `HEAD`. Preserve the `HEAD` `capture.device: test` value and do not
  stage the current Amazon USB microphone selection, runtime-expanded
  `structureDetector` fields, or `bpmTracker` fields. Leave those working-tree
  values intact for the operator's local test session.

After selective staging, verify the index projection with `git diff --cached`,
confirm the four runtime-state files remain only in the working tree, run
`python scripts/security_check.py --staged`, and rerun the single-analyzer
contract from the staged projection before committing.

The exact audio-state projection is preserved outside the repo at
`C:/Users/Titanic's End/tmp/bm_readiness_audio_state_selective.patch`.
`git apply --check --cached` accepts it against the current index, and an
in-memory parse of the resulting clean-clone semantics proves
`enabled == false` with `capture.device == test`. The patch has not been
applied and the index remains untouched.

A minimal clean-clone projection assembled from `HEAD` plus that unapplied
patch is preserved at
`C:/Users/Titanic's End/tmp/bm_readiness_clean_projection_20260813`. Its
executable `companion_single_analyzer_contract.test.js` passes 1/1. A separate
semantic assertion proves the projected file has `enabled == false`, portable
`device == test`, no `bpmTracker`, and only the two pre-existing
`structureDetector` keys; SHA-256 is
`b6894124c50ffcf27eb8b341e36b948f043c206efbde95eb965b55946a81120a`.

The eventual whole-file staging allowlist is preserved at
`C:/Users/Titanic's End/tmp/bm_readiness_stage_include.txt`, with its
read-only validator at `C:/Users/Titanic's End/tmp/bm_readiness_stage_audit.mjs`.
The current audit passes: 35 whole-file inclusions, one mixed selective file,
four explicit exclusions, and all 40 changed paths accounted for exactly once.
The validator also proves the excluded manifest remains content-clean.

No commit, push, service launch, or default-port mutation was performed during
this final gate.
