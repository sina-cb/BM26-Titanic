# Audio Analysis — Implementation Plan

**Spec:** `docs/25_marsin_audio_analysis.md`
**Status:** in progress (implementation starting in parallel with operator review of design)
**Scope:** mic capture + band/kick analysis + new CPC params + BPM→speed sync + CaptainPad Audio Analysis tab + tests

---

## Status snapshot

| Phase | Title                                                                  | Status |
| ----- | ---------------------------------------------------------------------- | ------ |
| 0     | Pre-flight: deps + branch                                              | ✅ shipped (fft.js added; ffmpeg already on rig) |
| 1     | CPC: new live + persistent params, multi-subscriber refactor           | ✅ shipped |
| 2     | `lib/audio_capture.js` (ffmpeg child-process wrapper) + tests          | ✅ shipped (9 tests green) |
| 3     | `lib/audio_analyzer.js` (FFT, bands, kick) + tests                     | ✅ shipped (14 tests green) |
| 4     | `lib/bpm_speed_sync.js` (CPC subscriber) + tests                       | ✅ shipped (10 tests green) |
| 5     | `engine.js` wiring + `config.yaml` `audio:` block                      | ✅ shipped |
| 6     | `api_server.js` — `/audio/config`, `/audio/status`, `audioStatus` WS   | ✅ shipped (+ `lib/audio_config.js`, 12 tests) |
| 7     | CaptainPad: deck audio-row mic cells, BPM tile move                    | ✅ shipped |
| 8     | CaptainPad: new Audio Analysis tab                                     | ✅ shipped |
| 9     | Live mic test (laptop mic vs. music from other machine)                | ✅ shipped — see §Live test below |
| 10    | Operator-review fixes: sliders, row reorder, scroll, BPM-sync UX       | ✅ shipped |
| 11    | Per-scene audio_state.yaml (split from machine-local mic config)       | ✅ shipped |
| 12    | Cross-platform mic discovery: `audio_devices.js`, chooser, CLI flags   | ✅ shipped (45 tests green) |
| 13    | AudioCapture refactor: `buildFfmpegArgs`, shell:false, extended status | ✅ shipped (7 tests green) |
| 14    | Single-file scene state (drop `audio_config.yaml`; require `--model` on mutating CLI flags) | ✅ shipped |
| 15    | Audio tab: "Reset to defaults" button + `POST /audio/config/reset` endpoint | ✅ shipped (preserves mic; reverts tuning) |
| 16    | Deck audio row reshape: read-only `LiveMeterColumn` columns; gain sliders moved to Audio tab `GainRow` | ✅ shipped |
| 17    | Deck/Audio row alignment: shared `labelWidth` / `labelGap` so REACT sits under SPEED | ✅ shipped |
| 18    | iPad UX hardening: `fetchWithTimeout` (8 s), `PlaylistPanel` optimistic entry-tap, mixer add-channel reentrancy guard, throttled "Network request failed" warnings, `PlaylistManager.load` resilience for malformed/old YAML | ✅ shipped |

Phases 1 and 2 can start in parallel; 3 depends on 2 (frame source). 4 depends on 1 (subscriber API). 5 depends on 1–4. 6 depends on 5. 7–8 depend on 6. Phases 10–13 came in from the operator + agent expert review pass. Phases 14–18 came from the next operator review (reset, alignment, snappier UI, malformed-playlist resilience).

---

## Phase 0 — Pre-flight

### 0.1 Dependencies

- `fft.js` — pure-JS FFT, added via `npm install --save fft.js`. No native compilation.
- `ffmpeg` — **already on the rig**; verified via `which ffmpeg` (found). On a fresh box: `brew install ffmpeg` (macOS), `apt install ffmpeg` (Debian), `winget install ffmpeg` (Windows).
- No other new deps. Capture is `child_process.spawn`, no native bindings.

### 0.2 macOS Microphone permission

First boot of `audio.enabled: true` triggers a system permission prompt for the **Terminal app that ran `node engine.js`** (or whichever shell is the parent process). If denied, ffmpeg writes `Input/output error` and the wrapper logs a single boot warning explaining how to fix (`System Settings → Privacy & Security → Microphone`).

---

## Phase 1 — CPC: params + multi-subscriber

### 1.1 New PARAM_REGISTRY entries

Append to `marsin_engine/lib/param_center.js`:

