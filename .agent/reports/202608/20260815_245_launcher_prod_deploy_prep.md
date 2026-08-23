# _245 — Launcher `prod` becomes the real show profile, and the deploy is dry-run verified

**Date:** 2026-08-15 · **Branch:** `feat/bm_readiness` · **Agent:** _245 (Opus implementer)
**Operator orders (verbatim):**
*"launcher prod and dev changes: prod still run the captain pad web app just in case ·
prod -> set default lighting profile the 2dpixels -> to save FPS ·
we need to deploy the latest software on the exterior lights computer from …machines.yaml
and check if the deployment still works · but first do all of the changes, and when ready
we will do a deploy to test on the machine but make sure our tests are disabled ·
also, in the launcher make the prod sacn priority 150 and make sure the dev launcher is sacn 120"*
**Coordinator add-on:** Expo Go on the iPads must receive a LAN bundle host, not loopback.

> **THE DEPLOY IS GATED.** Nothing was pushed to any machine. Everything below the
> line "Deploy checklist" is for the operator to run. All three show servers were
> **unreachable** from the laptop during this session (see §5) — that is the one
> item that could not be verified end to end.

---

## 1. What landed

| # | Item | Status |
|---|---|---|
| 1 | `prod` serves CaptainPad — from the **prebuilt static export**, no Metro | **done** |
| 2 | `prod` sim lighting profile → **`2d_pixels`** (2D Pixel Map, no per-frame GPU 3D) | **done** |
| 3 | sACN per-packet priority: **prod 150 / dev 120 / dev-lite 120**, validated 0-200 | **done** |
| 4 | `CI` is **deleted** from the captainpad child's env (the frozen-Metro bug) | **done** |
| 5 | `REACT_NATIVE_PACKAGER_HOSTNAME` = runtime-detected LAN IPv4 (Expo Go on iPad) | **done** |
| 6 | Deploy excludes test suites + agent worktrees; dry-run verified | **done** |
| 7 | Real deploy against `titanic-ext` | **BLOCKED** — machine unreachable (§5) |

Files touched: `launcher.js`, **new** `tools/static_web_server.cjs`,
`simulation/tests/launcher_supervision.test.js` (+6 tests),
`deploy/deploy.py`, `deploy/boot_server.ps1`, `docs/43_show_server_deployment.md`.

---

## 2. Launcher profiles

The profile table is now the single place a show-configuration number lives:

| profile | processes | sim profile | CaptainPad | sACN priority |
|---|---|---|---|---|
| `prod` | sim + engine + audio + **captainpad** | `2d_pixels` | `static` (prebuilt `dist`) | **150** |
| `dev` | sim + engine + audio + captainpad | `full` (60 spotlights) | `expo` (dev server) | **120** |
| `dev-lite` | sim + engine + audio + captainpad | `emissive` | `expo` | **120** |

Overrides: `--sim-profile <id>`, `--sacn-priority <n>`, `--lan-host <addr>`
(env `BM26_LAN_HOST`). All three resolve **before** `assertSingleInstance()`, so a
bad value fails while the previous stack is still lit — the same ordering rule
report `_115` L6 established for `--scene`.

### 2a. Why `static`, not the Expo dev server, on a show machine

`serve` is **not** a CaptainPad dependency, so `npm run web:serve` resolves it
through `npx` — a network fetch on a box that has no internet. `http-server` is
installed under `simulation/`, not `CaptainPad/`. So the prod path uses a new
**`tools/static_web_server.cjs`**: Node built-ins only, nothing to resolve,
nothing to install. It serves `CaptainPad/dist` and:

* refuses to start (exit 1) if the web root or its `index.html` is missing —
  a blank control surface must not read as "CaptainPad is up" to an HTTP probe;
* routes like an Expo Router **static** export (`/config` → `config.html`,
  `/foo/` → `foo/index.html`) with **no SPA catch-all**, so a bad build 404s
  loudly instead of being masked by a rewrite to `index.html`;
* binds `0.0.0.0` explicitly — the iPad reaches it over the camp LAN;
* sends `Cache-Control: no-store` on HTML so a post-deploy reload gets the new
  bundle, `max-age=3600` on hashed assets.

Verified on an isolated high port (47991) against the real `CaptainPad/dist`:
`/` 200 html · `/config` 200 html · `/audio` 200 html · `/favicon.ico` 200 ico ·
`/nope` 404 · `/../../launcher.js` 404 · `/%2e%2e/launcher.js` 404 (traversal blocked).

