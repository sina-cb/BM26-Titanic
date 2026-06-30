#!/usr/bin/env python3
"""MAC-locked flasher for the LookingGlass control-panel firmware.

This is the CANONICAL flash path. It ALWAYS verifies the connected board's
ESP32 MAC against the deploy-target MAC in ../secrets.yaml (key device.mac)
before flashing, so you can never flash the wrong board by accident.

    python deploy.py            # detect, verify MAC, then flash the match
    python deploy.py --list     # show expected MAC + connected boards (no flash)
    python deploy.py --pair     # write the single connected board's MAC into
                                #   secrets.yaml, then flash it
    python deploy.py --build-only          # compile only (no MAC check, no upload)
    python deploy.py --port COM7           # force a port, still verify its MAC
    python deploy.py --port COM7 --force   # force a port, SKIP the MAC guard (!)
    python deploy.py --pick                # interactively choose a board to flash
    python deploy.py --force               # skip the MAC guard entirely (emergency)

NOTE: a direct `pio run -t upload` BYPASSES this guard. Always deploy through
this script so the MAC lock is enforced.

SECRETS LOCATION: device.mac (and, at build time, wifi/ap) live in secrets.yaml.
Set the env var $PANEL_SECRETS to a single file OUTSIDE the worktree to share one
gitignored secret across every worktree/branch; if unset, the worktree-local
LookingGlass/secrets.yaml is used.

Fail-loud, no-fallback policy: a missing secrets.yaml, a missing/empty
device.mac, an unparseable YAML file, no connected board, or no matching
board all abort with a clear message instead of guessing.

Requires: Python 3, PlatformIO (`pio`), esptool (`python -m esptool`),
and pyserial (ships with PlatformIO's penv). PyYAML is optional — a tiny
built-in reader handles device.mac when PyYAML is not installed.
"""
import argparse
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOOKINGGLASS_DIR = os.path.abspath(os.path.join(HERE, ".."))
# The deploy-target secret can be SHARED across worktrees: point $PANEL_SECRETS
# at a single file outside the tree and every worktree/branch reads the same one
# (so the gitignored secret is never duplicated per worktree). Falls back to the
# worktree-local LookingGlass/secrets.yaml when PANEL_SECRETS is unset.
LOCAL_SECRETS = os.path.join(LOOKINGGLASS_DIR, "secrets.yaml")
SECRETS_PATH = LOCAL_SECRETS  # resolved for real in main(); PANEL_SECRETS wins

# Espressif's USB vendor id. ESP32-S3 native USB-Serial/JTAG enumerates as
# 303A:1001; other Espressif USB modes share the 303A vendor id.
ESPRESSIF_VID = 0x303A

PIO_ENV = "panel"


# --------------------------------------------------------------------------- #
#  Console helpers
# --------------------------------------------------------------------------- #
def fail(msg):
    """Print a loud error and exit non-zero. No fallback, ever."""
    sys.stderr.write("\n[deploy] ERROR: %s\n\n" % msg)
    sys.exit(1)


def resolve_secrets_path():
    """Locate secrets.yaml. $PANEL_SECRETS (a shared, repo-external file) wins so
    one secret can serve every worktree; otherwise the worktree-local file."""
    env = os.environ.get("PANEL_SECRETS")
    if env:
        if not os.path.isfile(env):
            fail("PANEL_SECRETS is set to %r but no file exists there.\n"
                 "  -> point it at your shared secrets file, or unset it to fall\n"
                 "     back to the worktree-local LookingGlass/secrets.yaml." % env)
        return os.path.abspath(env)
    return LOCAL_SECRETS


def info(msg):
    print("[deploy] %s" % msg)


def warn(msg):
    print("[deploy] WARNING: %s" % msg)


# --------------------------------------------------------------------------- #
#  MAC normalization
# --------------------------------------------------------------------------- #
_MAC_RE = re.compile(r"^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")


