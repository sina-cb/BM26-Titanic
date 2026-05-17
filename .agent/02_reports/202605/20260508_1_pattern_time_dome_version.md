# Pattern Tuning Report: Timing, Speed, Color, and Global Parameters

Date: 2026-05-08
Scope: `marsin_engine` production patterns `00_*` through `25_*`, MarsinEngine render loop, CPC routing, and CaptainPad parameter display.

## 1. Executive Summary

The current code has the right pieces for global pattern control, but speed is split across two incompatible ideas:

1. The engine currently sends raw wall-clock elapsed seconds into the WASM VM.
2. The Central Parameter Center currently treats `speed` as a pattern-level shared parameter and injects it into pattern exports named `speed`.

For the behavior we want, global speed should be engine-clock speed, not a pattern variable. The global speed fader should map `0..1` into a positive time multiplier, and the render loop should accumulate a separate monotonic pattern clock:

```js
wallDeltaSeconds = (now - lastNow) / 1000
globalMultiplier = speedMin * Math.pow(speedMax / speedMin, globalSpeed01)
patternClockSeconds += wallDeltaSeconds * globalMultiplier
mixer.beginFrame(patternClockSeconds)
```

This avoids the common glitch where code does `elapsed * multiplier`. Multiplying absolute elapsed by a changing multiplier causes jumps. Accumulating scaled deltas changes only the next frame's time step, so visuals keep moving forward smoothly.

The highest-priority pattern work is:

- Move global speed ownership out of pattern exports and into the engine clock.
- Rename pattern speed internals away from `export var speed` / `export function speed(v)` unless they are explicitly local tuning controls.
- Normalize every local control so `v=0.5` is the tuned default.
- Replace all local color pickers and hardcoded hue sets with `colorPalette1` and `colorPalette2`.
- In default mode, selected red + blue should produce only red, blue, black, and controlled interpolation between those two colors. No rainbow drift, section-specific third colors, white sparkle, amber, or UV unless explicitly derived from palette brightness/saturation or exposed as a deliberate local non-default effect.

## 2. Current Code Facts

### 2.1 Engine Timing Path

Current render loop:

- `marsin_engine/engine.js` computes `elapsed = (now - startTime) / 1000`.
- `mixer.beginFrame(elapsed)` forwards the same absolute elapsed time to all channels.
- `PatternMixer.beginFrame()` calls `channel.beginFrame(...)` for every channel.
- `PatternChannel.beginFrame()` calls `wasmHost.beginFrame(handle, elapsedSeconds)`.
- `WasmHost.beginFrame()` calls the WASM `marsin_begin_frame(handle, elapsedSeconds)`.

Current problem:

- There is no engine-level global time accumulator.
- Global CPC `speed` does not currently affect engine elapsed.
- If we change elapsed by doing `elapsed * speedMultiplier`, changing speed live will jump the visual phase.

Recommended engine contract:

- Keep `wallClockSeconds` separate from `patternClockSeconds`.
- Keep `patternClockSeconds` monotonic unless a deliberate hard reset is requested.
- Apply global speed to delta only.
- Never make global speed negative. Direction should be a separate pattern semantic, not a negative engine time.

### 2.2 Pixelblaze Timing Rule

Marsin PB language docs state:

```text
time(scale) period = 65.536 * scale seconds
```

So smaller `time()` scale means faster. This is the source of many current speed inversions. For example, `time(0.01)` loops in about `0.655s`, while `time(0.1)` loops in about `6.554s`.

### 2.3 CPC Routing Today

`ParamCenter` defines normalized global params:

- `speed`
- `direction`
- `count`
- `size`
- `rotate`
- `colorPalette1`
- `colorPalette2`

It registers any pattern export with the exact shared name, regardless of export kind. This means current patterns that declare `export var speed` are accidentally CPC-owned even if the pattern also has a local `sliderSpeed(v)` that writes the same variable.

That creates two problems:

- Global speed writes raw `0..1` directly into pattern variables that expect local timing constants.
- Local `sliderSpeed` and CPC `speed` can fight over the same variable.

Recommendation:

- Global `speed` should remain in CPC UI/state, but the engine render loop should consume it directly for engine clock scaling.
- Once global speed owns the engine clock, `ParamCenter` should not inject `speed` into patterns.
- Pattern-local speed should use a different name, such as `sliderLocalSpeed(v)` or `sliderSpeedTrim(v)`, and write an internal variable such as `localSpeedMultiplier`, `clockScale`, or `baseInterval`.

