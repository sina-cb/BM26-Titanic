"""
BLE Discovery — Scan for Titanic controllers via Windows Bluetooth.

Uses the `bleak` library for cross-platform BLE scanning.
Finds devices by advertised name pattern ("Titanic-*") and/or
service UUID, then verifies identity by reading the GATT Role
characteristic.

Status model:
  ADAPTER_MISSING  — No Bluetooth adapter found
  NOT_SEEN         — Adapter OK, but no Titanic devices in range
  SEEN             — Device found in scan (address + RSSI known)
  CONNECTED        — GATT connection established, role verified

Usage:
    from utils.ble_discovery import scan_titanic_devices, BLEStatus
    results = await scan_titanic_devices(timeout=10)
"""

import asyncio
import logging
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional

log = logging.getLogger(__name__)

# Must match firmware titanic_ble.h
TITANIC_SERVICE_UUID = "a0e3f001-1c3d-4b60-a0e3-000000000000"
CHAR_ROLE_UUID       = "a0e3f001-1c3d-4b60-a0e3-000000000001"
CHAR_FW_VER_UUID     = "a0e3f001-1c3d-4b60-a0e3-000000000002"

# BLE name prefix used by firmware
BLE_NAME_PREFIX = "Titanic-"


class BLEStatus(Enum):
    ADAPTER_MISSING = "adapter_missing"
    NOT_SEEN = "not_seen"
    SEEN = "seen"
    CONNECTED = "connected"


@dataclass
class BLEDeviceInfo:
    """A discovered Titanic BLE device."""
    name: str                      # e.g. "Titanic-Podium"
    address: str                   # e.g. "8C:FD:49:B5:7E:B9"
    rssi: int = 0                  # dBm
    role: Optional[str] = None     # Populated after GATT verification
    fw_version: Optional[str] = None
    status: BLEStatus = BLEStatus.SEEN


def _is_titanic(name: Optional[str]) -> bool:
    """Check if a BLE device name matches Titanic pattern."""
    return name is not None and name.startswith(BLE_NAME_PREFIX)


async def scan_titanic_devices(timeout: float = 10.0) -> list[BLEDeviceInfo]:
    """Scan for Titanic BLE devices.

    Returns a list of BLEDeviceInfo for each device found.
    Returns empty list with status info if adapter is missing.

    Args:
        timeout: Scan duration in seconds.

    Returns:
        List of BLEDeviceInfo objects. Empty if no devices found.

    Raises:
        No exceptions — adapter-missing is returned as empty list.
    """
    try:
        from bleak import BleakScanner
    except ImportError:
        log.warning("bleak not installed — BLE discovery unavailable")
        return []

    found = {}

    def _callback(device, adv_data):
        # Match by name OR by service UUID
        name_match = _is_titanic(device.name)
        uuid_match = TITANIC_SERVICE_UUID.lower() in [
            str(u).lower() for u in (adv_data.service_uuids or [])
        ]
        if name_match or uuid_match:
            found[device.address] = BLEDeviceInfo(
                name=device.name or f"Titanic-Unknown",
                address=device.address,
                rssi=adv_data.rssi,
                status=BLEStatus.SEEN,
            )

    try:
        scanner = BleakScanner(detection_callback=_callback)
        await scanner.start()
        await asyncio.sleep(timeout)
        await scanner.stop()
    except Exception as e:
        err = str(e).lower()
        if "bluetooth" in err or "adapter" in err or "winrt" in err:
            log.warning(f"BLE adapter issue: {e}")
            return []
        raise

    return list(found.values())


async def scan_and_match(config: dict, timeout: float = 10.0) -> dict:
    """Scan for Titanic devices and match to configured roles.

    Uses GATT characteristic probing if the Windows name cache is corrupted.
    """
    devices = await scan_titanic_devices(timeout)

    result = {name: None for name in config.get("nodes", {}).keys()}
    from utils.ble_client import BLENodeClient

    for device in devices:
        role_str = None
        
        # 1. Try to match by explicit name first (fast path)
        if device.name:
            n = device.name.lower()
            if "titanic-podium" in n:
                role_str = "podium"
            elif "titanic-server" in n:
                role_str = "server"

        # 2. If Windows cached the name wrong, connect and ask the firmware directly
        if not role_str:
            client = BLENodeClient(device.address)
            try:
                if await client.connect(timeout=4.0):
                    verified_role = await client.verify_role()
                    if verified_role:
                        role_str = verified_role.lower()
            finally:
                await client.disconnect()

        # Map the resolved role
        if role_str:
            if "podium" in role_str:
                result["podium"] = device
                # Patch the name to look nice in the UI since Windows failed
                device.name = "Titanic-Podium" 
            elif "server" in role_str:
                result["server"] = device
                device.name = "Titanic-Server"

    return result


def check_adapter() -> BLEStatus:
    """Quick check if a Bluetooth adapter is available.

    Returns BLEStatus.ADAPTER_MISSING or BLEStatus.NOT_SEEN.
    """
    try:
        from bleak import BleakScanner

        async def _check():
            try:
                s = BleakScanner()
                await s.start()
                await asyncio.sleep(0.5)
                await s.stop()
                return BLEStatus.NOT_SEEN  # Adapter works
            except Exception:
                return BLEStatus.ADAPTER_MISSING

        return asyncio.run(_check())
    except ImportError:
        return BLEStatus.ADAPTER_MISSING
