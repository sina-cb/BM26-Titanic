# 362 — Smokestack switch removal + forced-push hardening plan

Fable planning output. **Nothing implemented, nothing run, no code changed.**
An Opus agent implements from this plan verbatim; a second Opus agent
validates against it. Builds on `_352`/`_353`/`_354`/`_355` (what the switch
feature is) and docs/41 (the push contract). Controllers are named by
`controllerId`; IPs appear as last octet only.

**Operator request (verbatim intent):**

1. Remove the whole DMX ⇄ SWARM switch surface from the sim — the operator
   will do the swarm/DMX switching himself from the MarsinLED controller web
   UIs.
2. Make ⬆ Push to controller and ⬆ Push all reliable.
3. A push must leave the target controller **DMX-driven** (sACN input
   enabled), even if the operator had left it in SWARM mode.
4. Clarification, pinning the semantics: *"push to controller must be very
   simple, and force the new config on the controller → set the controller's
   strands, and dmx outputs based on the controller settings in the
   simulation controller panel."* The sim panel is the **single source of
   truth**; a push is a one-way full overwrite — no merging of board-local
   state, no partial-push variants, no modes.

Ruling supersession to be aware of (named again in §6 Risks): the pinned
semantics supersede two earlier operator rulings that are load-bearing in the
current code — *"the push never writes `enabled: false`"* (parking,
report `20260725_70`) and *"count on an already-enabled output is never
rewritten"*. Under force semantics both fall: unmapped outputs are
**disabled** and counts are **forced** from the sim's mapping.

---

## 1. Slice S1 — Remove the switch feature (exact inventory)

### 1.1 Files deleted outright

| File | Why it goes whole |
|---|---|
| `simulation/src/gui/smokestack_panel.js` | the switch card UI; only consumer is the mount in `controller_map_editor.js` (§1.2) |
| `simulation/src/dmx/smokestack_mode.js` | the pure switch model. **Consumer sweep result (verified this session):** imported ONLY by `smokestack_panel.js` and the four smokestack test files. No renderer, sACN-classification, or other module imports it — nothing survives, nothing moves. |
| `simulation/server/smokestack_status_service.cjs` | the read-only DMX⇄swarm glance sweep; required only by `save-server.js` (§1.2) and its own test |
| `simulation/server/smokestack_cli_service.cjs` | the private-CLI job runner + gates; required only by `save-server.js` and two test files |
| `simulation/agent_tools/smokestack_capture.cjs` | belongs to the switch feature (built in `_353`/`_355` purely to screenshot/drive the switch card; nothing else references it — verified by grep) |
| `simulation/tests/smokestack_mode_model.test.js` | feature tests (dies with the model) |
| `simulation/tests/smokestack_cli_service.test.js` | feature tests |
| `simulation/tests/smokestack_status_service.test.js` | feature tests |
| `simulation/tests/smokestack_routes.test.js` | feature tests (spawns throwaway save-servers against the routes removed in §1.2) |

Note: several of these carry uncommitted working-tree edits from the `_355`
wave. Deleting the files supersedes those edits; that is expected and is not
a git operation. The implementer runs **no** git commands; the operator
commits.

### 1.2 Surgical edits

**`simulation/server/save-server.js`**

- Delete the two requires (currently lines 17–18):
  `const smokestackStatus = require('./smokestack_status_service.cjs');` and
  `const smokestackCli = require('./smokestack_cli_service.cjs');`
- Delete four route branches, whole `else if` blocks (current line spans):
  - `GET /smokestack/provision` (≈1071–1075)
  - `POST /smokestack/status` (≈1076–1133)
  - `POST /smokestack/run` (≈1134–1191) — including the `statusByCode` map
  - `GET /smokestack/job` (≈1192–1202)
- Keep `PROBE_MAX_BODY_BYTES` and the `/controllers/probe` route — they are
  the controller pane's own prober, not the switch feature.

**`simulation/src/gui/controller_map_editor.js`**

- Delete the import (currently line 81):
  `import { renderSmokestackSection } from './smokestack_panel.js';`
- Delete the mount block (currently lines 1041–1045): the comment plus
  `const smokestackSection = renderSmokestackSection(reg); if (smokestackSection) main.appendChild(smokestackSection);`

**`simulation/style.css`**

