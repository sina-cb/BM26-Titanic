#!/usr/bin/env python3
"""deploy.py - laptop -> show-server deploy, and server -> laptop fetch (docs/43 Phase 2).

Run from the design laptop only (the sole git/GitHub gate). Two operations:

  deploy   Ship this laptop's working tree to a show server.
             --target prod    (default) full pipeline: preflight -> stop stack ->
                              robocopy /MIR -> optional --scene -> overlay ->
                              stamp -> start stack -> verify from the laptop.
             --target scratch code-only sync (tracked files, tar-over-SSH) into
                              the server's dev workspace. Never touches .git,
                              runtime state, or untracked files on the server;
                              a dirty scratch tree requires --force.
  fetch    Collect on-server git work (bundles over SSH -> remote-tracking refs;
           never auto-merged) and, with --state, snapshot prod runtime state to
           a gitignored dir under ~/tmp. Strictly non-destructive on both ends.

Transports: DEPLOY prod uses SMB for bytes (one-time cred setup:
`cmdkey /add:<host> /user:<hostname>\\titanic /pass`) + SSH for control.
DEPLOY scratch and FETCH are pure SSH/scp - no SMB needed.

Fail-loudly contract (codex P0): every phase either succeeds, or the script
exits nonzero naming the exact failure. There are no silent fallbacks.

Full design: docs/43_show_server_deployment.md. Server-side conventions
(manifest shape, boot_status.yaml) are defined by deploy/boot_server.ps1.
"""

import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
if os.name == 'nt':
    # winreg is Windows-only stdlib (absent on macOS/Linux, where deploy.py can
    # run from an externally configured environment). Guard the import by
    # platform so the
    # module still loads cross-platform without a try/except wrap (codex P0: no
    # try/except-wrapped imports); it is referenced ONLY under the same
    # os.name == 'nt' guard in manifest_path().
    import winreg
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
# The show-server manifest comes from an external/private deployment source,
# never this public tree. deploy.py resolves the generic $BM26_MACHINES contract
# and fails loudly if unset (no repo-local fallback - codex P0).
MANIFEST_ENV = 'BM26_MACHINES'
SECRETS_ENV = 'BM26_SECRETS'
OVERLAYS_ROOT = REPO_ROOT / 'deploy' / 'overlays'
# Overlay .yaml fragments are deep-merged with the engine's own js-yaml. node is
# launched with cwd here so require('js-yaml') resolves against its node_modules.
MARSIN_ENGINE_DIR = REPO_ROOT / 'marsin_engine'

# Deep-merge run via `node -e` (cwd=MARSIN_ENGINE_DIR so require('js-yaml')
# resolves). argv[1] = tracked base file, argv[2] = overlay fragment. Maps merge
# recursively; arrays and scalars REPLACE (an overlay list fully supersedes the
# base list). Merged YAML goes to stdout in the base's key order (js-yaml dump
# keeps insertion order); any parse/merge error exits nonzero so the Python side
# fails the deploy loudly (codex P0 - no silent fallback).
MERGE_JS = r'''
const yaml = require('js-yaml');
const fs = require('fs');
const [basePath, fragPath] = process.argv.slice(1);
const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
const deepMerge = (base, frag) => {
  if (!isMap(base) || !isMap(frag)) return frag;  // arrays + scalars REPLACE
  const out = Object.assign({}, base);
  for (const k of Object.keys(frag)) {
    out[k] = (k in base) ? deepMerge(base[k], frag[k]) : frag[k];
  }
  return out;
};
const base = yaml.load(fs.readFileSync(basePath, 'utf8')) || {};
const frag = yaml.load(fs.readFileSync(fragPath, 'utf8'));
if (frag === undefined || frag === null) {
  process.stderr.write('overlay fragment parsed to empty (null) - refusing\n');
  process.exit(2);
}
process.stdout.write(yaml.dump(deepMerge(base, frag), { lineWidth: -1, noRefs: true }));
'''

SECRETS_VALIDATE_JS = r'''
const fs = require('fs');
const yaml = require('js-yaml');
let secrets;
try {
  secrets = yaml.load(fs.readFileSync(process.argv[1], 'utf8'));
} catch {
  process.stderr.write('private secrets YAML is unreadable or malformed (values redacted)\n');
  process.exit(2);
}
const keys = ['SinaAuth', 'MishaAuth', 'MARITIME_TERM_FOR_SAILIOR_PASS'];
const values = [];
for (const key of keys) {
  if (!secrets || typeof secrets[key] !== 'string' || secrets[key].length < 3) {
    process.stderr.write(`private secrets YAML is missing a valid ${key} value\n`);
    process.exit(3);
  }
  values.push(secrets[key]);
}
if (new Set(values).size !== values.length) {
  process.stderr.write('private CaptainPad passphrases must be distinct\n');
  process.exit(4);
}
process.stdout.write('BM26_SECRETS_VALID\n');
'''

# Server-owned paths never synced (docs/43): runtime state, backups, renders.
# Relative to the repo root; excluded on BOTH sides of the /MIR so the server's
# copies are neither overwritten nor deleted.
SYNC_EXCLUDE_DIRS = [
    # Production is a runtime artifact, not a development workspace. Git
    # metadata is machine-local, unnecessary to the boot chain, and can carry
    # protected per-file ACLs from whichever Windows account created an object.
    # Robocopy must never enumerate either .git tree: one inaccessible object
    # would otherwise abort the /L safety preview before a deploy can begin.
    # Durable on-server work belongs in scratch; prod fetch is retired below.
    '.git',
    'marsin_engine\\states',
    'simulation\\.scene_backups',
    '.agent_renders',
    # Operator-private local planning notes (gitignored AND never shipped:
    # they must exist on the laptop only - Sina 2026-07-28).
    '.agent\\reports_local',
    # TEST SUITES - never shipped to a show machine (Sina, report _245).
    # Nothing in the boot chain runs them (boot_server.ps1 -> launcher.js prod
    # -> sim/engine/companion/CaptainPad only), so this is not what stops them
    # running; it is what keeps a harness that BINDS PORTS and MUTATES STATE off
    # the box entirely. marsin_engine/tests in particular spins up real engines
    # (tests/e2e, tests/hil), writes temp configs, and drives sACN - none of it
    # may exist within reach of a show server. Excluded on BOTH sides of the
    # /MIR, so an older deploy's tests\ dir is DELETED from the server on the
    # next sync (robocopy /XD skips it in both trees).
    # NOTE: CaptainPad's tests are colocated (components/**/*.test.ts) and are
    # therefore still copied. They are inert on prod: prod serves the PREBUILT
    # CaptainPad/dist and never runs Metro or vitest, so nothing loads them.
    'marsin_engine\\tests',
    'simulation\\tests',
    'LookingGlass\\control_podium\\tests',
    'deploy\\tests',
    # AGENT WORKTREES - Claude Code session worktrees are FULL extra checkouts of
    # this repo (each with its own node_modules, .git, tests\ and
    # marsin_engine\states\). They are gitignored, so nothing but an explicit
    # exclusion keeps them out of a /MIR - and a robocopy /L measured 260 MB of
    # them in two trees (report _245). Shipping them would (a) bloat every sync,
    # (b) smuggle the test suites and a second engine's state onto the show box
    # right past the exclusions above, which only name the REAL tree's paths, and
    # (c) race: a worktree can be created or deleted by an agent mid-sync.
    '.claude\\worktrees',
]
# deploy_info.yaml is server-owned; machines.yaml is NOT in this repo (private -
# $BM26_MACHINES) and is shipped explicitly by ship_manifest() AFTER the sync.
# Both are excluded so /MIR neither deletes the server's copy nor tries to carry
# a laptop copy that isn't in the tree.
# `.git` is a directory in a primary checkout but a pointer file in a linked
# worktree; exclude both representations so production never receives Git
# metadata regardless of which sanctioned laptop checkout runs the deploy.
SYNC_EXCLUDE_FILES = ['.git', 'deploy_info.yaml', 'machines.yaml']

# Server-owned paths dropped from a scratch (tracked-file) sync. git ls-files
# emits forward slashes, so these prefixes use forward slashes. The engine
# runtime-mutates marsin_engine/states/** on the server (live tuning) - even
# though those files are tracked, streaming them would clobber that state.
SCRATCH_EXCLUDE_PREFIXES = ['marsin_engine/states/']

BOOT_TASK = 'BM26TitanicStack'
ENGINE_PORT = 6968
SIM_PORT = 6969
# The launcher waits for the sim (~90s) then the engine (~120s) SEQUENTIALLY, so
# a cold first boot plus one benign supervisor restart can exceed three minutes;
# give verify a 5-minute budget before it declares the stack dead.
VERIFY_TIMEOUT_S = 300
VERIFY_POLL_S = 5
# Crash-loop settle window for the supervisor stability check: boot_server.ps1
# waits RestartDelaySeconds=10 between relaunches, so two restart_count reads
# this far apart will catch an active crash loop (the count rises between them).
STABILITY_GAP_S = 15
# After stopping the stack, prove both ports go quiet within this window (a
# launcher 'stop' can report success while an orphaned engine still holds :6968).
STOP_CONFIRM_TIMEOUT_S = 20
STOP_CONFIRM_POLL_S = 2
ROBOCOPY_FAIL_THRESHOLD = 8  # robocopy exit codes >= 8 are real failures
SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']

# Laptop-side scratch locations (project rule: temp artifacts live in ~/tmp).
FETCH_DIR = Path.home() / 'tmp' / 'bm26_fetch'
SNAPSHOT_ROOT = Path.home() / 'tmp' / 'bm26_state_snapshots'

