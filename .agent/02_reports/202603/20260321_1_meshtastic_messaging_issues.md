# Meshtastic Messaging Issues – Expert Analysis Report
**Date:** 2026-03-21  
**Project:** BM26-Titanic / Control Podium  
**Author:** Antigravity Agent  
**Purpose:** Full self-contained context for an expert with no prior knowledge of this system.

---

## 1. System Overview

This is a hardware-in-the-loop (HIL) test environment for the BM26-Titanic theatrical lighting control system. Two Meshtastic LoRa nodes communicate wirelessly to relay button press events from a physical podium to a server.

### Physical Setup

```
┌─────────────┐    LoRa 915MHz     ┌─────────────┐
│    PODIUM   │ ←────────────────→ │    SERVER   │
│  (Heltec    │                    │  (Heltec    │
│  LoRa 32)   │                    │  LoRa 32)   │
│   COM15     │                    │   COM16     │
└──────┬──────┘                    └──────┬──────┘
       │ USB Serial                        │ USB Serial + BLE
       │                                   │
  Windows PC                         iPhone (Meshtastic app)
  (Python tests)                      connected via Bluetooth
```

| Role | MAC (short) | USB Port | Meshtastic Name |
|------|------------|----------|-----------------|
| Podium | `49b57eb8` | COM15 | "Podium" |
| Server | `49b54290` | COM16 | "Server" |

Both boards: **Heltec LoRa 32 v3 (ESP32-S3)**

---

## 2. Repository Structure

```
BM26-Titanic/
└── control_podium/
    ├── .config.yaml           ← SINGLE SOURCE OF TRUTH (committed to git)
    ├── .config.deploy.yaml    ← Deploy state w/ PSKs (gitignored)
    ├── .config.pairing.yaml   ← MAC-to-role pairing (gitignored)
    ├── config.py              ← CLI: pair, deploy, test
    ├── requirements.txt
    ├── utils/
    │   ├── config_store.py    ← YAML load/save helpers
    │   ├── discovery.py       ← USB port ↔ MAC matching
    │   ├── serial_proto.py    ← Raw protobuf helpers
    │   └── messaging.py       ← sendText wrappers
    └── tests/
        ├── conftest.py        ← pytest fixtures (hardware connections)
        ├── test_channel.py    ← Channel config / PSK verification
        ├── test_config.py     ← LoRa firmware settings verification
        ├── test_discovery.py  ← USB node detection tests
        ├── test_messaging.py  ← LoRa packet delivery tests
        └── test_hello.py      ← Manual visibility test (messages → phone)
```

---

## 3. The Static Config File (Single Source of Truth)

**File:** `control_podium/.config.yaml` — committed to git. All radio and channel settings live here. The deploy script reads this file exclusively.

```yaml
# TITANIC Control Podium — Static Configuration
# ================================================
# This file defines the system topology, channels, and radio settings.
# It is committed to git. Device-specific secrets (MACs, PSKs) are in
# .config.deploy.yaml, which is gitignored.
#
# To provision hardware:  python config.py deploy

# Node definitions (logical roles — MACs assigned in .config.pairing.yaml)
nodes:
  podium:
    role: "Podium side — control buttons"
    meshtastic_name: "Podium"
    meshtastic_short: "P"

  server:
    role: "Server side — receives events, drives visuals"
    meshtastic_name: "Server"
    meshtastic_short: "S"

# Meshtastic channels (up to 8: index 0 = primary, 1-7 = secondary)
# Channel names max 11 chars. PSKs auto-generated at deploy time.
channels:
  - index: 0
    name: "dev"
    role: primary

  - index: 1
    name: "te"
    role: secondary

  - index: 2
    name: "te-podium"
    role: secondary

# Radio settings (applied to both nodes)
radio:
  region: "US"            # 915 MHz ISM (FCC-compliant)
  modem_preset: "MEDIUM_FAST"
  # Hop limit — max relays per packet (default = 3).
  # For a 2-node deployment at close range, set to 1 so messages go
  # Podium → Server directly with NO relay echo, preventing queue flooding.
  hop_limit: 1

# Event protocol
protocol:
  prefix: "titanic:"     # All button events start with this
```

### Secret files (gitignored)

`.config.pairing.yaml` — created by `python config.py pair`:
```yaml
podium:
  mac: "49b57eb8"
server:
  mac: "49b54290"
```

`.config.deploy.yaml` — created by `python config.py deploy`. Contains PSKs for all channels and the last channel URL. Structure:
```yaml
channels:
  - index: 0
    name: "dev"
    role: primary
    psk: "<64-char hex, 256-bit key>"   # auto-generated
    url: "https://meshtastic.org/e/#..."
  - index: 1
    ...
```

---

## 4. Deploy Workflow

### Step 1: Pair hardware to roles

