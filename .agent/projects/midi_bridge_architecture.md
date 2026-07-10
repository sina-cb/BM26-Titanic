---
name: midi_bridge_architecture
status: active
owner: Sina (operator) / coordinator agent
created: 2026-07-08
updated: 2026-07-08
---

# MIDI bridge architecture — CaptainPad as the engine↔device bridge

## The question (Sina, 2026-07-08)

> Page controls and effect controls are not propagated from CaptainPad to the
> MIDI device. If we want the MIDI controls attached to CaptainPad, are we
> blocked on anything in this design? I assume CaptainPad must be the sole
> handler of the MIDI, bridging engine and device. Plan: computer for now,
> iPad fully after the party.

**Headline answer: NOT blocked.** CaptainPad is *already* the sole runtime
MIDI handler by design, and the engine→device propagation path already exists
in code. The symptom is a deployment/topology fact plus in-flight Track C/T
work — not a missing architectural piece. The one permanent carve-out is the
**serial config flash** (vsn1_config / deploy_layout), which is a computer
tool forever and was never MIDI in the first place.

## Current-state map (verified in code, 2026-07-08)

### Who touches the device, on what host, over what wire

| Path | Wire | Code | Host today |
|---|---|---|---|
| **Runtime MIDI, in** (keys/encoder/jog → engine writes) | USB **MIDI** | `CaptainPad/utils/midi/` — transport → `decodeMidi` → `resolveEvent` → coalescer → `dispatch.ts` → `utils/api.ts` REST | Computer: CaptainPad **web build in desktop Chrome** (`:6967`), device on the computer's USB |
| **Runtime MIDI, out** (LEDs, ring, LCD values, page, welcome) | USB **MIDI** | engine WS/REST → `hooks/useMidiControl.ts` snapshot → `manager.onEngineUpdate()` → `projectAndSend()` → `projectLeds` / `sendVsn1Feedback` (diffed; full re-sync on page change) → `transport.send` | Same Chrome instance |
| **Layout config deploy** (slot names/colors → device Lua, flash) | USB **serial** (Grid protocol, NOT MIDI) | engine `lib/vsn1_layout_deploy.js` hook → child process `node tools/vsn1_config/deploy_layout.cjs --layout <file> --live` | Computer (engine host) |
| **Discovery / profiling** (dev only) | Web MIDI in a browser | `marsin_engine/tools/midi_discovery/serve.cjs` (`:6979`) | Computer, Chrome |

Nothing else touches device MIDI. The engine has **no MIDI stack at all**
(node native MIDI packages are codex-forbidden; the discovery tool exists
precisely because of that). So the answer to "is CaptainPad already the sole
MIDI handler?" is **yes — at runtime, by construction**. The engine's only
physical device path is the serial *config* channel, which is a different
wire, a different protocol, and (by the effects_v2 design) deliberately never
used for runtime values ("knob twists never trigger flash writes").

### The transport seam (the load-bearing design decision)

`utils/midi/transport.ts` is a **frozen 5-call interface** with two planned
implementations (docs/34 §1):

- `WebMidiTransport` (`web_midi_transport.ts`) — `navigator.requestMIDIAccess`,
  **desktop Chromium only**. This is what runs today. Selection is
  capability-based in `utils/midi/index.ts` (`getMidiTransportKind()`).
- `NativeMidiTransport` — iPad CoreMIDI Expo module,
  **designed but not built** (docs/34 phase 3; `isNativeMidiAvailable()` is a
  stub returning `false`).

Everything above the transport (profiles `midi_profiles/{apc_mini_mk2,mft,
vsn1}.yaml`, resolver, coalescer, dispatcher, LED/VSN1-feedback projectors,
the React hook) is transport-agnostic and byte-identical across hosts. That
freeze exists exactly so the host can move from computer to iPad later
without touching the mapping stack.

### The propagation path Sina asked about — it exists

UI page/effect controls do go through the engine, and the engine does drive
the device — verified end-to-end in code:

1. `GlobalEffectMacros.tsx` page switch → `setEffectsPage()` →
   `PATCH /global-effects/page` (engine = single source of truth).
