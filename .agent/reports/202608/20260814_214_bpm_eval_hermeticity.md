# `_214` — BPM evaluator hermeticity + companion state-dir isolation

**Date:** 2026-08-14
**Thread:** fix agent `_214` (audio-closure campaign; closes `_207` follow-ups 1 and 3)
**Branch:** `feat/bm_readiness` (shared tree; another session editing concurrently)
**Scope held:** no tracker/detector retuning, no threshold changes, no engine or
Companion source changes beyond the test seam. No git operations. Live stack
never touched — no mic opened, ports 6966–6972 / 5568 / 8081 / 10000 never bound.

---

## 1. `tools/bpm_tune_eval.mjs` — the last state-coupled gate

### The hole

The module resolved `loadEffectiveAudioAnalysisConfig({modelName: 'titanic'})`
at **import time** — tracked `config.yaml` with `states/titanic/audio_state.yaml`
merged over it. `tests/audio/bpm_tune_eval.test.mjs` imports the module, so the
gate was transitively state-coupled even though its three tests only exercise the
pure `checkGates` / `validateTierSelection`. Worse, the tool's *own* checked-in
thresholds and the `minBpm` A/B figures published in `config.yaml` were scored on
whatever the operator's mic gain happened to be.

### Gate vs. explore — the design decision

An operator A/B'ing a tuning against the mic actually in the room is a real
workflow, so `--effective` was **kept** rather than deleted. What changed is
which one is the default and how loud the other one is:

| | tracked (default) | `--effective <scene>` |
|---|---|---|
| config | `config.yaml` only, via `tests/helpers/tracked_audio_config.mjs` (reused, not duplicated) | `config.yaml` + `states/<scene>/audio_state.yaml` |
| announced | one line naming the config path and saying "this is the gate config" | names the overlay **file** and prints **every key the overlay moved**, then `EXPLORATION ONLY — the regression gate is the tracked config` |
| verdict line | `GATES PASSED (…)` | `GATES PASSED [EXPLORATION, effective:titanic — NOT the gate] (…)` |
| `--out` JSON | `configMode: "tracked"` | `configMode: "effective:<scene>"` |

There is no silent overlay path. The scene name is **required** — a bare
`--effective` throws rather than quietly running the tracked config the caller
explicitly asked not to use (`effectiveRequested` is tracked separately from the
value for exactly that reason), an unknown scene throws from the loader naming
the missing file, and a printed `GATE FAILED` still exits non-zero in both modes.

On this box the tool now prints, under `--effective titanic`:

```
overlay moved bands.inputGain: tracked 1 → effective 9.1
overlay moved bands.{low,mid,high}Gate: tracked (absent) → effective 0.04
overlay moved capture.device: tracked null → effective "<the operator's USB mic>"
```

### Honest re-run — before vs after

Full default run (4 tiers × 14 steady + 2 steps = 64 cases), `--out` JSON kept in
`~/tmp/fix_214/`. **Before** = the unmodified tool on the live overlay,
**after** = the same code on the tracked config.

| Aggregate | before (effective, live) | after (tracked) |
|---|---|---|
| steady ±1% | 64.3% | **64.3%** |
| steady ±2% | 66.1% | **64.3%** |
| octave-error rate | 3.6% | **1.8%** |
| metric-alias rate | 7.1% | **5.4%** |
| mean lock | 5.73 s | **6.00 s** |
| mean calibration Brier | 0.2235 | **0.2271** |
| gate failures | none | **none** |

Row-level: of 56 steady rows, **52 are unchanged** within 0.3 BPM with the same
alias, the same ±2% verdict and the same lock time. The four that moved:

| tier | bpm | before | after | what moved |
|---|---|---|---|---|
| moderate | 60 | 119.9 (`x2`) | 134.3 (no alias) | below `minBpm 70`; never gated. Accounts for the whole octave/alias-rate delta |
| heavy | 120 | 122.0 (±2% ✓) | 123.1 (±2% ✗) | report-only tier |
| heavy | 140 | 140.1 | 140.5 | report-only |
| heavy | 174 | 172.3, lock 6.1 s | 172.6, lock 16.4 s | report-only; value fine, lock slower |

