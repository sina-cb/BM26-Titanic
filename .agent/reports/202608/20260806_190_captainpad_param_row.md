# _190 — CaptainPad parameter row: one compact header line

**Date:** 2026-08-06 · **Agent:** _190 (Opus, implementer)
**Branch:** `feat/bm_readiness` · **No git operations. CaptainPad/** only.**
**Builds on:** `.agent/reports/202608/20260806_184_audio_meta_impl.md` (the
audioSuggestion metadata contract and the ♪ tap-to-prefill rule — both frozen,
both untouched; only the chip's PAINT moved).

The deck and the mixer spent four vertical lines on one slider. They now spend
two, and they spend them the same way, because they render the same component.

---

## 1 · The problem, as it actually rendered

Measured on a fresh dist at 1194×834 (iPad 11" landscape), against the live rig
playing `120_crossing_beacons`:

**Deck** — per parameter: the `KNOB 5` pill on a line of its own; then the name
+ ◎ + ⊞ MIDI + value; then the author's note; then the slider. The name `Text`
carried **no `numberOfLines`**, so at the deck's real column width (244 px) a
two-word name wrapped to a second line and the value collided with the ⊞ chip —
see `compare_narrow_tablet_deck_params.png`, where "LOCAL SPEED" is two lines
and `0.65` is printed on top of `⊞ MID`.

**Mixer** — the same information in a *different* order (KNOB, ⊞, ◎, ♪ on a
badge row) with the parameter NAME buried inside the MiniFader below it, so the
operator's eye had to find the name in a different place on each surface.

Four chips, four hand-styled boxes: the KNOB pill (fontSize 8, radius 4, 1 px
vertical padding), ⊞ MIDI (9, radius 6), ◎ ON (9, radius 6), ♪ (8, radius 4).
Sitting next to each other. Nothing shared a height or a baseline.

## 2 · The row now

```
[KNOB 8] CROSSING  [◎]  [♪ FLUX]  [⊞]                          0.50
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

One header line, fixed slot order, slider full width beneath it. The header
**cannot wrap** — `flexWrap: 'nowrap'` plus a `numberOfLines={1}` name — and the
name is the only slot with `flexShrink: 1`, so a long name ellipsizes and every
chip keeps its full width.

**Chip hierarchy** (the operator-facing point of the restyle):

| Tone | Chips | Paint |
|---|---|---|
| **loud** | ♪ LOW / MID / HIGH / FLUX / KICK | filled with the band's identity colour, ink derived for contrast, one point larger |
| **live** | ◎ ON, ! OVERRIDE | filled green — "the engine is driving this" |
| **quiet** | KNOB N, ⊞ MIDI, ◎ add-hint, ✕ | outlined: 8 % wash, 40 % border, accent text |
| **ghost** | MATCHED · SIZE, — | palette neutrals |

Colour is never the only carrier — every chip states its meaning in text and
every abbreviated chip carries a spelled-out `accessibilityLabel` ("MIDI knob
7", "Pattern suggests audio source FLUX — opens the grand X"). Tappable chips
get a `hitSlop` that lifts the interactive area to ~44 pt without changing the
visual footprint.

**Responsive.** The row measures ITSELF (`onLayout`) rather than reading the
window, because the deck's PARAMETERS column and a mixer strip are very
different widths inside the same window. Measured: deck column 244 px @1194,
295 px @1366, **155 px @900**; mixer strip 329 px @1194/1366, 264 px @900.
Below 200 px a deliberate compact variant engages — `K8` instead of `KNOB 8`,
`!` instead of `! OVERRIDE`, tighter gaps, no live "→0.52" readout (the green
ghost bar on the track already says it). An UNMEASURED row (first paint)
resolves to regular so the stack never jitters on mount.

**The author's note.** It no longer takes a line of its own. It rides the
header's slack on a row ≥ 420 px wide, and everywhere else it lives on the ♪
chip's `accessibilityLabel` and in the modulation editor's source-chip caption
(`♪ pattern suggests FLUX — opens the grand X`), both of which predate this
work. No information was dropped; a line was.

## 3 · Architecture

| File | Role |
|---|---|
| **new** `components/param_row_layout.ts` | The PURE contract: slot order, responsive metrics, the width model, `paramDisplayName`, chip tones, WCAG ink selection. No React, no I/O — so it is unit-testable in the node vitest env, which excludes RN `.tsx` by design. Same posture as `playlist_row_sizing.ts` / `knob_badge.ts`. |
| **new** `components/ui/param_chips.tsx` | `ParamChip` (the one box), `KnobChip`, `AudioSuggestionChip`, `MatchedChip`, `NotKnobMappedChip`, and `ParamRowMetricsContext` — how a chip handed to the row as an opaque node still picks up the compact variant with no prop drilling. |
| **new** `components/ui/param_row.tsx` | `ParamRowHeader` (the line), `ParamRow` (header + a `position: relative` slider box), `ParamValueText`. |

**Every render site now goes through `ParamRow`:**

| Site | Before | After |
|---|---|---|
| Deck knob-mapped slider (`Modulation.ModulatedSlider`, driven by `GlobalParams`) | KnobPill on its own line + a bespoke header + note line + slider | `ParamRow`, knob number passed as a prop |
| Deck excluded rows — CPC-`matched` and `no-v0` (`GlobalParams`) | private inline header | `ParamRow`, `dimmed` |
| Deck hsvPicker HUE row (`GlobalParams`) | private inline header | `ParamRow` |
| Mixer strip LOCAL PARAMS (`mixer.MixerLocalParams`) | badge row + note line + `MiniFader` (its own label/value row) | `ParamRow` + a bare `HorizontalFader` |

Chips that live in other files were converted to the shared box in place, so
they cannot drift: `MidiMap.MidiMapBadge`, `Modulation.ModulationBadges` /
`OverrideBadge`. `components/ui/knob_pill.tsx` became a thin alias
(`KnobPill = KnobChip`) — it still serves the two callers OUTSIDE a parameter
row (`CPCControls`' GLOBALS SPEED fader, `deck_hue_row`), which correctly
resolve to the regular metrics.

**Audited and deliberately left alone** (they are not this row):
`GlobalParams`' mixer-variant BASE PARAMS strip (fixed 180 px cards in a
horizontal scroller, no chips at all), `dimmer_rack.tsx`'s colour/brightness/
master faders (a modal's controls, no knob/suggestion/MIDI concept),
`CueEditorSheet`, `GlobalEffectMacros`, `GroupRail`.

**Deleted duplication:** the mixer's `top: 14` ghost-overlay offset (it assumed
the MiniFader header's exact height — the overlay now sits inside `ParamRow`'s
slider box and aligns to the track by construction); `GlobalParams`' private
`MatchedBadge` / `NotKnobMappedBadge` pair (the mixer drew a bare `—` Text and
pushed MATCHED into the MiniFader's `badge` slot, where it rendered
right-aligned in the fader's accent colour instead of beside the name).

### Two decisions worth flagging

**`prettySliderName` is unchanged and still exported.** It now delegates:
`paramDisplayName(name).substring(0, 15)`. The row uses the **uncapped**
`paramDisplayName` and lets the layout ellipsize, so a long parameter reads as
far as the row can honestly show instead of being chopped mid-word at 15 with
no ellipsis and no accessible full text. The capped form stays for the surfaces
that want a predictable label length (toggle/trigger buttons, the BASE PARAMS
strip) and is still pinned byte-for-byte by
`utils/audio_suggestion_labels.test.ts` — plus a new test asserts the two agree.

**The ♪ chip fills with the band colour, and its ink is derived.** Audio
identity colours are fixed hexes (they mirror the Audio Companion, so a band
reads the same on the desktop designer and the iPad) and cannot be theme
tokens — `#c084fc` FLUX violet as TEXT on the LIGHT palette's `#f8f9fa` surface
is ~2.3:1, well under WCAG AA. `readableInk()` picks the better of near-black /
white against the fill; every band now clears 4.5:1, and the same function
makes `◎ ON`'s green legible. Filling also gives the suggestion the loudest
weight in the row, which is what the brief asked for.

**Not touched:** runtime parameter names, knob order (`deriveKnobOrder` /
`knobBadgeFor` untouched), slider behaviour, the `audioSuggestion` metadata
contract, modulation semantics, MIDI behaviour, pattern code, playlist values.
No new dependency, no external asset, no network — playa-offline holds.

## 4 · Files changed

**Mine:**

| File | What |
|---|---|
| **new** `CaptainPad/components/param_row_layout.ts` | the pure layout contract |
| **new** `CaptainPad/components/param_row_layout.test.ts` | 30 tests |
| **new** `CaptainPad/components/ui/param_chips.tsx` | the chip family + metrics context |
| **new** `CaptainPad/components/ui/param_row.tsx` | the shared row |
| `CaptainPad/components/Modulation.tsx` | deck row → `ParamRow`; `prettySliderName` delegates; ◎ / ! / ✕ → `ParamChip`; `DeckValueReadout`; the old `AudioSuggestionBadge` / `AudioSuggestionNote` replaced by the shared chip + the header's note slot |
| `CaptainPad/components/GlobalParams.tsx` | deck excluded rows + HUE row → `ParamRow`; knob number passed to `ModulatedSlider` instead of a pill on its own line; badges → the shared pair |
| `CaptainPad/app/(tabs)/mixer.tsx` | LOCAL PARAMS rows → `ParamRow`; `MixerValueReadout`; MiniFader retired from this stack |
| `CaptainPad/components/MidiMap.tsx` | `MidiMapBadge` → `ParamChip`; the unmapped add-hint is the `⊞` glyph alone (the word cost ~25 px of a 244 px row and said nothing the glyph and the label don't) |
| `CaptainPad/components/ui/knob_pill.tsx` | thin alias of `KnobChip` |
| `CaptainPad/components/audio_suggestion_logic.test.ts` | +3 tests: the restyled chip's tap still seeds the right mapping |

**Foreign, untouched:** `utils/api.ts`, `hooks/useEngineState.ts`,
`utils/audioSignals.ts`, `utils/midi/knob_order.ts`, `components/ui/HealthChip.tsx`
all carry someone else's uncommitted work; I read them and changed nothing in
them. Nothing outside `CaptainPad/**` was touched.

## 5 · Verification

- `npx tsc --noEmit` — **clean** (baseline clean).
- `npx vitest run` — **48 files, 1014 passed, 6 skipped, 0 failed**.
  Baseline was 47 / 981 / 6 / 0; the +33 are the two new/extended test files.
  No pre-existing test changed behaviour; the failing list is empty on both sides.
- `npx eslint` on every touched file — **0 errors**, 2 warnings, both
  pre-existing in `mixer.tsx` (`router` unused, one `exhaustive-deps`).

**What the new tests pin** (`components/param_row_layout.test.ts`, 30):

- KNOB + name + status + suggestion + MIDI resolve to slots of **one** ordered
  header container, and no surface may reorder them;
- a parameter with **no** `audioSuggestion` yields no suggestion slot — asserted
  three ways, including that the freed room goes to the NAME rather than being
  held empty, and that an empty-string label is treated as absent;
- **FLUX** (and LOW/MID/HIGH/KICK): the loud filled chip carries the band's own
  identity colour, clears WCAG AA against its own fill, and states the band in
  text and in its accessibility label;
- long names **ellipsize and never wrap** — structurally (`nowrap` +
  `numberOfLines: 1`) and by the width model: at the real 244 px deck column a
  fully-loaded row still leaves the name room for every live parameter name, a
  28-character name overflows and yields, and the fixed slots' total width is
  identical for a short and a long name (i.e. the chips do not get squeezed);
- the compact variant engages only below the measured threshold, shortens the
  chip labels but never the spoken ones, and still fits the 155 px narrow-tablet
  column;
- `paramDisplayName` matches the legacy capped namer once capped.

`components/audio_suggestion_logic.test.ts` (+3): for each suggestion the live
rig actually serves (micLow / micFlux / micKick off `120_crossing_beacons`), the
chip is tappable exactly when `suggestionBadgeIsActionable` says so and the tap
seeds `{source, mode: 'override', range, modulationCurve}` unchanged; an inert
chip still seeds nothing; a parameter with no suggestion is byte-identical to
before.

**Not render-tested:** the JSX itself. The vitest env is node-only and excludes
`.tsx` by design (_184 hit the same wall), and adding a DOM test env would mean
a new dependency, which the brief forbids. Every decision the components make
is in the pure module and tested there; the pixels are covered by §6.

## 6 · Visual QA

Fresh `npm run web:build`, served by me on **:7167** (never :6967 — the
operator's Expo was left alone), captured with puppeteer against the live
engine. Console muted via `evaluateOnNewDocument` before boot, one tab at a
time (repo memory `captainpad-screenshot-technique`). **My :7167 server is
stopped.** "Before" was captured from a dist built *before* any edit — no
`git stash` anywhere.

All under `~/tmp/fix_190/`:

| File | What it shows |
|---|---|
| `compare_ipad_landscape_deck_params.png` | **the headline.** Same crop rect, before \| after: 5½ parameters became all 7, with room to spare |
| `compare_ipad_landscape_mixer_params.png` | mixer strip: 4 rows → 6, name lifted out of the fader into the header |
| `compare_narrow_tablet_deck_params.png` | **the bug, caught in the act** — before: "LOCAL SPEED" wrapped to two lines, `0.65` and `0.50` printed on top of `⊞ MID`; after: single lines, `K5`…`K10` compact chips, `CROS…` ellipsized |
| `compare_narrow_tablet_mixer_params.png` | mixer at 264 px |
| `compare_*_deck_longname.png` | before/after with one name replaced by `CHROMATIC ABERRATION DEPTH 2` |
| `after_ipad_landscape_deck_params.png` | the required set in one frame: **no-suggestion** rows (LOCAL SPEED, BEAM WIDTH, AFTERGLOW, SAFETY FLOOR) with no placeholder, **♪ LOW** (LEVEL), **♪ FLUX** (CROSSING), **♪ KICK** (FLASH) |
| `after_ipad_landscape_deck_longname.png` | `CHROMATIC ABERRATIO…` on ONE line, chips at full width, value still right-aligned |
| `after_narrow_tablet_deck_params.png` | the compact variant |
| `after_dark_*` (6) | the whole set in the DARK palette — the band chips are the check that mattered |
| `after_*_full.png`, `before_*_full.png` | full viewports, both widths, both tabs |

The long-name frames replace ONE rendered name's text node before the
screenshot (no live pattern has a long parameter name, and changing the rig's
pattern was out of the question). That exercises the shipped CSS honestly —
RN-web renders `numberOfLines={1}` as `white-space: nowrap; text-overflow:
ellipsis`, so flex shrink and the ellipsis are the real ones; only the string is
synthetic.

Capture tooling (scratch, gitignored): `~/tmp/fix_190/capture.cjs`,
`measure.cjs`, `compare.cjs`.

## 7 · Flagged

- **The deck's PARAMETERS column is 244 px at standard iPad landscape.** That is
  the real constraint on this row, and it is why the ⊞ add-hint lost its word.
  If the operator wants the MIDI word back, the honest trade is a wider
  PARAMETERS column, not a tighter name.
- **`paramRowMetrics` thresholds are measured, not theoretical** (200 px compact,
  420 px note). If the deck's column layout changes, re-measure — the numbers and
  their provenance are in the module header.
- **A pre-existing React hydration warning (#418)** fires on every CaptainPad web
  boot, before and after this change. Not mine, not investigated.