2. Engine broadcasts `{type:'effectsPage', effectsPage}` on WS; slot changes
   broadcast `*globaleffect*` messages.
3. `useMidiControl.ts` subscribes, refreshes `_snapshot.effectsPage` /
   `_snapshot.globalEffectSlots`, calls `manager.onEngineUpdate()`.
4. Every runtime's `projectAndSend()` → `sendVsn1Feedback()` emits the pinned
   MIDI feedback contract (Note/CC on ch1/ch2 — actives, values, modes, page
   CC 40, sb LEDs, hello) to the device; the on-device Lua renders it.

**Why it can still LOOK unpropagated:** steps 3–4 only execute inside a
CaptainPad instance that *has a MIDI transport* — i.e. the web build in
desktop Chrome on the computer the device is plugged into. If the operator is
driving the UI from the iPad app or any browser tab without the device, the
engine state updates fine, but no MIDI-capable instance exists to forward it
— the device goes stale. Add the in-flight Track C/T items (cross-page
CONFIG ACK device bug, `deploy_layout.cjs` integration, uncommitted
`dispatch/profile/resolver` work on this branch) and you get exactly the
observed symptom. **None of it is a design gap.**

## Blocker analysis — CaptainPad as sole bridge on the computer, today

Required pieces vs status:

| Requirement | Status |
|---|---|
| CaptainPad runtime with device MIDI access | ✅ Web MIDI in desktop Chrome (`:6967` web build) |
| Inbound dispatch to engine (REST `:6968`) | ✅ built + tested (`dispatch.ts`, per-slot coalescing) |
| Engine→device feedback (state mirror) | ✅ built (`sendVsn1Feedback`, page full-resync, welcome) |
| Engine as single source of truth (multi-surface lockstep) | ✅ `effectsPage` + slot state engine-owned, WS broadcast |
| Device config/layout deploy | ✅ engine-invoked serial child process — **out of CaptainPad's scope, stays a computer tool** |

**Blocked: no.** What remains is operational discipline + bug-fixing:

1. **Exactly ONE MIDI-capable CaptainPad instance.** Web MIDI is not
   exclusive: two Chrome tabs both running CaptainPad would each dispatch the
   same inbound MIDI → double REST writes (a mode-cycle would advance twice).
   Rule: one Chrome window on the show computer is the bridge; every other
   surface (iPad, phones) is touch-only.
2. **Keep the bridge tab foreground/visible.** Chrome throttles background-tab
   timers; inbound Web MIDI events still fire but the ~30 Hz coalescer flush
   and reconnect debounce ride `setTimeout`. A dedicated always-visible
   window (or `--disable-background-timer-throttling` in the launch shortcut)
   removes the risk.
3. **Grant sysex** on the Chrome prompt (MFT `configureOnConnect` requests
   it; denial goes loudly red by design).
4. **Serial port exclusivity:** a layout deploy (engine → serial) and Grid
   Editor can't both hold the port; runtime MIDI is unaffected (different
   wire). Close Grid Editor; deploys fail loudly if the port is busy.
5. Finish the in-flight Track C/T items on `feat/party_integration_20260711`.

### Config deploy vs runtime MIDI — the split, stated once

- **Runtime MIDI** (notes/CC both directions): CaptainPad's job, sole handler.
- **Config deploy** (layout → per-element Lua → flash): the **engine's** job,
  over USB **serial**, via `tools/vsn1_config/` — a pre-playa/operator-
  workstation tool chain (GPL deps in gitignored node_modules, port-exclusive,
  dry-run gated). It is NOT in scope for CaptainPad, on any host, ever. This
  split is already a locked decision in `effects_v2_midi_layout.md`
  ("runtime values go over MIDI feedback, never flash writes").

## iPad feasibility (post-party target)

### The hard facts

- **Safari/WebKit has no Web MIDI and never shipped it.** The CaptainPad web
  build on the iPad can never be the bridge. Full stop — this is why the
  native transport exists in the design.