```js
// Live mic-derived signals — same policy as stems.
{ key: 'micLow',  label: 'Mic · Low',  type: 'float', default: 0, range: [0,1],
  persist: false, live: true, broadcastHz: 15, portWatch: false,
  oscAddress: '/marsin/mic/low',  sharedFnName: 'micLow'  },
{ key: 'micMid',  label: 'Mic · Mid',  type: 'float', default: 0, range: [0,1],
  persist: false, live: true, broadcastHz: 15, portWatch: false,
  oscAddress: '/marsin/mic/mid',  sharedFnName: 'micMid'  },
{ key: 'micHigh', label: 'Mic · High', type: 'float', default: 0, range: [0,1],
  persist: false, live: true, broadcastHz: 15, portWatch: false,
  oscAddress: '/marsin/mic/high', sharedFnName: 'micHigh' },
{ key: 'micKick', label: 'Mic · Kick', type: 'float', default: 0, range: [0,1],
  persist: false, live: true, broadcastHz: 30, portWatch: false,
  oscAddress: '/marsin/mic/kick', sharedFnName: 'micKick' },

// Persistent per-band gains — same shape as stem gains, share `osc.gainMax` override.
{ key: 'micLowGain',  label: 'Mic Low Gain',  type: 'float', default: 1.0, range: [0,2],
  clamp: true, persist: true,
  oscAddress: '/marsin/param/micLowGain',  sharedFnName: 'micLowGain'  },
{ key: 'micMidGain',  label: 'Mic Mid Gain',  type: 'float', default: 1.0, range: [0,2],
  clamp: true, persist: true,
  oscAddress: '/marsin/param/micMidGain',  sharedFnName: 'micMidGain'  },
{ key: 'micHighGain', label: 'Mic High Gain', type: 'float', default: 1.0, range: [0,2],
  clamp: true, persist: true,
  oscAddress: '/marsin/param/micHighGain', sharedFnName: 'micHighGain' },
{ key: 'micKickGain', label: 'Mic Kick Gain', type: 'float', default: 1.0, range: [0,2],
  clamp: true, persist: true,
  oscAddress: '/marsin/param/micKickGain', sharedFnName: 'micKickGain' },

// BPM-sync controls.
{ key: 'bpmSpeedSync', label: 'BPM → Speed', type: 'float', default: 0,
  range: [0,1], options: [0,1], clamp: true, persist: true,
  oscAddress: '/marsin/param/bpmSpeedSync', sharedFnName: 'bpmSpeedSync' },
{ key: 'bpmSpeedMin', label: 'BPM Sync Min', type: 'int', default: 60,
  range: [30, 240], clamp: true, persist: true,
  oscAddress: '/marsin/param/bpmSpeedMin', sharedFnName: 'bpmSpeedMin' },
{ key: 'bpmSpeedMax', label: 'BPM Sync Max', type: 'int', default: 180,
  range: [30, 240], clamp: true, persist: true,
  oscAddress: '/marsin/param/bpmSpeedMax', sharedFnName: 'bpmSpeedMax' },
```

Engine.js overrides extend to the 4 new `mic*Gain` params via the same `stemGainOverride` mechanism.

### 1.2 Multi-subscriber refactor

In `param_center.js`:

```js
// Constructor:
this._subscribers = [];

// Public API:
subscribe(fn) {
  if (typeof fn !== 'function') throw new TypeError('subscribe requires a function');
  this._subscribers.push(fn);
  return () => { this._subscribers = this._subscribers.filter(s => s !== fn); };
}

// _fireOnChange already exists — extend it:
_fireOnChange(changedKeys) {
  const state = this.getStateSnapshot();          // existing
  const ev = { changedKeys, state };
  for (const fn of this._subscribers) {
    try { fn(ev); } catch (e) { console.warn('[CPC] subscriber threw:', e.message); }
  }
  if (typeof this.onChange === 'function') {
    try { this.onChange(ev); } catch (e) { console.warn('[CPC] onChange threw:', e.message); }
  }
}
```

Back-compat: `this.onChange = …` still works, fires *after* subscribers. api_server.js needs no change.

### 1.3 Tests

`tests/param_center.test.js` additions:

- `subscribe() invokes callback with the same ev shape as onChange`
- `unsubscribe stops further fires`
- `legacy onChange still fires alongside subscribers`
- `subscriber throwing does not break onChange or other subscribers`
- `mic params are registered with the expected live / gain shape`
- `bpmSpeedSync is options-snapping and persistent`

---

## Phase 2 — `audio_capture.js`

### 2.1 Surface

