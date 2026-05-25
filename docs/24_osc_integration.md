# 24 — OSC Integration for MarsinEngine

## 1. Overview

This document defines how MarsinEngine receives OSC (Open Sound Control)
messages from external sources — audio analysers, TouchOSC controllers,
Resolume / Touchdesigner rigs, QLab, Ableton, etc. — and how those
messages drive global parameters in the
[Central Parameter Center (CPC)](./15_central_param_center_cpc.md).

The integration is intentionally minimal in v1:

- **One UDP listener** on a configurable port.
- **One config section** (`osc:` in `marsin_engine/config.yaml`).
- **One mapping model**: each OSC address resolves to one or more
  **binding entries**, where every entry is `{ cpcKey, argIndex }`.
  The shorthand `"/addr": "key"` is sugar for a single binding entry
  at `argIndex: 0`; multi-arg packets (XY pads, stereo
  level/strength, etc.) use the explicit list form.
- **One audio param** to start (`audioLevel`), with a registry shape
  that makes adding `audioBass`, `audioBpm`, beat clusters, etc. a
  one-line change.

OSC is implemented as a **source adapter** into the existing CPC —
identical in role to the HTTP `/param-center` endpoint and the WS
`setSharedParam` message ([CPC §9](./15_central_param_center_cpc.md#9-osc-adapter)).
Every OSC write goes through `paramCenter.set(key, value, 'osc',
origin)` and inherits validation, clamping, dirty-flag injection into
the WASM VM, source arbitration, and (subject to per-key policy —
see [§7.4](#74-live-param-policy)) persistence and the canonical
broadcast to all clients. The listener itself holds no parameter
state.

### 1.1 Scope (in / out)

| In scope (v1)                                                                       | Out of scope (v1)                                                     |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| UDP OSC listener on configurable port                                               | TCP / WebSocket OSC transport                                         |
| Canonical addresses for every CPC global param                                      | Per-pattern (local) export control via OSC — see [§15](#15-future-extensions) |
| User-defined address aliases via `config.yaml` (shorthand + object form for XY)     | CaptainPad UI to edit OSC bindings live — see [§11.2](#112-future-bindings-editor-in-captainpad-v2) |
| Audio Master level fed in over OSC, with **per-param "live" policy** (see [§7.4](#74-live-param-policy)) | (was: In-engine audio capture — now shipped, see [§15.3](#153-in-engine-audio-capture--shipped)) |
| **Named-sender allowlist** so writes carry `origin: 'osc:<name>'` (see [§3.4](#34-named-senders--allowlist)) | OSC reply / round-trip (motorised faders, controller LEDs)            |
| Split-counter status broadcast so CaptainPad sees rx / mapped / dropped / invalid   | Per-address scaling / response curves                                 |
| Reuse of existing CPC source-lock as `'osc'` (single label for every OSC writer)    | Acting as a sACN / DMX priority source — see [§2.5](#25-relation-to-bm26-titanic-routing) |
| IPv4 / IPv6 normalization for `allowedSenders` (loopback variants treated equal)    | Per-named-sender source-lock leases — see [§9.1](#91-named-senders--lock-semantics) |

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                       MarsinEngine (port 6968)                        │
│                                                                       │
│  ┌────────────────┐                                                   │
│  │  OscListener   │  UDP                                              │
│  │  (port 6970)   │ ◀──────── External OSC senders                    │
│  │                │           • Audio analyser (stems, BPM, beats)    │
│  │  - parse addr  │           • TouchOSC iPad / iPhone                │
│  │  - lookup map  │           • Resolume / Touchdesigner / QLab       │
│  │  - call CPC    │                                                   │
│  └───────┬────────┘                                                   │
│          │ paramCenter.set(key, value, 'osc', origin)                 │
│          ▼                                                            │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  Central Parameter Center (param_center.js)                    │   │
│  │   1. Source-lock check                                         │   │
│  │   2. Clamp / coerce per registry entry                         │   │
│  │   3. Update canonical store + revision++ + dirty flag          │   │
│  │   4. Fire onChange({ changedKeys, state })  ── single hook ──┐ │   │
│  └─────────────┬───────────────────────────────────────┬────────┘ │   │
│                │ flushDirty() each frame               │          │   │
│                ▼                                       ▼          ▼   │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌───────────────┐ │
│  │  WASM VM (mixer)     │  │  WS clients         │  │ Disk persist  │ │
│  │  - shared* fns       │  │  throttled per-key  │  │ ONLY if any   │ │
│  │  - patterns react    │  │  by broadcastHz     │  │ changed key   │ │
│  │  every dirty frame   │  │  (§7.2, §7.4)       │  │ is persistent │ │
│  └──────────────────────┘  └─────────────────────┘  └───────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Notes on placement:

- The OscListener is owned by `engine.js` alongside `paramCenter`,
  `mixer`, `wasmHost`, and the API server. It is **not** part of
  `api_server.js` because it speaks UDP, not HTTP/WS, and has its own
  lifecycle (port bind, packet decode loop, shutdown).
- The listener does **no** broadcasting itself. Broadcast happens
  through the CPC's `onChange` fan-out path (see [§7.2](#72-broadcast-on-cpc-mutation)).
  The listener publishes one extra signal — `oscStats` — for
  CaptainPad's liveness indicator (see [§10](#10-status--telemetry)).
- The listener is the **last** subsystem to bind in `engine.js`
  (see [§12.1](#121-boot-order-in-enginejs)). Until WasmHost, mixer,
  ParamCenter, `onChange`, and the API/WS server are all live, the
  UDP socket is not open — so the first packet that arrives never
  races a half-built engine.

### 2.5 Relation to BM26 Titanic Routing

OSC is a **control-input** protocol for MarsinEngine, not a DMX /
sACN routing-priority source. The flow is:

```
External OSC sender
  → OscListener
  → CPC shared parameter (lastSource: 'osc', lastOrigin: 'osc:<name>')
  → MarsinEngine pattern / mixer output
  → sACN / DMX output (one upstream source among many)
  → BM26 router / fixture patch
```

The BM26 sACN router still arbitrates between lighting sources such
as LX Chromatik, Canopy, MarsinEngine, Pixelblaze-derived sources,
and manual / off modes. **OSC only changes what MarsinEngine
produces.** It never bypasses router priority, fixture patching,
source lockout, IntensityController / GlobalEffectsController
overrides, or any safety / operator control further downstream.

That distinction also means:

- `source: 'osc'` (a CPC arbitration label — see
  [CPC §7](./15_central_param_center_cpc.md#7-source-arbitration))
  is **not** the same concept as sACN source priority. Locking the
  CPC to `osc` only stops other writers from mutating MarsinEngine's
  shared params; it does not raise MarsinEngine's priority in the
  sACN router.
- Blackout, dimmers, and global effects on the engine
  (`IntensityController`, `GlobalEffectsController`,
  [marsin engine doc §7a.2](./12_marsin_engine.md#7a2-the-broadcast-contract))
  continue to apply post-render. An OSC-driven param spike cannot
  override an active operator blackout.

---

## 3. Configuration

All OSC config lives under a new `osc:` section in
`marsin_engine/config.yaml`. Reusing the file every other subsystem
already loads keeps deployment trivial — no extra files, no env vars.

### 3.1 Schema

```yaml
osc:
  enabled: true
  port: 6970
  host: 0.0.0.0          # interface to bind; 0.0.0.0 = listen on all

  # Named-sender allowlist. When non-empty, only packets whose source
  # IP appears below are accepted; everything else is dropped at the
  # socket and counted in `droppedMessagesPerSec`. See §3.4.
  allowedSenders:
    - name: touchosc-ipad
      ip: 10.0.0.42
    - name: td-audio
      ip: 10.0.0.55

  bindings:
    # OSC address ──────────────► CPC param key
    #
    # The canonical addresses (/marsin/param/<key> for scalars,
    # /marsin/param/<key>/{h,s,v} for HSV, /marsin/audio/<key> for
    # audio) are ALWAYS bound automatically from the registry.
    # The map below ADDS user aliases on top — it never replaces or
    # disables the canonical addresses.

    # Shorthand: one address → one CPC scalar, takes the first OSC arg.
    /touchosc/1/fader1: speed
    /touchosc/1/fader2: count
    /resolume/audio/master: audioLevel
    /ableton/master/level: audioLevel

    # Object form: one address routes its args to multiple CPC params.
    # Required for XY pads and any other multi-arg control surface.
    /touchosc/1/xy1:
      - { key: rotate, arg: 0 }
      - { key: size,   arg: 1 }
```

### 3.2 Defaults when fields are omitted

| Field            | Default     | Behaviour                                                                                                              |
| ---------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `enabled`        | `false`     | Section absent or `enabled: false` → no listener, no port bind, zero overhead.                                         |
| `port`           | `6970`      | Sits next to engine (6968) and sACN bridge (6971). Documented in [§9.4 of CPC doc](./15_central_param_center_cpc.md#94-config). |
| `host`           | `0.0.0.0`   | Bind to all interfaces. Set to `127.0.0.1` to restrict to loopback for safety.                                         |
| `allowedSenders` | `[]` (open) | Empty list ⇒ **any** sender accepted (tagged `source: 'osc', origin: 'osc:<ip>:<port>'`). Non-empty ⇒ strict allowlist. |
| `bindings`       | `{}`        | Empty map. Canonical addresses still work; nothing custom.                                                             |

### 3.3 Binding precedence and conflicts

- Canonical addresses are registered first, from
  `paramCenter.getSchema()`.
- Custom bindings are registered next, in two forms:
  - **Shorthand** (`/address: cpcKey`) — one CPC scalar param, takes
    `args[0]`.
  - **Object form** (`/address: [ { key, arg }, ... ]`) — one or
    more CPC params, each pulling its own `args[arg]` index from the
    same packet. Required for XY pads (`/touchosc/1/xy1` sends two
    floats in one packet) and for any layout that packs multiple
    controls into one OSC address.
- **A custom binding to a canonical address is a startup error** — we
  refuse to overload `/marsin/param/speed` with a different key.
- **Two custom bindings to the same OSC address** (different CPC
  keys) is also a startup error. One address means one binding
  (which may itself fan to multiple CPC keys via the object form).
- The **reverse** is fine: many addresses → one CPC key (e.g. both
  `/touchosc/1/fader1` and `/marsin/param/speed` write `speed`). This
  is what makes per-controller layouts and the canonical surface
  coexist.

> [!IMPORTANT]
> **All bad bindings consistently fail at startup.** Per the project
> codex's "no fallback behaviors" rule, any of the following disables
> the listener at boot (engine itself boots normally — only OSC is
> off):
>
> - malformed `osc.bindings` entry (value not a string and not a
>   valid object-form list);
> - binding references an unknown CPC registry key;
> - binding targets a CPC type incompatible with its shape (e.g.
>   shorthand pointing at an HSV key — HSV must use canonical
>   sub-addresses);
> - binding object-form `arg` index out of range for the registry
>   key's expected arity;
> - binding overloads a canonical address;
> - two bindings collide on the same OSC address.
>
> Runtime *unmapped incoming addresses* (no binding at all) are still
> silently dropped — they're noise, not configuration.

### 3.4 Named senders & allowlist

When `allowedSenders` is empty, the listener accepts traffic from any
host — useful for solo development on a laptop. As soon as one entry
is present, the listener treats the list as a strict allowlist:

- packets from any other source IP are dropped at the socket
  (counted in `droppedMessagesPerSec` — see [§10.1](#101-broadcast-shape));
- accepted packets are tagged with the friendly name as origin
  (`origin: "osc:touchosc-ipad"`) so logs, `lastOrigin` on CPC params,
  and CaptainPad displays read meaningfully;
- the source-lock policy targets the bare `osc` source for "any OSC
  writer wins" (see [§9](#9-source-arbitration)). **The friendly
  name appears only on `lastOrigin`, never on `lastSource`** — there
  is no per-name source-lock in v1.

This closes the playa-network exposure issue: a stray laptop on the
show Wi-Fi can no longer mutate shared params just because it can
reach UDP 6970.

#### IP normalization

Both the configured `ip` values and the `rinfo.address` reported by
the Node UDP socket are normalized before lookup. Node may report
loopback as `127.0.0.1`, `::1`, or as an IPv4-mapped IPv6 address
`::ffff:127.0.0.1` depending on socket family, OS, and the sender's
own binding. The listener treats all three as equivalent — config
written for `127.0.0.1` matches a sender that arrives as
`::ffff:127.0.0.1`, and config written for `::1` matches a sender
that arrives as `127.0.0.1`.

Concretely:

- `::ffff:0:0/96` IPv4-mapped addresses are stripped to their
  embedded IPv4 form.
- `127.0.0.1` ⇔ `::1` are treated as the same logical host.
- Other addresses are compared case-insensitively as plain strings
  (no DNS resolution — only literal IPs are valid in `allowedSenders`).

This rule applies at both startup validation and runtime dispatch.
Allowlist tests explicitly exercise the loopback variants
([§14.2](#142-unit-tests)).

---

## 4. Canonical Address Space

These addresses are auto-bound from the CPC registry the moment the
listener starts. They are stable contracts — patterns, templates, and
external tools can rely on them indefinitely.

### 4.1 Global parameter scalars

| OSC address               | CPC key      | Args         | Range    | Notes                          |
| ------------------------- | ------------ | ------------ | -------- | ------------------------------ |
| `/marsin/param/speed`     | `speed`      | `[float]`    | `[0, 1]` | Clamped by CPC registry        |
| `/marsin/param/direction` | `direction`  | `[float]`    | `[0, 1]` | Snapped to `{0, 0.5, 1.0}`     |
| `/marsin/param/count`     | `count`      | `[float]`    | `[0, 1]` |                                |
| `/marsin/param/size`      | `size`       | `[float]`    | `[0, 1]` |                                |
| `/marsin/param/rotate`    | `rotate`     | `[float]`    | `[0, 1]` |                                |

### 4.2 Global parameter colors (HSV sub-addresses)

Each HSV-typed CPC param exposes three independent sub-addresses, one
per component. This matches stock TouchOSC layouts where every fader
sends its own message, and keeps the wire format trivially one-float-
per-packet.

| OSC address                            | CPC key         | Field | Args      | Range    |
| -------------------------------------- | --------------- | ----- | --------- | -------- |
| `/marsin/param/colorPalette1/h`        | `colorPalette1` | `h`   | `[float]` | `[0, 1]` |
| `/marsin/param/colorPalette1/s`        | `colorPalette1` | `s`   | `[float]` | `[0, 1]` |
| `/marsin/param/colorPalette1/v`        | `colorPalette1` | `v`   | `[float]` | `[0, 1]` |
| `/marsin/param/colorPalette2/h`        | `colorPalette2` | `h`   | `[float]` | `[0, 1]` |
| `/marsin/param/colorPalette2/s`        | `colorPalette2` | `s`   | `[float]` | `[0, 1]` |
| `/marsin/param/colorPalette2/v`        | `colorPalette2` | `v`   | `[float]` | `[0, 1]` |

**Atomicity:** a single sub-address write mutates one component and
leaves the other two at their current canonical value. The CPC handles
the read-modify-write atomically (see [§7](#7-cpc-integration)).

### 4.3 Audio parameters (v1)

Two distinct roles ship in v1:

- `audioReactivity` is an **operator-tuned gain** — persistent, default
  broadcast rate, visible on LoRa. Lives in the CPC registry but is
  driven primarily from the CaptainPad slider, not from OSC.
- `stemsVocals` is a **live OSC signal** from the external analyser
  — high-rate, throttled, ephemeral, hidden from LoRa.

Patterns typically combine the two as `out *= audioReactivity * stemsVocals`
so the operator can scale the influence of the live signal without
touching the analyser pipeline.

| OSC address                       | CPC key            | Args      | Range          | `live` | `broadcastHz` | `persist` | `portWatch` |
| --------------------------------- | ------------------ | --------- | -------------- | ------ | ------------- | --------- | ----------- |
| `/marsin/param/audioReactivity`   | `audioReactivity`  | `[float]` | `[0, 1]`       | false  | 30 (default)  | true      | true        |
| `/marsin/param/stemsVocalsGain`   | `stemsVocalsGain`  | `[float]` | `[0, gainMax]` | false  | 30 (default)  | true      | true        |
| `/marsin/param/stemsBassGain`     | `stemsBassGain`    | `[float]` | `[0, gainMax]` | false  | 30 (default)  | true      | true        |
| `/marsin/param/stemsDrumsGain`    | `stemsDrumsGain`   | `[float]` | `[0, gainMax]` | false  | 30 (default)  | true      | true        |
| `/marsin/stems/vocals`            | `stemsVocals`      | `[float]` | `[0, 1]`       | true   | 15            | false     | false       |
| `/marsin/stems/bass`              | `stemsBass`        | `[float]` | `[0, 1]`       | true   | 15            | false     | false       |
| `/marsin/stems/drums`             | `stemsDrums`       | `[float]` | `[0, 1]`       | true   | 15            | false     | false       |
| `/lx/tempo/bpm`                   | `tempoBpm`         | `[float]` | `[0, 300]`     | true   | 5             | false     | false       |

`gainMax` is set per deployment in `marsin_engine/config.yaml` under
`osc.gainMax` (default `2.0`). It is applied at boot through
`ParamCenter`'s `registryOverrides` and reshapes the per-stem gain
range — anything above 1.0 lets a stem push past its raw 0..1 input
for a more aggressive reaction; below 1.0 caps how loud a stem can
ever drive the patterns.

Pattern convention:

```js
// effective = audioReactivity * stemsXGain * stemsX
out *= audioReactivity * stemsVocalsGain * stemsVocals;
```

> **Naming note** (May 2026): the placeholder `audioLevel` from earlier
> drafts was split into the keys above when CaptainPad gained dedicated
> UI. References below to `audioLevel` describe the live-param policy
> that now applies to `stemsVocals` / `stemsBass` / `stemsDrums`.

> **Mic-derived siblings** (May 2026): the in-engine microphone
> listener (`docs/25_marsin_audio_analysis.md`) writes four more
> live-param CPC keys — `micLow`, `micMid`, `micHigh`, `micKick` — and
> four matching persistent gain knobs (`micLowGain`, `micMidGain`,
> `micHighGain`, `micKickGain`). They follow the same live-param
> policy and the same `out *= audioReactivity * micXGain * micX`
> pattern convention, so they slot into existing reactive patterns
> with zero OSC wiring. OSC senders may still drive `mic*` directly
> via the canonical addresses (`/marsin/mic/{low,mid,high,kick}` and
> `/marsin/param/mic*Gain`); the in-engine analyzer just happens to
> be the default writer when a mic is configured.

Audio params use the **live-param policy** ([§7.4](#74-live-param-policy)),
which is set in the CPC registry via three new fields:

- `live: true` — value is high-rate, ephemeral, never persisted.
- `broadcastHz: <n>` — server-side throttle on `sharedParams`
  broadcasts for this key. Render-loop injection still runs on every
  dirty frame (so patterns react in real time); only WS fan-out is
  rate-limited.
- `portWatch: false` — the param is excluded from PortWatch's
  `compact_status` PUB so a 60 Hz audio stream doesn't saturate the
  LoRa link.

Non-live params keep their previous semantics: persisted (if
`persist: true`), broadcast on every change, included in compact
status. The defaults for any registry entry are
`live: false, broadcastHz: 30, persist: true, portWatch: true`,
so existing entries (`speed`, `colorPalette1`, etc.) are unchanged.

The full list of audio params is intended to grow without code changes
outside the registry. See [§5.2](#52-extending-the-audio-surface).

---

## 5. Audio Reactivity

### 5.1 Model

We do **not** capture audio inside MarsinEngine. An external audio
analyser (a laptop running a browser Web Audio analyser, a
Touchdesigner network, a Sonic Pi script, or hardware like a Pixelblaze
sensor board with a forwarder) computes the analysis and pushes the
results over OSC. The engine is a pure receiver.

This keeps three things simple:

1. **Zero mic permissions.** No platform dialog on macOS / Linux, no
   service account drama on the Raspberry Pi.
2. **Zero audio dependencies.** The engine's `package.json` does not
   need `node-microphone`, `web-audio-api`, `fft.js`, or friends.
3. **Pluggable.** Swap the analyser without touching the engine: any
   tool that speaks OSC at the agreed addresses is a drop-in.

### 5.2 Extending the audio surface

#### 5.2.1 Continuous bands (the easy case)

For continuous 0..1 scalars (`audioBass`, `audioMid`,
`audioTreble`) and slow scalar signals like `audioBpm` (range
`[0, 300]`), adding one is a single registry edit:

```js
// in PARAM_REGISTRY, alongside audioLevel:
{
  key: 'audioBass',  label: 'Audio Bass', type: 'float',
  default: 0.0, range: [0, 1], clamp: true,
  persist: false, live: true, broadcastHz: 15, portWatch: false,
  oscAddress: '/marsin/audio/bass', sharedFnName: 'audioBass',
},
{
  key: 'audioMid',   label: 'Audio Mid',  type: 'float',
  default: 0.0, range: [0, 1], clamp: true,
  persist: false, live: true, broadcastHz: 15, portWatch: false,
  oscAddress: '/marsin/audio/mid',  sharedFnName: 'audioMid',
},
{
  key: 'audioTreble', label: 'Audio Treble', type: 'float',
  default: 0.0, range: [0, 1], clamp: true,
  persist: false, live: true, broadcastHz: 15, portWatch: false,
  oscAddress: '/marsin/audio/treble', sharedFnName: 'audioTreble',
},
{
  key: 'audioBpm',   label: 'Audio BPM',  type: 'float',
  default: 0.0, range: [0, 300], clamp: true,
  persist: false, live: true, broadcastHz: 2,  portWatch: true,
  oscAddress: '/marsin/audio/bpm', sharedFnName: 'audioBpm',
},
```

`audioBpm` is broadcast more slowly (2 Hz) and *is* sent to
PortWatch's compact status — BPM is a stable, low-rate value an
operator wants to see on the LoRa side, unlike level / band /
spectrum data.

Once registered, the canonical OSC address is auto-bound, the schema
endpoint `/param-center/schema` exposes it to CaptainPad, the
throttled `sharedParams` broadcast carries it, and patterns can opt
in. No listener, API server, or CaptainPad code needs to change.

#### 5.2.2 Beats are events, not values

> [!CAUTION]
> A beat is fundamentally an **event**, not a continuous value.
> Modelling it as `audioBeat = 1.0` for a few ms is fragile: at our
> 40 fps render rate (~25 ms per frame), a flushDirty cycle can fall
> between the pulse rise and fall and the pattern misses the beat
> entirely. Worse, the throttled broadcast can drop the rising edge
> on its way to CaptainPad / PortWatch.

For v1.x or v2 we'll add beat as a three-field cluster instead:

| Key                  | Type    | Semantics                                                                                |
| -------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `audioBeatCount`     | int     | Monotonically increasing counter — each new kick increments it by 1.                     |
| `audioBeatPhase`     | float   | 0..1 phase within the current beat (cycles back to 0 on every detected kick).            |
| `audioBeatStrength`  | float   | 0..1 strength of the most recent kick. Persists between beats; updated on the rising edge. |

Patterns then react deterministically by **edge-detecting the
counter** (`if (audioBeatCount !== lastSeenCount) { … }`), which
survives lost packets, late frames, and broadcast throttling.
Continuous interpolation between beats uses `audioBeatPhase`. This
also lines up cleanly with the future Time Sync / Swarm Render
direction.

v1 does not ship the beat cluster — `audioLevel` only. The contract
above is documented now so we don't accidentally bake in a
single-float `audioBeat` shape that we'll have to migrate away from.

### 5.3 Pattern opt-in

Patterns react to audio the same way they react to any other shared
param ([CPC §13](./15_central_param_center_cpc.md#13-pattern-opt-in-example)).
The CPC's convention is a bare-name exported function — the pattern
gives its own internal variable a distinct name to avoid the
`var name` / `function name(v)` collision.

```js
// inside any pattern that wants to pulse to audio:

var masterAudio = 0.0;
export function audioLevel(v) { masterAudio = v; }

export function render(index, x, y, z) {
  // pulse brightness with master audio
  var b = 0.2 + 0.8 * masterAudio;
  hsv(0.1, 1.0, b);
}
```

`audioLevel` is the **exclusive writer** for `masterAudio`. Per the
exclusive-variable rule ([CPC §3.2](./15_central_param_center_cpc.md#32-solution-exclusive-variable-ownership--dirty-flag-injection))
the pattern must not also expose a `sliderAudioLevel` or any other
callback that writes `masterAudio`. The CPC's `rebuildControlMap`
heuristic logs a warning and blocks conflicting controls at the
`/control` boundary if you try.

### 5.4 Reference senders for v1

We do not ship an analyser, but the README documents a couple of
known-good options. Plain browser pages **cannot** send UDP (no DOM
API for it), so the entry-level path needs either a tiny standalone
process or a real audio tool:

| Sender                                              | Setup cost                                                  | Notes                                                                |
| --------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| **TouchDesigner** `Audio Analysis` + `OSC Out` CHOPs | One TouchDesigner license, a 5-min patch.                  | Best operator UX, runs on the show laptop next to MarsinEngine.      |
| **Python sender** with `python-osc` + `sounddevice`  | `pip install python-osc sounddevice numpy` on the laptop.   | ~40-line script; great for repeatable dev / CI.                      |
| **Node sender** with `node-osc` + `mic`              | Two npm deps; runs alongside the engine if you really must. | Stays inside the engine's stack. Avoids if the engine itself runs headless on the Pi. |
| **Max / MSP, Ableton Live, QLab, Resolume**          | Pre-existing show stack.                                    | Whatever the show is already using for audio; pipe analysis over OSC. |

The contract is exactly "any UDP source that addresses our canonical
paths at the configured `port`"; nothing in the engine cares which
tool produced the packet. A reference Python script
(`marsin_engine/tests/osc_audio_sender.py`) ships in the repo so
operators have a known-good way to smoke-test audio without
TouchDesigner installed.

---

## 6. The OSC Listener

### 6.1 File layout

| File                                         | Role                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `marsin_engine/lib/osc_listener.js`          | New. UDP socket, packet decoder, binding map, per-message dispatcher.      |
| `marsin_engine/lib/param_center.js`          | One small addition — `setHsvField(key, field, value, source, origin)`.    |
| `marsin_engine/engine.js`                    | Wires the listener in after `paramCenter`; handles shutdown.               |
| `marsin_engine/lib/api_server.js`            | Adds `oscStats` broadcast (and a future `/osc` REST surface — see §11.2). |
| `marsin_engine/config.yaml`                  | New `osc:` block (see §3).                                                 |
| `marsin_engine/package.json`                 | One new dep: an OSC decoder (see §6.2).                                    |

### 6.2 Dependency

We need a UDP-based OSC decoder. The two viable Node packages are
`osc` (Adrian Freed; supports UDP + WS + serial, well-maintained) and
`node-osc` (smaller, UDP-only). v1 picks the smaller one unless a
maintenance check at implementation time surfaces a concern. The
listener wraps the decoder so swapping it later is a single-file
change.

### 6.3 Public surface

```js
// marsin_engine/lib/osc_listener.js
export class OscListener {
  /**
   * @param {object} opts
   * @param {ParamCenter} opts.paramCenter — required
   * @param {number}   opts.port               — UDP port (default 6970)
   * @param {string}   opts.host               — bind interface (default '0.0.0.0')
   * @param {object}   opts.bindings           — see §3.1 / §6.4
   * @param {Array<{name:string, ip:string}>} opts.allowedSenders — empty = open; non-empty = strict allowlist
   * @param {function} opts.onStats            — called every 1s with the split-counter stats payload (§10.1)
   */
  constructor(opts) { /* validates bindings + allowedSenders eagerly */ }

  start() { /* bind socket, start stats timer */ }
  stop()  { /* close socket, clear timer */ }

  /** @returns {{ enabled, port, host, allowedSenders, bindingsCount, ...counters }} */
  getStatus() { /* ... */ }
}
```

All validation happens in the constructor (or on `start()` before
the socket binds). If any binding or allowedSender entry is bad, the
constructor throws — `engine.js` catches, logs, and proceeds without
OSC. There is no partial-success path.

### 6.4 Binding map construction

On construction:

1. Read every entry from `paramCenter.getSchema()`. For each entry:
   - If `type === 'float'` or `type === 'int'`: bind
     `entry.oscAddress` to `{ key, kind: 'scalar', argIndex: 0 }`.
   - If `type === 'hsv'`: bind three sub-addresses
     `${entry.oscAddress}/h`, `/s`, `/v` to
     `{ key, kind: 'hsv-h' | 'hsv-s' | 'hsv-v', argIndex: 0 }`.
2. Read `opts.bindings`. For each entry:
   - **Shorthand** (`{ "/addr": "key" }`):
     normalise to a single-element list
     `[{ key, kind: 'scalar', argIndex: 0 }]`.
   - **Object form** (`{ "/addr": [ {key, arg}, ... ] }`):
     normalise each item to `{ key, kind: 'scalar', argIndex: arg }`.
   - Look up the target CPC key in the registry. **Unknown key →
     throw** ([§3.3](#33-binding-precedence-and-conflicts)).
   - Look up the registry type. HSV → throw (HSV must use the
     canonical sub-addresses; an object-form entry can still set
     individual hsv-sub-addresses through their canonical name if
     truly needed, but custom HSV bindings are not supported in v1).
   - If the OSC address is already in the canonical map → throw.
   - If two custom bindings collide on the same OSC address → throw.
3. The result is an `address → BindingEntry[]` map. A single inbound
   packet may dispatch to multiple CPC writes (one per list element).
4. Validate `allowedSenders`: each entry must have a `name`
   (non-empty string, unique within the list) and an `ip`
   (parseable). On any failure → throw.

Result: an in-memory `{ bindingsByAddr, allowedByIp }` pair, both
O(1) on the packet hot path.

### 6.5 Per-message dispatch

The dispatcher accumulates every write a single packet produces and
hands them to the CPC as **one atomic batch**. That way an XY pad
sending two args on one address fires `onChange` exactly once with
both keys (one broadcast emission, one persistence check), instead
of cascading two independent mutations through the fan-out.

```
onPacket(rinfo, oscPacket):
  counters.rx += 1

  # Sender allowlist (only when non-empty). normalizeIp() flattens
  # IPv4-mapped IPv6 and equates 127.0.0.1 / ::1 (see §3.4).
  normIp = normalizeIp(rinfo.address)
  if (allowedByIp.size > 0):
    sender = allowedByIp.get(normIp)
    if (!sender):
      counters.dropped += 1
      return
    origin = `osc:${sender.name}`
  else:
    origin = `osc:${normIp}:${rinfo.port}`

  bindings = bindingsByAddr.get(oscPacket.address)
  if (!bindings):
    counters.dropped += 1
    return

  # Build the write batch from this single packet.
  writes = []
  for (b of bindings):
    raw = oscPacket.args[b.argIndex]
    if (raw === undefined):                   # arg index doesn't exist on this packet
      counters.invalid += 1
      continue
    value = coerceArg(raw)                    # see §8.3
    if (value === null):
      counters.invalid += 1
      continue

    if (b.kind === 'scalar'):
      writes.push({ kind: 'scalar', key: b.key, value })
    else:
      writes.push({ kind: 'hsv', key: b.key, field: b.kind.slice(4), value })

  if (writes.length === 0): return

  # One atomic batch → one onChange fire → one broadcast/persist check.
  paramCenter.setMany(writes, 'osc', origin)

  counters.mapped += writes.length
  stats.lastSeenMs = Date.now()
  stats.lastSender = origin
```

The listener intentionally does **not** call `applySnapshot`,
`save()`, or `broadcastWs`. Those are CPC `onChange`'s job —
see [§7.2](#72-broadcast-on-cpc-mutation). For audio at 60 Hz this
matters: the listener stays at packet rate, while broadcast +
persist drop to `broadcastHz` and "never" respectively
([§7.4](#74-live-param-policy)).

### 6.6 Error & traffic posture

| Situation                                          | Behaviour                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Sender not in `allowedSenders` (when non-empty)    | Dropped at the socket. Counted in `droppedMessagesPerSec`. Logged once per minute per IP.       |
| Unmapped OSC address (sender accepted)             | Silently dropped. Counted in `droppedMessagesPerSec`. (OSC traffic is noisy — logging floods.)  |
| Malformed packet                                   | Decoder catches the throw; counted in `invalidMessagesPerSec`; logged once per minute per IP.   |
| Address mapped, wrong arg type                     | Single binding skipped, others on same packet still apply. Counted in `invalidMessagesPerSec`.  |
| Address mapped, packet has fewer args than binding `argIndex` | Single binding skipped (runtime, not startup — see §13.1). Counted in `invalidMessagesPerSec`.   |
| Source-lock rejection at CPC                       | Listener doesn't see it; CPC returns `{status: 'ignored'}`. Logged at `debug`.                  |
| Port already in use                                | Engine logs a clear error and continues with OSC disabled. The rest of the engine boots.        |
| Sender IP changes mid-show (open mode)             | New `origin` string; CPC `lastOrigin` reflects it on the next write.                            |
| Sender IP changes mid-show (allowlist mode)        | New IP dropped until config is updated. Operator must reload (no hot reload in v1).             |
| High-rate audio packets (60 Hz)                    | Listener processes every packet; CPC injects every dirty render frame; broadcast throttles to `broadcastHz`; no disk writes. See [§7.4](#74-live-param-policy). |

OSC packets carry no auth on the wire. Without `allowedSenders`,
anyone on the same subnet can mutate shared params — operators
should set the allowlist for playa / show networks or restrict
`host` to loopback.

---

## 7. CPC Integration

### 7.1 Two new CPC methods: `setHsvField` and `setMany`

To support HSV sub-addressing without making the listener read-
modify-write the HSV value itself (which would break atomicity if
two sub-addresses arrived back-to-back), and to support the OSC
dispatcher's atomic XY/multi-key batch ([§6.5](#65-per-message-dispatch)),
the CPC grows two methods.

```js
// param_center.js
setHsvField(key, field /* 'h' | 's' | 'v' */, value, source, origin) {
  const entry = this._registryByKey[key];
  if (!entry || entry.type !== 'hsv') {
    return { status: 'ignored', reason: 'not_hsv' };
  }
  const cur = this._store[key].value;
  const next = { ...cur, [field]: value };
  return this.set(key, next, source, origin);   // reuses lock + clamp
}

/**
 * Apply N writes from a single source event (one OSC packet, one
 * future MIDI bundle, etc.) atomically. Fires onChange exactly once
 * with all changed keys, so downstream broadcast + persist see one
 * batch instead of N independent mutations.
 *
 * writes: Array<{ kind: 'scalar', key, value }
 *              | { kind: 'hsv',    key, field: 'h'|'s'|'v', value }>
 *
 * Per-write source-lock rejection drops that write from the batch.
 * If every write is rejected, no onChange fires and the batch is a
 * no-op.
 */
setMany(writes, source, origin) {
  const changedKeys = [];
  for (const w of writes) {
    const result = (w.kind === 'hsv')
      ? this._setHsvFieldNoFire(w.key, w.field, w.value, source, origin)
      : this._setNoFire(w.key, w.value, source, origin);
    if (result.status === 'ok') changedKeys.push(w.key);
  }
  if (changedKeys.length > 0 && this.onChange) {
    this.onChange({ changedKeys, state: this.getCanonicalState() });
  }
  return { status: 'ok', changedKeys, revision: this._revision };
}
```

`_setNoFire` / `_setHsvFieldNoFire` are the existing
`set` / `setHsvField` bodies factored to NOT call `onChange` (so the
batch can fire it once at the end). The original `set` and
`setHsvField` keep their existing single-write semantics for HTTP
and WS callers.

### 7.2 Broadcast on CPC mutation

Today the API server broadcasts `sharedParams` from its own HTTP and
WS handlers — the CPC itself doesn't emit. To let OSC writes (and
any future source) trigger the same fan-out without giving the
listener a back-reference to the WS server, and to make the fan-out
**key-aware** so live params don't flood it, we add one hook on the
CPC:

```js
// param_center.js — constructor
this.onChange = null;        // single optional callback, set at boot

// param_center.js — at the end of set() / setHsvField() on a successful write:
if (this.onChange) {
  this.onChange({
    changedKeys: [key],                 // array even for single-key writes,
                                        // so future batch APIs reuse the shape
    state: this.getCanonicalState(),
  });
}
```

`api_server.js` wires it once at boot, and routes through a small
"fan-out helper" that knows the registry's per-key policy:

```js
paramCenter.onChange = ({ changedKeys, state }) => {
  // 1. WASM injection: always on the next render frame, regardless
  //    of key policy. The render loop already calls flushDirty()
  //    every tick, so we don't need to call applySnapshot here.

  // 2. Persistence: only if at least one changed key is persistent.
  if (paramCenter.hasPersistentDirty(changedKeys)) {
    paramCenter.save();                 // already debounced 250 ms
  }

  // 3. WS broadcast: per-key throttled by registry broadcastHz.
  broadcastSharedParamsThrottled(state, changedKeys);
};
```

`broadcastSharedParamsThrottled(state, changedKeys)` lives in
`api_server.js`. It maintains one `lastBroadcastMs[key]` map. A
broadcast is emitted now iff *any* changed key has
`now - lastBroadcastMs[key] ≥ 1000 / registry[key].broadcastHz`. The
broadcast carries the full canonical state (cheap — already a flat
object); we just rate-limit the **emission**, not the payload.
`lastBroadcastMs` is updated for every changed key on emit, so a
quiet param doesn't get starved by a noisy one.

> [!NOTE]
> **`broadcastHz` is an emission rate-limit per causing key, not a
> per-key payload mask.** When an emission fires, the broadcast
> contains the full `sharedParams` doc — so a CaptainPad reading
> `audioLevel` off any broadcast may see it advance faster than 15 Hz
> if some other key (e.g. `speed`) triggered a higher-rate emission.
> What `audioLevel: 15` guarantees is that *if* `audioLevel` itself
> is the only mutating key, the listener can't cause more than 15
> broadcasts/second on its account. That's the property that keeps a
> 60 Hz audio analyser from saturating CaptainPad / PortWatch.

Defaults: any registry entry without an explicit `broadcastHz` is
treated as 30 Hz, matching the original CPC §5.3 spec. `audioLevel`
sets 15 Hz; `audioBpm` sets 2 Hz. The non-live params behave exactly
as they do today.

The value-mutating handlers (`POST /param-center` and WS
`setSharedParam`) **drop** their in-line calls to `applySnapshot` /
`save` / `broadcastWs` and rely on `onChange` instead. Handlers that
only change metadata (`POST /param-center/source-lock`,
`onChannelCompiled`'s schema refresh) keep their direct
`broadcastWs({type: 'sharedParams', ...})` call — they don't write a
value, so `onChange` doesn't fire for them.

That makes `onChange` the single source of truth for post-mutation
work — no double-broadcast on HTTP value writes, no divergent paths
for OSC vs HTTP, and the listener never has to know the WS server
exists. A future MIDI / mic source needs no additional wiring —
calling `paramCenter.set(...)` is enough.

### 7.3 Schema and observability

`GET /param-center/schema` is extended to include the new policy
fields, so any client (CaptainPad, PortWatch bridge, debug tools)
can see whether a param is live, what its broadcast cadence is,
whether it persists, and whether PortWatch carries it:

```json
[
  {
    "key": "audioLevel",
    "label": "Audio Master",
    "type": "float",
    "range": [0, 1],
    "default": 0,
    "oscAddress": "/marsin/audio/level",
    "live": true,
    "broadcastHz": 15,
    "persist": false,
    "portWatch": false
  },
  { "key": "speed", ..., "live": false, "broadcastHz": 30, "persist": true, "portWatch": true }
]
```

`GET /param-center` is unchanged — `lastSource`, `lastOrigin`,
`lastRevision` are already there, and CaptainPad can already see
`lastSource: 'osc'` as soon as an OSC write lands.

The existing WS `sharedParams` broadcast shape is unchanged. Only
its **cadence per key** changes (per `broadcastHz`); the message
itself is identical.

### 7.4 Live-param policy

> [!IMPORTANT]
> This is the single most important behaviour change vs a naive
> "OSC just calls paramCenter.set" design. Without it, one laptop
> audio analyser pumping 60 Hz traffic into the engine spams
> CaptainPad over Wi-Fi, PortWatch over LoRa, and the disk via
> `save()` — every second of the show.

A param flagged `live: true` in the registry adopts these defaults
(any of which can be overridden by a per-key field):

| Concern                  | Default for live params         | Default for non-live (unchanged)         |
| ------------------------ | ------------------------------- | ---------------------------------------- |
| Disk persistence         | **Never** (`persist: false`)    | Debounced 250 ms (`persist: true`)       |
| WS `sharedParams` cadence | `broadcastHz: 15` (or per-key) | `broadcastHz: 30` (or per-key)           |
| PortWatch `compact_status` field | **Omitted** (`portWatch: false`) | Included (`portWatch: true`)     |
| WASM render-frame injection | Every dirty frame, unchanged  | Every dirty frame, unchanged             |
| Source-lock arbitration  | Honoured exactly like any param | Honoured exactly like any param          |

The four levers are independent — for example `audioBpm` is live
(no persist, no flood), `broadcastHz: 2` (it changes slowly), but
`portWatch: true` because operators want BPM on the LoRa-side card.

`broadcastSharedParamsThrottled` reads `broadcastHz` to gate WS
emissions. The PortWatch bridge filter is a small change in
`control_podium/comms/engine_client.py::compact_status` — it iterates
the schema and only emits fields where `portWatch === true`. That
change is documented in the [implementation report](.agent/02_reports/202605/20260524_1_osc_impl.md)
rather than baked into the engine itself.

---

## 8. Wire Protocol Specifics

### 8.1 Transport

UDP only in v1. OSC over TCP and OSC over WebSocket are explicitly
out of scope; if a use case appears later (e.g. browser-to-engine
audio over WS), the listener wraps a transport-agnostic decoder so a
second transport is a constructor option, not a rewrite.

### 8.2 Bundles

Inbound OSC bundles are unrolled into individual messages and
dispatched in order. We do not honour bundle timetags — every message
is applied as if `immediately` ([CPC §9.3](./15_central_param_center_cpc.md#93-stability-notes)
already specifies absolute values, no deltas, so missed timing
doesn't compound).

### 8.3 Argument types

| OSC type tag | Treatment                                                                |
| ------------ | ------------------------------------------------------------------------ |
| `f` (float)  | Used directly.                                                           |
| `i` (int)    | Coerced to float.                                                        |
| `d` (double) | Coerced to float (clamped to JS number range).                           |
| `s` (string) | Numeric strings are parsed; anything else dropped + warn-rate-limited.   |
| `T` / `F`    | Truthy → 1.0, falsy → 0.0. Useful for boolean-like CPC params.           |
| anything else | Dropped silently.                                                        |

Multi-arg packets to scalar bindings use the **first** argument; extra
args are ignored. Multi-arg packets to HSV sub-addresses likewise use
the first argument (one float per sub-address).

### 8.4 Worked examples

```
# Set master speed from a TouchOSC fader (custom binding to canonical key)
/marsin/param/speed  ,f  0.42

# Set color 1 hue
/marsin/param/colorPalette1/h  ,f  0.66

# Set audio master level from external analyser at 60 Hz
/marsin/audio/level  ,f  0.31
/marsin/audio/level  ,f  0.27
/marsin/audio/level  ,f  0.44
…

# Same control via a custom alias (TouchOSC layout sending /1/fader1)
/touchosc/1/fader1   ,f  0.42      # config.yaml maps this → speed
```

---

## 9. Source Arbitration

OSC writes are tagged with `source: 'osc'` on the CPC. They
participate in the existing source-lock policy
([CPC §7](./15_central_param_center_cpc.md#7-source-arbitration))
without any new mechanism:

| Lock policy                                            | OSC write behaviour                                          |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `{ mode: 'open' }` (default)                           | All OSC writes apply.                                        |
| `{ mode: 'global', source: 'osc' }`                    | OSC owns the rig. CaptainPad / API / WS writes rejected.    |
| `{ mode: 'global', source: 'ipad' }`                   | OSC writes rejected. CPC returns `{status:'ignored'}`; the listener logs at `debug`. |
| `{ mode: 'per-param', leases: { audioLevel: 'osc' } }` | OSC owns audio bands. iPad / API still own speed / color.   |

### 9.1 Named senders & lock semantics

The named-sender allowlist ([§3.4](#34-named-senders--allowlist))
shows up in CPC param metadata via `lastOrigin`, not `lastSource`:

| Field         | Example value          | Used by                                                                 |
| ------------- | ---------------------- | ----------------------------------------------------------------------- |
| `lastSource`  | `"osc"`                | Source-lock arbitration. **Always** the adapter type.                   |
| `lastOrigin`  | `"osc:touchosc-ipad"`  | Logs, CaptainPad diagnostic sheets, multi-client echo suppression.      |

The source-lock has no per-name granularity in v1 — `mode: 'global',
source: 'osc'` locks every OSC writer in or out together. If finer
control becomes necessary (e.g. "only the audio analyser can write
audio bands, but the TouchOSC iPad can write color"), the natural
extension is to use per-param leases keyed on `"osc:<name>"`. That's
explicitly out of v1 — note kept here so the implementation doesn't
foreclose it.

### 9.2 Rejection observability

The OSC sender has no feedback channel today, so rejection is
observable only via `GET /param-center` (which CaptainPad already
shows via its `lastSource` mirror). Adding an OSC reply path
(`/marsin/error <reason>`) is a CPC §5.4 optional and stays out of
v1.

---

## 10. Status & Telemetry

So that CaptainPad can show "OSC is alive" without polling, the OSC
listener pushes a stats event onto the existing WS broadcast bus
once per second.

### 10.1 Broadcast shape

```json
{
  "type": "oscStats",
  "enabled": true,
  "port": 6970,
  "host": "0.0.0.0",
  "allowedSendersCount": 2,
  "bindingsCount": 5,

  "rxMessagesPerSec": 80,
  "mappedMessagesPerSec": 60,
  "droppedMessagesPerSec": 20,
  "invalidMessagesPerSec": 0,

  "lastSeenMs": 1737070123456,
  "lastSender": "osc:touchosc-ipad"
}
```

Counter semantics — these are intentionally split so TouchOSC /
allowlist debugging is straightforward:

| Counter                | Increments when …                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `rxMessagesPerSec`     | Any packet decoded successfully (incl. those rejected later).                            |
| `mappedMessagesPerSec` | Packet matched a binding and produced at least one `paramCenter.set` call.               |
| `droppedMessagesPerSec` | Packet rejected by allowlist OR matched no binding. (Both are "noise we didn't want.")   |
| `invalidMessagesPerSec` | Packet decoded but arg coerce failed (wrong type, missing argIndex, etc.).              |

`rx = mapped + dropped + invalid` always holds, modulo the 1 s
sampling window. Counters reset each interval; the listener never
keeps cumulative totals (no integer overflow, no "since-boot" state
to surface).

Cadence: one message per second, identical timing to the existing
`stats` broadcast (frame count / FPS). If the listener is disabled
the event still fires with `enabled: false` and all counters at 0,
so CaptainPad can paint an "OFF" pill rather than a missing one.

#### Cached snapshot on WS connect

The API server keeps a `lastOscStats` slot and updates it on every
broadcast. On every new WS connection, the cached snapshot is sent
immediately (same place we already send `mixer`, `sharedParams`,
`autopilot`, and `viewOverride` snapshots — see
`wss.on('connection', …)` in `marsin_engine/lib/api_server.js`).
That way a CaptainPad that just connected paints the correct pill
state within one frame instead of waiting up to one second for the
next stats tick.

If the listener is disabled, `lastOscStats` is the static
"disabled" payload from boot; new clients still get the OFF state
immediately.

### 10.2 What CaptainPad does with it

For v1, a small pill in the **Shared Parameters** header (Tab 1) shows
one of three states, driven by `mappedMessagesPerSec`:

| State                                                                | Pill rendering                         |
| -------------------------------------------------------------------- | -------------------------------------- |
| `enabled: false`                                                     | grey, "OSC OFF"                        |
| `enabled: true`, `lastSeenMs > 5s ago`                               | dim amber, "OSC IDLE"                  |
| `enabled: true`, `mappedMessagesPerSec ≥ 1`                          | bright green, "OSC 60 msg/s"           |
| `enabled: true`, `mappedMessagesPerSec === 0`, `rxMessagesPerSec ≥ 1` | yellow, "OSC RX 20 msg/s, 0 mapped"   |

The last state catches the most common debugging case: TouchOSC is
sending, but no binding matches (typo in `bindings:`, or the
allowlist drops the sender). The operator sees the chip turn yellow
within a second of plugging the iPad in.

Tap-through opens a read-only diagnostic sheet with `port`, `host`,
`allowedSendersCount`, `bindingsCount`, full counter set, and
`lastSender`. No config / editing in v1.

The CaptainPad-side change is small: extend `useEngineState()`
([CaptainPad §4.6](./16_captain_pad.md#46-the-centralised-engine-state-hook))
with one more field (`oscStats`) and a selector hook
(`useOscStatus()`) that follows the same single-subscription
pattern as `useSharedParamValues()`.

---

## 11. CaptainPad Integration

### 11.1 V1 — passive

CaptainPad's existing CPC sliders **already** react to OSC writes for
free, because every successful `paramCenter.set('speed', 0.7, 'osc')`
fires the same `sharedParams` broadcast that an iPad-originated write
would, and `useSharedParamValues()` ([CaptainPad §4.6](./16_captain_pad.md#46-the-centralised-engine-state-hook))
already drives the sliders off that broadcast.

The throttled, key-aware fan-out ([§7.2](#72-broadcast-on-cpc-mutation),
[§7.4](#74-live-param-policy)) means a 60 Hz audio source produces at
most `broadcastHz` WS frames per second per live param (so 15 Hz for
`audioLevel`), which renders as a smooth slider on the iPad rather
than a render-loop-flooding event stream.

The full V1 CaptainPad change is therefore:

1. Add `oscStats` to the engine-state reducer in
   `CaptainPad/hooks/useEngineState.ts`.
2. Add `useOscStatus()` selector hook.
3. Render the status pill in `CaptainPad/components/CPCControls.tsx`,
   driven by `mappedMessagesPerSec` (see [§10.2](#102-what-captainpad-does-with-it)).
4. No new tab, no editing UI, no API calls.

The deck overlay, lockout overlay, autopilot, playlist, and mixer
flows are untouched.

### 11.2 Future — bindings editor in CaptainPad (V2)

Long term, CaptainPad becomes the place an operator manages OSC
bindings without SSH'ing into the engine to edit `config.yaml`. The
design lays groundwork now so V2 can be a UI lift rather than a
re-architecture:

- A future REST surface on the engine — `GET /osc/bindings`,
  `PUT /osc/bindings`, `POST /osc/bindings/test` — would let
  CaptainPad read and replace the binding map at runtime.
- The OSC listener is already side-effect-free (re-`start()` rebuilds
  its internal map from scratch), so live updates need no special
  reconciliation.
- Persistence rule will mirror `param_center_state.yaml`: the
  authoritative source becomes `osc_bindings.yaml`, and `config.yaml`
  becomes a fallback for first-boot defaults.
- The CaptainPad UI lives next to the Shared Parameters section in
  the Control Deck (Tab 1) or as a sub-tab of Settings (Tab 6) —
  decided at V2 design time.

V1 ships none of the above; this section is purely so the v1 module
boundaries (`OscListener` is internally state-driven, bindings are
data, the listener doesn't broadcast directly) don't paint us into a
corner.

### 11.3 PortWatch parity

PortWatch's bridge ([§7a in MarsinEngine doc](./12_marsin_engine.md#7a-captainpad-and-portwatch-integration))
mirrors every `sharedParams` broadcast through the `compact_status`
PUB. OSC writes to *non-live* CPC params (e.g. `speed`,
`colorPalette1`) appear there automatically with no LoRa transport
work needed.

> [!IMPORTANT]
> **v1 requires a small bridge change.** With audio params now
> registered in the CPC, `compact_status` would otherwise carry
> `audioLevel` over LoRa at up to its broadcast rate — saturating a
> link sized for low-rate operator telemetry. The bridge must
> filter `compact_status` fields by `schema[key].portWatch === true`.
>
> Implementation:
>
> 1. At bridge boot, fetch `GET /param-center/schema` and cache
>    `PORTWATCH_KEYS = { entry.key for entry in schema if entry.portWatch }`.
> 2. **Refetch on engine reconnect.** A bridge that survives an
>    engine restart would otherwise carry stale flags. The simplest
>    rule is "refetch the schema every time the engine WS reconnects."
> 3. In the `compact_status` builder, gate each CPC field on
>    `key in PORTWATCH_KEYS`.
>
> All existing PortWatch tags (`sp` → `speed`, `dr` → `direction`,
> `ct` → `count`, `sz` → `size`, `rt` → `rotate`, `p1` →
> `colorPalette1`, `p2` → `colorPalette2`) map to keys with
> `portWatch: true` (defaulted), so the on-wire compact-status shape
> for current LoRa clients is unchanged. The filter only matters
> the moment a new `portWatch: false` param is added.
>
> See [implementation plan §7](.agent/02_reports/202605/20260524_1_osc_impl.md) for the
> diff in `control_podium/comms/engine_client.py`.

---

## 12. Engine Lifecycle

### 12.1 Boot order in `engine.js`

> [!IMPORTANT]
> The listener is the **last** subsystem to bind. Opening the UDP
> socket before WasmHost, mixer, ParamCenter, `onChange`, and the
> API/WS server are all live would mean a fast OSC packet could
> race the engine and either crash a half-built consumer or
> silently no-op against a missing channel. Late binding means the
> first packet that ever arrives sees a fully-formed engine.

```
1. parseArgs + loadConfig                       # existing
2. loadModel + loadPattern                      # existing
3. WasmHost.init + compile                      # existing
4. new PatternMixer + register base channel     # existing
5. new ParamCenter(...)                         # existing
6. startApiServer(...)                          # existing — wires
                                                #   paramCenter.onChange,
                                                #   binds HTTP + WS
7. loop.start()                                 # existing — render
                                                #   loop running,
                                                #   flushDirty per frame
8. NEW: if (config.osc?.enabled)
       oscListener = new OscListener({
         port:           config.osc.port,
         host:           config.osc.host,
         bindings:       config.osc.bindings,
         allowedSenders: config.osc.allowedSenders,
         paramCenter,
         onStats:        (s) => broadcastStatsRef.publish({ type: 'oscStats', ...s }),
       })
       try {
         oscListener.start()           # binds UDP socket
       } catch (err) {
         console.error('[OSC] disabled:', err.message)
         oscListener = null
       }
```

Steps 1–7 are exactly today's flow. Step 8 is the only addition,
and it cannot disturb anything earlier — if it throws, the engine
keeps running with `oscListener = null` and CaptainPad sees the
disabled state in the next `oscStats` broadcast.

The `startApiServer` signature is **not** extended to take the
listener back-reference. v1 has no REST surface that reads from the
listener; the existing `oscStats` broadcast and `getStatus()` calls
go the other direction (engine → listener owns them). The future V2
`/osc/bindings` REST surface ([§11.2](#112-future-bindings-editor-in-captainpad-v2))
can rewire that pointer through a `setOscListener(listener)` call
when it lands.

### 12.2 Shutdown

The existing `shutdown()` handler grows one line, called **first**
(so we stop accepting packets before tearing down the consumers):

```
if (oscListener) oscListener.stop()
…then the existing loop.stop() / blackout / sacnOut.stop() flow.
```

UDP socket close is sync and cheap.

### 12.3 Hot reload

V1 has no hot-reload for OSC config — config changes require an
engine restart. This matches every other section of `config.yaml`
today (sACN destinations, engine FPS, server port). V2's CaptainPad
bindings editor will introduce live binding updates without engine
restart; that's the only piece that needs it.

---

## 13. Failure Modes

### 13.1 Startup failures (engine boots, OSC disabled)

Per the codex's "no fallback behaviors" rule, all malformed config
fails at startup — there is no partial binding map. Engine itself
keeps booting normally; only OSC stays off.

| Startup failure                                                  | Result                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `config.osc.port` already bound by another process               | Listener throws on `start()`. Logged. `oscListener = null`. Engine boots.             |
| `config.osc.bindings` value not a string or valid object-form list | Constructor throws. Logged. Listener off.                                            |
| Binding references an unknown CPC registry key                   | Constructor throws. Logged. Listener off. (No more silent skip.)                      |
| Binding object-form `arg` not a non-negative integer (or > 16)   | Constructor throws. (Runtime arg-count validation happens per-packet — see §13.2.)    |
| Binding shorthand pointing at an HSV-typed CPC key               | Constructor throws (HSV must use canonical sub-addresses).                            |
| Binding overloads a canonical address                            | Constructor throws. Listener off.                                                     |
| Two custom bindings collide on the same OSC address              | Constructor throws. Listener off.                                                     |
| `allowedSenders` entry missing `name` or `ip`                    | Constructor throws. Listener off.                                                     |
| `allowedSenders` `ip` not a parseable IPv4 / IPv6 literal        | Constructor throws. (DNS names are not supported in v1.)                              |
| `allowedSenders` names not unique                                | Constructor throws. Listener off.                                                     |

### 13.2 Runtime behaviour (listener up, individual packets)

Runtime drops are counted but never crash the listener and never
log per-packet — playa networks are noisy.

| Runtime situation                                | Result                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Sender not in `allowedSenders` (when non-empty)  | Dropped at socket. `droppedMessagesPerSec += 1`. Logged at warn once per minute per IP.               |
| Unmapped OSC address (sender accepted)           | Silently dropped. `droppedMessagesPerSec += 1`.                                                       |
| Malformed packet                                 | Decoder throws → caught. `invalidMessagesPerSec += 1`. Logged once per minute per IP.                 |
| Address mapped, wrong arg type / missing index   | That single binding skipped, others on same packet still apply. `invalidMessagesPerSec += 1`.         |
| Sender floods (> 10k pkts/s)                     | Bound by Node UDP recv buffer. Per-frame WASM injection coalesces (last-value-wins). No queue grows. |
| Sender sends garbage / not OSC                   | Decoder throws → caught and rate-limited. Socket stays open.                                          |
| Source-lock excludes OSC                         | CPC returns `{status: 'ignored'}`. Listener logs at debug. Canonical broadcast still reflects truth. |
| Pattern lacks a matching `shared*` export        | Param value stored canonically and broadcast, but never injected into that channel's WASM VM.         |
| Live param hit at 60 Hz                          | WASM injection every dirty frame, broadcast throttled to `broadcastHz`, zero disk writes ([§7.4](#74-live-param-policy)). |

---

## 14. Test Plan

### 14.1 Smoke

A tiny standalone Node sender in `marsin_engine/tests/osc_smoke.js`:

```
node osc_smoke.js --addr /marsin/param/speed --value 0.5
node osc_smoke.js --addr /marsin/audio/level --value 0.8
```

Expected: `GET /param-center` shows `speed.value === 0.5,
speed.lastSource === 'osc'`; CaptainPad sliders move; WASM render
output changes accordingly.

### 14.2 Unit tests

| Test                                                     | What it verifies                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `osc_listener.test.js — canonical scalar`                | `/marsin/param/speed 0.5` → CPC `speed.value === 0.5`.                                    |
| `osc_listener.test.js — HSV sub-address`                 | `/marsin/param/colorPalette1/h 0.3` mutates `h`, leaves `s` / `v` intact.                 |
| `osc_listener.test.js — custom alias (shorthand)`        | Config `{/touchosc/1/fader1: speed}` lands correctly.                                     |
| `osc_listener.test.js — custom alias (object form, XY)`  | Config `{/xy1: [{key:rotate,arg:0},{key:size,arg:1}]}` writes both keys from one packet.  |
| `osc_listener.test.js — canonical overload rejected`     | Custom binding to `/marsin/param/speed` → constructor throw, listener off.                |
| `osc_listener.test.js — unknown CPC key rejected`        | Custom binding to nonexistent key → constructor throw, listener off (consistent failure). |
| `osc_listener.test.js — object-form arg index oob`       | Object-form binding with `arg: 5` for a known scalar key → constructor throw.             |
| `osc_listener.test.js — clamping`                        | OSC value `1.7` clamped to `1.0` by CPC, broadcast reflects clamped value.                |
| `osc_listener.test.js — source-lock`                     | When CPC locked to `'ipad'`, OSC write is rejected; canonical state same.                 |
| `osc_listener.test.js — allowedSenders strict`           | With allowlist `[{ip:'10.0.0.42'}]`, packet from `10.0.0.99` is dropped + counted.        |
| `osc_listener.test.js — allowedSenders open`             | Empty allowlist accepts any sender; origin format is `osc:<ip>:<port>`.                   |
| `osc_listener.test.js — allowedSenders named origin`     | Accepted packet's CPC write carries `lastOrigin === 'osc:touchosc-ipad'`.                 |
| `osc_listener.test.js — split-counter stats`             | 100 mixed packets → `rx == mapped + dropped + invalid` exactly.                           |
| `osc_listener.test.js — stats cadence`                   | `onStats` fires once per second with the per-second counters (no cumulative drift).       |
| `param_center.test.js — onChange shape`                  | `onChange({changedKeys, state})` fires with the right keys array on `set` / `setHsvField`. |
| `param_center.test.js — hasPersistentDirty`              | `hasPersistentDirty(['audioLevel'])` returns false; `(['speed'])` returns true.           |
| `api_server.test.js — live broadcast throttle`           | 60 OSC writes/sec to `audioLevel` produce ≤ `broadcastHz + 1` WS `sharedParams` per sec.  |
| `api_server.test.js — no persist for live`               | 60 OSC writes/sec to `audioLevel` produce **zero** disk writes to `param_center_state.yaml`. |
| `api_server.test.js — onChange replaces direct calls`    | HTTP `POST /param-center {speed:0.5}` produces exactly one `sharedParams` broadcast.      |

### 14.3 Integration

A scripted end-to-end check that the existing
`.agent/00_gol/05_marsin_engine_auto_checks.md` flow can extend:

```
1. Boot engine with osc.enabled = true, port 6970.
2. Send /marsin/param/speed 0.42 once.
   → GET /param-center: speed.value == 0.42, lastSource == 'osc'.

3. Send /marsin/audio/level at 60 Hz for 2 s (120 packets total).
   → GET /param-center: audioLevel.value follows the latest packet.
   → oscStats: rxMessagesPerSec ~= 60, mappedMessagesPerSec ~= 60,
     droppedMessagesPerSec == 0.
   → WS sharedParams emissions for audioLevel during the window:
     ≤ broadcastHz (15) per second, so ≤ 30 broadcasts total.
   → No new lines appended to param_center_state.yaml (audioLevel is
     live: false-persist).
   → PortWatch compact_status PUB during the window does NOT include
     the `audioLevel` field.

4. With allowedSenders = [{name: 'sender1', ip: 127.0.0.1}], send the
   same audio packets from 127.0.0.1.
   → Accepted, oscStats.lastSender == 'osc:sender1'.

5. With allowedSenders = [{name: 'sender1', ip: 10.0.0.42}], send from
   127.0.0.1.
   → droppedMessagesPerSec increments by the packet count;
     speed.value unchanged.

6. Shutdown — port released cleanly, engine continues to render
   blackout frame and exit.
```

---

## 15. Future Extensions

### 15.1 Per-pattern (local) export control

The natural V2 surface mirrors the channel-control REST endpoint:

```
/marsin/channel/<channelId>/control/<exportName>   [float]
```

The listener already has the per-message dispatch shape for this; the
only piece missing is a name-resolution step from `exportName` to the
CRC32 control ID (which `wasmHost.getExports()` already supplies).
Out of v1 scope but explicitly designed-around.

### 15.2 MIDI source adapter

MIDI follows the exact same shape — a thin Node USB-MIDI listener that
maps CC → CPC key — including the registry's `midiFuture` field that
already exists ([CPC §10](./15_central_param_center_cpc.md#10-midi-adapter-future)).
Adding MIDI does not touch the OSC listener.

### 15.3 In-engine audio capture — **shipped**

Originally listed as a future extension; landed in May 2026. See
[`docs/25_marsin_audio_analysis.md`](./25_marsin_audio_analysis.md)
for the full design (cross-platform `ffmpeg` capture, FFT analyzer,
kick detector, BPM-to-speed sync, per-scene `audio_state.yaml`,
CaptainPad Audio Analysis tab). The mic adapter calls
`paramCenter.setMany([...], 'audio', 'audio:mic')` with the same
shape an OSC packet would, so the rest of the CPC pipeline is
identical — the `lastSource` field is `'audio'` instead of `'osc'`
when the mic wrote a value.

### 15.4 OSC outbound feedback

Motorised faders and LED controllers want canonical state pushed
back. The natural place is `paramCenter.onChange` — we add a second
hook `oscListener.publishChange(state)` that mirrors selected params
back to a configured destination IP:port. Out of v1, easy to slot in
later.

### 15.5 CaptainPad bindings editor

Covered in [§11.2](#112-future-bindings-editor-in-captainpad-v2).
The engine surface needed (`GET/PUT /osc/bindings`, persistence to
`osc_bindings.yaml`) is sketched there so v1 doesn't bake in
assumptions that block it.

---

## 16. Cross-references

| Doc                                                              | Why                                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [12 — MarsinEngine](./12_marsin_engine.md)                       | The headless engine this listener lives inside. See §2 for runtime architecture and §7a for the CaptainPad/PortWatch broadcast contract that OSC writes fan out through. |
| [15 — Central Parameter Center (CPC)](./15_central_param_center_cpc.md) | The destination of every OSC write. §9 already sketched the OSC adapter; this doc fills in the binding model, audio params, and engine wiring. |
| [16 — CaptainPad](./16_captain_pad.md)                            | The primary read surface for OSC-driven changes. §4.6 defines the engine-state hook that v1 extends with `useOscStatus()`. |
| [18 — Marsin Mixer](./18_marsin_mixer.md)                         | Mixer channels each carry CPC values into their own WASM VM; OSC writes flow into every channel equally via `paramCenter.applySnapshot(wasmHost)`. |
| [21 — PortWatch Monitor](./21_portwatch_monitor.md)               | LoRa surface that mirrors every `sharedParams` broadcast — OSC writes appear on PortWatch with zero extra wire work. |

