# 38 — Control Panel (LookingGlass): Arcade-Button Firmware + Podium Reaction

> **Status:** Living design doc. The ESP32-S3 **panel firmware** described in
> §3–§5 is **built and running today** (debounce + gesture FSM, structured
> serial events, status LED). The **on-board WiFi telemetry portal &
> build-time config/secrets layer** in §6 is **also built and verified on
> hardware** (SoftAP + station + captive portal + live telemetry page, with
> WiFi/AP settings baked from `config.yaml` / the build-secrets file). The button-event
> **transport** to the host and the `panel_bridge` host service in §7 are
> **designed but not yet built** — read the **Built vs Planned** callout in §2
> before assuming anything is wired up. Note the portal is an
> **observability/maintenance** channel (telemetry + config), **not** the
> event transport to the bridge.
>
> **Audience:** anyone bringing up, extending, or wiring the LookingGlass
> control panel — firmware devs adding button behavior, anyone using the WiFi
> telemetry portal to observe or configure the panel, and whoever builds the
> Ethernet transport + `panel_bridge` host service that connects it to the
> MarsinEngine.
>
> **Out of scope (deliberately):** the radio/LoRa mesh (`07_control_podium.md`)
> — the Control Panel is a *separate art piece* on a *wired* link, not on the
> playa radio mesh. MarsinEngine internals live in `12_marsin_engine.md`.

---

## 1. Overview & Mission

**The Control Panel** (a.k.a. **LookingGlass**) is a **standalone, long-distance
art piece** deployed separately from the main Titanic at Burning Man 2026. It is
a physical panel of arcade buttons on a podium. A participant walks up, presses
buttons, and a small LED fixture on the podium reacts. There is no operator, no
show-control surface — the piece *is* the interaction: press a button, the light
responds.

The firmware reads six momentary arcade buttons, cleans them up, recognizes
gestures (instant press/release, single/double click, and a full hold
lifecycle), and emits one structured, greppable event line per gesture. Today
those events go out over USB serial; the rest of the chain — Ethernet to a
Raspberry Pi, a host bridge, MarsinEngine driving the podium LED — is the
planned path described in §7.

Alongside the gesture firmware, the panel now also runs an **on-board WiFi
telemetry portal** (§6): it broadcasts a captive-portal SoftAP and joins an
existing WiFi network, and serves a live status page and JSON API for
observing the panel (uptime, heap, button states, press counts) and confirming
the link. This is a **maintenance/observability** channel only — it is **not**
the button-event transport to the bridge, which is still the planned wired
Ethernet link (§7).

### End-to-end signal path (target)

```
 ┌───────────────┐   GPIO     ┌──────────────────────────┐
 │ 6 arcade      │  (active-  │ ESP32-S3R8               │
 │ buttons       │───low)────▶│ panel_firmware            │   << BUILT TODAY
 │ (momentary,   │            │  - debounce               │
 │  N.O. → GND)  │            │  - gesture FSM            │
 └───────────────┘            │  - EVT/STAT serial lines  │
                              └────────────┬─────────────┘
                                           │  Ethernet (direct link)   << PLANNED
                                           ▼
                              ┌──────────────────────────┐
                              │ Raspberry Pi (on podium)  │
                              │  ┌────────────────────┐   │
                              │  │ panel_bridge (host)│   │   << PLANNED
                              │  │  - reads events    │   │
                              │  │  - → engine actions│   │
                              │  └─────────┬──────────┘   │
                              │            ▼              │
                              │      MarsinEngine          │   (see 12_marsin_engine.md)
                              └────────────┬─────────────┘
                                           ▼
                                  ┌──────────────────┐
                                  │ podium LED fixture│
                                  └──────────────────┘
```

The piece carries TE's DNA forward in miniature: a controller talking to
MarsinEngine, lighting a fixture — the same stack as the main rig, shrunk to one
podium and a handful of buttons.

---

## 2. System Architecture

