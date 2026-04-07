"""
Server Companion — Raw LoRa (Heltec V4)
=========================================
Connects to the Server node via USB serial. Receives LoRa events
from the Podium and dispatches them. Can also send responses back.

Usage:
    python companions/server_companion.py
    python companions/server_companion.py --headless

Interactive commands:
    <text>           Send raw text back to Podium over LoRa
    /status          Show connection stats
    /events          Show recent event log
    /quit            Exit

Headless mode (--headless):
    Runs without interactive prompt. Logs all events.
    Use Ctrl+C to stop.
"""
import argparse
import sys
import time
import threading
import json
from pathlib import Path
from datetime import datetime
from collections import deque

import serial
import yaml


ROLE = "server"
BASE = Path(__file__).parent.parent
LOG_DIR = BASE / "logs"

import sys
sys.path.insert(0, str(BASE))
from utils import discovery, config_store

COLORS = {
    "reset":  "\033[0m",
    "green":  "\033[92m",
    "blue":   "\033[94m",
    "yellow": "\033[93m",
    "cyan":   "\033[96m",
    "red":    "\033[91m",
    "dim":    "\033[2m",
    "bold":   "\033[1m",
    "magenta": "\033[95m",
}


def ts():
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


def load_config():
    config = config_store.load()
    # Resolve port by MAC for our role
    node = config.get("nodes", {}).get(ROLE, {})
    mac = node.get("mac")
    if mac:
        port = discovery.find_port_by_mac(mac)
        if port:
            node["port"] = port
    return config


