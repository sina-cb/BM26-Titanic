"""
mesh_demo.py — Hardware-free multi-client mesh exercise.

Spins up the entire LoRa stack hardware-free (sim_bus + bridge + clients
+ embedded fake engine OR a real MarsinEngine) and verifies the full
client ↔ bridge ↔ engine path. Lives next to the captain/bridge
companions so dev iteration mirrors the production wiring.

Layout:

    ┌──────────────────────────────────────────────┐
    │  MarsinEngine (real or fake)                  │
    └──────▲───────────────────────────────────────┘
           │ HTTP
           │
    ┌──────┴──────┐
    │  Bridge     │ (.config.*.yaml driven)
    └──────▲──────┘
           │ Titanic Frame v2 over sim_bus (AEAD)
           │
    ┌──────┴────────┬─────────────────┐
    │ operator      │ crew            │
    │ 0x0A captain  │ 0x10 crew       │
    └───────────────┴─────────────────┘

What it tests (in order):

  1. All clients connect, send hellos, get ACKs.
  2. ``cmd pattern/<a>`` from operator → engine pattern updates.
  3. Operator changes pattern again immediately → still ACK (no
     cooldown layer in the bridge — pacing is the UI's job).
  4. Crew tries ``cmd pattern/...`` → gets NAK acl_denied.
  5. Operator sets ``param/speed/0.85`` → engine reflects it.
  6. ``cmd fx/fire/...`` is HARD-rejected by the bridge denylist
     regardless of role (no remote fire path).
  7. Crew /pings captain (point-to-point ping over broadcast medium).
  8. Bridge publishes a ``pub`` frame; everyone receives it.
  9. ``qry engine/status`` reflects the current pattern.
 10. ``cmd brightness/55`` is accepted.

Exit code is 0 on success, non-zero on any failed assertion.

Usage:

    # All-in-process with a fake engine — fast, no external services.
    python -m companions.mesh_demo

    # Against a real MarsinEngine already running on localhost:6968.
    python -m companions.mesh_demo --engine-url http://127.0.0.1:6968

    # Quieter, ci-friendly output:
    python -m companions.mesh_demo -q
"""

from __future__ import annotations

import argparse
import asyncio
import http.server
import json
import logging
import socket
import sys
import threading
import time
from pathlib import Path

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
from comms.secure import SecretError, default_codec
from comms.sim_bus import SimBus

logger = logging.getLogger("titanic.mesh_demo")


# ── Console colors (kept minimal so ci logs stay readable) ────────────────
C = {
    "reset": "\033[0m", "g": "\033[92m", "r": "\033[91m", "y": "\033[93m",
    "c": "\033[96m", "m": "\033[95m", "b": "\033[1m", "d": "\033[2m",
}


# ── Embedded fake engine (only when --engine-url not given) ───────────────


