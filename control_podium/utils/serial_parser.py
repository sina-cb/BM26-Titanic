"""
Serial Parser — Shared protocol parsing for Titanic firmware serial output.

Extracted from the companion scripts to avoid duplicating the protocol layer.
Both the existing companions and the new Control Center monitor reuse this.

Firmware protocol:
  TX side:  Sends payload over serial → firmware transmits via LoRa → acks TX_OK\n
  RX side:  Firmware receives LoRa → outputs RX:<payload>:RSSI=<r>:SNR=<s>\n
  BLE:      BLE_CMD: <msg>\n  |  BLE: <status>\n
"""

import re
from dataclasses import dataclass
from typing import Optional


# Regex that handles payloads containing ':' (which the previous split-on-':'
# approach got wrong). We anchor on the ':RSSI=' suffix and treat everything
# between 'RX:' and ':RSSI=' as the payload. Note: payloads must NOT contain
# the literal substring ':RSSI=' — that's a hard rule of the wire format.
_RX_LINE_RE = re.compile(r"^RX:(?P<payload>.*?):RSSI=(?P<rssi>\S+?):SNR=(?P<snr>\S+)\s*$")


@dataclass
class RXMessage:
    """A parsed RX: line from firmware serial output."""
    payload: str
    rssi: str = ""
    snr: str = ""
    raw: str = ""


@dataclass
class TXAck:
    """A parsed TX_OK or TX_FAIL line."""
    success: bool
    error_code: str = ""
    raw: str = ""


@dataclass
class BLEEvent:
    """A parsed BLE event from serial output."""
    event_type: str  # "connected", "disconnected", "command", "advertising"
    detail: str = ""
    raw: str = ""


@dataclass
class FirmwareEvent:
    """A parsed firmware boot/status event."""
    event_type: str  # "ready", "version", "info"
    detail: str = ""
    raw: str = ""


def parse_rx_line(line: str) -> Optional[RXMessage]:
    """Parse an RX: line from firmware serial output.

    Expected format: ``RX:<payload>:RSSI=<r>:SNR=<s>``

    Unlike the original implementation, this preserves ``:`` characters inside
    ``<payload>`` (the v2 wire protocol uses ``|`` as its field delimiter so it
    happens to avoid ``:`` already, but other payloads like ``titanic:scene:sunset``
    used in v1 would otherwise be truncated to just ``titanic``).

    Returns RXMessage or None if the line doesn't match.
    """
    if not line.startswith("RX:"):
        return None

    m = _RX_LINE_RE.match(line)
    if not m:
        # Fallback: legacy format where the RSSI/SNR suffix is missing or
        # malformed. We still want to surface the payload.
        return RXMessage(payload=line[3:], rssi="", snr="", raw=line)

    return RXMessage(
        payload=m.group("payload"),
        rssi=m.group("rssi"),
        snr=m.group("snr"),
        raw=line,
    )


def parse_tx_ack(line: str) -> Optional[TXAck]:
    """Parse a TX acknowledgment line.

    Returns TXAck or None if not a TX ack line.
    """
    if line == "TX_OK":
        return TXAck(success=True, raw=line)
    if line.startswith("TX_FAIL:"):
        code = line[8:]
        return TXAck(success=False, error_code=code, raw=line)
    return None


def parse_ble_event(line: str) -> Optional[BLEEvent]:
    """Parse a BLE event line from firmware serial output.

    Returns BLEEvent or None if not a BLE line.
    """
    if line.startswith("BLE: phone connected"):
        return BLEEvent(event_type="connected", detail=line[20:].strip(), raw=line)
    if line.startswith("BLE: phone disconnected"):
        return BLEEvent(event_type="disconnected", detail=line[23:].strip(), raw=line)
    if line.startswith("BLE_CMD:"):
        return BLEEvent(event_type="command", detail=line[8:].strip(), raw=line)
    if line.startswith("BLE: advertising"):
        return BLEEvent(event_type="advertising", detail=line[16:].strip(), raw=line)
    if line.startswith("BLE:"):
        return BLEEvent(event_type="info", detail=line[4:].strip(), raw=line)
    return None


def parse_firmware_event(line: str) -> Optional[FirmwareEvent]:
    """Parse firmware boot/status events.

    Returns FirmwareEvent or None if not a firmware event.
    """
    if "READY" in line:
        return FirmwareEvent(event_type="ready", detail=line, raw=line)
    if line.startswith("FW:") or "firmware" in line.lower():
        return FirmwareEvent(event_type="version", detail=line, raw=line)
    return None


def parse_line(line: str) -> Optional[object]:
    """Parse any serial line and return the appropriate event object.

    Returns one of: RXMessage, TXAck, BLEEvent, FirmwareEvent, or None.
    """
    result = parse_rx_line(line)
    if result:
        return result

    result = parse_tx_ack(line)
    if result:
        return result

    result = parse_ble_event(line)
    if result:
        return result

    result = parse_firmware_event(line)
    if result:
        return result

    return None
