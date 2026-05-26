# Proposal: Logsville Tuned EDM Show Patterns (Summer Camp Logsville)
## Show Language & Spatial Lighting Design Specification

This document serves as the technical and artistic specification for the custom lighting patterns engineered for the **Summer Camp Logsville** scene. Designed for a bass-heavy music stage nestled under massive redwood trees, this proposal defines a rig-aware visual language that utilizes the physical geometry, vertical elements, and outdoor scale of the logsville layout.

The proposal defines **16 creative show patterns**.

---

## 1. Logsville Lighting Infrastructure & Geometry

### 1.1 Physical Rig & Scale
The **Summer Camp Logsville** is an outdoor performance stage situated in a clearing of old-growth redwood trees. The visual footprint spans approximately **100 feet (33 meters) in width (X)** and **80 feet (24 meters) in depth (Z)**. 

The structure consists of two main visual elements: a central **Lookout Tower** (centered around $x = 6.7$, $z = 8.2$) and a physical **Front Wall** running across the front plane ($z = 0$). 

```
                                [Redwoods2]            [Redwoods1]            [Redwoods3]
                                (Tree Canopy)          (Tree Canopy)          (Tree Canopy)
                                     ▲                      ▲                      ▲
                                     │                      │                      │
                                   (PARs)                 (PARs)                 (PARs)
                                     │                      │                      │
                                     ▼                      ▼                      ▼
  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                               │
  │                                        [Lookout Tower]                                        │
  │                                   - TowerBars (Structure)                                     │
  │                                   - TowerVintage (Corners)                                    │
  │                                                                                               │
  │                                                                                               │
  │                                                                                               │
  │     [WallVintage 1]  [WallVintage 2]  [WallVintage 3]  [WallVintage 4]  [WallVintage 5]        │
  │    ◄────────────────────────────────── Front Wall ─────────────────────────────────►          │
  │                                                                                               │
  └───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Fixture Clusters & Emitters
The rig features four distinct lighting groups totaling **222 physical pixels** (channels mapped via DMX):

1. **`TowerBars` (Tower Structure Wash):** 8 `ShehdsBar` linear wash fixtures framing the corners and sides of the Lookout Tower ($y = 3\text{m}$). Each bar contains 18 independently controllable RGBWAU pixels, giving **144 pixels** total. 
2. **`TowerVintageLights` (Tower Corner Accents):** 4 `VintageLed` fixtures mounted at the four corners of the Lookout Tower platform ($y = 3.06\text{m}$). Each fixture contains 6 vertical retro filament lamps, giving **24 pixels** total.
3. **`WallVintageLights` (Front Wall Wash):** 6 `VintageLed` fixtures arranged in a linear array along the front wall ($y = 2\text{m}$, $z = 0$). These wash the face of the front wall in warm filament textures, giving **36 pixels** total.
4. **`RedwoodPARs` (Redwood Canopy Underlighting):** 18 `UkingPar` fixtures arranged in three circular clusters of 6 PARs each (groups: `Redwoods1`, `Redwoods2`, `Redwoods3`) positioned at the base of three large redwood trees in the background ($y = 2.5\text{m}$ to $3\text{m}$, $z = 21\text{m}$). These provide single-pixel underlight accents for the three redwood canopy clusters, painting the background trees with color, UV, white impact, and amber warmth, giving **18 pixels** total.

### 1.3 Rich Fixture Metadata Recommendation
While `sectionId` is maintained for compatibility, pattern logic should prefer rich, semantic metadata injected per pixel for cleaner runtime gating:
* **`groupId`**: `"TowerBars"` | `"TowerVintageLights"` | `"WallVintageLights"` | `"Redwoods1"` | `"Redwoods2"` | `"Redwoods3"`
* **`fixtureType`**: `"bar"` | `"vintage"` | `"par"`
* **`role`**: `"structure_frame"` | `"lookout_accent"` | `"wall_wash"` | `"tree_underlight"`

### 1.4 Spatial Isolation (View Selection Routing)
Logsville’s visual impact relies on separating the intimate foreground stage (Front Wall & Lookout Tower) from the massive scale of the background (Redwood Canopy). By assigning the **`RedwoodPARs`** (`Redwoods1`, `Redwoods2`, `Redwoods3`) or **`TowerBars`** to dedicated view-selection channels in the mixer (e.g. filter `type: "group"` with target `"Redwoods1"`), the operator can drive tree underlighting independently. This is crucial for heavy bass drops where the redwood canopy flashes in isolation on sub-bass transients, keeping the stage front relatively dark.

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
w       = pattern-local white shimmer / impact / lightning / geometric sweep
a       = pattern-local amber warmth / filament / campfire / cabin lantern glow
u       = pattern-local UV forest shadow / glowing canopy / edge glow
```

