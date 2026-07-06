# 2026-06-20 — NEW derived lighting signals (riser / track-change / climax / phrase / countdown)

**Author:** DSP/signals sub-agent (slot 1, worktree `new_derived_signals`,
branch `dev/new_derived_signals` off `feat/audio_analysis_2`).
**Scope:** five NEW second-tier derived signals from report `20260620_2`
(#1 riser/anticipation, #3 track-change/silence, #8 climax, #6 phrase, #7
countdown). Pure, allocation-free modules driven from ALREADY-published CPC
keys (no analyzer change), wired into `DerivedSignals.tick` in ONE localized
block, registered in `postproc/audio_signals.js`.

## EXACT new CPC key names (for reconciliation)

Registered in `audio/postproc/audio_signals.js` `DERIVED[]`, appended after
`audioGenreConf` and BEFORE the slot-3 onset raw/pulse block (registry order
matters — the `audio_signals.test.js` snapshot pins it):

| Key | Range | Hz | Meaning |
|---|---|---|---|
| `audioRiserScore` | [0,1] | 15 | how strongly we're building right now |
| `audioBuildEta` | [0,60] **seconds** | 10 | best-effort sec to predicted drop (0 = no honest estimate) |
| `audioRiserConf` | [0,1] | 10 | honest confidence in the riser/ETA |
| `audioSilence` | [0,1] (0/1) | 5 | in a quiet gap (loudness below OFF, held) |
| `audioTrackChange` | [0,1] (pulse) | 15 | one-shot likely-new-track edge |
| `audioClimax` | [0,1] | 10 | on a sustained full-spectrum peak plateau |
| `audioPhrasePhase` | [0,1] | 15 | position within the current 8-bar phrase |
| `audioPhraseBoundary` | [0,1] (pulse) | 15 | one-shot on a phrase wrap / drop re-anchor |
| `audioDropCountdown` | [0,1] (pulse train) | 30 | beat-synced flashes in the final build beats |

All engine-internal derived — **no inbound OSC binding** (like `audioGenre`).
`audioBuildEta` is the only non-`[0,1]` key (carries seconds, range `[0,60]`).

## Files

