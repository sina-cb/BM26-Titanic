"""
hil_secured_demo.py — End-to-end HIL proof of the v2 secured channel.

Runs entirely on the laptop with both Heltec V4s plugged in:

    [captain serial]  ─USB→  Heltec 0x0A  ─LoRa→  Heltec 0x01  ─USB→  [bridge]
                                                                        │
                                                                        └→  HTTP → MarsinEngine on the LAN

What we verify (every step on the actual hardware, with the AEAD codec on):

  1. Both boards are paired in .config.nodes.yaml and connected.
  2. The bridge picks the right engine via EngineClient.discover()
     (LAN first, localhost fallback).
  3. The captain sends a `pin` and the bridge replies `pon` over the
     real radio link, decoded under the same shared key.
  4. The captain sends a `qry engine/status` and gets back a `rep`
     containing the engine's currently-active pattern — proving the
     bridge talked to the LAN engine through the secured radio path.
  5. The captain sends a `cmd brightness/<v>` and we then re-query the
     engine over the same channel to confirm the value actually changed.
     (We restore the original brightness afterwards so the test is
     side-effect-neutral.)

NOT a pytest test (yet) because it needs both ports + LAN engine and we
don't want to wedge `pytest -q` waiting on hardware. It's runnable as:

    cd control_podium
    PYTHONPATH=. ../.venv-dev/bin/python -m companions.hil_secured_demo

Exit code mirrors mesh_demo: 0 = green, 1 = anything red.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time
from pathlib import Path

import yaml

BASE = Path(__file__).resolve().parent.parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from comms.acl import AclTable
from comms.bridge import Bridge
from comms.engine_client import EngineClient, EngineUnavailable
from comms.frame import (
    BROADCAST,
    FLAG_ACK_REQUESTED,
    Frame,
    SERVER_ID,
    TYPE_ACK,
    TYPE_CMD,
    TYPE_HLO,
    TYPE_PING,
    TYPE_PONG,
    TYPE_QRY,
    TYPE_REP,
    decode_kv,
)
from comms.radio_port_serial import RadioPortSerial
from comms.registry import CommandRegistry
from utils import discovery

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s.%(msecs)03d %(name)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("titanic.hil")

# ── Pretty-print helpers ──────────────────────────────────────────────
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def _ok(label: str) -> None:
    print(f"  {GREEN}✓{RESET} {label}")


def _fail(label: str, detail: str = "") -> None:
    print(f"  {RED}✗{RESET} {label}{(' — ' + detail) if detail else ''}")


def _info(label: str) -> None:
    print(f"  {DIM}· {label}{RESET}")


def _section(title: str) -> None:
    print(f"\n  {BOLD}── {title} ──{RESET}")


# ── Hardware resolution ───────────────────────────────────────────────
def _resolve_ports() -> tuple[str, str]:
    """Return (server_port, captain_port) by MAC lookup against the YAML.

    Server is node 0x01 (role=server). Captain is the first node with
    role=captain that has a `usb_mac` set and is currently plugged in.
    """
    nodes_yaml = yaml.safe_load((BASE / ".config.nodes.yaml").read_text()) or {}
    nodes = nodes_yaml.get("nodes") or {}
    server_node = nodes.get(0x01)
    if not server_node or not server_node.get("usb_mac"):
        sys.exit("server (0x01) has no usb_mac in .config.nodes.yaml — run deploy.py --pair --node 0x01")
    server_port = discovery.find_port_by_mac(server_node["usb_mac"])
    if not server_port:
        sys.exit(f"server board (MAC {server_node['usb_mac']}) not connected")

    captain_id = None
    captain_port = None
    for nid, n in nodes.items():
        if not isinstance(n, dict):
            continue
        if n.get("role") != "captain" or not n.get("usb_mac"):
            continue
        port = discovery.find_port_by_mac(n["usb_mac"])
        if port:
            captain_id = nid
            captain_port = port
            captain_name = n.get("name", "?")
            break
    if not captain_port:
        sys.exit("no captain board with usb_mac is connected — run deploy.py --node 0x0A")
    print(
        f"  {BOLD}server{RESET}  : node 0x01 → {server_port} (MAC {server_node['usb_mac']})\n"
        f"  {BOLD}captain{RESET} : node 0x{captain_id:02X} ({captain_name}) → {captain_port} (MAC {nodes[captain_id]['usb_mac']})"
    )
    return server_port, captain_port, captain_id


# ── Tiny captain client (just enough for the demo) ────────────────────
class CaptainClient:
    """Minimal client: sends a frame, awaits a frame matching a predicate.

    Mirrors the shape of ``companions/client_companion.py`` but with a
    single in-process inbox that's easier to drive from a script.
    """

    def __init__(self, port: RadioPortSerial, node_id: int):
        self.port = port
        self.node_id = node_id
        self._seq = 0
        self._inbox: asyncio.Queue[Frame] = asyncio.Queue()
        self._task: asyncio.Task | None = None

    async def __aenter__(self):
        await self.port.open()
        self._task = asyncio.create_task(self._rx_loop())
        return self

    async def __aexit__(self, *exc):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
        await self.port.close()

    async def _rx_loop(self):
        async for frame in self.port.recv_frames():
            await self._inbox.put(frame)

    def _next_seq(self) -> int:
        self._seq = (self._seq + 1) & 0xFF
        return self._seq

    async def send(self, typ: str, dst: int, arg: str = "",
                   *, want_ack: bool = True) -> int:
        seq = self._next_seq()
        flags = FLAG_ACK_REQUESTED if want_ack else 0
        f = Frame(src=self.node_id, dst=dst, seq=seq, typ=typ,
                  flags=flags, arg=arg)
        await self.port.send(f)
        return seq

    async def wait_for(self, predicate, *, timeout_s: float = 5.0) -> Frame | None:
        """Wait for the first inbound frame matching predicate(frame)."""
        deadline = asyncio.get_running_loop().time() + timeout_s
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                return None
            try:
                f = await asyncio.wait_for(self._inbox.get(), timeout=remaining)
            except asyncio.TimeoutError:
                return None
            if predicate(f):
                return f


# ── The demo itself ───────────────────────────────────────────────────
async def main(args) -> int:
    print(f"\n  {BOLD}🛰  HIL secured-channel demo{RESET}\n")

    server_port_path, captain_port_path, captain_id = _resolve_ports()

    # Engine discovery (LAN first, localhost fallback).
    bridge_cfg = yaml.safe_load(
        (BASE / ".config.bridge.yaml").read_text()
    ) or {}
    eng_cfg = bridge_cfg.get("engine", {})
    primary = args.engine or eng_cfg.get("url", "http://127.0.0.1:6968")
    fallback = list(eng_cfg.get("fallback_urls") or [])
    try:
        engine = await EngineClient.discover([primary, *fallback])
    except EngineUnavailable as exc:
        _fail("engine discovery", str(exc))
        return 1
    _ok(f"engine discovered: {engine.base_url}")

    # Capture original brightness so we can restore it afterwards.
    original_master = None
    try:
        mx = await engine.get_mixer()
        original_master = (mx or {}).get("master")
    except EngineUnavailable:
        pass

    # Wire up the bridge against the server radio port. Default codec auto-loads.
    server_radio = RadioPortSerial(port=server_port_path, name="bridge")
    captain_radio = RadioPortSerial(port=captain_port_path, name="captain")

    acl = AclTable.load(BASE / ".config.nodes.yaml")
    registry = CommandRegistry.load(BASE / ".config.commands.yaml")
    bridge = Bridge(
        radio=server_radio, engine=engine, acl=acl,
        registry=registry,
        node_id=SERVER_ID,
        short_interval_s=120.0,  # don't spam the air with pubs during the demo
        long_interval_s=120.0,
        idle_threshold_s=300.0,
    )

    passed = 0
    failed = 0

    def _check(condition: bool, label: str, detail: str = "") -> None:
        nonlocal passed, failed
        if condition:
            _ok(label)
            passed += 1
        else:
            _fail(label, detail)
            failed += 1

    await server_radio.open()
    # ESP32-S3 resets on USB-CDC open (DTR toggle). Boot + heltecSetup
    # takes ~2 s; add margin and drain the boot banner before the bridge
    # starts its RX loop, otherwise the first hlo arrives during boot
    # and is missed.
    await asyncio.sleep(2.5)
    try:
        server_radio._ser.reset_input_buffer()  # type: ignore
    except Exception:
        pass

    bridge_task = asyncio.create_task(bridge.run())
    try:
        async with CaptainClient(captain_radio, captain_id) as captain:
            # Same boot delay on the captain's side. The podium_tx
            # firmware doesn't call radio.startReceive() in setup() — it
            # only enters RX mode after its first transmitMessage() — so
            # we need to "kick" the captain with one TX before any
            # incoming-frame test, otherwise the captain's first reply is
            # silently missed because the radio wasn't listening yet.
            await asyncio.sleep(2.5)
            try:
                captain.port._ser.reset_input_buffer()  # type: ignore
            except Exception:
                pass
            # Warmup TX to put captain into RX mode. Don't await any reply
            # — this is just a side-effect to arm the receiver.
            await captain.send(TYPE_PING, SERVER_ID, arg="warmup", want_ack=False)
            await asyncio.sleep(2.0)

            # Helper: send with retry so LoRa drops don't cause spurious
            # red marks. The bridge handles duplicate seqs idempotently.
            async def _send_and_wait(typ: str, arg: str,
                                     want_typ: str, *, want_ack: bool,
                                     attempts: int = 3,
                                     timeout_s: float = 5.0):
                f = None
                for n in range(attempts):
                    seq_local = await captain.send(
                        typ, SERVER_ID, arg=arg, want_ack=want_ack,
                    )
                    f = await captain.wait_for(
                        lambda fr, s=seq_local, w=want_typ:
                            fr.dst == captain_id and fr.typ == w
                            and (w not in (TYPE_ACK, TYPE_REP) or fr.seq == s),
                        timeout_s=timeout_s,
                    )
                    if f is not None:
                        if n > 0:
                            _info(f"  → succeeded on attempt {n + 1}")
                        return f
                return None

            _section("1. captain → bridge: hlo (re-anchors replay window)")
            f = await _send_and_wait(TYPE_HLO, "name/hil,role/captain", TYPE_ACK,
                                     want_ack=True)
            _check(f is not None, "hlo ack received over real radio")

            _section("2. captain → bridge: pin → pon (round-trip latency)")
            t0 = time.time()
            f = await _send_and_wait(TYPE_PING, "hil-test", TYPE_PONG,
                                     want_ack=False)
            rt_ms = (time.time() - t0) * 1000
            _check(f is not None, f"pong received in {rt_ms:.0f} ms over real radio")

            _section("3. captain → bridge: qry engine/status (proves bridge → LAN engine path)")
            f = await _send_and_wait(TYPE_QRY, "engine/status", TYPE_REP,
                                     want_ack=True)
            _check(f is not None, "engine/status rep received")
            if f is not None:
                kv = decode_kv(f.arg)
                _info(f"rep keys: {list(kv.keys())}")
                _check("pat" in kv, "rep contains current pattern key (`pat`)",
                       detail=f"got arg={f.arg!r}")

            _section("4. captain → bridge: cmd brightness/<v> (writes to LAN engine)")
            target_b = 42
            f = await _send_and_wait(TYPE_CMD, f"brightness/{target_b}", TYPE_ACK,
                                     want_ack=True)
            _check(f is not None, "brightness ack received")

            # Read back the engine's mixer master directly to confirm the
            # change actually landed on the LAN engine.
            await asyncio.sleep(0.3)  # the engine commits asynchronously
            mx = await engine.get_mixer()
            engine_b = round((mx or {}).get("master", -1) * 100)
            _check(
                engine_b == target_b,
                f"engine master brightness == {target_b} (got {engine_b})",
            )

            _section("5. secured-channel hardening checks")
            # Have the SERVER radio transmit a v1 plaintext frame over
            # the air (we tell it to via USB; the firmware just relays).
            # The CAPTAIN radio receives it and our codec MUST silently
            # drop it because the magic is `T|`, not `T2|`.
            stats_before = dict(getattr(captain_radio, "secure_stats", {}) or {})
            try:
                server_radio._ser.write(b"T|01|0a|fe|cmd|1|legacy-injection\n")  # type: ignore
                server_radio._ser.flush()  # type: ignore
            except Exception:
                pass
            await asyncio.sleep(1.5)  # cover TX airtime + captain RX poll
            stats_after = getattr(captain_radio, "secure_stats", {}) or {}
            v1_dropped = (
                stats_after.get("dropped_non_v2", 0)
                - stats_before.get("dropped_non_v2", 0)
            )
            _check(
                v1_dropped >= 1,
                "v1 plaintext frame dropped silently on captain (no NAK)",
                detail=f"captain stats before={stats_before} after={stats_after}",
            )

            _section("summary")
            print(f"  passed: {passed}")
            print(f"  failed: {failed}")
            print(f"  bridge stats: {bridge.stats}")
            print(f"  port stats:   server={getattr(server_radio,'secure_stats',{})}  "
                  f"captain={getattr(captain_radio,'secure_stats',{})}")
            if failed:
                print(f"\n  {RED}{BOLD}HIL FAILED — {failed} red check(s){RESET}\n")
            else:
                print(f"\n  {GREEN}{BOLD}ALL HIL CHECKS PASSED — secured channel verified on real radios{RESET}\n")
    finally:
        # Restore brightness so the engine state is unchanged after the test.
        if original_master is not None:
            try:
                await engine.update_mixer_master(float(original_master))
            except EngineUnavailable:
                pass
        bridge_task.cancel()
        try:
            await bridge_task
        except (asyncio.CancelledError, Exception):
            pass
        await server_radio.close()

    return 0 if failed == 0 else 1


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--engine", help="explicit engine URL (skips discovery)")
    return p


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(_build_parser().parse_args())))
