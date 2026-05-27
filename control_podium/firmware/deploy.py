#!/usr/bin/env python3
"""
deploy.py — MAC-locked firmware deploy for Heltec controllers.
=============================================================

Reads ../.config.nodes.yaml, picks the firmware env + NODE_ID for the
target node, and flashes ONLY the connected USB serial whose factory
MAC matches the node's `usb_mac` field. Refuses to flash if:

  - the target node has no `usb_mac` recorded (use --pair to set one), or
  - no currently-connected board has a MAC matching the recorded `usb_mac`.

This is the safety guard that keeps us from accidentally re-flashing the
"wrong" Heltec when two boards are plugged in at once. The Heltec V4
ESP32-S3 surfaces its factory MAC as the USB-CDC serial number, which
pyserial reads via list_ports — no esptool round-trip required.

Usage
-----
  python deploy.py --list                   # show pairing + connected boards
  python deploy.py --node 0x01              # build + flash node 0x01
  python deploy.py --node 0x0A --build-only # compile only, no upload
  python deploy.py --node 0x0A --pair       # explicitly pair an unclaimed board
  python deploy.py --role server            # by role (must be unique)
  python deploy.py --node 0x01 --no-verify  # skip post-flash banner check
  python deploy.py --node 0x0A --clear      # forget node 0x0A's MAC pairing
  python deploy.py --clear-all              # forget every MAC pairing

First-deploy auto-pair
----------------------
If the target node has no `usb_mac` set yet AND exactly one connected
Heltec has a MAC that isn't already claimed by some other node, deploy
will (after one [y/N] prompt) write that MAC into the YAML and proceed.
If 0 or >1 boards are unclaimed, deploy refuses — explicit --pair is
required to disambiguate.

YAML edits use ruamel.yaml so the header comment block and per-node
notes survive round-tripping unchanged.
"""

from __future__ import annotations

import argparse
import os
import shlex
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

# Allow `from utils.discovery import ...` regardless of CWD.
HERE = Path(__file__).resolve().parent          # .../control_podium/firmware/
PODIUM_DIR = HERE.parent                         # .../control_podium/
if str(PODIUM_DIR) not in sys.path:
    sys.path.insert(0, str(PODIUM_DIR))

import serial                                    # noqa: E402  (pyserial)
import yaml                                      # noqa: E402

# ruamel preserves comments + key order across round-trip writes, so
# auto-pair / --clear can mutate .config.nodes.yaml in place without
# clobbering the giant header comment that documents roles + reserved
# IDs. Falls back to PyYAML for read-only paths so --list and --build
# still work even if ruamel isn't installed.
try:
    from ruamel.yaml import YAML
    _ruamel = YAML(typ="rt")
    _ruamel.preserve_quotes = True
    _ruamel.indent(mapping=2, sequence=4, offset=2)
except ImportError:                              # pragma: no cover
    _ruamel = None

from utils.discovery import scan_ports, _normalize_mac  # noqa: E402

NODES_YAML = PODIUM_DIR / ".config.nodes.yaml"
FIRMWARE_YAML = PODIUM_DIR / ".config.firmware.yaml"
# Optional Pi credentials. When this file exists, deploy.py auto-scans
# the Pi's USB ports too, so a target Heltec plugged into the Pi can be
# flashed remotely with `--node 0xNN` without any extra flags. This
# unifies the "flash locally vs flash via Pi" UX into ONE command —
# the operator says what node they want, deploy.py figures out where
# the board actually lives. See docs/22_server_bridge.md §4.4.
SSH_SECRET = PODIUM_DIR / "server_bridge" / ".ssh.secret"
PIO_BIN = "pio"
SERVER_RX_ENV = "server_rx"
# ESP32-S3 standard partition offsets — must match what
# `pio run -t upload` does locally. Mirrored from server_bridge/deploy.py
# so the remote flash invocation is identical to the local one.
ESP32_FLASH_OFFSETS = [
    ("bootloader.bin", "0x0"),
    ("partitions.bin", "0x8000"),
    ("boot_app0.bin",  "0xe000"),
    ("firmware.bin",   "0x10000"),
]
# Optional per-developer override that wins over the committed file.
# Lets someone bench-test with debug.pin_high_forever without making
# everyone else build with it.
FIRMWARE_YAML_LOCAL = PODIUM_DIR / ".config.firmware.local.yaml"

# Mapping role → PlatformIO env. There's intentionally no fire-station
# entry here — that hardware (FW-SPEC-001 on WT32-ETH01) runs different
# firmware on a separate transport and is built from its own tree.
ROLE_TO_ENV: dict[str, str | None] = {
    "server":  "server_rx",
    "captain": "podium_tx",
    "crew":    "podium_tx",
}

# Hardware types this script knows how to flash. `pi` is the Pi bridge
# (no firmware to flash here). Anything else falls through with an error.
HELTEC_TYPES = {"heltec_v3", "heltec_v4"}

C = {
    "reset":  "\033[0m",
    "bold":   "\033[1m",
    "dim":    "\033[2m",
    "red":    "\033[91m",
    "green":  "\033[92m",
    "yellow": "\033[93m",
    "cyan":   "\033[96m",
}


def cprint(color: str, msg: str) -> None:
    print(f"{C.get(color, '')}{msg}{C['reset']}")


# ── Config + node selection ─────────────────────────────────────────

