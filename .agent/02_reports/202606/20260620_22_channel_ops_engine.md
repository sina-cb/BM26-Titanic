# Report — Channel Ops Cluster (ENGINE side): #6 Duplicate · #7 Reorder · #9 Panic/Home

Date: 2026-06-20 · Wave: channel_ops_engine · Branch: `dev/channel_ops_engine`
(local only) · Slot 2 · Worktree:
`/root/workspace/BM26-Titanic-worktrees/channel_ops_engine`

Spec followed: `.agent/02_reports/202606/20260620_17_channel_ops_design.md`.
Composed on the deliverable tip (groups/solo `mixGroupId`+`soloSafe` + metering
all MERGED). UI is a SEPARATE later wave — no CaptainPad file touched.

## What landed (engine only)

### `marsin_engine/lib/pattern_mixer.js`
- `reorderMixerChannels(orderedIds)` — re-validates the permutation
  (array / exact length / no dups / every id is a current channel) and THROWS
  on a bad set (fail loud, no partial apply). On success does a SINGLE atomic
  reassignment of `this.mixerChannels` to the **same** channel objects in the
  new order: no splice, no recompile, no new `PatternChannel`. Handles, masks,
  `mixGroupId`, `soloSafe` all preserved by reference. Index invariant honored
  (stack order == array position); safe mid-transition (`_renderOrderScratch`
  re-derived per frame, transitions key on id).
- `panicToSafeDefault()` — `setMaster(1.0)` (cancels in-flight master fade);
  `cancelDeckPatternSwap()` (NOT finish — keep current known-lit deck pattern);
  `cancelChannelTransition` per overlay (restores saved blend mode + clears
  scripted-target flag); force-enable every overlay at fader 1.0 EXCEPT
  `faderLocked` (parked level sacred) and NEVER touching `faderMax` (safety
  ceiling); `soloedChannelIds.clear()`; un-MUTE every group (no delete, no
  fader reset); reset `targetViewFader` to 1.0.

### `marsin_engine/lib/api_server.js` (3 route arms, placed BEFORE the `^/mixer/channels/[^/]+$` regex)
- `POST /mixer/channels/:id/duplicate` — `rejectIfWrongRole` (deck→400), 404
  on missing source. Copy = `serializeChannelForState(src)` with fresh
  `id`/`name`, rebuilt via `buildChannelFromSaved` → fresh WASM handle (no
  shared `src.handle`), playlist/localControls/CPC rebound. Cap delegated to
  `addMixerChannel` (throws→400). Lands on top (push). Inherits all blob fields.
- `POST /mixer/channels/reorder {order:[ids]}` — permutation validated before
  mutate; deviation ⇒ `400 REORDER_BAD_SET`. Accepts mid-transition (no 409).
- `POST /mixer/panic {home?}` — `home` defaults true. Recalls a `home` snapshot
  if present; else `panicToSafeDefault`. Always clears blackout + master up.
  Malformed/over-cap home = the ONE sanctioned loud fallback: **400 with
  structured error BUT still blackout-off + master-up** (`rigLit:true`).

### `docs/39_channels_deck_mixer.md`
- Added §6b "Channel ops cluster — Duplicate · Reorder · Panic/Home" (data
  model, routes, fail-loud rules, the documented panic exception, site table).

### Tests (NEW)
- `marsin_engine/tests/channel_ops_state.test.js` — 10 unit tests.
- `marsin_engine/tests/hil/hil_channel_ops_test.mjs` — 30 HIL checks.

## Verification proof (exact output)

- `git diff --check -- marsin_engine docs` → **WHITESPACE OK** (clean).
- `node --check` on `lib/pattern_mixer.js`, `lib/api_server.js`,
  `tests/channel_ops_state.test.js`, `tests/hil/hil_channel_ops_test.mjs`
  → all OK.
- `node engine.js --list` → **60 pattern(s) found.**
- `node engine.js --pattern test_const --model test_bench --dry-run` → all
  blend scripts compiled, **"Dry run complete. Pattern loads and compiles OK."**,
  **EXIT=0**, no missing-blend.
- `node --test "tests/*.test.js"` (full glob):
  baseline **923 pass / 0 fail** → now **933 pass / 0 fail** (923 + 10 new).
  `# tests 933 / # pass 933 / # fail 0`.
- New unit file alone: `# tests 10 / # pass 10 / # fail 0`.

