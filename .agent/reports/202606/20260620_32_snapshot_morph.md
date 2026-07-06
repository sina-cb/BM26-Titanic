# Round-2 #1 — SNAPSHOT CROSSFADE / MORPH — handoff

**Date:** 2026-06-21
**Branch:** `dev/snapshot_morph` (worktree slot 2, engine HIL port 31268)
**Design followed:** `.agent/02_reports/202606/20260620_31_snapshot_morph_design.md`
**Docs:** `docs/39_channels_deck_mixer.md` §10.8 (appended)

## What shipped

Recall a saved mixer look by **ramping** current→target over `durationMs`
instead of the instant cut `/recall` does. Additive — `/recall` untouched. Built
entirely on the engine's existing animation machinery (per-channel
`transitions[]`, grand-master `_masterFade`, and a new parallel `_groupFades`),
plus a tiny O(1) `_morph` completion descriptor. UI: per-row MORPH button with
inline 1/3/5/10 s duration pills.

### API
`POST /mixer/snapshots/:name/recall-fade { durationMs }` (finite > 0).
- `404` unknown name · `400 SNAPSHOT_MALFORMED` · `400` durationMs ≤ 0 /
  non-finite / missing (validated pre-mutation) · `400 SNAPSHOT_OVER_CAP` on
  the **UNION** `current ∪ target` overlay count vs `maxChannels` (transient
  cap, fail-loud — no silent truncation).
- No `saveAllState` at kickoff (transient, like `/mixer/master/fade`);
  persisted by the finalizer on completion.
- Broadcasts `{type:'snapshots',action:'recall-fade'}` at kickoff +
  `recall-fade-complete` on landing (existing `snapshots` CONTROL topic, no
  routing change).

### Semantics (match by channel id)
- **M** (both): SNAP structural/chroma (rebuild content), anchor fader at
  pre-morph level, `fadeChannel` current→target. Changed-pattern = structural
  snap + level ramp.
- **T** (target-only): build at fader 0 + enabled, `fadeChannel` 0→target.
- **C** (current-only): `fadeChannel(→0, {destroyOnComplete})`; finalizer
  `paramCenter.unregisterChannel(id)` (removeChannel does NOT).
- Master `startMasterFade`; groups ramp the fader of groups in BOTH
  (`_groupFades`), target-only groups snap; deck SNAP content (never-dark) +
  RAMP fader.

### v1 deferrals (documented, additive-safe)
RAMP levels only (per-channel fader / group fader / master). `hue` / `color` /
`faderMax` SNAP at kickoff — color is metadata, faderMax a non-linear ceiling,
hue angular (needs short-arc, v2). Fader-locked channels keep their parked
level (fadeChannel refuses them); locked C channels left in place.

## File ownership (edited only these + new files, all under the worktree)
- `marsin_engine/lib/pattern_mixer.js` — `_groupFades` + start/cancel/cancelAll/
  `_tickGroupFades`; `_morph` + `beginMorph`/`getMorph`/`cancelMorph`/
  `_tickMorph` + `onMorphComplete`; both ticks wired into `beginFrame`;
  `updateMixGroup`/`deleteMixGroup` cancel in-flight fades.
- `marsin_engine/lib/api_server.js` — `morphToLook()`, the route, the
  `onMorphComplete` finalizer.
- `CaptainPad/utils/channelExtrasApi.ts` — `recallSnapshotFade(name,durationMs)`.
- `CaptainPad/components/SnapshotBar.tsx` — per-row MORPH + duration pills.
- NEW `marsin_engine/tests/snapshot_morph.test.js`,
  NEW `marsin_engine/tests/hil/hil_snapshot_morph_test.mjs`.
- `docs/39_channels_deck_mixer.md` §10.8.

Did NOT touch snapshot_manager.js, ws_topic_routing.js (verified `snapshots`
topic carries the new actions as payload fields — no change needed), mixer.tsx,
index.tsx, PlaylistPanel.tsx, GroupRail.tsx, api.ts, pattern_channel.js,
state_manager.js, engine.js.

## Verification proof (exact output)

### Engine (worktree `marsin_engine/`)
- `git diff --check` → clean.
- `node --check` lib/pattern_mixer.js, lib/api_server.js, tests/snapshot_morph.test.js,
  tests/hil/hil_snapshot_morph_test.mjs → all OK.
- `node engine.js --list` → **60 pattern(s) found**.
- `node engine.js --pattern test_const --model test_bench --dry-run` →
  `🏁 Dry run complete. Pattern loads and compiles OK.` **EXIT 0**, no
  missing-blend errors (all `trans_*` + `blend_*` compiled).
- `node --test "tests/*.test.js"` (full glob) →
  `# tests 987 / # pass 987 / # fail 0` (baseline 976 + 11 new).

Unit (`tests/snapshot_morph.test.js`, 11 pass): group-fade ramp lerp + **exact
land** + cancel-on-direct-write + delete-drops-fade + validation (bad
duration/target/unknown group); fadeChannel **M midpoint ≈ smoothstep(0.5)** +
exact land, **T 0→target**, **C →0 + removed**; **changed-pattern → structural
snap + level ramp**; morph descriptor fires finalizer **exactly once** with the
fadeOutIds set (no double-fire); beginMorph rejects bad durationMs; cancelMorph
(replace mid-flight, no orphan/double-free).

### HIL (engine booted `--model test_bench --port 31268`, in worktree)
`node tests/hil/hil_snapshot_morph_test.mjs --port 31268` →
**SUMMARY: 18/18 assertions passed.** Highlights:
- recall-fade → 200 with an active morph in the body.
- mid-fade master + channel fader ramping up toward target, MONOTONIC across
  two samples (master 0.329 → 0.544; fader 0.241 → 0.510).
- converged: master ≈ 0.9, fader ≈ 0.8 (targets).
- **"every channel fader matches instant recall (lands exactly on target
  look)"** — the morph-settled mix EQUALS an instant `/recall` of the same
  snapshot exactly (master + per-channel faders).
- error paths: unknown name → 404; durationMs 0 / -5 / "oops" / missing → 400.

Engine killed, **port 31268 free**, state restored from backup. The
summer_camp_dome `states/` + `simulation/.../default.yaml` are touched by the
default-model boot during the test run — **expected residue per CLAUDE.md**,
restored via `git checkout` and NOT committed; test_bench state clean.

### CaptainPad (worktree `CaptainPad/`)
- `git diff --check` → clean.
- `npx tsc --noEmit` → **EXIT 0**.
- `npm run lint` → **0 errors, 11 warnings** (all pre-existing exhaustive-deps
  in other files; none in SnapshotBar.tsx / channelExtrasApi.ts).
- `npm run web:build` → **EXIT 0, 21 static routes**.

## Codex P0
Additive (instant `/recall` untouched). Allocation-free hot path (`_tickMorph`
= one wall-clock compare; `_tickGroupFades` is a no-op single length-read when
idle; morph rides existing ticks). No silent fallbacks — transient UNION cap
overflow fails loud with `SNAPSHOT_OVER_CAP` 400; bad duration rejected pre-
mutation. All imports top-of-file; snake_case filenames; offline-safe (no new
deps). Edited only within the worktree.

## Deferrals (documented in §10.8)
- Ramp levels only; hue/color/faderMax snap (hue short-arc = v2).
- Locked C channels left in place during a morph (not ripped out mid-ramp).
