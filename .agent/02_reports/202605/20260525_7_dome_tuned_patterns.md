# Proposal: Dome-Tuned EDM Show Patterns (Summer Camp Dome)
## Show Language & Spatial Lighting Design Specification

This document serves as the technical and artistic specification for the custom lighting patterns engineered for the **Summer Camp Dome** EDM show. Unlike generic 3D patterns (00–25) that treat all lights as a uniform point cloud, this proposal details a rig-aware visual language that utilizes the physical geometry, vertical layering, and high-contrast fixture clusters of the dome.

The proposal defines **16 creative show patterns**.

---

## 1. Dome Lighting Infrastructure & Geometry

### 1.1 Physical Rig & Scale
The **Summer Camp Dome** is a geodesic projection dome with a diameter of approximately **65.6 feet (20 meters)**. Structurally, it is mapped in a 3D coordinate system where the Y-axis represents height ($y = 0.0$ is the floor, $y = 3.6$ meters is the apex) and the X and Z axes map the horizontal plane.

```
       ▲ (Apex: y=3.6m)  ┌───────────────────────────┐
      ╱█╲                │  Triangle Group:          │
     ╱ █ ╲               │  - TriangleEdges (Bars)   │
    ╱  ▼  ╲              │  - TrianglePars (Beams)   │
   ╱       ╲             └───────────────────────────┘
  ╱  ○   ○  ╲            ◄── VintageLights (y=2.5m, radius 8m)
 ╱           ╲
▕═══   ○   ═══▏          ◄── BarLights (y=1.5m, radius 10m)
 ▀▀▀▀▀▀▀▀▀▀▀▀▀
```

### 1.2 Fixture Clusters & Emitters
The rig features four distinct lighting groups totaling **321 physical pixels** (channels mapped via DMX):

1. **`BarLights` (Perimeter Wash Ring):** 13 `ShehdsBar` linear wash fixtures arranged in a circle of radius $10\text{m}$ at $y = 1.5\text{m}$. Each bar contains 18 independently controllable RGBWAU pixels, giving **234 pixels** total. 
2. **`VintageLights` (Inner Ambient Ring):** 5 `VintageLed` fixtures arranged in an inner circle of radius $8\text{m}$ at $y = 2.5\text{m}$. Each fixture contains 6 vertical retro filament lamps, giving **30 pixels** total.
3. **`TriangleEdges` (Apex Structure):** 3 `ShehdsBar` wash bars forming a physical triangle at the dome's high center ($y = 2.8$ to $3.5\text{m}$, $z \approx 5.2\text{m}$), giving **54 pixels** total.
4. **`TrianglePars` (Apex Accents):** 3 single-pixel `UkingPar` fixtures positioned at $y = 3.4$ to $3.6\text{m}$, $z \approx 6.8\text{m}$, giving **3 pixels** total.

### 1.3 Rich Fixture Metadata Recommendation
While `sectionId` is maintained for compatibility, pattern logic should prefer rich, semantic metadata injected per pixel for cleaner runtime gating:
* **`groupId`**: `"BarLights"` | `"VintageLights"` | `"TriangleEdges"` | `"TrianglePars"`
* **`fixtureType`**: `"bar"` | `"vintage"` | `"par"`
* **`role`**: `"perimeter"` | `"filament"` | `"apex_edge"` | `"beam"`

### 1.4 Isolated Triangle Control (View Selection Routing)
The central triangle is the high-elevation focal point. By assigning the triangle fixtures (`TriangleEdges` and `TrianglePars`) to their own **dedicated view-selection channel** (using the `viewSelection` filter `type: "group"` with targets `"TriangleEdges"` or `"TrianglePars"`), the console operator can run independent, complex geometric strobes on the apex while the rest of the dome maintains a slow, ambient, immersive wash.

---

## 2. Core Color Model & RGBWAU Philosophy

To keep live color operations predictable, MarsinEngine patterns enforce a strict separation between the color palette and physical effects channels:

> [!IMPORTANT]
> **The Color Separation Principle:**
> * `cp1` and `cp2` define **only** the RGB color world.
> * White, Amber, and UV are pattern-local **physical lighting channels** driven independently of the color palette.

The engine outputs color commands via the native `rgbwau(r, g, b, w, a, u)` function:
```text
r, g, b = cp1 ↔ cp2 RGB channel-wise interpolation
w       = pattern-local white shimmer / impact / ice / lightning / geometric sweep
a       = pattern-local amber warmth / filament / fire / boiler / lantern glow
u       = pattern-local UV ghost / underwater / edge glow / hidden geometry
```

### 2.1 RGBWAU Channel Philosophy
- **White** is used for shimmer, ice, lightning, lens flare, geometric sweeps, strobes, and high-impact geometric reveals.
- **Amber** is used for vintage filament warmth, fire, boiler-room energy, candlelight, and intimate human moments.
- **UV** is used for ghost light, underwater energy, hidden structure, edge glow, negative space, and deep pre-drop tension.

Each pattern exposes local White, Amber, and UV intensity sliders. This allows operators to tune the physical texture and temperature of the dome (e.g., adding warm amber filament glow or cold UV edge highlights) without polluting the global RGB palette.

### 2.2 Intensity Discipline
To protect the show from becoming washed out, patterns must adhere to strict intensity discipline:
- Patterns should avoid driving White, Amber, and UV all high at the same time unless intentionally creating a massive drop impact or grand finale look.
- White, Amber, and UV are designed as high-contrast layer overlays. They should be used to cut through the RGB color fields rather than serving as permanent, full-intensity background fill.

---

## 3. Shared Pattern Controls

To ensure interface consistency across the CaptainPad controller, every pattern exposes the following base controls:

```javascript
export var localSpeed = 0.5;
export var whiteIntensity = 0.25;
export var amberIntensity = 0.25;
export var uvIntensity = 0.15;
export var contrast = 0.5;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderWhiteIntensity(v) { whiteIntensity = v; }
export function sliderAmberIntensity(v) { amberIntensity = v; }
export function sliderUVIntensity(v) { uvIntensity = v; }
export function sliderContrast(v) { contrast = v; }
```

### 3.1 Parameter Ownership Rules
The engine hosts own global speed and coordinate scaling, protecting patterns from redundant math:
- The engine owns global `speed` and `size`.
- `speed` scales `delta` before it reaches `beforeRender(delta)`.
- `size` rescales coordinates before they reach `render3D(index, x, y, z)`.
- Patterns **should not** redeclare global `speed` or `size`. Instead, they must use the exported `localSpeed` variable to apply a local speed trim. This prevents future pattern authors from accidentally double-scaling speed.

### 3.2 Slider Naming Convention
Custom sliders must describe physical visual behavior, **not** audio sources. The pattern should remain agnostic as to whether a parameter is manually adjusted or audio-modulated.
* **Approved:** `sliderImpact`, `sliderSparkle`, `sliderUVReveal`, `sliderWaveDepth`, `sliderFractureAmount`, `sliderLanternGlow`, `sliderSearchlightWidth`, `sliderBoilerHeat`, `sliderFilamentGlow`.
* **Prohibited:** `sliderKickAmount`, `sliderBassAmount`, `sliderMicLowReactive`, `sliderVocalReactive`.

---

## 4. Audio Reactivity & Dynamic Parameter Mapping

### 4.1 Audio Routing Principles
Patterns do not directly read raw audio signals. 

Each pattern exposes a small number of expressive local parameters in normalized `0.0 → 1.0` space. In CaptainPad, the operator may leave those parameters static or associate them with live audio analysis signals such as `lows`, `mids`, `highs`, `kick`, `vocals`, `drums`, or `bass`.

Not every pattern needs audio-reactive parameters. Audio mapping should only be suggested where it improves the musical feel of the pattern.

A pattern-local parameter should be useful even when it is not audio-mapped. For example, `fractureAmount`, `sweepImpact`, `lanternGlow`, or `waveDepth` should work as normal static controls first. Audio mapping is an optional live-performance layer on top.

