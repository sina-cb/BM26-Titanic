# 2026-06-20 — Wave E3: perf test fix + allocation hoist + derived fail-loud

Branch `dev/e3_perf_robustness` (off `feat/audio_analysis_2`). Implements the E3
items from the adversarial re-wave-2 findings (`20260620_22`, "P1 — perf/tests/
robustness"). All work validated OFFLINE (no live engine needed). The audio chain
runs on the LAPTOP, not the Pi — perf here is hygiene, not a throughput wall.

## What changed (6 files, all in my ownership)

1. **Perf test rewritten** — `tests/derived_signals_perf_finiteness.test.js`.
   - OLD: timed ONLY `DerivedSignals.tick` (1 of 3 stages), asserted an arbitrary
     0.5 ms ceiling on wall-clock **p99** → flaky under concurrent `node --test`
     (OS-scheduler tail artifact; p50 rock-stable).
   - NEW: drives the **FULL per-hop chain** on a real ParamCenter exactly in
     engine order — `AudioAnalyzer.pushSamples` (real FFT) → onAnalysis (postproc
     `setMany` + `AudioStructureDetector.tick` + `DerivedSignals.tick`) — and times
     the whole `pushSamples`. Budget is **real-deadline-derived** (hop deadline =
     512/44100 = 11.6 ms): asserts **mean ≤ 2 ms** and **p50 ≤ 2 ms** (both
     contention-IMMUNE), plus a hard "p50 < hop deadline" sanity. The wall-clock
     **p99 is a SOFT warn** by default, promoted to a hard assert under
     `PERF_GATE=1` (quiet dedicated run). Finiteness assertions are ALWAYS-ON +
     hardened (added a NaN-input-tolerance test and a fail-loud-isolation test).

2. **Integration perf assertion fixed** — `tests/integration/
   audio_analysis_validation.test.mjs`. Same disease (0.5 ms p99 hard gate, the
   "pre-existing flake" the B2/D-wave logs called out). NEW: hard "p99 < 11.6 ms
   hop deadline" sanity + a 4 ms budget that WARNS by default, hard under
   `PERF_GATE=1`. The 35 integration tests stay green.

3. **Per-hop allocation hoisted** (codex allocation-free). Three `setMany([...])`
   payloads were rebuilt fresh every hop:
   - `derived_signals.js` (~25 objs/hop) → hoisted to `this._publishWrites` +
     a key→index map (`this._wIdx`), built ONCE in the constructor; tick mutates
     only `.value`. Same for the `_zero()` disable/reset publish.
   - `engine.js` onAnalysis (~19 objs/hop) → hoisted to a `micWrites` array
     allocated once per analyzer build; the callback mutates `.value` in place.
   - The analyzer "onAnalysis ~:682" the findings listed is a plain OBJECT passed
     to the engine callback (not a `setMany`); the actual third `setMany` is the
     engine one above — hoisted.
   `param_center.setMany()` reads each entry synchronously and never retains the
   array/objects, so reuse is safe. Allocation eliminated: ~3,800 obj/s gone
   (25+19 objs × 86 Hz). Verified the array + every object keep stable identity
   across 1000 ticks (scratch check) while values update. Behavior byte-identical:
   the registry/snapshot suite (`audio_signals.test.js`) + `new_derived_signals`
   stay green (30/30).

4. **`DerivedSignals.tick` fail-loud** (codex P0 — was fail-quiet). OLD: one
   `try { …ALL module updates + publish… } catch { _fatal = true }` permanently
   blanked the WHOLE derived chain (BPM/party/note/genre) for the session on a
   single bad signal. NEW: each sub-module update runs under `_runModule(name,
   fn, safe)` — a throw is logged **LOUD** (`console.error`, once per module),
   recorded into an operator-visible `getStatus().moduleErrors` map, sets
   `degraded`, and that ONE module falls back to a frozen SAFE result for that hop
   only; every healthy module keeps publishing. `_fatal` now escalates ONLY if the
   CPC publish path itself (`setMany`) fails (nowhere left to write). **engine.js**
   folds `degraded`/`fatal`/`moduleErrors` into the `audioStatus` broadcast on a
   health transition (gated — no per-hop spam) so the operator SEES it, not just
   stderr. Documented choice: per-module isolation + loud, not let-it-throw
   (a single bad signal must not blank the lights mid-show).

5. **Genre harness fftSize 1024 → 2048** — `tests/genre_eval_harness.test.mjs`
   now passes the deployed `PRODUCT_FFT_SIZE = 2048` to both `runWav` calls (was
   testing a config the engine no longer runs).

6. **P2: `Math.hypot` → `Math.sqrt(re*re+im*im)`** in the analyzer flux loop
   (`audio_analyzer.js:526`, ~2.8× faster). Only the flux-accumulation loop
   changed; `_bandEnergy` (the byte-identical legacy band outputs) is untouched.
   FFT bins are well within float range, so the overflow-safe scaling `hypot`
   pays for is never exercised — outputs unchanged. The flux tests (range-based)
   + the "five legacy outputs byte-identical" test stay green.

## Proof

- **3× full deterministic suite** `node --test tests/audio_*.test.js
  tests/integration/*.test.mjs tests/*.test.mjs`:
  RUN1 **228 pass / 0 fail**, RUN2 **228 / 0**, RUN3 **228 / 0** — identical,
  green every run.
- **Full-chain perf** (real FFT + detector + derived, 19.5k steady hops):
  `mean=0.39 ms  p50=0.33 ms  p99=0.94 ms` vs an 11.6 ms hop deadline (~30×
  headroom — matches the auditor's number). `PERF_GATE=1` also passes
  (p99 ≈ 1.0 ms < 5 ms gated ceiling).
- **Allocation**: hoisted array + all 25 derived objects keep stable identity
  across 1000 ticks (before: 25 objs + 1 array per hop = ~2,150 obj/s; after: 0).
  engine `micWrites` hoisted the same way (~1,640 obj/s → 0).
- **Fail-loud**: injected a throwing `climax` module → `getStatus().degraded=true`,
  `moduleErrors.climax` set, `fatal=false`, `audioClimax` falls back to 0 while
  `audioParty`/`audioBpm` keep publishing (test 4 in the perf file).
- **Engine** `--dry-run` (slot-3 port 31368): exit 0, "Pattern loads and compiles
  OK", 52/52 pixels patched, no missing-blend warning. `node --check` on all 6
  changed files: pass. `git diff --check`: clean.
- **Regression**: detector + companion + detector_eval sweep **96 / 0**;
  registry/derived **30 / 0**.
- **Clean git status** — only the 6 owned files; no `states/*.yaml` residue.

## Notes for the instigator at merge

- `derived_signals.js` + `engine.js` are SHARED hubs E1/E2 also touch. My
  `derived_signals.js` rewrite preserves the exact published key set + order +
  values (registry snapshot green) — a union merge with E2's per-module signal
  edits should keep BOTH (E2 edits the signal modules; I only restructured the
  guard + publish in the hub). The engine edits are localized to the onAnalysis
  block + the `audioState.lastDerivedHealthKey` init.
- The perf budgets are intentionally soft on the p99 TAIL (warn unless
  `PERF_GATE=1`) so the merged suite stays deterministically green in CI; the
  mean/p50 hard gates + always-on finiteness are the load-bearing guards.
