# 2026-06-20 — Detector RECALL pass (drop detection)

- **Branch:** `dev/detector_recall` (parent `feat/audio_analysis_2`)
- **Worktree:** `~/workspace/BM26-Titanic-worktrees/detector_recall`
- **Slot 3 ports:** engine 31368 / OSC 31300 (dry-run only; no servers left running)
- **Owns:** `audio/detector/audio_structure_detector.js`,
  `audio/config/audio_config.js` (detector params),
  `tests/integration/detector_scenarios.mjs`,
  `tools/detection_eval.mjs` / `detection_sweep.mjs`,
  `tests/audio_structure_detector.test.js`, `tests/audio_config.test.js`.

## Mandate

Raise drop-detection RECALL (shipped 0.56 — we missed ~44% of drops) **without
resurrecting phantom drops** — keep `falseFiresPerMin ≈ 0` (the honest metric
from report `20260620_12`). Expand the scenario set with the adversarial cases
from report `20260620_9` (loud no-build intro, riser-without-drop, double-drop,
breakdown-then-build second-drop), measure both recall on real-shaped drops AND
false-fires on the bait, and add a mic-gain-relative drop gate.

---

## Root cause of the misses (found via `detection_eval --overlays` + signal probes)

The shipped detector (report `20260620_4`) fired the windowed/level drop edge
**only from the BUILD state**. Two structural misses followed:

1. **Heavy-mic tier missed ~every drop (recall 0.17).** The THIN→BUILD entry
   gate requires `energyRatio` to be *rising for >1 s*. Through the playa mic
   the build saturates `energyRatio` at 1.0 (no monotone rise) and jitters, so
   `_energyRisingSinceMs` keeps resetting and **BUILD never latches** before the
   drop lands. The drop arrived while still in THIN → the edge (gated on BUILD)
   never fired. Probed: at a heavy-tier drop the windowed ratio (3.7×), the
   `dropMinLevel` floor, and `buildScore` (0.63–0.76) were ALL satisfied — only
   the BUILD-state gate blocked the fire.

2. **The post-breakdown SECOND drop was missed at moderate (recall 0.50).**
   After drop1 the machine fell SUSTAIN→THIN through the breakdown, and the slow
   BUILD re-entry didn't re-latch until *after* drop2 had already happened.

The `dropMinLevel` absolute floor (0.06) was **not** the blocker on the harness
(the SNR-renormalized mic lands drops at micLow ≈ 0.11, clearing 0.06 at every
tier) — but it IS a mic-gain liability on a real venue (report `20260620_9`):
a quiet feed lands a genuine drop below 0.06.

## The levers

### 1. Build→drop transition gate (the recall fix) — `dropBuildGate` + `dropBuildMemoryMs`
The windowed/level edge now fires from **THIN or BUILD**, gated NOT on the
brittle state machine but on a **recent build-score memory**: a sliding peak of
`buildScore` over the last `dropBuildMemoryMs` (3000) must reach `dropBuildGate`
(0.5). A real drop is preceded by a riser; a bare loud-body onset is not.
Measured separation across all tiers: real drops carry a 3 s build-peak of
**0.74–0.99**; techno/sustain/loud-intro onsets carry **≤ 0.22**. A 0.5 gate
splits them with wide margin. This recovers the missed drops with **zero** new
false-fires.

### 2. Slow-zone guard on the THIN-firing edge — `dropSlowZoneMax`
Opening the edge to THIN introduced ONE class of false edge: a build's *onset*
right out of a breakdown, where `buildScore` just crosses the gate while the
section is still calm. The slow-zone signal is a clean discriminator — a real
drop lands in an ACTIVE section (measured `slowZone ≤ 0.32` at every real drop)
while the build-onset sits at `slowZone ≈ 0.49–0.51`. The THIN-firing edge now
additionally requires `slowZone < dropSlowZoneMax` (0.4). Does NOT gate the
BUILD-state edge (already state-guarded).

