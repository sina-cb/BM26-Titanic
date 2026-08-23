# 353 — Smokestack Advanced Recovery: implementation + validation

Implements report `_352` Part B end to end. Everything below is **built,
tested and proven**; no controller was written to, nothing was flashed, no
service was restarted, no git operation was run in either repo.

Controllers are named by `controllerId` only.

---

## 1. What landed, file by file

### 1.1 BM26-Titanic (working tree, branch `feat/bm_readiness` — uncommitted)

| File | Change |
|---|---|
| `simulation/src/dmx/smokestack_mode.js` | (a) the `f74e` toggle hunk, hand-integrated with the amended reason string; (b) `ports` added to the target shape; (c) the whole Advanced Recovery model |
| `simulation/src/gui/smokestack_panel.js` | the "Advanced Recovery — force ONE controller" section + force flow wiring |
| `simulation/server/smokestack_cli_service.cjs` | force actions, single-target allowlist, leader context, preflight digest, single-use dry-runs |
| `simulation/server/smokestack_status_service.cjs` | passes through the board's runtime `sacn.perOutput` (read-only) |
| `simulation/server/save-server.js` | four new refusal codes + `leaderContext` / `preflightDigest` passthrough |
| `simulation/style.css` | `.smk-recovery*` / `.smk-fingerprint` block, theme tokens only |
| `simulation/tests/smokestack_mode_model.test.js` | +17 tests (3 from `f74e`, 14 new) |
| `simulation/tests/smokestack_cli_service.test.js` | +10 tests |
| `simulation/tests/smokestack_routes.test.js` | +8 tests, stub CLI extended |
| `simulation/agent_tools/smokestack_capture.cjs` | stub CLI brought up to the fingerprint contract; new pass C captures Advanced Recovery |

**`smokestack_mode.js` — the hunks**

1. **Unblocking the recovery direction** (`smokestackFleetToggleModel`, the
   `swarm === boards.length && topologyFailures > 0` branch). Was
   `action: null` / "Live SWARM topology failed — cannot switch". Now:
   `ACTION_TO_DMX`, `Recover all to DMX`, `enabled: true`, reason
   `"<n> live SWARM role/coherence failure(s) — guarded exact-four DMX
   recovery only; the CLI's asset/identity contract still applies"` (the
   `_352 §A7` amendment — the toggle unblocks the DIRECTION, it does not
   promise the CLI will accept the plan). TO SWARM is never offered from
   this branch, and every `switchBlockers` term is still evaluated first.
   Copied **by content** from the `f74e` worktree; nothing else was taken
   from it and no worktree was synced or checked out.
2. `smokestackTargets` now returns a frozen `ports` array
   (`{output, strand, universe, startAddress, pixelCount}`) built from the
   already-validated scene card, so the panel can render the preserved
   output map without inventing an origin.
3. New exports: `ACTION_FORCE_TO_DMX`, `ACTION_FORCE_TO_SWARM`,
   `FORCE_ACTIONS`, `FORCE_DRY_RUN_FRESH_MS` (15 min — see below),
   `FORCE_READBACK_MAX_AGE_MS` (30 s), `TRUSTED_APPLY_OUTCOME_KINDS`,
   `TRUSTED_OUTCOME_KINDS`, `forceConfirmPhrase`, `preflightDigest`,
   `smokestackForceRecoveryModel`, `forceFleetVerdict`.
4. `applyGateModel(dryRunJob, action, typedPhrase, options)` — backward
   compatible; force actions additionally require the frozen `targetIds` to
   be exactly `[controllerId]`, the controller-specific phrase, the freshness
   window, and a matching preflight digest.
5. `jobOutcomeModel` — `force_dmx_ok` / `force_swarm_ok` / `force_failed`,
   all with `safeToKillNetwork: false` unconditionally. `force_swarm_ok`
   accepts the CLI's `VERDICT: SAFE TO KILL NETWORK` **and downgrades it in
   words** (`_352 §A8` bullet 1).
