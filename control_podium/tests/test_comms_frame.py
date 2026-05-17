"""
Unit tests for comms.frame.

Run hardware-free with:

    python -m pytest control_podium/tests/test_comms_frame.py -v --noconftest
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

BASE = Path(__file__).resolve().parent.parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from comms.frame import (
    BROADCAST,
    FLAG_ACK_REQUESTED,
    FLAG_PRIVILEGED,
    Frame,
    FrameError,
    SERVER_ID,
    TYPE_ACK,
    TYPE_CMD,
    TYPE_PUB,
    decode_kv,
    decode_path,
    encode_kv,
)


# ── encode/decode round-trip ──────────────────────────────────────────────


def test_encode_basic():
    f = Frame(src=0x0A, dst=0x01, seq=0x42, typ=TYPE_CMD,
              flags=FLAG_ACK_REQUESTED, arg="pattern/sunset")
    assert f.encode() == "T|0a|01|42|cmd|1|pattern/sunset"


def test_decode_basic():
    f = Frame.decode("T|0a|01|42|cmd|1|pattern/sunset")
    assert f.src == 0x0A
    assert f.dst == 0x01
    assert f.seq == 0x42
    assert f.typ == TYPE_CMD
    assert f.flags == FLAG_ACK_REQUESTED
    assert f.arg == "pattern/sunset"


def test_roundtrip_random_args():
    for arg in ["", "fps/40,pat/sunset,sp/0.7", "ok", "x/1/y/2"]:
        f = Frame(src=1, dst=2, seq=3, typ=TYPE_PUB, flags=0, arg=arg)
        assert Frame.decode(f.encode()) == f


def test_decode_empty_arg():
    f = Frame.decode("T|01|0a|99|pon|0|")
    assert f.arg == ""


def test_decode_arg_with_slashes_and_commas():
    f = Frame.decode("T|01|ff|99|pub|0|fps/40,pat/sunset/v2,sp/0.7")
    assert f.arg == "fps/40,pat/sunset/v2,sp/0.7"


# ── parser rejections ─────────────────────────────────────────────────────


def test_decode_garbage():
    with pytest.raises(FrameError):
        Frame.decode("hello world")


def test_decode_missing_magic():
    with pytest.raises(FrameError):
        Frame.decode("X|01|0a|99|pon|0|")


def test_decode_bad_hex():
    with pytest.raises(FrameError):
        Frame.decode("T|xx|01|42|cmd|1|x")


def test_decode_unknown_type():
    with pytest.raises(FrameError):
        Frame.decode("T|01|0a|99|xxx|0|")


# ── arg validation ────────────────────────────────────────────────────────


# NOTE: the ":" / "|" / "\n" arg restrictions are v1-encoder-level rules
# (the firmware's `RX:<payload>:RSSI=...` USB output and our `|`-delimited
# wire). Under v2 (secure.py) the arg lives inside ciphertext and base64,
# so plaintext can contain anything. The Frame dataclass therefore accepts
# any UTF-8 in arg; the rule fires when the v1 wire encoder runs.


def test_v1_encode_rejects_colon_in_arg():
    f = Frame(src=1, dst=2, seq=3, typ=TYPE_CMD, arg="titanic:scene:sunset")
    with pytest.raises(FrameError):
        f.encode()


def test_v1_encode_rejects_pipe_in_arg():
    f = Frame(src=1, dst=2, seq=3, typ=TYPE_CMD, arg="a|b")
    with pytest.raises(FrameError):
        f.encode()


def test_v1_encode_rejects_newline_in_arg():
    f = Frame(src=1, dst=2, seq=3, typ=TYPE_CMD, arg="a\nb")
    with pytest.raises(FrameError):
        f.encode()


def test_src_out_of_range():
    with pytest.raises(FrameError):
        Frame(src=0xFF, dst=0x01, seq=0, typ=TYPE_CMD)


# ── special IDs ───────────────────────────────────────────────────────────


def test_broadcast_dst_allowed():
    f = Frame(src=SERVER_ID, dst=BROADCAST, seq=0, typ=TYPE_PUB,
              arg="fps/40")
    assert f.encode() == "T|01|ff|00|pub|0|fps/40"
    assert f.is_broadcast()


def test_wants_ack():
    f = Frame(src=1, dst=2, seq=0, typ=TYPE_CMD,
              flags=FLAG_ACK_REQUESTED, arg="")
    assert f.wants_ack()
    f2 = Frame(src=1, dst=2, seq=0, typ=TYPE_CMD, flags=0, arg="")
    assert not f2.wants_ack()


# ── KV helpers ────────────────────────────────────────────────────────────


def test_encode_kv_basic():
    assert encode_kv({"fps": 40, "pat": "sunset"}) == "fps/40,pat/sunset"


def test_decode_kv_basic():
    assert decode_kv("fps/40,pat/sunset") == {"fps": "40", "pat": "sunset"}


def test_encode_kv_rejects_separator():
    with pytest.raises(FrameError):
        encode_kv({"key|with|pipe": 1})


def test_decode_kv_empty():
    assert decode_kv("") == {}


def test_decode_path():
    assert decode_path("pattern/sunset") == ("pattern", "sunset")
    assert decode_path("param/speed/0.7") == ("param", "speed", "0.7")
    assert decode_path("") == ()