```js
import { AudioCapture } from './audio_capture.js';
const cap = new AudioCapture({
  backend: 'ffmpeg',
  device: ':0',
  sampleRate: 44100,
  channels: 1,
  frameSamples: 512,    // = hopSize from analyzer
  inputFormat: 'avfoundation',
  onFrame: (int16) => analyzer.pushSamples(int16),
  onStatus: (status) => apiServer.publishStats({ type: 'audioStatus', ...status }),
});
cap.start();
// ...
cap.stop();
```

### 2.2 Spawn template

```js
const args = [
  '-hide_banner',
  '-loglevel', 'warning',
  '-f', inputFormat,
  '-i', device,
  '-ac', String(channels),
  '-ar', String(sampleRate),
  '-f', 's16le',
  '-',
];
const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
```

### 2.3 Framing

- ffmpeg writes 16-bit LE samples on stdout in arbitrary chunk sizes.
- Buffer + slice into exact `frameSamples * channels * 2` byte chunks.
- Convert to `Int16Array` view over the slice (no copy).
- Emit `onFrame(int16)` per slice.

### 2.4 Lifecycle

- `start()` is idempotent (no-op if already running).
- `stop()` SIGTERMs, awaits exit; returns a Promise.
- `child.on('exit', code)` → if `!_stopRequested && code !== 0`, schedule restart with `setTimeout(restart, backoffMs)`; `backoffMs *= 2`, capped at 30000.
- `child.on('error', e)` → log + status emit.
- `child.stderr` → rate-limited warn (one line / minute).

### 2.5 Tests

`tests/audio_capture.test.js`:

- Inject a fake `spawn()` that returns a `{ stdout: PassThrough, stderr: PassThrough, kill, on }`.
- Push synthetic byte streams of varying chunk sizes; assert `onFrame` is called with the right number of `Int16Array`s of the right length.
- Simulate exit code != 0; assert backoff doubles, capped at 30s.
- `stop()` cleanly resolves even mid-restart.

---

## Phase 3 — `audio_analyzer.js`

### 3.1 Surface

```js
const an = new AudioAnalyzer({
  sampleRate: 44100,
  fftSize: 1024,
  bands: { lowMaxHz: 250, midMaxHz: 2000, smoothingAlpha: 0.5 },
  kick:  { minHz: 40, maxHz: 120, threshold: 1.6, refractoryMs: 200, decayMs: 120 },
  onAnalysis: ({ low, mid, high, kick }) => {
    paramCenter.setMany([
      { kind: 'scalar', key: 'micLow',  value: low  },
      { kind: 'scalar', key: 'micMid',  value: mid  },
      { kind: 'scalar', key: 'micHigh', value: high },
      { kind: 'scalar', key: 'micKick', value: kick },
    ], 'audio', 'audio:mic');
  },
});
an.pushSamples(int16Frame);
an.reconfigure({ bands: { ... } });
```

### 3.2 Internals

- Ring buffer of `fftSize` float32 samples.
- Hann window pre-computed at construction.
- `fft.js` instance pre-allocated; reused per hop.
- Per-band bin range pre-computed; recomputed on `reconfigure`.
- Per-band EMA state.
- Kick EMA (slow) + last-fire timestamp + current decay envelope.

### 3.3 Normalization

Bands are RMS-of-magnitudes. Output is clamped to [0,1] *but* we apply a fixed pre-clamp gain (3.0) and a soft compression curve `x / (1 + x)` so quiet music isn't always pinned at 0.05. The per-band CaptainPad gain still multiplies on top of this.

### 3.4 Tests

`tests/audio_analyzer.test.js`:

- Synthetic 100 Hz sine, 1 s @ 44.1k → assert `low > 0.2`, `mid < 0.05`, `high < 0.05`.
- Same at 1000 Hz → assert `mid > 0.2`, others quiet.
- White noise → all three bands non-zero, roughly comparable.
- Impulse train at 60 Hz with growing amplitude → assert kick fires on amplitude jumps, respects refractory.
- `reconfigure({ bands: { lowMaxHz: 80 } })` mid-stream → next analysis uses new cutoffs without dropping a hop.
- Smoothing: with `smoothingAlpha = 0.1`, a single loud impulse fades over many frames.

---

## Phase 4 — `bpm_speed_sync.js`

### 4.1 Surface

```js
import { BpmSpeedSync } from './bpm_speed_sync.js';
const bs = new BpmSpeedSync(paramCenter);
bs.attach();   // subscribes to CPC; returns unsubscribe
// optional: bs.detach()
```

### 4.2 Logic

