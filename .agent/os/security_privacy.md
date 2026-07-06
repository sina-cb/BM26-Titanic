# 16. Security & Privacy — Git Hygiene, Leak Scanning, CI Enforcement

This repo is **PUBLIC**. Everything committed is world-readable, gets
cached by forks and mirrors, and cannot be reliably un-published. Real
leaks have already happened here (operator WiFi SSID, Pi SSH credentials,
home-LAN debug logs, device MACs) and each one cost a history rewrite to
clean up. This spec is how we prevent the next one.

Introduced 2026-07-01 (PR #43). Companion git rules: `01_git.md`.

## What must NEVER be committed

| Class | Where it lives instead |
| --- | --- |
| Secrets: keys, tokens, passwords, passphrases | `$BM26_SECRETS` / `$BM26_DEPLOY_REGISTRY` env-provided deploy source; gitignored `marsin_engine/secret.yaml`; gitignored `.ssh.secret` |
| Device MAC addresses | Gitignored `control_podium/.config.nodes.pairing.yaml` (see "MAC pairing overlay" below) or the external deploy registry |
| Home / dev LAN + Tailscale IPs | Nowhere. Redact in prose as `10.x.x.NNN` (keep the last octet for readability — the `x` breaks IP parsing) |
| WiFi SSIDs / AP passphrases | Env-provided build secrets. (Exception: the panel's broadcast AP name is documented non-secret in its `config.yaml`) |
| Personal emails, addresses, operator PII | Nowhere. Bot plumbing (`noreply@...`) is fine |

Committed show-LAN topology in FUNCTIONAL config (scene `patches.yaml`
controller IPs, test fixtures, `docs/` references) is accepted — the playa
network is offline and non-routable. Reports are different: **no IP of any
kind goes in `.agent/`** (reports are debug-log dumping grounds and that is
exactly where home-network PII leaks).

## The CI scanner

- **Workflow:** `.github/workflows/security_privacy_scan.yml` — runs
  gitleaks on every PR and every push to `main`, over the new commits
  (diff-based; it does not re-scan history).
- **Config:** `.gitleaks.toml` — gitleaks' built-in secret detectors plus
  project rules: `bm26-mac-address`, `bm26-public-ip` (any non-private IP
  anywhere), `bm26-report-ip` (ANY IP under `.agent/`),
  `bm26-password-literal`, `bm26-wifi-ssid`, `bm26-wifi-passphrase`,
  `bm26-email-pii`.
- **Version is PINNED** (`GITLEAKS_VERSION` in the workflow). Do not
  unpin. The action's default binary once silently ignored the
  `[[allowlists]]` config syntax and flagged placeholders — version drift
  changes config *semantics*, not just behavior. When bumping: validate
  the new version against the full tree locally first (command below) and
  keep the local validation image and the CI pin the SAME version.

### Enforcement — why a red X actually blocks

Repo ruleset **`protect-main`** (Settings → Rules): `main` accepts changes
only via PR; the `gitleaks` status check is required; force-pushes and
branch deletion are blocked; there are **no bypass actors** (applies to
admins too). A failing scan therefore physically prevents the merge.

### Overriding a finding (in this order)

1. **Redact the value.** It is almost never needed in the file. This is
   the right answer ~always.
2. Inline `# gitleaks:allow` on the flagged line — self-documenting,
   survives rebases. For genuinely-safe values only.
3. Add the finding's **fingerprint** to `.gitleaksignore` (printed in the
   CI job log as `<commit>:<file>:<rule>:<line>`) — for prose/YAML where a
   comment doesn't fit. Note fingerprints are commit-specific.
4. For a whole CLASS of false positives, extend an allowlist in
   `.gitleaks.toml` — with a comment explaining why.

**Never** delete a rule, skip the workflow, or merge around a red scan to
silence one finding. If the scanner is wrong, fix the scanner — loudly,
in its config, with a comment.

### Pre-commit gate — REQUIRED before every `git commit`

Committing is gated locally, before anything reaches a branch:

- **Agent rule (P0): a `git commit` may only happen after the staged
  changes pass the security check.** The check is one command:

  ```bash
  python scripts/security_check.py --staged
  ```

  It prints `SECURITY CHECK PASSED` (exit 0) or a findings list with
  redaction instructions (exit 1). If it fails: redact, restage, re-run.
  Never work around it with `--no-verify` — CI catches it on the PR
  anyway and by then the secret is already in pushed history.

- **Enforcement layer 1 — git hook:** `.githooks/pre-commit` runs that
  same command automatically on every commit. Git does not auto-enable
  hooks, so each clone needs a one-time setup:

  ```bash
  git config core.hooksPath .githooks
  ```

  (Set once per clone; worktrees inherit it. If `deploy.py`-style tools
  ever commit programmatically, they go through the same hook.)

- **Enforcement layer 2 — Claude Code:** the committed
  `.claude/settings.json` carries a `PreToolUse` hook that intercepts
  any Bash `git commit` and runs the gate (including `-a` commits:
  it scans tracked-unstaged changes too). A failing scan blocks the
  tool call and feeds the findings back to the agent.

- **Enforcement layer 3 — CI:** the PR scan + `protect-main` ruleset
  (below) backstop both local layers.

The gate needs a `gitleaks` binary or Docker. If neither is available it
BLOCKS the commit — availability problems are fixed by installing the
scanner, never by skipping the check.

### Scanning locally before you push

```bash
# Same engine + config CI uses. Match the version to the workflow pin.
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.28.0 \
  detect --source=/repo --config=/repo/.gitleaks.toml --no-git --redact
```

Expected residue: the gitignored pairing overlay fires ~4 MAC findings in
`--no-git` (whole-directory) mode. That is a deliberate tripwire — CI
scans commits, so it stays silent unless someone actually commits the
overlay, which is exactly when we want the alarm.

## MAC pairing overlay (control_podium)

The node table is split like `utils/config_store.py`:

- `.config.nodes.yaml` — **committed.** node id → name / role / type.
  Roles and ACL only; NEVER hardware identifiers.
- `.config.nodes.pairing.yaml` — **gitignored.** node id → `usb_mac`.
  Written only by `firmware/deploy.py` (`--pair` / auto-pair / `--clear`);
  merged at load by `control_podium/utils/nodes_config.py::load_nodes()`.

Handling rules:

- New readers of node config go through `utils.nodes_config.load_nodes()`
  (or `load_pairing()`); never parse `.config.nodes.yaml` for MACs.
- The overlay is **per-machine**. A fresh checkout has nodes but no
  pairings — re-pair with `python firmware/deploy.py --pair --node 0xNN`,
  or copy the overlay from a machine that has it. The Pi needs it too if
  it resolves its Heltec by MAC.
- If the overlay ever shows up in `git status`, STOP — the gitignore
  entry broke. Fix that before anything else.

## History-rewrite hazard (stale clones re-leak)

`origin/main` history has been **rewritten** at least once to purge
credentials and a home-network debug report. Clones and worktrees created
before a rewrite still carry the dirty history, and pushing ANY branch
based on it re-uploads the purged secrets. This has actually happened.

**Before pushing any branch:** `git merge-base HEAD origin/main`. If
there is no common ancestor (or the SHAs of "the same" commits differ
from origin), the local history is pre-rewrite:

```bash
git fetch origin main
git rebase --onto origin/main <old-base-commit> <your-branch>
# resolve conflicts in favor of origin's deletions/redactions, then push
```

Never "fix" this with a merge — that grafts the dirty history back in.
When in doubt, re-clone fresh.

## If a real secret lands anyway

1. **Rotate the credential first.** Git surgery never un-leaks a value;
   assume it was harvested the moment it was pushed.
2. Remove it from the tip with a normal commit (CI verifies).
3. Decide with the Human op whether the history itself must be rewritten
   (`git filter-repo` + force-push). That invalidates every clone — see
   the hazard section above — so it is an operator decision, never an
   agent's unilateral call.
4. Write a dated report in `.agent/02_reports/` describing what leaked,
   for how long, and what was rotated.