6. `smokestackControllerTransitionModel(..., options)` — force jobs render
   non-targets as `excluded · <mode>`; a leader carried as read-only context
   renders `context · no write expected`, then `context verified · unchanged`
   only when it is still SWARM **and** its `uptimeMs` did not go backwards.

**Advanced Recovery model contract** (`smokestackForceRecoveryModel`)

- Selection is the semantic `controllerId` **only** — an IP, a card name, a
  numeric scene id, whitespace, wrong case, or two ids all yield
  `unknown/ambiguous identity` and no target.
- Common refusals: unreachable; unknown mode; identity mismatch;
  `stagedPending`; non-primary `configSource`; missing `perOutputDmx`;
  `MODE_INVALID` (redirected to Repair); any sibling missing/unreachable/
  unknown in the sweep; a stale or in-flight readback; and a live-vs-scene
  sACN origin disagreement (`uncertain mapping`).
- FORCE DMX is eligible from DETACHED / stale / split-brain followers, an
  inactive leader, an already-MIXED fleet, and (idempotently) from DMX. The
  `bypasses` list names the rule stepped around; `consequence` computes the
  real post-run fleet split.
- FORCE SWARM bypasses nothing that matters: leader uniqueness, saved role
  authority (only `ss_left_right` may be leader), and a follower's need for
  a healthy fresh sole leader are all hard blockers. Its `stillRefuses` list
  states in plain words that the frozen-asset validation, the active
  map/pattern validation and the fleet verdict are **not** bypassed, and
  that only the canonical four-board flow can ever produce a kill verdict.
- A follower's SWARM force sets `leaderContextRequired` and
  `cliNames = ['ss_left_right', <target>]` (`_352 §A8` bullet 2 — the CLI
  needs exactly one leader in the target set). The leader's own force is
  `cliNames = ['ss_left_right']`.
- **Freshness window: 15 minutes, one constant shared with the fleet flow.**
  Operator ruling during this wave rejected a shorter force-only window as
  too restrictive in the field. `FORCE_DRY_RUN_FRESH_MS ===
  DRY_RUN_FRESH_MS`, pinned by a test across model and server. Nothing is
  weakened by this: staleness was only ever a coarse backstop, and the
  preflight digest below refuses on ANY state change between plan and apply
  regardless of the clock.
- `preflightDigest` = per board, in canonical order,
  `controllerId|mode|isLeader|followState|stagedPending|configSource|
  perOutputDmx|firmwareTag|reachable`, joined by `;`. Beacon age is
  deliberately excluded; `followState` is included.

**`smokestack_cli_service.cjs` — the gates**

- `force-to-dmx` / `force-to-swarm` added to `ACTIONS` + `MUTATING_ACTIONS`.
- `validateTargetIds` requires **exactly one** approved id for force actions
  (`force_target_required` for 0/2/duplicates, `bad_targets` for anything
  that is not one of the four).
- New `validateForceContext` freezes `cliNames`; `leaderContext` is required
  for a follower's SWARM force, forbidden for the leader's own, forbidden on
  the DMX path, forbidden on the fleet actions, and only `ss_left_right` is
  ever accepted.
- New `confirmPhraseFor(action, targetIds)` — `SWITCH` for the three fleet
  actions, `FORCE DMX <id>` / `FORCE SWARM <id>` for force. Exported and
  pinned against the model's `forceConfirmPhrase` for all 8 combos.
- Apply gate additions: `preflightDigest` must equal the dry-run's frozen
  one (`force_drift`); `cliNames` must match byte-for-byte
  (`force_leader_context`); force freshness is `forceDryRunFreshMs`
  (injectable, default `FORCE_DRY_RUN_FRESH_MS`); a dry-run is marked
  `consumed` the moment an apply is
  accepted against it and can never arm a second (`dry_run_consumed`). The
  fingerprint is **only ever** read from the stored dry-run — a request-body
  fingerprint is ignored.