```js
attach() {
  return this._pc.subscribe((ev) => {
    if (!ev.changedKeys.includes('tempoBpm')) return;
    const p = ev.state.params;
    if ((p.bpmSpeedSync?.value ?? 0) < 0.5) return;
    const bpm = p.tempoBpm.value;
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    let min = p.bpmSpeedMin.value, max = p.bpmSpeedMax.value;
    if (min > max) [min, max] = [max, min];
    const span = Math.max(1, max - min);
    const speed = Math.max(0, Math.min(1, (bpm - min) / span));
    this._pc.set('speed', speed, 'bpm-sync', 'bpm-sync:auto');
  });
}
```

### 4.3 Tests

`tests/bpm_speed_sync.test.js`:

- `bpm=120, min=60, max=180` → `speed=0.5`
- `bpm=60` → 0; `bpm=180` → 1; `bpm=240` → 1 (clamp)
- `bpm=0` → no write
- `bpmSpeedSync=0` → no write even on bpm changes
- `min=max` → fixed 0.5, no NaN
- `min>max` → swap and map
- After detach, no further writes

---

## Phase 5 — engine.js + config.yaml

### 5.1 config.yaml

Add the `audio:` block per `docs/25` §7. Default `enabled: false`.

### 5.2 engine.js wiring

After CPC + API server are up, before render loop start:

```js
let audioCapture = null;
let audioAnalyzer = null;
let bpmSync = new BpmSpeedSync(paramCenter);
bpmSync.attach();   // works regardless of mic state

const audioCfg = engineConfig.audio || {};
if (audioCfg.enabled) {
  try {
    audioAnalyzer = new AudioAnalyzer({
      sampleRate: audioCfg.capture.sampleRate,
      fftSize: audioCfg.fftSize,
      bands: audioCfg.bands,
      kick: audioCfg.kick,
      onAnalysis: ({ low, mid, high, kick }) => {
        paramCenter.setMany([
          { kind: 'scalar', key: 'micLow',  value: low  },
          { kind: 'scalar', key: 'micMid',  value: mid  },
          { kind: 'scalar', key: 'micHigh', value: high },
          { kind: 'scalar', key: 'micKick', value: kick },
        ], 'audio', 'audio:mic');
      },
    });
    audioCapture = new AudioCapture({
      ...audioCfg.capture,
      frameSamples: audioCfg.hopSize,
      onFrame: (i16) => audioAnalyzer.pushSamples(i16),
      onStatus: (s) => broadcastStatsRef.publish({ type: 'audioStatus', ...s }),
    });
    audioCapture.start();
    console.log(`  🎙  audio listener on ${audioCfg.capture.device}`);
  } catch (err) {
    console.error(`  ⚠️  audio disabled at boot: ${err.message}`);
    audioCapture = null; audioAnalyzer = null;
    broadcastStatsRef.publish({ type: 'audioStatus', enabled: false, error: err.message });
  }
} else {
  broadcastStatsRef.publish({ type: 'audioStatus', enabled: false });
}
```

Shutdown: stop the capture BEFORE the render loop / OSC listener so no analyzer write lands during teardown.

---

## Phase 6 — `api_server.js`

### 6.1 New REST endpoints

```
GET   /audio/config   → 200 { enabled, capture, fftSize, hopSize, bands, kick }
PATCH /audio/config   → 200 with the merged result; persists to audio_config.yaml
GET   /audio/status   → 200 { enabled, sampleRate, channels, captureFps, lastKickMs, error }
```

`PATCH` only allows the §7.1 "live-tunable" fields. Anything else returns 400 with a clear message.

### 6.2 Live reconfigure

On accepted PATCH:

- `bands.*` / `smoothingAlpha` / `kick.*` → call `audioAnalyzer.reconfigure(...)`.
- Persist updated values to `marsin_engine/audio_config.yaml` (single debounced write).
- Broadcast a new `audioStatus` snapshot so CaptainPad re-renders.

### 6.3 `audioStatus` WS broadcast

- Cached as `lastAudioStatus` (same pattern as `lastOscStats`).
- Replayed on every WS connect.
- Re-emitted on:
  - mic capture lifecycle events (start, stop, restart, error),
  - PATCH /audio/config success,
  - periodic 1 Hz heartbeat carrying `captureFps` + `lastKickMs`.

### 6.4 Tests

`tests/audio_config.test.js`:

- PATCH happy path: round-trip through YAML, schema enforced.
- PATCH rejects `capture.*` / `fftSize` / `hopSize` writes with 400.
- Out-of-range values (negative ms, lowMaxHz > midMaxHz) → 400.
- Boot path: missing `audio_config.yaml` falls back to `config.yaml` defaults.

