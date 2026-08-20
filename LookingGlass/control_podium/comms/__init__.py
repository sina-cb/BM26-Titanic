"""
comms — Titanic radio comms layer (multi-client over LoRa or simulated bus).

The wire protocol is "Titanic Frame v2" (AEAD-secured), documented in
``docs/07_control_podium.md``. This package contains:

- ``frame``       — encode / decode the on-air text frames.
- ``secure``      — AES-128-GCM AEAD codec for v2 frames.
- ``replay``      — per-source counter window for anti-replay.
- ``acl``         — node-id → role lookup, privilege checks.
- ``sim_bus``     — a TCP "broadcast medium" daemon that replaces real LoRa
                    so we can develop without hardware.
- ``radio_port``  — abstract base for sending / receiving frames.
- ``radio_port_sim``    — adapter for ``sim_bus``.
- ``radio_port_serial`` — adapter for the real firmware (USB serial).
- ``engine_client``     — async HTTP/WS client for MarsinEngine.
- ``registry``    — command + query allowlist loaded from YAML.
- ``bridge``      — the Raspberry Pi translator (radio <-> engine).
"""

from .frame import (
    Frame,
    FrameError,
    FLAG_ACK_REQUESTED,
    FLAG_PRIVILEGED,
    FLAG_RETRY,
    TYPE_HLO,
    TYPE_PING,
    TYPE_PONG,
    TYPE_CMD,
    TYPE_ACK,
    TYPE_NAK,
    TYPE_QRY,
    TYPE_REP,
    TYPE_PUB,
    BROADCAST,
    SERVER_ID,
)

__all__ = [
    "Frame",
    "FrameError",
    "FLAG_ACK_REQUESTED",
    "FLAG_PRIVILEGED",
    "FLAG_RETRY",
    "TYPE_HLO",
    "TYPE_PING",
    "TYPE_PONG",
    "TYPE_CMD",
    "TYPE_ACK",
    "TYPE_NAK",
    "TYPE_QRY",
    "TYPE_REP",
    "TYPE_PUB",
    "BROADCAST",
    "SERVER_ID",
]
