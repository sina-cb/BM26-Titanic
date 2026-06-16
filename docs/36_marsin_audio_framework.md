# 36 — The Marsin Audio Framework

**Status:** Design (active) — unifies the audio analysis + post-processing story
**Supersedes / folds in:** `25_marsin_audio_analysis.md` (in-engine analyzer),
`29_node_based_audio_post_processing.md` (chain framework),
`30_[todo]_audio_structure_detector.md` (build/drop/sustain detector)
**Works with (still valid):** `24_osc_integration.md` (OSC → CPC transport),
`26_audio_params_playlist.md` (routing CPC audio signals → pattern/global params),
`34_pro_audio_via_osc_sidecar.md` (external heavy-analysis sidecar)
**Hard rule:** the Companion runs the engine's REAL audio DSP (imports from
`marsin_engine/audio/…`); it never forks/reimplements analysis logic. One source
of truth. (See `audio/README.md`.)

---

## 1. The story

We light the Titanic to live EDM. The **Audio Analysis Companion** is the tool we
use to *design* the audio reactivity: it reads audio (mic / line / file), runs
the engine's analysis + post-processing, lets us **see** every signal, **tune**
it, **shape** it into the cues we want, and then **output the chosen signals to
the marsin engine over OSC**, where they land in the Central Parameter Center
(CPC) and drive patterns (per `docs/26`).

```
   audio in ──▶ [ Sources ] ──▶ [ post-proc Ops ] ──▶ [ Output UI ] ──OSC──▶ marsin engine CPC ──▶ patterns
   (mic/line/file)  raw signals     gain/smooth/Kalman/      pick what to       (osc.port 10000)        (docs/26 routing)
                                    DanceMaker/…             send + OSC addr
                         └────────────────▶ [ Visualizers ] (spectrum / waveform / dom-dance)
```

Two complementary lanes already exist and remain valid:
- **OSC-in (docs/24, 34):** an *external* analyser pushes scalars to the engine.
  The Companion is a **first-party realization** of exactly this pattern — it is
  the engine's own analysis, packaged as an app, emitting OSC.
- **Param routing (docs/26):** once a signal is in CPC, CaptainPad playlists map
  it to pattern/global params. The framework's job ends at "signal in CPC"; how
  it modulates lights is `docs/26`.

---

## 2. Architecture — a typed-port op graph

The framework is a small **directed graph** of nodes connected by **typed
ports**. This generalizes the per-signal chains of `docs/29` (which were a
fixed `signal → ops → output` line) into a graph where any source can feed any
op, ops can branch/merge, and the right-most layer converts to OSC.

### 2.1 Port types

A connection is only legal when the output port type matches the input port
type (or an explicit converter op sits between). This keeps the graph honest
and lets the UI offer only valid wires.

| Type | Meaning | Range / shape |
|---|---|---|
| `pcm` | time-domain audio samples | Float32 frame |
| `intensity` | a level / meter value | scalar `[0,1]` |
| `frequency` | a pitch / dominant frequency | scalar Hz |
| `event` | a sparse pulse / trigger | `0/1` (rising-edge) |
| `note` | pitch class / hue | `0..11` / hue `[0,1]` |
| `bpm` | tempo | scalar BPM |
| `vector` | small fixed array (e.g. spectrum bins, dom pair) | Float32[] |

Rule: **like connects to like.** `intensity → intensity`, `frequency →
frequency`, etc. To cross types you must insert a converter op (e.g.
`FreqToNote`, `EnergyToEvent (Schmitt)`), which declares the conversion
explicitly.

### 2.2 Nodes

