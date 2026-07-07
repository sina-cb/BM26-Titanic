# Security review — secrets / credentials / leaked IPs (pre-merge)

**Date:** 2026-06-18
**Branch:** `claude/audio-corpus-tuning-olcd6i` → `main`
**Verdict:** **SECURITY: CLEAR** — no secrets, keys, credentials, or public IPs found.

> Note: the dedicated cold-agent security scan was stopped before it wrote its
> report; this is a fast, pattern-based inline scan covering the high-value
> cases. For an offline LAN-only lighting rig that's an adequate gate, but it is
> not an exhaustive manual audit of all ~200 changed files.

## What was scanned
- Whole working tree + the branch diff vs `main` (`git diff main...HEAD`),
  excluding `node_modules`, lockfiles, and `.git`.
- LAN/localhost addresses (`127.0.0.1`, `0.0.0.0`, `10.x`, `192.168.x`, `100.x`
  Tailscale, `172.16–31.x`, `169.254.x`) treated as EXPECTED for this rig.

## Checks + results
| Check | Result |
|---|---|
| Cloud keys — AWS `AKIA…`, Google `AIza…`, GitHub `ghp_/gho_`, Slack `xox…`, OpenAI/Anthropic `sk-…` | none |
| Private keys — `BEGIN … PRIVATE KEY`, `.pem/.key/.p12/.pfx/.jks/.keystore`, `id_rsa` | none tracked |
| `password=/secret_key=/api_key=/access_token=/client_secret=/bearer …` with a literal value | none |
| Connection strings with creds — `mongodb(+srv)://`, `postgres://user:pass@`, `scheme://user:pass@` | none |
| Tracked `.env` / `.npmrc` / `.netrc` / `rclone.conf` / `service-account*.json` with auth | none (see below) |
| Public (non-LAN) IPs in the branch diff | none — only localhost/LAN |

## Files flagged by name (all benign — verified)
- `control_podium/PortWatch/{scripts/sync-secret.mjs, src/security/secretStore.ts, src/ui/SecretEntrySheet.tsx}` — code that *handles* secrets (a secret store + entry UI), not secret values.
- `control_podium/server_bridge/.ssh.secret.example`, `marsin_engine/secret.yaml.example` — `.example` templates; no real values (placeholders only).
- `simulation/unreal/.../mediasoup-sdp-bridge/.npmrc` — contents are just `package-lock=false` (no `_authToken`/`_password`).

## Notes
- rclone-based webcam upload (`webcam_to_drive.cjs`) keeps Drive credentials in
  rclone's own config on the bench — never in the repo (by design).
- Engine/sim/companion servers bind localhost/LAN ports for the rig; no
  mutating endpoint is exposed beyond the LAN by these changes.

**No security blockers to merge.**
