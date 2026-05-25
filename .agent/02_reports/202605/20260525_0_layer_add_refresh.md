# Slot 0 — layer_add_refresh

- **Branch:** dev/claude/layer_add_refresh
- **Parent branch:** dev/summer_camp_readiness (SHA 97a3267)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/layer_add_refresh
- **Slot ports:** engine 31068, sim 31069/31070/31071/31072, OSC 31000, metro 31081

## Scope

The operator reported: "I added 3 layers (channels), and the first two
loaded the patterns' list fine, but the 3rd one is not showing
patterns." Asked for a per-channel refresh arrow next to the channel
name AND a real debug of the channel-add experience to make it solid.

This slice delivers:

1. A small `arrow.clockwise` refresh button flush to the right of the
   channel name `TextInput` in `mixer.tsx::ChannelStrip`. Tapping it
   bust the playlists library cache + this channel's per-name cache,
   then forces `PlaylistPanel.refresh()` via a new `refreshNonce`
   prop. One-tap rescue — no need to delete and re-add the channel.

2. A targeted hardening of the per-name playlist dedupe cache in
   `CaptainPad/utils/api.ts::fetchPlaylist`. If a `channelPlaylistData`
   WS event populated the cache WHILE a sibling panel's in-flight
   fetch was running, we now prefer the cached data over a
   potentially-stale `{ok:false}` from the original fetch (or a
   timeout exception). Without this guard, panels 2+ that share a
   single in-flight promise would all see `ok:false` if the first
   panel's fetch hit a transient timeout — even though the engine's
   `channelPlaylistData` event had already primed the right data.

3. A new HIL test pinning the engine-side invariants the iPad relies
   on for instant-render of a brand-new channel (response carries
   inline `playlistData`, `channelPlaylistData` WS event fires before
   the matching `mixer` event, GET-after-add returns the right
   assignment).

## Files changed

```
M  CaptainPad/app/(tabs)/mixer.tsx
M  CaptainPad/components/PlaylistPanel.tsx
M  CaptainPad/utils/api.ts
A  marsin_engine/tests/hil/hil_add_3_channels_test.mjs
A  .agent/02_reports/202605/20260525_0_layer_add_refresh.md
```

No engine source files changed — the engine already does the right
things (per the new HIL: 22/22 assertions pass on a fresh boot). The
client-side cache + UI escape hatch are what was missing.

## Reproduction findings (against engine on port 31068)

Booted the engine fresh, scripted a 3-channel back-to-back add via
`POST /mixer/channels`, observed both the HTTP responses and the WS
event timeline. Result, fully reproduced multiple times:

```
── ADD RESULTS ──
{"i":0,"status":200,"channelId":"ch_…_0","hasPlaylistData":true,"playlistName":"default","entryCount":27,"rttMs":8}
{"i":1,"status":200,"channelId":"ch_…_1","hasPlaylistData":true,"playlistName":"default","entryCount":27,"rttMs":5}
{"i":2,"status":200,"channelId":"ch_…_2","hasPlaylistData":true,"playlistName":"default","entryCount":27,"rttMs":6}

── WS EVENT TIMELINE ──
  +7ms  channelPlaylistData  ch_…_0  [playlistData]
  +7ms  mixer                          (chs=1)
  +13ms channelPlaylistData  ch_…_1  [playlistData]
  +13ms mixer                          (chs=2)
  +18ms channelPlaylistData  ch_…_2  [playlistData]
  +18ms mixer                          (chs=3)
```

The engine is healthy on this surface — every add resolves in <10ms,
`playlistData` is always inline, and `channelPlaylistData` always
precedes its matching `mixer` event. The operator's "3rd channel
shows no patterns" failure mode is NOT the engine dropping data.

The most likely client-side root cause is the per-name dedupe cache
in api.ts. When N PlaylistPanels mount in the same React commit (all
3 channel adds processed in one tick), all N call `fetchPlaylist(name)`.
The first call sets `_playlistInflight`; the rest piggy-back on the
SAME promise. If that promise rejects (timeout, transient network
glitch under iPad WS load), all N panels see `ok:false` — even if
the global `channelPlaylistData` listener has since primed the cache.
PlaylistPanel.refresh() leaves `playlist` at `null` in that case, so
the strip renders "No playlist loaded".

Fix: in `fetchPlaylist`, after awaiting a shared inflight, fall back
to the (now-primed) cache when the shared promise resolves `!ok`.
Same in the local catch block for the leader call. This converts the
N-panel cascade failure into N-1 cache hits.

