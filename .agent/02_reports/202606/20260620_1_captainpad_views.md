# 2026-06-20 · CaptainPad Deck/Mixer Views — safety, perf, refactor, type-safety

**Agent role:** developer (CaptainPad / iPad control surface)
**Branch:** `dev/captainpad_views` (worktree, slot 1) — committed, **not** pushed/merged.
**Commit:** `4410885 feat(captainpad): production-console safety, viz perf, shared engine-connection hook`

## Scope delivered (priority order)

All four scoped items shipped. Hot-swap-playlist UI deliberately NOT added
(out of scope this wave — depends on an unlanded engine endpoint).

### 1. Production-console safety (P0)
- **New `components/ui/ConfirmSheet.tsx`** — reusable destructive-action
  confirmation. In-app `Modal` (NOT `Alert.alert`, because RN-web drops Alert
  button callbacks on the podium web client — same reason PlaylistPanel's own
  name modal is in-app). Backdrop-tap = cancel; inner wrapper swallows taps.
  Confirm/cancel buttons are 44pt. Invokes `onConfirm` verbatim — no swallowed
  or substituted action (codex P0).
- **mixer.tsx — delete channel** now ARMS `ConfirmSheet` (`deletePrompt` state)
  instead of calling `removeMixerChannel` on a single tap. `confirmDeleteChannel`
  runs the delete only on explicit confirm.
- **PlaylistPanel.tsx — remove entry** the `(−)` button now ARMS `ConfirmSheet`
  (`removePrompt` state) via `requestRemoveEntry`; `performRemoveEntry`
  (formerly `handleRemoveEntry`) runs only after `confirmRemoveEntry`.

### 2. Touch targets (>= 44pt)
- **mixer.tsx** — added module-level `ICON_BTN_HIT_SLOP = {8,8,8,8}` and applied
  it to the four 28×28 title-bar icon buttons (refresh, lock, pin, delete) →
  effective hit area 28+8+8 = **44×44**. Visual chrome unchanged. Also added
  `hitSlop {10,10,6,6}` to the blend-mode dropdown and `accessibilityRole`s.
- **index.tsx** — the `◎ ALL` pill: added `hitSlop {12,12,10,10}` + `minHeight:44`
  + `minWidth:44` + centered content; kept compact visual padding.
- **PlaylistPanel.tsx** — the per-row remove `(−)` button: added
  `hitSlop {10,10,10,10}` + `accessibilityRole="button"`.

### 3. De-duplicated connection/boot logic
- **New `hooks/useEngineConnection.ts`** — owns the shared dance both screens
  replicated: resolve API base, `testConnection` probe (→ `onStatus`), nudge the
  singleton WS buses to reconnect **only when down**, run a screen-supplied
  `seed`, re-seed on AppState `active`, and own the control/status (+ optional
  viz) subscribe/teardown lifecycle. Callbacks routed through a ref so the
  subscription stays stable for the screen's lifetime (matches prior
  subscribe-once behavior).
- **index.tsx (deck)** and **mixer.tsx** both refactored to consume it via
  `seed` / `onControl` / `onStatus` (deck also `onViz`). Hand-rolled
  `subscribeBuses` / `loadAll` / `connectToEngine` + the boot `useEffect` +
  AppState wiring removed from both. Deck keeps its single master `PixelStrip`
  on the screen-level viz path (one strip, no list to reconcile — unchanged on
  purpose).

### 4. Type safety
- **utils/api.ts** — `fetchMixerState` now returns `ApiResult<MixerState>` (new
  exported `MixerState` / `MixerChannel` interfaces) and **hard-fails on non-2xx
  and on malformed bodies** (`{master:number, channels:[]}` validated) instead
  of the old `ApiResult<any>` that returned `ok:true` with whatever JSON came
  back (an engine `{error}` payload would have been read as `data.master` →
  NaN%, empty rig). Codex P0: fail loud, no silent fallback. Verified the other
  caller (`hooks/useEngineState.ts`, not owned) already gates on `!r.ok` so the
  stricter contract is safe there.
- **mixer.tsx** — null-coalesced `channel.fader` reads for **display only**
  (`channel.fader ?? 0`) so a broadcast omitting fader shows an empty fader, not
  the literal text `NaN`.

### Perf (viz isolation) — the heart of item 2
- **New `components/ChannelVizStrip.tsx`** — each strip (and the mixer master
  strip) self-subscribes to `engineVizEvents`, holding ONLY its own channel's
  base64 frame in local state, with the 5 Hz redraw cap preserved per-strip.
- **mixer.tsx** — removed the screen-level `visDataRef` + `setVisVersion` +
  `lastVisUpdateRef` + the screen viz subscription. Dropped the per-tick
  `visData` prop from `<ChannelStrip>`. Result: a viz frame no longer triggers a
  `MixerScreen` re-render at all, so it never re-maps the channel array and never
  reconciles the strip list — and `ChannelStrip`'s `React.memo` now holds (its
  only changing prop is `channel`, which moves on mixer broadcasts, not viz).