class FakeEngine:
    """Tiny HTTP server that pretends to be MarsinEngine."""

    def __init__(self):
        self.state = {
            "pattern": "rainbow",
            "blackout": False,
            "autopilot": False,
            # Mirror the real engine's autopilot doc shape so the bridge's
            # `compact_status` can pick up `apd` (delay_s) and `aps`
            # (shuffle) and republish them over LoRa for PortWatch's
            # picker. Stored as int + bool here for ergonomic asserts;
            # `engine_client.compact_status` coerces both to wire form.
            "autopilot_delay_s": 30,
            "autopilot_shuffle": False,
            "params": {"speed": {"value": 0.5}},
            "master": 1.0,
            "channels": [],
            "fx": {},
            # Mirrors the real engine's /mixer/view-override surface. Only
            # 'deck' or None are accepted (the bridge sends one or the
            # other). Stored so the demo can read it back via the GET.
            "view_override": None,
        }
        self._port = self._pick_port()
        self._server: http.server.HTTPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self._port}"

    @staticmethod
    def _pick_port() -> int:
        s = socket.socket(); s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        return port

    def start(self) -> None:
        state = self.state

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a, **k):  # noqa: N802
                return

            def _send(self, code, body=None):
                payload = json.dumps(body if body is not None else {}).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_GET(self):  # noqa: N802
                if self.path == "/status":
                    return self._send(200, {"activePattern": state["pattern"]})
                if self.path in ("/list-patterns", "/patterns"):
                    return self._send(200, ["rainbow", "sunset", "breathing"])
                if self.path == "/param-center":
                    return self._send(200, {"params": state["params"]})
                if self.path == "/mixer":
                    return self._send(200, {"master": state["master"],
                                            "channels": state["channels"]})
                if self.path == "/globals":
                    return self._send(200, {"blackoutActive": state["blackout"]})
                if self.path == "/autopilot":
                    return self._send(200, {
                        "active": state["autopilot"],
                        # Real engine stores delay_s as a string; mirror
                        # that so bridge code paths exercise the same
                        # int(float(...)) coercion they hit in prod.
                        "delay_s": str(state["autopilot_delay_s"]),
                        "shuffle": state["autopilot_shuffle"],
                    })
                if self.path == "/mixer/view-override":
                    return self._send(200, {"override": state["view_override"]})
                self._send(404)

            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length", 0) or 0)
                body = self.rfile.read(length)
                try:
                    data = json.loads(body or b"{}")
                except json.JSONDecodeError:
                    return self._send(400, {"error": "bad json"})
                if self.path == "/set-pattern":
                    state["pattern"] = data.get("pattern", state["pattern"])
                    return self._send(200, {"status": "ok"})
                if self.path == "/param-center":
                    for k, v in data.items():
                        state["params"].setdefault(k, {})["value"] = v
                    return self._send(200, {"status": "ok"})
                if self.path == "/global-blackout":
                    state["blackout"] = bool(data.get("state"))
                    return self._send(200, {"status": "ok"})
                if self.path == "/autopilot":
                    if "active" in data:
                        state["autopilot"] = bool(data["active"])
                    if "delay_s" in data:
                        try:
                            state["autopilot_delay_s"] = int(data["delay_s"])
                        except (TypeError, ValueError):
                            return self._send(400, {"error": "bad delay_s"})
                    if "shuffle" in data:
                        state["autopilot_shuffle"] = bool(data["shuffle"])
                    return self._send(200, {"status": "ok"})
                if self.path == "/global-effect":
                    fx = data.get("effect", "?")
                    state["fx"][fx] = bool(data.get("state"))
                    return self._send(200, {"status": "ok"})
                if self.path == "/mixer/view-override":
                    requested = data.get("override")
                    if requested in (None, "", "clear"):
                        state["view_override"] = None
                    elif requested == "deck":
                        state["view_override"] = "deck"
                    else:
                        return self._send(400, {"error": "bad override"})
                    return self._send(200, {"override": state["view_override"]})
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


# ── Minimal demo client ───────────────────────────────────────────────────