### 2.4 CaptainPad Default Value Problem

Current API serialization:

- `/mixer` returns exports from `wasmHost.getExports(c.handle)`.
- It only attaches `e.v0/e.v1/e.v2` if `channel.localControls[e.id]` exists.
- Untouched controls have no `v0`.

Current CaptainPad display:

- Deck and mixer parameter faders use `exp.v0 ?? 0.5`.
- That means the UI shows center by default even when the pattern's actual top-level default is not equivalent to `0.5`.

Recommended default contract:

- All controllable params are normalized `0..1`.
- All pattern local control functions should make `v=0.5` equal the tuned default.
- On compile/load, the server should initialize all visible local sliders into `channel.localControls` with their normalized default, usually `0.5`, and apply those values to the VM. Toggles default to `0`, triggers to `0`, color pickers should mostly disappear in favor of global palettes.
- Longer term, expose default metadata from the compiler or a source annotation, but the fastest consistent rule is: local slider center equals authored default.

## 3. Recommended Timing Architecture

### 3.1 Global Speed

Global speed is a normalized control:

- `0.0` maps to the minimum global movement rate.
- `1.0` maps to the maximum global movement rate.
- It is separate from future audio BPM. BPM can later multiply or replace the same engine-clock multiplier, but no BPM code is needed for this pattern tuning pass.

Recommended formula:

```js
const speed01 = clamp(globalSpeed, 0, 1)
const minMult = 0.25
const maxMult = 4.0
const globalMultiplier = minMult * Math.pow(maxMult / minMult, speed01)
```

Why exponential:

- Speed perception is multiplicative.
- `0.5` lands at `1.0x` when min/max are reciprocal (`0.25x..4x`).
- The fader feels useful across the whole travel instead of bunching all usable values near one end.

Recommended render-loop state:

```js
let lastNow = performance.now()
let patternClockSeconds = 0

function tick() {
  const now = performance.now()
  const wallDeltaSeconds = Math.max(0, (now - lastNow) / 1000)
  lastNow = now

  const speed01 = paramCenter ? paramCenter.getAll().speed : 0.5
  const globalMultiplier = mapSpeed01ToMultiplier(speed01)

  patternClockSeconds += wallDeltaSeconds * globalMultiplier

  if (paramCenter) paramCenter.flushDirty(mixer.wasmHost)
  mixer.beginFrame(patternClockSeconds)
}
```

This is the key point: update an accumulated clock with scaled delta. Do not pass `wallElapsed * multiplier`.

### 3.2 Future BPM

Future audio analysis can feed a BPM-derived multiplier into the same accumulator:

```js
audioMultiplier = bpm / referenceBpm
globalMultiplier = speedRangeMultiplier * audioMultiplier
```

Keep this separate for now. The pattern tuning work should make every pattern look right at global speed `0.5`, then verify `0.0` and `1.0` are still usable.

### 3.3 Local Pattern Speed

Local pattern speed is only a development/tuning trim. It can be allowed to phase-jump if it changes live, because it will eventually be fixed or hidden.

Recommended local trim:

```js
localMultiplier = pow(2.0, (v - 0.5) * 4.0)
```

This maps:

- `v=0.0` to `0.25x`
- `v=0.5` to `1.0x`
- `v=1.0` to `4.0x`

For `time(scale)` patterns:

```js
phase = time(baseInterval / localMultiplier)
```

For manual accumulator patterns:

```js
phase += (delta / 1000.0) * localMultiplier / basePeriodSeconds
phase = phase - floor(phase)
```

Because global speed is handled at the engine clock, patterns should not also multiply by global speed internally.

## 4. Speed Audit Table

Legend:

- `Engine` means should be controlled by global engine clock.
- `Local` means should remain a pattern-only tuning trim.
- `Conflict` means CPC currently sees a `speed` export while a local slider also writes speed-related state.

