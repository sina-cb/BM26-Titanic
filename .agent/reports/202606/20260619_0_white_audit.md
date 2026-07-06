# White Audit + Apply — 2026-06-19

Audit of how WHITE (the dedicated W emitter, `w` arg of `rgbwau`) and the
VINTAGE-HEAD BLINDERS (sectionId == 2, fixtureId 5–6) are used across the
pattern library, plus the application of controllable `white_*` params to three
assigned patterns. Scope per skill `12_highdef_pattern_generation.md` §8.1.

## How white / blinders are done today (from 00 + 11)

**The W channel is its own design dimension** — not `min(r,g,b)`. Plain `rgb()`
leaves W = 0 (white emitter off); the mapper only backfills `W = min(r,g,b)`
when `entry.w` is undefined. To *control* white you must emit it explicitly via
`rgbwau(r, g, b, w, a, u)` and clamp every channel 0..1.

Two reference techniques:

- **Vintage blinder — `00_golden_hour_wash`** (the headline use): on
  `sectionId == 2` (upper Y heads, the audience blinders) the pattern drives the
  W channel HARD on the kick, with a small always-on warm-white keep so the heads
  glow tungsten between hits. Pars/bars stay coloured (cp1↔cp2); the vintage
  heads carry the white bite. White is additive on top of the strict two-colour
  geometry — it never washes the whole rig white.
- **Gentle white cores — `11_bioluminescence`**: a crisp white spark rides only
  the crest peaks (`outW = crest * 0.4 * (0.5 + kick*0.5) * level`), an additive
  highlight under the cp1/cp2 colour, plus an independent additive UV undertow on
  the `u` channel. White here is a small accent, not a blinder.

Common to both: white is **additive on top of cp1/cp2**, **gated by the overall
level gain** (so it doesn't decorrelate the PRIMARY brightness mapping), and
**audio-driven via modulators only** (`micKick` for the pop, `micLow` for the
keep) — the pattern never reads `mic*` natively.

## The `white_*` control convention used

Identity sliders (skill §3): store `v` directly in the export var, scale inside
`render3D`/`beforeRender`. Declaration order = CaptainPad UI order. The
canonical set (skill §8.1 table):

| Control | var | Meaning | Audio source |
|---|---|---|---|
| `sliderWhiteLevel` | `whiteLevel` | overall white amount / always-on keep | `micLow` (or static) |
| `sliderWhiteKick`  | `whiteKick`  | kick-driven white POP / blinder bite | `micKick` |
| `sliderWhiteWarmth`| `whiteWarmth`| warm amber (A) ↔ cool/UV (U) tint | static / `micMid` |
| `sliderBlinderBite`| `blinderBite`| attack/decay snap of the blinder | static / `micKick` |
| `sliderWhiteSpread`| `whiteSpread`| how far the white reaches across cores | static / `micFlux` |

Minimum per white pattern: `sliderWhiteLevel` + `sliderWhiteKick`, plus one
creative slider that fits the pattern's identity. Documented in each header as:

```text
WHITE (modulators-only):
    MODULATE sliderWhiteKick  (whiteKick)  <- micKick
    MODULATE sliderWhiteLevel (whiteLevel) <- micLow
```

Validation: the harness FOLDS W into displayed RGB, so white reads in
QUALITY/peak and the gallery clip; a true white pixel folds to ~[255,255,255]
(whiteness min/max ≈ 1.0). Vintage blinder reads on `kick_4floor` by measuring
the sectionId==2 peak rising on the kick.

## Patterns changed in this slice (mine — edited only these 3)

### 00_golden_hour_wash — vintage blinder, refined + controls
Already had a kick-driven vintage W blinder; identity preserved. Added
`sliderWhiteLevel` (always-on warm-white keep on the vintage heads),
`sliderWhiteKick` (the blinder bite, now decoupled from the colour-body kick),
and `sliderWhiteWarmth` (splits the white tint between amber `a` for tungsten and
UV `u` for a cool punch). The old `sliderKick` now only pops the warm colour
body. White stays additive; pars/bars remain cp1↔cp2.
- `--mod micLow:sliderLevel,micKick:sliderWhiteKick,micFlux:sliderRadius,micHigh:sliderDetail`
- full_track: hueSpread 0.10, peakMaxChan 255, PRIMARY micLow corr 0.51.
- kick_4floor: vintage peak min/avg/max 221/248/255 (delta 34, saturates to 255).
- silence: calm non-black (TOTAL_BRI 8042–8859).

### 06_neon_elevator — arrival blinder is now a real vintage blinder
Moved the arrival "ding" white blinder onto the VINTAGE penthouse heads
(`sectionId == 2`), kick-gated, with the bite weighted by how high the car is
riding (`nearTop`) so it reads as the elevator arriving up top. Added
`sliderWhiteLevel` (penthouse white keep + tungsten `a`), `sliderWhiteKick`
(blinder bite), `sliderBlinderBite` (attack/decay snap via a pow exponent on the
arrival pulse). The Par mezzanine keeps a smaller colour/white "ding" accent.
- `--mod micLow:sliderLevel,micKick:sliderWhiteKick,micFlux:sliderRadius,micHigh:sliderDetail`
- full_track: hueSpread 0.39, peakMaxChan 236, PRIMARY micLow corr 0.57.
- kick_4floor: vintage peak min/avg/max 141/178/255 (delta 114 — clear whiten on kick).
- silence: animating, non-black.

### 08_ocean_liner — porthole white flare/accent
Was emitting plain `rgb()` (W=0). Switched to `rgbwau()` with an incandescent
white flare on the lit porthole cores (cabin-light feel), additive over the warm
amber porthole colour; water stays cp1. Added `sliderWhiteLevel` (core white
amount), `sliderWhiteKick` (kick flare pop), `sliderWhiteSpread` (how deep into
the core the white reaches via a pow gate). Not a vintage pattern — portholes
live on pars/bars — so no sectionId==2 blinder here (per task: porthole flare).
- `--mod micLow:sliderLevel,micKick:sliderWhiteKick,micFlux:sliderRadius,micHigh:sliderDetail`
- full_track: hueSpread 0.17, peakMaxChan 255, PRIMARY micLow corr 0.69, whiteKick corr 0.68.
- kick_4floor: brightest porthole core folds to [255,255,255] (whiteness 1.0).
- silence: calm non-black, animating.

All three published to the gallery (`/w/00_golden_hour_wash`,
`/w/06_neon_elevator`, `/w/08_ocean_liner`).

## Library-wide picture

Two sibling agents handled 01/09/13 and 12/19/25 in parallel; this slice owned
00/06/08. As of this audit, **13 of 60 patterns (~22%) expose `white_*`
controls**, trending toward the ~30% target as the sibling work lands:

White-controlled (`sliderWhite*` / `blinderBite`):
`00, 01, 06, 08, 09, 12, 13, 14, 16, 19, 21, 23, 25`.

Vintage-blinder whites (sectionId==2 kick-gated W) are the emphasis — present in
`00, 06, 09, 12, 13, 19, 25` among the controlled set. Several other patterns
already emit some W via `rgbwau` without the full `white_*` control surface
(e.g. `04, 05, 07, 11, 17`) and are candidates for a follow-up pass to reach the
30% target with a consistent control convention.

### Follow-up (file on the Notion board as Backlog)
- Bring the remaining `rgbwau`-emitting patterns up to the `white_*` control
  convention to clear ~30% (candidates: 04, 05, 07, 11, 17).
- Operator does the final on-phone gallery pass to confirm the vintage blinders
  read as an audience punch and the porthole flares read white (not just bright).
