"""
Tests — Config schema migration and deploy state.

Verifies backward compatibility with legacy 'mac' key and
the new 'usb_mac' + 'ble_address' schema.
"""

import pytest
import yaml
from pathlib import Path
from unittest.mock import patch, mock_open

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))


def test_save_pairing_writes_usb_mac(tmp_path):
    """save_pairing writes usb_mac instead of mac."""
    from utils import config_store

    # Temporarily override path
    orig = config_store.PAIRING_PATH
    config_store.PAIRING_PATH = tmp_path / ".config.pairing.yaml"

    try:
        config_store.save_pairing({
            "podium": {"usb_mac": "AA:BB:CC:DD:EE:01"},
            "server": {"usb_mac": "AA:BB:CC:DD:EE:02", "ble_address": "11:22:33:44:55:66"},
        })

        with open(config_store.PAIRING_PATH) as f:
            data = yaml.safe_load(f)

        assert data["nodes"]["podium"]["usb_mac"] == "AA:BB:CC:DD:EE:01"
        assert data["nodes"]["server"]["ble_address"] == "11:22:33:44:55:66"
        assert data["nodes"]["podium"]["ble_address"] is None
    finally:
        config_store.PAIRING_PATH = orig


def test_save_pairing_legacy_mac_normalized(tmp_path):
    """save_pairing accepts legacy 'mac' key and converts to usb_mac."""
    from utils import config_store

    orig = config_store.PAIRING_PATH
    config_store.PAIRING_PATH = tmp_path / ".config.pairing.yaml"

    try:
        config_store.save_pairing({
            "podium": {"mac": "AA:BB:CC:DD:EE:01"},  # legacy format
        })

        with open(config_store.PAIRING_PATH) as f:
            data = yaml.safe_load(f)

        assert data["nodes"]["podium"]["usb_mac"] == "AA:BB:CC:DD:EE:01"
    finally:
        config_store.PAIRING_PATH = orig


def test_save_deploy_writes_deployed_nodes(tmp_path):
    """save_deploy writes rich deployed_nodes dict."""
    from utils import config_store

    orig = config_store.DEPLOY_PATH
    config_store.DEPLOY_PATH = tmp_path / ".config.deploy.yaml"

    try:
        config_store.save_deploy(
            config={"firmware_version": "1.2-ble-cmd"},
            deployed_nodes={
                "podium": {
                    "usb_port": "COM13",
                    "ble_name": "Titanic-Podium",
                    "ble_address_last_seen": "AA:BB:CC:DD:EE:99",
                    "last_status": "deployed",
                },
            },
        )

        with open(config_store.DEPLOY_PATH) as f:
            data = yaml.safe_load(f)

        assert data["firmware_version"] == "1.2-ble-cmd"
        assert data["deployed_nodes"]["podium"]["usb_port"] == "COM13"
        assert data["deployed_nodes"]["podium"]["ble_name"] == "Titanic-Podium"
        assert data["deployed_nodes"]["podium"]["ble_address_last_seen"] == "AA:BB:CC:DD:EE:99"
    finally:
        config_store.DEPLOY_PATH = orig


def test_save_deploy_legacy_ports(tmp_path):
    """save_deploy still works with legacy ports dict."""
    from utils import config_store

    orig = config_store.DEPLOY_PATH
    config_store.DEPLOY_PATH = tmp_path / ".config.deploy.yaml"

    try:
        config_store.save_deploy(
            config={"firmware_version": "1.0"},
            ports={"podium": "COM13", "server": "COM14"},
        )

        with open(config_store.DEPLOY_PATH) as f:
            data = yaml.safe_load(f)

        assert data["deployed_nodes"]["podium"]["usb_port"] == "COM13"
        assert data["deployed_nodes"]["podium"]["ble_name"] == "Titanic-Podium"
        assert data["deployed_nodes"]["server"]["usb_port"] == "COM14"
    finally:
        config_store.DEPLOY_PATH = orig
