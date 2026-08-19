"""
Unit tests for the v2 secured-frame codec (comms/secure.py).

Coverage:

* round-trip encode/decode under the same key
* wrong key fails as BadTagError (silent-drop)
* tampered ciphertext fails as BadTagError
* tampered AAD (header bits) fails as BadTagError
* malformed wire fails as SecureFrameError
* counter and nonce structure (sanity vs spec §3.6.4)
* SHA-256 short-key derivation matches the firmware-side rule
* loader: key (string) and key_hex (32 hex chars) and rejects garbage
"""

from __future__ import annotations

import base64
import hashlib
from pathlib import Path

import pytest

from control_podium.comms.frame import (
    Frame,
    SERVER_ID,
    TYPE_CMD,
    TYPE_HLO,
    TYPE_PUB,
)
from control_podium.comms.secure import (
    BadTagError,
    Codec,
    DEFAULT_SECRET_PATH,
    KEY_BYTES,
    SecretError,
    SecureFrameError,
    WIRE_VERSION,
    _make_nonce,
    load_secret,
    looks_like_v2,
)


def _key(s: str = "test-key") -> bytes:
    """Deterministic key for tests — same derivation as load_secret(`key:` ...)."""
    return hashlib.sha256(s.encode()).digest()[:KEY_BYTES]


def _frame(arg: str = "pattern/sunset") -> Frame:
    return Frame(src=0x0A, dst=SERVER_ID, seq=0x42, typ=TYPE_CMD, flags=0x1, arg=arg)


# ── Round trip ────────────────────────────────────────────────────────────


def test_round_trip_basic():
    codec = Codec(_key())
    f = _frame()
    line = codec.encode(f, ctr=1)
    decoded = codec.decode(line)
    assert decoded.frame.src == f.src
    assert decoded.frame.dst == f.dst
    assert decoded.frame.typ == f.typ
    assert decoded.frame.arg == f.arg
    assert decoded.ctr == 1


def test_round_trip_empty_arg():
    """Empty plaintext should still round-trip; body becomes the `-` sentinel."""
    codec = Codec(_key())
    f = Frame(src=SERVER_ID, dst=0x0A, seq=0x99, typ="pon", arg="")
    line = codec.encode(f, ctr=7)
    assert "|-|" in line  # body is the empty-sentinel
    decoded = codec.decode(line)
    assert decoded.frame.arg == ""


def test_round_trip_unicode_payload():
    """v2 plaintext is no longer constrained to ASCII; full UTF-8 OK."""
    codec = Codec(_key())
    arg = "fps/40,pat/sunset,note/⚠️ on-fire"
    f = Frame(src=SERVER_ID, dst=0xFF, seq=0x00, typ=TYPE_PUB, arg=arg)
    line = codec.encode(f, ctr=0xDEADBE)
    assert codec.decode(line).frame.arg == arg


def test_v2_plaintext_can_contain_colon_and_pipe():
    """The v1 'no : no |' rule was about firmware serial parsing of
    inline plaintext; under v2 the plaintext is inside ciphertext, so
    these characters are fine."""
    codec = Codec(_key())
    f = Frame(src=0x0A, dst=SERVER_ID, seq=0, typ=TYPE_CMD, arg="x:y|z")
    line = codec.encode(f, ctr=2)
    assert codec.decode(line).frame.arg == "x:y|z"


# ── Wire-format sanity ────────────────────────────────────────────────────


def test_wire_starts_with_t2():
    codec = Codec(_key())
    line = codec.encode(_frame(), ctr=1)
    assert line.startswith(WIRE_VERSION + "|")
    assert looks_like_v2(line)
    assert not looks_like_v2("T|0a|...")  # v1 frames are NOT v2


def test_wire_field_count_is_nine():
    codec = Codec(_key())
    line = codec.encode(_frame(), ctr=1)
    parts = line.split("|")
    # T2 | src | dst | seq | typ | flags | ctr | body | tag = 9 fields
    assert len(parts) == 9


def test_ctr_is_12_hex_chars_be():
    codec = Codec(_key())
    line = codec.encode(_frame(), ctr=0x1234_5678_9ABC)
    ctr_field = line.split("|")[6]
    assert len(ctr_field) == 12
    assert ctr_field == "12345678 9abc".replace(" ", "")


