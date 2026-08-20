"""
replay.py — Per-source anti-replay window for v2 secured frames.

Companion to ``secure.py``. The codec verifies that a frame is
authentically from a known sender; this module decides whether that
sender's *counter* makes the frame fresh or a replay.

Spec: ``docs/07_control_podium_draft.md §3.6.5``.

* For each source ``src`` we track ``highest_ctr`` and a 64-bit bitmap of
  recently-seen counters.
* Counters STRICTLY GREATER than ``highest_ctr`` slide the window
  forward and are accepted.
* Counters within ``[highest_ctr-63, highest_ctr]`` whose bit is unset are
  accepted as out-of-order arrivals; bit set → replay → reject.
* Counters older than the window → reject as too-old.
* ``hlo`` from a known source is allowed to **re-anchor** the window if
  the incoming counter is dramatically below ``highest_ctr`` (companion
  process restarted with a fresh seed). Only ``hlo`` re-anchors —
  everything else in the same drift state is rejected, preventing an
  attacker from recycling a known counter window via a forged hlo
  (they'd still need the AEAD key to forge the hlo itself).

The `accept()` API returns a small enum result so callers can keep
per-class metrics (`replay_dup_count`, `replay_too_old_count`, ...)
without re-implementing the logic.
"""

from __future__ import annotations

import enum
import logging
import time
from dataclasses import dataclass, field
from typing import Dict

logger = logging.getLogger("titanic.replay")

WINDOW_BITS = 64
DEFAULT_REANCHOR_DROP = 1 << 32  # how far below highest_ctr counts as "obvious restart"


class ReplayResult(enum.Enum):
    OK = "ok"                    # accept, slide window
    OK_REORDER = "ok_reorder"    # accept, fill in-window bit
    REPLAY_DUP = "replay_dup"    # bit already set in window
    REPLAY_TOO_OLD = "replay_too_old"  # below window
    REANCHORED = "reanchored"    # hlo re-anchor accepted (counter reset)


@dataclass
class _SourceState:
    highest_ctr: int = 0
    bitmap: int = 0
    last_seen_at: float = field(default_factory=time.time)


class ReplayWindow:
    """Tracks per-source counters with a 64-bit sliding window.

    Thread-safety: not threadsafe. The bridge runs single-threaded under
    asyncio; the radio port awaits the codec serially. If you ever spin
    multiple asyncio tasks that share one ReplayWindow, wrap calls in an
    asyncio.Lock.
    """

    def __init__(self,
                 reanchor_drop_threshold: int = DEFAULT_REANCHOR_DROP):
        self._sources: Dict[int, _SourceState] = {}
        self._reanchor_drop = reanchor_drop_threshold
        # Surface counts so the bridge can expose /bridge/stats per §3.6.7.
        self.ok_count = 0
        self.ok_reorder_count = 0
        self.replay_dup_count = 0
        self.replay_too_old_count = 0
        self.reanchor_count = 0

    def __len__(self) -> int:
        return len(self._sources)

    # ── Main API ──────────────────────────────────────────────────────

    def accept(self, src: int, ctr: int, *, is_hlo: bool = False) -> ReplayResult:
        """Decide whether ``src``'s ``ctr`` is fresh.

        Updates internal state on every call (whether accepted or not).
        Returns a ``ReplayResult`` describing the outcome.
        """
        st = self._sources.get(src)
        if st is None:
            # First frame ever from this src — anchor the window here.
            self._sources[src] = _SourceState(highest_ctr=ctr, bitmap=1)
            self.ok_count += 1
            return ReplayResult.OK

        st.last_seen_at = time.time()

        # Hot path: strictly newer than anything seen.
        if ctr > st.highest_ctr:
            shift = ctr - st.highest_ctr
            # Slide the bitmap; clamp at the window size to avoid huge shifts
            # when the sender's counter jumped (legitimate restart, etc.).
            if shift >= WINDOW_BITS:
                st.bitmap = 1
            else:
                st.bitmap = ((st.bitmap << shift) & ((1 << WINDOW_BITS) - 1)) | 1
            st.highest_ctr = ctr
            self.ok_count += 1
            return ReplayResult.OK

        # In-window slot? offset 0 = the highest_ctr position itself.
        offset = st.highest_ctr - ctr
        if offset < WINDOW_BITS:
            mask = 1 << offset
            if st.bitmap & mask:
                self.replay_dup_count += 1
                logger.debug("replay dup src=0x%02X ctr=%d (offset=%d)", src, ctr, offset)
                return ReplayResult.REPLAY_DUP
            st.bitmap |= mask
            self.ok_reorder_count += 1
            return ReplayResult.OK_REORDER

        # Below the window. Two cases:
        # 1) hlo from a known source whose counter dropped a LOT: assume
        #    legitimate restart, re-anchor and accept. We require the drop
        #    to be "obviously a restart" (~4B counts) so a one-off old hlo
        #    can't reset us.
        # 2) Anything else: replay-too-old, reject.
        if is_hlo and (st.highest_ctr - ctr) >= self._reanchor_drop:
            logger.info(
                "replay window re-anchored on hlo from src=0x%02X "
                "(was highest=%d, now=%d)", src, st.highest_ctr, ctr,
            )
            st.highest_ctr = ctr
            st.bitmap = 1
            self.reanchor_count += 1
            return ReplayResult.REANCHORED

        self.replay_too_old_count += 1
        logger.debug(
            "replay too-old src=0x%02X ctr=%d (highest=%d, drop=%d)",
            src, ctr, st.highest_ctr, st.highest_ctr - ctr,
        )
        return ReplayResult.REPLAY_TOO_OLD

    # ── Diagnostics ───────────────────────────────────────────────────

    def snapshot(self) -> dict:
        """Return a small JSON-serializable snapshot for /bridge/stats."""
        return {
            "sources": {
                f"0x{src:02X}": {
                    "highest_ctr": st.highest_ctr,
                    "last_seen_s_ago": round(time.time() - st.last_seen_at, 1),
                }
                for src, st in self._sources.items()
            },
            "counters": {
                "ok": self.ok_count,
                "ok_reorder": self.ok_reorder_count,
                "replay_dup": self.replay_dup_count,
                "replay_too_old": self.replay_too_old_count,
                "reanchor": self.reanchor_count,
            },
        }
