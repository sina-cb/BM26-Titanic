# Hostile review: Codex note-tracking / note-to-color / Derived Tune layer

**Date:** 2026-08-12 · **Worktree:** `BM26-Titanic-worktrees/audio_analysis_hardening` (uncommitted, on `11a1a962`) · **Coordinator:** Claude (manager) · 4 Opus reviewers (DSP, config/persistence, visual UI, safety/regression)

## Merge verdict: **NOT READY**

Scope verdicts: DSP **NOT READY** · note-to-color/persistence **NOT READY** · visual UI **NOT READY**
(2 small P1s) · safety/regression **READY WITH FOLLOW-UPS**. Full suite is green (750/750),
safety interlocks hold, and no test touches production — the blockers are evidence honesty,
boot/persistence integrity, and two UI regressions, not test failures.

## P0 (blocking)

1. **Noisy-transition test passes only on its 5 hardcoded seeds** —
   `tests/audio/note_estimator_noisy.test.mjs:173`. Re-run over seeds 1–12: seeds 6 and 11 fail
   the test's own assertions (spurious flip; missed transition) → 17% seed-failure rate.
   *Fix:* widen to ≥12 seeds with assertions matching what actually holds, or fix the estimator.
2. **Engine boot does not validate audio config** — `engine.js:1725` merges scene state
   unvalidated; `validateAudioAnalysisConfig` runs only in `applyLiveUpdate` (`engine.js:2001`).
   Bad state boots the engine, bricks the Companion, silently kills reconciliation, and 400s
   unrelated mid-show PATCHes. *Fix:* validate after merge at boot, exit(1) on throw.
3. **Malformed `audio_state.yaml` swallowed then destroyed** — `audio_config_store.js:66-69`
   returns `{}` on parse error; boot-write at `engine.js:2104-2105` then overwrites the file.
   One bad character erases all note colors + mic selection with only a console.warn.
   A test enshrines the swallow. *Fix:* rethrow on parse error (missing file stays `{}`).
4. **Engine persistence failure returns HTTP 200** — `audio_config_store.js:184-189`
   `_atomicWrite` catches all errors and warns. *Fix:* throw; let PATCH return 400.
5. **Fresh-clone breakage** — untracked `audio/config/derived_signals_config.js` is imported by
   four tracked files; untracked corpus-manifest copy is read by a tracked test. *Fix:* commit
   the 9-path `git add` set together (listed in safety report).

## P1

- **Phone-width nav collapse (UI regression from this diff)** — `companion_app.css:347`
  `.nav-seg` shrinks to 2px at 390px; all four page tabs invisible/unclickable.
  *Fix (verified live):* `flex: 0 0 auto`.
- **Live NOTE letter illegible** — `companion_app.js:1135` `hsl(h,100%,50%)` on text → 1.62:1
  contrast. *Fix:* full-sat for the swatch only.
- **Companion default-binds 0.0.0.0** (`companion_server.js:2336`) while the new layer adds an
  unauthenticated live-mutation surface. *Fix:* default `127.0.0.1`, explicit `--host 0.0.0.0`.
- **Steady-accuracy metric hides ~half the error** — 550 ms scoring exclusion per 968 ms chord;
  full-chord accuracy ≈ 52% (62% noise-free), reported as 93.7%. Publish/assert full-chord too.
- **Latency claim ~2× off** — config.yaml says ~0.29 s; measured 371 ms ideal (≤2-semitone
  moves via `nearHoldHops: 24`), 440–856 ms through the real analyzer. Notes < ~470 ms freeze
  the color. Fix the comment; decide if the latency is acceptable.
- **Heavy tier (9 dB, "far loud windy night") non-functional and untested** — 0–25% accuracy;
  one seed never commits a note. Needs a scope decision: mid-tier-only feature (document it)
  or fix required.
- **`reconcileDerivedConfig` tears state with no rollback** (`companion_server.js:1160-1166`) —
  one knob nudge can reset party latch/genre/phrase/drop-countdown mid-show; group-N failure
  desyncs config with the error swallowed (`engine_config_link.js:127-128`).
  *Fix:* construct all replacement modules first, swap atomically, surface failures to UI.