class ServerCompanion:
    def __init__(self, config, headless=False):
        self.config = config
        self.port = config["nodes"][ROLE]["port"]
        self.baud = config.get("serial", {}).get("baud", 115200)
        self.prefix = config.get("protocol", {}).get("prefix", "titanic:")
        self.headless = headless
        self.ser = None
        self.running = False
        self.stats = {"tx": 0, "rx": 0, "tx_ok": 0, "tx_fail": 0, "errors": 0, "events": 0}
        self.recent_events = deque(maxlen=50)
        self.C = COLORS

        # Ensure log directory exists
        LOG_DIR.mkdir(exist_ok=True)
        self.log_file = LOG_DIR / f"server_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

    def log(self, msg):
        """Append to log file."""
        with open(self.log_file, "a") as f:
            f.write(f"[{ts()}] {msg}\n")

    def connect(self) -> bool:
        """Open serial connection with retry."""
        C = self.C
        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                self.ser = serial.Serial(self.port, self.baud, timeout=0.1)
                time.sleep(0.5)
                return True
            except serial.SerialException as e:
                print(f"  {C['red']}❌ Attempt {attempt}/{max_retries}: Cannot open {self.port}: {e}{C['reset']}")
                if attempt < max_retries:
                    time.sleep(2)
        return False

    def wait_for_ready(self, timeout=10) -> bool:
        """Wait for READY signal from firmware."""
        C = self.C
        print(f"  {C['dim']}Waiting for firmware READY...{C['reset']}", end="", flush=True)
        deadline = time.time() + timeout
        while time.time() < deadline:
            line = self.ser.readline().decode("utf-8", errors="replace").strip()
            if line == "READY":
                print(f" {C['green']}✅{C['reset']}")
                return True
            if line:
                print(f"\n  {C['dim']}  firmware: {line}{C['reset']}", end="", flush=True)
        print(f"\n  {C['yellow']}⚠️  No READY signal — proceeding anyway{C['reset']}")
        return False

    def send(self, msg: str):
        """Send a response back to podium over LoRa."""
        C = self.C
        self.stats["tx"] += 1
        send_ts = ts()
        self.ser.write(f"{msg}\n".encode("utf-8"))
        self.log(f"TX: {msg}")
        print(f"  {C['green']}📤 [{send_ts}] #{self.stats['tx']:03d}  → LoRa: {msg}{C['reset']}")

    def dispatch_event(self, event_id: str, rssi: str, snr: str):
        """Handle a received titanic: event."""
        C = self.C
        recv_ts = ts()
        event = {
            "time": recv_ts,
            "event_id": event_id,
            "rssi": rssi,
            "snr": snr,
        }
        self.recent_events.append(event)
        self.stats["events"] += 1
        self.log(f"EVENT: {event_id} RSSI={rssi} SNR={snr}")

        # Parse event type
        parts = event_id.split(":", 1)
        event_type = parts[0] if parts else event_id
        event_arg = parts[1] if len(parts) > 1 else ""

        if event_type == "ping":
            # Auto-respond with pong
            self.send(f"{self.prefix}pong")
            print(f"  {C['magenta']}🏓 [{recv_ts}] PING received — sent PONG{C['reset']}")
        elif event_type == "scene":
            print(f"  {C['blue']}🎬 [{recv_ts}] SCENE CHANGE → {event_arg}  "
                  f"RSSI:{rssi} SNR:{snr}{C['reset']}")
        elif event_type == "cmd":
            print(f"  {C['yellow']}⚡ [{recv_ts}] COMMAND → {event_arg}  "
                  f"RSSI:{rssi} SNR:{snr}{C['reset']}")
        elif event_type == "fx":
            print(f"  {C['magenta']}✨ [{recv_ts}] EFFECT → {event_arg}  "
                  f"RSSI:{rssi} SNR:{snr}{C['reset']}")
        else:
            print(f"  {C['cyan']}📨 [{recv_ts}] EVENT → {event_id}  "
                  f"RSSI:{rssi} SNR:{snr}{C['reset']}")

    def reader_loop(self):
        """Background thread: read serial output from firmware."""
        C = self.C
        while self.running:
            try:
                raw = self.ser.readline()
                if not raw:
                    continue
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue

                self.log(f"FW: {line}")

                if line.startswith("RX:"):
                    # Parse: RX:<payload>:RSSI=<r>:SNR=<s>
                    parts = line.split(":")
                    payload = parts[1] if len(parts) > 1 else "?"
                    rssi = ""
                    snr = ""
                    for p in parts[2:]:
                        if p.startswith("RSSI="):
                            rssi = p[5:]
                        elif p.startswith("SNR="):
                            snr = p[4:]

                    self.stats["rx"] += 1

                    # Check if this is a titanic: event
                    if payload.startswith(self.prefix):
                        event_id = payload[len(self.prefix):]
                        self.dispatch_event(event_id, rssi, snr)
                    else:
                        recv_ts = ts()
                        print(f"\r{C['cyan']}  📥 [{recv_ts}] #{self.stats['rx']:03d}  "
                              f"RSSI:{rssi} SNR:{snr}{C['reset']}")
                        print(f"     {C['bold']}{payload}{C['reset']}")

                    if not self.headless:
                        print(f"\n  {C['yellow']}server>{C['reset']} ", end="", flush=True)

                elif line == "TX_OK":
                    self.stats["tx_ok"] += 1

                elif line.startswith("TX_FAIL"):
                    self.stats["tx_fail"] += 1
                    print(f"\r  {C['red']}❌ {line}{C['reset']}")
                    if not self.headless:
                        print(f"\n  {C['yellow']}server>{C['reset']} ", end="", flush=True)

                else:
                    if not self.headless:
                        print(f"\r  {C['dim']}[fw] {line}{C['reset']}")
                        print(f"\n  {C['yellow']}server>{C['reset']} ", end="", flush=True)

            except Exception:
                if self.running:
                    self.stats["errors"] += 1
                    time.sleep(0.01)

    def show_events(self):
        """Print recent events."""
        C = self.C
        print(f"\n  {C['cyan']}{'─' * 50}{C['reset']}")
        print(f"  {C['bold']}Recent Events (last {len(self.recent_events)}){C['reset']}")
        if not self.recent_events:
            print(f"  {C['dim']}No events received yet.{C['reset']}")
        else:
            for ev in self.recent_events:
                print(f"  [{ev['time']}] {ev['event_id']:30s}  RSSI:{ev['rssi']} SNR:{ev['snr']}")
        print(f"  {C['cyan']}{'─' * 50}{C['reset']}\n")

    def show_status(self):
        """Print connection stats."""
        C = self.C
        print(f"\n  {C['cyan']}{'─' * 40}{C['reset']}")
        print(f"  {C['bold']}Connection Stats{C['reset']}")
        print(f"  RX: {self.stats['rx']}  Events: {self.stats['events']}")
        print(f"  TX: {self.stats['tx']}  TX_OK: {self.stats['tx_ok']}  TX_FAIL: {self.stats['tx_fail']}")
        print(f"  Errors: {self.stats['errors']}")
        print(f"  Log: {self.log_file}")
        print(f"  {C['cyan']}{'─' * 40}{C['reset']}\n")

    def run_interactive(self):
        """Main interactive loop."""
        C = self.C
        print(f"\n{C['bold']}{'═' * 55}")
        print(f"  🖥️  SERVER COMPANION (Raw LoRa)")
        print(f"{'═' * 55}{C['reset']}")
        print(f"  {C['dim']}Port: {self.port}  |  Baud: {self.baud}{C['reset']}")
        print(f"  {C['dim']}Commands: /status, /events, /quit{C['reset']}")
        print(f"  {C['dim']}Or type text to send back to Podium{C['reset']}")
        print()

        if not self.connect():
            return

        self.wait_for_ready()
        print(f"\n  {C['green']}🎧 Listening for LoRa events...{C['reset']}\n")

        self.running = True
        reader_thread = threading.Thread(target=self.reader_loop, daemon=True)
        reader_thread.start()

        try:
            while True:
                try:
                    user_input = input(f"  {C['yellow']}server>{C['reset']} ").strip()
                except EOFError:
                    break

                if not user_input:
                    continue

                cmd = user_input.lower()
                if cmd == "/quit":
                    break
                elif cmd == "/status":
                    self.show_status()
                elif cmd == "/events":
                    self.show_events()
                else:
                    self.send(user_input)

        except KeyboardInterrupt:
            pass

        self.running = False
        print(f"\n  {C['dim']}Closing... TX:{self.stats['tx']} RX:{self.stats['rx']} "
              f"Events:{self.stats['events']}{C['reset']}")
        if self.ser:
            self.ser.close()
        print(f"  {C['green']}✅ Server Companion stopped.{C['reset']}")
        print(f"  {C['dim']}Log: {self.log_file}{C['reset']}\n")

    def run_headless(self):
        """Headless mode — no interactive prompt, just log events."""
        C = self.C
        print(f"\n{C['bold']}{'═' * 55}")
        print(f"  🖥️  SERVER COMPANION (Raw LoRa) — HEADLESS")
        print(f"{'═' * 55}{C['reset']}")
        print(f"  {C['dim']}Port: {self.port}  |  Baud: {self.baud}{C['reset']}")
        print(f"  {C['dim']}Log: {self.log_file}{C['reset']}")
        print(f"  {C['dim']}Press Ctrl+C to stop{C['reset']}")
        print()

        if not self.connect():
            sys.exit(1)

        self.wait_for_ready()
        print(f"\n  {C['green']}🎧 Listening for LoRa events (headless)...{C['reset']}\n")

        self.running = True
        reader_thread = threading.Thread(target=self.reader_loop, daemon=True)
        reader_thread.start()

        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass

        self.running = False
        self.show_status()
        if self.ser:
            self.ser.close()
        print(f"  {C['green']}✅ Server Companion stopped.{C['reset']}\n")


def main():
    parser = argparse.ArgumentParser(description="Server Companion — Raw LoRa")
    parser.add_argument("--headless", action="store_true",
                        help="Run without interactive prompt (daemon mode)")
    args = parser.parse_args()

    config = load_config()
    companion = ServerCompanion(config, headless=args.headless)

    if args.headless:
        companion.run_headless()
    else:
        companion.run_interactive()


if __name__ == "__main__":
    main()
