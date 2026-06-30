# Slot 15 — ui_snapshots_clamp_color

- **Branch:** dev/ui_snapshots_clamp_color
- **Parent branch:** deliverable tip (132504e — channel_features_engine merge: snapshots/look-recall + master-fade + faderMax clamp + color)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/ui_snapshots_clamp_color
- **Slot ports:** n/a (CaptainPad-only UI slice; no engine/sim brought up)

## Scope

CaptainPad UI for three just-merged engine features from
`docs/39_channels_deck_mixer.md` §8: named mixer **snapshots / look recall**
(F-A), per-channel **intensity clamp `faderMax`** (F-C), and per-channel
**color** metadata (F-D). Adds the client functions, a SnapshotBar component
mounted in the mixer header, and per-strip clamp + color controls in
`mixer.tsx`. Engine untouched (contract is already merged).

## Files changed

`git diff --name-status HEAD~..HEAD` (work, pre-report commit):

```
M	CaptainPad/app/(tabs)/mixer.tsx
A	CaptainPad/components/SnapshotBar.tsx
A	CaptainPad/utils/channelExtrasApi.ts
```

All three are within the declared file ownership. `utils/api.ts`,
`DeckTopBar.tsx`, `PlaylistPanel.tsx`, `index.tsx`, and every engine file were
left untouched. `components/ui/icon-symbol.tsx` was deliberately NOT edited —
the color swatch uses a text glyph (●/○) instead of adding an SF-symbol
mapping, to stay inside owned files.

## Structural assertions (what wires to what)

**channelExtrasApi.ts** — fail-loud `ApiResult` clients mirroring api.ts
(`fetchWithTimeout`, `res.ok`, engine error body surfaced on non-2xx; engine
base read via the dependency-free `apiBase` leaf, api.ts not edited):
- `fetchSnapshots()` → `GET /mixer/snapshots` (→ `string[]`, validates the
  `{ snapshots: [] }` shape).
- `saveSnapshot(name)` → `POST /mixer/snapshots { name }`.
- `recallSnapshot(name)` → `POST /mixer/snapshots/:name/recall` (surfaces
  over-cap 400 / unknown 404 / SNAPSHOT_MALFORMED 400).
- `deleteSnapshot(name)` → `DELETE /mixer/snapshots/:name`.
- `setChannelFaderMax(id, faderMax, {deck?})` → `PATCH /mixer/channels/:id`
  (or `/deck/channel`) with the single `{ faderMax }` field.
- `setChannelColor(id, color, {deck?})` → same PATCH with `{ color }`.

**SnapshotBar.tsx** (mixer header, `!isPortrait`):
- Seeds the list from `fetchSnapshots()` on mount; reconciles from the WS
  control-plane **`snapshots`** event (`msg.snapshots` taken verbatim) via
  `engineEvents.subscribe`.
- CAPTURE → in-app name prompt (RN-web-safe modal, not Alert.alert) with local
  slug preview matching the engine rule `^[a-z0-9][a-z0-9_-]{0,63}$` →
  `saveSnapshot`.
- RECALL list → per-snapshot `recallSnapshot`; no optimistic local flip — the
  WS `mixer` broadcast reconciles the strips (docs/39 §4.2).
- DELETE → behind `ConfirmSheet` (destructive); `deleteSnapshot`.
- All failures (over-cap, 404, malformed, transport) surface via `Alert`;
  ≥44pt touch targets on rows/buttons (`hitSlop` + `minHeight: 44`).

**mixer.tsx**:
- **faderMax (clamp):** a "CAP" `HorizontalFader` (amber fill) under the LEVEL
  fader on each ChannelStrip, showing `channel.faderMax ?? 1` as a percent.
  `handleFaderMaxChange` — optimistic local apply → `setChannelFaderMax`
  (PATCH `{ faderMax }`) → reconcile from next mixer broadcast → revert prior
  ceiling + Alert on reject (WAVE 5 pattern). Disabled while the channel is
  locked.
- **color:** a swatch button in the strip header (● filled accent / ○ hollow
  when null) opens a swatch-grid picker + "NO COLOR" clear. `handleColorChange`
  — optimistic → `setChannelColor` (PATCH `{ color }`) → revert + Alert on
  reject. A set color tints the card's left border (lock border still wins).
- SnapshotBar mounted in the header's left cluster after the HealthChip.
- `ChannelStrip` React.memo preserved: the two new handlers are
  `useCallback([])` like the existing ones, passed as stable props, so the memo
  still short-circuits.

## Tests run

- **CaptainPad** (from `CaptainPad/`):
  - `git -C <worktree> diff --check -- CaptainPad` → clean (no whitespace
    errors).
  - `npx tsc --noEmit` → **exit 0**.
  - `npm run lint` → **0 errors / 12 warnings**, identical to the documented
    baseline. No new warnings originate from the new files; mixer.tsx's two
    warnings (`setInlinePlaylist` dep, unused `fader`) are pre-existing.
  - `npm run web:build` → **exit 0**, **21 static routes** exported (incl.
    `/mixer` and `/(tabs)/mixer`). The `ECONNREFUSED 127.0.0.1:6968` line is a
    prerender-time engine probe (engine intentionally not running) — not a
    build error; `dist` exported successfully.
- **No headless screenshot.** The sim screenshot tool renders the Three.js
  simulation (`agent_render.cjs`), not the CaptainPad iPad surface; this is a
  CaptainPad-only UI slice with no sim/engine in the loop, so a sim render
  would show nothing relevant. UI was validated structurally via tsc + lint +
  web:build (the web bundle compiles the screen and its modals).

## Known gaps / follow-ups

- Recall reconciliation relies on the engine's WS `mixer` broadcast firing
  after recall (per the contract). Not exercised against a live engine in this
  slice — recommend a quick full-stack smoke when convenient.
- The color swatch palette is a curated fixed set (8 hex accents + clear). The
  engine accepts any string; a free-form hex entry was intentionally not built
  (compact-wins, docs/11 §4). Easy to extend later.
- faderMax/color controls are wired for the mixer overlays only (the screen
  renders overlays). The clients accept `{ deck: true }` for a future deck-side
  surface, but DeckTopBar.tsx is another agent's file this wave.

## Operator action requested

Ready for review and merge.
