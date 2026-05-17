"""
bridge_companion.py — Runs the server-side bridge logic.

In dev:   ``--bus sim --bus-port 7100``
On a Pi or laptop with the server Heltec plugged in:
          ``--bus serial`` (auto-resolves /dev/cu.usbmodem* via
          ``.config.nodes.yaml`` usb_mac written by ``firmware/deploy.py``)

The bridge connects to either a sim_bus or a real Heltec via USB serial,
listens for frames from clients, translates ``cmd`` / ``qry`` into
MarsinEngine REST calls (gated by ``.config.commands.yaml``), and
publishes a compact engine snapshot on a 5/30 s cadence so every client
UI stays in sync without polling.

All configuration is YAML-driven. The companion expects these files
under ``control_podium/``:

* ``.config.bridge.yaml``       runtime: engine URL, bus mode, publish cadence
* ``.config.nodes.yaml``        identity + roles for every client/server
* ``.config.commands.yaml``     command + query allowlist (enabled, min role)

…and the shared secret at ``marsin_engine/secret.yaml`` (single source of
truth across the engine, every companion, and future CaptainPad).

The bridge ABORTS at startup if any required file is missing — refusing
to run is preferred to silently allowing plaintext or an unconfigured mesh.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys
from pathlib import Path

import yaml

BASE = Path(__file__).resolve().parent.parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from comms.acl import AclTable
from comms.bridge import Bridge
from comms.engine_client import EngineClient
from comms.radio_port import RadioPort
from comms.radio_port_sim import RadioPortSim
from comms.registry import CommandRegistry
from comms.secure import SecretError, default_codec

logger = logging.getLogger("titanic.bridge_companion")


def _load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def _resolve_serial_port(node_id: int, override) -> str:
    """Resolve /dev/cu.usbmodem* for the bridge's Heltec.

    Order:
      1. ``--serial-port`` override (operator was explicit).
      2. ``.config.bridge.yaml`` ``bus.serial.port`` (legacy explicit).
      3. ``.config.nodes.yaml`` ``usb_mac`` for the bridge node id (default
         0x01) → live port via ``utils.discovery.find_port_by_mac``.
    """
    if override:
        return override
    from utils.discovery import find_port_by_mac
    nodes_path = BASE / ".config.nodes.yaml"
    cfg = yaml.safe_load(nodes_path.read_text()) if nodes_path.exists() else {}
    nodes = (cfg or {}).get("nodes") or {}
    entry = nodes.get(node_id) or nodes.get(f"0x{node_id:02X}")
    mac = (entry or {}).get("usb_mac")
    if not mac:
        sys.exit(
            f"server node 0x{node_id:02X} has no usb_mac in .config.nodes.yaml. "
            f"Run firmware/deploy.py --node 0x{node_id:02X} to pair it, "
            f"or pass --serial-port explicitly."
        )
    port = find_port_by_mac(mac)
    if not port:
        sys.exit(
            f"no USB device with MAC {mac} (paired to server 0x{node_id:02X}). "
            f"Plug it in, or use deploy.py --list."
        )
    return port


async def _build_radio(args, cfg: dict, bridge_node_id: int) -> RadioPort:
    mode = args.bus or cfg.get("bus", {}).get("mode", "sim")
    if mode == "sim":
        host = args.bus_host or cfg.get("bus", {}).get("sim", {}).get("host", "127.0.0.1")
        port = args.bus_port or cfg.get("bus", {}).get("sim", {}).get("port", 7100)
        return RadioPortSim(host=host, port=port, name="bridge")
    if mode == "serial":
        from comms.radio_port_serial import RadioPortSerial
        explicit = args.serial_port or cfg.get("bus", {}).get("serial", {}).get("port")
        port = _resolve_serial_port(bridge_node_id, explicit)
        baud = args.baud or cfg.get("bus", {}).get("serial", {}).get("baud", 115200)
        radio = RadioPortSerial(port=port, baud=baud, name="bridge")
        radio._dev_label = port  # type: ignore[attr-defined]
        return radio
    sys.exit(f"unknown --bus mode: {mode}")


async def _run(args) -> None:
    cfg = _load_yaml(BASE / ".config.bridge.yaml")
    acl = AclTable.load(BASE / ".config.nodes.yaml")
    registry = CommandRegistry.load(BASE / ".config.commands.yaml")

    # Fail FAST if the shared secret is missing — the radio mesh is not
    # allowed to run in plaintext (see docs/07_control_podium.md §3.6).
    try:
        default_codec()
    except SecretError as exc:
        sys.exit(f"shared-secret load failed:\n{exc}")

    engine_cfg = cfg.get("engine", {})
    primary = args.engine or engine_cfg.get("url", "http://127.0.0.1:6968")
    fallback = list(engine_cfg.get("fallback_urls") or [])
    timeout_s = float(engine_cfg.get("timeout_s", 2.0))
    if args.engine or not fallback:
        engine = EngineClient(base_url=primary, timeout_s=timeout_s)
        engine_url = primary
    else:
        from comms.engine_client import EngineUnavailable
        try:
            engine = await EngineClient.discover(
                [primary, *fallback], call_timeout_s=timeout_s,
            )
            engine_url = engine.base_url
        except EngineUnavailable as exc:
            sys.exit(f"engine discovery failed: {exc}")

    bridge_node_id = int(cfg.get("bridge", {}).get("node_id", 0x01))
    radio = await _build_radio(args, cfg, bridge_node_id)

    pub_cfg = cfg.get("status_publish", {})
    bridge = Bridge(
        radio=radio,
        engine=engine,
        acl=acl,
        registry=registry,
        node_id=bridge_node_id,
        short_interval_s=float(pub_cfg.get("short_interval_s", 5.0)),
        long_interval_s=float(pub_cfg.get("long_interval_s", 30.0)),
        idle_threshold_s=float(pub_cfg.get("idle_threshold_s", 60.0)),
    )

    bus_label = args.bus or cfg.get("bus", {}).get("mode", "sim")
    if bus_label == "serial":
        bus_label = f"serial {getattr(radio, '_dev_label', '?')}"

    print()
    print("  BRIDGE COMPANION")
    print(f"  engine:    {engine_url}")
    print(f"  nodes:     {len(acl.all_nodes())} loaded")
    print(f"  commands:  {len(registry.all_commands())} enabled")
    print(f"  bus:       {bus_label}")
    print(f"  pub:       {bridge.short_interval_s}s active / {bridge.long_interval_s}s idle")
    print("  (Ctrl+C to stop)")
    print()

    stop = asyncio.Event()

    def _stop(*_):
        stop.set()

    try:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, _stop)
            except NotImplementedError:
                pass

        run_task = asyncio.create_task(bridge.run())
        stop_task = asyncio.create_task(stop.wait())
        done, pending = await asyncio.wait(
            {run_task, stop_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for t in pending:
            t.cancel()
        for t in done:
            exc = t.exception() if t is run_task else None
            if exc:
                logger.error("bridge exited with error: %s", exc)
    finally:
        await radio.close()


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Titanic radio↔engine bridge")
    p.add_argument("--bus", choices=("sim", "serial"),
                   help="transport mode (default from .config.bridge.yaml)")
    p.add_argument("--bus-host", help="sim_bus host (sim mode)")
    p.add_argument("--bus-port", type=int, help="sim_bus port (sim mode)")
    p.add_argument("--serial-port",
                   help="(serial) explicit /dev/cu.usbmodem* override; "
                        "default resolves via .config.nodes.yaml usb_mac")
    p.add_argument("--baud", type=int, default=None,
                   help="(serial) USB-CDC baud (default 115200)")
    p.add_argument("--engine", help="MarsinEngine base URL "
                                    "(skips discovery; use the configured fallbacks)")
    p.add_argument("-v", "--verbose", action="count", default=0)
    return p


def main() -> None:  # pragma: no cover
    args = _build_parser().parse_args()
    level = logging.WARNING
    if args.verbose >= 2:
        level = logging.DEBUG
    elif args.verbose == 1:
        level = logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    try:
        asyncio.run(_run(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":  # pragma: no cover
    main()
