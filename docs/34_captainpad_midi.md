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

**Non-Goals (v1)**

- No on-iPad mapping editor / MIDI-learn UI. Profiles are YAML in the repo;
  learn mode is a v2 candidate.
- No APC40 mkII profile in v1 (structure supports it; profile authored when
  the unit is on the bench).
- No engine-side changes: no new endpoints, no WS command path. If REST
  coalescing ever proves too slow, a WS param channel is a separate doc.
- No Bluetooth MIDI, no Bomebox integration, no Android.
- No support in the CaptainPad **web** build (Safari has no Web MIDI; the
  module is iOS-native). Web build compiles unchanged with the feature
  absent — `isMidiAvailable()` is the explicit capability gate, and the
  Config tab says "MIDI: not available on this platform" rather than hiding.

---

## Architecture

Three layers, strictly separated:

```
┌──────────────────────────────────────────────────────────────┐
│ 1. modules/captain-midi/        (Expo Module, Swift)         │
│    CoreMIDI client · endpoint enumeration · input events     │
│    → JS  · sendMidi() for LED feedback · hotplug notifs      │
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

### 1. Native module — `modules/captain-midi/`

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
| `blackoutToggle` | `setGlobalBlackout(!current)` | `POST /global-blackout` |
| `globalEffect` | `setGlobalEffect(effect, state)` | `POST /global-effect` |
| `sectionBrightness` | `setSectionBrightness(id, v)` | `POST /section-brightness` |
| `groupFixedColor` | `setGroupFixedColor(group, …)` | `PUT /group-fixed-colors/:g` |
| `master` | master-fader dispatch (same path the mixer view uses) | existing |

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

## Build & deployment impact

- Adds a native module ⇒ **`npx expo prebuild --platform ios --clean` is
  required once** before the next `xcodebuild` (runbook
  `.agent/00_gol/09_build_ipad_release.md` §1.4 step 2 — already part of the
  documented flow). Subsequent JS-only edits keep the 3–5 min warm rebuild.
- EAS preview builds pick the module up automatically (local Expo Modules
  are part of the uploaded archive).
- No new npm dependencies at runtime; the YAML profile rides the existing
  transformer. Offline rules untouched.
- Auto-checks: standard `.agent/00_gol/03_captain_pad_auto_checks.md` suite
  (`tsc --noEmit`, lint, `web:build` — the web build doubles as the
  capability-gate regression test).

## FoH hardware checklist (procurement)

1. Powered USB-C hub with PD passthrough (iPad charging + controller power
   from one wall plug) — the report's pricing survey suggests ~$40–100.
2. USB-B → USB-A cable (APC's own) + the hub's A port, or USB-B→C cable.
3. The existing Bomebox stays in the road case as the documented fallback
   path to a laptop/Chromatik rig — unrelated to and unaffected by this
   feature.

---

## Implementation plan

| Phase | Scope | Files |
|---|---|---|
| 0. Bench gate | APC mini mk2 → hub → FoH iPad → **MIDI Wrench**: confirm enumeration, note the exact endpoint names/ports/velocity colors iPadOS reports (they feed the profile). No code until this passes. | — (notes into the Notion card) |
| 1. Native module | `modules/captain-midi/` (Swift + Expo Module config), enumeration/open/send/events, hotplug | `CaptainPad/modules/captain-midi/*` (new) |
| 2. Mapping layer | profile schema + loader + validator, event→action resolver, coalescer, LED projector — **pure TS, unit-testable without hardware** | `CaptainPad/utils/midi/*` (new), `CaptainPad/midi_profiles/apc_mini_mk2.yaml` (new) |
| 3. Integration | `useMidiControl` hook, RootShell mount, header chip, Config tab section, capability gate for web | `CaptainPad/hooks/useMidiControl.ts` (new), `app/_layout.tsx`, Config tab |
| 4. Verification | auto-checks suite; hardware pass: every mapped control observed end-to-end against a running engine + sim (full-stack smoke skill), LED repaint on replug, unplug/replug soak | report in `.agent/02_reports/` |
| 5. (later) | APC40 mkII profile · MIDI-learn editor · WS param channel if REST coalescing ever measures slow | — |

Phases 1–3 are independently landable; phase 2 carries the test weight since
it's hardware-free.

## Open questions (for Sina)

1. **Default mapping intent** — the profile above sketches faders → CPC
   params + master, bottom pad row → pattern bank, one button → blackout. Is
   that the layout you want to start from, or should v1 mirror the 2025
   Chromatik muscle memory more closely?
2. **Pattern banks** — pads-to-patterns by list order is fragile as the
   pattern library grows. Pin pad→pattern names explicitly in the profile
   YAML (stable, but needs editing when patterns change), or by playlist?
3. **Which iPad** — is FoH iPad 1 the MIDI iPad, or should both be
   provisioned identically (no extra work either way; just affects the
   hardware checklist count)?
4. **APC40 mkII priority** — bench it for BM26, or is the mini mk2 the only
   show controller this year?
