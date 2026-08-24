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

### Safe isolated test bench

This command is the microphone-locked, loopback-only setup for synthetic and
digital-file analysis. Keep the engine stopped: its production config can bind
show OSC/controller endpoints even when its API port is overridden.

```powershell
node audio/companion/companion_server.js --model test_bench --host 127.0.0.1 --port 31666 --source test --no-mic --osc-port 31601 --engine-port 31668 --datasets "C:\path\to\corpus"
```

Before trusting the session, verify `/signal_snapshot` reports `mode: "test"`,
`micDisabled: true`, `engineLink.connected: false`, OSC target
`127.0.0.1:31601`, and engine target `127.0.0.1:31668`. The `--no-mic`
interlock rejects UI and engine-directed microphone switches and device
enumeration. File replay feeds PCM digitally into the analyzer and starts with
speaker monitoring muted (and re-mutes on every source switch — monitoring is
armed per load, never inherited).

**`--no-mic` is ENFORCED, not conventional.** Refusing to open a capture device
is only half of isolation: a companion still POSTs its design manifest to the
engine, PATCHes that engine's live audio config, and streams OSC at the
configured target — so an un-isolated `--no-mic` run reconfigures the *show*
engine. Four boot-time interlocks now make that impossible. All four run
before any socket is created; failing any one of them refuses the boot.

- **`--no-mic` requires `--source test|file`.** Without it the boot source
  comes from `config.yaml` `companion.source` (`mic` on the rig) and the
  process died on an unhandled rejection *after* binding its servers.
- **`--no-mic` requires BOTH `--osc-port` and `--engine-port` on the command
  line.** Loopback is *not* isolation: `config.yaml` points the engine endpoint
  at `127.0.0.1:6968`, which is the **live production engine**. So a
  `--no-mic --source test` run with no port flags would pass the loopback check
  below and still push its manifest and config PATCHes into the running show.
  Both ports must therefore be named explicitly, every time — nothing is
  defaulted (a guessed port is a fallback). Use the reserved bench ports
  `--osc-port 31601 --engine-port 31668`; omitting either is a hard refusal
  that names the missing flag.
- **Explicit ports must differ from the configured production endpoints.**
  Naming `--engine-port 6968` explicitly is still the live production engine,
  and naming the configured production OSC port is still the show signal bus.
  `--no-mic` compares both effective outbound targets to the configured targets
  and refuses matching endpoints before it creates any socket.
- **`--no-mic` requires loopback outbound targets.** Both the effective OSC
  target host and the effective engine-endpoint host must be loopback. Kept as
  defense in depth: the port flags above already pin both resolvers to
  `127.0.0.1`, so this check guards against a future resolver branch that
  honours a configured host. **Nothing is silently rewritten** — a non-loopback
  target is a hard refusal naming the flag to pass. A configured loopback show
  endpoint is still rejected by the production-endpoint interlock above.

### Normal standalone use

```bash
cd marsin_engine
node audio/companion/companion_server.js --model <scene>
#   --port 6974                                    # serve the UI on another port
#   --host 0.0.0.0                                 # expose on the LAN (default: loopback)
#   --datasets <dir>                               # root for the File-source browser
```

Open **<http://localhost:6966>** in a browser.

- **Binds `127.0.0.1` by default.** The WS surface retunes the *live show*
  (derived tuning, gates, source, OSC target) with no authentication, so an
  open bind on every interface is not something to inherit by accident — on
  playa that interface list includes a guest network. Exposing it is an
  explicit act: **`--host 0.0.0.0`**. `launcher.js` (the production boot path)
  passes exactly that, so the show rig is reachable from the iPad/laptop as
  before; only ad-hoc `node companion_server.js` runs changed.
- **The engine must boot FIRST on a scene's first run.** The Companion resolves
  its effective config from `config.yaml` **plus**
  `states/<scene>/audio_state.yaml`, and that state file is **written by the
  engine**. A brand-new scene has no such file, so the Companion refuses to
  boot (`scene audio config read failed …`) — start the engine once for that
  scene, let it write the state file, then start the Companion. The launcher
  already orders it this way (engine → companions).
