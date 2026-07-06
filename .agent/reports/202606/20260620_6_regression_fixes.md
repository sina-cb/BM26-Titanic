# 2026-06-20 — Regression fixes (deck keep-lit + deck swap entry id)

**Agent:** developer (engine + CaptainPad) · **Slot 2** · engine port **31268**
**Branch:** `dev/regression_fixes` (local only) · **Commit:** `b6a8333`
**Scope (file ownership):** `marsin_engine/lib/api_server.js`,
`CaptainPad/components/PlaylistPanel.tsx`, plus two NEW test files.

Two regressions found by adversarial review of the merged campaign tip were
fixed and verified end-to-end.

---

## FIX A (P0 — mission critical): deck restore must never dark-start the exterior

### Problem
`restoreChannel(saved, 'deck')` had two failure outcomes that both left the
mission-critical exterior dark:
- saved deck pattern null/empty/missing-on-disk → `loadPattern` throws → caught
  and swallowed with a `console.warn` → **silent NULL DECK** (rig dark, engine
  reports "started").
- saved deck pattern loads but fails to compile → tagged `_deckRestoreFatal`,
  re-thrown → **BOOT CRASH** (rig dark, engine won't start).

### Fix
On ANY failure to restore the saved DECK channel, the engine now FALLS BACK to
the known-good default pattern (`opts.pattern`) and keeps the deck LIT. The
degrade is LOUD + VISIBLE, never silent:
- one-time `console.error` naming the failed pattern + reason + fallback target;
- a new `deckRestoreDegraded: { failedPattern, reason, fellBackTo }` field on
  `GET /status` (null on a clean boot).

Only if the DEFAULT pattern ALSO fails does boot throw fatally
(`_deckRestoreFatal`) — that means the install itself is broken. Mixer-overlay
behavior is unchanged (a dead overlay still degrades + warns; only the deck gets
the keep-lit fallback). The existing dangling-`activeEntryId` clearing is
preserved (moved into the shared `buildChannelFromSaved` helper).

### Implementation
- New exported pure helper `restoreDeckWithFallback(saved, defaultPattern, build)`
  in `api_server.js` — encapsulates the keep-lit decision, unit-testable without
  booting the engine (the only dependency is the injected `build` callback).
- `restoreChannel` refactored: shared `buildChannelFromSaved(saved, role, pattern)`
  does load+compile+install+playlist-defaults; the deck path wraps it in
  `restoreDeckWithFallback`, the mixer path keeps degrade-and-warn.
- `deckRestoreDegraded` closure var surfaced on `/status`.

---

## FIX B (P1): deck soft-swap UI pinned to OLD entry ~8s

### Problem
`POST /deck/playlist/swap` (and `/deck/playlist/entry`) returned
`baseCh.playlist` whose `activeEntryId` is still the OLD entry during a
transition (the new id is only written in the swap `onComplete` after the fade).
CaptainPad's `handleHotSwap` armed its pending-gate from that stale id, so the
panel suppressed reconcile until the ~8s watchdog fired.

### Fix
- Engine: added `targetEntryId` (resolved target entry id) to the
  `/deck/playlist/swap` and `/deck/playlist/entry` 200 bodies. Existing fields
  unchanged.
- CaptainPad `handleHotSwap`: in the deck role, arms `pendingActiveEntryIdRef`
  from `res.data.targetEntryId` when present, falling back to
  `playlist.activeEntryId` only for older engines. EBUSY/409 path + watchdog
  intact. (`handleEntryTap` already armed from the requested `entryId`, which is
  the resolved target — left as-is, and the engine now echoes it.)
- Misleading mixer SWAP copy fixed: the mixer swap is an INSTANT load (engine
  path is `loadPlaylistEntry`, no crossfade). Branched the ConfirmSheet message
  and the `SwapPlaylistModal` description on `role` — mixer now says
  "Switch…(no crossfade)", deck keeps "Crossfade…". `role` threaded into
  `SwapPlaylistModal` as a prop.

---

## Verification proof

All commands run from the worktree
`/root/workspace/BM26-Titanic-worktrees/regression_fixes`.

### Engine (`marsin_engine/`)
```
$ git diff --check -- marsin_engine            → DIFF-CHECK OK (clean)
$ node --check lib/api_server.js               → OK
$ node --check tests/deck_restore_safety.test.js              → OK
$ node --check tests/hil/hil_deck_swap_response_test.mjs      → OK
$ node engine.js --list                        → 60 pattern(s) found
$ node engine.js --pattern test_const --model test_bench --dry-run
      → EXIT=0, "Dry run complete. Pattern loads and compiles OK.",
        no missing-blend warning
$ node --test "tests/*.test.js"
      → # tests 829   # pass 829   # fail 0
        (baseline 823 + 6 new FIX-A unit cases = 829)
```

State hygiene: dry-run + unit suite touched `states/summer_camp_dome/*` and
(during the HIL/keep-lit boots) `states/test_bench/*` and the
`simulation/.../summer_camp_dome/playlists/default.yaml` — all restored via
`git checkout`; final `git diff --stat -- states` is EMPTY and the committed
tree contains only the 4 owned files. test_bench state snapshotted to
`~/tmp/state_snap/` before HIL.

### FIX B HIL (engine on :31268)
```
$ ENGINE_BASE=http://127.0.0.1:31268 node tests/hil/hil_deck_swap_response_test.mjs
  [TEST 1] transition-enabled /deck/playlist/swap
    ✓ swap returns 200
    ✓ response carries targetEntryId (got "b_one")
    ✓ targetEntryId resolves to PL_B first usable entry 'b_one'
    ✓ targetEntryId (b_one) DISTINCT from stale playlist.activeEntryId (a_one) mid-fade
    ✓ swap kicked off a transition (transitionId=deck_1_...)
  [TEST 2] explicit entryId → targetEntryId === 'b_two'   ✓ ✓
  [TEST 3] transition-enabled /deck/playlist/entry → targetEntryId === 'b_two'  ✓ ✓ ✓
  SUMMARY: 10/10 assertions passed   (exit 0)
```
The TEST-1 "DISTINCT" assertion is the proof of the bug surface and the fix:
mid-fade the stale `playlist.activeEntryId` was `a_one` while the resolved
`targetEntryId` is `b_one` — the gate must arm from the latter.

### FIX A end-to-end keep-lit demonstration
Pointed a COPY of `states/test_bench/deck_state.yaml` at a bogus pattern
(`this_pattern_does_not_exist_xyz`), booted the engine on :31268, then restored
the file from git (tracked state left pristine):
```
BOOTED (not crashed)
GET /status:
  "deckRestoreDegraded": {
    "failedPattern": "this_pattern_does_not_exist_xyz",
    "reason": "Pattern not found: patterns/this_pattern_does_not_exist_xyz.js",
    "fellBackTo": "test_const"
  }
GET /deck/channel:
  "channel": { "id":"ch_base_bogus", "pattern":"test_const", "enabled":true, ... }
      → deck is NOT null; it fell back to the default → exterior stays LIT
Boot log:
  [Restore] DECK RESTORE DEGRADED — saved deck pattern
  'this_pattern_does_not_exist_xyz' failed to restore (Pattern not found: ...).
  Falling back to default pattern 'test_const' to keep the mission-critical
  exterior LIT. This is a LOUD, VISIBLE degrade — see deckRestoreDegraded on /status.
```
On a clean boot `/status` shows `"deckRestoreDegraded": null`. Port freed after;
`git diff -- states` empty.

### FIX A unit test (`tests/deck_restore_safety.test.js`)
6/6 pass: (1) pattern=null → default, deck not null, degraded set; (1b) empty
string → same; (2) missing pattern → default + degraded; (2b) compile-fail →
default + degraded; (3) valid saved deck → restores normally, NO degraded flag;
(fatal) default also broken → throws `_deckRestoreFatal`.

### CaptainPad (`CaptainPad/`)
```
$ git diff --check -- CaptainPad   → DIFF-CHECK OK
$ npx tsc --noEmit                 → EXIT 0
$ npm run lint                     → ✖ 12 problems (0 errors, 12 warnings)
      = baseline; no new warnings (the PlaylistPanel.tsx:471 clearPending
        warning is pre-existing, not from this branch)
$ npm run web:build                → EXIT 0, Static routes (21), "Exported: dist"
```

---

## Notes / residue
- Both fixes shipped. No fallbacks were left silent — FIX A's deck fallback is a
  loud `console.error` + the visible `deckRestoreDegraded` `/status` flag.
- `dev/regression_fixes` is local only — not pushed.
- The engine writes runtime state into `states/test_bench/*` and the
  summer_camp_dome scene files during normal operation; these were restored and
  are NOT part of the commit (committed tree = the 4 owned files only).
