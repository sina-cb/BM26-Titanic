# 34 — Pro Audio via an OSC Sidecar (the heavy-analysis extension point)

**Status:** Design note + operator playbook (still valid — external-analyzer lane)
**Related docs:** `37_marsin_audio_framework.md` (the first-party Companion realizes this same OSC-in pattern) · `24_osc_integration.md` (OSC adapter) · `archived/25_marsin_audio_analysis.md` (in-engine analyzer) · `archived/29_node_based_audio_post_processing.md` (chain framework) · `15_central_param_center_cpc.md` (CPC)
**Related code:** `marsin_engine/lib/osc_listener.js` · `marsin_engine/lib/param_center.js` (`/marsin/stems/*`, `/lx/tempo/bpm` bindings) · `marsin_engine/lib/signal_post_processor.js` (the Normalizer op) · `marsin_engine/tools/audio_calibrate.js` (calibration helper)

---

## 1. Why this exists

The engine's in-engine audio lane (`docs/25`) is deliberately small: an FFT,
three band energies, a kick detector, and the per-signal post-processing chain
(`docs/29`). It is fast (≈ 86 Hz on the analyzer hop, O(1) per chain op),
dependency-free (just `fft.js`), and **offline-safe** — no model downloads, no
native builds, no network. That is the right trade for the mission-critical
lane: the Titanic must light up at night on a laptop with no internet, and the
audio path must never be the thing that fails to boot on the playa.

But "professional" audio analysis — beat/downbeat tracking, onset detection,
key/chord estimation, source separation, spectral-flux novelty curves — is
heavyweight. The good implementations (aubio, Essentia, madmom, librosa) pull
in native libraries, Python/C++ toolchains, sometimes ML model weights. Folding
any of that into `marsin_engine` would violate the offline-safety and
dependency-free rules the codex calls P0, and would make a cold boot on a dusty
laptop a gamble.

This doc names the **official extension point** for that heavy analysis: run it
as an **external sidecar process** that feeds the engine over OSC, exactly the
way LX Studio already feeds us stems and BPM. The sidecar owns the heavy
dependencies; the engine stays lean. The two lanes meet only at a UDP socket
carrying a handful of scalars.

Codex DNA served: **mission-critical visibility** (the fast lane never depends
on the heavy lane booting), **TE DNA** (a real VJ rig can bolt on a serious
analyzer), **kind** (the operator can add capability without re-touching the
engine), **fun** (downbeat-locked chases are possible without bloating the boot
path).

---

## 2. The two-lane architecture

```
   ┌─────────────────────────── ENGINE MACHINE (same box) ───────────────────────────┐
   │                                                                                   │
   │   FAST LANE (in-engine, mission-critical, offline-safe)                           │
   │   ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐                  │
   │   │ AudioCapture │──▶│ AudioAnalyzer│──▶│ SignalPostProcessor  │── micLow/Mid/    │
   │   │  (ffmpeg)    │   │  FFT + kick  │   │  chain ops (docs/29) │   High/Kick → CPC │
   │   └──────────────┘   └──────────────┘   └──────────────────────┘                  │
   │                                                                                   │
   │   HEAVY LANE (out-of-engine sidecar, optional, dependency-heavy)                  │
   │   ┌───────────────────────────────────┐         ┌──────────────┐                  │
   │   │ audio sidecar process             │  OSC    │ OscListener  │── /marsin/audio/ │
   │   │  aubio / Essentia / madmom / etc. │──UDP───▶│ (docs/24)    │   <key> → CPC    │
   │   │  reads the SAME mic / a loopback  │ loopback│              │                  │
   │   └───────────────────────────────────┘         └──────────────┘                  │
   │                                                                                   │
   └───────────────────────────────────────────────────────────────────────────────────┘
                                   both lanes land in the CPC; patterns read either.
```

The lanes are **independent failure domains**:

- The fast lane boots and runs with the heavy lane absent, crashed, or never
  installed. A pattern that reads `micLow` keeps working; a pattern that reads a
  sidecar-fed key (e.g. `audioDownbeat`) simply sees that key's idle/default
  value, the same as when LX Studio's stems are offline (Wireframe C in
  `docs/29`). No fallback magic, no silent degradation of the fast lane — the
  heavy key just isn't being driven, which is loud and visible in the SIGNAL
  DIAGNOSTICS surface.
- The heavy lane can be restarted, swapped (aubio → madmom), or re-tuned without
  touching the engine. Its only contract with the engine is the OSC address
  scheme below.

This mirrors the **stems** decision recorded in `docs/29` §"Stems locality":
the external analyser runs on the **same physical machine** as the engine and
talks to it over UDP **loopback** (`127.0.0.1`), so there are no Wi-Fi packet
drops to design around. Loopback UDP effectively never drops — the kernel hands
the datagram straight from sender to receiver without touching a NIC.