- **CoreMIDI on iPadOS handles class-compliant USB MIDI natively.** Both FoH
  iPads are iPad (10th gen), USB-C. APC mini mk2, MFT, and the VSN1 (USB-C,
  250 mA, class-compliant) all enumerate through a powered PD hub. The hub
  also charges the iPad all night — required kit regardless.
- **The gap is one native module**: an in-repo Expo Module (Swift + CoreMIDI,
  ~200–300 lines) implementing the frozen `MidiTransport` 5-call surface —
  `modules/captain-midi/` per docs/34 §1a. Wiring point already exists
  (`isNativeMidiAvailable()` / `selectTransportFactory()` in
  `utils/midi/index.ts`). Everything above it is unchanged by contract.
- **Build path**: EAS cloud build from Windows (`eas build --profile
  development`, then `preview`) — needs internet, so it must land **before
  the playa**. After the native module freezes, all iteration is JS via Metro
  hot-reload (Ring 2, no Mac). A Mac is needed only for native crash
  debugging or an offline native rebuild (Ring 3).
- **Sysex is easier natively**: the MFT's connect-time config push needs no
  permission prompt under CoreMIDI (that's a Web MIDI-ism).
- **iPadOS gotchas (bench-gate them)**: iPad unlocked when the accessory is
  first attached; CaptainPad foreground for MIDI delivery → run in **Guided
  Access**; CoreMIDI endpoint *names* may differ from Chromium's for the same
  ports — the profiles' `nameContains` + `portIndex` pinning is designed to
  absorb this, but verify with MIDI Wrench before blaming code.
- **Bluetooth MIDI is not a real alternative**: CoreMIDI supports BLE-MIDI,
  but the VSN1, MFT, and APC are USB-only devices — and docs/34's playa-first
  doctrine is wired-USB anyway. Not pursued.

### What can NEVER move to the iPad

- **The serial config path.** iPadOS has no user-space USB-serial: no Web
  Serial in Safari, and native serial requires MFi/DriverKit machinery that
  is out of all proportion. `vsn1_config/` (read/write/restore/
  deploy_layout) **stays a computer tool permanently**, invoked by the engine
  (which also lives on the computer). Same for Grid Editor and
  `midi_discovery`.
- **Consequence — the one real architectural trade of the iPad move:** a
  device plugged into the iPad is physically unreachable by the engine's
  serial deploy. **Layout auto-deploy (a flash write) requires re-plugging
  the VSN1 into the computer.** This is acceptable because the design already
  quarantines flash writes to rare layout *changes* (runtime values are MIDI
  feedback), but it must become a documented ritual: edit layout → replug to
  computer → engine deploys → replug to iPad → CaptainPad reconnects, sends
  welcome + full re-sync (that path is built: `requestVsn1Welcome` +
  full-frame resync on reconnect).

## Phased plan

### Phase 0 — NOW / party (computer is the MIDI host)

Keep, don't build. The computer runs the whole bridge stack:

1. **Topology:** VSN1 (+ MFT/APC) plugged into the show computer. One Chrome
   window runs the CaptainPad web build (`:6967`) as **the** MIDI bridge
   instance — foreground, sysex granted. iPad and any other clients are
   touch-only UIs; all surfaces converge through engine state (`:6968`).
2. **Rules of engagement:** exactly one MIDI-capable instance (no second
   Chrome tab with the device); bridge tab stays visible; close Grid Editor
   except during deploys.
3. **Finish in-flight work** (Track C/T of `effects_v2_midi_layout.md`):
   cross-page CONFIG ACK device bug, `deploy_layout.cjs` engine integration,
   the uncommitted `dispatch/profile/resolver` changes — then run the
   full-stack smoke + the connection tests the dossier mandates
   (engine↔UI, engine↔MIDI feedback, layout→deploy trigger).
4. **Verification gate:** flip the page in CaptainPad UI on ANOTHER device
   (iPad) → VSN1 LCD/sb LEDs follow via the computer bridge; toggle a slot
   on the VSN1 → iPad UI follows. That round-trip proves the party topology.

### Phase 1 — post-party (iPad becomes the MIDI host)

1. **Build `modules/captain-midi/`** — Expo Module, Swift + CoreMIDI,
   implementing the frozen 5-call `MidiTransport` (enumerate by
   name+portIndex, open source/destination, send, midiMessage +
   endpointsChanged events, hotplug via `kMIDIMsgObjectAdded/Removed`).
   Wire `isNativeMidiAvailable()` + the factory in `utils/midi/index.ts`.
2. **EAS `development` build from Windows** (needs internet — schedule
   pre-playa if the party slips that direction); register the iPad
   (`eas device:create`); iterate JS over Metro with the VSN1 on the iPad's
   powered hub.
3. **iPad bench gate** (mirrors the APC phase-4 ritual): MIDI Wrench endpoint
   name capture → adjust `nameContains`/`portIndex` in the three profiles if
   CoreMIDI names differ → full mapped-control pass against engine + sim →
   unplug/replug soak → Guided Access check.
4. **Freeze the native module, ship a `preview` build** before leaving —
   on-playa fixes are then JS-only.
5. **Stays on the computer:** engine, serial layout deploys (with the
   documented replug ritual), Grid Editor, midi_discovery. The desktop-Chrome
   web build remains the **degraded/fallback bridge mode** (it costs nothing
   to keep — same code, capability-selected).

**Risks (Phase 1):** endpoint-name drift between Chromium and CoreMIDI
(absorbed by profile pinning; verify first); EAS dependency = internet +
build minutes (front-load it); iPadOS foreground/lock delivery rules (Guided
Access is the mitigation); the layout-deploy replug ritual (accepted trade);
native-crash debugging needs a Mac (freeze early, keep the surface tiny).

## Decision / recommendation

**Cleanest architecture = exactly what's built, with the host migrating.**
CaptainPad is the sole runtime engine↔device MIDI bridge (it already is);
the engine stays the single source of truth every surface mirrors; the
serial config/flash path stays engine-invoked on the computer forever. Phase
0 requires zero new architecture — only topology discipline and finishing
the in-flight effects_v2 tracks. Phase 1 is one small, already-designed
Swift module behind a frozen interface, plus a bench gate. Do not add any
second MIDI stack (engine-side node MIDI, standalone bridge daemons) — that
recreates the Bomebox problem the design explicitly rejected (docs/34,
"iPad is a must").

## Links

- **Design doc:** `docs/34_captainpad_midi.md` (transport freeze §1, native
  module §1a, Ring 1–3 build topology, VSN1 driver §Driver #3)
- **Device doc:** `docs/42_vsn1_controller.md`;
  `marsin_engine/tools/vsn1_config/README.md` (serial protocol + feedback
  contract); `marsin_engine/tools/midi_discovery/README.md`
- **Sibling dossier:** `.agent/projects/effects_v2_midi_layout.md` (32-slot
  layout, `effectsPage`, deploy pipeline — Tracks C/T finish inside it)
- **Code anchors:** `CaptainPad/utils/midi/{transport,web_midi_transport,
  index,manager,dispatch}.ts`, `CaptainPad/hooks/useMidiControl.ts`,
  `marsin_engine/lib/vsn1_layout_deploy.js`
- **Branch:** `feat/party_integration_20260711`

## Decisions log

- **2026-07-08** — CaptainPad confirmed as the sole runtime MIDI handler;
  computer-hosted Chrome web build is the Phase 0 bridge; iPad native
  CoreMIDI transport is the Phase 1 target. (this review)
- **2026-07-08** — serial config flashing (vsn1_config / deploy_layout) is
  permanently computer-side; iPad-era layout deploys use a replug ritual.
  (this review)

## Next steps

- [ ] Phase 0: enforce single-bridge topology at the party (one Chrome
      instance, foreground, sysex granted)
- [ ] Phase 0: land Track C/T fixes + run the round-trip verification gate
- [ ] Phase 1: build `modules/captain-midi/` + EAS dev build (pre-playa
      internet window)
- [ ] Phase 1: iPad bench gate (endpoint names, soak, Guided Access) →
      freeze module → preview build
