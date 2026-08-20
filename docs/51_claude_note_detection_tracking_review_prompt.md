# Claude prompt: note detection and tracking review

Use this prompt with Claude Opus from the repository root.

```text
You are performing an independent, production-readiness review of BM26
Titanic's audio note-detection and note-tracking pipeline. Use Claude Opus and
prioritize correctness over speed or token cost.

First read and obey the repository Agent OS in this order:
1. .agent/context/boot.md
2. .agent/codex.md (read-only; never edit)
3. the relevant .agent/os, .agent/ops, .agent/skills, and audio role files
4. .agent/memory/MEMORY.md and relevant audio facts

This is a REVIEW AND DESIGN task only. Do not edit code, git state, runtime
state, tasks, or documentation. Do not stage, commit, rebase, or push. Fail
loudly if required evidence is unavailable. Use only offline/local repository
evidence unless I explicitly authorize internet research.

Review the complete signal path, not only the estimator:
- marsin_engine/audio/analyzer/audio_analyzer.js
  - FFT resolution/windowing and the 12-bin chroma fold
  - frequency limits, bin-to-pitch-class mapping, normalization, entropy and
    tonal-confidence calculations
- marsin_engine/audio/signals/note_estimator.js
  - dominant partial selection, octave invariance, MIDI/cents estimation
  - circular pitch-class filtering, hysteresis/hold timing, Kalman behavior,
    stability gates, silence/warm-up reset, and state transitions
- marsin_engine/audio/signals/derived_signals.js
  - publication/holding of audioNote and audioNoteHue during unstable/no-note
    frames; stale-note risks
- marsin_engine/audio/signals/switch_signals.js
  - rate limiting and note-change tracking relative to the last colored note
- marsin_engine/audio/signals/genre_classifier.js
  - note-change-rate consumption and whether estimator errors amplify into
    genre decisions
- marsin_engine/audio/postproc/audio_signals.js, the companion/API/WS/CPC
  publication path, and all relevant tests, synthetic sources, docs, reports,
  and durable memory.

Answer these questions with file:line evidence:
1. Can the detector reliably identify pitch class across C2-C7 at every
   supported sample rate, FFT size, and hop size?
2. Does it choose the fundamental rather than a louder harmonic for bass,
   voices, guitar/synth timbres, and octave-doubled material?
3. How does it behave on chords/polyphony? Is the published value explicitly
   a dominant/root pitch class, and do tests match that contract?
4. How does it reject kicks, hats, cymbals, broadband noise, transients,
   silence, clipping, and low-SNR playa input?
5. Are chroma bin boundaries, tuning offsets, A4 reference, cents wrapping,
   and circular statistics mathematically correct at B/C and E/F boundaries?
6. What is the measured detection latency and release latency? Can the
   median/hold/Kalman stack become sticky or miss musically useful changes?
7. Can held values make the UI or patterns appear to track a note after the
   estimator has declared no stable note?
8. Are resets deterministic across device reconnect, sample-rate change,
   analyzer restart, track change, silence, and clock discontinuity?
9. Are allocations and CPU cost safe at the audio hop rate? Look for hidden
   per-frame arrays, sorts, object churn, NaN/Infinity propagation, and timing
   dependence.
10. Do downstream switch and genre consumers interpret stability, pitch class,
    and note-change rate consistently?

Run the existing focused tests and identify missing executable coverage. Design
an adversarial deterministic test matrix using synthesized signals, including:
- sine sweeps and all 12 pitch classes over multiple octaves
- detuning around +/-50 cents and B/C wraparound
- fundamentals weaker than 2nd/3rd harmonics
- missing-fundamental tones
- two-note intervals, triads, inversions, bass-plus-lead, and octave doubles
- amplitude ramps, silence gaps, low SNR, pink/white noise
- kick/snare/hat/cymbal impulses and pitched percussion
- rapid note changes, vibrato, glissando, track changes, and reconnect/reset
- supported sample-rate/FFT/hop combinations

For each proposed test define the signal, expected published pitch class (or
explicit no-note), stability timing, latency bound, and acceptable error. Do
not accept tests that merely assert internal variables; verify the published
derived signal and at least one downstream consumer.

Deliver a concise review with:
A. Verdict: BLOCK / CONDITIONAL / READY
B. Findings ordered P0-P3, each with file:line evidence, reproduction, user/show
   impact, and the smallest robust correction
C. Current pipeline diagram and explicit behavioral contract
D. Existing test results and coverage gaps
E. Proposed deterministic test matrix with pass/fail thresholds
F. Production hardening design, separated into must-fix and later improvements
G. Questions requiring Sina's artistic/product decision (especially how chords
   should map to a single color)

Do not implement fixes. Be skeptical of comments and docs: verify claims
against executable code and tests. Clearly distinguish observed facts,
inferences, and recommendations.
```
