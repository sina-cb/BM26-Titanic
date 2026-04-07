"""
Test 4 — Radio Signal Quality
================================
Measures RSSI and SNR from received packets to verify link quality.

Usage:
    cd control_podium/heltec
    python -m pytest tests/test_signal_quality.py -v -s
"""
import time
import re


def parse_rx_line(line):
    """Parse RX:<payload>:RSSI=<r>:SNR=<s> into (payload, rssi, snr)."""
    rssi = None
    snr = None
    payload = ""

    parts = line.split(":")
    if len(parts) >= 2:
        payload = parts[1]
    for p in parts:
        if p.startswith("RSSI="):
            try:
                rssi = float(p[5:])
            except ValueError:
                pass
        elif p.startswith("SNR="):
            try:
                snr = float(p[4:])
            except ValueError:
                pass
    return payload, rssi, snr


class TestSignalQuality:
    """Measure and validate radio link quality metrics."""

    def test_rssi_in_range(self, podium_serial, server_reader):
        """RSSI should be between -120 dBm and -20 dBm for a valid link."""
        server_reader.clear()
        tag = f"hil:rssi:{int(time.time())}"
        podium_serial.write(f"titanic:{tag}\n".encode())

        line = server_reader.wait_for_containing(tag, timeout=5)
        assert line is not None, "No RX received"

        _, rssi, snr = parse_rx_line(line)
        assert rssi is not None, f"Could not parse RSSI from: {line}"
        assert -120 <= rssi <= -20, f"RSSI {rssi} dBm out of expected range [-120, -20]"
        print(f"  📶 RSSI: {rssi} dBm (valid range)")
        if snr is not None:
            print(f"  📶 SNR:  {snr} dB")

    def test_snr_positive(self, podium_serial, server_reader):
        """SNR should be positive for desk-distance testing."""
        server_reader.clear()
        tag = f"hil:snr:{int(time.time())}"
        podium_serial.write(f"titanic:{tag}\n".encode())

        line = server_reader.wait_for_containing(tag, timeout=5)
        assert line is not None, "No RX received"

        _, rssi, snr = parse_rx_line(line)
        assert snr is not None, f"Could not parse SNR from: {line}"
        # At desk distance, SNR should be well positive
        assert snr > 0, f"SNR {snr} dB is not positive — check antenna connection"
        print(f"  📶 SNR: {snr} dB (positive — good link)")

    def test_signal_stability_5x(self, podium_serial, server_reader):
        """Send 5 packets and verify RSSI/SNR are consistent (±10 dBm)."""
        rssis = []
        snrs = []

        for i in range(5):
            server_reader.clear()
            tag = f"hil:stab{i}:{int(time.time())}"
            podium_serial.write(f"titanic:{tag}\n".encode())

            line = server_reader.wait_for_containing(tag, timeout=5)
            if line:
                _, rssi, snr = parse_rx_line(line)
                if rssi is not None:
                    rssis.append(rssi)
                if snr is not None:
                    snrs.append(snr)
                print(f"  #{i+1}: RSSI={rssi} SNR={snr}")
            else:
                print(f"  #{i+1}: ❌ DROPPED")

            time.sleep(0.5)

        assert len(rssis) >= 4, f"Too many drops: only {len(rssis)}/5 received"

        spread = max(rssis) - min(rssis)
        avg_rssi = sum(rssis) / len(rssis)
        print(f"\n  📊 RSSI: avg={avg_rssi:.1f} dBm, spread={spread:.1f} dBm")

        assert spread < 15, (
            f"RSSI spread {spread:.1f} dBm too large — unstable signal"
        )
        print(f"  ✅ Signal stable (spread < 15 dBm)")
