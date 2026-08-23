# 355 — Smokestack switch card: implementation, asset repair, and the round-trip attempt

Implements report `_354` Part 1 (the operator card) plus the operator's
mid-wave scope addition (canonical asset re-release, driven from the card).
Everything below is **built, tested and screenshotted**.

**The round trips were NOT run.** Two independent live blockers, both named in
§5. No board was written to in this wave: no apply, no flash, no OTA, no
registry or secrets edit, no git operation, no commit.

Controllers are named by `controllerId`; IPs appear as last octet only.

---

## 1. Live census (read-only, taken this wave)

`python <CLI> status` — registry-locked, read-only:

| controllerId | reach | MAC | fw | mode | role | coherence | cfgSrc | staged |
|---|---|---|---|---|---|---|---|---|
| `ss_left_left` (.61) | YES | YES | 1.2.5 | SWARM-native | follower | **DETACHED** | primary | False |
| `ss_left_right` (.62) | YES | YES | 1.2.5 | SWARM-native | leader | active | primary | False |
| `ss_right_right` (.65) | YES→**NO** | YES | 1.2.5 | SWARM-native | follower | FOLLOWING | primary | False |
| `ss_right_left` (.66) | YES | YES | 1.2.5 | SWARM-native | follower | FOLLOWING | primary | False |

`.65` answered the first sweep of this session and then **stopped answering
partway through** (§5.1). Every later probe is a timeout.

