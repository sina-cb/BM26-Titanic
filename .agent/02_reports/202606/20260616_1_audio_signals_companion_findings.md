# Audio analysis overhaul + Companion + derived signals — findings & validation

**Date:** 2026-06-16 · **Branch/PR:** `claude/audio-corpus-tuning-olcd6i` (#22)
**Scope:** deep audio analysis, Kalman drop detection, dom-frequency tracking,
EDM-tuned post-processing, a standalone analysis Companion app, and a family of
derived lighting signals (BPM / party / note / pattern+colour cues).

All work validated on the **FMA-small EDM corpus** (60 × 30 s tracks) through the
engine's **real** `AudioAnalyzer` + `SignalPostProcessor` + `AudioStructureDetector`,
and screenshot-verified in the Companion. **597 engine tests green; dry-run boots.**

## 1. Where we started (deep analysis)
Played a real EDM track ("The Need") through the real pipeline and graded every
signal vs the dataset labels. Finding: **the band/kick/flux front-end is solid**
(it cleanly encodes full-section → breakdown → build), but the **old structure
detector was poor** — it false-fired the loud intro and missed the labelled drops;
`buildScore`/`energyRatio` saturated (carried no information).

## 2. Kalman drop detector (adopted as default)
Offline experiment (Kalman+NIS on micLow ∧ micFlux, χ² gate) beat the old windowed
edge: **recall 0.40 / precision 0.57 / 400 ms latency vs the old 0.10**. Implemented
live with online robust-R estimation; `dropEdgeMode: 'kalman'` is now the default
(windowed/level retained). Enabled on boot in `config.yaml`.
**Caveat:** the FMA labels are heuristic (0 human-listened) — the real ceiling is
unknown until we eval on human labels (see §7).

## 3. Dominant-frequency tracking (new signals)
New `DominantFreqTracker` (peak-pick + parabolic interp + 2-partial tracking,
**Kalman**). Outputs `micDomFreq1/2` + `micDomEnergy1/2`, ~1 µs/hop (reuses the
analyzer FFT). Energy uses a **data-driven cluster window** (the dominance region:
peak ± neighbours above 35 % of peak) → shows the partial's ups/downs; the cluster
`[lo,hi]` is drawn on the Companion spectrum. **Validated: dom1 non-zero 99.8 % of
music hops, dom2 99.6 %** — never 0 during music. Slow-zone (`audioSlowZone`) added.

## 4. EDM post-proc tuning (corpus-driven) — "kick → clean pulse"
- **Kick:** `threshold 1.8→2.4`, `refractoryMs 140→220`. **Double/jitter fires
  38–84 % → 0 %** across tracks; ~1.2–3.6 pulses/s (one per real kick); bassline
  false-fires removed. The micKick chain is now a pulse-*shaper* (schmitt tHigh
  0.6, hold 50 ms), not a de-bouncer.
- **Bands:** smoothing LPF 3.5/5.5/10 → **5.5/8/14 Hz** (low rise 73→52 ms, mid
  50→38 ms, flicker unchanged); analyzer `attackMs 8→6`. Kick fires within 1 hop
  (11.6 ms) — lowest-latency signal.

## 5. Derived lighting signals (new subsystem `audio/signals/`)
`DerivedSignals` runs after the detector each hop and publishes 7 keys:
| key | what | validation |
|---|---|---|
| `audioBpm` / `audioBeat` | realtime tempo (Kalman) + phase-locked beat | <0.5 BPM synthetic err, locks every track; octave for very-fast EDM is ambiguous (stable, beat stays coherent) |
| `audioParty` | loud-music on/off (hysteresis+hold) | 0 % in silence, 98 % in loud, no flicker |
| `audioNote` / `audioNoteHue` | dominant pitch class → hue (median+Kalman) | 0.07–0.58 changes/s, 83–97 % stable — no strobe |
| `audioSwitchPattern` / `audioSwitchColor` | beat-quantised cue pulses | switchPattern fires on 100 % of detector drops |
Total cost ~28 µs/hop (≈410× headroom vs the 11.6 ms budget). `visual_cue_mapping.md`
(in the tuning artifacts) proposes signal→effect assignments for EDM.

## 6. Audio Companion (standalone analyzer)
`audio/companion/` — reads audio itself (Test / Mic-Line / File browser) and runs
the engine's **real** DSP (hard rule: no forked code path). Shows band traces,
dom1/dom2 as signals, a global **frequency-spectrum** view (dom markers + cluster
windows), an **audio-signal waveform**, the structure + **DERIVED** readouts
(BPM/note/party + pattern/colour flashes), a node-style chain editor with typed
param boxes, **input gain**, a **record→replay calibration** loop, and **Export
config**. Smooth (server-side coalescing + render-rate trace advance, like the
engine/CaptainPad). Mic device picker (CaptainPad-style). Fixed a Windows
mic-capture crash + 3 stale `lib→audio` imports in `api_server.js`.

## 7. Datasets acquired (for future eval/tuning)
- **Raveform** — 1,423 EDM tracks, **4,746 human-labelled drops** + beats/downbeats.
  *Audio not fetchable from this datacenter IP (YouTube bot-gate)* → run the
  human-labelled audio eval on a residential IP / your machine.
- **DEAM** — 1,802 tracks + per-second arousal (tension proxy), CC audio in hand.
- GiantSteps (tempo/key), Harmonix (beats/downbeats) — for the structural prior.

## 8. Open recommendations
1. **Bump analyzer FFT 1024 → 2048** (config) before the playa — the single change
   that improves BPM octave on fast EDM *and* dom-freq/key accuracy on sub-bass.
2. **Human-labelled drop eval** via Raveform audio off-datacenter — to learn the
   true detector ceiling (current 0.40 is bounded by heuristic-label noise).
3. Wire the derived cues into actual pattern/colour behaviour per the visual-cue map.