```bash
python config.py pair
```

Scans USB ports, opens a SerialInterface to each Meshtastic node, reads their MAC addresses, prompts the user to assign each to a role (podium/server), saves to `.config.pairing.yaml`.

### Step 2: Deploy channels and radio settings

```bash
python config.py deploy
```

This is the main provisioning command. Key steps (from `config.py`):

```python
# Read all settings from YAML
radio = config.get("radio", {})
region = radio.get("region", "US")
region_code = serial_proto.REGION_MAP.get(region, 1)   # US = 1

MODEM_PRESET_MAP = {
    "LONG_FAST": 0, "LONG_SLOW": 1, "VERY_LONG_SLOW": 2,
    "MEDIUM_SLOW": 3, "MEDIUM_FAST": 4, "SHORT_SLOW": 5,
    "SHORT_FAST": 6, "LONG_MODERATE": 7,
}
modem_name = radio.get("modem_preset", "LONG_FAST")     # "MEDIUM_FAST"
modem_code = MODEM_PRESET_MAP.get(modem_name, 0)        # 4
hop_limit  = radio.get("hop_limit", 1)                  # 1

# Apply to Podium (COM15)
iface_p = SerialInterface(port_p)
node_p = iface_p.localNode
node_p.localConfig.lora.region       = region_code   # 1
node_p.localConfig.lora.use_preset   = True
node_p.localConfig.lora.modem_preset = modem_code    # 4 (MEDIUM_FAST)
node_p.localConfig.lora.hop_limit    = hop_limit     # 1
node_p.writeConfig("lora")

# Create channels with 256-bit PSKs (auto-generated if not in deploy file)
node_p.beginSettingsTransaction()
for ch_cfg in channels:
    psk = secrets.token_bytes(32)          # 256-bit
    ch.settings.name = ch_cfg["name"]
    ch.settings.psk  = psk
    ch.role = 1 if primary else 2
    node_p.writeChannel(idx)
node_p.commitSettingsTransaction()         # triggers ONE firmware reboot

# Sync channels to Server via CLI (handles reboot internally)
subprocess.run(["python", "-m", "meshtastic",
                "--port", port_s, "--seturl", channel_url])
```

### Step 3: Run HIL tests

```bash
python -m pytest tests/ -v
```

---

## 5. Test Infrastructure (conftest.py)

Full content of `tests/conftest.py`:

```python
"""
Shared test fixtures for Hardware-in-the-Loop tests.

These fixtures provide live connections to the physical Meshtastic nodes.
Both nodes must be plugged in via USB for the tests to pass.

HEALTH CHECK: Before any test runs, the `health_check` fixture (autouse,
session-scoped) retries connecting to both nodes for up to 5 minutes.
"""
import time
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from utils import config_store, discovery

HEALTH_CHECK_TIMEOUT  = 300   # 5 minutes
HEALTH_CHECK_INTERVAL = 10    # seconds between retries


@pytest.fixture(scope="session")
def config():
    """Load .config.yaml — fail fast if it doesn't exist."""
    try:
        return config_store.load()
    except FileNotFoundError:
        pytest.fail(".config.yaml not found.")


@pytest.fixture(scope="session", autouse=True)
def health_check(config):
    """Gate ALL tests: verify both nodes are physically connected (MAC discovery only).

    CRITICAL DESIGN DECISION: Does NOT open serial ports here.
    Only podium_iface / server_iface open ports — lazily, only when a test
    needs them. This prevents COM16 (Server) being held open during
    podium-only tests, which blocks the Server's Bluetooth relay to the phone.
    """
    nodes_to_check = ["podium", "server"]
    found_ports = {}
    deadline = time.time() + HEALTH_CHECK_TIMEOUT

    while time.time() < deadline:
        for name in nodes_to_check:
            if name in found_ports:
                continue
            node = config_store.get_node(config, name)
            if not node or not node.get("mac"):
                continue
            port = discovery.find_port_by_mac(node["mac"])
            if port:
                found_ports[name] = port

        if len(found_ports) == len(nodes_to_check):
            break
        time.sleep(HEALTH_CHECK_INTERVAL)
    else:
        pytest.fail("HEALTH CHECK TIMEOUT: nodes not detected")

    config["_health_check_ports"] = found_ports


@pytest.fixture(scope="session")
def podium_port(config, health_check):
    return config["_health_check_ports"]["podium"]      # e.g. "COM15"


@pytest.fixture(scope="session")
def server_port(config, health_check):
    return config["_health_check_ports"]["server"]      # e.g. "COM16"


def _connect_with_retry(port, retries=3, wait=5):
    """Open SerialInterface with retry for Windows port transients."""
    from meshtastic.serial_interface import SerialInterface
    for attempt in range(retries):
        try:
            iface = SerialInterface(port)
            time.sleep(2)         # wait for firmware handshake
            return iface
        except Exception:
            if attempt < retries - 1:
                time.sleep(wait)
            else:
                raise


@pytest.fixture(scope="session")
def podium_iface(podium_port):
    """Live SerialInterface to Podium. Owns COM15 for the session."""
    iface = _connect_with_retry(podium_port)
    yield iface
    iface.close()


@pytest.fixture(scope="session")
def server_iface(server_port):
    """Live SerialInterface to Server. Owns COM16 for the session.
    
    WARNING: Opening COM16 while the phone is BLE-connected to Server
    can degrade BLE relay performance. Only import this fixture in tests
    that specifically need to talk to Server.
    """
    iface = _connect_with_retry(server_port)
    yield iface
    iface.close()


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    """After all tests finish, broadcast results over LoRa from Podium.
    
    The phone (BLE → Server) receives it as an incoming message in dev channel.
    Uses CLI subprocess so it doesn't conflict with any open serial fixtures.
    """
    import subprocess, sys
    passed  = len(terminalreporter.stats.get('passed',  []))
    failed  = len(terminalreporter.stats.get('failed',  []))
    xfailed = len(terminalreporter.stats.get('xfailed', []))

    status = "✅ PASSED" if failed == 0 else "❌ FAILED"
    msg = f"TITANIC TESTS {status}: {passed} passed, {failed} failed"
    if xfailed:
        msg += f", {xfailed} xfailed"

    cfg  = config_store.load()
    node = config_store.get_node(cfg, "podium")
    port = discovery.find_port_by_mac(node["mac"])

    if port:
        subprocess.run(
            [sys.executable, "-m", "meshtastic",
             "--port", port, "--sendtext", msg],
            capture_output=True, timeout=30
        )
```

