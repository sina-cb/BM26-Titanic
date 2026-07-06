# 2026-06-28 — Control Panel (LookingGlass) arcade-button firmware

## What

Stood up the **Control Panel** art piece's firmware from scratch: a new
top-level `LookingGlass/` subsystem with an ESP32-S3 PlatformIO project at
`LookingGlass/panel_firmware/`. The firmware reads six momentary arcade
buttons, debounces them, runs a per-button gesture state machine, and emits
structured event lines over native USB serial. Also wrote the full design doc
(`docs/38_control_panel.md`) covering the firmware as-built plus the planned
transport + host bridge.

The Control Panel (a.k.a. LookingGlass) is a **standalone, long-distance art
piece** deployed separately at BM26: a podium of arcade buttons; pressing a
button drives a small podium LED fixture. Firmware → (planned) Ethernet → Pi →
(planned) `panel_bridge` → MarsinEngine → podium LED.

## Why

It's a new, self-contained interactive piece. The firmware is deliberately
"dumb" (recognize gestures, emit a clean event stream) so the host side owns all
policy — same firmware-relay + Pi-bridge split the `control_podium` subsystem
already uses.

## Done this session

- **Worktree + branch.** Created the worktree and the `feat/control_panel_firmware`
  branch. **Not committed yet.**
- **New `LookingGlass/` dir** with `panel_firmware/` PlatformIO project:
  `platformio.ini`, `include/config.h`, `src/button.h`, `src/button.cpp`,
  `src/main.cpp`, plus `README.md` at both `LookingGlass/` and
  `panel_firmware/`.
- **Chip matched to BM26-Stoker:** **ESP32-S3R8** (16 MB flash, 8 MB octal
  PSRAM, native USB Serial/JTAG). Verified against the real chip via **esptool**
  this session. Board `esp32-s3-devkitc-1`, `memory_type = qio_opi`,
  `ARDUINO_USB_CDC_ON_BOOT=1`.
- **Two-layer Button** (`button.h`/`button.cpp`): millis-based debounce →
  gesture FSM (`Phase` ∈ Idle/Pressed/Hold/WaitSecond). Non-blocking, no
  `delay()`, all six buttons independent.
- **Gesture vocabulary:** `PRESS`, `RELEASE`, `SINGLE_CLICK`, `DOUBLE_CLICK`,
  `LONG_PRESS_START`, `HOLD`, `LONG_PRESS_STOP` — emitted as
  `EVT btn=<NAME> action=<ACTION> t=<ms>`. Plus a `STAT alive t=<ms>` heartbeat
  (every 2 s, `SERIAL_HEARTBEAT_MS`).
- **Centralized event sink** (`handle_event()`): logs, flashes the LED on press,
  routes to **7 empty action hooks** in `main.cpp` (where future behavior plugs
  in).
- **`BUTTON_TABLE` X-macro** in `config.h`: adding/renaming a button is a
  one-line edit (drives the enum, the event name, and the boot wiring).
- **Status LED:** onboard WS2812 on GPIO21 — green breathe heartbeat + blue
  flash on press.
- **Built clean** (no warnings on our sources), **flashed to the board on
  COM4**, **serial output verified** (boot banner, heartbeat, and live button
  events).

## Current state

- Working firmware on the bench. **Only ARCADE_4 (GPIO39) is physically wired**;
  the other 5 GPIOs are assigned in `config.h` but unwired, and the
  button → meaning mapping is deferred.
- **No networking yet.** Events live only on the USB serial console — Ethernet
  transport and the `panel_bridge` host service are designed but **not built**.
- Branch `feat/control_panel_firmware`, **not committed**.

## How to verify

```bash
cd LookingGlass/panel_firmware
pio run                                  # compile (clean)
pio run -t upload --upload-port COM4     # flash (hold BOOT if download mode fails)
pio device monitor                       # @115200 — banner, STAT every 2s, EVT on press
```

Press the wired ARCADE_4 button; expect `EVT btn=ARCADE_4 action=PRESS …` lines
and a blue LED flash.

## Next steps / follow-ups

- Confirm the **Ethernet hardware** — ESP32-S3 has no built-in MAC, so a direct
  Ethernet link implies an external SPI controller (W5500-class, as on
  BM26-Stoker). Verify the part + pinout before locking the wire protocol.
- **Wire the remaining 5 buttons** and define the real button → meaning mapping.
- **Define the on-wire event protocol** (ESP32 ↔ `panel_bridge`).
- **Build `panel_bridge`** at `LookingGlass/panel_bridge/` (host service on the
  Pi, by analogy to `control_podium/server_bridge`) + its event → MarsinEngine
  action map.
- Decide whether to **disable the dev heartbeat** for production.
- **Commit + push** the firmware.

## See also

Full design — built vs planned, hardware tables, gesture/timing tables, the
planned transport + bridge — in **`docs/38_control_panel.md`**.