### 4.2 Canonical App-Level Audio Signals
The live app or audio analysis module exposes seven normalized signals (`0.0` to `1.0`):
* `lows`: Sub-bass and low-frequency energy.
* `mids`: Mid-range frequencies.
* `highs`: High frequencies and transients.
* `kick`: Transient beat detection.
* `vocals`: Mid-high presence.
* `drums`: Mid-range percussion.
* `bass`: General low-end bassline.

*Compatibility Aliases:* `micLow` $\to$ `lows`, `micMid` $\to$ `mids`, `micHigh` $\to$ `highs`, `micKick` $\to$ `kick`.

> [!NOTE]
> **Signal Resilience:** The exact availability of these signals depends on the audio analysis module implementation. Patterns should remain valid even if no audio signals are connected.

### 4.3 Recommended Audio-to-Visual Associations

| Audio Signal | Best Visual Use |
| :--- | :--- |
| `lows` | Large-scale motion, dome breathing, slow waves, ocean pressure |
| `bass` | Perimeter intensity, ripple size, underwater pulse, heavy body movement |
| `kick` | White impact, triangle flash, shutter hits, ripple bursts, fracture moments |
| `mids` | Rotation speed, wave density, amber warmth, motion complexity |
| `highs` | Sparkle, UV shimmer, lightning fragments, filament flicker |
| `drums` | Chases, strobes, clockwork ticks, rhythmic stepping |
| `vocals` | Amber glow, vintage lamps, soft white aura, emotional presence |

Audio reactivity should feel intentional, not noisy. The goal is not to make every pixel bounce to the microphone. The goal is to let music steer the emotional physics of the dome:

- lows move the ocean
- bass pressurizes the hull
- kick cracks the ice
- drums drive machinery
- highs create sparkle, edge shimmer, and tiny white particles
- vocals bring back human warmth
- mids shape motion and density

### 4.4 Playlist-Level Modulation Example
Here is a YAML snippet showing how CaptainPad binds live audio signals to pattern-local parameters:

```yaml
playlistItem:
  pattern: "iceberg_dead_ahead"
  parameters:
    localSpeed: 0.35
    whiteIntensity: 0.45
    uvIntensity: 0.7
    amberIntensity: 0.15
    iceWallIntensity: 0.5
    fractureAmount: 0.35
    blackoutDepth: 0.6
  modulations:
    - id: "mod_fracture_kick"
      type: "continuous"
      enabled: true
      source:
        scope: "cpc"
        key: "kick"
        label: "Kick"
      target:
        scope: "pattern"
        parameter: "fractureAmount"
      mode: "offset"
      polarity: "unipolar"
      range: [0.0, 0.45]
      curve: "easeOut"
    - id: "mod_uv_lows"
      type: "continuous"
      enabled: true
      source:
        scope: "cpc"
        key: "lows"
        label: "Lows"
      target:
        scope: "pattern"
        parameter: "uvIntensity"
      mode: "offset"
      polarity: "unipolar"
      range: [0.0, 0.25]
      curve: "linear"
    - id: "mod_white_kick"
      type: "continuous"
      enabled: true
      source:
        scope: "cpc"
        key: "kick"
        label: "Kick"
      target:
        scope: "pattern"
        parameter: "whiteIntensity"
      mode: "offset"
      polarity: "unipolar"
      range: [0.0, 0.35]
      curve: "easeOut"
```

### 4.5 Trigger vs. Continuous Modulations
For v1, all audio mappings are continuous normalized parameter modulations. Future versions may add trigger mappings for one-shot events such as fracture bursts, Morse resets, pressure releases, and blackout hits.

---

## 5. Tone & Artistic Direction

The emotional language of the Summer Camp Dome show evokes a ship moving through cold darkness:

```
DARKNESS  ──►  UV REVEAL  ──►  AMBER WARMTH  ──►  WHITE IMPACT  ──►  BLACKOUT
```

- **Cold Ocean UV:** The default state of the dome. Deep, glowing blue/violet tones that fill the negative space.
- **Human Amber Warmth:** Memory, life, candlelight, and interior warmth driven through the `VintageLights` filaments.
- **White Ice/Searchlight Impact:** Direct transients, lightning, structural fracture, and blinding danger.
- **Negative Space:** Blackouts are active design choices. The dome is rarely at full brightness, allowing high-intensity strobes to carry immense physical impact.
- **The Apex Triangle:** Serves as the vessel's mast, a rotating lighthouse beacon, a distress signal, or the point of impact where ice fractures.

---

## 6. Curated Show Pattern Specifications

The `suggestedAudio` field listed in the pattern blocks below is only a live-app mapping hint. It does not mean the pattern depends on that signal. The same parameter can be manually controlled, left static, or mapped to a different signal depending on the show.

### 6.1 Beautiful & Ambient Patterns

#### 1. `ghost_ship_reveal`
* **Concept:** The dome starts in pitch black. Soft UV waves slowly crawl across the BarLights and TriangleEdges, revealing the dome’s physical structure. Vintage lamps slowly flicker to life like glowing amber oil lanterns, and the apex triangle flashes a faint spectral white masthead beacon.
* **Channel Logic:**
  - `w = whiteIntensity * rareSparkle`
  - `a = amberIntensity * vintageMask * candleFlicker`
  - `u = uvIntensity * ghostMask`
* **Metadata Block:**
  ```yaml
pattern: ghost_ship_reveal
mood: cinematic / mysterious / suspenseful
primaryChannels:
  rgb: cp1-cp2 deep blue gradient
  white: tiny spectral masthead sparkles
  amber: flickering vintage oil lanterns
  uv: structural UV outline
localParameters:
  uvReveal:
    default: 1
    suggestedAudio: lows
    purpose: Controls the density and visibility of the UV structure on the physical dome pixels.
  lanternGlow:
    default: 0.3
    suggestedAudio: vocals
    purpose: Controls the amber warmth of the vintage Led lamps.
  spectralSparkle:
    default: 0.2
    suggestedAudio: highs
    purpose: Controls high-frequency white sparkles on the apex.
```

#### 2. `ghost_aurora` (formerly `apex_aurora_drift`)
* **Concept:** Saturated RGB curtains drift slowly across the high central triangle ($y > 2.2\text{m}$) and sweep down to the vintage lights. UV provides the underlying glowing field, while white adds a subtle, cold ice-shimmer.
* **Channel Logic:**
  - `rgb` = Slow vertical sine waves blended between `cp1` and `cp2`
  - `u` = Slow, breathing environmental wash
  - `w` = Faint high-altitude shimmer
* **Metadata Block:**
  ```yaml
pattern: ghost_aurora
mood: ambient / cold / ethereal
primaryChannels:
  rgb: cp1-cp2 slow vertical color sheets
  white: cold ice-shimmer highlights
  amber: dim, constant backing glow
  uv: main upper-dome UV field
localParameters:
  auroraDepth:
    default: 0.5
    suggestedAudio: lows
    purpose: Controls the vertical span and density of the color sheets.
  rimShimmer:
    default: 0.25
    suggestedAudio: highs
    purpose: Controls the brightness of the white/UV ice shimmer.
  humanWarmth:
    default: 0.3
    suggestedAudio: vocals
    purpose: Adjusts the amber intensity of the vintage lights.
  uvIntensity:
    default: 1
    suggestedAudio: highs
    purpose: Controls the baseline UV intensity of the aurora.
```

#### 3. `lanterns_in_the_dark`
* **Concept:** A minimalist dark scene built around negative space. The VintageLights behave like isolated amber lanterns suspended inside the dome. The BarLights stay mostly dark with faint UV/blue edge pulses, while the TriangleEdges hold a dim cold outline.
* **Channel Logic:**
  - `u` = faint UV edge pulses on BarLights and TriangleEdges
  - `a` = slow randomized amber pulses on VintageLights
  - `w` = dim triangle outline or occasional white glint