---

## 6. The Visibility Test (test_hello.py)

This test exists purely to verify that messages from Podium arrive on the operator's phone:

```python
"""
Test — Hello Message
Usage: python -m pytest tests/test_hello.py -v -s
"""
import time

class TestHello:

    def test_send_hi(self, podium_iface):
        """Send 10 hello messages visible on the dev channel."""
        for n in range(1, 11):
            ts = int(time.time())
            msg = f"{ts}: Hello World #{n}!"
            podium_iface.sendText(msg, wantAck=False)
            print(f"\n  Sent: {msg}")
            time.sleep(2)
```

**Key design choices:**
- `wantAck=False` — eliminates ACK return packet, halving airtime usage
- Only requests `podium_iface` — COM16 (Server) stays untouched so BLE works
- 2s spacing — intended to be safe with `hop_limit=1`, still failing (see §8)

---

## 7. Why Messages Appear on the Phone

The phone (iPhone, Meshtastic app) is connected to the **Server** node via Bluetooth LE. The data flow is:

```
Python sendText()
       ↓
  COM15 serial (USB)
       ↓
  Podium firmware TX queue
       ↓ [LoRa 915MHz radio]
  Server firmware RX
       ↓
  Server Bluetooth stack
       ↓ [BLE GATT notification]
  iPhone Meshtastic app → shows in "dev" channel chat
```

**Critical constraint:** Messages injected via the Server's own COM16 serial port do NOT appear in the phone's chat view. The Server's firmware only relays *incoming* LoRa packets to BLE, not packets it originates locally via serial. Therefore, **all messages that must appear on the phone must originate from Podium** (or another node that the Server receives over LoRa).

---

## 8. The Packet Loss Problem

### Observed results

Running `test_hello.py` (10 messages, 2s apart):  
Messages #1, #5, and #8 arrived. 7 out of 10 were dropped.

### Root cause: relay flood

Meshtastic's default behavior is a **flooding mesh protocol**. When Server receives a packet, it re-broadcasts it so other nodes in range can pick it up. This re-broadcast consumes the same channel airtime.

**MEDIUM_FAST preset specs:**  
SF=11, BW=250 kHz, CR=4/5 → Time-on-Air (ToA) for a ~35-byte payload ≈ **900 ms**

**Timeline of one send cycle with `hop_limit=1`:**

```
t=0.0s   Python calls sendText() → packet enters Podium TX queue
t=0.0-0.9s  Podium transmits over LoRa (900ms airtime)
t=0.9s   Server receives → schedules relay TX
t=0.9-1.8s  Server re-broadcasts the same packet (900ms airtime)
t=1.8s   Podium hears Server's relay → enters anti-flood suppression window
t=2.0s   Python calls sendText() for message #2
           → Podium firmware is in suppression window → packet DROPPED
```

**With 2s send cadence and 1.8s channel occupation, the margin is only 200ms.** Any slight timing jitter causes the next sendText() to hit the suppression window and be silently discarded.

### Why `sendText()` always returns success