Steps: `heavy 124→140` settled at +8.4 s before and never settles after (report-only
tier); `moderate 140→124` moved 8.02 s → 8.12 s. **Every gated tier and every gated
tempo is materially unchanged, and both gate verdicts are PASS in both modes.**

The tracked run is deterministic: a second `--tiers clean,moderate` run is
**byte-identical** to the first run's clean+moderate sections.

### Published figures — NO CHANGE, and here is why that matters

BPM evaluator figures live in exactly **one** tracked surface:
`marsin_engine/config.yaml`, the `bpmTracker.minBpm` comment. (`docs/AUDIO_SIGNALS.md`
carries none — verified by grep across `docs/`, `marsin_engine/audio/`, and
`marsin_engine/`.) It publishes the `minBpm 60 vs 70` A/B:

> widening the band to 60 … COST two fast tempos to wrong locks: **moderate 174 →
> 112 (−35.6%)** and **heavy 124 → 96 (−22.3%)**, both correct at 70.

Re-measured with `node tools/bpm_tune_eval.mjs --opts '{"minBpm":60}'`:

| figure | published | measured on TRACKED | measured on the live overlay |
|---|---|---|---|
| moderate 174 | 112 (−35.6%) | **112.1 (−35.6%)** ✔ exact | **173.3 (−0.4%)** — failure GONE |
| heavy 124 | 96 (−22.3%) | **96.4 (−22.3%)** ✔ exact | 96.4 (−22.3%) ✔ |
| "both correct at 70" | — | moderate 174 = 172.9 (−0.6%), heavy 124 = 124.2 (+0.2%) ✔ | — |

**Both published numbers reproduce exactly on the tracked config. No documentation
surface needed a figure change.**

But the A/B re-run is the sharpest evidence in this thread for why the fix was
needed at all: on the tracked config the `minBpm 60` candidate **fails the gate**
(`GATE FAILED: moderate 174 BPM read 112.1 (35.6% off; need ≤2%)`), and on the
operator's live overlay the very same candidate **passes** (`GATES PASSED`,
±1% 69.6% — better-looking than the shipped tuning). The leak did not merely
make a number unreproducible; it would have waved through the exact regression
the comment exists to prevent, and an `--effective` re-run of the A/B would have
deleted half the evidence for `minBpm: 70`.

### Parity gate — extended by intent, not by copy

`_204`'s three-witness pattern applies where a figure lives in ≥2 surfaces. These
live in one, so a cross-surface comparator would have nothing to compare. What
they were missing is the **third witness** and the **measurement scoping**, both
now added to `tests/audio/bpm_tune_eval.test.mjs` (3 tests → **6**):

| new test | proves |
|---|---|
| *the evaluator is scored on the tracked config, with no scene-state overlay* | `evalAudioConfig()` deep-equals `loadTrackedAudioAnalysisConfig(ENGINE_DIR)` |
| *a planted scene overlay cannot reach the evaluator (only `--effective` can)* | the regression lock: a child process imports the tool with `MARSIN_STATE_DIR` pointed at a fixture root carrying `bands.inputGain: 12.5`, and must report the tracked `1`. Re-adding the effective loader at module scope fails here, naming the fixture root and the source block |
| *the published minBpm A/B figures in config.yaml match the measured ones* | `PUBLISHED_MIN_BPM_AB` in the test carries `112 / −35.6%` and `96 / −22.3%`, parsed out of the flattened YAML comment. Pasting a new number into the comment alone fails; so does dropping the "re-run the A/B" instruction or the measurement-scoping line |

`config.yaml` gained six comment lines (no value change) recording that the
figures were measured on the tracked config, that `_214` reproduced them exactly,
that the live overlay erases the moderate 174 failure, and that the test locks them.

**Negative controls** (run against copies in `~/tmp/fix_214/`, never against the
tracked file):

