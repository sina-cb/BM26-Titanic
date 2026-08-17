# Parameter truth sweep

Model `titanic` (964 px) · 144 frames after 36 warmup · sweep points 0, 0.25, 0.5, 0.75, 1

Patterns swept 278 · compile errors 0 · no params 26 · params measured 1608

| Class | Count |
|---|---:|
| WRONG | 35 |
| DEAD | 106 |
| WEAK | 31 |
| UNKNOWN_CLAIM | 185 |
| TRUE | 1251 |

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
| `summer_camp/51_abyssal_searchlight` | `sliderSwirlMix` | WEAK | 0.00727 |
| `summer_camp/45_engine_room_clockwork` | `sliderBoilerHeat` | WEAK | 0.01252 |
| `summer_camp/56_stage_mirror_axis` | `sliderParticleDensity` | TRUE | 0.0909 |
| `summer_camp/50_iceberg_fracture` | `sliderBranchSpread` | TRUE | 0.16946 |
| `summer_camp/55_stardust_dome` | `sliderOrbitSpeed` | TRUE | 0.10568 |
| `summer_camp/55_stardust_dome` | `sliderParticleDensity` | TRUE | 0.26838 |
| `summer_camp/81_outpost_distress_beacon` | `sliderBlackoutDepth` | WRONG | 0.06522 |
| `summer_camp/55_stardust_dome` | `sliderLocalSpeed` | TRUE | 0.23339 |
| `summer_camp/56_stage_mirror_axis` | `sliderStageFocus` | TRUE | 0.28874 |
| `01_cylon_sweep` | `sliderWhiteLevel` | TRUE | 0.08696 |
| `01_cylon_sweep` | `sliderWhiteKick` | TRUE | 0.17391 |
| `01_cylon_sweep` | `sliderBlinderBite` | WEAK | 0.00725 |
| `05_orbital_attractor_field` | `sliderKick` | TRUE | 0.31358 |
| `05_orbital_attractor_field` | `sliderFalloff` | UNKNOWN_CLAIM | 0.03513 |
| `05_orbital_attractor_field` | `sliderWhiteLevel` | WEAK | 0.00652 |
| `06_neon_elevator` | `sliderKick` | TRUE | 0.093 |
| `06_neon_elevator` | `sliderSteps` | UNKNOWN_CLAIM | 0.06814 |
| `06_neon_elevator` | `sliderWhiteLevel` | TRUE | 0.07639 |
| `06_neon_elevator` | `sliderWhiteKick` | TRUE | 0.06706 |
| `06_neon_elevator` | `sliderBlinderBite` | TRUE | 0.03472 |
| `09_cyclone` | `sliderBlinderBite` | TRUE | 0.06532 |
| `17_rolling_color_dunes` | `sliderKick` | TRUE | 0.25494 |
| `17_rolling_color_dunes` | `sliderStageSurf` | UNKNOWN_CLAIM | 0.08287 |
| `17_rolling_color_dunes` | `sliderAmberWarmth` | WRONG | 0.03923 |
| `17_rolling_color_dunes` | `sliderWhiteLevel` | TRUE | 0.07749 |
| `25_heartbeat` | `sliderBlinder` | TRUE | 0.2268 |
| `25_heartbeat` | `sliderBlinderBite` | TRUE | 0.07805 |
| `28_spectrum_bloom` | `sliderMid` | WEAK | 0.01887 |
| `28_spectrum_bloom` | `sliderHigh` | TRUE | 0.03696 |
| `36_orbital_pulse` | `sliderPulse` | TRUE | 0.09904 |
| `summer_camp/41_ghost_aurora` | `sliderCurtainWidth` | TRUE | 0.38292 |
| `summer_camp/41_ghost_aurora` | `sliderDriftChaos` | TRUE | 0.07264 |
| `summer_camp/41_ghost_aurora` | `sliderTriangleGain` | TRUE | 0.24095 |
| `summer_camp/42_boiler_glow` | `sliderVentWidth` | TRUE | 0.18394 |
| `summer_camp/42_boiler_glow` | `sliderSteamFlash` | TRUE | 0.08637 |
| `summer_camp/42_boiler_glow` | `sliderTriangleRPM` | TRUE | 0.28385 |
| `summer_camp/42_boiler_glow` | `sliderFlashRate` | TRUE | 0.06906 |
| `summer_camp/43_sea_floor_shadow` | `sliderShadowWidth` | WRONG | 0.04733 |
| `summer_camp/43_sea_floor_shadow` | `sliderShadowDrift` | WRONG | 0.05256 |
| `summer_camp/43_sea_floor_shadow` | `sliderEdgeFoam` | TRUE | 0.03212 |
| `summer_camp/43_sea_floor_shadow` | `sliderTriangleSilhouette` | UNKNOWN_CLAIM | 0.06208 |
| `summer_camp/46_dome_lockdown` | `sliderDirection` | WRONG | 0.50708 |
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
| `summer_camp/54_boiler_fire_overdrive` | `sliderFlameHeight` | WRONG | 0.12951 |
| `summer_camp/55_stardust_dome` | `sliderStarCore` | TRUE | 0.16999 |
| `summer_camp/56_stage_mirror_axis` | `sliderUvEdge` | TRUE | 0.06718 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderArmCount` | WEAK | 0.01561 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderSeedSize` | WEAK | 0.01932 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderBreathDepth` | TRUE | 0.02446 |
| `summer_camp/63_dome_phyllotaxis_bloom` | `sliderCenterImpact` | WEAK | 0.01812 |
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
- `130_spatial_paint` — 7: `sliderLocalSpeed` (DEAD), `sliderLevel` (DEAD), `sliderKick` (DEAD), `sliderTouch` (DEAD), `sliderPulse` (DEAD), `sliderDrawMode` (DEAD), `sliderTrailFade` (DEAD)
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
- `summer_camp/43_sea_floor_shadow` — 4: `sliderShadowWidth` (DEAD), `sliderShadowDrift` (DEAD), `sliderEdgeFoam` (DEAD), `sliderTriangleSilhouette` (DEAD)
- `summer_camp/45_engine_room_clockwork` — 4: `sliderGearSharpness` (DEAD), `sliderPistonStroke` (DEAD), `sliderBarTickDensity` (DEAD), `sliderBoilerHeat` (DEAD)
- `summer_camp/49_boiler_pressure_release` — 4: `sliderVentWidth` (DEAD), `sliderVentFlash` (DEAD), `sliderCoolingAfterglow` (DEAD), `sliderSteamRise` (DEAD)
- `summer_camp/50_iceberg_fracture` — 4: `sliderFractureDensity` (WRONG), `sliderBranchSpread` (DEAD), `sliderLaneCount` (DEAD), `sliderShardJag` (DEAD)
- `summer_camp/51_abyssal_searchlight` — 4: `sliderBeamReach` (WRONG), `sliderBeamPunch` (DEAD), `sliderTrailLength` (DEAD), `sliderSwirlMix` (DEAD)
- `summer_camp/82_redwood_timber_fall` — 4: `sliderLocalSpeed` (DEAD), `sliderFallDuration` (DEAD), `sliderStandBrightness` (DEAD), `sliderImpactFlash` (DEAD)
- `summer_camp/41_ghost_aurora` — 3: `sliderCurtainWidth` (DEAD), `sliderDriftChaos` (DEAD), `sliderTriangleGain` (DEAD)
- `summer_camp/81_outpost_distress_beacon` — 3: `sliderSignalStrength` (DEAD), `sliderBeamWidth` (WRONG), `sliderBlackoutDepth` (DEAD)
- `04_beat_folded_helix` — 2: `sliderTwistFreq` (WRONG), `sliderWhiteWarmth` (WRONG)
- `23_prismatic_strange_attractors` — 2: `sliderDirection` (WRONG), `sliderColorSpread` (DEAD)
- `25_heartbeat` — 2: `sliderBlinder` (DEAD), `sliderBlinderBite` (DEAD)
- `28_spectrum_bloom` — 2: `sliderMid` (DEAD), `sliderHigh` (DEAD)
- `summer_camp/111_logsville_giant_pixel_heartbeat` — 2: `sliderPopBrightness` (WRONG), `sliderSectionCount` (WRONG)
- `summer_camp/112_logsville_giant_call_response` — 2: `sliderTurnBrightness` (WRONG), `sliderSectionCount` (WRONG)
- `summer_camp/113_tower_column_breath` — 2: `sliderLocalSpeed` (DEAD), `sliderVintageGlow` (WRONG)
- `summer_camp/114_tower_ring_chase` — 2: `sliderLocalSpeed` (DEAD), `sliderDirection` (WRONG)
- `summer_camp/40_ghost_ship_reveal` — 2: `sliderLanternGlow` (WRONG), `sliderPortBrightness` (WRONG)
- `summer_camp/65_dome_kick_shockwave` — 2: `sliderRingWidth` (DEAD), `sliderEchoes` (DEAD)
- `09_cyclone` — 1: `sliderBlinderBite` (DEAD)
- `10_chasers` — 1: `sliderDirection` (WRONG)
- `15_silk_prism_ribbons` — 1: `sliderDirection` (WRONG)
- `36_orbital_pulse` — 1: `sliderPulse` (DEAD)
- `40_lissajous_weave` — 1: `sliderDetail` (WRONG)
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
| WRONG | `17_rolling_color_dunes` | `sliderDirection` | DIRECTION | 0.1409 | no_reversal_net_travel_or_velocity_series | launch driftY -0.0046/-0.0021/-0.0001/-0.0059/-0.0142 (ends -0.0046 → -0.0142, floor ±0.004); velocity-series correlation low↔high -0.005 (reversal at ≤ -0.3) — but the sweep DID move contrastRatio by 0.1409 |
| WRONG | `summer_camp/40_ghost_ship_reveal` | `sliderLanternGlow` | BRIGHTNESS | 0.1251 | luma_did_not_track_slider | outputMean swing 0.0008 ratio 1.06 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.1251 |
| WRONG | `01_cylon_sweep` | `sliderDirection` | DIRECTION | 0.1242 | no_reversal_net_travel_or_velocity_series | launch driftX 0.1224/0.0963/0.0048/0.0943/0.1234 (ends 0.1224 → 0.1234, floor ±0.004); velocity-series correlation low↔high 0.494 (reversal at ≤ -0.3) — but the sweep DID move contrastRatio by 0.1242 |
| WRONG | `summer_camp/72_outpost_campfire` | `sliderLocalSpeed` | SPEED | 0.1037 | temporal_rate_did_not_track_slider | temporalRate 0.0089/0.0091/0.0091/0.0097/0.0106 (ratio 1.19, mono 1); temporalFreq ratio 1.34, mono 0 — but the sweep DID move contrastRatio by 0.1037 |
| WRONG | `23_prismatic_strange_attractors` | `sliderDirection` | DIRECTION | 0.1037 | no_reversal_net_travel_or_velocity_series | launch driftX -0.0255/-0.0255/-0.0472/-0.0472/-0.0472 (ends -0.0255 → -0.0472, floor ±0.004); velocity-series correlation low↔high -0.016 (reversal at ≤ -0.3) — but the sweep DID move driftY by 0.1037 |
| WRONG | `summer_camp/53_shadow_eclipse` | `sliderShadowSize` | DARKNESS | 0.1008 | output_did_not_fall_with_slider | litFraction swing 0.0003 ratio 1.56 (via none), monotonic 0 (expected falling) — but the sweep DID move driftY by 0.1008 |
| WRONG | `10_chasers` | `sliderDirection` | DIRECTION | 0.0999 | no_reversal_net_travel_or_velocity_series | launch driftY 0.0929/0.0929/0.0854/0.0854/0.0854 (ends 0.0929 → 0.0854, floor ±0.004); velocity-series correlation low↔high -0.069 (reversal at ≤ -0.3) — but the sweep DID move driftY by 0.0999 |
| WRONG | `summer_camp/83_shadow_canopy_eclipse` | `sliderShadowDepth` | DARKNESS | 0.0888 | darkness_inverted_adds_light | outputMean swing 0.0081 ratio 1.25 (via ratio), monotonic 1 (expected falling) — but the sweep DID move spatialFreqY by 0.0888 |
| WRONG | `transitions/trans_wave_sweep` | `sliderWaveFreq` | SPEED | 0.0849 | temporal_rate_did_not_track_slider | temporalRate 0.0024/0.0024/0.0024/0.0024/0.0024 (ratio 1.00, mono 0); temporalFreq ratio 1.00, mono 0 — but the sweep DID move hueMean by 0.0849 |
| WRONG | `05_orbital_attractor_field` | `sliderColorVariation` | HUE | 0.0842 | hue_and_saturation_static | hue circular swing 0.0000 turns (normalised 0.0000), saturation swing 0.0000 — but the sweep DID move rMean by 0.0842 |
| WRONG | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderSectionCount` | SPATIAL | 0.0837 | spatial_statistics_unchanged | spatialFreqY swing 0.0199, monotonic -1 — but the sweep DID move contrastRatio by 0.0837 |
| WRONG | `summer_camp/73_tree_shadow_breath` | `sliderShadowDepth` | DARKNESS | 0.0753 | darkness_inverted_adds_light | litFraction swing 0.0251 ratio 1.05 (via absolute), monotonic 1 (expected falling) — but the sweep DID move uvMean by 0.0753 |
| WRONG | `15_silk_prism_ribbons` | `sliderDirection` | DIRECTION | 0.0685 | no_reversal_net_travel_or_velocity_series | launch driftY -0.0505/-0.0243/0.0080/0.0247/-0.0157 (ends -0.0505 → -0.0157, floor ±0.004); velocity-series correlation low↔high 0.192 (reversal at ≤ -0.3) — but the sweep DID move spatialFreqY by 0.0685 |
| WRONG | `05_orbital_attractor_field` | `sliderBlackoutTexture` | DARKNESS | 0.0682 | output_did_not_fall_with_slider | lumaMean swing 0.0116 ratio 1.10 (via none), monotonic -1 (expected falling) — but the sweep DID move spatialFreqY by 0.0682 |
| WRONG | `04_beat_folded_helix` | `sliderTwistFreq` | SPEED | 0.0676 | temporal_rate_did_not_track_slider | temporalRate 0.0030/0.0028/0.0030/0.0030/0.0030 (ratio 1.06, mono 0); temporalFreq ratio 1.05, mono 0 — but the sweep DID move spatialFreqY by 0.0676 |
| WRONG | `transitions/trans_ripple_in` | `sliderRingDamping` | SPATIAL | 0.0621 | spatial_statistics_unchanged | spatialFreqZ swing 0.0106, monotonic -1 — but the sweep DID move satMean by 0.0621 |
| WRONG | `summer_camp/112_logsville_giant_call_response` | `sliderSectionCount` | SPATIAL | 0.0599 | spatial_statistics_unchanged | spatialFreqZ swing 0.0184, monotonic 0 — but the sweep DID move contrastRatio by 0.0599 |
| WRONG | `summer_camp/114_tower_ring_chase` | `sliderDirection` | DIRECTION | 0.0517 | no_reversal_net_travel_or_velocity_series | launch driftX 0.0073/0.0073/0.0012/0.0012/0.0012 (ends 0.0073 → 0.0012, floor ±0.004); velocity-series correlation low↔high 0.002 (reversal at ≤ -0.3) — but the sweep DID move contrastRatio by 0.0517 |
| WRONG | `summer_camp/81_outpost_distress_beacon` | `sliderBeamWidth` | SPATIAL | 0.0471 | spatial_statistics_unchanged | spatialFreqY swing 0.0109, monotonic 1 — but the sweep DID move contrastRatio by 0.0471 |
| WRONG | `61_white_breathe` | `sliderDirection` | DIRECTION | 0.0444 | no_measurable_motion_to_reverse | launch driftY -0.0027/-0.0027/-0.0027/-0.0027/-0.0027 (ends -0.0027 → -0.0027, floor ±0.004); velocity-series correlation low↔high 0.128 (reversal at ≤ -0.3) — but the sweep DID move spatialFreqY by 0.0444 |
| WRONG | `summer_camp/51_abyssal_searchlight` | `sliderBeamReach` | SPATIAL | 0.0420 | spatial_statistics_unchanged | spatialFreqY swing 0.0097, monotonic 0 — but the sweep DID move temporalFreq by 0.0420 |
| WRONG | `summer_camp/40_ghost_ship_reveal` | `sliderPortBrightness` | BRIGHTNESS | 0.0396 | luma_did_not_track_slider | outputMean swing 0.0003 ratio 1.02 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.0396 |
| WRONG | `04_beat_folded_helix` | `sliderWhiteWarmth` | WHITE | 0.0375 | white_amber_emitters_unchanged | wMean swing 0.0000 ratio 1.00 (via none, threshold 0.01) — but the sweep DID move uvMean by 0.0375 |
| WRONG | `40_lissajous_weave` | `sliderDetail` | SPATIAL | 0.0324 | spatial_statistics_unchanged | edgeSharpnessY swing 0.0091, monotonic 1 — but the sweep DID move rMean by 0.0324 |
| WRONG | `summer_camp/113_tower_column_breath` | `sliderVintageGlow` | BRIGHTNESS | 0.0295 | luma_did_not_track_slider | outputMean swing 0.0015 ratio 1.16 (via none), monotonic 1 — but the sweep DID move contrastRatio by 0.0295 |
| WRONG | `summer_camp/56_stage_mirror_axis` | `sliderMirrorWidth` | SPATIAL | 0.0280 | spatial_statistics_unchanged | litFraction swing 0.0094, monotonic 1 — but the sweep DID move temporalFreq by 0.0280 |
| WRONG | `summer_camp/48_titanic_sos_beacon` | `sliderEdgeSoftness` | SPATIAL | 0.0231 | spatial_statistics_unchanged | edgeSharpnessZ swing 0.0076, monotonic -1 — but the sweep DID move contrastRatio by 0.0231 |
| DEAD | `summer_camp/55_stardust_dome` | `sliderRingWidth` | SPATIAL | 0.0044 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06698, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/51_abyssal_searchlight` | `sliderSwirlMix` | MAGNITUDE | 0.0036 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.00727, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderBoilerHeat` | MAGNITUDE | 0.0036 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.01252, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderParticleDensity` | SPATIAL | 0.0036 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.0909, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/50_iceberg_fracture` | `sliderBranchSpread` | SPATIAL | 0.0035 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.16946, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/55_stardust_dome` | `sliderOrbitSpeed` | SPEED | 0.0030 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.10568, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/55_stardust_dome` | `sliderParticleDensity` | SPATIAL | 0.0029 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.26838, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `53_neon_elevator_hd` | `sliderKick` | MAGNITUDE | 0.0024 | below_dead_threshold | largest normalised change 0.00239 < 0.005 on every measured feature |
| DEAD | `summer_camp/81_outpost_distress_beacon` | `sliderBlackoutDepth` | DARKNESS | 0.0017 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.06522, top mover spatialFreqZ). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/84_outpost_ember_overdrive` | `sliderSparkleDensity` | SPATIAL | 0.0017 | below_dead_threshold | largest normalised change 0.00171 < 0.005 on every measured feature |
| DEAD | `summer_camp/55_stardust_dome` | `sliderLocalSpeed` | SPEED | 0.0014 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.23339, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderStageFocus` | SPATIAL | 0.0010 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.28874, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/81_outpost_distress_beacon` | `sliderSignalStrength` | MAGNITUDE | 0.0005 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `01_cylon_sweep` | `sliderWhiteLevel` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.08696, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `01_cylon_sweep` | `sliderWhiteKick` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.17391, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `01_cylon_sweep` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.00725, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `05_orbital_attractor_field` | `sliderKick` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.31358, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `05_orbital_attractor_field` | `sliderFalloff` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.03513, top mover edgeSharpnessZ). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `05_orbital_attractor_field` | `sliderFocus` | SPATIAL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `05_orbital_attractor_field` | `sliderWhiteLevel` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.00652, top mover edgeSharpnessZ). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `05_orbital_attractor_field` | `sliderWhiteKick` | WHITE | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `05_orbital_attractor_field` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `06_neon_elevator` | `sliderKick` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.093, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `06_neon_elevator` | `sliderSteps` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.06814, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `06_neon_elevator` | `sliderWhiteLevel` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.07639, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `06_neon_elevator` | `sliderWhiteKick` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06706, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `06_neon_elevator` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.03472, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `09_cyclone` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06532, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `130_spatial_paint` | `sliderLocalSpeed` | SPEED | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `130_spatial_paint` | `sliderLevel` | BRIGHTNESS | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `130_spatial_paint` | `sliderKick` | MAGNITUDE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `130_spatial_paint` | `sliderTouch` | UNKNOWN_CLAIM | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `130_spatial_paint` | `sliderPulse` | MAGNITUDE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `130_spatial_paint` | `sliderDrawMode` | UNKNOWN_CLAIM | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `130_spatial_paint` | `sliderTrailFade` | TRAIL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `17_rolling_color_dunes` | `sliderKick` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.25494, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderStageSurf` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.08287, top mover edgeSharpnessZ). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderAmberWarmth` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.03923, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderWhiteLevel` | WHITE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.07749, top mover edgeSharpnessY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `17_rolling_color_dunes` | `sliderWhiteKick` | WHITE | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `17_rolling_color_dunes` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `23_prismatic_strange_attractors` | `sliderColorSpread` | HUE | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `25_heartbeat` | `sliderBlinder` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.2268, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `25_heartbeat` | `sliderBlinderBite` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.07805, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `28_spectrum_bloom` | `sliderMid` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.01887, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `28_spectrum_bloom` | `sliderHigh` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.03696, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `36_orbital_pulse` | `sliderPulse` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.09904, top mover lumaMean). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/113_tower_column_breath` | `sliderLocalSpeed` | SPEED | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/114_tower_ring_chase` | `sliderLocalSpeed` | SPEED | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/41_ghost_aurora` | `sliderCurtainWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.38292, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/41_ghost_aurora` | `sliderDriftChaos` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.07264, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/41_ghost_aurora` | `sliderTriangleGain` | BRIGHTNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.24095, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/42_boiler_glow` | `sliderFlickerComplexity` | UNKNOWN_CLAIM | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/42_boiler_glow` | `sliderVentWidth` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.18394, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/42_boiler_glow` | `sliderSteamFlash` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.08637, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/42_boiler_glow` | `sliderTriangleRPM` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.28385, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/42_boiler_glow` | `sliderFlashRate` | SPEED | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06906, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/43_sea_floor_shadow` | `sliderShadowWidth` | DARKNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.04733, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/43_sea_floor_shadow` | `sliderShadowDrift` | DARKNESS | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.05256, top mover temporalFreq). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/43_sea_floor_shadow` | `sliderEdgeFoam` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.03212, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/43_sea_floor_shadow` | `sliderTriangleSilhouette` | UNKNOWN_CLAIM | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures UNKNOWN_CLAIM (effect 0.06208, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderGearSharpness` | SPATIAL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderPistonStroke` | UNKNOWN_CLAIM | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/45_engine_room_clockwork` | `sliderBarTickDensity` | SPATIAL | 0.0000 | byte_identical_across_full_range | every sweep point rendered byte-identical frames — the control is not read, or is read into a term that cancels out |
| DEAD | `summer_camp/46_dome_lockdown` | `sliderDirection` | DIRECTION | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.50708, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
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
| DEAD | `summer_camp/54_boiler_fire_overdrive` | `sliderFlameHeight` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WRONG (effect 0.12951, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/55_stardust_dome` | `sliderStarCore` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.16999, top mover spatialFreqY). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderUvEdge` | UV | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.06718, top mover driftX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/56_stage_mirror_axis` | `sliderCenterGuide` | UNKNOWN_CLAIM | 0.0000 | dead_at_declared_defaults_alive_at_midrange | inert at this pattern's declared defaults on both titanic and test_bench, but alive on test_bench with the other sliders at 0.5. The control is wired — a shipped default is swallowing it. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderArmCount` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.01561, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderSeedSize` | SPATIAL | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.01932, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderBreathDepth` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures TRUE (effect 0.02446, top mover contrastRatio). The control works — the code path it drives is not reachable on titanic. |
| DEAD | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderCenterImpact` | MAGNITUDE | 0.0000 | dead_on_titanic_but_alive_on_test_bench | byte-identical on titanic; on test_bench it measures WEAK (effect 0.01812, top mover spatialFreqX). The control works — the code path it drives is not reachable on titanic. |
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
| WEAK | `14_lunar_current` | `sliderDetail` | SPATIAL | 0.0160 | spatial_statistics_unchanged | edgeSharpnessX swing 0.0104, monotonic 0 |
| WEAK | `summer_camp/54_boiler_fire_overdrive` | `sliderTongueCount` | SPATIAL | 0.0153 | spatial_statistics_unchanged | spatialFreqX swing 0.0139, monotonic 0 |
| WEAK | `summer_camp/54_boiler_fire_overdrive` | `sliderHeatFlash` | MAGNITUDE | 0.0152 | effect_below_visible_threshold | dominant mover temporalFreq 0.0152 |
| WEAK | `51_confetti_cyclone` | `sliderHigh` | MAGNITUDE | 0.0129 | effect_below_visible_threshold | dominant mover litFraction 0.0129 |
| WEAK | `05_orbital_attractor_field` | `sliderRadius` | SPATIAL | 0.0127 | spatial_statistics_unchanged | spatialFreqY swing 0.0127, monotonic -1 |
| WEAK | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderUvIntensity` | UV | 0.0125 | claim_met_but_sub_visible | uvMean swing 0.0125 ratio 12486.72 (via absolute, threshold 0.01) |
| WEAK | `summer_camp/75_timber_mill_clockwork` | `sliderSparkImpact` | MAGNITUDE | 0.0124 | effect_below_visible_threshold | dominant mover wMean 0.0124 |
| WEAK | `summer_camp/40_ghost_ship_reveal` | `sliderHullDarkness` | DARKNESS | 0.0121 | output_did_not_fall_with_slider | litFraction swing 0.0009 ratio 1.00 (via none), monotonic -1 (expected falling) |
| WEAK | `summer_camp/96_logsville_ember_storm` | `sliderSparkleDensity` | SPATIAL | 0.0108 | spatial_statistics_unchanged | edgeSharpnessX swing 0.0014, monotonic 1 |
| WEAK | `25_heartbeat` | `sliderWhiteLevel` | WHITE | 0.0106 | claim_met_but_sub_visible | wMean swing 0.0058 ratio 2.03 (via ratio, threshold 0.01) |
| WEAK | `summer_camp/49_boiler_pressure_release` | `sliderReleaseThreshold` | MAGNITUDE | 0.0101 | effect_below_visible_threshold | dominant mover contrastRatio 0.0101 |
| WEAK | `summer_camp/41_ghost_aurora` | `sliderRimShimmer` | MAGNITUDE | 0.0098 | effect_below_visible_threshold | dominant mover driftY 0.0098 |
| WEAK | `summer_camp/79_mill_pressure_release` | `sliderLocalSpeed` | SPEED | 0.0097 | temporal_rate_did_not_track_slider | temporalRate 0.0001/0.0001/0.0001/0.0001/0.0002 (ratio 1.17, mono 1); temporalFreq ratio 1.12, mono 0 |
| WEAK | `summer_camp/113_tower_column_breath` | `sliderSteamboatWhite` | WHITE | 0.0092 | claim_met_but_sub_visible | wMean swing 0.0092 ratio 9224.29 (via ratio, threshold 0.01) |
| WEAK | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderAudioKick` | MAGNITUDE | 0.0091 | effect_below_visible_threshold | dominant mover spatialFreqY 0.0091 |
| WEAK | `summer_camp/50_iceberg_fracture` | `sliderStrikeDecay` | TRAIL | 0.0090 | trail_extent_and_persistence_unchanged | litFraction swing 0.0090 |
| WEAK | `transitions/trans_ripple_in` | `sliderRings` | SPATIAL | 0.0084 | spatial_statistics_unchanged | spatialFreqZ swing 0.0085, monotonic 0 |
| WEAK | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderAudioMid` | MAGNITUDE | 0.0078 | effect_below_visible_threshold | dominant mover spatialFreqY 0.0079 |
| WEAK | `summer_camp/114_tower_ring_chase` | `sliderAudioHigh` | MAGNITUDE | 0.0064 | effect_below_visible_threshold | dominant mover driftX 0.0064 |
| WEAK | `summer_camp/96_logsville_ember_storm` | `sliderAudioHigh` | MAGNITUDE | 0.0061 | effect_below_visible_threshold | dominant mover temporalFreq 0.0061 |
| WEAK | `summer_camp/96_logsville_ember_storm` | `sliderEmberSpeed` | SPEED | 0.0057 | temporal_rate_did_not_track_slider | temporalRate 0.0030/0.0031/0.0032/0.0033/0.0034 (ratio 1.12, mono 1); temporalFreq ratio 1.03, mono 1 |
| WEAK | `summer_camp/79_mill_pressure_release` | `sliderVentFlash` | MAGNITUDE | 0.0055 | effect_below_visible_threshold | dominant mover driftX 0.0055 |
| WEAK | `24_chromatic_murmuration` | `sliderKick` | MAGNITUDE | 0.0055 | effect_below_visible_threshold | dominant mover contrastRatio 0.0055 |
| WEAK | `summer_camp/81_outpost_distress_beacon` | `sliderPathChaos` | MAGNITUDE | 0.0051 | effect_below_visible_threshold | dominant mover spatialFreqY 0.0051 |
| WEAK | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderCanopyApexBoost` | MAGNITUDE | 0.0051 | effect_below_visible_threshold | dominant mover wMean 0.0051 |
| UNKNOWN_CLAIM | `71_calibration_fixture_pixel_order` | `sliderPosition` | UNKNOWN_CLAIM | 4.1440 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 4.1440 |
| UNKNOWN_CLAIM | `72_calibration_controller_focus` | `sliderBackground` | UNKNOWN_CLAIM | 1.9991 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 1.9991 |
| UNKNOWN_CLAIM | `67_calibration_y_plane` | `sliderBackground` | UNKNOWN_CLAIM | 1.9947 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 1.9946 |
| UNKNOWN_CLAIM | `66_calibration_x_plane` | `sliderBackground` | UNKNOWN_CLAIM | 1.5737 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 1.5737 |
| UNKNOWN_CLAIM | `66_calibration_x_plane` | `sliderPosition` | UNKNOWN_CLAIM | 1.4369 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 1.4369 |
| UNKNOWN_CLAIM | `68_calibration_z_plane` | `sliderBackground` | UNKNOWN_CLAIM | 1.1852 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 1.1852 |
| UNKNOWN_CLAIM | `64_temple_warm_white` | `sliderCeiling` | UNKNOWN_CLAIM | 1.0000 | name_makes_no_falsifiable_claim | dominant mover litFraction 1.0000 |
| UNKNOWN_CLAIM | `65_uv_only` | `sliderRgbViolet` | UNKNOWN_CLAIM | 1.0000 | name_makes_no_falsifiable_claim | dominant mover satMean 1.0000 |
| UNKNOWN_CLAIM | `73_calibration_emitter_channels` | `sliderChannel` | UNKNOWN_CLAIM | 1.0000 | name_makes_no_falsifiable_claim | dominant mover satMean 1.0000 |
| UNKNOWN_CLAIM | `39_tide_riser` | `sliderRise` | UNKNOWN_CLAIM | 0.9895 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.9895 |
| UNKNOWN_CLAIM | `68_calibration_z_plane` | `sliderPosition` | UNKNOWN_CLAIM | 0.9326 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.9326 |
| UNKNOWN_CLAIM | `128_five_colour_prism` | `sliderHue5` | UNKNOWN_CLAIM | 0.9004 | name_makes_no_falsifiable_claim | dominant mover hueMean 0.9004 |
| UNKNOWN_CLAIM | `42_phyllotaxis_spiral` | `sliderBloom` | UNKNOWN_CLAIM | 0.8872 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.8872 |
| UNKNOWN_CLAIM | `71_calibration_fixture_pixel_order` | `sliderBackground` | UNKNOWN_CLAIM | 0.8589 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.8589 |
| UNKNOWN_CLAIM | `72_calibration_controller_focus` | `sliderController` | UNKNOWN_CLAIM | 0.8191 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.8191 |
| UNKNOWN_CLAIM | `129_five_colour_stations` | `sliderHue5` | UNKNOWN_CLAIM | 0.8098 | name_makes_no_falsifiable_claim | dominant mover hueMean 0.8098 |
| UNKNOWN_CLAIM | `60_white_wash` | `sliderEvenness` | UNKNOWN_CLAIM | 0.7635 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.7635 |
| UNKNOWN_CLAIM | `130_spatial_paint` | `sliderHue5` | UNKNOWN_CLAIM | 0.6979 | name_makes_no_falsifiable_claim | dominant mover hueMean 0.6979 |
| UNKNOWN_CLAIM | `67_calibration_y_plane` | `sliderPosition` | UNKNOWN_CLAIM | 0.4764 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.4764 |
| UNKNOWN_CLAIM | `ambient_extra/44_healing_cracks` | `sliderOpening` | UNKNOWN_CLAIM | 0.4480 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.4480 |
| UNKNOWN_CLAIM | `130_spatial_paint` | `sliderVal5` | UNKNOWN_CLAIM | 0.4348 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.4348 |
| UNKNOWN_CLAIM | `ambient_extra/26_drawbridge` | `sliderBridgeAngle` | UNKNOWN_CLAIM | 0.4348 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.4348 |
| UNKNOWN_CLAIM | `ambient_extra/30_organ_bellows` | `sliderHullResonance` | UNKNOWN_CLAIM | 0.4321 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.4321 |
| UNKNOWN_CLAIM | `123_mirrored_broadside_call` | `sliderExpansion` | UNKNOWN_CLAIM | 0.4087 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.4087 |
| UNKNOWN_CLAIM | `130_spatial_paint` | `sliderHue3` | UNKNOWN_CLAIM | 0.4028 | name_makes_no_falsifiable_claim | dominant mover hueMean 0.4028 |
| UNKNOWN_CLAIM | `130_spatial_paint` | `sliderHue4` | UNKNOWN_CLAIM | 0.3928 | name_makes_no_falsifiable_claim | dominant mover hueMean 0.3928 |
| UNKNOWN_CLAIM | `ambient_extra/41_jelly_bells` | `sliderJewelryTips` | UNKNOWN_CLAIM | 0.3915 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3915 |
| UNKNOWN_CLAIM | `47_quasicrystal_dunes` | `sliderSurf` | UNKNOWN_CLAIM | 0.3896 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.3896 |
| UNKNOWN_CLAIM | `57_ink_diffuse` | `sliderFlow` | UNKNOWN_CLAIM | 0.3864 | name_makes_no_falsifiable_claim | dominant mover rMean 0.3864 |
| UNKNOWN_CLAIM | `ambient_extra/45_moss_islands` | `sliderGrowth` | UNKNOWN_CLAIM | 0.3777 | name_makes_no_falsifiable_claim | dominant mover rMean 0.3777 |
| UNKNOWN_CLAIM | `26_dom_dancers_chevron` | `sliderBall2X` | UNKNOWN_CLAIM | 0.3699 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3699 |
| UNKNOWN_CLAIM | `57_ink_diffuse` | `sliderInk` | UNKNOWN_CLAIM | 0.3626 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3626 |
| UNKNOWN_CLAIM | `33_aurora_breath` | `sliderSoft` | UNKNOWN_CLAIM | 0.3616 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.3616 |
| UNKNOWN_CLAIM | `128_five_colour_prism` | `sliderVal4` | UNKNOWN_CLAIM | 0.3539 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3539 |
| UNKNOWN_CLAIM | `party_dancers/01_dom_ball_dancers` | `sliderDomEnergy2` | UNKNOWN_CLAIM | 0.3478 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.3478 |
| UNKNOWN_CLAIM | `74_calibration_bpm_ruler` | `sliderBackground` | UNKNOWN_CLAIM | 0.3459 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3459 |
| UNKNOWN_CLAIM | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderHeartbeatPattern` | UNKNOWN_CLAIM | 0.3445 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3445 |
| UNKNOWN_CLAIM | `128_five_colour_prism` | `sliderHue4` | UNKNOWN_CLAIM | 0.3317 | name_makes_no_falsifiable_claim | dominant mover hueMean 0.3317 |
| UNKNOWN_CLAIM | `129_five_colour_stations` | `sliderVal5` | UNKNOWN_CLAIM | 0.3162 | name_makes_no_falsifiable_claim | dominant mover hueMean 0.3162 |
| UNKNOWN_CLAIM | `ambient_extra/30_organ_bellows` | `sliderCompression` | UNKNOWN_CLAIM | 0.3074 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.3074 |
| UNKNOWN_CLAIM | `130_spatial_paint` | `sliderVal4` | UNKNOWN_CLAIM | 0.3071 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.3071 |
| UNKNOWN_CLAIM | `129_five_colour_stations` | `sliderHue3` | UNKNOWN_CLAIM | 0.3069 | name_makes_no_falsifiable_claim | dominant mover hueMean 0.3069 |
| UNKNOWN_CLAIM | `summer_camp/80_tree_canopy_fracture` | `sliderAftershock` | UNKNOWN_CLAIM | 0.2907 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.2907 |
| UNKNOWN_CLAIM | `129_five_colour_stations` | `sliderHue4` | UNKNOWN_CLAIM | 0.2896 | name_makes_no_falsifiable_claim | dominant mover hueMean 0.2896 |
| UNKNOWN_CLAIM | `ambient_extra/38_shell_growth` | `sliderGrowth` | UNKNOWN_CLAIM | 0.2878 | name_makes_no_falsifiable_claim | dominant mover rMean 0.2879 |
| UNKNOWN_CLAIM | `39_tide_riser` | `sliderSpray` | UNKNOWN_CLAIM | 0.2786 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.2786 |
| UNKNOWN_CLAIM | `26_dom_dancers_chevron` | `sliderBall1X` | UNKNOWN_CLAIM | 0.2742 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.2742 |
| UNKNOWN_CLAIM | `party_dancers/01_dom_ball_dancers` | `sliderDomEnergy1` | UNKNOWN_CLAIM | 0.2710 | name_makes_no_falsifiable_claim | dominant mover rMean 0.2710 |
| UNKNOWN_CLAIM | `ambient_extra/48_organ_echoes` | `sliderDelay` | UNKNOWN_CLAIM | 0.2627 | name_makes_no_falsifiable_claim | dominant mover rMean 0.2627 |
| UNKNOWN_CLAIM | `ambient_extra/21_pendulum_room` | `sliderJewelryBob` | UNKNOWN_CLAIM | 0.2609 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.2609 |
| UNKNOWN_CLAIM | `ambient_extra/31_dark_moonrise` | `sliderHalo` | UNKNOWN_CLAIM | 0.2548 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.2548 |
| UNKNOWN_CLAIM | `129_five_colour_stations` | `sliderVal4` | UNKNOWN_CLAIM | 0.2509 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.2509 |
| UNKNOWN_CLAIM | `54_murmuration_storm` | `sliderHaze` | UNKNOWN_CLAIM | 0.2472 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.2471 |
| UNKNOWN_CLAIM | `128_five_colour_prism` | `sliderVal5` | UNKNOWN_CLAIM | 0.2471 | name_makes_no_falsifiable_claim | dominant mover hueMean 0.2471 |
| UNKNOWN_CLAIM | `baby/07_tease_lattice_bloom` | `sliderBloom` | UNKNOWN_CLAIM | 0.2438 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.2438 |
| UNKNOWN_CLAIM | `ambient_extra/31_dark_moonrise` | `sliderRise` | UNKNOWN_CLAIM | 0.2367 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.2367 |
| UNKNOWN_CLAIM | `ambient_extra/19_split_lens` | `sliderSplitAngle` | UNKNOWN_CLAIM | 0.2307 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.2307 |
| UNKNOWN_CLAIM | `129_five_colour_stations` | `sliderSplit` | UNKNOWN_CLAIM | 0.2297 | name_makes_no_falsifiable_claim | dominant mover hueMean 0.2297 |
| UNKNOWN_CLAIM | `ambient_extra/18_soft_steps` | `sliderDrift` | UNKNOWN_CLAIM | 0.2265 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.2264 |
| UNKNOWN_CLAIM | `13_sparkle` | `sliderBurst` | UNKNOWN_CLAIM | 0.2258 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.2258 |
| UNKNOWN_CLAIM | `summer_camp/73_tree_shadow_breath` | `sliderCanopyMotion` | UNKNOWN_CLAIM | 0.2136 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.2136 |
| UNKNOWN_CLAIM | `128_five_colour_prism` | `sliderHue3` | UNKNOWN_CLAIM | 0.2089 | name_makes_no_falsifiable_claim | dominant mover hueMean 0.2089 |
| UNKNOWN_CLAIM | `57_ink_diffuse` | `sliderDiffuse` | UNKNOWN_CLAIM | 0.2057 | name_makes_no_falsifiable_claim | dominant mover rMean 0.2057 |
| UNKNOWN_CLAIM | `party_dancers/01_dom_ball_dancers` | `sliderDomFreq1` | UNKNOWN_CLAIM | 0.2047 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.2047 |
| UNKNOWN_CLAIM | `ambient_extra/34_soft_hourglass` | `sliderWaist` | UNKNOWN_CLAIM | 0.2035 | name_makes_no_falsifiable_claim | dominant mover spatialFreqX 0.2035 |
| UNKNOWN_CLAIM | `129_five_colour_stations` | `sliderVal3` | UNKNOWN_CLAIM | 0.2020 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.2020 |
| UNKNOWN_CLAIM | `summer_camp/112_logsville_giant_call_response` | `sliderConversation` | UNKNOWN_CLAIM | 0.1936 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.1936 |
| UNKNOWN_CLAIM | `ambient_extra/01_harbor_glass` | `sliderDrift` | UNKNOWN_CLAIM | 0.1926 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1926 |
| UNKNOWN_CLAIM | `130_spatial_paint` | `sliderVal3` | UNKNOWN_CLAIM | 0.1826 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.1826 |
| UNKNOWN_CLAIM | `ambient_extra/39_magnetic_sand` | `sliderOrganPoles` | UNKNOWN_CLAIM | 0.1818 | name_makes_no_falsifiable_claim | dominant mover spatialFreqX 0.1818 |
| UNKNOWN_CLAIM | `ambient_extra/36_off_center_sun` | `sliderCorona` | UNKNOWN_CLAIM | 0.1773 | name_makes_no_falsifiable_claim | dominant mover rMean 0.1773 |
| UNKNOWN_CLAIM | `ambient_extra/42_seed_drift` | `sliderUpdraft` | UNKNOWN_CLAIM | 0.1673 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.1673 |
| UNKNOWN_CLAIM | `54_murmuration_storm` | `sliderBuild` | UNKNOWN_CLAIM | 0.1658 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1658 |
| UNKNOWN_CLAIM | `ambient_extra/11_paper_fold` | `sliderFoldAngle` | UNKNOWN_CLAIM | 0.1643 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1643 |
| UNKNOWN_CLAIM | `121_spiral_wake` | `sliderTurns` | UNKNOWN_CLAIM | 0.1561 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1561 |
| UNKNOWN_CLAIM | `27_swipe` | `sliderBlur` | UNKNOWN_CLAIM | 0.1560 | name_makes_no_falsifiable_claim | dominant mover driftZ 0.1560 |
| UNKNOWN_CLAIM | `ambient_extra/34_soft_hourglass` | `sliderTurn` | UNKNOWN_CLAIM | 0.1528 | name_makes_no_falsifiable_claim | dominant mover spatialFreqX 0.1528 |
| UNKNOWN_CLAIM | `ambient_extra/04_five_lanterns` | `sliderSeparation` | UNKNOWN_CLAIM | 0.1504 | name_makes_no_falsifiable_claim | dominant mover spatialFreqX 0.1504 |
| UNKNOWN_CLAIM | `ambient_extra/20_long_shadow` | `sliderTilt` | UNKNOWN_CLAIM | 0.1495 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1495 |
| UNKNOWN_CLAIM | `summer_camp/85_redwood_starry_canopy` | `sliderTowerSpin` | UNKNOWN_CLAIM | 0.1491 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.1491 |
| UNKNOWN_CLAIM | `128_five_colour_prism` | `sliderVal3` | UNKNOWN_CLAIM | 0.1465 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.1465 |
| UNKNOWN_CLAIM | `119_bow_stern_tidal_push` | `sliderRecoil` | UNKNOWN_CLAIM | 0.1453 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.1453 |
| UNKNOWN_CLAIM | `ambient_extra/17_frost_branch` | `sliderGrowth` | UNKNOWN_CLAIM | 0.1449 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1449 |
| UNKNOWN_CLAIM | `party_dancers/01_dom_ball_dancers` | `sliderDomFreq2` | UNKNOWN_CLAIM | 0.1431 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1431 |
| UNKNOWN_CLAIM | `ambient_extra/09_shadow_slats` | `sliderOpen` | UNKNOWN_CLAIM | 0.1366 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.1366 |
| UNKNOWN_CLAIM | `ambient_extra/23_needle_gauge` | `sliderOrganPeak` | UNKNOWN_CLAIM | 0.1365 | name_makes_no_falsifiable_claim | dominant mover spatialFreqX 0.1365 |
| UNKNOWN_CLAIM | `ambient_extra/21_pendulum_room` | `sliderArc` | UNKNOWN_CLAIM | 0.1347 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1347 |
| UNKNOWN_CLAIM | `baby/09_tease_helix_exchange` | `sliderTurns` | UNKNOWN_CLAIM | 0.1335 | name_makes_no_falsifiable_claim | dominant mover spatialFreqX 0.1335 |
| UNKNOWN_CLAIM | `ambient_extra/33_rope_constellation` | `sliderJewelryNodes` | UNKNOWN_CLAIM | 0.1328 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1329 |
| UNKNOWN_CLAIM | `ambient_extra/47_side_by_side` | `sliderExchange` | UNKNOWN_CLAIM | 0.1304 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1304 |
| UNKNOWN_CLAIM | `26_dom_dancers_chevron` | `sliderChevronSpeedup` | UNKNOWN_CLAIM | 0.1253 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1253 |
| UNKNOWN_CLAIM | `38_prism_helix` | `sliderArms` | UNKNOWN_CLAIM | 0.1250 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1250 |
| UNKNOWN_CLAIM | `summer_camp/40_ghost_ship_reveal` | `sliderSpinMotion` | UNKNOWN_CLAIM | 0.1244 | name_makes_no_falsifiable_claim | dominant mover driftZ 0.1244 |
| UNKNOWN_CLAIM | `ambient_extra/43_leaf_turn` | `sliderFaceTurn` | UNKNOWN_CLAIM | 0.1244 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1244 |
| UNKNOWN_CLAIM | `baby/14_tease_spiral_race` | `sliderSpiralArms` | UNKNOWN_CLAIM | 0.1237 | name_makes_no_falsifiable_claim | dominant mover driftY 0.1237 |
| UNKNOWN_CLAIM | `ambient_extra/27_rolling_shutters` | `sliderOpening` | UNKNOWN_CLAIM | 0.1190 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1190 |
| UNKNOWN_CLAIM | `ambient_extra/24_bead_counter` | `sliderPlaces` | UNKNOWN_CLAIM | 0.1166 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1165 |
| UNKNOWN_CLAIM | `ambient_extra/05_open_gate` | `sliderAperture` | UNKNOWN_CLAIM | 0.1160 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.1160 |
| UNKNOWN_CLAIM | `ambient_extra/15_woven_light` | `sliderOverUnder` | UNKNOWN_CLAIM | 0.1159 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1159 |
| UNKNOWN_CLAIM | `ambient_extra/22_balance_beam` | `sliderCounterweight` | UNKNOWN_CLAIM | 0.1147 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1147 |
| UNKNOWN_CLAIM | `ambient_extra/17_frost_branch` | `sliderHold` | UNKNOWN_CLAIM | 0.1123 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1123 |
| UNKNOWN_CLAIM | `ambient_extra/16_turning_tiles` | `sliderGrout` | UNKNOWN_CLAIM | 0.1111 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1111 |
| UNKNOWN_CLAIM | `ambient_extra/35_turning_box` | `sliderPerspective` | UNKNOWN_CLAIM | 0.1111 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1111 |
| UNKNOWN_CLAIM | `46_abyssal_fronds` | `sliderGlints` | UNKNOWN_CLAIM | 0.1060 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.1060 |
| UNKNOWN_CLAIM | `ambient_extra/10_chart_lines` | `sliderDrift` | UNKNOWN_CLAIM | 0.1060 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1060 |
| UNKNOWN_CLAIM | `ambient_extra/25_zipper_light` | `sliderClosure` | UNKNOWN_CLAIM | 0.1049 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.1049 |
| UNKNOWN_CLAIM | `13_sparkle` | `sliderBrilliance` | UNKNOWN_CLAIM | 0.1036 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1036 |
| UNKNOWN_CLAIM | `baby/02_tease_crossing_question` | `sliderCrossing` | UNKNOWN_CLAIM | 0.1027 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.1027 |
| UNKNOWN_CLAIM | `ambient_extra/17_frost_branch` | `sliderMelt` | UNKNOWN_CLAIM | 0.1003 | name_makes_no_falsifiable_claim | dominant mover rMean 0.1003 |
| UNKNOWN_CLAIM | `130_spatial_paint` | `sliderTargetX` | UNKNOWN_CLAIM | 0.0986 | name_makes_no_falsifiable_claim | dominant mover rMean 0.0986 |
| UNKNOWN_CLAIM | `130_spatial_paint` | `sliderTargetY` | UNKNOWN_CLAIM | 0.0986 | name_makes_no_falsifiable_claim | dominant mover rMean 0.0986 |
| UNKNOWN_CLAIM | `ambient_extra/09_shadow_slats` | `sliderTilt` | UNKNOWN_CLAIM | 0.0969 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0969 |
| UNKNOWN_CLAIM | `ambient_extra/48_organ_echoes` | `sliderJewelryCatch` | UNKNOWN_CLAIM | 0.0924 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0924 |
| UNKNOWN_CLAIM | `ambient_extra/13_cut_diamond` | `sliderTurn` | UNKNOWN_CLAIM | 0.0915 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0915 |
| UNKNOWN_CLAIM | `ambient_extra/32_silent_meteor` | `sliderInterval` | UNKNOWN_CLAIM | 0.0903 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0903 |
| UNKNOWN_CLAIM | `38_prism_helix` | `sliderTwist` | UNKNOWN_CLAIM | 0.0900 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0900 |
| UNKNOWN_CLAIM | `ambient_extra/49_all_together` | `sliderHold` | UNKNOWN_CLAIM | 0.0891 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0891 |
| UNKNOWN_CLAIM | `ambient_extra/06_folded_flags` | `sliderHinge` | UNKNOWN_CLAIM | 0.0870 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0870 |
| UNKNOWN_CLAIM | `ambient_extra/46_twin_seals` | `sliderEcho` | UNKNOWN_CLAIM | 0.0870 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0870 |
| UNKNOWN_CLAIM | `ambient_extra/50_last_lantern` | `sliderLanternHold` | UNKNOWN_CLAIM | 0.0870 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0870 |
| UNKNOWN_CLAIM | `126_cathedral_rib_wave` | `sliderBow` | UNKNOWN_CLAIM | 0.0854 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0854 |
| UNKNOWN_CLAIM | `ambient_extra/17_frost_branch` | `sliderJewelryIce` | UNKNOWN_CLAIM | 0.0839 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0839 |
| UNKNOWN_CLAIM | `ambient_extra/04_five_lanterns` | `sliderCrossfade` | UNKNOWN_CLAIM | 0.0827 | name_makes_no_falsifiable_claim | dominant mover spatialFreqX 0.0827 |
| UNKNOWN_CLAIM | `ambient_extra/37_single_thread` | `sliderBend` | UNKNOWN_CLAIM | 0.0827 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0827 |
| UNKNOWN_CLAIM | `27_swipe` | `sliderSwipePos` | UNKNOWN_CLAIM | 0.0808 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0808 |
| UNKNOWN_CLAIM | `27_swipe` | `sliderShift` | UNKNOWN_CLAIM | 0.0808 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0808 |
| UNKNOWN_CLAIM | `12_breathing` | `sliderBloom` | UNKNOWN_CLAIM | 0.0774 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0774 |
| UNKNOWN_CLAIM | `ambient_extra/10_chart_lines` | `sliderRelief` | UNKNOWN_CLAIM | 0.0770 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0770 |
| UNKNOWN_CLAIM | `ambient_extra/49_all_together` | `sliderSeparation` | UNKNOWN_CLAIM | 0.0761 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0761 |
| UNKNOWN_CLAIM | `ambient_extra/45_moss_islands` | `sliderJewelrySpore` | UNKNOWN_CLAIM | 0.0749 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0749 |
| UNKNOWN_CLAIM | `summer_camp/83_shadow_canopy_eclipse` | `sliderCoronaBloom` | UNKNOWN_CLAIM | 0.0729 | name_makes_no_falsifiable_claim | dominant mover litFraction 0.0729 |
| UNKNOWN_CLAIM | `ambient_extra/10_chart_lines` | `sliderJewelryMark` | UNKNOWN_CLAIM | 0.0728 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0728 |
| UNKNOWN_CLAIM | `124_aurora_crown` | `sliderCurl` | UNKNOWN_CLAIM | 0.0707 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0707 |
| UNKNOWN_CLAIM | `ambient_extra/40_deep_window` | `sliderVanishingPoint` | UNKNOWN_CLAIM | 0.0701 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0700 |
| UNKNOWN_CLAIM | `ambient_extra/12_floating_frames` | `sliderTwist` | UNKNOWN_CLAIM | 0.0698 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0697 |
| UNKNOWN_CLAIM | `baby/08_tease_moire_gates` | `sliderInterference` | UNKNOWN_CLAIM | 0.0673 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0673 |
| UNKNOWN_CLAIM | `13_sparkle` | `sliderStarChorus` | UNKNOWN_CLAIM | 0.0670 | name_makes_no_falsifiable_claim | dominant mover spatialFreqX 0.0670 |
| UNKNOWN_CLAIM | `120_crossing_beacons` | `sliderCrossing` | UNKNOWN_CLAIM | 0.0658 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0658 |
| UNKNOWN_CLAIM | `ambient_extra/32_silent_meteor` | `sliderStroke` | UNKNOWN_CLAIM | 0.0650 | name_makes_no_falsifiable_claim | dominant mover driftZ 0.0650 |
| UNKNOWN_CLAIM | `ambient_extra/33_rope_constellation` | `sliderDrift` | UNKNOWN_CLAIM | 0.0646 | name_makes_no_falsifiable_claim | dominant mover spatialFreqX 0.0646 |
| UNKNOWN_CLAIM | `ambient_extra/47_side_by_side` | `sliderBoundary` | UNKNOWN_CLAIM | 0.0622 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0622 |
| UNKNOWN_CLAIM | `ambient_extra/49_all_together` | `sliderGather` | UNKNOWN_CLAIM | 0.0616 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0616 |
| UNKNOWN_CLAIM | `ambient_extra/45_moss_islands` | `sliderDrift` | UNKNOWN_CLAIM | 0.0604 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0604 |
| UNKNOWN_CLAIM | `ambient_extra/22_balance_beam` | `sliderSettle` | UNKNOWN_CLAIM | 0.0586 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0586 |
| UNKNOWN_CLAIM | `34_moire_interference` | `sliderRatio` | UNKNOWN_CLAIM | 0.0577 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0577 |
| UNKNOWN_CLAIM | `ambient_extra/16_turning_tiles` | `sliderJewelryCatch` | UNKNOWN_CLAIM | 0.0562 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0562 |
| UNKNOWN_CLAIM | `ambient_extra/14_slow_cells` | `sliderGenerationHold` | UNKNOWN_CLAIM | 0.0559 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0559 |
| UNKNOWN_CLAIM | `ambient_extra/25_zipper_light` | `sliderSpark` | UNKNOWN_CLAIM | 0.0546 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0546 |
| UNKNOWN_CLAIM | `ambient_extra/01_harbor_glass` | `sliderRefraction` | UNKNOWN_CLAIM | 0.0537 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0537 |
| UNKNOWN_CLAIM | `ambient_extra/44_healing_cracks` | `sliderHealTime` | UNKNOWN_CLAIM | 0.0519 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0519 |
| UNKNOWN_CLAIM | `ambient_extra/39_magnetic_sand` | `sliderAlignment` | UNKNOWN_CLAIM | 0.0510 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0510 |
| UNKNOWN_CLAIM | `ambient_extra/08_quiet_signal` | `sliderSignHold` | UNKNOWN_CLAIM | 0.0480 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0480 |
| UNKNOWN_CLAIM | `ambient_extra/30_organ_bellows` | `sliderDwell` | UNKNOWN_CLAIM | 0.0465 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0465 |
| UNKNOWN_CLAIM | `ambient_extra/13_cut_diamond` | `sliderJewelryCut` | UNKNOWN_CLAIM | 0.0426 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0426 |
| UNKNOWN_CLAIM | `41_reaction_diffusion` | `sliderFeed` | UNKNOWN_CLAIM | 0.0417 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0417 |
| UNKNOWN_CLAIM | `ambient_extra/08_quiet_signal` | `sliderInterval` | UNKNOWN_CLAIM | 0.0393 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0393 |
| UNKNOWN_CLAIM | `54_murmuration_storm` | `sliderScatter` | UNKNOWN_CLAIM | 0.0373 | name_makes_no_falsifiable_claim | dominant mover temporalFreq 0.0373 |
| UNKNOWN_CLAIM | `ambient_extra/41_jelly_bells` | `sliderTentacle` | UNKNOWN_CLAIM | 0.0328 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0328 |
| UNKNOWN_CLAIM | `ambient_extra/28_organ_chords` | `sliderHold` | UNKNOWN_CLAIM | 0.0321 | name_makes_no_falsifiable_claim | dominant mover temporalFreq 0.0320 |
| UNKNOWN_CLAIM | `ambient_extra/21_pendulum_room` | `sliderCoupling` | UNKNOWN_CLAIM | 0.0284 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0284 |
| UNKNOWN_CLAIM | `ambient_extra/26_drawbridge` | `sliderCounterweight` | UNKNOWN_CLAIM | 0.0284 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0284 |
| UNKNOWN_CLAIM | `ambient_extra/19_split_lens` | `sliderParallax` | UNKNOWN_CLAIM | 0.0281 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0281 |
| UNKNOWN_CLAIM | `ambient_extra/28_organ_chords` | `sliderResonance` | UNKNOWN_CLAIM | 0.0270 | name_makes_no_falsifiable_claim | dominant mover rMean 0.0269 |
| UNKNOWN_CLAIM | `35_sparkle_rain` | `sliderFall` | UNKNOWN_CLAIM | 0.0248 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0248 |
| UNKNOWN_CLAIM | `ambient_extra/08_quiet_signal` | `sliderHalo` | UNKNOWN_CLAIM | 0.0248 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0248 |
| UNKNOWN_CLAIM | `ambient_extra/50_last_lantern` | `sliderHandoff` | UNKNOWN_CLAIM | 0.0242 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0242 |
| UNKNOWN_CLAIM | `ambient_extra/08_quiet_signal` | `sliderOrganAnswer` | UNKNOWN_CLAIM | 0.0238 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0239 |
| UNKNOWN_CLAIM | `summer_camp/54_boiler_fire_overdrive` | `sliderSwirl` | UNKNOWN_CLAIM | 0.0237 | name_makes_no_falsifiable_claim | dominant mover temporalFreq 0.0237 |
| UNKNOWN_CLAIM | `ambient_extra/05_open_gate` | `sliderHold` | UNKNOWN_CLAIM | 0.0213 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0213 |
| UNKNOWN_CLAIM | `summer_camp/56_stage_mirror_axis` | `sliderCenter` | UNKNOWN_CLAIM | 0.0210 | name_makes_no_falsifiable_claim | dominant mover temporalFreq 0.0210 |
| UNKNOWN_CLAIM | `summer_camp/52_iceberg_shear_line` | `sliderShearAngle` | UNKNOWN_CLAIM | 0.0169 | name_makes_no_falsifiable_claim | dominant mover spatialFreqX 0.0169 |
| UNKNOWN_CLAIM | `12_breathing` | `sliderRibbing` | UNKNOWN_CLAIM | 0.0163 | name_makes_no_falsifiable_claim | dominant mover spatialFreqX 0.0163 |
| UNKNOWN_CLAIM | `ambient_extra/37_single_thread` | `sliderJewelryNeedle` | UNKNOWN_CLAIM | 0.0145 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0145 |
| UNKNOWN_CLAIM | `summer_camp/52_iceberg_shear_line` | `sliderTriangleBlade` | UNKNOWN_CLAIM | 0.0144 | name_makes_no_falsifiable_claim | dominant mover driftZ 0.0144 |
| UNKNOWN_CLAIM | `summer_camp/56_stage_mirror_axis` | `sliderAxisDrift` | UNKNOWN_CLAIM | 0.0140 | name_makes_no_falsifiable_claim | dominant mover temporalFreq 0.0140 |
| UNKNOWN_CLAIM | `ambient_extra/46_twin_seals` | `sliderInscription` | UNKNOWN_CLAIM | 0.0139 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0139 |
| UNKNOWN_CLAIM | `ambient_extra/23_needle_gauge` | `sliderRange` | UNKNOWN_CLAIM | 0.0133 | name_makes_no_falsifiable_claim | dominant mover spatialFreqY 0.0133 |
| UNKNOWN_CLAIM | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderBloomGrowth` | UNKNOWN_CLAIM | 0.0128 | name_makes_no_falsifiable_claim | dominant mover temporalFreq 0.0128 |
| UNKNOWN_CLAIM | `summer_camp/52_iceberg_shear_line` | `sliderAdvance` | UNKNOWN_CLAIM | 0.0114 | name_makes_no_falsifiable_claim | dominant mover driftZ 0.0114 |
| UNKNOWN_CLAIM | `ambient_extra/43_leaf_turn` | `sliderJewelryDew` | UNKNOWN_CLAIM | 0.0109 | name_makes_no_falsifiable_claim | dominant mover spatialFreqZ 0.0109 |
| UNKNOWN_CLAIM | `ambient_extra/24_bead_counter` | `sliderHold` | UNKNOWN_CLAIM | 0.0097 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0097 |
| UNKNOWN_CLAIM | `ambient_extra/16_turning_tiles` | `sliderFaceHold` | UNKNOWN_CLAIM | 0.0073 | name_makes_no_falsifiable_claim | dominant mover spatialFreqX 0.0072 |
| UNKNOWN_CLAIM | `37_chevron_chase` | `sliderStep` | UNKNOWN_CLAIM | 0.0071 | name_makes_no_falsifiable_claim | dominant mover driftZ 0.0071 |
| UNKNOWN_CLAIM | `ambient_extra/42_seed_drift` | `sliderTumble` | UNKNOWN_CLAIM | 0.0064 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0064 |
| UNKNOWN_CLAIM | `ambient_extra/01_harbor_glass` | `sliderJewelryGlint` | UNKNOWN_CLAIM | 0.0063 | name_makes_no_falsifiable_claim | dominant mover contrastRatio 0.0063 |
| TRUE | `25_heartbeat` | `sliderDirection` | DIRECTION | 3.0935 | claim_met | launch driftX -0.6956/-0.6956/0.7439/0.7439/0.7439 (ends -0.6956 → 0.7439, floor ±0.004); velocity-series correlation low↔high 0.295 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `25_heartbeat` | `sliderLocalSpeed` | SPEED | 1.9560 | claim_met | temporalRate 0.0042/0.0087/0.0144/0.0203/0.0199 (ratio 4.81, mono 1); temporalFreq ratio 4.69, mono 1 |
| TRUE | `28_spectrum_bloom` | `sliderLow` | MAGNITUDE | 1.8921 | claim_met | dominant mover contrastRatio 1.8921 |
| TRUE | `summer_camp/71_tree_aurora` | `sliderAuroraHeight` | SPATIAL | 1.8687 | claim_met | edgeSharpnessZ swing 0.1258, monotonic 1 |
| TRUE | `25_heartbeat` | `sliderKick` | MAGNITUDE | 1.5318 | claim_met | dominant mover driftX 1.5318 |
| TRUE | `53_neon_elevator_hd` | `sliderLocalSpeed` | SPEED | 1.5154 | claim_met | temporalRate 0.0016/0.0032/0.0065/0.0118/0.0178 (ratio 10.90, mono 1); temporalFreq ratio 16.24, mono 1 |
| TRUE | `74_calibration_bpm_ruler` | `sliderLevel` | BRIGHTNESS | 1.4710 | claim_met | lumaMean swing 0.0643 ratio 64278.06 (via absolute), monotonic 1 |
| TRUE | `67_calibration_y_plane` | `sliderWidth` | SPATIAL | 1.4253 | claim_met | spatialFreqZ swing 0.4348, monotonic 0 [non-monotonic] |
| TRUE | `calib_swipe_up_down` | `sliderLocalSpeed` | SPEED | 1.3513 | claim_met | temporalRate 0.0018/0.0041/0.0070/0.0114/0.0151 (ratio 8.25, mono 1); temporalFreq ratio 7.46, mono 1 |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderHeatIntensity` | BRIGHTNESS | 1.3080 | claim_met | lumaMean swing 0.0203 ratio 20263.52 (via absolute), monotonic 1 |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderPingGlow` | BRIGHTNESS | 1.3066 | claim_met | lumaMean swing 0.0101 ratio 6.35 (via ratio), monotonic 1 |
| TRUE | `39_tide_riser` | `sliderBase` | MAGNITUDE | 1.1876 | claim_met | dominant mover contrastRatio 1.1876 |
| TRUE | `summer_camp/82_redwood_timber_fall` | `sliderCanopyBrightness` | BRIGHTNESS | 1.1865 | claim_met | lumaMean swing 0.0159 ratio 5.00 (via ratio), monotonic 1 |
| TRUE | `summer_camp/81_outpost_distress_beacon` | `sliderEchoGlow` | BRIGHTNESS | 1.1827 | claim_met | outputMean swing 0.0189 ratio 4.28 (via ratio), monotonic 1 |
| TRUE | `129_five_colour_stations` | `sliderLevel` | BRIGHTNESS | 1.1222 | claim_met | lumaMean swing 0.1252 ratio 125222.78 (via absolute), monotonic 1 |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderBandWidth` | SPATIAL | 1.1192 | claim_met | edgeSharpnessZ swing 0.0966, monotonic 1 |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderBrightness` | BRIGHTNESS | 1.1151 | claim_met | lumaMean swing 0.0083 ratio 3.66 (via ratio), monotonic 1 |
| TRUE | `128_five_colour_prism` | `sliderLevel` | BRIGHTNESS | 1.0649 | claim_met | lumaMean swing 0.1266 ratio 126625.98 (via absolute), monotonic 1 |
| TRUE | `28_spectrum_bloom` | `sliderFloor` | MAGNITUDE | 1.0474 | claim_met | dominant mover contrastRatio 1.0474 |
| TRUE | `02_phase_cathedral` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0614 ratio 61408.02 (via absolute), monotonic 1 |
| TRUE | `12_breathing` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0399 ratio 39880.45 (via absolute), monotonic 1 |
| TRUE | `130_spatial_paint` | `sliderGlow` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1207 ratio 11.83 (via absolute), monotonic 1 |
| TRUE | `41_reaction_diffusion` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0663 ratio 66311.77 (via absolute), monotonic 1 |
| TRUE | `69_calibration_coordinate_rgb` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.5709 ratio 570898.19 (via absolute), monotonic 1 |
| TRUE | `70_calibration_fixture_types` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.4580 ratio 457968.25 (via absolute), monotonic 1 |
| TRUE | `73_calibration_emitter_channels` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.2126 ratio 212600.00 (via absolute), monotonic 1 |
| TRUE | `baby/01_tease_orbit_question` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1172 ratio 117239.31 (via absolute), monotonic 1 |
| TRUE | `baby/02_tease_crossing_question` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1773 ratio 177302.12 (via absolute), monotonic 1 |
| TRUE | `baby/03_tease_rose_question` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1567 ratio 156672.77 (via absolute), monotonic 1 |
| TRUE | `baby/04_tease_tidal_ribbons` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1044 ratio 104374.52 (via absolute), monotonic 1 |
| TRUE | `baby/05_tease_diamond_echo` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0995 ratio 99521.50 (via absolute), monotonic 1 |
| TRUE | `baby/06_tease_bow_stern_comets` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0468 ratio 46796.18 (via absolute), monotonic 1 |
| TRUE | `baby/07_tease_lattice_bloom` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0748 ratio 74824.57 (via absolute), monotonic 1 |
| TRUE | `baby/08_tease_moire_gates` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1806 ratio 180574.17 (via absolute), monotonic 1 |
| TRUE | `baby/09_tease_helix_exchange` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1232 ratio 123172.05 (via absolute), monotonic 1 |
| TRUE | `baby/10_tease_constellation_tides` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0601 ratio 60118.08 (via absolute), monotonic 1 |
| TRUE | `baby/16_boy_orbit_glow` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1496 ratio 149600.37 (via absolute), monotonic 1 |
| TRUE | `baby/17_boy_crossing_glow` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.2281 ratio 228112.70 (via absolute), monotonic 1 |
| TRUE | `baby/18_boy_rose_glow` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.2039 ratio 203930.42 (via absolute), monotonic 1 |
| TRUE | `baby/19_boy_horizon_tides` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1424 ratio 142362.34 (via absolute), monotonic 1 |
| TRUE | `baby/20_boy_cradle_waves` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1270 ratio 127008.54 (via absolute), monotonic 1 |
| TRUE | `baby/21_boy_comet_lullaby` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1024 ratio 102364.01 (via absolute), monotonic 1 |
| TRUE | `baby/22_boy_constellation_flow` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0383 ratio 38342.67 (via absolute), monotonic 1 |
| TRUE | `baby/23_boy_moonlit_ripples` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1002 ratio 100191.21 (via absolute), monotonic 1 |
| TRUE | `baby/24_boy_ribbon_braid` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1332 ratio 133244.96 (via absolute), monotonic 1 |
| TRUE | `baby/25_boy_bubble_chorus` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0543 ratio 54253.02 (via absolute), monotonic 1 |
| TRUE | `baby/26_boy_lighthouse_fans` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1137 ratio 113658.74 (via absolute), monotonic 1 |
| TRUE | `baby/27_boy_heartbeat_bloom` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1112 ratio 111231.12 (via absolute), monotonic 1 |
| TRUE | `baby/28_boy_waterfall_veil` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0559 ratio 55922.03 (via absolute), monotonic 1 |
| TRUE | `baby/29_boy_diamond_quilt` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0863 ratio 86270.09 (via absolute), monotonic 1 |
| TRUE | `baby/30_boy_celebration_burst` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0956 ratio 95560.16 (via absolute), monotonic 1 |
| TRUE | `baby/31_girl_orbit_glow` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1090 ratio 109034.19 (via absolute), monotonic 1 |
| TRUE | `baby/32_girl_crossing_glow` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1598 ratio 159765.39 (via absolute), monotonic 1 |
| TRUE | `baby/33_girl_rose_glow` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1455 ratio 145523.47 (via absolute), monotonic 1 |
| TRUE | `baby/34_girl_horizon_tides` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1046 ratio 104639.37 (via absolute), monotonic 1 |
| TRUE | `baby/35_girl_cradle_waves` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0940 ratio 93982.40 (via absolute), monotonic 1 |
| TRUE | `baby/36_girl_comet_lullaby` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0773 ratio 77321.11 (via absolute), monotonic 1 |
| TRUE | `baby/37_girl_constellation_flow` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0329 ratio 32942.61 (via absolute), monotonic 1 |
| TRUE | `baby/38_girl_moonlit_ripples` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0758 ratio 75847.41 (via absolute), monotonic 1 |
| TRUE | `baby/39_girl_ribbon_braid` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0986 ratio 98571.25 (via absolute), monotonic 1 |
| TRUE | `baby/40_girl_bubble_chorus` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0447 ratio 44701.75 (via absolute), monotonic 1 |
| TRUE | `baby/41_girl_lighthouse_fans` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0842 ratio 84247.48 (via absolute), monotonic 1 |
| TRUE | `baby/42_girl_heartbeat_bloom` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0831 ratio 83092.46 (via absolute), monotonic 1 |
| TRUE | `baby/43_girl_waterfall_veil` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0459 ratio 45868.91 (via absolute), monotonic 1 |
| TRUE | `baby/44_girl_diamond_quilt` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0658 ratio 65762.84 (via absolute), monotonic 1 |
| TRUE | `baby/45_girl_celebration_burst` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0736 ratio 73570.09 (via absolute), monotonic 1 |
| TRUE | `baby/46_tease_checkerboard_morph` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.2225 ratio 222529.92 (via absolute), monotonic 1 |
| TRUE | `baby/47_tease_twin_lantern_tides` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0904 ratio 90442.29 (via absolute), monotonic 1 |
| TRUE | `baby/48_tease_parallax_ribbons` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0931 ratio 93051.50 (via absolute), monotonic 1 |
| TRUE | `baby/49_tease_horizon_seesaw` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1542 ratio 154155.43 (via absolute), monotonic 1 |
| TRUE | `baby/50_tease_constellation_duet` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0722 ratio 72163.00 (via absolute), monotonic 1 |
| TRUE | `baby/51_boy_keel_breath` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0654 ratio 65364.53 (via absolute), monotonic 1 |
| TRUE | `baby/52_boy_bow_wave` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1140 ratio 114019.12 (via absolute), monotonic 1 |
| TRUE | `baby/53_boy_stern_wake` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1667 ratio 166749.64 (via absolute), monotonic 1 |
| TRUE | `baby/54_boy_stack_halo` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0916 ratio 91551.39 (via absolute), monotonic 1 |
| TRUE | `baby/55_boy_rail_cascade` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1106 ratio 110554.18 (via absolute), monotonic 1 |
| TRUE | `baby/56_boy_sign_lantern` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1170 ratio 116981.33 (via absolute), monotonic 1 |
| TRUE | `baby/57_boy_hull_constellations` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0509 ratio 50943.66 (via absolute), monotonic 1 |
| TRUE | `baby/58_boy_silhouette_tide` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0932 ratio 93229.91 (via absolute), monotonic 1 |
| TRUE | `baby/59_boy_cathedral_ribs` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.2619 ratio 261875.97 (via absolute), monotonic 1 |
| TRUE | `baby/60_boy_orbital_pearls` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0647 ratio 64686.81 (via absolute), monotonic 1 |
| TRUE | `baby/61_boy_crossing_beacons` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1941 ratio 194083.30 (via absolute), monotonic 1 |
| TRUE | `baby/62_boy_gentle_maelstrom` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1409 ratio 140939.16 (via absolute), monotonic 1 |
| TRUE | `baby/63_boy_aurora_veil` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1586 ratio 158573.30 (via absolute), monotonic 1 |
| TRUE | `baby/64_boy_harbor_fireflies` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1443 ratio 144302.91 (via absolute), monotonic 1 |
| TRUE | `baby/65_boy_celebration_bloom` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1778 ratio 177822.11 (via absolute), monotonic 1 |
| TRUE | `baby/66_girl_keel_breath` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0570 ratio 56959.48 (via absolute), monotonic 1 |
| TRUE | `baby/67_girl_bow_wave` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0891 ratio 89105.27 (via absolute), monotonic 1 |
| TRUE | `baby/68_girl_stern_wake` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1214 ratio 121439.39 (via absolute), monotonic 1 |
| TRUE | `baby/69_girl_stack_halo` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0761 ratio 76096.80 (via absolute), monotonic 1 |
| TRUE | `baby/70_girl_rail_cascade` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0859 ratio 85901.43 (via absolute), monotonic 1 |
| TRUE | `baby/71_girl_sign_lantern` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1012 ratio 101183.07 (via absolute), monotonic 1 |
| TRUE | `baby/72_girl_hull_constellations` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0460 ratio 45959.55 (via absolute), monotonic 1 |
| TRUE | `baby/73_girl_silhouette_tide` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0748 ratio 74758.39 (via absolute), monotonic 1 |
| TRUE | `baby/74_girl_cathedral_ribs` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1885 ratio 188477.93 (via absolute), monotonic 1 |
| TRUE | `baby/75_girl_orbital_pearls` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.0563 ratio 56344.39 (via absolute), monotonic 1 |
| TRUE | `baby/76_girl_crossing_beacons` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1400 ratio 140049.35 (via absolute), monotonic 1 |
| TRUE | `baby/77_girl_gentle_maelstrom` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1077 ratio 107734.59 (via absolute), monotonic 1 |
| TRUE | `baby/78_girl_aurora_veil` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1154 ratio 115432.02 (via absolute), monotonic 1 |
| TRUE | `baby/79_girl_harbor_fireflies` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1086 ratio 108563.49 (via absolute), monotonic 1 |
| TRUE | `baby/80_girl_celebration_bloom` | `sliderLevel` | BRIGHTNESS | 1.0000 | claim_met | lumaMean swing 0.1300 ratio 129993.05 (via absolute), monotonic 1 |
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
| TRUE | `baby/13_tease_wave_collision` | `sliderLevel` | BRIGHTNESS | 0.9941 | claim_met | lumaMean swing 0.0624 ratio 62438.29 (via absolute), monotonic 1 |
| TRUE | `test/solid` | `sliderColorPalette1` | HUE | 0.9919 | claim_met | hue circular swing 0.4959 turns (normalised 0.9918), saturation swing 0.0000 |
| TRUE | `baby/12_tease_kaleidoscope` | `sliderLevel` | BRIGHTNESS | 0.9898 | claim_met | lumaMean swing 0.0949 ratio 94949.13 (via absolute), monotonic 1 |
| TRUE | `baby/14_tease_spiral_race` | `sliderLevel` | BRIGHTNESS | 0.9897 | claim_met | lumaMean swing 0.1024 ratio 102430.09 (via absolute), monotonic 1 |
| TRUE | `baby/15_tease_velocity_weave` | `sliderLevel` | BRIGHTNESS | 0.9896 | claim_met | lumaMean swing 0.1024 ratio 102434.85 (via absolute), monotonic 1 |
| TRUE | `baby/11_tease_prismatic_fans` | `sliderLevel` | BRIGHTNESS | 0.9893 | claim_met | lumaMean swing 0.1172 ratio 117230.93 (via absolute), monotonic 1 |
| TRUE | `42_phyllotaxis_spiral` | `sliderFloorLvl` | MAGNITUDE | 0.9699 | claim_met | dominant mover contrastRatio 0.9699 |
| TRUE | `calib_swipe_left_right` | `sliderLocalSpeed` | SPEED | 0.9687 | claim_met | temporalRate 0.0018/0.0039/0.0067/0.0124/0.0191 (ratio 10.41, mono 1); temporalFreq ratio 7.55, mono 1 |
| TRUE | `17_rolling_color_dunes` | `sliderLevel` | BRIGHTNESS | 0.9627 | claim_met | lumaMean swing 0.0185 ratio 23.60 (via ratio), monotonic 1 |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderWedgeWidth` | SPATIAL | 0.9561 | claim_met | litFraction swing 0.1215, monotonic 1 |
| TRUE | `50_phase_cathedral_hd` | `sliderNodeContrast` | CONTRAST | 0.9495 | claim_met | contrastRatio swing 0.3855 ratio 2.13 (via absolute) |
| TRUE | `31_strobe_lattice` | `sliderLevel` | BRIGHTNESS | 0.9421 | claim_met | lumaMean swing 0.0365 ratio 19.59 (via absolute), monotonic 1 |
| TRUE | `40_lissajous_weave` | `sliderLevel` | BRIGHTNESS | 0.9384 | claim_met | lumaMean swing 0.1098 ratio 17.42 (via absolute), monotonic 1 |
| TRUE | `68_calibration_z_plane` | `sliderWidth` | SPATIAL | 0.9366 | claim_met | spatialFreqY swing 0.5217, monotonic 0 [non-monotonic] |
| TRUE | `53_neon_elevator_hd` | `sliderLevel` | BRIGHTNESS | 0.9201 | claim_met | lumaMean swing 0.0414 ratio 5.74 (via absolute), monotonic 1 |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderCanopyGlow` | BRIGHTNESS | 0.8944 | claim_met | lumaMean swing 0.0107 ratio 3.61 (via ratio), monotonic 1 |
| TRUE | `27_swipe` | `sliderLocalSpeed` | SPEED | 0.8667 | claim_met | temporalRate 0.0000/0.0007/0.0015/0.0019/0.0025 (ratio 2522.73, mono 1); temporalFreq ratio 14860.14, mono 1 |
| TRUE | `53_neon_elevator_hd` | `sliderFloorCount` | SPATIAL | 0.8647 | claim_met | spatialFreqY swing 0.2494, monotonic 1 |
| TRUE | `15_silk_prism_ribbons` | `sliderLevel` | BRIGHTNESS | 0.8635 | claim_met | lumaMean swing 0.0976 ratio 10.05 (via absolute), monotonic 1 |
| TRUE | `65_uv_only` | `sliderLevel` | BRIGHTNESS | 0.8542 | claim_met | outputMean swing 0.0527 ratio 6.88 (via absolute), monotonic 1 |
| TRUE | `25_heartbeat` | `sliderDormantGlow` | BRIGHTNESS | 0.8466 | claim_met | lumaMean swing 0.0596 ratio 5.55 (via absolute), monotonic 1 |
| TRUE | `38_prism_helix` | `sliderLevel` | BRIGHTNESS | 0.8464 | claim_met | lumaMean swing 0.0610 ratio 5.28 (via absolute), monotonic 1 |
| TRUE | `47_quasicrystal_dunes` | `sliderDuneHeight` | SPATIAL | 0.8463 | claim_met | litFraction swing 0.8463, monotonic 1 |
| TRUE | `49_cylon_crush` | `sliderLevel` | BRIGHTNESS | 0.8448 | claim_met | lumaMean swing 0.0922 ratio 45.33 (via absolute), monotonic 1 |
| TRUE | `45_manta_drift` | `sliderSwell` | MAGNITUDE | 0.8409 | claim_met | dominant mover litFraction 0.8409 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderTurnDecay` | TRAIL | 0.8158 | claim_met | litFraction swing 0.8158 |
| TRUE | `test_dualband` | `sliderColorPalette1` | HUE | 0.8128 | claim_met | hue circular swing 0.4064 turns (normalised 0.8128), saturation swing 0.0000 |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderOrganGlow` | BRIGHTNESS | 0.8016 | claim_met | lumaMean swing 0.0081 ratio 3.68 (via ratio), monotonic 1 |
| TRUE | `10_chasers` | `sliderLevel` | BRIGHTNESS | 0.7972 | claim_met | lumaMean swing 0.1043 ratio 13.62 (via absolute), monotonic 1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderPulseIntensity` | BRIGHTNESS | 0.7972 | claim_met | outputMean swing 0.0202 ratio 4.06 (via absolute), monotonic 1 |
| TRUE | `44_biolume_swell` | `sliderSwell` | MAGNITUDE | 0.7672 | claim_met | dominant mover litFraction 0.7672 |
| TRUE | `24_chromatic_murmuration` | `sliderAfterglow` | TRAIL | 0.7655 | claim_met | litFraction swing 0.7655 |
| TRUE | `ambient_extra/39_magnetic_sand` | `sliderSafetyFloor` | MAGNITUDE | 0.7507 | claim_met | dominant mover litFraction 0.7506 |
| TRUE | `ambient_extra/37_single_thread` | `sliderSafetyFloor` | MAGNITUDE | 0.7478 | claim_met | dominant mover litFraction 0.7478 |
| TRUE | `ambient_extra/44_healing_cracks` | `sliderSafetyFloor` | MAGNITUDE | 0.7426 | claim_met | dominant mover litFraction 0.7426 |
| TRUE | `18_deep_space_lattice` | `sliderLevel` | BRIGHTNESS | 0.7417 | claim_met | lumaMean swing 0.1225 ratio 14.81 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/02_brass_compass` | `sliderLevel` | BRIGHTNESS | 0.7380 | claim_met | lumaMean swing 0.0693 ratio 5.16 (via absolute), monotonic 1 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderLocalSpeed` | SPEED | 0.7380 | claim_met | temporalRate 0.0003/0.0008/0.0010/0.0013/0.0015 (ratio 4.18, mono 1); temporalFreq ratio 4.84, mono 0 |
| TRUE | `32_caustic_shimmer` | `sliderBase` | MAGNITUDE | 0.7339 | claim_met | dominant mover contrastRatio 0.7339 |
| TRUE | `07_shimmer` | `sliderLevel` | BRIGHTNESS | 0.7332 | claim_met | lumaMean swing 0.1151 ratio 7.08 (via absolute), monotonic 1 |
| TRUE | `23_prismatic_strange_attractors` | `sliderContrast` | CONTRAST | 0.7318 | claim_met | contrastRatio swing 0.5101 ratio 1.92 (via absolute) |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderPopDecay` | TRAIL | 0.7283 | claim_met | litFraction swing 0.7283 |
| TRUE | `52_silk_ribbons` | `sliderAudioLevel` | BRIGHTNESS | 0.7214 | claim_met | lumaMean swing 0.1089 ratio 10.87 (via absolute), monotonic 1 |
| TRUE | `54_murmuration_storm` | `sliderFlockEnergy` | MAGNITUDE | 0.7175 | claim_met | dominant mover rMean 0.7175 |
| TRUE | `33_aurora_breath` | `sliderBase` | MAGNITUDE | 0.7141 | claim_met | dominant mover contrastRatio 0.7141 |
| TRUE | `45_manta_drift` | `sliderDepth` | MAGNITUDE | 0.7094 | claim_met | dominant mover litFraction 0.7093 |
| TRUE | `57_ink_diffuse` | `sliderBase` | MAGNITUDE | 0.7064 | claim_met | dominant mover rMean 0.7064 |
| TRUE | `64_temple_warm_white` | `sliderWarmth` | WARMTH | 0.7003 | claim_met | bMean swing 0.0616 ratio 3.30 (via absolute), hue 0.0012 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderHullGlow` | BRIGHTNESS | 0.7002 | claim_met | lumaMean swing 0.0668 ratio 12.26 (via absolute), monotonic 1 |
| TRUE | `02_phase_cathedral` | `sliderLocalSpeed` | SPEED | 0.6987 | claim_met | temporalRate 0.0009/0.0013/0.0022/0.0040/0.0073 (ratio 7.90, mono 1); temporalFreq ratio 8.65, mono 1 |
| TRUE | `ambient_extra/41_jelly_bells` | `sliderPulse` | MAGNITUDE | 0.6920 | claim_met | dominant mover litFraction 0.6920 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderRevealWidth` | SPATIAL | 0.6831 | claim_met | litFraction swing 0.3039, monotonic 1 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderSectionFloor` | SPATIAL | 0.6744 | claim_met | edgeSharpnessZ swing 0.1003, monotonic 1 |
| TRUE | `test_dualband` | `sliderColorPalette2` | HUE | 0.6696 | claim_met | hue circular swing 0.3348 turns (normalised 0.6696), saturation swing 0.0000 |
| TRUE | `09_cyclone` | `sliderLevel` | BRIGHTNESS | 0.6651 | claim_met | lumaMean swing 0.0470 ratio 7.71 (via absolute), monotonic 1 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderSweepWidth` | SPATIAL | 0.6624 | claim_met | litFraction swing 0.5118, monotonic 1 |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderMoltenGlow` | BRIGHTNESS | 0.6571 | claim_met | lumaMean swing 0.0139 ratio 4.07 (via ratio), monotonic 1 |
| TRUE | `03_dual_axis_crush` | `sliderLevel` | BRIGHTNESS | 0.6516 | claim_met | lumaMean swing 0.0744 ratio 6.25 (via absolute), monotonic 1 |
| TRUE | `30_bass_comet` | `sliderDirection` | DIRECTION | 0.6473 | claim_met | launch driftZ -0.0004/-0.0004/0.0813/0.0813/0.0813 (ends -0.0004 → 0.0813, floor ±0.004); velocity-series correlation low↔high -0.539 (reversal at ≤ -0.3) [via anticorrelated_motion] |
| TRUE | `17_rolling_color_dunes` | `sliderLocalSpeed` | SPEED | 0.6473 | claim_met | temporalRate 0.0000/0.0001/0.0004/0.0005/0.0009 (ratio 23.91, mono 1); temporalFreq ratio 7.20, mono 1 |
| TRUE | `25_heartbeat` | `sliderRadius` | SPATIAL | 0.6449 | claim_met | spatialFreqY swing 0.0879, monotonic 1 |
| TRUE | `37_chevron_chase` | `sliderWidth` | SPATIAL | 0.6380 | claim_met | litFraction swing 0.6380, monotonic 1 |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderSectionFloor` | SPATIAL | 0.6250 | claim_met | spatialFreqY swing 0.1220, monotonic 0 [non-monotonic] |
| TRUE | `48_heartbeat_drive` | `sliderLow` | MAGNITUDE | 0.6213 | claim_met | dominant mover rMean 0.6213 |
| TRUE | `41_reaction_diffusion` | `sliderBase` | MAGNITUDE | 0.6203 | claim_met | dominant mover litFraction 0.6203 |
| TRUE | `63_white_chase` | `sliderWarmth` | WARMTH | 0.6187 | claim_met | bMean swing 0.0736 ratio 2.59 (via absolute), hue 0.0090 |
| TRUE | `62_white_shimmer` | `sliderWarmth` | WARMTH | 0.6160 | claim_met | bMean swing 0.0364 ratio 2.60 (via absolute), hue 0.0004 |
| TRUE | `22_abyssal_sway_garden` | `sliderLevel` | BRIGHTNESS | 0.6159 | claim_met | lumaMean swing 0.0769 ratio 5.66 (via absolute), monotonic 1 |
| TRUE | `43_golden_hour_pulse` | `sliderNoiseScale` | SPATIAL | 0.6118 | claim_met | litFraction swing 0.6118, monotonic 0 [non-monotonic] |
| TRUE | `60_white_wash` | `sliderWarmth` | WARMTH | 0.6067 | claim_met | bMean swing 0.1151 ratio 2.54 (via absolute), hue 0.0001 |
| TRUE | `61_white_breathe` | `sliderWarmth` | WARMTH | 0.6041 | claim_met | bMean swing 0.1833 ratio 2.53 (via absolute), hue 0.0003 |
| TRUE | `14_lunar_current` | `sliderCurrentWidth` | SPATIAL | 0.5986 | claim_met | litFraction swing 0.4967, monotonic 1 |
| TRUE | `61_white_breathe` | `sliderLevel` | BRIGHTNESS | 0.5979 | claim_met | outputMean swing 0.3822 ratio 13.09 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/41_jelly_bells` | `sliderSafetyFloor` | MAGNITUDE | 0.5958 | claim_met | dominant mover litFraction 0.5958 |
| TRUE | `baby/43_girl_waterfall_veil` | `sliderLocalSpeed` | SPEED | 0.5943 | claim_met | temporalRate 0.0013/0.0026/0.0053/0.0099/0.0170 (ratio 13.34, mono 1); temporalFreq ratio 12.74, mono 1 |
| TRUE | `baby/28_boy_waterfall_veil` | `sliderLocalSpeed` | SPEED | 0.5933 | claim_met | temporalRate 0.0013/0.0028/0.0056/0.0104/0.0179 (ratio 13.30, mono 1); temporalFreq ratio 12.77, mono 1 |
| TRUE | `party_dancers/01_dom_ball_dancers` | `sliderLevel` | BRIGHTNESS | 0.5933 | claim_met | lumaMean swing 0.1118 ratio 6.43 (via absolute), monotonic 1 |
| TRUE | `65_uv_only` | `sliderUvFloor` | UV | 0.5918 | claim_met | uvMean swing 0.5918 ratio 3.51 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderBaselineFloor` | MAGNITUDE | 0.5898 | claim_met | dominant mover contrastRatio 0.5898 |
| TRUE | `01_cylon_sweep` | `sliderLevel` | BRIGHTNESS | 0.5862 | claim_met | lumaMean swing 0.1063 ratio 5.88 (via absolute), monotonic 1 |
| TRUE | `10_chasers` | `sliderLocalSpeed` | SPEED | 0.5840 | claim_met | temporalRate 0.0055/0.0089/0.0151/0.0273/0.0261 (ratio 4.93, mono 0); temporalFreq ratio 5.43, mono 1 |
| TRUE | `47_quasicrystal_dunes` | `sliderDuneScale` | SPATIAL | 0.5822 | claim_met | litFraction swing 0.5822, monotonic 0 [non-monotonic] |
| TRUE | `17_rolling_color_dunes` | `sliderDetail` | SPATIAL | 0.5810 | claim_met | edgeSharpnessZ swing 0.0942, monotonic -1 |
| TRUE | `128_five_colour_prism` | `sliderGlow` | BRIGHTNESS | 0.5785 | claim_met | lumaMean swing 0.0669 ratio 1.65 (via absolute), monotonic 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderLevel` | BRIGHTNESS | 0.5746 | claim_met | lumaMean swing 0.0718 ratio 16.23 (via absolute), monotonic 1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderLocalSpeed` | SPEED | 0.5745 | claim_met | temporalRate 0.0000/0.0001/0.0006/0.0013/0.0032 (ratio 284.82, mono 1); temporalFreq ratio 8.48, mono 1 |
| TRUE | `62_white_shimmer` | `sliderLevel` | BRIGHTNESS | 0.5741 | claim_met | lumaMean swing 0.0703 ratio 9.55 (via absolute), monotonic 1 |
| TRUE | `61_white_breathe` | `sliderWhiteLevel` | WHITE | 0.5739 | claim_met | wMean swing 0.5739 ratio 7.00 (via absolute, threshold 0.01) |
| TRUE | `129_five_colour_stations` | `sliderGlow` | BRIGHTNESS | 0.5643 | claim_met | lumaMean swing 0.0632 ratio 1.61 (via absolute), monotonic 1 |
| TRUE | `63_white_chase` | `sliderLevel` | BRIGHTNESS | 0.5623 | claim_met | lumaMean swing 0.1362 ratio 9.56 (via absolute), monotonic 1 |
| TRUE | `20_parametric_sway_field` | `sliderFocus` | SPATIAL | 0.5583 | claim_met | litFraction swing 0.5583, monotonic -1 |
| TRUE | `02_phase_cathedral` | `sliderDirection` | DIRECTION | 0.5576 | claim_met | launch driftX -0.2117/-0.2117/0.0801/0.0801/0.0801 (ends -0.2117 → 0.0801, floor ±0.004); velocity-series correlation low↔high -0.339 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `37_chevron_chase` | `sliderBright` | BRIGHTNESS | 0.5573 | claim_met | lumaMean swing 0.0394 ratio 4.98 (via absolute), monotonic 1 |
| TRUE | `baby/57_boy_hull_constellations` | `sliderConnectorContrast` | CONTRAST | 0.5540 | claim_met | contrastRatio swing 0.5540 ratio 2.94 (via absolute) |
| TRUE | `baby/57_boy_hull_constellations` | `sliderStarSize` | SPATIAL | 0.5533 | claim_met | spatialFreqZ swing 0.3370, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/24_bead_counter` | `sliderBeadGlow` | BRIGHTNESS | 0.5470 | claim_met | lumaMean swing 0.0175 ratio 1.45 (via ratio), monotonic 1 |
| TRUE | `62_white_shimmer` | `sliderDensity` | SPATIAL | 0.5438 | claim_met | edgeSharpnessX swing 0.1703, monotonic 1 |
| TRUE | `02_phase_cathedral` | `sliderKick` | MAGNITUDE | 0.5330 | claim_met | dominant mover litFraction 0.5330 |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderBeamWidth` | SPATIAL | 0.5220 | claim_met | spatialFreqX swing 0.0845, monotonic 1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderAudioKick` | MAGNITUDE | 0.5208 | responds_to_edges_not_to_level | held static the control does nothing, but pulsed 0↔1 at 40 frames it moves contrastRatio by 0.5208 — this is an edge-triggered control, meant to be driven by a modulation mapping rather than parked at a value |
| TRUE | `ambient_extra/15_woven_light` | `sliderKnotGlow` | BRIGHTNESS | 0.5171 | claim_met | lumaMean swing 0.1099 ratio 2.41 (via absolute), monotonic 1 |
| TRUE | `21_pelagic_manta_rays` | `sliderLevel` | BRIGHTNESS | 0.5166 | claim_met | lumaMean swing 0.0542 ratio 3.46 (via absolute), monotonic 1 |
| TRUE | `46_abyssal_fronds` | `sliderLevel` | BRIGHTNESS | 0.5126 | claim_met | lumaMean swing 0.0946 ratio 3.40 (via absolute), monotonic 1 |
| TRUE | `30_bass_comet` | `sliderTail` | TRAIL | 0.5108 | claim_met | litFraction swing 0.5108 |
| TRUE | `01_cylon_sweep` | `sliderBackgroundGlow` | BRIGHTNESS | 0.5076 | claim_met | lumaMean swing 0.0485 ratio 1.61 (via absolute), monotonic 1 |
| TRUE | `15_silk_prism_ribbons` | `sliderSoftness` | SPATIAL | 0.5076 | claim_met | spatialFreqX swing 0.1440, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderLocalSpeed` | SPEED | 0.5068 | claim_met | temporalRate 0.0005/0.0010/0.0012/0.0016/0.0018 (ratio 3.78, mono 1); temporalFreq ratio 2.22, mono 0 |
| TRUE | `ambient_extra/02_brass_compass` | `sliderDialRadius` | SPATIAL | 0.5002 | claim_met | litFraction swing 0.5003, monotonic 1 |
| TRUE | `10_chasers` | `sliderCount` | SPATIAL | 0.4965 | claim_met | litFraction swing 0.4965, monotonic 1 |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderToothWidth` | SPATIAL | 0.4965 | claim_met | litFraction swing 0.3143, monotonic 1 |
| TRUE | `61_white_breathe` | `sliderWhiteKick` | WHITE | 0.4878 | claim_met | wMean swing 0.4878 ratio 2.31 (via absolute, threshold 0.01) |
| TRUE | `baby/29_boy_diamond_quilt` | `sliderQuiltScale` | SPATIAL | 0.4874 | claim_met | spatialFreqY swing 0.0975, monotonic 0 [non-monotonic] |
| TRUE | `baby/44_girl_diamond_quilt` | `sliderQuiltScale` | SPATIAL | 0.4867 | claim_met | spatialFreqY swing 0.0978, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderChordSpread` | SPATIAL | 0.4814 | claim_met | spatialFreqX swing 0.0655, monotonic -1 |
| TRUE | `00_golden_hour_wash` | `sliderLevel` | BRIGHTNESS | 0.4770 | claim_met | lumaMean swing 0.1027 ratio 4.36 (via absolute), monotonic 1 |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderShimmer` | MAGNITUDE | 0.4743 | claim_met | dominant mover contrastRatio 0.4743 |
| TRUE | `06_neon_elevator` | `sliderLocalSpeed` | SPEED | 0.4707 | claim_met | temporalRate 0.0008/0.0006/0.0012/0.0025/0.0072 (ratio 11.52, mono 1); temporalFreq ratio 8.00, mono 1 |
| TRUE | `38_prism_helix` | `sliderContrast` | CONTRAST | 0.4682 | claim_met | contrastRatio swing 0.4681 ratio 1.99 (via absolute) |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderBeamGlow` | SPATIAL | 0.4677 | claim_met | litFraction swing 0.0721, monotonic 1 |
| TRUE | `36_orbital_pulse` | `sliderFocus` | SPATIAL | 0.4663 | claim_met | edgeSharpnessY swing 0.0964, monotonic 1 |
| TRUE | `26_dom_dancers_chevron` | `sliderDancerGlow` | BRIGHTNESS | 0.4639 | claim_met | lumaMean swing 0.2497 ratio 2.75 (via absolute), monotonic 1 |
| TRUE | `05_orbital_attractor_field` | `sliderLevel` | BRIGHTNESS | 0.4634 | claim_met | lumaMean swing 0.0985 ratio 2.52 (via absolute), monotonic 1 |
| TRUE | `34_moire_interference` | `sliderLevel` | BRIGHTNESS | 0.4598 | claim_met | lumaMean swing 0.0609 ratio 4.64 (via absolute), monotonic 1 |
| TRUE | `128_five_colour_prism` | `sliderKick` | MAGNITUDE | 0.4552 | claim_met | dominant mover contrastRatio 0.4552 |
| TRUE | `129_five_colour_stations` | `sliderKick` | MAGNITUDE | 0.4549 | claim_met | dominant mover contrastRatio 0.4549 |
| TRUE | `baby/45_girl_celebration_burst` | `sliderLocalSpeed` | SPEED | 0.4543 | claim_met | temporalRate 0.0052/0.0099/0.0180/0.0329/0.0502 (ratio 9.73, mono 1); temporalFreq ratio 12.31, mono 1 |
| TRUE | `baby/30_boy_celebration_burst` | `sliderLocalSpeed` | SPEED | 0.4535 | claim_met | temporalRate 0.0054/0.0104/0.0190/0.0348/0.0529 (ratio 9.71, mono 1); temporalFreq ratio 12.28, mono 1 |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderBrightness` | BRIGHTNESS | 0.4508 | claim_met | lumaMean swing 0.0032 ratio 1.91 (via ratio), monotonic 1 |
| TRUE | `52_silk_ribbons` | `sliderRibbons` | SPATIAL | 0.4492 | claim_met | litFraction swing 0.4492, monotonic 1 |
| TRUE | `17_rolling_color_dunes` | `sliderDuneScale` | SPATIAL | 0.4457 | claim_met | edgeSharpnessZ swing 0.0576, monotonic 0 [non-monotonic] |
| TRUE | `20_parametric_sway_field` | `sliderKick` | MAGNITUDE | 0.4429 | claim_met | dominant mover litFraction 0.4429 |
| TRUE | `26_dom_dancers_chevron` | `sliderDancerSize` | SPATIAL | 0.4410 | claim_met | litFraction swing 0.2079, monotonic 1 |
| TRUE | `ambient_extra/26_drawbridge` | `sliderLevel` | BRIGHTNESS | 0.4348 | claim_met | lumaMean swing 0.0369 ratio 1.98 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/33_rope_constellation` | `sliderSafetyFloor` | MAGNITUDE | 0.4326 | claim_met | dominant mover litFraction 0.4326 |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderChaseGlow` | BRIGHTNESS | 0.4321 | claim_met | lumaMean swing 0.0248 ratio 4.28 (via absolute), monotonic 1 |
| TRUE | `baby/12_tease_kaleidoscope` | `sliderLocalSpeed` | SPEED | 0.4284 | claim_met | temporalRate 0.0091/0.0175/0.0333/0.0539/0.0639 (ratio 7.00, mono 1); temporalFreq ratio 8.99, mono 1 |
| TRUE | `ambient_extra/45_moss_islands` | `sliderSafetyFloor` | MAGNITUDE | 0.4279 | claim_met | dominant mover litFraction 0.4278 |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderLocalSpeed` | SPEED | 0.4273 | claim_met | temporalRate 0.0008/0.0013/0.0025/0.0051/0.0081 (ratio 9.67, mono 1); temporalFreq ratio 13.23, mono 1 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderVortexWidth` | SPATIAL | 0.4269 | claim_met | litFraction swing 0.3363, monotonic 1 |
| TRUE | `ambient_extra/23_needle_gauge` | `sliderSafetyFloor` | MAGNITUDE | 0.4195 | claim_met | dominant mover contrastRatio 0.4196 |
| TRUE | `ambient_extra/50_last_lantern` | `sliderSilhouetteLevel` | BRIGHTNESS | 0.4185 | claim_met | lumaMean swing 0.0402 ratio 1.82 (via absolute), monotonic 1 |
| TRUE | `baby/72_girl_hull_constellations` | `sliderStarSize` | SPATIAL | 0.4161 | claim_met | spatialFreqZ swing 0.3312, monotonic 0 [non-monotonic] |
| TRUE | `19_swaying_lattice_ballet` | `sliderDetail` | SPATIAL | 0.4154 | claim_met | litFraction swing 0.4154, monotonic -1 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderLocalSpeed` | SPEED | 0.4130 | claim_met | temporalRate 0.0004/0.0008/0.0014/0.0029/0.0058 (ratio 14.26, mono 1); temporalFreq ratio 12.68, mono 1 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderTrailGlow` | TRAIL | 0.4121 | claim_met | litFraction swing 0.2735 |
| TRUE | `baby/24_boy_ribbon_braid` | `sliderRibbonWidth` | SPATIAL | 0.4111 | claim_met | spatialFreqZ swing 0.1313, monotonic -1 |
| TRUE | `60_white_wash` | `sliderLevel` | BRIGHTNESS | 0.4106 | claim_met | outputMean swing 0.2536 ratio 8.69 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/04_five_lanterns` | `sliderLevel` | BRIGHTNESS | 0.4050 | claim_met | lumaMean swing 0.0628 ratio 2.80 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/37_single_thread` | `sliderGlow` | BRIGHTNESS | 0.4034 | claim_met | lumaMean swing 0.0310 ratio 2.11 (via absolute), monotonic 1 |
| TRUE | `34_moire_interference` | `sliderContrast` | CONTRAST | 0.4023 | claim_met | contrastRatio swing 0.3688 ratio 1.77 (via absolute) |
| TRUE | `42_phyllotaxis_spiral` | `sliderCoreSize` | SPATIAL | 0.4019 | claim_met | litFraction swing 0.4019, monotonic 1 |
| TRUE | `51_confetti_cyclone` | `sliderSparkSize` | SPATIAL | 0.3991 | claim_met | litFraction swing 0.3991, monotonic 1 |
| TRUE | `ambient_extra/46_twin_seals` | `sliderSafetyFloor` | MAGNITUDE | 0.3953 | claim_met | dominant mover contrastRatio 0.3953 |
| TRUE | `baby/21_boy_comet_lullaby` | `sliderLocalSpeed` | SPEED | 0.3944 | claim_met | temporalRate 0.0011/0.0022/0.0043/0.0084/0.0162 (ratio 14.92, mono 1); temporalFreq ratio 9.75, mono 1 |
| TRUE | `baby/72_girl_hull_constellations` | `sliderConnectorContrast` | CONTRAST | 0.3904 | claim_met | contrastRatio swing 0.3904 ratio 2.88 (via absolute) |
| TRUE | `baby/36_girl_comet_lullaby` | `sliderLocalSpeed` | SPEED | 0.3904 | claim_met | temporalRate 0.0010/0.0021/0.0040/0.0079/0.0154 (ratio 14.89, mono 1); temporalFreq ratio 9.70, mono 1 |
| TRUE | `58_lighthouse_solo` | `sliderBeam` | SPATIAL | 0.3895 | claim_met | spatialFreqZ swing 0.1709, monotonic -1 |
| TRUE | `ambient_extra/03_pearl_chain` | `sliderSafetyFloor` | MAGNITUDE | 0.3886 | claim_met | dominant mover litFraction 0.3886 |
| TRUE | `27_swipe` | `sliderDirection` | DIRECTION | 0.3885 | claim_met | launch driftX 0.1350/0.1350/-0.0328/-0.0328/-0.0328 (ends 0.1350 → -0.0328, floor ±0.004); velocity-series correlation low↔high -0.011 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `60_white_wash` | `sliderWhiteLevel` | WHITE | 0.3867 | claim_met | wMean swing 0.3867 ratio 8.69 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/71_tree_aurora` | `sliderLocalSpeed` | SPEED | 0.3839 | claim_met | temporalRate 0.0003/0.0007/0.0017/0.0032/0.0037 (ratio 13.30, mono 1); temporalFreq ratio 10.17, mono 0 |
| TRUE | `ambient_extra/49_all_together` | `sliderDetail` | SPATIAL | 0.3838 | claim_met | spatialFreqY swing 0.3838, monotonic 0 [non-monotonic] |
| TRUE | `09_cyclone` | `sliderLocalSpeed` | SPEED | 0.3786 | claim_met | temporalRate 0.0036/0.0062/0.0116/0.0211/0.0341 (ratio 9.46, mono 1); temporalFreq ratio 11.99, mono 1 |
| TRUE | `calib_swipe_up_down` | `sliderBandW` | SPATIAL | 0.3785 | claim_met | litFraction swing 0.2830, monotonic 1 |
| TRUE | `baby/12_tease_kaleidoscope` | `sliderEdgeFocus` | SPATIAL | 0.3784 | claim_met | litFraction swing 0.2391, monotonic -1 |
| TRUE | `baby/21_boy_comet_lullaby` | `sliderTailLength` | TRAIL | 0.3770 | claim_met | spatialFreqX swing 0.0414 |
| TRUE | `baby/42_girl_heartbeat_bloom` | `sliderLocalSpeed` | SPEED | 0.3760 | claim_met | temporalRate 0.0040/0.0080/0.0152/0.0275/0.0429 (ratio 10.76, mono 1); temporalFreq ratio 12.28, mono 1 |
| TRUE | `baby/27_boy_heartbeat_bloom` | `sliderLocalSpeed` | SPEED | 0.3757 | claim_met | temporalRate 0.0042/0.0085/0.0161/0.0291/0.0454 (ratio 10.75, mono 1); temporalFreq ratio 12.27, mono 1 |
| TRUE | `122_breathing_horizon` | `sliderAfterglow` | TRAIL | 0.3745 | claim_met | spatialFreqZ swing 0.2216 |
| TRUE | `35_sparkle_rain` | `sliderLevel` | BRIGHTNESS | 0.3719 | claim_met | lumaMean swing 0.0108 ratio 1.74 (via ratio), monotonic 1 |
| TRUE | `22_abyssal_sway_garden` | `sliderBaseDarkness` | DARKNESS | 0.3717 | claim_met | litFraction swing 0.3717 ratio 1.68 (via absolute), monotonic -1 (expected falling) |
| TRUE | `ambient_extra/34_soft_hourglass` | `sliderSafetyFloor` | MAGNITUDE | 0.3687 | claim_met | dominant mover litFraction 0.3687 |
| TRUE | `ambient_extra/48_organ_echoes` | `sliderOrganLevel` | BRIGHTNESS | 0.3683 | claim_met | lumaMean swing 0.0783 ratio 2.17 (via absolute), monotonic 1 |
| TRUE | `29_kick_shockwave` | `sliderLevel` | BRIGHTNESS | 0.3679 | claim_met | lumaMean swing 0.0782 ratio 3.51 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/11_paper_fold` | `sliderLevel` | BRIGHTNESS | 0.3665 | claim_met | lumaMean swing 0.0779 ratio 2.78 (via absolute), monotonic 1 |
| TRUE | `03_dual_axis_crush` | `sliderLocalSpeed` | SPEED | 0.3656 | claim_met | temporalRate 0.0018/0.0034/0.0065/0.0122/0.0231 (ratio 13.21, mono 1); temporalFreq ratio 14.05, mono 1 |
| TRUE | `ambient_extra/20_long_shadow` | `sliderRimWidth` | SPATIAL | 0.3653 | claim_met | spatialFreqY swing 0.3653, monotonic -1 |
| TRUE | `47_quasicrystal_dunes` | `sliderFloor` | MAGNITUDE | 0.3651 | claim_met | dominant mover rMean 0.3651 |
| TRUE | `51_confetti_cyclone` | `sliderLow` | MAGNITUDE | 0.3642 | claim_met | dominant mover litFraction 0.3642 |
| TRUE | `66_calibration_x_plane` | `sliderWidth` | SPATIAL | 0.3615 | claim_met | litFraction swing 0.3320, monotonic 1 |
| TRUE | `ambient_extra/35_turning_box` | `sliderSafetyFloor` | MAGNITUDE | 0.3610 | claim_met | dominant mover contrastRatio 0.3610 |
| TRUE | `summer_camp/53_shadow_eclipse` | `sliderOrbitEccentricity` | MAGNITUDE | 0.3587 | claim_met | dominant mover driftZ 0.3587 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderBlackoutDepth` | DARKNESS | 0.3587 | claim_met | litFraction swing 0.3586 ratio 1.77 (via absolute), monotonic -1 (expected falling) |
| TRUE | `04_beat_folded_helix` | `sliderLevel` | BRIGHTNESS | 0.3585 | claim_met | outputMean swing 0.0777 ratio 5.45 (via absolute), monotonic 1 |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderLocalSpeed` | SPEED | 0.3584 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0006/0.0011 (ratio 15.56, mono 1); temporalFreq ratio 4.35, mono 1 |
| TRUE | `baby/51_boy_keel_breath` | `sliderKeelWidth` | SPATIAL | 0.3582 | claim_met | spatialFreqZ swing 0.2421, monotonic 0 [non-monotonic] |
| TRUE | `23_prismatic_strange_attractors` | `sliderLevel` | BRIGHTNESS | 0.3578 | claim_met | lumaMean swing 0.0114 ratio 7.07 (via ratio), monotonic 1 |
| TRUE | `43_golden_hour_pulse` | `sliderSwell` | MAGNITUDE | 0.3577 | claim_met | dominant mover rMean 0.3577 |
| TRUE | `46_abyssal_fronds` | `sliderBaseGlow` | BRIGHTNESS | 0.3564 | claim_met | lumaMean swing 0.0204 ratio 1.25 (via absolute), monotonic 1 |
| TRUE | `58_lighthouse_solo` | `sliderSafetyFloor` | MAGNITUDE | 0.3534 | claim_met | dominant mover litFraction 0.3534 |
| TRUE | `40_lissajous_weave` | `sliderLocalSpeed` | SPEED | 0.3518 | claim_met | temporalRate 0.0026/0.0044/0.0077/0.0133/0.0207 (ratio 8.10, mono 1); temporalFreq ratio 8.78, mono 1 |
| TRUE | `54_murmuration_storm` | `sliderFocus` | SPATIAL | 0.3513 | claim_met | litFraction swing 0.3154, monotonic -1 |
| TRUE | `ambient_extra/22_balance_beam` | `sliderBalance` | MAGNITUDE | 0.3501 | claim_met | dominant mover contrastRatio 0.3501 |
| TRUE | `baby/69_girl_stack_halo` | `sliderHaloWidth` | SPATIAL | 0.3499 | claim_met | spatialFreqZ swing 0.3499, monotonic 0 [non-monotonic] |
| TRUE | `18_deep_space_lattice` | `sliderLineSoftness` | SPATIAL | 0.3460 | claim_met | litFraction swing 0.3250, monotonic 1 |
| TRUE | `60_white_wash` | `sliderWhiteKick` | WHITE | 0.3440 | claim_met | wMean swing 0.3440 ratio 2.28 (via absolute, threshold 0.01) |
| TRUE | `125_eclipse_orbit` | `sliderLevel` | BRIGHTNESS | 0.3412 | claim_met | lumaMean swing 0.0725 ratio 2.38 (via absolute), monotonic 1 |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderTrailDepth` | TRAIL | 0.3412 | claim_met | edgeSharpnessZ swing 0.0432 |
| TRUE | `74_calibration_bpm_ruler` | `sliderWidth` | SPATIAL | 0.3399 | claim_met | litFraction swing 0.2763, monotonic 1 |
| TRUE | `ambient_extra/13_cut_diamond` | `sliderSafetyFloor` | MAGNITUDE | 0.3399 | claim_met | dominant mover contrastRatio 0.3399 |
| TRUE | `ambient_extra/43_leaf_turn` | `sliderSafetyFloor` | MAGNITUDE | 0.3371 | claim_met | dominant mover contrastRatio 0.3371 |
| TRUE | `summer_camp/83_shadow_canopy_eclipse` | `sliderEclipseScale` | SPATIAL | 0.3346 | claim_met | litFraction swing 0.3346, monotonic -1 |
| TRUE | `baby/15_tease_velocity_weave` | `sliderLocalSpeed` | SPEED | 0.3345 | claim_met | temporalRate 0.0043/0.0088/0.0167/0.0320/0.0549 (ratio 12.66, mono 1); temporalFreq ratio 12.72, mono 1 |
| TRUE | `baby/11_tease_prismatic_fans` | `sliderLocalSpeed` | SPEED | 0.3343 | claim_met | temporalRate 0.0018/0.0039/0.0079/0.0150/0.0291 (ratio 15.84, mono 1); temporalFreq ratio 13.37, mono 1 |
| TRUE | `24_chromatic_murmuration` | `sliderContrast` | CONTRAST | 0.3335 | claim_met | contrastRatio swing 0.0797 ratio 1.13 (via absolute) |
| TRUE | `46_abyssal_fronds` | `sliderFrondDensity` | SPATIAL | 0.3332 | claim_met | litFraction swing 0.2656, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/40_deep_window` | `sliderBorderWidth` | SPATIAL | 0.3331 | claim_met | spatialFreqX swing 0.0779, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderLockdownPressure` | MAGNITUDE | 0.3322 | claim_met | dominant mover rMean 0.3322 |
| TRUE | `08_ocean_liner` | `sliderKick` | MAGNITUDE | 0.3305 | claim_met | dominant mover litFraction 0.3305 |
| TRUE | `ambient_extra/24_bead_counter` | `sliderSafetyFloor` | MAGNITUDE | 0.3303 | claim_met | dominant mover spatialFreqZ 0.3303 |
| TRUE | `ambient_extra/04_five_lanterns` | `sliderSafetyFloor` | MAGNITUDE | 0.3290 | claim_met | dominant mover litFraction 0.3290 |
| TRUE | `50_phase_cathedral_hd` | `sliderSharpBase` | SPATIAL | 0.3282 | claim_met | litFraction swing 0.3282, monotonic -1 |
| TRUE | `baby/54_boy_stack_halo` | `sliderHaloWidth` | SPATIAL | 0.3276 | claim_met | spatialFreqZ swing 0.3059, monotonic 1 |
| TRUE | `22_abyssal_sway_garden` | `sliderLocalSpeed` | SPEED | 0.3260 | claim_met | temporalRate 0.0008/0.0022/0.0058/0.0179/0.0317 (ratio 41.20, mono 1); temporalFreq ratio 28.72, mono 1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderCycleSpeed` | SPEED | 0.3254 | claim_met | temporalRate 0.0001/0.0003/0.0006/0.0008/0.0010 (ratio 7.89, mono 1); temporalFreq ratio 2.46, mono 1 |
| TRUE | `122_breathing_horizon` | `sliderLevel` | BRIGHTNESS | 0.3247 | claim_met | lumaMean swing 0.0690 ratio 2.47 (via absolute), monotonic 1 |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderTrail` | TRAIL | 0.3212 | claim_met | litFraction swing 0.0505 |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderSweepWidth` | SPATIAL | 0.3199 | claim_met | spatialFreqX swing 0.0589, monotonic -1 |
| TRUE | `calib_swipe_left_right` | `sliderBandW` | SPATIAL | 0.3192 | claim_met | litFraction swing 0.3192, monotonic 1 |
| TRUE | `49_cylon_crush` | `sliderTrail` | TRAIL | 0.3173 | claim_met | litFraction swing 0.3173 |
| TRUE | `11_bioluminescence` | `sliderLevel` | BRIGHTNESS | 0.3147 | claim_met | outputMean swing 0.0737 ratio 2.73 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/12_floating_frames` | `sliderLevel` | BRIGHTNESS | 0.3142 | claim_met | lumaMean swing 0.0668 ratio 2.58 (via absolute), monotonic 1 |
| TRUE | `24_chromatic_murmuration` | `sliderLocalSpeed` | SPEED | 0.3140 | claim_met | temporalRate 0.0040/0.0066/0.0107/0.0144/0.0166 (ratio 4.12, mono 1); temporalFreq ratio 5.96, mono 1 |
| TRUE | `30_bass_comet` | `sliderBass` | MAGNITUDE | 0.3132 | claim_met | dominant mover litFraction 0.3132 |
| TRUE | `118_grand_orbit_rings` | `sliderLevel` | BRIGHTNESS | 0.3131 | claim_met | lumaMean swing 0.0440 ratio 1.97 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/39_magnetic_sand` | `sliderPoleGap` | DARKNESS | 0.3126 | claim_met | lumaMean swing 0.0111 ratio 1.40 (via ratio), monotonic -1 (expected falling) |
| TRUE | `123_mirrored_broadside_call` | `sliderLevel` | BRIGHTNESS | 0.3103 | claim_met | lumaMean swing 0.0134 ratio 1.42 (via ratio), monotonic 1 |
| TRUE | `ambient_extra/48_organ_echoes` | `sliderLocalSpeed` | SPEED | 0.3096 | claim_met | temporalRate 0.0004/0.0006/0.0006/0.0007/0.0023 (ratio 5.39, mono 1); temporalFreq ratio 8.02, mono 1 |
| TRUE | `04_beat_folded_helix` | `sliderContrast` | CONTRAST | 0.3093 | claim_met | contrastRatio swing 0.3093 ratio 1.36 (via absolute) |
| TRUE | `20_parametric_sway_field` | `sliderLevel` | BRIGHTNESS | 0.3070 | claim_met | lumaMean swing 0.0562 ratio 4.08 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/44_healing_cracks` | `sliderOrganHeat` | MAGNITUDE | 0.3067 | claim_met | dominant mover contrastRatio 0.3067 |
| TRUE | `ambient_extra/48_organ_echoes` | `sliderEchoCount` | SPATIAL | 0.3063 | claim_met | spatialFreqZ swing 0.2908, monotonic 0 [non-monotonic] |
| TRUE | `baby/15_tease_velocity_weave` | `sliderStrandWidth` | SPATIAL | 0.3060 | claim_met | litFraction swing 0.2475, monotonic 1 |
| TRUE | `14_lunar_current` | `sliderLevel` | BRIGHTNESS | 0.3059 | claim_met | lumaMean swing 0.0467 ratio 3.33 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/31_dark_moonrise` | `sliderLevel` | BRIGHTNESS | 0.3056 | claim_met | lumaMean swing 0.0483 ratio 2.29 (via absolute), monotonic 1 |
| TRUE | `23_prismatic_strange_attractors` | `sliderUvGhost` | UV | 0.3052 | claim_met | uvMean swing 0.0480 ratio 48015.03 (via absolute, threshold 0.01) |
| TRUE | `ambient_extra/18_soft_steps` | `sliderEdgeGlow` | BRIGHTNESS | 0.3046 | claim_met | lumaMean swing 0.0272 ratio 1.38 (via absolute), monotonic 1 |
| TRUE | `summer_camp/85_redwood_starry_canopy` | `sliderStarEnergy` | MAGNITUDE | 0.3045 | claim_met | dominant mover rMean 0.3045 |
| TRUE | `ambient_extra/40_deep_window` | `sliderLevel` | BRIGHTNESS | 0.3044 | claim_met | lumaMean swing 0.0319 ratio 1.73 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/22_balance_beam` | `sliderLevel` | BRIGHTNESS | 0.3044 | claim_met | lumaMean swing 0.0545 ratio 3.11 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/36_off_center_sun` | `sliderSunSize` | SPATIAL | 0.3044 | claim_met | spatialFreqZ swing 0.3043, monotonic -1 |
| TRUE | `ambient_extra/21_pendulum_room` | `sliderSafetyFloor` | MAGNITUDE | 0.3013 | claim_met | dominant mover contrastRatio 0.3013 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderLocalSpeed` | SPEED | 0.2999 | claim_met | temporalRate 0.0025/0.0030/0.0042/0.0044/0.0076 (ratio 3.06, mono 1); temporalFreq ratio 2.87, mono 0 |
| TRUE | `ambient_extra/31_dark_moonrise` | `sliderSafetyFloor` | MAGNITUDE | 0.2989 | claim_met | dominant mover spatialFreqZ 0.2989 |
| TRUE | `32_caustic_shimmer` | `sliderDepth` | MAGNITUDE | 0.2972 | claim_met | dominant mover contrastRatio 0.2972 |
| TRUE | `11_bioluminescence` | `sliderLocalSpeed` | SPEED | 0.2972 | claim_met | temporalRate 0.0015/0.0025/0.0050/0.0098/0.0186 (ratio 12.19, mono 1); temporalFreq ratio 8.39, mono 1 |
| TRUE | `03_dual_axis_crush` | `sliderRadius` | SPATIAL | 0.2966 | claim_met | spatialFreqY swing 0.1011, monotonic -1 |
| TRUE | `25_heartbeat` | `sliderLevel` | BRIGHTNESS | 0.2960 | claim_met | lumaMean swing 0.0107 ratio 1.90 (via ratio), monotonic 1 |
| TRUE | `baby/26_boy_lighthouse_fans` | `sliderBeamWidth` | SPATIAL | 0.2956 | claim_met | edgeSharpnessY swing 0.0468, monotonic 1 |
| TRUE | `122_breathing_horizon` | `sliderHorizonWidth` | SPATIAL | 0.2948 | claim_met | spatialFreqZ swing 0.1818, monotonic -1 |
| TRUE | `ambient_extra/30_organ_bellows` | `sliderChamberCount` | SPATIAL | 0.2941 | claim_met | spatialFreqY swing 0.2941, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/85_redwood_starry_canopy` | `sliderBlackoutDepth` | DARKNESS | 0.2937 | claim_met | litFraction swing 0.0514 ratio 1.06 (via absolute), monotonic -1 (expected falling) |
| TRUE | `61_white_breathe` | `sliderDepth` | MAGNITUDE | 0.2934 | claim_met | dominant mover wMean 0.2934 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderLocalSpeed` | SPEED | 0.2930 | claim_met | temporalRate 0.0014/0.0029/0.0053/0.0100/0.0190 (ratio 13.47, mono 1); temporalFreq ratio 11.69, mono 1 |
| TRUE | `ambient_extra/03_pearl_chain` | `sliderPearlCount` | SPATIAL | 0.2924 | claim_met | edgeSharpnessZ swing 0.2925, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/31_dark_moonrise` | `sliderLocalSpeed` | SPEED | 0.2917 | claim_met | temporalRate 0.0000/0.0000/0.0001/0.0002/0.0002 (ratio 8.10, mono 1); temporalFreq ratio 1.34, mono 0 |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderBaselineFloor` | MAGNITUDE | 0.2902 | claim_met | dominant mover contrastRatio 0.2902 |
| TRUE | `37_chevron_chase` | `sliderLocalSpeed` | SPEED | 0.2898 | claim_met | temporalRate 0.0010/0.0019/0.0035/0.0065/0.0118 (ratio 11.59, mono 1); temporalFreq ratio 10.30, mono 1 |
| TRUE | `ambient_extra/38_shell_growth` | `sliderSafetyFloor` | MAGNITUDE | 0.2897 | claim_met | dominant mover contrastRatio 0.2897 |
| TRUE | `124_aurora_crown` | `sliderLevel` | BRIGHTNESS | 0.2896 | claim_met | lumaMean swing 0.0616 ratio 2.38 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/17_frost_branch` | `sliderBranchCount` | SPATIAL | 0.2889 | claim_met | spatialFreqY swing 0.2889, monotonic -1 |
| TRUE | `129_five_colour_stations` | `sliderRadius` | SPATIAL | 0.2877 | claim_met | litFraction swing 0.2069, monotonic 1 |
| TRUE | `baby/19_boy_horizon_tides` | `sliderLocalSpeed` | SPEED | 0.2875 | claim_met | temporalRate 0.0006/0.0014/0.0031/0.0068/0.0131 (ratio 20.79, mono 1); temporalFreq ratio 8.61, mono 1 |
| TRUE | `ambient_extra/29_warm_rivets` | `sliderSeamWidth` | SPATIAL | 0.2871 | claim_met | spatialFreqZ swing 0.2871, monotonic 0 [non-monotonic] |
| TRUE | `128_five_colour_prism` | `sliderRadius` | SPATIAL | 0.2871 | claim_met | litFraction swing 0.2410, monotonic 1 |
| TRUE | `baby/39_girl_ribbon_braid` | `sliderRibbonWidth` | SPATIAL | 0.2871 | claim_met | spatialFreqZ swing 0.1347, monotonic -1 |
| TRUE | `baby/34_girl_horizon_tides` | `sliderLocalSpeed` | SPEED | 0.2868 | claim_met | temporalRate 0.0006/0.0013/0.0029/0.0064/0.0123 (ratio 20.86, mono 1); temporalFreq ratio 8.58, mono 1 |
| TRUE | `baby/14_tease_spiral_race` | `sliderLocalSpeed` | SPEED | 0.2867 | claim_met | temporalRate 0.0036/0.0070/0.0136/0.0261/0.0465 (ratio 12.96, mono 1); temporalFreq ratio 12.91, mono 1 |
| TRUE | `01_cylon_sweep` | `sliderTrail` | TRAIL | 0.2864 | claim_met | spatialFreqX swing 0.0972 |
| TRUE | `baby/14_tease_spiral_race` | `sliderSpiralWidth` | SPATIAL | 0.2862 | claim_met | litFraction swing 0.1819, monotonic 1 |
| TRUE | `46_abyssal_fronds` | `sliderLocalSpeed` | SPEED | 0.2859 | claim_met | temporalRate 0.0003/0.0004/0.0007/0.0014/0.0032 (ratio 12.14, mono 1); temporalFreq ratio 4.67, mono 1 |
| TRUE | `summer_camp/65_dome_kick_shockwave` | `sliderVoidDepth` | DARKNESS | 0.2859 | claim_met | lumaMean swing 0.0095 ratio 5.31 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/83_shadow_canopy_eclipse` | `sliderLocalSpeed` | SPEED | 0.2850 | claim_met | temporalRate 0.0001/0.0004/0.0012/0.0039/0.0102 (ratio 79.30, mono 1); temporalFreq ratio 26.53, mono 1 |
| TRUE | `ambient_extra/07_keel_glow` | `sliderLevel` | BRIGHTNESS | 0.2849 | claim_met | lumaMean swing 0.0606 ratio 3.30 (via absolute), monotonic 1 |
| TRUE | `120_crossing_beacons` | `sliderBeamWidth` | SPATIAL | 0.2846 | claim_met | spatialFreqY swing 0.1274, monotonic 0 [non-monotonic] |
| TRUE | `24_chromatic_murmuration` | `sliderFlockFocus` | SPATIAL | 0.2844 | claim_met | litFraction swing 0.2844, monotonic -1 |
| TRUE | `119_bow_stern_tidal_push` | `sliderLevel` | BRIGHTNESS | 0.2824 | claim_met | lumaMean swing 0.0600 ratio 2.39 (via absolute), monotonic 1 |
| TRUE | `121_spiral_wake` | `sliderLevel` | BRIGHTNESS | 0.2814 | claim_met | lumaMean swing 0.0119 ratio 1.31 (via ratio), monotonic 1 |
| TRUE | `12_breathing` | `sliderLocalSpeed` | SPEED | 0.2808 | claim_met | temporalRate 0.0004/0.0004/0.0007/0.0016/0.0033 (ratio 9.15, mono 1); temporalFreq ratio 7.22, mono 1 |
| TRUE | `ambient_extra/01_harbor_glass` | `sliderSafetyFloor` | MAGNITUDE | 0.2806 | claim_met | dominant mover contrastRatio 0.2806 |
| TRUE | `ambient_extra/31_dark_moonrise` | `sliderMoonSize` | SPATIAL | 0.2796 | claim_met | spatialFreqY swing 0.2796, monotonic -1 |
| TRUE | `baby/13_tease_wave_collision` | `sliderLocalSpeed` | SPEED | 0.2794 | claim_met | temporalRate 0.0016/0.0051/0.0097/0.0194/0.0323 (ratio 19.65, mono 1); temporalFreq ratio 20.76, mono 1 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderUvTrail` | UV | 0.2784 | claim_met | uvMean swing 0.0868 ratio 86753.52 (via absolute, threshold 0.01) |
| TRUE | `65_uv_only` | `sliderLocalSpeed` | SPEED | 0.2782 | claim_met | temporalRate 0.0003/0.0006/0.0012/0.0023/0.0044 (ratio 14.26, mono 1); temporalFreq ratio 7.13, mono 1 |
| TRUE | `summer_camp/48_titanic_sos_beacon` | `sliderLocalSpeed` | SPEED | 0.2774 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0005/0.0009 (ratio 11.77, mono 1); temporalFreq ratio 12.16, mono 1 |
| TRUE | `01_cylon_sweep` | `sliderEyeWidth` | SPATIAL | 0.2772 | claim_met | spatialFreqX swing 0.0725, monotonic 1 |
| TRUE | `ambient_extra/03_pearl_chain` | `sliderPearlSize` | SPATIAL | 0.2767 | claim_met | spatialFreqX swing 0.2609, monotonic -1 |
| TRUE | `30_bass_comet` | `sliderHeadKick` | MAGNITUDE | 0.2764 | claim_met | dominant mover litFraction 0.2764 |
| TRUE | `ambient_extra/40_deep_window` | `sliderSafetyFloor` | MAGNITUDE | 0.2743 | claim_met | dominant mover contrastRatio 0.2743 |
| TRUE | `baby/49_tease_horizon_seesaw` | `sliderHorizonWidth` | SPATIAL | 0.2742 | claim_met | spatialFreqY swing 0.1329, monotonic 0 [non-monotonic] |
| TRUE | `119_bow_stern_tidal_push` | `sliderWaveWidth` | SPATIAL | 0.2736 | claim_met | spatialFreqY swing 0.2736, monotonic 1 |
| TRUE | `ambient_extra/36_off_center_sun` | `sliderLevel` | BRIGHTNESS | 0.2731 | claim_met | lumaMean swing 0.0581 ratio 2.40 (via absolute), monotonic 1 |
| TRUE | `30_bass_comet` | `sliderLocalSpeed` | SPEED | 0.2723 | claim_met | temporalRate 0.0025/0.0038/0.0061/0.0083/0.0076 (ratio 3.37, mono 0); temporalFreq ratio 5.33, mono 1 |
| TRUE | `63_white_chase` | `sliderDirection` | DIRECTION | 0.2717 | claim_met | launch driftX -0.0114/-0.0185/-0.0060/0.0033/0.0115 (ends -0.0114 → 0.0115, floor ±0.004); velocity-series correlation low↔high 0.039 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `64_temple_warm_white` | `sliderRadius` | SPATIAL | 0.2717 | claim_met | spatialFreqZ swing 0.2717, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/08_quiet_signal` | `sliderSafetyFloor` | MAGNITUDE | 0.2717 | claim_met | dominant mover rMean 0.2717 |
| TRUE | `ambient_extra/01_harbor_glass` | `sliderCellSize` | SPATIAL | 0.2705 | claim_met | spatialFreqZ swing 0.2705, monotonic -1 |
| TRUE | `65_uv_only` | `sliderRadius` | SPATIAL | 0.2693 | claim_met | spatialFreqY swing 0.2693, monotonic 1 |
| TRUE | `06_neon_elevator` | `sliderLevel` | BRIGHTNESS | 0.2678 | claim_met | lumaMean swing 0.0179 ratio 2.63 (via ratio), monotonic 1 |
| TRUE | `15_silk_prism_ribbons` | `sliderShimmer` | MAGNITUDE | 0.2676 | claim_met | dominant mover contrastRatio 0.2676 |
| TRUE | `baby/44_girl_diamond_quilt` | `sliderLocalSpeed` | SPEED | 0.2671 | claim_met | temporalRate 0.0041/0.0076/0.0134/0.0206/0.0303 (ratio 7.44, mono 1); temporalFreq ratio 10.83, mono 1 |
| TRUE | `127_grand_maelstrom` | `sliderDepth` | MAGNITUDE | 0.2669 | claim_met | dominant mover spatialFreqZ 0.2669 |
| TRUE | `19_swaying_lattice_ballet` | `sliderFloorLevel` | BRIGHTNESS | 0.2668 | claim_met | lumaMean swing 0.0096 ratio 1.34 (via ratio), monotonic 1 |
| TRUE | `baby/13_tease_wave_collision` | `sliderFrontWidth` | SPATIAL | 0.2667 | claim_met | litFraction swing 0.2667, monotonic 1 |
| TRUE | `summer_camp/85_redwood_starry_canopy` | `sliderLocalSpeed` | SPEED | 0.2667 | claim_met | temporalRate 0.0095/0.0122/0.0166/0.0225/0.0291 (ratio 3.05, mono 1); temporalFreq ratio 3.25, mono 1 |
| TRUE | `ambient_extra/14_slow_cells` | `sliderSafetyFloor` | MAGNITUDE | 0.2664 | claim_met | dominant mover rMean 0.2664 |
| TRUE | `baby/29_boy_diamond_quilt` | `sliderLocalSpeed` | SPEED | 0.2663 | claim_met | temporalRate 0.0043/0.0081/0.0142/0.0219/0.0321 (ratio 7.40, mono 1); temporalFreq ratio 10.80, mono 1 |
| TRUE | `07_shimmer` | `sliderJewelryWhite` | WHITE | 0.2657 | claim_met | wMean swing 0.0146 ratio 14646.44 (via absolute, threshold 0.01) |
| TRUE | `baby/36_girl_comet_lullaby` | `sliderTailLength` | TRAIL | 0.2645 | claim_met | spatialFreqX swing 0.0420 |
| TRUE | `ambient_extra/17_frost_branch` | `sliderSafetyFloor` | MAGNITUDE | 0.2638 | claim_met | dominant mover contrastRatio 0.2639 |
| TRUE | `35_sparkle_rain` | `sliderIntensity` | BRIGHTNESS | 0.2614 | claim_met | lumaMean swing 0.0072 ratio 1.49 (via ratio), monotonic 1 |
| TRUE | `ambient_extra/12_floating_frames` | `sliderSafetyFloor` | MAGNITUDE | 0.2609 | claim_met | dominant mover spatialFreqX 0.2609 |
| TRUE | `ambient_extra/47_side_by_side` | `sliderSafetyFloor` | MAGNITUDE | 0.2609 | claim_met | dominant mover spatialFreqY 0.2609 |
| TRUE | `ambient_extra/39_magnetic_sand` | `sliderFieldStrength` | MAGNITUDE | 0.2600 | claim_met | dominant mover contrastRatio 0.2600 |
| TRUE | `127_grand_maelstrom` | `sliderLevel` | BRIGHTNESS | 0.2594 | claim_met | lumaMean swing 0.0551 ratio 2.04 (via absolute), monotonic 1 |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderLocalSpeed` | SPEED | 0.2593 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0006/0.0013 (ratio 14.21, mono 1); temporalFreq ratio 9.12, mono 1 |
| TRUE | `ambient_extra/18_soft_steps` | `sliderLevel` | BRIGHTNESS | 0.2590 | claim_met | lumaMean swing 0.0551 ratio 2.15 (via absolute), monotonic 1 |
| TRUE | `baby/66_girl_keel_breath` | `sliderKeelWidth` | SPATIAL | 0.2588 | claim_met | spatialFreqZ swing 0.2264, monotonic 0 [non-monotonic] |
| TRUE | `baby/21_boy_comet_lullaby` | `sliderCometCount` | TRAIL | 0.2576 | claim_met | spatialFreqY swing 0.2575 |
| TRUE | `baby/36_girl_comet_lullaby` | `sliderCometCount` | TRAIL | 0.2572 | claim_met | spatialFreqY swing 0.2572 |
| TRUE | `43_golden_hour_pulse` | `sliderLocalSpeed` | SPEED | 0.2569 | claim_met | temporalRate 0.0002/0.0002/0.0003/0.0007/0.0015 (ratio 7.46, mono 1); temporalFreq ratio 3.18, mono 1 |
| TRUE | `35_sparkle_rain` | `sliderKick` | MAGNITUDE | 0.2557 | claim_met | dominant mover contrastRatio 0.2557 |
| TRUE | `summer_camp/45_engine_room_clockwork` | `sliderBlackoutDepth` | DARKNESS | 0.2554 | claim_met | lumaMean swing 0.0047 ratio 4684.54 (via ratio), monotonic -1 (expected falling) |
| TRUE | `ambient_extra/30_organ_bellows` | `sliderLocalSpeed` | SPEED | 0.2542 | claim_met | temporalRate 0.0000/0.0001/0.0002/0.0002/0.0004 (ratio 15.78, mono 1); temporalFreq ratio 1.71, mono 1 |
| TRUE | `baby/30_boy_celebration_burst` | `sliderBurstWidth` | SPATIAL | 0.2539 | claim_met | edgeSharpnessZ swing 0.0391, monotonic 1 |
| TRUE | `ambient_extra/15_woven_light` | `sliderSafetyFloor` | MAGNITUDE | 0.2538 | claim_met | dominant mover rMean 0.2538 |
| TRUE | `ambient_extra/07_keel_glow` | `sliderLift` | BRIGHTNESS | 0.2518 | claim_met | lumaMean swing 0.0231 ratio 1.42 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/36_off_center_sun` | `sliderSafetyFloor` | MAGNITUDE | 0.2508 | claim_met | dominant mover rMean 0.2508 |
| TRUE | `ambient_extra/47_side_by_side` | `sliderSideGlow` | BRIGHTNESS | 0.2500 | claim_met | lumaMean swing 0.0339 ratio 1.23 (via absolute), monotonic 1 |
| TRUE | `63_white_chase` | `sliderCount` | SPATIAL | 0.2497 | claim_met | spatialFreqZ swing 0.2497, monotonic 1 |
| TRUE | `21_pelagic_manta_rays` | `sliderRadius` | SPATIAL | 0.2494 | claim_met | litFraction swing 0.1868, monotonic 1 |
| TRUE | `52_silk_ribbons` | `sliderSoftness` | SPATIAL | 0.2482 | claim_met | litFraction swing 0.2377, monotonic -1 |
| TRUE | `summer_camp/80_tree_canopy_fracture` | `sliderBranchSharpness` | SPATIAL | 0.2482 | claim_met | spatialFreqZ swing 0.0245, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/11_paper_fold` | `sliderSafetyFloor` | MAGNITUDE | 0.2479 | claim_met | dominant mover rMean 0.2479 |
| TRUE | `baby/06_tease_bow_stern_comets` | `sliderTailLength` | TRAIL | 0.2477 | claim_met | spatialFreqZ swing 0.1190 |
| TRUE | `16_ghost_tide_uv` | `sliderLevel` | BRIGHTNESS | 0.2474 | claim_met | outputMean swing 0.0132 ratio 2.55 (via ratio), monotonic 1 |
| TRUE | `49_cylon_crush` | `sliderLocalSpeed` | SPEED | 0.2469 | claim_met | temporalRate 0.0047/0.0063/0.0083/0.0107/0.0129 (ratio 2.75, mono 1); temporalFreq ratio 3.86, mono 1 |
| TRUE | `20_parametric_sway_field` | `sliderDetail` | SPATIAL | 0.2458 | claim_met | litFraction swing 0.2458, monotonic -1 |
| TRUE | `118_grand_orbit_rings` | `sliderRingWidth` | SPATIAL | 0.2454 | claim_met | spatialFreqY swing 0.0776, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/27_rolling_shutters` | `sliderLocalSpeed` | SPEED | 0.2447 | claim_met | temporalRate 0.0001/0.0001/0.0000/0.0003/0.0007 (ratio 116.02, mono 0); temporalFreq ratio 1.53, mono 1 |
| TRUE | `ambient_extra/49_all_together` | `sliderSafetyFloor` | MAGNITUDE | 0.2443 | claim_met | dominant mover rMean 0.2443 |
| TRUE | `26_dom_dancers_chevron` | `sliderBall1Energy` | MAGNITUDE | 0.2443 | claim_met | dominant mover spatialFreqZ 0.2443 |
| TRUE | `44_biolume_swell` | `sliderBase` | MAGNITUDE | 0.2440 | claim_met | dominant mover litFraction 0.2440 |
| TRUE | `summer_camp/84_outpost_ember_overdrive` | `sliderLocalSpeed` | SPEED | 0.2428 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0007/0.0014 (ratio 13.25, mono 1); temporalFreq ratio 22.81, mono 1 |
| TRUE | `baby/16_boy_orbit_glow` | `sliderRingWidth` | SPATIAL | 0.2425 | claim_met | spatialFreqY swing 0.0540, monotonic -1 |
| TRUE | `ambient_extra/43_leaf_turn` | `sliderLeafCount` | SPATIAL | 0.2422 | claim_met | spatialFreqZ swing 0.2421, monotonic 0 [non-monotonic] |
| TRUE | `09_cyclone` | `sliderWhiteLevel` | WHITE | 0.2417 | claim_met | wMean swing 0.0273 ratio 27281.42 (via absolute, threshold 0.01) |
| TRUE | `ambient_extra/28_organ_chords` | `sliderSafetyFloor` | MAGNITUDE | 0.2414 | claim_met | dominant mover rMean 0.2414 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderUvIntensity` | UV | 0.2412 | claim_met | uvMean swing 0.1593 ratio 159342.74 (via absolute, threshold 0.01) |
| TRUE | `baby/24_boy_ribbon_braid` | `sliderLocalSpeed` | SPEED | 0.2409 | claim_met | temporalRate 0.0025/0.0051/0.0099/0.0186/0.0326 (ratio 12.98, mono 1); temporalFreq ratio 14.77, mono 1 |
| TRUE | `ambient_extra/38_shell_growth` | `sliderShellSize` | SPATIAL | 0.2407 | claim_met | litFraction swing 0.2407, monotonic 1 |
| TRUE | `baby/39_girl_ribbon_braid` | `sliderLocalSpeed` | SPEED | 0.2405 | claim_met | temporalRate 0.0024/0.0048/0.0093/0.0175/0.0308 (ratio 13.00, mono 1); temporalFreq ratio 14.75, mono 1 |
| TRUE | `baby/11_tease_prismatic_fans` | `sliderFanWidth` | SPATIAL | 0.2402 | claim_met | litFraction swing 0.0812, monotonic 1 |
| TRUE | `ambient_extra/29_warm_rivets` | `sliderHeat` | MAGNITUDE | 0.2397 | claim_met | dominant mover spatialFreqX 0.2397 |
| TRUE | `baby/10_tease_constellation_tides` | `sliderTideDepth` | MAGNITUDE | 0.2394 | claim_met | dominant mover contrastRatio 0.2394 |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderBlackoutDepth` | DARKNESS | 0.2375 | claim_met | litFraction swing 0.1406 ratio 1.18 (via absolute), monotonic -1 (expected falling) |
| TRUE | `09_cyclone` | `sliderKick` | MAGNITUDE | 0.2364 | claim_met | dominant mover contrastRatio 0.2364 |
| TRUE | `ambient_extra/30_organ_bellows` | `sliderOrganLevel` | BRIGHTNESS | 0.2362 | claim_met | lumaMean swing 0.0502 ratio 1.70 (via absolute), monotonic 1 |
| TRUE | `baby/27_boy_heartbeat_bloom` | `sliderBloomSharpness` | SPATIAL | 0.2361 | claim_met | edgeSharpnessZ swing 0.0460, monotonic -1 |
| TRUE | `baby/41_girl_lighthouse_fans` | `sliderBeamWidth` | SPATIAL | 0.2361 | claim_met | edgeSharpnessY swing 0.0442, monotonic 1 |
| TRUE | `summer_camp/80_tree_canopy_fracture` | `sliderFractureAmount` | MAGNITUDE | 0.2361 | claim_met | dominant mover contrastRatio 0.2361 |
| TRUE | `120_crossing_beacons` | `sliderLevel` | BRIGHTNESS | 0.2350 | claim_met | lumaMean swing 0.0500 ratio 1.99 (via absolute), monotonic 1 |
| TRUE | `130_spatial_paint` | `sliderRadius` | SPATIAL | 0.2349 | claim_met | edgeSharpnessY swing 0.1323, monotonic 1 |
| TRUE | `62_white_shimmer` | `sliderLocalSpeed` | SPEED | 0.2344 | claim_met | temporalRate 0.0054/0.0094/0.0172/0.0313/0.0523 (ratio 9.68, mono 1); temporalFreq ratio 9.54, mono 1 |
| TRUE | `ambient_extra/27_rolling_shutters` | `sliderEdgeGlow` | BRIGHTNESS | 0.2343 | claim_met | lumaMean swing 0.0497 ratio 1.34 (via absolute), monotonic 1 |
| TRUE | `baby/12_tease_kaleidoscope` | `sliderFoldCount` | SPATIAL | 0.2338 | claim_met | spatialFreqY swing 0.0851, monotonic 1 |
| TRUE | `44_biolume_swell` | `sliderUvGlow` | UV | 0.2335 | claim_met | uvMean swing 0.0540 ratio 54049.71 (via absolute, threshold 0.01) |
| TRUE | `60_white_wash` | `sliderRadius` | SPATIAL | 0.2331 | claim_met | spatialFreqZ swing 0.2331, monotonic 1 |
| TRUE | `62_white_shimmer` | `sliderWhiteLevel` | WHITE | 0.2329 | claim_met | wMean swing 0.1053 ratio 5.47 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/51_abyssal_searchlight` | `sliderBlackoutDepth` | DARKNESS | 0.2313 | claim_met | lumaMean swing 0.0031 ratio 200.05 (via ratio), monotonic -1 (expected falling) |
| TRUE | `57_ink_diffuse` | `sliderLocalSpeed` | SPEED | 0.2310 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0011/0.0024 (ratio 25.85, mono 1); temporalFreq ratio 3.31, mono 1 |
| TRUE | `summer_camp/53_shadow_eclipse` | `sliderLocalSpeed` | SPEED | 0.2309 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0001 (ratio 114.09, mono 1); temporalFreq ratio 115469.90, mono 1 |
| TRUE | `62_white_shimmer` | `sliderSharpness` | SPATIAL | 0.2308 | claim_met | litFraction swing 0.1916, monotonic -1 |
| TRUE | `12_breathing` | `sliderBreathShape` | MAGNITUDE | 0.2302 | claim_met | dominant mover litFraction 0.2302 |
| TRUE | `ambient_extra/04_five_lanterns` | `sliderBalance` | MAGNITUDE | 0.2293 | claim_met | dominant mover contrastRatio 0.2293 |
| TRUE | `125_eclipse_orbit` | `sliderEclipseSize` | SPATIAL | 0.2289 | claim_met | spatialFreqY swing 0.2289, monotonic 0 [non-monotonic] |
| TRUE | `65_uv_only` | `sliderSharpness` | SPATIAL | 0.2280 | claim_met | edgeSharpnessY swing 0.0442, monotonic -1 |
| TRUE | `61_white_breathe` | `sliderRadius` | SPATIAL | 0.2280 | claim_met | spatialFreqY swing 0.2280, monotonic 1 |
| TRUE | `baby/61_boy_crossing_beacons` | `sliderBeaconWidth` | SPATIAL | 0.2274 | claim_met | spatialFreqY swing 0.0556, monotonic -1 |
| TRUE | `ambient_extra/36_off_center_sun` | `sliderShadowDepth` | DARKNESS | 0.2271 | claim_met | lumaMean swing 0.0272 ratio 1.46 (via absolute), monotonic -1 (expected falling) |
| TRUE | `53_neon_elevator_hd` | `sliderSharp` | SPATIAL | 0.2264 | claim_met | litFraction swing 0.2264, monotonic -1 |
| TRUE | `128_five_colour_prism` | `sliderDirection` | DIRECTION | 0.2257 | claim_met | launch driftZ -0.0156/-0.0145/0.0019/0.0097/0.0135 (ends -0.0156 → 0.0135, floor ±0.004); velocity-series correlation low↔high 0.051 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `69_calibration_coordinate_rgb` | `sliderFloor` | MAGNITUDE | 0.2249 | claim_met | dominant mover satMean 0.2249 |
| TRUE | `ambient_extra/49_all_together` | `sliderLevel` | BRIGHTNESS | 0.2243 | claim_met | lumaMean swing 0.0477 ratio 2.18 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/29_warm_rivets` | `sliderPlateSize` | SPATIAL | 0.2234 | claim_met | spatialFreqZ swing 0.2234, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/26_drawbridge` | `sliderSafetyFloor` | MAGNITUDE | 0.2234 | claim_met | dominant mover rMean 0.2234 |
| TRUE | `ambient_extra/50_last_lantern` | `sliderSafetyFloor` | MAGNITUDE | 0.2231 | claim_met | dominant mover rMean 0.2231 |
| TRUE | `ambient_extra/37_single_thread` | `sliderThreadWidth` | SPATIAL | 0.2228 | claim_met | spatialFreqY swing 0.2228, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/28_organ_chords` | `sliderVoiceCount` | SPATIAL | 0.2222 | claim_met | spatialFreqY swing 0.2222, monotonic 0 [non-monotonic] |
| TRUE | `02_phase_cathedral` | `sliderSharpness` | SPATIAL | 0.2205 | claim_met | litFraction swing 0.2205, monotonic -1 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderBlackoutDepth` | DARKNESS | 0.2202 | claim_met | litFraction swing 0.0379 ratio 1.18 (via absolute), monotonic -1 (expected falling) |
| TRUE | `baby/34_girl_horizon_tides` | `sliderVerticalReach` | SPATIAL | 0.2195 | claim_met | spatialFreqY swing 0.2195, monotonic 1 |
| TRUE | `baby/19_boy_horizon_tides` | `sliderVerticalReach` | SPATIAL | 0.2192 | claim_met | spatialFreqY swing 0.2192, monotonic 1 |
| TRUE | `ambient_extra/34_soft_hourglass` | `sliderConeWidth` | SPATIAL | 0.2180 | claim_met | spatialFreqX swing 0.2180, monotonic 1 |
| TRUE | `124_aurora_crown` | `sliderArcWidth` | SPATIAL | 0.2180 | claim_met | spatialFreqZ swing 0.1205, monotonic 0 [non-monotonic] |
| TRUE | `127_grand_maelstrom` | `sliderArmWidth` | SPATIAL | 0.2180 | claim_met | spatialFreqY swing 0.1105, monotonic 0 [non-monotonic] |
| TRUE | `baby/25_boy_bubble_chorus` | `sliderCellDensity` | SPATIAL | 0.2177 | claim_met | spatialFreqY swing 0.2177, monotonic 1 |
| TRUE | `23_prismatic_strange_attractors` | `sliderRadius` | SPATIAL | 0.2173 | claim_met | spatialFreqY swing 0.0293, monotonic 0 [non-monotonic] |
| TRUE | `baby/40_girl_bubble_chorus` | `sliderCellDensity` | SPATIAL | 0.2171 | claim_met | spatialFreqY swing 0.2171, monotonic 1 |
| TRUE | `ambient_extra/12_floating_frames` | `sliderFrameWidth` | SPATIAL | 0.2168 | claim_met | spatialFreqZ swing 0.1570, monotonic 0 [non-monotonic] |
| TRUE | `baby/05_tease_diamond_echo` | `sliderFacetWidth` | SPATIAL | 0.2168 | claim_met | spatialFreqX swing 0.0707, monotonic -1 |
| TRUE | `15_silk_prism_ribbons` | `sliderRadius` | SPATIAL | 0.2168 | claim_met | spatialFreqY swing 0.2168, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/48_organ_echoes` | `sliderSafetyFloor` | MAGNITUDE | 0.2166 | claim_met | dominant mover rMean 0.2166 |
| TRUE | `ambient_extra/15_woven_light` | `sliderDirection` | DIRECTION | 0.2156 | claim_met | launch driftY -0.0006/-0.0004/0.0000/0.0004/0.0007 (ends -0.0006 → 0.0007, floor ±0.004); velocity-series correlation low↔high -0.785 (reversal at ≤ -0.3) [via anticorrelated_motion] |
| TRUE | `baby/63_boy_aurora_veil` | `sliderVeilWidth` | SPATIAL | 0.2141 | claim_met | spatialFreqY swing 0.0652, monotonic -1 |
| TRUE | `52_silk_ribbons` | `sliderLocalSpeed` | SPEED | 0.2138 | claim_met | temporalRate 0.0033/0.0036/0.0035/0.0036/0.0050 (ratio 1.54, mono 1); temporalFreq ratio 9.68, mono 0 |
| TRUE | `ambient_extra/24_bead_counter` | `sliderCarryFlash` | MAGNITUDE | 0.2138 | claim_met | dominant mover spatialFreqZ 0.2138 |
| TRUE | `ambient_extra/16_turning_tiles` | `sliderTileSize` | SPATIAL | 0.2132 | claim_met | spatialFreqZ swing 0.2132, monotonic 0 [non-monotonic] |
| TRUE | `baby/01_tease_orbit_question` | `sliderRingWidth` | SPATIAL | 0.2131 | claim_met | spatialFreqY swing 0.0353, monotonic -1 |
| TRUE | `summer_camp/71_tree_aurora` | `sliderWindShimmer` | MAGNITUDE | 0.2124 | claim_met | dominant mover temporalFreq 0.2124 |
| TRUE | `63_white_chase` | `sliderWhiteLevel` | WHITE | 0.2123 | claim_met | wMean swing 0.2123 ratio 6.04 (via absolute, threshold 0.01) |
| TRUE | `baby/04_tease_tidal_ribbons` | `sliderRibbonWidth` | SPATIAL | 0.2122 | claim_met | spatialFreqY swing 0.0845, monotonic -1 |
| TRUE | `ambient_extra/10_chart_lines` | `sliderSafetyFloor` | MAGNITUDE | 0.2119 | claim_met | dominant mover contrastRatio 0.2118 |
| TRUE | `ambient_extra/05_open_gate` | `sliderSafetyFloor` | MAGNITUDE | 0.2118 | claim_met | dominant mover rMean 0.2118 |
| TRUE | `62_white_shimmer` | `sliderRadius` | SPATIAL | 0.2114 | claim_met | spatialFreqZ swing 0.1908, monotonic 0 [non-monotonic] |
| TRUE | `baby/29_boy_diamond_quilt` | `sliderSeamWidth` | SPATIAL | 0.2110 | claim_met | edgeSharpnessX swing 0.0588, monotonic 1 |
| TRUE | `ambient_extra/42_seed_drift` | `sliderSafetyFloor` | MAGNITUDE | 0.2103 | claim_met | dominant mover rMean 0.2103 |
| TRUE | `baby/22_boy_constellation_flow` | `sliderStarSize` | SPATIAL | 0.2100 | claim_met | spatialFreqX swing 0.0402, monotonic 1 |
| TRUE | `party_dancers/01_dom_ball_dancers` | `sliderBackgroundLevel` | BRIGHTNESS | 0.2080 | claim_met | lumaMean swing 0.0247 ratio 1.34 (via absolute), monotonic 1 |
| TRUE | `baby/52_boy_bow_wave` | `sliderWaveDepth` | MAGNITUDE | 0.2077 | claim_met | dominant mover contrastRatio 0.2077 |
| TRUE | `58_lighthouse_solo` | `sliderWidth` | SPATIAL | 0.2076 | claim_met | spatialFreqZ swing 0.0664, monotonic -1 |
| TRUE | `ambient_extra/13_cut_diamond` | `sliderDiamondSize` | SPATIAL | 0.2074 | claim_met | spatialFreqY swing 0.2074, monotonic 0 [non-monotonic] |
| TRUE | `baby/46_tease_checkerboard_morph` | `sliderMorphDepth` | MAGNITUDE | 0.2074 | claim_met | dominant mover spatialFreqZ 0.2074 |
| TRUE | `baby/23_boy_moonlit_ripples` | `sliderRippleWidth` | SPATIAL | 0.2065 | claim_met | edgeSharpnessZ swing 0.0404, monotonic 1 |
| TRUE | `baby/22_boy_constellation_flow` | `sliderLocalSpeed` | SPEED | 0.2056 | claim_met | temporalRate 0.0007/0.0013/0.0022/0.0039/0.0063 (ratio 9.54, mono 1); temporalFreq ratio 14.37, mono 1 |
| TRUE | `12_breathing` | `sliderKick` | MAGNITUDE | 0.2055 | claim_met | dominant mover litFraction 0.2055 |
| TRUE | `baby/37_girl_constellation_flow` | `sliderLocalSpeed` | SPEED | 0.2054 | claim_met | temporalRate 0.0006/0.0012/0.0021/0.0037/0.0060 (ratio 9.57, mono 1); temporalFreq ratio 14.46, mono 1 |
| TRUE | `baby/19_boy_horizon_tides` | `sliderTideWidth` | SPATIAL | 0.2046 | claim_met | spatialFreqX swing 0.0380, monotonic 0 [non-monotonic] |
| TRUE | `36_orbital_pulse` | `sliderLocalSpeed` | SPEED | 0.2045 | claim_met | temporalRate 0.0009/0.0021/0.0038/0.0071/0.0135 (ratio 15.33, mono 1); temporalFreq ratio 18.47, mono 1 |
| TRUE | `ambient_extra/38_shell_growth` | `sliderLocalSpeed` | SPEED | 0.2041 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0006 (ratio 619.10, mono 1); temporalFreq ratio 1.00, mono -1 |
| TRUE | `37_chevron_chase` | `sliderCount` | SPATIAL | 0.2038 | claim_met | spatialFreqY swing 0.2038, monotonic 0 [non-monotonic] |
| TRUE | `test/test_params` | `sliderSpeed` | SPEED | 0.2038 | claim_met | temporalRate 0.0000/0.0005/0.0010/0.0015/0.0020 (ratio 2020.87, mono 1); temporalFreq ratio 6162.41, mono 1 |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderSweepWidth` | SPATIAL | 0.2036 | claim_met | litFraction swing 0.2036, monotonic 1 |
| TRUE | `baby/31_girl_orbit_glow` | `sliderRingWidth` | SPATIAL | 0.2035 | claim_met | spatialFreqY swing 0.0540, monotonic -1 |
| TRUE | `33_aurora_breath` | `sliderLevel` | BRIGHTNESS | 0.2031 | claim_met | lumaMean swing 0.0432 ratio 2.29 (via absolute), monotonic 1 |
| TRUE | `baby/59_boy_cathedral_ribs` | `sliderLocalSpeed` | SPEED | 0.2029 | claim_met | temporalRate 0.0000/0.0001/0.0003/0.0006/0.0012 (ratio 40.99, mono 1); temporalFreq ratio 8734.00, mono 1 |
| TRUE | `baby/74_girl_cathedral_ribs` | `sliderLocalSpeed` | SPEED | 0.2029 | claim_met | temporalRate 0.0000/0.0001/0.0003/0.0005/0.0011 (ratio 41.16, mono 1); temporalFreq ratio 8741.26, mono 1 |
| TRUE | `baby/09_tease_helix_exchange` | `sliderHelixWidth` | SPATIAL | 0.2025 | claim_met | edgeSharpnessX swing 0.0298, monotonic 1 |
| TRUE | `baby/10_tease_constellation_tides` | `sliderLocalSpeed` | SPEED | 0.2014 | claim_met | temporalRate 0.0002/0.0004/0.0007/0.0015/0.0030 (ratio 18.83, mono 1); temporalFreq ratio 4.52, mono 1 |
| TRUE | `63_white_chase` | `sliderLocalSpeed` | SPEED | 0.2011 | claim_met | temporalRate 0.0031/0.0066/0.0110/0.0191/0.0335 (ratio 10.78, mono 1); temporalFreq ratio 12.45, mono 1 |
| TRUE | `baby/20_boy_cradle_waves` | `sliderArcWidth` | SPATIAL | 0.2009 | claim_met | spatialFreqY swing 0.0402, monotonic 1 |
| TRUE | `ambient_extra/24_bead_counter` | `sliderLocalSpeed` | SPEED | 0.2008 | claim_met | temporalRate 0.0000/0.0001/0.0002/0.0003/0.0006 (ratio 19.92, mono 1); temporalFreq ratio 2.90, mono 0 |
| TRUE | `13_sparkle` | `sliderLevel` | BRIGHTNESS | 0.2005 | claim_met | lumaMean swing 0.0239 ratio 4.34 (via absolute), monotonic 1 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderBlackoutDepth` | DARKNESS | 0.2001 | claim_met | litFraction swing 0.1248 ratio 1.25 (via absolute), monotonic -1 (expected falling) |
| TRUE | `baby/76_girl_crossing_beacons` | `sliderBeaconWidth` | SPATIAL | 0.2000 | claim_met | spatialFreqY swing 0.0556, monotonic -1 |
| TRUE | `ambient_extra/02_brass_compass` | `sliderSafetyFloor` | MAGNITUDE | 0.1997 | claim_met | dominant mover litFraction 0.1997 |
| TRUE | `45_manta_drift` | `sliderSpan` | SPATIAL | 0.1996 | claim_met | spatialFreqZ swing 0.1996, monotonic 1 |
| TRUE | `ambient_extra/03_pearl_chain` | `sliderLinkGlow` | BRIGHTNESS | 0.1992 | claim_met | lumaMean swing 0.0218 ratio 1.52 (via absolute), monotonic 1 |
| TRUE | `121_spiral_wake` | `sliderSafetyFloor` | MAGNITUDE | 0.1988 | claim_met | dominant mover contrastRatio 0.1988 |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderRingRate` | SPEED | 0.1980 | claim_met | temporalRate 0.0002/0.0010/0.0017/0.0026/0.0033 (ratio 18.14, mono 1); temporalFreq ratio 11.02, mono 1 |
| TRUE | `09_cyclone` | `sliderRadius` | SPATIAL | 0.1975 | claim_met | litFraction swing 0.0543, monotonic -1 |
| TRUE | `ambient_extra/29_warm_rivets` | `sliderJewelryGlow` | BRIGHTNESS | 0.1969 | claim_met | lumaMean swing 0.0185 ratio 1.26 (via ratio), monotonic 1 |
| TRUE | `ambient_extra/11_paper_fold` | `sliderCreaseWidth` | SPATIAL | 0.1968 | claim_met | spatialFreqX swing 0.1099, monotonic 1 |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderSweepWidth` | SPATIAL | 0.1968 | claim_met | litFraction swing 0.1003, monotonic 1 |
| TRUE | `29_kick_shockwave` | `sliderRingWidth` | SPATIAL | 0.1966 | claim_met | spatialFreqZ swing 0.0326, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/27_rolling_shutters` | `sliderShutterCount` | SPATIAL | 0.1966 | claim_met | spatialFreqY swing 0.1966, monotonic 0 [non-monotonic] |
| TRUE | `baby/66_girl_keel_breath` | `sliderBreathDepth` | MAGNITUDE | 0.1956 | claim_met | dominant mover spatialFreqY 0.1957 |
| TRUE | `ambient_extra/26_drawbridge` | `sliderDeckWidth` | SPATIAL | 0.1951 | claim_met | spatialFreqY swing 0.1950, monotonic -1 |
| TRUE | `baby/63_boy_aurora_veil` | `sliderAuroraDepth` | MAGNITUDE | 0.1951 | claim_met | dominant mover spatialFreqY 0.1950 |
| TRUE | `baby/78_girl_aurora_veil` | `sliderAuroraDepth` | MAGNITUDE | 0.1951 | claim_met | dominant mover spatialFreqY 0.1950 |
| TRUE | `baby/45_girl_celebration_burst` | `sliderBurstWidth` | SPATIAL | 0.1950 | claim_met | spatialFreqX swing 0.0374, monotonic -1 |
| TRUE | `34_moire_interference` | `sliderLocalSpeed` | SPEED | 0.1948 | claim_met | temporalRate 0.0008/0.0015/0.0026/0.0047/0.0090 (ratio 11.38, mono 1); temporalFreq ratio 7.54, mono 1 |
| TRUE | `ambient_extra/45_moss_islands` | `sliderIslandCount` | SPATIAL | 0.1938 | claim_met | spatialFreqY swing 0.1938, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderSweepImpact` | MAGNITUDE | 0.1936 | claim_met | dominant mover rMean 0.1936 |
| TRUE | `13_sparkle` | `sliderStarCount` | SPATIAL | 0.1935 | claim_met | spatialFreqY swing 0.1935, monotonic 1 |
| TRUE | `05_orbital_attractor_field` | `sliderLocalSpeed` | SPEED | 0.1934 | claim_met | temporalRate 0.0005/0.0009/0.0018/0.0031/0.0058 (ratio 12.35, mono 1); temporalFreq ratio 11.28, mono 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderLatticeScale` | SPATIAL | 0.1932 | claim_met | spatialFreqX swing 0.1932, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/15_woven_light` | `sliderThreadWidth` | SPATIAL | 0.1932 | claim_met | spatialFreqY swing 0.1932, monotonic 1 |
| TRUE | `ambient_extra/29_warm_rivets` | `sliderSafetyFloor` | MAGNITUDE | 0.1932 | claim_met | dominant mover spatialFreqZ 0.1932 |
| TRUE | `baby/77_girl_gentle_maelstrom` | `sliderCurrentDepth` | MAGNITUDE | 0.1926 | claim_met | dominant mover spatialFreqZ 0.1926 |
| TRUE | `22_abyssal_sway_garden` | `sliderFrondDensity` | SPATIAL | 0.1920 | claim_met | spatialFreqY swing 0.1920, monotonic 0 [non-monotonic] |
| TRUE | `baby/51_boy_keel_breath` | `sliderBreathDepth` | MAGNITUDE | 0.1920 | claim_met | dominant mover spatialFreqY 0.1920 |
| TRUE | `summer_camp/74_lookout_gyro_vortex` | `sliderSweepImpact` | MAGNITUDE | 0.1920 | claim_met | dominant mover spatialFreqY 0.1920 |
| TRUE | `baby/50_tease_constellation_duet` | `sliderLocalSpeed` | SPEED | 0.1920 | claim_met | temporalRate 0.0005/0.0009/0.0018/0.0037/0.0074 (ratio 16.52, mono 1); temporalFreq ratio 10.15, mono 1 |
| TRUE | `baby/53_boy_stern_wake` | `sliderRippleDensity` | SPATIAL | 0.1914 | claim_met | spatialFreqZ swing 0.1914, monotonic 0 [non-monotonic] |
| TRUE | `baby/46_tease_checkerboard_morph` | `sliderLocalSpeed` | SPEED | 0.1914 | claim_met | temporalRate 0.0008/0.0017/0.0032/0.0061/0.0109 (ratio 12.87, mono 1); temporalFreq ratio 10.82, mono 1 |
| TRUE | `01_cylon_sweep` | `sliderLocalSpeed` | SPEED | 0.1909 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0005/0.0011 (ratio 10.52, mono 1); temporalFreq ratio 1.35, mono 1 |
| TRUE | `ambient_extra/41_jelly_bells` | `sliderBellSize` | SPATIAL | 0.1908 | claim_met | spatialFreqX swing 0.1908, monotonic 1 |
| TRUE | `23_prismatic_strange_attractors` | `sliderLocalSpeed` | SPEED | 0.1906 | claim_met | temporalRate 0.0014/0.0028/0.0032/0.0038/0.0044 (ratio 3.07, mono 1); temporalFreq ratio 2.09, mono 1 |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderLocalSpeed` | SPEED | 0.1905 | claim_met | temporalRate 0.0001/0.0001/0.0004/0.0011/0.0026 (ratio 35.58, mono 1); temporalFreq ratio 9.65, mono 1 |
| TRUE | `09_cyclone` | `sliderDensity` | SPATIAL | 0.1896 | claim_met | spatialFreqY swing 0.0676, monotonic -1 |
| TRUE | `04_beat_folded_helix` | `sliderKick` | MAGNITUDE | 0.1893 | claim_met | dominant mover edgeSharpnessX 0.1893 |
| TRUE | `summer_camp/56_stage_mirror_axis` | `sliderLocalSpeed` | SPEED | 0.1881 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0002 (ratio 45.88, mono 1); temporalFreq ratio 94067.22, mono 1 |
| TRUE | `baby/42_girl_heartbeat_bloom` | `sliderBloomSharpness` | SPATIAL | 0.1878 | claim_met | edgeSharpnessZ swing 0.0432, monotonic -1 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderVortexSpeed` | SPEED | 0.1877 | claim_met | temporalRate 0.0006/0.0033/0.0053/0.0078/0.0096 (ratio 14.96, mono 1); temporalFreq ratio 8.61, mono 1 |
| TRUE | `33_aurora_breath` | `sliderLocalSpeed` | SPEED | 0.1877 | claim_met | temporalRate 0.0007/0.0009/0.0022/0.0046/0.0093 (ratio 12.83, mono 1); temporalFreq ratio 5.41, mono 1 |
| TRUE | `baby/08_tease_moire_gates` | `sliderLocalSpeed` | SPEED | 0.1877 | claim_met | temporalRate 0.0016/0.0033/0.0066/0.0124/0.0229 (ratio 14.09, mono 1); temporalFreq ratio 12.01, mono 1 |
| TRUE | `ambient_extra/16_turning_tiles` | `sliderSafetyFloor` | MAGNITUDE | 0.1870 | claim_met | dominant mover rMean 0.1870 |
| TRUE | `ambient_extra/05_open_gate` | `sliderLocalSpeed` | SPEED | 0.1869 | claim_met | temporalRate 0.0000/0.0000/0.0001/0.0008/0.0014 (ratio 1378.14, mono 1); temporalFreq ratio 11317.09, mono 1 |
| TRUE | `123_mirrored_broadside_call` | `sliderWallWidth` | SPATIAL | 0.1867 | claim_met | spatialFreqY swing 0.1374, monotonic 1 |
| TRUE | `16_ghost_tide_uv` | `sliderKick` | MAGNITUDE | 0.1865 | claim_met | dominant mover contrastRatio 0.1866 |
| TRUE | `ambient_extra/10_chart_lines` | `sliderLineCount` | SPATIAL | 0.1860 | claim_met | spatialFreqY swing 0.1860, monotonic 0 [non-monotonic] |
| TRUE | `03_dual_axis_crush` | `sliderDirection` | DIRECTION | 0.1853 | claim_met | launch driftY -0.0191/-0.0191/0.0237/0.0237/0.0237 (ends -0.0191 → 0.0237, floor ±0.004); velocity-series correlation low↔high -0.263 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `10_chasers` | `sliderKick` | MAGNITUDE | 0.1848 | claim_met | dominant mover rMean 0.1848 |
| TRUE | `ambient_extra/05_open_gate` | `sliderLevel` | BRIGHTNESS | 0.1848 | claim_met | lumaMean swing 0.0197 ratio 1.47 (via ratio), monotonic 1 |
| TRUE | `ambient_extra/32_silent_meteor` | `sliderSafetyFloor` | MAGNITUDE | 0.1847 | claim_met | dominant mover rMean 0.1847 |
| TRUE | `ambient_extra/18_soft_steps` | `sliderStepCount` | SPATIAL | 0.1842 | claim_met | spatialFreqY swing 0.1842, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderRippleWidth` | SPATIAL | 0.1841 | claim_met | edgeSharpnessZ swing 0.0212, monotonic 1 |
| TRUE | `ambient_extra/27_rolling_shutters` | `sliderFeather` | SPATIAL | 0.1839 | claim_met | spatialFreqZ swing 0.1839, monotonic 0 [non-monotonic] |
| TRUE | `17_rolling_color_dunes` | `sliderRadius` | SPATIAL | 0.1837 | claim_met | spatialFreqX swing 0.0266, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/09_shadow_slats` | `sliderSafetyFloor` | MAGNITUDE | 0.1837 | claim_met | dominant mover contrastRatio 0.1837 |
| TRUE | `119_bow_stern_tidal_push` | `sliderLocalSpeed` | SPEED | 0.1836 | claim_met | temporalRate 0.0001/0.0003/0.0007/0.0015/0.0027 (ratio 33.28, mono 1); temporalFreq ratio 3.85, mono 1 |
| TRUE | `ambient_extra/08_quiet_signal` | `sliderSignLevel` | BRIGHTNESS | 0.1833 | claim_met | lumaMean swing 0.0175 ratio 1.27 (via ratio), monotonic 1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderAudioMid` | MAGNITUDE | 0.1830 | claim_met | dominant mover contrastRatio 0.1830 |
| TRUE | `64_temple_warm_white` | `sliderWhiteLevel` | WHITE | 0.1825 | claim_met | wMean swing 0.1825 ratio 58.85 (via absolute, threshold 0.01) |
| TRUE | `baby/68_girl_stern_wake` | `sliderRippleDensity` | SPATIAL | 0.1824 | claim_met | spatialFreqZ swing 0.1824, monotonic 0 [non-monotonic] |
| TRUE | `54_murmuration_storm` | `sliderLocalSpeed` | SPEED | 0.1823 | claim_met | temporalRate 0.0009/0.0013/0.0022/0.0042/0.0085 (ratio 9.75, mono 1); temporalFreq ratio 3.46, mono 1 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderAudioMid` | MAGNITUDE | 0.1819 | claim_met | dominant mover contrastRatio 0.1819 |
| TRUE | `ambient_extra/33_rope_constellation` | `sliderLinkWidth` | SPATIAL | 0.1818 | claim_met | spatialFreqY swing 0.1818, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderContrast` | CONTRAST | 0.1817 | claim_met | contrastRatio swing 0.1817 ratio 1.28 (via absolute) |
| TRUE | `06_neon_elevator` | `sliderRadius` | SPATIAL | 0.1815 | claim_met | litFraction swing 0.1147, monotonic 1 |
| TRUE | `ambient_extra/21_pendulum_room` | `sliderBobSize` | SPATIAL | 0.1815 | claim_met | spatialFreqY swing 0.1815, monotonic -1 |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderTrail` | TRAIL | 0.1800 | claim_met | litFraction swing 0.0772 |
| TRUE | `26_dom_dancers_chevron` | `sliderBall2Energy` | MAGNITUDE | 0.1799 | claim_met | dominant mover spatialFreqZ 0.1800 |
| TRUE | `18_deep_space_lattice` | `sliderLocalSpeed` | SPEED | 0.1787 | claim_met | temporalRate 0.0010/0.0019/0.0041/0.0077/0.0150 (ratio 15.46, mono 1); temporalFreq ratio 14.45, mono 1 |
| TRUE | `ambient_extra/07_keel_glow` | `sliderSafetyFloor` | MAGNITUDE | 0.1787 | claim_met | dominant mover contrastRatio 0.1787 |
| TRUE | `baby/44_girl_diamond_quilt` | `sliderSeamWidth` | SPATIAL | 0.1780 | claim_met | edgeSharpnessX swing 0.0555, monotonic 1 |
| TRUE | `baby/67_girl_bow_wave` | `sliderWaveDepth` | MAGNITUDE | 0.1779 | claim_met | dominant mover contrastRatio 0.1779 |
| TRUE | `baby/47_tease_twin_lantern_tides` | `sliderLanternFocus` | SPATIAL | 0.1775 | claim_met | spatialFreqZ swing 0.1775, monotonic 1 |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderLocalSpeed` | SPEED | 0.1768 | claim_met | temporalRate 0.0005/0.0013/0.0033/0.0086/0.0204 (ratio 38.68, mono 1); temporalFreq ratio 18.66, mono 1 |
| TRUE | `ambient_extra/05_open_gate` | `sliderEdgeWidth` | SPATIAL | 0.1766 | claim_met | spatialFreqZ swing 0.1766, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/35_turning_box` | `sliderEdgeWidth` | SPATIAL | 0.1764 | claim_met | spatialFreqZ swing 0.1395, monotonic -1 |
| TRUE | `126_cathedral_rib_wave` | `sliderSafetyFloor` | MAGNITUDE | 0.1759 | claim_met | dominant mover contrastRatio 0.1759 |
| TRUE | `ambient_extra/19_split_lens` | `sliderContrast` | CONTRAST | 0.1751 | claim_met | contrastRatio swing 0.1101 ratio 1.68 (via absolute) |
| TRUE | `baby/26_boy_lighthouse_fans` | `sliderFanCount` | SPATIAL | 0.1748 | claim_met | spatialFreqZ swing 0.1748, monotonic 1 |
| TRUE | `baby/41_girl_lighthouse_fans` | `sliderFanCount` | SPATIAL | 0.1748 | claim_met | spatialFreqZ swing 0.1748, monotonic 1 |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderAudioBass` | MAGNITUDE | 0.1747 | claim_met | dominant mover contrastRatio 0.1747 |
| TRUE | `04_beat_folded_helix` | `sliderDirection` | DIRECTION | 0.1746 | claim_met | launch driftX -0.0087/0.0011/0.0017/0.0197/0.0167 (ends -0.0087 → 0.0167, floor ±0.004); velocity-series correlation low↔high -0.225 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `transitions/trans_diagonal_wipe` | `sliderFeather` | SPATIAL | 0.1744 | claim_met | spatialFreqY swing 0.0516, monotonic -1 |
| TRUE | `baby/78_girl_aurora_veil` | `sliderVeilWidth` | SPATIAL | 0.1742 | claim_met | spatialFreqY swing 0.0595, monotonic -1 |
| TRUE | `ambient_extra/06_folded_flags` | `sliderPanelCount` | SPATIAL | 0.1739 | claim_met | spatialFreqY swing 0.1739, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/06_folded_flags` | `sliderEdgeGlow` | BRIGHTNESS | 0.1739 | claim_met | lumaMean swing 0.0270 ratio 1.22 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/38_shell_growth` | `sliderBandWidth` | SPATIAL | 0.1739 | claim_met | spatialFreqZ swing 0.1739, monotonic 1 |
| TRUE | `ambient_extra/38_shell_growth` | `sliderPearlGlow` | BRIGHTNESS | 0.1739 | claim_met | outputMean swing 0.0086 ratio 1.25 (via ratio), monotonic 1 |
| TRUE | `ambient_extra/43_leaf_turn` | `sliderLeafSize` | SPATIAL | 0.1739 | claim_met | spatialFreqX swing 0.1739, monotonic -1 |
| TRUE | `ambient_extra/43_leaf_turn` | `sliderVeinGlow` | BRIGHTNESS | 0.1739 | claim_met | lumaMean swing 0.0176 ratio 1.27 (via ratio), monotonic 1 |
| TRUE | `baby/62_boy_gentle_maelstrom` | `sliderCurrentDepth` | MAGNITUDE | 0.1739 | claim_met | dominant mover spatialFreqX 0.1739 |
| TRUE | `party_dancers/01_dom_ball_dancers` | `sliderIdentityLevel` | BRIGHTNESS | 0.1739 | claim_met | lumaMean swing 0.0211 ratio 1.31 (via absolute), monotonic 1 |
| TRUE | `127_grand_maelstrom` | `sliderPulse` | MAGNITUDE | 0.1738 | claim_met | dominant mover rMean 0.1738 |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderAudioBass` | MAGNITUDE | 0.1734 | claim_met | dominant mover litFraction 0.1734 |
| TRUE | `baby/26_boy_lighthouse_fans` | `sliderLocalSpeed` | SPEED | 0.1734 | claim_met | temporalRate 0.0022/0.0046/0.0080/0.0168/0.0308 (ratio 14.11, mono 1); temporalFreq ratio 14.97, mono 1 |
| TRUE | `baby/41_girl_lighthouse_fans` | `sliderLocalSpeed` | SPEED | 0.1731 | claim_met | temporalRate 0.0021/0.0043/0.0075/0.0158/0.0290 (ratio 14.14, mono 1); temporalFreq ratio 14.92, mono 1 |
| TRUE | `16_ghost_tide_uv` | `sliderLocalSpeed` | SPEED | 0.1728 | claim_met | temporalRate 0.0010/0.0016/0.0029/0.0052/0.0080 (ratio 8.10, mono 1); temporalFreq ratio 8.12, mono 1 |
| TRUE | `ambient_extra/37_single_thread` | `sliderLocalSpeed` | SPEED | 0.1721 | claim_met | temporalRate 0.0000/0.0000/0.0001/0.0002/0.0003 (ratio 31.52, mono 1); temporalFreq ratio 2.98, mono 1 |
| TRUE | `baby/54_boy_stack_halo` | `sliderLocalSpeed` | SPEED | 0.1714 | claim_met | temporalRate 0.0000/0.0001/0.0002/0.0002/0.0004 (ratio 16.14, mono 1); temporalFreq ratio 7867.13, mono 1 |
| TRUE | `ambient_extra/09_shadow_slats` | `sliderRimGlow` | BRIGHTNESS | 0.1713 | claim_met | lumaMean swing 0.0364 ratio 1.51 (via absolute), monotonic 1 |
| TRUE | `47_quasicrystal_dunes` | `sliderLocalSpeed` | SPEED | 0.1702 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0004/0.0008 (ratio 9.14, mono 1); temporalFreq ratio 1.76, mono 1 |
| TRUE | `summer_camp/83_shadow_canopy_eclipse` | `sliderWarpAmount` | MAGNITUDE | 0.1697 | claim_met | dominant mover spatialFreqY 0.1697 |
| TRUE | `18_deep_space_lattice` | `sliderLatticeScale` | SPATIAL | 0.1691 | claim_met | spatialFreqY swing 0.1691, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderLocalSpeed` | SPEED | 0.1686 | claim_met | temporalRate 0.0001/0.0001/0.0004/0.0008/0.0017 (ratio 32.51, mono 1); temporalFreq ratio 15.43, mono 1 |
| TRUE | `baby/48_tease_parallax_ribbons` | `sliderParallaxDepth` | MAGNITUDE | 0.1685 | claim_met | dominant mover spatialFreqY 0.1685 |
| TRUE | `65_uv_only` | `sliderKick` | MAGNITUDE | 0.1673 | claim_met | dominant mover uvMean 0.1673 |
| TRUE | `summer_camp/55_stardust_dome` | `sliderBlackoutDepth` | DARKNESS | 0.1673 | claim_met | lumaMean swing 0.0025 ratio 2502.09 (via ratio), monotonic -1 (expected falling) |
| TRUE | `03_dual_axis_crush` | `sliderBeamWidth` | SPATIAL | 0.1671 | claim_met | litFraction swing 0.1671, monotonic 1 |
| TRUE | `33_aurora_breath` | `sliderBreathRate` | SPEED | 0.1668 | claim_met | temporalRate 0.0019/0.0022/0.0022/0.0024/0.0028 (ratio 1.52, mono 1); temporalFreq ratio 1.16, mono 0 |
| TRUE | `02_phase_cathedral` | `sliderRadius` | SPATIAL | 0.1667 | claim_met | litFraction swing 0.1667, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/71_tree_aurora` | `sliderCabinWarmth` | WARMTH | 0.1661 | claim_met | aMean swing 0.0931 ratio 93051.83 (via absolute), hue 0.0000 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderEmberDepth` | MAGNITUDE | 0.1661 | claim_met | dominant mover spatialFreqZ 0.1661 |
| TRUE | `summer_camp/84_outpost_ember_overdrive` | `sliderUvIntensity` | UV | 0.1655 | claim_met | uvMean swing 0.0622 ratio 62209.67 (via absolute, threshold 0.01) |
| TRUE | `ambient_extra/18_soft_steps` | `sliderSafetyFloor` | MAGNITUDE | 0.1654 | claim_met | dominant mover rMean 0.1654 |
| TRUE | `07_shimmer` | `sliderLocalSpeed` | SPEED | 0.1649 | claim_met | temporalRate 0.0012/0.0021/0.0039/0.0078/0.0151 (ratio 13.00, mono 1); temporalFreq ratio 13.15, mono 1 |
| TRUE | `ambient_extra/19_split_lens` | `sliderDirection` | DIRECTION | 0.1649 | claim_met | launch driftZ 0.0022/0.0007/-0.0000/-0.0006/-0.0005 (ends 0.0022 → -0.0005, floor ±0.004); velocity-series correlation low↔high -0.443 (reversal at ≤ -0.3) [via anticorrelated_motion] |
| TRUE | `summer_camp/73_tree_shadow_breath` | `sliderLocalSpeed` | SPEED | 0.1649 | claim_met | temporalRate 0.0004/0.0005/0.0007/0.0010/0.0020 (ratio 5.00, mono 1); temporalFreq ratio 2.01, mono 0 |
| TRUE | `ambient_extra/02_brass_compass` | `sliderDirection` | DIRECTION | 0.1646 | claim_met | launch driftZ -0.0062/-0.0046/0.0000/0.0085/0.0078 (ends -0.0062 → 0.0078, floor ±0.004); velocity-series correlation low↔high 0.119 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `ambient_extra/07_keel_glow` | `sliderKeelWidth` | SPATIAL | 0.1646 | claim_met | spatialFreqY swing 0.1646, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/12_floating_frames` | `sliderFrameCount` | SPATIAL | 0.1646 | claim_met | spatialFreqZ swing 0.1646, monotonic 1 |
| TRUE | `baby/34_girl_horizon_tides` | `sliderTideWidth` | SPATIAL | 0.1645 | claim_met | spatialFreqZ swing 0.0417, monotonic 0 [non-monotonic] |
| TRUE | `15_silk_prism_ribbons` | `sliderRibbonCount` | SPATIAL | 0.1643 | claim_met | spatialFreqY swing 0.1643, monotonic 0 [non-monotonic] |
| TRUE | `35_sparkle_rain` | `sliderBase` | MAGNITUDE | 0.1643 | claim_met | dominant mover spatialFreqZ 0.1643 |
| TRUE | `ambient_extra/02_brass_compass` | `sliderNeedleWidth` | SPATIAL | 0.1643 | claim_met | spatialFreqZ swing 0.1643, monotonic -1 |
| TRUE | `ambient_extra/14_slow_cells` | `sliderLevel` | BRIGHTNESS | 0.1640 | claim_met | lumaMean swing 0.0349 ratio 1.56 (via absolute), monotonic 1 |
| TRUE | `baby/35_girl_cradle_waves` | `sliderCradleDepth` | MAGNITUDE | 0.1640 | claim_met | dominant mover spatialFreqY 0.1639 |
| TRUE | `ambient_extra/31_dark_moonrise` | `sliderCrescentWidth` | SPATIAL | 0.1636 | claim_met | spatialFreqZ swing 0.1636, monotonic 1 |
| TRUE | `ambient_extra/08_quiet_signal` | `sliderLocalSpeed` | SPEED | 0.1630 | claim_met | temporalRate 0.0005/0.0005/0.0006/0.0009/0.0021 (ratio 3.99, mono 1); temporalFreq ratio 6.68, mono 1 |
| TRUE | `ambient_extra/23_needle_gauge` | `sliderNeedleWidth` | SPATIAL | 0.1630 | claim_met | spatialFreqY swing 0.1630, monotonic 0 [non-monotonic] |
| TRUE | `baby/38_girl_moonlit_ripples` | `sliderRippleWidth` | SPATIAL | 0.1628 | claim_met | edgeSharpnessZ swing 0.0381, monotonic 1 |
| TRUE | `baby/20_boy_cradle_waves` | `sliderCradleDepth` | MAGNITUDE | 0.1627 | claim_met | dominant mover spatialFreqY 0.1627 |
| TRUE | `baby/69_girl_stack_halo` | `sliderLocalSpeed` | SPEED | 0.1627 | claim_met | temporalRate 0.0000/0.0001/0.0002/0.0002/0.0004 (ratio 17.00, mono 1); temporalFreq ratio 8182.46, mono 1 |
| TRUE | `20_parametric_sway_field` | `sliderLocalSpeed` | SPEED | 0.1624 | claim_met | temporalRate 0.0005/0.0008/0.0015/0.0022/0.0030 (ratio 6.57, mono 1); temporalFreq ratio 2.76, mono 0 |
| TRUE | `baby/30_boy_celebration_burst` | `sliderBurstReach` | SPATIAL | 0.1623 | claim_met | spatialFreqY swing 0.0359, monotonic 0 [non-monotonic] |
| TRUE | `baby/11_tease_prismatic_fans` | `sliderFanCount` | SPATIAL | 0.1618 | claim_met | spatialFreqZ swing 0.1618, monotonic 0 [non-monotonic] |
| TRUE | `baby/66_girl_keel_breath` | `sliderLocalSpeed` | SPEED | 0.1618 | claim_met | temporalRate 0.0000/0.0001/0.0001/0.0002/0.0005 (ratio 14.21, mono 1); temporalFreq ratio 5.84, mono 0 |
| TRUE | `ambient_extra/34_soft_hourglass` | `sliderLocalSpeed` | SPEED | 0.1612 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0002/0.0006 (ratio 8.23, mono 1); temporalFreq ratio 3.08, mono 1 |
| TRUE | `ambient_extra/49_all_together` | `sliderLocalSpeed` | SPEED | 0.1609 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0007/0.0010 (ratio 14.40, mono 1); temporalFreq ratio 2.05, mono 1 |
| TRUE | `baby/45_girl_celebration_burst` | `sliderBurstReach` | SPATIAL | 0.1603 | claim_met | spatialFreqY swing 0.0341, monotonic 0 [non-monotonic] |
| TRUE | `27_swipe` | `sliderTrail` | TRAIL | 0.1603 | claim_met | spatialFreqY swing 0.1126 |
| TRUE | `04_beat_folded_helix` | `sliderWhiteKick` | WHITE | 0.1597 | claim_met | wMean swing 0.0997 ratio 2.95 (via absolute, threshold 0.01) |
| TRUE | `party_dancers/01_dom_ball_dancers` | `sliderMinimumWidth` | SPATIAL | 0.1593 | claim_met | litFraction swing 0.1167, monotonic 1 |
| TRUE | `11_bioluminescence` | `sliderKick` | MAGNITUDE | 0.1592 | claim_met | dominant mover contrastRatio 0.1592 |
| TRUE | `11_bioluminescence` | `sliderRadius` | SPATIAL | 0.1591 | claim_met | spatialFreqY swing 0.0598, monotonic 0 [non-monotonic] |
| TRUE | `22_abyssal_sway_garden` | `sliderRadius` | SPATIAL | 0.1588 | claim_met | spatialFreqY swing 0.1588, monotonic 0 [non-monotonic] |
| TRUE | `42_phyllotaxis_spiral` | `sliderLocalSpeed` | SPEED | 0.1586 | claim_met | temporalRate 0.0001/0.0002/0.0004/0.0006/0.0008 (ratio 6.76, mono 1); temporalFreq ratio 2.04, mono 1 |
| TRUE | `ambient_extra/37_single_thread` | `sliderDirection` | DIRECTION | 0.1582 | claim_met | launch driftY 0.0123/0.0067/-0.0008/-0.0046/-0.0065 (ends 0.0123 → -0.0065, floor ±0.004); velocity-series correlation low↔high 0.142 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `baby/25_boy_bubble_chorus` | `sliderLocalSpeed` | SPEED | 0.1582 | claim_met | temporalRate 0.0004/0.0007/0.0013/0.0027/0.0053 (ratio 13.57, mono 1); temporalFreq ratio 7.57, mono 1 |
| TRUE | `00_golden_hour_wash` | `sliderJewelrySpeed` | SPEED | 0.1580 | claim_met | temporalRate 0.0003/0.0003/0.0004/0.0004/0.0007 (ratio 2.64, mono 1); temporalFreq ratio 1.16, mono 0 |
| TRUE | `08_ocean_liner` | `sliderLevel` | BRIGHTNESS | 0.1580 | claim_met | outputMean swing 0.0422 ratio 1.96 (via absolute), monotonic 1 |
| TRUE | `ambient_extra/18_soft_steps` | `sliderLocalSpeed` | SPEED | 0.1576 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0001 (ratio 21.64, mono 1); temporalFreq ratio 1.43, mono 1 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderCampfireHeat` | MAGNITUDE | 0.1576 | claim_met | dominant mover litFraction 0.1576 |
| TRUE | `ambient_extra/46_twin_seals` | `sliderSealSize` | SPATIAL | 0.1572 | claim_met | spatialFreqZ swing 0.0870, monotonic 1 |
| TRUE | `baby/48_tease_parallax_ribbons` | `sliderRibbonWidth` | SPATIAL | 0.1571 | claim_met | spatialFreqY swing 0.1008, monotonic -1 |
| TRUE | `ambient_extra/35_turning_box` | `sliderCornerGlow` | BRIGHTNESS | 0.1569 | claim_met | lumaMean swing 0.0334 ratio 1.64 (via absolute), monotonic 1 |
| TRUE | `baby/40_girl_bubble_chorus` | `sliderLocalSpeed` | SPEED | 0.1566 | claim_met | temporalRate 0.0004/0.0006/0.0013/0.0025/0.0050 (ratio 13.56, mono 1); temporalFreq ratio 7.63, mono 1 |
| TRUE | `baby/04_tease_tidal_ribbons` | `sliderLocalSpeed` | SPEED | 0.1564 | claim_met | temporalRate 0.0008/0.0015/0.0027/0.0050/0.0103 (ratio 12.80, mono 1); temporalFreq ratio 6.98, mono 1 |
| TRUE | `summer_camp/53_shadow_eclipse` | `sliderBlackoutDepth` | DARKNESS | 0.1564 | claim_met | lumaMean swing 0.0017 ratio 1094.26 (via ratio), monotonic -1 (expected falling) |
| TRUE | `baby/35_girl_cradle_waves` | `sliderArcWidth` | SPATIAL | 0.1563 | claim_met | spatialFreqY swing 0.0399, monotonic 1 |
| TRUE | `00_golden_hour_wash` | `sliderJewelryFlash` | MAGNITUDE | 0.1561 | claim_met | dominant mover edgeSharpnessZ 0.1561 |
| TRUE | `ambient_extra/46_twin_seals` | `sliderSignLevel` | BRIGHTNESS | 0.1560 | claim_met | lumaMean swing 0.0145 ratio 1.26 (via ratio), monotonic 1 |
| TRUE | `baby/17_boy_crossing_glow` | `sliderLocalSpeed` | SPEED | 0.1555 | claim_met | temporalRate 0.0011/0.0019/0.0039/0.0086/0.0154 (ratio 14.56, mono 1); temporalFreq ratio 12.47, mono 1 |
| TRUE | `126_cathedral_rib_wave` | `sliderRibWidth` | SPATIAL | 0.1552 | claim_met | spatialFreqZ swing 0.1552, monotonic 1 |
| TRUE | `ambient_extra/44_healing_cracks` | `sliderSeamWidth` | SPATIAL | 0.1549 | claim_met | spatialFreqY swing 0.1549, monotonic 0 [non-monotonic] |
| TRUE | `baby/38_girl_moonlit_ripples` | `sliderOriginOffset` | MAGNITUDE | 0.1549 | claim_met | dominant mover spatialFreqY 0.1549 |
| TRUE | `baby/32_girl_crossing_glow` | `sliderLocalSpeed` | SPEED | 0.1545 | claim_met | temporalRate 0.0010/0.0018/0.0037/0.0080/0.0143 (ratio 14.57, mono 1); temporalFreq ratio 12.38, mono 1 |
| TRUE | `summer_camp/46_dome_lockdown` | `sliderAmberMix` | WHITE | 0.1541 | claim_met | aMean swing 0.0184 ratio 2.35 (via absolute, threshold 0.01) |
| TRUE | `baby/23_boy_moonlit_ripples` | `sliderLocalSpeed` | SPEED | 0.1540 | claim_met | temporalRate 0.0017/0.0030/0.0048/0.0119/0.0232 (ratio 14.00, mono 1); temporalFreq ratio 7.99, mono 1 |
| TRUE | `baby/38_girl_moonlit_ripples` | `sliderLocalSpeed` | SPEED | 0.1538 | claim_met | temporalRate 0.0016/0.0028/0.0045/0.0113/0.0220 (ratio 13.96, mono 1); temporalFreq ratio 7.96, mono 1 |
| TRUE | `baby/23_boy_moonlit_ripples` | `sliderOriginOffset` | MAGNITUDE | 0.1537 | claim_met | dominant mover spatialFreqY 0.1537 |
| TRUE | `58_lighthouse_solo` | `sliderLocalSpeed` | SPEED | 0.1536 | claim_met | temporalRate 0.0011/0.0023/0.0029/0.0054/0.0088 (ratio 8.42, mono 1); temporalFreq ratio 5.92, mono 1 |
| TRUE | `baby/50_tease_constellation_duet` | `sliderDuetDepth` | MAGNITUDE | 0.1534 | claim_met | dominant mover spatialFreqY 0.1534 |
| TRUE | `ambient_extra/15_woven_light` | `sliderLocalSpeed` | SPEED | 0.1528 | claim_met | temporalRate 0.0000/0.0001/0.0001/0.0003/0.0005 (ratio 18.49, mono 1); temporalFreq ratio 15321.29, mono 1 |
| TRUE | `baby/06_tease_bow_stern_comets` | `sliderLocalSpeed` | SPEED | 0.1528 | claim_met | temporalRate 0.0005/0.0008/0.0017/0.0032/0.0060 (ratio 12.22, mono 1); temporalFreq ratio 10.27, mono 1 |
| TRUE | `ambient_extra/03_pearl_chain` | `sliderLocalSpeed` | SPEED | 0.1522 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0003 (ratio 21.75, mono 1); temporalFreq ratio 2.93, mono 0 |
| TRUE | `23_prismatic_strange_attractors` | `sliderChaos` | MAGNITUDE | 0.1516 | claim_met | dominant mover spatialFreqZ 0.1516 |
| TRUE | `ambient_extra/33_rope_constellation` | `sliderTwinkle` | MAGNITUDE | 0.1515 | claim_met | dominant mover contrastRatio 0.1514 |
| TRUE | `121_spiral_wake` | `sliderSpiralWidth` | SPATIAL | 0.1507 | claim_met | spatialFreqX swing 0.1507, monotonic 1 |
| TRUE | `64_temple_warm_white` | `sliderLevel` | BRIGHTNESS | 0.1504 | claim_met | outputMean swing 0.0868 ratio 4.18 (via absolute), monotonic 1 |
| TRUE | `31_strobe_lattice` | `sliderScale` | SPATIAL | 0.1504 | claim_met | spatialFreqX swing 0.1504, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderSweepImpact` | MAGNITUDE | 0.1499 | claim_met | dominant mover contrastRatio 0.1500 |
| TRUE | `ambient_extra/35_turning_box` | `sliderDirection` | DIRECTION | 0.1492 | claim_met | launch driftZ -0.0364/-0.0281/0.0020/0.0082/0.0118 (ends -0.0364 → 0.0118, floor ±0.004); velocity-series correlation low↔high 0.020 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `08_ocean_liner` | `sliderPortholeWhite` | WHITE | 0.1490 | claim_met | wMean swing 0.0562 ratio 56226.92 (via absolute, threshold 0.01) |
| TRUE | `13_sparkle` | `sliderUvStars` | UV | 0.1482 | claim_met | uvMean swing 0.0178 ratio 17799.02 (via absolute, threshold 0.01) |
| TRUE | `ambient_extra/06_folded_flags` | `sliderSafetyFloor` | MAGNITUDE | 0.1481 | claim_met | dominant mover contrastRatio 0.1481 |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderLocalSpeed` | SPEED | 0.1480 | claim_met | temporalRate 0.0001/0.0001/0.0003/0.0005/0.0011 (ratio 14.89, mono 1); temporalFreq ratio 4.78, mono 1 |
| TRUE | `41_reaction_diffusion` | `sliderLocalSpeed` | SPEED | 0.1479 | claim_met | temporalRate 0.0003/0.0004/0.0008/0.0013/0.0022 (ratio 8.46, mono 1); temporalFreq ratio 2.71, mono 1 |
| TRUE | `baby/55_boy_rail_cascade` | `sliderRailWidth` | SPATIAL | 0.1476 | claim_met | spatialFreqZ swing 0.1286, monotonic -1 |
| TRUE | `baby/70_girl_rail_cascade` | `sliderRailWidth` | SPATIAL | 0.1476 | claim_met | spatialFreqZ swing 0.1304, monotonic -1 |
| TRUE | `baby/51_boy_keel_breath` | `sliderLocalSpeed` | SPEED | 0.1473 | claim_met | temporalRate 0.0000/0.0001/0.0001/0.0003/0.0005 (ratio 14.05, mono 1); temporalFreq ratio 5.84, mono 0 |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderTrailLength` | TRAIL | 0.1468 | claim_met | litFraction swing 0.0628 |
| TRUE | `baby/07_tease_lattice_bloom` | `sliderLocalSpeed` | SPEED | 0.1468 | claim_met | temporalRate 0.0004/0.0007/0.0016/0.0031/0.0059 (ratio 13.64, mono 1); temporalFreq ratio 6.97, mono 1 |
| TRUE | `ambient_extra/02_brass_compass` | `sliderLocalSpeed` | SPEED | 0.1467 | claim_met | temporalRate 0.0000/0.0001/0.0003/0.0005/0.0009 (ratio 21.69, mono 1); temporalFreq ratio 2.71, mono 1 |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderTreeSpread` | SPATIAL | 0.1467 | claim_met | edgeSharpnessZ swing 0.0319, monotonic -1 |
| TRUE | `baby/60_boy_orbital_pearls` | `sliderPearlSize` | SPATIAL | 0.1462 | claim_met | spatialFreqX swing 0.0670, monotonic 1 |
| TRUE | `baby/37_girl_constellation_flow` | `sliderStarSize` | SPATIAL | 0.1457 | claim_met | spatialFreqX swing 0.0356, monotonic 1 |
| TRUE | `21_pelagic_manta_rays` | `sliderLocalSpeed` | SPEED | 0.1451 | claim_met | temporalRate 0.0002/0.0003/0.0004/0.0008/0.0013 (ratio 7.14, mono 1); temporalFreq ratio 1.76, mono 0 |
| TRUE | `15_silk_prism_ribbons` | `sliderLocalSpeed` | SPEED | 0.1446 | claim_met | temporalRate 0.0005/0.0010/0.0020/0.0039/0.0081 (ratio 15.54, mono 1); temporalFreq ratio 7.56, mono 1 |
| TRUE | `04_beat_folded_helix` | `sliderRadius` | SPATIAL | 0.1443 | claim_met | spatialFreqX swing 0.1443, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/10_chart_lines` | `sliderLineWidth` | SPATIAL | 0.1440 | claim_met | spatialFreqZ swing 0.1440, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderAudioBass` | MAGNITUDE | 0.1439 | claim_met | dominant mover contrastRatio 0.1439 |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderUvIntensity` | UV | 0.1438 | claim_met | uvMean swing 0.0806 ratio 80642.82 (via absolute, threshold 0.01) |
| TRUE | `summer_camp/80_tree_canopy_fracture` | `sliderLocalSpeed` | SPEED | 0.1431 | claim_met | temporalRate 0.0002/0.0004/0.0005/0.0007/0.0013 (ratio 8.88, mono 1); temporalFreq ratio 5.31, mono 1 |
| TRUE | `baby/02_tease_crossing_question` | `sliderLocalSpeed` | SPEED | 0.1426 | claim_met | temporalRate 0.0009/0.0016/0.0034/0.0074/0.0133 (ratio 14.55, mono 1); temporalFreq ratio 11.62, mono 1 |
| TRUE | `24_chromatic_murmuration` | `sliderLevel` | BRIGHTNESS | 0.1421 | claim_met | lumaMean swing 0.0196 ratio 2.23 (via ratio), monotonic 1 |
| TRUE | `07_shimmer` | `sliderKick` | MAGNITUDE | 0.1419 | claim_met | dominant mover spatialFreqZ 0.1419 |
| TRUE | `summer_camp/82_redwood_timber_fall` | `sliderDustGlow` | BRIGHTNESS | 0.1418 | claim_met | outputMean swing 0.0132 ratio 1.40 (via ratio), monotonic 1 |
| TRUE | `128_five_colour_prism` | `sliderLocalSpeed` | SPEED | 0.1413 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0004/0.0008 (ratio 9.85, mono 1); temporalFreq ratio 1.16, mono 1 |
| TRUE | `65_uv_only` | `sliderDirection` | DIRECTION | 0.1410 | claim_met | launch driftY 0.0052/0.0026/-0.0005/-0.0025/-0.0051 (ends 0.0052 → -0.0051, floor ±0.004); velocity-series correlation low↔high -0.008 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `ambient_extra/20_long_shadow` | `sliderDirection` | DIRECTION | 0.1410 | claim_met | launch driftZ -0.0001/-0.0002/-0.0000/-0.0001/-0.0004 (ends -0.0001 → -0.0004, floor ±0.004); velocity-series correlation low↔high -0.367 (reversal at ≤ -0.3) [via anticorrelated_motion] |
| TRUE | `124_aurora_crown` | `sliderSafetyFloor` | MAGNITUDE | 0.1408 | claim_met | dominant mover contrastRatio 0.1408 |
| TRUE | `120_crossing_beacons` | `sliderAfterglow` | TRAIL | 0.1401 | claim_met | spatialFreqY swing 0.0386 |
| TRUE | `00_golden_hour_wash` | `sliderEmberSwell` | MAGNITUDE | 0.1399 | claim_met | dominant mover rMean 0.1399 |
| TRUE | `24_chromatic_murmuration` | `sliderRadius` | SPATIAL | 0.1396 | claim_met | spatialFreqY swing 0.0589, monotonic -1 |
| TRUE | `ambient_extra/17_frost_branch` | `sliderLocalSpeed` | SPEED | 0.1395 | claim_met | temporalRate 0.0000/0.0001/0.0001/0.0000/0.0001 (ratio 1.86, mono 0); temporalFreq ratio 2.05, mono 1 |
| TRUE | `121_spiral_wake` | `sliderPulse` | MAGNITUDE | 0.1386 | claim_met | dominant mover contrastRatio 0.1386 |
| TRUE | `ambient_extra/01_harbor_glass` | `sliderBorderWidth` | SPATIAL | 0.1380 | claim_met | spatialFreqX swing 0.1304, monotonic 0 [non-monotonic] |
| TRUE | `18_deep_space_lattice` | `sliderDetail` | SPATIAL | 0.1379 | claim_met | litFraction swing 0.1379, monotonic 1 |
| TRUE | `120_crossing_beacons` | `sliderSafetyFloor` | MAGNITUDE | 0.1378 | claim_met | dominant mover contrastRatio 0.1378 |
| TRUE | `122_breathing_horizon` | `sliderSafetyFloor` | MAGNITUDE | 0.1374 | claim_met | dominant mover contrastRatio 0.1374 |
| TRUE | `baby/09_tease_helix_exchange` | `sliderLocalSpeed` | SPEED | 0.1371 | claim_met | temporalRate 0.0013/0.0030/0.0061/0.0121/0.0232 (ratio 17.95, mono 1); temporalFreq ratio 12.45, mono 1 |
| TRUE | `baby/18_boy_rose_glow` | `sliderLocalSpeed` | SPEED | 0.1369 | claim_met | temporalRate 0.0016/0.0032/0.0058/0.0111/0.0203 (ratio 12.45, mono 1); temporalFreq ratio 9.79, mono 1 |
| TRUE | `00_golden_hour_wash` | `sliderJewelryWhite` | WHITE | 0.1368 | claim_met | wMean swing 0.0402 ratio 40162.97 (via absolute, threshold 0.01) |
| TRUE | `baby/40_girl_bubble_chorus` | `sliderBubbleSize` | SPATIAL | 0.1368 | claim_met | spatialFreqX swing 0.1368, monotonic 1 |
| TRUE | `baby/33_girl_rose_glow` | `sliderLocalSpeed` | SPEED | 0.1366 | claim_met | temporalRate 0.0015/0.0030/0.0054/0.0104/0.0190 (ratio 12.46, mono 1); temporalFreq ratio 9.78, mono 1 |
| TRUE | `ambient_extra/07_keel_glow` | `sliderOrganGlow` | BRIGHTNESS | 0.1365 | claim_met | lumaMean swing 0.0165 ratio 1.29 (via ratio), monotonic 1 |
| TRUE | `summer_camp/79_mill_pressure_release` | `sliderPressure` | MAGNITUDE | 0.1364 | claim_met | dominant mover temporalFreq 0.1364 |
| TRUE | `58_lighthouse_solo` | `sliderFlash` | MAGNITUDE | 0.1363 | claim_met | dominant mover rMean 0.1363 |
| TRUE | `ambient_extra/21_pendulum_room` | `sliderPendulumCount` | SPATIAL | 0.1359 | claim_met | spatialFreqY swing 0.1359, monotonic 0 [non-monotonic] |
| TRUE | `16_ghost_tide_uv` | `sliderUvLevel` | UV | 0.1358 | claim_met | uvMean swing 0.0440 ratio 43996.65 (via absolute, threshold 0.01) |
| TRUE | `baby/64_boy_harbor_fireflies` | `sliderFireflySize` | SPATIAL | 0.1351 | claim_met | spatialFreqX swing 0.0429, monotonic -1 |
| TRUE | `baby/53_boy_stern_wake` | `sliderWakeSpread` | SPATIAL | 0.1350 | claim_met | spatialFreqZ swing 0.1350, monotonic 0 [non-monotonic] |
| TRUE | `01_cylon_sweep` | `sliderRadius` | SPATIAL | 0.1347 | claim_met | spatialFreqY swing 0.1347, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/11_paper_fold` | `sliderFacetDepth` | MAGNITUDE | 0.1347 | claim_met | dominant mover spatialFreqZ 0.1347 |
| TRUE | `ambient_extra/19_split_lens` | `sliderLocalSpeed` | SPEED | 0.1347 | claim_met | temporalRate 0.0003/0.0004/0.0007/0.0012/0.0019 (ratio 6.20, mono 1); temporalFreq ratio 2.82, mono 1 |
| TRUE | `baby/54_boy_stack_halo` | `sliderHaloDepth` | MAGNITUDE | 0.1347 | claim_met | dominant mover spatialFreqY 0.1347 |
| TRUE | `baby/58_boy_silhouette_tide` | `sliderTideWidth` | SPATIAL | 0.1342 | claim_met | spatialFreqZ swing 0.0746, monotonic -1 |
| TRUE | `baby/77_girl_gentle_maelstrom` | `sliderLocalSpeed` | SPEED | 0.1341 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0005/0.0010 (ratio 14.88, mono 1); temporalFreq ratio 5411.60, mono 1 |
| TRUE | `baby/62_boy_gentle_maelstrom` | `sliderLocalSpeed` | SPEED | 0.1338 | claim_met | temporalRate 0.0001/0.0001/0.0003/0.0005/0.0011 (ratio 14.95, mono 1); temporalFreq ratio 1.55, mono 1 |
| TRUE | `ambient_extra/46_twin_seals` | `sliderRingWidth` | SPATIAL | 0.1337 | claim_met | spatialFreqZ swing 0.0870, monotonic 1 |
| TRUE | `124_aurora_crown` | `sliderCrownHeight` | SPATIAL | 0.1331 | claim_met | spatialFreqZ swing 0.1332, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/52_iceberg_shear_line` | `sliderSubmergeDepth` | MAGNITUDE | 0.1328 | claim_met | dominant mover spatialFreqX 0.1329 |
| TRUE | `31_strobe_lattice` | `sliderLocalSpeed` | SPEED | 0.1327 | claim_met | temporalRate 0.0000/0.0000/0.0001/0.0002/0.0004 (ratio 16.42, mono 1); temporalFreq ratio 2.41, mono 1 |
| TRUE | `36_orbital_pulse` | `sliderReach` | SPATIAL | 0.1326 | claim_met | spatialFreqZ swing 0.1325, monotonic -1 |
| TRUE | `29_kick_shockwave` | `sliderDecay` | TRAIL | 0.1323 | claim_met | spatialFreqZ swing 0.1322 |
| TRUE | `61_white_breathe` | `sliderKick` | MAGNITUDE | 0.1317 | claim_met | dominant mover wMean 0.1317 |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderGearDrive` | MAGNITUDE | 0.1310 | claim_met | dominant mover spatialFreqZ 0.1310 |
| TRUE | `baby/18_boy_rose_glow` | `sliderPetalWidth` | SPATIAL | 0.1307 | claim_met | spatialFreqX swing 0.0803, monotonic -1 |
| TRUE | `119_bow_stern_tidal_push` | `sliderContrast` | CONTRAST | 0.1305 | claim_met | contrastRatio swing 0.0459 ratio 1.12 (via absolute) |
| TRUE | `120_crossing_beacons` | `sliderLocalSpeed` | SPEED | 0.1304 | claim_met | temporalRate 0.0010/0.0015/0.0028/0.0055/0.0108 (ratio 10.79, mono 1); temporalFreq ratio 9.03, mono 1 |
| TRUE | `summer_camp/54_boiler_fire_overdrive` | `sliderLocalSpeed` | SPEED | 0.1301 | claim_met | temporalRate 0.0000/0.0000/0.0001/0.0001/0.0002 (ratio 11.36, mono 1); temporalFreq ratio 11.79, mono 1 |
| TRUE | `baby/73_girl_silhouette_tide` | `sliderTideWidth` | SPATIAL | 0.1298 | claim_met | spatialFreqX swing 0.0842, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/14_slow_cells` | `sliderRuleMix` | MAGNITUDE | 0.1295 | claim_met | dominant mover spatialFreqZ 0.1295 |
| TRUE | `ambient_extra/20_long_shadow` | `sliderDepth` | MAGNITUDE | 0.1295 | claim_met | dominant mover rMean 0.1295 |
| TRUE | `31_strobe_lattice` | `sliderSharp` | SPATIAL | 0.1292 | claim_met | litFraction swing 0.1292, monotonic -1 |
| TRUE | `baby/56_boy_sign_lantern` | `sliderLanternDepth` | MAGNITUDE | 0.1291 | claim_met | dominant mover contrastRatio 0.1291 |
| TRUE | `baby/05_tease_diamond_echo` | `sliderLocalSpeed` | SPEED | 0.1290 | claim_met | temporalRate 0.0008/0.0016/0.0031/0.0063/0.0123 (ratio 15.51, mono 1); temporalFreq ratio 9.54, mono 1 |
| TRUE | `01_cylon_sweep` | `sliderKick` | MAGNITUDE | 0.1290 | claim_met | dominant mover rMean 0.1290 |
| TRUE | `baby/25_boy_bubble_chorus` | `sliderBubbleSize` | SPATIAL | 0.1289 | claim_met | spatialFreqX swing 0.1289, monotonic 1 |
| TRUE | `118_grand_orbit_rings` | `sliderSafetyFloor` | MAGNITUDE | 0.1284 | claim_met | dominant mover contrastRatio 0.1284 |
| TRUE | `11_bioluminescence` | `sliderDensity` | SPATIAL | 0.1284 | claim_met | spatialFreqX swing 0.1238, monotonic 1 |
| TRUE | `50_phase_cathedral_hd` | `sliderPhaseShift` | MAGNITUDE | 0.1283 | claim_met | dominant mover spatialFreqZ 0.1283 |
| TRUE | `39_tide_riser` | `sliderFoam` | MAGNITUDE | 0.1283 | claim_met | dominant mover litFraction 0.1283 |
| TRUE | `ambient_extra/18_soft_steps` | `sliderStepHeight` | SPATIAL | 0.1280 | claim_met | spatialFreqZ swing 0.1280, monotonic -1 |
| TRUE | `baby/68_girl_stern_wake` | `sliderWakeSpread` | SPATIAL | 0.1280 | claim_met | spatialFreqZ swing 0.1280, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/110_logsville_giant_pixel_chase` | `sliderBlackoutDepth` | DARKNESS | 0.1279 | claim_met | litFraction swing 0.1125 ratio 1.27 (via absolute), monotonic -1 (expected falling) |
| TRUE | `ambient_extra/14_slow_cells` | `sliderCellSize` | SPATIAL | 0.1277 | claim_met | spatialFreqZ swing 0.1277, monotonic 0 [non-monotonic] |
| TRUE | `party_dancers/01_dom_ball_dancers` | `sliderEnergyWidth` | SPATIAL | 0.1276 | claim_met | litFraction swing 0.1203, monotonic 1 |
| TRUE | `38_prism_helix` | `sliderLocalSpeed` | SPEED | 0.1271 | claim_met | temporalRate 0.0011/0.0017/0.0025/0.0041/0.0073 (ratio 6.64, mono 1); temporalFreq ratio 2.73, mono 0 |
| TRUE | `51_confetti_cyclone` | `sliderLocalSpeed` | SPEED | 0.1271 | claim_met | temporalRate 0.0016/0.0020/0.0030/0.0042/0.0068 (ratio 4.34, mono 1); temporalFreq ratio 4.94, mono 1 |
| TRUE | `baby/43_girl_waterfall_veil` | `sliderVeilWidth` | SPATIAL | 0.1265 | claim_met | spatialFreqX swing 0.0429, monotonic 1 |
| TRUE | `ambient_extra/11_paper_fold` | `sliderLocalSpeed` | SPEED | 0.1262 | claim_met | temporalRate 0.0002/0.0002/0.0003/0.0009/0.0018 (ratio 11.00, mono 1); temporalFreq ratio 4.60, mono 1 |
| TRUE | `ambient_extra/40_deep_window` | `sliderDepth` | MAGNITUDE | 0.1262 | claim_met | dominant mover spatialFreqX 0.1262 |
| TRUE | `baby/48_tease_parallax_ribbons` | `sliderLocalSpeed` | SPEED | 0.1262 | claim_met | temporalRate 0.0003/0.0005/0.0012/0.0023/0.0047 (ratio 17.29, mono 1); temporalFreq ratio 6.35, mono 1 |
| TRUE | `24_chromatic_murmuration` | `sliderDetail` | SPATIAL | 0.1260 | claim_met | spatialFreqY swing 0.0610, monotonic 0 [non-monotonic] |
| TRUE | `04_beat_folded_helix` | `sliderLocalSpeed` | SPEED | 0.1259 | claim_met | temporalRate 0.0007/0.0016/0.0030/0.0064/0.0125 (ratio 18.30, mono 1); temporalFreq ratio 8.62, mono 1 |
| TRUE | `ambient_extra/13_cut_diamond` | `sliderEdgeWidth` | SPATIAL | 0.1258 | claim_met | spatialFreqX swing 0.0565, monotonic 1 |
| TRUE | `baby/28_boy_waterfall_veil` | `sliderVeilWidth` | SPATIAL | 0.1257 | claim_met | spatialFreqX swing 0.0414, monotonic 1 |
| TRUE | `ambient_extra/20_long_shadow` | `sliderSafetyFloor` | MAGNITUDE | 0.1256 | claim_met | dominant mover spatialFreqY 0.1256 |
| TRUE | `ambient_extra/22_balance_beam` | `sliderSafetyFloor` | MAGNITUDE | 0.1256 | claim_met | dominant mover spatialFreqZ 0.1256 |
| TRUE | `baby/03_tease_rose_question` | `sliderPetalWidth` | SPATIAL | 0.1251 | claim_met | spatialFreqX swing 0.1193, monotonic -1 |
| TRUE | `ambient_extra/19_split_lens` | `sliderBandWidth` | SPATIAL | 0.1244 | claim_met | spatialFreqY swing 0.1244, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/40_deep_window` | `sliderDirection` | DIRECTION | 0.1244 | claim_met | launch driftZ 0.0132/0.0116/-0.0010/-0.0037/-0.0100 (ends 0.0132 → -0.0100, floor ±0.004); velocity-series correlation low↔high 0.101 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `ambient_extra/09_shadow_slats` | `sliderSlatCount` | SPATIAL | 0.1238 | claim_met | spatialFreqY swing 0.1238, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/40_deep_window` | `sliderWindowCount` | SPATIAL | 0.1238 | claim_met | spatialFreqY swing 0.1238, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/100_logsville_root_to_canopy_pulse` | `sliderBlackoutDepth` | DARKNESS | 0.1234 | claim_met | litFraction swing 0.1234 ratio 1.68 (via absolute), monotonic -1 (expected falling) |
| TRUE | `summer_camp/49_boiler_pressure_release` | `sliderLocalSpeed` | SPEED | 0.1234 | claim_met | temporalRate 0.0000/0.0001/0.0001/0.0002/0.0004 (ratio 39.05, mono 1); temporalFreq ratio 61708.56, mono 1 |
| TRUE | `ambient_extra/45_moss_islands` | `sliderLocalSpeed` | SPEED | 0.1232 | claim_met | temporalRate 0.0000/0.0000/0.0001/0.0002/0.0003 (ratio 25.28, mono 1); temporalFreq ratio 1.69, mono 0 |
| TRUE | `ambient_extra/50_last_lantern` | `sliderJewelryWhite` | WHITE | 0.1232 | claim_met | wMean swing 0.0089 ratio 8.95 (via ratio, threshold 0.01) |
| TRUE | `126_cathedral_rib_wave` | `sliderRibCount` | SPATIAL | 0.1229 | claim_met | spatialFreqZ swing 0.1229, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/24_bead_counter` | `sliderJewelryWhite` | WHITE | 0.1229 | claim_met | wMean swing 0.0085 ratio 8489.73 (via ratio, threshold 0.01) |
| TRUE | `baby/52_boy_bow_wave` | `sliderLocalSpeed` | SPEED | 0.1229 | claim_met | temporalRate 0.0002/0.0005/0.0010/0.0021/0.0038 (ratio 18.18, mono 1); temporalFreq ratio 5.22, mono 1 |
| TRUE | `ambient_extra/25_zipper_light` | `sliderSafetyFloor` | MAGNITUDE | 0.1228 | claim_met | dominant mover rMean 0.1228 |
| TRUE | `63_white_chase` | `sliderTailLength` | TRAIL | 0.1220 | claim_met | edgeSharpnessX swing 0.0567 |
| TRUE | `baby/65_boy_celebration_bloom` | `sliderPetalCount` | SPATIAL | 0.1217 | claim_met | spatialFreqZ swing 0.1217, monotonic 0 [non-monotonic] |
| TRUE | `119_bow_stern_tidal_push` | `sliderSafetyFloor` | MAGNITUDE | 0.1215 | claim_met | dominant mover contrastRatio 0.1215 |
| TRUE | `35_sparkle_rain` | `sliderDensity` | SPATIAL | 0.1211 | claim_met | spatialFreqY swing 0.1211, monotonic 1 |
| TRUE | `baby/18_boy_rose_glow` | `sliderSpatialDepth` | MAGNITUDE | 0.1208 | claim_met | dominant mover spatialFreqZ 0.1208 |
| TRUE | `18_deep_space_lattice` | `sliderKick` | MAGNITUDE | 0.1205 | claim_met | dominant mover rMean 0.1205 |
| TRUE | `baby/47_tease_twin_lantern_tides` | `sliderLocalSpeed` | SPEED | 0.1204 | claim_met | temporalRate 0.0002/0.0004/0.0009/0.0022/0.0040 (ratio 22.68, mono 1); temporalFreq ratio 7.97, mono 1 |
| TRUE | `baby/53_boy_stern_wake` | `sliderLocalSpeed` | SPEED | 0.1199 | claim_met | temporalRate 0.0002/0.0003/0.0006/0.0012/0.0025 (ratio 15.97, mono 1); temporalFreq ratio 5.58, mono 1 |
| TRUE | `ambient_extra/30_organ_bellows` | `sliderSafetyFloor` | MAGNITUDE | 0.1196 | claim_met | dominant mover spatialFreqY 0.1196 |
| TRUE | `63_white_chase` | `sliderWhiteKick` | WHITE | 0.1195 | claim_met | wMean swing 0.1195 ratio 1.94 (via absolute, threshold 0.01) |
| TRUE | `baby/33_girl_rose_glow` | `sliderSpatialDepth` | MAGNITUDE | 0.1187 | claim_met | dominant mover spatialFreqZ 0.1187 |
| TRUE | `baby/69_girl_stack_halo` | `sliderHaloDepth` | MAGNITUDE | 0.1184 | claim_met | dominant mover spatialFreqY 0.1184 |
| TRUE | `20_parametric_sway_field` | `sliderRadius` | SPATIAL | 0.1181 | claim_met | litFraction swing 0.1181, monotonic 0 [non-monotonic] |
| TRUE | `baby/80_girl_celebration_bloom` | `sliderPetalCount` | SPATIAL | 0.1181 | claim_met | spatialFreqZ swing 0.1181, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/12_floating_frames` | `sliderDepth` | MAGNITUDE | 0.1180 | claim_met | dominant mover rMean 0.1180 |
| TRUE | `121_spiral_wake` | `sliderWakeContrast` | CONTRAST | 0.1177 | claim_met | contrastRatio swing 0.0529 ratio 1.12 (via absolute) |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderLocalSpeed` | SPEED | 0.1177 | claim_met | temporalRate 0.0013/0.0016/0.0021/0.0032/0.0068 (ratio 5.11, mono 1); temporalFreq ratio 5.10, mono 1 |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderBlackoutDepth` | DARKNESS | 0.1176 | claim_met | litFraction swing 0.0272 ratio 1.25 (via absolute), monotonic -1 (expected falling) |
| TRUE | `ambient_extra/14_slow_cells` | `sliderLocalSpeed` | SPEED | 0.1174 | claim_met | temporalRate 0.0001/0.0003/0.0009/0.0017/0.0038 (ratio 45.92, mono 1); temporalFreq ratio 4.29, mono 1 |
| TRUE | `baby/20_boy_cradle_waves` | `sliderLocalSpeed` | SPEED | 0.1172 | claim_met | temporalRate 0.0010/0.0018/0.0035/0.0072/0.0144 (ratio 14.21, mono 1); temporalFreq ratio 8.78, mono 1 |
| TRUE | `baby/57_boy_hull_constellations` | `sliderLocalSpeed` | SPEED | 0.1169 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0007/0.0015 (ratio 12.41, mono 1); temporalFreq ratio 4.95, mono 1 |
| TRUE | `33_aurora_breath` | `sliderBreathDepth` | MAGNITUDE | 0.1168 | claim_met | dominant mover contrastRatio 0.1168 |
| TRUE | `41_reaction_diffusion` | `sliderSeed` | UNKNOWN_CLAIM | 0.1167 | responds_to_edges_not_to_level | held static the control does nothing, but pulsed 0↔1 at 40 frames it moves contrastRatio by 0.1166 — this is an edge-triggered control, meant to be driven by a modulation mapping rather than parked at a value |
| TRUE | `baby/33_girl_rose_glow` | `sliderPetalWidth` | SPATIAL | 0.1166 | claim_met | spatialFreqX swing 0.0794, monotonic -1 |
| TRUE | `baby/70_girl_rail_cascade` | `sliderLocalSpeed` | SPEED | 0.1163 | claim_met | temporalRate 0.0007/0.0014/0.0026/0.0049/0.0094 (ratio 13.81, mono 1); temporalFreq ratio 11.70, mono 1 |
| TRUE | `baby/55_boy_rail_cascade` | `sliderLocalSpeed` | SPEED | 0.1163 | claim_met | temporalRate 0.0007/0.0015/0.0028/0.0053/0.0100 (ratio 13.77, mono 1); temporalFreq ratio 11.71, mono 1 |
| TRUE | `ambient_extra/01_harbor_glass` | `sliderLocalSpeed` | SPEED | 0.1159 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0002 (ratio 24.49, mono 1); temporalFreq ratio 1.37, mono 1 |
| TRUE | `baby/03_tease_rose_question` | `sliderSpatialDepth` | MAGNITUDE | 0.1156 | claim_met | dominant mover spatialFreqZ 0.1156 |
| TRUE | `123_mirrored_broadside_call` | `sliderLocalSpeed` | SPEED | 0.1154 | claim_met | temporalRate 0.0008/0.0005/0.0024/0.0043/0.0078 (ratio 16.58, mono 1); temporalFreq ratio 7.51, mono 0 |
| TRUE | `summer_camp/70_forest_canopy_reveal` | `sliderBlackoutDepth` | DARKNESS | 0.1154 | claim_met | lumaMean swing 0.0034 ratio 1.28 (via ratio), monotonic -1 (expected falling) |
| TRUE | `32_caustic_shimmer` | `sliderShimmer` | MAGNITUDE | 0.1153 | claim_met | dominant mover spatialFreqX 0.1153 |
| TRUE | `baby/35_girl_cradle_waves` | `sliderLocalSpeed` | SPEED | 0.1152 | claim_met | temporalRate 0.0009/0.0017/0.0033/0.0067/0.0135 (ratio 14.23, mono 1); temporalFreq ratio 8.76, mono 1 |
| TRUE | `ambient_extra/35_turning_box` | `sliderLocalSpeed` | SPEED | 0.1147 | claim_met | temporalRate 0.0002/0.0004/0.0007/0.0011/0.0020 (ratio 11.48, mono 1); temporalFreq ratio 4.87, mono 1 |
| TRUE | `127_grand_maelstrom` | `sliderSafetyFloor` | MAGNITUDE | 0.1140 | claim_met | dominant mover contrastRatio 0.1140 |
| TRUE | `118_grand_orbit_rings` | `sliderOrbitTilt` | MAGNITUDE | 0.1135 | claim_met | dominant mover spatialFreqZ 0.1135 |
| TRUE | `13_sparkle` | `sliderJewelryWhite` | WHITE | 0.1135 | claim_met | wMean swing 0.0023 ratio 2339.00 (via ratio, threshold 0.01) |
| TRUE | `summer_camp/41_ghost_aurora` | `sliderBlackoutDepth` | DARKNESS | 0.1135 | claim_met | lumaMean swing 0.0047 ratio 118.19 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/74_lookout_gyro_vortex` | `sliderLocalSpeed` | SPEED | 0.1132 | claim_met | temporalRate 0.0003/0.0004/0.0009/0.0025/0.0063 (ratio 22.47, mono 1); temporalFreq ratio 12.04, mono 1 |
| TRUE | `122_breathing_horizon` | `sliderLocalSpeed` | SPEED | 0.1131 | claim_met | temporalRate 0.0003/0.0004/0.0007/0.0014/0.0030 (ratio 10.08, mono 1); temporalFreq ratio 4.99, mono 1 |
| TRUE | `45_manta_drift` | `sliderLocalSpeed` | SPEED | 0.1126 | claim_met | temporalRate 0.0002/0.0004/0.0006/0.0017/0.0028 (ratio 12.20, mono 1); temporalFreq ratio 4.76, mono 1 |
| TRUE | `122_breathing_horizon` | `sliderBreathDepth` | MAGNITUDE | 0.1126 | claim_met | dominant mover rMean 0.1126 |
| TRUE | `baby/46_tease_checkerboard_morph` | `sliderCellScale` | SPATIAL | 0.1120 | claim_met | spatialFreqZ swing 0.1120, monotonic 0 [non-monotonic] |
| TRUE | `123_mirrored_broadside_call` | `sliderSafetyFloor` | MAGNITUDE | 0.1119 | claim_met | dominant mover contrastRatio 0.1119 |
| TRUE | `ambient_extra/35_turning_box` | `sliderBoxSize` | SPATIAL | 0.1114 | claim_met | spatialFreqY swing 0.1114, monotonic 0 [non-monotonic] |
| TRUE | `22_abyssal_sway_garden` | `sliderDetail` | SPATIAL | 0.1112 | claim_met | litFraction swing 0.1112, monotonic 1 |
| TRUE | `16_ghost_tide_uv` | `sliderTideWidth` | SPATIAL | 0.1107 | claim_met | spatialFreqY swing 0.1014, monotonic -1 |
| TRUE | `ambient_extra/50_last_lantern` | `sliderLanternSize` | SPATIAL | 0.1105 | claim_met | spatialFreqZ swing 0.1105, monotonic 0 [non-monotonic] |
| TRUE | `baby/58_boy_silhouette_tide` | `sliderLocalSpeed` | SPEED | 0.1105 | claim_met | temporalRate 0.0003/0.0007/0.0014/0.0025/0.0051 (ratio 15.66, mono 1); temporalFreq ratio 6.94, mono 1 |
| TRUE | `124_aurora_crown` | `sliderPulse` | MAGNITUDE | 0.1103 | claim_met | dominant mover rMean 0.1103 |
| TRUE | `baby/64_boy_harbor_fireflies` | `sliderLocalSpeed` | SPEED | 0.1099 | claim_met | temporalRate 0.0012/0.0022/0.0035/0.0078/0.0157 (ratio 12.89, mono 1); temporalFreq ratio 10.24, mono 1 |
| TRUE | `ambient_extra/12_floating_frames` | `sliderLocalSpeed` | SPEED | 0.1099 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0003/0.0005 (ratio 10.00, mono 1); temporalFreq ratio 1.99, mono 1 |
| TRUE | `baby/79_girl_harbor_fireflies` | `sliderLocalSpeed` | SPEED | 0.1096 | claim_met | temporalRate 0.0011/0.0020/0.0033/0.0072/0.0146 (ratio 12.90, mono 1); temporalFreq ratio 10.20, mono 1 |
| TRUE | `22_abyssal_sway_garden` | `sliderTipGlow` | BRIGHTNESS | 0.1095 | claim_met | outputMean swing 0.0107 ratio 1.25 (via ratio), monotonic 1 |
| TRUE | `baby/39_girl_ribbon_braid` | `sliderBraidAmount` | MAGNITUDE | 0.1093 | claim_met | dominant mover spatialFreqZ 0.1093 |
| TRUE | `ambient_extra/44_healing_cracks` | `sliderLocalSpeed` | SPEED | 0.1093 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0000 (ratio 7.23, mono 0); temporalFreq ratio 1.55, mono 1 |
| TRUE | `baby/03_tease_rose_question` | `sliderLocalSpeed` | SPEED | 0.1092 | claim_met | temporalRate 0.0010/0.0017/0.0033/0.0063/0.0118 (ratio 11.97, mono 1); temporalFreq ratio 8.02, mono 1 |
| TRUE | `summer_camp/84_outpost_ember_overdrive` | `sliderEmberSpeed` | SPEED | 0.1090 | claim_met | temporalRate 0.0003/0.0003/0.0004/0.0004/0.0005 (ratio 2.00, mono 1); temporalFreq ratio 1.13, mono 1 |
| TRUE | `baby/73_girl_silhouette_tide` | `sliderLocalSpeed` | SPEED | 0.1087 | claim_met | temporalRate 0.0003/0.0006/0.0013/0.0023/0.0047 (ratio 15.71, mono 1); temporalFreq ratio 6.91, mono 1 |
| TRUE | `summer_camp/81_outpost_distress_beacon` | `sliderLocalSpeed` | SPEED | 0.1086 | claim_met | temporalRate 0.0001/0.0001/0.0001/0.0001/0.0003 (ratio 5.46, mono 1); temporalFreq ratio 1.87, mono 1 |
| TRUE | `ambient_extra/07_keel_glow` | `sliderTraceLength` | SPATIAL | 0.1084 | claim_met | spatialFreqZ swing 0.1084, monotonic -1 |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderBlackoutDepth` | DARKNESS | 0.1081 | claim_met | litFraction swing 0.0273 ratio 1.37 (via absolute), monotonic -1 (expected falling) |
| TRUE | `ambient_extra/23_needle_gauge` | `sliderTickGlow` | BRIGHTNESS | 0.1081 | claim_met | outputMean swing 0.0189 ratio 1.47 (via ratio), monotonic 1 |
| TRUE | `baby/01_tease_orbit_question` | `sliderLocalSpeed` | SPEED | 0.1079 | claim_met | temporalRate 0.0006/0.0012/0.0028/0.0051/0.0101 (ratio 16.80, mono 1); temporalFreq ratio 8.15, mono 1 |
| TRUE | `39_tide_riser` | `sliderLocalSpeed` | SPEED | 0.1074 | claim_met | temporalRate 0.0001/0.0003/0.0006/0.0012/0.0021 (ratio 14.92, mono 1); temporalFreq ratio 10.22, mono 1 |
| TRUE | `baby/24_boy_ribbon_braid` | `sliderBraidAmount` | MAGNITUDE | 0.1072 | claim_met | dominant mover spatialFreqZ 0.1072 |
| TRUE | `ambient_extra/23_needle_gauge` | `sliderLocalSpeed` | SPEED | 0.1065 | claim_met | temporalRate 0.0000/0.0001/0.0002/0.0003/0.0003 (ratio 6.28, mono 1); temporalFreq ratio 1.39, mono 0 |
| TRUE | `baby/75_girl_orbital_pearls` | `sliderPearlSize` | SPATIAL | 0.1060 | claim_met | spatialFreqX swing 0.0646, monotonic 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderLocalSpeed` | SPEED | 0.1060 | claim_met | temporalRate 0.0009/0.0017/0.0035/0.0070/0.0121 (ratio 13.73, mono 1); temporalFreq ratio 8.85, mono 1 |
| TRUE | `ambient_extra/20_long_shadow` | `sliderShadowWidth` | DARKNESS | 0.1056 | claim_met | lumaMean swing 0.0224 ratio 1.14 (via absolute), monotonic -1 (expected falling) |
| TRUE | `51_confetti_cyclone` | `sliderKick` | MAGNITUDE | 0.1055 | claim_met | dominant mover litFraction 0.1055 |
| TRUE | `120_crossing_beacons` | `sliderFlash` | MAGNITUDE | 0.1054 | claim_met | dominant mover rMean 0.1054 |
| TRUE | `baby/65_boy_celebration_bloom` | `sliderLocalSpeed` | SPEED | 0.1054 | claim_met | temporalRate 0.0003/0.0007/0.0014/0.0028/0.0055 (ratio 16.30, mono 1); temporalFreq ratio 5.12, mono 1 |
| TRUE | `baby/80_girl_celebration_bloom` | `sliderLocalSpeed` | SPEED | 0.1054 | claim_met | temporalRate 0.0003/0.0006/0.0013/0.0026/0.0051 (ratio 16.28, mono 1); temporalFreq ratio 5.15, mono 1 |
| TRUE | `46_abyssal_fronds` | `sliderBreathDepth` | MAGNITUDE | 0.1051 | claim_met | dominant mover spatialFreqX 0.1051 |
| TRUE | `summer_camp/51_abyssal_searchlight` | `sliderLocalSpeed` | SPEED | 0.1049 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0002 (ratio 20.72, mono 1); temporalFreq ratio 16.00, mono 1 |
| TRUE | `14_lunar_current` | `sliderLocalSpeed` | SPEED | 0.1045 | claim_met | temporalRate 0.0003/0.0007/0.0015/0.0031/0.0059 (ratio 18.48, mono 1); temporalFreq ratio 7.13, mono 1 |
| TRUE | `ambient_extra/25_zipper_light` | `sliderToothCount` | SPATIAL | 0.1042 | claim_met | spatialFreqY swing 0.1042, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/42_seed_drift` | `sliderLocalSpeed` | SPEED | 0.1042 | claim_met | temporalRate 0.0001/0.0001/0.0003/0.0006/0.0012 (ratio 13.98, mono 1); temporalFreq ratio 3.76, mono 1 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderFlickerSpeed` | SPEED | 0.1033 | claim_met | temporalRate 0.0057/0.0070/0.0087/0.0117/0.0197 (ratio 3.45, mono 1); temporalFreq ratio 4.16, mono 1 |
| TRUE | `09_cyclone` | `sliderWhiteKick` | WHITE | 0.1030 | claim_met | wMean swing 0.0119 ratio 2.61 (via absolute, threshold 0.01) |
| TRUE | `60_white_wash` | `sliderLocalSpeed` | SPEED | 0.1030 | claim_met | temporalRate 0.0014/0.0028/0.0048/0.0086/0.0164 (ratio 11.57, mono 1); temporalFreq ratio 7.73, mono 1 |
| TRUE | `baby/65_boy_celebration_bloom` | `sliderBloomDepth` | MAGNITUDE | 0.1030 | claim_met | dominant mover spatialFreqY 0.1030 |
| TRUE | `ambient_extra/05_open_gate` | `sliderDepth` | MAGNITUDE | 0.1027 | claim_met | dominant mover spatialFreqZ 0.1027 |
| TRUE | `baby/76_girl_crossing_beacons` | `sliderLocalSpeed` | SPEED | 0.1027 | claim_met | temporalRate 0.0006/0.0012/0.0022/0.0044/0.0087 (ratio 14.84, mono 1); temporalFreq ratio 7.36, mono 1 |
| TRUE | `43_golden_hour_pulse` | `sliderBlinder` | MAGNITUDE | 0.1024 | responds_to_edges_not_to_level | held static the control does nothing, but pulsed 0↔1 at 40 frames it moves contrastRatio by 0.1024 — this is an edge-triggered control, meant to be driven by a modulation mapping rather than parked at a value |
| TRUE | `transitions/trans_wipe_right` | `sliderFeather` | SPATIAL | 0.1024 | claim_met | spatialFreqZ swing 0.1024, monotonic -1 |
| TRUE | `29_kick_shockwave` | `sliderLocalSpeed` | SPEED | 0.1022 | claim_met | temporalRate 0.0022/0.0044/0.0044/0.0066/0.0067 (ratio 3.07, mono 1); temporalFreq ratio 2.68, mono 1 |
| TRUE | `summer_camp/78_woodland_trident_sweep` | `sliderProngSpread` | SPATIAL | 0.1016 | claim_met | litFraction swing 0.1016, monotonic 0 [non-monotonic] |
| TRUE | `08_ocean_liner` | `sliderLocalSpeed` | SPEED | 0.1014 | claim_met | temporalRate 0.0003/0.0006/0.0012/0.0024/0.0049 (ratio 14.19, mono 1); temporalFreq ratio 8.93, mono 1 |
| TRUE | `13_sparkle` | `sliderLocalSpeed` | SPEED | 0.1011 | claim_met | temporalRate 0.0002/0.0004/0.0007/0.0011/0.0018 (ratio 8.35, mono 1); temporalFreq ratio 8.24, mono 1 |
| TRUE | `64_temple_warm_white` | `sliderLocalSpeed` | SPEED | 0.1010 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0003/0.0005 (ratio 7.44, mono 1); temporalFreq ratio 4232.23, mono 0 |
| TRUE | `baby/61_boy_crossing_beacons` | `sliderLocalSpeed` | SPEED | 0.1008 | claim_met | temporalRate 0.0006/0.0013/0.0024/0.0048/0.0094 (ratio 14.86, mono 1); temporalFreq ratio 7.36, mono 1 |
| TRUE | `summer_camp/79_mill_pressure_release` | `sliderBoilerHeat` | MAGNITUDE | 0.1008 | claim_met | dominant mover spatialFreqZ 0.1008 |
| TRUE | `baby/17_boy_crossing_glow` | `sliderCrossingOffset` | MAGNITUDE | 0.1005 | claim_met | dominant mover spatialFreqY 0.1005 |
| TRUE | `baby/80_girl_celebration_bloom` | `sliderBloomDepth` | MAGNITUDE | 0.1005 | claim_met | dominant mover spatialFreqY 0.1005 |
| TRUE | `125_eclipse_orbit` | `sliderLocalSpeed` | SPEED | 0.1002 | claim_met | temporalRate 0.0001/0.0003/0.0006/0.0011/0.0023 (ratio 30.06, mono 1); temporalFreq ratio 3.92, mono 1 |
| TRUE | `summer_camp/117_tower_molten_elevator` | `sliderDripTrail` | TRAIL | 0.1000 | claim_met | spatialFreqZ swing 0.0571 |
| TRUE | `74_calibration_bpm_ruler` | `sliderPhaseOffset` | MAGNITUDE | 0.1000 | claim_met | dominant mover driftX 0.1000 |
| TRUE | `baby/28_boy_waterfall_veil` | `sliderCascadeDensity` | SPATIAL | 0.0997 | claim_met | spatialFreqZ swing 0.0806, monotonic 0 [non-monotonic] |
| TRUE | `00_golden_hour_wash` | `sliderGrain` | SPATIAL | 0.0996 | claim_met | spatialFreqY swing 0.0996, monotonic 0 [non-monotonic] |
| TRUE | `13_sparkle` | `sliderAfterglow` | TRAIL | 0.0996 | claim_met | spatialFreqY swing 0.0996 |
| TRUE | `ambient_extra/41_jelly_bells` | `sliderBellCount` | SPATIAL | 0.0996 | claim_met | spatialFreqX swing 0.0996, monotonic 1 |
| TRUE | `baby/67_girl_bow_wave` | `sliderLocalSpeed` | SPEED | 0.0996 | claim_met | temporalRate 0.0002/0.0005/0.0009/0.0020/0.0035 (ratio 18.11, mono 1); temporalFreq ratio 5.16, mono 1 |
| TRUE | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderBlackoutDepth` | DARKNESS | 0.0996 | claim_met | lumaMean swing 0.0039 ratio 8.48 (via ratio), monotonic -1 (expected falling) |
| TRUE | `baby/79_girl_harbor_fireflies` | `sliderFireflySize` | SPATIAL | 0.0995 | claim_met | spatialFreqX swing 0.0450, monotonic -1 |
| TRUE | `26_dom_dancers_chevron` | `sliderBaseGlow` | BRIGHTNESS | 0.0994 | claim_met | lumaMean swing 0.0211 ratio 1.07 (via absolute), monotonic 1 |
| TRUE | `07_shimmer` | `sliderDetail` | SPATIAL | 0.0993 | claim_met | spatialFreqZ swing 0.0993, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/42_seed_drift` | `sliderSeedCount` | SPATIAL | 0.0993 | claim_met | spatialFreqY swing 0.0993, monotonic 1 |
| TRUE | `baby/16_boy_orbit_glow` | `sliderLocalSpeed` | SPEED | 0.0993 | claim_met | temporalRate 0.0007/0.0014/0.0032/0.0059/0.0115 (ratio 16.70, mono 1); temporalFreq ratio 8.19, mono 1 |
| TRUE | `baby/32_girl_crossing_glow` | `sliderCrossingOffset` | MAGNITUDE | 0.0993 | claim_met | dominant mover spatialFreqY 0.0993 |
| TRUE | `baby/61_boy_crossing_beacons` | `sliderCrossingDepth` | MAGNITUDE | 0.0992 | claim_met | dominant mover bMean 0.0992 |
| TRUE | `baby/76_girl_crossing_beacons` | `sliderCrossingDepth` | MAGNITUDE | 0.0992 | claim_met | dominant mover rMean 0.0992 |
| TRUE | `42_phyllotaxis_spiral` | `sliderTwinkle` | MAGNITUDE | 0.0991 | claim_met | dominant mover contrastRatio 0.0991 |
| TRUE | `ambient_extra/10_chart_lines` | `sliderLocalSpeed` | SPEED | 0.0990 | claim_met | temporalRate 0.0002/0.0003/0.0005/0.0006/0.0011 (ratio 5.94, mono 1); temporalFreq ratio 2.20, mono 1 |
| TRUE | `ambient_extra/12_floating_frames` | `sliderDirection` | DIRECTION | 0.0990 | claim_met | launch driftZ -0.0009/-0.0002/-0.0000/-0.0002/-0.0005 (ends -0.0009 → -0.0005, floor ±0.004); velocity-series correlation low↔high -0.386 (reversal at ≤ -0.3) [via anticorrelated_motion] |
| TRUE | `ambient_extra/25_zipper_light` | `sliderDirection` | DIRECTION | 0.0984 | claim_met | launch driftZ -0.0154/-0.0176/-0.0031/0.0270/0.0130 (ends -0.0154 → 0.0130, floor ±0.004); velocity-series correlation low↔high -0.254 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `ambient_extra/42_seed_drift` | `sliderDirection` | DIRECTION | 0.0984 | claim_met | launch driftY -0.0189/-0.0189/0.0203/0.0203/0.0203 (ends -0.0189 → 0.0203, floor ±0.004); velocity-series correlation low↔high -0.569 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `ambient_extra/32_silent_meteor` | `sliderTail` | TRAIL | 0.0984 | claim_met | spatialFreqY swing 0.0918 |
| TRUE | `62_white_shimmer` | `sliderWhiteKick` | WHITE | 0.0984 | claim_met | wMean swing 0.0675 ratio 2.08 (via absolute, threshold 0.01) |
| TRUE | `baby/43_girl_waterfall_veil` | `sliderCascadeDensity` | SPATIAL | 0.0980 | claim_met | spatialFreqZ swing 0.0779, monotonic 0 [non-monotonic] |
| TRUE | `118_grand_orbit_rings` | `sliderLocalSpeed` | SPEED | 0.0978 | claim_met | temporalRate 0.0003/0.0004/0.0006/0.0010/0.0020 (ratio 7.52, mono 1); temporalFreq ratio 3.22, mono 1 |
| TRUE | `129_five_colour_stations` | `sliderLocalSpeed` | SPEED | 0.0978 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0004/0.0008 (ratio 10.74, mono 1); temporalFreq ratio 1.15, mono 1 |
| TRUE | `ambient_extra/40_deep_window` | `sliderLocalSpeed` | SPEED | 0.0975 | claim_met | temporalRate 0.0003/0.0005/0.0009/0.0014/0.0026 (ratio 7.91, mono 1); temporalFreq ratio 4.90, mono 1 |
| TRUE | `baby/49_tease_horizon_seesaw` | `sliderLocalSpeed` | SPEED | 0.0974 | claim_met | temporalRate 0.0002/0.0005/0.0011/0.0021/0.0043 (ratio 20.86, mono 1); temporalFreq ratio 7.08, mono 1 |
| TRUE | `125_eclipse_orbit` | `sliderDepth` | MAGNITUDE | 0.0972 | claim_met | dominant mover spatialFreqY 0.0972 |
| TRUE | `60_white_wash` | `sliderKick` | MAGNITUDE | 0.0969 | claim_met | dominant mover wMean 0.0969 |
| TRUE | `ambient_extra/36_off_center_sun` | `sliderOffset` | MAGNITUDE | 0.0966 | claim_met | dominant mover spatialFreqX 0.0966 |
| TRUE | `baby/63_boy_aurora_veil` | `sliderLocalSpeed` | SPEED | 0.0966 | claim_met | temporalRate 0.0007/0.0012/0.0026/0.0046/0.0092 (ratio 13.58, mono 1); temporalFreq ratio 9.00, mono 1 |
| TRUE | `129_five_colour_stations` | `sliderDirection` | DIRECTION | 0.0961 | claim_met | launch driftY 0.0366/0.0213/-0.0022/-0.0139/-0.0205 (ends 0.0366 → -0.0205, floor ±0.004); velocity-series correlation low↔high -0.770 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `ambient_extra/09_shadow_slats` | `sliderLocalSpeed` | SPEED | 0.0960 | claim_met | temporalRate 0.0002/0.0004/0.0007/0.0011/0.0016 (ratio 8.36, mono 1); temporalFreq ratio 2.77, mono 1 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderUvIntensity` | UV | 0.0959 | claim_met | uvMean swing 0.0960 ratio 95950.18 (via absolute, threshold 0.01) |
| TRUE | `baby/56_boy_sign_lantern` | `sliderLocalSpeed` | SPEED | 0.0956 | claim_met | temporalRate 0.0001/0.0002/0.0002/0.0005/0.0011 (ratio 11.78, mono 1); temporalFreq ratio 10355.31, mono 1 |
| TRUE | `baby/71_girl_sign_lantern` | `sliderLocalSpeed` | SPEED | 0.0956 | claim_met | temporalRate 0.0001/0.0002/0.0002/0.0005/0.0011 (ratio 11.89, mono 1); temporalFreq ratio 10351.68, mono 1 |
| TRUE | `baby/72_girl_hull_constellations` | `sliderLocalSpeed` | SPEED | 0.0955 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0006/0.0014 (ratio 12.32, mono 1); temporalFreq ratio 5.03, mono 1 |
| TRUE | `baby/52_boy_bow_wave` | `sliderWaveWidth` | SPATIAL | 0.0954 | claim_met | edgeSharpnessZ swing 0.0360, monotonic 1 |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderImpact` | MAGNITUDE | 0.0949 | claim_met | dominant mover wMean 0.0949 |
| TRUE | `40_lissajous_weave` | `sliderSpread` | SPATIAL | 0.0948 | claim_met | spatialFreqY swing 0.0827, monotonic 0 [non-monotonic] |
| TRUE | `baby/13_tease_wave_collision` | `sliderCollisionEnergy` | MAGNITUDE | 0.0946 | claim_met | dominant mover litFraction 0.0946 |
| TRUE | `baby/62_boy_gentle_maelstrom` | `sliderSpiralWidth` | SPATIAL | 0.0945 | claim_met | spatialFreqY swing 0.0945, monotonic -1 |
| TRUE | `ambient_extra/20_long_shadow` | `sliderLocalSpeed` | SPEED | 0.0939 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0003/0.0007 (ratio 12.63, mono 1); temporalFreq ratio 1.34, mono 1 |
| TRUE | `baby/78_girl_aurora_veil` | `sliderLocalSpeed` | SPEED | 0.0939 | claim_met | temporalRate 0.0006/0.0011/0.0024/0.0042/0.0085 (ratio 13.51, mono 1); temporalFreq ratio 9.01, mono 1 |
| TRUE | `summer_camp/65_dome_kick_shockwave` | `sliderLocalSpeed` | SPEED | 0.0935 | claim_met | temporalRate 0.0008/0.0015/0.0032/0.0059/0.0060 (ratio 7.81, mono 1); temporalFreq ratio 5.34, mono 1 |
| TRUE | `baby/77_girl_gentle_maelstrom` | `sliderSpiralWidth` | SPATIAL | 0.0934 | claim_met | spatialFreqY swing 0.0882, monotonic -1 |
| TRUE | `summer_camp/79_mill_pressure_release` | `sliderCoolingAfterglow` | TRAIL | 0.0930 | claim_met | litFraction swing 0.0930 |
| TRUE | `ambient_extra/02_brass_compass` | `sliderTickGlow` | BRIGHTNESS | 0.0930 | claim_met | outputMean swing 0.0156 ratio 1.31 (via ratio), monotonic 1 |
| TRUE | `baby/68_girl_stern_wake` | `sliderLocalSpeed` | SPEED | 0.0930 | claim_met | temporalRate 0.0001/0.0003/0.0006/0.0011/0.0023 (ratio 15.97, mono 1); temporalFreq ratio 5.62, mono 1 |
| TRUE | `ambient_extra/32_silent_meteor` | `sliderLocalSpeed` | SPEED | 0.0927 | claim_met | temporalRate 0.0005/0.0005/0.0006/0.0008/0.0012 (ratio 2.67, mono 1); temporalFreq ratio 6.27, mono 1 |
| TRUE | `baby/08_tease_moire_gates` | `sliderLineWidth` | SPATIAL | 0.0927 | claim_met | spatialFreqY swing 0.0927, monotonic 0 [non-monotonic] |
| TRUE | `transitions/trans_split_horizontal` | `sliderFeather` | SPATIAL | 0.0925 | claim_met | spatialFreqZ swing 0.0839, monotonic -1 |
| TRUE | `summer_camp/50_iceberg_fracture` | `sliderLocalSpeed` | SPEED | 0.0924 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0002 (ratio 10.41, mono 1); temporalFreq ratio 8.41, mono 1 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderAudioBass` | MAGNITUDE | 0.0923 | claim_met | dominant mover rMean 0.0923 |
| TRUE | `baby/71_girl_sign_lantern` | `sliderLanternDepth` | MAGNITUDE | 0.0922 | claim_met | dominant mover contrastRatio 0.0922 |
| TRUE | `summer_camp/115_tower_lighthouse_sweep` | `sliderBlackoutDepth` | DARKNESS | 0.0922 | claim_met | litFraction swing 0.0382 ratio 1.05 (via absolute), monotonic -1 (expected falling) |
| TRUE | `baby/31_girl_orbit_glow` | `sliderLocalSpeed` | SPEED | 0.0921 | claim_met | temporalRate 0.0006/0.0013/0.0030/0.0055/0.0108 (ratio 16.73, mono 1); temporalFreq ratio 8.17, mono 1 |
| TRUE | `transitions/trans_wipe_left` | `sliderFeather` | SPATIAL | 0.0920 | claim_met | spatialFreqX swing 0.0248, monotonic 1 |
| TRUE | `baby/05_tease_diamond_echo` | `sliderEchoDepth` | MAGNITUDE | 0.0915 | claim_met | dominant mover spatialFreqX 0.0915 |
| TRUE | `19_swaying_lattice_ballet` | `sliderCounterPhase` | MAGNITUDE | 0.0912 | claim_met | dominant mover spatialFreqZ 0.0912 |
| TRUE | `64_temple_warm_white` | `sliderWhiteKick` | WHITE | 0.0910 | claim_met | wMean swing 0.0910 ratio 1.72 (via absolute, threshold 0.01) |
| TRUE | `baby/67_girl_bow_wave` | `sliderWaveWidth` | SPATIAL | 0.0909 | claim_met | edgeSharpnessZ swing 0.0331, monotonic 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderKick` | MAGNITUDE | 0.0907 | claim_met | dominant mover contrastRatio 0.0907 |
| TRUE | `baby/49_tease_horizon_seesaw` | `sliderSeesawDepth` | MAGNITUDE | 0.0907 | claim_met | dominant mover hueMean 0.0907 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderOrbitDrift` | MAGNITUDE | 0.0906 | claim_met | dominant mover driftZ 0.0906 |
| TRUE | `transitions/trans_diamond_wipe` | `sliderFeather` | SPATIAL | 0.0906 | claim_met | spatialFreqZ swing 0.0399, monotonic -1 |
| TRUE | `24_chromatic_murmuration` | `sliderDirection` | DIRECTION | 0.0905 | claim_met | launch driftZ 0.1511/0.1511/-0.1843/-0.1843/-0.1843 (ends 0.1511 → -0.1843, floor ±0.004); velocity-series correlation low↔high -0.189 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `126_cathedral_rib_wave` | `sliderLevel` | BRIGHTNESS | 0.0903 | claim_met | lumaMean swing 0.0173 ratio 1.42 (via ratio), monotonic 1 |
| TRUE | `119_bow_stern_tidal_push` | `sliderPulse` | MAGNITUDE | 0.0901 | claim_met | dominant mover contrastRatio 0.0901 |
| TRUE | `ambient_extra/32_silent_meteor` | `sliderDirection` | DIRECTION | 0.0900 | claim_met | launch driftX -0.0668/-0.0668/-0.0051/-0.0051/-0.0051 (ends -0.0668 → -0.0051, floor ±0.004); velocity-series correlation low↔high -0.573 (reversal at ≤ -0.3) [via anticorrelated_motion] |
| TRUE | `baby/75_girl_orbital_pearls` | `sliderLocalSpeed` | SPEED | 0.0899 | claim_met | temporalRate 0.0003/0.0005/0.0010/0.0021/0.0040 (ratio 12.36, mono 1); temporalFreq ratio 10.85, mono 1 |
| TRUE | `baby/60_boy_orbital_pearls` | `sliderLocalSpeed` | SPEED | 0.0898 | claim_met | temporalRate 0.0003/0.0006/0.0011/0.0022/0.0042 (ratio 12.34, mono 1); temporalFreq ratio 10.76, mono 1 |
| TRUE | `summer_camp/48_titanic_sos_beacon` | `sliderSignalSpeed` | SPEED | 0.0897 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0003/0.0003 (ratio 2.53, mono 1); temporalFreq ratio 3.28, mono 1 |
| TRUE | `transitions/trans_iris` | `sliderFeather` | SPATIAL | 0.0897 | claim_met | spatialFreqY swing 0.0399, monotonic -1 |
| TRUE | `transitions/trans_wipe_down` | `sliderFeather` | SPATIAL | 0.0896 | claim_met | spatialFreqZ swing 0.0640, monotonic -1 |
| TRUE | `12_breathing` | `sliderFieldDetail` | SPATIAL | 0.0896 | claim_met | spatialFreqY swing 0.0797, monotonic 0 [non-monotonic] |
| TRUE | `transitions/trans_split_vertical` | `sliderFeather` | SPATIAL | 0.0886 | claim_met | spatialFreqZ swing 0.0335, monotonic -1 |
| TRUE | `50_phase_cathedral_hd` | `sliderLocalSpeed` | SPEED | 0.0881 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0004/0.0007 (ratio 9.42, mono 1); temporalFreq ratio 3.73, mono 1 |
| TRUE | `15_silk_prism_ribbons` | `sliderKick` | MAGNITUDE | 0.0881 | claim_met | dominant mover rMean 0.0881 |
| TRUE | `52_silk_ribbons` | `sliderShimmer` | MAGNITUDE | 0.0880 | claim_met | dominant mover contrastRatio 0.0880 |
| TRUE | `ambient_extra/32_silent_meteor` | `sliderJewelryAfterglow` | TRAIL | 0.0879 | claim_met | spatialFreqY swing 0.0879 |
| TRUE | `36_orbital_pulse` | `sliderBase` | MAGNITUDE | 0.0878 | claim_met | dominant mover rMean 0.0878 |
| TRUE | `baby/16_boy_orbit_glow` | `sliderSpatialDepth` | MAGNITUDE | 0.0873 | claim_met | dominant mover spatialFreqY 0.0873 |
| TRUE | `ambient_extra/03_pearl_chain` | `sliderFocusTravel` | SPATIAL | 0.0870 | claim_met | spatialFreqY swing 0.0870, monotonic -1 |
| TRUE | `ambient_extra/03_pearl_chain` | `sliderJewelryWhite` | WHITE | 0.0870 | claim_met | wMean swing 0.0128 ratio 12796.00 (via absolute, threshold 0.01) |
| TRUE | `ambient_extra/04_five_lanterns` | `sliderBreathDepth` | MAGNITUDE | 0.0870 | claim_met | dominant mover spatialFreqX 0.0870 |
| TRUE | `ambient_extra/06_folded_flags` | `sliderFoldDepth` | MAGNITUDE | 0.0870 | claim_met | dominant mover spatialFreqY 0.0870 |
| TRUE | `ambient_extra/06_folded_flags` | `sliderContrast` | CONTRAST | 0.0870 | claim_met | contrastRatio swing 0.0493 ratio 1.14 (via absolute) |
| TRUE | `ambient_extra/07_keel_glow` | `sliderLocalSpeed` | SPEED | 0.0870 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0002 (ratio 24.64, mono 1); temporalFreq ratio 4967.71, mono 1 |
| TRUE | `ambient_extra/22_balance_beam` | `sliderTransferWidth` | SPATIAL | 0.0870 | claim_met | spatialFreqX swing 0.0870, monotonic 1 |
| TRUE | `ambient_extra/26_drawbridge` | `sliderHingeGlow` | BRIGHTNESS | 0.0870 | claim_met | lumaMean swing 0.0155 ratio 1.27 (via ratio), monotonic 1 |
| TRUE | `ambient_extra/44_healing_cracks` | `sliderCrackCount` | SPATIAL | 0.0870 | claim_met | spatialFreqY swing 0.0870, monotonic 1 |
| TRUE | `ambient_extra/47_side_by_side` | `sliderOrganBalance` | MAGNITUDE | 0.0870 | claim_met | dominant mover spatialFreqY 0.0870 |
| TRUE | `baby/31_girl_orbit_glow` | `sliderSpatialDepth` | MAGNITUDE | 0.0870 | claim_met | dominant mover spatialFreqY 0.0870 |
| TRUE | `party_dancers/01_dom_ball_dancers` | `sliderOrganKick` | MAGNITUDE | 0.0870 | claim_met | dominant mover spatialFreqX 0.0870 |
| TRUE | `summer_camp/42_boiler_glow` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0024 ratio 38.08 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/47_apex_perimeter_ping` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | lumaMean swing 0.0040 ratio 31.48 (via ratio), monotonic -1 (expected falling) |
| TRUE | `summer_camp/48_titanic_sos_beacon` | `sliderAbyssalDarkness` | DARKNESS | 0.0870 | claim_met | litFraction swing 0.0249 ratio 1.48 (via absolute), monotonic -1 (expected falling) |
| TRUE | `summer_camp/54_boiler_fire_overdrive` | `sliderBlackoutDepth` | DARKNESS | 0.0870 | claim_met | litFraction swing 0.0090 ratio 1.88 (via ratio), monotonic -1 (expected falling) |
| TRUE | `transitions/trans_iris_close` | `sliderFeather` | SPATIAL | 0.0868 | claim_met | spatialFreqZ swing 0.0272, monotonic -1 |
| TRUE | `summer_camp/41_ghost_aurora` | `sliderLocalSpeed` | SPEED | 0.0863 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0001 (ratio 13.73, mono 1); temporalFreq ratio 19561.52, mono 1 |
| TRUE | `summer_camp/46_dome_lockdown` | `sliderBlackoutDepth` | DARKNESS | 0.0862 | claim_met | lumaMean swing 0.0032 ratio 5.82 (via ratio), monotonic -1 (expected falling) |
| TRUE | `baby/47_tease_twin_lantern_tides` | `sliderTideDepth` | MAGNITUDE | 0.0859 | claim_met | dominant mover bMean 0.0859 |
| TRUE | `32_caustic_shimmer` | `sliderLocalSpeed` | SPEED | 0.0848 | claim_met | temporalRate 0.0003/0.0006/0.0012/0.0024/0.0048 (ratio 16.17, mono 1); temporalFreq ratio 5.03, mono 1 |
| TRUE | `transitions/trans_wave_sweep` | `sliderFeather` | SPATIAL | 0.0843 | claim_met | spatialFreqZ swing 0.0722, monotonic -1 |
| TRUE | `ambient_extra/47_side_by_side` | `sliderLocalSpeed` | SPEED | 0.0842 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0001 (ratio 8.86, mono 1); temporalFreq ratio 0.00, mono 0 |
| TRUE | `ambient_extra/41_jelly_bells` | `sliderLocalSpeed` | SPEED | 0.0839 | claim_met | temporalRate 0.0000/0.0001/0.0002/0.0003/0.0004 (ratio 8.50, mono 1); temporalFreq ratio 3.60, mono 1 |
| TRUE | `00_golden_hour_wash` | `sliderLocalSpeed` | SPEED | 0.0833 | claim_met | temporalRate 0.0002/0.0003/0.0004/0.0007/0.0018 (ratio 8.01, mono 1); temporalFreq ratio 5.28, mono 1 |
| TRUE | `04_beat_folded_helix` | `sliderWhiteLevel` | WHITE | 0.0822 | claim_met | wMean swing 0.0676 ratio 2.41 (via absolute, threshold 0.01) |
| TRUE | `32_caustic_shimmer` | `sliderRipple` | MAGNITUDE | 0.0822 | claim_met | dominant mover rMean 0.0822 |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderLocalSpeed` | SPEED | 0.0820 | claim_met | temporalRate 0.0000/0.0001/0.0002/0.0005/0.0012 (ratio 28.65, mono 1); temporalFreq ratio 8.78, mono 1 |
| TRUE | `ambient_extra/27_rolling_shutters` | `sliderSafetyFloor` | MAGNITUDE | 0.0819 | claim_met | dominant mover contrastRatio 0.0819 |
| TRUE | `63_white_chase` | `sliderRadius` | SPATIAL | 0.0816 | claim_met | edgeSharpnessX swing 0.0816, monotonic 1 |
| TRUE | `ambient_extra/48_organ_echoes` | `sliderDecay` | TRAIL | 0.0815 | claim_met | spatialFreqZ swing 0.0815 |
| TRUE | `124_aurora_crown` | `sliderLocalSpeed` | SPEED | 0.0812 | claim_met | temporalRate 0.0001/0.0002/0.0003/0.0006/0.0011 (ratio 12.16, mono 1); temporalFreq ratio 2.63, mono 1 |
| TRUE | `23_prismatic_strange_attractors` | `sliderKick` | MAGNITUDE | 0.0809 | claim_met | dominant mover contrastRatio 0.0809 |
| TRUE | `baby/27_boy_heartbeat_bloom` | `sliderEchoDepth` | MAGNITUDE | 0.0807 | claim_met | dominant mover driftY 0.0807 |
| TRUE | `summer_camp/73_tree_shadow_breath` | `sliderBlackoutDepth` | DARKNESS | 0.0805 | claim_met | lumaMean swing 0.0145 ratio 1.30 (via ratio), monotonic -1 (expected falling) |
| TRUE | `baby/42_girl_heartbeat_bloom` | `sliderEchoDepth` | MAGNITUDE | 0.0803 | claim_met | dominant mover driftY 0.0803 |
| TRUE | `126_cathedral_rib_wave` | `sliderLocalSpeed` | SPEED | 0.0803 | claim_met | temporalRate 0.0004/0.0005/0.0012/0.0023/0.0043 (ratio 10.43, mono 1); temporalFreq ratio 3.87, mono 1 |
| TRUE | `11_bioluminescence` | `sliderUvGlow` | UV | 0.0797 | claim_met | uvMean swing 0.0795 ratio 2.79 (via absolute, threshold 0.01) |
| TRUE | `ambient_extra/09_shadow_slats` | `sliderDirection` | DIRECTION | 0.0795 | claim_met | launch driftZ -0.0120/-0.0030/0.0007/0.0089/0.0120 (ends -0.0120 → 0.0120, floor ±0.004); velocity-series correlation low↔high 0.139 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `ambient_extra/29_warm_rivets` | `sliderRivetDensity` | SPATIAL | 0.0789 | claim_met | spatialFreqZ swing 0.0326, monotonic 1 |
| TRUE | `14_lunar_current` | `sliderJewelryWhite` | WHITE | 0.0782 | claim_met | wMean swing 0.0296 ratio 29623.84 (via absolute, threshold 0.01) |
| TRUE | `29_kick_shockwave` | `sliderKick` | MAGNITUDE | 0.0779 | responds_to_edges_not_to_level | held static the control does nothing, but pulsed 0↔1 at 40 frames it moves spatialFreqZ by 0.0779 — this is an edge-triggered control, meant to be driven by a modulation mapping rather than parked at a value |
| TRUE | `ambient_extra/21_pendulum_room` | `sliderLocalSpeed` | SPEED | 0.0779 | claim_met | temporalRate 0.0001/0.0001/0.0001/0.0002/0.0006 (ratio 8.03, mono 1); temporalFreq ratio 2.69, mono 1 |
| TRUE | `ambient_extra/36_off_center_sun` | `sliderLocalSpeed` | SPEED | 0.0779 | claim_met | temporalRate 0.0000/0.0000/0.0001/0.0001/0.0002 (ratio 5.25, mono 1); temporalFreq ratio 7477.14, mono 1 |
| TRUE | `125_eclipse_orbit` | `sliderRimWidth` | SPATIAL | 0.0774 | claim_met | spatialFreqX swing 0.0380, monotonic -1 |
| TRUE | `127_grand_maelstrom` | `sliderLocalSpeed` | SPEED | 0.0773 | claim_met | temporalRate 0.0001/0.0002/0.0005/0.0008/0.0017 (ratio 15.65, mono 1); temporalFreq ratio 4.57, mono 1 |
| TRUE | `08_ocean_liner` | `sliderDetail` | SPATIAL | 0.0770 | claim_met | spatialFreqY swing 0.0652, monotonic 1 |
| TRUE | `summer_camp/56_stage_mirror_axis` | `sliderOrbitSpeed` | SPEED | 0.0769 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0001 (ratio 5.98, mono 1); temporalFreq ratio 38461.54, mono 1 |
| TRUE | `125_eclipse_orbit` | `sliderPulse` | MAGNITUDE | 0.0766 | claim_met | dominant mover contrastRatio 0.0766 |
| TRUE | `19_swaying_lattice_ballet` | `sliderWhiteKick` | WHITE | 0.0761 | claim_met | wMean swing 0.0467 ratio 3.09 (via absolute, threshold 0.01) |
| TRUE | `ambient_extra/16_turning_tiles` | `sliderLocalSpeed` | SPEED | 0.0755 | claim_met | temporalRate 0.0001/0.0001/0.0002/0.0004/0.0007 (ratio 13.45, mono 1); temporalFreq ratio 1.33, mono 0 |
| TRUE | `62_white_shimmer` | `sliderKick` | MAGNITUDE | 0.0754 | claim_met | dominant mover edgeSharpnessX 0.0754 |
| TRUE | `baby/01_tease_orbit_question` | `sliderSpatialDepth` | MAGNITUDE | 0.0752 | claim_met | dominant mover spatialFreqY 0.0752 |
| TRUE | `baby/07_tease_lattice_bloom` | `sliderLatticeScale` | SPATIAL | 0.0752 | claim_met | spatialFreqZ swing 0.0752, monotonic 0 [non-monotonic] |
| TRUE | `10_chasers` | `sliderRadius` | SPATIAL | 0.0751 | claim_met | litFraction swing 0.0751, monotonic 1 |
| TRUE | `summer_camp/84_outpost_ember_overdrive` | `sliderFlashRate` | SPEED | 0.0747 | claim_met | temporalRate 0.0004/0.0004/0.0004/0.0004/0.0005 (ratio 1.30, mono 1); temporalFreq ratio 1.09, mono 0 |
| TRUE | `baby/15_tease_velocity_weave` | `sliderWeaveDepth` | MAGNITUDE | 0.0746 | claim_met | dominant mover driftX 0.0746 |
| TRUE | `baby/22_boy_constellation_flow` | `sliderConstellationDensity` | SPATIAL | 0.0743 | claim_met | spatialFreqY swing 0.0652, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/06_folded_flags` | `sliderLocalSpeed` | SPEED | 0.0743 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0007 (ratio 670.17, mono 1); temporalFreq ratio 7421.41, mono 1 |
| TRUE | `127_grand_maelstrom` | `sliderArmCount` | SPATIAL | 0.0740 | claim_met | spatialFreqZ swing 0.0740, monotonic 0 [non-monotonic] |
| TRUE | `12_breathing` | `sliderWhiteGlow` | WHITE | 0.0737 | claim_met | wMean swing 0.0093 ratio 9342.48 (via ratio, threshold 0.01) |
| TRUE | `ambient_extra/42_seed_drift` | `sliderWingSpan` | SPATIAL | 0.0732 | claim_met | spatialFreqZ swing 0.0691, monotonic 0 [non-monotonic] |
| TRUE | `63_white_chase` | `sliderKick` | MAGNITUDE | 0.0729 | claim_met | dominant mover edgeSharpnessX 0.0729 |
| TRUE | `summer_camp/74_lookout_gyro_vortex` | `sliderVortexSpeed` | SPEED | 0.0728 | claim_met | temporalRate 0.0000/0.0005/0.0009/0.0016/0.0023 (ratio 2343.60, mono 1); temporalFreq ratio 19452.02, mono 1 |
| TRUE | `baby/04_tease_tidal_ribbons` | `sliderTurbulence` | MAGNITUDE | 0.0722 | claim_met | dominant mover spatialFreqX 0.0722 |
| TRUE | `ambient_extra/34_soft_hourglass` | `sliderGrain` | SPATIAL | 0.0719 | claim_met | spatialFreqY swing 0.0719, monotonic 1 |
| TRUE | `09_cyclone` | `sliderDirection` | DIRECTION | 0.0717 | claim_met | launch driftX 0.0756/0.0756/-0.0462/-0.0462/-0.0462 (ends 0.0756 → -0.0462, floor ±0.004); velocity-series correlation low↔high 0.184 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `43_golden_hour_pulse` | `sliderShimmer` | MAGNITUDE | 0.0709 | claim_met | dominant mover spatialFreqY 0.0710 |
| TRUE | `baby/37_girl_constellation_flow` | `sliderConstellationDensity` | SPATIAL | 0.0709 | claim_met | spatialFreqY swing 0.0640, monotonic 0 [non-monotonic] |
| TRUE | `121_spiral_wake` | `sliderLocalSpeed` | SPEED | 0.0707 | claim_met | temporalRate 0.0004/0.0008/0.0015/0.0027/0.0046 (ratio 12.18, mono 1); temporalFreq ratio 6.32, mono 1 |
| TRUE | `transitions/trans_wave_sweep` | `sliderWaveAmp` | MAGNITUDE | 0.0703 | claim_met | dominant mover spatialFreqZ 0.0704 |
| TRUE | `ambient_extra/13_cut_diamond` | `sliderLocalSpeed` | SPEED | 0.0699 | claim_met | temporalRate 0.0010/0.0012/0.0021/0.0034/0.0060 (ratio 6.26, mono 1); temporalFreq ratio 4.59, mono 1 |
| TRUE | `20_parametric_sway_field` | `sliderTrailBlend` | TRAIL | 0.0699 | claim_met | litFraction swing 0.0699 |
| TRUE | `ambient_extra/28_organ_chords` | `sliderChordSpread` | SPATIAL | 0.0694 | claim_met | spatialFreqX swing 0.0694, monotonic 0 [non-monotonic] |
| TRUE | `baby/17_boy_crossing_glow` | `sliderBeamWidth` | SPATIAL | 0.0689 | claim_met | spatialFreqY swing 0.0616, monotonic 0 [non-monotonic] |
| TRUE | `13_sparkle` | `sliderTwinkleFocus` | SPATIAL | 0.0688 | claim_met | spatialFreqY swing 0.0688, monotonic 0 [non-monotonic] |
| TRUE | `baby/60_boy_orbital_pearls` | `sliderOrbitDepth` | MAGNITUDE | 0.0686 | claim_met | dominant mover contrastRatio 0.0686 |
| TRUE | `summer_camp/71_tree_aurora` | `sliderUvIntensity` | UV | 0.0684 | claim_met | uvMean swing 0.0383 ratio 38340.70 (via absolute, threshold 0.01) |
| TRUE | `14_lunar_current` | `sliderKick` | MAGNITUDE | 0.0682 | claim_met | dominant mover spatialFreqZ 0.0682 |
| TRUE | `61_white_breathe` | `sliderLocalSpeed` | SPEED | 0.0682 | claim_met | temporalRate 0.0002/0.0002/0.0004/0.0006/0.0013 (ratio 7.81, mono 1); temporalFreq ratio 2.55, mono 0 |
| TRUE | `ambient_extra/39_magnetic_sand` | `sliderGrainDensity` | SPATIAL | 0.0682 | claim_met | spatialFreqY swing 0.0682, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/116_tower_cathedral_organ` | `sliderShimmer` | MAGNITUDE | 0.0681 | claim_met | dominant mover contrastRatio 0.0681 |
| TRUE | `60_white_wash` | `sliderDirection` | DIRECTION | 0.0664 | claim_met | launch driftY 0.0086/0.0046/-0.0004/-0.0056/-0.0122 (ends 0.0086 → -0.0122, floor ±0.004); velocity-series correlation low↔high -0.573 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `baby/75_girl_orbital_pearls` | `sliderOrbitDepth` | MAGNITUDE | 0.0664 | claim_met | dominant mover spatialFreqY 0.0664 |
| TRUE | `125_eclipse_orbit` | `sliderSafetyFloor` | MAGNITUDE | 0.0654 | claim_met | dominant mover rMean 0.0654 |
| TRUE | `baby/50_tease_constellation_duet` | `sliderStarFocus` | SPATIAL | 0.0647 | claim_met | spatialFreqZ swing 0.0598, monotonic 1 |
| TRUE | `ambient_extra/43_leaf_turn` | `sliderLocalSpeed` | SPEED | 0.0646 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0001 (ratio 19.44, mono 1); temporalFreq ratio 10489.51, mono 1 |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderAudioBass` | MAGNITUDE | 0.0645 | claim_met | dominant mover contrastRatio 0.0645 |
| TRUE | `16_ghost_tide_uv` | `sliderWhiteLevel` | WHITE | 0.0643 | claim_met | wMean swing 0.0011 ratio 1097.74 (via ratio, threshold 0.01) |
| TRUE | `123_mirrored_broadside_call` | `sliderContrast` | CONTRAST | 0.0640 | claim_met | contrastRatio swing 0.0205 ratio 1.08 (via absolute) |
| TRUE | `baby/58_boy_silhouette_tide` | `sliderSilhouetteDepth` | MAGNITUDE | 0.0640 | claim_met | dominant mover spatialFreqX 0.0640 |
| TRUE | `summer_camp/76_outpost_lockdown` | `sliderBlackoutDepth` | DARKNESS | 0.0638 | claim_met | litFraction swing 0.0353 ratio 1.04 (via absolute), monotonic -1 (expected falling) |
| TRUE | `21_pelagic_manta_rays` | `sliderDetail` | SPATIAL | 0.0635 | claim_met | litFraction swing 0.0624, monotonic 1 |
| TRUE | `ambient_extra/25_zipper_light` | `sliderLocalSpeed` | SPEED | 0.0628 | claim_met | temporalRate 0.0003/0.0002/0.0001/0.0003/0.0018 (ratio 24.90, mono 0); temporalFreq ratio 4.03, mono 1 |
| TRUE | `baby/79_girl_harbor_fireflies` | `sliderDriftDepth` | MAGNITUDE | 0.0625 | claim_met | dominant mover spatialFreqZ 0.0625 |
| TRUE | `ambient_extra/45_moss_islands` | `sliderEdgeDetail` | SPATIAL | 0.0616 | claim_met | spatialFreqZ swing 0.0616, monotonic -1 |
| TRUE | `baby/32_girl_crossing_glow` | `sliderBeamWidth` | SPATIAL | 0.0613 | claim_met | spatialFreqZ swing 0.0565, monotonic 0 [non-monotonic] |
| TRUE | `26_dom_dancers_chevron` | `sliderLocalSpeed` | SPEED | 0.0610 | claim_met | temporalRate 0.0004/0.0008/0.0018/0.0036/0.0071 (ratio 18.76, mono 1); temporalFreq ratio 6.43, mono 1 |
| TRUE | `ambient_extra/11_paper_fold` | `sliderCreaseCount` | SPATIAL | 0.0610 | claim_met | spatialFreqY swing 0.0610, monotonic 0 [non-monotonic] |
| TRUE | `baby/64_boy_harbor_fireflies` | `sliderDriftDepth` | MAGNITUDE | 0.0610 | claim_met | dominant mover spatialFreqZ 0.0610 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderVintageMix` | MAGNITUDE | 0.0607 | claim_met | dominant mover spatialFreqZ 0.0607 |
| TRUE | `05_orbital_attractor_field` | `sliderDirection` | DIRECTION | 0.0604 | claim_met | launch driftY -0.0257/-0.0145/0.0024/0.0147/0.0195 (ends -0.0257 → 0.0195, floor ±0.004); velocity-series correlation low↔high 0.613 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `48_heartbeat_drive` | `sliderLocalSpeed` | SPEED | 0.0598 | claim_met | temporalRate 0.0003/0.0003/0.0007/0.0015/0.0019 (ratio 6.52, mono 1); temporalFreq ratio 6.85, mono 0 |
| TRUE | `baby/55_boy_rail_cascade` | `sliderCascadeDepth` | MAGNITUDE | 0.0595 | claim_met | dominant mover spatialFreqX 0.0595 |
| TRUE | `baby/73_girl_silhouette_tide` | `sliderSilhouetteDepth` | MAGNITUDE | 0.0595 | claim_met | dominant mover spatialFreqX 0.0595 |
| TRUE | `summer_camp/55_stardust_dome` | `sliderWallHit` | MAGNITUDE | 0.0594 | claim_met | dominant mover temporalFreq 0.0594 |
| TRUE | `ambient_extra/04_five_lanterns` | `sliderLocalSpeed` | SPEED | 0.0592 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0001 (ratio 18.19, mono 1); temporalFreq ratio 3496.50, mono 1 |
| TRUE | `baby/02_tease_crossing_question` | `sliderBeamWidth` | SPATIAL | 0.0591 | claim_met | spatialFreqZ swing 0.0534, monotonic 0 [non-monotonic] |
| TRUE | `31_strobe_lattice` | `sliderFlash` | MAGNITUDE | 0.0584 | claim_met | dominant mover contrastRatio 0.0584 |
| TRUE | `122_breathing_horizon` | `sliderPulse` | MAGNITUDE | 0.0580 | claim_met | dominant mover spatialFreqZ 0.0580 |
| TRUE | `ambient_extra/29_warm_rivets` | `sliderLocalSpeed` | SPEED | 0.0580 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0002 (ratio 10.52, mono 1); temporalFreq ratio 1.58, mono 1 |
| TRUE | `123_mirrored_broadside_call` | `sliderPulse` | MAGNITUDE | 0.0576 | claim_met | dominant mover contrastRatio 0.0576 |
| TRUE | `118_grand_orbit_rings` | `sliderContrast` | CONTRAST | 0.0571 | claim_met | contrastRatio swing 0.0571 ratio 1.12 (via absolute) |
| TRUE | `ambient_extra/15_woven_light` | `sliderThreadCount` | SPATIAL | 0.0568 | claim_met | spatialFreqX swing 0.0568, monotonic -1 |
| TRUE | `baby/70_girl_rail_cascade` | `sliderCascadeDepth` | MAGNITUDE | 0.0565 | claim_met | dominant mover spatialFreqX 0.0565 |
| TRUE | `23_prismatic_strange_attractors` | `sliderDetail` | SPATIAL | 0.0564 | claim_met | spatialFreqZ swing 0.0408, monotonic 0 [non-monotonic] |
| TRUE | `summer_camp/53_shadow_eclipse` | `sliderCoronaPulse` | MAGNITUDE | 0.0562 | claim_met | dominant mover driftY 0.0562 |
| TRUE | `ambient_extra/22_balance_beam` | `sliderLocalSpeed` | SPEED | 0.0562 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0001 (ratio 7.12, mono 1); temporalFreq ratio 6993.01, mono 1 |
| TRUE | `02_phase_cathedral` | `sliderCount` | SPATIAL | 0.0561 | claim_met | spatialFreqX swing 0.0341, monotonic 0 [non-monotonic] |
| TRUE | `38_prism_helix` | `sliderShimmer` | MAGNITUDE | 0.0560 | claim_met | dominant mover temporalFreq 0.0560 |
| TRUE | `summer_camp/96_logsville_ember_storm` | `sliderAudioKick` | MAGNITUDE | 0.0557 | claim_met | dominant mover contrastRatio 0.0557 |
| TRUE | `ambient_extra/28_organ_chords` | `sliderLocalSpeed` | SPEED | 0.0555 | claim_met | temporalRate 0.0006/0.0007/0.0005/0.0009/0.0020 (ratio 3.88, mono 0); temporalFreq ratio 3.93, mono 1 |
| TRUE | `19_swaying_lattice_ballet` | `sliderRadius` | SPATIAL | 0.0548 | claim_met | spatialFreqY swing 0.0465, monotonic -1 |
| TRUE | `45_manta_drift` | `sliderFoam` | MAGNITUDE | 0.0544 | claim_met | dominant mover spatialFreqY 0.0543 |
| TRUE | `summer_camp/53_shadow_eclipse` | `sliderRimWidth` | SPATIAL | 0.0543 | claim_met | spatialFreqZ swing 0.0272, monotonic 1 |
| TRUE | `ambient_extra/34_soft_hourglass` | `sliderOrganCore` | SPATIAL | 0.0542 | claim_met | spatialFreqY swing 0.0396, monotonic 1 |
| TRUE | `22_abyssal_sway_garden` | `sliderKick` | MAGNITUDE | 0.0538 | claim_met | dominant mover rMean 0.0538 |
| TRUE | `11_bioluminescence` | `sliderWhiteLevel` | WHITE | 0.0528 | claim_met | wMean swing 0.0307 ratio 30659.35 (via absolute, threshold 0.01) |
| TRUE | `118_grand_orbit_rings` | `sliderPulse` | MAGNITUDE | 0.0525 | claim_met | dominant mover rMean 0.0525 |
| TRUE | `party_dancers/01_dom_ball_dancers` | `sliderOrganEnergy` | MAGNITUDE | 0.0516 | claim_met | dominant mover spatialFreqX 0.0516 |
| TRUE | `44_biolume_swell` | `sliderLocalSpeed` | SPEED | 0.0514 | claim_met | temporalRate 0.0002/0.0003/0.0005/0.0008/0.0014 (ratio 7.97, mono 1); temporalFreq ratio 7.14, mono 1 |
| TRUE | `ambient_extra/33_rope_constellation` | `sliderNodeCount` | SPATIAL | 0.0507 | claim_met | spatialFreqZ swing 0.0507, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/25_zipper_light` | `sliderSeamWidth` | SPATIAL | 0.0504 | claim_met | spatialFreqY swing 0.0504, monotonic 0 [non-monotonic] |
| TRUE | `11_bioluminescence` | `sliderDetail` | SPATIAL | 0.0502 | claim_met | spatialFreqY swing 0.0414, monotonic 1 |
| TRUE | `18_deep_space_lattice` | `sliderRadius` | SPATIAL | 0.0498 | claim_met | spatialFreqX swing 0.0438, monotonic 0 [non-monotonic] |
| TRUE | `04_beat_folded_helix` | `sliderCount` | SPATIAL | 0.0492 | claim_met | spatialFreqY swing 0.0492, monotonic 0 [non-monotonic] |
| TRUE | `50_phase_cathedral_hd` | `sliderKickLock` | MAGNITUDE | 0.0492 | claim_met | dominant mover spatialFreqZ 0.0492 |
| TRUE | `baby/06_tease_bow_stern_comets` | `sliderCometFocus` | TRAIL | 0.0486 | claim_met | litFraction swing 0.0486 |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderAudioKick` | MAGNITUDE | 0.0484 | responds_to_edges_not_to_level | held static the control does nothing, but pulsed 0↔1 at 40 frames it moves contrastRatio by 0.0484 — this is an edge-triggered control, meant to be driven by a modulation mapping rather than parked at a value |
| TRUE | `35_sparkle_rain` | `sliderLocalSpeed` | SPEED | 0.0477 | claim_met | temporalRate 0.0001/0.0002/0.0004/0.0008/0.0016 (ratio 15.66, mono 1); temporalFreq ratio 3.76, mono 1 |
| TRUE | `ambient_extra/47_side_by_side` | `sliderContrast` | CONTRAST | 0.0471 | claim_met | contrastRatio swing 0.0409 ratio 1.54 (via absolute) |
| TRUE | `46_abyssal_fronds` | `sliderBreathRate` | SPEED | 0.0462 | claim_met | temporalRate 0.0007/0.0008/0.0007/0.0009/0.0015 (ratio 2.16, mono 0); temporalFreq ratio 1.69, mono 1 |
| TRUE | `ambient_extra/39_magnetic_sand` | `sliderLocalSpeed` | SPEED | 0.0454 | claim_met | temporalRate 0.0006/0.0009/0.0014/0.0022/0.0034 (ratio 5.63, mono 1); temporalFreq ratio 3.77, mono 1 |
| TRUE | `ambient_extra/38_shell_growth` | `sliderCoilCount` | SPATIAL | 0.0437 | claim_met | spatialFreqY swing 0.0248, monotonic 0 [non-monotonic] |
| TRUE | `ambient_extra/16_turning_tiles` | `sliderFaceDepth` | MAGNITUDE | 0.0435 | claim_met | dominant mover spatialFreqY 0.0435 |
| TRUE | `summer_camp/77_tree_canopy_ping` | `sliderCrownImpact` | MAGNITUDE | 0.0435 | claim_met | dominant mover contrastRatio 0.0435 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderNeighborWeight` | MAGNITUDE | 0.0435 | claim_met | dominant mover contrastRatio 0.0435 |
| TRUE | `ambient_extra/14_slow_cells` | `sliderEdgeFade` | TRAIL | 0.0428 | claim_met | spatialFreqY swing 0.0383 |
| TRUE | `summer_camp/85_redwood_starry_canopy` | `sliderWallHit` | MAGNITUDE | 0.0427 | claim_met | dominant mover litFraction 0.0427 |
| TRUE | `34_moire_interference` | `sliderPulse` | MAGNITUDE | 0.0425 | claim_met | dominant mover rMean 0.0425 |
| TRUE | `19_swaying_lattice_ballet` | `sliderWhiteLevel` | WHITE | 0.0423 | claim_met | wMean swing 0.0260 ratio 3.76 (via absolute, threshold 0.01) |
| TRUE | `ambient_extra/46_twin_seals` | `sliderLocalSpeed` | SPEED | 0.0423 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0000 (ratio 9.20, mono 1); temporalFreq ratio 4784.69, mono 1 |
| TRUE | `33_aurora_breath` | `sliderRibbons` | SPATIAL | 0.0420 | claim_met | spatialFreqX swing 0.0420, monotonic 0 [non-monotonic] |
| TRUE | `16_ghost_tide_uv` | `sliderRadius` | SPATIAL | 0.0416 | claim_met | spatialFreqY swing 0.0362, monotonic -1 |
| TRUE | `baby/10_tease_constellation_tides` | `sliderStarFocus` | SPATIAL | 0.0411 | claim_met | spatialFreqY swing 0.0411, monotonic 1 |
| TRUE | `summer_camp/52_iceberg_shear_line` | `sliderWarmthRetreat` | WARMTH | 0.0411 | claim_met | aMean swing 0.0026 ratio 2574.80 (via ratio), hue 0.0000 |
| TRUE | `40_lissajous_weave` | `sliderKick` | MAGNITUDE | 0.0403 | claim_met | dominant mover driftY 0.0403 |
| TRUE | `49_cylon_crush` | `sliderKick` | MAGNITUDE | 0.0399 | responds_to_edges_not_to_level | held static the control does nothing, but pulsed 0↔1 at 40 frames it moves temporalFreq by 0.0399 — this is an edge-triggered control, meant to be driven by a modulation mapping rather than parked at a value |
| TRUE | `ambient_extra/33_rope_constellation` | `sliderLocalSpeed` | SPEED | 0.0399 | claim_met | temporalRate 0.0000/0.0001/0.0002/0.0003/0.0006 (ratio 18.21, mono 1); temporalFreq ratio 3.51, mono 0 |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderNeighborWeight` | MAGNITUDE | 0.0393 | claim_met | dominant mover spatialFreqY 0.0393 |
| TRUE | `summer_camp/72_outpost_campfire` | `sliderWoodSparkle` | MAGNITUDE | 0.0391 | claim_met | dominant mover temporalRate 0.0391 |
| TRUE | `summer_camp/46_dome_lockdown` | `sliderHoldBlackout` | DARKNESS | 0.0390 | claim_met | lumaMean swing 0.0015 ratio 2.01 (via ratio), monotonic -1 (expected falling) |
| TRUE | `ambient_extra/13_cut_diamond` | `sliderFacetCount` | SPATIAL | 0.0386 | claim_met | spatialFreqZ swing 0.0386, monotonic 0 [non-monotonic] |
| TRUE | `21_pelagic_manta_rays` | `sliderKick` | MAGNITUDE | 0.0380 | claim_met | dominant mover spatialFreqX 0.0380 |
| TRUE | `summer_camp/114_tower_ring_chase` | `sliderVintageWash` | MAGNITUDE | 0.0380 | claim_met | dominant mover spatialFreqY 0.0380 |
| TRUE | `126_cathedral_rib_wave` | `sliderPulse` | MAGNITUDE | 0.0372 | claim_met | dominant mover contrastRatio 0.0372 |
| TRUE | `summer_camp/113_tower_column_breath` | `sliderBreathRate` | SPEED | 0.0364 | claim_met | temporalRate 0.0001/0.0004/0.0007/0.0010/0.0013 (ratio 12.15, mono 1); temporalFreq ratio 4.92, mono 1 |
| TRUE | `summer_camp/74_lookout_gyro_vortex` | `sliderUvIntensity` | UV | 0.0356 | claim_met | uvMean swing 0.0188 ratio 18770.14 (via absolute, threshold 0.01) |
| TRUE | `ambient_extra/28_organ_chords` | `sliderAttack` | MAGNITUDE | 0.0353 | claim_met | dominant mover rMean 0.0353 |
| TRUE | `summer_camp/63_dome_phyllotaxis_bloom` | `sliderLocalSpeed` | SPEED | 0.0341 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0002 (ratio 13.44, mono 1); temporalFreq ratio 3.44, mono 1 |
| TRUE | `40_lissajous_weave` | `sliderBase` | MAGNITUDE | 0.0331 | claim_met | dominant mover litFraction 0.0331 |
| TRUE | `baby/59_boy_cathedral_ribs` | `sliderRibWidth` | SPATIAL | 0.0326 | claim_met | spatialFreqY swing 0.0281, monotonic -1 |
| TRUE | `baby/74_girl_cathedral_ribs` | `sliderRibWidth` | SPATIAL | 0.0326 | claim_met | spatialFreqY swing 0.0305, monotonic -1 |
| TRUE | `21_pelagic_manta_rays` | `sliderUvUndertow` | UV | 0.0324 | claim_met | uvMean swing 0.0324 ratio 32407.66 (via absolute, threshold 0.01) |
| TRUE | `ambient_extra/26_drawbridge` | `sliderLocalSpeed` | SPEED | 0.0320 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0001 (ratio 10.80, mono 1); temporalFreq ratio 6993.01, mono 1 |
| TRUE | `14_lunar_current` | `sliderUvUndertow` | UV | 0.0320 | claim_met | uvMean swing 0.0320 ratio 31987.58 (via absolute, threshold 0.01) |
| TRUE | `25_heartbeat` | `sliderDetail` | SPATIAL | 0.0318 | claim_met | litFraction swing 0.0201, monotonic -1 |
| TRUE | `summer_camp/44_apex_gyro_vortex` | `sliderArmPhase` | MAGNITUDE | 0.0314 | claim_met | dominant mover contrastRatio 0.0314 |
| TRUE | `12_breathing` | `sliderSparkle` | MAGNITUDE | 0.0308 | claim_met | dominant mover contrastRatio 0.0308 |
| TRUE | `summer_camp/43_sea_floor_shadow` | `sliderLocalSpeed` | SPEED | 0.0302 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0001 (ratio 102.31, mono 1); temporalFreq ratio 11056.51, mono 1 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderAudioKick` | MAGNITUDE | 0.0296 | claim_met | dominant mover contrastRatio 0.0296 |
| TRUE | `summer_camp/65_dome_kick_shockwave` | `sliderShockSpeed` | SPEED | 0.0290 | claim_met | temporalRate 0.0026/0.0029/0.0031/0.0033/0.0035 (ratio 1.35, mono 1); temporalFreq ratio 1.29, mono 1 |
| TRUE | `party_dancers/01_dom_ball_dancers` | `sliderLocalSpeed` | SPEED | 0.0288 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0001 (ratio 3.04, mono 0); temporalFreq ratio 4662.00, mono 1 |
| TRUE | `03_dual_axis_crush` | `sliderKick` | MAGNITUDE | 0.0281 | claim_met | dominant mover rMean 0.0281 |
| TRUE | `summer_camp/112_logsville_giant_call_response` | `sliderAudioBass` | MAGNITUDE | 0.0278 | claim_met | dominant mover contrastRatio 0.0278 |
| TRUE | `summer_camp/80_tree_canopy_fracture` | `sliderBlackoutDepth` | DARKNESS | 0.0275 | claim_met | litFraction swing 0.0134 ratio 1.33 (via ratio), monotonic -1 (expected falling) |
| TRUE | `44_biolume_swell` | `sliderSparkle` | MAGNITUDE | 0.0273 | claim_met | dominant mover litFraction 0.0273 |
| TRUE | `summer_camp/75_timber_mill_clockwork` | `sliderBoilerHeat` | MAGNITUDE | 0.0268 | claim_met | dominant mover aMean 0.0268 |
| TRUE | `12_breathing` | `sliderBreathDepth` | MAGNITUDE | 0.0264 | claim_met | dominant mover contrastRatio 0.0264 |
| TRUE | `summer_camp/40_ghost_ship_reveal` | `sliderBeaconSparkle` | MAGNITUDE | 0.0261 | claim_met | dominant mover driftZ 0.0261 |
| TRUE | `summer_camp/51_abyssal_searchlight` | `sliderBeamWidth` | SPATIAL | 0.0260 | claim_met | spatialFreqX swing 0.0260, monotonic -1 |
| TRUE | `summer_camp/73_tree_shadow_breath` | `sliderEdgeShimmer` | MAGNITUDE | 0.0257 | claim_met | dominant mover temporalFreq 0.0257 |
| TRUE | `44_biolume_swell` | `sliderKick` | MAGNITUDE | 0.0256 | claim_met | dominant mover litFraction 0.0256 |
| TRUE | `ambient_extra/19_split_lens` | `sliderSafetyFloor` | MAGNITUDE | 0.0254 | claim_met | dominant mover spatialFreqZ 0.0254 |
| TRUE | `summer_camp/52_iceberg_shear_line` | `sliderShearWidth` | SPATIAL | 0.0254 | claim_met | spatialFreqX swing 0.0254, monotonic -1 |
| TRUE | `summer_camp/46_dome_lockdown` | `sliderLocalSpeed` | SPEED | 0.0252 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0001 (ratio 4.40, mono 1); temporalFreq ratio 3496.50, mono 0 |
| TRUE | `baby/59_boy_cathedral_ribs` | `sliderArchHeight` | SPATIAL | 0.0250 | claim_met | edgeSharpnessX swing 0.0250, monotonic -1 |
| TRUE | `33_aurora_breath` | `sliderShimmer` | MAGNITUDE | 0.0241 | claim_met | dominant mover rMean 0.0241 |
| TRUE | `64_temple_warm_white` | `sliderKick` | MAGNITUDE | 0.0238 | claim_met | dominant mover wMean 0.0238 |
| TRUE | `summer_camp/52_iceberg_shear_line` | `sliderLocalSpeed` | SPEED | 0.0230 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0000 (ratio 17.79, mono 1); temporalFreq ratio 0.00, mono 0 |
| TRUE | `summer_camp/45_engine_room_clockwork` | `sliderDriveShaft` | MAGNITUDE | 0.0223 | claim_met | dominant mover spatialFreqX 0.0223 |
| TRUE | `summer_camp/111_logsville_giant_pixel_heartbeat` | `sliderVintageMix` | MAGNITUDE | 0.0221 | claim_met | dominant mover contrastRatio 0.0221 |
| TRUE | `ambient_extra/27_rolling_shutters` | `sliderDirection` | DIRECTION | 0.0217 | claim_met | launch driftY -0.0008/-0.0008/-0.0022/-0.0022/-0.0022 (ends -0.0008 → -0.0022, floor ±0.004); velocity-series correlation low↔high -0.991 (reversal at ≤ -0.3) [via anticorrelated_motion] |
| TRUE | `summer_camp/45_engine_room_clockwork` | `sliderPauseAmount` | MAGNITUDE | 0.0217 | claim_met | dominant mover spatialFreqX 0.0217 |
| TRUE | `14_lunar_current` | `sliderShimmer` | MAGNITUDE | 0.0217 | claim_met | dominant mover edgeSharpnessX 0.0217 |
| TRUE | `baby/74_girl_cathedral_ribs` | `sliderArchHeight` | SPATIAL | 0.0217 | claim_met | edgeSharpnessX swing 0.0217, monotonic -1 |
| TRUE | `21_pelagic_manta_rays` | `sliderWhiteFoam` | WHITE | 0.0216 | claim_met | wMean swing 0.0101 ratio 10108.88 (via absolute, threshold 0.01) |
| TRUE | `19_swaying_lattice_ballet` | `sliderWhiteSpread` | WHITE | 0.0201 | claim_met | wMean swing 0.0110 ratio 1.65 (via absolute, threshold 0.01) |
| TRUE | `ambient_extra/50_last_lantern` | `sliderLocalSpeed` | SPEED | 0.0140 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0002 (ratio 10.01, mono 1); temporalFreq ratio 3.00, mono 0 |
| TRUE | `summer_camp/45_engine_room_clockwork` | `sliderLocalSpeed` | SPEED | 0.0133 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0000/0.0000 (ratio 14.94, mono 1); temporalFreq ratio 0.00, mono 0 |
| TRUE | `11_bioluminescence` | `sliderWhiteSpeed` | SPEED | 0.0120 | claim_met | temporalRate 0.0046/0.0048/0.0050/0.0057/0.0069 (ratio 1.49, mono 1); temporalFreq ratio 1.26, mono 1 |
| TRUE | `28_spectrum_bloom` | `sliderLocalSpeed` | SPEED | 0.0106 | claim_met | temporalRate 0.0000/0.0000/0.0000/0.0001/0.0001 (ratio 19.42, mono 1); temporalFreq ratio 0.00, mono 0 |