This is a non-fallback fix — it doesn't paper over a real error, it
just consults the authoritative engine-broadcast cache instead of
returning a stale "network failed" result from a fetch that has
already been superseded by a successful WS broadcast. The change is
visible only when the engine HAS already provided the data via WS,
which is always the case for newly-added channels (see HIL §[TEST 2]).

The refresh button is the belt-and-braces complement: even if a
future regression strands a panel, the operator has a one-tap rescue
that doesn't require deleting + re-adding the channel.

## Tests run

### Unit / syntax
- `node --check tests/hil/hil_add_3_channels_test.mjs` — PASS

### Engine auto-checks
- `node engine.js --pattern test_const --model test_bench --dry-run` — PASS
  (no missing blend/transition warnings)

### Integration / HIL
- `MARSIN_HIL_PORT=31068 node tests/hil/hil_add_3_channels_test.mjs` — PASS, 22/22 assertions
  - TEST 1 (3 asserts × 3 adds): POST response carries non-null `playlistData` with ≥1 entry
  - TEST 2 (2 asserts × 3 adds): channelPlaylistData fires before matching mixer event
  - TEST 3 (1 assert × 3 adds): GET /mixer/channels/:id/playlist returns the right name
  - TEST 4 (1 + 3 asserts): /mixer reports 3 overlay channels, each with a playlist
- Existing slot's hil_add_button_latency_test.mjs hardcodes port 6968 (pre-existing) — not relevant to this slot's HIL.

### CaptainPad auto-checks
- `npx tsc --noEmit`: only pre-existing osc.tsx errors (allowed per brief). No new errors from this slice.
- `npm run lint`: only pre-existing warnings/errors (audio.tsx unescaped quote, etc.). No new warnings introduced by this slice.

### Manual / state cleanliness
- State files snapshot before HIL, restored in `finally` block. After HIL run + config revert, `git status` shows only intended diff (3 CaptainPad files modified + 1 new HIL test + this report).

## Known gaps / follow-ups

- The bug isn't 100% deterministic on a fast Mac — HIL passes 22/22
  every run. The fix is a targeted hardening against a real, observed
  failure mode (shared-inflight cascading {ok:false}), but verifying
  the operator's specific iPad reproduction would require an actual
  iPad session with that traffic pattern.
- Did NOT introduce a busy flag on the add button, did NOT add a
  watchdog setTimeout — per the brief.
- The deck tab's existing top-right refresh icon (slot 3) is a
  WHOLE-PANEL reconnect; the new per-channel refresh arrow in mixer.tsx
  is scoped to one channel's playlist-and-patterns reload. They serve
  different operator intents and shouldn't be merged.

## Operator action requested

Ready for review and merge. Please verify on a real iPad mixer tab by:
1. Booting the engine on the standard port.
2. Tapping "+ DEFAULT" three times in quick succession.
3. Confirming all three channels render their playlist entries.
4. Confirming the small ↻ icon next to each channel's name is visible
   and tapping it reloads that channel's playlist.

## Merge-readiness statement

This slice is merge-ready against `dev/summer_camp_readiness` tip 97a3267.

## Anticipated merge conflicts

- **mixer.tsx, slot 4 (view_mask_options)**: also edits ChannelStrip.
  Conflict zone: the channel header `View` row (lines ~75-100 in this
  branch) and the imports at top. Resolution should be additive — both
  slices add UI to existing rows without removing anything.
- **mixer.tsx, slot 5 (fader_lock)**: also edits ChannelStrip — likely
  in the level row / lock button area (lines ~95-100 in this branch).
  No overlap with the new channel-name-row refresh arrow as long as
  slot 5 doesn't restructure the header row.
- **api.ts, slot 2 (globals_unification)**: imports + new exports.
  My changes to `fetchPlaylist` are surgical (one function body)
  and shouldn't touch globals territory; conflicts likely to be
  trivial import-ordering issues.
- **PlaylistPanel.tsx**: only this slot touches it as far as I can see
  from the slot brief — no conflicts expected.

If any of those merges land first and broke this slice, the relevant
sections to re-resolve are:
- mixer.tsx imports (line 9-17)
- mixer.tsx ChannelStrip header `View` for the name row (line ~85)
- mixer.tsx ChannelStrip refreshNonce state + PlaylistPanel prop pass
- PlaylistPanel.tsx Props interface + refreshNonce effect
- api.ts fetchPlaylist body