# Spot-check files after a scratch sync (hash-compared laptop vs server). Only
# tracked files belong here - machines.yaml is NOT tracked (private) so it never
# rides a scratch sync and cannot be spot-checked.
SCRATCH_SPOT_CHECK = ['launcher.js', 'deploy/deploy.py', 'marsin_engine/engine.js']


# Set to a machine name once deploy_prod has STOPPED the live stack; every fail()
# after that point appends a loud "the stack is still down" note (item: post-stop
# failure clarity). It is never set on the stop/start/fetch paths.
_stopped_machine: str | None = None


def fail(message: str) -> None:
    """Print a loud error and exit nonzero (no fallback, codex P0)."""
    print(f'\n  FAIL: {message}', file=sys.stderr)
    if _stopped_machine is not None:
        print(f'  NOTE: the stack was STOPPED by this deploy and is still down - run '
              f"'python deploy/deploy.py start --machine {_stopped_machine}' or re-deploy.",
              file=sys.stderr)
    sys.exit(1)


def read_text_utf8(path: Path, label: str) -> str:
    """Read a file as UTF-8; a decode error is a clean fail() naming the file,
    never a raw UnicodeDecodeError traceback (codex P0 - fail loudly, no noise).
    """
    try:
        return path.read_text(encoding='utf-8')
    except UnicodeDecodeError as err:
        fail(f'{label} is not valid UTF-8 ({path}): {err}')


def step(title: str) -> None:
    """Print a numbered phase banner."""
    print(f'\n=== {title} ===')


def run(cmd: list[str], check: bool = True, capture: bool = True,
        stdin=None, timeout: int = 600,
        cwd: str | None = None,
        env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    """Run a local command; on check=True a nonzero exit fails the deploy loudly."""
    try:
        proc = subprocess.run(
            cmd,
            stdin=stdin,
            capture_output=capture,
            text=True,
            timeout=timeout,
            cwd=cwd,
            env=env,
        )
    except subprocess.TimeoutExpired:
        fail(f'command timed out after {timeout}s: {" ".join(cmd)}')
    if check and proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or '').strip()
        fail(f'command failed ({proc.returncode}): {" ".join(cmd)}\n  {detail}')
    return proc


def ssh_run(entry: dict, remote_cmd: str, check: bool = True,
            timeout: int = 600) -> subprocess.CompletedProcess:
    """Run a command on the server over SSH (remote shell is cmd.exe: use && and \\)."""
    target = f"{entry['ssh_user']}@{entry['host']}"
    return run(['ssh', *SSH_OPTS, target, remote_cmd], check=check, timeout=timeout)


# ── Manifest ────────────────────────────────────────────────────────────────

def _read_user_env_registry(name: str) -> str:
    """Read a User-scope environment variable straight from HKCU\\Environment.

    This is NOT a config fallback (codex P0): it reads the SAME canonical
    persisted variable from its authoritative store instead of the process env.
    A long-running parent app can hand its terminals a stale process env that
    predates the write, so os.environ lacks the var even though the registry has the real,
    current value. Returns '' when the value is absent (missing VALUE lookup ->
    FileNotFoundError/OSError); only that lookup is guarded, never the import.
    A REG_EXPAND_SZ value is expanded exactly as the shell would, so the caller
    gets the same resolved path the process env would have carried. Windows-only: the sole
    caller is guarded by os.name == 'nt'.
    """
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as key:
        try:
            value, typ = winreg.QueryValueEx(key, name)
        except (FileNotFoundError, OSError):
            return ''
    if typ == winreg.REG_EXPAND_SZ:
        value = winreg.ExpandEnvironmentStrings(value)
    return str(value).strip()


def manifest_path() -> Path:
    """Resolve the show-server manifest (machines.yaml) from $BM26_MACHINES.

    BM26_MACHINES is supplied by an external/private deployment source. There
    is NO repo-local fallback (codex P0): an unset variable or missing target
    file is a loud FAIL, not a silent default.

    Resolution order: (1) os.environ - cross-platform, and honors an explicit
    per-session override; (2) on Windows, the User-scope registry value if the
    process env lacks it - the SAME persisted variable read from its authoritative
    store (HKCU\\Environment), covering the stale-terminal case where a long-lived
    parent app (IDE/editor) predates external setup. This is not a second source
    of truth; it is the same persisted variable.
    """
    raw = os.environ.get(MANIFEST_ENV, '').strip()
    from_registry = False
    if not raw and os.name == 'nt':
        raw = _read_user_env_registry(MANIFEST_ENV)
        from_registry = bool(raw)
    if not raw:
        fail(f'{MANIFEST_ENV} is not set - configure it from the external/private '
             'deployment source and open a new terminal; there is no repo-local '
             'fallback.')
    if from_registry:
        print(f'  note: {MANIFEST_ENV} came from the user registry (HKCU\\Environment) '
              "because this terminal's environment is stale "
              '(opened before external setup).')
    path = Path(raw)
    if not path.is_file():
        fail(f'{MANIFEST_ENV} points at a file that does not exist: {path}\n'
             f'  fix: repair the external/private deployment source contract.')
    return path


def secrets_path() -> Path:
    """Resolve and validate the laptop's private BM26_SECRETS source path.

    The path and file contents are never printed. Resolution mirrors
    ``manifest_path`` so a long-running desktop app with a stale process
    environment still reads the authoritative User-scope value.
    """
    raw = os.environ.get(SECRETS_ENV, '').strip()
    from_registry = False
    if not raw and os.name == 'nt':
        raw = _read_user_env_registry(SECRETS_ENV)
        from_registry = bool(raw)
    if not raw:
        fail(f'{SECRETS_ENV} is not set on the laptop. Configure the external/private '
             'deployment source and open a new terminal; no secret was copied.')
    path = Path(raw)
    if not path.is_file():
        fail(f'{SECRETS_ENV} does not name a readable local file (path redacted). '
             'Fix the private deployment source; no secret was copied.')
    if from_registry:
        print(f'  note: {SECRETS_ENV} came from the user registry because this '
              "terminal's environment is stale; the private path remains redacted.")
    try:
        proc = subprocess.run(
            ['node', '-e', SECRETS_VALIDATE_JS, str(path)],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(MARSIN_ENGINE_DIR),
        )
    except subprocess.TimeoutExpired:
        fail(f'local {SECRETS_ENV} validation timed out (path and values redacted)')
    if proc.returncode != 0 or 'BM26_SECRETS_VALID' not in (proc.stdout or ''):
        detail = (proc.stderr or 'validation returned no diagnostic').strip()
        fail(f'local {SECRETS_ENV} validation failed (path and values redacted): {detail}')
    return path


def read_manifest(path: Path) -> dict:
    """Parse deploy/machines.yaml with the same strict two-level rules as
    boot_server.ps1: 'machines:' -> '<name>:' -> '<key>: value' at 0/2/4-space
    indent. Anything else is a hard failure - a malformed manifest must never
    half-parse into a wrong deploy target.
    """
    if not path.is_file():
        fail(f'machine manifest not found: {path}')
    machines: dict[str, dict] = {}
    saw_root = False
    current = None
    for line_no, raw in enumerate(read_text_utf8(path, 'machines.yaml').splitlines(), start=1):
        if '\t' in raw:
            fail(f'machines.yaml line {line_no}: tab character (strict parser, spaces only)')
        if not raw.strip() or raw.lstrip().startswith('#'):
            continue
        indent = len(raw) - len(raw.lstrip(' '))
        content = raw[indent:]
        if indent == 0:
            if content.rstrip() == 'machines:':
                saw_root, current = True, None
                continue
            fail(f'machines.yaml line {line_no}: unexpected top-level {content!r}')
        if not saw_root:
            fail(f'machines.yaml line {line_no}: content before the machines: root')
        if indent == 2:
            if content.rstrip().endswith(':') and ':' not in content.rstrip()[:-1]:
                current = content.rstrip()[:-1].strip()
                # A duplicate machine key would collapse silently (last wins) while
                # write_boot_scene edits the FIRST block - the two diverge. Fail
                # loudly naming the machine (codex P0 - no silent half-parse).
                if current in machines:
                    fail(f'machines.yaml line {line_no}: duplicate machine name '
                         f'{current!r} - machine keys must be unique')
                machines[current] = {}
                continue
            fail(f'machines.yaml line {line_no}: expected <name>: at 2-space indent')
        if indent == 4:
            if current is None or ':' not in content:
                fail(f'machines.yaml line {line_no}: key: value with no machine block')
            key, _, value = content.partition(':')
            key, value = key.strip(), value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in '\'"':
                value = value[1:-1]
            if key in machines[current]:
                fail(f'machines.yaml line {line_no}: duplicate key {key!r} in {current!r}')
            machines[current][key] = value
            continue
        fail(f'machines.yaml line {line_no}: unexpected indent {indent} (0/2/4 only)')
    if not saw_root:
        fail('machines.yaml has no machines: root')
    return machines


def get_machine(name: str, required: list[str]) -> dict:
    """Look up one machine entry and assert the keys this operation needs."""
    path = manifest_path()
    machines = read_manifest(path)
    if name not in machines:
        fail(f'machine {name!r} not in {path} (known: {", ".join(machines)})')
    entry = machines[name]
    missing = [k for k in required if not entry.get(k)]
    if missing:
        fail(f'machine {name!r} is missing required manifest key(s): {", ".join(missing)}')
    return entry