### 2.1 RGBWAU Channel Philosophy
- **White** is used for strobing, vertical lightning strikes through the canopy, tower glints, structural sweeps, canopy edge reveals, branch-like shimmer, and physical tree underlight.
- **Amber** is used for the cozy glow of the lookout outpost, simulating campfires, wood-stove heat, oil lanterns, and cabin windows.
- **UV** is used for deep forest shadows, canopy edge glow, hidden structure, branch-like shimmer, physical tree underlight, negative space, and deep pre-drop tension.

Each pattern exposes local White, Amber, and UV intensity sliders. This allows operators to tune the physical texture and temperature of the scene (e.g., adding warm amber cabin warmth or cold UV forest canopy edge highlights) without polluting the global RGB palette.

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
* **Approved:** `sliderImpact`, `sliderSparkle`, `sliderUVReveal`, `sliderFallDepth`, `sliderFractureAmount`, `sliderLanternGlow`, `sliderSearchlightWidth`, `sliderBoilerHeat`, `sliderFilamentGlow`, `sliderRedwoodGlow`, `sliderTowerPulse`.
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
| `lows` | lows drive forest-wide breathing and ground-pressure color waves |
| `bass` | Redwood canopy underlight intensity, sub-bass ground pressure ripples |
| `kick` | Tower white strobe flashes, wall impact bursts, sudden tree canopy flares |
| `mids` | Chaser rotation speed around the tower, mechanical gear motion, density |
| `highs` | highs create canopy sparkles, branch shimmer, and tiny white glints |
| `drums` | Tower bar chasers, outpost lockdown steps, mechanical stepping |
| `vocals` | Cabin vintage lamps, campfire flickering, front wall amber glows |

Audio reactivity should feel intentional, not noisy. The goal is not to make every pixel bounce to the microphone. The goal is to let music steer the emotional physics of the stage:

- lows drive forest-wide breathing and ground-pressure color waves
- bass pressurizes the valley
- kick cracks the tower
- drums drive the logging gears
- highs create canopy sparkles, branch shimmer, and tiny white glints
- vocals bring back human warmth
- mids shape motion and canopy density

### 4.4 Playlist-Level Modulation Example
Here is a YAML snippet showing how CaptainPad binds live audio signals to pattern-local parameters:

