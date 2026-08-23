# 347 — Spec: `titanic_interior` flow patterns + playlists

Planner spec (Fable) for an Opus implementer. Nothing here is implemented yet.
Scene spec: report `20260821_345`. Model: `marsin_engine/models/titanic_interior.js`
(1980 px, 6 lines × 330 px = Seg1 180 px + Seg2 150 px, RGBW `whiteMode: native`).

## 1. Geometry contract (how patterns see the room)

Patterns are rig-agnostic: derive everything from `render3D(index, x, y, z)`
normalised coords, never from `fId`/`index`. On this model:
- **Along-line position** `u = x` (0..1 over 330 px). Seg1/Seg2 boundary is at
  world `x = 0.5` → `u ≈ 0.545`. Seg1 = `u < 0.545`, Seg2 = `u ≥ 0.545`.
- **Line identity** from `(z, y)`: wall = `z < 0.5` (port, BoilerRoom-A) or
  `≥ 0.5` (starboard, B); tier = `y` quantised to 3 levels (top/mid/low).
  `lineId = wall*3 + tier` ∈ 0..5. Compute per pixel with `floor()` — cheap.
- Per-line variation always = deterministic phase/sign offset from `lineId`
  using irrational ratios (PHI, SQRT2, golden angle) — never random, never
  integer periods. A `cohesion` slider blends "all lines identical" (1) ↔
  "each line its own river" (0).
- **Seg1/Seg2 treatment**: Seg1 is the "upstream" 6 m, Seg2 the "downstream"
  5 m. Flow continues across the seam (no visual break) unless a pattern
  explicitly uses the seam as a feature (weir / pool). Never hard-code 180/150.
- **White**: palettes are HSV cp1/cp2; the sim derives W natively from RGB, so
  the pattern emits RGB only. Every pattern has a `whiteFoam` slider that adds a
  desaturated (S→0.1) highlight on crests/sparkle so the W channel actually
  lights. Floor brightness ≥ 0.02 shaped — never fully dark, never flat.

Param order rule (memory `pattern-param-order`): slider export declaration
order = MFT knob order; if `sliderDirection` exists it is the **2nd** export.
All patterns: first export `sliderLocalSpeed`; palettes via `colorPalette1/2`.
Audio only through `AUDIO_MODULATION_V1` header comments + playlist
modulations (`cpc` scope keys `micLow`, `micKick`, `micFlux`, `micHigh`) — never
read audio globals natively. Test on `test_bench` too (must not crash there).

## 2. Patterns (new files `marsin_engine/patterns/131..135_*.js`, add to
`manifest.json` in numeric order)

### 131_river_run — the default flow
Continuous laminar current: a sum of 3 aperiodic sine "eddies" travelling along
`u`, brightness follows the crests; cp1 body, cp2 on the faster eddy, whiteFoam
tints the sharpest crest. Seg2 runs ~15% faster than Seg1 (downstream narrows).
Lines: same direction, phase offset by `lineId × golden angle`; `cohesion` → 1
locks them into one synchronous current down both walls.
Sliders: localSpeed, direction, level, cohesion, turbulence (eddy count/sharpness), whiteFoam.
Sound (playlist only): level ← micLow 0.45..0.85 easeOut; turbulence ← micFlux 0.3..0.8.

### 132_tide_pools — slow, the seam as a weir
Water pools and drains: a slow level (`u` fill from upstream) rises along Seg1,
spills over the seam into Seg2 as a brighter cp2 "fall", then Seg2 drains
downstream. Period ~20 s, phase-staggered per line so the room always has one
line filling and one spilling. Very calm, high cp1 saturation, whiteFoam only at
the spill lip. No direction (single downstream sense).
Sliders: localSpeed, fill (pool depth), spillGain (brightness of the fall), stagger (per-line offset 0..1), whiteFoam.
Sound: spillGain ← micKick 0.3..1.0 easeIn (kick dumps the pool).

### 133_counter_current — lines ignore each other
Each line is an independent river: odd `lineId` flows opposite to even; port and
starboard walls hold different hues (cp1 vs cp2) and different speeds (ratio
PHI). Comet-like bright "drifts" (3–5 per line, deterministic spawn from
`lineId`+time hash) ride the current with a soft tail. `cohesion` pulls all
lines toward one direction/colour.
Sliders: localSpeed, direction (flips the even/odd assignment), density (drift count), tail, cohesion, whiteFoam.
Sound: density ← micHigh 0.3..0.9; localSpeed static.