* **Metadata Block:**
  ```yaml
pattern: lanterns_in_the_dark
mood: dark / minimalist / tense
primaryChannels:
  rgb: mostly black with faint cp1-cp2 edge movement
  white: dim outline on the triangle structure
  amber: slow, organic lantern glow on VintageLights
  uv: faint edge glow on BarLights and TriangleEdges
localParameters:
  fireFlicker:
    default: 0.5
    suggestedAudio: highs
    purpose: Controls the flicker speed of the boiler fire.
  boilerHeat:
    default: 0.5
    suggestedAudio: vocals
    purpose: Controls the intensity of the warm amber glow.
  valvePressure:
    default: 0.3
    suggestedAudio: kick
    purpose: Controls the frequency of the white steam valve releases.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 4. `underwater_afterglow`
* **Concept:** The visual space representing the post-collision "sinking." Saturated RGB is replaced by slow, low-intensity blue-violet currents. UV waves roll over the perimeter wash, white mimics tiny physical white particle points drifting across fixture pixels (representing marine snow), and amber acts as dying embers fading in the deep.
* **Channel Logic:**
  - `u` = Deep, breathing ocean waves
  - `a` = Dying vintage filaments fading out
  - `w` = High-frequency drifting particle noise on pixels
* **Metadata Block:**
  ```yaml
pattern: underwater_afterglow
mood: deep / melancholic / slow
primaryChannels:
  rgb: cp1-cp2 slow, dark blue-purple current
  white: tiny physical white particle points drifting across fixture pixels
  amber: dying filament embers in the vintage ring
  uv: deep, pressurized water layer
localParameters:
  shadowDepth:
    default: 0.5
    suggestedAudio: lows
    purpose: Controls the width of the moving sea floor shadow.
  abyssalSwell:
    default: 0.4
    suggestedAudio: vocals
    purpose: Controls the breathing speed of the deep current.
  edgeShimmer:
    default: 0.25
    suggestedAudio: highs
    purpose: Controls high-frequency white water shimmers.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

---

### 6.2 Rhythmic & Danceable Patterns

#### 5. `titanic_gyro_vortex` (formerly `dome_vortex_spin`)
* **Concept:** A high-energy, hypnotic rotation pattern. The outer `BarLights` and the apex `TriangleEdges` rotate in opposite directions to form a twisting vortex. White adds bright compass flashes, and amber adds a slow, warm background glow.
* **Channel Logic:**
  - `rgb` = Counter-rotating polar coordinate sweeps
  - `w` = Intermittent, high-intensity compass strobes
  - `a` = Constant, warm filament background
* **Metadata Block:**
  ```yaml
pattern: titanic_gyro_vortex
mood: driving / hypnotic / rotational
primaryChannels:
  rgb: cp1-cp2 counter-rotating fields
  white: bright, compass-like directional strobes
  amber: warm, stabilizing backing glow
  uv: trace trails behind color sweeps
localParameters:
  vortexSpeed:
    default: 0.45
    suggestedAudio: lows
    purpose: Controls the rotation speed of the apex vortex.
  sweepImpact:
    default: 0.3
    suggestedAudio: kick
    purpose: Controls the intensity of white vortex sweeps.
  hullGlow:
    default: 0.35
    suggestedAudio: vocals
    purpose: Controls the background RGB wash brightness.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 6. `engine_room_clockwork` (formerly `radial_clockwork`)
* **Concept:** Mechanical, industrial ticking. The vintage lamps tick sequentially in amber, the perimeter wash bars pulse like heavy pistons, and the apex triangle acts as a central dial. Beats trigger sudden mechanical pauses followed by a white-hot pressure release.
* **Channel Logic:**
  - `rgb` = Stepped, angular chasers
  - `a` = Rhythmic, ticking filament pulses
  - `w` = Beat-triggered piston flashes
* **Metadata Block:**
  ```yaml
pattern: engine_room_clockwork
mood: industrial / mechanical / driving
primaryChannels:
  rgb: cp1-cp2 stepping piston pulses
  white: high-impact transient mechanical flashes
  amber: sequential ticking filament lamps
  uv: underlying metallic machinery glow
localParameters:
  gearSpeed:
    default: 0.5
    suggestedAudio: drums
    purpose: Controls the rotation speed of the mechanical gear chasers.
  tickSharpness:
    default: 0.45
    suggestedAudio: kick
    purpose: Controls the sharp decay of clockwork ticks.
  boilerHeat:
    default: 0.35
    suggestedAudio: bass
    purpose: Controls the amber filament warmth of the machinery.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 7. `watertight_doors` (formerly `dome_shutter_step`)
* **Concept:** Heavy, vertical step closures. Saturated blue and UV bars cascade down from the triangle, through the vintage ring, to the perimeter. Drop impacts slam all tiers together in a white flash, followed by a sudden blackout.
* **Channel Logic:**
  - `rgb/u` = Downward vertical step waves
  - `w` = Sudden white flash when all segments align
* **Metadata Block:**
  ```yaml
pattern: watertight_doors
mood: heavy / industrial / rhythmic
primaryChannels:
  rgb: cp1-cp2 vertical closing boundaries
  white: transient impact flash on closure
  amber: low emergency warmth
  uv: structural containment glow
localParameters:
  doorPressure:
    default: 0.45
    suggestedAudio: lows
    purpose: Controls the speed and weight of the downward closing waves.
  slamImpact:
    default: 0.4
    suggestedAudio: kick
    purpose: Controls the brightness of the white impact flash.
  amberMemory:
    default: 0.25
    suggestedAudio: vocals
    purpose: Controls the decay time of the vintage lights between slams.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 8. `triangle_perimeter_ping`
* **Concept:** Spatial bouncing. Intense pulses of light ping back and forth between the central apex triangle and the outer perimeter wash ring, passing through the vintage lights.
* **Channel Logic:**
  - `rgb` = Radial distance scaling (ping-pong)
  - `w` = Peak white bursts at the bounce targets
  - `a` = Filament illumination at the midpoint
* **Metadata Block:**
  ```yaml
pattern: triangle_perimeter_ping
mood: punchy / geometric / spatial
primaryChannels:
  rgb: cp1-cp2 radial bounce fields
  white: sharp target impact flashes
  amber: warm midpoint filament passes
  uv: trailing UV afterimage trail
localParameters:
  pingSpeed:
    default: 0.5
    suggestedAudio: drums
    purpose: Controls the speed of the bounce cycle.
  pingImpact:
    default: 0.4
    suggestedAudio: kick
    purpose: Controls the white intensity at bounce targets.
  uvTrail:
    default: 1
    suggestedAudio: lows
    purpose: Adjusts the ambient UV trail length.
```

---

### 6.3 Drop & Impact Patterns

#### 9. `poseidon_trident_sweep`
* **Concept:** Three high-intensity white sweeps move across the physical dome pixels like the arms of a trident. The TrianglePars act as bright origins, the TriangleEdges carry the sharp white cores, and the BarLights receive moving UV/RGB edge trails. Vintage lamps ignite amber only when the sweep crosses their angular sector.
* **Channel Logic:**
  - `w` = Core white sweeps on TriangleEdges
  - `u` = UV edge trails on BarLights
  - `a` = Vintage filament intersection hits
* **Metadata Block:**
  ```yaml
pattern: poseidon_trident_sweep
mood: high-energy / sweeping / focal
primaryChannels:
  rgb: cp1-cp2 deep water backing wash
  white: three intense sweep cores
  amber: vintage lamps intersecting the sweep
  uv: edge trails on physical pixels
localParameters:
  sweepWidth:
    default: 0.35
    suggestedAudio: mids
    purpose: Controls the width of the searchlight sweeps.
  sweepImpact:
    default: 0.45
    suggestedAudio: kick
    purpose: Controls the white intensity of the searchlight beam.
  edgeTrail:
    default: 1
    suggestedAudio: highs
    purpose: Controls the UV afterimage trail length.
