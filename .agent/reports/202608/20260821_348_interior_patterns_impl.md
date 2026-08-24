# 348 — `titanic_interior` flow patterns + playlists: implementation

Implements the Fable spec `20260821_347_interior_patterns_spec.md`: five interior
patterns and three playlists for the `titanic_interior` scene, plus one
operator-reported launcher fix folded in mid-wave (§6).

## 1. Files

### New patterns — `marsin_engine/patterns/`

| File | What it is | Sliders (declaration = MFT knob order) |
|---|---|---|
| `131_river_run.js` | the default laminar current: 3 aperiodic eddies travelling along `u`, cp1 body, cp2 accent on the faster eddy, foam on the sharpest crest | localSpeed, direction, level, cohesion, turbulence, whiteFoam |
| `132_tide_pools.js` | slow fill/spill/drain with the Seg1/Seg2 seam as a weir; ~20 s cycle, phase-staggered per line | localSpeed, fill, spillGain, stagger, whiteFoam |
| `133_counter_current.js` | six independent rivers — odd lineIds counter-flow, walls hold different hues and a PHI speed ratio, 3–5 comet drifts per line | localSpeed, direction, density, tail, cohesion, whiteFoam |
| `134_surge.js` | sound-reactive primary: dim floor river + kick-launched wavefronts crossing the full run in ~1.2 s with a foam flash at the lip | localSpeed, direction, surge, width, stagger, whiteFoam |
| `135_bilge_glow.js` | near-static warm rest state: caustic shimmer (two `wave()` products on irrational ratios) with rare cp2 glints | localSpeed, level, shimmer, glintRate, whiteFoam |

Registered in `marsin_engine/patterns/manifest.json` in numeric order after
`130_spatial_paint`.

Every pattern derives geometry from `render3D(index, x, y, z)` normalised coords
only — `u = x`, `SEAM = 0.5454545` (world `x = 0.5`), `lineId = wall*3 + tier`
from `(z, y)`, per-line offsets from the golden angle. No `fId`/`index`, no
fixture metadata, no hard-coded 180/150. `travelOf(u)` compresses Seg2 by
`SEG2_FLOW = 1.15` so the current speeds up downstream **without** a seam in the
wave (131, 134); 132 is the one composition that uses the seam as a feature.

### New playlists — `simulation/scenes/titanic_interior/playlists/`

| File | Entries in order | Modulations |
|---|---|---|
| `default.yaml` | 131 → 135 → 132 → 134 → 133 | only the 134 entry (surge←micKick, width←micLow, localSpeed←micFlux) |
| `flow.yaml` | 131 (cohesion 0.8) → 132 → 133 (cohesion 0.3) → 131 (`river_wild`: cohesion 0.2, turbulence 0.7) → 135 | none |
| `flow_sound.yaml` | 134 (stagger 0.4) → 131 → 133 → 134 (`surge_unison`, stagger 0) → 132 | every entry carries its §2 hook as a `cpc` continuous modulation, `mode: override`, `polarity: unipolar` |

Entry ids follow `e_<playlist>_<n>_<pattern>`; **every** slider export is set
explicitly in `defaults` (verified mechanically, §3.3), and each modulated
slider's default equals its modulation range floor, matching the shape of
`scenes/titanic/playlists/ambient_sound_reactive.yaml`. `default.yaml` was
written before any engine boot, so the engine never generated an empty one.
Shuffle is not a playlist field and was not added anywhere.

## 2. Deviations from the spec (all deliberate, none silent)

1. **Audio header curve vocabulary.** The spec writes the sound hooks in the
   PLAYLIST curve vocabulary (`easeOut`/`easeIn`). The pattern-source
   `AUDIO_MODULATION_V1` header has its own three-token vocabulary
   (`linear|pow2|ease`, mapped to `linear|easeIn|easeOut` by
   `tools/audio_mod_spec.mjs`), and `tests/tools/audio_mod_spec.test.mjs`
   rejects anything else. Headers therefore use `ease` where the spec says
   easeOut and `pow2` where it says easeIn; the playlist YAMLs carry the
   spec's `easeOut`/`easeIn` verbatim. Same curve, two spellings.