def dest_unc(entry: dict) -> str:
    """Map the server-local prod dest onto its SMB share (needs share_root)."""
    dest, share, share_root = entry['dest'], entry['share'], entry['share_root']
    if not dest.lower().startswith(share_root.lower()):
        fail(f"dest {dest!r} is not under share_root {share_root!r} - fix machines.yaml")
    return share.rstrip('\\') + dest[len(share_root):]


# ── Preflight ───────────────────────────────────────────────────────────────

def git_info() -> dict:
    """Describe the laptop tree being shipped: HEAD, branch, dirty-file count."""
    head = run(['git', '-C', str(REPO_ROOT), 'rev-parse', '--short', 'HEAD']).stdout.strip()
    branch = run(['git', '-C', str(REPO_ROOT), 'rev-parse',
                  '--abbrev-ref', 'HEAD']).stdout.strip()
    dirty = [l for l in run(['git', '-C', str(REPO_ROOT), 'status',
                             '--porcelain']).stdout.splitlines() if l.strip()]
    return {'head': head, 'branch': branch, 'dirty_count': len(dirty)}


def preflight_ssh(name: str, entry: dict) -> None:
    """Assert SSH works, the box is who the manifest says, and node versions match."""
    proc = ssh_run(entry, 'hostname && node --version', timeout=30)
    lines = [l.strip() for l in proc.stdout.splitlines() if l.strip()]
    if len(lines) < 2:
        fail(f'unexpected remote identity output: {proc.stdout!r}')
    remote_host, remote_node = lines[0], lines[1]
    if remote_host.lower() != name.lower():
        fail(f'SSH reached {remote_host!r} but the manifest entry is {name!r} - wrong box?')
    local_node = run(['node', '--version']).stdout.strip()
    if remote_node != local_node:
        fail(f'node mismatch: laptop {local_node} vs server {remote_node} '
             f'(node_modules ship as-is - versions must match; docs/43)')
    print(f'  ssh ok: {remote_host}, node {remote_node} (matches laptop)')


def probe_runtime_secrets(entry: dict) -> tuple[bool, str]:
    """Read-only probe of the scheduled-task account's persistent secret source."""
    dest = entry['dest'].replace("'", "''")
    script = (
        "$user=[Environment]::GetEnvironmentVariable('BM26_SECRETS','User');"
        "$machine=[Environment]::GetEnvironmentVariable('BM26_SECRETS','Machine');"
        "$scope=if(-not [string]::IsNullOrWhiteSpace($user)){'User'}"
        "elseif(-not [string]::IsNullOrWhiteSpace($machine)){'Machine'}else{$null};"
        "if($null -eq $scope){Write-Output 'BM26_SECRETS_NOT_READY missing';exit 2};"
        "$path=if($scope -eq 'User'){$user}else{$machine};"
        "try{$item=Get-Item -LiteralPath $path -ErrorAction Stop;"
        "if($item.PSIsContainer){throw 'not a file'};"
        f"$repo=[IO.Path]::GetFullPath('{dest}').TrimEnd('\\')+'\\';"
        "$full=[IO.Path]::GetFullPath($item.FullName);"
        "if($full.StartsWith($repo,[StringComparison]::OrdinalIgnoreCase)){"
        "Write-Output 'BM26_SECRETS_NOT_READY inside_repo';"
        "exit 4};"
        "$stream=[IO.File]::Open($item.FullName,[IO.FileMode]::Open,"
        "[IO.FileAccess]::Read,[IO.FileShare]::Read);$stream.Dispose()}"
        "catch{Write-Output 'BM26_SECRETS_NOT_READY unreadable';"
        "exit 3};Write-Output ('BM26_SECRETS_READY scope='+$scope)"
    )
    command = f'powershell -NoProfile -Command "{script}"'
    proc = ssh_run(entry, command, check=False, timeout=30)
    output = (proc.stdout or '').strip()
    if proc.returncode == 0 and 'BM26_SECRETS_READY scope=' in output:
        return True, output
    markers = ('missing', 'inside_repo', 'unreadable')
    reason = next((marker for marker in markers if marker in output), 'probe_failed')
    return False, reason


def preflight_runtime_secrets(entry: dict) -> None:
    """Fail unless the provisioned persistent secret source is readable."""
    ready, status = probe_runtime_secrets(entry)
    if not ready:
        fail('remote runtime-secret verification failed after secure provisioning '
             f'(reason={status}; path and values redacted). The stack was not stopped.')
    print(f'  runtime secrets ok: {status}')


def _remote_secret_paths(entry: dict) -> dict[str, str]:
    """Return stable server paths for secure provisioning (never printed)."""
    root = entry['share_root'].rstrip('\\')
    private_dir = f'{root}\\private'
    return {
        'installer': f'{root}\\provision_runtime_secrets.ps1',
        'destination': f'{private_dir}\\secrets.yaml',
        'temporary': f'{private_dir}\\secrets.yaml.bm26-new',
    }


