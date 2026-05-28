# Pattern Parameter Impact Review (2026-05-28)

Reviewer: Reviewer S — Slider Impact Audit
Scope: every `slider*` in `marsin_engine/patterns/*.js` (excluding `rainbow.js`, `test_*.js`, and the subdirectories `channel_blends/`, `transitions/`, `test/`).

---

## Headline findings

### Top 5 patterns with the most slider bloat (recommend cuts)

1. **`63_dome_phyllotaxis_bloom.js` (11 sliders)** — `bloomGrowth`/`armCount`/`seedSize`/`breathDepth`/`centerImpact`/`vintageWarm`/`blackoutDepth`/`voidDepth`/`petalSharpness`/`shockwavePower`/`localSpeed`. `voidDepth` and `blackoutDepth` overlap. `petalSharpness` and `seedSize` interact pairwise. **Cut: `voidDepth` (fold into `blackoutDepth`) and `centerImpact` (merge with `shockwavePower`).**
2. **`48_titanic_sos_beacon.js` (11 sliders)** — `signalStrength` and `brightness` are both global multipliers (lines 186, 195). `echoDelay` and `echoWidth` mostly co-vary. **Cut: `brightness` (redundant with `signalStrength`), `washBrightness` (only used as a wash floor).**
3. **`111_logsville_giant_pixel_heartbeat.js` (11 sliders)** — `popBrightness`+`popDecay`+`vintageMix`+`heartbeatPattern`+`sectionCountSlider` plus 3 audio + 3 layout sliders. Many show no audible delta until audio is bound.
4. **`112_logsville_giant_call_response.js` (11 sliders)** — same layout as 111 with `turnBrightness`/`turnDecay`/`conversation`/`sectionCountSlider`. Identical bloat profile.
5. **`110_logsville_giant_pixel_chase.js` (10 sliders)** — `sectionFloor`+`neighborWeight`+`stepSmoothness`+`vintageMix`+`sectionCountSlider`+`chaseMode`+3 audio. `stepSmoothness` and `neighborWeight` both affect halo softness.

Also notable: **`40_ghost_ship_reveal.js` (10 sliders)**, **`56_stage_mirror_axis.js` (10 sliders)**, **`13_sparkle.js` (10 sliders)**.

### Top 5 patterns with NO-OP or near-no-op sliders (recommend deletion)

1. **`83_shadow_canopy_eclipse.js` — `sliderRimSharpness`** at line 86 only modulates `rimBand` width by ±0.10 inside an already-thin band; visual delta is invisible against the much larger `eclipseWidth` change.
2. **`56_stage_mirror_axis.js` — `sliderCenterGuide`** (line 47): explicitly a setup/aim tool, default 0; not a performance slider, doesn't belong on the slider strip. **Move to a config field.**
3. **`56_stage_mirror_axis.js` — `sliderAxisDrift`** (line 44): only used at line 97 to scale `driftPhase` rate by `0.04 + axisDrift * 0.18`; tiny phase-rate change with no visible per-pixel effect.
4. **`05_orbital_attractor_field.js` — `sliderBlackoutTexture`** (line 27): produces a pixelated mask effect that visually corrupts the otherwise smooth attractor field; mostly noise. (See report 4 §5.1 on this pattern.)
5. **`13_sparkle.js` — `sliderSparkleSpeedTrim`** (line 26): redundant with the global `sliderLocalSpeed`; the same pattern also has `sliderBackgroundLevel`, `sliderUvGlint`, `sliderAmberGlint` all of which are channel-level static multipliers a sensible operator never touches mid-show.

Additional NO-OPs:
- **`07_shimmer.js` — `sliderShimmerSpeedTrim`** (line 18) — same redundancy with `localSpeed`.
- **`82_redwood_timber_fall.js` — `sliderDustGlow`** only writes a UV cloud value that's gated to a short window inside the fall cycle; the operator can't see the difference between 0.3 and 0.8 unless they're actively watching for it.
- **`73_redwood_shadow_breath.js` — `sliderEdgeShimmer`** (line 101): `w = edgeShimmer * (random(1) < 0.01 ? 1.0 : 0.0)` — fires for a 1-frame strobe at 60 Hz, invisible.
- **`72_outpost_campfire.js` — `sliderWoodSparkle`** (line 94): same per-frame `random(1) < 0.03` strobe — invisible at 60 Hz.

### Top 5 patterns with redundant slider pairs (recommend consolidation)

1. **`13_sparkle.js`**: `sliderLocalSpeed` + `sliderSparkleSpeedTrim` — both scale time. **Drop `sparkleSpeedTrim`.**
2. **`07_shimmer.js`**: `sliderLocalSpeed` + `sliderShimmerSpeedTrim` — same. **Drop `shimmerSpeedTrim`.**
3. **`63_dome_phyllotaxis_bloom.js`**: `sliderBlackoutDepth` + `sliderVoidDepth` — both create negative space (lines 235-246, 274). **Drop `voidDepth`.**
4. **`48_titanic_sos_beacon.js`**: `sliderSignalStrength` + `sliderBrightness` — both global multipliers on output (lines 186, 195). **Drop `brightness`.**
5. **`110/111/112_logsville_giant_pixel_*`**: each has `sectionFloor` + `neighborWeight` + (110: `stepSmoothness`, 111: `popDecay`, 112: `turnDecay`). The floor and halo levels are visually inseparable on the operator's perception scale once playing live. **Consider folding `sectionFloor` into a fixed 0.08 default and only exposing `neighborWeight`.**

Also: **`46_dome_lockdown.js`** `sliderBeaconWidth` and `sliderBeaconPunch` both shape the same beam — width sets feature size, punch sets brightness; they almost always need to move together.

### Sliders whose defaults sit at a visually-bad spot

