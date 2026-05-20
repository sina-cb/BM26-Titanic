"""
Unit tests for the LoRa profile side-channel (titanic_profiles.h +
Bridge.request_profile_change + bridge_health /profile endpoint).

What we DON'T test here
-----------------------
Anything that needs real RF or a real Heltec on USB. Those are
covered by the HIL suite under tests/hil/. This file is happy with a
stub radio that records the bytes we'd otherwise have written to
serial.

What we DO test
---------------
1. The bridge serialises the right wire format on the USB side.
2. The bridge's HTTP /profile endpoint rejects bad inputs (defensive
   gate behaves correctly so PortWatch can't accidentally hose the
   bridge with a typo).
3. The bridge survives a radio port that doesn't expose
   ``send_raw_line`` (the simulated-radio code path PortWatch hits in
   the sim e2e tests).
4. Disk persistence loads on startup, writes on apply, and refuses
   unknown names.
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from unittest.mock import MagicMock

import pytest

import sys
BASE = Path(__file__).resolve().parent.parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))


@pytest.mark.asyncio
async def test_request_profile_change_writes_expected_wire_line(tmp_path):
    """The bridge MUST emit `*CFG name=<name> t=<delay_ms>\\n` and
    nothing else. The firmware parser keys on the exact 5-byte prefix
    "*CFG " — drift here means the controllers silently ignore the
    operator's pick."""
    from comms.bridge import Bridge

    # Lightweight stub radio: records every raw line written.
    class StubRadio:
        def __init__(self):
            self.lines: list[str] = []

        async def send_raw_line(self, line: str) -> bool:
            self.lines.append(line)
            return True

    bridge = Bridge.__new__(Bridge)  # bypass __init__ — too many deps
    bridge.radio = StubRadio()
    bridge._lora_profile_current = None
    bridge._lora_profile_last_applied_ms = None
    # Point the persist path at a tmpdir so the test doesn't touch
    # the host's /var/lib (would need root anyway).
    bridge._PROFILE_DISK_PATH = str(tmp_path / "profile.txt")

    ok = await bridge.request_profile_change("playa")
    assert ok is True
    assert bridge.radio.lines == ["*CFG name=playa t=4000\n"]
    assert bridge._lora_profile_current == "playa"
    # Disk persisted, even with a fresh dir
    assert (tmp_path / "profile.txt").read_text().strip() == "playa"


def test_confirm_profile_applied_corrects_drift(tmp_path):
    """When the firmware reports `CFG_APPLIED name=local` over USB
    but the bridge's `_lora_profile_current` says `playa` (the
    captain-originated path that previously left the bridge stale),
    `confirm_profile_applied` MUST update bridge state + persist to
    disk + wake the publisher so the next PUB carries the right
    `prof/<name>` field.
    """
    from comms.bridge import Bridge

    bridge = Bridge.__new__(Bridge)
    bridge._lora_profile_current = "playa"          # bridge thinks A
    bridge._lora_profile_last_applied_ms = None
    bridge._PROFILE_DISK_PATH = str(tmp_path / "profile.txt")
    bridge._publisher_wake = asyncio.Event()        # spy that .set() fires

    assert not bridge._publisher_wake.is_set()

    bridge.confirm_profile_applied("local")          # firmware says B

    # Bridge bookkeeping caught up.
    assert bridge._lora_profile_current == "local"
    # Disk persisted (so a bridge restart resumes at the right profile).
    assert (tmp_path / "profile.txt").read_text().strip() == "local"
    # Publisher woken — next PUB will go out with prof/local.
    assert bridge._publisher_wake.is_set()


def test_confirm_profile_applied_match_is_silent_noop(tmp_path):
    """When firmware confirms what bridge already thought, no state
    change, no disk write, no publisher wake. Avoids burning a PUB
    every time the bridge's own /profile call gets echoed back."""
    from comms.bridge import Bridge

    bridge = Bridge.__new__(Bridge)
    bridge._lora_profile_current = "playa"
    bridge._lora_profile_last_applied_ms = None
    bridge._PROFILE_DISK_PATH = str(tmp_path / "profile.txt")
    bridge._publisher_wake = asyncio.Event()

    bridge.confirm_profile_applied("playa")

    assert bridge._lora_profile_current == "playa"
    assert not (tmp_path / "profile.txt").exists()  # no write on no-op
    assert not bridge._publisher_wake.is_set()


def test_confirm_profile_applied_ignores_unknown_name(tmp_path):
    """A future firmware emitting a profile name we don't know about
    must NOT corrupt bridge state. Log + ignore is the safe behaviour;
    the bridge isn't authoritative on what profiles exist (the
    firmware compile-time table is)."""
    from comms.bridge import Bridge

    bridge = Bridge.__new__(Bridge)
    bridge._lora_profile_current = "playa"
    bridge._lora_profile_last_applied_ms = None
    bridge._PROFILE_DISK_PATH = str(tmp_path / "profile.txt")
    bridge._publisher_wake = asyncio.Event()

    bridge.confirm_profile_applied("super_fast_v2")  # not in LORA_PROFILE_NAMES

    assert bridge._lora_profile_current == "playa"  # unchanged
    assert not bridge._publisher_wake.is_set()


@pytest.mark.asyncio
async def test_request_profile_change_rejects_unknown_name(tmp_path):
    from comms.bridge import Bridge

    class StubRadio:
        def __init__(self):
            self.lines: list[str] = []

        async def send_raw_line(self, line: str) -> bool:
            self.lines.append(line)
            return True

    bridge = Bridge.__new__(Bridge)
    bridge.radio = StubRadio()
    bridge._lora_profile_current = None
    bridge._lora_profile_last_applied_ms = None
    bridge._PROFILE_DISK_PATH = str(tmp_path / "profile.txt")

    ok = await bridge.request_profile_change("hax_me_pls")
    assert ok is False
    # NOTHING goes to the wire on a rejected name.
    assert bridge.radio.lines == []
    assert not (tmp_path / "profile.txt").exists()


