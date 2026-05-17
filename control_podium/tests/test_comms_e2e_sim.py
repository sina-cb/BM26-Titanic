"""
End-to-end test of the simulated radio stack.

Verifies the full chain:

    fake engine ←→ Bridge ←→ sim_bus ←→ RadioPortSim ←→ test client

No hardware. No real engine — we run a tiny ``http.server`` that responds to
the handful of REST paths the bridge talks to.

Run with:

    python -m pytest control_podium/tests/test_comms_e2e_sim.py -v --noconftest -s
"""
from __future__ import annotations

import asyncio
import http.server
import json
import socket
import sys
import threading
import time
from pathlib import Path
from textwrap import dedent

import pytest

BASE = Path(__file__).resolve().parent.parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from comms.acl import AclTable
from comms.bridge import Bridge
from comms.engine_client import EngineClient
from comms.frame import (
    BROADCAST,
    FLAG_ACK_REQUESTED,
    FLAG_PRIVILEGED,
    Frame,
    SERVER_ID,
    TYPE_ACK,
    TYPE_CMD,
    TYPE_HLO,
    TYPE_NAK,
    TYPE_PING,
    TYPE_PONG,
    TYPE_PUB,
    TYPE_QRY,
    TYPE_REP,
)
from comms.radio_port_sim import RadioPortSim
from comms.registry import CommandRegistry
from comms.sim_bus import SimBus


# ── Test fixtures: fake engine + sim_bus + bridge ─────────────────────────


class FakeEngine:
    """Minimal HTTP server mimicking MarsinEngine endpoints used by Bridge."""

    def __init__(self):
        self.state = {
            "pattern": "rainbow",
            # The real engine has TWO pattern sources that can drift:
            #   1. opts.pattern  (legacy, what GET /status returns)
            #   2. mixer.channels[base].pattern  (what every modern
            #      write path actually mutates — incl. CaptainPad's
            #      POST /mixer/channels/:id/playlist/entry which does
            #      NOT touch opts.pattern)
            # PortWatch reads via compact_status → mixer.base.pattern
            # so we track them separately here. Tests that only call
            # /set-pattern keep both in sync (the legacy POST handler
            # writes both); the dedicated mixer-only test (see
            # test_pattern_change_via_mixer_propagates) sets just this
            # one to simulate the CaptainPad path.
            "mixer_base_pattern": "rainbow",
            "blackout": False,
            "autopilot": False,
            "params": {"speed": {"value": 0.5}},
            "master": 1.0,
            "channels": [],
            "fx": {},
            # Default catalog is small so the existing tests stay fast;
            # paged-pattern test overrides this with a larger list to
            # exercise the multi-frame split.
            "patterns": ["rainbow", "sunset", "breathing"],
            "view_override": None,
            # Lease metadata for the controlLock. Real engine arms a
            # setTimeout in JS; here we just record the expiry ms and
            # auto-roll on read. Tests that need to exercise the lease
            # tune `view_override_lease_duration_ms` to a short value
            # so they don't sleep for the full 30 s production lease.
            "view_override_lease_duration_ms": 30_000,
            "view_override_lease_expires_at_ms": None,
            # Per-pattern WASM exports (kind 1=slider, 2=toggle,
            # 3=trigger, 4=plain, 6=hsvPicker). Tests override or extend
            # this directly when they need to exercise different shapes.
            # v0 mutates on /control writes.
            "exports": [
                {"id": 100, "kind": 1, "name": "sliderSpeed", "v0": 0.5},
                {"id": 101, "kind": 1, "name": "sliderAmplitude", "v0": 0.25},
                {"id": 102, "kind": 4, "name": "fadeMs"},  # non-slider, no v0
            ],
            # Mirrors the real engine's CPC shared-ownership filter
            # (see api_server.js::serializeMixerState +
            # paramCenter.isSharedExport / getBlockedIds). Exports whose
            # NAME is in this set OR whose ID is in
            # `blocked_export_ids` are EXCLUDED from `/mixer` so the UI
            # never sees a duplicate slider for something the CPC
            # already owns. Tests that need to exercise the filter
            # populate these directly.
            "shared_export_names": set(),
            "blocked_export_ids": set(),
            # Kinds the engine considers "local controls" (the rest are
            # WASM metadata exports that don't render in UIs). Mirror
            # of localControlKinds in api_server.js.
            "local_control_kinds": {1, 2, 3, 6},
            # Playlists library + active deck playlist + per-playlist
            # entries. Tests that care about playlist switching mutate
            # these. The entries lists drive the new
            # /playlists/<name> endpoint which the bridge calls when
            # resolving `qry engine/playlist-patterns`.
            "playlists": ["default", "warmup", "encore"],
            "playlist_entries": {
                "default": [
                    {"id": "e1", "pattern": "rainbow"},
                    {"id": "e2", "pattern": "sunset"},
                ],
                "warmup": [
                    {"id": "e1", "pattern": "breathing"},
                ],
                "encore": [],
            },
            "deck_playlist": {
                "name": "default",
                "activeEntryId": "e_default_0_rainbow",
            },
        }
        self._port = self._pick_port()
        self._server: http.server.HTTPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self._port}"

    @staticmethod
    def _pick_port() -> int:
        # Bind 0 to grab a free port, then close — short-lived race but fine.
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        return port

    def start(self) -> None:
        state = self.state

        def _now_ms() -> int:
            return int(time.time() * 1000)

        def _check_lease_expiry() -> None:
            # Mirror the engine's setTimeout-driven auto-clear: if the
            # lease has elapsed, drop view_override back to null. We
            # check on every read of the view-override state (compact
            # status pull, explicit GET) instead of using a real
            # background thread — tests stay deterministic and we
            # avoid leaking threads across the suite.
            exp = state["view_override_lease_expires_at_ms"]
            if exp is None:
                return
            if _now_ms() >= exp:
                state["view_override"] = None
                state["view_override_lease_expires_at_ms"] = None

        def _arm_lease() -> None:
            state["view_override_lease_expires_at_ms"] = (
                _now_ms() + int(state["view_override_lease_duration_ms"])
            )

        def _disarm_lease() -> None:
            state["view_override_lease_expires_at_ms"] = None

        def _lease_remaining_ms() -> int:
            exp = state["view_override_lease_expires_at_ms"]
            if exp is None:
                return 0
            return max(0, exp - _now_ms())

        class Handler(http.server.BaseHTTPRequestHandler):
            # Silence log spam in pytest output.
            def log_message(self, *a, **k):  # noqa: N802
                return

            def _send(self, code: int, body: dict | list | None = None) -> None:
                payload = json.dumps(body if body is not None else {}).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_GET(self):  # noqa: N802
                if self.path == "/status":
                    return self._send(200, {
                        "activePattern": state["pattern"],
                    })
                if self.path in ("/list-patterns", "/patterns"):
                    return self._send(200, state["patterns"])
                if self.path == "/param-center":
                    return self._send(200, {"params": state["params"]})
                if self.path == "/mixer":
                    # Mirror the real engine's serializeMixerState
                    # filter chain so the bridge's get_exports() (which
                    # reads from /mixer) sees what production sees:
                    #   * drop kinds outside the local-control set
                    #     (WASM metadata exports, not for UIs)
                    #   * drop names the CPC has marked shared
                    #   * drop IDs the CPC has blocked
                    # This is what hides duplicate sliders (e.g.
                    # `sliderSpeed` when CPC owns `speed`) on both
                    # CaptainPad's deck card and PortWatch's local
                    # params strip.
                    filtered_exports = [
                        e for e in state["exports"]
                        if e.get("kind") in state["local_control_kinds"]
                        and e.get("name") not in state["shared_export_names"]
                        and e.get("id") not in state["blocked_export_ids"]
                    ]
                    base: dict = {
                        "id": "ch_base_test",
                        # Fixed human-readable name. Earlier versions of
                        # PortWatch / CaptainPad let the operator pick a
                        # different "target channel" — that UX was
                        # removed in May 2026 (see docs/16_captain_pad.md
                        # §"Target channel removal" and
                        # docs/21_portwatch_monitor.md §"Target-channel
                        # removal (2026-05)"), and the bridge no longer
                        # publishes `tch`/`nch`/`chs`. We keep a fixed
                        # name here for any test paths that still inspect
                        # /mixer.channels[].name directly.
                        "name": "DECK MAIN",
                        # NB: serve mixer_base_pattern (not the legacy
                        # opts.pattern at state["pattern"]) so we can
                        # exercise the CaptainPad-style "mixer changed,
                        # opts didn't" desync that motivated this fix.
                        "pattern": state["mixer_base_pattern"],
                        "exports": filtered_exports,
                    }
                    # Carry the active deck playlist on the base
                    # channel so the bridge's compact_status can find
                    # `pl/<name>` here. The real engine stores it on
                    # the channel record (mixerState.channels[i].
                    # playlist); we mirror that exact shape.
                    dp = state["deck_playlist"]
                    if isinstance(dp, dict) and dp.get("name"):
                        base["playlist"] = {
                            "name": dp.get("name"),
                            "activeEntryId": dp.get("activeEntryId"),
                        }
                    return self._send(200, {
                        "master": state["master"],
                        "channels": [base] + list(state["channels"]),
                        "baseChannelId": base["id"],
                    })
                if self.path == "/exports":
                    # Engine's /exports drops live v0 — FakeEngine
                    # mirrors that so the bridge has to pull v0 from
                    # /mixer (exercising the merge in get_exports()).
                    schema = [
                        {k: v for k, v in e.items() if k != "v0"}
                        for e in state["exports"]
                    ]
                    return self._send(200, schema)
                if self.path == "/globals":
                    return self._send(200, {"blackoutActive": state["blackout"]})
                if self.path == "/autopilot":
                    return self._send(200, {"active": state["autopilot"]})
                if self.path == "/playlists":
                    return self._send(200, state["playlists"])
                if self.path.startswith("/playlists/"):
                    # Per-playlist GET: engine returns full doc with
                    # entries. The bridge calls this from
                    # `get_deck_playlist_patterns` when resolving the
                    # `engine/playlist-patterns` query.
                    name = self.path[len("/playlists/"):]
                    try:
                        from urllib.parse import unquote
                        name = unquote(name)
                    except Exception:  # pragma: no cover — defensive
                        pass
                    entries = state["playlist_entries"].get(name)
                    if entries is None:
                        return self._send(404, {"error": "not_found"})
                    return self._send(200, {
                        "name": name,
                        "entries": entries,
                    })
                if self.path == "/deck/playlist":
                    return self._send(200, state["deck_playlist"])
                if self.path == "/mixer/view-override":
                    # Auto-roll any expired lease so polling clients
                    # see the post-expiry state without needing a
                    # separate "you are now stale" signal.
                    _check_lease_expiry()
                    cl = "portwatch" if state["view_override"] == "deck" else None
                    return self._send(200, {
                        "override": state["view_override"],
                        "controlLock": cl,
                        "controlLockLeaseExpiresAtMs":
                            state["view_override_lease_expires_at_ms"],
                        "controlLockLeaseRemainingMs": _lease_remaining_ms(),
                        "controlLockLeaseDurationMs":
                            state["view_override_lease_duration_ms"]
                            if cl is not None else None,
                        "currentView": "deck" if state["view_override"] == "deck" else "mixer",
                        "savedView": None,
                    })
                self._send(404)

            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length", 0) or 0)
                body = self.rfile.read(length)
                try:
                    data = json.loads(body or b"{}")
                except json.JSONDecodeError:
                    return self._send(400, {"error": "bad json"})

                if self.path == "/set-pattern":
                    new_pat = data.get("pattern", state["pattern"])
                    state["pattern"] = new_pat
                    # /set-pattern in the real engine writes both
                    # opts.pattern AND the base channel's pattern. Mirror
                    # that here so legacy tests that only look at
                    # state["pattern"] keep working AND compact_status
                    # (which now reads from the mixer base channel)
                    # sees the change immediately.
                    state["mixer_base_pattern"] = new_pat
                    return self._send(200, {"status": "ok"})
                if self.path == "/param-center":
                    for k, v in data.items():
                        state["params"].setdefault(k, {})["value"] = v
                    return self._send(200, {"status": "ok", "revision": 1})
                if self.path == "/global-blackout":
                    state["blackout"] = bool(data.get("state"))
                    return self._send(200, {"status": "ok"})
                if self.path == "/autopilot":
                    state["autopilot"] = bool(data.get("active", state["autopilot"]))
                    return self._send(200, {"status": "ok"})
                if self.path == "/global-effect":
                    fx = data.get("effect", "?")
                    state["fx"][fx] = bool(data.get("state"))
                    return self._send(200, {"status": "ok"})
                if self.path == "/mixer/view-override":
                    req = data.get("override")
                    if req == "deck":
                        state["view_override"] = "deck"
                        # Every successful POST restarts the lease,
                        # whether it's the initial take OR a renew.
                        _arm_lease()
                    elif req in (None, "", "clear"):
                        state["view_override"] = None
                        _disarm_lease()
                    else:
                        return self._send(400, {"error": "bad override"})
                    cl = "portwatch" if state["view_override"] == "deck" else None
                    return self._send(200, {
                        "status": "ok",
                        "override": state["view_override"],
                        "controlLock": cl,
                        "controlLockLeaseExpiresAtMs":
                            state["view_override_lease_expires_at_ms"],
                        "controlLockLeaseDurationMs":
                            state["view_override_lease_duration_ms"]
                            if cl is not None else None,
                    })
                if self.path == "/control":
                    # Mutate the matching export's v0 so subsequent
                    # /mixer reads return the new value.
                    target_id = data.get("id")
                    new_v0 = float(data.get("v0", 0))
                    for e in state["exports"]:
                        if e.get("id") == target_id:
                            e["v0"] = new_v0
                            break
                    return self._send(200, {"status": "ok", "id": target_id})
                if self.path == "/deck/playlist":
                    name = data.get("name")
                    if name not in state["playlists"]:
                        return self._send(404, {"error": "not found"})
                    state["deck_playlist"] = {
                        "name": name,
                        "activeEntryId": f"e_{name}_0_test",
                    }
                    return self._send(200, {"status": "ok"})
                self._send(404)

            def do_PATCH(self):  # noqa: N802
                length = int(self.headers.get("Content-Length", 0) or 0)
                body = self.rfile.read(length)
                try:
                    data = json.loads(body or b"{}")
                except json.JSONDecodeError:
                    return self._send(400, {"error": "bad json"})
                if self.path == "/mixer":
                    if "master" in data:
                        state["master"] = float(data["master"])
                    return self._send(200, {"status": "ok"})
                if self.path.startswith("/mixer/channels/"):
                    return self._send(200, {"status": "ok"})
                self._send(404)

        self._server = http.server.HTTPServer(("127.0.0.1", self._port), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever,
                                        daemon=True)
        self._thread.start()
        # Wait for it to actually accept connections.
        deadline = time.time() + 2.0
        while time.time() < deadline:
            try:
                s = socket.create_connection(("127.0.0.1", self._port), timeout=0.2)
                s.close()
                return
            except OSError:
                time.sleep(0.05)
        raise RuntimeError("fake engine never came up")

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2.0)