def normalize_mac(raw):
    """Lowercase, colon-separated canonical form, or None if not a MAC.

    Accepts colon/hyphen/dot separators and bare 12-hex strings.
    """
    if raw is None:
        return None
    hexed = re.sub(r"[^0-9a-fA-F]", "", str(raw))
    if len(hexed) != 12:
        return None
    hexed = hexed.lower()
    mac = ":".join(hexed[i:i + 2] for i in range(0, 12, 2))
    return mac if _MAC_RE.match(mac) else None


# --------------------------------------------------------------------------- #
#  secrets.yaml — read device.mac (PyYAML if present, else tiny reader)
# --------------------------------------------------------------------------- #
def _read_device_mac_minimal(path):
    """Tiny YAML-subset reader: find `device:` then its 2-space `mac:` child.

    Sufficient for device.mac only. Fails loud on a malformed device block.
    """
    in_device = False
    device_indent = None
    with open(path, "r", encoding="utf-8") as f:
        for n, raw in enumerate(f, 1):
            line = raw.rstrip("\n")
            # strip trailing comment (no quotes expected on these keys)
            stripped = line.split("#", 1)[0].rstrip()
            if not stripped.strip():
                continue
            indent = len(stripped) - len(stripped.lstrip(" "))
            content = stripped.strip()
            if ":" not in content:
                continue
            key, _, val = content.partition(":")
            key, val = key.strip(), val.strip()
            if not in_device:
                if key == "device" and val == "":
                    in_device = True
                    device_indent = indent
                continue
            # inside device block: a sibling/parent key ends it
            if indent <= device_indent:
                in_device = False
                if key == "device" and val == "":
                    in_device = True
                    device_indent = indent
                continue
            if key == "mac":
                v = val.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
                    v = v[1:-1]
                return v
    return None


