# audio_config.test.js AUDIO_LIVE_FIELDS contract test is stale

- **ID:** 009
- **Priority:** NORMAL
- **Status:** OPEN
- **Source:** .agent/02_reports/202606/20260610_1_group_fixed_colors.md
- **Location:** marsin_engine/tests/audio_config.test.js:160
- **Created:** 2026-06-10
- **Updated:** 2026-06-10

## Description
`node --test 'tests/*.test.js'` fails 1/506 on origin/main: the
"AUDIO_LIVE_FIELDS is the contract surface" test's expected object is
missing the `kickEma` group (`alphaUp`, `alphaDown`, `trailAlpha`,
`ceilingRatio`, `warmupHops`) that the live `AUDIO_LIVE_FIELDS` now
exposes.

## Suggested fix
Decide whether `kickEma` is intentionally part of the live-tunable
contract. If yes, add it to the test's expected structure; if no, remove
it from `AUDIO_LIVE_FIELDS`. The test exists precisely to force this
decision — don't blindly sync it.

## Why it matters
A permanently red test teaches everyone to ignore the engine suite's
exit code, which hides real regressions.

## Notes
Pre-existing on origin/main @ e1db156; observed while running the full
suite for `feature/group-fixed-colors` (which passes its own 13 tests).
