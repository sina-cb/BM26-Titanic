# Slot 5 — playlist_reorder

- **Branch:** dev/claude/playlist_reorder
- **Parent branch:** dev/summer_camp_final_push @ b775e49
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/playlist_reorder
- **Slot ports:** engine 31568, sim 31569, save 31570, sACN bridge 31571,
  sACN out 31572, OSC 31500, Metro 31581

## Scope

Operator request: re-sequence pattern entries inside a playlist
mid-session, on both the deck `PlaylistPanel` and the mixer per-channel
playlist UI, without restarting / hand-editing YAML. The currently-active
entry must keep playing — only the surrounding order changes.

## Drag vs. chevron decision

Went with **up/down chevrons** on each entry row. Rationale:

- `react-native-draggable-flatlist` (the standard) is not in
  `CaptainPad/package.json`. The brief explicitly says "DON'T add a new
  dependency for this unless the operator's UX explicitly requires drag."
- Chevrons reach the same end-state (any permutation reachable with N taps
  on an N-entry playlist) with zero dependency surface and zero
  gesture-conflict risk against the existing FlatList scroll +
  long-press param popovers.
- Tap targets are the half-row chevron tiles (~22pt tall each at compact
  size, ~26pt at full size) with `hitSlop` widening the active area. They
  sit immediately right of the index number — same column position on
  every row, easy to find without looking.
- Boundary chevrons render at 0.2 opacity + disabled to telegraph
  no-op-here without re-flowing layout.

## Files changed

```
M CaptainPad/components/PlaylistPanel.tsx
M CaptainPad/components/ui/icon-symbol.tsx
M marsin_engine/lib/api_server.js
M marsin_engine/tests/playlist_api.test.js
```

(Deck `index.tsx` and mixer `mixer.tsx` are unchanged — they already
render the same shared `PlaylistPanel` component, so the change collapses
to one place. Both surfaces inherit the reorder UI for free.)

## Engine endpoint changes

No new endpoints. `POST /playlists` already accepted the full entries
array in operator-defined order, and `playlistManager.save()` already
round-tripped per-entry id / defaults / modulations / notes. The reorder
flow is just "send the same entries with a permuted order."

One small addition inside the existing handler: after the save lands, the
engine walks `mixer.channels` and refreshes `channel.playlist.cursor` for
any channel pointing at the saved playlist, by finding the new index of
its `activeEntryId`. `activeEntryId` itself is **never** touched —
autopilot keys off id, not cursor (verified in
`marsin_engine/lib/api_server.js` Autopilot callback ~line 1474), and the
operator's currently-playing pattern keeps playing.

## Client changes

`PlaylistPanel.handleMoveEntry(entryId, direction)`:

- Splices the existing entry object (preserving `defaults`,
  `modulations`, `notes`, `label`) — no field-loss bug from a partial
  reconstruction.
- Optimistic: setPlaylist with the new order BEFORE awaiting the POST.
- On POST failure: rolls back to the prior order, surfaces the error,
  triggers refresh().
- Codex P0: out-of-range moves THROW (`from < 0`, `from === -1`,
  `to < 0`, `to >= length`). The chevrons hide at boundaries so this is
  a "should never happen" — fails loud if it does.
- 1-entry playlists are a no-op (returns early, no POST).

Rows expose the up/down chevrons only when `editable` (the panel isn't
`locked`). Boundary chevrons stay rendered at 0.2 opacity so the UI
doesn't reflow on every active-entry change.

## Quality gates

- `cd CaptainPad && npx tsc --noEmit` — pass (only the 2 pre-existing
  Modulation.tsx `transitionDuration` errors at baseline b775e49; 0 new).
- `cd CaptainPad && npm run lint` — pass (0 errors, 14 pre-existing
  warnings; 0 new in PlaylistPanel.tsx or icon-symbol.tsx).
- `cd CaptainPad && npm run web:build` — pass (21 static routes
  exported cleanly).
- `cd marsin_engine && node --test tests/playlist_manager.test.js` —
  13/13 pass.
- `cd marsin_engine && node --test tests/playlist_api.test.js` —
  13/13 pass, including 2 new tests:
  - `Reorder: POST /playlists with new entry order persists and
    preserves activeEntryId` (asserts disk order changed, activeEntryId
    unchanged, cursor moved 1 → 2).
  - `Reorder: 1-entry playlist accepts a same-order save (no-op
    semantics)`.

## Manual smoke (engine on slot 5 port 31568, test_const / test_bench)

1. Created `smoke_reorder` with `[e_one, e_two, e_three]`.
2. Loaded onto deck, activated `e_two` (cursor=1).
3. Reorder `[e_one, e_three, e_two]` (move e_two end-ward, idx 1→2):
   - Disk now lists `['e_one','e_three','e_two']`.
   - `GET /deck/playlist` → `activeEntryId='e_two'`, `cursor=2`. ✓
4. Reorder `[e_two, e_one, e_three]` (drag the ACTIVE entry to slot 0):
   - `activeEntryId='e_two'` (unchanged), `cursor=0`. ✓
5. Single-entry playlist save: returns 200 (no-op semantics). ✓
6. Killed + re-spawned engine on same port. Disk order
   `['e_two','e_one','e_three']` survived restart. ✓

(Operator-WIP state files dirtied by these smoke runs —
`marsin_engine/states/{summer_camp_dome,test_bench}/*.yaml` and
`simulation/scenes/summer_camp_dome/playlists/*` — were restored with
`git checkout --` before commit. `git status` is clean except for the
4 intended files.)

## Known gaps / follow-ups

- The mixer `mixer.tsx` lint warning at line 718 (missing
  `setInlinePlaylist` dep) is pre-existing and unrelated.
- The chevron-up/-down SF Symbol mapping was added to
  `components/ui/icon-symbol.tsx` (Material Icons fallback used on web
  / Android: `keyboard-arrow-up` / `keyboard-arrow-down`). iOS uses the
  native SF Symbol via `icon-symbol.ios.tsx` (no mapping needed there;
  `chevron.up` / `chevron.down` are SF Symbols).
- If the operator later asks for drag-to-reorder UX, swap the chevron
  column for `react-native-draggable-flatlist`. The
  `handleMoveEntry(entryId, direction)` helper is general enough that a
  drag completion handler can call it with a computed direction, or be
  replaced with an `(from, to)` variant — `savePlaylist` doesn't care
  how the new order was produced.
- Per-row drag-handle hold area isn't reachable when a row is the active
  one (highlight overlay) — chevrons remain tappable via their distinct
  hit zone, but if a future review wants brighter chevrons on the active
  row, the color tokens are at the IconSymbol `color=` prop and easy to
  retune.

## Operator action requested

Ready for review and merge.
