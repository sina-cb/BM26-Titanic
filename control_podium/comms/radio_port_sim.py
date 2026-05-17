"""
radio_port_sim.py — RadioPort adapter for the sim_bus TCP hub.

Each node connects to the same bus host:port. Frames sent on one node are
delivered to all other connected nodes (the sim_bus does the fanout).

Loopback (TX echoes back to the sender) is intentionally NOT modeled — real
LoRa half-duplex behavior is "you don't hear your own transmissions". The
node tracking its own ``src`` is enough for filtering elsewhere if needed.
"""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator, Optional

from .frame import Frame, FrameError
from .radio_port import RadioPort

logger = logging.getLogger("titanic.radio_sim")


class RadioPortSim(RadioPort):
    """Talks to a ``sim_bus`` daemon over TCP.

    If ``codec`` is provided, every outbound frame is AEAD-encoded and
    every inbound line is parse + tag-verified before being yielded.
    Pass a ``ReplayWindow`` too to enable per-source anti-replay (the
    bridge sets both; companions usually only need the codec).
    """

    # Sentinel so callers can pass `codec=None` to explicitly DISABLE
    # the secured channel (used by negative tests). The default sentinel
    # auto-loads the process-wide codec from marsin_engine/secret.yaml.
    _AUTO = object()

    def __init__(self, host: str = "127.0.0.1", port: int = 7100,
                 name: str = "?", reconnect_interval_s: float = 1.0,
                 codec=_AUTO, replay=_AUTO):
        self.host = host
        self.port = port
        self.name = name
        self.reconnect_interval_s = reconnect_interval_s
        if codec is RadioPortSim._AUTO:
            from .secure import default_codec
            codec = default_codec()
        self.codec = codec
        if replay is RadioPortSim._AUTO:
            from .replay import ReplayWindow
            replay = ReplayWindow() if codec is not None else None
        self.replay = replay
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._open = False
        self._send_lock = asyncio.Lock()

    async def open(self) -> None:
        await self._connect()
        self._open = True

    async def close(self) -> None:
        self._open = False
        if self._writer is not None:
            try:
                self._writer.close()
                await self._writer.wait_closed()
            except Exception:
                pass
            self._reader = None
            self._writer = None

    async def _connect(self) -> None:
        self._reader, self._writer = await asyncio.open_connection(
            self.host, self.port,
        )
        # Announce ourselves so the bus log is readable.
        self._writer.write(f"HELLO {self.name}\n".encode("utf-8"))
        await self._writer.drain()
        logger.info("connected to sim_bus %s:%d as %s",
                    self.host, self.port, self.name)

    async def send(self, frame: Frame) -> None:
        line = self._encode_outbound(frame) + "\n"
        async with self._send_lock:
            if self._writer is None:
                raise ConnectionError("radio port is closed")
            self._writer.write(line.encode("utf-8"))
            await self._writer.drain()

    async def recv_frames(self) -> AsyncIterator[Frame]:
        while self._open:
            if self._reader is None:
                await asyncio.sleep(self.reconnect_interval_s)
                try:
                    await self._connect()
                except Exception as exc:
                    logger.warning("sim_bus reconnect failed: %s", exc)
                    continue

            try:
                raw = await self._reader.readline()
            except (ConnectionError, asyncio.IncompleteReadError):
                raw = b""

            if not raw:
                # Peer closed. Try to reconnect.
                logger.info("sim_bus disconnected, will retry")
                self._reader = None
                if self._writer is not None:
                    try:
                        self._writer.close()
                        await self._writer.wait_closed()
                    except Exception:
                        pass
                    self._writer = None
                if not self._open:
                    return
                await asyncio.sleep(self.reconnect_interval_s)
                continue

            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            frame = self._decode_inbound(line)
            if frame is None:
                continue
            yield frame