- **Dual-writer persistence** — Companion (`companion_server.js:1174-1180`) and engine
  (`engine.js:2031,2080,2105,2123`) both write `audio_state.yaml`; shared fixed `.tmp` name;
  no lock; stale-tree clobbers; offline edits silently reverted on reconnect.
  *Structural fix (collapses P1-4/5/6 + P2-10 of the color report):* Companion stops writing
  the file; engine is sole persister. NOTE: the UI reviewer empirically saw *no* companion
  disk write in bench mode — unresolved discrepancy with the static reading; the fix wave must
  determine the actual behavior first.
- **`pickLiveFields` persists the whole `derivedSignals` tree** (`audio_config.js:318-323`) —
  scene state permanently shadows future config.yaml retunes; every knob turn dirties tracked
  state. *Fix:* persist only operator-changed fields.

## P2 (selected)

- `NoteEstimator` silently defaults + absorbs unknown keys (`note_estimator.js:70-71`) — the
  exact fallback pattern this branch removed elsewhere; latent (PATCH path is validated).
- Smoothing bounds generic, not musical: `medianN:1` disables smoothing, `minConsensus:0.001`
  defeats the gate, `holdHops:10000` freezes notes ~2 min — all UI-reachable.
- No `holdHops < nearHoldHops` ordering check; `medianN must be odd` is a stale median-era
  constraint on what is now a histogram mode; consensus denominator is `_medFilled` (warmup
  window of 1 scores consensus 1.0).
- CaptainPad "Reset to defaults" (`engine.js:2075-2080`) silently drops all note colors from
  disk — undocumented.
- Fresh scene can't boot Companion before engine has written state once — undocumented ordering.
- No schema migration path: any future field rename bricks rigs with old scene state
  (the proposed `chordTracking` group will hit this first).
- Persist-failure rollback throws for `party`/`trackChange` (rolls back through the live-field
  validator with non-live keys) — real error masked.
- RESET ALL has no confirm/undo, one tap from wiping 12 custom hues (works correctly though).
- Wheel-key labels fail contrast on dark hues (2.45:1); no focus ring on wheel keys/hue slider;
  two detector meters show the same formula under different labels; engine-offline is the
  *least* prominent status on the page; UI test is source-regex only (cannot catch any of this).
- `bpmRaw` was added for exactly this UI and isn't surfaced; bench-port collisions force
  `--test-concurrency=1` on three companion test files.

## What held up

Suite 750/750 green, zero residue; HIL + `--no-mic` interlocks intact; new validator strict
(30/46 hostile inputs rejected); `engine.js:2001` live-patch validation proven load-bearing;
estimator state reset genuinely clean (no cross-case contamination); no hot-path allocation
growth; no NaN escapes; color schema structurally hue-only (S/V cannot be corrupted); RESET ALL
locally atomic and correct; chord docs honestly marked FUTURE DESIGN, no runtime chord code;
color wheel renders all 12 notes at exactly S=100/V=100; live note tracks the chord synth.

## Unverified

Any live engine↔companion round trip (all link behavior read from code or tested against a
dead port); Safari/iPadOS rendering; playa/adversarial noise tiers; Deck/Mixer rendering of an
id-less palette pair (chord design gap A); whether `states/test_bench/audio_state.yaml`'s new
derivedSignals block is hand-authored or residue (byte-identical to config.yaml either way);
the companion-writes-state discrepancy noted above.

## Evidence

Screenshots: `~/tmp/derived_review/` (UI reviewer, retained). Reproduction commands and full
per-scope reports live in the four agent transcripts of session 2026-08-12; key commands:
the noisy/synthetic suites, 4-batch full suite (750/750), validation probes, and the isolated
Companion boot (`--model test_bench --port 31766 --host 127.0.0.1 --no-mic --source test
--osc-port 31701 --engine-port 31668`, killed + ports verified free afterwards).