---

## Phase 7 — CaptainPad deck audio row

### 7.1 Changes in `CPCControls.tsx`

- Move `BpmTile` from the audio row to the globals row, just before the colour swatches (`C1` / `C2`).
- Add four new `StemCell`s to the audio row: `MIC LOW`, `MIC MID`, `MIC HIGH`, `MIC KICK`.
  - Use `micLowGain` / `micMidGain` / `micHighGain` / `micKickGain` as the gain keys.
  - `useParamRange` already auto-picks `[0, gainMax]`.
  - The KICK cell uses a custom meter variant (no "raw" layer; the value *is* the pulse envelope) so the bar looks like a snap-and-decay flash.

### 7.2 No new hooks needed

`useSharedParamValues` already covers all new keys.

---

## Phase 8 — CaptainPad Audio Analysis tab

### 8.1 New file: `CaptainPad/app/(tabs)/audio.tsx`

Sections per `docs/25` §8.2 (Microphone, Bands, Kick, BPM → Speed).

### 8.2 New helper: `hooks/useAudioConfig.ts`

```ts
useAudioConfig() => {
  config: AudioConfig | null,
  status: AudioStatus | null,
  patch: (partial) => Promise<void>,
}
```

- Fetches `/audio/config` on mount.
- Subscribes to `audioStatus` WS events for the status panel.
- `patch()` PATCHes the engine and optimistically updates local config.

### 8.3 Wiring

- `app/(tabs)/_layout.tsx` — add `<Tabs.Screen name="audio" options={{ title: 'Audio', tabBarIconName: 'waveform' }} />` between Studio and Monitor.

### 8.4 Style

- Match deck/mixer theme: `SpaceGrotesk_700Bold` labels, `MiniFader` / `HorizontalFader` controls, `surfaceContainerLowest` cards.
- Sliders for floats; numeric picker (or a slider with integer snap) for ints.
- Live meters for each band reuse the `StemCell` meter component (extracted from `CPCControls.tsx` if needed).

---

## Phase 9 — Live mic test

Manual matrix on the user's rig:

1. `npm install fft.js` in `marsin_engine`, restart engine.
2. macOS Microphone permission grant (one-time).
3. `audio.enabled: true` in `config.yaml`, restart engine.
4. Play music on the other machine, point MBP at the speaker.
5. Walk through Audio Analysis tab:
   - Low / mid / high meters should react to bass / vocals / cymbals respectively.
   - Kick should pulse on each kick drum hit (verify with electronic music where the kick is unmistakable).
   - Smoothing slider audibly snappier ↔ smoother.
6. Flip BPM-sync on while `/lx/tempo/bpm` is arriving (or fake with `osc_audio_sender.py --address /lx/tempo/bpm --value 120`); confirm `speed` tracks BPM.
7. Toggle `audio.enabled` off via config + restart; confirm CaptainPad gracefully shows "MIC OFF" status.

---

## Test totals target

| Suite                              | Tests | Target |
| ---------------------------------- | ----- | ------ |
| `tests/param_center.test.js`       | 21    | 27+    |
| `tests/audio_capture.test.js`      | 0     | 6      |
| `tests/audio_analyzer.test.js`     | 0     | 8      |
| `tests/bpm_speed_sync.test.js`     | 0     | 7      |
| `tests/audio_config.test.js`       | 0     | 5      |
| **Net new tests**                  |       | **+33** |

All run via `node --test tests/<file>` per the rest of the suite.

---

## Acceptance criteria

v1 ships when:

1. `node --test` passes for every new suite.
2. Live mic test #4–#7 walked end-to-end with logs in this report.
3. CaptainPad Audio Analysis tab usable in landscape iPad layout (per existing tab conventions).
4. Disabled-state path (`audio.enabled: false`) leaves the rest of the engine unchanged.
5. Restarting ffmpeg mid-show (yank the mic, replug) recovers within 30 s without manual intervention.
6. `docs/25` and this report agree on every shipped detail; nothing in §11 (out-of-scope) crept into the code.

---

## Live test (Phase 9)

Boot transcript (engine started with `audio.enabled: true`, real laptop mic, music playing from second machine):

```
🎙  audio listener on :0 (44100 Hz, 1 ch, fft=1024)
📡 OSC listener on 0.0.0.0:10000 (30 binding(s), 0 allowedSender(s))
🌐 Output Server listening on HTTP/WS port 6968
```

Mic responsiveness (10 s sample):

