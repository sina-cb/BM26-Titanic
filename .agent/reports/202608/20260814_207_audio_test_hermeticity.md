# `_207` — Scene-state leakage in the audio test suites: audit + hermeticization

**Date:** 2026-08-14
**Thread:** fix agent `_207` (audio-closure campaign, follow-up 1 from `_204`)
**Branch:** `feat/bm_readiness` (shared tree; `_205` / `_206` running concurrently)
**Scope held:** no detector or tracker retuning, no threshold changes, no
`config.yaml` edits, no doc-figure edits. No git operations. Live stack never
touched — no mic opened, ports 6966–6972 / 5568 / 8081 / 10000 never bound.

---

## The hole `_204` left open

`loadEffectiveAudioAnalysisConfig()` resolves the SHOW config: tracked
`config.yaml`, then `states/<scene>/audio_state.yaml` merged **over** it. The
engine writes that scene file on every `PATCH /audio/config` — every knob the
operator turns. A test built on the effective config is therefore scored against
whatever the operator's mic gain, FFT size, band gates and live-patched derived
groups happen to be **right now**.

`_204` fixed the one gate whose numbers are published
(`tests/audio/note_estimator_noisy.test.mjs`) and flagged eleven other callers.
This is that audit.

**Enumeration (verified):** `grep loadEffectiveAudioAnalysisConfig` under
`marsin_engine/tests/` returns **11 files** — 6 under `tests/audio/`, 4 under
`tests/companion/`, 1 under `tests/integration/`. A 12th file
(`note_estimator_noisy.test.mjs`) matches on its header comment only; that is
`_204`'s own fix documenting what it removed.

### What the overlay actually contains on this box

Measured 2026-08-14, live working tree vs tracked `config.yaml`:

| Scene | Field | Tracked | Live overlay |
|---|---|---|---|
| `titanic` | `bands.inputGain` | 1 | **9.1** |
| `titanic` | `bands.{low,mid,high}Gate` | absent | 0.04 |
| `test_bench` | `fftSize` | 2048 | **1024** |
| `test_bench` | `bands.inputGain` | 1 | **8.83** |
| `test_bench` | `bands.noiseGate` | 0.04 | 0.06 |
| `test_bench` | `bands.{low,mid,high}Gate` | absent | 0.12 / 0.10 / 0.14 |

`titanic`'s `structureDetector` and `bpmTracker` overlays happen to **agree**
with `config.yaml` today, and neither scene carries a `derivedSignals` group.
That is luck, not structure — the scene file's own header documents that it
persists exactly those groups once the operator patches them.

---

## Classification

| # | File | Verdict | Reason |
|---|---|---|---|
| 1 | `marsin_engine/tests/integration/run_analysis.mjs` | **(b) → hermetic** | The detector gate harness behind `audio_analysis_validation` + `detection_metrics`. Drove the REAL analyzer on the overlay. **Was red.** |
| 2 | `marsin_engine/tests/audio/bpm_tracker_octave.test.js` | **(b) → hermetic** | Octave gates on the real analyzer; its first test literally claims "exactly what config.yaml declares" while reading the overlay. |
| 3 | `marsin_engine/tests/companion/companion_raw_pipeline.test.js` | **(b) → hermetic** | Real-analyzer publication maxima over `full_track`. |
| 4 | `marsin_engine/tests/audio/derived_signals_config.test.js` | **(b) → hermetic** | Asserts the shipped derived config equals `DERIVED_SIGNALS_DEFAULTS` — a claim about `config.yaml` that a Companion Derived Tune edit would turn red. |
| 5 | `marsin_engine/tests/audio/note_estimator_synthetic.test.js` | **(b) → hermetic** | Consumes `derivedSignals` + `bpmTracker`, both overlay-capable. |
| 6 | `marsin_engine/tests/audio/new_derived_signals.test.js` | **(b) → hermetic** | Same. |
| 7 | `marsin_engine/tests/audio/derived_signals_perf_finiteness.test.js` | **(b) → hermetic** | Same, plus a per-hop budget and a published-range finiteness guard. |
| 8 | `marsin_engine/tests/companion/companion_party_tab.test.js` | **(b) → hermetic** | Same; the party tunables under test are derived-signals config. |
| 9 | `marsin_engine/tests/companion/companion_derived_patch_order.test.js` | **(b) → hermetic** | Its four fake engines served the operator's live `test_bench` config as the truth the retry tests negotiate over. |
| 10 | `marsin_engine/tests/audio/audio_analysis_config.test.js` | **(a) + (b), split** | The loader's own test. The **4** merge-semantics tests legitimately want the effective loader — the overlay IS the subject. The **11** contract tests (bpmTracker bounds, detector defaults, validator behaviour) assert what the repo ships and were moved to tracked-only. |
| 11 | `marsin_engine/tests/companion/companion_derived_config.test.js` | **(c), fixture hardened** | Already redirects `MARSIN_STATE_DIR` to a temp root — but the fixture was a **copy of the live scene file**, so its content leaked in anyway. |

