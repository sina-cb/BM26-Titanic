# Timeline / Lease / Control-Lock E2E Test Spec

Scenario suite for the in-engine Timeline (show plans, operator-takeover
lease, `controlLock` soft/hard locks) and its CaptainPad surfaces (plan-lock
banner, scrim, timeline tab). First executed by hand on 2026-07-02 (report:
`.agent/reports/202607/20260702_0_timeline_bulletproof_handoff.md`); this
spec is the durable definition so any agent can re-run it after touching
`marsin_engine/lib/timeline/`, the api_server view-override/controlLock
region, or the CaptainPad lock surfaces.

Every scenario has an **automation level**:

| Level | Meaning |
|---|---|
| `UNIT` | Covered by the `marsin_engine/tests/timeline/` family (`node --test "tests/timeline/*.test.js"`) — run on EVERY engine change; merge-blocking. |
| `DRY` | Reproducible offline with `marsin_engine/tools/timeline_dryrun.mjs` — no engine, no hardware, a whole night in seconds. Cheapest way to see a scenario's SHOW behaviour; it cannot touch the UI. |
| `AUTO` | Scriptable end-to-end: engine REST + puppeteer against the built CaptainPad web app. Run before claiming timeline work merge-ready. |
| `HIL`  | Human-in-the-loop: needs the real iPad (touch, sunlight legibility) and/or real hardware (PortWatch device, power cycle). Run with the operator before a deploy; the AUTO variant is the regression gate, the HIL pass is the acceptance gate. |

Most scenarios are BOTH: `AUTO` for regression, `HIL` for acceptance. The HIL
column says what only a human can judge.

## Stack setup (AUTO runs)

```bash
cd marsin_engine && node engine.js --model test_bench --pattern test/solid   # :6968
cd CaptainPad && npm run web:build && npx serve dist -p 6967 -s              # :6967
```

- Puppeteer via `simulation/node_modules/puppeteer`, viewport 1280×900,
  `--use-gl=swiftshader`, screenshots to `.agent_renders/` (gitignored).
  Drive the UI by `aria-label` (all lock/plan controls carry one).
- Engine truth via REST: `GET /timeline/state` (mode, operatorLease,
  planActive, inFestivalWindow, festivalStartsInDays, forcingDeckView) and
  `GET /globals` → `controlLock`.
- **In-window fixture**: a plan whose `festival.startDate` is TODAY must be
  generated at run time (REST `POST /timeline/plans` cloning `playa_default`
  with `festival: {startDate: <today>, days: 8}`), then activated. NEVER
  commit such a fixture — it goes stale the next day. Delete it after the run.
  (The OFFLINE equivalent needs no generation: `timeline_dryrun.mjs --fixture`
  runs `marsin_engine/tests/fixtures/timeline/dryrun_bench.yaml`, which carries
  no `festival` block and is therefore always in-window on any `--date`.)
- Timeline runtime residue (`marsin_engine/states/*/timeline_state.yaml`,
  `config.yaml`) is expected — report, never commit or revert (codex P0).

## Scenario matrix

Engine-truth assertions in [brackets] are REST checks; the rest are DOM/visual.

### S1 — In-window lock engages (AUTO + HIL)
Setup: in-window plan active, mode armed, AUTO ON.
Steps: open DECK. Expect: amber "PLAN RUNNING · CONTROLS LOCKED" banner with
TEMPORARY TAKE OVER / GO TO PLAN (**DISABLE PLAN was removed in the 2026-07-03
simplification** — `PlanLockBanner.tsx:200-204`; takeover is the only way to
interrupt a running plan and it always auto-resumes); scrim veils the whole content region
INCLUDING the overlay stack; taps on sliders/pills/playlist are no-ops
[mode/lease unchanged after tapping]. [controlLock='plan',
forcingDeckView=true].
HIL: banner legible at arm's length in daylight; real touches (not synthetic
clicks) are swallowed; scroll-blocked-while-locked feels acceptable.

### S1b — Safety exemption (AUTO + HIL)
While S1-locked: PANIC opens its confirm sheet; BLACKOUT reachable. The
bottom safety bar must NEVER be inside the scrim.
HIL: operator can hit PANIC in under 2 seconds while locked.

### S2 — Mixer entry under plan lock (AUTO)
While S1-locked: navigate to MIXER. Expect: NO takeover modal (the old blue
ViewTakeoverConfirm is deleted); banner + scrim only; mixer is read-only.
[Engine output stays pinned to deck — currentView 'deck'.]

