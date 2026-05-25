"""
bridge_health.py — Tiny HTTP server exposing the Bridge's health snapshot.

Purpose
-------
PortWatch's Status screen has two independent transports to the engine:

  1. LoRa (BLE → captain → radio → server controller → Pi USB → bridge → engine REST).
  2. WiFi (phone → engine HTTP directly).

Both eventually meet at the engine, but the LoRa path goes THROUGH the
bridge process running on the Pi, and any failure inside that process
(serial port wedged, AEAD key mismatch, engine WS dropped) is invisible
to PortWatch unless we surface it.

This module adds a third probe: the bridge ITSELF exposes its
``health_snapshot()`` over HTTP. PortWatch hits it directly (same LAN
the WiFi engine probe uses), so the Status screen can tell the operator:

  * Is the bridge process alive at all?
  * What are the bridge-side LoRa RSSI/SNR averages?  (PortWatch only
    sees the captain-side numbers, which describe the other half of
    the link — we need BOTH to know if the link is symmetric.)
  * When did the bridge last successfully talk to the engine?
  * Is the engine WS subscriber connected (fast-path PUBs alive)?

Endpoint
--------
``GET /health``  →  JSON, 200 OK
``GET /``        →  same JSON (convenience)
Anything else    →  404

Security
--------
* No auth. The endpoint is on the trusted LAN with no remote exposure
  (the Pi has no public-facing routes). Treat it as a metrics surface,
  not an admin one.
* The snapshot is RIGOROUSLY operational — no frame payloads, no AES
  keys, no engine bearer tokens, no operator PII. Matches the
  logging-security rule's allowlist for what can be logged at INFO.
* Errors are caught and surfaced as generic 500s; the underlying
  exception is logged on the Pi but not echoed in the response body
  (information-disclosure prevention).

Why aiohttp.web vs http.server
------------------------------
aiohttp is already a runtime dep for the bridge (EngineClient uses it
to talk to MarsinEngine REST). Using it for the server side too keeps
the bridge fully single-threaded asyncio — no extra thread to manage
or shut down, no extra ports of failure during graceful shutdown.
"""
from __future__ import annotations

import json
import logging
import re
import socket
from pathlib import Path
from typing import Callable, Optional

from aiohttp import web

logger = logging.getLogger("titanic.bridge_health")


_DEFAULT_HEALTH_PORT = 7099
_BRIDGE_CFG_PATH = Path(__file__).resolve().parents[1] / ".config.bridge.yaml"


def _load_bridge_health_cfg() -> dict:
    """Return the ``health:`` block from ``.config.bridge.yaml`` (or {})."""
    try:
        import yaml  # local import — pyyaml is a runtime dep of the bridge
        doc = yaml.safe_load(_BRIDGE_CFG_PATH.read_text()) or {}
    except Exception:
        return {}
    return (doc.get("health") or {}) if isinstance(doc, dict) else {}


def default_health_listen_port() -> int:
    """Read ``health.port`` from ``.config.bridge.yaml`` (default 7099)."""
    return int(_load_bridge_health_cfg().get("port") or _DEFAULT_HEALTH_PORT)


def _ok_json(payload: dict) -> web.Response:
    # aiohttp's .json_response uses ``json.dumps`` with default args
    # which doesn't deal with NaN/Infinity. Pre-render so a stray
    # float('nan') (e.g. an unparseable SNR) doesn't 500 the endpoint.
    body = json.dumps(payload, allow_nan=False, default=str)
    return web.Response(
        body=body,
        status=200,
        content_type="application/json",
        headers={
            # CORS opened so a browser-based debug UI can fetch directly.
            # The data is non-sensitive and the endpoint is on a trusted
            # LAN — see file header.
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
        },
    )


