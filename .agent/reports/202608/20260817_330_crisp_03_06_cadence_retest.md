# Crisp 03/06 cadence retest handoff

## Outcome

Only `crisp/03_magnetic_field_collision` and
`crisp/06_impossible_corridor` changed visually. Their approved geometry,
endpoint colors, fixture staging, exposed controls, slider order, and saved
playlist values remain fixed. Their story clocks were slowed for the reported
64% global-speed condition:

- 03: `0.08 + speedMultiplier * 0.06` became
  `0.05 + speedMultiplier * 0.04`.
- 06: `0.06 + localMultiplier * 0.22` became
  `0.04 + localMultiplier * 0.14`.

At saved local speed 0.30 this is a 36.3% clock reduction for 03 and a 35.4%
clock reduction for 06. The Titanic/test-bench Crisp playlist files remain
byte-identical with SHA-256
`0a66a055044e03827a9de9d6f2eb1f556cc609cd82de70429c567f630b9ee64d`.

01, 02, 08, and 10 were not edited and are recorded as operator-locked. 03 and
06 remain in `TUNE` until Sina tests this cadence. Neither pattern was added to
`ambient` or `ambient_sound_reactive`; approval is the promotion gate.

## Measured 64% bar cadence

The audit samples `ShehdsBar` pixels at 40 fps for 18 seconds using saved
controls and global speed 0.64.

| Pattern | Model | Mean RGB delta before | After | Reduction | Changed pixels before | After |
|---|---|---:|---:|---:|---:|---:|
| 03 | Titanic | 0.01719 | 0.01109 | 35.5% | 25.74% | 20.16% |
| 03 | test_bench | 0.01372 | 0.00917 | 33.2% | 18.54% | 16.26% |
| 06 | Titanic | 0.01031 | 0.00647 | 37.3% | 15.65% | 12.34% |
| 06 | test_bench | 0.01220 | 0.00713 | 41.6% | 17.76% | 11.93% |

## Validation

- Focused Node tests: 15/15 pass. This includes exact endpoint/black output,
  all Titanic roles, complementary TE signs, maximum-speed activity, pairwise
  distinction, saved/min/max wrap continuity, named-region coverage, and the
  parameter-truth smoke suite.
- Parameter truth, Titanic: 12 TRUE, 0 WEAK/WRONG/DEAD/UNKNOWN.
- Parameter truth, test_bench: 12 TRUE, 0 WEAK/WRONG/DEAD/UNKNOWN.
- Seam audit: all 03/06 saved/min/max checks pass on both models. Mean boundary
  excess ratios remain below 1.0; large-jump excess is never positive.
- Titanic p99 render time: 03 `2.562 ms` (10.2% of budget), 06 `3.587 ms`
  (14.3%). Test-bench p99 remains below `0.85 ms`.
- 03-vs-06 endpoint-class separation is `0.662`.
- Focused 20-second 64% captures and all four Hull-wall contact sheets were
  inspected. Both remain continuously active with deliberate negative space
  and balanced wall reach.

## Files

Pattern sources:

- `marsin_engine/patterns/crisp/03_magnetic_field_collision.js`
- `marsin_engine/patterns/crisp/06_impossible_corridor.js`

Scoped validation and metadata:

- `marsin_engine/tools/crisp_cadence_audit.mjs`
- `marsin_engine/tools/crisp_seam_audit.mjs`
- `marsin_engine/tools/titanic_model/coverage.mjs`
- `marsin_engine/tools/param_truth/render_context.js`
- `marsin_engine/tools/param_truth/sweep.js`
- `marsin_engine/tests/patterns/crisp_contract.test.js`
- `marsin_engine/tests/patterns/titanic_model_coverage.test.mjs`
- `marsin_engine/tools/playlist_gallery/pattern_goals.json`
- `.agent/context/now.md`

Review gallery:

- `docs/pattern_gallery/playlists/titanic/crisp/index.html`
- 20 seconds, 8 fps, 64% global clock, current saved playlist values.
- Includes overview, explicit four-wall coverage, and parameter-sweep media.

## Operator retest

Set global speed to 64%, then compare 03 and 06 on the physical bar walls.
Confirm the new cadence reads smoothly without feeling static and that the
approved compositions still feel unchanged. After explicit approval, add both
entries to Titanic and test-bench `ambient` and `ambient_sound_reactive`,
preserving their exact saved Crisp values and retaining membership.
