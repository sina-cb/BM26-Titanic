"""
registry.py — Command + query allowlist loaded from YAML.

``.config.commands.yaml`` is the authoritative list of paths the bridge
will translate. The handlers themselves live in ``bridge.py``; this module
is the gate that decides whether a request EVEN reaches a handler.

Two orthogonal axes:

* **Enabled / disabled**: a `cmd pattern/sunset` from a privileged client
  is silently NAK'd if `pattern.enabled = false` in YAML. This lets us
  kill a command in the field (config bump + bridge restart) without
  redeploying code.

* **Role floor**: every command declares the minimum role allowed to
  issue it. Roles are ranked ``crew < captain < server``. The ACL
  already enforces a coarse cmd/qry capability per role; this is the
  finer-grained per-path layer.

  Old role names (``priv``/``reg``) are accepted as aliases so we don't
  have to rewrite every fixture in lockstep.

Returns are intentionally fast: a single dict lookup. The bridge calls
``decide()`` for every incoming cmd/qry, so allocation matters.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml

logger = logging.getLogger("titanic.registry")


# Ranking used for ``min_role`` checks. Higher number = more privileged.
# A client with role rank ≥ the command's min rank passes.
ROLE_RANK = {
    "crew": 0,
    "captain": 1,
    "server": 99,
}

# Old labels still accepted in YAML (and from the ACL). Keep this list
# short and don't add new aliases.
_ROLE_ALIASES = {
    "reg": "crew",
    "priv": "captain",
}


def _canonical_role(name: str) -> str:
    name = name.lower()
    return _ROLE_ALIASES.get(name, name)


@dataclass(frozen=True)
class CommandEntry:
    path: str
    enabled: bool
    min_role: str
    description: str = ""

    def role_passes(self, role: str) -> bool:
        canon = _canonical_role(role)
        return ROLE_RANK.get(canon, -1) >= ROLE_RANK.get(self.min_role, 99)


@dataclass(frozen=True)
class QueryEntry:
    path: str
    enabled: bool
    min_role: str
    description: str = ""

    def role_passes(self, role: str) -> bool:
        canon = _canonical_role(role)
        return ROLE_RANK.get(canon, -1) >= ROLE_RANK.get(self.min_role, 99)


@dataclass(frozen=True)
class CommandDecision:
    """Outcome of registry lookup. Bridge maps these onto NAK reasons."""
    allowed: bool
    entry: Optional[CommandEntry] = None
    nak_reason: str = ""          # "unknown_cmd" | "disabled" | "min_role"


@dataclass(frozen=True)
class QueryDecision:
    allowed: bool
    entry: Optional[QueryEntry] = None
    nak_reason: str = ""


class CommandRegistry:
    """Loaded from ``.config.commands.yaml``."""

    def __init__(self,
                 commands: dict[str, CommandEntry],
                 queries: dict[str, QueryEntry]):
        self._commands = commands
        self._queries = queries

    # ── Loading ──────────────────────────────────────────────────────────
    @classmethod
    def load(cls, path: Path | str) -> "CommandRegistry":
        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(f"command registry not found: {path}")
        with open(path, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        commands: dict[str, CommandEntry] = {}
        for key, body in (data.get("commands") or {}).items():
            if not isinstance(body, dict):
                raise ValueError(f"command {key!r} body must be a mapping")
            raw_min_role = str(body.get("min_role", "captain")).lower()
            min_role = _canonical_role(raw_min_role)
            if min_role not in ROLE_RANK:
                raise ValueError(
                    f"command {key!r}: unknown min_role {raw_min_role!r}"
                )
            commands[str(key)] = CommandEntry(
                path=str(key),
                enabled=bool(body.get("enabled", True)),
                min_role=min_role,
                description=str(body.get("description", "")),
            )
        queries: dict[str, QueryEntry] = {}
        for key, body in (data.get("queries") or {}).items():
            if not isinstance(body, dict):
                raise ValueError(f"query {key!r} body must be a mapping")
            raw_min_role = str(body.get("min_role", "crew")).lower()
            min_role = _canonical_role(raw_min_role)
            if min_role not in ROLE_RANK:
                raise ValueError(
                    f"query {key!r}: unknown min_role {raw_min_role!r}"
                )
            queries[str(key)] = QueryEntry(
                path=str(key),
                enabled=bool(body.get("enabled", True)),
                min_role=min_role,
                description=str(body.get("description", "")),
            )
        return cls(commands, queries)

    # ── Lookup ──────────────────────────────────────────────────────────
    def decide_cmd(self, head: str, role: str) -> CommandDecision:
        """Decide whether a client with ``role`` may execute ``cmd <head>/...``."""
        entry = self._commands.get(head)
        if entry is None:
            return CommandDecision(allowed=False, nak_reason="unknown_cmd")
        if not entry.enabled:
            return CommandDecision(
                allowed=False, entry=entry, nak_reason="disabled",
            )
        if not entry.role_passes(role):
            return CommandDecision(
                allowed=False, entry=entry, nak_reason="min_role",
            )
        return CommandDecision(allowed=True, entry=entry)

    def decide_qry(self, head: str, role: str) -> QueryDecision:
        """Decide whether a client with ``role`` may run ``qry <head>``.

        Queries are looked up by progressively shorter path prefixes:
        the full path first (``engine/patterns/p/0``), then walking up
        component-by-component until we either hit a registered entry
        (``engine/patterns``) or exhaust the path. That gives us
        per-subquery control while still allowing a single registry
        entry to govern a whole sub-tree of paths (e.g. one
        ``engine/patterns`` entry covers ``engine/patterns/p/<n>``).
        """
        candidates = [head]
        cur = head
        while "/" in cur:
            cur = cur.rsplit("/", 1)[0]
            candidates.append(cur)

        entry = None
        for cand in candidates:
            entry = self._queries.get(cand)
            if entry is not None:
                break
        if entry is None:
            return QueryDecision(allowed=False, nak_reason="unknown_qry")
        if not entry.enabled:
            return QueryDecision(
                allowed=False, entry=entry, nak_reason="disabled",
            )
        if not entry.role_passes(role):
            return QueryDecision(
                allowed=False, entry=entry, nak_reason="min_role",
            )
        return QueryDecision(allowed=True, entry=entry)

    # ── Introspection ───────────────────────────────────────────────────
    def all_commands(self) -> dict[str, CommandEntry]:
        return dict(self._commands)

    def all_queries(self) -> dict[str, QueryEntry]:
        return dict(self._queries)
