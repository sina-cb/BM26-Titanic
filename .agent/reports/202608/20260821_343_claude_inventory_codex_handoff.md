# 343 — Claude work inventory + acceptance handoff (for Codex, new main manager)

Requested by the operator: a complete, evidence-backed inventory of all
Claude-owned BM26 work, a Bike Link contract handoff, and a Timeline
acceptance matrix. Read-only inventory — nothing was modified, committed,
restarted, or discarded to produce it. No new implementation work starts
until ownership coordination.

**Tree snapshot at inventory time:** branch `feat/bm_readiness` at
`a239b8bf` ("docs: add Timeline redesign mocks and manual cues"), in sync
with `origin/feat/bm_readiness` (0 ahead / 0 behind). Everything below
marked UNCOMMITTED sits in the shared working tree on top of that commit.
Test results marked "re-run at inventory" were executed fresh for this
report; others cite the dated report where the run is recorded.

---

## 1. Workstream inventory

### W1. Timeline engine — phase-aware default resume
- **Purpose:** opt-in `defaultCue.phaseAware: true`; when a program/event/
  takeover releases, the engine resolves the cue that OWNS the current
  moment (via the deck-state resolver) instead of snapping to the static
  default. Covers all six release/idle paths plus `endProgram`. Includes
  three follow-up fixes: END SHOW no longer resurrects the cue it just
  ended (transient exclude), natural expiry walk-back skips dead
  restorables to the live owner, and the 21:30 boundary double-dispatch is
  coalesced (single FIRE proven on the real plan).
- **Files:** `marsin_engine/lib/timeline/timeline_service.js`,
  `marsin_engine/lib/timeline/show_plan.js` (both M, UNCOMMITTED).
- **Tests run:** `tests/timeline/timeline_phase_aware_default.test.js`
  16/16 (fixtures only, no real-plan mutation); full engine suite — see §5.
- **Tests missing:** none known engine-side.
- **Physical:** none required directly (inert for plans that don't opt in;
  the in-tree arc opts in — its physical acceptance is §3).
- **Deps:** the arc plan sets `phaseAware: true` (verified in-tree).
- **Defects/cautions:** none open.
- **Ownership:** Claude implementation COMPLETE. **Safe to integrate.**

### W2. Timeline dry-run assertion harness
- **Purpose:** `--assert [--assert-spec <file>]` on the dry-run tool; 8
  assertion classes (contiguity, master-authorship, eligibility-window,
  shuffle-pinning, event-resume, solar-drift, lint, restart-resume with
  02:00/07:30 probes). Classes 2 and 4 need a spec whitelist and SKIP
  loudly without one — by design, never silently.
- **Files:** `marsin_engine/tools/timeline_assertions.mjs` (NEW),
  `marsin_engine/tools/timeline_dryrun.mjs` (M), 10 fixture plan/spec YAML
  pairs under `marsin_engine/tests/fixtures/timeline/` (NEW). All UNCOMMITTED.
- **Tests run:** `tests/timeline/timeline_assertions.test.js` 27/27; used
  live at inventory time (see §3 evidence runs).
- **Tests missing:** an assert-spec for the playa arc (OPEN, external
  author's item — until then classes 2/4 SKIP on the arc).
- **Defects/cautions:** none open.
- **Ownership:** Claude COMPLETE. **Safe to integrate.**

### W3. Night arc — design doc only (content is NOT Claude's)
- **Claude's piece:** `docs/77_bm26_night_arc_timeline.md` (NEW,
  UNCOMMITTED) — the reviewed v2 arc design (8 phases, decisions D1–D8,
  constants, open decisions OD-1..5).
- **NOT Claude's:** both scenes' `timeline/playa_default.yaml` and the 16
  `dusk_/dust_/night_*` playlists are the external author's in-tree work
  (foreign-owned under the standing rule: Claude agents never edit, revert,
  or "clean" them). Two open findings were bounced to the author: (a) 4
  playlists out of sync with the derivation tool (this is the ONLY source
  of engine-suite failures — see §5); (b) no assert-spec (classes 2/4 SKIP).
- **Ownership:** design doc safe to integrate; arc content is the author's.

