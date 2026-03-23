# Meshtastic Timing & SLA Research
**Date:** 2026-03-21  
**Purpose:** Evaluate whether Meshtastic is suitable for real-time event handling (button press → lighting response).

---

## TL;DR

| Metric | SHORT_FAST | MEDIUM_FAST (current) | LONG_FAST (default) |
|--------|------------|----------------------|---------------------|
| Airtime (30-byte msg) | **~46 ms** | **~300 ms** | **~900 ms** |
| Data rate | 10.94 kbps | 3.52 kbps | 1.07 kbps |
| Link budget | 140 dB | 148 dB | 153 dB |
| Best-case 1-hop latency | **~200 ms** | **~800 ms** | **~2 sec** |
| Worst-case (with retries) | ~3 sec | ~8 sec | ~15 sec |
| Max packets/min (1% duty) | ~13 | ~3 | ~1 |

**Verdict:** Meshtastic with SHORT_FAST can deliver events in **200-500ms best case** (within the same LoRa channel, 1 hop, no contention). This is acceptable for theatrical button-to-light latency. MEDIUM_FAST adds ~800ms. LONG_FAST is unsuitable.

> [!WARNING]
> Meshtastic is designed for **asynchronous messaging**, not real-time control loops.
> It uses a random pre-TX backoff (CSMA/CA), retry logic, and flooding — all of which
> add unpredictable latency. For guaranteed sub-100ms response, use WiFi, BLE direct, or wired.

---

## Latency Breakdown

A single Podium→Server message goes through these stages:

| Stage | SHORT_FAST | MEDIUM_FAST |
|-------|-----------|-------------|
| 1. Python sendText → USB serial | ~5 ms | ~5 ms |
| 2. Firmware processes protobuf | ~10 ms | ~10 ms |
| 3. CSMA/CA random backoff | 0–200 ms | 0–200 ms |
| 4. LoRa TX (time on air) | **46 ms** | **~300 ms** |
| 5. Server firmware RX + decode | ~10 ms | ~10 ms |
| 6. ACK TX (Server → Podium) | **46 ms** | **~300 ms** |
| **Total (best case)** | **~120 ms** | **~530 ms** |
| **Total (typical)** | **~200–400 ms** | **~700–1200 ms** |

The dominant variable is **step 3** (CSMA/CA backoff). The firmware waits a random time to avoid channel collisions — this can be 0ms if the channel is clear, or up to 200ms if it senses activity.

If an ACK is not received, the firmware retries up to **3 times** with increasing backoff, adding up to **seconds** of additional latency.

---

## LoRa Modem Preset Parameters

| Preset | SF | BW (kHz) | CR | Range | Best For |
|--------|----|---------|----|-------|----------|
| SHORT_FAST | 7 | 250 | 4/5 | ~1 km | **Low-latency events** |
| SHORT_SLOW | 8 | 250 | 4/5 | ~2 km | Reliability over short range |
| MEDIUM_FAST | 11 | 250 | 4/8 | ~5 km | Balanced |
| MEDIUM_SLOW | 11 | 250 | 4/8 | ~5 km | More reliable medium range |
| LONG_FAST | 11 | 250 | 4/5 | ~10 km | General use |
| VERY_LONG_SLOW | 12 | 125 | 4/8 | ~16+ km | Emergency, off-grid |

---

## Protocol Overhead

Every Meshtastic packet carries:
- 4-byte packet header
- 13 bytes of communication identifiers (source, dest, IDs)
- Protobuf-encoded payload
- **Total overhead: ~17 bytes per message**

A 30-byte event string like `titanic:btn:scene3` becomes ~47 bytes on the air.

---

## Duty Cycle & Fair Use

The 915 MHz ISM band (US) has no strict duty cycle limit (unlike EU 868 MHz at 1%), but Meshtastic imposes **soft airtime limits** to be a good neighbor:
- Default: ~10% max airtime per hour
- With hop_limit=1 and CLIENT_MUTE on Server: no relay overhead

At MEDIUM_FAST, each send+ACK cycle consumes ~600ms of airtime. You can sustain about **6 messages/minute** without hitting the soft limit.

At SHORT_FAST, each cycle is ~100ms, allowing **~60 messages/minute**.

---

## Recommendation for Titanic Event Handling

### Option A: Switch to SHORT_FAST (recommended for your use case)

Your nodes are at close range (SNR +10.5 dB). You don't need 5+ km range. SHORT_FAST gives:
- **~200ms typical latency** (button press to Server seeing the event)
- 10.94 kbps throughput
- ~60 events/minute capacity

Change in `.config.yaml`:
```yaml
radio:
  modem_preset: "SHORT_FAST"
```

### Option B: Keep MEDIUM_FAST

Acceptable if you can tolerate ~800ms latency. Gives more margin for range and reliability.

### Option C: Bypass LoRa for latency-critical events

If sub-100ms is truly required (e.g., lighting cue sync to music):
- Use **ESP-NOW** (WiFi-based, ~5ms latency, no infrastructure needed)
- Use **BLE direct** (ESP32 ↔ ESP32 BLE, ~20ms latency)
- Use **wired serial** (USB or RS-485, <1ms)
- Keep Meshtastic for non-latency-critical features (status, configuration, monitoring)

---

## Why the ACK Callbacks Were Timing Out

The `meshtastic-python` `sendText()` API has a subtle parameter:

```python
iface.sendText(
    text,
    destinationId=server_id,
    wantAck=True,
    onResponse=callback,
    onResponseAckPermitted=True,   # ← THIS WAS MISSING
)
```

Without `onResponseAckPermitted=True`, the `onResponse` callback **only fires for data responses and NAKs**, NOT for firmware-level ACKs. This is documented in the meshtastic-python source but easy to miss.

This is why all 10 messages timed out even though 6/10 arrived on the phone — the messages were delivered, the Server sent ACKs, but the Python callback was silently ignoring them.