| Pattern | Current Timing | Current Issue | Action |
|---|---|---|---|
| `00_golden_hour_wash` | `time(fadeSpeed)`, `sliderFadeSpeed` | No CPC speed. Larger `fadeSpeed` is slower. | Add local speed trim; tune `baseInterval`; global speed should come from engine clock. |
| `01_cylon_sweep` | Manual `scanT += delta / timeScale`; has `speed(v)` | Higher `v` is currently faster and phase-stable. But `speed` should not be global once engine clock owns speed. | Rename to local trim or remove after tuning. Keep manual accumulator if delta is verified. |
| `02_phase_cathedral` | Manual `beatPhase += delta / animSpeed`; has `speed(v)` | `speed(v)` increases `animSpeed`, which slows motion. | Invert local mapping or convert to multiplier. Keep `count/size/direction`. |
| `03_dual_axis_crush` | Manual `attackPos += delta / animSpeed`; has `speed(v)` | Same inversion problem as 02. | Invert local speed; keep `count/size/direction`, but fix count semantics. |
| `04_beat_folded_helix` | Manual `masterTime += delta`; `speed` variable multiplies motion | CPC owns exported var `speed` and local `sliderSpeed` also writes it. | Rename internal speed; map `count` to arms, `direction` to spin/tunnel sign. |
| `05_orbital_attractor_field` | `time(speed)` | CPC/local conflict. Larger speed interval is slower. | Replace `export var speed` with internal interval; add `colorPalette1/2`, `size`, maybe `direction`. |
| `06_neon_elevator` | `time(speed)` | CPC/local conflict. Larger speed interval is slower. | Global engine clock plus local trim; map `count=steps`, `size=thickness`, `direction=elevator up/down`. |
| `07_shimmer` | `time(speed)` and `time(shimmerSpeed)` | CPC sees `speed` var; both timing sliders use larger interval = slower. | Split macro/local shimmer trim; default both tuned at center; global engine clock drives both. |
| `08_ocean_liner` | `time(timeScale * 0.5/2.0)` | Local slider is correctly inverted but no CPC/global mapping. | Keep local trim; map `count=windowCount`, `size=windowFocus`; global speed via engine. |
| `09_cyclone` | `time(speed)`, plus hardcoded `time(0.3)` sparkle | CPC/local conflict. `sliderSpeed(0)` can create `time(0)`. Larger speed is slower. | Use positive base interval; scale sparkle with same local/global timing or explicitly mark exempt. |
| `10_chasers` | `time(speed)`, plus per-particle `time(lifeSpeed)` | CPC/local conflict. Main speed larger is slower. Life clocks are hardcoded. | Use engine clock; make life clock ratios tied to base interval. |
| `11_bioluminescence` | `time(speed)`, `time(speed*0.5)`, hardcoded `time(0.1)` strobe | CPC/local conflict. Larger speed is slower. | Tie party/strobe clock to tuned base or mark as local effect disabled by default. |
| `12_breathing` | `time(speed)` | CPC/local conflict. Larger speed is slower. | Use base breathing interval; `size` or local ripple controls spatial offset. |
| `13_sparkle` | `time(bgFadeSpeed)`, `time(sparkleSpeed)` | No CPC speed. Both sliders use larger interval = slower. | Decide primary clock: background fade follows global, sparkle rate local ratio. |
| `14_lunar_current` | `time(speed)`, `time(speed*0.43)` | CPC/local conflict. Larger speed is slower. | Use base interval + ratios; map `count=density`, possible `direction=drift sign`. |
| `15_silk_prism_ribbons` | `time(speed)`, `time(speed*0.31)` | CPC/local conflict. Larger speed is slower. | Use engine clock; map `count=ribbonCount`, `size=softness`. |
| `16_ghost_tide_uv` | `time(speed)`, `time(speed*0.57)` | CPC/local conflict. Larger speed is slower. | Use engine clock; map `size=tideWidth`; W/UV should be palette-derived or local. |
| `17_rolling_color_dunes` | `time(speed)`, `time(speed*0.29)` | CPC/local conflict. Larger speed is slower. | Use engine clock; map `size=scale`; color must be cp1/cp2 only. |
| `18_deep_space_lattice` | `time(speed)`, `time(speed*0.41)` | CPC/local conflict. Larger speed is slower. | Use engine clock; map `count=latticeScale`, `size=lineSoftness`. |
| `19_swaying_lattice_ballet` | `time(timeScale)` with inverted local slider | Local speed is directionally correct; no CPC speed export. | Keep local trim; add global `count/size/direction` names. |
| `20_parametric_sway_field` | `time(timeScale)` with inverted local slider | Local speed is directionally correct; no CPC speed export. | Keep local trim; map `size=reach`, possible `direction=sway sign`. |
| `21_pelagic_manta_rays` | `time(timeScale)` with inverted local slider | Local speed is directionally correct; no CPC speed export. | Keep local trim; map `size=raySpan`, maybe `direction=swim sign`. |
| `22_abyssal_sway_garden` | `time(timeScale)` with inverted local slider | Local speed is directionally correct; no CPC speed export. | Keep local trim; map `count=stalkCount`, `size=causticScale/softness`. |
| `23_prismatic_strange_attractors` | `time(speed)` with inverted local slider | Local slider is directionally correct, but CPC owns raw `speed` var too. | Rename internal speed; map `size=orbitReach`, `count/chaos` carefully. |
| `24_chromatic_murmuration` | `time(speed)` with inverted local slider | Local slider is directionally correct, but CPC owns raw `speed` var too. | Rename internal speed; map `count=filamentDensity`, `size=flockReach`. |
| `25_heartbeat` | `time(timeScale)` with inverted local slider | Local speed is directionally correct; no CPC speed export. | Make heartbeat cadence follow engine clock; map `size=rippleSweep`; replace section colors. |