```
A: effective loader on the fixture root = 12.5, tracked = 1        → the plant is live
B[pristine]:            passes
B[drifted pct]:         FAILS → moderate 174: config says 112 (-30.6%), expected 112 (-35.6%)
B[drifted bpm]:         FAILS → heavy 124: config says 98 (-22.3%), expected 96 (-22.3%)
B[instruction dropped]: FAILS → re-run instruction MISSING
```

An `-e` probe was rejected in favour of a probe **file**: the tool's
`isMainModule()` guard reads `process.argv[1]`, which `-e` leaves empty (it throws
by design), so `-e` would have failed for the wrong reason.

---

## 2. `isolatedCompanionEnv()` — the state-root gap

### The gap

The helper black-holed the Companion's engine + OSC endpoints and forced the
synthetic source (`_173`), but left `MARSIN_STATE_DIR` alone.
`companion_server.js` resolves its analyzer config with
`loadEffectiveAudioAnalysisConfig({modelName: <--model>})`, so a spawned
companion booted on the operator's live overlay, and any state write it ever
gains would land in the tracked tree.

### The fix

`isolatedCompanionEnv(prefix)` now also `mkdtemp`s a **fresh** state root, exports
it as `MARSIN_STATE_DIR`, returns it as `stateRoot`, and removes it in `cleanup()`.
`loadEffectiveAudioAnalysisConfig` **requires** `<root>/<scene>/audio_state.yaml`
to exist (a missing file throws — codex P0, no silent default), so the helper
seeds the two-key mic fixture `capture: {device: test, platform: auto}` for every
scene **name** the tracked tree knows about. Names only — not one byte of the
operator's state is copied (the `_207` lesson: redirecting the path is not enough
if the fixture is a copy). A `--model` the repo has no scene for still fails
exactly as loudly as before.

### Proof — measured, before and after

A scratch probe (`~/tmp/fix_214/leak_probe.mjs`) boots the REAL companion twice
from the same helper, once with `MARSIN_STATE_DIR` deleted from the env
(pre-`_214`) and once with it:

```
tracked   fftSize 2048  inputGain 1     noiseGate 0.04
effective fftSize 1024  inputGain 8.83  noiseGate 0.06     (states/test_bench overlay)

NO state redirect (pre-_214):  inputGain=8.83  gates={noiseGate:0.06, low:0.12, mid:0.1, high:0.14}
WITH state redirect (_214):    inputGain=1     gates={noiseGate:0.04, low:null, mid:null, high:null}
```

Both runs: `engineLink.connected=false`, free ports, `--no-mic --source test`.

### The gate — `tests/companion/companion_isolation_state_root.test.js` (new, 3 tests)

1. *an isolated companion env redirects every state write into a throwaway temp
   root* — a **real** write through the **real** seam (`sceneStateDir` →
   `saveSceneAudio`) lands inside the temp root, and `states/<canary>` does not
   exist afterwards. The canary scene is `__isolation_canary_<pid>`, a name no
   repo scene uses, so the tracked-tree assertion is deterministic even while the
   operator's live engine writes into `states/` concurrently. Also asserts
   `cleanup()` removes the root.
2. *the seeded scene fixtures carry the mic selection and nothing else* — every
   tracked scene name is seeded, and each fixture is byte-equal to the two-key mic
   fixture. A future "let's just copy the live file" regression fails here.
3. *a spawned companion resolves the isolated state root, not the tracked tree* —
   a real companion boots on a `trackChange.silenceConfirmMs` planted **only** in
   the temp root (tracked 450 → planted 587) and its `hello` frame carries the
   planted value; the failure message names the tracked path it would otherwise
   have read. The same frame must also report the tracked `inputGain` /
   `noiseGate` (the knobs the fixture does not carry) and `engineLink.connected
   === false` — so a green run cannot be the pre-`_214` behaviour.

The `_173` header comment on the helper was stale (it named two suites that do not
import it); it now names the real consumers and the three things neutralised.

---

## Verification