```yaml
playlistItem:
  pattern: "redwood_timber_fall"
  parameters:
    localSpeed: 0.35
    whiteIntensity: 0.45
    uvIntensity: 0.7
    amberIntensity: 0.15
    timberTiltAngle: 0.5
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

The emotional language of the Summer Camp Logsville show evokes a secluded mountain lookout outpost in the deep redwoods:

```
DARKNESS  ──►  UV CANOPY REVEAL  ──►  AMBER CABIN WARMTH  ──►  WHITE LIGHTNING IMPACT  ──►  BLACKOUT
```

- **Cold Forest UV:** The baseline environment. Mystical, deep violet/blue glows underlighting the massive redwood crowns.
- **Human Amber Warmth:** Safety and isolation. Candlelight, campfires, and glowing windows mapped to the front wall and lookout tower vintage fixtures.
- **White Lightning Impact:** Blinding visual peaks representing storm flashes, structural sweeps, and mechanical pressure vents.
- **Negative Space:** Rhythmic blackouts allow the forest backdrop to expand and collapse, framing the stage structure.

---

## 6. Curated Show Pattern Specifications

The `suggestedAudio` field listed in the pattern blocks below is only a live-app mapping hint. It does not mean the pattern depends on that signal. The same parameter can be manually controlled, left static, or mapped to a different signal depending on the show.

### 6.1 Beautiful & Ambient Patterns

#### 1. `forest_canopy_reveal`
* **Concept:** Slow UV pulses reveal the three redwood canopy groups as physical background silhouettes. Vintage lamps on the lookout tower and wall flicker to life like isolated cabin lanterns.
* **Channel Logic:**
  - `u = uvIntensity * canopyBreathing`
  - `a = amberIntensity * vintageMask * candleFlicker`
  - `w = whiteIntensity * rareForestSparkle`
* **Metadata Block:**
  ```yaml
pattern: forest_canopy_reveal
mood: cinematic / mysterious / suspenseful
primaryChannels:
  rgb: cp1-cp2 deep forest gradient (dim)
  white: tiny high-altitude canopy sparkles
  amber: glowing lookout cabin windows & campfire glow
  uv: redwood underlight canopy reveal
localParameters:
  canopyReveal:
    default: 1
    suggestedAudio: lows
    purpose: Controls the brightness of the redwood canopy reveal.
  lanternGlow:
    default: 0.3
    suggestedAudio: vocals
    purpose: Controls the amber window warmth of the tower cabin.
  canopySparkle:
    default: 0.2
    suggestedAudio: highs
    purpose: Controls the white leaf sparkle intensity.
```

#### 2. `redwood_aurora`
* **Concept:** Saturated RGB color curtains drift slowly up the height of the three redwood clusters. UV provides a mystical forest floor backing, and white adds cold wind-shimmer highlights through the leaves.
* **Channel Logic:**
  - `rgb` = Slow vertical coordinates ($y$) sine sweeps on the redwood PARs
  - `u` = Stable environmental background wash
  - `w` = Faint leaf wind-shimmers
* **Metadata Block:**
  ```yaml
pattern: redwood_aurora
mood: ambient / cold / ethereal
primaryChannels:
  rgb: cp1-cp2 slow vertical sweeps on redwood crowns
  white: cold wind-shimmer highlights in the foliage
  amber: dim, cabin window backups
  uv: forest canopy edge glow
localParameters:
  auroraHeight:
    default: 0.6
    suggestedAudio: lows
    purpose: Controls the vertical height of the color sweeps.
  windShimmer:
    default: 0.25
    suggestedAudio: highs
    purpose: Controls the frequency of white canopy shimmers.
  cabinWarmth:
    default: 0.3
    suggestedAudio: vocals
    purpose: Controls the tower cabin light intensity.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 3. `outpost_campfire`
* **Concept:** The front wall and lookout tower vintage fixtures flicker in coordinated amber, simulating a warm campfire at the outpost. The background redwood trees remain in deep, static cool washes to emphasize isolation.
* **Channel Logic:**
  - `a` = Campfire noise flicker on the wall and tower vintage lights
  - `rgb` = Static deep forest teal/blue on redwoods
  - `u` = low-intensity redwood shadow accents
