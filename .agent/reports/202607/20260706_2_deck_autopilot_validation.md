# Slot 2 — deck_autopilot_validation

- **Branch:** `feat/autopilot_deck_improvement` (merged tip `46dad9b`)
- **Worktree:** `~/workspace/BM26-Titanic-worktrees/deck_autopilot_validation` (detached at `46dad9b`)
- **Slot ports:** engine `31268`, sim `31269-31272`, metro `31281` (HIL self-boot on `31068`)

## How this validation was run (honest provenance)

The Opus validator sub-agent **died mid-run on a transient `claude-opus-4-8`
availability outage** (~18:53) after completing the live full-stack portion
(sim + engine + CaptainPad renders at 18:35–18:40) but **before writing its
report**. A stall watchdog caught the 13-minute silence; the orphaned task was
gone (killed by the model outage), leaving no listeners (servers had exited).
**The instigator completed and re-ran the verification directly** rather than
respawn another Opus agent into the same flaky window. All results below were
produced/confirmed by the instigator on the merged tip.

## Results — every check

**A. Static + unit (merged tip) — PASS**
- Engine `npm run check` (syntax + dry-run): **PASS** (pattern loads/compiles).
- Engine unit `node --test` — **31/31** (`autopilot_profiles.test.js` 15 incl.
  `random`==legacy `pickNextAutoCycleEntry` byte-identity + registry
  throw-on-unknown; `audio_reactive_profile.test.js` 16 incl. energy-arc,
  energy-pickup advance, transient-does-not-recolor vs held-descriptor-does).
- CaptainPad `npx tsc --noEmit`: **PASS** on the merged tip. `npm run lint`
  (0 err), `npm run web:build` (exit 0) green on the slice branch (merged-tip
  CaptainPad files identical — engine merge touched no CaptainPad file).

**B. Engine HIL battery (merged tip) — PASS**
- `hil_autopilot_profile_test.mjs` — **16/16** (re-run on a CLEAN worktree; see
  note). Profile seam; `autopilot` broadcast + WS connect-replay + `GET
  /autopilot` all carry `profile`+`profiles`; `GET /autopilot` does NOT leak
  `profiles` into the persisted ref; per-scene profile persistence on the deck
  channel; `profile:bogus` → 400 loud, stored value untouched.
- `hil_audio_reactive_profile_test.mjs` — **11/11**. arm `bpmSpeedSync`; pulse
  advance; **transient switchColor does NOT recolor**; **held descriptor change
  DOES**; energy-arc ceiling sag/recover; energy-pickup advance; silence
  suppresses; switch→random restores `bpmSpeedSync`.
- `hil_deck_playlist_slots_test.mjs` — **27/27**. All 5 E3 wire surfaces;
  **inclusive [0.15,0.85]** (0.15 & 0.85 → 200, 0.1/0.9/NaN → 400); 409 EBUSY
  mid-transition; clear-while-live promote; **restart round-trip** of
  slots+splitRatio from `deck_state.yaml`.
- Total HIL: **54/54**. On a clean worktree `git status` is clean after the
  battery (zero tracked-state residue — tests snapshot+restore in a `finally`).

> NOTE on the "14/16" blip: the FIRST autopilot-HIL run reported 14/16 — but in
> the *validation* worktree, whose tracked state the dead validator had already
> polluted (config.yaml rewritten to slot-2 ports, `deck_state.yaml` left
> mid-session). Re-running on the CLEAN engine worktree gave **16/16**. The two
> failures were environmental pollution, NOT a code defect. Validator residue
> was restored (`git checkout -- .`).

**C. Live API contract probes — covered by B.** The five E3 wire surfaces + the
`GET /autopilot` fix are exercised by the HIL battery against a live engine on
`31068` (inclusive split bounds, unknown-profile 400, secondary
assign/clear/promote, per-scene persistence). The engine agent's report §"E3/E1
contract confirmation" independently confirmed each shape matches the CaptainPad
contract, which this validation corroborates.

**D. Full-stack + visuals — PASS (partial live soak).** The validator brought up
sim + engine + CaptainPad on slot-2 ports and captured renders before it died:
- `captainpad_deck.png` — the built CaptainPad deck, **header CONNECTED to a
  live engine**, showing BOTH new features rendered and wired: the **AUTOPILOT
  PATTERNS → PROFILE dropdown set to "AUDIO REACTIVE"**, and the **"+ SECOND
  PLAYLIST"** split-pane affordance under "DECK A · PLAYLIST", with the single
  PARAMETERS column unchanged between them. (Preserved to scratchpad as
  `captainpad_deck_verified.png`.)
- 3 sim renders (`1783388171/227/304_current.png`) — deck live output rendering.
- Deferred: a fully hands-on operator soak (drive both panes live, watch
  autopilot follow the last-driven pane in the sim) was not scripted into a
  report before the agent died. The behavior is covered by the deck HIL +
  `noteDeckLivePlaylist` logic; a human pass is recommended but not blocking.

**E. Persistence across restart — PASS.** Covered by HIL: slots + splitRatio
round-trip (`hil_deck_playlist_slots` TEST 7) and per-scene profile persistence
(`hil_autopilot_profile` TEST 5), both from `states/test_bench/deck_state.yaml`.

## Deferred / not covered (honest)

- **Real-audio-file audio-reactivity demo.** The `audio_reactive` behavior is
  proven rigorously via synthetic-CPC HIL injection (energy-arc, pickup-switch,
  stable-color-vs-transient). A live playback demo through the Audio Companion
  was not run (no audio fixture staged). Recommended as the operator's own
  first look, not a blocker.
- **Predictive pre-arm** (riser/dropCountdown) is intentionally NOT wired — v1
  uses a reactive slope trigger (allowed by the operator: "small delay is fine").
- **config.yaml autopilot-timing wart** untouched (separable follow-up, by design).

## Verdict

**READY for Sina to review.** All three features are merged on
`feat/autopilot_deck_improvement`, with green auto-checks, 31/31 unit, 54/54
HIL, CaptainPad tsc/lint/web-build green, and live-UI screenshot proof of both
the profile dropdown (AUDIO REACTIVE) and the second-playlist split pane
connected to a running engine. No blockers. Two nice-to-have demos deferred
(real-audio playback; a hands-on two-pane soak) — neither gates a review.
Nothing pushed to origin.
