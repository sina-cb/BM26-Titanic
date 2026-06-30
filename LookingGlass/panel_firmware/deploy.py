#!/usr/bin/env python3
"""Registry-locked flasher for the LookingGlass control-panel firmware.

This is the CANONICAL flash path. It reads the SHARED, private deployment
registry (BM26-Firmware-Deployment/deploy_allowed_macs.yaml) and only flashes a
board whose MAC is allowed for this firmware's deploy target, so you can never
flash the wrong ESP32 (e.g. a Stoker fire controller on another COM port).

    python deploy.py                 # verify the board against the registry, then flash
    python deploy.py --list          # show the target's allowed boards + what's connected
    python deploy.py --build-only    # compile only (no registry/MAC check, no upload)
    python deploy.py --target NAME   # registry deploy target (default: looking_glass)
    python deploy.py --port COMx     # force a port (still registry-verified unless --force)
    python deploy.py --pick          # interactively choose a connected board to flash
    python deploy.py --force         # skip the registry/MAC guard (emergency only)

Sources of truth (the private BM26-Firmware-Deployment repo, exposed via its
setup_env.ps1 / setup_env.sh):
  $BM26_DEPLOY_REGISTRY (or $STOKER_DEPLOY_REGISTRY)  -> deploy_allowed_macs.yaml
  $BM26_SECRETS         (or $STOKER_SECRETS)          -> secrets.yaml (build secrets)

A direct `pio run -t upload` BYPASSES this guard — always deploy through this
script. Fail-loud, no-fallback: a missing registry/env var, an unparseable
registry, an unknown target, no connected board, or no matching board all abort
with a clear message instead of guessing.

Requires: Python 3, PlatformIO (`pio`), esptool, pyserial, and PyYAML.
"""
import argparse
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PIO_ENV = "panel"
DEFAULT_TARGET = "looking_glass"
ESPRESSIF_VID = 0x303A


# --------------------------------------------------------------------------- #
#  Console helpers
# --------------------------------------------------------------------------- #
def fail(msg):
    sys.stderr.write("\n[deploy] ERROR: %s\n\n" % msg)
    sys.exit(1)


def info(msg):
    print("[deploy] %s" % msg)


def warn(msg):
    print("[deploy] WARNING: %s" % msg)


# --------------------------------------------------------------------------- #
#  Deployment registry (the BM26-Firmware-Deployment source of truth)
# --------------------------------------------------------------------------- #
def resolve_registry_path():
    """$BM26_DEPLOY_REGISTRY (or the Stoker-named var) -> the shared registry."""
    for var in ("BM26_DEPLOY_REGISTRY", "STOKER_DEPLOY_REGISTRY"):
        p = os.environ.get(var)
        if p:
            if not os.path.isfile(p):
                fail("%s is set to %r but no file exists there." % (var, p))
            return os.path.abspath(p)
    fail(
        "deployment registry not found. Set $BM26_DEPLOY_REGISTRY (or\n"
        "  $STOKER_DEPLOY_REGISTRY) to the BM26-Firmware-Deployment/\n"
        "  deploy_allowed_macs.yaml — run that repo's setup_env.ps1 / setup_env.sh."
    )


def load_registry(path):
    try:
        import yaml
    except ImportError:
        fail("PyYAML is required to read the registry. Install: python -m pip install pyyaml")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except Exception as exc:
        fail("could not parse registry %s: %s" % (path, exc))
    if not isinstance(data, dict):
        fail("registry %s did not parse to a YAML mapping" % path)
    return data


# --------------------------------------------------------------------------- #
#  MAC helpers
# --------------------------------------------------------------------------- #
_MAC_RE = re.compile(r"^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")
_PLACEHOLDER_MAC = "00:00:00:00:00:00"


def normalize_mac(raw):
    if raw is None:
        return None
    hexed = re.sub(r"[^0-9a-fA-F]", "", str(raw))
    if len(hexed) != 12:
        return None
    mac = ":".join(hexed[i:i + 2] for i in range(0, 12, 2)).lower()
    return mac if _MAC_RE.match(mac) else None