* **Metadata Block:**
  ```yaml
pattern: outpost_campfire
mood: warm / organic / cozy
primaryChannels:
  rgb: cp1-cp2 static deep forest backing wash
  white: occasional ember crackle flashes on the wall
  amber: flickering campfire filaments
  uv: low-intensity redwood shadows
localParameters:
  flickerSpeed:
    default: 0.4
    suggestedAudio: mids
    purpose: Controls the flicker speed of the campfire.
  campfireHeat:
    default: 0.5
    suggestedAudio: vocals
    purpose: Controls the amber warmth of the campfire.
  woodSparkle:
    default: 0.2
    suggestedAudio: highs
    purpose: Controls high-frequency white wood sparkles.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 4. `redwood_shadow_breath`
* **Concept:** A slow, dark UV/RGB breathing pattern across the redwood groups and tower base. The front wall stays mostly dim, while subtle white glints appear on tower corners and RedwoodPARs. The pattern creates the feeling of a deep valley without relying on mist or haze.
* **Channel Logic:**
  - `u` = Deep, breathing UV shadow wash on tower and redwoods
  - `rgb` = Slow rising color swells on redwood groups
  - `w` = Subtle white glints on tower corners and canopy PARs
* **Metadata Block:**
  ```yaml
pattern: redwood_shadow_breath
mood: deep / minimalist / slow
primaryChannels:
  rgb: cp1-cp2 slow rising color swells in redwoods
  white: subtle white glints on tower and canopy accents
  amber: dim backing window embers
  uv: deep redwood background shadow
localParameters:
  shadowDepth:
    default: 1
    suggestedAudio: lows
    purpose: Controls the depth of the forest shadow wash.
  canopySwell:
    default: 0.4
    suggestedAudio: mids
    purpose: Controls the slow canopy swell intensity.
  edgeShimmer:
    default: 0.25
    suggestedAudio: highs
    purpose: Controls the white leaf edge shimmer.
```

---

### 6.2 Rhythmic & Danceable Patterns

#### 5. `lookout_gyro_vortex`
* **Concept:** Rotational color sweeps. Saturated RGB waves spin around the lookout tower using the `TowerBars`. In sync, the redwood underlights rotate their color phases, creating a sweeping vortex across the entire clearing.
* **Channel Logic:**
  - `rgb` = Counter-rotating sweeps based on horizontal angles
  - `w` = Directional white pointer flashes on the tower corners
  - `a` = Constant, stabilizing outpost glow
* **Metadata Block:**
  ```yaml
pattern: lookout_gyro_vortex
mood: driving / hypnotic / rotational
primaryChannels:
  rgb: cp1-cp2 counter-rotating stage washes
  white: bright directional sweeps on tower bars
  amber: warm cabin window stabilizing glow
  uv: UV afterimage trails on redwood and tower pixels
localParameters:
  vortexSpeed:
    default: 0.45
    suggestedAudio: lows
    purpose: Controls the rotation speed of the stage vortex.
  sweepImpact:
    default: 0.3
    suggestedAudio: kick
    purpose: Controls the brightness of the vortex sweeps.
  outpostGlow:
    default: 0.35
    suggestedAudio: vocals
    purpose: Controls the baseline amber outpost brightness.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 6. `timber_mill_clockwork`
* **Concept:** Mechanical, industrial rhythm. The tower bars step sequentially like rotating gears. The vintage lights on the tower and wall tick like clock hands in amber and white on beat transients.
* **Channel Logic:**
  - `rgb` = Stepped, angular chaser on the tower structure
  - `a` = Rhythmic, ticking filament pulses
  - `w` = Beat-triggered gear impact flashes
* **Metadata Block:**
  ```yaml
pattern: timber_mill_clockwork
mood: industrial / mechanical / driving
primaryChannels:
  rgb: cp1-cp2 stepping mechanical gear pulses
  white: high-impact transient machinery flashes
  amber: sequential ticking filament lamps
  uv: low forest shadow accents on RedwoodPARs
localParameters:
  gearSpeed:
    default: 0.5
    suggestedAudio: drums
    purpose: Controls the rotation speed of the gears.
  tickSharpness:
    default: 0.45
    suggestedAudio: kick
    purpose: Controls the decay speed of ticks.
  boilerHeat:
    default: 0.35
    suggestedAudio: bass
    purpose: Controls the amber filament warmth of the mill.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 7. `outpost_lockdown`
* **Concept:** Coordinated vertical steps. Saturated blue and UV bars shut down sequentially from the top of the tower, down to the vintage lights, and finally to the wall base, mimicking a structural lockdown.
* **Channel Logic:**
  - `rgb/u` = Downward vertical step sweeps
  - `w` = Sudden white flash when all tiers hit the bottom
* **Metadata Block:**
  ```yaml
