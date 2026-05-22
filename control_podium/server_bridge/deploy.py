"""server_bridge.deploy — push the bridge to a Raspberry Pi.

SSH credentials are read from ``server_bridge/.ssh.secret`` (gitignored;
copy from ``.ssh.secret.example``). Required keys: HOST, USER,
INSTALL_ROOT. Optional: PORT (default 22), PASSWORD, ENGINE_URL.


  1. SSH smoke-test (host reachable, sudo available).
  2. ``apt`` ensures ``python3-venv``, ``rsync``, and ``socat`` are
     installed on the Pi.
  3. ``rsync`` the bare minimum from ``control_podium/`` and
     ``marsin_engine/secret.yaml`` to ``INSTALL_ROOT`` on the Pi.
     Excludes dev-only directories (PortWatch, tests, __pycache__,
     deploy artifacts) so the on-Pi tree stays tiny.
  4. Build / refresh a venv at ``INSTALL_ROOT/venv`` and pip-install
     ``server_bridge/requirements.txt``.
  5. Template the systemd unit (filling in install paths + user)
     and install it to ``/etc/systemd/system/titanic-bridge.service``.
  6. Add the runtime user to the ``dialout`` group so it can open
     ``/dev/ttyACM0`` without sudo.
  7. ``systemctl daemon-reload && enable --now titanic-bridge``.
  8. Verify the unit is ``active (running)`` for at least 5 seconds
     and tail the last 30 journal lines so the operator can sanity-
     check the boot banner.

Optional firmware flash mode (``--firmware``)
---------------------------------------------
A second top-level mode reuses the same SSH session to ALSO flash
the server-side Heltec from the Pi. This is the canonical path for
updating the server controller's firmware in the field — the client
Heltec is connected to the dev laptop and is flashed directly with
``firmware/deploy.py``, but the server Heltec lives on the Pi and
can only be reached over USB-CDC FROM the Pi.

The flash mode:

  A. Builds the server image on the LAPTOP (where PIO + the ESP32
     toolchain already live) via ``firmware/deploy.py --node 0x01
     --build-only``. Builds locally to avoid having to install
     ~500 MB of PIO toolchain on every Pi.
  B. Collects the four ESP32 images from ``.pio/build/server_rx/``
     (bootloader, partitions, boot_app0, firmware).
  C. rsync's them to ``INSTALL_ROOT/firmware-images/`` on the Pi.
  D. Installs ``esptool`` into the Pi's venv (small, ~5 MB).
  E. Stops the bridge service to release /dev/ttyACM0.
  F. Flashes the four images at the standard ESP32 offsets with
     ``esptool write_flash``.
  G. Restarts the bridge service and verifies the new boot banner
     in the journal.

The flash mode can be combined with a code deploy (``--firmware``
alone runs steps 1+A-G and skips the bridge-code rsync), or
combined explicitly with ``--code --firmware`` to do both.

Idempotent. Re-running just rsyncs the latest code, re-pins deps if
``requirements.txt`` changed, and restarts the service. Designed for
``ssh + sshpass`` because the operator gave us a password — when
keys are in place, the same script works with ``sshpass`` absent
(it tries ``ssh`` directly).

Quick smoke test of the deployed unit:

    python -m control_podium.server_bridge.deploy --verify-only

That skips the rsync / systemctl steps and just checks the unit is
running. Use it to confirm the Pi recovered from a reboot or SSH
hiccup without re-uploading code.
"""
from __future__ import annotations

import argparse
import os
import re
import shlex
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Optional

HERE = Path(__file__).resolve().parent
CP_ROOT = HERE.parent           # .../control_podium
REPO_ROOT = CP_ROOT.parent      # .../BM26-Titanic
SECRET_FILE = HERE / ".ssh.secret"
SYSTEMD_TEMPLATE = HERE / "systemd" / "titanic-bridge.service"
UNIT_NAME = "titanic-bridge.service"

if str(CP_ROOT) not in sys.path:
    sys.path.insert(0, str(CP_ROOT))


# ── credentials: network topology + optional .ssh.secret overlays ─────────