NEW (owned):
- `audio/signals/build_anticipation.js` — `BuildAnticipation` (#1)
- `audio/signals/track_change.js` — `TrackChange` (#3)
- `audio/signals/climax.js` — `Climax` (#8)
- `audio/signals/phrase_tracker.js` — `PhraseTracker` (#6)
- `audio/signals/drop_countdown.js` — `DropCountdown` (#7)
- `tests/new_derived_signals.test.js` — 22 tests (full-chain + unit)

EDITED:
- `audio/signals/derived_signals.js` — import + construct + reset + ONE tick
  block + 9 setMany keys + 9 `_zero` keys (the merge prediction, below).
- `audio/postproc/audio_signals.js` — 9 `DERIVED[]` descriptors.
- `tests/audio_signals.test.js` — 9 entries added to the registry snapshot pin.
- `tests/derived_signals_perf_finiteness.test.js` — 9 keys added to `NEW_KEYS`
  (finiteness/range coverage through the publish path).

## Each signal — algorithm

### 1. Riser / build-anticipation → `audioRiserScore` / `audioBuildEta` / `audioRiserConf`
Dual-EMA SLOPE of three rising-evidence signals: spectral flux (`micFluxRaw`),
high-band (`micHighRaw`), and a high-weighted loudness proxy from the raw bands
(the "energy rising" term — works detector-OFF, where `audioEnergyRatio` is 0).
Score = `cbrt(fluxSlope · highSlope · loudSlope)`; the GATE is flux∧high rising
together (a lone hat/swell doesn't read as a build). `slowTau=4 s`, `slopeRef=0.08`
(a multi-second riser only opens a ~0.08 fast/slow gap). When the structure
detector is enabled, `audioBuildScore` blends in (weight 0.45) and boosts
confidence; OFF, raw slopes carry it and **confidence is capped at 0.8** (honest:
we're guessing more). A drop (`audioDropPulse`) collapses the score; detector-OFF
it collapses ORGANICALLY (the rising evidence vanishes when kick+bass replace the
riser). **ETA** is best-effort: bars-since-rise → bars-to-next-16-bar-boundary ×
beat-seconds, published only when BPM is locked; **honest caveat — absolute drop
prediction is unreliable** (BPM can lock an octave off during a build; the ETA is
a guess, gated behind `audioRiserConf`, and the countdown does NOT trust the raw
ETA seconds).

### 2. Track-change / silence → `audioSilence` / `audioTrackChange`
PartyMode-style loudness EMA + Schmitt + HOLD so a 1-bar breakdown isn't a false
change. `audioSilence` latches after `silenceConfirmMs=450 ms` of quiet.
`audioTrackChange` fires (min spacing 4 s, after a 1.5 s warmup) on the strongest
cue: (a) GAP RE-ONSET — silence ≥ `gapMinMs=600 ms` then music returns (the
canonical cue); (b) TEMPO RELOCK at a BPM differing ≥ 6; (c) HARMONIC CUT — a
pitch-class jump bracketed by a loudness dip-then-recover.

### 3. Climax / sustained-peak → `audioClimax`
A FULL-SPECTRUM plateau: loudness near a slow-decaying ceiling (`ceilFrac=0.8`)
AND bright top end (`micHigh ≥ 0.12`) AND **bass body (`micLow ≥ 0.2`)** — the
bass-body requirement is what separates a climax (drop/sustain) from a RISER
(bright + rising but no bass yet). Must HOLD `holdMs=900 ms` (or `350 ms` within
6 s of a drop) before the attack/release-smoothed gate ramps up. Pure presence,
no events.

### 4. Phrase / 8-bar → `audioPhrasePhase` / `audioPhraseBoundary`
Counts bars on the `audioDownbeat` rising edge, mod-8, fires a boundary on the
wrap; `audioDropPulse` re-anchors the count to bar 0 (a drop IS bar 0 of a new
phrase — makes the relative grid reliable despite unknowable absolute alignment).
Phase = `(barCount + barPhase) / 8`. **Silence-safe:** gated on `bpmLocked` AND
`active` (the party gate) — the BPM tracker spuriously locks on a near-silent
noise floor, so without the `active` gate it would publish a fictitious phrase
grid over silence (this was caught + fixed in validation).

### 5. Drop countdown → `audioDropCountdown`
Beat-synced pulse train. **Peak-gated, not ETA-gated** (codex honesty — the ETA
seconds are unreliable): arms only when the riser is PEAKING (`riserScore ≥ 0.7`,
`riserConf ≥ 0.6`) and the peak has HELD `≥ 600 ms`, BPM locked, no drop in the
last 4 s. Fires one pulse per `audioBeat` rising edge. A steady track never peaks
the riser → never counts down ("NOT on false builds"). A drop / the riser falling
out of peak disarms immediately.

## Validation (offline, deterministic — REAL pipeline + synth bank)

Driver: `tests/new_derived_signals.test.js` wires the REAL chain exactly like
`engine.js` onAnalysis — `AudioAnalyzer` → `AudioStructureDetector` →
`DerivedSignals` over a real `ParamCenter`, fed by the synth bank
(`audio/synth/test_synths.js`). **22 tests, all green.** Full suite: **830/830**.

Per-synth peak/fire numbers (detector OFF = default deployment / ON):

| synth | riserPeak | climaxPeak | countdownFires | phraseBound | trackChange | silenceHops |
|---|---|---|---|---|---|---|
| `riser` | 0.81 / 0.84 | 0 / 0 | 1 / 2 | 0 | 0 | 0 |
| `edm_drop` | 0.83 / 0.85 | 1.00 / 1.00 | **4 / 3** | 0 / 1 | 0 | 0 |
| `full_track` | **0.06 / 0.14** | 1.00 / 1.00 | **0 / 0** | 0 | 0 | 0 |
| `silence` | **0 / 0** | **0 / 0** | **0 / 0** | 0 | 0 | 822 |
| `chord_progression` | 0.78 / 0.71 | 0 / 0 | **0 / 0** | 0 | 0 | 0 |

Track-change gap test (`full→silence→full`): **1** track-change, **1** silence
latch (175 hops held in the 3 s gap). Steady `full_track` (15 s): 0 track-change,
0 silence. Phrase wrap (`full_track` 28 s): **1** 8-bar boundary; 15 s: 0
(not enough bars). Each proven: riser rises through a build + resets on the drop;
track-change fires across a silence gap; climax holds on a sustained loud section
and NOT on a riser; phrase boundary on bar multiples; countdown before a predicted
drop and NOT on false builds; silence-safe everywhere.

**Perf:** `DerivedSignals.tick()` p99 = **0.42 ms** over 200k hops with party +
genre + slot-3 shapers + all 5 new modules hot — under the 0.5 ms/hop budget.

**Honest known soft-FP:** `chord_progression` reads `riserScore ≈ 0.78` (a steady
melodic progression has slowly-drifting flux/high). This does NOT trigger a
countdown (peak-hold gate filters it) and does NOT climax (no bass plateau). The
riser is documented (report #1) as "ship the score as reliable, ETA best-effort";
on real EDM (vs this synthetic looping progression) the steady-state slope is
smaller. Left honest rather than over-tuned to the synth.

## Gates
- `node --test tests/*.test.js` → **830 pass / 0 fail** (22 new).
- Engine `node engine.js --dry-run --model test_bench` → **exit 0**.
- `node --check` clean on all changed files; `git diff --check` clean.
- Dry-run state residue (`states/summer_camp_dome/*.yaml`, sim playlist)
  **restored** via `git checkout`. Clean `git status` (only intended changes).

## Merge prediction (for the instigator union-merge)
`derived_signals.js` touched in **5 small spots**, all union-adds (no edits to
existing lines): (1) 5 imports after the genre import; (2) 5 `new …()` in the
ctor after `_genre`; (3) 5 `.reset()` in `reset()`; (4) ONE commented tick block
(the 5 `.update()` calls) after the genre `gn` update; (5) 9 `setMany` keys +
9 `_zero` keys. `audio_signals.js`: 9 descriptors appended to `DERIVED[]`.
`audio_signals.test.js` + `derived_signals_perf_finiteness.test.js`: 9 entries
each, appended. No analyzer/config/engine.js changes. A union merge with the
sibling slices' `derivedSignals` blocks is conflict-light (all appends).