pattern: outpost_lockdown
mood: heavy / industrial / rhythmic
primaryChannels:
  rgb: cp1-cp2 vertical closing boundaries
  white: transient impact flash on closure
  amber: low emergency cabin warmth
  uv: structural containment glow
localParameters:
  doorPressure:
    default: 0.45
    suggestedAudio: lows
    purpose: Controls the downward step sweep speed.
  slamImpact:
    default: 0.4
    suggestedAudio: kick
    purpose: Controls the white slam flash brightness.
  amberMemory:
    default: 0.25
    suggestedAudio: vocals
    purpose: Controls the amber decay rate between slams.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 8. `tower_canopy_ping`
* **Concept:** Spatial bouncing. Intense color pulses shoot back and forth between the central lookout tower and the three redwood canopies in the background, passing through the front wall vintage lights on the bounce.
* **Channel Logic:**
  - `rgb` = Radial distance scaling (ping-pong)
  - `w` = Peak white bursts at the bounce targets
  - `a` = Midpoint filament glows
* **Metadata Block:**
  ```yaml
pattern: tower_canopy_ping
mood: punchy / geometric / spatial
primaryChannels:
  rgb: cp1-cp2 radial bounce fields
  white: sharp target impact flashes
  amber: warm midpoint filament passes
  uv: trailing canopy edge glow
localParameters:
  pingSpeed:
    default: 0.5
    suggestedAudio: drums
    purpose: Controls the ping-pong bounce speed.
  pingImpact:
    default: 0.4
    suggestedAudio: kick
    purpose: Controls the white bounce impact brightness.
  edgeTrail:
    default: 1
    suggestedAudio: lows
    purpose: Controls the UV trail length.
```

---

### 6.3 Drop & Impact Patterns

#### 9. `woodland_trident_sweep`
* **Concept:** Three high-intensity white sweeps move across the physical stage geometry like trident arms. The TowerBars draw the sharp white cores, the RedwoodPARs receive moving UV/RGB edge trails, and the vintage lamps ignite amber when the sweep crosses their angular sector.
* **Channel Logic:**
  - `w` = Core white sweeps on TowerBars
  - `u` = UV edge trails on Redwood underlights
  - `a` = Vintage lights and redwoods intersecting the sweep
* **Metadata Block:**
  ```yaml
pattern: woodland_trident_sweep
mood: high-energy / sweeping / focal
primaryChannels:
  rgb: cp1-cp2 deep forest backing wash
  white: three intense sweep cores
  amber: tree/wall filaments intersecting the sweep
  uv: edge trails on physical pixels
localParameters:
  sweepWidth:
    default: 0.35
    suggestedAudio: mids
    purpose: Controls the width of trident sweeps.
  sweepImpact:
    default: 0.45
    suggestedAudio: kick
    purpose: Controls the white trident core brightness.
  edgeTrail:
    default: 1
    suggestedAudio: highs
    purpose: Controls the UV afterimage trail length.
```

#### 10. `mill_pressure_release`
* **Concept:** A heavy bass-driven pressure build. Amber heat blooms on the front wall and tower base. As pressure peaks, white-hot impact bands flash across the TowerBars and RedwoodPARs, followed by a dark UV cooling afterimage.
* **Channel Logic:**
  - `a` = Exponential amber heat bloom
  - `w` = White-hot pressure release impact bands
  - `u` = Post-release UV cooling afterimage
