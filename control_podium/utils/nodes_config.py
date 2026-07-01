"""
Nodes config — merge the committed node table with gitignored hardware pairing.

This repo is public, so real hardware identifiers never live in a committed
file. The node table is split the same way utils/config_store.py splits the
podium config:

  .config.nodes.yaml          — COMMITTED. node id → name / role / type /
                                notes. The mesh identity + ACL source of
                                truth; contains no per-device identifiers.
  .config.nodes.pairing.yaml  — GITIGNORED. node id → usb_mac of the physical
                                board bound to that node. Written by
                                firmware/deploy.py (--pair / auto-pair /
                                --clear) on the machine that did the pairing.

``load_nodes()`` returns the merged ``nodes`` mapping (keyed by integer node
id, as PyYAML parses ``0x01`` keys). ``usb_mac`` from the pairing overlay
wins over any value inline in the committed file (inline values still merge
so hand-written test fixtures keep working). A missing overlay is normal —
fresh checkout, nothing paired yet — and simply yields nodes without
``usb_mac``; callers already fail loudly with re-pair instructions when they
need a MAC that isn't there. A missing or malformed .config.nodes.yaml is a
hard error.
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

PODIUM_DIR = Path(__file__).resolve().parent.parent
NODES_FILENAME = ".config.nodes.yaml"
PAIRING_FILENAME = ".config.nodes.pairing.yaml"

NODES_YAML = PODIUM_DIR / NODES_FILENAME
PAIRING_YAML = PODIUM_DIR / PAIRING_FILENAME

_PAIRING_HEADER = """\
# TITANIC Control Podium — Hardware pairing (GITIGNORED)
# node id → usb_mac of the physical board bound to that node.
# Written by firmware/deploy.py (--pair / auto-pair / --clear).
# Real device MACs never go in the committed .config.nodes.yaml —
# this repo is public. See utils/nodes_config.py.
"""


def _key_to_int(key) -> int | None:
    """Node keys are ints once PyYAML parses ``0x01``, but operators
    sometimes quote them ("0x01"). Normalize both shapes; None if neither.
    """
    if isinstance(key, int):
        return key
    if isinstance(key, str):
        try:
            return int(key, 0)
        except ValueError:
            return None
    return None


def load_pairing(base: Path = PODIUM_DIR) -> dict[int, str]:
    """Return ``{node_id: usb_mac}`` from the gitignored pairing overlay.

    Missing overlay → empty dict (nothing paired on this machine yet).
    """
    path = base / PAIRING_FILENAME
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    nodes = data.get("nodes") or {}
    out: dict[int, str] = {}
    for key, entry in nodes.items():
        nid = _key_to_int(key)
        mac = entry.get("usb_mac") if isinstance(entry, dict) else None
        if nid is not None and mac:
            out[nid] = str(mac)
    return out


def load_nodes(base: Path = PODIUM_DIR) -> dict:
    """Return the merged ``nodes`` mapping from the committed table plus
    the pairing overlay. Keys are whatever PyYAML parsed (ints for the
    canonical ``0x01`` style). Hard-fails if the committed table is
    missing or malformed.
    """
    nodes_path = base / NODES_FILENAME
    if not nodes_path.exists():
        sys.exit(f"missing {nodes_path}")
    data = yaml.safe_load(nodes_path.read_text(encoding="utf-8")) or {}
    nodes = data.get("nodes")
    if not isinstance(nodes, dict):
        sys.exit(f"{nodes_path}: 'nodes' must be a mapping")

    pairing = load_pairing(base)
    for key, entry in nodes.items():
        nid = _key_to_int(key)
        if isinstance(entry, dict) and nid in pairing:
            entry["usb_mac"] = pairing[nid]
    return nodes


def _write_pairing_file(pairing: dict[int, str], base: Path) -> None:
    """Serialize the overlay with readable hex keys and quoted MACs."""
    lines = [_PAIRING_HEADER, "\nnodes:\n"]
    for nid in sorted(pairing):
        lines.append(f"  0x{nid:02X}:\n")
        lines.append(f'    usb_mac: "{pairing[nid]}"\n')
    (base / PAIRING_FILENAME).write_text("".join(lines), encoding="utf-8")


def save_pairing_mac(node_id: int, mac: str, base: Path = PODIUM_DIR) -> None:
    """Set or replace ``usb_mac`` for a node in the pairing overlay."""
    pairing = load_pairing(base)
    pairing[node_id] = mac.upper()
    _write_pairing_file(pairing, base)


def clear_pairing_mac(node_id: int, base: Path = PODIUM_DIR) -> bool:
    """Remove one node's pairing. Returns True if anything changed."""
    pairing = load_pairing(base)
    if node_id not in pairing:
        return False
    del pairing[node_id]
    _write_pairing_file(pairing, base)
    return True


def clear_all_pairings(base: Path = PODIUM_DIR) -> int:
    """Remove every pairing. Returns the count cleared."""
    pairing = load_pairing(base)
    if pairing:
        _write_pairing_file({}, base)
    return len(pairing)