### W4. Party FAST/SLOW split — proposal only, no code
- **Purpose/state:** report `_337` proposes FAST 26 / SLOW 27 drawn
  exclusively from the blessed 53-entry `ambient_sound_reactive` (operator
  ruling: old party lists retired as sources; `_335` superseded). Keeps
  playlist names `party_high`/`party_low` (verified zero-ripple: default
  in `timeline_state.js`, both scenes' `timeline_state.yaml`, plan looks).
  7 borderliners seated for balance and flagged for review.
- **Files changed:** NONE — documentation only. No playlist was created or
  modified by Claude.
- **Next step:** was waiting on the external split review (JOB 1/JOB 2
  tables); implementation wave (tunings verbatim, byte-identical scene
  pairs, gallery regen, shuffle OFF for directed sessions) NOT started.
- **Ownership:** OPEN — needs ownership coordination (Claude or Codex can
  implement once the reviewed tables are final).

### W5. Bike Color Link — engine side
- **Purpose:** push the rendered palette to MarsinLED bike boards over
  HTTP; disabled by default.
- **Files (all UNCOMMITTED):** `marsin_engine/lib/bike_color_share.js`
  (NEW), `/bikes` + `/bikes/config` routes in `lib/api_server.js` (M),
  wiring in `engine.js` (M), `bike_color_share:` block in `config.yaml`
  (M, `enabled: false` mandatory), tests
  `tests/io/bike_color_share.test.js`, `tests/io/bike_color_share_api.test.js`,
  `tests/helpers/mock_bike_server.mjs` (NEW).
- **Tests run:** 18/18 against TEST-NET mock boards (no real hardware
  touched); full contract in §2. Report `_336`.
- **Tests missing:** none automated; physical first-live test is the gate.
- **Physical:** operator test sheet `_341` §2 (enable → LINKED → palette
  follow ≤30 s → disable → ≤60 s self-revert = PASS → ride-away
  STALE/GONE).
- **Deps:** bike firmware ≥1.2.3; both bikes verified on 1.2.4 —
  **nothing needed from 1.2.5 for bike link**.
- **Defects/cautions:** none open.
- **Ownership:** Claude COMPLETE. **Safe to integrate** (feature-flagged off).

### W6. CaptainPad — Bike Link status/control panel
- **Files (UNCOMMITTED):** `CaptainPad/components/BikeColorLinkCard.tsx`
  (NEW), `components/bike_link_logic.ts` + `.test.ts` (NEW),
  `utils/api.ts` (M — appends `fetchBikes`/`setBikesConfig`; this file also
  carries the operator's committed MIDI work, merged cleanly, tsc clean),
  `app/(tabs)/config.tsx` (M — mounts the card under Engine Settings).
- **Tests run:** logic tests 30/30 (vitest); full CaptainPad suite 2729
  pass at landing (report `_340`); TypeScript clean after the MIDI merge.
- **UI states:** DISABLED / DISCOVERED / LINKED (lease countdown, push
  stats) / STALE / GONE, plus an explicit "engine unavailable" row (a 404
  from an older engine renders as its own honest state, never empty).
- **Physical:** `_341` §4 (pad rebuild required first — dist is stale
  until then).
- **Ownership:** Claude COMPLETE. **Safe to integrate.**

### W7. Smokestack scene repatch (simulation)
- **Purpose:** rebind the four rope controllers to per-output universes and
  retire the bench board.
- **Final plan (controllers by last IP octet, full IPs in the private
  registry only):** `.61` U30/31 LeftLeftRopes · `.62` U32/33
  LeftRightRopes (LEADER, bound) · `.65` U36/37 RightRightRopes · `.66`
  U34/35 RightLeftRopes (new id 25). `.60` bench board retired portless.
  TE Sign 2 V3 (U40/41) parked at `.63` unbound.
- **Files (UNCOMMITTED):** `simulation/scenes/titanic/controllers.yaml`,
  `patches.yaml`, `simulation/tests/engine_bridge_contract.test.js`
  (relay host `.60`→`.61`).
- **Tests run:** sim suite 2546 pass / 0 fail; patch parity strict PASS
  (report `_339`).
- **Physical/operator:** reboot/repush the stale `.60` board so it can't
  double-drive; launcher bounce recomputes relay routes; **SINA DECISION:**
  TE-sign Left@`.64` / Right@`.63` may be swapped — unconfirmed.
- **Deps:** MarsinLED smokestack CLI (below); ropes need the 1.2.5 flash
  for show-follow.
- **Ownership:** Claude COMPLETE in sim. **Safe to integrate.**

### W8. Smokestack mode-switch CLI (lives in the PRIVATE MarsinLED repo)
- **Purpose:** Ethernet-assumed DMX↔swarm mode switching with registry/MAC
  verification, health checks, `--dry-run`/`--yes`/canary, and a terminal
  `SAFE TO KILL NETWORK` verdict.
- **State:** committed LOCALLY in MarsinLED (`c9c5c1d` on its `dev/1.2.5`),
  NOT pushed; 76 tests pass (pytest FROM THE MARSINLED REPO ROOT — running
  from `deploy/` falsely fails 18 unrelated data-pack tests). Nothing of it
  lives in this repo. First live invocation is operator-only by design.
- **Blockers:** the private deployment-registry diff (proposal delivered to
  the operator) must be reviewed/landed; the tool refuses placeholder
  registry entries on purpose.
- **Ownership:** Claude COMPLETE; integration is a MarsinLED-repo concern.

### W9. Timeline operator UI redesign — design track
- **State:** docs/78 + both design mocks are now COMMITTED (`21f83729`,
  `a239b8bf`, incl. `CaptainPad/design_mocks/*.html`). Claude's review +
  full spec is report `_342` (UNCOMMITTED): plan verdict, 9 contract
  violations in the first external mock, per-view spec, 34-row datum→API
  table, ENGINE GAPs EG-1..9, SINA DECIDES SD-1..13, performance-mode +
  passcode-takeover + dev-plan addendum.
- **Operator ruling on direction:** the external (Codex) mock wins the
  visual direction; from Claude's work only the P0/P1 corrections carry:
  - P0: remove SAVE DRAFT + the false "nothing live until saved" copy
    (autosave hot-reloads the active plan); LIVE/CALENDAR render the live
    overview only (draft only in EDIT PLAN); NOW owner from resolved
    segments (`state.activeCue` is null through every deep-night ambient
    block); add the one-alert slot + stale/offline honesty; remove invented
    endpoints (PREVIEW CURRENT/SAFELY); calendar taps go through the cue
    review sheet (the only PERFORM path), never straight to Time Travel;
    strip machine-path `@font-face`.
  - P1: 44 pt/16 pt floors in the calendar grid; Time Travel needs live
    resolve, travel-active state, and RESUME LIVE; party card needs
    in-session/cooldown/window/offline states; five themes via semantic
    tokens.
- **Also Claude's (UNCOMMITTED):**
  `simulation/scenes/test_bench/timeline/dev_runup.yaml` +
  `marsin_engine/tests/fixtures/timeline/dev_runup_spec.yaml` — the "dev"
  run-up plan (15 fictional cues, neutral past start date per the
  no-future-dates rule) with the first full 8-class assert-spec in the
  tree. Re-verified at inventory: 8/8 ASSERTED PASS.
- **Implementation:** NOT started — blocked on ownership coordination and
  the SD rulings (headline: SD-1 zoom-exit gesture, SD-9 unlock scope,
  SD-13 dev-plan dating). Passcode enforcement needs **EG-8** (extend the
  existing perf-mode passcode gate to the remaining mutating timeline
  routes) — engine work, unstarted, required before the perf view's
  security claim is honest.
- **Ownership:** design deliverables safe to integrate; implementation OPEN.

### W10. Operator test sheet
- `.agent/reports/202608/20260820_341_operator_test_sheet.md`
  (UNCOMMITTED): §0 launcher bounce preconditions → §1 post-bounce smoke →
  §2 bike live test → §3 smokestack CLI + repatch consequences → §4 bike
  panel → §5/5b timeline + night-arc acceptance → §5c UI redesign package →
  §6 physical-smoke backlog → §7 art rulings. This is the canonical
  physical-gate list; every "physical" row in the tables below points here.

---

## 2. Bike Link contract handoff

**Engine endpoints (this repo, `lib/api_server.js` + `lib/bike_color_share.js`):**
- `GET /bikes` → `{ enabled, targets, bikes: [{ controllerId, ip, state:
  DISCOVERED|LINKED|STALE|GONE|UNSUPPORTED, firmware, leaseMsRemaining,
  lastSeen, pushStats {ok, fail} }] }`. Older engines without the route =
  404, which the pad renders as its own explicit state.
- `POST /bikes/config` `{ enabled, targets }` → applies live; `config.yaml`
  `bike_color_share:` block is the boot-time equivalent. Default DISABLED.

**Firmware contract (MarsinLED, shipped in 1.2.3+; both bikes on 1.2.4):**
- Push: `POST /api/colors` `{ "color1": [h,s,v], "color2": [h,s,v],
  "engine": true }` per board, direct HTTP.
- Authority/lease: the `engine:true` write takes a 60 s global-color lease,
  refreshed by the engine's ~30 s push cadence (cadence is load-bearing —
  two consecutive missed pushes = lease expiry). Local/rider writes during
  the lease get **409** with an `engineLease` marker. Lease expiry
  auto-restores the pre-engine color snapshot ON THE BOARD — engine writes
  are never persisted. That self-revert is the disable-path pass condition.
- Status: `GET /api/status` → `colors.engine.{leased, msRemaining}`,
  `controllerId`, `mac`, `firmwareTag`.
- Discovery: engine scans the configured target range and binds by
  `controllerId` (never by IP; DHCP-safe); mDNS `_marsin._tcp` TXT
  (cid/ver/role/mac) exists as a secondary signal.
- Version gate: 1.0.x = nothing; 1.1.0–1.2.2 = status only, no
  `/api/colors` (rendered UNSUPPORTED, never pushed); 1.2.3+ = full.
- Slew: color transitions smooth on the BOARD (firmware-side); the engine
  sends discrete palette updates only — no engine-side ramp exists or is
  needed.
- Swarm roles (FOLLOWING / HOLDING / Ride Solo / root vs acting leader):
  a SMOKESTACK-rope concern, **not part of the bike link path** — bikes are
  standalone Wi-Fi boards addressed directly. The engine never sets or
  reads swarm role on bikes. (Rope swarm behavior belongs to the MarsinLED
  1.2.5 track and the mode-switch CLI, W8.)
- DMX coexistence: boards render from DMX when their DMX input is enabled;
  the engine color lease rides the global-colors layer and does not switch
  render source. Precedence on a DMX-enabled board is a firmware concern —
  the engine never pushes colors to the smokestack rope controllers at all
  (they are sACN/DMX fixtures in the scene patch, W7).
- TEST-NET mock coverage (18 tests): discovery, version gating, lease
  refresh, 409 handling, STALE/GONE/relink, push-failure accounting, config
  toggling, API routes. Mocks bind TEST-NET addresses; no real controller
  is ever touched by tests.
- **Physical test order + recovery:** `_341` §2/§4 — enable (pad card or
  API) → DISCOVERED→LINKED → palette follow ≤30 s → disable → board
  self-reverts ≤60 s (RECOVERY IS AUTOMATIC: worst case, stop pushing and
  every board restores itself inside a minute) → optional ride-away
  STALE→GONE→auto-relink.
- **Needed from MarsinLED 1.2.5 for bike link: NOTHING.** 1.2.4 is
  sufficient and verified. (1.2.5 items — per-strand DMX schema, standby
  leader, etc. — matter to the ROPES, not the bikes. One firmware-side
  caution already relayed: pattern-initiated `/api/colors` writes must not
  send `engine: true` or they'd steal the rider lease.)

---

## 3. Timeline acceptance

**Evidence runs (fresh, at inventory):**
- In-tree `titanic/timeline/playa_default.yaml` (the author's arc,
  `phaseAware: true` verified): assert run over 3 in-window nights —
  classes 1, 3, 5, 6, 7, 8 **PASS (0 violations)**; classes 2, 4 **SKIP
  (no assert-spec — open author item)**. Restart probes: 02:00 →
  `b2_uv_lasers`, 07:30 → `c_morning_watch`, every probed night.
- `dev_runup.yaml` + its spec: **8/8 ASSERTED PASS** — proves the harness
  itself asserts all classes when a spec exists.
- Committed-at-HEAD plans (pre-arc): playa_default FAILS 14 assertions
  (24 h party eligibility, ~591 ownerless min/night, ownerless event
  resume). Those numbers are the before/after evidence, not open defects.

**Cue inventory (in-tree titanic plan; nightly pattern is identical across
festival nights — day-specific overrides are the manual cues below):**

| Slot | Cue | Kind |
|---|---|---|
| Daytime owner | `c_day_off` (from 09:00) / `c_initial_off` (00:00 boot) | program |
| Ignition | `c_ignition_white` | program |
| First color | `c_first_color` (until 21:30) | program |
| Early night | `c_early_night` (from 21:30) | ambient |
| Party eligibility | `c_mood_to_party` (mood; human toggle is the only enabler) | mood |
| Midnight drive | `b1_midnight_drive` + `b1_midnight_carry` (cross-midnight) | ambient |
| Quiet reset 1 | `r1_quiet_reset` | ambient |
| UV lasers | `b2_uv_lasers` | ambient |
| Quiet reset 2 | `r2_quiet_reset` | ambient |
| Ember hold | `b3_ember_hold` | ambient |
| Open sea | `b4_open_sea` | ambient |
| Pre-dawn | `c_pre_dawn` | ambient |
| Sunrise bloom | `c_sunrise_bloom` | program |
| Morning watch | `c_morning_watch` (until 09:00) | program |
| Dust storm | `c_dust_storm` | manual program |
| Maxa | `c_event_maxa` | manual program |
| Philharmonic | `c_event_philharmonic` | manual program |
| Burn night | `c_burn_night` | manual program |
| Temple night | `c_temple` | manual program |
| Baby reveal | `c_baby_reveal_pink` / `c_baby_reveal_blue` | manual program |

All cue CONTENT above is the external author's (foreign-owned). Claude's
engine changes are what make resume/restart behave; the proof matrix below
says exactly what is proven by what.

**Boundary proof matrix (applies to every boundary in the table):**

| Property | Status | Evidence |
|---|---|---|
| Correct owner at every minute | PROVEN (offline) | class 1 + class 8, fresh PASS above |
| No ownerless gap | PROVEN (offline) | class 1, 0 violations over probed nights |
| No baseline flash at 21:30 | PROVEN (offline) | double-dispatch coalesce fix; single FIRE shown on the real plan (report `_338` addendum) |
| Correct master authorship | **NOT PROVEN** | class 2 SKIPs until the author ships an assert-spec |
| Correct playlist contents | **OPEN DEFECT** | 4 playlists out of sync with the derivation tool (author item; causes the 2 engine-suite fails) |
| Correct shuffle/order pinning | **NOT PROVEN** | class 4 SKIPs until the spec exists |
| Restart/catch-up (02:00, 07:30) | PROVEN (offline) | class 8 probes, fresh PASS above |
| END SHOW restoration (all owners) | PROVEN (offline) | phase-aware fix + 16/16 tests; four-owner walk in `_341` §5b awaits physical pass |
| Party eligible ≠ enabled | PROVEN (offline) | class 3 PASS; persisted config `enabled:false, durationMin:12, cooldownSec:900`; human toggle sole enabler (operator-confirmed requirement) |
| Offline/stale honesty in UI | **NOT IMPLEMENTED** | specced in docs/78 (P0 list); no code yet |

**Physical acceptance for ALL of the above:** `_341` §5b visual pass —
nothing timeline-related has run on the rig yet.

---

## 4. Items with other or unknown ownership (do not misattribute)

- **NOT Claude's:** both scenes' `playa_default.yaml`, the 16 night/dusk/
  dust playlists (external author, foreign-owned); commits `21f83729` +
  `a239b8bf` (docs/78 revisions, `CaptainPad/design_mocks/*`, manual-cue
  doc work) — made outside Claude's sessions.
- **UNKNOWN owner — VERIFY before integrating:** the white-day set now in
  the tree: `marsin_engine/patterns/white_only/21..25_*.js`,
  `tests/patterns/white_day_contract.test.js`, both scenes'
  `playlists/white_day.yaml`, and modifications to `patterns/manifest.json`,
  `specialty_white_uv.test.js`, `white_only_contract.test.js`,
  `states/test_bench/deck_state.yaml`. No Claude wave in the readiness
  ledger produced these; they appeared during the external content-authoring
  window. Confirm with the operator.
- **Baby Reveal:** the plan cues exist (author's content, above). The wider
  Baby workstream is Claude-owned but PAUSED/ARCHIVED by operator ruling —
  no agent touches Baby files until the operator reopens it.
- **Deployment/offline boot:** deployment hardening (secret provisioning,
  `--no-launch`, shortcuts) completed and recorded earlier; offline
  readiness holds for everything new (mocks are zero-external-request —
  re-verified; no CDNs/fonts anywhere in Claude outputs).

## 5. Repo-wide test truth (so nothing is misattributed)

- Engine suite (node:test via `npm test` from `marsin_engine/` — NOT
  vitest): re-run at inventory — 4010 tests, 4008 pass, 2 fail, 0 skipped
  (npm exit 1). The only failures are the two
  playlist-derivation findings in the author's content (W3) — they are NOT
  engine defects and NOT Claude regressions.
- CaptainPad = vitest: 2729 pass at last full run (`_340`); TypeScript
  clean after the operator's MIDI commit merge.
- Sim suite: 2546 pass / 0 fail at `_339`.
- Known false-alarm patterns: MarsinLED pytest run from `deploy/` cwd
  falsely fails 18 data-pack tests (run from repo root); vitest reports "no
  tests" on the engine (wrong runner).

---

## A. READY FOR CODE REVIEW
| Item | Where |
|---|---|
| Phase-aware default + fixes (W1) | timeline_service.js / show_plan.js |
| Assertion harness (W2) | tools/ + fixtures + dryrun |
| Bike link engine (W5) | bike_color_share.js + routes + tests |
| Bike panel (W6) | BikeColorLinkCard + logic + config tab |
| Smokestack repatch (W7) | scene YAMLs + bridge test |
| dev_runup plan + spec (W9) | scene timeline + fixtures |

## B. READY FOR OFFLINE TESTING
| Item | How |
|---|---|
| Arc plan assertions | dry-run --assert (6/8 proven; 8/8 once the author's spec lands) |
| Party split implementation | after reviewed tables land (W4) |
| UI redesign implementation | after ownership + SD rulings (W9) |

## C. READY FOR PHYSICAL TESTING (operator sheet `_341`)
| Item | Sheet section |
|---|---|
| Launcher bounce + smoke | §0–1 |
| Bike link live (engine + pad) | §2, §4 |
| Smokestack CLI status/dry-run | §3 |
| Night-arc visual pass | §5b |
| Repatch consequences (.60 stale, TE-sign) | §3 |

## D. BLOCKED — NEEDS IMPLEMENTATION
| Item | Note |
|---|---|
| Party FAST/SLOW playlists | proposal `_337` final; code untouched |
| Timeline UI (Codex skeleton + P0/P1 list) | W9 |
| EG-8 perf-mode route gating | engine; required for the passcode story |
| 4 drifted playlists derivation pass | author item (clears the 2 suite fails) |
| Playa assert-spec | author item (unlocks classes 2/4) |

## E. BLOCKED — NEEDS SINA DECISION
| Item | Note |
|---|---|
| TE-sign `.63`/`.64` swap | W7 |
| SD-1..13 UI rulings | headline: SD-1, SD-9, SD-13 |
| Private registry diff | gate for smokestack CLI live use |
| Art rulings | `_341` §7 |
| white_day set ownership | §4 |

## F. SAFE FOR CODEX TO INTEGRATE
Everything in table A, plus docs/77, report `_342`, and the test sheet
`_341`. NOT safe to touch without coordination: the foreign-owned arc
content (theirs already), Baby files (operator-paused), anything in table E.

---

*Claude stands down from new implementation pending ownership coordination,
per the handoff instruction. The readiness ledger
(`.agent/memory/bm_readiness_thread_tracker.md`) and the dossier
(`.agent/projects/bm26_show_readiness.md`) remain the running history.*
