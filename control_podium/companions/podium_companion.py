"""
Podium Companion — Raw LoRa (Heltec V4)
=========================================
Connects to the Podium node via USB serial. Sends commands over LoRa
to the Server node. Receives responses bidirectionally.

Usage:
    python companions/podium_companion.py
    python companions/podium_companion.py --send "titanic:scene:sunset"

Interactive commands:
    <text>           Send raw text over LoRa
    /scene <name>    Send titanic:scene:<name>
    /cmd <name>      Send titanic:cmd:<name>
    /fx <name>       Send titanic:fx:<name>
    /ping            Send titanic:ping (latency test)
    /status          Show connection stats
    /quit            Exit
"""
import argparse
import sys
import time
import threading
import json
from pathlib import Path
from datetime import datetime

import serial
import yaml


ROLE = "podium"
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


class PodiumCompanion:
    def __init__(self, config):
        self.config = config
        self.port = config["nodes"][ROLE]["port"]
        self.baud = config.get("serial", {}).get("baud", 115200)
        self.prefix = config.get("protocol", {}).get("prefix", "titanic:")
        self.ser = None
        self.running = False
        self.stats = {"tx": 0, "rx": 0, "tx_ok": 0, "tx_fail": 0, "errors": 0}
        self.pending_pings = {}  # seq -> send_time
        self.latencies = []
        self.C = COLORS

        # Ensure log directory exists
        LOG_DIR.mkdir(exist_ok=True)
        self.log_file = LOG_DIR / f"podium_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

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
        """Send a message over LoRa via serial."""
        C = self.C
        self.stats["tx"] += 1
        send_ts = ts()
        self.ser.write(f"{msg}\n".encode("utf-8"))
        self.log(f"TX: {msg}")
        print(f"  {C['green']}📤 [{send_ts}] #{self.stats['tx']:03d}  → LoRa: {msg}{C['reset']}")

    def send_event(self, event_id: str):
        """Send a titanic: prefixed event."""
        self.send(f"{self.prefix}{event_id}")

    def handle_shortcut(self, user_input: str) -> bool:
        """Handle /commands. Returns True if handled."""
        C = self.C
        parts = user_input.split(None, 1)
        cmd = parts[0].lower()
        arg = parts[1] if len(parts) > 1 else ""

        if cmd == "/scene" and arg:
            self.send_event(f"scene:{arg}")
        elif cmd == "/cmd" and arg:
            self.send_event(f"cmd:{arg}")
        elif cmd == "/fx" and arg:
            self.send_event(f"fx:{arg}")
        elif cmd == "/ping":
            seq = self.stats["tx"] + 1
            self.pending_pings[str(seq)] = time.time()
            self.send_event("ping")
        elif cmd == "/status":
            avg_lat = (sum(self.latencies) / len(self.latencies) * 1000) if self.latencies else 0
            print(f"\n  {C['cyan']}{'─' * 40}{C['reset']}")
            print(f"  {C['bold']}Connection Stats{C['reset']}")
            print(f"  TX: {self.stats['tx']}  TX_OK: {self.stats['tx_ok']}  TX_FAIL: {self.stats['tx_fail']}")
            print(f"  RX: {self.stats['rx']}  Errors: {self.stats['errors']}")
            if self.latencies:
                print(f"  Avg latency: {avg_lat:.0f}ms  (last {len(self.latencies)} pings)")
            print(f"  Log: {self.log_file}")
            print(f"  {C['cyan']}{'─' * 40}{C['reset']}\n")
        elif cmd == "/quit":
            return False  # signal to exit
        else:
            return None  # not a shortcut
        return True

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
                    recv_ts = ts()

                    # Check for pong response
                    if payload.startswith(f"{self.prefix}pong"):
                        for seq, send_time in list(self.pending_pings.items()):
                            latency = time.time() - send_time
                            self.latencies.append(latency)
                            del self.pending_pings[seq]
                            print(f"\r{C['magenta']}  🏓 [{recv_ts}] PONG  "
                                  f"RTT: {latency*1000:.0f}ms  "
                                  f"RSSI:{rssi} SNR:{snr}{C['reset']}")
                            break
                    else:
                        print(f"\r{C['cyan']}  📥 [{recv_ts}] #{self.stats['rx']:03d}  "
                              f"RSSI:{rssi} SNR:{snr}{C['reset']}")
                        print(f"     {C['bold']}{payload}{C['reset']}")

                    print(f"\n  {C['yellow']}podium>{C['reset']} ", end="", flush=True)

                elif line == "TX_OK":
                    self.stats["tx_ok"] += 1

                elif line.startswith("TX_FAIL"):
                    self.stats["tx_fail"] += 1
                    print(f"\r  {C['red']}❌ {line}{C['reset']}")
                    print(f"\n  {C['yellow']}podium>{C['reset']} ", end="", flush=True)

                else:
                    print(f"\r  {C['dim']}[fw] {line}{C['reset']}")
                    print(f"\n  {C['yellow']}podium>{C['reset']} ", end="", flush=True)

            except Exception:
                if self.running:
                    self.stats["errors"] += 1
                    time.sleep(0.01)

    def run_interactive(self):
        """Main interactive loop."""
        C = self.C
        print(f"\n{C['bold']}{'═' * 55}")
        print(f"  🎛️  PODIUM COMPANION (Raw LoRa)")
        print(f"{'═' * 55}{C['reset']}")
        print(f"  {C['dim']}Port: {self.port}  |  Baud: {self.baud}{C['reset']}")
        print(f"  {C['dim']}Commands: /scene, /cmd, /fx, /ping, /status, /quit{C['reset']}")
        print(f"  {C['dim']}Or type raw text to send over LoRa{C['reset']}")
        print()

        if not self.connect():
            return

        self.wait_for_ready()
        print()

        self.running = True
        reader_thread = threading.Thread(target=self.reader_loop, daemon=True)
        reader_thread.start()

        try:
            while True:
                try:
                    user_input = input(f"  {C['yellow']}podium>{C['reset']} ").strip()
                except EOFError:
                    break

                if not user_input:
                    continue

                if user_input.startswith("/"):
                    result = self.handle_shortcut(user_input)
                    if result is False:
                        break
                    elif result is None:
                        print(f"  {C['dim']}Unknown command. Try /scene, /cmd, /fx, /ping, /status, /quit{C['reset']}")
                else:
                    self.send(user_input)

        except KeyboardInterrupt:
            pass

        self.running = False
        print(f"\n  {C['dim']}Closing... TX:{self.stats['tx']} RX:{self.stats['rx']}{C['reset']}")
        if self.ser:
            self.ser.close()
        print(f"  {C['green']}✅ Podium Companion stopped.{C['reset']}")
        print(f"  {C['dim']}Log: {self.log_file}{C['reset']}\n")

    def run_oneshot(self, message: str):
        """Send a single message and exit."""
        C = self.C
        if not self.connect():
            sys.exit(1)
        self.wait_for_ready()
        self.send(message)
        # Wait for TX_OK/TX_FAIL
        deadline = time.time() + 3
        while time.time() < deadline:
            line = self.ser.readline().decode("utf-8", errors="replace").strip()
            if line == "TX_OK":
                print(f"  {C['green']}✅ TX_OK{C['reset']}")
                self.ser.close()
                return
            elif line.startswith("TX_FAIL"):
                print(f"  {C['red']}❌ {line}{C['reset']}")
                self.ser.close()
                sys.exit(1)
        print(f"  {C['yellow']}⚠️  No TX ack received{C['reset']}")
        self.ser.close()


def main():
    parser = argparse.ArgumentParser(description="Podium Companion — Raw LoRa")
    parser.add_argument("--send", type=str, help="Send a single message and exit")
    parser.add_argument("--event", type=str, help="Send a titanic:<event> and exit")
    args = parser.parse_args()

    config = load_config()
    companion = PodiumCompanion(config)

    if args.send:
        companion.run_oneshot(args.send)
    elif args.event:
        prefix = config.get("protocol", {}).get("prefix", "titanic:")
        companion.run_oneshot(f"{prefix}{args.event}")
    else:
        companion.run_interactive()


if __name__ == "__main__":
    main()
