"""
client_companion.py — Interactive client over a real or simulated radio.

Stand-in for the CaptainPad iPad in the v2 design. Until we port the wire
protocol to CaptainPad / a BLE bridge in CaptainPad, this is the easiest way
to drive the bridge from a developer machine.

Usage:
    # Sim — for development against companions/bridge_companion.py + sim_bus
    python companions/client_companion.py --node-id 0x0A --bus sim

    # Real radio — auto-resolves /dev/cu.usbmodem* by USB MAC from
    # .config.nodes.yaml; this is what the captain UX uses on the playa.
    python companions/client_companion.py --node-id 0x0A --bus serial
    python companions/client_companion.py --node-id 0x0A --bus serial \
        --serial-port /dev/cu.usbmodem1101            # explicit override

Commands at the prompt (high-level shortcuts that map onto the wire protocol
without you having to type frame paths by hand — these are the same surfaces
CaptainPad will expose in radio-fallback mode per §13 of the design doc):

    /pat <name>            switch to pattern (cmd pattern/<name>)
    /speed <0..1>          set CPC speed (cmd param/speed/<v>)
    /param <k> <v>         set any CPC param (cmd param/<k>/<v>)
    /brightness <0..100>   master brightness (cmd brightness/<v>)   [/bri alias]
    /blackout <0|1>        global blackout (cmd blackout/<v>)
    /ap <0|1>              autopilot on/off (cmd autopilot/<v>)
    /fx <name> <0|1>       global effect (cmd fx/<name>/<v>)
    /status                query engine status (qry engine/status)
    /patterns              query available pattern names (truncated)

    /qry <path>            raw query, e.g. /qry param/speed
    /cmd <path>            raw command, e.g. /cmd pattern/sunset
    /ping [node]           ping the server (default) or another node
                           by id (0x0A) or name (sina); crew can use
                           this to flag a captain.
    /sub                   toggle subscription to broadcast pubs
    /info                  show our node id, role, and the bridge's last pub
    /stats                 local TX/RX stats
    /quit                  exit

Roles are looked up from .config.nodes.yaml by ``--node-id``. The companion
refuses to send ``cmd`` if the node's role is ``crew`` (it warns; the bridge
would reject it anyway, but it's nicer to fail fast locally).

This client also responds to inbound PING frames addressed to it (the
pinger's PONG round-trip works against any peer, not just the bridge).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys
import time
from collections import deque
from pathlib import Path
from typing import Optional

import yaml

BASE = Path(__file__).resolve().parent.parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from comms.acl import AclTable
from comms.frame import (
    BROADCAST,
    FLAG_ACK_REQUESTED,
    FLAG_PRIVILEGED,
    Frame,
    FrameError,
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
from comms.radio_port import RadioPort
from comms.radio_port_sim import RadioPortSim

logger = logging.getLogger("titanic.client")

C = {
    "reset": "\033[0m", "green": "\033[92m", "red": "\033[91m",
    "yellow": "\033[93m", "cyan": "\033[96m", "bold": "\033[1m",
    "dim": "\033[2m", "magenta": "\033[95m", "blue": "\033[94m",
}


def _parse_node_id(s: str) -> int:
    s = s.strip().lower()
    if s.startswith("0x"):
        return int(s, 16)
    try:
        return int(s)
    except ValueError:
        return int(s, 16)


class Client:
    def __init__(self, radio: RadioPort, node_id: int, role: str,
                 subscribe_pubs: bool = True):
        self.radio = radio
        self.node_id = node_id
        self.role = role
        self.subscribe_pubs = subscribe_pubs
        self._seq = 0
        # Map of pending in-flight requests by seq → asyncio.Future
        self._pending: dict[int, asyncio.Future] = {}
        # Stats
        self.stats = {"tx": 0, "rx": 0, "pub": 0, "drops": 0}
        # Last few pubs for /stats display
        self.pub_log: deque[Frame] = deque(maxlen=10)

    # ── Frame helpers ────────────────────────────────────────────────────
    def _next_seq(self) -> int:
        self._seq = (self._seq + 1) & 0xFF
        return self._seq

    async def _send(self, typ: str, arg: str, *, want_ack: bool = True,
                    dst: int = SERVER_ID) -> Optional[Frame]:
        seq = self._next_seq()
        flags = 0
        if want_ack:
            flags |= FLAG_ACK_REQUESTED
        if self.role == "captain":
            flags |= FLAG_PRIVILEGED
        frame = Frame(src=self.node_id, dst=dst, seq=seq, typ=typ,
                      flags=flags, arg=arg)
        print(f"  {C['dim']}⇨ {frame.encode()}{C['reset']}")
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        if want_ack:
            self._pending[seq] = fut
        await self.radio.send(frame)
        self.stats["tx"] += 1
        if not want_ack:
            return None
        try:
            reply: Frame = await asyncio.wait_for(fut, timeout=4.0)
        except asyncio.TimeoutError:
            self._pending.pop(seq, None)
            print(f"  {C['red']}⌛ timeout waiting for ack on seq=0x{seq:02X}{C['reset']}")
            return None
        return reply

    async def _send_reply(self, in_reply_to: Frame, typ: str,
                          arg: str = "") -> None:
        """Reply to a peer using their seq + src — used for inbound PING."""
        out = Frame(
            src=self.node_id, dst=in_reply_to.src, seq=in_reply_to.seq,
            typ=typ, flags=0, arg=arg,
        )
        await self.radio.send(out)
        self.stats["tx"] += 1

    # ── RX loop ──────────────────────────────────────────────────────────
    async def rx_loop(self) -> None:
        async for frame in self.radio.recv_frames():
            self.stats["rx"] += 1
            # Address filter: we only care about frames to us or broadcast
            if frame.dst not in (self.node_id, BROADCAST):
                continue

            # Replies arrive with the original seq number on src=SERVER_ID.
            if frame.typ in (TYPE_ACK, TYPE_NAK, TYPE_REP, TYPE_PONG):
                fut = self._pending.pop(frame.seq, None)
                color = C["green"] if frame.typ != TYPE_NAK else C["red"]
                print(f"  {color}⇦ {frame.encode()}{C['reset']}")
                if fut and not fut.done():
                    fut.set_result(frame)
                continue

            if frame.typ == TYPE_PUB:
                self.stats["pub"] += 1
                self.pub_log.append(frame)
                if self.subscribe_pubs:
                    ts = time.strftime("%H:%M:%S")
                    print(f"  {C['magenta']}[{ts}] PUB {frame.arg}{C['reset']}")
                continue

            # Inbound PING addressed to us (e.g. crew flagging a captain).
            # Reply with PONG echoing the original seq so the pinger's
            # in-flight future resolves.
            if frame.typ == TYPE_PING and frame.dst == self.node_id:
                ts = time.strftime("%H:%M:%S")
                print(f"  {C['cyan']}[{ts}] 📡 ping from 0x{frame.src:02X}{C['reset']}")
                await self._send_reply(frame, TYPE_PONG, "")
                continue

            # Unsolicited: log only.
            print(f"  {C['dim']}{frame.encode()}{C['reset']}")

    # ── Lifecycle ────────────────────────────────────────────────────────
    async def hello(self) -> None:
        # Brief hello so the bridge knows who we are. We don't include role
        # on the wire — the bridge looks it up by node_id.
        await self._send(TYPE_HLO, f"name/node{self.node_id:02x}",
                         want_ack=True)


def _load_acl() -> AclTable:
    return AclTable.load(BASE / ".config.nodes.yaml")


def _require_captain(client: "Client") -> bool:
    """Local guard before we even put a cmd on the air."""
    if client.role != "captain":
        print(f"  {C['red']}refused locally: role={client.role} can't send commands. "
              f"Try /qry instead, or /ping <captain> to flag attention.{C['reset']}")
        return False
    return True


def _resolve_node_target(acl: AclTable, target: str) -> Optional[int]:
    """Resolve a node id (``0x0A``, ``10``) or a name (``sina``) to an int.

    Returns ``None`` when nothing matches; caller prints the error so we
    don't litter logs from the resolver.
    """
    target = target.strip()
    if not target:
        return None
    # First try as a numeric/hex id.
    try:
        return _parse_node_id(target)
    except ValueError:
        pass
    # Fallback: name lookup.
    for entry in acl.all_nodes():
        if entry.name == target:
            return entry.node_id
    return None


def _parse_value(s: str, *, kind: str) -> Optional[float | int]:
    """Permissive parse of a slider value with an obvious message on failure."""
    try:
        if kind == "frac":
            v = float(s)
            if not (0.0 <= v <= 1.0):
                print(f"  {C['red']}value must be in [0,1]{C['reset']}")
                return None
            return v
        if kind == "pct":
            v = int(s)
            if not (0 <= v <= 100):
                print(f"  {C['red']}value must be in [0,100]{C['reset']}")
                return None
            return v
        if kind == "bool":
            if s in ("0", "1"):
                return int(s)
            print(f"  {C['red']}use 0 or 1{C['reset']}")
            return None
    except ValueError:
        print(f"  {C['red']}can't parse {s!r}{C['reset']}")
        return None
    return None


async def _interactive(client: "Client", acl: AclTable) -> None:
    loop = asyncio.get_running_loop()
    print(f"  {C['dim']}type /help for shortcuts{C['reset']}\n")

    HELP = (
        "  /pat <name>           /speed <0..1>        /param <k> <v>\n"
        "  /brightness <0..100>  /blackout <0|1>      /ap <0|1>\n"
        "  /fx <name> <0|1>      /status              /patterns\n"
        "  /qry <path>           /cmd <path>          /ping [node]\n"
        "  /sub  /info  /stats  /quit"
    )

    while True:
        try:
            line = await loop.run_in_executor(
                None, lambda: input(f"  {C['yellow']}client>{C['reset']} "),
            )
        except (EOFError, KeyboardInterrupt):
            return
        line = line.strip()
        if not line:
            continue

        # ── Meta / help ──────────────────────────────────────────────
        if line in ("/quit", "/exit"):
            return
        if line in ("/help", "/?"):
            print(HELP)
            continue
        if line == "/info":
            last_pub = client.pub_log[-1] if client.pub_log else None
            print(f"  node=0x{client.node_id:02X}  role={client.role}")
            if last_pub:
                age = max(0.0, time.time() - getattr(last_pub, "_t", time.time()))
                print(f"  last pub: {last_pub.arg}  (age {age:.1f}s)")
            else:
                print(f"  last pub: <none yet>")
            continue
        if line == "/stats":
            print(f"  tx={client.stats['tx']} rx={client.stats['rx']} "
                  f"pub={client.stats['pub']} drops={client.stats['drops']}")
            for pub in list(client.pub_log)[-5:]:
                print(f"    pub seq=0x{pub.seq:02X} {pub.arg}")
            continue
        if line == "/sub":
            client.subscribe_pubs = not client.subscribe_pubs
            print(f"  subscribe_pubs = {client.subscribe_pubs}")
            continue
        if line == "/ping" or line.startswith("/ping "):
            target_arg = line[6:].strip() if line.startswith("/ping ") else ""
            if target_arg:
                target_id = _resolve_node_target(acl, target_arg)
                if target_id is None:
                    print(f"  {C['red']}unknown ping target {target_arg!r}. "
                          f"Try a node id (0x0A) or a name from .config.nodes.yaml{C['reset']}")
                    continue
                target_label = acl.name(target_id) or f"0x{target_id:02X}"
            else:
                target_id = SERVER_ID
                target_label = "server"
            t0 = time.time()
            reply = await client._send(TYPE_PING, "", want_ack=True,
                                       dst=target_id)
            if reply is not None:
                rtt = (time.time() - t0) * 1000
                print(f"  {C['cyan']}🏓 pong from {target_label} (0x{target_id:02X}) RTT {rtt:.0f}ms{C['reset']}")
            continue

        # ── Query shortcuts ──────────────────────────────────────────
        if line == "/status":
            await client._send(TYPE_QRY, "engine/status", want_ack=True)
            continue
        if line == "/patterns":
            await client._send(TYPE_QRY, "engine/patterns", want_ack=True)
            continue

        # ── Command shortcuts ────────────────────────────────────────
        # Each shortcut: parse args, then route to the same wire format
        # the bridge expects. These mirror the radio-mode feature surface
        # in design doc §13.
        if line.startswith("/pat "):
            if not _require_captain(client):
                continue
            name = line[5:].strip()
            if not name:
                print(f"  {C['red']}/pat needs a pattern name{C['reset']}")
                continue
            await client._send(TYPE_CMD, f"pattern/{name}", want_ack=True)
            continue

        if line.startswith("/speed "):
            if not _require_captain(client):
                continue
            v = _parse_value(line[7:].strip(), kind="frac")
            if v is None:
                continue
            await client._send(TYPE_CMD, f"param/speed/{v}", want_ack=True)
            continue

        if line.startswith("/param "):
            if not _require_captain(client):
                continue
            parts = line[7:].strip().split()
            if len(parts) != 2:
                print(f"  {C['red']}usage: /param <key> <value>{C['reset']}")
                continue
            key, val = parts
            await client._send(TYPE_CMD, f"param/{key}/{val}", want_ack=True)
            continue

        # /brightness is the canonical name; /bri kept as a back-compat alias
        # so old muscle memory keeps working. Both emit cmd brightness/<v>.
        if line.startswith("/brightness ") or line.startswith("/bri "):
            if not _require_captain(client):
                continue
            arg = line.split(" ", 1)[1].strip()
            v = _parse_value(arg, kind="pct")
            if v is None:
                continue
            await client._send(TYPE_CMD, f"brightness/{v}", want_ack=True)
            continue

        if line.startswith("/blackout "):
            if not _require_captain(client):
                continue
            v = _parse_value(line[10:].strip(), kind="bool")
            if v is None:
                continue
            await client._send(TYPE_CMD, f"blackout/{v}", want_ack=True)
            continue

        if line.startswith("/ap "):
            if not _require_captain(client):
                continue
            v = _parse_value(line[4:].strip(), kind="bool")
            if v is None:
                continue
            await client._send(TYPE_CMD, f"autopilot/{v}", want_ack=True)
            continue

        if line.startswith("/fx "):
            if not _require_captain(client):
                continue
            parts = line[4:].strip().split()
            if len(parts) != 2:
                print(f"  {C['red']}usage: /fx <name> <0|1>{C['reset']}")
                continue
            name = parts[0]
            v = _parse_value(parts[1], kind="bool")
            if v is None:
                continue
            await client._send(TYPE_CMD, f"fx/{name}/{v}", want_ack=True)
            continue

        # ── Raw passthrough ──────────────────────────────────────────
        if line.startswith("/qry "):
            await client._send(TYPE_QRY, line[5:].strip(), want_ack=True)
            continue
        if line.startswith("/cmd "):
            if not _require_captain(client):
                continue
            await client._send(TYPE_CMD, line[5:].strip(), want_ack=True)
            continue

        print(f"  {C['dim']}unknown. /help for shortcuts.{C['reset']}")


def _resolve_serial_port(node_id: int, override: Optional[str]) -> str:
    """Resolve the USB device for ``node_id``.

    Order:
      1. ``--serial-port`` override (operator was explicit).
      2. ``.config.nodes.yaml`` ``usb_mac`` → ``/dev/cu.usbmodem*`` via
         ``utils.discovery.find_port_by_mac`` (set by ``firmware/deploy.py``).

    Hard-fails with a clear message if neither resolves; we never want to
    silently grab "the first /dev/cu.usbmodem* we see" because there are
    typically two boards plugged in.
    """
    if override:
        return override

    from utils.discovery import find_port_by_mac

    cfg = yaml.safe_load((BASE / ".config.nodes.yaml").read_text()) or {}
    nodes = cfg.get("nodes") or {}
    entry = nodes.get(node_id) or nodes.get(f"0x{node_id:02X}")
    mac = (entry or {}).get("usb_mac")
    if not mac:
        sys.exit(
            f"node 0x{node_id:02X} has no usb_mac in .config.nodes.yaml. "
            f"Run firmware/deploy.py --node 0x{node_id:02X} to pair it, "
            f"or pass --serial-port explicitly."
        )
    port = find_port_by_mac(mac)
    if not port:
        sys.exit(
            f"no USB device with MAC {mac} (paired to node 0x{node_id:02X}). "
            f"Plug it in, or use deploy.py --list to see what's connected."
        )
    return port


async def _build_radio(args, node_id: int, name: str) -> RadioPort:
    if args.bus == "sim":
        radio = RadioPortSim(host=args.bus_host, port=args.bus_port, name=name)
    elif args.bus == "serial":
        from comms.radio_port_serial import RadioPortSerial
        port = _resolve_serial_port(node_id, args.serial_port)
        radio = RadioPortSerial(port=port, baud=args.baud, name=name)
        # Stash for the banner — the user wants to see which /dev/cu.* we grabbed.
        radio._dev_label = port  # type: ignore[attr-defined]
    else:
        sys.exit(f"unknown --bus mode: {args.bus}")
    await radio.open()
    return radio


async def _run(args) -> None:
    # Fail FAST if the shared secret is missing — no plaintext on the
    # mesh, ever. See docs/07_control_podium.md §3.6.
    from comms.secure import SecretError, default_codec
    try:
        default_codec()
    except SecretError as exc:
        sys.exit(f"shared-secret load failed:\n{exc}")

    node_id = _parse_node_id(args.node_id)
    acl = _load_acl()
    entry = acl.get(node_id)
    if entry is None:
        sys.exit(f"node 0x{node_id:02X} not in .config.nodes.yaml")
    role = entry.role
    if args.role and args.role != role:
        print(f"  {C['yellow']}WARNING: --role {args.role} overrides config role={role}{C['reset']}")
        role = args.role

    radio = await _build_radio(args, node_id,
                               name=f"node-{node_id:02x}-{entry.name}")

    client = Client(radio=radio, node_id=node_id, role=role,
                    subscribe_pubs=args.subscribe)

    bus_label = (
        f"sim {args.bus_host}:{args.bus_port}"
        if args.bus == "sim"
        else f"serial {getattr(radio, '_dev_label', '?')} @ {args.baud}"
    )

    print()
    print(f"  CLIENT COMPANION  node=0x{node_id:02X} ({entry.name}, role={role})")
    print(f"  bus:   {bus_label}")
    print(f"  pubs:  {'on' if args.subscribe else 'off'} (toggle with /sub)")
    print()

    if args.bus == "serial":
        # Boards do a DTR-triggered reset on serial open; give the firmware
        # ~2.5 s to print its boot banner, then drop the bootloader chatter
        # so the first user frame doesn't race a "Heltec V4 ready" line.
        await asyncio.sleep(2.5)

    rx_task = asyncio.create_task(client.rx_loop())

    try:
        await client.hello()
        await _interactive(client, acl)
    finally:
        rx_task.cancel()
        await radio.close()


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Titanic radio client")
    p.add_argument("--node-id", required=True,
                   help="our node ID, e.g. 0x0A or 10 (hex)")
    p.add_argument("--role",
                   help="override role from config (captain|crew)")
    p.add_argument("--bus", choices=("sim", "serial"), default="sim",
                   help="transport: sim (default) or serial (real Heltec)")
    # Sim transport
    p.add_argument("--bus-host", default="127.0.0.1",
                   help="(sim) sim_bus host")
    p.add_argument("--bus-port", type=int, default=7100,
                   help="(sim) sim_bus port")
    # Serial transport
    p.add_argument("--serial-port", default=None,
                   help="(serial) explicit /dev/cu.usbmodem* override; "
                        "default resolves via .config.nodes.yaml usb_mac")
    p.add_argument("--baud", type=int, default=115200,
                   help="(serial) USB-CDC baud (115200)")
    # Misc
    p.add_argument("--no-subscribe", dest="subscribe", action="store_false",
                   help="don't print broadcast pubs")
    p.set_defaults(subscribe=True)
    return p


def main() -> None:  # pragma: no cover
    args = _build_parser().parse_args()
    logging.basicConfig(level=logging.WARNING)
    try:
        asyncio.run(_run(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":  # pragma: no cover
    main()
