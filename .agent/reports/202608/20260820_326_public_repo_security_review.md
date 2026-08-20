# 326 — Public-repo security & privacy review of `feat/bm_readiness`

**Lens:** security / privacy only. Findings-only — nothing was fixed, no file
outside this report was touched, no git write operation was run.

**Target:** `feat/bm_readiness` @ `6b26c72c` → `main` (42 commits, 2643 added
files, ~+667k lines).

**Governing spec:** `.agent/os/security_privacy.md`. Everything below is
judged against *that* document, not generic taste.

## Verdict

**P0: 0 · P1: 2 · P2: 5**

No live secret, credential, real device MAC, personal email, phone number,
home address, public IP, or operator PII was found in any **tracked** file on
this branch. The branch is clean to merge on the secrets/PII axis. The two P1s
are blast-radius and scanner-coverage issues, not disclosures.

---

## Scanner verdict — `scripts/security_check.py --all`

Ran the project's own gate in its widest mode (whole working tree, gitleaks
v8.28.0 via the pinned image, `.gitleaks.toml` = the same config CI enforces):

```
scanned ~103571288 bytes (103.57 MB) in 5.39s
WRN  leaks found: 6
```

All 6 findings are the **same** `bm26-mac-address` hit, one real controller
MAC (`3C:84:27:…`, redacted here) duplicated across six timestamped copies of:

```
simulation/.scene_backups/studiodj/<TIMESTAMP>/scenes/studiodj/controllers.yaml:36
```

**These are not tracked and not published.** Verified:

- `git ls-files simulation/.scene_backups` → 0 files.
- `git check-ignore -v` → `.gitignore:10:simulation/.scene_backups/`.
- `deploy/deploy.py:129` lists `simulation\.scene_backups` in
  `SYNC_EXCLUDE_DIRS`, so the show-server `robocopy /MIR` does not ship them
  either.

This matches the spec's documented "expected residue … deliberate tripwire"
behaviour for `--no-git` whole-directory scans. **No tracked content fails the
project scanner.** See P2-1 for the residual concern.

---

## P0 — must fix before merge

**None.**

Explicitly cleared, each by a dedicated scan (patterns listed in Coverage):

| Class the spec forbids | Result |
| --- | --- |
| Secrets / keys / tokens / passwords | No literal values. Every hit is a reference to the external `$BM26_SECRETS` / `$BM26_DEPLOY_REGISTRY` source, or a `.example` template. |
| Real device MACs | Every tracked MAC is a placeholder (`AA:BB:CC:…`, `DE:AD:BE:EF:…`, `02:00:00:…`, `00:00:00:00:00:00`). |
| Home / dev LAN + Tailscale IPs | None. IPs under `.agent/` are loopback, multicast (`239.255.x`), RFC5737 doc-space, or `0.0.0.x` — all allowlisted by the stricter `bm26-report-ip` rule. |
| WiFi SSIDs / AP passphrases | None. Only the documented non-secret broadcast AP name and env-var references. |
| Personal emails / addresses / PII | Zero emails after excluding bot plumbing and npm scopes; zero phone numbers. |
| `$BM26_SECRETS` / `$BM26_DEPLOY_REGISTRY` / `$STOKER_*` values | No copy leaked. All 30 hits are documentation of the env-var contract. |
| MarsinLED private-repo content | No firmware internals, no MarsinLED WiFi credentials, no bike/e-bike design docs. `docs/41` and `docs/08` describe only this repo's own HTTP/sACN *client* behaviour against the device's public API. The earlier bike-doc incident has left nothing behind. |

Also verified clean, because they are the classic leak vectors:

- **No secret file is tracked** — only `marsin_engine/secret.yaml.example`,
  `LookingGlass/control_podium/server_bridge/.ssh.secret.example`,
  `deploy/machines.yaml.example`.
- **`.agent/reports_local/` is not tracked** (0 files) and is gitignored at
  `.gitignore:187` **and** deploy-excluded at `deploy/deploy.py:131-132` —
  both layers the spec requires are present.
- **The `.gitignore` diff un-ignores nothing.** The only changes are
  `control_podium/…` → `LookingGlass/control_podium/…` path re-rooting that
  *follows* the directory move; every sensitive entry (`.config.nodes.pairing.yaml`,
  `.ssh.secret`, `PortWatch/src/_generated/`, `network.generated.ts`) is
  preserved under its new path. The new `.gitattributes` is line-ending policy only.
- **`deploy/setup/provision_runtime_secrets.ps1`** (added by this branch, the
  single highest-risk new file) is *well* built: it never prints the secret
  path or contents, refuses any destination inside the deployed repo
  (`Assert-OutsideRepo`), locks ACLs to SYSTEM/Administrators/the show account,
  and hard-fails on identity mismatch. No embedded values.
- **No baked passcode fallback.** `marsin_engine/lib/captainpad_auth.js`
  `verifyPassphrase` reads from the external secrets source; there is no
  default/fallback constant, consistent with the codex's no-fallback P0. The
  browser gate `CaptainPad/live_touch/touch_control_passcode.js` documents and
  implements "NO STORAGE OF ANY KIND".
