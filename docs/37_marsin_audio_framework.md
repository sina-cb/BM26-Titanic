# 37 — The Marsin Audio Framework

**Status:** Active — design + in-build (the audio subsystem ships from here)
**Supersedes / folds in:** `archived/25_marsin_audio_analysis.md` (in-engine analyzer),
`archived/29_node_based_audio_post_processing.md` (chain framework),
`archived/30_audio_structure_detector.md` (build/drop/sustain detector)
**Works with (still valid):** `24_osc_integration.md` (OSC → CPC transport),
`26_audio_params_playlist.md` (routing CPC audio signals → pattern/global params)
**Build contract:** `.agent/02_reports/202606/20260617_0_companion_signal_designer_contract.md`
**Hard rule:** all audio DSP lives in `marsin_engine/audio/…` and runs in exactly
ONE place — the Companion. It is never forked/reimplemented. (See `audio/README.md`.)

> **Architecture (2026-06-17): the Companion is the SOLE analyzer.** The engine no
> longer runs its own in-line audio DSP (disabled — the Companion, an
> engine-supervised subprocess, does all capture + analysis). The operator
> **designs** signals in the Companion (pick a raw source → a type-aware chain of
> ops → an **`osc_out`** op), and `osc_out` sends the signal to the engine's OSC
> port (host/port from config). The engine writes it into CPC, and CaptainPad shows
> it **dynamically** in the deck, mixer, and audio tab. Stems and the
> Audio-Slice-direct-to-engine OSC lane are removed (Audio Slice, if used, is
> ingested by the Companion and re-emitted like any other source). "One source of
> truth" now means: the Companion is the source; the engine consumes.

---

## 1. The story

We light the Titanic to live EDM. The **Audio Analysis Companion** is where we
*design* the audio reactivity. It reads audio (mic / line / file), runs the audio
DSP, lets us **see** every signal, and lets the operator **build** the signals they
want: add a signal, pick a **raw source**, stack a **type-aware chain of ops**, and
end it with an **`osc_out`** op. Each `osc_out` signal is streamed to the marsin
engine over OSC, lands in the Central Parameter Center (CPC), and shows up
**dynamically** in CaptainPad (deck / mixer / audio tab) where playlists route it
to pattern/global params (`docs/26`).

```
  audio in ──▶ [ raw source ] ──▶ [ type-aware op chain ] ──▶ [ osc_out ] ──OSC──▶ engine CPC ──▶ CaptainPad (deck/mixer/audio) ──▶ patterns
  (mic/line/file)  rawLow…/rawDom…   gain/smooth/kalman/…       (engine host/port,    dynamic keys           (docs/26 routing)
                        │                                        from config)
                        └────────────▶ [ Visualizers ] (spectrum / waveform / dom-dance)
```

- The Companion **owns** capture + analysis (sole analyzer, engine-supervised).
- The **operator designs** the signal set (add/remove signals; each = source + ops
  + optional `osc_out`); it persists to `companion_config.yaml`.
- **Param routing (docs/26):** once a signal is in CPC, CaptainPad maps it to
  pattern/global params. The framework's job ends at "signal in CPC."

---

## 2. Architecture — typed signals → type-aware ops → OSC

> **Shipped as (2026-06-17):** a **linear, type-aware per-signal designer**, NOT a
> draggable node graph. Each signal = one raw source → an ordered op chain
> (filtered to the signal's type) → a terminal `osc_out` op. The "typed-port
> graph" below is the conceptual model the designer realizes (types still gate
> which ops are legal); the branching node-canvas editor is descoped/optional (§11).

The model is a small **directed chain** of nodes connected by **typed ports**.
This generalizes the per-signal chains of `docs/29` (a fixed
`signal → ops → output` line) by making the ports **typed** so the UI only offers
legal ops, and the right-most layer (`osc_out`) converts to OSC.

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

