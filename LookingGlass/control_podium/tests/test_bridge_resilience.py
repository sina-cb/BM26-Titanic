"""Resilience-focused unit tests for the Pi-deployed bridge.

These tests pin down the behaviours that make the bridge safe to
run unattended on a Raspberry Pi for days at a time:

  * :class:`_LogThrottle` collapses identical failures so a 30 s
    engine outage doesn't fill the log with one line per client
    poll — but still surfaces the first failure immediately and
    emits an explicit "recovered" line when things come back.
  * :class:`RadioPortSerial` transparently reopens its USB-CDC port
    when a `readline()` raises (USB unplug, fd invalidation), so a
    cable wiggle no longer kills the bridge process.
  * The runner's serial-port resolver refuses to attach as the
    bridge unless the configured node's role is ``server``.

We intentionally avoid spinning up the full Bridge/sim-bus stack
here — these tests target the resilience primitives directly so a
regression surfaces with a short, focused failure message.
"""
from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path
from textwrap import dedent

import pytest

BASE = Path(__file__).resolve().parent.parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from comms.bridge import _LogThrottle  # noqa: E402


# ── _LogThrottle ─────────────────────────────────────────────────────


def test_log_throttle_first_event_logs_immediately(caplog):
    th = _LogThrottle(period_s=30.0)
    with caplog.at_level(logging.INFO, logger="t"):
        th.log(logging.getLogger("t"), "k", "engine down: %s", "boom")
    assert "engine down: boom" in caplog.text


def test_log_throttle_collapses_repeats_inside_window(caplog):
    """Repeated events with the same key inside `period_s` must not
    emit additional INFO lines — otherwise a stuck engine still fills
    the log at the client-poll cadence."""
    th = _LogThrottle(period_s=30.0)
    lg = logging.getLogger("t2")
    with caplog.at_level(logging.INFO, logger="t2"):
        for _ in range(10):
            th.log(lg, "k", "engine down")
    info_lines = [r for r in caplog.records if r.levelno == logging.INFO]
    assert len(info_lines) == 1, (
        "expected the first failure to log at INFO and the next 9 "
        f"to be suppressed; got {len(info_lines)} INFO lines"
    )


def test_log_throttle_emits_summary_after_window(monkeypatch, caplog):
    """After `period_s`, the next event re-emits at INFO with a count
    of the suppressed events. That's the "still down" heartbeat the
    operator needs to know the failure is ongoing."""
    th = _LogThrottle(period_s=30.0)
    lg = logging.getLogger("t3")
    fake_now = [1000.0]

    def now():
        return fake_now[0]

    monkeypatch.setattr("comms.bridge.time.monotonic", now)
    with caplog.at_level(logging.INFO, logger="t3"):
        th.log(lg, "k", "down")            # logs INFO
        for _ in range(5):
            th.log(lg, "k", "down")        # suppressed
        fake_now[0] += 35.0                # past period_s
        th.log(lg, "k", "down")            # logs INFO with +N summary
    info_msgs = [r.getMessage() for r in caplog.records if r.levelno == logging.INFO]
    assert len(info_msgs) == 2, info_msgs
    assert "5 similar suppressed" in info_msgs[1], info_msgs[1]


def test_log_throttle_clear_emits_recovered_only_if_previously_failed(caplog):
    """`clear()` is meant for the success path. It must not log when
    the key was never thrown — otherwise every healthy request emits
    a spammy "recovered" line."""
    th = _LogThrottle(period_s=30.0)
    lg = logging.getLogger("t4")
    with caplog.at_level(logging.INFO, logger="t4"):
        # Never failed → clear() is a no-op.
        th.clear(lg, "k", "ALL GOOD")
        # Now fail, then clear() → should log recovery.
        th.log(lg, "k", "down")
        caplog.clear()
        th.clear(lg, "k", "ALL GOOD")
    assert "ALL GOOD" in caplog.text


# ── RadioPortSerial reconnect ────────────────────────────────────────


class _FakeSerial:
    """Minimal pyserial.Serial double for the reconnect loop test.

    Drives `readline()` through a scripted sequence so we can simulate
    a USB drop mid-stream and confirm the port re-opens transparently.
    """

    def __init__(self, script):
        # `script` is a list of items that readline() yields in order.
        # bytes → returned to caller; Exception → raised once;
        # then we cycle to the next entry.
        self._script = list(script)
        self.closed = False

    def readline(self):
        if not self._script:
            return b""
        item = self._script.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    def write(self, b):
        return len(b)

    def flush(self):
        pass

    def close(self):
        self.closed = True


def _install_fake_serial(monkeypatch, sequence):
    """Make every `serial.Serial(...)` constructor pull the next
    `_FakeSerial` from `sequence` (a list). Mirrors how the
    reconnect loop instantiates a fresh handle on each reopen."""
    import importlib
    serial_mod = importlib.import_module("serial")
    queue = list(sequence)

    def factory(*a, **kw):
        if not queue:
            raise OSError(2, "No such file or directory")
        s = queue.pop(0)
        if isinstance(s, BaseException):
            raise s
        return s

    monkeypatch.setattr(serial_mod, "Serial", factory)


