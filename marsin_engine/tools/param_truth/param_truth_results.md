# Parameter truth sweep

Model `titanic` (981 px) · 144 frames after 36 warmup · sweep points 0, 0.25, 0.5, 0.75, 1

Patterns swept 125 · compile errors 1 · no params 25 · params measured 817

| Class | Count |
|---|---:|
| WRONG | 39 |
| DEAD | 170 |
| WEAK | 25 |
| UNKNOWN_CLAIM | 35 |
| TRUE | 548 |

## Thresholds

```json
{
  "dead": 0.005,
  "weak": 0.02,
  "claim": 0.02,
  "emitter": 0.01,
  "levelRatio": 1.25,
  "relFloor": 0.0005,
  "speedRatio": 1.25,
  "driftFloor": 0.004,
  "reversalCorrelation": -0.3,
  "monotonicSlack": 0.05,
  "noiseMultiple": 3
}
```

## Patterns that do not compile on this model

| Pattern | Error |
|---|---|
| `examples/inview_demo` | Pattern references unknown view(s) via inView(): PORT. Known views for this model: Right Front Wall Generator, Right Top Chimney Generator, Right Front Deck Generator, Right Center Auditorium Generator, Left Back Wall Generator, Right Back Wall Generator, Left Front Wall Generator, Left Top Chimney Generator, Left Front Deck Generator, Left Center Auditorium Generator, Left_Front_Left, Left_Back_Left, Left_Back_Right, Left_Front_Right, Right_Back_Left, Right_Back_Right, Right_Front_Right, Right_Front_Left, Right Back Deck Generator, Left Back Deck Generator, Left Center Auditorium, Left Back Wall, TE Sign |

## DEAD on `titanic` but ALIVE on `test_bench`

These controls are wired correctly. The code path they drive is not reachable on `titanic` — usually a `sectionId` / `fixtureType` gate the show model does not satisfy. Fix the model coverage or the gate, not the slider.

| Pattern | Param | Verdict elsewhere | Effect elsewhere |
|---|---|---|---:|
| `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderAudioMid` | WEAK | 0.01506 |
| `summer_camp/81_outpost_distress_beacon` | `sliderBlackoutDepth` | WRONG | 0.04348 |
| `00_golden_hour_wash` | `sliderWhiteLevel` | WRONG | 0.04975 |
| `00_golden_hour_wash` | `sliderWhiteKick` | TRUE | 0.27429 |
| `00_golden_hour_wash` | `sliderWhiteWarmth` | WRONG | 0.04533 |
| `01_cylon_sweep` | `sliderWhiteLevel` | TRUE | 0.13164 |
| `01_cylon_sweep` | `sliderWhiteKick` | TRUE | 0.17391 |
| `01_cylon_sweep` | `sliderBlinderBite` | WEAK | 0.01732 |
| `05_orbital_attractor_field` | `sliderKick` | TRUE | 0.31126 |
| `05_orbital_attractor_field` | `sliderFalloff` | UNKNOWN_CLAIM | 0.03509 |
| `05_orbital_attractor_field` | `sliderWhiteLevel` | WEAK | 0.00681 |
| `06_neon_elevator` | `sliderKick` | TRUE | 0.08364 |
| `06_neon_elevator` | `sliderSteps` | UNKNOWN_CLAIM | 0.06815 |
| `06_neon_elevator` | `sliderWhiteLevel` | TRUE | 0.05556 |
| `06_neon_elevator` | `sliderWhiteKick` | TRUE | 0.06706 |
| `06_neon_elevator` | `sliderBlinderBite` | TRUE | 0.02393 |
| `09_cyclone` | `sliderBlinderBite` | TRUE | 0.06532 |
| `12_breathing` | `sliderBlinderBite` | TRUE | 0.3058 |
| `17_rolling_color_dunes` | `sliderLocalSpeed` | TRUE | 0.22286 |
| `17_rolling_color_dunes` | `sliderDirection` | TRUE | 0.28108 |
| `17_rolling_color_dunes` | `sliderKick` | TRUE | 0.25845 |
| `17_rolling_color_dunes` | `sliderRadius` | TRUE | 0.15269 |
| `17_rolling_color_dunes` | `sliderDetail` | TRUE | 0.189 |
| `17_rolling_color_dunes` | `sliderDuneScale` | TRUE | 0.11057 |
| `17_rolling_color_dunes` | `sliderStageSurf` | UNKNOWN_CLAIM | 0.08588 |
| `17_rolling_color_dunes` | `sliderAmberWarmth` | WRONG | 0.03815 |
| `17_rolling_color_dunes` | `sliderWhiteLevel` | TRUE | 0.08122 |
| `25_heartbeat` | `sliderBlinder` | TRUE | 0.17733 |
| `25_heartbeat` | `sliderBlinderBite` | TRUE | 0.05958 |
| `28_spectrum_bloom` | `sliderLow` | TRUE | 0.22734 |
| `28_spectrum_bloom` | `sliderMid` | WEAK | 0.01926 |
| `28_spectrum_bloom` | `sliderHigh` | TRUE | 0.03696 |
| `36_orbital_pulse` | `sliderPulse` | TRUE | 0.08417 |
| `43_golden_hour_pulse` | `sliderBlinder` | TRUE | 0.08934 |
| `summer_camp/41_ghost_aurora` | `sliderLocalSpeed` | TRUE | 0.17146 |
| `summer_camp/41_ghost_aurora` | `sliderCurtainWidth` | TRUE | 0.38292 |
| `summer_camp/41_ghost_aurora` | `sliderDriftChaos` | TRUE | 0.07264 |
| `summer_camp/41_ghost_aurora` | `sliderRimShimmer` | TRUE | 0.11232 |
| `summer_camp/41_ghost_aurora` | `sliderTriangleGain` | TRUE | 0.24095 |
| `summer_camp/41_ghost_aurora` | `sliderHumanWarmth` | TRUE | 0.12621 |
| `summer_camp/42_boiler_glow` | `sliderLocalSpeed` | TRUE | 0.17773 |
| `summer_camp/42_boiler_glow` | `sliderVentWidth` | TRUE | 0.18394 |
| `summer_camp/42_boiler_glow` | `sliderSteamFlash` | TRUE | 0.08637 |
| `summer_camp/42_boiler_glow` | `sliderTriangleRPM` | TRUE | 0.28385 |
| `summer_camp/42_boiler_glow` | `sliderFlashRate` | TRUE | 0.06906 |
| `summer_camp/43_sea_floor_shadow` | `sliderLocalSpeed` | TRUE | 0.20987 |
| `summer_camp/43_sea_floor_shadow` | `sliderShadowWidth` | WRONG | 0.04671 |
| `summer_camp/43_sea_floor_shadow` | `sliderShadowDrift` | WRONG | 0.05256 |
| `summer_camp/43_sea_floor_shadow` | `sliderEdgeFoam` | TRUE | 0.03178 |
| `summer_camp/43_sea_floor_shadow` | `sliderTriangleSilhouette` | UNKNOWN_CLAIM | 0.05833 |
| `summer_camp/45_engine_room_clockwork` | `sliderLocalSpeed` | TRUE | 1 |
| `summer_camp/45_engine_room_clockwork` | `sliderPistonStroke` | UNKNOWN_CLAIM | 0.00617 |
| `summer_camp/45_engine_room_clockwork` | `sliderDriveShaft` | TRUE | 1 |
| `summer_camp/45_engine_room_clockwork` | `sliderBoilerHeat` | WEAK | 0.00591 |
| `summer_camp/45_engine_room_clockwork` | `sliderPauseAmount` | TRUE | 1 |
| `summer_camp/46_dome_lockdown` | `sliderDirection` | TRUE | 0.50708 |
| `summer_camp/46_dome_lockdown` | `sliderBeaconWidth` | WRONG | 0.18563 |
| `summer_camp/46_dome_lockdown` | `sliderBeaconPunch` | TRUE | 0.22391 |
| `summer_camp/46_dome_lockdown` | `sliderStrobeRate` | TRUE | 0.27081 |
| `summer_camp/46_dome_lockdown` | `sliderAmberMix` | TRUE | 0.05862 |
| `summer_camp/47_apex_perimeter_ping` | `sliderLocalSpeed` | TRUE | 0.1793 |
| `summer_camp/47_apex_perimeter_ping` | `sliderPingWidth` | TRUE | 0.29573 |
| `summer_camp/47_apex_perimeter_ping` | `sliderGhostMix` | TRUE | 0.04831 |
| `summer_camp/47_apex_perimeter_ping` | `sliderRingEcho` | TRUE | 0.10688 |
| `summer_camp/48_titanic_sos_beacon` | `sliderLocalSpeed` | TRUE | 0.21937 |
| `summer_camp/48_titanic_sos_beacon` | `sliderSignalStrength` | TRUE | 0.02309 |
| `summer_camp/48_titanic_sos_beacon` | `sliderSignalSpeed` | TRUE | 0.08955 |
| `summer_camp/48_titanic_sos_beacon` | `sliderResponseGlow` | TRUE | 0.22714 |
| `summer_camp/48_titanic_sos_beacon` | `sliderEdgeSoftness` | TRUE | 0.09255 |
| `summer_camp/48_titanic_sos_beacon` | `sliderSearchlightSweep` | UNKNOWN_CLAIM | 0.02048 |
| `summer_camp/48_titanic_sos_beacon` | `sliderWashBrightness` | TRUE | 1.22002 |
| `summer_camp/49_boiler_pressure_release` | `sliderLocalSpeed` | TRUE | 0.15188 |
| `summer_camp/49_boiler_pressure_release` | `sliderPressure` | TRUE | 0.06248 |
| `summer_camp/49_boiler_pressure_release` | `sliderReleaseThreshold` | TRUE | 0.02717 |
| `summer_camp/49_boiler_pressure_release` | `sliderVentWidth` | WRONG | 0.03226 |
| `summer_camp/49_boiler_pressure_release` | `sliderHeatBloom` | TRUE | 0.22302 |
| `summer_camp/50_iceberg_fracture` | `sliderLocalSpeed` | TRUE | 0.09884 |
| `summer_camp/50_iceberg_fracture` | `sliderFractureDensity` | TRUE | 0.4878 |
| `summer_camp/50_iceberg_fracture` | `sliderBranchSpread` | TRUE | 0.16946 |
| `summer_camp/50_iceberg_fracture` | `sliderStrikeDecay` | TRUE | 0.02539 |
| `summer_camp/50_iceberg_fracture` | `sliderAftershockWarmth` | TRUE | 0.05635 |
| `summer_camp/50_iceberg_fracture` | `sliderLaneCount` | WEAK | 0.01683 |
| `summer_camp/50_iceberg_fracture` | `sliderShardJag` | UNKNOWN_CLAIM | 0.03263 |
| `summer_camp/51_abyssal_searchlight` | `sliderLocalSpeed` | TRUE | 0.16042 |
| `summer_camp/51_abyssal_searchlight` | `sliderBeamWidth` | TRUE | 0.39111 |
| `summer_camp/51_abyssal_searchlight` | `sliderBeamReach` | TRUE | 0.22734 |
| `summer_camp/51_abyssal_searchlight` | `sliderBeamPunch` | TRUE | 0.26452 |
| `summer_camp/51_abyssal_searchlight` | `sliderTrailLength` | TRUE | 0.14944 |
| `summer_camp/51_abyssal_searchlight` | `sliderSwirlMix` | WEAK | 0.0073 |
| `summer_camp/51_abyssal_searchlight` | `sliderVintageBleed` | TRUE | 0.04357 |
| `summer_camp/52_iceberg_shear_line` | `sliderLocalSpeed` | TRUE | 0.10839 |
| `summer_camp/52_iceberg_shear_line` | `sliderShearAngle` | UNKNOWN_CLAIM | 0.06001 |
| `summer_camp/52_iceberg_shear_line` | `sliderShearWidth` | TRUE | 0.45336 |
| `summer_camp/52_iceberg_shear_line` | `sliderAdvance` | UNKNOWN_CLAIM | 0.07426 |
| `summer_camp/52_iceberg_shear_line` | `sliderWarmthRetreat` | TRUE | 0.04408 |
| `summer_camp/52_iceberg_shear_line` | `sliderTriangleBlade` | UNKNOWN_CLAIM | 0.23091 |
| `summer_camp/53_shadow_eclipse` | `sliderLocalSpeed` | TRUE | 0.29766 |
| `summer_camp/53_shadow_eclipse` | `sliderShadowSize` | WRONG | 0.19914 |
| `summer_camp/53_shadow_eclipse` | `sliderRimWidth` | TRUE | 0.37191 |
| `summer_camp/53_shadow_eclipse` | `sliderOrbitEccentricity` | TRUE | 0.15241 |
| `summer_camp/53_shadow_eclipse` | `sliderCoronaPulse` | TRUE | 0.2635 |
| `summer_camp/53_shadow_eclipse` | `sliderVintageBloom` | TRUE | 0.67007 |
| `summer_camp/54_boiler_fire_overdrive` | `sliderLocalSpeed` | TRUE | 0.25194 |
| `summer_camp/54_boiler_fire_overdrive` | `sliderFlameHeight` | WRONG | 0.12978 |
| `summer_camp/54_boiler_fire_overdrive` | `sliderTongueCount` | TRUE | 0.13228 |
| `summer_camp/54_boiler_fire_overdrive` | `sliderSwirl` | UNKNOWN_CLAIM | 0.11472 |
| `summer_camp/54_boiler_fire_overdrive` | `sliderHeatFlash` | TRUE | 0.21439 |
| `summer_camp/54_boiler_fire_overdrive` | `sliderAmberBias` | TRUE | 0.13514 |
| `summer_camp/55_stardust_dome` | `sliderLocalSpeed` | TRUE | 0.23339 |
| `summer_camp/55_stardust_dome` | `sliderStarCore` | TRUE | 0.16999 |
| `summer_camp/55_stardust_dome` | `sliderParticleDensity` | TRUE | 0.26838 |
| `summer_camp/55_stardust_dome` | `sliderOrbitSpeed` | TRUE | 0.07605 |
| `summer_camp/55_stardust_dome` | `sliderRingWidth` | TRUE | 0.06698 |
| `summer_camp/55_stardust_dome` | `sliderWallHit` | TRUE | 0.06098 |
| `summer_camp/56_stage_mirror_axis` | `sliderLocalSpeed` | TRUE | 0.178 |
| `summer_camp/56_stage_mirror_axis` | `sliderCenter` | UNKNOWN_CLAIM | 0.58786 |
| `summer_camp/56_stage_mirror_axis` | `sliderMirrorWidth` | TRUE | 0.23904 |
| `summer_camp/56_stage_mirror_axis` | `sliderOrbitSpeed` | TRUE | 0.15647 |
| `summer_camp/56_stage_mirror_axis` | `sliderParticleDensity` | TRUE | 0.09092 |
| `summer_camp/56_stage_mirror_axis` | `sliderStageFocus` | TRUE | 0.28872 |
| `summer_camp/56_stage_mirror_axis` | `sliderAxisDrift` | UNKNOWN_CLAIM | 0.07943 |
| `summer_camp/56_stage_mirror_axis` | `sliderUvEdge` | TRUE | 0.05078 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderLocalSpeed` | TRUE | 0.07464 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderBloomGrowth` | UNKNOWN_CLAIM | 0.05012 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderArmCount` | WEAK | 0.01561 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderSeedSize` | WEAK | 0.0157 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderBreathDepth` | TRUE | 0.02446 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderCenterImpact` | TRUE | 0.02114 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderVintageWarm` | TRUE | 0.22896 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderVoidDepth` | WEAK | 0.01718 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderPetalSharpness` | TRUE | 0.12514 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderShockwavePower` | TRUE | 0.49874 |
| `summer_camp/65_dome_kick_shockwave` | `sliderRingWidth` | TRUE | 0.35197 |
| `summer_camp/65_dome_kick_shockwave` | `sliderEchoes` | UNKNOWN_CLAIM | 0.27502 |
| `summer_camp/82_redwood_timber_fall` | `sliderLocalSpeed` | TRUE | 0.46853 |
| `summer_camp/82_redwood_timber_fall` | `sliderFallDuration` | UNKNOWN_CLAIM | 0.06496 |
| `summer_camp/82_redwood_timber_fall` | `sliderStandBrightness` | TRUE | 0.46859 |

## Punch-list by pattern (WRONG + DEAD)