def test_tag_is_32_hex_chars():
    codec = Codec(_key())
    line = codec.encode(_frame(), ctr=1)
    tag_field = line.split("|")[8]
    assert len(tag_field) == 32
    assert all(c in "0123456789abcdef" for c in tag_field)


def test_nonce_layout_matches_spec():
    """src(1) || 0×5 || ctr_be(6) — must match what the firmware computes."""
    nonce = _make_nonce(0x0A, 0x1234_5678_9ABC)
    assert len(nonce) == 12
    assert nonce[0] == 0x0A
    assert nonce[1:6] == b"\x00\x00\x00\x00\x00"
    assert nonce[6:] == bytes.fromhex("123456789abc")


# ── Negative paths (these are the security-critical ones) ────────────────


def test_wrong_key_fails_silently():
    """Decoding under a different key MUST raise BadTagError, not return
    a plausible-but-wrong frame."""
    sender = Codec(_key("alice"))
    line = sender.encode(_frame(), ctr=1)
    receiver = Codec(_key("eve"))
    with pytest.raises(BadTagError):
        receiver.decode(line)


def test_tampered_body_fails_with_bad_tag():
    codec = Codec(_key())
    line = codec.encode(_frame("pattern/sunset"), ctr=1)
    parts = line.split("|")
    # Flip a single base64 char in the body. If body is shorter we'll touch
    # whatever's there — point is, any change in ciphertext → tag fail.
    body = list(parts[7])
    body[0] = "Z" if body[0] != "Z" else "Y"
    parts[7] = "".join(body)
    bad = "|".join(parts)
    with pytest.raises(BadTagError):
        codec.decode(bad)


def test_tampered_aad_fails_with_bad_tag():
    """Header is in the AAD — flipping the src byte must fail the tag."""
    codec = Codec(_key())
    line = codec.encode(_frame(), ctr=1)
    parts = line.split("|")
    parts[1] = "0b" if parts[1] != "0b" else "0c"  # flip src
    with pytest.raises(BadTagError):
        codec.decode("|".join(parts))


def test_tampered_ctr_fails_with_bad_tag():
    """Counter is part of nonce AND AAD. Bumping it must fail the tag."""
    codec = Codec(_key())
    line = codec.encode(_frame(), ctr=1)
    parts = line.split("|")
    parts[6] = "ffffffffffff"  # max counter
    with pytest.raises(BadTagError):
        codec.decode("|".join(parts))


def test_tampered_tag_fails():
    codec = Codec(_key())
    line = codec.encode(_frame(), ctr=1)
    parts = line.split("|")
    parts[8] = "0" * 32
    with pytest.raises(BadTagError):
        codec.decode("|".join(parts))


def test_v1_frame_rejected_as_bad_magic():
    codec = Codec(_key())
    with pytest.raises(SecureFrameError) as exc:
        codec.decode("T|0a|01|42|cmd|1|pattern/sunset")
    assert "magic" in str(exc.value).lower() or "9 fields" in str(exc.value)


def test_garbage_rejected_silently():
    codec = Codec(_key())
    for junk in ["", "xxx", "T2|onlyone", "T2|0a", "BLE: paired", "RX:foo"]:
        with pytest.raises(SecureFrameError):
            codec.decode(junk)


def test_short_ctr_field_rejected():
    codec = Codec(_key())
    line = codec.encode(_frame(), ctr=1)
    parts = line.split("|")
    parts[6] = parts[6][:8]  # truncate ctr from 12 hex to 8
    with pytest.raises(SecureFrameError):
        codec.decode("|".join(parts))


# ── Counter behavior ─────────────────────────────────────────────────────


def test_auto_counter_monotone():
    codec = Codec(_key())
    f = _frame()
    a = codec.decode(codec.encode(f)).ctr
    b = codec.decode(codec.encode(f)).ctr
    c = codec.decode(codec.encode(f)).ctr
    assert a < b < c


def test_explicit_counter_passes_through():
    codec = Codec(_key())
    line = codec.encode(_frame(), ctr=42)
    assert codec.decode(line).ctr == 42


def test_counter_out_of_range_rejected():
    codec = Codec(_key())
    with pytest.raises(ValueError):
        codec.encode(_frame(), ctr=-1)
    with pytest.raises(ValueError):
        codec.encode(_frame(), ctr=1 << 48)


# ── Secret loader ────────────────────────────────────────────────────────


