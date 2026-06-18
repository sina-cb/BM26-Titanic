# Audio Companion

The Titanic's **sole audio analyzer** and signal designer. A standalone
Node app that captures audio, runs the engine's **real DSP pipeline**
(analyzer → dominant-freq → structure detector → derived signals → the
per-signal op chains / signal designer), serves a live TouchDesigner-flavoured
UI, and streams the **designed output signals** to the marsin engine over UDP
OSC. The operator designs each signal here — pick a raw source, build an op
chain, end it in an `osc_out` tap — and the engine receives it, writes it into
the Central Param Center (CPC), and CaptainPad shows it.

## Role in the system

In production the **engine runs with its own audio analysis OFF**; the
Companion does *all* capture and analysis as an engine-supervised subprocess.
This is the single source of truth for audio: the Companion imports the
engine's real audio code from `../` (`AudioAnalyzer`, `SignalPostProcessor`,
`AudioStructureDetector`, `DerivedSignals`, `AudioCapture`, the op catalog +
chain validator) and runs the whole pipeline through them — it **never
reimplements, forks, or shadows** any DSP (codex P0; see `../README.md`). What
previews here is byte-for-byte what the show runs.

Patterns are **modulators-only**: they never read audio natively. They consume
the CPC params the Companion publishes (via OSC) as modulation sources for
pattern/global params (`../../../docs/26_audio_params_playlist.md`). The framework's job
ends at "signal in the CPC."

```
audio in → [ raw source ] → [ type-aware op chain ] → [ osc_out tap ]
        → UDP OSC → engine :10000 → CPC → CaptainPad (deck/mixer/audio) → patterns
```

## Quick start

```bash
cd marsin_engine
node audio/companion/companion_server.js          # → http://localhost:6966
#   --port 6974                                    # serve the UI on another port
#   --datasets <dir>                               # root for the File-source browser
```

Open **<http://localhost:6966>** in a browser.

- **No engine required for analysis.** The Companion analyzes independently;
  with no engine running it boots on the synthetic test source and you can
  design + preview chains offline.
- **For the OSC output + manifest, run the engine first** (`node engine.js
  --model <scene> …` in `marsin_engine/`). Then the Companion's `osc_out` taps
  reach the engine CPC and CaptainPad auto-shows the signals.
- **Full stack:** `node launcher.js <prod|dev|dev-lite>` from the repo root
  starts the Companion automatically (after the engine) on port 6966 — see
  `../../../docs/37_marsin_audio_framework.md` §8/§9.

## How it works

The operator **designs signals**. Each signal picks one RAW source and runs it
through a chain of the engine's real ops, ending in a terminal `osc_out` tap:

- **Intensity sources** (`rawLow rawMid rawHigh rawKick rawFlux`, value `[0,1]`,
  plus `rawDom1Energy`/`rawDom2Energy`) run the `SignalPostProcessor` in its
  default `[0,1]` mode.
- **Frequency sources** (`rawDom1 rawDom2`, value Hz) run the **same**
  `SignalPostProcessor` in `frequency` output mode — identical lpf/clamp/slew
  math, but the final `[0,1]` clamp is skipped so the Hz value survives (and
  clamp bounds may be Hz). One DSP, no fork.

A signal whose chain ends in an `osc_out` tap is an **OUTPUT**. Every analyzer
hop, the Companion sends that signal's POST value as a single OSC float to the
tap's derived address. The tap carries one operator-facing **`name`**; the
engine **cpcKey** and OSC **address** are *derived* from it
(`cpcKey = slug(name)`, `address = /marsin/audio/<cpcKey>`), except for the
curated built-ins (e.g. `micLow → /marsin/mic/low`, `micDomFreq1 →
/marsin/dom/freq1`) which keep their canonical engine-bound addresses so the
mission-critical audio→light path never gets slug-mangled.

**Signal manifest.** On boot and on every add / remove / chain-change / export,
the Companion POSTs a manifest of its OUTPUT signals to the engine
(`POST /audio/signals/manifest`). The engine registers a dynamic CPC live param
per signal and CaptainPad shows it automatically; on remove it deregisters and
purges the modulation. Built-in/curated keys are excluded (the engine already
has them). The POST is fire-and-forget and graceful — analysis never blocks on
it, an unreachable engine warns once, and a lost add/remove is reconciled on
reconnect.

**BPM** is a derived signal (`DerivedSignals`/`BpmTracker`), not an
operator-designed tap, so it is emitted as an always-on built-in output to
`/marsin/audio/bpm` → CPC `audioBpm` (drives `bpmSpeedSync`). It is guarded:
only a finite, sane tempo is sent — a 0 / absurd value is dropped so the engine
fails safe (`bpm_emit.js`).

