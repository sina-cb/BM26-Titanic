# Crisp final art and validation

## Outcome

The Titanic and test-bench Crisp playlists remain the same six entries with
byte-identical saved values. `01_orbiting_circle` keeps its approved orbital
composition with its reset seam removed. `02_dimensional_slicer` is now a
sparse rotating/folding stack of engraved razor slabs, visibly distinct from
01. `03_magnetic_field_collision` remained operator-locked. `06`, `08`, and
`10` keep their approved identities with default-centered control response and
narrow periodic-coordinate repairs.

The final offline review gallery is:

`docs/pattern_gallery/playlists/titanic/crisp/index.html`

It contains 10-second saved-value autoplay clips, labelled operator-position
LEFT FRONT / LEFT BACK / RIGHT FRONT / RIGHT BACK coverage clips, and a
22.5-second min/mid/max sweep covering all six controls for every keeper.

## Exact saved-value lock

The Titanic and test-bench playlist files are byte-identical:

- SHA-256: `0a66a055044e03827a9de9d6f2eb1f556cc609cd82de70429c567f630b9ee64d`
- no playlist default was changed
- review state is `KEEP` for 01, 03, 06, 08, and 10; 02 remains
  `READY FOR OPERATOR`

## Seam proof

The 01 reset came from non-integral detail multipliers (`1.3`, `1.1`, `1.7`)
being evaluated on a clock that reset at 1, plus signed `frac()` inputs whose
negative remainder was not periodic. A separate congruent detail clock and
positive integer cycle offsets fix the cause without a fade, blackout, floor,
or fallback.

01 story-wrap before -> after, boundary mean full-scale delta / immediate-next
ratio:

| Model / speed | Before | After |
|---|---:|---:|
| Titanic / 0 | `0.099626 / 1.977x` | `0.056639 / 1.128x` |
| Titanic / 0.3 | `0.102722 / 1.923x` | `0.060951 / 1.148x` |
| Titanic / 1 | `0.128985 / 1.929x` | `0.099060 / 1.472x` |
| test_bench / 0 | `0.054831 / 3.621x` | `0.018238 / 1.201x` |
| test_bench / 0.3 | `0.055280 / 3.268x` | `0.019466 / 1.146x` |
| test_bench / 1 | `0.066383 / 1.721x` | `0.041696 / 1.030x` |

The deterministic regression samples the last in-flight frame, wrap boundary,
natural next frame, and one full unit of ordinary in-flight motion on both
models at speed 0, saved 0.3, and speed 1. Worst final boundary / natural-motion
envelope ratios are: 01 `0.793x`, 02 `0.992x`, 03 `0.558x`, 06 `0.929x`, 08
`0.879x`, and 10 `0.492x`. No keeper has positive large-jump excess at its
worst mean boundary.

## Control truth, distinction, and performance

- Titanic: `TRUE 36`, `WEAK 0`, `WRONG 0`, `DEAD 0`, `UNKNOWN_CLAIM 0`.
- test_bench: `TRUE 36`, `WEAK 0`, `WRONG 0`, `DEAD 0`, `UNKNOWN_CLAIM 0`.
- 01 vs 02 median endpoint-class separation: `0.624` against the `0.300` gate.
- Slowest Titanic keeper: 10 at `2.2678 ms` mean, `5.9711 ms` p99, or `23.88%`
  of the 25 ms frame budget.
- Every other Titanic keeper is below `4.71 ms` p99; every test-bench keeper is
  below `1.44 ms` p99.

## Model coverage

The machine census names all 24 current regions and fails on count, fixture,
bounds, sign-index, normalization, or membership drift. Saved, 0.2, and 0.8
scenarios require meaningful light and animation in every intended region on
Titanic and every portable role on test_bench. Four-wall evidence is ordered
by physical operator position, not legacy scene LEFT/RIGHT strings; current
`Right Front Wall` is the physical LEFT FRONT wall.

The canonical `docs/TITANIC_MODEL.md` was completed by its temporary specialist
and consumed after handoff. This work did not edit or regenerate that file or
`docs/MARSIN_ENGINE_PATTERNS.md` after the coordination boundary.

## Scoped files

Pattern sources:

- `marsin_engine/patterns/crisp/01_orbiting_circle.js`
- `marsin_engine/patterns/crisp/02_dimensional_slicer.js`
- `marsin_engine/patterns/crisp/06_impossible_corridor.js`
- `marsin_engine/patterns/crisp/08_topology_knot.js`
- `marsin_engine/patterns/crisp/10_geometric_echo.js`
- `marsin_engine/patterns/crisp/region_intent.json`

03 was not edited during the operator-lock phase.

Tools and metadata:

- `marsin_engine/tools/crisp_seam_audit.mjs`
- `marsin_engine/tools/crisp_quality_audit.mjs`
- `marsin_engine/tools/titanic_model/regions.mjs`
- `marsin_engine/tools/titanic_model/coverage.mjs`
- `marsin_engine/tools/titanic_model_census.mjs`
- `marsin_engine/tools/playlist_gallery/generate.mjs`
- `marsin_engine/tools/playlist_gallery/pattern_goals.json`

Focused tests:

- `marsin_engine/tests/patterns/crisp_seam_continuity.test.mjs`
- `marsin_engine/tests/patterns/titanic_model_coverage.test.mjs`
- `marsin_engine/tests/patterns/playlist_gallery_tool.test.mjs`
- existing `marsin_engine/tests/patterns/crisp_contract.test.js`

Generated evidence:

- `docs/pattern_gallery/playlists/titanic/crisp/`
- `docs/pattern_gallery/index.html`
- `docs/pattern_gallery/README.md`

## Final checks

- Crisp contract: 5/5 pass.
- Coverage, seam, gallery, and operator-orientation suite: 19/19 pass.
- Audio modulation contract: 16/16 pass.
- Exact endpoint RGB-or-black discipline, W=A=U=0, negative-space bounds,
  Vintage darkness, sparse PAR staging, paired/dynamic TE signs, maximum-speed
  activity, saved-look uniqueness, source/manifest/playlist resolution, and
  both-model region activity all pass.
- No services, ports, live state, sACN, deployment, engine internals, or git
  operations were used.
