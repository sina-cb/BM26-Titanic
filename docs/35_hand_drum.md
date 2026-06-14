# 🥁 Hand Drum — Play the Titanic Like a Drum Surface — Design Doc

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
             │  ws "drumHit" { u, v, voice, vel }     │
             ▼                                        ▼
   ┌────────────────────────────────────────────────────────┐
   │  MarsinEngine :6968  —  /ws/params  (existing socket)    │
   │   drumHit → resolve voice → SpatialImpulse{originN,      │
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
  intensity: 0..1          // peak amount (velocity)
  blend:    'add' | 'max' | 'replace'
}
```

Every pixel in our models already carries normalized coords `nx, ny, nz` in
`[0..1]` (see any `marsin_engine/models/*.js` row). The impulse computes, per
pixel, a **spatial weight**:

```
d      = hypot(px.nx - originN[0], px.ny - originN[1])   // distance on the skin
w      = falloff(d / radiusN)        // 1 at the tap, →0 at the rim, 0 beyond
amount = intensity · envelope(elapsedMs) · w
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
   pattern. A voice = color + envelope + radius + blend + effect flavor. Kits
   are **data** (YAML in the repo), authored offline, validated at load.
4. Exactly **one** new engine concept (the Spatial Impulse) and **one** new
   transport message (`drumHit` on the existing `/ws/params` socket). No new
   port, no new daemon, no change to the pixel/DMX/sACN tail.
5. **Polyphonic, fire-and-forget, never stuck**: any number of simultaneous
   taps; every voice ages out by its own envelope. Panic/clear is one tap.
6. Fully **playa/offline-compliant** and **fail-loud** (codex P0): unknown
   kit/voice/effect → throw at load, never a silent no-op.

**Non-Goals (v1)**

- **No sequencer / no recording / no looping.** Hand Drum is *live* only.
  Record-and-loop is the obvious v2 and gets its own doc.
- **No new pixel math beyond the spatial weight** — we do not add new blend
  modes, new effect families, or per-pixel shaders. A voice is a weighted
  `dropHit` (plus the handful of macro effects already in the library).
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
│ D. api_server.js  /ws/params handler: + case d.type==='drumHit'     │
│ E. lib/hand_drum.js   resolve voice + scale by live macros →        │
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
  **Hue**, **Intensity**, **Master**. These are *live performance scalars*
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
  out-of-range envelope, a color that isn't a 6-tuple, or a region that
  doesn't cover `[0..1]²`. No partial kits (codex P0).
- **`drum_transport.ts`** — sends `{ type:'drumHit', u, v, voice, intensity,
  ts }` over the **existing** `/ws/params` socket. Hits are **discrete and
  dispatched immediately** (a drum that throttles taps is not a drum). Only
  the **continuous macro faders** coalesce (~30 Hz trailing, exactly like
  docs/34) and they go through the normal CPC path (`setSharedParam` /
  `updateParamCenter`), because size/speed/hue are engine-side state read at
  trigger time, not per-hit payload.

### C. `hooks/useHandDrum.ts`

Mounted by the tab. Owns: current kit, macro fader values (mirrored to CPC),
and — **if docs/34's `useMidiControl` is present** — the APC binding for the
drum profile (§5), including the **LED echo**: when a hit fires, light its pad
in the voice's color and fade it on the envelope's release, so the grid
visibly "rings." With no APC attached the tab is fully touch-playable; the
hook reports `apc: connected|absent|error` for a header chip (reusing docs/34's
chip styling).

### D. Engine transport — `api_server.js`

One new branch in the `/ws/params` message handler (alongside `setControl`,
`setSharedParam`, …):

```js
} else if (d.type === 'drumHit') {
  // d = { type, u, v, voice, intensity, ts }
  if (!handDrum) return;                       // tab/feature not wired → fail loud at boot, not here
  handDrum.hit({ u: d.u, v: d.v, voice: d.voice, intensity: d.intensity }, nowMs());
}
```

WS, not REST: a single tap is ~80 bytes and must feel instant; REST per-tap
would add a connection/round-trip tax the drummer can feel. The socket is
already open and already carries `setSharedParam` at performance rates.

### E. `lib/hand_drum.js` — voice resolution

`HandDrum` holds the active **kit** (pushed from CaptainPad via a tiny
`POST /hand-drum/kit` so the engine, not just the client, knows the active
voice set — keeps validation server-side too) and the live **macro scalars**
(read from CPC keys `drumSize`, `drumSpeed`, `drumHue`, `drumIntensity`,
registered in the param schema like any global param — see
`.agent/01_skills/04_add_new_global_param.md`). On `hit()` it:

1. `originN = skinProjection(u, v)` (engine mirrors the same projection so the
   client and engine agree; projection table ships in the model sidecar).
2. `voice = kit.resolve(originN, d.voice)` → base color/env/radius/blend.
3. Apply macros: `radiusN = voice.radiusN * sizeScale`, envelope ×
   `speedScale`, hue-rotate `color6` by `hueShift`, `intensity *=
   intensityScale`.
4. `controller.triggerSpatialImpulse(impulse, nowMs)`.

### F. `global_effects_controller.js` — the only pixel-loop change

```js
triggerSpatialImpulse(impulse, nowMs) {
  const durationMs = dropHitEffect.envelopeDurationMs(impulse);   // reuse
  this.spatialImpulses.push({ impulse, triggeredAtMs: nowMs, durationMs });
}

// in the per-frame apply, next to the existing dropHits loop:
for (const s of this.spatialImpulses) {
  const env = dropHitEffect.envelopeValue({ elapsedMs: nowMs - s.triggeredAtMs, ...s.impulse });
  if (env <= 0) continue;
  applySpatialImpulse({ pixels, impulse: s.impulse, env });   // weight × applyDropHit math
}
this.spatialImpulses = this.spatialImpulses.filter(s => nowMs - s.triggeredAtMs <= s.durationMs);
```

`applySpatialImpulse` lives in a generalized **`effects/spatial_impulse.js`**
that imports `applyDropHit` and adds the distance-weight term. The hot loop is
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
- **Depth (`nz`)** is ignored in v1's distance term (2D skin). A voice may
  *opt in* to a `nz` band (`zBand: [min,max]`) so e.g. a "stack" voice only
  lights high fixtures regardless of where horizontally you tap — cheap 2.5D
  expressiveness without a real 3D pick.
- **Per-model calibration** lives in a model sidecar (next to
  `*.viewmasks.js`): the front-skin bounds + optional named regions for
  region→voice kits. Authored once per scene; validated at load.

**Why front-only is enough for BM26:** the operator faces the ship; the front
is what the crowd sees; `nz`-bands cover the "tap high vs low" gesture. Camera-
true 3D picking (tap the sim's current view, raycast to fixtures) is a clean
v2 that reuses the sim's existing picking — noted, not built (§9).

---

## 5. APC mini mk2 as a drum (consumes docs/34)

Hand Drum is the **flagship use case** for the direct-MIDI work in docs/34 and
needs nothing from it beyond a new **mapping profile** and one new
`action.kind`. The APC mini mk2's layout maps beautifully:

| APC control | Hand Drum role |
|---|---|
| **8×8 pad grid** | A spatial grid over the skin. Pad `(row, col)` → skin `(u, v)` = cell center. Pressing a pad fires that cell's voice. Top rows = high on the ship (stacks), bottom rows = waterline. |
| **Pad velocity** | Hit **intensity** (the mk2 pads are velocity-sensitive). Soft tap = gentle glow, hard hit = punch. |
| **Pad LED** | **Echo**: the pad lights in the voice color on hit and fades on the envelope's release — the grid pulses with your playing. |
| **Faders 1–8** | The live macros: F1 **Size**, F2 **Speed**, F3 **Hue**, F4 **Intensity**, F5–F7 spare (e.g. per-bank), F8 reserved. |
| **Fader 9** | **Master** (same master path the mixer uses). |
| **Scene/track buttons** | **Kit select** (bank of kits) + **Panic/Clear**. |

The profile is just another docs/34 YAML, with one new `action.kind: drumPad`
whose handler calls `drum_transport.drumHit({ u, v, voice, intensity })`
instead of an `api.ts` REST function. Everything else — transport selection
(CoreMIDI on iPad / Web MIDI on desktop Chromium for agent-driven HIL tests),
endpoint pinning, hotplug, fail-loud chip — is **inherited unchanged** from
docs/34. The 8×8 → `(u,v)` map and velocity→intensity curve live in the
profile so they are data, not code.

> **Dependency note:** if docs/34 hasn't shipped when Hand Drum starts, the
> tab is still fully deliverable touch-only (Ring 1/2 below); the APC simply
> reports `absent`. The two docs are independently landable; Hand Drum is the
> reason to prioritize docs/34.

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
  attackMs: 8
  holdMs: 40
  releaseMs: 320
regions:         # region → voice (for tap-where-you-mean kits)
  - { name: low,   yBand: [0.00, 0.45], voice: kick }
  - { name: mid,   yBand: [0.45, 0.75], voice: tom  }
  - { name: high,  yBand: [0.75, 1.00], voice: stack }
voices:
  kick:
    color6: [1, 0.15, 0.0, 0, 0, 0]    # warm amber punch
    radiusN: 0.28
    releaseMs: 450
  tom:
    color6: [0.0, 0.7, 1.0, 0, 0, 0]   # cyan
    radiusN: 0.18
  stack:
    color6: [1, 1, 1, 0.6, 0, 0]       # white + warm-white, tight & fast
    radiusN: 0.12
    holdMs: 10
    releaseMs: 160
    zBand: [0.7, 1.0]                  # only the high fixtures
```

- **"Choosing a special pattern (signals)"** = choosing a kit. Within a kit,
  the *place you tap* selects the voice (regions) — exactly the user's "based
  on the location of the tapped fingers it instantiates those signals."
- Voices can flavor onto the existing macro effects too: a voice may set
  `effect: uvBlast` or `effect: colorWash` (mapped to the library in docs/28)
  instead of the default weighted `dropHit`, so a kit can mix a UV stab with
  RGB toms. v1 ships `dropHit`-flavored voices; the field is there from day one.
- Ship **2–3 starter kits** (`bow_kit`, `full_hull`, `uv_ghost`) so the tab is
  fun out of the box. Authoring more is a YAML PR, not code.

---

## 7. Failure modes — fail loudly, everywhere (codex P0)

| Condition | Surfaced as |
|---|---|
| Kit YAML invalid (unknown effect, bad color tuple, region gap, env < 0) | **Throws at load** with the offending kit path. No partial kit. |
| `drumHit` for a voice not in the active kit | Engine throws in `hand_drum.js` (logged + WS error frame); the client only sends voices it resolved, so this means client/engine kit drift — loud, not swallowed. |
| Active kit not pushed to engine before a hit | `handDrum.hit` throws "no active kit" — the tab pushes the kit on mount/selection; a hit before that is a wiring bug, surfaced. |
| Macro CPC key missing from schema | Engine boot-time schema validation fails (same as every global param). |
| Runaway / stuck finger | Impulses are fire-and-forget and self-expire; **Panic/Clear** drops `spatialImpulses[]` and calls the existing panic-stop. No voice can outlive its envelope. |
| APC profile endpoint mismatch | Inherited docs/34 behavior: red chip naming the endpoints found, no auto-pick. |
| Frame budget exceeded under heavy drumming | Bench-gated (§8); if ever real, cap concurrent impulses (oldest-drops) — a *loud* cap surfaced in the tab, not a silent throttle. |

---

## 8. Verification & development rings

Mirrors docs/34's Windows-first, Mac-last topology — Hand Drum is even easier
because the core is **engine-side and pure-function testable**.

- **Engine unit tests** (no hardware, no iPad): `effects/spatial_impulse.js`
  weight math (a tap at a fixture's `nN` peaks there, decays to 0 past
  `radiusN`); `hand_drum.js` voice resolution + macro scaling; envelope
  lifecycle/expiry. Runs in CI like the rest of `marsin_engine/tests/`.
- **Pure-TS tests**: `skin_projection` round-trips, kit loader/validator
  throw cases.
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
| 1. **Engine primitive** | `effects/spatial_impulse.js` (weight × `applyDropHit`); `spatialImpulses[]` + `triggerSpatialImpulse` + per-frame apply in `global_effects_controller.js`; unit tests. Pure engine, no UI. | `marsin_engine/effects/spatial_impulse.js`, `lib/global_effects_controller.js`, tests |
| 2. **Voice/kit + transport** | `lib/hand_drum.js` (kit hold, voice resolve, macro scaling); `drumSize/Speed/Hue/Intensity` CPC params; `drumHit` WS branch + `POST /hand-drum/kit`; starter kits. | `marsin_engine/lib/hand_drum.js`, `lib/api_server.js`, param schema, `CaptainPad/utils/drum/kits/*.yaml` |
| 3. **CaptainPad tab (touch)** | `app/(tabs)/hand_drum.tsx` + `_layout.tsx` entry; `utils/drum/{skin_projection,kit,drum_transport}.ts`; `hooks/useHandDrum.ts`; macro faders; panic. **Full Ring-1 HIL pass** (puppeteer taps → sim). | CaptainPad tab + utils + hook |
| 4. **APC drum profile** | docs/34 profile `apc_mini_mk2_drum.yaml` + `action.kind: drumPad`; LED echo in `useHandDrum`. Ring-1 (Web MIDI) then Ring-2 (iPad CoreMIDI). | `CaptainPad/midi_profiles/*`, hook |
| 5. **(later)** | 3D camera-true pick (reuse sim picking); side/top skins; voice→signal-bus publish so patterns react to drumming; record/loop sequencer (own doc); tap-to-edit kit builder. | — |

---

## 10. Open questions (for Sina)

1. **Skin v1 — front elevation OK?** Front-only with `nz`-band voices covers
   "tap high vs low." Or do you want the tab to mirror the **sim's current
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
5. **Master interaction** — does the drum's Master fader fold into the global
   master, or is Hand Drum a separate additive layer with its own level (so
   you can drum over a blacked-out deck)? Proposed: separate additive level,
   because drumming over a dark hull is a great look.
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

3. **Smokestack barks.** A `stack` voice with `zBand: [0.7, 1.0]` lights only
   the high fixtures regardless of horizontal tap position — so a hard hit
   makes the stacks *bark* over the hull. The "tap high vs low" gesture maps
   to the ship's silhouette without any 3D picking.

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

/** Apply one live impulse to the frame's pixels at envelope value `env`. */
export function applySpatialImpulse({ pixels, impulse, env }) {
  const { originN: [ox, oy], radiusN, falloff, color6,
          intensity, blend, zBand } = impulse;
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (zBand && (px.nz < zBand[0] || px.nz > zBand[1])) continue;
    const d = Math.hypot(px.nx - ox, px.ny - oy);
    const w = spatialWeight(d, radiusN, falloff);
    if (w <= 0) continue;
    applyToPixel(px, color6, env * intensity * w, blend); // px.r..px.u, RGBWAU
  }
}
```

### B.2 Engine — `global_effects_controller.js` (additions)

Mirrors the existing `dropHits` lifecycle exactly. `dropHits` is declared in
the constructor (`this.dropHits = []`, line 67) and walked in
`applyMacros({ pixels, frameIndex, nowMs })` (the dropHit loop is lines
287–310). Add a sibling list + trigger + loop:

```js
// constructor, next to this.dropHits = []:
this.spatialImpulses = []; // [{ impulse, triggeredAtMs, durationMs }]

