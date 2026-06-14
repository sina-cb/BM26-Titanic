# 🥁 [TODO] Hand Drum — Play the Titanic Like a Drum Surface — Design Doc

> **Status: TODO — design only, not yet implemented.** Reviewed and approved
> for build; tracked on the Notion task board (Titanic Lighting - Task
> Tracker). This file is the spec an implementation agent works from.

> **Rev. 2026-06-14 (expert pre-implementation pass, ×3).** Tightened to match
> the current repo before any code lands: per-hit transport is **`/ws/control`**
> (via `engineEvents.send`); runtime `drumHit` errors return a **`drumError`**
> frame and never crash the render loop, while *enabled-but-unwired* fails
> **at boot**; a new **§0 model-export prerequisite** + Titanic scene cleanup;
> v1 voices are **weighted `dropHit` only** (`effect:` flavor is v2); each hit
> carries a **`kitId`** validated server-side (multi-client).
> **Second pass (re-review) fixes:** **`drumMaster` is applied live per frame**
> (rides ringing impulses), not baked at trigger — impulses store
> **`baseIntensity`**; voices target structures by **named `groups`**
> (preferred) since the Titanic chimneys sit mid-`ny ≈ 0.44–0.66` (a guessed
> `nyBand:[0.7,1]` lights nothing); **`drumSpeed ∈ [0.25,4.0]`** so envelope
> division is never `/0`; the boot validator checks **coordinates only**
> (naming/traces cleanup is prerequisite, not boot-gated, but bad group names
> fail at **kit-load**); and **`kitId`** is used everywhere on the wire.
> See §0, §3.D–F, §4, §5, §6, §7, §8.

## Overview

The Titanic's light is mostly *programmed* — patterns run, the deck plays a
playlist, the mixer crossfades. **Hand Drum** turns it *performative*: the
operator (or a welcomed alien) taps the iPad — or the 8×8 pads of an **APC
mini mk2** — and each tap fires a short, localized burst of light **at the
spot they touched on the ship**. Tap front-left, the front-left bow lights
punch. Tap high, the smokestacks bark. Drag four fingers across the skin and
a chord of light walks the hull.

It is, deliberately, an *instrument*: zero-latency-feeling, expressive,
forgiving, and fun — the welcoming, kind, playful corner of the mission. It is
**not** a programming surface; it sits next to the Deck and Mixer, borrows
their engine, and adds exactly one new engine primitive: a **spatial
impulse** (a drop-hit that knows *where* on the model it landed).

```
 iPad (CaptainPad)                          APC mini mk2 (USB-C)
 ┌───────────────────────┐                  ┌──────────────────┐
 │  HAND DRUM tab        │                  │  8×8 pad grid    │  ← positions
 │  ┌─────────────────┐  │  multi-touch     │  9 faders        │  ← size/speed/
 │  │  model "skin"   │◀─┼── taps (u,v) ──▶ │  (velocity =     │     hue/level
 │  │  (front view)   │  │                  │   intensity)     │
 │  └─────────────────┘  │                  └────────┬─────────┘
 │  kit picker · faders  │                           │ NativeMidiTransport
 └───────────┬───────────┘                           │ (docs/34)
             │  ws "drumHit" {u,v,kitId,voice,vel}    │
             ▼                                        ▼
   ┌────────────────────────────────────────────────────────┐
   │  MarsinEngine :6968  —  /ws/control (existing socket)    │
   │   drumHit → resolve kit+voice → SpatialImpulse{originN,  │
   │             radiusN, color6, env, blend}                 │
   │   → GlobalEffectsController.triggerSpatialImpulse(...)    │
   │   → per-pixel weight = falloff(dist(pixel.nN, originN))   │
   │   → dropHit envelope × weight  (frame loop, 40 fps)       │
   └───────────────────────────┬──────────────────────────────┘
                               │ sACN
                               ▼  fixtures / sim :6969
```

> **Builds on:** [34 — CaptainPad MIDI](./34_captainpad_midi.md) (the APC
> transport + mapping stack) · [28 — Global Effect Macros](./28_global_effect_macros.md)
> (the `dropHit` envelope we generalize) · [15 — Central Param Center](./15_central_param_center_cpc.md)
> (where the continuous "size/speed/hue" live) · [12 — MarsinEngine](./12_marsin_engine.md)
> (frame loop + pixel model) · [16 — CaptainPad](./16_captain_pad.md) (tab shell).

---

## 0. Prerequisite — Hand Drum consumes the **exported model**, not scene YAML

The whole feature stands on one assumption: **every controllable pixel has a
finite normalized position.** The spatial weight is `falloff(dist(px.nN,
originN))` — a pixel with a missing or `NaN` `nx/ny` either never lights or
poisons the math. So before any Hand Drum code lands, this prerequisite must
hold and be enforced.

**What Hand Drum reads.** Hand Drum operates on the **exported engine model**
(`marsin_engine/models/<scene>.js` — the `pixels[]` array with
`i/type/group/x/y/z/nx/ny/nz/…`), **not** the raw scene YAML and **not** the
sim's scene graph. The export is the contract; the spatial primitive never
parses scene authoring files.

**The hard requirement.** The exported model MUST provide **finite `nx`, `ny`,
`nz` in `[0..1]`** for:

- every **controllable DMX fixture** pixel (par, bar, vintage, etc.), and
- every **LED pixel** (strand/strip pixels).

Non-light simulation fixtures (Horn, Fire, Foggers — the companion
`*.effects.js` model) are out of scope and not drummable.

**Fail-loud validation (codex P0) — coordinates only.** A new `HandDrum` boot
step validates the loaded model and **throws at startup** listing every
controllable pixel whose `nx/ny/nz` is missing, non-finite, or outside
`[0..1]`. There is no "skip the bad pixel" fallback — a model that can't be
drummed safely is a loud boot error, not a silent partial surface. The same
validator is reused by the `nyBand`/`zBand` filters so an out-of-range band
fails the same way. **Scope it precisely:** the boot validator checks
*coordinate finiteness/range* and nothing else — it does **not** assert the
scene-cleanup items below (LED IDs, traces, naming). Those are authoring-time
contracts about *quality*, not values the engine can cheaply prove correct at
boot; if any of them later warrants enforcement it gets its own explicit
validator (e.g. a `group`-membership check when a kit references a named
group — a `groups: [...]` voice naming an absent group is an **UNKNOWN_GROUP**
kit-load error, §6).

**Titanic scene cleanup — prerequisite, *not* boot-validated.** The `titanic`
scene needs a tidy-up pass so its export is sane and the skin is stable
shot-to-shot. This is **human/tracker prerequisite work** (own task), separate
from the coordinate validator above — the engine won't (and shouldn't) try to
machine-check "are these names tidy?" at boot:

1. **Stable logical IDs / view masks for LED strands** — assign each LED
   strand a stable logical id + view mask so the same physical run maps to the
   same skin region across re-exports (so `regions`/calibration don't drift).
2. **One canonical traces source** — pick a single canonical traces/geometry
   source for the export, or prove the loaders consume exactly one (no
   ambiguity about which geometry produced the `nx/ny/nz`).
3. **Standardize generator / group names** — normalize generator and `group`
   names so kit `groups`/`regions` key off stable strings (this one *does*
   gain teeth indirectly: a kit referencing a renamed group fails kit-load).

If the **coordinates** aren't clean, Hand Drum on `titanic` is blocked at the
boot validator — the intended loud behavior. The naming/traces cleanup won't
block boot but will make kits brittle until done. `test_bench` (which already
exports clean `nx/ny/nz`, see §B) is the bench rig in the meantime.

---

## 1. The one idea that makes this work: the **Spatial Impulse**

Everything the engine fires today — `dropHit`, `blastWhite`, `uvBlast`,
`colorWash` — applies to **every pixel** (`global_effects_controller.js`
loops `pixels[i]` with no spatial term). A drum needs the opposite: a hit
that lands *somewhere*. So the single new engine primitive is:

```
SpatialImpulse {
  originN:  [nx, ny]      // tap location in the model's normalized skin, 0..1
  radiusN:  number         // 0..1 — how much of the skin the hit covers ("size")
  falloff:  'gaussian' | 'linear' | 'flat'
  color6:   [r,g,b,w,a,u]  // RGBWAU in 0..1 ("hue")
  attackMs, holdMs, releaseMs   // the envelope ("speed"/"feel")
  baseIntensity: 0..1      // velocity · voice.gain · drumIntensity, clamped (FIXED at trigger)
  blend:    'add' | 'max' | 'replace'
  groups?:  [string]       // optional filter to named model groups (px.group) — preferred for "stack"
  nyBand?:  [min, max]     // optional vertical (high/low) filter on px.ny (use MEASURED bands)
  zBand?:   [min, max]     // optional front/back depth filter on px.nz
}
```

`baseIntensity` is fixed at trigger from the per-hit terms; **`drumMaster` is
deliberately *not* baked in** — it is the **live layer fader** and is applied
*per frame* in `applySpatialImpulse` (see §3.E / §5), so sliding Fader 9 rides
already-ringing impulses up and down. Filters compose (AND): a pixel must pass
`groups`, `nyBand`, and `zBand` to be hit.

Every pixel in our models already carries normalized coords `nx, ny, nz` in
`[0..1]` (see any `marsin_engine/models/*.js` row). The impulse computes, per
pixel, a **spatial weight**:

```
d      = hypot(px.nx - originN[0], px.ny - originN[1])   // distance on the skin
w      = falloff(d / radiusN)        // 1 at the tap, →0 at the rim, 0 beyond
amount = clamp01(baseIntensity · drumMaster) · envelope(elapsedMs) · w
//       └ baseIntensity fixed at trigger; drumMaster read LIVE each frame (§5)
```

then applies the **existing `dropHit` per-pixel math** (`effects/dropHit.js`
`applyDropHit`, already RGBWAU- and blend-mode-aware) with that `amount`. The
envelope generator (`envelopeValue` / `envelopeDurationMs`) is reused
verbatim. In other words: **a hand-drum hit is a `dropHit` with a spatial
weight mask and a per-hit origin.** That framing keeps the new code tiny and
keeps the playa-critical pixel pipeline (dimmer, DMX, sACN) untouched
downstream.

A `GlobalEffectsController` already holds a list of live `dropHits` and ages
them out each frame. We add a parallel `spatialImpulses[]` list with the same
lifecycle — pushed on trigger, popped when `elapsedMs > durationMs`. Voices
are **fire-and-forget and polyphonic**: ten taps = ten entries summing
(`add`/`max`) into the frame, then gone. No slot allocation, no stuck notes.

### Why not patterns, OSC, or the existing "signals" graph?

- **Patterns** are global, persistent, and swap with a transition — wrong
  shape for a 150 ms localized punch fired 8×/second. Hand Drum rides *on top
  of* whatever pattern/deck is already playing (additive blend), so the
  drummer plays *with* the show, not instead of it.
- The engine's **`signals` subsystem** (`signal_post_processor.js`,
  `/ws/signals`: `gain/bias/lpf/envelope/schmitt/…`) is a *modulation graph*
  for CPC params, not a spatial event bus. We **reuse the word carefully**:
  in this doc a drummer's trigger is a **voice/impulse**, not a "signal." A
  v2 hook (§9) can publish a voice's envelope value onto the signal bus so
  patterns *react* to drumming — but that is optional polish, not the core.
- **OSC** (docs/24) injects into CPC params too — same mismatch, plus an
  extra UDP hop. The tap path wants the lowest-latency channel we already
  own: the CaptainPad↔engine **WebSocket**.

---

## 2. Goals & Non-Goals

**Goals**

1. A new **Hand Drum** tab in CaptainPad: a model "skin" you tap (multi-touch)
   to fire localized light bursts on the real rig + sim, feeling instantaneous.
2. **APC mini mk2** is a first-class drummer: the 8×8 pads are a spatial grid
   over the skin, pad velocity is hit intensity, the 9 faders are the live
   macros (**size / speed / hue / intensity / master** + spares), and pads
   **light up (LED)** as their hit decays — a tactile echo.
3. **Kits**: pick a "drum kit" (a named set of voices) the way you pick a
   pattern. A voice (v1) = color + envelope + radius + blend, applied as a
   **weighted `dropHit`**. Kits are **data** (YAML in the repo), authored
   offline, validated at load.
4. Exactly **one** new engine concept (the Spatial Impulse) and **one** new
   transport message (`drumHit` on the existing `/ws/control` socket). No new
   port, no new daemon, no change to the pixel/DMX/sACN tail.
5. **Polyphonic, fire-and-forget, never stuck**: any number of simultaneous
   taps; every voice ages out by its own envelope. Panic/clear is one tap.
6. Fully **playa/offline-compliant** and **fail-loud** (codex P0): unknown
   kit/voice/effect → throw at load, never a silent no-op.

**Non-Goals (v1)**

- **No sequencer / no recording / no looping.** Hand Drum is *live* only.
  Record-and-loop is the obvious v2 and gets its own doc.
- **No new pixel math beyond the spatial weight** — we do not add new blend
  modes, new effect families, or per-pixel shaders. **A v1 voice is a weighted
  `dropHit`, period.** Flavoring a voice onto other library effects
  (`uvBlast`/`colorWash`/…) is explicitly **v2** (§6). Note a weighted
  `dropHit` already drives the **U (UV)** and **W/A** channels via `color6`,
  so a "UV stab" voice needs no new effect — just `color6 = [0,0,0,0,0,1]`.
- **No true 3D picking.** v1 maps taps onto a **2D front-elevation skin**
  using `nx, ny` (which every model exports). Side/top skins and camera-true
  3D raypick are v2 (§9).
- **No bespoke MIDI stack.** Hand Drum *consumes* the transport, mapping, and
  LED-feedback layers from **docs/34**; if that ships, this is a new mapping
  profile + action kind, not a new native module.
- **No engine-side kit authoring UI.** Kits are YAML; a tap-to-edit kit
  builder is a v2 candidate.

---

## 3. Architecture

Three pieces, each minimal, each reusing what exists:

```
┌─────────────────────────── CaptainPad ────────────────────────────┐
│ A. app/(tabs)/hand_drum.tsx        the tab (skin + kit picker +     │
│                                    macro faders + panic)           │
│ B. utils/drum/                     skin projection (u,v→originN),   │
│    ├ skin_projection.ts            kit loader/validator (YAML),     │
│    ├ kit.ts (+ kits/*.yaml)        voice resolution, hit throttle   │
│    └ drum_transport.ts             ws "drumHit" sender (coalesced   │
│                                    only for continuous macros)     │
│ C. hooks/useHandDrum.ts            tab lifecycle; subscribes APC    │
│                                    (docs/34) when present; LED echo │
└──────────────────────────────────┬─────────────────────────────────┘
                                    │ ws { type:'drumHit', ... }
┌──────────────────────────────────▼─────────────────────────────────┐
│ MarsinEngine                                                        │
│ D. api_server.js  /ws/control handler: + case d.type==='drumHit'    │
│                   (try/catch → drumError frame, never crashes loop) │
│ E. lib/hand_drum.js   resolve kit+voice + scale by live macros →    │
│                       SpatialImpulse                                │
│ F. global_effects_controller.js  + spatialImpulses[] list +         │
│                       triggerSpatialImpulse() + per-frame apply     │
│                       (reuses effects/dropHit.js math)              │
└──────────────────────────────────────────────────────────────────┘
```

### A. The tab — `app/(tabs)/hand_drum.tsx`

A new `Tabs.Screen` registered in `app/(tabs)/_layout.tsx`
(`tabBarIconName: 'hand.tap.fill'` or `'music.note'`), following the exact
pattern of the existing tabs. Layout:

- **The skin** (the big surface): a flattened front view of the model — the
  same fixtures the operator sees in the sim, laid out by `(nx, ny)`. Rendered
  as touchable dots/zones over a hull silhouette. A tap (or drag) yields
  `(u, v)` in `[0..1]²`. **Multi-touch**: React Native's `PanResponder` /
  `GestureHandler` gives all active touches; each touch-down is one hit, each
  active finger that crosses a new zone can re-trigger (configurable
  "re-hit on move" toggle, default off so a held finger = one hit).
- **Kit picker**: a horizontal strip of kits (from `kits/*.yaml`); within a
  kit, the voice is chosen by **where you tap** (each kit maps skin regions →
  voices) *or* a single-voice kit plays one voice everywhere. Default kits
  ship in the repo (§6).
