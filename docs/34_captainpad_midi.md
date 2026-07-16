# 🎹 Direct CaptainPad MIDI Control — Design Doc

## Overview

The operator's hands at FoH are on physical MIDI surfaces — historically an
**Akai APC40 mkII** and an **APC mini mk2** (plus MF Twisters). In the TE 2025
stack those controllers reached the rendering machine through a **Bomebox +
Bome Network** MIDI-over-ethernet bridge into Chromatik. It worked, but the
FoH ops notes are blunt about the cost: *"Bome remote MIDI links have been
difficult for volunteers to learn how to initially set up or re-enable after
a glitch"* (Notion → Networking and FoH Setup → "Independent FoH Case").

For BM26 the control plane is already different: **CaptainPad on the FoH iPad
talks straight to MarsinEngine over the LAN** (REST + WS on `:6968`). This doc
designs the missing link — **plugging the APC directly into the iPad over
USB-C and turning its pads, faders, and knobs into CaptainPad inputs**, so the
controller rides the exact same command path the on-screen UI already uses.

```
APC mini mk2 ──USB-C──▶ iPad (CoreMIDI)
                          │  native Expo module → JS mapping layer
                          ▼
                CaptainPad utils/api.ts  (updateParamCenter, setActivePattern, …)
                          │  REST POST  (existing, unchanged)
                          ▼
                MarsinEngine :6968 ──sACN──▶ fixtures
```

No Bomebox, no Mac in the loop, no MIDI-over-network. One cable from the
controller to the thing the operator is already holding.

---

## The control ideology (read this before adding hardware or mappings)

Eight principles govern every mapping, every LED, and every purchase. They are
distilled from the Chromatik-era FoH practice, two bench iterations with the
real APC, and the playa constraints (volunteer operators, night fatigue, dust,
no internet, 2-hour strike).

1. **Two surfaces, two verbs: SELECT and SCULPT.** The APC mini is the
   *selector & safety* surface — what plays, how loud, which palette, blackout,
   and WHERE depth points (focus). The MFT is the *sculptor* — 16 endless
   encoders deep into ONE channel. A control belongs to exactly one verb;
   a surface that speaks both becomes a menu, and menus kill shows.
2. **One focus for every deep surface** (the Chromatik inheritance). All
   depth converges on a single FOCUSED channel. Selector surfaces set it (APC
   track buttons, touch, MFT side buttons as fallback); sculpting surfaces
   consume it; every surface shows it (track LED, ring colours, UI highlight).
   Split focus means editing the wrong channel at 2 a.m. — never per-surface
   focus.
3. **The engine is the only truth; controllers are stateless views.** No
   controller holds an authoritative value: absolute controls get
   soft-takeover, relative controls need nothing, LEDs/rings are diffed
   projections of engine state. Consequence: any surface can be hot-unplugged
   mid-set with zero state loss, and N surfaces + M iPads can never fight.
4. **Layered value model: physical controls write the BASE.** Operator intent
   (static base) and audio modulation are separate layers. Knobs and faders
   move the base/anchor, never the modulated output — the operator and the
   music never wrestle. Rings display the live modulated value while the knob
   steers the anchor: you *see* the music, you *steer* the intent.
5. **Mapping is data; hardware is a profile.** A controller is a YAML profile
   (+ at most a vendored protocol module, like the pymft port) — never a
   rewrite. Profiles validate fail-loud at boot and live in git, because a
   muscle-memory map IS code for hands.
6. **Fail loud, degrade to touch.** Every failure is a visible state (grey =
   absent and fine, red = broken and named). The only silence allowed is
   documented loud-silence (an unlit pad = nothing behind it). The iPad touch
   UI remains the complete fallback — MIDI is acceleration, never the only
   path.