**Consequence to be aware of:** CaptainPad is now **show-critical on prod**. If
:6967 cannot be served the launcher tears the stack down, exactly as it does for
the engine. That is the P0 fail-loud contract, not an oversight — but it is new
behaviour, and it is why `validate()` refuses to start `prod` without
`CaptainPad/dist/index.html`. **Build the export before every deploy.**

### 2b. `2d_pixels`

`simulation/src/core/profile_registry.js` already carries `2d_pixels`
(`headless: true`) — `animate.js` gates the scene render, bloom, shadows, the
spotlight pool and the instanced-dot flush on it. `?profile=2d_pixels` is applied
by `url_overrides.js` (the key exists in `LIGHTING_PROFILES`, so it is honoured,
not ignored). `deploy/boot_server.ps1`'s auto-open URL was hardcoded to
`profile=edit&spotlights=0` — updated to match, with a keep-in-sync note; a
mismatch would have opened the show console in a different mode than the profile.

### 2c. sACN priority

`marsin_engine/engine.js` already accepts `--priority <n>` (E1.31 per-packet
priority; `config.yaml` `sacn.priority: 100` is the file default). The launcher
now passes it **explicitly on every launch**, so precedence is a property of the
profile rather than of whatever `config.yaml` a machine happens to carry. Prod
outranks dev on purpose: if a laptop dev stack and the show server ever address
the same universes, the show server wins.

Validation is loud: non-integer → "must declare sacnPriority"; outside 0-200 →
"refusing to send a non-compliant packet priority". `0` is honoured, not coerced
(the launcher deliberately does not add a second coercion on top of the engine's
known `parseInt(...) || 100`, pinned by `config_boot_matrix.test.js` D12).

---

## 3. The two Expo/Metro fixes

### 3a. `CI` is deleted, not overwritten

The launcher used to spawn the captainpad child with `CI: '1'`. A `CI=true`
environment makes Metro treat the run as non-interactive and stop serving
reloads — edits stop reaching the browser and the operator debugs a frozen
bundle. **This bit the operator live today.**

`startChild` now builds the child env through `buildChildEnv()`, where a key
whose value is `null` is **deleted** rather than set — the only way to keep an
inherited variable out of a child (spreading `process.env` cannot un-set). The
captainpad child passes `CI: null`, in every profile. Pinned by a test that
exports `CI=true` in the parent and asserts `'CI' in env === false`.

### 3b. `REACT_NATIVE_PACKAGER_HOSTNAME`

The launcher now detects this machine's LAN IPv4 at runtime
(`os.networkInterfaces()` → exactly one non-internal, non-`169.254/16` address)
and hands it to the Expo child. **No IP is hardcoded anywhere** — the repo is
public. Zero or several candidates is **ambiguous and fails loudly**, naming the
candidates and pointing at `--lan-host <addr>` / `BM26_LAN_HOST`; guessing would
put the wrong address in front of every iPad in camp. Detection runs before the
single-instance check, so an ambiguous machine never half-starts a stack.

**Honest reading of the shipped Expo code** (`@expo/cli` SDK 54,
`start/server/UrlCreator.js` + `middleware/ManifestMiddleware.js`):
`launchAsset.url` is built by `constructUrl({scheme, hostname})` where
`hostname = stripPort(req.headers.host)`, and `getDefaultHostname()` maps a
literal `localhost` host header to `127.0.0.1`. So the reported live observation
(`"url":"http://127.0.0.1:6967/…"`) is what you get when the manifest is fetched
**via `localhost`**; an iPad hitting `http://<lan-ip>:6967` would already have
received its own address back. Setting `REACT_NATIVE_PACKAGER_HOSTNAME` makes it
the LAN host **unconditionally**, which is strictly the more robust behaviour
(it also fixes deep-links, QR flows and the loading interstitial). The fix is
right; the diagnosis needed this correction.

**Verification, and its limit.** Rather than start a second Metro, the shipped
`UrlCreator` was exercised directly, in-process, with and without the env var:

```
WITHOUT env, Host: localhost -> http://127.0.0.1:6967
WITH env,    Host: localhost -> http://<detected-lan-ip>:6967   (this laptop's Wi-Fi)
WITH env,    Host: 127.0.0.1 -> http://<detected-lan-ip>:6967
```

(the real address is redacted here — public repo; it was the single non-internal
IPv4 the detector found on this box, and it matched `ipconfig`)

