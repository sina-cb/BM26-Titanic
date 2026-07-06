# Slot 4 — channel_ops_ui

- **Branch:** dev/channel_ops_ui (local only)
- **Parent branch:** the merged-deliverable tip (merged channel-ops engine
  `dev/channel_ops_engine` + the 2-line playlist readability fix
  `merge(channels): mixer_readability`)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/channel_ops_ui
- **Slot ports:** n/a (CaptainPad UI slice — no engine/sim/metro brought up;
  see Tests run for why no live smoke)

## Scope

The CaptainPad UI for the merged channel-ops engine (docs/39 §6b;
`.agent/02_reports/202606/20260620_22_channel_ops_engine.md` API surface):
duplicate an overlay, reorder the overlay stack, and panic/home (mission-
critical safe LIT reset). Built the typed fail-loud REST clients and wired the
three operator controls into the mixer screen, reconciling all state from the
engine's `mixer`/`deck`/`globals` broadcasts (the engine is the authority).

## Files changed

```
A  CaptainPad/utils/channelOpsApi.ts
M  CaptainPad/app/(tabs)/mixer.tsx
```

Only the two owned files. No edit to api.ts, index.tsx, DeckTopBar.tsx,
PlaylistPanel.tsx, ChannelVizStrip.tsx, GroupRail.tsx, RigGlobals.tsx,
icon-symbol.tsx, or any engine file.

### `CaptainPad/utils/channelOpsApi.ts` (NEW)
Typed fail-loud clients, `apiBase` import (no api.ts edit), the same
`ApiResult` + `res.ok` pattern as channelExtrasApi/groupsSoloApi. The error
branch returns `{ ok:false, error, data }` so the caller can read structured
codes (`REORDER_BAD_SET`, `PANIC_HOME_*`, `rigLit`):
- `duplicateMixerChannel(id)` → POST /mixer/channels/:id/duplicate (no body).
  Surfaces over-cap / deck (400) + missing-source (404).
- `reorderMixerChannels(orderIds)` → POST /mixer/channels/reorder {order}.
  Surfaces `REORDER_BAD_SET` (400).
- `panicMixer(home?)` → POST /mixer/panic {home?}. Surfaces the ONE sanctioned
  loud fallback (`PANIC_HOME_MALFORMED`/`PANIC_HOME_RECALL_FAILED` 400, still
  `rigLit:true`).

### `CaptainPad/app/(tabs)/mixer.tsx`
- **DUPLICATE:** a "⧉" glyph button on each ChannelStrip header (next to the
  trash/delete button), NO ConfirmSheet (non-destructive, per design). On tap
  the parent calls `duplicateMixerChannel`; the new channel is reconciled from
  the `mixer` broadcast (no optimistic insert — avoids a phantom strip if the
  engine rejects). Over-cap/404 → Alert showing the engine error + the
  engine-reported `maxChannels`. Inline `playlistData` from the response is
  stashed (same race protection as the add path) so the copy's PlaylistPanel
  paints entries on first mount. Used a Text glyph instead of an SF-symbol
  because the shared icon-symbol mapping isn't this slice's to edit and has no
  duplicate glyph — matches the existing in-file precedent (the color swatch
  uses a `●`/`○` glyph "to keep this within owned files").
- **REORDER:** up/down chevrons (`chevron.up`/`chevron.down`, already in the
  icon mapping) per strip, disabled (opacity 0.3 + `disabled` + a11y state) at
  the ends, ≥44pt hitSlop (28 + 8 + 8). "Up = toward TOP of mix": the engine
  array is [0]=bottom … [last]=top and the mixer renders `channels` in that
  array order, so up swaps with the next-higher index. The handler computes the
  full new id order locally, POSTs `reorderMixerChannels`, and reconciles from
  the broadcast (no optimistic reorder — a rejected `REORDER_BAD_SET` must not
  leave strips visually shuffled). Reject → Alert. Not gated by the channel
  lock (a locked layer can still be restacked; reorder is non-destructive).
- **PANIC/HOME:** a distinct AMBER `PANIC` button (with a `HOME / SAFE LIT`
  sub-label) at the LEFT of the global rig bar, alongside `<RigGlobals
  variant="mixer" />` (added in mixer.tsx, which owns the `globalRigBar` View —
  RigGlobals.tsx is not an owned file). ConfirmSheet-gated. On confirm calls
  `panicMixer(true)`; reconciles from the engine's broadcasts. A loud-fallback
  400 → Alert that the home look could not load while reassuring the operator
  the rig is still LIT (reads `rigLit` from the structured body). Disabled +
  dimmed (`PANIC…`) while in flight.
- ChannelStrip `React.memo` kept intact: the new handlers are stable empty-dep
  (or `[moveChannel]`/`[setInlinePlaylist]`) `useCallback`s reading
  `channelsRef`; `canMoveUp`/`canMoveDown` are plain booleans.

## Tests run

- **Unit:** n/a (UI slice; the engine side already shipped 10 unit + 30 HIL
  in slot 2).
- **Integration / HIL:** n/a (no engine brought up).
- **Sim smoke:** no. No headless screenshot was captured — the deliverable is
  CaptainPad UI plumbing (REST clients + buttons + a ConfirmSheet), not a sim
  render, and a screenshot of the sim would not exercise this code. The mixer
  screen's structural correctness is covered by `web:build` (RN-web bundles +
  renders the route) and the structural grep assertions below; a live click-
  through needs the full engine+CaptainPad chain, which is out of this slice's
  worktree scope. Flagged for the instigator's full-stack smoke.
- **CaptainPad auto-checks (03_captain_pad_auto_checks.md), exact output:**
  - `git -C <worktree> diff --check -- CaptainPad` → `DIFF-CHECK-CLEAN`
    (no whitespace errors).
  - `npx tsc --noEmit` → `TSC_EXIT=0`.
  - `npm run lint` → `✖ 11 problems (0 errors, 11 warnings)`, `LINT_EXIT=0`.
    All 11 are pre-existing exhaustive-deps / unused-import warnings (verified
    against the stashed baseline: 11 warnings before, 11 after — **no NEW
    warnings**). The mixer.tsx:1031 warning is the pre-existing `onControl`
    callback, not my code.
  - `npm run web:build` → `BUILD_EXIT=0`, **Static routes (21)**, `/mixer`
    and `/(tabs)/mixer` both exported (55 kB).
  - Structural grep assertions: all three controls present and wired —
    `channelOpsApi` imported; `onDuplicate`/`handleDuplicateChannel`/
    `duplicateMixerChannel`; `onMoveUp`/`onMoveDown`/`canMoveUp`/`canMoveDown`/
    `moveChannel`/`reorderMixerChannels` + the two chevrons; `panicBtn`/
    `panicPrompt`/`confirmPanic`/`panicMixer` + the panic ConfirmSheet.

## Known gaps / follow-ups

- No drag-to-reorder (draggable-flatlist isn't vendored — design doc calls for
  chevrons, which is what shipped).
- Duplicate uses a Text glyph rather than an SF-symbol; if a real icon is
  wanted, the owner of `components/ui/icon-symbol.tsx` can add a
  `plus.square.on.square` → `content-copy` mapping and swap the glyph.
- No live engine click-through (see Sim smoke above) — needs the instigator's
  full-stack smoke to confirm the WS reconcile of a duplicated/reordered/
  panicked stack end-to-end.

## Operator action requested

Ready for review and merge.
