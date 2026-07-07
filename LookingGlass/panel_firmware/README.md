# `LookingGlass/panel_firmware/` — Arcade Control-Panel Firmware

Firmware for the **LookingGlass control panel**: a 6-button illuminated arcade box
built on an **ESP32-S3-ETH** (the BM26-Stoker board). It debounces the buttons and recognizes gestures —
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

- **Board:** **ESP32-S3-ETH** — **ESP32-S3R8** (dual-core Xtensa LX7, 16 MB flash,
  8 MB octal PSRAM, onboard WS2812 RGB LED on GPIO48, onboard **W5500 Ethernet +
  PoE**). **Same board as the BM26 Stoker controller** — and the panel's button IO
  mirrors Stoker's control-panel pin map (see below).
- **Controls:** **6 illuminated buttons**, each = **2 IO** (a switch **and** a PWM
  LED): four **small** arcade buttons (**SW1–SW4**), one **big** arcade button
  (**SW5**), and a green **Mode** button with a **status LED** on top. Every switch
  is wired `GPIO -> switch -> GND` and read with the internal pull-up, so they are
  **active-low** (pressed = LOW).
- **Button LEDs:** each button's LED runs off a separate **5 V / 12 V rail** (not
  the 3.3 V GPIO) and is driven low-side by a **PWM GPIO → N-MOSFET** (150 Ω gate
  series + 100 kΩ gate pulldown), so firmware can dim or pulse it. (The Mode status
  LED can instead be a simple `GPIO47 → 330 Ω → LED → GND`, Stoker mirror-LED style.)
- **Power:** **USB-C 5 V** (VBUS) supplies the board — the same port used for
  flashing/serial. It also feeds the separate LED rail; share a common GND.
- **Network:** the panel reaches the LookingGlass **unmanaged switch** over wired
  **Ethernet** (onboard W5500 → RJ45). See the **System Overview** tab in
  [`circuit.html`](circuit.html) for the full two-side (LookingGlass ↔ ship) network.
- **Serial console:** the bench board exposes the ESP32-S3 **native USB Serial/JTAG**
  on its USB-C port (it enumerates under VID `303A`), so it shows up as a normal COM
  port at **115200 baud** — the same port you flash over. (If a board instead routes
  serial through a UART bridge on UART0/GPIO43-44, set `ARDUINO_USB_CDC_ON_BOOT=0` in
  `platformio.ini`.)

### Connections — full wiring list