### 3. Mic-gain-RELATIVE drop floor — `dropRelLevel` (shipped OFF, opt-in)
`dropMinLevel` is an ABSOLUTE micLow floor calibrated for the harness's
renormalized tiers. A real venue's mic gain / AGC can land a genuine drop below
it. When `dropRelLevel > 0` the floor becomes
`effFloor = clamp(dropRelLevel · loudnessRef, DROP_FLOOR_HARD_MIN, dropMinLevel)`,
where `loudnessRef` is a running peak-follower of the short envelope (fast
attack 0.5 s, slow release 8 s). It scales with the feed: a quiet venue shrinks
the floor (real drops still clear), a hot feed is capped at `dropMinLevel`, and
a hard min (0.02) keeps it above the noise floor on dead silence.

**Why OFF by default (honest Pareto point):** on the SNR-renormalized harness
tiers the absolute floor already lands correctly, and relaxing it there
reintroduces false-fires on the mic-compressed negatives — measured
`dropRelLevel:0.5 → falseFiresPerMin 0 → 0.38` on the scenario set. A phantom
drop on calm music is the worst dance-floor failure, so the SAFE default is the
pure absolute floor; an operator at a genuinely quiet-feed venue enables the
relative floor per-scene via `PATCH /audio/config {structureDetector:{dropRelLevel:0.5}}`.
A unit test proves the relative floor fires a quiet drop (micLow ≈ 0.042, below
the absolute 0.06) that the absolute-only floor misses, AND that a loud-onset
with no riser still does not fire.

## New scenarios (`detector_scenarios.mjs` + eval POSITIVES/NEGATIVES)

Adversarial cases from `20260620_9`, all degraded through the playa mic at 3
SNR tiers, labelled with ground-truth drop times:

- `loud_intro_no_drop` (NEG) — loud full mix from t=0, no riser; bait for the
  build gate.
- `riser_no_drop` (NEG) — a real riser that deflates into calm WITHOUT a drop;
  the hardest build-memory bait (build present, slam absent).
- `double_drop` (POS) — two drops ~4.5 s apart; refractory + short-rebuild test.
- `breakdown_then_drop` (POS) — loud body → long quiet breakdown → second build
  → second drop landing after the extended quiet (the recall hole).

## Before → After (all 3 mic tiers, `node tools/detection_eval.mjs`)

On the **expanded adversarial scenario set** (18 labeled drops; 5.30 min of
calm/bait audio). BEFORE = the shipped detector behaviour
(`dropBuildGate:1.0, dropBuildMemoryMs:0` ⇒ BUILD-state-only edge; relative
floor off):

| metric | BEFORE | AFTER (shipped) |
|---|---|---|
| Drop recall | **0.50** | **1.00** |
| Drop precision | 1.00 | 1.00 |
| Drop F1 | 0.67 | **1.00** |
| `guardedPrecision` | 1.00 | **1.00** |
| `falseFiresPerMin` | 0.00 | **0.00** |
| Drop latency | 191 ms | 180 ms |
| Build corr / peak err | 0.97 / −5 ms | 0.97 / −5 ms |
| Slow-zone margin / acc | 0.65 / 0.91 | 0.65 / 0.91 |

Per-tier recall (the headline — the heavy mic was nearly blind):

| tier | recall BEFORE | recall AFTER |
|---|---|---|
| clean | 0.83 | **1.00** |
| moderate | 0.50 | **1.00** |
| heavy | **0.17** | **1.00** |

All tiers: precision 1.00, `negFP = 0`. The two new bait scenarios
(`loud_intro_no_drop`, `riser_no_drop`) fire **0** drops at every tier.

Exact commands:
```
# AFTER
node tools/detection_eval.mjs --config default
#   → DROP P=1.00 R=1.00 F1=1.00 negFP=0 ; HONEST guardedP=1.00 ff/min=0.00
# BEFORE (BUILD-state-only edge)
node tools/detection_eval.mjs --json '{"dropEdgeMode":"windowed","dropEnergyJump":1.8,"dropMinLevel":0.06,"dropBuildGate":1.0,"dropBuildMemoryMs":0,"dropSlowZoneMax":1.0,"dropRelLevel":0,"slowZoneRef":0.07,"slowZoneWidth":0.04,"slowFluxFloor":0.10}'
#   → DROP P=1.00 R=0.50 F1=0.67 negFP=0
```

## New config keys (range-validated, live-tunable, registered in `audio_config.js`)

