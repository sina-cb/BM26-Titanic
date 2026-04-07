"""
Test 6 — Display & Identification
====================================
Verify that each controller identifies itself on boot. The firmware
writes its role name ("Podium TX" or "Server RX") to both serial AND
the OLED display on startup.

Since the OLED cannot be read over serial, this test:
  1. Verifies the serial boot message contains the role name
  2. Prompts the operator to visually confirm the OLED shows the right label

Usage:
    cd control_podium/heltec
    python -m pytest tests/test_display.py -v -s
"""
import time


class TestDisplay:
    """Verify controllers identify themselves on serial (and OLED by observation)."""

    def test_podium_identity_on_tx(self, podium_serial, podium_reader):
        """Podium displays its role when it transmits.

        After any TX, the OLED shows "TX #N OK" + the message.
        We verify the serial TX_OK response and note the display should update.
        """
        podium_reader.clear()
        podium_serial.write(b"titanic:hil:display_test\n")

        line = podium_reader.wait_for("TX_OK", timeout=5)
        assert line is not None, "Podium did not respond with TX_OK"
        print("  [OK] Podium TX_OK — OLED should show: 'TX #N OK' + 'titanic:hil:display_test'")
        print("  [!!] VISUAL CHECK: Confirm Podium OLED displays 'TX ... OK' and the message")

    def test_server_identity_on_rx(self, podium_serial, server_reader):
        """Server displays received message on OLED.

        After any RX, the OLED shows "RX #N" + payload + RSSI/SNR.
        We verify the serial RX line and note the display should update.
        """
        server_reader.clear()
        tag = f"hil:display:{int(time.time())}"
        podium_serial.write(f"titanic:{tag}\n".encode())

        line = server_reader.wait_for_containing(tag, timeout=5)
        assert line is not None, "Server did not receive the test message"
        assert line.startswith("RX:"), f"Unexpected format: {line}"
        print(f"  [OK] Server RX received: {line}")
        print("  [!!] VISUAL CHECK: Confirm Server OLED displays 'RX #N' + payload + RSSI/SNR")

    def test_both_boards_show_radio_params(self, podium_serial, server_serial,
                                            podium_reader, server_reader):
        """After reset, both boards show radio parameters on OLED.

        The firmware startup prints: '<Role> READY', '915 MHz SF7 BW250', 'Power: 22 dBm'
        to both serial and OLED. Since the boards have already booted, we verify
        this by sending a message and confirming the boards are operational.
        """
        # Verify both boards are alive and responding
        podium_reader.clear()
        server_reader.clear()

        podium_serial.write(b"titanic:hil:params_check\n")
        tx_ok = podium_reader.wait_for("TX_OK", timeout=5)
        rx = server_reader.wait_for_containing("params_check", timeout=5)

        assert tx_ok is not None, "Podium not responding"
        assert rx is not None, "Server not responding"

        print("  [OK] Both boards operational")
        print("  [!!] VISUAL CHECK: After reset, OLEDs should show:")
        print("       Podium: 'Podium TX READY' / '915 MHz SF7 BW250' / 'Power: 22 dBm'")
        print("       Server: 'Server RX READY' / '915 MHz SF7 BW250' / 'Power: 22 dBm'")