**Counts:** (a) 4 tests inside 1 file · (b) 9 whole files + 11 tests inside file 10
· (c) 1 file (hardened anyway).

### The fix

One new module, `marsin_engine/tests/helpers/tracked_audio_config.mjs`, exports
`loadTrackedAudioAnalysisConfig(engineDir)` — `yaml.load(config.yaml)` →
`mergeAudioConfig` → `validateAudioAnalysisConfig`, with no state overlay. It is
the `_204` idiom with the rationale written down once instead of ten times; the
long-form version stays in `note_estimator_noisy.test.mjs`, which was left
untouched. Every call site keeps a short pointer comment naming what it would
otherwise be scored against.

`companion_derived_config.test.js` now writes a two-key mic fixture instead of
copying the operator's scene file. The assertion there ("nothing was
live-patched, so nothing is persisted") is a statement about what the Companion
did during the test — it must not also be a statement about whether the operator
has ever used Derived Tune on `test_bench`.

`audio_analysis_config.test.js` gains **one new test**, *"the tracked loader
ignores the scene overlay the effective loader honors"*: with
`MARSIN_STATE_DIR` pointed at a fixture carrying `bands.inputGain: 12.5`, the
effective loader must return 12.5 and the tracked loader must not, and must
still deep-equal the module-level tracked config. That is the regression lock —
re-adding an overlay to the helper fails here.

---

## State-sensitivity proof

Method: run each suite twice against the **unmodified** files — once with the
operator's live `states/` present, once with `MARSIN_STATE_DIR` pointed at a
copy of `states/` whose every `audio_state.yaml` is `{}` (a valid empty overlay,
i.e. exactly the post-fix input). Value-level drift measured separately by
replaying each suite's own measurement on both configs.

| File | Pre-fix, LIVE overlay | Pre-fix, no overlay | Silently state-sensitive? |
|---|---|---|---|
| `run_analysis.mjs` → `audio_analysis_validation` | **32 pass / 3 FAIL** | **35 pass / 0 fail** | **YES — red today** |
| `run_analysis.mjs` → `detection_metrics` | 5 / 0 | 5 / 0 | exposed, green both |
| `bpm_tracker_octave` | 17 / 0 | 17 / 0 | green both; **see below** |
| `companion_raw_pipeline` | 4 / 0 | 4 / 0 | green both; **values drift** |
| `companion_derived_patch_order` | 5 / 0 | 5 / 0 | green both; served truth non-reproducible |
| `audio_analysis_config` | 15 / 0 | 14 / 1 (the overlay test — by design) | contract tests green by coincidence |
| `companion_derived_config` | 1 / 0 | 1 / 0 | fixture-content coupling only |
| `note_estimator_synthetic`, `new_derived_signals`, `derived_signals_perf_finiteness`, `derived_signals_config`, `companion_party_tab` | green | green | **zero delta today** — `buildDerivedSignalsOptions` and `buildBpmTrackerOptions` are byte-identical live vs tracked; structurally exposed only |

### 1. `audio_analysis_validation` was already broken by the leak

Three red tests, all of them the drop detector reporting **zero** drops:

```
✖ runClipViaWav proves the WAV round-trip feeds the analyzer identically
✖ clean_drop fires exactly one dropFired near the labeled drop and reaches SUSTAIN
   AssertionError: expected exactly 1 dropFired, got 0 @ []
✖ double_drop fires both genuine drops and respects the 2 s refractory
   AssertionError: both labeled drops detected — 0 !== 2
```