- **`53_shadow_eclipse.js` `blackoutDepth = 0.82`** — too dark for playa read; report 4 §6.2 already flagged this for `43`; here even worse. Recommend default `0.55`.
- **`43_sea_floor_shadow.js` `blackoutDepth = 0.55`** — already noted in prior report.
- **`02_phase_cathedral.js`** has no `blackoutDepth` slider but `sharpness = 4.0` default crushes mid-field to black; soften default to `2.5`.
- **`70_forest_canopy_reveal.js` `canopyReveal = 1.0`** — the slider is maxed by default; means the operator has nowhere to push up to, only down. Default to `0.6`.
- **`72_outpost_campfire.js` `uvIntensity = 1.0`** — default max, and (per report 4 §7.1) UV leaks stage-wide. Default to `0.5`.
- **`73_redwood_shadow_breath.js` `shadowDepth = 1.0`** — same problem, defaults to max.
- **`77_tower_canopy_ping.js` `uvIntensity = 1.0`** and **`80_canopy_fracture.js` `uvIntensity = 1.0`** and **`85_redwood_starry_canopy.js` `uvIntensity = 1.0`** — same anti-pattern: every redwood pattern ships with UV maxed out by default. Recommend uniform default `0.6`.
- **`23_prismatic_strange_attractors.js` `darkFloor = 0.04`** (line 11) — exposes the operator to "completely dark" at slider 0; raise floor to `0.06`.
- **`12_breathing.js`** — no minimum brightness floor; can hit full black on every breath. Add a `minBrightness` slider with default `0.04`.

---

## Per-pattern table

### `00_golden_hour_wash.js` (2 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | standard speed control |
| sliderNoiseScale | noiseScale | HIGH | drives the field spatial frequency (line 50); operator-visible everywhere |

Recommendation: clean, minimal. Keep.

### `01_cylon_sweep.js` (5 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | sweep rate |
| sliderBeamWidth | eyeWidth | HIGH | beam fatness (line 89) |
| sliderBackgroundGlow | bgBrightness | MED | background floor (line 98) |
| sliderDirection | globalDir | HIGH | sweep direction reverse |
| sliderAudioBrightness | audioBrightness | MED | prototype audio gain (line 107); off by default — needs CPC binding to mean anything |

Recommendation: keep.

### `02_phase_cathedral.js` (4 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderCount | radialDensity | HIGH | ring count (line 57) |
| sliderSharpness | sharpness | HIGH | crushes mid-field to black; default 4.0 is aggressive |
| sliderDirection | globalDir | HIGH | reverses field |

Recommendation: lower `sharpness` default to ~2.5.

### `03_dual_axis_crush.js` (4 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderCount | swipeLength | HIGH | beam reach (line 84) |
| sliderBeamWidth | beamWidth | HIGH | beam fatness |
| sliderDirection | globalDir | HIGH | |

Recommendation: keep, all four matter.

### `04_beat_folded_helix.js` (5 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderCount | armCount | HIGH | arm count (line 60) |
| sliderTwistFreq | twistFreq | HIGH | spiral twist amount |
| sliderContrast | contrast | HIGH | pow exponent (line 64) |
| sliderOverallBrightness | overallBrightness | MED | output gain (lines 119-125); redundant with engine global brightness |

Recommendation: cut `sliderOverallBrightness` — global brightness already covers it.

### `05_orbital_attractor_field.js` (5 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderFalloff | falloff | HIGH | attractor blob size (line 76) |
| sliderFocus | focus | HIGH | shape exponent |
| sliderColorVariation | colorVariation | MED | adds non-palette hue drift; subtle |
| sliderBlackoutTexture | blackoutTexture | NO-OP | line 127-137 — produces a noisy moving black mask that mostly looks like dead pixels from playa |

Recommendation: cut `sliderBlackoutTexture` (visually broken; see report 4 critique).

### `06_neon_elevator.js` (4 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderSteps | stepCount | MED | only 3 visible tiers in `visualY` (lines 91-94), so steps > 3 "skip" floors invisibly |
| sliderThickness | floorThickness | HIGH | floor band width (line 102) |
| sliderBloom | bloomPower | HIGH | pow exponent on `v` |

Recommendation: clamp `sliderSteps` to 1..3 since the rig only resolves 3 tiers.

### `07_shimmer.js` (4 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderShimmerSpeedTrim | shimmerSpeedTrim | NO-OP | redundant with `localSpeed` (lines 26-27); operator can't tell them apart live |
| sliderDensity | shimmerDensity | HIGH | sparkle spacing (line 35) |
| sliderBreathing | breathingInt | HIGH | breath amplitude (line 39) |

Recommendation: **cut `sliderShimmerSpeedTrim`**.

### `08_ocean_liner.js` (4 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderContrast | contrastAmount | MED | pow on baseV (line 72); subtle in default range |
| sliderWindowCount | windowCount | HIGH | porthole spacing (line 74) |
| sliderWindowFocus | windowFocus | HIGH | porthole sharpness (line 77) |

Recommendation: keep.

### `09_cyclone.js` (3 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderDensity | density | HIGH | particle count |
| sliderParticleSize | particleSize | HIGH | comet length (line 52) |

Recommendation: keep — minimal and effective.

### `10_chasers.js` (3 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderParticleCount | particleCount | HIGH | swarm size; per-pixel loop cost |
| sliderTailLength | tailLength | HIGH | tail reach (line 60) |

Recommendation: keep.

### `11_bioluminescence.js` (4 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderDensity | density | HIGH | swell crest count |
| sliderUvGlow | uvIntensity | HIGH | UV channel scale (line 90) |
| sliderPartyMode | partyMode | HIGH | strobe gate at >0.5 (line 72) — binary toggle |

Recommendation: keep, but `partyMode` is binary (0/1 switch) — should be a button/toggle in the UI, not a continuous slider.

### `12_breathing.js` (3 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderRipple | spatialOffset | HIGH | per-pixel offset of breath (line 28) |
| sliderSharpness | breathSharpness | HIGH | pow on wave (line 29) |

Recommendation: keep. Add a min-brightness floor.

### `13_sparkle.js` (10 sliders — BLOAT)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderSparkleSpeedTrim | sparkleSpeedTrim | NO-OP | redundant with `localSpeed` (lines 72-73) |
| sliderSparkleDensity | sparkleDensity | HIGH | threshold (line 101) |
| sliderSparkleIntensity | sparkleIntensity | HIGH | sparkle peak (line 112) |
| sliderSparkleSize | sparkleSize | MED | shape exponent + bloom (line 111) |
| sliderBackgroundLevel | backgroundLevel | MED | static floor (line 106); a config not a perf slider |
| sliderWhiteGlint | whiteGlint | LOW | channel-level scalar (line 120); operator sets once |
| sliderAmberGlint | amberGlint | LOW | same |
| sliderUvGlint | uvGlint | LOW | same |
| sliderBackgroundMotion | backgroundMotion | MED | bg field motion (lines 89-90) |

Recommendation: **cut `sparkleSpeedTrim`, `whiteGlint`, `amberGlint`, `uvGlint`** (move to a single `glintLevels` config). 6 sliders is plenty.

