"""
Test 7 — Latency Distribution Analysis
==========================================
Sends 25 messages from Podium → Server and measures the one-way
send-to-receive latency for each. Reports full statistical distribution.

Usage:
    cd control_podium/heltec
    python -m pytest tests/test_latency_distribution.py -v -s
"""
import time
import math


N_SAMPLES = 25
SPACING = 0.8  # seconds between sends


class TestLatencyDistribution:
    """Measure one-way latency distribution over 25 sends."""

    def test_p2s_latency_distribution(self, podium_serial, server_reader):
        """Send 25 messages Podium→Server, measure and report latency distribution."""
        latencies = []
        dropped = []

        print(f"\n  {'='*55}")
        print(f"  Latency Distribution Test — {N_SAMPLES} packets P2S")
        print(f"  {'='*55}\n")

        for i in range(1, N_SAMPLES + 1):
            server_reader.clear()
            tag = f"hil:dist:{i}:{int(time.time())}"
            msg = f"titanic:{tag}"

            t0 = time.time()
            podium_serial.write(f"{msg}\n".encode())

            line = server_reader.wait_for_containing(tag, timeout=5)
            t1 = time.time()
            dt = (t1 - t0) * 1000  # ms

            if line:
                latencies.append(dt)
                print(f"  #{i:2d}  {dt:6.1f} ms  {'*' * int(dt / 10)}")
            else:
                dropped.append(i)
                print(f"  #{i:2d}  DROPPED")

            time.sleep(SPACING)

        # ── Statistics ──────────────────────────────────────
        n = len(latencies)
        assert n >= 20, f"Too many drops: only {n}/{N_SAMPLES} received"

        avg = sum(latencies) / n
        variance = sum((x - avg) ** 2 for x in latencies) / n
        std = math.sqrt(variance)
        mn = min(latencies)
        mx = max(latencies)
        med = sorted(latencies)[n // 2]
        p95 = sorted(latencies)[int(n * 0.95)]
        p99 = sorted(latencies)[min(int(n * 0.99), n - 1)]
        jitter = mx - mn

        print(f"\n  {'='*55}")
        print(f"  LATENCY DISTRIBUTION RESULTS")
        print(f"  {'='*55}")
        print(f"  Samples:    {n}/{N_SAMPLES} received ({len(dropped)} dropped)")
        print(f"  {'─'*40}")
        print(f"  Min:        {mn:.1f} ms")
        print(f"  Max:        {mx:.1f} ms")
        print(f"  Mean:       {avg:.1f} ms")
        print(f"  Median:     {med:.1f} ms")
        print(f"  Std Dev:    {std:.1f} ms")
        print(f"  P95:        {p95:.1f} ms")
        print(f"  P99:        {p99:.1f} ms")
        print(f"  Jitter:     {jitter:.1f} ms (max - min)")
        if dropped:
            print(f"  Dropped:    seq {dropped}")
        print(f"  {'─'*40}")

        # Histogram (50ms buckets)
        bucket_size = 50
        lo = int(mn // bucket_size) * bucket_size
        hi = int(mx // bucket_size + 1) * bucket_size
        buckets = {}
        for l in latencies:
            b = int(l // bucket_size) * bucket_size
            buckets[b] = buckets.get(b, 0) + 1

        max_count = max(buckets.values()) if buckets else 1
        print(f"\n  Histogram ({bucket_size}ms buckets):")
        for b in range(lo, hi + bucket_size, bucket_size):
            count = buckets.get(b, 0)
            bar = '#' * int(count / max_count * 30) if count else ''
            pct = count / n * 100 if n else 0
            print(f"  {b:4d}-{b+bucket_size:4d}ms  |{bar:<30s}| {count:2d} ({pct:4.1f}%)")

        print(f"  {'='*55}\n")

        # Assertions
        assert avg < 500, f"Mean latency {avg:.0f}ms too high (expected <500ms)"
        assert std < 150, f"Std dev {std:.0f}ms too high (expected <150ms for stable link)"
