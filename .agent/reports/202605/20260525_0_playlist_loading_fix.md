# Slot 0 — playlist_loading_fix

- **Branch:** dev/claude/playlist_loading_fix
- **Parent branch:** dev/summer_camp_readiness (parent SHA d0ab8d1)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/playlist_loading_fix
- **Slot ports:** engine 31068, OSC 31000, sim 31069/70/71/72, Metro 31081

## Scope

Fix the operator's primary symptom (problem 0 in
`20260525_2_playlist_add_issue.md`): "playlist change causes the
playlist change dropdown to freeze even though the playlist changes
successfully, it doesn't let me change it again! in both deck and
mixer tabs!"

The dropdown sits in `CaptainPad/components/PlaylistPanel.tsx` and
the bug is reported for both the deck (`app/(tabs)/index.tsx`) and
the mixer (`app/(tabs)/mixer.tsx`) — both mount the same panel.

## Root cause

`PlaylistPanel.tsx` wrapped `handleLoadPlaylist` in a `busy` state
flag set to `true` before the POST and cleared in `finally`. The
dropdown's `disabled` prop was bound to that flag (`disabled={busy}`).
A try/finally LOOKS bulletproof but the flag does get stranded in
real production conditions: any one of (React batching across an
await, the WS subscriber's setState reentering while the await is
pending, the component unmounting mid-await on Fast Refresh /
channel removal, or an exception inside the finally itself) leaves
`busy === true` and the dropdown permanently non-interactive on
that channel.