class _DemoClient:
    """Tiny radio client that logs frames and supports send/wait_reply."""

    def __init__(self, name: str, node_id: int, port: int, *,
                 is_captain: bool, quiet: bool):
        self.name = name
        self.node_id = node_id
        self.is_captain = is_captain
        self.quiet = quiet
        self.radio = RadioPortSim(port=port, name=f"node-{node_id:02x}-{name}")
        self._seq = 0
        self._pending: dict[int, asyncio.Future] = {}
        self.received: list[Frame] = []
        self.pubs: list[Frame] = []
        self._inbound_pings: list[Frame] = []
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        await self.radio.open()
        self._task = asyncio.create_task(self._rx_loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
        await self.radio.close()

    async def _rx_loop(self) -> None:
        async for frame in self.radio.recv_frames():
            if frame.dst not in (self.node_id, BROADCAST):
                continue
            self.received.append(frame)
            if frame.typ == TYPE_PUB:
                self.pubs.append(frame)
                if not self.quiet:
                    print(f"  {C['m']}[{ts()}] {self.name:14s} PUB {frame.arg}{C['reset']}")
                continue
            if frame.typ in (TYPE_ACK, TYPE_NAK, TYPE_REP, TYPE_PONG):
                fut = self._pending.pop(frame.seq, None)
                if fut and not fut.done():
                    fut.set_result(frame)
                if not self.quiet:
                    col = C["g"] if frame.typ != TYPE_NAK else C["r"]
                    print(f"  {col}[{ts()}] {self.name:14s} <- {frame.typ} {frame.arg}{C['reset']}")
                continue
            if frame.typ == TYPE_PING and frame.dst == self.node_id:
                self._inbound_pings.append(frame)
                pong = Frame(
                    src=self.node_id, dst=frame.src, seq=frame.seq,
                    typ=TYPE_PONG, flags=0, arg="",
                )
                await self.radio.send(pong)

    async def send(self, typ: str, arg: str = "", *,
                   want_ack: bool = True, timeout: float = 4.0,
                   dst: int = SERVER_ID) -> Frame | None:
        self._seq = (self._seq + 1) & 0xFF
        flags = 0
        if want_ack:
            flags |= FLAG_ACK_REQUESTED
        if self.is_captain:
            flags |= FLAG_PRIVILEGED
        f = Frame(src=self.node_id, dst=dst, seq=self._seq, typ=typ,
                  flags=flags, arg=arg)
        if not self.quiet:
            print(f"  {C['c']}[{ts()}] {self.name:14s} -> {typ} {arg}{C['reset']}")
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        if want_ack:
            self._pending[self._seq] = fut
        await self.radio.send(f)
        if not want_ack:
            return None
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(self._seq, None)
            return None


def ts() -> str:
    return time.strftime("%H:%M:%S")


# ── Result accumulator ─────────────────────────────────────────────────────


class _Tally:
    def __init__(self):
        self.passed: list[str] = []
        self.failed: list[tuple[str, str]] = []

    def ok(self, name: str) -> None:
        self.passed.append(name)
        print(f"  {C['g']}OK {name}{C['reset']}")

    def fail(self, name: str, reason: str) -> None:
        self.failed.append((name, reason))
        print(f"  {C['r']}FAIL {name}: {reason}{C['reset']}")

    def assert_eq(self, name: str, got, want) -> None:
        if got == want:
            self.ok(name)
        else:
            self.fail(name, f"got {got!r}, want {want!r}")

    def assert_in(self, name: str, needle: str, haystack: str) -> None:
        if needle in haystack:
            self.ok(name)
        else:
            self.fail(name, f"{needle!r} not in {haystack!r}")


# ── Demo body ─────────────────────────────────────────────────────────────


async def _wait_for(predicate, timeout: float = 3.0, step: float = 0.05):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        await asyncio.sleep(step)
    return False


async def _start_sim_bus(port: int) -> tuple[SimBus, asyncio.Task]:
    bus = SimBus(host="127.0.0.1", port=port)
    task = asyncio.create_task(bus.serve())
    for _ in range(50):
        try:
            s = socket.create_connection(("127.0.0.1", port), timeout=0.2)
            s.close()
            break
        except OSError:
            await asyncio.sleep(0.05)
    return bus, task


async def _run(args) -> int:
    tally = _Tally()

    # Fail FAST if the shared secret is missing — sim_bus carries v2
    # AEAD frames just like the real radio does.
    try:
        default_codec()
    except SecretError as exc:
        print(f"  {C['r']}{exc}{C['reset']}", file=sys.stderr)
        return 2

    s = socket.socket(); s.bind(("127.0.0.1", 0))
    bus_port = s.getsockname()[1]
    s.close()

    fake_engine = None
    if args.engine_url:
        engine_url = args.engine_url
        print(f"\n  using real engine at {engine_url}")
    else:
        fake_engine = FakeEngine()
        fake_engine.start()
        engine_url = fake_engine.base_url
        print(f"\n  spawned fake engine on {engine_url}")

    patterns = await _list_patterns(engine_url)
    if len(patterns) >= 2:
        pat_a, pat_b = patterns[0], patterns[1]
    else:
        pat_a, pat_b = "sunset", "rainbow"
    print(f"  patterns picked: {pat_a!r} and {pat_b!r}")

    bus, bus_task = await _start_sim_bus(bus_port)
    print(f"  sim_bus on port {bus_port}")

    acl = AclTable.load(BASE / ".config.nodes.yaml")
    registry = CommandRegistry.load(BASE / ".config.commands.yaml")

    bridge = Bridge(
        radio=RadioPortSim(port=bus_port, name="bridge"),
        engine=EngineClient(base_url=engine_url, timeout_s=2.0),
        acl=acl, registry=registry,
        short_interval_s=2.0,
        long_interval_s=10.0,
        idle_threshold_s=30.0,
    )
    bridge_task = asyncio.create_task(bridge.run())
    print(f"  bridge started (engine={engine_url})")

    operator = _DemoClient("operator", 0x0A, bus_port, is_captain=True,
                           quiet=args.quiet)
    crew = _DemoClient("crew_01", 0x10, bus_port, is_captain=False,
                       quiet=args.quiet)
    await operator.start()
    await crew.start()
    print(f"  2 clients on the mesh: operator (captain), crew_01")

    try:
        await _wait_for(lambda: len(bus._clients) >= 3, timeout=4.0)  # noqa: SLF001
        await asyncio.sleep(0.2)

        # 1. Hellos
        print(f"\n  {C['b']}-- 1. hellos --{C['reset']}")
        for c in (operator, crew):
            r = await c.send(TYPE_HLO, f"name/{c.name}")
            tally.assert_eq(f"hello {c.name} ack", r and r.typ, TYPE_ACK)

        # 2. Pings
        print(f"\n  {C['b']}-- 2. pings --{C['reset']}")
        for c in (operator, crew):
            r = await c.send(TYPE_PING)
            tally.assert_eq(f"ping {c.name}", r and r.typ, TYPE_PONG)

        # 3. Operator changes pattern → engine state must update
        print(f"\n  {C['b']}-- 3. operator changes pattern --{C['reset']}")
        r = await operator.send(TYPE_CMD, f"pattern/{pat_a}")
        tally.assert_eq(f"operator pattern/{pat_a} ack",
                        r and r.typ, TYPE_ACK)
        await asyncio.sleep(0.3)
        pat = await _read_engine_pattern(engine_url)
        tally.assert_eq(f"engine state.activePattern == {pat_a}", pat, pat_a)

        # 4. Operator can fire commands back-to-back (no bridge cooldown)
        print(f"\n  {C['b']}-- 4. no cooldown layer in bridge --{C['reset']}")
        r = await operator.send(TYPE_CMD, f"pattern/{pat_b}")
        tally.assert_eq("immediate second cmd ack", r and r.typ, TYPE_ACK)
        await asyncio.sleep(0.3)
        pat2 = await _read_engine_pattern(engine_url)
        tally.assert_eq(f"engine pattern == {pat_b}", pat2, pat_b)

        # 5. Crew tries cmd → acl_denied
        print(f"\n  {C['b']}-- 5. crew tries cmd → acl_denied --{C['reset']}")
        r = await crew.send(TYPE_CMD, f"pattern/{pat_a}")
        tally.assert_eq("crew cmd type", r and r.typ, TYPE_NAK)
        tally.assert_in("crew cmd reason", "acl_denied",
                        (r or Frame(0, 0, 0, TYPE_NAK)).arg)

        # 6. fx/fire denylist (defense-in-depth)
        print(f"\n  {C['b']}-- 6. fx/fire denylisted at bridge --{C['reset']}")
        r = await operator.send(TYPE_CMD, "fx/fire/1")
        tally.assert_eq("fx/fire type", r and r.typ, TYPE_NAK)
        tally.assert_in("fx/fire reason", "fx_fire_blocked",
                        (r or Frame(0, 0, 0, TYPE_NAK)).arg)

        # 7. param command sets CPC speed
        print(f"\n  {C['b']}-- 7. operator sets CPC speed --{C['reset']}")
        r = await operator.send(TYPE_CMD, "param/speed/0.85")
        tally.assert_eq("operator param speed ack", r and r.typ, TYPE_ACK)
        await asyncio.sleep(0.1)
        sp = await _read_engine_speed(engine_url)
        if sp is None:
            tally.fail("engine speed param", "could not fetch")
        else:
            ok = abs(sp - 0.85) < 1e-6
            (tally.ok if ok else lambda n: tally.fail(n, f"speed={sp}"))(
                "engine speed == 0.85"
            )

        # 8. Crew pings captain (point-to-point over broadcast bus)
        print(f"\n  {C['b']}-- 8. crew pings captain --{C['reset']}")
        r = await crew.send(TYPE_PING, "", dst=operator.node_id)
        tally.assert_eq("crew->captain ping", r and r.typ, TYPE_PONG)
        tally.assert_eq("captain saw inbound ping",
                        len(operator._inbound_pings) >= 1, True)

        # 9. Periodic pub broadcast
        print(f"\n  {C['b']}-- 9. pub broadcasts reach all clients --{C['reset']}")
        await asyncio.sleep(2.5)
        tally.assert_eq("operator received pub", len(operator.pubs) >= 1, True)
        tally.assert_eq("crew received pub",     len(crew.pubs) >= 1, True)

        # 10. Engine status reflects current state via qry
        print(f"\n  {C['b']}-- 10. engine status query --{C['reset']}")
        r = await crew.send(TYPE_QRY, "engine/status")
        tally.assert_eq("engine/status reply type", r and r.typ, TYPE_REP)
        if r is not None:
            tally.assert_in("engine/status contains pat",
                            f"pat/{pat_b}", r.arg)

        # 11. brightness command
        print(f"\n  {C['b']}-- 11. brightness cmd works --{C['reset']}")
        r = await operator.send(TYPE_CMD, "brightness/55")
        tally.assert_eq("brightness ack", r and r.typ, TYPE_ACK)

        # 12. Paged pattern fetch — every page reachable + total reached.
        # PortWatch drives this loop in DeckScreen.refreshPatterns(); we
        # mirror that here against the live bridge to catch regressions in
        # _paginate_patterns + the registry path-walk together.
        print(f"\n  {C['b']}-- 12. paged engine/patterns query --{C['reset']}")
        all_pages: list[str] = []
        total_pages_seen: int | None = None
        n_total: int | None = None
        for page in range(20):
            r = await crew.send(TYPE_QRY, f"engine/patterns/p/{page}")
            if r is None or r.typ != TYPE_REP:
                tally.fail(
                    f"patterns page {page} reply",
                    f"got typ={r and r.typ}, arg={r and r.arg!r}",
                )
                break
            # Defensive parse: header is "p/<idx>,t/<total>,n/<count>,c/<csv>"
            try:
                header, csv = r.arg.split(",c/", 1)
            except ValueError:
                tally.fail(f"patterns page {page} shape",
                           f"missing ',c/' in {r.arg!r}")
                break
            kv: dict[str, str] = {}
            for piece in header.split(","):
                if "/" in piece:
                    k, v = piece.split("/", 1)
                    kv[k] = v
            try:
                page_idx = int(kv.get("p", ""))
                page_total = int(kv.get("t", ""))
                count_n = int(kv.get("n", ""))
            except ValueError:
                tally.fail(f"patterns page {page} header",
                           f"non-numeric in {header!r}")
                break
            if total_pages_seen is None:
                total_pages_seen = page_total
                n_total = count_n
            all_pages.extend([s for s in csv.split(",") if s])
            if page_idx + 1 >= page_total:
                break
        # Collected exactly the engine's pattern count, no truncation.
        tally.assert_eq("paged total >= 1",
                        bool(total_pages_seen and total_pages_seen >= 1),
                        True)
        tally.assert_eq(
            "paged collected matches engine count",
            len(all_pages),
            len(patterns),
        )

        # 13. view-override end-to-end: cmd view/deck → engine reflects
        # override='deck'; cmd view/clear → override is None again.
        print(f"\n  {C['b']}-- 13. view-override (cmd view/deck|clear) --{C['reset']}")
        r = await operator.send(TYPE_CMD, "view/deck")
        tally.assert_eq("view/deck ack", r and r.typ, TYPE_ACK)
        await asyncio.sleep(0.2)
        ov = await _read_engine_view_override(engine_url)
        tally.assert_eq("engine view-override == deck",
                        ov.get("override") if ov else None, "deck")
        r = await operator.send(TYPE_CMD, "view/clear")
        tally.assert_eq("view/clear ack", r and r.typ, TYPE_ACK)
        await asyncio.sleep(0.2)
        ov2 = await _read_engine_view_override(engine_url)
        tally.assert_eq("engine view-override == None",
                        ov2.get("override") if ov2 else "missing", None)

        # 14. Autopilot interval (delay_s) round-trips through the new
        # `cmd autopilot/interval/<sec>` path and the engine echoes it
        # back in compact_status (`apd/<sec>`). This is the wire path
        # that PortWatch's DeckScreen now uses; before this change it
        # was sending `param/autopilotInterval/<n>` to /param-center,
        # which the engine silently dropped.
        print(f"\n  {C['b']}-- 14. autopilot interval cmd --{C['reset']}")
        r = await operator.send(TYPE_CMD, "autopilot/interval/45")
        tally.assert_eq("autopilot/interval/45 ack",
                        r and r.typ, TYPE_ACK)
        await asyncio.sleep(0.2)
        ap_delay = await _read_engine_autopilot_delay(engine_url)
        tally.assert_eq("engine autopilot.delay_s == 45", ap_delay, 45)

        # 15. Autopilot shuffle round-trips through `cmd autopilot/shuffle/1`.
        print(f"\n  {C['b']}-- 15. autopilot shuffle cmd --{C['reset']}")
        r = await operator.send(TYPE_CMD, "autopilot/shuffle/1")
        tally.assert_eq("autopilot/shuffle/1 ack", r and r.typ, TYPE_ACK)
        await asyncio.sleep(0.2)
        ap_shuf = await _read_engine_autopilot_shuffle(engine_url)
        tally.assert_eq("engine autopilot.shuffle == True",
                        ap_shuf, True)

        # 16. Compact status carries the new `apd` (delay) and `aps`
        # (shuffle) fields PortWatch's parser now expects.
        print(f"\n  {C['b']}-- 16. compact status carries apd/aps --{C['reset']}")
        r = await crew.send(TYPE_QRY, "engine/status")
        tally.assert_eq("engine/status reply type", r and r.typ, TYPE_REP)
        if r is not None:
            tally.assert_in("engine/status contains apd/45",
                            "apd/45", r.arg)
            tally.assert_in("engine/status contains aps/1",
                            "aps/1", r.arg)

    finally:
        await operator.stop()
        await crew.stop()
        bridge_task.cancel()
        try:
            await bridge_task
        except (asyncio.CancelledError, Exception):
            pass
        bus_task.cancel()
        try:
            await bus_task
        except (asyncio.CancelledError, Exception):
            pass
        if fake_engine is not None:
            fake_engine.stop()

    # Summary
    print()
    print(f"  {C['b']}-- summary --{C['reset']}")
    print(f"  passed: {len(tally.passed)}")
    print(f"  failed: {len(tally.failed)}")
    print(f"  bridge stats: {bridge.stats}")
    if tally.failed:
        for name, reason in tally.failed:
            print(f"    {C['r']}{name}: {reason}{C['reset']}")
        return 1
    print(f"  {C['g']}ALL CHECKS PASSED{C['reset']}")
    return 0


async def _read_engine_pattern(engine_url: str) -> str | None:
    import urllib.request
    try:
        with urllib.request.urlopen(f"{engine_url}/status", timeout=2.0) as resp:
            data = json.loads(resp.read() or b"{}")
        return data.get("activePattern")
    except Exception:  # pragma: no cover
        return None


async def _read_engine_speed(engine_url: str) -> float | None:
    import urllib.request
    try:
        with urllib.request.urlopen(f"{engine_url}/param-center", timeout=2.0) as resp:
            data = json.loads(resp.read() or b"{}")
        speed = data.get("params", {}).get("speed", {})
        v = speed.get("value") if isinstance(speed, dict) else speed
        return float(v) if v is not None else None
    except Exception:  # pragma: no cover
        return None


async def _list_patterns(engine_url: str) -> list[str]:
    """Return available pattern names. Empty list on any failure."""
    import urllib.request
    for path in ("/list-patterns", "/patterns"):
        try:
            with urllib.request.urlopen(f"{engine_url}{path}", timeout=2.0) as resp:
                data = json.loads(resp.read() or b"[]")
            if isinstance(data, list):
                return [str(p) for p in data]
        except Exception:
            continue
    return []


async def _read_engine_view_override(engine_url: str) -> dict | None:
    """Read /mixer/view-override; None on failure (FakeEngine has no impl)."""
    import urllib.request
    try:
        with urllib.request.urlopen(
            f"{engine_url}/mixer/view-override", timeout=2.0,
        ) as resp:
            data = json.loads(resp.read() or b"{}")
        return data if isinstance(data, dict) else None
    except Exception:  # pragma: no cover
        return None


async def _read_engine_autopilot_delay(engine_url: str) -> int | None:
    """Read /autopilot.delay_s as int. None on failure or missing field.

    The real engine stores it as a string ("30") because the YAML config
    is hand-edited by humans; we coerce here so test asserts can compare
    numerically without juggling types.
    """
    import urllib.request
    try:
        with urllib.request.urlopen(
            f"{engine_url}/autopilot", timeout=2.0,
        ) as resp:
            data = json.loads(resp.read() or b"{}")
        v = data.get("delay_s") if isinstance(data, dict) else None
        return int(float(v)) if v is not None else None
    except Exception:  # pragma: no cover
        return None


async def _read_engine_autopilot_shuffle(engine_url: str) -> bool | None:
    import urllib.request
    try:
        with urllib.request.urlopen(
            f"{engine_url}/autopilot", timeout=2.0,
        ) as resp:
            data = json.loads(resp.read() or b"{}")
        v = data.get("shuffle") if isinstance(data, dict) else None
        return bool(v) if v is not None else None
    except Exception:  # pragma: no cover
        return None


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Titanic LoRa mesh demo (sim)")
    p.add_argument("--engine-url", help="real MarsinEngine URL "
                   "(default: embedded fake)")
    p.add_argument("-q", "--quiet", action="store_true",
                   help="suppress per-frame traffic logs")
    return p


def main() -> int:
    args = _build_parser().parse_args()
    logging.basicConfig(level=logging.WARNING,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    try:
        return asyncio.run(_run(args))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