- **No engine required for analysis** *(after that first boot)*. The Companion
  analyzes independently; with no engine running it boots on the synthetic test
  source and you can design + preview chains offline.
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
| Companion UI + WebSocket | `http://localhost:6966`, `ws://…/ws` | `--port` overrides; serves `ui/`; binds **loopback** unless `--host` says otherwise (launcher passes `--host 0.0.0.0`) |
| OSC out (signals → engine) | UDP → `127.0.0.1:10000` | engine's `osc.port`; from `config.companion.osc`, else `osc.port`, loopback |
| Manifest POST (→ engine API) | `POST http://<engine>/audio/signals/manifest` | engine API endpoint, default `127.0.0.1:6968` |
| Engine config link (→ engine API) | `GET`/`PATCH /audio/config`, `ws://<engine>/ws/control` | shared-tuning two-way sync |
| `GET /catalog` | Companion HTTP | ops, raw sources, signals, views, OSC target |
| `GET /browse`, `GET /file` | Companion HTTP | File-source directory browse + ranged audio serve |
| `GET /signal_snapshot` | Companion HTTP | read-only: mode/targets, effective audio-analysis config, every live-policy signal, `bpmOutput` (published vs raw BPM) |

`/signal_snapshot` separates **registration**, **production**, and
**transport**, because the three used to be conflated. The row set comes from
the registry's static `live` descriptor flag — that only proves a key *exists*.
`writes` / `lastWriteHop` count both real ParamCenter writes and direct designed
chain production against the top-level `analyzerHops` clock. The `producer`
object keeps those counts separate (`cpcWrites`, `designedWrites`, `kinds`), so
a designed `micLow` output is not falsely reported dead merely because it goes
straight from its post-processing chain to OSC. `transport` reports the actual
address, packet count, last value, and decaying send rate:

- `writes: 0` — **nothing has ever written this key** in this process.
- `analyzerHops - lastWriteHop` growing — its producer has gone quiet.
- `registered: false` — the key is not in this process's CPC at all (`value`
  is then `null`; an absent key is reported as absent, never as `0`).
- `transport.count: 0` — the producer has not put a packet on that OSC path.

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
  gain, source smoothing, capture device, and the operator-facing derived-signal
  detector settings are kept in sync with the engine as the single source of
  truth. The Companion subscribes to the engine's
  `audioConfig` broadcasts and writes its own UI changes back via
  `PATCH /audio/config`, so a change in CaptainPad, the engine, or this UI
  reflects everywhere. Analysis stays independent and degrades gracefully when
  the engine is down (applied locally, surfaced loudly as local-only).
- **The ENGINE is the sole writer of `states/<scene>/audio_state.yaml`.** The
  Companion applies a derived-tuning edit to its live modules and writes it
  **through** to the engine; it never writes that file itself. It used to, and
  so did the engine on the very PATCH the same edit triggered — two
  uncoordinated `load → merge → save` cycles on one file, i.e. a lost-update
  race decided by whoever read first. **Engine offline:** the edit still
  applies locally (analysis never blocks), the UI says so, and the edit is
  **parked and replayed** to the engine on reconnect. A definitive rejection
  with readable authoritative engine config snaps the value back and flashes
  the exact keys that reverted. A transport failure or unreadable engine truth
  keeps the edit pending for reconnect; until the engine has actually ruled, a
  pending group is locally authoritative and reconciliation will not overwrite
  it.
  Same-group edits are serialized; while one engine PATCH is in flight, newer
  complete-group snapshots coalesce so the last operator edit cannot be
  persisted first and then overwritten by a slower, older response.
- **Only live-patched `derivedSignals` groups are persisted.** The scene state
  no longer carries a full copy of the derived tree. A group the operator has
  not touched stays owned by `config.yaml` and follows its retunes; a group they
  have touched is persisted with its live-tunable fields only. **CaptainPad's
  "Reset to defaults" drops every persisted `derivedSignals` group**, so
  `config.yaml` wins again for all of them (mic selection and the `enabled`
  flag survive the reset).