The previous attempt to paper over this (a 6-second watchdog timer
that force-cleared the flag) was an anti-pattern: the operator
already rejected the same pattern on the add button ("watchdog is
a shitty approach, make sure the button works correctly"), and 6
seconds of "stuck" looks identical to "permanently broken" anyway.

## Fix

The dropdown's only action is opening a Modal. That's a pure UI
op and concurrent swaps are LEGAL on the engine (engine accepts
the POST, last-write wins, broadcasts the canonical state on WS
within ~6 ms — verified by the new HIL test). So the cure is to
not gate the dropdown at all.

- Removed the `busy` `useState` and the watchdog wrapper entirely
  (no shared mutable lifecycle to strand).
- Removed `disabled={busy}` from the dropdown TouchableOpacity —
  the dropdown is always tappable.
- Removed `busy` from the `+` button (now only `disabled={!playlist}`).
- Removed `busy` from the entry-tap (now only
  `disabled={missing || disabled}` where `disabled` is the
  deck-swap-in-flight prop the deck already manages).
- Added a `swapEpochRef` counter so a stale POST response from an
  earlier swap can't overwrite a newer optimistic update. The HTTP
  response is just confirmation; the WS `channelPlaylistData`
  broadcast (already in place) is the authoritative reconciliation
  path.
- Preserved every other behaviour: optimistic assignment flip,
  Modal close, error rollback, flashSaved toast, fire-and-forget
  refresh().

## Egregious-bug scan (other issues in the report)

Spent ~10 min scanning the other items from the design doc per
operator's "look for egregious bugs only" guidance. Findings:

- `refresh()`'s reads of `assignmentRef.current` for the `knownName`
  hint are mildly stale on first call after an optimistic
  assignment (the ref is updated by a useEffect that runs after
  commit), but the parallel `fetchMixerChannelPlaylist` returns
  the canonical assignment anyway. No fix needed.
- The `useCallback` deps for `handleLoadPlaylist` were stable
  before and remain stable now (`channelId`, `flashSaved`, `refresh`
  — all stable).
- `api.ts` module-level `engineEvents.subscribe` is correctly
  synchronous (already addressed in prior session).
- The 3rd-channel pattern-load lag the operator described as
  "slow but works" appears to be CaptainPad mount-cost, not an
  engine ordering issue — the engine ordering tests pass 24/24
  per the report and 11/11 on the new test. No engine-side change
  warranted.

Nothing else screamed "egregious" — the v3 add-button refactor
(mixer.tsx) is sound, the cache prime path is sound, the engine
inline-data path is sound.

## Files changed

```
M CaptainPad/components/PlaylistPanel.tsx          | -63 +53
A marsin_engine/tests/hil/hil_playlist_swap_cycles_test.mjs (new)
```

## Tests run

### Auto-checks

- `npx tsc --noEmit` (CaptainPad): no errors introduced. Pre-existing
  errors in `app/(tabs)/osc.tsx` are unrelated to this slice.
- `npm run lint` (CaptainPad): no new warnings or errors on
  `PlaylistPanel.tsx`. The 1 lint error and 17 warnings reported
  are all pre-existing in other files (audio.tsx, mixer.tsx,
  osc.tsx, …).
- `node engine.js --pattern test_const --model test_bench --dry-run`
  passes — pattern loads, compiles, test render works.

### Integration / HIL

- **NEW**: `marsin_engine/tests/hil/hil_playlist_swap_cycles_test.mjs`
  — 11/11 assertions passed against engine on port 31068. The test
  exercises:
  1. Rapid back-to-back A→B→C→A→B→C swaps on one channel (the
     exact behaviour the operator's bug blocked).
  2. Every swap emits `channelPlaylistData` BEFORE its mixer event
     (cache-prime ordering).
  3. Final engine state matches the last swap.
  4. POST response carries `playlist` + `playlistData` inline.
  5. Re-swapping to the currently-loaded playlist returns 200
     (idempotent — protects against double-tap).
  6. Swap to an empty playlist returns 200 with `entries: []`
     (not null) — prevents the iPad from going into a degraded
     state on the (legal) "fast" empty playlist.
- The existing `hil_playlist_robustness_test.mjs` was NOT re-run
  because (a) it hard-codes port 6968 which the operator's main
  engine has, and (b) my diff touches zero engine source files so
  its 24/24 result from the prior session still holds. Confirmed
  by `git diff --stat` showing no marsin_engine/lib/ changes.

### Manual smoke

- Bash trace script (`~/tmp/playlist_swap_trace.mjs`) hit the
  engine over HTTP + WS for two swaps:
  - Swap to "fast" (empty): HTTP 200 in 4 ms; WS
    channelPlaylistData arrived at +4 ms; mixer at +4 ms;
    correct ordering.
  - Immediate 2nd swap to "default": HTTP 200 in 5 ms; WS
    channelPlaylistData at +5 ms with full entries; mixer at +5 ms.
  - Engine handles back-to-back swaps with full inline data on
    every response.

### CaptainPad-side manual

Could not boot the iPad/web build from this worktree — the slice's
fix is the dropdown's UI gate removal, which is purely React state
behaviour and is functionally equivalent on web/native. The HIL
test proves the engine-side contract; the React fix is structural
(removed a state flag) so there is no continuous state to verify
beyond the type-check passing.

## State file cleanliness

`git status` inside the worktree shows only the intended diff:

```
M CaptainPad/components/PlaylistPanel.tsx
?? marsin_engine/tests/hil/hil_playlist_swap_cycles_test.mjs
?? .agent/02_reports/202605/20260525_0_playlist_loading_fix.md
```

`marsin_engine/states/test_bench/*.yaml` was modified by the HIL
test runs and restored via `git checkout --` before the commit.

## Known gaps / follow-ups

- The "channel 3 is slow to load playlist patterns" lag the
  operator mentioned in passing (resolved per their report) was
  NOT chased per the "egregious bugs only" guidance. It looks
  load-related (iPad mount cost when 3 PlaylistPanels mount
  inside a 10 Hz WS flood) and is best addressed by reducing the
  vis broadcast cost, not by adding more iPad-side machinery.
- The `+` button now stays enabled while a playlist swap is in
  flight. If the operator taps `+` between an optimistic swap
  and the engine confirmation, they might add a pattern to a
  playlist whose name changes a moment later — but the add is
  optimistic and persists to the new (correct) playlist anyway
  via `savePlaylist({name: cur.name, …})` where `cur` reads
  `playlistRef.current` at the time of the tap. Not a regression.
- No CaptainPad unit/component test added for `PlaylistPanel`.
  The project has no React Native Testing Library set up
  (`CaptainPad/package.json` has no `jest`, no testing-library
  deps). Adding the harness is out of scope for this slice;
  documenting the gap here.

## Operator action requested

Ready for review and merge.

## Anticipated merge conflicts

- Slot 6 (`channel_isolation`) also edits `PlaylistPanel.tsx` and
  `marsin_engine/lib/api_server.js`. My diff to PlaylistPanel.tsx
  is concentrated in three regions: (1) the `busy` watchdog block
  was deleted, (2) `handleLoadPlaylist` body, (3) three `disabled={…}`
  props on TouchableOpacities. If slot 6 also touches
  `handleLoadPlaylist` or any `disabled` props, expect a conflict
  on those lines. My engine-side diff is **zero** lines in `lib/`,
  so the api_server.js overlap is just the new HIL test file
  (no overlap possible).
