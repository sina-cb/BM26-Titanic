"""
Shared fixtures for control_podium tests.

Two flavors of test live alongside each other in this directory:

* **Unit / sim tests** (``test_comms_*``) — no hardware. They drive the
  Python comms stack directly or against ``sim_bus``. These run anywhere.
* **HIL tests** (``test_hil_*``, plus any test that takes the
  ``server_port`` / ``podium_port`` fixtures) — require both Heltec V4
  controllers plugged into USB and recorded in ``.config.nodes.yaml``.

The HIL fixtures are **opt-in**: tests that don't request them never
trigger a hardware probe. Tests that do request them either get the
right ports back, or the test is skipped with a clear message
(rather than session-failing on machines without hardware).

Single source of truth for board ↔ MAC mapping is
``.config.nodes.yaml``, written by ``firmware/deploy.py``.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from collections import deque
from typing import Dict, Optional

import pytest
import yaml

# Ensure ``control_podium`` is importable when pytest is invoked from the
# repo root with ``PYTHONPATH=.``.
_HERE = Path(__file__).resolve()
_PODIUM_DIR = _HERE.parent.parent
sys.path.insert(0, str(_PODIUM_DIR.parent))  # repo root, for `control_podium.*`
sys.path.insert(0, str(_PODIUM_DIR))         # in-package imports

os.environ.setdefault("PYTHONIOENCODING", "utf-8")

# ── Config source ─────────────────────────────────────────────────────
NODES_PATH = _PODIUM_DIR / ".config.nodes.yaml"


def _load_hil_pairings() -> Dict[str, Dict[str, str]]:
    """Return ``{role_or_name: {mac, node_id, role}}`` from
    ``.config.nodes.yaml``. Empty dict if missing — HIL tests self-skip.
    """
    if not NODES_PATH.exists():
        return {}
    try:
        doc = yaml.safe_load(NODES_PATH.read_text()) or {}
    except yaml.YAMLError:
        return {}
    nodes_by_id = doc.get("nodes") or {}
    out: Dict[str, Dict[str, str]] = {}
    for nid, n in nodes_by_id.items():
        if not isinstance(n, dict):
            continue
        mac = n.get("usb_mac")
        if not mac:
            continue
        # Index by both name and role so test code can ask for either.
        entry = {"mac": mac, "node_id": nid, "role": n.get("role")}
        if n.get("name"):
            out[n["name"]] = entry
        if n.get("role"):
            out.setdefault(n["role"], entry)
    return out


def _resolve_port(mac: str) -> Optional[str]:
    """Find /dev/cu.usbmodem* whose USB serial number == mac. None if no match."""
    try:
        from utils.discovery import find_port_by_mac
    except ImportError:
        return None
    try:
        return find_port_by_mac(mac)
    except Exception:
        return None


# ── HIL fixtures (opt-in) ─────────────────────────────────────────────


@pytest.fixture(scope="session")
def hil_pairings() -> Dict[str, Dict[str, str]]:
    """Loaded ``.config.nodes.yaml``; empty dict if file missing."""
    return _load_hil_pairings()


def _port_for(role_or_name: str, pairings: Dict[str, Dict[str, str]]) -> str:
    entry = pairings.get(role_or_name)
    if not entry:
        pytest.skip(
            f"HIL: no entry for {role_or_name!r} in .config.nodes.yaml "
            "(run firmware/deploy.py to bind a board)"
        )
    mac = entry.get("mac")
    if not mac:
        pytest.skip(f"HIL: {role_or_name!r} has no usb_mac")
    port = _resolve_port(mac)
    if not port:
        pytest.skip(
            f"HIL: board for {role_or_name!r} (MAC {mac}) not connected. "
            "Plug it in or run firmware/deploy.py --list to confirm."
        )
    return port


@pytest.fixture(scope="session")
def server_port(hil_pairings) -> str:
    """COM port for the server radio (node 0x01). Skips if missing."""
    return _port_for("server", hil_pairings)


@pytest.fixture(scope="session")
def podium_port(hil_pairings) -> str:
    """COM port for the captain radio (node 0x0A). Resolves by name
    ('sina') or role ('captain') from .config.nodes.yaml."""
    for key in ("sina", "captain"):
        if key in hil_pairings:
            return _port_for(key, hil_pairings)
    pytest.skip("HIL: no sina / captain entry in .config.nodes.yaml")


@pytest.fixture(scope="session")
def server_serial(server_port):
    import serial
    ser = serial.Serial(server_port, 115200, timeout=0.5)
    time.sleep(1)
    ser.reset_input_buffer()
    yield ser
    ser.close()


@pytest.fixture(scope="session")
def podium_serial(podium_port):
    import serial
    ser = serial.Serial(podium_port, 115200, timeout=0.5)
    time.sleep(1)
    ser.reset_input_buffer()
    yield ser
    ser.close()


# ── Background serial reader (used by HIL tests) ──────────────────────


class SerialReader:
    """Background serial reader that collects lines into a deque."""

    def __init__(self, ser, name="reader"):
        self.ser = ser
        self.name = name
        self.lines = deque(maxlen=200)
        self.running = False
        self._thread = None

    def start(self):
        import threading
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
        deadline = time.time() + timeout
        while time.time() < deadline:
            for line in list(self.lines):
                if line.startswith(prefix):
                    return line
            time.sleep(0.05)
        return None

    def wait_for_containing(self, text, timeout=5):
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
    reader = SerialReader(server_serial, "server")
    reader.start()
    yield reader
    reader.stop()


@pytest.fixture
def podium_reader(podium_serial):
    reader = SerialReader(podium_serial, "podium")
    reader.start()
    yield reader
    reader.stop()