- **No tracked build artifacts, logs, renders, or editor backups.** No `dist/`,
  `.expo/`, `.agent_renders/`, `*.log`, `*.bak`, `*.orig`, `*~`, `.env`, or
  `.mcp.json`.
- **`marsin_engine/states/**` carry no network or device identity.** A scan of
  all 36 tracked state files for IPs, hostnames, `deviceName`, and
  `controllerId` returned nothing. The known live-engine mutation residue is
  parameter/mixer data only — safe to keep refreshing on a public repo.

---

## P1 — should fix

### P1-1 · 1.47 GB of unscannable binaries enter public history permanently

**Where:** `docs/pattern_gallery/` — **1236 files added by this branch**
(575 `.gif`, 587 `.mp4`, 37 `.html`, 36 `.json`, 1 `.md`), **1465.26 MB**.
The path does not exist on `main` at all.

**Why it matters (two compounding reasons):**

1. **Irreversible.** Git history is append-only in practice; the spec's own
   history-rewrite section documents that purging anything from this repo costs
   a `filter-repo` + force-push that invalidates every clone and is an operator
   decision. 1.47 GB is being committed to a public repo under that constraint,
   and every fork/mirror will carry it forever.
2. **It is a permanent scanner blind spot.** `.gitleaks.toml:150` allowlists
   `(^|/)docs/pattern_gallery/.+\.(gif|mp4)$` by path. That exemption is
   *reasonable* as written (the config explains compressed binary bytes produce
   random email/token matches), but it means 1162 of these files — and anything
   ever added under that path with those extensions — are never scanned by the
   pre-commit gate or by CI. The exemption was cheap when the directory was
   small; at 1162 files it is a standing hole.

I inspected the content class: these are generated LED pattern renders, so the
actual disclosure risk today is low. The finding is about blast radius and
coverage, not a present leak.

**Fix (one line):** confirm with Sina that shipping the gallery in git history
is intended — if it is not, drop `docs/pattern_gallery/**` binaries from the
branch and publish them as a release asset or Git LFS instead; if it is, keep
the path allowlist but add a CI size guard so the directory cannot grow further
unscanned.

### P1-2 · A real controller MAC sits in the working tree in six stale copies

**Where:** `simulation/.scene_backups/studiodj/{20260713_101529_220,
20260714_082541_513, 20260714_082555_023, 20260714_082605_941,
20260714_082626_729, 20260714_083209_380}/scenes/studiodj/controllers.yaml:36`
— `mac: 3C:84:27:35:**:**` (value redacted; OUI resolves to a real Espressif
device, so this is a genuine hardware identifier, not a placeholder).

**Why it matters:** the spec is unambiguous — device MACs live in the external
deploy registry or the gitignored pairing overlay, "Nowhere" else. Both
containment layers are correctly in place today (gitignored + deploy-excluded),
so this is **not** currently published, which is why it is P1 and not P0. But
it is a real identifier persisting on disk in six redundant copies of a scene
that has long since landed, and the containment is one `git add -f`, one
`zip -r` support bundle, or one broken `.gitignore` line away from failing. The
spec itself flags this class as the motivating case for the whole scanner.

**Fix (one line):** delete the stale `simulation/.scene_backups/studiodj/*`
snapshots — they serve no purpose after the scene landed, and removing them
also silences the six recurring `--all` findings that currently train reviewers
to ignore the scanner's output.

---

## P2 — noted, low or no blast radius

1. **The `--all` scanner cries wolf six times on every run.** Consequence of
   P1-2. Worth fixing purely so a *real* future finding is not lost in
   already-dismissed noise.
2. **Partial Apple Team ID `5JN…` in `.agent/ops/build_ipad_release.md`**
   (12 occurrences). **Pre-existing, and the branch improved it** — `main`
   carries 23. Only the first 3 of 10 characters are shown, and Team IDs are
   recoverable from any signed app, so disclosure value is ~nil. The note is
   about *consistency*: `CaptainPad/README.md` and
   `LookingGlass/control_podium/PortWatch/README.md` use `<TEAM_ID>`, and
   `CaptainPad/utils/ios_prebuild_contract.test.ts:110-111` actively enforces
   that placeholder — the sibling runbook is the one file exempt from a rule
   the repo tests for. Fix: replace `5JN…` with `<TEAM_ID>` for uniformity.