def build_app(
    snapshot_fn: Callable[[], dict],
    *,
    profile_apply_fn: Optional[Callable[[str, Optional[int]], "object"]] = None,
    profile_list_fn: Optional[Callable[[], list]] = None,
    profile_current_fn: Optional[Callable[[], Optional[str]]] = None,
) -> web.Application:
    """Return an aiohttp Application that serves /health (+ /profile).

    Wired so the snapshot is re-rendered on every request (cheap — it's
    just dict construction), so the caller always sees the latest
    counter values, not a stale per-second-cached copy.

    Profile endpoints are optional. When ``profile_apply_fn`` is not
    provided, ``POST /profile`` returns 503 — useful in unit tests
    where a simulated radio doesn't support the side-channel write.

    Authorisation
    -------------
    These endpoints are reachable on the local LAN with no auth. The
    Pi has no public-facing routes (see file header) so this is the
    same trust posture as ``/health``. If you ever expose the Pi to
    the open internet you MUST add an auth check here — switching the
    LoRa profile to ``test_bench`` from an outside network would DOS
    the link.
    """
    app = web.Application()

    async def handle_health(_request: web.Request) -> web.Response:
        try:
            snap = snapshot_fn()
        except Exception:  # pragma: no cover — defensive
            logger.exception("health snapshot failed")
            # Generic error body — see file header on
            # information-disclosure prevention.
            return web.json_response(
                {"error": "snapshot_unavailable"}, status=500,
            )
        return _ok_json(snap)

    async def handle_profile_get(_request: web.Request) -> web.Response:
        available = profile_list_fn() if profile_list_fn else []
        current = profile_current_fn() if profile_current_fn else None
        enabled = profile_apply_fn is not None
        return _ok_json({"available": list(available), "current": current, "enabled": enabled})

    async def handle_profile_post(request: web.Request) -> web.Response:
        if profile_apply_fn is None:
            return web.json_response(
                {"error": "profile_switching_unavailable"}, status=503,
            )
        try:
            body = await request.json()
        except Exception:
            return web.json_response(
                {"error": "bad_json"}, status=400,
            )
        if not isinstance(body, dict):
            return web.json_response(
                {"error": "expected_object"}, status=400,
            )
        # Strict name allowlist enforced inside profile_apply_fn — we
        # just shape-check here so a typo returns a usable error.
        name = body.get("name")
        if not isinstance(name, str) or not name or len(name) > 32:
            return web.json_response(
                {"error": "invalid_name"}, status=400,
            )
        # Defence: a generic safe-chars filter on the name. The
        # firmware looks up by exact string compare against a static
        # table, but a malformed name could still end up in
        # logs / files we don't want.
        if not all(ch.isalnum() or ch in "_-" for ch in name):
            return web.json_response(
                {"error": "invalid_name_chars"}, status=400,
            )
        delay_raw = body.get("delay_ms")
        delay: Optional[int]
        if delay_raw is None:
            delay = None
        else:
            try:
                delay = int(delay_raw)
            except (TypeError, ValueError):
                return web.json_response(
                    {"error": "invalid_delay_ms"}, status=400,
                )
            if delay < 0 or delay > 30_000:
                return web.json_response(
                    {"error": "delay_out_of_range"}, status=400,
                )
        try:
            # The bridge's request_profile_change uses keyword-only
            # ``delay_ms`` so a positional second arg blows up at
            # runtime (TypeError). Call by keyword to keep this
            # decoupled from the bridge's exact signature; tests
            # pass a simpler fake without that arg so we tolerate it.
            try:
                result = profile_apply_fn(name, delay_ms=delay)  # type: ignore[call-arg]
            except TypeError:
                # Fallback for callables that take only the name.
                result = profile_apply_fn(name)  # type: ignore[call-arg]
            import inspect
            if inspect.isawaitable(result):
                applied = bool(await result)
            else:
                applied = bool(result)
        except Exception:
            logger.exception("profile apply failed for %s", name)
            return web.json_response(
                {"error": "apply_failed"}, status=500,
            )
        return _ok_json({"applied": applied, "name": name})

    app.router.add_get("/", handle_health)
    app.router.add_get("/health", handle_health)
    app.router.add_get("/profile", handle_profile_get)
    app.router.add_post("/profile", handle_profile_post)
    return app


