# Parameter truth sweep

Model `titanic` (964 px) · 144 frames after 36 warmup · sweep points 0, 0.25, 0.5, 0.75, 1

Patterns swept 125 · compile errors 0 · no params 26 · params measured 817

| Class | Count |
|---|---:|
| WRONG | 47 |
| DEAD | 112 |
| WEAK | 37 |
| UNKNOWN_CLAIM | 42 |
| TRUE | 579 |

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

## DEAD on `titanic` but ALIVE on `test_bench`

These controls are wired correctly. The code path they drive is not reachable on `titanic` — usually a `sectionId` / `fixtureType` gate the show model does not satisfy. Fix the model coverage or the gate, not the slider.

| Pattern | Param | Verdict elsewhere | Effect elsewhere |
|---|---|---|---:|
| `summer_camp/55_stardust_dome` | `sliderRingWidth` | TRUE | 0.06698 |
| `summer_camp/51_abyssal_searchlight` | `sliderSwirlMix` | WEAK | 0.0073 |
| `summer_camp/45_engine_room_clockwork` | `sliderBoilerHeat` | WEAK | 0.00591 |
| `summer_camp/56_stage_mirror_axis` | `sliderParticleDensity` | TRUE | 0.09092 |
| `summer_camp/50_iceberg_fracture` | `sliderBranchSpread` | TRUE | 0.16946 |
| `summer_camp/55_stardust_dome` | `sliderOrbitSpeed` | TRUE | 0.07605 |
| `summer_camp/55_stardust_dome` | `sliderParticleDensity` | TRUE | 0.26838 |
| `summer_camp/81_outpost_distress_beacon` | `sliderBlackoutDepth` | WRONG | 0.04348 |
| `45_manta_drift` | `sliderDepth` | TRUE | 0.02627 |
| `summer_camp/55_stardust_dome` | `sliderLocalSpeed` | TRUE | 0.23339 |
| `summer_camp/56_stage_mirror_axis` | `sliderStageFocus` | TRUE | 0.28872 |
| `00_golden_hour_wash` | `sliderWhiteLevel` | WRONG | 0.04975 |
| `00_golden_hour_wash` | `sliderWhiteKick` | TRUE | 0.27429 |
| `00_golden_hour_wash` | `sliderWhiteWarmth` | WRONG | 0.04533 |
| `01_cylon_sweep` | `sliderWhiteLevel` | TRUE | 0.13164 |
| `01_cylon_sweep` | `sliderWhiteKick` | TRUE | 0.17391 |
| `01_cylon_sweep` | `sliderBlinderBite` | WEAK | 0.01732 |
| `05_orbital_attractor_field` | `sliderKick` | TRUE | 0.31126 |
| `05_orbital_attractor_field` | `sliderFalloff` | UNKNOWN_CLAIM | 0.03509 |
| `05_orbital_attractor_field` | `sliderWhiteLevel` | WEAK | 0.00681 |
| `06_neon_elevator` | `sliderKick` | TRUE | 0.08213 |
| `06_neon_elevator` | `sliderSteps` | UNKNOWN_CLAIM | 0.06814 |
| `06_neon_elevator` | `sliderWhiteLevel` | TRUE | 0.05646 |
| `06_neon_elevator` | `sliderWhiteKick` | TRUE | 0.06706 |
| `06_neon_elevator` | `sliderBlinderBite` | TRUE | 0.02393 |
| `09_cyclone` | `sliderBlinderBite` | TRUE | 0.06532 |
| `12_breathing` | `sliderBlinderBite` | TRUE | 0.3058 |
| `17_rolling_color_dunes` | `sliderKick` | TRUE | 0.25845 |
| `17_rolling_color_dunes` | `sliderStageSurf` | UNKNOWN_CLAIM | 0.08588 |
| `17_rolling_color_dunes` | `sliderAmberWarmth` | WRONG | 0.03815 |
| `17_rolling_color_dunes` | `sliderWhiteLevel` | TRUE | 0.08122 |
| `25_heartbeat` | `sliderBlinder` | TRUE | 0.17733 |
| `25_heartbeat` | `sliderBlinderBite` | TRUE | 0.05958 |
| `28_spectrum_bloom` | `sliderMid` | WEAK | 0.01926 |
| `28_spectrum_bloom` | `sliderHigh` | TRUE | 0.03696 |
| `36_orbital_pulse` | `sliderPulse` | TRUE | 0.08417 |
| `43_golden_hour_pulse` | `sliderBlinder` | TRUE | 0.08934 |
| `summer_camp/41_ghost_aurora` | `sliderCurtainWidth` | TRUE | 0.38292 |
| `summer_camp/41_ghost_aurora` | `sliderDriftChaos` | TRUE | 0.07264 |
| `summer_camp/41_ghost_aurora` | `sliderTriangleGain` | TRUE | 0.24095 |
| `summer_camp/42_boiler_glow` | `sliderVentWidth` | TRUE | 0.18394 |
| `summer_camp/42_boiler_glow` | `sliderSteamFlash` | TRUE | 0.08637 |
| `summer_camp/42_boiler_glow` | `sliderTriangleRPM` | TRUE | 0.28385 |
| `summer_camp/42_boiler_glow` | `sliderFlashRate` | TRUE | 0.06906 |
| `summer_camp/43_sea_floor_shadow` | `sliderShadowWidth` | WRONG | 0.04671 |
| `summer_camp/43_sea_floor_shadow` | `sliderShadowDrift` | WRONG | 0.05256 |
| `summer_camp/43_sea_floor_shadow` | `sliderEdgeFoam` | TRUE | 0.03178 |
| `summer_camp/43_sea_floor_shadow` | `sliderTriangleSilhouette` | UNKNOWN_CLAIM | 0.05833 |
| `summer_camp/45_engine_room_clockwork` | `sliderPistonStroke` | UNKNOWN_CLAIM | 0.00617 |
| `summer_camp/46_dome_lockdown` | `sliderDirection` | TRUE | 0.50708 |
| `summer_camp/46_dome_lockdown` | `sliderBeaconWidth` | WRONG | 0.18563 |
| `summer_camp/46_dome_lockdown` | `sliderBeaconPunch` | TRUE | 0.22391 |
| `summer_camp/46_dome_lockdown` | `sliderStrobeRate` | TRUE | 0.27081 |
| `summer_camp/47_apex_perimeter_ping` | `sliderLocalSpeed` | TRUE | 0.1793 |
| `summer_camp/47_apex_perimeter_ping` | `sliderPingWidth` | TRUE | 0.29573 |
| `summer_camp/47_apex_perimeter_ping` | `sliderGhostMix` | TRUE | 0.04831 |
| `summer_camp/47_apex_perimeter_ping` | `sliderRingEcho` | TRUE | 0.10688 |
| `summer_camp/48_titanic_sos_beacon` | `sliderSignalStrength` | TRUE | 0.02309 |
| `summer_camp/48_titanic_sos_beacon` | `sliderSearchlightSweep` | UNKNOWN_CLAIM | 0.02048 |
| `summer_camp/48_titanic_sos_beacon` | `sliderWashBrightness` | TRUE | 1.22002 |
| `summer_camp/49_boiler_pressure_release` | `sliderVentWidth` | WRONG | 0.03226 |
| `summer_camp/50_iceberg_fracture` | `sliderLaneCount` | WEAK | 0.01683 |
| `summer_camp/50_iceberg_fracture` | `sliderShardJag` | UNKNOWN_CLAIM | 0.03263 |
| `summer_camp/51_abyssal_searchlight` | `sliderBeamPunch` | TRUE | 0.26452 |
| `summer_camp/51_abyssal_searchlight` | `sliderTrailLength` | TRUE | 0.14944 |
| `summer_camp/54_boiler_fire_overdrive` | `sliderFlameHeight` | WRONG | 0.12978 |
| `summer_camp/55_stardust_dome` | `sliderStarCore` | TRUE | 0.16999 |
| `summer_camp/56_stage_mirror_axis` | `sliderUvEdge` | TRUE | 0.05078 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderArmCount` | WEAK | 0.01561 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderSeedSize` | WEAK | 0.0157 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderBreathDepth` | TRUE | 0.02446 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderCenterImpact` | TRUE | 0.02114 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderVoidDepth` | WEAK | 0.01718 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderPetalSharpness` | TRUE | 0.12514 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderShockwavePower` | TRUE | 0.49874 |
| `summer_camp/65_dome_kick_shockwave` | `sliderRingWidth` | TRUE | 0.35197 |
| `summer_camp/65_dome_kick_shockwave` | `sliderEchoes` | UNKNOWN_CLAIM | 0.27502 |
| `summer_camp/82_redwood_timber_fall` | `sliderLocalSpeed` | TRUE | 0.46853 |
| `summer_camp/82_redwood_timber_fall` | `sliderFallDuration` | UNKNOWN_CLAIM | 0.06496 |
| `summer_camp/82_redwood_timber_fall` | `sliderStandBrightness` | TRUE | 0.46859 |

## Punch-list by pattern (WRONG + DEAD)

- `05_orbital_attractor_field` — 8: `sliderKick` (DEAD), `sliderFalloff` (DEAD), `sliderFocus` (DEAD), `sliderColorVariation` (WRONG), `sliderBlackoutTexture` (WRONG), `sliderWhiteLevel` (DEAD), `sliderWhiteKick` (DEAD), `sliderBlinderBite` (DEAD)
- `17_rolling_color_dunes` — 7: `sliderDirection` (WRONG), `sliderKick` (DEAD), `sliderStageSurf` (DEAD), `sliderAmberWarmth` (DEAD), `sliderWhiteLevel` (DEAD), `sliderWhiteKick` (DEAD), `sliderBlinderBite` (DEAD)
- `summer_camp/63_dome_phyllotaxis_bloom` — 7: `sliderArmCount` (DEAD), `sliderSeedSize` (DEAD), `sliderBreathDepth` (DEAD), `sliderCenterImpact` (DEAD), `sliderVoidDepth` (DEAD), `sliderPetalSharpness` (DEAD), `sliderShockwavePower` (DEAD)
- `06_neon_elevator` — 6: `sliderDirection` (WRONG), `sliderKick` (DEAD), `sliderSteps` (DEAD), `sliderWhiteLevel` (DEAD), `sliderWhiteKick` (DEAD), `sliderBlinderBite` (DEAD)
- `summer_camp/42_boiler_glow` — 6: `sliderLocalSpeed` (WRONG), `sliderFlickerComplexity` (DEAD), `sliderVentWidth` (DEAD), `sliderSteamFlash` (DEAD), `sliderTriangleRPM` (DEAD), `sliderFlashRate` (DEAD)
- `summer_camp/47_apex_perimeter_ping` — 6: `sliderLocalSpeed` (DEAD), `sliderPingWidth` (DEAD), `sliderGhostMix` (DEAD), `sliderCoronaImpact` (DEAD), `sliderTrailDecay` (DEAD), `sliderRingEcho` (DEAD)
- `summer_camp/48_titanic_sos_beacon` — 6: `sliderSignalStrength` (DEAD), `sliderEchoDelay` (DEAD), `sliderEchoWidth` (DEAD), `sliderEdgeSoftness` (WRONG), `sliderSearchlightSweep` (DEAD), `sliderWashBrightness` (DEAD)
- `summer_camp/46_dome_lockdown` — 5: `sliderDirection` (DEAD), `sliderBeaconWidth` (DEAD), `sliderBeaconPunch` (DEAD), `sliderStrobeRate` (DEAD), `sliderAlarmCadence` (DEAD)
- `summer_camp/55_stardust_dome` — 5: `sliderLocalSpeed` (DEAD), `sliderStarCore` (DEAD), `sliderParticleDensity` (DEAD), `sliderOrbitSpeed` (DEAD), `sliderRingWidth` (DEAD)
- `summer_camp/56_stage_mirror_axis` — 5: `sliderMirrorWidth` (WRONG), `sliderParticleDensity` (DEAD), `sliderStageFocus` (DEAD), `sliderUvEdge` (DEAD), `sliderCenterGuide` (DEAD)
- `01_cylon_sweep` — 4: `sliderDirection` (WRONG), `sliderWhiteLevel` (DEAD), `sliderWhiteKick` (DEAD), `sliderBlinderBite` (DEAD)
- `13_sparkle` — 4: `sliderRadius` (WRONG), `sliderSparkleIntensity` (WRONG), `sliderSparkleSize` (WRONG), `sliderAmberGlint` (DEAD)
- `22_abyssal_sway_garden` — 4: `sliderDirection` (WRONG), `sliderDetail` (WRONG), `sliderTipGlow` (WRONG), `sliderBaseDarkness` (WRONG)
- `summer_camp/43_sea_floor_shadow` — 4: `sliderShadowWidth` (DEAD), `sliderShadowDrift` (DEAD), `sliderEdgeFoam` (DEAD), `sliderTriangleSilhouette` (DEAD)
- `summer_camp/45_engine_room_clockwork` — 4: `sliderGearSharpness` (DEAD), `sliderPistonStroke` (DEAD), `sliderBarTickDensity` (DEAD), `sliderBoilerHeat` (DEAD)
- `summer_camp/49_boiler_pressure_release` — 4: `sliderVentWidth` (DEAD), `sliderVentFlash` (DEAD), `sliderCoolingAfterglow` (DEAD), `sliderSteamRise` (DEAD)
- `summer_camp/50_iceberg_fracture` — 4: `sliderFractureDensity` (WRONG), `sliderBranchSpread` (DEAD), `sliderLaneCount` (DEAD), `sliderShardJag` (DEAD)
- `summer_camp/51_abyssal_searchlight` — 4: `sliderBeamReach` (WRONG), `sliderBeamPunch` (DEAD), `sliderTrailLength` (DEAD), `sliderSwirlMix` (DEAD)
- `summer_camp/82_redwood_timber_fall` — 4: `sliderLocalSpeed` (DEAD), `sliderFallDuration` (DEAD), `sliderStandBrightness` (DEAD), `sliderImpactFlash` (DEAD)
- `00_golden_hour_wash` — 3: `sliderWhiteLevel` (DEAD), `sliderWhiteKick` (DEAD), `sliderWhiteWarmth` (DEAD)
- `12_breathing` — 3: `sliderKick` (DEAD), `sliderDepth` (DEAD), `sliderBlinderBite` (DEAD)
- `summer_camp/41_ghost_aurora` — 3: `sliderCurtainWidth` (DEAD), `sliderDriftChaos` (DEAD), `sliderTriangleGain` (DEAD)
- `summer_camp/81_outpost_distress_beacon` — 3: `sliderSignalStrength` (DEAD), `sliderBeamWidth` (WRONG), `sliderBlackoutDepth` (DEAD)
- `04_beat_folded_helix` — 2: `sliderTwistFreq` (WRONG), `sliderWhiteWarmth` (WRONG)
- `11_bioluminescence` — 2: `sliderDetail` (DEAD), `sliderWhiteWarmth` (WRONG)
- `23_prismatic_strange_attractors` — 2: `sliderDirection` (WRONG), `sliderColorSpread` (DEAD)
- `25_heartbeat` — 2: `sliderBlinder` (DEAD), `sliderBlinderBite` (DEAD)
- `28_spectrum_bloom` — 2: `sliderMid` (DEAD), `sliderHigh` (DEAD)
- `33_aurora_breath` — 2: `sliderShimmer` (DEAD), `sliderBreathRate` (WRONG)
- `35_sparkle_rain` — 2: `sliderDensity` (WRONG), `sliderIntensity` (DEAD)
- `summer_camp/111_logsville_giant_pixel_heartbeat` — 2: `sliderPopBrightness` (WRONG), `sliderSectionCount` (WRONG)
- `summer_camp/112_logsville_giant_call_response` — 2: `sliderTurnBrightness` (WRONG), `sliderSectionCount` (WRONG)
- `summer_camp/113_tower_column_breath` — 2: `sliderLocalSpeed` (DEAD), `sliderVintageGlow` (WRONG)
- `summer_camp/114_tower_ring_chase` — 2: `sliderLocalSpeed` (DEAD), `sliderDirection` (WRONG)
- `summer_camp/40_ghost_ship_reveal` — 2: `sliderLanternGlow` (WRONG), `sliderPortBrightness` (WRONG)
- `summer_camp/65_dome_kick_shockwave` — 2: `sliderRingWidth` (DEAD), `sliderEchoes` (DEAD)
- `07_shimmer` — 1: `sliderRadius` (WRONG)
- `09_cyclone` — 1: `sliderBlinderBite` (DEAD)
- `10_chasers` — 1: `sliderDirection` (WRONG)
- `15_silk_prism_ribbons` — 1: `sliderDirection` (WRONG)
- `36_orbital_pulse` — 1: `sliderPulse` (DEAD)
- `40_lissajous_weave` — 1: `sliderDetail` (WRONG)
- `43_golden_hour_pulse` — 1: `sliderBlinder` (DEAD)
- `44_biolume_swell` — 1: `sliderBase` (DEAD)
- `45_manta_drift` — 1: `sliderDepth` (DEAD)
- `46_abyssal_fronds` — 1: `sliderBaseGlow` (WRONG)
- `53_neon_elevator_hd` — 1: `sliderKick` (DEAD)
- `61_white_breathe` — 1: `sliderDirection` (WRONG)
- `62_white_shimmer` — 1: `sliderDirection` (WRONG)
- `64_temple_warm_white` — 1: `sliderDirection` (WRONG)
- `summer_camp/53_shadow_eclipse` — 1: `sliderShadowSize` (WRONG)
- `summer_camp/54_boiler_fire_overdrive` — 1: `sliderFlameHeight` (DEAD)
- `summer_camp/72_outpost_campfire` — 1: `sliderLocalSpeed` (WRONG)
- `summer_camp/73_tree_shadow_breath` — 1: `sliderShadowDepth` (WRONG)
- `summer_camp/74_lookout_gyro_vortex` — 1: `sliderOutpostGlow` (WRONG)
- `summer_camp/83_shadow_canopy_eclipse` — 1: `sliderShadowDepth` (WRONG)
- `summer_camp/84_outpost_ember_overdrive` — 1: `sliderSparkleDensity` (DEAD)
- `test/test_params` — 1: `sliderFlashSpeed` (DEAD)
- `transitions/trans_ripple_in` — 1: `sliderRingDamping` (WRONG)
- `transitions/trans_wave_sweep` — 1: `sliderWaveFreq` (WRONG)

## Findings, worst first

| Verdict | Pattern | Param | Family | Effect | Reason | Evidence |
|---|---|---|---|---:|---|---|
| WRONG | `summer_camp/42_boiler_glow` | `sliderLocalSpeed` | SPEED | 1.0000 | temporal_rate_did_not_track_slider | temporalRate 0.0000/0.0000/0.0000/0.0002/0.0002 (ratio 218.90, mono 0); temporalFreq ratio 28066.53, mono 0 — but the sweep DID move satMean by 1.0000 |
| WRONG | `summer_camp/50_iceberg_fracture` | `sliderFractureDensity` | SPATIAL | 1.0000 | spatial_statistics_unchanged | litFraction swing 0.0152, monotonic 0 — but the sweep DID move satMean by 1.0000 |
| WRONG | `summer_camp/74_lookout_gyro_vortex` | `sliderOutpostGlow` | BRIGHTNESS | 0.2681 | luma_did_not_track_slider | lumaMean swing 0.0198 ratio 1.19 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.2681 |
| WRONG | `62_white_shimmer` | `sliderDirection` | DIRECTION | 0.2587 | no_reversal_net_travel_or_velocity_series | launch driftX 0.0422/0.0426/0.0413/0.0417/0.0407 (ends 0.0422 → 0.0407, floor ±0.004); velocity-series correlation low↔high 0.912 (reversal at ≤ -0.3) — but the sweep DID move contrastRatio by 0.2587 |
| WRONG | `06_neon_elevator` | `sliderDirection` | DIRECTION | 0.2500 | no_reversal_net_travel_or_velocity_series | launch driftY 0.0829/0.0829/0.0754/0.0754/0.0754 (ends 0.0829 → 0.0754, floor ±0.004); velocity-series correlation low↔high 0.722 (reversal at ≤ -0.3) — but the sweep DID move litFraction by 0.2500 |
| WRONG | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderPopBrightness` | BRIGHTNESS | 0.2241 | luma_did_not_track_slider | lumaMean swing 0.0037 ratio 1.18 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.2241 |
| WRONG | `64_temple_warm_white` | `sliderDirection` | DIRECTION | 0.1763 | no_measurable_motion_to_reverse | launch driftY -0.0002/-0.0003/-0.0004/-0.0006/-0.0008 (ends -0.0002 → -0.0008, floor ±0.004); velocity-series correlation low↔high -0.113 (reversal at ≤ -0.3) — but the sweep DID move spatialFreqY by 0.1763 |
| WRONG | `summer_camp/112_logsville_giant_call_response` | `sliderTurnBrightness` | BRIGHTNESS | 0.1689 | luma_did_not_track_slider | outputMean swing 0.0027 ratio 1.14 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.1689 |
| WRONG | `46_abyssal_fronds` | `sliderBaseGlow` | BRIGHTNESS | 0.1641 | luma_did_not_track_slider | lumaMean swing 0.0098 ratio 1.15 (via none), monotonic 1 — but the sweep DID move litFraction by 0.1641 |
| WRONG | `22_abyssal_sway_garden` | `sliderBaseDarkness` | DARKNESS | 0.1587 | darkness_inverted_adds_light | litFraction swing 0.1373 ratio 1.31 (via absolute), monotonic 1 (expected falling) — but the sweep DID move contrastRatio by 0.1587 |
| WRONG | `07_shimmer` | `sliderRadius` | SPATIAL | 0.1429 | spatial_statistics_unchanged | spatialFreqY swing 0.0136, monotonic 0 — but the sweep DID move temporalFreq by 0.1429 |
| WRONG | `17_rolling_color_dunes` | `sliderDirection` | DIRECTION | 0.1409 | no_reversal_net_travel_or_velocity_series | launch driftY -0.0046/-0.0021/-0.0001/-0.0059/-0.0142 (ends -0.0046 → -0.0142, floor ±0.004); velocity-series correlation low↔high -0.005 (reversal at ≤ -0.3) — but the sweep DID move contrastRatio by 0.1409 |
| WRONG | `summer_camp/40_ghost_ship_reveal` | `sliderLanternGlow` | BRIGHTNESS | 0.1251 | luma_did_not_track_slider | outputMean swing 0.0008 ratio 1.06 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.1251 |
| WRONG | `01_cylon_sweep` | `sliderDirection` | DIRECTION | 0.1242 | no_reversal_net_travel_or_velocity_series | launch driftX 0.1224/0.0963/0.0048/0.0943/0.1234 (ends 0.1224 → 0.1234, floor ±0.004); velocity-series correlation low↔high 0.494 (reversal at ≤ -0.3) — but the sweep DID move contrastRatio by 0.1242 |
| WRONG | `summer_camp/72_outpost_campfire` | `sliderLocalSpeed` | SPEED | 0.1037 | temporal_rate_did_not_track_slider | temporalRate 0.0089/0.0091/0.0091/0.0097/0.0106 (ratio 1.19, mono 1); temporalFreq ratio 1.34, mono 0 — but the sweep DID move contrastRatio by 0.1037 |
| WRONG | `23_prismatic_strange_attractors` | `sliderDirection` | DIRECTION | 0.1037 | no_reversal_net_travel_or_velocity_series | launch driftX -0.0255/-0.0255/-0.0472/-0.0472/-0.0472 (ends -0.0255 → -0.0472, floor ±0.004); velocity-series correlation low↔high -0.016 (reversal at ≤ -0.3) — but the sweep DID move driftY by 0.1037 |
| WRONG | `summer_camp/53_shadow_eclipse` | `sliderShadowSize` | DARKNESS | 0.1008 | output_did_not_fall_with_slider | litFraction swing 0.0003 ratio 1.56 (via none), monotonic 0 (expected falling) — but the sweep DID move driftY by 0.1008 |
| WRONG | `10_chasers` | `sliderDirection` | DIRECTION | 0.0999 | no_reversal_net_travel_or_velocity_series | launch driftY 0.0929/0.0929/0.0854/0.0854/0.0854 (ends 0.0929 → 0.0854, floor ±0.004); velocity-series correlation low↔high -0.069 (reversal at ≤ -0.3) — but the sweep DID move driftY by 0.0999 |
| WRONG | `33_aurora_breath` | `sliderBreathRate` | SPEED | 0.0921 | temporal_rate_did_not_track_slider | temporalRate 0.0005/0.0005/0.0004/0.0004/0.0004 (ratio 1.13, mono 0); temporalFreq ratio 1.19, mono 0 — but the sweep DID move spatialFreqZ by 0.0921 |
| WRONG | `summer_camp/83_shadow_canopy_eclipse` | `sliderShadowDepth` | DARKNESS | 0.0888 | darkness_inverted_adds_light | outputMean swing 0.0081 ratio 1.25 (via ratio), monotonic 1 (expected falling) — but the sweep DID move spatialFreqY by 0.0888 |
| WRONG | `transitions/trans_wave_sweep` | `sliderWaveFreq` | SPEED | 0.0849 | temporal_rate_did_not_track_slider | temporalRate 0.0024/0.0024/0.0024/0.0024/0.0024 (ratio 1.00, mono 0); temporalFreq ratio 1.00, mono 0 — but the sweep DID move hueMean by 0.0849 |
| WRONG | `05_orbital_attractor_field` | `sliderColorVariation` | HUE | 0.0842 | hue_and_saturation_static | hue circular swing 0.0000 turns (normalised 0.0000), saturation swing 0.0000 — but the sweep DID move rMean by 0.0842 |
| WRONG | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderSectionCount` | SPATIAL | 0.0837 | spatial_statistics_unchanged | spatialFreqY swing 0.0199, monotonic -1 — but the sweep DID move contrastRatio by 0.0837 |
| WRONG | `13_sparkle` | `sliderSparkleSize` | SPATIAL | 0.0814 | spatial_statistics_unchanged | spatialFreqX swing 0.0145, monotonic 1 — but the sweep DID move driftY by 0.0814 |
| WRONG | `summer_camp/73_tree_shadow_breath` | `sliderShadowDepth` | DARKNESS | 0.0753 | darkness_inverted_adds_light | litFraction swing 0.0251 ratio 1.05 (via absolute), monotonic 1 (expected falling) — but the sweep DID move uvMean by 0.0753 |
| WRONG | `15_silk_prism_ribbons` | `sliderDirection` | DIRECTION | 0.0685 | no_reversal_net_travel_or_velocity_series | launch driftY -0.0505/-0.0243/0.0080/0.0247/-0.0157 (ends -0.0505 → -0.0157, floor ±0.004); velocity-series correlation low↔high 0.192 (reversal at ≤ -0.3) — but the sweep DID move spatialFreqY by 0.0685 |
| WRONG | `05_orbital_attractor_field` | `sliderBlackoutTexture` | DARKNESS | 0.0682 | output_did_not_fall_with_slider | lumaMean swing 0.0116 ratio 1.10 (via none), monotonic -1 (expected falling) — but the sweep DID move spatialFreqY by 0.0682 |
| WRONG | `04_beat_folded_helix` | `sliderTwistFreq` | SPEED | 0.0676 | temporal_rate_did_not_track_slider | temporalRate 0.0030/0.0028/0.0030/0.0030/0.0030 (ratio 1.06, mono 0); temporalFreq ratio 1.05, mono 0 — but the sweep DID move spatialFreqY by 0.0676 |
| WRONG | `13_sparkle` | `sliderSparkleIntensity` | BRIGHTNESS | 0.0644 | luma_did_not_track_slider | outputMean swing 0.0017 ratio 1.05 (via none), monotonic 1 — but the sweep DID move driftY by 0.0644 |
| WRONG | `22_abyssal_sway_garden` | `sliderDirection` | DIRECTION | 0.0623 | no_reversal_net_travel_or_velocity_series | launch driftZ 0.0112/0.0112/0.0795/0.0795/0.0795 (ends 0.0112 → 0.0795, floor ±0.004); velocity-series correlation low↔high 0.024 (reversal at ≤ -0.3) — but the sweep DID move driftY by 0.0623 |
| WRONG | `transitions/trans_ripple_in` | `sliderRingDamping` | SPATIAL | 0.0621 | spatial_statistics_unchanged | spatialFreqZ swing 0.0106, monotonic -1 — but the sweep DID move satMean by 0.0621 |
| WRONG | `22_abyssal_sway_garden` | `sliderTipGlow` | BRIGHTNESS | 0.0605 | luma_did_not_track_slider | lumaMean swing 0.0020 ratio 1.05 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.0605 |
| WRONG | `summer_camp/112_logsville_giant_call_response` | `sliderSectionCount` | SPATIAL | 0.0599 | spatial_statistics_unchanged | spatialFreqZ swing 0.0184, monotonic 0 — but the sweep DID move contrastRatio by 0.0599 |
| WRONG | `35_sparkle_rain` | `sliderDensity` | SPATIAL | 0.0541 | spatial_statistics_unchanged | spatialFreqY swing 0.0136, monotonic 0 — but the sweep DID move temporalFreq by 0.0541 |
| WRONG | `summer_camp/114_tower_ring_chase` | `sliderDirection` | DIRECTION | 0.0517 | no_reversal_net_travel_or_velocity_series | launch driftX 0.0073/0.0073/0.0012/0.0012/0.0012 (ends 0.0073 → 0.0012, floor ±0.004); velocity-series correlation low↔high 0.002 (reversal at ≤ -0.3) — but the sweep DID move contrastRatio by 0.0517 |
| WRONG | `summer_camp/81_outpost_distress_beacon` | `sliderBeamWidth` | SPATIAL | 0.0471 | spatial_statistics_unchanged | spatialFreqY swing 0.0109, monotonic 1 — but the sweep DID move contrastRatio by 0.0471 |
| WRONG | `61_white_breathe` | `sliderDirection` | DIRECTION | 0.0444 | no_measurable_motion_to_reverse | launch driftY -0.0027/-0.0027/-0.0027/-0.0027/-0.0027 (ends -0.0027 → -0.0027, floor ±0.004); velocity-series correlation low↔high 0.128 (reversal at ≤ -0.3) — but the sweep DID move spatialFreqY by 0.0444 |
| WRONG | `summer_camp/51_abyssal_searchlight` | `sliderBeamReach` | SPATIAL | 0.0420 | spatial_statistics_unchanged | spatialFreqY swing 0.0097, monotonic 0 — but the sweep DID move temporalFreq by 0.0420 |
| WRONG | `summer_camp/40_ghost_ship_reveal` | `sliderPortBrightness` | BRIGHTNESS | 0.0396 | luma_did_not_track_slider | outputMean swing 0.0003 ratio 1.02 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.0396 |
| WRONG | `04_beat_folded_helix` | `sliderWhiteWarmth` | WHITE | 0.0375 | white_amber_emitters_unchanged | wMean swing 0.0000 ratio 1.00 (via none, threshold 0.01) — but the sweep DID move uvMean by 0.0375 |
| WRONG | `22_abyssal_sway_garden` | `sliderDetail` | SPATIAL | 0.0325 | spatial_statistics_unchanged | spatialFreqY swing 0.0157, monotonic -1 — but the sweep DID move contrastRatio by 0.0325 |
| WRONG | `40_lissajous_weave` | `sliderDetail` | SPATIAL | 0.0324 | spatial_statistics_unchanged | edgeSharpnessY swing 0.0091, monotonic 1 — but the sweep DID move rMean by 0.0324 |
| WRONG | `summer_camp/113_tower_column_breath` | `sliderVintageGlow` | BRIGHTNESS | 0.0295 | luma_did_not_track_slider | outputMean swing 0.0015 ratio 1.16 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.0295 |
| WRONG | `summer_camp/56_stage_mirror_axis` | `sliderMirrorWidth` | SPATIAL | 0.0280 | spatial_statistics_unchanged | litFraction swing 0.0094, monotonic 1 — but the sweep DID move temporalFreq by 0.0280 |
| WRONG | `13_sparkle` | `sliderRadius` | SPATIAL | 0.0259 | spatial_statistics_unchanged | spatialFreqY swing 0.0103, monotonic -1 — but the sweep DID move driftY by 0.0259 |
| WRONG | `11_bioluminescence` | `sliderWhiteWarmth` | WHITE | 0.0251 | white_amber_emitters_unchanged | wMean swing 0.0000 ratio 1.00 (via none, threshold 0.01) — but the sweep DID move uvMean by 0.0251 |
| WRONG | `summer_camp/48_titanic_sos_beacon` | `sliderEdgeSoftness` | SPATIAL | 0.0231 | spatial_statistics_unchanged | edgeSharpnessZ swing 0.0076, monotonic -1 — but the sweep DID move contrastRatio by 0.0231 |
| DEAD | `33_aurora_breath` | `sliderShimmer` | MAGNITUDE | 0.0048 | below_dead_threshold | largest normalised change 0.00483 < 0.005 on every measured feature |
| DEAD | `summer_camp/55_stardust_dome` | `sliderRingWidth` | SPATIAL | 0.0044 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06698, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `35_sparkle_rain` | `sliderIntensity` | BRIGHTNESS | 0.0039 | below_dead_threshold | largest normalised change 0.00393 < 0.005 on every measured feature |
| DEAD | `summer_camp/51_abyssal_searchlight` | `sliderSwirlMix` | MAGNITUDE | 0.0036 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.0073, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderBoilerHeat` | MAGNITUDE | 0.0036 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.00591, top mover driftY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderParticleDensity` | SPATIAL | 0.0036 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.09092, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/50_iceberg_fracture` | `sliderBranchSpread` | SPATIAL | 0.0035 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.16946, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/55_stardust_dome` | `sliderOrbitSpeed` | SPEED | 0.0030 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.07605, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/55_stardust_dome` | `sliderParticleDensity` | SPATIAL | 0.0029 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.26838, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `53_neon_elevator_hd` | `sliderKick` | MAGNITUDE | 0.0024 | below_dead_threshold | largest normalised change 0.00239 < 0.005 on every measured feature |
| DEAD | `summer_camp/81_outpost_distress_beacon` | `sliderBlackoutDepth` | DARKNESS | 0.0017 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.04348, top mover spatialFreqZ). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/84_outpost_ember_overdrive` | `sliderSparkleDensity` | SPATIAL | 0.0017 | below_dead_threshold | largest normalised change 0.00171 < 0.005 on every measured feature |
| DEAD | `45_manta_drift` | `sliderDepth` | MAGNITUDE | 0.0016 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.02627, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/55_stardust_dome` | `sliderLocalSpeed` | SPEED | 0.0014 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.23339, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderStageFocus` | SPATIAL | 0.0010 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.28872, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/81_outpost_distress_beacon` | `sliderSignalStrength` | MAGNITUDE | 0.0005 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
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
| DEAD | `06_neon_elevator` | `sliderKick` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.08213, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `06_neon_elevator` | `sliderSteps` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.06814, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `06_neon_elevator` | `sliderWhiteLevel` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.05646, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `06_neon_elevator` | `sliderWhiteKick` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06706, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `06_neon_elevator` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.02393, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `09_cyclone` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06532, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `11_bioluminescence` | `sliderDetail` | SPATIAL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `12_breathing` | `sliderKick` | MAGNITUDE | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `12_breathing` | `sliderDepth` | MAGNITUDE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `12_breathing` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.3058, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `13_sparkle` | `sliderAmberGlint` | WHITE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `17_rolling_color_dunes` | `sliderKick` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.25845, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderStageSurf` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.08588, top mover edgeSharpnessZ). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderAmberWarmth` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.03815, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderWhiteLevel` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.08122, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderWhiteKick` | WHITE | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `17_rolling_color_dunes` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `23_prismatic_strange_attractors` | `sliderColorSpread` | HUE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `25_heartbeat` | `sliderBlinder` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.17733, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `25_heartbeat` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.05958, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `28_spectrum_bloom` | `sliderMid` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.01926, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `28_spectrum_bloom` | `sliderHigh` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.03696, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `36_orbital_pulse` | `sliderPulse` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.08417, top mover lumaMean). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `43_golden_hour_pulse` | `sliderBlinder` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.08934, top mover lumaMean). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `44_biolume_swell` | `sliderBase` | MAGNITUDE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/113_tower_column_breath` | `sliderLocalSpeed` | SPEED | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/114_tower_ring_chase` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `summer_camp/41_ghost_aurora` | `sliderCurtainWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.38292, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/41_ghost_aurora` | `sliderDriftChaos` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.07264, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/41_ghost_aurora` | `sliderTriangleGain` | BRIGHTNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.24095, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/42_boiler_glow` | `sliderFlickerComplexity` | UNKNOWN_CLAIM | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/42_boiler_glow` | `sliderVentWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.18394, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/42_boiler_glow` | `sliderSteamFlash` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.08637, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/42_boiler_glow` | `sliderTriangleRPM` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.28385, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/42_boiler_glow` | `sliderFlashRate` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06906, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/43_sea_floor_shadow` | `sliderShadowWidth` | DARKNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.04671, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/43_sea_floor_shadow` | `sliderShadowDrift` | DARKNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.05256, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/43_sea_floor_shadow` | `sliderEdgeFoam` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.03178, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/43_sea_floor_shadow` | `sliderTriangleSilhouette` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.05833, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderGearSharpness` | SPATIAL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderPistonStroke` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.00617, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderBarTickDensity` | SPATIAL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/46_dome_lockdown` | `sliderDirection` | DIRECTION | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.50708, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/46_dome_lockdown` | `sliderBeaconWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.18563, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/46_dome_lockdown` | `sliderBeaconPunch` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.22391, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/46_dome_lockdown` | `sliderStrobeRate` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.27081, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/46_dome_lockdown` | `sliderAlarmCadence` | SPEED | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/47_apex_perimeter_ping` | `sliderLocalSpeed` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.1793, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/47_apex_perimeter_ping` | `sliderPingWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.29573, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/47_apex_perimeter_ping` | `sliderGhostMix` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.04831, top mover spatialFreqY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/47_apex_perimeter_ping` | `sliderCoronaImpact` | MAGNITUDE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/47_apex_perimeter_ping` | `sliderTrailDecay` | TRAIL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/47_apex_perimeter_ping` | `sliderRingEcho` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.10688, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/48_titanic_sos_beacon` | `sliderSignalStrength` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.02309, top mover litFraction). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/48_titanic_sos_beacon` | `sliderEchoDelay` | UNKNOWN_CLAIM | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/48_titanic_sos_beacon` | `sliderEchoWidth` | SPATIAL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/48_titanic_sos_beacon` | `sliderSearchlightSweep` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.02048, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/48_titanic_sos_beacon` | `sliderWashBrightness` | BRIGHTNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 1.22002, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/49_boiler_pressure_release` | `sliderVentWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.03226, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/49_boiler_pressure_release` | `sliderVentFlash` | MAGNITUDE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/49_boiler_pressure_release` | `sliderCoolingAfterglow` | TRAIL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/49_boiler_pressure_release` | `sliderSteamRise` | UNKNOWN_CLAIM | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/50_iceberg_fracture` | `sliderLaneCount` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.01683, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/50_iceberg_fracture` | `sliderShardJag` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.03263, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/51_abyssal_searchlight` | `sliderBeamPunch` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.26452, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/51_abyssal_searchlight` | `sliderTrailLength` | TRAIL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.14944, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/54_boiler_fire_overdrive` | `sliderFlameHeight` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.12978, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/55_stardust_dome` | `sliderStarCore` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.16999, top mover spatialFreqY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderUvEdge` | UV | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.05078, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderCenterGuide` | UNKNOWN_CLAIM | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderArmCount` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.01561, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderSeedSize` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.0157, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderBreathDepth` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.02446, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderCenterImpact` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.02114, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
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
| WEAK | `25_heartbeat` | `sliderWhiteKick` | WHITE | 0.0194 | claim_met_but_sub_visible | wMean swing 0.0108 ratio 2.25 (via absolute, threshold 0.01) |
| WEAK | `summer_camp/49_boiler_pressure_release` | `sliderPressure` | MAGNITUDE | 0.0193 | effect_below_visible_threshold | dominant mover temporalFreq 0.0193 |
| WEAK | `23_prismatic_strange_attractors` | `sliderWhiteCore` | WHITE | 0.0193 | claim_met_but_sub_visible | wMean swing 0.0010 ratio 1035.00 (via ratio, threshold 0.01) |
| WEAK | `48_heartbeat_drive` | `sliderKick` | MAGNITUDE | 0.0186 | effect_below_visible_threshold | dominant mover contrastRatio 0.0186 |
| WEAK | `summer_camp/96_logsville_ember_storm` | `sliderFlashRate` | SPEED | 0.0170 | temporal_rate_did_not_track_slider | temporalRate 0.0031/0.0033/0.0033/0.0033/0.0034 (ratio 1.08, mono 1); temporalFreq ratio 1.02, mono 0 |
| WEAK | `summer_camp/113_tower_column_breath` | `sliderAudioMid` | MAGNITUDE | 0.0167 | effect_below_visible_threshold | dominant mover temporalFreq 0.0167 |
| WEAK | `12_breathing` | `sliderRadius` | SPATIAL | 0.0163 | spatial_statistics_unchanged | spatialFreqY swing 0.0163, monotonic 0 |
| WEAK | `summer_camp/54_boiler_fire_overdrive` | `sliderTongueCount` | SPATIAL | 0.0153 | spatial_statistics_unchanged | spatialFreqX swing 0.0139, monotonic 0 |
| WEAK | `summer_camp/54_boiler_fire_overdrive` | `sliderHeatFlash` | MAGNITUDE | 0.0152 | effect_below_visible_threshold | dominant mover temporalFreq 0.0152 |
| WEAK | `07_shimmer` | `sliderWhiteWarmth` | WHITE | 0.0145 | white_amber_emitters_unchanged | wMean swing 0.0000 ratio 1.00 (via none, threshold 0.01) |
| WEAK | `13_sparkle` | `sliderWhiteWarmth` | WHITE | 0.0139 | white_amber_emitters_unchanged | wMean swing 0.0000 ratio 1.00 (via none, threshold 0.01) |
| WEAK | `08_ocean_liner` | `sliderDirection` | DIRECTION | 0.0129 | claim_met_but_sub_visible | launch driftX 0.0073/0.0073/-0.0210/-0.0210/-0.0210 (ends 0.0073 → -0.0210, floor ±0.004); velocity-series correlation low↔high 0.250 (reversal at ≤ -0.3) [via net_travel] |
| WEAK | `51_confetti_cyclone` | `sliderHigh` | MAGNITUDE | 0.0129 | effect_below_visible_threshold | dominant mover litFraction 0.0129 |
| WEAK | `05_orbital_attractor_field` | `sliderRadius` | SPATIAL | 0.0127 | spatial_statistics_unchanged | spatialFreqY swing 0.0127, monotonic -1 |
| WEAK | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderUvIntensity` | UV | 0.0125 | claim_met_but_sub_visible | uvMean swing 0.0125 ratio 12486.72 (via absolute, threshold 0.01) |
| WEAK | `summer_camp/75_timber_mill_clockwork` | `sliderSparkImpact` | MAGNITUDE | 0.0124 | effect_below_visible_threshold | dominant mover wMean 0.0124 |
| WEAK | `summer_camp/40_ghost_ship_reveal` | `sliderHullDarkness` | DARKNESS | 0.0121 | output_did_not_fall_with_slider | litFraction swing 0.0009 ratio 1.00 (via none), monotonic -1 (expected falling) |
| WEAK | `44_biolume_swell` | `sliderSparkle` | MAGNITUDE | 0.0120 | effect_below_visible_threshold | dominant mover temporalRate 0.0120 |
| WEAK | `summer_camp/96_logsville_ember_storm` | `sliderSparkleDensity` | SPATIAL | 0.0108 | spatial_statistics_unchanged | edgeSharpnessX swing 0.0014, monotonic 1 |
| WEAK | `25_heartbeat` | `sliderWhiteLevel` | WHITE | 0.0106 | claim_met_but_sub_visible | wMean swing 0.0058 ratio 2.03 (via ratio, threshold 0.01) |
| WEAK | `summer_camp/49_boiler_pressure_release` | `sliderReleaseThreshold` | MAGNITUDE | 0.0101 | effect_below_visible_threshold | dominant mover contrastRatio 0.0101 |
| WEAK | `12_breathing` | `sliderDirection` | DIRECTION | 0.0100 | no_reversal_net_travel_or_velocity_series | launch driftY 0.0346/0.0339/0.0336/0.0332/0.0321 (ends 0.0346 → 0.0321, floor ±0.004); velocity-series correlation low↔high -0.157 (reversal at ≤ -0.3) |
| WEAK | `summer_camp/41_ghost_aurora` | `sliderRimShimmer` | MAGNITUDE | 0.0098 | effect_below_visible_threshold | dominant mover driftY 0.0098 |
| WEAK | `summer_camp/79_mill_pressure_release` | `sliderLocalSpeed` | SPEED | 0.0097 | temporal_rate_did_not_track_slider | temporalRate 0.0001/0.0001/0.0001/0.0001/0.0002 (ratio 1.17, mono 1); temporalFreq ratio 1.12, mono 0 |
| WEAK | `summer_camp/113_tower_column_breath` | `sliderSteamboatWhite` | WHITE | 0.0092 | claim_met_but_sub_visible | wMean swing 0.0092 ratio 9224.29 (via ratio, threshold 0.01) |
| WEAK | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderAudioKick` | MAGNITUDE | 0.0091 | effect_below_visible_threshold | dominant mover spatialFreqY 0.0091 |
| WEAK | `summer_camp/50_iceberg_fracture` | `sliderStrikeDecay` | TRAIL | 0.0090 | trail_extent_and_persistence_unchanged | litFraction swing 0.0090 |
| WEAK | `transitions/trans_ripple_in` | `sliderRings` | SPATIAL | 0.0084 | spatial_statistics_unchanged | spatialFreqZ swing 0.0085, monotonic 0 |
| WEAK | `45_manta_drift` | `sliderSpan` | SPATIAL | 0.0081 | spatial_statistics_unchanged | spatialFreqY swing 0.0082, monotonic 1 |
| WEAK | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderAudioMid` | MAGNITUDE | 0.0078 | effect_below_visible_threshold | dominant mover spatialFreqY 0.0079 |
| WEAK | `summer_camp/114_tower_ring_chase` | `sliderAudioHigh` | MAGNITUDE | 0.0064 | effect_below_visible_threshold | dominant mover driftX 0.0064 |
| WEAK | `summer_camp/96_logsville_ember_storm` | `sliderAudioHigh` | MAGNITUDE | 0.0061 | effect_below_visible_threshold | dominant mover temporalFreq 0.0061 |
| WEAK | `summer_camp/96_logsville_ember_storm` | `sliderEmberSpeed` | SPEED | 0.0057 | temporal_rate_did_not_track_slider | temporalRate 0.0030/0.0031/0.0032/0.0033/0.0034 (ratio 1.12, mono 1); temporalFreq ratio 1.03, mono 1 |
| WEAK | `summer_camp/79_mill_pressure_release` | `sliderVentFlash` | MAGNITUDE | 0.0055 | effect_below_visible_threshold | dominant mover driftX 0.0055 |
| WEAK | `24_chromatic_murmuration` | `sliderKick` | MAGNITUDE | 0.0055 | effect_below_visible_threshold | dominant mover contrastRatio 0.0055 |
| WEAK | `summer_camp/81_outpost_distress_beacon` | `sliderPathChaos` | MAGNITUDE | 0.0051 | effect_below_visible_threshold | dominant mover spatialFreqY 0.0051 |
| WEAK | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderCanopyApexBoost` | MAGNITUDE | 0.0051 | effect_below_visible_threshold | dominant mover wMean 0.0051 |
| UNKNOWN_CLAIM | `64_temple_warm_white` | `sliderCeiling` | UNKNOWN_CLAIM | 1.0000 | name_makes_no_falsifiable_claim | dominant mover litFraction 1.0000 |
| UNKNOWN_CLAIM | `65_uv_only` | `sliderRgbViolet` | UNKNOWN_CLAIM | 1.0000 | name_makes_no_falsifiable_claim | dominant mover satMean 1.0000 |
| UNKNOWN_CLAIM | `39_tide_riser` | `sliderRise` | UNKNOWN_CLAIM | 0.9895 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.9895 |
| UNKNOWN_CLAIM | `42_phyllotaxis_spiral` | `sliderBloom` | UNKNOWN_CLAIM | 0.8872 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.8872 |
| UNKNOWN_CLAIM | `60_white_wash` | `sliderEvenness` | UNKNOWN_CLAIM | 0.7635 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.7635 |
| UNKNOWN_CLAIM | `41_reaction_diffusion` | `sliderSeed` | UNKNOWN_CLAIM | 0.5420 | name_makes_no_falsifiable_claim | dominant mover rMean 0.5420 |
| UNKNOWN_CLAIM | `57_ink_diffuse` | `sliderFlow` | UNKNOWN_CLAIM | 0.3995 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3995 |
| UNKNOWN_CLAIM | `57_ink_diffuse` | `sliderInk` | UNKNOWN_CLAIM | 0.3951 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3951 |
| UNKNOWN_CLAIM | `47_quasicrystal_dunes` | `sliderSurf` | UNKNOWN_CLAIM | 0.3896 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.3896 |
| UNKNOWN_CLAIM | `26_dom_dancers_chevron` | `sliderBall2X` | UNKNOWN_CLAIM | 0.3699 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3699 |
| UNKNOWN_CLAIM | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderHeartbeatPattern` | UNKNOWN_CLAIM | 0.3445 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3445 |
| UNKNOWN_CLAIM | `41_reaction_diffusion` | `sliderFeed` | UNKNOWN_CLAIM | 0.3124 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3124 |
| UNKNOWN_CLAIM | `summer_camp/80_tree_canopy_fracture` | `sliderAftershock` | UNKNOWN_CLAIM | 0.2907 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.2907 |
| UNKNOWN_CLAIM | `39_tide_riser` | `sliderSpray` | UNKNOWN_CLAIM | 0.2786 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.2786 |
| UNKNOWN_CLAIM | `26_dom_dancers_chevron` | `sliderBall1X` | UNKNOWN_CLAIM | 0.2742 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.2742 |
| UNKNOWN_CLAIM | `54_murmuration_storm` | `sliderHaze` | UNKNOWN_CLAIM | 0.2472 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.2471 |
| UNKNOWN_CLAIM | `57_ink_diffuse` | `sliderDiffuse` | UNKNOWN_CLAIM | 0.2361 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.2361 |
| UNKNOWN_CLAIM | `33_aurora_breath` | `sliderSoft` | UNKNOWN_CLAIM | 0.2352 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.2352 |
| UNKNOWN_CLAIM | `summer_camp/73_tree_shadow_breath` | `sliderCanopyMotion` | UNKNOWN_CLAIM | 0.2136 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.2136 |
| UNKNOWN_CLAIM | `summer_camp/112_logsville_giant_call_response` | `sliderConversation` | UNKNOWN_CLAIM | 0.1936 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.1936 |
| UNKNOWN_CLAIM | `54_murmuration_storm` | `sliderBuild` | UNKNOWN_CLAIM | 0.1658 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1658 |
| UNKNOWN_CLAIM | `27_swipe` | `sliderBlur` | UNKNOWN_CLAIM | 0.1560 | name_makes_no_falsifiable_claim | dominant mover driftZ 0.1560 |
| UNKNOWN_CLAIM | `summer_camp/85_redwood_starry_canopy` | `sliderTowerSpin` | UNKNOWN_CLAIM | 0.1491 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.1491 |
| UNKNOWN_CLAIM | `26_dom_dancers_chevron` | `sliderChevronSpeedup` | UNKNOWN_CLAIM | 0.1253 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1253 |
| UNKNOWN_CLAIM | `38_prism_helix` | `sliderArms` | UNKNOWN_CLAIM | 0.1250 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1250 |
| UNKNOWN_CLAIM | `summer_camp/40_ghost_ship_reveal` | `sliderSpinMotion` | UNKNOWN_CLAIM | 0.1244 | name_makes_no_falsifiable_claim | dominant mover driftZ 0.1244 |
| UNKNOWN_CLAIM | `38_prism_helix` | `sliderTwist` | UNKNOWN_CLAIM | 0.0900 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0900 |
| UNKNOWN_CLAIM | `27_swipe` | `sliderSwipePos` | UNKNOWN_CLAIM | 0.0808 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0808 |
| UNKNOWN_CLAIM | `27_swipe` | `sliderShift` | UNKNOWN_CLAIM | 0.0808 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0808 |
| UNKNOWN_CLAIM | `summer_camp/83_shadow_canopy_eclipse` | `sliderCoronaBloom` | UNKNOWN_CLAIM | 0.0729 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.0729 |
| UNKNOWN_CLAIM | `35_sparkle_rain` | `sliderFall` | UNKNOWN_CLAIM | 0.0610 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0610 |
| UNKNOWN_CLAIM | `34_moire_interference` | `sliderRatio` | UNKNOWN_CLAIM | 0.0577 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0577 |
| UNKNOWN_CLAIM | `54_murmuration_storm` | `sliderScatter` | UNKNOWN_CLAIM | 0.0373 | name_makes_no_falsifiable_claim | dominant mover temporalFreq 0.0373 |
| UNKNOWN_CLAIM | `46_abyssal_fronds` | `sliderGlints` | UNKNOWN_CLAIM | 0.0344 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0344 |
| UNKNOWN_CLAIM | `summer_camp/54_boiler_fire_overdrive` | `sliderSwirl` | UNKNOWN_CLAIM | 0.0237 | name_makes_no_falsifiable_claim | dominant mover temporalFreq 0.0237 |
| UNKNOWN_CLAIM | `summer_camp/56_stage_mirror_axis` | `sliderCenter` | UNKNOWN_CLAIM | 0.0210 | name_makes_no_falsifiable_claim | dominant mover temporalFreq 0.0210 |
| UNKNOWN_CLAIM | `summer_camp/52_iceberg_shear_line` | `sliderShearAngle` | UNKNOWN_CLAIM | 0.0169 | name_makes_no_falsifiable_claim | dominant mover spatialFreqX 0.0169 |
| UNKNOWN_CLAIM | `summer_camp/52_iceberg_shear_line` | `sliderTriangleBlade` | UNKNOWN_CLAIM | 0.0144 | name_makes_no_falsifiable_claim | dominant mover driftZ 0.0144 |
| UNKNOWN_CLAIM | `summer_camp/56_stage_mirror_axis` | `sliderAxisDrift` | UNKNOWN_CLAIM | 0.0140 | name_makes_no_falsifiable_claim | dominant mover temporalFreq 0.0140 |
| UNKNOWN_CLAIM | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderBloomGrowth` | UNKNOWN_CLAIM | 0.0128 | name_makes_no_falsifiable_claim | dominant mover temporalFreq 0.0128 |
| UNKNOWN_CLAIM | `summer_camp/52_iceberg_shear_line` | `sliderAdvance` | UNKNOWN_CLAIM | 0.0114 | name_makes_no_falsifiable_claim | dominant mover driftZ 0.0114 |
| UNKNOWN_CLAIM | `37_chevron_chase` | `sliderStep` | UNKNOWN_CLAIM | 0.0071 | name_makes_no_falsifiable_claim | dominant mover driftZ 0.0071 |
| TRUE | `25_heartbeat` | `sliderDirection` | DIRECTION | 3.0935 | claim_met | launch driftX -0.6956/-0.6956/0.7439/0.7439/0.7439 (ends -0.6956 → 0.7439, floor ±0.004); velocity-series correlation low↔high 0.295 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `25_heartbeat` | `sliderLocalSpeed` | SPEED | 1.9560 | claim_met | temporalRate 0.0042/0.0087/0.0144/0.0203/0.0199 (ratio 4.81, mono 1); temporalFreq ratio 4.69, mono 1 |
| TRUE | `28_spectrum_bloom` | `sliderLow` | MAGNITUDE | 1.8921 | claim_met | dominant mover contrastRatio 1.8921 |
| TRUE | `summer_camp/71_tree_aurora` | `sliderAuroraHeight` | SPATIAL | 1.8687 | claim_met | edgeSharpnessZ swing 0.1258, monotonic 1 |
| TRUE | `16_ghost_tide_uv` | `sliderDirection` | DIRECTION | 1.5946 | claim_met | launch driftY 0.3868/0.3302/-0.1644/-0.2950/-0.3767 (ends 0.3868 → -0.3767, floor ±0.004); velocity-series correlation low↔high -0.322 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `25_heartbeat` | `sliderKick` | MAGNITUDE | 1.5318 | claim_met | dominant mover driftX 1.5318 |
| TRUE | `53_neon_elevator_hd` | `sliderLocalSpeed` | SPEED | 1.5154 | claim_met | temporalRate 0.0016/0.0032/0.0065/0.0118/0.0178 (ratio 10.90, mono 1); temporalFreq ratio 16.24, mono 1 |
| TRUE | `calib_swipe_up_down` | `sliderLocalSpeed` | SPEED | 1.3513 | claim_met | temporalRate 0.0018/0.0041/0.0070/0.0114/0.0151 (ratio 8.25, mono 1); temporalFreq ratio 7.46, mono 1 |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderHeatIntensity` | BRIGHTNESS | 1.3080 | claim_met | lumaMean swing 0.0203 ratio 20263.52 (via absolute), monotonic 1 |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderPingGlow` | BRIGHTNESS | 1.3066 | claim_met | lumaMean swing 0.0101 ratio 6.35 (via ratio), monotonic 1 |
| TRUE | `11_bioluminescence` | `sliderDirection` | DIRECTION | 1.2289 | claim_met | launch driftX 0.3199/0.1362/-0.0188/-0.1883/-0.2721 (ends 0.3199 → -0.2721, floor ±0.004); velocity-series correlation low↔high 0.302 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `39_tide_riser` | `sliderBase` | MAGNITUDE | 1.1876 | claim_met | dominant mover contrastRatio 1.1876 |
| TRUE | `summer_camp/82_redwood_timber_fall` | `sliderCanopyBrightness` | BRIGHTNESS | 1.1865 | claim_met | lumaMean swing 0.0159 ratio 5.00 (via ratio), monotonic 1 |
| TRUE | `summer_camp/81_outpost_distress_beacon` | `sliderEchoGlow` | BRIGHTNESS | 1.1827 | claim_met | outputMean swing 0.0189 ratio 4.28 (via ratio), monotonic 1 |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderBandWidth` | SPATIAL | 1.1192 | claim_met | edgeSharpnessZ swing 0.0966, monotonic 1 |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderBrightness` | BRIGHTNESS | 1.1151 | claim_met | lumaMean swing 0.0083 ratio 3.66 (via ratio), monotonic 1 |
| TRUE | `28_spectrum_bloom` | `sliderFloor` | MAGNITUDE | 1.0474 | claim_met | dominant mover contrastRatio 1.0474 |
| TRUE | `13_sparkle` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0461 ratio 46136.25 (via absolute), monotonic 1 |
| TRUE | `14_lunar_current` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | outputMean swing 0.0894 ratio 89360.50 (via absolute), monotonic 1 |
| TRUE | `summer_camp/41_ghost_aurora` | `sliderHumanWarmth` | WARMTH | 1.0000 | claim_met | aMean swing 0.0068 ratio 6794.97 (via ratio), hue 0.0000 |
| TRUE | `summer_camp/42_boiler_glow` | `sliderBoilerHeat` | MAGNITUDE | 1.0000 | claim_met | dominant mover satMean 1.0000 |
| TRUE | `summer_camp/43_sea_floor_shadow` | `sliderAbyssalSwell` | MAGNITUDE | 1.0000 | claim_met | dominant mover satMean 1.0000 |
| TRUE | `summer_camp/43_sea_floor_shadow` | `sliderBlackoutDepth` | DARKNESS | 1.0000 | claim_met | litFraction swing 0.9232 ratio 923236.51 (via absolute), monotonic -1 (expected falling) |
| TRUE | `summer_camp/47_apex_perimeter_ping` | `sliderVintageMidpoint` | MAGNITUDE | 1.0000 | claim_met | dominant mover satMean 1.0000 |
| TRUE | `summer_camp/48_titanic_sos_beacon` | `sliderResponseGlow` | BRIGHTNESS | 1.0000 | claim_met | outputMean swing 0.0047 ratio 2.02 (via ratio), monotonic 1 |
| TRUE | `summer_camp/48_titanic_sos_beacon` | `sliderBrightness` | BRIGHTNESS | 1.0000 | claim_met | outputMean swing 0.0064 ratio 5.63 (via ratio), monotonic 1 |
| TRUE | `summer_camp/49_boiler_pressure_release` | `sliderHeatBloom` | MAGNITUDE | 1.0000 | claim_met | dominant mover satMean 1.0000 |
| TRUE | `summer_camp/49_boiler_pressure_release` | `sliderBlackoutDepth` | DARKNESS | 1.0000 | claim_met | lumaMean swing 0.0067 ratio 49.49 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/50_iceberg_fracture` | `sliderAftershockWarmth` | WARMTH | 1.0000 | claim_met | aMean swing 0.0100 ratio 10036.56 (via absolute), hue 0.0000 |
| TRUE | `summer_camp/50_iceberg_fracture` | `sliderBlackoutDepth` | DARKNESS | 1.0000 | claim_met | lumaMean swing 0.0083 ratio 667.64 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/51_abyssal_searchlight` | `sliderVintageBleed` | MAGNITUDE | 1.0000 | claim_met | dominant mover satMean 1.0000 |
| TRUE | `summer_camp/53_shadow_eclipse` | `sliderVintageBloom` | MAGNITUDE | 1.0000 | claim_met | dominant mover satMean 1.0000 |
| TRUE | `summer_camp/54_boiler_fire_overdrive` | `sliderAmberBias` | WHITE | 1.0000 | claim_met | aMean swing 0.0077 ratio 7731.92 (via ratio, threshold 0.01) |
| TRUE | `summer_camp/56_stage_mirror_axis` | `sliderBlackoutDepth` | DARKNESS | 1.0000 | claim_met | lumaMean swing 0.0058 ratio 4106.40 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderVintageWarm` | WARMTH | 1.0000 | claim_met | aMean swing 0.0110 ratio 10955.40 (via absolute), hue 0.0000 |
| TRUE | `summer_camp/65_dome_kick_shockwave` | `sliderImpact` | MAGNITUDE | 1.0000 | claim_met | dominant mover satMean 1.0000 |
| TRUE | `summer_camp/84_outpost_ember_overdrive` | `sliderHeatIntensity` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0007 ratio 708.54 (via ratio), monotonic 1 |
| TRUE | `test_const` | `sliderColorPalette1` | HUE | 1.0000 | claim_met | hue circular swing 0.4961 turns (normalised 0.9922), saturation swing 0.0000 |
| TRUE | `35_sparkle_rain` | `sliderBase` | MAGNITUDE | 0.9925 | claim_met | dominant mover litFraction 0.9925 |
| TRUE | `test/solid` | `sliderColorPalette1` | HUE | 0.9919 | claim_met | hue circular swing 0.4959 turns (normalised 0.9918), saturation swing 0.0000 |
| TRUE | `42_phyllotaxis_spiral` | `sliderFloorLvl` | MAGNITUDE | 0.9699 | claim_met | dominant mover contrastRatio 0.9699 |
| TRUE | `calib_swipe_left_right` | `sliderLocalSpeed` | SPEED | 0.9687 | claim_met | temporalRate 0.0018/0.0039/0.0067/0.0124/0.0191 (ratio 10.41, mono 1); temporalFreq ratio 7.55, mono 1 |
| TRUE | `17_rolling_color_dunes` | `sliderLevel` | BRIGHTNESS | 0.9627 | claim_met | lumaMean swing 0.0185 ratio 23.60 (via ratio), monotonic 1 |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderWedgeWidth` | SPATIAL | 0.9561 | claim_met | litFraction swing 0.1215, monotonic 1 |
| TRUE | `50_phase_cathedral_hd` | `sliderNodeContrast` | CONTRAST | 0.9495 | claim_met | contrastRatio swing 0.3855 ratio 2.13 (via absolute) |
| TRUE | `31_strobe_lattice` | `sliderLevel` | BRIGHTNESS | 0.9421 | claim_met | lumaMean swing 0.0365 ratio 19.59 (via absolute), monotonic 1 |
| TRUE | `32_caustic_shimmer` | `sliderShimmer` | MAGNITUDE | 0.9400 | claim_met | dominant mover litFraction 0.9400 |
| TRUE | `40_lissajous_weave` | `sliderLevel` | BRIGHTNESS | 0.9384 | claim_met | lumaMean swing 0.1097 ratio 17.36 (via absolute), monotonic 1 |
| TRUE | `12_breathing` | `sliderLevel` | BRIGHTNESS | 0.9371 | claim_met | lumaMean swing 0.1992 ratio 15.89 (via absolute), monotonic 1 |
| TRUE | `53_neon_elevator_hd` | `sliderLevel` | BRIGHTNESS | 0.9201 | claim_met | lumaMean swing 0.0414 ratio 5.74 (via absolute), monotonic 1 |
| TRUE | `16_ghost_tide_uv` | `sliderLocalSpeed` | SPEED | 0.9153 | claim_met | temporalRate 0.0048/0.0102/0.0221/0.0407/0.0722 (ratio 15.20, mono 1); temporalFreq ratio 13.58, mono 1 |
| TRUE | `35_sparkle_rain` | `sliderLevel` | BRIGHTNESS | 0.9088 | claim_met | lumaMean swing 0.0792 ratio 11.05 (via absolute), monotonic 1 |
| TRUE | `14_lunar_current` | `sliderDirection` | DIRECTION | 0.9042 | claim_met | launch driftY 0.1962/0.1250/-0.0213/-0.1213/-0.1855 (ends 0.1962 → -0.1855, floor ±0.004); velocity-series correlation low↔high -0.079 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderCanopyGlow` | BRIGHTNESS | 0.8944 | claim_met | lumaMean swing 0.0107 ratio 3.61 (via ratio), monotonic 1 |
| TRUE | `27_swipe` | `sliderLocalSpeed` | SPEED | 0.8667 | claim_met | temporalRate 0.0000/0.0007/0.0015/0.0019/0.0025 (ratio 2522.73, mono 1); temporalFreq ratio 14860.14, mono 1 |
| TRUE | `53_neon_elevator_hd` | `sliderFloorCount` | SPATIAL | 0.8647 | claim_met | spatialFreqY swing 0.2494, monotonic 1 |
| TRUE | `15_silk_prism_ribbons` | `sliderLevel` | BRIGHTNESS | 0.8635 | claim_met | lumaMean swing 0.0976 ratio 10.05 (via absolute), monotonic 1 |
| TRUE | `07_shimmer` | `sliderLevel` | BRIGHTNESS | 0.8564 | claim_met | lumaMean swing 0.1821 ratio 8.87 (via absolute), monotonic 1 |
| TRUE | `65_uv_only` | `sliderLevel` | BRIGHTNESS | 0.8542 | claim_met | outputMean swing 0.0527 ratio 6.88 (via absolute), monotonic 1 |
| TRUE | `25_heartbeat` | `sliderDormantGlow` | BRIGHTNESS | 0.8466 | claim_met | lumaMean swing 0.0596 ratio 5.55 (via absolute), monotonic 1 |
| TRUE | `38_prism_helix` | `sliderLevel` | BRIGHTNESS | 0.8464 | claim_met | lumaMean swing 0.0610 ratio 5.28 (via absolute), monotonic 1 |
| TRUE | `47_quasicrystal_dunes` | `sliderDuneHeight` | SPATIAL | 0.8463 | claim_met | litFraction swing 0.8463, monotonic 1 |
| TRUE | `49_cylon_crush` | `sliderLevel` | BRIGHTNESS | 0.8448 | claim_met | lumaMean swing 0.0922 ratio 45.33 (via absolute), monotonic 1 |
| TRUE | `02_phase_cathedral` | `sliderSharpness` | SPATIAL | 0.8419 | claim_met | litFraction swing 0.8419, monotonic -1 |
| TRUE | `13_sparkle` | `sliderBackgroundLevel` | BRIGHTNESS | 0.8160 | claim_met | lumaMean swing 0.1238 ratio 14.19 (via absolute), monotonic 1 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderTurnDecay` | TRAIL | 0.8158 | claim_met | litFraction swing 0.8158 |
| TRUE | `test_dualband` | `sliderColorPalette1` | HUE | 0.8128 | claim_met | hue circular swing 0.4064 turns (normalised 0.8128), saturation swing 0.0000 |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderOrganGlow` | BRIGHTNESS | 0.8016 | claim_met | lumaMean swing 0.0081 ratio 3.68 (via ratio), monotonic 1 |
| TRUE | `58_lighthouse_solo` | `sliderBeam` | SPATIAL | 0.7982 | claim_met | litFraction swing 0.5168, monotonic 1 |
| TRUE | `10_chasers` | `sliderLevel` | BRIGHTNESS | 0.7972 | claim_met | lumaMean swing 0.1043 ratio 13.62 (via absolute), monotonic 1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderPulseIntensity` | BRIGHTNESS | 0.7972 | claim_met | outputMean swing 0.0202 ratio 4.06 (via absolute), monotonic 1 |
| TRUE | `33_aurora_breath` | `sliderLevel` | BRIGHTNESS | 0.7966 | claim_met | lumaMean swing 0.0825 ratio 3.89 (via absolute), monotonic 1 |
| TRUE | `16_ghost_tide_uv` | `sliderLevel` | BRIGHTNESS | 0.7868 | claim_met | outputMean swing 0.1256 ratio 15.40 (via absolute), monotonic 1 |
| TRUE | `02_phase_cathedral` | `sliderKick` | MAGNITUDE | 0.7681 | claim_met | dominant mover litFraction 0.7681 |
| TRUE | `24_chromatic_murmuration` | `sliderAfterglow` | TRAIL | 0.7655 | claim_met | litFraction swing 0.7655 |
| TRUE | `00_golden_hour_wash` | `sliderLevel` | BRIGHTNESS | 0.7530 | claim_met | lumaMean swing 0.0874 ratio 6.08 (via absolute), monotonic 1 |
| TRUE | `18_deep_space_lattice` | `sliderLevel` | BRIGHTNESS | 0.7478 | claim_met | lumaMean swing 0.1023 ratio 16.12 (via absolute), monotonic 1 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderLocalSpeed` | SPEED | 0.7380 | claim_met | temporalRate 0.0003/0.0008/0.0010/0.0013/0.0015 (ratio 4.18, mono 1); temporalFreq ratio 4.84, mono 0 |
| TRUE | `23_prismatic_strange_attractors` | `sliderContrast` | CONTRAST | 0.7318 | claim_met | contrastRatio swing 0.5101 ratio 1.92 (via absolute) |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderPopDecay` | TRAIL | 0.7283 | claim_met | litFraction swing 0.7283 |
| TRUE | `52_silk_ribbons` | `sliderAudioLevel` | BRIGHTNESS | 0.7214 | claim_met | lumaMean swing 0.1089 ratio 10.87 (via absolute), monotonic 1 |
| TRUE | `54_murmuration_storm` | `sliderFlockEnergy` | MAGNITUDE | 0.7175 | claim_met | dominant mover rMean 0.7175 |
| TRUE | `64_temple_warm_white` | `sliderWarmth` | WARMTH | 0.7003 | claim_met | bMean swing 0.0616 ratio 3.30 (via absolute), hue 0.0012 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderHullGlow` | BRIGHTNESS | 0.7002 | claim_met | lumaMean swing 0.0668 ratio 12.26 (via absolute), monotonic 1 |
| TRUE | `43_golden_hour_pulse` | `sliderNoiseScale` | SPATIAL | 0.6885 | claim_met | litFraction swing 0.6885, monotonic 0 [non-monotonic] |
| TRUE | `19_swaying_lattice_ballet` | `sliderLevel` | BRIGHTNESS | 0.6852 | claim_met | lumaMean swing 0.0489 ratio 16.38 (via absolute), monotonic 1 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderRevealWidth` | SPATIAL | 0.6831 | claim_met | litFraction swing 0.3039, monotonic 1 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderSectionFloor` | SPATIAL | 0.6744 | claim_met | edgeSharpnessZ swing 0.1003, monotonic 1 |
| TRUE | `test_dualband` | `sliderColorPalette2` | HUE | 0.6696 | claim_met | hue circular swing 0.3348 turns (normalised 0.6696), saturation swing 0.0000 |
| TRUE | `09_cyclone` | `sliderLevel` | BRIGHTNESS | 0.6651 | claim_met | lumaMean swing 0.0470 ratio 7.71 (via absolute), monotonic 1 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderSweepWidth` | SPATIAL | 0.6624 | claim_met | litFraction swing 0.5118, monotonic 1 |
| TRUE | `20_parametric_sway_field` | `sliderLevel` | BRIGHTNESS | 0.6606 | claim_met | lumaMean swing 0.0830 ratio 9.53 (via absolute), monotonic 1 |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderMoltenGlow` | BRIGHTNESS | 0.6571 | claim_met | lumaMean swing 0.0139 ratio 4.07 (via ratio), monotonic 1 |
| TRUE | `03_dual_axis_crush` | `sliderLevel` | BRIGHTNESS | 0.6516 | claim_met | lumaMean swing 0.0744 ratio 6.25 (via absolute), monotonic 1 |
| TRUE | `30_bass_comet` | `sliderDirection` | DIRECTION | 0.6473 | claim_met | launch driftZ -0.0004/-0.0004/0.0813/0.0813/0.0813 (ends -0.0004 → 0.0813, floor ±0.004); velocity-series correlation low↔high -0.539 (reversal at ≤ -0.3) [via anticorrelated_motion] |
| TRUE | `17_rolling_color_dunes` | `sliderLocalSpeed` | SPEED | 0.6473 | claim_met | temporalRate 0.0000/0.0001/0.0004/0.0005/0.0009 (ratio 23.91, mono 1); temporalFreq ratio 7.20, mono 1 |
| TRUE | `25_heartbeat` | `sliderRadius` | SPATIAL | 0.6449 | claim_met | spatialFreqY swing 0.0879, monotonic 1 |
| TRUE | `37_chevron_chase` | `sliderWidth` | SPATIAL | 0.6380 | claim_met | litFraction swing 0.6380, monotonic 1 |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderSectionFloor` | SPATIAL | 0.6250 | claim_met | spatialFreqY swing 0.1220, monotonic 0 [non-monotonic] |
| TRUE | `48_heartbeat_drive` | `sliderLow` | MAGNITUDE | 0.6213 | claim_met | dominant mover rMean 0.6213 |
| TRUE | `63_white_chase` | `sliderWarmth` | WARMTH | 0.6187 | claim_met | bMean swing 0.0736 ratio 2.59 (via absolute), hue 0.0090 |
| TRUE | `41_reaction_diffusion` | `sliderLevel` | BRIGHTNESS | 0.6174 | claim_met | lumaMean swing 0.0425 ratio 5.23 (via absolute), monotonic 1 |
| TRUE | `62_white_shimmer` | `sliderWarmth` | WARMTH | 0.6160 | claim_met | bMean swing 0.0364 ratio 2.60 (via absolute), hue 0.0004 |
| TRUE | `22_abyssal_sway_garden` | `sliderLevel` | BRIGHTNESS | 0.6156 | claim_met | lumaMean swing 0.0573 ratio 7.62 (via absolute), monotonic 1 |
| TRUE | `60_white_wash` | `sliderWarmth` | WARMTH | 0.6067 | claim_met | bMean swing 0.1151 ratio 2.54 (via absolute), hue 0.0001 |
| TRUE | `61_white_breathe` | `sliderWarmth` | WARMTH | 0.6041 | claim_met | bMean swing 0.1833 ratio 2.53 (via absolute), hue 0.0003 |
| TRUE | `61_white_breathe` | `sliderLevel` | BRIGHTNESS | 0.5979 | claim_met | outputMean swing 0.3822 ratio 13.09 (via absolute), monotonic 1 |
| TRUE | `20_parametric_sway_field` | `sliderFocus` | SPATIAL | 0.5934 | claim_met | litFraction swing 0.5934, monotonic -1 |
| TRUE | `65_uv_only` | `sliderUvFloor` | UV | 0.5918 | claim_met | uvMean swing 0.5918 ratio 3.51 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderBaselineFloor` | MAGNITUDE | 0.5898 | claim_met | dominant mover contrastRatio 0.5898 |
| TRUE | `01_cylon_sweep` | `sliderLevel` | BRIGHTNESS | 0.5862 | claim_met | lumaMean swing 0.1063 ratio 5.88 (via absolute), monotonic 1 |
| TRUE | `10_chasers` | `sliderLocalSpeed` | SPEED | 0.5840 | claim_met | temporalRate 0.0055/0.0089/0.0151/0.0273/0.0261 (ratio 4.93, mono 0); temporalFreq ratio 5.43, mono 1 |
| TRUE | `47_quasicrystal_dunes` | `sliderDuneScale` | SPATIAL | 0.5822 | claim_met | litFraction swing 0.5822, monotonic 0 [non-monotonic] |
| TRUE | `17_rolling_color_dunes` | `sliderDetail` | SPATIAL | 0.5810 | claim_met | edgeSharpnessZ swing 0.0942, monotonic -1 |
| TRUE | `57_ink_diffuse` | `sliderBase` | MAGNITUDE | 0.5791 | claim_met | dominant mover rMean 0.5791 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderLocalSpeed` | SPEED | 0.5745 | claim_met | temporalRate 0.0000/0.0001/0.0006/0.0013/0.0032 (ratio 284.82, mono 1); temporalFreq ratio 8.48, mono 1 |
| TRUE | `62_white_shimmer` | `sliderLevel` | BRIGHTNESS | 0.5741 | claim_met | lumaMean swing 0.0703 ratio 9.55 (via absolute), monotonic 1 |
| TRUE | `61_white_breathe` | `sliderWhiteLevel` | WHITE | 0.5739 | claim_met | wMean swing 0.5739 ratio 7.00 (via absolute, threshold 0.01) |
| TRUE | `63_white_chase` | `sliderLevel` | BRIGHTNESS | 0.5623 | claim_met | lumaMean swing 0.1362 ratio 9.56 (via absolute), monotonic 1 |
| TRUE | `37_chevron_chase` | `sliderBright` | BRIGHTNESS | 0.5573 | claim_met | lumaMean swing 0.0394 ratio 4.98 (via absolute), monotonic 1 |
| TRUE | `32_caustic_shimmer` | `sliderBase` | MAGNITUDE | 0.5509 | claim_met | dominant mover rMean 0.5509 |
| TRUE | `62_white_shimmer` | `sliderDensity` | SPATIAL | 0.5438 | claim_met | edgeSharpnessX swing 0.1703, monotonic 1 |
| TRUE | `41_reaction_diffusion` | `sliderBase` | MAGNITUDE | 0.5353 | claim_met | dominant mover litFraction 0.5353 |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderBeamWidth` | SPATIAL | 0.5220 | claim_met | spatialFreqX swing 0.0845, monotonic 1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderAudioKick` | MAGNITUDE | 0.5208 | responds_to_edges_not_to_level | held static the control does nothing, but pulsed 0↔1 at 40 frames it moves contrastRatio by 0.5208 — this is an edge-triggered control, meant to be driven by a modulation mapping rather than parked at a value |
| TRUE | `45_manta_drift` | `sliderSwell` | MAGNITUDE | 0.5146 | claim_met | dominant mover rMean 0.5146 |
| TRUE | `02_phase_cathedral` | `sliderLevel` | BRIGHTNESS | 0.5125 | claim_met | outputMean swing 0.0202 ratio 9.50 (via absolute), monotonic 1 |
| TRUE | `30_bass_comet` | `sliderTail` | TRAIL | 0.5108 | claim_met | litFraction swing 0.5108 |
| TRUE | `01_cylon_sweep` | `sliderBackgroundGlow` | BRIGHTNESS | 0.5076 | claim_met | lumaMean swing 0.0485 ratio 1.61 (via absolute), monotonic 1 |
| TRUE | `15_silk_prism_ribbons` | `sliderSoftness` | SPATIAL | 0.5076 | claim_met | spatialFreqX swing 0.1440, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderLocalSpeed` | SPEED | 0.5068 | claim_met | temporalRate 0.0005/0.0010/0.0012/0.0016/0.0018 (ratio 3.78, mono 1); temporalFreq ratio 2.22, mono 0 |
| TRUE | `21_pelagic_manta_rays` | `sliderLevel` | BRIGHTNESS | 0.4968 | claim_met | lumaMean swing 0.1056 ratio 8.69 (via absolute), monotonic 1 |
| TRUE | `10_chasers` | `sliderCount` | SPATIAL | 0.4965 | claim_met | litFraction swing 0.4965, monotonic 1 |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderToothWidth` | SPATIAL | 0.4965 | claim_met | litFraction swing 0.3143, monotonic 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderDetail` | SPATIAL | 0.4926 | claim_met | litFraction swing 0.4926, monotonic -1 |
| TRUE | `61_white_breathe` | `sliderWhiteKick` | WHITE | 0.4878 | claim_met | wMean swing 0.4878 ratio 2.31 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderChordSpread` | SPATIAL | 0.4814 | claim_met | spatialFreqX swing 0.0655, monotonic -1 |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderShimmer` | MAGNITUDE | 0.4743 | claim_met | dominant mover contrastRatio 0.4743 |
| TRUE | `06_neon_elevator` | `sliderLocalSpeed` | SPEED | 0.4707 | claim_met | temporalRate 0.0008/0.0006/0.0012/0.0025/0.0072 (ratio 11.52, mono 1); temporalFreq ratio 8.00, mono 1 |
| TRUE | `38_prism_helix` | `sliderContrast` | CONTRAST | 0.4682 | claim_met | contrastRatio swing 0.4681 ratio 1.99 (via absolute) |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderBeamGlow` | SPATIAL | 0.4677 | claim_met | litFraction swing 0.0721, monotonic 1 |
| TRUE | `36_orbital_pulse` | `sliderFocus` | SPATIAL | 0.4663 | claim_met | edgeSharpnessY swing 0.0964, monotonic 1 |
| TRUE | `26_dom_dancers_chevron` | `sliderDancerGlow` | BRIGHTNESS | 0.4639 | claim_met | lumaMean swing 0.2497 ratio 2.75 (via absolute), monotonic 1 |
| TRUE | `05_orbital_attractor_field` | `sliderLevel` | BRIGHTNESS | 0.4634 | claim_met | lumaMean swing 0.0985 ratio 2.52 (via absolute), monotonic 1 |
| TRUE | `34_moire_interference` | `sliderLevel` | BRIGHTNESS | 0.4598 | claim_met | lumaMean swing 0.0609 ratio 4.64 (via absolute), monotonic 1 |
| TRUE | `46_abyssal_fronds` | `sliderFrondDensity` | SPATIAL | 0.4581 | claim_met | litFraction swing 0.3584, monotonic 0 [non-monotonic] |
| TRUE | `18_deep_space_lattice` | `sliderDirection` | DIRECTION | 0.4526 | claim_met | launch driftX 0.0748/0.0616/-0.0388/-0.0716/-0.1541 (ends 0.0748 → -0.1541, floor ±0.004); velocity-series correlation low↔high -0.065 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderBrightness` | BRIGHTNESS | 0.4508 | claim_met | lumaMean swing 0.0032 ratio 1.91 (via ratio), monotonic 1 |
| TRUE | `52_silk_ribbons` | `sliderRibbons` | SPATIAL | 0.4492 | claim_met | litFraction swing 0.4492, monotonic 1 |
| TRUE | `17_rolling_color_dunes` | `sliderDuneScale` | SPATIAL | 0.4457 | claim_met | edgeSharpnessZ swing 0.0576, monotonic 0 [non-monotonic] |
| TRUE | `26_dom_dancers_chevron` | `sliderDancerSize` | SPATIAL | 0.4410 | claim_met | litFraction swing 0.2079, monotonic 1 |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderChaseGlow` | BRIGHTNESS | 0.4321 | claim_met | lumaMean swing 0.0248 ratio 4.28 (via absolute), monotonic 1 |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderLocalSpeed` | SPEED | 0.4273 | claim_met | temporalRate 0.0008/0.0013/0.0025/0.0051/0.0081 (ratio 9.67, mono 1); temporalFreq ratio 13.23, mono 1 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderVortexWidth` | SPATIAL | 0.4269 | claim_met | litFraction swing 0.3363, monotonic 1 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderLocalSpeed` | SPEED | 0.4130 | claim_met | temporalRate 0.0004/0.0008/0.0014/0.0029/0.0058 (ratio 14.26, mono 1); temporalFreq ratio 12.68, mono 1 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderTrailGlow` | TRAIL | 0.4121 | claim_met | litFraction swing 0.2735 |
| TRUE | `60_white_wash` | `sliderLevel` | BRIGHTNESS | 0.4106 | claim_met | outputMean swing 0.2536 ratio 8.69 (via absolute), monotonic 1 |
| TRUE | `57_ink_diffuse` | `sliderLocalSpeed` | SPEED | 0.4083 | claim_met | temporalRate 0.0006/0.0012/0.0025/0.0027/0.0045 (ratio 7.12, mono 1); temporalFreq ratio 3.13, mono 0 |
| TRUE | `34_moire_interference` | `sliderContrast` | CONTRAST | 0.4023 | claim_met | contrastRatio swing 0.3688 ratio 1.77 (via absolute) |
| TRUE | `42_phyllotaxis_spiral` | `sliderCoreSize` | SPATIAL | 0.4019 | claim_met | litFraction swing 0.4019, monotonic 1 |
| TRUE | `51_confetti_cyclone` | `sliderSparkSize` | SPATIAL | 0.3991 | claim_met | litFraction swing 0.3991, monotonic 1 |
| TRUE | `43_golden_hour_pulse` | `sliderSwell` | MAGNITUDE | 0.3948 | claim_met | dominant mover contrastRatio 0.3948 |
| TRUE | `27_swipe` | `sliderDirection` | DIRECTION | 0.3885 | claim_met | launch driftX 0.1350/0.1350/-0.0328/-0.0328/-0.0328 (ends 0.1350 → -0.0328, floor ±0.004); velocity-series correlation low↔high -0.011 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `60_white_wash` | `sliderWhiteLevel` | WHITE | 0.3867 | claim_met | wMean swing 0.3867 ratio 8.69 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/71_tree_aurora` | `sliderLocalSpeed` | SPEED | 0.3839 | claim_met | temporalRate 0.0003/0.0007/0.0017/0.0032/0.0037 (ratio 13.30, mono 1); temporalFreq ratio 10.17, mono 0 |
| TRUE | `09_cyclone` | `sliderLocalSpeed` | SPEED | 0.3786 | claim_met | temporalRate 0.0036/0.0062/0.0116/0.0211/0.0341 (ratio 9.46, mono 1); temporalFreq ratio 11.99, mono 1 |
| TRUE | `calib_swipe_up_down` | `sliderBandW` | SPATIAL | 0.3785 | claim_met | litFraction swing 0.2830, monotonic 1 |
| TRUE | `18_deep_space_lattice` | `sliderLatticeScale` | SPATIAL | 0.3780 | claim_met | spatialFreqY swing 0.3780, monotonic 1 |
| TRUE | `20_parametric_sway_field` | `sliderKick` | MAGNITUDE | 0.3686 | claim_met | dominant mover litFraction 0.3686 |
| TRUE | `29_kick_shockwave` | `sliderLevel` | BRIGHTNESS | 0.3679 | claim_met | lumaMean swing 0.0782 ratio 3.51 (via absolute), monotonic 1 |
| TRUE | `03_dual_axis_crush` | `sliderLocalSpeed` | SPEED | 0.3656 | claim_met | temporalRate 0.0018/0.0034/0.0065/0.0122/0.0231 (ratio 13.21, mono 1); temporalFreq ratio 14.05, mono 1 |
| TRUE | `47_quasicrystal_dunes` | `sliderFloor` | MAGNITUDE | 0.3651 | claim_met | dominant mover rMean 0.3651 |
| TRUE | `51_confetti_cyclone` | `sliderLow` | MAGNITUDE | 0.3642 | claim_met | dominant mover litFraction 0.3642 |
| TRUE | `22_abyssal_sway_garden` | `sliderLocalSpeed` | SPEED | 0.3594 | claim_met | temporalRate 0.0082/0.0197/0.0250/0.0291/0.0316 (ratio 3.87, mono 1); temporalFreq ratio 4.56, mono 1 |
| TRUE | `summer_camp/53_shadow_eclipse` | `sliderOrbitEccentricity` | MAGNITUDE | 0.3587 | claim_met | dominant mover driftZ 0.3587 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderBlackoutDepth` | DARKNESS | 0.3587 | claim_met | litFraction swing 0.3586 ratio 1.77 (via absolute), monotonic -1 (expected falling) |
| TRUE | `04_beat_folded_helix` | `sliderLevel` | BRIGHTNESS | 0.3585 | claim_met | outputMean swing 0.0777 ratio 5.45 (via absolute), monotonic 1 |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderLocalSpeed` | SPEED | 0.3584 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0006/0.0011 (ratio 15.56, mono 1); temporalFreq ratio 4.35, mono 1 |
| TRUE | `23_prismatic_strange_attractors` | `sliderLevel` | BRIGHTNESS | 0.3578 | claim_met | lumaMean swing 0.0114 ratio 7.07 (via ratio), monotonic 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderFloorLevel` | BRIGHTNESS | 0.3560 | claim_met | lumaMean swing 0.0113 ratio 1.66 (via ratio), monotonic 1 |
| TRUE | `40_lissajous_weave` | `sliderLocalSpeed` | SPEED | 0.3518 | claim_met | temporalRate 0.0026/0.0044/0.0077/0.0133/0.0207 (ratio 8.10, mono 1); temporalFreq ratio 8.78, mono 1 |
| TRUE | `54_murmuration_storm` | `sliderFocus` | SPATIAL | 0.3513 | claim_met | litFraction swing 0.3154, monotonic -1 |
| TRUE | `18_deep_space_lattice` | `sliderLocalSpeed` | SPEED | 0.3506 | claim_met | temporalRate 0.0013/0.0025/0.0050/0.0098/0.0177 (ratio 13.63, mono 1); temporalFreq ratio 14.20, mono 1 |
| TRUE | `07_shimmer` | `sliderLocalSpeed` | SPEED | 0.3494 | claim_met | temporalRate 0.0037/0.0065/0.0122/0.0231/0.0344 (ratio 9.29, mono 1); temporalFreq ratio 10.89, mono 1 |
| TRUE | `46_abyssal_fronds` | `sliderLevel` | BRIGHTNESS | 0.3456 | claim_met | lumaMean swing 0.0698 ratio 4.47 (via absolute), monotonic 1 |
| TRUE | `60_white_wash` | `sliderWhiteKick` | WHITE | 0.3440 | claim_met | wMean swing 0.3440 ratio 2.28 (via absolute, threshold 0.01) |
| TRUE | `02_phase_cathedral` | `sliderDirection` | DIRECTION | 0.3417 | claim_met | launch driftZ 0.1314/0.0435/0.0006/0.0012/-0.0325 (ends 0.1314 → -0.0325, floor ±0.004); velocity-series correlation low↔high -0.071 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderTrailDepth` | TRAIL | 0.3412 | claim_met | edgeSharpnessZ swing 0.0432 |
| TRUE | `08_ocean_liner` | `sliderLevel` | BRIGHTNESS | 0.3395 | claim_met | lumaMean swing 0.0722 ratio 1.57 (via absolute), monotonic 1 |
| TRUE | `32_caustic_shimmer` | `sliderLocalSpeed` | SPEED | 0.3381 | claim_met | temporalRate 0.0046/0.0092/0.0181/0.0326/0.0484 (ratio 10.47, mono 1); temporalFreq ratio 12.55, mono 1 |
| TRUE | `summer_camp/83_shadow_canopy_eclipse` | `sliderEclipseScale` | SPATIAL | 0.3346 | claim_met | litFraction swing 0.3346, monotonic -1 |
| TRUE | `24_chromatic_murmuration` | `sliderContrast` | CONTRAST | 0.3335 | claim_met | contrastRatio swing 0.0797 ratio 1.13 (via absolute) |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderLockdownPressure` | MAGNITUDE | 0.3322 | claim_met | dominant mover rMean 0.3322 |
| TRUE | `18_deep_space_lattice` | `sliderLineSoftness` | SPATIAL | 0.3314 | claim_met | litFraction swing 0.3314, monotonic -1 |
| TRUE | `50_phase_cathedral_hd` | `sliderSharpBase` | SPATIAL | 0.3282 | claim_met | litFraction swing 0.3282, monotonic -1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderCycleSpeed` | SPEED | 0.3254 | claim_met | temporalRate 0.0001/0.0003/0.0006/0.0008/0.0010 (ratio 7.89, mono 1); temporalFreq ratio 2.46, mono 1 |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderTrail` | TRAIL | 0.3212 | claim_met | litFraction swing 0.0505 |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderSweepWidth` | SPATIAL | 0.3199 | claim_met | spatialFreqX swing 0.0589, monotonic -1 |
| TRUE | `calib_swipe_left_right` | `sliderBandW` | SPATIAL | 0.3192 | claim_met | litFraction swing 0.3192, monotonic 1 |
| TRUE | `49_cylon_crush` | `sliderTrail` | TRAIL | 0.3173 | claim_met | litFraction swing 0.3173 |
| TRUE | `16_ghost_tide_uv` | `sliderUvLevel` | UV | 0.3157 | claim_met | uvMean swing 0.3157 ratio 315698.28 (via absolute, threshold 0.01) |
| TRUE | `24_chromatic_murmuration` | `sliderLocalSpeed` | SPEED | 0.3140 | claim_met | temporalRate 0.0040/0.0066/0.0107/0.0144/0.0166 (ratio 4.12, mono 1); temporalFreq ratio 5.96, mono 1 |
| TRUE | `30_bass_comet` | `sliderBass` | MAGNITUDE | 0.3132 | claim_met | dominant mover litFraction 0.3132 |
| TRUE | `12_breathing` | `sliderLocalSpeed` | SPEED | 0.3123 | claim_met | temporalRate 0.0011/0.0021/0.0043/0.0077/0.0119 (ratio 10.59, mono 1); temporalFreq ratio 13.27, mono 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderLatticeScale` | SPATIAL | 0.3122 | claim_met | spatialFreqY swing 0.3122, monotonic 1 |
| TRUE | `04_beat_folded_helix` | `sliderContrast` | CONTRAST | 0.3093 | claim_met | contrastRatio swing 0.3093 ratio 1.36 (via absolute) |
| TRUE | `23_prismatic_strange_attractors` | `sliderUvGhost` | UV | 0.3052 | claim_met | uvMean swing 0.0480 ratio 48015.03 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/85_redwood_starry_canopy` | `sliderStarEnergy` | MAGNITUDE | 0.3045 | claim_met | dominant mover rMean 0.3045 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderLocalSpeed` | SPEED | 0.2999 | claim_met | temporalRate 0.0025/0.0030/0.0042/0.0044/0.0076 (ratio 3.06, mono 1); temporalFreq ratio 2.87, mono 0 |
| TRUE | `03_dual_axis_crush` | `sliderRadius` | SPATIAL | 0.2966 | claim_met | spatialFreqY swing 0.1011, monotonic -1 |
| TRUE | `25_heartbeat` | `sliderLevel` | BRIGHTNESS | 0.2960 | claim_met | lumaMean swing 0.0107 ratio 1.90 (via ratio), monotonic 1 |
| TRUE | `summer_camp/85_redwood_starry_canopy` | `sliderBlackoutDepth` | DARKNESS | 0.2937 | claim_met | litFraction swing 0.0514 ratio 1.06 (via absolute), monotonic -1 (expected falling) |
| TRUE | `61_white_breathe` | `sliderDepth` | MAGNITUDE | 0.2934 | claim_met | dominant mover wMean 0.2934 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderLocalSpeed` | SPEED | 0.2930 | claim_met | temporalRate 0.0014/0.0029/0.0053/0.0100/0.0190 (ratio 13.47, mono 1); temporalFreq ratio 11.69, mono 1 |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderBaselineFloor` | MAGNITUDE | 0.2902 | claim_met | dominant mover contrastRatio 0.2902 |
| TRUE | `37_chevron_chase` | `sliderLocalSpeed` | SPEED | 0.2898 | claim_met | temporalRate 0.0010/0.0019/0.0035/0.0065/0.0118 (ratio 11.59, mono 1); temporalFreq ratio 10.30, mono 1 |
| TRUE | `11_bioluminescence` | `sliderLevel` | BRIGHTNESS | 0.2874 | claim_met | outputMean swing 0.0853 ratio 3.39 (via absolute), monotonic 1 |
| TRUE | `01_cylon_sweep` | `sliderTrail` | TRAIL | 0.2864 | claim_met | spatialFreqX swing 0.0972 |
| TRUE | `33_aurora_breath` | `sliderRibbons` | SPATIAL | 0.2859 | claim_met | spatialFreqZ swing 0.2859, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/65_dome_kick_shockwave` | `sliderVoidDepth` | DARKNESS | 0.2859 | claim_met | lumaMean swing 0.0095 ratio 5.31 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/83_shadow_canopy_eclipse` | `sliderLocalSpeed` | SPEED | 0.2850 | claim_met | temporalRate 0.0001/0.0004/0.0012/0.0039/0.0102 (ratio 79.30, mono 1); temporalFreq ratio 26.53, mono 1 |
| TRUE | `24_chromatic_murmuration` | `sliderFlockFocus` | SPATIAL | 0.2844 | claim_met | litFraction swing 0.2844, monotonic -1 |
| TRUE | `58_lighthouse_solo` | `sliderWidth` | SPATIAL | 0.2814 | claim_met | litFraction swing 0.2643, monotonic 1 |
| TRUE | `11_bioluminescence` | `sliderDensity` | SPATIAL | 0.2802 | claim_met | spatialFreqX swing 0.2802, monotonic 1 |
| TRUE | `20_parametric_sway_field` | `sliderDetail` | SPATIAL | 0.2789 | claim_met | litFraction swing 0.2761, monotonic -1 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderUvTrail` | UV | 0.2784 | claim_met | uvMean swing 0.0868 ratio 86753.52 (via absolute, threshold 0.01) |
| TRUE | `65_uv_only` | `sliderLocalSpeed` | SPEED | 0.2782 | claim_met | temporalRate 0.0003/0.0006/0.0012/0.0023/0.0044 (ratio 14.26, mono 1); temporalFreq ratio 7.13, mono 1 |
| TRUE | `summer_camp/48_titanic_sos_beacon` | `sliderLocalSpeed` | SPEED | 0.2774 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0005/0.0009 (ratio 11.77, mono 1); temporalFreq ratio 12.16, mono 1 |
| TRUE | `01_cylon_sweep` | `sliderEyeWidth` | SPATIAL | 0.2772 | claim_met | spatialFreqX swing 0.0725, monotonic 1 |
| TRUE | `30_bass_comet` | `sliderHeadKick` | MAGNITUDE | 0.2764 | claim_met | dominant mover litFraction 0.2764 |
| TRUE | `30_bass_comet` | `sliderLocalSpeed` | SPEED | 0.2723 | claim_met | temporalRate 0.0025/0.0038/0.0061/0.0083/0.0076 (ratio 3.37, mono 0); temporalFreq ratio 5.33, mono 1 |
| TRUE | `14_lunar_current` | `sliderUvLift` | UV | 0.2723 | claim_met | uvMean swing 0.2723 ratio 272271.07 (via absolute, threshold 0.01) |
| TRUE | `43_golden_hour_pulse` | `sliderLocalSpeed` | SPEED | 0.2722 | claim_met | temporalRate 0.0000/0.0000/0.0001/0.0001/0.0003 (ratio 21.37, mono 1); temporalFreq ratio 6993.01, mono 1 |
| TRUE | `63_white_chase` | `sliderDirection` | DIRECTION | 0.2717 | claim_met | launch driftX -0.0114/-0.0185/-0.0060/0.0033/0.0115 (ends -0.0114 → 0.0115, floor ±0.004); velocity-series correlation low↔high 0.039 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `64_temple_warm_white` | `sliderRadius` | SPATIAL | 0.2717 | claim_met | spatialFreqZ swing 0.2717, monotonic 0 [non-monotonic] |
| TRUE | `65_uv_only` | `sliderRadius` | SPATIAL | 0.2693 | claim_met | spatialFreqY swing 0.2693, monotonic 1 |
| TRUE | `06_neon_elevator` | `sliderLevel` | BRIGHTNESS | 0.2678 | claim_met | lumaMean swing 0.0179 ratio 2.63 (via ratio), monotonic 1 |
| TRUE | `15_silk_prism_ribbons` | `sliderShimmer` | MAGNITUDE | 0.2676 | claim_met | dominant mover contrastRatio 0.2676 |
| TRUE | `summer_camp/85_redwood_starry_canopy` | `sliderLocalSpeed` | SPEED | 0.2667 | claim_met | temporalRate 0.0095/0.0122/0.0166/0.0225/0.0291 (ratio 3.05, mono 1); temporalFreq ratio 3.25, mono 1 |
| TRUE | `22_abyssal_sway_garden` | `sliderFrondDensity` | SPATIAL | 0.2663 | claim_met | spatialFreqY swing 0.2663, monotonic 0 [non-monotonic] |
| TRUE | `45_manta_drift` | `sliderLocalSpeed` | SPEED | 0.2645 | claim_met | temporalRate 0.0001/0.0001/0.0001/0.0005/0.0009 (ratio 17.36, mono 1); temporalFreq ratio 1.48, mono 0 |
| TRUE | `00_golden_hour_wash` | `sliderRadius` | SPATIAL | 0.2600 | claim_met | spatialFreqZ swing 0.2600, monotonic 1 |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderLocalSpeed` | SPEED | 0.2593 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0006/0.0013 (ratio 14.21, mono 1); temporalFreq ratio 9.12, mono 1 |
| TRUE | `32_caustic_shimmer` | `sliderDepth` | MAGNITUDE | 0.2584 | claim_met | dominant mover litFraction 0.2584 |
| TRUE | `00_golden_hour_wash` | `sliderLocalSpeed` | SPEED | 0.2564 | claim_met | temporalRate 0.0016/0.0024/0.0040/0.0077/0.0140 (ratio 9.00, mono 1); temporalFreq ratio 11.71, mono 1 |
| TRUE | `summer_camp/45_engine_room_clockwork` | `sliderBlackoutDepth` | DARKNESS | 0.2554 | claim_met | lumaMean swing 0.0047 ratio 4684.54 (via ratio), monotonic -1 (expected falling) |
| TRUE | `63_white_chase` | `sliderCount` | SPATIAL | 0.2497 | claim_met | spatialFreqZ swing 0.2497, monotonic 1 |
| TRUE | `52_silk_ribbons` | `sliderSoftness` | SPATIAL | 0.2482 | claim_met | litFraction swing 0.2377, monotonic -1 |
| TRUE | `summer_camp/80_tree_canopy_fracture` | `sliderBranchSharpness` | SPATIAL | 0.2482 | claim_met | spatialFreqZ swing 0.0245, monotonic 0 [non-monotonic] |
| TRUE | `49_cylon_crush` | `sliderLocalSpeed` | SPEED | 0.2469 | claim_met | temporalRate 0.0047/0.0063/0.0083/0.0107/0.0129 (ratio 2.75, mono 1); temporalFreq ratio 3.86, mono 1 |
| TRUE | `26_dom_dancers_chevron` | `sliderBall1Energy` | MAGNITUDE | 0.2443 | claim_met | dominant mover spatialFreqZ 0.2443 |
| TRUE | `41_reaction_diffusion` | `sliderLocalSpeed` | SPEED | 0.2439 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0006/0.0011 (ratio 13.11, mono 1); temporalFreq ratio 18544.75, mono 1 |
| TRUE | `summer_camp/84_outpost_ember_overdrive` | `sliderLocalSpeed` | SPEED | 0.2428 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0007/0.0014 (ratio 13.25, mono 1); temporalFreq ratio 22.81, mono 1 |
| TRUE | `02_phase_cathedral` | `sliderLocalSpeed` | SPEED | 0.2425 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0003/0.0005 (ratio 7.32, mono 1); temporalFreq ratio 1.97, mono 0 |
| TRUE | `13_sparkle` | `sliderDirection` | DIRECTION | 0.2425 | claim_met | launch driftZ -0.0164/-0.0102/-0.0008/0.0049/0.0084 (ends -0.0164 → 0.0084, floor ±0.004); velocity-series correlation low↔high -0.262 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `09_cyclone` | `sliderWhiteLevel` | WHITE | 0.2417 | claim_met | wMean swing 0.0273 ratio 27281.42 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderUvIntensity` | UV | 0.2412 | claim_met | uvMean swing 0.1593 ratio 159342.74 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderBlackoutDepth` | DARKNESS | 0.2375 | claim_met | litFraction swing 0.1406 ratio 1.18 (via absolute), monotonic -1 (expected falling) |
| TRUE | `09_cyclone` | `sliderKick` | MAGNITUDE | 0.2364 | claim_met | dominant mover contrastRatio 0.2364 |
| TRUE | `summer_camp/80_tree_canopy_fracture` | `sliderFractureAmount` | MAGNITUDE | 0.2361 | claim_met | dominant mover contrastRatio 0.2361 |
| TRUE | `62_white_shimmer` | `sliderLocalSpeed` | SPEED | 0.2344 | claim_met | temporalRate 0.0054/0.0094/0.0172/0.0313/0.0523 (ratio 9.68, mono 1); temporalFreq ratio 9.54, mono 1 |
| TRUE | `60_white_wash` | `sliderRadius` | SPATIAL | 0.2331 | claim_met | spatialFreqZ swing 0.2331, monotonic 1 |
| TRUE | `62_white_shimmer` | `sliderWhiteLevel` | WHITE | 0.2329 | claim_met | wMean swing 0.1053 ratio 5.47 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/51_abyssal_searchlight` | `sliderBlackoutDepth` | DARKNESS | 0.2313 | claim_met | lumaMean swing 0.0031 ratio 200.05 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/53_shadow_eclipse` | `sliderLocalSpeed` | SPEED | 0.2309 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0001 (ratio 114.09, mono 1); temporalFreq ratio 115469.90, mono 1 |
| TRUE | `62_white_shimmer` | `sliderSharpness` | SPATIAL | 0.2308 | claim_met | litFraction swing 0.1916, monotonic -1 |
| TRUE | `65_uv_only` | `sliderSharpness` | SPATIAL | 0.2280 | claim_met | edgeSharpnessY swing 0.0442, monotonic -1 |
| TRUE | `61_white_breathe` | `sliderRadius` | SPATIAL | 0.2280 | claim_met | spatialFreqY swing 0.2280, monotonic 1 |
| TRUE | `53_neon_elevator_hd` | `sliderSharp` | SPATIAL | 0.2264 | claim_met | litFraction swing 0.2264, monotonic -1 |
| TRUE | `20_parametric_sway_field` | `sliderLocalSpeed` | SPEED | 0.2209 | claim_met | temporalRate 0.0004/0.0007/0.0015/0.0020/0.0025 (ratio 6.12, mono 1); temporalFreq ratio 2.66, mono 1 |
| TRUE | `58_lighthouse_solo` | `sliderLocalSpeed` | SPEED | 0.2206 | claim_met | temporalRate 0.0005/0.0007/0.0009/0.0015/0.0026 (ratio 5.02, mono 1); temporalFreq ratio 3.20, mono 1 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderBlackoutDepth` | DARKNESS | 0.2202 | claim_met | litFraction swing 0.0379 ratio 1.18 (via absolute), monotonic -1 (expected falling) |
| TRUE | `58_lighthouse_solo` | `sliderFlash` | MAGNITUDE | 0.2178 | claim_met | dominant mover contrastRatio 0.2178 |
| TRUE | `16_ghost_tide_uv` | `sliderWhiteLevel` | WHITE | 0.2174 | claim_met | wMean swing 0.1701 ratio 170083.80 (via absolute, threshold 0.01) |
| TRUE | `23_prismatic_strange_attractors` | `sliderRadius` | SPATIAL | 0.2173 | claim_met | spatialFreqY swing 0.0293, monotonic 0 [non-monotonic] |
| TRUE | `15_silk_prism_ribbons` | `sliderRadius` | SPATIAL | 0.2168 | claim_met | spatialFreqY swing 0.2168, monotonic 0 [non-monotonic] |
| TRUE | `52_silk_ribbons` | `sliderLocalSpeed` | SPEED | 0.2138 | claim_met | temporalRate 0.0033/0.0036/0.0035/0.0036/0.0050 (ratio 1.54, mono 1); temporalFreq ratio 9.68, mono 0 |
| TRUE | `summer_camp/71_tree_aurora` | `sliderWindShimmer` | MAGNITUDE | 0.2124 | claim_met | dominant mover temporalFreq 0.2124 |
| TRUE | `63_white_chase` | `sliderWhiteLevel` | WHITE | 0.2123 | claim_met | wMean swing 0.2123 ratio 6.04 (via absolute, threshold 0.01) |
| TRUE | `13_sparkle` | `sliderKick` | MAGNITUDE | 0.2116 | claim_met | dominant mover rMean 0.2116 |
| TRUE | `62_white_shimmer` | `sliderRadius` | SPATIAL | 0.2114 | claim_met | spatialFreqZ swing 0.1908, monotonic 0 [non-monotonic] |
| TRUE | `33_aurora_breath` | `sliderBase` | MAGNITUDE | 0.2098 | claim_met | dominant mover spatialFreqY 0.2098 |
| TRUE | `02_phase_cathedral` | `sliderRadius` | SPATIAL | 0.2059 | claim_met | spatialFreqX swing 0.2059, monotonic 0 [non-monotonic] |
| TRUE | `36_orbital_pulse` | `sliderLocalSpeed` | SPEED | 0.2045 | claim_met | temporalRate 0.0009/0.0021/0.0038/0.0071/0.0135 (ratio 15.33, mono 1); temporalFreq ratio 18.47, mono 1 |
| TRUE | `44_biolume_swell` | `sliderSwell` | MAGNITUDE | 0.2044 | claim_met | dominant mover uvMean 0.2044 |
| TRUE | `37_chevron_chase` | `sliderCount` | SPATIAL | 0.2038 | claim_met | spatialFreqY swing 0.2038, monotonic 0 [non-monotonic] |
| TRUE | `test/test_params` | `sliderSpeed` | SPEED | 0.2038 | claim_met | temporalRate 0.0000/0.0005/0.0010/0.0015/0.0020 (ratio 2020.87, mono 1); temporalFreq ratio 6162.41, mono 1 |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderSweepWidth` | SPATIAL | 0.2036 | claim_met | litFraction swing 0.2036, monotonic 1 |
| TRUE | `21_pelagic_manta_rays` | `sliderRadius` | SPATIAL | 0.2011 | claim_met | litFraction swing 0.1477, monotonic 1 |
| TRUE | `08_ocean_liner` | `sliderWhiteKick` | WHITE | 0.2011 | claim_met | wMean swing 0.0243 ratio 3.64 (via absolute, threshold 0.01) |
| TRUE | `63_white_chase` | `sliderLocalSpeed` | SPEED | 0.2011 | claim_met | temporalRate 0.0031/0.0066/0.0110/0.0191/0.0335 (ratio 10.78, mono 1); temporalFreq ratio 12.45, mono 1 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderBlackoutDepth` | DARKNESS | 0.2001 | claim_met | litFraction swing 0.1248 ratio 1.25 (via absolute), monotonic -1 (expected falling) |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderRingRate` | SPEED | 0.1980 | claim_met | temporalRate 0.0002/0.0010/0.0017/0.0026/0.0033 (ratio 18.14, mono 1); temporalFreq ratio 11.02, mono 1 |
| TRUE | `09_cyclone` | `sliderRadius` | SPATIAL | 0.1975 | claim_met | litFraction swing 0.0543, monotonic -1 |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderSweepWidth` | SPATIAL | 0.1968 | claim_met | litFraction swing 0.1003, monotonic 1 |
| TRUE | `29_kick_shockwave` | `sliderRingWidth` | SPATIAL | 0.1966 | claim_met | spatialFreqZ swing 0.0326, monotonic 0 [non-monotonic] |
| TRUE | `34_moire_interference` | `sliderLocalSpeed` | SPEED | 0.1948 | claim_met | temporalRate 0.0008/0.0015/0.0026/0.0047/0.0090 (ratio 11.38, mono 1); temporalFreq ratio 7.54, mono 1 |
| TRUE | `20_parametric_sway_field` | `sliderRadius` | SPATIAL | 0.1944 | claim_met | litFraction swing 0.1944, monotonic 0 [non-monotonic] |
| TRUE | `14_lunar_current` | `sliderDensity` | SPATIAL | 0.1938 | claim_met | spatialFreqY swing 0.1938, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderSweepImpact` | MAGNITUDE | 0.1936 | claim_met | dominant mover rMean 0.1936 |
| TRUE | `05_orbital_attractor_field` | `sliderLocalSpeed` | SPEED | 0.1934 | claim_met | temporalRate 0.0005/0.0009/0.0018/0.0031/0.0058 (ratio 12.35, mono 1); temporalFreq ratio 11.28, mono 1 |
| TRUE | `summer_camp/74_lookout_gyro_vortex` | `sliderSweepImpact` | MAGNITUDE | 0.1920 | claim_met | dominant mover spatialFreqY 0.1920 |
| TRUE | `11_bioluminescence` | `sliderKick` | MAGNITUDE | 0.1917 | claim_met | dominant mover contrastRatio 0.1917 |
| TRUE | `01_cylon_sweep` | `sliderLocalSpeed` | SPEED | 0.1909 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0005/0.0011 (ratio 10.52, mono 1); temporalFreq ratio 1.35, mono 1 |
| TRUE | `23_prismatic_strange_attractors` | `sliderLocalSpeed` | SPEED | 0.1906 | claim_met | temporalRate 0.0014/0.0028/0.0032/0.0038/0.0044 (ratio 3.07, mono 1); temporalFreq ratio 2.09, mono 1 |
| TRUE | `46_abyssal_fronds` | `sliderLocalSpeed` | SPEED | 0.1905 | claim_met | temporalRate 0.0002/0.0003/0.0004/0.0006/0.0008 (ratio 4.99, mono 1); temporalFreq ratio 1.45, mono 1 |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderLocalSpeed` | SPEED | 0.1905 | claim_met | temporalRate 0.0001/0.0001/0.0004/0.0011/0.0026 (ratio 35.58, mono 1); temporalFreq ratio 9.65, mono 1 |
| TRUE | `09_cyclone` | `sliderDensity` | SPATIAL | 0.1896 | claim_met | spatialFreqY swing 0.0676, monotonic -1 |
| TRUE | `11_bioluminescence` | `sliderUvGlow` | UV | 0.1895 | claim_met | uvMean swing 0.1895 ratio 16.99 (via absolute, threshold 0.01) |
| TRUE | `04_beat_folded_helix` | `sliderKick` | MAGNITUDE | 0.1893 | claim_met | dominant mover edgeSharpnessX 0.1893 |
| TRUE | `summer_camp/56_stage_mirror_axis` | `sliderLocalSpeed` | SPEED | 0.1881 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0002 (ratio 45.88, mono 1); temporalFreq ratio 94067.22, mono 1 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderVortexSpeed` | SPEED | 0.1877 | claim_met | temporalRate 0.0006/0.0033/0.0053/0.0078/0.0096 (ratio 14.96, mono 1); temporalFreq ratio 8.61, mono 1 |
| TRUE | `03_dual_axis_crush` | `sliderDirection` | DIRECTION | 0.1853 | claim_met | launch driftY -0.0191/-0.0191/0.0237/0.0237/0.0237 (ends -0.0191 → 0.0237, floor ±0.004); velocity-series correlation low↔high -0.263 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `10_chasers` | `sliderKick` | MAGNITUDE | 0.1848 | claim_met | dominant mover rMean 0.1848 |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderRippleWidth` | SPATIAL | 0.1841 | claim_met | edgeSharpnessZ swing 0.0212, monotonic 1 |
| TRUE | `20_parametric_sway_field` | `sliderDirection` | DIRECTION | 0.1841 | claim_met | launch driftY -0.2034/-0.1540/0.1295/0.1729/0.1741 (ends -0.2034 → 0.1741, floor ±0.004); velocity-series correlation low↔high -0.359 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `17_rolling_color_dunes` | `sliderRadius` | SPATIAL | 0.1837 | claim_met | spatialFreqX swing 0.0266, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderAudioMid` | MAGNITUDE | 0.1830 | claim_met | dominant mover contrastRatio 0.1830 |
| TRUE | `64_temple_warm_white` | `sliderWhiteLevel` | WHITE | 0.1825 | claim_met | wMean swing 0.1825 ratio 58.85 (via absolute, threshold 0.01) |
| TRUE | `54_murmuration_storm` | `sliderLocalSpeed` | SPEED | 0.1823 | claim_met | temporalRate 0.0009/0.0013/0.0022/0.0042/0.0085 (ratio 9.75, mono 1); temporalFreq ratio 3.46, mono 1 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderAudioMid` | MAGNITUDE | 0.1819 | claim_met | dominant mover contrastRatio 0.1819 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderContrast` | CONTRAST | 0.1817 | claim_met | contrastRatio swing 0.1817 ratio 1.28 (via absolute) |
| TRUE | `06_neon_elevator` | `sliderRadius` | SPATIAL | 0.1815 | claim_met | litFraction swing 0.1147, monotonic 1 |
| TRUE | `12_breathing` | `sliderWhiteKick` | WHITE | 0.1808 | claim_met | wMean swing 0.0613 ratio 3.88 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderTrail` | TRAIL | 0.1800 | claim_met | litFraction swing 0.0772 |
| TRUE | `26_dom_dancers_chevron` | `sliderBall2Energy` | MAGNITUDE | 0.1799 | claim_met | dominant mover spatialFreqZ 0.1800 |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderLocalSpeed` | SPEED | 0.1768 | claim_met | temporalRate 0.0005/0.0013/0.0033/0.0086/0.0204 (ratio 38.68, mono 1); temporalFreq ratio 18.66, mono 1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderAudioBass` | MAGNITUDE | 0.1747 | claim_met | dominant mover contrastRatio 0.1747 |
| TRUE | `04_beat_folded_helix` | `sliderDirection` | DIRECTION | 0.1746 | claim_met | launch driftX -0.0087/0.0011/0.0017/0.0197/0.0167 (ends -0.0087 → 0.0167, floor ±0.004); velocity-series correlation low↔high -0.225 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `transitions/trans_diagonal_wipe` | `sliderFeather` | SPATIAL | 0.1744 | claim_met | spatialFreqY swing 0.0516, monotonic -1 |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderAudioBass` | MAGNITUDE | 0.1734 | claim_met | dominant mover litFraction 0.1734 |
| TRUE | `02_phase_cathedral` | `sliderCount` | SPATIAL | 0.1724 | claim_met | spatialFreqZ swing 0.1724, monotonic 0 [non-monotonic] |
| TRUE | `47_quasicrystal_dunes` | `sliderLocalSpeed` | SPEED | 0.1702 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0004/0.0008 (ratio 9.14, mono 1); temporalFreq ratio 1.76, mono 1 |
| TRUE | `summer_camp/83_shadow_canopy_eclipse` | `sliderWarpAmount` | MAGNITUDE | 0.1697 | claim_met | dominant mover spatialFreqY 0.1697 |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderLocalSpeed` | SPEED | 0.1686 | claim_met | temporalRate 0.0001/0.0001/0.0004/0.0008/0.0017 (ratio 32.51, mono 1); temporalFreq ratio 15.43, mono 1 |
| TRUE | `20_parametric_sway_field` | `sliderTrailBlend` | TRAIL | 0.1676 | claim_met | litFraction swing 0.1676 |
| TRUE | `65_uv_only` | `sliderKick` | MAGNITUDE | 0.1673 | claim_met | dominant mover uvMean 0.1673 |
| TRUE | `summer_camp/55_stardust_dome` | `sliderBlackoutDepth` | DARKNESS | 0.1673 | claim_met | lumaMean swing 0.0025 ratio 2502.09 (via ratio), monotonic -1 (expected falling) |
| TRUE | `03_dual_axis_crush` | `sliderBeamWidth` | SPATIAL | 0.1671 | claim_met | litFraction swing 0.1671, monotonic 1 |
| TRUE | `summer_camp/71_tree_aurora` | `sliderCabinWarmth` | WARMTH | 0.1661 | claim_met | aMean swing 0.0931 ratio 93051.83 (via absolute), hue 0.0000 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderEmberDepth` | MAGNITUDE | 0.1661 | claim_met | dominant mover spatialFreqZ 0.1661 |
| TRUE | `summer_camp/84_outpost_ember_overdrive` | `sliderUvIntensity` | UV | 0.1655 | claim_met | uvMean swing 0.0622 ratio 62209.67 (via absolute, threshold 0.01) |
| TRUE | `33_aurora_breath` | `sliderLocalSpeed` | SPEED | 0.1652 | claim_met | temporalRate 0.0002/0.0004/0.0004/0.0006/0.0012 (ratio 5.04, mono 1); temporalFreq ratio 1.69, mono 0 |
| TRUE | `summer_camp/73_tree_shadow_breath` | `sliderLocalSpeed` | SPEED | 0.1649 | claim_met | temporalRate 0.0004/0.0005/0.0007/0.0010/0.0020 (ratio 5.00, mono 1); temporalFreq ratio 2.01, mono 0 |
| TRUE | `21_pelagic_manta_rays` | `sliderLocalSpeed` | SPEED | 0.1648 | claim_met | temporalRate 0.0007/0.0013/0.0032/0.0066/0.0126 (ratio 16.95, mono 1); temporalFreq ratio 8.85, mono 1 |
| TRUE | `15_silk_prism_ribbons` | `sliderRibbonCount` | SPATIAL | 0.1643 | claim_met | spatialFreqY swing 0.1643, monotonic 0 [non-monotonic] |
| TRUE | `22_abyssal_sway_garden` | `sliderRadius` | SPATIAL | 0.1617 | claim_met | spatialFreqX swing 0.0516, monotonic -1 |
| TRUE | `00_golden_hour_wash` | `sliderDirection` | DIRECTION | 0.1614 | claim_met | launch driftY 0.0590/0.0406/-0.0096/-0.0475/-0.0159 (ends 0.0590 → -0.0159, floor ±0.004); velocity-series correlation low↔high -0.587 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `27_swipe` | `sliderTrail` | TRAIL | 0.1603 | claim_met | spatialFreqY swing 0.1126 |
| TRUE | `04_beat_folded_helix` | `sliderWhiteKick` | WHITE | 0.1597 | claim_met | wMean swing 0.0997 ratio 2.95 (via absolute, threshold 0.01) |
| TRUE | `42_phyllotaxis_spiral` | `sliderLocalSpeed` | SPEED | 0.1586 | claim_met | temporalRate 0.0001/0.0002/0.0004/0.0006/0.0008 (ratio 6.76, mono 1); temporalFreq ratio 2.04, mono 1 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderCampfireHeat` | MAGNITUDE | 0.1576 | claim_met | dominant mover litFraction 0.1576 |
| TRUE | `summer_camp/53_shadow_eclipse` | `sliderBlackoutDepth` | DARKNESS | 0.1564 | claim_met | lumaMean swing 0.0017 ratio 1094.26 (via ratio), monotonic -1 (expected falling) |
| TRUE | `32_caustic_shimmer` | `sliderRipple` | MAGNITUDE | 0.1551 | claim_met | dominant mover contrastRatio 0.1551 |
| TRUE | `summer_camp/46_dome_lockdown` | `sliderAmberMix` | WHITE | 0.1541 | claim_met | aMean swing 0.0184 ratio 2.35 (via absolute, threshold 0.01) |
| TRUE | `08_ocean_liner` | `sliderWhiteLevel` | WHITE | 0.1534 | claim_met | wMean swing 0.0189 ratio 2.59 (via absolute, threshold 0.01) |
| TRUE | `21_pelagic_manta_rays` | `sliderKick` | MAGNITUDE | 0.1527 | claim_met | dominant mover rMean 0.1527 |
| TRUE | `23_prismatic_strange_attractors` | `sliderChaos` | MAGNITUDE | 0.1516 | claim_met | dominant mover spatialFreqZ 0.1516 |
| TRUE | `08_ocean_liner` | `sliderLocalSpeed` | SPEED | 0.1508 | claim_met | temporalRate 0.0014/0.0025/0.0043/0.0082/0.0166 (ratio 11.63, mono 1); temporalFreq ratio 6.77, mono 1 |
| TRUE | `64_temple_warm_white` | `sliderLevel` | BRIGHTNESS | 0.1504 | claim_met | outputMean swing 0.0868 ratio 4.18 (via absolute), monotonic 1 |
| TRUE | `31_strobe_lattice` | `sliderScale` | SPATIAL | 0.1504 | claim_met | spatialFreqX swing 0.1504, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderSweepImpact` | MAGNITUDE | 0.1499 | claim_met | dominant mover contrastRatio 0.1500 |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderLocalSpeed` | SPEED | 0.1480 | claim_met | temporalRate 0.0001/0.0001/0.0003/0.0005/0.0011 (ratio 14.89, mono 1); temporalFreq ratio 4.78, mono 1 |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderTrailLength` | TRAIL | 0.1468 | claim_met | litFraction swing 0.0628 |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderTreeSpread` | SPATIAL | 0.1467 | claim_met | edgeSharpnessZ swing 0.0319, monotonic -1 |
| TRUE | `07_shimmer` | `sliderKick` | MAGNITUDE | 0.1459 | claim_met | dominant mover rMean 0.1459 |
| TRUE | `15_silk_prism_ribbons` | `sliderLocalSpeed` | SPEED | 0.1446 | claim_met | temporalRate 0.0005/0.0010/0.0020/0.0039/0.0081 (ratio 15.54, mono 1); temporalFreq ratio 7.56, mono 1 |
| TRUE | `04_beat_folded_helix` | `sliderRadius` | SPATIAL | 0.1443 | claim_met | spatialFreqX swing 0.1443, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderAudioBass` | MAGNITUDE | 0.1439 | claim_met | dominant mover contrastRatio 0.1439 |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderUvIntensity` | UV | 0.1438 | claim_met | uvMean swing 0.0806 ratio 80642.82 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/80_tree_canopy_fracture` | `sliderLocalSpeed` | SPEED | 0.1431 | claim_met | temporalRate 0.0002/0.0004/0.0005/0.0007/0.0013 (ratio 8.88, mono 1); temporalFreq ratio 5.31, mono 1 |
| TRUE | `24_chromatic_murmuration` | `sliderLevel` | BRIGHTNESS | 0.1421 | claim_met | lumaMean swing 0.0196 ratio 2.23 (via ratio), monotonic 1 |
| TRUE | `summer_camp/82_redwood_timber_fall` | `sliderDustGlow` | BRIGHTNESS | 0.1418 | claim_met | outputMean swing 0.0132 ratio 1.40 (via ratio), monotonic 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderKick` | MAGNITUDE | 0.1418 | claim_met | dominant mover contrastRatio 0.1418 |
| TRUE | `65_uv_only` | `sliderDirection` | DIRECTION | 0.1410 | claim_met | launch driftY 0.0052/0.0026/-0.0005/-0.0025/-0.0051 (ends 0.0052 → -0.0051, floor ±0.004); velocity-series correlation low↔high -0.008 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `24_chromatic_murmuration` | `sliderRadius` | SPATIAL | 0.1396 | claim_met | spatialFreqY swing 0.0589, monotonic -1 |
| TRUE | `summer_camp/79_mill_pressure_release` | `sliderPressure` | MAGNITUDE | 0.1364 | claim_met | dominant mover temporalFreq 0.1364 |
| TRUE | `14_lunar_current` | `sliderWhiteLift` | WHITE | 0.1351 | claim_met | wMean swing 0.1350 ratio 135049.36 (via absolute, threshold 0.01) |
| TRUE | `01_cylon_sweep` | `sliderRadius` | SPATIAL | 0.1347 | claim_met | spatialFreqY swing 0.1347, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/52_iceberg_shear_line` | `sliderSubmergeDepth` | MAGNITUDE | 0.1328 | claim_met | dominant mover spatialFreqX 0.1329 |
| TRUE | `31_strobe_lattice` | `sliderLocalSpeed` | SPEED | 0.1327 | claim_met | temporalRate 0.0000/0.0000/0.0001/0.0002/0.0004 (ratio 16.42, mono 1); temporalFreq ratio 2.41, mono 1 |
| TRUE | `36_orbital_pulse` | `sliderReach` | SPATIAL | 0.1326 | claim_met | spatialFreqZ swing 0.1325, monotonic -1 |
| TRUE | `29_kick_shockwave` | `sliderDecay` | TRAIL | 0.1323 | claim_met | spatialFreqZ swing 0.1322 |
| TRUE | `21_pelagic_manta_rays` | `sliderUvUndertow` | UV | 0.1322 | claim_met | uvMean swing 0.1322 ratio 132216.55 (via absolute, threshold 0.01) |
| TRUE | `61_white_breathe` | `sliderKick` | MAGNITUDE | 0.1317 | claim_met | dominant mover wMean 0.1317 |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderGearDrive` | MAGNITUDE | 0.1310 | claim_met | dominant mover spatialFreqZ 0.1310 |
| TRUE | `14_lunar_current` | `sliderLocalSpeed` | SPEED | 0.1308 | claim_met | temporalRate 0.0004/0.0009/0.0017/0.0037/0.0072 (ratio 16.46, mono 1); temporalFreq ratio 4.15, mono 1 |
| TRUE | `summer_camp/54_boiler_fire_overdrive` | `sliderLocalSpeed` | SPEED | 0.1301 | claim_met | temporalRate 0.0000/0.0000/0.0001/0.0001/0.0002 (ratio 11.36, mono 1); temporalFreq ratio 11.79, mono 1 |
| TRUE | `31_strobe_lattice` | `sliderSharp` | SPATIAL | 0.1292 | claim_met | litFraction swing 0.1292, monotonic -1 |
| TRUE | `01_cylon_sweep` | `sliderKick` | MAGNITUDE | 0.1290 | claim_met | dominant mover rMean 0.1290 |
| TRUE | `50_phase_cathedral_hd` | `sliderPhaseShift` | MAGNITUDE | 0.1283 | claim_met | dominant mover spatialFreqZ 0.1283 |
| TRUE | `39_tide_riser` | `sliderFoam` | MAGNITUDE | 0.1283 | claim_met | dominant mover litFraction 0.1283 |
| TRUE | `16_ghost_tide_uv` | `sliderTideWidth` | SPATIAL | 0.1282 | claim_met | edgeSharpnessX swing 0.1282, monotonic 1 |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderBlackoutDepth` | DARKNESS | 0.1279 | claim_met | litFraction swing 0.1125 ratio 1.27 (via absolute), monotonic -1 (expected falling) |
| TRUE | `11_bioluminescence` | `sliderLocalSpeed` | SPEED | 0.1272 | claim_met | temporalRate 0.0016/0.0029/0.0054/0.0100/0.0191 (ratio 11.87, mono 1); temporalFreq ratio 5.19, mono 1 |
| TRUE | `38_prism_helix` | `sliderLocalSpeed` | SPEED | 0.1271 | claim_met | temporalRate 0.0011/0.0017/0.0025/0.0041/0.0073 (ratio 6.64, mono 1); temporalFreq ratio 2.73, mono 0 |
| TRUE | `51_confetti_cyclone` | `sliderLocalSpeed` | SPEED | 0.1271 | claim_met | temporalRate 0.0016/0.0020/0.0030/0.0042/0.0068 (ratio 4.34, mono 1); temporalFreq ratio 4.94, mono 1 |
| TRUE | `24_chromatic_murmuration` | `sliderDetail` | SPATIAL | 0.1260 | claim_met | spatialFreqY swing 0.0610, monotonic 0 [non-monotonic] |
| TRUE | `04_beat_folded_helix` | `sliderLocalSpeed` | SPEED | 0.1259 | claim_met | temporalRate 0.0007/0.0016/0.0030/0.0064/0.0125 (ratio 18.30, mono 1); temporalFreq ratio 8.62, mono 1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderBlackoutDepth` | DARKNESS | 0.1234 | claim_met | litFraction swing 0.1234 ratio 1.68 (via absolute), monotonic -1 (expected falling) |
| TRUE | `summer_camp/49_boiler_pressure_release` | `sliderLocalSpeed` | SPEED | 0.1234 | claim_met | temporalRate 0.0000/0.0001/0.0001/0.0002/0.0004 (ratio 39.05, mono 1); temporalFreq ratio 61708.56, mono 1 |
| TRUE | `13_sparkle` | `sliderLocalSpeed` | SPEED | 0.1229 | claim_met | temporalRate 0.0008/0.0016/0.0025/0.0029/0.0029 (ratio 3.56, mono 1); temporalFreq ratio 4.34, mono 0 |
| TRUE | `63_white_chase` | `sliderTailLength` | TRAIL | 0.1220 | claim_met | edgeSharpnessX swing 0.0567 |
| TRUE | `14_lunar_current` | `sliderShimmer` | MAGNITUDE | 0.1214 | claim_met | dominant mover spatialFreqZ 0.1214 |
| TRUE | `46_abyssal_fronds` | `sliderBreathDepth` | MAGNITUDE | 0.1202 | claim_met | dominant mover spatialFreqZ 0.1202 |
| TRUE | `63_white_chase` | `sliderWhiteKick` | WHITE | 0.1195 | claim_met | wMean swing 0.1195 ratio 1.94 (via absolute, threshold 0.01) |
| TRUE | `18_deep_space_lattice` | `sliderRadius` | SPATIAL | 0.1193 | claim_met | spatialFreqX swing 0.0278, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderLocalSpeed` | SPEED | 0.1177 | claim_met | temporalRate 0.0013/0.0016/0.0021/0.0032/0.0068 (ratio 5.11, mono 1); temporalFreq ratio 5.10, mono 1 |
| TRUE | `44_biolume_swell` | `sliderUvGlow` | UV | 0.1177 | claim_met | uvMean swing 0.1177 ratio 117655.65 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderBlackoutDepth` | DARKNESS | 0.1176 | claim_met | litFraction swing 0.0272 ratio 1.25 (via absolute), monotonic -1 (expected falling) |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderBlackoutDepth` | DARKNESS | 0.1154 | claim_met | lumaMean swing 0.0034 ratio 1.28 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/41_ghost_aurora` | `sliderBlackoutDepth` | DARKNESS | 0.1135 | claim_met | lumaMean swing 0.0047 ratio 118.19 (via ratio), monotonic -1 (expected falling) |
| TRUE | `18_deep_space_lattice` | `sliderDetail` | SPATIAL | 0.1134 | claim_met | litFraction swing 0.1134, monotonic -1 |
| TRUE | `summer_camp/74_lookout_gyro_vortex` | `sliderLocalSpeed` | SPEED | 0.1132 | claim_met | temporalRate 0.0003/0.0004/0.0009/0.0025/0.0063 (ratio 22.47, mono 1); temporalFreq ratio 12.04, mono 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderLocalSpeed` | SPEED | 0.1110 | claim_met | temporalRate 0.0011/0.0019/0.0040/0.0081/0.0137 (ratio 13.04, mono 1); temporalFreq ratio 9.11, mono 1 |
| TRUE | `08_ocean_liner` | `sliderKick` | MAGNITUDE | 0.1091 | claim_met | dominant mover rMean 0.1091 |
| TRUE | `summer_camp/84_outpost_ember_overdrive` | `sliderEmberSpeed` | SPEED | 0.1090 | claim_met | temporalRate 0.0003/0.0003/0.0004/0.0004/0.0005 (ratio 2.00, mono 1); temporalFreq ratio 1.13, mono 1 |
| TRUE | `summer_camp/81_outpost_distress_beacon` | `sliderLocalSpeed` | SPEED | 0.1086 | claim_met | temporalRate 0.0001/0.0001/0.0001/0.0001/0.0003 (ratio 5.46, mono 1); temporalFreq ratio 1.87, mono 1 |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderBlackoutDepth` | DARKNESS | 0.1081 | claim_met | litFraction swing 0.0273 ratio 1.37 (via absolute), monotonic -1 (expected falling) |
| TRUE | `00_golden_hour_wash` | `sliderKick` | MAGNITUDE | 0.1079 | claim_met | dominant mover contrastRatio 0.1079 |
| TRUE | `39_tide_riser` | `sliderLocalSpeed` | SPEED | 0.1074 | claim_met | temporalRate 0.0001/0.0003/0.0006/0.0012/0.0021 (ratio 14.92, mono 1); temporalFreq ratio 10.22, mono 1 |
| TRUE | `18_deep_space_lattice` | `sliderKick` | MAGNITUDE | 0.1072 | claim_met | dominant mover rMean 0.1072 |
| TRUE | `51_confetti_cyclone` | `sliderKick` | MAGNITUDE | 0.1055 | claim_met | dominant mover litFraction 0.1055 |
| TRUE | `summer_camp/51_abyssal_searchlight` | `sliderLocalSpeed` | SPEED | 0.1049 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0002 (ratio 20.72, mono 1); temporalFreq ratio 16.00, mono 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderDirection` | DIRECTION | 0.1039 | claim_met | launch driftZ -0.0070/-0.0437/0.0053/0.0251/0.0655 (ends -0.0070 → 0.0655, floor ±0.004); velocity-series correlation low↔high 0.051 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderFlickerSpeed` | SPEED | 0.1033 | claim_met | temporalRate 0.0057/0.0070/0.0087/0.0117/0.0197 (ratio 3.45, mono 1); temporalFreq ratio 4.16, mono 1 |
| TRUE | `09_cyclone` | `sliderWhiteKick` | WHITE | 0.1030 | claim_met | wMean swing 0.0119 ratio 2.61 (via absolute, threshold 0.01) |
| TRUE | `60_white_wash` | `sliderLocalSpeed` | SPEED | 0.1030 | claim_met | temporalRate 0.0014/0.0028/0.0048/0.0086/0.0164 (ratio 11.57, mono 1); temporalFreq ratio 7.73, mono 1 |
| TRUE | `transitions/trans_wipe_right` | `sliderFeather` | SPATIAL | 0.1024 | claim_met | spatialFreqZ swing 0.1024, monotonic -1 |
| TRUE | `29_kick_shockwave` | `sliderLocalSpeed` | SPEED | 0.1022 | claim_met | temporalRate 0.0022/0.0044/0.0044/0.0066/0.0067 (ratio 3.07, mono 1); temporalFreq ratio 2.68, mono 1 |
| TRUE | `12_breathing` | `sliderSharpness` | SPATIAL | 0.1017 | claim_met | spatialFreqY swing 0.1018, monotonic -1 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderProngSpread` | SPATIAL | 0.1016 | claim_met | litFraction swing 0.1016, monotonic 0 [non-monotonic] |
| TRUE | `64_temple_warm_white` | `sliderLocalSpeed` | SPEED | 0.1010 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0003/0.0005 (ratio 7.44, mono 1); temporalFreq ratio 4232.23, mono 0 |
| TRUE | `summer_camp/79_mill_pressure_release` | `sliderBoilerHeat` | MAGNITUDE | 0.1008 | claim_met | dominant mover spatialFreqZ 0.1008 |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderDripTrail` | TRAIL | 0.1000 | claim_met | spatialFreqZ swing 0.0571 |
| TRUE | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderBlackoutDepth` | DARKNESS | 0.0996 | claim_met | lumaMean swing 0.0039 ratio 8.48 (via ratio), monotonic -1 (expected falling) |
| TRUE | `26_dom_dancers_chevron` | `sliderBaseGlow` | BRIGHTNESS | 0.0994 | claim_met | lumaMean swing 0.0211 ratio 1.07 (via absolute), monotonic 1 |
| TRUE | `42_phyllotaxis_spiral` | `sliderTwinkle` | MAGNITUDE | 0.0991 | claim_met | dominant mover contrastRatio 0.0991 |
| TRUE | `16_ghost_tide_uv` | `sliderKick` | MAGNITUDE | 0.0990 | claim_met | dominant mover edgeSharpnessX 0.0990 |
| TRUE | `11_bioluminescence` | `sliderRadius` | SPATIAL | 0.0987 | claim_met | spatialFreqZ swing 0.0987, monotonic 0 [non-monotonic] |
| TRUE | `14_lunar_current` | `sliderRadius` | SPATIAL | 0.0987 | claim_met | spatialFreqZ swing 0.0987, monotonic 0 [non-monotonic] |
| TRUE | `43_golden_hour_pulse` | `sliderShimmer` | MAGNITUDE | 0.0985 | claim_met | dominant mover contrastRatio 0.0985 |
| TRUE | `62_white_shimmer` | `sliderWhiteKick` | WHITE | 0.0984 | claim_met | wMean swing 0.0675 ratio 2.08 (via absolute, threshold 0.01) |
| TRUE | `60_white_wash` | `sliderKick` | MAGNITUDE | 0.0969 | claim_met | dominant mover wMean 0.0969 |
| TRUE | `22_abyssal_sway_garden` | `sliderKick` | MAGNITUDE | 0.0960 | claim_met | dominant mover contrastRatio 0.0960 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderUvIntensity` | UV | 0.0959 | claim_met | uvMean swing 0.0960 ratio 95950.18 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderImpact` | MAGNITUDE | 0.0949 | claim_met | dominant mover wMean 0.0949 |
| TRUE | `40_lissajous_weave` | `sliderSpread` | SPATIAL | 0.0946 | claim_met | spatialFreqY swing 0.0839, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/65_dome_kick_shockwave` | `sliderLocalSpeed` | SPEED | 0.0935 | claim_met | temporalRate 0.0008/0.0015/0.0032/0.0059/0.0060 (ratio 7.81, mono 1); temporalFreq ratio 5.34, mono 1 |
| TRUE | `summer_camp/79_mill_pressure_release` | `sliderCoolingAfterglow` | TRAIL | 0.0930 | claim_met | litFraction swing 0.0930 |
| TRUE | `transitions/trans_split_horizontal` | `sliderFeather` | SPATIAL | 0.0925 | claim_met | spatialFreqZ swing 0.0839, monotonic -1 |
| TRUE | `summer_camp/50_iceberg_fracture` | `sliderLocalSpeed` | SPEED | 0.0924 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0002 (ratio 10.41, mono 1); temporalFreq ratio 8.41, mono 1 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderAudioBass` | MAGNITUDE | 0.0923 | claim_met | dominant mover rMean 0.0923 |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderBlackoutDepth` | DARKNESS | 0.0922 | claim_met | litFraction swing 0.0382 ratio 1.05 (via absolute), monotonic -1 (expected falling) |
| TRUE | `transitions/trans_wipe_left` | `sliderFeather` | SPATIAL | 0.0920 | claim_met | spatialFreqX swing 0.0248, monotonic 1 |
| TRUE | `11_bioluminescence` | `sliderWhiteLevel` | WHITE | 0.0918 | claim_met | wMean swing 0.0607 ratio 4.17 (via absolute, threshold 0.01) |
| TRUE | `08_ocean_liner` | `sliderDetail` | SPATIAL | 0.0912 | claim_met | spatialFreqY swing 0.0912, monotonic -1 |
| TRUE | `64_temple_warm_white` | `sliderWhiteKick` | WHITE | 0.0910 | claim_met | wMean swing 0.0910 ratio 1.72 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderOrbitDrift` | MAGNITUDE | 0.0906 | claim_met | dominant mover driftZ 0.0906 |
| TRUE | `transitions/trans_diamond_wipe` | `sliderFeather` | SPATIAL | 0.0906 | claim_met | spatialFreqZ swing 0.0399, monotonic -1 |
| TRUE | `24_chromatic_murmuration` | `sliderDirection` | DIRECTION | 0.0905 | claim_met | launch driftZ 0.1511/0.1511/-0.1843/-0.1843/-0.1843 (ends 0.1511 → -0.1843, floor ±0.004); velocity-series correlation low↔high -0.189 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/48_titanic_sos_beacon` | `sliderSignalSpeed` | SPEED | 0.0897 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0003/0.0003 (ratio 2.53, mono 1); temporalFreq ratio 3.28, mono 1 |
| TRUE | `transitions/trans_iris` | `sliderFeather` | SPATIAL | 0.0897 | claim_met | spatialFreqY swing 0.0399, monotonic -1 |
| TRUE | `transitions/trans_wipe_down` | `sliderFeather` | SPATIAL | 0.0896 | claim_met | spatialFreqZ swing 0.0640, monotonic -1 |
| TRUE | `transitions/trans_split_vertical` | `sliderFeather` | SPATIAL | 0.0886 | claim_met | spatialFreqZ swing 0.0335, monotonic -1 |
| TRUE | `50_phase_cathedral_hd` | `sliderLocalSpeed` | SPEED | 0.0881 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0004/0.0007 (ratio 9.42, mono 1); temporalFreq ratio 3.73, mono 1 |
| TRUE | `15_silk_prism_ribbons` | `sliderKick` | MAGNITUDE | 0.0881 | claim_met | dominant mover rMean 0.0881 |
| TRUE | `52_silk_ribbons` | `sliderShimmer` | MAGNITUDE | 0.0880 | claim_met | dominant mover contrastRatio 0.0880 |
| TRUE | `36_orbital_pulse` | `sliderBase` | MAGNITUDE | 0.0878 | claim_met | dominant mover rMean 0.0878 |
| TRUE | `13_sparkle` | `sliderWhiteGlint` | WHITE | 0.0878 | claim_met | wMean swing 0.0051 ratio 5134.01 (via ratio, threshold 0.01) |
| TRUE | `16_ghost_tide_uv` | `sliderRadius` | SPATIAL | 0.0874 | claim_met | edgeSharpnessX swing 0.0874, monotonic 1 |
| TRUE | `summer_camp/42_boiler_glow` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0024 ratio 38.08 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/47_apex_perimeter_ping` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0040 ratio 31.48 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/48_titanic_sos_beacon` | `sliderAbyssalDarkness` | DARKNESS | 0.0870 | claim_met | litFraction swing 0.0249 ratio 1.48 (via absolute), monotonic -1 (expected falling) |
| TRUE | `summer_camp/54_boiler_fire_overdrive` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | litFraction swing 0.0090 ratio 1.88 (via ratio), monotonic -1 (expected falling) |
| TRUE | `transitions/trans_iris_close` | `sliderFeather` | SPATIAL | 0.0868 | claim_met | spatialFreqZ swing 0.0272, monotonic -1 |
| TRUE | `summer_camp/41_ghost_aurora` | `sliderLocalSpeed` | SPEED | 0.0863 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0001 (ratio 13.73, mono 1); temporalFreq ratio 19561.52, mono 1 |
| TRUE | `summer_camp/46_dome_lockdown` | `sliderBlackoutDepth` | DARKNESS | 0.0862 | claim_met | lumaMean swing 0.0032 ratio 5.82 (via ratio), monotonic -1 (expected falling) |
| TRUE | `35_sparkle_rain` | `sliderLocalSpeed` | SPEED | 0.0854 | claim_met | temporalRate 0.0007/0.0008/0.0008/0.0009/0.0011 (ratio 1.53, mono 1); temporalFreq ratio 1.67, mono 1 |
| TRUE | `00_golden_hour_wash` | `sliderWarmth` | WARMTH | 0.0848 | claim_met | rMean swing 0.0842 ratio 1.34 (via absolute), hue 0.0000 |
| TRUE | `transitions/trans_wave_sweep` | `sliderFeather` | SPATIAL | 0.0843 | claim_met | spatialFreqZ swing 0.0722, monotonic -1 |
| TRUE | `07_shimmer` | `sliderDetail` | SPATIAL | 0.0837 | claim_met | spatialFreqZ swing 0.0528, monotonic -1 |
| TRUE | `04_beat_folded_helix` | `sliderWhiteLevel` | WHITE | 0.0822 | claim_met | wMean swing 0.0676 ratio 2.41 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderLocalSpeed` | SPEED | 0.0820 | claim_met | temporalRate 0.0000/0.0001/0.0002/0.0005/0.0012 (ratio 28.65, mono 1); temporalFreq ratio 8.78, mono 1 |
| TRUE | `63_white_chase` | `sliderRadius` | SPATIAL | 0.0816 | claim_met | edgeSharpnessX swing 0.0816, monotonic 1 |
| TRUE | `23_prismatic_strange_attractors` | `sliderKick` | MAGNITUDE | 0.0809 | claim_met | dominant mover contrastRatio 0.0809 |
| TRUE | `summer_camp/73_tree_shadow_breath` | `sliderBlackoutDepth` | DARKNESS | 0.0805 | claim_met | lumaMean swing 0.0145 ratio 1.30 (via ratio), monotonic -1 (expected falling) |
| TRUE | `21_pelagic_manta_rays` | `sliderDirection` | DIRECTION | 0.0779 | claim_met | launch driftX -0.0075/-0.0075/0.0177/0.0177/0.0177 (ends -0.0075 → 0.0177, floor ±0.004); velocity-series correlation low↔high -0.223 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `29_kick_shockwave` | `sliderKick` | MAGNITUDE | 0.0779 | responds_to_edges_not_to_level | held static the control does nothing, but pulsed 0↔1 at 40 frames it moves spatialFreqZ by 0.0779 — this is an edge-triggered control, meant to be driven by a modulation mapping rather than parked at a value |
| TRUE | `44_biolume_swell` | `sliderLocalSpeed` | SPEED | 0.0776 | claim_met | temporalRate 0.0007/0.0011/0.0017/0.0028/0.0048 (ratio 7.14, mono 1); temporalFreq ratio 6.40, mono 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderWhiteKick` | WHITE | 0.0776 | claim_met | wMean swing 0.0504 ratio 3.08 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/56_stage_mirror_axis` | `sliderOrbitSpeed` | SPEED | 0.0769 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0001 (ratio 5.98, mono 1); temporalFreq ratio 38461.54, mono 1 |
| TRUE | `07_shimmer` | `sliderWhiteLevel` | WHITE | 0.0764 | claim_met | wMean swing 0.0224 ratio 3.99 (via absolute, threshold 0.01) |
| TRUE | `21_pelagic_manta_rays` | `sliderWhiteFoam` | WHITE | 0.0761 | claim_met | wMean swing 0.0761 ratio 76094.72 (via absolute, threshold 0.01) |
| TRUE | `08_ocean_liner` | `sliderRadius` | SPATIAL | 0.0755 | claim_met | spatialFreqY swing 0.0755, monotonic 1 |
| TRUE | `62_white_shimmer` | `sliderKick` | MAGNITUDE | 0.0754 | claim_met | dominant mover edgeSharpnessX 0.0754 |
| TRUE | `10_chasers` | `sliderRadius` | SPATIAL | 0.0751 | claim_met | litFraction swing 0.0751, monotonic 1 |
| TRUE | `summer_camp/84_outpost_ember_overdrive` | `sliderFlashRate` | SPEED | 0.0747 | claim_met | temporalRate 0.0004/0.0004/0.0004/0.0004/0.0005 (ratio 1.30, mono 1); temporalFreq ratio 1.09, mono 0 |
| TRUE | `13_sparkle` | `sliderWhiteKick` | WHITE | 0.0746 | claim_met | wMean swing 0.0041 ratio 2.60 (via ratio, threshold 0.01) |
| TRUE | `63_white_chase` | `sliderKick` | MAGNITUDE | 0.0729 | claim_met | dominant mover edgeSharpnessX 0.0729 |
| TRUE | `summer_camp/74_lookout_gyro_vortex` | `sliderVortexSpeed` | SPEED | 0.0728 | claim_met | temporalRate 0.0000/0.0005/0.0009/0.0016/0.0023 (ratio 2343.60, mono 1); temporalFreq ratio 19452.02, mono 1 |
| TRUE | `09_cyclone` | `sliderDirection` | DIRECTION | 0.0717 | claim_met | launch driftX 0.0756/0.0756/-0.0462/-0.0462/-0.0462 (ends 0.0756 → -0.0462, floor ±0.004); velocity-series correlation low↔high 0.184 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `19_swaying_lattice_ballet` | `sliderCounterPhase` | MAGNITUDE | 0.0709 | claim_met | dominant mover spatialFreqZ 0.0710 |
| TRUE | `transitions/trans_wave_sweep` | `sliderWaveAmp` | MAGNITUDE | 0.0703 | claim_met | dominant mover spatialFreqZ 0.0704 |
| TRUE | `summer_camp/71_tree_aurora` | `sliderUvIntensity` | UV | 0.0684 | claim_met | uvMean swing 0.0383 ratio 38340.70 (via absolute, threshold 0.01) |
| TRUE | `61_white_breathe` | `sliderLocalSpeed` | SPEED | 0.0682 | claim_met | temporalRate 0.0002/0.0002/0.0004/0.0006/0.0013 (ratio 7.81, mono 1); temporalFreq ratio 2.55, mono 0 |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderShimmer` | MAGNITUDE | 0.0681 | claim_met | dominant mover contrastRatio 0.0681 |
| TRUE | `13_sparkle` | `sliderWhiteLevel` | WHITE | 0.0677 | claim_met | wMean swing 0.0034 ratio 4.84 (via ratio, threshold 0.01) |
| TRUE | `60_white_wash` | `sliderDirection` | DIRECTION | 0.0664 | claim_met | launch driftY 0.0086/0.0046/-0.0004/-0.0056/-0.0122 (ends 0.0086 → -0.0122, floor ±0.004); velocity-series correlation low↔high -0.573 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `07_shimmer` | `sliderDirection` | DIRECTION | 0.0660 | claim_met | launch driftY -0.0471/-0.0471/0.0490/0.0490/0.0490 (ends -0.0471 → 0.0490, floor ±0.004); velocity-series correlation low↔high 0.223 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderAudioBass` | MAGNITUDE | 0.0645 | claim_met | dominant mover contrastRatio 0.0645 |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderBlackoutDepth` | DARKNESS | 0.0638 | claim_met | litFraction swing 0.0353 ratio 1.04 (via absolute), monotonic -1 (expected falling) |
| TRUE | `19_swaying_lattice_ballet` | `sliderRadius` | SPATIAL | 0.0622 | claim_met | spatialFreqX swing 0.0402, monotonic 1 |
| TRUE | `26_dom_dancers_chevron` | `sliderLocalSpeed` | SPEED | 0.0610 | claim_met | temporalRate 0.0004/0.0008/0.0018/0.0036/0.0071 (ratio 18.76, mono 1); temporalFreq ratio 6.43, mono 1 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderVintageMix` | MAGNITUDE | 0.0607 | claim_met | dominant mover spatialFreqZ 0.0607 |
| TRUE | `05_orbital_attractor_field` | `sliderDirection` | DIRECTION | 0.0604 | claim_met | launch driftY -0.0257/-0.0145/0.0024/0.0147/0.0195 (ends -0.0257 → 0.0195, floor ±0.004); velocity-series correlation low↔high 0.613 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `12_breathing` | `sliderWhiteLevel` | WHITE | 0.0602 | claim_met | wMean swing 0.0283 ratio 4.31 (via absolute, threshold 0.01) |
| TRUE | `48_heartbeat_drive` | `sliderLocalSpeed` | SPEED | 0.0598 | claim_met | temporalRate 0.0003/0.0003/0.0007/0.0015/0.0019 (ratio 6.52, mono 1); temporalFreq ratio 6.85, mono 0 |
| TRUE | `summer_camp/55_stardust_dome` | `sliderWallHit` | MAGNITUDE | 0.0594 | claim_met | dominant mover temporalFreq 0.0594 |
| TRUE | `31_strobe_lattice` | `sliderFlash` | MAGNITUDE | 0.0584 | claim_met | dominant mover contrastRatio 0.0584 |
| TRUE | `23_prismatic_strange_attractors` | `sliderDetail` | SPATIAL | 0.0564 | claim_met | spatialFreqZ swing 0.0408, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/53_shadow_eclipse` | `sliderCoronaPulse` | MAGNITUDE | 0.0562 | claim_met | dominant mover driftY 0.0562 |
| TRUE | `38_prism_helix` | `sliderShimmer` | MAGNITUDE | 0.0560 | claim_met | dominant mover temporalFreq 0.0560 |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderAudioKick` | MAGNITUDE | 0.0557 | claim_met | dominant mover contrastRatio 0.0557 |
| TRUE | `46_abyssal_fronds` | `sliderBreathRate` | SPEED | 0.0544 | claim_met | temporalRate 0.0005/0.0005/0.0004/0.0005/0.0006 (ratio 1.55, mono 0); temporalFreq ratio 1.45, mono 1 |
| TRUE | `summer_camp/53_shadow_eclipse` | `sliderRimWidth` | SPATIAL | 0.0543 | claim_met | spatialFreqZ swing 0.0272, monotonic 1 |
| TRUE | `13_sparkle` | `sliderDensity` | SPATIAL | 0.0528 | claim_met | spatialFreqY swing 0.0453, monotonic 0 [non-monotonic] |
| TRUE | `11_bioluminescence` | `sliderWhiteKick` | WHITE | 0.0507 | claim_met | wMean swing 0.0319 ratio 1.95 (via absolute, threshold 0.01) |
| TRUE | `19_swaying_lattice_ballet` | `sliderWhiteLevel` | WHITE | 0.0496 | claim_met | wMean swing 0.0280 ratio 3.74 (via absolute, threshold 0.01) |
| TRUE | `04_beat_folded_helix` | `sliderCount` | SPATIAL | 0.0492 | claim_met | spatialFreqY swing 0.0492, monotonic 0 [non-monotonic] |
| TRUE | `50_phase_cathedral_hd` | `sliderKickLock` | MAGNITUDE | 0.0492 | claim_met | dominant mover spatialFreqZ 0.0492 |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderAudioKick` | MAGNITUDE | 0.0484 | responds_to_edges_not_to_level | held static the control does nothing, but pulsed 0↔1 at 40 frames it moves contrastRatio by 0.0484 — this is an edge-triggered control, meant to be driven by a modulation mapping rather than parked at a value |
| TRUE | `21_pelagic_manta_rays` | `sliderDetail` | SPATIAL | 0.0466 | claim_met | spatialFreqY swing 0.0211, monotonic -1 |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderCrownImpact` | MAGNITUDE | 0.0435 | claim_met | dominant mover contrastRatio 0.0435 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderNeighborWeight` | MAGNITUDE | 0.0435 | claim_met | dominant mover contrastRatio 0.0435 |
| TRUE | `summer_camp/85_redwood_starry_canopy` | `sliderWallHit` | MAGNITUDE | 0.0427 | claim_met | dominant mover litFraction 0.0427 |
| TRUE | `34_moire_interference` | `sliderPulse` | MAGNITUDE | 0.0425 | claim_met | dominant mover rMean 0.0425 |
| TRUE | `33_aurora_breath` | `sliderBreathDepth` | MAGNITUDE | 0.0423 | claim_met | dominant mover spatialFreqY 0.0423 |
| TRUE | `12_breathing` | `sliderRipple` | MAGNITUDE | 0.0411 | claim_met | dominant mover spatialFreqY 0.0411 |
| TRUE | `summer_camp/52_iceberg_shear_line` | `sliderWarmthRetreat` | WARMTH | 0.0411 | claim_met | aMean swing 0.0026 ratio 2574.80 (via ratio), hue 0.0000 |
| TRUE | `35_sparkle_rain` | `sliderKick` | MAGNITUDE | 0.0409 | claim_met | dominant mover temporalFreq 0.0409 |
| TRUE | `40_lissajous_weave` | `sliderKick` | MAGNITUDE | 0.0403 | claim_met | dominant mover driftY 0.0403 |
| TRUE | `49_cylon_crush` | `sliderKick` | MAGNITUDE | 0.0399 | responds_to_edges_not_to_level | held static the control does nothing, but pulsed 0↔1 at 40 frames it moves temporalFreq by 0.0399 — this is an edge-triggered control, meant to be driven by a modulation mapping rather than parked at a value |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderNeighborWeight` | MAGNITUDE | 0.0393 | claim_met | dominant mover spatialFreqY 0.0393 |
| TRUE | `14_lunar_current` | `sliderKick` | MAGNITUDE | 0.0392 | claim_met | dominant mover rMean 0.0392 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderWoodSparkle` | MAGNITUDE | 0.0391 | claim_met | dominant mover temporalRate 0.0391 |
| TRUE | `summer_camp/46_dome_lockdown` | `sliderHoldBlackout` | DARKNESS | 0.0390 | claim_met | lumaMean swing 0.0015 ratio 2.01 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderVintageWash` | MAGNITUDE | 0.0380 | claim_met | dominant mover spatialFreqY 0.0380 |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderBreathRate` | SPEED | 0.0364 | claim_met | temporalRate 0.0001/0.0004/0.0007/0.0010/0.0013 (ratio 12.15, mono 1); temporalFreq ratio 4.92, mono 1 |
| TRUE | `44_biolume_swell` | `sliderKick` | MAGNITUDE | 0.0356 | claim_met | dominant mover spatialFreqY 0.0356 |
| TRUE | `summer_camp/74_lookout_gyro_vortex` | `sliderUvIntensity` | UV | 0.0356 | claim_met | uvMean swing 0.0188 ratio 18770.14 (via absolute, threshold 0.01) |
| TRUE | `08_ocean_liner` | `sliderWhiteSpread` | WHITE | 0.0344 | claim_met | wMean swing 0.0260 ratio 2.57 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderLocalSpeed` | SPEED | 0.0341 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0002 (ratio 13.44, mono 1); temporalFreq ratio 3.44, mono 1 |
| TRUE | `40_lissajous_weave` | `sliderBase` | MAGNITUDE | 0.0328 | claim_met | dominant mover litFraction 0.0328 |
| TRUE | `25_heartbeat` | `sliderDetail` | SPATIAL | 0.0318 | claim_met | litFraction swing 0.0201, monotonic -1 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderArmPhase` | MAGNITUDE | 0.0314 | claim_met | dominant mover contrastRatio 0.0314 |
| TRUE | `summer_camp/43_sea_floor_shadow` | `sliderLocalSpeed` | SPEED | 0.0302 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0001 (ratio 102.31, mono 1); temporalFreq ratio 11056.51, mono 1 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderAudioKick` | MAGNITUDE | 0.0296 | claim_met | dominant mover contrastRatio 0.0296 |
| TRUE | `summer_camp/65_dome_kick_shockwave` | `sliderShockSpeed` | SPEED | 0.0290 | claim_met | temporalRate 0.0026/0.0029/0.0031/0.0033/0.0035 (ratio 1.35, mono 1); temporalFreq ratio 1.29, mono 1 |
| TRUE | `07_shimmer` | `sliderWhiteKick` | WHITE | 0.0284 | claim_met | wMean swing 0.0085 ratio 1.59 (via ratio, threshold 0.01) |
| TRUE | `03_dual_axis_crush` | `sliderKick` | MAGNITUDE | 0.0281 | claim_met | dominant mover rMean 0.0281 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderAudioBass` | MAGNITUDE | 0.0278 | claim_met | dominant mover contrastRatio 0.0278 |
| TRUE | `summer_camp/80_tree_canopy_fracture` | `sliderBlackoutDepth` | DARKNESS | 0.0275 | claim_met | litFraction swing 0.0134 ratio 1.33 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderBoilerHeat` | MAGNITUDE | 0.0268 | claim_met | dominant mover aMean 0.0268 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderBeaconSparkle` | MAGNITUDE | 0.0261 | claim_met | dominant mover driftZ 0.0261 |
| TRUE | `summer_camp/51_abyssal_searchlight` | `sliderBeamWidth` | SPATIAL | 0.0260 | claim_met | spatialFreqX swing 0.0260, monotonic -1 |
| TRUE | `summer_camp/73_tree_shadow_breath` | `sliderEdgeShimmer` | MAGNITUDE | 0.0257 | claim_met | dominant mover temporalFreq 0.0257 |
| TRUE | `summer_camp/52_iceberg_shear_line` | `sliderShearWidth` | SPATIAL | 0.0254 | claim_met | spatialFreqX swing 0.0254, monotonic -1 |
| TRUE | `summer_camp/46_dome_lockdown` | `sliderLocalSpeed` | SPEED | 0.0252 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0001 (ratio 4.40, mono 1); temporalFreq ratio 3496.50, mono 0 |
| TRUE | `45_manta_drift` | `sliderFoam` | MAGNITUDE | 0.0248 | claim_met | dominant mover spatialFreqY 0.0248 |
| TRUE | `64_temple_warm_white` | `sliderKick` | MAGNITUDE | 0.0238 | claim_met | dominant mover wMean 0.0238 |
| TRUE | `19_swaying_lattice_ballet` | `sliderWhiteSpread` | WHITE | 0.0236 | claim_met | wMean swing 0.0133 ratio 1.76 (via absolute, threshold 0.01) |
| TRUE | `13_sparkle` | `sliderUvGlint` | UV | 0.0235 | claim_met | uvMean swing 0.0026 ratio 2551.16 (via ratio, threshold 0.01) |
| TRUE | `summer_camp/52_iceberg_shear_line` | `sliderLocalSpeed` | SPEED | 0.0230 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0000 (ratio 17.79, mono 1); temporalFreq ratio 0.00, mono 0 |
| TRUE | `summer_camp/45_engine_room_clockwork` | `sliderDriveShaft` | MAGNITUDE | 0.0223 | claim_met | dominant mover spatialFreqX 0.0223 |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderVintageMix` | MAGNITUDE | 0.0221 | claim_met | dominant mover contrastRatio 0.0221 |
| TRUE | `summer_camp/45_engine_room_clockwork` | `sliderPauseAmount` | MAGNITUDE | 0.0217 | claim_met | dominant mover spatialFreqX 0.0217 |
| TRUE | `summer_camp/45_engine_room_clockwork` | `sliderLocalSpeed` | SPEED | 0.0133 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0000 (ratio 14.94, mono 1); temporalFreq ratio 0.00, mono 0 |
| TRUE | `28_spectrum_bloom` | `sliderLocalSpeed` | SPEED | 0.0106 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0001 (ratio 19.42, mono 1); temporalFreq ratio 0.00, mono 0 |
