"""
acl.py — Node identity + per-role permission table.

The source of truth is ``control_podium/.config.nodes.yaml``. Roles
(ship-themed; older ``priv``/``reg`` labels are still accepted as
deprecated aliases):

* ``captain`` — may send ``hlo`` / ``pin`` / ``qry`` / ``cmd``.
* ``crew``    — may send ``hlo`` / ``pin`` / ``qry`` (read-only). MAY ping
                any other node, including captains, so they can flag attention.
* ``server``  — produces ``ack`` / ``nak`` / ``rep`` / ``pub`` / ``pon``.
                The bridge enforces this on TX; spoofed server-role frames
                from a client still need ACL approval to do anything.

The bridge is the single trust boundary; the firmware does no auth.

Out of scope (intentionally): a `stoker` / fire-station role. The flame
effect controller (FW-SPEC-001) runs different firmware on a separate
transport — it never joins this mesh.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml

from .frame import TYPE_CMD, TYPE_HLO, TYPE_PING, TYPE_QRY

logger = logging.getLogger("titanic.acl")

ROLE_CAPTAIN = "captain"
ROLE_CREW = "crew"
ROLE_SERVER = "server"

# Back-compat aliases (deprecated). New code should use the
# ROLE_CAPTAIN / ROLE_CREW names.
ROLE_PRIV = ROLE_CAPTAIN
ROLE_REG = ROLE_CREW

# Back-compat: old role names map to the new ones. Lets us read older
# .config.nodes.yaml files (or hand-written test fixtures) without forcing
# a rename. New code should always use the canonical names above.
_ROLE_ALIASES = {
    "priv": ROLE_CAPTAIN,
    "reg": ROLE_CREW,
}


_TYPES_BY_ROLE = {
    ROLE_CAPTAIN: {TYPE_HLO, TYPE_PING, TYPE_QRY, TYPE_CMD},
    ROLE_CREW:    {TYPE_HLO, TYPE_PING, TYPE_QRY},
    # The server doesn't usually send commands; we leave the set narrow so
    # spoofed cmd-from-server frames get rejected by the bridge.
    ROLE_SERVER:  {TYPE_HLO, TYPE_PING, TYPE_QRY},
}


@dataclass
class NodeEntry:
    node_id: int
    name: str
    role: str
    type: str = "unknown"
    notes: str = ""
    last_seen: float = 0.0


class AclTable:
    """Loaded from ``.config.nodes.yaml``."""

    def __init__(self, nodes: dict[int, NodeEntry]):
        self._nodes = nodes

    # ── Loading ──────────────────────────────────────────────────────────
    @classmethod
    def load(cls, path: Path | str) -> "AclTable":
        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(f"node table not found: {path}")
        with open(path, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        raw_nodes = data.get("nodes", {})
        nodes: dict[int, NodeEntry] = {}
        for key, body in raw_nodes.items():
            nid = _parse_id(key)
            name = str(body.get("name", f"node{nid:02x}"))
            raw_role = str(body.get("role", ROLE_CREW)).lower()
            role = _ROLE_ALIASES.get(raw_role, raw_role)
            ntype = str(body.get("type", "unknown")).lower()
            notes = str(body.get("notes", ""))
            if role not in _TYPES_BY_ROLE:
                raise ValueError(
                    f"node 0x{nid:02X} '{name}': unknown role {raw_role!r}"
                )
            nodes[nid] = NodeEntry(node_id=nid, name=name, role=role,
                                   type=ntype, notes=notes)
        return cls(nodes)

    # ── Queries ──────────────────────────────────────────────────────────
    def get(self, node_id: int) -> Optional[NodeEntry]:
        return self._nodes.get(node_id)

    def allow(self, node_id: int, typ: str) -> bool:
        """Return True if a node may send a frame of the given ``typ``."""
        entry = self._nodes.get(node_id)
        if entry is None:
            return False
        allowed = _TYPES_BY_ROLE.get(entry.role, set())
        return typ in allowed

    def role(self, node_id: int) -> Optional[str]:
        entry = self._nodes.get(node_id)
        return entry.role if entry else None

    def name(self, node_id: int) -> str:
        entry = self._nodes.get(node_id)
        return entry.name if entry else f"node{node_id:02x}"

    def touch(self, node_id: int) -> None:
        entry = self._nodes.get(node_id)
        if entry is not None:
            entry.last_seen = time.time()

    def known(self, node_id: int) -> bool:
        return node_id in self._nodes

    def all_nodes(self) -> list[NodeEntry]:
        return sorted(self._nodes.values(), key=lambda e: e.node_id)

    def nodes_with_role(self, role: str) -> list[NodeEntry]:
        return [e for e in self._nodes.values() if e.role == role]


def _parse_id(key) -> int:
    """Accept ints, ``'0x0A'``, or ``'10'`` (decimal)."""
    if isinstance(key, int):
        return key
    s = str(key).strip().lower()
    if s.startswith("0x"):
        return int(s, 16)
    # ambiguity: 'a' is hex 10. We treat as hex if non-decimal chars present.
    try:
        return int(s)
    except ValueError:
        return int(s, 16)