### `14_lunar_current.js` (4 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderDensity | density | HIGH | wave count |
| sliderWhiteLift | whiteLift | HIGH | crown white (line 87) |
| sliderUvLift | uvLift | HIGH | UV crown (line 88) |

Recommendation: keep.

### `15_silk_prism_ribbons.js` (3 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderRibbonCount | ribbonCount | HIGH | |
| sliderSoftness | softness | HIGH | pow exponent (line 36) |

Recommendation: clean. Keep.

### `16_ghost_tide_uv.js` (4 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderTideWidth | tideWidth | HIGH | foam band width (line 76) |
| sliderWhiteLevel | whiteLevel | HIGH | foam W (line 87) |
| sliderUvLevel | uvLevel | HIGH | UV (line 88) |

Recommendation: keep.

### `17_rolling_color_dunes.js` (7 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderDuneScale | duneScale | HIGH | scale + drift (lines 106, 110-115) |
| sliderDuneContrast | duneContrast | HIGH | pow exponent (line 118) |
| sliderOrbitDrift | orbitDrift | HIGH | phase rate (lines 91-93) |
| sliderBlackoutDepth | blackoutDepth | HIGH | line 154 dark floor |
| sliderStageSurf | stageSurf | HIGH | edge surf brightness (lines 138-143) |
| sliderAmberWarmth | amberWarmth | MED | vintage tint (line 149) |

Recommendation: keep — 7 is the upper limit but each does something distinct.

### `18_deep_space_lattice.js` (3 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderLatticeScale | latticeScale | HIGH | grid density (lines 40-42) |
| sliderLineSoftness | lineSoftness | HIGH | pow on lattice (line 45) |

Recommendation: keep.

### `19_swaying_lattice_ballet.js` (6 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderLatticeScale | latticeScale | HIGH | |
| sliderSwayAmount | swayAmount | HIGH | sway X/Y amplitude (line 75) |
| sliderNodeSoftness | nodeSoftness | HIGH | pow on node (line 101) |
| sliderCounterPhase | counterPhase | MED | lattice-B sway scaling (line 96) |
| sliderFloorLevel | floorLevel | MED | brightness floor (line 111) |

Recommendation: keep.

### `20_parametric_sway_field.js` (4 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderReach | reach | HIGH | attractor reach (lines 91-98) |
| sliderFocus | focus | HIGH | glow falloff (line 105) |
| sliderTrailBlend | trailBlend | MED | small additive (line 108) |

Recommendation: keep.

### `21_pelagic_manta_rays.js` (5 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderRaySpan | raySpan | HIGH | wing width (line 77) |
| sliderDepthFocus | depthFocus | HIGH | pow exponent (line 78) |
| sliderWhiteFoam | whiteFoam | HIGH | foam W |
| sliderUvUndertow | uvUndertow | HIGH | UV scale |

Recommendation: keep.

### `22_abyssal_sway_garden.js` (6 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderFrondDensity | frondDensity | HIGH | frond count |
| sliderSwayAmplitude | swayAmplitude | HIGH | bend amount (line 85) |
| sliderTipGlow | tipGlow | HIGH | tip flicker scale (line 105) |
| sliderBaseDarkness | baseDarkness | HIGH | floor dim |
| sliderCurrentRate | currentRate | MED | only scales `tCurrent` (line 68); overlaps with `localSpeed` |

Recommendation: consider cutting `currentRate` (subsumed by `localSpeed`).

### `23_prismatic_strange_attractors.js` (8 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderChaos | chaos | HIGH | freq mult on curls (line 112-114) |
| sliderOrbitReach | orbitReach | HIGH | attractor radii |
| sliderContrast | contrast | HIGH | pow exponents (lines 117-118) |
| sliderDarkFloor | darkFloor | MED | bias on intensity (line 119) |
| sliderWhiteCore | whiteCore | HIGH | W channel |
| sliderUvGhost | uvGhost | HIGH | UV channel |
| sliderColorSpread | colorSpread | MED | mixes hue spread (line 122); subtle |

Recommendation: keep — most matter.

### `24_chromatic_murmuration.js` (6 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderFlockReach | flockReach | HIGH | attractor reach |
| sliderFlockFocus | flockFocus | HIGH | glow falloff (line 104-106) |
| sliderFilamentDensity | filamentDensity | HIGH | ribbon freq (line 108) |
| sliderContrast | contrast | HIGH | pow on glow and ribbon |
| sliderAfterglow | afterglow | MED | constant offset to `v` (line 110); small |

Recommendation: keep.

### `25_heartbeat.js` (3 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderDormantGlow | minBright | HIGH | floor brightness (line 80) |
| sliderRippleSweep | rippleAmount | HIGH | sweeping vs lockstep (line 68) |

Recommendation: keep — clean.

### `40_ghost_ship_reveal.js` (10 sliders — BLOAT)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderRevealWidth | revealWidth | HIGH | multiple uses (beam widths, port pulses) |
| sliderOrbitDrift | orbitDrift | HIGH | rates of tOrbit + tSpin |
| sliderBlackoutDepth | blackoutDepth | MED | small contributions (lines 231, 279, 282) |
| sliderLanternGlow | lanternGlow | HIGH | flicker speed + lantern intensity |
| sliderBeaconSparkle | beaconSparkle | MED | apex white scale (line 304) |
| sliderUvTrail | uvTrail | HIGH | UV gain (line 295) |
| sliderSpinMotion | spinMotion | MED | overlaps `orbitDrift` (line 118) |
| sliderHullDarkness | hullDarkness | HIGH | hull mask depth (line 189) |
| sliderPortBrightness | portBrightness | HIGH | window port pulses |

Recommendation: cut `spinMotion` (overlaps `orbitDrift`), `beaconSparkle` (move to fixed coeff). 8 sliders is more livable.

### `41_ghost_aurora.js` (7 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderCurtainWidth | curtainWidth | HIGH | many uses |
| sliderDriftChaos | driftChaos | HIGH | turbulence + rates |
| sliderBlackoutDepth | blackoutDepth | HIGH | pow exponents on ribbons |
| sliderRimShimmer | rimShimmer | HIGH | white rim |
| sliderTriangleGain | triangleGain | HIGH | edge/par scale |
| sliderHumanWarmth | humanWarmth | HIGH | vintage glow |

Recommendation: keep.