2. **Curve where the spec is silent** (131 turbulence←micFlux, 133
   density←micHigh, 134 width←micLow) → `linear`, the least-invented choice.
3. **134's floor.** The spec's prose says "flux raises the floor" while its
   mapping table says `localSpeed ← micFlux`. The mapping table is what the
   playlists must carry, so flux drives the clock; the floor is lifted by
   `surge` instead.
4. **133 `cohesion` snaps the heading** at 0.62 rather than blending it. A
   blended heading crosses zero mid-range and leaves the odd lines *stalled* —
   not a river. Speed ratio and hue still blend continuously.
5. **132 keeps a shallow "wet" sheen** (~0.065–0.11) on the drained stretch,
   above the spec's 0.02 floor. At 0.02 the un-pooled part of the line renders
   as a bare unlit strand in the sim; the sheen keeps both segments readable at
   every phase, which the render gate requires.
6. **131 brightness/palette balance was tuned against the renders** (§5): the
   crest gain stops short of full scale and cp2 is a narrow accent rather than a
   co-lead, because the default cp2 is a half-saturated warm white and a broad
   blend bleaches the whole line instead of tipping a crest.

## 3. Validation

### 3.1 Engine suite — `cd marsin_engine && npm test`

**4028 tests · 4023 pass · 5 fail · 0 skipped · 0 todo** (~4.5 min).

All 5 failures are **pre-existing, from other agents' uncommitted work in this
working tree**, and none names a file from this wave:

| Failing test | Why it fails | Owner |
|---|---|---|
| `every model file under models/ is discovered` | pinned count 9, tree now has 10 (`titanic_interior` + `dev_test_bench`) | the `_346` scene wave (untracked model) |
| `titanic_interior: cross-fixture (universe,channel) overlap count is pinned` | "no pinned overlap expectation — add one" for the new model | the `_346` scene wave |
| `qualified package … EQ-rise companion` | `party_dancers_eq` | unrelated |
| `every non-diagnostic Ambient reuse inherits the canonical static entry` | `titanic/night_ember_hold.yaml` modulation drift | the night-arc wave (untracked playlists) |
| `the committed playlist tree is synchronized by the permanent tool` | 8 untracked `titanic`/`test_bench` night-arc playlists | the night-arc wave |

Both `audio_mod_spec` tests that initially rejected the pattern headers now pass
(deviation §2.1 was the fix).

### 3.2 Cross-model param sweep — `tools/param_truth`, `titanic_interior` with
`--cross-model test_bench`, output written outside the repo

**5 patterns ok, 0 compile errors, 0 DEAD.** `TRUE 15 · WEAK 0 · WRONG 7 ·
UNKNOWN_CLAIM 6`. The 7 WRONG rows are two known, explained classes:

- **`sliderWhiteFoam` ×5 — `white_amber_emitters_unchanged`.** The harness reads
  the VM's W lane, which is byte-zero by design: per spec §1 these patterns emit
  **RGB only** and let the rig derive white. Measured through the real wire path
  (`simulation/src/dmx/sacn_mapper.js` → `led_wire.js`, palettes pinned to the
  spec's cp1/cp2), the W byte **does** move with the slider — e.g. peak W
  `123 → 211` on `133_counter_current`, mean W `19.1 → 28.3`; `132_tide_pools`
  peak `7 → 12`. The harness also records that each sweep moved `contrastRatio`
  by 0.19–0.90, i.e. the control is far from dead. This is a
  measurement-domain mismatch, not a pattern defect.
- **`133 sliderDirection` — `no_reversal_net_travel_or_velocity_series`.** This
  is the harness's own documented limitation for mirror-symmetric motion: the
  pattern's whole identity is that odd and even lines flow *opposite* ways, so
  rig-wide net travel cancels by construction and flipping the knob swaps which
  lines go which way. Genuinely unobservable as net drift; the sweep still moved
  `spatialFreqX`.
- **`132 sliderSpillGain` — BRIGHTNESS ratio 1.13 (threshold 1.25), monotonic.**
  The fall is a narrow band at the lip active for ~24 % of a 20 s cycle, so it
  cannot move whole-rig mean luma by 1.25×. It is monotonic and moved
  `contrastRatio` by 0.19. Gain was already widened once during this wave.

### 3.3 Offline render contract (scratch harness, both models)

Per pattern, 200 frames after 40 warmup at code defaults:

- **0 out-of-range or non-finite channel bytes** on `titanic_interior` and on
  `test_bench` (nothing crashes on the bench).
- **Both segments always lit**: minimum per-frame mean luma per segment ranges
  6.7–27.3 across the five patterns on the interior — never zero, never flat.
- **Motion present** on every pattern on both models.
- Slider export order confirmed as declared, with `sliderDirection` second
  wherever it exists.

### 3.4 Playlist load

All three load through `PlaylistManager` with **zero playlist warnings**, no
`_missing` entries, every `defaults` key resolving to a declared `slider*`
export, every declared slider present, and every modulation target valid.

### 3.5 Engine boot on a scratch port

`node engine.js --model titanic_interior --pattern 131_river_run` on a scratch
API port in the 17xxx range, sACN pointed at a TEST-NET blackhole address, with
`MARSIN_STATE_DIR` and `MARSIN_TIMELINE_DIR` redirected outside the repo:

```
✅ Model loaded: 1980 pixels
✅ Pattern compiled via MarsinCompiler (bytecode)
✅ Shared DMX mapper: 1980/1980 pixels patched across 18 universe(s) [1..9, 11..19]
[sACN Out] Sender started — 18 universe(s)
✅ Playlist library: 3 playlist(s) in .../scenes/titanic_interior/playlists
⚠ [revert] 3/4 playlist 'default' loaded on the deck
[Deck] precompiled next entry '135_bilge_glow' into warm slot
[Deck] precompiled next entry '132_tide_pools' into warm slot
```

The engine's timeline auto-write landed in the redirected scratch directory, so
the scene's foreign-owned `timeline/playa_default.yaml` was never touched. A
first attempt failed loudly on `BM26_CAPTAINPAD_AUTH_REQUIRED` before binding
anything — expected for a bare scratch boot.

### 3.6 Sim renders — `.agent/skills/see_the_world.md`

Rendered on the **`titanic_interior`** scene at 1280×720 through the sim's own
in-browser pattern engine (`lighting_mode=pixelblaze`), so no sACN was streamed
and no reserved port was bound, killed or restarted. Palettes pinned to the
spec's cp1/cp2. All five patterns were rendered and **visually inspected**;
`131` and `134` additionally have a second frame 1 s later, and both pairs are
byte-different (motion proven).

| Pattern | Front | Front +1 s | Three-quarter |
|---|---|---|---|
| `131_river_run` | `.agent_renders/1787423149_131_river_run_ti_pat_front.png` | `1787423150_..._t1.png` | `1787423159_131_river_run_ti_pat_threequarter.png` |
| `134_surge` | `.agent_renders/1787423165_134_surge_ti_pat_front.png` | `1787423166_..._t1.png` | `1787423174_134_surge_ti_pat_threequarter.png` |
| `132_tide_pools` | `.agent_renders/1787422864_132_tide_pools_ti_pat_front.png` | — | `1787422871_..._threequarter.png` |
| `133_counter_current` | `.agent_renders/1787422876_133_counter_current_ti_pat_front.png` | — | `1787422884_..._threequarter.png` |
| `135_bilge_glow` | `.agent_renders/1787422600_135_bilge_glow_ti_pat_front.png` | — | `1787422610_..._threequarter.png` |

What the frames show: all six lines lit end to end, **both segments** carrying
light with no dark gap at the seam; a deep teal body with brighter travelling
crests on `131`; `132` pooled bright at one end with a visible lighter band at
the seam lip; `133` unmistakably two-coloured — teal on the port wall, magenta
on the starboard — with bright drifts at independent positions per line; `134` a
quiet teal room with one bright near-white wavefront crossing the top line,
gone one second later; `135` deep saturated teal with small scattered glints.
The Pattern Editor's collapsed header and the Shortcuts pill remain visible in a
corner of the frames — cosmetic only, the strands are unobstructed.

### 3.7 Security

`python scripts/security_check.py --all` → **7 findings, none in any file from
this wave.** Six are pre-existing MACs inside the gitignored
`simulation/.scene_backups/`, and one is a pre-existing SSID literal in
`simulation/tests/led_gamma_workflow.test.js`. No commits, no pushes.

## 4. Design notes worth keeping

- **`whiteFoam` is desaturation, not a W lane.** These patterns call `rgb()`
  only. On the LED-strand wire path the composite's shared floor becomes the W
  byte and the fleet's controllers re-extract `W = min(R,G,B)` anyway, so a
  crest desaturated toward `S ≈ 0.1` is what lights the dedicated white emitter.
  Any future harness that judges `whiteFoam` by the VM's W lane will keep
  calling it WRONG; judge it on the wire.
- **The interior's visual budget is narrow.** On the sim's strand preview a very
  dim pixel reads as bare unlit tube and a very bright saturated one blooms to
  white. Every one of these patterns is deliberately composed to sit inside that
  band, which is why the floors are higher and the peaks lower than an exterior
  pattern's.
- **Palettes at runtime come from the CPC globals**, not from the patterns'
  `cp1H/cp2H` defaults — the VM seeds the HSV picker exports independently. The
  declared defaults are the spec's intent, not a guarantee of what the deck
  shows.

## 5. Residue and things the operator should know

1. **Test residue.** `npm test` left two scratch temp files behind:
   `marsin_engine/states/test_bench/.globals_state.yaml.<pid>.tmp` and
   `.mixer_state.yaml.<pid>.tmp` (untracked). Reported, not deleted.
2. **Not mine.** `marsin_engine/states/titanic/*`, the untracked
   `titanic`/`test_bench` night-arc playlists, the untracked
   `models/titanic_interior.*` and `simulation/scenes/titanic_interior/`
   (both from the `_346` wave), and the untracked `patterns/white_only/21..25`
   were all already in the working tree. Untouched.
3. **The whole operator stack went down mid-wave** (ports 6966–6972 stopped
   listening while the last render batch was starting). It was not stopped by
   this thread and was **not** restarted — the ban on touching operator services
   held. The final render set was captured before that.
4. **Two pinned tests need an owner decision, not a patch from me** — the model
   count pin and the `titanic_interior` overlap pin both need the new interior
   model registered in their fixtures. That belongs to the `_346` scene wave.

## 6. Scope add — per-scene launcher boot pattern (`launcher.js`)

Operator-reported: `node launcher.js prod --scene titanic_interior …` died
because the launcher hard-coded one boot pattern for every scene, and
`00_golden_hour_wash` references `FIX_BAR_18` / `FIX_VINTAGE_6` — constants that
exist on `titanic` and on no other model. The interior model exposes only
`FIX_RAW_LED`.

Change (minimal, in launcher style):

- Added `SCENE_DEFAULT_PATTERN = { titanic: '00_golden_hour_wash',
  titanic_interior: '131_river_run' }` next to `DEFAULT_PATTERN`, with
  `defaultPatternForScene(scene)` returning `DEFAULT_PATTERN` for any scene with
  no entry — that is the shipped behaviour preserved, not a new fallback.
- `parseArgs` now leaves `opts.pattern` `null` through the argv loop and resolves
  it once at the end from the **resolved** `--scene`, so `--scene` may appear
  after `--pattern` on the line and an explicit `--pattern` always wins.
- `--help` now states that the default is per scene and prints the map.

Validation (no prod ports touched):

- `node --check launcher.js` clean; `node launcher.js --help` renders the new
  three-line option text with the map.
- `node --test simulation/tests/launcher_supervision.test.js
  simulation/tests/port_cleanup_arm_interlock.test.js` → **113 tests, 113 pass,
  0 fail** (these are the only launcher-touching suites in the tree).
- Engine-level proof of the new default: the §3.5 boot is exactly
  `--model titanic_interior --pattern 131_river_run` and compiles and patches
  1980/1980 px across 18 universes.

The real `launcher.js prod --scene titanic_interior …` run stays with the
operator — this thread never started or stopped a stack service.
