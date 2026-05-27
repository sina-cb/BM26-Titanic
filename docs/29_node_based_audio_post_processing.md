# Design: Node-Based Audio Post-Processing + AUDIO Tab Reshape

**Status:** Implemented (2026-05)
**Operator request (summarized):**
1. General UI improvements to the AUDIO tab.
2. Pin a live signals card to the top so meters are always visible while tuning.
3. Per-signal history trail (5/10/15/30 s) — TouchDesigner-style, cheap-when-off.
4. Per-signal post-processing node chain (TouchDesigner CHOP-style), engine-side, feeds the WHOLE system downstream, well-tested ops from DSP literature, fast.
5. Detection / processing tuning audit + tightening of `audio_analyzer.js`.
6. Same chain framework applied to OSC stems (`stemsBass/Drums/Vocals`).

**Related:** investigation report `.agent/02_reports/202605/20260526_1_audio_analysis_report.md` · existing audio spec `docs/25_marsin_audio_analysis.md` · modulation contract `docs/26_audio_params_playlist.md`.

---

## Why

Today the operator tunes audio analysis with the meters mid-page and a single global noise gate, then watches the LEDs react via a stale slider feel; the only signal-shape control is the per-band `mic*Gain`. Modern audio-reactive systems (TouchDesigner CHOPs, Resolume Wire) give the operator a per-signal *chain* of small, well-understood operators (gain → filter → schmitt → compressor) so a `micKick` can be shaped from "loud bass band" into "clean trigger pulse" without anyone writing C code. The Titanic show is a chaotic-volume environment (playa wind, generator, music bleed); per-signal shaping is the difference between a rig that visibly reacts to the music and one that strobes randomly.

Codex DNA served: **TE DNA** (the operator gets a professional VJ surface), **kind** (the chain lets them tune the rig once and walk away — no constant re-touching mid-show), **fun** (signal trails make the system feel responsive even when tuning).

---

## Processing locality (read this before anything else)

**Operator rule, verbatim:** *"The iPad is just the UI. The node-based UI that lets us essentially design the audio post processing system, but everything happens on the server. No iPad processing at all. The iPad is and must be the UI only."*

| Concern | Where it lives |
|---|---|
| Raw band energy / FFT / kick detection | engine (`audio_analyzer.js`) |
| Chain op math (Gain, LPF, Schmitt, Hold, Compressor, Biquad, …) | engine (`signal_post_processor.js`) |
| Chain config persistence | engine (`audio_state.yaml`) |
| Chain config validation | engine (`signal_post_processor.js validateChain`) |
| Chain config edit (drag, reorder, param sliders) | iPad UI — emits REST calls; the engine applies + broadcasts the result |
| Pinned meter values | iPad **displays** values from the engine's `liveParams` |
| Pre-op / post-op preview in chain editor | iPad **displays** values from the engine's `signalChain` debug broadcast |
| History trail values | iPad **displays** values from `liveParams`, buffered locally (see exception below) |

**Zero audio math runs on the iPad.** Every value the iPad shows came from the engine in the most recent WS frame. Every chain edit the operator performs is a config change shipped to the engine; the engine re-computes and the iPad redraws.

**The one deliberate exception — history-trail ring buffer.** The trails store the last N seconds of `liveParams` values in an iPad-side ring buffer (~2.4 KB of float32 per signal at 20 Hz × 30 s). This is not processing — the iPad is just remembering values it has already received, so it can draw a polyline. The alternative (engine-side trail buffer + a separate WS topic that pushes N seconds × 7 signals every tab open) is strictly worse: more bytes on the wire and no new information. Storing-what-you-already-received is not the same as computing — calling out the exception explicitly so a future reader doesn't blur the line.

If a future feature ever wants to derive *new* signal values from the trail (e.g. "trigger on the variance of micLow over the last 5 s"), that derivation lives on the engine as a new op, not on the iPad.

---

## Sketches

### Wireframe A — AUDIO tab, new shape (happy path, audio enabled, both stems + mic live)

