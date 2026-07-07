# Format + Lint Pass: dev/summer_camp_readiness
_Generated 2026-05-27_

## Summary
- Subprojects audited: CaptainPad, marsin_engine, simulation, control_podium/PortWatch
- Files auto-fixed: 3 (all in CaptainPad)
- Residual lint warnings (not auto-fixable): 13 (all in CaptainPad, all pre-existing)
- Residual type errors (report only): 0
- Tools skipped (not installed / not blessed): none — every command the four governance docs bless was run successfully

## Per-subproject results

### CaptainPad
- Governance: `.agent/00_gol/03_captain_pad_auto_checks.md`
- Commands run:
  - `npx tsc --noEmit` → exit 0, clean
  - `npm run lint` (= `expo lint`) → exit 0, 18 warnings (0 errors), 5 marked autofixable
  - `npx expo lint -- --fix` → applied 5 fixes; rerun produced 13 warnings
- Files changed (3):
  - `CaptainPad/app/(tabs)/osc.tsx` — two `Array<T>` → `T[]` (lines 33, 156)
  - `CaptainPad/components/EntryLabelEditor.tsx` — one `Array<T>` → `T[]` (line 112)
  - `CaptainPad/components/GlobalEffectMacros.tsx` — `import/first` autofix: the `VISIBLE_SLOT_COUNT` const and its preceding doc comment (which were wedged between two `import` blocks at lines 47–53) were moved below the second import block to satisfy `import/first`. No behavior change — constant is still file-scope and assigned at module load. Comment travelled with the const so its meaning is preserved.
- Residual findings (all pre-existing warnings, not autofixable, intentionally left):
  - `app/(tabs)/_layout.tsx:7` — `'Colors' is defined but never used`
  - `app/(tabs)/_layout.tsx:85` — `'colorScheme' is assigned a value but never used`
  - `app/(tabs)/audio.tsx:1256` — `useCallback` missing dep `setCfg`
  - `app/(tabs)/audio.tsx:1300` — `useCallback` missing dep `setCfg`
  - `app/(tabs)/config.tsx:49` — `useEffect` missing deps `handleTestConnection`, `ip`
  - `app/(tabs)/dimmer_rack.tsx:7` — `'setGlobalBlackout' is defined but never used`
  - `app/(tabs)/mixer.tsx:676` — `useCallback` missing dep `setInlinePlaylist`
  - `app/(tabs)/mixer.tsx:860` — `'fader' is assigned a value but never used`
  - `app/(tabs)/monitor.tsx:2` — `'TouchableOpacity' is defined but never used`
  - `app/(tabs)/studio.tsx:26` — `useEffect` missing dep `loadPatterns`
  - `components/GlobalEffectMacros.tsx:238` — stale ref in cleanup (`optimisticTimersRef.current`)
  - `components/NauticalFader.tsx:37` — `useEffect` missing deps `initialValue`, `max`, `maxTravel`, `min`, `panY`
  - `components/ui/HorizontalFader.tsx:14` — `useEffect` missing dep `animVal`
- Notes: `web:build` was not run because no route/Metro/asset/YAML/web-visible UI files were touched by the autofixer.

### marsin_engine
- Governance: `.agent/00_gol/05_marsin_engine_auto_checks.md`
- Commands run:
  - `git diff --check -- marsin_engine marsin_pb` → exit 0, clean
  - `node --check` across all 197 `*.js|*.mjs|*.cjs` files under `marsin_engine/` (excluding `node_modules/`) → 0 failures
  - `cd marsin_engine && node engine.js --list` → exit 0, 62 patterns enumerated
  - `cd marsin_engine && node engine.js --pattern test_const --model test_bench --dry-run` → exit 0, no missing-blend-script warnings; final line `Test render pixel 0: RGBWAU(0, 0, 0, 0, 0, 0)`
- Files changed: 0
- Residual findings: none introduced by this pass. (The HIL transition test was not run because no mixer/blend behavior changed; per governance it is gated on those changes.)

