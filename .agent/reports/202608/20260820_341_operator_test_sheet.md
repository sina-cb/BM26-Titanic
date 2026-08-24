# 341 — Operator test sheet (2026-08-20 evening session)

Living checklist for Sina's hands-on session. Coordinator keeps this updated
as waves land; each block says what to run, what GOOD looks like, and what to
report back. Order chosen so earlier steps don't invalidate later ones.

---

## 0. Preconditions (one-time, before anything below)

- [ ] **Bench check, then launcher bounce.** The running engine predates
  everything landed since the merge (PR #54 relocations + today's bike-link
  code). Run the bench sanity you usually do, then restart via the launcher.
  - GOOD: engine up, patterns render, CaptainPad header `● CONNECTED`.
  - Note: the bike-link code rides along but is **inert** —
    `bike_color_share.enabled: false` until you flip it (step 2).
- [ ] **Rebuild the pad** (fresh dist) so CaptainPad picks up the bike panel
  once that wave lands (this sheet will say when it has).

## 1. Post-bounce smoke (5 min)

- [ ] One ambient playlist runs; pattern switch works from the pad.
- [ ] Live Touch ARM → brush → DISARM once (regression canary for the
  relocation-era changes).
- [ ] Eyeball the two repaired patterns on the rig while you're here:
  - [ ] `08_quiet_signal` — envelope should breathe through its FULL cycle
    (the old bug cut it at ~12%).
  - [ ] `05_breathing_violet_horizon` — travel range visibly wider (0.38→0.70).

## 2. Bike color link — first live test (bikes are on firmware 1.2.4, ready)

Full steps in report `_336`; short version:

- [ ] Enable: POST to the engine API (`:6968`) `/bikes/config` with
  `{ "enabled": true, "targets": "<your bike IP range>" }` — or set the
  `bike_color_share:` block in `marsin_engine/config.yaml` before the bounce.
- [ ] `GET :6968/bikes` — expect your bike(s) to appear DISCOVERED → LINKED
  with `leaseMsRemaining` counting and `pushStats` climbing every ~30 s.
- [ ] Change the active palette on the Deck — bike should follow within one
  push cycle (≤30 s).
- [ ] Kill the link (disable via the same endpoint) — bike must self-revert
  to its native palette within ~60 s (firmware lease expiry). That revert IS
  the pass condition.
- [ ] Ride-away test if convenient: take a bike out of range; `/bikes` should
  go LINKED → STALE → GONE, and auto-relink when it returns.
- REPORT BACK: controllerIds seen, any UNSUPPORTED rows, push failure counts.

## 3. Smokestack mode-switch CLI — first live invocation (yours by design)

Tool: `MarsinLED/deploy/smokestack_mode.py` (README: `deploy/SMOKESTACK_MODE.md`).
Prereq: the private-registry diff (in the wave scratchpad,
`registry_diff_proposal.md`) needs your review/landing first — the tool
refuses the current placeholder entries by design.

- [ ] `python deploy/smokestack_mode.py status` (over Ethernet) — expect a
  4-row table: reachable, MAC-verified, firmware ~1.1.0-era, current mode.
- [ ] `python deploy/smokestack_mode.py to-swarm --dry-run` — read the plan,
  confirm it matches intent (leader `.62`, one group).
- [ ] Nothing further until you're ready; `to-swarm --yes` ends with the
  explicit `SAFE TO KILL NETWORK` verdict (committed config + coherence +
  reboot canary) — do not kill the network without that line.