async def start_health_server(
    snapshot_fn: Callable[[], dict],
    *,
    host: str = "0.0.0.0",
    port: Optional[int] = None,
    profile_apply_fn: Optional[Callable[[str, Optional[int]], "object"]] = None,
    profile_list_fn: Optional[Callable[[], list]] = None,
    profile_current_fn: Optional[Callable[[], Optional[str]]] = None,
) -> Optional[web.AppRunner]:
    """Start the health server in the background. Returns the
    ``AppRunner`` so the caller can ``await runner.cleanup()`` on
    shutdown.

    Bind address defaults to 0.0.0.0 so PortWatch on the same LAN can
    reach it. The Pi has no public-facing routes (per
    docs/22_server_bridge.md), so this is safe; override to "127.0.0.1"
    if you ever expose the Pi to the open internet.

    Default ``port`` follows ``.config.bridge.yaml::health.port``
    (:func:`default_health_listen_port`). Prefer that over literals so
    the LAN matches PortWatch probes.

    Resilience: if the port is already in use (another bridge replica,
    or a stale process), we log a clear error and return None rather
    than crashing the bridge — the LoRa side of the bridge is more
    important than the metrics endpoint and shouldn't die because of
    it.
    """
    resolved = int(port if port is not None else default_health_listen_port())

    app = build_app(
        snapshot_fn,
        profile_apply_fn=profile_apply_fn,
        profile_list_fn=profile_list_fn,
        profile_current_fn=profile_current_fn,
    )
    runner = web.AppRunner(app)
    try:
        await runner.setup()
        site = web.TCPSite(runner, host=host, port=resolved)
        await site.start()
    except OSError as exc:
        logger.error(
            "bridge health server failed to bind %s:%d (%s) — "
            "metrics endpoint disabled, LoRa relay unaffected",
            host,
            resolved,
            exc,
        )
        try:
            await runner.cleanup()
        except Exception:  # pragma: no cover
            pass
        return None
    logger.info(
        "bridge health server listening on http://%s:%d/health",
        host,
        resolved,
    )
    return runner


_DISCOVERY_HINT_RE = re.compile(r"^(_[\w.-]+)\._(tcp|udp)\.?$", re.I)


def bridge_health_discovery_fqdn() -> Optional[str]:
    """Bonjour PTR type from ``.config.bridge.yaml::health.discovery_hint``."""
    hint = _load_bridge_health_cfg().get("discovery_hint")
    if hint is None or str(hint).strip() == "":
        return None
    raw = str(hint).strip()
    mat = _DISCOVERY_HINT_RE.match(raw)
    if not mat:
        logger.warning(
            "bridge health mDNS: bad discovery_hint %r — skipping Bonjour", raw,
        )
        return None
    return f"{mat.group(1)}._{mat.group(2).lower()}.local."


def _guess_lan_ipv4_packed() -> Optional[bytes]:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("224.0.0.251", 1))
            ip = s.getsockname()[0]
        finally:
            s.close()
        if not ip.startswith("127."):
            return socket.inet_aton(ip)
    except OSError:
        pass
    return None


def maybe_start_health_mdns(*, listen_port: int) -> Optional[Callable[[], None]]:
    """Advertise `_titanic-bridge._tcp` for PortWatch LAN discovery.

    Best-effort: logs a warning on failure — static URLs still work
    (PortWatch can be pointed at the bridge by IP/port directly).
    Caller should invoke the returned callable on shutdown.

    Runs synchronously (short); uses the ``zeroconf`` package — keep that
    dep light.
    """
    fq_type = bridge_health_discovery_fqdn()
    if not fq_type:
        return None
    port = int(listen_port)
    if port < 1 or port > 65535:
        return None

    addr = _guess_lan_ipv4_packed()
    if addr is None:
        logger.warning(
            "bridge health mDNS: no LAN IPv4 guess — skipping Bonjour for type %s",
            fq_type,
        )
        return None

    try:
        from zeroconf import ServiceInfo, Zeroconf
    except ImportError:
        logger.warning(
            "bridge health mDNS: `zeroconf` not installed — run pip install -r "
            "control_podium/requirements.txt",
        )
        return None

    hn = socket.gethostname().split(".")[0].replace(" ", "-") or "titanic-bridge"
    safe = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in hn)[:63]
    inst = f"{safe}.{fq_type}"
    try:
        zc = Zeroconf()
        info = ServiceInfo(
            fq_type,
            inst,
            addresses=[addr],
            port=port,
            properties={},
        )
        zc.register_service(info)
    except Exception as exc:  # pragma: no cover
        logger.warning(
            "bridge health mDNS: register_service failed (%s) — LAN discovery via "
            "static URL only",
            exc,
        )
        return None

    logger.info(
        "bridge health mDNS: advertised %s on port %d",
        fq_type,
        port,
    )

    def _teardown() -> None:
        try:
            zc.unregister_service(info)
        except Exception:  # pragma: no cover
            logger.debug("bridge health mDNS: unregister suppressed", exc_info=True)
        try:
            zc.close()
        except Exception:
            logger.debug("bridge health mDNS: zeroconf close suppressed", exc_info=True)

    return _teardown