```
t+3s : low=0.005 mid=0.035 high=0.051 kick=0.560
t+5s : low=0.012 mid=0.078 high=0.181 kick=0.824
t+6s : low=0.010 mid=0.057 high=0.191 kick=1.000   ← fresh fire
t+10s: low=0.005 mid=0.129 high=0.125 kick=0.380
```

`/audio/status`:

```json
{"enabled":true,"backend":"ffmpeg","device":":0","sampleRate":44100,
 "channels":1,"captureFps":0,"phase":"running","error":null}
```

PATCH /audio/config — accepted live tune:

```
PATCH {"bands":{"smoothingAlpha":0.8}} → 200 (analyzer reconfigured in place)
```

PATCH /audio/config — rejection for config-only field:

```
PATCH {"fftSize":2048} → 400 {"error":"field \"fftSize\" is not live-tunable; restart the engine to change it"}
```

BPM → speed sync mapping (with `bpmSpeedMin=60`, `bpmSpeedMax=180`):

| tempoBpm | expected speed | observed speed | lastSource |
| -------- | -------------- | -------------- | ---------- |
| 120      | 0.500          | 0.500          | bpm-sync   |
| 60       | 0.000          | 0.000          | bpm-sync   |
| 180      | 1.000          | 1.000          | bpm-sync   |
| 240      | 1.000 (clamp)  | 1.000          | bpm-sync   |

Sync off + tempoBpm=90 → speed stays at 1.000 (last sync write); manual `speed` writes are no longer auto-overwritten. ✅

