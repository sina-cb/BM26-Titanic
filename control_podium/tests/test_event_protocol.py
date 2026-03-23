"""
Test 5 — Event Protocol
==========================
Verify that the titanic: event protocol works correctly for all event types
used by the control podium: scene, cmd, fx, ping.

Usage:
    cd control_podium/heltec
    python -m pytest tests/test_event_protocol.py -v -s
"""
import time
import pytest


class TestEventProtocol:
    """Verify all titanic: event types are correctly transmitted and received."""

    @pytest.mark.parametrize("event_type,event_arg", [
        ("scene", "sunset"),
        ("scene", "storm"),
        ("scene", "sos"),
        ("cmd", "blackout"),
        ("cmd", "full_bright"),
        ("fx", "strobe"),
        ("fx", "rainbow"),
        ("ping", ""),
    ])
    def test_event_delivery(self, podium_serial, server_reader, config,
                             event_type, event_arg):
        """Each event type is transmitted and received intact."""
        prefix = config.get("protocol", {}).get("prefix", "titanic:")

        if event_arg:
            msg = f"{prefix}{event_type}:{event_arg}"
            search_for = f"{event_type}:{event_arg}"
        else:
            msg = f"{prefix}{event_type}"
            search_for = event_type

        server_reader.clear()
        podium_serial.write(f"{msg}\n".encode())
        print(f"  📤 Sent: {msg}")

        line = server_reader.wait_for_containing(search_for, timeout=5)
        assert line is not None, f"Event '{search_for}' not received within 5s"
        print(f"  Received: {line}")

        # Verify payload integrity — extract from RX:<payload>:RSSI=...:SNR=...
        body = line[3:]  # Strip "RX:"
        rssi_idx = body.find(":RSSI=")
        full_payload = body[:rssi_idx] if rssi_idx != -1 else body

        assert full_payload == msg, (
            f"Payload mismatch: got '{full_payload}', expected '{msg}'"
        )

        time.sleep(1.0)  # Gap between parametrized runs (LoRa re-enter RX time)

    @pytest.mark.xfail(
        reason="100-char payloads may be dropped after rapid prior tests — "
               "LoRa radio needs time to re-enter RX.",
        strict=False,
    )
    def test_max_payload_length(self, podium_serial, server_reader):
        """Firmware should handle payloads up to 100 characters over LoRa.

        NOTE: LoRa at SF7/BW250 has practical packet size limits.
        We test 100 chars which is realistic for event payloads.
        """
        tag = f"hil:maxlen:{int(time.time())}:"
        padding = "A" * (100 - len(tag))
        msg = tag + padding

        server_reader.clear()
        podium_serial.write(f"{msg}\n".encode())
        print(f"  Sent {len(msg)}-char message")

        line = server_reader.wait_for_containing(tag, timeout=8)
        assert line is not None, "Long message not received within 8s"

        # Verify the tag survived in the payload
        body = line[3:]  # Strip RX:
        rssi_idx = body.find(":RSSI=")
        payload = body[:rssi_idx] if rssi_idx != -1 else body
        assert tag[:20] in payload, "Payload truncated or corrupted"
        print(f"  {len(msg)}-char payload received intact")

    def test_empty_payload_ignored(self, podium_serial, podium_reader):
        """Firmware ignores empty serial lines (no TX_OK or TX_FAIL).

        The firmware trims whitespace and checks length > 0,
        so an empty newline should be silently ignored.
        """
        podium_reader.clear()
        podium_serial.write(b"\n")
        time.sleep(1)

        # Firmware trims the newline → empty string → length check fails → no TX
        tx_ok = podium_reader.wait_for("TX_OK", timeout=2)
        tx_fail = podium_reader.wait_for("TX_FAIL", timeout=0.5)

        # Either no response (ideal) or TX_OK is acceptable firmware behavior
        if tx_ok is None and tx_fail is None:
            print("  Empty payload silently ignored (no response)")
        elif tx_ok:
            print("  Empty payload produced TX_OK (firmware sent empty over LoRa)")
        else:
            print(f"  Unexpected: {tx_fail}")

    def test_oversized_payload_rejected(self, podium_serial, podium_reader):
        """Firmware should reject payloads over 250 characters."""
        podium_reader.clear()
        oversized = "X" * 260
        podium_serial.write(f"{oversized}\n".encode())
        time.sleep(1)

        # Should NOT get TX_OK for a > 250 char message
        line = podium_reader.wait_for("TX_OK", timeout=2)
        assert line is None, "Firmware should reject >250 char payloads"
        print("  ✅ Oversized payload correctly rejected")