- **Published-BPM slew** (`audio.bpmTracker.outputSlewEnabled` /
  `outputSlewBpmPerSec`) — the BPM sent to the engine WALKS to a new tempo at
  the configured BPM/s instead of stepping to it, so a re-lock or a track
  change can't glitch the lights. The tempo detector itself is untouched; the
  exact estimate stays visible as `bpmOutput.raw` in `/signal_snapshot`. The
  **BPM SLEW** control on the DERIVED TUNE page writes through the same
  `PATCH /audio/config` path as the gains; an out-of-range rate is rejected,
  never clamped. Every other `bpmTracker` key is config-only (restart).

## PARTY signal source

`audioPartyStrong` is the one key the show director, the Timeline's
`mood calm→party` cue and CaptainPad's SIGNAL chip trust. **Two** detectors run
in the Companion every hop, and the PARTY tab's **PARTY SIGNAL SOURCE** selector
picks whose verdict is published:

| Source | Detector | What it is |
|---|---|---|
| `qualified` (default) | `PartyModeStrong` | The gated detector this tab tunes: LEVEL **and** a real kick train **and** dance-music spectral shape **and** not-silent, all held continuously for `onSustainMs`. Rejects room noise and far camps. |
| `simple` | `PartyMode` | The plain band-loudness Schmitt trigger already published as `audioParty` — the PARTY pill in the DERIVED readout. Trips on any loud sound; the escape hatch for a night where the gates will not close. |

**This tab is where the choice lives.** It is persisted into
`../../config.yaml` → `party:` → `source:` by the same **surgical** line-edit the
thresholds use (comments survive; a missing `source:` line throws and writes
nothing). CaptainPad's LIVE Timeline card only *exposes* the same switch — it
holds no copy of the selection and hides the control entirely if the Companion
does not report one.

**Precedence — override > source > detectors** (`party_signal_source.js`):

1. the **FAKE TRIGGER** (`partyOverride`, runtime-only) wins over everything;
2. otherwise the persisted `party.source` picks whose verdict is published;
3. and that detector's own latch is the value.

Both detectors keep running whatever is selected, so a switch lands on the next
hop and BOTH verdicts stay visible side by side (`partyState.qualifiedParty` /
`partyState.simpleParty`). The 5 Hz publish cadence and the engine's staleness
guard are unchanged either way.

Wire contract: `hello` seeds `partySource` + `partySources`; the 10 Hz
`partyState` carries `source`, `sources`, `qualifiedParty`, `simpleParty`,
`simpleLoudness`, `simpleOnThresh`, `simpleOffThresh`; `{type:'setPartySource',
source}` persists-then-switches and answers with
`{type:'partySource', source, persisted, error?}`.

## Known gaps (documented, not fixed)

Recorded here so the UI is not read as claiming more than it does:

- **The OSC-OUT per-signal mute checkbox is INERT.** The `setOscSend` handler
  still records + persists the checkbox into `design.osc.disabled`, but
  emission ignores it: `OSC_SEND_FILTER_ENABLED` is `false` (operator request
  2026-06-30), so **every** signal is sent regardless of its checkbox. Ticking
  a box changes nothing on the wire today. Follow-up: Notion *"Fix OSC send
  filter (per-signal mute)"*.
- **Events look different in the UI than on the wire.** Analyzer event
  producers emit a one-hop 0/1 pulse; the UI/frame shows that raw pulse, while
  OSC carries the `event_transport.js` representation — a ~150 ms decaying
  **envelope** on the event key plus a monotonic `…Seq` integer force-sent on
  the rising edge (so an event can't vanish between throttled send frames).
  So a value read in the Companion UI will not match the value the engine's
  ParamCenter holds for the same key. This is deliberate; the divergence is
  documented rather than hidden.
- **Stale `audioVocalsHot` entries** exist in some `states/*/globals_state.yaml`
  files from an earlier signal set. They are left alone on purpose — a running
  production engine may hold those files open, and rewriting them from a test
  branch is the kind of side effect the HIL guard exists to prevent.

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
