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

**Non-Goals (v1)**

- No on-iPad mapping editor / MIDI-learn UI. Profiles are YAML in the repo;
  learn mode is a v2 candidate.
- No APC40 mkII profile in v1 (structure supports it; profile authored when
  the unit is on the bench).
- No engine-side changes: no new endpoints, no WS command path. If REST
  coalescing ever proves too slow, a WS param channel is a separate doc.
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
| 5. (later) | — | APC40 mkII profile · MIDI-learn editor · WS param channel if REST coalescing ever measures slow | — |

Phases are independently landable. Phase 2 ends with the feature genuinely
usable (a Windows laptop running Chrome at FoH is a legitimate degraded
mode); phase 3–4 promote it onto the iPad. One known risk to verify early
in phase 4: **endpoint display names may differ between Chromium and
CoreMIDI** for the same APC ports — the profile's `nameContains` +
`portIndex` pinning is designed to absorb this, but the iPad bench gate
confirms it before anything is declared done.

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
5. **EAS standing** — the runbook says preview-profile iOS credentials
   already live on EAS; phase 3 additionally needs a `development`-profile
   build and the dev iPad registered (`eas device:create`). Confirm the EAS
   account has build minutes to spare, since Windows-side native builds
   lean on the cloud.