- **Macro faders** (on-screen, mirror the APC faders): **Size**, **Speed**,
  **Hue**, **Intensity**, **Master** (the separate **`drumMaster`** additive
  level — see §Master semantics in §5). These are *live performance scalars*
  applied on top of the kit's voice values (a voice defines a *base* radius;
  the Size fader scales it 0.25×–2×, etc.). On-screen faders reuse
  `components/NauticalFader.tsx`.
- **Panic / Clear**: one button → `POST /global-effect-macros/panic-stop`
  (exists) plus a local "drop all impulses" so a runaway finger never sticks.

The skin **subscribes to the live sim view** only for layout aesthetics; it
does not need the WS viz feed. It does poll `/list-patterns`-style metadata
once (kit list) on mount.

### B. `utils/drum/` — pure TS, unit-testable, no hardware

- **`skin_projection.ts`** — `project(u, v) → originN[2]`. v1: identity-ish
  map from the front-elevation layout to `(nx, ny)` (the skin *is* the
  `nx/ny` plane), with per-model calibration (insets so edge taps still
  resolve). Pure function → trivially testable; this is also where a future
  side/top/3D projection slots in behind the same signature.
- **`kit.ts` + `kits/*.yaml`** — kit/voice schema, loader (via the existing
  `yaml-transformer.js` bundling path, same as `config.yaml` and the MIDI
  profiles), and a **validator that throws at load** on unknown effect id,
  out-of-range envelope, a color that isn't a 6-tuple, a **non-finite `gain`
  after defaults** (every voice must end up with a finite `gain`; the bundled
  default is `1.0`), a `groups:` entry naming a group absent from the model, or
  a region that doesn't cover `[0..1]²`. No partial kits (codex P0).
- **`drum_transport.ts`** — sends `{ type:'drumHit', u, v, kitId, voice,
  intensity, hitId, ts }` over the **existing control-plane socket** via
  `engineEvents.send(...)` (which owns the iPad's one connection to
  **`/ws/control`** — the socket that already accepts inbound `setControl` /
  `setSharedParam`). Hits are **discrete and dispatched immediately** (a drum
  that throttles taps is not a drum). The **continuous macro faders** coalesce
  (~30 Hz trailing, exactly like docs/34) and ride the **same** socket as
  `engineEvents.send({ type:'setSharedParam', key, value })` — i.e. the CPC
  write path, because size/speed/hue/master are engine-side state read at
  trigger time, not per-hit payload. (We do **not** write through
  `engineParamsEvents` / `/ws/params`: that bus has no inbound writer — it is
  the read-side params firehose. All Hand Drum writes go over `/ws/control`.)

### C. `hooks/useHandDrum.ts`

Mounted by the tab. Owns: current kit, macro fader values (mirrored to CPC),
and — **if docs/34's `useMidiControl` is present** — the APC binding for the
drum profile (§5), including the **LED echo**: when a hit fires, light its pad
in the voice's color and fade it on the envelope's release, so the grid
visibly "rings." With no APC attached the tab is fully touch-playable; the
hook reports `apc: connected|absent|error` for a header chip (reusing docs/34's
chip styling).

### D. Engine transport — `api_server.js`

One new branch in the `/ws/control` message handler (alongside `setControl`,
`setSharedParam`, …). Two rules from the expert pass:

1. **Wiring is a boot-time invariant, not a per-message check.** If Hand Drum
   is *enabled* in config but `handDrum` failed to construct, the **engine
   fails loudly at boot** — never a silent `return` on every hit. By the time
   a `drumHit` arrives, `handDrum` is guaranteed present.
2. **A malformed runtime `drumHit` must never crash the render loop.** The
   branch wraps the hit in try/catch and replies to *the sender* with a
   `drumError` frame; the frame loop is untouched.

```js
} else if (d.type === 'drumHit') {
  // d = { type, u, v, kitId, voice, intensity, hitId, ts }
  // handDrum is guaranteed non-null here (boot invariant, see engine.js).
  try {
    handDrum.hit(
      { u: d.u, v: d.v, kitId: d.kitId, voice: d.voice, intensity: d.intensity },
      performance.now(),
    );
  } catch (err) {
    // Logged + sent back to the sender; render loop never sees it.
    console.error('[HandDrum] drumHit failed:', err);
    ws.send(JSON.stringify({
      type: 'drumError',
      code: err.code || 'DRUM_HIT_FAILED',   // e.g. UNKNOWN_KIT | UNKNOWN_VOICE | BAD_HIT
      message: String(err.message || err),
      hitId: d.hitId,                          // echoed so the client can correlate
    }));
  }
}
```

And in `engine.js` boot, the loud invariant:

```js
if (config.handDrum?.enabled && !handDrum) {
  throw new Error('Hand Drum enabled but HandDrum failed to initialize'); // codex P0: fail loud
}
```

WS, not REST: a single tap is ~80 bytes and must feel instant; REST per-tap
would add a connection/round-trip tax the drummer can feel. The `/ws/control`
socket is already open and already carries `setControl`/`setSharedParam` at
performance rates.

### E. `lib/hand_drum.js` — kit registry + voice resolution

**Multi-client decision (expert pass):** rather than a single global "active
kit" that two surfaces fight over, `HandDrum` holds a **kit registry** (all
validated kits, loaded at boot + via `POST /hand-drum/kit`) and **every
`drumHit` names its `kitId`**. Two iPads (or an iPad + the APC) can play
different kits simultaneously with no shared mutable selection — the FoH iPad
on `full_hull`, a roaming iPad on `bow_kit`, both summing additively. An
unknown `kitId` is a server-side `drumError` (`UNKNOWN_KIT`), not a guess.
(The client still tracks *its own* selected kit for UI/LED feedback; that is
purely local.)

`HandDrum` reads the live **macro scalars** from the CPC. They are registered
in the param schema like any global param (see
`.agent/01_skills/04_add_new_global_param.md`) with **explicit, clamped ranges
so the math is always safe** — in particular `drumSpeed` can never be `0`, so
the `÷ drumSpeed` below cannot divide by zero:

| CPC key | Range | Default | Role |
|---|---|---|---|
| `drumSize` | `[0.25, 2.0]` | `1.0` | radius multiplier (Size fader) |
| `drumSpeed` | `[0.25, 4.0]` | `1.0` | envelope time **divisor** — bigger = snappier. **Never 0** (clamped) |
| `drumHue` | `[0.0, 1.0]` | `0.0` | hue rotation (0→1 = 0→360°), RGB only |
| `drumIntensity` | `[0.0, 1.0]` | `1.0` | per-bank intensity trim (baked at trigger) |
| `drumMaster` | `[0.0, 1.0]` | `1.0` | **live** drum-layer level (applied per frame) |

The on-screen / APC faders are `0..1`; the UI maps them onto these ranges
(e.g. fader `0..1` → `drumSpeed 0.25..4.0`) before the CPC write, so a `0`
fader is a safe `0.25×`, not a divide-by-zero.

On `hit({ kitId, voice, u, v, intensity })` it:

1. `kit = registry.get(kitId)` → throws `UNKNOWN_KIT` if absent.
2. `originN = projection.project(u, v)` (engine mirrors the same projection so
   client and engine agree; projection table ships in the scene sidecar).
3. `voice = kit.resolve(originN, voice)` → base color/env/radius/blend +
   filters (`groups` / `nyBand` / `zBand`); throws `UNKNOWN_VOICE` if the
   named/region voice isn't in the kit.
4. Build the impulse: `radiusN = voice.radiusN · drumSize`, envelope `÷
   drumSpeed`, hue-rotate `color6` by `drumHue`, and **`baseIntensity =
   clamp01(velocity · voice.gain · drumIntensity)`** — note **`drumMaster` is
   not folded in here**; it is read fresh each frame and multiplied in
   `applySpatialImpulse`, so the layer fader is genuinely live.
5. `controller.triggerSpatialImpulse(impulse, nowMs)`.

**`POST /hand-drum/kit` — kit registry management (not selection).** Selection
is purely client-local (each hit carries `kitId`), so this endpoint does *not*
pick an "active" kit. Starter kits are **bundled and loaded into the registry
at engine boot**; the endpoint exists to **register/replace** a kit's YAML in
the running registry (operator authoring + dev hot-reload), validated
server-side. Contract:

- `POST /hand-drum/kit` body = one kit (YAML or JSON) → validate → upsert into
  `registry[kit.id]`; `200` with the parsed kit, or `400` with the validation
  error (same validator as boot — no partial kits).
- `GET /hand-drum/kits` → the registry's kit ids (for a client that wants to
  list without bundling). No delete in v1 (registry is additive per run; a
  restart reloads the bundled set).

### F. `global_effects_controller.js` — the only pixel-loop change

```js
triggerSpatialImpulse(impulse, nowMs) {
  const durationMs = dropHitEffect.envelopeDurationMs(impulse);   // reuse
  this.spatialImpulses.push({ impulse, triggeredAtMs: nowMs, durationMs });
}

// in the per-frame apply (applyMacros), next to the existing dropHits loop.
// `drumMaster` is read FRESH each frame (passed in from engine.js' CPC read),
// so moving Fader 9 rides already-live impulses up and down:
const masterGain = drumMaster;        // 0..1, live; 1.0 when Hand Drum absent
for (const s of this.spatialImpulses) {
  const env = dropHitEffect.envelopeValue({
    elapsedMs: nowMs - s.triggeredAtMs,
    attackMs: s.impulse.attackMs, holdMs: s.impulse.holdMs, releaseMs: s.impulse.releaseMs,
  });
  if (env <= 0) continue;
  applySpatialImpulse({ pixels, impulse: s.impulse, env, masterGain }); // baseIntensity·masterGain·weight
}
this.spatialImpulses = this.spatialImpulses.filter(s => nowMs - s.triggeredAtMs <= s.durationMs);
```

`drumMaster` reaches the loop as a new `applyMacros(... , drumMaster)` argument
that `engine.js` fills from `paramCenter.get('drumMaster')` each frame
(defaulting to `1.0` when Hand Drum is disabled). `applySpatialImpulse` lives
in a generalized **`effects/spatial_impulse.js`** that reuses `dropHit`'s
per-pixel math and adds the distance-weight + filter terms. The hot loop is
O(pixels × live-impulses); our models are ≤ a few thousand pixels and live
impulses decay in < 1 s, so even aggressive drumming stays well inside the
25 ms frame budget. (Bench gate in §8 proves it.)

---

## 4. The skin — mapping a tap to a place on the ship

v1 uses the **front elevation** because every model already exports `nx, ny`
(normalized in `[0..1]`) and the front is the mission-critical face. The skin
is literally the `nx`(x) × `ny`(y) unit square; the tab draws each fixture at
`(nx, 1-ny)` (screen y is flipped) over a hull outline so the operator taps
*the ship*, not an abstract grid.

- **Radius is in skin units**: `radiusN = 0.15` covers ~a third of the width.
  The Size fader scales it; a tiny radius = a pinpoint fixture poke, a large
  radius = a hull-wide swell.
- **Falloff** softens the rim so neighboring fixtures glow, not a hard circle
  — reads as a drum *hit* with body, not a spotlight.
- **Named-group filtering (`groups`) — preferred for "a thing on the ship".**
  A voice may restrict to named model `group`s (`groups: ['Left Top Chimney
  Generator', 'Right Top Chimney Generator']`) so a "stack" voice lights the
  *actual chimney fixtures* regardless of their `ny`. This is robust against
  re-export geometry shifts and is the recommended way to target structures.
- **Vertical filtering (`nyBand`)**: a voice may instead opt into an `ny` band
  (`nyBand: [min,max]`). **Bands must be measured from the export, not
  guessed** — on `titanic` the chimneys sit at `ny ≈ 0.44–0.66`, so a generic
  `[0.7, 1.0]` would light *nothing*. Use `groups` when you mean a structure;
  use `nyBand` only for genuinely band-shaped intent with measured numbers.
- **Depth (`nz`) is ignored in v1's distance term** (2D skin). It is available
  only as an optional **`zBand: [min,max]`** front/back **depth** filter (e.g.
  a voice that lights just the front face). Vertical = `nyBand`, depth =
  `zBand`, structure = `groups` — don't conflate them.
- **Per-model calibration** lives in a model sidecar (next to
  `*.viewmasks.js`): the front-skin bounds + optional named regions for
  region→voice kits. Authored once per scene; validated at load.

