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

### MERGE 3 — dev/engine_hotswap_mixer (E1, slot 0) — VERIFIED ON MERGED TIP
Boundary: pattern_mixer.js, api_server.js, playlist_manager.js modified + 4
additive tests + report. No overlap with merged tip (state_manager/CaptainPad).
Two reconciliations by instigator on the merged tip (union-of-intent):
1. **E3's `blend_fallback_presence.test.js`** documented the OLD silent-null
   behavior with a TODO "assert loud-fail once the fix lands". E1 landed the
   fix (renderHealth). Rewrote the test: real `compile()` stub (E1's
   patternsDir setter now precompiles), assert missing blend flips
   `renderHealth.ok=false` + names the mode. Net +1 test.
2. **Pre-existing fixture bug** (E1 flagged it): `states/test_bench/
   deck_state.yaml` pointed the deck at deleted pattern `29_bar_dancers`
   (absent from `--list`, last touched PR #22) → fresh boot = dead deck →
   all deck endpoints 404. Repointed to `test_const` (one-line fixture fix).
Verified on merged tip:
```
$ git diff --check -- marsin_engine                        → DIFFCHECK_OK
$ node --check {3 lib + 4 test files}                      → all OK
$ node engine.js --list                                    → 60 patterns
$ dry-run                                                  → exit 0, no missing-blend warning
$ node --test "tests/*.test.js"                            → 802 pass / 0 fail
$ /status renderHealth                                     → {ok: true, frame: 11, blendErrors: []}
$ deck/channel at boot (post fixture fix)                  → pattern test_const, id ch_base_…
$ ENGINE_PORT=31068 node tests/hil/hil_playlist_hotswap_test.mjs
  → 17/17 assertions passed, HIL_EXIT=0 (before fixture fix: 9/17 — all 8
    failures were 404/null deck assertions caused by the dead-deck fixture)
  states/test_bench residue: only the intentional deck_state pattern fix; summer_camp_dome runtime churn restored
```
Content: boot blend precompile (19 handles warm, lazy compile off hot path);
fail-loud render-health on /status; PlaylistLoadError on malformed YAML;
NaN durationMs rejected 400; centralized VALID_CHANNEL_BLEND_MODES; hot-swap
`POST /deck/playlist/swap` + mixer mirror + precompileNextDeckEntry. Merge
commit: see git log. Known follow-up: full handle pooling (documented by E1).

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
