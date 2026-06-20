# 2026-06-20 — NEW structure/anticipation PATTERNS (dev/patterns_new_signals)

Five NEW audio-reactive lighting patterns (numbers **64–68**) that MODULATE off
the Wave-D derived STRUCTURE / ANTICIPATION signals that D3's round-2 patterns
(59–63) did NOT cover. Built on `dev/patterns_new_signals` (parent
`feat/audio_analysis_2`, slot 3, engine port 31368). Modulators-only repo
contract honoured: patterns NEVER read CPC audio globals natively — the engine
OVERRIDEs their sliders from the signals. House style followed: high-contrast,
true-black negative space, never fully dark on silence, coordinate-driven
(x/y/rad + section geometry) so they port test_bench 52 → titanic 970 unchanged,
strict cp1↔cp2 RGB palette blends, autonomous idle so the rig is alive in silence.

Owned + touched: `marsin_engine/patterns/64..68_*.js` (NEW) +
`marsin_engine/patterns/manifest.json` (5 names appended before `rainbow`,
now 68 entries). No engine/analyzer/signal-module changes.

## Validation method (REAL DSP, end-to-end, MANDATORY proof)

The shipped `tools/pattern_audio_harness.mjs` drives only the 5 RAW analyzer
signals. D3 built a derived-signal harness replicating the engine's `onAnalysis`
pipeline; I adapted it to point at THIS worktree's engine and added a clean
whole-HOP segment-switched variant for the track-change gap proof:

```
synth → real AudioAnalyzer (sub:{30,60} window, matching config.yaml)
      → ParamCenter raw mirrors (setMany, same keys as engine.js ~1440)
      → real AudioStructureDetector.tick (enabled)
      → real DerivedSignals.tick  → derived CPC keys
      → OVERRIDE modulation (param = lerp(min,max,curve(signal)))
      → MarsinVM render (test_bench) → capture + correlation
```

