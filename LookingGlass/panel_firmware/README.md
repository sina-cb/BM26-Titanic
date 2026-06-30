# `LookingGlass/panel_firmware/` — Arcade Control-Panel Firmware

Firmware for the **LookingGlass control panel**: a 6-button arcade box built on a
Waveshare **ESP32-S3-Pico**. It debounces the buttons and recognizes gestures —
instant **Press/Release**, **single-** and **double-click**, and a full **hold
lifecycle** — so a button can act as a low-latency trigger *or* a hold control.
Right now every gesture is just logged to the serial console; the action hooks are
stubbed and ready for real behavior (lighting cues, USB-HID, host messaging, …).

```
EVT btn=ARCADE_4 action=PRESS t=12345              # instant down-edge (trigger)
EVT btn=ARCADE_4 action=RELEASE t=12410
EVT btn=ARCADE_4 action=SINGLE_CLICK t=12660       # confirmed single tap
EVT btn=ARCADE_4 action=DOUBLE_CLICK t=13100       # two quick taps
EVT btn=ARCADE_4 action=LONG_PRESS_START t=14000   # HOLD begins
EVT btn=ARCADE_4 action=HOLD t=14200               # repeats while held
EVT btn=ARCADE_4 action=LONG_PRESS_STOP t=14850    # HOLD ends (released)
```

### Gestures & timing

| Gesture            | When it fires                                              | Tunable (`config.yaml`) |
|--------------------|-----------------------------------------------------------|----------------------|
| `PRESS` / `RELEASE`| Instantly on each debounced edge — use for triggers.      | `DEBOUNCE_MS` (15)   |
| `SINGLE_CLICK`     | One tap with no second tap (after the double window).     | `DOUBLE_PRESS_MS` (250) |
| `DOUBLE_CLICK`     | Two taps within the double window.                        | `DOUBLE_PRESS_MS` (250) |
| `LONG_PRESS_START` | Press held past the hold threshold.                       | `LONG_PRESS_MS` (600) |
| `HOLD`             | Repeats on an interval while held — hold usage.           | `HOLD_REPEAT_MS` (200) |
| `LONG_PRESS_STOP`  | Released after a hold.                                     | —                    |

> `PRESS`/`RELEASE` are the raw, zero-latency edges (they fire on *every* physical
> press, including each tap of a double). `SINGLE_CLICK`/`DOUBLE_CLICK`/`LONG_*` are
> the de-duplicated, gesture-aware stream. Use whichever layer fits the button.

## Hardware

- **Board:** Waveshare ESP32-S3-Pico — **ESP32-S3R8** (dual-core Xtensa LX7, 16 MB
  flash, 8 MB octal PSRAM, native USB, onboard WS2812 RGB LED on GPIO21). Same
  silicon as the BM26 Stoker controller.
- **Buttons:** 6 momentary, normally-open. Each is wired `GPIO -> switch -> GND` and
  read with the internal pull-up, so they are **active-low** (pressed = LOW).
- **Power:** external 24 V → buck → 5 V into VSYS. USB-C is for flashing + serial.
- **Serial console:** the bench board exposes the ESP32-S3 **native USB Serial/JTAG**
  on its USB-C port (it enumerates under VID `303A`), so it shows up as a normal COM
  port at **115200 baud** — the same port you flash over. (If a board instead routes
  serial through a UART bridge on UART0/GPIO43-44, set `ARDUINO_USB_CDC_ON_BOOT=0` in
  `platformio.ini`.)

### Button → GPIO map

| Net       | GPIO | Direction |
|-----------|------|-----------|
| ARCADE_1  | 15   | input, active-low |
| ARCADE_3  | 16   | input, active-low |
| ARCADE_4  | 39   | input, active-low — the one wired today |
| ARCADE_5  | 40   | input, active-low |
| NO_BUTTON | 41   | input, active-low |
| *(lamp)*  | 18   | **output** — illuminated-button lamp (PWM): dim at rest, full while ARCADE_4 held |