7. **Muscle memory is sacred.** One unified layout across tabs (targets
   change, geometry doesn't); blackout lives in the same corner forever; a
   learned binding may not shadow a global control (enforced at capture
   time). New features must not move old hands.
8. **Playa-first.** Wired USB only, one powered hub, everything vendored,
   zero cloud. Every added device must justify its cable, its weight, and its
   failure mode against the 2-hour strike.

**Hardware doctrine.** APC mini + MFT covers SELECT + SCULPT — a complete
two-verb rig, and the show must stay runnable on the APC alone (volunteer
mode). The one verb this rig cannot speak is **PUNCH**: expressive momentary
gestures (hold-to-flash, pressure-into-strobe-intensity on a drop) — scene
toggles are not punch. Growth rules: add a surface only for a missing verb,
never for more of the same; prefer devices whose protocol we can vendor
(DJTT, Intech-class open hardware); bench the current rig and *feel* the gap
before buying. Prerequisite for ANY punch surface: momentary / while-held
action kinds in the mapping layer (press = on, release = off, key-depth →
intensity) — a small, cloud-testable addition. **PUNCH surface locked
2026-07-02: Intech Grid VSN1-L** (ordered; 8 analog hall-effect keys + jog
wheel + screen) — see "Driver #3" below. The screen is a bonus, never a
dependency.

## A unified, multi-controller framework (not one device)

The mapping stack is **controller-agnostic and runs multiple controllers at
once**. A controller is just a **YAML profile** (`CaptainPad/midi_profiles/
<device>.yaml`) bound to a transport; the `MidiManager` owns N of them
concurrently. Adding a controller is a data change, not a rewrite.

- **Driver #1 — Akai APC mini mk2** (this work). 8×8 RGB pad grid, 9 faders,
  17 UI buttons. Protocol + colour palette captured from Akai's official docs
  (archived in `CaptainPad/midi_profiles/manuals/`) and a live Web MIDI capture
  on the dev PC; summarised in `CaptainPad/midi_profiles/apc_mini_mk2_reference.md`.
- **Driver #2 — DJTT MIDI Fighter Twister** (designed — see the dedicated
  **“Driver #2 — MIDI Fighter Twister”** section below). The authoritative
  protocol reference is Sina's **`pymft`** library
  (<https://github.com/sina-cb/pymft>): it encodes the MFT's
  encoder/bank/colour/detent model, the sysex config push, and 2-way feedback.
  The MFT lands as a second profile plus a small resolver extension for its
  **relative (endless) encoders** (the APC's faders are absolute CC; the MFT's
  encoders send relative deltas and expect value/colour writes back). The
  protocol layer of `pymft` is **ported from Python to TypeScript** into
  `CaptainPad/utils/midi/mft/` (constants, message builders/decoders, sysex
  config) so it runs everywhere the mapping stack runs — desktop Chrome and,
  later, the iPad (MIDI stays CaptainPad-side so it reaches the iPad over
  USB-C; see "iPad is a must" below).

**iPad is a must.** Engine-side (Node) MIDI was considered and rejected for the
show path: it puts the controller on the car, not in the operator's hands at
FoH, and can't drive the iPad. The controller plugs into the **iPad** (CoreMIDI,
native transport — deferred follow-up) or, for dev/degraded-FoH, a **desktop
Chrome** (Web MIDI). Both sit behind the same frozen `MidiTransport`.

---

## Feasibility check

This section reviews the "Direct Akai APC Controller Connection to iPad for
USB MIDI" research report against our actual hardware and stack. Verdict up
front: **feasible, with one major addition the report doesn't cover** — the
report establishes that *the iPad* can receive USB MIDI, but getting that MIDI
*into CaptainPad* (a React Native / Expo app) requires a small native
CoreMIDI module. That's the real engineering work, and it's tractable.

### What the report gets right (and we adopt)

| Claim | Verdict for us |
|---|---|
| APC mini mk2 is class-compliant USB MIDI, bus-powered, plug-and-play | ✅ Confirmed by Akai docs. No drivers, no licenses — works with CoreMIDI out of the box. |
| APC40 mkII is class-compliant, single USB MIDI port, bus-powered | ✅ Same. Heavier LED/power load than the mini, see power below. |
| **APC mini mk2 exposes multiple virtual MIDI ports** (Port 0 = faders/LEDs, Port 1 = note mode, Ableton setup references a third) | ✅ Confirmed and **load-bearing for our implementation**: the native module must enumerate endpoints by name *and index*, the mapping profile must pin which endpoint it listens on, and LED feedback must be sent to the matching destination endpoint. If the configured endpoint isn't found: fail loudly, never auto-pick. |
| Power is the deciding factor, not protocol; powered hub recommended | ✅ Agreed — and we want a **PD-passthrough powered USB-C hub at FoH regardless**, because the iPad must charge all night while in use. One hub solves both. |
| Wired beats wireless for latency and ops simplicity | ✅ Agreed. USB MIDI event latency is single-digit ms; the LAN REST hop to the engine is the dominant (and already accepted) cost. |
| Test incoming MIDI with a monitor app (MIDI Wrench) first | ✅ Adopted into the verification plan as the hardware bench gate before any code is blamed. |

### What's moot or wrong for our setup

1. **The Lightning section is moot.** Both FoH iPads are **iPad (10th
   generation) — USB-C** (`.agent/00_gol/09_build_ipad_release.md`). No
   camera adapters; the controller's USB-B cable plus a USB-C hub is the
   whole physical story.
2. **Device identity:** camp inventory is an **APC40 mkII** and an **APC mini
   mk2** (Notion: "Clean and bring MIDI controllers (APC40, 2xMFT, Akai)";
   the 2025 Bomebox runbook is titled "MIDI setup: APCminiMk2 over Bomebox").
   The report's "APC40 Mini" disambiguation lands on exactly these two, so
   its analysis applies. **v1 targets the APC mini mk2** (it's the one with
   the proven camp runbook and the lighter power draw); the APC40 mkII is a
   second mapping profile later.
3. **The app recommendations (AUM, Audiobus, Logic Pro, GarageBand, Ableton
   Link) are irrelevant.** Those answer "how do I route MIDI between music
   apps." Our receiver is CaptainPad itself; nothing else on the iPad should
   touch the controller.
4. **The report's silent gap — and the heart of this doc:** an Expo/React
   Native app has **no `navigator.requestMIDIAccess()`**. Web MIDI does not
   exist in React Native, and WebKit has never shipped it, so the CaptainPad
   *web* build in iPad Safari can't do this either. CoreMIDI is there at the
   OS level (that's what MIDI Wrench uses) but reaching it from CaptainPad
   requires a **native module**. CaptainPad is a managed Expo app whose
   `ios/` directory is already regenerated via `expo prebuild` on every iPad
   build, so adding an Expo Module is a known, supported motion — it changes
   the build from "JS-only rebuild" to "prebuild required once," nothing
   more.
5. **The flip side the report never mentions:** desktop **Chromium ships Web
   MIDI**. The CaptainPad web build running in Chrome/Edge on a Windows dev
   machine can read the APC plugged into *that machine* directly. With a
   small transport abstraction (below), the entire mapping/LED/dispatch
   stack becomes hardware-in-the-loop testable on Windows — no iPad, no
   Mac, agent-drivable via puppeteer. This is the primary development path.

### Native module options

| Option | Assessment |
|---|---|
| **In-repo Expo Module (Swift + CoreMIDI)** — **recommended** | ~200–300 lines of Swift via the [Expo Modules API](https://docs.expo.dev/modules/overview/): MIDI client, endpoint enumeration, input port → JS events, output for LED feedback. No third-party dependency, no maintenance risk, New-Architecture-native, vendored in the repo (offline-safe). Expo's own blog demonstrates [exactly this pattern for MIDI hardware](https://expo.dev/blog/building-a-midi-over-bluetooth-app-using-expo-modules). |
| [`@motiz88/react-native-midi`](https://github.com/motiz88/react-native-midi) (Web MIDI shape over Expo Modules) | Attractive API, but the repo self-describes as **[WIP]** — too much dependency risk for show-critical FoH gear, and it abstracts away the multi-endpoint selection we specifically need to control. Useful as a reference implementation. |
| Engine-side MIDI (plug APC into the engine host, `node` MIDI libs) | Technically easiest — but it puts the controller **on the car, not at FoH**. Recreating the remote link is how we got Bomeboxes. Rejected for the FoH use case; noted as a trivial future add for on-car bench work. |
| Keep the Bomebox | Works, but is exactly the volunteer-hostile failure mode we're designing away. Retained as the emergency fallback in the road case, not the plan. |

### Hardware feasibility summary

- **iPad (10th gen) USB-C + powered PD hub + APC mini mk2**: expected to work
  bus-powered even without the hub; with the hub, power is a non-issue and
  the iPad charges. APC40 mkII: always behind the powered hub.
- **iPadOS accessory gotchas** (from the report, verified against Apple
  docs): the iPad must be *unlocked* when the accessory is first attached
  (Settings → Privacy & Security → Wired Accessories), and the app must be
  foreground for CoreMIDI delivery — at FoH, CaptainPad in **Guided Access**
  mode satisfies both and also stops pocket-Safari accidents.
- **Latency budget**: USB MIDI (<5 ms) + JS mapping (<1 ms) + LAN REST to
  engine (5–20 ms) + engine frame (25 ms @ 40 fps) — comfortably under
  anything an operator can feel on a lighting rig.
- **Offline**: everything here is wired-local. No CDNs, no cloud, no runtime
  installs. Playa-compliant by construction.

**Overall: green.** The only genuinely new artifact is the native module, and
it is small, isolated, and on a paved Expo path.

---

## Goals & Non-Goals

**Goals**

1. APC mini mk2 plugged into the FoH iPad drives CaptainPad: pads, faders,
   and buttons dispatch the **same `utils/api.ts` functions the UI uses** —
   zero new engine surface area.
2. Mapping is **data, not code**: a per-device YAML profile (baked into the
   bundle like `config.yaml`) that names MIDI events and binds them to
   actions. Adding the APC40 mkII later = adding a profile.
3. **LED feedback** for state the controller controls: mapped pads lit,
   active pattern pad highlighted, blackout button reflects blackout state.
4. Connection state is **visible and loud**: a status chip in the CaptainPad
   header (like the engine `● CONNECTED` indicator); device-not-found and
   endpoint-not-found are surfaced errors, never silent no-ops.
5. CC floods are **coalesced** (per-control trailing throttle) so a fader
   sweep doesn't machine-gun the engine REST API.

**Non-Goals (v1)** *(annotated — two of these were later promoted and shipped;
see the as-built sections below)*

- ~~No on-iPad mapping editor / MIDI-learn UI~~ — **shipped 2026-07**: the
  per-param ⊞ MIDI-learn flow (see “As-built — MIDI-learn”). Profiles remain
  YAML for the static layout; learn covers per-pattern local params.
- No APC40 mkII profile in v1 (structure supports it; profile authored when
  the unit is on the bench).
- ~~No engine-side changes~~ — **amended**: the render/control path still has
  ZERO engine changes (the engine never applies MIDI), but MIDI-learn added
  **persistence-only** engine endpoints (`midi-mappings` CRUD on playlist
  entries, mirroring the modulation CRUD) so bindings ride the playlist and
  sync multi-client. If REST coalescing ever proves too slow, a WS param
  channel is a separate doc.
- No Bluetooth MIDI, no Bomebox integration, no Android.
- No MIDI in the web build on **iPad Safari** (WebKit has no Web MIDI). The
  web build on **desktop Chromium** is a supported transport (dev/test
  path); everywhere else `isMidiAvailable()` is the explicit capability
  gate and the Config tab says "MIDI: not available on this platform"
  rather than hiding.

---

## Architecture

Three layers, strictly separated — with the bottom layer split into two
interchangeable **transports** behind one interface:

```
┌──────────────────────────────────────────────────────────────┐
│ 1. MidiTransport interface      (utils/midi/transport.ts)    │
│  ┌─────────────────────────────┬──────────────────────────┐  │
│  │ NativeMidiTransport         │ WebMidiTransport         │  │
│  │ modules/captain-midi/       │ navigator.               │  │
│  │ (Expo Module, Swift,        │  requestMIDIAccess()     │  │
│  │  CoreMIDI — iPad)           │ (desktop Chromium —      │  │
│  │                             │  Windows dev/test)       │  │
│  └─────────────────────────────┴──────────────────────────┘  │
│    endpoint enumeration · input events → JS ·                │
│    send() for LED feedback · hotplug notifications           │
├──────────────────────────────────────────────────────────────┤
│ 2. utils/midi/                  (TypeScript, pure)           │
│    profile loader (YAML) · event → action resolution ·       │
│    per-control coalescing · LED state projector              │
├──────────────────────────────────────────────────────────────┤
│ 3. hooks/useMidiControl.ts      (React, mounted in RootShell)│
│    lifecycle · subscribes engine state for LED feedback ·    │
│    dispatches existing utils/api.ts functions                │
└──────────────────────────────────────────────────────────────┘
```

Transport selection at startup is capability-based and explicit: native
module present → `NativeMidiTransport`; else `navigator.requestMIDIAccess`
present → `WebMidiTransport`; else MIDI is unavailable (visible state, not
an error). Both transports expose the same five-call surface, so layers 2–3
are byte-identical across iPad and desktop — which is exactly what makes the
mapping stack testable on a Windows machine with the APC plugged into the
PC. Web MIDI's note/CC send path covers the APC LED feedback too (plain
3-byte messages, no sysex permission needed).

### 1a. Native transport — `modules/captain-midi/`

Local Expo Module (`expo.modules` autolinking from the app's `modules/`
directory; survives `expo prebuild --clean` because it's source, not
generated). API surface kept deliberately tiny:

```ts
type MidiEndpoint = { id: string; name: string; portIndex: number; kind: 'source' | 'destination' };

listEndpoints(): Promise<MidiEndpoint[]>;
openSource(id: string): Promise<void>;          // throws if gone — no fallback
openDestination(id: string): Promise<void>;
send(bytes: number[]): void;                     // LED feedback
addListener('midiMessage', ({ sourceId, data: number[], timestampMs }) => void);
addListener('endpointsChanged', () => void);     // hotplug
```

Implementation notes:

- `MIDIClientCreateWithBlock` + `MIDIInputPortCreateWithProtocol`
  (`._1_0`) — we only need 3-byte channel messages.
- Endpoint identity: CoreMIDI display name + per-device port index. The APC
  mini mk2 presents multiple sources; the profile selects by
  `{ nameContains, portIndex }` and the JS layer **throws** if zero or >1
  endpoints match.
- Hotplug via `kMIDIMsgObjectAdded/Removed` notifications → re-enumerate →
  `endpointsChanged` → hook re-resolves the profile (reconnect-on-replug,
  loud disconnect chip meanwhile).

### 1b. Web transport — `utils/midi/web_midi_transport.ts`

Thin adapter over `navigator.requestMIDIAccess({ sysex: false })` mapping
`MIDIInput`/`MIDIOutput` onto the same `MidiEndpoint` shape (Web MIDI's
`statechange` event covers hotplug). On the APC mini mk2 the browser
exposes the same multiple ports CoreMIDI does, so the profile's
`sourcePort`/`destinationPort` pinning applies unchanged. Chromium-only;
on iPad Safari the capability gate reports unavailable. ~100 lines, zero
dependencies, and the reason agents can do hardware-in-the-loop work
without an iPad.

### 2. Mapping layer — `utils/midi/`

A **profile** is YAML, imported through the existing `yaml-transformer.js`
path (same mechanism as `config.yaml` — already proven in EAS and local
builds):

```yaml
# CaptainPad/midi_profiles/apc_mini_mk2.yaml
device:
  nameContains: "APC mini mk2"
  sourcePort: 0          # faders + pads live on port 0
  destinationPort: 0     # LED feedback goes back on port 0
controls:
  - id: fader_1
    match: { type: cc, channel: 0, cc: 48 }
    action: { kind: paramCenter, key: speed, range: [0, 1] }
  - id: fader_9
    match: { type: cc, channel: 0, cc: 56 }
    action: { kind: master }
  - id: pad_row_0          # bottom pad row → pattern bank
    match: { type: note, channel: 0, notes: [0, 7] }   # inclusive range
    action: { kind: patternBank, bank: 0 }
    led: { active: 21, idle: 1 }                        # APC velocity colors
  - id: blackout_btn
    match: { type: note, channel: 0, notes: [122] }
    action: { kind: blackoutToggle }
    led: { on: 1, off: 0 }
```

Action kinds map 1:1 onto existing `utils/api.ts` functions — the mapping
layer owns **no transport**:

| `action.kind` | Dispatches | Engine endpoint (existing) |
|---|---|---|
| `paramCenter` | `updateParamCenter({ key: scaled })` | `POST /param-center` |
| `pattern` / `patternBank` | `setActivePattern(name)` | `POST /set-pattern` |
| `blackoutToggle` | `setGlobalEffectBlackout(!current)` — the unified GEM e-stop (“stop all clips → blackout”: pixels dark AND active macros cleared) | existing GEM blackout route |
| `globalEffect` | `setGlobalEffect(effect, state)` | `POST /global-effect` |
| `globalEffectSlot` | `dispatchGlobalEffectSlotAction(slot, 'toggle')` | existing GEM slot route |
| `sectionBrightness` | `setSectionBrightness(id, v)` | `POST /section-brightness` |
| `groupFixedColor` | `setGroupFixedColor(group, …)` | `PUT /group-fixed-colors/:g` |
| `master` | `updateMixerMaster(v)` (same path the mixer view uses) | `PATCH /mixer` |
| `mixerLayerFader` | deck: `updateDeckChannel({fader})` · mixer: `updateMixerChannel(id, {fader})` | `PATCH /deck/channel` · `PATCH /mixer/channels/:id` |
| `focusChannel` | controller/UI state only (selects the focused channel) | — no engine call |
| `localParam` *(runtime-built: MIDI-learned APC fader / MFT knob delta)* | deck: `setDeckChannelControl(id, v)` · mixer: `setMixerChannelControl(chId, id, v)` | `POST /deck/channel/control` · `POST /mixer/channels/:id/control` |
| `playlistScroll` / `playlistWindowSelect` | window browser (runtime cursor) → `setChannelPlaylistEntry(…)` | existing playlist-entry route |
| `colorPalettePair` | `updateParamCenter({colorPalette1, colorPalette2})` | `POST /param-center` |

Coalescing: continuous controls (`cc`) get a **per-control trailing
throttle (~30 Hz)** — latest value wins, never dropped, flushed on release.
Discrete controls (notes) dispatch immediately. This matches how fast the
on-screen sliders already talk to the engine; the engine sees nothing new.

Profile validation runs at load: unknown action kinds, overlapping matches,
params missing from the engine's `paramSchema`, or out-of-range LED values
**throw at startup** with the offending YAML path. No partial profiles
(codex P0: no fallbacks, fail loudly).

### 3. React integration — `hooks/useMidiControl.ts`

Mounted once in `app/_layout.tsx`'s `RootShell` (same altitude as the engine
WS buses):

- On mount (native platform only): load profile → enumerate → resolve
  endpoints → open → subscribe.
- Subscribes `useEngineState()` and projects state → LED messages through a
  diffing **LED projector** (only send what changed; full repaint on
  connect): active pattern pad, blackout button, fixed-color group pads.
- Exposes connection state for the header chip:
  `disconnected / connected / error(message)`.
- Pattern banks resolve against the already-fetched `/list-patterns` result;
  a pad with no pattern behind it stays unlit and dispatches nothing (an
  unlit pad is the loud signal — never a wrapped no-op that *looks* mapped).

### UI touchpoints (minimal)

- **Header chip**: `🎹 APC` in the same style as the engine connection
  indicator — grey (no device), green (connected), red (error, tap for
  message).
- **Config tab**: read-only MIDI section — detected endpoints, active
  profile, last event (a poor man's MIDI monitor for on-playa debugging),
  and the platform-unavailable notice on web.

---

## Failure modes — fail loudly, everywhere

| Condition | Surfaced as |
|---|---|
| No USB device attached | Grey chip. Not an error — FoH works touch-only. |
| Device attached but profile's endpoint match fails (0 or >1) | Red chip + error banner naming the endpoints actually found. No auto-pick. |
| Profile YAML invalid | Throws at app start with YAML path context (same philosophy as scene sidecar validation). |
| Mapped param missing from engine `paramSchema` | Red chip + banner naming the key; all other controls keep working (validated per-control, reported in aggregate). |
| Engine REST dispatch fails | Existing `api.ts` error path — the controller adds no new swallowing. |
| Device unplugged mid-set | Chip goes grey instantly (hotplug notification); replug restores and repaints LEDs. |
| iPad was locked when device attached | Detectable as enumeration returning nothing — Config tab note documents the unlock-then-replug ritual. |

---

## Windows-first development & build topology

The development machine is **Windows**; the Mac is a last resort. The
transport split above is what makes that work. Three rings, from innermost
(daily agent loop) to outermost (rare):

### Ring 1 — Windows only, no iPad, no Mac: the agent inner loop

```
APC mini mk2 ──USB──▶ Windows PC ──▶ Chrome (Web MIDI)
                                       │ CaptainPad web build :6967
                                       ▼
                              marsin_engine :6968 ──sACN──▶ sim :6969
```

Everything in layers 1b–3 (web transport, mapping, coalescing, LED
projector, header chip, Config tab) plus the whole engine round-trip runs
here. Agents drive it with the existing full-stack smoke skill
(`.agent/01_skills/05_full_stack_smoke.md`) plus puppeteer — Chromium
grants the `midi` permission headfully or via
`browserContext.overridePermissions(origin, ['midi'])`, so **automated
hardware-in-the-loop tests are possible**: twist a fader, assert the
`/param-center` value moved, screenshot the sim. With no APC attached, the
mapping layer is still fully unit-testable (pure TS, synthetic events).

### Ring 2 — Windows + iPad over Expo (LAN), still no Mac

CaptainPad already ships `expo-dev-client`. Build **one development-profile
binary in the EAS cloud from Windows** (`eas build --platform ios --profile
development`) with the native module baked in, install it on the iPad over
the air (QR / `expo.dev` link — devices are registered with `eas
device:create`, credentials live on EAS per the runbook). From then on:

```
Windows: npx expo start        # Metro on the LAN
iPad:    dev-client app  ──▶ loads JS from Windows Metro, hot reload
APC ──USB-C hub──▶ iPad        # NativeMidiTransport, real CoreMIDI
```

- **All JS/TS iteration — which is everything after the native module
  freezes — hot-reloads from Windows onto the iPad**, with the APC plugged
  into the iPad exercising the real CoreMIDI path.
- Preview/standalone installs also work from Windows: `eas build --profile
  preview` (cloud) → OTA install. This is the existing documented EAS path
  (runbook §1.3); it never needed a Mac.
- The cost of EAS: each **native-side** change (Swift, `app.json` plugins)
  means a new cloud build (~15–30 min, build minutes, internet). Hence the
  design rule: **the native module's 5-call surface freezes after phase 2**
  so iteration stays in JS where Windows + hot reload covers it.

### Ring 3 — 🚨 Mac required — loudly, these and only these

| Task | Why Mac-only |
|---|---|
| Local USB build/install (`expo prebuild` + `xcodebuild` + `devicectl`, runbook §1.4) | Xcode toolchain. This is the **offline fallback** — i.e. **on playa, with no internet, a native rebuild needs the Mac.** Mitigation: freeze the native module and ship the dev-client + preview builds before leaving; on-playa fixes are then JS-only via Metro from any laptop. |
| Debugging a native crash in the Swift module (symbolicated logs, Xcode debugger, Instruments) | Xcode. EAS gives you build logs, not runtime debugging. |
| iOS Simulator runs | macOS only. Not needed for this feature (Simulator has no USB MIDI passthrough anyway — real iPad or Ring 1 are strictly better). |

Everything not in that table runs from Windows. If a future step turns out
to secretly need a Mac, that's a bug in this doc — flag it.

### Build & repo impact

- Adds a local Expo Module ⇒ EAS cloud builds pick it up automatically
  (local modules ride the uploaded archive); the Mac local path gains the
  already-documented `expo prebuild` step (runbook §1.4 step 2).
- No new runtime npm dependencies; the YAML profile rides the existing
  transformer; Web MIDI is a browser built-in. Offline rules untouched.
- Auto-checks: standard `.agent/00_gol/03_captain_pad_auto_checks.md` suite
  (`tsc --noEmit`, lint, `web:build`) — `web:build` doubles as the
  capability-gate regression test, and mapping-layer unit tests run on
  Windows/CI with no hardware.

## FoH hardware checklist (procurement)

1. Powered USB-C hub with PD passthrough (iPad charging + controller power
   from one wall plug) — the report's pricing survey suggests ~$40–100.
2. USB-B → USB-A cable (APC's own) + the hub's A port, or USB-B→C cable.
3. The existing Bomebox stays in the road case as the documented fallback
   path to a laptop/Chromatik rig — unrelated to and unaffected by this
   feature.

---

## Implementation plan

Ordered Windows-first: everything through phase 3 needs no Mac, no iPad,
and no EAS build — a local agent on the Windows box with the APC plugged
into the PC can build and verify it end-to-end.

| Phase | Ring | Scope | Files |
|---|---|---|---|
| 0. Bench gate (PC) | 1 | APC mini mk2 → Windows PC → Chrome `Web MIDI` test page (or MIDI monitor): record exact endpoint names/ports/velocity colors the browser reports — they seed the profile. | — (notes into the Notion card) |
| 1. Transport interface + mapping layer | 1 | `MidiTransport` interface; profile schema + loader + validator; event→action resolver; coalescer; LED projector — **pure TS, unit-tested with synthetic events, no hardware** | `CaptainPad/utils/midi/*` (new), `CaptainPad/midi_profiles/apc_mini_mk2.yaml` (new) |
| 2. Web transport + integration | 1 | `WebMidiTransport`; `useMidiControl` hook; RootShell mount; header chip; Config tab section; capability gate. **Full hardware-in-the-loop verification on Windows**: APC → Chrome → web build → engine → sim, agent-driven via puppeteer + full-stack smoke. | `CaptainPad/utils/midi/web_midi_transport.ts`, `CaptainPad/hooks/useMidiControl.ts` (new), `app/_layout.tsx`, Config tab |
| 3. Native module | 2 (built via EAS from Windows) | `modules/captain-midi/` (Swift + Expo Module config): enumeration/open/send/events, hotplug, matching the frozen transport interface. One EAS `development` build from Windows → dev-client on iPad. | `CaptainPad/modules/captain-midi/*` (new) |
| 4. iPad bench gate + verification | 2 | APC → hub → iPad **MIDI Wrench** check (confirm iPadOS endpoint names match the profile; adjust if CoreMIDI names differ from Chromium's), then the same end-to-end pass on the dev client: every mapped control against engine + sim, LED repaint on replug, unplug/replug soak, Guided Access check | report in `.agent/02_reports/` |
| 5. MIDI-learn ✅ (2026-07) | 1 | Per-param ⊞ learn flow + focused channel + engine-side `midiMappings` persistence (see “As-built — MIDI-learn”) | `utils/midi/learn.ts`, `components/MidiMap.tsx`, engine `midi_mapping_engine.js` + CRUD routes |
| 6. MFT driver ✅ (2026-07) | 1 | pymft → TS port (`utils/midi/mft/`), relative-encoder resolver, ring-feedback projector, `mft.yaml` profile, focus interplay (see “Driver #2 — MIDI Fighter Twister”) | `CaptainPad/utils/midi/mft/*`, `midi_profiles/mft.yaml`, resolver/projector/profile extensions |
| 7. VSN1 punch surface | 1 → bench | Momentary action kinds (buildable now) + `grid_vsn1` profile/vendored Grid Lua config + Phase-0 capture when the ordered unit arrives (see “Driver #3 — Intech Grid VSN1-L”) | resolver/dispatch momentary kinds, `midi_profiles/grid_vsn1/` (new) |
| 8. (later) | — | APC40 mkII profile · WS param channel if REST coalescing ever measures slow | — |

Phases are independently landable. Phase 2 ends with the feature genuinely
usable (a Windows laptop running Chrome at FoH is a legitimate degraded
mode); phase 3–4 promote it onto the iPad. One known risk to verify early
in phase 4: **endpoint display names may differ between Chromium and
CoreMIDI** for the same APC ports — the profile's `nameContains` +
`portIndex` pinning is designed to absorb this, but the iPad bench gate
confirms it before anything is declared done.

## As-built — phases 0-2 (2026-06-12)

Implemented CaptainPad-side, zero engine changes. Module layout under
`CaptainPad/`:

| File | Role |
|---|---|
| `utils/midi/transport.ts` | **Frozen** `MidiTransport` interface + endpoint/event types |
| `utils/midi/web_midi_transport.ts` | Web MIDI adapter + `isMidiAvailable()` capability gate |
| `utils/midi/midi_message.ts` | raw-byte ↔ typed decode (Note On/Off, CC); LED Note-On builder |
| `utils/midi/profile.ts` | profile types + `validateProfile` (throws) + `validateProfileParams` |
| `utils/midi/endpoints.ts` | `resolveEndpoints` — `{nameContains, portIndex}` pinning, throws on absent/ambiguous |
| `utils/midi/resolver.ts` | pure event → `ResolvedAction` with scaled value |
| `utils/midi/coalescer.ts` | per-control ~30 Hz trailing throttle (injectable timers) |
| `utils/midi/led_projector.ts` | engine state → diffed LED messages |
| `utils/midi/dispatch.ts` | `ResolvedAction` → existing `utils/api.ts` fns (injectable) |
| `utils/midi/manager.ts` | `MidiManager` — runs N controllers concurrently |
| `hooks/useMidiControl.ts` | RootShell lifecycle + module store + `useMidiStatus()` |
| `components/MidiStatusChip.tsx` | 🎹 APC header chip (grey/green/red) |
| `components/MidiConfigSection.tsx` | Config tab read-only status + last-event monitor |
| `midi_profiles/apc_mini_mk2.yaml` | driver #1 profile (default mapping) |
| `midi_profiles/apc_mini_mk2_reference.md` + `manuals/` | in/out note tables + Akai PDFs |
| `utils/midi/*.test.ts` | Vitest unit suite (synthetic events, fake transport) |

**Phase 0 capture (Chromium Web MIDI, Windows).** The device name appears on
two ports; `nameContains: "APC mini mk2"` matches both, so `sourcePort:0` /
`destinationPort:0` disambiguate (port 0 = faders/pads/buttons/LEDs). Bome
virtual ports (`APCMini -> …`, mfr "Microsoft") are excluded by name.

| Kind | Port | Name | Mfr |
|---|---|---|---|
| in/out | 0 | `APC mini mk2` | AKAI Professional |
| in/out | 1 | `MIDIIN2/MIDIOUT2 (APC mini mk2)` | AKAI Professional |

**Deliberate deviations from the sketch in this doc:**
- Blackout is mapped to **Scene Launch 8 (note 119, bottom scene button)**,
  not Shift (122) as the example showed — Shift has **no LED** on the mk2, so
  it can't satisfy the LED-feedback requirement. (It sat on Track Button 8
  briefly during the first bench pass; the unified layout moved it to the
  scene column with the global-effect slots stacked above it.)
- Endpoint disambiguation is `nameContains` + a **deterministic port index**
  (not "throw if >1 name match"): the index pin is explicit, not a silent
  auto-pick, so it satisfies the no-fallback rule while handling the real
  two-port enumeration.
- Param-key validation is **aggregate + non-fatal by default** (other controls
  keep working; the Config tab names the offending key) with a `strict` throw
  variant for tests — reconciling the failure-mode table with the unit-test
  contract.

**Verification (as of 2026-07-02):** `npx tsc --noEmit` clean; `npm run lint`
exit 0 (new files: zero warnings); `npm run web:build` passes; Vitest suite
green (98 tests across the `utils/midi` layer). Hardware-in-the-loop on the
bench rig confirms the round-trip.

### Tab-aware operator mapping → the UNIFIED layout (as-built)

Profiles declare **`contexts:`** (e.g. `deck` / `mixer`); the mechanism lets
the same hardware map to different actions per active CaptainPad tab
(`MidiManager.setContext()`, driven by tab focus). A dedicated **MIDI tab**
(`app/(tabs)/midi.tsx`) shows status + a live event monitor; the 🎹 chip taps
through to it.

After two bench iterations the per-tab layouts were **collapsed into ONE
unified layout** (a YAML anchor shared by both contexts) so the operator
learns a single surface; only the channel **targets** differ per tab — on the
Mixer tab the channel controls address the overlay layers, on the Deck tab
they address the single deck channel (layer 0; layers 1-2 inert). The APC
mini mk2 layout:

- **Faders:** 1-3 → channel faders (layers 1-3) · 4-6 + 8 → **MIDI-learned
  local params of the FOCUSED channel** (see “As-built — MIDI-learn” below;
  intentionally unmapped in the profile) · 7 → global speed · 9 → master
  brightness.
- **Track buttons 1-3 → FOCUS channel 1-3** (LED lit = focused). Focus selects
  which channel the learned param faders — and the MIDI Fighter Twister —
  drive. (Solo was dropped from the controller in this redesign; note the old
  controller-solo PATCH was silently ignored by the engine's field whitelist
  anyway — solo is a purely client-side gesture in mixer.tsx.)
- **Pad cols 1-4 →** per-channel **playlist window browser** (scroll pads +
  6-entry window + LED border, mirrored as an amber border in the deck/mixer
  UI).
- **Pad cols 5-8 → colour-pair pads** (curated palettes 1-16; pads show the
  pair hues).
- **Scene buttons (bottom→up):** blackout (unified GEM e-stop, note 119) then
  global-effect slots 1-7.
- **Activity auto-disable:** any MIDI input disables autopilot + deck
  transitions (faders authoritative); restored after 60 s idle.

Action kinds added along the way: `mixerLayerFader`, `globalEffectSlot`,
`playlistScroll`, `playlistWindowSelect`, `colorPalettePair`, `focusChannel`,
plus the runtime-built `localParam` (learned bindings / MFT knobs); new match
type `column` (strided pad columns). All dispatch through existing
`utils/api.ts` — zero engine changes in the control path.

## As-built — MIDI-learn + the focused channel (2026-07-02)

The modulator-style **per-param MIDI mapping**: every local-param slider on
the deck carries a violet **⊞ MIDI** badge next to the green ◎ modulation
badge. Tap → **LEARN** → move a fader → the control binds to that param.
From then on the bound control writes the param's **STATIC** value through
the existing control endpoints; audio modulators stay layered on top
untouched.

- **Persistence — engine-side, mirroring modulations:** bindings live on the
  playlist entry as `midiMappings`
  (`{id, enabled, control:{type,channel,number}, target:{scope:'pattern',
  parameter}, range:[min,max]}`), validated by
  `marsin_engine/lib/midi_mapping_engine.js`, with
  `PUT/PATCH/DELETE /api/playlists/:name/items/:itemId/midi-mappings/:id`
  cloned from the modulation routes and the same `playlistSaved` broadcast
  for multi-client sync. **The engine render loop never reads them** — they
  are metadata; CaptainPad applies them.
- **The FOCUSED channel** (the Chromatik-style focus concept): learned
  bindings — and the MFT below — always drive *the focused channel's active
  pattern*. Deck tab: the deck channel is auto-focused. Mixer tab: the
  operator picks focus with the APC track buttons 1-3 (and the on-screen
  focus UI). Focus is shared state across ALL connected controllers: the APC
  selects it, every surface's LEDs reflect it.
- **Soft-takeover (“pickup”):** after a focus/pattern switch a bound fader is
  locked until it crosses the param's current value — no value jumps. The
  focused track-button LED flashes while a fader is lock-parked.
- **Learn safety:** a control that already has a static profile action
  (global speed, master, pads …) is rejected at capture time with a named
  error — a learned binding can never silently shadow a show-critical
  control. *(Review finding; fix specced in the 2026-07-02 plan.)*

## Driver #2 — MIDI Fighter Twister (design)

The MFT is the **parameter surface**: 16 endless RGB-ring encoders (4×4),
4 virtual banks (64 encoder slots), 6 side buttons, per-encoder push
switches, full 2-way LED feedback. Where the APC is *selection + macro*
hardware (pads, faders, scenes), the MFT is *fine control* hardware — so its
whole job here is:

> **The 16 knobs are the FOCUSED channel's pattern parameters, in order.**

One rule, both tabs. On the **Deck** tab the focused channel is the deck
channel (automatic); on the **Mixer** tab it is whichever overlay the
operator focused — **the APC mini's track buttons 1-3 are the focus
handler**, exactly like Chromatik's focused-channel workflow. The MFT
profile is therefore *context-free* (one flat control list): the focus
abstraction absorbs the tab difference entirely.

### The `pymft` port — `utils/midi/mft/`

The protocol layer of <https://github.com/sina-cb/pymft> is ported from
Python to TypeScript (pure, dependency-free, unit-tested like the rest of
`utils/midi`). Three modules:

| Module | Ports (from pymft) | Contents |
|---|---|---|
| `mft/constants.ts` | `src/constants.py` | Device name (`"Midi Fighter Twister"`), DJTT sysex mfr id `00 01 79`, MIDI channel map (ch0 rotary, ch1 switch+colour, ch2 animation/brightness, ch3 system/banks/side-buttons, ch4 shift), relative-delta codes (61/62/63 = CCW very-fast/fast/normal · 65/66/67 = CW), bank + side-button CC tables (banks CC 0-3; side buttons CC 8-31, six per bank), colour-wheel values (1 blue · 50 green · 64 yellow · 80 red · 100 pink · 127 rainbow-cycle animation), `AnimationValues` (strobe/pulse/brightness), encoder-settings enums + sysex addresses 10-24 |
| `mft/messages.ts` | send/decode paths of `src/pymft.py` | **Builders:** `setRingValue(enc, v0to127)` → CC ch0 · `setColor(enc, wheel)` → CC ch1 · `setAnimation(enc, anim)` → CC ch2 · `selectBank(bank)` → CC ch3. **Decoders:** `decodeRelativeDelta(value)` → −3…+3 (null for non-relative values) · `decodeEncoderTurn` (ch0) · `decodeEncoderPush` (ch1) · `decodeSideButton` (ch3 CC 8-31 → `{bank, side, index}`) · `decodeBankChange` (ch3 CC 0-3 → active bank) |
| `mft/config.ts` | `src/encoder.py` + `src/config.py` | Sysex config push: per-encoder `BULK_XFER` frames (setting-address/value pairs, chunked in 24-byte parts, tag = encoder+1) + global `PUSH_CONF`. `buildConnectConfig()` forces all 64 encoders into the layout this doc assumes: **relative mode** (`MIDITYPE_SENDRELENC`), velocity-sensitive movement, switch = CC-hold on ch1, indicator = blended bar, detent off, per-bank base colours |

### Why RELATIVE encoders (not absolute)

pymft's own default config uses absolute CC + write-back sync; we deliberately
flip the MFT to **relative** for the rig:

- **No pickup problem, ever.** A relative knob holds no authoritative value —
  it sends deltas that we apply to the engine's *current* value. Focus
  switches, pattern advances, autopilot, a second iPad, an audio modulator
  moving the base: nothing can ever make the knob "disagree" and jump a
  param. (The APC's absolute faders need the whole soft-takeover machinery
  for exactly this reason; the MFT sidesteps it.)
- **Velocity handled host-side:** the firmware's fast/very-fast codes are
  treated as LINEAR relative counts (profile-tunable steps, default
  ±0.005 / ±0.01 / ±0.015 of full range — code ±n = n detents packed into one
  message). The speed FEEL is entirely the runtime's per-tick velocity gain
  (`utils/midi/accel.ts`): a smoothed turn-rate estimate (EMA over inter-tick
  transport timestamps) drives a continuous gain from sub-detent precision on
  slow turns up to a full-range sweep on a hard flick. Tuning constants +
  guide live in `accel.ts`.
- The ring LED is *display-only*, driven by our projector from live engine
  state — so the ring even animates when an audio modulator drives the param.

Config is pushed once on connect (idempotent). **Caveat (must verify on the
bench):** the sysex config push requires Web MIDI `sysex: true` (a second
Chrome permission prompt) — the transport requests it only when a loaded
profile declares `configureOnConnect: true`. Fallback if sysex is ever
unavailable: flash the same settings once from the bundled `.mfs` preset via
DJTT's MF Utility and run config-less; the runtime behaviour is identical.
Fail-loud rule: if `configureOnConnect` is set and sysex is denied, the MFT
chip goes red with the reason — never silently run against unknown encoder
modes.

### Knob layout

**Bank 1 — FOCUSED pattern local params (the headline feature):**

| Knob (row-major, 1 = top-left) | Drives | Ring | Colour |
|---|---|---|---|
| 1..16 | `focused.exports[i]` — the focused channel's active-pattern **sliders in declaration order** (same ordered list the MIDI-learn snapshot already carries; CPC-matched exports excluded) | live param value 0-127 (blended bar) | channel identity: deck = blue · overlay 1/2/3 = green/yellow/pink — the knobs themselves TELL you which channel is focused |
| — knob with no param behind it | inert (loud silence) | off | off |
| encoder **push** | reset that param to the playlist entry's saved default (switch configured as CC-hold on ch1; handled app-side via the entry's `defaults`) | — | — |

Turn → `delta × step` applied to the param's current **base** value →
`localParam` write through `setDeckChannelControl` /
`setMixerChannelControl` (clamped 0-1, coalesced ~30 Hz like every other
continuous control). For an audio-modulated param the delta applies to the
**modulation base** (the anchor the ◎ system exposes), not the moving
modulated value — turning a knob while the music pumps must shift the
anchor, not fight the modulator.

**Bank 2 — global params (CPC):** a curated, profile-declared list. As
shipped: knobs 1-3 → `speed` / `size` / `rotate` (the confirmed
[0,1]-normalised CPC floats), relative, with ring feedback from live CPC
values; the speed knob obeys the same BPM-sync rule as APC fader 7 (inert +
`RGB_TOGGLE_1_BEAT` strobe while sync owns speed). Knobs 4-16 reserved —
add keys to `mft.yaml` as Sina picks them (colour params are HSV, not
single-value relative-friendly; master lives on APC fader 9). **Banks 3-4 —
reserved** (dark; candidates: palette browser on rings, per-section
brightness).

Bank switching is hardware-local (side buttons); the device reports the
active bank on ch3 and the runtime tracks it for status display, but the
projector simply addresses all 64 virtual encoders — the device latches ring
state per bank, so every bank is always current when you land on it.

**Side buttons:** left column = bank up / bank down (hardware action, set in
the config push); left-3 (ch3 CC10) is **reserved and unmapped** — a manual
tap-tempo is intentionally NOT wired because `bpm_speed_sync.js` makes the
Audio Companion the sole tempo analyzer (2026-06-17 contract, no manual
override). Right column = **focus prev / focus next / focus deck** — a
secondary focus path so the MFT is self-sufficient when the APC is absent;
the APC track buttons remain the primary focus handler in the mixer.

### Mixer design in full (the focused-channel contract)

1. **One channel at a time.** The MFT never fans out across layers — it is
   always 16 knobs deep into ONE channel, per Sina's Chromatik workflow.
2. **Focus sources (all write the same shared focus state):** APC track
   buttons 1-3 (primary) · on-screen focus control in the mixer channel
   strips · MFT right-side buttons (prev/next/deck). Focus changes validate
   layer existence (absent layer → inert) and re-target atomically: knob
   deltas are held (not misrouted) for the brief window until the focused
   snapshot has actually swapped, then flow to the new channel.
3. **Feedback on every surface:** APC focused track-button LED lit · mixer
   UI focus highlight · MFT ring colour flips to the focused channel's
   identity colour and all 16 rings repaint to the new pattern's values
   within one engine tick.
4. **Interplay with MIDI-learn:** learned APC faders 4-6/8 and MFT knobs are
   two views of the same focused channel. A param can be BOTH learned to a
   fader and live on knob *i* — last writer wins at the engine (both write
   the same static value through the same endpoint), and both surfaces'
   feedback follows the engine state, so they can never fight. The MFT
   normally makes per-param learn unnecessary (ordered mapping covers all
   16), but learn remains the way to pin a *specific* param to a *fader* for
   muscle-memory-critical controls.
5. **What the MFT does NOT do in the mixer:** channel faders/levels (APC
   faders 1-3 own those); playlist browsing (APC pad columns); colour pairs
   (APC pads); blackout / effects (APC scenes). One surface, one job.

### Implementation deltas (what actually has to be built)

| Piece | Change |
|---|---|
| `utils/midi/mft/{constants,messages,config}.ts` | the pymft port (pure + unit tests, incl. sysex frame goldens against pymft's output) |
| `profile.ts` | new match `{type: cc, relative: true}`; new action kinds `focusedParamKnob {index, steps}`, `focusedParamReset {index}`, `paramCenterRelative {key, steps}`, `focusStep {dir: prev\|next\|deck}`, `tapTempo`; device gains `configureOnConnect` |
| `resolver.ts` | relative-CC decode via `mft/messages.decodeRelativeDelta` → delta actions (a relative control is `continuous` and coalesces per control id) |
| `manager.ts` runtime | `focusedParamKnob/Reset` handled next to the learn bindings (needs `focused.exports` + current base); delta accumulation between coalescer flushes; bank tracking from ch3 |
| `led_projector.ts` | generalise: LED state keyed by `(status byte, number)` not bare note; CC-out feedback (`ring`/`color`/`animation` led specs); ring values sourced from `focused.exports` + CPC values (snapshot gains `globalParamValues`) |
| `web_midi_transport.ts` | optional `sysex: true` request when any loaded profile sets `configureOnConnect` |
| `midi_profiles/mft.yaml` | driver #2 profile per the layout above |
| snapshot (`useMidiControl`) | expose modulation-base per export (anchor for deltas) + curated global param values |

Everything rides the existing `MidiManager` multi-controller core — the APC
and MFT run concurrently as two runtimes over the same dispatcher, snapshot,
and focus state. Zero engine changes again: knob writes land on the existing
per-control endpoints.

### MFT open questions (for Sina)

1. **Bank 2 beyond speed/size/rotate** — which other globals, in which order?
   (Those three ship now; HSV colour params don't fit a single relative knob.)
2. **Encoder push = reset-to-entry-default** (shipped) — right call, or prefer
   fine-adjust-while-held (the MFT's native `SWACTION_ENCFINEADJUST`)? Both
   can't share the push.
3. **Feel constants** — the per-tick velocity gain (`accel.ts`: GAIN_MIN /
   GAIN_MAX / HALF_RATE / CURVE_POWER / RATE_TAU / IDLE_RESET) right on the
   bench? Steps are now linear ±0.005/±0.01/±0.015 per relative count.
4. **Manual tap-tempo** — currently NOT wired (would break the sole-analyzer
   tempo contract). Want a manual tempo source? That's a deliberate engine
   change; default answer is no.

## Driver #3 — Intech Grid VSN1-L (the PUNCH surface) — IMPLEMENTED 2026-07

> **Status update (2026-07):** the VSN1 is now the live **Global Effects
> controller** — profiled, host-driven, with engine auto-deploy of the layout,
> DRUM/EFFECT view modes, small-button utilities, welcome-logo + page sync.
> The canonical, up-to-date reference is **[docs/42](42_vsn1_controller.md) →
> "Effects UI + auto-deploy"**. The planning notes below are kept for history;
> where they differ from docs/42, docs/42 wins.

The VSN1 is the **effects/punch** surface — the third verb the rig couldn't
speak. Hardware: 8 **analog hall-effect keys** (Gateron, continuous travel),
one high-precision endless **jog wheel**, 4 tactile buttons under an LCD
(left-screen variant), USB-C, Intech Grid modular line (open-source firmware,
per-control **Lua running ON the device**, configured via Grid Editor).

> **One verb: PUNCH.** Hold a key = effect ON; release = OFF. The APC keeps
> latched toggles; the VSN1 is for the drop.

### Integration contract (ideology-derived)

1. **MIDI-only seam.** CaptainPad speaks class-compliant MIDI to it — nothing
   else, same as every driver. All device intelligence (key actuation curves,
   LED rendering, screen drawing) lives ON-DEVICE in its Grid Lua config,
   authored once in Grid Editor and **vendored** in the repo
   (`CaptainPad/midi_profiles/grid_vsn1/` — exported config + notes), exactly
   like the APC reference doc and the MFT `.mfs` fallback. The screen renders
   from the same MIDI feedback we already send (Grid Lua has MIDI-rx hooks) —
   **never** a host-side daemon.
2. **Screen = bonus.** The widget API is still maturing; the rig must be 100%
   operable with the screen dark. Anything shown (focused channel name, last
   effect fired) is glanceable convenience only.
3. **Muscle-memory alignment:** the 8 keys mirror the APC scene column's
   effect ORDER (keys 1-7 = global-effect slots 1-7) so the operator's effect
   map is one map. Key 8 = **momentary blackout** (hold-to-black — the classic
   flash-to-black gesture; distinct from the APC's latched blackout toggle).
   Final layout is a bench decision when the unit arrives.
4. **v1 sketch for the rest:** jog wheel → focused channel's playlist browse
   (relative detents onto the existing `playlistScroll` machinery — zero new
   kinds); 4 tactile buttons → focus prev / focus next + 2 reserved (screen
   pages later). Key-depth (analog) → **Tier 2**: pressure→effect-intensity
   needs an engine-side per-effect intensity input — a deliberate engine
   decision, deferred; v1 uses on-device actuation thresholds (still
   momentary on/off over MIDI).

### What the mapping layer needs (buildable NOW, before the unit arrives)

- **Momentary / while-held action kinds** — the one real gap: v1 resolver
  swallows Note Off ("no momentary actions"). Add `globalEffectMomentary
  {slot}` (Note On → slot ON, Note Off → slot OFF) and `blackoutMomentary`
  (press → blackout on, release → off), with the resolver emitting
  press/release phases for momentary-kind controls only (latched kinds keep
  ignoring Note Off). Engine check: the GEM slot route takes an `action`
  verb — verify explicit `'on'`/`'off'` exist beside `'toggle'` (add them
  engine-side if not; small and backward-compatible).
- These kinds are hardware-agnostic: they also enable an optional APC
  **Shift-layer punch page** later, and they're fully unit-testable with the
  FakeTransport harness today.
- **Phase-0 bench capture when the unit arrives** (same ritual as the APC):
  endpoint names, default CC/note numbers per key/jog/button, analog key CC
  behaviour, MIDI-rx LED scripting check, screen hello-world. Then the final
  `grid_vsn1.yaml` profile + vendored Grid config land together.

### VSN1 open questions (bench-day)

1. Key 8 = momentary blackout — right call, or an 8th effect slot?
2. Jog = playlist browse vs focused-param fine-trim (both are one-line
   profile changes; pick by feel).
3. Which two things earn the reserved tactile buttons + screen page 1?

## Open questions (for Sina)

1. ~~**Default mapping intent**~~ — **answered by the 2026-06 bench
   iterations**: the unified layout above (channels + learn faders + focus
   buttons + browser/colour pads + scene column) IS the layout, evolved live
   with the hardware on the desk. (MFT-specific questions live at the end of
   the MFT section.)
2. **Pattern banks** — pads-to-patterns by list order is fragile as the
   pattern library grows. Pin pad→pattern names explicitly in the profile
   YAML (stable, but needs editing when patterns change), or by playlist?
   (Largely superseded by the per-channel playlist window browser, which is
   playlist-ordered by construction.)
3. **Which iPad** — is FoH iPad 1 the MIDI iPad, or should both be
   provisioned identically (no extra work either way; just affects the
   hardware checklist count)?
4. **APC40 mkII priority** — bench it for BM26, or is the mini mk2 the only
   show controller this year?
5. **EAS standing** — the runbook says preview-profile iOS credentials
   already live on EAS; phase 3 additionally needs a `development`-profile
   build and the dev iPad registered (`eas device:create`). Confirm the EAS
   account has build minutes to spare, since Windows-side native builds
   lean on the cloud.