_SHELL_KV_RE = re.compile(r"^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$")


def _parse_shell_kv_file(path: Path) -> dict[str, str]:
    """Parse a shell-style KEY=VALUE file (comments + blanks ignored)."""
    out: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = _SHELL_KV_RE.match(line)
        if not m:
            continue
        key, val = m.group(1), m.group(2)
        if (val.startswith('"') and val.endswith('"')) or (
            val.startswith("'") and val.endswith("'")
        ):
            val = val[1:-1]
        out[key] = val
    return out


def _load_deploy_credentials(secret_path: Path) -> dict[str, str]:
    """Load Pi SSH credentials from ``server_bridge/.ssh.secret``.

    Required: HOST, USER, INSTALL_ROOT. Optional: PORT (default 22),
    PASSWORD (for sshpass), ENGINE_URL (systemd override).
    """
    if not secret_path.is_file():
        sys.exit(
            f"missing {secret_path} — copy `.ssh.secret.example` and fill in "
            f"HOST / USER / INSTALL_ROOT (+ optional PORT / PASSWORD / ENGINE_URL)."
        )
    merged = _parse_shell_kv_file(secret_path)
    merged.setdefault("PORT", "22")

    missing = [req for req in ("HOST", "USER", "INSTALL_ROOT") if not merged.get(req)]
    if missing:
        sys.exit(
            f"deploy SSH cred is incomplete in {secret_path}: missing "
            f"{', '.join(missing)}."
        )
    if merged.get("ENGINE_URL"):
        parsed = urllib.parse.urlparse(merged["ENGINE_URL"])
        if parsed.scheme not in ("http", "https"):
            sys.exit(f"ENGINE_URL must be http(s), got {merged['ENGINE_URL']!r}")
    return merged


# ── ssh / scp / rsync wrappers ────────────────────────────────────────


class SSHRunner:
    """Thin command-runner that picks ``sshpass`` automatically when a
    password is configured, and falls back to direct ``ssh`` (for key
    auth) when ``PASSWORD`` is empty."""

    def __init__(self, cred: dict[str, str]):
        self.host = cred["HOST"]
        self.port = cred["PORT"]
        self.user = cred["USER"]
        self.password = cred.get("PASSWORD") or ""
        self._use_sshpass = bool(self.password)
        if self._use_sshpass and not _which("sshpass"):
            sys.exit(
                "sshpass is required for password auth but isn't installed.\n"
                "Install it (`brew install hudochenkov/sshpass/sshpass` on "
                "macOS, `apt install sshpass` on Debian) — or switch to key "
                "auth by leaving PASSWORD empty in .ssh.secret and pre-"
                "copying your public key with `ssh-copy-id`."
            )
        self.ssh_opts = [
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", "ConnectTimeout=10",
            "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=3",
            "-p", str(self.port),
        ]

    def _env(self) -> dict[str, str]:
        env = os.environ.copy()
        if self._use_sshpass:
            env["SSHPASS"] = self.password
        return env

    def _argv_prefix(self) -> list[str]:
        return ["sshpass", "-e"] if self._use_sshpass else []

    def run(self, remote_cmd: str, *, check: bool = True,
            capture: bool = False, quiet: bool = False) -> subprocess.CompletedProcess:
        argv = (
            self._argv_prefix()
            + ["ssh", *self.ssh_opts, f"{self.user}@{self.host}", remote_cmd]
        )
        if not quiet:
            print(f"  ssh> {remote_cmd}")
        return subprocess.run(
            argv,
            env=self._env(),
            check=check,
            text=True,
            capture_output=capture,
        )

    def sudo(self, remote_cmd: str, **kw) -> subprocess.CompletedProcess:
        # Pipe the password into sudo over stdin. The `-S` flag tells
        # sudo to read the password from stdin rather than the tty.
        wrapped = f"sudo -S -p '' bash -c {shlex.quote(remote_cmd)}"
        if not kw.get("quiet"):
            print(f"  ssh> sudo {remote_cmd}")
        argv = (
            self._argv_prefix()
            + ["ssh", *self.ssh_opts, f"{self.user}@{self.host}", wrapped]
        )
        return subprocess.run(
            argv,
            env=self._env(),
            input=self.password + "\n",
            check=kw.get("check", True),
            text=True,
            capture_output=kw.get("capture", False),
        )

    def rsync(self, sources: list[Path], remote_dest: str, *,
              excludes: list[str]) -> None:
        # `--rsync-path="sudo rsync"` lets us write into a root-owned
        # /opt directory without a separate sudo dance.
        ex = []
        for e in excludes:
            ex += ["--exclude", e]
        argv = (
            self._argv_prefix()
            + [
                "rsync", "-a", "--delete",
                "--rsync-path=sudo rsync",
                "-e", "ssh " + " ".join(shlex.quote(o) for o in self.ssh_opts),
                *ex,
                *[str(s) for s in sources],
                f"{self.user}@{self.host}:{remote_dest}",
            ]
        )
        print(
            "  rsync> "
            + " → ".join(str(s) for s in sources)
            + f" → {remote_dest}"
        )
        subprocess.run(argv, env=self._env(), check=True)


