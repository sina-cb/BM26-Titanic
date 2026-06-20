# 20260620 — Channels Campaign Verification Log (PROOF)

> Every "done" item needs REAL proof here: exact commands + numeric output +
> captures. "Tests pass" with no numbers is not proof.

## Baselines (origin/main == claude/bm26-channels-optimization-9ok9d3, ada12f0)

### Engine
```
$ node engine.js --list        → 60 pattern(s) found  [exit 0]
$ node engine.js --pattern test_const --model test_bench --dry-run
  ✅ Model loaded: 52 pixels (2 special effects)
  ✅ Pattern compiled via MarsinCompiler (bytecode)
  ✅ Shared DMX mapper: 52/52 pixels patched across 2 universe(s)
  🏁 Dry run complete.   [DRYRUN_EXIT=0, no missing-blend warning]
$ node --test "tests/*.test.js"
  # tests 760  # pass 760  # fail 0   [duration ~6.1s]
```

### CaptainPad
```
$ npx tsc --noEmit             → TSC_EXIT=0
$ npm run lint                 → ✖ 12 problems (0 errors, 12 warnings) [exit 0]
   (pre-existing warnings: PlaylistPanel.tsx:459, ScheduledTaskRow.tsx:130,
    HorizontalFader.tsx:14, TimerWheel.tsx:233, + others — accepted baseline)
```

## Merge proofs

### MERGE 1 — dev/engine_state_hardening (E3, slot 2) — VERIFIED ON MERGED TIP
Boundary: only `lib/state_manager.js` modified + 4 additive test files + report.
Verified in main checkout on merged tip (pre-commit):
```
$ git diff --check -- marsin_engine                        → DIFFCHECK_OK
$ node --check {state_manager.js + 4 test files}           → all ok
$ node engine.js --list                                    → 60 pattern(s) found
$ node engine.js --pattern test_const --model test_bench --dry-run
  🏁 Dry run complete.   DRYRUN_EXIT=0 (no missing-blend warning)
$ node --test "tests/*.test.js"                            → 787 pass / 0 fail
$ ENGINE_PORT=31268 node tests/hil/hil_concurrent_entry_test.mjs (live engine)
  → 7/7 assertions passed, HIL_EXIT=0; states/test_bench residue: clean (restored)
```
Content: atomic temp+fsync+rename state writes; `serializeChannel()` de-dup
(byte-compatible on disk); +27 tests (atomicity 14, invariants 10,
blend-fallback-presence 5 doc-only, HIL concurrent 7). Backward-compatible
state_manager (no export/signature removed). Merge commit: 45dd556.

### MERGE 2 — dev/captainpad_views (C2, slot 1) — VERIFIED ON MERGED TIP
Boundary: CaptainPad only — index.tsx, mixer.tsx, PlaylistPanel.tsx, api.ts
modified + new ConfirmSheet.tsx, ChannelVizStrip.tsx, useEngineConnection.ts +
report. No engine files touched.
Verified in main checkout on merged tip (pre-commit):
```
$ git diff --check -- CaptainPad                           → DIFFCHECK_OK
$ npx tsc --noEmit                                         → TSC_EXIT=0
$ npm run lint                                             → 0 errors / 12 warnings (baseline held, no new)
$ npm run web:build                                        → WEBBUILD_EXIT=0, dist exported, 21 routes
   ((tabs)/mixer 49.7kB and (tabs) deck 74.2kB both bundled)
```
Content: ConfirmSheet for destructive channel-delete + playlist-entry-remove
(no silent destructive taps); ≥44pt touch targets (hitSlop) on mixer icon
buttons + deck ◎ALL; ChannelVizStrip self-subscribes so viz frames no longer
reconcile the strip list (React.memo holds); shared useEngineConnection hook
de-dups deck/mixer boot/subscribe/teardown; typed fetchMixerState (hard-fails
non-2xx instead of silent ok). Merge commit: see git log.
</content>