def _scp_redacted(local_path: Path, entry: dict, remote_path: str, label: str) -> None:
    """Copy one file over encrypted SCP without logging either path."""
    target = f"{entry['ssh_user']}@{entry['host']}"
    remote = remote_path.replace('\\', '/')
    try:
        proc = subprocess.run(
            ['scp', *SSH_OPTS, str(local_path), f'{target}:{remote}'],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        fail(f'encrypted {label} copy timed out (paths and values redacted); '
             'the stack was not stopped')
    if proc.returncode != 0:
        fail(f'encrypted {label} copy failed with exit {proc.returncode} '
             '(paths and values redacted); the stack was not stopped')


def provision_runtime_secrets(entry: dict, source: Path) -> None:
    """Securely provision BM26_SECRETS before any live-stack stop.

    A public helper script is copied first. It protects the private directory,
    then the validated YAML crosses encrypted SCP into that directory. The
    helper converges the stable file, applies protected least-
    privilege ACLs, persists Machine-scope BM26_SECRETS, and verifies a read.
    """
    paths = _remote_secret_paths(entry)
    installer_source = REPO_ROOT / 'deploy' / 'setup' / 'provision_runtime_secrets.ps1'
    _scp_redacted(installer_source, entry, paths['installer'], 'provisioner')
    common = (f'-ExpectedUser "{entry["ssh_user"]}" '
              f'-DestinationPath "{paths["destination"]}" '
              f'-RepoRoot "{entry["dest"]}"')
    prepare = (f'powershell -NoProfile -ExecutionPolicy Bypass '
               f'-File "{paths["installer"]}" {common} -PrepareDirectory')
    proc = ssh_run(entry, prepare, check=False, timeout=60)
    if proc.returncode != 0 or 'BM26_SECRET_DIRECTORY_READY' not in (proc.stdout or ''):
        fail('remote private-directory preparation failed (paths redacted); '
             'the stack was not stopped')
    _scp_redacted(source, entry, paths['temporary'], 'private secret')
    finalize = (f'powershell -NoProfile -ExecutionPolicy Bypass '
                f'-File "{paths["installer"]}" {common} '
                f'-SourceTempPath "{paths["temporary"]}" -EnvironmentTarget Machine')
    proc = ssh_run(entry, finalize, check=False, timeout=60)
    if proc.returncode != 0 or 'BM26_SECRETS_PROVISIONED scope=Machine' not in (
            proc.stdout or ''):
        fail('remote runtime-secret finalization failed (paths and values redacted); '
             'the stack was not stopped')
    preflight_runtime_secrets(entry)
    print('  runtime secrets securely provisioned: Machine scope, private ACL verified')


def preflight_smb(name: str, entry: dict) -> str:
    """Assert the prod tree is reachable over SMB; return its UNC path."""
    unc = dest_unc(entry)
    # A missing/wrong stored credential surfaces as OSError (e.g. WinError
    # 1326) from stat, not as a clean False - treat both as "not reachable".
    try:
        reachable = Path(unc).is_dir()
    except OSError as err:
        print(f'  smb error: {err}')
        reachable = False
    if not reachable:
        fail(f'prod tree not reachable over SMB: {unc}\n'
             f'  one-time cred setup on this laptop: '
             f'cmdkey /add:{entry["host"]} /user:{name}\\{entry["ssh_user"]} /pass\n'
             f'  (also see deploy/README.md troubleshooting: show-LAN Public-profile trap)')
    print(f'  smb ok: {unc}')
    return unc


def robocopy_cmd(
        src: str,
        dst: str,
        list_only: bool,
        force_fast: bool = False,
) -> list[str]:
    """Build the production Robocopy invocation.

    Production ``--force`` skips the separate list-only pass and raises the
    real mirror's worker count. The mirror itself remains authoritative: it
    still applies exclusions, propagates deletions, and fails on Robocopy
    error classes.
    """
    cmd = ['robocopy', src, dst, '/MIR', '/XJ', '/R:2', '/W:2', '/NP']
    excl = []
    for rel in SYNC_EXCLUDE_DIRS:
        excl += [f'{src}\\{rel}', f'{dst}\\{rel}']
    cmd += ['/XD', *excl, '/XF', *SYNC_EXCLUDE_FILES]
    if list_only:
        cmd += ['/L', '/NJH']
    else:
        workers = 64 if force_fast else 16
        cmd += [f'/MT:{workers}', '/NFL', '/NDL']
    return cmd


def robocopy_failure(operation: str, proc: subprocess.CompletedProcess) -> None:
    """Fail with an actionable diagnosis for a Robocopy error.

    Access denied under ``.git`` is a deployment invariant violation: both
    Git roots are explicitly excluded, so neither dry-run nor sync may inspect
    them. This message prevents operators from reaching for /ZB or broad ACL
    grants that would weaken the show server instead of fixing the command.
    """
    detail = (proc.stderr or proc.stdout or '').strip()
    normalized = detail.replace('/', '\\').lower()
    access_denied = 'error 5' in normalized or 'access is denied' in normalized
    git_path = '\\.git\\' in normalized or normalized.endswith('\\.git')
    if access_denied and git_path:
        fail(f'{operation} attempted to read excluded prod .git metadata. '
             'This is an internal exclusion invariant failure; do not use /ZB '
             'or grant broad ACLs. The stack was not touched by preview.\n'
             f'{detail}')
    if access_denied:
        fail(f'{operation} was denied access outside the excluded prod .git tree. '
             'Repair the named destination path ACL for the registered deployment '
             'identity, then rerun the dry-run. No ACL fallback is attempted.\n'
             f'{detail}')
    fail(f'{operation} failed (exit {proc.returncode}):\n{detail}')


def show_sync_preview(unc: str) -> None:
    """Print what a real sync would change (robocopy /L), capped for readability."""
    proc = run(robocopy_cmd(str(REPO_ROOT), unc, list_only=True), check=False, timeout=1800)
    if proc.returncode >= ROBOCOPY_FAIL_THRESHOLD:
        robocopy_failure('robocopy /L preview', proc)
    lines = [l.rstrip() for l in proc.stdout.splitlines() if l.strip()]
    # Keep summary/banner noise out, but NEVER filter '*EXTRA Dir' - a directory
    # deletion is the most destructive delta and must show in the preview.
    changes = [l for l in lines if not l.lstrip().startswith(('Total', 'Dirs', 'Files',
               'Bytes', 'Times', 'Ended', 'Speed', '----', 'ROBOCOPY', 'Started', 'Source',
               'Dest', 'Options'))]
    print(f'  preview: {len(changes)} path(s) would change '
          f'(server-side deltas get overwritten/deleted - laptop is source of truth):')
    for line in changes[:40]:
        print(f'    {line}')
    if len(changes) > 40:
        print(f'    ... and {len(changes) - 40} more')


# ── Deploy to prod ──────────────────────────────────────────────────────────

def stop_stack(entry: dict) -> bool:
    """Stop the boot task, then sweep stragglers with the launcher's own stop.

    Returns True when nothing was running to begin with (task not running AND the
    launcher reported no stack) - the caller can report "already stopped"
    distinctly from a fresh stop. Either way the ports are confirmed quiet before
    returning; a stack that refuses to go down is the loud confirm_stack_stopped
    fail path. deploy_prod ignores the return value (behavior unchanged).
    """
    end_proc = ssh_run(entry, f'schtasks /End /TN {BOOT_TASK}', check=False, timeout=60)
    print(f'  schtasks /End -> rc {end_proc.returncode} '
          f'({"stopped" if end_proc.returncode == 0 else "was not running"})')
    launcher = f"{entry['dest']}\\launcher.js"
    stop_proc = ssh_run(entry, f'node "{launcher}" stop', check=False, timeout=120)
    if stop_proc.returncode not in (0, 1):  # 1 = "no stack is running" - fine after /End
        fail(f'launcher stop failed (rc {stop_proc.returncode}):\n'
             f'{stop_proc.stdout}\n{stop_proc.stderr}')
    meaning = ('stopped' if stop_proc.returncode == 0
               else 'no lock found OR stop timed out - the port check below is authoritative')
    print(f'  launcher stop -> rc {stop_proc.returncode} ({meaning})')
    # `launcher stop` now asks the engine to send its shutdown blackout BEFORE the
    # force-kill (report _169 / _160 T1). On rc 0 we otherwise SWALLOW its output,
    # so an unconfirmed blackout - the one case where the rig may still be lit -
    # would be invisible exactly where the operator is about to work on hardware.
    for line in f'{stop_proc.stdout}\n{stop_proc.stderr}'.splitlines():
        if 'BLACKOUT NOT CONFIRMED' in line:
            print(f'  {line.strip()}')
    confirm_stack_stopped(entry)
    return end_proc.returncode != 0 and stop_proc.returncode == 1


def confirm_stack_stopped(entry: dict) -> None:
    """Prove the stack is actually DOWN before we sync/restart onto its ports.

    A launcher 'stop' rc of 1 can mean "no lock file" while an orphaned engine
    still holds :6968 (or the sim still holds :6969) - syncing/starting on top of
    that would silently collide. Poll both ports until they BOTH stop answering;
    if either is still up after the window, FAIL loudly (codex P0 - no fallback).
    """
    host = entry['host']
    engine_url = f'http://{host}:{ENGINE_PORT}/status'
    sim_url = f'http://{host}:{SIM_PORT}/simulation/'
    deadline = time.monotonic() + STOP_CONFIRM_TIMEOUT_S
    while time.monotonic() < deadline:
        if _ports_quiet(entry):
            print(f'  stack down: :{ENGINE_PORT} and :{SIM_PORT} both quiet')
            _assert_boot_task_not_running(entry)
            return
        time.sleep(STOP_CONFIRM_POLL_S)
    still = [str(p) for p, url in ((ENGINE_PORT, engine_url), (SIM_PORT, sim_url))
             if http_up(url)]
    fail(f'stack did not stop - orphaned process still on :{"/:".join(still)} after '
         f'{STOP_CONFIRM_TIMEOUT_S}s - kill it on the server before deploying '
         f'(check \\\\{host}\\titanic\\logs\\boot_server_*.log)')


def _assert_boot_task_not_running(entry: dict) -> None:
    """Ports quiet is not enough: the boot task itself may still be Running a
    supervisor that would relaunch the stack out from under a deploy. Query it
    and fail loudly if schtasks reports it Running (codex P0 - no silent race).
    """
    proc = ssh_run(entry, f'schtasks /Query /TN {BOOT_TASK}', check=False, timeout=60)
    # schtasks prints a Status column; 'Running' means the supervisor is still
    # live. (The task name and headers contain no standalone 'running' token.)
    if proc.returncode == 0 and 'running' in proc.stdout.lower():
        fail(f'boot task {BOOT_TASK} still running a supervisor - it may relaunch the '
             f'stack; investigate before syncing (schtasks /End /TN {BOOT_TASK}, then '
             f're-check)')


def sync_prod(unc: str, force_fast: bool = False) -> None:
    """robocopy /MIR the laptop tree onto the prod dest (exclusions per docs/43)."""
    proc = run(
        robocopy_cmd(
            str(REPO_ROOT),
            unc,
            list_only=False,
            force_fast=force_fast,
        ),
        check=False,
        timeout=3600,
    )
    if proc.returncode >= ROBOCOPY_FAIL_THRESHOLD:
        robocopy_failure('robocopy sync', proc)
    tail = [l for l in proc.stdout.splitlines() if l.strip()][-8:]
    for line in tail:
        print(f'  {line.strip()}')
    print(f'  sync ok (robocopy exit {proc.returncode})')


def validate_scene(scene: str) -> None:
    """Assert a scene exists on the laptop as BOTH halves: the sim
    scene_config.yaml and the engine model js. Reused by deploy_prod's preflight
    (so a typo fails BEFORE the stack is stopped) and by write_boot_scene.
    """
    scene_cfg = REPO_ROOT / 'simulation' / 'scenes' / scene / 'scene_config.yaml'
    model = REPO_ROOT / 'marsin_engine' / 'models' / f'{scene}.js'
    if not scene_cfg.is_file():
        fail(f'scene {scene!r} has no scene_config.yaml ({scene_cfg}) - refusing to set it')
    if not model.is_file():
        fail(f'scene {scene!r} has no engine model ({model}) - refusing to set it')


def write_boot_scene(name: str, scene: str) -> None:
    """Set the machine's boot scene in the PRIVATE $BM26_MACHINES manifest.

    The laptop's private machines.yaml is the source of truth; ship_manifest()
    then copies it to the server (the derived copy boot_server.ps1 reads). We
    validate the scene against the tree being shipped, then rewrite only this
    machine's scene line, preserving every other block and the file's comments.
    Cheap double-validation with the preflight check is intentional - this is the
    last gate before the manifest is written.
    """
    validate_scene(scene)
    manifest = manifest_path()
    lines = read_text_utf8(manifest, 'machines.yaml').splitlines()
    in_block, wrote = False, False
    for i, line in enumerate(lines):
        stripped, indent = line.strip(), len(line) - len(line.lstrip(' '))
        if indent == 2 and stripped.rstrip(':').strip().lower() == name.lower():
            in_block = True
            continue
        if in_block and indent <= 2 and stripped and not stripped.startswith('#'):
            break
        if in_block and indent == 4 and stripped.startswith('scene:'):
            lines[i] = f'    scene: {scene}'
            wrote = True
            break
    if not wrote:
        fail(f'could not find a scene: line for {name!r} in {manifest}')
    # Preserve the private file's LF line endings (it lives in a normal git tree,
    # not the CRLF-world server dest); ship_manifest() normalizes for the server.
    manifest.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'  boot scene -> {scene} (in {manifest})')


def ship_manifest(unc: str) -> None:
    """Copy the private $BM26_MACHINES manifest onto the server (docs/43).

    machines.yaml is not in this repo, so /MIR neither carries nor keeps it (see
    SYNC_EXCLUDE_FILES). The server's boot_server.ps1 still reads
    deploy\\machines.yaml next to itself, so after the sync we ship the laptop's
    source-of-truth copy to <dest>\\deploy\\machines.yaml. That derived server
    copy is what boot_server.ps1 reads and set_boot.ps1 may locally override.
    """
    src = manifest_path()
    dest = Path(unc) / 'deploy' / 'machines.yaml'
    dest.parent.mkdir(parents=True, exist_ok=True)
    # CRLF for the CRLF-world dest (see stamp_deploy_info) - keeps the server copy
    # consistent with the rest of the deployed Windows tree.
    text = read_text_utf8(src, 'machines.yaml')
    dest.write_bytes(('\r\n'.join(text.splitlines()) + '\r\n').encode('utf-8'))
    print(f'  shipped machines.yaml -> {dest}')