That is the exact code path that produces `launchAsset.url`. The **live**
`expo start` + `curl -H 'expo-platform: ios'` check asked for was
**deliberately not run**: the operator's show stack is live on :6967, and a
second Expo instance started from the same project directory shares
`node_modules/.cache` and `.expo/` with it — a cache write race that could make
the live Metro serve a broken bundle mid-show. The in-process proof is
equivalent and carries no such risk. Re-run the live check on a quiet machine
if you want belt and braces.

---

## 4. Deploy readiness (dry-run only — nothing was shipped)

Mechanism (unchanged, re-read this session): `deploy/deploy.py deploy --machine
<name>` → SSH preflight (hostname + node version parity) → SMB preflight →
`robocopy /MIR` of the working tree over SMB → boot scene → ship the private
manifest → overlay → stamp → `schtasks /Run` the boot task → verify from the
laptop. The private manifest lives at
the external/private `$BM26_MACHINES` source (local path redacted)
(resolved via `$BM26_MACHINES`; **its contents are not reproduced here**). The
exterior-lights entry is the machine key **`titanic-ext`**; it boots
`profile: prod`, scene `test_bench`, pattern `00_golden_hour_wash`, with
`open_browser: true`.

### 4a. "Make sure our tests are disabled"

Two parts, both checked:

1. **Nothing on the deployed stack runs tests or binds a test port at boot.**
   The boot chain is Scheduled Task → `boot_server.ps1` → `node launcher.js prod
   --scene <X> --no-launch`, which starts only sim, engine, audio companion and
   (now) the CaptainPad static server. No test target, no harness, no `npm test`
   anywhere in that path.
2. **The test suites are no longer shipped at all.** `SYNC_EXCLUDE_DIRS` gained
   `marsin_engine\tests`, `simulation\tests`, `control_podium\tests`. This is the
   defence in depth that matters: `marsin_engine/tests` spins up real engines
   (`tests/e2e`, `tests/hil`), writes temp configs and drives sACN — none of it
   belongs within reach of a show box. Excluded on both sides of the `/MIR`, so
   an older deploy's `tests\` directory is **deleted** from the server on the
   next sync.
   *Not excluded, on purpose:* CaptainPad's tests are colocated
   (`components/**/*.test.ts`) and would need a global `/XF *.test.*` wildcard
   that would also reach into `node_modules`. They are inert on prod — prod
   serves the prebuilt `dist` and never runs Metro or vitest, so nothing loads
   them.

### 4b. The finding: agent worktrees were being mirrored to the show server