def test_load_secret_string_key(tmp_path):
    p = tmp_path / "secret.yaml"
    p.write_text('key: "SECRET"\nversion: 1\n')
    key = load_secret(p)
    assert key == hashlib.sha256(b"SECRET").digest()[:KEY_BYTES]


def test_load_secret_hex_key(tmp_path):
    p = tmp_path / "secret.yaml"
    hex_val = "00112233445566778899aabbccddeeff"
    p.write_text(f'key_hex: "{hex_val}"\nversion: 1\n')
    key = load_secret(p)
    assert key == bytes.fromhex(hex_val)


# ── Wire-size budget regression ───────────────────────────────────────
# These pin down the SX1262 max-payload constraint in code so future bridge
# changes that bloat reply args (e.g. another ",".join([...])[:N]) get
# caught at unit-test time rather than during HIL.

# SX1262 LoRa payload max is 255 bytes; we leave margin for any radio-side
# preamble / header byte counting differences and target ≤ 220 here.
SX1262_SAFE_MAX = 220


def test_v2_115byte_plaintext_fits_sx1262_budget():
    """Bridge truncates the engine/patterns reply to ≤115 plaintext bytes
    so that the AEAD-wrapped frame stays under SX1262_SAFE_MAX. This
    test asserts the math directly so a future bump of the truncation
    budget can't silently break the link."""
    key = hashlib.sha256(b"SECRET").digest()[:KEY_BYTES]
    codec = Codec(key)
    # Worst case: 115 bytes of pattern names + the "+N" suffix ~3 bytes.
    plaintext = "a" * 115
    f = Frame(src=0x01, dst=0x0A, seq=0x10, typ="rep", flags=0, arg=plaintext)
    line = codec.encode(f)
    assert len(line) <= SX1262_SAFE_MAX, (
        f"v2-encoded patterns reply is {len(line)} bytes "
        f"(must be ≤ {SX1262_SAFE_MAX}); "
        f"the bridge truncation budget in comms/bridge.py is too high."
    )


def test_v2_140byte_plaintext_overruns_sx1262_budget():
    """Sanity: with 140 bytes of plaintext the AEAD-wrapped frame DOES
    exceed our safe budget. Codifies why the bridge truncates at 115."""
    key = hashlib.sha256(b"SECRET").digest()[:KEY_BYTES]
    codec = Codec(key)
    plaintext = "a" * 140
    f = Frame(src=0x01, dst=0x0A, seq=0x10, typ="rep", flags=0, arg=plaintext)
    line = codec.encode(f)
    assert len(line) > SX1262_SAFE_MAX, (
        f"unexpectedly: 140-byte plaintext wraps to only {len(line)} bytes; "
        f"the bridge truncation budget could be raised."
    )


def test_load_secret_hex_takes_precedence(tmp_path):
    """If both key and key_hex are present, key_hex wins (production knob)."""
    p = tmp_path / "secret.yaml"
    p.write_text('key: "ignored"\nkey_hex: "00112233445566778899aabbccddeeff"\nversion: 1\n')
    assert load_secret(p) == bytes.fromhex("00112233445566778899aabbccddeeff")


def test_load_secret_missing_file(tmp_path):
    with pytest.raises(SecretError) as exc:
        load_secret(tmp_path / "nope.yaml")
    assert "missing" in str(exc.value).lower()


def test_load_secret_unsupported_version(tmp_path):
    p = tmp_path / "secret.yaml"
    p.write_text('key: "x"\nversion: 999\n')
    with pytest.raises(SecretError) as exc:
        load_secret(p)
    assert "version" in str(exc.value).lower()


def test_load_secret_short_hex(tmp_path):
    p = tmp_path / "secret.yaml"
    p.write_text('key_hex: "deadbeef"\nversion: 1\n')
    with pytest.raises(SecretError) as exc:
        load_secret(p)
    assert "16" in str(exc.value) or "byte" in str(exc.value).lower()


def test_repo_default_secret_loads():
    """The repo ships a dev marsin_engine/secret.yaml with key='SECRET'.
    Sanity-check that the canonical path resolves and the loader is happy
    with it."""
    if not DEFAULT_SECRET_PATH.exists():
        pytest.skip(
            f"no shared-secret at {DEFAULT_SECRET_PATH} "
            "(dev-only file; copy marsin_engine/secret.yaml.example)"
        )
    key = load_secret(DEFAULT_SECRET_PATH)
    assert key == hashlib.sha256(b"SECRET").digest()[:KEY_BYTES]
