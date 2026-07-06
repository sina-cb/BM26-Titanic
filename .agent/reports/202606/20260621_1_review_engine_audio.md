# 2026-06-21 — Adversarial review + fix: ENGINE AUDIO

Reviewer/fixer pass over the marsin_engine audio subsystem on branch
`dev/r1_engine_audio` (parent `feat/audio_analysis_2`, fftSize 2048).
Scope OWNED: `audio/signals/*`, `audio/analyzer/*`, `audio/detector/*`,
`audio/postproc/*`, `audio/config/*` + their tests. Companion / patterns /
tools / CaptainPad NOT touched (other agents own those).

Method: read every owned file; 4 sub-agents deep-reviewed the 4 largest
(`bpm_tracker.js`, `audio_structure_detector.js`, `genre_classifier.js`,
analyzer+post-proc); every claim verified against the code before acting.

## Test bar — ALL GREEN
- `node --test` audio JS suite (analyzer/config/store/devices/signals/detector/
  genre/note/bpm/band/switch/new-derived/post-proc): **334 pass / 0 fail**.
- `node --test tests/detector_eval.test.mjs
  tests/integration/audio_analysis_validation.test.mjs`: **46 pass / 0 fail**.
- Engine `--pattern test_const --model test_bench --dry-run`: **exit 0**, no
  missing-blend warning.
- `node --check` on all 10 touched files: pass.
- `git diff --check -- marsin_engine`: clean. `git status`: only the 10
  intended files; no `states/*` changes, no `node_modules`.

## FIXED (committed — trivial/safe, behavior-preserving or proven bugfix)
1. `party_mode.js` — header filename `party_mode_ref.js` → `party_mode.js`.
2. `switch_signals.js` — header filename `switch_signals_ref.js` → real name.
3. `note_estimator.js` — header filename `note_estimator_ref.js` → real name.
4. `note_estimator.js` — header step 3 said "MEDIAN" but `_medianPc` computes a
   circular-safe histogram MODE; corrected the prose (param names unchanged).
5. `bpm_tracker.js` — header filename `bpm_tracker_v2_ref.js` → `bpm_tracker.js`;
   dropped the self-referential "Drop-in replacement for bpm_tracker.js" line.
6. `bpm_tracker.js` — stale "115-BPM perceptual centre" → 128 (octaveCenterBpm=128;
   the other "115" mention is correct history for the OLD symmetric curve).
7. `bpm_tracker.js` — removed dead `_dbgRawMeas` field (written twice, never read).
8. `bpm_tracker.js` — added fail-loud `Number.isFinite` guard + JSDoc on
   `update(flux,kick,dt)` (codex P0); proven by a new test in
   `bpm_tracker_octave.test.js` (throws on NaN/Inf, still runs on finite input).
9. `audio_structure_detector.js` — "five live keys" → "six" in 4 comments and
   added `audioSlowZone` to the header key list (setMany/zeroLiveKeys publish 6).
10. `audio_structure_detector.js` — stale "BOTH NIS clear … on the same hop" →
    "within dropCoWindowMs" (matches the co-occurrence implementation).
11. `audio_structure_detector.js` — `KALMAN_Q` "tuned winner" comment corrected:
    it is an UNREACHED default (the edge always passes `cfg.dropKalmanQ`=0.001);
    0.01 is the value that floored NIS, not the shipped tuning. Value unchanged.
12. `audio_structure_detector.js` — added `Number.isFinite` guard on the three
    `stems*Raw` reads (same fail-loud-but-isolated pattern as micLow/micFlux);
    behavior identical for finite input.
13. `genre_classifier.js` — "Feature order" comment listed 12 features; the
    vector is 15. Completed it (appended tonalStab/chromaFlux/chromaTilt).
14. `genre_classifier.js` — `_updateChroma` guard was `x >= 0` but the comment
    claimed "non-finite → 0"; `+Infinity` slipped through. Switched to
    `Number.isFinite`. Behavior-neutral: features are clamp01'd downstream and
    carry weight 0, so genre output is unchanged.
15. `audio_analyzer.js` — `onAnalysis` JSDoc + header listed only
    `{low,mid,high,kick,flux}`; documented the additive emit fields (dom/onset/
    sub/chroma).
16. `audio_analyzer.js` — stale path `lib/signal_post_processor.js` →
    `audio/postproc/signal_post_processor.js` (2 sites). (`lib/osc_listener.js`
    verified CORRECT — left as-is.)
17. `audio_analyzer.js` — added `const KICK_WARMUP_HOPS = 50` (the comment already
    referenced this non-existent name) and used it in place of the inline `50`.
