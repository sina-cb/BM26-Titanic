#!/usr/bin/env python3
"""Capture an LED controller's serial console for the HIL push check.

The independent evidence channel of `tools/hil_push_check.cjs` (report `_363`
§6.3): the board's own console shows the reboot happening, whether it happened
ONCE, any panic/watchdog, and which strands the firmware actually initialized —
truths an HTTP read-back taken at the wrong moment cannot give.

This helper only CAPTURES. Every judgement lives in the Node runner's pure
`classifySerialWindow`, so the analysis is mock-testable and nothing about the
firmware's wording is embedded here.

Two modes:

    python tools/hil_serial_tail.py --list
        Enumerate the serial ports with description + VID:PID so the operator
        can identify each board. (MAC-based identification was considered and
        REJECTED: reading a MAC over serial resets the chip into its bootloader.)

    python tools/hil_serial_tail.py --port COM7 --out <logfile>
        Append `<ISO-timestamp> <line>` to the log for the whole run. Prints
        `HIL_SERIAL_READY <port>` on stdout once attached — the runner waits for
        that line before its attach gate.

CONTROL LINES: DTR and RTS are DEASSERTED BEFORE the port is opened. The default
open on these dev boards toggles them and resets the chip, which would both
destroy the "did it boot exactly once?" evidence and reboot a live show board.
pyserial applies `dtr`/`rts` set on an unopened `Serial()` at open time; that is
the whole reason this file exists instead of a Node one-liner.

Raw logs live under `~/tmp/hil_serial/` (gitignored — boot logs name WiFi SSIDs)
and are never pasted into a tracked report.

pyserial is imported at the top: a missing dependency crashes at start (codex
P0, no fallbacks). Install it with `pip install pyserial`.
"""

import argparse
import os
import sys
from datetime import datetime
from datetime import timezone

import serial
import serial.tools.list_ports

DEFAULT_BAUD = 115200
READ_TIMEOUT_S = 0.2


def list_ports() -> int:
    """Print every serial port with its description and VID:PID.

    The operator reads this to map a board to a COM port for
    `--serial <controllerId>=<COMx>`. Returns a process exit code.
    """
    ports = sorted(serial.tools.list_ports.comports(), key=lambda p: p.device)
    if not ports:
        print("no serial ports found", file=sys.stderr)
        return 1
    for port in ports:
        if port.vid is None or port.pid is None:
            ident = "VID:PID ----:----"
        else:
            ident = f"VID:PID {port.vid:04X}:{port.pid:04X}"
        serial_number = port.serial_number or "-"
        print(f"{port.device:<10} {ident}  {port.description}  [sn={serial_number}]")
    return 0


def open_quiet(port: str, baud: int) -> serial.Serial:
    """Open `port` with DTR and RTS deasserted BEFORE the open.

    A plain `serial.Serial(port)` asserts both lines as it opens, which resets
    the ESP32 — that would fake a boot in the capture and reboot a live board.
    """
    handle = serial.Serial()
    handle.port = port
    handle.baudrate = baud
    handle.timeout = READ_TIMEOUT_S
    handle.dtr = False
    handle.rts = False
    handle.open()
    return handle


def capture(port: str, baud: int, out_path: str) -> int:
    """Append timestamped console lines from `port` to `out_path` until killed.

    Every line is flushed immediately so the Node runner can read a leg's window
    the moment the leg ends. Returns a process exit code.
    """
    directory = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(directory, exist_ok=True)
    handle = open_quiet(port, baud)
    with open(out_path, "a", encoding="utf-8", newline="") as log:
        print(f"HIL_SERIAL_READY {port}", flush=True)
        pending = b""
        while True:
            chunk = handle.read(4096)
            if chunk:
                pending += chunk
                while b"\n" in pending:
                    raw, pending = pending.split(b"\n", 1)
                    text = raw.decode("utf-8", errors="replace").rstrip("\r")
                    stamp = datetime.now(timezone.utc).isoformat()
                    log.write(f"{stamp} {text}\n")
                    log.flush()


def build_parser() -> argparse.ArgumentParser:
    """The CLI: `--list`, or `--port` + `--out`."""
    parser = argparse.ArgumentParser(
        description="Capture an LED controller's serial console for hil_push_check.cjs",
    )
    parser.add_argument("--list", action="store_true",
                        help="enumerate serial ports (description + VID:PID) and exit")
    parser.add_argument("--port", help="the serial port to capture (e.g. COM7)")
    parser.add_argument("--out", help="log file to append <ISO-timestamp> <line> to")
    parser.add_argument("--baud", type=int, default=DEFAULT_BAUD,
                        help=f"baud rate (default {DEFAULT_BAUD})")
    return parser


def main(argv: list[str]) -> int:
    """Parse arguments and run the requested mode. Fails loudly on a bad call."""
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.list:
        if args.port or args.out:
            parser.error("--list takes no other arguments")
        return list_ports()
    if not args.port or not args.out:
        parser.error("--port and --out are both required (or use --list)")
    try:
        return capture(args.port, args.baud, args.out)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
