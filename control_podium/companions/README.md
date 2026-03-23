# Control Center (Desktop Companion)

This directory contains the desktop companion applications for the TITANIC project, primarily the **Control Center**.

The Control Center is a PySide6 (Qt) graphical user interface that connects to the Podium hardware node via BLE (or Serial). It serves as the main command interface for the operator to send lighting cues, monitor telemetry, and view the live event stream.

## How to Launch

The recommended way to launch the Control Center is using the unified `cli.py` in the parent directory:

```bash
# From the control_podium directory
python cli.py monitor
```

Alternatively, you can launch it manually from this directory:

```bash
# Make sure you are using the correct Python environment
python control_center.py
```

## Features

- **Industrial Brutalism UI:** Designed with a high-density, dark-mode technical aesthetic.
- **Dual-Link Architecture:** Real-time visualization of the Podium and Server nodes via independent `USB ONLINE` and `BLE ONLINE` glow-pill badges. If the USB cable is unplugged mid-show, the desktop transparently falls back to transmitting commands directly over the Bluetooth GATT layer.
- **Live Command Log:** A scrolling log of all successful and failed TX/RX messages across the LoRa link.
- **Hardware Integration:** Connects automatically to the Podium hardware via BLE (advertising securely as `Ttnc-Podium` to bypass strict Windows caches).

> [!TIP]
> For information regarding C++ firmware compilation, hardware deployment, and LoRa `.config.yaml` tuning, refer to the parent [Control Podium README](../README.md).

## Development

If you are modifying the UI:
- `control_center.py` contains the entire application, including the PySide6 QSS stylesheet which dictates the visual design.
- The UI relies on system fonts (Segoe UI, Cascadia Code, or equivalents) for its typography. No external font files need to be distributed.
- Standard Qt layouts (`QVBoxLayout`, `QHBoxLayout`, `QGridLayout`) are used to maintain the structure without overlapping widgets.