> **`freqWindow` is a graph/visual-internal type — NOT a single CPC key.** The
> CPC registry (`audio/postproc/audio_signals.js`) has scalar keys only:
> `micDomFreq1/2` (center Hz) and `micDomEnergy1/2` (energy); the `loHz/hiHz`
> window lives only in the analyzer/Companion payload and is used for
> visualization + `DanceMaker`. So an `OscSink` on a `freqWindow` lane **fans out
> to the scalar keys** (freq → `micDomFreq*`, energy → `micDomEnergy*`); the
> window bounds are not sent to CPC unless explicit `micDomLo*/Hi*` keys are
> added to the registry first (a deliberate, separate decision — they have no
> consumer today).

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
- **Audio Slice taps** (external stem/BPM analyzer over OSC, §6.2 — local-only):
  `rawStemBass / rawStemDrums / rawStemVocals` (`intensity`), `rawSliceBpm`
  (`bpm`), `rawSliceBeat` (`event`). Present only when the Audio Slice lane is
  enabled; address→source map is config-driven.

**Ops** (pure, allocation-free, O(1)/sample or O(1)/hop — DSP-literature backed).
The framework's canonical op set is the **already-implemented** scalar ops in
`audio/postproc/signal_post_processor.js` (`OP_SCHEMA` + `apply()`) — they are
adopted as-is and wrapped in the typed-port node interface (the **migration task**
below). All are `intensity→intensity` unless noted:

| Op | Signature | What it does (params) |
|---|---|---|
| `Gain` | intensity→intensity | ×static `value` **or** ×live CPC value at `paramKey` |
| `Bias` | intensity→intensity | + constant `value` |
| `Clamp` | intensity→intensity | re-clamp into `[min, max]` |
| `Lpf` | intensity→intensity | one-pole IIR low-pass / EMA (`cutoffHz`) — the "Smooth" op |
| `Biquad` | intensity→intensity | RBJ-cookbook LPF (`cutoffHz`, `Q`) |
| `Envelope` | intensity→intensity | asymmetric VU follower (`attackMs`/`releaseMs`) |
| `Slew` | intensity→intensity | slew-rate limiter (`maxStepPerSec`) |
| `Curve` | intensity→intensity | shape lookup (`shape`: linear/easeIn/easeOut/exp, `gamma`) |
| `Compressor` | intensity→intensity | dB-domain hard-knee (`threshold`/`ratio`/`attackMs`/`releaseMs`) |
| `Slope` | intensity→intensity | discrete derivative/sec, scaled (`scale`, `bipolar` keeps sign) |
| `Normalizer` (AGC) | intensity→intensity | sliding floor/peak auto-level to `[0,1]` (`windowSec`/`strength`) |
| `Schmitt` | intensity→**event** | hysteresis trigger + refractory (`tHigh`/`tLow`/`refractoryMs`) |
| `Hold` | event/intensity→intensity | sample-and-hold + timeout + exp decay (`timeoutMs`/`decayMs`) |

- `Kalman` — a first-class op (local-level / confidence-scaled), for smoothing a
  `frequency`/`intensity`/`bpm` stream. (Today's drop-NIS, BPM, dom, note
  Kalmans become instances of this op; see §12 / the cold-review findings.)
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
  `micDomFreq1/2` + `micDomEnergy1/2` (cluster windows are visual-only, not CPC keys — see §2.1) ·
  `audioStructure · audioBuildScore · audioEnergyRatio · audioVocalsHot ·
  audioSlowZone · audioDropPulse` · `audioBpm · audioBeat · audioBeatInBar ·
  audioBarPhase · audioDownbeat` · `audioParty · audioNote · audioNoteHue ·
  audioSwitchPattern · audioSwitchColor`.
- **External-source keys** also in the registry but **not** produced by the
  Companion's mic analysis — `stemsBass/Drums/Vocals` (+ gains, raw mirrors) and
  `tempoBpm`. Their genuine producer is **Audio Slice** (the external stem/BPM
  analyzer, §6.2) — or an LX tempo source — over OSC (`docs/24`). When the Audio
  Slice lane is enabled the Companion ingests them as the `rawStem*` / `rawSliceBpm`
  Sources and *does* drive these keys; otherwise it can only *route* to them. The
  Output UI flags them as external so an operator doesn't expect the bare mic to
  drive them.

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

## 6. Inputs

The Companion has **two input lanes**, both feeding the framework as `raw…`
Sources. Lane 1 is the engine's own PCM analysis; lane 2 is an external stem/BPM
analyzer (**Audio Slice**) over OSC.

