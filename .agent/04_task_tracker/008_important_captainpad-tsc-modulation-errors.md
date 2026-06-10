# CaptainPad tsc fails on Modulation.tsx transitionDuration

- **ID:** 008
- **Priority:** IMPORTANT
- **Status:** OPEN
- **Source:** .agent/02_reports/202606/20260610_1_group_fixed_colors.md
- **Location:** CaptainPad/components/Modulation.tsx:184, :206
- **Created:** 2026-06-10
- **Updated:** 2026-06-10

## Description
`npx tsc --noEmit` fails on origin/main with two TS2353 errors:
`'transitionDuration' does not exist in type 'ViewStyle'` at
Modulation.tsx:184 and :206. `transitionDuration` is a react-native-web
extension that the react-native ViewStyle typings don't know about.

## Suggested fix
Either move the web-only transition style behind a typed cast scoped to
those two style objects (with a comment naming react-native-web as the
reason), or drop the CSS transition and animate with `Animated` so the
style typechecks on all platforms.

## Why it matters
`.agent/00_gol/03_captain_pad_auto_checks.md` makes "tsc must exit 0" the
merge gate. While these errors stand, every branch fails the gate for
reasons unrelated to its own diff, training agents and humans to ignore
the gate output.

## Notes
Observed while verifying `feature/group-fixed-colors`, which touches
neither file. Zero tsc errors in that branch's touched files.
