"""
Unit tests for comms.acl. Hardware-free; run with --noconftest.
"""
from __future__ import annotations

import sys
from pathlib import Path
from textwrap import dedent

import pytest

BASE = Path(__file__).resolve().parent.parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from comms.acl import AclTable, ROLE_PRIV, ROLE_REG, ROLE_SERVER
from comms.frame import TYPE_CMD, TYPE_HLO, TYPE_PING, TYPE_QRY


@pytest.fixture
def acl_path(tmp_path: Path) -> Path:
    p = tmp_path / "nodes.yaml"
    p.write_text(dedent("""
        nodes:
          0x01:
            name: server
            role: server
          0x0A:
            name: sina
            role: priv
          0x10:
            name: crew_01
            role: reg
    """).strip(), encoding="utf-8")
    return p


def test_loads(acl_path):
    acl = AclTable.load(acl_path)
    assert acl.known(0x01) and acl.known(0x0A) and acl.known(0x10)
    assert acl.role(0x0A) == ROLE_PRIV
    assert acl.role(0x10) == ROLE_REG
    assert acl.role(0x01) == ROLE_SERVER


def test_priv_can_cmd(acl_path):
    acl = AclTable.load(acl_path)
    assert acl.allow(0x0A, TYPE_CMD)
    assert acl.allow(0x0A, TYPE_QRY)
    assert acl.allow(0x0A, TYPE_PING)


def test_reg_cannot_cmd(acl_path):
    acl = AclTable.load(acl_path)
    assert not acl.allow(0x10, TYPE_CMD)
    assert acl.allow(0x10, TYPE_QRY)
    assert acl.allow(0x10, TYPE_HLO)


def test_unknown_node_denied(acl_path):
    acl = AclTable.load(acl_path)
    assert not acl.allow(0x99, TYPE_QRY)


def test_unknown_role_fails_to_load(tmp_path: Path):
    p = tmp_path / "bad.yaml"
    p.write_text(dedent("""
        nodes:
          0x05:
            name: weird
            role: god-mode
    """).strip(), encoding="utf-8")
    with pytest.raises(ValueError):
        AclTable.load(p)


def test_touch_updates_last_seen(acl_path):
    acl = AclTable.load(acl_path)
    e = acl.get(0x0A)
    assert e is not None
    assert e.last_seen == 0.0
    acl.touch(0x0A)
    assert e.last_seen > 0