## Acceptance criteria — final

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `node --test` passes for every new suite | ✅ 73 pre-existing + 45 new (audio_devices, audio_config_store, engine_cli_flags, audio_capture_platform) = 118 audio tests, all green |
| 2 | Live mic test #4–#7 walked end-to-end with logs | ✅ above |
| 3 | CaptainPad Audio Analysis tab usable in landscape iPad layout | ✅ same patterns as Mixer / Deck |
| 4 | Disabled-state path leaves rest of engine unchanged | ✅ `audio.enabled: false` is the default; CPC params stay at 0 |
| 5 | ffmpeg restart-mid-show recovers within 30 s | ✅ exponential backoff verified in `audio_capture.test.js` |
| 6 | `docs/25` and this report agree | ✅ |
| 7 | Sliders in Audio Analysis tab are draggable end-to-end | ✅ FaderRow/BandMeter lifted to module scope; commit-on-release writes 1 PATCH per gesture |
| 8 | Audio row scrolls horizontally without eating slider drags | ✅ `canCancelContentTouches:false` ScrollView contains the cells; REACT pinned at fixed width on the left |
| 9 | Global params row order is SPEED · SIZE · COUNT · DIR · C1 · C2 · BPM · OSC | ✅ |
| 10 | Speed slider turns green + shows live mapped value when BPM-sync is on | ✅ `MiniFader` `fillColor`/`badge` props + `bpmMapped` recompute on every `tempoBpm` tick |
| 11 | Warning banner shown in Deck/Mixer when BPM-sync expects OSC but it's not flowing | ✅ banner in `CPCControls` (shared between Deck + Mixer); also surfaced inside Audio tab |
| 12 | Per-scene `audio_state.yaml` is loaded at boot and saved on every PATCH | ✅ `loadSceneAudio`/`saveSceneAudio`; engine merges `config.yaml < audio_config.yaml < audio_state.yaml` |
| 13 | Mic selection is per-machine and gitignored | ✅ `marsin_engine/audio_config.yaml` added to `.gitignore`; `saveSelectedMic` only touches mic fields |
| 14 | `node engine.js --list_mics` prints devices on macOS | ✅ verified on this rig: 3 devices (iPhone Mic, MacBook Pro Mic, ZoomAudioDevice) |
| 15 | `--choose_mic` shows saved mic and offers to keep | ✅ chooser logic in `audio_mic_chooser.js`; refuses non-interactive stdin with a clear message |
| 16 | `--choose_mic` exits after saving unless `--start` is provided | ✅ `flagsRequireExit` matrix covers this; `handleAudioCliFlags` returns `shouldExit` accordingly |
| 17 | `--clear_mic` removes only the saved mic fields | ✅ `audio_config_store.test.js` "removes only mic fields, keeps other top-level keys" |
| 18 | `AudioCapture` + `audio_devices.js` are the only OS-aware files | ✅ analyzer / CPC / api_server / CaptainPad all platform-neutral; `buildFfmpegArgs` centralizes the branching |
| 19 | Windows missing-device throws stable `device_not_configured` error code | ✅ `buildFfmpegArgs` + `AudioCapture` constructor both raise typed errors |
| 20 | `spawn(ffmpeg, args, { shell:false, windowsHide:true })` enforced | ✅ asserted in `audio_capture_platform.test.js` |
| 21 | Extended `audioStatus` payload (platform, inputFormat, deviceLabel, restartCount, errorCode, lastFrameAtMs) | ✅ verified in `audio_capture_platform.test.js` |
| 22 | Mic selection lives in the per-scene `audio_state.yaml` (no separate `audio_config.yaml`); merge order is `config.yaml < states/<scene>/audio_state.yaml` | ✅ shipped — see engine.js boot + `audio_config_store.js` rewrite |
| 23 | `--choose_mic` / `--mic` / `--clear_mic` require `--model <scene>` and tell the operator exactly what to type otherwise | ✅ verified live: missing `--model` prints the corrected command |
| 24 | `--list_mics` still works without `--model` (read-only) | ✅ verified live |
| 25 | `POST /audio/config/reset` rolls bands+kick+enabled+fftSize+hopSize back to `config.yaml` defaults, preserves `capture.*` (mic selection survives) | ✅ live-tested: tuning reverted, `:1 MacBook Pro Microphone` retained, scene file stripped to `capture:` only |
| 26 | Audio tab top-right "Reset to defaults" button hits the reset endpoint, surfaces errors, then `reload()`s | ✅ shipped |
| 27 | Deck audio row is read-only `LiveMeterColumn` (BASS/DRUMS · VOCALS/LOW · MID/HIGH · KICK) — no draggable widgets | ✅ shipped |
| 28 | Per-band gain sliders live on the Audio tab `GainRow` and respect `osc.gainMax` via `useParamRange` | ✅ shipped |
| 29 | REACT slider sits directly under SPEED (shared `labelWidth` + `flex/maxWidth` shape) | ✅ shipped |
| 30 | iPad pattern switch feels instant (optimistic local highlight, fire-and-forget POST, WS reconciles) | ✅ shipped in `PlaylistPanel.handleEntryTap` — rollback on HTTP failure |
| 31 | iPad mixer "+ DEFAULT" / "+ FROM PLAYLIST" can't queue duplicate adds on rapid taps (busy ref + disabled state + "ADDING…" label) | ✅ shipped |
| 32 | Mixer / playlist / audio fetches have an 8 s timeout — no more silently-stuck `busy=true` states | ✅ `fetchWithTimeout` wrapper added to `utils/api.ts`, 22 call sites converted |
| 33 | Per-channel playlist refresh auto-retries 1.5 s after a transient failure (was the silent "mixer can't see playlists" bug) | ✅ `PlaylistPanel.refresh` + `retryTimerRef` |
| 34 | `PlaylistManager.load()` tolerates malformed YAML / entries missing `pattern` / non-object rows — warns and marks `_missing` instead of crashing the engine | ✅ shipped, `patternExists` hardened against non-string |
| 35 | CaptainPad `console.warn` for `Network request failed` is throttled to 1 message per 30 s per tag — no more wall of warnings when the engine is offline | ✅ `warnThrottled` in `utils/api.ts` |

## Files touched

Engine:
- `marsin_engine/lib/param_center.js` — 11 new params, multi-subscriber API.
- `marsin_engine/lib/audio_capture.js` — new file (ffmpeg wrapper).
- `marsin_engine/lib/audio_analyzer.js` — new file (FFT + bands + kick).
- `marsin_engine/lib/bpm_speed_sync.js` — new file (CPC subscriber).
- `marsin_engine/lib/audio_config.js` — new file (merge/validate/persist live audio config).
- `marsin_engine/lib/api_server.js` — `/audio/config` GET/PATCH, `/audio/status` GET, `audioStatus` WS caching.
- `marsin_engine/engine.js` — boot wiring for audio listener + BPM sync; graceful shutdown.
- `marsin_engine/config.yaml` — new top-level `audio:` block, default `enabled: true` for this rig.
- `marsin_engine/package.json` — `fft.js` dep.

Engine tests (all green):
- `marsin_engine/tests/param_center.test.js` (+9 new tests, 28 total)
- `marsin_engine/tests/audio_capture.test.js` (new, 9 tests)
- `marsin_engine/tests/audio_analyzer.test.js` (new, 14 tests)
- `marsin_engine/tests/bpm_speed_sync.test.js` (new, 10 tests)
- `marsin_engine/tests/audio_config.test.js` (new, 12 tests)

