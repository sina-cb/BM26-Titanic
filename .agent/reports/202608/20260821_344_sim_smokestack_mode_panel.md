# 344 — Smokestack DMX ⇄ swarm mode panel in the sim controllers pane

Operator-requested (explicit Fable task): put an easy-to-understand
smokestack mode-switch surface into the simulation's controller mapping
pane — current mode per rope controller at a glance, plus a guided
"all to DMX" / "all to swarm" flow — without ever violating the
private-repo boundary or touching a board without explicit operator action.

Everything below is UNCOMMITTED working-tree work on `feat/bm_readiness`
(no git operations were performed, per standing rules).

---

## 1. Architecture decision

**Hybrid: a read-only node glance + the private deploy CLI as the ONLY
mutation path (shell-out), stitched together by the save server.**

Three options were on the table:

| Option | Verdict |
|---|---|
| (a) Reimplement the sanitized HTTP switch steps in node | **Rejected.** The switch is ~1,500 lines of safety-critical logic in the private repo (registry+MAC gates, placeholder refusal, client-side DMX-plan validation, pre-flight zero-write sweep, canary-first rollout, reboot-survival check). Duplicating it in a PUBLIC repo means (1) encoding the private registry schema publicly, and (2) two drifting implementations of the one procedure whose failure mode is "the smokestack is dark and the network is already struck". |
| (b) Shell out to the CLI for everything, including status | **Rejected for status.** The CLI's `status` needs the private registry provisioned, and its output is a fixed-width human table — parsing it per-board for an at-a-glance UI is a fragile text contract, and the glance would die whenever the machine isn't provisioned. |
| (c) **Hybrid (chosen)** | Read-only glance in node against the boards' sanitized HTTP surface (`GET /api/status` + `GET /api/config` — the same two documented endpoints the CLI reads); every mutation shells out to the private CLI with all its gates intact. |

Why the hybrid is right:

- **The glance needs no registry.** Mode is one documented field
  (`config.dmx.enabled`); roles/coherence ride `status.swarm.*`. Targets
  come from the scene's own tracked `controllers.yaml` (bound
  `device.controllerId`s), so the glance works on ANY machine, even
  unprovisioned — and it is structurally incapable of mutating (it has no
  POST path at all).
- **The switch keeps every private-side gate.** The panel runs
  `smokestack_mode.py <action> --dry-run` and then, behind the typed
  confirm, `<action> --yes --rollback-on-failure`. Registry+MAC
  verification, pre-flight, canary, rollback and the terminal verdict all
  stay in the one audited implementation. The sim only reads two documented
  output facts: the exit code and the `VERDICT: …` line (the CLI's README
  declares the exact verdict line as its contract).
- **The provisioning boundary is env-only.** The CLI and registry are
  located exclusively via `$BM26_SMOKESTACK_CLI` and
  `$BM26_DEPLOY_REGISTRY` (interpreter override:
  `$BM26_SMOKESTACK_PYTHON`, default `python`). Missing either ⇒ the
  switch flow renders a loud "DEPLOYMENT SOURCE NOT PROVISIONED" state
  naming the missing env vars (names only, never path values) and the
  switch buttons are disabled. No bundled registry, no path guessing, no
  fallback. The glance stays alive regardless.

## 2. Files

**New (simulation/):**
- `src/dmx/smokestack_mode.js` — PURE model (no DOM/network): rope-target
  selection by `device.controllerId`, per-board glance model, fleet
  headline, verdict-line extraction, job outcome model (the
  SAFE-TO-KILL/DO-NOT-KILL split), apply-gate model, confirm phrases.
- `src/gui/smokestack_panel.js` — the pane section; renders exclusively
  from the pure model; repaints itself in place so async updates never
  tear down the rest of the pane.
- `server/smokestack_status_service.cjs` — read-only glance sweep
  (injectable transport; reuses the probe service's hardened
  `httpGetJson` with absolute deadline + byte cap).