### simulation
- Governance: `.agent/00_gol/04_sim_auto_checks.md`
- Commands run:
  - `git diff --check -- simulation` → exit 0, clean
  - `node --check` across all 56 `*.js|*.mjs|*.cjs` files under `simulation/` (excluding `node_modules/` and `unreal/`) → **1 failure** (see Notes below — UTF-16 encoded file, treated as report-only)
  - `cd simulation && npm run test` (`node --test tests/fog_regression.test.js`) → exit 0, 2 pass / 0 fail
- Files changed: 0
- Residual findings:
  - `simulation/debug_fog.js` is encoded as UTF-16 LE with a BOM and CRLF line endings (intended content is `window._debugFogCount = 0;`). `node --check` rejects it with `SyntaxError: Invalid or unexpected token`. This is a real bug, not a style nit, and is flagged in Notes for separate handling.

### control_podium/PortWatch
- Governance: no `.agent/00_gol/*_port_watch_auto_checks.md` exists, so only the obvious parallel to CaptainPad was run.
- Commands run:
  - `npm run typecheck` (`tsc --noEmit`) → exit 0, clean
- `npm run test` (`vitest run`) was **not run** because no governance doc blesses it as a merge gate; per the hard rule "use only what governance blesses." Suggest adding a PortWatch auto-checks doc.
- Files changed: 0
- Residual findings: none observed under the run command.

## Residual issues for human review
- The 13 CaptainPad lint warnings listed above are pre-existing and were not auto-fixable. Most are React hooks `exhaustive-deps` and unused-symbol warnings — each requires a behavioral judgment (add the dep, remove the value, suppress with reason) and the governance doc explicitly says: "Existing warnings may be left only when the human explicitly accepts them."
- `simulation/debug_fog.js` UTF-16 encoding bug — see Notes.
- No type errors anywhere.

## Notes / surprises
- **simulation/debug_fog.js is UTF-16 LE with BOM.** `file(1)` confirms `Unicode text, UTF-16, little-endian text, with CRLF line terminators`. Hex of first 32 bytes:
  ```
  fffe 7700 6900 6e00 6400 6f00 7700 2e00
  5f00 6400 6500 6200 7500 6700 4600 6f00
  ```
  Decoded content is just `window._debugFogCount = 0;`. This file is unreachable by any normal JS loader and almost certainly the result of a PowerShell `>` redirect on Windows. **Not fixed** — flagged for separate task per the "real bugs are out of scope" rule.
- The `expo lint --fix` autofix on `GlobalEffectMacros.tsx` moved a comment + const declaration past an import block. The semantics are identical (ES module imports hoist regardless of declaration order) but the diff is larger than a pure-whitespace fix would be. Reviewed by hand and confirmed safe.
- Simulation's test runner prints a `MODULE_TYPELESS_PACKAGE_JSON` warning recommending `"type": "module"` in `simulation/package.json`. Not changed — that would be a config behavior decision, not a format nit.
- PortWatch lacks a `.agent/00_gol/*_auto_checks.md` doc. Following the precedent of the other three subprojects, one should be added. Out of scope for this pass.

## Verification
- Final `git status`:
  ```
   M CaptainPad/app/(tabs)/osc.tsx
   M CaptainPad/components/EntryLabelEditor.tsx
   M CaptainPad/components/GlobalEffectMacros.tsx
  ?? .agent/00_gol/14_task_tracking.md
  ?? .agent/02_reports/202605/20260527_1_code_review.md
  ?? .agent/04_task_tracker/
  ```
  (Untracked entries were already present at the start of this session — not produced by this pass.)
- Final `git diff --stat`:
  ```
   CaptainPad/app/(tabs)/osc.tsx                |  4 ++--
   CaptainPad/components/EntryLabelEditor.tsx   |  2 +-
   CaptainPad/components/GlobalEffectMacros.tsx | 16 ++++++++--------
   3 files changed, 11 insertions(+), 11 deletions(-)
  ```
- Post-fix re-check on CaptainPad: `npx tsc --noEmit` exit 0; `expo lint` exit 0 with 13 residual warnings (down from 18). Nothing else was touched.