# ── Async helpers ─────────────────────────────────────────────────────────


async def _wait_for(predicate, timeout: float = 3.0, step: float = 0.05):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        await asyncio.sleep(step)
    return False


async def _wait_until_ready(bus, *, expected_clients: int = 2,
                            timeout: float = 3.0) -> None:
    """Wait for ``len(bus._clients) >= expected_clients`` AND yield once
    more so the bridge's coroutines (rx_loop / status_publisher) have
    actually started awaiting on the radio.

    Without that final yield, a test that fires a frame on the very next
    line can race the bridge's `await self.radio.recv_frames()` —
    bus has accepted the connection but the receiver coroutine hasn't
    been scheduled yet. The race shows up as a 6 s wait_for_reply
    timeout when prior tests have warmed the event loop / thread pool
    and made the scheduler greedier with non-IO tasks.
    """
    await _wait_for(
        lambda: len(bus._clients) >= expected_clients,  # noqa: SLF001
        timeout=timeout,
    )
    # Two short sleeps rather than one longer one — gives the bridge
    # explicit two scheduler "ticks" to drain its startup queue.
    await asyncio.sleep(0.05)
    await asyncio.sleep(0.05)


async def _cancel_and_drain(*tasks: asyncio.Task) -> None:
    """Cancel tasks and swallow CancelledError + any other exit error.

    ``asyncio.CancelledError`` is a ``BaseException`` in Python 3.8+, so a
    bare ``except Exception`` won't catch it — easy to forget in test teardown.
    """
    for t in tasks:
        t.cancel()
    for t in tasks:
        try:
            await t
        except (asyncio.CancelledError, Exception):
            pass


async def _start_bus(port: int) -> tuple[SimBus, asyncio.Task]:
    bus = SimBus(host="127.0.0.1", port=port)
    task = asyncio.create_task(bus.serve())
    # Wait for the listener to be up.
    for _ in range(50):
        try:
            s = socket.create_connection(("127.0.0.1", port), timeout=0.2)
            s.close()
            break
        except OSError:
            await asyncio.sleep(0.05)
    else:
        raise RuntimeError("sim_bus never bound")
    return bus, task


@pytest.fixture
def acl_path(tmp_path: Path) -> Path:
    p = tmp_path / "nodes.yaml"
    p.write_text(dedent("""
        nodes:
          0x01:
            name: server
            role: server
          0x0A:
            name: sina
            role: priv
          0x10:
            name: crew_01
            role: reg
    """).strip(), encoding="utf-8")
    return p


@pytest.fixture
def registry_path(tmp_path: Path) -> Path:
    p = tmp_path / "commands.yaml"
    p.write_text(dedent("""
        commands:
          pattern:
            enabled: true
            min_role: priv
          param:
            enabled: true
            min_role: priv
          blackout:
            enabled: true
            min_role: priv
          autopilot:
            enabled: true
            min_role: priv
          fx:
            enabled: true
            min_role: priv
          brightness:
            enabled: true
            min_role: priv
          mixer:
            enabled: true
            min_role: priv
          view:
            enabled: true
            min_role: priv
          palette:
            enabled: true
            min_role: priv
          exp:
            enabled: true
            min_role: priv
          playlist:
            enabled: true
            min_role: priv
        queries:
          engine/status:
            enabled: true
            min_role: reg
          engine/patterns:
            enabled: true
            min_role: reg
          engine/playlist-patterns:
            enabled: true
            min_role: reg
          engine/get-playlist-patterns:
            enabled: true
            min_role: reg
          param:
            enabled: true
            min_role: reg
          params:
            enabled: true
            min_role: reg
          exports:
            enabled: true
            min_role: reg
          playlists:
            enabled: true
            min_role: reg
          deck/playlist:
            enabled: true
            min_role: reg
          mixer/state:
            enabled: true
            min_role: reg
    """).strip(), encoding="utf-8")
    return p


@pytest.fixture
def fake_engine():
    eng = FakeEngine()
    eng.start()
    yield eng
    eng.stop()


def _make_bridge(*, bus_port: int, acl_path: Path, registry_path: Path,
                 fake_engine,
                 short_interval_s: float = 10,
                 long_interval_s: float = 10) -> Bridge:
    acl = AclTable.load(acl_path)
    registry = CommandRegistry.load(registry_path)
    engine = EngineClient(base_url=fake_engine.base_url)
    return Bridge(
        radio=RadioPortSim(port=bus_port, name="bridge"),
        engine=engine, acl=acl, registry=registry,
        short_interval_s=short_interval_s,
        long_interval_s=long_interval_s,
        idle_threshold_s=60,
        # FakeEngine only speaks HTTP/1.0 — pointing the bridge's WS
        # subscriber at it fills the log with handshake-fail backoff
        # noise and leaks thread-pool work that flakes subsequent
        # tests' 3-second reply timeouts. The WS subscriber's only job
        # is to wake the publisher early on engine-side state changes,
        # which periodic polling already covers in tests.
        enable_engine_ws_subscriber=False,
    )


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


# ── A tiny test client (no readline UI) ───────────────────────────────────


class _TestClient:
    def __init__(self, radio: RadioPortSim, node_id: int):
        self.radio = radio
        self.node_id = node_id
        self.received: list[Frame] = []
        self._seq = 0

    async def start(self) -> None:
        await self.radio.open()
        self._rx_task = asyncio.create_task(self._rx_loop())

    async def stop(self) -> None:
        await _cancel_and_drain(self._rx_task)
        await self.radio.close()

    async def _rx_loop(self) -> None:
        async for frame in self.radio.recv_frames():
            self.received.append(frame)

    async def send(self, typ: str, arg: str, *, want_ack: bool = True,
                   role_priv: bool = False) -> Frame:
        self._seq = (self._seq + 1) & 0xFF
        flags = 0
        if want_ack:
            flags |= FLAG_ACK_REQUESTED
        if role_priv:
            flags |= FLAG_PRIVILEGED
        f = Frame(src=self.node_id, dst=SERVER_ID, seq=self._seq, typ=typ,
                  flags=flags, arg=arg)
        await self.radio.send(f)
        return f

    async def wait_for_reply(self, seq: int, *, timeout: float = 6.0) -> Frame:
        # Bumped from 3.0s — running the full control_podium test
        # suite back-to-back warms enough event-loop / thread-pool
        # state that 3s occasionally wasn't enough for the bridge's
        # very first reply-after-warm-up. The actual round trip is
        # well under 100 ms, but a one-shot startup spike of ~3.5s on
        # a busy CI box was enough to flake the assertion. 6s keeps
        # bona-fide hangs visible without flaking on warmup.
        deadline = time.time() + timeout
        while time.time() < deadline:
            for f in self.received:
                if f.dst == self.node_id and f.seq == seq and f.typ in (
                        TYPE_ACK, TYPE_NAK, TYPE_REP, TYPE_PONG):
                    return f
            await asyncio.sleep(0.02)
        raise AssertionError(f"no reply to seq=0x{seq:02X} within {timeout}s")


