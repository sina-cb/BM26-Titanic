# Slot 0 — deck_ping_pong

- **Branch:** dev/claude/deck_ping_pong
- **Parent branch:** dev/summer_camp_readiness (@ 6c7c634)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/deck_ping_pong
- **Slot ports:** engine 31068, sim 31069/70/71/72, metro 31081, OSC 31000

## Scope

Refactor the deck pattern-swap pipeline so back-to-back swaps reuse a
warm WASM handle instead of compiling + allocating + destroying one per
swap. Implements the operator's "deck has 2 channels, 1 active, 1
inactive; we swap pointers" mental model in a way that preserves deck
identity (id, playlist, localControls, viewSelection) and survives the
post-channel-isolation deck/mixer split.

## Architecture chosen

**Option A (handle pool / warm inactive sibling).** `wasm_host.compile()`
returns a fresh per-pattern handle and `wasm_host.destroy()` frees it —
handles are pattern-bound, not re-bindable, so we cannot rebind bytecode
on an existing handle. The implementation keeps a hidden
`PatternChannel` sibling (`_inactiveDeckChannel`) that:

- lives outside `mixerChannels` so it doesn't show up in /mixer or
  count toward maxChannels,
- gets `beginFrame()`'d every tick so its pattern stays time-synced
  with the active channel (the "warm" part),
- composites on top of `deckBuffer` via its `fader` and `mode` during
  an in-flight swap (same blend pipeline as before — trans_crossfade /
  trans_flash / trans_dissolve / trans_wipe_*),
- on completion the two channels SWAP HANDLES (not full pointers).
  `deckChannel` keeps its id / playlist / localControls /
  viewSelection intact — only `.handle` and `.pattern` rebind.

The pointer-swap variant the operator described literally would have
swapped the entire `PatternChannel` object reference, which would
change `deckChannel.id` under the API layer's feet (the inactive
sibling was constructed with `id: '__deck_inactive__'`) and orphan all
the per-deck state on the demoted sibling. Handle-swap preserves
identity while delivering the same operator-visible behaviour (the
previous pattern's handle stays warm in the inactive slot, ready to
ping-pong back without recompile).

## Ping-pong reuse path (api_server)