def _which(cmd: str) -> Optional[str]:
    for p in os.environ.get("PATH", "").split(":"):
        full = Path(p) / cmd
        if full.is_file() and os.access(full, os.X_OK):
            return str(full)
    return None


# ── pipeline steps ────────────────────────────────────────────────────


def _step_smoke(ssh: SSHRunner) -> None:
    print("[1/8] SSH smoke test")
    r = ssh.run("uname -srm && id -un && which python3 systemctl rsync || true",
                capture=True)
    print(r.stdout.rstrip())
    # Verify sudo works (passwordless or via our injected password).
    print("       sudo check…")
    r = ssh.sudo("echo sudo_ok", capture=True)
    if "sudo_ok" not in (r.stdout or ""):
        sys.exit(
            "sudo isn't working for this user. Either grant passwordless "
            "sudo or make sure the PASSWORD in .ssh.secret is correct."
        )


def _step_apt(ssh: SSHRunner) -> None:
    print("[2/8] apt — ensure python3-venv + rsync installed")
    # `apt-get update` is the slow part — skip if cache is < 24 h old.
    cmd = (
        "if [ ! -d /var/lib/apt/lists ] || "
        "[ $(find /var/lib/apt/lists -maxdepth 0 -mtime -1 | wc -l) -eq 0 ]; "
        "then apt-get update -qq; fi && "
        "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "
        "python3-venv python3-pip rsync"
    )
    ssh.sudo(cmd)


def _step_rsync_repo(ssh: SSHRunner, install_root: str) -> None:
    print(f"[3/8] rsync code → {install_root}")
    # Ensure the install root exists and is owned by the runtime user.
    ssh.sudo(
        f"mkdir -p {shlex.quote(install_root)} && "
        f"chown -R {ssh.user}:{ssh.user} {shlex.quote(install_root)}"
    )

    # Curate exactly what the bridge needs at runtime. Anything not
    # listed is left behind, keeping the Pi tree tiny and unrelated
    # dev tooling out of the picture.
    excludes = [
        "__pycache__/",
        "*.pyc",
        ".DS_Store",
        "PortWatch/",
        "tests/",
        "firmware/",       # flashing tools — flash from the laptop
        "companions/__pycache__/",
        ".vscode/",
        ".idea/",
        "node_modules/",
        ".ssh.secret",     # never push the laptop's creds to the Pi
    ]

    # Push two trees: control_podium/ (minus excludes), and
    # marsin_engine/secret.yaml (the shared AES key the bridge needs).
    ssh.rsync(
        sources=[CP_ROOT],
        remote_dest=install_root + "/",
        excludes=excludes,
    )
    # marsin_engine/secret.yaml lives outside control_podium/. Ship
    # the single file rather than the whole engine repo.
    secret_src = REPO_ROOT / "marsin_engine" / "secret.yaml"
    if not secret_src.exists():
        sys.exit(
            f"missing {secret_src}. The bridge needs the shared-channel "
            "AES key — generate it on the laptop with the engine setup "
            "scripts before deploying."
        )
    ssh.sudo(f"mkdir -p {shlex.quote(install_root)}/marsin_engine")
    ssh.rsync(
        sources=[secret_src],
        remote_dest=install_root + "/marsin_engine/secret.yaml",
        excludes=[],
    )

    # Also ship docs/22 so the systemd unit's Documentation= URL
    # resolves on the Pi.
    docs_src = REPO_ROOT / "docs" / "22_server_bridge.md"
    if docs_src.exists():
        ssh.sudo(f"mkdir -p {shlex.quote(install_root)}/docs")
        ssh.rsync(
            sources=[docs_src],
            remote_dest=install_root + "/docs/22_server_bridge.md",
            excludes=[],
        )


