# 2026-07-02 — Timeline bulletproofing: audit, fixes, E2E suite — handoff to Opus

**Branch:** `feat/timeline_support` @ `2e9c192` (pushed). **Tests:** 66/66
(`cd marsin_engine && node --test tests/timeline_service.test.js`).
**CaptainPad:** `npx tsc --noEmit` + `npm run lint` clean (0 errors).
**New spec:** `.agent/00_gol/16_timeline_e2e_tests.md` (the E2E scenario
matrix S1–S10, AUTO/UNIT/HIL levels, stack setup, fixture rules).

## What landed today (all pushed)

- `ecb3127` — honest lock hint ("CONTROLS LOCKED", not "a touch takes over").
- `7ed905c` — orphaned `mode:'overridden'` self-heal (boot + tick); mixer
  header decrowd (lease chip + plan pill → floating PlanLockBanner).
- `a27dfe6` — festival-window-gated lock (`inFestivalWindow`,
  `festivalStartsInDays` on timelineState); PlanLockScrim (hermetic generic
  freeze — RN `pointerEvents:'none'` is escapable by children, a sibling
  scrim is not); TEMPORARY TAKE OVER in the banner (mixer variant also
  routes output → fixed master-goes-black); blue ViewTakeoverConfirm modal
  deleted; plan-view-only out-of-window note; clearer FIRE hints
  ("save to fire" vs "activate this plan to fire").
- `2e9c192` — 6 audit fixes: boot honors persisted activePlan (it used to RUN
  the config plan under the persisted NAME); lease cleared on every
  `overridden` exit + tick backstop; `hold()` supersedes a takeover; window
  OPENING re-pins per tick; `_forceDeckView` no-ops under overridden/paused;
  api_server boot seeds a persisted `'plan'` lock as soft (was an un-leased
  hard 'portwatch' brick).

E2E scenarios S1–S8 executed by hand with screenshots (in chat / this
session's `.agent_renders/e2e_s*.png`); all pass on `2e9c192`.

## Next step (planned, NOT started — this is the Opus work list)

Priority order; findings carry the 2026-07-02 audit IDs with the auditor's
suggested minimal fixes. Verify each file:line against current HEAD — lines
have shifted since the audit.

1. **Scripted E2E runner** per spec 16 "Wanted" section. This is the
   multiplier — do it first, then every later fix gets a cheap re-run.
2. **H4** — `savePlan` hot-reload's `_catchUp` kills a LIVE takeover lease
   (a maker SAVE re-locks the deck mid-manual-control). Preserve an
   unexpired lease across the save-path catchUp (boot path keeps current
   reset behavior).
3. **H5** — no serialization between `_tick` and REST mutators
   (savePlan/activatePlan/resume/fireCue/enableProgram can interleave with
   an in-flight tick's awaited deps). One promise-queue mutex
   (`this._op = this._op.then(fn)`) around `_tick` + public mutators.
4. **M4** — RN `<Modal>`s escape the PlanLockScrim (portals render above
   everything). Deck color picker's write path is guarded; the MIXER modals
   are not: `handleViewSelectionChange` (no `activationsLocked` gate), the
   channel-actions modal's Delete/Pin rows. Add `if (activationsLocked)
   return;` guards, or close all pickers on the `planLocked` rising edge.
5. **M1** — pending-program lease armed near midnight for a day-scoped cue
   loses its `hold` when promoted after the day flips (day-filtered
   `cueById` → `untilMs:null` → program holds forever). Resolve + store
   `hold`/`untilMs` at ARM time in `pendingProgram`.
6. **M2** — `fireCue` of a mood cue under manual control is a silent no-op
   `{ok:true, steps:[]}` (codex fail-loud violation). Return
   `suppressed:true` + record a `wouldFire`; CaptainPad toasts it.
7. **M6** — persisted mood bookkeeping (`moodArmed`/`prevMood`/`moodSince`)
   can fire a stale calm→party cue on the first post-boot tick. Reset them
   in `_catchUp` next to the lease resets.
8. **M3** — PANIC's `forceLit` writes `targetViewFader=1.0` under a deck pin
   without updating `savedTargetViewFader` → a later clear un-does the
   panic view. Sync or clear the pin in the panic path.
9. **M5** (decide with Sina first) — `takeover()` is unconditional; a stray
   POST against a paused plan resurrects it 120s later via lease release.
   Option: no-op unless `_isPlanDrivingDeck()`. Behavioral — confirm the
   out-of-window touch-to-takeover semantics before changing.
10. **L1–L4** (cheap): hide PlanLockBanner under the portwatch hard lock;
    order-token the REST reseed vs WS broadcast; clamp `hold()` minutes;
    `getState` masks 'paused' as 'holding'.
11. **C2 verification** — the persisted-'plan'-lock boot fix is
    reasoning-verified only (api_server has no unit seam). The audit's
    missing-test #3 (api_server boot-hydration matrix) needs a harness.
12. **HIL session** with Sina on the real iPad per spec 16's HIL column,
    after 1–7 land.

## Ready to test NOW (for Sina)

Yes — pull `feat/timeline_support` @ `2e9c192`, restart the engine, rebuild
the CaptainPad web app. Quick tour: from-scratch plan (starts today =
in-window) → save → activate → AUTO ON → deck+mixer freeze → TEMPORARY TAKE
OVER → countdown resets as you work → RESUME NOW → re-lock. Kill and restart
the engine mid-takeover: it comes back armed, on the RIGHT plan, re-locked.

## Message for Opus

Opus — the timeline core is in good shape: 66 unit tests green, the 3am
stuck-states from today's audit are fixed, and the E2E scenarios all pass by
hand. Your job is to make it STAY that way and finish the tail:

- Start with the **scripted E2E runner** (spec 16 tells you exactly what to
  build and where); it pays for everything after it.
- Then work the numbered list above in order — each item names the audit
  finding, the failure, and the minimal fix. Add a unit test per fix; the
  suite must stay green. Re-verify audit line numbers against HEAD before
  editing.
- Rules that bit us today, so you don't get bitten: never commit or revert
  `marsin_engine/config.yaml` / `marsin_engine/states/*` residue; never
  commit a generated in-window fixture plan (stale next day — spec 16);
  `exit code 144` from pkill in this environment is signal noise, retry the
  next command separately; rebuild the CaptainPad web bundle after ANY .tsx
  change or you'll test stale UI; and visually inspect every screenshot —
  a green DOM probe over a broken render is a fail.
- M5 and anything else behavioral: ask Sina, don't guess.
- Branch is `feat/timeline_support`; push there only. Leave a dated report
  next to this one when you hand back.

It's a good system now — make it boring. Have fun. — Fable, 2026-07-02