**Sources** (read-only taps on the engine's real analysis):
- `rawAudio` (`pcm`) — the source-conditioned PCM (after the INPUT stage, §6).
- `rawLow / rawMid / rawHigh / rawKick / rawFlux` (`intensity`).
- `rawDom1 / rawDom2` (`frequency` + `intensity` energy + cluster window).
- structure taps: `audioStructure`, `buildScore`, `energyRatio`, `slowZone`,
  `dropPulse` (`intensity`/`event`); `bpm`/`beat`/`beatInBar`/`barPhase`/`downbeat`.

**Ops** (pure, allocation-free, O(1)/sample or O(1)/hop — DSP-literature backed):
- `Gain` (`intensity→intensity`), `Smooth`/`LPF`, `Envelope`, `Schmitt`
  (`intensity→event`), `Hold`, `Normalizer`/AGC — carried from `docs/29`.
- `Kalman` — a first-class op (local-level / confidence-scaled), for smoothing a
  `frequency`/`intensity`/`bpm` stream. (Today's drop-NIS, BPM, dom, note
  Kalmans become instances of this op; see §9 / the cold-review findings.)
- **`DanceMaker`** — `(frequency, intensity-window) → (frequency, width)`: the
  critically-damped spring that turns a jumpy dom freq into the smooth, ghostly
  "dance" (the gliding orbs). **Must reproduce the current dance exactly** —
  ships with a parity test against the existing `companion_server.js` spring.
- converters: `FreqToNote`, `EnergyToEvent`, etc.

**Sink:**
- `OscSink` — `* → osc`: the right-most layer. Takes the chosen signals, formats
  them as OSC messages (`/marsin/param/<cpcKey>` or `/marsin/mic/<band>` etc.,
  per `docs/24`), and sends them to the engine's OSC port. This is the bridge
  from "designed signal" to "live in CPC."

### 2.3 The interface contract

Every node exposes `inputs[]` and `outputs[]`, each a `{ name, type }`. The
graph runtime:
1. validates wires (type match or a converter present) at load — **fail loud**;
2. topologically orders the nodes;
3. ticks them once per analyzer hop (~86 Hz), allocation-free;
4. the `OscSink` emits at its own throttled rate.

---

## 3. Native signals (selectable as output)

The Companion exposes the engine's native signals as Sources; any can be chosen
for output (raw, or after post-proc):

`micLow · micMid · micHigh · micKick · micFlux` (+ their `*Raw` mirrors) ·
`micDomFreq1/2` + `micDomEnergy1/2` (+ cluster windows) ·
`audioStructure · audioBuildScore · audioEnergyRatio · audioSlowZone ·
audioDropPulse` · `audioBpm · audioBeat · audioBeatInBar · audioBarPhase ·
audioDownbeat` · `audioParty · audioNote · audioNoteHue ·
audioSwitchPattern · audioSwitchColor`.

These are the engine's own keys (declared once in
`audio/postproc/audio_signals.js`), so what the Companion sends matches what the
engine already understands.

---

## 4. Post-processing in the app

Each signal (or graph branch) carries a chain of Ops — the TouchDesigner-CHOP
model from `docs/29`, now generalized to the typed graph. The operator builds
chains in the UI (add/reorder/remove ops, typed params), validated by the
engine's `validateChain`. The same op catalog the engine uses is the catalog the
Companion offers — no divergence.

`signal → [ op → op → … ] → output` for a single lane;
`source → op ─┬─▶ op → sink` for branches (e.g. raw dom1 → DanceMaker → viz, and
raw dom1 → Kalman → OscSink in parallel).

---

## 5. Visualization

Visualizers are **graph taps** with light, mostly-cosmetic settings:
- **Spectrum** (hi-res FFT, log-freq) — dom markers + cluster windows overlaid.
- **Waveform** (the source audio).
- **Dom Dance** — the gliding orbs (fed by `DanceMaker`).
- per-signal trace meters.

Per-visualizer settings (kept minimal): **Y-axis fixed range vs dynamic
(auto-scale)**, smoothing, color, trail length. Nothing heavyweight.

---

## 6. The INPUT (source) stage

`Audio source → [ gain + smoothing ] → FFT → everything`. A single PCM-domain
stage (software preamp gain + an optional gentle pre-FFT low-pass to denoise)
conditions the signal once, so bands / kick / dom / FFT all see one clean
source. No per-consumer gain, no kick special-casing. (Freq-domain stages do not
post-process; only the time-domain input and the per-signal scalar chains do.)

---

## 7. Output UI → OSC → CPC

A dedicated **Output** panel lets the operator:
1. pick which signals to send (native or post-processed graph outputs);
2. map each to a CPC target (an OSC address → CPC key, per `docs/24`);
3. set the send rate / format (`intensity` → float, `event` → bang, etc.);
4. see the live OSC stream + a "landed in CPC" confirmation.

**Requirement:** OSC must be enabled on the engine (`osc.enabled: true`,
`osc.port: 10000` — `docs/24`). The Companion **auto-enables / verifies** this on
connect and surfaces a clear error if it can't (see §10). The OSC line is a
direct UDP path Companion → engine; the engine's existing OSC listener writes the
values into CPC.

