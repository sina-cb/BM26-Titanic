# `control_podium/` — TITANIC LoRa Mesh + Bridge

Everything that lives between the **iPad / laptop in the captain's hand**
and the **MarsinEngine running the show** lives in this directory.

The system is a **half-duplex LoRa mesh** of small `T2|…` ASCII frames
(authenticated + encrypted with AES-128-GCM) that carries operator
commands and engine status between Heltec V4 radios. A host-side
**bridge companion** translates those frames into REST/WebSocket calls
against the LAN MarsinEngine and publishes engine state back over the
air. Multiple **client companions** (captain handhelds + crew read-only
nodes) sit on the other side of the airwaves.

> **One source of truth for the design:** [`docs/07_control_podium.md`](../docs/07_control_podium.md). Read that first when picking up new work — it's the protocol spec, the topology, the milestones, and the bring-up plan all in one place.

---

## 🚀 Quick Start

Get the simulated environment up and running instantly:

```bash
# 1. Run the local mock mesh simulation (no hardware needed)
cd control_podium
PYTHONPATH=. python3 -m companions.mesh_demo -q

# 2. Run the unit & integration test suite
PYTHONPATH=. pytest tests/ -q
```

---

## System Architecture & Components

The Titanic control system consists of several dedicated components collaborating across different protocols and network layers.

```
                  ┌───────────────┐
                  │  PortWatch    │ (iOS App)
                  └───────┬───────┘
                          │ BLE (Passkey, Encrypted)
                          ▼
                  ┌───────────────┐
                  │ podium_tx     │ (Client Heltec Radio)
                  └───────┬───────┘
                          │ LoRa (915 MHz, AES-GCM)
                          ▼
                  ┌───────────────┐
                  │ server_rx     │ (Server Heltec Radio)
                  └───────┬───────┘
                          │ USB-CDC Serial
                          ▼
                  ┌───────────────┐
                  │ server_bridge │ (Python Pi Service)
                  └───────┬───────┘
                          │ HTTP REST / WebSocket
                          ▼
                  ┌───────────────┐
                  │ MarsinEngine  │ (Show Control Engine)
                  └───────────────┘
```

1. **LoRa Mesh Network Protocol**:
   * Encrypted and authenticated with AES-128-GCM (Titanic Frame v2 `T2|` format) to secure communications over public RF bands.
   * Engineered for half-duplex channels with strict payload constraints to maximize reliability and minimize airtime.
   * Reference: [`docs/07_control_podium.md`](../docs/07_control_podium.md).

2. **Heltec Radio Firmware (`firmware/`)**:
   * Shared C++ codebase compiled for Heltec V3/V4 radios using PlatformIO.
   * Supports two roles: Client (`podium_tx`) and Server (`server_rx`).
   * Implements dynamic power profiles (HIGH/LOW TX power) to preserve battery on handhelds, NVS-persisted radio settings, and an OLED multi-page display.
   * Reference: [`control_podium/firmware/README.md`](firmware/README.md).

3. **Raspberry Pi Bridge (`server_bridge/`)**:
   * A lightweight Python application running as a systemd service (`titanic-bridge.service`) on the server-attached Raspberry Pi.
   * Decrypts and authenticates LoRa frames, resolves access control, translates command parameters into MarsinEngine API calls, and broadcasts telemetry.
   * Reference: [`control_podium/server_bridge/README.md`](server_bridge/README.md).

4. **PortWatch Field-Ops App (`PortWatch/`)**:
   * A standalone React Native/Expo iOS app for remote field operations.
   * Communicates with the client Heltec over BLE to let operators trigger patterns, blackout the rig, switch playlists, adjust master brightness, and view system health.
   * Reference: [`control_podium/PortWatch/README.md`](PortWatch/README.md).

5. **Host Companions & Protocol Core (`companions/`, `comms/`)**:
   * Command-line utilities, simulation bus daemons, and developer tools for local integration testing.
   * Reference: [`control_podium/companions/README.md`](companions/README.md) and [`control_podium/comms/README.md`](comms/README.md).