- Leader-context no-write proof: when `cliNames.length === 2`, the dry-run's
  output must contain the CLI's exact line
  `<leader>: already in target mode - no mutation POST would be sent`.
  Anything else marks the job `leaderContextUnsafe` and fails the apply
  closed with `force_leader_context`.
- Args are the CLI's own `--names` selector and nothing else:
  `to-dmx --names <id> [--dry-run | --yes --rollback-on-failure
  --plan-fingerprint <fp>]`. No browser-to-controller write exists anywhere
  in this path.

**Panel** — a second `<details class="smk-recovery">` titled
"⚠ Advanced Recovery — force ONE controller", mounted between the flow
boundary and Advanced details, collapsed by default, its open state and
selection surviving repaints, disabled while any job runs or while
unprovisioned, and visibly distinct (its own error-toned frame). It renders,
from the model: target + target state + readback freshness; requested result;
CLI target names (naming the read-only leader when present); preserved role
and the preserved output map with the live sACN origins beside it; why the
normal action is blocked; what the force bypasses; what it still refuses;
the fleet consequence; the full 64-character plan fingerprint; the preflight
digest status (`matches` / `DRIFTED`); the typed-confirm row; the apply
result; and the post-readback `forceFleetVerdict` plus the remaining fleet
state. A force job's CLI verdict is **never** rendered as the trusted one —
the banner shows `Trusted verdict: NONE · CLI said …`.

### 1.2 MarsinLED (private, uncommitted, NOT pushed)

| File | Change |
|---|---|
| `deploy/lib/smokestack/runner.py` | `if canonical and expected_plan_fingerprint != …` → `if expected_plan_fingerprint != …` (+ a comment saying why). **Every** mutating run is now fingerprint-bound, `--names` subsets included. |
| `deploy/smokestack_mode.py` | `import re`; new `_PLAN_FINGERPRINT_RE`; every `--yes` run now requires a `^[0-9a-f]{64}$` `--plan-fingerprint` or exits **2** with `USAGE ERROR: apply requires the --plan-fingerprint printed by the immediately preceding dry-run`; `--plan-fingerprint` help text updated to "required for EVERY apply". |
| `deploy/SMOKESTACK_MODE.md` | documents that every apply is fingerprint-bound and that a `--names` subset skips the canonical asset contract, so it is **not** fleet-safe and never earns a fleet verdict. |
| `deploy/tests/test_smokestack_mode_runner.py` | new `plan_fingerprint_for` / `run_cli_apply` two-step helper; all **13** `--yes` call sites now walk the real operator two-step. The `drop_after` mid-run-loss test arms its drop *after* the helper's dry-run so the loss still lands mid-APPLY. |
| `deploy/tests/test_smokestack_mode_plan.py` | same helper; the **3** `--yes` call sites converted; **3 new tests**: `--names` apply with no fingerprint ⇒ exit 2 + zero mutation; with a wrong 64-hex fingerprint ⇒ `REFUSED PLAN FINGERPRINT` + zero mutation; with the dry-run's own fingerprint ⇒ proceeds, and the unnamed board is untouched (GET-only). |

Nothing from the private CLI — internals, registry, MACs, secrets — was
copied into BM26-Titanic. The `_352 §B2` item 3d question (whether a
non-canonical `to-swarm` should stop printing the fleet kill verdict) was
**left alone** pending Sina's ruling; BM downgrades it instead (see §5).

---

## 2. Test numbers

**BM26-Titanic** (`node --test`, working tree only, no stack port touched):

| Suite | Before | After |
|---|---|---|
| `smokestack_mode_model.test.js` | 54 | **71** |
| `smokestack_cli_service.test.js` | 26 | **36** |
| `smokestack_status_service.test.js` | 8 | **8** |
| `smokestack_routes.test.js` | 12 | **20** |
| **total** | 100 | **135 / 135 pass** |

