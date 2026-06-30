# 14 — Panel Firmware Ops (LookingGlass control panel)

How to build, flash, monitor, and configure the **LookingGlass control-panel
firmware** at `LookingGlass/panel_firmware/` (ESP32-S3R8 arcade-button controller
with a WiFi telemetry portal). Read this before touching the board.

> **Audience:** anyone flashing or operating the panel controller. For the full
> firmware design see `docs/38_control_panel.md`; for the wiring see
> `LookingGlass/panel_firmware/circuit.html`.

---

## 🔒 Golden rule — flash ONLY via `deploy.py`

**Never** flash the panel with a raw `pio run -t upload`. Always use the
MAC-locked deploy script:

```bash
cd LookingGlass/panel_firmware
python deploy.py            # build + flash the board whose MAC matches the secret
```

Why this is mandatory: more than one ESP32 is usually plugged into the bench at
once (the panel **and** the Stoker fire controller, etc.). A raw `pio run -t
upload` flashes **whichever serial port it finds first** — which can silently
flash panel firmware onto the wrong board. `deploy.py` reads each connected
Espressif board's MAC and **refuses to flash anything that isn't the panel**.

This rule is also in `CLAUDE.md` (Hard rules).

---

## The MAC lives in the gitignored secret — the script manages it

The deploy-target MAC is stored in `LookingGlass/secrets.yaml` (gitignored, never
committed) under:

```yaml
device:
  mac: "AA:BB:CC:DD:EE:FF"   # the panel board this firmware deploys to
```

`secrets.yaml.example` (committed) carries a placeholder so the key is
discoverable. The deploy script **owns** this value:

- **reads** `device.mac` and compares it (case-insensitive) to the connected
  board's MAC before every flash;
- **`--pair`** detects the single connected board and **writes/updates**
  `device.mac` in `secrets.yaml` for you (preserving the `wifi`/`ap` keys);
- if `device.mac` is missing/empty/malformed, or no connected board matches, it
  **fails loudly** and never guesses.

To re-target the firmware at a different physical board, plug in only that board
and run `python deploy.py --pair` (or edit `device.mac` by hand). Read a board's
MAC directly with `python -m esptool --port COM4 read-mac`.

### Shared secret across worktrees (`$PANEL_SECRETS`)

`secrets.yaml` is gitignored, so it is **not** shared between git worktrees — by
default each worktree would need its own copy. Keep **one** secret (WiFi creds +
`device.mac`) for every worktree and branch in a folder outside the repo,
**`~/workspace/BM26-Titanic-Secrets/`**, seeded from the committed template, and
point the env var **`PANEL_SECRETS`** at it:

```bash
copy LookingGlass\secrets.yaml.example C:\Users\sina_\workspace\BM26-Titanic-Secrets\panel_secrets.yaml
setx PANEL_SECRETS "C:\Users\sina_\workspace\BM26-Titanic-Secrets\panel_secrets.yaml"   # set once
```

Both `deploy.py` and the build-time `scripts/gen_config.py` read `$PANEL_SECRETS`
when set, and fall back to the worktree-local `secrets.yaml` when it is not (and
fail loud if neither exists). Set it once and no worktree needs its own copy —
this is the recommended setup. (Note: `setx` affects **new** shells/IDEs only;
restart yours after setting it.)

---

## deploy.py — commands

```bash
cd LookingGlass/panel_firmware

python deploy.py              # verify MAC, then build + flash the matching board
python deploy.py --list       # show expected MAC + every connected board & its MAC (no flash)
python deploy.py --pair       # store the single connected board's MAC in secrets.yaml, then flash
python deploy.py --build-only # compile only (no MAC check, no upload)
python deploy.py --port COM4  # force a port (still MAC-verified unless --force)
python deploy.py --pick       # interactively choose a board (warns loudly on a non-match)
python deploy.py --force      # skip the MAC guard entirely (emergency only; loud warning)
```

`--list` is the quickest sanity check — it prints a table like:

```
expected (secrets.yaml device.mac): AA:BB:CC:DD:EE:FF
  PORT   MAC                MATCH   DESCRIPTION
  COM4   aa:bb:cc:dd:ee:ff  YES     ← the panel controller
  COM9   aa:bb:cc:dd:ee:01  no      ← a different ESP32 (do not flash)
```

It reads MACs via `python -m esptool --port <COM> read-mac` (esptool v5) and
enumerates Espressif boards by USB VID `0x303A` (pyserial). PyYAML is optional —
a built-in reader handles `device.mac` when it isn't installed.

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
- **STA** joins the network in `secrets.yaml` (`wifi.ssid`/`wifi.password`).
- **Web page** on `:80` (live stats + log) and **WebSocket** on `:81`; raw JSON
  at `/api/telemetry`.

**All firmware tunables** (firmware identity, serial, button timing, the lamp,
the status LED) **and** the network settings live in
`panel_firmware/config.yaml` (committed, non-secret); credentials live in
`secrets.yaml` (gitignored). Both are baked into the firmware at build time by
`panel_firmware/scripts/gen_config.py` — retune behavior by editing
`config.yaml`, no C edit needed. The button → GPIO map (`BUTTON_TABLE`) and
reserved-pin list stay in `include/config.h` (structural).

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

1. `python deploy.py --list` — confirm the panel (COM4 / matching MAC) is present
   and any other ESP32 (e.g. Stoker) shows `no`.
2. `python deploy.py` — guarded build + flash.
3. `pio device monitor -p COM4 -b 115200` — confirm `STAT alive` + `NET portal up`.
