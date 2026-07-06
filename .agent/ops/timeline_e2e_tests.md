# 16 — Timeline / Lease / Control-Lock E2E Test Spec

Scenario suite for the in-engine Timeline (show plans, operator-takeover
lease, `controlLock` soft/hard locks) and its CaptainPad surfaces (plan-lock
banner, scrim, timeline tab). First executed by hand on 2026-07-02 (report:
`.agent/02_reports/202607/20260702_0_timeline_bulletproof_handoff.md`); this
spec is the durable definition so any agent can re-run it after touching
`marsin_engine/lib/timeline/`, the api_server view-override/controlLock
region, or the CaptainPad lock surfaces.

Every scenario has an **automation level**:

| Level | Meaning |
|---|---|
| `UNIT` | Covered by `marsin_engine/tests/timeline_service.test.js` (`node --test`) — run on EVERY engine change; merge-blocking. |
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
- Timeline runtime residue (`marsin_engine/states/*/timeline_state.yaml`,
  `config.yaml`) is expected — report, never commit or revert (codex P0).

## Scenario matrix

Engine-truth assertions in [brackets] are REST checks; the rest are DOM/visual.

### S1 — In-window lock engages (AUTO + HIL)
Setup: in-window plan active, mode armed, AUTO ON.
Steps: open DECK. Expect: amber "PLAN IS RUNNING" banner with TEMPORARY TAKE
OVER / DISABLE PLAN / GO TO PLAN; scrim veils the whole content region
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

### S5 — Disable / re-arm cycle (AUTO)
From locked: DISABLE PLAN → banner + scrim clear everywhere, deck/mixer fully
usable [mode='paused', controlLock=null]. Timeline tab → RESUME (note: the
AUTO toggle is NOT the re-arm when autopilotEnabled is already true) → lock
re-engages [mode='armed', controlLock='plan'].

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
The 2026-07-02 audit regressions, all in `timeline_service.test.js`:
orphaned `overridden` heals on boot AND tick; `setMode('paused')` /
`enableProgram()` clear the lease; `hold()` supersedes a takeover and
survives the old lease window; festival window OPENING mid-run re-pins on
the next tick; persisted `controlLock:'plan'` boots soft (api_server C2 —
currently reasoning-verified only, see the handoff report's follow-ups).

## Pass criteria

An AUTO run passes when every scenario's DOM + [engine] assertions hold and
each screenshot is VISUALLY inspected (codex rule — a green probe with a
broken render is a fail). A HIL run passes when the operator signs off each
HIL column item; file failures as Notion tasks (spec 14).

## Wanted: a scripted runner

As of 2026-07-02 the AUTO scenarios live as throwaway scripts. The next step
is a committed runner (suggested home: `CaptainPad/e2e/` or
`marsin_engine/tests/e2e/`, node + puppeteer, one file per scenario, shared
lib for aria-click/REST probes/fixture setup+teardown) with a single
entrypoint that prints a scenario-by-scenario PASS/FAIL table and drops
screenshots in `.agent_renders/e2e/`. Keep it offline-safe: no CDNs, no
downloads at run time (puppeteer reuses the sim's vendored install).