---


## What lives where

```
control_podium/
├── README.md                  ← (this file) high-level orientation
├── AGENTS.md                  ← rules for AI/human agents working here
├── .config.nodes.yaml         ← node id ↔ role ↔ USB-MAC pairing (committed)
├── .config.commands.yaml      ← cmd/qry allowlist + per-cmd role gating (committed)
├── .config.bridge.yaml        ← bridge runtime: engine URL, pub cadence (committed)
│
├── comms/                     ← THE PROTOCOL: frames, AEAD, replay window,
│                                ACL, registry, sim_bus, USB-CDC + sim transports,
│                                Pi-bridge runtime, MarsinEngine REST client.
│                                See comms/README.md for the module map.
│
├── companions/                ← HOST-SIDE APPS that drive the radios:
│                                client_companion (captain/crew CLI),
│                                bridge_companion (server-side translator),
│                                + 3 acceptance demos (mesh / hil_secured / hil_full).
│                                See companions/README.md.
│
├── firmware/                  ← C++ FIRMWARE for the Heltec radios:
│                                src/podium_tx/ (client), src/server_rx/ (server),
│                                src/titanic_common.h (shared logic),
│                                deploy.py (MAC-locked role-aware flasher).
│                                See firmware/README.md.
│
├── tests/                     ← pytest unit + e2e-sim suite. Run with
│                                PYTHONPATH=. pytest control_podium/tests/ -q
│
└── utils/                     ← Small shared helpers (USB MAC discovery,
                                 serial parser used by RadioPortSerial).
```

The fourth piece of the system that doesn't live here:

* **`marsin_engine/secret.yaml`** — the shared AES-128 pre-shared key.
  Single source of truth across the whole TITANIC stack (this subsystem,
  the engine, and any future CaptainPad iPad app). **Gitignored**, with
  `marsin_engine/secret.yaml.example` checked in as the template.
  Companions refuse to start without this file.

---

## The two-app production topology

```
[captain laptop]                                            [bridge laptop / Pi]

companions/client_companion.py        LoRa air        companions/bridge_companion.py
   │  (does AEAD)                     (T2 frames)        │  (does AEAD + replay window)
   ▼                                                     ▼
USB-CDC ──→ Heltec 0x0A ─────────────────────────→ Heltec 0x01 ──→ USB-CDC
            (firmware = byte relay)                   (firmware = byte relay)

                                                                  HTTP / WS
                                                                       │
                                                                       ▼
                                                          MarsinEngine (10.1.1.172:6968)
                                                                       │
                                                                       ▼
                                                          DMX / sACN → fixtures
```

Both companions can run on the same laptop today (with both Heltecs
plugged into the same machine). Splitting them across hosts later is a
no-code change — the engine URL is in YAML and the USB-MAC pairing is
per-host.

The Heltec firmware never decodes a frame, never parses ACL, never holds
the AES key, and never speaks to MarsinEngine. It is a pure ASCII byte
relay between USB-CDC and the SX1262 — and that simplicity is the whole
reason this design works on a $30 board.

---

## How to develop in here

### Day-to-day loop (no hardware needed)

```bash
# from the repo root
cd control_podium
PYTHONPATH=. ../.venv-dev/bin/python -m companions.mesh_demo -q
```

That spins up the simulated radio bus + the bridge + a captain client +
a crew client + a mock MarsinEngine, and asserts wire shapes AND engine
state changes. Must print `ALL CHECKS PASSED — mesh is HIL-ready` and
exit 0. This is the baseline check before any change.

For the unit suite:

```bash
PYTHONPATH=. ../.venv-dev/bin/python -m pytest control_podium/tests/ -q
```

(Run from the repo root, with `PYTHONPATH=.`. The test imports use
absolute paths like `from control_podium.comms.replay import …`.)