**Why front-only is enough for BM26:** the operator faces the ship; the front
is what the crowd sees; `nyBand` covers the "tap high vs low" gesture. Camera-
true 3D picking (tap the sim's current view, raycast to fixtures) is a clean
v2 that reuses the sim's existing picking — noted, not built (§9).

---

## 5. APC mini mk2 as a drum (consumes docs/34)

Hand Drum is the **flagship use case** for the direct-MIDI work in docs/34 and
needs nothing from it beyond a new **mapping profile** and one new
`action.kind`. The APC mini mk2's layout maps beautifully:

| APC control | Hand Drum role |
|---|---|
| **8×8 pad grid** | A spatial grid over the skin. Pad `(row, col)` → skin `(u, v)` = cell center. Pressing a pad fires that cell's voice. Top rows = high `ny`, bottom rows = waterline. (Structure-targeted voices like "stack" use `groups`, not pad position — chimneys sit mid-`ny`.) |
| **Pad velocity** | Hit **intensity** (the mk2 pads are velocity-sensitive). Soft tap = gentle glow, hard hit = punch. |
| **Pad LED** | **Echo**: the pad lights in the voice color on hit and fades on the envelope's release — the grid pulses with your playing. |
| **Faders 1–8** | The live macros: F1 **Size**, F2 **Speed**, F3 **Hue**, F4 **Intensity**, F5–F7 spare (e.g. per-bank), F8 reserved. |
| **Fader 9** | **`drumMaster`** — the Hand Drum additive level (see below). **Not** the global/mixer master, unless explicitly reassigned in a later profile. |
| **Scene/track buttons** | **Kit select** (bank of kits) + **Panic/Clear**. |

The profile is just another docs/34 YAML, with one new `action.kind: drumPad`
whose handler calls `drum_transport.drumHit(u, v, kitId, voice, intensity)`
(the `kitId` is the client's locally-selected kit) instead of an `api.ts` REST
function. Everything else — transport selection
(CoreMIDI on iPad / Web MIDI on desktop Chromium for agent-driven HIL tests),
endpoint pinning, hotplug, fail-loud chip — is **inherited unchanged** from
docs/34. The 8×8 → `(u,v)` map and velocity→intensity curve live in the
profile so they are data, not code.

> **Dependency note:** if docs/34 hasn't shipped when Hand Drum starts, the
> tab is still fully deliverable touch-only (Ring 1/2 below); the APC simply
> reports `absent`. The two docs are independently landable; Hand Drum is the
> reason to prioritize docs/34.

### Master semantics — `drumMaster` is a separate additive level

Hand Drum is its **own additive layer**, not folded into the global/mixer
master. It has a dedicated CPC param **`drumMaster`** (0..1) so the operator
can drum *over* a dark/dim **deck pattern** — a great look — and ride the whole
drum layer up/down independently of the show. (This is layering over a quiet
*pattern*, not an escape from **global blackout**, which still silences the
drum layer — see below.)

- **Per-frame amount** for a pixel is
  `clamp01(baseIntensity · drumMaster) · envelope · weight`, where
  `baseIntensity = clamp01(velocity · voice.gain · drumIntensity)` is fixed at
  trigger and **`drumMaster` is read fresh every frame** (§3.E/§3.F). That
  split is the point: `drumMaster` is a genuine **live layer fader** — sliding
  Fader 9  for a swell rides *already-ringing* impulses up and down, not just
  the next hit. (Baking it at trigger would freeze each impulse at its launch
  level — the bug the re-review caught.)
- **`drumMaster` still obeys global blackout and panic-stop.** The spatial
  impulses are applied inside `GlobalEffectsController` *above* the existing
  dimmer/blackout pipeline, so global blackout zeroes them and **Panic/Clear**
  drops `spatialImpulses[]` outright (§7). `drumMaster` is a *layer* level, not
  an escape hatch around safety.

---

## 6. Kits & voices (the "special patterns / signals" you pick)

A **kit** is a YAML file bundled like the MIDI profiles. A **voice** is one
drum sound expressed in light. Example:

```yaml
# CaptainPad/utils/drum/kits/bow_kit.yaml
id: bow_kit
name: "Bow & Stacks"
defaults:        # applied to every voice unless overridden
  falloff: gaussian
  blend: add
  gain: 1.0        # per-voice intensity balance; REQUIRED post-default & finite
  attackMs: 8
  holdMs: 40
  releaseMs: 320
regions:         # region → voice. vBand = TAP location in skin-v (where your
                 # finger is), NOT a pixel filter. Picks which voice fires.
  - { name: low,   vBand: [0.00, 0.45], voice: kick }
  - { name: mid,   vBand: [0.45, 0.75], voice: tom  }
  - { name: high,  vBand: [0.75, 1.00], voice: stack }
voices:
  kick:
    color6: [1, 0.15, 0.0, 0, 0, 0]    # warm amber punch
    radiusN: 0.28
    releaseMs: 450
  tom:
    color6: [0.0, 0.7, 1.0, 0, 0, 0]   # cyan
    radiusN: 0.18
  stack:                               # target the ACTUAL chimney fixtures
    color6: [1, 1, 1, 0.6, 0, 0]       # white + warm-white, tight & fast
    radiusN: 0.12
    holdMs: 10
    releaseMs: 160
    groups: ['Left Top Chimney Generator', 'Right Top Chimney Generator']
```

> **Two different coordinate spaces — don't conflate them:**
> - **Region `vBand`** is **tap space** (skin-v, *where your finger is*). It
>   selects *which voice* fires. It is **not** a pixel filter.
> - **Voice `groups` / `nyBand` / `zBand`** are **pixel-space filters** on the
>   model: `groups` = named model `group`s (**preferred** for structures like
>   the chimneys — robust against re-export), `nyBand` = vertical `ny` band
>   (**use measured numbers** — on `titanic` the chimneys are `ny ≈ 0.44–0.66`,
>   so a guessed `[0.7,1]` lights nothing), `zBand` = front/back depth on `nz`.
> The `stack` voice above uses `groups` precisely so it hits the chimneys
> wherever they actually are, instead of a brittle band guess.

- **"Choosing a special pattern (signals)"** = choosing a kit. Within a kit,
  the *place you tap* selects the voice (regions) — exactly the user's "based
  on the location of the tapped fingers it instantiates those signals."
- **Group names are validated against the loaded model at kit-load** — a
  `groups:` entry naming a group not present in the export is a loud
  `UNKNOWN_GROUP` kit-load error (catches the chimney-rename trap from §0
  cleanup item 3), not a voice that silently lights nothing.
- **v1 voices are weighted `dropHit` only.** A UV stab needs no special effect
  — set `color6 = [0,0,0,0,0,1]` and the dropHit drives the U channel.
- **(v2)** Flavoring a voice onto another library effect (`effect: uvBlast`,
  `effect: colorWash`, mapped to docs/28) is a deliberate **v2** extension
  (§9). The schema leaves room for an `effect:` field but v1 rejects any value
  other than the implicit `dropHit` at kit-load (fail loud, no half-support).
- Ship **2–3 starter kits** (`bow_kit`, `full_hull`, `uv_ghost` — the latter a
  UV-channel dropHit, not a `uvBlast` flavor) so the tab is fun out of the box.
  Authoring more is a YAML PR, not code.

---

## 7. Failure modes — fail loudly, everywhere (codex P0)

All runtime `drumHit` failures share one shape: **log + a `drumError` frame
to the sender**, and the **render loop is never touched**. The frame is
`{ type: 'drumError', code, message, hitId? }` where `code` ∈
`UNKNOWN_KIT | UNKNOWN_VOICE | BAD_HIT | …` and `hitId` echoes the client's
hit id for correlation.

| Condition | When | Surfaced as |
|---|---|---|
| **Hand Drum enabled but `HandDrum` not wired** | boot | **Engine throws at startup** (codex P0). Not a per-message `return`. |
| **Exported model missing finite `nx/ny/nz`** on any controllable pixel | boot | `HandDrum` validator **throws at startup** listing the offending pixels (§0). No skip-the-pixel fallback. |
| Kit YAML invalid (bad color tuple, region gap, env < 0, `effect:` ≠ dropHit in v1, **`groups:` naming an absent model group → `UNKNOWN_GROUP`**) | load | **Throws at kit load** with the offending kit path. No partial kit. |
| Macro CPC key missing from schema (`drumSize/Speed/Hue/Intensity/Master`) | boot | Engine boot-time schema validation fails (same as every global param). |
| `drumHit` names an unknown `kitId` | runtime | `drumError` `UNKNOWN_KIT` to sender; logged. Render loop untouched. |
| `drumHit` resolves no voice (unknown name / no region) | runtime | `drumError` `UNKNOWN_VOICE` to sender; logged. |
| Malformed `drumHit` (missing/`NaN` `u/v`, out-of-range, bad payload) | runtime | `drumError` `BAD_HIT` to sender; logged. **Never** queued into `spatialImpulses[]`. |
| Runaway / stuck finger | runtime | Impulses are fire-and-forget and self-expire; **Panic/Clear** drops `spatialImpulses[]` and calls the existing panic-stop. No voice can outlive its envelope. |
| Global blackout active while drumming | runtime | `drumMaster` layer is zeroed by the existing blackout pipeline — drumming is silent but does not error. |
| APC profile endpoint mismatch | runtime | Inherited docs/34 behavior: red chip naming the endpoints found, no auto-pick. |
| Frame budget exceeded under heavy drumming | runtime | Bench-gated (§8); if ever real, cap concurrent impulses (oldest-drops) — a *loud* cap surfaced in the tab, not a silent throttle. |

---

## 8. Verification & development rings

Mirrors docs/34's Windows-first, Mac-last topology — Hand Drum is even easier
because the core is **engine-side and pure-function testable**.

**Required tests/checks (expert pass) — each maps to a contract above:**

| Check | Asserts | Where |
|---|---|---|
| Spatial impulse **weight + envelope expiry** | weight peaks at `originN`, →0 past `radiusN`; impulse is removed once `elapsed ≥ durationMs` (no leak) | `effects/spatial_impulse.js` + `global_effects_controller` unit test |
| **`nyBand` / `zBand` filtering** | `nyBand:[a,b]` lights only `ny∈[a,b]`; `zBand` filters `nz`; filters compose (AND) | `spatial_impulse` unit test |
| **`groups` filtering** | a voice with `groups:['…Chimney…']` lights only pixels whose `px.group` is in the set; a kit naming an absent group fails kit-load (`UNKNOWN_GROUP`) | `spatial_impulse` + kit-validator tests |
| **`drumMaster` is live** | moving `drumMaster` between frames changes the per-frame `amount` of an **already-ringing** impulse (not just new hits) | `global_effects_controller` unit test (two frames, different master) |
| **`drumSpeed` never divides by zero** | CPC clamps `drumSpeed` into `[0.25,4.0]`; envelope timing stays finite at the fader extremes | `hand_drum` + param-schema test |
| **Missing `nx/ny/nz` fails validation** | the `HandDrum` boot validator **throws** on a model with a non-finite/out-of-range coord on a controllable pixel (§0) | `hand_drum` validator unit test (synthetic bad model) |
| **Runtime `drumHit` error → `drumError`, no crash** | unknown kit/voice and malformed payload each produce a `drumError{code,…}` frame and the engine keeps rendering (frame counter advances). (Unknown **group** is a kit-load failure, not runtime — see the kit-validator row.) | `api_server` / `hand_drum` test (mock ws) |
| **Panic-stop clears `spatialImpulses`** | after `panicStop()` / `POST /global-effect-macros/panic-stop`, `spatialImpulses.length === 0` | `global_effects_controller` unit test |
| **Frame budget under realistic drumming** | N hits/s (e.g. 8/s, ~0.5 s envelopes) on the **`titanic`** model keeps `applyMacros` frame time < 25 ms @ 40 fps | bench script (Ring 1) |

- **Engine unit tests** (no hardware, no iPad): the table's `spatial_impulse`,
  `hand_drum`, and `global_effects_controller` rows; voice resolution + macro
  scaling (`baseIntensity = velocity·gain·drumIntensity` baked at trigger,
  `drumMaster` applied live per frame). Runs in CI like the rest of
  `marsin_engine/tests/`.
- **Pure-TS tests**: `skin_projection` round-trips, kit loader/validator
  throw cases (incl. `effect:` ≠ dropHit rejected in v1).
- **Ring 1 — full-stack smoke on one box** (`.agent/01_skills/05_full_stack_smoke.md`):
  CaptainPad web build → engine → sim. Drive the skin with puppeteer taps (or
  APC over **Web MIDI** in desktop Chrome), assert via the sim screenshot
  skill (`.agent/01_skills/00_see_the_world.md`) that the *right region* lights
  and decays. **Frame-budget bench**: script N hits/sec, assert engine frame
  time stays < 25 ms @ 40 fps.
- **Ring 2 — iPad over Expo (LAN)**: real multi-touch on the dev client, APC
  into the iPad via CoreMIDI (docs/34 native transport). Verify LED echo and
  latency feel.
- **Auto-checks**: CaptainPad suite (`tsc --noEmit`, lint, `web:build` —
  `.agent/00_gol/03_captain_pad_auto_checks.md`) + engine auto-checks
  (`.agent/00_gol/05_*`). Visually inspect PNGs before claiming done.

**Offline**: WS + bundled YAML + browser/CoreMIDI built-ins. No CDN, no
runtime install. Playa-compliant by construction.

---

## 9. Implementation plan

Each phase is independently landable; the tab is usable (touch-only) at the
end of phase 3.

| Phase | Scope | Files |
|---|---|---|
| 0. **Prerequisite — Titanic scene cleanup** | Stable logical IDs/view masks for LED strands; one canonical traces source (or prove single-loader); standardize generator/group names; re-export so `titanic.js` has finite `nx/ny/nz` on every controllable pixel (§0). Bench rig is `test_bench` until done. | `simulation/scenes/titanic/*`, model export, tracker task |
| 1. **Engine primitive** | `effects/spatial_impulse.js` (weight × `applyToPixel`, `nyBand`/`zBand` filters); `spatialImpulses[]` + `triggerSpatialImpulse` + per-frame apply + `panicStop` clear in `global_effects_controller.js`; unit tests. Pure engine, no UI. | `marsin_engine/effects/spatial_impulse.js`, `lib/global_effects_controller.js`, tests |
| 2. **Voice/kit + transport** | `lib/hand_drum.js` (model-coord boot validator, kit **registry**, voice resolve, macro scaling incl. `drumMaster`); `drumSize/Speed/Hue/Intensity/Master` CPC params; `drumHit` branch on `/ws/control` with try/catch → `drumError`; boot wiring invariant; `POST /hand-drum/kit`; starter kits. | `marsin_engine/lib/hand_drum.js`, `lib/api_server.js`, `engine.js`, param schema, `CaptainPad/utils/drum/kits/*.yaml` |
| 3. **CaptainPad tab (touch)** | `app/(tabs)/hand_drum.tsx` + `_layout.tsx` entry; `utils/drum/{skin_projection,kit,drum_transport}.ts` (hits via `engineEvents.send` on `/ws/control`, `kitId` per hit); `hooks/useHandDrum.ts`; macro faders; panic; `drumError` handling. **Full Ring-1 HIL pass** (puppeteer taps → sim). | CaptainPad tab + utils + hook |
| 4. **APC drum profile** | docs/34 profile `apc_mini_mk2_drum.yaml` + `action.kind: drumPad`; Fader 9 → `drumMaster`; LED echo in `useHandDrum`. Ring-1 (Web MIDI) then Ring-2 (iPad CoreMIDI). | `CaptainPad/midi_profiles/*`, hook |
| 5. **(v2)** | `effect:` voice flavor (`uvBlast`/`colorWash`/…); 3D camera-true pick (reuse sim picking); side/top skins; voice→signal-bus publish so patterns react to drumming; record/loop sequencer (own doc); tap-to-edit kit builder. | — |

---

## 10. Open questions (for Sina)

1. **Skin v1 — front elevation OK?** Front-only with `nyBand` voices covers
   "tap high vs low" (vertical filtering on `ny`; `zBand`/`nz` reserved for
   front/back depth). Or do you want the tab to mirror the **sim's current
   camera** (tap what you see) from day one? (That's the v2 3D pick; bigger.)
2. **Tap-where vs pick-voice.** Two kit styles: *regions* (where you tap picks
   the voice — most "instrument"-like) and *single voice everywhere* (the kit
   is one sound, place only sets position). Ship both, default to regions?
3. **Re-hit on drag** — should a finger dragged across the skin re-trigger as
   it crosses zones (expressive, busy) or fire once on touch-down (clean)?
   Proposed default: once on down, with a per-kit `retrigger: true` opt-in.
4. **APC 8×8 → skin mapping** — pads as an even 8×8 grid over the front skin,
   or pinned to *named fixture clusters* (bow/mid/stern × waterline/deck/stack)
   so each pad is "a thing on the ship," not a coordinate? Clusters read more
   musical but need per-scene authoring.
5. **Master interaction** — ✅ **resolved (expert pass): separate, *live*
   additive level.** Hand Drum has its own `drumMaster`: per-frame amount =
   `clamp01(baseIntensity · drumMaster) · envelope · weight` with
   `baseIntensity = clamp01(velocity·voice.gain·drumIntensity)` fixed at
   trigger and `drumMaster` applied live each frame (so Fader 9 rides ringing
   impulses). Still subject to global blackout + panic-stop; APC Fader 9 drives
   it. Left here only to confirm you're happy with that call.
6. **Welcoming mode** — do we want a "guest" lockdown (kit + master fixed,
   only the skin live) so an alien can safely play without touching the show?
   Cheap to add given Guided Access is already at FoH.

---

# Addendum (2026-06-14) — usage context + reference code

> Added for a **cold review**: this addendum gives a reviewer with no prior
> context (a) *how Hand Drum actually gets used on the Titanic* and (b)
> concrete code sketches pinned to the **real** signatures in the repo so the
> design can be judged against what exists, not hand-waving. Nothing here is
> built yet; line/symbol references are to `main` as of this commit.

## A. How Hand Drum is used on the Titanic

Hand Drum is the **welcoming / kind / fun** corner of the mission (codex
goals 4–6). It does not replace the show — the Deck pattern and Mixer keep
running — it is an **additive light layer** the operator (or a guest) plays
*on top of* whatever is on, fired from CaptainPad's new tab and/or the APC
mini mk2. Six concrete ways it earns its place across a night:

1. **FoH accents on the beat.** The Deck is running `08_ocean_liner` at a low
   wash. The operator, iPad in hand, taps the hull on the downbeat — amber
   bow punches that ride *with* the music without reprogramming anything. This
   is the everyday use: expressive accents over an autopilot show.

2. **Mission-critical "make the ship pop."** From across the playa the
   Titanic must read at night (goal 1). A wide-radius white/warm-white voice
   (`full_hull` kit) drummed in a slow 4-on-the-floor turns the whole
   exterior into a beacon that *breathes* — far more eye-catching than a
   static wash, and it costs the operator four taps a bar.

3. **Smokestack barks.** A `stack` voice scoped to the chimney `groups`
   (`Left/Right Top Chimney Generator`) lights only those fixtures regardless
   of horizontal tap position — so a hard hit makes the stacks *bark* over the
   hull. Targeting by named group (not a guessed `ny` band — the chimneys sit
   mid-`ny ≈ 0.44–0.66`) is what makes this robust.

4. **Welcoming a stranger (guest mode).** Hand the iPad to an alien walking
   up. In guest lockdown (Q6: kit + master pinned, only the skin live) they
   tap the hull and **the part of the ship they touch lights up under their
   finger.** No way to break the show; instant "I made the Titanic do that."
   This is the single most on-mission use — interactive, kind, fun.

5. **Playing with the camp's drums.** Burning Man camps drum. With the APC
   mini mk2 on a powered hub at FoH (docs/34), a person plays the ship's light
   *as percussion* alongside live hand-drums — the 8×8 grid is the kit, pad
   velocity is how hard the light hits, and the pads **glow back** (LED echo)
   so it feels like an instrument, not a remote.

6. **Two-surface jam.** FoH iPad does broad hull swells while a roaming iPad
   (or the APC) does tight stabs — both are just `drumHit`s into the same
   engine, summing additively. Polyphony is free (§1: fire-and-forget
   `spatialImpulses[]`).

**Where it sits in the rig:** Hand Drum writes **only** through the new
spatial-impulse path inside `GlobalEffectsController` (the same controller
that already owns `dropHit`/`strobe`/`colorWash`), so it inherits the
dimmer-aware pixel pipeline, DMX writers, and sACN output unchanged, and it
respects **global blackout / panic-stop** for free. It never touches the
pattern/deck/mixer state — drumming and the programmed show are orthogonal
layers that meet at the pixel buffer.

**Scene scope (BM26):** the show scene is `titanic`
(`marsin_engine/models/titanic.js`); `test_bench` is the bench rig. Both
export `nx/ny/nz`, so the front-elevation skin works on either with only a
per-scene calibration sidecar (§4). Author the Titanic skin bounds + named
regions once; the bench rig is where agents verify without the car.

## B. Reference implementation sketches (pinned to real signatures)

These are **review aids**, not final code. Every external symbol below was
read from the current tree; a reviewer can diff intent against reality.

### B.1 Engine — `effects/spatial_impulse.js` (new)

Reuses `effects/dropHit.js` (`envelopeValue` / `envelopeDurationMs` /
`applyDropHit` are all already exported there). The only new math is the
distance weight. To stay DRY in the hot loop, factor `dropHit`'s per-pixel
blend body into an exported `applyToPixel(px, color6, amount, blendMode)` and
call it from both — avoids the `applyDropHit({ pixels:[px] })` per-pixel array
allocation.

```js
// effects/spatial_impulse.js
import { applyToPixel, envelopeValue, envelopeDurationMs } from './dropHit.js';

export { envelopeValue, envelopeDurationMs }; // controller reuses these

/** Spatial falloff. x = dist / radiusN, so 0 at the tap, 1 at the rim. */
export function spatialWeight(dist, radiusN, falloff) {
  if (radiusN <= 0) return dist === 0 ? 1 : 0;   // pinpoint
  const x = dist / radiusN;
  if (x >= 1) return 0;
  switch (falloff) {
    case 'flat':   return 1;
    case 'linear': return 1 - x;
    case 'gaussian':
    default:       return Math.exp(-4 * x * x);  // ~0.018 at the rim
  }
}

/** Apply one live impulse to the frame's pixels at envelope value `env`.
 *  `baseIntensity` = velocity·gain·drumIntensity (clamped, FIXED at trigger).
 *  `masterGain` = LIVE drumMaster, read fresh each frame (rides ringing hits).
 *  Filters (AND): groups = named model groups; nyBand = vertical on px.ny;
 *  zBand = front/back depth on px.nz. */
export function applySpatialImpulse({ pixels, impulse, env, masterGain = 1 }) {
  const { originN: [ox, oy], radiusN, falloff, color6,
          baseIntensity, blend, groups, nyBand, zBand } = impulse;
  const groupSet = groups ? new Set(groups) : null;   // membership, O(1)
  const amount0 = baseIntensity * masterGain;          // per-frame layer level
  if (amount0 <= 0) return;
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (groupSet && !groupSet.has(px.group))               continue; // structure
    if (nyBand && (px.ny < nyBand[0] || px.ny > nyBand[1])) continue; // vertical
    if (zBand  && (px.nz < zBand[0]  || px.nz > zBand[1]))  continue; // depth
    const d = Math.hypot(px.nx - ox, px.ny - oy);
    const w = spatialWeight(d, radiusN, falloff);
    if (w <= 0) continue;
    applyToPixel(px, color6, env * amount0 * w, blend); // px.r..px.u, RGBWAU
  }
}
```

### B.2 Engine — `global_effects_controller.js` (additions)

Mirrors the existing `dropHits` lifecycle exactly. `dropHits` is declared in
the constructor (`this.dropHits = []`, line 67) and walked in `applyMacros`
(the dropHit loop is lines 287–310). The signature gains the **live**
`drumMaster` (engine.js fills it from `paramCenter.get('drumMaster')` each
frame; `1.0` when Hand Drum is off), passed straight through as `masterGain`:

```js
// constructor, next to this.dropHits = []:
this.spatialImpulses = []; // [{ impulse, triggeredAtMs, durationMs }]

// new method, mirrors triggerDropHit (line 411):
triggerSpatialImpulse(impulse, nowMs) {
  const durationMs = envelopeDurationMs(impulse); // attack+hold+release
  this.spatialImpulses.push({ impulse, triggeredAtMs: nowMs, durationMs });
}

// applyMacros({ pixels, frameIndex, nowMs, drumMaster = 1 }) — directly after
// the dropHits block (~line 310):
if (this.spatialImpulses.length > 0) {
  for (let i = this.spatialImpulses.length - 1; i >= 0; i--) {
    const s = this.spatialImpulses[i];
    const elapsed = nowMs - s.triggeredAtMs;
    if (elapsed >= s.durationMs) { this.spatialImpulses.splice(i, 1); continue; }
    const env = envelopeValue({
      elapsedMs: elapsed,
      attackMs: s.impulse.attackMs, holdMs: s.impulse.holdMs,
      releaseMs: s.impulse.releaseMs,
    });
    applySpatialImpulse({ pixels, impulse: s.impulse, env, masterGain: drumMaster });
  }
}
```

`panicStop()` (line 618) clears `this.spatialImpulses = []` too — the panic
path must drop live drum voices (failure table, §7).

### B.3 Engine — `lib/hand_drum.js` (new) — kit registry + voice resolution

Holds a **kit registry** (not a single active kit — multi-client, §3.E) + the
live macro scalars (read from CPC) and turns a tap into an impulse. Errors
carry a `code` so the WS branch can emit a typed `drumError` (B.4). A custom
`DrumError` keeps the codes in one place; nothing here is swallowed.

```js
class DrumError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export class HandDrum {
  constructor({ controller, projection, paramCenter, model }) {
    this.controller = controller;     // GlobalEffectsController
    this.projection = projection;     // skin (u,v) -> [nx, ny], scene sidecar
    this.paramCenter = paramCenter;   // drumSize/Speed/Hue/Intensity/Master
    this.kits = new Map();            // kitId -> validated Kit
    this._validateModelCoords(model); // §0: throws at boot on bad nx/ny/nz
    // Set of every group name in the export — kit validation checks `groups:`
    // entries against this so an absent group fails loud at kit-load (§6).
    this.knownGroups = new Set(model.pixels.map(px => px.group));
  }

  /** §0 prerequisite — fail loud at boot if any controllable pixel lacks coords. */
  _validateModelCoords(model) {
    const bad = model.pixels.filter(px =>
      ![px.nx, px.ny, px.nz].every(n => Number.isFinite(n) && n >= 0 && n <= 1));
    if (bad.length) {
      throw new Error(`HandDrum: ${bad.length} controllable pixels lack finite nx/ny/nz in [0..1]: ` +
        bad.slice(0, 10).map(p => p.i).join(','));
    }
  }

  // Validate against the loaded model's group set; `validate` throws
  // UNKNOWN_GROUP for any `groups:` naming an absent group, and applies the
  // gain:1.0 default so every voice ends up with a finite gain (§6).
  loadKit(kit) { this.kits.set(kit.id, kit.validate({ knownGroups: this.knownGroups })); }

  hit({ u, v, kitId, voice: voiceId, intensity = 1 }, nowMs) {
    const kit = this.kits.get(kitId);
    if (!kit) throw new DrumError('UNKNOWN_KIT', `no kit '${kitId}'`);
    const originN = this.projection.project(u, v);          // [nx, ny] in 0..1
    const voice = kit.resolve(originN, voiceId);             // throws UNKNOWN_VOICE
    const m = this._macros();                                // size/speed/hue/intensity (NOT master)
    this.controller.triggerSpatialImpulse({
      originN,
      radiusN:   clamp01(voice.radiusN * m.size),
      falloff:   voice.falloff,
      color6:    rotateHue(voice.color6, m.hue),             // RGB hue-rotate, W/A/U pass-through
      attackMs:  voice.attackMs,
      holdMs:    voice.holdMs   / m.speed,                   // m.speed ∈ [0.25,4.0], never 0
      releaseMs: voice.releaseMs / m.speed,
      // FIXED at trigger; drumMaster is applied LIVE per frame (applySpatialImpulse).
      // voice.gain is defaulted to 1.0 at kit-load, but `?? 1` keeps a hand-built
      // voice from ever producing NaN here.
      baseIntensity: clamp01(intensity * (voice.gain ?? 1) * m.intensity),
      blend:     voice.blend,                                // 'add' | 'max' | 'replace'
      groups:    voice.groups || null,                       // named-group filter (preferred)
      nyBand:    voice.nyBand || null,                       // vertical filter (measured)
      zBand:     voice.zBand  || null,                       // depth filter
    }, nowMs);
  }

  // size/speed/hue/intensity only — drumMaster is read by the per-frame loop, not here.
  _macros() {
    const p = this.paramCenter.getAll();
    return { size: p.drumSize, speed: p.drumSpeed, hue: p.drumHue, intensity: p.drumIntensity };
  }
}
```

`drumSize/drumSpeed/drumHue/drumIntensity/drumMaster` are registered in the
param schema with explicit clamped ranges (§3.E table) exactly like every other
global param (follow `.agent/01_skills/04_add_new_global_param.md`); the CPC
clamps/validates/persists/broadcasts them — Hand Drum stores no param state of
its own. The `drumSpeed` range `[0.25, 4.0]` is what guarantees the `/ m.speed`
divisions above are never `/0`. Trigger-time macros (size/speed/hue/intensity)
are baked into the impulse; **`drumMaster` is the one live macro**, read by the
per-frame loop so Fader 9 rides ringing impulses (§3.F).

### B.4 Engine — `lib/api_server.js` WS branch (one `else if`)

Added to the **`/ws/control`** inbound handler — the same `ws.on('message')`
block that already handles `setControl` (api_server.js:3588) and
`setSharedParam` (api_server.js:3714). (`engineEvents` on the client connects
to `/ws/control`; that's the socket with the inbound writer.) WS, not REST — a
tap must feel instant and the socket is already open at performance rates.

`handDrum` is a **boot invariant**, not a per-message guard; the runtime
branch only guards against *malformed hits* and turns them into `drumError`
frames so the render loop is never interrupted.

```js
} else if (d.type === 'drumHit') {
  // d = { type, u, v, kitId, voice, intensity, hitId, ts }
  try {
    handDrum.hit(
      { u: d.u, v: d.v, kitId: d.kitId, voice: d.voice, intensity: d.intensity },
      performance.now(),
    );
  } catch (err) {
    console.error('[HandDrum] drumHit failed:', err);
    ws.send(JSON.stringify({
      type: 'drumError',
      code: err.code || 'BAD_HIT',   // UNKNOWN_KIT | UNKNOWN_VOICE | BAD_HIT
      message: String(err.message || err),
      hitId: d.hitId,
    }));
  }
}
```

The boot invariant lives in `engine.js` (not the message handler):

```js
if (config.handDrum?.enabled && !handDrum) {
  throw new Error('Hand Drum enabled but HandDrum failed to initialize');
}
```

Plus a tiny REST `POST /hand-drum/kit` so the **engine** (not just the client)
validates and registers kits — keeps validation server-side; kits live in the
registry and each `drumHit` names its `kitId` (§3.E).

### B.5 CaptainPad — `utils/drum/drum_transport.ts` (new)

Hits ride the **control-plane** WS via `engineEvents.send(...)` — the singleton
bus that owns the iPad's one connection to **`/ws/control`**
(`CaptainPad/utils/engineEvents.ts:34` `createBus('/ws/control')`; `send`
exported at `engineEvents.ts:40`). We do **not** use `engineParamsEvents`
(`/ws/params`) — that bus has no inbound writer. Discrete hits dispatch
immediately; only the continuous macro faders coalesce and go through the CPC
(`setSharedParam`) on the **same** socket, exactly like docs/34.

```ts
import { engineEvents } from '@/utils/engineEvents';

let hitSeq = 0;

/** Fire one drum voice. Discrete → send now, never throttled (it's a drum). */
export function drumHit(u: number, v: number, kitId: string, voice: string, intensity = 1) {
  engineEvents.send({
    type: 'drumHit', u, v, kitId, voice, intensity,
    hitId: `${Date.now()}-${hitSeq++}`,  // echoed in any drumError
    ts: Date.now(),
  });
}

/** Continuous macro → CPC, ~30 Hz trailing, same /ws/control socket. The UI
 *  maps the 0..1 fader onto each param's CPC range (e.g. drumSpeed 0.25..4.0)
 *  BEFORE the write, so a 0 fader is a safe scale, never a /0 (§3.E). */
export function setDrumMacro(
  key: 'drumSize'|'drumSpeed'|'drumHue'|'drumIntensity'|'drumMaster', value: number) {
  engineEvents.send({ type: 'setSharedParam', key, value, origin: 'handdrum' });
}
```

A `drumError` frame (`{ type:'drumError', code, message, hitId }`) arrives on
the same bus; `useHandDrum` subscribes and surfaces it (e.g. a brief inline
toast keyed by `hitId`) rather than swallowing it.

### B.6 Skin projection — `utils/drum/skin_projection.ts` (new, pure)

```ts
// v1: front elevation. The skin IS the nx/ny plane; calibration insets keep
// edge taps resolvable. Same signature absorbs a future side/top/3D pick.
export type SkinCal = { x0: number; x1: number; y0: number; y1: number };

export function project(u: number, v: number, cal: SkinCal): [number, number] {
  // screen v is top-down; ny is bottom-up → flip v.
  const nx = cal.x0 + u * (cal.x1 - cal.x0);
  const ny = cal.y0 + (1 - v) * (cal.y1 - cal.y0);
  return [clamp01(nx), clamp01(ny)];
}
```

The engine mirrors the **same** projection table (shipped in the scene
sidecar) so client and engine agree on where a tap lands.

## C. Cold-reviewer checklist

A reviewer can sign off by checking these — each is a place the design could be
wrong, not a rubber stamp:

- [ ] **§0 prerequisite enforced**: `HandDrum` boot validator throws on any
  controllable pixel lacking finite `nx/ny/nz` in `[0..1]` — **coordinates
  only**. Titanic naming/traces cleanup is tracked prerequisite work (not
  boot-gated); a kit naming an absent group still fails at **kit-load**.
- [ ] **Spatial primitive is additive-only and reuses `dropHit`** — v1 voices
  are weighted `dropHit` only (no `effect:` flavor), no new blend modes, no
  change below `applyMacros` in the pixel→DMX→sACN tail.
- [ ] **Targeting semantics**: `groups` (named model groups) is the **preferred**
  structure filter; `nyBand` uses **measured** vertical bands (not guessed —
  chimneys are mid-`ny`); `zBand` is depth; region `vBand` is tap-space, a
  different axis. Kits/examples/code agree.
- [ ] **Error model**: enabled-but-unwired → **boot** throw; runtime
  unknown-kit / unknown-voice / malformed hit → `drumError{code,message,hitId}`
  to the sender + log, **render loop never crashes**; panic clears
  `spatialImpulses[]`.
- [ ] **Multi-client**: each `drumHit` carries `kitId` (everywhere on the
  wire), validated against the server kit registry; no shared mutable "active
  kit" two surfaces fight over.
- [ ] **Master is LIVE**: `baseIntensity = clamp01(velocity·voice.gain·
  drumIntensity)` is fixed at trigger; **`drumMaster` is multiplied per frame**
  in `applySpatialImpulse`, so Fader 9 rides already-ringing impulses (not just
  new hits). Still obeys blackout + panic; APC Fader 9 drives it.
- [ ] **Macro semantics + safety**: Size scales radius, Speed divides envelope
  (`÷ drumSpeed`, **`drumSpeed ∈ [0.25,4.0]` so never `/0`**, bigger = snappier),
  Hue rotates RGB only (W/A/U pass through) — all clamped by the CPC; UI maps
  `0..1` faders onto these ranges before the write.
- [ ] **Polyphony bounds**: `spatialImpulses[]` under realistic drumming
  (e.g. 8 hits/s × ~0.5 s ≈ ≤ ~8–12 live) keeps `applyMacros` < 25 ms @ 40 fps
  on `titanic` (§8 bench gate proves it, not assumes it).
- [ ] **Transport**: hits go `engineEvents.send` → `/ws/control` → `drumHit`,
  no REST in the per-tap path; continuous faders (incl. `drumMaster`) are the
  only coalesced channel and ride the same socket; `engineParamsEvents` is not
  used as an outbound writer.
- [ ] **Offline/playa**: WS + bundled YAML kits + CoreMIDI/Web MIDI built-ins;
  no CDN, no runtime install (codex hard rule).