## Files
Owned/modified: `app/(tabs)/index.tsx`, `app/(tabs)/mixer.tsx`,
`components/PlaylistPanel.tsx`, `utils/api.ts`.
New: `components/ui/ConfirmSheet.tsx`, `components/ChannelVizStrip.tsx`,
`hooks/useEngineConnection.ts`.
`app/(tabs)/_layout.tsx` — inspected, no change needed for this scope.
Casing: PascalCase for components (`ConfirmSheet`, `ChannelVizStrip`), camelCase
for the hook (`useEngineConnection`) — matches existing neighbors.

## Verification proof

Run from the worktree `CaptainPad/`:

```
git -C <worktree> diff --check -- CaptainPad   → exit 0 (no whitespace errors)
npx tsc --noEmit                               → exit 0 (baseline 0, held)
npm run lint                                   → ✖ 12 problems (0 errors, 12 warnings)
npm run web:build                              → exit 0, "Exported: dist", 21 static routes
```

- **tsc:** baseline exit 0 → after changes exit 0. No new errors.
- **lint:** baseline = 0 errors / 12 warnings. After changes = **0 errors / 12
  warnings — identical count, no new warnings/errors.** The two mixer.tsx
  warnings (`738:6` missing dep `setInlinePlaylist`; `920:15` unused `fader` in
  `handleSoloToggle`) are pre-existing (were `730:6` / `914:15` before my lines
  shifted them); not introduced by this work and not in code I rewrote.
- **web:build:** succeeded, exported `dist`, all routes incl. `/(tabs)/mixer`
  (50 kB) and `/(tabs)` index (74.5 kB) bundled. A static-prerender
  `ECONNREFUSED 127.0.0.1:6968` log line is an **environment artifact** (no
  engine running during build); the export still completed with exit 0 and is
  unrelated to these changes.

### Per-change structural assertions (no headless CaptainPad screenshot
available in this environment, so each UX claim is asserted structurally):

- **Delete channel confirm:** `<ConfirmSheet visible={!!deletePrompt} …>`
  rendered in `MixerScreen`; the trash `TouchableOpacity onPress={() =>
  onDelete(channel.id)}` → `handleDeleteChannel` now only calls
  `setDeletePrompt(...)`. `removeMixerChannel` is reachable **only** through
  `confirmDeleteChannel` (the sheet's `onConfirm`). No code path deletes without
  the sheet.
- **Remove entry confirm:** the row `(−)` `onPress={() => requestRemoveEntry(e.id)}`
  sets `removePrompt`; `savePlaylist(...without entry...)` runs only via
  `performRemoveEntry`, called only by `confirmRemoveEntry` (the sheet's
  `onConfirm`).
- **Touch targets:** mixer title buttons keep `styles.titleBtn` (28×28) and now
  carry `hitSlop={ICON_BTN_HIT_SLOP}` (`{8,8,8,8}`) → 44×44 interactive. Deck
  `◎ ALL`: style now includes `minHeight:44, minWidth:44` plus
  `hitSlop {12,12,10,10}`. PlaylistPanel `(−)`: `hitSlop {10,10,10,10}`.
- **Perf:** `grep` confirms `visData`/`visDataRef`/`setVisVersion` are gone from
  `mixer.tsx` (only stale-free comments remain); `<ChannelStrip>` JSX no longer
  passes `visData`; viz arrives via `<ChannelVizStrip vizKey={channel.id}>`
  which holds `useState` local to itself. Therefore a `vis` WS frame mutates
  only one `ChannelVizStrip`, never `MixerScreen` state — the strip list does
  not reconcile and `ChannelStrip` memo holds.
- **Shared hook:** both screens call `useEngineConnection({...})`; the old
  `subscribeBuses`/`loadAll`/`connectToEngine`/boot-`useEffect` blocks are
  removed (grep shows only comment mentions). `onRefreshConnection={connectToEngine}`
  on the deck now points at the hook's returned `reconnect`.
- **Type safety:** `fetchMixerState(): Promise<ApiResult<MixerState>>` with
  `!res.ok` + shape validation; `useEngineState.ts` caller already `!r.ok`-gated
  (verified). `channel.fader ?? 0` at the two mixer display sites.

## Known gaps / notes (no silent fallbacks introduced)
- **Deck connection-error string:** the old deck `connectToEngine` set
  `connectionError` to `conn.error || 'Unknown error'`; routing through the
  shared hook's `onStatus` (`s.lastError || ''`) drops the literal
  `'Unknown error'` fabricated string (the `OfflineBanner` already supplies its
  own default copy when the string is empty). This is intentional and more
  codex-aligned (no fabricated fallback text); the real engine error is
  surfaced when present.
- **Deck viz** stays on the screen-level path (single master `PixelStrip`, no
  list) — the perf regression was specific to the mixer's strip list, so the
  deck was left behavior-identical on purpose.
- **Pre-existing mixer lint warnings** (`setInlinePlaylist` dep, unused `fader`
  in `handleSoloToggle`) left untouched to keep the diff focused; both predate
  this branch.
- **`CaptainPad/node_modules`** is the symlinked dir — left untracked, not
  committed.
