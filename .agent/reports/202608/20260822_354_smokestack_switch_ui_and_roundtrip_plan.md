# 354 — Smokestack switch card redesign + live round-trip plan

Fable design/plan output. **Nothing implemented, nothing run.** Builds on
`_344` (panel v1), `_352` (diagnosis), `_353` (Advanced Recovery as built).
Operator goal, verbatim intent: switch DMX→SWARM and SWARM→DMX **at least 2
times without any issues** from the sim UI; if any controller is bad, get a
quick fix/reflash list. Live switching of the four rope controllers (`.61`
`ss_left_left`, `.62` `ss_left_right` = leader, `.65` `ss_right_right`, `.66`
`ss_right_left`) is authorized for the Opus agent, reboots included.

Why the live panel looks wrong today: the save server still runs the
pre-`_353` module and the page predates the `f74e` toggle hunk (no bounce
yet) — hence "cannot switch", greyed Repair, stale readback. A bounce + reload
fixes the staleness; the clutter is what Part 1 removes.

---

## Part 1 — Design: the operator card (replaces the v1 body, keeps the model)

One glance answers: fleet state, which board is bad, what to do, may I press
the button. Everything else goes behind a disclosure. `smk-*` styling reused.

### 1.1 Element list (top → bottom)

1. **Header** `Smokestack Ropes — DMX ⇄ SWARM` + fleet chip + `🛰 Refresh` +
   readback age (`12 s ago`; turns `smk-stale` past 30 s). Fleet chip states:
   `ALL DMX` · `ALL SWARM` · `ALL SWARM (n coherence)` · `MIXED n/m` ·
   `UNKNOWN (n unreachable/unread)`. Existing `smokestackFleetModel`, no change.
2. **Board table** (4 rows, one line each, no wrapping):
   `label · id | mode chip | role | follow | assets | fw | reach | VERDICT chip | action`.
   - mode: `DMX` / `SWARM` / `MODE ?` / `INVALID` / `OFFLINE` (existing chips).
   - role: `leader` / `follower`; follow: `active` · `FOLLOWING 0.8 s` ·
     `DETACHED` · `OFF` · `—` (DMX).
   - assets: `canonical` / `residue` / `unread` (new field, §1.4).
   - verdict chip (new, `smk-verdict-chip-*`): `GOOD` (ok tone) ·
     `NEEDS RE-RELEASE` (warn) · `NEEDS REFLASH` (danger) · `UNREACHABLE` (danger).
   - action: one short imperative for non-GOOD rows only (§1.3 table), else blank.
3. **Primary actions row**: `SWITCH TO DMX` and `SWITCH TO SWARM` (existing
   `smk-switch-primary` styling, both always rendered; exactly one enabled by
   `smokestackFleetToggleModel`, the other disabled with its reason under the
   row — `smk-switch-refusal`, one line, never a list). `Repair to DMX` row is
   **removed from the main body** (folded into Advanced Recovery, §1.1 item 7).
4. **Run timeline** (new `smk-timeline`, visible only while a job exists):
   chevron steps `PREFLIGHT → CANARY <id> → PARALLEL (3) → REBOOT WAIT →
   VERIFY → COHERENCE → READBACK → VERDICT`, each `pending / active / done /
   failed / skipped`, plus a monospace `elapsed 37.2 s` ticking from
   `job.startedAt` (client clock, 250 ms tick) and per-board mini-chips under
   the active step (`ss_left_left POSTED`, `… rebooting`, `… PASS`). `to-dmx`
   hides COHERENCE (not applicable). The dry-run shows only
   `PREFLIGHT → PLAN` + the fingerprint line.
5. **Confirm strip** (existing row + gate, unchanged): only after a clean
   dry-run; `type SWITCH to arm` · `APPLY` · `Cancel`; 64-char fingerprint in
   `smk-fingerprint`; dry-run console behind `show plan` (open only if refused).
