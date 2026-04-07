"""
Tests — BLE discovery module.

Tests the matcher logic without requiring an actual Bluetooth adapter.
"""

import pytest
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from utils.ble_discovery import (
    BLEDeviceInfo, BLEStatus, _is_titanic,
    scan_and_match, check_adapter,
)


def test_is_titanic_matches_correct_names():
    assert _is_titanic("Titanic-Podium") is True
    assert _is_titanic("Titanic-Server") is True
    assert _is_titanic("Titanic-Whatever") is True


def test_is_titanic_rejects_wrong_names():
    assert _is_titanic(None) is False
    assert _is_titanic("") is False
    assert _is_titanic("Govee_H605C") is False
    assert _is_titanic("titanic-lower") is False  # Case-sensitive


def test_scan_and_match_maps_roles():
    """scan_and_match correctly maps discovered devices to config roles."""
    import asyncio

    config = {
        "nodes": {
            "podium": {"role": "tx"},
            "server": {"role": "rx"},
        }
    }

    # Mock the scan function
    mock_devices = [
        BLEDeviceInfo(name="Titanic-Podium", address="AA:BB:CC:DD:EE:01", rssi=-50),
        BLEDeviceInfo(name="Titanic-Server", address="AA:BB:CC:DD:EE:02", rssi=-60),
    ]

    async def _test():
        with patch("utils.ble_discovery.scan_titanic_devices", new_callable=AsyncMock,
                    return_value=mock_devices):
            result = await scan_and_match(config)

        assert result["podium"] is not None
        assert result["podium"].name == "Titanic-Podium"
        assert result["podium"].address == "AA:BB:CC:DD:EE:01"
        assert result["server"] is not None
        assert result["server"].name == "Titanic-Server"

    asyncio.run(_test())


def test_scan_and_match_handles_missing():
    """scan_and_match returns None for roles with no matching device."""
    import asyncio

    config = {"nodes": {"podium": {}, "server": {}}}

    async def _test():
        with patch("utils.ble_discovery.scan_titanic_devices", new_callable=AsyncMock,
                    return_value=[]):
            result = await scan_and_match(config)

        assert result["podium"] is None
        assert result["server"] is None

    asyncio.run(_test())


def test_check_adapter_without_bleak():
    """check_adapter returns ADAPTER_MISSING when bleak not available."""
    with patch.dict("sys.modules", {"bleak": None}):
        # This should not crash
        status = check_adapter()
        assert status == BLEStatus.ADAPTER_MISSING