### `42_boiler_glow.js` (8 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderBoilerHeat | boilerHeat | HIGH | global heat |
| sliderFlickerComplexity | flickerComplexity | HIGH | rate (line 129) |
| sliderVentWidth | ventWidth | HIGH | sector widths |
| sliderSteamFlash | steamFlash | HIGH | flash intensity (line 170) |
| sliderTriangleRPM | triangleRPM | HIGH | needle speed |
| sliderBlackoutDepth | blackoutDepth | MED | dark floor only (line 245) |
| sliderFlashRate | flashRate | HIGH | hard-cap on flash Hz |

Recommendation: keep — all justified for a complex stage effect.

### `43_sea_floor_shadow.js` (7 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderShadowWidth | shadowWidth | HIGH | width of shadow band (line 120) |
| sliderShadowDrift | shadowDrift | HIGH | drift rate (line 100) |
| sliderAbyssalSwell | abyssalSwell | HIGH | swell rate + amber tint |
| sliderEdgeFoam | edgeFoam | HIGH | rim widths + amber |
| sliderBlackoutDepth | blackoutDepth | HIGH | floor; default 0.55 too dark |
| sliderTriangleSilhouette | triangleSilhouette | HIGH | edge brightness |

Recommendation: lower `blackoutDepth` default to 0.40.

### `44_apex_gyro_vortex.js` (8 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderVortexSpeed | vortexSpeed | HIGH | tPhase rate |
| sliderSweepImpact | sweepImpact | HIGH | multiple multipliers |
| sliderHullGlow | hullGlow | HIGH | base brightness (line 159) |
| sliderUvIntensity | uvIntensity | HIGH | UV |
| sliderVortexWidth | vortexWidth | HIGH | core fatness |
| sliderArmPhase | armPhase | LOW | unused/barely used — searched, only at line in arm shape; **NO-OP risk** — verify |
| sliderBlackoutDepth | blackoutDepth | MED | small floor contribution |

Recommendation: check `sliderArmPhase` usage; cut if confirmed no-op.

### `45_engine_room_clockwork.js` (8 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderGearSharpness | gearSharpness | HIGH | gear tooth pulse (line 132) |
| sliderPistonStroke | pistonStroke | HIGH | gear rates (lines 92-94) |
| sliderDriveShaft | driveShaft | HIGH | par chase scale (line 158) |
| sliderBarTickDensity | barTickDensity | MED | only used inside the bar branch (verify) |
| sliderBoilerHeat | boilerHeat | HIGH | vintage warmth |
| sliderPauseAmount | pauseAmount | HIGH | pause gate (line 119) |
| sliderBlackoutDepth | blackoutDepth | MED | floor only |

Recommendation: keep.

### `46_dome_lockdown.js` (9 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderBeaconWidth | beaconWidth | HIGH | beam widths |
| sliderBeaconPunch | beaconPunch | HIGH | beam brightness |
| sliderStrobeRate | strobeRate | MED | not visibly used in extracted lines — verify |
| sliderAlarmCadence | alarmCadence | HIGH | par flash Hz (line 92) |
| sliderSpinDirection | spinDirection | HIGH | direction (line 84) |
| sliderHoldBlackout | holdBlackout | HIGH | dark span (line 108); default 0.15 is right per report 4 |
| sliderAmberMix | amberMix | HIGH | amber tint (multiple) |
| sliderBlackoutDepth | blackoutDepth | MED | floor |

Recommendation: verify `sliderStrobeRate` actually wires; the only `hz` line uses `strobeRate * MAX_STROBE_HZ` in `beforeRender` — fine, HIGH.

### `47_apex_perimeter_ping.js` (8 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderPingWidth | pingWidth | HIGH | ping band width |
| sliderGhostMix | ghostMix | MED | low-impact mix; verify usage in render3D |
| sliderCoronaImpact | coronaImpact | HIGH | corona brightness |
| sliderTrailDecay | trailDecay | HIGH | trail length (line 104, 177) |
| sliderRingEcho | ringEcho | MED | echo strength (verify) |
| sliderVintageMidpoint | vintageMidpoint | HIGH | amber (line 183) |
| sliderBlackoutDepth | blackoutDepth | LOW | dark floor only |

Recommendation: review `ghostMix` and `ringEcho`; might be cuttable.

### `48_titanic_sos_beacon.js` (11 sliders — BLOAT)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderSignalStrength | signalStrength | HIGH | global multiplier on stage/white (lines 186, 195) |
| sliderSignalSpeed | signalSpeed | HIGH | morse rate (line 89) |
| sliderEchoDelay | echoDelay | MED | morse echo time (line 206) |
| sliderEchoWidth | echoWidth | MED | verify usage |
| sliderResponseGlow | responseGlow | HIGH | vintage |
| sliderAbyssalDarkness | abyssalDarkness | HIGH | dark floor |
| sliderEdgeSoftness | edgeSoftness | MED | morse edge softness; verify |
| sliderBrightness | brightness | LOW | **redundant with `signalStrength`** + global brightness — cut |
| sliderSearchlightSweep | searchlightSweep | MED | secondary motion |
| sliderWashBrightness | washBrightness | LOW | only wash floor — cut, fold into `abyssalDarkness` inverse |

Recommendation: **cut `sliderBrightness` and `sliderWashBrightness`**. Consider folding `echoDelay`+`echoWidth` into one.

### `49_boiler_pressure_release.js` (9 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderPressure | pressure | HIGH | build rate (line 60) |
| sliderReleaseThreshold | releaseThreshold | HIGH | threshold (line 76) |
| sliderVentWidth | ventWidth | HIGH | gauge/column widths |
| sliderHeatBloom | heatBloom | HIGH | multiple uses |
| sliderVentFlash | ventFlash | HIGH | burst intensity (line 91, 95) |
| sliderCoolingAfterglow | coolingAfterglow | HIGH | UV/amber tail |
| sliderSteamRise | steamRise | HIGH | column rise rate + puff width |
| sliderBlackoutDepth | blackoutDepth | MED | floor only |

Recommendation: keep.

### `50_iceberg_fracture.js` (8 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderFractureDensity | fractureDensity | HIGH | rate (line 58) + many bands |
| sliderBranchSpread | branchSpread | HIGH | rate + widths |
| sliderStrikeDecay | strikeDecay | HIGH | white tail (line 88, 128) |
| sliderAftershockWarmth | aftershockWarmth | MED | check if actually used in extracted body |
| sliderLaneCount | laneCount | HIGH | lane count (line 71) |
| sliderShardJag | shardJag | MED | pow exponent (line 101) |
| sliderBlackoutDepth | blackoutDepth | MED | floor |