6. **Verdict banner** (existing `smk-job-banner`): green **SAFE TO KILL
   NETWORK** only when `jobOutcomeModel.safeToKillNetwork === true` (exit 0 +
   byte-exact line + trusted readback); `DMX VERIFIED` for `VERDICT: OK` +
   readback; everything else red with the CLI's own line. `CLI: <line>` is
   echoed verbatim beneath in every case so panel-vs-CLI parity is visible.
7. **Advanced Recovery** `<details>` (as built in `_353`; now also hosts the
   old `Repair to DMX` row as its first item). Unchanged internals.
8. **Details** `<details class="smk-advanced">`: per-board geometry/output
   dump, orientation warnings, transaction log, raw console — unchanged, demoted,
   default closed, open state survives repaints.

### 1.2 Fleet state → buttons (existing `smokestackFleetToggleModel`, no new rules)

ALL DMX ⇒ SWARM enabled · ALL SWARM healthy ⇒ DMX enabled · ALL SWARM with
coherence failures or MIXED ⇒ `Recover all to DMX` only · any switchBlocker,
UNKNOWN, stale readback or running job ⇒ both disabled with one reason line.

### 1.3 Verdict chip rules (pure, in `smokestack_mode.js`)

`boardVerdictModel(board, status, fleet, lastDryRun)` → `{verdict, action}`:

| Verdict | When (first match wins) | Action text |
|---|---|---|
| `UNREACHABLE` | `!status.reachable` | `power/LAN — then Refresh` |
| `NEEDS REFLASH` | identity mismatch · `MODE_INVALID` · `perOutputDmx !== true` · `firmwareTag` ≠ fleet majority · non-MarsinLED answer | `reflash <id> (USB, registry-locked)` |
| `NEEDS RE-RELEASE` | `assets !== 'canonical'` · `stagedPending` · `configSource !== 'primary'` · last dry-run row for this id carries a `WOULD REFUSE:` asset/allowlist/manifest/parity line | `re-release assets on <id>` |
| `GOOD` | otherwise (a `DETACHED` follower is GOOD — the DMX leg clears it; row note `detached · cleared by DMX leg`) | — |

### 1.4 State-model deltas

- `smokestack_status_service.cjs`: pass through from `/api/status`
  `activePattern`, `activeMap`, `activeMapHash`, `sacn.enabled`,
  `sacn.lastPacketAgeMs` (read-only, same GET as today). No new endpoints.
- `smokestack_mode.js`:
  - `SMOKESTACK_CANONICAL_ASSETS = {pattern: '/patterns/titanic_swarm_pattern.js', mapPrefix: '/models/swarm_titanic_rop_'}`;
    `assetsState(status, fleetStatuses)` → `canonical` iff pattern equal, map
    basename starts with the prefix, and `activeMapHash` equals every other
    reachable board's; `residue` otherwise; `unread` when fields absent.
  - `boardVerdictModel` (§1.3); `fleetFixList(boards)` → ordered list of
    `{id, verdict, action}` for non-GOOD rows (feeds the census report).
  - `dmxFeedModel(status)` → `{seen, ageMs}` from `sacn.enabled &&
    lastPacketAgeMs < 2000` — the DMX-leg pass criterion (§2c).
  - `runTimelineModel(job, targets, now)` → the §1.1-4 steps, from the parse
    contract below. `smokestackJobPhase` stays (used by tests), becomes a
    thin wrapper.
  - `jobOutcomeModel` unchanged. `preflightDigest` unchanged (assets are
    deliberately NOT in the digest — the CLI fingerprint already covers them).
- `smokestack_panel.js`: new render order, timeline ticker, fix-list rendering
  only; `startRun`, `applyGateModel`, readback, Advanced Recovery untouched.
- `smokestack_cli_service.cjs` / `save-server.js`: **no change, no new routes**
  (public job already carries `startedAt`, `endedAt`, `output`, `verdictLine`,
  `planFingerprint`). `style.css`: `smk-timeline(-step-active/-done/-failed/
  -skipped)`, `smk-elapsed`, `smk-verdict-chip(-ok/-warn/-danger)`, `smk-row-action`.