def _step_venv(ssh: SSHRunner, install_root: str) -> None:
    print("[4/8] venv + pip install requirements")
    venv = install_root + "/venv"
    req = install_root + "/control_podium/server_bridge/requirements.txt"
    cmd = (
        f"if [ ! -x {venv}/bin/python ]; then "
        f"  python3 -m venv {venv}; "
        f"fi && "
        f"{venv}/bin/pip install --quiet --upgrade pip && "
        f"{venv}/bin/pip install --quiet -r {req}"
    )
    ssh.run(cmd)


def _step_dialout(ssh: SSHRunner) -> None:
    print("[5/8] add user to dialout (USB serial access) + state dir")
    ssh.sudo(f"usermod -aG dialout {ssh.user}")
    # Bridge persists the last-applied LoRa profile here so a restart
    # comes back on the same profile the operator left it on. Read-only
    # if missing; bridge tolerates the failure but the operator loses
    # the persistence on every redeploy.
    ssh.sudo(
        "mkdir -p /var/lib/titanic-bridge "
        f"&& chown {shlex.quote(ssh.user)}:{shlex.quote(ssh.user)} /var/lib/titanic-bridge"
    )


def _step_install_unit(ssh: SSHRunner, install_root: str,
                       engine_url: str) -> None:
    print(f"[6/8] systemd unit → /etc/systemd/system/{UNIT_NAME}")
    # Read the template, fill in placeholders, ship.
    tmpl = SYSTEMD_TEMPLATE.read_text(encoding="utf-8")

    # Find what serial device path systemd should wait on. The
    # default `/dev/ttyACM0` is sufficient when only one Heltec is
    # plugged into the Pi. The `dev-ttyACM0.device` form is the
    # systemd-escaped path; we always use ttyACM0 since that's the
    # canonical kernel name for ESP32-S3 USB-CDC on Linux.
    serial_dev = "ttyACM0"

    rendered = (
        tmpl
        .replace("${INSTALL_ROOT}", install_root)
        .replace("${BRIDGE_USER}", ssh.user)
        .replace("${SERIAL_DEV_ESCAPED}", serial_dev)
    )

    # Optional explicit --engine flag from the .ssh.secret ENGINE_URL
    # override. If unset, the bridge falls back to
    # .config.bridge.yaml::engine.url on the Pi.
    if engine_url:
        rendered = rendered.replace(
            "--bus serial -v",
            f"--bus serial --engine {shlex.quote(engine_url)} -v",
        )

    # Push via a tmp file on the Pi, then sudo-move into place.
    tmp_remote = f"/tmp/{UNIT_NAME}.staged"
    encoded = rendered.encode("utf-8")
    # Use `tee` over stdin so we don't have to scp.
    argv = (
        ssh._argv_prefix()
        + ["ssh", *ssh.ssh_opts, f"{ssh.user}@{ssh.host}",
           f"cat > {tmp_remote}"]
    )
    print(f"  ssh> cat > {tmp_remote}  ({len(encoded)} bytes)")
    proc = subprocess.run(argv, env=ssh._env(), input=encoded, check=True)
    ssh.sudo(
        f"mv {tmp_remote} /etc/systemd/system/{UNIT_NAME} && "
        f"chmod 644 /etc/systemd/system/{UNIT_NAME}"
    )