Recommendation: keep; `aftershockWarmth` likely LOW.

### `51_abyssal_searchlight.js` (8 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderBeamWidth | beamWidth | HIGH | beam width |
| sliderBeamReach | beamReach | HIGH | rate (line 85) |
| sliderBeamPunch | beamPunch | HIGH | brightness multiple |
| sliderTrailLength | trailLength | HIGH | tail offsets |
| sliderSwirlMix | swirlMix | MED | rate of tSwirl (line 86); subtle |
| sliderVintageBleed | vintageBleed | HIGH | amber level (line 190) |
| sliderBlackoutDepth | blackoutDepth | MED | floor |

Recommendation: keep.

### `52_iceberg_shear_line.js` (7 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderShearAngle | shearAngle | MED | small offset on blade (line 66) — verify perceptual delta |
| sliderShearWidth | shearWidth | HIGH | blade/crack widths |
| sliderAdvance | advance | HIGH | shear phase rate (verify) |
| sliderSubmergeDepth | submergeDepth | HIGH | line 120 bri |
| sliderWarmthRetreat | warmthRetreat | MED | amber on the warm side (line 115) |
| sliderTriangleBlade | triangleBlade | HIGH | edge gain |

Recommendation: keep; consider cutting `shearAngle`.

### `53_shadow_eclipse.js` (7 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderShadowSize | shadowSize | HIGH | radius (line 63) |
| sliderRimWidth | rimWidth | HIGH | rim widths |
| sliderOrbitEccentricity | orbitEccentricity | HIGH | orbit rate + wobble (lines 51, 62) |
| sliderCoronaPulse | coronaPulse | HIGH | rate + multiple |
| sliderVintageBloom | vintageBloom | HIGH | amber (line 116) |
| sliderBlackoutDepth | blackoutDepth | HIGH | **default 0.82 is too dark; recommend 0.55** |

Recommendation: lower `blackoutDepth` default.

### `54_boiler_fire_overdrive.js` (7 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderFlameHeight | flameHeight | HIGH | flame shape |
| sliderTongueCount | tongueCount | HIGH | tongues count (line 24) |
| sliderSwirl | swirl | HIGH | flame swirl |
| sliderHeatFlash | heatFlash | HIGH | multiple |
| sliderAmberBias | amberBias | HIGH | amber level (line 52) |
| sliderBlackoutDepth | blackoutDepth | MED | floor |

Recommendation: keep.

### `55_stardust_dome.js` (7 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderStarCore | starCore | HIGH | par/edge core brightness |
| sliderParticleDensity | particleDensity | HIGH | dust density + exponents |
| sliderOrbitSpeed | orbitSpeed | HIGH | tOrbit rate |
| sliderRingWidth | ringWidth | HIGH | beam width |
| sliderWallHit | wallHit | HIGH | bar brightness (line 111) |
| sliderBlackoutDepth | blackoutDepth | MED | floor |

Recommendation: keep.

### `56_stage_mirror_axis.js` (10 sliders — BLOAT)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderCenter | center | HIGH | aim axis |
| sliderMirrorWidth | mirrorWidth | HIGH | beam widths |
| sliderOrbitSpeed | orbitSpeed | HIGH | rate (line 95) |
| sliderParticleDensity | particleDensity | HIGH | density (line 96, 128) |
| sliderStageFocus | stageFocus | HIGH | axis line width + scaling |
| sliderAxisDrift | axisDrift | LOW | only scales `driftPhase` rate by tiny amount (line 97) |
| sliderBlackoutDepth | blackoutDepth | MED | floor only |
| sliderUvEdge | uvEdge | HIGH | UV gain |
| sliderCenterGuide | centerGuide | LOW | setup tool (default 0); **move out of slider strip** |

Recommendation: **cut `sliderAxisDrift` and `sliderCenterGuide`** (or move guide to a config field).

### `63_dome_phyllotaxis_bloom.js` (11 sliders — BLOAT)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderBloomGrowth | bloomGrowth | HIGH | multiple phase rates |
| sliderArmCount | armCount | HIGH | line 137 |
| sliderSeedSize | seedSize | HIGH | widths multiple |
| sliderBreathDepth | breathDepth | HIGH | line 141 |
| sliderCenterImpact | centerImpact | HIGH | apex/par |
| sliderVintageWarm | vintageWarm | HIGH | amber |
| sliderBlackoutDepth | blackoutDepth | MED | global floor only (line 274) |
| sliderVoidDepth | voidDepth | HIGH | petal carving (lines 235-246) |
| sliderPetalSharpness | petalSharpness | HIGH | petal exponent |
| sliderShockwavePower | shockwavePower | HIGH | many multipliers |

Recommendation: **`blackoutDepth` and `voidDepth` overlap functionally — fold into one.** Consider merging `centerImpact` into `shockwavePower`.

### `65_dome_kick_shockwave.js` (6 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderShockSpeed | shockSpeed | HIGH | many rates |
| sliderRingWidth | ringWidth | HIGH | width |
| sliderImpact | impact | HIGH | global brightness/exponent driver |
| sliderEchoes | echoes | HIGH | echo amplitude (line 134) |
| sliderVoidDepth | voidDepth | HIGH | floor + shadow (line 146) |

Recommendation: clean, well-shaped. Keep.

### `70_forest_canopy_reveal.js` (4 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderCanopyReveal | canopyReveal | HIGH | UV gain (line 94); **default 1.0 — operator can only push down** |
| sliderLanternGlow | lanternGlow | MED | amber wave amplitude (line 101) |
| sliderCanopySparkle | canopySparkle | NO-OP | per-frame `random(1) < 0.02` strobe (line 95) — invisible at 60 Hz |

Recommendation: **cut `sliderCanopySparkle`**; default `canopyReveal` to 0.6.

### `71_redwood_aurora.js` (5 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderAuroraHeight | auroraHeight | HIGH | amplitude (line 127) |
| sliderWindShimmer | windShimmer | MED | gated noise (line 141) |
| sliderCabinWarmth | cabinWarmth | HIGH | amber (line 135) |
| sliderUvIntensity | uvIntensity | HIGH | UV gain (line 145); default 0.8 too high |

Recommendation: lower `uvIntensity` default.