### 1.5 CLI log parse contract (line-anchored, exact, fail-closed)

Trimmed lines vs literal CLI strings; unmatched lines ignored, never inferred.

| Line (literal prefix) | Step |
|---|---|
| `dry-run: read-only plan sweep across all boards` | PLAN (dry-run) |
| `pre-flight: parallel read-only plan sweep across all boards` | PREFLIGHT |
| `  [<id>] pre-flight OK` / `  [<id>] pre-flight REFUSED` | board chip `preflight ok/REFUSED` |
| first `  [<id>] POST /api/config` before any `followers:` line | CANARY `<id>` active; chip `POSTED` |
| `  [<id>] needs-reboot - queued for readiness polling` | chip `rebooting` |
| `followers: parallel mutation POST across N board(s)` | CANARY done → PARALLEL (N) |
| `followers: parallel readiness wait across N board(s)` | REBOOT WAIT |
| `followers: parallel verification across N board(s)` | VERIFY |
| `  [<id>] reboot-survival already proven:` / `  [<id>] reboot-survival canary:` | COHERENCE (to-swarm) |
| `terminal: independent canonical 4/4 asset/runtime readback` | READBACK |
| `  [<id>] ROLLBACK - restoring pre-change snapshot` / `transaction ROLLBACK:` / `transaction INTERRUPTED:` | current step → failed; chip `restored/restoring` |
| result table row `^<id>\s+(PASS|FAIL|SKIP|PLAN)\s+(\S+->\S+)\s+(.*)$` | chip final state; any other token ⇒ `UNKNOWN` (never green) |
| `VERDICT: ` (last match) · `PLAN FINGERPRINT: [0-9a-f]{64}` | VERDICT; fingerprint |

`<id>` is always the registry name == `controllerId` (the CLI prints names,
never IPs). The existing regex-soup `outputPhase` is replaced by this table;
the old heuristics remain only as the `Details` raw-console fallback label.

---

## Part 2 — Process plan for the Opus implement + validate agent

### (a) Preflight census (read-only, first thing, before any UI work)

1. `python <BM26_SMOKESTACK_CLI> status` (registry-locked, read-only) and
   `GET /api/status` + `GET /api/config` per board via the BM status service
   (`node -e` against `smokestackStatusSweep` with the titanic targets).
2. Classify each board with §1.3 rules by hand (model may not exist yet) and
   hand the coordinator a 4-line fix list **immediately**:

| Class | Operator remedy (private deploy repo, attended) | USB? |
|---|---|---|
| `GOOD` | none | — |
| `NEEDS RE-RELEASE` | registry-locked light release scoped to the board (`mass_deploy.py <fixture> --light --controller <id>` per the private README §Light); if the broad 22-file legacy image does not purge to the frozen 4/2 allowlist, full install per README | no (HTTP); full install = USB |
| `NEEDS REFLASH` | firmware: `--mode ota --release <tag>` canary-first, then `--yes`; identity/capability/dual-mode: USB full install via `deploy.py` (MAC-locked) | OTA no / full yes |
| `UNREACHABLE` | power + LAN check, then re-census | — |

Expected from `_352/_353`: `.66` GOOD; `.61`, `.62`, `.65` NEEDS RE-RELEASE
(pushed_map residue; `.65` also `default.js`); `.61` DETACHED (GOOD-class,
cleared by the DMX leg); fw 1.2.5 ×4. **Canonical `to-dmx` AND `to-swarm`
both refuse 3/4 on assets today** — re-release is on the critical path.

### (b) UI validation without touching 6966–6972 / 5568