A `robocopy /L` of the real tree (to a throwaway local destination, so no server
was touched) showed the deploy would have shipped
**`.claude\worktrees\` — 260 MB of full extra checkouts of this repo**, two of
them, each with its own `node_modules`, `.git`, `marsin_engine\states\` and
complete `tests\` tree. They are gitignored, and the house rule is exactly this:
`robocopy /MIR` ships gitignored files, so only an explicit exclusion keeps them
out. Consequences avoided: every sync bloated; a second engine's runtime state
smuggled onto the box; the test suites arriving anyway (the exclusions above name
only the real tree's paths); and a live race, since an agent can create or delete
a worktree mid-sync. `.claude\worktrees` is now excluded.
`.claude/settings.json` (tracked, carries the security-gate hook) still ships.

### 4c. Dry-run results

`python deploy.py deploy --machine titanic-ext --dry-run` reached step 1 and
**failed at the SSH preflight**: `ssh: connect to host <titanic-ext> port 22:
Connection timed out`. Independent TCP probes from the laptop (which is itself on
the show subnet):

| target | 22 | 445 | 6968 | 6969 |
|---|---|---|---|---|
| `titanic-ext` | timeout | timeout | timeout | timeout |
| `titanic-int` | timeout | — | — | — |
| `titanic-bkup` | timeout | — | — | — |

All three servers are dark or off-LAN. **This is the blocker for item 7** — the
remote half of the deploy could not be exercised. (ICMP is inconclusive on
Windows, but SSH/SMB timing out rather than refusing points at powered-off boxes
or a LAN segment the laptop cannot reach.)

The **local** half was fully exercised instead, by calling `deploy.py`'s own
`robocopy_cmd()` — the exact command the real deploy issues — against a scratch
destination with `/L`:

```
robocopy exit 1  (>=8 would be a real failure) · 67,933 paths listed
[PASS] EXCLUDED marsin_engine/tests        0 lines
[PASS] EXCLUDED simulation/tests           0 lines
[PASS] EXCLUDED control_podium/tests       0 lines
[PASS] EXCLUDED .agent/reports_local       0 lines
[PASS] EXCLUDED marsin_engine/states       0 lines
[PASS] EXCLUDED .agent_renders             0 lines
[PASS] SHIPS   CaptainPad/dist            47 lines
[PASS] SHIPS   tools/static_web_server     1 line
[PASS] SHIPS   marsin_engine/patterns      9 lines
[PASS] SHIPS   launcher.js                 1 line
```

Also confirmed laptop-side: `$BM26_MACHINES` / `$BM26_SECRETS` /
`$BM26_DEPLOY_REGISTRY` are exported; the manifest parses and `titanic-ext`
resolves; `deploy.py --help` and both subcommand parsers are intact;
`boot_server.ps1` parses clean after the URL edit.

---

## 5. Deploy checklist (for the operator, when the machines are up)

**Before you start**

1. `cd CaptainPad && npm run web:build` — **mandatory.** `prod` refuses to start
   without `CaptainPad/dist/index.html`, and the static export is what the show
   machine serves.
2. Confirm the box is reachable: `ssh titanic@<titanic-ext> hostname` should
   answer with `titanic-ext`, and `node --version` must **match the laptop's**
   (node_modules ship as-is).
3. `python scripts/security_check.py --staged` if you intend to commit first.

**Dry run (safe, changes nothing)**

```
cd deploy
python deploy.py deploy --machine titanic-ext --dry-run
```

Read the preview: it should list `CaptainPad\dist` and `tools\static_web_server.cjs`
as new/changed, and must NOT mention `tests\`, `.claude\worktrees\`,
`marsin_engine\states\` or `reports_local`.

**Real deploy**

```
python deploy.py deploy --machine titanic-ext
```

This stops the stack (lights go OFF — it asks the engine for its blackout frame
first), syncs, ships the manifest, applies the overlay, stamps `deploy_info.yaml`,
starts the boot task, and verifies from the laptop.

**Verify on/against the machine**

| check | expected |
|---|---|
| `http://<titanic-ext>:6969/simulation/` | sim page answers |
| `http://<titanic-ext>:6968/status` | engine answers; scene `test_bench` |
| `http://<titanic-ext>:6967/` | **CaptainPad loads** (new) |
| `http://<titanic-ext>:6966/` | Audio Companion answers |
| server console tab | sim URL carries `profile=2d_pixels&spotlights=0` |
| boot log `\\<host>\titanic\logs\boot_server_*.log` | `resolved: … profile 'prod'`, launcher line, no restart loop |
| `node launcher.js status` on the box | every row ✅, including `captainpad`, and frames > 0 |
| rig | lit; sACN priority 150 in the engine's `[sACN Out] Sender started` line |

**Rollback**

* Fast: `python deploy.py deploy --machine titanic-ext --restart-only` (stop +
  start + verify, touching no files) — clears a bad runtime state.
* Full: the laptop tree is the source of truth. Restore the previous state on the
  laptop (git checkout of the last known-good, or undo the local edits), then
  re-run the deploy — `/MIR` makes the server match the laptop again.
* Lights off now: `python deploy.py stop --machine titanic-ext`.
* If prod refuses to start on `CaptainPad/dist/index.html`, either rebuild the
  export or run the box with `--sim-profile`/profile unchanged but CaptainPad
  fixed — do **not** patch the launcher on the server.

---

## 6. Tests

* `simulation/tests/launcher_supervision.test.js` — **22/22 pass** (16 pre-existing
  + 6 new `_245` tests: the prod/dev profile contract, loud sACN validation with
  `0` honoured, unknown sim profile refused, `CI` absent from the child env, LAN
  host detected/refused/overridable).
* `marsin_engine/tests/companion/companion_single_analyzer_contract.test.js` —
  **1/1 pass** (the `companions: ['audio']` shape survived the profile rewrite).
* `node --check launcher.js`, `node --check tools/static_web_server.cjs` — clean.
* `boot_server.ps1` — PowerShell parser: clean.
* No operator port (6966-6972, UDP 5568) was bound at any point; the static server
  smoke used :47991 and the test suite uses the 78xx/79xx throwaway map.

## 7. Open / follow-ups

* **Deploy to `titanic-ext` is still unperformed** — the machine was unreachable.
  Everything else is ready; re-run §5 when it is powered up.
