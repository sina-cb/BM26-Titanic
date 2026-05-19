#!/usr/bin/env python3
"""HIL: measure end-to-end link reliability between captain and bridge.

What this proves
----------------
The single-shot ``test_hil_tcon_captain_status.py`` confirms ONE
``qry engine/status`` round-trip works. That's not enough evidence to
say the link is "reliable" — it just proves it's "occasionally
reachable". This test runs many round-trips back-to-back and reports:

  * Packet loss percentage (timeout / total).
  * RTT mean / p50 / p95 / max (ms).
  * RSSI mean / min / max (dBm) — the captain-side view of the link.
  * SNR mean / min / max (dB).
  * Compact-status validity rate (all required fields present).

Use it as the canonical "did my firmware change make the link better
or worse?" instrument. The numbers it spits out are exactly what the
final report needs.

Why pytest and not a standalone CLI
-----------------------------------
Same skip-gating as the other HIL tests: laptops without the captain
plugged in skip cleanly. The test fails ONLY on a hard threshold
(default: ≥80% delivery), so a developer can run the whole HIL suite
locally without it false-failing on a bad antenna day. Tune the
thresholds via env vars (HIL_MIN_DELIVERY_PCT, HIL_TRIALS) when you
want to gate a merge on a higher bar.

Usage
-----
    # Defaults: 30 trials, fail if <80% delivery.
    PYTHONPATH=. ../.venv-dev/bin/python \\
        -m pytest tests/hil/test_hil_link_reliability.py -v -s

    # Heavier soak — 100 trials, fail under 90%.
    HIL_TRIALS=100 HIL_MIN_DELIVERY_PCT=90 \\
        PYTHONPATH=. ../.venv-dev/bin/python \\
        -m pytest tests/hil/test_hil_link_reliability.py -v -s
"""
from __future__ import annotations

import asyncio
import os
import statistics
import sys
import time
from pathlib import Path

import pytest
import yaml

BASE = Path(__file__).resolve().parent.parent.parent       # control_podium/
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from companions.client_companion import Client                  # noqa: E402
from comms.frame import (                                       # noqa: E402
    Frame, FLAG_ACK_REQUESTED, FLAG_PRIVILEGED, SERVER_ID,
    TYPE_HLO, TYPE_QRY, TYPE_REP,
)
from comms.radio_port_serial import RadioPortSerial              # noqa: E402
from utils.discovery import find_port_by_mac                     # noqa: E402

CAPTAIN_NODE_ID = 0x0A
CAPTAIN_ROLE = "captain"

# How many round-trips to attempt. 30 is a defensible minimum sample
# size for a delivery-rate estimate (95% CI half-width ≈ ±15% at
# p̂=0.8). Bump via env for a soak test.
DEFAULT_TRIALS = 30
DEFAULT_MIN_DELIVERY_PCT = 80
# Per-trial timeout. SF=10 / BW=125 round-trips routinely land at ~3 s but
# can collide with bridge PUBs on a half-duplex link — allow slack so a
# late REP still counts as success (delivery vs latency thresholds differ).
PER_TRIAL_TIMEOUT_S = float(
    os.environ.get("HIL_PER_TRIAL_TIMEOUT_S", "40.0")
)
# Spacing between trials — must clear any in-flight compact_status + avoid
# back-to-back qry pounding the same SF10 airtime bucket.
INTER_TRIAL_GAP_S = float(os.environ.get("HIL_INTER_TRIAL_GAP_S", "6.0"))
# `Client.hello()` uses a fixed 4 s ack timeout — too short for long-
# airtime LoRa. HLO must complete before the soak or the bridge replay
# window may not see this captain.
# SF10/BW125 can need several seconds airtime plus USB + bridge jitter.
HLO_ACK_TIMEOUT_S = float(os.environ.get("HIL_HLO_ACK_TIMEOUT_S", "55.0"))


def _captain_port_or_skip() -> str:
    nodes = yaml.safe_load(
        (BASE / ".config.nodes.yaml").read_text(encoding="utf-8")
    )["nodes"]
    entry = nodes.get(CAPTAIN_NODE_ID) or nodes.get(
        f"0x{CAPTAIN_NODE_ID:02X}"
    )
    if not entry or not entry.get("usb_mac"):
        pytest.skip(
            "captain (node 0x0A) not configured in .config.nodes.yaml"
        )
    port = find_port_by_mac(entry["usb_mac"])
    if not port:
        pytest.skip(
            f"captain Heltec (MAC {entry['usb_mac']}) not plugged in"
        )
    return port