def load_nodes() -> dict:
    """Return the `nodes` dict from .config.nodes.yaml.

    PyYAML parses `0x01` keys as Python ints, so the dict is keyed by
    integer node id.
    """
    if not NODES_YAML.exists():
        sys.exit(f"missing {NODES_YAML}")
    with open(NODES_YAML) as f:
        data = yaml.safe_load(f) or {}
    nodes = data.get("nodes", {})
    if not isinstance(nodes, dict):
        sys.exit(f"{NODES_YAML}: 'nodes' must be a mapping")
    return nodes


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge `override` into `base` and return a new dict.

    Used for the .config.firmware.local.yaml override path — values in
    the local file win, but anything not mentioned there falls back to
    the committed defaults. Mirrors the ergonomics of git's
    `include.path` so a dev override file can stay tiny.
    """
    out: dict = {}
    keys = set(base.keys()) | set(override.keys())
    for k in keys:
        bv = base.get(k)
        ov = override.get(k)
        if isinstance(bv, dict) and isinstance(ov, dict):
            out[k] = _deep_merge(bv, ov)
        elif k in override:
            out[k] = ov
        else:
            out[k] = bv
    return out


def load_firmware_config() -> dict:
    """Return the merged firmware config from
    .config.firmware.yaml (+ optional .config.firmware.local.yaml).

    The committed file MUST exist; the local override is optional.
    Returning an empty dict here would silently drop every -D flag
    and the firmware would fall back to its in-header defaults — a
    quiet failure mode we'd rather catch loudly with a clear error.
    """
    if not FIRMWARE_YAML.exists():
        sys.exit(
            f"missing {FIRMWARE_YAML}.\n"
            "This file holds firmware behavior tunables (LoRa power, BLE\n"
            "PIN rotation, OLED timeouts, power profile). The firmware\n"
            "headers have matching #ifndef defaults so a build will still\n"
            "succeed, but every flash would silently revert to defaults\n"
            "and surprise the next person to look. Restore the file (it's\n"
            "tracked in git) or git-checkout it from main."
        )
    with open(FIRMWARE_YAML) as f:
        base = yaml.safe_load(f) or {}
    if FIRMWARE_YAML_LOCAL.exists():
        with open(FIRMWARE_YAML_LOCAL) as f:
            local = yaml.safe_load(f) or {}
        return _deep_merge(base, local)
    return base


def load_radio_flags(*, role: str | None = None) -> list[str]:
    """Translate .config.firmware.yaml into PlatformIO `-D…` flags.

    Each entry below is a (yaml_path, c_macro, fmt) triple. `yaml_path`
    is the dotted key into the config dict; `c_macro` is the #define
    name the firmware headers consult; `fmt` controls how we render
    the value:

        "int"     → bare integer literal (e.g. `-DBATT_SAMPLE_MS=5000`)
        "ms_ul"   → integer with `UL` suffix (millis-domain
                    unsigned-long arithmetic in C)
        "float_f" → C float literal with the `f` suffix (avoids the
                    implicit double-promotion warning RadioLib gives
                    on `radio.setOutputPower(22)` vs `22.0f`)
        "float"   → bare floating literal (no suffix; for setBeginsLora
                    which takes a double freq/bw)
        "bool"    → `1` or `0` (the firmware uses `#if KEY` blocks)

    `role` (when supplied) lets us emit role-conditional flags. Today
    the only one is `POWER_PROFILE_PIN_HIGH=1` for the server role,
    which pins the controller to HIGH mode regardless of activity —
    the server is USB-powered and we never want it to add latency to
    a critical relay (see .config.firmware.yaml::power_profile).
    """
    cfg = load_firmware_config()

    def _get(path: str):
        cur = cfg
        for part in path.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return None
            cur = cur[part]
        return cur

    def _fmt(val, fmt: str) -> str | None:
        if val is None:
            return None
        if fmt == "int":
            return f"{int(val)}"
        if fmt == "ms_ul":
            # `UL` so multiplication like `(unsigned long)X * 1000UL`
            # in the firmware stays in unsigned-long arithmetic without
            # overflow at e.g. 60_000 * 1000.
            return f"{int(val)}UL"
        if fmt == "float_f":
            return f"{float(val):.3f}f"
        if fmt == "float":
            return f"{float(val)}"
        if fmt == "bool":
            return "1" if val else "0"
        raise AssertionError(f"unknown fmt {fmt!r}")

    # (yaml_path, c_macro, fmt). Order chosen for the build log to
    # mirror the YAML file top-down — easier to eyeball.
    bindings: list[tuple[str, str, str]] = [
        # Radio
        ("radio.frequency_mhz",            "FREQUENCY",                "float"),
        ("radio.bandwidth_khz",            "BANDWIDTH",                "float"),
        ("radio.spreading_factor",         "SF",                       "int"),
        ("radio.coding_rate",              "CR",                       "int"),
        # NOTE: TX_POWER in the firmware is now driven by the power
        # profile (see below) — we set the COMPILE-TIME default to the
        # HIGH value, and the runtime profile mutates from there.
        ("power_profile.lora_tx_dbm_high", "TX_POWER",                 "int"),
        # BLE
        ("ble.passkey_max_age_ms",         "BLE_PASSKEY_MAX_AGE_MS",   "ms_ul"),
        ("ble.bond_clear_hold_ms",         "BLE_BOND_CLEAR_HOLD_MS",   "ms_ul"),
        # OLED
        ("oled.full_sec",                  "OLED_FULL_SEC",            "int"),
        ("oled.dim_sec",                   "OLED_DIM_SEC",             "int"),
        ("oled.contrast_full",             "OLED_CONTRAST_FULL",       "int"),
        ("oled.contrast_dim",              "OLED_CONTRAST_DIM",        "int"),
        # Battery
        ("battery.sample_ms",              "BATT_SAMPLE_MS",           "ms_ul"),
        ("battery.warn_volts",             "BATT_WARN_V",              "float_f"),
        ("battery.shutdown_volts",         "BATT_SHUTDOWN_V",          "float_f"),
        # Power profile
        ("power_profile.fast_idle_ms",     "PWR_FAST_IDLE_MS",         "ms_ul"),
        ("power_profile.ble_tx_dbm_high",  "PWR_BLE_TX_DBM_HIGH",      "int"),
        ("power_profile.ble_tx_dbm_low",   "PWR_BLE_TX_DBM_LOW",       "int"),
        ("power_profile.lora_tx_dbm_high", "PWR_LORA_TX_DBM_HIGH",     "int"),
        ("power_profile.lora_tx_dbm_low",  "PWR_LORA_TX_DBM_LOW",      "int"),
        ("power_profile.lora_slow_sf",     "PWR_LORA_SLOW_SF",         "int"),
        # Debug
        ("debug.pin_high_forever",         "PWR_DEBUG_PIN_HIGH",       "bool"),
        ("debug.log_mode_transitions",     "PWR_DEBUG_LOG_TRANSITIONS","bool"),
        # Profile switching
        ("profile_switching.plaintext_cfg_over_lora_enabled", "ALLOW_PLAINTEXT_PROFILE_CFG", "bool"),
    ]

    flags: list[str] = []
    for yaml_path, c_macro, fmt in bindings:
        v = _get(yaml_path)
        rendered = _fmt(v, fmt)
        if rendered is None:
            # Missing key just means "use the firmware's #ifndef
            # default" — fine for forward-compatibility when a new
            # YAML key is added but old binaries are reflashed.
            continue
        flags.append(f"-D{c_macro}={rendered}")

    # Role-conditional: the server is USB-powered and must always be
    # in HIGH (max BLE TX, max LoRa TX). Setting this flag at build
    # time means the firmware can skip the entire mode-switch state
    # machine on the server side — never accidentally throttling the
    # bridge under any failure mode.
    if role == "server":
        flags.append("-DPWR_PIN_HIGH=1")

    return flags


def parse_node_arg(s: str) -> int:
    """Accept '0x01', '01', '1', etc. Returns int."""
    s = s.strip().lower()
    try:
        return int(s, 16) if s.startswith("0x") else int(s, 0)
    except ValueError:
        sys.exit(f"invalid --node value: {s!r} (expected e.g. 0x01)")


def select_target(nodes: dict, *, node_id: int | None, role: str | None) -> tuple[int, dict]:
    """Pick exactly one (node_id, node_cfg) pair from --node or --role."""
    if node_id is not None and role is not None:
        sys.exit("pass --node or --role, not both")
    if node_id is not None:
        if node_id not in nodes:
            sys.exit(f"node 0x{node_id:02X} not in {NODES_YAML.name}")
        return node_id, nodes[node_id]
    if role is not None:
        matches = [(nid, n) for nid, n in nodes.items() if n.get("role") == role]
        if not matches:
            sys.exit(f"no nodes with role={role!r}")
        if len(matches) > 1:
            ids = ", ".join(f"0x{nid:02X}({n.get('name')})" for nid, n in matches)
            sys.exit(f"role={role!r} ambiguous (matches {ids}); pass --node instead")
        return matches[0]
    sys.exit("specify --node 0xNN or --role NAME")


def env_for_node(nid: int, node: dict) -> str:
    role = node.get("role")
    env = ROLE_TO_ENV.get(role)
    if env is None:
        sys.exit(
            f"node 0x{nid:02X} role={role!r} is not deployable from this script "
            "(only server / captain / crew run this firmware)"
        )
    htype = node.get("type")
    if htype not in HELTEC_TYPES:
        sys.exit(
            f"node 0x{nid:02X} type={htype!r} is not a Heltec; "
            f"this script only flashes {sorted(HELTEC_TYPES)}"
        )
    return env


# ── Hardware lookup ────────────────────────────────────────────────

def heltec_ports() -> list[dict]:
    """Filter scan_ports() down to Heltec/ESP32-S3 USB-CDC devices."""
    return [p for p in scan_ports() if p.get("is_heltec") and p.get("mac")]


def find_port_for_mac(mac: str) -> dict | None:
    """Return the connected port info dict whose MAC matches, or None."""
    target = _normalize_mac(mac)
    for p in heltec_ports():
        if _normalize_mac(p["mac"]) == target:
            return p
    return None


def _macs_used_in_yaml(nodes: dict, *, exclude_node: int | None = None) -> set[str]:
    """All MACs already pinned to a node, optionally excluding one node id."""
    return {
        _normalize_mac(n["usb_mac"])
        for nid, n in nodes.items()
        if n.get("usb_mac") and nid != exclude_node
    }


# ── ruamel-backed YAML edits (auto-pair / clear) ──────────────────

def _require_ruamel(action: str) -> "YAML":
    if _ruamel is None:
        sys.exit(
            f"{action} needs ruamel.yaml (preserves comments). Install with:\n"
            "  pip install 'ruamel.yaml>=0.18'"
        )
    return _ruamel


def _load_nodes_rt():
    """Round-trip-loaded full doc (CommentedMap) for in-place editing."""
    y = _require_ruamel("YAML edit")
    with open(NODES_YAML) as f:
        doc = y.load(f)
    if doc is None or "nodes" not in doc:
        sys.exit(f"{NODES_YAML}: no `nodes` mapping")
    return doc


def _save_nodes_rt(doc) -> None:
    y = _require_ruamel("YAML edit")
    with open(NODES_YAML, "w") as f:
        y.dump(doc, f)


def _node_key(doc_nodes, node_id: int):
    """ruamel preserves the literal key (often a YAML int parsed from
    `0x01`); look up tolerantly so callers can pass a plain int."""
    if node_id in doc_nodes:
        return node_id
    for k in doc_nodes.keys():
        if isinstance(k, int) and k == node_id:
            return k
    sys.exit(f"node 0x{node_id:02X} not found in {NODES_YAML.name}")


def write_pairing(node_id: int, mac: str) -> None:
    """Set or replace `usb_mac` on the node, preserving comments. The
    MAC is emitted as a double-quoted scalar to match the hand-edited
    entries in the file (and to dodge YAML-spec edge cases around bare
    colon-containing strings on future edits).
    """
    doc = _load_nodes_rt()
    nodes = doc["nodes"]
    k = _node_key(nodes, node_id)
    try:
        from ruamel.yaml.scalarstring import DoubleQuotedScalarString
        value = DoubleQuotedScalarString(mac.upper())
    except ImportError:                              # pragma: no cover
        value = mac.upper()
    nodes[k]["usb_mac"] = value
    _save_nodes_rt(doc)


def clear_pairing(node_id: int) -> bool:
    """Remove `usb_mac` from a node. Returns True if anything changed."""
    doc = _load_nodes_rt()
    nodes = doc["nodes"]
    k = _node_key(nodes, node_id)
    if "usb_mac" not in nodes[k]:
        return False
    del nodes[k]["usb_mac"]
    _save_nodes_rt(doc)
    return True


def clear_all_pairings() -> int:
    """Remove `usb_mac` from every node. Returns the count cleared."""
    doc = _load_nodes_rt()
    nodes = doc["nodes"]
    cleared = 0
    for k in list(nodes.keys()):
        if "usb_mac" in nodes[k]:
            del nodes[k]["usb_mac"]
            cleared += 1
    if cleared:
        _save_nodes_rt(doc)
    return cleared


def _confirm(prompt: str, *, assume_yes: bool) -> bool:
    if assume_yes:
        return True
    try:
        return input(prompt).strip().lower() in ("y", "yes")
    except EOFError:
        return False


# ── pio invocation ─────────────────────────────────────────────────

def _check_pio() -> str:
    """Resolve a usable pio binary.

    Priority:
      1. ``$PATH`` (works when the dev venv is activated, or when
         pio is symlinked into ``/usr/local/bin``).
      2. The standard PlatformIO core install location at
         ``~/.platformio/penv/bin/pio`` (created by the official
         PlatformIO installer + by VS Code's PIO extension).

    Why we fall back to the home-dir copy: the user installs pio
    once and expects every project to find it without sourcing a
    venv. Hard-failing here would force them to remember an extra
    step that adds no safety. We only error when pio is genuinely
    nowhere to be found.
    """
    pio = shutil.which("pio")
    if pio:
        return pio
    home_pio = Path.home() / ".platformio" / "penv" / "bin" / "pio"
    if home_pio.is_file() and os.access(home_pio, os.X_OK):
        return str(home_pio)
    sys.exit(
        "pio not found on $PATH and not at ~/.platformio/penv/bin/pio.\n"
        "Install it with: python -m pip install --user platformio\n"
        "or activate the dev venv: source .venv-dev/bin/activate"
    )


# ── Remote (Pi-side) flash support ───────────────────────────────────


_SSH_SECRET_KV_RE = re.compile(r"^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$")


def _load_ssh_secret() -> dict | None:
    """Read Pi SSH creds from ``server_bridge/.ssh.secret``. Returns None
    when the file is missing or lacks the required HOST/USER fields,
    in which case remote-flash via the Pi is unavailable.
    """
    if not SSH_SECRET.is_file():
        return None
    merged: dict[str, str] = {}
    for raw in SSH_SECRET.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = _SSH_SECRET_KV_RE.match(line)
        if not m:
            continue
        key, val = m.group(1), m.group(2)
        if (val.startswith('"') and val.endswith('"')) or (
            val.startswith("'") and val.endswith("'")
        ):
            val = val[1:-1]
        merged[key] = val
    if not merged.get("HOST") or not merged.get("USER"):
        return None
    merged.setdefault("PORT", "22")
    return merged

def _ssh_argv(cred: dict, *, sudo: bool = False,
              remote_cmd: str = "") -> tuple[list[str], dict, str]:
    """Build an ssh argv that uses sshpass when a password is
    configured. Returns (argv, env, stdin) — stdin is the sudo
    password to pipe when sudo=True, else empty."""
    has_pw = bool(cred.get("PASSWORD"))
    if has_pw and not shutil.which("sshpass"):
        sys.exit(
            "sshpass missing — needed for password auth to the Pi.\n"
            "  brew install hudochenkov/sshpass/sshpass"
        )
    env = os.environ.copy()
    if has_pw:
        env["SSHPASS"] = cred["PASSWORD"]
    opts = [
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=8",
        "-p", str(cred["PORT"]),
    ]
    prefix = ["sshpass", "-e"] if has_pw else []
    target = f"{cred['USER']}@{cred['HOST']}"
    if sudo:
        wrapped = f"sudo -S -p '' bash -c {shlex.quote(remote_cmd)}"
        argv = prefix + ["ssh", *opts, target, wrapped]
        return argv, env, (cred.get("PASSWORD") or "") + "\n"
    argv = prefix + ["ssh", *opts, target, remote_cmd]
    return argv, env, ""


def _ssh_run(cred: dict, cmd: str, *, sudo: bool = False,
             capture: bool = False, check: bool = True) -> subprocess.CompletedProcess:
    argv, env, stdin = _ssh_argv(cred, sudo=sudo, remote_cmd=cmd)
    return subprocess.run(
        argv, env=env, check=check, text=True,
        capture_output=capture,
        input=stdin if sudo else None,
    )


# Tiny remote scanner: list Heltec USB-CDC devices on the Pi and their
# serial numbers (factory MACs surface as `iSerialNumber`). Mirrors what
# utils.discovery.scan_ports does locally. Uses pyserial on the Pi
# because we know it's installed there (server_bridge requirements).
_PI_SCAN_SCRIPT = r"""
import json, sys
try:
    from serial.tools import list_ports
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(0)
out = []
for p in list_ports.comports():
    # Heltec V3/V4 enumerate as ESP32-S3 USB-CDC. We only care about
    # ports that look like an ESP32-S3 (VID 0x303A, PID 0x1001 etc.).
    if p.vid in (0x303A,) or (p.product and "ESP32" in p.product.upper()):
        out.append({
            "port": p.device,
            "serial": p.serial_number or "",
            "product": p.product or "",
        })
print(json.dumps(out))
"""


def _remote_scan_pi(cred: dict, *, venv_python: str | None = None,
                    quiet: bool = False) -> list[dict]:
    """SSH into the Pi and enumerate Heltec-shaped USB serials.
    Returns a list of ``{"port", "mac", "product"}`` dicts where
    ``mac`` is the factory MAC normalised to colon-uppercase form
    (matching ``utils.discovery._normalize_mac``). Empty list if
    nothing relevant is connected or the scan errored.

    The MAC comes from pyserial's ``serial_number`` field, which for
    ESP32-S3 USB-CDC devices is the chip's factory MAC with the colons
    stripped. Heltec firmware doesn't override it, so this is reliable
    for any board flashed with stock or Titanic firmware.
    """
    py = venv_python or f"{cred.get('INSTALL_ROOT', '/opt/titanic-bridge')}/venv/bin/python"
    # Send the scan script via stdin so we don't have to escape it
    # through `ssh "<here>"`.
    argv, env, _ = _ssh_argv(cred, remote_cmd=f"{py} -")
    proc = subprocess.run(
        argv, env=env, input=_PI_SCAN_SCRIPT, text=True,
        capture_output=True, check=False,
    )
    if proc.returncode != 0:
        if not quiet:
            cprint("yellow",
                   f"  ⚠ remote scan failed (rc={proc.returncode}): "
                   f"{proc.stderr.strip()[:160]}")
        return []
    try:
        import json as _json
        items = _json.loads(proc.stdout.strip() or "[]")
    except Exception as e:
        if not quiet:
            cprint("yellow", f"  ⚠ remote scan returned non-JSON: {e}")
        return []
    if isinstance(items, dict) and items.get("error"):
        if not quiet:
            cprint("yellow", f"  ⚠ remote scanner error: {items['error']}")
        return []
    out = []
    for it in items:
        mac = _normalize_mac(it.get("serial", ""))
        if not mac:
            continue
        out.append({
            "port": it["port"],
            "mac": mac,
            "product": it.get("product", ""),
        })
    return out


def _remote_flash_build(env: str, node_id: int, node: dict) -> Path:
    """Reuse the existing build() helper but in --build-only mode so
    we get the .bin artifacts without needing a local USB target.

    Also stages ``boot_app0.bin`` into the build dir alongside the
    project-built bins. PlatformIO doesn't copy that file into the
    build output (it's a toolchain asset that lives under
    ``~/.platformio/packages/framework-arduinoespressif32/tools/
    partitions/boot_app0.bin``). When PIO flashes locally it pulls
    it from the toolchain dir directly; for the remote-flash path
    we need every offset's bin to be one rsync away.
    """
    cprint("cyan", "  [remote] building locally (PIO + ESP32 toolchain "
                   "stays on the laptop, only binaries go to the Pi)")
    if not build(env, node_id, upload_port=None, node=node):
        sys.exit("local build failed; nothing shipped to the Pi")
    build_dir = HERE / ".pio" / "build" / env

    # Stage boot_app0.bin from the framework dir into the build dir.
    boot_app0_src = (
        Path.home() / ".platformio" / "packages"
        / "framework-arduinoespressif32" / "tools" / "partitions"
        / "boot_app0.bin"
    )
    if not boot_app0_src.is_file():
        # Search the platforms tree as a fallback (older PIO layouts
        # ship boot_app0.bin under a versioned subdir).
        candidates = list(
            (Path.home() / ".platformio" / "packages").glob(
                "framework-arduinoespressif32*/tools/partitions/boot_app0.bin"
            )
        )
        if not candidates:
            sys.exit(
                "couldn't locate boot_app0.bin under ~/.platformio. "
                "Run `pio pkg install --platform espressif32` and retry."
            )
        boot_app0_src = candidates[0]
    boot_app0_dst = build_dir / "boot_app0.bin"
    if not boot_app0_dst.is_file():
        shutil.copy2(boot_app0_src, boot_app0_dst)

    for name, _ in ESP32_FLASH_OFFSETS:
        if not (build_dir / name).is_file():
            sys.exit(
                f"build dir {build_dir} missing {name}. Either the env "
                f"renamed the artifact, or the build was interrupted."
            )
    return build_dir


def _remote_flash_ship(cred: dict, build_dir: Path) -> str:
    """rsync the four .bin images to the Pi and return the remote
    images dir. Re-uses the install_root from .ssh.secret."""
    install_root = cred.get("INSTALL_ROOT", "/opt/titanic-bridge")
    remote_dir = install_root + "/firmware-images"
    # Make the dir + open it up to the runtime user.
    _ssh_run(cred,
             f"mkdir -p {shlex.quote(remote_dir)} && "
             f"chown -R {cred['USER']}:{cred['USER']} {shlex.quote(remote_dir)}",
             sudo=True)
    cprint("cyan", f"  [remote] rsync → {cred['HOST']}:{remote_dir}")
    # Build rsync argv mirroring the same SSH options we use elsewhere.
    has_pw = bool(cred.get("PASSWORD"))
    prefix = ["sshpass", "-e"] if has_pw else []
    ssh_opts = (
        f"ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 "
        f"-p {cred['PORT']}"
    )
    rsync_env = os.environ.copy()
    if has_pw:
        rsync_env["SSHPASS"] = cred["PASSWORD"]
    argv = prefix + [
        "rsync", "-a", "--rsync-path=sudo rsync",
        "-e", ssh_opts,
        *[str(build_dir / name) for name, _ in ESP32_FLASH_OFFSETS],
        f"{cred['USER']}@{cred['HOST']}:{remote_dir}/",
    ]
    subprocess.run(argv, env=rsync_env, check=True)
    return remote_dir


def _remote_flash_run(cred: dict, *, remote_port: str, remote_dir: str,
                      verify: bool, env: str, node_id: int) -> bool:
    """Stop the bridge service (releases /dev/ttyACM0), esptool flash,
    restart the bridge, verify systemd reports active. Returns True
    on success."""
    install_root = cred.get("INSTALL_ROOT", "/opt/titanic-bridge")
    venv_py = install_root + "/venv/bin/python"
    cprint("cyan", "  [remote] stop titanic-bridge.service (release "
                   f"{remote_port})")
    _ssh_run(cred, "systemctl stop titanic-bridge.service", sudo=True,
             check=False)
    # Give systemd time to actually release the file descriptor.
    # 1.5 s was occasionally racy (esptool would see the port as
    # busy on the first attempt right after a service restart);
    # 3 s buys us comfortable headroom without making the operator
    # wait long. Also poll fuser as a belt-and-braces check.
    time.sleep(3.0)
    _ssh_run(cred,
             f"fuser -k {shlex.quote(remote_port)} || true",
             sudo=True, check=False)
    time.sleep(0.5)
    cprint("cyan", "  [remote] pip install esptool (idempotent)")
    _ssh_run(cred, f"{install_root}/venv/bin/pip install --quiet "
                   "'esptool>=4.7,<5'")
    images = " ".join(
        f"{off} {shlex.quote(remote_dir + '/' + name)}"
        for name, off in ESP32_FLASH_OFFSETS
    )
    flash_cmd = (
        f"{venv_py} -m esptool --chip esp32s3 "
        f"--port {shlex.quote(remote_port)} --baud 460800 "
        "--before default_reset --after hard_reset "
        "write_flash --flash_mode dio --flash_freq 80m "
        f"--flash_size detect {images}"
    )
    cprint("cyan", f"  [remote] esptool write_flash on {cred['HOST']}")
    try:
        _ssh_run(cred, flash_cmd, check=True)
    except subprocess.CalledProcessError as exc:
        cprint("red", f"  ✗ remote flash failed: {exc}")
        # Resume the bridge anyway so the Pi isn't left with a dead
        # service alongside a half-flashed board.
        _ssh_run(cred, "systemctl restart titanic-bridge.service",
                 sudo=True, check=False)
        return False
    cprint("green", "  ✓ remote flash OK")
    cprint("cyan", "  [remote] restart titanic-bridge.service")
    _ssh_run(cred, "systemctl restart titanic-bridge.service",
             sudo=True, check=False)
    if not verify:
        return True
    time.sleep(6.0)
    proc = _ssh_run(cred, "systemctl is-active titanic-bridge.service",
                    capture=True, check=False)
    state = (proc.stdout or "").strip()
    if state == "active":
        cprint("green", f"  ✓ bridge active again after flash "
                        f"(env={env}, node=0x{node_id:02X})")
        return True
    cprint("red", f"  ✗ bridge state after flash: {state!r}")
    _ssh_run(cred, "journalctl -u titanic-bridge.service --no-pager -n 40",
             sudo=True, check=False)
    return False


def build(env: str, node_id: int, *, upload_port: str | None = None,
          node: dict | None = None) -> bool:
    """Run `pio run -e <env>` (optionally with -t upload --upload-port).
    Streams output live to the terminal so the user sees progress.

    If `node` is supplied, its `name` field is also baked into the
    firmware as `BLE_NODE_NAME` so the BLE advertisement reads
    `tcon_<name>` (e.g. `tcon_captain` for node 0x0A) instead of the
    generic per-env DEVICE_SHORT label. Names are normalised to
    lowercase and any non-`[a-z0-9_]` characters are replaced with `_`
    to keep the AD-name field BLE-spec safe.
    """
    pio = _check_pio()
    # Role drives the power-profile pin-high decision (server is
    # always HIGH). Pulled off the node dict if available; falls
    # back to looking up the env's role table for legacy callers.
    role = (node or {}).get("role")
    flags = load_radio_flags(role=role) + [f"-DNODE_ID=0x{node_id:02X}"]

    # BLE_NODE_NAME — derive from the node's `name` in .config.nodes.yaml.
    # The firmware uses this verbatim as the advertised local name,
    # prefixed with "tcon_". We sanitize aggressively because anything
    # that ends up in a BLE AD field is on the air and visible to every
    # nearby scanner; rejecting weird chars at build time means the
    # firmware can stay simple at runtime.
    if node is not None:
        raw = str(node.get("name") or "").strip().lower()
        sanitized = re.sub(r"[^a-z0-9_]", "_", raw) if raw else ""
        # Final length check: total advertised name = "tcon_" (5) + sanitized.
        # BLE complete-local-name AD overhead is 2 bytes; we put the name in a
        # scan response packet (31 bytes total), so name itself can be up to
        # 29 bytes. 24 chars for `sanitized` leaves comfortable headroom.
        if not sanitized:
            sys.exit(
                f"node 0x{node_id:02X} has empty/invalid `name` in "
                f"{NODES_YAML.name} — needed for BLE advertised name"
            )
        if len(sanitized) > 24:
            sys.exit(
                f"node 0x{node_id:02X} name {sanitized!r} too long for BLE "
                f"(max 24 chars after sanitization)"
            )
        # Build flag value must survive shell + compiler quoting. Outer
        # double quotes form the C string literal; PLATFORMIO_BUILD_FLAGS
        # is space-joined and then passed to pio, which preserves the
        # `\"` escapes through to the compiler driver.
        flags.append(f'-DBLE_NODE_NAME=\\"{sanitized}\\"')

    env_vars = os.environ.copy()
    env_vars["PLATFORMIO_BUILD_FLAGS"] = " ".join(flags)

    cmd = [pio, "run", "-e", env]
    if upload_port:
        cmd += ["-t", "upload", "--upload-port", upload_port]

    cprint("cyan", f"\n  $ {' '.join(cmd)}")
    cprint("dim",  f"  PLATFORMIO_BUILD_FLAGS={env_vars['PLATFORMIO_BUILD_FLAGS']}")
    proc = subprocess.run(cmd, cwd=str(HERE), env=env_vars)
    return proc.returncode == 0


# ── post-flash verification ────────────────────────────────────────

# Boot banners we look for, e.g. "SERVER_RX v1.3-ble-sync (node=0x01)".
_BANNER_RE = re.compile(r"^(SERVER_RX|PODIUM_TX)\s+v(\S+)(?:\s+\(node=0x([0-9a-fA-F]+)\))?")


def verify_banner(port: str, expected_env: str, expected_node: int, *, timeout_s: float = 8.0) -> bool:
    """Reset the board (RTS pulse) and read serial until we see the
    banner. Confirms (a) the firmware is the env we built and (b) the
    NODE_ID it announces matches what we asked for.
    """
    try:
        s = serial.Serial(port, 115200, timeout=0.3)
    except Exception as e:
        cprint("red", f"  ✗ cannot open {port}: {e}")
        return False
    try:
        s.setDTR(False); s.setRTS(True); time.sleep(0.1); s.setRTS(False)
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            line = s.readline().decode("utf-8", errors="replace").rstrip()
            if not line:
                continue
            m = _BANNER_RE.match(line)
            if not m:
                continue
            role_str, fw_ver, node_hex = m.group(1), m.group(2), m.group(3)
            ok_role = (role_str == "SERVER_RX" and expected_env == "server_rx") or \
                      (role_str == "PODIUM_TX" and expected_env == "podium_tx")
            ok_node = (node_hex is None) or (int(node_hex, 16) == expected_node)
            if ok_role and ok_node:
                cprint("green",
                       f"  ✓ verified: {role_str} v{fw_ver} "
                       f"node=0x{(int(node_hex,16) if node_hex else expected_node):02X}")
                return True
            cprint("red",
                   f"  ✗ banner mismatch: got {role_str} node={node_hex} "
                   f"(want env={expected_env} node=0x{expected_node:02X})")
            return False
    finally:
        s.close()
    cprint("yellow", f"  ⚠ no banner within {timeout_s:.0f}s on {port}")
    return False


# ── commands ───────────────────────────────────────────────────────

def cmd_list(args: argparse.Namespace) -> int:
    nodes = load_nodes()
    ports = heltec_ports()
    by_mac = {_normalize_mac(p["mac"]): p for p in ports}
    used_macs = set()

    cprint("bold", "\nPaired nodes (.config.nodes.yaml):")
    print(f"  {'NODE':<6} {'NAME':<20} {'ROLE':<10} {'TYPE':<12} {'USB_MAC':<19} {'PORT':<26} {'STATE'}")
    print(f"  {'─'*6} {'─'*20} {'─'*10} {'─'*12} {'─'*19} {'─'*26} {'─'*10}")
    for nid, n in sorted(nodes.items()):
        mac = n.get("usb_mac") or ""
        nmac = _normalize_mac(mac) if mac else ""
        port_info = by_mac.get(nmac)
        if nmac:
            used_macs.add(nmac)
        port_str = port_info["port"] if port_info else "—"
        if not mac:
            state = "unpaired"
            color = "yellow"
        elif port_info:
            state = "ONLINE"
            color = "green"
        else:
            state = "offline"
            color = "dim"
        line = f"  0x{nid:02X}   {n.get('name','?'):<20} {n.get('role','?'):<10} {n.get('type','?'):<12} {mac:<19} {port_str:<26}"
        print(f"{line}{C[color]}{state}{C['reset']}")

    unpaired = [p for p in ports if _normalize_mac(p["mac"]) not in used_macs]
    if unpaired:
        cprint("bold", "\nConnected boards NOT in nodes.yaml:")
        for p in unpaired:
            print(f"  {p['port']:<26} {p['mac']:<19} (vid={p['vid']} pid={p['pid']})")
    print()
    return 0


def _pick_unclaimed_board(nodes: dict, *, exclude_node: int | None = None) -> dict | None:
    """Return the (single) connected Heltec whose MAC isn't already in
    nodes.yaml, or None if zero or >1 candidates. Raises a SystemExit
    with a helpful message on the >1 case so callers don't silently
    pair the wrong board.
    """
    used = _macs_used_in_yaml(nodes, exclude_node=exclude_node)
    candidates = [p for p in heltec_ports() if _normalize_mac(p["mac"]) not in used]
    if len(candidates) > 1:
        ports_str = ", ".join(f"{p['port']}({p['mac']})" for p in candidates)
        sys.exit(
            f"multiple unclaimed Heltecs connected ({ports_str}). "
            "Disconnect all but the one to pair, or pass --pair --node 0xNN explicitly."
        )
    return candidates[0] if candidates else None


def cmd_pair(args: argparse.Namespace, target_id: int, target_node: dict) -> int:
    """Persist a usb_mac pairing for the target node. Refuses to clobber
    an existing pairing unless the user already passed --clear first.
    """
    if target_node.get("usb_mac"):
        cprint("yellow",
               f"  node 0x{target_id:02X} is already paired to {target_node['usb_mac']}. "
               f"Run --clear --node 0x{target_id:02X} first to re-bind.")
        return 1
    nodes = load_nodes()
    chosen = _pick_unclaimed_board(nodes, exclude_node=target_id)
    if chosen is None:
        sys.exit("no unclaimed Heltec connected (every visible MAC is already in nodes.yaml)")

    cprint("bold", f"\nPair node 0x{target_id:02X} ({target_node.get('name','?')}) →")
    print(f"  port: {chosen['port']}")
    print(f"  mac:  {chosen['mac']}")
    if not _confirm("  Write this MAC into .config.nodes.yaml? [y/N] ", assume_yes=args.yes):
        cprint("yellow", "  aborted")
        return 130

    write_pairing(target_id, chosen["mac"])
    cprint("green", f"  ✓ wrote usb_mac={chosen['mac']} under 0x{target_id:02X}")
    return 0


def cmd_clear(args: argparse.Namespace, target_id: int, target_node: dict) -> int:
    """Remove just one node's usb_mac pairing."""
    current = target_node.get("usb_mac")
    if not current:
        cprint("yellow", f"  node 0x{target_id:02X} has no usb_mac set; nothing to clear.")
        return 0
    if not _confirm(
        f"  Clear pairing for 0x{target_id:02X} ({target_node.get('name','?')}, "
        f"currently {current})? [y/N] ",
        assume_yes=args.yes,
    ):
        cprint("yellow", "  aborted")
        return 130
    if clear_pairing(target_id):
        cprint("green", f"  ✓ removed usb_mac from 0x{target_id:02X}")
    return 0


def cmd_clear_all(args: argparse.Namespace) -> int:
    """Wipe usb_mac from every node. Always prompts unless --yes."""
    nodes = load_nodes()
    paired = [
        (nid, n) for nid, n in sorted(nodes.items()) if n.get("usb_mac")
    ]
    if not paired:
        cprint("yellow", "  no nodes are currently paired; nothing to clear.")
        return 0
    cprint("bold", f"\nWill clear {len(paired)} pairing(s):")
    for nid, n in paired:
        print(f"  0x{nid:02X}  {n.get('name','?'):<20} {n['usb_mac']}")
    if not _confirm("  Proceed? [y/N] ", assume_yes=args.yes):
        cprint("yellow", "  aborted")
        return 130
    n = clear_all_pairings()
    cprint("green", f"  ✓ cleared {n} pairing(s)")
    return 0


def cmd_deploy_all(args: argparse.Namespace) -> int:
    """Walk every paired node and flash each one we can find on either
    side. Designed for the "I just changed C, push it everywhere"
    workflow — the same single command updates both the captain
    Heltec on the laptop AND the server Heltec on the Pi.

    Order: laptop-side first (faster, no rsync), then Pi-side. Stops
    on first failure to preserve evidence (don't leave half the
    fleet on the new firmware and half on the old).
    """
    args.yes = True   # --all is non-interactive by contract
    nodes = load_nodes()
    paired = [
        (nid, n) for nid, n in sorted(nodes.items()) if n.get("usb_mac")
    ]
    if not paired:
        cprint("yellow", "  no paired nodes; nothing to flash. Use "
                         "`--node 0xNN --pair` first.")
        return 0
    cprint("bold", f"\n--all: {len(paired)} paired node(s) to consider:")
    for nid, n in paired:
        print(f"  0x{nid:02X}  {n.get('name','?'):<14} role={n.get('role'):<8} "
              f"mac={n['usb_mac']}")

    # Snapshot both locations once so we can plan flash order without
    # bouncing back and forth.
    # Normalize on BOTH sides (strip colons, uppercase) so a YAML
    # entry like ``AA:BB:CC:DD:EE:FF`` matches the colon-less form
    # pyserial returns for ESP32-S3 serial numbers. Without this the
    # local board appears in inventory but the lookup misses it and
    # the node gets falsely reported as "not connected".
    local_macs = {_normalize_mac(p["mac"]) for p in heltec_ports()}
    cred = _load_ssh_secret()
    remote_macs: set[str] = set()
    if cred is not None:
        remote_boards = _remote_scan_pi(cred, quiet=True)
        remote_macs = {_normalize_mac(b["mac"]) for b in remote_boards}
        cprint("dim", f"  inventory: local={len(local_macs)} board(s), "
                      f"remote@{cred['HOST']}={len(remote_macs)} board(s)")
    else:
        cprint("dim", "  inventory: local-only (Pi SSH topology unavailable)")

    flashed = 0
    skipped: list[str] = []
    for nid, n in paired:
        mac = _normalize_mac(n["usb_mac"])
        if mac in local_macs:
            location = "local"
        elif mac in remote_macs:
            location = "remote"
        else:
            skipped.append(f"0x{nid:02X} {n.get('name','?')} (mac {mac} not connected)")
            continue
        cprint("bold", f"\n→ 0x{nid:02X} {n.get('name','?')} via {location}")
        rc = cmd_deploy(args, nid, n)
        if rc != 0:
            cprint("red", f"  ✗ flash failed for 0x{nid:02X} (rc={rc}); "
                          "stopping --all to preserve evidence")
            return rc
        flashed += 1

    cprint("green", f"\n✓ --all done: flashed {flashed} node(s)")
    if skipped:
        cprint("yellow", "  skipped (not currently connected):")
        for s in skipped:
            print(f"    {s}")
    return 0


def cmd_deploy(args: argparse.Namespace, target_id: int, target_node: dict) -> int:
    env = env_for_node(target_id, target_node)
    expected_mac = target_node.get("usb_mac")

    cprint("bold", f"\nTarget: node 0x{target_id:02X} "
                   f"({target_node.get('name','?')}, role={target_node.get('role')}, "
                   f"env={env})")

    if args.build_only:
        ok = build(env, target_id, upload_port=None, node=target_node)
        return 0 if ok else 1

    # ── First-time auto-pair ──────────────────────────────────────
    # If the node has no MAC yet AND exactly one connected board is
    # unclaimed by any node, offer to claim it on this deploy. This
    # is the smooth "plug in a fresh Heltec, run deploy, done" path
    # the user asked for — but we still gate on a [y/N] so we never
    # silently mutate the YAML or flash the wrong device.
    if not expected_mac:
        nodes = load_nodes()
        chosen = _pick_unclaimed_board(nodes, exclude_node=target_id)
        if chosen is None:
            sys.exit(
                f"node 0x{target_id:02X} has no `usb_mac` set in {NODES_YAML.name}, "
                "and no connected Heltec is unclaimed.\n"
                f"Plug in the target board, or run: python deploy.py --node 0x{target_id:02X} --pair"
            )
        cprint("yellow",
               f"  node 0x{target_id:02X} has no MAC pairing yet; auto-pair candidate:")
        print(f"    port: {chosen['port']}")
        print(f"    mac:  {chosen['mac']}")
        if not _confirm(
            f"  Pair 0x{target_id:02X} ({target_node.get('name','?')}) to this board "
            "and proceed to flash? [y/N] ",
            assume_yes=args.yes,
        ):
            cprint("yellow", "  aborted (no YAML written)")
            return 130
        write_pairing(target_id, chosen["mac"])
        cprint("green", f"  ✓ wrote usb_mac={chosen['mac']} under 0x{target_id:02X}")
        expected_mac = chosen["mac"]

    port_info = find_port_for_mac(expected_mac)
    if port_info:
        # ── LOCAL FLASH (target Heltec on this laptop's USB) ──────────
        port = port_info["port"]
        cprint("green", f"  ✓ MAC match (local): {expected_mac} → {port}")

        if not _confirm(f"  Flash {env} → {port}? [y/N] ", assume_yes=args.yes):
            cprint("yellow", "  aborted")
            return 130

        if not build(env, target_id, upload_port=port, node=target_node):
            cprint("red", "  ✗ flash failed")
            return 1
        cprint("green", "  ✓ flash OK")

        if args.no_verify:
            return 0
        time.sleep(1.0)
        return 0 if verify_banner(port, env, target_id) else 2

    # ── REMOTE FLASH (try the Pi) ─────────────────────────────────
    # Local USB doesn't have the target Heltec. If a Pi is configured
    # in server_bridge/.ssh.secret, query its USB too — the user's
    # workflow has the server Heltec on the Pi, and `firmware/deploy.py`
    # should "just work" for that case without a separate command.
    cred = _load_ssh_secret()
    if cred is not None and not args.no_remote:
        cprint("yellow",
               f"  MAC {expected_mac} not on this laptop's USB; "
               f"scanning Pi at {cred['HOST']}…")
        remote_boards = _remote_scan_pi(cred)
        match = next(
            (b for b in remote_boards
             if _normalize_mac(b["mac"]) == _normalize_mac(expected_mac)),
            None,
        )
        if match:
            cprint("green",
                   f"  ✓ MAC match (Pi): {expected_mac} → "
                   f"{cred['HOST']}:{match['port']}")
            if not _confirm(
                f"  Flash {env} → {cred['HOST']}:{match['port']} via Pi? [y/N] ",
                assume_yes=args.yes,
            ):
                cprint("yellow", "  aborted")
                return 130
            build_dir = _remote_flash_build(env, target_id, target_node)
            remote_dir = _remote_flash_ship(cred, build_dir)
            ok = _remote_flash_run(
                cred,
                remote_port=match["port"],
                remote_dir=remote_dir,
                verify=not args.no_verify,
                env=env, node_id=target_id,
            )
            return 0 if ok else 2

    # ── Nothing matched, anywhere — surface BOTH inventories ─────
    local = ", ".join(f"{p['port']}({p['mac']})"
                      for p in heltec_ports()) or "<none>"
    msg = (
        f"node 0x{target_id:02X} expects MAC {expected_mac} but no connected "
        f"Heltec reports that MAC.\n  local: {local}"
    )
    if cred is not None:
        remote_boards = _remote_scan_pi(cred, quiet=True)
        remote_summary = ", ".join(
            f"{cred['HOST']}:{b['port']}({b['mac']})"
            for b in remote_boards
        ) or "<none>"
        msg += f"\n  remote ({cred['HOST']}): {remote_summary}"
    msg += (
        f"\nPlug the right board in, or re-pair: "
        f"python deploy.py --node 0x{target_id:02X} --clear --yes "
        f"&& python deploy.py --node 0x{target_id:02X} --pair"
    )
    sys.exit(msg)


# ── main ───────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        prog="deploy.py",
        description="MAC-locked firmware deploy for Heltec controllers.",
    )
    ap.add_argument("--list", action="store_true", help="show pairing table + connected boards and exit")
    ap.add_argument("--node", help="target node id, e.g. 0x01")
    ap.add_argument("--role", help="target by role (must be unique), e.g. server")
    ap.add_argument("--build-only", action="store_true", help="compile only, no upload")
    ap.add_argument("--pair", action="store_true",
                    help="persist a usb_mac pairing for --node/--role (requires the lone unclaimed board to be the right one)")
    ap.add_argument("--clear", action="store_true",
                    help="remove --node/--role's usb_mac pairing from .config.nodes.yaml")
    ap.add_argument("--clear-all", action="store_true",
                    help="remove every node's usb_mac pairing (asks first)")
    ap.add_argument("--no-verify", action="store_true", help="skip post-flash banner check")
    ap.add_argument("--yes", "-y", action="store_true", help="don't prompt before flashing or editing the YAML")
    ap.add_argument(
        "--no-remote", action="store_true",
        help="Don't auto-fallback to the Pi when the target Heltec "
             "isn't on this laptop's USB. Useful when you know the "
             "board should be local and you'd rather fail loudly than "
             "ship binaries over SSH.",
    )
    ap.add_argument(
        "--all", action="store_true",
        help="Flash every paired node we can find — laptop USB and "
             "Pi-side USB (when .ssh.secret is present) — in one pass. "
             "Stops on the first failure. Implies --yes.",
    )
    args = ap.parse_args()

    if args.list:
        return cmd_list(args)

    if args.clear_all:
        # --clear-all is the only command that doesn't need a target.
        if args.node or args.role:
            sys.exit("--clear-all clears every pairing; don't pass --node/--role with it.")
        return cmd_clear_all(args)

    if args.all:
        # --all walks every paired node; ignore --node/--role for it
        # but error if the operator combined incompatible flags.
        if args.node or args.role:
            sys.exit("--all flashes every paired node; "
                     "don't pass --node/--role with it.")
        if args.pair or args.clear:
            sys.exit("--all doesn't combine with --pair / --clear.")
        return cmd_deploy_all(args)

    nodes = load_nodes()
    target_id, target_node = select_target(
        nodes,
        node_id=parse_node_arg(args.node) if args.node else None,
        role=args.role,
    )

    if args.clear:
        # --clear can be combined with --pair so the user can re-bind in
        # one shot: `deploy.py --node 0x0A --clear --pair`.
        rc = cmd_clear(args, target_id, target_node)
        if rc != 0 or not args.pair:
            return rc
        # Reload after clearing so cmd_pair sees the empty usb_mac.
        nodes = load_nodes()
        target_node = nodes[target_id]

    if args.pair:
        return cmd_pair(args, target_id, target_node)

    return cmd_deploy(args, target_id, target_node)


if __name__ == "__main__":
    sys.exit(main())
