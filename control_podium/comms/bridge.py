"""
bridge.py — Radio ↔ MarsinEngine translator.

Runs on the Raspberry Pi (or, in dev, on a laptop talking to ``sim_bus``).

Responsibilities:

1. **RX loop** — parse frames coming off the radio, ACL-check them,
   resolve ``cmd`` / ``qry`` paths through ``.config.commands.yaml``,
   translate to MarsinEngine REST calls, and reply with
   ``ack`` / ``nak`` / ``rep``.

2. **Status publisher** — every short/long interval, fetch a compact
   engine snapshot and broadcast a ``pub`` frame so every client UI
   stays in sync without polling.

Transport-agnostic: accepts any ``RadioPort`` instance. ``RadioPortSim``
for hardware-free development, ``RadioPortSerial`` for the real Pi
+ Heltec setup.

Out of scope (intentionally):
    * Cooldowns / rate limiting. The companion app or CaptainPad UI is
      in charge of pacing the operator. The bridge is the router, not the
      politeness layer.
    * Fire-station telemetry / config writes. Fire effects live in their
      OWN dedicated firmware (FW-SPEC-001) on a separate transport. The
      mesh radio carries no fire path — by design.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from .acl import AclTable
from .engine_client import EngineClient, EngineUnavailable
from .frame import (
    BROADCAST,
    Frame,
    SERVER_ID,
    TYPE_ACK,
    TYPE_CMD,
    TYPE_HLO,
    TYPE_NAK,
    TYPE_PING,
    TYPE_PONG,
    TYPE_PUB,
    TYPE_QRY,
    TYPE_REP,
    decode_path,
    encode_kv,
)
from .radio_port import RadioPort
from .registry import CommandRegistry

# `websockets` is optional at import time so unit tests that exercise
# `Bridge` against an in-process FakeEngine (no WS server) don't fall
# over on systems where the package isn't available. The subscriber
# task short-circuits gracefully when the import fails.
try:  # pragma: no cover — exercised in production deploy
    import websockets as _websockets
    from websockets.exceptions import (
        ConnectionClosed as _WSClosed,
        InvalidStatus as _WSInvalidStatus,
    )
except Exception:  # pragma: no cover
    _websockets = None
    _WSClosed = Exception  # type: ignore[assignment]
    _WSInvalidStatus = Exception  # type: ignore[assignment]

logger = logging.getLogger("titanic.bridge")


@dataclass
class BridgeStats:
    rx_frames: int = 0
    tx_frames: int = 0
    parse_errors: int = 0
    acl_denied: int = 0
    unknown_cmd: int = 0
    disabled_cmd: int = 0
    min_role_denied: int = 0
    engine_errors: int = 0
    pubs_sent: int = 0
    started_at: float = field(default_factory=time.time)


class _LogThrottle:
    """Tiny utility for collapsing repeated identical log lines.

    Designed for the bridge's two main log-spam sources during an
    outage: engine HTTP failures (every client poll generates one
    "qry engine_error: unreachable" line) and engine WS reconnect
    attempts (one line per backoff tick). With a 30 s engine outage
    and ~5 active clients, the old behaviour emitted ~50 lines of
    log noise — enough to push real anomalies off the screen.

    Behaviour:
      * The FIRST event for a given key always logs.
      * Subsequent events with the same key within ``period_s``
        log at DEBUG (kept for verbose troubleshooting) and bump a
        suppressed-count counter.
      * The first event AFTER ``period_s`` since the last INFO line
        emits an INFO summary including the suppressed-count.
      * Calling :meth:`clear` resets the key and emits a "recovered"
        line at INFO when something previously throttled comes back.
    """

    def __init__(self, *, period_s: float = 30.0):
        self.period_s = period_s
        # key → (last_info_log_monotonic, suppressed_count_since)
        self._state: dict[str, tuple[float, int]] = {}

    def log(self, logger_: logging.Logger, key: str, msg: str, *args) -> None:
        now = time.monotonic()
        last, suppressed = self._state.get(key, (0.0, 0))
        if last == 0.0 or (now - last) >= self.period_s:
            if suppressed > 0:
                logger_.info(
                    msg + " (+%d similar suppressed in last %.0fs)",
                    *args, suppressed, self.period_s,
                )
            else:
                logger_.info(msg, *args)
            self._state[key] = (now, 0)
        else:
            logger_.debug(msg, *args)
            self._state[key] = (last, suppressed + 1)

    def clear(self, logger_: logging.Logger, key: str, recovery_msg: str, *args) -> None:
        """Mark `key` as recovered; emit `recovery_msg` only if we'd
        previously logged a failure for it (avoids spammy "all clear"
        lines for keys that never went bad)."""
        if key in self._state:
            logger_.info(recovery_msg, *args)
            self._state.pop(key, None)


class Bridge:
    """Glue between the radio and the engine."""

    def __init__(
        self,
        radio: RadioPort,
        engine: EngineClient,
        acl: AclTable,
        registry: CommandRegistry,
        *,
        node_id: int = SERVER_ID,
        short_interval_s: float = 5.0,
        long_interval_s: float = 30.0,
        idle_threshold_s: float = 60.0,
        engine_ws_url: Optional[str] = None,
        enable_engine_ws_subscriber: bool = True,
    ):
        self.radio = radio
        self.engine = engine
        self.acl = acl
        self.registry = registry
        self.node_id = node_id
        self.short_interval_s = short_interval_s
        self.long_interval_s = long_interval_s
        self.idle_threshold_s = idle_threshold_s
        # `engine_ws_url` overrides the auto-derived default. When None
        # we derive ws://host:port from the engine HTTP base URL — the
        # MarsinEngine WS server runs on the same port as the REST API.
        self._engine_ws_url = engine_ws_url
        # Test-mode opt-out: when False, the bridge skips spawning the
        # engine WS subscriber. Needed because the unit-test FakeEngine
        # speaks plain HTTP/1.0 only — pointing a WS handshake at it
        # fills the test log with verbose handshake-fail backoff noise
        # AND leaves stale thread-pool work that flakes the next test's
        # 3-second reply timeouts.
        self._enable_engine_ws_subscriber = enable_engine_ws_subscriber

        # Log dampening state. Repeated identical failures (engine
        # down, WS port refused, etc.) used to fill the bridge log
        # with one INFO line per retry — on a 30 s WS backoff that's
        # still 120 lines/hour of "still down" while the engine is
        # actually out. Each `_LogThrottle` reports the first event
        # immediately, then at most once per `period_s` while the
        # same key keeps firing, and emits a "recovered" line the
        # first time a clear event lands after a stretch of muted
        # failures. Quiet logs make real anomalies obvious on a Pi
        # running unattended for days.
        self._engine_err_log = _LogThrottle(period_s=30.0)
        self._ws_log = _LogThrottle(period_s=60.0)

        self.stats = BridgeStats()
        self._last_client_activity: dict[int, float] = {}
        self._seen_seq: dict[int, int] = {}
        self._publisher_wake: asyncio.Event | None = None
        # Engine reachability — last successful `engine.status()` call.
        # Updated by `_status_publisher` on every cycle; surfaced by
        # ``health_snapshot()`` so PortWatch can show "bridge says engine
        # is reachable / unreachable" without needing the WS subscriber
        # to bounce (the WS subscriber stays connected even while the
        # engine is up but mid-pattern compile).
        self._engine_last_ok_ms: Optional[float] = None
        self._engine_last_fail_ms: Optional[float] = None
        self._engine_last_status: Optional[dict] = None
        self._engine_ws_connected: bool = False

        # Active LoRa profile — set by the most recent
        # ``request_profile_change()`` call (or by reading the persisted
        # name at startup). Surfaced in ``/health`` so PortWatch's
        # dropdown can render the right "currently selected" item.
        # None means the bridge has never explicitly applied a profile;
        # the firmware is then running on its compile-time defaults
        # OR on the profile remembered in its OWN NVS (independent of
        # the bridge). We don't auto-re-send a *CFG on startup because
        # the firmware's NVS is the ground truth for what the radio is
        # actually doing — re-sending could cause a brief mismatch
        # window if the controllers haven't finished booting yet.
        self._lora_profile_current: Optional[str] = self._load_profile_from_disk()
        self._lora_profile_last_applied_ms: Optional[float] = None

        # Subscribe to the firmware's out-of-band profile-applied
        # confirmation if the radio supports it (RadioPortSerial does;
        # the sim doesn't, harmless). Closes the bookkeeping loop for
        # captain-originated and manual-USB-push profile switches —
        # without it, bridge state can drift from the actual radio
        # state and PUBs advertise the wrong `prof/<name>`.
        if hasattr(self.radio, "_cfg_applied_callback"):
            self.radio._cfg_applied_callback = self.confirm_profile_applied

    # ── LoRa profile side channel ───────────────────────────────────
    # The controllers (titanic_profiles.h) recognise a plaintext
    # "*CFG name=… t=…" line on either USB serial or as a LoRa-relayed
    # payload. The bridge owns the operator-facing API: PortWatch hits
    # ``POST /profile`` (bridge_health.py), which calls into the
    # methods below.
    #
    # We deliberately keep the profile *table* on the firmware side —
    # the bridge just ships a name + a delay. That way adding a new
    # profile is a firmware-only change; the bridge and PortWatch
    # don't need to know its parameters.
    LORA_PROFILE_NAMES: tuple[str, ...] = (
        "test_bench", "local", "playa",
    )
    LORA_PROFILE_DEFAULT_DELAY_MS: int = 4000

    def lora_profiles_available(self) -> list[str]:
        """List of profile names recognised by the current firmware.

        Kept in lock-step with ``TITANIC_PROFILES[]`` in
        ``firmware/src/titanic_profiles.h``. If the two diverge, the
        firmware silently ignores unknown names (see
        ``_titanic_profile_find_by_name``) — PortWatch will appear to
        "apply" but nothing happens. Keep this list in sync when you
        add a new profile.
        """
        return list(self.LORA_PROFILE_NAMES)

    def lora_profile_current(self) -> Optional[str]:
        return self._lora_profile_current

    async def request_profile_change(
        self,
        name: str,
        *,
        delay_ms: Optional[int] = None,
    ) -> bool:
        """Send a ``*CFG name=<name> t=<delay_ms>`` line to the server
        controller via USB. The server firmware:

          1) Schedules the local apply for ``now() + delay_ms``.
          2) Re-transmits the same line on LoRa (3 retries spaced
             ~700 ms) so the captain receives it on the CURRENT
             profile and switches in lock-step.

        Returns True on a successful write (line bytes delivered to
        USB). Returns False if the radio port doesn't expose
        ``send_raw_line`` (e.g. simulated radio in unit tests) or if
        the name isn't in the recognised list.

        Persists the requested profile to disk via
        ``_save_profile_to_disk`` so a bridge restart re-applies the
        same choice — operator doesn't have to re-pick after a power
        blip.
        """
        if name not in self.LORA_PROFILE_NAMES:
            logger.warning("profile change rejected: unknown name %r", name)
            return False
        delay = (
            int(delay_ms)
            if delay_ms is not None
            else int(self.LORA_PROFILE_DEFAULT_DELAY_MS)
        )
        if delay < 0:
            delay = 0
        if delay > 30_000:
            delay = 30_000  # cap; longer than this is operator error
        sender = getattr(self.radio, "send_raw_line", None)
        if sender is None:
            logger.warning(
                "profile change rejected: radio port has no "
                "send_raw_line() (probably simulated)"
            )
            return False
        # Construct the wire line. Embed the params even though the
        # firmware looks up by name — gives the operator a paper trail
        # in journalctl when something goes sideways.
        line = f"*CFG name={name} t={delay}\n"
        try:
            ok = bool(await sender(line))
        except Exception:
            logger.exception("profile change: send_raw_line failed")
            return False
        if ok:
            self._lora_profile_current = name
            import time as _t
            self._lora_profile_last_applied_ms = _t.monotonic() * 1000.0
            self._save_profile_to_disk(name)
            logger.info(
                "profile change applied: name=%s delay_ms=%d", name, delay,
            )
        else:
            logger.warning(
                "profile change deferred: USB write failed for name=%s", name,
            )
        return ok

    def confirm_profile_applied(self, name: str) -> None:
        """Out-of-band callback from the radio when firmware reports
        a successful profile apply (CFG_APPLIED line on USB).

        This is how we keep `_lora_profile_current` honest regardless
        of WHO originated the switch:
          * Bridge initiated via /profile: confirmation matches what
            request_profile_change() already set; logs "confirmed".
          * Captain initiated via BLE *CFG: server applied it, relayed
            over LoRa, then echoes CFG_APPLIED to us. We had stale
            state ("playa") and the actual radio moved to "test_bench";
            this callback corrects the drift.
          * Manual USB push by an operator: same as above.

        The callback is idempotent and tolerates being called with
        unknown profile names (defends against a future firmware
        emitting names we don't yet know about — log + ignore).
        """
        if name not in self.LORA_PROFILE_NAMES:
            logger.warning(
                "CFG_APPLIED with unknown profile name %r — ignoring; "
                "this bridge may be older than the firmware",
                name,
            )
            return
        prev = self._lora_profile_current
        if prev == name:
            logger.debug("CFG_APPLIED confirmed: name=%s (no change)", name)
            return
        # Drift detected — the radio is on a profile the bridge didn't
        # know about. Update state + persist + wake the publisher so
        # the next PUB carries the correct `prof/<name>` and any UI
        # subscribed to that field re-syncs within one PUB cycle.
        self._lora_profile_current = name
        import time as _t
        self._lora_profile_last_applied_ms = _t.monotonic() * 1000.0
        self._save_profile_to_disk(name)
        logger.info(
            "CFG_APPLIED drift corrected: %r → %r (firmware authoritative)",
            prev, name,
        )
        if self._publisher_wake is not None:
            self._publisher_wake.set()

    # Persistence is intentionally a small file (not the NVS the
    # firmware uses — that lives on the ESP). We just need the bridge
    # process to remember its last operator choice across restarts.
    _PROFILE_DISK_PATH = "/var/lib/titanic-bridge/profile.txt"

    def _save_profile_to_disk(self, name: str) -> None:
        # Validate name against the allowlist so a buggy caller can't
        # write arbitrary text (which would then be replayed verbatim
        # at boot). Defence in depth — request_profile_change() already
        # gates by name.
        if name not in self.LORA_PROFILE_NAMES:
            return
        import os
        try:
            os.makedirs(
                os.path.dirname(self._PROFILE_DISK_PATH), exist_ok=True,
            )
            with open(self._PROFILE_DISK_PATH, "w") as f:
                f.write(name + "\n")
        except OSError as exc:
            # Don't crash the bridge; operator can re-pick after restart.
            logger.warning(
                "profile persist failed (%s); not fatal", exc,
            )

    def _load_profile_from_disk(self) -> Optional[str]:
        try:
            with open(self._PROFILE_DISK_PATH, "r") as f:
                name = f.read().strip()
        except OSError:
            return None
        if name in self.LORA_PROFILE_NAMES:
            return name
        # Stale / renamed profile from a previous firmware. Drop the
        # file rather than re-applying a profile that no longer exists.
        return None

    async def restore_profile_from_disk(self) -> Optional[str]:
        """Called once after the bridge has come up (and the server
        controller has had a moment to boot) so the persisted profile
        is re-applied without operator intervention.

        Safe to call when nothing is persisted — it just returns None.
        """
        name = self._load_profile_from_disk()
        if name is None:
            return None
        logger.info("profile restore from disk: name=%s", name)
        await self.request_profile_change(name)
        return name

    def health_snapshot(self) -> dict:
        """Return a JSON-safe operational snapshot for the bridge's
        ``/health`` HTTP endpoint. Mixes:

          * Bridge process stats (rx/tx frame counters, error counters,
            uptime, configured pub cadence).
          * LoRa link stats (RSSI/SNR last+avg, rx/tx counts, last-RX
            age) — pulled straight from the radio's ``link_stats``.
          * Engine reachability summary (URL the bridge is pointed at,
            last successful + last failing call timestamps, WS state).

        Security: NEVER include frame payloads, AES keys, the engine
        bearer token (if any), or any operator PII. The endpoint is on
        the LAN with no auth and the data is meant to be SAFE to render
        on any device that can reach the Pi — operational metrics only.
        """
        import time as _t
        now_ms = _t.monotonic() * 1000.0
        radio_stats = getattr(self.radio, "link_stats", None)
        lora_block = (
            radio_stats.snapshot()
            if radio_stats is not None
            else {"available": False}
        )
        # Engine reachability heuristic: "ok" if the last successful
        # status call was within ~3× short_interval_s (covers a few
        # missed cycles without alarming). "fail" if the last failing
        # call is newer than the last success. "unknown" before any
        # call has completed.
        if self._engine_last_ok_ms is None and self._engine_last_fail_ms is None:
            engine_ok: Optional[bool] = None
        elif self._engine_last_fail_ms is None:
            engine_ok = True
        elif self._engine_last_ok_ms is None:
            engine_ok = False
        else:
            engine_ok = self._engine_last_ok_ms >= self._engine_last_fail_ms
        engine_block = {
            "url": getattr(self.engine, "base_url", None),
            "reachable": engine_ok,
            "ws_connected": self._engine_ws_connected,
            "last_ok_ms_ago": (
                int(now_ms - self._engine_last_ok_ms)
                if self._engine_last_ok_ms is not None else None
            ),
            "last_fail_ms_ago": (
                int(now_ms - self._engine_last_fail_ms)
                if self._engine_last_fail_ms is not None else None
            ),
            "engine_errors": self.stats.engine_errors,
            "pubs_sent": self.stats.pubs_sent,
            # Echo a small subset of the last engine /status response so
            # PortWatch can confirm the bridge and the phone are looking
            # at the same engine. Stripped to non-sensitive fields only.
            "last_active_pattern": (
                (self._engine_last_status or {}).get("activePattern")
            ),
            "last_unreal_state": (
                (self._engine_last_status or {}).get("unrealState")
            ),
        }
        profile_block = {
            "available": list(self.LORA_PROFILE_NAMES),
            "current": self._lora_profile_current,
            "last_applied_ms_ago": (
                int(now_ms - self._lora_profile_last_applied_ms)
                if self._lora_profile_last_applied_ms is not None else None
            ),
            "default_delay_ms": int(self.LORA_PROFILE_DEFAULT_DELAY_MS),
        }
        return {
            "service": "titanic-bridge",
            "version": "1.1",
            "node_id": f"0x{self.node_id:02X}",
            "uptime_s": int(_t.time() - self.stats.started_at),
            "config": {
                "short_interval_s": self.short_interval_s,
                "long_interval_s": self.long_interval_s,
                "idle_threshold_s": self.idle_threshold_s,
            },
            "stats": {
                "rx_frames": self.stats.rx_frames,
                "tx_frames": self.stats.tx_frames,
                "parse_errors": self.stats.parse_errors,
                "acl_denied": self.stats.acl_denied,
                "unknown_cmd": self.stats.unknown_cmd,
                "min_role_denied": self.stats.min_role_denied,
            },
            "lora": lora_block,
            "engine": engine_block,
            "profile": profile_block,
        }

    # ── Entry point ──────────────────────────────────────────────────────
    async def run(self) -> None:
        self._publisher_wake = asyncio.Event()
        await self.radio.open()
        try:
            tasks = [
                self._rx_loop(),
                self._status_publisher(),
            ]
            if self._enable_engine_ws_subscriber:
                tasks.append(self._engine_ws_subscriber())
            await asyncio.gather(*tasks)
        finally:
            await self.radio.close()

    # ── RX loop ──────────────────────────────────────────────────────────
    async def _rx_loop(self) -> None:
        async for frame in self.radio.recv_frames():
            self.stats.rx_frames += 1
            try:
                await self._handle(frame)
            except Exception:  # pragma: no cover — last-line safety net
                logger.exception("unhandled error processing frame %s", frame)

    async def _handle(self, frame: Frame) -> None:
        if frame.src == self.node_id:
            return
        if frame.dst != self.node_id and frame.dst != BROADCAST:
            return

        first_contact = frame.src not in self._last_client_activity or (
            time.time() - self._last_client_activity[frame.src] > self.idle_threshold_s
        )
        self.acl.touch(frame.src)
        self._last_client_activity[frame.src] = time.time()
        if first_contact and self._publisher_wake is not None:
            self._publisher_wake.set()

        if not self.acl.allow(frame.src, frame.typ):
            self.stats.acl_denied += 1
            logger.info(
                "ACL: deny src=0x%02X (%s) typ=%s",
                frame.src, self.acl.name(frame.src), frame.typ,
            )
            if frame.wants_ack():
                await self._send(frame, TYPE_NAK, "acl_denied")
            return

        if frame.typ == TYPE_PING:
            await self._send(frame, TYPE_PONG, "")
            return

        if frame.typ == TYPE_HLO:
            await self._send(frame, TYPE_ACK, "welcome")
            # Wake the periodic publisher so the newly-connected client
            # gets a fresh compact_status PUB within ~tens of
            # milliseconds instead of waiting up to the long_interval_s
            # (usually 5–10 s) for the next scheduled poll. This is
            # the bridge half of the "no overriding active shows"
            # contract: the very first thing a PortWatch sees after
            # pairing is the real lock owner, active playlist, and
            # mixer view — so the operator can decide whether to
            # take control rather than blindly hitting buttons.
            if self._publisher_wake is not None:
                self._publisher_wake.set()
            # Also nudge the activity tracker so the adaptive
            # interval drops to short_interval_s while this client
            # is settling in (catches the burst of qrys / cmds that
            # PortWatch fires on connect).
            self._last_client_activity[frame.src] = time.time()
            return

        if frame.typ == TYPE_PUB:
            # Inbound pubs (e.g. from peer companions) are ignored by the
            # bridge — we are the canonical publisher of engine state.
            return

        if frame.typ == TYPE_QRY:
            await self._handle_qry(frame)
            return

        if frame.typ == TYPE_CMD:
            await self._handle_cmd(frame)
            return

    # ── Reply helpers ────────────────────────────────────────────────────
    async def _send(self, in_reply_to: Optional[Frame], typ: str,
                    arg: str = "", *, dst: Optional[int] = None,
                    seq: Optional[int] = None) -> None:
        if in_reply_to is not None:
            dst = dst if dst is not None else in_reply_to.src
            seq = seq if seq is not None else in_reply_to.seq
        else:
            assert dst is not None and seq is not None
        out = Frame(
            src=self.node_id, dst=dst, seq=seq, typ=typ, flags=0, arg=arg,
        )
        await self.radio.send(out)
        self.stats.tx_frames += 1

    # ── Dispatch: queries ────────────────────────────────────────────────
    async def _handle_qry(self, frame: Frame) -> None:
        head = frame.arg
        if not head:
            await self._send(frame, TYPE_NAK, "empty_qry")
            return
        role = self.acl.role(frame.src) or "crew"
        decision = self.registry.decide_qry(head, role)
        if not decision.allowed:
            if decision.nak_reason == "unknown_qry":
                await self._send(frame, TYPE_NAK, "unknown_qry")
                return
            if decision.nak_reason == "disabled":
                await self._send(frame, TYPE_NAK, "disabled")
                return
            if decision.nak_reason == "min_role":
                self.stats.min_role_denied += 1
                await self._send(frame, TYPE_NAK, "min_role")
                return

        path = decode_path(frame.arg)
        try:
            arg_out = await self._exec_qry(path)
        except EngineUnavailable as exc:
            self.stats.engine_errors += 1
            await self._send(frame, TYPE_NAK, "engine_error")
            # Same outage typically fires this once per client poll
            # (~5 clients × 5 s cadence = 60 lines/min). Throttle.
            self._engine_err_log.log(
                logger, "qry_unreachable", "qry engine_error: %s", exc,
            )
            return
        except KeyError:
            await self._send(frame, TYPE_NAK, "unknown_qry")
            return
        # Clean exec → engine is back. Emit a one-shot recovery
        # line if we were previously in the throttled state.
        self._engine_err_log.clear(
            logger, "qry_unreachable", "engine HTTP recovered",
        )
        await self._send(frame, TYPE_REP, arg_out)

    async def _exec_qry(self, path: tuple[str, ...]) -> str:
        if not path:
            raise KeyError("empty qry path")
        head, rest = path[0], path[1:]

        if head == "engine":
            sub = rest[0] if rest else ""
            if sub == "status":
                return await self.engine.compact_status()
            if sub == "playlist-patterns":
                # Paged listing of just the *active deck playlist*
                # entries' pattern names. Same paging shape as
                # engine/patterns. Wire reply (per page):
                #
                #   p/<idx>,t/<total>,n/<count>,pl/<name>,c/<csv>
                #
                # Additions over engine/patterns:
                #   - pl/<name>  — the active playlist's name (or `-`
                #     when no playlist is loaded), so PortWatch can
                #     label the picker and detect "playlist changed
                #     under us" between pages.
                #
                # When the engine has no active playlist we still
                # return one valid page (`pl/-,c/`) instead of NAK so
                # PortWatch can render a clean "no playlist loaded"
                # state without special-casing transport errors.
                page_req = 0
                if len(rest) >= 3 and rest[1] == "p":
                    try:
                        page_req = max(0, int(rest[2]))
                    except (TypeError, ValueError) as exc:
                        raise KeyError("engine/playlist-patterns/p/<n>") from exc
                pl_name, pats = await self.engine.get_deck_playlist_patterns()
                pages = _paginate_patterns(pats, csv_budget=80)
                total = max(1, len(pages))
                idx = min(page_req, total - 1)
                # `pl/` separator name is short enough that it fits
                # inside the same 100-char plaintext budget as the
                # original engine/patterns reply once you back out the
                # paging header. Keep `csv_budget=80` to leave room.
                csv_chunk = pages[idx]
                safe_pl = _wire_safe_playlist_name(pl_name)
                return f"p/{idx},t/{total},n/{len(pats)},pl/{safe_pl},c/{csv_chunk}"
            if sub == "get-playlist-patterns":
                # Paged pattern-name listing for an ARBITRARY playlist
                # (specified by name), without flipping the deck. Used
                # by PortWatch's REFRESH-WORLD action to fan a single
                # operator press out into a full pre-population of the
                # per-playlist patterns cache, so every subsequent
                # CaptainPad-driven playlist switch is rendered
                # instantly from the cache.
                #
                # Wire shape mirrors `engine/playlist-patterns` so the
                # client can share its parser:
                #
                #   qry  engine/get-playlist-patterns/<name>/p/<n>
                #   rep  p/<idx>,t/<total>,n/<count>,pl/<name>,c/<csv>
                #
                # The name MUST be wire-safe (alnum + `_.-`); we still
                # scrub on emission so a non-conforming engine name
                # can never corrupt the frame. An unknown name returns
                # one valid empty page rather than a NAK so PortWatch
                # can persist an "this playlist exists in the library
                # but has zero entries" record and skip retrying.
                if len(rest) < 4 or rest[2] != "p":
                    raise KeyError(
                        "engine/get-playlist-patterns/<name>/p/<n>"
                    )
                req_name = rest[1]
                try:
                    page_req = max(0, int(rest[3]))
                except (TypeError, ValueError) as exc:
                    raise KeyError(
                        "engine/get-playlist-patterns/<name>/p/<n>"
                    ) from exc
                pats = await self.engine.get_playlist_patterns_by_name(req_name)
                pages = _paginate_patterns(pats, csv_budget=80)
                total = max(1, len(pages))
                idx = min(page_req, total - 1)
                csv_chunk = pages[idx]
                safe_pl = _wire_safe_playlist_name(req_name) or "-"
                return f"p/{idx},t/{total},n/{len(pats)},pl/{safe_pl},c/{csv_chunk}"
            if sub == "patterns":
                # Two shapes:
                #   qry engine/patterns           (legacy, page 0 only,
                #                                  truncated with "+N")
                #   qry engine/patterns/p/<n>     (paged; client iterates
                #                                  pages until done)
                pats = await self.engine.list_patterns()
                # The page index, when explicitly requested, is the third
                # path component. Anything malformed gets clamped at 0.
                page_req = None
                if len(rest) >= 3 and rest[1] == "p":
                    try:
                        page_req = max(0, int(rest[2]))
                    except (TypeError, ValueError):
                        raise KeyError("engine/patterns/p/<n>")
                # SX1262 LoRa max payload is 255 bytes. After v2 framing
                # (header ~30 + AEAD tag 33 + base64-expanded ciphertext
                # 4/3 of plaintext), each plaintext byte costs ~1.34
                # ciphertext bytes. A 220-byte airframe budget (with
                # margin under the 255 max) allows ~115 plaintext bytes
                # max for the rep arg. We reserve ~15 chars for the
                # paging header (`p/<n>,t/<n>,n/<n>,c/`), leaving ~100
                # chars for the actual CSV chunk per page.
                pages = _paginate_patterns(pats, csv_budget=100)
                total = max(1, len(pages))
                if page_req is None:
                    # Legacy, single-frame shape — first page CSV plus
                    # "+N" if truncated. Keeps existing PortWatch /
                    # client_companion happy until they switch over to
                    # the paged shape.
                    if total == 1:
                        return pages[0]
                    head_csv = pages[0]
                    rest_n = sum(p.count(",") + 1 for p in pages[1:])
                    return f"{head_csv},+{rest_n}"
                # Paged shape: explicit metadata so the client can drive
                # its own loop without parsing "+N".
                idx = min(page_req, total - 1)
                csv_chunk = pages[idx]
                return f"p/{idx},t/{total},n/{len(pats)},c/{csv_chunk}"
            raise KeyError(head + "/" + sub)

        if head == "param":
            params = await self.engine.get_param_center()
            if not rest or rest[0] == "all":
                kv: dict = {}
                p_dict = params.get("params") if isinstance(params, dict) else None
                if isinstance(p_dict, dict):
                    for k in ("speed", "direction", "count", "size", "rotate"):
                        if k in p_dict and isinstance(p_dict[k], dict):
                            kv[k[:3]] = p_dict[k].get("value")
                return encode_kv(kv)
            from .engine_client import _extract_param
            value = _extract_param(params, rest[0])
            if value is None:
                raise KeyError("/".join(("param", rest[0])))
            return f"{rest[0]}/{value}"

        if head == "params":
            # Full-fidelity global params snapshot for PortWatch's
            # ParamsCard. Always one frame:
            #   sp/<f>,dr/<f>,ct/<f>,sz/<f>,rt/<f>,p1/<h>-<s>-<v>,p2/<h>-<s>-<v>
            # ~70 chars at full precision; well under the per-frame
            # plaintext budget. Fields the engine doesn't have yet are
            # omitted rather than nulled so the parser can tell
            # "engine is older" from "value is genuinely 0".
            params = await self.engine.get_param_center()
            p_dict = (params or {}).get("params") if isinstance(params, dict) else None
            kv: dict = {}
            if isinstance(p_dict, dict):
                for short, full in (
                    ("sp", "speed"),
                    ("dr", "direction"),
                    ("ct", "count"),
                    ("sz", "size"),
                    ("rt", "rotate"),
                ):
                    if full in p_dict and isinstance(p_dict[full], dict):
                        v = p_dict[full].get("value")
                        if isinstance(v, (int, float)):
                            kv[short] = _short_float(float(v))
                for short, full in (("p1", "colorPalette1"), ("p2", "colorPalette2")):
                    if full in p_dict and isinstance(p_dict[full], dict):
                        v = p_dict[full].get("value")
                        if isinstance(v, dict):
                            kv[short] = (
                                f"{_short_float(float(v.get('h', 0)))}"
                                f"-{_short_float(float(v.get('s', 0)))}"
                                f"-{_short_float(float(v.get('v', 0)))}"
                            )
            return encode_kv(kv)

        if head == "exports":
            # Paginated per-pattern WASM exports for PortWatch's local
            # parameters card. Wire shape per page:
            #
            #   p/<idx>,t/<total>,n/<count>,c/<id>~<kind>~<v0>~<name>,...
            #
            # `~` is used as the within-record separator because `:` and
            # `|` are forbidden in Frame args (firmware framing reasons,
            # see Frame.__post_init__). Pattern export NAMES are typed
            # by the pattern author so we ASCII-fold them defensively
            # to keep the wire chars sane.
            if not rest:
                raise KeyError("exports usage: exports/p/<n>")
            page_req = 0
            if rest[0] == "p":
                if len(rest) < 2:
                    raise KeyError("exports/p/<n>")
                try:
                    page_req = max(0, int(rest[1]))
                except (TypeError, ValueError) as exc:
                    raise KeyError("exports/p/<n>") from exc
            elif rest[0] != "all":
                raise KeyError("/".join(("exports",) + rest))
            exports = await self.engine.get_exports()
            recs: list[str] = []
            for e in exports:
                if not isinstance(e, dict):
                    continue
                eid = e.get("id")
                kind = e.get("kind")
                v0 = e.get("v0")
                name = e.get("name")
                if eid is None or kind is None or name is None:
                    continue
                v0_s = _short_float(float(v0)) if isinstance(v0, (int, float)) else "0"
                # Drop chars forbidden in frame args + our own separator.
                safe_name = "".join(
                    c if (c.isalnum() or c in "_.-") else "_"
                    for c in str(name)
                )[:24]
                recs.append(f"{int(eid)}~{int(kind)}~{v0_s}~{safe_name}")
            pages = _paginate_csv(recs, csv_budget=100)
            total = max(1, len(pages))
            idx = min(page_req, total - 1)
            return f"p/{idx},t/{total},n/{len(recs)},c/{pages[idx]}"

        if head == "playlists":
            # Paginated playlist directory listing. Same paging shape as
            # exports/patterns; one frame per page until the operator's
            # client says "show me page N+1".
            if not rest:
                raise KeyError("playlists usage: playlists/p/<n>")
            page_req = 0
            if rest[0] == "p":
                if len(rest) < 2:
                    raise KeyError("playlists/p/<n>")
                try:
                    page_req = max(0, int(rest[1]))
                except (TypeError, ValueError) as exc:
                    raise KeyError("playlists/p/<n>") from exc
            elif rest[0] != "all":
                raise KeyError("/".join(("playlists",) + rest))
            names = await self.engine.list_playlists()
            pages = _paginate_patterns(names, csv_budget=100)
            total = max(1, len(pages))
            idx = min(page_req, total - 1)
            return f"p/{idx},t/{total},n/{len(names)},c/{pages[idx]}"

        if head == "deck":
            # Snapshot of the deck's currently-loaded playlist:
            #   pl/<name>,en/<entryId>,n/<entryCount>
            # When no playlist is assigned we return `pl/-`. PortWatch's
            # parser treats `-` as null so the highlight in the playlist
            # picker collapses cleanly.
            sub = rest[0] if rest else "playlist"
            if sub != "playlist":
                raise KeyError("/".join(("deck",) + rest))
            doc = await self.engine.get_deck_playlist()
            if not isinstance(doc, dict) or not doc.get("name"):
                return "pl/-"
            name = str(doc.get("name") or "")
            entry_id = str(doc.get("activeEntryId") or "")
            kv = {"pl": name or "-"}
            if entry_id:
                kv["en"] = entry_id
            return encode_kv(kv)

        if head == "mixer":
            mx = await self.engine.get_mixer()
            if rest and rest[0] == "state":
                master = (mx or {}).get("master")
                channels = (mx or {}).get("channels", [])
                kv = {"m": int(round((master or 0) * 100)), "n": len(channels)}
                return encode_kv(kv)
            raise KeyError("/".join(("mixer",) + rest))

        raise KeyError(head)

    # ── Dispatch: commands ───────────────────────────────────────────────
    async def _handle_cmd(self, frame: Frame) -> None:
        # Idempotency: same (src, seq) → same answer.
        prev = self._seen_seq.get(frame.src)
        if prev == frame.seq:
            await self._send(frame, TYPE_ACK, "dup")
            return
        self._seen_seq[frame.src] = frame.seq

        path = decode_path(frame.arg)
        if not path:
            await self._send(frame, TYPE_NAK, "empty_cmd")
            return
        head = path[0]
        role = self.acl.role(frame.src) or "crew"

        decision = self.registry.decide_cmd(head, role)
        if not decision.allowed:
            if decision.nak_reason == "unknown_cmd":
                self.stats.unknown_cmd += 1
                await self._send(frame, TYPE_NAK, "unknown_cmd")
                return
            if decision.nak_reason == "disabled":
                self.stats.disabled_cmd += 1
                await self._send(frame, TYPE_NAK, "disabled")
                return
            if decision.nak_reason == "min_role":
                self.stats.min_role_denied += 1
                await self._send(frame, TYPE_NAK, "min_role")
                return

        try:
            ok_arg = await self._exec_cmd(path)
        except EngineUnavailable as exc:
            self.stats.engine_errors += 1
            await self._send(frame, TYPE_NAK, "engine_error")
            self._engine_err_log.log(
                logger, "cmd_unreachable", "cmd engine_error: %s", exc,
            )
            return
        except KeyError:
            self.stats.unknown_cmd += 1
            await self._send(frame, TYPE_NAK, "unknown_cmd")
            return
        except ValueError as exc:
            await self._send(frame, TYPE_NAK, f"bad_arg,{_safe_short(exc)}")
            return

        await self._send(frame, TYPE_ACK, ok_arg)

    async def _exec_cmd(self, path: tuple[str, ...]) -> str:
        head, rest = path[0], path[1:]

        if head == "pattern":
            if not rest:
                raise ValueError("missing pattern name")
            await self.engine.set_pattern(rest[0])
            return "ok"

        if head == "param":
            if len(rest) != 2:
                raise ValueError("usage param/<key>/<value>")
            key, value_s = rest
            # Two value shapes:
            #   numeric scalar: "0.5"
            #   HSV triple   : "0.5-1-1" (h-s-v, hyphen-separated)
            # The engine's CPC accepts {h,s,v} for colorPalette*; sending
            # a bare number for those would silently clamp to default.
            if "-" in value_s:
                parts = value_s.split("-")
                if len(parts) != 3:
                    raise ValueError("hsv value must be h-s-v")
                try:
                    h, s, v = (float(p) for p in parts)
                except ValueError as exc:
                    raise ValueError("hsv components must be numeric") from exc
                await self.engine.set_param(key, {"h": h, "s": s, "v": v})
                return "ok"
            try:
                value: float = float(value_s)
            except ValueError as exc:
                raise ValueError("value must be numeric") from exc
            await self.engine.set_param(key, value)
            return "ok"

        if head == "palette":
            # Convenience alias for the colorPalette CPC keys. Same wire
            # cost as `cmd param/colorPaletteN/h-s-v` but easier to type
            # in field tests and easier to grep for in logs.
            if len(rest) != 2:
                raise ValueError("usage palette/<1|2>/<h-s-v>")
            slot_s, value_s = rest
            try:
                slot = int(slot_s)
            except ValueError as exc:
                raise ValueError("palette slot must be 1 or 2") from exc
            if slot not in (1, 2):
                raise ValueError("palette slot must be 1 or 2")
            parts = value_s.split("-")
            if len(parts) != 3:
                raise ValueError("hsv value must be h-s-v")
            try:
                h, s, v = (float(p) for p in parts)
            except ValueError as exc:
                raise ValueError("hsv components must be numeric") from exc
            await self.engine.set_palette(slot, h, s, v)
            return "ok"

        if head == "exp":
            # Per-pattern WASM export write. Wire form:
            #   cmd exp/<crc32_id>/<v0>
            # We don't surface v1/v2 over LoRa yet (sliders are 1-D and
            # the few HSV exports patterns do declare are picked up by
            # the engine's CPC instead). Adding them later is a wire
            # extension, not a refactor — `exp/<id>/<v0>/<v1>/<v2>`.
            if len(rest) != 2:
                raise ValueError("usage exp/<id>/<v0>")
            id_s, v0_s = rest
            try:
                control_id = int(id_s)
            except ValueError as exc:
                raise ValueError("export id must be integer") from exc
            try:
                v0 = float(v0_s)
            except ValueError as exc:
                raise ValueError("v0 must be numeric") from exc
            await self.engine.set_control(control_id, v0)
            return "ok"

        if head == "playlist":
            # Switch the deck's active playlist. The engine reloads the
            # first non-missing entry and broadcasts both `mixer` and
            # `pattern` WS events; the bridge's WS subscriber then
            # wakes the publisher so PortWatch sees the new pattern
            # name within a couple hundred ms.
            if not rest:
                raise ValueError("missing playlist name")
            await self.engine.set_deck_playlist(rest[0])
            return "ok"

        if head == "blackout":
            if not rest:
                raise ValueError("missing state")
            await self.engine.set_blackout(rest[0] == "1")
            return "ok"

        if head == "autopilot":
            if not rest:
                raise ValueError("missing state")
            # Three shapes:
            #   cmd autopilot/0|1                  → on/off
            #   cmd autopilot/interval/<seconds>   → set delay_s
            #   cmd autopilot/shuffle/0|1          → set shuffle
            sub = rest[0]
            if sub in ("0", "1"):
                await self.engine.set_autopilot(active=sub == "1")
                return "ok"
            if sub in ("interval", "delay"):
                if len(rest) != 2:
                    raise ValueError("usage autopilot/interval/<sec>")
                try:
                    secs = int(rest[1])
                except ValueError as exc:
                    raise ValueError("interval must be integer") from exc
                # Engine clamps internally too; we clamp here so an
                # absurd over-the-wire value doesn't even reach it.
                if secs < 1 or secs > 3600:
                    raise ValueError("interval must be 1..3600")
                await self.engine.set_autopilot(delay_s=secs)
                return "ok"
            if sub == "shuffle":
                if len(rest) != 2:
                    raise ValueError("usage autopilot/shuffle/<0|1>")
                await self.engine.set_autopilot(shuffle=rest[1] == "1")
                return "ok"
            raise ValueError("usage autopilot/0|1|interval|shuffle")

        if head == "fx":
            if len(rest) != 2:
                raise ValueError("usage fx/<name>/<0|1>")
            name, state_s = rest
            # SAFETY: the radio protocol carries no fire path. The "fire"
            # global effect (and any future *fire* variant) energizes the
            # whole rig's flame outputs from the engine — we keep that
            # firmly off-radio. Even though the registry already gates
            # `fx` to captain, this is defense-in-depth in case the
            # registry is misconfigured.
            lname = name.lower()
            if "fire" in lname:
                raise ValueError("fx_fire_blocked")
            await self.engine.set_global_effect(name, state_s == "1")
            return "ok"

        if head == "brightness":
            if not rest:
                raise ValueError("missing value")
            try:
                v = int(rest[0])
            except ValueError as exc:
                raise ValueError("brightness must be 0..100") from exc
            v = max(0, min(100, v))
            await self.engine.update_mixer_master(v / 100.0)
            return "ok"

        if head == "view":
            # Force the engine output to one of the views, with a
            # "clear" verb that pops back to whatever the user had
            # before. Engine-side state is in /mixer/view-override.
            #
            # `view/renew` is the lease-renew alias — semantically the
            # same as `view/deck` (idempotent take) but with a
            # different verb so logs make the intent obvious
            # ("PortWatch renewed the lock" vs "PortWatch took the
            # lock"). Both go through the same engine POST that
            # restarts the 30 s timer.
            if not rest:
                raise ValueError("usage view/deck|view/clear|view/renew")
            sub = rest[0]
            if sub == "deck":
                await self.engine.set_view_override("deck")
                return "deck"
            if sub == "renew":
                await self.engine.set_view_override("deck")
                return "renew"
            if sub in ("clear", "off", "release"):
                await self.engine.set_view_override(None)
                return "clear"
            raise ValueError("usage view/deck|view/clear|view/renew")

        raise KeyError(head)

    # ── Status publisher ─────────────────────────────────────────────────
    async def _status_publisher(self) -> None:
        pub_seq = 0
        while True:
            try:
                arg = await self.engine.compact_status()
                # Health-snapshot bookkeeping: every successful
                # compact_status hit is also a successful engine probe
                # from the bridge's perspective. We don't need a separate
                # /status round-trip just to refresh the health endpoint
                # — same thing the publisher already does, no extra cost.
                self._engine_last_ok_ms = time.monotonic() * 1000.0
                try:
                    self._engine_last_status = await self.engine.status()
                except EngineUnavailable:
                    # Status() failure right after compact_status() worked
                    # is exotic but possible (e.g. engine restarted in the
                    # ~ms gap). Don't flip the engine_ok bit on its own —
                    # only the compact_status path does that. Just skip
                    # the snapshot refresh; we'll get it next cycle.
                    pass
            except EngineUnavailable:
                arg = "dn/1"
                self.stats.engine_errors += 1
                self._engine_last_fail_ms = time.monotonic() * 1000.0
            # Announce the active LoRa profile in every PUB so any node
            # in earshot — including a freshly-booted crew or captain
            # joining the mesh — can learn what profile to switch to.
            # `prof/<name>` is a single short field; cost is ~12 bytes
            # on top of a ~80-150 byte status frame. Omitted when no
            # profile has been applied since boot (let the receiver
            # keep its compile-time default).
            prof = self._lora_profile_current
            if prof:
                arg = f"{arg},prof/{prof}"
            await self._send(
                None, TYPE_PUB, arg, dst=BROADCAST, seq=pub_seq & 0xFF,
            )
            self.stats.pubs_sent += 1
            pub_seq = (pub_seq + 1) & 0xFF

            interval = self._adaptive_interval()
            assert self._publisher_wake is not None
            try:
                await asyncio.wait_for(self._publisher_wake.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass
            self._publisher_wake.clear()

    def _adaptive_interval(self) -> float:
        if not self._last_client_activity:
            return self.long_interval_s
        recent = max(self._last_client_activity.values())
        if time.time() - recent < self.idle_threshold_s:
            return self.short_interval_s
        return self.long_interval_s

    # ── Engine WS subscriber ────────────────────────────────────────────
    async def _engine_ws_subscriber(self) -> None:
        """Long-lived task that subscribes to the engine's WebSocket
        and wakes the periodic publisher whenever a relevant transition
        lands. Mirrors the same WS payloads CaptainPad listens to —
        ``pattern``, ``autopilot``, ``mixer``, ``viewOverride`` — so
        every operator-visible change the engine knows about gets
        rebroadcast over LoRa within a few hundred milliseconds rather
        than waiting up to 30 s for the next periodic poll.

        Best-effort by design: if the WS is unavailable (engine down,
        wrong URL, no `websockets` package) we fall back to the
        periodic publisher and try to reconnect every few seconds.
        """
        if _websockets is None:
            logger.info(
                "engine WS subscriber disabled: websockets package not installed"
            )
            return

        ws_url = self._derive_ws_url()
        if not ws_url:
            logger.info("engine WS subscriber disabled: no ws_url derivable")
            return

        backoff = 1.0
        while True:
            try:
                async with _websockets.connect(
                    ws_url,
                    open_timeout=5.0,
                    ping_interval=20.0,
                    ping_timeout=10.0,
                ) as ws:
                    # First successful connect after a failure stretch
                    # gets a clear "recovered" line; otherwise just a
                    # debug-level connect log (every reconnect would
                    # otherwise spam INFO during a flap).
                    self._ws_log.clear(
                        logger, "ws_down",
                        "engine WS recovered: %s", ws_url,
                    )
                    logger.debug("engine WS connected: %s", ws_url)
                    backoff = 1.0  # reset on success
                    self._engine_ws_connected = True
                    async for raw in ws:
                        # We deliberately don't try to forward the
                        # full payload — the LoRa wire is too narrow
                        # for that. We just use the WS as a low-latency
                        # change notification: the periodic publisher
                        # then re-fetches and broadcasts the compact
                        # state, which already encodes everything our
                        # clients render (pat / br / blk / ap / apd /
                        # aps / sp).
                        if not self._is_relevant_ws_event(raw):
                            continue
                        if self._publisher_wake is not None:
                            self._publisher_wake.set()
            except (asyncio.CancelledError, GeneratorExit):
                raise
            except _WSInvalidStatus as exc:
                # 404 / 401 etc — usually means the engine doesn't
                # speak WS on this port. Throttle so a misconfigured
                # engine URL doesn't blow up the log.
                self._engine_ws_connected = False
                self._ws_log.log(
                    logger, "ws_down",
                    "engine WS rejected (%s); will retry every %.0fs",
                    exc, self._ws_log.period_s,
                )
            except (_WSClosed, OSError, ConnectionError) as exc:
                self._engine_ws_connected = False
                # Same throttle key — operator sees one line per
                # `period_s` while the engine is down, plus an
                # explicit "recovered" line when it comes back.
                self._ws_log.log(
                    logger, "ws_down",
                    "engine WS closed (%s); will retry every %.0fs",
                    exc, self._ws_log.period_s,
                )
            except Exception:  # pragma: no cover — defensive
                logger.exception("engine WS subscriber error")

            await asyncio.sleep(backoff)
            # Cap the backoff at 30 s so transient outages still
            # recover quickly once the engine is back up.
            backoff = min(30.0, backoff * 2)

    def _derive_ws_url(self) -> Optional[str]:
        """Pick a ws:// URL for the engine. Honours an explicit
        override; otherwise reuses the engine HTTP base URL host/port.
        Returns ``None`` only when neither is set, which only happens
        in unit tests with an in-process FakeEngine.
        """
        if self._engine_ws_url:
            return self._engine_ws_url
        base = getattr(self.engine, "base_url", None)
        if not base:
            return None
        if base.startswith("http://"):
            return "ws://" + base[len("http://"):]
        if base.startswith("https://"):
            return "wss://" + base[len("https://"):]
        return None

    @staticmethod
    def _is_relevant_ws_event(raw: object) -> bool:
        """Filter the noisy per-frame ``vis`` traffic out of the WS
        firehose. Everything else (``pattern``, ``autopilot``,
        ``mixer``, ``viewOverride``, ``playlistLibrary``,
        ``sharedParams``…) is rare enough that treating it as a
        "republish now" signal is cheap.

        `playlistLibrary` / `playlistSaved` / `playlistDeleted` are
        included so the periodic publisher's `pl/<name>` field
        catches up to the engine's new selection promptly. The
        library *list* itself is cached client-side via AsyncStorage
        (operator-driven REFRESH), so wake-on-event doesn't push
        the new names — it just ensures the active-playlist name
        on the PUB stays correct.

        `sharedParams` is included so CaptainPad-side CPC nudges
        (speed / direction / count / size / rotate / palette1 /
        palette2) propagate to PortWatch over the next compact PUB
        instead of waiting for the 5 s `qry params/snapshot` poll.
        The compact-status payload carries every CPC scalar + both
        palette slots in `sp/dr/ct/sz/rt/p1/p2`, so a single
        wake-on-event covers the full global-params surface.
        """
        if not isinstance(raw, (str, bytes, bytearray)):
            return False
        try:
            if isinstance(raw, (bytes, bytearray)):
                msg = json.loads(raw.decode("utf-8", "replace"))
            else:
                msg = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return False
        if not isinstance(msg, dict):
            return False
        typ = msg.get("type")
        # `vis` fires every frame and would pin the publisher to the
        # short interval forever. `stats` fires every second too —
        # also skipped to keep TX duty cycle sane.
        return typ in {
            "pattern",
            "autopilot",
            "mixer",
            "viewOverride",
            "playlistLibrary",
            "playlistSaved",
            "playlistDeleted",
            "sharedParams",
        }


# ── Helpers ────────────────────────────────────────────────────────────────


def _wire_safe_playlist_name(name: object) -> str:
    """Sanitize a playlist name for the compact-status / playlist-patterns
    wire format. The frame-arg CSV is comma- and slash-tokenized, so we
    fold anything outside ``[A-Za-z0-9_.-]`` to ``_`` and clip to 32
    chars. An empty/missing name renders as ``-`` so the receiver can
    distinguish "no playlist loaded" from "playlist with an empty name".

    Centralized here so the two ops that emit `pl/<name>` (the deck's
    own playlist-patterns op AND the arbitrary-name `get-playlist-
    patterns` op) cannot drift in their handling of weird names.
    """
    if not name:
        return "-"
    safe = "".join(c if (c.isalnum() or c in "_.-") else "_" for c in str(name))
    return safe[:32] or "-"


def _paginate_patterns(pats: list[str], *, csv_budget: int = 100) -> list[str]:
    """Split a flat list of pattern names into CSV chunks that fit a
    single LoRa frame's plaintext budget.

    Per chunk we pack as many names as fit; we never split a name
    across pages. Returns at least one page (empty CSV when the input
    is empty). The caller wraps each page with a `p/<n>,t/<total>,c/`
    header before sending.
    """
    if not pats:
        return [""]
    pages: list[str] = []
    cur: list[str] = []
    cur_len = 0
    for name in pats:
        # account for the comma we'll need before this name (zero on the
        # first name in a page).
        sep = 1 if cur else 0
        nlen = len(name)
        if cur and cur_len + sep + nlen > csv_budget:
            pages.append(",".join(cur))
            cur = [name]
            cur_len = nlen
            continue
        cur.append(name)
        cur_len += sep + nlen
    if cur:
        pages.append(",".join(cur))
    return pages


def _short_float(v: float) -> str:
    """Compact float formatter for over-the-wire values.

    Strips trailing zeros and the trailing dot so 0.5 → "0.5", 1.0 →
    "1", 0.123456 → "0.123" (3 fractional digits is plenty for the
    sliders the operator ever moves by hand). Keeps each number under
    8 chars so a row of 7 params fits in one frame.
    """
    if not isinstance(v, (int, float)):
        return "0"
    fixed = f"{float(v):.3f}"
    # Strip trailing zeros and trailing dot if any.
    if "." in fixed:
        fixed = fixed.rstrip("0").rstrip(".")
    if fixed in ("", "-0"):
        return "0"
    return fixed


def _paginate_csv(records: list[str], *, csv_budget: int = 100) -> list[str]:
    """Pack a list of pre-formatted records into CSV chunks that fit
    a single LoRa frame's plaintext budget. Mirrors
    :func:`_paginate_patterns` but for arbitrary record strings (the
    `~`-delimited export tuples we pack in `qry exports`). We never
    split a record across pages — each record is atomic — so the
    caller must keep individual records under ``csv_budget`` chars.
    Records longer than the budget are dropped (logged) rather than
    crashing the bridge.
    """
    if not records:
        return [""]
    pages: list[str] = []
    cur: list[str] = []
    cur_len = 0
    for rec in records:
        if len(rec) > csv_budget:
            logger.warning(
                "_paginate_csv: dropping oversized record (%d>%d chars): %s",
                len(rec), csv_budget, rec[:24]
            )
            continue
        sep = 1 if cur else 0
        if cur and cur_len + sep + len(rec) > csv_budget:
            pages.append(",".join(cur))
            cur = [rec]
            cur_len = len(rec)
            continue
        cur.append(rec)
        cur_len += sep + len(rec)
    if cur:
        pages.append(",".join(cur))
    if not pages:
        return [""]
    return pages


def _safe_short(exc: BaseException) -> str:
    """Compact, frame-safe exception text (no colons/pipes/newlines).

    Frame args may contain ``/`` and ``,`` (they're our own separators),
    but ``:`` and ``|`` are forbidden by ``Frame.__post_init__`` because
    the firmware's USB framing uses ``:`` and our wire protocol uses
    ``|``. We replace only those characters and clamp the length.
    """
    text = str(exc) or exc.__class__.__name__
    bad = ":|\n\r"
    return "".join("_" if c in bad else c for c in text)[:48]
