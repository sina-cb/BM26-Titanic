# 2026-06-20 — Wave E1: detector real-audio re-tune (P0-1 / P0-2)

DEVELOPER slice on `dev/e1_detector_realaudio` (parent `feat/audio_analysis_2`,
fftSize 2048). Finishes the prior agent's stalled work. Headline P0 from the
adversarial re-wave 2 findings (`20260620_22`): the `AudioStructureDetector`
windowed drop edge false-fired on real continuous DJ music. Verified on the REAL
60-track CC corpus (`~/tmp/genre_corpus`, ~60 min, no clear EDM drops → every
`dropFired` is a false positive).

## BEFORE → AFTER (REAL corpus, the dance-floor safety metric)

| stage | REAL falseFiresPerMin | phantom drops | tracks firing | synthetic DROP recall |
|---|---|---|---|---|
| merged-tip baseline (report 22) | **1.48** | 89 / 60 min | 37/60 | 0.94 (synthetic-only artifact) |
| prior agent's uncommitted WIP | 0.87 | 52 / 59.8 min | 35/60 | 0.94 |
| **this slice (shipped default)** | **0.12** | **7 / 59.8 min** | **6/60** | **0.28** |

Target was ≤ ~0.15. **Achieved 0.12.** `inf-buildDur = 0` (P0-2 clamp holds).

Synthetic (all 3 mic tiers): `P=1.00 R=0.28 F1=0.43 lat=202ms negFP=0`,
BUILD corr=0.97, SLOW margin=0.66 — BUILD/SLOW unchanged; only DROP recall moved.

## Root cause the prior pass missed