## 5. Color Audit Table

Target default color contract:

- Pattern exports `colorPalette1(h,s,v)` and `colorPalette2(h,s,v)`.
- Default output uses only palette 1, palette 2, black, and controlled interpolation between palette 1 and 2.
- Local hue shifts are allowed only as explicit local controls and should default to zero/no shift.
- Section/group color variation may choose palette 1, palette 2, or a blend between them. It should not introduce third hardcoded colors by default.
- White, amber, and UV emitters should be disabled by default or derived from palette brightness/saturation in a documented way.

| Pattern | Current Color Source | Strict Palette Status | Action |
|---|---|---|---|
| `00_golden_hour_wash` | Manual `rgbwau` warm wash | Not compliant. Hardcoded warm/red/amber behavior. | Add cp1/cp2. Use cp1/cp2 blend over noise; W/A only derived from palette or local effect. |
| `01_cylon_sweep` | `colorPalette1` only, RGBWAU blowout to W/A | Partly compliant. No cp2; W/A can add non-palette light. | Use cp1 beam and cp2 background/accent. Gate W/A as palette-derived blowout. |
| `02_phase_cathedral` | `colorPalette1/2`, plus W/A on vintage section | Mostly hue compliant, but W/A adds non-palette output. | Keep cp1/cp2 sign-field logic; make vintage W/A optional or palette-derived. |
| `03_dual_axis_crush` | `colorPalette1` plus `sliderHueSpread` | Not strict by default because hueSpread creates outside hues. | Add cp2 and interpolate trail from cp1 to cp2. Set hue spread local default to 0 or remove. |
| `04_beat_folded_helix` | Time/depth rainbow hue cycle | Not compliant. | Replace hue cycle with cp1/cp2 strand/depth blend. |
| `05_orbital_attractor_field` | `hsvPickerBaseColor` plus colorSpread hue drift | Not compliant by default. | Add cp1/cp2; distance field blends only between them. Local colorSpread defaults to 0 or limits to cp1/cp2. |
| `06_neon_elevator` | Three local HSV pickers: bottom/top/arrival | Not globally compliant. | Map bottom=cp1, top=cp2, arrival=palette-derived brightness/white only if enabled. |
| `07_shimmer` | Base hue plus sinusoidal hue spread | Not compliant by default. | Base wash cp1; shimmer glints cp2; hue spread default 0 or cp1/cp2 interpolation only. |
| `08_ocean_liner` | Water/window local pickers | Not globally compliant. | Water=cp1, windows=cp2. Keep saturation/value from palettes. |
| `09_cyclone` | Two local pickers plus midpoint and white sparkle overlay | Partly conceptually two-color, but not CPC and sparkle can desaturate. | cp1/cp2 cyclone arms; midpoint must be interpolation; sparkle should be cp1/cp2 brightness, not new hue/white by default. |
| `10_chasers` | Base and tail local pickers | Not CPC. | Lead=cp1, tail=cp2. No extra hue drift. |
| `11_bioluminescence` | Base local picker plus UV and party strobe | Not strict. | cp1 ambient, cp2 burst/crest. UV/party disabled by default or palette-derived. |
| `12_breathing` | One local color picker | Not two-palette. | Inhale/exhale or center/edge blend between cp1/cp2. |
| `13_sparkle` | Three section HSV pickers, white sparkle via desaturation | Not compliant. | Replace section hues with cp1/cp2 assignment/blend; sparkle should use cp2 or palette value, not pure white by default. |
| `14_lunar_current` | One water-tone picker plus W/UV lifts | Not two-palette and W/UV adds non-palette channels. | cp1 current, cp2 caustic/accent; W/UV as optional local lifts. |
| `15_silk_prism_ribbons` | Three local colors A/B/C | Not compliant. | Reduce to cp1/cp2 ribbon blend. Optional third hue must be local non-default effect. |
| `16_ghost_tide_uv` | One mist picker plus W/UV | Not two-palette. | cp1 mist/body, cp2 undertow/accent; W/UV derived or local disabled. |
| `17_rolling_color_dunes` | Low/high local pickers | Conceptually compliant but not CPC. | Rename to cp1/cp2 and preserve shortest-path interpolation. |
| `18_deep_space_lattice` | Base/accent local pickers | Conceptually compliant but not CPC. | Rename to cp1/cp2 and preserve interpolation. |
| `19_swaying_lattice_ballet` | Base/accent local pickers | Conceptually compliant but not CPC. | Rename to cp1/cp2. |
| `20_parametric_sway_field` | Primary/secondary local pickers | Conceptually compliant but not CPC. | Rename to cp1/cp2. |
| `21_pelagic_manta_rays` | Sea/reef local pickers plus W/UV | Not strict because W/UV. | cp1 sea, cp2 reef; W/UV local optional or palette-derived. |
| `22_abyssal_sway_garden` | Deep/kelp local pickers | Conceptually compliant but not CPC. | Rename to cp1/cp2. |
| `23_prismatic_strange_attractors` | Three local colors A/B/C plus W/UV | Not compliant. | Reduce to cp1/cp2. Chaos can affect geometry/brightness, not introduce hue C by default. |
| `24_chromatic_murmuration` | Three local hues plus hueDrift | Not compliant. | Reduce to cp1/cp2. Hue drift defaults to 0 or remains inside cp1/cp2 interpolation. |
| `25_heartbeat` | Three section HSV pickers and white-hot desaturation | Not compliant. | Core heartbeat cp1, secondary/ripple cp2; white-hot effect optional or palette-derived. |