*Every meter, bar, and number below is rendered from the engine's `liveParams` broadcast. Op rows display the engine's `signalChain` preview. The iPad computes nothing.*

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ PINNED ─────────────────────────────────────────────────────────────────────┐ │
│ │ ♪ AUDIO  ●LISTENING · 86 fps           Trail [5s] [10s] [15s] [30s]  Reset   │ │
│ │                                                                              │ │
│ │  MIC LOW  ▓▓▓▓▓▓▓▒░ 73%  ╱╲ ╱─╲╱──╲╱─╲    STEMS BASS  ▓▓▓░░░░ 30% ──╲╱─    │ │
│ │  MIC MID  ▓▓░░░░░░ 22%  ───────╱─╲──     STEMS DRUMS ▓▓▓▓▓░░ 56% ╱╲╱╲╱─    │ │
│ │  MIC HIGH ▓░░░░░░░ 11%  ──────────╱──    STEMS VOC.  ▓░░░░░░ 12% ────╱──   │ │
│ │  MIC KICK ●▒░░░░░░  +ø    │ │ │ │   │    TEMPO 124 BPM → SPEED 0.53  ●BPM   │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│ ┌─ SIGNALS · CHAINS ───────────────────────────────────────────────────────────┐ │
│ │  MIC LOW                                                          [edit ▾]   │ │
│ │    raw ─→ [Gain 1.20×] [LPF 5Hz] [Compressor] ─→ CPC                         │ │
│ │                                                                              │ │
│ │  MIC MID                                                          [edit ▾]   │ │
│ │    raw ─→ [Gain 1.00×] ─→ CPC                                                │ │
│ │                                                                              │ │
│ │  MIC HIGH                                                         [edit ▾]   │ │
│ │    raw ─→ [Gain 1.00×] ─→ CPC                                                │ │
│ │                                                                              │ │
│ │  MIC KICK                                                         [edit ▼]   │ │
│ │    raw ─→ [BandPass 50–110] [Envelope 8/180ms] [Schmitt 1.8/1.4]             │ │
│ │            [Hold 120ms] ─→ CPC                                               │ │
│ │     ┌────────────────────────────────────────────────────────────────────┐   │ │
│ │     │ KICK CHAIN — full editor (see Wireframe E)                         │   │ │
│ │     └────────────────────────────────────────────────────────────────────┘   │ │
│ │                                                                              │ │
│ │  STEMS BASS                                                       [edit ▾]   │ │
│ │    raw ─→ [Gain 1.00×] ─→ CPC                                                │ │
│ │  STEMS DRUMS                                                      [edit ▾]   │ │
│ │  STEMS VOCALS                                                     [edit ▾]   │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│ ┌─ SETTINGS ▼ (collapsed by default) ──────────────────────────────────────────┐ │
│ │   Microphone · BPM → Speed Sync · Bands (lowMaxHz, midMaxHz)                 │ │
│ │   Engine (fftSize, hopSize) · Reset to defaults                              │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Wireframe B — Empty state (audio off, no stems)

```
┌─ PINNED ─────────────────────────────────────────────────────────────────────┐
│ ♪ AUDIO  ○ DISABLED                            Trail [5s] [10s] [15s] [30s]  │
│                                                                              │
│   ─── No signal ───                              ─── Stems offline ───       │
│   Tap MIC ANALYSIS below to enable.              Start LX Studio + verify    │
│                                                  OSC bindings on port 10000. │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Wireframe C — Mic on, OSC down

```
┌─ PINNED ─────────────────────────────────────────────────────────────────────┐
│ ♪ AUDIO  ●LISTENING · 86 fps                  Trail [10s]            Reset   │
│                                                                              │
│  MIC LOW  ▓▓▓▓░░ 41%   ╱╲╱─╲   STEMS  ⚠ OSC LISTENER OFF                    │
│  MIC MID  ▓░░░░░  9%   ──────   No tempoBpm, no bass, no drums.              │
│  MIC HIGH ░░░░░░  0%   ──────   Check engine config.yaml: osc.enabled        │
│  MIC KICK ●░░░░░░       │ │     and verify port 10000 isn't in use.          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Wireframe D — Engine offline (WS disconnected)