* **Metadata Block:**
  ```yaml
pattern: mill_pressure_release
mood: aggressive / rising / explosive
primaryChannels:
  rgb: cp1-cp2 fiery heat gradient
  white: white-hot pressure release impact bands
  amber: dominant filament heat energy
  uv: trailing cooling afterimage
localParameters:
  pressure:
    default: 0.4
    suggestedAudio: bass
    purpose: Controls the pressure buildup speed.
  heatBloom:
    default: 0.5
    suggestedAudio: mids
    purpose: Controls the amber mill heat bloom.
  ventFlash:
    default: 0.25
    suggestedAudio: kick
    purpose: Controls the white steam vent flash brightness.
  coolingAfterglow:
    default: 1
    suggestedAudio: highs
    purpose: Controls the UV cooldown after releases.
```

#### 11. `canopy_fracture`
* **Concept:** Blinding white lightning bolts strike down the redwood canopies in the background, fracturing out across the lookout tower bars. The rig remains in deep, cold darkness, flashing only on transients.
* **Channel Logic:**
  - `w/u` = High-speed branching transients
  - `a` = Low-intensity warm amber aftershocks
* **Metadata Block:**
  ```yaml
pattern: canopy_fracture
mood: sharp / transient / high-contrast
primaryChannels:
  rgb: cp1-cp2 brief, cold blue fractures
  white: blinding structural crack transients in trees
  amber: dim, lingering thermal aftershocks
  uv: structural fracture paths
localParameters:
  fractureAmount:
    default: 0.4
    suggestedAudio: kick
    purpose: Controls the fracture crack density.
  branchSharpness:
    default: 0.5
    suggestedAudio: highs
    purpose: Controls the decay rate of white branch flashes.
  aftershock:
    default: 0.25
    suggestedAudio: bass
    purpose: Controls the warm amber aftershock intensity.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 12. `outpost_distress_beacon`
* **Concept:** The lookout tower sends cold white Morse code signals (`... --- ...`). The background redwoods remain in deep UV darkness, while the front wall vintage lamps flicker amber in response.
* **Channel Logic:**
  - `w` = Morse signal sequence driven on the tower bars
  - `u` = Static, dark blue/UV redwood backing
  - `a` = Flickering wall response
* **Metadata Block:**
  ```yaml
pattern: outpost_distress_beacon
mood: dramatic / rhythmic / storytelling
primaryChannels:
  rgb: cp1-cp2 deep forest backing wash
  white: cold white Morse code signals (SOS)
  amber: flickering wall-response signals
  uv: deep, isolated dark redwood base
localParameters:
  signalStrength:
    default: 0.7
    suggestedAudio: kick
    purpose: Controls the white Morse distress signal brightness.
  responseGlow:
    default: 0.3
    suggestedAudio: vocals
    purpose: Controls the amber response glow.
  forestDarkness:
    default: 0.6
    suggestedAudio: lows
    purpose: Controls the background forest wash brightness.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

---

### 6.4 Hero Cinematic Patterns

#### 13. `redwood_timber_fall`
* **Concept:** A diagonal timberline tilts across the stage, simulating a falling redwood tree. Sub-bass drives the tilt angle as it rotates. One side of the stage remains warm amber; the other side transitions into a cold blue and UV canopy wash.
* **Channel Logic:**
  - `rgb/u` = Felled portion (blue/violet/UV)
  - `a` = Standing portion (warm amber filaments)
  - `w` = White crash impact / shear line
