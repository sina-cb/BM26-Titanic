# Pattern Audit & Color-Bleed Report — May 24, 2026

**Scope:** all production patterns `00_*` through `25_*`.
**Driver:** operator request — "when I choose blue and red for colors, I expect all patterns to be in that gradient and no other colors." Also requires palette compliance, consistent `sliderLocalSpeed`, and engine-owned global speed/size.

## 1. What already shipped in this pass

- **Engine** now owns global SPEED (accumulates a scaled `patternClockSeconds` and passes it to `mixer.beginFrame`) and global SIZE (rebuilds the WASM coord buffer with a uniform scale via `WasmHost.applySizeScale`). No WASM changes were needed.
- **CPC** marks `speed` and `size` as `engineOwned: true`. They still appear in `/param-center/schema` (so the UI / OSC / persistence still work) but are **no longer injected as pattern variables**. Conflict-blocking in `registerChannel` also skips engine-owned entries so `sliderLocalSpeed` is never blocked.
- All 25 production patterns standardized to `localSpeed` / `sliderLocalSpeed` (replaced the inconsistent `speedTrim` / `sliderSpeedTrim` naming).
- Patterns `01-04` had their bare `count(v)` / `size(v)` / `direction(v)` exports converted to proper local sliders (`sliderCount`, `sliderBeamWidth`, `sliderDirection`, etc.) so the per-channel CaptainPad panel surfaces them again.
- `00_golden_hour_wash`'s `export var speed = 0.5;` removed. Its `beforeRender` no longer multiplies by global speed (engine already did).
- Wider, labeled COLORS button on the Deck (`<DualSwatch>` + "EDIT" caption).

## 2. The Color-Bleed Problem

The patterns split into three color-handling families. Only one is strictly palette-clean.

### 2.1 Family A — Manual cp1↔cp2 interpolation (CLEAN)

`00_golden_hour_wash`, `01_cylon_sweep`, `02_phase_cathedral`, `03_dual_axis_crush`, `04_beat_folded_helix`.

These compute a shortest-path hue interpolation between cp1H and cp2H, then either call `hsv(h, s, v)` or do manual hsv→rgb. Setting cp1=red and cp2=blue yields *only* the red→blue path (going through purple). **No fix required.**

### 2.2 Family B — `hsv()` with palette-derived hue (CLEAN)

`07_shimmer`, `08_ocean_liner`, `12_breathing`, `13_sparkle`, `15_silk_prism_ribbons`, `17_rolling_color_dunes`, `18_deep_space_lattice`, `19_swaying_lattice_ballet`, `20_parametric_sway_field`, `22_abyssal_sway_garden`, `24_chromatic_murmuration`, `25_heartbeat`.

These call `hsv(h, s, v)` where `h` is built from cp1H/cp2H + a noise/phase weight. As long as the weight stays in [0,1] and the dh wrap-around is shortest-path (typical), output is strictly on the cp1↔cp2 line. **No fix required** *unless* the audit table below flags a wraparound bug.

### 2.3 Family C — **Rainbow synthesis (BROKEN palette compliance)**

`05_orbital_attractor_field`, `06_neon_elevator`, `11_bioluminescence`, `14_lunar_current`, `16_ghost_tide_uv`, `21_pelagic_manta_rays`, `23_prismatic_strange_attractors`.

These compute RGB directly via the rainbow trick:

```js
var r = val * wave(hue + 0.000);
var g = val * wave(hue + 0.333);
var b = val * wave(hue + 0.666);
```

`wave(h + 0.333)` outputs a green channel at *every* hue position; `wave(h + 0.666)` outputs blue at every position. The OUTPUT is a full-spectrum rainbow as `hue` varies — **even if `hue` is constrained to the cp1↔cp2 path, the rendered colors are not.** Pick cp1=red and cp2=blue: you'll still see green at certain pixels because the algorithm itself injects green at `wave(hue + 0.333)` ≠ 0.

**Fix:** replace the three-wave RGB synthesis with one of:

1. **Cleanest (Family A pattern):** compute `h` = shortest-path cp1H↔cp2H interp, then `hsv(h, s, v)`. One-line replacement.
2. If the W/UV/A channels were the actual creative payload, keep the brightness curve and emit `hsv(h, s, v)` for RGB while keeping W/UV/A as palette-derived (e.g. `w = val * (1 - sat)` to push white where saturation drops) rather than independent constants.

