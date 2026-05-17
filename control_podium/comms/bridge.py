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

        self.stats = BridgeStats()
        self._last_client_activity: dict[int, float] = {}
        self._seen_seq: dict[int, int] = {}
        self._publisher_wake: asyncio.Event | None = None

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
            logger.info("qry engine_error: %s", exc)
            return
        except KeyError:
            await self._send(frame, TYPE_NAK, "unknown_qry")
            return
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
            logger.info("cmd engine_error: %s", exc)
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
            except EngineUnavailable:
                arg = "dn/1"
                self.stats.engine_errors += 1
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
                    logger.info("engine WS connected: %s", ws_url)
                    backoff = 1.0  # reset on success
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
                # speak WS on this port. Don't spam the log; back off.
                logger.warning(
                    "engine WS rejected (%s); retrying in %.1fs", exc, backoff
                )
            except (_WSClosed, OSError, ConnectionError) as exc:
                logger.info(
                    "engine WS closed (%s); reconnecting in %.1fs", exc, backoff
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