```

#### 10. `boiler_pressure_release`
* **Concept:** The rig simulates building pressure. Amber heat climbs, RGB color sweep speeds increase, and small white spikes flare up. At peak, the entire dome vents in a massive white and amber burst, followed by cooling UV afterglow.
* **Channel Logic:**
  - `a` = Exponential amber heat bloom
  - `w` = White-hot release bursts
  - `u` = Post-release UV cooling afterglow
* **Metadata Block:**
  ```yaml
pattern: boiler_pressure_release
mood: aggressive / rising / explosive
primaryChannels:
  rgb: cp1-cp2 fiery heat gradient
  white: white-hot steam release transients
  amber: dominant filament heat energy
  uv: trailing cooling afterglow
localParameters:
  pressure:
    default: 0.4
    suggestedAudio: bass
    purpose: Controls the pressure build up speed.
  heatBloom:
    default: 0.5
    suggestedAudio: mids
    purpose: Controls the amber filament heat bloom.
  ventFlash:
    default: 0.25
    suggestedAudio: kick
    purpose: Controls the white-hot vent release flash.
  coolingAfterglow:
    default: 1
    suggestedAudio: highs
    purpose: Controls the UV cooldown after releases.
```

#### 11. `iceberg_fracture` (formerly `geodesic_lightning`)
* **Concept:** Rhythmic white and UV fractures branch outward from the apex triangle, traveling down specific structural paths (bars) to the perimeter. The rig remains in deep, cold darkness, flashing only on transients.
* **Channel Logic:**
  - `w/u` = High-speed branching transients
  - `a` = Low-intensity warm amber aftershocks
* **Metadata Block:**
  ```yaml
pattern: iceberg_fracture
mood: sharp / transient / high-contrast
primaryChannels:
  rgb: cp1-cp2 brief, cold blue fractures
  white: blinding structural crack transients
  amber: dim, lingering thermal aftershocks
  uv: structural fracture paths
localParameters:
  fractureAmount:
    default: 0.4
    suggestedAudio: kick
    purpose: Controls the density of the iceberg cracks.
  branchSharpness:
    default: 0.5
    suggestedAudio: highs
    purpose: Controls the decay speed of the white strikes.
  aftershock:
    default: 0.25
    suggestedAudio: bass
    purpose: Controls the warm amber recovery glow.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 12. `sos_morse_burst`
* **Concept:** The central triangle flashes cold white Morse code signals (`... --- ...`). The perimeter remains in deep UV darkness, while the vintage lamps flicker amber in response.
* **Channel Logic:**
  - `w` = Morse signal sequence driven on the triangle
  - `u` = Static, dark blue/UV perimeter
  - `a` = Flickering vintage response
* **Metadata Block:**
  ```yaml
pattern: sos_morse_burst
mood: dramatic / rhythmic / storytelling
primaryChannels:
  rgb: cp1-cp2 deep water backing wash
  white: cold white Morse code signals (SOS)
  amber: flickering human-response signals
  uv: deep, isolated dark ocean base
localParameters:
  signalStrength:
    default: 0.7
    suggestedAudio: kick
    purpose: Controls the brightness of the white Morse signal.
  responseGlow:
    default: 0.3
    suggestedAudio: vocals
    purpose: Controls the amber response glow.
  abyssalDarkness:
    default: 0.6
    suggestedAudio: lows
    purpose: Controls the background black space intensity.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

---

### 6.4 Hero Cinematic Patterns

#### 13. `iceberg_dead_ahead`
* **Concept:** A cold, glowing UV and white ice wall approaches from one side of the dome. Warm amber vintage tones are pushed out as the wall advances. At impact, a bright white crack scatters across the dome.
* **Channel Logic:**
  - `w` = Approaching ice wall core and collision crack
  - `u` = Cold ice edge and structural reveal
  - `a` = Retreating warm filament safety glow
* **Metadata Block:**
  ```yaml
pattern: iceberg_dead_ahead
mood: cinematic / cold / dangerous
primaryChannels:
  rgb: cp1-cp2 deep water wash
  white: bright ice wall face and impact cracks
  amber: surviving warmth in vintage lamps
  uv: advancing ice edge and structural reveal
localParameters:
  fireSpeed:
    default: 0.5
    suggestedAudio: lows
    purpose: Controls the speed of the flame wave.
  flameHeight:
    default: 0.65
    suggestedAudio: vocals
    purpose: Controls the vertical height of the fire wave.
  heatFlash:
    default: 0.3
    suggestedAudio: kick
    purpose: Controls the frequency of white heat flashes.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 14. `black_sun_corona` (formerly `dome_eclipse`)
* **Concept:** A deep, empty circular shadow moves across the dome. UV outlines the perimeter of the shadow, amber filaments bloom as the eclipse passes over, and a white corona flashes at alignment.
* **Channel Logic:**
  - `rgb` = Inverted distance masking (dark center)
  - `u` = UV rim glow
  - `a/w` = Corona flare on the vintage ring
* **Metadata Block:**
  ```yaml
pattern: black_sun_corona
mood: dramatic / high-contrast / dark
primaryChannels:
  rgb: cp1-cp2 negative shadow field
  white: white corona alignment flashes
  amber: glowing vintage corona rim
  uv: high-contrast outline rim
localParameters:
  eclipseDepth:
    default: 0.65
    suggestedAudio: lows
    purpose: Controls the darkness and size of the center shadow.
  coronaBloom:
    default: 0.4
    suggestedAudio: vocals
    purpose: Controls the brightness of the warm corona ring.
  rimShimmer:
    default: 1
    suggestedAudio: highs
    purpose: Controls the UV outline rim sharpness.
```

#### 15. `deck_tilt`
* **Concept:** A diagonal waterline tilts across the dome, simulating the sinking ship. One side remains warm amber; the other side becomes blue and UV water. The waterline slowly rotates and climbs higher.
* **Channel Logic:**
  - `rgb/u` = Underwater portion (blue/violet/UV)
  - `a` = Above-water portion (warm amber filaments)
  - `w` = White water line foam
* **Metadata Block:**
  ```yaml
pattern: deck_tilt
mood: cinematic / shifting / unstable
primaryChannels:
  rgb: cp1-cp2 water wash vs. dry hull split
  white: foaming white waterline divider
  amber: warm dry cabin filaments
  uv: cold submerged cabin glow
localParameters:
  tiltAngle:
    default: 0.45
    suggestedAudio: mids
    purpose: Controls the angle of the deck tilt division.
  shearSharpness:
    default: 0.55
    suggestedAudio: kick
    purpose: Controls the sharpness of the white waterline divider.
  shearDepth:
    default: 0.45
    suggestedAudio: lows
    purpose: Controls the brightness of the submerged wash.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 16. `white_star_finale`
* **Concept:** The show's climax. The central apex triangle lights up as a blinding white star. The perimeter wash bars rotate through energetic color gradients, and the vintage lamps pulse in white/amber on heavy downbeats.
* **Channel Logic:**
  - `w` = Blinding white star on the apex
  - `rgb` = High-speed perimeter rotations
  - `a` = Vintage downbeat hits
* **Metadata Block:**
  ```yaml
pattern: white_star_finale
mood: euphoric / energetic / triumphant
primaryChannels:
  rgb: cp1-cp2 high-energy perimeter rotation
  white: blinding white star apex core
  amber: flashing vintage downbeat accents
  uv: high-energy backdrop glow
localParameters:
  starBrightness:
    default: 0.6
    suggestedAudio: kick
    purpose: Controls the star sparkle brightness.
  ringEnergy:
    default: 0.5
    suggestedAudio: bass
    purpose: Controls the sweep rotation speed.
  wallHit:
    default: 0.45
    suggestedAudio: drums
    purpose: Controls the amber perimeter sweep intensity.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

---

## 7. Recommended First Shipping Set & Playability

For initial deployment and staging, the proposal recommends this curated set of **16 creative show patterns** grouped by operational use case and EDM playability:

