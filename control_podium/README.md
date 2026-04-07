# TITANIC Control Podium (`cli.py`)

This repository contains the remote show control firmware and companion software for the TITANIC lighting installation. 
It uses **raw LoRa** for wireless, infrastructure-free communication between a portable control podium and the main visual server.

This README serves as a guide for operating the automated unified `cli.py` tool.

> [!NOTE]
> For details on the desktop PySide6 UI, please read the [Companion App README](companions/README.md).

## Philosophy

The `cli.py` script replaces all previous disconnected build, flash, and configuration scripts. It is the single point of entry for managing the hardware lifecycle of the TITANIC controllers. It abstracts away `platformio`, `esptool`, USB port discovery, and MAC address mapping.

## The Config System

The CLI relies on three files in the `control_podium/` directory:
1. `.config.yaml` — The **Source of Truth** (committed to Git). Defines roles (podium, server), radio parameters (915MHz, SF7), and DMX universes.
2. `.config.pairing.yaml` — Maps physical board MAC addresses to roles (gitignored).
3. `.config.deploy.yaml` — Tracks the last successful deployment timestamps and ports (gitignored).

## Commands

All commands should be executed from within the `control_podium/` directory.

### 1. `python cli.py status`
Shows the complete state of the ecosystem.
- Reads paired MAC addresses and scans active USB ports to report if boards are **ONLINE** or **OFFLINE**.
- Displays the LoRa radio configuration and OLED timeout settings.
- Shows the timestamp of the last successful deployment.

### 2. `python cli.py pair`
Automatically detects connected Heltec ESP32-S3 boards via USB.
- Scans `esptool` properties to find Heltec MAC addresses.
- Prompts the user to assign each detected board to a role defined in `.config.yaml` (e.g., "podium" or "server").
- Saves the mapping to `.config.pairing.yaml`.
- **Must be run once when connecting new hardware.**

### 3. `python cli.py deploy`
The most powerful command. Completely automates the build and flash process.
- **Builds** the C++ firmware using PlatformIO for all roles.
- **Resolves Ports** automatically by looking up the MAC addresses in the pairing file.
- **Flashes** the boards via USB without requiring the user to hold the BOOT button (uses DTR/RTS auto-reset).
- **Reboots** the boards robustly (trying multiple serial touch modes to kick the ESP32 out of the bootloader).
- **Verifies** by reading the serial output to confirm the board reached the `READY` state and is advertising BLE.
- **Pings** between the podium and server (if both are flashed) to prove the raw LoRa RF link is working and report the RSSI.

*Options:*
- `python cli.py deploy --role podium` (Deploy only specific roles)
- `python cli.py deploy --build-only` (Verify compilation without flashing)
- `python cli.py deploy --skip-ping` (Skip the end-to-end RF test)

### 4. `python cli.py monitor`
Launches the PySide6 desktop **Control Center**.
- This is the UI the user interacts with during a show.
- Connects automatically to the Podium board over BLE (or Serial).
- See the [Companion README](companions/README.md) for UI architecture details.

### 5. `python cli.py test`
Runs the automated integration test suite suite (`pytest`).

## Concepts Explained

### LoRa Radio Parameters (e.g., SF7)
When you see `SF7` in the application or config, this refers to **Spreading Factor 7**.
- **Spreading Factor (SF):** Determines the chirp rate of the raw LoRa signal. Lower values like `SF7` transmit data much faster (lower latency) but have shorter range. Higher values like `SF12` have extreme range but are very slow. Since TITANIC needs near-instant show-control triggers (latency ~400ms), `SF7` is chosen as the perfect balance between speed and visual line-of-sight range.
- **Bandwidth (BW):** Typically `250.0` kHz. A wider bandwidth equals a wider pipe for faster transmissions.

### Firmware Versioning
When the Control Center displays "Firmware 1.3-ble-sync deployed," this version string is controlled purely by your `.config.yaml` Source of Truth under the `firmware_version` key.
- To increment the firmware version (e.g. from `1.3` to `1.4`), simply edit the `firmware_version` line in `.config.yaml`.
- The next time you run `python cli.py deploy`, that exact version string will be compiled into the C++ firmware, burned into both the Podium and Server chips, embedded onto their OLED screens, and reflected instantly in the desktop Control Center UI.

### OLED Power Saver
To prevent screen burn-in and save battery while running wirelessly, the firmware automatically sleeps the OLED panels.
- The timeout duration is controlled by the `display: timeout_sec:` block in your `.config.yaml` (default 10s).
- The `cli.py` script automatically parses this YAML key and injects it as a C++ compile-time macro (`OLED_TIMEOUT_SEC`) during the deployment process.

## Typical Workflow

1. Plug in your Heltec V4 boards via USB.
2. `python cli.py pair` (Assign board A to podium, board B to server)
3. `python cli.py deploy` (Go get a coffee while it builds, flashes, reboots, and verifies the radio link)
4. `python cli.py monitor` (Launch the GUI)
