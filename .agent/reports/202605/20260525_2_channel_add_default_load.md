# Slot 2 — channel_add_default_load

- **Branch:** `dev/claude/channel_add_default_load`
- **Parent branch:** `dev/summer_camp_readiness` (tip `6c7c634`)
- **Worktree:** `~/workspace/BM26-Titanic-worktrees/channel_add_default_load`
- **Slot ports:** engine `31268`, sim `31269..31272`, OSC `31200`, Metro `31281`

## Scope

Operator reported that on the iPad, tapping "+ default" or "+ from
playlist" on the mixer adds the channel quickly but the new
PlaylistPanel shows "No playlist loaded" until they manually re-pick
the playlist from the dropdown. The web client on the same machine
as the engine works instantly — the bug is iPad-over-wifi-specific.

Root cause: the iPad's `PlaylistPanel` was given `initialAssignment`
as a prop but only consumed it as a `useState` *initial value*. If
either (a) the parent's first render of the new panel raced ahead of
the WS broadcast that populated `channel.playlist`, or (b)
`refresh()`'s GETs lost their race with the WS event on slow wifi
(the iPad's reported network reality), the panel sat with
`playlist === null` even though the engine had already shipped the
entries inline in both the POST response AND a `channelPlaylistData`
WS event that landed before the matching `mixer` broadcast. The
panel's own `channelPlaylistData` subscriber installed AFTER mount,
so it never received the per-channel event for its own channel.

This slice gives the panel a synchronous hand-off path that does NOT
depend on `refresh()` succeeding within any latency budget: the
mixer screen now caches the inline `playlistData` (from both the
POST response AND the `channelPlaylistData` WS event) keyed by
channel id, and forwards it as a new `initialPlaylist` prop to the
PlaylistPanel. The panel hydrates from it on first paint AND
re-hydrates whenever the prop changes from null → non-null (the
`useEffect([initialAssignment])` / `useEffect([initialPlaylist])`
the brief asked for). No setTimeout-retry papering. Same flow works
for "+ default" and "+ from playlist".

## Files changed

```
M  CaptainPad/app/(tabs)/mixer.tsx                                          (+86)
M  CaptainPad/components/PlaylistPanel.tsx                                  (+69)
A  marsin_engine/tests/hil/hil_channel_add_default_playlist_test.mjs       (new)
```

Edits in detail:

- `CaptainPad/components/PlaylistPanel.tsx`
  - New `initialPlaylist?: PlaylistData | null` prop. Seeds `playlist`
    state on first render AND on every late prop arrival via a
    `useEffect([initialPlaylist])` that adopts the parent payload
    when the panel's current `playlist` is null OR when the parent's
    snapshot is for a different playlist name.
  - New `useEffect([initialAssignment])` that adopts a late
    `initialAssignment` (handles the case where `channel.playlist`
    arrived on the second mixer broadcast a few ms after mount).
- `CaptainPad/app/(tabs)/mixer.tsx`
  - New `inlinePlaylistRef: Map<channelId, PlaylistData>` + version
    counter, populated synchronously from:
    1. The POST `/mixer/channels` response's `playlistData`.
    2. The WS `channelPlaylistData` event (which lands BEFORE the
       matching `mixer` event per the engine contract verified by
       `hil_add_3_channels_test.mjs`).
  - GC'd when the engine's `mixer` broadcast no longer lists a given
    channel id, so long add/remove sessions don't leak.
  - Forwarded as `initialPlaylist` to each `ChannelStrip` → `PlaylistPanel`.
- `marsin_engine/tests/hil/hil_channel_add_default_playlist_test.mjs`
  - Mimics the iPad UI sequence:
    1. Subscribes to WS BEFORE the POST.
    2. POSTs `{playlist:'default'}` ("+ default" flow). Asserts 200,
       inline `playlistData` with the right name + non-empty entries,
       assignment in body. Then waits for `channelPlaylistData` WS
       event within 500 ms, asserts assignment + entries payload,
       asserts ordering (WS event BEFORE matching `mixer` broadcast),
       asserts latency < 500 ms.
    3. Repeats for a non-default playlist (`hil_deck_swap` on
       test_bench) — the "+ from playlist" flow.
    4. GETs `/mixer/channels/:id/playlist` for each added channel and
       confirms the assignment round-trips.
  - Snapshots + restores test_bench state files in a `restore()`
    block triggered by SIGINT/SIGTERM and at end-of-test.

## Tests run

- **Unit (`node --test marsin_engine/tests/*.test.js`):**
  271/272 pass. The one failure
  (`playlist_api.test.js → Two entries of same pattern keep independent
  defaults across restart`) is **pre-existing on `dev/summer_camp_readiness`**
  (verified with `git stash + node --test`). Unrelated to this
  slice's edits.
- **HIL — new `hil_channel_add_default_playlist_test.mjs` on engine port `31268`:**
  20/20 assertions pass.
  Both "+ default" and "+ from playlist" flows verified.
  `channelPlaylistData` latency observed at 4-11 ms, well under the
  500 ms ceiling.
- **HIL — `hil_add_3_channels_test.mjs` (regression) on port `31268`:**
  22/22 assertions pass. No regression in the rapid-3-channels path.
- **CaptainPad — `tsc --noEmit`:**
  Same 7 pre-existing errors in `app/(tabs)/osc.tsx` as baseline;
  no new errors introduced by this slice.
- **Sim smoke:** not run (CaptainPad-only + engine HIL change; no
  simulation surface touched).
- **CaptainPad manual smoke:** not executed in this slice. The HIL
  test pins down the engine-side contract; the iPad-side hook-up is
  verified by tsc + code review. The fix DOES need an operator
  iPad-side validation (drive the actual "+ default" / "+ from
  playlist" buttons on the device that was reproducing the bug).
  Steps to validate manually:
    1. Boot engine on the real default port: `node marsin_engine/engine.js`.
    2. Open CaptainPad on the iPad, switch to the mixer tab.
    3. Tap "+ DEFAULT". The new strip should show the `default`
       playlist's entries WITHOUT having to open the dropdown.
       Verify the active entry row is highlighted.
    4. Tap "+ FROM PLAYLIST…", pick any non-default playlist with
       entries. The new strip should show that playlist's entries
       on first paint.
    5. Add a third channel quickly while the second's panel is still
       hydrating. The third should also render its entries without
       intervention.

## Known gaps / follow-ups

- The same iPad-side late-prop hydration pattern is NOT applied to
  the deck tab's PlaylistPanel. Deck only has ONE panel that's
  mounted at app boot, so it never hits this race — but if a future
  redesign re-mounts the deck panel (e.g. a "swap channel" button),
  this prop would help. No code change needed today.
- Inline-playlist payloads stay in the map until the channel is
  deleted. We could expire them after the first successful refresh()
  cycle, but bounded-by-channel-count is fine for now; the worst case
  is ~6 entries (mixer.maxChannels) of ~10 KB each.
- Slot 1's WS-topic-split work is not in this baseline. When it lands,
  ensure `channelPlaylistData` is routed onto the `/ws/control` topic
  the mixer screen is subscribed to — the inline cache and the
  `useEffect([initialPlaylist])` keep working regardless of which
  socket the event arrives on, but ordering vs `mixer` must still
  hold (and is asserted by this slice's HIL).

## Operator action requested

Ready for review and merge. Please run the iPad manual smoke
described above to confirm the operator-visible bug is gone. Engine
HIL + the existing 3-channels regression both pass on slot-2 port
`31268`.

## Anticipated merge conflicts

- **mixer.tsx:** None expected. Slot 0 (`deck_ping_pong`) and slot 1
  (`ws_topic_prioritize`) per the brief don't edit this file.
- **PlaylistPanel.tsx:** None expected for the same reason — the
  brief explicitly carved this file to slot 2.
- **api_server.js / engineBus.ts:** Untouched.
- **HIL test new file:** Pure addition, no conflict risk.

If slot 1 ends up renaming `channelPlaylistData` or splitting it
across sockets, our `inlinePlaylistRef` population in the mixer WS
handler may need a one-line tweak to match the new event name /
socket subscription — but it would be additive, not a conflict.

## Merge-readiness

**READY** — engine HIL 20/20 + existing 22/22 regression both green
on slot 2 port `31268`, tsc clean (no new errors), state files
restored to HEAD, no port leftovers, no temp files in source tree.