def allowed_macs_for_target(reg, target):
    """Return ({mac: controller_name} allowed, {blocked macs}) for a deploy target."""
    controllers = reg.get("controllers") or {}
    target_allow = reg.get("target_allow") or {}
    blocked = reg.get("blocked") or {}

    if target not in target_allow:
        fail("target %r is not in the registry's target_allow.\n  Known targets: %s"
             % (target, ", ".join(sorted(target_allow)) or "(none)"))

    allowed = {}
    for name in (target_allow[target] or []):
        c = controllers.get(name)
        if not isinstance(c, dict) or "mac" not in c:
            fail("target %r lists controller %r, but it has no 'mac' under controllers." % (target, name))
        mac = normalize_mac(c.get("mac"))
        if mac is None:
            fail("controller %r has an invalid MAC: %r" % (name, c.get("mac")))
        if mac == _PLACEHOLDER_MAC:
            warn("controller %r has a placeholder MAC (no board yet) — skipping." % name)
            continue
        allowed[mac] = name
    if not allowed:
        fail("target %r has no real (non-placeholder) controller MACs in the registry." % target)

    blocked_macs = set()
    if isinstance(blocked, dict):
        for c in blocked.values():
            if isinstance(c, dict):
                m = normalize_mac(c.get("mac"))
                if m:
                    blocked_macs.add(m)
    return allowed, blocked_macs


# --------------------------------------------------------------------------- #
#  Port enumeration + esptool MAC read
# --------------------------------------------------------------------------- #
def list_espressif_ports():
    try:
        from serial.tools import list_ports
    except ImportError:
        fail("pyserial not available. Install: python -m pip install pyserial")
    found = []
    for p in list_ports.comports():
        if p.vid == ESPRESSIF_VID:
            found.append({"port": p.device, "desc": p.description or ""})
    found.sort(key=lambda d: d["port"])
    return found


def read_board_mac(port):
    cmd = [sys.executable, "-m", "esptool", "--port", port, "read-mac"]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              universal_newlines=True, timeout=60)
    except FileNotFoundError:
        fail("could not launch esptool. Install: python -m pip install esptool")
    except subprocess.TimeoutExpired:
        warn("esptool timed out reading MAC on %s" % port)
        return None
    m = re.search(r"MAC:\s*([0-9A-Fa-f:]{17})", proc.stdout or "")
    if not m:
        warn("could not read a MAC on %s (esptool exit %d)" % (port, proc.returncode))
        return None
    return normalize_mac(m.group(1))


def scan_boards():
    boards = []
    for p in list_espressif_ports():
        info("reading MAC on %s (%s) ..." % (p["port"], p["desc"]))
        boards.append({"port": p["port"], "desc": p["desc"], "mac": read_board_mac(p["port"])})
    return boards


def print_table(boards, allowed, blocked):
    if not boards:
        print("  (no Espressif boards detected)")
        return
    print("  %-8s  %-17s  %-9s  %s" % ("PORT", "MAC", "ALLOWED", "WHO"))
    print("  %-8s  %-17s  %-9s  %s" % ("-" * 8, "-" * 17, "-" * 9, "-" * 20))
    for b in boards:
        mac = b["mac"] or "(unreadable)"
        if b["mac"] is None:
            status, who = "-", b["desc"]
        elif b["mac"] in blocked:
            status, who = "BLOCKED", "blocked"
        elif b["mac"] in allowed:
            status, who = "YES", allowed[b["mac"]]
        else:
            status, who = "no", b["desc"]
        print("  %-8s  %-17s  %-9s  %s" % (b["port"], mac, status, who))


# --------------------------------------------------------------------------- #
#  PlatformIO actions
# --------------------------------------------------------------------------- #
def run_pio_build():
    info("building (pio run -e %s) ..." % PIO_ENV)
    if subprocess.call(["pio", "run", "-e", PIO_ENV], cwd=HERE) != 0:
        fail("build failed")
    info("build OK")


def run_pio_upload(port):
    info("flashing %s on %s ..." % (PIO_ENV, port))
    if subprocess.call(["pio", "run", "-e", PIO_ENV, "-t", "upload", "--upload-port", port], cwd=HERE) != 0:
        fail("upload failed")
    info("flash OK on %s" % port)


def pick_board(boards):
    print()
    info("select a board to flash:")
    for i, b in enumerate(boards, 1):
        print("  [%d] %s  %s  %s" % (i, b["port"], b["mac"] or "(unreadable)", b["desc"]))
    print("  [q] quit")
    while True:
        choice = input("[deploy] choice> ").strip().lower()
        if choice in ("q", "quit", ""):
            fail("aborted by user")
        if choice.isdigit() and 1 <= int(choice) <= len(boards):
            return boards[int(choice) - 1]
        print("  invalid choice")


