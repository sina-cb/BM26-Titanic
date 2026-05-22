#!/usr/bin/env python3
"""HIL: exercise every query/command PortWatch issues over LoRa.

This is NOT a pytest test — it's a standalone HIL probe that mirrors
what the iOS app does over BLE→radio. Run it to see, query-by-query,
which API endpoints are slow/unreliable on the current bench setup.

Output is a table:
  query/cmd          trials  ok   pct    rtt_p50  rtt_p95   rtt_max
  qry engine/status     8     7   87.5%   3010      4200      4500
  qry params            8     6   75.0%   3050      4100      4300
  ...

Usage
-----
    cd control_podium
    PYTHONPATH=. python -m tests.hil.hil_portwatch_api_exercise [--trials N]
"""
from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
import time
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from comms.frame import (
    Frame, FLAG_ACK_REQUESTED, FLAG_PRIVILEGED, SERVER_ID,
    TYPE_QRY, TYPE_CMD, TYPE_REP, TYPE_ACK,
)
from comms.radio_port_serial import RadioPortSerial
from companions.client_companion import Client


CAPTAIN_NODE_ID = 0x0A
CAPTAIN_ROLE = "captain"
CAPTAIN_PORT = "/dev/cu.usbmodem21101"


async def _single_call(client, radio, typ, arg, timeout_s):
    """Send one QRY or CMD, return (ok, rtt_ms, reply_arg_or_err)."""
    seq = client._next_seq()
    frame = Frame(
        src=CAPTAIN_NODE_ID, dst=SERVER_ID, seq=seq, typ=typ,
        flags=FLAG_ACK_REQUESTED | FLAG_PRIVILEGED,
        arg=arg,
    )
    fut = asyncio.get_running_loop().create_future()
    client._pending[seq] = fut
    t0 = time.monotonic()
    await radio.send(frame)
    try:
        reply = await asyncio.wait_for(fut, timeout=timeout_s)
        rtt_ms = int((time.monotonic() - t0) * 1000)
        # qry expects REP. cmd expects ACK ("ok") or NAK on failure.
        expected = TYPE_REP if typ == TYPE_QRY else TYPE_ACK
        if reply.typ == expected:
            return True, rtt_ms, reply.arg
        return False, rtt_ms, f"got type={reply.typ} arg={reply.arg!r}"
    except asyncio.TimeoutError:
        client._pending.pop(seq, None)
        return False, int(timeout_s * 1000), "TIMEOUT"


async def _trials(client, radio, label, typ, arg, n, timeout_s):
    """Run n trials of the same call, return summary dict."""
    results = []
    rtts_ok = []
    sample = None
    print(f"\n→ {label}  ({n} trials, timeout={timeout_s}s)")
    for i in range(1, n + 1):
        ok, rtt, payload = await _single_call(client, radio, typ, arg, timeout_s)
        results.append(ok)
        if ok:
            rtts_ok.append(rtt)
            sample = payload
            print(f"  [{i:>2}/{n}] OK   rtt={rtt}ms  payload={payload[:80]!r}{'…' if len(payload) > 80 else ''}")
        else:
            print(f"  [{i:>2}/{n}] FAIL {payload}  (rtt={rtt}ms)")
        # Match PortWatch's natural cadence: small gap between polls so
        # we don't hammer the link with back-to-back frames.
        await asyncio.sleep(1.5)
    ok_count = sum(results)
    pct = 100.0 * ok_count / n
    summary = {
        "label": label,
        "n": n,
        "ok": ok_count,
        "pct": pct,
        "rtt_p50": int(statistics.median(rtts_ok)) if rtts_ok else None,
        "rtt_p95": int(statistics.quantiles(rtts_ok, n=20)[18]) if len(rtts_ok) >= 2 else (rtts_ok[0] if rtts_ok else None),
        "rtt_max": max(rtts_ok) if rtts_ok else None,
        "sample": sample,
    }
    return summary


async def _run(trials):
    radio = RadioPortSerial(port=CAPTAIN_PORT, baud=115200, name="hil-pw")
    client = Client(radio=radio, node_id=CAPTAIN_NODE_ID,
                    role=CAPTAIN_ROLE, subscribe_pubs=True)
    await radio.open()
    rx_task = asyncio.create_task(client.rx_loop())

    summaries = []
    try:
        print("HLO …")
        await client.hello()
        await asyncio.sleep(0.5)

        # PortWatch's read paths — timeouts bumped from PortWatch
        # defaults (6 / 12 s) to fit observed RTT distribution on this
        # rig (median 4-5 s after the 3x redundant TX firmware fix).
        summaries.append(await _trials(
            client, radio, "qry engine/status",
            TYPE_QRY, "engine/status", trials, 10.0))
        summaries.append(await _trials(
            client, radio, "qry params",
            TYPE_QRY, "params", trials, 10.0))
        summaries.append(await _trials(
            client, radio, "qry playlists/p/0",
            TYPE_QRY, "playlists/p/0", trials, 15.0))
        summaries.append(await _trials(
            client, radio, "qry engine/get-playlist-patterns/default/p/0",
            TYPE_QRY, "engine/get-playlist-patterns/default/p/0", trials, 15.0))
        summaries.append(await _trials(
            client, radio, "qry exports/p/0",
            TYPE_QRY, "exports/p/0", trials, 10.0))

        # PortWatch's write paths — fewer trials, just smoke
        summaries.append(await _trials(
            client, radio, "cmd param/speed/0.42",
            TYPE_CMD, "param/speed/0.42", max(2, trials // 2), 10.0))
        # Use a pattern that almost certainly exists on the engine.
        summaries.append(await _trials(
            client, radio, "cmd pattern/00_golden_hour_wash",
            TYPE_CMD, "pattern/00_golden_hour_wash", max(2, trials // 2), 10.0))
    finally:
        rx_task.cancel()
        try:
            await rx_task
        except (asyncio.CancelledError, Exception):
            pass
        await radio.close()

    # Table
    print()
    print("=" * 84)
    print(f"{'endpoint':<54} {'ok/N':>8} {'pct':>6} {'p50':>6} {'p95':>6} {'max':>6}")
    print("-" * 84)
    for s in summaries:
        p50 = f"{s['rtt_p50']}" if s["rtt_p50"] is not None else "—"
        p95 = f"{s['rtt_p95']}" if s["rtt_p95"] is not None else "—"
        mx  = f"{s['rtt_max']}" if s["rtt_max"] is not None else "—"
        print(f"{s['label']:<54} {s['ok']:>3}/{s['n']:<4} {s['pct']:>5.1f}% {p50:>6} {p95:>6} {mx:>6}")
    print("=" * 84)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=6, help="trials per endpoint (default 6)")
    args = ap.parse_args()
    asyncio.run(_run(args.trials))


if __name__ == "__main__":
    main()