| Component | Where it runs | Role | Status |
|---|---|---|---|
| Arcade buttons | The panel | 6 momentary, normally-open switches → GND | Hardware; 1 of 6 wired |
| **`panel_firmware`** | ESP32-S3R8 on the panel | Debounce, gesture recognition, emit `EVT`/`STAT` lines | **Built today** |
| **WiFi telemetry portal** | ESP32 core 0 task | SoftAP + STA, captive portal, live telemetry page + JSON API (observability/config) | **Built today** (§6) |
| Transport | ESP32 ↔ Pi | Carry **button events** from the panel to the Pi | **Planned** (Ethernet) |
| **`panel_bridge`** | Raspberry Pi (podium) | Translate events → MarsinEngine actions | **Planned** |
| MarsinEngine | Raspberry Pi (podium) | Render the reaction, drive the LED fixture | Exists (`12_marsin_engine.md`) |
| Podium LED fixture | The podium | The visible reaction | Hardware |

### Built vs Planned

> [!IMPORTANT]
> **Built today** is the ESP32-S3 firmware at `LookingGlass/panel_firmware/`:
> it reads the buttons, debounces them, runs the per-button gesture state
> machine, prints structured event lines over **native USB Serial/JTAG**, *and*
> runs an **on-board WiFi telemetry portal** (SoftAP + station + captive portal
> + live telemetry page/JSON, §6), with WiFi/AP/web settings baked at build
> time from `config.yaml` / the build-secrets file. All of that is working on the board.
>
> **Built, but observability only — not the event transport:** the WiFi portal
> is a **maintenance/telemetry** channel. It exposes panel state (uptime, heap,
> button down/up + press counts) for inspection; it does **not** carry button
> events to the host. The path that drives the podium LED is still the planned
> wired link below.
>
> **Planned — not yet implemented:**
> - **No button-event transport to the host.** The firmware has no link that
>   ships gestures to the Pi: events exist only on the USB serial console (and,
>   as counters, on the telemetry page). The Ethernet link, the on-wire event
>   protocol, and the `panel_bridge` host service are all design (§7), not code.
> - **`LookingGlass/panel_bridge/`** does not exist yet — it is a proposed new
>   directory.
> - **Only one button (ARCADE_4 / GPIO39) is physically wired.** The other five
>   GPIOs are assigned in `config.h` but not connected, and the mapping of
>   button → meaning is deferred.
> - **The action hooks are empty stubs** — the firmware logs and flashes the
>   LED, but does nothing app-specific yet.

The design keeps the firmware "dumb": it recognizes gestures and emits a clean
event stream, and the host (the Pi-side `panel_bridge`) owns all the policy —
which button does what, and how that maps to MarsinEngine. This mirrors the
`control_podium` split, where the firmware relays and the Pi bridge decides.

---

## 3. Hardware

- **Board:** Waveshare **ESP32-S3-Pico** — chip **ESP32-S3R8** (dual-core
  Xtensa LX7, **16 MB flash, 8 MB octal PSRAM**, native USB Serial/JTAG,
  onboard WS2812 RGB LED on GPIO21). **Same silicon as the BM26 Stoker
  controller.** Verified against the real chip via esptool this session.
- **Buttons:** 6 momentary, normally-open arcade buttons. Each is wired
  `GPIO -> switch -> GND` and read with the internal pull-up
  (`INPUT_PULLUP`), so they are **active-low** — **pressed == LOW**.
- **Power:** external 24 V → buck → 5 V into VSYS. USB-C is for flashing +
  serial.
- **Serial console:** the board exposes the ESP32-S3 **native USB Serial/JTAG**
  on its USB-C port (it enumerates under VID `303A`), so it shows up as a normal
  COM port at **115200 baud** — the same port you flash over.

### Button → GPIO map

Defined in `include/config.h` via the one-line-per-button `BUTTON_TABLE`
X-macro. The token (`ARCADE_4`) becomes **both** the `BTN_ARCADE_4` enum value
**and** the `"ARCADE_4"` name string printed in events — rename in one place.

| Button     | GPIO | Wired today? |
|------------|------|--------------|
| `ARCADE_1` | 15   | No (assigned, unwired) |
| `ARCADE_2` | 18   | No (assigned, unwired) |
| `ARCADE_3` | 16   | No (assigned, unwired) |
| `ARCADE_4` | 39   | **Yes** — the only physically wired button so far |
| `ARCADE_5` | 40   | No (assigned, unwired) |
| `NO_BUTTON`| 41   | No (assigned, unwired) |

