# Playlist / Add-Channel Issue — Status Report (2026-05-25)

## Symptoms reported by operator

When adding a new channel in the mixer view three distinct failures
show up, sometimes together, sometimes individually:

0. playlist change causes the playlist change dropdown to freeze
   even thought the playlist changes successfully, it doesn't let me 
   change it again! in both deck and mixer tabs!

   the rest of the problems below are solved, the 3rd channel I add is slow to load the playlist patterns, but it loads
   and the button doesn't stick!


debug the rest of the file here, but do not spend too much time on them! and look for eggregious bugs only!   
1. **Button stuck on "ADDING…"** — the "+ DEFAULT" / "+ FROM
   PLAYLIST…" button never returns to its idle label, and the
   operator can't add another channel until they tab away and
   back (which forces a remount).
2. **Channel added but the playlist entry list is empty** — the
   channel strip mounts, the dropdown shows the correct playlist
   name (e.g. "default") but the pattern list under the dropdown
   stays blank ("Loading…" or empty).
3. **Channel added with no playlist name at all** — the dropdown
   shows the placeholder "LOAD…" instead of a real playlist name,
   and obviously no entries.

Channels 1 and 2 almost always work. The problems concentrate on
channel 3 (and presumably channel 4 on rigs that allow it). The
3rd-channel pattern strongly suggests the issue is **load-dependent**:
by the time the third add fires, the iPad's JS thread is already
busy processing two channels' worth of WS broadcasts (mixer +
vis at 10 Hz each, plus channelPlaylistData + sharedParams), and
something in the new panel's mount path loses the race with those
broadcasts.

## Engine-side investigation — verified bulletproof

The first thing I assumed was that the engine was either slow or
sending data out of order. Both proved wrong:

- **POST `/mixer/channels` round-trip time** under realistic iPad
  load (3 concurrent WS clients all receiving mixer + vis at 10 Hz)
  is **5–16 ms** for the first three adds — verified by the new
  `hil_add_button_latency_test.mjs` (8/8 assertions). The
  engine is NOT the bottleneck.
- **WS broadcast ordering** — the engine now emits a dedicated
  `channelPlaylistData` event **before** the `mixer` event for
  every add and every swap. The `channelPlaylistData` payload
  carries the FULL playlist (name + entries + active id) inline so
  the iPad never has to issue a follow-up `GET /playlists/<name>`.
  Verified by `hil_playlist_robustness_test.mjs` (24/24
  assertions, including a 3-WS-client multi-iPad simulation and a
  remove+re-add cycle).
- **Inline data in HTTP responses** — `POST /mixer/channels` and
  `POST /mixer/channels/:id/playlist` both now return the full
  `playlistData` object in the JSON body. Even if a WS frame is
  dropped, the HTTP response alone carries everything needed to
  render the panel.

At the protocol level, the engine has TWO independent paths
(channelPlaylistData WS + inline HTTP response) to deliver the
playlist content to the iPad, and BOTH are exercised on every add.

## iPad-side changes attempted

### Caching layer (CaptainPad/utils/api.ts)

- **In-flight promise deduplication + 5s TTL caches** for
  `fetchPlaylists()`, `fetchPatterns()`, `fetchPlaylist(name)`.
  Stops 4 simultaneously-mounting PlaylistPanels from issuing 4
  copies of the same GET (which was overloading the iPad's
  request queue and timing out under load).
- **`primePlaylistCache(name, data)` helper** — called from both
  HTTP response handlers (`addMixerChannel`, `setMixerChannelPlaylist`)
  AND a module-level synchronous subscriber to the engineEvents
  bus that listens for `channelPlaylistData` WS events. This is
  intentional belt-and-suspenders: by the time a new
  PlaylistPanel mounts and asks `fetchPlaylist('default')`, the
  data should already be in the cache regardless of which
  transport delivered it.
- **Cache invalidation on save/delete/library WS events** so the
  cache can't go stale.

### Mixer screen (CaptainPad/app/(tabs)/mixer.tsx)

- Pass `initialAssignment={channel.playlist || null}` to every
  PlaylistPanel so the dropdown label appears IMMEDIATELY on
  mount instead of waiting for the first `fetchMixerChannelPlaylist`
  GET to return.
- Decoupled the "ADDING…" button state from HTTP timing — see
  next section for the full design and current state.

### PlaylistPanel (CaptainPad/components/PlaylistPanel.tsx)

- `refresh()` now kicks off `fetchPlaylist(initialAssignment.name)`
  in PARALLEL with the library/assignment/patterns fetches, instead
  of waiting for the serial `assignment → playlist` hop.