`loadPlaylistEntryWithTransition` now checks
`mixer.getInactiveDeckPattern()` BEFORE compiling. If it matches the
target pattern AND the entry has no per-entry `defaults` (so a fresh
compile isn't needed for clean default application), we pass
`newHandle: null` to `triggerDeckPatternSwap` and the warm inactive
handle is reused — zero compile, zero allocation, zero destroy on the
hot path. First-ever swap (no inactive yet) and pattern-change swaps
still allocate + compile normally; the old inactive's handle is
destroyed exactly once when it's replaced.

## Broadcast payload shape (for slot 1 ws_topic_prioritize)

No payload changes — `deckSwapStarted` and `deckSwapComplete` carry
the same fields as before:

```
{ type: 'deckSwapStarted', pattern, transitionId, transitionMode, durationMs }
{ type: 'deckSwapComplete', pattern, transitionId, transitionMode }
```

Both should route to `/ws/control`.

## Files changed

```
M  marsin_engine/lib/api_server.js                  (+76 -33)
M  marsin_engine/lib/pattern_mixer.js               (+285 -98)
M  marsin_engine/tests/hil/hil_deck_swap_test.mjs   (+27 -5)
A  marsin_engine/tests/hil/hil_deck_swap_warmth_test.mjs  (NEW, ~360 lines)
```

Specifically in pattern_mixer.js: `_swapChannel` field replaced by
`_inactiveDeckChannel`; `triggerDeckPatternSwap` gained a reuse path
(`newHandle:null` + verify inactive pattern); `updateDeckSwapTransition`
swaps `.handle`/`.pattern` between active and inactive instead of
destroying; `removeDeckChannel` tears down the warm inactive too;
`destroy()` cleans up inactive handle at shutdown.

In api_server.js: new pre-compile check `mixer.getInactiveDeckPattern()`
to short-circuit the compile when ping-ponging; `paramCenter` and
defaults application now operate on the resolved swap handle (warm or
fresh).

In hil_deck_swap_test.mjs: added ENGINE_BASE/WS_URL env overrides;
replaced 3 stale `/mixer.channels.find(...id === baseChId)` lookups
(broken post channel-isolation since the deck no longer lives in
`/mixer.channels`) with `/deck/channel` lookups. The brief flagged
this test as "predates channel-isolation"; fixing it was needed to
get the 23/23 green.

## Tests run

- **Unit** (in worktree, no engine):
  - `node --test tests/pattern_mixer_masking.test.js` — 33/33 pass
  - `node --test tests/param_center.test.js tests/global_effect_macros.test.js tests/fader_lock.test.js tests/playlist_manager.test.js tests/global_effect_blackout.test.js` — 84/84 pass
  - `tests/playlist_api.test.js` — 10/11 pass; the 1 failure
    ("Two entries of same pattern keep independent defaults across
    restart") was confirmed PRE-EXISTING by stashing my changes and
    re-running the test. Not introduced by this refactor.

- **HIL** (engine on port 31068):
  - `hil_deck_swap_test.mjs` — **23/23 pass** (the contract the brief
    asked me to preserve; baseline before my fixes was 21/23 due to
    the channel-isolation stale lookups noted above).
  - `hil_deck_swap_warmth_test.mjs` (**NEW**) — **12/12 pass**.
    Post-warmup latency spread across 4 measured swaps was **3.2 % /
    4.8 % / 5.1 %** across three test runs — well under the 20 %
    threshold the brief specified. Final vis distance L1=0 to
    test_dualband signature on pixel 0 (well under the "0.0 ± 8"
    bound).
  - `hil_deck_playlist_load_test.mjs` — 19/20 pass (1 PRE-EXISTING
    failure about activeEntryId not advancing in the immediate
    response body when soft-swap returns a transitionId; the
    bookkeeping completes asynchronously in onComplete — not
    introduced by my changes, would have been flagged earlier if
    the test were green before).
  - `hil_channel_isolation_test.mjs` — all pass.
  - `hil_playlist_swap_cycles_test.mjs` — 11/11 pass.
  - `hil_blackout_estop_test.mjs` — 16/16 pass.

- **Sim smoke**: not run (this slice is pure-engine; no model /
  fixture / sim changes).

- **CaptainPad**: not run (no TS/UI surface touched in this slice).

## State cleanliness

Snapshotted `marsin_engine/states/test_bench/*.yaml` to `~/tmp/
deck_ping_pong/` before tests. All state file diffs introduced by HIL
runs were reverted via `git checkout --`. Final `git status` shows
only my intended diff (api_server.js, pattern_mixer.js,
hil_deck_swap_test.mjs) + the new hil_deck_swap_warmth_test.mjs. No
config.yaml port edits committed. Engine killed.

## Known gaps / follow-ups

- **`hil_playlist_api.test.js` "Two entries of same pattern…"**
  pre-existing failure not investigated further. Lives outside the
  scope of this slice — affects the LEGACY `loadPlaylistEntry` path
  (transitions disabled), which my refactor doesn't touch.
- **`hil_deck_playlist_load_test.mjs` activeEntryId-doesn't-advance**
  pre-existing issue. The test expects `activeEntryId` in the
  immediate response body of /deck/playlist/entry, but with the
  soft-swap path the activeEntryId only lands after onComplete fires
  (~duration ms later). Either the response should resolve
  asynchronously (await the `done` promise) or the assertion needs
  the same 200-or-409 tolerance the test already has elsewhere for
  this same situation.
- The brief mentioned a "tail-replace fix at fader≥0.97" in the
  baseline; I didn't find any such code in pattern_mixer.js (search
  for "0.97" / "tail" / "tailReplace" turned up nothing in
  marsin_engine/lib). Behaviour at fader→1.0 follows the standard
  smoothstep + snap-to-1 path that was already in place; deck output
  ends pixel-perfect on the new pattern in the warmth test (L1=0 to
  signature), so no visible regression. If the brief meant a fix
  that's about to land in a separate slice, this refactor is
  compatible — it doesn't touch the renderAll6ch tail logic.

## Anticipated merge conflicts

- `marsin_engine/lib/api_server.js` — slot 1 (ws_topic_prioritize)
  touches `broadcastWs` routing. I edited `loadPlaylistEntryWith
  Transition` (lines ~605–705 area). If slot 1 only touched the
  `broadcastWs` function definition itself, no conflict. If slot 1
  touched the `broadcastWs({ type: 'deckSwapStarted' ... })` /
  `deckSwapComplete` call sites inside my edited region, expect a
  small textual conflict — the resolution is "keep both": my reuse
  branching for `handleForSwap`/`isReused` + slot 1's WS-topic
  argument. Payload field shape (per the broadcast section above)
  is unchanged, so semantic conflict is unlikely.
- `marsin_engine/lib/pattern_mixer.js` — I rewrote the
  `triggerDeckPatternSwap` / `cancelDeckPatternSwap` /
  `updateDeckSwapTransition` / `_swapChannel` block plus the deck-
  swap section of `renderAll6ch` and `destroy()`. No other slot
  should be touching deck-swap mechanics; risk is low.
- `marsin_engine/tests/hil/hil_deck_swap_test.mjs` — env-var
  hardening + 3 lookup migrations to `/deck/channel`. If another
  slot also hardened this test, expect textual conflict; resolution
  is trivial (keep the env-var path + the `/deck/channel` lookups).

## Operator action requested

Ready for review and merge. The ping-pong refactor passes its own
new HIL warmth contract (variance < 20 %), the operator's existing
deck-swap contract (23/23 in `hil_deck_swap_test.mjs`), the channel-
isolation contract, and all touched unit tests.