// new method, mirrors triggerDropHit (line 411):
triggerSpatialImpulse(impulse, nowMs) {
  const durationMs = envelopeDurationMs(impulse); // attack+hold+release
  this.spatialImpulses.push({ impulse, triggeredAtMs: nowMs, durationMs });
}

// inside applyMacros(...), directly after the dropHits block (~line 310):
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
    applySpatialImpulse({ pixels, impulse: s.impulse, env });
  }
}
```

`panicStop()` (line 618) clears `this.spatialImpulses = []` too — the panic
path must drop live drum voices (failure table, §7).

### B.3 Engine — `lib/hand_drum.js` (new) — voice resolution

Holds the active kit + the live macro scalars (read from CPC) and turns a tap
into an impulse. Throws (no fallback) on a missing kit/voice — codex P0.

```js
export class HandDrum {
  constructor({ controller, projection, paramCenter }) {
    this.controller = controller;     // GlobalEffectsController
    this.projection = projection;     // skin (u,v) -> [nx, ny], scene sidecar
    this.paramCenter = paramCenter;   // for drumSize/Speed/Hue/Intensity
    this.kit = null;
  }

  setKit(kit) { this.kit = kit.validate(); } // throws on bad kit at swap time

  hit({ u, v, voice: voiceId, intensity = 1 }, nowMs) {
    if (!this.kit) throw new Error('HandDrum.hit: no active kit (POST /hand-drum/kit first)');
    const originN = this.projection.project(u, v);  // [nx, ny] in 0..1
    const voice = this.kit.resolve(originN, voiceId); // throws if unknown
    const m = this._macros();                          // live CPC scalars
    this.controller.triggerSpatialImpulse({
      originN,
      radiusN:   clamp01(voice.radiusN * m.size),
      falloff:   voice.falloff,
      color6:    rotateHue(voice.color6, m.hue),       // RGB hue-rotate, W/A/U pass-through
      attackMs:  voice.attackMs,
      holdMs:    voice.holdMs   / m.speed,             // faster speed = shorter hold
      releaseMs: voice.releaseMs / m.speed,
      intensity: clamp01(intensity * voice.gain * m.intensity),
      blend:     voice.blend,                          // 'add' | 'max' | 'replace'
      zBand:     voice.zBand || null,
    }, nowMs);
  }