- `server/smokestack_cli_service.cjs` — CLI job runner: provisioning
  check, one-job-at-a-time, server-side apply two-step (fresh clean
  same-action dry-run + exact typed phrase), output capture (1 MB cap,
  truncation flagged), 15-min watchdog, verdict-line extraction. Wire
  shape never includes the CLI/interpreter machine paths.
- `agent_tools/smokestack_capture.cjs` — repeatable screenshot tool
  (throwaway save-servers on random high ports, tmp scene root, node stub
  standing in for the CLI — the captured switch flow cannot touch a board).
- Tests: `tests/smokestack_mode_model.test.js` (20),
  `tests/smokestack_status_service.test.js` (8),
  `tests/smokestack_cli_service.test.js` (16),
  `tests/smokestack_routes.test.js` (9, real server process + stub CLI,
  including a provisioned/unprovisioned server pair and a
  model↔server confirm-phrase parity pin).

**Modified (simulation/):**
- `server/save-server.js` — four routes: `GET /smokestack/provision`,
  `POST /smokestack/status`, `POST /smokestack/run`,
  `GET /smokestack/job` (same hostile-shape guards as
  `/controllers/probe`; refusal codes map to 400/403/409/503).
- `server/controller_probe_service.cjs` — exports `httpGetJson` (reuse).
- `src/gui/controller_map_editor.js` — imports + mounts the section after
  the MarsinLED group (2-line mount; section is `null` for scenes without
  the ropes, so test_bench-style scenes are untouched).
- `style.css` — `smk-*` classes, theme custom-properties only.

Nothing outside `simulation/` and this report was touched. No scene YAML,
no timeline/playlist/white_only file, no engine file.

## 3. UI walkthrough

The section lives inside 🎛 Controller Mapping, under the MarsinLED group:
**"Smokestack Ropes — DMX ⇄ Swarm (4)"** with a fleet chip in the header
(ALL DMX / ALL SWARM / MIXED / n unreachable, warnings counted) and a
read-only 🛰 Refresh.

