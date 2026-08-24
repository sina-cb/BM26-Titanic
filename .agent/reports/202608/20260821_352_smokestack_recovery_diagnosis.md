# 352 — Smokestack recovery diagnosis + Advanced Recovery plan

Fable debugger output. **Diagnosis and plan only — nothing was implemented.**
Scope of what was done: read-only code audit of the BM smokestack stack
(`simulation/src/dmx/smokestack_mode.js`, `simulation/src/gui/smokestack_panel.js`,
`simulation/server/smokestack_cli_service.cjs`,
`simulation/server/smokestack_status_service.cjs`, `simulation/server/save-server.js`
smokestack routes, and their four test files), a read-only audit of the private
MarsinLED deploy CLI (`deploy/smokestack_mode.py` + `deploy/lib/smokestack/*`),
a read-only inspection of the isolated worktree `f74e`, and **read-only live
readbacks** of the four rope controllers (`GET /api/status`, `GET /api/config`,
`GET /api/files?path=/models`, `GET /api/files?path=/patterns`,
`GET /api/patterns` — the same GET surface the CLI's own dry-run reads).

Not done, by gate: no APPLY, no controller write, no flash, no restart of any
service, no launcher/lock action, no git operation, no sim `npm run check`.
Focused suites were run from the working tree only (no stack port touched):
MAIN `smokestack_mode_model` + `cli_service` + `status_service` **88/88**,
MAIN `smokestack_routes` **12/12** (throwaway save-server on a random high
port with a node stub CLI), `f74e` `smokestack_mode_model` **56/56**.

Controllers are named by controllerId only throughout.

---

## Part A — Diagnosis

### A0. Fresh live readback (read-only, taken during this session)

| controllerId | saved mode (`config.dmx.enabled`) | `swarm.isLeader` | `follow.state` | beacon age | `health` | `perOutputDmx` | firmware |
|---|---|---|---|---|---|---|---|
| `ss_left_left` | false → **SWARM** | false | **DETACHED** | ~0.8 s (fresh) | primary, no staged | true | 1.2.5 |
| `ss_left_right` | false → **SWARM** | **true** (sole leader) | OFF (leader) | n/a | primary, no staged | true | 1.2.5 |
| `ss_right_right` | false → **SWARM** | false | **DETACHED** | ~0.8 s (fresh) | primary, no staged | true | 1.2.5 |
| `ss_right_left` | false → **SWARM** | false | FOLLOWING | ~0.9 s | primary, no staged | true | 1.2.5 |

All four reachable; all four report their canonical `controllerId`; no
duplicate leader; `config.swarm.groupId == modelId == 19` and
`showFollow.enabled/followOnBoot == true` on all four; `wifi.apEnabled == true`
on all four (the SWARM-mode value). Output mapping per `config.strands`
(enabled strands only) is exactly the immutable map: `ss_left_left` U30/U31,
`ss_left_right` U32/U33, `ss_right_right` U36/U37, `ss_right_left` U34/U35,
every one at address 1, 40 px, `WS281X_RGBW`, order RGBW; outputs 3/4
disabled. `status.sacn.perOutput` already echoes those origins.

This matches the operator's pre-handoff census exactly.

### A1. The exact two role/coherence failures

Both are **SWARM followers whose `follow.state` is `DETACHED`**:
`ss_left_left` and `ss_right_right`.

- BM model: `smokestack_mode.js:390-410` — an expected follower in live SWARM is
  `roleOk` only when `swarm.enabled && !isLeader && followState === 'FOLLOWING'
  && lastBeaconMsAgo < 15000`. `DETACHED` fails the `FOLLOWING` term, so each
  gets the warning `LIVE SWARM TOPOLOGY FAILURE — expected a non-leader
  FOLLOWING with a fresh leader beacon` and `readinessLabel = 'live follower
  stale'`. (Label nit: both beacons are *fresh*; the failure is the state, not
  staleness.)
- Fleet toggle: `smokestack_mode.js:638-647` — `swarm === 4 && topologyFailures
  (=2) > 0` returns `action: null, enabled: false, reason: "2 controller
  role/coherence failure(s); resolve split-brain, leader or stale-follower
  state first"`. That is the exact string the operator saw.
- Private CLI agrees on the classification: `deploy/lib/smokestack/health.py:192-206`
  `swarm_follower_ok` returns `follow.state=DETACHED (expected FOLLOWING)`.

What `DETACHED` means (firmware, one line, no internals copied): a
*voluntary, sticky* follower state entered when local control took over the
board; it does **not** re-attach on the next beacon — re-attachment waits for
a takeover threshold (`showFollow.takeoverMin = 10`; both boards show
`takeoverMsRemaining ≈ 600 s` counting). So the fleet will not self-heal on
any useful timescale, and the leader beaconing continuously is precisely why
the timer keeps resetting. Both DETACHED boards have the `pushed_map.json`
active-map residue (see A4), i.e. both received a local mapping push after
the swarm was formed — consistent with the sticky-detach cause. Firmware-side
root cause is MarsinLED's domain; nothing here depends on it.

### A2. Is either failure genuinely unsafe for TO DMX — or only for Swarm?

**Only for entering/maintaining SWARM.** Evidence in the private CLI:

- `plan_board` (`runner.py:238-350`) — the to-dmx pre-mutation gates are:
  baseline readable, MAC identity, committed/primary config, `wifi.apEnabled`
  readable, `perOutputDmx` capability, registry DMX plan valid. **No
  leader/follower/coherence gate exists on the to-dmx path.**
- `_verify` (`runner.py:559-694`) — the to-dmx branch verifies saved mode,
  target projection, runtime mode, `apEnabled`, committed config, runtime
  `sacn.perOutput` == saved origins, uptime monotonic. Coherence checks
  (`swarm_leader_ok/swarm_follower_ok`) are inside `if mode == "to-swarm"`.
- `runner.py:1166` comment and code: *"DMX has no leader/follower dependency"*;
  to-dmx runs in registry order with no topology input (`topology` is computed
  only for to-swarm, `runner.py:1030-1031`).
- `build_to_dmx_body` (`plan.py:268-301`) writes `dmx.enabled=true`,
  `swarm.enabled=false`, registry origins onto the live enabled strands, and
  `wifi.apEnabled=false`; it preserves every other swarm field (role,
  groupId, showFollow) so the saved role survives the switch.

Conversely, both DETACHED boards are unsafe to *keep* in SWARM (terminal
coherence would fail) and a `to-swarm` run would fail their verify ladder.

### A3. Does the normal fleet model overblock the recovery direction?

**Yes.** `smokestackFleetToggleModel` offers `Recover all to DMX` for a
*mixed* DMX/SWARM fleet (`smokestack_mode.js:622-629`) — a strictly less
coherent state — yet refuses everything for a *uniformly SWARM* fleet with
any topology failure (`:638-647`). The blockers that genuinely matter for
to-dmx (identity mismatch, staged/degraded config, missing capability,
invalid dual mode, unknown/unreachable) are already evaluated **before** that
branch (`:597-621`). The topology branch therefore blocks only the safe
escape and protects nothing the CLI would not protect itself.

### A4. Does asset mismatch become the next blocker? — **Yes, immediately.**

The canonical exact-four CLI run (default selector, `canonical=True`) applies
`_canonical_board_contract` to **every board for both directions**
(`runner.py:256-258`, called from `plan_board` regardless of mode) and
`_canonical_fleet_parity` (`runner.py:429-457`, applied at `:1038-1041` dry-run
and `:1062-1065` apply). Fresh read-only asset readback:

| controllerId | `activePattern` | `activeMap` | `activeMapHash` | `/models` listing | `/patterns` listing |
|---|---|---|---|---|---|
| `ss_left_left` | `/patterns/titanic_swarm_pattern.js` | **`/models/pushed_map.json`** | `1cfc9081` | 22 files (broad legacy image incl. `pushed_map.json`) | 18 files (broad) |
| `ss_left_right` | `/patterns/titanic_swarm_pattern.js` | **`/models/pushed_map.json`** | `1cfc9081` | 22 files (broad legacy image) | 18 files (broad) |
| `ss_right_right` | **`/patterns/default.js`** | **`/models/pushed_map.json`** | `31ef7d91` | filtered release **+ `pushed_map.json`** | filtered (2) |
| `ss_right_left` | `/patterns/titanic_swarm_pattern.js` | `/models/swarm_titanic_rop_b5fc8e9e.json` | `130aa205` | filtered release (4), no residue | filtered (2) |

`firmwareSHA` is `e046e8842986` on all four; `colors.engine.leased == false`
on all four.

So after the A3 overblock is lifted, the canonical `to-dmx --dry-run` would
print `WOULD REFUSE` on three of four boards: `activeMap` gate (`runner.py:172-176`)
on the left pair and `ss_right_right`; `activePattern` gate (`:167-171`) on
`ss_right_right`; model/pattern allowlist gates (`:207-217`) on the left pair
and the `pushed_map.json` extra on `ss_right_right`; compiled-manifest gate
(`:218-236`) on the left pair; and fleet parity on `activeMapHash` and
`dataFingerprint` (`:438-456`). The fleet toggle alone therefore cannot return
the fleet to DMX today. **Do not weaken this contract** — it is what protects
the "kill the network" verdict.

New since report `_346`: `ss_right_right` is **no longer canonical** (it was
filtered token `683121a1`); it now runs `default.js` on a `pushed_map.json`
(`31ef7d91`). Only `ss_right_left` matches the frozen release. The
remediation scope in `_346` ("left pair only") is stale; `ss_right_right`
needs the same registry-locked full release too.

### A5. Are targeted CLI mutations fingerprint-bound today?

**BM side — yes, fully.** `smokestack_cli_service.cjs:277-306` refuses an
apply without a completed, clean, fresh (15 min), same-action dry-run carrying
an exact 64-hex fingerprint, and `:313-320` passes `--plan-fingerprint
<reviewed>` for every apply **including** `repair-to-dmx` (`to-dmx --names …`).
`finishJob` (`:211-226`) additionally flags `planFingerprintMismatch` when the
apply's emitted fingerprint differs — but that is post-hoc, after the CLI
already ran.

**Private CLI side — NO for every non-canonical run.** `runner.py:1089`:

```python
if canonical and expected_plan_fingerprint != run.plan_fingerprint:
```

With `--names …` (any subset ≠ the exact four) `canonical` is `False`
(`runner.py:1027-1029`; same computation in `smokestack_mode.py:291-293`), so the
supplied `--plan-fingerprint` is **ignored** — missing, malformed, stale or
wrong values all proceed to mutate. The flag's own help text says "required
for the canonical Titanic four-board apply" (`smokestack_mode.py:142-145`), and
no private test exercises a fingerprint on a `--names` apply
(`tests/test_smokestack_mode_plan.py:487-540` applies a `--names` subset with
`--yes` and no fingerprint). The BM routes test cannot catch this: its node
stub (`smokestack_routes.test.js:41-66`) enforces the fingerprint for every
`--yes`, which is stricter than the real CLI.

Also unenforced for non-canonical: `--rollback-on-failure` is only mandatory
when canonical (`smokestack_mode.py:295-297`) — BM always passes it, so this is
belt-and-braces; and `_canonical_board_contract` + parity are skipped (that is
exactly the property the escape hatch needs, see B1).

**Verdict: the targeted path is NOT fingerprint-bound today → blocking
companion fix in the private CLI before any Advanced Recovery apply.**

### A6. Smallest safe fix

1. **BM** — integrate the `f74e` one-hunk change to
   `smokestack_mode.js:638-647`: for a uniformly SWARM fleet with topology
   failures (and **no** `switchBlockers`, which are checked first), return
   `{action: ACTION_TO_DMX, label: 'Recover all to DMX', enabled: true,
   reason: '<n> live SWARM role/coherence failure(s) — guarded exact-four DMX
   recovery only'}`. Never offers TO SWARM. Plus its three test hunks.
   This is correct on its own, but today it only moves the refusal from the
   BM toggle to the CLI's asset contract (A4) — honest, not a fleet fix.
2. **Private CLI** — `runner.py:1089` drop `canonical and`; make
   `--plan-fingerprint` mandatory for every `--yes` run in
   `smokestack_mode.py` (usage error 2 when absent). This is a two-line
   production change plus test-harness updates (B2).
3. **Then** the Advanced Recovery force path (B1) is what actually returns
   this fleet to DMX one controller at a time while the asset contract stays
   strict for the fleet flow.

### A7. Verdict on the `f74e` candidate — **selectively integrate**

`f74e` is a Codex worktree on the same commit (`a239b8bf`) as MAIN with a
*different* set of uncommitted changes (it lacks MAIN's newer launcher /
gamma / test work; it carries a `CaptainPad` config edit MAIN lacks). Do
**not** sync worktrees. The relevant delta is exactly two hunks:

- `simulation/src/dmx/smokestack_mode.js` lines 638-647 (the toggle branch).
  Everything else in that 990-line file is byte-identical to MAIN, so the
  `_346` MAIN work (fingerprint gate, repair model, readback transitions) is
  preserved.
- `simulation/tests/smokestack_mode_model.test.js`: renames/rewrites the test
  at line 532 (`only healthy live SWARM selects switch-to-DMX` → `healthy
  SWARM switches to DMX; unhealthy canonical SWARM recovers only to DMX`) and
  adds two tests: split-brain / absent-leader / stale-follower all stay
  non-green and offer DMX only; unhealthy SWARM recovery stays blocked by
  identity/config/capability blockers.

The server, panel, status service, routes and their tests are identical in
both trees. Judgement: the hunk is narrow, keeps every pre-existing blocker
ordering, never enables TO SWARM, and the 56/56 + 12/12 results hold. Keep
it. One wording fix while integrating: the reason string should not imply
the fleet *is* healthy enough for a fleet run — A4 shows the CLI will still
refuse on assets; suggested: `… — guarded exact-four DMX recovery only; the
CLI's asset/identity contract still applies`.

### A8. Additional findings that shape the plan

- **A single-board `to-swarm --names ss_left_right` prints `SAFE TO KILL
  NETWORK`.** `_terminal_swarm_verification` (`runner.py:944-948`) returns
  `True` when the target set has no followers ("leader-only target set"), so
  the CLI's fleet verdict is emitted for a one-controller run. BM must never
  surface that line as fleet success from a force action.
- **A single-follower `to-swarm --names <follower>` can never succeed.**
  `runner.py:927-929` requires exactly one leader *in the target set*; with
  none it returns `NOT SAFE` and the target is rolled back. FORCE TO SWARM for
  a follower must therefore run with the leader in the set (B1.2) — which is
  also the spec's "only with a healthy fresh sole leader" rule made concrete.
- **Non-canonical `to-swarm` does not assert topology.** `topology` is
  computed only when canonical (`runner.py:1030-1031`), so the body carries no
  `nodes`/`modelId` re-assertion (`plan.py:303-340`). A board already in SWARM
  is `already_target` and gets **no POST** (`runner.py:336-349`): FORCE TO
  SWARM cannot "heal" a DETACHED follower in place — it is idempotent there
  and only re-verifies (which fails on DETACHED). The healing path is FORCE
  TO DMX → (later) canonical TO SWARM, or FORCE TO DMX → FORCE TO SWARM for
  that board (a real DMX→SWARM transition does POST).
- **The plan fingerprint includes live `status.colors` and `config`**
  (`runner.py:382-420`); any colour/config drift between dry-run and apply is
  an honest `REFUSED PLAN FINGERPRINT` (zero writes). Keep the force window
  short and re-run the dry-run on refusal; never widen the document.
- A to-dmx POST returns `needs-reboot`; the CLI rides the reboot
  (`--reboot-wait 90`) and then verifies; expect ~1-2 min per forced board.
- BM `outputPhase`/`controllerOutputPhase` (`smokestack_mode.js:708-735`) key
  on `target.ip`/controllerId substrings; the CLI prints registry names
  (= controllerIds) so per-row phases keep working for `--names` runs.

---

## Part B — PLAN FOR CHATGPT (paste-ready)

### B0. Ground rules for the implementer

- Work in the MAIN `feat/bm_readiness` working tree. No git operations, no
  stack restarts, no CLI `--yes`, no controller writes. Everything below is
  code + tests + mocks. The first live dry-run and every apply are Sina's.
- Never weaken: fingerprint validation, the canonical asset/identity contract,
  one-job-at-a-time, `--rollback-on-failure`, the no-partial-success wording.
- Foreign-owned files stay untouched. Only the files named below change.
- Privacy: the public repo must not gain IPs, MACs, registry contents or
  machine paths; tests keep using RFC 5737 addresses and stub CLIs.

### B1. BM changes (simulation/)

#### B1.1 `simulation/src/dmx/smokestack_mode.js`

**(a) Integrate the `f74e` hunk** at lines 638-647 (see A6/A7; use the
amended reason string).

**(b) New exports** (place after `ACTION_REPAIR_TO_DMX`, line 508):

```js
export const ACTION_FORCE_TO_DMX = 'force-to-dmx';
export const ACTION_FORCE_TO_SWARM = 'force-to-swarm';
export const FORCE_ACTIONS = Object.freeze([ACTION_FORCE_TO_DMX, ACTION_FORCE_TO_SWARM]);
export const FORCE_DRY_RUN_FRESH_MS = 5 * 60 * 1000;   // short boundary, vs 15 min fleet
export const FORCE_READBACK_MAX_AGE_MS = REPAIR_READBACK_MAX_AGE_MS; // 30 s
export function forceConfirmPhrase(action, controllerId) {
  // exact, controller-specific: 'FORCE DMX ss_left_left' / 'FORCE SWARM ss_left_left'
}
```

`CONFIRM_PHRASES` stays as is for the three fleet/repair actions; force
phrases are derived, never table-looked-up, and must throw on an unknown
action or a controllerId outside `SMOKESTACK_CONTROLLER_IDS`.

**(c) New pure model `smokestackForceRecoveryModel(targets, statuses, readback,
{controllerId, action}, now = Date.now())`** returning:

```js
{ visible, eligible, action, controllerId, target,           // target = the frozen semantic target row
  targetState: {mode, role, followState, beaconAgeMs, readbackAgeMs},
  blockers: string[],          // any non-empty ⇒ eligible=false, first one is the headline
  bypasses: string[],          // which normal-flow rule this force steps around (display only)
  stillRefuses: string[],      // fixed list rendered verbatim (identity, capability, staged…)
  preserved: { role: 'saved leader'|'saved follower', outputs: [{output, universe, address, px, order}] },
  consequence: string,         // 'fleet becomes MIXED (3 SWARM / 1 DMX)' etc., computed from statuses
  cliNames: string[],          // ['ss_left_left'] or ['ss_left_right','ss_left_left'] (B1.2)
  leaderContextRequired: boolean }
```

Rules (all evaluated from the **fresh** readback; `readback.sweptAt` older than
`FORCE_READBACK_MAX_AGE_MS` or `readback.sweeping` ⇒ blocker `status readback
is stale/running`):

- Selection: `controllerId` must be one of the four; the scene target must
  exist and `status.controllerId === target.controllerId`. Anything else ⇒
  blocker `unknown/ambiguous identity`. Never accept IP/name/free text.
- Common refusals (both actions): unreachable; `MODE_UNKNOWN`; identity
  mismatch; `health.stagedPending`; `configSource !== 'primary'`;
  `capabilities.perOutputDmx !== true` (to-dmx needs it and the CLI verifies
  it on the swarm path too — keep one rule); `MODE_INVALID` ⇒ blocker
  `dual/none-enabled board: use Repair to DMX, not force`; any other board in
  the fleet unreachable/unknown ⇒ blocker `full four-controller readback
  required` (the consequence line and the leader rule need all four).
- `FORCE_TO_DMX` eligible when target is `MODE_SWARM` (any role state —
  DETACHED, stale, split-brain, detached leader, asset mismatch are the
  *allowed* bypasses and are listed in `bypasses`) or already `MODE_DMX`
  (idempotent; `bypasses` empty, consequence `no change expected`).
- `FORCE_TO_SWARM` eligible when:
  - target `controllerId === SMOKESTACK_LEADER_CONTROLLER_ID` and no other
    board reports `isLeader === true` (duplicate-leader prevention); or
  - target is a follower **and** the leader's row is `MODE_SWARM` with
    `roleOk === true` in the same fresh readback (`leaderContextRequired =
    true`, `cliNames = [leader, target]`), **and** no other board reports
    `isLeader`. A follower with a missing/unhealthy leader ⇒ blocker
    `follower cannot enter SWARM without a healthy fresh sole leader`.
  - The model never bypasses asset validation for SWARM: it adds no asset
    check of its own (the CLI's non-canonical path does not run the
    contract), so `stillRefuses` must state plainly that FORCE TO SWARM is
    *not* a fleet-safe verdict and that the fleet TO SWARM (canonical) flow
    remains the only path to `SAFE TO KILL NETWORK`.
- `preserved.outputs` is read from `target.swarmModel.outputs` + the scene
  ports (U/address/px) — the model must not invent them; if the status sweep
  exposes `sacn.perOutput`, include it as `live` alongside `scene` and add a
  blocker when they disagree (`uncertain mapping`).

**(d) `applyGateModel(dryRunJob, action, typedPhrase, {controllerId, preflightDigest})`**
— extend (backward compatible for the existing callers): for force actions
require `dryRunJob.action === action`, `dryRunJob.targetIds` deep-equal
`[controllerId]` (single id; the leader-context name is *not* a target),
`typedPhrase === forceConfirmPhrase(action, controllerId)`, fingerprint
64-hex, and `dryRunJob.preflightDigest === preflightDigest` (see B1.3 —
state drift between dry-run and apply refuses). Also honor
`FORCE_DRY_RUN_FRESH_MS` (the server enforces the same).

**(e) `jobOutcomeModel`** — two new kinds, both with `safeToKillNetwork:
false` unconditionally:

- `force_dmx_ok`: exit 0 and `VERDICT: OK` ⇒ headline `TARGET <id> VERIFIED
  IN DMX BY CLI — fleet verdict pending independent readback`.
- `force_swarm_ok`: exit 0 and verdict is `VERDICT: SAFE TO KILL NETWORK`
  **or** `VERDICT: OK` ⇒ headline `TARGET <id> ENTERED SWARM — FLEET
  COHERENCE NOT YET PROVEN`; the model must explicitly downgrade the CLI's
  kill verdict (A8 bullet 1) and `reason` must say so.
- failures: `force_failed` with the CLI's own failure verdict/refusal line,
  and rollback wording surfaced via the existing `controllerOutputPhase`
  `restored` detection.

**(f) `smokestackControllerTransitionModel`** — treat force jobs like repair
jobs: non-targeted rows render `excluded · <mode>`; the targeted row's
`expectedMode` follows the action; for `force-to-swarm` with leader context the
leader row must render `context · no write expected` and, after readback,
`context verified · unchanged` only if its mode is still SWARM and its
`uptimeMs` did not reset (pass `preUptimeMs` from the dry-run readback).

**(g) Fleet-level honesty helper** `forceFleetVerdict(action, controllerId,
boardsAfterReadback)` → `'TARGET RECOVERED TO DMX — FLEET REMAINS MIXED'`,
`'TARGET RECOVERED TO DMX — FLEET NOW ALL DMX (re-run the fleet readback
before any fleet action)'`, `'TARGET ENTERED SWARM — FLEET COHERENCE NOT YET
PROVEN'`, or `'TARGET NOT VERIFIED — <reason>'`. It never returns a string
containing `SAFE TO KILL`.

#### B1.2 `simulation/server/smokestack_cli_service.cjs`

- `ACTIONS` / `MUTATING_ACTIONS` (lines 58-59): add `'force-to-dmx'`,
  `'force-to-swarm'`.
- `validateTargetIds` (102-128): for force actions require **exactly one**
  id from `TITANIC_TARGET_IDS`; fleet actions still reject `targetIds`.
- New `validateForceContext(action, targetIds, leaderContext)`: for
  `force-to-swarm` on a follower the request must carry `leaderContext:
  'ss_left_right'` (the only value accepted); for the leader target it must be
  absent. The server freezes `cliNames = leaderContext ? [leader, target] :
  [target]` into the dry-run job and requires byte-equality at apply.
- Confirm phrase: replace the `CONFIRM_PHRASES[action]` lookup at apply with
  `confirmPhraseFor(action, targetIds)` — `'SWITCH'` for the three existing
  actions, `FORCE DMX <id>` / `FORCE SWARM <id>` for force. Keep the routes
  parity test by exporting the function and asserting it equals the model's
  `forceConfirmPhrase` for all 8 (action × id) combinations.
- Apply gate additions (after line 306): `preflightDigest` (string, from the
  request) must equal the dry-run job's frozen `preflightDigest`; freshness
  for force jobs uses `FORCE_DRY_RUN_FRESH_MS` (new option
  `forceDryRunFreshMs`, default 5 min); and the dry-run's `cliNames` must
  equal the apply's.
- Args (313-320):
  - `force-to-dmx` → `['to-dmx', '--names', id, ...(apply ? ['--yes',
    '--rollback-on-failure', '--plan-fingerprint', fp] : ['--dry-run'])]`
  - `force-to-swarm` → `['to-swarm', '--names', cliNames.join(','), ...same]`
- Leader-context no-write gate (server-side, dry-run completion): when
  `cliNames.length === 2`, the dry-run output must contain the exact line
  `ss_left_right: already in target mode - no mutation POST would be sent`
  (the CLI's `_dry_result` contract, `runner.py:903-905`); otherwise mark the
  dry-run `leaderContextUnsafe = true` and refuse the apply with code
  `force_leader_context`. Fail closed on any other wording.
- Stale job IDs / fingerprints: keep `COMPLETED_JOBS_KEPT`, but additionally
  mark a dry-run `consumed = true` the moment an apply referencing it is
  accepted; a consumed dry-run is refused for any later apply
  (`dry_run_required`). A fingerprint is never accepted from the request
  body — only from the stored dry-run job.
- `toPublicJob`: add `targetIds`, `cliNames`, `preflightDigest`, `consumed`,
  `leaderContextUnsafe`.

#### B1.3 Preflight digest (drift refusal)

Define in `smokestack_mode.js` `preflightDigest(targets, statuses)` = SHA-256
(Web Crypto in the browser is async — use a deterministic string join
instead: `controllerId|mode|isLeader|followState|stagedPending|configSource|
perOutputDmx|firmwareTag|reachable` per board, in `SMOKESTACK_CONTROLLER_IDS`
order, joined by `;`). The panel computes it from the fresh readback that
*precedes* the dry-run, sends it with the dry-run request (server freezes
it), recomputes it from the mandatory post-dry-run readback and again
immediately before APPLY; any difference disables APPLY with `state drifted
since the dry-run — re-run`. Beacon age is deliberately excluded (it changes
every second); `followState` is included (DETACHED→FOLLOWING is a real change).

#### B1.4 `simulation/server/save-server.js`

`statusByCode` (line 1170-1181): add `force_target_required: 400`,
`force_leader_context: 409`, `force_drift: 409`, `dry_run_consumed: 409`.
Pass `leaderContext` and `preflightDigest` from the parsed body into
`startJob` (line 1157-1163).

#### B1.5 `simulation/src/gui/smokestack_panel.js`

Add a second `<details class="smk-recovery">` titled **"Advanced Recovery —
force ONE controller"**, mounted after the repair row and before the existing
`Advanced details` (line 751 area in `createSection`), visibly distinct
(danger border, its own summary). It is collapsed by default, its open state
survives repaints like `advancedOpen`, and it is **disabled** while any job is
running or the deployment source is unprovisioned. Contents:

1. Controller selector: four radio buttons labelled `operatorLabel ·
   controllerId` (no free text, single choice).
2. Two buttons `FORCE TO DMX…` / `FORCE TO SWARM…` (danger styling; each runs
   `refreshSmokestackStatuses()` first, then the dry-run only if the model is
   eligible). Each click path: fresh readback → `smokestackForceRecoveryModel`
   → if blockers, show them and stop; else `startRun(action, {targetIds:[id],
   leaderContext, preflightDigest})`.
3. Pre-confirm summary block (from the model): target state + readback age;
   requested result; preserved saved role + output map table; "why the
   normal action is blocked" (the fleet toggle's current `reason`); "what this
   force bypasses"; "what it still refuses" (verbatim list); fleet consequence.
4. Dry-run console (reuse `renderConsole`) + plan fingerprint shown in full
   (64 chars, monospace) + the preflight digest status (`matches` / `drifted`).
5. Confirm row: input with placeholder `type FORCE DMX ss_left_left to arm`,
   APPLY button gated by the extended `applyGateModel` + readback freshness +
   digest match; Cancel.
6. Result: apply console; then the mandatory readback (existing
   `queuePostJobReadback`) — render the target's transition, the leader-context
   row when present, and the **fleet verdict from `forceFleetVerdict`** as the
   banner headline. Then the normal fleet toggle re-evaluates from the same
   readback (so a now-MIXED fleet shows `Recover all to DMX`).

`startRun` (line 183): accept `leaderContext` and `preflightDigest` in the
payload for force actions; `actionLabel` (283): add the two labels;
`updateJobBanner` (352): `direction` strings `FORCE TO DMX <id>` / `FORCE TO
SWARM <id>`; never print the CLI's `SAFE TO KILL NETWORK` line as the trusted
verdict for a force job (render `Trusted verdict: NONE · CLI said …`).

#### B1.6 `simulation/style.css`

`smk-recovery`, `smk-recovery-summary`, `smk-recovery-select`,
`smk-recovery-card`, `smk-recovery-bypass`, `smk-recovery-refuses`,
`smk-recovery-consequence`, `smk-fingerprint` — theme custom-properties
only, next to the existing `.smk-advanced` block (style.css:4304).

### B2. Private CLI companion (BLOCKING before any force apply)

Files in the private MarsinLED checkout (never copied here):

1. `deploy/lib/smokestack/runner.py:1089` — change
   `if canonical and expected_plan_fingerprint != run.plan_fingerprint:` to
   `if expected_plan_fingerprint != run.plan_fingerprint:`. The refusal
   block and verdict `REFUSED PLAN FINGERPRINT - NO board was mutated` stay.
2. `deploy/smokestack_mode.py` (around lines 291-297) — for every `to-dmx` /
   `to-swarm` run with `--yes`, require `--plan-fingerprint` matching
   `^[0-9a-f]{64}$`; otherwise `USAGE ERROR: apply requires the
   --plan-fingerprint printed by the immediately preceding dry-run` (exit 2).
   Update the `--plan-fingerprint` help text (line 142-145) to "required for
   every apply". Optionally also require `--rollback-on-failure` for every
   apply (BM always sends it).
3. Tests — `tests/test_smokestack_mode_plan.py` (3 `--yes` uses) and
   `tests/test_smokestack_mode_runner.py` (13): add a helper that runs the
   same argv with `--dry-run`, captures `PLAN FINGERPRINT: …`, and appends
   `--plan-fingerprint <fp>` to the `--yes` argv. Add: (a) `--names` subset
   apply **without** fingerprint → exit 2, zero POSTs; (b) with a wrong 64-hex
   fingerprint → `REFUSED PLAN FINGERPRINT`, zero POSTs; (c) with the
   dry-run's fingerprint → proceeds; (d) single-leader `to-swarm --names
   ss_left_right` still prints `SAFE TO KILL NETWORK` (document it as the
   known single-board wording BM downgrades; or, better, print `OK` instead
   when the target set is not canonical — recommended, one-line change at
   `runner.py:1197-1198`, guarded by `canonical`).
4. `deploy/SMOKESTACK_MODE.md` — document that every apply is
   fingerprint-bound and that `--names` runs skip the canonical asset
   contract (so they are *not* fleet-safe and never produce a kill verdict).
5. Optional hardening (not blocking): a `--json` output mode, and a
   `--context NAME` selector that includes a board read-only for
   topology/coherence without ever planning a write to it (would replace the
   BM "already in target mode" line-parsing gate in B1.2).

### B3. Ordered test list (BM; `node --test tests/smokestack_*.test.js`)

`smokestack_mode_model.test.js`
1. (f74e) unhealthy uniform SWARM offers `Recover all to DMX`; healthy SWARM
   offers `Switch all to DMX`.
2. (f74e) split-brain / absent leader / stale follower / **DETACHED follower**
   each: non-green, `uniform=false`, toggle `to-dmx`, never `to-swarm`.
3. (f74e) unhealthy SWARM recovery still blocked by identity/staged/
   degraded/capability blockers.
4. `forceConfirmPhrase` exact strings for all 8 combos; throws on unknown.
5. Force model allowlist: IP, card name, numeric id, free text, two ids,
   empty ⇒ not eligible with `unknown/ambiguous identity`.
6. FORCE TO DMX eligible from DETACHED follower (this fleet's exact readback
   as fixture), from stale follower, from split-brain follower, from
   detached/inactive leader, from a readable mixed fleet; `bypasses` names
   the rule; `consequence` says MIXED with the right counts.
7. FORCE TO DMX refuses: unreachable, unknown mode, identity mismatch,
   staged, degraded configSource, missing `perOutputDmx`, INVALID (redirect to
   Repair), any sibling unreachable, stale/running readback.
8. FORCE TO SWARM refuses: follower with no healthy leader; duplicate leader
   anywhere; target claiming leader while not the saved leader; leader target
   when another board `isLeader`; identity mismatch; staged/degraded; and the
   fixture's asset-mismatch note appears in `stillRefuses`.
9. FORCE TO SWARM follower path sets `leaderContextRequired` and
   `cliNames=[leader, target]`; leader path `cliNames=[leader]`.
10. Preserved mapping/role: `preserved.outputs` equals the immutable table for
    each id; role is `saved leader` only for `ss_left_right`.
11. `preflightDigest`: identical readbacks ⇒ equal; a `followState` or
    `stagedPending` change ⇒ different; beacon age change ⇒ equal.
12. `applyGateModel` force: missing dry-run, other action, other id, apply
    job, non-64-hex / uppercase / 63-char fingerprint, wrong phrase (fleet
    `SWITCH`, other controller's phrase, lowercase), digest drift ⇒ refused.
13. Outcomes: `force_dmx_ok` never `safeToKillNetwork`; `force_swarm_ok`
    downgrades `VERDICT: SAFE TO KILL NETWORK`; failures carry the CLI
    reason; `forceFleetVerdict` strings never contain `SAFE TO KILL`.
14. Transitions: leader-context row `context · no write expected` then
    `context verified · unchanged` only when uptime did not reset; target row
    `failed readback` when mode ≠ expected; rollback wording preserved.
15. Idempotent: FORCE TO DMX on a DMX board eligible with empty `bypasses`;
    readback unchanged ⇒ verified.
16. Mock matrix: ≥5 cycles FORCE DMX → FORCE SWARM (leader, then each
    follower with leader context) → FORCE DMX on mocked statuses; after every
    step identities, output maps, firmwareTag, saved roles unchanged; fleet
    verdicts honest at every intermediate MIXED state.

`smokestack_cli_service.test.js`
17. Force actions spawn `to-dmx --names <id> --dry-run` / `to-swarm --names
    ss_left_right,<id> --dry-run`; public job hides paths; `cliNames` frozen.
18. Exactly-one-target rule: 0, 2, duplicate, unknown, IP ⇒ `bad_targets`.
19. Leader context: required for follower SWARM, forbidden for leader,
    only `ss_left_right` accepted.
20. Apply: phrase per controller; fingerprint missing / 63 chars / uppercase
    / wrong ⇒ refused; stale beyond 5 min ⇒ `dry_run_stale`; `cliNames`
    mismatch ⇒ refused; digest mismatch ⇒ `force_drift`; consumed dry-run
    reused ⇒ `dry_run_consumed`; fingerprint from request body ignored.
21. Leader-context dry-run without the exact `already in target mode` line ⇒
    `leaderContextUnsafe`, apply refused `force_leader_context`.
22. Apply args carry `--yes --rollback-on-failure --plan-fingerprint <fp>`
    and the same `--names`; emitted-fingerprint mismatch still flagged.

`smokestack_routes.test.js`
23. Stub CLI extended: honors `--names`, prints the `already in target mode`
    line for a leader present in `--names` on `to-swarm`, and **mimics the
    real CLI** (accepts a missing fingerprint on `--names` runs) so the BM
    layer is proven to be the one refusing — plus a "patched CLI" variant
    that refuses, to pin the companion-fix contract end to end.
24. Full force chain: readback → dry-run → typed `FORCE DMX ss_left_left` →
    apply → readback → banner `TARGET RECOVERED TO DMX — FLEET REMAINS MIXED`.
25. Force-swarm leader chain: stub prints `SAFE TO KILL NETWORK`; response
    banner never contains it.
26. Partial failure: stub exits 1 with rollback wording ⇒ `force_failed`,
    target row `restored`, fleet verdict `TARGET NOT VERIFIED`.
27. Failed readback after a verdict-OK apply ⇒ `FINAL READBACK FAILED`, no
    green.
28. Confirm-phrase parity model ↔ server for all 8 combos + the 3 fleet ones.

Then: `node --check` on every touched `.js/.cjs`, `node tools/scene_model_parity.cjs
titanic --strict` (no scene change expected; run anyway), and the full sim
suite only on an isolated stack per `.agent/ops/sim_auto_checks.md` — never
against the operator's live ports.

### B4. Service reload scope

- Server-side modules (`smokestack_cli_service.cjs`, `save-server.js`) load
  once per process: the **save server must be restarted** to pick them up.
  Per `.agent/ops/stack_lifecycle.md` that means a sanctioned **launcher
  bounce by the operator** — never a hand-kill of one child. The earlier
  "missing fingerprint" incident was this same class (stale in-memory
  module), so treat "module reloaded" as a checklist item, not an assumption:
  after the bounce, `GET /smokestack/provision` must answer and the panel's
  Advanced Recovery section must render.
- Browser ESM (`smokestack_mode.js`, `smokestack_panel.js`, `style.css`): a
  page reload of the sim after the bounce.
- Engine, sACN bridges, CaptainPad: untouched by this wave.
- Private CLI: no service; the next spawn uses the new code. Verify with a
  `--names <id> --yes` **without** a fingerprint against the **mock board
  harness only** (`deploy/tests/smokestack_mock.py`) — expect exit 2.

### B5. Selective integration from `f74e`

1. `git diff --no-index` MAIN vs `f74e` for
   `simulation/src/dmx/smokestack_mode.js` — confirm the only hunk is lines
   638-647; apply it by hand (with the amended reason string).
2. Same for `simulation/tests/smokestack_mode_model.test.js` — port the
   rewritten test at line 532 and the two new tests after it.
3. Do not copy anything else from `f74e` (its other modifications are a
   different, older snapshot of MAIN's dirty tree).
4. Run `node --test tests/smokestack_mode_model.test.js` → expect 58 (56 + the
   two new) before starting B1(b)+.

### B6. Physical operator test sheet (Sina, after B1+B2 land and the bounce)

0. Prereq readback: panel `🛰 Refresh` → expect `ALL SWARM (2 role/coherence
   failure(s) · …)` and `Recover all to DMX` enabled. Press it: the **dry-run
   must be REFUSED by the CLI on the asset contract** (A4). This proves the
   fleet gate is intact. Nothing written.
1. Advanced Recovery → select `ss_left_left` → FORCE TO DMX… → read the
   summary (saved follower, U30/U31@1, consequence `3 SWARM / 1 DMX`) →
   dry-run shows `WOULD POST /api/config` for that one board only and a
   64-char fingerprint → type `FORCE DMX ss_left_left` → APPLY (attended;
   expect a reboot, ≤ 2 min) → banner `TARGET RECOVERED TO DMX — FLEET
   REMAINS MIXED` only after the 4/4 readback; fleet chip `MIXED — 1 DMX / 3
   SWARM`; confirm identity, U30/U31, role unchanged.
2. Repeat for `ss_right_right` (phrase `FORCE DMX ss_right_right`).
3. Now the fleet toggle shows `Recover all to DMX` (mixed path). Use it if the
   canonical dry-run passes; if the asset contract still refuses (expected
   until the left pair + `ss_right_right` are re-released), continue with
   FORCE TO DMX for `ss_right_left` then `ss_left_right` (leader last).
4. End state: `ALL DMX`, every output map unchanged, the two lit Output 1
   strands accept the engine cue.
5. Do **not** attempt FORCE TO SWARM on the playa fleet until the
   registry-locked re-release of `ss_left_left`, `ss_left_right` and
   `ss_right_right` is done; exercise the SWARM force only on the bench/mock.
6. Five-cycle matrix and the `SAFE TO KILL NETWORK` acceptance remain the
   canonical fleet flow's job (report `_346` §sheet), after asset parity.

### B7. Remaining blockers that need Sina

- **Asset re-release** (registry-locked deploy script, USB, attended) for
  `ss_left_left`, `ss_left_right` **and now `ss_right_right`** — this is the
  only route back to a fleet-safe `to-swarm` and to `SAFE TO KILL NETWORK`.
  Until then FORCE TO DMX is the escape and the fleet stays DMX.
- **Private CLI companion fix** (B2) must land and be verified on the mock
  harness before the first force apply; BM alone cannot enforce the binding.
- **Launcher bounce** after B1 lands (B4), and provisioning
  (`BM26_SMOKESTACK_CLI`, `BM26_DEPLOY_REGISTRY`) exported in the launcher's
  environment — the status glance works without it; the force path does not.
- First force apply is operator-attended, watching the board.
- Ruling wanted: whether the single-board `to-swarm` kill-verdict wording
  should change in the CLI (B2 item 3d) or stay downgraded by BM only.

---

## Speed wave — fleet switch parallelised

Implemented (not just planned) in the **private MarsinLED deploy CLI**. The
goal was operator-set: a four-board fleet switch must take well under two
minutes, not five-plus. Nothing in BM26 changed; nothing was copied out of
the private repo.

### What changed

| File : function | Change |
|---|---|
| `lib/smokestack/runner.py` : `_apply_followers_parallel` (replaces `_apply_swarm_followers`) | Every non-canary board now runs **at once**, in three barriered phases — all mutation POSTs together, all reboot polling together, all verification together. Used by **both** `to-dmx` and `to-swarm`. The barrier between phases keeps a board from being verified while a sibling is still down. |
| `lib/smokestack/runner.py` : `_run_mode_impl` | Both follower branches call the new fan-out. The `to-dmx` branch's strictly-serial `apply_board` loop is gone (its own comment already said DMX has no leader/follower dependency). Canary-first gating, the follower freshness sweep, `skipped (canary failed)`, the journal entries, the fingerprint binding and whole-transaction rollback are all unchanged. |
| `lib/smokestack/runner.py` : `_terminal_swarm_verification` | New `rebooted_names` argument. The extra reboot-survival reboot of `followers[0]` is **skipped** when that board already rebooted during its own mutation and verified after coming back — same proof, already paid for. It still runs when the mutation live-applied without a reboot (or the board was already in target mode). One log line says which case applied. The coherence sweep, the committed-config sweep and the canonical 4/4 readback are untouched. |
| `lib/smokestack/runner.py` : `BoardResult`, `_finish_mutation_wait` | New `BoardResult.rebooted` flag, set only after a real down-and-back poll succeeded. That flag is what feeds `rebooted_names`. |
| `lib/smokestack/client.py` : `Timing.settle` | `5.0 → 2.0` s. Paid twice per board (uptime-monotonic sampling). |
| `smokestack_mode.py` : `--settle` | Default `5.0 → 2.0`; the flag stays, so the old value is one argument away. |
| `lib/smokestack/transaction.py` : `mark_mutated`, `mark_rollback` | Added a `threading.Lock`. Mutation POSTs now land from several threads; an unguarded append racing a `json.dump` of the same list loses journal entries, and the journal is all crash recovery has. |
| `SMOKESTACK_MODE.md` | Execution-order prose, the survival-canary bullet and the `--settle` default row rewritten to match. |

Deliberately **not** touched: `reboot_wait` (90 s cap), `poll_interval`, the
plan fingerprint logic, the refusal/coherence gates, and every other
`SAFE TO KILL NETWORK` criterion.

### Measured, on the mock harness

Test suite: **121 passed / 0 failed** (`test_smokestack_mode_runner`,
`_plan`, `_transaction`, `_mock`, `_identity_migration`,
`test_bm26_titanic_swarm_contract`) — 99 pre-existing plus 6 new, and the
16-test swarm contract file. New tests cover: `to-dmx` follower concurrency,
`to-swarm` follower concurrency, survival canary skipped when the follower
rebooted during its mutation, survival canary still run when it live-applied,
deterministic row order under scrambled completion order, and whole-fleet
rollback when a board fails inside the parallel phase.

Concurrency is asserted two ways: wall clock, and the spread between sibling
mutation-POST timestamps (serial cannot put two follower writes closer
together than one full reboot). Measured spread across three followers:
**0.015 s** (`to-dmx`) and **0.000 s** (`to-swarm`).

Four mock boards, production timing (`--pace` 0.5, poll 1.5 s,
`--reboot-wait` 90), simulated ESP32 reboot 9 s, each board really rewriting
`dmx.*` and really rebooting:

| Run | Before | After | Saved |
|---|---|---|---|
| `to-dmx`, 4 boards | 71.4 s | **30.3 s** | 41.1 s (2.36×) |
| `to-swarm`, 4 boards | 88.2 s | **35.3 s** | 52.9 s (2.50×) |

"Before" is the same binary with the serial follower ladder restored,
`--settle 5`, and the terminal reboot forced on — i.e. the old shape, not a
recollection of it.

### Estimated live fleet time

The four rope controllers reboot slower than the 9 s model and the canonical
run adds a final asset/parity readback sweep, so scale up but keep the shape:
the switch is now **canary + one overlapped follower batch** instead of four
sequential reboots, and `to-swarm` drops one whole extra reboot cycle on top.
Expect roughly **45–75 s** for a clean canonical switch, against the
~5 minutes observed before — comfortably inside the two-minute target, with
the 90 s per-board reboot cap untouched as the worst-case guard.

### Read-only live proof (nothing written)

Ran against the real fleet with the read path only:

- `status` — 4/4 `REACH YES`, `MACOK YES`, fw 1.2.5, all `SWARM-native`,
  fps 61–63. `ss_left_right` leader `active`; `ss_right_right` and
  `ss_right_left` `FOLLOWING`; **`ss_left_left` still `DETACHED`** —
  unchanged from the `_352` diagnosis, not introduced here.
- `to-dmx --dry-run` — full plan sweep, per-board refusal table and a 64-char
  fingerprint all render correctly. **3 of 4 boards still refuse on the
  canonical asset contract** (`activeMap` is the pushed map, model/pattern
  allowlist mismatch, activeMapHash + dataFingerprint parity) exactly as
  `_352` §B7 describes. Only `ss_right_left` would post.

So the read path is intact, and the canonical apply is still blocked by the
**asset re-release**, not by this wave.

### First timed live run — exact operator command

Only after the asset re-release makes the canonical dry-run pass. Two steps,
from the private deploy repo root, with `$BM26_DEPLOY_REGISTRY` and
`$BM26_SECRETS` exported:

```powershell
# 1. review the plan, copy the 64-char PLAN FINGERPRINT it prints
python deploy/smokestack_mode.py to-dmx --dry-run

# 2. the timed apply, bound to that exact plan
$t = Get-Date
python deploy/smokestack_mode.py to-dmx --yes --rollback-on-failure `
    --plan-fingerprint <paste-the-64-char-fingerprint>
"elapsed: {0:n1}s" -f ((Get-Date) - $t).TotalSeconds
```

Same two steps with `to-swarm` for the return leg; that one must end on
`VERDICT: SAFE TO KILL NETWORK`. Watch for the new line
`reboot-survival already proven … skipping the redundant terminal reboot` on
`to-swarm` — a DMX→SWARM switch rewrites `dmx.*`, so the follower always
reboots during its own mutation and that skip is the expected case. Attended,
watching the boards, as `_352` §B6 requires.
