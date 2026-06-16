# 37 — The Marsin Audio Framework

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
| `freqWindow` | a dominant freq **with** its cluster window + energy | `{ freqHz, loHz, hiHz, energy[0,1] }` |
| `vector` | small fixed array (e.g. spectrum bins, dom pair) | Float32[] |

`freqWindow` is the shape `rawDom1/2` actually emit and what `DanceMaker`
consumes/produces — a center frequency plus the `[loHz, hiHz]` cluster bounds
and an energy weight. Without it the type checker could not validate the dom
lane (a bare `frequency` scalar can't carry the window). A `freqWindow` degrades
to `frequency` by dropping the window (an explicit `FreqWindowToFreq` converter),
never implicitly.

Rule: **like connects to like.** `intensity → intensity`, `frequency →
frequency`, `freqWindow → freqWindow`, etc. To cross types you must insert a
converter op (e.g. `FreqToNote`, `FreqWindowToFreq`, `EnergyToEvent (Schmitt)`),
which declares the conversion explicitly.

### 2.2 Nodes

**Sources** (read-only taps on the engine's real analysis):
- `rawAudio` (`pcm`) — the source-conditioned PCM (after the INPUT stage, §6).
- `rawLow / rawMid / rawHigh / rawKick / rawFlux` (`intensity`).
- `rawDom1 / rawDom2` (`freqWindow` — center freq + `[loHz, hiHz]` window + energy).
- structure taps: `audioStructure`, `buildScore`, `energyRatio`, `slowZone`,
  `dropPulse` (`intensity`/`event`); `bpm`/`beat`/`beatInBar`/`barPhase`/`downbeat`.

**Ops** (pure, allocation-free, O(1)/sample or O(1)/hop — DSP-literature backed):
- `Gain` (`intensity→intensity`), `Smooth`/`LPF`, `Envelope`, `Schmitt`
  (`intensity→event`), `Hold`, `Normalizer`/AGC — carried from `docs/29`.
- `Kalman` — a first-class op (local-level / confidence-scaled), for smoothing a
  `frequency`/`intensity`/`bpm` stream. (Today's drop-NIS, BPM, dom, note
  Kalmans become instances of this op; see §9 / the cold-review findings.)
- **`DanceMaker`** — `freqWindow → freqWindow`: the critically-damped spring
  that turns a jumpy dom freq into the smooth, ghostly "dance" (the gliding
  orbs). It spring-smooths the center `freqHz` and the window width
  (`hiHz − loHz`) together, emitting a `freqWindow` whose bounds glide. **Must
  reproduce the current dance exactly** — ships with a parity test against the
  existing `companion_server.js` spring (`springStep`, `DANCE_OMEGA`).
- converters: `FreqToNote`, `FreqWindowToFreq`, `EnergyToEvent`, etc.

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
for output (raw, or after post-proc). **The authoritative list is the registry
in `audio/postproc/audio_signals.js`** — this catalog is illustrative and the
Output UI must enumerate it from the registry at runtime (never a hand-copied
list that can drift). Signals fall into two origins:

- **Companion-produced** (the mic analysis this app actually computes):
  `micLow · micMid · micHigh · micKick · micFlux` (+ their `*Raw` mirrors) ·
  `micDomFreq1/2` + `micDomEnergy1/2` (+ cluster windows) ·
  `audioStructure · audioBuildScore · audioEnergyRatio · audioVocalsHot ·
  audioSlowZone · audioDropPulse` · `audioBpm · audioBeat · audioBeatInBar ·
  audioBarPhase · audioDownbeat` · `audioParty · audioNote · audioNoteHue ·
  audioSwitchPattern · audioSwitchColor`.
- **External-source keys** also in the registry but **not** produced by the
  Companion's mic analysis — `stemsBass/Drums/Vocals` (+ gains, raw mirrors) and
  `tempoBpm` come from an external stem analyser / LX tempo over OSC (`docs/24`).
  The Companion can *route* to them but does not *generate* them; the Output UI
  flags them as external so an operator doesn't expect the mic to drive them.

Because the catalog is the engine's own registry (declared once), what the
Companion sends matches what the engine already understands — no separate key
list to maintain.

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
4. see the live **send** stream and, where possible, a **CPC read-back**
   confirmation (see below).

**Two distinct states — don't conflate them.** OSC out is fire-and-forget UDP:
there is **no ack on the OSC path itself** (`docs/24` §-OSC-sender — the listener
has no feedback channel, and an allowlist / source-lock / unknown-address
rejection is silently dropped on the wire). So the Output UI shows:
- **Sent** — the Companion emitted the packet (local truth only).
- **Landed in CPC** — *optional, authoritative* confirmation obtained by the
  Companion **subscribing to the engine's existing param-broadcast WS** (the same
  canonical broadcast every CaptainPad client gets) and observing the target key
  take the value. This is the only honest "it worked" signal; without the WS
  read-back the UI must label the row **Sent (unconfirmed)**, never "landed."

**Requirement:** OSC must be enabled on the engine (`osc.enabled: true`,
`osc.port: 10000` — `docs/24`). The Companion **verifies** this on connect
(via the engine HTTP/WS API, not the UDP path, which can't report it) and
surfaces a clear error if OSC is off or the port is unreachable (see §10). The
OSC line is a direct UDP path Companion → engine; the engine's existing OSC
listener writes accepted values into CPC.

---

## 8. Launch + configuration (managed by the engine)

The Companion's lifecycle is **owned by the marsin engine**, the same way the
engine already owns its other subprocesses — it spawns and supervises the
ffmpeg audio capture (respawn on exit, clean teardown on SIGINT/SIGTERM) and the
OSC listener (live re-spawn on config change). The Companion is one more
**supervised child** on that pattern, gated by `audioCompanion.enabled`:

- the engine `spawn`s `audio/companion/companion_server.js` on boot when enabled;
- it restarts it on unexpected exit (bounded backoff) and **tears it down with
  the engine** so a Ctrl-C / SIGTERM never orphans the port (mirrors the engine's
  existing port-cleanup discipline);
- `launcher.js` does **not** spawn the Companion directly — it starts the engine,
  and the engine brings the Companion up. One owner, one source of truth for
  audio bring-up. (A `dev` launcher profile can set `audioCompanion.enabled` so
  "design mode" stacks get it without a prod stack paying for a GUI it won't use.)

### 8.1 Config split — one source of truth for tuning

Analyzer/detector tuning is **not** duplicated here. It stays under the engine's
existing `audio.*` block (`audio.bands.inputGain`, `audio.bands.sourceSmoothHz`,
`audio.bands.*`, `audio.kick.*`, dom/BPM/structure params) so the Companion and
the live engine read the **same** numbers — that's what makes the Companion a
faithful design surface. `audioCompanion.*` holds **only** launch / capture-mode
/ UI / output settings:

```yaml
# audio.* (existing) — analyzer TUNING, shared by engine + Companion:
#   audio.bands.inputGain, audio.bands.sourceSmoothHz, audio.bands.*,
#   audio.kick.*, audio.structureDetector.*, dom/BPM params.
#   The Companion inherits these; it never redefines them.

audioCompanion:
  enabled: true          # engine spawns + supervises the Companion process
  port: 6973             # Companion HTTP/WS (see ports registry)
  source: mic            # boot capture MODE for the design tool: test | mic | file
  device: null           # capture device override (null = inherit audio.capture.device;
                          #   Windows: pin a WASAPI low-latency device — see §10.3)
  datasetsDir: null      # default browse dir for the File source
  output:                # what to emit to the engine over OSC (Output UI persists here)
    enabled: false
    oscHost: 127.0.0.1
    oscPort: 10000       # engine osc.port (docs/24)
    signals: []          # [{ signal: 'micLow', oscAddress: '/marsin/mic/low' }, …]
```

Starting the engine sets up audio; the Companion is part of that bring-up, not a
side process you remember to launch.

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

---

## 12. Algorithm reference — dominant-frequency tracking + every Kalman we use

This section documents the real DSP behind the dom signals and **catalogs every
Kalman filter in the audio subsystem with its parameters and current tuning**, so
the design (and the operator) can see exactly what's being smoothed and which
knobs are worth exposing. Source of truth: the cited files — this table mirrors
them, it does not redefine them.

### 12.1 Dominant-frequency pipeline

`audio/analyzer/dominant_freq_tracker.js`, fed the analyzer's positive-frequency
magnitude array (length `fftSize/2`) every hop — zero extra FFT cost. Six stages:

1. **Peak-pick.** Local maxima above a floor `max(absFloor, relFloor·hopMax)`,
   restricted to `[minFreqHz, maxFreqHz]`; keep the top `numPeaks` by magnitude.
2. **Parabolic (QIFFT) interpolation** on the 3 *log*-magnitude bins around each
   peak → sub-bin frequency. Essential at `fftSize=1024` where one bin ≈ 43 Hz
   (far too coarse for bass). (Smith, *Spectral Audio Signal Processing*.)
3. **Cluster window + energy-weighted centroid.** Expand left/right from the peak
   while magnitude stays above `clusterThresh·peak` (bounded by `clusterMaxHz`).
   That `[loHz, hiHz]` window is the "dominance region" we draw on the spectrum;
   the **mag-weighted centroid** of the window is the reported frequency (smoother
   and more stable than the raw peak bin). Window energy →
   `softCompress(energyGain·inputGain·Σmag/fftSize)` ∈ `[0,1)`, same map family as
   the bands. This is the `freqWindow` port shape (§2.1).
4. **Track association (greedy nearest).** Each active track grabs its nearest
   unused peak within a **proportional (constant-Q) gate**:
   `gate = clamp(freqHz·maxJumpFrac, minJumpHz, maxJumpHz)`. A flat gate is wrong —
   80 Hz is >1 semitone in the bass (smears) but trivial up high; `maxJumpFrac≈0.06`
   ≈ one semitone. Unmatched track → coast (energy decays toward 0, window held).
5. **Birth / death.** A strong unmatched peak (≥ `birthEnergy`) claims a free slot,
   or evicts the weakest track if ≥1.5× stronger. A track below `deathEnergy` for
   `deathHops` hops dies. Tuned low/slow so two partials stay populated on any
   musical content (no spurious 0 Hz on a busy mix).
6. **Per-track smoothing (Kalman or EMA)** — see 12.2 — then a **slow energy rank**
   (`rankAlpha`) gives a STABLE output order so dom1/dom2 don't swap labels on a
   momentary energy crossing.
7. **dom2 ⊄ dom1 separation** (`_emit`): if dom2's centroid falls *inside* dom1's
   `[loHz,hiHz]` window it's redundant — retarget dom2 to the strongest current
   peak whose centroid is *outside* dom1's window, else clear it. Overlapping
   windows are fine; a duplicated centroid is not.

### 12.2 Every Kalman filter in the subsystem

All are deliberately **scalar / low-order** (Pi-cheap, allocation-free). There is
no constant-velocity model anywhere — each is a **local-level (random-walk)**
filter `xₖ = xₖ₋₁ + w`, `z = x + v`, where the Q/R ratio sets how hard it glides.

| # | Where | Models | Q (process) | R (measurement) | Current tuning & intent |
|---|---|---|---|---|---|
| 1 | dom tracker — **freq** (`dominant_freq_tracker.js` `_updateTrack`) | per-track center freq | `kfFreqQ` | `kfFreqR` | **Q=4, R=80** (Q/R≈0.05) → trusts the model, glides hard. This is the main fix for "dom freqs jumping." |
| 2 | dom tracker — **energy** | per-track energy | `kfEnergyQ` | `kfEnergyR` | **Q=0.02, R=0.02** → mild, energy is allowed to move. |
| 3 | drop detector — **micLow** (`audio_structure_detector.js` `_kalmanNis`) | bass level | `KALMAN_Q=0.01` | adaptive `rEma` (online Var(Δz), 3σ-clipped, floor `1e-6`) | NIS edge: a drop is a huge innovation → `NIS=(y²/S) ≥ dropNisThreshold`. |
| 4 | drop detector — **micFlux** | onset-flux level | `KALMAN_Q=0.01` | adaptive `rEma` | Drop fires only when **both** low ∧ flux NIS clear the gate near a downbeat. |

Key drop-detector parameters: `dropNisThreshold = 6.63` (χ²₁ 99% gate — lower =
more sensitive), adaptive-R rate `KALMAN_R_ALPHA = 0.02`. The **3σ clip** on Δz
keeps a loud passage from inflating R and desensitising the detector afterwards;
`σ = √rEma` (a prior `√(2·rEma)` units bug made the clip ~1.4× too loose — fixed
per the cold-review).

**Not Kalman (documented here to avoid confusion):**
- **Dom-dance** (`companion_server.js` `springStep`) is a **critically-damped
  spring** (`DANCE_OMEGA = 7` rad/s, ~0.4 s settle, no overshoot), not a Kalman —
  it's a *visual* smoother on top of the already-Kalman'd dom freq. (Becomes the
  `DanceMaker` op with a parity test, §2.2.)
- **BPM v2** (`bpm_tracker.js`) is a 2-state lock + histogram, not a Kalman.
- **Note** (`note_estimator.js`) uses a circular-safe histogram mode, not a Kalman.

A reviewer asked us to consider **One-Euro** as an alternative to the dom Kalman
(speed-adaptive, fewer magic variances). It's an open option; the parity-tested
`Kalman` op (§2.2) keeps today's behavior, and One-Euro could ship as a sibling
smoothing op the operator selects per lane.

### 12.3 Parameters to expose (config)

Today the dom params are a frozen `DOM_FREQ_PARAMS` in `audio_analyzer.js` and the
drop params are consts in the detector. The framework **exposes the high-value
knobs under the engine's `audio.*` block** (one source of truth, shared by engine
+ Companion — §8.1), so they're tunable without code edits:

```yaml
audio:
  dom:
    useKalman: true
    kfFreqQ: 4          # ↑ = follows faster / jumpier; ↓ = glides harder
    kfFreqR: 80         # ↑ = smoother / laggier
    maxJumpFrac: 0.06   # association gate as a fraction of freq (~1 semitone)
    clusterThresh: 0.35 # dominance-window edge (fraction of peak)
    rankAlpha: 0.03     # dom1/dom2 label stability (lower = stickier)
  structureDetector:
    dropNisThreshold: 6.63   # χ²₁ gate; lower = more sensitive drops
    # KALMAN_Q / KALMAN_R_ALPHA exposed as drop.kfQ / drop.rAlpha
```

The Companion's tuning UI edits these live (PATCH `/audio/config`, already the
hot-restart path) so the operator dials dom stability and drop sensitivity by ear,
on the real rig, and the values persist in `config.yaml`.