| Category | Patterns |
| :--- | :--- |
| **Beautiful / Ambient**<br>*Best for openings, resets, ambient transitions, and breakdowns.* | 1. `ghost_ship_reveal`<br>3. `lanterns_in_the_dark`<br>4. `underwater_afterglow` |
| **EDM-Compatible Cinematic (Transition)**<br>*Best for build-ups, tension builds, and dramatic sweeps.* | 2. `ghost_aurora`<br>13. `iceberg_dead_ahead`<br>14. `black_sun_corona`<br>15. `deck_tilt` |
| **Fully EDM-Ready (Rhythmic & Impact)**<br>*Best for drops, active dance loops, and high-energy segments.* | 5. `titanic_gyro_vortex`<br>6. `engine_room_clockwork`<br>7. `watertight_doors`<br>8. `triangle_perimeter_ping`<br>9. `poseidon_trident_sweep`<br>10. `boiler_pressure_release`<br>11. `iceberg_fracture`<br>12. `sos_morse_burst`<br>16. `white_star_finale` |

### Playability Analysis
Out of 16 creative show patterns:
* **9 patterns** are directly EDM-ready (optimized for rhythmic beats, sharp drops, and fast motion).
* **13 patterns** are EDM-useful (including the transition/cinematic builds that shape show momentum).
* **3 patterns** serve as ambient reset triggers.

This offers a balanced show palette: some dance, some impact, some story, and some darkness.

---

## 8. Backlog & Future Variants

The following pattern concepts are preserved as backlog specifications for future show expansions and alternate track configurations:

1. **`radial_comb_filter`** — Phase-alternating sectors of the dome rotating in opposite directions. Recommended for high-tempo techno sets.
2. **`dome_meridian_sweep`** — Flat 2D sheets of color sweeping horizontally across the dome shell. Great for structural, geometric reveals.
3. **`vintage_spark_shower`** — High-speed flickering spark generation on the vintage lamps triggering brief, localized RGB ground flares.
4. **`apex_firefly_swarm`** — Dense particle arrays swarming in a randomized noise field focused around the apex coordinates ($y > 2.4$).
5. **`triangle_chase_3way`** — Edge-locked pixel sweeps chasing concurrently around the apex triangle boundaries.
6. **`triangle_par_strobe`** — Hyper-fast strobe chases isolated strictly to the 3 vertex pars (`TrianglePars`) for pre-drop tension.

---

## 9. Implementation Style Guidance

To keep code clean and performant within the Wasm host, developers should build patterns in six sequential layers:

1. **Geometry Mask:** Isolate sections using rich metadata (`groupId`, `fixtureType`, `role`).
2. **RGB cp1/cp2 Color Field:** Interpolate palette colors channel-wise once per frame.
3. **White Impact Layer:** Compute transient impacts, ice, or searchlight shapes.
4. **Amber Warmth Layer:** Compute vintage filament, fire, or lantern shapes.
5. **UV Edge/Ghost Layer:** Compute edge glow or hidden geometry.
6. **Final Output:** Emit the combined layers via `rgbwau()`, applying an explicit `clamp01` limit to prevent channel saturation.

### Canonical Implementation Template
```javascript
// ── Palette RGB cache (strict cp1<->cp2 blending) ─────────────────────
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

export function beforeRender(delta) {
  _hsv2rgb1();
  _hsv2rgb2();
  // ... accumulate time phases and local triggers here ...
}

export function render3D(index, x, y, z) {
  // 1. Compute geometry masks (using injected variables)
  var isPerimeter = (groupId == "BarLights");
  var isFilament  = (groupId == "VintageLights");
  var isApexEdge  = (groupId == "TriangleEdges");
  var isApexBeam  = (groupId == "TrianglePars");

  // 2. Compute RGB cp1/cp2 color field (interpolated channel-wise)
  var colorMix = /* 0..1 phase */;
  var brightness = /* 0..1 intensity */;
  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness;

  // 3. Compute physical channels (driven by pattern parameters)
  var w = whiteIntensity * (isApexBeam ? 1.0 : 0.0);
  var a = amberIntensity * (isFilament ? 1.0 : 0.0);
  var u = uvIntensity * (isPerimeter ? 0.5 : 0.0);

  // 4. Final output (enforcing clamp discipline)
  rgbwau(
    clamp01(r),
    clamp01(g),
    clamp01(b),
    clamp01(w),
    clamp01(a),
    clamp01(u)
  );
}
```

---

## 10. Implementation Audit: Current Patterns 40-55

Audit target files:

- `marsin_engine/patterns/40_ghost_ship_reveal.js`
- `marsin_engine/patterns/41_ghost_aurora.js`
- `marsin_engine/patterns/42_boiler_glow.js`
- `marsin_engine/patterns/43_sea_floor_shadow.js`
- `marsin_engine/patterns/44_apex_gyro_vortex.js`
- `marsin_engine/patterns/45_engine_room_clockwork.js`
- `marsin_engine/patterns/46_dome_lockdown.js`
- `marsin_engine/patterns/47_apex_perimeter_ping.js`
- `marsin_engine/patterns/48_titanic_sos_beacon.js`
- `marsin_engine/patterns/49_boiler_pressure_release.js`
- `marsin_engine/patterns/50_iceberg_fracture.js`
- `marsin_engine/patterns/51_abyssal_searchlight.js`
- `marsin_engine/patterns/52_iceberg_shear_line.js`
- `marsin_engine/patterns/53_shadow_eclipse.js`
- `marsin_engine/patterns/54_boiler_fire_overdrive.js`
- `marsin_engine/patterns/55_stardust_dome.js`

### 10.1 High-Level Findings

The current files are useful scaffolds, but they are not yet strong Summer Camp Dome show patterns. Most of them read as generic normalized-coordinate Pixelblaze-style sketches with RGBWAU output bolted on. The implementation does have the right basic control pattern: every audited script declares `localSpeed` first, exposes local slider functions, accumulates `tPhase` with delta, and uses the local cp1/cp2 RGB cache. That part is solid.

The visual language is the weak part:

1. **The view-mask logic is currently dead for this scene.** Many scripts use `viewMask & 3` for apex and `viewMask & 8` for vintage. The generated Summer Camp Dome model has `vMask: 0` on every pixel, and there is no `marsin_engine/models/summer_camp_dome.viewmasks.js` sidecar. Result: most apex, vintage, and bar-specific branches never run. In the current engine, pattern code receives numeric `controllerId`, `sectionId`, `fixtureId`, and `viewMask`; it does not receive `groupId` strings. The proposal's `groupId == "TriangleEdges"` template is not runnable as-is in current MarsinScript.

2. **The circular bar geometry is barely used.** Only `44_apex_gyro_vortex` uses a real polar angle from `atan2(z - 0.5, x - 0.5)`. Most other patterns use only `x`, `y`, or `index`, which ignores the 13-bar perimeter ring. The BarLights should be treated as a circular instrument: angular sectors, orbiting gates, radial pulses, rotating dark gaps, and per-bar chases.

3. **TriangleEdges are not being used as the main stage lights.** The 54 pixels in `TriangleEdges` should be the focal instrument for EDM looks: chases, strobes, scanner cores, rotating triangle edge loops, launch points, and impact flashes. Current scripts usually treat the triangle as either a dead `viewMask` branch or just another point in a global wave. The 3 `TrianglePars` can be punctuation, but the 54 TriangleEdges pixels should carry the stage language.

4. **Too many layers are static or always-on.** Several patterns drive `uvIntensity` across the entire rig every frame, often at default `1.0`. This erases negative space and makes white impacts less meaningful. Examples: `42_boiler_glow`, `45_engine_room_clockwork`, and `55_stardust_dome` output full UV everywhere by default. EDM lighting needs darkness, shutters, pulses, hard cuts, and sparse high-contrast motion.

5. **The motion math is too simple and too loop-obvious.** Most movement is a single `wave(tPhase + coordinate)` or a binary threshold. That reads as repetitive. The desired direction should use layered non-commensurate phases, angular coordinates, prime lane counts, drifting shutters, edge chases, spirals, pseudo-random but spatially coherent seeds, and evolving masks. The goal is surprising motion, not random flicker.

