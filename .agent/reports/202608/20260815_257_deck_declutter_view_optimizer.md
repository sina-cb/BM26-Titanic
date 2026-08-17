# _257 — Deck declutter design: bars join the workspace, view optimizer under GLOBALS

**Date:** 2026-08-15 · **Role:** Fable design agent (operator-ordered) ·
**Status:** DESIGN SHIPPED — contract in `docs/63_deck_declutter_view_optimizer.md` ·
**No code, no git ops, no live-port contact.**

## The orders (live iPad testing)

1. 2D PIXELS open ⇒ hide the classic 1D vis strip.
2. Landscape iPad playlist shows only 1 pattern — fix the vertical budget.
3. Audio signals hideable "with the same mechanism as the 2d pixels and
   params" — the docs/53 workspace chips.
4. The view optimizer sits under GLOBALS; the audio + 1D vis bars keep their
   layout but become hideable — "completely simplify the screen".

## The designed model (full contract: docs/63)

**Surface tiers, one reducer.** The workspace layout
(`deck_workspace_layout.ts`) grows a second tier — bars
`audioBar`/`outputBar` (`DeckSurfaceId = DeckWindowId | DeckBarId`) — in the
SAME pure reducer, SAME `deck_workspace_layout_v1` closed-set store, SAME
chip row. Bars never get tracks, flex weights, or a vote in
`patternsFillsNarrow`: the window-only selectors stay typed to windows by
construction. No second show/hide system.

**`_225` upgrade discipline, generalized.** `known` widens to all 7 ids;
the normalizer's unknown-id rule becomes "unknown → its SHIPPED DEFAULT
membership": unknown WINDOWS still arrive closed (the `_225` invariant
survives verbatim), unknown BARS arrive OPEN — because the bars pre-exist
as always-visible chrome, so every pre-existing store (no-`known` legacy,
4-id, 5-id) hydrates to a byte-identical deck plus two new OPEN chips.
Key stays `_v1`. Shared rule, stated in the code: a store may only be
silent about an element that did not exist when it was written, and
silence must reproduce the screen its author was looking at.

**Order 1 = a DERIVED suppression, the `_217` pattern.**
`effectiveShownBars(layout, pixelsShown)` hides `outputBar` while PIXELS is
effectively open — no reducer action, zero persistence writes, the
operator's own manual OUTPUT hide survives PIXELS cycles. Chip leaves both
lists (docs/53 §3.1 — no refusing affordance) and a static micro-caption
(`1D OUTPUT — SHOWN WHEN PIXELS IS HIDDEN`) narrates it, mirroring
`PERF_BAR_CAPTION`. Derivation order: layout → perf overlay (windows) →
pixels suppression (bars).

**Screen reorder (order 4).** `CPCControls` gains two deck-only props —
`optimizerSlot` (the `DeckWorkspaceBar` renders between the GLOBALS row and
the AUDIO row) and `hideAudioRow`. Mixer passes neither ⇒ byte-identical.
The LIVE OUTPUT caption + `PixelStrip` become one conditional block. **The
plan-status cluster (PLAN LIVE · CONTROLS LOCKED / TOOK OVER / the
`PlanIndicatorPill`) is hoisted out of the dying vis header to the
never-scrolling right end of the workspace bar — safety indicators are
never hideable.** Bars, being stateless, MAY unmount when hidden (the
no-remount contract is about state; windows keep it byte-identical) — and
the deck's 200 ms `setVisVersion` re-render gets gated on the OUTPUT bar
being shown, so a hidden strip costs zero vis-driven re-renders.

**Order 2.** W0 investigation first — the static budget (~460 pt of window
height at 1194×834) predicts ≥5 rows, so "1 pattern" needs decomposing;
prime suspects: DECK B bound (wide mode stacks panes vertically, `_225`) ×
the perf-mode `playlistRowSizing` boost. Acceptance floors for the walk:
≥4 visible rows default / ≥6 with both bars hidden (single pane); ≥2/≥3
per pane with DECK B bound. Sanctioned lever if floors miss: padding-only
trim (rowPadY 5→4 etc.); structural row changes are an operator decision
(D4) on the real iPad.

## W-items (2–3 Sonnets + Opus walk; details in docs/63 §7)

- **W0** — landscape budget measurement table (no product code).
- **W1** (Sonnet A) — `deck_workspace_layout.ts` + test: types, generalized
  normalizer, selectors, suppression fn; upgrade-matrix + round-trip tests.
- **W2** (Sonnet B) — `deck_workspace.tsx` + `restyle_contrast.test.ts`:
  bar chips (AUDIO / OUTPUT, green/neutral dots, contrast-gated),
  suppression caption, `trailing` cluster slot.
- **W3** (Sonnet C) — `index.tsx` + `CPCControls.tsx`: slot + hideAudioRow
  props, bar conditionals, plan-cluster hoist, vis-version gate.
- **W4** (Opus) — vitest green, seeded-store hydration probes, perf
  round-trip byte-identity, PIXELS toggle behavior, screenshot matrix
  (landscape/portrait × 5 states) with pattern-row counts, mixer parity
  diff, plan-lock visibility with bars hidden.

W1 first (collision-free, can start now); W2/W3 parallel on disjoint files.

## Decision points (defaults in docs/63 §6)

D1 suppression rule (default: derived w/ caption) · D2 chip names/dots
(AUDIO/OUTPUT) · D3 one-tap SIMPLIFY preset (default: DEFER — chips + 
suppression reach the simplified screen in ≤3 taps; a preset is a second
authority) · D4 row densification beyond padding trim (default: not this
wave) · D5 GLOBALS collapse chevron fold-in (default: leave it).

## Concurrency / sequencing vs the docs/61 wave

The in-flight COLORS wave owns `colors_window*`, `driving_strip`,
**`index.tsx` + `deck_workspace.tsx` (their W3)**, `useEngineState.ts` +
shared header (their W4). Rules for the Opus lead: this wave's W2/W3 start
only AFTER docs/61 lands; our W1 can start immediately
(`deck_workspace_layout.ts` is outside their ownership table); our W3
rebases over their `index.tsx` with the yield wiring pinned untouched
(docs/63 §5 pin 5); if their header chip landed in the vis header row we
dismantle, our W3 relocates it into the workspace-bar trailing cluster and
reports it.

## Must-not-change pins (docs/63 §5)

Patterns floor + window-only `patternsFillsNarrow` · `_217` derived perf
overlay (zero writes, exactly two hidden windows) · `_225` known-set
discipline (`_v1` key, future windows default closed) · window no-remount ·
docs/61 yield rule on `handleWorkspaceClose('colors')` (bars run no yield)
· plan-lock indicators unconditional · zero engine traffic from layout ops
· mixer byte-identical · party 2026-07-11 pin/weights · MIDI knob badges.

## Files

- `docs/63_deck_declutter_view_optimizer.md` (NEW — the contract)
- This report; tracker `_257`; dossier Deck-rehaul row updated.

No product code touched. Nothing to restart.