### HIL on :31268 (run IN this worktree) — 30/30 checks passed
Setup: snapshotted `states/test_bench`, `states/summer_camp_dome`, `config.yaml`
to `~/tmp/chops_snap`; launched `node engine.js --pattern test_const --model
test_bench --port 31268`. Highlights:
- DUP: new id distinct from source; lands on TOP; **inherits faderMax/color/
  soloSafe via the blob**; name `"<src> copy"`; **duplicate at cap → 400**
  (cap via addMixerChannel); missing source → 404.
- REORDER: reverse → 200, order applied, all ids intact; dup id / unknown id /
  wrong length each → **400 REORDER_BAD_SET**; **reorder mid-transition → 200
  (no 409), transition still completed** (target faded up).
- PANIC (master-fade-0 + mixer transition + solo + global blackout ALL in
  flight): → master **1.0**, masterFade **null**, blackout **false**, solo
  **cleared**, all overlays enabled, and **MISSION-CRITICAL: panic leaves
  OUTPUT NON-ZERO (rig LIT)**.
- panic-with-home → 200 mode `home`, rig LIT.
- panic-malformed-home (corrupt `home.yaml` on disk) → **400** with `rigLit:true`,
  blackout still cleared + master up, and **MISSION-CRITICAL: malformed-home
  panic STILL leaves the rig LIT**.

Teardown: engine killed, **port 31268 free**, `states/test_bench` +
`states/summer_camp_dome` + `config.yaml` restored byte-identical to the
pre-run snapshot (`diff -rq` clean). The test's own `home` snapshot is deleted
in a `finally` block. **No tracked residue from this run.** (Pre-existing
modifications under `states/summer_camp_dome/*` and
`simulation/scenes/summer_camp_dome/playlists/default.yaml` predate this wave —
they were present at branch checkout, were NOT touched by my test_bench run,
and are NOT included in my commit.)

## Exact new API surface (for the follow-on UI wave)

```
POST /mixer/channels/:id/duplicate
  body:    (none)
  200:     { status:'ok', channelId, sourceChannelId, pattern, playlist, playlistData }
  400:     deck id (WRONG_ROLE) | cap reached ("Maximum of N mixer channels allowed")
  404:     { error:"mixer channel '<id>' not found" }
  effect:  new overlay on TOP; inherits faderMax/color/mixGroupId/soloSafe/
           viewSelection/locks/transition prefs; fresh compiled handle.

POST /mixer/channels/reorder
  body:    { order: [channelId, ...] }   // permutation of current overlay ids; [0]=bottom, [last]=top
  200:     { status:'ok', order:[...] }  // echoes the applied order
  400:     { error, code:'REORDER_BAD_SET' }  // not array / wrong length / dup / unknown id
  note:    accepted mid-transition (no 409).

POST /mixer/panic
  body:    { home?: boolean }            // default true
  200:     { status:'ok', mode:'home', home:'home', rigLit:true }       // recalled the 'home' snapshot
       or  { status:'ok', mode:'safeDefault', rigLit:true }             // no home → safe LIT default
  400:     { error, code:'PANIC_HOME_MALFORMED'|'PANIC_HOME_RECALL_FAILED', rigLit:true }
           // broken/over-cap home snapshot — the ONE loud fallback; rig STILL lit.
  effect:  master→1.0 (fade cancelled), blackout cleared, deck-swap cancelled,
           all overlay transitions cancelled, solo cleared, groups un-muted,
           overlays enabled@1.0 (faderLocked + faderMax respected), view→mixer.
```
UI notes from the design doc: duplicate icon by trash (no ConfirmSheet,
non-destructive); reorder via up/down chevrons (NOT drag — draggable-flatlist
isn't vendored; "up = toward top of mix"); PANIC/HOME button in globalRigBar,
amber, WITH a ConfirmSheet (it cancels fades/transitions + clears blackout).
The "home" snapshot is just a normal mixer snapshot saved under the reserved
name `home` (`POST /mixer/snapshots {name:'home'}`).

## Codex P0 compliance
Additive; imports top-of-file; snake_case filenames; temp in `~/tmp/`.
Fail-loud everywhere with exactly ONE documented exception (panic's broken-home
loud-400-but-still-lit, mission-critical). Full intended subset shipped — no
deferrals on the engine side. Edited ONLY within the worktree.
