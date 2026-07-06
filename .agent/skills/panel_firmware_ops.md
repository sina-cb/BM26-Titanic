# Panel Firmware Ops (LookingGlass control panel)

How to build, flash, monitor, and configure the **LookingGlass control-panel
firmware** at `LookingGlass/panel_firmware/` (ESP32-S3R8 arcade-button controller
with a WiFi telemetry portal). Read this before touching the board.

> **Audience:** anyone flashing or operating the panel controller. For the full
> firmware design see `docs/38_control_panel.md`; for the wiring see
> `LookingGlass/panel_firmware/circuit.html`.

---

## 🔒 Golden rule — flash ONLY via `deploy.py`

**Never** flash the panel with a raw `pio run -t upload`. Always use the
registry-locked deploy script:

```bash
cd LookingGlass/panel_firmware
python deploy.py            # build + flash the board allowed for the looking_glass target
```

Why this is mandatory: more than one ESP32 is usually plugged into the bench at
once (the panel **and** the Stoker fire controller, etc.). A raw `pio run -t
upload` flashes **whichever serial port it finds first** — which can silently
flash panel firmware onto the wrong board. `deploy.py` reads each connected
Espressif board's MAC and **refuses to flash anything that isn't allowed for the
panel's deploy target**.

This rule is also in `CLAUDE.md` (Hard rules).

---

## The MAC allowlist lives in the deploy registry

There is no per-repo `device.mac`, and there is no local fallback file — the
deploy-target MAC allowlist lives **only** in the deploy registry (a MAC
allowlist) in a private, external deployment source, outside this checkout.
`deploy.py` resolves that file via the env var
**`$BM26_DEPLOY_REGISTRY`** (falling back to `$STOKER_DEPLOY_REGISTRY`).

The registry has a `target_allow` map keyed by deploy **target**. The panel's
target is **`looking_glass`** (the default in `deploy.py`), which allows the
panel controller. The deploy script:

- reads each connected board's MAC (`python -m esptool --port <COM> read-mac`,
  case-insensitive) before every flash;
- flashes only a board whose MAC is in the allowlist for the `looking_glass`
  target, and **refuses every other board** (e.g. the Stoker controllers);
- if the registry/env var is missing, the target is unknown, or no connected
  board matches the allowlist, it **fails loudly** and never guesses.

To re-target at a different physical board, register that board's MAC under the
`looking_glass` target in the deploy registry — the allowlist
is managed centrally there, not in a local per-repo file. Read a board's MAC
directly with `python -m esptool --port COM4 read-mac`.

### One-time setup — point at your private deployment source

Both the deploy registry and the build secrets live in a private, external
deployment source, *outside* this checkout (so they are shared
across every worktree and branch). Ensure these env vars are exported in your
environment (your private deployment source provides them) — `deploy.py` and the
build read them:

- **`$BM26_DEPLOY_REGISTRY`** (or `$STOKER_DEPLOY_REGISTRY`) → the deploy registry (a MAC allowlist)
- **`$BM26_SECRETS`** (or `$STOKER_SECRETS`) → the build-secrets file (WiFi/AP build secrets)

If those env vars are not exported, the build and deploy **fail loudly** — there
is no local fallback file. Once they are set, `deploy.py` and the build just
work — no per-worktree secret copy is needed. (Note: env vars affect **new**
shells/IDEs; restart yours after exporting them.)

---

## deploy.py — commands

```bash
cd LookingGlass/panel_firmware

python deploy.py              # verify against the registry, then build + flash the allowed board
python deploy.py --list       # show the target's allowed boards + every connected board (no flash)
python deploy.py --build-only # compile only (no registry/MAC check, no upload)
python deploy.py --target NAME # registry deploy target (default: looking_glass)
python deploy.py --port COM4  # force a port (still registry-verified unless --force)
python deploy.py --pick       # interactively choose a board (warns loudly on a non-allowed board)
python deploy.py --force      # skip the registry/MAC guard entirely (emergency only; loud warning)
```