> The button→meaning mapping is **deferred**. The GPIO assignments are fixed in
> hardware terms (don't reassign without checking the reserved-pin table), but
> which physical button gets which name/behavior is an open design choice (§7).

### ⚠ Reserved pins — never reassign a button (or the LED) to these

| Pins | Why |
|---|---|
| 33, 34, 35, 36, 37 | Octal PSRAM (breaks RAM if repurposed) |
| 19, 20 | Native USB D-/D+ (USB Serial/JTAG console) |
| 43, 44 | UART0 (secondary UART path) |
| 0, 3, 45, 46 | Strapping pins (boot mode / flash voltage) |
| 21 | Onboard WS2812 status LED |

In use by buttons today: 15, 16, 18, 39, 40, 41. Other GPIOs (4–14, 17, …) are
generally free — check the board pinout before adding more.

### Onboard status LED

A single onboard **WS2812** on **GPIO21** (driven via Adafruit NeoPixel). Used
for at-a-glance proof of life — see §4.6.

---

## 4. Firmware Design

The firmware's button/gesture core lives in three files plus one config header;
the WiFi telemetry portal and its build-time config/secrets layer (§6) add a
few more:

```
LookingGlass/
└── panel_firmware/
    ├── platformio.ini      # PlatformIO env + `extra_scripts = pre:scripts/gen_config.py`
    ├── config.yaml         # ALL tunables (committed) — single source of truth
    ├── scripts/
    │   └── gen_config.py   # pre-build hook: bakes config.yaml + the build-secrets file (from $BM26_SECRETS) → net_config.h
    ├── include/
    │   ├── config.h        # button -> GPIO map (BUTTON_TABLE) + reserved pins (structural)
    │   └── generated/
    │       └── net_config.h  # AUTO-GENERATED defines: tunables + CFG_* (GITIGNORED)
    └── src/
        ├── button.h        # debounced, non-blocking Button abstraction
        ├── button.cpp
        ├── telemetry.h     # cross-core shared state (portMUX-guarded)
        ├── telemetry.cpp
        ├── net_portal.h    # WiFi AP+STA, captive portal, telemetry web server
        ├── net_portal.cpp
        └── main.cpp        # setup/loop + action hooks; calls net_portal_begin()
```

### 4.1 Two-layer Button (`button.h` / `button.cpp`)

Each `Button` deliberately separates two concerns:

```
   raw GPIO sample
        │
   ┌────▼─────────────────┐
   │ Layer 1 — debounce   │   millis()-based; commit a level only after
   │ noisy pin → stable   │   it holds steady for DEBOUNCE_MS. Produces
   │ level + clean edges  │   down_edge / up_edge.
   └────┬─────────────────┘
        │  clean edges + timers
   ┌────▼─────────────────┐
   │ Layer 2 — gesture FSM│   Phase ∈ {Idle, Pressed, Hold, WaitSecond}.
   │ edges → gestures     │   Emits high-level gestures via the event sink.
   └────┬─────────────────┘
        │
   ButtonEventFn emit(...)   one of the ButtonEvent values below
```

The FSM `Phase` enum (`Idle`, `Pressed`, `Hold`, `WaitSecond`) lives in
`button.h`. The whole thing is **non-blocking** — `update(now_ms, emit)` is
polled once per `loop()`, never calls `delay()`, and every button is
independent and simultaneous-safe. The event sink is a plain function pointer
(`typedef void (*ButtonEventFn)(const Button &, ButtonEvent)`), keeping the path
allocation-free.

### 4.2 Gesture vocabulary

The internal `ButtonEvent` enum (`button.h`) and the wire-name it maps to in
`main.cpp::event_name()`:

| `ButtonEvent`      | Event name (`EVT … action=`) | Meaning |
|--------------------|------------------------------|---------|
| `Press`            | `PRESS`            | Instant debounced down-edge — low-latency **trigger** |
| `Release`          | `RELEASE`          | Instant debounced up-edge |
| `SingleClick`      | `SINGLE_CLICK`     | One tap, no second tap (fires after the double window) |
| `DoubleClick`      | `DOUBLE_CLICK`     | Two taps within the double-press window |
| `LongPressStart`   | `LONG_PRESS_START` | Held past the long-press threshold — **HOLD begins** |
| `HoldTick`         | `HOLD`             | Repeats on an interval while held |
| `LongPressStop`    | `LONG_PRESS_STOP`  | Released after a hold — **HOLD ends** |

> `PRESS`/`RELEASE` are the raw, zero-latency edges — they fire on *every*
> physical press, including each tap of a double. `SINGLE_CLICK` /
> `DOUBLE_CLICK` / `LONG_*` are the de-duplicated, gesture-aware stream. Pick
> whichever layer fits each button.

### 4.3 Gesture timing

All thresholds are tunables in `config.yaml` (`buttons.*`):

| Gesture | When it fires | Tunable | Default |
|---|---|---|---|
| `PRESS` / `RELEASE` | Instantly on each debounced edge | `DEBOUNCE_MS` | 15 ms |
| `SINGLE_CLICK` | One tap, no second within the window | `DOUBLE_PRESS_MS` | 250 ms |
| `DOUBLE_CLICK` | Two taps inside the window | `DOUBLE_PRESS_MS` | 250 ms |
| `LONG_PRESS_START` | Press held past the threshold | `LONG_PRESS_MS` | 600 ms |
| `HOLD` | Repeats on an interval while held | `HOLD_REPEAT_MS` | 200 ms |
| `LONG_PRESS_STOP` | Released after a hold | — | — |

### 4.4 Serial event format + heartbeat

One greppable line per event, printed by `handle_event()`:

```
EVT btn=<NAME> action=<ACTION> t=<ms>
```

Worked example (single button, ARCADE_4):

```
EVT btn=ARCADE_4 action=PRESS t=12345              # instant down-edge (trigger)
EVT btn=ARCADE_4 action=RELEASE t=12410
EVT btn=ARCADE_4 action=SINGLE_CLICK t=12660       # confirmed single tap
EVT btn=ARCADE_4 action=DOUBLE_CLICK t=13100       # two quick taps
EVT btn=ARCADE_4 action=LONG_PRESS_START t=14000   # HOLD begins
EVT btn=ARCADE_4 action=HOLD t=14200               # repeats while held
EVT btn=ARCADE_4 action=LONG_PRESS_STOP t=14850    # HOLD ends (released)
```

Plus a periodic **heartbeat** so a host (or a plain serial monitor) can confirm
the link without a button press or a board reset:

```
STAT alive t=<ms>
```

emitted every `SERIAL_HEARTBEAT_MS` (default **2000 ms**). Set it to `0` to
disable. At boot the firmware also prints a banner with `FW_NAME`/`FW_VERSION`
and the live button → pin map.

> [!NOTE]
> The heartbeat is a **dev affordance**. For a production deployment that pipes
> events to `panel_bridge`, decide whether the heartbeat stays as a link
> liveness signal or gets disabled to keep the stream clean (§7).

### 4.5 Centralized event sink + action hooks (`main.cpp`)

Every button shares **one** sink, `handle_event(const Button&, ButtonEvent)`,
which does four things in order:

1. Logs the `EVT …` line.
2. Records the event into shared telemetry via `telemetry_note()` (so the WiFi
   portal in §6 can show live button state + press counts across cores).
3. Flashes the status LED on a `Press` (when the LED is enabled).
4. Routes to the matching **action hook**.

The action hooks are the place future behavior plugs in — **7 empty stubs**,
clearly fenced in `main.cpp`:

```cpp
// >>> PLUG REAL BUTTON BEHAVIOR IN HERE <<<
static void on_press(const Button &b)            { (void)b; /* TODO */ }
static void on_release(const Button &b)          { (void)b; /* TODO */ }
static void on_single_click(const Button &b)     { (void)b; /* TODO */ }
static void on_double_click(const Button &b)     { (void)b; /* TODO */ }
static void on_long_press_start(const Button &b) { (void)b; /* TODO */ }
static void on_hold(const Button &b)             { (void)b; /* TODO */ }
static void on_long_press_stop(const Button &b)  { (void)b; /* TODO */ }
```

Key off `b.id()` (e.g. `BTN_ARCADE_4`) or `b.name()`. Logging and the LED flash
are centralized in `handle_event()`, so these hooks stay **pure and
non-blocking** — no `delay()`.

### 4.6 The `BUTTON_TABLE` one-line-add pattern

`config.h` defines the button map once as an X-macro and re-expands it three
ways, so **adding or renaming a button is a single-line edit**:

```cpp
#define BUTTON_TABLE(X)   \
    X(ARCADE_1,  15)      \
    X(ARCADE_2,  18)      \
    X(ARCADE_3,  16)      \
    X(ARCADE_4,  39)      \
    X(ARCADE_5,  40)      \
    X(NO_BUTTON, 41)
```

The same table builds (1) the `ButtonId` enum + `BUTTON_COUNT` (which doubles as
the array size / loop bound), and (2) the per-button `begin()` calls in
`setup()`. Add one `X(NAME, GPIO)` line and the enum, the event name string, and
the boot wiring all update automatically.

### 4.7 Config tunables

All live in `config.yaml` and are baked into the generated `#define`s below at
build time (the structural `BUTTON_TABLE` map stays in `include/config.h`):

| `#define` | Default | Purpose |
|---|---|---|
| `FW_NAME` / `FW_VERSION` | `"LookingGlass Panel"` / `"0.1.0"` | Banner identity |
| `SERIAL_BAUD` | 115200 | Serial speed |
| `SERIAL_HEARTBEAT_MS` | 2000 | `STAT alive` cadence (0 = off) |
| `DEBOUNCE_MS` | 15 | Contact settle time |
| `LONG_PRESS_MS` | 600 | Press → HOLD threshold |
| `DOUBLE_PRESS_MS` | 250 | Max gap between taps for a double |
| `HOLD_REPEAT_MS` | 200 | Interval between `HOLD` ticks while held |
| `STATUS_LED_ENABLED` | 1 | Compile out all LED code when 0 |
| `STATUS_LED_PIN` | 21 | Onboard WS2812 |
| `STATUS_LED_COUNT` | 1 | Pixels |
| `STATUS_LED_BRIGHTNESS` | 40 | Master cap (0–255) |
| `STATUS_LED_HEARTBEAT_MS` | 4000 | One slow breathe cycle |
| `STATUS_LED_FLASH_MS` | 120 | Press-flash duration |
| `STATUS_LED_REFRESH_MS` | 16 | ~60 Hz redraw cap |

### 4.8 Status LED behavior

When `STATUS_LED_ENABLED`, the onboard WS2812 (GPIO21) shows:

- A slow **green** "breathe" (triangle ramp over `STATUS_LED_HEARTBEAT_MS`) as
  an idle heartbeat.
- A brief **blue** flash (`STATUS_LED_FLASH_MS`) on any `Press`.

Redraws are rate-limited to ~60 Hz. Set `STATUS_LED_ENABLED` to `0` to compile
out the LED code entirely.

---

## 5. Build, Flash & Observe

[PlatformIO](https://platformio.org/) with the Arduino-ESP32 framework. One
build environment, **`panel`** (see `platformio.ini`). Key board settings:
`board = esp32-s3-devkitc-1`, `board_build.mcu = esp32s3`,
`board_build.flash_size = 16MB`, `board_build.arduino.memory_type = qio_opi`
(quad flash + octal PSRAM, the R8 part), and build flag
`-DARDUINO_USB_CDC_ON_BOOT=1` to route `Serial` over native USB. Sole library
dep: `adafruit/Adafruit NeoPixel`.

```bash
cd LookingGlass/panel_firmware

pio run                      # compile
pio run -t upload            # compile + flash over USB-C
pio device monitor           # open the serial console @ 115200
```

**If the upload can't enter download mode** (esptool keeps retrying / prints
`Failed to connect`), put the board into the bootloader by hand:

1. Hold the **BOOT** button (GPIO0).
2. While holding BOOT, plug in USB-C (or tap RESET).
3. Release BOOT, then run `pio run -t upload` again.

Target a specific port with `pio run -t upload --upload-port COM4` (or
`/dev/ttyACM0` on Linux/macOS).

**Reading the output:** on the serial monitor you'll see the boot banner, then a
`STAT alive t=…` line every ~2 s. Press the wired ARCADE_4 button and the
matching `EVT btn=ARCADE_4 action=… t=…` lines stream out, and the onboard LED
flashes blue on each press.

---

## 6. On-board WiFi Telemetry Portal & Configuration

The panel runs a small **WiFi telemetry portal** for observability and field
maintenance: join its network (or reach it on your LAN) and a browser shows a
live status page. This is **built and verified on hardware** (2026-06-29). It
is deliberately a **maintenance/telemetry channel only** — it does **not**
carry button events to `panel_bridge`; that is still the planned wired Ethernet
link (§7).

Implementation: `src/net_portal.{h,cpp}` (the network task + web server),
`src/telemetry.{h,cpp}` (cross-core shared state), and the build-time config
layer (`config.yaml`, the build-secrets file via
`$BM26_SECRETS`, `scripts/gen_config.py` → `include/generated/net_config.h`).

### 6.1 Dual-core design (portal on core 0, buttons on core 1)

The ESP32-S3 is dual-core, and the firmware splits the work cleanly:

- **Core 1 — buttons.** The Arduino `loop()` (which runs on core 1) keeps
  polling the buttons and emitting gestures, exactly as in §4. It must never be
  blocked by WiFi or HTTP work.
- **Core 0 — networking.** `net_portal_begin()` (called at the end of
  `setup()`) spawns a FreeRTOS task **pinned to core 0** via
  `xTaskCreatePinnedToCore(portal_task, "portal", 12288, …, /*core*/ 0)`. That
  task owns *all* of WiFi, DNS, and the web server, so a slow HTTP client can
  never add latency to a button press.

**Cross-core hand-off (`telemetry.{h,cpp}`).** The two cores share one
`Telemetry` struct guarded by a `portMUX` spinlock:

- The button core calls `telemetry_note(btn_index, ev, now_ms)` from
  `handle_event()` (writer). It bumps `total_events`, tracks `last_btn` /
  `last_action` / `last_event_ms`, and on `Press`/`Release` updates
  `press_counts[]` and the `state_mask` (bit *i* = button *i* is down).
- The web core calls `telemetry_snapshot()` (reader) to get an atomic copy for
  rendering. Both sides take the spinlock (`portENTER_CRITICAL` /
  `portEXIT_CRITICAL`), so the reader always sees a consistent snapshot.

### 6.2 AP + STA simultaneously

The radio runs in `WIFI_AP_STA` mode — it is both an access point **and** a
station at once:

- **SoftAP** — `LookingGlass-Panel` (from `ap.ssid` in `config.yaml`).
  **Open by default**; set `ap_pass` in the build-secrets file (8+ chars) to
  make it WPA2. The portal page/JSON label the AP security as `open` or `WPA2`
  accordingly. The AP IP is `192.168.4.1`.
- **STA** — joins an existing network (the station SSID + password come from the
  build-secrets file, flat keys `wifi_ssid` / `wifi_pass`). Auto-reconnect is on.

> Credentials live **only** in the build-secrets file
> (resolved via `$BM26_SECRETS`, see §6.6). The station SSID and its password are
> never written into any committed file in this repo.

### 6.3 Captive portal

When `web.captive_portal` is true, the task runs a catch-all **`DNSServer`**
that resolves **every** hostname to the AP IP (`192.168.4.1`), plus an
`onNotFound` handler that issues a **302 redirect** to `http://192.168.4.1/`.
Together these make the OS "sign-in to network" sheet pop automatically on most
phones/laptops the moment they join the AP — including the OS connectivity
probes that would otherwise just mark the network as "no internet".

### 6.4 Channel auto-alignment (the `reason=15` fix)

A single radio can only be on **one** channel at a time, so in AP+STA the
SoftAP and the station **must share a channel**. If the AP is left on its
configured channel while the station network is on another, the STA 4-way
handshake times out and the link drops with **`reason=15`** (handshake
timeout). The fix: before bringing the AP up, the task **scans** for the
station SSID, reads the channel it's on, and **hosts the SoftAP on that same
channel**. If the station network isn't found in the scan, the AP stays on its
configured `ap.channel` and a diagnostic line says so. The resolved channel is
shown on the telemetry page and in the boot line.

### 6.5 Telemetry page (`/`) and JSON API (`/api/telemetry`)

The web server (port from `web.port`, default **80**) serves two routes:

- **`/`** — an HTML status page that **auto-refreshes every 2 s**
  (`<meta http-equiv="refresh" content="2">`), self-contained inline CSS, no
  external assets (offline-safe).
- **`/api/telemetry`** — the same data as compact JSON, for scripts/monitors.

Both expose:

| Group | Fields |
|---|---|
| **Status** | fw name + version (`FW_NAME`/`FW_VERSION`), uptime (s), free heap (B), total events, last event (button + action + age) |
| **AP** | ssid, security (`open`/`WPA2`), channel, IP, MAC, connected client count |
| **STA** | connected?, ssid, IP, RSSI (dBm) |
| **Buttons** | per-button table: name, GPIO, live down/up state, press count |

The per-button name/GPIO tables in `net_portal.cpp` are built from the **same
`BUTTON_TABLE` X-macro** as the rest of the firmware (§4.6), so the portal
stays in sync with `config.h` with zero duplication.

### 6.6 Build-time config & secrets

WiFi/AP/web/LAN settings are **baked into the firmware at build time** — there
is no runtime config UI. Two YAML files feed one generated header:

| File | Committed here? | Contents |
|---|---|---|
| `panel_firmware/config.yaml` | **Yes** (non-secret) | **ALL tunables** — `firmware.*`, `buttons.*`, `lamp.*`, `status_led.*`, plus network: `device.hostname`, `ap.{enabled,ssid,channel,hidden}`, `wifi.enabled`, `lan.*` (planned Ethernet, §7), `web.{enabled,port,captive_portal}` |
| build-secrets file (in a private, external deployment source, via `$BM26_SECRETS`) | **No — lives in your private deployment source** | flat keys: `wifi_ssid` / `wifi_pass` (station creds), `ap_pass` (AP WPA2; empty = open). The deploy-target board MAC is **not** here — it's in the deploy registry (a MAC allowlist) used by `deploy.py` (see the Deploy section in `panel_firmware/README.md`) |

`scripts/gen_config.py` is a **PlatformIO `pre:` build hook** (wired via
`extra_scripts = pre:scripts/gen_config.py` in `platformio.ini`). On every
build it parses `config.yaml` plus the build-secrets file resolved via `$BM26_SECRETS`
with a tiny dependency-free parser and emits `include/generated/net_config.h`, a
set of `CFG_*` `#define`s (`CFG_AP_SSID`, `CFG_WIFI_SSID`, `CFG_WEB_PORT`, …)
that `net_portal.cpp` consumes.

It follows the project's **fail-loud, no-fallback** rule: a **missing
`$BM26_SECRETS` / build-secrets file** (or a missing required key) **aborts the
build** with a clear message — there is no local fallback file. Ensure
`$BM26_DEPLOY_REGISTRY` and `$BM26_SECRETS` are exported in your environment
(your private deployment source provides them). It never invents defaults for
credentials. Its console summary prints the AP/STA SSIDs and web port but
**never prints any password value**.

> [!IMPORTANT]
> **Public repo — no real credentials in git.** No build-secrets file lives in this
> checkout. The real WiFi/AP credentials live **only** in a private, external
> deployment source, resolved at build time via
> `$BM26_SECRETS`. `.gitignore` also ignores the generated
> `LookingGlass/panel_firmware/include/generated/` directory. Never write a real
> credential into any committed file.

**Shared across worktrees.** Because the secrets and the deploy registry live in
a private, external deployment source (outside this checkout), they are
automatically shared across every worktree and branch — no per-worktree copy is
needed. Ensure `$BM26_DEPLOY_REGISTRY` (→ the deploy registry, a MAC allowlist)
and `$BM26_SECRETS` (→ the build-secrets file) are exported in your environment
(your private deployment source provides them); both `gen_config.py` (build) and
`deploy.py` (flash) read them. (The Stoker-named `$STOKER_SECRETS` /
`$STOKER_DEPLOY_REGISTRY` are accepted as fallbacks.)

### 6.7 Serial diagnostics

The portal adds these serial lines (alongside the §4 `EVT`/`STAT` stream):

- **Boot:** `NET portal up: AP=… ch=… security=… ip=… web=:80 url=http://…/ (core 0)`
- **Scan:** `NET found <ssid> on channel N (…)` (or a "not found in scan" note).
- **WiFi events** (from `on_wifi_event`): `NET STA associated to …`,
  `NET STA connected: … ip=… rssi=…`, and `NET STA disconnected (reason=N)`
  (e.g. `reason=15` = handshake/bad-password, `201` = AP not found).
- **Periodic (every 5 s):** `NET status: sta=… ap_clients=… heap=…`.

---

## 7. Planned: Transport & `panel_bridge`

> [!IMPORTANT]
> Everything in this section is **design, not yet built**. The firmware today
> emits events only on the USB serial console; there is no network code.

### 6.1 Transport — direct Ethernet link

The plan is to carry events from the ESP32 to the on-podium Raspberry Pi over a
**direct (point-to-point) Ethernet link** — no internet, no switch required,
matching the offline-readiness requirement.

> [!WARNING]
> **Open hardware question — Ethernet MAC.** The ESP32-S3 has **no built-in
> Ethernet MAC**. A direct Ethernet link therefore implies an **external SPI
> Ethernet controller** (commonly a **W5500** — the BM26-Stoker board uses a
> W5500). This is flagged as a hardware item to **confirm**, not an asserted
> design: the exact part, the SPI pin assignment (which must avoid the reserved
> pins in §3), and whether the panel board carries one at all are all
> unverified. Resolve this before committing to the wire protocol.

### 6.2 `panel_bridge` — host service on the Pi

Propose a new host-side service at **`LookingGlass/panel_bridge/`** (does not
exist yet), by analogy to the repo's existing `LookingGlass/control_podium/server_bridge`
(see `22_server_bridge.md`). Likely Python, deployed on the **same Raspberry Pi
as MarsinEngine**, on the podium.

**Responsibilities:**

- Receive the firmware's button/gesture events over the Ethernet link.
- Translate each event into a **MarsinEngine action** (pattern change, param
  nudge, effect trigger — the actual mapping is design work, see §7).
- Own all the policy: which physical button means what, debounce/pacing at the
  app level, and how a gesture maps to a reaction. The firmware stays dumb; the
  bridge decides.

### 6.3 Signal flow (target)

```
 ESP32-S3 panel_firmware
   │  EVT btn=… action=… t=…   (over Ethernet, protocol TBD — §7)
   ▼
 panel_bridge (Raspberry Pi, on the podium)
   │  translate event → engine call
   ▼
 MarsinEngine  (see 12_marsin_engine.md)
   │  render the reaction
   ▼
 podium LED fixture   (the visible response)
```

This is the same shape as `control_podium`: a dumb controller, a Pi-side bridge
that holds the policy, and MarsinEngine as the source of truth that actually
drives light.

---

## 7. Open Questions / TODO

- [ ] **Confirm the Ethernet hardware.** Does the panel board carry an external
      SPI Ethernet MAC (W5500-class)? If so, pin assignment + driver. (§6.1)
- [ ] **Wire the remaining 5 buttons** and decide the real **button → meaning
      mapping** (currently only ARCADE_4/GPIO39 is wired; mapping deferred).
- [ ] **Define the on-wire event protocol** between the ESP32 and `panel_bridge`
      (the firmware's `EVT`/`STAT` ASCII lines are a natural starting point, but
      the transport framing is unspecified).
- [ ] **Build `panel_bridge`** at `LookingGlass/panel_bridge/` and its
      event → MarsinEngine action map.
- [ ] **Disable the dev heartbeat** (`SERIAL_HEARTBEAT_MS = 0`) for production,
      or repurpose it as a link-liveness signal — decide.
- [ ] **Commit & push** the firmware (branch `feat/control_panel_firmware`; not
      yet committed as of 2026-06-28).

---

## 8. References

- `LookingGlass/README.md`, `LookingGlass/panel_firmware/README.md` — the
  firmware's own docs.
- `12_marsin_engine.md` — MarsinEngine (drives the podium LED fixture).
- `22_server_bridge.md`, `07_control_podium.md` — the `control_podium`
  firmware-relay + Pi-bridge pattern this design mirrors.
