# `control_podium/firmware/` — Heltec Radio Firmware

This directory holds the **on-radio firmware** for the LoRa controllers in
the Titanic camp. There are exactly two firmware variants — they live in
the same PlatformIO project and share `src/titanic_common.h`:

| Env         | Source folder           | Role on the mesh                                                |
|-------------|-------------------------|-----------------------------------------------------------------|
| `podium_tx` | `src/podium_tx/`        | **Client radio.** Captain (`0x0A`, `0x0B`) and crew (`0x10+`) handhelds. |
| `server_rx` | `src/server_rx/`        | **Server radio (`0x01`).** The one Heltec the Pi bridge talks to over USB. |

Both variants build from the **same** `titanic_common.h` (battery readout,
OLED, LoRa init, BLE GATT, IRQ-poll RX) — the only difference is which
`src/<env>/main.cpp` PlatformIO compiles in via `build_src_filter`. That
keeps display, battery, and radio behaviour identical across the mesh.

> **Audience:** developers flashing new firmware, adding a new node to the
> mesh, or debugging a board that won't boot. For the protocol the firmware
> implements, see `docs/07_control_podium.md` §3 and §6.

---

## 🚀 Quick Start

Compile and flash the firmware:

```bash
# 1. List connected Heltec boards and their MAC address pairings
cd control_podium/firmware
python3 deploy.py --list

# 2. Flash a client (captain handheld) node locally (e.g. node 0x0A)
python3 deploy.py --node 0x0A

# 3. Flash the server radio remotely via the Raspberry Pi
cd ../..
PYTHONPATH=control_podium python3 -m server_bridge.deploy --firmware-only
```

---

## Why MAC-locked deploys

We have multiple Heltecs plugged into the same workstation during HIL.
Without a guard, `pio run -e server_rx -t upload` will happily flash
**whichever** ttyUSB it finds first — meaning a captain handheld can be
silently turned into the server radio (or vice versa) the moment two
boards are connected at once. That is at best a confusing two-hour debug,
at worst a safety-relevant misconfiguration once we have nodes deployed
in the field.

`deploy.py` solves this by recording each role's USB MAC in
`../.config.nodes.yaml` and **refusing to flash** unless the connected
board's MAC matches the role we're targeting. ESP32-S3 surfaces its
factory MAC as the USB-CDC serial number, so we can see it via pyserial
without round-tripping through esptool.

The result: once a board has been "claimed" for a role, the only way to
re-flash a different board into that role is to explicitly clear the
pairing first.

---

## `deploy.py` — the only flashing entry point

Always flash with `deploy.py` from this directory (or from the repo root
with `python control_podium/firmware/deploy.py`). Direct `pio run …`
invocations bypass the MAC guard.

### Common operations

```bash
# 1. Show what's claimed in YAML and what's currently plugged in.
python deploy.py --list

# 2. Flash by node id.
python deploy.py --node 0x01            # server radio
python deploy.py --node 0x0A            # captain handheld "sina"

# 3. Flash by role (only works when exactly one node has that role).
python deploy.py --role server
python deploy.py --role captain

# 4. Compile only — no upload, no MAC check needed.
python deploy.py --node 0x0A --build-only

# 5. Skip the post-flash banner / sanity check (faster, less safe).
python deploy.py --node 0x01 --no-verify
```

---

## Remote vs. Local Flashing

We support two distinct flashing paths depending on whether the target radio is in your hand (local) or installed in the server rack (remote).

### 1. Local Flashing (Workstation / HIL Bench)
Use this path when the Heltec radio is plugged directly into your development machine:
* **Target**: Captain handhelds (`podium_tx`) or a server radio being tested locally on the bench.
* **Requirements**: Workstation must have PlatformIO installed (`pio` command available).
* **Command**:
  ```bash
  python deploy.py --node 0x0A
  ```
* **Guardrails**: If multiple boards are plugged in, `deploy.py` intercepts the upload and verifies that the board's USB MAC matches the node entry in `.config.nodes.yaml` before flashing, preventing accidental role-swaps.