| Suite | Baseline (`_207` / `_204`) | Now |
|---|---|---|
| Focused config batch (config API errors, store, transaction, analysis config, audio config, derived-signals config, engine config link, derived config, Derived Tune UI, derived PATCH ordering, note-evidence parity) | 124 / 124 | **124 / 124** |
| Evaluators (`bpm_tune_eval`, noisy note holdout, synthetic note) | 20 / 20 | **23 / 23** (+3 = the new hermeticity + figure-lock tests) |
| Full companion (`tests/companion/*.test.js`) | 211 / 211 | **214 / 214** (+3 = the new state-root file) |
| All `tests/audio/*.test.{js,mjs}` | 638 / 638 | **641 / 641** (+3, same) |
| All `tests/integration/*.test.mjs` | 61 / 61 | **61 / 61** |
| `tests/state/state_paths.test.js` | — | **6 / 6** |

**Failing lists: empty everywhere.** Every count that moved moved by exactly the
number of tests added. The sole existing consumer of `isolatedCompanionEnv()`,
`companion_derived_patch_order.test.js` (5 tests), is green inside the 214.

- `python scripts/security_check.py --all` → **6 findings, identical to the
  `_204` / `_207` baseline**, all pre-existing MACs inside gitignored
  `simulation/.scene_backups/`. None in my files.
- `git diff --check` clean on my four modified files (one pre-existing CRLF
  warning, no whitespace errors). No dotted-quad added. No future dates.

### State residue

`marsin_engine/states/**` (41 files) SHA-256'd before my first run and after the
last. **All six `audio_state.yaml` files — the only state files anything in my
work path reads — are byte-identical.** Three files moved:
`states/titanic/{deck_state,globals_state,mixer_state}.yaml`. Those are the
operator's live engine autosaving the running show; nothing I ran spawns an
engine, calls a state-writing API, or touches deck/globals/mixer, and every
companion I spawned had `MARSIN_STATE_DIR` pointed at a temp root. Reported, not
reverted.

### Files touched

- `marsin_engine/tools/bpm_tune_eval.mjs` — tracked default, `--effective <scene>`, drift printer, `evalAudioConfig()` export
- `marsin_engine/tests/audio/bpm_tune_eval.test.mjs` — 3 → 6 tests
- `marsin_engine/tests/helpers/companion_isolation.mjs` — state root + fixture seeding
- `marsin_engine/tests/companion/companion_isolation_state_root.test.js` — **new**, 3 tests
- `marsin_engine/config.yaml` — 6 comment lines next to `bpmTracker.minBpm` (no value change)

---

## Follow-ups (not done here)

1. **Three companion suites still spawn without any config/state isolation.**
   `companion_new_signals.test.js`, `companion_osc_accounting.test.js` and
   `companion_live_edit_collisions.test.js` spawn the real companion with only
   `--no-mic` and free ports — no `MARSIN_CONFIG_FILE`, no `MARSIN_STATE_DIR`. They
   therefore still boot on the operator's live overlay (measured: `inputGain 8.83`,
   `fftSize 1024`). Adopting `isolatedCompanionEnv()` in all three is now a
   two-line change each, but each needs its own assertion review, so it is a
   separate thread.
2. **`tools/genre_eval.mjs`, `tools/signal_eval.mjs`,
   `tools/pattern_derived_harness.mjs`** still read the effective config
   (`_207` follow-up 2, unchanged). The gate/explore split landed here is the
   template if a decision goes that way — but none of them is a gate today.
3. **The heavy tier drifted more than the gated tiers** under the tracked config
   (heavy 174's lock time 6.1 s → 16.4 s, heavy `124→140` no longer settles).
   Report-only by design, so nothing is red — but it is the tier whose behaviour
   the operator's louder capture was flattering, and worth a look before the
   playa if heavy-tier lock speed ever starts mattering.
4. **`config.yaml` comments are still destroyed by any autopilot save** (`_204`
   follow-up 3). This thread added a second figure block that lives in comments,
   so the blast radius of that pre-existing hazard grew slightly.