## 6. Count, Size, and Direction Mapping Proposal

These are lower priority than speed and color, but should be standardized while patterns are being touched.

| Pattern | `count(v)` Proposal | `size(v)` Proposal | `direction(v)` Proposal | Keep Local |
|---|---|---|---|---|
| `00_golden_hour_wash` | None or noise octave count if added | Noise scale / wash softness | None | Local noise character |
| `01_cylon_sweep` | None | Eye width | Scanner direction, already present | Background glow |
| `02_phase_cathedral` | Radial density, already present | Sharpness, already present | Phase direction, already present | Ratio A/B fixed |
| `03_dual_axis_crush` | Number of attack bands, not spacing | Beam width | Attack direction/collapse sign | Hue trail amount local |
| `04_beat_folded_helix` | Arm count | Tunnel beam thickness or contrast | Spin/tunnel direction | Twist frequency/contrast |
| `05_orbital_attractor_field` | Optional attractor count if implemented | Focus/falloff or orbit reach | Orbit direction | Falloff/focus fine tune |
| `06_neon_elevator` | Step count | Floor thickness | Up/down elevator direction | Bloom |
| `07_shimmer` | Shimmer density | Breathing depth or glint size | Macro drift direction if added | Min brightness/breathing |
| `08_ocean_liner` | Window count | Window focus/thickness | Sweep direction if added | Contrast |
| `09_cyclone` | Density | Particle size | Swirl direction if added | Sparkle overlay |
| `10_chasers` | Particle count | Tail length | Travel direction if added | Life variance |
| `11_bioluminescence` | Density | Crest/organism size if added | Drift direction if added | UV/party mode |
| `12_breathing` | None or ripple count if added | Ripple amount or pulse sharpness | Ripple direction if spatial | Sharpness |
| `13_sparkle` | Sparkle density | Sparkle size/decay if added | None | Background/sparkle ratio |
| `14_lunar_current` | Density | Wave width/white lift if needed | Drift direction | W/UV lifts |
| `15_silk_prism_ribbons` | Ribbon count | Softness/width | Ribbon travel direction | Contrast/softness trim |
| `16_ghost_tide_uv` | None or undertow count | Tide width | Tide direction | W/UV levels |
| `17_rolling_color_dunes` | Ridge count if scale split | Dune scale | Roll direction | Contrast |
| `18_deep_space_lattice` | Lattice scale | Line softness | Phase direction if added | None |
| `19_swaying_lattice_ballet` | Density | Width | Sway direction | Softness |
| `20_parametric_sway_field` | Optional node count if added | Reach | Sway direction | Focus/trail blend |
| `21_pelagic_manta_rays` | Optional ray count if added | Ray span | Swim direction | W/UV levels |
| `22_abyssal_sway_garden` | Stalk count | Caustic scale or softness | Current direction | Softness |
| `23_prismatic_strange_attractors` | Chaos/filament density carefully | Orbit reach | Orbit direction | White/UV/dark floor |
| `24_chromatic_murmuration` | Filament density | Flock reach | Orbit direction | Saturation/afterglow |
| `25_heartbeat` | None or beat subdivision if added | Ripple sweep | Ripple direction if enabled | Dormant glow |

