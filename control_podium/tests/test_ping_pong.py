"""
Test 3 — Ping/Pong Latency
==============================
Tests the full round-trip: Podium sends ping → Server auto-pongs → Podium receives.
Measures RTT latency over LoRa.

Requires: server_companion.py running (or server firmware with auto-pong support).

NOTE: The server firmware does NOT auto-pong — only the server_companion does.
      For this test we simulate the pong by having the server send a response
      when it receives a ping. This tests the bidirectional LoRa path.

Usage:
    cd control_podium/heltec
    python -m pytest tests/test_ping_pong.py -v -s
"""
import time


class TestPingPong:
    """Test bidirectional LoRa communication with latency measurement."""

    def test_roundtrip(self, podium_serial, server_serial, podium_reader, server_reader):
        """Send from Podium, receive on Server, reply from Server, receive on Podium.

        Full round trip:
          Podium → LoRa → Server (serial RX line)
          Server → LoRa → Podium (serial RX line)
        """
        server_reader.clear()
        podium_reader.clear()

        tag = f"hil:rtt:{int(time.time())}"
        start = time.time()

        # Step 1: Podium sends
        podium_serial.write(f"titanic:{tag}\n".encode())
        print(f"  📤 Podium sent: titanic:{tag}")

        # Step 2: Wait for Server to receive
        rx_line = server_reader.wait_for_containing(tag, timeout=5)
        leg1 = time.time() - start
        assert rx_line is not None, f"Server did not receive within 5s"
        print(f"  📥 Server received ({leg1*1000:.0f}ms): {rx_line}")

        # Step 3: Server sends pong back
        pong_tag = f"hil:pong:{int(time.time())}"
        server_serial.write(f"titanic:{pong_tag}\n".encode())
        print(f"  📤 Server sent: titanic:{pong_tag}")

        # Step 4: Wait for Podium to receive pong
        pong_line = podium_reader.wait_for_containing(pong_tag, timeout=5)
        rtt = time.time() - start
        assert pong_line is not None, "Podium did not receive pong within 5s"
        print(f"  📥 Podium received ({rtt*1000:.0f}ms): {pong_line}")

        print(f"\n  🏓 Full round-trip: {rtt*1000:.0f}ms (leg1: {leg1*1000:.0f}ms)")

        # Sanity: RTT should be under 3 seconds for SF7 BW250
        assert rtt < 3.0, f"RTT too high: {rtt:.2f}s (expected <3s for SF7/BW250)"

    def test_latency_10x(self, podium_serial, server_serial,
                          podium_reader, server_reader):
        """Run 10 ping-pong round trips and report statistics."""
        latencies = []

        for i in range(10):
            server_reader.clear()
            podium_reader.clear()

            tag = f"hil:lat{i}:{int(time.time())}"
            start = time.time()

            # Podium → Server
            podium_serial.write(f"titanic:{tag}\n".encode())
            rx_line = server_reader.wait_for_containing(tag, timeout=5)
            if rx_line is None:
                print(f"  ❌ Ping {i+1}/10: Server did not receive")
                continue

            # Server → Podium (echo back)
            pong = f"titanic:pong:{tag}"
            server_serial.write(f"{pong}\n".encode())
            pong_line = podium_reader.wait_for_containing(f"pong:{tag}", timeout=5)
            rtt = time.time() - start

            if pong_line:
                latencies.append(rtt)
                icon = "✅"
            else:
                icon = "❌"

            print(f"  {icon} Ping {i+1:2d}/10: RTT={rtt*1000:.0f}ms")
            time.sleep(0.5)  # Small gap between pings

        assert len(latencies) >= 8, (
            f"Too many dropped pings: {10 - len(latencies)}/10 lost"
        )

        avg = sum(latencies) / len(latencies) * 1000
        min_l = min(latencies) * 1000
        max_l = max(latencies) * 1000
        print(f"\n  📊 Latency Stats ({len(latencies)}/10 successful)")
        print(f"     Avg: {avg:.0f}ms  Min: {min_l:.0f}ms  Max: {max_l:.0f}ms")