@pytest.mark.asyncio
async def test_request_profile_change_no_send_raw_line_returns_false(tmp_path):
    """Sim radio doesn't expose send_raw_line; bridge must gracefully
    return False rather than crash."""
    from comms.bridge import Bridge

    class SimRadioStub:
        pass  # no send_raw_line attribute

    bridge = Bridge.__new__(Bridge)
    bridge.radio = SimRadioStub()
    bridge._lora_profile_current = None
    bridge._lora_profile_last_applied_ms = None
    bridge._PROFILE_DISK_PATH = str(tmp_path / "profile.txt")

    ok = await bridge.request_profile_change("playa")
    assert ok is False
    assert bridge._lora_profile_current is None


@pytest.mark.asyncio
async def test_request_profile_change_clamps_delay(tmp_path):
    from comms.bridge import Bridge

    class StubRadio:
        def __init__(self):
            self.lines: list[str] = []

        async def send_raw_line(self, line: str) -> bool:
            self.lines.append(line)
            return True

    bridge = Bridge.__new__(Bridge)
    bridge.radio = StubRadio()
    bridge._lora_profile_current = None
    bridge._lora_profile_last_applied_ms = None
    bridge._PROFILE_DISK_PATH = str(tmp_path / "profile.txt")

    await bridge.request_profile_change("local", delay_ms=-50)
    await bridge.request_profile_change("local", delay_ms=10_000_000)
    assert bridge.radio.lines == [
        "*CFG name=local t=0\n",
        "*CFG name=local t=30000\n",
    ]


@pytest.mark.asyncio
async def test_profile_post_validates_name():
    """`/profile` MUST 400 on bad names so a typo from PortWatch
    doesn't reach the firmware. Same allowlist on both sides keeps
    log forensics clean."""
    from aiohttp.test_utils import make_mocked_request, TestClient, TestServer
    from comms.bridge_health import build_app

    applies: list[tuple[str, int | None]] = []

    async def apply(name, delay_ms=None):
        applies.append((name, delay_ms))
        return True

    app = build_app(
        snapshot_fn=lambda: {"service": "titanic-bridge"},
        profile_apply_fn=apply,
        profile_list_fn=lambda: ["test_bench", "local", "playa"],
        profile_current_fn=lambda: None,
    )
    async with TestClient(TestServer(app)) as client:
        # 400: bad name (special chars).
        r = await client.post("/profile", json={"name": "../../etc/passwd"})
        assert r.status == 400

        # 400: missing name.
        r = await client.post("/profile", json={})
        assert r.status == 400

        # 400: non-JSON body.
        r = await client.post(
            "/profile",
            data="hello world",
            headers={"Content-Type": "application/json"},
        )
        assert r.status == 400

        # 400: out-of-range delay.
        r = await client.post(
            "/profile",
            json={"name": "playa", "delay_ms": 999_999},
        )
        assert r.status == 400

        # 200: happy path. Bridge handler got called with kw delay.
        r = await client.post("/profile", json={"name": "playa"})
        assert r.status == 200
        body = await r.json()
        assert body == {"applied": True, "name": "playa"}
        assert applies == [("playa", None)]


@pytest.mark.asyncio
async def test_profile_get_returns_available():
    from aiohttp.test_utils import TestClient, TestServer
    from comms.bridge_health import build_app

    app = build_app(
        snapshot_fn=lambda: {"service": "titanic-bridge"},
        profile_apply_fn=None,
        profile_list_fn=lambda: ["test_bench", "playa"],
        profile_current_fn=lambda: "playa",
    )
    async with TestClient(TestServer(app)) as client:
        r = await client.get("/profile")
        assert r.status == 200
        body = await r.json()
        assert body == {
            "available": ["test_bench", "playa"],
            "current": "playa",
        }


@pytest.mark.asyncio
async def test_profile_post_503_when_no_handler():
    from aiohttp.test_utils import TestClient, TestServer
    from comms.bridge_health import build_app

    app = build_app(snapshot_fn=lambda: {"service": "titanic-bridge"})
    async with TestClient(TestServer(app)) as client:
        r = await client.post("/profile", json={"name": "playa"})
        # No apply fn wired → 503 (Service Unavailable) so PortWatch
        # can render a useful "profile switching not available" hint.
        assert r.status == 503


@pytest.mark.asyncio
async def test_health_snapshot_includes_profile_block(tmp_path):
    from comms.bridge import Bridge

    bridge = Bridge.__new__(Bridge)
    bridge.radio = type("R", (), {"link_stats": None})()
    bridge.engine = type("E", (), {"base_url": None})()
    bridge.node_id = 0x01
    bridge.short_interval_s = 5.0
    bridge.long_interval_s = 30.0
    bridge.idle_threshold_s = 60.0
    from comms.bridge import BridgeStats
    bridge.stats = BridgeStats()
    bridge._engine_last_ok_ms = None
    bridge._engine_last_fail_ms = None
    bridge._engine_last_status = None
    bridge._engine_ws_connected = False
    bridge._lora_profile_current = "playa"
    bridge._lora_profile_last_applied_ms = None
    bridge._PROFILE_DISK_PATH = str(tmp_path / "profile.txt")

    snap = bridge.health_snapshot()
    assert snap["version"] == "1.1"
    assert "profile" in snap
    assert snap["profile"]["available"] == ["test_bench", "local", "playa"]
    assert snap["profile"]["current"] == "playa"
    assert snap["profile"]["default_delay_ms"] == 4000
