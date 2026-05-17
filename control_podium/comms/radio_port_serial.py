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
from typing import AsyncIterator, Optional

from .frame import Frame, FrameError
from .radio_port import RadioPort

logger = logging.getLogger("titanic.radio_serial")


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
                 pre_send_delay_s: float = 0.0):
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
        self._ser = None
        self._open = False
        self._send_lock = asyncio.Lock()

    async def open(self) -> None:
        # Imported lazily so the module is usable on machines without pyserial.
        import serial  # noqa: WPS433
        loop = asyncio.get_running_loop()
        self._ser = await loop.run_in_executor(
            None,
            lambda: serial.Serial(self.port, self.baud, timeout=0.1),
        )
        self._open = True
        logger.info("opened %s @ %d (as %s)", self.port, self.baud, self.name)

    async def close(self) -> None:
        self._open = False
        if self._ser is not None:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, self._ser.close)
            self._ser = None

    async def send(self, frame: Frame) -> None:
        if self._ser is None:
            raise ConnectionError("serial port is closed")
        line = (self._encode_outbound(frame) + "\n").encode("utf-8")
        async with self._send_lock:
            # Half-duplex settle: see __init__ docstring. Cooperative
            # sleep so other asyncio tasks keep moving.
            if self.pre_send_delay_s > 0:
                await asyncio.sleep(self.pre_send_delay_s)
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, self._ser.write, line)
            await loop.run_in_executor(None, self._ser.flush)

    async def recv_frames(self) -> AsyncIterator[Frame]:
        # Imported lazily to match open(). Try the package-qualified path
        # first (when used as ``control_podium.comms.radio_port_serial``)
        # then fall back to the bare path (when companions add
        # ``control_podium`` to sys.path and import as ``comms.*``).
        try:
            from control_podium.utils.serial_parser import parse_rx_line  # noqa: WPS433
        except ImportError:
            from utils.serial_parser import parse_rx_line  # noqa: WPS433

        loop = asyncio.get_running_loop()
        while self._open and self._ser is not None:
            raw = await loop.run_in_executor(None, self._ser.readline)
            if not raw:
                # Idle. Yield control so other tasks run.
                await asyncio.sleep(0)
                continue
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            rx = parse_rx_line(line)
            if rx is None:
                # Could be TX_OK / TX_FAIL / BLE: / firmware boot — not a
                # frame. The bridge surfaces these via a separate event hook
                # if needed; for now we just log at debug.
                logger.debug("non-RX line: %s", line)
                continue
            frame = self._decode_inbound(rx.payload)
            if frame is None:
                # Bad parse / bad tag / replay — silent drop per §3.6.7.
                # Counters are bumped on the port instance.
                continue
            yield frame