  _macros() {
    const p = this.paramCenter.getAll();
    return { size: p.drumSize, speed: p.drumSpeed, hue: p.drumHue, intensity: p.drumIntensity };
  }
}
```

`drumSize/drumSpeed/drumHue/drumIntensity` are registered in the param schema
exactly like every other global param (follow
`.agent/01_skills/04_add_new_global_param.md`); they get clamped/validated by
the CPC, persisted per policy, and broadcast — Hand Drum stores no param state
of its own. Macros are **engine-side state read at trigger time**, which is
why per-tap `drumHit` payloads stay tiny (§3.D).

### B.4 Engine — `lib/api_server.js` WS branch (one `else if`)

Added to the `/ws/params` inbound handler, alongside `setSharedParam`
(line 3714) and `setControl` (line 3588). WS, not REST — a tap must feel
instant and the socket is already open at performance rates.

```js
} else if (d.type === 'drumHit') {
  // d = { type, u, v, voice, intensity, ts }
  if (!handDrum) throw new Error('drumHit received but HandDrum not wired'); // boot bug, fail loud
  handDrum.hit({ u: d.u, v: d.v, voice: d.voice, intensity: d.intensity }, nowMs());
}
```

Plus a tiny REST `POST /hand-drum/kit` so the **engine** (not just the client)
validates and holds the active kit — keeps validation server-side and lets the
kit change without reconnecting the socket.

### B.5 CaptainPad — `utils/drum/drum_transport.ts` (new)

Hits ride the **existing** engine WS via `engineEvents.send(...)`
(`CaptainPad/utils/engineBus.ts` → exported as `engineEvents.send`, line 40 of
`engineEvents.ts`). Discrete hits dispatch immediately; only the continuous
macro faders coalesce and go through the CPC (`setSharedParam`), exactly like
docs/34.

```ts
import { engineEvents } from '@/utils/engineEvents';

