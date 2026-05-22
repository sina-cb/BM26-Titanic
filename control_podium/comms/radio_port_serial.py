"""
radio_port_serial.py — RadioPort adapter for a real Heltec firmware over USB.

This is the production transport. The firmware's serial protocol is unchanged
from v1:

* Host → firmware:  ``<text>\\n``                          → firmware TX over LoRa
* Firmware → host:  ``TX_OK\\n`` / ``TX_FAIL:<code>\\n``
* Firmware → host:  ``RX:<payload>:RSSI=<r>:SNR=<s>\\n``    → received over LoRa

The adapter:

* Wraps ``serial.Serial`` in non-blocking ``loop.run_in_executor`` calls.
* Emits exactly the on-air ``Frame.encode()`` line as the payload, so the
  firmware (which knows nothing about framing) transmits it verbatim.
* Parses incoming RX lines using ``utils.serial_parser`` (which now handles
  payloads containing arbitrary characters except the literal ``:RSSI=`` suffix).

We do not import this in tests by default — it requires ``pyserial`` and a
physical port. Imports are guarded so the module is loadable without
``pyserial`` installed; ``open()`` is the only thing that needs it.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from typing import AsyncIterator, Callable, Optional

from .frame import Frame, FrameError
from .radio_port import RadioPort

logger = logging.getLogger("titanic.radio_serial")


class _LinkStats:
    """Rolling RX/TX statistics for the LoRa link.

    Exposed via :pyattr:`RadioPortSerial.link_stats` so the bridge
    health endpoint can serve them to PortWatch as the canonical
    "what is the bridge SEEING from this radio" view. PortWatch's
    BLE-side LoRa stats (read off the captain's firmware) describe
    the OTHER end of the link — the bridge-side stats here are the
    only honest answer to "is the server controller actually
    receiving captain frames?".

    Why a separate class vs. extra fields on the RadioPort: keeps
    the stats lifecycle owned by ONE object that survives
    serial-port reconnects (RadioPortSerial drops its handle on
    USB drops, but we still want the rx/tx counts to be continuous
    across the reopen).
    """

    # Cap the recent-RSSI/SNR ring at 64 — enough to compute a
    # 30 s rolling average at the bridge's 5 s active-PUB cadence
    # plus headroom for poll bursts, small enough that the bridge
    # health endpoint stays cheap to render.
    _RING_CAP = 64

    def __init__(self) -> None:
        self.rx_count = 0
        self.tx_count = 0
        self.tx_drop_count = 0          # frames dropped because port was reopening
        self.parse_error_count = 0      # RX lines that failed AEAD decode
        self.last_rx_ms: Optional[float] = None
        self.last_tx_ms: Optional[float] = None
        self.last_rssi_dbm: Optional[float] = None
        self.last_snr_db: Optional[float] = None
        self._rssi_ring: deque[float] = deque(maxlen=self._RING_CAP)
        self._snr_ring: deque[float] = deque(maxlen=self._RING_CAP)

    def note_rx(self, rssi_str: str, snr_str: str) -> None:
        """Record a successful RX line. Both rssi/snr are passed
        as strings (straight off the firmware serial output) and
        parsed defensively — a malformed value just doesn't get
        ringed, but the rx_count still increments so the ratio
        of decoded-vs-totally-broken frames is visible."""
        self.rx_count += 1
        self.last_rx_ms = time.monotonic() * 1000.0
        try:
            self.last_rssi_dbm = float(rssi_str)
            self._rssi_ring.append(self.last_rssi_dbm)
        except (TypeError, ValueError):
            pass
        try:
            self.last_snr_db = float(snr_str)
            self._snr_ring.append(self.last_snr_db)
        except (TypeError, ValueError):
            pass

    def note_tx(self) -> None:
        self.tx_count += 1
        self.last_tx_ms = time.monotonic() * 1000.0

    def note_tx_drop(self) -> None:
        self.tx_drop_count += 1

    def note_parse_error(self) -> None:
        self.parse_error_count += 1

    @staticmethod
    def _mean(ring: deque[float]) -> Optional[float]:
        return (sum(ring) / len(ring)) if ring else None

    def snapshot(self) -> dict:
        """Return a JSON-safe dict. Called from the bridge's
        ``/health`` endpoint — must NOT include any frame payloads
        or other potentially-secret content (RSSI/SNR/counters are
        operational metrics only, per the logging-security rule)."""
        now_ms = time.monotonic() * 1000.0
        return {
            "rx_count": self.rx_count,
            "tx_count": self.tx_count,
            "tx_drop_count": self.tx_drop_count,
            "parse_error_count": self.parse_error_count,
            "last_rx_ms_ago": (
                int(now_ms - self.last_rx_ms)
                if self.last_rx_ms is not None else None
            ),
            "last_tx_ms_ago": (
                int(now_ms - self.last_tx_ms)
                if self.last_tx_ms is not None else None
            ),
            "last_rssi_dbm": self.last_rssi_dbm,
            "last_snr_db": self.last_snr_db,
            "rssi_avg_dbm": self._mean(self._rssi_ring),
            "snr_avg_db": self._mean(self._snr_ring),
            "rssi_sample_count": len(self._rssi_ring),
        }


class RadioPortSerial(RadioPort):
    """Talks to a real Heltec firmware over USB-CDC serial.

    If ``codec`` is provided, every outbound frame is AEAD-encoded and
    every inbound RX line is parse + tag-verified before being yielded;
    pass a ``ReplayWindow`` too to enable per-source replay defense.
    The firmware itself stays a dumb byte-relay; all crypto lives here.
    """

    # See RadioPortSim for the sentinel rationale.
    _AUTO = object()

    def __init__(self, port: str, baud: int = 115200, name: str = "?",
                 codec=_AUTO, replay=_AUTO,
                 pre_send_delay_s: float = 0.0,
                 reconnect_backoff_initial_s: float = 1.0,
                 reconnect_backoff_max_s: float = 30.0,
                 cfg_applied_callback: Optional[Callable[[str], None]] = None):
        """``pre_send_delay_s`` is a deliberate stall before each TX,
        kept around as an escape hatch.

        Originally we needed ~150 ms here because the firmware's
        ``transmitMessage()`` did ``heltec_led(50); delay(30); heltec_led(0);``
        right before ``radio.startReceive()`` — the receiver was still
        re-arming when the peer's reply came in, so unicast replies were
        being missed. Firmware now uses a non-blocking LED scheduler
        (``titanicLedFlash`` in ``titanic_common.h``), so the receiver
        re-arms immediately and the host doesn't need to stall.

        Bump this back up if a future firmware re-introduces blocking
        in the radio path; the host adapter tolerates any non-negative
        value with a cooperative ``asyncio.sleep`` so other tasks keep
        running while we wait."""
        self.port = port
        self.baud = baud
        self.name = name
        self.pre_send_delay_s = pre_send_delay_s
        if codec is RadioPortSerial._AUTO:
            from .secure import default_codec
            codec = default_codec()
        self.codec = codec
        if replay is RadioPortSerial._AUTO:
            from .replay import ReplayWindow
            replay = ReplayWindow() if codec is not None else None
        self.replay = replay
        self._reconnect_backoff_initial_s = reconnect_backoff_initial_s
        self._reconnect_backoff_max_s = reconnect_backoff_max_s
        # Optional hook fired when the firmware reports a successful
        # profile-switch on its end (`CFG_APPLIED name=<x>` line).
        # Bridge uses this to keep its in-memory `_lora_profile_current`
        # in sync regardless of WHO originated the switch — the bridge
        # via /profile, a captain via BLE, or even a manual USB push.
        # Without this hook, captain-originated switches left the bridge
        # advertising the wrong profile in PUBs (`prof/<name>`).
        self._cfg_applied_callback = cfg_applied_callback
        self._ser = None
        self._open = False
        self._send_lock = asyncio.Lock()
        # Rolling RX/TX stats — survives serial reconnects. Owned
        # here (not the Bridge) so the same object can be queried
        # whether or not a high-level Bridge instance has been
        # constructed yet, and so the counters are continuous
        # across mid-run port drops.
        self.link_stats = _LinkStats()

    async def open(self) -> None:
        """Open the USB serial port. Raises on first-time failure so
        the operator sees a clear error at boot (e.g. wrong device,
        permissions). Once open, transient drops mid-run are handled
        by ``recv_frames`` which transparently re-opens.
        """
        await self._open_once()
        self._open = True

    async def _open_once(self) -> None:
        # Imported lazily so the module is usable on machines without pyserial.
        import serial  # noqa: WPS433
        loop = asyncio.get_running_loop()
        self._ser = await loop.run_in_executor(
            None,
            lambda: serial.Serial(self.port, self.baud, timeout=0.1),
        )
        logger.info("opened %s @ %d (as %s)", self.port, self.baud, self.name)

    async def close(self) -> None:
        """Idempotent + crash-safe close.

        On a USB-unplug the underlying fd is already gone, and
        ``pyserial.Serial.close()`` raises ``OSError(9, 'Bad file
        descriptor')`` when it tries to call ``os.close`` on it.
        That used to fall through to ``asyncio`` and surface as a
        scary "Task exception was never retrieved" traceback on
        every clean shutdown. Swallow it — close() is "best-effort
        release" by contract.
        """
        self._open = False
        ser, self._ser = self._ser, None
        if ser is None:
            return
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(None, ser.close)
        except OSError as exc:
            logger.debug("serial close ignored (%s)", exc)

    async def send_raw_line(self, line: str) -> bool:
        """Write a plaintext line to the USB serial bus, bypassing the
        codec / replay window.

        Used by the profile-switch side channel (titanic_profiles.h): a
        ``*CFG name=… t=…`` line that the firmware intercepts before
        the normal LoRa TX path. We deliberately skip the v2 frame
        codec so the line shows up to the controller exactly as the
        bridge wrote it — no AEAD wrapping, no replay nonce, no flags
        byte. The wire-prefix gate in titanic_profiles.h
        (``*CFG``) makes the collision-free split safe vs real frames
        (which always start with ``T2|``).

        Returns ``True`` on a successful flush, ``False`` if the port
        is reopening or the write failed mid-flight (same best-effort
        drop semantics as :meth:`send`).
        """
        if not self._open:
            raise ConnectionError("serial port is closed")
        ser = self._ser
        if ser is None:
            logger.debug("drop raw line during reopen: %r", line[:64])
            self.link_stats.note_tx_drop()
            return False
        if not line.endswith("\n"):
            line = line + "\n"
        payload = line.encode("utf-8", errors="replace")
        async with self._send_lock:
            if self.pre_send_delay_s > 0:
                await asyncio.sleep(self.pre_send_delay_s)
            loop = asyncio.get_running_loop()
            try:
                await loop.run_in_executor(None, ser.write, payload)
                await loop.run_in_executor(None, ser.flush)
                # Count as a TX so /health reflects the activity even
                # though this isn't a real Titanic frame.
                self.link_stats.note_tx()
                return True
            except Exception as exc:
                if self._ser is ser:
                    self._ser = None
                    logger.info(
                        "serial write %s lost during raw line "
                        "(%s); dropping, RX loop will reopen",
                        self.port, exc,
                    )
                return False

    async def send(self, frame: Frame) -> None:
        """Best-effort frame write.

        Drop semantics
        --------------
        If the port is currently reopening (USB just unplugged, or
        we're between the read-error and a successful reopen),
        ``self._ser`` is ``None`` but ``self._open`` is still True.
        We drop the outbound frame silently in that window rather
        than raising — the LoRa radio is best-effort anyway, the
        client's poll loop will reconcile within seconds, and most
        importantly the bridge's ``Bridge.run()`` task must NOT die
        just because the operator wiggled a USB cable. Same drop
        semantics for a fresh write error: detach the handle so the
        RX loop's reopen path takes over, count it in the stats
        (caller via the Bridge), and return normally so the request
        handler keeps running.

        Only path that raises is a hard close (``self._open`` is
        False), which means the operator (or supervisor shutdown)
        has explicitly torn the radio down — callers SHOULD bail
        in that case.
        """
        if not self._open:
            raise ConnectionError("serial port is closed")
        ser = self._ser
        if ser is None:
            # Reopen in progress. Drop the frame silently — see
            # docstring. One DEBUG line so a verbose log still shows
            # the loss if someone is digging.
            logger.debug(
                "drop tx during reopen: typ=%s seq=0x%02x dst=0x%02x",
                frame.typ, frame.seq, frame.dst,
            )
            self.link_stats.note_tx_drop()
            return
        line = (self._encode_outbound(frame) + "\n").encode("utf-8")
        async with self._send_lock:
            if self.pre_send_delay_s > 0:
                await asyncio.sleep(self.pre_send_delay_s)
            loop = asyncio.get_running_loop()
            try:
                await loop.run_in_executor(None, ser.write, line)
                await loop.run_in_executor(None, ser.flush)
                self.link_stats.note_tx()
            except Exception as exc:
                # USB drop mid-write. Detach the dead handle so the
                # RX-side reopen path picks it up; return without
                # raising so the bridge stays alive. Log at INFO so
                # the first occurrence is visible — subsequent drops
                # within a reopen window go through the `self._ser is
                # None` branch above at DEBUG level.
                if self._ser is ser:
                    self._ser = None
                    logger.info(
                        "serial write %s lost (%s); dropping frame, "
                        "RX loop will reopen", self.port, exc,
                    )

    async def recv_frames(self) -> AsyncIterator[Frame]:
        """Yield decoded frames forever, transparently reopening the
        USB serial port when it drops mid-run.

        Reopen semantics
        ----------------
        The Heltec is on USB-CDC, which the kernel rebuilds whenever
        the device replugs or briefly browns out. ``pyserial`` exposes
        that as ``readline()`` raising ``OSError(6, 'Device not
        configured')`` (macOS) or ``OSError(9, 'Bad file descriptor')``
        after the fd is invalidated, plus ``serial.SerialException``
        wrapped variants. On any of those, we:

          * close the dead handle (best-effort),
          * sleep with exponential backoff (1 s → 30 s cap),
          * try ``serial.Serial(port, baud)`` again,
          * resume yielding once it reopens.

        This is what makes the bridge survive a USB replug or a
        Heltec brown-out without operator intervention — the original
        symptom on the Pi was the bridge process exiting on
        ``Errno 6`` and never coming back until restart. The
        server_bridge.runner supervisor will additionally restart us
        if the open itself fails for a prolonged period.

        Termination
        -----------
        Stops only when ``close()`` flips ``_open`` to False (clean
        shutdown signal). ``asyncio.CancelledError`` is re-raised so
        the supervising task can wind down cleanly.
        """
        try:
            from control_podium.utils.serial_parser import parse_rx_line  # noqa: WPS433
        except ImportError:
            from utils.serial_parser import parse_rx_line  # noqa: WPS433

        loop = asyncio.get_running_loop()
        backoff = self._reconnect_backoff_initial_s
        # `serial.SerialException` is a subclass of OSError on most
        # platforms, but we catch it broadly to be safe across pyserial
        # versions and Python releases.
        while self._open:
            ser = self._ser
            if ser is None:
                # Reconnect path. Loop until open or external close().
                try:
                    await self._open_once()
                    backoff = self._reconnect_backoff_initial_s
                    logger.info(
                        "serial port %s recovered after drop", self.port,
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.warning(
                        "serial reopen %s failed (%s); retrying in %.1fs",
                        self.port, exc, backoff,
                    )
                    try:
                        await asyncio.sleep(backoff)
                    except asyncio.CancelledError:
                        raise
                    backoff = min(self._reconnect_backoff_max_s, backoff * 2)
                continue

            try:
                raw = await loop.run_in_executor(None, ser.readline)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                # USB drop, fd invalidated, or any other read failure.
                # Close the dead handle and let the next loop tick
                # walk the reconnect branch above. We log INFO (not
                # error) because this is an EXPECTED transient on a
                # device that an operator can physically unplug.
                logger.info(
                    "serial read %s lost (%s); will reopen", self.port, exc,
                )
                try:
                    await loop.run_in_executor(None, ser.close)
                except Exception:
                    pass
                if self._ser is ser:
                    self._ser = None
                continue

            if not raw:
                # Idle. Yield control so other tasks run.
                await asyncio.sleep(0)
                continue
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            # Out-of-band control: firmware confirmation that a
            # `*CFG name=<x>` was actually applied. Fires for every
            # apply path on the firmware side (USB host, LoRa peer,
            # or BLE-originated). The bridge subscribes to update its
            # `_lora_profile_current` so the next PUB carries the
            # correct `prof/<name>` field, regardless of who initiated
            # the change. Parse before the RX-line fallthrough so it
            # doesn't get logged as "non-RX line: ...".
            if line.startswith("CFG_APPLIED "):
                if self._cfg_applied_callback is not None:
                    try:
                        # Format: `CFG_APPLIED name=<name>`
                        kv = line[len("CFG_APPLIED "):].strip()
                        if kv.startswith("name="):
                            name = kv[len("name="):].strip()
                            if name:
                                self._cfg_applied_callback(name)
                    except Exception as exc:  # noqa: BLE001 — defensive
                        logger.warning(
                            "cfg_applied_callback failed: %s (line=%r)",
                            exc, line,
                        )
                continue

            rx = parse_rx_line(line)
            if rx is None:
                logger.debug("non-RX line: %s", line)
                continue
            # Record link stats BEFORE attempting to decode — even
            # an AEAD-failing frame is evidence the radio heard
            # something, and the bridge health endpoint's "are we
            # being jammed by garbage?" question is answered by
            # parse_error_count vs rx_count.
            self.link_stats.note_rx(rx.rssi, rx.snr)
            frame = self._decode_inbound(rx.payload)
            if frame is None:
                self.link_stats.note_parse_error()
                continue
            yield frame