**Verdict: no scratch sim needed — start none.** The sim is static ESM served
from disk by `:6969`, so a fresh puppeteer profile (cache off) loads the NEW
panel/model without any bounce. `agent_tools/smokestack_capture.cjs` already
reads the live page, spawns a throwaway `save-server.js` on a random high port
(`SIM_SAVE_SERVER_PORT` + tmp `SIM_SAVE_SERVER_ROOT`), repoints
`window.serverConfig.save_port` at it, and injects a stub CLI. Extend it with
`--real-cli` (pass the real `BM26_SMOKESTACK_CLI`/`BM26_DEPLOY_REGISTRY`/
`_PYTHON` through), `--action`, `--legs N`, `--census`. A full scratch stack
via `BM26_SIM_CONFIG` (17969/17970, non-5568 `sacn_udp_port`; honoured by
`load_ports.cjs` everywhere) works but is unnecessary — the engine is not in
this path, so its scratch flags (`--port`, `--dest <sinkhole TEST-NET address>`,
`MARSIN_STATE_DIR`) stay unused. Nothing binds a stack port; the only residue
is the "2 sim windows connected" banner — close the browser after each pass.
Operator bounce + reload only at the END; then Sina repeats one round trip live.

### (c) Round-trip protocol (real fleet, from the UI, after (a) fix list is done)

Order: census → DMX (leg 1) → SWARM (leg 2) → DMX (leg 3) → SWARM (leg 4)
= 2 full round trips; end in the mode Sina names (default SWARM + kill
verdict). Each leg: Refresh → dry-run → fingerprint → type `SWITCH` → APPLY →
verdict → mandatory 4/4 readback → Refresh → record. Pass criteria per leg:

- all 4 boards in target mode, **saved** (`config.dmx.enabled`) and
  **runtime** (`sacn.enabled` / `swarm.enabled`);
- SWARM leg: exactly one leader `ss_left_right` active, 3 × `FOLLOWING`
  with beacon < 15 s, CLI verdict byte-exact `VERDICT: SAFE TO KILL NETWORK`;
- DMX leg: `VERDICT: OK` and `dmxFeedModel.seen` on all four (engine feed
  `lastPacketAgeMs` < 2000) within 10 s of readback;
- no `ROLLBACK`/`restored`/`SKIP` line; elapsed ≤ 120 s (expect 45–75 s);
- panel banner text equals the CLI verdict line byte-for-byte; no
  unhandled UI state (no `UNKNOWN` chip, no console error, timeline ends on
  VERDICT done);
- identity, firmwareTag, output map (U30–37 @1, 40 px) unchanged after.

Stop rules: any FAIL → stop, report board + CLI line + screenshot; one
re-census then at most ONE retry of the same leg, only if the census is
clean; never a blind second retry. Asset-contract refusal on to-swarm (or
to-dmx) → stop, emit the fix list; **never** use `--names`/FORCE to push a
fleet into SWARM around the asset gate (FORCE TO DMX single-board is allowed
only as the documented escape when a board is stranded SWARM-side).

### (d) Gates that remain

No flashes, registry edits, secrets/paths printed (names only), git ops,
stack-port kills, sim `npm run check`, commits, or launcher actions (Sina
bounces); no clicks on the live panel while a throwaway-server job runs (the
CLI transaction lock is the only cross-process guard). Reflash/re-release is
Sina's, on request, attended.

### (e) Tests + evidence

`smokestack_mode_model.test.js`: assetsState (canonical/residue/unread,
parity break ⇒ residue); boardVerdictModel precedence per §1.3 row incl.
DETACHED ⇒ GOOD; fleetFixList order/text; dmxFeedModel threshold;
runTimelineModel on canned real-shape logs (clean apply, rollback, dry-run,
unknown RESULT token ⇒ UNKNOWN). `smokestack_status_service.test.js`: new
fields pass through, absent ⇒ `null`. `smokestack_routes.test.js`: stub CLI
prints the marker lines; timeline reaches VERDICT; banner == CLI line.
`controllers_pane_toggle` / `theme_parity` still green. Evidence: screenshots
of UNKNOWN, census chips, dry-run+fingerprint, armed, mid-PARALLEL timeline,
SAFE TO KILL banner, DMX VERIFIED banner, a refused dry-run; a timed log per
leg (`leg, action, startedAt, elapsed, verdict line, 4×mode/follow/feed`);
the final census table.
