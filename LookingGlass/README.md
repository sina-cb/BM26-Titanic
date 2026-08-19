# LookingGlass

**LookingGlass** is the Titanic's physical operator-facing control surface — the
hardware panel of arcade buttons the operator presses to drive the show, a bench
sibling to the `CaptainPad` iPad app.

| Subdirectory | What it is |
|---|---|
| [`panel_firmware/`](panel_firmware/) | ESP32-S3 firmware for the 6-button arcade control panel. Reads the buttons, debounces them, and emits structured press / release / long-press events. |
| [`control_podium/`](control_podium/) | **Archived** LoRa mesh + Raspberry Pi bridge subsystem (Heltec radios, PortWatch field-ops app, bridge companions). Relocated from the repo root; retained for reference and occasional bench work. See [`control_podium/README.md`](control_podium/README.md). |

See [`panel_firmware/README.md`](panel_firmware/README.md) to build, flash, and
extend the panel.
