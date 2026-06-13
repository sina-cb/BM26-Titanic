# Slot 1 — audio_normalizer_calib

- **Branch:** dev/claude/audio_normalizer_calib
- **Parent branch:** claude/laughing-lamport-tb6cc9
- **Worktree:** ~/BM26-Titanic-worktrees/audio_normalizer_calib
- **Slot ports:** engine 31168, sim 31169, metro 31181 (none booted — pure unit work)

## Scope

Three additive, low-overlap pieces around the audio post-processing chain
framework (`docs/29`):

1. **Normalizer (AGC) op** — a 13th operator in `SignalPostProcessor`. A
   per-sample causal auto-gain-control built from a dual floor/peak envelope
   follower (Pirkle / Zölzer DAFX adaptive level), so a new venue/mic
   auto-levels into `[0,1]` without re-tuning `PRE_CLAMP_GAIN` / `bands.noiseGate`
   by hand. O(1) per sample, no history buffer. Params: `windowSec` (1..120,
   default 30) and `strength` (0..1, default 1.0) blending raw↔normalized.
2. **Calibration tool** — `marsin_engine/tools/audio_calibrate.js`, a standalone
   ESM CLI that listens to the live mic (capture→analyzer only, no engine boot)
   for `--seconds` and prints a suggested `bands.noiseGate` (p90 of the
   quiet-room band floor) plus per-band min/median/max/p90 and a
   copy-pasteable `audio_state.yaml` YAML snippet. Writes nothing to disk. The
   analysis math is in a pure, unit-tested `summarizeBandSamples()` helper since
   live capture can't run in CI.
3. **Doc** — `docs/33`... (number 33 was already taken by
   `33_controller_mapping.md`, and `signal_post_processor.js` already references
   "docs/34" for the calibration companion) → written as
   **`docs/34_pro_audio_via_osc_sidecar.md`**. Documents the OSC live-key surface
   as the official extension point for heavyweight pro audio (aubio/Essentia/
   madmom sidecar over OSC), mirroring the `stems*` / `/lx/tempo/bpm` path; the
   two-lane (fast in-engine vs. heavy out-of-engine) architecture; how to
   register a `/marsin/audio/<key>` live key; and why it keeps the engine
   offline-safe and dependency-free.

Note: Piece 1 (the Normalizer op + its inline citations in
`signal_post_processor.js`) arrived **already written as an uncommitted change**
in the worktree. I reviewed it for correctness (divide-by-zero epsilon guard,
NaN/Inf safety, range clamping, runtime init, opCatalog auto-derivation), added
the missing test coverage, and committed it. Pieces 2 and 3 are new this slot.

## Files changed

```
M  marsin_engine/lib/signal_post_processor.js   (normalizer op: OP_SCHEMA, _applyOp case, _initRuntime)
M  marsin_engine/tests/signal_post_processor.test.js  (catalog 12→13; +12 Phase-8 normalizer tests)
A  marsin_engine/tools/audio_calibrate.js
A  marsin_engine/tests/audio_calibrate.test.js
A  docs/34_pro_audio_via_osc_sidecar.md
```

## Tests run

- Unit: `node --test tests/signal_post_processor.test.js tests/audio_calibrate.test.js`
  → **118 pass / 0 fail** (was 105 before; +12 normalizer subtests, +14
  calibrate subtests, with the prior catalog-count test updated 12→13).
  - Normalizer coverage: schema accept/reject (out-of-range windowSec/strength,
    unknown param key), output always in `[0,1]` over 2000 noisy samples,
    flat-input divide-guard (50k constant samples stay finite/in-range),
    constant-input convergence/stability, step-up re-normalization over the
    window, `strength=0` identity, `strength=0.5` exact-midpoint blend, patchOp
    floor/peak preservation, YAML round-trip.
  - `summarizeBandSamples`/`parseArgs` coverage: min/median/max/p90 (type-7),
    p90 noiseGate suggestion, quiet-room + all-ones gate clamping, empty/non-
    finite throws, flag parsing + unknown-flag/missing-value rejection.
- Engine auto-checks (`.agent/00_gol/05`):
  - `git diff --check -- marsin_engine marsin_pb` → pass
  - `node --check` on all 4 changed/new JS files → pass
  - `node engine.js --list` → rc 0
  - `node engine.js --pattern test_const --model test_bench --dry-run` → rc 0,
    52 pixels, no missing blend/transition warning
  - Calibration CLI: `--help` exits 0; unknown flag exits 1 with a clear message.
- HIL: not run — this slot changes no mixer/blend/transition behavior (pure
  additive op + standalone tool + doc). No tracked `states/` files modified
  (`git diff --stat -- marsin_engine/states/` empty).
- Sim smoke / CaptainPad: N/A (no sim or CaptainPad changes).

## Known gaps / follow-ups

- The Normalizer op is **available in the catalog but NOT default-installed** on
  any signal (the Phase-7 "no new default ops" contract test still holds). An
  operator adds it via PUT/PATCH or YAML. Wiring it into a default chain is a
  future operator decision.
- The calibration tool's live-capture path (`collectSamples`) is exercised only
  manually (it needs a real mic + ffmpeg); only the pure helpers are unit-tested,
  by design.
- Doc numbered **34**, not 33 (33 was occupied). If the instigator prefers a
  different number, it's a rename only — no inbound links point at it yet beyond
  the `signal_post_processor.js` comment, which already says "docs/34".
- `marsin_engine/node_modules` is a symlink into the main checkout (harness
  setup); it was deliberately NOT staged.

## Operator action requested

Ready for review and merge. Pure-additive branch (one shared file touched
additively: `signal_post_processor.js`; everything else new) — low conflict
risk, safe to merge early per §8.2. Please confirm the `docs/34` number is
acceptable.