def read_expected_mac():
    """Return the normalized device.mac from secrets.yaml, or fail loud.

    Distinguishes the three failure modes the user must act on:
      * secrets.yaml missing
      * device.mac missing / empty
      * device.mac present but not a valid MAC
    """
    if not os.path.isfile(SECRETS_PATH):
        fail(
            "secrets.yaml not found at %s\n"
            "  -> copy secrets.yaml.example to secrets.yaml and set device.mac,\n"
            "     or connect a single board and run:  python deploy.py --pair"
            % SECRETS_PATH
        )

    raw = None
    try:
        import yaml  # optional
    except ImportError:
        yaml = None

    if yaml is not None:
        try:
            with open(SECRETS_PATH, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except Exception as exc:  # malformed YAML -> fail loud, do not guess
            fail("could not parse %s as YAML: %s" % (SECRETS_PATH, exc))
        if not isinstance(data, dict):
            fail("%s did not parse to a YAML mapping" % SECRETS_PATH)
        dev = data.get("device")
        raw = dev.get("mac") if isinstance(dev, dict) else None
    else:
        try:
            raw = _read_device_mac_minimal(SECRETS_PATH)
        except Exception as exc:
            fail("could not read device.mac from %s: %s" % (SECRETS_PATH, exc))

    if raw is None or str(raw).strip() == "":
        fail(
            "device.mac is missing or empty in %s\n"
            "  -> set it to your board's MAC, e.g.\n"
            "         device:\n"
            "           mac: \"AA:BB:CC:DD:EE:FF\"\n"
            "     or connect a single board and run:  python deploy.py --pair"
            % SECRETS_PATH
        )

    mac = normalize_mac(raw)
    if mac is None:
        fail(
            "device.mac in %s is not a valid MAC: %r\n"
            "  -> expected 6 hex octets, e.g. \"AA:BB:CC:DD:EE:FF\""
            % (SECRETS_PATH, raw)
        )
    return mac


def write_expected_mac(mac):
    """Write/replace device.mac in secrets.yaml (creating device: if absent).

    Preserves the rest of the file. `mac` must already be normalized.
    """
    if not os.path.isfile(SECRETS_PATH):
        # Create a minimal secrets.yaml with just the device block. The
        # build also needs wifi/ap keys, so warn the user to fill those in.
        with open(SECRETS_PATH, "w", encoding="utf-8") as f:
            f.write(
                "# LookingGlass secrets (gitignored; do NOT commit).\n"
                "device:\n"
                "  mac: \"%s\"\n" % mac.upper()
            )
        warn(
            "secrets.yaml did not exist — created it with device.mac only.\n"
            "  Add your wifi.ssid / wifi.password / ap.password before building."
        )
        return

    with open(SECRETS_PATH, "r", encoding="utf-8") as f:
        lines = f.readlines()

    out = []
    in_device = False
    device_indent = None
    replaced = False
    saw_device = False
    for line in lines:
        stripped = line.rstrip("\n")
        body = stripped.split("#", 1)[0]
        content = body.strip()
        indent = len(body) - len(body.lstrip(" "))

        if not in_device:
            out.append(line)
            if content == "device:" or content.startswith("device:") and content.split(":", 1)[1].strip() == "":
                in_device = True
                saw_device = True
                device_indent = indent
            continue

        # inside device block
        if content and indent <= device_indent:
            # device block ended without a mac key -> insert one before this line
            if not replaced:
                out.append("%smac: \"%s\"\n" % (" " * (device_indent + 2), mac.upper()))
                replaced = True
            in_device = False
            out.append(line)
            continue

        if content.startswith("mac:"):
            out.append("%smac: \"%s\"\n" % (" " * indent, mac.upper()))
            replaced = True
            continue

        out.append(line)

    # device block ran to EOF without a mac key
    if in_device and not replaced:
        out.append("%smac: \"%s\"\n" % (" " * (device_indent + 2), mac.upper()))
        replaced = True

    if not saw_device:
        # No device: block at all — append one.
        if out and not out[-1].endswith("\n"):
            out[-1] = out[-1] + "\n"
        out.append("\ndevice:\n  mac: \"%s\"\n" % mac.upper())
        replaced = True

    with open(SECRETS_PATH, "w", encoding="utf-8") as f:
        f.writelines(out)

    if not replaced:
        fail("failed to write device.mac into %s" % SECRETS_PATH)


# --------------------------------------------------------------------------- #
#  Port enumeration — Espressif USB devices only
# --------------------------------------------------------------------------- #
def list_espressif_ports():
    """Return [{'port', 'desc', 'vid', 'pid', 'hwid'}] for Espressif boards.

    Filters on USB VID 0x303A using pyserial. pyserial ships with the
    PlatformIO penv; if it is unavailable we fail loud rather than guess.
    """
    try:
        from serial.tools import list_ports
    except ImportError:
        fail(
            "pyserial is not available (cannot import serial.tools.list_ports).\n"
            "  -> install it:  python -m pip install pyserial\n"
            "     or run this script with PlatformIO's penv python."
        )

    found = []
    for p in list_ports.comports():
        vid = p.vid
        if vid is None or vid != ESPRESSIF_VID:
            continue
        found.append(
            {
                "port": p.device,
                "desc": p.description or "",
                "vid": vid,
                "pid": p.pid,
                "hwid": p.hwid or "",
            }
        )
    found.sort(key=lambda d: d["port"])
    return found


# --------------------------------------------------------------------------- #
#  esptool — read a board's MAC
# --------------------------------------------------------------------------- #
def read_board_mac(port):
    """Run `python -m esptool --port <port> read-mac` and parse the MAC.

    esptool v5 uses hyphenated subcommands (read-mac). Returns the
    normalized MAC, or None if esptool failed / no MAC line was found.
    """
    cmd = [sys.executable, "-m", "esptool", "--port", port, "read-mac"]
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            timeout=60,
        )
    except FileNotFoundError:
        fail(
            "could not launch esptool (%s).\n"
            "  -> install it:  python -m pip install esptool" % " ".join(cmd)
        )
    except subprocess.TimeoutExpired:
        warn("esptool timed out reading MAC on %s" % port)
        return None

    out = proc.stdout or ""
    # esptool prints a "MAC: xx:xx:xx:xx:xx:xx" line (the base/STA MAC).
    m = re.search(r"MAC:\s*([0-9A-Fa-f:]{17})", out)
    if not m:
        if proc.returncode != 0:
            warn(
                "esptool could not read MAC on %s (exit %d). Is the board in a "
                "busy state or held in another tool?" % (port, proc.returncode)
            )
        else:
            warn("could not find a MAC line in esptool output for %s" % port)
        return None
    return normalize_mac(m.group(1))