> GPIO18 was previously `ARCADE_2`; it is now the **button-lamp output** (a button
> input and the lamp output can't share a pin). Configure it via the `lamp.*`
> keys in `config.yaml`.

### ⚠ Reserved pins — never reassign a button to these

| Pins             | Why                                          |
|------------------|----------------------------------------------|
| 33,34,35,36,37   | Octal PSRAM                                  |
| 19,20            | Native USB D-/D+ (USB Serial/JTAG console)   |
| 43,44            | UART0 (secondary UART path)                  |
| 0,3,45,46        | Strapping pins (boot mode / flash voltage)   |
| 21               | Onboard WS2812 status LED                    |
| 18               | Button-lamp output (illuminated button)      |

## Toolchain

[PlatformIO](https://platformio.org/) with the Arduino-ESP32 framework. There is a
single build environment, `panel` (see `platformio.ini`).

## Build & flash

```bash
cd LookingGlass/panel_firmware

pio run                      # compile
pio run -t upload            # compile + flash over USB-C
pio device monitor           # open the serial console @ 115200
```

**If the upload can't enter download mode** (esptool keeps retrying or prints
`Failed to connect`), put the board into the bootloader by hand:

1. Hold the **BOOT** button (GPIO0).
2. While holding BOOT, plug in USB-C (or tap RESET).
3. Release BOOT, then run `pio run -t upload` again.

Target a specific port with `pio run -t upload --upload-port COM4`
(or `/dev/ttyACM0` on Linux/macOS).

## Deploy (registry-locked)

`deploy.py` is the **canonical flash path**. It verifies the connected board's
ESP32 MAC against an allowlist in a deployment registry **before** flashing, so
you can never flash the wrong board by accident. A direct `pio run -t upload`
**bypasses** this guard — prefer `deploy.py`.

**1. Provide the env vars (once).** The deploy registry (the MAC allowlist) and
the build secrets are **not** in this repo — they come from a private, external
deployment source that exports the two environment variables `deploy.py` and the
build read:

- **`$BM26_DEPLOY_REGISTRY`** (or `$STOKER_DEPLOY_REGISTRY`) → the deploy registry (MAC allowlist)
- **`$BM26_SECRETS`** (or `$STOKER_SECRETS`) → the WiFi/AP build secrets

If those vars are not exported, the build and the deploy **fail loudly** — there
is no local fallback. The registry's `target_allow` map decides which board MAC
is allowed for each deploy **target**; the panel's target is **`looking_glass`**
(the default), which allows the panel controller. To re-target a different
physical board, register its MAC for the `looking_glass` target in the registry —
there is no local `device.mac`. Read a board's MAC with
`python -m esptool --port COM4 read-mac`.

**2. Deploy:**

```bash
cd LookingGlass/panel_firmware

python deploy.py              # detect Espressif boards, verify against the registry, then flash the allowed board
python deploy.py --list       # print the target's allowed boards + connected boards (no flash)
python deploy.py --build-only # compile only (no registry/MAC check, no upload)
python deploy.py --target NAME # registry deploy target (default: looking_glass)
python deploy.py --port COM7  # force a port (still registry-verified unless --force)
python deploy.py --pick       # interactively choose a board to flash
python deploy.py --force      # skip the registry/MAC guard (emergency only; prints a loud warning)
```

Behavior: exactly one connected board allowed for the `looking_glass` target is
flashed automatically. **No match**, **no board**, a **missing registry/env var**,
or an **unknown target** all fail loudly with a clear message — `deploy.py` never
guesses. It reads each board's MAC via `python -m esptool --port <COM> read-mac`
(esptool v5) and enumerates Espressif boards by USB VID `0x303A` (pyserial).
PyYAML is required to read the registry.

## What it does

- Configures the five button-input pins as `INPUT_PULLUP` at boot (GPIO18 is the
  illuminated-button **lamp output**, ON while its source button is held).
- Debounces each button (15 ms default) with `millis()`-based timing, then runs a
  small per-button gesture state machine — the main loop never calls `delay()`, so
  every button is independent, responsive, and simultaneous-safe.
- Emits the gesture stream above (`PRESS`/`RELEASE`/`SINGLE_CLICK`/`DOUBLE_CLICK`/
  `LONG_PRESS_START`/`HOLD`/`LONG_PRESS_STOP`), one greppable line per event.
- Emits a periodic `STAT alive t=…` heartbeat (every 2 s) so the link is observable
  without a reset or a button press. Set `firmware.serial_heartbeat_ms` to `0` in
  `config.yaml` to disable.
- Prints a startup banner with the firmware version and the live button → pin map.
- Optional onboard WS2812 status LED (GPIO21): a slow green heartbeat, plus a brief
  blue flash on any press. Toggle with `status_led.enabled` in `config.yaml`.

## Where to add real button behavior

Everything you'd customize lives in three places:

- **`config.yaml`** — **all tunables**: firmware identity, serial, button timing,
  the lamp (`lamp.dim` / `lamp.full` / `lamp.source` / …), the status LED, and the
  network. Edited here and baked into the firmware at build time by
  `scripts/gen_config.py` (no C edit needed to retune behavior).

- **`include/config.h`** — the **button → GPIO map** (`BUTTON_TABLE`) and the
  reserved-pin list (structural / hardware-fixed). Adding or renaming a button is a
  **one-line** edit to the `BUTTON_TABLE(...)` list; the enum and the event names
  follow automatically.

- **`src/main.cpp`** — the **action layer**. Look for the clearly marked block;
  there is one empty hook per gesture:

  ```cpp
  // >>> PLUG REAL BUTTON BEHAVIOR IN HERE <<<
  static void on_press(const Button &b)            { ... }  // instant trigger
  static void on_release(const Button &b)          { ... }
  static void on_single_click(const Button &b)     { ... }
  static void on_double_click(const Button &b)     { ... }
  static void on_long_press_start(const Button &b) { ... }  // HOLD begins
  static void on_hold(const Button &b)             { ... }  // repeats while held
  static void on_long_press_stop(const Button &b)  { ... }  // HOLD ends
  ```

  Key off `b.id()` (e.g. `BTN_ARCADE_4`) or `b.name()`. Logging and the LED flash
  are centralized in `handle_event()`, so keep these hooks pure and non-blocking —
  no `delay()`.

## Layout

```
panel_firmware/
├── platformio.ini          # PlatformIO env (ESP32-S3, Arduino, NeoPixel dep)
├── config.yaml             # ALL tunables (baked in at build by scripts/gen_config.py)
├── include/
│   └── config.h            # button -> GPIO map (BUTTON_TABLE) + reserved pins
└── src/
    ├── button.h            # debounced, non-blocking Button abstraction
    ├── button.cpp
    └── main.cpp            # setup/loop + the action-layer hooks
```