6. **Audio mapping is available, but the playlist currently does not use it.** The modulation code supports `micLow`, `micMid`, `micHigh`, `micKick`, `stemsBass`, `stemsDrums`, and `stemsVocals` as source keys. The defaults in `simulation/scenes/summer_camp_dome/playlists/default.yaml` currently have empty `modulations: []` for patterns 40-55. Also, actual modulation targets should match exported slider names such as `sliderLocalSpeed`, `sliderSweepImpact`, or `sliderUvIntensity`, because playlist defaults already address slider exports by those names.

7. **Several names and concepts have drifted from this report.** `42_boiler_glow` is not a minimal lantern-darkness scene; it is a hardcoded boiler fire wash. `51_abyssal_searchlight` is closer to the trident/searchlight idea, but not spatially anchored to the triangle. `54_boiler_fire_overdrive` does not match the `iceberg_dead_ahead` concept described above. This mismatch matters because operators will pick patterns by name.

### 10.2 Blocking Geometry Recommendation

Before rewriting the pattern math, give the scene reliable fixture masks. The fastest path is a sidecar file:

```text
marsin_engine/models/summer_camp_dome.viewmasks.js

TriangleEdges:  bit 1, pixel indices 0-53
TrianglePars:   bit 2, pixel indices 54-56
BarLights:      bit 4, pixel indices 57-290
VintageLights:  bit 8, pixel indices 291-320
```

That matches how `engine.js` already OR-merges sidecar `pixelIndices` into `px.vMask` and `px.viewMask` at model load. With these bits, current checks like `(viewMask & 3) != 0` for apex and `(viewMask & 8) != 0` for vintage begin working. For rewrites, prefer explicit local mask names:

```javascript
var isTriangleEdge = (viewMask & 1) != 0;
var isTrianglePar = (viewMask & 2) != 0;
var isApex = (viewMask & 3) != 0;
var isBar = (viewMask & 4) != 0;
var isVintage = (viewMask & 8) != 0;
```

This is better than using `sectionId` alone because this scene currently has overlapping `sectionId` values: `TrianglePars` and `BarLights` both use section `2`. The model's `group` string is available to the host-side mixer view selection, but not to current MarsinScript pattern code.

### 10.3 Shared Rewrite Direction

Every pattern should keep `sliderLocalSpeed` first. Most patterns should expose 5-7 expressive controls total. They do not need identical parameters, but they should leave clean modulation targets:

- `sliderLocalSpeed`: always present; useful for BPM/local trim.
- A **motion shape** slider: width, lane count, arm count, curtain count, or shutter density.
- A **motion physics** slider: drift, chaos, acceleration, trail decay, pressure, or sweep tension.
- A **negative-space** slider: blackout depth, duty cycle, sparse density, or gate.
- A **triangle/stage** slider: triangle gain, stage focus, apex impact, edge chase, or star core.
- A **physical channel** slider when relevant: amber warmth, UV afterglow, white impact, sparkle.

Recommended modulation source mapping in current code terms:

- `micLow`: large-scale body movement, pressure, swell, shadow size, reveal depth.
- `stemsBass`: ring energy, orbit speed, pressure build, vortex size.
- `micKick`: white impact, triangle hit, shutter slam, fracture strike, vent burst.
- `stemsDrums`: clockwork ticks, chase stepping, lane advances.
- `micHigh`: shimmer, sparkles, fracture sharpness, stardust density, ice glints.
- `stemsVocals`: vintage amber, human warmth, lantern response, filament bloom.
- `micMid`: motion complexity, gimbal drift, aurora instability, rotation bias.

### 10.4 Pattern-by-Pattern Audit

#### `40_ghost_ship_reveal`

**Current behavior:** Rewritten as a dark-to-structure reveal for `summer_camp_dome`. It now uses `sectionId` plus the scene's actual `y` ranges to separate TriangleEdges, TrianglePars, BarLights, and VintageLights, because `TrianglePars` and `BarLights` both share section `2`. TriangleEdges carry slow mast/rigging scanners, BarLights use polar `atan2(x, z)` angular reveal windows around the real scene origin, VintageLights flicker in sparse amber clusters, and TrianglePars provide occasional masthead punctuation. The global cp1/cp2 field is now a dim moving mist layer instead of a full-rig wash.

**Issues:** The pattern is much closer to the intended direction, but it still needs live scene evaluation. The BarLights spin depends on the physical model coordinates being centered around the real `x,z` origin; if the visualizer or exported model shifts the ring, the angular read can flatten or appear synchronized. The fixture split is also a scene-specific heuristic (`sectionId == 2 && y <= 2.0` for BarLights, `y > 2.0` for TrianglePars), so a future model export could break it. The circular spin should be checked specifically for smooth wrap continuity and for enough visible phase separation between bars.

**Improve it:** Keep the current artistic direction: a ghostly rig reveal with real negative space, not a wash. Next refinements should tune the BarLights angular spin in the actual dome viewer, preserve the first spatial-spin look, and remove any remaining all-at-once moments by adding a slightly stronger per-bar phase offset if needed. Longer term, replace the `sectionId/y` heuristic with reliable fixture masks for `TriangleEdges`, `TrianglePars`, `BarLights`, and `VintageLights`. Current controls are `sliderLocalSpeed`, `sliderRevealWidth`, `sliderOrbitDrift`, `sliderBlackoutDepth`, `sliderLanternGlow`, `sliderBeaconSparkle`, and `sliderUvTrail`. Good modulation: `micLow -> sliderRevealWidth`, `stemsBass -> sliderOrbitDrift`, `stemsVocals -> sliderLanternGlow`, `micHigh -> sliderBeaconSparkle`, `micKick -> sliderBlackoutDepth` inverted or reduced on hits.

#### `41_ghost_aurora`

**Current behavior:** A vertical sine sheet based on `y` blends cp1/cp2 on all pixels; UV is the inverse of that sine. Random white shimmer appears across the rig. Vintage warmth is dead until view masks exist.

**Issues:** It is a global vertical curtain, not an apex-origin aurora. It does not use the BarLights circle, and the UV inverse keeps the rig too continuously lit. The shimmer is random gating rather than coherent ice texture.

**Improve it:** Anchor the aurora in TriangleEdges, then let curtains fall and rotate across the ring using `theta = atan2(z - 0.5, x - 0.5) / PI2`. Layer 2-3 incommensurate curtain phases so the sheets drift without obvious repetition. Gate curtain brightness with a width/density threshold so black gaps remain. Suggested controls: `sliderCurtainCount`, `sliderCurtainWidth`, `sliderDriftChaos`, `sliderRimShimmer`, `sliderTriangleGain`, `sliderUvFloor`. Good modulation: `micLow -> sliderCurtainWidth`, `micMid -> sliderDriftChaos`, `micHigh -> sliderRimShimmer`, `stemsVocals -> human warmth/vintage`.

#### `42_boiler_glow`

**Current behavior:** A hardcoded orange RGB fire flicker runs globally. Amber is intended for vintage but is dead under current view masks. White valve pressure is intended for apex but is also dead. UV is full-on everywhere.

**Issues:** This is one of the most static/full-field patterns. It ignores cp1/cp2 for RGB, ignores circular geometry, and the constant UV destroys the warm boiler contrast. It also does not match the earlier `lanterns_in_the_dark` concept.

**Improve it:** Decide whether this is a boiler-room pattern or a lantern-darkness pattern. If boiler-room, make TriangleEdges the pressure gauge/stage machinery, BarLights the circular vent ring, and Vintage the real amber filaments. Let heat occupy rotating sectors with dark gaps, not the full rig. Suggested controls: `sliderBoilerHeat`, `sliderFlickerComplexity`, `sliderVentWidth`, `sliderSteamFlash`, `sliderTriangleRPM`, `sliderBlackoutDepth`. Good modulation: `micLow/stemsBass -> sliderBoilerHeat`, `micKick -> sliderSteamFlash`, `micHigh -> spark/flicker`.