def _step_enable(ssh: SSHRunner) -> None:
    print(f"[7/8] systemctl daemon-reload + enable --now {UNIT_NAME}")
    ssh.sudo(
        "systemctl daemon-reload && "
        f"systemctl enable --now {UNIT_NAME} && "
        # Force a restart so a code-only change actually picks up.
        f"systemctl restart {UNIT_NAME}"
    )


# ── firmware flash pipeline ──────────────────────────────────────────


# ESP32 standard partition offsets. These match what `pio run -t upload`
# emits under the hood for the heltec_wifi_lora_32_V3 board with the
# default Arduino partition table. The boot_app0 image is the 8 KB OTA
# selector — including it makes the flash deterministic regardless of
# whether the previous firmware was an OTA build or a direct flash.
_ESP32_FLASH_OFFSETS = [
    ("bootloader.bin", "0x0"),
    ("partitions.bin", "0x8000"),
    ("boot_app0.bin",  "0xe000"),
    ("firmware.bin",   "0x10000"),
]
_SERVER_PIO_ENV = "server_rx"
_SERVER_NODE_ID = "0x01"


def _step_fw_build_local() -> Path:
    """Build the server firmware on the laptop via the existing
    ``firmware/deploy.py --build-only`` path. Returns the directory
    containing the four .bin images.

    Done locally rather than on the Pi for two reasons:
      1. PIO + the ESP32 toolchain is ~500 MB; the Pi gets a tiny
         install (esptool only).
      2. The build is much faster on a modern laptop (~30 s) than on
         a Pi (~5+ min). For a fast-iteration deploy cycle that
         matters.
    """
    print("[fw 1/6] build server image (laptop, pio run -e server_rx)")
    fw_deploy = CP_ROOT / "firmware" / "deploy.py"
    if not fw_deploy.is_file():
        sys.exit(f"missing {fw_deploy} — can't build firmware")
    # Use the same Python that's running this script so the laptop's
    # dev venv (which has pio installed) is picked up automatically.
    cmd = [
        sys.executable, str(fw_deploy),
        "--node", _SERVER_NODE_ID, "--build-only",
    ]
    print(f"  $ {' '.join(cmd)}")
    proc = subprocess.run(cmd, cwd=str(CP_ROOT / "firmware"))
    if proc.returncode != 0:
        sys.exit(
            f"firmware build failed (rc={proc.returncode}). Check the "
            "PIO output above; nothing has been shipped to the Pi."
        )
    build_dir = CP_ROOT / "firmware" / ".pio" / "build" / _SERVER_PIO_ENV
    missing = [n for n, _ in _ESP32_FLASH_OFFSETS
               if not (build_dir / n).is_file()]
    if missing:
        sys.exit(
            f"build succeeded but {missing} not found in {build_dir}. "
            "Check the PIO output for partition-table or bootloader "
            "name overrides."
        )
    return build_dir


def _step_fw_ship_images(ssh: SSHRunner, install_root: str,
                         build_dir: Path) -> str:
    """rsync the four .bin images to ``INSTALL_ROOT/firmware-images/``
    on the Pi. Returns the remote directory path."""
    remote_dir = install_root + "/firmware-images"
    print(f"[fw 2/6] rsync images → {remote_dir}")
    ssh.sudo(
        f"mkdir -p {shlex.quote(remote_dir)} && "
        f"chown -R {ssh.user}:{ssh.user} {shlex.quote(remote_dir)}"
    )
    sources = [build_dir / n for n, _ in _ESP32_FLASH_OFFSETS]
    ssh.rsync(sources=sources, remote_dest=remote_dir + "/", excludes=[])
    return remote_dir


def _step_fw_install_esptool(ssh: SSHRunner, install_root: str) -> None:
    """Install ``esptool`` into the Pi's venv. Pinned to a recent
    stable version that supports the ESP32-S3 stub flasher."""
    print("[fw 3/6] pip install esptool (Pi venv)")
    venv_pip = install_root + "/venv/bin/pip"
    ssh.run(f"{venv_pip} install --quiet 'esptool>=4.7,<5'")