Same code, same clips, tracked config: **35 / 35**. The operator's `inputGain
9.1` saturates the energy-jump ratio the detector gates on, so both labelled
drops vanish. This suite was not in the `_204` verification set, which is why it
went unnoticed.

### 2. `bpm_tracker_octave` — one knob from a false regression alarm

Mean tail BPM, live overlay vs tracked (test tolerance 5–6 %):

| Case | live (gain 9.1) | tracked | Δ |
|---|---|---|---|
| `kick_4floor` @ 90 | 90.11 | 90.08 | 0.03 |
| `full_track` @ 128 | 128.23 | 128.24 | −0.02 |
| `full_track` @ 160 | 160.59 | 160.58 | 0.00 |
| `full_track` @ 170 | 169.61 | 169.73 | −0.12 |
| `kick_4floor` @ 75 | 74.96 | 74.97 | −0.01 |
| `kick_4floor` @ 80 | 79.89 | 79.91 | −0.01 |

Immaterial *today*. But re-run against a plausible overlay (`fftSize 512`,
`inputGain 24`, `noiseGate 0.25` — the kind of thing a live tuning session
produces):

| Case | hostile overlay | tracked | Δ |
|---|---|---|---|
| `full_track` @ 160 | **80.26** | 160.58 | **−80.32** |
| `full_track` @ 170 | **84.66** | 169.73 | **−85.08** |

Both fast-tempo cases octave-**halve** — and those two tests exist specifically
to guard the fast-tempo octave fix. Pre-fix, an operator's FFT-size change would
have raised a two-test "tracker regression" that is not a tracker regression at
all.

### 3. `companion_raw_pipeline` — measured value drift, hidden by `> 0`

Maxima over `full_track`, live vs tracked:

| Key | live | tracked |
|---|---|---|
| `micOnsetLowRaw` | 0.9549 | 0.6994 |
| `micOnsetMidRaw` | 0.8813 | 0.4493 |
| `micOnsetHighRaw` | 0.9549 | 0.6993 |
| `micSubRaw` | 0.8969 | 0.4887 |
| `audioGenreConf` | 0.0073 | **0.0356** |

The assertions are `> 0`, so both pass — but the pipeline being scored was not
the shipped one, and `audioGenreConf` moves by ~5×.

### 4. Post-fix insensitivity

All 14 affected suites re-run under **three** state roots — the operator's live
`states/`, the empty-overlay copy, and the hostile overlay above. **Identical
counts in every case**, so the gates no longer read the scene tree at all.

---

## Verification

| Suite | Baseline (`_204`) | Now |
|---|---|---|
| Focused config batch (config API errors, store, transaction, analysis config, audio config, derived-signals config, engine config link, derived config, Derived Tune UI, derived PATCH ordering, note-evidence parity) | 123 / 123 | **124 / 124** (+1 = the new hermeticity guard) |
| Evaluators (`bpm_tune_eval`, noisy note holdout, synthetic note) | 20 / 20 | **20 / 20** |
| Full companion (`tests/companion/*.test.js`) | 211 / 211 | **211 / 211** |
| All `tests/audio/*.test.{js,mjs}` | — | **638 / 638** |
| All `tests/integration/*.test.mjs` | — | **61 / 61** (`audio_analysis_validation` alone was 32 / 3-fail before) |

**Failing lists:** empty everywhere. The only count that moved is the focused
batch, by exactly the one test added.

- `python scripts/security_check.py --all` → **6 findings, identical to the
  `_204` baseline**, all pre-existing MACs inside gitignored
  `simulation/.scene_backups/`. None in my files.
- No dotted-quad address added (the loopback quads in the companion suites are
  pre-existing). No future dates. Line endings unchanged (CRLF throughout).

### State residue — zero

`marsin_engine/states/**` (40 files) SHA-256'd before the first run and after
the last: **byte-identical**. Nothing I ran writes there — the analyzer suites
only read, and every spawned companion runs `--no-mic --source test` against a
black-holed engine under `MARSIN_CONFIG_FILE`. The operator's live engine also
writes into that tree while I work; none of the 40 hashes moved during my
window.

---

## Follow-ups (not done here)

1. **`marsin_engine/tools/bpm_tune_eval.mjs` has the same hole and it is a
   gate.** It calls `loadEffectiveAudioAnalysisConfig({modelName:'titanic'})` at
   module load, and `tests/audio/bpm_tune_eval.test.mjs` imports it — so the
   test file is transitively state-coupled. Nothing is red (that test only
   exercises the pure `checkGates` / `validateTierSelection`), but the
   evaluator's own checked-in thresholds are scored on the operator's live gain.
   Same three-line fix; it needs a full evaluator re-run to land honestly, which
   is outside this thread's bound.
2. **`tools/genre_eval.mjs`, `tools/signal_eval.mjs`,
   `tools/pattern_derived_harness.mjs`** also read the effective config. These
   are operator sweeps where live config is arguably the right input — worth a
   decision rather than a reflex fix.
3. **`isolatedCompanionEnv()` does not redirect `MARSIN_STATE_DIR`.** It
   black-holes the companion's endpoints and forces the synthetic source, but a
   spawned companion still reads (and, on an explicit export, could write) the
   tracked state tree. Adding the state redirect there would isolate every
   companion-spawning suite at once.
4. **The `titanic` overlay's `inputGain 9.1` measurably degrades genre
   confidence** (0.0073 vs 0.0356 on `full_track`) while measurably improving
   note tracking (`_204`, follow-up 2). Those two pull in opposite directions —
   an operator tuning decision, with evidence on both sides now.