def install_desktop_shortcuts(entry: dict, plan: dict) -> None:
    """Install and verify the operator URL shortcuts as the SSH identity.

    The setup script resolves that user's Windows Known Folder desktop, writes
    only ``.url`` files, and verifies their exact offline localhost targets.
    Running it after the sync guarantees new and existing servers use the
    version shipped by this deployment.
    """
    script = f'{entry["dest"]}\\deploy\\setup\\install_desktop_shortcuts.ps1'
    user = entry['ssh_user']
    root = entry['share_root'].rstrip('\\')
    assets = f'{root}\\operator_shortcuts\\icons'
    command = (f'powershell -NoProfile -ExecutionPolicy Bypass -File "{script}" '
               f'-ExpectedUser "{user}" -RepoRoot "{entry["dest"]}" '
               f'-LauncherProfile "{plan["launcherProfile"]}" '
               f'-Scene "{plan["scene"]}" -AssetsPath "{assets}" '
               f'-ExpectedPlanHash "{plan["hash"]}"')
    proc = ssh_run(entry, command, check=False, timeout=60)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or '').strip()
        fail(f'desktop shortcut installation failed for SSH identity {user!r}:\n{detail}')
    output = (proc.stdout or '').strip()
    if 'DESKTOP SHORTCUTS VERIFIED' not in output:
        fail('desktop shortcut installer exited zero without its verification banner - '
             f'refusing an unproven install:\n{output}')
    if f'plan={plan["hash"]}' not in output:
        fail('desktop shortcut installer verified a different machine/profile plan; '
             'refusing drift between laptop preview and deployed settings')
    for line in output.splitlines():
        if line.strip():
            print(f'  {line.strip()}')


def merge_yaml_fragment(base: Path, fragment: Path) -> str:
    """Deep-merge one YAML overlay fragment over its tracked base file.

    Shells out to node + js-yaml (cwd=marsin_engine so the require resolves):
    maps merge recursively, arrays and scalars REPLACE. Returns the merged YAML
    text. A missing base, a malformed fragment, or any merge failure is a loud
    FAIL (codex P0 - no silent fallback).
    """
    if not base.is_file():
        fail(f'overlay fragment {fragment} has no tracked base at {base} - a .yaml '
             f'overlay must sit at the same repo-relative path as a tracked file')
    proc = run(['node', '-e', MERGE_JS, str(base), str(fragment)],
               check=False, timeout=60, cwd=str(MARSIN_ENGINE_DIR))
    if proc.returncode != 0:
        fail(f'YAML overlay merge FAILED for {fragment.name} (node exit '
             f'{proc.returncode}):\n{(proc.stderr or proc.stdout).strip()}')
    return proc.stdout


def resolve_shortcut_plan(name: str, entry: dict, scene: str) -> dict:
    """Resolve exact operator URLs from launcher profile + effective config.

    A machine overlay may replace simulation/config.yaml after the mirror. For
    preview parity, merge that one fragment into an isolated ~/tmp file and
    point the same Node resolver used on the server at that effective config.
    """
    base = REPO_ROOT / 'simulation' / 'config.yaml'
    fragment = OVERLAYS_ROOT / name / 'simulation' / 'config.yaml'
    effective = base
    temporary = None
    if fragment.is_file():
        scratch = Path.home() / 'tmp'
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
                mode='w', encoding='utf-8', suffix='.yaml',
                prefix='bm26_shortcut_config_', dir=scratch, delete=False) as handle:
            handle.write(merge_yaml_fragment(base, fragment))
            temporary = Path(handle.name)
        effective = temporary
    planner = REPO_ROOT / 'deploy' / 'setup' / 'shortcut_plan.cjs'
    environment = os.environ.copy()
    environment['BM26_SIM_CONFIG'] = str(effective)
    try:
        proc = run(
            ['node', str(planner), str(REPO_ROOT), entry['profile'], scene],
            check=False,
            timeout=30,
            cwd=str(REPO_ROOT),
            env=environment,
        )
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    if proc.returncode != 0:
        fail('operator shortcut plan resolution failed before stack stop: '
             f'{(proc.stderr or proc.stdout).strip()}')
    raw = (proc.stdout or '').strip()
    try:
        plan = json.loads(raw)
    except json.JSONDecodeError:
        fail('operator shortcut planner returned malformed JSON before stack stop')
    required = {
        'scene', 'launcherProfile', 'lightingProfile',
        'simulation', 'audio', 'captainpad',
    }
    if set(plan) != required:
        fail('operator shortcut planner returned an incomplete or unknown schema')
    for key in ('simulation', 'audio', 'captainpad'):
        if not plan[key].startswith('http://localhost:'):
            fail(f'operator shortcut {key} URL is not an offline localhost target')
    plan['hash'] = hashlib.sha256(raw.encode('utf-8')).hexdigest()
    return plan


def print_shortcut_plan(plan: dict) -> None:
    """Print the exact non-secret URL plan during preflight and dry-run."""
    print(f'  shortcut plan: scene={plan["scene"]}, launcher={plan["launcherProfile"]}, '
          f'lighting={plan["lightingProfile"]}')
    print(f'    Titanic Simulation -> {plan["simulation"]}')
    print(f'    Audio Companion -> {plan["audio"]}')
    print(f'    CaptainPad Web -> {plan["captainpad"]}')


def apply_overlay(unc: str, name: str) -> None:
    """Apply this machine's overlay OVERRIDES onto the prod dest.

    Overlay files are OVERRIDES, not a full config (operator ruling 2026-07-20 -
    keep them minimal, only the diff from the tracked config):
      - `.yaml` files are MERGE FRAGMENTS: deep-merged over the same
        repo-relative tracked file (maps merge recursively; arrays and scalars
        REPLACE), and the merged result is written to the dest.
      - any non-`.yaml` file keeps full-copy semantics (written byte-for-byte
        over the dest).

    A MISSING or EMPTY overlay dir is legal: the tracked config is the correct
    default (operator ruling 2026-07-20). Git cannot track empty dirs, so a
    missing dir MUST be allowed - this is not a fallback, it is the default.
    """
    overlay = OVERLAYS_ROOT / name
    files = [p for p in overlay.rglob('*') if p.is_file()] if overlay.is_dir() else []
    if not files:
        print('  no overlay overrides - tracked config runs as-is (operator default)')
        return
    for src in files:
        rel = src.relative_to(overlay)
        dest = Path(unc) / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if src.suffix == '.yml':
            fail(f'overlay fragment {rel} uses .yml - merge semantics are .yaml-only by '
                 f'convention; rename it to .yaml (a .yml would silently full-copy over '
                 f'the tracked file instead of deep-merging)')
        if src.suffix == '.yaml':
            dest.write_text(merge_yaml_fragment(REPO_ROOT / rel, src), encoding='utf-8')
            print(f'  overlay: {rel} -> deep-merged over tracked base')
        else:
            shutil.copyfile(src, dest)
            print(f'  overlay: {rel} -> copied (full-file override)')


def stamp_deploy_info(unc: str, name: str, info: dict) -> None:
    """Write deploy_info.yaml at the deployed root (provenance for /status + audits)."""
    lines = [
        '# deploy_info.yaml - written by deploy/deploy.py on every deploy. Do not edit.',
        f'machine: {name}',
        f'git_head: {info["head"]}',
        f'git_branch: {info["branch"]}',
        f'dirty_files_at_deploy: {info["dirty_count"]}',
        f'deployed_at: {datetime.now().isoformat(timespec="seconds")}',
        f'source_host: {socket.gethostname()}',
    ]
    # CRLF for the CRLF-world dest (see write_boot_scene) - avoids re-sync churn.
    (Path(unc) / 'deploy_info.yaml').write_bytes(('\r\n'.join(lines) + '\r\n').encode('utf-8'))
    print(f'  stamped deploy_info.yaml ({info["head"]} on {info["branch"]}, '
          f'{info["dirty_count"]} dirty file(s))')


def start_stack(entry: dict) -> None:
    """Start the boot task - the stack must run in titanic's logged-on session
    (audio/devices), NEVER directly inside this SSH session.
    """
    boot_script = f'{entry["dest"]}\\deploy\\boot_server.ps1'
    launch_contract = "$launchArgs = @($launcher, $profile, '--scene', $scene, '--no-launch')"
    ssh_run(
        entry,
        f'findstr /L /C:"{launch_contract}" "{boot_script}"',
        timeout=30,
    )
    print('  boot contract ok: launcher invocation includes --no-launch')
    ssh_run(entry, f'schtasks /Run /TN {BOOT_TASK}', timeout=60)
    print(f'  schtasks /Run {BOOT_TASK} -> ok')


def http_json(url: str, timeout: int = 5) -> dict | None:
    """GET a JSON endpoint; None while it is not answering (poll helper)."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def http_up(url: str, timeout: int = 5) -> bool:
    """True when the URL answers 2xx/3xx."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return 200 <= resp.status < 400
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def _ports_quiet(entry: dict) -> bool:
    """True when neither the engine (:6968) nor the sim (:6969) port answers -
    i.e. the stack is down. Shared by confirm_stack_stopped and stop_machine.
    """
    host = entry['host']
    return (not http_up(f'http://{host}:{ENGINE_PORT}/status')
            and not http_up(f'http://{host}:{SIM_PORT}/simulation/'))