def _step_fw_stop_bridge(ssh: SSHRunner) -> None:
    """Stop the bridge service so esptool can claim /dev/ttyACM0.
    The supervisor's serial-reopen path means the service will
    happily come back the moment we restart it post-flash."""
    print("[fw 4/6] stop bridge service (release /dev/ttyACM0)")
    ssh.sudo(f"systemctl stop {UNIT_NAME}")
    # Give the kernel a moment to release the cdc-acm endpoint —
    # without this, esptool occasionally fails the first probe with
    # `OSError: [Errno 16] Device or resource busy`.
    time.sleep(1.5)


def _step_fw_flash(ssh: SSHRunner, install_root: str,
                   remote_dir: str) -> None:
    """Run ``esptool write_flash`` on the Pi with the four images."""
    print("[fw 5/6] esptool write_flash /dev/ttyACM0")
    venv_py = install_root + "/venv/bin/python"
    images = " ".join(
        f"{off} {shlex.quote(remote_dir + '/' + name)}"
        for name, off in _ESP32_FLASH_OFFSETS
    )
    # esptool flags:
    #   --chip esp32s3       Heltec V4 is ESP32-S3.
    #   --port /dev/ttyACM0  USB-CDC on the Pi.
    #   --baud 460800        Conservative for USB-CDC; 921600 sometimes
    #                        drops on long USB cables to the road case.
    #   write_flash          Write the listed offset/file pairs.
    #   --flash_mode dio     Match the PIO build's default.
    #   --flash_freq 80m     Match the PIO build's default.
    #   --flash_size detect  Read the actual SPI flash size at runtime
    #                        rather than baking it in.
    cmd = (
        f"{venv_py} -m esptool "
        f"--chip esp32s3 --port /dev/ttyACM0 --baud 460800 "
        f"--before default_reset --after hard_reset "
        f"write_flash --flash_mode dio --flash_freq 80m --flash_size detect "
        f"{images}"
    )
    ssh.run(cmd)


def _step_fw_resume_bridge(ssh: SSHRunner, *, settle_s: float = 6.0) -> None:
    """Start the bridge back up and verify it picks up the new
    firmware cleanly. Slightly longer settle than the code-deploy
    path because the freshly-flashed Heltec takes ~3 s to boot
    its BLE stack before /dev/ttyACM0 stabilises."""
    print(f"[fw 6/6] restart bridge service and verify (settle {settle_s:.0f}s)")
    ssh.sudo(f"systemctl restart {UNIT_NAME}")
    time.sleep(settle_s)
    r = ssh.run(f"systemctl is-active {UNIT_NAME}", capture=True, check=False)
    state = (r.stdout or "").strip()
    print(f"  systemctl is-active → {state!r}")
    if state != "active":
        ssh.sudo(f"journalctl -u {UNIT_NAME} --no-pager -n 60", check=False)
        sys.exit(
            f"bridge failed to come back after firmware flash "
            f"(state={state!r}); see journal above"
        )
    # Surface the boot banner from the journal so the operator can
    # confirm the new firmware is live (firmware prints "SERVER_RX
    # vX.Y (node=0x01)" on every cold boot — invaluable for verifying
    # the right env reached the right board).
    ssh.sudo(f"journalctl -u {UNIT_NAME} --no-pager -n 25", check=False)


def _step_verify(ssh: SSHRunner, *, settle_s: float = 5.0) -> None:
    print(f"[8/8] verify (settle {settle_s:.0f}s, then status + journal)")
    time.sleep(settle_s)
    # Status — `is-active` returns non-zero if the unit isn't running,
    # which we want to surface clearly.
    r = ssh.run(f"systemctl is-active {UNIT_NAME}", capture=True, check=False)
    state = (r.stdout or "").strip()
    print(f"  systemctl is-active → {state!r}")
    if state != "active":
        # Dump the journal so the operator can see WHY.
        ssh.sudo(
            f"journalctl -u {UNIT_NAME} --no-pager -n 60",
            check=False,
        )
        sys.exit(f"bridge failed to come up (state={state!r}); see journal above")
    # Tail recent log lines so the boot banner is visible.
    ssh.sudo(f"journalctl -u {UNIT_NAME} --no-pager -n 30", check=False)
    print()
    print(f"  ✓ {UNIT_NAME} is active and running on the Pi.")