### `72_outpost_campfire.js` (5 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderFlickerSpeed | flickerSpeed | HIGH | flicker rate (lines 88-89) |
| sliderCampfireHeat | campfireHeat | HIGH | amber heat (line 90) |
| sliderWoodSparkle | woodSparkle | NO-OP | per-frame `random(1) < 0.03` — invisible (line 94) |
| sliderUvIntensity | uvIntensity | HIGH | UV (line 101); **default 1.0 + stage-wide bleed (per report 4)** |

Recommendation: **cut `sliderWoodSparkle`**; default `uvIntensity` to 0.5.

### `73_redwood_shadow_breath.js` (4 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderShadowDepth | shadowDepth | HIGH | UV scale (line 98); **default 1.0** |
| sliderCanopySwell | canopySwell | HIGH | RGB scale (lines 95-97) |
| sliderEdgeShimmer | edgeShimmer | NO-OP | per-frame `random(1) < 0.01` (line 101) |

Recommendation: **cut `sliderEdgeShimmer`**; default `shadowDepth` to 0.7.

### `74_lookout_gyro_vortex.js` (5 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderVortexSpeed | vortexSpeed | HIGH | sweep speed (lines 123-145) |
| sliderSweepImpact | sweepImpact | HIGH | white peak (line 146) |
| sliderOutpostGlow | outpostGlow | HIGH | redwood RGB (line 127) |
| sliderUvIntensity | uvIntensity | HIGH | UV (line 133); default 0.7 |

Recommendation: keep (but pattern itself flagged REWRITE in report 4).

### `75_timber_mill_clockwork.js` (6 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderGearSpeed | gearSpeed | HIGH | rates (lines 142, 166) |
| sliderTickSharpness | tickSharpness | NO-OP | per-frame `random(1) < 0.15` strobe (line 159) — invisible |
| sliderBoilerHeat | boilerHeat | HIGH | amber (line 156) |
| sliderPulleyAdvance | pulleyAdvance | HIGH | smoothness (line 145) |
| sliderUvIntensity | uvIntensity | HIGH | UV (line 151) |

Recommendation: **cut `sliderTickSharpness`**.

### `76_outpost_lockdown.js` (6 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderBeaconWidth | beaconWidth | HIGH | distance threshold (lines 127, 132) |
| sliderAlarmHeat | alarmHeat | HIGH | brightness (lines 134-135) |
| sliderPerimeterWash | perimeterWash | HIGH | background brightness (lines 147-149) |
| sliderStrobeRate | strobeRate | HIGH | hz (line 103) |
| sliderUvIntensity | uvIntensity | HIGH | UV (line 152) |

Recommendation: keep (pattern itself is broken per report 4; sliders are sensible).

### `77_tower_canopy_ping.js` (6 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderPingSpeed | pingSpeed | HIGH | head rate (line 112) |
| sliderPingWidth | pingWidth | HIGH | band width (lines 117-118) |
| sliderPingImpact | pingImpact | HIGH | white (line 128) |
| sliderEdgeTrail | edgeTrail | HIGH | UV gain (line 135) |
| sliderUvIntensity | uvIntensity | HIGH | UV (line 135); **default 1.0** |

Recommendation: lower `uvIntensity` default.

### `78_woodland_trident_sweep.js` (6 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderSweepWidth | sweepWidth | HIGH | band width (lines 119-121) |
| sliderSweepImpact | sweepImpact | HIGH | multiplier on r/g/b/w |
| sliderProngSpacing | prongSpacing | HIGH | offsets (lines 117-118) |
| sliderFloorWash | floorWash | HIGH | wash multiplier (lines 145-147) |
| sliderUvIntensity | uvIntensity | HIGH | UV gain (line 140) |

Recommendation: keep.

### `79_mill_pressure_release.js` (6 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderPressure | pressure | HIGH | hz (line 96) |
| sliderHeatBloom | heatBloom | HIGH | amber (line 141) |
| sliderVentFlash | ventFlash | HIGH | W (line 146) |
| sliderVentTexture | ventTexture | MED | small additive on amber (line 142) |
| sliderCoolingAfterglow | coolingAfterglow | HIGH | tail RGB+UV (lines 151-156) |

Recommendation: keep.

### `80_canopy_fracture.js` (5 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderFractureAmount | fractureAmount | HIGH | threshold (line 92) |
| sliderBranchSharpness | branchSharpness | HIGH | W (line 98) |
| sliderAftershock | aftershock | HIGH | wash amber (line 90) |
| sliderUvIntensity | uvIntensity | HIGH | UV (line 104); **default 1.0** |

Recommendation: lower `uvIntensity` default to 0.6.

### `81_outpost_distress_beacon.js` (6 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderBeaconRate | beaconRate | HIGH | hz (line 117) |
| sliderBeaconWidth | beaconWidth | HIGH | spot width (line 141) |
| sliderBeaconBrightness | beaconBrightness | HIGH | peak (line 141) |
| sliderResponseGlow | responseGlow | HIGH | amber (line 147) |
| sliderUvIntensity | uvIntensity | HIGH | UV (line 158) |

Recommendation: keep (pattern itself flagged REWRITE in report 4).

### `82_redwood_timber_fall.js` (6 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderFallDuration | fallDuration | HIGH | cycle sec (line 112) |
| sliderStandBrightness | standBrightness | HIGH | quiet trees (lines 207, 211) |
| sliderCanopyBrightness | canopyBrightness | HIGH | falling canopy (lines 149, 178-180) |
| sliderImpactFlash | impactFlash | HIGH | W on impact (line 192) |
| sliderDustGlow | dustGlow | MED | UV cloud (line 194); only visible in short post-impact window |

Recommendation: keep.

### `83_shadow_canopy_eclipse.js` (5 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderEclipseWidth | eclipseWidth | HIGH | shadow window (lines 102-108) |
| sliderRimSharpness | rimSharpness | LOW | only modulates `rimBand` width by ±0.10 (line 86) — visually subtle |
| sliderCoronaBloom | coronaBloom | HIGH | W (line 118) |
| sliderFloorWash | floorWash | HIGH | floor brightness (line 127) |

Recommendation: consider cutting `rimSharpness`.

### `84_outpost_ember_overdrive.js` (6 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderEmberSpeed | emberSpeed | HIGH | rate (line 107) |
| sliderHeatIntensity | heatIntensity | HIGH | heat (line 125) |
| sliderSparkleDensity | sparkleDensity | HIGH | spark gate (line 139) |
| sliderFlashRate | flashRate | HIGH | hz (line 94) |
| sliderUvIntensity | uvIntensity | HIGH | UV (line 144) |

Recommendation: keep.