---

## 3. How the existing stems path works (the pattern to copy)

The stems and tempo inputs are already exactly this architecture. Read them as
the worked example before adding a new key.

**Param registry (`param_center.js`).** Each stem is a `live`-policy CPC float
with a canonical OSC address:

```js
// param_center.js (abridged)
{ key: 'stemsBass',  type: 'float', /* live policy */ oscAddress: '/marsin/stems/bass'  },
{ key: 'stemsDrums', type: 'float', /* live policy */ oscAddress: '/marsin/stems/drums' },
{ key: 'stemsVocals',type: 'float', /* live policy */ oscAddress: '/marsin/stems/vocals'},
{ key: 'tempoBpm',   type: 'float', /* live policy */ oscAddress: '/lx/tempo/bpm'       },
```

- **`live` policy** = high-rate, ephemeral, NOT persisted to disk and (for
  stems) hidden from the persisted scene state. The value is a transient signal,
  not operator-tuned config. See `docs/24` §7.4.
- **`tempoBpm` uses a non-canonical address** (`/lx/tempo/bpm`) because LX Studio
  is the de-facto upstream tempo source on this rig. It is kept in the registry
  so it **auto-binds** at boot; the operator can still alias a different tempo
  source via `config.yaml` `osc.bindings`.

**Listener (`osc_listener.js`).** At construction the listener calls
`paramCenter.getSchema()` and **auto-binds every registry entry that has an
`oscAddress`** (`buildCanonicalBindings`). So adding a registry entry with an
`oscAddress` is all it takes for the listener to start routing that address —
no listener edit required. Each inbound packet is coerced
(`coerceArg`) and dispatched through a single `paramCenter.setMany(...)` so the
downstream `onChange` fires once per packet.

**Optional chain processing.** When the engine wires a `signalPostProcessor`
into the listener, gainable keys (those in `GAIN_BY_KEY`) are routed through the
per-signal chain before publishing — that is how stems pick up the same Gain /
LPF / Normalizer ops the mic bands get. A brand-new sidecar key does **not**
have to be gainable; if you want it chain-processed, add it to `KNOWN_SIGNALS` +
`GAIN_BY_KEY` + the chain framework (§5.2). If you just want the raw scalar in
CPC, skip that and the listener publishes it unprocessed.

---

## 4. Recommended address scheme: `/marsin/audio/<key>`

Stems live under `/marsin/stems/*` and tempo under `/lx/tempo/bpm` for
historical reasons. For **new** sidecar-fed analysis values, use a dedicated
namespace so the heavy lane is visually distinct from the stems mixer feed:

```
/marsin/audio/<key>
```

Examples:

| Suggested CPC key  | OSC address               | What the sidecar computes                     |
|--------------------|---------------------------|-----------------------------------------------|
| `audioDownbeat`    | `/marsin/audio/downbeat`  | 1.0 pulse on each detected downbeat (madmom).  |
| `audioOnset`       | `/marsin/audio/onset`     | Spectral-flux onset strength, [0, 1].          |
| `audioBeatPhase`   | `/marsin/audio/beatphase` | Phase within the current beat, [0, 1) ramp.    |
| `audioCentroid`    | `/marsin/audio/centroid`  | Normalized spectral centroid ("brightness").   |
| `audioNovelty`     | `/marsin/audio/novelty`   | Structure-change novelty curve (cf. `docs/30`).|

Conventions:

- **Scalars in `[0, 1]`** (or a documented range) so they drop straight into the
  pattern-language `paramCenter.get()` contract, same as `micLow`. The sidecar
  does the normalization on its side, or you add a Normalizer chain op
  (`docs/29`, the `normalizer` op) on the engine side to auto-level it.
- **BPM-style references** that aren't `[0,1]` (e.g. an absolute tempo) follow
  the `tempoBpm` precedent: a `float` key with its own documented unit.
- **One address = one scalar** at `argIndex 0` (shorthand binding). Multi-arg
  packets (e.g. an XY value) use the explicit object/array binding form per
  `docs/24` §1.

---

## 5. Registering a new OSC-fed live key

### 5.1 Minimal path — a raw live scalar (no chain processing)

1. **Add a CPC registry entry** in `param_center.js` with `live` policy and an
   `oscAddress: '/marsin/audio/<key>'`. Pattern it on the `stemsBass` entry.
   That single change makes the OSC listener auto-bind the address at boot
   (`buildCanonicalBindings`) — no `osc_listener.js` edit.
2. **(Optional) mirror the value to the iPad** via the existing live-param
   broadcast so SIGNAL DIAGNOSTICS can show it.