### 6.1 PCM lane (mic / line / file → the engine analyzer)

`Audio source → [ gain + smoothing ] → FFT → everything`. A single PCM-domain
stage (software preamp gain + an optional gentle pre-FFT low-pass to denoise)
conditions the signal once, so bands / kick / dom / FFT all see one clean
source. No per-consumer gain, no kick special-casing. (Freq-domain stages do not
post-process; only the time-domain input and the per-signal scalar chains do.)

### 6.2 Audio Slice lane (external stem/BPM analyzer, OSC-in) — **local-only**

> **Status: TARGET — not yet built.** The direct Audio-Slice-to-engine OSC lane was
> removed; the plan is for the **Companion** to ingest Audio Slice and re-emit it as
> raw sources (+ a local HIL test). None of that ships yet. Local-only (the Audio
> Slice binary lives on the operator's machine).

**Audio Slice** is a separate program (not part of this repo) that does heavier
analysis than the in-engine DSP can — **stem separation** (bass / drums / vocals)
and its own **BPM/beat** estimate. It is launched **from the CLI with a config
file**, and it streams the resulting signals **over OSC to a configurable IP +
port**. The Companion treats it as a managed input service:

1. **Launch + supervise.** When enabled, the Companion spawns Audio Slice from its
   CLI with the configured binary path + config (same supervised-subprocess
   discipline as ffmpeg capture / the engine's children — restart on exit, clean
   teardown). It is optional: if disabled, the lane is simply absent (fail-loud if
   *enabled* but the binary/config is missing — never a silent no-op).
2. **Receive.** The Companion opens an **OSC listener** on the configured
   `host:port` (this is the address Audio Slice is told to send to) and maps
   incoming OSC addresses to raw Sources.
3. **Expose as `raw` Sources** in the graph (§2.2), so Audio Slice's outputs get
   the same visualize → post-proc → output treatment as the mic-derived signals:
   - `rawStemBass / rawStemDrums / rawStemVocals` (`intensity`),
   - `rawSliceBpm` (`bpm`), `rawSliceBeat` (`event`) — and whatever else Audio
     Slice emits; the address→source map is config-driven, not hard-coded.

These are the **genuine producers** of the registry's `stemsBass/Drums/Vocals` and
`tempoBpm` keys (§3) — the keys the GPT review flagged as "external-source." When
Audio Slice is running, the mic lane and the stem lane coexist: the operator can
drive low-freq looks from `rawLow` *and* a clean isolated `rawStemBass`, beats from
either `audioBpm` (in-engine) or `rawSliceBpm` (Audio Slice).

**Routing.** Two supported paths (config picks one):
- **Direct → engine** (production): Audio Slice sends straight to the engine's OSC
  port (`10000`), landing `stems*`/`tempoBpm` in CPC via the existing `docs/24`
  path — the Companion need not be running.
- **→ Companion** (design/tuning): Audio Slice sends to the Companion's OSC-in
  port, where the signals appear as raw Sources to **see, post-process, and
  re-output** through the Output UI (§7) just like the mic signals.

> **⚠ Local-only — must be built and tested on the operator's machine.** The Audio
> Slice binary exists only on Sina's local machine; it is **not** available in CI,
> the remote container, or the corpus harness. So the launch + OSC-in integration
> (and any parity/latency testing of stems/BPM) can only be developed and verified
> locally. Treat it as a local-dev build slice: the framework code (config schema,
> OSC listener, raw Sources, supervised launch) can be written anywhere, but
> end-to-end validation requires the local Audio Slice install.

---

## 7. Output → OSC → CPC

> **Shipped as:** the **`osc_out` op** (a terminal op in a signal's chain), NOT a
> separate "Output panel". A signal whose chain ends in `osc_out` is an output; the
> Companion streams its POST value each hop to the engine OSC (`config.companion.osc`
> host/port). The CPC read-back confirmation below is still a target — today the UI
> shows "sent".

A dedicated **Output** panel lets the operator:
1. pick which signals to send (native or post-processed graph outputs);
2. map each to a CPC target (an OSC address → CPC key, per `docs/24`);
3. set the send rate / format. **Events go on the wire as a scalar `1.0`/`0.0`
   float, NOT an OSC bang** — the engine's `OscListener` requires an argument at
   `args[argIndex]` and `coerceArg()` only accepts numeric/boolean/string
   scalars, so an arg-less bang is counted invalid and never reaches CPC
   (`docs/24`). (`intensity` → float, `bpm` → float, `event` → `1.0` edge.)
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

> **Shipped vs target:** the *config* is shipped — engine `audio.enabled:false`
> (sole-analyzer) + a `companion:` block (OSC target host/port, source, device).
> The engine **spawning/supervising** the Companion process (below) is **NOT yet
> built** — the Companion is launched manually today (§11). This is the remaining
> "engine-managed subprocess" work.

The Companion's lifecycle is **owned by the marsin engine** (target), the same way
the engine already owns its other subprocesses — it spawns and supervises the
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
  port: 6966             # Companion HTTP/WS (see ports registry)
  source: mic            # boot capture MODE for the design tool: test | mic | file
  device: null           # capture device override (null = inherit audio.capture.device;
                          #   Windows: pin a WASAPI low-latency device — see §10.3)
  datasetsDir: null      # default browse dir for the File source
  output:                # what to emit to the engine over OSC (Output UI persists here)
    enabled: false
    oscHost: 127.0.0.1
    oscPort: 10000       # engine osc.port (docs/24)
    signals: []          # [{ signal: 'micLow', oscAddress: '/marsin/mic/low' }, …]
  audioSlice:            # external stem/BPM analyzer lane (§6.2) — LOCAL ONLY
    enabled: false       # spawn + supervise Audio Slice; absent if false (fail-loud if enabled w/ missing binary)
    binary: null         # path to the Audio Slice CLI (operator's local machine)
    configPath: null     # config file passed to Audio Slice on launch
    listenHost: 127.0.0.1 # where the Companion's OSC-in listener binds …
    listenPort: 10001    # … and the host:port Audio Slice is told to send to (≠ engine 10000)
    route: companion     # 'companion' (raw Sources, design lane) | 'engine' (straight to CPC, docs/24)
    sources:             # OSC address → raw Source map (config-driven, not hard-coded)
      - { oscAddress: '/slice/stem/bass',   source: rawStemBass }
      - { oscAddress: '/slice/stem/drums',  source: rawStemDrums }
      - { oscAddress: '/slice/stem/vocals', source: rawStemVocals }
      - { oscAddress: '/slice/bpm',         source: rawSliceBpm }
      - { oscAddress: '/slice/beat',        source: rawSliceBeat }
```

**Audio Slice is local-only** (§6.2): its binary lives on the operator's machine,
so this block only does anything on a local stack. On CI / the remote container,
`audioSlice.enabled` stays `false` and the lane is absent. The launch + OSC-in
integration must be validated locally.

Starting the engine sets up audio; the Companion is part of that bring-up, not a
side process you remember to launch.

---

## 9. Ports

Registered in the central ports table (`.agent/00_gol/13_multi_agent.md`):

| Service | Default | Source of truth |
|---|---|---|
| Audio Companion (HTTP/WS) | `6966` | `config.yaml::audioCompanion.port` / `--port` |
| Audio Slice OSC-in (local-only, §6.2) | `10001` | `config.yaml::audioCompanion.audioSlice.listenPort` |

(6970 — the Companion's old default — collides with the Simulation save server;
the Companion moves to **6966**. Its OSC *output* targets the engine's `10000`;
its Audio Slice OSC *input* listens on `10001`, distinct from the engine port.)

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
4. **Jitter buffer + steady clock** between capture and analysis — **the fix for
   the "discretized packets" symptom** (full spec in §13). ffmpeg delivers audio
   in bursts; today the FFT runs synchronously on each burst and `dt` is taken
   from wall-clock between bursts, so every dt-driven filter sees a jagged
   timeline. The fix is a sample FIFO + a drift-corrected hop clock that feeds the
   analyzer one hop per nominal `HOP/SR` period, with `dt` = the *fixed* hop
   period. Proven by the §13 realtime test, not just the raw `{type:'diag'}`
   capture metrics.
5. **Offline-safe**: vendored deps only (`fft.js`, bundled ffmpeg). No CDNs, no
   model downloads, no runtime `npm install`.
6. **One DSP source of truth**: the Companion imports the engine's analysis;
   anything new lands in `audio/…` first. Parity tests guard the visual-only
   pieces (e.g. DanceMaker) against drift.
7. **OSC resilience**: UDP send is fire-and-forget; the Companion verifies the
   engine OSC port is reachable on connect, retries the enable, and shows
   status. Output mappings persist in config so a restart reproduces the rig.

---

## 11. Current state vs target (reconciled to the shipped branch, 2026-06-17)

**SHIPPED (on `claude/audio-corpus-tuning-olcd6i`):**
- **Sole-analyzer migration.** Engine `audio.enabled: false` — it no longer runs
  its own in-line DSP. The **Companion** does all capture + analysis and streams
  the chosen signals to the engine over OSC → CPC (proven end-to-end by a node
  test across all curated addresses).
- **Companion = signal DESIGNER.** Sidebar `[+]`/`[×]` add/remove signals; each
  picks a **raw source** (intensity: `rawLow/Mid/High/Kick/Flux`; frequency:
  `rawDom1/2`); a **type-aware** op palette (frequency signals get only Hz-valid
  ops); a **horizontal** op row terminated by an **`osc_out`** op that sends the
  POST value to the engine OSC (host/port from `config.companion.osc`). The design
  persists to `companion_config.yaml`. Sane slider ranges; sidebar number glitch
  fixed.
- **Ops:** the 13 real `SignalPostProcessor` ops + `osc_out`. Frequency signals
  run through an unclamped `outputMode:'frequency'` processor so `lpf/clamp/slew`
  actually shape **Hz** (reusing the same op math — no DSP fork).
- **Visualizers:** hi-res spectrum, rolling ~93 ms scope, dom-dance; **file mode is
  browser-as-source** (`<audio>` audio-out + seek + pause, worklet PCM
  pass-through → analyzed in sync).
- **Stems removed** (registry + OSC + CaptainPad).
- **CaptainPad:** audio signals render **dynamically** from the engine schema in
  deck / mixer / audio tab; the audio page shows **smooth, Companion-quality
  traces** (`AudioTraceCanvas`, rAF-interpolated at ~60 fps, **congestion-aware** —
  no new/faster subscriptions); audio-settings rehaul (source / overall gain /
  device); mic selection unified (CaptainPad → engine `capture.*` → Companion).
- **Realtime (§13):** low-latency capture (dshow `audio_buffer_size`) + jitter
  buffer + steady hop clock + diag — measured on a real Windows mic (jitter
  71→2.7, gap 496→18.5 ms, steady 86 Hz).
- **Correctness:** note detection unstuck (no longer pinned to C); drop detector
  default = `windowed` (corpus-green), `kalman` opt-in + retunable; BPM v2;
  structure detector; dom-freq + Kalman (§12). 40 synthetic op/chain tests.

**TARGET (not yet built / in progress):**
- **Engine spawns + supervises the Companion (§8).** Config is ready
  (`audio.enabled:false` + `companion:` block) but the engine does **not** yet
  launch/supervise the Companion process — it is started manually. This is the
  remaining piece of "engine-managed like its other subprocesses."
- **Audio Slice bridge (§6.2)** — the Companion ingesting Audio Slice's OSC and
  re-emitting it as raw sources, + the local HIL test. **Not built.** Local-only
  (Audio Slice binary lives on the operator's machine).
- **Deck/mixer curation + rich modulation popup** — *in progress* (source trail
  plot + mapping-curve viz).
- **The original "typed-port node-graph editor" (§2) is DESCOPED.** What shipped is
  the **linear, type-aware per-signal designer** with `osc_out` — it delivers the
  same intent (typed sources → typed ops → output) without a draggable node
  canvas. The graph editor remains optional/future; §2 is kept as the conceptual
  model the designer realizes.
- UI theme/a11y polish; configurable visualizer axes; the frequency `kalman` op
  (not an engine op today).

---

## 13. Realtime: jitter buffer, steady clock, and the smoothness test

The operator's "discretized packets" symptom is **not** a rendering bug — it is
that analysis is *clocked by ffmpeg's bursty pipe*. Each stdout chunk carries many
hops (or a partial), and the analyzer drains them synchronously, so the whole DSP
chain (bands, dom Kalman, dance spring, BPM PLL, structure IIRs) is *computed* in
bursts — the values exist, but they were produced on a lumpy timeline and then
delivered in clumps.

**A `dt` caveat (the two code paths differ — don't over-claim):** the **engine**
path takes `dt` from wall-clock between `onAnalysis` calls (`engine.js:1439`), so
under bursty delivery its first-of-burst hop gets a large `dt` and the rest
`dt≈0` — corrupting every dt-driven filter (the critically-damped spring is no
longer critically damped). The **Companion** path is better: it advances `clockMs`
from the *sample count* and derives `dt` from that audio clock
(`companion_server.js`), so its `dt` is steady even when frames arrive in bursts.
The burst-drain + broadcast-clumping problem is real on **both** paths; the
"large dt then dt≈0" corruption is specifically the **engine** path. Either way,
once a steady drain clock exists the right `dt` is the **fixed** `HOP/SR`, and
`_kalmanNis` still accepts a `dt` it ignores (a latent bug only under variable
rate). The 60 Hz broadcast coalescing hides the clumping in the Companion UI; the
engine→CPC→pattern path has no such smoothing, so burstiness reaches the lights.

**Fix — FIFO + drift-corrected hop clock (lives in the capture layer, so engine
and Companion both inherit it):**

```
ffmpeg --(bursts)--▶ sample ring FIFO --(steady hop clock)--▶ analyzer.pushSamples(HOP) --▶ CPC
```

- **Pre-fill** ~3 hops (~35 ms) before draining; **cap** at ~8 hops (~93 ms) —
  if exceeded, drop the oldest hop (warn-once) to bound latency. 35 ms ≪ the
  180 ms band release, so the added latency is invisible.
- **Clock:** an accumulator/catch-up timer keyed off `performance.now()` drains
  `floor((expectedSamples − consumed)/HOP)` whole hops per tick (usually 1,
  occasionally 0/2 to correct drift) — pins long-term cadence to the real clock
  with even per-hop spacing, immune to Node's coarse timers.
- **`dt` = nominal `HOP/SR`** (≈11.6 ms) handed to the whole chain — the FIFO
  guarantees the hops are real, evenly-spaced audio, so nominal `dt` is the
  truthful one. Wall-clock stays only for refractory/timeout windows.
- **Underrun (FIFO < 1 hop):** skip the tick, never zero-fill (codex P0 — no
  silent fallback); warn-once on sustained underrun and surface it to diag.
- **Capture-side (SHIPPED 2026-06-16 — the bigger win on Windows):** the device
  layer, not the analyzer, was the dominant batcher. `buildFfmpegArgs` now emits
  `-fflags nobuffer -flags low_delay`, `-flush_packets 1`, and a per-backend
  buffer bound — **dshow `-audio_buffer_size <captureBufferMs>` (default 50 ms)**,
  pulse `-fragment_size`. Tunable via `audio.capture.captureBufferMs`.

  > **Measured (HIL, 2026-06-16, Windows + Amazon USB mic, pre-fix):** dshow
  > delivered audio in **~480 ms super-chunks** (max inter-arrival 496 ms,
  > analyzerHopMs jitterStd 71 ms, ~2 UI updates/s) vs a file source's ~40 ms.
  > This is exactly the Windows audio-capture guidance from **ZRanger
  > (<https://github.com/zranger1>)** — DirectShow is the slow Windows path
  > (his order: ASIO > WASAPI low-latency > WASAPI > DirectSound/dshow), and
  > laptop-mic DSP/AGC should be disabled in favour of an external interface. The
  > `-audio_buffer_size` fix attacks the batching directly; the HIL re-run
  > confirmed it (max inter-arrival 496 ms → 49 ms, jitter 71 → 20, ~10× the
  > frame yield).
  > **If dshow still batches** (some drivers ignore the buffer hint), ffmpeg has
  > **no native WASAPI/ASIO input**, so the real cure is a non-ffmpeg capture
  > backend (PortAudio / `naudiodon`, which exposes WASAPI low-latency + ASIO host
  > APIs and is offline-installable) **or** letting **Audio Slice** (§6.2) own
  > capture on a low-latency API and feed signals over OSC. Tracked as a backend
  > follow-up. Windows AGC/"enhancements" are OS-side (ffmpeg/dshow can't disable
  > them) — operator runbook item; prefer an external line-in / interface (§10.3).

**The smoothness test (for the operator's local agent, real mic).** Run `mode:mic`
on a 60 s EDM source ≥30 s, read `{type:'diag'}`. The existing capture
inter-arrival metric *will* look bursty — that's expected; gate on the
**post-buffer** numbers instead. Add fields: `analyzerHopMs` (drain-clock
inter-hop median/p95/jitterStd), `bufferDepthHops` (mean/max), `underruns`,
`broadcastMs`, and `micLowStepP95` (p95 of `|micLow[n]−micLow[n−1]|`, a direct
chunkiness measure).

| Metric | Pass | Fail |
|---|---|---|
| `analyzerHopMs` median | 11.6 ±0.5 ms | >±1.5 ms |
| `analyzerHopMs` jitterStd | < 2 ms | > 4 ms |
| `gapsOver2x` (analyzer hops) | 0 / 30 s | > 2 |
| `bufferDepthHops` max | ≤ 6 (~70 ms) | > 8 sustained |
| `underruns` | 0 | > 3 |
| `realtimeRatio` | 0.99–1.01 | outside 0.97–1.03 |
| `broadcastMs` p95 | ≤ 20 ms | > 33 ms |
| `micLowStepP95` (mic vs file mode, same clip) | within ~1.5× of `file` | > 2× |

The decisive check: mic-mode `analyzerHopMs` jitter and `micLowStepP95` should
**approach `file` mode** (perfectly clocked) on the same clip. If they match
within ~1.5×, the discretization is gone.

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

> ✅ **Resolved (2026-06-16): default flipped to `windowed`; `kalman` made opt-in
> + improved.** The shipped `kalman` edge under-fired — on the corpus regression
> (`tests/integration/audio_analysis_validation.test.mjs`) it fired **0 drops** on
> `clean_drop`. Root cause: `KALMAN_Q = 0.01` was large relative to the
> envelope-smoothed band, so `S = (P+Q)+R` floored at ≈`Q` and a real-but-smoothed
> sub-bass step (~0.21/hop) couldn't reach `NIS ≥ 6.63`; the **same-hop** `low ∧
> flux` AND-gate also missed the 1–2-hop offset between the sub-slam and the flux
> burst. **Shipped fix:** the product default is now `windowed` (the
> corpus-validated edge — all 3 tests green), set explicitly in `config.yaml`. The
> `kalman` edge stays available opt-in and was improved: `KALMAN_Q` is now the
> config knob **`dropKalmanQ` (default 0.001)** so adaptive-R sets the NIS scale,
> and the same-hop AND became a **`dropCoWindowMs` (default 60 ms) co-occurrence
> window**. Both are validated in `audio_config.js` and live-tunable. Before
> `kalman` could be promoted back to default it must beat `windowed` on the corpus
> *and* hold the false-positive controls — not yet re-validated, so `windowed`
> stays the default.

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

### 12.3 Parameters to expose (config) — **target, not yet built**

Today the dom params are a frozen `DOM_FREQ_PARAMS` in `audio_analyzer.js`, the
drop params are module consts in the detector, and `audio/config/audio_config.js`
has **no `dom` or `drop` validator group** — so none of the below is live-tunable
yet, and the Companion UI exposes only gains/inputGain/smoothing/chains. This is a
**build target**: expose the high-value knobs under the engine's `audio.*` block
(one source of truth, shared by engine + Companion — §8.1), validated in
`audio_config.js`, so they're tunable without code edits:

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

Once built, the Companion's tuning UI edits these live (PATCH `/audio/config`,
already the hot-restart path for the existing keys) so the operator dials dom
stability and drop sensitivity by ear, on the real rig, and the values persist in
`config.yaml`. This is also the operator's field workaround for the drop-detector
defect above — so it should land alongside the re-tune.
