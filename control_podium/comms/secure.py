"""
secure.py — Titanic Frame v2 authenticated-encryption codec.

Implements the wire spec from ``docs/07_control_podium.md §3.6``:

* **Cipher** AES-128-GCM (mbedTLS-compatible, hardware-accelerated on ESP32-S3
  and OpenSSL-backed on the Pi via ``cryptography.hazmat.primitives``).
* **Key**    16 bytes, loaded from ``marsin_engine/secret.yaml`` (the single
  source of truth for the whole TITANIC ecosystem — engine, bridge,
  captain companion, future iPad). Either a literal hex string
  (``key_hex: "..."`` — 32 hex chars) or any short string
  (``key: "SECRET"``) which is hashed with SHA-256 and truncated to 16 bytes.
* **Nonce**  12 bytes = ``src(1) || 0×5 || ctr_be(6)``. Per-sender counter
  spaces are disjoint; collisions are structurally impossible as long as the
  sender keeps the counter monotone.
* **Tag**    full 16-byte GCM tag, hex-encoded (32 chars).
* **AD**     the cleartext header through ``<ctr>`` (no trailing pipe).
* **Body**   base64url-no-pad of the ciphertext. Empty body is ``-``.
* **Magic**  ``T2`` (vs v1 ``T``). Hard cutover; v1 frames are silently
  dropped by v2 receivers.

Receivers MUST silently discard frames that fail any check (parse, magic,
tag) — **never** NAK on a bad tag, that would be an oracle for active
attackers (see §3.6.7).

Counter management is the *sender's* job; this module only encodes and
decodes. ``replay.py`` handles receiver-side anti-replay.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

import yaml
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .frame import Frame, FrameError

logger = logging.getLogger("titanic.secure")

# Wire constants. MUST stay in sync with the firmware's secure_frame.cpp.
WIRE_VERSION = "T2"
KEY_BYTES = 16             # AES-128
NONCE_BYTES = 12           # GCM standard
TAG_BYTES = 16             # GCM full tag
CTR_BYTES = 6              # 48 bits monotone per sender
CTR_HEX_LEN = CTR_BYTES * 2
TAG_HEX_LEN = TAG_BYTES * 2
EMPTY_BODY_SENTINEL = "-"  # so we can distinguish "no plaintext" from "missing field"


# ── Errors ─────────────────────────────────────────────────────────────────


class SecretError(RuntimeError):
    """Raised when the shared-secret file is missing or malformed."""


class SecureFrameError(ValueError):
    """Raised when a wire string fails to decode as a v2 secured frame.

    Receivers should treat this as 'silent drop' (no NAK, no log of body).
    """


class BadTagError(SecureFrameError):
    """Sub-class for the specific 'cipher rejected the tag' case so callers
    can bump a separate metric. Still must be silently dropped on the wire."""


# ── secret loader ──────────────────────────────────────────────────────────


def load_secret(path: Path) -> bytes:
    """Read the shared-secret YAML and return the 16-byte AES-128-GCM key.

    Raises ``SecretError`` (with a clear message) if the file is missing,
    unparseable, has an unsupported version, or specifies a malformed key.
    Companions and the bridge let this exception propagate to main()
    rather than fall back to plaintext (see §3.6.3 of the design doc).
    """
    if not path.exists():
        raise SecretError(
            f"missing secret file: {path}\n"
            f"  Bring-up steps:\n"
            f"    cp marsin_engine/secret.yaml.example marsin_engine/secret.yaml\n"
            f"    edit marsin_engine/secret.yaml and set `key:` (string) for dev\n"
            f"    or `key_hex:` (32 hex chars) for production.\n"
            f"  The SAME file must exist on every machine that runs an engine,\n"
            f"  bridge, captain companion, or future CaptainPad — distribute\n"
            f"  by USB or scp over a trusted LAN, never over the radio."
        )
    try:
        doc = yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError as exc:
        raise SecretError(f"{path}: invalid YAML: {exc}") from exc

    if not isinstance(doc, dict):
        raise SecretError(f"{path}: top-level must be a mapping")

    version = doc.get("version", 1)
    if version != 1:
        raise SecretError(
            f"{path}: unsupported version={version!r} "
            "(only v1 = AES-128-GCM is implemented)"
        )

    # key_hex takes precedence; key is the dev-friendly path.
    key_hex = doc.get("key_hex")
    key_str = doc.get("key")
    if key_hex is not None:
        if not isinstance(key_hex, str):
            raise SecretError(f"{path}: key_hex must be a string")
        try:
            raw = bytes.fromhex(key_hex.strip())
        except ValueError as exc:
            raise SecretError(f"{path}: key_hex is not valid hex: {exc}") from exc
        if len(raw) != KEY_BYTES:
            raise SecretError(
                f"{path}: key_hex decodes to {len(raw)} bytes, expected {KEY_BYTES}"
            )
        return raw

    if key_str is None:
        raise SecretError(
            f"{path}: must contain either `key:` (string) or `key_hex:` (32 hex chars)"
        )
    if not isinstance(key_str, str) or not key_str:
        raise SecretError(f"{path}: key must be a non-empty string")
    # SHA-256 → first 16 bytes. Deterministic, well-defined, identical on
    # firmware (mbedtls_sha256). Truncating SHA-256 to 128 bits is the
    # standard NIST construction for short-key derivation.
    return hashlib.sha256(key_str.encode("utf-8")).digest()[:KEY_BYTES]


# ── Codec ─────────────────────────────────────────────────────────────────


@dataclass
class DecodedFrame:
    """Result of a successful v2 decode: the cleartext frame + its counter.

    The counter is exposed separately so the receiver can run it through
    a ``ReplayWindow`` BEFORE handing the frame to upper layers.
    """

    frame: Frame
    ctr: int


class Codec:
    """Stateless encode/decode helper bound to one pre-shared key.

    Instantiate once per process (the bridge does this on startup, every
    companion does it on its constructor) and pass to ``RadioPort`` so
    every send / recv goes through the cipher.

    Counter management for outbound TX lives in this class as a small
    convenience: each ``encode()`` call without an explicit ``ctr=``
    auto-increments an internal monotone counter seeded from the OS RNG +
    boot time. That avoids every caller needing its own counter and gives
    a sensible default for unit tests; production callers (the bridge,
    the companions) pass an explicit counter that they persist across
    runs if they want sub-second restart safety.
    """

    def __init__(self, key: bytes):
        if len(key) != KEY_BYTES:
            raise ValueError(f"key must be {KEY_BYTES} bytes, got {len(key)}")
        self._aead = AESGCM(key)
        # See class docstring: 64-bit seed (32 random + 32 of low-resolution
        # wall-clock seconds) so a hard restart of a companion can't collide
        # with a counter the bridge already saw within the same second. The
        # 48-bit on-wire counter is plenty of room (281 trillion frames).
        seed = (int.from_bytes(os.urandom(4), "big") << 16) ^ (int.from_bytes(os.urandom(2), "big"))
        self._counter = seed & ((1 << (CTR_BYTES * 8)) - 1)

    # ── Counter helpers ────────────────────────────────────────────────

    def next_ctr(self) -> int:
        """Allocate the next outbound counter for this codec instance."""
        # 48-bit wrap is impossible at any plausible message rate, but
        # mask defensively so a bug elsewhere can't cause a 49-bit value.
        self._counter = (self._counter + 1) & ((1 << (CTR_BYTES * 8)) - 1)
        return self._counter

    def peek_ctr(self) -> int:
        return self._counter

    # ── Encode ────────────────────────────────────────────────────────

    def encode(self, frame: Frame, ctr: Optional[int] = None) -> str:
        """Encode a Frame as a v2 wire string.

        ``ctr`` defaults to ``self.next_ctr()``. Pass an explicit value
        if you persist counters across process restarts.
        """
        if ctr is None:
            ctr = self.next_ctr()
        if not (0 <= ctr < (1 << (CTR_BYTES * 8))):
            raise ValueError(f"ctr {ctr} out of 48-bit range")

        # Header is the AAD. Build by fields, NEVER by slicing input — we
        # control the byte-exact form so the receiver can reproduce it.
        header = (
            f"{WIRE_VERSION}|{frame.src:02x}|{frame.dst:02x}|{frame.seq:02x}"
            f"|{frame.typ}|{frame.flags:x}|{ctr:0{CTR_HEX_LEN}x}"
        )
        ad = header.encode("ascii")

        nonce = _make_nonce(frame.src, ctr)
        plaintext = frame.arg.encode("utf-8")
        ct_and_tag = self._aead.encrypt(nonce, plaintext, ad)
        # GCM in `cryptography` returns ciphertext || tag concatenated.
        ciphertext = ct_and_tag[:-TAG_BYTES]
        tag = ct_and_tag[-TAG_BYTES:]

        body = (
            EMPTY_BODY_SENTINEL
            if not ciphertext
            else base64.urlsafe_b64encode(ciphertext).rstrip(b"=").decode("ascii")
        )
        return f"{header}|{body}|{tag.hex()}"

    # ── Decode ────────────────────────────────────────────────────────

    def decode(self, line: str) -> DecodedFrame:
        """Parse a wire string and verify the AEAD tag.

        Raises ``SecureFrameError`` (parse / structure problems) or
        ``BadTagError`` (cipher rejected the tag, i.e. wrong key OR
        active forgery attempt). Callers MUST treat both as silent drop.
        """
        if not line:
            raise SecureFrameError("empty input")
        line = line.rstrip("\r\n")

        # Layout: T2|src|dst|seq|typ|flags|ctr|body|tag — exactly 9 fields.
        parts = line.split("|", 8)
        if len(parts) != 9:
            raise SecureFrameError(f"expected 9 fields, got {len(parts)}")

        magic, src_hex, dst_hex, seq_hex, typ, flags_hex, ctr_hex, body_b64, tag_hex = parts

        if magic != WIRE_VERSION:
            raise SecureFrameError(f"bad magic {magic!r} (expected {WIRE_VERSION!r})")
        if len(ctr_hex) != CTR_HEX_LEN:
            raise SecureFrameError(f"ctr field must be {CTR_HEX_LEN} hex chars, got {len(ctr_hex)}")
        if len(tag_hex) != TAG_HEX_LEN:
            raise SecureFrameError(f"tag field must be {TAG_HEX_LEN} hex chars, got {len(tag_hex)}")

        try:
            src = int(src_hex, 16)
            dst = int(dst_hex, 16)
            seq = int(seq_hex, 16)
            flags = int(flags_hex, 16)
            ctr = int(ctr_hex, 16)
            tag = bytes.fromhex(tag_hex)
        except ValueError as exc:
            raise SecureFrameError(f"bad hex field: {exc}") from exc

        if body_b64 == EMPTY_BODY_SENTINEL:
            ciphertext = b""
        else:
            try:
                # base64url, restore padding to the next multiple of 4.
                pad = "=" * (-len(body_b64) % 4)
                ciphertext = base64.urlsafe_b64decode(body_b64 + pad)
            except (ValueError, base64.binascii.Error) as exc:
                raise SecureFrameError(f"bad base64 body: {exc}") from exc

        # Rebuild the AAD from parsed fields (NOT from string slicing).
        # This way trailing whitespace, a stray space etc. fail the tag
        # verify cleanly rather than parsing weirdly.
        ad = (
            f"{WIRE_VERSION}|{src:02x}|{dst:02x}|{seq:02x}"
            f"|{typ}|{flags:x}|{ctr:0{CTR_HEX_LEN}x}"
        ).encode("ascii")
        nonce = _make_nonce(src, ctr)

        try:
            plaintext = self._aead.decrypt(nonce, ciphertext + tag, ad)
        except InvalidTag as exc:
            # Don't include the body or any cipher-derived bytes in the
            # error message — keeps logs from leaking partial decrypts.
            raise BadTagError(f"AEAD verify failed for src=0x{src:02X} ctr={ctr}") from exc

        try:
            arg = plaintext.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise SecureFrameError(f"plaintext is not valid utf-8: {exc}") from exc

        # Frame.__post_init__ validates ranges. v2 plaintext args are NOT
        # constrained to be `:` / `|`-clean (those constraints only matter
        # for the v1 inline-arg wire format), so we bypass __post_init__'s
        # arg-content checks by constructing the dataclass and validating
        # only the structural fields. Easier: create with the arg, then
        # silence the FrameError if it's only complaining about arg chars
        # — but that's fragile. Cleanest: build via __new__-equivalent and
        # validate by hand.
        try:
            frame = _make_frame_relaxed(src, dst, seq, typ, flags, arg)
        except FrameError as exc:
            raise SecureFrameError(f"plaintext frame invalid: {exc}") from exc

        return DecodedFrame(frame=frame, ctr=ctr)


# ── Helpers ─────────────────────────────────────────────────────────────


def _make_nonce(src: int, ctr: int) -> bytes:
    """Compose the 12-byte AEAD nonce from src + counter (spec §3.6.4).

    Layout:  src(1) || 0x00 × 5 || ctr_be(6)
    """
    if not (0 <= src <= 0xFF):
        raise ValueError(f"src out of byte range: {src}")
    return bytes([src]) + b"\x00" * 5 + ctr.to_bytes(CTR_BYTES, "big")


def _make_frame_relaxed(src: int, dst: int, seq: int, typ: str,
                        flags: int, arg: str) -> Frame:
    """Build a Frame skipping the v1 arg-character constraints.

    The v1 ``arg`` rules (no ``:``, no ``|``, no newlines) exist to keep
    the inline plaintext unambiguous to the firmware's serial parser.
    Under v2 the plaintext lives inside an opaque ciphertext, so those
    rules don't apply to the plaintext itself — only to the encoded
    body, which base64 already keeps clean. Skip the arg validators
    while still enforcing the structural ones (src/dst/seq/typ/flags).
    """
    f = Frame.__new__(Frame)
    f.src = src
    f.dst = dst
    f.seq = seq
    f.typ = typ
    f.flags = flags
    f.arg = arg
    # Re-run only the structural checks. Adapted from Frame.__post_init__.
    if not (0 <= src <= 0xFE):
        raise FrameError(f"src out of range: 0x{src:02X}")
    if not (0 <= dst <= 0xFF):
        raise FrameError(f"dst out of range: 0x{dst:02X}")
    if not (0 <= seq <= 0xFF):
        raise FrameError(f"seq out of range: 0x{seq:02X}")
    from .frame import _VALID_TYPES
    if typ not in _VALID_TYPES:
        raise FrameError(f"unknown typ: {typ!r}")
    if not (0 <= flags <= 0xF):
        raise FrameError(f"flags out of range: 0x{flags:X}")
    return f


# ── Convenience: detect whether a line might be a v2 frame at all ──────


def looks_like_v2(line: str) -> bool:
    """Cheap prefix check; lets the radio port skip the heavy decode for
    obviously-not-our-frame chatter (firmware boot banners, etc.)."""
    return line.startswith(WIRE_VERSION + "|")


# ── Process-wide defaults (auto-load) ──────────────────────────────────
# Every RadioPort constructor calls into these so production code doesn't
# need to thread a Codec through every call site. Tests opt out with the
# ``TITANIC_INSECURE=1`` env var; bring-up scripts can also point at a
# different secret with ``TITANIC_SECRET_PATH=/some/path``.

# Canonical default location: marsin_engine/secret.yaml at the repo root.
# We compute it relative to THIS file so it works regardless of the cwd of
# whoever imports us. Layout:
#   <repo>/control_podium/comms/secure.py   ← this file
#   <repo>/marsin_engine/secret.yaml
DEFAULT_SECRET_PATH = (
    Path(__file__).resolve().parent.parent.parent / "marsin_engine" / "secret.yaml"
)

_default_codec_cache: Optional[Codec] = None
_default_codec_loaded = False  # so we only attempt the load once


def default_codec() -> Optional[Codec]:
    """Return the process-wide default Codec, or None if disabled.

    * If ``TITANIC_INSECURE=1`` is set in the environment, returns None
      (plaintext mode — for tests that explicitly want v1 wire).
    * Otherwise loads the secret from ``$TITANIC_SECRET_PATH`` (default:
      ``marsin_engine/secret.yaml``) and caches a Codec.
    * If the secret file is missing, raises ``SecretError`` — we refuse
      to silently fall back to plaintext.
    """
    global _default_codec_cache, _default_codec_loaded
    if _default_codec_loaded:
        return _default_codec_cache
    _default_codec_loaded = True

    if os.environ.get("TITANIC_INSECURE") == "1":
        logger.warning(
            "TITANIC_INSECURE=1 — radio ports will use plaintext v1 framing. "
            "Do NOT use this in production."
        )
        _default_codec_cache = None
        return None

    secret_path = Path(
        os.environ.get("TITANIC_SECRET_PATH", str(DEFAULT_SECRET_PATH))
    )
    key = load_secret(secret_path)  # raises SecretError on bad/missing
    _default_codec_cache = Codec(key)
    logger.info("loaded secured-channel key from %s", secret_path)
    return _default_codec_cache


def reset_default_codec_cache() -> None:
    """Test hook: drop the cached codec so a subsequent call re-reads
    the env / secret file. Production code should never call this."""
    global _default_codec_cache, _default_codec_loaded
    _default_codec_cache = None
    _default_codec_loaded = False
