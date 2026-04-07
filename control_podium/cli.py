#!/usr/bin/env python3
"""
cli.py — TITANIC Control Podium CLI
========================================
Unified command line interface to manage pairing, deployment, and status.
This replaces the old config.py and deploy.py scripts.

Usage:
    python cli.py status               # Show system status
    python cli.py pair                 # Auto-detect boards and pair MACs
    python cli.py deploy               # Build + flash all
    python cli.py deploy --role podium # Build + flash one role
    python cli.py deploy --build-only  # Compile only
    python cli.py test                 # Run HIL test suite
    python cli.py monitor              # Launch Control Center
"""
import argparse
import subprocess
import sys
import time
import serial
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from utils import config_store, discovery

BASE = Path(__file__).parent
FIRMWARE_DIR = BASE / "firmware"

C = {
    "reset": "\033[0m", "green": "\033[92m", "red": "\033[91m",
    "yellow": "\033[93m", "cyan": "\033[96m", "bold": "\033[1m",
    "dim": "\033[2m",
}

def _role_to_env(role):
    aliases = {"podium": "podium_tx", "server": "server_rx"}
    return aliases.get(role, role)

def _ble_name(role):
    return f"Titanic-{role.capitalize()}"

def resolve_port(config, role):
    node = config_store.get_node(config, role)
    mac = node.get("mac") if node else None
    if mac:
        return discovery.find_port_by_mac(mac)
    return None

# --- DEPLOY LOGIC ---

def get_build_flags(config):
    radio = config.get("radio", {})
    freq = radio.get("frequency", 915.0)
    bw = radio.get("bandwidth", 250.0)
    sf = radio.get("spreading_factor", 7)
    cr = radio.get("coding_rate", 5)
    txp = radio.get("tx_power", 22)
    
    display = config.get("display", {})
    timeout = display.get("timeout_sec", 10)
    
    flags = [
        f"-DFREQUENCY={freq}",
        f"-DBANDWIDTH={bw}",
        f"-DSF={sf}",
        f"-DCR={cr}",
        f"-DTX_POWER={txp}",
        f"-DOLED_TIMEOUT_SEC={timeout}"
    ]
    return " ".join(flags)

def build(env_name, role, config):
    print(f"\n  {C['cyan']}Building {role} ({env_name})...{C['reset']}")
    import os
    env = os.environ.copy()
    env["PLATFORMIO_BUILD_FLAGS"] = get_build_flags(config)
    result = subprocess.run(
        ["pio", "run", "-e", env_name],
        cwd=str(FIRMWARE_DIR), capture_output=True, text=True,
        env=env
    )
    if result.returncode == 0:
        print(f"  {C['green']}✅ Build OK{C['reset']}")
        return True
    else:
        print(f"  {C['red']}❌ Build FAILED{C['reset']}")
        err = result.stderr or result.stdout or ""
        print(f"  {err[-300:]}")
        return False

def flash(env_name, port, role, config):
    print(f"\n  {C['cyan']}Flashing {role} → {port}...{C['reset']}")
    import os
    env = os.environ.copy()
    env["PLATFORMIO_BUILD_FLAGS"] = get_build_flags(config)
    result = subprocess.run(
        ["pio", "run", "-e", env_name, "-t", "upload", "--upload-port", port],
        cwd=str(FIRMWARE_DIR), capture_output=True, text=True,
        env=env
    )
    if result.returncode == 0:
        print(f"  {C['green']}✅ Flash OK{C['reset']}")
        return True
    else:
        print(f"  {C['red']}❌ Flash FAILED{C['reset']}")
        err = result.stderr or result.stdout or ""
        if "Wrong boot mode" in err or "not in download mode" in err.lower():
            print(f"  {C['yellow']}Board didn't auto-reset. Try: hold BOOT → press RST → release BOOT → re-run{C['reset']}")
        print(f"  {err[-300:]}")
        return False

def _check_ready(port, timeout=5):
    try:
        ser = serial.Serial(port, 115200, timeout=1)
    except Exception:
        return False
    deadline = time.time() + timeout
    while time.time() < deadline:
        raw = ser.readline()
        if raw:
            line = raw.decode("utf-8", errors="replace").strip()
            if "READY" in line or "BLE:" in line:
                ser.close()
                return True
    ser.close()
    return False