async def _hlo_long_ack(client: Client, radio: RadioPortSerial) -> None:
    """Send `hlo` with an ack timeout sized for slow LoRa (SF10, etc.)."""
    seq = client._next_seq()
    frame = Frame(
        src=CAPTAIN_NODE_ID,
        dst=SERVER_ID,
        seq=seq,
        typ=TYPE_HLO,
        flags=FLAG_ACK_REQUESTED | FLAG_PRIVILEGED,
        arg=f"name/node{CAPTAIN_NODE_ID:02x}",
    )
    loop = asyncio.get_running_loop()
    fut: asyncio.Future = loop.create_future()
    client._pending[seq] = fut
    await radio.send(frame)
    await asyncio.wait_for(fut, timeout=HLO_ACK_TIMEOUT_S)


def _compact_status_rep_ok(reply: Frame) -> bool:
    """True when the REP matches the bridge/engine compact_status wire
    contract: always carries ``pat/`` OR ``dn/`` (never both required)."""
    if reply.typ != TYPE_REP:
        return False
    a = reply.arg
    return "pat/" in a or "dn/" in a


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return float("nan")
    vs = sorted(values)
    idx = max(0, min(len(vs) - 1, int(len(vs) * pct / 100.0)))
    return vs[idx]


_TRIALS_ENV = int(os.environ.get("HIL_TRIALS", str(DEFAULT_TRIALS)))
_PER_TRIAL_TO = float(os.environ.get("HIL_PER_TRIAL_TIMEOUT_S", "40.0"))
_INTER_GAP = float(os.environ.get("HIL_INTER_TRIAL_GAP_S", "6.0"))
_HLO_ACK_ENV = float(os.environ.get("HIL_HLO_ACK_TIMEOUT_S", "55.0"))
# Post-hlo sleep inside _run() before the soak loop (bridge replay settle).
_POST_HLO_SETTLE_S = 2.0
_TRIAL_BUDGET = int(
    _HLO_ACK_ENV
    + _POST_HLO_SETTLE_S
    + _TRIALS_ENV * (_PER_TRIAL_TO + _INTER_GAP)
    + 180
)


