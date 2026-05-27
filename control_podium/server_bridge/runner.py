"""
server_bridge.runner — Production entry point for the radio↔engine bridge.

In dev:   ``--bus sim --bus-port 7100``
On a Pi or laptop with the server Heltec plugged in:
          ``--bus serial`` (auto-resolves /dev/cu.usbmodem* via
          ``.config.nodes.yaml`` usb_mac written by ``firmware/deploy.py``)

The bridge connects to either a sim_bus or a real Heltec via USB serial,
listens for frames from clients, translates ``cmd`` / ``qry`` into
MarsinEngine REST calls (gated by ``.config.commands.yaml``), and
publishes a compact engine snapshot on a 5/30 s cadence so every client
UI stays in sync without polling.

All configuration is YAML-driven. The runner expects these files
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
import time
from pathlib import Path

import yaml

BASE = Path(__file__).resolve().parent.parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from comms.acl import AclTable
from comms.bridge import Bridge, _LogThrottle
from comms.engine_client import EngineClient
from comms.radio_port import RadioPort
from comms.radio_port_sim import RadioPortSim
from comms.registry import CommandRegistry
from comms.secure import SecretError, default_codec

logger = logging.getLogger("titanic.server_bridge")

# Module-level throttle so repeated "USB still missing" boot
# retries collapse into one INFO line per `period_s`. The
# supervisor itself keeps retrying every `backoff` seconds; this
# just keeps the log readable while the operator goes off to
# plug the server Heltec in.
_boot_log_throttle = _LogThrottle(period_s=60.0)


class TransientBootError(RuntimeError):
    """Raised by the resolver / builder for boot failures the
    supervisor should retry indefinitely.

    Distinct from ``SystemExit``: SystemExit means "the operator
    has to fix something on disk before this process can usefully
    run" (bad role assignment, missing config file, wrong shared
    secret). TransientBootError means "everything is correctly
    configured, but a piece of hardware or network resource isn't
    available right now" — the supervisor retries with backoff
    until it shows up. The motivating case is the USB Heltec being
    unplugged at the exact moment the supervisor tries to restart
    the bridge: we MUST NOT exit the process, because there is
    nobody to type ``systemctl restart`` on a Pi sitting in a road
    case at 3 AM.
    """


def _load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def _resolve_serial_port(node_id: int, override) -> str:
    """Resolve /dev/cu.usbmodem* for the bridge's Heltec.

    The bridge must speak as the ``server``-role node (0x01 by
    default). We enforce that at the *config* layer: the node entry
    pointed at by ``bridge.node_id`` MUST have ``role: server`` in
    ``.config.nodes.yaml``. We deliberately do NOT cross-check the
    USB MAC of the connected device against the role table — that
    extra interlock has been a recurring source of "won't boot" pain
    when boards are swapped on the bench and the YAML pairing
    drifts. The radio-side identity is already what matters for the
    mesh (every outbound frame is stamped with ``src=node_id``); a
    wrong-board mistake is recoverable by re-pairing, but a refused
    boot at gig time is not.

    Resolution order:
      1. ``--serial-port`` override (operator was explicit).
      2. ``.config.bridge.yaml`` ``bus.serial.port`` (legacy explicit).
      3. ``.config.nodes.yaml`` ``usb_mac`` for the bridge node id
         (default 0x01) → live port via
         ``utils.discovery.find_port_by_mac``.
    """
    nodes_path = BASE / ".config.nodes.yaml"
    cfg = yaml.safe_load(nodes_path.read_text()) if nodes_path.exists() else {}
    nodes = (cfg or {}).get("nodes") or {}

    # Pull the entry for the configured bridge node. YAML loads
    # `0x01` as the integer 1, but operators sometimes write the
    # key as a quoted hex string — accept both shapes.
    entry = (
        nodes.get(node_id)
        or nodes.get(f"0x{node_id:02X}")
        or nodes.get(f"0x{node_id:02x}")
    )
    if not entry:
        sys.exit(
            f"node 0x{node_id:02X} is missing from .config.nodes.yaml. "
            f"The bridge can only attach as a node declared in that file."
        )
    role = entry.get("role")
    if role != "server":
        sys.exit(
            f"node 0x{node_id:02X} ({entry.get('name', '?')}) has role "
            f"{role!r}, but the bridge requires role 'server'. Fix "
            f".config.nodes.yaml or point .config.bridge.yaml::"
            f"bridge.node_id at the server node."
        )

    if override:
        return override

    from utils.discovery import find_port_by_mac
    mac = entry.get("usb_mac")
    if not mac:
        # Pairing missing = config error. The operator has to run
        # deploy.py once to record the usb_mac. Spinning forever
        # would just mask that.
        sys.exit(
            f"server node 0x{node_id:02X} has no usb_mac in .config.nodes.yaml. "
            f"Run firmware/deploy.py --node 0x{node_id:02X} to pair it, "
            f"or pass --serial-port explicitly."
        )
    port = find_port_by_mac(mac)
    if not port:
        # Hardware-not-plugged-in is recoverable: the operator could
        # plug it in literally seconds later, and the supervisor must
        # keep polling until that happens. Distinct from SystemExit so
        # the supervisor loop catches it.
        raise TransientBootError(
            f"no USB device with MAC {mac} (paired to server 0x"
            f"{node_id:02X}); waiting for Heltec to appear"
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
    """Boot the bridge and supervise it forever.

    Designed for unattended Pi operation: every failure mode that
    used to drop the process to a shell prompt (USB unplug, engine
    HTTP timeout, transient yaml parse error, etc.) now triggers a
    bounded-backoff restart of the bridge inner loop. The only
    things that stop the supervisor are:

      * SIGINT / SIGTERM (operator intent — `systemctl stop`, Ctrl+C).
      * Hard config errors caught BEFORE the supervisor starts
        (missing secret, bad role on the bridge node, missing
        node entry). Those refuse-to-start at boot because they
        require a human edit; spinning on them would just mask
        the misconfig.

    Restart backoff: 1s → 2s → 4s → … → 30s, reset to 1s after the
    inner loop has been healthy for at least 30 s. Mirrors what
    ``systemd`` would do at the unit level, but keeps the heavy
    per-process state (engine HTTP client, AES-GCM codec, ACL
    table) hot across restarts — much faster recovery than a full
    process bounce.
    """
    cfg = _load_yaml(BASE / ".config.bridge.yaml")
    acl = AclTable.load(BASE / ".config.nodes.yaml")
    registry = CommandRegistry.load(BASE / ".config.commands.yaml")

    # Fail FAST if the shared secret is missing — the radio mesh is not
    # allowed to run in plaintext (see docs/07_control_podium.md §3.6).
    try:
        default_codec()
    except SecretError as exc:
        sys.exit(f"shared-secret load failed:\n{exc}")

    engine_cfg = cfg.get("engine") or {}
    primary = args.engine or engine_cfg.get("url", "http://127.0.0.1:6968")
    fallback_extras = [
        u for u in (engine_cfg.get("fallback_urls") or [])
        if u and u != primary
    ]

    timeout_s = float(engine_cfg.get("timeout_s", 2.0))
    if args.engine or not fallback_extras:
        engine = EngineClient(base_url=primary, timeout_s=timeout_s)
        engine_url = primary
    else:
        from comms.engine_client import EngineUnavailable
        try:
            engine = await EngineClient.discover(
                [primary, *fallback_extras], call_timeout_s=timeout_s,
            )
            engine_url = engine.base_url
        except EngineUnavailable as exc:
            # Engine isn't reachable at boot — fall back to the
            # configured primary URL anyway. The bridge's per-request
            # logic surfaces "engine_error: unreachable" NAKs to
            # clients while the engine is down, and recovers
            # automatically the moment it comes back. Refusing to
            # boot here would force a manual restart, which defeats
            # the unattended-Pi goal.
            logger.warning(
                "engine discovery failed (%s); booting with primary "
                "%s and retrying per-request.", exc, primary,
            )
            engine = EngineClient(base_url=primary, timeout_s=timeout_s)
            engine_url = primary

    bridge_node_id = int(cfg.get("bridge", {}).get("node_id", 0x01))
    pub_cfg = cfg.get("status_publish", {})
    bus_label_static = args.bus or cfg.get("bus", {}).get("mode", "sim")

    stop = asyncio.Event()

    def _stop(*_):
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _stop)
        except NotImplementedError:
            pass

    HEALTHY_RUNTIME_S = 30.0
    BACKOFF_INITIAL_S = 1.0
    BACKOFF_MAX_S = 30.0
    backoff = BACKOFF_INITIAL_S
    boot_banner_shown = False
    attempt = 0

    while not stop.is_set():
        attempt += 1
        radio = None
        bridge = None
        try:
            radio = await _build_radio(args, cfg, bridge_node_id)
            feat = cfg.get("features") if isinstance(cfg.get("features"), dict) else {}
            pub_cfg = cfg.get("status_publish", {})
            enable_ws = bool(
                feat.get("enable_engine_ws_subscriber")
                if feat.get("enable_engine_ws_subscriber") is not None
                else pub_cfg.get("enable_engine_ws_subscriber", True)
            )
            # Read profile side-channel configuration gates
            profile_switching_cfg = cfg.get("profile_switching", {})
            plaintext_cfg_over_lora = bool(profile_switching_cfg.get("plaintext_cfg_over_lora_enabled", False))
            usb_cfg = bool(profile_switching_cfg.get("usb_cfg_enabled", True))

            bridge = Bridge(
                radio=radio,
                engine=engine,
                acl=acl,
                registry=registry,
                node_id=bridge_node_id,
                short_interval_s=float(pub_cfg.get("short_interval_s", 5.0)),
                long_interval_s=float(pub_cfg.get("long_interval_s", 30.0)),
                idle_threshold_s=float(pub_cfg.get("idle_threshold_s", 60.0)),
                enable_engine_ws_subscriber=enable_ws,
                plaintext_cfg_over_lora_enabled=plaintext_cfg_over_lora,
                usb_cfg_enabled=usb_cfg,
            )

            if not boot_banner_shown:
                bus_label = bus_label_static
                if bus_label == "serial":
                    bus_label = f"serial {getattr(radio, '_dev_label', '?')}"
                print()
                print("  BRIDGE COMPANION")
                print(f"  engine:    {engine_url}")
                print(f"  nodes:     {len(acl.all_nodes())} loaded")
                print(f"  commands:  {len(registry.all_commands())} enabled")
                print(f"  bus:       {bus_label}")
                print(
                    f"  pub:       {bridge.short_interval_s}s active / "
                    f"{bridge.long_interval_s}s idle"
                )
                print(
                    f"  engine_ws: {'subscriber ON' if enable_ws else 'subscriber OFF'}"
                )
                print("  (Ctrl+C to stop)")
                print()
                boot_banner_shown = True
            elif attempt > 1:
                logger.info(
                    "bridge restart attempt #%d (engine=%s, bus=%s)",
                    attempt, engine_url, bus_label_static,
                )

            # ── Bridge health HTTP server ─────────────────────────
            # Spin up the /health endpoint alongside the bridge's main
            # tasks. Best-effort: if the port is already taken (stale
            # bridge replica) the helper returns None and we just don't
            # have a metrics surface for this attempt. The bridge's
            # LoRa relay path is unaffected — far more important than
            # the metrics endpoint.
            from comms.bridge_health import (
                default_health_listen_port,
                maybe_start_health_mdns,
                start_health_server,
            )
            health_cfg = (cfg.get("health") or {}) if isinstance(cfg, dict) else {}
            hc_port = health_cfg.get("port")
            health_port = int(hc_port) if hc_port is not None else default_health_listen_port()
            health_host = str(health_cfg.get("host", "0.0.0.0"))
            health_runner = await start_health_server(
                bridge.health_snapshot,
                host=health_host,
                port=health_port,
                # Profile side-channel: PortWatch's Status screen
                # dropdown calls these. The applies go straight to
                # the server controller's USB serial — no LoRa hop,
                # so the operator gets near-immediate feedback even
                # when the air link itself is the problem we're
                # trying to fix.
                profile_apply_fn=bridge.request_profile_change,
                profile_list_fn=bridge.lora_profiles_available,
                profile_current_fn=bridge.lora_profile_current,
            )
            health_mdns_stop = None
            if health_runner is not None:
                try:
                    health_mdns_stop = maybe_start_health_mdns(listen_port=health_port)
                except Exception as exc:  # pragma: no cover
                    logger.warning(
                        "bridge health mDNS: unexpected bootstrap error (%s) — skipping",
                        exc,
                    )

            run_task = asyncio.create_task(bridge.run())
            stop_task = asyncio.create_task(stop.wait())
            started_at = time.monotonic()
            try:
                done, pending = await asyncio.wait(
                    {run_task, stop_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                uptime = time.monotonic() - started_at
                for t in pending:
                    t.cancel()
                    try:
                        await t
                    except (asyncio.CancelledError, Exception):
                        pass
            finally:
                # Tear down LAN discovery BEFORE releasing the TCP
                # bind so responders don't flap on a restarting process.
                if health_mdns_stop is not None:
                    try:
                        health_mdns_stop()
                    except Exception:  # pragma: no cover
                        pass
                # Always clean up the health server when this attempt
                # exits, even on exception. Otherwise the next restart
                # would race against a still-bound port and the
                # OSError path above would silently disable health
                # for the rest of the process's life.
                if health_runner is not None:
                    try:
                        await health_runner.cleanup()
                    except Exception:  # pragma: no cover
                        pass

            run_exc: BaseException | None = None
            if run_task in done:
                run_exc = run_task.exception()

            if stop.is_set():
                break

            # Bridge.run() returned (cleanly or with an error)
            # without an operator stop. Treat as crash → restart.
            if uptime >= HEALTHY_RUNTIME_S:
                # Long-running session: reset backoff so a single
                # late-night flake doesn't make the next restart
                # wait 30 s.
                backoff = BACKOFF_INITIAL_S
            if run_exc is not None:
                logger.warning(
                    "bridge exited after %.1fs (%s: %s); restarting in %.1fs",
                    uptime, type(run_exc).__name__, run_exc, backoff,
                )
            else:
                logger.warning(
                    "bridge exited after %.1fs without error; restarting in %.1fs",
                    uptime, backoff,
                )
        except asyncio.CancelledError:
            raise
        except SystemExit:
            # Hard config error (missing role, missing pairing,
            # missing secret) — propagate so the operator sees the
            # cause. These require an on-disk edit; spinning would
            # just mask them.
            raise
        except TransientBootError as exc:
            # Recoverable hardware/network condition (USB unplugged,
            # device path disappeared between resolution and open,
            # etc.). The supervisor's whole job is to keep retrying
            # these. Log via the throttle so an extended outage
            # doesn't fill the log with one line per retry.
            _boot_log_throttle.log(
                logger, "boot_transient",
                "bridge waiting for prerequisite: %s (next retry in %.1fs)",
                exc, backoff,
            )
        except Exception as exc:
            # Unexpected boot failure. Same retry semantics as
            # TransientBootError but flagged distinctly in the log
            # so it's easy to grep when investigating a wedged
            # restart.
            logger.warning(
                "bridge boot failed (%s: %s); retrying in %.1fs",
                type(exc).__name__, exc, backoff,
            )
        finally:
            if radio is not None:
                try:
                    await radio.close()
                except Exception as exc:
                    logger.debug("radio close during supervisor recycle: %s", exc)

        # Wait either backoff seconds OR a stop signal, whichever
        # comes first. Cooperative so Ctrl+C doesn't wait the full
        # backoff before exiting.
        try:
            await asyncio.wait_for(stop.wait(), timeout=backoff)
            break
        except asyncio.TimeoutError:
            pass
        backoff = min(BACKOFF_MAX_S, max(BACKOFF_INITIAL_S, backoff * 2))


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