Adjacent sim suites that touch the same files, all green:
`controller_pane_ergonomics`, `controllers_pane_toggle`, `theme_parity`,
`led_metadata`, `per_output_push`, `chained_led_patches`,
`subscribed_universes` — **191 / 191**.

`node --check` clean on `smokestack_mode.js`, `smokestack_panel.js`,
`smokestack_cli_service.cjs`, `smokestack_status_service.cjs`,
`save-server.js`, `smokestack_capture.cjs`.
`node tools/scene_model_parity.cjs titanic --strict` → **PASS**, 0 errors.

The full sim suite was **not** run (`npm run check` is gated — it would bind
the operator's live ports).

**MarsinLED** (`python -m pytest`, run from the repo root as required):

- `deploy/tests/test_smokestack_mode_plan.py` + `test_smokestack_mode_runner.py`
  → **46 / 46 pass** (43 + 3 new).
- Full `deploy/tests` → **1148 passed, 7 skipped, 4 failed**. All four
  failures are **pre-existing and unrelated** — `test_data_pack.py::
  test_only_the_bike_fleet_packs_the_bike_and_titanic_families` (bike-fleet
  boot pattern) and three `test_swarm_yaml.py::TestSurgicalEdit` cases
  (grouped-swarm YAML leaders). Neither file imports the smokestack module,
  and both fail on data unrelated to this change.

---

## 3. Live proof (read-only, real boards)

All three runs below are `--dry-run`, which never sends a POST and never
acquires the transaction lock.

**Fleet census** — note the fleet has partly self-corrected since `_352`:
`ss_right_right` has re-attached, so there is now **one** topology failure,
not two.

```
BOARD            REACH MACOK FW     MODE          ROLE      COHERENCE  FPS CFGSRC   STAGED
ss_left_left     YES   YES   1.2.5  SWARM-native  follower  DETACHED   62  primary  False
ss_left_right    YES   YES   1.2.5  SWARM-native  leader    active     62  primary  False
ss_right_right   YES   YES   1.2.5  SWARM-native  follower  FOLLOWING  62  primary  False
ss_right_left    YES   YES   1.2.5  SWARM-native  follower  FOLLOWING  62  primary  False
```

**The escape hatch now produces a plan** — `to-dmx --names ss_left_left
--dry-run`, the run that used to be unreachable behind the BM toggle's
coherence refusal:

```
dry-run: read-only plan sweep across all boards
  [ss_left_left] pre-flight OK

=== smokestack to-dmx ===
ss_left_left   PLAN   SWARM->DMX   ss_left_left: WOULD POST /api/config
                                   verification ladder that WOULD run: reachable,
                                   MAC unchanged, mode flipped, config committed,
                                   uptime monotonic

VERDICT: DRY RUN - no changes made
PLAN FINGERPRINT: 7a0f4e8eed28195056352c05aa667e051cd20d8754ceabb7b3a1530069b6a0ab
```

**The fleet contract is untouched** — the canonical four-board
`to-dmx --dry-run` still refuses three of four boards on assets, exactly as
`_352 §A4` predicted:

```
ss_left_left    WOULD REFUSE: activeMap is '/models/pushed_map.json',
                              expected '/models/swarm_titanic_rop_b5fc8e9e.json'
                WOULD REFUSE: model allowlist mismatch (22 files vs the frozen 4)
                WOULD REFUSE: pattern allowlist mismatch (18 files vs the frozen 2)
                WOULD REFUSE: compiled pattern manifest/allowlist not ready
                WOULD REFUSE: canonical fleet activeMapHash parity failed
                WOULD REFUSE: canonical fleet dataFingerprint parity failed
ss_left_right   WOULD REFUSE: activeMap / model+pattern allowlist / manifest
ss_right_right  WOULD REFUSE: activeMap / model allowlist (pushed_map.json residue)
ss_right_left   PLAN — WOULD POST /api/config
VERDICT: DRY RUN - no changes made
```

**The leader-context wording matches BM's gate byte-for-byte** —
`to-swarm --names ss_left_right,ss_left_left --dry-run`:

```
ss_left_right  PLAN  SWARM->SWARM  ss_left_right: already in target mode - no mutation POST would be sent
ss_left_left   PLAN  SWARM->SWARM  ss_left_left: already in target mode - no mutation POST would be sent
VERDICT: DRY RUN - no changes made
```

### 3.1 Panel evidence (live fleet, stub CLI)

`simulation/agent_tools/smokestack_capture.cjs` reads the operator's live
`:6969` page **read-only** and repoints that page's save endpoint at
throwaway save-servers on random high ports with a node stub CLI, so every
mutating click in the capture hits the stub and never a board. Output in
`.agent_renders/`:

| Shot | What it proves |
|---|---|
| `smokestack_6_recovery_1787460896.png` | Advanced Recovery populated from the LIVE readback: `SWARM · follower (DETACHED) · beacon 1861 ms ago`, freshness `0.0 s`, preserved role `saved follower`, preserved map `O1 U30@1 40 px · live U30@1` / `O2 U31@1 40 px · live U31@1` **verified against the board's live sACN origins**, bypass list, still-refuses list |
| `smokestack_7_force_dryrun_1787460902.png` | the one-controller force plan + fingerprint |
| `smokestack_8_force_armed_1787460907.png` | consequence `fleet becomes MIXED — 1 DMX / 3 SWARM`, the full 64-char fingerprint, `Preflight digest: matches`, typed `FORCE DMX ss_left_left`, APPLY armed |
| `smokestack_9_force_verdict_1787460921.png` | the honesty contract working: the stub CLI said `VERDICT: OK`, the independent four-controller readback said the board is still SWARM, and BM printed **`TARGET NOT VERIFIED — ss_left_left reads SWARM, expected DMX`** with `Trusted verdict: NONE · CLI said VERDICT: OK` |
| `smokestack_1_unprovisioned_…` / `2_status` / `3_dryrun` / `4_armed` / `5_verdict` | the pre-existing fleet flow, still green, now with the fleet toggle offering `Recover all to DMX` on the unhealthy uniform-SWARM fleet |

The stub-CLI end-to-end chain (dry-run → fingerprint → typed confirm →
apply → readback → honest verdict) is additionally pinned in
`smokestack_routes.test.js`, which spawns **real** save-server processes on
random high ports.

Note: the capture opens a second sim window, so the sim showed its
"2 sim windows connected" contention banner during pass B/C. The window was
closed at the end of the run.

---

## 4. Service reload scope

- **Save server must be restarted by the operator** — `save-server.js` and
  `smokestack_cli_service.cjs` / `smokestack_status_service.cjs` load once
  per process. Per `.agent/ops/stack_lifecycle.md` that is a sanctioned
  **launcher bounce**, never a hand-kill of one child. Treat "module
  reloaded" as a checklist item, not an assumption (the earlier
  missing-fingerprint incident was exactly this class): after the bounce,
  `GET /smokestack/provision` must answer and the panel must show the
  Advanced Recovery section.