I recommend option **1** for all seven patterns; W/UV behavior should move behind a `sliderExtraEmitters` toggle (defaulting OFF) per §2.4 below.

### 2.4 Hardcoded W/A/U Emitters (PARTIAL BLEED)

Several Family A and Family C patterns write to White, Amber, or UV channels independent of cp1/cp2. On RGB-only fixtures these are silent; on RGBW/RGBA/RGBWAU rigs (which is what BM26 has) they bleed in non-palette light.

| Pattern | What it writes | Fix |
|---|---|---|
| `01_cylon_sweep` | `hardwareWhite`, `hardwareAmber` blowout at intensity > 0.9 | Gate behind a `sliderEmitterBlowout` (default 0). Or derive `w = blowout * (1 - cp1S)` so it's only triggered by palette desaturation |
| `02_phase_cathedral` | `finalW`, `finalA`, `finalU` — all three emitters | Replace with palette-derived: `w = val * (1 - sat)` etc. or gate behind toggle |
| `04_beat_folded_helix` | `outW`, `outA` | Gate behind toggle |
| `05_orbital_attractor_field` | `outW`, `outA` | Gate behind toggle (combined with §2.3 rewrite) |
| `06_neon_elevator` | `outW`, `outA` | Gate behind toggle (combined with §2.3 rewrite) |
| `11_bioluminescence` | `outW`, `outU` (UV) | Gate behind toggle (combined with §2.3 rewrite) |
| `14_lunar_current` | `white`, `uv` | Gate behind toggle (combined with §2.3 rewrite) |
| `16_ghost_tide_uv` | `white`, `uv` — *the pattern is named for it* | Surface `sliderWhiteLift` + `sliderUvLift` with both defaulting to 0; keep the named feature opt-in |
| `21_pelagic_manta_rays` | `white`, `uv` | Gate behind toggle (combined with §2.3 rewrite) |
| `23_prismatic_strange_attractors` | `white`, `uv` | Gate behind toggle (combined with §2.3 rewrite) |

**Recommended toggle name:** `togglerExtraEmitters` (default 0). When 0, all W/A/U writes are forced to 0 regardless of the pattern's internal logic. When 1, the pattern's original behavior returns — but ideally re-derived from cp1/cp2 instead of constants. Three patterns where the W/UV is the *point* (`13_sparkle` white-hot, `16_ghost_tide_uv`, `21_pelagic_manta_rays`) deserve named local sliders instead of a bool.

### 2.5 Other findings worth flagging

- `09_cyclone` uses `time(0.3)` hardcoded for the star sparkle layer — that's a secondary clock that **bypasses the engine's global speed scaling and `localMultiplier`**. With the engine-clock change, this sparkle now runs at wall-clock rate while the rest of the pattern runs at scaled rate. Fix: replace `time(0.3)` with `time(0.3 / localMultiplier)` (or remove the sparkle entirely behind a toggle).
- `10_chasers` has per-particle `lifeSpeed = (... ) / localMultiplier` — works correctly with engine clock. ✓
- `25_heartbeat` uses `hsv(...)` so it's Family B-clean, but check that section colors collapse to cp1/cp2 (no per-section third hue).

## 3. Mass-Migration Plan (next focused turn)

A single sweep with the following per-pattern actions. Each pattern gets:

1. **Family C surgery** (if applicable): replace `wave(hue + 0/.333/.666)` with `hsv(h, s, v)` driven by cp1↔cp2 shortest-path interpolation.
2. **W/A/U gating**: introduce `togglerExtraEmitters` (or named slider for the 3 emitter-centric patterns), default 0, force W=A=U=0 when off.
3. **Hardcoded clock fix** (`09_cyclone` only): bind sparkle clock to `localMultiplier`.
4. **Final verification**: search for any `0.333` / `0.666` / hardcoded RGB writes / hardcoded W/A/U > 0; sanity-check.

### Estimated effort

| Batch | Patterns | Work | Risk |
|---|---|---|---|
| **C1** | 5, 6, 11, 14 — Family-C quartet | Algorithmic surgery × 4 (~30 lines each) | Medium — need visual confirm after each |
| **C2** | 16, 21, 23 — Family-C with named UV/W slot | Surgery + named sliders | Medium |
| **D1** | 1, 2, 4, 9 — emitter gating + cyclone clock fix | Mostly mechanical toggle wrap | Low |
| **D2** | 13, 25 — Family-B verify cp1↔cp2 strictness | Sanity check, possibly minor rework | Low |