`--list` is the quickest sanity check — it prints the allowed boards for the
target, then a table of what's connected:

```
[deploy] deploy target: looking_glass
[deploy] allowed boards (from the registry):
    the panel controller   AA:BB:CC:DD:EE:FF  ip=?
[deploy] connected Espressif boards:
  PORT      MAC                ALLOWED    WHO
  --------  -----------------  ---------  --------------------
  COM4      AA:BB:CC:DD:EE:FF  YES        the panel controller
  COM9      AA:BB:CC:DD:EE:01  no         a different ESP32 (do not flash)
```

It reads MACs via `python -m esptool --port <COM> read-mac` (esptool v5) and
enumerates Espressif boards by USB VID `0x303A` (pyserial). PyYAML is required to
read the registry.

---

## Monitoring the serial console

```bash
cd LookingGlass/panel_firmware
pio device monitor -p COM4 -b 115200
```

The board uses the ESP32-S3 **native USB-Serial/JTAG**, which re-enumerates after
a reset — so the one-shot boot banner is often missed by the host. The firmware
emits a periodic `STAT alive t=<ms>` heartbeat (every `SERIAL_HEARTBEAT_MS`,
default 2000) so you can confirm it's alive at any time; tap **RST** to see the
banner. Button gestures print `EVT btn=<NAME> action=<ACTION> t=<ms>`.

---

## Telemetry / captive portal

On boot the firmware brings up a WiFi telemetry portal on **core 0** (button
scanning stays on core 1):

- **SoftAP `LookingGlass-Panel`** (open) — join it and a captive portal pops to
  `http://192.168.4.1/`.
- **STA** joins the network whose credentials come from the build-secrets file
  (flat keys `wifi_ssid` / `wifi_pass`).
- **Web page** on `:80` (live stats + log) and **WebSocket** on `:81`; raw JSON
  at `/api/telemetry`.

**All firmware tunables** (firmware identity, serial, button timing, the lamp,
the status LED) **and** the non-secret network settings live in
`panel_firmware/config.yaml` (committed). Credentials live in the
build-secrets file in a private, external deployment source, resolved via
`$BM26_SECRETS` (flat keys `wifi_ssid`/`wifi_pass`/`ap_pass`). Both are baked
into the firmware at build time by `panel_firmware/scripts/gen_config.py` —
retune behavior by editing `config.yaml`, no C edit needed. The button → GPIO
map (`BUTTON_TABLE`) and reserved-pin list stay in `include/config.h`
(structural).

---

## Buttons & the illuminated-button lamp

Button → GPIO map is the one-line-per-button `BUTTON_TABLE` X-macro in
`include/config.h` (`ARCADE_1=15`, `ARCADE_3=16`, `ARCADE_4=39`, `ARCADE_5=40`,
`NO_BUTTON=41`). **GPIO18 is the illuminated-button LAMP OUTPUT** (it was
`ARCADE_2`): it turns ON while its source button (`BUTTON_LAMP_SOURCE`, default
`BTN_ARCADE_4`) is held. Remap with the `BUTTON_LAMP_*` defines in `config.h`. A
GPIO sources only ~tens of mA — drive a higher-current lamp through a
transistor/MOSFET, not off the pin.

---

## Editing the wiring diagram

`circuit.html` embeds a **static SVG** (renders with no JavaScript). To change it,
edit the generator and regenerate:

```bash
node LookingGlass/panel_firmware/tools/gen_circuit.cjs \
     LookingGlass/panel_firmware/circuit.html
```

Keep it static (the diagram must render in viewers that block page scripts).

---

## Quick checklist before flashing

1. `python deploy.py --list` — confirm the panel controller (COM4 /
   `ALLOWED=YES`) is present and any other ESP32 (e.g. Stoker) shows `no`.
2. `python deploy.py` — guarded build + flash.
3. `pio device monitor -p COM4 -b 115200` — confirm `STAT alive` + `NET portal up`.