### S3 — Temporary takeover, timer, hand-back (AUTO + HIL)
From locked DECK: tap TEMPORARY TAKE OVER. Expect: scrim drops, controls
live, banner flips to "TAKEN OVER — PLAN RESUMES IN M:SS" counting DOWN
[mode='overridden', operatorLease set]. Let it tick ≥10s, touch any control:
countdown RESETS to full [activity() extended expiresAtMs]. Tap RESUME NOW:
plan re-locks within ~2s [mode='armed', lease null, controlLock='plan'].
HIL: the countdown is the operator's only lease feedback — confirm it reads
clearly and the reset-on-touch feels right during real fader use.

### S4 — Mixer takeover routes output (AUTO + HIL)
From locked MIXER: TEMPORARY TAKE OVER. Expect: countdown banner AND the
master strip LIT (master ≠ black; output viz colorful)
[/mixer/view-override → currentView 'mixer']. RESUME NOW returns output to
the deck [currentView 'deck'].
HIL: the physical rig output visibly follows (deck look → mixer look → back).

### S5 — AUTO OFF / re-arm cycle (AUTO)
*(Rewritten 2026-07-31: this scenario asserted `mode='paused'`, a mode DELETED
in the 2026-07-03 simplification — `timeline_state.js:126` documents `mode ∈
armed | overridden`. As written it could never pass. The DISABLE PLAN button it
drove is gone too; the AUTO toggle on the timeline tab is the surviving
"stop driving" control.)*

From locked: timeline tab → **AUTO OFF** (`POST /timeline/autopilot
{enabled:false}` → `setAutopilotEnabled(false)`) → banner + scrim clear
everywhere, deck/mixer fully usable [mode stays `'armed'`,
`autopilotEnabled=false`, `controller='manual'`, controlLock=null,
forcingDeckView=false]. Then **AUTO ON** → the baseline re-establishes and the
lock re-engages [`autopilotEnabled=true`, `controller='autopilot'`,
controlLock='plan']. RESUME is a different control: it is the hand-back from a
TAKEOVER (S3), not the AUTO re-arm.

### S6 — Manual fire + event log (AUTO)
Timeline tab, active plan: tap a cue's FIRE. Expect: fires [lastFiredCueId]
and the EVENT LOG gains a `manual · manual` row; lifecycle rows
(pause/resume/catchUp/takeover/lease-released) accumulate correctly across
the whole suite run.

### S7 — Out-of-festival-window (AUTO)
Activate a plan whose festival is in the future (e.g. `playa_default`
pre-August). Expect: timeline tab shows the amber "Plan active — starts in
X days. Deck & mixer stay unlocked until then." note; DECK and MIXER show NO
banner/scrim and are fully usable [planActive=true, inFestivalWindow=false,
festivalStartsInDays>0, controlLock=null].