```
┌─ PINNED ─────────────────────────────────────────────────────────────────────┐
│ ♪ AUDIO  ⚠ ENGINE OFFLINE                                                    │
│                                                                              │
│   ──────────  Reconnecting in 2.5 s…  ──────────                             │
│                                                                              │
│   Trails frozen at last known values. Settings disabled until reconnect.     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Wireframe E — Chain editor (one signal, expanded)

```
┌─ MIC KICK — CHAIN ───────────────────────────────────────────────────────────┐
│                                                                              │
│   raw ─→ ⠿ BandPass    [50] [110] Hz                       [✓] [⊖] [↑] [↓]  │
│         │ pre: ▓░░ 0.12    post: ▓░░ 0.10                                    │
│                                                                              │
│      ─→ ⠿ Envelope     attack [8] ms  release [180] ms     [✓] [⊖] [↑] [↓]  │
│         │ pre: ▓░░ 0.10    post: ▓░░░ 0.18                                   │
│                                                                              │
│      ─→ ⠿ Schmitt      T_high [1.8] T_low [1.4]            [✓] [⊖] [↑] [↓]  │
│         │ pre: ▓░░░ 0.18   post: ● 1.0 (firing)                              │
│                                                                              │
│      ─→ ⠿ Hold         timeout [120] ms                    [✓] [⊖] [↑] [↓]  │
│         │ pre: ● 1.0       post: ▓▓▓░░ 0.66 (decaying)                       │
│                                                                              │
│      ─→ CPC: micKick                                                         │
│                                                                              │
│   [+ ADD OP ▾]                              [RESET CHAIN] [DUPLICATE FROM ▾] │
└──────────────────────────────────────────────────────────────────────────────┘
```

Op-row icons: `⠿` = drag handle (reorder). `[✓]` enable/disable toggle. `[⊖]` remove. `[↑][↓]` move up/down (one-handed alternative to drag). Pre/post mini-meters display the engine's `signalChain` debug WS broadcast (5 Hz; see §WS contract) — the iPad does NOT recompute the chain locally for preview. Every value in this editor is what the engine just sent.

### Wireframe F — "no chain yet" (newly added signal)

```
┌─ STEMS VOCALS — CHAIN ───────────────────────────────────────────────────────┐
│                                                                              │
│   raw ─→ ─── (passthrough — no ops yet) ─── CPC                              │
│                                                                              │
│   [+ ADD OP ▾]                                          [LOAD DEFAULT CHAIN] │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Wireframe G — Chain editor error state (validation rejected by engine)

```
┌─ MIC KICK — CHAIN ───────────────────────────────────────────────────────────┐
│   raw ─→ ⠿ Schmitt   T_high [0.4]  T_low [0.5]    ⚠  T_high must be > T_low │
│                                                                              │
│   Last save failed. Fix highlighted parameter or revert.                     │
│   [REVERT TO LAST SAVED]                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Wireframe H — History trail (single signal close-up)

```
   MIC LOW  ▓▓▓▓▓▓▒░ 73%                              [window: 10 s]
   ┌──────────────────────────────────────────────────────────────┐
1.0│        ╱╲                            ╱╲                       │
   │       ╱  ╲          ╱╲              ╱  ╲                      │
0.5│  ╱╲  ╱    ╲       ╱  ╲           ╱     ╲    ╱╲                │
   │ ╱  ╲╱      ╲    ╱     ╲       ╱         ╲╲╱  ╲                │
0.0│╱            ╲──╱       ╲────╱             ╲   ╲────           │
   └──────────────────────────────────────────────────────────────┘
   -10 s                       -5 s                            now
```

---

## Data shape

### Chain config (persisted)

Lives in `marsin_engine/states/<scene>/audio_state.yaml`, alongside the existing `bands` / `kick` blocks. Each `live`-flagged CPC key the engine recognises (today: `micLow`, `micMid`, `micHigh`, `micKick`, `stemsBass`, `stemsDrums`, `stemsVocals`) gets one entry under `chains`. Absent → engine uses the signal's built-in default chain.

```yaml
chains:
  micKick:
    - id: kick_bandpass
      type: bandpass        # see Operator catalog
      enabled: true
      params: { lowHz: 50, highHz: 110 }
    - id: kick_envelope
      type: envelope
      enabled: true
      params: { attackMs: 8, releaseMs: 180 }
    - id: kick_schmitt
      type: schmitt
      enabled: true
      params: { tHigh: 1.8, tLow: 1.4, refractoryMs: 200 }
    - id: kick_hold
      type: hold
      enabled: true
      params: { timeoutMs: 120, decayMs: 120 }
  stemsBass:
    - id: stems_bass_gain
      type: gain
      enabled: true
      # `paramKey` lets the gain value follow a CPC param (existing
      # `stemsBassGain`), so the iPad's gain slider remains
      # the visible / persisted source-of-truth for the multiplier.
      params: { paramKey: stemsBassGain }