Asset readback (`GET /api/status`, read-only, via the sim's status service):

| controllerId | activePattern | activeMap | activeMapHash | card verdict |
|---|---|---|---|---|
| `ss_left_left` | `titanic_swarm_pattern.js` | **`pushed_map.json`** | `1cfc9081` | NEEDS RE-RELEASE |
| `ss_left_right` | `titanic_swarm_pattern.js` | **`pushed_map.json`** | `1cfc9081` | NEEDS RE-RELEASE |
| `ss_right_right` | — (unreachable) | — | — | UNREACHABLE |
| `ss_right_left` | `titanic_swarm_pattern.js` | `swarm_titanic_rop_b5fc8e9e.json` | `130aa205` | NEEDS RE-RELEASE¹ |

¹ `.66`'s own assets are correct; it is flagged because the fleet's
`activeMapHash` **parity** is broken by the other boards. That is exactly what
the deploy CLI does, so the card must not show it as green.

**Both canonical dry-runs still refuse 3 of 4 boards on the asset contract.**
`to-dmx --dry-run` and `to-swarm --dry-run`, verbatim causes:

```
ss_left_left    WOULD REFUSE: activeMap is '/models/pushed_map.json',
                              expected '/models/swarm_titanic_rop_b5fc8e9e.json'
                WOULD REFUSE: model allowlist mismatch (22 files vs the frozen 4)
                WOULD REFUSE: pattern allowlist mismatch (18 files vs the frozen 2)
                WOULD REFUSE: compiled pattern manifest/allowlist not ready
                WOULD REFUSE: canonical fleet activeMapHash parity failed
                              ['130aa205', '1cfc9081', '31ef7d91']
                WOULD REFUSE: canonical fleet dataFingerprint parity failed
ss_left_right   WOULD REFUSE: activeMap / model+pattern allowlist / manifest
ss_right_right  WOULD REFUSE: activeMap / model allowlist (pushed_map.json residue)
ss_right_left   PLAN — WOULD POST /api/config
VERDICT: DRY RUN - no changes made
```

Per the standing rule, an asset/allowlist/manifest/parity refusal on either
canonical dry-run means **do not switch the fleet**. Neither `--names` nor
FORCE was used to push the fleet around that gate.

---

## 2. What landed, file by file

### 2.1 BM26-Titanic (working tree, branch `feat/bm_readiness` — uncommitted)

| File | Change |
|---|---|
| `simulation/server/smokestack_status_service.cjs` | passes through `assets{activePattern,activeMap,activeMapHash}` and `sacn{enabled,lastPacketAgeMs}` (read-only, same two GETs as before). Any field the board did not report is `null` — never a default that reads like agreement. |
| `simulation/src/dmx/smokestack_mode.js` | the whole `_354` §1.3/§1.4 model: `assetsState`, `firmwareMajorityTag`, `boardVerdictModel`, `fleetVerdictRows`, `fleetFixList`, `dmxFeedModel`, `runTimelineModel`, `dryRunAssetRefusals`, `dryRunRefusalLines`; plus the asset-re-release model (`ACTION_RE_RELEASE`, `reReleaseConfirmPhrase`, `smokestackReReleaseModel`, `reReleaseFleetVerdict`, `reReleaseTargetIds`) and its `applyGateModel` / `jobOutcomeModel` / transition branches |
| `simulation/src/gui/smokestack_panel.js` | new render order (board table → both direction buttons → asset repair → run timeline → confirm strip → verdict banner → Advanced Recovery → Details); the elapsed ticker; the `show plan` disclosure; the verbatim `CLI:` line; `Repair to DMX` moved into Advanced Recovery |
| `simulation/server/smokestack_cli_service.cjs` | the `re-release` action (frozen target set, per-set typed phrase, fingerprint-bound apply, no rollback flag, leader context refused); `firstWouldRefuse`; the refused-plan apply gate |
| `simulation/style.css` | board-table stack layout, verdict chips, run timeline, elapsed, readback age, asset-repair row, `CLI:` line, plan disclosure — theme tokens only, no hard-coded hex |
| `simulation/agent_tools/smokestack_capture.cjs` | `--real-cli` / `--census` / `--action` / `--legs` passthrough, the real CLI's phase-marker lines in the stub, a mocked-readback mode for deterministic UI-state shots, and the full round-trip leg driver |
| `simulation/tests/*` | +76 tests (§3) |

`save-server.js` needed **no change and no new routes**, as `_354` §1.4
predicted — the public job already carries everything the card renders.

### 2.2 MarsinLED (private, uncommitted, NOT pushed)

New `re-release` subcommand, built by a delegated agent to the operator's
spec. New `deploy/lib/smokestack/assets.py` (all logic), 5 surgical hunks in
`deploy/smokestack_mode.py`, a new test file, and `SMOKESTACK_MODE.md`. It is
registry-MAC-gated, canary-first, fingerprint-bound on every `--yes`, never
touches identity/roles/universes/wifi/firmware, and never changes a board's
mode. **13 new tests; 65 passed with the two adjacent smokestack suites.**

**Blocking finding from that work — see §5.3:** one of the six canonical
release artifacts is not in the private repo at all, so `re-release` refuses
loudly before contacting any board.

---

## 3. Test numbers

`node --test tests/smokestack_*.test.js`, working tree only:

| Suite | Before | After |
|---|---|---|
| `smokestack_mode_model.test.js` | 71 | **96** |
| `smokestack_cli_service.test.js` | 36 | **43** |
| `smokestack_status_service.test.js` | 8 | **12** |
| `smokestack_routes.test.js` | 20 | **25** |
| **total** | 135 | **176 / 176 pass** |

Adjacent suites touching the same files, all green: `controller_pane_ergonomics`,
`controllers_pane_toggle`, `theme_parity`, `led_metadata`, `per_output_push`,
`chained_led_patches`, `subscribed_universes` — **191 / 191**.

`node --check` clean on every touched `.js` / `.cjs`. The full sim suite was
**not** run — `npm run check` is gated because it sweeps the operator's live
stack ports.

---

## 4. Four real defects the work surfaced

These are the reason the wave was worth doing even without the round trips.

**4.1 A dry-run the CLI already refused read as "Dry-run passed".**
The canonical dry-run exits **0** and prints its ordinary
`VERDICT: DRY RUN - no changes made` even when it refused three of four boards
— the refusals live only inside the plan table. The old gate judged exit code
+ verdict + fingerprint, so it said *"Dry-run passed — review the plan, then
arm the apply"*, APPLY armed, and the CLI would then reject the whole
transaction at pre-flight. Nothing unsafe was ever written, but the card told
the operator the opposite of the truth. Now `dryRunRefusalLines` is part of
both the outcome model and the apply gate (and the server's), and the banner
carries the CLI's own first cause.

**4.2 The refusal parser missed each board's first refusal.**
The CLI prints the first `WOULD REFUSE:` for a board *inside* its result-table
row, after the columns, and the rest as continuation lines. Anchoring the match
at line start silently dropped the most important one per board.

**4.3 `lastPacketAgeMs: -1` would have read as a live DMX feed.**
The firmware reports `-1` for "no sACN packet has ever arrived". The spec's
`sacn.enabled && lastPacketAgeMs < 2000` accepts that as a 0-second-old feed —
a fail-open on the exact criterion the DMX leg is judged by. `dmxFeedModel`
refuses any negative or absent age.

**4.4 Four blocks that were toggled with `hidden` never actually hid.**
`display: grid` beats the UA stylesheet's `[hidden] { display: none }`. Two of
the four (`.smk-job-banner`, `.smk-repair-row`) are **pre-existing** — which is
why the card showed a "RUN TIMELINE" box and four idle controller chips with
no job running. Fixed for all four and pinned by a test.

Also fixed: a mid-run `POSTED` chip survived as a board's final state on a
finished apply. Any board the CLI gave no final result row now reads `UNKNOWN`.

---

## 5. Blockers — why the round trips did not run

### 5.1 `ss_right_right` (.65) is UNREACHABLE — bad-board list

The only board on the bad list. Precise symptom, for a fast fix:

- It **answered normally** at the start of this session (`REACH YES`, `MACOK
  YES`, fw 1.2.5, SWARM-native, follower, `FOLLOWING`, fps 57) and stopped
  answering partway through, without any action from this agent.
- `GET /api/status` on port 80 now fails `ETIMEDOUT` at both a 3 s and an 8 s
  deadline — a timeout, not a refusal, so nothing is answering at that address.
- The sim's own controller pane independently reports
  `'RightRightRopes' gamma refresh unreachable: .65 did not answer within
  10000 ms`.
- The other three answer normally from the same host at the same moment, so
  this is that board or its link, not the network or the sim.

Operator remedy: **power + LAN check on .65 first**, then re-census. If it
comes back with its identity and fw 1.2.5 intact, nothing else is needed —
before it dropped it was a healthy `FOLLOWING` follower. Note that a separate
MarsinLED agent was re-releasing assets on .61/.62/.65 during this window, so
a reboot mid-run is the most likely explanation; check it is not simply still
rebooting before touching hardware.

With .65 unreachable the fleet toggle correctly refuses **both** directions
(`0 unknown · 1 unreachable — refresh and resolve every board`), so no leg
could have started regardless of the asset gate.

### 5.2 The asset contract still refuses 3 of 4 (§1)

Unchanged from `_352`/`_353`. `.65` has improved (it now carries the canonical
map alongside `pushed_map.json` residue, and is back on
`titanic_swarm_pattern.js` rather than `default.js`), so the parallel
re-release is partly landed — but the left pair still runs the pushed map on
the broad 22-file legacy image, and fleet hash parity is still broken.

### 5.3 The canonical keyed map is not in the private repo

`/models/swarm_titanic_rop_b5fc8e9e.json` — the frozen release's active map —
**does not exist anywhere in the MarsinLED tree**. It is the LittleFS-shortened
name for `swarm_titanic_rope_model_keyed_v2_320.json`, a **baked** artifact
produced from `swarm_titanic_rope_model.js` plus the bm26-titanic per-controller
`pixel_count: 320` override, and `*_keyed*.json` is gitignored.

So the new `re-release` subcommand refuses before contacting a board, by
design, rather than sourcing the file from `.66`:

```
REFUSED: CANONICAL RELEASE ARTIFACT(S) UNAVAILABLE in the golden source tree
  /models/swarm_titanic_rop_b5fc8e9e.json
No fallback: this tool NEVER sources a canonical file from a live board.
```

**Operator action required: bake a bm26-titanic data pack** (or point
`--golden-root` at a tree that has the map) before the card's REPAIR ASSETS…
button can do anything. This is the single item on the critical path to
`SAFE TO KILL NETWORK`.

**Nobody else clicked the live panel during this wave**, and no leg was in
flight at any point — there was nothing to interfere with.

---

## 6. The card, as built

One glance answers: fleet state, which board is bad, what to do, may I press
the button.

1. **Header** — `Smokestack SWARM (4)` + fleet chip + readback age (`0 s ago`,
   `smk-stale` past 30 s) + `🛰 Refresh`.
2. **Board table** — one small stack per controller rather than nine columns
   on a line, because in this pane's width nine columns pushed the verdict and
   the remedy off the right edge behind a scrollbar:
   - line 1 `operator label · id` + mode chip + **verdict chip**
     (`GOOD` / `NEEDS RE-RELEASE` / `NEEDS REFLASH` / `UNREACHABLE`)
   - line 2 `role · follow · assets · fw · reach` (a DMX board shows
     `ok · feed 0.2 s` or `ok · NO FEED` — the DMX leg's own criterion)
   - line 3 the one-line remedy, only on a non-GOOD row
   - line 4 the live transaction line, only during a job
3. **Both directions always on screen** — `SWITCH TO DMX` and
   `SWITCH TO SWARM`; exactly one can ever arm, and only the one
   `smokestackFleetToggleModel` derived. One refusal line beneath, never a list.
4. **REPAIR ASSETS…** — offered only when a row reads NEEDS RE-RELEASE, blocked
   when any board needs a reflash or is unreachable (never paper over a
   flash-class fault with an upload).
5. **Run timeline** — `PREFLIGHT → CANARY <id> → PARALLEL (n) → REBOOT WAIT →
   VERIFY → COHERENCE → READBACK → VERDICT`, parsed line-by-line from the CLI's
   own output, with `elapsed 37.2 s` ticking at 4 Hz and per-board chips.
   `to-dmx` has no COHERENCE step at all. A phase the CLI never announced ends
   `skipped`, never `done`.
6. **Confirm strip** — the full 64-char fingerprint, `type SWITCH to arm`,
   APPLY, Cancel; the plan behind a `show plan` disclosure that opens itself
   only when the dry-run was refused.
7. **Verdict banner** — green `SAFE TO KILL NETWORK` only on the CLI's exact
   line plus a clean 4/4 readback, with `CLI: <line>` echoed verbatim beneath
   in every case so panel-vs-CLI parity is visible on screen.
8. **Advanced Recovery** (now also hosting `Repair to DMX`) and **Advanced
   details** — both collapsed, unchanged internals.

---

## 7. Screenshots (`.agent_renders/`)

Captured with `agent_tools/smokestack_capture.cjs` (puppeteer, live `:6969`
read-only, throwaway save-servers on random high ports, stub CLI). Shots 2, 6
and 12 are the **real fleet**; the flow shots use a mocked readback so the
panel's states are deterministic — nothing in this tool contacted a board
except the section's own read-only glance.

| Shot | What it proves |
|---|---|
| `smokestack_1_unprovisioned_*` | the honest "deployment source not provisioned" refusal |
| `smokestack_2_status_*` | the REAL fleet: `.61` DETACHED/residue, `.62` residue, `.65` UNREACHABLE/OFFLINE, `.66` residue-by-parity, both directions disabled |
| `smokestack_12_rerelease_*` | REPAIR ASSETS… 3 boards, **disabled**, with the real reason: `.65 is unreachable — fix power/LAN first` |
| `smokestack_2b_mock_all_dmx_*` | a healthy ALL-DMX fleet: four GOOD rows, `assets canonical`, `feed 0.2 s`, only SWITCH TO SWARM armed |
| `smokestack_3_dryrun_*` / `4_armed_*` | dry-run verdict + 64-char fingerprint; the typed phrase arming APPLY |
| `smokestack_11_timeline_*` | the run timeline mid-apply, elapsed ticking |
| `smokestack_5_verdict_*` | every phase `done`, four `PASS` chips, green SAFE TO KILL NETWORK, and `Trusted verdict:` == `CLI:` byte-for-byte, 4/4 readback |
| `smokestack_6_recovery_*` / `7_force_dryrun_*` / `8_force_armed_*` | Advanced Recovery from the live readback, the one-controller plan, the controller-specific phrase |
| `smokestack_9_force_verdict_*` | the honesty contract: CLI said `VERDICT: OK`, the independent readback disagreed, panel prints `TARGET NOT VERIFIED` + `Trusted verdict: NONE` |
| `smokestack_10_refused_*` | an asset-contract refusal — APPLY refused, plan disclosure opened **by itself**, the CLI's own cause quoted (§4.1) |

---

## 8. Stack lifecycle

The operator's stack was **DOWN** when this wave needed it
(`node launcher.js status` → no lock file), so under the operator's explicit
authorization it was started and later stopped by this agent:

- started `2026-08-23T06:22:19Z` — `node launcher.js prod --scene titanic
  --no-launch --sacn-priority 150`
- healthy `2026-08-23T06:22:51Z` — sim/save/sacn-in/sacn-out/engine/captainpad
  all ✅, `~7486 sACN packets/5s from 'MarsinEngine' — the rig is being driven`
- stopped by this agent with `node launcher.js stop` at the end of the wave.

No port was ever killed by hand and no child process was signalled directly.
The launcher rebuilt the CaptainPad static export on startup (its own staleness
guard), which is expected residue, not a change by this wave.

---

## 9. Operator steps

1. **Bounce the launcher and reload the sim page.** `save-server.js`,
   `smokestack_cli_service.cjs` and `smokestack_status_service.cjs` load once
   per process, and the panel/model/CSS are browser ESM. After the bounce,
   `GET /smokestack/provision` must answer and the card must show the new board
   table with an `assets` field per row. Treat "module reloaded" as a checklist
   item, not an assumption.
2. **Power/LAN check `.65`** (§5.1), then press `🛰 Refresh` and confirm four
   reachable rows.
3. **Bake a bm26-titanic data pack** so the canonical keyed map exists in the
   private tree (§5.3). Until then REPAIR ASSETS… refuses, correctly.
4. Then press **REPAIR ASSETS…**, review the plan, type the phrase, APPLY —
   canary `.65` first, leader `.62` last is the CLI's own order.
5. When all four rows read `GOOD` with `assets canonical`, the fleet toggle
   arms and the round trips can run: SWARM→DMX→SWARM→DMX, per `_354` §2c.

---

## 10. Remaining blockers

- **`.65` unreachable** — power/LAN, then re-census.
- **The canonical keyed map is not in the private tree** — bake the data pack.
  This is the one item on the critical path to `SAFE TO KILL NETWORK`.
- **Asset re-release for `.61`, `.62`** (and `.65` once it is back) — now
  possible from the card, once the two items above are resolved.
- **Both repos are uncommitted.** The private `re-release` work is deliberately
  unpushed.
- **Round trips still owed.** Nothing in this wave proves a live DMX⇄SWARM
  switch; the UI, the models and the gates are proven, the fleet is not.