## 7. Implementation Order

### Phase 1: Engine Clock

1. Add a global pattern clock accumulator in `engine.js`.
2. Map CPC `speed` `0..1` to a positive multiplier.
3. Pass accumulated `patternClockSeconds` to `mixer.beginFrame(...)`.
4. Stop using CPC `speed` as a pattern export injection once engine clock owns it.
5. Verify changing global speed while a pattern is running produces no visible phase jump.

### Phase 2: Pattern Speed Normalization

For each pattern:

1. Rename internal timing variable away from exported `speed` if CPC can see it.
2. Define tuned default at local trim `0.5`.
3. Use local speed only as development trim.
4. Ensure no `time(0)` can happen.
5. Scale hardcoded secondary clocks from the same base interval or explicitly document them as local/exempt.

Acceptance test per pattern:

- Global speed `0.0`, `0.5`, `1.0` all look usable.
- `0.5` is the intended default.
- Increasing global speed always makes motion faster.
- Changing global speed live does not jump phase.
- Local speed trim may jump, but must never break output or produce frozen/NaN timing.

### Phase 3: Color Palette Compliance

For each pattern:

1. Add `colorPalette1(h,s,v)` and `colorPalette2(h,s,v)`.
2. Replace local color pickers with cp1/cp2.
3. Remove hardcoded third colors from default output.
4. Disable hue drift by default or constrain it to cp1/cp2 interpolation.
5. Audit W/A/U output. White, amber, and UV must be deliberate, palette-derived, or local non-default effects.

Acceptance test:

- Set cp1 red and cp2 blue.
- Default output contains only red, blue, black, and red-blue interpolation.
- No yellow/green/cyan/purple rainbow drift unless cp1/cp2 interpolation genuinely passes through it by selected color path.
- Section routing does not introduce a third hue.

### Phase 4: Default Value Readback

1. Make every local slider's `v=0.5` equal the tuned default.
2. On channel compile, initialize missing visible local controls into `channel.localControls`.
3. Return those values through `/mixer`, so CaptainPad displays the actual applied value.
4. Persist local controls only after user changes, but the initial default snapshot should still be visible.

Acceptance test:

- Load a fresh pattern in deck.
- All local sliders show their actual normalized defaults.
- Moving a slider then switching away/back restores the user-changed value.
- CPC-owned parameters are not shown as local controls.

## 8. Final Recommendation

Do not try to tune pattern speeds by making CPC inject `speed` into every pattern. That will keep causing range problems, accidental conflicts, and phase jumps.

Use CPC `speed` as the global engine-clock control. Then tune every pattern at global speed `0.5` with local speed trim centered at `0.5`. Once the pattern set feels right, the local trim controls can be hidden, frozen, or left as development-only controls.

Color should be stricter than speed: every pattern should default to cp1/cp2 only. Local hue spread, white/amber/UV lift, section colors, party mode, and prismatic third-color behavior are all legitimate artistic tools, but they should not be active in the default global-palette path.