**Total:** ~13 patterns receive substantive edits, ~12 patterns are already clean. One sitting should land it.

## 4. Acceptance Tests (post-migration)

For each pattern:

1. Set cp1=red (0°), cp2=blue (240°). Scan the rig visually:
   - Pass: only red, blue, magenta, deep purple — no green, no cyan, no yellow, no white sparkle, no UV.
2. Set global SPEED=0, watch for ~5 seconds: motion should stop (or near-stop). Set SPEED=1: motion should be visibly ~4× the SPEED=0.5 baseline. No phase jumps on slider drag.
3. Set global SIZE=0: pattern features densely tiled. SIZE=1: features 4× larger than baseline. No artifacts on slider drag.
4. Local sliders (count / direction / beamWidth / etc.) on patterns 01-04 visible and functional in CaptainPad.

---

## Appendix A — Per-Pattern Status Snapshot

| # | Pattern | Family | Speed | Locals | Palette | Action this turn | Action next turn |
|---|---|---|---|---|---|---|---|
| 00 | golden_hour_wash | A | ✓ | sliderNoiseScale | ✓ clean | removed `var speed`, restructured beforeRender | — |
| 01 | cylon_sweep | A | ✓ | sliderBeamWidth, sliderBgGlow, sliderDirection | ✓ clean | renamed locals | W/A blowout gate |
| 02 | phase_cathedral | A | ✓ | sliderCount, sliderSharpness, sliderDirection | ✓ clean | renamed locals | W/A/U gate |
| 03 | dual_axis_crush | A | ✓ | sliderCount, sliderBeamWidth, sliderDirection | ✓ clean | renamed locals | — |
| 04 | beat_folded_helix | A | ✓ | sliderCount, sliderTwistFreq | ✓ clean | renamed locals | W/A gate |
| 05 | orbital_attractor_field | **C** | ✓ | — | ❌ rainbow | speed name | **rewrite hue→hsv** |
| 06 | neon_elevator | **C** | ✓ | — | ❌ rainbow | speed name | **rewrite hue→hsv** |
| 07 | shimmer | B | ✓ | — | ✓ clean | speed name | — |
| 08 | ocean_liner | B | ✓ | — | ✓ clean | speed name | — |
| 09 | cyclone | B | ✓ | — | ✓ clean | speed name | **fix hardcoded time(0.3) sparkle** |
| 10 | chasers | B | ✓ | — | ✓ clean | speed name | — |
| 11 | bioluminescence | **C** | ✓ | — | ❌ rainbow | speed name | **rewrite hue→hsv + W/UV gate** |
| 12 | breathing | B | ✓ | — | ✓ clean | speed name | — |
| 13 | sparkle | B | ✓ | — | ✓ clean | speed name | verify section hues |
| 14 | lunar_current | **C** | ✓ | — | ❌ rainbow | speed name | **rewrite hue→hsv + W/UV gate** |
| 15 | silk_prism_ribbons | B | ✓ | — | ✓ clean | speed name | — |
| 16 | ghost_tide_uv | **C** | ✓ | — | ❌ rainbow | speed name | **rewrite hue→hsv; W/UV stays as named local slider** |
| 17 | rolling_color_dunes | B | ✓ | — | ✓ clean | speed name | — |
| 18 | deep_space_lattice | B | ✓ | — | ✓ clean | speed name | — |
| 19 | swaying_lattice_ballet | B | ✓ | — | ✓ clean | speed name | — |
| 20 | parametric_sway_field | B | ✓ | — | ✓ clean | speed name | — |
| 21 | pelagic_manta_rays | **C** | ✓ | — | ❌ rainbow | speed name | **rewrite hue→hsv + W/UV gate** |
| 22 | abyssal_sway_garden | B | ✓ | — | ✓ clean | speed name | — |
| 23 | prismatic_strange_attractors | **C** | ✓ | — | ❌ rainbow | speed name | **rewrite hue→hsv + W/UV gate** |
| 24 | chromatic_murmuration | B | ✓ | — | ✓ clean | speed name | — |
| 25 | heartbeat | B | ✓ | — | ✓ clean | speed name | verify section hues |