### `85_redwood_starry_canopy.js` (5 sliders)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderStarBrightness | starBrightness | MED | only used as a gate threshold `random(1) < 0.02 * starBrightness` (line 89); strobe risk |
| sliderRingEnergy | ringEnergy | HIGH | rate (line 101) |
| sliderWallHit | wallHit | HIGH | amber wave (line 107) |
| sliderUvIntensity | uvIntensity | HIGH | UV (line 97); **default 1.0** |

Recommendation: lower `uvIntensity` default; convert star gate to a deterministic time-based kernel.

### `96_logsville_ember_storm.js` (9 sliders, 3 audio)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderEmberSpeed | emberSpeed | HIGH | rate (line 138) |
| sliderHeatIntensity | heatIntensity | HIGH | multiplied many places |
| sliderSparkleDensity | sparkleDensity | HIGH | sparkle scale (line 167) |
| sliderFlashRate | flashRate | HIGH | hz (line 124) |
| sliderUvIntensity | uvIntensity | HIGH | UV (line 199) |
| sliderAudioBass | audioBass | HIGH (when bound) | bassBoost (line 164) |
| sliderAudioKick | audioKick | HIGH (when bound) | kickPulse (line 130) |
| sliderAudioHigh | audioHigh | HIGH (when bound) | sparkle scale (line 167) |

Recommendation: keep.

### `100_logsville_root_to_canopy_pulse.js` (9 sliders, 3 audio)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderCycleSpeed | cycleSpeed | HIGH | rate (line 128) |
| sliderPulseIntensity | pulseIntensity | HIGH | multiple |
| sliderCanopyApexBoost | canopyApexBoost | HIGH | W (lines 209-211) |
| sliderBlackoutDepth | blackoutDepth | HIGH | floor (line 177) |
| sliderUvIntensity | uvIntensity | HIGH | UV (line 214) |
| sliderAudioBass | audioBass | HIGH (when bound) | bassBoost (line 167) |
| sliderAudioKick | audioKick | HIGH (when bound) | resets cycle (line 138) |
| sliderAudioMid | audioMid | HIGH (when bound) | midAccent (line 168) |

Recommendation: keep — exemplary audio-aware pattern.

### `110_logsville_giant_pixel_chase.js` (10 sliders, 3 audio)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderSectionFloor | sectionFloor | MED | floor breath (line 237); operator-invisible move at 0..0.1 |
| sliderNeighborWeight | neighborWeight | HIGH | halo (line 236) |
| sliderStepSmoothness | stepSmoothness | MED | sharpening (line 243) |
| sliderVintageMix | vintageMix | HIGH | vintage RGB (lines 274-278) |
| sliderSectionCount | sectionCountSlider | HIGH | count 3..5 (line 137) — should be a stepped selector, not a continuous slider |
| sliderChaseMode | chaseMode | HIGH | mode selector (line 142) — also stepped, should be a button bank |
| sliderAudioKick | audioKick | HIGH (when bound) | step advance (line 149-150) |
| sliderAudioBass | audioBass | HIGH (when bound) | bandWidth (line 224) |
| sliderAudioHigh | audioHigh | MED (when bound) | sparkle (line 258-260) |

Recommendation: `sectionCount` and `chaseMode` should be stepped selectors, not faders. `sectionFloor` could be a fixed config.

### `111_logsville_giant_pixel_heartbeat.js` (11 sliders, 3 audio)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderSectionFloor | sectionFloor | MED | line 212; subtle |
| sliderNeighborWeight | neighborWeight | HIGH | halo (line 230) |
| sliderPopBrightness | popBrightness | HIGH | peak (line 236) |
| sliderPopDecay | popDecay | HIGH | half-life (line 191) |
| sliderVintageMix | vintageMix | HIGH | vintage scale |
| sliderSectionCount | sectionCountSlider | HIGH | stepped selector — should be button |
| sliderHeartbeatPattern | heartbeatPattern | HIGH | stepped (line 162) — button |
| sliderAudioKick | audioKick | HIGH (when bound) | trigger |
| sliderAudioBass | audioBass | HIGH (when bound) | bassLift (line 211) |
| sliderAudioMid | audioMid | MED (when bound) | haloRadius +1 if >0.5 (line 215) — binary effect |

Recommendation: `sectionCount` and `heartbeatPattern` to buttons; `audioMid` is effectively binary.

### `112_logsville_giant_call_response.js` (11 sliders, 3 audio)
| Slider | Writes | Impact | Notes |
|---|---|---|---|
| sliderLocalSpeed | localSpeed | HIGH | |
| sliderSectionFloor | sectionFloor | MED | subtle |
| sliderNeighborWeight | neighborWeight | HIGH | opposite halo (line 241) |
| sliderTurnBrightness | turnBrightness | HIGH | peak (lines 224, 228, 236) |
| sliderTurnDecay | turnDecay | HIGH | half-life (line 182) |
| sliderVintageMix | vintageMix | HIGH | vintage scale |
| sliderSectionCount | sectionCountSlider | HIGH | stepped — button |
| sliderConversation | conversation | HIGH | stepped (line 132) — button |
| sliderAudioBass | audioBass | HIGH (when bound) | envA boost (line 210) |
| sliderAudioMid | audioMid | HIGH (when bound) | envB boost (line 211) |
| sliderAudioKick | audioKick | HIGH (when bound) | force turn flip (line 148-149) |

Recommendation: same as 111.

### `test_const.js` / `test_dualband.js` — test patterns, excluded from impact rating.

---

## Recurring themes

