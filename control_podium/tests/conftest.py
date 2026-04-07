"""
Shared fixtures for Heltec Raw LoRa HIL tests.

Both Heltec V4 controllers must be plugged in via USB.
Ports are resolved by MAC address from .config.pairing.yaml.

Usage:
    cd control_podium
    python -m pytest tests/ -v -s
"""
import os
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

import time
import threading
import pytest
import serial
import yaml
from pathlib import Path
from collections import deque

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils import discovery


# -- Config ------
PAIRING_PATH = Path(__file__).parent.parent / ".config.pairing.yaml"
HEALTH_CHECK_TIMEOUT = 120   # 2 minutes
HEALTH_CHECK_INTERVAL = 5


def load_heltec_config():
    """Load .config.pairing.yaml for MAC discovery."""
    with open(PAIRING_PATH, "r") as f:
        return yaml.safe_load(f)


# ── Fixtures ────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def config():
    """Load heltec config — fail fast if missing."""
    try:
        return load_heltec_config()
    except FileNotFoundError:
        pytest.fail(
            f"Config not found: {CONFIG_PATH}. "
            "This file defines node ports, MACs, and radio settings."
        )


@pytest.fixture(scope="session", autouse=True)
def health_check(config):
    """Gate ALL tests: verify both Heltec nodes are connected (MAC discovery).

    Does NOT open serial ports — that's left to the port fixtures so
    each test only holds the ports it needs.
    """
    nodes = ["podium", "server"]
    found = {}

    print("\n" + "=" * 60)
    print("  HEALTH CHECK — waiting for Heltec controllers...")
    print(f"  Timeout: {HEALTH_CHECK_TIMEOUT}s | Retry: {HEALTH_CHECK_INTERVAL}s")
    print("=" * 60)

    deadline = time.time() + HEALTH_CHECK_TIMEOUT

    while time.time() < deadline:
        for name in nodes:
            if name in found:
                continue
            node = config.get("nodes", {}).get(name, {})
            mac = node.get("mac")
            if not mac:
                continue
            port = discovery.find_port_by_mac(mac)
            if port:
                found[name] = port
                print(f"  [OK] {name}: {port} (MAC: {mac})")

        if len(found) == len(nodes):
            print("  [OK] Both Heltec controllers detected!\n")
            break

        remaining = int(deadline - time.time())
        missing = [n for n in nodes if n not in found]
        print(f"  [..] Waiting for: {', '.join(missing)} ({remaining}s remaining)...")
        time.sleep(HEALTH_CHECK_INTERVAL)
    else:
        missing = [n for n in nodes if n not in found]
        pytest.fail(
            f"HEALTH CHECK TIMEOUT: {', '.join(missing)} not detected "
            f"within {HEALTH_CHECK_TIMEOUT}s. Are they plugged in?"
        )

    config["_discovered_ports"] = found


@pytest.fixture(scope="session")
def podium_port(config, health_check):
    """Resolved COM port for the podium node."""
    return config["_discovered_ports"]["podium"]


@pytest.fixture(scope="session")
def server_port(config, health_check):
    """Resolved COM port for the server node."""
    return config["_discovered_ports"]["server"]


@pytest.fixture(scope="session")
def podium_serial(podium_port):
    """Open serial connection to the Podium node."""
    baud = 115200
    ser = serial.Serial(podium_port, baud, timeout=0.5)
    time.sleep(1)  # Let firmware boot message pass
    ser.reset_input_buffer()
    yield ser
    ser.close()


@pytest.fixture(scope="session")
def server_serial(server_port):
    """Open serial connection to the Server node."""
    baud = 115200
    ser = serial.Serial(server_port, baud, timeout=0.5)
    time.sleep(1)
    ser.reset_input_buffer()
    yield ser
    ser.close()


class SerialReader:
    """Background serial reader that collects lines into a deque."""

    def __init__(self, ser, name="reader"):
        self.ser = ser
        self.name = name
        self.lines = deque(maxlen=200)
        self.running = False
        self._thread = None

    def start(self):
        self.running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self.running = False
        if self._thread:
            self._thread.join(timeout=2)

    def _loop(self):
        while self.running:
            try:
                raw = self.ser.readline()
                if raw:
                    line = raw.decode("utf-8", errors="replace").strip()
                    if line:
                        self.lines.append(line)
            except Exception:
                if self.running:
                    time.sleep(0.01)

    def wait_for(self, prefix, timeout=5):
        """Wait for a line starting with prefix. Returns the line or None."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            for line in list(self.lines):
                if line.startswith(prefix):
                    return line
            time.sleep(0.05)
        return None

    def wait_for_containing(self, text, timeout=5):
        """Wait for a line containing text. Returns the line or None."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            for line in list(self.lines):
                if text in line:
                    return line
            time.sleep(0.05)
        return None

    def clear(self):
        self.lines.clear()


@pytest.fixture
def server_reader(server_serial):
    """Background reader for the server serial port."""
    reader = SerialReader(server_serial, "server")
    reader.start()
    yield reader
    reader.stop()


@pytest.fixture
def podium_reader(podium_serial):
    """Background reader for the podium serial port."""
    reader = SerialReader(podium_serial, "podium")
    reader.start()
    yield reader
    reader.stop()