def read_boot_status(entry: dict, required: bool = True) -> dict | None:
    """Parse the supervisor's boot_status.yaml (fetched over scp - verify must
    work even when SMB creds are absent, e.g. --restart-only from a fresh laptop).

    required=True (one-shot callers): a failed scp is a hard fail(). required=False
    (polling callers inside a retry window): a transient scp failure returns None
    so the caller counts it as a MISSED POLL and retries until its own timeout -
    a flaky control channel must not abort a deploy that is otherwise healthy.
    """
    FETCH_DIR.mkdir(parents=True, exist_ok=True)
    local = FETCH_DIR / 'boot_status.yaml'
    local.unlink(missing_ok=True)
    target = f"{entry['ssh_user']}@{entry['host']}"
    proc = run(['scp', *SSH_OPTS, f'{target}:C:/titanic/logs/boot_status.yaml',
                str(local)], check=False, timeout=60)
    if proc.returncode != 0 or not local.is_file():
        if not required:
            return None
        fail(f'could not fetch C:\\titanic\\logs\\boot_status.yaml from {target} - '
             f'did the supervisor start?\n  {(proc.stderr or "").strip()}')
    status = {}
    # Tolerant decode: boot_status is server-written; a stray non-UTF-8 byte must
    # not crash verify - we only pull a handful of ascii keys out of it.
    for line in local.read_text(encoding='utf-8', errors='replace').splitlines():
        if ':' in line and not line.lstrip().startswith('#'):
            key, _, value = line.partition(':')
            status[key.strip()] = value.strip()
    return status


def capture_server_time(entry: dict) -> str:
    """Read the SERVER's own wall clock over SSH, in boot_status's timestamp
    format (yyyy-MM-ddTHH:mm:ss). Captured just before start_stack so verify can
    prove boot_status belongs to THIS run. The laptop clock must NEVER be
    compared to server-written timestamps - clock skew or a timezone difference
    would flag a healthy stack as stale (or pass a genuinely stale one).
    """
    proc = ssh_run(
        entry, "powershell -NoProfile -Command \"Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'\"",
        timeout=30)
    stamps = [l.strip() for l in proc.stdout.splitlines() if l.strip()]
    if not stamps or _parse_status_time(stamps[-1]) is None:
        fail(f'could not read a parseable server time from {entry["host"]} '
             f'(got {proc.stdout!r})')
    return stamps[-1]


def _parse_status_time(text: str) -> datetime | None:
    """Parse a boot_status timestamp (yyyy-MM-ddTHH:mm:ss); None if unparseable."""
    try:
        return datetime.strptime(text, '%Y-%m-%dT%H:%M:%S')
    except (ValueError, TypeError):
        return None


def _restart_count(boot: dict) -> int | None:
    """restart_count as int, or None when missing/unparseable (status unreadable)."""
    raw = boot.get('restart_count')
    if raw is None:
        return None
    try:
        return int(raw)
    except (ValueError, TypeError):
        return None


def wait_for_fresh_status(entry: dict, server_start: str, deadline: float) -> dict:
    """Poll boot_status.yaml until it is bound to THIS run: its last_update (or
    last_start) is at/after the server time captured before start_stack.

    read_boot_status scp's a file that could be a STALE leftover from the
    previous supervisor, so an old-but-parseable status must not pass. Keep
    polling until fresh; at the timeout, fail loudly as a stale-status error.
    """
    start_dt = _parse_status_time(server_start)
    if start_dt is None:
        fail(f'captured server start time {server_start!r} is unparseable')
    last = None
    while time.monotonic() < deadline:
        boot = read_boot_status(entry, required=False)
        if boot is None:  # transient scp failure - missed poll, keep trying
            time.sleep(VERIFY_POLL_S)
            continue
        last = boot
        stamp = boot.get('last_update') or boot.get('last_start')
        stamp_dt = _parse_status_time(stamp) if stamp else None
        if stamp_dt is not None and stamp_dt >= start_dt:
            print(f'  boot_status current: last_update={boot.get("last_update")!r} '
                  f'>= server start {server_start}')
            return boot
        time.sleep(VERIFY_POLL_S)
    seen = last.get('last_update') if last else None
    fail(f'supervisor status is stale - did the boot task actually start? '
         f'boot_status last_update={seen!r} is not >= server start {server_start} '
         f'within {VERIFY_TIMEOUT_S}s; check '
         f'\\\\{entry["host"]}\\titanic\\logs\\boot_server_*.log')


def read_restart_count(entry: dict, boot: dict | None, deadline: float) -> int:
    """restart_count as int; a missing/unparseable value (or a boot dict that
    could not be fetched, boot=None) is 'status unreadable' - re-fetch within the
    verify timeout, then fail loudly. Never a fake -1. A transient scp failure on
    the re-fetch is itself just a missed poll (read_boot_status required=False).
    """
    count = _restart_count(boot) if boot is not None else None
    while count is None and time.monotonic() < deadline:
        time.sleep(VERIFY_POLL_S)
        boot = read_boot_status(entry, required=False)
        count = _restart_count(boot) if boot is not None else None
    if count is None:
        fail(f'supervisor restart_count is missing/unparseable in boot_status.yaml '
             f'- status unreadable; check '
             f'\\\\{entry["host"]}\\titanic\\logs\\boot_server_*.log')
    return count


def assert_stable_supervisor(entry: dict, boot: dict | None, deadline: float) -> None:
    """Crash-loop check by STABILITY: the count must not CHANGE at all.

    restart_count is monotonic *within one supervisor lifetime* - boot_server.ps1
    bumps it on EVERY launcher exit, benign ones included - so a stable nonzero
    count with the engine up on the right scene is healthy. Read the count twice
    ~STABILITY_GAP_S apart (RestartDelaySeconds=10 + margin) and fail on ANY
    change:
      - count ROSE  -> the launcher is exiting and being relaunched: a live crash
        loop under a still-running supervisor.
      - count FELL  -> restart_count resets when the supervisor process restarts,
        so a lower value means the SUPERVISOR itself died and the boot task
        relaunched it (a fresh lifetime) - also unhealthy.
    Only an unchanged count is a pass. A transient scp failure on the second read
    is a missed poll, retried until the deadline (never a hard fail on its own).
    """
    first = read_restart_count(entry, boot, deadline)
    time.sleep(STABILITY_GAP_S)
    boot2 = read_boot_status(entry, required=False)
    while boot2 is None and time.monotonic() < deadline:
        time.sleep(VERIFY_POLL_S)
        boot2 = read_boot_status(entry, required=False)
    if boot2 is None:
        fail(f'could not re-read boot_status.yaml for the stability check within the '
             f'verify budget - control channel to {entry["host"]} unreachable; check '
             f'\\\\{entry["host"]}\\titanic\\logs\\boot_server_*.log')
    second = read_restart_count(entry, boot2, deadline)
    if second > first:
        fail(f'supervisor is crash-looping: restart_count rose {first} -> {second} '
             f'across {STABILITY_GAP_S}s (last_exit_code={boot2.get("last_exit_code")}) '
             f'- the launcher keeps exiting and being relaunched; check '
             f'\\\\{entry["host"]}\\titanic\\logs\\boot_server_*.log')
    if second < first:
        fail(f'supervisor process itself died and was relaunched by the boot task: '
             f'restart_count FELL {first} -> {second} across {STABILITY_GAP_S}s '
             f'(the count resets with a fresh supervisor lifetime, so a lower value '
             f'means boot_server.ps1 restarted) - also unhealthy; check '
             f'\\\\{entry["host"]}\\titanic\\logs\\boot_server_*.log')
    note = 'no restarts' if second == 0 else f'{second} benign restart(s), stable'
    print(f'  supervisor ok: restart_count stable at {second} ({note}; scene '
          f'{boot2.get("scene")!r}, host {boot2.get("hostname")!r})')


def verify_prod(entry: dict, expected_scene: str, server_start: str) -> None:
    """From the laptop: engine up on the expected scene, sim up, and the
    supervisor bound to THIS run and not crash-looping.

    server_start is the server-side wall clock captured just before start_stack;
    it binds boot_status to this deploy (a stale leftover must not pass) and the
    supervisor health test is a STABILITY check (two restart_count reads), never
    an absolute restart_count==0 (which a benign restart would false-fail).
    """
    host = entry['host']
    engine_url = f'http://{host}:{ENGINE_PORT}/status'
    print(f'  polling {engine_url} (timeout {VERIFY_TIMEOUT_S}s) ...')
    deadline = time.monotonic() + VERIFY_TIMEOUT_S
    status = None
    while time.monotonic() < deadline:
        status = http_json(engine_url)
        if status is not None:
            break
        time.sleep(VERIFY_POLL_S)
    if status is None:
        fail(f'engine did not answer on {engine_url} within {VERIFY_TIMEOUT_S}s - '
             f'check \\\\{host}\\titanic\\logs\\boot_server_*.log')
    model = status.get('activeModel')
    if model != expected_scene:
        fail(f'engine is up on the WRONG scene: activeModel={model!r}, expected '
             f'{expected_scene!r}')
    print(f'  engine ok: activeModel={model}')
    sim_url = f'http://{host}:{SIM_PORT}/simulation/'
    if not http_up(sim_url):
        fail(f'sim not answering at {sim_url}')
    print(f'  sim ok: {sim_url}')
    boot = wait_for_fresh_status(entry, server_start, deadline)
    assert_stable_supervisor(entry, boot, deadline)