```

**Stems default chain is intentionally just `Gain`** — see the "Stems run local-loopback" note below. `Hold` is in the catalog as an OPTIONAL op the operator can add per-signal (or to a future cross-network OSC source), but it is NOT pre-installed in the default stem chain.

Op `id`s are stable per signal (used for diff-based PATCH and for the iPad's drag-reorder). `enabled: false` means the op is bypassed at runtime; it stays in the chain config so the operator's tuning isn't lost.

### Operator catalog (full)

All ops accept a numeric input in `[0, 1]` and emit in `[0, 1]` UNLESS noted (Schmitt outputs `0` or `1`, Slope can be negative). All work O(1) per sample with ≤ 4 sample-history words.

| Op | Family | Params (defaults) | Math (per sample `x[n]`) | Latency | When to use | Citation |
|---|---|---|---|---|---|---|
| **Gain** | Math | `value: 1.0` OR `paramKey: <cpcKey>` | `y = clamp01(x * value)` | 0 | Per-band level; first op in stems default chain. | TD CHOP Math (multiply mode). |
| **Bias** | Math | `value: 0.0` | `y = clamp01(x + value)` | 0 | Lift a quiet floor up; rarely useful alone. | TD CHOP Math (add mode). |
| **Clamp** | Limit | `min: 0`, `max: 1` | `y = max(min, min(max, x))` | 0 | Re-anchor after a Gain > 1 to avoid Compressor squashing the headroom. | TD CHOP Limit. |
| **Curve** | Lookup | `shape: linear\|easeIn\|easeOut\|exp`, `gamma: 2.0` (exp only) | `y = applyCurve(x, shape)` (table per shape) | 0 | Tame a hot range or punch a quiet one without changing absolute max. | TD CHOP Lookup; matches `modulation_engine.js applyCurve()`. |
| **LPF / Lag** | Filter | `cutoffHz: 5.0` | `α = 1 − exp(−2π fc dt)`; `y = α·x + (1−α)·y_prev` | ~1/fc s rise time | Default smoothing on any signal that feels jittery. | One-pole IIR / leaky integrator; cf. RBJ Audio EQ Cookbook (W3C-Note, 2021) §LPF; identical to EMA. |
| **Slew Limiter** | Limit | `maxStepPerSec: 4.0` | `step = maxStepPerSec * dt`; `y = clamp(x, y_prev − step, y_prev + step)` | bounded by step | Cap on visual flicker rate without smoothing peaks. | TD CHOP Limit (step mode). |
| **Envelope** | Filter | `attackMs: 8`, `releaseMs: 180` | `α_a = 1 − exp(−dt/τ_a)`, `α_r = 1 − exp(−dt/τ_r)`; `α = α_a if x > y_prev else α_r`; `y = α·x + (1−α)·y_prev` | attackMs rise | VU-meter feel; lifted verbatim from `audio_analyzer.js:298-306`. | Standard envelope follower; cf. Pirkle, *Designing Audio Effect Plug-Ins in C++* (2nd ed., 2019, ch. 6). |
| **Schmitt** | Trigger | `tHigh: 0.5`, `tLow: 0.3`, `refractoryMs: 0` | `if y_prev == 0 and x > tHigh and (now − lastFire ≥ refractoryMs): y = 1; elif y_prev == 1 and x < tLow: y = 0; else: y = y_prev` | 0 | Convert a continuous level into a clean trigger (kick, threshold gates). | Schmitt 1938; Horowitz & Hill *Art of Electronics* (3rd ed., 2015, §4.3.2). Hysteresis prevents chatter. |
| **Compressor** | Dynamics | `threshold: 0.5`, `ratio: 4.0`, `attackMs: 5`, `releaseMs: 80` | dB-domain: `over = max(0, 20·log10(x+ε) − thresh_dB)`; `gainReduction_dB = −over · (1 − 1/ratio)`; smoothed by attack/release; `y = clamp01(x · 10^(gr_dB/20))` | attackMs | Tame a saturating room without losing transients (alternative AGC). | Bob Katz, *Mastering Audio* (3rd ed., 2014, ch. 7); RBJ-cookbook smoothing constants. |
| **Biquad LPF** | Filter | `cutoffHz: 8.0`, `Q: 0.707` | RBJ LPF coefficients: `ω₀=2π fc dt; α=sin(ω₀)/(2Q); b0=(1−cos ω₀)/2; b1=1−cos ω₀; b2=(1−cos ω₀)/2; a0=1+α; a1=−2 cos ω₀; a2=1−α`; Direct-Form-1 `y = (b0·x + b1·x_1 + b2·x_2 − a1·y_1 − a2·y_2) / a0` | ~1/fc s | Steep roll-off when 1-pole isn't sharp enough (e.g. removing 60 Hz hum from a stem). | RBJ EQ Cookbook (W3C-Note, 2021) §LPF. |
| **Hold** | Hold | `timeoutMs: 500`, `decayMs: 200` | Sample-and-hold with timeout: track `lastInputAt`. If `now − lastInputAt > timeoutMs`: `y = y_prev · exp(−dt/τ_decay)`. Else `y = max(x, y_prev · exp(−dt/τ_decay))` | bounded | Kick visual hangover; optional belt-and-suspenders for any future cross-network OSC. **Not in the default stem chain** — stems run local loopback (see Stems locality note). | TD CHOP Hold + Speed mash-up. |
| **Slope** | Math | (none) | `y = clamp01((x − x_prev) / dt / scale)` (scale = 4.0/s default; can output negative if `bipolar: true`) | 1 sample | "Trigger on rising bass" — feeds a Schmitt. | TD CHOP Slope. |

**Reduction policy:** these 12 ops cover the operator's stated TouchDesigner reference list (Lag, Filter, Math, Trigger, Logic, Limit, Hold, Constant, Speed, Slope, Schmitt, Hysteresis, Compressor, Expander, Slew Rate Limiter). "Logic" / "Constant" / "Expander" / "Speed" are intentionally omitted as v1 — they're recoverable via combinations (Logic = Schmitt + Gain; Constant = Bias with no input; Expander = inverted Compressor; Speed = inverse Slope). Add them only if an operator brief proves they're needed.

**Performance note:** Biquad is the heaviest op (≈ 5 multiplies + 4 adds + 2 sample words of history per channel); every other op is ≤ 4 FLOPS. A worst-case 10-op chain on `micKick` running at the analyzer's 86 Hz: ~60 FLOPS × 86 = ~5 kFLOPS/s. Negligible.

**Stems locality (loopback, no WiFi).** Per operator: *"The stems will run on the server machine and it communicates the data to the server on the same machine. So there shouldn't be WiFi issues."* The stems source (LX Studio / mixer) runs on the **same physical machine** as the engine; the OSC stream is local UDP loopback (or a Unix socket), not cross-network. UDP loopback effectively never drops packets in practice — the kernel hands the datagram straight from sender to receiver without touching a NIC. This is why the default stem chain is just `Gain` and `Hold` is optional: the "stems packet loss" failure mode the chain was originally designed to protect against doesn't exist in our deployment. If a future scene wires in a cross-network OSC source, the operator can add a `Hold` op to that signal's chain explicitly.

### Chain runtime state (in-engine ONLY — never on the iPad, never persisted)

```
ChainRuntime per (signal, op): {
  yPrev: float,
  yPrev2: float (biquad only),
  xPrev: float, xPrev2: float (biquad only),
  lastInputAt: ms (hold only),
  lastFireAt: ms (schmitt only),
  pre:  float (most-recent pre-op value, for UI preview),
  post: float (most-recent post-op value, for UI preview),
}
```

### REST endpoints (mirror modulation API pattern)

| Method | Path | Body | Purpose |
|---|---|---|---|
| `GET`    | `/audio/chains` | — | Full `chains` map for the current scene. |
| `GET`    | `/audio/chains/:signalKey` | — | One signal's chain array. |
| `PUT`    | `/audio/chains/:signalKey` | `[{id,type,enabled,params},...]` | Replace the entire chain for a signal (atomic). 400 on validation fail; existing chain unchanged. |
| `PATCH`  | `/audio/chains/:signalKey/:opId` | `{enabled?:bool, params?:{...}}` | Partial update of one op. |
| `POST`   | `/audio/chains/:signalKey/reset` | — | Restore signal's default chain. |
| `POST`   | `/audio/chains/reset` | — | Restore ALL signals to defaults. |
| `GET`    | `/audio/chains/catalog` | — | The 12-op catalog (for the iPad's "+ ADD OP" picker). Returns name, family, defaults, param schema. Cached client-side per engine version. |

Validation lives in `lib/signal_post_processor.js` (`validateChain(signalKey, chain)`) — type known, params in range, no duplicate ids, Schmitt `tHigh > tLow`, Compressor `ratio ≥ 1`, etc. Mirrors the strictness of `validateLivePatch` in `audio_config.js`.

### WS contract

Two existing topics + ONE new debug-broadcast type.

| Topic | Type | Cadence | Payload | Notes |
|---|---|---|---|---|
| `/ws/signals` | `liveParams` | ≤ 20 Hz (existing bucket cap) | unchanged | Same wire shape — now carries chain-processed values. Downstream consumers (modulation controller, iPad meters) need no change. |
| `/ws/signals` | `signalChain` | **5 Hz, AUDIO tab only** | `{ type:'signalChain', signalKey, ops:[{id, pre, post, firing?:bool}] }` | Pre/post preview for the chain editor. Engine only emits when at least one client has sent a `subscribeChains` upstream message; emission stops when no client is subscribed. **Critical for "cheap when off."** |
| `/ws/control` | `audioChainsChanged` | on PATCH / PUT / reset success | `{ type:'audioChainsChanged', chains }` | iPad reconciles its local cache without re-fetching. |

The `signalChain` subscription handshake:

```
client → engine (over /ws/control):  { type:'subscribeChains' }
client → engine (on AUDIO tab blur):  { type:'unsubscribeChains' }
```

If no client is subscribed, the engine pays zero cost for the preview broadcast — chain ops still run (they have to: every downstream consumer wants the processed value), but the pre/post fields are not written and no WS message is emitted.

### Engine integration point

```js
// in lib/signal_post_processor.js
export class SignalPostProcessor {
  constructor({ scenePath, paramCenter, broadcast });
  loadChains(yamlChainsBlock);                    // merges into runtime
  putChain(signalKey, ops);                       // returns {ok, error}
  patchOp(signalKey, opId, partial);              // ditto
  resetSignal(signalKey);
  process(signalKey, rawValue, dtSeconds);        // returns processed value
  snapshotForEditor(signalKey);                   // pre/post per op
  setEditorSubscribed(bool);                      // gates the 5 Hz broadcast
}
```

**Call sites:**

1. `engine.js` audio bootstrap — the `onAnalysis` callback wraps each raw band value through `signalPostProcessor.process('micLow'|'micMid'|'micHigh'|'micKick', rawValue, dt)` before calling `paramCenter.setMany(...)`. Replaces the current direct write.
2. `lib/osc_listener.js:486` — the `paramCenter.setMany(writes, 'osc', origin)` becomes `paramCenter.setMany(writes.map(w => ({...w, value: signalPostProcessor.process(w.key, w.value, dt)})), 'osc', origin)` for keys present in the chain map.
3. New 5 Hz interval in `engine.js` that calls `signalPostProcessor.snapshotForEditor` for every signal and emits `signalChain` if `setEditorSubscribed(true)`.

`broadcast` flowing through the existing `broadcastWs` keeps the WS-topic-routing rules (`signalChain` belongs to `TOPICS.SIGNALS`, same as `liveParams`).

---

## Interactions

1. Operator opens AUDIO tab → screen mounts → `useFocusEffect` sends `subscribeChains` upstream → engine starts emitting 5 Hz preview frames → operator sees pre/post values updating per op.
2. Operator taps `[edit ▼]` on MIC KICK row → the chain editor expands inline (Wireframe E). Latency target: `<100 ms` to first paint of op rows (data already in the iPad's `signalChain` cache; no network).
3. Operator drags an op handle to reorder → optimistic local reorder → `PUT /audio/chains/micKick` with the new array → engine validates + atomic-applies + broadcasts `audioChainsChanged` → on failure, iPad reverts and shows Wireframe G's error.
4. Operator edits one param (e.g. Schmitt `tHigh: 1.8 → 2.0`) on slider release → `PATCH /audio/chains/micKick/kick_schmitt` with `{params:{tHigh:2.0}}` → optimistic UI update + on rejection revert and show error.
5. Operator taps a window picker `[10s]` → updates a single shared `historyWindowMs` local state (no network); polylines re-render with the iPad-side ring buffer of `liveParams` values already received (no recomputation — the buffer is a memory of engine values, see "Processing locality" §). Latency: 1 frame.
6. Operator switches tabs → `useFocusEffect` sends `unsubscribeChains`; engine pauses the 5 Hz preview emission; ring buffers zero. CPC chain processing keeps running (downstream consumers still need processed values).
7. Operator hits `Reset to defaults` (in SETTINGS card) → `POST /audio/chains/reset` + existing `POST /audio/config/reset` → engine restores both analyzer tuning AND every signal's default chain.
8. WS disconnect → trails freeze at last value (Wireframe D) → engine bus reconnects → on `audioChainsChanged` resync (engine emits one of these immediately after any client reconnects to `/ws/control` so the iPad picks up changes that happened during disconnect).

---

## Edges

- **Empty state** (no chain defined for a signal): Wireframe F. `LOAD DEFAULT CHAIN` button pulls from the engine's compiled-in defaults (`signal_post_processor.js DEFAULT_CHAINS`), not from the scene file.
- **Loading state** (chains config in-flight): pinned meters render with raw values; chain editor row shows `… loading chain`.
- **Error state** (REST PATCH rejected): Wireframe G. The op's param is highlighted, the error message displayed inline, no value flows to CPC for that op (the engine's `validateChain` runs before any runtime state mutation, so the previous good chain stays in effect).
- **Saturated state** (a Schmitt firing constantly): the kick indicator in PINNED shows `●` solid; the operator's prompt to raise `tHigh`. No automatic action — explicit operator response.
- **Disconnected state** (WS down): Wireframe D. Trails freeze; chain editor is read-only (greyed-out controls). On reconnect, full re-sync via `audioChainsChanged`.
- **Conflict state** (two writers — operator + OSC editing the same `paramKey` for a Gain op): wins-last via the existing CPC source-lock semantics. No new arbitration logic; the chain's Gain op reads the CPC value live, not snapshot.
- **"No signal" state** (audio enabled but `micLow == 0` for >5 s): trail line goes flat at 0; meter shows `▒░░░░ 0%`. No special UI — operator's cue to check mic gain at the OS level.
- **"Stems offline" state** (OSC listener `state: 'off'`): Wireframe C right side. STEMS rows in pinned card go grey + show "⚠ OSC OFF"; the chain editor for stem signals stays editable (so the operator can pre-configure before LX comes online).

---

## What it deliberately is not

- **Not a pattern-language change.** The WASM patterns still call `paramCenter.get('micLow')` and get the same shape of value as today. The chain is transparent to the WASM layer.
- **Not per-pattern / per-playlist chains.** Modulation (per `docs/26`) already does per-playlist parameter shaping via `range[]` + `curve` + `mode`. The chain is per-RIG (one Titanic, one set of physics).
- **Not a full DSP graph.** Chains are linear (one input → one output), not branching. If two patterns need two different shapes of `micLow`, the operator either (a) picks the most-common shape and lets modulation `range[]` handle the per-pattern fine-tune, or (b) we add a second CPC key (`micLowFast` / `micLowSlow`) — that's a future design.
- **Not auto-tuning / ML.** The catalog is hand-curated DSP. No "learn the optimal chain from listening to the music" magic.
- **Not a replacement for the existing `audio_analyzer.js` band-energy / kick logic.** The analyzer still does FFT + raw band energy + envelope + gate + raw kick detection. The chain runs AFTER on each emitted `{low, mid, high, kick}`.
- **Not a wire-protocol redesign.** `liveParams` shape stays identical; chain processing changes the VALUE, not the envelope.

---

## Open questions for the operator

1. **Op catalog size for v1.** Ship all 12 ops or start with 6 (Gain, Bias, Clamp, LPF, Envelope, Schmitt) and add the rest on demand? Recommendation: 6 in v1 + Hold + Compressor in v1.1 since they directly address Concern 5/6 issues; Biquad + Slew + Slope + Curve in v2.
2. ~~**Default-chain shape for STEMS.**~~ **Resolved by operator (2026-05-26):** stems run on the same machine as the engine (local loopback OSC), so the packet-loss failure mode `Hold` was meant to mask doesn't exist. Default stem chain is **just `Gain`**. `Hold` stays in the catalog as an optional op for any cross-network OSC the operator wires up later.
3. **Chain config persistence model.** This doc puts chains in `audio_state.yaml` (per-scene). Alternative: per-engine in `config.yaml` (one chain set across all scenes on this machine). Per-scene is the recommendation since the operator can hand-craft chains for `test_bench` vs. the live show scene, but it does mean a new rig requires re-tuning chains.
4. **Kick-EMA-drift fix scope.** The Concern 5 BLOCKER fix needs to land BEFORE the chain framework if we want it on the playa. Should it ship as a small surgical patch to `audio_analyzer.js` (recommendation) or wait for the chain framework so the whole kick detection moves into a chain? The first is hours; the second is days.

---

## Recommended implementation path

1. **Phase 1 — kick-EMA-drift fix.** `04.2_marsin_engine_expert.md` patches `audio_analyzer.js:312-322` for asymmetric EMA + optional ceiling. Adds a new test case (sustained loud bass, asserts kicks continue past 30 s). Ships standalone. **Before playa.**
2. **Phase 2 — engine-side `signal_post_processor.js`.** `04.2_marsin_engine_expert.md` lands the module with 6 v1 ops (Gain, Bias, Clamp, LPF, Envelope, Schmitt) + Hold (catalog-available, NOT default-installed on stems). Adds REST endpoints + `audioChainsChanged` broadcast. Default chains: mic signals get their respective defaults (Wireframe A); **stem signals get a single `Gain` op** (loopback OSC, no need for `Hold`). Engine wires the call sites in `engine.js` audio bootstrap + `osc_listener.js`. Tests cover each op's math against canned input vectors. No iPad changes yet — chains are configured via REST.
3. **Phase 3 — pinned meters strip (no trails).** `04.1_captain_pad_expert.md` lifts the existing `BandMeter` rows into a fixed-height `<View>` above the ScrollView in `audio.tsx`. Empty/error states wired. Ships independently of the chain editor — pure UX win.
4. **Phase 4 — history trails.** `04.1_captain_pad_expert.md` adds the per-signal `react-native-svg` polyline with `useFocusEffect`-gated ring buffer + window picker. Adds a one-line `<Polyline>` per row in the pinned strip.
5. **Phase 5 — chain editor UI.** `04.1_captain_pad_expert.md` adds the chains-list section + per-signal expand panel + drag-to-reorder. Subscribes to `signalChain` debug WS frames for pre/post preview. Replaces the existing per-band-gain `GainRow` and the analyzer `bands` / `kick` `FaderRow` sub-cards with chain ops (Gain → first op of chain; bandpass/envelope/schmitt → kick chain ops).
6. **Phase 6 — SETTINGS collapse.** `04.1_captain_pad_expert.md` moves mic picker, BPM→speed sync, FFT size, and reset into a single bottom disclosure. Keeps the page short.
7. **Phase 7 — extra ops.** `04.2_marsin_engine_expert.md` adds Compressor + Biquad + Slew + Slope + Curve, gated on operator demand.

Phases 1 + 2 + 3 are independent; can ship in any order. Phases 4 + 5 + 6 require Phase 3 to land first. Phase 7 is optional. The planner (`02_planner.md`) should slice phase boundaries to operator-acceptable PR sizes.
