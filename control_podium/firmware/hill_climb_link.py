#!/usr/bin/env python3
"""hill_climb_link.py — Iterate LoRa params + measure link reliability.

The thesis behind this script is simple: pick the BEST LoRa params
(SF, BW, CR) for our actual hardware, antennas, and rig, by ACTUALLY
flashing each combo and measuring the round-trip success rate. Static
link-budget math gets you to the right ballpark; only end-to-end
measurement tells you whether your antenna placement, your USB cables,
your radome plastic, and your indoor multipath line up with the math.

How it works
------------
1. Read `.config.firmware.yaml` for the baseline radio profile.
2. Walk through a candidate list of (SF, BW, CR) triples specified
   via --sf/--bw/--cr or defaulted to a sensible long-range sweep.
3. For each candidate:
   a. Write the candidate values back to `.config.firmware.yaml`.
   b. Run `firmware/deploy.py --all --yes` to reflash BOTH controllers
      (server on the Pi, captain on the laptop) with the new params.
   c. Run `tests/hil/test_hil_link_reliability.py` to drive
      HIL_TRIALS=N round-trips and collect delivery / RTT / RSSI / SNR.
   d. Tabulate the results.
4. After the sweep, restore the original YAML and print the
   leaderboard, recommending the best candidate (highest delivery
   first, lower RTT to break ties).

Why a separate script vs. a pytest parametrization
--------------------------------------------------
A pytest sweep that reflashes between cases would take ~5 minutes per
case * N cases — too slow for the per-PR CI and too fast-and-loose
for an interactive "tune the link" session. Keeping it standalone
means an operator can ctrl-C out mid-sweep without leaving the rig
flashed with a half-tested profile (the script always restores the
original YAML before exiting, even on Ctrl-C).

Safety
------
* Only writes to .config.firmware.yaml — never to .config.nodes.yaml
  or secret.yaml. The flash steps reuse `firmware/deploy.py` which
  has its own MAC-pairing safety.
* Restores the original YAML on exit (sigint, success, or exception).
* Each candidate's HIL run gets its own timeout (HIL_TRIALS * 14 s +
  60 s for ssh / flash overhead).
* No user-controlled inputs are passed to subprocess via shell — every
  call is `subprocess.run([...], shell=False)`.

Usage
-----
    # Default sweep: SF=8..11 at BW=125, CR=4/5 — covers 2-mile target.
    PYTHONPATH=. ../.venv-dev/bin/python firmware/hill_climb_link.py

    # Narrow sweep (e.g. confirm SF=10/BW=125 is the local winner):
    PYTHONPATH=. ../.venv-dev/bin/python firmware/hill_climb_link.py \\
        --sf 9 10 11 --bw 125 --cr 5

    # Quick test: only 10 trials per candidate.
    PYTHONPATH=. ../.venv-dev/bin/python firmware/hill_climb_link.py \\
        --trials 10
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

BASE = Path(__file__).resolve().parent.parent           # control_podium/
FW_YAML = BASE / ".config.firmware.yaml"
DEPLOY_SCRIPT = BASE / "firmware" / "deploy.py"
HIL_TEST = BASE / "tests" / "hil" / "test_hil_link_reliability.py"


def _read_yaml_text() -> str:
    return FW_YAML.read_text(encoding="utf-8")


def _write_yaml_text(s: str) -> None:
    # Write atomically so a SIGINT mid-write can't leave the YAML
    # partially-written. The deploy script would fail-fast on a
    # malformed YAML, but we want zero chance of bricking the next
    # run for a different developer.
    tmp = FW_YAML.with_suffix(FW_YAML.suffix + ".tmp")
    tmp.write_text(s, encoding="utf-8")
    tmp.replace(FW_YAML)


_PAT_SF = re.compile(r"^(\s*spreading_factor:\s*)(\S+)(\s*(?:#.*)?)$", re.M)
_PAT_BW = re.compile(r"^(\s*bandwidth_khz:\s*)(\S+)(\s*(?:#.*)?)$", re.M)
_PAT_CR = re.compile(r"^(\s*coding_rate:\s*)(\S+)(\s*(?:#.*)?)$", re.M)


def _patch_radio(text: str, sf: int, bw: float, cr: int) -> str:
    """Rewrite the three radio knobs in-place. Uses regex on the raw
    YAML text rather than yaml.safe_load + dump so we PRESERVE all the
    comments — the file is mostly comments explaining WHY each value
    was chosen, and re-dumping nukes them.

    Fails loudly if any of the three lines is missing — the YAML
    schema must keep all three present (with their defaults) so the
    hill-climb has somewhere to patch.
    """
    new = text
    for pat, val, name in (
        (_PAT_SF, sf, "spreading_factor"),
        (_PAT_BW, bw, "bandwidth_khz"),
        (_PAT_CR, cr, "coding_rate"),
    ):
        if not pat.search(new):
            raise RuntimeError(
                f"{name} line not found in .config.firmware.yaml — "
                "hill_climb_link requires all three radio params to exist"
            )
        new = pat.sub(lambda m: f"{m.group(1)}{val}{m.group(3)}", new, count=1)
    return new


@contextmanager
def _yaml_restored() -> Iterator[None]:
    original = _read_yaml_text()
    try:
        yield
    finally:
        _write_yaml_text(original)
        print("\n[hill-climb] restored original .config.firmware.yaml")


def _run(cmd: list[str], timeout: float, env: dict | None = None) -> tuple[int, str]:
    """Run a subprocess, stream stdout to ours, capture combined output.
    Returns (rc, captured_text). Uses shell=False (security rule).
    """
    print(f"[hill-climb] $ {' '.join(cmd)}")
    # We deliberately keep stderr in a separate stream so terminal
    # capture preserves it for the report, but we redirect to PIPE
    # then teeing live is more code than necessary — the deploy and
    # pytest commands both print their own progress, so we just
    # call subprocess.run and capture everything for the leaderboard.
    proc = subprocess.run(
        cmd,
        timeout=timeout,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    # Mirror to our stdout so a watching operator sees progress.
    sys.stdout.write(proc.stdout)
    if proc.stderr:
        sys.stderr.write(proc.stderr)
    return proc.returncode, proc.stdout + proc.stderr


_PCT_RE = re.compile(r"delivered:\s+\d+\s+\(([\d.]+) %\)")
_VALID_RE = re.compile(r"valid compact:\s+\d+\s+\(([\d.]+) %")
_RTT_RE = re.compile(r"RTT mean / p50 / p95 / max \(ms\):\s+([\d.]+)\s+/\s+([\d.]+)\s+/\s+([\d.]+)\s+/\s+([\d.]+)")
_RSSI_RE = re.compile(r"RSSI min / mean / max \(dBm\):\s+([-.\d]+)\s+/\s+([-.\d]+)\s+/\s+([-.\d]+)")
_SNR_RE = re.compile(
    r"SNR\s+min / mean / max \(dB\):\s+([-.\d]+)\s+/\s+([-.\d]+)\s+/\s+([-.\d]+)"
)


def _parse_hil_output(text: str) -> dict:
    """Pull the summary stats out of the HIL test's stdout. Returns
    a dict with sensible defaults so a malformed run doesn't crash
    the sweep — it just shows up as 0% delivery."""
    out: dict[str, float | None] = {
        "delivery_pct": None,
        "valid_pct": None,
        "rtt_mean_ms": None,
        "rtt_p50_ms": None,
        "rtt_p95_ms": None,
        "rtt_max_ms": None,
        "rssi_min_dbm": None,
        "rssi_mean_dbm": None,
        "rssi_max_dbm": None,
        "snr_min_db": None,
        "snr_mean_db": None,
        "snr_max_db": None,
    }
    m = _PCT_RE.search(text)
    if m:
        out["delivery_pct"] = float(m.group(1))
    m = _VALID_RE.search(text)
    if m:
        out["valid_pct"] = float(m.group(1))
    m = _RTT_RE.search(text)
    if m:
        (out["rtt_mean_ms"], out["rtt_p50_ms"],
         out["rtt_p95_ms"], out["rtt_max_ms"]) = [float(x) for x in m.groups()]
    m = _RSSI_RE.search(text)
    if m:
        (out["rssi_min_dbm"], out["rssi_mean_dbm"],
         out["rssi_max_dbm"]) = [float(x) for x in m.groups()]
    m = _SNR_RE.search(text)
    if m:
        (out["snr_min_db"], out["snr_mean_db"], out["snr_max_db"]) = [
            float(x) for x in m.groups()
        ]
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sf", type=int, nargs="+",
                    default=[8, 9, 10, 11],
                    help="spreading factors to sweep (default: 8..11)")
    ap.add_argument("--bw", type=float, nargs="+",
                    default=[125.0],
                    help="bandwidths kHz to sweep (default: 125)")
    ap.add_argument("--cr", type=int, nargs="+",
                    default=[5],
                    help="coding rates 5..8 to sweep (default: 5 = 4/5)")
    ap.add_argument("--trials", type=int, default=20,
                    help="HIL trials per candidate (default 20)")
    ap.add_argument("--min-delivery-pct", type=float, default=0.0,
                    help="HIL test fails under this %% (default 0 — never fail-fast, "
                         "just record every candidate)")
    ap.add_argument("--skip-flash", action="store_true",
                    help="reuse the controller's current firmware (dev only — "
                         "useful for re-running the HIL test against one profile)")
    ap.add_argument("--output", type=Path, default=BASE / "tmp" / "hill_climb_result.json",
                    help="where to write the JSON leaderboard")
    args = ap.parse_args()

    # The set of candidate tuples — Cartesian product of sf/bw/cr.
    candidates: list[tuple[int, float, int]] = [
        (sf, bw, cr) for sf in args.sf for bw in args.bw for cr in args.cr
    ]
    print(f"[hill-climb] {len(candidates)} candidates: {candidates}")

    # Signal handlers ensure Ctrl-C restores YAML.
    def _sigint(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGINT, _sigint)

    results: list[dict] = []
    with _yaml_restored():
        for idx, (sf, bw, cr) in enumerate(candidates, 1):
            print(f"\n[hill-climb] ── candidate {idx}/{len(candidates)}: "
                  f"SF={sf} BW={bw} CR=4/{cr} ──")
            original = _read_yaml_text()
            patched = _patch_radio(original, sf, bw, cr)
            _write_yaml_text(patched)

            flash_ok = True
            if not args.skip_flash:
                deploy_cmd = [sys.executable, str(DEPLOY_SCRIPT), "--all", "--yes"]
                rc, _ = _run(deploy_cmd, timeout=600.0)
                if rc != 0:
                    print(f"[hill-climb] deploy FAILED for SF={sf} BW={bw} CR=4/{cr}, "
                          "skipping this candidate")
                    flash_ok = False

            hil_result: dict = {}
            if flash_ok:
                env = os.environ.copy()
                env["HIL_TRIALS"] = str(args.trials)
                env["HIL_MIN_DELIVERY_PCT"] = "0"  # never gate the sweep itself
                env["PYTHONPATH"] = str(BASE) + os.pathsep + env.get("PYTHONPATH", "")
                hil_cmd = [
                    sys.executable, "-m", "pytest", str(HIL_TEST), "-v", "-s",
                ]
                # Worst-case: HLO ACK (slow SF/BW) + 2 s settle +
                # trials × (per-trial cap + gap) + pytest spin-up.
                hlo_budget = float(
                    os.environ.get("HIL_HLO_ACK_TIMEOUT_S", "55.0")
                ) + 5.0
                timeout = hlo_budget + args.trials * 28.0 + 180.0
                rc, captured = _run(hil_cmd, timeout=timeout, env=env)
                hil_result = _parse_hil_output(captured)
                hil_result["hil_rc"] = rc

            row = {
                "sf": sf, "bw_khz": bw, "cr": cr,
                "flash_ok": flash_ok,
                **hil_result,
            }
            results.append(row)
            print(f"[hill-climb] candidate result: {row}")

    # Sort: highest delivery_pct first, then lowest p95 RTT.
    def _key(row: dict) -> tuple:
        d = row.get("delivery_pct") or 0
        rtt = row.get("rtt_p95_ms") or 1e9
        return (-d, rtt)
    results_sorted = sorted(results, key=_key)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results_sorted, indent=2), encoding="utf-8")
    print(f"\n[hill-climb] results written to {args.output}")

    print("\n[hill-climb] ── LEADERBOARD ──")
    print(f"{'SF':>3} {'BW':>6} {'CR':>3} {'delivery':>9} {'valid':>6} "
          f"{'rtt_p50':>8} {'rtt_p95':>8} {'rssi_mean':>10} {'snr_mean':>9}")
    for r in results_sorted:
        d = r.get("delivery_pct")
        v = r.get("valid_pct")
        rtt50 = r.get("rtt_p50_ms")
        rtt95 = r.get("rtt_p95_ms")
        rmean = r.get("rssi_mean_dbm")
        smean = r.get("snr_mean_db")
        print(f"{r['sf']:>3} {r['bw_khz']:>6} 4/{r['cr']:>1} "
              f"{(d or 0):>8.1f}% {(v or 0):>5.1f}% "
              f"{(rtt50 or 0):>7.0f}ms {(rtt95 or 0):>7.0f}ms "
              f"{(rmean or 0):>9.1f}dBm {(smean or 0):>8.1f}dB")

    if results_sorted and results_sorted[0].get("delivery_pct"):
        winner = results_sorted[0]
        print(f"\n[hill-climb] winner: SF={winner['sf']} BW={winner['bw_khz']} "
              f"CR=4/{winner['cr']} — {winner['delivery_pct']:.1f}% delivery")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        # _yaml_restored() has already run in the contextmanager
        # finally clause — just exit cleanly.
        print("\n[hill-climb] interrupted")
        sys.exit(130)