def deploy_prod(name: str, entry: dict, args: argparse.Namespace) -> None:
    """The full docs/43 prod pipeline (or the --dry-run / --restart-only subsets)."""
    force_fast = bool(getattr(args, 'force', False))
    info = git_info()
    step(f'1/8 preflight ({name} = prod, laptop {info["head"]} on {info["branch"]}, '
         f'{info["dirty_count"]} dirty)')
    local_secrets = secrets_path()
    print('  local runtime secrets valid (path and values redacted)')
    preflight_ssh(name, entry)
    expected_scene = args.scene or entry['scene']
    # Validate --scene before any remote mutation: a typo must fail while the
    # current stack and its private deployment state are both untouched.
    if args.scene:
        validate_scene(args.scene)
    shortcut_plan = resolve_shortcut_plan(name, entry, expected_scene)
    print_shortcut_plan(shortcut_plan)
    if args.dry_run:
        ready, status = probe_runtime_secrets(entry)
        state = status if ready else f'not ready ({status})'
        print(f'  runtime secrets currently {state}; a real deploy would securely '
              'refresh the private file + ACL + Machine-scope path before stack stop')
    else:
        provision_runtime_secrets(entry, local_secrets)
    if not args.restart_only:
        unc = preflight_smb(name, entry)
        if force_fast:
            print('  PROD --force FAST PATH: list-only preview skipped; '
                  'the real /MIR remains authoritative')
        else:
            show_sync_preview(unc)
    if args.dry_run:
        print('\n--dry-run: stopping here (nothing was changed on the server).')
        return
    step('2/8 stop stack')
    stop_stack(entry)
    # From here on the live stack is DOWN; any fail() must tell the operator so.
    global _stopped_machine
    _stopped_machine = name
    if args.restart_only:
        print('\n--restart-only: skipping sync/scene/overlay/stamp.')
    else:
        step('3/8 sync working tree (robocopy /MIR)')
        sync_prod(unc, force_fast=force_fast)
        step('4/8 boot scene + manifest')
        if args.scene:
            write_boot_scene(name, args.scene)
        else:
            print(f'  keeping manifest scene: {entry["scene"]}')
        # Ship the private machines.yaml LAST (after any --scene edit to the
        # source of truth), so the server's derived copy matches the laptop.
        ship_manifest(unc)
        step('5/8 apply overlay + operator shortcuts')
        apply_overlay(unc, name)
        install_desktop_shortcuts(entry, shortcut_plan)
        step('6/8 stamp deploy_info.yaml')
        stamp_deploy_info(unc, name, info)
    step('7/8 start stack')
    # Capture the SERVER clock BEFORE the stack starts so verify can prove the
    # supervisor's boot_status belongs to this run (never the laptop clock).
    server_start = capture_server_time(entry)
    print(f'  server time at start: {server_start}')
    start_stack(entry)
    # The stack has been (re)started: it is UP, not "STOPPED by this deploy and
    # still down". Clear the flag so a later verify failure (e.g. an unstable
    # supervisor) does NOT append the false "still down" note - the stack is up,
    # just unhealthy, and that fail message says so itself.
    _stopped_machine = None
    step(f'8/8 verify (expected scene: {expected_scene})')
    verify_prod(entry, expected_scene, server_start)
    print(f'\nDEPLOY OK: {name} is running {expected_scene} from {info["head"]}.')


# ── Remote lifecycle (stop / start) ──────────────────────────────────────────

def stop_machine(name: str, entry: dict) -> None:
    """Park a machine: stop its running stack and confirm the ports go quiet.

    Reuses the deploy pipeline's stop_stack (schtasks /End + launcher stop + the
    port-quiet confirmation) - no logic is duplicated. Loud either way:
    already-stopped is fine and said so; a stack that refuses to go down is the
    confirm_stack_stopped fail path (nonzero exit naming the orphaned port).
    """
    step(f'stop stack ({name})')
    # 'Already stopped' means the ports were quiet BEFORE we touched anything -
    # probe them at entry. (stop_stack's launcher-rc heuristic can't tell an
    # orphaned engine on a quiet boot task from a genuinely idle machine.)
    was_quiet = _ports_quiet(entry)
    stop_stack(entry)
    state = 'was ALREADY STOPPED (nothing was running)' if was_quiet else 'is now STOPPED'
    print(f'\nSTACK STOPPED: {name} {state} - lights are OFF until '
          f"'start', a reboot, or the next deploy.")


def start_machine(name: str, entry: dict, args: argparse.Namespace) -> None:
    """Bring a machine back: start its stack and (default) verify it came up.

    Order mirrors the deploy pipeline's start phase exactly, reusing its helpers:
    capture_server_time (binds boot_status to THIS run) -> start_stack (schtasks
    /Run, so the stack runs in titanic's logged-on session, never the SSH one) ->
    verify_prod against the machine's manifest scene. --no-verify fires the boot
    task and returns WITHOUT the laptop-side health poll - use it only when the
    show LAN is unreachable; you then confirm the lights yourself.
    """
    scene = entry['scene']
    step(f'start stack ({name}, scene {scene})')
    # Short-circuit if the stack is ALREADY up: firing a second boot task on a
    # live engine wedges on port contention and reads as a fake "stale status"
    # failure ~5 minutes later. Probe the engine first; a matching scene = done.
    running = http_json(f'http://{entry["host"]}:{ENGINE_PORT}/status')
    if running is not None:
        active = running.get('activeModel')
        if active == scene:
            # A single /status match is NOT proof of health: the engine can be up
            # while the supervisor is crash-looping (relaunching it), or the
            # supervisor itself may have just restarted. Run the same two-read
            # stability check verify uses (two restart_count reads ~15s apart)
            # before declaring done - no fresh-status binding needed here.
            deadline = time.monotonic() + VERIFY_TIMEOUT_S
            boot = read_boot_status(entry, required=False)
            assert_stable_supervisor(entry, boot, deadline)
            print(f'\nSTACK ALREADY RUNNING: {name} on {scene} - nothing to do.')
            return
        fail(f'stack ALREADY RUNNING on the WRONG scene: activeModel={active!r}, '
             f'manifest scene={scene!r} - use deploy (to change scene) or stop then '
             f'start; refusing to fire a second boot task onto a live stack')
    # Capture the SERVER clock BEFORE the stack starts so verify can prove the
    # supervisor's boot_status belongs to this run (never the laptop clock).
    server_start = capture_server_time(entry)
    print(f'  server time at start: {server_start}')
    start_stack(entry)
    if not args.verify:
        print(f'\nSTACK START TRIGGERED: {name} - schtasks /Run fired, verify SKIPPED '
              f'(--no-verify). Confirm the lights came up yourself.')
        return
    step(f'verify (expected scene: {scene})')
    verify_prod(entry, scene, server_start)
    print(f'\nSTACK STARTED: {name} is running {scene} - lights are ON.')


# ── Deploy to scratch ───────────────────────────────────────────────────────

def scratch_dirty_files(entry: dict) -> list[str]:
    """List uncommitted changes in the server's scratch tree (empty = clean)."""
    proc = ssh_run(entry, f'git -C "{entry["scratch_dest"]}" status --porcelain', timeout=60)
    return [l for l in proc.stdout.splitlines() if l.strip()]