### S8 — Restart resilience (AUTO + HIL)
Take over (lease held, mode overridden), then kill + restart the engine.
Expect after boot: [mode='armed', lease null], the PERSISTED active plan is
both REPORTED and RUNNING (cues/window from the right plan — regression:
boot used to load the config plan's content under the persisted name), and
the lock re-engages if in-window. UI shows no stuck "TAKEN OVER … 0:00".
HIL: real power-cycle of the rig computer mid-takeover, on-playa conditions.

### S9 — Natural lease expiry (UNIT + HIL-optional)
Idle through the full `operatorLeaseSec` (default 120s) after a takeover:
lease auto-releases, plan resumes at now, lock re-engages. UNIT covers the
logic ('tick past lease expiry' test); an AUTO run costs 2+ min of wall clock
so it's optional there. HIL: worth one real pass — walk away from the iPad
and watch the plan take the rig back.

### S10 — Stuck-state sweeps (UNIT)
The 2026-07-02 audit regressions, all in `tests/timeline/timeline_service.test.js`.
*(Rewritten 2026-07-31: the old list cited `setMode('paused')` and `hold()`,
both DELETED in the 2026-07-03 simplification — see `arbiter.js:75-78`.)*
Orphaned `overridden` heals on boot AND on tick ("boot drops a persisted
operatorLease", "tick self-heals an orphaned overridden mode (no lease)");
the mirror-image orphan heals too ("audit C1 backstop: the tick drops an
orphaned lease on a non-overridden mode"); `resume()` and
`setAutopilotEnabled(false)` both clear an in-progress takeover lease and exit
`overridden`; festival window OPENING mid-run re-pins on the next tick
("audit H2"); persisted `controlLock:'plan'` boots soft (api_server C2 —
currently reasoning-verified only, see the handoff report's follow-ups).

## Pass criteria

An AUTO run passes when every scenario's DOM + [engine] assertions hold and
each screenshot is VISUALLY inspected (codex rule — a green probe with a
broken render is a fail). A HIL run passes when the operator signs off each
HIL column item; file failures as Notion tasks (see `.agent/os/task_tracking.md`).

## Offline dry-run (LANDED 2026-07-31)

The SHOW half of these scenarios no longer needs wall-clock hours or a running
engine. `marsin_engine/tools/timeline_dryrun.mjs` drives the REAL
`TimelineService` (real triggers, real arbiter, real sun/festival math, real
`PlaylistManager`) on an injected fast clock with a scripted mood track, and
prints a minute-by-minute night plus a summary table. Zero sACN, zero network,
writes only under `~/tmp`.

```bash
cd marsin_engine
node tools/timeline_dryrun.mjs --help
node tools/timeline_dryrun.mjs --fixture --date 2026-09-01            # always-in-window bench plan
node tools/timeline_dryrun.mjs --date 2026-09-01 --events-only        # the real titanic plan, in-window day
node tools/timeline_dryrun.mjs --date 2026-09-01 --mood loud_stereo_1500
```

Use it BEFORE an AUTO run to know what the show is supposed to do; the AUTO run
then only has to prove the UI and the wiring agree. It cannot cover the DOM /
lock-surface half of any scenario — that still needs the runner below.
Harness plumbing is unit-covered by `tests/timeline/timeline_dryrun.test.js`.

## Committed engine e2e runner (LANDED 2026-07-31 — report `_100`)

The ENGINE half of the wanted runner exists:

```bash
cd marsin_engine
node --import ./tests/helpers/setup_config_guard.mjs --test "tests/e2e/*.test.js"
# or just: npm test   (tests/e2e is inside the glob)
```

- `tests/e2e/timeline_e2e_harness.mjs` — the shared rig. Spawns a REAL
  `engine.js` subprocess, drives REST + `/ws/control`, restarts it by really
  killing it, and builds the in-window fixture plan at RUN TIME.
- `tests/e2e/timeline_zoom_e2e.test.js` — 17 scenarios covering the zoom
  ladder, EVERY row of the `_94` exit table, two-client behaviour, party
  sessions vs a zoom, and post-`_98` ribbon conformance. ~2 min.

**Three safety walls, each ASSERTED on every boot, not assumed:**

1. **sACN cannot reach the rig.** `--dest` is NOT sufficient — the config's
   per-controller `controllers:` block carries its own host and wins for the
   universes it claims (the `_97` §4.4 incident: 30 s of live sACN on the real
   ship). The harness writes a black-holed config (`controllers: []` +
   `sacn.destinations: [127.0.0.9]`) and hands it to the engine via
   `MARSIN_CONFIG_FILE`, then asserts every `[sACN Out] Sender started` line,
   the absence of any Art-Net sender, and an empty
   `GET /status.outputRouting.controllers`. **`MARSIN_CONFIG_FILE` now governs
   the engine's BOOT read as well as the autopilot write-back** (`_100`) —
   before that there was no way to neutralise the controllers block short of
   editing the tracked `config.yaml`.
2. **No tracked-tree writes.** `MARSIN_STATE_DIR`, `MARSIN_PLAYLISTS_DIR` and
   `MARSIN_TIMELINE_DIR` (added in `_100`) all point into temp dirs, so
   `POST /timeline/plans` / `plan/activate` cannot reach
   `simulation/scenes/**`. Every engine-spawning suite MUST also import
   `tests/helpers/setup_config_guard.mjs`.
3. **No port collisions.** Engines take a random port in 7700-7899 — clear of
   the pinned 6967-6972 + 5568 band — with OSC, the web client and VSN1 deploy
   all disabled.

The fixture plan carries **no festival block** (always in-window, never goes
stale) and picks its own **fixed-offset `Etc/GMT±N` timezone** so that "now" is
always mid-afternoon in plan-local time — a suite whose meaning changes between
23:00 and 03:00 is worse than no suite. Nothing dated is committed.

## Still wanted: the DOM half

The UI scenarios (S1-S8 above, and `_97` §7's "the pad announces it") still
need a puppeteer runner against the built CaptainPad web app — one file per
scenario, screenshots in `.agent_renders/e2e/`, offline-safe (puppeteer reuses
the sim's vendored install). The engine harness above is the model for its
setup/teardown and its safety assertions; drive the UI by `aria-label`.
