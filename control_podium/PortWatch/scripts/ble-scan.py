#!/usr/bin/env python3
"""
ble-scan.py — Independent BLE scanner for verifying that the captain
              Heltec is actually visible on the air.
==============================================================

Runs a 6-second BLE scan from your laptop using the same OS-level BLE
stack the iPhone is using (CoreBluetooth on macOS), and prints what an
iPhone-style scanner *would* see. This is the ground-truth diagnostic
when "the iPhone app doesn't find any devices":

    - if THIS script doesn't see the radio either, the firmware isn't
      advertising properly (battery dead, BLE init failed, antenna
      issue) and you should check the serial console;
    - if THIS script sees the radio but the iPhone app doesn't, the
      iPhone scan filter is wrong — that's an app bug, not a hardware
      problem.

The tool deliberately scans by service UUID rather than by name, so it
finds Titanic radios even when their advertisement is name-less (which
is the default for any NimBLE build that doesn't enable scan response).

Usage
-----

    cd control_podium/PortWatch
    npm run ble:scan

    # or directly:
    ../../.venv-dev/bin/python3 scripts/ble-scan.py

Output explanation
------------------

    name=...        - what BLE central libraries see as the device name.
                      None means the firmware did not include a name in
                      either the primary ADV packet or the scan response.
                      Old NimBLE builds drop the name silently when a
                      128-bit service UUID is also being advertised.
    rssi=...        - signal strength. Stronger (less negative) is better.
                      Anything above -70 dBm is comfortably workable for
                      a BLE link.
    services=[...]  - 128-bit service UUIDs in the advertisement. Must
                      contain a0e3f001-1c3d-4b60-a0e3-000000000000 for
                      this script to label the device as a Titanic radio.

This script needs no special permissions on macOS beyond the system
Bluetooth privacy prompt that any app gets the first time it scans.
"""

# Why pure stdlib + bleak only: this script must not depend on the
# PortWatch node_modules or on the rest of the project. It is a
# clean-room BLE check designed to work even when the app's TS code is
# broken. bleak is in the dev venv; everything else is stdlib.

import argparse
import asyncio
import sys

try:
    from bleak import BleakScanner
except ImportError:
    print(
        "bleak is not installed in this Python environment.\n"
        "Install with:  ../../.venv-dev/bin/pip install bleak",
        file=sys.stderr,
    )
    sys.exit(2)

# Mirror the GATT layout from src/ble/uuids.ts and titanic_ble.h. We
# hard-code these instead of import-from-the-app on purpose — the whole
# point is that this tool works even when the app is broken.
TITANIC_SERVICE_UUID = "a0e3f001-1c3d-4b60-a0e3-000000000000"
TITANIC_NAME_PREFIX = "tcon_"


async def main() -> int:
    parser = argparse.ArgumentParser(description="Mac/Linux BLE scanner for Titanic Heltec radios.")
    parser.add_argument(
        "--seconds",
        type=float,
        default=6.0,
        help="How long to scan (default 6s). Bigger = more chances to see scan responses.",
    )
    parser.add_argument(
        "--show-others",
        type=int,
        default=6,
        help="How many non-Titanic peripherals to also list (default 6, 0 = none).",
    )
    args = parser.parse_args()

    print(
        f"Scanning {args.seconds:.0f}s for any BLE peripheral. "
        f"Looking for service {TITANIC_SERVICE_UUID}",
        flush=True,
    )

    devs = await BleakScanner.discover(timeout=args.seconds, return_adv=True)

    titanic = []
    others = []
    for _addr, (dev, adv) in devs.items():
        name = (dev.name or adv.local_name or "")
        # Match either by advertised name prefix OR by service UUID.
        # In practice firmware without enableScanResponse() will only
        # match via service UUID — that's the bug we're hunting.
        # Case-insensitive: some BLE stacks normalise / cache local
        # names with different capitalisation than what was on the air.
        name_match = name.lower().startswith(TITANIC_NAME_PREFIX)
        service_uuids_lower = [u.lower() for u in (adv.service_uuids or [])]
        svc_match = TITANIC_SERVICE_UUID.lower() in service_uuids_lower
        if name_match or svc_match:
            titanic.append((dev, adv, name_match, svc_match))
        else:
            others.append((dev, adv))

    print()
    print(f"=== TITANIC RADIOS FOUND ({len(titanic)}) ===")
    if not titanic:
        print(
            "  (NONE — the firmware is not visibly advertising right now)\n"
            "  Check:\n"
            "    - device powered on (OLED visible)?\n"
            "    - tail the serial port: pio device monitor -e podium_tx\n"
            "      and verify you see  BLE: advertising as 'tcon_<name>'\n"
            "    - laptop too far / antenna obstructed?"
        )
        return 1

    for dev, adv, nm, sm in titanic:
        print(f"  {dev.address}")
        print(f"    name      : {dev.name!r}  local_name={adv.local_name!r}")
        print(f"    rssi      : {adv.rssi} dBm")
        print(f"    services  : {adv.service_uuids}")
        # The TX power AD field, if present, lets a central infer
        # path-loss for free. Heltec firmware doesn't currently set it,
        # so we just report what we got.
        if adv.tx_power is not None:
            print(f"    tx_power  : {adv.tx_power} dBm")
        print(f"    matched by: name={nm} svc_uuid={sm}")
        if adv.manufacturer_data:
            print(f"    mfg data  : {dict(adv.manufacturer_data)}")
        print()

    if args.show_others > 0:
        print(f"=== OTHER NEARBY BLE PERIPHERALS ({len(others)}, first {args.show_others}) ===")
        for dev, adv in others[: args.show_others]:
            label = dev.name or adv.local_name or "(no name)"
            print(f"  {dev.address}  {label}  rssi={adv.rssi}")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