18. `audio_analyzer.js` — deleted the obsolete "RAW (pre-gain) values … emitted
    alongside the gained values" comment block (analyzer now emits a single set;
    the next comment already describes the real behavior).
19. `audio_analyzer.js` — `reconfigure()` kick guards (`threshold`/`refractoryMs`/
    `decayMs`) now require `Number.isFinite` (Infinity passed `>1`/`>=0` and would
    e.g. make decayMs=Infinity → kick never decays). Defensive boot-path re-check;
    the PATCH validator already rejects non-finite, so no live behavior change.
20. `dominant_freq_tracker.js` — "Drop-in reference for …" → "Used by …".
21. `dominant_freq_tracker.js` — removed dead `mainLobeBins` field + its `@param`
    + updated the stale "main-lobe energy over ±mainLobeBins" algorithm note to
    the dynamic constant-Q window the code actually uses.
22. `signal_post_processor.js` — "write all 7 signals" → count-agnostic wording
    (KNOWN_SIGNALS is derived; stems removed, so it is no longer 7).
23. `signal_post_processor.js` — `process()` entry comment said raw "arrives in
    [0,1]"; clarified it is domain-dependent ([0,1] intensity / Hz frequency) and
    that the guard only rejects non-finite, it does not clamp.

## FLAGGED FOR DECISION (NOT changed — need operator go/no-go)
These all touch TUNING / detection / published-signal behavior, or are >10% risky.

A. **`audio_config_store.js` `loadSceneAudio` / `_atomicWrite` swallow errors**
   (`console.warn` + return `{}` / no-op) — a parse failure silently yields an
   empty config and a write failure is not surfaced. This reads as a fallback
   (codex P0 "fail loud"). BUT it is a config-store design choice (operator can
   re-set the mic/tuning from the UI), and the sibling `audio_config.js`
   `loadAudioConfig`/`saveAudioConfig` do the same. *Recommendation:* decide
   whether boot-time config parse/write failures should `process.exit(1)` (true
   fail-loud) or stay best-effort. If fail-loud is wanted I can make load throw
   and save propagate — it's a behavior change so I did not do it.

B. **`bpm_tracker.js` `beatInBar` computed on two code paths** (the `beatFired`
   hop vs the `this.beatInBar === 0` idle initializer) can yield different
   semantics for the same beat/bar state. Possible published-signal consistency
   bug. *Recommendation:* confirm the intended `beatInBar` semantics, then I can
   unify — needs a behavior decision + a corpus check, so flagged not fixed.

C. **`bpm_tracker.js` octave-migration / lock-unlock thresholds** (`+=2` vs `-1`
   migration ratio, `lockTolFrac`/`unlockTolFrac`/`unlockVoteHops`, the skewed
   octave-preference sigmas, the prior sigmas `0.25`/`0.22`, the `*2` vote-prior
   gain, the 8-bar downbeat hysteresis) are all tuning. Several are unnamed magic
   numbers but extracting/renaming them touches detection-sensitive code.
   *Recommendation:* if you want them named for readability I can do a strictly
   value-preserving constant-extraction pass — say the word.

D. **`genre_classifier.js` weights / PROFILES / GENRE_DEFAULTS thresholds** and
   the `sparkleVar * 6` and `fluxVarScale: 1.0` scales — tuning surfaces. The
   `*6` is an unnamed magic number; `fluxVarScale:1.0` is a currently-no-op
   multiply kept "for tuning". Left untouched (changing them alters published
   features / classification). *Recommendation:* none needed unless you want the
   `*6` promoted to a named constant (value-preserving) — flag only.

E. **`audio_analyzer.js` `onAnalysis` try/catch swallows consumer throws**
   (`console.warn`, continues) and **`signal_post_processor.js`
   `_paramCenterHasKey` returns `true` on an under-featured CPC stub** — both are
   explicit, documented fallbacks in tension with codex P0. Deliberate-looking;
   *recommendation:* leave unless you want strict fail-loud there (behavior
   change — flagged, not touched).

## Notes
- `_nfWarned` is intentionally session-scoped (not cleared on `reset()`) in BOTH
  the detector and `derived_signals.js` — consistent "warn once per session"
  design; left as-is (not a defect).
- `derived_signals.js` audioBpm doc `[0,180]` is CORRECT (BpmTracker `maxBpm=180`
  + Kalman clamp); the `audio_signals.js` registry range `[0,300]` is just the
  CPC clamp ceiling. No mismatch.
