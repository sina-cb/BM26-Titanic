# `_204` — Companion derived-PATCH retry without a reconnect + note-evidence reconciliation

**Date:** 2026-08-14
**Thread:** fix agent `_204` (audio-closure campaign, fixes 2 + 3)
**Branch:** `feat/bm_readiness` (shared tree; `_203` running concurrently)
**Scope held:** no detector retuning (low/mid/high, dominant frequency, beat,
note smoothing, silence, party), no genre work, no chord detection, no Timeline
party-session controls. No git operations. Live stack never touched — no mic
opened, no live port used.

---

## Fix 2 — derived-config PATCH retries on a LIVE link

### The defect

`drainDerivedGroupWrites()` took the queued snapshot, cleared `queue.pending`,
and awaited the PATCH. On failure it called `revertRejectedDerivedGroup()`,
which — when the engine's truth could not be read — kept the snapshot parked in
`pendingDerivedEdits` and returned. `queue.pending` was already `null`, so the
loop exited and **nothing was armed to push it again**. The only remaining
pusher was `replayPendingDerivedEdits()`, wired to `onStatus(connected)`.

That is fine when the engine goes away (the WS closes, reconnect replays). It is
wrong for the case where the HTTP request dies but `/ws/control` stays UP:

- the engine is respawning ffmpeg on a capture change,
- it is mid audio re-init and answers `503 audio_not_initialized`,
- the link's 2 s HTTP timeout expires under load.

No `close` fires, so no reconnect event ever comes. The operator's Derived Tune
edit sat unsaved forever while the UI showed it applied — the exact silent
divergence the write-through path exists to prevent.

### Classification seam (`audio/companion/engine_config_link.js`)

`patch()` now attaches `error.status` when the engine **answered**, and leaves
it absent on a **transport** failure. Callers classify on
`Number.isInteger(error.status)`, never on the message string. That is the only
change to that file.

### State machine (`audio/companion/companion_server.js`)

Per-group queue is now `{ pending, running, retryTimer, attempts }`.

| Outcome | `error.status` | Action |
|---|---|---|
| Success | — | `clearDerivedRetry` (fresh budget), unpark if still latest |
| Superseded (newer snapshot queued) | any | broadcast, continue the loop — the newer value lands |
| Transport failure | absent | **retry**, bounded backoff |
| `5xx` (incl. `503 audio_not_initialized`, `500` persist fault) | 500–599 | **retry**, bounded backoff |
| `408` / `429` | retryable 4xx | **retry**, bounded backoff |
| Any other `4xx` | definitive | **revert, never retry** |

**Bounds** (documented in the source next to the constants):

- `DERIVED_RETRY_MIN_MS = 250` — a one-packet blip clears inside a quarter
  second; anything faster is a busy loop.
- `DERIVED_RETRY_MAX_MS = 4000` — ceiling, mirroring `EngineConfigLink`'s own
  capped WS reconnect backoff (500 → 5000 ms).
- `DERIVED_RETRY_MAX_ATTEMPTS = 8` — 250+500+1000+2000+4000×4 ≈ **23.75 s** of
  cover, comfortably longer than an ffmpeg capture respawn.

**On exhaustion the snapshot is NOT dropped.** It stays parked in
`pendingDerivedEdits` (so the group remains locally authoritative and the next
reconnect still replays it) and the operator gets a loud `engineLink` broadcast
naming the group and the attempt count. No silent success anywhere.

**Serialization and coalescing are preserved.** The retry snapshot is handed to
the *timer*, never written back into `queue.pending` — writing it back would let
the `while (queue.pending)` loop pick it up with no delay and spin. The timer
yields to any newer edit that claimed the slot during the backoff, and a fresh
operator edit calls `clearDerivedRetry()`, cancelling the armed retry outright.
Everything still funnels through `startDerivedGroupWrites()`, which refuses to
start a second drain while `queue.running` is set, so **max concurrency stays 1
per group**.

**Revert path.** A definitive 4xx still reverts. If the *truth fetch* that the
revert needs fails, the verdict stands (the value is never re-sent) but the
**re-read** is retried on the same bounds — previously that case also sat
waiting for a reconnect that might never come.

Retry timers are `unref()`ed so a Companion whose engine is gone still exits on
signal.

### Tests

`marsin_engine/tests/companion/companion_derived_patch_order.test.js`
— 2 tests → **5** (+3), plus a shared `bootCompanion()` / `openCompanionWs()`
helper and two new fake engines.

| Test | Proves |
|---|---|
| *a transport failure retries on the live link with no reconnect and the value lands* | first PATCH socket-destroyed, `/ws/control` never drops, `controlConnections === 1`, `retry 1/8` broadcast observed, requests `[v, v]`, `maxActiveRequests === 1` |
| *an edit made during a retry backoff supersedes it and lands last* | `lastIndexOf(first) === 0` (the superseded snapshot is never re-sent), last request is the newest value, engine ends on it, concurrency 1, no reconnect |
| *a definitive 4xx reverts the group and is never retried* | exactly one request after 6 backoff windows, revert broadcast + flash naming `silenceConfirmMs`, a freshly joined client is handed the reverted value, link up throughout, no reconnect |

