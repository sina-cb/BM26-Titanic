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

## FULL-STACK SMOKE + SCREENSHOTS (2026-06-20, merged tip feat/optimize_channels)

Ran skill 05 chain on default ports (engine 6968 / sim 6969-6972 / CaptainPad 6967).
- Engine boot (model test_bench): renderHealth.ok=true at frame 6004+, unrealState=streaming.
- Live API exercised: PATCH /deck, POST /deck/playlist/entry (advanced deck default→09_cyclone),
  POST /mixer/channels x2 (10_chasers, 13_sparkle @ fader 1), POST /mixer/view.
- Engine log on shutdown: "[sACN Out] Sender stopped after 9256 frames" → engine WAS
  streaming sACN to the sim (engine→sim link real).
- Screenshots (in .agent_renders/, visually inspected):
  - smoke_captainpad_deck.png — DECK ● CONNECTED, model test_bench, MASTER 100, live
    BPM 128 + audio bars, deck viz strip, full playlist + **✕ SWAP hot-swap button**, autopilot,
    DECK TX, param sliders.
  - smoke_captainpad_mixer2.png — MIXER ● CONNECTED, 3 live channel strips each with
    **per-channel ✕ SWAP**, LEVEL faders (0/100/100), local params, MUTE/SOLO, TRANSITION/
    CROSSFADE, per-channel viz strips (ChannelVizStrip from C2).
  - smoke_cyclone_1.png — sim test_bench rendered LIT (green cyclone wash on par/bar/vintage
    fixtures + ground pool); frame sizes differ frame-to-frame (animation).
  - smoke_testbench_ui_1/2.png — earlier (deck on test_const = black-at-defaults; correct).
  - smoke_captainpad_mixer.png — bonus: OFFLINE state shows graceful degradation
    ("Failed to fetch" / "NO CHANNELS").
- NOTE: the engine background process was repeatedly reaped by the harness ~60-70s after
  launch (SIGTERM → clean "Stopping…" exit 0) when subsequent foreground commands ran; this
  is a HARNESS lifecycle artifact, NOT an engine bug — running engine+capture in a single
  command kept it alive fine. Tracked states/test_bench + models/test_bench.* residue from the
  smoke was restored from snapshot (not committed).

## Merge proofs

### MERGE 8 — dev/channels_docs (WAVE 7b) — docs/39_channels_deck_mixer.md (renumbered
38->39 to avoid feat/timeline_support collision). Markdown-only, diff-check clean.
Merge commit 8b20697.

### MERGE 9 — dev/audit_nits (WAVE 8) — VERIFIED ON MERGED TIP
Boundary: mixer.tsx, PlaylistPanel.tsx, hil_deck_swap_response_test.mjs + report.
```
$ CaptainPad: tsc 0 / lint 0 err·12 warn (baseline) / web:build 0 · 21 routes
$ git diff --check (engine+CaptainPad) → clean
$ node --test "tests/*.test.js" → 829 pass / 0 fail
$ hil_deck_swap_response_test.mjs (ENGINE_PORT honored) → 10/10, exit 0
  states clean
```
Content (audit P2 nits): N1/F4 remaining updateMixerChannel sites honor res.ok
(MODE/lock revert+Alert, name/fader-lock/transition revert+log); N2/F2 client
handles WS channelFaderRejected/channelModeRejected (revert + refetch); N4/F5 HIL
honors ENGINE_PORT; N5/F7 swapInFlightRef same-tick guard. DEFERRED: N3/F1 pill
health surfacing (needs api.ts+engineBus.ts+useEngineConnection.ts+DeckTopBar.tsx
— 4 unowned files; /status already exposes the signals). Merge commit: see git log.

