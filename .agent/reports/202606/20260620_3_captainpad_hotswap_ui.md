# 20260620_3 — CaptainPad Hot-Swap Playlist UI

**Branch**: `dev/captainpad_hotswap_ui` (worktree
`/root/workspace/BM26-Titanic-worktrees/captainpad_hotswap_ui`, slot 1)
**Base**: merged tip `37f4505` (engine hot-swap endpoints + prior CaptainPad
QoL refactor: ConfirmSheet, useEngineConnection, typed fetchMixerState).
**Author**: developer sub-agent (Game of Life multi-agent workflow).
**Supports**: `feat/timeline_support`.

## What shipped

A HOT SWAP affordance on the shared `PlaylistPanel` that lets the operator
crossfade a channel onto a DIFFERENT playlist (riding the engine's existing
deck/mixer transition machinery), distinct from the LOAD dropdown (plain
assignment) and the per-entry tap (advance within the current playlist).

Both consumers get it for free with NO edits to `mixer.tsx` / `index.tsx` —
the affordance is fully internal to `PlaylistPanel`, so file ownership stayed
at the two core files plus this report.

### 1. `utils/api.ts` — client fns (+92 lines, additive)
- `swapDeckPlaylist(name, entryId?)` → `POST /deck/playlist/swap`.
- `swapMixerChannelPlaylist(channelId, name, entryId?)` →
  `POST /mixer/channels/:id/playlist/swap`.
- `swapChannelPlaylist(role, channelId, name, entryId?)` — polymorphic
  dispatcher, mirroring `setChannelPlaylist` / `setChannelPlaylistEntry`.
- Fail-loud, no silent fallback (Codex P0): non-2xx surfaces the engine's
  `error` string and a `code` marker (`EBUSY` for 409), matching the
  established `setChannelPlaylistEntry` result shape `ApiResult<any> & { code? }`.
- On success invalidates the per-name (`invalidatePlaylistCache(name)`) and
  global (`invalidatePlaylistsCache()`) playlist caches — same pattern the
  neighbouring `savePlaylist` uses — so the next fetch re-converges.

### 2. `components/PlaylistPanel.tsx` — UI (+217 lines, additive)
- New `shuffle`-glyph **SWAP** button in Row 2 (beside the LOAD dropdown,
  before the folder/+ buttons). Opens a `SwapPlaylistModal`.
- `SwapPlaylistModal`: lists the shared library, filters out the current
  playlist (shown greyed as `▶ name (current)`), 12pt vertical padding +
  hitSlop ⇒ ≥44pt rows. Picking arms a `ConfirmSheet`.
- `ConfirmSheet` (reused) with `confirmLabel="HOT SWAP"` confirms before the
  crossfade fires — a whole-channel crossfade is a deliberate show action.
- `handleHotSwap(name)`: gated by `disabled` (deck soft-swap-in-flight lock —
  same gate `handleEntryTap` respects) AND an internal `swapInFlight`
  re-entrancy guard; 409/EBUSY swallowed silently like the entry-tap path,
  everything else `Alert.alert`ed. On success arms the existing
  mid-transition pending-gate (`pendingActiveEntryIdRef` + watchdog) with the
  engine-reported target entry, flashes ✓ SAVED, and lets the WS broadcast
  reconcile (no optimistic flip — the deck reports the prior entry until the
  crossfade completes).
- Visibility mirrors the +/folder buttons: hidden when `locked` (read-only
  show mode) or when the deck playlist-edits lock is engaged.

## Verification proof

Run from `worktree/CaptainPad`.

- `git -C <worktree> diff --check -- CaptainPad` → clean (`=== diff --check OK ===`, no whitespace errors).
- `npx tsc --noEmit` → **exit 0** (no output).
- `npm run lint` → **exit 0**, **12 warnings, 0 errors** — exactly the
  documented baseline, NO new warnings. All 12 are pre-existing
  `react-hooks/exhaustive-deps` / `no-unused-vars` in config/mixer/monitor/
  studio/AllModulationsPanel/GlobalEffectMacros/NauticalFader/PlaylistPanel
  (line 471, `clearPending` in `refresh` — pre-existing, not my code)/
  ScheduledTaskRow/HorizontalFader/TimerWheel.
- `npm run web:build` → **exit 0**, 1 web bundle (2.24 MB) + **21 static
  routes** exported to `dist`. The `ECONNREFUSED 127.0.0.1:6968` line is the
  documented env artifact (no engine running during a build), not a failure.

### Structural assertions (no headless screenshot — see note)
No image: this worktree is a CaptainPad-only slot with no sim/engine running
and the auto-check bar is tsc/lint/web:build, not the puppeteer renderer
(`00_see_the_world.md` drives the Three.js sim, not the Expo web client).
Precise wiring instead:

- **SWAP button** → `TouchableOpacity onPress={() => setShowSwap(true)}`,
  `disabled={disabled || swapInFlight}`, in Row 2 of `PlaylistPanel`'s
  return (the `flexDirection:'row'` control row holding the LOAD dropdown).
  Rendered under `editable && !(role === 'deck' && playlistEditsLocked)`.
- **SwapPlaylistModal** `onPick` → `setShowSwap(false); setSwapPrompt(name)`.
- **ConfirmSheet** `visible={!!swapPrompt}`, `onConfirm` →
  `handleHotSwap(name)`.
- **handleHotSwap** → `swapChannelPlaylist(role, channelId, name)` →
  `swapDeckPlaylist` (deck) or `swapMixerChannelPlaylist` (mixer).
- **Deck endpoint**: `index.tsx` passes `role="deck"` + `disabled={deckSwapInFlight}`
  → SWAP button greys (opacity 0.4) and no-ops mid-crossfade, mirroring the
  entry-tap lock the engine also enforces with 409.
- **Mixer endpoint**: `mixer.tsx` uses default `role="mixer"`, no `disabled`
  (overlay swaps are instant); SWAP routes to
  `POST /mixer/channels/:id/playlist/swap`.

## Known gaps
None. Both deck and mixer swap paths shipped. The engine `entryId?` param is
plumbed through every api fn but the UI currently always swaps to the
playlist's first usable entry (engine default) — a future "swap to specific
entry" picker can pass `entryId` without an api change.

## Notes
- Icon: SF-symbol `arrow.triangle.2.circlepath` is NOT in `icon-symbol.tsx`'s
  MAPPING (and that file is outside this slot's ownership), so the SWAP
  affordance uses the already-mapped `shuffle` glyph. Reads as "swap to a
  different set" and avoids reusing `arrow.clockwise` (the reconnect icon).
- No engine / timeline / other CaptainPad files touched. `node_modules` is
  the pre-provided symlink — not staged, not committed.
