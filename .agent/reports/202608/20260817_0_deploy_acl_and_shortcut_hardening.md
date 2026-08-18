# Production deploy ACL and operator-shortcut hardening

## Outcome

The production mirror no longer enumerates or copies Git metadata. Robocopy
excludes `.git` as both a directory and a linked-worktree pointer file on the
source and destination. This removes protected Windows Git-object ACLs from the
deployment data plane instead of weakening ACLs or relying on backup mode.

Production Git fetch is explicitly retired. A plain `fetch` now targets the
scratch workspace; the old `--source prod` and `--source both` forms fail with a
migration message. Runtime state snapshots remain available through `--state`.
This makes the existing policy truthful: scratch is the only supported place
for durable on-server Git work; prod is a runtime artifact.

Every real prod deploy now validates the laptop's external `$BM26_SECRETS`
YAML, copies it over encrypted SCP into a protected stable location outside
the deployed tree, applies protected ACLs for the registered show account plus
SYSTEM and Administrators, persists only its path at Machine scope, removes any
stale User-scope override, and proves the file is readable. Neither its path
nor contents are printed. All of this finishes before Robocopy preview and
before the live stack is stopped. Dry-run
validates locally and probes current remote readiness without copying or
mutating ACL/environment state.

Every full production deploy now reconciles three idempotent Windows desktop
Internet shortcuts for the registered show account: `Titanic Simulation`,
`Audio Companion`, and `CaptainPad Web`. Their exact localhost URLs are derived
from the same exported launcher profile registry plus the effective machine
overlay/config used by the deployed stack, including scene, lighting profile,
common sim query, spotlights, and ports. Dry-run prints the exact plan.

The installer removes retired BM26 `.url`/`.lnk` duplicates, generates and
verifies three distinct professional offline icons in a stable directory
outside the mirrored repo, refuses a Windows identity or laptop/server plan
hash mismatch, and verifies every shortcut line. The supervisor's separate
auto-open path is retired; deployment and restart verify the deployed boot
script's exact `--no-launch` invocation before firing the scheduled task.

## Root cause

Robocopy's list-only safety preview traversed the production `.git` tree. One
existing Git object carried a protected ACL from a different Windows account,
so the registered SMB deployment identity received `ERROR 5` while reading
`.git\objects\info\packs`. The source file was readable and the destination
root ACL was permissive; the single protected child was the fault boundary.
`/ZB` was not viable because the laptop identity does not hold backup/restore
privileges, and granting broad ACLs would be the wrong security model.

The later launcher crash loop had a separate preflight gap: the scheduled-task
environment had no persistent `BM26_SECRETS` path. Interactive/laptop process
variables do not establish the environment of a future scheduled task.

## Files

- `deploy/deploy.py`
- `deploy/boot_server.ps1`
- `deploy/set_boot.ps1`
- `deploy/machines.yaml.example`
- `deploy/setup/install_desktop_shortcuts.ps1`
- `deploy/setup/shortcut_plan.cjs`
- `deploy/setup/provision_runtime_secrets.ps1`
- `deploy/tests/test_deploy.py`
- `launcher.js`
- `deploy/README.md`
- `.agent/ops/show_server_ops.md`
- `docs/43_show_server_deployment.md`

## Local validation

```text
python -m py_compile deploy\deploy.py deploy\tests\test_deploy.py
PASS

python -m unittest discover -s deploy\tests -p "test_*.py" -v
20 passed, 0 failed

PowerShell parser: both deploy\setup scripts plus boot_server.ps1 and set_boot.ps1
PASS

node --check deploy\setup\shortcut_plan.cjs
PASS

python deploy\deploy.py --help
PASS

git diff --check -- <touched deployment files>
PASS

python scripts\security_check.py --all
Only six pre-existing MAC findings under simulation\.scene_backups; no finding
in a touched deployment file
```

The tests execute the shortcut installer twice in isolated desktop and stable
asset directories, prove exact launcher/config-derived URLs, retired shortcut
removal, distinct icons, and idempotency, reject a wrong Windows identity, pin
the no-launch supervisor/start contract, pin both Robocopy command variants'
`.git` exclusions, exercise the exact `ERROR 5` Git-object signature, prove
prod fetch fails before SSH, prove dry-run makes no remote mutation, execute
the ACL/persistence helper in isolated Process scope, verify secure-copy
ordering, and prove a real deploy provisions secrets before SMB preview/stop.

## Operator migration

No separate server secret-install step remains. The deploy laptop must have a
valid external `$BM26_SECRETS` source from the private setup. The real deploy
converges the server copy securely and idempotently; do not put credentials in
the repo, Desktop, or deploy output.

Then run:

```powershell
python deploy\deploy.py deploy --machine <registered-machine> --dry-run
```

The dry-run is expected to pass local-secret validation, identity, Node parity,
redacted remote-secret readiness reporting, SMB, and list-only Robocopy gates
without changing the server. No remote probe, ACL mutation, deployment, or
service restart was performed during this local hardening task because the
operator owned the active production deployment.
