"""
engine_client.py — Async HTTP client for MarsinEngine.

We use ``urllib`` from stdlib (avoids a new dependency on aiohttp / httpx).
All calls run in the default executor; the bridge awaits them so the rest of
the event loop keeps moving while engine I/O is in flight.

Security note: the engine URL is provided by ``.config.bridge.yaml``, NOT by
radio traffic. Radio frames choose between named commands in an allowlist;
they never supply a URL. This satisfies the SSRF prevention rule.

**Multi-engine support.** The bridge config can list a primary `url` plus a
`fallback_urls` array. ``EngineClient.discover()`` probes them in order at
startup and returns the first one that answers `GET /status` within the
timeout. Manual override stays the default constructor path so unit tests
don't need a network.
"""

from __future__ import annotations

import asyncio
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterable, Optional

from .frame import encode_kv

logger = logging.getLogger("titanic.engine_client")

# Outbound URLs are loaded from .config.bridge.yaml (operator-controlled,
# not radio-controlled). We restrict to http/https to satisfy the SSRF
# rule even on misconfiguration; loopback-only is NOT enforced because
# the production rig has the engine on another LAN machine.
_ALLOWED_SCHEMES = ("http", "https")


def _validate_scheme(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise ValueError(
            f"engine URL must be one of {_ALLOWED_SCHEMES}, got {parsed.scheme!r}"
        )
    return url.rstrip("/")


class EngineUnavailable(RuntimeError):
    """Raised when the engine is unreachable or returns 5xx."""


class EngineClient:
    """Thin wrapper over MarsinEngine's REST API (port 6968 by default)."""

    def __init__(self, base_url: str = "http://127.0.0.1:6968",
                 timeout_s: float = 2.0):
        self.base_url = _validate_scheme(base_url)
        self.timeout_s = timeout_s

    # ── Discovery / fallback ─────────────────────────────────────────
    @classmethod
    async def discover(cls, urls: Iterable[str], *,
                       probe_timeout_s: float = 1.0,
                       call_timeout_s: float = 2.0) -> "EngineClient":
        """Probe a list of URLs and return a client bound to the first
        one whose ``GET /status`` succeeds within ``probe_timeout_s``.

        Raises ``EngineUnavailable`` listing every URL we tried if none
        respond. The bridge calls this at startup so a typo'd primary URL
        falls through to the localhost backup with a clear log line.
        """
        urls = [_validate_scheme(u) for u in urls if u]
        if not urls:
            raise ValueError("discover() needs at least one URL")
        loop = asyncio.get_running_loop()
        attempted = []
        for url in urls:
            attempted.append(url)
            ok = await loop.run_in_executor(
                None, _probe_status, url, probe_timeout_s,
            )
            if ok:
                logger.info("engine selected: %s", url)
                return cls(url, timeout_s=call_timeout_s)
            logger.warning("engine probe failed: %s", url)
        raise EngineUnavailable(
            f"no engine responded to /status; tried: {', '.join(attempted)}"
        )

    # ── Low-level ────────────────────────────────────────────────────────
    async def _request(self, method: str, path: str,
                       body: Optional[dict] = None) -> Any:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self._do_request, method, path, body,
        )

    def _do_request(self, method: str, path: str, body: Optional[dict]) -> Any:
        url = f"{self.base_url}{path}"
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                payload = resp.read()
        except urllib.error.HTTPError as exc:
            # Surface 4xx with the body so the bridge can include it in nak.
            try:
                detail = exc.read().decode("utf-8", errors="replace")
            except Exception:
                detail = ""
            raise EngineUnavailable(f"HTTP {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise EngineUnavailable(f"unreachable: {exc.reason}") from exc

        if not payload:
            return None
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return payload.decode("utf-8", errors="replace")

    # ── Engine-specific helpers ──────────────────────────────────────────
    async def status(self) -> dict:
        return await self._request("GET", "/status")

    async def list_patterns(self) -> list[str]:
        data = await self._request("GET", "/list-patterns")
        return data if isinstance(data, list) else []

    async def set_pattern(self, name: str) -> dict:
        return await self._request("POST", "/set-pattern", {"pattern": name})

    async def get_param_center(self) -> dict:
        return await self._request("GET", "/param-center")

    async def set_param(self, key: str, value: Any) -> dict:
        return await self._request("POST", "/param-center", {key: value})

    async def set_palette(self, slot: int, h: float, s: float, v: float) -> dict:
        """Set ``colorPalette<slot>`` (slot ∈ {1, 2}) on the engine.

        The Central Param Center clamps anything that isn't an HSV
        object (``{h, s, v}``) back to the registered default, so we
        always send the full triple. Floats are snapped into [0, 1]
        client-side to keep over-the-wire ``-0.0001`` tail noise from
        triggering the engine's clamp warnings in the log.
        """
        if slot not in (1, 2):
            raise ValueError("palette slot must be 1 or 2")

        def _clamp(x: float) -> float:
            try:
                f = float(x)
            except (TypeError, ValueError):
                return 0.0
            if f < 0.0:
                return 0.0
            if f > 1.0:
                return 1.0
            return f

        key = f"colorPalette{slot}"
        return await self._request(
            "POST", "/param-center",
            {key: {"h": _clamp(h), "s": _clamp(s), "v": _clamp(v)}},
        )

    async def set_control(self, control_id: int, v0: float,
                          v1: float = 0.0, v2: float = 0.0) -> dict:
        """Write a per-pattern WASM export by CRC32 control id.

        Mirrors what the engine's ``POST /control`` accepts. Used for
        local (per-pattern) parameter sliders surfaced in PortWatch's
        ParamsCard. We deliberately do NOT enforce a range here —
        the engine's WASM export tells the operator's UI what range to
        present, and over-the-wire clamping is the engine's job (it
        knows the export's metadata).
        """
        return await self._request(
            "POST", "/control",
            {
                "id": int(control_id),
                "v0": float(v0),
                "v1": float(v1),
                "v2": float(v2),
            },
        )

    async def list_playlists(self) -> list[str]:
        """Return the set of saved playlist names. Used by PortWatch's
        deck-playlist switcher. Empty list on engine unavailable so the
        bridge can surface that as ``rep`` ``c/`` instead of ``nak``.
        """
        try:
            doc = await self._request("GET", "/playlists")
        except EngineUnavailable:
            return []
        return doc if isinstance(doc, list) else []

    async def get_deck_playlist(self) -> Optional[dict]:
        """Return the deck base channel's currently-loaded playlist
        descriptor (``{name, activeEntryId, ...}``), or ``None`` if no
        playlist is assigned. The engine returns ``null`` for the
        no-playlist case; we pass that through transparently.
        """
        try:
            doc = await self._request("GET", "/deck/playlist")
        except EngineUnavailable:
            return None
        return doc if isinstance(doc, dict) else None

    async def set_deck_playlist(self, name: str) -> dict:
        """Load a playlist onto the deck's base channel. Triggers the
        engine to compile + activate the playlist's first usable
        entry, and broadcasts both ``mixer`` and ``pattern`` WS events
        so every UI re-syncs.
        """
        return await self._request(
            "POST", "/deck/playlist", {"name": str(name)},
        )

    async def get_playlist(self, name: str) -> Optional[dict]:
        """Return the full playlist document (entries + metadata) by
        name, or ``None`` if it doesn't exist / engine unreachable.
        """
        if not name:
            return None
        try:
            doc = await self._request(
                "GET", f"/playlists/{urllib.parse.quote(name, safe='')}",
            )
        except EngineUnavailable:
            return None
        return doc if isinstance(doc, dict) else None

    async def get_playlist_patterns_by_name(self, name: str) -> list[str]:
        """Return the ordered list of pattern names for an arbitrary
        playlist, regardless of whether the deck is currently loaded
        with it. Used by the bridge's `engine/get-playlist-patterns/
        <name>/p/<n>` op, which PortWatch's REFRESH-WORLD action fans
        out across every name in the library so all playlists' pattern
        lists end up in the persistent cache without flipping the deck
        as a side-effect of the refresh.

        Same `_missing` + dedupe semantics as `get_deck_playlist_
        patterns` so the two ops behave identically to the client.
        """
        if not name:
            return []
        pl = await self.get_playlist(name)
        if not isinstance(pl, dict):
            return []
        return _extract_playlist_pattern_names(pl)

    async def get_deck_playlist_patterns(self) -> tuple[Optional[str], list[str]]:
        """Resolve the deck's currently-loaded playlist and return the
        ordered list of pattern names from its entries.

        Used by PortWatch's pattern picker so refreshing the picker
        loads ONLY the patterns of the playlist the engine is actually
        playing through (not the whole engine catalog). Returns
        ``(playlist_name, patterns)`` so callers can decide what to do
        when there is no active playlist:

          - ``(None, [])``   → no playlist on the deck (or engine
            unreachable). PortWatch should fall back to the engine
            catalog so the operator isn't left with an empty picker.
          - ``("name", [])`` → playlist exists but has no usable
            entries; report explicitly so the picker can say so.

        Missing entries (``_missing == true``) are skipped — we never
        want to serve a name the engine can't actually compile.
        """
        deck = await self.get_deck_playlist()
        if not isinstance(deck, dict) or not deck.get("name"):
            return None, []
        name = str(deck.get("name") or "")
        if not name:
            return None, []
        pl = await self.get_playlist(name)
        if not isinstance(pl, dict):
            return name, []
        return name, _extract_playlist_pattern_names(pl)

    async def get_exports(self) -> list[dict]:
        """Return the WASM exports of the deck base channel as PortWatch
        should see them — fully filtered AND merged with live
        ``v0/v1/v2`` values.

        We deliberately read off ``/mixer`` (the base channel's exports
        array) instead of the legacy ``/exports`` endpoint. The reason
        is filter-set parity with CaptainPad:

          * ``/mixer``'s serialiser filters out
              - ``isSharedExport``  (CPC owns the underlying variable —
                e.g. ``sliderSpeed`` when CPC owns ``speed``)
              - ``getBlockedIds``   (CPC has explicitly blocked the
                control id at the API boundary)
              - any kind not in the local-control set (1/2/3/6)
            and overlays each export's live ``v0/v1/v2`` from
            ``channel.localControls``.
          * ``/exports`` is the legacy single-channel snapshot and
            ONLY applies the ``isSharedExport`` filter — blocked IDs
            slip through, and there are no live ``v0`` values.

        For PortWatch's ParamsCard "Local Params" strip we want
        EXACTLY the surface CaptainPad shows on the deck card so the
        operator never sees a duplicate slider (``sliderSpeed`` AND
        the CPC ``speed`` knob) on PortWatch that wouldn't appear on
        CaptainPad. Reading off ``/mixer`` gives us that for free.
        """
        try:
            mx = await self._request("GET", "/mixer")
        except EngineUnavailable:
            return []
        if not isinstance(mx, dict):
            return []
        base_id = mx.get("baseChannelId")
        for ch in mx.get("channels") or []:
            if not isinstance(ch, dict):
                continue
            # Some serializer paths return null for baseChannelId
            # (the channel itself is still tagged by id prefix); fall
            # back to the first ch_base_* channel in that case.
            is_base = (
                (base_id and ch.get("id") == base_id)
                or (
                    not base_id
                    and isinstance(ch.get("id"), str)
                    and (ch["id"] == "ch_base" or ch["id"].startswith("ch_base_"))
                )
            )
            if not is_base:
                continue
            exports = ch.get("exports") or []
            # Defensive copy — callers (bridge `_exec_qry`) walk this
            # list multiple times and we don't want to leak engine
            # state references.
            return [dict(e) for e in exports if isinstance(e, dict)]
        return []

    async def set_blackout(self, state: bool) -> dict:
        return await self._request("POST", "/global-blackout", {"state": bool(state)})

    async def set_autopilot(
        self,
        active: Optional[bool] = None,
        *,
        delay_s: Optional[int] = None,
        shuffle: Optional[bool] = None,
    ) -> dict:
        """POST a partial update to the engine's autopilot state.

        All three fields are optional; only the ones explicitly passed
        get included in the body. The engine merges them onto its
        current state — see ``Autopilot.updateState`` — and re-broadcasts
        the full ``autopilot`` WS payload so every UI mirrors the change
        without polling.
        """
        body: dict[str, Any] = {}
        if active is not None:
            body["active"] = bool(active)
        if delay_s is not None:
            body["delay_s"] = int(delay_s)
        if shuffle is not None:
            body["shuffle"] = bool(shuffle)
        return await self._request("POST", "/autopilot", body)

    async def get_autopilot(self) -> bool:
        """Returns the engine's current autopilot state, or ``False`` if
        the engine is unreachable or doesn't expose the field. Mirror of
        ``set_autopilot`` so callers don't have to dig through the raw
        ``/autopilot`` doc shape."""
        try:
            doc = await self._request("GET", "/autopilot")
        except EngineUnavailable:
            return False
        return bool(isinstance(doc, dict) and doc.get("active"))

    async def set_global_effect(self, effect: str, state: bool) -> dict:
        return await self._request(
            "POST", "/global-effect",
            {"effect": effect, "state": bool(state)},
        )

    async def set_view_override(self, override: Optional[str]) -> dict:
        """Pin the engine output to ``override`` ('deck'), or release
        the pin with ``override=None``. The engine remembers the
        pre-override target view so a clear restores whatever the user
        had before.
        """
        return await self._request(
            "POST", "/mixer/view-override",
            {"override": override},
        )

    async def get_mixer(self) -> dict:
        try:
            return await self._request("GET", "/mixer")
        except EngineUnavailable:
            return {}

    async def update_mixer_master(self, master: float) -> dict:
        return await self._request("PATCH", "/mixer", {"master": float(master)})

    async def update_mixer_channel(self, channel_id: str, updates: dict) -> dict:
        path = f"/mixer/channels/{urllib.parse.quote(channel_id)}"
        return await self._request("PATCH", path, updates)

    # ── Compact status (for `pub` broadcasts) ────────────────────────────
    async def compact_status(self) -> str:
        """Return a short ``key/value`` CSV for the periodic ``pub`` frame.

        Keys (≤ 80 bytes total expected):

        * ``pat``  active pattern name on the deck base channel.
        * ``pl``   active deck playlist name (or ``-`` when none).
        * ``vw``   active mixer view: ``deck`` / ``mixer``.
        * ``vov``  ``1`` if PortWatch / bridge has the deck-view
                   override pinned, ``0`` otherwise.
        * ``lk``   controlLock owner (``-`` when free).
        * ``lku``  controlLock lease remaining seconds (int, 0 if no lease).
        * ``br``   mixer master 0..100.
        * ``blk``  global blackout 0/1.
        * ``ap``   autopilot active 0/1.
        * ``apd``  autopilot delay seconds (int).
        * ``aps``  autopilot shuffle 0/1.
        * ``sp``   shared "speed" param if registered (0..1, compact float).
        * ``dr``   shared "direction" param if registered.
        * ``ct``   shared "count" param if registered.
        * ``sz``   shared "size" param if registered.
        * ``rt``   shared "rotate" param if registered.
        * ``p1``   shared ``colorPalette1`` HSV as ``<h>-<s>-<v>``.
        * ``p2``   shared ``colorPalette2`` HSV as ``<h>-<s>-<v>``.
        * ``dn``   ``1`` if engine is down (sole field in that case).

        Performance contract: every PUB MUST complete in well under
        one second on a healthy engine. We hit a fixed budget of
        TWO sequential HTTP fans:

          1. ``/status``  — single GET, used purely as the
             ``EngineDown`` probe.
          2. ``asyncio.gather`` of ``/mixer``, ``/param-center``,
             ``/globals``, ``/autopilot``, ``/mixer/view-override`` —
             everything else PortWatch needs for the snapshot.

        That replaces the previous 8-serial-GET fan-out (which also
        included ``/playlists`` and ``/playlists/<active>`` for the
        ``plh`` / ``pph`` hashes — those hashes were removed because
        PortWatch's pattern cache is now a dumb persisted-by-name
        store, not a hash-validated one). On a slow engine the
        bridge used to stall the publisher loop for several seconds
        per PUB, which is what surfaced to operators as "PortWatch
        keeps saying Waiting for engine state".

        Historical note: ``tch``, ``nch``, ``chs`` (target channel
        name, channel count, tilde-separated channel-name list) and
        ``plh``, ``pph`` (library + per-playlist pattern hashes)
        lived here historically. The target-channel concept was
        removed in May 2026 (see docs/16 + docs/21). The hash
        fields were removed shortly after — they tripled the
        per-PUB HTTP cost on the bridge and the persistent
        name-keyed cache is simpler and easier for operators to
        reason about.
        """
        out: dict[str, Any] = {}
        # Engine reachability gate: a single early /status call is
        # the cheapest "is the engine up?" probe. We do NOT use its
        # `activePattern` field for `pat` (see docstring above) — the
        # mixer base channel is the ground truth. Keeping the probe
        # gives us the EngineDown signal without an extra request.
        try:
            await self.status()
        except EngineUnavailable:
            out["dn"] = 1
            return encode_kv(out)

        # Fan out the remaining reads concurrently. Total wall-time
        # is bounded by the slowest single GET (~100 ms on a healthy
        # local engine), NOT the sum of five serial GETs. Each call
        # has its own timeout via `self.timeout_s`. Any single
        # EngineUnavailable yields an empty dict for that slice so
        # the rest of the PUB still goes out.
        async def _get(path: str) -> Any:
            try:
                return await self._request("GET", path)
            except EngineUnavailable:
                return {}

        mx, params, globals_, ap, vo = await asyncio.gather(
            _get("/mixer"),
            _get("/param-center"),
            _get("/globals"),
            _get("/autopilot"),
            _get("/mixer/view-override"),
        )

        # Master / brightness
        master = (mx or {}).get("master") if isinstance(mx, dict) else None
        if isinstance(master, (int, float)):
            out["br"] = int(round(master * 100))

        # ── Active pattern + active playlist name (both off /mixer) ──
        # The deck base channel is the authoritative source: every
        # CaptainPad write path that swaps a pattern updates
        # `ch.pattern`, but only a few of them update the legacy
        # `opts.pattern` used by GET /status. Reading off /mixer
        # means CaptainPad changes propagate to PortWatch via the
        # `mixer` WS event → publisher wake → next PUB without
        # touching every engine endpoint.
        base_id = (mx or {}).get("baseChannelId") if isinstance(mx, dict) else None
        base_ch: dict[str, Any] = {}
        channels = (mx or {}).get("channels") if isinstance(mx, dict) else None
        if isinstance(channels, list):
            for ch in channels:
                if not isinstance(ch, dict):
                    continue
                is_base = (
                    (base_id and ch.get("id") == base_id)
                    or (
                        not base_id
                        and isinstance(ch.get("id"), str)
                        and (ch["id"] == "ch_base" or ch["id"].startswith("ch_base_"))
                    )
                )
                if is_base:
                    base_ch = ch
                    break
        # ── `pat/<value>` is the wire-format invariant the PortWatch
        # status gate keys off (see App.tsx::onWireEvent — a REP only
        # counts as a status REP if its body contains `pat/` or `dn/`).
        # We MUST emit it on every compact_status, including when:
        #   * the engine is up so `dn/` is suppressed, AND
        #   * a base channel exists but has no pattern loaded yet
        #     (fresh engine boot, operator just unloaded everything).
        # Without this invariant the qry-engine-status REP slides past
        # the predicate, setEngineStatus is never called, and PortWatch
        # gets stuck on "Waiting for engine state…" until a PUB happens
        # to land at a moment when a pattern IS loaded — which on a
        # cold rig can be never. PortWatch's parseEngineStatus maps
        # both `-` and `?` back to activePattern=null so the DeckScreen
        # renders its existing em-dash placeholder either way.
        if base_ch:
            pat_name = base_ch.get("pattern")
            if isinstance(pat_name, str) and pat_name:
                out["pat"] = pat_name
            else:
                out["pat"] = "-"
        else:
            out["pat"] = "?"

        # Active deck playlist name (off the same base channel).
        pl_name = None
        if base_ch:
            pl = base_ch.get("playlist") if isinstance(base_ch.get("playlist"), dict) else None
            if pl and isinstance(pl.get("name"), str) and pl.get("name"):
                pl_name = pl.get("name")
        if pl_name:
            # Sanitize for the CSV wire format: no commas / slashes /
            # newlines (parseKv treats both as separators).
            safe = "".join(c for c in pl_name if c not in (",", "/", "\n", "\r"))
            out["pl"] = safe[:24] if safe else "-"
        else:
            out["pl"] = "-"

        # Globals (blackout)
        if isinstance(globals_, dict):
            # The engine's /globals GET returns the field as `blackout`,
            # but the /global-blackout POST response uses
            # `blackoutActive`. Accept either so the bridge doesn't
            # silently drop the blackout PUB on engine-side flips.
            blk = globals_.get("blackout")
            if blk is None:
                blk = globals_.get("blackoutActive")
            if blk is not None:
                out["blk"] = 1 if blk else 0

        # Autopilot
        if isinstance(ap, dict):
            if "active" in ap:
                out["ap"] = 1 if ap["active"] else 0
            d_raw = ap.get("delay_s")
            if d_raw is not None:
                try:
                    out["apd"] = max(1, int(float(d_raw)))
                except (TypeError, ValueError):
                    pass
            if "shuffle" in ap:
                out["aps"] = 1 if ap["shuffle"] else 0

        # CPC globals. Each shared param ships in the same short-key
        # form `qry params/snapshot` uses (sp/dr/ct/sz/rt/p1/p2) so
        # PortWatch can share its parser between the polling path and
        # the PUB-lift path. CaptainPad CPC nudges propagate over the
        # next PUB instead of waiting for the 5 s params poll. Values
        # are omitted (not nulled) when the engine doesn't have them
        # registered — keeps "older engine" distinguishable from
        # "value is genuinely 0" on the parser side.
        for short_key, full_key in (
            ("sp", "speed"),
            ("dr", "direction"),
            ("ct", "count"),
            ("sz", "size"),
            ("rt", "rotate"),
        ):
            val = _extract_param(params, full_key)
            if val is not None:
                try:
                    out[short_key] = _compact_float(float(val))
                except (TypeError, ValueError):
                    pass
        for short_key, full_key in (
            ("p1", "colorPalette1"),
            ("p2", "colorPalette2"),
        ):
            val = _extract_param(params, full_key)
            if isinstance(val, dict):
                try:
                    h = float(val.get("h", 0.0))
                    s = float(val.get("s", 0.0))
                    v = float(val.get("v", 0.0))
                except (TypeError, ValueError):
                    continue
                out[short_key] = (
                    f"{_compact_float(h)}-{_compact_float(s)}-{_compact_float(v)}"
                )

        # Mixer view + view-override state.
        #
        # Wire-size budget note. The Heltec firmware has a 250-char
        # hard limit per BLE notification (titanic_ble.h) and the
        # BLE MTU we request is 247. After AES-GCM seal + base64 +
        # the v2 header/tag, each plaintext char costs ~1.34 wire
        # chars; the practical plaintext budget is ~138 chars to
        # fit in a single notification. compact_status was hitting
        # 142 chars (incl. `lk/-,lku/0,vov/0` defaults), pushing
        # the wire frame to 254 chars and silently dropping every
        # poll REP at the firmware buffer.
        #
        # Mitigation here: omit `lk` and `lku` when no controlLock
        # is held, and `vov` when no override is active. These are
        # the explicit "nothing-locked" sentinels — PortWatch's
        # parser already maps missing → null/false on the receive
        # side, so the wire shape stays backwards-compatible while
        # saving 16 chars in the common case. `vw` (engine view)
        # remains unconditional because it carries genuine state
        # for the deck/mixer toggle.
        if isinstance(vo, dict):
            cv = vo.get("currentView")
            if cv in ("deck", "mixer"):
                out["vw"] = cv
            ov = vo.get("override")
            if ov == "deck":
                out["vov"] = 1
            cl = vo.get("controlLock")
            if isinstance(cl, str) and cl:
                # Short owner codes shave 7 chars off the common
                # `lk/portwatch` payload — keeps lock-active state
                # under the 138-char plaintext budget.
                # parseEngineStatus maps these back to the long
                # canonical names that the UI compares against, so
                # existing `controlLockOwner === "portwatch"`
                # checks continue to work unchanged.
                out["lk"] = "pw" if cl == "portwatch" else cl
            lr = vo.get("controlLockLeaseRemainingMs")
            if isinstance(lr, (int, float)) and lr > 0:
                # Round UP so a non-zero remaining never decays to 0
                # on the wire while the lease is still live.
                out["lku"] = int((float(lr) + 999.0) / 1000.0)

        return encode_kv(out)


def _extract_playlist_pattern_names(pl: dict) -> list[str]:
    """Shared extraction of pattern-name list from a `GET /playlists/<name>`
    response document. Applied to BOTH the deck-loaded playlist path and
    the arbitrary-name path so the bridge's two playlist-patterns ops
    behave identically on the wire:

      * Skips entries flagged `_missing` (engine knows the entry id but
        not the pattern code; serving it would let PortWatch send a
        name the engine couldn't compile).
      * Skips entries whose `pattern` field isn't a non-empty string.
      * Dedupes — the engine permits the same pattern to appear
        multiple times in a playlist (intentional cue repeats), but
        PortWatch's picker shows each name once and selecting it
        loads the engine's notion of "the entry for this pattern in
        this playlist" regardless of which row was tapped.

    Returns a fresh list (no aliasing of the engine response).
    """
    entries = pl.get("entries") if isinstance(pl.get("entries"), list) else []
    seen: set[str] = set()
    out: list[str] = []
    for e in entries:
        if not isinstance(e, dict):
            continue
        if e.get("_missing"):
            continue
        pat = e.get("pattern")
        if not isinstance(pat, str) or not pat:
            continue
        if pat in seen:
            continue
        seen.add(pat)
        out.append(pat)
    return out


def _extract_param(params_doc: Any, key: str) -> Any:
    """Pull a single value out of /param-center's response shape."""
    if not isinstance(params_doc, dict):
        return None
    p = params_doc.get("params")
    if isinstance(p, dict) and key in p and isinstance(p[key], dict):
        return p[key].get("value")
    # Older / simpler shape: { speed: 0.5, ... }
    if key in params_doc:
        return params_doc[key]
    return None


def _compact_float(v: float) -> str:
    """Compact float formatter for compact_status wire values.

    Strips trailing zeros and the trailing dot so 0.5 → "0.5", 1.0 →
    "1", 0.123456 → "0.123". Mirrors ``bridge._short_float`` so the
    PortWatch parser sees byte-identical formatting from both the
    polled snapshot and the PUB compact-status payload — otherwise a
    PUB-driven refresh would silently undo precision the poller had
    just stored, churning the reconciler.
    """
    if not isinstance(v, (int, float)):
        return "0"
    fixed = f"{float(v):.3f}"
    if "." in fixed:
        fixed = fixed.rstrip("0").rstrip(".")
    if fixed in ("", "-0"):
        fixed = "0"
    return fixed


def _probe_status(url: str, timeout_s: float) -> bool:
    """Synchronous reachability probe for EngineClient.discover().

    Pure-stdlib so the discover() path doesn't pull in extra deps. Runs
    inside the asyncio default executor; never raises — returns True
    iff the engine answered 200 within the timeout.
    """
    req = urllib.request.Request(
        f"{url.rstrip('/')}/status",
        headers={"Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        return False
    except Exception:  # pragma: no cover — defensive: never let probe crash startup
        return False