---

## 8. Launch + configuration (managed by the engine)

The Companion is **launched with the marsin engine** and configured from
`marsin_engine/config.yaml`:

```yaml
audioCompanion:
  enabled: true          # engine starts (and supervises) the Companion process
  port: 6973             # Companion HTTP/WS (see ports registry)
  datasetsDir: null      # default browse dir for the File source
  source: mic            # boot source: test | mic | file
  device: null           # capture device (null = platform default; Windows: pin one)
  inputGain: 1.0
  sourceSmoothHz: 12000  # pre-FFT denoise (0 = off)
  output:                # what to emit to the engine over OSC (the Output UI persists here)
    enabled: false
    oscHost: 127.0.0.1
    oscPort: 10000       # engine osc.port
    signals: []          # [{ signal: 'micLow', oscAddress: '/marsin/mic/low' }, …]
```

The analyzer/detector/dom/derived tunings (kick threshold, band LPFs, dom
params, BPM, …) also live under the engine config so the Companion and the live
engine share one source of truth. Starting the engine sets up audio; the
Companion is part of that bring-up, not a side process you remember to launch.

---

## 9. Ports

Registered in the central ports table (`.agent/00_gol/13_multi_agent.md`):

| Service | Default | Source of truth |
|---|---|---|
| Audio Companion (HTTP/WS) | `6973` | `config.yaml::audioCompanion.port` / `--port` |

(6970 — the Companion's old default — collides with the Simulation save server;
the Companion moves to **6973**. Its OSC output targets the engine's `10000`.)

---

## 10. Bulletproof / "it just works" best practices

The bring-up is a **deployment requirement** (the playa has no patience and no
internet). Design rules:

1. **Fail loud at startup, never silently degrade** (codex P0). Invalid config →
   crash with a clear message; a missing OSC enable → a visible error in the UI,
   not a quiet no-op.
2. **Finite guards on every signal** (already in the detector + derived stages):
   a key dropout / NaN must warn once and coast, never poison state for the
   session. (From the cold-review findings.)
3. **Supervised capture.** ffmpeg capture auto-restarts on exit; device errors
   surface to the UI with the device picker (no crash). On Windows prefer a
   **pinned WASAPI low-latency** device; an external mic/line beats the laptop
   mic (which AGC/gates/band-limits — see the WindowsLaptopMics note).
4. **Jitter buffer** between capture and analysis: buffer bursty frames, feed the
   analyzer at a steady hop cadence → smooth signals even when the OS delivers
   audio in bursts. Measured by the `{type:'diag'}` endpoint (inter-arrival
   jitter, gaps, realtimeRatio).
5. **Offline-safe**: vendored deps only (`fft.js`, bundled ffmpeg). No CDNs, no
   model downloads, no runtime `npm install`.
6. **One DSP source of truth**: the Companion imports the engine's analysis;
   anything new lands in `audio/…` first. Parity tests guard the visual-only
   pieces (e.g. DanceMaker) against drift.
7. **OSC resilience**: UDP send is fire-and-forget; the Companion verifies the
   engine OSC port is reachable on connect, retries the enable, and shows
   status. Output mappings persist in config so a restart reproduces the rig.

---

## 11. Current state vs target

**Built (this PR):** the in-engine analyzer (FFT bands, kick, flux), per-signal
post-processing chains, the structure detector (Kalman+NIS drop, slow-zone),
dominant-frequency tracker (centroid + Kalman + cluster windows + dom-dance
spring), BPM v2 (2-state lock + beat/bar), derived signals (party / note /
switch-pattern / switch-color), and the standalone **Companion** (test/mic/file
sources, INPUT stage, hi-res spectrum + waveform + dom-dance visualizers, chain
editor, calibration, `{type:'diag'}`).

**Target (this framework):** generalize the chains into the **typed-port op
graph** (§2), make **Kalman** and **`DanceMaker`** first-class ops (with a
dom-dance **parity test**), add the **OscSink** + **Output UI** (§7), the
**engine-launch + config** integration (§8), the **jitter buffer** (§10.4), and
the **UI theme rehaul** (CaptainPad/Sim theme + color-theme selector,
configurable visualizers). Build phases are in
`.agent/02_reports/202606/20260616_2_marsin_audio_framework_plan.md`.