```python
podium_iface.sendText(msg, wantAck=False)
```

This call places the packet in the firmware's **internal TX queue** and returns immediately. There is no blocking wait, no radio confirmation. Even if the firmware discards the packet due to queue full or deduplication, Python sees success. This is a known limitation of the `meshtastic-python` library.

---

## 9. Current Firmware State (Read from Live Hardware)

```python
# Run to verify current state:
from meshtastic.serial_interface import SerialInterface
import time

iface = SerialInterface("COM15")  # or COM16 for Server
time.sleep(2)
lora = iface.localNode.localConfig.lora
print(f"region:       {lora.region}")        # 1 = US
print(f"modem_preset: {lora.modem_preset}")  # 4 = MEDIUM_FAST
print(f"hop_limit:    {lora.hop_limit}")     # 1
print(f"use_preset:   {lora.use_preset}")    # True
iface.close()
```

**Current live values (as of 2026-03-21):**
```
Podium (COM15):
  region:       1  (US)
  modem_preset: 4  (MEDIUM_FAST)
  hop_limit:    1
  use_preset:   True

Server (COM16):
  region:       1  (US)  
  modem_preset: 4  (MEDIUM_FAST)
  hop_limit:    1
  use_preset:   True
```

---

## 10. Expert Questions

**Q1 — Disable Server relay entirely:**  
Is there a `device.role` setting that makes Server receive LoRa packets and forward to BLE (phone), but NOT re-broadcast over LoRa? We believe `CLIENT_MUTE` (role=3) does this. Can you confirm?

```python
# Proposed one-time fix:
iface = SerialInterface("COM16")
time.sleep(2)
iface.localNode.localConfig.device.role = 3  # CLIENT_MUTE
iface.localNode.writeConfig("device")
iface.close()
```

**Q2 — True minimum safe send interval:**  
Given MEDIUM_FAST + hop_limit=1 and the relay scenario above, what is the provably safe minimum time between `sendText()` calls? Is there a formula based on ToA?

**Q3 — TX queue depth and overflow behavior:**  
What is the firmware TX queue depth? When overflow occurs, does the firmware drop silently, apply backpressure, or emit a log message?

**Q4 — BLE relay priority:**  
When Server is BLE-connected to a phone with the 15ms BLE connection interval, does the BLE stack interfere with LoRa RX interrupt handling? Could packets be missed by Server while BLE is transmitting?

**Q5 — Python `sendText()` blocking semantics:**  
At what point does `sendText()` return? When the packet is in the firmware queue? When it hits the hardware SX1262 TX FIFO? When the TX interrupt fires? Is there any way to get confirmation that a packet was actually emitted?

---

## 11. Recommended Fix

Change Server's device role to `CLIENT_MUTE` to eliminate the relay re-broadcast:

```python
# Run once to configure Server
from meshtastic.serial_interface import SerialInterface
import time

iface = SerialInterface("COM16")
time.sleep(2)

# CLIENT_MUTE = receives everything, relays nothing, still forwards to BLE
iface.localNode.localConfig.device.role = 3
iface.localNode.writeConfig("device")
time.sleep(2)
iface.close()
print("Done — Server will no longer relay LoRa packets.")
```

After confirming this works, add to `.config.yaml`:
```yaml
nodes:
  server:
    meshtastic_name: "Server"
    meshtastic_short: "S"
    device_role: "CLIENT_MUTE"   # does not relay — BLE-only leaf node
```

And wire into `config.py` `cmd_deploy()`:
```python
DEVICE_ROLE_MAP = {
    "CLIENT": 0, "CLIENT_MUTE": 3, "ROUTER": 1, "ROUTER_CLIENT": 2
}
role_name = node_cfg.get("device_role", "CLIENT")
role_code = DEVICE_ROLE_MAP.get(role_name.upper(), 0)
node_s.localConfig.device.role = role_code
node_s.writeConfig("device")
```

---

## 12. File References

| File | Path |
|------|------|
| Static config | [`control_podium/.config.yaml`](file:///c:/Users/sina_/workspace/BM26-Titanic/control_podium/.config.yaml) |
| Deploy CLI | [`control_podium/config.py`](file:///c:/Users/sina_/workspace/BM26-Titanic/control_podium/config.py) |
| Test fixtures | [`control_podium/tests/conftest.py`](file:///c:/Users/sina_/workspace/BM26-Titanic/control_podium/tests/conftest.py) |
| Visibility test | [`control_podium/tests/test_hello.py`](file:///c:/Users/sina_/workspace/BM26-Titanic/control_podium/tests/test_hello.py) |
| Messaging tests | [`control_podium/tests/test_messaging.py`](file:///c:/Users/sina_/workspace/BM26-Titanic/control_podium/tests/test_messaging.py) |