# --------------------------------------------------------------------------- #
#  Main
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(
        description="Registry-locked flasher for the LookingGlass panel firmware.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--list", action="store_true",
                    help="print the target's allowed boards + connected boards; no flash")
    ap.add_argument("--build-only", action="store_true",
                    help="compile only — no registry/MAC check, no upload")
    ap.add_argument("--target", default=DEFAULT_TARGET,
                    help="registry deploy target (default: %s)" % DEFAULT_TARGET)
    ap.add_argument("--port", metavar="COMx",
                    help="force a port (still registry-verified unless --force)")
    ap.add_argument("--pick", action="store_true",
                    help="interactively choose a connected board to flash")
    ap.add_argument("--force", action="store_true",
                    help="skip the registry/MAC guard (emergency only — prints a loud warning)")
    args = ap.parse_args()

    # --build-only: no registry, no hardware, no upload.
    if args.build_only:
        run_pio_build()
        return

    # --force: skip the registry guard entirely.
    if args.force:
        warn("===========  REGISTRY / MAC GUARD DISABLED (--force)  ===========")
        warn("Flashing WITHOUT verifying the board against the registry. This can")
        warn("flash the WRONG board (e.g. a Stoker controller). Be certain.")
        warn("=================================================================")
        if args.port:
            target_port = args.port
        else:
            boards = scan_boards()
            if not boards:
                fail("no Espressif board detected to flash.")
            if len(boards) == 1:
                target_port = boards[0]["port"]
            elif args.pick:
                target_port = pick_board(boards)["port"]
            else:
                print()
                print_table(boards, {}, set())
                fail("multiple boards and --force without --port/--pick; specify --port COMx or --pick.")
        run_pio_build()
        run_pio_upload(target_port)
        return

    reg = load_registry(resolve_registry_path())
    allowed, blocked = allowed_macs_for_target(reg, args.target)
    controllers = reg.get("controllers") or {}

    # --list: report and exit.
    if args.list:
        info("deploy target: %s" % args.target)
        info("allowed boards (from the registry):")
        for mac, name in sorted(allowed.items(), key=lambda kv: kv[1]):
            ip = (controllers.get(name) or {}).get("ip", "?")
            print("    %-22s %s  ip=%s" % (name, mac, ip))
        print()
        info("connected Espressif boards:")
        print_table(scan_boards(), allowed, blocked)
        return

    info("deploy target: %s  (allowed: %s)" % (args.target, ", ".join(sorted(allowed.values()))))

    # --port COMx (verified): require that port's MAC to be allowed.
    if args.port:
        mac = read_board_mac(args.port)
        if mac is None:
            fail("could not read a MAC on %s. Is a board connected and not held by another tool?" % args.port)
        if mac in blocked:
            fail("board on %s (%s) is BLOCKED in the registry." % (args.port, mac))
        if mac not in allowed:
            print()
            print_table([{"port": args.port, "desc": "", "mac": mac}], allowed, blocked)
            fail("board on %s has MAC %s, NOT allowed for target %r.\n"
                 "  -> use the right --target, register the board in BM26-Firmware-Deployment,\n"
                 "     or override for THIS flash with --force." % (args.port, mac, args.target))
        info("MAC match on %s (%s = %s)" % (args.port, mac, allowed[mac]))
        run_pio_build()
        run_pio_upload(args.port)
        return

    # Default: enumerate, verify against the registry, flash the unique allowed match.
    boards = scan_boards()
    if not boards:
        fail("no Espressif (VID 303A) board detected. Connect the panel over USB-C and retry.")

    matches = [b for b in boards if b["mac"] in allowed and b["mac"] not in blocked]

    if len(matches) == 1:
        b = matches[0]
        info("MAC match: %s (%s) on %s" % (b["mac"], allowed[b["mac"]], b["port"]))
        run_pio_build()
        run_pio_upload(b["port"])
        return

    if len(matches) > 1:
        print()
        print_table(boards, allowed, blocked)
        fail("more than one connected board is allowed for %r — use --port COMx to choose." % args.target)

    # No allowed board connected.
    print()
    info("target %r allows: %s" % (args.target, ", ".join(sorted(allowed.values()))))
    info("connected boards (NONE allowed for this target):")
    print_table(boards, allowed, blocked)
    print()
    if args.pick:
        warn("no connected board is allowed for this target; you are about to flash a NON-allowed board.")
        b = pick_board(boards)
        if b["mac"] is None:
            fail("selected board's MAC is unreadable; cannot flash safely.")
        if b["mac"] in blocked:
            fail("selected board is BLOCKED in the registry.")
        warn("flashing %s (%s) which is NOT in target %r." % (b["port"], b["mac"], args.target))
        run_pio_build()
        run_pio_upload(b["port"])
        return

    fail("no connected board matches an allowed MAC for target %r.\n"
         "  -> check the board / the --target, or register it in BM26-Firmware-Deployment." % args.target)


if __name__ == "__main__":
    main()