### 2. Remote Flashing (Raspberry Pi)
Use this path when the server Heltec is installed inside the road case and plugged into the Raspberry Pi:
* **Target**: Server radio (`server_rx` on node `0x01`).
* **Requirements**: SSH access to the Pi configured in `control_podium/server_bridge/.ssh.secret`.
* **Command (run from your laptop)**:
  ```bash
  # Flash firmware only (leaves Python bridge code alone)
  PYTHONPATH=control_podium python3 -m server_bridge.deploy --firmware-only

  # Deploy new bridge code AND flash the server firmware
  PYTHONPATH=control_podium python3 -m server_bridge.deploy --firmware
  ```
* **How it works under the hood**:
  1. **Build Local**: The laptop builds the `server_rx` environment using PlatformIO (takes ~30s instead of ~5m on the Pi's CPU).
  2. **Ship Binaries**: Copies the 4 output files (`bootloader.bin`, `partitions.bin`, `boot_app0.bin`, and `firmware.bin`) to `/opt/titanic-bridge/firmware-images/` on the Pi.
  3. **Release Port**: Stops the bridge service (`sudo systemctl stop titanic-bridge`) to release the exclusive lock on `/dev/ttyACM0`.
  4. **Flash Remote**: Runs `esptool` inside the Pi's venv to write the flash over the Pi's local USB port.
  5. **Resume**: Restarts the bridge service and verifies the new boot banner in the journal logs.

---


### First-time pairing

When a node has no `usb_mac:` field in `.config.nodes.yaml` yet:

* If **exactly one** plugged-in Heltec has a MAC that isn't already
  claimed by another node, `deploy.py` will offer to auto-pair it
  (single `[y/N]` prompt) and then proceed.
* If 0 boards are unclaimed (everything is already paired) or >1 boards
  are unclaimed (it can't tell which one you mean), it refuses and asks
  you to disambiguate with `--pair`:

  ```bash
  python deploy.py --node 0x0A --pair
  ```

  This prompts you to pick from the unclaimed boards by serial number.

### Re-pairing (you replaced the hardware)

```bash
python deploy.py --node 0x0A --clear      # forget node 0x0A's MAC pairing
python deploy.py --node 0x0A              # next deploy will auto-pair the
                                          # currently-plugged unclaimed board
```

To wipe every pairing in one shot (rarely needed):

```bash
python deploy.py --clear-all
```

YAML edits go through `ruamel.yaml`, so the giant header comment block in
`.config.nodes.yaml` survives round-tripping unchanged.

### Verifying after a flash

`deploy.py` re-opens the serial port after upload and waits for the
firmware's startup banner (`TITANIC` / `radio ready`) before declaring
success. If you don't see the banner inside the timeout window, the most
likely causes are:

* The board hung mid-boot (usually a cabling / power issue — try a known-
  good USB cable and a powered hub).
* Wrong build flag combination (rare, only after you edit
  `platformio.ini` or `titanic_common.h`).
* Serial monitor still attached in another terminal — close it.

---

## Source layout

```
firmware/
├── platformio.ini              # heltec_base + podium_tx + server_rx envs
├── deploy.py                   # MAC-locked role-aware flasher
├── variants/
│   └── heltec_v3_ropg/         # custom variant: SPI/OLED/LoRa pin macros
└── src/
    ├── titanic_common.h        # SHARED — battery, OLED, LoRa, BLE, IRQ-poll RX
    ├── titanic_ble.h           # SHARED — BLE GATT layout (NimBLE)
    ├── podium_tx/main.cpp      # client radio entrypoint
    └── server_rx/main.cpp      # server radio entrypoint
```

### What `titanic_common.h` does

It's the bulk of the firmware. Every behaviour that should be identical
between client and server lives here:

* **LoRa init** with the firmware-author-tuned SX1262 settings (BW, SF,
  CR, TX power). Boot also configures the radio to call our IRQ on RX
  done so the main loop never blocks on `radio.receive()`.
* **OLED + 3-stage idle timeout** (`ACTIVE` → `DIM` after
  `OLED_FULL_SEC`, → `OFF` after another `OLED_DIM_SEC`). DIM still
  renders a heartbeat (name + battery + uptime) so a sleeping screen
  doesn't look like a dead device. Any PRG press or BLE pairing
  request jumps straight back to ACTIVE.
* **Battery readout** via the V3.2/V4 divider on GPIO1 with a 5-state
  classifier (`USB`, `FULL`, `OK`, `LOW`, `CRIT`) and a
  `LOW BATT → SLEEP` deep-sleep guard at 3.10 V.
* **Non-blocking LED scheduler** so the TX heartbeat doesn't insert
  `delay(30)` calls between transmits — that delay used to swallow ACKs
  arriving <110 ms after a TX.
* **IRQ-poll RX** so the radio is always armed for the next frame between
  TX bursts. Dropped the host-side `pre_send_delay_s=0.15` workaround.

`NODE_ID` is injected by `deploy.py` as a `-DNODE_ID=0x…` build flag
based on whichever node id you're flashing. The firmware uses it for
status labels and the BLE INFO page; the actual addressing is enforced
in software on the host side.

`BLE_NODE_NAME` is also injected by `deploy.py`, sourced from the
`name:` field in `.config.nodes.yaml`. The firmware concatenates it
with the fixed `tcon_` prefix to produce its BLE advertised name —
e.g. node 0x0A (`name: sina`) advertises as `tcon_sina`. A plain
`pio run` (no deploy.py) falls back to `tcon_node` so a quick re-
flash for code-change testing still works without a node id.

### What `titanic_ble.h` does

Defines the BLE GATT service that CaptainPad / a paired phone speaks to:
the existing v1 Command + Last-RX characteristics, plus the placeholder
for the §13.5 Frame TX / Frame RX-stream / link-health characteristics
that the iPad app will need when it eventually drives the radio
directly. **Today the BLE layer is unused in the host-companion
topology** — the captain laptop talks USB-CDC and the firmware is a
pure ASCII byte relay.

---

## What the firmware does NOT do

These are intentional non-features:

* **No protocol parsing.** The firmware never inspects `<typ>`, `<src>`,
  `<arg>`, or any other Titanic-frame field. It transmits whatever ASCII
  string the host writes (followed by `\n`) and relays whatever ASCII
  string it receives back over USB-CDC as `RX:<payload>:RSSI=…:SNR=…\n`.
  All ACL, allowlist, secret, replay-window, and engine-bridging logic
  lives in `companions/bridge_companion.py` on the host. (See
  `docs/07_control_podium.md` §3.6.8b for why.)
* **No AEAD in firmware (yet).** The host-side companions hold the AES
  key and produce already-encrypted `T2|…` frames. The firmware sends
  them verbatim. This stays true until/unless CaptainPad sends commands
  BLE→Heltec→radio without a host in the loop (`docs/07_control_podium.md`
  §13.5 / Milestone 20). At that point the secret will be baked in via a
  build flag during deploy — not before.
* **No fire path.** This firmware never drives a solenoid, never bypasses
  a deadman, and the bridge would refuse the command anyway. The Flame
  Effect Controller (FW-SPEC-001) is a completely separate firmware on
  separate hardware (WT32-ETH01) with a completely different protocol.
* **No backward compat with v1.** This branch is v2-only. Any handheld
  still on v1 firmware is incompatible with the current bridge and must
  be re-flashed via `deploy.py`.

---

## When you change firmware

1. Build both envs locally before pushing:
   ```bash
   python deploy.py --node 0x01 --build-only
   python deploy.py --node 0x0A --build-only
   ```
2. Flash both real boards and run the HIL acceptance demo:
   ```bash
   PYTHONPATH=. python -m control_podium.companions.hil_companion_demo
   ```
   This sends real `cmd` / `qry` / `pin` frames over real radio against a
   real engine and asserts engine-state changes. If it doesn't print
   `ALL CHECKS PASSED`, do not merge.
3. Rebuild `mesh_demo.py` only changes when you modify `comms/` — the
   firmware doesn't change its outputs from the sim's perspective.
