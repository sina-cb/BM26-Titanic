"""
radio_port.py — Abstract transport for Titanic frames.

A ``RadioPort`` is an async-iterable channel that:

* Accepts outgoing Frame objects via ``send(frame)``.
* Yields incoming Frame objects from ``recv_frames()`` (an async generator).

Two concrete adapters live alongside this file:

* ``radio_port_sim``    — connects to a ``sim_bus`` TCP hub.
* ``radio_port_serial`` — connects to a real Heltec firmware over USB serial.

Both implement the same surface so the bridge / clients are transport-agnostic.

**Secured channel (v2).** When a port is constructed with a non-None
``codec`` (a ``secure.Codec``), every outbound frame is AEAD-encrypted
under the pre-shared key and every inbound line is parse + tag-verified
before being yielded. Bad-tag and replay-rejected frames are silently
dropped (no NAK, no leak — see design §3.6.7). When ``codec`` is None,
the port falls back to v1 plaintext encoding — used only by the small
set of unit tests that predate the secured channel.
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import AsyncIterator, Optional

from .frame import Frame


class RadioPort(ABC):
    """Abstract send/receive channel for Titanic frames."""

    @abstractmethod
    async def open(self) -> None:
        """Open the underlying transport."""

    @abstractmethod
    async def close(self) -> None:
        """Close the transport."""

    @abstractmethod
    async def send(self, frame: Frame) -> None:
        """Transmit a frame. Returns when the local buffer has accepted it.

        On a real radio this may not equal "the frame is on-air" — TX is
        async on the firmware too. The bridge tolerates this; callers that
        need delivery confirmation set ``FLAG_ACK_REQUESTED`` and wait for
        an ``ack`` reply.
        """

    @abstractmethod
    def recv_frames(self) -> AsyncIterator[Frame]:
        """Async generator yielding incoming Frame objects.

        Implementations should silently drop malformed frames and may log a
        counter. Closing the port causes the iterator to terminate.
        """

    # ── Async context manager sugar ──────────────────────────────────────
    async def __aenter__(self):
        await self.open()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self.close()

    # ── Secured-channel helpers (shared by sim + serial transports) ─────
    # The codec / replay window are stored on the concrete port instance
    # (see radio_port_sim, radio_port_serial). These helpers centralize
    # encode/decode so both transports stay in lock-step.

    def _encode_outbound(self, frame: Frame) -> str:
        """Wire-encode a frame. Uses AEAD if a codec was provided."""
        codec = getattr(self, "codec", None)
        if codec is None:
            return frame.encode()
        return codec.encode(frame)

    def _decode_inbound(self, line: str) -> Optional[Frame]:
        """Decode + verify one inbound wire line. Returns None on any
        failure (bad parse, bad tag, replay) — callers MUST treat None
        as 'silent drop' per §3.6.7. Increments per-failure counters
        on the port instance.
        """
        codec = getattr(self, "codec", None)
        if codec is None:
            from .frame import FrameError
            try:
                return Frame.decode(line)
            except FrameError:
                return None

        # v2 path: parse + verify + replay-check
        from .secure import (
            BadTagError, SecureFrameError, looks_like_v2,
        )
        from .replay import ReplayResult

        if not looks_like_v2(line):
            # Could be v1 plaintext from a legacy node (we hard-cutover
            # so this should be rare), firmware boot banner, etc. Drop.
            self._stat("dropped_non_v2")
            return None
        try:
            decoded = codec.decode(line)
        except BadTagError:
            self._stat("bad_tag")
            return None
        except SecureFrameError:
            self._stat("parse_error")
            return None

        replay = getattr(self, "replay", None)
        if replay is not None:
            from .frame import TYPE_HLO
            result = replay.accept(
                decoded.frame.src,
                decoded.ctr,
                is_hlo=(decoded.frame.typ == TYPE_HLO),
            )
            if result in (ReplayResult.REPLAY_DUP, ReplayResult.REPLAY_TOO_OLD):
                # Replay defense kicked in. Do NOT yield; bridge counter
                # is already incremented on the ReplayWindow itself.
                return None
        return decoded.frame

    def _stat(self, key: str) -> None:
        """Bump a per-port secure-channel counter (best-effort)."""
        d = getattr(self, "secure_stats", None)
        if d is None:
            d = {}
            setattr(self, "secure_stats", d)
        d[key] = d.get(key, 0) + 1
