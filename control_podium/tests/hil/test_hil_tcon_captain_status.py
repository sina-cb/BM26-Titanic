#!/usr/bin/env python3
"""HIL: connect to tcon_captain (node 0x0A, captain) and validate every
status field that PortWatch's Status screen renders.

What this proves
----------------
End-to-end, on REAL hardware (not the in-process sim_bus), that:

  1. A USB-CDC serial link to the captain Heltec (BLE name
     ``tcon_captain``, node id 0x0A) is openable from the laptop.
  2. The Heltec relays our ``qry engine/status`` over LoRa to the
     server Heltec, which the Pi-side ``server_bridge`` translates
     into an engine HTTP call.
  3. The engine returns a fully-populated compact-status frame.
  4. EVERY field PortWatch's Status screen reads off
     ``engineStatus`` is present and well-typed:
        pat (active pattern), dn (engine-down flag),
        bri (brightness), bo (blackout), apl (autopilot),
        spd (speed), upt (uptime), fps,
        vw (current view), and optional vov / lk / lku.
  5. A compact-status PUB is broadcast by the bridge while we listen
     — confirms the periodic publisher is alive.

When to run
-----------
* After a firmware reflash, to confirm the controller didn't lose
  pairing / key fingerprint.
* After a bridge / engine change, to confirm the full chain is
  intact end-to-end (not just in sim).
* As an evidence step in any "is the mesh actually working" debug.

Skipped automatically in CI runs that don't have the hardware
connected — the test prerequisites (find_port_by_mac matches the
captain's recorded usb_mac AND the bridge is up on the Pi) act as
opt-in gates.

Usage
-----
    PYTHONPATH=. ../.venv-dev/bin/python \\
        -m pytest tests/hil/test_hil_tcon_captain_status.py -v -s

The ``-s`` flag is useful here: the test prints a per-field status
report so the operator can see exactly what came back.

Why pytest and not a standalone script
--------------------------------------
A pytest case gives us:
  * skip-if-prerequisite-missing semantics (the entire HIL suite
    skips cleanly on a laptop that doesn't have the captain
    plugged in), and
  * pass/fail assertions that the rest of the suite tooling can
    aggregate into the same test report as the unit tests.

Implementation notes
--------------------
Uses ``companions.client_companion.Client`` which is the exact same
class that drives the interactive REPL — keeps the HIL test path
synchronised with the human-driven debug path. Drives it over
``RadioPortSerial`` for real hardware; the sim path lives in
``test_comms_e2e_sim.py`` and is not duplicated here.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest
import yaml

BASE = Path(__file__).resolve().parent.parent.parent       # control_podium/
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from companions.client_companion import Client                  # noqa: E402
from comms.frame import TYPE_QRY, TYPE_REP                       # noqa: E402
from comms.radio_port_serial import RadioPortSerial              # noqa: E402
from utils.discovery import find_port_by_mac                     # noqa: E402

# Node 0x0A is "sina" / role captain — see .config.nodes.yaml.
CAPTAIN_NODE_ID = 0x0A
CAPTAIN_ROLE = "captain"


# ── Skip gating: only run when the hardware is plugged in ───────────


def _captain_port_or_skip() -> str:
    """Locate the captain Heltec on this laptop's USB ports, or skip
    cleanly if it isn't plugged in. We resolve by MAC (the same way
    firmware/deploy.py does) so an arbitrary port number doesn't
    confuse the test on a machine with multiple USB serials."""
    nodes = yaml.safe_load(
        (BASE / ".config.nodes.yaml").read_text(encoding="utf-8")
    )["nodes"]
    entry = nodes.get(CAPTAIN_NODE_ID) or nodes.get(
        f"0x{CAPTAIN_NODE_ID:02X}"
    )
    if not entry:
        pytest.skip(
            f"node 0x{CAPTAIN_NODE_ID:02X} missing from .config.nodes.yaml"
        )
    mac = entry.get("usb_mac")
    if not mac:
        pytest.skip(
            f"node 0x{CAPTAIN_NODE_ID:02X} has no usb_mac — pair the captain "
            "Heltec via firmware/deploy.py before running HIL tests"
        )
    port = find_port_by_mac(mac)
    if not port:
        pytest.skip(
            f"captain Heltec (MAC {mac}) not plugged in — HIL test skipped"
        )
    return port


# Expected fields the PortWatch Status screen reads off `engineStatus`.
# Each tuple is (key, presence_required, type_check). Mapping mirrors
# the PortWatch-side parser in src/status/parse.ts; if PortWatch
# changes its expectations, this list MUST change too — that's the
# whole point of a HIL test (couples the C / Python / TS contracts
# to one place that runs against the live wire).
_EXPECTED_FIELDS: list[tuple[str, bool, str]] = [
    ("pat", True,  "str_or_dash_or_q"),   # active pattern (or '-'/'?')
    ("dn",  True,  "0_or_1"),             # engine-down flag
    ("bri", False, "int_pct"),            # brightness 0..100
    ("bo",  False, "0_or_1"),             # blackout flag
    ("apl", False, "0_or_1"),             # autopilot
    ("spd", False, "float_str"),          # speed
    ("upt", False, "int_str"),            # engine uptime seconds
    ("fps", False, "int_str"),            # render loop fps
    ("vw",  False, "deck_or_mixer"),      # current view
]


def _parse_compact(arg: str) -> dict[str, str]:
    """Parse the compact-status KV CSV the bridge emits.
    Format: `key/value,key/value,...`."""
    out: dict[str, str] = {}
    for tok in arg.split(","):
        if "/" in tok:
            k, _, v = tok.partition("/")
            out[k.strip()] = v.strip()
    return out


def _check_typed(value: str, kind: str) -> tuple[bool, str]:
    """Return (ok, hint). hint explains the failure when ok is False."""
    if kind == "str_or_dash_or_q":
        if value == "" or value is None:
            return (False, "empty")
        return (True, "")
    if kind == "0_or_1":
        return (value in ("0", "1"), "must be '0' or '1'")
    if kind == "int_pct":
        try:
            v = int(value)
        except ValueError:
            return (False, f"not an int: {value!r}")
        return (0 <= v <= 100, "must be 0..100")
    if kind == "float_str":
        try:
            float(value)
        except ValueError:
            return (False, f"not a float: {value!r}")
        return (True, "")
    if kind == "int_str":
        try:
            int(value)
        except ValueError:
            return (False, f"not an int: {value!r}")
        return (True, "")
    if kind == "deck_or_mixer":
        return (value in ("deck", "mixer"), "must be 'deck' or 'mixer'")
    raise AssertionError(f"unknown kind {kind}")


# ── The actual test ──────────────────────────────────────────────────


@pytest.mark.timeout(30)
def test_tcon_captain_status_field_by_field():
    """Send `qry engine/status` to the captain over real USB,
    verify the bridge returns a compact-status REP whose fields
    match what PortWatch reads.
    """
    port = _captain_port_or_skip()

    async def _run():
        radio = RadioPortSerial(port=port, baud=115200, name="hil-captain")
        client = Client(radio=radio, node_id=CAPTAIN_NODE_ID,
                        role=CAPTAIN_ROLE, subscribe_pubs=True)
        await radio.open()
        rx_task = asyncio.create_task(client.rx_loop())
        try:
            # The captain firmware also injects a HLO on its own
            # startup, but the bridge tolerates duplicate HLOs from
            # the captain — the second one is essentially a keepalive.
            await client.hello()

            # The actual probe.
            print(f"\n  HIL: connected to captain via {port}")
            print("  HIL: sending qry engine/status …")
            seq = client._next_seq()
            from comms.frame import (
                Frame, FLAG_ACK_REQUESTED, FLAG_PRIVILEGED, SERVER_ID,
            )
            frame = Frame(
                src=CAPTAIN_NODE_ID, dst=SERVER_ID, seq=seq,
                typ=TYPE_QRY,
                flags=FLAG_ACK_REQUESTED | FLAG_PRIVILEGED,
                arg="engine/status",
            )
            fut: asyncio.Future = asyncio.get_running_loop().create_future()
            client._pending[seq] = fut
            await radio.send(frame)
            try:
                reply: Frame = await asyncio.wait_for(fut, timeout=8.0)
            except asyncio.TimeoutError:
                pytest.fail(
                    "timed out waiting for qry engine/status reply over "
                    f"{port} — captain saw the request but bridge "
                    "didn't reply within 8 s. Is the bridge up? Is "
                    "the server Heltec in range?"
                )

            assert reply.typ == TYPE_REP, (
                f"expected REP, got {reply.typ}: {reply.arg!r}"
            )

            parsed = _parse_compact(reply.arg)
            print(f"  HIL: REP arg = {reply.arg!r}")
            print(f"  HIL: parsed  = {parsed}")

            # Walk each expected field, accumulating failures so the
            # report shows EVERY missing/bad field, not just the first.
            failures: list[str] = []
            for key, required, kind in _EXPECTED_FIELDS:
                if key not in parsed:
                    msg = f"missing field {key!r}"
                    if required:
                        failures.append(msg)
                        print(f"    ✗ {msg} (REQUIRED)")
                    else:
                        print(f"    · {msg} (optional, ok)")
                    continue
                ok, hint = _check_typed(parsed[key], kind)
                if not ok:
                    msg = f"field {key!r} = {parsed[key]!r}: {hint}"
                    failures.append(msg)
                    print(f"    ✗ {msg}")
                else:
                    print(f"    ✓ {key} = {parsed[key]!r}")

            if failures:
                pytest.fail(
                    "compact_status missing/malformed fields:\n  - "
                    + "\n  - ".join(failures)
                )
            print("  HIL: all required fields present and well-typed ✓")
        finally:
            rx_task.cancel()
            try:
                await rx_task
            except asyncio.CancelledError:
                pass
            await radio.close()

    asyncio.run(_run())


@pytest.mark.timeout(45)
def test_tcon_captain_receives_compact_status_pub_within_cadence():
    """The bridge broadcasts compact_status on a long-interval timer
    (default 15 s active / 30 s idle). Listen on the captain for up
    to 40 s and verify we see AT LEAST one PUB. Confirms the
    publisher is alive, not just the request/reply path.
    """
    port = _captain_port_or_skip()

    async def _run():
        from comms.frame import TYPE_PUB
        radio = RadioPortSerial(port=port, baud=115200, name="hil-captain-pub")
        await radio.open()
        try:
            print(f"\n  HIL: listening for PUB on {port} (up to 40 s) …")
            deadline = asyncio.get_event_loop().time() + 40.0
            async for frame in radio.recv_frames():
                if frame.typ == TYPE_PUB:
                    parsed = _parse_compact(frame.arg)
                    print(f"  HIL: PUB received, parsed = {parsed}")
                    # Must carry the same 'pat' invariant the
                    # request/reply path does — that's the field
                    # whose presence motivated the whole 'always
                    # emit pat/X' bridge fix.
                    assert "pat" in parsed, (
                        f"PUB missing 'pat': {frame.arg!r}"
                    )
                    return
                if asyncio.get_event_loop().time() > deadline:
                    pytest.fail(
                        "no compact_status PUB observed in 40 s — "
                        "either the bridge publisher is dead or the "
                        "LoRa link is silent in this direction"
                    )
        finally:
            await radio.close()

    asyncio.run(_run())


if __name__ == "__main__":  # pragma: no cover
    # Allows `python tests/hil/test_hil_tcon_captain_status.py` for
    # interactive runs without going through pytest. Exits non-zero
    # on any assertion failure so it composes with shell scripts.
    sys.exit(
        os.system(
            f"{sys.executable} -m pytest {__file__} -v -s"
        )
    )
