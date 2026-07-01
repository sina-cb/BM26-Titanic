# Security & Privacy CI + repo scrub — 2026-07-01

**Author:** agent (with Sina)
**Branch:** `claude/recursing-murdock-3bbe14` (worktree; promote to `feat/security_privacy_ci` on push)

## What landed

### 1. CI leak scanner (gitleaks) — new
- `.github/workflows/security_privacy_scan.yml` — runs on every PR and push
  to `main`. Free for this public personal repo; scans the new commits
  (diff-based), not history.
- `.gitleaks.toml` — rules: all built-in secret detectors, plus
  project rules: device MACs (`bm26-mac-address`), public non-RFC1918 IPs
  anywhere (`bm26-public-ip`), ANY IP inside `.agent/` (`bm26-report-ip` —
  reports are where PII leaks), hardcoded password/passkey literals
  (`bm26-password-literal`), WiFi SSID/passphrase (`bm26-wifi-*`), and
  email PII (`bm26-email-pii`).
- Tuned against the full tree: 94 raw findings → 0 (excluding the
  gitignored pairing overlay, which SHOULD fire if ever committed).
  Functional show-LAN topology (scene `patches.yaml`, tests, docs/) is
  allowlisted per-rule; reports are not.
- **Override path** (documented in the workflow header): inline
  `# gitleaks:allow` → fingerprint in `.gitleaksignore` → class-level
  allowlist in `.gitleaks.toml`. Never delete a rule/workflow for one hit.

### 2. Working-tree scrub
- 11 reports redacted: all IPs → `A.x.x.D` form (largest: the May iPad
  discovery debug log, ~90 home-LAN addresses + one Tailscale CGNAT addr).
- `utils/ble_client.py` / `ble_discovery.py`: real docstring example MAC →
  placeholder.
- No personal emails or hardcoded passwords were found tracked.
- History note: old commits still contain the pre-scrub values; the tip is
  clean and CI guards everything new. Full history rewrite deliberately
  deferred.

### 3. control_podium pairing refactor (MACs out of git)
- New `control_podium/utils/nodes_config.py`: merges committed
  `.config.nodes.yaml` (roles — unchanged responsibilities) with the
  **gitignored** `.config.nodes.pairing.yaml` (node id → `usb_mac`),
  mirroring the `config_store.py` split. Overlay wins over inline values;
  inline still honored so test fixtures keep working.
- `firmware/deploy.py` (`--pair` / auto-pair / `--clear` / `--clear-all`)
  now writes ONLY the overlay; the ruamel round-trip machinery is gone.
- Readers updated: `client_companion.py`, `hil_companion_demo.py`,
  `hil_secured_demo.py`, `server_bridge/runner.py`, `tests/conftest.py`,
  both HIL test files.
- The 4 real MACs were moved into the local (gitignored) overlay; the
  committed file now carries roles only.

## Verification
- `python -m pytest control_podium/tests/`: failure set identical
  before/after (41 pre-existing failures = missing `pytest-asyncio` on this
  Windows machine; resolver + ACL tests all pass).
- `deploy.py --list` smoke: merged table renders, 4 paired nodes resolve
  from the overlay, unpaired iPad shows `unpaired`, a live board on COM4
  was correctly listed as unclaimed. (Console needs `PYTHONIOENCODING=utf-8`
  on Windows for the box-drawing chars — pre-existing.)
- gitleaks full-tree scan: clean except the gitignored overlay (tripwire).

## Follow-ups (Notion board)
- **Copy `.config.nodes.pairing.yaml`** (or re-run `deploy.py --pair`) on
  every machine that flashes/paired hardware — the seeded overlay lives
  only in this worktree checkout. Same for the Pi if it resolves by MAC.
- **Flash-path hardware test**: `deploy.py` pairing/flash was smoke-tested
  but not exercised against a real flash cycle end-to-end.
- Consider placeholder-izing LAN IPs in `docs/` (currently allowlisted for
  the IP rule as curated topology references).
- Full git-history rewrite (filter-repo) if the old MAC/IP values in
  history ever become a concern.