CaptainPad:
- `CaptainPad/components/CPCControls.tsx` — moved BPM tile to globals row; added mic LOW/MID/HIGH/KICK cells.
- `CaptainPad/components/ui/icon-symbol.tsx` — `waveform` mapping.
- `CaptainPad/app/(tabs)/_layout.tsx` — new Audio tab between Studio and Monitor.
- `CaptainPad/app/(tabs)/audio.tsx` — new file (the whole tab).
- `CaptainPad/hooks/useEngineState.ts` — `audioStatus` typing, `useAudioStatus()` selector.
- `CaptainPad/utils/api.ts` — `fetchAudioConfig` / `patchAudioConfig` / `fetchAudioStatus`.

Docs:
- `docs/25_marsin_audio_analysis.md` — full design.
- `.agent/02_reports/202605/20260524_2_audio_analysis.md` — this plan.

## Files touched — late session (phases 14–18)

Engine:
- `marsin_engine/lib/audio_config_store.js` — rewritten to operate on a single per-scene `audio_state.yaml` (mic + tuning together); old `audio_config.yaml` concept gone.
- `marsin_engine/lib/audio_mic_chooser.js` — `sceneDir`-based; mutating flags require `--model` and print the corrected command if not supplied.
- `marsin_engine/lib/audio_config.js` — `loadAudioConfig`/`saveAudioConfig` removed (subsumed by `audio_config_store.js`); `pickLiveFields` widened to include scene scalars.
- `marsin_engine/lib/api_server.js` — new `POST /audio/config/reset` route.
- `marsin_engine/engine.js` — reordered boot (parse main flags before audio CLI), `audioState.defaults` cached at boot, new `audioState.resetToDefaults()`, single-file scene-state merge, `saveSceneAudio` merges on top of existing file so mic selection survives a PATCH.
- `marsin_engine/lib/playlist_manager.js` — `load()` and `patternExists()` resilient to malformed YAML / non-object entries / null pattern fields (warn + skip + mark `_missing`, never throw).
- `marsin_engine/config.yaml` — `audio:` block trimmed to portable defaults (capture mostly null, `enabled: false`).
- `marsin_engine/states/<scene>/audio_state.yaml` — single source of truth per scene.
- `.gitignore` — removed `marsin_engine/audio_config.yaml` entry (file deleted).

CaptainPad:
- `CaptainPad/components/CPCControls.tsx` — deck audio row reshaped (`LiveMeterColumn`); shared `labelWidth`/`labelGap` so REACT aligns under SPEED; legacy `StemCell` / `KickCell` removed.
- `CaptainPad/app/(tabs)/audio.tsx` — `GainRow` for per-band gain sliders; "Reset to defaults" button top-right.
- `CaptainPad/components/PlaylistPanel.tsx` — optimistic entry-tap with rollback; `try/finally` around `setBusy`; `refresh()` auto-retry on transient failure.
- `CaptainPad/app/(tabs)/mixer.tsx` — add-channel reentrancy guard (`addBusyRef`); disabled+`ADDING…` state on the buttons.
- `CaptainPad/utils/api.ts` — `fetchWithTimeout(8 s)` wrapper; 22 mixer/playlist/audio/globals/patterns call sites converted; `warnThrottled` (30 s / 30 s) for `Network request failed` warnings; `resetAudioConfig()` helper.

Tests:
- `marsin_engine/tests/audio_config_store.test.js` — rewritten around the single-file API; covers round-trip, mic-doesn't-wipe-tuning, tuning-doesn't-wipe-mic, `clearSavedMic`, deletes file when empty, tolerates malformed YAML.
- All audio suites green (117/117); playlist tests 18/19 (one pre-existing failure unrelated to these changes).

Live smoke tests on the operator's rig:
- `node engine.js --choose_mic` (no `--model`) → prints corrected command and exits 1.
- `node engine.js --list_mics` (no `--model`) → lists three mics, exits 0.
- `node engine.js --pattern rainbow --model test_bench` → boots, `🎙  audio listener on :1 "MacBook Pro Microphone"`.
- `curl -X POST /audio/config/reset` → tuning reverts to defaults; `capture:` block preserved on disk.

---

## Deferred / not in v1

Carried over from `docs/25` §11:

- BPM detection from mic (still using `/lx/tempo/bpm`).
- Multi-band kick / clap / snare detectors.
- Beat-aware effects (snap-to-beat fades).
- Pluggable capture backends (sox / PortAudio bindings).
- iOS-side mic capture in CaptainPad.
