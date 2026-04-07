# 🎛️ Control Podium — Remote Show Control via Raw LoRa + BLE

## Concept

The Control Podium is a **remote, wireless show control station** for the TITANIC lighting installation. It enables a lighting operator (or participant, in interactive mode) to trigger scene changes, cue transitions, and activate effects on the main visual server **without any physical cable**.

Two Heltec WiFi LoRa V4 controllers form a **point-to-point radio link** over raw LoRa at 915 MHz. Each controller also exposes a **BLE GATT server** for phone monitoring and command injection. A PySide6 **Control Center** desktop app provides real-time serial + BLE status for both nodes.

> **Why raw LoRa, not Meshtastic?**
> Bench testing (March 2026) revealed that Meshtastic firmware adds **2–15 seconds of unpredictable latency** to every message — even on SHORT_FAST with two nodes at point-blank range (SNR 11–13, RSSI -56). This is caused by CSMA/CA scheduling, managed flooding, next-hop routing, and ACK retry logic, none of which can be disabled. For real-time cue triggering, this is unacceptable. See [Appendix A: Meshtastic Rejection](#appendix-a-meshtastic-rejection) for full details.

---

## System Architecture

```
┌────────────────────────────────────┐        Raw LoRa (915 MHz)       ┌────────────────────────────────────┐
│         CONTROL PODIUM             │       SF7 / BW250 / CR4/5       │           VISUAL SERVER            │
│                                    │    ~46 ms airtime per packet     │                                    │
│  ┌──────────┐   ┌──────────────┐   │  ◀══════════════════════════▶   │  ┌──────────────┐  ┌───────────┐  │
│  │ Buttons  │──▶│  Heltec V4   │   │       bidirectional link        │  │  Heltec V4   │─▶│ Server PC │  │
│  │          │   │  (Podium TX) │   │                                  │  │  (Server RX) │  │           │  │
│  └──────────┘   │              │   │                                  │  └──────────────┘  │ Chromatik │  │
│  ┌──────────┐   │  USB + BLE   │   │                                  │                    │ DMX / LED │  │
│  │ Phone    │···│  GATT Server │   │                                  │                    └─────┬─────┘  │
│  │ (nRF)    │   └──────────────┘   │                                  │                          │        │
│  └──────────┘                      │                                  │                   ArtNet / sACN   │
└────────────────────────────────────┘                                  │                          │        │
                                                                        │                   ┌──────▼──────┐ │
     ┌───────────────────────────────────────────────────────────┐       │                   │ DMX Fixtures│ │
     │              CONTROL CENTER (Desktop Monitor)             │       │                   └─────────────┘ │
     │  PC ↔ USB ↔ [Podium] ~~~LoRa~~~ [Server] ↔ USB ↔ PC     │       └────────────────────────────────────┘
     │  PySide6: 2 NodeCards, USB/BLE/LoRa badges, msg panes    │
     └───────────────────────────────────────────────────────────┘
```

---

## Hardware

### Bill of Materials

| Component | Spec | Qty | Notes |
|-----------|------|-----|-------|
| **Heltec WiFi LoRa V4** | ESP32-S3 + SX1262 + OLED | 2 | One podium (TX), one server (RX) |
| **USB-C cables** | Data-capable | 2 | Connect to podium PC and server PC |
| **Momentary buttons** | IP65, illuminated | 5 | Connected to podium GPIO (future) |
| **Phone** | iOS/Android with nRF Connect | 1 | Optional — BLE monitoring/commands |

### Current Hardware Identities

| Node | USB MAC (serial_number) | BLE Address | COM Port |
|------|------------------------|------------|----------|
| **Podium** | `8C:FD:49:B5:7E:B8` | `8C:FD:49:B5:7E:B9` | COM13 |
| **Server** | `8C:FD:49:B5:42:90` | `8C:FD:49:B5:42:91` | COM14 |

> [!NOTE]
> ESP32-S3 BLE address = USB MAC + 1. Both are stored in config: USB MAC in `.config.pairing.yaml`, BLE address discovered at runtime by the monitor app.

---

## Firmware

### Overview

Custom firmware built with PlatformIO using the [ropg/heltec_esp32_lora_v3](https://github.com/ropg/heltec_esp32_lora_v3) library (wraps RadioLib with Heltec auto-config). Despite "v3" in the name, it is fully compatible with Heltec V4 — same ESP32-S3 + SX1262 pin mapping.

**Current version:** `1.2-ble-cmd`

### Firmware Architecture

```
firmware/
├── platformio.ini          — Build config (podium_tx + server_rx envs)
└── src/
    ├── titanic_common.h    — Shared radio init, OLED display helpers
    ├── titanic_ble.h       — BLE GATT server (14 characteristics)
    ├── podium_tx/main.cpp  — TX node: serial → LoRa, BLE commands
    └── server_rx/main.cpp  — RX node: LoRa → serial, event dispatch
```

### Radio Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Frequency** | 915.0 MHz | FCC-compliant US ISM band |
| **Bandwidth** | 250.0 kHz | Wide for speed |
| **Spreading Factor** | SF7 | Fastest; ~46 ms airtime for 30 bytes |
| **Coding Rate** | 4/5 | Standard error correction |
| **TX Power** | 22 dBm | Can go to 28 dBm for longer range |
| **Modulation** | LoRa | FSK available for <10ms at shorter range |

### Serial Protocol

The firmware communicates with the host PC via USB-CDC serial at 115200 baud:

```
Host → Firmware:   <payload>\n                    → transmits payload over LoRa
Firmware → Host:   TX_OK\n                       → transmission succeeded
                   TX_FAIL:<code>\n                → transmission failed
                   RX:<payload>:RSSI=<r>:SNR=<s>\n → LoRa packet received
                   BLE_CMD: <msg>\n                → command received via BLE
                   READY\n                         → firmware booted
```

### TX Node (Podium)

- Reads serial input non-blocking (character-by-character, no 1000ms timeout)
- On newline: transmits the payload over LoRa via `radio.transmit()`
- Also accepts commands from BLE (phone can trigger LoRa TX)
- After TX, switches to RX mode for bidirectional response
- OLED displays last TX message + counter

### RX Node (Server)

- Continuously listens for LoRa packets
- On receive: outputs `RX:<payload>:RSSI=<r>:SNR=<s>` to serial
- Also handles serial input for bidirectional TX back to podium
- OLED displays last RX message + RSSI/SNR

### Latency Budget

| Segment | Latency |
|---------|---------|
| Serial input → firmware parse | < 1 ms |
| `radio.transmit()` | ~46 ms (SF7/BW250) |
| Firmware RX → serial output | < 1 ms |
| Companion parse → action | < 5 ms |
| **Total end-to-end** | **~50 ms** |

This is **40–300× faster** than Meshtastic's measured 2–15 seconds.

---

## BLE GATT Server

Each controller advertises a BLE GATT server with a custom Titanic service for phone monitoring and command injection.

### Advertising

| Property | Value |
|----------|-------|
| **Device name** | `Titanic-Podium` / `Titanic-Server` |
| **Service UUID** | `a0e3f001-1c3d-4b60-a0e3-000000000000` |
| **Pairing** | "Just Works" (automatic via NimBLE v2) |

### Characteristics

| UUID Suffix | Name | Access | Description |
|-------------|------|--------|-------------|
| `...0001` | Role | Read | `PODIUM_TX` or `SERVER_RX` |
| `...0002` | FW Version | Read | e.g. `1.2-ble-cmd` |
| `...0003` | Uptime | Read | Seconds since boot |
| `...0010` | TX Count | Read | Total packets transmitted |
| `...0011` | RX Count | Read | Total packets received |
| `...0012` | Last RSSI | Read | dBm of last received packet |
| `...0013` | Last SNR | Read | dB of last received packet |
| `...0020` | Frequency | Read | Radio frequency (MHz) |
| `...0021` | SF | Read | Spreading factor |
| `...0022` | Bandwidth | Read | Bandwidth (kHz) |
| `...0023` | TX Power | Read | Transmit power (dBm) |
| `...0030` | **Command** | **Write** | Send LoRa command from phone |
| `...0031` | Last RX | Read | Last received LoRa payload |

### Phone Usage

1. Install **nRF Connect** (iOS/Android)
2. Scan → find `Titanic-Podium` or `Titanic-Server`
3. Connect → browse service `a0e3f001-...`
4. Read stats (RSSI, SNR, uptime, counters)
5. Write to **Command** characteristic → triggers LoRa TX

> [!NOTE]
> BLE security uses NimBLE v2's automatic "Just Works" pairing. Explicit `setSecurityAuth()`/`setSecurityIOCap()` calls were removed because they crash NimBLE v2 on ESP32-S3.

---

## Software Stack

### Three-File Config System

```
control_podium/
├── .config.yaml            — Static config (committed): nodes, radio, serial, protocol
├── .config.pairing.yaml    — Hardware identity (gitignored): usb_mac, ble_address
└── .config.deploy.yaml     — Deploy state (gitignored): ports, BLE names, status
```

**Pairing schema:**
```yaml
nodes:
  podium:
    usb_mac: "8C:FD:49:B5:7E:B8"
    ble_address: null                 # Populated by monitor BLE scan
  server:
    usb_mac: "8C:FD:49:B5:42:90"
    ble_address: null
```

**Deploy schema:**
```yaml
last_deploy: "2026-03-23T04:00:00+00:00"
firmware_version: "1.2-ble-cmd"
deployed_nodes:
  podium:
    usb_port: "COM13"
    ble_name: "Titanic-Podium"
    ble_address_last_seen: "8C:FD:49:B5:7E:B9"
    last_status: "deployed"
  server:
    usb_port: "COM14"
    ble_name: "Titanic-Server"
    ble_address_last_seen: null
    last_status: "deployed"
```

### CLI (`config.py`)

```bash
python config.py status    # Show nodes, USB/BLE status, radio, deploy info
python config.py pair      # Auto-detect boards by USB MAC, write pairing
python config.py deploy    # Build + flash firmware via deploy.py
python config.py test      # Run HIL test suite
python config.py monitor   # Launch Control Center desktop app
```

### Deploy Script (`deploy.py`)

Automated firmware build + flash pipeline:

1. Loads config, resolves COM ports by USB MAC
2. Builds PlatformIO environments (`podium_tx`, `server_rx`)
3. Flashes via esptool with `--after hard_reset` for auto-reboot
4. Verifies firmware boot (`READY` response)
5. Runs optional ping test (bidirectional LoRa)
6. Writes rich deploy state to `.config.deploy.yaml`

### Companion Scripts

| Script | Purpose |
|--------|---------|
| `companions/podium_companion.py` | Interactive serial terminal for podium node — send commands, view responses, ping test |
| `companions/server_companion.py` | Interactive serial terminal for server node — dispatches `titanic:` events by type |
| `companions/control_center.py` | PySide6 desktop monitor (see below) |

### Control Center Monitor App

PySide6 desktop window showing real-time status of both controllers:

| Feature | Source |
|---------|--------|
| **USB status badge** (🟢/🔴) | COM port open/closed state |
| **BLE status badge** (🟢/🔴) | Periodic BLE scan via `bleak` |
| **LoRa status badge** (🟢/🔴) | Recent `TX_OK` or `RX:` serial activity |
| **RSSI / SNR display** | Parsed from `RX:` serial lines |
| **TX / RX counters** | Incremented on each serial event |
| **Message pane** | Color-coded scrolling log per node |
| **Command bar** | Type → send via serial → LoRa TX |
| **Target toggle** | Switch send target (podium ↔ server) |
| **Connection diagram** | `PC ↔ USB ↔ [Podium] ~~~LoRa~~~ [Server] ↔ USB ↔ PC` |

Launch: `python config.py monitor`

### BLE Discovery Backend

| Module | Purpose |
|--------|---------|
| `utils/ble_discovery.py` | Scan for `Titanic-*` devices by name + service UUID, match to config roles |
| `utils/ble_client.py` | GATT client — connect, read stats, send commands, verify role |
| `utils/serial_parser.py` | Shared serial protocol parsing (RX, TX_OK, BLE events) |

---

## Dependencies

```
pyserial          — USB serial communication
pyyaml            — Config file parsing
bleak>=0.21       — Windows BLE scanning and GATT client
PySide6>=6.6      — Desktop monitor GUI
```

Install: `pip install -r control_podium/requirements.txt`

---

## Development & Testing

### Automated Tests

```bash
# Unit tests (config migration, BLE matcher logic)
python -m pytest tests/test_config_migration.py tests/test_ble_discovery.py -v --noconftest

# HIL tests (requires both boards connected)
python -m pytest tests/ -v -s
```

### Manual Verification

1. `python config.py status` — confirm both nodes ONLINE
2. `python config.py monitor` — verify message flow
3. Type `titanic:scene:sunset` in command bar → verify TX_OK on podium, RX on server
4. Open nRF Connect on phone → verify BLE advertising names visible

---

## Event Protocol

All events use the `titanic:` prefix followed by an event identifier:

| Format | Example | Description |
|--------|---------|-------------|
| `titanic:scene:<name>` | `titanic:scene:sunset` | Trigger scene change |
| `titanic:cmd:<action>` | `titanic:cmd:blackout` | System command |
| `titanic:fx:<name>` | `titanic:fx:pulse` | Trigger effect |
| `titanic:ping` | `titanic:ping` | Latency test |
| `titanic:pong` | `titanic:pong` | Ping response |

The server companion parses the event type and dispatches to the appropriate action (Chromatik scene recall, DMX command, MarsinEngine pattern switch, etc.).

---

## Future Extensions

| Extension | Complexity | Notes |
|-----------|------------|-------|
| **GPIO buttons on podium** | Medium | Wire 5 buttons to ESP32-S3 GPIO, add debounce in firmware |
| **BLE auto-pair from PC** | Low | Monitor already discovers BLE addresses; add persistent pairing |
| **Encryption** | Medium | AES-128 in firmware — LoRa payload encryption |
| **FSK mode** | Low | Change one line: `radio.beginFSK(...)` for <10ms latency at shorter range |
| **Multi-podium** | Medium | Server deduplicates by event ID + timestamp window |
| **Bidirectional scene confirm** | Low | Server TX back current scene name; podium displays on OLED |

---

## Appendix A: Meshtastic Rejection

> [!CAUTION]
> Meshtastic was the original design choice but was rejected after bench testing due to unacceptable latency.

### The Problem

Meshtastic is a **mesh messaging protocol**, not a real-time control link. Even with two nodes at close range on `SHORT_FAST`:

| Feature | Purpose | Latency Hit |
|---------|---------|-------------|
| CSMA/CA | Listen-before-talk | 0–200 ms random backoff |
| Managed Flooding | Rebroadcast for mesh reach | Adds hop delays (even at hop_limit=1) |
| Next-Hop Routing | Track best relay path | ~5–15 s on first contact |
| ACK/Retry | Reliable delivery | Up to 30 s on retries |
| Packet Scheduling | Queue and pace outgoing | Variable, firmware-controlled |

**Measured result:** 2–15 seconds per message. Unpredictable. Not configurable.

### Comparison

| | Meshtastic | Raw LoRa (current) |
|---|---|---|
| **Latency** | 2–15 s (measured) | **~50 ms** |
| **Reliability** | ACK + 3 retries | Fire-and-forget + app-layer ACK |
| **Phone monitoring** | ✅ BLE app shows all traffic | ✅ Custom BLE GATT server |
| **Firmware complexity** | Stock firmware | ~80 lines per node + shared BLE |
| **OLED display** | ❌ Not via Python API | ✅ Built-in status display |
| **Mesh routing** | ✅ Multi-hop | ❌ Point-to-point only |
| **Encryption** | ✅ AES-256 PSK | ❌ Plaintext (add later if needed) |

### Reverting to Meshtastic

If mesh networking is needed later, Meshtastic can be re-flashed:
```bash
python -m meshtastic --flash-firmware
# Or: https://flasher.meshtastic.org
```
No hardware changes — only firmware differs.
