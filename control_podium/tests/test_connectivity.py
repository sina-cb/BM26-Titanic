"""
Test 1 — Basic Connectivity
==============================
Verify both Heltec V4 boards are alive and responding on serial.

Usage:
    cd control_podium/heltec
    python -m pytest tests/test_connectivity.py -v -s
"""
import time


class TestConnectivity:
    """Verify both controllers are alive and serial is working."""

    def test_podium_serial_open(self, podium_serial):
        """Podium serial port is open and writable."""
        assert podium_serial.is_open, "Podium serial port not open"
        print(f"  ✅ Podium open on {podium_serial.port}")

    def test_server_serial_open(self, server_serial):
        """Server serial port is open and writable."""
        assert server_serial.is_open, "Server serial port not open"
        print(f"  ✅ Server open on {server_serial.port}")

    def test_podium_tx_ok(self, podium_serial, podium_reader):
        """Podium firmware responds with TX_OK when sending a message."""
        podium_reader.clear()
        podium_serial.write(b"titanic:hil:connectivity\n")

        line = podium_reader.wait_for("TX_OK", timeout=5)
        assert line is not None, "Podium did not respond with TX_OK within 5s"
        print(f"  ✅ Podium TX_OK received")

    def test_server_tx_ok(self, server_serial, server_reader):
        """Server firmware responds with TX_OK when sending a message."""
        server_reader.clear()
        server_serial.write(b"titanic:hil:server_tx\n")

        line = server_reader.wait_for("TX_OK", timeout=5)
        assert line is not None, "Server did not respond with TX_OK within 5s"
        print(f"  ✅ Server TX_OK received")