### MERGE 7 — dev/regression_fixes (WAVE 6) — VERIFIED ON MERGED TIP
Boundary: api_server.js, PlaylistPanel.tsx + 2 additive tests + report.
```
$ git diff --check (engine + CaptainPad)   → clean
$ node engine.js --list                    → 60 patterns; dry-run exit 0, no missing-blend
$ node --test "tests/*.test.js"            → 829 pass / 0 fail (+6)
$ node tests/hil/hil_deck_swap_response_test.mjs (engine :6968) → 10/10, exit 0
   (proves mid-fade targetEntryId b_one ≠ stale playlist.activeEntryId a_one)
$ FIX-A keep-lit: bogus deck pattern → engine BOOTS (not dark), deck not null
   (fell back to test_const), /status.deckRestoreDegraded populated, loud log
$ CaptainPad: tsc 0 / lint 0 err·12 warn (baseline) / web:build 0 · 21 routes
   states residue restored clean.
```
Content: FIX A — restoreDeckWithFallback: deck restore falls back to default
pattern on ANY failure (null/empty/missing/compile-fail), loud + VISIBLE via new
/status.deckRestoreDegraded {failedPattern,reason,fellBackTo}; fatal only if
default also fails. FIX B — /deck/playlist/swap + /entry return resolved
targetEntryId; UI arms pending-gate from it; mixer SWAP copy now "Switch (no
crossfade)" vs deck "Crossfade". Merge commit: see git log.
MINOR follow-up noted: hil_deck_swap_response_test.mjs hardcodes :6968 (other HILs
honor ENGINE_PORT) — canonical HIL port per spec, low priority.

> NOTE: deliverable branch is `feat/optimize_channels` (promoted from the old
> auto-named claude branch on 2026-06-20 per operator). Merges 1-3 below landed
> on that branch (same commits, renamed).

### MERGE 6 — dev/engine_hardening_timeline (WAVE 4) — VERIFIED ON MERGED TIP
Boundary: api_server.js, pattern_mixer.js + 4 additive tests + report. No overlap
with merged CaptainPad work. Verified on merged tip:
```
$ git diff --check -- marsin_engine          → DIFFCHECK_OK
$ node --check {2 lib + 4 tests}             → all OK
$ node engine.js --list                      → 60 patterns
$ dry-run                                    → exit 0, no missing-blend warning
$ node --test "tests/*.test.js"              → 823 pass / 0 fail (+21 vs 802)
$ ENGINE_PORT=31268 hil_deck_swap_param_test → ALL HIL ASSERTIONS PASSED, exit 0
  states/test_bench residue: clean (restored)
```
Content: validateFader (reject non-finite + clamp [0,1]) on all 4 fader write
paths incl. WS channelFaderRejected reply; deck base-channel restore THROWS at
boot on compile-fail (no silent null deck); stale playlist activeEntryId cleared
+ warned; per-key vis buffer pool (_extractVisInto); alloc-free scripted-transition
render order; removeDeckChannel cancels in-flight swap; parametric /deck/playlist/swap
(per-call transition override, 409 on in-flight); new /deck/playlist/queue warm
endpoint. Verified-already-correct (skipped): transition-config validation, WS
fail-loud, warmInactiveDeckHandle leak-safety. Deferred: applyChannelPatch refactor.
Merge commit: see git log.

### MERGE 5 — dev/captainpad_qol (WAVE 5, lens C) — VERIFIED ON MERGED TIP
Boundary: index.tsx, mixer.tsx, ConfirmSheet.tsx, api.ts + report. Verified:
```
$ git diff --check -- CaptainPad   → DIFFCHECK_OK
$ npx tsc --noEmit                 → TSC=0
$ npm run lint                     → 0 errors / 12 warnings (baseline held)
$ npm run web:build                → WEBBUILD=0, dist, 21 routes
```
Content: removeMixerChannel/updateMixerChannel/setDeckTransitionConfig now honor
res.ok (were silently {ok:true} — codex P0); delete surfaces Alert; 4 `.catch(()=>{})`
swallows replaced with console.error (+Alert on mute); ConfirmSheet hitSlop; SOLO
no longer color-only ("Solo ✓" + accessibilityState); deck-tx + view-selection
await POST and roll back/alert on reject. Merge commit: see git log.

### MERGE 4 — dev/captainpad_hotswap_ui (WAVE 3) — VERIFIED ON MERGED TIP
Boundary: CaptainPad PlaylistPanel.tsx + api.ts + report (additive UI, no
mixer.tsx/index.tsx edits). Verified on merged tip:
```
$ npx tsc --noEmit              → TSC=0
$ npm run lint                  → 0 errors / 12 warnings (baseline held)
$ npm run web:build             → WEBBUILD=0, dist exported, 21 routes
```
Content: swapDeckPlaylist / swapMixerChannelPlaylist / swapChannelPlaylist
(typed fail-loud ApiResult, EBUSY on 409, cache-invalidating); PlaylistPanel
SWAP button + SwapPlaylistModal (>=44pt rows) + ConfirmSheet confirm,
respects soft-swap in-flight lock, WS reconcile. Wires the engine
/deck/playlist/swap + /mixer/channels/:id/playlist/swap endpoints.

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