- **Glance rows** — one per rope card (`.61 LeftLeftRopes`,
  `.62 LeftRightRopes` = expected LEADER, `.65 RightRightRopes`,
  `.66 RightLeftRopes`): mode chip (DMX / SWARM / MODE ? / UNREACHABLE),
  role line (LEADER beaconing · FOLLOWING + beacon age · follower state),
  and loud per-row warnings: staged/foreign config pending, degraded
  configSource, missing `perOutputDmx` capability ("to-dmx will be
  refused"), live-identity mismatch vs the scene binding. A sweep nobody
  performed renders MODE ?, never a confident mode. One automatic glance
  fires when the pane opens; after that refresh is manual or post-apply
  (no timers).
- **Switch flow (two steps, both server-enforced):**
  1. "⇄ All to DMX…" / "⇄ All to swarm…" runs the CLI **dry-run** and
     shows its output verbatim in a console block, with a plan banner
     ("zero writes were made"). A refused dry-run shows the CLI's refusal
     and offers only Dismiss.
  2. A confirm row appears only after a clean dry-run: type
     `SWITCH TO DMX` / `SWITCH TO SWARM` exactly to arm ⚡ APPLY. The
     server re-checks the phrase AND requires the dry-run job id (same
     action, exit 0, ≤15 min old). Applies always pass
     `--rollback-on-failure`. One job at a time (409 otherwise).
- **The verdict** — after a to-swarm apply, the big green banner appears
  ONLY when the CLI exited 0 and printed the exact
  `VERDICT: SAFE TO KILL NETWORK` line; anything else (nonzero exit, no
  verdict, timeout, truncated output) is a loud red
  **"DO NOT KILL THE NETWORK — <reason>"**. to-dmx apply verifies on
  `VERDICT: OK`. No partial-success wording exists.
- **Unprovisioned machines** — a caution banner names the missing env
  vars; switch buttons disabled; the glance stays live.
- An old save server without the routes renders as its own named error
  (restart the stack), mirroring the probe-sweep idiom.

## 4. Test results (exact)

- New smokestack tests: **53/53 pass**
  (`node --test tests/smokestack_*.test.js`: 44 unit + 9 HTTP; per-file
  counts above).
- Full sim suite (`node --test tests/*.test.js`, live stack up on :6969):
  **2610 tests — 2606 pass, 3 fail, 1 todo** (the todo is the
  pre-existing `summer_camp_dome/patches.yaml.original` operator item).
  The 3 fails are live-stack browser tests with no smokestack code in
  their path:
  - `Spatial lifecycle cleanup clears every browser layer and pending
    frame` (live_touch_ui_layout) — 30 s timeout under load; **passes
    40/40 re-run in isolation** (my capture tool was driving a SwiftShader
    browser concurrently with the suite).
  - `operator sidecar geometry (screenshot 1440x900)` and `(ipad
    1024x768)` (pixel_map_geometry_regression) — glyph render coverage
    193/199 vs the ≥98 % floor; **reproduces in isolation** against the
    live :6969 stack, both viewports. Nothing in this wave touches the
    pixel map, its sidecar, or canvas painting; flagging as an open
    pixel-map item for the coordinator (possibly live-scene/framing state
    or renderer drift — needs its own investigation).
- Security check: `--staged` PASS (nothing staged);
  `--all` finds only the 6 pre-existing MAC hits inside gitignored
  `simulation/.scene_backups/` (July residue, untracked, not from this
  wave). New tests use RFC 5737 TEST-NET addresses only.

## 5. Screenshots (`.agent_renders/`, verified by eye)

Captured via `agent_tools/smokestack_capture.cjs` against the operator's
live sim page (:6969, read) with throwaway save-servers + a node stub CLI
(so the flow screenshots involve zero board contact):

- `smokestack_1_unprovisioned_1787344816.png` — glance alive, switch
  disabled, "DEPLOYMENT SOURCE NOT PROVISIONED" banner naming the vars.
- `smokestack_2_status_1787344853.png` — rows + fleet chip
  "2 SWARM · 2 unreachable" (see live observations below).
- `smokestack_3_dryrun_1787344859.png` — dry-run console (verbatim CLI
  table + `VERDICT: DRY RUN - no changes made`), plan banner, confirm row
  with disabled APPLY.
- `smokestack_4_armed_1787344863.png` — phrase typed, APPLY armed, gate
  note.
- `smokestack_5_verdict_1787344876.png` — apply console incl. the
  reboot-survival canary line and the green SAFE TO KILL NETWORK banner.

**Live observations while capturing (read-only, real boards):** the
glance genuinely reached the LAN — `.65` and `.66` answered in
**SWARM-native mode with show-follow OFF** (`follower (OFF)` rows), while
`.61` and `.62` were **unreachable** at capture time. Real state for the
operator to be aware of before the CLI's first live run. The sim's own
"2 sim windows connected" contention warning appeared transiently during
capture (my browser + the operator's; closed after capture, nothing armed,
browsers never transmit sACN).

## 6. What remains operator-gated

- **First live `--yes` run** stays operator-attended, watching the boards
  (CLI README rule). The panel never auto-runs anything mutating; every
  apply needs the typed phrase + fresh dry-run, per direction, per run.
- **Provisioning** the show laptop: export `BM26_SMOKESTACK_CLI` (path to
  the private checkout's `deploy/smokestack_mode.py`) and
  `BM26_DEPLOY_REGISTRY` before starting the stack.
  `BM26_SMOKESTACK_PYTHON` optional.
- **The private registry diff** (report _343 table E) is still the gate
  for any live CLI use — the tool refuses placeholder registry entries.
- Physical acceptance stays on the operator sheet `_341` §3.

## 7. Needed from MarsinLED (nothing blocking)

- Nothing for this feature to function. Two nice-to-haves:
  1. A `--json` output mode on `smokestack_mode.py` would replace the
     verdict-line text contract. Until then the panel is pinned to the
     README-documented exact lines (`VERDICT: SAFE TO KILL NETWORK`,
     `VERDICT: OK`, `VERDICT: DRY RUN - no changes made`) — and it fails
     CLOSED: any unrecognized verdict renders as DO NOT KILL.
  2. `BM26_SMOKESTACK_CLI` should be added to the private provisioning
     notes alongside the existing deploy env vars.