- `17_rolling_color_dunes` — 11: `sliderLocalSpeed` (DEAD), `sliderDirection` (DEAD), `sliderKick` (DEAD), `sliderRadius` (DEAD), `sliderDetail` (DEAD), `sliderDuneScale` (DEAD), `sliderStageSurf` (DEAD), `sliderAmberWarmth` (DEAD), `sliderWhiteLevel` (DEAD), `sliderWhiteKick` (DEAD), `sliderBlinderBite` (DEAD)
- `summer_camp/63_dome_phyllotaxis_bloom` — 10: `sliderLocalSpeed` (DEAD), `sliderBloomGrowth` (DEAD), `sliderArmCount` (DEAD), `sliderSeedSize` (DEAD), `sliderBreathDepth` (DEAD), `sliderCenterImpact` (DEAD), `sliderVintageWarm` (DEAD), `sliderVoidDepth` (DEAD), `sliderPetalSharpness` (DEAD), `sliderShockwavePower` (DEAD)
- `summer_camp/48_titanic_sos_beacon` — 9: `sliderLocalSpeed` (DEAD), `sliderSignalStrength` (DEAD), `sliderSignalSpeed` (DEAD), `sliderEchoDelay` (DEAD), `sliderEchoWidth` (DEAD), `sliderResponseGlow` (DEAD), `sliderEdgeSoftness` (DEAD), `sliderSearchlightSweep` (DEAD), `sliderWashBrightness` (DEAD)
- `summer_camp/56_stage_mirror_axis` — 9: `sliderLocalSpeed` (DEAD), `sliderCenter` (DEAD), `sliderMirrorWidth` (DEAD), `sliderOrbitSpeed` (DEAD), `sliderParticleDensity` (DEAD), `sliderStageFocus` (DEAD), `sliderAxisDrift` (DEAD), `sliderUvEdge` (DEAD), `sliderCenterGuide` (DEAD)
- `05_orbital_attractor_field` — 8: `sliderKick` (DEAD), `sliderFalloff` (DEAD), `sliderFocus` (DEAD), `sliderColorVariation` (WRONG), `sliderBlackoutTexture` (WRONG), `sliderWhiteLevel` (DEAD), `sliderWhiteKick` (DEAD), `sliderBlinderBite` (DEAD)
- `summer_camp/49_boiler_pressure_release` — 8: `sliderLocalSpeed` (DEAD), `sliderPressure` (DEAD), `sliderReleaseThreshold` (DEAD), `sliderVentWidth` (DEAD), `sliderHeatBloom` (DEAD), `sliderVentFlash` (DEAD), `sliderCoolingAfterglow` (DEAD), `sliderSteamRise` (DEAD)
- `summer_camp/45_engine_room_clockwork` — 7: `sliderLocalSpeed` (DEAD), `sliderGearSharpness` (DEAD), `sliderPistonStroke` (DEAD), `sliderDriveShaft` (DEAD), `sliderBarTickDensity` (DEAD), `sliderBoilerHeat` (DEAD), `sliderPauseAmount` (DEAD)
- `summer_camp/47_apex_perimeter_ping` — 7: `sliderLocalSpeed` (DEAD), `sliderPingWidth` (DEAD), `sliderGhostMix` (DEAD), `sliderCoronaImpact` (DEAD), `sliderTrailDecay` (DEAD), `sliderRingEcho` (DEAD), `sliderVintageMidpoint` (DEAD)
- `summer_camp/50_iceberg_fracture` — 7: `sliderLocalSpeed` (DEAD), `sliderFractureDensity` (DEAD), `sliderBranchSpread` (DEAD), `sliderStrikeDecay` (DEAD), `sliderAftershockWarmth` (DEAD), `sliderLaneCount` (DEAD), `sliderShardJag` (DEAD)
- `summer_camp/51_abyssal_searchlight` — 7: `sliderLocalSpeed` (DEAD), `sliderBeamWidth` (DEAD), `sliderBeamReach` (DEAD), `sliderBeamPunch` (DEAD), `sliderTrailLength` (DEAD), `sliderSwirlMix` (DEAD), `sliderVintageBleed` (DEAD)
- `summer_camp/41_ghost_aurora` — 6: `sliderLocalSpeed` (DEAD), `sliderCurtainWidth` (DEAD), `sliderDriftChaos` (DEAD), `sliderRimShimmer` (DEAD), `sliderTriangleGain` (DEAD), `sliderHumanWarmth` (DEAD)
- `summer_camp/42_boiler_glow` — 6: `sliderLocalSpeed` (DEAD), `sliderFlickerComplexity` (DEAD), `sliderVentWidth` (DEAD), `sliderSteamFlash` (DEAD), `sliderTriangleRPM` (DEAD), `sliderFlashRate` (DEAD)
- `summer_camp/46_dome_lockdown` — 6: `sliderDirection` (DEAD), `sliderBeaconWidth` (DEAD), `sliderBeaconPunch` (DEAD), `sliderStrobeRate` (DEAD), `sliderAlarmCadence` (DEAD), `sliderAmberMix` (DEAD)
- `summer_camp/52_iceberg_shear_line` — 6: `sliderLocalSpeed` (DEAD), `sliderShearAngle` (DEAD), `sliderShearWidth` (DEAD), `sliderAdvance` (DEAD), `sliderWarmthRetreat` (DEAD), `sliderTriangleBlade` (DEAD)
- `summer_camp/53_shadow_eclipse` — 6: `sliderLocalSpeed` (DEAD), `sliderShadowSize` (DEAD), `sliderRimWidth` (DEAD), `sliderOrbitEccentricity` (DEAD), `sliderCoronaPulse` (DEAD), `sliderVintageBloom` (DEAD)
- `summer_camp/54_boiler_fire_overdrive` — 6: `sliderLocalSpeed` (DEAD), `sliderFlameHeight` (DEAD), `sliderTongueCount` (DEAD), `sliderSwirl` (DEAD), `sliderHeatFlash` (DEAD), `sliderAmberBias` (DEAD)
- `summer_camp/55_stardust_dome` — 6: `sliderLocalSpeed` (DEAD), `sliderStarCore` (DEAD), `sliderParticleDensity` (DEAD), `sliderOrbitSpeed` (DEAD), `sliderRingWidth` (DEAD), `sliderWallHit` (DEAD)
- `06_neon_elevator` — 5: `sliderKick` (DEAD), `sliderSteps` (DEAD), `sliderWhiteLevel` (DEAD), `sliderWhiteKick` (DEAD), `sliderBlinderBite` (DEAD)
- `summer_camp/43_sea_floor_shadow` — 5: `sliderLocalSpeed` (DEAD), `sliderShadowWidth` (DEAD), `sliderShadowDrift` (DEAD), `sliderEdgeFoam` (DEAD), `sliderTriangleSilhouette` (DEAD)
- `01_cylon_sweep` — 4: `sliderDirection` (WRONG), `sliderWhiteLevel` (DEAD), `sliderWhiteKick` (DEAD), `sliderBlinderBite` (DEAD)
- `12_breathing` — 4: `sliderDirection` (WRONG), `sliderKick` (DEAD), `sliderDepth` (DEAD), `sliderBlinderBite` (DEAD)
- `summer_camp/81_outpost_distress_beacon` — 4: `sliderSignalStrength` (DEAD), `sliderBeamWidth` (WRONG), `sliderPathChaos` (DEAD), `sliderBlackoutDepth` (DEAD)
- `summer_camp/82_redwood_timber_fall` — 4: `sliderLocalSpeed` (DEAD), `sliderFallDuration` (DEAD), `sliderStandBrightness` (DEAD), `sliderImpactFlash` (DEAD)
- `00_golden_hour_wash` — 3: `sliderWhiteLevel` (DEAD), `sliderWhiteKick` (DEAD), `sliderWhiteWarmth` (DEAD)
- `13_sparkle` — 3: `sliderSparkleIntensity` (WRONG), `sliderAmberGlint` (DEAD), `sliderWhiteWarmth` (WRONG)
- `25_heartbeat` — 3: `sliderDetail` (WRONG), `sliderBlinder` (DEAD), `sliderBlinderBite` (DEAD)
- `28_spectrum_bloom` — 3: `sliderLow` (DEAD), `sliderMid` (DEAD), `sliderHigh` (DEAD)
- `04_beat_folded_helix` — 2: `sliderTwistFreq` (WRONG), `sliderWhiteWarmth` (WRONG)
- `09_cyclone` — 2: `sliderDirection` (WRONG), `sliderBlinderBite` (DEAD)
- `22_abyssal_sway_garden` — 2: `sliderTipGlow` (WRONG), `sliderBaseDarkness` (WRONG)
- `23_prismatic_strange_attractors` — 2: `sliderWhiteCore` (WRONG), `sliderColorSpread` (DEAD)
- `summer_camp/111_logsville_giant_pixel_heartbeat` — 2: `sliderPopBrightness` (WRONG), `sliderAudioMid` (DEAD)
- `summer_camp/112_logsville_giant_call_response` — 2: `sliderTurnBrightness` (WRONG), `sliderSectionCount` (WRONG)
- `summer_camp/113_tower_column_breath` — 2: `sliderLocalSpeed` (DEAD), `sliderVintageGlow` (WRONG)
- `summer_camp/40_ghost_ship_reveal` — 2: `sliderLanternGlow` (WRONG), `sliderPortBrightness` (WRONG)
- `summer_camp/65_dome_kick_shockwave` — 2: `sliderRingWidth` (DEAD), `sliderEchoes` (DEAD)
- `summer_camp/73_tree_shadow_breath` — 2: `sliderShadowDepth` (WRONG), `sliderBlackoutDepth` (WRONG)
- `03_dual_axis_crush` — 1: `sliderDirection` (WRONG)
- `07_shimmer` — 1: `sliderRadius` (WRONG)
- `08_ocean_liner` — 1: `sliderRadius` (WRONG)
- `11_bioluminescence` — 1: `sliderDetail` (DEAD)
- `24_chromatic_murmuration` — 1: `sliderKick` (DEAD)
- `29_kick_shockwave` — 1: `sliderRingWidth` (WRONG)
- `33_aurora_breath` — 1: `sliderBreathRate` (WRONG)
- `35_sparkle_rain` — 1: `sliderDensity` (WRONG)
- `36_orbital_pulse` — 1: `sliderPulse` (DEAD)
- `40_lissajous_weave` — 1: `sliderDetail` (WRONG)
- `43_golden_hour_pulse` — 1: `sliderBlinder` (DEAD)
- `44_biolume_swell` — 1: `sliderBase` (DEAD)
- `46_abyssal_fronds` — 1: `sliderBaseGlow` (WRONG)
- `53_neon_elevator_hd` — 1: `sliderKick` (DEAD)
- `61_white_breathe` — 1: `sliderDirection` (WRONG)
- `62_white_shimmer` — 1: `sliderDirection` (WRONG)
- `summer_camp/114_tower_ring_chase` — 1: `sliderLocalSpeed` (DEAD)
- `summer_camp/72_outpost_campfire` — 1: `sliderLocalSpeed` (WRONG)
- `summer_camp/74_lookout_gyro_vortex` — 1: `sliderOutpostGlow` (WRONG)
- `summer_camp/83_shadow_canopy_eclipse` — 1: `sliderShadowDepth` (WRONG)
- `summer_camp/84_outpost_ember_overdrive` — 1: `sliderSparkleDensity` (DEAD)
- `summer_camp/96_logsville_ember_storm` — 1: `sliderEmberSpeed` (WRONG)
- `test/test_params` — 1: `sliderFlashSpeed` (DEAD)
- `transitions/trans_iris_close` — 1: `sliderFeather` (WRONG)
- `transitions/trans_ripple_in` — 1: `sliderRings` (WRONG)
- `transitions/trans_wave_sweep` — 1: `sliderWaveFreq` (WRONG)

## Findings, worst first

