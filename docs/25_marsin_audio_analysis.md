# Marsin Audio Analysis — Design

**Status:** v1 design, in implementation
**Spec author:** MarsinEngine team
**Related docs:** `15_central_param_center_cpc.md` · `24_osc_integration.md` · `16_captain_pad.md`

---

## 1. Why this exists

OSC stems (`docs/24` §4.3) cover the case where an *external* analyser (Resolume / Ableton / LX Studio) is doing the FFT and pushing scalars at us. That's the right answer when the show has a dedicated audio computer. On smaller deployments (one laptop running the engine, a phone or speaker pointed at a microphone) we want the engine to do its own analysis from a local mic.

This doc specs the in-engine audio listener. Three goals:

1. **Local mic → CPC live params** for low / mid / high band energy and kick transients.
2. **Operator-tunable** band edges, kick sensitivity, and per-band gain — adjustable live from CaptainPad, not a config-only contract.
3. **BPM → speed sync** so a beat-grid (from the existing `tempoBpm` OSC input) can drive the global `speed` knob hands-free.

Non-goals for v1:

- BPM detection *from the mic* (we keep using `/lx/tempo/bpm` for tempo).
- Multi-band-aware kick (just one configurable energy window).
- Bus-mixer integration (each band is a CPC scalar, not a mixer channel).
- Cross-fader-style band mixing (operator can already get that via the per-stem gain × master reactivity contract).

---

## 2. Architecture at a glance

```
                            ┌──────────────────────┐
ffmpeg avfoundation ──PCM──▶│ AudioCapture         │
(or alsa, dshow)            │  (spawn / restart    │
                            │   policy, stderr ──▶ │── warn-once-per-min logs
                            └──────────┬───────────┘
                                       │ Int16Array frames
                                       ▼
                            ┌──────────────────────┐
                            │ AudioAnalyzer        │
                            │   FFT(fftSize)       │── bands → micLow/micMid/micHigh
                            │   kick detector      │── pulse → micKick
                            │   exp smoothing      │
                            └──────────┬───────────┘
                                       │ paramCenter.setMany(...)
                                       ▼
                            ┌──────────────────────┐
                            │ ParamCenter (CPC)    │
                            │   live-param policy  │── WS sharedParams (throttled)
                            └──────────┬───────────┘
                                       │
                                       ▼
                                   patterns

                            ┌──────────────────────┐
tempoBpm WS change  ──────▶ │ BpmSpeedSync         │── paramCenter.set('speed', ...)
                            │   (CPC subscriber)   │
                            └──────────────────────┘
```

The two boxes — `AudioAnalyzer` and `BpmSpeedSync` — are independent. You can run the mic listener with sync off, or run sync against an OSC-driven `tempoBpm` with no mic at all.

---

## 3. PCM capture

### 3.0 Cross-platform capture rule

All operating-system-specific audio capture behavior lives in `marsin_engine/lib/audio_capture.js` and `marsin_engine/lib/audio_devices.js`. The rest of the stack must stay platform-neutral:

- `AudioAnalyzer` receives `Int16Array` hop frames.
- CPC receives `micLow`, `micMid`, `micHigh`, and `micKick`.
- CaptainPad reads shared params + `audioStatus`.
- BPM → speed sync does not depend on mic capture.

Supported capture backends for v1:

| Platform | Node platform | ffmpeg input format            | Device format                                  |
| -------- | ------------- | ------------------------------ | ---------------------------------------------- |
| macOS    | `darwin`      | `avfoundation`                 | `":0"`, `":1"`, … (AVFoundation audio index)   |
| Windows  | `win32`       | `dshow`                        | `"audio=<exact device label>"`                 |
| Linux    | `linux`       | `pulse` preferred, `alsa` fall | source name (pulse) or `"hw:N"` (alsa)         |

The engine always spawns ffmpeg with `spawn(ffmpegPath, args, { shell: false, windowsHide: true })`. We never build shell command strings for capture — that's the only way to safely tolerate device names with spaces, quotes, or non-ASCII characters.

### 3.1 Backend: ffmpeg

We spawn `ffmpeg` as a child process and read raw `s16le` PCM on stdout. Why ffmpeg over `sox` / `naudiodon` / `mic`:

- **Already installed** on this rig and most show machines.
- **Zero npm deps** for the I/O path (we don't pull a native module).
- **Cross-platform**: same wrapper works on macOS (`-f avfoundation`), Linux (`-f alsa` or `-f pulse`), Windows (`-f dshow`). Backend is selected from config.
- **Restartable** on stream end with an exponential backoff, so unplugging and re-plugging a mic doesn't take down the engine.

Example macOS invocation (defaulted in the wrapper):

```bash
ffmpeg -hide_banner -loglevel warning \
       -f avfoundation -i ":0" \
       -ac 1 -ar 44100 -f s16le -
```

`:0` is the system default input. Operators can list devices once with `ffmpeg -f avfoundation -list_devices true -i ""` and pin `device: "0"` (or a name) in config.

### 3.2 AudioCapture class

`marsin_engine/lib/audio_capture.js` — thin wrapper:

- `start()` → spawns ffmpeg, attaches `stdout` listener, emits `Int16Array` chunks aligned to **`hopSize` samples** (not `fftSize`). `AudioAnalyzer` owns the rolling `fftSize` ring buffer and applies the Hann window before each FFT.
- `stop()` → SIGTERMs the child, waits for exit, releases handles.
- Emits a `status` event whenever the process restarts / exits, so the engine can log and CaptainPad can show a "mic stalled" badge.
- On ffmpeg exit code ≠ 0 *and* we didn't ask for stop, exponential backoff (1s, 2s, 4s, 8s, capped at 30s) — never spam-restart.
- Rate-limited stderr forwarding (one warn / minute) — ffmpeg is chatty.

### 3.3 Failure modes

| Failure                              | Behaviour                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------- |
| ffmpeg binary missing                | log clear error at boot, leave `audio.enabled` effectively false           |
| device permission denied (macOS)     | one boot-time warning explaining how to grant Microphone permission        |
| stream ends unexpectedly             | exponential backoff restart                                                |
| frames arriving but all-zero         | no special handling — analyzer sees zero energy across bands, UI shows it  |
| operator flips `audio.enabled: false`| graceful stop; live CPC params decay to 0 over `bandAlpha` smoothing       |

### 3.4 Mic discovery and `--choose_mic`

The engine ships an operator setup CLI in `marsin_engine/lib/engine_cli_flags.js` + `audio_mic_chooser.js`. It runs **before** normal engine boot. **All mutating flags require `--model <scene>`** because the mic is saved into the scene's `audio_state.yaml`. `--list_mics` does not.

```bash
# One-time setup for a scene
node marsin_engine/engine.js --choose_mic --model test_bench

# Normal launches just pick up the saved mic
node marsin_engine/engine.js --pattern <p> --model test_bench

# Other helpers
node marsin_engine/engine.js --list_mics                                       # works without --model
node marsin_engine/engine.js --choose_mic --model test_bench --start           # setup, then boot
node marsin_engine/engine.js --mic "audio=Microphone Array" --model test_bench # non-interactive
node marsin_engine/engine.js --clear_mic --model test_bench
node marsin_engine/tools/list_audio_devices.js                                  # discovery without engine boot
```

| Flag                    | Behavior                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `--list_mics`           | Print detected mic devices and exit. No `--model` needed.                                           |
| `--choose_mic`          | Interactive chooser. Saves selected device into `states/<scene>/audio_state.yaml`. Exits after saving. **Requires `--model`.** |
| `--choose_mic --start`  | Choose/save mic, then continue normal engine boot.                                                  |
| `--mic <device>`        | Non-interactive override. Saves the device and continues normal boot. **Requires `--model`.**      |
| `--clear_mic`           | Removes saved mic from the scene file (tuning is preserved). **Requires `--model`.**               |

If a mic is already saved, `--choose_mic` shows it first and asks whether to keep:

```
Current saved microphone:

  MacBook Pro Microphone
  ffmpeg device: :0
  input format:  avfoundation
  selected:      2026-05-24T18:10:00-07:00

Keep this microphone? [Y/n]
```

If the saved mic isn't in the current discovery results we still let the operator keep it (the device might be temporarily unplugged); `--list_mics` is the right tool to confirm hardware presence.

If stdin isn't a TTY, `--choose_mic` aborts with a clear error and recommends `--list_mics` or `--mic "<device>"` instead.

### 3.5 Audio device descriptor

Mic discovery in `lib/audio_devices.js` returns normalized device descriptors:

```ts
type AudioDevice = {
  id: string;                                                 // 'avfoundation-audio-0'
  label: string;                                              // 'MacBook Pro Microphone'
  platform: 'darwin' | 'win32' | 'linux';
  inputFormat: 'avfoundation' | 'dshow' | 'pulse' | 'alsa';
  ffmpegDevice: string;                                       // ':0' or 'audio=…' or 'hw:1'
  alternativeName?: string;                                   // dshow only
  isDefault?: boolean;
};
```

Device listing commands (these end up in `buildListDevicesArgs`):

```bash
# macOS
ffmpeg -hide_banner -f avfoundation -list_devices true -i ""
# Windows
ffmpeg -hide_banner -list_devices true -f dshow -i dummy
# Linux Pulse
ffmpeg -hide_banner -sources pulse
# Linux ALSA fallback
ffmpeg -hide_banner -f alsa -list_devices true -i dummy
```

ffmpeg writes device lists to **stderr**, not stdout. `listAudioDevices` concatenates both streams before parsing.

---

## 4. Analyzer

### 4.1 Pipeline per frame

```
Int16Array (mono, hopSize samples)
   → float32 / 32768
   → ring buffer of last fftSize samples
   → window (Hann) → FFT (real)
   → magnitude per bin
   → sum bins per band → sqrt(sumSq / nBins) = RMS  (0..1-ish)
   → exponential smoothing (`bandAlpha`)
   → write micLow / micMid / micHigh to CPC
   → kick detection (see §4.3)
   → write micKick to CPC
```

Hops are at `hopSize` samples. `fftSize=1024 hopSize=512` @ 44.1kHz gives ~86 analyses/sec — plenty for visual reactivity, well below the 15 Hz CPC broadcast throttle for live params.

We use [`fft.js`](https://www.npmjs.com/package/fft.js) — pure-JS Cooley-Tukey, zero native deps, ~12k weekly downloads, single-file source easy to audit.

### 4.2 Bands

Defaults (Hz):

| Band | Range            | Rationale                                        |
| ---- | ---------------- | ------------------------------------------------ |
| Low  | 20 .. `lowMaxHz` | Kick, sub-bass, bass guitar. Default cutoff 250. |
| Mid  | `lowMaxHz` .. `midMaxHz` | Vocals, snare, guitar body. Default cutoff 2000. |
| High | `midMaxHz` .. nyquist | Cymbals, sibilance, top end. Default 22050.    |

Operators tune `lowMaxHz` / `midMaxHz` in `config.yaml`. They are *not* CPC params in v1 (would need a reanalyzer restart to re-bin) — the Audio Analysis tab edits them via REST `PATCH /audio/config` which restarts the analyzer in place.

### 4.3 Kick detector

Single-band transient detector:

- Sum energy in `kick.minHz..kick.maxHz` (default 40..120).
- Maintain a slow EMA (`kickEmaAlpha = 0.02` → ~50-frame trailing average).
- Maintain an instantaneous read.
- Fire kick when `instant > ema * kick.threshold` AND `now - lastKick > kick.refractoryMs`.
- On fire: `micKick = 1.0`, then exponential decay over `kickDecayMs` (default 120 ms) to 0.

The CPC write rate for `micKick` is throttled per the live-param policy (`broadcastHz: 30`) — slightly higher than the band trio so the UI pulse looks crisp.

### 4.4 Smoothing

Per band:

```
smoothed = bandAlpha * raw + (1 - bandAlpha) * prev
```

Default `bandAlpha = 0.5`. Operators can bias toward "snappy" (0.8) or "smooth" (0.2) live from the Audio Analysis tab.

---

## 5. CPC integration

### 5.1 New live params

Following the `docs/24` §4.3 / §7.4 live-param policy: `persist: false, live: true, broadcastHz: 15, portWatch: false`. Canonical OSC addresses included so an external analyser could also feed them.

| CPC key   | Default | Range | broadcastHz | OSC address           |
| --------- | ------- | ----- | ----------- | --------------------- |
| `micLow`  | 0.0     | 0..1  | 15          | `/marsin/mic/low`     |
| `micMid`  | 0.0     | 0..1  | 15          | `/marsin/mic/mid`     |
| `micHigh` | 0.0     | 0..1  | 15          | `/marsin/mic/high`    |
| `micKick` | 0.0     | 0..1  | 30          | `/marsin/mic/kick`    |

### 5.2 New persistent gains

Per-band gains, range overridden by `osc.gainMax` (same mechanism as stem gains).

| CPC key       | Default | Range            | persist | portWatch |
| ------------- | ------- | ---------------- | ------- | --------- |
| `micLowGain`  | 1.0     | 0..`gainMax`     | true    | true      |
| `micMidGain`  | 1.0     | 0..`gainMax`     | true    | true      |
| `micHighGain` | 1.0     | 0..`gainMax`     | true    | true      |
| `micKickGain` | 1.0     | 0..`gainMax`     | true    | true      |

Pattern convention identical to stems:

```js
effective = audioReactivity * micLowGain * micLow;
```

### 5.3 BPM-sync params

These are operator-tunable, persistent, and visible on LoRa (PortWatch operators need to see when a remote engine is auto-driving speed from BPM).

| CPC key       | Default | Range       | Notes                                            |
| ------------- | ------- | ----------- | ------------------------------------------------ |
| `bpmSpeedSync`| 0.0     | options [0, 1] | float-typed boolean (matches `direction` style) |
| `bpmSpeedMin` | 60      | 30..240     | BPM that maps to `speed = 0`                     |
| `bpmSpeedMax` | 180     | 30..240     | BPM that maps to `speed = 1`                     |

### 5.4 Multi-subscriber refactor

Right now `paramCenter.onChange` is a single slot. `BpmSpeedSync` needs to subscribe to `tempoBpm` changes alongside the existing api_server fan-out. To avoid the ugly "wrap the old one in a closure" pattern, we extend `paramCenter`:

```js
// New: subscriber list
paramCenter.subscribe((ev) => { ... }) // returns unsubscribe()

// Back-compat: existing single-slot `onChange` keeps working,
// fired after every subscriber in `subscribe()` registration order.
```

This is a 30-line change in `param_center.js` and the only user (api_server.js) keeps using `onChange =` unchanged.

---

## 6. BPM → speed sync

### 6.1 Behaviour

When `bpmSpeedSync === 1.0`:

- On every CPC write to `tempoBpm` (i.e. the OSC listener received `/lx/tempo/bpm`):

  ```
  bpm  = clamp(tempoBpm, bpmSpeedMin, bpmSpeedMax)
  speed = (bpm - bpmSpeedMin) / max(bpmSpeedMax - bpmSpeedMin, 1)
  paramCenter.set('speed', speed, 'bpm-sync')
  ```

- The `'bpm-sync'` source tag lets CaptainPad show "SPEED · DRIVEN BY BPM" in the badge and lets a future source-lock policy keep operators from accidentally fighting the auto-driver.

### 6.2 Edge cases

| Situation                              | Behaviour                                                            |
| -------------------------------------- | -------------------------------------------------------------------- |
| `tempoBpm` is 0 (no signal)            | skip write — don't pin speed to 0 just because BPM isn't arriving   |
| `bpmSpeedMin == bpmSpeedMax`           | divide-by-zero guarded; treat as a fixed `speed = 0.5`               |
| `bpmSpeedMin > bpmSpeedMax`            | swapped at use-time (operator clearly meant the right order)         |
| Sync flipped from off → on             | next BPM packet snaps speed; we don't replay a stale value           |
| Sync flipped from on → off             | speed left at whatever it was — operator can re-set manually        |
| Source-lock leases `speed: 'ipad'`     | CPC rejects the sync write, logs at `debug`, BPM keeps streaming    |

### 6.3 Where it lives

`marsin_engine/lib/bpm_speed_sync.js`. Wired in `engine.js` via `paramCenter.subscribe(...)`. Stateless apart from "was the last write our own" (to avoid infinite ping-pong since `set('speed', ...)` would itself fire onChange — but `speed` is not in `changedKeys.includes('tempoBpm')` so this is naturally guarded).

---

## 7. Config — two files, one source of truth per scene

Audio settings live in two files:

```
marsin_engine/config.yaml                              ← portable defaults
marsin_engine/states/<scene>/audio_state.yaml          ← per-scene EVERYTHING (mic + tuning)
```

Boot merge order (later wins):

```
config.yaml.audio   <   states/<scene>/audio_state.yaml
```

**Each scene owns its complete audio setup.** That includes the mic device — running the same scene on a different rig means running `--choose_mic --model <scene>` on that rig once to repoint it. The trade-off vs. a separate per-machine file:

- **Pro:** one file per scene to read / commit / diff / debug. No hidden machine-local state.
- **Pro:** scenes can pin specific mics if that matters (e.g. soundcheck uses a USB mic, show uses the laptop mic).
- **Con:** `git pull` may bring in someone else's saved mic device. Run `--choose_mic --model <scene>` again to fix it. The mic discovery flow is designed for this — it shows the saved mic and asks whether to keep.

The CaptainPad iPad can connect to engines on different machines (each running their own scene) and each scene's analyzer behaviour follows the scene file.

### 7.1 `config.yaml` — portable defaults

These are the safe fallbacks any scene starts with on a fresh rig:

```yaml
audio:
  enabled: false            # per-scene state will flip this on if desired
  capture:
    backend: ffmpeg
    ffmpegPath: ffmpeg      # absolute path acceptable, e.g. "C:/ffmpeg/bin/ffmpeg.exe"
    platform: auto          # 'auto' resolves to process.platform at boot
    device: null            # null → saved mic, else platform default (mac :0, linux default, win throws)
    deviceLabel: null
    deviceId: null
    sampleRate: 44100
    channels: 1
    inputFormat: null       # null → platform default (darwin→avfoundation, win32→dshow, linux→pulse)
    stopTimeoutMs: 2000
    stderrWarnIntervalMs: 60000
  fftSize: 1024             # 1024/512 @ 44.1k = ~23 ms window, ~86 hops/sec
  hopSize: 512
  bands:
    lowMaxHz: 250
    midMaxHz: 2000
    smoothingAlpha: 0.5
  kick:
    minHz: 40
    maxHz: 120
    threshold: 1.6
    refractoryMs: 200
    decayMs: 120
```

### 7.2 `states/<scene>/audio_state.yaml` — per-scene EVERYTHING

Written by two engine paths:
- `engine.js --choose_mic --model <scene>` and `--mic "<device>" --model <scene>` → updates only the `capture.*` subset (platform / inputFormat / device / deviceId / deviceLabel / selectedAt). Pre-existing tuning is preserved.
- `PATCH /audio/config` from CaptainPad's Audio Analysis tab → updates only the live-tunable subset (`enabled`, `fftSize`, `hopSize`, `bands`, `kick`). Pre-existing mic selection is preserved.

```yaml
# Auto-written by MarsinEngine — per-scene audio state.
capture:
  platform: darwin
  inputFormat: avfoundation
  device: ":1"
  deviceId: "avfoundation-audio-1"
  deviceLabel: "MacBook Pro Microphone"
  selectedAt: "2026-05-24T20:42:00-07:00"
enabled: true
fftSize: 1024
hopSize: 512
bands:
  lowMaxHz: 250
  midMaxHz: 2000
  smoothingAlpha: 0.5
kick:
  minHz: 40
  maxHz: 120
  threshold: 1.6
  refractoryMs: 200
  decayMs: 120
```

`osc.gainMax` (already shipped) applies to the `mic*Gain` params for free.

### 7.3 What's live-tunable vs. boot-only

PATCH `/audio/config` accepts only the live-tunable subset — `bands.*` and `kick.*` — and applies them in place via `analyzer.reconfigure()`. The remaining scene-level scalars (`enabled`, `fftSize`, `hopSize`) are persisted to `audio_state.yaml` for *next boot* but require an engine restart to take effect (changing FFT size means rebuilding the ring buffer + plan). The REST validator rejects PATCHes that try to live-edit those.

- `bands.lowMaxHz`, `bands.midMaxHz`, `bands.smoothingAlpha`
- `kick.minHz`, `kick.maxHz`, `kick.threshold`, `kick.refractoryMs`, `kick.decayMs`

Hard config-only (require an engine restart):

- `capture.*`
- `fftSize`, `hopSize`

---

## 8. CaptainPad

### 8.1 Deck audio row (read-only live meters)

```
GLOBAL PARAMS:   SPEED  SIZE  COUNT  DIR  C1  C2  [BPM]  [OSC]
AUDIO REACTIVITY: REACT  ┊  [BASS / DRUMS]  [VOCALS / LOW]  [MID / HIGH]  [KICK]
```

The deck is for performing: one master REACT slider plus four compact two-row "what's reaching the patterns" columns. Per-band GAIN sliders live on the Audio Analysis tab — putting them on the deck made the cells too small to drag accurately, and surfacing a setting next to the live data it scales just confused operators who wanted to perform, not tune. Now they're separated:

- Deck = perform (REACT + live meters).
- Audio tab = tune (per-band gain + analyzer config + BPM-sync setup).

**Layout alignment.** Both rows share `labelWidth` + `labelGap` constants in `CPCControls.tsx` so the REACT slider sits directly under SPEED — no white-space gap. Tweaking one constant moves both rows together; this is why REACT now uses the same `flex: 1, maxWidth: faderMaxWidth` shape as SPEED instead of a hand-tuned fixed width.

**Pattern-switch latency.** Tapping an entry in the per-channel PlaylistPanel flips the highlight instantly (optimistic local update), fires the POST in the background, and reconciles via the next WS `mixer` broadcast. The previous `await refresh()` after every tap was the source of the "tiny but visible" UI lag — the lights were already on the new pattern by the time the highlight moved. Rollback path stays: on HTTP failure or exception the local highlight reverts and an alert surfaces.

### 8.2 Audio Analysis tab

New tab between Studio and Monitor, icon `waveform`. Layout (single-pane, no left/right split):

```
[AUDIO ANALYSIS]                                       [RESET TO DEFAULTS]

┌─ MICROPHONE ──────────────────────────────────────────────────────────┐
│  [● ENABLED]   Device:  :1  MacBook Pro Microphone                    │
│  Status:      Capturing · 44100 Hz · 1 ch · 86 hop/s                  │
└───────────────────────────────────────────────────────────────────────┘

┌─ BAND / STEM GAIN ────────────────────────────────────────────────────┐
│  VOCALS  ━━━━●━━━━━━━━  1.00×        BASS    ━━━●━━━━━━━━━  1.00×    │
│  DRUMS   ━━━━●━━━━━━━━  1.00×                                         │
│  ───────────────────────────────────────────────────                  │
│  MIC LOW ━━━━●━━━━━━━━  1.00×        MIC MID ━━━━●━━━━━━━  1.00×    │
│  MIC HIGH━━━━●━━━━━━━━  1.00×        MIC KICK━━━━●━━━━━━━  1.00×    │
│  Note: Deck REACT multiplies every band. Set REACT to 0 to silence.   │
└───────────────────────────────────────────────────────────────────────┘

┌─ BANDS ───────────────────────────────────────────────────────────────┐
│  LOW MAX HZ   ━━━━●━━━━━━━━━━━  250 Hz                                │
│  MID MAX HZ   ━━━━━━━━●━━━━━━━ 2000 Hz                                │
│  SMOOTHING    ━━━━━●━━━━━━━━━━  0.50  (snappy ←→ smooth)              │
│                                                                       │
│  Live meters:  LOW  ▓▓▓▓▓░░░░░   MID  ▓▓░░░░░░░░   HIGH  ▓░░░░░░░░    │
└───────────────────────────────────────────────────────────────────────┘

┌─ KICK ────────────────────────────────────────────────────────────────┐
│  ENERGY WINDOW  40 Hz ──●─────────────────●── 120 Hz                  │
│  THRESHOLD      ━━━━●━━━━━━━━━━  1.60×                                │
│  REFRACTORY     ━━━●━━━━━━━━━━━  200 ms                               │
│  DECAY          ━━●━━━━━━━━━━━━  120 ms                               │
│  Live: KICK ●▒░░░░░░░░░░░░  (last hit 230 ms ago)                     │
└───────────────────────────────────────────────────────────────────────┘

┌─ BPM → SPEED ─────────────────────────────────────────────────────────┐
│  [● SYNC SPEED FROM BPM]                                              │
│  BPM MIN  ━━●━━━━━━━━━━━  60                                          │
│  BPM MAX  ━━━━━━●━━━━━━━ 180                                          │
│  Current: tempoBpm 124 → speed 0.53                                   │
└───────────────────────────────────────────────────────────────────────┘
```

All sliders write either to CPC (the BPM-sync trio + per-band gains) or to `PATCH /audio/config` (the analyzer knobs). The "Capturing · 44100 Hz · 1 ch" status line is driven by a new `audioStatus` WS broadcast emitted at 1 Hz from the engine.

The top-right **Reset to defaults** button POSTs `/audio/config/reset`, which wipes only the analyzer tuning back to `config.yaml` defaults. **Mic selection is preserved** — a reset doesn't force you back into `--choose_mic`. `enabled` does revert to the `config.yaml` default (currently `false`), which is what "reset" should mean.

### 8.3 Why a separate tab

This sort of tuning happens once per show / venue, not per pattern. Putting it on the deck would crowd the surface that operators are using to perform. The new tab is the right home for "set it and forget it (until soundcheck)" config.

---

## 9. Endpoints

| Method | Path                       | Purpose                                                                       |
| ------ | -------------------------- | ----------------------------------------------------------------------------- |
| GET    | `/audio/config`            | full live audio config (post-overrides)                                       |
| PATCH  | `/audio/config`            | partial update of live-tunable fields; persists to **per-scene `audio_state.yaml`** |
| POST   | `/audio/config/reset`      | wipe scene-level tuning back to `config.yaml` defaults; **preserves mic selection** (see §8.2) |
| GET    | `/audio/status`            | one-shot status snapshot (also broadcast every 1 s)                           |
| GET    | `/audio/devices`           | _optional, future_ — current mic + detected mic list (powered by `listAudioDevices`) |

WS broadcast types:

| `type`        | Cadence            | Payload                                                                                                                |
| ------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `audioStatus` | 1 Hz + on-change   | `{ enabled, backend, platform, inputFormat, device, deviceLabel, deviceId, sampleRate, channels, captureFps, lastFrameAtMs, lastKickMs, restartCount, errorCode, error, phase }` |
| (sharedParams)| existing throttle  | new keys flow through normal sharedParams emissions                                                                    |

Stable `audioStatus.phase` values: `disabled`, `starting`, `running`, `restarting`, `exited`, `stopped`, `error`.

Stable `audioStatus.errorCode` values: `null`, `ffmpeg_missing`, `device_not_configured`, `device_not_found`, `permission_denied`, `capture_exited`, `unsupported_platform`, `unknown`.

---

## 10. Test plan

Engine-side (node:test, no real audio):

1. **`audio_capture.test.js`** — fake-spawn shim that pushes pre-baked Int16 chunks; assert framing, restart-on-exit, stop cleanup.
2. **`audio_analyzer.test.js`** — synthesise pure sine waves and white noise, assert each band lights up correctly, assert kick fires once per impulse, respects refractory.
3. **`bpm_speed_sync.test.js`** — feed `tempoBpm` writes through a fake CPC; assert mapping math, edge cases (0 BPM, equal bounds, sync off).
4. **`param_center.test.js`** — extend with multi-subscriber test (two subscribes both fire, unsubscribe stops fires, legacy `onChange` still fires).
5. **`audio_config.test.js`** — `pickLiveFields` projects the per-scene subset; `validateLivePatch` rejects non-live fields.
6. **`audio_devices.test.js`** — parse canned AVFoundation + DirectShow ffmpeg output; correct `ffmpegDevice` strings; reject unsupported platforms.
7. **`audio_config_store.test.js`** — save/load round-trip for both files; saving mic does not stomp scene tuning and vice versa; `clearSavedMic` removes only mic fields; malformed YAML is tolerated.
8. **`engine_cli_flags.test.js`** — parses each flag combination; `--mic` rejects missing value; `flagsRequireExit` matrix.
9. **`audio_capture_platform.test.js`** — `buildFfmpegArgs` returns the right argv per platform; Windows without `device` throws `device_not_configured`; `spawn` is invoked with `shell:false` + `windowsHide:true`; `ffmpegPath` override threads through; extended `audioStatus` fields are emitted.

Manual live test (the user's rig):

- Music streamed from second machine, MBP mic listening.
- `audio.enabled: true`, walk through CaptainPad Audio Analysis tab, confirm low / mid / high move with the music, kick lights on each drum hit.
- Flip BPM-sync on with `/lx/tempo/bpm` arriving — confirm `speed` tracks BPM.
- Disable + re-enable mic at runtime — confirm bands smoothly fall to 0 and come back.

---

## 11. Out-of-scope / future

- Beat-aware effects (snap-to-beat fades) — needs phase, not just band energy.
- On-device BPM detection from mic — adds complexity; LX Studio already does this well.
- Per-band threshold envelopes / sidechain ducking.
- Pluggable detectors (claps, hi-hat, snare) — single kick covers 90% of value.
- iOS-side mic capture (CaptainPad listening) — engine is the canonical analysis point; routing mic from iPad would be a network hop with no benefit.