def deploy_scratch(name: str, entry: dict, args: argparse.Namespace) -> None:
    """Code-only sync of the laptop's TRACKED files into the server's scratch
    workspace, over SSH (tar stream - no SMB needed).

    Deliberate semantics (also in deploy/README.md): only tracked files EXCEPT
    marsin_engine/states/** are written; the server's .git, its
    marsin_engine/states/** (engine-mutated live tuning), and any untracked
    scratch work are never touched; laptop-side deletions do NOT propagate
    (this is a working tree humans/agents live in, not a mirror). A dirty
    scratch tree aborts unless --force - never silently clobber WIP.
    """
    step(f'1/3 preflight ({name} = scratch)')
    preflight_ssh(name, entry)
    dirty = scratch_dirty_files(entry)
    if dirty:
        print(f'  scratch tree has {len(dirty)} uncommitted change(s):')
        for line in dirty[:20]:
            print(f'    {line}')
        if len(dirty) > 20:
            print(f'    ... and {len(dirty) - 20} more')
        if not args.force:
            fail('scratch tree is dirty - tracked-file collisions would be overwritten. '
                 'Commit/stash on the server, or re-run with --force to overwrite.')
        print('  --force: proceeding; colliding tracked files WILL be overwritten.')
    else:
        print('  scratch tree clean')
    step('2/3 sync tracked files (tar over SSH)')
    all_tracked = [f for f in run(['git', '-C', str(REPO_ROOT), 'ls-files', '-z'])
                   .stdout.split('\0') if f]
    kept = [f for f in all_tracked
            if not any(f.startswith(p) for p in SCRATCH_EXCLUDE_PREFIXES)]
    excluded = len(all_tracked) - len(kept)
    print(f'  excluded {excluded} server-owned state file(s) '
          f'({", ".join(SCRATCH_EXCLUDE_PREFIXES)} - engine-mutated, never overwritten)')
    # git ls-files still lists tracked paths that are DELETED from the working
    # tree (pending deletions). tar would abort on the first missing file, so
    # drop them - the working tree is the deploy truth here. We do NOT touch the
    # git index; the deletion is staged/committed through normal git elsewhere.
    tracked_files = [f for f in kept if (REPO_ROOT / f).is_file()]
    missing = len(kept) - len(tracked_files)
    print(f'  skipped {missing} tracked-but-missing path(s) (deleted from the '
          f'working tree, pending deletion - not shipped)')
    list_file = FETCH_DIR / 'scratch_sync_files.txt'
    FETCH_DIR.mkdir(parents=True, exist_ok=True)
    list_file.write_bytes(''.join(f + '\0' for f in tracked_files).encode('utf-8'))
    count = len(tracked_files)
    tar_cmd = ['tar', '-c', '-f', '-', '-C', str(REPO_ROOT), '--null', '-T', str(list_file)]
    ssh_cmd = ['ssh', *SSH_OPTS, f"{entry['ssh_user']}@{entry['host']}",
               f'tar -x -f - -C "{entry["scratch_dest"]}"']
    tar_proc = subprocess.Popen(tar_cmd, stdout=subprocess.PIPE)
    ssh_proc = subprocess.Popen(ssh_cmd, stdin=tar_proc.stdout,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    tar_proc.stdout.close()
    try:
        _, ssh_err = ssh_proc.communicate(timeout=1800)
    except subprocess.TimeoutExpired:
        # Kill BOTH ends of the pipe so neither is orphaned, then fail loudly
        # naming the timeout (codex P0 - no silent hang, no bare traceback). The
        # server scratch tree may be partially written; a re-run converges it.
        ssh_proc.kill()
        tar_proc.kill()
        ssh_proc.wait()
        tar_proc.wait()
        fail('scratch tar-over-SSH stream timed out after 1800s - killed both '
             'the local tar and remote ssh; the server scratch tree may be '
             'partially written (re-run to converge).')
    if tar_proc.wait() != 0:
        fail(f'local tar failed (rc {tar_proc.returncode})')
    if ssh_proc.returncode != 0:
        fail(f'remote tar extract failed (rc {ssh_proc.returncode}):\n{ssh_err}')
    print(f'  streamed {count} tracked file(s) -> {entry["scratch_dest"]}')
    step('3/3 spot-check hashes')
    for rel in SCRATCH_SPOT_CHECK:
        local_hash = hashlib.sha256((REPO_ROOT / rel).read_bytes()).hexdigest()
        remote = rel.replace('/', '\\')
        proc = ssh_run(entry, f'certutil -hashfile "{entry["scratch_dest"]}\\{remote}" SHA256',
                       timeout=60)
        remote_hash = proc.stdout.splitlines()[1].strip().lower()
        if remote_hash != local_hash:
            fail(f'hash mismatch after sync on {rel}: laptop {local_hash[:12]} vs '
                 f'server {remote_hash[:12]}')
        print(f'  {rel}: sha256 match ({local_hash[:12]}...)')
    print(f'\nSCRATCH SYNC OK: {count} tracked files, .git/states/untracked untouched.')


# ── Fetch ───────────────────────────────────────────────────────────────────

def fetch_tree(name: str, entry: dict, source: str) -> None:
    """Bundle the server scratch tree's branches over SSH and fetch them into
    refs/remotes/<machine>-<source>/* on the laptop. Never merges anything.
    The bundle file on the server (C:\\titanic\\fetch_<source>.bundle) is the
    only server-side write - outside both trees, overwritten per fetch.
    """
    if source != 'scratch':
        fail('prod git fetch is retired: production .git is excluded from deploys '
             'and may be stale. Make durable server-side commits in scratch, then '
             'fetch with --source scratch. Runtime state remains available via --state.')
    tree = entry['scratch_dest']
    remote_bundle = f'C:\\titanic\\fetch_{source}.bundle'
    step(f'fetch {source} ({tree})')
    ssh_run(entry, f'cd /d "{tree}" && git bundle create {remote_bundle} --branches',
            timeout=300)
    FETCH_DIR.mkdir(parents=True, exist_ok=True)
    local_bundle = FETCH_DIR / f'{name}_{source}.bundle'
    run(['scp', *SSH_OPTS, f"{entry['ssh_user']}@{entry['host']}:"
         + remote_bundle.replace('\\', '/'), str(local_bundle)], timeout=600)
    run(['git', '-C', str(REPO_ROOT), 'bundle', 'verify', str(local_bundle)])
    proc = run(['git', '-C', str(REPO_ROOT), 'fetch', str(local_bundle),
                f'+refs/heads/*:refs/remotes/{name}-{source}/*'])
    arrived = (proc.stderr or '').strip()
    print(arrived if arrived else '  (no ref changes - laptop already has everything)')
    print(f'  refs live under: refs/remotes/{name}-{source}/*  (curate per '
          f'.agent/os/git.md - dev/* branches are never pushed as-is)')


def fetch_state(name: str, entry: dict) -> None:
    """Snapshot prod runtime state + supervisor status into ~/tmp (inspection
    only - never committed; the laptop repo is not touched).
    """
    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    snap = SNAPSHOT_ROOT / name / stamp
    snap.mkdir(parents=True, exist_ok=True)
    target = f"{entry['ssh_user']}@{entry['host']}"
    states = entry['dest'].replace('\\', '/') + '/marsin_engine/states'
    step(f'state snapshot -> {snap}')
    run(['scp', *SSH_OPTS, '-r', f'{target}:{states}', str(snap / 'states')], timeout=600)
    run(['scp', *SSH_OPTS, f'{target}:C:/titanic/logs/boot_status.yaml',
         str(snap / 'boot_status.yaml')], timeout=120)
    boot = (snap / 'boot_status.yaml').read_text(encoding='utf-8', errors='replace')
    print(f'  snapshot complete. boot_status.yaml:')
    for line in boot.splitlines():
        if not line.startswith('#'):
            print(f'    {line}')


# ── CLI ─────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    """CLI: deploy (prod|scratch), fetch scratch/state, stop, start (docs/43)."""
    parser = argparse.ArgumentParser(
        prog='deploy.py', description='BM26 show-server deploy/fetch/lifecycle (docs/43 Phase 2)')
    sub = parser.add_subparsers(dest='op', required=True)
    dep = sub.add_parser('deploy', help='ship the laptop tree to a server')
    dep.add_argument('--machine', required=True, help='machine key in the $BM26_MACHINES manifest')
    dep.add_argument('--target', choices=['prod', 'scratch'], default='prod')
    dep.add_argument('--scene', help='(prod) set the boot scene in the deployed manifest')
    dep.add_argument('--dry-run', action='store_true',
                     help='(prod) preflight + robocopy /L preview only')
    dep.add_argument('--restart-only', action='store_true',
                     help='(prod) stop/start/verify without touching files')
    dep.add_argument('--force', action='store_true',
                     help='prod: skip preview + use fast mirror; '
                          'scratch: overwrite a dirty tree')
    fet = sub.add_parser('fetch', help='collect on-server git work / runtime state')
    fet.add_argument('--machine', required=True, help='machine key in the $BM26_MACHINES manifest')
    # Keep the retired spellings parseable so old field commands receive the
    # explicit migration error in main(), not argparse's context-free rejection.
    fet.add_argument('--source', choices=['prod', 'scratch', 'both'], default='scratch')
    fet.add_argument('--state', action='store_true',
                     help='also snapshot prod runtime state into ~/tmp')
    stp = sub.add_parser('stop', help="stop a machine's running stack (lights OFF)")
    stp.add_argument('--machine', required=True, help='machine key in the $BM26_MACHINES manifest')
    srt = sub.add_parser('start', help="start a machine's stack and verify it came up")
    srt.add_argument('--machine', required=True, help='machine key in the $BM26_MACHINES manifest')
    srt.add_argument('--verify', action=argparse.BooleanOptionalAction, default=True,
                     help='poll the machine after start to confirm the scene is live '
                          '(default on; --no-verify skips the poll)')
    return parser


def main() -> None:
    """Dispatch per docs/43: deploy prod / deploy scratch / fetch / stop / start."""
    args = build_parser().parse_args()
    if args.op == 'stop':
        entry = get_machine(args.machine, required=['host', 'ssh_user', 'dest'])
        stop_machine(args.machine, entry)
        return
    if args.op == 'start':
        entry = get_machine(args.machine, required=['host', 'ssh_user', 'dest', 'scene', 'profile'])
        start_machine(args.machine, entry, args)
        return
    if args.op == 'deploy' and args.target == 'prod':
        if args.force and args.dry_run:
            fail('--force is a real prod deploy and cannot combine with --dry-run')
        if args.force and args.restart_only:
            fail('--force changes sync behavior and cannot combine with --restart-only')
        if args.dry_run and args.restart_only:
            fail('--dry-run and --restart-only are mutually exclusive')
        if args.scene and args.restart_only:
            fail('--scene needs a sync; it cannot combine with --restart-only')
        entry = get_machine(args.machine, required=[
            'host', 'scene', 'profile', 'dest', 'share', 'share_root', 'ssh_user'])
        deploy_prod(args.machine, entry, args)
        return
    if args.op == 'deploy':
        if args.scene or args.dry_run or args.restart_only:
            fail('--scene/--dry-run/--restart-only only apply to --target prod')
        entry = get_machine(args.machine, required=['host', 'ssh_user', 'scratch_dest'])
        deploy_scratch(args.machine, entry, args)
        return
    if args.source != 'scratch':
        fail('prod git fetch is retired because production .git is no longer deployed. '
             'Use --source scratch for durable on-server work; add --state to snapshot '
             'production runtime state.')
    sources = ['scratch']
    required = ['host', 'ssh_user', 'scratch_dest']
    # --state snapshots prod runtime state (fetch_state reads entry['dest']), so
    # it needs 'dest' even when the git source is scratch-only.
    if args.state and 'dest' not in required:
        required.append('dest')
    entry = get_machine(args.machine, required=required)
    for source in sources:
        fetch_tree(args.machine, entry, source)
    if args.state:
        fetch_state(args.machine, entry)


if __name__ == '__main__':
    main()