- **Browser ESM** (`smokestack_mode.js`, `smokestack_panel.js`,
  `style.css`): a page reload of the sim after the bounce.
- **Engine, sACN bridges, CaptainPad**: untouched by this wave.
- **Private CLI**: no service — the next spawn uses the new code. Already
  verified against the mock harness by the three new pytest cases (a
  `--names` apply with no fingerprint exits 2 with zero POSTs).

I restarted nothing. The operator's stack ran throughout on 6966–6972 and
was only ever read.

---

## 5. Physical operator test sheet (Sina — first FORCE DMX live, attended)

Prereqs: launcher bounce done, sim page reloaded,
`BM26_SMOKESTACK_CLI` + `BM26_DEPLOY_REGISTRY` exported in the launcher's
environment.

0. **Prove the fleet gate is intact.** Panel → `🛰 Refresh`. Expect
   `ALL SWARM (1 role/coherence failure(s) · …)` and the toggle enabled as
   `Recover all to DMX`. Press it. The **dry-run must be REFUSED by the CLI
   on the asset contract** (three boards, `activeMap` / allowlist /
   manifest / parity). Nothing is written. Dismiss.
1. Open **Advanced Recovery**. Select `ss_left_left`. Read the card before
   touching anything: saved follower, `O1 U30@1 40 px` / `O2 U31@1 40 px`
   with the live origins agreeing, consequence `fleet becomes MIXED —
   1 DMX / 3 SWARM`, and the "what it still refuses" list.
