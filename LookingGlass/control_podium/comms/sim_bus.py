"""
sim_bus.py — Simulated LoRa broadcast medium (TCP).

The real on-air model is: every node transmits, all other nodes within range
receive the same byte stream. The sim_bus replicates that by being a tiny
TCP hub: every line a client sends is rebroadcast (line by line) to all OTHER
connected clients.

Optional impairments:

* ``--drop <p>``      drop each delivery with probability ``p`` (0..1).
* ``--latency-ms N``  add ``N`` ms of artificial delay to every delivery.

This is intentionally simple: no per-pair RSSI, no collision modeling.
It's enough to develop, debug, and integration-test the upper layers.

Usage:
    python -m control_podium.comms.sim_bus --port 7100

The wire is one Titanic frame per line. The hub doesn't parse frames; it
just relays bytes between `\\n` delimiters. That keeps the hub agnostic and
lets us pump non-frame debug traffic through it for prototyping if needed.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("titanic.sim_bus")


@dataclass
class _Client:
    """One connected radio."""

    writer: asyncio.StreamWriter
    name: str = "?"
    peer: str = ""
    connected_at: float = field(default_factory=time.time)


class SimBus:
    """In-process LoRa hub. Run via ``serve()``."""

    def __init__(self, host: str = "127.0.0.1", port: int = 7100,
                 drop_p: float = 0.0, latency_ms: int = 0):
        if not (0.0 <= drop_p <= 1.0):
            raise ValueError("drop_p must be in [0,1]")
        if latency_ms < 0:
            raise ValueError("latency_ms must be >= 0")
        self.host = host
        self.port = port
        self.drop_p = drop_p
        self.latency_ms = latency_ms

        self._clients: list[_Client] = []
        self._lock = asyncio.Lock()
        self._server: Optional[asyncio.AbstractServer] = None
        self.stats = {
            "connects": 0, "disconnects": 0, "frames_in": 0,
            "frames_relayed": 0, "frames_dropped": 0,
        }

    async def serve(self) -> None:
        """Start the TCP server. Blocks until cancelled."""
        self._server = await asyncio.start_server(
            self._on_client, self.host, self.port,
        )
        addrs = ", ".join(str(s.getsockname()) for s in self._server.sockets)
        logger.info(
            "sim_bus listening on %s (drop=%.2f%%, latency=%dms)",
            addrs, self.drop_p * 100, self.latency_ms,
        )
        async with self._server:
            await self._server.serve_forever()

    async def _on_client(self, reader: asyncio.StreamReader,
                         writer: asyncio.StreamWriter) -> None:
        peer = writer.get_extra_info("peername")
        peer_s = f"{peer[0]}:{peer[1]}" if peer else "?"
        client = _Client(writer=writer, peer=peer_s)
        async with self._lock:
            self._clients.append(client)
            self.stats["connects"] += 1
        logger.info("connect  %s (now %d clients)", peer_s, len(self._clients))
        try:
            # Optional handshake: client may send a single "HELLO <name>\n"
            # line first so the hub can label it in logs. Any other first
            # line is treated as a regular relay-ready line.
            first = await reader.readline()
            if not first:
                return
            line0 = first.decode("utf-8", errors="replace").strip()
            if line0.startswith("HELLO "):
                client.name = line0[len("HELLO "):].strip() or "?"
                logger.info("  ↳ %s identifies as %s", peer_s, client.name)
            else:
                # Treat first line as a real frame.
                await self._relay(client, line0)

            # Pump the rest.
            while True:
                raw = await reader.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                await self._relay(client, line)
        except (ConnectionError, asyncio.CancelledError):
            pass
        finally:
            async with self._lock:
                if client in self._clients:
                    self._clients.remove(client)
                self.stats["disconnects"] += 1
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
            logger.info("disconnect %s (%s)", peer_s, client.name)

    async def _relay(self, sender: _Client, line: str) -> None:
        """Re-broadcast ``line`` to all clients except ``sender``."""
        self.stats["frames_in"] += 1
        if self.latency_ms > 0:
            # Per-frame artificial delay so timing-sensitive tests behave.
            await asyncio.sleep(self.latency_ms / 1000.0)
        # Snapshot the current client list so we don't hold the lock during
        # I/O. Disconnected clients on send become a no-op (writer.write
        # buffers, drain raises).
        async with self._lock:
            recipients = [c for c in self._clients if c is not sender]
        out = (line + "\n").encode("utf-8")
        for c in recipients:
            if self.drop_p > 0.0 and random.random() < self.drop_p:
                self.stats["frames_dropped"] += 1
                continue
            try:
                c.writer.write(out)
                await c.writer.drain()
                self.stats["frames_relayed"] += 1
            except (ConnectionError, OSError):
                # Will be cleaned up by the recipient's own _on_client exit.
                pass
        logger.debug(
            "relay %s → %d peers: %s",
            sender.name or sender.peer, len(recipients), line,
        )


# ── CLI ───────────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Titanic simulated radio bus")
    p.add_argument("--host", default="127.0.0.1",
                   help="bind host (default 127.0.0.1; use 0.0.0.0 to listen on LAN)")
    p.add_argument("--port", type=int, default=7100, help="TCP port")
    p.add_argument("--drop", type=float, default=0.0,
                   help="per-delivery drop probability 0..1")
    p.add_argument("--latency-ms", type=int, default=0,
                   help="ms of artificial delay per delivery")
    p.add_argument("-v", "--verbose", action="count", default=0,
                   help="-v INFO, -vv DEBUG")
    return p


def main() -> None:  # pragma: no cover
    args = _build_parser().parse_args()
    level = logging.WARNING
    if args.verbose >= 2:
        level = logging.DEBUG
    elif args.verbose == 1:
        level = logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    bus = SimBus(host=args.host, port=args.port,
                 drop_p=args.drop, latency_ms=args.latency_ms)
    try:
        asyncio.run(bus.serve())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":  # pragma: no cover
    main()
