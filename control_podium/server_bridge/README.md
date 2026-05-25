# Titanic Server Bridge (`server_bridge`)

This directory houses the **Raspberry Pi deployment scripts and runtime configurations** for the Titanic radio-to-engine bridge. The bridge process runs unattended on a Raspberry Pi inside the DMX network road case, acting as the bidirectional translator between the half-duplex LoRa RF mesh and the MarsinEngine HTTP/WebSocket APIs.

For the protocol spec and on-air frame design, see [docs/22_server_bridge.md](file:///Users/ssolaimanpour/workspace/BM26-Titanic/docs/22_server_bridge.md).

---

## 🚀 Quick Start

Deploy and verify the bridge on the Raspberry Pi:

```bash
# 1. Set up credentials (first time only)
cd control_podium/server_bridge
cp .ssh.secret.example .ssh.secret
# Edit host, username, password, install root, and ENGINE_URL in .ssh.secret

# 2. Deploy latest code to the Pi & start/restart the service
cd ../..
PYTHONPATH=control_podium python3 -m server_bridge.deploy

# 3. Verify bridge health and view remote logs
PYTHONPATH=control_podium python3 -m server_bridge.deploy --verify-only
```

---

## 1. Prerequisites & System Requirements

### Hardware
* **Raspberry Pi 4 / 5** (running Raspberry Pi OS / Debian 12 aarch64).
* **Heltec WiFi LoRa 32 V3 / V4** (flashed with `server_rx` firmware and connected to the Pi via USB).
* **Network Connectivity**: The Pi must be on the same LAN as the machine running the `MarsinEngine` (port `6968`).

### Software (on the Pi)
* **Python 3.11+**
* `python3-venv` and `python3-pip`
* `rsync` (for code sync)
* `systemd` (for service management)

---

## 2. Configuration Files

The bridge relies on five configuration files. Four live in the repository, and one is gitignored for security.

| Configuration File | Path (Relative to Repo Root) | Purpose | Required Modification |
|--------------------|------------------------------|---------|-----------------------|
| **Pi SSH Credentials** | `control_podium/server_bridge/.ssh.secret` | Defines the SSH target, credentials, and optional engine override for the deploy script. **GITIGNORED**. | **Yes**: Copy from [.ssh.secret.example](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/server_bridge/.ssh.secret.example) and fill in. |
| **Shared AES Secret** | `marsin_engine/secret.yaml` | Holds the pre-shared AES-128 key used by the AEAD codec to decrypt LoRa frames. **GITIGNORED**. | **Yes**: Generate this via engine setup scripts. |
| **Node Registry** | `control_podium/.config.nodes.yaml` | Maps Node IDs (e.g., `0x01`, `0x0A`) to roles (`server`, `captain`) and USB MAC addresses. | **Yes**: Pair your Heltecs via `deploy.py` so MACs match the hardware. |
| **Command Allowlist** | `control_podium/.config.commands.yaml` | Declares the permitted query/command endpoints and their minimum role requirements. | No (pre-configured for standard operations). |
| **Bridge Parameters** | `control_podium/.config.bridge.yaml` | Configures the default engine URL, status broadcast intervals, and feature flags. | Optional (overridden by `.ssh.secret` `ENGINE_URL`). |

---

## 3. Setup & Deployment Steps

Follow these steps to deploy and run the bridge from your workstation laptop:

### Step 1: Create and Fill Credentials
Copy the template and fill in your Raspberry Pi's details:
```bash
cd control_podium/server_bridge
cp .ssh.secret.example .ssh.secret
```
Open [.ssh.secret](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/server_bridge/.ssh.secret) and specify:
* `HOST`: The IP address of your Pi (e.g., `10.1.1.239`).
* `USER`: The Pi username (typically `titanic`).
* `PASSWORD`: The sudo/SSH password (typically `SK9822`).
* `INSTALL_ROOT`: Where the code will live (typically `/opt/titanic-bridge`).
* `ENGINE_URL`: The IP and port of the machine running MarsinEngine (e.g., `http://10.1.1.197:6968`).

### Step 2: Deploy Code and Start Service
From the repository root, run the deployment pipeline:
```bash
cd ../..
PYTHONPATH=control_podium python3 -m server_bridge.deploy
```
This script executes the following automated pipeline:
1. **Smoke Test**: Validates SSH and sudo access on the Pi.
2. **Dependencies**: Ensures `python3-venv`, `pip`, and `rsync` are installed on the Pi.
3. **Sync**: Syncs the `control_podium/` directory, `marsin_engine/secret.yaml`, and docs to the Pi.
4. **Virtual Environment**: Sets up the venv and installs dependencies from `requirements.txt`.
5. **Permissions**: Adds the Pi user to the `dialout` group (for USB serial access).
6. **Systemd**: Templates, installs, and starts the `titanic-bridge.service` unit.
7. **Verification**: Waits 5 seconds to ensure the service stays active and prints recent logs.

### Step 3: Flash Server Radio Firmware (Optional)
If you updated the C++ firmware for the server Heltec, you can flash it directly through the Pi using the same SSH session:
```bash
PYTHONPATH=control_podium python3 -m server_bridge.deploy --firmware-only
```
This compiles the firmware locally on your laptop (saving compilation time on the Pi), ships the `.bin` files, stops the bridge service to release `/dev/ttyACM0`, flashes the ESP32-S3 via `esptool`, and restarts the service.

---

## 4. Operational Diagnostics & Commands

### Verify Status Without Redeploying
To check if the bridge is currently running and healthy without pushing new code:
```bash
PYTHONPATH=control_podium python3 -m server_bridge.deploy --verify-only
```

### Check Health JSON
The bridge exposes an unauthenticated health server on port `7099` (binds to `0.0.0.0` on the Pi). Query it to verify live stats:
```bash
curl -s http://<pi-ip>:7099/health
```
Look for:
* `"reachable": true` in the `engine` block.
* `"rx_count"` / `"tx_count"` in the `lora` block to confirm active mesh traffic.

### Direct Pi Shell Commands
If you SSH into the Pi directly, use these standard systemd utilities:
```bash
# View live tail of bridge logs:
sudo journalctl -u titanic-bridge -f

# Check systemd service status:
systemctl status titanic-bridge

# Stop the service (releases /dev/ttyACM0):
sudo systemctl stop titanic-bridge

# Restart the bridge:
sudo systemctl restart titanic-bridge
```