def scan_boards():
    """Enumerate Espressif ports and read each board's MAC.

    Returns a list of dicts: {'port', 'desc', 'mac'(normalized or None)}.
    """
    ports = list_espressif_ports()
    boards = []
    for p in ports:
        info("reading MAC on %s (%s) ..." % (p["port"], p["desc"]))
        mac = read_board_mac(p["port"])
        boards.append({"port": p["port"], "desc": p["desc"], "mac": mac})
    return boards


# --------------------------------------------------------------------------- #
#  Pretty printing
# --------------------------------------------------------------------------- #
def print_board_table(boards, expected=None):
    if not boards:
        print("  (no Espressif boards detected)")
        return
    print("  %-8s  %-17s  %-7s  %s" % ("PORT", "MAC", "MATCH", "DESCRIPTION"))
    print("  %-8s  %-17s  %-7s  %s" % ("-" * 8, "-" * 17, "-" * 7, "-" * 11))
    for b in boards:
        mac = b["mac"] or "(unreadable)"
        if expected is None or b["mac"] is None:
            match = "-"
        else:
            match = "YES" if b["mac"] == expected else "no"
        print("  %-8s  %-17s  %-7s  %s" % (b["port"], mac, match, b["desc"]))


# --------------------------------------------------------------------------- #
#  PlatformIO actions
# --------------------------------------------------------------------------- #
def run_pio_build():
    info("building (pio run -e %s) ..." % PIO_ENV)
    rc = subprocess.call(["pio", "run", "-e", PIO_ENV], cwd=HERE)
    if rc != 0:
        fail("build failed (pio run exited %d)" % rc)
    info("build OK")


def run_pio_upload(port):
    info("flashing %s on %s ..." % (PIO_ENV, port))
    rc = subprocess.call(
        ["pio", "run", "-e", PIO_ENV, "-t", "upload", "--upload-port", port],
        cwd=HERE,
    )
    if rc != 0:
        fail("upload failed (pio run -t upload exited %d)" % rc)
    info("flash OK on %s" % port)