# ── Test cases ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ping_round_trip(acl_path: Path, registry_path: Path,
                               fake_engine: FakeEngine):
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)

    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        # Wait for both connections to be present on the bus.
        await _wait_until_ready(bus)
        f = await client.send(TYPE_PING, "", want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_PONG
        assert reply.src == SERVER_ID
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_priv_can_change_pattern(acl_path: Path, registry_path: Path,
                                       fake_engine: FakeEngine):
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)

    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)
        f = await client.send(TYPE_CMD, "pattern/sunset", want_ack=True,
                              role_priv=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_ACK
        # Engine state reflects the change.
        assert fake_engine.state["pattern"] == "sunset"
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_reg_cannot_change_pattern(acl_path: Path, registry_path: Path,
                                         fake_engine: FakeEngine):
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)

    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
    )
    bridge_task = asyncio.create_task(bridge.run())

    # 0x10 is "reg" — reads allowed, writes denied.
    client = _TestClient(RadioPortSim(port=bus_port, name="client-10"),
                         node_id=0x10)
    await client.start()

    try:
        await _wait_until_ready(bus)
        # Pre-state
        assert fake_engine.state["pattern"] == "rainbow"
        f = await client.send(TYPE_CMD, "pattern/sunset", want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_NAK
        assert "acl_denied" in reply.arg
        # Engine unchanged
        assert fake_engine.state["pattern"] == "rainbow"

        # Query is allowed for regular clients.
        f2 = await client.send(TYPE_QRY, "engine/status", want_ack=True)
        reply2 = await client.wait_for_reply(f2.seq)
        assert reply2.typ == TYPE_REP
        assert "pat" in reply2.arg
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_paged_patterns_query(acl_path: Path, registry_path: Path,
                                    fake_engine: FakeEngine):
    """`qry engine/patterns/p/<n>` must return one paged frame per call
    with stable `p/`, `t/`, `n/`, `c/` headers, and joining every page
    must reproduce the engine's full catalog (no names dropped or
    duplicated). This is the contract PortWatch's multi-page client
    loops on, so a regression here would silently truncate the picker
    again."""
    # Override fake engine pattern catalog with enough names to force
    # at least 2 pages at the bridge's 100-char CSV budget.
    fake_engine.state["patterns"] = [
        f"{i:02d}_pattern_{name}"
        for i, name in enumerate([
            "rainbow", "sunset", "ocean", "breathing", "fire", "snow",
            "wave", "stars", "comet", "pulse", "ripple", "mosaic",
            "neon", "spectrum", "aurora", "drift", "echo", "flame",
            "mist", "glow",
        ])
    ]

    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)

    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)

        # Page 0
        f = await client.send(TYPE_QRY, "engine/patterns/p/0", want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_REP
        meta = _parse_paged_reply(reply.arg)
        assert meta["p"] == 0
        total_pages = int(meta["t"])
        total_count = int(meta["n"])
        assert total_pages >= 2, "Test setup error: fixture should force >1 page"
        assert total_count == len(fake_engine.state["patterns"])

        all_names = list(meta["c"].split(","))
        # Walk remaining pages.
        for idx in range(1, total_pages):
            f = await client.send(
                TYPE_QRY, f"engine/patterns/p/{idx}", want_ack=True,
            )
            reply = await client.wait_for_reply(f.seq)
            assert reply.typ == TYPE_REP
            page_meta = _parse_paged_reply(reply.arg)
            assert page_meta["p"] == idx
            all_names.extend(page_meta["c"].split(","))

        assert all_names == fake_engine.state["patterns"], (
            "joined paged patterns must equal the engine catalog "
            f"(got {len(all_names)} names, expected {total_count})"
        )

        # Legacy single-page shape still works (truncated CSV + +N).
        f = await client.send(TYPE_QRY, "engine/patterns", want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_REP
        # Should include "+N" because the catalog overflows one frame.
        assert "+" in reply.arg
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


def _parse_playlist_paged_reply(arg: str) -> dict:
    """Parse the `engine/playlist-patterns` page shape:
    `p/<n>,t/<n>,n/<n>,pl/<name>,c/<csv>`.

    Same single-blob CSV treatment as _parse_paged_reply, but with an
    extra `pl/<name>` field that the bridge inserts so callers can
    sanity-check which playlist the page is scoped to.
    """
    out: dict = {}
    cur = arg
    for key in ("p", "t", "n"):
        token, _, cur = cur.partition(",")
        k, _, v = token.partition("/")
        if k != key:
            raise AssertionError(f"expected {key}/<n> at start of {arg!r}")
        out[k] = int(v)
    pl_token, _, cur = cur.partition(",")
    if not pl_token.startswith("pl/"):
        raise AssertionError(f"expected pl/<name>, got {pl_token!r}")
    out["pl"] = pl_token[3:]
    if not cur.startswith("c/"):
        raise AssertionError(f"expected c/<csv> tail in {arg!r}, got {cur!r}")
    out["c"] = cur[2:]
    return out


@pytest.mark.asyncio
async def test_playlist_patterns_scoped_to_active_playlist(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """`qry engine/playlist-patterns/p/0` must return ONLY the patterns
    of the deck's currently-loaded playlist, NOT the engine's full
    catalog. Switching the deck playlist must change the result of the
    next page-0 query.

    This is the wire surface PortWatch's pattern picker uses; if it
    leaked the full catalog the picker would let the operator tap a
    name not in the playlist and silently move the deck off-cursor.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)
        # Default playlist has two entries → two patterns.
        f = await client.send(TYPE_QRY, "engine/playlist-patterns/p/0",
                              want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_REP, reply
        meta = _parse_playlist_paged_reply(reply.arg)
        assert meta["pl"] == "default"
        assert meta["n"] == 2, meta
        # Names are in playlist order; the catalog has `breathing` too,
        # but it lives in `warmup`, not `default` — so it MUST NOT
        # appear here.
        got = [s for s in meta["c"].split(",") if s]
        assert got == ["rainbow", "sunset"], got
        assert "breathing" not in got

        # Switch the deck playlist via the bridge `cmd playlist/warmup`.
        f = await client.send(TYPE_CMD, "playlist/warmup", want_ack=True,
                              role_priv=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_ACK
        # FakeEngine's POST /deck/playlist updates state["deck_playlist"].
        assert fake_engine.state["deck_playlist"]["name"] == "warmup"

        # Now the page-0 query should reflect the new playlist's entries.
        f = await client.send(TYPE_QRY, "engine/playlist-patterns/p/0",
                              want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_REP, reply
        meta = _parse_playlist_paged_reply(reply.arg)
        assert meta["pl"] == "warmup"
        assert meta["n"] == 1
        got = [s for s in meta["c"].split(",") if s]
        assert got == ["breathing"], got

        # An empty playlist must still return a valid page (not NAK)
        # so PortWatch's picker can show the empty state.
        f = await client.send(TYPE_CMD, "playlist/encore", want_ack=True,
                              role_priv=True)
        await client.wait_for_reply(f.seq)
        f = await client.send(TYPE_QRY, "engine/playlist-patterns/p/0",
                              want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_REP, reply
        meta = _parse_playlist_paged_reply(reply.arg)
        assert meta["pl"] == "encore"
        assert meta["n"] == 0
        assert meta["c"] == ""

        # Clear the deck playlist and confirm bridge surfaces `pl/-`.
        fake_engine.state["deck_playlist"] = None
        f = await client.send(TYPE_QRY, "engine/playlist-patterns/p/0",
                              want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_REP, reply
        meta = _parse_playlist_paged_reply(reply.arg)
        assert meta["pl"] == "-"
        assert meta["n"] == 0
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_get_playlist_patterns_by_name_returns_arbitrary_playlist(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """`qry engine/get-playlist-patterns/<name>/p/<n>` must return the
    NAMED playlist's pattern list regardless of which playlist is
    currently loaded on the deck.

    This is the wire surface PortWatch's REFRESH-WORLD action uses to
    fan a single operator press out into a full pre-population of the
    per-playlist patterns cache for every name in the library. The op
    MUST NOT change the deck as a side-effect — operators rely on
    REFRESH being a passive read-only sync.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)
        # Confirm baseline: deck is on `default` with [rainbow, sunset].
        assert fake_engine.state["deck_playlist"]["name"] == "default"

        # Fetch `warmup` by name — without changing the deck.
        f = await client.send(
            TYPE_QRY, "engine/get-playlist-patterns/warmup/p/0",
            want_ack=True,
        )
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_REP, reply
        meta = _parse_playlist_paged_reply(reply.arg)
        assert meta["pl"] == "warmup"
        assert meta["n"] == 1
        got = [s for s in meta["c"].split(",") if s]
        assert got == ["breathing"]

        # The deck MUST still be on `default` — the op is read-only.
        assert fake_engine.state["deck_playlist"]["name"] == "default"

        # Fetch `default` by name — same payload as the deck-scoped op
        # would produce (verifies the two ops are symmetric on the
        # active playlist).
        f = await client.send(
            TYPE_QRY, "engine/get-playlist-patterns/default/p/0",
            want_ack=True,
        )
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_REP, reply
        meta = _parse_playlist_paged_reply(reply.arg)
        assert meta["pl"] == "default"
        assert meta["n"] == 2
        got = [s for s in meta["c"].split(",") if s]
        assert got == ["rainbow", "sunset"]

        # An empty playlist returns a valid empty page (not NAK) so
        # PortWatch's rebuilder can persist a "this playlist exists
        # but has zero usable entries" record rather than retrying
        # forever on the next REFRESH.
        f = await client.send(
            TYPE_QRY, "engine/get-playlist-patterns/encore/p/0",
            want_ack=True,
        )
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_REP, reply
        meta = _parse_playlist_paged_reply(reply.arg)
        assert meta["pl"] == "encore"
        assert meta["n"] == 0
        assert meta["c"] == ""

        # Unknown name → also a valid empty page (engine returns 404,
        # bridge maps that to an empty pattern list). The wire name is
        # echoed verbatim so PortWatch can distinguish "wrong name
        # the operator typed" from "this playlist truly has no
        # entries".
        f = await client.send(
            TYPE_QRY, "engine/get-playlist-patterns/never_existed/p/0",
            want_ack=True,
        )
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_REP, reply
        meta = _parse_playlist_paged_reply(reply.arg)
        assert meta["pl"] == "never_existed"
        assert meta["n"] == 0
        assert meta["c"] == ""

        # Malformed (missing `/p/<n>`) must NAK with unknown_qry.
        f = await client.send(
            TYPE_QRY, "engine/get-playlist-patterns/warmup",
            want_ack=True,
        )
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_NAK
        assert reply.arg == "unknown_qry"
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_view_override_cmd(acl_path: Path, registry_path: Path,
                                 fake_engine: FakeEngine):
    """`cmd view/deck` and `cmd view/clear` must round-trip to the
    engine's /mixer/view-override endpoint with the right payload so
    PortWatch can pin the engine output during a live moment."""
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)
        # Engage override
        f = await client.send(TYPE_CMD, "view/deck", want_ack=True,
                              role_priv=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_ACK
        assert fake_engine.state["view_override"] == "deck"

        # Release override
        f = await client.send(TYPE_CMD, "view/clear", want_ack=True,
                              role_priv=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_ACK
        assert fake_engine.state["view_override"] is None
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


def _parse_paged_reply(arg: str) -> dict:
    """Parse the bridge's `p/<n>,t/<n>,n/<n>,c/<csv>` paged-patterns
    reply. The CSV after `c/` may itself contain commas, so we have to
    consume the prefix metadata first and treat the rest as a single
    blob — a naive `arg.split(",")` would shred the CSV."""
    out: dict = {}
    cur = arg
    for key in ("p", "t", "n"):
        token, _, cur = cur.partition(",")
        k, _, v = token.partition("/")
        if k != key:
            raise AssertionError(f"expected {key}/<n> at start of {arg!r}")
        out[k] = int(v)
    # Remainder is `c/<csv>` (CSV may contain commas — preserve it).
    if not cur.startswith("c/"):
        raise AssertionError(f"expected c/<csv> tail in {arg!r}, got {cur!r}")
    out["c"] = cur[2:]
    return out


@pytest.mark.asyncio
async def test_param_set_and_pub(acl_path: Path, registry_path: Path,
                                 fake_engine: FakeEngine):
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)

    # Short publish interval so the test doesn't wait long.
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        short_interval_s=0.5, long_interval_s=0.5,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)
        # Set speed via cmd
        f = await client.send(TYPE_CMD, "param/speed/0.7", want_ack=True,
                              role_priv=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_ACK

        # Engine reflects new speed
        assert fake_engine.state["params"]["speed"]["value"] == 0.7

        # Wait for the next pub broadcast and confirm it shows the new speed.
        await _wait_for(
            lambda: any(p.typ == TYPE_PUB and "sp/0.7" in p.arg
                        for p in client.received),
            timeout=3.0,
        )
        pubs = [p for p in client.received if p.typ == TYPE_PUB]
        assert pubs, "expected at least one pub"
        assert any("sp/0.7" in p.arg for p in pubs)
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_global_params_round_trip(acl_path: Path, registry_path: Path,
                                        fake_engine: FakeEngine):
    """Full snapshot via `qry params`, scalar write via `cmd param/<k>/<v>`,
    HSV write via the `palette` alias, then re-read to confirm."""
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)

        # Seed engine with values for every param the snapshot exposes
        # so we can match them in the reply (the FakeEngine starts with
        # only `speed` populated).
        fake_engine.state["params"] = {
            "speed": {"value": 0.42},
            "direction": {"value": 1.0},
            "count": {"value": 0.5},
            "size": {"value": 0.25},
            "rotate": {"value": 0.0},
            "colorPalette1": {"value": {"h": 0.3, "s": 1.0, "v": 1.0}},
            "colorPalette2": {"value": {"h": 0.7, "s": 0.5, "v": 0.8}},
        }

        # 1. qry params returns the full snapshot
        f = await client.send(TYPE_QRY, "params", want_ack=True, role_priv=False)
        rep = await client.wait_for_reply(f.seq)
        assert rep.typ == TYPE_REP, rep.arg
        kv = dict(t.split("/", 1) for t in rep.arg.split(","))
        assert kv["sp"] == "0.42", kv
        assert kv["dr"] == "1", kv
        assert kv["ct"] == "0.5", kv
        assert kv["sz"] == "0.25", kv
        assert kv["rt"] == "0", kv
        assert kv["p1"] == "0.3-1-1", kv
        assert kv["p2"] == "0.7-0.5-0.8", kv

        # 2. cmd param scalar write
        f = await client.send(TYPE_CMD, "param/size/0.75", want_ack=True,
                              role_priv=True)
        rep = await client.wait_for_reply(f.seq)
        assert rep.typ == TYPE_ACK
        assert fake_engine.state["params"]["size"]["value"] == 0.75

        # 3. cmd palette HSV write (colorPalette1)
        f = await client.send(TYPE_CMD, "palette/1/0.6-0.8-0.9", want_ack=True,
                              role_priv=True)
        rep = await client.wait_for_reply(f.seq)
        assert rep.typ == TYPE_ACK
        p1 = fake_engine.state["params"]["colorPalette1"]["value"]
        assert abs(p1["h"] - 0.6) < 1e-3
        assert abs(p1["s"] - 0.8) < 1e-3
        assert abs(p1["v"] - 0.9) < 1e-3

        # 4. Re-snapshot reflects the writes
        f = await client.send(TYPE_QRY, "params", want_ack=True)
        rep = await client.wait_for_reply(f.seq)
        kv = dict(t.split("/", 1) for t in rep.arg.split(","))
        assert kv["sz"] == "0.75"
        assert kv["p1"] == "0.6-0.8-0.9"
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_local_exports_query_and_write(acl_path: Path,
                                             registry_path: Path,
                                             fake_engine: FakeEngine):
    """`qry exports/p/<n>` returns the deck base channel's exports
    (id, kind, v0, name) in the paged shape PortWatch expects, and
    `cmd exp/<id>/<v0>` mutates the engine state so the next page
    reflects the change.

    Engine-side, the mixer serializer filters exports by kind (only
    1/2/3/6 are local-controls); we mirror that filter in FakeEngine
    so this test reflects production behaviour. `fadeMs` (kind=4) is
    expected to be hidden — it's an internal WASM metadata export,
    not something an operator should see.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)

        # Page 0
        f = await client.send(TYPE_QRY, "exports/p/0", want_ack=True)
        rep = await client.wait_for_reply(f.seq)
        assert rep.typ == TYPE_REP, rep.arg
        meta = _parse_paged_reply(rep.arg)
        assert meta["p"] == 0
        assert meta["t"] >= 1
        # Only kind∈{1,2,3,6} survive the engine's mixer filter. The
        # default fixture has two sliders (kind=1) and one fadeMs
        # (kind=4); only the sliders should show up.
        expected_n = sum(
            1 for e in fake_engine.state["exports"]
            if e["kind"] in fake_engine.state["local_control_kinds"]
            and e["name"] not in fake_engine.state["shared_export_names"]
            and e["id"] not in fake_engine.state["blocked_export_ids"]
        )
        assert meta["n"] == expected_n == 2
        # Each record: id~kind~v0~name. Make sure the slider showed up
        # with its v0 (read off /mixer directly in get_exports()).
        recs = [r.split("~") for r in meta["c"].split(",") if r]
        ids = {int(r[0]): r for r in recs}
        assert 100 in ids
        assert int(ids[100][1]) == 1   # kind=slider
        assert float(ids[100][2]) == 0.5  # initial v0
        assert ids[100][3] == "sliderSpeed"
        # Explicit confirmation that the metadata export was filtered
        # at the engine boundary (so PortWatch never even sees it).
        assert 102 not in ids

        # Write a new v0 via `cmd exp`
        f = await client.send(TYPE_CMD, "exp/100/0.81", want_ack=True,
                              role_priv=True)
        rep = await client.wait_for_reply(f.seq)
        assert rep.typ == TYPE_ACK
        # Engine reflects the write
        v0 = next(e.get("v0") for e in fake_engine.state["exports"]
                  if e["id"] == 100)
        assert abs(v0 - 0.81) < 1e-6

        # Re-query confirms the new v0 appears in the page
        f = await client.send(TYPE_QRY, "exports/p/0", want_ack=True)
        rep = await client.wait_for_reply(f.seq)
        meta2 = _parse_paged_reply(rep.arg)
        recs2 = [r.split("~") for r in meta2["c"].split(",") if r]
        ids2 = {int(r[0]): r for r in recs2}
        assert abs(float(ids2[100][2]) - 0.81) < 1e-3
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_local_exports_hide_cpc_shadowed(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """Exports the CPC has taken ownership of (e.g. ``sliderSpeed``
    when CPC owns ``speed``) must NOT appear in PortWatch's `qry
    exports/p/<n>` reply.

    CaptainPad already drops these in its deck card via the
    ``mixer`` broadcast filter; we want PortWatch to show exactly the
    same surface so the operator never sees a duplicate local
    slider for a knob the global ParamsCard already owns. Verifying
    this with both the name-based filter (`isSharedExport`) and the
    id-based filter (`getBlockedIds`) covers both paths the real
    engine uses.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)

        # 1. Baseline — both sliders show up (no CPC ownership yet).
        f = await client.send(TYPE_QRY, "exports/p/0", want_ack=True)
        rep = await client.wait_for_reply(f.seq)
        meta = _parse_paged_reply(rep.arg)
        ids = {
            int(r.split("~")[0]) for r in meta["c"].split(",") if r
        }
        assert ids == {100, 101}, ids

        # 2. CPC takes ownership of `sliderSpeed` (by name) — the
        # real engine sets this when a pattern declares
        # `export function sharedSpeed(v)` and the param registry
        # binds it to a slider's export name.
        fake_engine.state["shared_export_names"].add("sliderSpeed")
        f = await client.send(TYPE_QRY, "exports/p/0", want_ack=True)
        rep = await client.wait_for_reply(f.seq)
        meta = _parse_paged_reply(rep.arg)
        ids = {
            int(r.split("~")[0]) for r in meta["c"].split(",") if r
        }
        assert 100 not in ids, "sliderSpeed must be hidden when CPC owns it"
        assert 101 in ids, "unrelated sliders must still be visible"
        assert meta["n"] == 1

        # 3. Engine's getBlockedIds path — id-based blocklist. Same
        # operator outcome (the slider is hidden), but the engine
        # uses this when a control id is explicitly fenced rather
        # than inferred from a name.
        fake_engine.state["shared_export_names"].discard("sliderSpeed")
        fake_engine.state["blocked_export_ids"].add(100)
        f = await client.send(TYPE_QRY, "exports/p/0", want_ack=True)
        rep = await client.wait_for_reply(f.seq)
        meta = _parse_paged_reply(rep.arg)
        ids = {
            int(r.split("~")[0]) for r in meta["c"].split(",") if r
        }
        assert 100 not in ids, "blocked ids must be hidden too"
        assert meta["n"] == 1

        # 4. Lift both fences — every slider returns.
        fake_engine.state["blocked_export_ids"].discard(100)
        f = await client.send(TYPE_QRY, "exports/p/0", want_ack=True)
        rep = await client.wait_for_reply(f.seq)
        meta = _parse_paged_reply(rep.arg)
        ids = {
            int(r.split("~")[0]) for r in meta["c"].split(",") if r
        }
        assert ids == {100, 101}
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_playlists_query_switch_and_deck_state(acl_path: Path,
                                                     registry_path: Path,
                                                     fake_engine: FakeEngine):
    """`qry playlists/p/<n>` lists the library, `qry deck/playlist`
    returns the active deck assignment, and `cmd playlist/<name>`
    switches the engine to that playlist."""
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)

        # qry playlists/p/0 lists the library
        f = await client.send(TYPE_QRY, "playlists/p/0", want_ack=True)
        rep = await client.wait_for_reply(f.seq)
        assert rep.typ == TYPE_REP, rep.arg
        meta = _parse_paged_reply(rep.arg)
        names = meta["c"].split(",")
        assert names == fake_engine.state["playlists"]
        assert meta["n"] == len(names)

        # qry deck/playlist returns the live state
        f = await client.send(TYPE_QRY, "deck/playlist", want_ack=True)
        rep = await client.wait_for_reply(f.seq)
        assert rep.typ == TYPE_REP
        kv = dict(t.split("/", 1) for t in rep.arg.split(","))
        assert kv["pl"] == fake_engine.state["deck_playlist"]["name"]
        assert kv["en"] == fake_engine.state["deck_playlist"]["activeEntryId"]

        # cmd playlist/<name> switches
        f = await client.send(TYPE_CMD, "playlist/encore", want_ack=True,
                              role_priv=True)
        rep = await client.wait_for_reply(f.seq)
        assert rep.typ == TYPE_ACK, rep.arg
        assert fake_engine.state["deck_playlist"]["name"] == "encore"

        # Re-query confirms the switch
        f = await client.send(TYPE_QRY, "deck/playlist", want_ack=True)
        rep = await client.wait_for_reply(f.seq)
        kv = dict(t.split("/", 1) for t in rep.arg.split(","))
        assert kv["pl"] == "encore"
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_no_deck_playlist_returns_dash(acl_path: Path,
                                             registry_path: Path,
                                             fake_engine: FakeEngine):
    """When the engine has no deck playlist loaded the bridge MUST
    return `pl/-` (single dash), not an empty string. PortWatch parses
    `-` as null and an empty value as "not yet synced" — confusing
    those two on the wire would leave the picker permanently
    in a "loading…" state.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    # Wipe the deck assignment (simulates a fresh engine boot).
    fake_engine.state["deck_playlist"] = {"name": None, "activeEntryId": None}

    try:
        await _wait_until_ready(bus)
        f = await client.send(TYPE_QRY, "deck/playlist", want_ack=True)
        rep = await client.wait_for_reply(f.seq)
        assert rep.typ == TYPE_REP
        assert rep.arg == "pl/-", rep.arg
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


def _parse_compact_kv(arg: str) -> dict[str, str]:
    """Decode a compact-status PUB body. Returns string values; callers
    coerce as needed. Treats `lk/portwatch,lku/27,pl/default,...`
    consistently and tolerates extra fields the bridge may add later.
    """
    out: dict[str, str] = {}
    for tok in arg.split(","):
        if not tok:
            continue
        if "/" not in tok:
            continue
        k, _, v = tok.partition("/")
        out[k] = v
    return out


@pytest.mark.asyncio
async def test_compact_status_surfaces_lock_and_playlist(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """compact_status must publish the controlLock owner (`lk`), lease
    remaining seconds (`lku`), and active deck playlist (`pl`) so a
    newly-connected PortWatch can see what's live before it touches
    anything. These three fields make the "don't override an active
    show" contract enforceable at the UI layer.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        short_interval_s=0.4, long_interval_s=0.4,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)

        # Baseline: nobody holds the lock, default playlist is loaded.
        # The bridge omits `lk`/`lku`/`vov` entirely when the engine
        # reports no lock + no override (wire-size budget fix — see
        # test_compact_status_rep_fits_in_ble_mtu). PortWatch's parser
        # maps missing → null/0/false, so the operator-visible
        # behaviour is identical.
        f = await client.send(TYPE_QRY, "engine/status", want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        kv = _parse_compact_kv(reply.arg)
        assert "lk" not in kv, kv
        assert "lku" not in kv, kv
        assert "vov" not in kv, kv
        assert kv.get("pl") == "default", kv

        # Take the lock and re-query. Lease should be > 0 (FakeEngine
        # default is 30s) and owner should appear as the short wire
        # code `pw` (parseEngineStatus on PortWatch maps that back to
        # the canonical "portwatch" for UI comparisons).
        f = await client.send(TYPE_CMD, "view/deck", want_ack=True,
                              role_priv=True)
        await client.wait_for_reply(f.seq)
        f = await client.send(TYPE_QRY, "engine/status", want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        kv = _parse_compact_kv(reply.arg)
        assert kv.get("lk") == "pw", kv
        # The lease just started — should report > 0s remaining and
        # not more than the configured duration.
        rem = int(kv.get("lku", "0"))
        assert 1 <= rem <= 30, rem
        # vov bit and lk owner agree.
        assert kv.get("vov") == "1", kv

        # Switch deck playlist and confirm `pl/` follows immediately.
        f = await client.send(TYPE_CMD, "playlist/warmup", want_ack=True,
                              role_priv=True)
        await client.wait_for_reply(f.seq)
        f = await client.send(TYPE_QRY, "engine/status", want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        kv = _parse_compact_kv(reply.arg)
        assert kv.get("pl") == "warmup", kv
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_view_renew_is_idempotent_take(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """`cmd view/renew` is the silent renew path — same wire effect as
    `view/deck` (arms a fresh lease) but a distinct verb so logs make
    operator intent obvious. After a take + a few renews, the engine
    must still report a fresh lease (not a decayed one).
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    # Short lease for the test so we can verify renew actually extends.
    fake_engine.state["view_override_lease_duration_ms"] = 2_000
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        short_interval_s=0.4, long_interval_s=0.4,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)
        # Take
        f = await client.send(TYPE_CMD, "view/deck", want_ack=True,
                              role_priv=True)
        await client.wait_for_reply(f.seq)
        first_exp = fake_engine.state["view_override_lease_expires_at_ms"]
        assert first_exp is not None

        # Wait long enough that we'd visibly extend the lease but
        # NOT long enough to let it expire (1.0s of a 2.0s lease).
        await asyncio.sleep(1.0)
        f = await client.send(TYPE_CMD, "view/renew", want_ack=True,
                              role_priv=True)
        await client.wait_for_reply(f.seq)
        second_exp = fake_engine.state["view_override_lease_expires_at_ms"]
        assert second_exp is not None
        # New expiry must be strictly later than the original (we
        # restarted the timer with ~2s remaining).
        assert second_exp > first_exp, (first_exp, second_exp)
        # Owner stays portwatch the whole time.
        assert fake_engine.state["view_override"] == "deck"
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_lock_lease_auto_expires(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """If the holder stops renewing, the engine MUST auto-release the
    lock after the lease duration. This is the safety valve that
    prevents a crashed / out-of-range PortWatch from permanently
    locking CaptainPad out.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    # Sub-second lease so the test finishes quickly. The mechanism
    # under test is identical regardless of duration — production
    # uses 30_000 ms.
    fake_engine.state["view_override_lease_duration_ms"] = 600
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        short_interval_s=0.2, long_interval_s=0.2,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)
        # Take the lock.
        f = await client.send(TYPE_CMD, "view/deck", want_ack=True,
                              role_priv=True)
        await client.wait_for_reply(f.seq)
        assert fake_engine.state["view_override"] == "deck"

        # Don't renew. Wait past the lease duration. The
        # FakeEngine auto-rolls on the next view-override read; the
        # bridge's compact_status polls it every short_interval_s.
        await asyncio.sleep(0.8)

        # Force a read by querying engine/status — this hits
        # /mixer/view-override which triggers the expiry check.
        # Post wire-budget-fix, the unlocked state omits `lk`/`lku`/
        # `vov` from the wire entirely (PortWatch parses absence as
        # null/0/false). The auto-release is therefore observable as
        # those three keys NOT appearing in the post-expiry REP.
        f = await client.send(TYPE_QRY, "engine/status", want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        kv = _parse_compact_kv(reply.arg)
        assert "lk" not in kv, f"expected lock auto-released, got {kv}"
        assert "vov" not in kv, kv
        assert "lku" not in kv, kv
        # Engine-side state also rolled back.
        assert fake_engine.state["view_override"] is None
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_connect_time_hydration_in_mixer_mode(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """A freshly-connected PortWatch in mixer mode must be able to
    populate ALL of its deck-layer caches (playlist library, active
    deck playlist, playlist-scoped patterns) BEFORE it takes any
    write action. This is the wire half of the "no overriding active
    shows" contract — the UI shows MIXER MODE but every card is
    populated so the operator can preview what would happen if they
    took the override.

    Concretely we walk the same qry sequence App.tsx::onConnect +
    each card's useEffect runs, all while the engine is in its
    default mixer-view-no-lock state, and check that every reply
    carries usable data.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)
        # Sanity: engine starts in mixer view with no lock and the
        # default playlist loaded.
        assert fake_engine.state["view_override"] is None

        # 1. App.tsx hydration: HLO + engine/status. The compact
        # status MUST surface enough state for the UI to render the
        # "DECK ACTIVE" / "MIXER MODE" / "TAKE OVERRIDE" affordance
        # correctly without a guess. The view-mode key (`vw`) and
        # active playlist (`pl`) are unconditional. `lk`/`lku`/`vov`
        # are OMITTED from the wire when no lock is held (wire-size
        # budget fix); PortWatch's parser maps missing → null/0/false
        # so the UI still gates correctly off engineView alone.
        f = await client.send(TYPE_HLO, "", want_ack=True)
        await client.wait_for_reply(f.seq)
        f = await client.send(TYPE_QRY, "engine/status", want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        kv = _parse_compact_kv(reply.arg)
        assert kv.get("vw") == "mixer", kv
        assert "vov" not in kv, kv
        assert "lk" not in kv, kv
        assert kv.get("pl") == "default", kv

        # 2. PlaylistSwitcher hydration: list of playlists.
        f = await client.send(TYPE_QRY, "playlists/p/0", want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_REP
        # Reply shape: p/0,t/<n>,n/<n>,c/<csv>. Library is populated.
        assert "n/3" in reply.arg, reply.arg
        for name in ("default", "warmup", "encore"):
            assert name in reply.arg, (name, reply.arg)

        # 3. PlaylistSwitcher chains a deck/playlist fetch so the
        # LIVE chip highlights without waiting for the next PUB.
        f = await client.send(TYPE_QRY, "deck/playlist", want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_REP
        kv = dict(t.split("/", 1) for t in reply.arg.split(","))
        assert kv["pl"] == "default", kv

        # 4. DeckCard pattern hydration: patterns scoped to the
        # active deck playlist, NOT the full engine catalog. Even
        # though the engine is in mixer view, we still get the deck
        # playlist's patterns so the picker is populated.
        f = await client.send(TYPE_QRY, "engine/playlist-patterns/p/0",
                              want_ack=True)
        reply = await client.wait_for_reply(f.seq)
        assert reply.typ == TYPE_REP
        meta = _parse_playlist_paged_reply(reply.arg)
        assert meta["pl"] == "default"
        assert meta["n"] == 2
        assert "rainbow" in meta["c"] and "sunset" in meta["c"]
        # The default catalog also has `breathing` but that lives in
        # `warmup`, not `default` — playlist scope holds in mixer
        # mode too.
        assert "breathing" not in meta["c"]

        # 5. Engine view did NOT change as a side effect of any
        # query — we never wrote anything, so we should still be
        # in mixer mode with no lock.
        assert fake_engine.state["view_override"] is None
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_hlo_triggers_eager_pub(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """A `hlo` from a fresh client must wake the bridge's publisher so
    the new client gets a compact-status PUB within milliseconds
    instead of waiting up to long_interval_s for the next scheduled
    poll. This is half of the "PortWatch sees real state before
    touching anything" contract — the other half is the connect-time
    qrys PortWatch fires on its own.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    # Deliberately long interval. The eager PUB MUST land long before
    # this fires — otherwise the test would pass by accident on the
    # periodic timer.
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        short_interval_s=10.0, long_interval_s=10.0,
    )
    bridge_task = asyncio.create_task(bridge.run())

    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()

    try:
        await _wait_until_ready(bus)
        # First PUB at startup is also expected; drain the receive
        # buffer so the post-HLO PUB is unambiguously caused by HLO.
        await asyncio.sleep(0.5)
        client.received.clear()

        before = time.time()
        f = await client.send(TYPE_HLO, "", want_ack=True)
        await client.wait_for_reply(f.seq)

        # Eager PUB should arrive within ~1s; we give 3s of margin so
        # CI hosts don't flake on transient scheduler hiccups. Still
        # far below the 10s long_interval_s — passing here means the
        # HLO wake-up actually fired.
        got = await _wait_for(
            lambda: any(
                p.typ == TYPE_PUB and (p.dst == BROADCAST or p.dst == 0x0A)
                for p in client.received
            ),
            timeout=3.0,
        )
        assert got, "expected an eager PUB within 3s of HLO"
        elapsed = time.time() - before
        # Verify timing is consistent with HLO-triggered (not the 10s
        # periodic). 3s leaves a generous margin for slow CI.
        assert elapsed < 3.5, f"PUB took {elapsed:.2f}s — too slow"
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_eager_pub_carries_full_ready_gate_payload(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """Regression for "loaded PortWatch in mixer mode and it shows
    deck controls". The PortWatch ready-gate is driven by the
    following fields on every compact status PUB:

        vw   — current engine view ("deck" | "mixer")   (UNCONDITIONAL)
        pl   — active deck playlist name ("-" | "<name>") (UNCONDITIONAL)
        vov  — deck view-override active ("1")   (only when override held)
        lk   — controlLock owner ("<owner>")     (only when lock held)
        pat  — active pattern name               (UNCONDITIONAL)

    The bridge omits `vov`/`lk`/`lku` from the wire when their values
    would be the "nothing locked" defaults — that's the May 2026
    wire-size mitigation (without it, the encoded REP overshoots the
    Heltec firmware buffer and silently drops). PortWatch's parser
    maps missing → null/0/false so the operator-visible UI is
    identical to the explicit-zero shape.

    What this test pins, post-fix:
        * vw / pl / pat ALWAYS present on the eager PUB
        * lk / vov / lku NOT present when nothing is locked (the
          default state immediately after HLO)
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        short_interval_s=10.0, long_interval_s=10.0,
    )
    bridge_task = asyncio.create_task(bridge.run())
    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()
    try:
        await _wait_until_ready(bus)
        await asyncio.sleep(0.5)
        client.received.clear()
        f = await client.send(TYPE_HLO, "", want_ack=True)
        await client.wait_for_reply(f.seq)
        # Wait for the eager PUB. We deliberately did NOT send any
        # qrys yet — the PUB MUST land on its own carrying everything
        # we need. Predicate is sync (matches _wait_for's contract).
        def _has_full_pub() -> bool:
            for p in client.received:
                if p.typ != TYPE_PUB:
                    continue
                if p.dst not in (BROADCAST, 0x0A):
                    continue
                kv = _parse_compact_kv(p.arg or "")
                # vw + pl + pat are the unconditional fields PortWatch
                # needs for its ready gate. lk/vov are conditional and
                # are checked separately below (must be ABSENT when
                # nothing is locked).
                if all(k in kv for k in ("vw", "pl", "pat")):
                    return True
            return False
        got = await _wait_for(_has_full_pub, timeout=3.0)
        assert got, (
            "expected an eager PUB carrying vw/pl/pat within 3s of HLO. "
            f"got: {[p.arg for p in client.received if p.typ == TYPE_PUB]}"
        )
        # And confirm the values match the engine's actual state — we
        # didn't write anything, so it should be the default mixer-no-lock.
        winning = next(
            _parse_compact_kv(p.arg or "")
            for p in client.received
            if p.typ == TYPE_PUB
            and p.dst in (BROADCAST, 0x0A)
            and all(k in _parse_compact_kv(p.arg or "") for k in ("vw", "pl", "pat"))
        )
        assert winning["vw"] == "mixer", winning
        assert winning["pl"] == "default", winning
        # Nothing locked + no override → these keys are intentionally
        # absent from the wire to save bytes.
        assert "vov" not in winning, winning
        assert "lk" not in winning, winning
        assert "lku" not in winning, winning
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_pattern_change_via_mixer_propagates(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """Regression for the user-visible bug:
        "Captain Pad changes pattern → PortWatch never updates."

    Engine flow:
        CaptainPad POST /mixer/channels/<base>/playlist/entry
          → updates mixer.channels[base].pattern
          → does NOT touch opts.pattern (legacy)
          → broadcasts {type:'mixer', ...} WS event
        Bridge subscribes to `mixer` WS → wakes publisher → rebuilds
          compact_status, which (post-fix) reads `pat` from the mixer
          base channel rather than /status's activePattern.

    Before the fix `compact_status` used `/status.activePattern` and
    PortWatch's `engineStatus.activePattern` stayed pinned to the
    starting value forever even though the engine had moved on. This
    test mutates JUST the base-channel pattern (simulating the
    CaptainPad-only write path) and verifies a PUB lands with the new
    `pat`.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        # Short long-interval so we don't have to wait for a WS-driven
        # wake (the FakeEngine doesn't run a real WS server). The
        # publisher will tick on its own every 0.5s and rebuild from
        # the (updated) /mixer state.
        short_interval_s=0.5, long_interval_s=0.5,
    )
    bridge_task = asyncio.create_task(bridge.run())
    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()
    try:
        await _wait_until_ready(bus)
        await asyncio.sleep(0.3)
        client.received.clear()
        # Sanity: the very first PUB should carry the starting pattern.
        f = await client.send(TYPE_HLO, "", want_ack=True)
        await client.wait_for_reply(f.seq)
        def _pat_seen(name: str) -> bool:
            for p in client.received:
                if p.typ != TYPE_PUB:
                    continue
                if p.dst not in (BROADCAST, 0x0A):
                    continue
                if _parse_compact_kv(p.arg or "").get("pat") == name:
                    return True
            return False
        assert await _wait_for(lambda: _pat_seen("rainbow"), timeout=2.0)

        # ── Simulate CaptainPad-style mutation: bump the mixer base
        #    channel's pattern WITHOUT touching opts.pattern. (Real
        #    engine does this on POST /mixer/channels/:id/playlist/entry.)
        fake_engine.state["mixer_base_pattern"] = "sunset"
        # opts.pattern (state["pattern"]) is deliberately NOT updated
        # here — this is the bug reproduction.
        client.received.clear()

        # The publisher polls every 0.5s, so we should see the new
        # pattern within a couple of intervals.
        assert await _wait_for(lambda: _pat_seen("sunset"), timeout=3.0), (
            "expected a PUB with pat=sunset within 3s of mixer-base swap. "
            f"got: {[p.arg for p in client.received if p.typ == TYPE_PUB]}"
        )
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_polling_picks_up_pattern_and_playlist(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """End-to-end proof that the PortWatch `qry engine/status` polling
    path picks up CaptainPad-side mutations WITHOUT relying on PUB
    broadcasts at all.

    PUBs are deliberately starved here: the bridge's `long_interval_s`
    is 600 s and the WS subscriber is disabled in `_make_bridge`, so
    the publisher tick won't fire for the duration of the test.

    Sequence:
      1. Seed FakeEngine with starting pattern=`rainbow`,
         playlist=`warmup`.
      2. Simulated client polls `qry engine/status` (the same call
         PortWatch's `useStatusPoller` makes every 5 s).
      3. First REP carries the seeded values → store would render
         them as `engineStatus`.
      4. Mutate the FakeEngine: swap pattern to `sunset`, playlist to
         `encore`.
      5. Poll again. Verify the REP carries BOTH updated values
         in one shot.

    This is the test that proves the user's actual complaint
    ("CaptainPad changes vanish on PortWatch") is solved by polling
    regardless of broadcast reliability.

    (Historical: this test used to also assert `tch` propagation for
    the target-channel picker. That UX was removed May 2026 — the
    deck is now always bound to its base channel and channel
    selection happens via the active *playlist*.)
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    fake_engine.state["pattern"] = "rainbow"
    fake_engine.state["mixer_base_pattern"] = "rainbow"
    fake_engine.state["deck_playlist"] = {
        "name": "warmup", "activeEntryId": "e1",
    }
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        # Starve PUBs — we want to verify polling alone is sufficient.
        # 600 s means no periodic PUB during the ~3 s test window
        # (and the eager-on-HLO PUB is the only freebie).
        short_interval_s=600, long_interval_s=600,
    )
    bridge_task = asyncio.create_task(bridge.run())
    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()
    try:
        await _wait_until_ready(bus)
        await asyncio.sleep(0.3)
        # We don't HLO here — the goal is to prove polling works
        # WITHOUT relying on any PUB. (The eager PUB the bridge fires
        # on HLO ACK would otherwise short-circuit the test.) Skip
        # HLO; jump straight to polling.

        async def _poll_once() -> dict[str, str]:
            f = await client.send(TYPE_QRY, "engine/status", want_ack=True)
            rep = await client.wait_for_reply(f.seq, timeout=6.0)
            assert rep is not None, "no REP for qry engine/status"
            assert rep.typ == TYPE_REP, f"unexpected typ {rep.typ}"
            return _parse_compact_kv(rep.arg or "")

        kv1 = await _poll_once()
        assert kv1.get("pat") == "rainbow", kv1
        assert kv1.get("pl") == "warmup", kv1

        # ── Simulate CaptainPad-side mutations ──────────────────
        fake_engine.state["mixer_base_pattern"] = "sunset"
        fake_engine.state["deck_playlist"] = {
            "name": "encore", "activeEntryId": "e9",
        }

        # ── Second poll (simulating the next 5s tick) ──────────
        # Polling is the SOLE sync path here (no PUBs, no WS wakes).
        # If this works, the user's complaint is resolved end-to-end.
        kv2 = await _poll_once()
        assert kv2.get("pat") == "sunset", (
            "pattern change didn't reach the next poll's REP — "
            "polling-based sync is broken"
        )
        assert kv2.get("pl") == "encore", (
            "playlist change didn't reach the next poll's REP"
        )
        # Sanity: target-channel fields are GONE from the wire.
        assert "tch" not in kv2, kv2
        assert "nch" not in kv2, kv2
        assert "chs" not in kv2, kv2
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_playlist_patterns_query_returns_same_data_on_repeated_calls(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """End-to-end check that backs the per-playlist pattern cache on
    the PortWatch side: when nothing changed server-side, two
    consecutive `qry engine/playlist-patterns/p/0` calls return
    identical patterns.

    The PortWatch cache layer keys by `pl/<name>` and short-circuits
    the subsequent paged fetches entirely. This test doesn't exercise
    the TypeScript cache code itself (that's covered by the
    `patternsByPlaylist cache` vitest suite in
    `src/state/store.test.ts`), but it does prove the WIRE side is
    deterministic — without that property the cache would be unsafe.
    """
    fake_engine.state["deck_playlist"] = {
        "name": "warmup",
        "activeEntryId": "e1",
    }
    fake_engine.state["deck_playlist_entries"] = [
        {"id": "e1", "pattern": "rainbow"},
        {"id": "e2", "pattern": "sunset"},
        {"id": "e3", "pattern": "midnight"},
    ]
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        short_interval_s=600, long_interval_s=600,
    )
    bridge_task = asyncio.create_task(bridge.run())
    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()
    try:
        await _wait_until_ready(bus)
        await asyncio.sleep(0.3)

        async def _fetch() -> str:
            f = await client.send(
                TYPE_QRY, "engine/playlist-patterns/p/0", want_ack=True,
            )
            rep = await client.wait_for_reply(f.seq, timeout=6.0)
            assert rep is not None
            assert rep.typ == TYPE_REP
            return rep.arg or ""

        a = await _fetch()
        b = await _fetch()
        # Same playlist, same engine state → identical reply.
        # That's the foundation: the PortWatch cache can safely
        # serve the first reply on subsequent navigations to the
        # same playlist name without re-fetching.
        assert a == b, f"reply diverged between consecutive fetches:\n  a={a!r}\n  b={b!r}"

        # When the playlist NAME changes (mid-session swap), the wire
        # reply MUST change too — otherwise the cache would serve
        # stale data across a CaptainPad-driven playlist swap.
        fake_engine.state["deck_playlist"] = {
            "name": "encore",
            "activeEntryId": "e9",
        }
        fake_engine.state["deck_playlist_entries"] = [
            {"id": "e9", "pattern": "blastoff"},
        ]
        c = await _fetch()
        assert c != a, (
            "reply identical across playlist swap — that would silently "
            "stale the picker"
        )
        # Bonus: the reply for `encore` must mention `encore` so the
        # PortWatch parser sees the new name and re-keys the cache.
        assert "pl/encore" in c, c
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_polling_picks_up_global_params_changes(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """Proof of GlobalParams broadcast via the polling path.

    Mirrors `test_polling_picks_up_pattern_and_playlist_and_target_channel`
    but for the params side. `qry params` is what the bridge calls
    to assemble the snapshot frame; the same query is what
    `useGlobalParamsPoller` fires every 5 s on the device.

    With PUBs disabled, every step of the chain has to work:
      1. Mutate FakeEngine's `params` state (mirroring CaptainPad
         POSTing /param-center/speed, /param-center/colorPalette1,
         etc.).
      2. Simulate the device poll: `qry params`.
      3. Parse the REP and assert every scalar + palette field
         reflects the mutation.

    This is the test that would catch a regression in:
      * the bridge's `_exec_qry` "params" branch (encoding /
        rounding / missing field),
      * the engine_client `get_param_center()` shape,
      * the FakeEngine drift between dev / test stubs.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        short_interval_s=600, long_interval_s=600,
    )
    bridge_task = asyncio.create_task(bridge.run())
    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()
    try:
        await _wait_until_ready(bus)
        await asyncio.sleep(0.3)

        async def _poll_params() -> dict[str, str]:
            f = await client.send(TYPE_QRY, "params", want_ack=True)
            rep = await client.wait_for_reply(f.seq, timeout=6.0)
            assert rep is not None, "no REP for qry params"
            assert rep.typ == TYPE_REP, f"unexpected typ {rep.typ}"
            return _parse_compact_kv(rep.arg or "")

        # Baseline. FakeEngine ships with speed=0.5 by default.
        kv0 = await _poll_params()
        assert kv0.get("sp") is not None, kv0

        # ── Simulate a CaptainPad-side write to EVERY field ─────
        fake_engine.state["params"] = {
            "speed":         {"value": 0.42},
            "direction":     {"value": 1.0},
            "count":         {"value": 7.0},
            "size":          {"value": 0.31},
            "rotate":        {"value": 0.95},
            "colorPalette1": {"value": {"h": 0.11, "s": 0.22, "v": 0.33}},
            "colorPalette2": {"value": {"h": 0.44, "s": 0.55, "v": 0.66}},
        }

        # ── Next poll must surface ALL of them ──────────────────
        kv1 = await _poll_params()
        # The bridge rounds floats to 2 decimals (see _short_float).
        # Spot-check each field with the same rounding.
        assert kv1.get("sp") == "0.42", kv1
        assert kv1.get("dr") == "1", kv1
        assert kv1.get("ct") == "7", kv1
        assert kv1.get("sz") == "0.31", kv1
        assert kv1.get("rt") == "0.95", kv1
        # Palettes are `h-s-v` triples; verify exact form.
        assert kv1.get("p1") == "0.11-0.22-0.33", kv1
        assert kv1.get("p2") == "0.44-0.55-0.66", kv1
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_compact_status_does_not_leak_hash_fields(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """Negative regression for the May 2026 cache-strategy revert.

    Background. compact_status used to embed two CRC32 hashes for
    PortWatch's playlist caches:
        * `plh` — hash of the sorted playlist library names.
        * `pph` — hash of the active playlist's pattern names list.

    Both invariants forced an extra ``GET /playlists`` (and for `pph`
    an extra ``GET /playlists/<name>``) on every PUB, ballooning the
    bridge's per-tick HTTP fan-out from 5 to 8 serial requests. On a
    moderately busy engine this stalled the publisher loop for several
    seconds at a time, surfacing in the field as "PortWatch keeps
    saying *Waiting for engine state*" and "playlist patterns fail
    after 3 attempts".

    PortWatch's pattern + library caches are now plain name-keyed and
    persisted to AsyncStorage. Refresh is operator-driven (REFRESH
    button); the wire no longer carries a hash. This test guards
    against a future change that re-adds them without revisiting the
    publisher-cost trade-off.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    # Seed a playlist with entries so the (removed) hash codepath
    # would actually fire — leaving everything at empty defaults
    # would let a regression slip through because the legacy code
    # also emitted `plh/-,pph/-` in the empty case.
    fake_engine.state["deck_playlist"] = {
        "name": "warmup",
        "activeEntryId": "e1",
    }
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        short_interval_s=0.3, long_interval_s=0.3,
    )
    bridge_task = asyncio.create_task(bridge.run())
    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()
    try:
        await _wait_until_ready(bus)
        await asyncio.sleep(0.3)
        client.received.clear()
        f = await client.send(TYPE_HLO, "", want_ack=True)
        await client.wait_for_reply(f.seq)

        # Wait for a compact-status PUB (any body counts).
        assert await _wait_for(
            lambda: any(
                p.typ == TYPE_PUB and p.dst in (BROADCAST, 0x0A) and p.arg
                for p in client.received
            ),
            timeout=2.0,
        ), "no compact-status PUB observed"

        for p in client.received:
            if p.typ != TYPE_PUB or p.dst not in (BROADCAST, 0x0A):
                continue
            kv = _parse_compact_kv(p.arg or "")
            assert "plh" not in kv, (
                "compact_status leaked the removed `plh` field — the "
                "extra /playlists GET it required stalls the publisher "
                "loop on slow engines. Use the persisted name-keyed "
                f"cache instead. PUB: {kv}"
            )
            assert "pph" not in kv, (
                "compact_status leaked the removed `pph` field — the "
                "extra /playlists/<name> GET it required stalls the "
                "publisher loop on slow engines. Use the persisted "
                f"name-keyed cache instead. PUB: {kv}"
            )

        # Same guard on the polling path (qry engine/status REP),
        # since the REP body is generated by the same compact_status
        # codepath.
        f = await client.send(TYPE_QRY, "engine/status", want_ack=True)
        rep = await client.wait_for_reply(f.seq, timeout=6.0)
        assert rep is not None
        kv_rep = _parse_compact_kv(rep.arg or "")
        assert "plh" not in kv_rep, kv_rep
        assert "pph" not in kv_rep, kv_rep
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_playlist_change_via_mixer_propagates(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """Regression for the user-visible bug:
        "Captain Pad changes deck playlist → PortWatch never updates."

    Engine flow:
        CaptainPad POST /deck/playlist  (or /mixer/channels/<base>/playlist)
          → updates mixer.channels[base].playlist.name
          → broadcasts {type:'mixer', ...} WS event
        Bridge subscribes to `mixer` WS → wakes publisher → rebuilds
          compact_status, which reads `pl` from
          mixer.channels[baseChannelId].playlist.name.

    This test mutates the deck playlist on the FakeEngine and verifies
    a PUB lands carrying the new `pl` field. Sibling of
    test_pattern_change_via_mixer_propagates.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    # Seed initial deck playlist so the first PUB has a non-dash value
    # to compare against — without this the field would be "-" both
    # before and after, defeating the regression check.
    fake_engine.state["deck_playlist"] = {
        "name": "warmup",
        "activeEntryId": "e1",
    }
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        short_interval_s=0.5, long_interval_s=0.5,
    )
    bridge_task = asyncio.create_task(bridge.run())
    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()
    try:
        await _wait_until_ready(bus)
        await asyncio.sleep(0.3)
        client.received.clear()
        f = await client.send(TYPE_HLO, "", want_ack=True)
        await client.wait_for_reply(f.seq)

        def _pl_seen(name: str) -> bool:
            for p in client.received:
                if p.typ != TYPE_PUB:
                    continue
                if p.dst not in (BROADCAST, 0x0A):
                    continue
                if _parse_compact_kv(p.arg or "").get("pl") == name:
                    return True
            return False

        # Sanity: first PUB carries the seeded playlist.
        assert await _wait_for(lambda: _pl_seen("warmup"), timeout=2.0)

        # ── Simulate CaptainPad-style playlist swap. The real engine
        # path is POST /deck/playlist → loadPlaylistEntry which writes
        # channel.playlist.name; FakeEngine's /mixer derives that from
        # state["deck_playlist"], so flipping the state value here
        # exercises the same compact_status read-path PortWatch
        # depends on.
        fake_engine.state["deck_playlist"] = {
            "name": "encore",
            "activeEntryId": "e9",
        }
        client.received.clear()

        assert await _wait_for(lambda: _pl_seen("encore"), timeout=3.0), (
            "expected a PUB with pl=encore within 3s of mixer-base "
            "playlist swap. Got: "
            f"{[p.arg for p in client.received if p.typ == TYPE_PUB]}"
        )
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_compact_status_does_not_surface_target_channel(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """Negative regression: the `tch` / `nch` / `chs` fields that used
    to drive PortWatch's TARGET CHANNEL picker must NOT appear in any
    compact-status PUB.

    The target-channel UX was removed in May 2026 — the deck is now
    always bound to its base channel, and channel selection happens
    via the active *playlist* instead. See docs/16_captain_pad.md
    §"Target channel removal" and docs/21_portwatch_monitor.md
    §"Target-channel removal (2026-05)" for the rationale. Removing
    those fields shrinks the LoRa PUB payload — the bytes are reused
    for nothing today (we just want them gone).
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    # Pre-seed two extra fake mixer channels so any old code that
    # filtered by channel count would actually fire. None of this
    # data should reach the wire any more.
    fake_engine.state["channels"] = [
        {"id": "ch_a", "name": "MIXER ALPHA", "pattern": "rainbow", "exports": []},
        {"id": "ch_b", "name": "MIXER B", "pattern": "rainbow", "exports": []},
    ]
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        short_interval_s=0.5, long_interval_s=0.5,
    )
    bridge_task = asyncio.create_task(bridge.run())
    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()
    try:
        await _wait_until_ready(bus)
        await asyncio.sleep(0.3)
        client.received.clear()
        f = await client.send(TYPE_HLO, "", want_ack=True)
        await client.wait_for_reply(f.seq)

        # Wait for a compact-status PUB (any non-empty body counts).
        assert await _wait_for(
            lambda: any(
                p.typ == TYPE_PUB and p.dst in (BROADCAST, 0x0A) and p.arg
                for p in client.received
            ),
            timeout=2.0,
        ), "no compact-status PUB observed"

        # NONE of the seen PUBs may carry the removed target-channel
        # fields. Failing this means the bridge or engine_client
        # regressed and started shipping them again.
        for p in client.received:
            if p.typ != TYPE_PUB or p.dst not in (BROADCAST, 0x0A):
                continue
            kv = _parse_compact_kv(p.arg or "")
            assert "tch" not in kv, (
                "compact_status leaked the removed `tch` field: "
                f"{kv}"
            )
            assert "nch" not in kv, (
                "compact_status leaked the removed `nch` field: "
                f"{kv}"
            )
            assert "chs" not in kv, (
                "compact_status leaked the removed `chs` field: "
                f"{kv}"
            )
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_compact_status_always_emits_pat_marker(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """Wire-format invariant: every compact_status output must carry
    `pat/<value>`.

    Why this is an invariant
    ------------------------
    PortWatch's REP gate (App.tsx::onWireEvent) only feeds the parsed
    snapshot into setEngineStatus when the body contains `pat/`, `dn/`,
    `pl/`, or `vw/`. If a compact_status REP arrives with NONE of those
    markers, PortWatch silently drops it and the screen stays on
    "Waiting for engine state…" forever — even though the bridge IS
    talking and the qry-engine-status poller IS firing every 5 s.

    The May 2026 regression
    -----------------------
    The bridge had a branch that fell through without writing `pat`:

        if base_ch:                                # mixer has a base
            pat_name = base_ch.get("pattern")
            if isinstance(pat_name, str) and pat_name:
                out["pat"] = pat_name              # only this branch
                                                   # set the field
        else:
            out.setdefault("pat", "?")

    So a brief engine state where the base channel is loaded but holds
    no pattern (fresh boot, "unload all" right before the poll, etc.)
    produced compact_status output WITHOUT `pat/`. The poll REP slid
    past PortWatch's gate, setEngineStatus was never called, and the
    rig looked "dead" to operators in the field.

    This test pins the new invariant: `pat/` is always present,
    regardless of whether a pattern is actually loaded. The bridge
    emits `-` for the "base channel exists, no pattern" case and `?`
    for the "no base channel at all" case; parseEngineStatus on
    PortWatch maps both back to activePattern=null so the UI renders
    its existing em-dash placeholder.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    # Critical setup: the base channel exists on /mixer (it always
    # does — the engine bootstraps it on launch), but the pattern
    # field is None. This is the exact state the production regression
    # hit on a cold-booted rig before any pattern was loaded.
    fake_engine.state["mixer_base_pattern"] = None
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        short_interval_s=0.3, long_interval_s=0.3,
    )
    bridge_task = asyncio.create_task(bridge.run())
    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()
    try:
        await _wait_until_ready(bus)
        await asyncio.sleep(0.3)
        client.received.clear()
        f = await client.send(TYPE_HLO, "", want_ack=True)
        await client.wait_for_reply(f.seq)

        # Wait for at least one compact-status PUB.
        assert await _wait_for(
            lambda: any(
                p.typ == TYPE_PUB and p.dst in (BROADCAST, 0x0A) and p.arg
                for p in client.received
            ),
            timeout=2.0,
        ), "no compact-status PUB observed"

        # EVERY PUB body must carry `pat/`. The exact value is `-`
        # here (base channel found, no pattern loaded) per the bridge
        # contract; the gate just needs the marker to be present.
        pubs = [
            p for p in client.received
            if p.typ == TYPE_PUB and p.dst in (BROADCAST, 0x0A) and p.arg
        ]
        assert pubs, "no qualifying compact-status PUBs after HLO"
        for p in pubs:
            kv = _parse_compact_kv(p.arg or "")
            assert "pat" in kv, (
                "compact_status PUB missing the `pat/` marker — the "
                "REP gate on PortWatch (App.tsx::onWireEvent) needs "
                "this key to route status into setEngineStatus. "
                "Without it the screen sticks on 'Waiting for engine "
                f"state…'. PUB body: {p.arg!r}"
            )
            assert kv["pat"] == "-", (
                "expected the `base channel exists, no pattern loaded` "
                f"path to emit `pat/-`, got: pat/{kv['pat']!r}. "
                "If the bridge intentionally changed the sentinel "
                "string, update parseEngineStatus::patternNameOrNull "
                "on PortWatch too."
            )

        # Same invariant on the polling path (qry engine/status REP) —
        # that's the path the field regression actually hit. The REP
        # uses the same compact_status codepath, so this is a
        # belt-and-braces check.
        client.received.clear()
        f = await client.send(TYPE_QRY, "engine/status", want_ack=True)
        rep = await client.wait_for_reply(f.seq, timeout=6.0)
        assert rep is not None, "no REP for qry engine/status"
        kv_rep = _parse_compact_kv(rep.arg or "")
        assert "pat" in kv_rep, (
            "qry engine/status REP missing the `pat/` marker. "
            "PortWatch's REP gate will drop this and the screen will "
            f"stay on 'Waiting for engine state…'. REP body: {rep.arg!r}"
        )
        assert kv_rep["pat"] == "-", kv_rep
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_compact_status_rep_fits_in_ble_mtu(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """Wire-size invariant: a compact_status REP MUST fit inside the
    Heltec firmware buffer and the BLE MTU we request from the iPad.

    Why this is an invariant
    ------------------------
    The Heltec firmware (titanic_ble.h) caps each BLE notification at
    250 chars. PortWatch requests an MTU of 247 (.config.portwatch.
    yaml :: ble.request_mtu); iOS gives a 3-byte ATT header on top, so
    the practical payload is 244. If the bridge tries to ship a longer
    frame, the firmware silently drops it at the buffer and the iPad
    never receives the notification — surfacing in the field as
    "PortWatch stuck on 'Waiting for engine state'" even though every
    other diagnostic claims the bridge IS sending status.

    The exact regression that motivated this guard
    ----------------------------------------------
    The May 2026 compact_status redesign added all of `vov`, `lk`,
    `lku`, `vw`, `pl`, and the full CPC global params (`sp`, `dr`,
    `ct`, `sz`, `rt`, `p1`, `p2`) — landing the plaintext at 142
    chars with empty-default `lk/-,lku/0,vov/0` cruft. Wire-encoded
    with the v2 AES-GCM seal, that became 254 chars: 4 over the
    Heltec buffer, 7 over the BLE MTU. Every poll REP was being
    truncated on the firmware side. Mitigation: drop `lk`/`lku`/`vov`
    entirely when their values are the "no-lock / no-override"
    defaults (which is the common case 99% of the time). PortWatch's
    parser already maps "missing" → null/false for these fields, so
    the change is wire-compatible.

    What this test pins
    -------------------
    1. The unlocked compact_status REP is ≤ 240 chars wire-encoded
       (leaves 10 chars of margin for longer pattern names).
    2. The locked compact_status REP (lock taken by PortWatch) is
       ≤ 250 chars wire-encoded — must fit even when the operator
       has the deck override engaged.
    3. The wire format uses the short owner code `pw` instead of
       `portwatch` to stay under budget when locked.
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    # Use a representative-length pattern name. `00_golden_hour_wash`
    # (19 chars) is one of the longer real names in the live engine's
    # catalogue, so testing with it gives a realistic worst case.
    fake_engine.state["mixer_base_pattern"] = "00_golden_hour_wash"
    fake_engine.state["deck_playlist"] = {
        "name": "default", "activeEntryId": "e1",
    }
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        short_interval_s=0.3, long_interval_s=0.3,
    )
    bridge_task = asyncio.create_task(bridge.run())
    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()
    try:
        await _wait_until_ready(bus)
        await asyncio.sleep(0.3)
        client.received.clear()
        f = await client.send(TYPE_HLO, "", want_ack=True)
        await client.wait_for_reply(f.seq)

        # ── Unlocked case ───────────────────────────────────────────
        # The poller path is the one that hit the regression in the
        # field. Test it directly via qry engine/status, then measure
        # the encoded wire line (post-seal, post-base64).
        f = await client.send(TYPE_QRY, "engine/status", want_ack=True)
        rep_frame = await client.wait_for_reply(f.seq, timeout=6.0)
        assert rep_frame is not None

        kv = _parse_compact_kv(rep_frame.arg or "")
        # Default sentinels must NOT appear when nothing is locked —
        # that's the mitigation. If they reappear, the wire size
        # blows past 250 chars again.
        assert "lk" not in kv, (
            "compact_status leaked `lk/<value>` when no controlLock is "
            "held. That's the regression that blew past the Heltec "
            "firmware buffer in May 2026 and caused 'Waiting for "
            f"engine state…'. PUB body: {rep_frame.arg!r}"
        )
        assert "lku" not in kv, (
            "compact_status leaked `lku/<value>` when no controlLock "
            f"is held. Same regression as `lk` above. body: {rep_frame.arg!r}"
        )
        assert "vov" not in kv, (
            "compact_status leaked `vov/0` when no view override is "
            f"active. Same wire-size regression. body: {rep_frame.arg!r}"
        )

        # Re-encode the REP frame end-to-end to measure the on-wire
        # cost. The bridge's actual outbound encoding goes through
        # comms.secure.Codec — we mirror that here so we measure what
        # the firmware actually sees on its BLE characteristic.
        from comms.secure import Codec, load_secret
        from comms.frame import Frame, TYPE_REP, FLAG_ACK_REQUESTED
        secret_path = Path(__file__).resolve().parents[2] / "marsin_engine" / "secret.yaml"
        codec = Codec(key=load_secret(secret_path))
        wire = codec.encode(
            Frame(
                src=0x01, dst=0x0A, seq=0x02, typ=TYPE_REP,
                flags=FLAG_ACK_REQUESTED, arg=rep_frame.arg,
            ),
            ctr=0x123456,
        )
        wire_len = len(wire)
        assert wire_len <= 240, (
            f"unlocked compact_status REP wire-encodes to {wire_len} "
            "chars — exceeds the 240-char soft cap (= Heltec firmware "
            "buffer 250 minus 10-char margin for longer pattern names "
            "and timing jitter). The previous regression at 254 chars "
            "silently dropped every BLE notification on the iPad and "
            "stuck PortWatch on 'Waiting for engine state…'. Shrink "
            "the compact_status body (drop a default-value field, "
            "shorten a key, etc.) before increasing this cap."
        )

        # ── Locked case ─────────────────────────────────────────────
        # Simulate the operator engaging the deck override from
        # PortWatch. The bridge must still keep the wire frame under
        # 250 chars, even with `lk/pw,lku/<seconds>` present. The
        # short owner code `pw` (vs. the long `portwatch`) is the
        # mitigation that makes this fit.
        fake_engine.state["view_override"] = "deck"
        # Arm a lease so `lku` carries a real number.
        fake_engine.state["view_override_lease_duration_ms"] = 30_000
        import time as _t
        fake_engine.state["view_override_lease_expires_at_ms"] = int(
            _t.time() * 1000
        ) + 30_000

        client.received.clear()
        f = await client.send(TYPE_QRY, "engine/status", want_ack=True)
        rep_frame_locked = await client.wait_for_reply(f.seq, timeout=6.0)
        assert rep_frame_locked is not None

        kv_locked = _parse_compact_kv(rep_frame_locked.arg or "")
        assert kv_locked.get("lk") == "pw", (
            "expected the locked-state wire owner code `lk/pw` (short "
            "form of `portwatch`). If you intentionally changed the "
            "code, update parseEngineStatus::ownerOrNull on PortWatch "
            f"to match. Got: lk/{kv_locked.get('lk')!r}"
        )
        assert kv_locked.get("vov") == "1", (
            "expected vov/1 when the deck view override is active. "
            f"Got: {kv_locked.get('vov')!r}"
        )

        wire_locked = codec.encode(
            Frame(
                src=0x01, dst=0x0A, seq=0x03, typ=TYPE_REP,
                flags=FLAG_ACK_REQUESTED, arg=rep_frame_locked.arg,
            ),
            ctr=0x123457,
        )
        wire_locked_len = len(wire_locked)
        assert wire_locked_len <= 250, (
            f"locked compact_status REP wire-encodes to {wire_locked_len} "
            "chars — exceeds the 250-char Heltec firmware buffer. "
            "The operator engaging the deck lock would cause every "
            "subsequent status update to silently drop on BLE. "
            "Shorten the locked-state body (e.g. omit `vov` and "
            "imply it from `lk/<owner>` presence)."
        )
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


@pytest.mark.asyncio
async def test_compact_status_carries_full_cpc_globals(
    acl_path: Path, registry_path: Path, fake_engine: FakeEngine,
):
    """compact_status must publish ALL of the CPC's shared param
    surface — speed (`sp`), direction (`dr`), count (`ct`), size
    (`sz`), rotate (`rt`), colorPalette1 (`p1`), colorPalette2
    (`p2`) — so a CaptainPad-side nudge surfaces in PortWatch's
    GlobalParamsCard within one PUB cadence (~hundreds of ms) instead
    of the 5 s `qry params/snapshot` poll cadence.

    Verify:
        * Every short-key field is present and parseable.
        * A change to a CPC param on the engine appears in the next
          PUB (via the periodic publisher tick — sharedParams WS
          wake is exercised separately in `test_ws_subscriber_…`).
    """
    bus_port = _free_port()
    bus, bus_task = await _start_bus(bus_port)
    # Seed CPC scalars + both palette slots. _extract_param reads
    # `params_doc["params"][name]["value"]` so we wrap each entry.
    fake_engine.state["params"] = {
        "speed":     {"value": 0.5},
        "direction": {"value": 1},
        "count":     {"value": 8},
        "size":      {"value": 0.3},
        "rotate":    {"value": 0.7},
        "colorPalette1": {"value": {"h": 0.1, "s": 0.2, "v": 0.3}},
        "colorPalette2": {"value": {"h": 0.9, "s": 0.4, "v": 0.55}},
    }
    bridge = _make_bridge(
        bus_port=bus_port, acl_path=acl_path, registry_path=registry_path,
        fake_engine=fake_engine,
        short_interval_s=0.3, long_interval_s=0.3,
    )
    bridge_task = asyncio.create_task(bridge.run())
    client = _TestClient(RadioPortSim(port=bus_port, name="client-0a"),
                         node_id=0x0A)
    await client.start()
    try:
        await _wait_until_ready(bus)
        await asyncio.sleep(0.3)
        client.received.clear()
        f = await client.send(TYPE_HLO, "", want_ack=True)
        await client.wait_for_reply(f.seq)

        def _latest_pub_kv() -> dict[str, str] | None:
            latest: dict[str, str] | None = None
            for p in client.received:
                if p.typ != TYPE_PUB:
                    continue
                if p.dst not in (BROADCAST, 0x0A):
                    continue
                kv = _parse_compact_kv(p.arg or "")
                if "sp" in kv:
                    latest = kv
            return latest

        assert await _wait_for(
            lambda: _latest_pub_kv() is not None, timeout=2.0,
        ), "no compact-status PUB carrying CPC globals observed"
        kv = _latest_pub_kv()
        assert kv is not None
        # Scalars.
        assert kv.get("sp") == "0.5", kv
        assert kv.get("dr") == "1", kv
        assert kv.get("ct") == "8", kv
        assert kv.get("sz") == "0.3", kv
        assert kv.get("rt") == "0.7", kv
        # Palette slots: `<h>-<s>-<v>` with compact-float formatting
        # (trailing zeros stripped, dot stripped on integers).
        assert kv.get("p1") == "0.1-0.2-0.3", kv
        assert kv.get("p2") == "0.9-0.4-0.55", kv

        # ── Live propagation: mutate one CPC scalar on the engine
        # and verify a PUB with the new value lands. (We don't fire
        # a sharedParams WS event from FakeEngine — periodic poll
        # catches it within short_interval_s. The wake-on-event
        # path is exercised in test_ws_subscriber_wakes_on_shared_params.)
        fake_engine.state["params"]["count"] = {"value": 12}
        client.received.clear()
        deadline = asyncio.get_event_loop().time() + 3.0
        seen_new = False
        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(0.1)
            kv = _latest_pub_kv()
            if kv is not None and kv.get("ct") == "12":
                seen_new = True
                break
        assert seen_new, "CaptainPad-style CPC change didn't reach the wire"
    finally:
        await client.stop()
        await _cancel_and_drain(bridge_task, bus_task)


def test_ws_event_filter_includes_shared_params():
    """The bridge's WS-wake filter must include `sharedParams` so
    CaptainPad-side CPC nudges trigger an immediate compact-status
    republish instead of waiting for the next periodic tick. Without
    this, a Captain → PortWatch round-trip on e.g. `count` can take
    up to one full `long_interval_s` (15 s default).

    This is a pure-filter test — we don't spin up the bridge.
    """
    from comms.bridge import Bridge
    assert Bridge._is_relevant_ws_event(b'{"type":"sharedParams"}') is True
    assert Bridge._is_relevant_ws_event(b'{"type":"sharedParams","key":"speed"}') is True
    # Existing wake events still pass.
    assert Bridge._is_relevant_ws_event(b'{"type":"mixer"}') is True
    assert Bridge._is_relevant_ws_event(b'{"type":"pattern"}') is True
    assert Bridge._is_relevant_ws_event(b'{"type":"playlistLibrary"}') is True
    # Noisy vis traffic still filtered out.
    assert Bridge._is_relevant_ws_event(b'{"type":"vis"}') is False
    assert Bridge._is_relevant_ws_event(b'{"type":"stats"}') is False
    # Malformed inputs return False (don't crash).
    assert Bridge._is_relevant_ws_event(None) is False
    assert Bridge._is_relevant_ws_event(b"not json") is False
    assert Bridge._is_relevant_ws_event(b'{"no":"type"}') is False