def wait_for_port(port, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            ser = serial.Serial(port, 115200, timeout=0.5)
            ser.close()
            return True
        except (serial.SerialException, OSError):
            time.sleep(0.5)
    return False

def reboot_board(port, role):
    print(f"\n  {C['cyan']}Rebooting {role} on {port}...{C['reset']}")
    if not wait_for_port(port, timeout=10):
        print(f"  {C['yellow']}Port {port} not available — waiting longer...{C['reset']}")
        if not wait_for_port(port, timeout=10):
            print(f"  {C['red']}Port {port} never came back{C['reset']}")
            return False

    try:
        ser = serial.Serial(port, 115200)
        ser.dtr = False
        ser.rts = False
        time.sleep(0.1)
        ser.rts = True
        ser.dtr = True
        time.sleep(0.25)
        ser.rts = False
        ser.dtr = False
        time.sleep(0.1)
        ser.close()
    except Exception as e:
        print(f"  {C['dim']}DTR/RTS reset failed: {e}{C['reset']}")
    
    time.sleep(1)
    if _check_ready(port, timeout=5):
        return True

    print(f"  {C['dim']}Trying 1200bps touch reset...{C['reset']}")
    try:
        ser = serial.Serial(port, 1200)
        ser.dtr = True
        time.sleep(0.3)
        ser.dtr = False
        time.sleep(0.3)
        ser.close()
    except Exception:
        pass
    
    time.sleep(2)
    if _check_ready(port, timeout=5):
        return True

    print(f"  {C['dim']}Trying DTR pulse reset...{C['reset']}")
    try:
        ser = serial.Serial(port, 115200)
        ser.dtr = True
        time.sleep(0.5)
        ser.dtr = False
        time.sleep(0.5)
        ser.close()
    except Exception:
        pass

    time.sleep(2)
    return _check_ready(port, timeout=5)

def verify(port, role, timeout=12):
    print(f"\n  {C['cyan']}Verifying {role} on {port}...{C['reset']}")
    try:
        ser = serial.Serial(port, 115200, timeout=1)
    except Exception as e:
        print(f"  {C['red']}Cannot open {port}: {e}{C['reset']}")
        return None

    results = {"ready": False, "ble": False, "role": None, "lines": []}
    deadline = time.time() + timeout
    while time.time() < deadline:
        raw = ser.readline()
        if raw:
            line = raw.decode("utf-8", errors="replace").strip()
            if line:
                results["lines"].append(line)
                if "READY" in line:
                    results["ready"] = True
                if "BLE:" in line or "advertising as" in line.lower():
                    results["ble"] = True
                if role.upper() in line.upper():
                    results["role"] = role
                if results["ready"] and results["ble"]:
                    break
    ser.close()

    if results["ready"] and results["ble"]:
        print(f"  {C['green']}✅ Verified: {role} running with BLE{C['reset']}")
        for line in results["lines"]: print(f"    {C['dim']}{line}{C['reset']}")
    elif results["ready"]:
        print(f"  {C['green']}✅ Board running{C['reset']} (BLE not confirmed in output)")
    else:
        print(f"  {C['yellow']}⚠️  No READY signal received{C['reset']}")
        if results["lines"]:
            for line in results["lines"]: print(f"    {C['dim']}{line}{C['reset']}")
        else:
            print(f"    {C['dim']}(no serial output — board may still be in bootloader){C['reset']}")
    return results

def ping_test(config):
    p_mac = config.get("nodes", {}).get("podium", {}).get("mac")
    s_mac = config.get("nodes", {}).get("server", {}).get("mac")
    if not p_mac or not s_mac: return None
    p_port = discovery.find_port_by_mac(p_mac)
    s_port = discovery.find_port_by_mac(s_mac)
    if not p_port or not s_port: return None

    print(f"\n  {C['cyan']}Ping test: podium → server...{C['reset']}")
    try:
        p_ser = serial.Serial(p_port, 115200, timeout=1)
        s_ser = serial.Serial(s_port, 115200, timeout=1)
        time.sleep(0.5)
        for ser in [p_ser, s_ser]:
            while ser.readline(): pass
        
        p_ser.write(b"titanic:ping\n")
        time.sleep(0.5)

        tx_ok = False
        for _ in range(5):
            raw = p_ser.readline()
            if raw and b"TX_OK" in raw:
                tx_ok = True
                break

        rx_ok, rssi = False, None
        for _ in range(5):
            raw = s_ser.readline()
            if raw and b"RX:" in raw:
                rx_ok = True
                line = raw.decode("utf-8", errors="replace").strip()
                if "RSSI=" in line:
                    try: rssi = line.split("RSSI=")[1].split(":")[0]
                    except IndexError: pass
                break

        p_ser.close(); s_ser.close()
        if tx_ok and rx_ok:
            print(f"  {C['green']}✅ Ping OK — podium→server" + (f" (RSSI={rssi})" if rssi else "") + f"{C['reset']}")
            return True
        elif tx_ok:
            print(f"  {C['yellow']}⚠️  TX OK but server didn't receive{C['reset']}")
            return False
        else:
            print(f"  {C['red']}❌ TX failed{C['reset']}")
            return False
    except Exception as e:
        print(f"  {C['red']}Ping test error: {e}{C['reset']}")
        return None

def cmd_deploy(args):
    config = config_store.load()
    all_roles = list(config.get("nodes", {}).keys())
    targets = args.role if args.role else all_roles

    print(f"\n{C['bold']}{'═' * 55}")
    print(f"  ⚡ Heltec Raw LoRa — Automated Deploy")
    print(f"{'═' * 55}{C['reset']}")
    print(f"  {C['dim']}Targets: {', '.join(targets)}{C['reset']}\n")

    for target in targets:
        if not build(_role_to_env(target), target, config):
            print(f"\n  {C['red']}Build failed for {target}. Aborting.{C['reset']}")
            sys.exit(1)

    if args.build_only:
        print(f"\n  {C['green']}✅ All builds succeeded.{C['reset']}\n")
        return

    flashed = {}
    for target in targets:
        env_name = _role_to_env(target)
        port = resolve_port(config, target)
        if not port:
            print(f"\n  {C['red']}Cannot find port for {target} (MAC not paired or offline){C['reset']}")
            continue
        if flash(env_name, port, target, config):
            rebooted = reboot_board(port, target)
            if rebooted:
                print(f"  {C['green']}✅ {target} rebooted into new firmware{C['reset']}")
            else:
                print(f"  {C['yellow']}⚠️  {target} reboot uncertain — will verify next{C['reset']}")
            flashed[target] = port

    if not flashed:
        print(f"\n  {C['red']}No boards flashed successfully.{C['reset']}\n")
        sys.exit(1)

    if not args.skip_verify:
        for target, port in flashed.items():
            verify(port, target)

    if not args.skip_ping and len(flashed) >= 2:
        ping_test(config)

    print(f"\n{C['bold']}{'─' * 55}{C['reset']}")
    for target, port in flashed.items():
        print(f"  {target:10s} → {port:8s}  BLE: {_ble_name(target)}  {C['green']}✅{C['reset']}")
    print()

    deployed_nodes = {}
    for target, port in flashed.items():
        deployed_nodes[target] = {
            "usb_port": port,
            "ble_name": _ble_name(target),
            "ble_address_last_seen": None,
            "last_status": "deployed",
        }
    config_store.save_deploy(config, deployed_nodes=deployed_nodes)

# --- COMMANDS ---

def cmd_status(args):
    config = config_store.load()
    print(f"\n{C['bold']}{'=' * 55}")
    print(f"  TITANIC Control Podium — Status")
    print(f"{'=' * 55}{C['reset']}\n")

    for name in config_store.node_names(config):
        node = config_store.get_node(config, name)
        usb_mac = node.get("usb_mac", "NOT PAIRED")
        port = discovery.find_port_by_mac(usb_mac) if usb_mac else None
        ble = _ble_name(name)
        ble_addr = node.get("ble_address") or node.get("ble_address_last_seen") or "unknown"
        usb_status = f"{C['green']}ONLINE{C['reset']} ({port})" if port else f"{C['red']}OFFLINE{C['reset']}"
        print(f"  {name:10s}  USB: {usb_mac or 'N/A':20s}  {usb_status}")
        print(f"  {'':10s}  BLE: {ble} ({ble_addr})")

    radio = config.get("radio", {})
    print(f"\n  Radio:  {radio.get('frequency', '?')} MHz  "
          f"SF{radio.get('spreading_factor', '?')}  "
          f"BW{radio.get('bandwidth', '?')}  "
          f"TX {radio.get('tx_power', '?')} dBm")

    last = config.get("last_deploy")
    fw = config.get("firmware_version", "?")
    print(f"  Deploy: {last or 'Never deployed'} (FW: {fw})")

    envs = [_role_to_env(n) for n in config_store.node_names(config)]
    print(f"  Envs:   {', '.join(envs)}\n")

def cmd_pair(args):
    config = config_store.load()
    print(f"\n{C['bold']}{'=' * 50}")
    print(f"  TITANIC Control Podium — Pair Hardware")
    print(f"{'=' * 50}{C['reset']}\n")

    ports = discovery.scan_ports()
    heltec_ports = [p for p in ports if p.get("is_heltec")]

    if not heltec_ports:
        print(f"  {C['red']}No Heltec controllers detected!{C['reset']}")
        print(f"  Plug in controllers via USB and try again.\n")
        sys.exit(1)

    print(f"  Found {len(heltec_ports)} controller(s):\n")
    for p in heltec_ports:
        matched = discovery.match_port_to_node(p, config)
        label = f" (currently: {matched})" if matched else ""
        print(f"    {p['port']:8s}  MAC: {p['mac']}{label}")

    node_names = list(config.get("nodes", {}).keys())
    pairing = {}

    if len(heltec_ports) == 1:
        print(f"\n  Only 1 board detected. Which role?")
        for i, name in enumerate(node_names):
            print(f"    {i+1}. {name}")
        choice = input(f"\n  Enter number: ").strip()
        try:
            name = node_names[int(choice) - 1]
            pairing[name] = {"usb_mac": heltec_ports[0]["mac"]}
            print(f"  Paired {name} -> {heltec_ports[0]['mac']}")
        except (ValueError, IndexError):
            print(f"  {C['red']}Invalid choice.{C['reset']}")
            sys.exit(1)
    elif len(heltec_ports) >= len(node_names):
        print(f"\n  Auto-pairing {len(node_names)} roles to first {len(node_names)} boards:")
        for i, name in enumerate(node_names):
            mac = heltec_ports[i]["mac"]
            pairing[name] = {"usb_mac": mac}
            print(f"    {name:10s} -> {mac} ({heltec_ports[i]['port']})")
    else:
        print(f"\n  {len(heltec_ports)} boards but {len(node_names)} roles — pairing available boards:")
        for i, p in enumerate(heltec_ports):
            print(f"\n  Board on {p['port']} (MAC: {p['mac']}) — assign to:")
            for j, name in enumerate(node_names):
                if name not in pairing:
                    print(f"    {j+1}. {name}")
            try:
                name = node_names[int(input(f"  Enter number: ").strip()) - 1]
                pairing[name] = {"usb_mac": p["mac"]}
                print(f"  Paired {name} -> {p['mac']}")
            except (ValueError, IndexError):
                print(f"  {C['yellow']}Skipping board.{C['reset']}")

    if pairing:
        config_store.save_pairing(pairing)
        print(f"\n  {C['green']}Pairing saved to .config.pairing.yaml{C['reset']}\n")

def cmd_test(args):
    print(f"\n{C['bold']}Running HIL tests...{C['reset']}\n")
    import os
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/", "-v", "-s", "--tb=short"],
        cwd=str(BASE), env=env,
    )
    sys.exit(result.returncode)