| Verdict | Pattern | Param | Family | Effect | Reason | Evidence |
|---|---|---|---|---:|---|---|
| WRONG | `08_ocean_liner` | `sliderRadius` | SPATIAL | 0.3002 | spatial_statistics_unchanged | spatialFreqZ swing 0.0160, monotonic 0 — but the sweep DID move driftY by 0.3002 |
| WRONG | `07_shimmer` | `sliderRadius` | SPATIAL | 0.2995 | spatial_statistics_unchanged | spatialFreqZ swing 0.0190, monotonic 0 — but the sweep DID move driftY by 0.2995 |
| WRONG | `summer_camp/74_lookout_gyro_vortex` | `sliderOutpostGlow` | BRIGHTNESS | 0.2655 | luma_did_not_track_slider | lumaMean swing 0.0195 ratio 1.18 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.2655 |
| WRONG | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderPopBrightness` | BRIGHTNESS | 0.2186 | luma_did_not_track_slider | lumaMean swing 0.0036 ratio 1.18 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.2186 |
| WRONG | `62_white_shimmer` | `sliderDirection` | DIRECTION | 0.2184 | no_reversal_net_travel_or_velocity_series | launch driftZ -0.0583/-0.0582/-0.0580/-0.0579/-0.0577 (ends -0.0583 → -0.0577, floor ±0.004); velocity-series correlation low↔high 0.672 (reversal at ≤ -0.3) — but the sweep DID move contrastRatio by 0.2184 |
| WRONG | `29_kick_shockwave` | `sliderRingWidth` | SPATIAL | 0.1999 | spatial_statistics_unchanged | spatialFreqX swing 0.0142, monotonic 0 — but the sweep DID move driftZ by 0.1999 |
| WRONG | `13_sparkle` | `sliderSparkleIntensity` | BRIGHTNESS | 0.1802 | luma_did_not_track_slider | outputMean swing 0.0015 ratio 1.03 (via none), monotonic 1 — but the sweep DID move spatialFreqZ by 0.1803 |
| WRONG | `09_cyclone` | `sliderDirection` | DIRECTION | 0.1740 | no_reversal_net_travel_or_velocity_series | launch driftY -0.3184/-0.3184/-0.1899/-0.1899/-0.1899 (ends -0.3184 → -0.1899, floor ±0.004); velocity-series correlation low↔high 0.143 (reversal at ≤ -0.3) — but the sweep DID move driftY by 0.1740 |
| WRONG | `summer_camp/112_logsville_giant_call_response` | `sliderTurnBrightness` | BRIGHTNESS | 0.1677 | luma_did_not_track_slider | outputMean swing 0.0026 ratio 1.14 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.1677 |
| WRONG | `22_abyssal_sway_garden` | `sliderBaseDarkness` | DARKNESS | 0.1640 | darkness_inverted_adds_light | litFraction swing 0.1220 ratio 1.29 (via absolute), monotonic 1 (expected falling) — but the sweep DID move contrastRatio by 0.1640 |
| WRONG | `61_white_breathe` | `sliderDirection` | DIRECTION | 0.1594 | no_reversal_net_travel_or_velocity_series | launch driftY -0.0095/-0.0097/-0.0101/-0.0104/-0.0105 (ends -0.0095 → -0.0105, floor ±0.004); velocity-series correlation low↔high 0.710 (reversal at ≤ -0.3) — but the sweep DID move spatialFreqZ by 0.1594 |
| WRONG | `46_abyssal_fronds` | `sliderBaseGlow` | BRIGHTNESS | 0.1574 | luma_did_not_track_slider | lumaMean swing 0.0101 ratio 1.15 (via none), monotonic 1 — but the sweep DID move litFraction by 0.1574 |
| WRONG | `04_beat_folded_helix` | `sliderTwistFreq` | SPEED | 0.1328 | temporal_rate_did_not_track_slider | temporalRate 0.0029/0.0028/0.0028/0.0028/0.0029 (ratio 1.02, mono 0); temporalFreq ratio 1.04, mono 0 — but the sweep DID move spatialFreqX by 0.1329 |
| WRONG | `05_orbital_attractor_field` | `sliderColorVariation` | HUE | 0.1316 | hue_and_saturation_static | hue circular swing 0.0000 turns (normalised 0.0000), saturation swing 0.0000 — but the sweep DID move spatialFreqY by 0.1316 |
| WRONG | `12_breathing` | `sliderDirection` | DIRECTION | 0.1232 | no_reversal_net_travel_or_velocity_series | launch driftY -0.3953/-0.3980/-0.4043/-0.4076/-0.4060 (ends -0.3953 → -0.4060, floor ±0.004); velocity-series correlation low↔high 0.002 (reversal at ≤ -0.3) — but the sweep DID move driftY by 0.1232 |
| WRONG | `summer_camp/40_ghost_ship_reveal` | `sliderLanternGlow` | BRIGHTNESS | 0.1231 | luma_did_not_track_slider | outputMean swing 0.0008 ratio 1.06 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.1231 |
| WRONG | `03_dual_axis_crush` | `sliderDirection` | DIRECTION | 0.1180 | no_reversal_net_travel_or_velocity_series | launch driftX 0.0464/0.0464/0.1423/0.1423/0.1423 (ends 0.0464 → 0.1423, floor ±0.004); velocity-series correlation low↔high 0.240 (reversal at ≤ -0.3) — but the sweep DID move driftY by 0.1180 |
| WRONG | `summer_camp/72_outpost_campfire` | `sliderLocalSpeed` | SPEED | 0.1017 | temporal_rate_did_not_track_slider | temporalRate 0.0104/0.0105/0.0105/0.0110/0.0116 (ratio 1.12, mono 1); temporalFreq ratio 1.12, mono 0 — but the sweep DID move contrastRatio by 0.1017 |
| WRONG | `33_aurora_breath` | `sliderBreathRate` | SPEED | 0.0975 | temporal_rate_did_not_track_slider | temporalRate 0.0005/0.0004/0.0003/0.0004/0.0004 (ratio 1.31, mono 0); temporalFreq ratio 1.19, mono 0 — but the sweep DID move spatialFreqZ by 0.0975 |
| WRONG | `transitions/trans_iris_close` | `sliderFeather` | SPATIAL | 0.0914 | spatial_statistics_unchanged | edgeSharpnessY swing 0.0197, monotonic -1 — but the sweep DID move satMean by 0.0914 |
| WRONG | `05_orbital_attractor_field` | `sliderBlackoutTexture` | DARKNESS | 0.0830 | output_did_not_fall_with_slider | lumaMean swing 0.0089 ratio 1.09 (via none), monotonic -1 (expected falling) — but the sweep DID move spatialFreqY by 0.0830 |
| WRONG | `01_cylon_sweep` | `sliderDirection` | DIRECTION | 0.0798 | no_reversal_net_travel_or_velocity_series | launch driftX 0.0711/0.0547/0.0193/0.0542/0.0721 (ends 0.0711 → 0.0721, floor ±0.004); velocity-series correlation low↔high 0.201 (reversal at ≤ -0.3) — but the sweep DID move contrastRatio by 0.0798 |
| WRONG | `22_abyssal_sway_garden` | `sliderTipGlow` | BRIGHTNESS | 0.0638 | luma_did_not_track_slider | lumaMean swing 0.0017 ratio 1.05 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.0638 |
| WRONG | `summer_camp/112_logsville_giant_call_response` | `sliderSectionCount` | SPATIAL | 0.0600 | spatial_statistics_unchanged | edgeSharpnessZ swing 0.0089, monotonic 1 — but the sweep DID move contrastRatio by 0.0600 |
| WRONG | `summer_camp/96_logsville_ember_storm` | `sliderEmberSpeed` | SPEED | 0.0574 | temporal_rate_did_not_track_slider | temporalRate 0.0030/0.0031/0.0032/0.0033/0.0034 (ratio 1.14, mono 1); temporalFreq ratio 1.04, mono 1 — but the sweep DID move spatialFreqY by 0.0574 |
| WRONG | `summer_camp/113_tower_column_breath` | `sliderVintageGlow` | BRIGHTNESS | 0.0549 | luma_did_not_track_slider | outputMean swing 0.0019 ratio 1.20 (via none), monotonic 1 — but the sweep DID move spatialFreqY by 0.0550 |
| WRONG | `04_beat_folded_helix` | `sliderWhiteWarmth` | WHITE | 0.0546 | white_amber_emitters_unchanged | wMean swing 0.0000 ratio 1.00 (via none, threshold 0.01) — but the sweep DID move spatialFreqY by 0.0546 |
| WRONG | `35_sparkle_rain` | `sliderDensity` | SPATIAL | 0.0513 | spatial_statistics_unchanged | spatialFreqZ swing 0.0154, monotonic 1 — but the sweep DID move temporalFreq by 0.0513 |
| WRONG | `transitions/trans_ripple_in` | `sliderRings` | SPATIAL | 0.0487 | spatial_statistics_unchanged | spatialFreqY swing 0.0148, monotonic 0 — but the sweep DID move driftY by 0.0487 |
| WRONG | `summer_camp/83_shadow_canopy_eclipse` | `sliderShadowDepth` | DARKNESS | 0.0462 | output_did_not_fall_with_slider | lumaMean swing 0.0059 ratio 1.14 (via none), monotonic 1 (expected falling) — but the sweep DID move spatialFreqY by 0.0462 |
| WRONG | `summer_camp/73_tree_shadow_breath` | `sliderBlackoutDepth` | DARKNESS | 0.0441 | output_did_not_fall_with_slider | lumaMean swing 0.0094 ratio 1.21 (via none), monotonic -1 (expected falling) — but the sweep DID move rMean by 0.0441 |
| WRONG | `summer_camp/40_ghost_ship_reveal` | `sliderPortBrightness` | BRIGHTNESS | 0.0426 | luma_did_not_track_slider | outputMean swing 0.0003 ratio 1.02 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.0426 |
| WRONG | `23_prismatic_strange_attractors` | `sliderWhiteCore` | WHITE | 0.0359 | white_amber_emitters_unchanged | wMean swing 0.0005 ratio 457.99 (via none, threshold 0.01) — but the sweep DID move driftY by 0.0359 |
| WRONG | `25_heartbeat` | `sliderDetail` | SPATIAL | 0.0340 | spatial_statistics_unchanged | litFraction swing 0.0191, monotonic -1 — but the sweep DID move driftY by 0.0340 |
| WRONG | `transitions/trans_wave_sweep` | `sliderWaveFreq` | SPEED | 0.0301 | temporal_rate_did_not_track_slider | temporalRate 0.0025/0.0025/0.0025/0.0025/0.0025 (ratio 1.00, mono 0); temporalFreq ratio 1.00, mono 1 — but the sweep DID move driftY by 0.0301 |
| WRONG | `40_lissajous_weave` | `sliderDetail` | SPATIAL | 0.0295 | spatial_statistics_unchanged | spatialFreqZ swing 0.0079, monotonic 0 — but the sweep DID move contrastRatio by 0.0295 |
| WRONG | `summer_camp/81_outpost_distress_beacon` | `sliderBeamWidth` | SPATIAL | 0.0243 | spatial_statistics_unchanged | spatialFreqY swing 0.0021, monotonic 0 — but the sweep DID move contrastRatio by 0.0243 |
| WRONG | `13_sparkle` | `sliderWhiteWarmth` | WHITE | 0.0226 | white_amber_emitters_unchanged | wMean swing 0.0000 ratio 1.00 (via none, threshold 0.01) — but the sweep DID move spatialFreqZ by 0.0226 |
| WRONG | `summer_camp/73_tree_shadow_breath` | `sliderShadowDepth` | DARKNESS | 0.0213 | output_did_not_fall_with_slider | outputMean swing 0.0036 ratio 1.09 (via none), monotonic 1 (expected falling) — but the sweep DID move uvMean by 0.0213 |
| DEAD | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderAudioMid` | MAGNITUDE | 0.0045 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.01506, top mover litFraction). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `24_chromatic_murmuration` | `sliderKick` | MAGNITUDE | 0.0035 | dead_at_declared_defaults_alive_at_midrange | inert across its whole range at this pattern's declared defaults, but with every other slider at 0.5 it moves spatialFreqY by 0.0208. The control is wired — a shipped default (usually a gain at full scale) is swallowing it. |
| DEAD | `summer_camp/84_outpost_ember_overdrive` | `sliderSparkleDensity` | SPATIAL | 0.0024 | below_dead_threshold | largest normalised change 0.00245 < 0.005 on every measured feature |
| DEAD | `53_neon_elevator_hd` | `sliderKick` | MAGNITUDE | 0.0013 | below_dead_threshold | largest normalised change 0.00129 < 0.005 on every measured feature |
| DEAD | `summer_camp/81_outpost_distress_beacon` | `sliderPathChaos` | MAGNITUDE | 0.0010 | below_dead_threshold | largest normalised change 0.00105 < 0.005 on every measured feature |
| DEAD | `summer_camp/81_outpost_distress_beacon` | `sliderBlackoutDepth` | DARKNESS | 0.0006 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.04348, top mover spatialFreqZ). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/81_outpost_distress_beacon` | `sliderSignalStrength` | MAGNITUDE | 0.0002 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `00_golden_hour_wash` | `sliderWhiteLevel` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.04975, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `00_golden_hour_wash` | `sliderWhiteKick` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.27429, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `00_golden_hour_wash` | `sliderWhiteWarmth` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.04533, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `01_cylon_sweep` | `sliderWhiteLevel` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.13164, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `01_cylon_sweep` | `sliderWhiteKick` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.17391, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `01_cylon_sweep` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.01732, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `05_orbital_attractor_field` | `sliderKick` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.31126, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `05_orbital_attractor_field` | `sliderFalloff` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.03509, top mover edgeSharpnessZ). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `05_orbital_attractor_field` | `sliderFocus` | SPATIAL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `05_orbital_attractor_field` | `sliderWhiteLevel` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.00681, top mover edgeSharpnessZ). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `05_orbital_attractor_field` | `sliderWhiteKick` | WHITE | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `05_orbital_attractor_field` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `06_neon_elevator` | `sliderKick` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.08364, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `06_neon_elevator` | `sliderSteps` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.06815, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `06_neon_elevator` | `sliderWhiteLevel` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.05556, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `06_neon_elevator` | `sliderWhiteKick` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06706, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `06_neon_elevator` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.02393, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `09_cyclone` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06532, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `11_bioluminescence` | `sliderDetail` | SPATIAL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `12_breathing` | `sliderKick` | MAGNITUDE | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `12_breathing` | `sliderDepth` | MAGNITUDE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `12_breathing` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.3058, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `13_sparkle` | `sliderAmberGlint` | WHITE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `17_rolling_color_dunes` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.22286, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderDirection` | DIRECTION | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.28108, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderKick` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.25845, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderRadius` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.15269, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderDetail` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.189, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderDuneScale` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.11057, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderStageSurf` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.08588, top mover edgeSharpnessZ). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderAmberWarmth` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.03815, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderWhiteLevel` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.08122, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderWhiteKick` | WHITE | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `17_rolling_color_dunes` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `23_prismatic_strange_attractors` | `sliderColorSpread` | HUE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `25_heartbeat` | `sliderBlinder` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.17733, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `25_heartbeat` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.05958, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `28_spectrum_bloom` | `sliderLow` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.22734, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `28_spectrum_bloom` | `sliderMid` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.01926, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `28_spectrum_bloom` | `sliderHigh` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.03696, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `36_orbital_pulse` | `sliderPulse` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.08417, top mover lumaMean). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `43_golden_hour_pulse` | `sliderBlinder` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.08934, top mover lumaMean). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `44_biolume_swell` | `sliderBase` | MAGNITUDE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/113_tower_column_breath` | `sliderLocalSpeed` | SPEED | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/114_tower_ring_chase` | `sliderLocalSpeed` | SPEED | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/41_ghost_aurora` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.17146, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/41_ghost_aurora` | `sliderCurtainWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.38292, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/41_ghost_aurora` | `sliderDriftChaos` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.07264, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/41_ghost_aurora` | `sliderRimShimmer` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.11232, top mover spatialFreqZ). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/41_ghost_aurora` | `sliderTriangleGain` | BRIGHTNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.24095, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/41_ghost_aurora` | `sliderHumanWarmth` | WARMTH | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.12621, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/42_boiler_glow` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.17773, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/42_boiler_glow` | `sliderFlickerComplexity` | UNKNOWN_CLAIM | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/42_boiler_glow` | `sliderVentWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.18394, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/42_boiler_glow` | `sliderSteamFlash` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.08637, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/42_boiler_glow` | `sliderTriangleRPM` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.28385, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/42_boiler_glow` | `sliderFlashRate` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06906, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/43_sea_floor_shadow` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.20987, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/43_sea_floor_shadow` | `sliderShadowWidth` | DARKNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.04671, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/43_sea_floor_shadow` | `sliderShadowDrift` | DARKNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.05256, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/43_sea_floor_shadow` | `sliderEdgeFoam` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.03178, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/43_sea_floor_shadow` | `sliderTriangleSilhouette` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.05833, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 1, top mover satMean). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderGearSharpness` | SPATIAL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderPistonStroke` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.00617, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderDriveShaft` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 1, top mover satMean). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderBarTickDensity` | SPATIAL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderBoilerHeat` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.00591, top mover driftY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderPauseAmount` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 1, top mover satMean). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/46_dome_lockdown` | `sliderDirection` | DIRECTION | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.50708, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/46_dome_lockdown` | `sliderBeaconWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.18563, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/46_dome_lockdown` | `sliderBeaconPunch` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.22391, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/46_dome_lockdown` | `sliderStrobeRate` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.27081, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/46_dome_lockdown` | `sliderAlarmCadence` | SPEED | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/46_dome_lockdown` | `sliderAmberMix` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.05862, top mover aMean). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/47_apex_perimeter_ping` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.1793, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/47_apex_perimeter_ping` | `sliderPingWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.29573, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/47_apex_perimeter_ping` | `sliderGhostMix` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.04831, top mover spatialFreqY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/47_apex_perimeter_ping` | `sliderCoronaImpact` | MAGNITUDE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/47_apex_perimeter_ping` | `sliderTrailDecay` | TRAIL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/47_apex_perimeter_ping` | `sliderRingEcho` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.10688, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/47_apex_perimeter_ping` | `sliderVintageMidpoint` | MAGNITUDE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/48_titanic_sos_beacon` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.21937, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/48_titanic_sos_beacon` | `sliderSignalStrength` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.02309, top mover litFraction). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/48_titanic_sos_beacon` | `sliderSignalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.08955, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/48_titanic_sos_beacon` | `sliderEchoDelay` | UNKNOWN_CLAIM | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/48_titanic_sos_beacon` | `sliderEchoWidth` | SPATIAL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/48_titanic_sos_beacon` | `sliderResponseGlow` | BRIGHTNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.22714, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/48_titanic_sos_beacon` | `sliderEdgeSoftness` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.09255, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/48_titanic_sos_beacon` | `sliderSearchlightSweep` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.02048, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/48_titanic_sos_beacon` | `sliderWashBrightness` | BRIGHTNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 1.22002, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/49_boiler_pressure_release` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.15188, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/49_boiler_pressure_release` | `sliderPressure` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06248, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/49_boiler_pressure_release` | `sliderReleaseThreshold` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.02717, top mover spatialFreqY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/49_boiler_pressure_release` | `sliderVentWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.03226, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/49_boiler_pressure_release` | `sliderHeatBloom` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.22302, top mover litFraction). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/49_boiler_pressure_release` | `sliderVentFlash` | MAGNITUDE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/49_boiler_pressure_release` | `sliderCoolingAfterglow` | TRAIL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/49_boiler_pressure_release` | `sliderSteamRise` | UNKNOWN_CLAIM | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/50_iceberg_fracture` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.09884, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/50_iceberg_fracture` | `sliderFractureDensity` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.4878, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/50_iceberg_fracture` | `sliderBranchSpread` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.16946, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/50_iceberg_fracture` | `sliderStrikeDecay` | TRAIL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.02539, top mover litFraction). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/50_iceberg_fracture` | `sliderAftershockWarmth` | WARMTH | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.05635, top mover litFraction). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/50_iceberg_fracture` | `sliderLaneCount` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.01683, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/50_iceberg_fracture` | `sliderShardJag` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.03263, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/51_abyssal_searchlight` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.16042, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/51_abyssal_searchlight` | `sliderBeamWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.39111, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/51_abyssal_searchlight` | `sliderBeamReach` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.22734, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/51_abyssal_searchlight` | `sliderBeamPunch` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.26452, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/51_abyssal_searchlight` | `sliderTrailLength` | TRAIL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.14944, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/51_abyssal_searchlight` | `sliderSwirlMix` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.0073, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/51_abyssal_searchlight` | `sliderVintageBleed` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.04357, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/52_iceberg_shear_line` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.10839, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/52_iceberg_shear_line` | `sliderShearAngle` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.06001, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/52_iceberg_shear_line` | `sliderShearWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.45336, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/52_iceberg_shear_line` | `sliderAdvance` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.07426, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/52_iceberg_shear_line` | `sliderWarmthRetreat` | WARMTH | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.04408, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/52_iceberg_shear_line` | `sliderTriangleBlade` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.23091, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/53_shadow_eclipse` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.29766, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/53_shadow_eclipse` | `sliderShadowSize` | DARKNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.19914, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/53_shadow_eclipse` | `sliderRimWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.37191, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/53_shadow_eclipse` | `sliderOrbitEccentricity` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.15241, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/53_shadow_eclipse` | `sliderCoronaPulse` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.2635, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/53_shadow_eclipse` | `sliderVintageBloom` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.67007, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/54_boiler_fire_overdrive` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.25194, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/54_boiler_fire_overdrive` | `sliderFlameHeight` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.12978, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/54_boiler_fire_overdrive` | `sliderTongueCount` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.13228, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/54_boiler_fire_overdrive` | `sliderSwirl` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.11472, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/54_boiler_fire_overdrive` | `sliderHeatFlash` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.21439, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/54_boiler_fire_overdrive` | `sliderAmberBias` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.13514, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/55_stardust_dome` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.23339, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/55_stardust_dome` | `sliderStarCore` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.16999, top mover spatialFreqY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/55_stardust_dome` | `sliderParticleDensity` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.26838, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/55_stardust_dome` | `sliderOrbitSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.07605, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/55_stardust_dome` | `sliderRingWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06698, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/55_stardust_dome` | `sliderWallHit` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06098, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.178, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderCenter` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.58786, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderMirrorWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.23904, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderOrbitSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.15647, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderParticleDensity` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.09092, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderStageFocus` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.28872, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderAxisDrift` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.07943, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderUvEdge` | UV | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.05078, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderCenterGuide` | UNKNOWN_CLAIM | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.07464, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderBloomGrowth` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.05012, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderArmCount` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.01561, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderSeedSize` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.0157, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderBreathDepth` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.02446, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderCenterImpact` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.02114, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderVintageWarm` | WARMTH | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.22896, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderVoidDepth` | DARKNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.01718, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderPetalSharpness` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.12514, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderShockwavePower` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.49874, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/65_dome_kick_shockwave` | `sliderRingWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.35197, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/65_dome_kick_shockwave` | `sliderEchoes` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.27502, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/82_redwood_timber_fall` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.46853, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/82_redwood_timber_fall` | `sliderFallDuration` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.06496, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/82_redwood_timber_fall` | `sliderStandBrightness` | BRIGHTNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.46859, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/82_redwood_timber_fall` | `sliderImpactFlash` | MAGNITUDE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `test/test_params` | `sliderFlashSpeed` | SPEED | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| WEAK | `25_heartbeat` | `sliderWhiteKick` | WHITE | 0.0189 | claim_met_but_sub_visible | wMean swing 0.0105 ratio 2.25 (via absolute, threshold 0.01) |
| WEAK | `08_ocean_liner` | `sliderWhiteLevel` | WHITE | 0.0187 | claim_met_but_sub_visible | wMean swing 0.0187 ratio 2.59 (via absolute, threshold 0.01) |
| WEAK | `11_bioluminescence` | `sliderWhiteWarmth` | WHITE | 0.0182 | white_amber_emitters_unchanged | wMean swing 0.0000 ratio 1.00 (via none, threshold 0.01) |
| WEAK | `summer_camp/113_tower_column_breath` | `sliderAudioMid` | MAGNITUDE | 0.0181 | effect_below_visible_threshold | dominant mover spatialFreqY 0.0181 |
| WEAK | `summer_camp/96_logsville_ember_storm` | `sliderFlashRate` | SPEED | 0.0178 | temporal_rate_did_not_track_slider | temporalRate 0.0032/0.0033/0.0033/0.0033/0.0034 (ratio 1.08, mono 1); temporalFreq ratio 1.04, mono 1 |
| WEAK | `33_aurora_breath` | `sliderBreathDepth` | MAGNITUDE | 0.0151 | effect_below_visible_threshold | dominant mover spatialFreqZ 0.0151 |
| WEAK | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderNeighborWeight` | MAGNITUDE | 0.0145 | effect_below_visible_threshold | dominant mover spatialFreqY 0.0145 |
| WEAK | `summer_camp/40_ghost_ship_reveal` | `sliderHullDarkness` | DARKNESS | 0.0141 | output_did_not_fall_with_slider | litFraction swing 0.0018 ratio 1.01 (via none), monotonic -1 (expected falling) |
| WEAK | `07_shimmer` | `sliderWhiteKick` | WHITE | 0.0126 | claim_met_but_sub_visible | wMean swing 0.0085 ratio 1.59 (via ratio, threshold 0.01) |
| WEAK | `summer_camp/75_timber_mill_clockwork` | `sliderSparkImpact` | MAGNITUDE | 0.0124 | effect_below_visible_threshold | dominant mover spatialFreqY 0.0124 |
| WEAK | `44_biolume_swell` | `sliderSparkle` | MAGNITUDE | 0.0123 | effect_below_visible_threshold | dominant mover temporalRate 0.0124 |
| WEAK | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderUvIntensity` | UV | 0.0123 | claim_met_but_sub_visible | uvMean swing 0.0123 ratio 12256.32 (via absolute, threshold 0.01) |
| WEAK | `05_orbital_attractor_field` | `sliderRadius` | SPATIAL | 0.0115 | spatial_statistics_unchanged | spatialFreqY swing 0.0109, monotonic -1 |
| WEAK | `summer_camp/96_logsville_ember_storm` | `sliderSparkleDensity` | SPATIAL | 0.0110 | spatial_statistics_unchanged | spatialFreqY swing 0.0012, monotonic 0 |
| WEAK | `25_heartbeat` | `sliderWhiteLevel` | WHITE | 0.0103 | claim_met_but_sub_visible | wMean swing 0.0057 ratio 2.03 (via ratio, threshold 0.01) |
| WEAK | `summer_camp/114_tower_ring_chase` | `sliderAudioHigh` | MAGNITUDE | 0.0097 | effect_below_visible_threshold | dominant mover driftY 0.0097 |
| WEAK | `summer_camp/113_tower_column_breath` | `sliderSteamboatWhite` | WHITE | 0.0091 | claim_met_but_sub_visible | wMean swing 0.0091 ratio 9064.44 (via ratio, threshold 0.01) |
| WEAK | `07_shimmer` | `sliderWhiteWarmth` | WHITE | 0.0090 | white_amber_emitters_unchanged | wMean swing 0.0000 ratio 1.00 (via none, threshold 0.01) |
| WEAK | `summer_camp/46_dome_lockdown` | `sliderHoldBlackout` | DARKNESS | 0.0074 | claim_met_but_sub_visible | lumaMean swing 0.0016 ratio 2.84 (via ratio), monotonic -1 (expected falling) |
| WEAK | `summer_camp/96_logsville_ember_storm` | `sliderAudioHigh` | MAGNITUDE | 0.0070 | effect_below_visible_threshold | dominant mover temporalFreq 0.0070 |
| WEAK | `35_sparkle_rain` | `sliderIntensity` | BRIGHTNESS | 0.0066 | luma_did_not_track_slider | outputMean swing 0.0002 ratio 1.01 (via none), monotonic 1 |
| WEAK | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderCanopyApexBoost` | MAGNITUDE | 0.0061 | effect_below_visible_threshold | dominant mover edgeSharpnessZ 0.0061 |
| WEAK | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderAudioKick` | MAGNITUDE | 0.0053 | effect_below_visible_threshold | dominant mover litFraction 0.0053 |
| WEAK | `33_aurora_breath` | `sliderShimmer` | MAGNITUDE | 0.0053 | effect_below_visible_threshold | dominant mover temporalFreq 0.0053 |
| WEAK | `summer_camp/46_dome_lockdown` | `sliderLocalSpeed` | SPEED | 0.0051 | temporal_rate_did_not_track_slider | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0000 (ratio 18.28, mono 0); temporalFreq ratio 0.00, mono 0 |
| UNKNOWN_CLAIM | `42_phyllotaxis_spiral` | `sliderBloom` | UNKNOWN_CLAIM | 1.1179 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 1.1179 |
| UNKNOWN_CLAIM | `64_temple_warm_white` | `sliderCeiling` | UNKNOWN_CLAIM | 1.0000 | name_makes_no_falsifiable_claim | dominant mover litFraction 1.0000 |
| UNKNOWN_CLAIM | `65_uv_only` | `sliderRgbViolet` | UNKNOWN_CLAIM | 1.0000 | name_makes_no_falsifiable_claim | dominant mover satMean 1.0000 |
| UNKNOWN_CLAIM | `39_tide_riser` | `sliderRise` | UNKNOWN_CLAIM | 0.9092 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.9092 |
| UNKNOWN_CLAIM | `60_white_wash` | `sliderEvenness` | UNKNOWN_CLAIM | 0.7588 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.7588 |
| UNKNOWN_CLAIM | `54_murmuration_storm` | `sliderHaze` | UNKNOWN_CLAIM | 0.4759 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.4759 |
| UNKNOWN_CLAIM | `47_quasicrystal_dunes` | `sliderSurf` | UNKNOWN_CLAIM | 0.4449 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.4449 |
| UNKNOWN_CLAIM | `57_ink_diffuse` | `sliderFlow` | UNKNOWN_CLAIM | 0.4001 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.4001 |
| UNKNOWN_CLAIM | `57_ink_diffuse` | `sliderInk` | UNKNOWN_CLAIM | 0.3950 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3950 |
| UNKNOWN_CLAIM | `57_ink_diffuse` | `sliderDiffuse` | UNKNOWN_CLAIM | 0.3921 | name_makes_no_falsifiable_claim | dominant mover driftZ 0.3921 |
| UNKNOWN_CLAIM | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderHeartbeatPattern` | UNKNOWN_CLAIM | 0.3422 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3421 |
| UNKNOWN_CLAIM | `41_reaction_diffusion` | `sliderFeed` | UNKNOWN_CLAIM | 0.3331 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3331 |
| UNKNOWN_CLAIM | `summer_camp/73_tree_shadow_breath` | `sliderCanopyMotion` | UNKNOWN_CLAIM | 0.3287 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3287 |
| UNKNOWN_CLAIM | `26_dom_dancers_chevron` | `sliderBall1X` | UNKNOWN_CLAIM | 0.3284 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.3284 |
| UNKNOWN_CLAIM | `summer_camp/80_tree_canopy_fracture` | `sliderAftershock` | UNKNOWN_CLAIM | 0.3084 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3084 |
| UNKNOWN_CLAIM | `39_tide_riser` | `sliderSpray` | UNKNOWN_CLAIM | 0.2995 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.2995 |
| UNKNOWN_CLAIM | `26_dom_dancers_chevron` | `sliderChevronSpeedup` | UNKNOWN_CLAIM | 0.2340 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.2340 |
| UNKNOWN_CLAIM | `41_reaction_diffusion` | `sliderSeed` | UNKNOWN_CLAIM | 0.2269 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.2269 |
| UNKNOWN_CLAIM | `26_dom_dancers_chevron` | `sliderBall2X` | UNKNOWN_CLAIM | 0.2231 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.2231 |
| UNKNOWN_CLAIM | `27_swipe` | `sliderBlur` | UNKNOWN_CLAIM | 0.2144 | name_makes_no_falsifiable_claim | dominant mover driftZ 0.2143 |
| UNKNOWN_CLAIM | `summer_camp/85_redwood_starry_canopy` | `sliderTowerSpin` | UNKNOWN_CLAIM | 0.2107 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.2107 |
| UNKNOWN_CLAIM | `summer_camp/112_logsville_giant_call_response` | `sliderConversation` | UNKNOWN_CLAIM | 0.1907 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.1907 |
| UNKNOWN_CLAIM | `38_prism_helix` | `sliderTwist` | UNKNOWN_CLAIM | 0.1582 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1582 |
| UNKNOWN_CLAIM | `summer_camp/40_ghost_ship_reveal` | `sliderSpinMotion` | UNKNOWN_CLAIM | 0.1463 | name_makes_no_falsifiable_claim | dominant mover driftZ 0.1463 |
| UNKNOWN_CLAIM | `33_aurora_breath` | `sliderSoft` | UNKNOWN_CLAIM | 0.1425 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1425 |
| UNKNOWN_CLAIM | `35_sparkle_rain` | `sliderFall` | UNKNOWN_CLAIM | 0.1413 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1413 |
| UNKNOWN_CLAIM | `38_prism_helix` | `sliderArms` | UNKNOWN_CLAIM | 0.1021 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1021 |
| UNKNOWN_CLAIM | `54_murmuration_storm` | `sliderBuild` | UNKNOWN_CLAIM | 0.1004 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.1004 |
| UNKNOWN_CLAIM | `27_swipe` | `sliderSwipePos` | UNKNOWN_CLAIM | 0.0684 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0684 |
| UNKNOWN_CLAIM | `27_swipe` | `sliderShift` | UNKNOWN_CLAIM | 0.0684 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0684 |
| UNKNOWN_CLAIM | `summer_camp/83_shadow_canopy_eclipse` | `sliderCoronaBloom` | UNKNOWN_CLAIM | 0.0667 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0667 |
| UNKNOWN_CLAIM | `34_moire_interference` | `sliderRatio` | UNKNOWN_CLAIM | 0.0592 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0592 |
| UNKNOWN_CLAIM | `46_abyssal_fronds` | `sliderGlints` | UNKNOWN_CLAIM | 0.0453 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0453 |
| UNKNOWN_CLAIM | `54_murmuration_storm` | `sliderScatter` | UNKNOWN_CLAIM | 0.0443 | name_makes_no_falsifiable_claim | dominant mover temporalFreq 0.0443 |
| UNKNOWN_CLAIM | `37_chevron_chase` | `sliderStep` | UNKNOWN_CLAIM | 0.0145 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0145 |
| TRUE | `06_neon_elevator` | `sliderLocalSpeed` | SPEED | 3.9941 | claim_met | temporalRate 0.0008/0.0006/0.0012/0.0025/0.0072 (ratio 11.48, mono 1); temporalFreq ratio 8.00, mono 1 |
| TRUE | `25_heartbeat` | `sliderDirection` | DIRECTION | 3.5168 | claim_met | launch driftX -0.8233/-0.8233/0.8802/0.8802/0.8802 (ends -0.8233 → 0.8802, floor ±0.004); velocity-series correlation low↔high 0.266 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `25_heartbeat` | `sliderLocalSpeed` | SPEED | 2.1651 | claim_met | temporalRate 0.0034/0.0080/0.0139/0.0197/0.0194 (ratio 5.75, mono 1); temporalFreq ratio 5.90, mono 1 |
| TRUE | `summer_camp/71_tree_aurora` | `sliderAuroraHeight` | SPATIAL | 1.8735 | claim_met | edgeSharpnessZ swing 0.1258, monotonic 1 |
| TRUE | `16_ghost_tide_uv` | `sliderDirection` | DIRECTION | 1.7840 | claim_met | launch driftY 0.4864/0.4416/-0.0269/-0.2365/-0.3878 (ends 0.4864 → -0.3878, floor ±0.004); velocity-series correlation low↔high 0.227 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `25_heartbeat` | `sliderKick` | MAGNITUDE | 1.7168 | claim_met | dominant mover driftX 1.7168 |
| TRUE | `53_neon_elevator_hd` | `sliderLocalSpeed` | SPEED | 1.7108 | claim_met | temporalRate 0.0016/0.0032/0.0063/0.0116/0.0175 (ratio 10.71, mono 1); temporalFreq ratio 16.01, mono 1 |
| TRUE | `27_swipe` | `sliderLocalSpeed` | SPEED | 1.6723 | claim_met | temporalRate 0.0000/0.0007/0.0015/0.0020/0.0029 (ratio 2869.69, mono 1); temporalFreq ratio 14385.10, mono 1 |
| TRUE | `06_neon_elevator` | `sliderDirection` | DIRECTION | 1.5850 | claim_met | launch driftY -2.5658/-2.5658/-1.5516/-1.5516/-1.5516 (ends -2.5658 → -1.5516, floor ±0.004); velocity-series correlation low↔high -0.376 (reversal at ≤ -0.3) [via anticorrelated_motion] |
| TRUE | `calib_swipe_left_right` | `sliderLocalSpeed` | SPEED | 1.5594 | claim_met | temporalRate 0.0016/0.0035/0.0081/0.0136/0.0197 (ratio 12.20, mono 1); temporalFreq ratio 8.41, mono 1 |
| TRUE | `calib_swipe_up_down` | `sliderLocalSpeed` | SPEED | 1.4531 | claim_met | temporalRate 0.0017/0.0036/0.0072/0.0115/0.0173 (ratio 10.14, mono 1); temporalFreq ratio 9.14, mono 1 |
| TRUE | `53_neon_elevator_hd` | `sliderFloorCount` | SPATIAL | 1.3895 | claim_met | spatialFreqZ swing 0.2298, monotonic 0 [non-monotonic] |
| TRUE | `12_breathing` | `sliderRipple` | MAGNITUDE | 1.3771 | claim_met | dominant mover driftY 1.3771 |
| TRUE | `11_bioluminescence` | `sliderDirection` | DIRECTION | 1.3694 | claim_met | launch driftX 0.3668/0.1915/-0.0340/-0.1847/-0.2470 (ends 0.3668 → -0.2470, floor ±0.004); velocity-series correlation low↔high 0.234 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderHeatIntensity` | BRIGHTNESS | 1.3132 | claim_met | lumaMean swing 0.0201 ratio 20104.52 (via absolute), monotonic 1 |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderPingGlow` | BRIGHTNESS | 1.3125 | claim_met | lumaMean swing 0.0100 ratio 6.35 (via ratio), monotonic 1 |
| TRUE | `summer_camp/82_redwood_timber_fall` | `sliderCanopyBrightness` | BRIGHTNESS | 1.1969 | claim_met | lumaMean swing 0.0156 ratio 5.00 (via ratio), monotonic 1 |
| TRUE | `summer_camp/81_outpost_distress_beacon` | `sliderEchoGlow` | BRIGHTNESS | 1.1349 | claim_met | outputMean swing 0.0239 ratio 6.47 (via absolute), monotonic 1 |
| TRUE | `06_neon_elevator` | `sliderRadius` | SPATIAL | 1.1254 | claim_met | litFraction swing 0.1147, monotonic 1 |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderBandWidth` | SPATIAL | 1.1115 | claim_met | spatialFreqY swing 0.0845, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderBrightness` | BRIGHTNESS | 1.1020 | claim_met | lumaMean swing 0.0081 ratio 3.58 (via ratio), monotonic 1 |
| TRUE | `16_ghost_tide_uv` | `sliderLocalSpeed` | SPEED | 1.0694 | claim_met | temporalRate 0.0054/0.0108/0.0215/0.0415/0.0728 (ratio 13.49, mono 1); temporalFreq ratio 12.66, mono 1 |
| TRUE | `39_tide_riser` | `sliderBase` | MAGNITUDE | 1.0295 | claim_met | dominant mover contrastRatio 1.0295 |
| TRUE | `12_breathing` | `sliderLocalSpeed` | SPEED | 1.0118 | claim_met | temporalRate 0.0011/0.0021/0.0043/0.0077/0.0120 (ratio 10.45, mono 1); temporalFreq ratio 13.05, mono 1 |
| TRUE | `13_sparkle` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0667 ratio 66679.72 (via absolute), monotonic 1 |
| TRUE | `14_lunar_current` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | outputMean swing 0.1028 ratio 102815.34 (via absolute), monotonic 1 |
| TRUE | `17_rolling_color_dunes` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0092 ratio 9170.98 (via ratio), monotonic 1 |
| TRUE | `28_spectrum_bloom` | `sliderFloor` | MAGNITUDE | 1.0000 | claim_met | dominant mover satMean 1.0000 |
| TRUE | `summer_camp/43_sea_floor_shadow` | `sliderAbyssalSwell` | MAGNITUDE | 1.0000 | claim_met | dominant mover satMean 1.0000 |
| TRUE | `summer_camp/43_sea_floor_shadow` | `sliderBlackoutDepth` | DARKNESS | 1.0000 | claim_met | litFraction swing 1.0000 ratio 1000000.00 (via absolute), monotonic -1 (expected falling) |
| TRUE | `summer_camp/48_titanic_sos_beacon` | `sliderAbyssalDarkness` | DARKNESS | 1.0000 | claim_met | lumaMean swing 0.0092 ratio 9170.98 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/50_iceberg_fracture` | `sliderBlackoutDepth` | DARKNESS | 1.0000 | claim_met | lumaMean swing 0.0083 ratio 8337.25 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/65_dome_kick_shockwave` | `sliderImpact` | MAGNITUDE | 1.0000 | claim_met | dominant mover satMean 1.0000 |
| TRUE | `summer_camp/84_outpost_ember_overdrive` | `sliderHeatIntensity` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0009 ratio 850.29 (via ratio), monotonic 1 |
| TRUE | `test_const` | `sliderColorPalette1` | HUE | 1.0000 | claim_met | hue circular swing 0.4961 turns (normalised 0.9922), saturation swing 0.0000 |
| TRUE | `test/solid` | `sliderColorPalette1` | HUE | 0.9919 | claim_met | hue circular swing 0.4959 turns (normalised 0.9918), saturation swing 0.0000 |
| TRUE | `13_sparkle` | `sliderBackgroundLevel` | BRIGHTNESS | 0.9859 | claim_met | lumaMean swing 0.1926 ratio 21.50 (via absolute), monotonic 1 |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderWedgeWidth` | SPATIAL | 0.9803 | claim_met | litFraction swing 0.1188, monotonic 1 |
| TRUE | `35_sparkle_rain` | `sliderBase` | MAGNITUDE | 0.9775 | claim_met | dominant mover litFraction 0.9775 |
| TRUE | `53_neon_elevator_hd` | `sliderLevel` | BRIGHTNESS | 0.9738 | claim_met | lumaMean swing 0.0409 ratio 5.61 (via absolute), monotonic 1 |
| TRUE | `48_heartbeat_drive` | `sliderLow` | MAGNITUDE | 0.9611 | claim_met | dominant mover driftY 0.9611 |
| TRUE | `40_lissajous_weave` | `sliderLevel` | BRIGHTNESS | 0.9498 | claim_met | lumaMean swing 0.1367 ratio 46.29 (via absolute), monotonic 1 |
| TRUE | `12_breathing` | `sliderLevel` | BRIGHTNESS | 0.9369 | claim_met | lumaMean swing 0.1992 ratio 15.84 (via absolute), monotonic 1 |
| TRUE | `42_phyllotaxis_spiral` | `sliderFloorLvl` | MAGNITUDE | 0.9337 | claim_met | dominant mover litFraction 0.9337 |
| TRUE | `50_phase_cathedral_hd` | `sliderNodeContrast` | CONTRAST | 0.9275 | claim_met | contrastRatio swing 0.3690 ratio 2.05 (via absolute) |
| TRUE | `32_caustic_shimmer` | `sliderShimmer` | MAGNITUDE | 0.9243 | claim_met | dominant mover litFraction 0.9243 |
| TRUE | `transitions/trans_iris` | `sliderFeather` | SPATIAL | 0.9104 | claim_met | edgeSharpnessY swing 0.0260, monotonic -1 |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderCanopyGlow` | BRIGHTNESS | 0.9010 | claim_met | lumaMean swing 0.0106 ratio 3.63 (via ratio), monotonic 1 |
| TRUE | `35_sparkle_rain` | `sliderLevel` | BRIGHTNESS | 0.8970 | claim_met | lumaMean swing 0.0820 ratio 11.04 (via absolute), monotonic 1 |
| TRUE | `49_cylon_crush` | `sliderLevel` | BRIGHTNESS | 0.8690 | claim_met | lumaMean swing 0.0945 ratio 42.74 (via absolute), monotonic 1 |
| TRUE | `07_shimmer` | `sliderLevel` | BRIGHTNESS | 0.8565 | claim_met | lumaMean swing 0.1821 ratio 8.88 (via absolute), monotonic 1 |
| TRUE | `38_prism_helix` | `sliderLevel` | BRIGHTNESS | 0.8518 | claim_met | lumaMean swing 0.0599 ratio 5.24 (via absolute), monotonic 1 |
| TRUE | `25_heartbeat` | `sliderDormantGlow` | BRIGHTNESS | 0.8517 | claim_met | lumaMean swing 0.0592 ratio 5.65 (via absolute), monotonic 1 |
| TRUE | `02_phase_cathedral` | `sliderKick` | MAGNITUDE | 0.8390 | claim_met | dominant mover litFraction 0.8390 |
| TRUE | `03_dual_axis_crush` | `sliderLevel` | BRIGHTNESS | 0.8338 | claim_met | lumaMean swing 0.0660 ratio 5.65 (via absolute), monotonic 1 |
| TRUE | `33_aurora_breath` | `sliderLevel` | BRIGHTNESS | 0.8334 | claim_met | lumaMean swing 0.0805 ratio 4.01 (via absolute), monotonic 1 |
| TRUE | `65_uv_only` | `sliderLevel` | BRIGHTNESS | 0.8266 | claim_met | outputMean swing 0.0558 ratio 6.87 (via absolute), monotonic 1 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderTurnDecay` | TRAIL | 0.8166 | claim_met | litFraction swing 0.8166 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderPulseIntensity` | BRIGHTNESS | 0.8103 | claim_met | outputMean swing 0.0195 ratio 4.05 (via ratio), monotonic 1 |
| TRUE | `02_phase_cathedral` | `sliderSharpness` | SPATIAL | 0.8069 | claim_met | litFraction swing 0.8069, monotonic -1 |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderOrganGlow` | BRIGHTNESS | 0.8031 | claim_met | lumaMean swing 0.0080 ratio 3.66 (via ratio), monotonic 1 |
| TRUE | `10_chasers` | `sliderLevel` | BRIGHTNESS | 0.7973 | claim_met | lumaMean swing 0.1043 ratio 13.62 (via absolute), monotonic 1 |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderBaselineFloor` | MAGNITUDE | 0.7925 | claim_met | dominant mover contrastRatio 0.7925 |
| TRUE | `16_ghost_tide_uv` | `sliderLevel` | BRIGHTNESS | 0.7843 | claim_met | outputMean swing 0.1253 ratio 15.45 (via absolute), monotonic 1 |
| TRUE | `01_cylon_sweep` | `sliderLevel` | BRIGHTNESS | 0.7694 | claim_met | lumaMean swing 0.0937 ratio 6.68 (via absolute), monotonic 1 |
| TRUE | `48_heartbeat_drive` | `sliderLocalSpeed` | SPEED | 0.7692 | claim_met | temporalRate 0.0002/0.0003/0.0006/0.0019/0.0025 (ratio 14.67, mono 1); temporalFreq ratio 5.21, mono 0 |
| TRUE | `24_chromatic_murmuration` | `sliderAfterglow` | TRAIL | 0.7644 | claim_met | litFraction swing 0.7644 |
| TRUE | `47_quasicrystal_dunes` | `sliderDuneHeight` | SPATIAL | 0.7593 | claim_met | litFraction swing 0.7593, monotonic 1 |
| TRUE | `test_dualband` | `sliderColorPalette1` | HUE | 0.7590 | claim_met | hue circular swing 0.3795 turns (normalised 0.7590), saturation swing 0.0000 |
| TRUE | `00_golden_hour_wash` | `sliderLevel` | BRIGHTNESS | 0.7532 | claim_met | lumaMean swing 0.0876 ratio 6.08 (via absolute), monotonic 1 |
| TRUE | `18_deep_space_lattice` | `sliderLevel` | BRIGHTNESS | 0.7496 | claim_met | lumaMean swing 0.1035 ratio 15.96 (via absolute), monotonic 1 |
| TRUE | `15_silk_prism_ribbons` | `sliderLevel` | BRIGHTNESS | 0.7399 | claim_met | lumaMean swing 0.1136 ratio 8.94 (via absolute), monotonic 1 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderLocalSpeed` | SPEED | 0.7396 | claim_met | temporalRate 0.0003/0.0008/0.0010/0.0013/0.0015 (ratio 4.19, mono 1); temporalFreq ratio 4.80, mono 0 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderHullGlow` | BRIGHTNESS | 0.7373 | claim_met | lumaMean swing 0.0664 ratio 11.61 (via absolute), monotonic 1 |
| TRUE | `42_phyllotaxis_spiral` | `sliderCoreSize` | SPATIAL | 0.7350 | claim_met | spatialFreqY swing 0.2699, monotonic -1 |
| TRUE | `23_prismatic_strange_attractors` | `sliderContrast` | CONTRAST | 0.7327 | claim_met | contrastRatio swing 0.3377 ratio 1.61 (via absolute) |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderPopDecay` | TRAIL | 0.7289 | claim_met | litFraction swing 0.7289 |
| TRUE | `test_dualband` | `sliderColorPalette2` | HUE | 0.7233 | claim_met | hue circular swing 0.3617 turns (normalised 0.7233), saturation swing 0.0000 |
| TRUE | `19_swaying_lattice_ballet` | `sliderLevel` | BRIGHTNESS | 0.7059 | claim_met | lumaMean swing 0.0487 ratio 16.30 (via absolute), monotonic 1 |
| TRUE | `58_lighthouse_solo` | `sliderBeam` | SPATIAL | 0.7055 | claim_met | litFraction swing 0.5528, monotonic 1 |
| TRUE | `28_spectrum_bloom` | `sliderLocalSpeed` | SPEED | 0.7021 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0001 (ratio 18.56, mono 1); temporalFreq ratio 0.00, mono 0 |
| TRUE | `20_parametric_sway_field` | `sliderFocus` | SPATIAL | 0.6982 | claim_met | litFraction swing 0.6982, monotonic -1 |
| TRUE | `64_temple_warm_white` | `sliderWarmth` | WARMTH | 0.6970 | claim_met | bMean swing 0.0645 ratio 3.28 (via absolute), hue 0.0010 |
| TRUE | `51_confetti_cyclone` | `sliderLow` | MAGNITUDE | 0.6940 | claim_met | dominant mover contrastRatio 0.6940 |
| TRUE | `09_cyclone` | `sliderWhiteLevel` | WHITE | 0.6755 | claim_met | wMean swing 0.0273 ratio 27277.89 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderSectionFloor` | SPATIAL | 0.6723 | claim_met | edgeSharpnessZ swing 0.1010, monotonic 1 |
| TRUE | `52_silk_ribbons` | `sliderAudioLevel` | BRIGHTNESS | 0.6713 | claim_met | lumaMean swing 0.1185 ratio 12.03 (via absolute), monotonic 1 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderRevealWidth` | SPATIAL | 0.6690 | claim_met | litFraction swing 0.3123, monotonic 1 |
| TRUE | `09_cyclone` | `sliderLevel` | BRIGHTNESS | 0.6652 | claim_met | lumaMean swing 0.0469 ratio 7.71 (via absolute), monotonic 1 |
| TRUE | `08_ocean_liner` | `sliderLocalSpeed` | SPEED | 0.6618 | claim_met | temporalRate 0.0014/0.0025/0.0043/0.0081/0.0165 (ratio 11.63, mono 1); temporalFreq ratio 6.75, mono 1 |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderToothWidth` | SPATIAL | 0.6537 | claim_met | litFraction swing 0.3353, monotonic 1 |
| TRUE | `31_strobe_lattice` | `sliderLevel` | BRIGHTNESS | 0.6407 | claim_met | lumaMean swing 0.0646 ratio 15.18 (via absolute), monotonic 1 |
| TRUE | `36_orbital_pulse` | `sliderFocus` | SPATIAL | 0.6384 | claim_met | litFraction swing 0.2329, monotonic 1 |
| TRUE | `37_chevron_chase` | `sliderWidth` | SPATIAL | 0.6340 | claim_met | litFraction swing 0.6340, monotonic 1 |
| TRUE | `07_shimmer` | `sliderDetail` | SPATIAL | 0.6335 | claim_met | spatialFreqZ swing 0.1027, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderSectionFloor` | SPATIAL | 0.6238 | claim_met | spatialFreqZ swing 0.1159, monotonic 0 [non-monotonic] |
| TRUE | `20_parametric_sway_field` | `sliderLevel` | BRIGHTNESS | 0.6236 | claim_met | lumaMean swing 0.0618 ratio 9.67 (via absolute), monotonic 1 |
| TRUE | `12_breathing` | `sliderRadius` | SPATIAL | 0.6224 | claim_met | spatialFreqZ swing 0.0646, monotonic 1 |
| TRUE | `63_white_chase` | `sliderWarmth` | WARMTH | 0.6192 | claim_met | bMean swing 0.0719 ratio 2.59 (via absolute), hue 0.0101 |
| TRUE | `62_white_shimmer` | `sliderWarmth` | WARMTH | 0.6160 | claim_met | bMean swing 0.0390 ratio 2.59 (via absolute), hue 0.0005 |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderMoltenGlow` | BRIGHTNESS | 0.6118 | claim_met | lumaMean swing 0.0146 ratio 4.27 (via ratio), monotonic 1 |
| TRUE | `61_white_breathe` | `sliderLevel` | BRIGHTNESS | 0.6097 | claim_met | outputMean swing 0.3897 ratio 13.07 (via absolute), monotonic 1 |
| TRUE | `09_cyclone` | `sliderDensity` | SPATIAL | 0.6070 | claim_met | litFraction swing 0.0645, monotonic 1 |
| TRUE | `60_white_wash` | `sliderWarmth` | WARMTH | 0.6066 | claim_met | bMean swing 0.1151 ratio 2.54 (via absolute), hue 0.0003 |
| TRUE | `61_white_breathe` | `sliderWarmth` | WARMTH | 0.6038 | claim_met | bMean swing 0.1868 ratio 2.52 (via absolute), hue 0.0001 |
| TRUE | `09_cyclone` | `sliderLocalSpeed` | SPEED | 0.5995 | claim_met | temporalRate 0.0036/0.0062/0.0115/0.0211/0.0340 (ratio 9.47, mono 1); temporalFreq ratio 12.00, mono 1 |
| TRUE | `41_reaction_diffusion` | `sliderLevel` | BRIGHTNESS | 0.5988 | claim_met | lumaMean swing 0.0392 ratio 5.53 (via absolute), monotonic 1 |
| TRUE | `07_shimmer` | `sliderLocalSpeed` | SPEED | 0.5931 | claim_met | temporalRate 0.0037/0.0065/0.0121/0.0230/0.0343 (ratio 9.29, mono 1); temporalFreq ratio 10.87, mono 1 |
| TRUE | `61_white_breathe` | `sliderWhiteLevel` | WHITE | 0.5852 | claim_met | wMean swing 0.5852 ratio 7.00 (via absolute, threshold 0.01) |
| TRUE | `63_white_chase` | `sliderLevel` | BRIGHTNESS | 0.5815 | claim_met | lumaMean swing 0.1329 ratio 9.61 (via absolute), monotonic 1 |
| TRUE | `41_reaction_diffusion` | `sliderBase` | MAGNITUDE | 0.5803 | claim_met | dominant mover litFraction 0.5803 |
| TRUE | `22_abyssal_sway_garden` | `sliderLevel` | BRIGHTNESS | 0.5803 | claim_met | lumaMean swing 0.0534 ratio 7.66 (via absolute), monotonic 1 |
| TRUE | `57_ink_diffuse` | `sliderBase` | MAGNITUDE | 0.5757 | claim_met | dominant mover rMean 0.5757 |
| TRUE | `65_uv_only` | `sliderUvFloor` | UV | 0.5710 | claim_met | uvMean swing 0.5710 ratio 3.23 (via absolute, threshold 0.01) |
| TRUE | `25_heartbeat` | `sliderRadius` | SPATIAL | 0.5665 | claim_met | spatialFreqY swing 0.1123, monotonic 1 |
| TRUE | `27_swipe` | `sliderDirection` | DIRECTION | 0.5566 | claim_met | launch driftX 0.1286/0.1286/-0.2350/-0.2350/-0.2350 (ends 0.1286 → -0.2350, floor ±0.004); velocity-series correlation low↔high -0.399 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `02_phase_cathedral` | `sliderLevel` | BRIGHTNESS | 0.5550 | claim_met | outputMean swing 0.0199 ratio 9.96 (via ratio), monotonic 1 |
| TRUE | `37_chevron_chase` | `sliderBright` | BRIGHTNESS | 0.5550 | claim_met | lumaMean swing 0.0397 ratio 4.99 (via absolute), monotonic 1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderLocalSpeed` | SPEED | 0.5550 | claim_met | temporalRate 0.0000/0.0001/0.0005/0.0012/0.0029 (ratio 324.52, mono 1); temporalFreq ratio 8.40, mono 1 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderSweepWidth` | SPATIAL | 0.5534 | claim_met | litFraction swing 0.5534, monotonic 1 |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderBeamWidth` | SPATIAL | 0.5529 | claim_met | litFraction swing 0.0829, monotonic 1 |
| TRUE | `30_bass_comet` | `sliderBass` | MAGNITUDE | 0.5504 | claim_met | dominant mover contrastRatio 0.5504 |
| TRUE | `32_caustic_shimmer` | `sliderBase` | MAGNITUDE | 0.5468 | claim_met | dominant mover rMean 0.5468 |
| TRUE | `30_bass_comet` | `sliderDirection` | DIRECTION | 0.5452 | claim_met | launch driftX 0.0435/0.0435/0.5660/0.5660/0.5660 (ends 0.0435 → 0.5660, floor ±0.004); velocity-series correlation low↔high -0.998 (reversal at ≤ -0.3) [via anticorrelated_motion] |
| TRUE | `09_cyclone` | `sliderRadius` | SPATIAL | 0.5397 | claim_met | litFraction swing 0.0543, monotonic -1 |
| TRUE | `20_parametric_sway_field` | `sliderKick` | MAGNITUDE | 0.5396 | claim_met | dominant mover litFraction 0.5396 |
| TRUE | `48_heartbeat_drive` | `sliderKick` | MAGNITUDE | 0.5374 | claim_met | dominant mover driftY 0.5374 |
| TRUE | `54_murmuration_storm` | `sliderFlockEnergy` | MAGNITUDE | 0.5349 | claim_met | dominant mover rMean 0.5349 |
| TRUE | `62_white_shimmer` | `sliderLevel` | BRIGHTNESS | 0.5343 | claim_met | lumaMean swing 0.0754 ratio 9.46 (via absolute), monotonic 1 |
| TRUE | `summer_camp/74_lookout_gyro_vortex` | `sliderLocalSpeed` | SPEED | 0.5263 | claim_met | temporalRate 0.0002/0.0004/0.0010/0.0025/0.0063 (ratio 37.09, mono 1); temporalFreq ratio 13.84, mono 1 |
| TRUE | `13_sparkle` | `sliderDirection` | DIRECTION | 0.5238 | claim_met | launch driftZ -0.0219/-0.0076/0.0147/0.0163/0.0107 (ends -0.0219 → 0.0107, floor ±0.004); velocity-series correlation low↔high 0.196 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `43_golden_hour_pulse` | `sliderSwell` | MAGNITUDE | 0.5217 | claim_met | dominant mover rMean 0.5217 |
| TRUE | `62_white_shimmer` | `sliderDensity` | SPATIAL | 0.5174 | claim_met | spatialFreqY swing 0.1075, monotonic 1 |
| TRUE | `01_cylon_sweep` | `sliderBackgroundGlow` | BRIGHTNESS | 0.5160 | claim_met | lumaMean swing 0.0588 ratio 2.00 (via absolute), monotonic 1 |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderBeamGlow` | SPATIAL | 0.5112 | claim_met | litFraction swing 0.0658, monotonic 1 |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderLocalSpeed` | SPEED | 0.5071 | claim_met | temporalRate 0.0005/0.0010/0.0012/0.0016/0.0018 (ratio 3.75, mono 1); temporalFreq ratio 2.22, mono 0 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderAudioKick` | MAGNITUDE | 0.5065 | responds_to_edges_not_to_level | held static the control does nothing, but pulsed 0↔1 at 40 frames it moves contrastRatio by 0.5065 — this is an edge-triggered control, meant to be driven by a modulation mapping rather than parked at a value |
| TRUE | `45_manta_drift` | `sliderSwell` | MAGNITUDE | 0.5038 | claim_met | dominant mover rMean 0.5038 |
| TRUE | `61_white_breathe` | `sliderWhiteKick` | WHITE | 0.4973 | claim_met | wMean swing 0.4973 ratio 2.31 (via absolute, threshold 0.01) |
| TRUE | `10_chasers` | `sliderCount` | SPATIAL | 0.4966 | claim_met | litFraction swing 0.4966, monotonic 1 |
| TRUE | `26_dom_dancers_chevron` | `sliderDancerSize` | SPATIAL | 0.4911 | claim_met | litFraction swing 0.4291, monotonic 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderDetail` | SPATIAL | 0.4902 | claim_met | litFraction swing 0.4902, monotonic -1 |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderShimmer` | MAGNITUDE | 0.4808 | claim_met | dominant mover contrastRatio 0.4808 |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderChordSpread` | SPATIAL | 0.4798 | claim_met | litFraction swing 0.0610, monotonic 1 |
| TRUE | `34_moire_interference` | `sliderLevel` | BRIGHTNESS | 0.4798 | claim_met | lumaMean swing 0.0597 ratio 4.62 (via absolute), monotonic 1 |
| TRUE | `14_lunar_current` | `sliderDirection` | DIRECTION | 0.4756 | claim_met | launch driftY 0.1715/0.1287/0.0007/-0.0312/-0.0141 (ends 0.1715 → -0.0141, floor ±0.004); velocity-series correlation low↔high -0.375 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `21_pelagic_manta_rays` | `sliderLevel` | BRIGHTNESS | 0.4741 | claim_met | lumaMean swing 0.1008 ratio 8.68 (via absolute), monotonic 1 |
| TRUE | `38_prism_helix` | `sliderContrast` | CONTRAST | 0.4701 | claim_met | contrastRatio swing 0.4701 ratio 1.98 (via absolute) |
| TRUE | `15_silk_prism_ribbons` | `sliderSoftness` | SPATIAL | 0.4587 | claim_met | spatialFreqX swing 0.1582, monotonic 1 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderTrailGlow` | TRAIL | 0.4574 | claim_met | litFraction swing 0.3544 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderBlackoutDepth` | DARKNESS | 0.4550 | claim_met | litFraction swing 0.4550 ratio 1.94 (via absolute), monotonic -1 (expected falling) |
| TRUE | `43_golden_hour_pulse` | `sliderNoiseScale` | SPATIAL | 0.4457 | claim_met | litFraction swing 0.4457, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderLocalSpeed` | SPEED | 0.4397 | claim_met | temporalRate 0.0001/0.0002/0.0004/0.0010/0.0026 (ratio 33.15, mono 1); temporalFreq ratio 9.47, mono 1 |
| TRUE | `47_quasicrystal_dunes` | `sliderFloor` | MAGNITUDE | 0.4319 | claim_met | dominant mover contrastRatio 0.4319 |
| TRUE | `34_moire_interference` | `sliderContrast` | CONTRAST | 0.4319 | claim_met | contrastRatio swing 0.3802 ratio 1.78 (via absolute) |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderLocalSpeed` | SPEED | 0.4308 | claim_met | temporalRate 0.0009/0.0013/0.0025/0.0052/0.0082 (ratio 9.62, mono 1); temporalFreq ratio 13.51, mono 1 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderLocalSpeed` | SPEED | 0.4220 | claim_met | temporalRate 0.0014/0.0030/0.0053/0.0101/0.0184 (ratio 12.77, mono 1); temporalFreq ratio 10.19, mono 1 |
| TRUE | `63_white_chase` | `sliderLocalSpeed` | SPEED | 0.4150 | claim_met | temporalRate 0.0030/0.0060/0.0108/0.0195/0.0335 (ratio 11.20, mono 1); temporalFreq ratio 13.24, mono 1 |
| TRUE | `60_white_wash` | `sliderLevel` | BRIGHTNESS | 0.4109 | claim_met | outputMean swing 0.2537 ratio 8.69 (via absolute), monotonic 1 |
| TRUE | `57_ink_diffuse` | `sliderLocalSpeed` | SPEED | 0.4091 | claim_met | temporalRate 0.0006/0.0012/0.0025/0.0027/0.0045 (ratio 7.10, mono 1); temporalFreq ratio 3.14, mono 0 |
| TRUE | `00_golden_hour_wash` | `sliderRadius` | SPATIAL | 0.4074 | claim_met | spatialFreqZ swing 0.1996, monotonic 0 [non-monotonic] |
| TRUE | `30_bass_comet` | `sliderTail` | TRAIL | 0.4061 | claim_met | litFraction swing 0.4061 |
| TRUE | `07_shimmer` | `sliderDirection` | DIRECTION | 0.4010 | claim_met | launch driftY -0.2988/-0.2988/0.2788/0.2788/0.2788 (ends -0.2988 → 0.2788, floor ±0.004); velocity-series correlation low↔high -0.104 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderChaseGlow` | BRIGHTNESS | 0.3949 | claim_met | lumaMean swing 0.0239 ratio 4.21 (via absolute), monotonic 1 |
| TRUE | `summer_camp/71_tree_aurora` | `sliderLocalSpeed` | SPEED | 0.3904 | claim_met | temporalRate 0.0003/0.0007/0.0016/0.0031/0.0036 (ratio 12.84, mono 1); temporalFreq ratio 11.81, mono 0 |
| TRUE | `01_cylon_sweep` | `sliderRadius` | SPATIAL | 0.3902 | claim_met | spatialFreqX swing 0.0716, monotonic 0 [non-monotonic] |
| TRUE | `60_white_wash` | `sliderWhiteLevel` | WHITE | 0.3870 | claim_met | wMean swing 0.3870 ratio 8.70 (via absolute, threshold 0.01) |
| TRUE | `15_silk_prism_ribbons` | `sliderRibbonCount` | SPATIAL | 0.3838 | claim_met | spatialFreqY swing 0.3838, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderTrail` | TRAIL | 0.3791 | claim_met | litFraction swing 0.0575 |
| TRUE | `52_silk_ribbons` | `sliderRibbons` | SPATIAL | 0.3786 | claim_met | litFraction swing 0.3762, monotonic 1 |
| TRUE | `61_white_breathe` | `sliderDepth` | MAGNITUDE | 0.3768 | claim_met | dominant mover spatialFreqZ 0.3768 |
| TRUE | `23_prismatic_strange_attractors` | `sliderUvGhost` | UV | 0.3739 | claim_met | uvMean swing 0.0563 ratio 56324.25 (via absolute, threshold 0.01) |
| TRUE | `46_abyssal_fronds` | `sliderLevel` | BRIGHTNESS | 0.3722 | claim_met | lumaMean swing 0.0772 ratio 4.80 (via absolute), monotonic 1 |
| TRUE | `25_heartbeat` | `sliderLevel` | BRIGHTNESS | 0.3705 | claim_met | lumaMean swing 0.0104 ratio 1.89 (via ratio), monotonic 1 |
| TRUE | `calib_swipe_up_down` | `sliderBandW` | SPATIAL | 0.3670 | claim_met | litFraction swing 0.2697, monotonic 1 |
| TRUE | `40_lissajous_weave` | `sliderLocalSpeed` | SPEED | 0.3629 | claim_met | temporalRate 0.0018/0.0030/0.0053/0.0095/0.0149 (ratio 8.24, mono 1); temporalFreq ratio 9.30, mono 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderFloorLevel` | BRIGHTNESS | 0.3623 | claim_met | lumaMean swing 0.0113 ratio 1.66 (via ratio), monotonic 1 |
| TRUE | `18_deep_space_lattice` | `sliderDirection` | DIRECTION | 0.3598 | claim_met | launch driftZ -0.1324/-0.0726/0.0466/0.0019/0.0112 (ends -0.1324 → 0.0112, floor ±0.004); velocity-series correlation low↔high 0.020 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `04_beat_folded_helix` | `sliderLevel` | BRIGHTNESS | 0.3573 | claim_met | outputMean swing 0.0760 ratio 5.38 (via absolute), monotonic 1 |
| TRUE | `37_chevron_chase` | `sliderLocalSpeed` | SPEED | 0.3525 | claim_met | temporalRate 0.0009/0.0019/0.0035/0.0065/0.0118 (ratio 12.82, mono 1); temporalFreq ratio 10.60, mono 1 |
| TRUE | `32_caustic_shimmer` | `sliderLocalSpeed` | SPEED | 0.3519 | claim_met | temporalRate 0.0043/0.0097/0.0186/0.0342/0.0509 (ratio 11.73, mono 1); temporalFreq ratio 12.53, mono 1 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderFlickerSpeed` | SPEED | 0.3515 | claim_met | temporalRate 0.0064/0.0079/0.0100/0.0136/0.0237 (ratio 3.69, mono 1); temporalFreq ratio 4.33, mono 1 |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderLocalSpeed` | SPEED | 0.3476 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0006/0.0011 (ratio 16.19, mono 1); temporalFreq ratio 4.21, mono 1 |
| TRUE | `60_white_wash` | `sliderWhiteKick` | WHITE | 0.3458 | claim_met | wMean swing 0.3458 ratio 2.29 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderTrailDepth` | TRAIL | 0.3457 | claim_met | edgeSharpnessZ swing 0.0431 |
| TRUE | `18_deep_space_lattice` | `sliderLatticeScale` | SPATIAL | 0.3430 | claim_met | spatialFreqY swing 0.3430, monotonic 1 |
| TRUE | `29_kick_shockwave` | `sliderLevel` | BRIGHTNESS | 0.3428 | claim_met | lumaMean swing 0.0729 ratio 3.39 (via absolute), monotonic 1 |
| TRUE | `08_ocean_liner` | `sliderLevel` | BRIGHTNESS | 0.3397 | claim_met | lumaMean swing 0.0722 ratio 1.57 (via absolute), monotonic 1 |
| TRUE | `16_ghost_tide_uv` | `sliderUvLevel` | UV | 0.3389 | claim_met | uvMean swing 0.3389 ratio 338858.57 (via absolute, threshold 0.01) |
| TRUE | `04_beat_folded_helix` | `sliderContrast` | CONTRAST | 0.3356 | claim_met | contrastRatio swing 0.3356 ratio 1.39 (via absolute) |
| TRUE | `19_swaying_lattice_ballet` | `sliderLatticeScale` | SPATIAL | 0.3342 | claim_met | spatialFreqY swing 0.3342, monotonic 0 [non-monotonic] |
| TRUE | `05_orbital_attractor_field` | `sliderLevel` | BRIGHTNESS | 0.3336 | claim_met | lumaMean swing 0.0709 ratio 2.20 (via absolute), monotonic 1 |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderLockdownPressure` | MAGNITUDE | 0.3328 | claim_met | dominant mover rMean 0.3328 |
| TRUE | `00_golden_hour_wash` | `sliderLocalSpeed` | SPEED | 0.3326 | claim_met | temporalRate 0.0013/0.0022/0.0041/0.0077/0.0142 (ratio 10.62, mono 1); temporalFreq ratio 10.71, mono 1 |
| TRUE | `18_deep_space_lattice` | `sliderLineSoftness` | SPATIAL | 0.3309 | claim_met | litFraction swing 0.3309, monotonic -1 |
| TRUE | `summer_camp/81_outpost_distress_beacon` | `sliderLocalSpeed` | SPEED | 0.3305 | claim_met | temporalRate 0.0001/0.0001/0.0001/0.0001/0.0001 (ratio 2.33, mono 1); temporalFreq ratio 1.33, mono 1 |
| TRUE | `22_abyssal_sway_garden` | `sliderLocalSpeed` | SPEED | 0.3291 | claim_met | temporalRate 0.0089/0.0134/0.0208/0.0260/0.0285 (ratio 3.19, mono 1); temporalFreq ratio 3.96, mono 1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderCycleSpeed` | SPEED | 0.3283 | claim_met | temporalRate 0.0001/0.0002/0.0005/0.0007/0.0009 (ratio 7.27, mono 1); temporalFreq ratio 2.51, mono 1 |
| TRUE | `13_sparkle` | `sliderKick` | MAGNITUDE | 0.3277 | claim_met | dominant mover rMean 0.3278 |
| TRUE | `24_chromatic_murmuration` | `sliderContrast` | CONTRAST | 0.3225 | claim_met | contrastRatio swing 0.0927 ratio 1.16 (via absolute) |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderSweepWidth` | SPATIAL | 0.3193 | claim_met | spatialFreqY swing 0.0368, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderBrightness` | BRIGHTNESS | 0.3191 | claim_met | lumaMean swing 0.0030 ratio 1.83 (via ratio), monotonic 1 |
| TRUE | `23_prismatic_strange_attractors` | `sliderRadius` | SPATIAL | 0.3186 | claim_met | spatialFreqZ swing 0.0495, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/65_dome_kick_shockwave` | `sliderVoidDepth` | DARKNESS | 0.3019 | claim_met | lumaMean swing 0.0100 ratio 6.84 (via ratio), monotonic -1 (expected falling) |
| TRUE | `24_chromatic_murmuration` | `sliderLocalSpeed` | SPEED | 0.3005 | claim_met | temporalRate 0.0036/0.0060/0.0107/0.0136/0.0160 (ratio 4.40, mono 1); temporalFreq ratio 5.99, mono 1 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderVortexWidth` | SPATIAL | 0.2971 | claim_met | litFraction swing 0.2109, monotonic 1 |
| TRUE | `50_phase_cathedral_hd` | `sliderSharpBase` | SPATIAL | 0.2945 | claim_met | litFraction swing 0.2945, monotonic -1 |
| TRUE | `06_neon_elevator` | `sliderLevel` | BRIGHTNESS | 0.2894 | claim_met | lumaMean swing 0.0179 ratio 2.63 (via ratio), monotonic 1 |
| TRUE | `18_deep_space_lattice` | `sliderLocalSpeed` | SPEED | 0.2891 | claim_met | temporalRate 0.0013/0.0026/0.0051/0.0098/0.0176 (ratio 13.48, mono 1); temporalFreq ratio 14.44, mono 1 |
| TRUE | `63_white_chase` | `sliderCount` | SPATIAL | 0.2889 | claim_met | spatialFreqZ swing 0.2889, monotonic 0 [non-monotonic] |
| TRUE | `20_parametric_sway_field` | `sliderDetail` | SPATIAL | 0.2883 | claim_met | litFraction swing 0.2883, monotonic -1 |
| TRUE | `01_cylon_sweep` | `sliderTrail` | TRAIL | 0.2873 | claim_met | spatialFreqZ swing 0.1292 |
| TRUE | `54_murmuration_storm` | `sliderFocus` | SPATIAL | 0.2864 | claim_met | litFraction swing 0.2864, monotonic -1 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderUvTrail` | UV | 0.2841 | claim_met | uvMean swing 0.0875 ratio 87517.38 (via absolute, threshold 0.01) |
| TRUE | `09_cyclone` | `sliderWhiteKick` | WHITE | 0.2834 | claim_met | wMean swing 0.0119 ratio 2.61 (via absolute, threshold 0.01) |
| TRUE | `58_lighthouse_solo` | `sliderLocalSpeed` | SPEED | 0.2827 | claim_met | temporalRate 0.0003/0.0006/0.0010/0.0015/0.0027 (ratio 7.89, mono 1); temporalFreq ratio 3.27, mono 1 |
| TRUE | `26_dom_dancers_chevron` | `sliderBaseGlow` | BRIGHTNESS | 0.2812 | claim_met | lumaMean swing 0.0390 ratio 1.26 (via absolute), monotonic 1 |
| TRUE | `58_lighthouse_solo` | `sliderWidth` | SPATIAL | 0.2809 | claim_met | litFraction swing 0.2809, monotonic 1 |
| TRUE | `60_white_wash` | `sliderRadius` | SPATIAL | 0.2805 | claim_met | spatialFreqZ swing 0.2805, monotonic 1 |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderBaselineFloor` | MAGNITUDE | 0.2799 | claim_met | dominant mover contrastRatio 0.2799 |
| TRUE | `01_cylon_sweep` | `sliderLocalSpeed` | SPEED | 0.2774 | claim_met | temporalRate 0.0001/0.0001/0.0003/0.0003/0.0006 (ratio 6.24, mono 1); temporalFreq ratio 1.11, mono 0 |
| TRUE | `summer_camp/85_redwood_starry_canopy` | `sliderLocalSpeed` | SPEED | 0.2768 | claim_met | temporalRate 0.0072/0.0091/0.0126/0.0179/0.0240 (ratio 3.34, mono 1); temporalFreq ratio 3.41, mono 1 |
| TRUE | `32_caustic_shimmer` | `sliderDepth` | MAGNITUDE | 0.2741 | claim_met | dominant mover litFraction 0.2740 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderLocalSpeed` | SPEED | 0.2707 | claim_met | temporalRate 0.0003/0.0008/0.0014/0.0029/0.0057 (ratio 16.47, mono 1); temporalFreq ratio 11.31, mono 1 |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderLocalSpeed` | SPEED | 0.2693 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0006/0.0013 (ratio 14.69, mono 1); temporalFreq ratio 9.06, mono 1 |
| TRUE | `52_silk_ribbons` | `sliderSoftness` | SPATIAL | 0.2690 | claim_met | litFraction swing 0.2573, monotonic -1 |
| TRUE | `00_golden_hour_wash` | `sliderDirection` | DIRECTION | 0.2688 | claim_met | launch driftY 0.0589/0.0308/-0.0042/-0.0304/-0.0153 (ends 0.0589 → -0.0153, floor ±0.004); velocity-series correlation low↔high -0.728 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `36_orbital_pulse` | `sliderReach` | SPATIAL | 0.2662 | claim_met | spatialFreqY swing 0.0504, monotonic 0 [non-monotonic] |
| TRUE | `11_bioluminescence` | `sliderLevel` | BRIGHTNESS | 0.2653 | claim_met | outputMean swing 0.0762 ratio 3.40 (via absolute), monotonic 1 |
| TRUE | `23_prismatic_strange_attractors` | `sliderLocalSpeed` | SPEED | 0.2648 | claim_met | temporalRate 0.0016/0.0028/0.0033/0.0036/0.0042 (ratio 2.60, mono 1); temporalFreq ratio 2.44, mono 0 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderLocalSpeed` | SPEED | 0.2627 | claim_met | temporalRate 0.0019/0.0024/0.0026/0.0027/0.0047 (ratio 2.45, mono 1); temporalFreq ratio 2.02, mono 0 |
| TRUE | `30_bass_comet` | `sliderHeadKick` | MAGNITUDE | 0.2621 | claim_met | dominant mover litFraction 0.2621 |
| TRUE | `summer_camp/85_redwood_starry_canopy` | `sliderStarEnergy` | MAGNITUDE | 0.2599 | claim_met | dominant mover rMean 0.2599 |
| TRUE | `08_ocean_liner` | `sliderDirection` | DIRECTION | 0.2579 | claim_met | launch driftY -0.0869/-0.0869/0.1507/0.1507/0.1507 (ends -0.0869 → 0.1507, floor ±0.004); velocity-series correlation low↔high 0.249 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `20_parametric_sway_field` | `sliderTrailBlend` | TRAIL | 0.2564 | claim_met | litFraction swing 0.2564 |
| TRUE | `30_bass_comet` | `sliderLocalSpeed` | SPEED | 0.2557 | claim_met | temporalRate 0.0016/0.0034/0.0057/0.0072/0.0067 (ratio 4.49, mono 0); temporalFreq ratio 5.11, mono 1 |
| TRUE | `01_cylon_sweep` | `sliderEyeWidth` | SPATIAL | 0.2555 | claim_met | spatialFreqY swing 0.1178, monotonic 1 |
| TRUE | `65_uv_only` | `sliderRadius` | SPATIAL | 0.2551 | claim_met | spatialFreqY swing 0.2551, monotonic 1 |
| TRUE | `13_sparkle` | `sliderLocalSpeed` | SPEED | 0.2542 | claim_met | temporalRate 0.0008/0.0014/0.0023/0.0026/0.0026 (ratio 3.49, mono 1); temporalFreq ratio 4.53, mono 1 |
| TRUE | `26_dom_dancers_chevron` | `sliderDancerGlow` | BRIGHTNESS | 0.2526 | claim_met | lumaMean swing 0.1283 ratio 2.73 (via absolute), monotonic 1 |
| TRUE | `50_phase_cathedral_hd` | `sliderLocalSpeed` | SPEED | 0.2525 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0004/0.0006 (ratio 4.90, mono 1); temporalFreq ratio 2.77, mono 1 |
| TRUE | `40_lissajous_weave` | `sliderBase` | MAGNITUDE | 0.2515 | claim_met | dominant mover litFraction 0.2515 |
| TRUE | `calib_swipe_left_right` | `sliderBandW` | SPATIAL | 0.2501 | claim_met | litFraction swing 0.2501, monotonic 1 |
| TRUE | `summer_camp/84_outpost_ember_overdrive` | `sliderLocalSpeed` | SPEED | 0.2500 | claim_met | temporalRate 0.0001/0.0002/0.0004/0.0008/0.0016 (ratio 11.33, mono 1); temporalFreq ratio 22.80, mono 1 |
| TRUE | `62_white_shimmer` | `sliderLocalSpeed` | SPEED | 0.2487 | claim_met | temporalRate 0.0058/0.0101/0.0183/0.0334/0.0555 (ratio 9.59, mono 1); temporalFreq ratio 9.72, mono 1 |
| TRUE | `24_chromatic_murmuration` | `sliderDirection` | DIRECTION | 0.2482 | claim_met | launch driftZ 0.1574/0.1574/-0.3394/-0.3394/-0.3394 (ends 0.1574 → -0.3394, floor ±0.004); velocity-series correlation low↔high 0.142 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `15_silk_prism_ribbons` | `sliderShimmer` | MAGNITUDE | 0.2477 | claim_met | dominant mover contrastRatio 0.2477 |
| TRUE | `summer_camp/80_tree_canopy_fracture` | `sliderBranchSharpness` | SPATIAL | 0.2472 | claim_met | spatialFreqZ swing 0.0562, monotonic 1 |
| TRUE | `23_prismatic_strange_attractors` | `sliderDirection` | DIRECTION | 0.2456 | claim_met | launch driftY -0.0179/-0.0179/0.0526/0.0526/0.0526 (ends -0.0179 → 0.0526, floor ±0.004); velocity-series correlation low↔high -0.076 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `04_beat_folded_helix` | `sliderWhiteKick` | WHITE | 0.2452 | claim_met | wMean swing 0.0960 ratio 3.00 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderLocalSpeed` | SPEED | 0.2428 | claim_met | temporalRate 0.0001/0.0001/0.0003/0.0005/0.0011 (ratio 14.16, mono 1); temporalFreq ratio 4.78, mono 1 |
| TRUE | `summer_camp/84_outpost_ember_overdrive` | `sliderEmberSpeed` | SPEED | 0.2422 | claim_met | temporalRate 0.0003/0.0004/0.0004/0.0005/0.0006 (ratio 2.00, mono 1); temporalFreq ratio 1.23, mono 1 |
| TRUE | `summer_camp/84_outpost_ember_overdrive` | `sliderUvIntensity` | UV | 0.2409 | claim_met | uvMean swing 0.0611 ratio 61133.68 (via absolute, threshold 0.01) |
| TRUE | `46_abyssal_fronds` | `sliderFrondDensity` | SPATIAL | 0.2400 | claim_met | spatialFreqZ swing 0.2400, monotonic 0 [non-monotonic] |
| TRUE | `23_prismatic_strange_attractors` | `sliderLevel` | BRIGHTNESS | 0.2376 | claim_met | lumaMean swing 0.0108 ratio 7.03 (via ratio), monotonic 1 |
| TRUE | `61_white_breathe` | `sliderRadius` | SPATIAL | 0.2370 | claim_met | spatialFreqZ swing 0.2370, monotonic 0 [non-monotonic] |
| TRUE | `09_cyclone` | `sliderKick` | MAGNITUDE | 0.2367 | claim_met | dominant mover contrastRatio 0.2367 |
| TRUE | `02_phase_cathedral` | `sliderDirection` | DIRECTION | 0.2351 | claim_met | launch driftZ 0.0690/0.0861/-0.0096/-0.1047/-0.1308 (ends 0.0690 → -0.1308, floor ±0.004); velocity-series correlation low↔high -0.036 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderBlackoutDepth` | DARKNESS | 0.2319 | claim_met | litFraction swing 0.0426 ratio 1.20 (via absolute), monotonic -1 (expected falling) |
| TRUE | `62_white_shimmer` | `sliderSharpness` | SPATIAL | 0.2300 | claim_met | litFraction swing 0.1805, monotonic -1 |
| TRUE | `14_lunar_current` | `sliderUvLift` | UV | 0.2276 | claim_met | uvMean swing 0.2276 ratio 227595.09 (via absolute, threshold 0.01) |
| TRUE | `65_uv_only` | `sliderSharpness` | SPATIAL | 0.2268 | claim_met | spatialFreqX swing 0.0456, monotonic 0 [non-monotonic] |
| TRUE | `65_uv_only` | `sliderLocalSpeed` | SPEED | 0.2266 | claim_met | temporalRate 0.0004/0.0007/0.0012/0.0023/0.0044 (ratio 11.60, mono 1); temporalFreq ratio 6.95, mono 1 |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderSweepWidth` | SPATIAL | 0.2254 | claim_met | litFraction swing 0.2254, monotonic 1 |
| TRUE | `11_bioluminescence` | `sliderDensity` | SPATIAL | 0.2228 | claim_met | spatialFreqY swing 0.2228, monotonic 0 [non-monotonic] |
| TRUE | `53_neon_elevator_hd` | `sliderSharp` | SPATIAL | 0.2224 | claim_met | litFraction swing 0.2224, monotonic -1 |
| TRUE | `02_phase_cathedral` | `sliderRadius` | SPATIAL | 0.2222 | claim_met | spatialFreqX swing 0.1709, monotonic 0 [non-monotonic] |
| TRUE | `63_white_chase` | `sliderDirection` | DIRECTION | 0.2201 | claim_met | launch driftY 0.0283/0.0269/0.0215/-0.0105/-0.0362 (ends 0.0283 → -0.0362, floor ±0.004); velocity-series correlation low↔high -0.375 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/83_shadow_canopy_eclipse` | `sliderWarpAmount` | MAGNITUDE | 0.2198 | claim_met | dominant mover spatialFreqY 0.2198 |
| TRUE | `13_sparkle` | `sliderDensity` | SPATIAL | 0.2168 | claim_met | spatialFreqZ swing 0.2168, monotonic 1 |
| TRUE | `10_chasers` | `sliderLocalSpeed` | SPEED | 0.2168 | claim_met | temporalRate 0.0055/0.0089/0.0151/0.0273/0.0261 (ratio 4.93, mono 0); temporalFreq ratio 5.43, mono 1 |
| TRUE | `60_white_wash` | `sliderLocalSpeed` | SPEED | 0.2155 | claim_met | temporalRate 0.0014/0.0025/0.0045/0.0084/0.0165 (ratio 11.49, mono 1); temporalFreq ratio 9.37, mono 1 |
| TRUE | `summer_camp/71_tree_aurora` | `sliderWindShimmer` | MAGNITUDE | 0.2151 | claim_met | dominant mover temporalFreq 0.2151 |
| TRUE | `62_white_shimmer` | `sliderWhiteLevel` | WHITE | 0.2145 | claim_met | wMean swing 0.1129 ratio 5.51 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/80_tree_canopy_fracture` | `sliderFractureAmount` | MAGNITUDE | 0.2136 | claim_met | dominant mover contrastRatio 0.2136 |
| TRUE | `03_dual_axis_crush` | `sliderLocalSpeed` | SPEED | 0.2097 | claim_met | temporalRate 0.0017/0.0030/0.0054/0.0102/0.0197 (ratio 11.69, mono 1); temporalFreq ratio 11.93, mono 1 |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderRingRate` | SPEED | 0.2093 | claim_met | temporalRate 0.0003/0.0009/0.0017/0.0025/0.0032 (ratio 10.33, mono 1); temporalFreq ratio 10.60, mono 1 |
| TRUE | `47_quasicrystal_dunes` | `sliderDuneScale` | SPATIAL | 0.2081 | claim_met | spatialFreqZ swing 0.2053, monotonic 1 |
| TRUE | `summer_camp/74_lookout_gyro_vortex` | `sliderVortexSpeed` | SPEED | 0.2079 | claim_met | temporalRate 0.0000/0.0006/0.0010/0.0016/0.0023 (ratio 2297.12, mono 1); temporalFreq ratio 18904.64, mono 1 |
| TRUE | `47_quasicrystal_dunes` | `sliderLocalSpeed` | SPEED | 0.2077 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0004/0.0007 (ratio 7.46, mono 1); temporalFreq ratio 1.46, mono 0 |
| TRUE | `62_white_shimmer` | `sliderRadius` | SPATIAL | 0.2074 | claim_met | spatialFreqZ swing 0.2074, monotonic 0 [non-monotonic] |
| TRUE | `63_white_chase` | `sliderWhiteLevel` | WHITE | 0.2070 | claim_met | wMean swing 0.2070 ratio 6.26 (via absolute, threshold 0.01) |
| TRUE | `11_bioluminescence` | `sliderLocalSpeed` | SPEED | 0.2056 | claim_met | temporalRate 0.0017/0.0028/0.0052/0.0096/0.0192 (ratio 11.47, mono 1); temporalFreq ratio 5.37, mono 1 |
| TRUE | `49_cylon_crush` | `sliderLocalSpeed` | SPEED | 0.2036 | claim_met | temporalRate 0.0045/0.0060/0.0077/0.0096/0.0111 (ratio 2.44, mono 1); temporalFreq ratio 3.45, mono 1 |
| TRUE | `23_prismatic_strange_attractors` | `sliderChaos` | MAGNITUDE | 0.2030 | claim_met | dominant mover temporalFreq 0.2030 |
| TRUE | `44_biolume_swell` | `sliderSwell` | MAGNITUDE | 0.2028 | claim_met | dominant mover uvMean 0.2028 |
| TRUE | `summer_camp/83_shadow_canopy_eclipse` | `sliderEclipseScale` | SPATIAL | 0.2020 | claim_met | litFraction swing 0.2020, monotonic -1 |
| TRUE | `64_temple_warm_white` | `sliderLocalSpeed` | SPEED | 0.1984 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0003/0.0006 (ratio 8.26, mono 1); temporalFreq ratio 4562.21, mono 1 |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderGearDrive` | MAGNITUDE | 0.1984 | claim_met | dominant mover spatialFreqZ 0.1984 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderCampfireHeat` | MAGNITUDE | 0.1983 | claim_met | dominant mover litFraction 0.1983 |
| TRUE | `31_strobe_lattice` | `sliderSharp` | SPATIAL | 0.1972 | claim_met | spatialFreqY swing 0.1972, monotonic -1 |
| TRUE | `test/test_params` | `sliderSpeed` | SPEED | 0.1969 | claim_met | temporalRate 0.0000/0.0005/0.0010/0.0015/0.0020 (ratio 2024.26, mono 1); temporalFreq ratio 6169.67, mono 1 |
| TRUE | `05_orbital_attractor_field` | `sliderLocalSpeed` | SPEED | 0.1960 | claim_met | temporalRate 0.0004/0.0008/0.0018/0.0030/0.0054 (ratio 14.04, mono 1); temporalFreq ratio 10.31, mono 1 |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderSweepWidth` | SPATIAL | 0.1957 | claim_met | litFraction swing 0.0994, monotonic 1 |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderTrail` | TRAIL | 0.1956 | claim_met | litFraction swing 0.0689 |
| TRUE | `49_cylon_crush` | `sliderTrail` | TRAIL | 0.1949 | claim_met | litFraction swing 0.1904 |
| TRUE | `51_confetti_cyclone` | `sliderSparkSize` | SPATIAL | 0.1949 | claim_met | litFraction swing 0.1949, monotonic 1 |
| TRUE | `52_silk_ribbons` | `sliderLocalSpeed` | SPEED | 0.1948 | claim_met | temporalRate 0.0029/0.0030/0.0035/0.0038/0.0054 (ratio 1.89, mono 1); temporalFreq ratio 6.73, mono 0 |
| TRUE | `21_pelagic_manta_rays` | `sliderLocalSpeed` | SPEED | 0.1939 | claim_met | temporalRate 0.0006/0.0012/0.0031/0.0061/0.0123 (ratio 21.98, mono 1); temporalFreq ratio 8.15, mono 1 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderContrast` | CONTRAST | 0.1929 | claim_met | contrastRatio swing 0.1929 ratio 1.32 (via absolute) |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderAudioMid` | MAGNITUDE | 0.1918 | claim_met | dominant mover contrastRatio 0.1918 |
| TRUE | `11_bioluminescence` | `sliderUvGlow` | UV | 0.1912 | claim_met | uvMean swing 0.1912 ratio 23.57 (via absolute, threshold 0.01) |
| TRUE | `64_temple_warm_white` | `sliderWhiteLevel` | WHITE | 0.1909 | claim_met | wMean swing 0.1909 ratio 49.66 (via absolute, threshold 0.01) |
| TRUE | `12_breathing` | `sliderSharpness` | SPATIAL | 0.1903 | claim_met | spatialFreqY swing 0.0423, monotonic -1 |
| TRUE | `43_golden_hour_pulse` | `sliderLocalSpeed` | SPEED | 0.1888 | claim_met | temporalRate 0.0000/0.0000/0.0001/0.0002/0.0003 (ratio 23.11, mono 1); temporalFreq ratio 6993.01, mono 1 |
| TRUE | `58_lighthouse_solo` | `sliderFlash` | MAGNITUDE | 0.1888 | claim_met | dominant mover contrastRatio 0.1888 |
| TRUE | `64_temple_warm_white` | `sliderRadius` | SPATIAL | 0.1878 | claim_met | spatialFreqZ swing 0.1878, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderUvIntensity` | UV | 0.1874 | claim_met | uvMean swing 0.1167 ratio 116749.39 (via absolute, threshold 0.01) |
| TRUE | `41_reaction_diffusion` | `sliderLocalSpeed` | SPEED | 0.1869 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0006/0.0012 (ratio 12.95, mono 1); temporalFreq ratio 18391.61, mono 1 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderSweepImpact` | MAGNITUDE | 0.1866 | claim_met | dominant mover litFraction 0.1866 |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderRippleWidth` | SPATIAL | 0.1865 | claim_met | spatialFreqX swing 0.0272, monotonic 0 [non-monotonic] |
| TRUE | `08_ocean_liner` | `sliderDetail` | SPATIAL | 0.1864 | claim_met | spatialFreqY swing 0.0435, monotonic 0 [non-monotonic] |
| TRUE | `03_dual_axis_crush` | `sliderBeamWidth` | SPATIAL | 0.1862 | claim_met | litFraction swing 0.1862, monotonic 1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderAudioBass` | MAGNITUDE | 0.1857 | claim_met | dominant mover contrastRatio 0.1857 |
| TRUE | `10_chasers` | `sliderKick` | MAGNITUDE | 0.1848 | claim_met | dominant mover rMean 0.1848 |
| TRUE | `02_phase_cathedral` | `sliderCount` | SPATIAL | 0.1839 | claim_met | spatialFreqY swing 0.1800, monotonic 0 [non-monotonic] |
| TRUE | `51_confetti_cyclone` | `sliderLocalSpeed` | SPEED | 0.1836 | claim_met | temporalRate 0.0004/0.0010/0.0014/0.0024/0.0035 (ratio 9.69, mono 1); temporalFreq ratio 4.10, mono 1 |
| TRUE | `34_moire_interference` | `sliderLocalSpeed` | SPEED | 0.1813 | claim_met | temporalRate 0.0006/0.0012/0.0023/0.0048/0.0090 (ratio 13.96, mono 1); temporalFreq ratio 8.79, mono 1 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderAudioMid` | MAGNITUDE | 0.1811 | claim_met | dominant mover contrastRatio 0.1811 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderVortexSpeed` | SPEED | 0.1785 | claim_met | temporalRate 0.0008/0.0032/0.0053/0.0078/0.0096 (ratio 11.93, mono 1); temporalFreq ratio 9.46, mono 1 |
| TRUE | `04_beat_folded_helix` | `sliderWhiteLevel` | WHITE | 0.1784 | claim_met | wMean swing 0.0638 ratio 2.41 (via absolute, threshold 0.01) |
| TRUE | `13_sparkle` | `sliderSparkleSize` | SPATIAL | 0.1784 | claim_met | spatialFreqZ swing 0.1784, monotonic 1 |
| TRUE | `65_uv_only` | `sliderKick` | MAGNITUDE | 0.1781 | claim_met | dominant mover uvMean 0.1781 |
| TRUE | `21_pelagic_manta_rays` | `sliderRadius` | SPATIAL | 0.1776 | claim_met | litFraction swing 0.1630, monotonic 1 |
| TRUE | `summer_camp/79_mill_pressure_release` | `sliderCoolingAfterglow` | TRAIL | 0.1775 | claim_met | spatialFreqY swing 0.1775 |
| TRUE | `20_parametric_sway_field` | `sliderLocalSpeed` | SPEED | 0.1768 | claim_met | temporalRate 0.0003/0.0005/0.0012/0.0015/0.0019 (ratio 6.37, mono 1); temporalFreq ratio 3.15, mono 1 |
| TRUE | `transitions/trans_diagonal_wipe` | `sliderFeather` | SPATIAL | 0.1763 | claim_met | spatialFreqZ swing 0.0592, monotonic 1 |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderLocalSpeed` | SPEED | 0.1755 | claim_met | temporalRate 0.0005/0.0013/0.0033/0.0086/0.0204 (ratio 39.03, mono 1); temporalFreq ratio 18.61, mono 1 |
| TRUE | `summer_camp/74_lookout_gyro_vortex` | `sliderSweepImpact` | MAGNITUDE | 0.1742 | claim_met | dominant mover driftZ 0.1742 |
| TRUE | `16_ghost_tide_uv` | `sliderWhiteLevel` | WHITE | 0.1736 | claim_met | wMean swing 0.1655 ratio 165467.10 (via absolute, threshold 0.01) |
| TRUE | `33_aurora_breath` | `sliderRibbons` | SPATIAL | 0.1733 | claim_met | spatialFreqZ swing 0.1733, monotonic 0 [non-monotonic] |
| TRUE | `22_abyssal_sway_garden` | `sliderFrondDensity` | SPATIAL | 0.1730 | claim_met | spatialFreqZ swing 0.1730, monotonic 0 [non-monotonic] |
| TRUE | `04_beat_folded_helix` | `sliderDirection` | DIRECTION | 0.1720 | claim_met | launch driftZ -0.0165/0.0007/-0.0012/0.0188/0.0198 (ends -0.0165 → 0.0198, floor ±0.004); velocity-series correlation low↔high -0.128 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/83_shadow_canopy_eclipse` | `sliderLocalSpeed` | SPEED | 0.1709 | claim_met | temporalRate 0.0001/0.0003/0.0009/0.0030/0.0085 (ratio 91.91, mono 1); temporalFreq ratio 24.62, mono 1 |
| TRUE | `16_ghost_tide_uv` | `sliderTideWidth` | SPATIAL | 0.1708 | claim_met | edgeSharpnessX swing 0.0920, monotonic 1 |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderAudioBass` | MAGNITUDE | 0.1704 | claim_met | dominant mover litFraction 0.1704 |
| TRUE | `14_lunar_current` | `sliderRadius` | SPATIAL | 0.1697 | claim_met | spatialFreqZ swing 0.1697, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderLocalSpeed` | SPEED | 0.1695 | claim_met | temporalRate 0.0000/0.0001/0.0003/0.0007/0.0017 (ratio 33.55, mono 1); temporalFreq ratio 16.10, mono 1 |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderBlackoutDepth` | DARKNESS | 0.1693 | claim_met | litFraction swing 0.1338 ratio 1.47 (via absolute), monotonic -1 (expected falling) |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderTrailLength` | TRAIL | 0.1691 | claim_met | litFraction swing 0.0648 |
| TRUE | `02_phase_cathedral` | `sliderLocalSpeed` | SPEED | 0.1679 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0003/0.0005 (ratio 8.62, mono 1); temporalFreq ratio 1.82, mono 1 |
| TRUE | `summer_camp/71_tree_aurora` | `sliderCabinWarmth` | WARMTH | 0.1659 | claim_met | aMean swing 0.0914 ratio 91351.36 (via absolute), hue 0.0000 |
| TRUE | `36_orbital_pulse` | `sliderLocalSpeed` | SPEED | 0.1658 | claim_met | temporalRate 0.0007/0.0014/0.0025/0.0047/0.0087 (ratio 12.83, mono 1); temporalFreq ratio 14.11, mono 1 |
| TRUE | `46_abyssal_fronds` | `sliderBreathDepth` | MAGNITUDE | 0.1624 | claim_met | dominant mover spatialFreqZ 0.1624 |
| TRUE | `37_chevron_chase` | `sliderCount` | SPATIAL | 0.1613 | claim_met | spatialFreqZ swing 0.1486, monotonic 0 [non-monotonic] |
| TRUE | `24_chromatic_murmuration` | `sliderDetail` | SPATIAL | 0.1609 | claim_met | spatialFreqX swing 0.0631, monotonic 0 [non-monotonic] |
| TRUE | `50_phase_cathedral_hd` | `sliderPhaseShift` | MAGNITUDE | 0.1594 | claim_met | dominant mover spatialFreqZ 0.1594 |
| TRUE | `49_cylon_crush` | `sliderKick` | MAGNITUDE | 0.1593 | responds_to_edges_not_to_level | held static the control does nothing, but pulsed 0↔1 at 40 frames it moves driftZ by 0.1594 — this is an edge-triggered control, meant to be driven by a modulation mapping rather than parked at a value |
| TRUE | `14_lunar_current` | `sliderWhiteLift` | WHITE | 0.1578 | claim_met | wMean swing 0.1578 ratio 157830.12 (via absolute, threshold 0.01) |
| TRUE | `64_temple_warm_white` | `sliderLevel` | BRIGHTNESS | 0.1578 | claim_met | outputMean swing 0.0911 ratio 4.17 (via absolute), monotonic 1 |
| TRUE | `31_strobe_lattice` | `sliderScale` | SPATIAL | 0.1570 | claim_met | spatialFreqZ swing 0.1570, monotonic 0 [non-monotonic] |
| TRUE | `54_murmuration_storm` | `sliderLocalSpeed` | SPEED | 0.1547 | claim_met | temporalRate 0.0007/0.0011/0.0016/0.0029/0.0052 (ratio 7.31, mono 1); temporalFreq ratio 2.44, mono 1 |
| TRUE | `31_strobe_lattice` | `sliderLocalSpeed` | SPEED | 0.1540 | claim_met | temporalRate 0.0000/0.0001/0.0001/0.0002/0.0005 (ratio 13.34, mono 1); temporalFreq ratio 2.53, mono 1 |
| TRUE | `61_white_breathe` | `sliderLocalSpeed` | SPEED | 0.1534 | claim_met | temporalRate 0.0002/0.0002/0.0004/0.0006/0.0013 (ratio 7.57, mono 1); temporalFreq ratio 2.63, mono 0 |
| TRUE | `22_abyssal_sway_garden` | `sliderRadius` | SPATIAL | 0.1524 | claim_met | spatialFreqZ swing 0.0232, monotonic 0 [non-monotonic] |
| TRUE | `19_swaying_lattice_ballet` | `sliderKick` | MAGNITUDE | 0.1512 | claim_met | dominant mover contrastRatio 0.1512 |
| TRUE | `20_parametric_sway_field` | `sliderRadius` | SPATIAL | 0.1511 | claim_met | litFraction swing 0.1509, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderSweepImpact` | MAGNITUDE | 0.1509 | claim_met | dominant mover contrastRatio 0.1509 |
| TRUE | `29_kick_shockwave` | `sliderLocalSpeed` | SPEED | 0.1504 | claim_met | temporalRate 0.0020/0.0040/0.0040/0.0060/0.0061 (ratio 3.02, mono 1); temporalFreq ratio 2.83, mono 0 |
| TRUE | `26_dom_dancers_chevron` | `sliderBall1Energy` | MAGNITUDE | 0.1495 | claim_met | dominant mover contrastRatio 0.1495 |
| TRUE | `60_white_wash` | `sliderDirection` | DIRECTION | 0.1492 | claim_met | launch driftY 0.0059/0.0030/-0.0003/-0.0032/-0.0064 (ends 0.0059 → -0.0064, floor ±0.004); velocity-series correlation low↔high 0.704 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `24_chromatic_murmuration` | `sliderRadius` | SPATIAL | 0.1489 | claim_met | spatialFreqZ swing 0.0245, monotonic 0 [non-monotonic] |
| TRUE | `33_aurora_breath` | `sliderBase` | MAGNITUDE | 0.1488 | claim_met | dominant mover rMean 0.1488 |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderTreeSpread` | SPATIAL | 0.1488 | claim_met | edgeSharpnessZ swing 0.0319, monotonic -1 |
| TRUE | `03_dual_axis_crush` | `sliderRadius` | SPATIAL | 0.1481 | claim_met | litFraction swing 0.0836, monotonic 1 |
| TRUE | `21_pelagic_manta_rays` | `sliderKick` | MAGNITUDE | 0.1467 | claim_met | dominant mover rMean 0.1467 |
| TRUE | `27_swipe` | `sliderTrail` | TRAIL | 0.1461 | claim_met | spatialFreqY swing 0.1286 |
| TRUE | `07_shimmer` | `sliderKick` | MAGNITUDE | 0.1459 | claim_met | dominant mover rMean 0.1459 |
| TRUE | `39_tide_riser` | `sliderFoam` | MAGNITUDE | 0.1459 | claim_met | dominant mover litFraction 0.1459 |
| TRUE | `26_dom_dancers_chevron` | `sliderBall2Energy` | MAGNITUDE | 0.1451 | claim_met | dominant mover edgeSharpnessX 0.1451 |
| TRUE | `14_lunar_current` | `sliderDensity` | SPATIAL | 0.1446 | claim_met | spatialFreqY swing 0.1446, monotonic 1 |
| TRUE | `50_phase_cathedral_hd` | `sliderKickLock` | MAGNITUDE | 0.1446 | claim_met | dominant mover spatialFreqZ 0.1446 |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderAudioBass` | MAGNITUDE | 0.1446 | claim_met | dominant mover contrastRatio 0.1446 |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderUvIntensity` | UV | 0.1440 | claim_met | uvMean swing 0.0793 ratio 79250.00 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/80_tree_canopy_fracture` | `sliderLocalSpeed` | SPEED | 0.1439 | claim_met | temporalRate 0.0001/0.0003/0.0005/0.0007/0.0014 (ratio 9.23, mono 1); temporalFreq ratio 5.36, mono 1 |
| TRUE | `32_caustic_shimmer` | `sliderRipple` | MAGNITUDE | 0.1429 | claim_met | dominant mover contrastRatio 0.1429 |
| TRUE | `summer_camp/82_redwood_timber_fall` | `sliderDustGlow` | BRIGHTNESS | 0.1418 | claim_met | outputMean swing 0.0130 ratio 1.40 (via ratio), monotonic 1 |
| TRUE | `26_dom_dancers_chevron` | `sliderLocalSpeed` | SPEED | 0.1406 | claim_met | temporalRate 0.0006/0.0013/0.0028/0.0056/0.0111 (ratio 17.17, mono 1); temporalFreq ratio 6.60, mono 1 |
| TRUE | `21_pelagic_manta_rays` | `sliderUvUndertow` | UV | 0.1396 | claim_met | uvMean swing 0.1396 ratio 139598.89 (via absolute, threshold 0.01) |
| TRUE | `20_parametric_sway_field` | `sliderDirection` | DIRECTION | 0.1383 | claim_met | launch driftY -0.1238/-0.1040/0.0622/0.0720/0.0862 (ends -0.1238 → 0.0862, floor ±0.004); velocity-series correlation low↔high -0.496 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderDirection` | DIRECTION | 0.1363 | claim_met | launch driftY -0.0356/-0.0356/0.0363/0.0363/0.0363 (ends -0.0356 → 0.0363, floor ±0.004); velocity-series correlation low↔high -0.234 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderBlackoutDepth` | DARKNESS | 0.1357 | claim_met | litFraction swing 0.1088 ratio 1.24 (via absolute), monotonic -1 (expected falling) |
| TRUE | `61_white_breathe` | `sliderKick` | MAGNITUDE | 0.1343 | claim_met | dominant mover wMean 0.1343 |
| TRUE | `24_chromatic_murmuration` | `sliderLevel` | BRIGHTNESS | 0.1332 | claim_met | lumaMean swing 0.0193 ratio 2.24 (via ratio), monotonic 1 |
| TRUE | `65_uv_only` | `sliderDirection` | DIRECTION | 0.1326 | claim_met | launch driftY 0.0068/0.0033/-0.0004/-0.0033/-0.0067 (ends 0.0068 → -0.0067, floor ±0.004); velocity-series correlation low↔high -0.447 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `11_bioluminescence` | `sliderKick` | MAGNITUDE | 0.1325 | claim_met | dominant mover contrastRatio 0.1325 |
| TRUE | `24_chromatic_murmuration` | `sliderFlockFocus` | SPATIAL | 0.1323 | claim_met | spatialFreqZ swing 0.1322, monotonic 1 |
| TRUE | `summer_camp/79_mill_pressure_release` | `sliderPressure` | MAGNITUDE | 0.1283 | claim_met | dominant mover temporalFreq 0.1283 |
| TRUE | `13_sparkle` | `sliderWhiteGlint` | WHITE | 0.1277 | claim_met | wMean swing 0.0052 ratio 5177.46 (via ratio, threshold 0.01) |
| TRUE | `04_beat_folded_helix` | `sliderKick` | MAGNITUDE | 0.1269 | claim_met | dominant mover wMean 0.1269 |
| TRUE | `15_silk_prism_ribbons` | `sliderRadius` | SPATIAL | 0.1268 | claim_met | spatialFreqZ swing 0.0888, monotonic 0 [non-monotonic] |
| TRUE | `05_orbital_attractor_field` | `sliderDirection` | DIRECTION | 0.1238 | claim_met | launch driftY -0.0392/-0.0159/0.0108/0.0234/0.0333 (ends -0.0392 → 0.0333, floor ±0.004); velocity-series correlation low↔high 0.375 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `13_sparkle` | `sliderRadius` | SPATIAL | 0.1232 | claim_met | spatialFreqZ swing 0.1232, monotonic 1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderBlackoutDepth` | DARKNESS | 0.1213 | claim_met | litFraction swing 0.1213 ratio 1.68 (via absolute), monotonic -1 (expected falling) |
| TRUE | `63_white_chase` | `sliderTailLength` | TRAIL | 0.1207 | claim_met | edgeSharpnessX swing 0.0733 |
| TRUE | `46_abyssal_fronds` | `sliderLocalSpeed` | SPEED | 0.1181 | claim_met | temporalRate 0.0003/0.0004/0.0006/0.0008/0.0010 (ratio 3.34, mono 1); temporalFreq ratio 1.47, mono 1 |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderBlackoutDepth` | DARKNESS | 0.1175 | claim_met | lumaMean swing 0.0034 ratio 1.28 (via ratio), monotonic -1 (expected falling) |
| TRUE | `16_ghost_tide_uv` | `sliderRadius` | SPATIAL | 0.1169 | claim_met | edgeSharpnessX swing 0.0601, monotonic 1 |
| TRUE | `35_sparkle_rain` | `sliderLocalSpeed` | SPEED | 0.1168 | claim_met | temporalRate 0.0007/0.0008/0.0008/0.0009/0.0011 (ratio 1.52, mono 1); temporalFreq ratio 1.64, mono 0 |
| TRUE | `44_biolume_swell` | `sliderUvGlow` | UV | 0.1167 | claim_met | uvMean swing 0.1167 ratio 116683.46 (via absolute, threshold 0.01) |
| TRUE | `00_golden_hour_wash` | `sliderKick` | MAGNITUDE | 0.1164 | claim_met | dominant mover contrastRatio 0.1164 |
| TRUE | `12_breathing` | `sliderWhiteKick` | WHITE | 0.1160 | claim_met | wMean swing 0.0618 ratio 3.88 (via absolute, threshold 0.01) |
| TRUE | `11_bioluminescence` | `sliderRadius` | SPATIAL | 0.1156 | claim_met | spatialFreqZ swing 0.1156, monotonic 0 [non-monotonic] |
| TRUE | `29_kick_shockwave` | `sliderDecay` | TRAIL | 0.1152 | claim_met | spatialFreqX swing 0.0423 |
| TRUE | `01_cylon_sweep` | `sliderKick` | MAGNITUDE | 0.1150 | claim_met | dominant mover rMean 0.1150 |
| TRUE | `18_deep_space_lattice` | `sliderDetail` | SPATIAL | 0.1132 | claim_met | litFraction swing 0.1132, monotonic -1 |
| TRUE | `45_manta_drift` | `sliderDepth` | MAGNITUDE | 0.1129 | claim_met | dominant mover spatialFreqY 0.1129 |
| TRUE | `45_manta_drift` | `sliderSpan` | SPATIAL | 0.1124 | claim_met | spatialFreqY swing 0.0800, monotonic -1 |
| TRUE | `63_white_chase` | `sliderWhiteKick` | WHITE | 0.1116 | claim_met | wMean swing 0.1116 ratio 1.90 (via absolute, threshold 0.01) |
| TRUE | `19_swaying_lattice_ballet` | `sliderLocalSpeed` | SPEED | 0.1115 | claim_met | temporalRate 0.0012/0.0020/0.0038/0.0073/0.0134 (ratio 11.44, mono 1); temporalFreq ratio 10.16, mono 1 |
| TRUE | `summer_camp/79_mill_pressure_release` | `sliderBoilerHeat` | MAGNITUDE | 0.1093 | claim_met | dominant mover spatialFreqZ 0.1093 |
| TRUE | `08_ocean_liner` | `sliderKick` | MAGNITUDE | 0.1092 | claim_met | dominant mover rMean 0.1092 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderProngSpread` | SPATIAL | 0.1092 | claim_met | litFraction swing 0.1092, monotonic 0 [non-monotonic] |
| TRUE | `42_phyllotaxis_spiral` | `sliderLocalSpeed` | SPEED | 0.1087 | claim_met | temporalRate 0.0000/0.0000/0.0001/0.0001/0.0001 (ratio 7.14, mono 1); temporalFreq ratio 12820.51, mono 1 |
| TRUE | `18_deep_space_lattice` | `sliderKick` | MAGNITUDE | 0.1085 | claim_met | dominant mover rMean 0.1085 |
| TRUE | `39_tide_riser` | `sliderLocalSpeed` | SPEED | 0.1083 | claim_met | temporalRate 0.0002/0.0003/0.0006/0.0012/0.0022 (ratio 12.08, mono 1); temporalFreq ratio 13.15, mono 1 |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderBreathRate` | SPEED | 0.1063 | claim_met | temporalRate 0.0001/0.0004/0.0007/0.0010/0.0013 (ratio 12.21, mono 1); temporalFreq ratio 4.90, mono 1 |
| TRUE | `38_prism_helix` | `sliderLocalSpeed` | SPEED | 0.1058 | claim_met | temporalRate 0.0010/0.0017/0.0024/0.0041/0.0074 (ratio 7.16, mono 1); temporalFreq ratio 2.79, mono 0 |
| TRUE | `transitions/trans_wipe_down` | `sliderFeather` | SPATIAL | 0.1047 | claim_met | spatialFreqY swing 0.0417, monotonic 1 |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderBlackoutDepth` | DARKNESS | 0.1044 | claim_met | litFraction swing 0.0526 ratio 1.47 (via absolute), monotonic -1 (expected falling) |
| TRUE | `13_sparkle` | `sliderWhiteLevel` | WHITE | 0.1039 | claim_met | wMean swing 0.0034 ratio 4.84 (via ratio, threshold 0.01) |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderDripTrail` | TRAIL | 0.1038 | claim_met | spatialFreqY swing 0.0399 |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderBlackoutDepth` | DARKNESS | 0.1034 | claim_met | litFraction swing 0.0267 ratio 1.35 (via absolute), monotonic -1 (expected falling) |
| TRUE | `22_abyssal_sway_garden` | `sliderKick` | MAGNITUDE | 0.1033 | claim_met | dominant mover contrastRatio 0.1033 |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderBlackoutDepth` | DARKNESS | 0.1029 | claim_met | litFraction swing 0.0339 ratio 1.04 (via absolute), monotonic -1 (expected falling) |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderVintageMix` | MAGNITUDE | 0.1021 | claim_met | dominant mover spatialFreqY 0.1021 |
| TRUE | `18_deep_space_lattice` | `sliderRadius` | SPATIAL | 0.1017 | claim_met | spatialFreqZ swing 0.0248, monotonic 0 [non-monotonic] |
| TRUE | `transitions/trans_wave_sweep` | `sliderWaveAmp` | MAGNITUDE | 0.0996 | claim_met | dominant mover spatialFreqY 0.0996 |
| TRUE | `36_orbital_pulse` | `sliderBase` | MAGNITUDE | 0.0990 | claim_met | dominant mover rMean 0.0991 |
| TRUE | `45_manta_drift` | `sliderLocalSpeed` | SPEED | 0.0988 | claim_met | temporalRate 0.0001/0.0002/0.0004/0.0007/0.0008 (ratio 7.18, mono 1); temporalFreq ratio 1.45, mono 0 |
| TRUE | `14_lunar_current` | `sliderLocalSpeed` | SPEED | 0.0975 | claim_met | temporalRate 0.0005/0.0010/0.0021/0.0035/0.0069 (ratio 14.66, mono 1); temporalFreq ratio 4.44, mono 1 |
| TRUE | `summer_camp/85_redwood_starry_canopy` | `sliderBlackoutDepth` | DARKNESS | 0.0974 | claim_met | litFraction swing 0.0349 ratio 1.04 (via absolute), monotonic -1 (expected falling) |
| TRUE | `60_white_wash` | `sliderKick` | MAGNITUDE | 0.0970 | claim_met | dominant mover wMean 0.0970 |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderImpact` | MAGNITUDE | 0.0957 | claim_met | dominant mover spatialFreqY 0.0957 |
| TRUE | `64_temple_warm_white` | `sliderWhiteKick` | WHITE | 0.0955 | claim_met | wMean swing 0.0955 ratio 1.73 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderAudioBass` | MAGNITUDE | 0.0942 | claim_met | dominant mover rMean 0.0942 |
| TRUE | `transitions/trans_wipe_left` | `sliderFeather` | SPATIAL | 0.0917 | claim_met | edgeSharpnessZ swing 0.0246, monotonic -1 |
| TRUE | `13_sparkle` | `sliderWhiteKick` | WHITE | 0.0915 | claim_met | wMean swing 0.0041 ratio 2.60 (via ratio, threshold 0.01) |
| TRUE | `00_golden_hour_wash` | `sliderWarmth` | WARMTH | 0.0913 | claim_met | rMean swing 0.0842 ratio 1.34 (via absolute), hue 0.0000 |
| TRUE | `15_silk_prism_ribbons` | `sliderDirection` | DIRECTION | 0.0910 | claim_met | launch driftZ -0.0064/0.0338/0.0243/0.0013/-0.0141 (ends -0.0064 → -0.0141, floor ±0.004); velocity-series correlation low↔high -0.378 (reversal at ≤ -0.3) [via anticorrelated_motion] |
| TRUE | `10_chasers` | `sliderDirection` | DIRECTION | 0.0909 | claim_met | launch driftZ 0.1380/0.1380/-0.0083/-0.0083/-0.0083 (ends 0.1380 → -0.0083, floor ±0.004); velocity-series correlation low↔high 0.080 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderUvIntensity` | UV | 0.0906 | claim_met | uvMean swing 0.0906 ratio 90578.31 (via absolute, threshold 0.01) |
| TRUE | `transitions/trans_split_horizontal` | `sliderFeather` | SPATIAL | 0.0899 | claim_met | spatialFreqZ swing 0.0601, monotonic -1 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderOrbitDrift` | MAGNITUDE | 0.0898 | claim_met | dominant mover driftZ 0.0898 |
| TRUE | `summer_camp/74_lookout_gyro_vortex` | `sliderUvIntensity` | UV | 0.0893 | claim_met | uvMean swing 0.0231 ratio 23077.30 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/65_dome_kick_shockwave` | `sliderLocalSpeed` | SPEED | 0.0880 | claim_met | temporalRate 0.0008/0.0015/0.0031/0.0057/0.0057 (ratio 7.51, mono 1); temporalFreq ratio 5.14, mono 1 |
| TRUE | `63_white_chase` | `sliderRadius` | SPATIAL | 0.0880 | claim_met | edgeSharpnessX swing 0.0590, monotonic 1 |
| TRUE | `summer_camp/41_ghost_aurora` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0050 ratio 5002.35 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/42_boiler_glow` | `sliderBoilerHeat` | MAGNITUDE | 0.0870 | claim_met | dominant mover spatialFreqX 0.0870 |
| TRUE | `summer_camp/42_boiler_glow` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0025 ratio 2501.18 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/45_engine_room_clockwork` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0050 ratio 5002.35 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/46_dome_lockdown` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0034 ratio 3375.43 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/47_apex_perimeter_ping` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0042 ratio 4168.63 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/49_boiler_pressure_release` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0067 ratio 6669.80 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/51_abyssal_searchlight` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0033 ratio 3334.90 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/52_iceberg_shear_line` | `sliderSubmergeDepth` | MAGNITUDE | 0.0870 | claim_met | dominant mover spatialFreqX 0.0870 |
| TRUE | `summer_camp/53_shadow_eclipse` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0017 ratio 1667.45 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/54_boiler_fire_overdrive` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0033 ratio 3334.90 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/55_stardust_dome` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0025 ratio 2501.18 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/56_stage_mirror_axis` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0058 ratio 5836.08 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0042 ratio 4168.63 (via ratio), monotonic -1 (expected falling) |
| TRUE | `21_pelagic_manta_rays` | `sliderDirection` | DIRECTION | 0.0867 | claim_met | launch driftY -0.0711/-0.0711/0.0045/0.0045/0.0045 (ends -0.0711 → 0.0045, floor ±0.004); velocity-series correlation low↔high 0.080 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `transitions/trans_diamond_wipe` | `sliderFeather` | SPATIAL | 0.0856 | claim_met | edgeSharpnessY swing 0.0304, monotonic -1 |
| TRUE | `45_manta_drift` | `sliderFoam` | MAGNITUDE | 0.0852 | claim_met | dominant mover driftY 0.0852 |
| TRUE | `52_silk_ribbons` | `sliderShimmer` | MAGNITUDE | 0.0845 | claim_met | dominant mover contrastRatio 0.0845 |
| TRUE | `transitions/trans_wipe_right` | `sliderFeather` | SPATIAL | 0.0841 | claim_met | spatialFreqY swing 0.0498, monotonic 1 |
| TRUE | `summer_camp/79_mill_pressure_release` | `sliderVentFlash` | MAGNITUDE | 0.0841 | claim_met | dominant mover driftX 0.0841 |
| TRUE | `transitions/trans_wave_sweep` | `sliderFeather` | SPATIAL | 0.0838 | claim_met | spatialFreqY swing 0.0453, monotonic 1 |
| TRUE | `33_aurora_breath` | `sliderLocalSpeed` | SPEED | 0.0836 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0006/0.0013 (ratio 10.56, mono 1); temporalFreq ratio 1.45, mono 0 |
| TRUE | `15_silk_prism_ribbons` | `sliderLocalSpeed` | SPEED | 0.0835 | claim_met | temporalRate 0.0005/0.0009/0.0018/0.0039/0.0077 (ratio 15.54, mono 1); temporalFreq ratio 6.27, mono 1 |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderSectionCount` | SPATIAL | 0.0830 | claim_met | spatialFreqZ swing 0.0251, monotonic 1 |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderLocalSpeed` | SPEED | 0.0826 | claim_met | temporalRate 0.0000/0.0001/0.0002/0.0005/0.0012 (ratio 29.20, mono 1); temporalFreq ratio 9.21, mono 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderCounterPhase` | MAGNITUDE | 0.0822 | claim_met | dominant mover driftX 0.0822 |
| TRUE | `40_lissajous_weave` | `sliderSpread` | SPATIAL | 0.0820 | claim_met | litFraction swing 0.0820, monotonic 0 [non-monotonic] |
| TRUE | `transitions/trans_split_vertical` | `sliderFeather` | SPATIAL | 0.0814 | claim_met | spatialFreqY swing 0.0423, monotonic -1 |
| TRUE | `summer_camp/84_outpost_ember_overdrive` | `sliderFlashRate` | SPEED | 0.0790 | claim_met | temporalRate 0.0004/0.0005/0.0005/0.0005/0.0005 (ratio 1.26, mono 1); temporalFreq ratio 1.09, mono 0 |
| TRUE | `15_silk_prism_ribbons` | `sliderKick` | MAGNITUDE | 0.0777 | claim_met | dominant mover rMean 0.0777 |
| TRUE | `46_abyssal_fronds` | `sliderBreathRate` | SPEED | 0.0773 | claim_met | temporalRate 0.0005/0.0005/0.0006/0.0006/0.0009 (ratio 1.84, mono 1); temporalFreq ratio 1.91, mono 1 |
| TRUE | `11_bioluminescence` | `sliderWhiteLevel` | WHITE | 0.0771 | claim_met | wMean swing 0.0441 ratio 4.20 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderLocalSpeed` | SPEED | 0.0760 | claim_met | temporalRate 0.0015/0.0019/0.0025/0.0036/0.0071 (ratio 4.62, mono 1); temporalFreq ratio 5.33, mono 1 |
| TRUE | `23_prismatic_strange_attractors` | `sliderDetail` | SPATIAL | 0.0758 | claim_met | spatialFreqY swing 0.0758, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderVintageMix` | MAGNITUDE | 0.0755 | claim_met | dominant mover spatialFreqZ 0.0755 |
| TRUE | `10_chasers` | `sliderRadius` | SPATIAL | 0.0751 | claim_met | litFraction swing 0.0751, monotonic 1 |
| TRUE | `43_golden_hour_pulse` | `sliderShimmer` | MAGNITUDE | 0.0750 | claim_met | dominant mover driftY 0.0750 |
| TRUE | `21_pelagic_manta_rays` | `sliderWhiteFoam` | WHITE | 0.0731 | claim_met | wMean swing 0.0731 ratio 73137.32 (via absolute, threshold 0.01) |
| TRUE | `31_strobe_lattice` | `sliderFlash` | MAGNITUDE | 0.0731 | claim_met | dominant mover spatialFreqZ 0.0731 |
| TRUE | `16_ghost_tide_uv` | `sliderKick` | MAGNITUDE | 0.0720 | claim_met | dominant mover edgeSharpnessX 0.0720 |
| TRUE | `64_temple_warm_white` | `sliderDirection` | DIRECTION | 0.0719 | claim_met | launch driftY -0.0005/-0.0008/-0.0011/-0.0015/-0.0018 (ends -0.0005 → -0.0018, floor ±0.004); velocity-series correlation low↔high -0.544 (reversal at ≤ -0.3) [via anticorrelated_motion] |
| TRUE | `62_white_shimmer` | `sliderWhiteKick` | WHITE | 0.0712 | claim_met | wMean swing 0.0712 ratio 2.06 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/73_tree_shadow_breath` | `sliderLocalSpeed` | SPEED | 0.0705 | claim_met | temporalRate 0.0002/0.0003/0.0004/0.0007/0.0014 (ratio 6.72, mono 1); temporalFreq ratio 2.46, mono 0 |
| TRUE | `summer_camp/71_tree_aurora` | `sliderUvIntensity` | UV | 0.0700 | claim_met | uvMean swing 0.0385 ratio 38509.12 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderShimmer` | MAGNITUDE | 0.0682 | claim_met | dominant mover contrastRatio 0.0682 |
| TRUE | `22_abyssal_sway_garden` | `sliderDirection` | DIRECTION | 0.0681 | claim_met | launch driftX 0.0040/0.0040/-0.0094/-0.0094/-0.0094 (ends 0.0040 → -0.0094, floor ±0.004); velocity-series correlation low↔high 0.215 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `19_swaying_lattice_ballet` | `sliderDirection` | DIRECTION | 0.0677 | claim_met | launch driftZ 0.0152/0.0757/-0.0287/-0.0461/-0.0459 (ends 0.0152 → -0.0459, floor ±0.004); velocity-series correlation low↔high -0.324 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderVintageWash` | MAGNITUDE | 0.0676 | claim_met | dominant mover spatialFreqY 0.0676 |
| TRUE | `04_beat_folded_helix` | `sliderCount` | SPATIAL | 0.0655 | claim_met | spatialFreqY swing 0.0655, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderAudioBass` | MAGNITUDE | 0.0652 | claim_met | dominant mover contrastRatio 0.0652 |
| TRUE | `19_swaying_lattice_ballet` | `sliderWhiteKick` | WHITE | 0.0651 | claim_met | wMean swing 0.0493 ratio 3.09 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderBlackoutDepth` | DARKNESS | 0.0636 | claim_met | litFraction swing 0.0353 ratio 1.04 (via absolute), monotonic -1 (expected falling) |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderBeaconSparkle` | MAGNITUDE | 0.0621 | claim_met | dominant mover driftX 0.0620 |
| TRUE | `29_kick_shockwave` | `sliderKick` | MAGNITUDE | 0.0620 | responds_to_edges_not_to_level | held static the control does nothing, but pulsed 0↔1 at 40 frames it moves driftY by 0.0620 — this is an edge-triggered control, meant to be driven by a modulation mapping rather than parked at a value |
| TRUE | `63_white_chase` | `sliderKick` | MAGNITUDE | 0.0615 | claim_met | dominant mover hueMean 0.0615 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderEmberDepth` | MAGNITUDE | 0.0598 | claim_met | dominant mover contrastRatio 0.0598 |
| TRUE | `04_beat_folded_helix` | `sliderLocalSpeed` | SPEED | 0.0586 | claim_met | temporalRate 0.0007/0.0015/0.0028/0.0061/0.0120 (ratio 18.38, mono 1); temporalFreq ratio 8.41, mono 1 |
| TRUE | `04_beat_folded_helix` | `sliderRadius` | SPATIAL | 0.0583 | claim_met | spatialFreqX swing 0.0583, monotonic 0 [non-monotonic] |
| TRUE | `38_prism_helix` | `sliderShimmer` | MAGNITUDE | 0.0582 | claim_met | dominant mover temporalFreq 0.0582 |
| TRUE | `summer_camp/65_dome_kick_shockwave` | `sliderShockSpeed` | SPEED | 0.0575 | claim_met | temporalRate 0.0026/0.0029/0.0030/0.0033/0.0034 (ratio 1.31, mono 1); temporalFreq ratio 1.29, mono 1 |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderAudioKick` | MAGNITUDE | 0.0575 | claim_met | dominant mover contrastRatio 0.0575 |
| TRUE | `transitions/trans_ripple_in` | `sliderRingDamping` | SPATIAL | 0.0565 | claim_met | spatialFreqZ swing 0.0242, monotonic 1 |
| TRUE | `44_biolume_swell` | `sliderLocalSpeed` | SPEED | 0.0542 | claim_met | temporalRate 0.0007/0.0011/0.0017/0.0029/0.0049 (ratio 7.32, mono 1); temporalFreq ratio 6.26, mono 1 |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderBlackoutDepth` | DARKNESS | 0.0541 | claim_met | litFraction swing 0.0213 ratio 1.02 (via absolute), monotonic -1 (expected falling) |
| TRUE | `62_white_shimmer` | `sliderKick` | MAGNITUDE | 0.0519 | claim_met | dominant mover litFraction 0.0519 |
| TRUE | `51_confetti_cyclone` | `sliderKick` | MAGNITUDE | 0.0517 | claim_met | dominant mover litFraction 0.0517 |
| TRUE | `19_swaying_lattice_ballet` | `sliderRadius` | SPATIAL | 0.0493 | claim_met | spatialFreqZ swing 0.0371, monotonic 0 [non-monotonic] |
| TRUE | `14_lunar_current` | `sliderKick` | MAGNITUDE | 0.0488 | claim_met | dominant mover edgeSharpnessZ 0.0488 |
| TRUE | `19_swaying_lattice_ballet` | `sliderWhiteLevel` | WHITE | 0.0486 | claim_met | wMean swing 0.0274 ratio 3.75 (via absolute, threshold 0.01) |
| TRUE | `42_phyllotaxis_spiral` | `sliderTwinkle` | MAGNITUDE | 0.0459 | claim_met | dominant mover spatialFreqZ 0.0459 |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderCrownImpact` | MAGNITUDE | 0.0441 | claim_met | dominant mover contrastRatio 0.0441 |
| TRUE | `34_moire_interference` | `sliderPulse` | MAGNITUDE | 0.0436 | claim_met | dominant mover rMean 0.0436 |
| TRUE | `11_bioluminescence` | `sliderWhiteKick` | WHITE | 0.0427 | claim_met | wMean swing 0.0232 ratio 1.96 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderNeighborWeight` | MAGNITUDE | 0.0425 | claim_met | dominant mover contrastRatio 0.0425 |
| TRUE | `23_prismatic_strange_attractors` | `sliderKick` | MAGNITUDE | 0.0422 | claim_met | dominant mover driftY 0.0422 |
| TRUE | `14_lunar_current` | `sliderShimmer` | MAGNITUDE | 0.0402 | claim_met | dominant mover spatialFreqX 0.0402 |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderAudioKick` | MAGNITUDE | 0.0401 | responds_to_edges_not_to_level | held static the control does nothing, but pulsed 0↔1 at 40 frames it moves contrastRatio by 0.0401 — this is an edge-triggered control, meant to be driven by a modulation mapping rather than parked at a value |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderWoodSparkle` | MAGNITUDE | 0.0389 | claim_met | dominant mover temporalRate 0.0389 |
| TRUE | `35_sparkle_rain` | `sliderKick` | MAGNITUDE | 0.0380 | claim_met | dominant mover temporalFreq 0.0380 |
| TRUE | `21_pelagic_manta_rays` | `sliderDetail` | SPATIAL | 0.0365 | claim_met | spatialFreqZ swing 0.0308, monotonic -1 |
| TRUE | `summer_camp/85_redwood_starry_canopy` | `sliderWallHit` | MAGNITUDE | 0.0363 | claim_met | dominant mover contrastRatio 0.0363 |
| TRUE | `13_sparkle` | `sliderUvGlint` | UV | 0.0353 | claim_met | uvMean swing 0.0026 ratio 2573.02 (via ratio, threshold 0.01) |
| TRUE | `22_abyssal_sway_garden` | `sliderDetail` | SPATIAL | 0.0342 | claim_met | spatialFreqY swing 0.0202, monotonic -1 |
| TRUE | `12_breathing` | `sliderWhiteLevel` | WHITE | 0.0337 | claim_met | wMean swing 0.0286 ratio 4.32 (via absolute, threshold 0.01) |
| TRUE | `07_shimmer` | `sliderWhiteLevel` | WHITE | 0.0331 | claim_met | wMean swing 0.0223 ratio 3.99 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/80_tree_canopy_fracture` | `sliderBlackoutDepth` | DARKNESS | 0.0323 | claim_met | litFraction swing 0.0130 ratio 1.32 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderArmPhase` | MAGNITUDE | 0.0305 | claim_met | dominant mover contrastRatio 0.0305 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderAudioKick` | MAGNITUDE | 0.0288 | claim_met | dominant mover contrastRatio 0.0288 |
| TRUE | `51_confetti_cyclone` | `sliderHigh` | MAGNITUDE | 0.0282 | claim_met | dominant mover contrastRatio 0.0282 |
| TRUE | `08_ocean_liner` | `sliderWhiteSpread` | WHITE | 0.0275 | claim_met | wMean swing 0.0259 ratio 2.58 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/79_mill_pressure_release` | `sliderLocalSpeed` | SPEED | 0.0272 | claim_met | temporalRate 0.0002/0.0002/0.0002/0.0002/0.0003 (ratio 1.36, mono 1); temporalFreq ratio 1.34, mono 0 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderAudioBass` | MAGNITUDE | 0.0271 | claim_met | dominant mover contrastRatio 0.0271 |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderBoilerHeat` | MAGNITUDE | 0.0254 | claim_met | dominant mover spatialFreqY 0.0254 |
| TRUE | `64_temple_warm_white` | `sliderKick` | MAGNITUDE | 0.0252 | claim_met | dominant mover wMean 0.0252 |
| TRUE | `08_ocean_liner` | `sliderWhiteKick` | WHITE | 0.0241 | claim_met | wMean swing 0.0241 ratio 3.64 (via absolute, threshold 0.01) |
| TRUE | `44_biolume_swell` | `sliderKick` | MAGNITUDE | 0.0238 | claim_met | dominant mover rMean 0.0238 |
| TRUE | `summer_camp/48_titanic_sos_beacon` | `sliderBrightness` | BRIGHTNESS | 0.0235 | claim_met | lumaMean swing 0.0050 ratio 4.00 (via ratio), monotonic 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderWhiteSpread` | WHITE | 0.0230 | claim_met | wMean swing 0.0130 ratio 1.76 (via absolute, threshold 0.01) |
| TRUE | `03_dual_axis_crush` | `sliderKick` | MAGNITUDE | 0.0229 | claim_met | dominant mover rMean 0.0229 |
| TRUE | `40_lissajous_weave` | `sliderKick` | MAGNITUDE | 0.0224 | claim_met | dominant mover driftY 0.0224 |
| TRUE | `summer_camp/73_tree_shadow_breath` | `sliderEdgeShimmer` | MAGNITUDE | 0.0215 | claim_met | dominant mover temporalFreq 0.0215 |