* **Metadata Block:**
  ```yaml
pattern: redwood_timber_fall
mood: cinematic / shifting / unstable
primaryChannels:
  rgb: cp1-cp2 wood wash vs. felled canopy split
  white: flashing white timber shear line
  amber: warm standing outpost filaments
  uv: cold falling-side canopy edge glow
localParameters:
  tiltAngle:
    default: 0.45
    suggestedAudio: mids
    purpose: Controls the angle of the falling timberline.
  timberlineSharpness:
    default: 0.55
    suggestedAudio: kick
    purpose: Controls the waterline division sharpness.
  fallDepth:
    default: 0.45
    suggestedAudio: lows
    purpose: Controls the brightness of the felled canopy wash.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 14. `shadow_canopy_eclipse`
* **Concept:** A deep circular shadow moves across the redwood tree canopy. UV outlines the perimeter of the shadow. As the eclipse passes over, the vintage lamps on the tower bloom into a bright warm-white corona.
* **Channel Logic:**
  - `rgb` = Inverted distance masking on redwoods (dark center)
  - `u` = UV rim glow
  - `a/w` = Corona flare on the tower vintage lights
* **Metadata Block:**
  ```yaml
pattern: shadow_canopy_eclipse
mood: dramatic / high-contrast / dark
primaryChannels:
  rgb: cp1-cp2 negative shadow field in tree canopy
  white: white corona alignment flashes
  amber: glowing vintage corona rim on tower
  uv: high-contrast outline rim
localParameters:
  eclipseDepth:
    default: 0.65
    suggestedAudio: lows
    purpose: Controls the center shadow size and darkness.
  coronaBloom:
    default: 0.4
    suggestedAudio: vocals
    purpose: Controls the warm corona ring brightness.
  rimShimmer:
    default: 1
    suggestedAudio: highs
    purpose: Controls the UV outline rim sharpness.
```

#### 15. `outpost_ember_overdrive`
* **Concept:** An aggressive ember-and-heat pattern. Fiery amber and red waves crawl up the front wall and tower bars, while RedwoodPARs receive controlled warm edge accents. Beats trigger white-hot heat releases at the tower platform.
* **Channel Logic:**
  - `a` = Roaring ember and heat rises ($+y$)
  - `w` = White-hot heat release transients at the tower platform
  - `u` = UV cooldown afterimage / cold shadow recovery
* **Metadata Block:**
  ```yaml
pattern: outpost_ember_overdrive
mood: aggressive / intense / energetic
primaryChannels:
  rgb: cp1-cp2 roaring ember color field
  white: white-hot heat release transients
  amber: dominant ember heat
  uv: cold shadow recovery after heat bursts
localParameters:
  emberSpeed:
    default: 0.5
    suggestedAudio: bass
    purpose: Controls the speed of the ember climb.
  emberHeight:
    default: 0.65
    suggestedAudio: lows
    purpose: Controls the vertical height of the ember wave.
  heatFlash:
    default: 0.3
    suggestedAudio: kick
    purpose: Controls the frequency of white heat releases.
  uvIntensity:
    default: 1
    suggestedAudio: lows
    purpose: Controls the baseline UV intensity.
```

#### 16. `redwood_starry_canopy`
* **Concept:** The show's climax. The three redwood trees light up with brilliant white and amber stars (flashing PARs). In sync, the lookout tower bars rotate with high-energy RGB color sweeps, and the wall vintage lights pulse on downbeats.
* **Channel Logic:**
  - `w` = Blinding white starry flashes on redwood PARs
  - `rgb` = High-speed tower bar rotations
  - `a` = Wall downbeat hits
* **Metadata Block:**
  ```yaml
pattern: redwood_starry_canopy
mood: euphoric / energetic / triumphant
primaryChannels:
  rgb: cp1-cp2 high-energy tower bar rotations
  white: brilliant starry flashes in redwood canopy
  amber: flashing wall downbeat accents
  uv: high-energy canopy edge glow
