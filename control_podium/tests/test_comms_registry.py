"""
Unit tests for comms.registry. Hardware-free; run with --noconftest.
"""
from __future__ import annotations

import sys
from pathlib import Path
from textwrap import dedent

import pytest

BASE = Path(__file__).resolve().parent.parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from comms.bridge import _paginate_patterns
from comms.registry import CommandRegistry


@pytest.fixture
def registry_path(tmp_path: Path) -> Path:
    p = tmp_path / "commands.yaml"
    p.write_text(dedent("""
        commands:
          pattern:
            enabled: true
            min_role: priv
          param:
            enabled: true
            min_role: priv
          experimental:
            enabled: false
            min_role: priv
        queries:
          engine/status:
            enabled: true
            min_role: reg
          param:
            enabled: true
            min_role: reg
    """).strip(), encoding="utf-8")
    return p


def test_command_priv_passes(registry_path):
    reg = CommandRegistry.load(registry_path)
    d = reg.decide_cmd("pattern", "priv")
    assert d.allowed
    assert d.entry is not None
    assert d.entry.path == "pattern"


def test_command_reg_blocked(registry_path):
    reg = CommandRegistry.load(registry_path)
    d = reg.decide_cmd("pattern", "reg")
    assert not d.allowed
    assert d.nak_reason == "min_role"


def test_command_unknown(registry_path):
    reg = CommandRegistry.load(registry_path)
    d = reg.decide_cmd("nope", "priv")
    assert not d.allowed
    assert d.nak_reason == "unknown_cmd"
    assert d.entry is None


def test_command_disabled(registry_path):
    reg = CommandRegistry.load(registry_path)
    d = reg.decide_cmd("experimental", "priv")
    assert not d.allowed
    assert d.nak_reason == "disabled"
    assert d.entry is not None


def test_query_full_path(registry_path):
    reg = CommandRegistry.load(registry_path)
    d = reg.decide_qry("engine/status", "reg")
    assert d.allowed


def test_query_first_segment_fallback(registry_path):
    reg = CommandRegistry.load(registry_path)
    # No exact entry for "param/speed"; should fall back to "param".
    d = reg.decide_qry("param/speed", "reg")
    assert d.allowed


def test_query_walks_up_path_components(registry_path):
    """Multi-segment subpaths should resolve to the most specific
    registered prefix. ``engine/status/foo/bar`` has no entry of its
    own but ``engine/status`` does; the registry should match it.
    Critical for the paged ``engine/patterns/p/<n>`` query the bridge
    now serves — it relies on this prefix walk to authorise."""
    reg = CommandRegistry.load(registry_path)
    d = reg.decide_qry("engine/status/extra/path", "reg")
    assert d.allowed
    assert d.entry is not None
    assert d.entry.path == "engine/status"


def test_query_unknown(registry_path):
    reg = CommandRegistry.load(registry_path)
    d = reg.decide_qry("zzz/zz", "reg")
    assert not d.allowed
    assert d.nak_reason == "unknown_qry"


def test_command_unknown_min_role_fails_to_load(tmp_path: Path):
    p = tmp_path / "bad.yaml"
    p.write_text(dedent("""
        commands:
          x:
            enabled: true
            min_role: god
    """).strip(), encoding="utf-8")
    with pytest.raises(ValueError):
        CommandRegistry.load(p)


def test_command_legacy_role_alias_accepted(tmp_path: Path):
    """Old labels (priv/reg) should still be accepted as canonical roles."""
    p = tmp_path / "r.yaml"
    p.write_text(dedent("""
        commands:
          x:
            enabled: true
            min_role: priv
    """).strip(), encoding="utf-8")
    reg = CommandRegistry.load(p)
    assert reg.decide_cmd("x", "captain").allowed
    assert reg.decide_cmd("x", "priv").allowed
    assert not reg.decide_cmd("x", "crew").allowed
    assert not reg.decide_cmd("x", "reg").allowed


# ── _paginate_patterns ──────────────────────────────────────────────


def test_paginate_patterns_empty_input_returns_one_empty_page():
    pages = _paginate_patterns([], csv_budget=20)
    assert pages == [""]


def test_paginate_patterns_single_page_when_under_budget():
    pages = _paginate_patterns(["a", "b", "c"], csv_budget=100)
    assert pages == ["a,b,c"]


def test_paginate_patterns_splits_when_over_budget():
    """With a 12-char budget, 'aaaa,bbbb' (9 chars) fits but
    'aaaa,bbbb,cccc' (14) doesn't, so 'cccc' must go to page 2."""
    pages = _paginate_patterns(["aaaa", "bbbb", "cccc", "dddd"], csv_budget=12)
    assert pages == ["aaaa,bbbb", "cccc,dddd"]
    for p in pages:
        assert len(p) <= 12


def test_paginate_patterns_never_splits_a_single_name():
    """A name larger than the budget still ends up on its own page —
    we'd rather emit an oversize chunk than corrupt a name."""
    pages = _paginate_patterns(["short", "this_name_is_way_too_long_for_budget"],
                               csv_budget=10)
    assert pages == ["short", "this_name_is_way_too_long_for_budget"]