def cmd_monitor(args):
    import os
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    monitor_script = BASE / "companions" / "control_center.py"
    if not monitor_script.exists():
        print(f"  {C['red']}Monitor app not found: {monitor_script}{C['reset']}")
        sys.exit(1)
    print(f"\n  {C['cyan']}Launching Control Center...{C['reset']}\n")
    result = subprocess.run(
        [sys.executable, str(monitor_script)],
        cwd=str(BASE), env=env,
    )
    sys.exit(result.returncode)

def main():
    parser = argparse.ArgumentParser(description="TITANIC Control Podium — Configuration & Deployment")
    sub = parser.add_subparsers(dest="command", help="Command to run")

    sub.add_parser("status", help="Show system status")
    sub.add_parser("pair", help="Auto-detect and pair hardware")
    
    deploy_p = sub.add_parser("deploy", help="Build and flash firmware")
    deploy_p.add_argument("--role", nargs="+", help="Role(s) to deploy (default: all from .config.yaml)")
    deploy_p.add_argument("--build-only", action="store_true", help="Compile only")
    deploy_p.add_argument("--skip-verify", action="store_true", help="Skip post-flash verification")
    deploy_p.add_argument("--skip-ping", action="store_true", help="Skip end-to-end ping test")

    sub.add_parser("test", help="Run HIL test suite")
    sub.add_parser("monitor", help="Launch Control Center app")

    args = parser.parse_args()

    if args.command == "status": cmd_status(args)
    elif args.command == "pair": cmd_pair(args)
    elif args.command == "deploy": cmd_deploy(args)
    elif args.command == "test": cmd_test(args)
    elif args.command == "monitor": cmd_monitor(args)
    else: cmd_status(args)

if __name__ == "__main__":
    main()
