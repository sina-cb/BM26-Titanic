"""
Unit tests for comms/replay.py — per-source anti-replay window.

Mirrors the behavior table in design doc §3.6.5.
"""

from __future__ import annotations

import pytest

from control_podium.comms.replay import (
    ReplayResult,
    ReplayWindow,
    DEFAULT_REANCHOR_DROP,
    WINDOW_BITS,
)


def test_first_frame_anchors():
    rw = ReplayWindow()
    assert rw.accept(0x0A, 1000) == ReplayResult.OK
    assert rw.ok_count == 1


def test_strictly_newer_accepted():
    rw = ReplayWindow()
    rw.accept(0x0A, 1000)
    assert rw.accept(0x0A, 1001) == ReplayResult.OK
    assert rw.accept(0x0A, 1002) == ReplayResult.OK
    assert rw.accept(0x0A, 1100) == ReplayResult.OK
    assert rw.ok_count == 4


def test_in_window_reorder_accepted():
    rw = ReplayWindow()
    rw.accept(0x0A, 1000)
    rw.accept(0x0A, 1010)
    # 1005 is within the window (offset 5) and unseen → reorder OK
    assert rw.accept(0x0A, 1005) == ReplayResult.OK_REORDER


def test_dup_in_window_rejected():
    rw = ReplayWindow()
    rw.accept(0x0A, 1000)
    rw.accept(0x0A, 1010)
    rw.accept(0x0A, 1005)  # OK_REORDER
    # Replay of 1005
    assert rw.accept(0x0A, 1005) == ReplayResult.REPLAY_DUP
    # Replay of the highest itself
    assert rw.accept(0x0A, 1010) == ReplayResult.REPLAY_DUP
    assert rw.replay_dup_count == 2


def test_below_window_rejected_as_too_old():
    rw = ReplayWindow()
    rw.accept(0x0A, 10_000)
    # WINDOW_BITS positions back is the boundary; one beyond → too old
    assert rw.accept(0x0A, 10_000 - WINDOW_BITS) == ReplayResult.REPLAY_TOO_OLD
    assert rw.accept(0x0A, 5_000) == ReplayResult.REPLAY_TOO_OLD
    assert rw.replay_too_old_count == 2


def test_per_source_isolation():
    """A's window must NOT affect B's. Spoofed src in a v2 frame won't
    survive AEAD anyway, but the window is always per-src as defense in
    depth."""
    rw = ReplayWindow()
    rw.accept(0x0A, 1000)
    rw.accept(0x0A, 2000)
    # B is fresh — should accept anything as the anchor.
    assert rw.accept(0x0B, 100) == ReplayResult.OK
    # Within B's own window: 50 is offset 50, unseen → reorder.
    assert rw.accept(0x0B, 50) == ReplayResult.OK_REORDER
    # And A's state is untouched: replaying A's 2000 still rejects.
    assert rw.accept(0x0A, 2000) == ReplayResult.REPLAY_DUP


def test_hlo_reanchor_after_huge_drop():
    """Companion restarts → counter seed is a fresh random; the bridge's
    saved highest_ctr is much higher. Only an hlo (with the huge drop) is
    allowed to re-anchor."""
    rw = ReplayWindow()
    rw.accept(0x0A, 10_000_000_000)  # bridge had been seeing big counters
    # Companion restarts and the new seed is, say, 5
    new_ctr = 5
    # Non-hlo at the new ctr → still rejected as too old
    assert rw.accept(0x0A, new_ctr, is_hlo=False) == ReplayResult.REPLAY_TOO_OLD
    # hlo at the new ctr → re-anchor
    assert rw.accept(0x0A, new_ctr, is_hlo=True) == ReplayResult.REANCHORED
    # Subsequent frames at the new ctr space are accepted normally
    assert rw.accept(0x0A, new_ctr + 1) == ReplayResult.OK
    assert rw.accept(0x0A, new_ctr + 2) == ReplayResult.OK
    assert rw.reanchor_count == 1


def test_hlo_with_small_drop_does_not_reanchor():
    """A small/old hlo from a known src must NOT re-anchor — that would
    let an attacker who captured one valid hlo wipe our window state."""
    rw = ReplayWindow()
    rw.accept(0x0A, 1_000_000)
    # 100 below — well under DEFAULT_REANCHOR_DROP — should be too-old
    assert rw.accept(0x0A, 999_900, is_hlo=True) == ReplayResult.REPLAY_TOO_OLD
    assert rw.reanchor_count == 0


def test_huge_jump_clears_bitmap():
    """If the counter jumps further than WINDOW_BITS, the bitmap should
    be reset (only the new highest bit set), not silently shifted past
    its 64-bit width."""
    rw = ReplayWindow()
    rw.accept(0x0A, 100)
    rw.accept(0x0A, 100 + WINDOW_BITS + 50)
    # Frames in the now-stale region must be too-old
    assert rw.accept(0x0A, 100) == ReplayResult.REPLAY_TOO_OLD
    assert rw.accept(0x0A, 105) == ReplayResult.REPLAY_TOO_OLD


def test_snapshot_includes_sources():
    rw = ReplayWindow()
    rw.accept(0x0A, 100)
    rw.accept(0x0B, 200)
    snap = rw.snapshot()
    assert "0x0A" in snap["sources"]
    assert "0x0B" in snap["sources"]
    assert snap["sources"]["0x0A"]["highest_ctr"] == 100
    assert snap["counters"]["ok"] == 2


def test_simulated_durable_counter_restart():
    """
    Simulate app restart with DurableCounter.
    1. First run uses counter in block [1000, 2023].
    2. Sends counter 1000 -> accepted.
    3. Sends counter 1001 -> accepted.
    4. App crashes/restarts, next counter block is reserved starting at 2024.
    5. Sends counter 2024 -> accepted.
    6. Replaying 1000 -> rejected as too-old.
    """
    rw = ReplayWindow()
    # 1. First run, counter 1000 is sent
    assert rw.accept(0x0A, 1000) == ReplayResult.OK
    # 2. Next counter is 1001
    assert rw.accept(0x0A, 1001) == ReplayResult.OK
    
    # 3. App restarts. The DurableCounter block reservation logic means
    #    the new block starts at least 1024 steps above the previous limit.
    #    So the new counter starts at 2024.
    assert rw.accept(0x0A, 2024) == ReplayResult.OK
    
    # 4. Replaying the old 1000 should be rejected
    assert rw.accept(0x0A, 1000) == ReplayResult.REPLAY_TOO_OLD