localParameters:
  starBrightness:
    default: 0.6
    suggestedAudio: kick
    purpose: Controls the white starry flash brightness.
  ringEnergy:
    default: 0.5
    suggestedAudio: bass
    purpose: Controls the tower sweep speed.
  wallHit:
    default: 0.45
    suggestedAudio: drums
    purpose: Controls the amber wall downbeat intensity.
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
| **Beautiful / Ambient (Scenic)**<br>*Best for openings, resets, ambient transitions, and breakdowns.* | 1. `forest_canopy_reveal`<br>3. `outpost_campfire`<br>4. `redwood_shadow_breath` |
| **EDM-Compatible Cinematic (Transition)**<br>*Best for build-ups, tension builds, and dramatic sweeps.* | 2. `redwood_aurora`<br>13. `redwood_timber_fall`<br>14. `shadow_canopy_eclipse`<br>15. `outpost_ember_overdrive` |
| **Fully EDM-Ready (Rhythmic & Impact)**<br>*Best for drops, active dance loops, and high-energy segments.* | 5. `lookout_gyro_vortex`<br>6. `timber_mill_clockwork`<br>7. `outpost_lockdown`<br>8. `tower_canopy_ping`<br>9. `woodland_trident_sweep`<br>10. `mill_pressure_release`<br>11. `canopy_fracture`<br>12. `outpost_distress_beacon`<br>16. `redwood_starry_canopy` |

### Playability Analysis
Out of 16 creative show patterns:
* **9 patterns** are directly EDM-ready (optimized for rhythmic beats, sharp drops, and fast motion).
* **13 patterns** are EDM-useful (including the transition/cinematic builds that shape show momentum).
* **3 patterns** serve as ambient reset triggers.

This offers a balanced show palette: some dance, some impact, some story, and some darkness.

---

## 8. Backlog & Future Variants

The following pattern concepts are preserved as backlog specifications for future show expansions and alternate track configurations:

1. **`redwood_canopy_comb`** — Phase-alternating sectors of the tree canopy rotating in opposite directions. Recommended for high-tempo techno sets.
2. **`lookout_meridian_sweep`** — Flat 2D sheets of color sweeping horizontally across the tower structure. Great for structural, geometric reveals.
3. **`forest_spark_shower`** — High-speed flickering spark generation on the tower vintage lamps triggering brief, localized RGB ground flares.
4. **`canopy_firefly_swarm`** — Dense particle arrays swarming in a randomized noise field focused around the high canopy coordinates ($y > 2.5$).
5. **`tower_chase_3way`** — Edge-locked pixel sweeps chasing concurrently around the lookout tower boundaries.
6. **`tower_par_strobe`** — Hyper-fast strobe chases isolated strictly to the tower vintage lights for pre-drop tension.

---

## 9. Implementation Style Guidance

To keep code clean and performant within the Wasm host, developers should build patterns in six sequential layers:

1. **Geometry Mask:** Isolate sections using rich metadata (`groupId`, `fixtureType`, `role`).
2. **RGB cp1/cp2 Color Field:** Interpolate palette colors channel-wise once per frame.
3. **White Impact Layer:** Compute transient impacts, lightning, or geometric sweeps.
4. **Amber Warmth Layer:** Compute vintage filament, campfire, or cabin lantern shapes.
5. **UV Shadow / Edge Layer:** Compute UV edge glow, canopy shadow, hidden structure, or negative-space masks.
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
  var isTowerBar     = (groupId == "TowerBars");
  var isTowerVintage = (groupId == "TowerVintageLights");
  var isWallVintage  = (groupId == "WallVintageLights");
  var isRedwood      = (groupId == "Redwoods1" || groupId == "Redwoods2" || groupId == "Redwoods3");

  // 2. Compute RGB cp1/cp2 color field (interpolated channel-wise)
  var colorMix = /* 0..1 phase */;
  var brightness = /* 0..1 intensity */;
  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness;

  // 3. Compute physical channels (driven by pattern parameters)
  var w = whiteIntensity * (isTowerVintage ? 1.0 : 0.0);
  var a = amberIntensity * (isWallVintage ? 1.0 : 0.0);
  var u = uvIntensity * (isRedwood ? 0.8 : 0.0);

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
