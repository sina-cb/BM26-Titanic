# _196 â€” Deck workspace windows + COLORS window: design

**Date:** 2026-08-14 Â· **Agent:** _196 (Fable, design-only) Â·
**Branch studied:** feat/bm_readiness @ 3a4d559d Â·
**Deliverable:** `docs/53_deck_workspace_windows.md` (the contract; this
report is the hand-off summary). No code was touched.

## What was designed

1. **Deck window system** â€” the Live Touch panel-manager methodology
   (close = leave the layout entirely; restore rail; renormalizing
   persisted closed-set; protected floor; visible refusal) adapted to the
   Deck tab as React Native: four windows â€” PATTERNS (protected, hosts
   DeckHueRow + SplitPlaylistPanes), PARAMETERS (DECK MAIN card),
   AUTOPILOT (pattern autopilot + color autopilot + overlays), COLORS
   (new). Pure layout module `deck_workspace_layout.ts` (typed reducer +
   total normalizer + wide flex weights, vitest-covered), windows stay
   mounted (`display:'none'`) so state/scroll/WS reconciles survive,
   AsyncStorage `deck_workspace_layout_v1` persists the closed-set only.
   DeckTopBar, CPCControls, plan banner/scrim, PANIC bar, modals stay
   outside; plan-lock scrim stays hermetic (window chrome freezes too);
   all-open default is pixel-parity with today (COLORS defaults to the
   rail â€” flagged as operator decision #1).

2. **COLORS window** â€” two modes.
   - **TWO-COLOR SELECT:** RN/SVG hue ring (Live Touch wheel read model,
     S=V pinned 1.0 per docs/36) with two handles = the engine's two CPC
     slots `colorPalette1/2`; preset-hue chip strip derived from the
     `/color-palettes` library (deduped c1/c2 hues); armed-slot tap flow
     enforces "exactly 2" by construction; writes via the existing
     throttled atomic `updateParamCenter` recipe, engine slews over
     `colorTransitionMs`; read-only + explicit "tap to pause" when the
     color autopilot is active (single-writer rule).
   - **PALETTE TURNS:** the 5 chosen hues become 5 adjacent inline pairs
     `[(T1,T2)â€¦(T5,T1)]` posted as a **color-autopilot config** â€” the
     rotation runs ENGINE-SIDE in the existing `ColorAutopilot` daemon
     (survives iPad sleep; countdown/broadcast/timeline composition free;
     one hue writer by construction). One UI control: TURN EVERY;
     crossfade derived (25% of period, clamped 0.5â€“3 s).

3. **Engine gap flagged as its own slice (E1):** `ColorAutopilot.validate`
   + the api_server palette resolver currently accept library ids only;
   E1 widens `palettes` to `(string | {c1,c2})[]`. No new endpoint, no new
   WS type, no new daemon. TURNS is gated on E1 (no client-side fake â€” P0).

## Slice plan

A: workspace (CaptainPad) âˆ¥ B: colors window two-color mode (CaptainPad)
â†’ C: engine E1 â†’ D: TURNS UI + `utils/api.ts` type widening +
ColorAutopilotPanel CUSTOM-chip rendering. Test list + 7-row screenshot
matrix in the doc; shared-tree protocol (re-read before edit, surgical
edits, stop on conflict, never touch the running 6966â€“6972 stack,
validate on a fresh :7167 dist) written into the contract.

## Key code facts the design rests on

- `CaptainPad/app/(tabs)/index.tsx` â€” 3-column wide row (flex 4/3/3,
  operator-locked), PATTERNS pinned + ColumnsScrollRest in narrow,
  SectionHost View-vs-ScrollView rule, hermetic PlanLockScrim.
- `docs/ui/touch_control.html` â€” dock/undock IIFE (~line 5552): closed-set
  persistence `bm26_touch_layout_v2`, `reflowRows`, rail rebuild,
  `dock-refused`, MIN_OPEN floor re-enforced on load.
- `marsin_engine/lib/color_autopilot.js` â€” generation-guarded engine
  daemon, additive hold+fade, crossfade tween hooks, runtime-file
  persistence, `nextSwapAtMs`, timeline `deactivate()`.
- `CaptainPad/components/ColorPickerModal.tsx` â€” atomic dual-write +
  33 ms throttle + drag-dismiss guard; `DualSwatch` reuse.
- Routes: POST `/param-center`, GET `/color-palettes`, GET/POST
  `/deck/color-autopilot`; WS `sharedParams` + `colorAutopilot`.
- `react-native-svg` 15.10.0 already a dependency; vitest include covers
  `components/**/*.test.ts` (pure .ts only).

## Open decisions for the operator

1. COLORS window default: closed (pixel-parity, as designed) or open?
2. TURNS strictly 5 colors (refuse fewer) â€” OK?
3. One-control fade policy (derived 25% of period) vs an explicit fade bar
   in the COLORS window?
4. Wheel stays hue-only (S=V=1 house policy) â€” confirm.

