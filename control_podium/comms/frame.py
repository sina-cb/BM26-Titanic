"""
frame.py — Titanic Frame v1 encode / decode.

Wire format (single line, ASCII, ``|``-delimited):

    T|<src>|<dst>|<seq>|<typ>|<flags>|<arg>

Field encoding:

* ``T``      magic literal.
* ``src``    sender node id as 2-char lowercase hex (00..fe). 0x00 is reserved.
* ``dst``    destination id (00..fe), or ``ff`` = broadcast.
* ``seq``    per-sender sequence number, 2-char hex (00..ff).
* ``typ``    3-char message type, see ``TYPE_*`` constants.
* ``flags``  single hex digit bitmask, see ``FLAG_*`` constants.
* ``arg``    opaque UTF-8 payload. Must not contain ``\\n`` or ``:``
             (the firmware's USB output is ``RX:<payload>:RSSI=...`` and we
             keep payloads colon-free to avoid having to change that).

The on-air text is what ``radio.transmit(String)`` sends on the firmware; the
host always builds and parses the textual representation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Tuple


# ── Type constants ────────────────────────────────────────────────────────
TYPE_HLO = "hlo"   # client hello
TYPE_PING = "pin"  # ping (request)
TYPE_PONG = "pon"  # pong (reply)
TYPE_CMD = "cmd"   # privileged command
TYPE_ACK = "ack"   # positive acknowledgement
TYPE_NAK = "nak"   # negative acknowledgement (with reason)
TYPE_QRY = "qry"   # query (read-only request)
TYPE_REP = "rep"   # reply (data for qry)
TYPE_PUB = "pub"   # broadcast status publish

_VALID_TYPES = {
    TYPE_HLO, TYPE_PING, TYPE_PONG, TYPE_CMD, TYPE_ACK, TYPE_NAK,
    TYPE_QRY, TYPE_REP, TYPE_PUB,
}

# ── Flag bits ─────────────────────────────────────────────────────────────
FLAG_ACK_REQUESTED = 0x1
FLAG_PRIVILEGED = 0x2
FLAG_RETRY = 0x4

# ── Special IDs ───────────────────────────────────────────────────────────
SERVER_ID = 0x01
BROADCAST = 0xFF
RESERVED_ZERO = 0x00


class FrameError(ValueError):
    """Raised when an input string cannot be parsed as a Titanic frame."""


@dataclass
class Frame:
    """A Titanic Frame v1."""

    src: int
    dst: int
    seq: int
    typ: str
    flags: int = 0
    arg: str = ""

    # ── Validation ────────────────────────────────────────────────────────
    # NOTE: arg-content rules (`no :`, `no |`, `no \n`) only matter for the
    # v1 plaintext wire encoder — under v2 (secure.py) the arg lives inside
    # AEAD ciphertext and base64, so it can carry arbitrary UTF-8. Those
    # rules are therefore enforced in ``encode()`` (the v1 emitter), not
    # in __post_init__. This keeps the dataclass usable as a logical
    # message irrespective of wire version.
    def __post_init__(self) -> None:
        if not (0 <= self.src <= 0xFE):
            raise FrameError(f"src out of range: 0x{self.src:02X}")
        if not (0 <= self.dst <= 0xFF):
            raise FrameError(f"dst out of range: 0x{self.dst:02X}")
        if not (0 <= self.seq <= 0xFF):
            raise FrameError(f"seq out of range: 0x{self.seq:02X}")
        if self.typ not in _VALID_TYPES:
            raise FrameError(f"unknown typ: {self.typ!r}")
        if not (0 <= self.flags <= 0xF):
            raise FrameError(f"flags out of range: 0x{self.flags:X}")

    # ── Encode / decode ──────────────────────────────────────────────────
    def encode(self) -> str:
        """Return the v1 on-air string (without trailing newline).

        Enforces the v1 inline-arg restrictions: no ``:``, no ``|``, no
        newlines. Use ``secure.Codec.encode()`` for v2 frames where the
        arg can carry arbitrary content.
        """
        if ":" in self.arg:
            raise FrameError("v1 frame arg must not contain ':'")
        if "|" in self.arg:
            raise FrameError("v1 frame arg must not contain '|'")
        if "\n" in self.arg or "\r" in self.arg:
            raise FrameError("v1 frame arg must not contain newlines")
        return (
            f"T|{self.src:02x}|{self.dst:02x}|{self.seq:02x}"
            f"|{self.typ}|{self.flags:x}|{self.arg}"
        )

    @classmethod
    def decode(cls, line: str) -> "Frame":
        """Parse a wire-format string into a Frame."""
        if not line:
            raise FrameError("empty input")
        line = line.rstrip("\r\n")

        # We split with a maxsplit so the arg can survive being empty as well
        # as containing any characters except '|', which is the separator. The
        # validation in __post_init__ enforces the no-':' rule.
        parts = line.split("|", 6)
        if len(parts) < 6 or parts[0] != "T":
            raise FrameError(f"not a Titanic frame: {line!r}")

        # Field 0 is the magic 'T'. Pad arg if missing.
        if len(parts) == 6:
            parts.append("")

        _, src, dst, seq, typ, flags, arg = parts

        try:
            src_i = int(src, 16)
            dst_i = int(dst, 16)
            seq_i = int(seq, 16)
            flags_i = int(flags, 16)
        except ValueError as exc:
            raise FrameError(f"bad hex in frame {line!r}: {exc}") from exc

        return cls(
            src=src_i,
            dst=dst_i,
            seq=seq_i,
            typ=typ,
            flags=flags_i,
            arg=arg,
        )

    # ── Convenience ──────────────────────────────────────────────────────
    def is_broadcast(self) -> bool:
        return self.dst == BROADCAST

    def wants_ack(self) -> bool:
        return bool(self.flags & FLAG_ACK_REQUESTED)

    def __str__(self) -> str:  # pragma: no cover — debug helper
        return self.encode()


# ── Arg helpers ─────────────────────────────────────────────────────────
# The wire spec leaves arg shape application-defined, but most commands use
# either a single path (``pattern/sunset``) or a CSV of key/value pairs
# (``fps/40,pat/sunset,sp/0.7``). Helpers below make those round-trippable.


def encode_kv(items: dict) -> str:
    """Encode {'fps': 40, 'pat': 'sunset'} → 'fps/40,pat/sunset'."""
    parts = []
    for k, v in items.items():
        k = str(k)
        v = str(v)
        if any(c in k + v for c in ":|,/\n\r"):
            # Defensive: keys/values are user-supplied at the upper layer.
            raise FrameError(
                f"kv pair {k!r}={v!r} contains a forbidden separator char"
            )
        parts.append(f"{k}/{v}")
    return ",".join(parts)


def decode_kv(arg: str) -> dict:
    """Decode 'fps/40,pat/sunset' → {'fps': '40', 'pat': 'sunset'}.

    Values are always returned as strings. The caller does any type coercion
    (the wire format is type-agnostic).
    """
    out: dict = {}
    if not arg:
        return out
    for token in arg.split(","):
        if not token:
            continue
        k, _, v = token.partition("/")
        out[k] = v
    return out


def decode_path(arg: str) -> Tuple[str, ...]:
    """Decode 'pattern/sunset' → ('pattern', 'sunset')."""
    if not arg:
        return ()
    return tuple(arg.split("/"))