Every new test asserts `controlConnections === 1` against the fake engine, so a
green run **cannot** secretly be the old reconnect-replay path doing the work.
The `retry N/8` broadcast string exists only in the new `scheduleDerivedRetry`,
so a regression to the old behaviour fails on the `retryArmed` wait rather than
passing quietly.

**Isolation (`_173` idiom).** All four spawn sites in that file now go through
`bootCompanion()`, which uses `isolatedCompanionEnv()` (scratch
`MARSIN_CONFIG_FILE` with both companion endpoints black-holed to RFC 5737
TEST-NET-1), `--source test --no-mic`, and OS-assigned free ports for the
companion, OSC and fake engine. The server's own `--no-mic` interlock re-checks
that both effective targets are loopback and differ from the configured
production endpoints. Ports 6966–6972 / 5568 / 8081 / 10000 were never bound;
the microphone was never opened.

---

## Fix 3 — note-evidence reconciliation

### What I was told, and what I measured

The brief said the checked-in fixed 24-seed holdout now reports ~98.27% settled
/ 57.94% full-segment / 100% recall / 22-of-24 clean, while `AUDIO_SIGNALS.md`
and `config.yaml` still carried 93.43 / 51.09 / 99.17 / 18-of-24.

I reran it. **The premise was inverted: the docs were right and the eval had
started leaking.**

`tests/audio/note_estimator_noisy.test.mjs` built its analyzer from
`loadEffectiveAudioAnalysisConfig({ modelName: 'titanic' })`, which merges
`states/titanic/audio_state.yaml` **over** `config.yaml`. That state file carries
`bands.inputGain` — a knob the operator turns live. Four runs, same code, same
24 seeds, only the effective gain differing:

| Effective analyzer config | `bands.inputGain` | settled | full-seg | recall | clean | p90 p95 lat | worst p95 | heavy (s/f/r) |
|---|---|---|---|---|---|---|---|---|
| operator's live working tree | 9.1 | 98.27% | 57.94% | 100% | 22/24 | 620.6 ms | 701.9 ms | 37.43 / 23.59 / 45 |
| `states/titanic` at HEAD | 1.48 | 94.07% | 51.43% | 99.17% | 18/24 | 830.3 ms | 852.8 ms | 14.83 / 12.64 / 16.67 |
| tracked `config.yaml` only | 1 | **93.43%** | **51.09%** | **99.17%** | **18/24** | **853.6 ms** | **934.8 ms** | **11.22 / 9.81 / 13.33** |

The third row reproduces every published figure **exactly**, to two decimals,
across eight independent statistics — including the docs' "one seed never
commits a correct scored root" (that seed scores 0.00%). The documented numbers
were measured hermetically; the 98.27% the brief quotes is the operator's live
mic gain leaking into a regression gate.

A gate a gain knob can lift five points is not a gate — a genuine tracker
regression would hide behind a louder mic — and any number published from the
contaminated run would be unreproducible on any other machine.

### What I changed

1. **Made the holdout hermetic.** `note_estimator_noisy.test.mjs` now reads the
   tracked `config.yaml` audio block directly (`yaml.load` +
   `mergeAudioConfig` + `validateAudioAnalysisConfig`) and never overlays
   `states/<scene>/audio_state.yaml`. The file header documents the four-row
   table above so nobody re-adds the overlay thinking it is more realistic.
   **All 4 tests in the file still pass** — no floor was touched.
2. **Reconciled both surfaces to the measured hermetic numbers.** Almost
   everything already matched; the corrections were:
   - `config.yaml` said "about 440 ms median" → **451 ms typical change
     latency** (measured median of the 24 run-level p50s: 450.6 ms; docs already
     said "around 450 ms", now identical wording in both).
   - `854 ms` / `935 ms` → the exact **853.6 ms** / **934.8 ms**, in both.
   - Label wording unified across the two surfaces so a parser can match them
     (`mean settled-window accuracy`, `mean full-segment accuracy`,
     `mean expected root-change recall`, `18 of 24 clean committed sequences`,
     and disjoint `heavy-tier …` labels).
   - Added a "what those numbers are measured against" paragraph to both,
     naming the hermetic scoping and the live-gain sensitivity.
3. **Heavy tier stays report-only.** Its three figures are published (they were
   already), now explicitly marked *never gated, never promoted into a
   threshold* on both surfaces, and a parity test asserts that marking survives.

Old → new, in both `docs/AUDIO_SIGNALS.md` and `marsin_engine/config.yaml`:

| Figure | Old | New (measured) |
|---|---|---|
| mean settled-window accuracy | 93.43% | 93.43% (unchanged) |
| mean full-segment accuracy | 51.09% | 51.09% (unchanged) |
| mean expected root-change recall | 99.17% | 99.17% (unchanged) |
| clean committed sequences | 18/24 | 18 of 24 (unchanged) |
| typical change latency | 440 ms (config) / 450 ms (docs) | **451 ms** (both) |
| p90 run-level p95 latency | 854 ms | **853.6 ms** |
| worst run-level p95 latency | 935 ms | **934.8 ms** |
| heavy settled / full-seg / recall | 11.22 / 9.81 / 13.33 | unchanged |

### Parity check

New `marsin_engine/tests/audio/note_evidence_docs_parity.test.mjs` (5 tests). It
does **not** re-run the corpus — it locks the two published copies together:

1. **Exactly once per surface.** Each figure must appear once, and only once, in
   each file; zero or two occurrences both fail. Labels are chosen so none is a
   substring of another (hence `heavy-tier settled accuracy` rather than a bare
   `settled accuracy`).
2. **Identical across surfaces.** Any disagreement fails with a line per drifted
   figure and **both absolute file paths** printed.
3. **Third witness.** `EXPECTED_FIGURES` in the test carries the measured values,
   so "make them agree" cannot be satisfied by pasting the same typo into both.
4. **The gate defends what is published.** The moderate figures are parsed
   against `HOLDOUT_POLICY`'s floors, read out of the holdout test's source, so
   docs can never advertise a number the gate would not catch losing.
5. **Heavy stays report-only** on both surfaces.

Both surfaces are flattened (markdown `**`, `#`/`>` line markers stripped,
whitespace collapsed) before matching, so a figure that wraps across two comment
lines still reads as one phrase.

**Negative control run:** flipping `99.17%` → `98.17%` in `AUDIO_SIGNALS.md`
alone made tests 2 and 3 fail with
`mean expected root-change recall: config.yaml says 99.17%, AUDIO_SIGNALS.md
says 98.17%` plus both paths. The doc was restored byte-for-byte from a backup
and re-verified.

---

## Verification

| Suite | Result |
|---|---|
| config API errors, config store, config transaction, analysis config, audio config, derived-signals config, engine config link, derived config, **Derived Tune UI**, **derived PATCH ordering**, **note-evidence parity** | **123 / 123** |
| BPM evaluator (`bpm_tune_eval`), **noisy note holdout**, synthetic note | **20 / 20** |
| Full companion suite (`tests/companion/*.test.js`) | **211 / 211** |

- `git diff --check` → **clean** (only pre-existing CRLF warnings, none on my
  files).
- `gitleaks 8.28.0` over a copy of all seven touched files → **no leaks found**.
- `python scripts/security_check.py --all` → **6 findings, identical to the
  `_173` baseline**, all pre-existing MACs inside gitignored
  `simulation/.scene_backups/`. None in my files.
- No dotted-quad address added beyond the loopback/TEST-NET-1 the suite already
  uses. No future dates.

### State residue — zero

`marsin_engine/states/**` (40 files) SHA-256'd before and after the full
verification batch: **byte-identical**. `git status` on my touched paths shows
exactly the six modified files plus the one new test, and nothing under
`states/`.

Honest caveat: the hashes were taken *before the verification batch*, not before
my very first exploratory run. Everything I ran either only reads
`states/` (the note evals) or spawns an isolated `--no-mic` companion against a
fake engine on a free port; the companion only writes `mic_profiles.yaml` /
`companion_config.yaml` on an explicit operator export, which no test performs.
The operator's live engine also writes into that tree while I work, and none of
the 40 hashes moved during my window.

---

## Follow-ups (not done here)

1. **The scene-state overlay leaks into other audio gates too.** Eleven test
   files call `loadEffectiveAudioAnalysisConfig` — `bpm_tracker_octave`,
   `derived_signals_config`, `derived_signals_perf_finiteness`,
   `new_derived_signals`, `note_estimator_synthetic`, and four companion suites
   among them. Any of them whose assertions depend on analyzer *quality* rather
   than *shape* has the same reproducibility hole. Worth an audit; I fixed only
   the one whose numbers are published.
2. **A louder capture measurably improves note tracking.** At `bands.inputGain`
   9.1 the same holdout scores 98.27% settled, 100% recall and 22/24 clean, with
   p90 latency 620.6 ms instead of 853.6 ms. That is a tuning decision for the
   operator (and outside this thread's hard scope), but it is real evidence that
   the shipped `inputGain: 1` default in `config.yaml` is leaving accuracy on the
   table.
3. **`config.yaml` comments are destroyed by any autopilot save.** The parity
   block lives in YAML comments, and `js-yaml` dump strips every comment — a
   pre-existing hazard (`setup_config_guard.mjs` documents it) that would silently
   delete one of the two parity surfaces if an autopilot ever wrote the tracked
   config.