# --------------------------------------------------------------------------- #
#  Interactive picker
# --------------------------------------------------------------------------- #
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
        description="MAC-locked flasher for the LookingGlass panel firmware.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--list", action="store_true",
                    help="print expected MAC + connected boards and exit (no flash)")
    ap.add_argument("--build-only", action="store_true",
                    help="compile only — no MAC check, no upload")
    ap.add_argument("--port", metavar="COMx",
                    help="force a specific port (still MAC-verified unless --force)")
    ap.add_argument("--pair", action="store_true",
                    help="write the single connected board's MAC into secrets.yaml, then flash it")
    ap.add_argument("--pick", action="store_true",
                    help="interactively choose which connected board to flash")
    ap.add_argument("--force", action="store_true",
                    help="skip the MAC guard (emergency only — prints a loud warning)")
    args = ap.parse_args()

    # Resolve the secrets file: a shared $PANEL_SECRETS wins over the local one.
    global SECRETS_PATH
    SECRETS_PATH = resolve_secrets_path()

    # --build-only: no MAC check, no hardware enumeration, no upload.
    if args.build_only:
        run_pio_build()
        return

    # --pair: detect the single connected board and store its MAC, then flash.
    if args.pair:
        boards = scan_boards()
        if not boards:
            fail("--pair needs exactly one connected Espressif board; none found.")
        readable = [b for b in boards if b["mac"] is not None]
        if len(boards) > 1:
            print()
            print_board_table(boards)
            fail("--pair needs exactly ONE connected board; found %d. "
                 "Disconnect the others and retry." % len(boards))
        if len(readable) != 1:
            fail("--pair could not read the connected board's MAC. Put it in "
                 "download mode (hold BOOT) and retry.")
        board = readable[0]
        write_expected_mac(board["mac"])
        info("paired: device.mac in secrets.yaml is now %s (%s)"
             % (board["mac"].upper(), board["port"]))
        run_pio_build()
        run_pio_upload(board["port"])
        return

    # All remaining modes need the expected MAC unless we are forcing.
    expected = None
    if not args.force:
        expected = read_expected_mac()

    # --list: report and exit.
    if args.list:
        if expected is not None:
            info("expected deploy-target MAC (secrets.yaml device.mac): %s" % expected.upper())
        else:
            info("MAC guard disabled (--force): no expected MAC loaded")
        print()
        info("connected Espressif boards:")
        boards = scan_boards()
        print_board_table(boards, expected)
        return

    info("expected deploy-target MAC (secrets.yaml device.mac): %s"
         % (expected.upper() if expected else "(none — --force)"))

    # --force --port COMx: flash that port without verification.
    if args.force:
        warn("=================  MAC GUARD DISABLED (--force)  =================")
        warn("Flashing WITHOUT verifying the board MAC. This can flash the")
        warn("WRONG board. Use this only when you know exactly what is connected.")
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
                print_board_table(boards)
                fail("multiple boards connected and --force given without --port/--pick; "
                     "specify --port COMx or add --pick.")
        run_pio_build()
        run_pio_upload(target_port)
        return

    # --port COMx (verified): read that one port's MAC and require a match.
    if args.port:
        mac = read_board_mac(args.port)
        if mac is None:
            fail("could not read a MAC on %s. Is a board connected there and "
                 "not held by another tool?" % args.port)
        if mac != expected:
            print()
            print_board_table([{"port": args.port, "desc": "", "mac": mac}], expected)
            fail(
                "board on %s has MAC %s but secrets.yaml expects %s.\n"
                "  -> fix device.mac in secrets.yaml, re-pair (python deploy.py --pair),\n"
                "     or override for THIS flash with --force." % (args.port, mac.upper(), expected.upper())
            )
        info("MAC match on %s (%s)" % (args.port, mac.upper()))
        run_pio_build()
        run_pio_upload(args.port)
        return

    # Default: enumerate, verify, flash the unique match.
    boards = scan_boards()
    if not boards:
        fail("no Espressif (VID 303A) board detected. Connect the panel board "
             "over USB-C and retry.")

    matches = [b for b in boards if b["mac"] == expected]

    if len(matches) == 1:
        board = matches[0]
        info("MAC match: %s on %s" % (board["mac"].upper(), board["port"]))
        run_pio_build()
        run_pio_upload(board["port"])
        return

    if len(matches) > 1:
        print()
        print_board_table(boards, expected)
        fail("more than one connected board matches %s — disconnect the "
             "duplicates, or use --port COMx to choose." % expected.upper())

    # No match.
    print()
    info("expected MAC: %s" % expected.upper())
    info("connected boards (NONE match):")
    print_board_table(boards, expected)
    print()
    if args.pick:
        warn("no board matches the secret; you are about to flash a NON-matching board.")
        board = pick_board(boards)
        if board["mac"] is None:
            fail("selected board's MAC is unreadable; cannot flash safely.")
        warn("flashing %s (MAC %s) which does NOT match secrets.yaml (%s)."
             % (board["port"], board["mac"].upper(), expected.upper()))
        run_pio_build()
        run_pio_upload(board["port"])
        return

    fail(
        "no connected board matches the expected MAC %s.\n"
        "  -> fix device.mac in secrets.yaml, re-pair (python deploy.py --pair),\n"
        "     or pick a board to flash this time with:  python deploy.py --pick"
        % expected.upper()
    )


if __name__ == "__main__":
    main()