- Delete every rule whose selector contains `.smk-` (≈193 occurrences; two
  main regions today, starting near lines 3721 and 4755, plus the `_355`
  additions — timeline, verdict chips, board-table stack, re-release row).
  Delete whole rules including their comments, never just declarations.

### 1.3 What is deliberately NOT touched by S1

- **Scene YAML** (`scenes/titanic/*`, `scenes/studiodj/*`,
  `scenes/test_bench/*`): "smokestack"/"SmokeStacks" there are fixture,
  view, and controller-card names — scene geometry, not the switch feature.
  The four rope controller cards (`ss_left_left` .61, `ss_left_right` .62,
  `ss_right_right` .65, `ss_right_left` .66) stay: they are ordinary
  MarsinLED LED cards and are exactly what the hardened push targets.
- Comment-only mentions of the smokestack ropes in
  `tests/engine_bridge_contract.test.js` and `src/core/analytic_light_gate.js`.
- The **private MarsinLED deploy CLI** and its `re-release` subcommand —
  the operator's own manual workflow. The env vars (`BM26_SMOKESTACK_CLI`,
  `BM26_DEPLOY_REGISTRY`) simply become unreferenced by the sim.
- `.agent/plans/` and `.agent/reports/` history — never rewritten.

### 1.4 S1 gates (the "no stubs, no orphans" proof)

1. `grep -ri smokestack simulation/src simulation/server simulation/tests simulation/agent_tools simulation/style.css`
   → matches ONLY the two comment mentions in §1.3 (or zero if the
   implementer chooses to reword them; optional).
2. `grep -r "smk-" simulation/` → **zero** matches.
3. `node --check` on `save-server.js` and `controller_map_editor.js`.
4. Targeted suites green: `controllers_pane_toggle`, `controller_pane_ergonomics`,
   `theme_parity` (these referenced the pane around the removed card).
5. Browser smoke after a launcher bounce + page reload: controller pane
   renders with **no** smokestack card, no console errors,
   `GET /smokestack/provision` now answers **404**.

