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

(appended per merge)
</content>
