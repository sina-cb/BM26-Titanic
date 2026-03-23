"""
BLE Client — Connect to a Titanic controller via GATT and interact.

Reads stats, sends commands, and monitors connection state.

Usage:
    from utils.ble_client import BLENodeClient
    client = BLENodeClient("8C:FD:49:B5:7E:B9")
    await client.connect()
    stats = await client.read_stats()
    await client.send_command("titanic:scene:sunset")
"""

import asyncio
import logging
from typing import Optional, Callable
from dataclasses import dataclass

log = logging.getLogger(__name__)

# UUIDs must match firmware titanic_ble.h
TITANIC_SERVICE_UUID  = "a0e3f001-1c3d-4b60-a0e3-000000000000"
CHAR_ROLE_UUID        = "a0e3f001-1c3d-4b60-a0e3-000000000001"
CHAR_FW_VER_UUID      = "a0e3f001-1c3d-4b60-a0e3-000000000002"
CHAR_UPTIME_UUID      = "a0e3f001-1c3d-4b60-a0e3-000000000003"
CHAR_TX_COUNT_UUID    = "a0e3f001-1c3d-4b60-a0e3-000000000010"
CHAR_RX_COUNT_UUID    = "a0e3f001-1c3d-4b60-a0e3-000000000011"
CHAR_LAST_RSSI_UUID   = "a0e3f001-1c3d-4b60-a0e3-000000000012"
CHAR_LAST_SNR_UUID    = "a0e3f001-1c3d-4b60-a0e3-000000000013"
CHAR_CMD_UUID         = "a0e3f001-1c3d-4b60-a0e3-000000000030"
CHAR_LAST_RX_UUID     = "a0e3f001-1c3d-4b60-a0e3-000000000031"


@dataclass
class BLEStats:
    """Stats read from a Titanic controller via BLE GATT."""
    role: str = ""
    fw_version: str = ""
    uptime_sec: int = 0
    tx_count: int = 0
    rx_count: int = 0
    last_rssi: float = 0.0
    last_snr: float = 0.0
    last_rx_payload: str = ""


class BLENodeClient:
    """Async BLE GATT client for a single Titanic controller node.

    Handles connection, disconnection, reconnection, and characteristic I/O.
    """

    def __init__(self, address: str, on_disconnect: Optional[Callable] = None):
        """
        Args:
            address: BLE MAC address (e.g. "8C:FD:49:B5:7E:B9")
            on_disconnect: Optional callback when connection drops.
        """
        self.address = address
        self._client = None
        self._connected = False
        self._on_disconnect = on_disconnect

    @property
    def is_connected(self) -> bool:
        return self._connected and self._client is not None

    async def connect(self, timeout: float = 10.0) -> bool:
        """Connect to the BLE device. Returns True on success."""
        try:
            from bleak import BleakClient
        except ImportError:
            log.error("bleak not installed — cannot connect via BLE")
            return False

        try:
            self._client = BleakClient(
                self.address,
                disconnected_callback=self._handle_disconnect,
                timeout=timeout,
            )
            await self._client.connect()
            self._connected = True
            log.info(f"BLE connected to {self.address}")
            return True
        except Exception as e:
            log.warning(f"BLE connect failed to {self.address}: {e}")
            self._connected = False
            return False

    async def disconnect(self):
        """Disconnect from the BLE device."""
        if self._client and self._connected:
            try:
                await self._client.disconnect()
            except Exception:
                pass
        self._connected = False
        self._client = None

    def _handle_disconnect(self, client):
        """Called by bleak when connection drops."""
        self._connected = False
        log.info(f"BLE disconnected from {self.address}")
        if self._on_disconnect:
            self._on_disconnect(self.address)

    async def _read_char(self, uuid: str) -> str:
        """Read a characteristic value as string."""
        if not self.is_connected:
            return ""
        try:
            data = await self._client.read_gatt_char(uuid)
            return data.decode("utf-8", errors="replace")
        except Exception as e:
            log.debug(f"Read {uuid} failed: {e}")
            return ""

    async def read_stats(self) -> BLEStats:
        """Read all stats from the controller."""
        if not self.is_connected:
            return BLEStats()

        stats = BLEStats()
        try:
            stats.role = await self._read_char(CHAR_ROLE_UUID)
            stats.fw_version = await self._read_char(CHAR_FW_VER_UUID)
            stats.uptime_sec = int(await self._read_char(CHAR_UPTIME_UUID) or "0")
            stats.tx_count = int(await self._read_char(CHAR_TX_COUNT_UUID) or "0")
            stats.rx_count = int(await self._read_char(CHAR_RX_COUNT_UUID) or "0")
            stats.last_rssi = float(await self._read_char(CHAR_LAST_RSSI_UUID) or "0")
            stats.last_snr = float(await self._read_char(CHAR_LAST_SNR_UUID) or "0")
            stats.last_rx_payload = await self._read_char(CHAR_LAST_RX_UUID)
        except Exception as e:
            log.warning(f"Error reading BLE stats: {e}")

        return stats

    async def verify_role(self) -> Optional[str]:
        """Read the Role characteristic to verify device identity.

        Returns the role string (e.g. 'PODIUM_TX') or None on failure.
        """
        role = await self._read_char(CHAR_ROLE_UUID)
        return role if role else None

    async def send_command(self, msg: str) -> bool:
        """Write a command to the Command characteristic (triggers LoRa TX).

        Args:
            msg: Command payload (e.g. "titanic:scene:sunset")

        Returns True on success.
        """
        if not self.is_connected:
            return False

        try:
            data = msg.encode("utf-8")[:250]  # Firmware limit
            await self._client.write_gatt_char(CHAR_CMD_UUID, data, response=False)
            log.info(f"BLE command sent: {msg}")
            return True
        except Exception as e:
            log.warning(f"BLE command failed: {e}")
            return False

    async def read_last_rx(self) -> str:
        """Read the last received LoRa payload."""
        return await self._read_char(CHAR_LAST_RX_UUID)