Scratch harnesses + probes + clips live in `~/tmp/patterns_new_signals/`
(gitignored). Drivers:
- `derived_harness.mjs` — single-synth render + correlation (riser/edm/full/silence).
- `gap_render.mjs` — whole-HOP, segment-switched (full→silence→full) so
  `audioTrackChange`/`audioSilence` fire IDENTICALLY to the green
  `new_derived_signals.test.js` driveChain (verified: 1 track-change edge, 1
  silence latch in the gap — the per-25ms-frame harness mis-aligned the gap
  re-onset, so I matched the test's whole-HOP cadence for the honest proof).
- `probe.mjs` / `gap_probe3.mjs` — signal-availability + edge-count probes.

**Signal-availability reality check** (probe across the synth bank, 14–28 s):

| signal | where it fires usefully (peak / edges) |
|---|---|
| `audioRiserScore` / `audioRiserConf` | riser 0.84 / 0.98 · edm_drop 0.85 / 1.00 |
| `audioDropCountdown` | pulse train on riser + edm in the final build beats |
| `audioClimax` | full_track 0.94 sustained · edm_drop 1.00 on the drop sustain |
| `audioPhrasePhase` / `audioPhraseBoundary` | full_track ramp 0→1, 1 wrap @ ~8 bars |
| `audioSilence` / `audioTrackChange` | gap trace: silence latches, 1 track-change on re-onset |
| `audioDropPulse` / `audioSwitchPattern` | edm_drop on the drop (release pulses) |

Each pattern: COMPILE_OK, ANIMATING, ≥1 REACTIVE mapping, silence-safe (renders +
stays lit on `--synth silence`), real-engine `--dry-run` exit 0 (all five). Clean
`git status` (only the 5 patterns + manifest changed; no state residue from
test_bench dry-runs).

---

## 64_drop_countdown — 4-3-2-1 strobe count-in that releases on the drop

**Concept.** When a riser is genuinely PEAKING, `audioDropCountdown` emits a
beat-synced pulse train (peak-gated upstream — NOT on false builds). Each pulse
SLAMS the whole rig to a hard strobe flash and stacks one count ring filling
inward from the rim toward centre (4→3→2→1), colour heating cp1→cp2 across the
count. `audioDropPulse` BLOWS the rig white-hot and snaps an expanding shock ring
outward, clearing the stack. Calm base wash keeps it alive in silence.

**Signals.** `audioDropCountdown→sliderCountdown`, `audioDropPulse→sliderRelease`.

**Reactivity.** riser: countdown→bri **0.99** (REACTIVE). edm_drop:
countdown→bri **0.37** (REACTIVE), dropPulse→bri **0.84** (REACTIVE), peak 255.
Silence: 52/52 lit, min total 569, never dark. High darkFrac between strobes is
the intended true-black-negative-space strobe look.
Clip: `~/tmp/patterns_new_signals/clips/64_drop_countdown.html` (185 colours, edm_drop).

## 65_climax_hold — biggest sustained look, locked on the climax

**Concept.** `audioClimax` (sustained full-spectrum peak plateau) BLOOMS the rig
to FULL COVERAGE at max brightness: the lit core expands to the rim, a grand
sweep crosses the hull, the palette pushes fully to cp2, a white-channel core
adds POWER. Attack/release-eased `held` ramps in fast and RECEDES slowly when the
section ends (graceful come-down, no hard cut, no strobe — a climax is power, not
flicker). `audioBeat` adds a subtle locked pulse on top. Calm centre core wash
holds the rig alive in silence (floor lifted with a small global term so it reads
as welcoming, not a near-black dot).

**Signals.** `audioClimax→sliderClimax`, `audioBeat→sliderBeat`.

**Reactivity.** full_track: climax→bri **0.94** (REACTIVE) + hue-react 0.54 (heats
cp1→cp2), 52/52 lit at peak 255. Silence: 27/52 lit, min total 357, never dark.
Clip: `~/tmp/patterns_new_signals/clips/65_climax_hold.html` (1960 colours).

## 66_phrase_stepped — a musical step on every 8-bar phrase boundary

**Concept.** `audioPhrasePhase` (0→1 across the current 8-bar phrase) sweeps a
bright band across the hull along the current geometry axis, with a soft fill
behind it (the rig fills up as the phrase advances — you can SEE the wrap coming)
and a cp1→cp2 colour glide. `audioPhraseBoundary` STEPS the rig: it advances a
4-mode geometry rotation (radial rings → vertical columns → horizontal bars →
diagonal) and a palette anchor rotation, with a clean flash so the change reads
as intentional/on-the-music. Phrase signals are silence-gated upstream (no grid
over a noise floor). Calm base wash in silence.

**Signals.** `audioPhrasePhase→sliderPhrasePhase`, `audioPhraseBoundary→sliderBoundary`.

**Reactivity.** full_track 28 s: phrasePhase→bri **0.47** (REACTIVE, the fill
grows with the phrase) + hue-react **−0.54** (palette glides across the phrase),
phraseBoundary→bri **0.38** (REACTIVE, the step flash), peak 255. Silence:
52/52 lit, min total 754, never dark.
Clip: `~/tmp/patterns_new_signals/clips/66_phrase_stepped.html` (5645 colours).

## 67_track_reset — graceful fade-to-calm + palette reset between tracks

**Concept.** The DJ-transition moment, handled with grace. When `audioSilence`
latches (a quiet gap), the rig EASES into a slow dim calm standby wash — clearly
quieter but ALIVE and welcoming, NEVER dead-black (codex never-fully-dark as a
first principle). When `audioTrackChange` fires (gap re-onset / tempo relock /
harmonic cut), the rig gently BLOOMS back up and SNAPS a fresh palette rotation —
a clean recolour announcing the new track, soft wash-in (not a strobe). Each
track gets its own colour identity.

**Signals.** `audioSilence→sliderSilence`, `audioTrackChange→sliderTrackChange`.

**Reactivity** (gap trace full_track:6 → silence:3 → full_track:6, whole-HOP):
silence→bri **−0.67** (REACTIVE — the rig DIMS gracefully on silence, NEGATIVE by
design = the intended dim), `audioTrackChange` fires **1 rising edge** → the
re-bloom + palette step (REACTIVE), peak 160. Silence (standalone synth):
52/52 lit, min total 1380, never dark.
Clip: `~/tmp/patterns_new_signals/clips/67_track_reset.html` (2823 colours, gap trace).

## 68_riser_sweep — accelerating upward sweep that climbs with the riser

**Concept.** Distinct from #61_riser_release (which charges a CENTRE ring off the
detector's `audioBuildScore`): this reads the dedicated `audioRiserScore` and
expresses the build as the other classic riser gesture — a bright band that
SWEEPS UPWARD (low y → high y) and ACCELERATES as the build intensifies, widening
and brightening, colour heating cp1→cp2. `audioRiserConf` GATES the commitment
(low-confidence guess stays subtle, confident build commits fully — honest, not
over-eager). `audioDropPulse` BURSTS: a final upward flash filling the hull, then
collapse to calm. Global build swell biased toward the top makes brightness rise
with the build (positive corr) AND the motion visibly accelerate.

**Signals.** `audioRiserScore→sliderRiser`, `audioRiserConf→sliderRiserConf`,
`audioDropPulse→sliderRelease`.

**Reactivity.** riser: riserScore→bri **0.81**, riserConf→bri **0.77** (both
REACTIVE). edm_drop: riserScore→bri **0.52**, riserConf→bri **0.32**,
dropPulse→bri **0.71** (all REACTIVE), peak 255. Silence: 52/52 lit, min total
543, never dark.
Clips: `~/tmp/patterns_new_signals/clips/68_riser_sweep.html` (riser, 2253 colours)
+ `68_riser_sweep_edm.html` (edm_drop, 2228 colours).

---

## Proof summary

| # | pattern | signals used | headline reactivity | dry-run |
|---|---|---|---|---|
| 64 | drop_countdown | audioDropCountdown, audioDropPulse | countdown→bri 0.99 (riser); drop→bri 0.84 (edm) | exit 0 |
| 65 | climax_hold | audioClimax, audioBeat | climax→bri 0.94 (full_track), peak 255 | exit 0 |
| 66 | phrase_stepped | audioPhrasePhase, audioPhraseBoundary | phrasePhase→bri 0.47 + hue −0.54; boundary→bri 0.38 | exit 0 |
| 67 | track_reset | audioSilence, audioTrackChange | silence→bri −0.67 (graceful dim); 1 track-change edge | exit 0 |
| 68 | riser_sweep | audioRiserScore, audioRiserConf, audioDropPulse | riser→bri 0.81/0.77; drop→bri 0.71 (edm) | exit 0 |

All five: COMPILE_OK, ANIMATING, silence-safe (render + lit, never dark),
registered in `patterns/manifest.json` (68 entries), real-engine `--dry-run`
exit 0. Clips embed rich animated colour (185–5645 unique colours; the strobe
pattern 64 is intentionally sparser with true-black negative space). Regression:
`npm run check:rainbow` OK. Clean `git status` (5 patterns + manifest only).

## Notes / follow-ups
- The whole-HOP `gap_render.mjs` harness is the correct way to validate the
  track-change/silence signals (the per-25ms-frame `derived_harness.mjs` aligns
  the gap re-onset boundary mid-frame and mis-fires the gap cue). Worth promoting
  a derived + gap harness into `marsin_engine/tools/` in a future session
  (out of this pattern-only slice's ownership; same flag D3 raised in #16).
- `tools/audio_mod_spec.mjs` only accepts the 5 raw `mic*` signals in its
  `AUDIO_MODULATION_V1` parser (regex requires a `mic` prefix). Like D3's 59–63,
  these patterns use the same documented block form with `audio*` derived signal
  names — NOT parsed by any test or by the engine at load (the block is operator/
  doc-facing; the engine OVERRIDEs sliders from the signals). No gate is broken.