@pytest.mark.timeout(_TRIAL_BUDGET)
def test_hil_link_reliability_statistics():
    """Drive N back-to-back ``qry engine/status`` round-trips and
    report aggregate link statistics. Fails only on a hard delivery-
    rate threshold (default 80 %) — the rich stats go to stdout.
    """
    port = _captain_port_or_skip()
    trials = int(os.environ.get("HIL_TRIALS", DEFAULT_TRIALS))
    min_delivery_pct = float(
        os.environ.get("HIL_MIN_DELIVERY_PCT", DEFAULT_MIN_DELIVERY_PCT)
    )
    min_valid_pct = float(
        os.environ.get("HIL_MIN_VALID_COMPACT_PCT", "90")
    )
    max_rtt_p95_ms = os.environ.get("HIL_MAX_RTT_P95_MS")
    min_rssi_mean = os.environ.get("HIL_MIN_RSSI_MEAN_DBM")
    min_snr_mean = os.environ.get("HIL_MIN_SNR_MEAN_DB")

    async def _run():
        radio = RadioPortSerial(port=port, baud=115200, name="hil-soak")
        client = Client(radio=radio, node_id=CAPTAIN_NODE_ID,
                        role=CAPTAIN_ROLE, subscribe_pubs=True)
        await radio.open()
        rx_task = asyncio.create_task(client.rx_loop())
        rtt_ms: list[float] = []
        rssi_dbm: list[float] = []
        snr_db: list[float] = []
        deliveries = 0
        valid_status = 0
        try:
            await _hlo_long_ack(client, radio)
            # Let the bridge finish any replay bookkeeping and clear the
            # channel after the HLO handshake before starting queries.
            await asyncio.sleep(2.0)
            print(f"\n  HIL soak: {trials} trials over {port}")
            print("  HIL soak: each trial sends `qry engine/status` to bridge")
            for i in range(trials):
                seq = client._next_seq()
                frame = Frame(
                    src=CAPTAIN_NODE_ID, dst=SERVER_ID, seq=seq,
                    typ=TYPE_QRY,
                    flags=FLAG_ACK_REQUESTED | FLAG_PRIVILEGED,
                    arg="engine/status",
                )
                fut: asyncio.Future = asyncio.get_running_loop().create_future()
                client._pending[seq] = fut
                t0 = time.monotonic()
                await radio.send(frame)
                try:
                    reply: Frame = await asyncio.wait_for(
                        fut, timeout=PER_TRIAL_TIMEOUT_S,
                    )
                    rtt = (time.monotonic() - t0) * 1000.0
                    rtt_ms.append(rtt)
                    deliveries += 1
                    if _compact_status_rep_ok(reply):
                        valid_status += 1
                    # Read radio link_stats (captain-side) just after
                    # the reply lands — the captain's last RX RSSI/SNR
                    # is whatever the reply frame just delivered.
                    ls = radio.link_stats
                    if ls.last_rssi_dbm is not None:
                        rssi_dbm.append(ls.last_rssi_dbm)
                    if ls.last_snr_db is not None:
                        snr_db.append(ls.last_snr_db)
                    print(
                        f"    [{i+1:>3}/{trials}] OK rtt={rtt:.0f}ms "
                        f"rssi={ls.last_rssi_dbm} snr={ls.last_snr_db}"
                    )
                except asyncio.TimeoutError:
                    # Clean up the pending future so a late reply
                    # doesn't trip another trial.
                    client._pending.pop(seq, None)
                    print(f"    [{i+1:>3}/{trials}] TIMEOUT after "
                          f"{PER_TRIAL_TIMEOUT_S:.0f}s")
                await asyncio.sleep(INTER_TRIAL_GAP_S)
        finally:
            rx_task.cancel()
            try:
                await rx_task
            except asyncio.CancelledError:
                pass
            await radio.close()

        delivery_pct = 100.0 * deliveries / max(1, trials)
        valid_pct = 100.0 * valid_status / max(1, deliveries) if deliveries else 0.0
        print("\n  ─── HIL link reliability summary ───")
        print(f"  trials:           {trials}")
        print(f"  delivered:        {deliveries} ({delivery_pct:.1f} %)")
        print(f"  valid compact:    {valid_status} "
              f"({valid_pct:.1f} % of delivered)")
        if rtt_ms:
            print(f"  RTT mean / p50 / p95 / max (ms): "
                  f"{statistics.mean(rtt_ms):.0f} / "
                  f"{_percentile(rtt_ms,50):.0f} / "
                  f"{_percentile(rtt_ms,95):.0f} / "
                  f"{max(rtt_ms):.0f}")
        if rssi_dbm:
            print(f"  RSSI min / mean / max (dBm): "
                  f"{min(rssi_dbm):.1f} / "
                  f"{statistics.mean(rssi_dbm):.1f} / "
                  f"{max(rssi_dbm):.1f}")
        if snr_db:
            print(f"  SNR  min / mean / max (dB): "
                  f"{min(snr_db):.1f} / "
                  f"{statistics.mean(snr_db):.1f} / "
                  f"{max(snr_db):.1f}")
        print(f"  threshold:        ≥{min_delivery_pct:.0f} % delivery, "
              f"≥{min_valid_pct:.0f} % valid compact (of delivered)")
        print("  ────────────────────────────────────")
        return delivery_pct, valid_pct, rtt_ms, rssi_dbm, snr_db

    (delivery_pct, valid_pct, rtt_ms, rssi_dbm, snr_db) = asyncio.run(
        _run()
    )
    assert delivery_pct >= min_delivery_pct, (
        f"delivery rate {delivery_pct:.1f}% below threshold "
        f"{min_delivery_pct:.0f}% — radio link or bridge is unhealthy"
    )
    # Valid-compact-status: PortWatch/engine contract uses `pat/` OR
    # `dn/` (see engine_client compact_status docs).
    assert valid_pct >= min_valid_pct or not delivery_pct, (
        f"valid compact_status rate {valid_pct:.1f}% below "
        f"{min_valid_pct:.0f}% — engine/bridge contract is broken "
        "even when frames arrive"
    )
    if max_rtt_p95_ms and rtt_ms:
        p95 = _percentile(rtt_ms, 95)
        assert p95 <= float(max_rtt_p95_ms), (
            f"RTT p95 {p95:.0f} ms exceeds ceiling {max_rtt_p95_ms} ms"
        )
    if min_rssi_mean and rssi_dbm:
        assert statistics.mean(rssi_dbm) >= float(min_rssi_mean), (
            f"mean RSSI {statistics.mean(rssi_dbm):.1f} dBm below "
            f"floor {min_rssi_mean} dBm"
        )
    if min_snr_mean and snr_db:
        assert statistics.mean(snr_db) >= float(min_snr_mean), (
            f"mean SNR {statistics.mean(snr_db):.1f} dB below floor "
            f"{min_snr_mean} dB"
        )