2. Press **FORCE TO DMX…**. The dry-run must show `WOULD POST /api/config`
   for that ONE board and a 64-character fingerprint, and the preflight
   digest must say `matches`. (You have 15 minutes to arm the apply — but if
   the fleet changes in the meantime the digest flips to `DRIFTED` and the
   APPLY refuses, which is the guard that actually matters.)
3. Type exactly `FORCE DMX ss_left_left`. APPLY arms only then.
4. **APPLY — attended, watching the board.** Expect a reboot; allow up to
   ~2 minutes. Do not touch the panel while it runs.
5. Wait for the 4/4 readback. Expect the banner
   `TARGET RECOVERED TO DMX — FLEET REMAINS MIXED` and the fleet chip
   `MIXED — 1 DMX / 3 SWARM`. Confirm on the board's own row: identity
   unchanged, U30/U31 @ 1 unchanged, saved role unchanged.
   Any other banner ⇒ stop and read it; the CLI rolls back on a failed
   verify and the panel will say `restored`.
6. If more boards must follow, repeat per controller (`FORCE DMX
   ss_right_right`, etc.). Leader **last**.
7. Once the fleet is mixed, the ordinary toggle offers `Recover all to DMX`
   again — use it if the canonical dry-run passes; if the asset contract
   still refuses, keep using FORCE TO DMX one board at a time.
8. **Do NOT attempt FORCE TO SWARM on the playa fleet** until the
   registry-locked re-release of `ss_left_left`, `ss_left_right` and
   `ss_right_right` is done. Exercise the SWARM force on the bench/mock
   only. A one-controller SWARM force never means the network is safe to
   disconnect — the panel says so, and it is telling the truth.

---

## 6. Remaining blockers

- **Asset re-release** (registry-locked deploy script, USB, attended) for
  `ss_left_left`, `ss_left_right` and `ss_right_right`. This is still the
  only route back to a fleet-safe `to-swarm` and to `SAFE TO KILL NETWORK`.
  Until then FORCE TO DMX is the escape and the fleet stays DMX.
- **Launcher bounce** (§4) before any of this is reachable from the panel.
- **Both repos are uncommitted.** The private CLI change is deliberately
  left uncommitted and unpushed, as instructed. The BM change rides on top
  of the already-uncommitted `_344`/`_346` smokestack work on
  `feat/bm_readiness`.
- **First force apply is operator-attended.**
- **Ruling still wanted** (`_352 §B7`): should a non-canonical `to-swarm`
  stop printing `SAFE TO KILL NETWORK` in the CLI itself, or continue to be
  downgraded by BM only? Left as-is; BM's downgrade is implemented, tested
  and proven, and the CLI doc now warns that a `--names` run is not
  fleet-safe.
- `_352`'s label nit is still open: a DETACHED follower with a fresh beacon
  still reads `live follower stale` in the readiness chip. Cosmetic, and
  the Advanced Recovery card shows the real `follow DETACHED` state beside
  the beacon age, so it is not misleading in the flow that matters.