- NOTE: the scene repatch LANDED (report `_339`) — final universe plan
  (fixtures kept their universes; supersedes the CLI wave's draft numbering):
  `.61` U30/31 · `.62` U32/33 · `.65` U36/37 · `.66` U34/35 (all sACN,
  start 1, 40 px RGBW per output). The private-registry proposal doc has
  been updated to match — review it with these values.
  Repatch consequences for your session:
  - [ ] The old bench board at `.60` may still hold a stale U30/31 config —
    reboot/repush it so it can't double-drive the LeftLeft pair.
  - [ ] Launcher/bridge restart (your step 0 bounce covers it) recomputes
    relay routes for the new bindings.
  - [ ] TE-sign question for you: scene now parks TE Sign 2 V3 (U40/41) at
    `.63` unbound — but Left@`.64` / Right@`.63` may be exactly swapped
    (only known fact: `.63` = leftside_te). Confirm the two TE-sign IPs.

## 4. CaptainPad bike status panel — LANDED (report `_340`)

After the pad rebuild (precondition 0) — panel lives in **Config tab, right
under Engine Settings** ("BIKE COLOR LINK" card):

- [ ] With the engine bounced but the feature disabled: card shows the
  explicit DISABLED state (not an empty list).
- [ ] Set targets + tap ENABLE (same flow as step 2, or do it from here —
  this card IS the UI for step 2's enable).
- [ ] Watch a bike go DISCOVERED → LINKED; lease countdown ticks; lastSeen
  stays fresh; push counters climb ~every 30 s.
- [ ] Tap DISABLE — confirmation sheet states the ~60 s self-revert; after
  confirming, the bike's native palette must return within a minute.
- [ ] Pull the engine down briefly (or before the bounce): card must show
  the honest "engine unavailable" row over the last good snapshot — never
  a silent empty state.

## 5. Timeline engine (G1 resume + G2 validator) — LANDED (report `_338`)

Nothing to physically test tonight (plumbing, flag-gated off for existing
plans) — but two things worth knowing:

- **When ChatGPT's arc plan is final**: validate it before it ever touches
  the rig with `node tools/timeline_dryrun.mjs --plan <plan> --assert
  [--assert-spec <spec>]` (from `marsin_engine/`) — 8 assertion classes,
  exit 1 on any violation, including simulated 02:00-restart and
  morning-watch resume probes. The arc plan should set
  `defaultCue.phaseAware: true` to get time-correct resume after events.
- **Honest findings on the CURRENT committed plans** (report `_338`):
  `playa_default` fails 14 assertions at HEAD — party eligible 24 h
  (`c_mood_to_party` ungated), ~591 ownerless minutes/night, event
  releases resume ownerless. The new arc + phaseAware close exactly these;
  the numbers are your before/after evidence.
- Two engine-suite tests currently fail by naming the external author's
  in-progress `night_ember_hold.yaml` — foreign content mid-write, not a
  rig problem; they clear when the author's playlist content is finished.

## 5b. Night-arc acceptance (content LANDED by your external author — full
sheet at `~/tmp/night_arc_operator_test_sheet.md`; merged highlights here)

Offline validation is already done (8/8 assertion classes, 192-hour runs,
both scenes, restart probes at 7 times/night). Before physical testing:

- [x] Engine follow-up wave GREEN (addendum in report `_338`): END SHOW
  resurrection bug FIXED, natural-expiry-to-static-default bug FIXED,
  21:30 double-dispatch COALESCED (one FIRE line proven on the real plan),
  phase-aware tests 16/16, suite 4000/4002.
- [ ] Two findings bounce to your ARC AUTHOR before merge (not engine
  work): (a) 4 playlists (`dusk_sprinkles`, `night_ember_hold`,
  `night_midnight_drive`, `night_uv_lasers`, both scenes) are out of sync
  with the derivation tool, incl. a modulation drift in `night_ember_hold`
  / `00_golden_hour_wash` vs the canonical ambient entry — needs their
  derivation pass; (b) no assert-spec file exists in the tree, so classes
  2/4 loud-SKIP — their "8/8 PASS" is really 6 asserted + 2 skipped;
  authoring the spec is their item.
- [ ] Verify persisted party config exactly: `enabled:false,
  durationEnabled:true, durationMin:12, cooldownEnabled:true,
  cooldownSec:900` — and that it stays OFF across a restart (eligibility
  must never enable).
- [ ] Visual pass in the sheet's order: ignition white (judge master 0.8) →
  first color sprinkles → the four deep-night blocks (each distinct within
  ~20 s, silent baselines never black) → both 10-min quiet resets (no speed
  leakage forward) → party boundary lifecycle (no session before 21:30 or
  after sunrise−120; mid-session disable = clean release) → dust storm +
  END SHOW from four owners (exact time-owning cue resumes) → pre-dawn →
  sunrise bloom → morning watch (judge master 0.4) → 09:00 day-off.
- [ ] Watch the 21:30 handoff specifically for double-load flicker (known
  duplicate dispatch — being coalesced by the follow-up wave).

## 5c. Timeline UI redesign — review package READY (no rig needed)

Fable designed, Opus built, coordinator verified (report `_342` = review +
full spec; docs/78 now self-contained with both mock sources embedded):

- [ ] Open `~/tmp/timeline_ui_redesign_mock_claude.html` — main 4-view mock.
  Keys 1–9 = demo scenarios (9 = DEV-plan banner), T = next theme. Purple
  chips = SD-1…SD-13 open choices.
- [ ] Open `~/tmp/timeline_ui_redesign_mock_claude_perf.html` — PERFORMANCE
  view (read-only + passcode takeover). Keys 1–6 = states; demo passcode
  4242 unlocks; any other code walks the real 401 → 429-lockout path.
- [ ] Rule on the 13 SD points (list + options in `_342` / docs/78); the
  headline ones: SD-1 zoom-exit gesture, SD-7 confirm the 4-view split,
  SD-9 unlock scope, SD-13 dev-plan dating.
- [ ] Dev "run-up" plan landed for you to test-drive the timeline with:
  `simulation/scenes/test_bench/timeline/dev_runup.yaml` (15 fictional
  cues, 5-day window, neutral past startDate — retarget to today in the
  editor; never commit the dated residue). Validated 8/8 dry-run assertion
  classes, the first plan in the tree with a full assert-spec. Your 11-step
  end-to-end procedure is in docs/78 (Mock specification → operator test
  plan).
- NOTE: takeover passwording is engine-verified via the existing
  `$BM26_SECRETS` auth + 30-min waiver — but only some mutating routes are
  perf-gated today; EG-8 (gate the rest) is a required engine follow-up
  wave, queued behind your direction ruling.

## 6. Standing physical-smoke backlog (roll into tonight only if time allows)

- [ ] Live Touch physical-iPad acceptance (report `_331` script).
- [ ] Timeline-preempts-Live-Touch on physical iPad (report `_317` script).
- [ ] Deck/Mixer visual smoke (reports `_318`/`_319`).

## 7. Art rulings queue (no rig needed — verbal answers are enough)

- [ ] `12_uv_rain` vs `15_violet_breathing` — the real similar pair (0.1125):
  keep both / retire one / re-art one?
- [ ] `18_uv_ink_plumes` peaks 84 on test_bench (titanic fine) — care or not?

---

*Updated by the coordinator as waves land. Landed-and-verified so far:
smokestack CLI (MarsinLED `c9c5c1d`), engine bike link (`_336`), night-arc
design v2 (`docs/77`), party split proposal (`_337`, awaiting external
review verdicts).*