3. **Burning Man 2026 dates in tracked functional code.**
   `marsin_engine/lib/timeline/show_plan.js:998` ("an 8-day span from
   2026-08-30 through 2026-09-06"), plus `--date 2026-09-0X` fixtures in
   `.agent/ops/timeline_e2e_tests.md`, `docs/38`, and timeline tests. My
   reading: this is **within policy** — these are show-scheduler constants and
   test vectors (functional config, "what and why"), not operator
   deadline/schedule planning, and the BRC event dates are public. Flagged only
   so the operator can confirm the ruling, since it is the closest tracked
   content to the no-future-dates rule.
4. **`.agent/plans/20260620_0_audio_analysis_improvement.md:10-11`** carries an
   explicit "Deadline: ~2026-06-20 12:43Z". Pre-existing historical plan, a
   same-day agent autonomy budget rather than a project schedule, and now in
   the past — the spec permits past dates in log entries. No action.
5. **`simulation/unreal/Intermediate/CachedAssetRegistry_0.bin`, 73 MB** —
   tracked Unreal *build* artifact (`Intermediate/` is a generated directory),
   pre-existing on `main`, and path-allowlisted out of scanning. Not this
   branch's problem; worth a separate cleanup ticket.

---

## Advisory (not a finding)

`docs/76_living_souls_of_iran_dedication.md` is **untracked** in the working
tree and therefore outside this review's scope, but since it looks staged for
commit I read all 114 lines: it is artistic direction for a pattern collection.
**No personal names, no PII, nothing sensitive** — safe to commit as-is.

---

## Coverage — patterns actually run (for audit)

All content greps used `git grep` (tracked files only, so untracked residue
could not pollute results), excluding `simulation/vendor/`, `simulation/unreal/`,
`package-lock.json`, `yarn.lock`, `*.lock` unless stated.

| # | Pattern / check | Result |
| --- | --- | --- |
| 1 | `scripts/security_check.py --all` (whole tree, gitleaks + `.gitleaks.toml`) | 6 findings, all untracked — see verdict |
| 2 | `(password\|passwd\|passphrase\|secret\|api[_-]?key\|apikey\|auth[_-]?token\|access[_-]?token\|bearer \|private[_-]?key\|BEGIN …PRIVATE KEY)\s*[:=]\s*["'][^"']{6,}` | 4 hits, all placeholders/test fixtures |
| 3 | `([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}` (MAC) over all tracked | all placeholders; vendored WebRTC SDP fingerprints excluded as noise |
| 4 | `(ssid\|wifi_pass\|wpa_psk\|psk\|wifi_password)` | doc/spec references only |
| 5 | `BM26_SECRETS\|BM26_DEPLOY_REGISTRY\|STOKER_` | 30 hits, all env-contract documentation |
| 6 | `\b(\d{1,3}\.){3}\d{1,3}\b` restricted to `.agent/` (spec: *no* IP allowed there) | loopback / multicast / RFC5737 / `0.0.0.x` only |
| 7 | `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` (email PII) | **zero** after excluding `noreply@`, `@example.`, `git@github`, npm scopes |
| 8 | `(\+1[ -]?)?\(?\d{3}\)?[ -]\d{3}[ -]\d{4}` (phone) | zero |
| 9 | `2026-(09\|1[0-2])-\d\d\|2027-\d\d-` + `deadline\|due by\|deploy by\|ship by\|countdown\|weeks? left\|gate date` | see P2-3 / P2-4 |
| 10 | Tracked-artifact sweep: `dist/ build/ .expo/ .agent_renders/ node_modules/ *.log *.bak *.orig *~ .env .mcp.json settings.local` | clean |
| 11 | `git ls-files` for `secret.yaml`, `.ssh.secret`, `machines.yaml`, `network.generated`, `config.nodes.pairing` | only `.example` templates |
| 12 | `git diff main...HEAD -- .gitignore .gitattributes` | nothing un-ignored; path re-rooting only |
| 13 | `git diff --name-status --diff-filter=A main...HEAD` (2643 added files) — distribution + regex sweep for `.log/.tmp/.bak/.env/secret/credential/dist/build/.pem/.key/.p12/reports_local/screenshot/scratch/dump` | 2 hits, both read in full and clean |
| 14 | IPs / `hostname` / `deviceName` / `controllerId` in `marsin_engine/states/**` (36 files) | zero |
| 15 | `marsinled` in `docs/`; `ebike\|e-bike\|bike frame\|bicycle` in `docs/` + `.agent/` | no private-repo leakage |
| 16 | Manual read of scanner path-allowlist blind spots: `.claude/` (1 tracked file), `dist/`, `build/`, `node_modules/`, `docs/pattern_gallery` binaries | `.claude/settings.json` clean (hook config only); others not tracked; gallery → P1-1 |
| 17 | `DEVELOPMENT_TEAM\|teamId\|ascAppId\|APPLE_ID\|provisioningProfile\|CODE_SIGN_IDENTITY` | see P2-2 |

**Known limits of this review.** (a) I pattern-scanned rather than read the
1162 gallery binaries and the vendored Unreal/three.js trees — that is the
stated blind spot in P1-1. (b) I reviewed the branch tip, not the 42 commits
individually, so a secret added and removed *within* the branch would not
surface here; the repo is already public and CI scans commits, so that gap is
covered by the existing pipeline. (c) `--all` scans the working tree, so its
verdict includes untracked files — I separated tracked from untracked by
`git ls-files` / `git check-ignore` for every finding.