@pytest.mark.asyncio
async def test_radio_port_serial_reopens_after_read_error(monkeypatch):
    """USB drop → readline raises OSError → port reopens → frames
    continue flowing. This is the regression the operator reported on
    the Pi: `Errno 6 Device not configured` exited the bridge.
    """
    from comms.radio_port_serial import RadioPortSerial
    # First handle: drops mid-stream. Second handle: healthy and emits
    # a TX_OK line (which parse_rx_line returns None for, so we just
    # exercise the read-loop path; we don't need a real frame).
    first = _FakeSerial(script=[b"", OSError(6, "Device not configured")])
    second = _FakeSerial(script=[b"TX_OK\n", b""])
    _install_fake_serial(monkeypatch, [first, second])

    radio = RadioPortSerial(
        port="/dev/cu.fake",
        baud=115200,
        name="test",
        codec=None,
        replay=None,
        reconnect_backoff_initial_s=0.001,
        reconnect_backoff_max_s=0.01,
    )
    await radio.open()

    received = []

    async def consume():
        async for frame in radio.recv_frames():
            received.append(frame)

    task = asyncio.create_task(consume())
    # Give the reopen loop a few ticks. We don't assert on `received`
    # (the script doesn't produce a real frame); we assert on the
    # internal handle swap, which is the actual recovery contract.
    await asyncio.sleep(0.2)
    await radio.close()
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):
        pass

    assert first.closed, "first (dropped) handle should be closed by the reopen loop"
    # The second handle was the one in use when we shut down.
    # `close()` swallows OSError(9) so we don't strictly require
    # second.closed to be True; what matters is the reopen happened.


@pytest.mark.asyncio
async def test_radio_port_serial_close_swallows_bad_fd(monkeypatch):
    """Closing an already-broken fd raises OSError(9) on macOS. The
    adapter must swallow that — otherwise every clean Ctrl+C
    shutdown emits a "Task exception was never retrieved" traceback,
    which masks real errors in the log."""
    from comms.radio_port_serial import RadioPortSerial

    class _BadFdSerial(_FakeSerial):
        def close(self):
            raise OSError(9, "Bad file descriptor")

    _install_fake_serial(monkeypatch, [_BadFdSerial(script=[b""])])
    radio = RadioPortSerial(port="/dev/cu.fake", codec=None, replay=None)
    await radio.open()
    # Must not raise.
    await radio.close()
    assert radio._ser is None


# ── runner serial-port resolver: role gating ─────────────────────────


def _write_nodes_yaml(tmp_path: Path, body: str) -> Path:
    p = tmp_path / ".config.nodes.yaml"
    p.write_text(dedent(body).strip(), encoding="utf-8")
    return p


def test_resolver_refuses_when_node_role_is_not_server(tmp_path, monkeypatch):
    """The bridge MUST refuse to attach as a node whose role is
    `captain` or `crew` — even if its usb_mac is paired. This is the
    "bridge connects only to the server controller" invariant.
    """
    from server_bridge import runner
    yaml_path = _write_nodes_yaml(tmp_path, """
        nodes:
          0x0A:
            name: captain
            role: captain
            usb_mac: "02:00:00:00:00:0A"
    """)
    monkeypatch.setattr(runner, "BASE", tmp_path)

    with pytest.raises(SystemExit) as exc:
        runner._resolve_serial_port(node_id=0x0A, override=None)
    assert "role 'captain'" in str(exc.value)
    assert "'server'" in str(exc.value)


def test_resolver_refuses_when_node_missing_from_config(tmp_path, monkeypatch):
    from server_bridge import runner
    _write_nodes_yaml(tmp_path, """
        nodes:
          0x01:
            name: server
            role: server
            usb_mac: "AA:BB:CC:DD:EE:FF"
    """)
    monkeypatch.setattr(runner, "BASE", tmp_path)

    with pytest.raises(SystemExit) as exc:
        runner._resolve_serial_port(node_id=0x05, override=None)
    assert "0x05" in str(exc.value)
    assert "missing from .config.nodes.yaml" in str(exc.value)


def test_resolver_raises_transient_when_usb_not_plugged_in(tmp_path, monkeypatch):
    """Critical for unattended Pi operation: when the supervisor
    restarts the bridge mid-shift and the Heltec is briefly
    unplugged, the resolver MUST raise ``TransientBootError`` (which
    the supervisor catches and retries) rather than ``SystemExit``
    (which kills the process).

    This is the exact regression the operator hit at 04:14:24 on
    the Pi: bridge.run() exited because the USB was wiggled, the
    supervisor tried to restart, the resolver couldn't find the MAC,
    sys.exit() fired, and the bridge process died — leaving the
    Pi with no bridge until someone SSH'd in to relaunch it. That
    defeats the entire "zero monitoring" promise.
    """
    from server_bridge import runner
    _write_nodes_yaml(tmp_path, """
        nodes:
          0x01:
            name: server
            role: server
            usb_mac: "DE:AD:BE:EF:00:01"
    """)
    monkeypatch.setattr(runner, "BASE", tmp_path)
    monkeypatch.setattr(
        "utils.discovery.find_port_by_mac", lambda mac: None,
    )

    with pytest.raises(runner.TransientBootError) as exc:
        runner._resolve_serial_port(node_id=0x01, override=None)
    assert "DE:AD:BE:EF:00:01" in str(exc.value)
    # Must NOT be a SystemExit — that's what killed the process.
    assert not isinstance(exc.value, SystemExit), (
        "USB-not-plugged-in must be recoverable; SystemExit kills the supervisor"
    )


def test_resolver_accepts_override_without_mac_lookup(tmp_path, monkeypatch):
    """`--serial-port` override should work without requiring the
    operator to set up usb_mac in the YAML — useful for first-boot
    pairing of a brand-new server Heltec. The role check on the
    *configured node* still applies though."""
    from server_bridge import runner
    _write_nodes_yaml(tmp_path, """
        nodes:
          0x01:
            name: server
            role: server
    """)
    monkeypatch.setattr(runner, "BASE", tmp_path)

    result = runner._resolve_serial_port(
        node_id=0x01, override="/dev/cu.usbmodem9999",
    )
    assert result == "/dev/cu.usbmodem9999"