#### `43_sea_floor_shadow`

**Current behavior:** A binary shadow band moves along `x`; non-apex pixels get dim cp1 and UV, while apex pixels would get a pulse if view masks worked. Random white sparkles run globally.

**Issues:** The shadow is a simple stripe, not an abyssal occlusion moving around the circular rig. Apex behavior is dead, and there is no Vintage/Vessel warmth. `shadowDepth` acts like a threshold, but not like a visually controllable shadow mass.

**Improve it:** Build a moving elliptical shadow or sonar-darkness field in polar space. BarLights should show a circular occlusion moving around the perimeter with sparse UV edge foam. TriangleEdges can be a searchlight silhouette or distant pressure line. Vintage should mostly stay dark, with optional low amber embers. Suggested controls: `sliderShadowWidth`, `sliderShadowDrift`, `sliderAbyssalSwell`, `sliderEdgeFoam`, `sliderBlackoutDepth`, `sliderTriangleSilhouette`. Good modulation: `micLow -> swell/shadow width`, `micHigh -> edge foam`, `stemsVocals -> amber ember`.

#### `44_apex_gyro_vortex`

**Current behavior:** This is the only audited pattern that uses polar angle. It creates an angular sweep from `atan2(z - 0.5, x - 0.5)` and maps cp1/cp2 around it. White hits when the sweep is above a threshold. Vintage amber is dead under current view masks.

**Issues:** Good starting point, but it applies the same vortex to everything. It does not counter-rotate the apex triangle and perimeter, and it leaves UV as a broad complementary fill. There is no arm count, width, trail control, or negative-space duty cycle.

**Improve it:** Make this a flagship EDM pattern. BarLights should carry rotating angular arms around the circle. TriangleEdges should counter-rotate as a 3-edge stage chase. TrianglePars can punch the center on impacts. Add sparse shuttering so the vortex has black gaps. Suggested controls: `sliderArmCount`, `sliderArmWidth`, `sliderCounterSpin`, `sliderTrailLength`, `sliderTriangleFocus`, `sliderSweepImpact`. Good modulation: `stemsBass -> ring energy/vortex speed`, `micKick -> sweep impact`, `micMid/stemsDrums -> counter-spin or arm count`.

#### `45_engine_room_clockwork`

**Current behavior:** Intended bar/vintage branches both depend on `viewMask`, so under current scene metadata the pattern effectively becomes constant UV. The code has a simple `floor(index / 18)` stepping idea but it is not visible until masks work.

**Issues:** This is currently almost static. Even after masks, it would be a binary every-other-fixture step and random white tick, not a layered mechanical clockwork. TriangleEdges are not a dial or stage centerpiece.

**Improve it:** Use BarLights as pistons: each 18-pixel bar gets a stroke traveling along the bar, while the 13 bars advance around the ring. Use TriangleEdges as clock hands/gears, with a rotating bright edge and short blackout pauses. Vintage should tick in amber sequentially. Suggested controls: `sliderGearTeeth`, `sliderTickDecay`, `sliderPistonStroke`, `sliderBoilerHeat`, `sliderPauseAmount`, `sliderBlackoutDepth`, `sliderTriangleDial`. Good modulation: `stemsDrums -> gear stepping`, `micKick -> tick sharpness`, `micLow/stemsBass -> boiler heat`.

#### `46_dome_lockdown`

**Current behavior:** A vertical gate based on `y < wave(tPhase)` turns the lower part of the model on, with a white line near the moving boundary. Vintage amber memory is dead until view masks exist.

**Issues:** It has real motion, but it is a generic vertical wipe. It does not use the circular perimeter as a closing door system, and it does not make TriangleEdges the stage. The default can light too much of the rig at once.

**Improve it:** Turn it into a tiered shutter sequence: TriangleEdges slam first, Vintage ring responds second, BarLights close in angular sectors around the circle. Add a brief blackout hold after each slam so the white hit has weight. Suggested controls: `sliderTierDelay`, `sliderDoorWidth`, `sliderSlamImpact`, `sliderHoldBlackout`, `sliderEdgeUV`, `sliderTriangleLead`. Good modulation: `micKick -> slam impact`, `micLow -> door pressure`, `stemsDrums -> step cadence`.

#### `47_apex_perimeter_ping`

**Current behavior:** A ping moves along normalized `y`. That means it is height-based, not a real apex-to-perimeter distance. It lights a thin band when `abs(y - wavePos) < 0.1`, with inverse UV everywhere else.

**Issues:** The concept is spatial ping-pong, but the implementation does not measure from apex to perimeter and does not use angular lanes. It also keeps UV on in non-ping areas, reducing negative space.

**Improve it:** Compute radial distance from the apex/center and angular lane position. TriangleEdges should visibly launch the pulse; BarLights should catch it at specific angular sectors; Vintage should glow only at the midpoint pass. Use alternating directions and lane counts for less repetition. Suggested controls: `sliderPingWidth`, `sliderLaneCount`, `sliderTrailDecay`, `sliderPingImpact`, `sliderVintageMidpoint`, `sliderDirectionBias`, `sliderBlackoutDepth`. Good modulation: `micKick -> impact`, `stemsDrums -> ping speed`, `micLow -> trail size`.

#### `48_titanic_sos_beacon`

**Current behavior:** SOS timing is implemented as a hardcoded Morse pulse, but the white signal only appears on apex pixels selected by `viewMask`. Since masks are zero, the visible result is mostly a static dark cp1 wash plus UV. Vintage response glow is also dead.

**Issues:** The story is strong, but the current look is static unless view masks are fixed. It does not turn the SOS into a spatial event across the dome, and the Morse loop is mechanically repetitive.

**Improve it:** Put the primary Morse signal on TriangleEdges, not just TrianglePars. Then make BarLights echo each dot/dash as delayed circular wavefronts. Vintage should answer in amber, with slight timing drift so it feels human. Suggested controls: `sliderSignalStrength`, `sliderSignalSpeed`, `sliderEchoDelay`, `sliderEchoWidth`, `sliderResponseGlow`, `sliderAbyssalDarkness`, `sliderGlitch`. Good modulation: `micKick -> signal strength`, `stemsVocals -> response glow`, `micLow -> darkness/echo depth`.

#### `49_boiler_pressure_release`

**Current behavior:** A global pressure phase rises repeatedly, increasing RGB brightness, then flashes white when `phase > 0.95`. Vintage amber is dead until masks exist. UV appears only during early cooldown.

**Issues:** The pressure/release idea is clear, but it is spatially flat. Every pixel participates in the same build and flash. The release is a simple repeating timer, not a stage event with anticipation, spatial vents, and aftermath.

**Improve it:** Make TriangleEdges the visible pressure gauge and stage core. Let pressure propagate around BarLights as rotating vent sectors. At release, flash only selected vents and triangle cores, then go to blackout/cooling UV. Suggested controls: `sliderPressure`, `sliderReleaseThreshold`, `sliderVentWidth`, `sliderHeatBloom`, `sliderVentFlash`, `sliderCoolingAfterglow`, `sliderBlackoutHold`. Good modulation: `micLow/stemsBass -> pressure`, `micKick -> vent flash`, `micHigh -> cooling shimmer`.

#### `50_iceberg_fracture`

**Current behavior:** A global strike gate triggers when a sine wave exceeds a threshold. A simple wave field from `x`, `y`, and `tPhase` becomes the fracture brightness. White, RGB, and UV all use that same `frac`; amber aftershock runs globally.

**Issues:** This has useful negative-space potential, but it is not structural. It does not originate from TriangleEdges, does not travel down the rig, and does not choose crack lanes. The `fractureAmount` range only changes strike duty a little, and the branch pattern is too smooth.