* `deploy/verify_prod` does not probe :6967 explicitly. It does not need to: a
  CaptainPad that will not serve tears the launcher down, so `verify` fails
  anyway. Noted rather than changed.
* CaptainPad's colocated `*.test.ts` files still ship (inert). If that ever
  matters, it needs a wildcard `/XF` that must be scoped away from `node_modules`.
* `boot_server.ps1` opens sim + audio on the show console, not CaptainPad. Left
  as is — the operator asked for it to *run*, not to auto-open.

---

## 8. Post-landing fix — the "[object Object]" bundle host (my defect)

**Found live**, on the gen-6 first launch after this work landed: the stack died
at boot. The captainpad child exited with `TypeError: Invalid URL` raised inside
`@react-native/dev-middleware`'s `InspectorProxy`, and the launcher — correctly —
tore the whole stack down behind it.

**Mechanism.** `detectLanHost()` returns `{ host, source }`. `main()` bound the
whole object:

```js
const lanHost = detectLanHost(os.networkInterfaces(), opts.lanHost);   // the OBJECT
…
REACT_NATIVE_PACKAGER_HOSTNAME: lanHost,                               // → "[object Object]"
```

Node stringifies a non-string env value, so the child received
`REACT_NATIVE_PACKAGER_HOSTNAME=[object Object]`. Metro's dev-middleware feeds
that to `new URL()` when it builds the inspector's WebSocket target, which throws
`Invalid URL` before the dev server can finish coming up. The two "bundle host"
log lines printed `[object Object]` too, which is the tell.

**Fix** (hot-fixed by the coordinator; kept as-is, launcher.js ~1503-1510):
`lanHostInfo` holds the object, `lanHost` holds the plain string —
`const lanHost = lanHostInfo ? lanHostInfo.host : null;` — with a comment naming
the failure so the next reader does not re-collapse them.

**Why the existing tests missed it.** §6's `detectLanHost` tests only exercise
the helper's *return value* (`.host`, the loud-ambiguity throws). The defect was
entirely at the **call site**: a correct helper, unwrapped wrongly. A unit test
of a pure function cannot see that.

**Regression tests added** (`launcher_supervision.test.js`, now **24/24**):

1. *`REACT_NATIVE_PACKAGER_HOSTNAME` is a plain host STRING, never the
   `{host,source}` object* — pins the call site by source inspection (the same
   technique, and for the same reason, as the pre-existing "ORDER: cmdStop
   requests the blackout BEFORE it force-kills" test): the env value must be a
   bare identifier, never an inline `detectLanHost(...)`; that identifier's
   declaration must contain `.host`; and **every** `bundle host ${…}` log line
   must interpolate the same identifier, so the log can never disagree with the
   env var and mislead the next debugger.
2. *the detected host stringifies as a hostname, and the raw object does NOT* —
   pins the `{host, source}` shape, asserts `host` is a string matching an
   IPv4/hostname shape (what `new URL()` needs), and asserts
   `String(info) === '[object Object]'` so the hazard is stated concretely in
   the suite rather than only in prose.

Test 1 was **mutation-checked**: replayed against the buggy binding it fails
(`must be bound to .host`), and passes on the fixed one — it is a real guard,
not a tautology.

**Other consumers of `detectLanHost`** (asked, checked): there is exactly **one**
production call site, the fixed one. `lanIpv4Candidates` is used only inside
`detectLanHost`. Both are exported solely for the test suite, which consumes the
object shape consistently (`.host` everywhere). Nothing else in the repo — no
script, doc, deploy path or CaptainPad code — reads either function. No further
unwrapping to fix.

**Also fixed while here** (flagged by the `_247` README review): the
`openProfileUis` header comment still claimed *"prod (no captainpad process) →
sim → Companion"*, false since §2 — prod now runs CaptainPad and opens all three
UIs. Corrected, with a note that a show server is unaffected because
`boot_server.ps1` launches with `--no-launch` and opens its own console tabs.

### Report-number collision (numbering ledger honesty)

`_247`'s review found **two reports occupying `_245`**: this one
(`20260815_245_launcher_prod_deploy_prep.md`) and a foreign
`20260815_245_deck_transition_debug_audit.md` from a concurrent session. Both
exist on disk; the foreign file is **left untouched**. Recorded here so the
number is not silently assumed unique — the tracker block for `_245` refers to
*this* report only.