Rollback note: S1 is pure deletion of a self-contained feature; to back out,
the operator restores the deleted files from git history (operator decision,
not the implementer's).

---

## 2. The forced-push contract (design for S2–S4)

### 2.1 The payload — one body, built once, shown verbatim, POSTed verbatim

Per push target, ONE `POST /api/config` body:

```json
{
  "strands":    [ /* the FULL array, one entry per physical board output */ ],
  "dmx":        { "enabled": true, "protocol": 0, "timeoutMs": 3000 },
  "swarm":      { /* board's saved swarm object */ "enabled": false },
  "deviceName": "<card name — ONLY when the stored name is invalid (unchanged §4.1.1 repair)>"
}
```

`strands[i]` (i = 0-based output index), from the sim panel + one config
read:

- **Hardware-truth fields copied from the board's own `GET /api/config`**:
  `type`, `pinData`, `pinClock`, `colorOrder`, `rgbwMode`,
  `deadPixels`/`deadPixelIndices` if present. docs/41 §4.1(a) forbids
  inventing pins (angio4 pins are locked); the sim does not model these
  fields, so this copy is the ONLY board-read that survives — it is not
  "merging board tweaks", it is refusing to invent hardware identity.
- **Sim-forced fields** (the panel is the source of truth):
  - a card port with ≥1 mapped pixel drives output i →
    `enabled: true`, `count: <the port's mapped pixel count>` (**forced,
    both directions** — the old "count is hardware truth" belief is
    dropped; the confirm dialog lists every count change),
    `dmxUniverse: <port.universe>`, `dmxStartAddress: 1`.
  - no card port drives output i (or the port maps 0 px) →
    `enabled: false`; `dmxUniverse`/`dmxStartAddress` are NOT written on it.

`dmx` block: exactly docs/41 §4.1(b) — sACN (`protocol: 0`),
`timeoutMs: 3000`. This is requirement 3: **every push switches the board
to DMX-driven**, idempotently (a board already in DMX re-asserts it).

`swarm` block: `{ ...snapshot.swarm, enabled: false }` — the board's own
saved swarm object with only `enabled` flipped, so `isLeader`/`role`,
`groupId`, and every other saved swarm field survive byte-for-byte and the
operator can still hand-switch the board back to SWARM from its web UI.
When the snapshot carries **no** `swarm` key (non-swarm firmware), the key
is omitted entirely — never invented. Sending the full merged object (not a
bare `{enabled:false}`) sidesteps any firmware ambiguity about partial
nested-object merges. See **Q1** below.

**Q1 — open question for the operator (with best-evidence recommendation).**
Is writing `swarm.enabled: false` on push approved?
Evidence that `dmx.enabled: true` alone is NOT proven sufficient:
(a) the private CLI's own `build_to_dmx_body` writes `dmx.enabled=true`
**and** `swarm.enabled=false` (report `_352` §A2) — that is the contract's
own definition of "DMX-driven"; (b) the retired BM mode model classified
`dmx.enabled && swarm.enabled` as **INVALID dual mode — "outputs cannot be
classified as DMX"**. Recommendation: **yes, write it**, exactly as above.
The plan proceeds on that recommendation; if the operator overrules, the
`swarm` key is dropped from `buildForcedConfigBody` and its verify line —
a one-function change. Divergence accepted either way: the CLI also wrote
`wifi.apEnabled=false`; the sim will NOT (wifi writes are staged behind the
anti-brick confirm handshake and stay on the denied list) — the board's AP
stays up after a push, which is cosmetic, not output ownership.

`DENIED_PUSH_KEYS` stays as-is for the generic `pushConfig` path
(`swarm` remains denied there). The forced push builds its body internally
and posts through `postConfigBody`, with a comment block declaring the
`dmx`/`swarm` exception exactly the way the `deviceName` repair exception
is declared today.

### 2.2 New/changed functions (names are binding for the implementer)

**`simulation/src/dmx/led/marsinled_client.js`**

- **Delete** `assertMappingPushAllowed` (lines ≈622–634). It refuses pushes
  to DMX-active/DMX-configured boards — the exact opposite of the new
  contract — and, left in place at the verify step, would fail **every**
  successful push the moment the push starts enabling DMX.
- **Replace** `applyPerOutputPlan` with `applyForcedPlan(strands, plan)`
  (same file, same test home): returns the full forced strands array of
  §2.1 — copies hardware fields per entry, forces
  `enabled`/`count`/`dmxUniverse`/`dmxStartAddress` per the plan, disables
  every output the plan does not assign. No `enables`-only asymmetry, no
  untouched pass-through of enabled-but-unmapped outputs.
- **New** `buildForcedConfigBody({ snapshot, plan })` — PURE. Produces the
  §2.1 body: `applyForcedPlan` + `validatePerOutputPlan` on the applied
  array + the frozen `dmx` block + the `swarm` block rule + the
  `deviceNameRepairForPush` decision. Throws loudly on any violation.
  Export the dmx block as
  `export const FORCED_DMX_BLOCK = Object.freeze({ enabled: true, protocol: 0, timeoutMs: 3000 });`
  so tests pin it by identity, not by copy.
- **Replace** `pushPerOutputUniverses` with
  `pushForcedConfig(ip, body, { writeTimeoutMs })` — transport only:
  validates nothing beyond `body && body.strands` (the builder validated),
  does **no internal GET** (closes the read-twice drift window, §2.3-3),
  POSTs via `postConfigBody` with `PER_OUTPUT_WRITE_TIMEOUT_MS` default,
  and keeps the exact `writeResponseLost` semantics (an unanswered write is
  ambiguous; an answered non-2xx is definite). The old flat-timeout refusal
  is moot (single phase) and is dropped with the old function.
- **New** `diffForcedConfig(verifyConfig, verifyStatus, body)` — PURE, the
  full-array verifier (§2.4). Replaces `diffPerOutput`'s plan-only scope.
- Keep unchanged: `probeDevice`, `scanSubnet`, `getStatus`, `getConfig`,
  `postConfigBody`, `rebootDevice`, `awaitReboot`, `validatePushPayload`,
  `pushConfig` (legacy generic path, still swarm/wifi-denied),
  `deviceNameRepairForPush`, `validatePerOutputPlan`,
  `deviceSupportsPerOutput`, `readPerOutput`, `readConfiguredPerOutput`,
  and every timing constant (probe 6500 ms, HTTP 8000 ms, write 12000 ms,
  reboot wait 45000 ms / poll 1000 ms — all measured on the live rig; do
  not retune).

**`simulation/src/dmx/led/device_config_mapper.js`**

- `derivePerOutputPlan` keeps its name and callers but changes contract:
  - **Pass 2 (parking) is deleted** along with `parkedUniverseIsValid`,
    `allocateParkedUniverse`, `parkWindowText`, and the `parked` key of the
    result. Deleting the key (not emptying it) makes any stale consumer
    crash loudly.
  - Result shape becomes `{ controllerName, universeByOutputIndex
    (assigned outputs only), assignments, disables, countChanges, warnings,
    sharedUniverses, collisions }`, where
    `disables = [{outputIndex, deviceCount, deviceUniverse}]` names every
    output that is enabled on the board today but will be written
    `enabled:false`, and
    `countChanges = [{outputIndex, from, to}]` names every already-enabled
    output whose `count` the push will rewrite (replaces the old
    "count NOT changed" warning).
  - `enables`/`enableOutputIndices` are dropped (every assigned output is
    force-written; the enable/disable story is told by `disables` and the
    assignments themselves).
  - Kept: the duplicate-output and out-of-range collisions, the
    invalid-universe repair, the shared-address warning path, and the
    `no_enabled_output` refusal (a card mapping nothing still refuses —
    the firmware requires ≥1 enabled strand, and an all-dark force would
    earn a device 400).
- `collectClaimedUniverses`: stop counting `parkedOutputs` (other cards'
  declared port universes remain claims).

### 2.3 Failure modes in the current flows (read from the code) → hardening

| # | Current defect | Hardening |
|---|---|---|
| 1 | **Verify self-block**: `pushPerOutputVerifyRecord` re-runs `assertMappingPushAllowed` on the post-reboot readback (`led_discovery_panel.js` ≈1423). Once a push enables DMX, every successful push would fail its own verify. | Gate deleted everywhere (call sites ≈1235, ≈1423, ≈2028 and the client function itself). |
| 2 | **Mode-refusal gate**: single push and push-all refuse any board that is DMX-active or DMX-configured, pointing at the now-removed "guarded Smokestack workflow". | Deleted. A push targets any reachable per-output MarsinLED in any mode — that is the feature. |
| 3 | **Read-twice drift window**: the plan derives from snapshot A (`getConfig` in `startPush`), then `pushPerOutputUniverses` internally GETs config B and applies the plan to B's strands. Between A and B the board can change (reboot, another client). | One read per push attempt: the body is built from the SAME snapshot the plan derived from (`buildForcedConfigBody`), and the transport does no GET. |
| 4 | **Partial verify**: `diffPerOutput` asserts only plan-covered outputs; disabled outputs, `dmx.*` and `swarm.*` are never checked, so a board that ignored half the write could read back green. | `diffForcedConfig` asserts the FULL contract (§2.4). |
| 5 | **Obsolete deferred check**: the `reply.outcome === 'deferred' || reply.suppressedBy === 'dmx'` branch tells the operator to use the removed workflow. | Replaced: any reply outcome other than `applied` / `needs-reboot` is a hard failure quoting the device's outcome verbatim. |
| 6 | **Push-all progress opacity**: one status line for the whole fleet; a controller mid-reboot is indistinguishable from a hang (worst case ≈65 s per board). | Per-controller live progress: `onStatus` is threaded into the push-all loop (it currently passes `null`) and the dialog renders one line per controller — `name · phase` while running, then its final chip. |
| 7 | **Partial-failure reporting**: push-all failures are compressed into one summary sentence. | A per-controller results table in the dialog via a PURE `pushAllResultsModel(results)` → `[{name, ip, state: PUSHED/FAILED/SKIPPED, reason?, responseLost?}]`, plus the existing summary line. Failures stay red; the completion (save/notify/route-confirm) line renders beneath, unchanged in structure. |
| 8 | **Retry policy** | **None. Fail loud** (house rule). The single sanctioned ambiguity-resolution survives unchanged: a LOST write reply → `awaitReboot` → read-back arbitration (`writeResponseLost`). No silent retries, no auto-repush of failed controllers; the operator re-pushes after reading the reason. |
| 9 | **Sync chip can disagree with the push**: `computeSyncState` compares mapping only; a board in SWARM with a perfect mapping reads `● In sync` even though a push would rewrite its mode. | `computeSyncState` additionally reports `drift` when `snapshot.dmx.enabled !== true` or `snapshot.swarm?.enabled === true` (detail: `board is not DMX-driven — push will force DMX`), and compares the full forced array (a to-be-disabled output reads as drift `enabled · U27 → disabled` via the extended `perOutputChanges`). |
| 10 | **Timeout budgets** | Keep the measured values (§2.2). The three-phase structure (write → reboot wait → verify) and the G8 liveness guard (`controllerIsLive`) survive verbatim. |
| 11 | **Completion chain** | `persistAndNotifyAfterPush` (save → notify → bridge route read-back, chained, never timer-based, never throws, refuses unmeasured ✓) is already fail-loud — unchanged except `parkedAbsent` (§2.5). Push-all keeps ONE completion after the last controller. |

### 2.4 The full verify (`diffForcedConfig`) — pass criteria per controller

After the reboot wait, `getStatus` + `getConfig`, then assert:

1. **Every** output index of the pushed `strands` array:
   `enabled` equals the body's; on enabled outputs `count`, `dmxUniverse`,
   `dmxStartAddress === 1` equal the body's; on disabled outputs
   `enabled === false`.
2. Saved mode: `config.dmx.enabled === true`, `config.dmx.protocol === 0`;
   and (per Q1) `config.swarm.enabled === false` when the body carried the
   key.
3. Runtime: `status.sacn.enabled === true` — the receiver is actually
   listening (the smokestack work proved saved-vs-runtime can diverge).
   If the firmware reports `dmxOwnsOutput`, assert it `=== true`; if the
   field is absent, it is not asserted (never invent agreement).
4. Identity: `status.controllerId` unchanged versus the pre-push snapshot
   (bind-by-controllerId, docs/41 §2) — the existing two-cards-one-board
   refusal stays.

Every mismatch is reported verbatim in one thrown error
(`err.perOutputMismatch` keeps its name so the caller's drift rendering
survives). Provenance: `recordDevicePush` now hashes the FULL body
(`sha256Hex(JSON.stringify(body))`) into `configHash`.

### 2.5 Parking removal (forced consequence — full inventory)

With unmapped outputs force-disabled, "an enabled output nobody routes to"
can no longer exist after a push, so parking has no referent. Remove it
end-to-end; no dead code, no dormant branches:

| File | Change |
|---|---|
| `src/dmx/led/device_config_mapper.js` | §2.2 — pass 2, helpers, `parked` key gone; claims no longer include parks |
| `src/dmx/controller_registry.js` | delete the `parkedOutputs` normalize/validate block (≈631–672) and replace with a **drop-with-log migration** (`console.log` once per card: `parkedOutputs is retired — dropped; unmapped outputs are now disabled on push`), matching the established MAC-migration precedent; delete the parked contribution to the universe high-water mark (≈694) and the `delete controller.parkedOutputs` at ≈849; delete `parkedUniverseFor` / `setParkedUniverse` / `clearParkedUniverse` (≈1376–1412) |
| scene data | remove the `parkedOutputs:` blocks from `scenes/test_bench/controllers.yaml` (≈line 87) and `scenes/titanic_interior/controllers.yaml` (≈lines 34, 67) — the loader migration covers any copy that survives elsewhere |
| `src/gui/led_discovery_panel.js` | delete the sticky-park persistence hunk inside the post-verify `ctx.mutate` (≈1464–1479, `setParkedUniverse`/`clearParkedUniverse`/`noteUniverseUsed` calls); delete the "Parked outputs" confirm-dialog section (≈1826–1837); replace the "ENABLE (it never disables anything)" section with the **DISABLES** section (list `plan.disables`, red-toned) and a **COUNT CHANGES** list (`plan.countChanges`); drop the now-unused registry imports; update `outputSelectorOptions` labels (`disabled (push will enable it)` → the force phrasing; an enabled-but-unmapped output labels `enabled — push will DISABLE it`) |
| `src/gui/controller_map_editor.js` | `Board outputs:` line (≈1717–1748) re-worded to the force truth (`1←P1(U21) · 2←P2(U22) · 3 will be DISABLED by push · 4 disabled`); delete the `↻ re-park` button (≈1750–1763); delete the park-clearing hunk in the output-selector change handler (≈1866–1870); drop the `parkedUniverseFor` import (line 52) |
| `src/dmx/subscribed_universes.js` | delete the parked-outputs contribution (≈178–190) — the sim no longer subscribes for universes that no longer exist as claims |
| `src/dmx/address_merge.js` | delete the `led_parked_output_conflict` finding (≈405, ≈479–487) |
| `src/dmx/led/bridge_route_confirm.js` | delete the `parkedAbsent` machinery (expectation building ≈128–149, assessment ≈209–237, describe lines). `buildRouteExpectation` keeps its empty-expectation refusal (`no_enabled_output` upstream makes a truly empty push impossible). The route read-back still proves every expected `(universe → controller IP)` pair present |
| `docs/41_led_controller_onboarding.md` | §3.2.1 replaced by the force rule ("an output with no port row is DISABLED by the push"); the "ONE asymmetric write" paragraph, `parkedOutputs` persistence, re-park button, count-belief rule, and §4.1(b)'s "switch the device into sACN-receive" all rewritten to the §2.1 contract (including the `swarm.enabled:false` write and the Q1 note); §4.5's push-step description updated (route confirm no longer asserts parked-absent); §4.4 stays (restore-to-standalone is now the operator's own web-UI move) |

Also sweep and rewrite every user-facing string still claiming mode
neutrality: `it NEVER changes DMX / swarm show mode`,
`never change DMX / swarm show mode`, `mapping write was deferred by DMX
mode`, `use the guarded Smokestack / mass_deploy show-mode workflow`
(`led_discovery_panel.js` ≈1392/1783/2105, `marsinled_client.js` ≈632).
Replacement copy for the single-push dialog warning:

> ⚠ FORCE push — the sim panel is the source of truth. This overwrites the
> board's strand + DMX config: outputs P-mapped here are enabled with the
> mapped counts and universes, every other output is DISABLED, and the board
> is switched to DMX-driven (sACN). A board in SWARM mode leaves SWARM mode.
> The device reboots (~11 s); the push waits up to 45 s and reads the full
> config back before calling it done.

Push-all keeps the same paragraph pluralized, plus the existing "one scene
save + bridge notify + route read-back after the last controller" line.

### 2.6 Flow of both paths after the change (for the validator)

Single push (`startPush` → confirm dialog → `runPerOutputPush`):

1. `getStatus` (feature gate `deviceSupportsPerOutput` — loud refusal on old
   firmware, unchanged) + `getConfig` snapshot — one read.
2. `ensurePortUniverses` (registry repair, unchanged) →
   `derivePerOutputPlan` → blocking collisions refusal dialog (unchanged
   mechanics; parking findings gone).
3. `buildForcedConfigBody({snapshot, plan})` — the dialog's payload preview
   IS this object, byte-identical to the POST.
4. Confirm → `buildRouteExpectation` (stated before the write, unchanged) →
   `pushForcedConfig` → on `needs-reboot`/lost reply: `awaitReboot` with
   progress → `getStatus`+`getConfig` → `diffForcedConfig` → G8 liveness →
   bind/provenance (unchanged) → `persistAndNotifyAfterPush` → outcome
   sentence.

Push-all (`startPushAll` → `pushAllLedControllers`): identical per-board
path, **sequential**, per-controller try/catch (one failure never aborts the
rest), per-controller live progress line (§2.3-6), results table (§2.3-7),
then ONE save + notify + route read-back over the union of pushed
expectations — all as today minus the removed gates.

---

## 3. Test plan

### 3.1 Deleted with the feature (S1)

The four smokestack suites (176 tests at last count). No other suite imports
the deleted modules (verified).

### 3.2 Modified / new tests (S2–S4) — all device I/O via injected `io`
bags or a stubbed global `fetch`; **no test may contact a real controller,
ever** (the existing mock-device pattern in `per_output_push.test.js` /
`marsinled_client.test.js` is the template)

| Suite | Work |
|---|---|
| `marsinled_client.test.js` | delete the `assertMappingPushAllowed` block; port `applyPerOutputPlan` tests to `applyForcedPlan` (add: unmapped-enabled output → `enabled:false`, hardware fields copied verbatim, count forced on an already-enabled output); NEW `buildForcedConfigBody` tests: body carries `FORCED_DMX_BLOCK` by value, `swarm` = snapshot's object with `enabled:false`, `swarm` omitted when snapshot has none, deviceName repair present/absent/refusal, validation refusals; NEW `pushForcedConfig`: POST body byte-equal to input, `writeResponseLost` on timeout, definite failure on answered non-2xx, no GET issued; NEW `diffForcedConfig`: green on exact match; red on each of — wrong enable, wrong count, wrong universe, wrong start, `dmx.enabled` false, `swarm.enabled` true, `sacn.enabled` false, identity change; `dmxOwnsOutput` asserted only when present |
| `per_output_push.test.js` | delete the mode-refusal tests (≈173–180, ≈756–779) and every parked-flow test; re-point the S2 gate tests at the new plan shape; NEW: push-all on a 3-board fake fleet where board 2 times out on write and never comes back → results `[pushed, failed(UNCONFIRMED wording), pushed]`, loop reached board 3; NEW: a board in SWARM (`swarm.enabled:true`) is pushed (no refusal) and its POSTed body carries `dmx.enabled:true` + `swarm.enabled:false`; NEW: verify failure on a device that drops the `dmx` write reads back red naming `dmx.enabled`; NEW: `pushAllResultsModel` rendering; NEW: the one-read rule (io records exactly one `getConfig` per controller per attempt) |
| `led_controller_ui_round2.test.js` | dialog copy assertions moved to the force wording; DISABLES / COUNT CHANGES sections render from the plan; parked section gone |
| `controller_registry.test.js` | replace the `parkedOutputs` validation tests with ONE migration test (yaml carrying `parkedOutputs` loads, drops it, logs once); delete setter/getter tests |
| `bridge_route_readback.test.js` | delete `parkedAbsent` cases; expected-routes assertions unchanged |
| `subscribed_universes.test.js` | delete parked-contribution cases |
| `chained_led_patches.test.js`, `led_metadata.test.js`, `address_merge` suite, `orphan_fixtures.test.js` | sweep for `park` references and update (grep-driven; small) |
| `led_discovery` panel suites (`computeSyncState` homes) | NEW: SWARM board with perfect mapping → `drift`, detail names the DMX force; disabled-vs-plan mismatch → drift |

### 3.3 Invocation + acceptance evidence (what the validator collects)

- `node --check` on every touched `.js`/`.cjs` — clean.
- Targeted suites, from `simulation/`, working tree only:
  `node --test tests/marsinled_client.test.js tests/per_output_push.test.js
  tests/led_controller_ui_round2.test.js tests/controller_registry.test.js
  tests/bridge_route_readback.test.js tests/subscribed_universes.test.js
  tests/chained_led_patches.test.js tests/led_metadata.test.js
  tests/orphan_fixtures.test.js tests/controllers_pane_toggle.test.js
  tests/controller_pane_ergonomics.test.js tests/theme_parity.test.js
  tests/led_gamma_workflow.test.js` — all green, with before/after counts
  in the report.
- **Full suite** (`cd simulation; npm run check`): required by
  `sim_auto_checks.md`, but it binds/sweeps the live stack's ports — run it
  ONLY when the operator's stack is down (operator-timed), otherwise record
  the targeted list above and say so explicitly. Never kill a stack port to
  make room.
- `node tools/scene_model_parity.cjs test_bench` and
  `node tools/scene_model_parity.cjs titanic_interior` (their
  `controllers.yaml` changed) — pass; regenerate engine models only if the
  validator reports parity drift (mapping-only edits should not move them).
- The §1.4 greps (zero `smk-`, no live `smokestack` code references), plus
  `grep -rn "park" simulation/src simulation/server` → no LED-parking
  references remain (playlist YAML wording like "spark" obviously exempt —
  match word-ish, review hits by hand).
- Browser evidence (live `:6969` page read-only, throwaway save-server
  pattern if needed; close extra windows after): screenshots of
  (a) the controller pane with no smokestack card, (b) a single-push confirm
  dialog whose payload preview shows `strands` + `dmx` + `swarm` keys and
  the DISABLES section, (c) a push-all results table with a mixed
  PASS/FAIL outcome (stubbed io), (d) a sync chip reading drift on a
  mock SWARM-mode board.
- **No real controller is written to or rebooted by the implementer or the
  validator.** The first live forced push is operator-attended, on the
  bench board (.60) first, ropes after — outside this change's gates.

---

## 4. Slice order (single implementer)

| Slice | Scope | Files | Gate | Rollback note |
|---|---|---|---|---|
| **S1** | switch removal | §1.1 + §1.2 | §1.4 | pure deletion; restore from git history (operator) |
| **S2** | client contract | `marsinled_client.js` (§2.2), its test file | `node --check` + client suite green; `pushForcedConfig`/`buildForcedConfigBody`/`diffForcedConfig` exist, old names gone repo-wide (grep `pushPerOutputUniverses`, `assertMappingPushAllowed`, `applyPerOutputPlan` → zero) | self-contained file + test pair |
| **S3** | plan + parking removal | `device_config_mapper.js`, `controller_registry.js`, two scene yamls, `subscribed_universes.js`, `address_merge.js`, `bridge_route_confirm.js`, their tests | suites green; `grep -rn parkedOutputs simulation/` → only the migration line; parity validator on the two scenes | scene yaml edits are two small blocks; code is grep-recoverable |
| **S4** | flow hardening + UI | `led_discovery_panel.js`, `controller_map_editor.js`, panel/UI tests | full §3.3 targeted list green; browser evidence (b)–(d) | UI-only on top of S2/S3 |
| **S5** | docs | `docs/41_led_controller_onboarding.md` (§2.5 rewrite list) | doc grep: no parking/mode-neutral claims remain | doc-only |
| **S6** | verification pass | — | the whole §3.3 evidence bundle, assembled for the validator | — |

S1 is independent and can land first (it unblocks nothing but shrinks the
tree). S2 → S3 → S4 are strictly ordered. Do not interleave S1 with S2–S4
edits to `led_discovery_panel.js`/`marsinled_client.js` in one sitting —
finish and gate each slice.

**Restart vs reload matrix** (treat "module reloaded" as a checklist item):

- `save-server.js` (and the deleted `.cjs` services) load once per process →
  **launcher bounce** required, operator-timed per
  `.agent/ops/stack_lifecycle.md`; never hand-kill one child.
- All `src/` GUI/model/client files + `style.css` are browser ESM →
  **page reload** after the bounce.
- Registry/scene yaml changes → page reload (loader runs in the browser);
  the parkedOutputs migration logs once on first load.
- Engine, sACN bridges, CaptainPad: untouched. Bridge routes recompute on
  the push's own notify, as today.

---

## 5. What requirement 3 looks like end-to-end (the operator's acceptance)

Board left in SWARM (e.g. a rope controller) → operator presses ⬆ Push on
its card → dialog says it will disable outputs 3/4 (already disabled),
force U-mapping on 1/2, and switch the board to DMX-driven → APPLY → write,
~11 s reboot, full read-back → `✓ device written + verified · ✓ scene saved
· ✓ bridge routes confirmed (U30,U31→.61)` → the board's strands follow the
engine feed immediately (the bridge keeps streaming across the reboot; the
receiver latches on boot). Push-all does the same for every LED card,
sequentially, with a per-board verdict. Switching any board BACK to SWARM
is the operator's manual move in that board's own web UI — the sim no
longer has a control for it, and the next sim push will force it back to
DMX (by design; the sync chip warns first).

## 6. Risks

- **Q1 (§2.1)** — `swarm.enabled:false` on push needs the operator's yes.
  Shipping without it risks the documented INVALID dual-mode state.
- **Superseded rulings** — force-disable and force-count overwrite the two
  older protections ("never disable", "never rewrite count"). A strand
  wired outside the sim, or a real count the sim's model has wrong, WILL be
  darkened/resized by a push now. Mitigation: the DISABLES and COUNT
  CHANGES dialog sections are mandatory and loud; the sync chip shows the
  pending change before any push.
- **Firmware nested-merge semantics** for the `swarm` object are not
  documented; sending the full saved object (not a sparse patch) is the
  designed mitigation. If a bench test shows the firmware rejects unknown
  swarm subkeys on non-swarm builds, the omit-when-absent rule already
  covers it; a rejection on swarm builds would surface as a verbatim 400 —
  loud, not silent.
- **Rope-board interplay with the private CLI**: a sim push flips a rope
  board's mode outside the CLI's transaction journal, and the CLI's
  canonical asset contract (activeMap/allowlists/parity) neither blocks nor
  is touched by a sim config push. That is the operator's stated intent
  (manual swarm ownership), but the CLI's next canonical run will judge the
  fleet by its own rules — expected, not a defect.
- **Push-all duration**: worst case ≈65 s per board, sequential by design
  (reboots must serialize). The per-board progress line is the mitigation;
  do not parallelize.
- **`titanic_interior` / `test_bench` scenes** lose their parked
  universes; after the first post-change push those boards' unmapped
  outputs go disabled instead of parked-dark — same visible result (dark),
  different mechanism; the boards' own web UIs can re-enable if ever needed.
- Uncommitted working tree: this change rides on the already-uncommitted
  `feat/bm_readiness` state; the operator owns commit timing and the
  security check (`python scripts/security_check.py --staged`) before it.