The prior pass (report 22) gated only the **build-memory THIN edge** (rise 0.15 +
novelty 2.5) and stalled at 0.87/min. The diagnostic here measured *why*: with the
THIN edge fully OFF (`dropBuildGate:99`), **33 of 52 phantom drops still fire** —
from the **BUILD state**, which latches readily on busy continuous music. So the
THIN edge was never the whole story; **both drop edges false-fire**, and turning the
THIN edge off (the finding's fallback suggestion) only reaches 0.55/min.

## How the fix was found — fire-population diagnostic

Ran every candidate fire (gates OFF) over the real corpus (false) vs the synthetic
positives (true) and compared the gate values at fire time:

| feature | TRUE drops (moderate tier) | FALSE fires (real corpus) |
|---|---|---|
| windowed ratio | 5.2 – 13 | **bulk ≈ 1.9–2.0** (barely clear old 1.9) |
| novelty (ratio/median) | ≥ 5.2 | bulk ≈ 1.9–2.1 |
| buildScore rise | ≥ 0.30 | residual survivors ≤ 0.22 |

The bulk of phantom fires (57 of 89) sit at windowed ratio ≈ 1.9–2.0 — they *barely*
clear the old `dropEnergyJump` 1.9. A genuine moderate-tier drop reads ratio 5–13.
So raising `dropEnergyJump` to 4.0 cuts the entire phantom cluster in one stroke;
the residual handful are caught by requiring a real buildScore RISE and a novel
windowed-ratio outlier, applied to **both** edges.

## The honest Pareto choice

Clean-tier and heavy-tier synthetic true drops read windowed ratio ≈ **1.90–3.4** —
*the same gentle shape as a real busy-music transient*. There is **no ratio/novelty
threshold that separates them**: the clean synthetic drop is an idealised, fully
pre-compressed line-in step, indistinguishable from busy music. So driving REAL
ff/min ≤ 0.15 *necessarily* sacrifices clean/heavy synthetic recall — only the
realistic **moderate** mic tier (the playa-mic case) stays separable (5/6 fire).
This is the inherent frontier, independently reproduced across a ~30-point sweep.

Per the codex (no-fallback, fail-loud) **and** the operator directive — *a phantom
drop on the Burning Man dance floor is worse than a missed drop; under-firing is
acceptable* — we ship the **precision-first** point. The THIN edge stays ON (it is
not the dominant source; gating both edges is what works), but every drop path now
requires a real rising-build novel outlier.

Escape hatch documented in-source: an operator who wants the higher-recall arm can
`PATCH /audio/config {structureDetector:{dropEnergyJump:1.9, dropBuildRise:0,
dropNoveltyRatio:0}}` per-scene.

## Sweep evidence (REAL ff/min @ synthetic recall)

```
thin_off (THIN edge fully off)         0.551 @ R=0.61   ← off-by-default is NOT enough
both edges gated, rise0.15 nov2.5      0.568 @ R=0.67
jump4.0 rise0.28 nov3                  0.217 @ R=0.44
jump4.0 rise0.30 nov5.0 sz0.30 (SHIP)  0.117 @ R=0.28   ← chosen, ≤0.15 with margin
jump4.0 rise0.32 nov5.0 sz0.25         0.084 @ R=0.28   (tighter; sz0.25 risks active drops)
```

## Config keys changed (DETECTOR_DEFAULTS)

| key | old | new | role |
|---|---|---|---|
| `dropEnergyJump` | 1.9 | **4.0** | windowed ratio threshold; cuts the ≈2.0 phantom cluster |
| `dropBuildRise` | 0.15 | **0.30** | required buildScore rise; now gates BOTH edges |
| `dropNoveltyRatio` | 2.5 | **5.0** | required windowed-ratio novelty; now gates BOTH edges |
| `dropSlowZoneMax` | 0.4 | **0.30** | rejects residual phantoms at slowZone ≈ 0.36 |

The `dropBuildRise` / `dropNoveltyRatio` gates were widened from THIN-edge-only to
**both** drop edges (the structural fix). P0-2 `Infinity`-buildDuration clamp and the
corpus-as-negative `detection_eval` wiring (both prior-agent work) are kept intact.

## Tests

- `tests/audio_structure_detector.test.js` — 15/15 green. Reshaped the THIN-edge
  recall test and the `rampToDropAndCount` helper to a realistic **low-sub riser →
  sharp slam** (flux climbs while sub stays low, then the sub slams) so a genuine
  drop clears the shipped gates; the BUILD→drop test now runs under shipped tuning
  (no `dropEnergyJump` override) proving the real BUILD edge still fires. Added a
  **flat-high busy-music plateau** regression (high constant jittery energy+flux,
  no rise) → asserts ZERO drops. The mic-gain-floor test isolates its mechanism by
  disabling the (orthogonal) music-shape gates.
- `tests/detector_eval.test.mjs` — 11/11 green. Recall bar lowered to the honest
  precision-first floor (R≥0.25, F1≥0.40) with the trade-off documented in the
  header, and a NEW **REAL-corpus dance-floor safety test** asserts
  `falseFiresPerMin ≤ 0.15` + `infiniteBuildDur == 0` (skips cleanly when the
  ~/tmp corpus is absent in CI — offline-readiness, no fabricated pass). This is the
  test that would have caught the original 1.48/min regression.
- `tests/integration/*.test.mjs` — 55/59. The 1 leaf failure is the known-flaky
  `tick p99 ≤ 0.5 ms/hop` perf assertion (OS-scheduler artifact under parallel load;
  passes on isolated re-run; owned by Wave **E3**, not E1, per report 22).
- `node engine.js --list` OK; `--dry-run` exits 0, no missing-blend warning;
  `git diff --check` clean; no `states/*.yaml` residue.

## Files changed

- `marsin_engine/audio/detector/audio_structure_detector.js` — gates on both edges, new defaults.
- `marsin_engine/audio/config/audio_config.js` — validator comment (ranges already covered).
- `marsin_engine/tests/audio_structure_detector.test.js` — reshaped tests + plateau regression.
- `marsin_engine/tests/detector_eval.test.mjs` — honest recall bar + REAL-corpus safety test.
- `marsin_engine/tools/detection_eval.mjs` — (prior agent) corpus-as-negative wiring, kept.

THIN edge: **ON by default** (gating both edges, not disabling one, is the fix).