# ── top-level pipeline ───────────────────────────────────────────────


def deploy(*, verify_only: bool = False, code: bool = True,
           firmware: bool = False, settle_s: float = 5.0) -> None:
    """Top-level pipeline.

    Three operating modes, driven from ``server_bridge/.ssh.secret``:

      * Code deploy (default, ``code=True, firmware=False``)
        — rsync bridge code, install systemd unit, restart service.
      * Firmware-only (``code=False, firmware=True``)
        — build server image on laptop, ship binaries, flash via
          esptool on the Pi. Bridge service is bounced around the
          flash so /dev/ttyACM0 is free.
      * Both (``code=True, firmware=True``)
        — code first, then firmware. The order matters because the
          new bridge code might need the new firmware features.
      * Verify-only (``verify_only=True``)
        — skips everything except the health check. Useful after a
          power cycle or SSH bounce.
    """
    cred = _load_deploy_credentials(SECRET_FILE)
    ssh = SSHRunner(cred)
    install_root = cred["INSTALL_ROOT"]
    # Optional systemd Environment= override; bridge falls back to
    # .config.bridge.yaml::engine.url when ENGINE_URL is unset.
    engine_http = cred.get("ENGINE_URL")

    _step_smoke(ssh)
    if verify_only:
        _step_verify(ssh, settle_s=0.1)
        return

    if code:
        _step_apt(ssh)
        _step_rsync_repo(ssh, install_root)
        _step_venv(ssh, install_root)
        _step_dialout(ssh)
        _step_install_unit(ssh, install_root, engine_http)
        _step_enable(ssh)
        _step_verify(ssh, settle_s=settle_s)

    if firmware:
        # Build is local: requires PIO on the laptop, NOT on the Pi.
        build_dir = _step_fw_build_local()
        # If we just deployed code, the venv exists. If firmware-only
        # mode and the venv doesn't exist yet, make sure the bridge
        # package is at least installed so esptool can be added.
        if not code:
            _step_apt(ssh)
            _step_venv(ssh, install_root)
        remote_images = _step_fw_ship_images(ssh, install_root, build_dir)
        _step_fw_install_esptool(ssh, install_root)
        _step_fw_stop_bridge(ssh)
        try:
            _step_fw_flash(ssh, install_root, remote_images)
        finally:
            # Always try to bring the bridge back, even if the flash
            # failed — otherwise a failed flash leaves the unit
            # stopped and PortWatch with no bridge.
            _step_fw_resume_bridge(ssh, settle_s=settle_s + 1.0)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(
        prog="python -m server_bridge.deploy",
        description="Deploy the Titanic server bridge to a Raspberry Pi "
                    "(code, firmware, or both).",
    )
    p.add_argument(
        "--verify-only", action="store_true",
        help="Skip rsync / install / restart / flash; just check the "
             "deployed unit is `active (running)` and dump the last "
             "30 journal lines.",
    )
    p.add_argument(
        "--firmware", action="store_true",
        help="Also build the server-Heltec firmware on this laptop, "
             "ship the four .bin images to the Pi, and flash them "
             "via esptool. The bridge service is stopped during the "
             "flash and restarted after.",
    )
    p.add_argument(
        "--firmware-only", action="store_true",
        help="Shortcut for `--firmware` with the code-deploy steps "
             "skipped. Use when you only changed C and want to push "
             "a fresh image without re-rsync'ing the Python bridge.",
    )
    p.add_argument(
        "--settle", type=float, default=5.0,
        help="Seconds to wait after `systemctl restart` before checking "
             "is-active (default 5s — covers Pi boot + venv import).",
    )
    args = p.parse_args(argv)
    do_code = not args.firmware_only
    do_fw = args.firmware or args.firmware_only
    try:
        deploy(
            verify_only=args.verify_only,
            code=do_code,
            firmware=do_fw,
            settle_s=args.settle,
        )
    except subprocess.CalledProcessError as exc:
        sys.exit(f"deploy step failed: {exc}")


if __name__ == "__main__":
    main()