**Improve it:** Make TriangleEdges the fracture origin and brightest stage. Propagate cracks down angular lanes to BarLights with delayed timing. Use sparse branching masks and fast decay. Vintage amber aftershock should be local and delayed. Suggested controls: `sliderFractureDensity`, `sliderBranchSpread`, `sliderStrikeDecay`, `sliderAftershockWarmth`, `sliderLaneCount`, `sliderOriginBias`, `sliderBlackoutDepth`. Good modulation: `micKick -> fracture density/white`, `micHigh -> branch sharpness`, `micLow -> aftershock/body`.

#### `51_abyssal_searchlight`

**Current behavior:** A rectangular sweep moves along `x`; pixels inside the width get cp1 RGB and white, pixels outside get UV. There is no fixture separation.

**Issues:** The sweep is flat and broad. It does not start at TriangleEdges, does not rotate around the perimeter ring, and does not use Vintage intersection hits. `edgeTrail` currently behaves like inverse full-field UV instead of a trail.

**Improve it:** Recast this as the `poseidon_trident_sweep`/searchlight pattern. TriangleEdges should be the source and brightest core. BarLights should receive one, two, or three narrow rotating beams around the circle. Vintage lamps should ignite only when a beam crosses their angular sector. Suggested controls: `sliderBeamCount`, `sliderSweepWidth`, `sliderGimbalDrift`, `sliderSweepImpact`, `sliderTrailLength`, `sliderVintageHit`, `sliderBlackoutDepth`. Good modulation: `micKick -> sweep impact`, `micMid -> gimbal drift`, `micHigh -> edge shimmer`.

#### `52_iceberg_shear_line`

**Current behavior:** A diagonal plane from `x`, `y`, and `tiltAngle` divides the rig into cp1/cp2 sides. A narrow white edge marks the line; UV is full outside the edge.

**Issues:** It creates a clean graphic, but it ignores the dome's circular ring and the apex triangle. Both sides remain lit, so the negative-space impact is weak. `shearSharpness` controls edge brightness, not actual line sharpness.

**Improve it:** Turn the line into a moving ice shear that originates at TriangleEdges and rotates through the BarLights ring. Use polar `theta` for the perimeter and a separate edge-coordinate chase for TriangleEdges. One side should be black/UV water; the other should be a retreating warm/dim world. Suggested controls: `sliderShearAngle`, `sliderShearWidth`, `sliderAdvance`, `sliderSubmergeDepth`, `sliderWarmthRetreat`, `sliderTriangleBlade`, `sliderBlackoutDepth`. Good modulation: `micLow -> submerge depth/advance`, `micKick -> white edge`, `stemsVocals -> warmth retreat`.

#### `53_shadow_eclipse`

**Current behavior:** A circular shadow center moves in normalized `x/y`. Pixels inside are dimmed to 10%; rim pixels get white and UV. Vintage amber rim is dead until masks exist.

**Issues:** This should be a circular/corona pattern, but it uses `x/y`, not the BarLights' horizontal `x/z` circle. With `eclipseDepth = 0.65`, much of the rig is shadowed most of the time, but not in an intentional ring-centered way. TriangleEdges do not carry the corona.

**Improve it:** Use horizontal polar geometry for the ring. Let a black body or dark sector cross the circular BarLights, with only a thin UV/white rim. TriangleEdges should become the corona/stage flare at alignment. Vintage should bloom amber only on rim intersection. Suggested controls: `sliderShadowSize`, `sliderRimWidth`, `sliderOrbitEccentricity`, `sliderCoronaPulse`, `sliderVintageBloom`, `sliderTriangleCorona`, `sliderBlackoutDepth`. Good modulation: `micLow -> shadow size`, `micHigh -> rim shimmer`, `micKick -> corona flash`.

#### `54_boiler_fire_overdrive`

**Current behavior:** A hardcoded orange flame wave moves vertically with `y * flameHeight - tPhase * fireSpeed * 2.0`. Amber follows flame everywhere, UV is inverse flame everywhere, and white heat flashes are random.

**Issues:** This is a boiler/fire pattern, not the `iceberg_dead_ahead` concept described above. It is full-field, warm, and non-spatial. It does not use BarLights as a ring or TriangleEdges as a stage. The random white flash is not tied to geometry or music.

**Improve it:** If kept as boiler overdrive, make it a drop look: BarLights become rotating flame tongues around the ring, TriangleEdges become white-hot stage bars, Vintage becomes controlled amber filament heat, and UV appears only in dark cooling gaps. If this slot is supposed to be `iceberg_dead_ahead`, rename/rewrite it completely as a cold advancing wall. Suggested boiler controls: `sliderFlameHeight`, `sliderTongueCount`, `sliderSwirl`, `sliderHeatFlash`, `sliderAmberBias`, `sliderStageOverdrive`, `sliderBlackoutDepth`. Good modulation: `stemsBass -> flame energy`, `micKick -> heat flash`, `micHigh -> sparks`.

#### `55_stardust_dome`

**Current behavior:** The apex star branch depends on `viewMask`, so it is dead under current metadata. Everything else gets a broad cp1/cp2 sweep based on `x`, an amber pulse, and full UV.

**Issues:** The finale currently has no apex star, no stardust, no circular orbit, and no negative space. Full UV makes it flat. The pattern should be the most spatial and stage-aware of the set, but it behaves like a generic wash.

**Improve it:** Make TriangleEdges the main white star and TrianglePars the core punches. BarLights should carry sparse orbiting particles and angular color waves with dark gaps. Vintage should hit amber/white on downbeats, not pulse constantly. Suggested controls: `sliderStarCore`, `sliderParticleDensity`, `sliderOrbitSpeed`, `sliderRingWidth`, `sliderWallHit`, `sliderSparkleDecay`, `sliderBlackoutDepth`. Good modulation: `micKick -> star core/wall hit`, `stemsBass -> ring energy`, `micHigh -> particle density`, `stemsVocals -> amber bloom`.

### 10.5 Priority Order for Improvement

1. **Fix fixture masks first.** Add `summer_camp_dome.viewmasks.js` or equivalent metadata so TriangleEdges, TrianglePars, BarLights, and VintageLights can be addressed reliably in pattern code. Without this, many current artistic branches are no-ops.

2. **Rewrite 44, 47, 51, and 55 first as the EDM core set.** These should become the ring-vortex, spatial ping, trident/searchlight, and finale patterns. They best match the user's stated goals: motion, circular BarLights, TriangleEdges as stage lights, and audio-friendly controls.

3. **Rewrite 45 and 46 next as rhythm tools.** Clockwork and lockdown can become strong drum/kick patterns if they use stepped chases, blackout holds, and triangle-stage hits.

4. **Rewrite 40, 41, 43, and 53 as dark transition looks.** These should focus on negative space, slow sophisticated motion, and sparse structure reveals rather than full-field ambience.

5. **Reconcile the concept/name drift in 42 and 54.** Decide whether those slots are boiler/fire patterns or whether they should match `lanterns_in_the_dark` and `iceberg_dead_ahead` from the proposal.

### 10.6 Acceptance Criteria for the Next Pattern Pass

A rewritten pattern should pass these checks:

- It has `sliderLocalSpeed` as the first slider.
- It uses TriangleEdges as a visible stage/focal layer, not only as an occasional accent.
- It uses the BarLights circular layout with angular or radial math in any pattern where the perimeter is active.
- It leaves intentional negative space by default; UV/white/amber are not full-field permanent fills.
- It exposes 4-7 useful local sliders with audio-agnostic names.
- It can be modulated using the current source keys: `micLow`, `micMid`, `micHigh`, `micKick`, `stemsBass`, `stemsDrums`, `stemsVocals`.
- Its playlist modulation targets use exported slider names such as `sliderLocalSpeed`, `sliderSweepImpact`, or `sliderBlackoutDepth`.
- It avoids obvious single-sine repetition by layering at least two spatial/temporal components or using a coherent nonrepeating phase model.
- Its RGB stays mostly on the cp1/cp2 palette line, while white, amber, and UV remain physical-channel effects.
