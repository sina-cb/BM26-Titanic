#!/usr/bin/env python3
"""
security_check.py — pre-commit secret/PII gate for a PUBLIC repo.

Scans the changes about to be committed with gitleaks, using the SAME
`.gitleaks.toml` config CI enforces, and blocks the commit when anything
is found. Governing spec: `.agent/os/security_privacy.md`.

Modes:
  --staged     Scan the staged changes (index vs HEAD). Used by the
               `.githooks/pre-commit` hook. Exit 0 = safe to commit,
               exit 1 = findings (or scanner unavailable) — commit blocked.
  --hook-gate  Claude Code PreToolUse gate. Reads the hook JSON from
               stdin; if the Bash command is a `git commit`, scans the
               staged changes PLUS tracked-but-unstaged modifications
               (covers `git commit -a`). Exit 0 = allow, exit 2 = block
               the tool call with an explanation on stderr.
  --all        Scan the entire working tree (slow; ad-hoc audits).

Scanner resolution: a native `gitleaks` binary on PATH, else Docker with
the pinned image. If neither exists the check FAILS (blocks the commit) —
per the codex there is no silent-skip fallback.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Keep in sync with GITLEAKS_VERSION in
# .github/workflows/security_privacy_scan.yml — config semantics (e.g. the
# [[allowlists]] syntax) differ across versions, and the local gate must
# agree with CI.
GITLEAKS_VERSION = "8.28.0"
DOCKER_IMAGE = f"zricethezav/gitleaks:v{GITLEAKS_VERSION}"

# Matches `git commit` (with options/paths between `git` and `commit`)
# but not e.g. `git log --grep=commit`.
GIT_COMMIT_RE = re.compile(r"\bgit(\s+-[^\s]+|\s+-C\s+\S+)*\s+commit\b")

PASS_BANNER = "SECURITY CHECK PASSED - no secrets/PII detected in the changes."
FAIL_BANNER = """\
SECURITY CHECK FAILED - DO NOT COMMIT.

The staged changes contain material that must not land in this PUBLIC
repo (secrets, MAC addresses, IPs, passwords, or PII). Fix it, restage,
and commit again:

  1. REDACT the value (almost always the right answer — e.g. IPs in
     reports become 10.x.x.NNN, MACs become AA:BB:CC:DD:EE:FF).
  2. If the value is genuinely safe, add `# gitleaks:allow` inline on
     that line.
  3. For prose where a comment doesn't fit, add the fingerprint printed
     above to .gitleaksignore.

Never bypass this check with --no-verify. Rules + rationale:
.agent/os/security_privacy.md
"""


def _run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def repo_root() -> Path:
    out = _run(["git", "rev-parse", "--show-toplevel"])
    if out.returncode != 0:
        sys.exit(f"security_check: not inside a git repo: {out.stderr.strip()}")
    return Path(out.stdout.strip())


def changed_files(root: Path, include_unstaged: bool) -> list[str]:
    """Paths whose content is about to be committed (deletions excluded)."""
    cmds = [["git", "diff", "--cached", "--name-only", "--diff-filter=d", "-z"]]
    if include_unstaged:
        # `git commit -a` stages tracked modifications at commit time, so
        # the gate must look at those too.
        cmds.append(["git", "diff", "--name-only", "--diff-filter=d", "-z"])
    files: list[str] = []
    for cmd in cmds:
        out = _run(cmd, cwd=root)
        if out.returncode != 0:
            sys.exit(f"security_check: {' '.join(cmd)} failed: {out.stderr.strip()}")
        files.extend(p for p in out.stdout.split("\0") if p)
    return sorted(set(files))


def snapshot(root: Path, files: list[str], include_unstaged: bool) -> Path:
    """Materialize the to-be-committed content into a temp dir, preserving
    repo-relative layout so path-based gitleaks rules apply correctly."""
    tmp = Path(tempfile.mkdtemp(prefix="bm26_seccheck_"))
    # Index content for staged files…
    out = _run(
        ["git", "checkout-index", f"--prefix={tmp.as_posix()}/", "--"] + files,
        cwd=root,
    )
    if out.returncode != 0:
        sys.exit(f"security_check: checkout-index failed: {out.stderr.strip()}")
    if include_unstaged:
        # …then worktree content wins for tracked-but-unstaged edits.
        unstaged = _run(
            ["git", "diff", "--name-only", "--diff-filter=d", "-z"], cwd=root
        ).stdout.split("\0")
        for rel in filter(None, unstaged):
            src, dst = root / rel, tmp / rel
            if src.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dst)
    return tmp


def run_gitleaks(scan_dir: Path, config: Path) -> int:
    """Run `gitleaks dir` over scan_dir. Returns the process exit code
    (0 = clean, nonzero = findings or error — both block)."""
    native = shutil.which("gitleaks")
    if native:
        proc = subprocess.run(
            [native, "dir", str(scan_dir), "--config", str(config),
             "--redact", "--no-banner", "--verbose"],
        )
        return proc.returncode
    if shutil.which("docker"):
        proc = subprocess.run(
            ["docker", "run", "--rm",
             "-v", f"{scan_dir.as_posix()}:/scan:ro",
             "-v", f"{config.as_posix()}:/config.toml:ro",
             DOCKER_IMAGE, "dir", "/scan", "--config", "/config.toml",
             "--redact", "--no-banner", "--verbose"],
        )
        return proc.returncode
    sys.exit(
        "security_check: neither a `gitleaks` binary nor `docker` is "
        f"available. Install gitleaks v{GITLEAKS_VERSION} (or Docker) — "
        "the commit is BLOCKED until the check can run. "
        "See .agent/os/security_privacy.md."
    )


def scan_changes(include_unstaged: bool) -> int:
    """Scan pending changes; return 0 on clean, 1 on findings."""
    root = repo_root()
    config = root / ".gitleaks.toml"
    if not config.exists():
        sys.exit(f"security_check: missing {config} — cannot scan.")
    files = changed_files(root, include_unstaged)
    if not files:
        print(PASS_BANNER, "(no content changes to scan)")
        return 0
    tmp = snapshot(root, files, include_unstaged)
    try:
        code = run_gitleaks(tmp, config)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if code == 0:
        print(PASS_BANNER, f"({len(files)} file(s) scanned)")
        return 0
    print(FAIL_BANNER, file=sys.stderr)
    return 1


def hook_gate() -> int:
    """Claude Code PreToolUse gate: only act on `git commit` commands."""
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0  # not a hook invocation we understand; don't block
    command = (payload.get("tool_input") or {}).get("command") or ""
    if not GIT_COMMIT_RE.search(command):
        return 0
    print("security gate: `git commit` detected — scanning pending changes…",
          file=sys.stderr)
    if scan_changes(include_unstaged=True) != 0:
        # Exit 2 blocks the Bash call; stderr is fed back to the agent.
        return 2
    return 0


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "--staged"
    if mode == "--staged":
        return scan_changes(include_unstaged=False)
    if mode == "--hook-gate":
        return hook_gate()
    if mode == "--all":
        root = repo_root()
        return 1 if run_gitleaks(root, root / ".gitleaks.toml") else 0
    sys.exit(f"security_check: unknown mode {mode!r} "
             "(use --staged | --hook-gate | --all)")


if __name__ == "__main__":
    sys.exit(main())
