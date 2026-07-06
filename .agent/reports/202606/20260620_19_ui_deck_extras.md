# Slot 19 — ui_deck_extras

- **Branch:** dev/ui_deck_extras
- **Parent branch:** deliverable tip (all channel features merged; tip `f3194ac`)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/ui_deck_extras
- **Slot ports:** n/a (CaptainPad-only static UI work; no engine/sim/metro brought up)

## Scope

Closes the 13-B deferral that left the per-channel intensity clamp (`faderMax`,
docs/39 §8.3) and color metadata (`color`, docs/39 §8.4) unsurfaced on the DECK
channel — they were unsurfaced because `DeckTopBar` wasn't owned in that slice.
This slice adds, to the deck view (`CaptainPad/app/(tabs)/index.tsx`), a CAP
(intensity-ceiling) slider and a color-swatch picker for the deck channel,
routed through the already-merged `channelExtrasApi` clients with `{deck:true}`
so the PATCH lands on `/deck/channel`. UX mirrors the just-merged mixer-strip
CAP row + color swatch.

## Files changed

```
M  CaptainPad/app/(tabs)/index.tsx
```

(Only this one file. `CaptainPad/node_modules` is the pre-set gitignored
symlink — untracked, not committed. No `channelExtrasApi.ts`, `mixer.tsx`,
`DeckTopBar.tsx`, `api.ts`, or engine file was touched.)

## What was built (structural assertion)

- **CAP control** — `HorizontalFader` bound to `channel.faderMax ?? 1`, amber
  fill (`#F5A623`) to distinguish it from a level fader, mono % readout,
  disabled (`if (!channel.locked)` guard + 0.5 track opacity) while the deck is
  locked. Placed under the PARAMETERS block in the deck channel card.
- **Color swatch button** — 44×44 button in the deck card header row (next to
  the ◎ ALL pill). Fill IS the deck's current color, hollow `○` ring when null.
  Opens a screen-level color-picker `Modal` with the same 8-swatch curated
  palette as the mixer + a NO COLOR (null) clear option.
- **Deck card tint** — card left edge tints to `channel.color` (4px border)
  when set and unlocked; the lock border still wins. No layout shift when color
  is null (defaults to `ghostBorder` at 1px) or when faderMax is 1.0.
- **Handlers** — `handleDeckFaderMax` / `handleDeckColor`:
  - **Endpoint:** call `setChannelFaderMax(id, v, { deck: true })` /
    `setChannelColor(id, c, { deck: true })` → these route to
    `PATCH /deck/channel` (verified in `channelExtrasApi.ts` lines 135–137 /
    159–161, and engine `api_server.js` `/deck/channel` PATCH accepts
    `faderMax` via `validateFader` and `color` as string|null).
  - **Optimistic apply:** `setDeckChannel((c) => ({ ...c, faderMax/color }))`
    before the await.
  - **Reconcile:** the engine `broadcastMixerState()` on PATCH success emits the
    `deck` WS event, which the existing `onControl` handler maps into
    `setDeckChannel` — canonical state re-syncs without extra wiring.
  - **Fail-loud (Codex P0):** on `!res.ok`, `console.error` + revert to the
    prior value + `Alert.alert`. No silent swallow, no fabricated `{ok:true}`.
- **Touch targets:** swatch button 44×44; CAP slider track 16px tall in a 44pt+
  row; swatch grid cells 44×44 with 8pt hitSlop; clear button minHeight 44.

## Tests run

- **Unit:** none added (UI-only slice; engine `faderMax`/`color` contracts are
  already covered by `tests/fader_max_clamp.test.js`,
  `tests/channel_feature_fields.test.js`, and
  `tests/hil/hil_channel_features_test.mjs` from the engine-side wave).
- **Integration / HIL:** none (no engine brought up in this worktree).
- **Sim smoke:** no — CaptainPad-only change, no sim relevance.
- **CaptainPad:**
  - `git diff --check -- CaptainPad` → clean (no whitespace/conflict markers).
  - `npx tsc --noEmit` → **exit 0**.
  - `npm run lint` → **0 errors / 12 warnings**, identical to baseline (all 12
    warnings are in pre-existing files: monitor, studio, AllModulationsPanel,
    GlobalEffectMacros, NauticalFader, PlaylistPanel, ScheduledTaskRow,
    HorizontalFader, TimerWheel) — **no new warning in index.tsx**.
  - `npm run web:build` → **exit 0, 21 static routes** exported (incl.
    `/ (index)` and `/(tabs)`).
  - **No headless screenshot:** the sim screenshot harness
    (`agent_render.cjs`) renders the Three.js simulation, not the CaptainPad
    Expo web app; there is no per-slot CaptainPad render tool in this worktree
    and bringing up the full Expo web server + a browser driver was out of scope
    for a static UI slice. Verification is the tsc/lint/web:build chain (which
    compiles + bundles the route) plus the structural assertion above.

## Known gaps / follow-ups

- No live click-through verification (engine + Expo web not stood up here). The
  optimistic-apply / WS-reconcile / fail-loud paths are asserted structurally
  and by mirroring the proven mixer-strip implementation, but a full-stack
  smoke would confirm the deck WS `deck` broadcast carries `faderMax`/`color`
  end-to-end on the iPad.
- Curated 8-color palette matches the mixer (no free-form hex entry) — same
  scope decision as 13-B.

## Operator action requested

Ready for review and merge.