1. **`sliderUvIntensity` is everywhere on the redwood patterns (70–85), defaulted at or near 1.0.** Six of these patterns default UV to max, leaving the operator nowhere to push up. Worse, several patterns set `u = uvIntensity` outside group branches and bleed UV stage-wide (per report 4). Recommend a uniform default of `0.6` and engine-level UV gating on group masks.
2. **Per-frame `random(1) < N`-style sparkles are dead at 60 Hz.** Found in 70, 72, 73, 75, 80, 85. These read as "scintillating dead pixels", not sparkles. Every one is effectively a NO-OP from playa distance. Replace with deterministic time-jittered kernels or delete.
3. **`sliderBlackoutDepth` is the most common slider across the dome+logsville patterns (40-100s).** It almost always behaves identically: scales the global floor. Could be promoted to an engine-global (per a coordinator note in the 17_rolling_color_dunes review). 16 patterns expose it.
4. **`sliderLocalSpeed` is universal and exemplary** — every pattern has exactly one and operators understand it. Do not touch.
5. **Stepped selectors masquerading as continuous sliders.** `sectionCountSlider`, `chaseMode`, `heartbeatPattern`, `conversation` (110-112), `partyMode` (11), `spinDirection` (46). These are bucketed back into integers at use-time. Should be button banks or stepped knobs, not 0..1 faders — they look continuous but produce discrete jumps.
6. **`sliderAudio*` sliders (96, 100, 110, 111, 112) only meaningful when a CPC source is bound by the playlist.** When unbound, they're just dead 0.0 — operator wiggling them does nothing. Worth marking as "audio-only" in CaptainPad UI.
7. **Speed-trim sliders are redundant with `sliderLocalSpeed`.** Found in 07, 13. Two sliders that both scale time. Always cut the secondary.
8. **`overallBrightness` / `signalStrength` / `brightness` / `washBrightness` are global gain sliders that duplicate the engine-global brightness.** Found in 04, 48 (twice). Cut.
9. **Several patterns have a `blackoutDepth` AND `voidDepth` AND a `darkFloor` — overlapping floor semantics.** 23 (`darkFloor`), 63 (`blackoutDepth` + `voidDepth`), 65 (`voidDepth`). Standardize on one name.

---

## Sliders worth promoting

These are the "performance keepers" — every pattern that has them benefits from operator-driven motion. CaptainPad should surface them prominently:

1. **`sliderLocalSpeed`** — universal, well-trusted.
2. **`sliderBlackoutDepth`** — when present, drives the most legible "energy up/down" gesture. Consider engine-global.
3. **Pattern-specific motion-rate sliders**: `sliderShockSpeed` (65), `sliderVortexSpeed` (44, 74), `sliderOrbitSpeed` (55, 56), `sliderPingSpeed` (77), `sliderBeaconRate` (81), `sliderCycleSpeed` (100). All read clearly mid-show.
4. **Beam/feature-width sliders**: `sliderBeamWidth` (1, 3, 51), `sliderRingWidth` (55, 65), `sliderTideWidth` (16), `sliderShadowSize` (53), `sliderPingWidth` (47, 77). Operator-tunable focus.
5. **Impact/peak sliders**: `sliderImpact` (65), `sliderSweepImpact` (44, 74, 78), `sliderHeatFlash` (54), `sliderVentFlash` (49, 79). Clear "drop" gestures.
6. **Density/count sliders**: `sliderCount`/`sliderDensity` in 02, 09, 11, 14, 15, 18 — direct visual lever.

---

## Sliders worth retiring

A consolidated cut list, by confidence:

**Definitely NO-OP or invisible (60%+ confident — cut these):**
- `sliderSparkleSpeedTrim` (13_sparkle.js:26) — redundant speed
- `sliderShimmerSpeedTrim` (07_shimmer.js:18) — redundant speed
- `sliderCanopySparkle` (70_forest_canopy_reveal.js:32) — per-frame random strobe
- `sliderWoodSparkle` (72_outpost_campfire.js:32) — per-frame random strobe
- `sliderEdgeShimmer` (73_redwood_shadow_breath.js:36) — per-frame random strobe
- `sliderTickSharpness` (75_timber_mill_clockwork.js:64) — per-frame random strobe
- `sliderBrightness` (48_titanic_sos_beacon.js:68) — duplicates `sliderSignalStrength` + engine brightness
- `sliderWashBrightness` (48_titanic_sos_beacon.js:70) — minor floor scaling
- `sliderBlackoutTexture` (05_orbital_attractor_field.js:27) — visually broken noise mask
- `sliderCenterGuide` (56_stage_mirror_axis.js:47) — setup tool, default 0

**Likely LOW impact (50% confident — review, probably cut):**
- `sliderAxisDrift` (56_stage_mirror_axis.js:44) — tiny rate scaling
- `sliderRimSharpness` (83_shadow_canopy_eclipse.js:30) — sub-perceptual width tweak
- `sliderArmPhase` (44_apex_gyro_vortex.js:41) — minimal use in source
- `sliderEchoWidth` (48_titanic_sos_beacon.js:64) — duplicates `sliderEchoDelay`
- `sliderOverallBrightness` (04_beat_folded_helix.js:22) — engine global covers it
- `sliderCurrentRate` (22_abyssal_sway_garden.js:25) — subsumed by `localSpeed`
- `sliderWhiteGlint`/`sliderAmberGlint`/`sliderUvGlint` (13_sparkle.js:31-33) — channel scalars, fold into one
- `sliderSpinMotion` (40_ghost_ship_reveal.js:41) — overlaps `sliderOrbitDrift`
- `sliderBeaconSparkle` (40_ghost_ship_reveal.js:39) — small fixed coefficient

**Redundant pair consolidations:**
- `sliderBlackoutDepth` + `sliderVoidDepth` in 63 → merge
- `sliderBeaconWidth` + `sliderBeaconPunch` in 46, 81 → almost always co-moved
- `sliderSectionCount` and `sliderChaseMode`/`sliderHeartbeatPattern`/`sliderConversation` in 110/111/112 → these are stepped selectors, not sliders

---

## Methodology

I traced each `slider*` export to the var it writes, then grep'd the var across each pattern file to find every use site. For each use I assessed the visual delta at slider 0 vs slider 1 with all other sliders at default, holding myself to four rubric questions: (1) what multiplier range does this slider span? (2) is it gated by a hard `if` (binary) or smoothly interpolated? (3) is it nested inside an already-clamped or already-tiny term? (4) is it redundant with another slider that's also bound to a related quantity?

I did not run the engine — this is a pure static read. The assumption throughout is that the renderer math I read maps 1:1 to visible output on the rig at default fixture brightness. Patterns I could not exhaustively trace (`63_dome_phyllotaxis_bloom.js` and `40_ghost_ship_reveal.js` have particularly involved sectional logic) I biased toward "HIGH" when in doubt, since flagging a working slider as NO-OP is more harmful than missing one. For `sliderArmPhase` (44), `sliderRingEcho` and `sliderGhostMix` (47), and `sliderEchoWidth` (48), the source uses were too sparse to assess confidently from one read — flagged "verify" rather than NO-OP. I cross-referenced report 4 (`20260527_4_pattern_review_final_push.md`) where it touched on the same patterns (e.g. 19 and 22 are clones of 24 per report 4 §5.3/§5.4 — their slider names are inherited and rated against the body that's actually there).

I did NOT edit any pattern source. Report-only deliverable per the role contract.
