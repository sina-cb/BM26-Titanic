"""
Test 2 — End-to-End LoRa Messaging
=====================================
Send real messages over LoRa between Podium and Server, verify delivery.

Tests exercise the full radio stack:
  Serial TX → firmware encode → LoRa TX → LoRa RX → firmware decode → Serial RX

NOTE: Each test takes ~2-5 seconds due to LoRa transmission time.

Usage:
    cd control_podium/heltec
    python -m pytest tests/test_lora_messaging.py -v -s
"""
import time
import pytest


class TestLoRaMessaging:
    """Send messages between Podium and Server over raw LoRa."""

    def test_podium_to_server(self, podium_serial, server_reader, config):
        """Send from Podium → received on Server."""
        prefix = config.get("protocol", {}).get("prefix", "titanic:")
        tag = f"hil:p2s:{int(time.time())}"
        msg = f"{prefix}{tag}"

        server_reader.clear()
        podium_serial.write(f"{msg}\n".encode())
        print(f"  📤 Podium sent: {msg}")

        # Wait for TX_OK on podium (implicit — we trust it from connectivity test)
        time.sleep(0.5)

        # Wait for RX on server
        line = server_reader.wait_for_containing(tag, timeout=5)
        assert line is not None, f"Server did not receive '{tag}' within 5s"
        assert line.startswith("RX:"), f"Unexpected format: {line}"

        # Parse RSSI/SNR
        parts = line.split(":")
        rssi = [p for p in parts if p.startswith("RSSI=")]
        snr = [p for p in parts if p.startswith("SNR=")]
        print(f"  📥 Server received: {line}")
        if rssi:
            print(f"     RSSI: {rssi[0][5:]}")
        if snr:
            print(f"     SNR:  {snr[0][4:]}")

    def test_server_to_podium(self, podium_serial, server_serial, podium_reader, config):
        """Send from Server → received on Podium.

        NOTE: Podium firmware only enters RX mode after a TX
        (radio.startReceive is called after transmit). So we first
        send a dummy message from podium to prime the radio.
        """
        prefix = config.get("protocol", {}).get("prefix", "titanic:")
        tag = f"hil:s2p:{int(time.time())}"
        msg = f"{prefix}{tag}"

        # Prime podium into RX mode by sending a dummy TX first
        podium_serial.write(b"titanic:hil:prime_rx\n")
        time.sleep(1.5)  # Wait for TX + startReceive

        podium_reader.clear()
        server_serial.write(f"{msg}\n".encode())
        print(f"  Podium sent: [prime_rx], Server sent: {msg}")

        line = podium_reader.wait_for_containing(tag, timeout=8)
        assert line is not None, (
            f"Podium did not receive '{tag}' within 8s. "
            "Podium may not be in RX mode — check firmware."
        )
        assert line.startswith("RX:"), f"Unexpected format: {line}"
        print(f"  Podium received: {line}")

    def test_protocol_prefix_preserved(self, podium_serial, server_reader, config):
        """Received payload always contains the titanic: protocol prefix."""
        prefix = config.get("protocol", {}).get("prefix", "titanic:")
        tag = f"hil:prefix:{int(time.time())}"
        msg = f"{prefix}{tag}"

        server_reader.clear()
        podium_serial.write(f"{msg}\n".encode())

        line = server_reader.wait_for_containing(tag, timeout=5)
        assert line is not None, "Message not received"

        # Extract payload from RX:<payload>:RSSI=<r>:SNR=<s>
        # Payload may contain colons (e.g. "titanic:hil:prefix:123")
        # Strategy: strip "RX:" prefix, then remove trailing :RSSI=...:SNR=...
        body = line[3:]  # Remove "RX:"
        # Find RSSI= marker to split off metadata
        rssi_idx = body.find(":RSSI=")
        payload = body[:rssi_idx] if rssi_idx != -1 else body

        assert payload.startswith(prefix), (
            f"Payload '{payload}' doesn't start with prefix '{prefix}'"
        )
        print(f"  Prefix preserved: {payload}")

    @pytest.mark.xfail(
        reason="Raw LoRa SF7 BW250 has ~30ms airtime per packet, but back-to-back "
               "sends may lose packets if firmware doesn't re-enter RX fast enough.",
        strict=False,
    )
    def test_multiple_messages(self, podium_serial, server_reader, config):
        """Send 5 sequential messages and verify all are received."""
        prefix = config.get("protocol", {}).get("prefix", "titanic:")
        ts = int(time.time())
        base_tag = f"hil:multi:{ts}"

        server_reader.clear()
        n_messages = 5
        spacing = 1.5  # seconds between sends

        for seq in range(1, n_messages + 1):
            msg = f"{prefix}{base_tag}:seq={seq}"
            podium_serial.write(f"{msg}\n".encode())
            print(f"  📤 Sent seq={seq}: {msg}")
            time.sleep(spacing)

        # Wait for all to arrive
        time.sleep(2)
        received = [
            l for l in server_reader.lines
            if base_tag in l and l.startswith("RX:")
        ]

        print(f"  📊 Received {len(received)}/{n_messages} messages")
        for r in received:
            print(f"     {r}")

        assert len(received) == n_messages, (
            f"Expected {n_messages} messages, got {len(received)}"
        )
