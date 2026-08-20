# Audio signal contract

This is the authoritative data contract between the Audio Companion analyzer,
the engine ParamCenter, derived-signal modules, OSC, and pattern automation.
The Companion is the sole analyzer. Every evaluator constructs the analyzer
from the same effective configuration as the Titanic scene.

Configuration resolves in this order:

1. `marsin_engine/config.yaml` → `audio`
2. `marsin_engine/states/<model>/audio_state.yaml`
3. scene signal chains and live overrides, where explicitly supported

Missing required analyzer fields are errors. They are never replaced with
test constants or zeros.

## Analyzer publication

All normalized analyzer features below are finite floats in `[0,1]`. Silence
decays toward zero through the configured release envelope. Dominant frequency
is the exception: it remains a physical frequency in Hz and is zero when no
dominant component is credible.

| Analyzer output | Raw CPC key | Registered | Derived consumer | Unit / range | Kind | Modulation transform |
|---|---|---|---|---|---|---|
| `low` | `micLowRaw` | live raw mirror | structure detector; postprocessor → `micLow` | normalized `[0,1]` | continuous | gate → gain → low-pass |
| `mid` | `micMidRaw` | live raw mirror | postprocessor → `micMid` | normalized `[0,1]` | continuous | gate → gain → low-pass |
| `high` | `micHighRaw` | live raw mirror | postprocessor → `micHigh` | normalized `[0,1]` | continuous | gate → gain → low-pass |
| `kick` | `micKickRaw` | live raw mirror | BPM tracker; postprocessor → `micKick` | normalized `[0,1]` | event-like level | gain → envelope → Schmitt → hold |
| `flux` | `micFluxRaw` | live raw mirror | structure, BPM, riser, genre; postprocessor → `micFlux` | normalized `[0,1]` | continuous | gain → low-pass |
| `domFreq1` | `micDomFreq1` | live OSC-bound | dominant-frequency views | Hz `[0,22050]` | continuous | frequency-mode clamp/slew; never normalize the stored value |
| `domEnergy1` | `micDomEnergy1` | live OSC-bound | dominant-frequency views | normalized `[0,1]` | continuous | intensity chain |
| `domFreq2` | `micDomFreq2` | live OSC-bound | dominant-frequency views | Hz `[0,22050]` | continuous | frequency-mode clamp/slew; never normalize the stored value |
| `domEnergy2` | `micDomEnergy2` | live OSC-bound | dominant-frequency views | normalized `[0,1]` | continuous | intensity chain |
| `onsetLow` | `micOnsetLowRaw` | live raw mirror | band-onset shaper → `micOnsetLow` | normalized `[0,1]` | event source | shaped pulse/envelope |
| `onsetMid` | `micOnsetMidRaw` | live raw mirror | band-onset shaper → `micOnsetMid` | normalized `[0,1]` | event source | shaped pulse/envelope |
| `onsetHigh` | `micOnsetHighRaw` | live raw mirror | band-onset shaper → `micOnsetHigh` | normalized `[0,1]` | event source | shaped pulse/envelope |
| `micSub` | `micSubRaw` | live raw mirror | sub-bass shaper → `audioChestHit` | normalized `[0,1]` | continuous source | thresholded chest-hit pulse |
| `tonalStability` | `micTonalStabilityRaw` | live raw mirror | genre classifier | normalized `[0,1]` | continuous | classifier feature only |
| `chromaFlux` | `micChromaFluxRaw` | live raw mirror | genre classifier | normalized `[0,1]` | continuous | classifier feature only |
| `chromaTilt` | `micChromaTiltRaw` | live raw mirror | genre classifier | normalized `[0,1]` | continuous | classifier feature only |

`audio/companion/audio_pipeline.js` owns this exact mapping and fails on any
missing or non-finite analyzer field. Production and evaluation import it.

## Pattern-facing outputs

| CPC key | Unit / range | Kind | Silence behavior | Intended use |
|---|---|---|---|---|
| `micLow`, `micMid`, `micHigh` | normalized `[0,1]` | continuous | release to zero after the gate | smooth spatial/intensity modulation |
| `micKick` | normalized `[0,1]` | short held pulse | zero, with no phantom trigger | sharp beat accent |
| `micFlux` | normalized `[0,1]` | continuous | settles near zero | build/motion modulation |
| `micOnsetLow`, `micOnsetMid`, `micOnsetHigh` | normalized `[0,1]` | short pulse | zero | band-local chases |
| `audioChestHit` | normalized `[0,1]` | short pulse | zero | sub-bass impact accent |
| `audioBpm` | BPM `[0,300]` | continuous estimate | zero and smoother reset | tempo sync; never treat as normalized modulation |
| `audioGenre` | integer class `[0,6]` | categorical | ambient/unknown class | informational only until real-corpus confidence improves |
| `audioGenreConf` | normalized `[0,1]` | continuous confidence | zero | display/abstention gate |

## Sparse-event wire contract

One-hop detector pulses cannot safely pass through a lower-rate OSC scheduler.
Each event therefore has two wire representations:

| Source event | Modulation envelope | Automation sequence | Sequence unit / range |
|---|---|---|---|
| downbeat | `audioDownbeat` | `audioDownbeatSeq` | integer `[0,2147483647]` |
| phrase boundary | `audioPhraseBoundary` | `audioPhraseBoundarySeq` | integer `[0,2147483647]` |
| track change | `audioTrackChange` | `audioTrackChangeSeq` | integer `[0,2147483647]` |
| pattern switch | `audioSwitchPattern` | `audioSwitchPatternSeq` | integer `[0,2147483647]` |
| color switch | `audioSwitchColor` | `audioSwitchColorSeq` | integer `[0,2147483647]` |

On a source rising edge, the Companion force-sends both envelope `1.0` and the
incremented sequence, bypassing only the ordinary rate phase. The envelope then
decays to exact zero over 150 ms on normal scheduled sends. Consecutive high
hops are one event; a low hop rearms the edge. Counter wrap goes to `1`, never
`0`. Automation reacts to a non-zero sequence change, while patterns may use
the envelope. A restart at sequence zero does not synthesize an event.

## Removed signal

`audioVocalsHot` was removed. It depended exclusively on the retired
`stemsVocalsRaw` path, was not in the Companion's derived OSC publication list,
and therefore could not become live in the production sole-analyzer topology.
Genre chroma features are the supported vocal/timbre-adjacent information path.