| key | default | meaning |
|---|---|---|
| `dropBuildGate` | 0.5 | recent buildScore peak required to fire the edge from THIN |
| `dropBuildMemoryMs` | 3000 | how long a build-score peak counts as "recent" |
| `dropSlowZoneMax` | 0.4 | THIN-firing edge only fires when slowZone is below this |
| `dropRelLevel` | 0 (OFF) | opt-in mic-gain-relative floor factor (see lever 3) |

No new CPC live keys (the detector still publishes the same six:
`audioStructure / audioBuildScore / audioEnergyRatio / audioVocalsHot /
audioDropPulse / audioSlowZone`). Internal constants added:
`LOUDNESS_ATTACK_TAU` (0.5 s), `LOUDNESS_RELEASE_TAU` (8 s),
`DROP_FLOOR_HARD_MIN` (0.02).

## Files changed

```
M marsin_engine/audio/detector/audio_structure_detector.js   (build-mem gate, slow-zone guard, loudness ref + relative floor)
M marsin_engine/audio/config/audio_config.js                 (4 new validated/live fields)
M marsin_engine/tests/integration/detector_scenarios.mjs      (4 adversarial scenarios)
M marsin_engine/tools/detection_eval.mjs                      (POSITIVES/NEGATIVES include the new scenarios)
M marsin_engine/tools/detection_sweep.mjs                     (sweep dropBuildGate + show gate column)
M marsin_engine/tests/audio_structure_detector.test.js        (+3 regression tests)
M marsin_engine/tests/audio_config.test.js                    (contract surface + new keys)
```

## Tests run (all green)

- `node --test tests/audio_structure_detector.test.js tests/detector_eval.test.mjs
  tests/integration/audio_analysis_validation.test.mjs tests/integration/auto_label.test.mjs
  tests/integration/mic_model.test.mjs tests/integration/signal_metrics.test.mjs
  tests/integration/detection_metrics.test.mjs tests/audio_config.test.js`
  → **106 / 106 pass**.
- Broad audio + companion: `tests/audio_analyzer.test.js tests/audio_signals.test.js
  tests/band_onsets.test.js tests/note_estimator_synthetic.test.js tests/genre_classifier.test.js
  tests/switch_color_note.test.js tests/party_mode.test.js tests/companion_server.test.js`
  → **81 / 81 pass**.
- **Frozen regression set NOT regressed**: `audio_analysis_validation.test.mjs`
  → 35/35 (the `synth_dataset` `double_drop` two-drops + the `steady_loud` /
  `silence` zero-fire negatives all still hold).
- New regression tests: drop fires from THIN on build-memory when BUILD never
  latched; build→drop gate rejects a loud-body onset with no riser; mic-gain
  relative floor fires a quiet drop that the absolute-only floor misses.
- **Engine dry-run**: `node engine.js --pattern test_const --model test_bench
  --port 31368 --dry-run` → exit 0, "Pattern loads and compiles OK", 52/52
  pixels patched, no missing-script warnings.
- **Hygiene**: `git diff --check -- marsin_engine` clean; `node --check` on all
  touched JS/MJS OK; no `states/*.yaml` residue; no servers left running
  (offline harnesses + dry-run only). Scratch in `~/tmp/` (gitignored).

## Captures

Per-scenario detector-vs-label SVG overlays:
`node tools/detection_eval.mjs --config default --overlays` →
`~/tmp/detection_eval/overlays/default.html` (no chromium in this datacenter →
self-contained SVG HTML is the viewable artifact; traces inspected: build rises
through both risers and peaks at each drop, fired markers land on every true
drop across tiers, the two bait clips show zero fired markers).

## Honest scope / follow-ups

- Ground truth is SYNTHETIC (labelled arcs degraded through the virtual mic).
  This validates the state machine + tuning against known truth at three SNR
  tiers; it does not establish real-world EDM accuracy — a human-labelled EDM
  drop corpus is still the right way to close the loop (the standing detector
  follow-up). No real corpus was reachable in this datacenter.
- The mic-gain-relative floor (`dropRelLevel`) ships OFF — it is the honest
  Pareto point: it can't be ON by default without trading away the zero-false-
  fire guarantee on the renormalized harness. It is wired, validated, and
  opt-in for a quiet-feed venue.
- Detector remains DISABLED by default + UI-locked (unchanged). This slice
  makes its recall trustworthy; re-enabling is the operator's call after a
  listening pass.