### 134_surge — sound-reactive primary
Quiet floor current (a dim river_run) plus **surges**: a kick launches a bright
wavefront from `u = 0` that travels the full 330 px in ~1.2 s, crossing the seam
with a whiteFoam flash at the lip. Bass level widens the wavefront; flux raises
the floor. Wavefronts fire on all 6 lines simultaneously (cohesion 1) or ripple
wall-by-wall with `stagger` (A top→low, then B).
Sliders: localSpeed, direction, surge (0..1 launch handle, modulatable), width, stagger, whiteFoam.
Sound: surge ← micKick 0..1 linear; width ← micLow 0.3..0.8; localSpeed ← micFlux 0.3..0.7.
At rest with no audio it must still breathe (floor + slow ambient surge every ~8 s).

### 135_bilge_glow — near-static, warm rest state
Water at rest in a dark hold: slow caustic shimmer (two `wave()` products,
irrational ratios) in deep cp1 with rare warm cp2 glints; almost no directional
motion. Per-line differs only by phase. Intended as the "lights on, nobody
dancing" look and the shuffle filler.
Sliders: localSpeed, level, shimmer, glintRate, whiteFoam.
Sound: level ← micLow 0.25..0.5 easeOut only.

Palette defaults: cp1 deep teal-blue (H 0.55, S 1, V 0.9); cp2 warm amber-white
(H 0.09, S 0.5, V 1). `133` swaps cp2 to magenta (H 0.85) by default.

## 3. Playlists — `simulation/scenes/titanic_interior/playlists/` (new dir)

Schema: `schemaVersion: 1`, `name`, `entries[]` of `{id, pattern, label,
defaults, modulations, midiMappings: [], notes}` — copy shape from
`simulation/scenes/titanic/playlists/ambient_sound_reactive.yaml`. Shuffle is
NOT a playlist field; it lives on the timeline autopilot (`shuffle: true` in the
interior `playa_default.yaml`, which is foreign-owned — do not edit it).

| Playlist | Entries in order | Modulations | Notes |
|---|---|---|---|
| `flow` | 131 river_run (cohesion 0.8) → 132 tide_pools → 133 counter_current (cohesion 0.3) → 131 river_run (cohesion 0.2, turbulence 0.7, label "river_wild") → 135 bilge_glow | none | ambient; autopilot shuffles |
| `flow_sound` | 134 surge (stagger 0.4) → 131 river_run → 133 counter_current → 134 surge (stagger 0, label "surge_unison") → 132 tide_pools | every entry carries its §2 sound hook as `cpc` continuous modulations, `mode: override`, `polarity: unipolar` | sound-reactive |
| `default` | 131 river_run → 135 bilge_glow → 132 tide_pools → 134 surge (modulated) → 133 counter_current | only the 134 entry is modulated | what the timeline autopilot boots into |

Entry ids: `e_<playlist>_<n>_<pattern>`. Defaults: set every slider explicitly
(no reliance on pattern defaults). `default` must exist before engine boot or
the engine generates an empty one — create it first.

## 4. Validation the implementer must run

1. `cd marsin_engine && npm test` — includes `param_truth_smoke`, playlist
   manager/malformed tests, manifest discovery; add the 5 patterns to any
   pattern-discovery fixture list that enumerates the manifest.
2. Offline compile of each pattern on **both** `titanic_interior` and
   `test_bench` (the param-truth harness `tools/param_truth/` cross-model run on
   the 5 new names only) — no OOB, no NaN, brightness non-zero at rest.
3. Playlist YAML loads through `PlaylistManager` with zero warnings; every
   `defaults` key matches an existing `slider*` export.
4. Engine boot on a **scratch port** (never 6966-6972 / 6981 / 5568):
   `node engine.js --model titanic_interior --pattern 131_river_run` with the
   API/sACN ports overridden; confirm playlist list shows the 3 new names.
5. Sim render via `.agent/skills/see_the_world.md` (`agent_render.cjs` on the
   `titanic_interior` scene, `--viewport 1280x720`) — one frame per pattern,
   two frames 1 s apart for 131 and 134 to prove motion; inspect PNGs.
   Never use built-in browser tools for this.
6. Run `python scripts/security_check.py --staged` before any commit; commit
   only when asked. Report engine `states/` residue, don't revert it.

Bans: no edits to timeline files or other scenes' playlists, no destructive
git, no servers left running, no new ports in the reserved set.