/** Fire one drum voice. Discrete → send now, never throttled (it's a drum). */
export function drumHit(u: number, v: number, voice: string, intensity = 1) {
  engineEvents.send({ type: 'drumHit', u, v, voice, intensity, ts: Date.now() });
}

/** Continuous macro (Size/Speed/Hue/Intensity) → CPC, ~30 Hz trailing. */
export function setDrumMacro(key: 'drumSize'|'drumSpeed'|'drumHue'|'drumIntensity', value: number) {
  engineEvents.send({ type: 'setSharedParam', key, value, origin: 'handdrum' });
}
```

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

- [ ] **Spatial primitive is genuinely additive-only and reuses `dropHit`** —
  no new blend modes, no change below `applyMacros` in the pixel→DMX→sACN tail.
- [ ] **Polyphony bounds**: `spatialImpulses[]` length under realistic
  drumming (e.g. 8 hits/s × ~0.5 s envelopes ≈ ≤ ~8–12 live) keeps
  `applyMacros` under the 25 ms frame budget on the `titanic` model (the §8
  bench gate must prove this, not assume it).
- [ ] **Fail-loud holds**: bad kit/voice/effect throws at *load* and *swap*;
  `drumHit` for an unknown voice throws server-side; panic clears live voices.
- [ ] **Macro semantics**: Size scales radius, Speed scales envelope (hold +
  release), Hue rotates RGB only (W/A/U pass through), Intensity × velocity ×
  voice gain — all clamped by the CPC. Confirm `1/speed` is the intended sense
  (bigger Speed = snappier).
- [ ] **Front-skin sufficiency** for BM26 vs needing the 3D pick now (Q1) —
  the single biggest scope decision.
- [ ] **Latency path**: tap → `engineEvents.send` (WS, open) → `drumHit` →
  trigger, with no REST in the per-tap path. Continuous faders are the only
  coalesced channel.
- [ ] **Offline/playa**: WS + bundled YAML kits + CoreMIDI/Web MIDI built-ins;
  no CDN, no runtime install (codex hard rule).