Each button is **two independent nets**: a switch input and a PWM LED output (the
switch and the LED don't touch inside the button). **Switch pins mirror
BM26-Stoker's control-panel map** so the harness/firmware transfers.

| Button | Size  | Switch → GPIO | LED (PWM) → GPIO | Stoker pin |
|--------|-------|---------------|------------------|------------|
| SW1    | small | `IO15`        | `IO41`           | P1-A       |
| SW2    | small | `IO18`        | `IO1`            | P2-A       |
| SW3    | small | `IO16`        | `IO2`            | P3-A       |
| SW4    | small | `IO39`        | `IO42`           | P1-B       |
| SW5    | **big** | `IO40`      | `IO21`           | P2-B       |
| Mode   | green | `IO17`        | `IO47`           | MODE / mirror-LED |
| Status | —     | —             | `IO48` WS2812 (onboard, no wiring) | RGB |

Flat net list:

```
IO15 -> SW1.SW       IO41 -> SW1.PWM.LED
IO18 -> SW2.SW       IO1  -> SW2.PWM.LED
IO16 -> SW3.SW       IO2  -> SW3.PWM.LED
IO39 -> SW4.SW       IO42 -> SW4.PWM.LED
IO40 -> SW5.SW       IO21 -> SW5.PWM.LED   (big button)
IO17 -> MODE.SW      IO47 -> MODE.LED      (status LED on top of Mode)
IO48 -> WS2812        (onboard board status LED — already wired)
```

Per button, the **switch** half is always the same:

```
  <switch GPIO> --[ button switch ]-- GND            pressed = LOW (INPUT_PULLUP)
```

The **LED** half has **two wiring options** (toggle them in `circuit.html` → Panel
Wiring → the *Direct drive* / *MOSFET* sub-tabs):

**Option A — Direct drive (no MOSFET — what we can wire today):**

```
  <LED GPIO> --[330 Ω]--▷|-- GND      GPIO sources the LED · PWM-dimmable
```
Only for **low-current** LEDs (≤ ~20 mA @ 3.3 V) — fine for indicator/Mode LEDs,
but **5 V / 12 V arcade button lamps won't fully light** from a 3.3 V GPIO.

**Option B — Low-side MOSFET (needed for the 5/12 V button lamps):**

```
  +5V/12V rail --+-- LED+ ( button lamp ) LED- --+
                 |                            Drain v
  <LED GPIO> --[150 Ω]-- Gate --| N-MOSFET (2N7000 / AO3400)
                                |> Source --+
                 +-- 100 kΩ ----+-----------+---- GND      (gate pulldown)
```

> **We don't have the MOSFETs yet** — the panel can be brought up on **Option A**
> (direct drive) for low-current LEDs; switch to **Option B** once the MOSFETs (or a
> ULN2803A) are in hand and the high-power button lamps need driving.

Shared rails: one common **GND** (board + every switch + every MOSFET source +
LED-rail GND); one **+5 V / 12 V LED rail** feeding all six LED anodes; board
power in on **USB-C 5 V (VBUS)**.

> **Stoker compatibility.** Switch pins reuse BM26-Stoker's control-panel GPIOs
> (`15/18/16/39/40` = P1-A/P2-A/P3-A/P1-B/P2-B, `17` = MODE, `47` = mirror-LED), so
> a Stoker harness drops onto this panel. **Polarity differs:** LookingGlass buttons
> are **active-LOW** (`INPUT_PULLUP`, → GND); Stoker FIRE buttons are active-HIGH
> (`INPUT_PULLDOWN`, → 3V3) for fire safety. These don't actuate fire, so active-low
> is fine — just don't cross-flash Stoker fire firmware onto this board.

> **Tip:** the six discrete MOSFET drivers can be replaced by one **ULN2803A**
> 8-channel sink array — wire GPIO→IN, LED+→rail, LED−→OUT, COM→+rail, GND→common;
> no gate resistor / pulldown needed.

> **⚠ Firmware status:** the shipped firmware (`include/config.h` `BUTTON_TABLE` +
> `config.yaml` `lamp.*`) predates this map — it declares the older switch set and
> **one** lamp channel. Driving all **six** button LEDs as independent PWM channels
> and the Stoker-compatible `SW1–SW5`/`Mode` pins above is **pending firmware work**:
> the wiring here is the target; update `config.h` / `config.yaml` to match before
> relying on per-button LED control.

### ⚠ Reserved pins — never reassign a button to these

| Pins             | Why                                          |
|------------------|----------------------------------------------|
| 33,34,35,36,37   | Octal PSRAM                                  |
| 38, 48           | RGB-LED (48 = onboard WS2812 status)         |
| 19,20            | Native USB D-/D+ (USB Serial/JTAG console)   |
| 43,44            | UART0 (secondary UART path)                  |
| 0,3,45,46        | Strapping pins (boot mode / flash voltage)   |
| 9–14             | W5500 Ethernet SPI (internal)                |
| 26–32            | SPI flash (internal)                         |

After this Stoker-compatible map, **nearly every exposed header GPIO is used or
reserved** — there's no comfortable headroom for more buttons without freeing a pin.

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

- Configures the button-switch pins as `INPUT_PULLUP` at boot and drives a single
  illuminated-button **lamp output** (ON while its source button is held) — wiring
  the **six** independent PWM LEDs and the Stoker-compatible pin map is pending
  firmware work (see the **Firmware status** note above).
- Debounces each button (15 ms default) with `millis()`-based timing, then runs a
  small per-button gesture state machine — the main loop never calls `delay()`, so
  every button is independent, responsive, and simultaneous-safe.
- Emits the gesture stream above (`PRESS`/`RELEASE`/`SINGLE_CLICK`/`DOUBLE_CLICK`/
  `LONG_PRESS_START`/`HOLD`/`LONG_PRESS_STOP`), one greppable line per event.
- Emits a periodic `STAT alive t=…` heartbeat (every 2 s) so the link is observable
  without a reset or a button press. Set `firmware.serial_heartbeat_ms` to `0` in
  `config.yaml` to disable.
- Prints a startup banner with the firmware version and the live button → pin map.
- Optional onboard WS2812 status LED (GPIO48): a slow green heartbeat, plus a brief
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