**Structure detector.** The THIN/BUILD/SUSTAIN + drop-cue detector is wired and
runs inside the Companion for live preview, but the engine-side feature is
**disabled by default and still under development** — do not treat its output as
production-accurate (`../README.md`, `../detector/`).

The op catalog (shared with the engine): `gain`, `bias`, `clamp`, `lpf`,
`envelope`, `schmitt`, `hold`, `curve`, `slew`, `danceMaker`, `compressor`,
`biquad`, `slope`, `normalizer`, `osc_out`. Frequency signals may use only the
Hz-valid subset (`lpf`, `clamp`, `slew`, `normalizer`, `danceMaker`,
`osc_out`); `danceMaker` is frequency-only.

For the full model, see `../../../docs/37_marsin_audio_framework.md` and the
build contract
`../../../.agent/02_reports/202606/20260617_0_companion_signal_designer_contract.md`.

## Ports & endpoints

| Surface | Where | Notes |
|---|---|---|
| Companion UI + WebSocket | `http://localhost:6966`, `ws://…/ws` | `--port` overrides; serves `ui/` |
| OSC out (signals → engine) | UDP → `127.0.0.1:10000` | engine's `osc.port`; from `config.companion.osc`, else `osc.port`, loopback |
| Manifest POST (→ engine API) | `POST http://<engine>/audio/signals/manifest` | engine API endpoint, default `127.0.0.1:6968` |
| Engine config link (→ engine API) | `GET`/`PATCH /audio/config`, `ws://<engine>/ws/control` | shared-tuning two-way sync |
| `GET /catalog` | Companion HTTP | ops, raw sources, signals, views, OSC target |
| `GET /browse`, `GET /file` | Companion HTTP | File-source directory browse + ranged audio serve |

## Config

- **`companion_config.yaml`** (sibling of the server) — the persisted *output
  design*: the `osc` target plus the list of signals (`id`, `label`, `source`,
  `type`, `chain[]`, `output`) and custom `views`. Loaded on boot; written by
  the UI's **Export config** action. A missing file is the one non-error case
  (boot uses the built-in default design); any present-but-broken file throws
  (codex P0 — no silent fallback). Schema + loader: `companion_config.js`.
- **`../../config.yaml`** (engine config) — read at boot for the OSC target
  (`companion.osc` → else engine `osc.port` on loopback), the engine API
  endpoint to sync against (`companion.engine` → `server.port` → `127.0.0.1:6968`),
  the boot source (`companion.source`), and the mic device
  (`companion.device` override → else `audio.capture.device`).
- **Shared tuning via `EngineConfigLink`** (`engine_config_link.js`) — input
  gain, source smoothing, and capture device are kept in sync with the engine
  as the single source of truth. The Companion subscribes to the engine's
  `audioConfig` broadcasts and writes its own UI changes back via
  `PATCH /audio/config`, so a change in CaptainPad, the engine, or this UI
  reflects everywhere. Analysis stays independent and degrades gracefully when
  the engine is down (applied locally, surfaced loudly as local-only).

## Testing

Run the companion tests with Node's built-in runner from `marsin_engine/`:

```bash
cd marsin_engine
node --test tests/companion_signal_designer.test.js     # osc_out op, config loader/validator, OSC path
node --test tests/companion_dynamic_signals.test.js      # manifest → dynamic CPC keys + OSC binding
node --test tests/companion_engine_config_link.test.js   # shared-tuning two-way link
node --test tests/companion_bpm_emit.test.js             # guarded BPM emit + BPM→speed sync
```

Skills:

- `../../../.agent/01_skills/06_audio_corpus_tuning.md` — tune signal feel /
  the detector against real miced audio with numbers, not vibes.
- `../../../.agent/01_skills/10_osc_synth.md` — feed synthetic audio signals
  over OSC straight to the engine (no mic/Companion) to exercise CaptainPad
  meters, modulations, and BPM.

## See also

- `../../../docs/37_marsin_audio_framework.md` — the audio framework (the subsystem ships from here).
- `../../../.agent/02_reports/202606/20260617_0_companion_signal_designer_contract.md` — the signal-designer build contract.
- `../README.md` — the audio subsystem map + the single-source-of-truth hard rule.
- `../../../docs/24_osc_integration.md` — OSC → CPC transport · `../../../docs/26_audio_params_playlist.md` — routing CPC audio → pattern/global params.

## Layout

```
audio/companion/
  companion_server.js     Node backend — runs the engine's real DSP, serves the UI, OSC out + manifest
  companion_config.js     signal/view/config schema + loader/validator (Codex-P0 strict)
  companion_config.yaml   the persisted output design (loaded on boot, written by Export)
  engine_config_link.js   live two-way link to the engine's shared audio tuning
  bpm_emit.js             guarded always-on BPM output (fail-safe tempo gate)
  ui/                     frontend (render + edits only; zero DSP)
    index.html  companion_app.js  companion_app.css
  README.md
```