3. **Read it in patterns** via `paramCenter.get('<key>')` / the shared-fn name,
   exactly like `micLow`.

That is the whole loop for a raw scalar: registry entry in, pattern reads out,
listener does the rest.

### 5.2 Chain-processed path — make the key gain/normalizer-aware

If you want the sidecar value to flow through the per-signal chain framework
(so the operator can layer Gain / LPF / **Normalizer** / Schmitt / etc. on it
from the AUDIO tab), additionally:

1. Add the key to `KNOWN_SIGNALS` and `DEFAULT_CHAINS` in
   `signal_post_processor.js` (a single-op Gain default mirrors stems).
2. Add `<key>: '<key>Gain'` to `GAIN_BY_KEY` in `osc_listener.js`, and register
   the `<key>Gain` CPC param — the boot-time existence check in the listener
   constructor enforces this pairing (Codex P0: a half-wired gain knob would
   silently do nothing).
3. Now the listener routes the inbound value through
   `signalPostProcessor.process(key, raw, dt)` before publishing. A
   `normalizer` op in that chain auto-levels a venue/mic-independent sidecar
   feed; see the Normalizer op in `signal_post_processor.js` and the
   calibration tool below.

### 5.3 dt for aperiodic OSC

OSC packets land aperiodically. The listener already tracks a per-key
`_lastDispatchAt` and feeds the real wall-clock delta as `dt` into
`process(key, raw, dt)`, so time-domain chain ops (LPF, Envelope, Hold,
Normalizer) behave correctly even when the sidecar's packet rate jitters. Your
sidecar should still aim for a steady send rate (e.g. one packet per analysis
hop) so the smoothing constants behave predictably.

---

## 6. Why this keeps the engine offline-safe and dependency-free

- **No new engine dependencies.** aubio/Essentia/madmom and their native/ML
  baggage live entirely in the sidecar's own environment (its own venv, its own
  container). `marsin_engine`'s `package.json` is untouched. A cold boot on a
  fresh playa laptop still only needs Node + the vendored deps.
- **No network requirement.** The sidecar runs on the **same box** and talks
  over UDP loopback. Nothing reaches for a CDN, a model registry, or the
  internet at runtime. If the operator never installs a sidecar, the engine is
  exactly as it is today.
- **No fallback coupling (Codex P0).** The engine does not detect "is a sidecar
  present?" and silently change behavior. The sidecar-fed keys are just CPC
  live params; absent a sender they sit at their idle value and the SIGNAL
  DIAGNOSTICS surface shows them flat — loud, visible, no hidden degradation.
- **The allowlist still applies.** `osc.allowedSenders` (`docs/24` §3.4) can pin
  the sidecar's loopback origin so writes carry `origin: 'osc:<name>'` and a
  stray packet from elsewhere is dropped.

---

## 7. Companion: the calibration tool

`marsin_engine/tools/audio_calibrate.js` is the offline, calibrate-once partner
to the runtime, auto-level Normalizer chain op:

- The **Normalizer op** (`signal_post_processor.js`, the `normalizer` type)
  auto-levels a signal *at runtime* via a dual floor/peak envelope follower, so
  a new room adapts continuously without hand-tuning.
- The **calibration tool** is the *one-shot, deliberate* alternative: it listens
  to the live mic for a few seconds (capture → analyzer only, no engine boot)
  and prints a suggested `bands.noiseGate` plus per-band min/median/max and a
  copy-pasteable YAML snippet for `states/<scene>/audio_state.yaml`. It writes
  nothing to disk (diagnostics print only).

Use the calibration tool to pick a static gate/gain when you want a fixed,
inspectable number in the scene file; reach for the Normalizer op when you want
the rig to keep adapting as the room changes through the night. They are
complementary, not redundant — both exist so the operator can choose how much
of the auto-leveling is baked into config versus left to run live.

```bash
# Quiet room: seed the noise gate.
node marsin_engine/tools/audio_calibrate.js --seconds 10
# With music playing: read the per-band ceiling (max column) to pick a gain.
node marsin_engine/tools/audio_calibrate.js --seconds 10 --device :2
```

---

## 8. What this deliberately is not

- **Not a second in-engine analyzer.** The heavy lane runs OUT of process. We do
  not add aubio bindings to the engine.
- **Not a cross-network protocol.** The sidecar is co-located (loopback UDP). A
  cross-network OSC source is possible but then the operator should add a `Hold`
  chain op to ride out packet loss, per the `docs/29` stems-locality note.
- **Not a replacement for the fast lane.** `micLow/Mid/High/Kick` remain the
  mission-critical signals. Sidecar keys are additive enrichment.
- **Not an auto-detect / plug-and-play handshake.** Registering a key is an
  explicit registry edit (§5). No runtime discovery, no silent enable.
