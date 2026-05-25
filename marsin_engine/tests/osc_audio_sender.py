#!/usr/bin/env python3
"""
Reference OSC sender for MarsinEngine smoke tests.

Two modes:

  --value MODE: one-shot send of a single float.
      python3 osc_audio_sender.py --addr /marsin/param/speed --value 0.5

  --mic   MODE: continuous send of mic-derived RMS amplitude
                at the requested rate (default 60 Hz).
      python3 osc_audio_sender.py --addr /marsin/audio/level --mic --rate 60

  --sweep MODE: synthetic 0..1 sweep at the requested rate, no mic.
      python3 osc_audio_sender.py --addr /marsin/stems/vocals --sweep --rate 30

Install once:
    pip install python-osc sounddevice numpy

Defaults:
    host=127.0.0.1, port=10000  (matches the rig OSC port)

See docs/24_osc_integration.md §5 and the impl plan Phase 5 for
context. Pure stdlib + the two pip packages — no docker, no node,
no browser. Safe to run from anywhere on the LAN.
"""

import argparse
import math
import sys
import time

try:
    from pythonosc.udp_client import SimpleUDPClient
except ImportError:
    print("Missing dependency. Run: pip install python-osc", file=sys.stderr)
    sys.exit(1)


def one_shot(client, addr, value):
    client.send_message(addr, float(value))
    print(f"sent  {addr} = {value}")


def sweep_loop(client, addr, rate_hz):
    period_s = 1.0 / rate_hz
    t0 = time.monotonic()
    sent = 0
    last_log = t0
    while True:
        t = time.monotonic() - t0
        # 0..1 triangle wave, 0.5 Hz cycle.
        v = abs(((t * 0.5) % 1.0) * 2.0 - 1.0)
        client.send_message(addr, float(v))
        sent += 1
        now = time.monotonic()
        if now - last_log >= 1.0:
            print(f"sent {sent} pkt/s  last={v:.3f}")
            sent = 0
            last_log = now
        # Sleep just enough to keep cadence; OS jitter is fine.
        time.sleep(period_s)


def mic_loop(client, addr, rate_hz):
    try:
        import sounddevice as sd
        import numpy as np
    except ImportError:
        print("Mic mode needs: pip install sounddevice numpy", file=sys.stderr)
        sys.exit(1)
    block = max(64, int(48000 / rate_hz))
    sr = 48000
    print(f"mic mode: block={block} samples @ {sr} Hz → ~{sr / block:.0f} Hz send rate")
    last_log = time.monotonic()
    sent = 0

    def cb(indata, frames, time_info, status):
        nonlocal sent, last_log
        # RMS of the mono mix, normalized roughly to 0..1 with a soft
        # cap so a loud burst doesn't blow past the receiving clamp.
        mono = indata.mean(axis=1) if indata.ndim > 1 else indata
        rms = float(np.sqrt(np.mean(mono.astype('float32') ** 2)))
        # Light dB-ish curve so quiet ambient still moves the bar.
        v = max(0.0, min(1.0, math.tanh(rms * 6.0)))
        client.send_message(addr, v)
        sent += 1
        now = time.monotonic()
        if now - last_log >= 1.0:
            print(f"mic  {sent} pkt/s  last={v:.3f}")
            sent = 0
            last_log = now

    with sd.InputStream(channels=1, samplerate=sr, blocksize=block, callback=cb):
        while True:
            time.sleep(1.0)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--port', type=int, default=10000)
    p.add_argument('--addr', default='/marsin/stems/vocals',
                   help='OSC address (default: /marsin/stems/vocals)')
    p.add_argument('--rate', type=float, default=60.0, help='Hz for --mic / --sweep modes')
    grp = p.add_mutually_exclusive_group(required=True)
    grp.add_argument('--value', type=float, help='Send a one-shot float and exit.')
    grp.add_argument('--mic', action='store_true', help='Continuous mic-derived RMS at --rate.')
    grp.add_argument('--sweep', action='store_true', help='Continuous synthetic 0..1 sweep at --rate.')
    args = p.parse_args()

    print(f'→ {args.host}:{args.port}  {args.addr}')
    client = SimpleUDPClient(args.host, args.port)

    if args.value is not None:
        one_shot(client, args.addr, args.value)
    elif args.mic:
        try:
            mic_loop(client, args.addr, args.rate)
        except KeyboardInterrupt:
            print('\nstopped.')
    elif args.sweep:
        try:
            sweep_loop(client, args.addr, args.rate)
        except KeyboardInterrupt:
            print('\nstopped.')


if __name__ == '__main__':
    main()
