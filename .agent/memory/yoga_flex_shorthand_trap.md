# Yoga ignores `flexBasis:'auto'` when a `flex:N` shorthand co-flattens

**Learned 2026-08-16** (`_280` root-cause of the twice-failed portrait rail;
contract `docs/69`).

## The trap

React Native style arrays flatten by KEY — `flex` and the three longhands
(`flexGrow`/`flexShrink`/`flexBasis`) are DIFFERENT keys, so an override
style never removes a base style's `flex: 1`; both reach Yoga.

Yoga then resolves them asymmetrically
(`react-native/ReactCommon/yoga/yoga/node/Node.cpp`):

- `resolveFlexGrow()` — an explicit `flexGrow` **wins** over `flex`.
- `processFlexBasis()` — an explicit basis wins **only if it is a length**.
  An explicit **`'auto'` falls through** exactly like "unset", and a
  co-present `flex > 0` then forces **basis 0** (native never uses Yoga's
  web defaults).

So `[{flex:1}, {flexGrow:0, flexShrink:0, flexBasis:'auto'}]` resolves on
NATIVE to grow 0 · shrink 0 · **basis 0** — a hard 0 pt on the main axis in
an auto-height container. **react-native-web turns the same object into CSS
longhands, where `flex-basis:auto` DOES beat the `flex` shorthand** — the
layout looks correct in every browser probe and is zero on the device. This
exact divergence shipped as `_275`'s "fix" and left the mixer's portrait
rail at 0 pt a second time.

## The rules

1. **Never fight a `flex: N` base with longhand overrides on native.**
   SELECT between two complete style objects instead
   (`isPortrait ? SEAT_PORTRAIT : SEAT_LANDSCAPE`), and give the
   content-sized variant NO flex-family keys at all.
2. If an override must be used, override the **`flex` key itself**
   (`flex: 0` restores basis-auto/grow-0 resolution).
3. **Web screenshots can never prove native flex layout.** For any
   native-only collapse, run the real algorithm in the test:
   `yoga-layout` (npm) is the WASM build of the same C++ Yoga RN vendors —
   build the subtree from the REAL exported style objects and assert
   computed heights (see `docs/69` W1; probe
   `~/tmp/mixer_three_design/yoga_probe/probe.mjs`).

Sibling trap already on file: RNW drops `width: undefined` overrides
(`_279` — clear widths with `'auto'`).