### When you change the protocol

Touchpoints, in order:

1. `comms/frame.py` (encoding / decoding) — must round-trip.
2. `comms/secure.py` (AEAD codec) — must hold the test vector at
   `tests/test_comms_secure.py`.
3. `comms/replay.py` (per-source counter window).
4. `comms/bridge.py` (dispatch).
5. `tests/test_comms_e2e_sim.py` — add the new behaviour as an end-to-end
   assertion, NOT just a unit test.
6. Mesh demo + HIL demos pass.

### When you change the firmware

See [`firmware/README.md`](firmware/README.md). Short version:

```bash
PYTHONPATH=. python -m control_podium.firmware.deploy --node 0x01 --build-only
PYTHONPATH=. python -m control_podium.firmware.deploy --node 0x0A --build-only
# then with the boards plugged in:
PYTHONPATH=. python -m control_podium.firmware.deploy --node 0x01
PYTHONPATH=. python -m control_podium.firmware.deploy --node 0x0A
PYTHONPATH=. python -m control_podium.companions.hil_companion_demo
```

The `deploy.py` script refuses to flash a board whose USB MAC isn't
paired in `.config.nodes.yaml`, so you can't accidentally turn a captain
handheld into the server radio when both are plugged in.

### When you add a new operator command

1. Add the entry to `.config.commands.yaml` with the right role
   (`captain` for write commands, no role gate for queries).
2. Implement the dispatch in `comms/bridge.py` (one method on
   `EngineClient` + one branch in `_exec_cmd`).
3. Add a sim-bus assertion in `tests/test_comms_e2e_sim.py`.
4. Re-run `mesh_demo.py` then `hil_companion_demo.py`.

### When you add a new node (radio handheld)

1. Add the entry to `.config.nodes.yaml` (next free id, `name`, `role`).
2. Plug the new Heltec in.
3. `python -m control_podium.firmware.deploy --node 0x<id>` — first
   deploy will offer to auto-pair the USB MAC.
4. The bridge picks up the new node on next start. No code change needed.

---

## What this subsystem is deliberately NOT

These three things are explicitly **out of scope** here. If you need
them, they live elsewhere — please don't reintroduce them:

* **Cooldowns / rate limiting** — pacing of slider drags, debouncing of
  pattern picks, per-knob throttles. That's the captain UI's job (the
  `client_companion.py` interactive loop, and eventually CaptainPad).
  The bridge is the protocol, not the politeness layer.
* **Fire-effect commands** — the Flame Effect Controller (FW-SPEC-001)
  is a separate firmware on separate hardware (WT32-ETH01) with a
  separate protocol. The radio mesh has **no** fire path; the bridge
  HARD-rejects any cmd containing `fire` regardless of role.
* **Long-range visual control surface** — that's its own program / its
  own firmware. When it ships it will join this mesh as a `captain`-role
  client driving the same `cmd` allowlist, but its hardware, button
  mapping, and operator UX are not this subsystem's problem.

See [`docs/07_control_podium.md`](../docs/07_control_podium.md) §1 (Why a
new design) and §17 (Workflow for future agents) for the full reasoning.

---

## Where to look first

| You want to…                                       | Read this                                                     |
|----------------------------------------------------|---------------------------------------------------------------|
| Understand the protocol / topology / threat model  | [`docs/07_control_podium.md`](../docs/07_control_podium.md)   |
| Run captains + bridges on real hardware            | [`companions/README.md`](companions/README.md)                |
| Flash a Heltec or pair a new board                 | [`firmware/README.md`](firmware/README.md)                    |
| Add a new command / role / wire-shape              | [`comms/README.md`](comms/README.md)                          |
| Set up the shared AEAD secret on a new machine     | [`marsin_engine/secret.yaml.example`](../marsin_engine/secret.yaml.example) |
| Verify the system after any change                 | `companions.mesh_demo` (sim), `companions.hil_companion_demo` (HIL) |
