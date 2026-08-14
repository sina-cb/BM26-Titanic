# Parameter truth sweep

Model `titanic` (964 px) · 144 frames after 36 warmup · sweep points 0, 0.25, 0.5, 0.75, 1

Patterns swept 1 · compile errors 0 · no params 0 · params measured 9

| Class | Count |
|---|---:|
| WRONG | 0 |
| DEAD | 0 |
| WEAK | 0 |
| UNKNOWN_CLAIM | 0 |
| TRUE | 9 |

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

## Findings, worst first

| Verdict | Pattern | Param | Family | Effect | Reason | Evidence |
|---|---|---|---|---:|---|---|
| TRUE | `14_lunar_current` | `sliderDirection` | DIRECTION | 0.7250 | claim_met | launch driftY 0.1244/0.0959/-0.0227/-0.1125/-0.1248 (ends 0.1244 → -0.1248, floor ±0.004); velocity-series correlation low↔high 0.006 (reversal at ≤ -0.3) [via net_travel] |
| TRUE | `14_lunar_current` | `sliderLevel` | BRIGHTNESS | 0.5346 | claim_met | lumaMean swing 0.0431 ratio 24.28 (via absolute), monotonic 1 |
| TRUE | `14_lunar_current` | `sliderDensity` | SPATIAL | 0.2180 | claim_met | spatialFreqY swing 0.2180, monotonic 0 [non-monotonic] |
| TRUE | `14_lunar_current` | `sliderUvLift` | UV | 0.1098 | claim_met | uvMean swing 0.0710 ratio 70993.74 (via absolute, threshold 0.01) |
| TRUE | `14_lunar_current` | `sliderLocalSpeed` | SPEED | 0.1087 | claim_met | temporalRate 0.0002/0.0004/0.0008/0.0017/0.0034 (ratio 15.00, mono 1); temporalFreq ratio 4.59, mono 1 |
| TRUE | `14_lunar_current` | `sliderShimmer` | MAGNITUDE | 0.0706 | claim_met | dominant mover contrastRatio 0.0706 |
| TRUE | `14_lunar_current` | `sliderRadius` | SPATIAL | 0.0646 | claim_met | spatialFreqY swing 0.0646, monotonic 0 [non-monotonic] |
| TRUE | `14_lunar_current` | `sliderKick` | MAGNITUDE | 0.0341 | claim_met | dominant mover spatialFreqZ 0.0341 |
| TRUE | `14_lunar_current` | `sliderWhiteLift` | WHITE | 0.0295 | claim_met | wMean swing 0.0030 ratio 3003.35 (via ratio, threshold 0.01) |