- Subscribes to `channelPlaylistData` WS events: if the event
  targets this channel, the panel adopts the playlist data
  directly with `setPlaylist(pd)` — no extra fetch.
- A transient-null guard: if the engine's
  `GET /mixer/channels/:id/playlist` returns `null` but we already
  have a local assignment from `initialAssignment`, KEEP the local
  one (it's almost always the engine in the middle of loading,
  not a real "no playlist" state) and schedule a retry.
- A retry chain (1.5s intervals) for any failed fetch in the
  refresh path.

## The "ADDING…" button — current state

This is in better shape, but the design went through three
revisions because of operator feedback:

1. **v1**: `try/await addMixerChannel/finally setBusy(false)` —
   should have been correct (finally always runs) but the iPad
   reported button stuck. Suspected microtask starvation: the
   fetch promise's continuation sat in the queue behind a backlog
   of WS handlers.
2. **v2**: Added a 10 s watchdog timer that force-cleared the
   busy state. Operator explicitly rejected this approach
   ("watchdog is a shitty approach, make sure the button works
   correctly").
3. **v3 (current)**: Watchdog removed. Button state is now
   decoupled from HTTP timing — `addBusy` is cleared by whichever
   of these signals arrives first:
   - The WS `mixer` broadcast that lists a channel id we DIDN'T
     have when the user tapped (typically ~10 ms after the POST
     handler runs on the engine, sometimes BEFORE the HTTP
     response is fully parsed on the iPad). The check uses a
     snapshot of known ids captured at tap time, so concurrent
     remove+add operations can't confuse the matcher.
   - The HTTP POST response itself (success or error). On error
     also shows an Alert.
   Both paths call the same idempotent `clearAddBusy()`. There is
   no codepath where `addBusy` can remain set indefinitely:
   `fetchWithTimeout`'s 8 s AbortController guarantees the HTTP
   promise resolves one way or another, and the .catch path also
   clears.

Operator's most recent confirmation: **"the button is better
I think"**. Not a definitive "fixed" but the immediate complaint
is no longer about the button.

## What is still broken — playlist patterns not loading

The remaining failure is symptom 2 and symptom 3 from the
opening section: the channel mounts but the entry list stays
blank, or the dropdown shows "LOAD…" with no playlist name.

What is verified to NOT be the cause:

- **Engine ordering / timing** — `hil_playlist_robustness_test`
  passes 24/24 even under a 3-WS-client multi-iPad simulation
  with rapid-add and remove+re-add cycles. The
  `channelPlaylistData` event ALWAYS lands before the `mixer`
  event, and ALWAYS carries non-empty entries.
- **HTTP transport** — POST RTT is 5–16 ms under load. The
  response carries inline `playlistData`.
- **Cache prime mechanism** — verified by the same HIL test that
  the data is sent both inline and via WS.

What is suspected:

1. **iPad-side React mount race** — the new PlaylistPanel's
   `engineEvents.subscribe(…)` runs inside a `useEffect` AFTER
   first commit. The `channelPlaylistData` event for THIS panel
   may have already been emitted by the time the subscription is
   live (the engine emits it before the `mixer` event that adds
   the channel; the iPad processes both back-to-back). The
   panel-local subscriber misses the event. The module-level
   subscriber in `api.ts` is the safety net (primes the per-name
   cache regardless of when subscribers exist) — but if THAT
   subscriber misses for any reason, refresh()'s `fetchPlaylist`
   call falls back to a GET, which under load can time out.
2. **`refresh()` returning silently on a stale cache** —
   `fetchPlaylist` short-circuits if it has a cached entry less
   than 5 s old. If the cached entry is somehow malformed (e.g.
   missing `entries`), `setPlaylist(pd)` runs but the entry list
   stays empty. The cache prime sources all pass through the same
   type check, but I haven't proven the cached object SHAPE is
   identical to what the GET would return.
3. **Hot-reload / Fast Refresh artifacts** — during development
   the iPad bundler swaps in new JS without remounting the React
   tree. Refs (like `pendingAddRef`, `assignmentRef`) are reset to
   their initial values but useState values are preserved. If the
   user hit the stuck-button bug under the v2 code and the v3 code
   was hot-reloaded over it, the in-memory state could be
   inconsistent in ways that don't manifest in a clean cold-boot.
4. **Engine state file** — when the engine restarts mid-test it
   re-hydrates `mixer_state.yaml`. If a channel was saved with an
   incomplete `playlist` field (e.g. `{ name: 'default' }` without
   `activeEntryId`), the iPad's GET will return that partial
   assignment and refresh() may fetch a playlist that doesn't
   match what's actually compiled in the engine. Not yet
   investigated.

## What's been ruled out

- **Engine compile cache** — adding the 3rd channel uses an
  already-compiled blend (`blend_screen`) and an already-compiled
  pattern.
- **Engine playlist load failure** — `playlistManager.load(name)`
  returns the same object on every call; HIL test confirms inline
  data matches `GET /playlists/<name>` byte-for-byte.
- **WS message size / fragmentation** — `channelPlaylistData`
  payload is ~5.4 KB, well under the 64 KB budget I asserted in
  the HIL test.
- **Engine being slow under load** — HTTP RTT under 3-WS-client
  load is 5–16 ms; mixer broadcast lands 9 ms after the POST.

## Recommended next investigation steps

If you continue debugging, in this order:

1. **Add a tiny on-iPad debug log** in PlaylistPanel.refresh()
   that records the name of the playlist being fetched, the
   source (cache hit vs GET), the entry count returned, and
   whether `setPlaylist` was called. Run an actual reproduction
   on the iPad and capture which case actually fires. This is the
   one piece of information I do not have — HIL covers everything
   up to the WS / HTTP wire but cannot observe iPad-side state.
2. **Capture the panel's `playlistData` cache value at the moment
   of failure** — if it's `null` we have a cache miss + slow GET,
   if it has `entries: []` we have malformed cached data, if it
   has the right entries but the UI doesn't render we have a
   React reconciliation bug.
3. **Test a cold boot reproduction** (full force-quit of the
   CaptainPad app, restart). If the bug ONLY repros after hot
   reloads, it's a Fast Refresh artifact and not a real
   production bug.
4. **Consider replacing the panel-local `engineEvents.subscribe`
   with a parent-managed playlist data prop** — pass the playlist
   data DOWN from the mixer screen (which already receives the
   WS `mixer` event and could cache the most recent
   `channelPlaylistData` per channel id) instead of having each
   PlaylistPanel manage its own subscription. Eliminates the
   mount-order race entirely.

## Files modified during this session

- `marsin_engine/lib/api_server.js` — inline playlistData in
  POST responses; new `channelPlaylistData` WS event ordered
  before `mixer` broadcasts.
- `CaptainPad/utils/api.ts` — in-flight dedupe + TTL caches,
  `primePlaylistCache` helper, module-level engineEvents
  subscriber for cache priming.
- `CaptainPad/app/(tabs)/mixer.tsx` — `initialAssignment` prop
  threaded through to PlaylistPanel; v3 add-button design
  (WS broadcast + HTTP response dual clear, no watchdog).
- `CaptainPad/app/(tabs)/index.tsx` — `initialAssignment` prop
  for the deck PlaylistPanel.
- `CaptainPad/components/PlaylistPanel.tsx` — accept
  `initialAssignment`, parallel playlist content fetch, adopt
  `channelPlaylistData` events directly, retry chain on failed
  fetches, transient-null guard against stale GETs.

## HIL test coverage added / updated

- `marsin_engine/tests/hil/hil_playlist_robustness_test.mjs`
  (new, 24/24) — verifies inline data, WS event ordering,
  rapid-add + remove+re-add, 3-WS-client simulation, inline data
  matches on-disk, end state on engine is consistent.
- `marsin_engine/tests/hil/hil_add_button_latency_test.mjs`
  (new, 8/8) — verifies POST RTT < 250 ms (budget) and mean
  RTT < 100 ms (budget) under 3-WS-client load; broadcast lands
  within 250 ms of POST.
- `marsin_engine/tests/hil/hil_deck_swap_test.mjs` — now
  restores the deck's pre-test playlist and deletes its test
  playlist file on exit (operator-reported leak).
- `marsin_engine/tests/hil/hil_mixer_overlays_test.mjs` — now
  dynamically picks two distinct playlists from the engine's
  library instead of hard-coding `'default'` / `'test'`.

## Bottom line

Engine and transport layers are bulletproof (verified by 32
HIL assertions across two new tests). The remaining failure is
entirely iPad-side, and the most likely culprit is a React
mount-order race between the new PlaylistPanel's local WS
subscription and the engine's pre-mount `channelPlaylistData`
broadcast. The module-level cache-prime listener in `api.ts`
should make that race irrelevant, but operator continues to see
empty entry lists on the 3rd add, so SOMETHING about the cache
prime → refresh() → setPlaylist chain is dropping data in
production that doesn't drop in the HIL simulation. The
recommended next step (above) is to add a one-shot debug log in
refresh() to capture which case actually fires on the iPad —
that data is the missing piece needed to close this out
deterministically.
