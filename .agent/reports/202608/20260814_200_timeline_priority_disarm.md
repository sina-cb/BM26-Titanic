# _200 — Timeline priority over Live Touch, plan-disable hardening, performance-mode takeover passcode

Date: 2026-08-14 · Agent `_200` · Branch `feat/bm_readiness` (shared tree)

Four operator rulings, one coherent "timeline authority + lifecycle" bundle:

1. "The timeline 'resume' when live touch takes over needs to disarm and switch
   back to timeline when resume is pressed OR when the lease is expired — EVEN
   IF THE ARM IS ACTIVE. The timeline is high priority."
2. "Disarming the live touch should automatically resume the plan too."
3. "Take over in performance mode from the timeline needs to have either of the
   passwords we have for Sina, Muisha, or Sailors" … "pass code is required
   EVERY TIME."
4. "When the timeline plan is disabled or not enabled: no plan warning; the plan
   is ACTUALLY disabled; all active cues end right away. Make it bulletproof."

---

## 1. Current behaviour BEFORE the change — the ruling was NOT satisfied

### 1a. RESUME pressed while a Live Touch ARM is active

`POST /timeline/resume` (`marsin_engine/lib/api_server.js:8118`) called
`timelineService.resume()` and **nothing else**. It never touched the ARM lease,
`liveTouchTimelineTakeoverOwner`, the Live session, or the layer router.

Worse, the request usually never reached the handler at all:
`rejectTouchControlLeaseConflict` (`api_server.js:5264`) **423s every untagged
mutating HTTP request while a desk is armed** (`TOUCH_CONTROL_LEASE_HELD`). So
an armed Live Touch desk locked the operator out of RESUME entirely — Live Touch
held the show hostage through the lease gate before any disarm logic existed.

If the request did land (owner-tagged), the outcome was a half-resume:

- `resume()` → `_catchUp()` → `_forceDeckView()` → `activateLayerSettingInternal(DECK, reason:'timeline_deck_pin')`.
- That reason is explicitly special-cased at `api_server.js:4723` to **skip**
  `pendingLiveTouchReleaseOwner`, i.e. the ARM was deliberately retained.
- The param-centre source lock taken at ARM
  (`armLeaseSet`, `api_server.js:5000` — `setSourceLock({mode:'global',source:'api'})`)
  stayed held, so every catchUp colour/speed write bounced with reason
  `source_lock` — the exact failure the deadman revert documents at
  `api_server.js:4671-4680`. The deck pin came back; the show stayed frozen.
- Live brightness authority (`LiveBrightnessController`) kept scaling output.

### 1b. Timeline operator lease expires while ARM is active

Tick → `_releaseOperatorLease()` (`lib/timeline/timeline_service.js:3349`) →
`_catchUp()` → same `timeline_deck_pin` path → same retained ARM, same held
source lock. Additionally `liveTouchTimelineTakeoverOwner` stayed set, so
`noteLiveTouchTimelineActivity` (`api_server.js:5201`) re-took the timeline over
on the next Live mutation — an automatic re-seizure with no operator gesture.

### 1c. ARM (panel deadman) lease expiry — the only path that mostly worked

`sweepArmLeases` → `revertToAutomaticShow` (`api_server.js:4615`) did clean up,
but as a **second, partial cleanup variant** rather than the normal disarm path,
and it resumed the plan only when the Live owner happened to hold
`liveTouchTimelineTakeoverOwner`.

### 1d. Clean disarm left the rig in limbo

`armLeaseClear` (`api_server.js:5026`) explicitly documented "do not call
resume()". Armed → disarmed landed in a state where the plan was enabled but
paused, waiting for a human to press RESUME.

### 1e. "Plan disabled" was not disabled

- `setAutopilotEnabled(false)` (`timeline_service.js:3361`) did a partial
  teardown: `if (!this.state.activeProgram) this.state.controller = 'manual'`.
  With a program running, the controller stayed `'program'` → `planActive`
  stayed **true** → the plan banner, scrim and deck-pin all stayed up on a plan
  the operator had just switched off, and the cue kept running to its natural end.
- The tick had **no** `autopilotEnabled` gate. `arbitrate()` (`lib/timeline/arbiter.js:85`)
  treats "autopilot off + no program" as `manual`, which **arms a pending-program
  lease** for any due program — and that lease **auto-starts the show ~30 s
  later** (`arbiter.js:88-103`). A disabled plan seized the rig.
- `_catchUp()` re-applied cue looks on boot regardless, so restarting with the
  plan disabled came up with a cue on the deck.
- `planActive` was a hand-copied duplicate of `_isPlanDrivingDeck()`
  (`timeline_service.js:1750` vs `:2628`) — two expressions, one meaning.

**Verdict: the ruling was not satisfied on any of the four points.**

---

## 2. What changed

### 2.1 Timeline priority (rulings 1 + 2)

**`lib/timeline/timeline_service.js`**
- New `_yieldLiveTouchToPlan(why)`; called FIRST in `resume()` and in
  `_releaseOperatorLease()`. Calls the optional dep `deps.yieldLiveTouch(why)`,
  catches everything, records `lastError`, and lets the plan proceed regardless.
- Deps doc block documents `yieldLiveTouch(why)` as "must never throw".

**`lib/api_server.js`**
- `forceDisarmLiveTouchForTimeline(why)` — the dep implementation. Wired as
  `yieldLiveTouch` next to `getViewOverrideMode`.
- `armLeaseClear(ownerId, why, { force, resumePlan, deferSessionEnd })` — the
  **same** function, same steps, same order. `force` only wraps the two fallible
  steps (brightness reset, session end) so neither can abort the release; the
  lease deletion, source-lock restore and client notification always happen.
- `resumeTimelineAfterDisarm(why)` — called at the end of every `armLeaseClear`
  and from `revertToAutomaticShow`. Armed → disarmed now has exactly two landing
  states: **plan enabled → plan running**, **plan disabled → no-plan idle**.
  `resumePlan:false` only for stale-holder eviction (a new panel is arming in
  the same breath) and for the force-disarm itself (it is already inside
  resume()/lease-release; re-entering would recurse).
- New WS broadcast `liveTouchForceDisarm { ownerId, why, source:'timeline',
  autoRearm:false }`, registered in `lib/ws_topic_routing.js` (CONTROL topic —
  an unregistered type throws, which is how this was caught).
- `/timeline/resume` and `/timeline/autopilot` added to
  `TOUCH_CONTROL_EMERGENCY_PATHS` so an armed desk can never 423 the operator
  out of handing the rig back or switching the plan off. `/timeline/takeover`
  stays gated — only the paths that GIVE the rig back are exempt.

**Cleanup ordering decision (justified from the code, not preference):**

*Cleanup first, then the visual landing, then the caller's catchUp.*

The source lock taken at ARM makes the CPC reject every timeline/autopilot write
with reason `source_lock`. A catchUp run before the release would apply
**nothing** — releasing the lock is a *precondition* of the takeover, not a
tidy-up after it. The hostage risk is therefore removed by making the disarm
**unabortable** (`force:true` — every fallible step individually guarded and
loud) rather than by reordering. The layer lands on DECK, the same mission-safe
destination the deadman revert uses.

One exception the render loop forces: `engine.js:722` **throws and exits** if the
`live_touch` layer renders with no active owner-scoped session. So while Live is
still on air the session is handed to the outgoing blend via the existing
`pendingLiveTouchDeadmanOwner` marker (`deferSessionEnd:true`) and ended by the
existing completion hook on the landing frame — the same handback the panel
deadman already uses. Everything else (brightness, ARM lease, source lock) is
released immediately. **This was found by a real engine crash during testing**,
not by inspection.

### 2.2 Plan disabled = totally inert (ruling 4)

**`lib/timeline/timeline_service.js`** — all with prominent invariant comments
the operator asked for:

- **`planEnabled()`** — the authoritative "is the show plan switched on".
- **`_isPlanDrivingDeck()`** — the ONE "plan is driving" predicate; now includes
  `planEnabled()`.
- **`getState().planActive` is now literally `this._isPlanDrivingDeck()`** — the
  duplicated expression is gone. Every plan banner/scrim/lock in every client
  derives from that one field, and the `'plan'` controlLock derives from the same
  predicate via `_reconcileDeckPin`.
- **Tick plan-disabled gate**, beside the festival-window gate and before
  sequence advance / evaluate / arbitrate / dispatch / baseline / deck-pin.
  This is what stops a disabled plan arming and auto-starting a program.
- **`_catchUp` plan-disabled gate** — a restart with the plan off boots cue-free
  and stays that way; resume/lease-expiry cannot resurrect a disabled plan.
- **`setAutopilotEnabled(false)` now runs `_goDormant()`** — the ONE shared
  teardown, not a bespoke partial. It ends the active program, drops the pending
  lease, clears the deck-ownership latches, books the party session end, clears
  the takeover lease/`overridden` mode, disarms the baseline and releases the
  deck-pin. That is exactly the natural cue-end work, executed now. It
  deliberately does **not** load a replacement look: a disabled plan drives
  nothing, so the rig keeps whatever the operator has on it (the same thing the
  engine does out of the festival window — no fallback guessing).
- `_goDormant`'s doc block is rewritten as the load-bearing teardown contract
  with both callers named, and states it is idempotent and safe to fire
  redundantly (the tick does exactly that every disabled tick).

**Interaction with part 1:** `resumeTimelineAfterDisarm` checks
`timelineService.planEnabled()` and logs loudly when it declines. Disarming with
the plan disabled lands in ordinary no-plan idle.

### 2.3 Performance-mode takeover passcode (ruling 3)

The three named principals **already exist** in
`marsin_engine/lib/captainpad_auth.js:11-15`: `owner` → `SinaAuth`,
`collaborator` → `MishaAuth`, `bringup` → `MARITIME_TERM_FOR_SAILIOR_PASS` —
Sina, Muisha (Misha), Sailors. Provisioned exclusively from the external
`$BM26_SECRETS` YAML. **No new storage location was invented.**

- **`captainpad_auth.js`**: extracted the single credential check into
  `checkPassphrase()` (rate-limit gate → constant-time compare → failure
  bookkeeping) and added **`verifyPassphrase(passphrase, remoteKey)`**, which
  runs it and **issues nothing**. `authenticate()` now calls the same primitive,
  so the lockout policy cannot diverge (existing policy kept verbatim: 5
  failures per rolling minute → 60 s lockout, keyed by remote address).
- **`api_server.js`**: `checkTakeoverPasscode(req, what)` /
  `rejectTakeoverWithoutPasscode(req, res, what)`. Reads the passcode from
  `X-CaptainPad-Passcode` (added to CORS `Access-Control-Allow-Headers`).
  Gated call sites — all three ways to take the rig FROM a running plan:
  1. `POST /timeline/takeover`
  2. `POST /layers/setting|activate` with `target:'live_touch'` while
     `controlLock === 'plan'` (the Live Touch takeover of the plan)
  3. the implicit re-takeover inside `noteLiveTouchTimelineActivity` — refused
     with the same status/code through the response wrapper.
- **EVERY TIME**: the gate deliberately never inspects `x-captainpad-session`.
  A live 30-minute privileged session, a remembered device, or a takeover
  authorised seconds ago buys nothing.
- **Performance mode OFF → no gate**, byte-identical to before. With privileged
  auth disabled (`BM26_CAPTAINPAD_AUTH_REQUIRED=0`, isolated engine/test mode)
  the gate is inert — the same precedent the performance-mode EXIT gate already
  sets, documented in the code.
- **Reverse direction is never gated.** Resume / lease expiry force-disarm cost
  nothing. Stated in comments at both the gate and the force-disarm.
- **No credential material** in code, config, tests, logs or error bodies. A
  rejected attempt logs only the failure code; the tests assert the engine's own
  stdout contains none of the test passphrases.

### 2.4 Client side

- **`docs/ui/touch_control_wire.js`** — this file (not CaptainPad) owns the Live
  Touch "am I armed" state machine. New `liveTouchForceDisarm` handler beside the
  existing `armRevert` one: filters on `ownerId`, calls the existing
  `forceDisarmedUi()`, and reports *"TIMELINE RESUMED — the show plan took the
  rig back … press ARM to take control again."*

  **No auto-re-arm, behind two independent barriers** (verified by reading the
  reconnect handler at `docs/ui/touch_control_wire.js:3901-3923`):
  `forceDisarmedUi()` clears `state.armed`, and the reconnect path is gated on
  `if (state.armed)` — so it never fires. Even if it did, it re-verifies with
  the engine first (`GET /layers/state` → `liveTouch.armed && ownerId === OWNER`)
  and calls `forceDisarmedUi()` + fails closed when the engine disagrees, which
  is exactly the post-force-disarm state.
- **`CaptainPad/app/(tabs)/index.tsx`** — the Deck inline chip claimed
  "PLAN LIVE · CONTROLS LOCKED" from `planActive && !leaseHeld` while the
  controls were actually gated on `planGate = planLocked && !leaseHeld`. Two
  predicates for one claim. Now driven by `planGate`, with a comment naming the
  engine-side single source. `useOperatorTakeover()`'s `planActive` is no longer
  destructured there.

---

## 3. Test results

Baseline established **before** any change (this integrated tree was
uncharacterised): `tests/effects/*` + `tests/timeline/*` → **1009 tests, 1009
pass, 0 fail**.

**After** (`tests/effects` + `tests/timeline` + `tests/io` + `tests/security`):
**1236 tests, 1236 pass, 0 fail.**

`tests/e2e` + `tests/state` + `tests/mixer`: **801 tests, 796 pass, 5 fail** —
all five are `dev_test_bench: …` in `tests/mixer/all_models_load_lint.test.js`
(`groupBits out of sync with model — stale: [ParLights, VintageLights,
BarLights, LED_0]`). **Pre-existing and unrelated** — a model-sidecar drift from
another session's work in this shared tree; nothing in this change touches
`models/` or the model loader.

`CaptainPad`: `npx tsc --noEmit` clean.

### Tests updated (superseded contracts, not weakened coverage)

Four timeline tests reached "manual" via `setAutopilotEnabled(false)` to exercise
the pending-program lease. Under the new ruling a disabled plan arms nothing, so
they now reach manual via `svc.takeover()` — which is what the pending-lease
feature is actually for ("the show goes on even during a takeover"). Coverage of
the lease/auto-start/dismiss behaviour is fully retained.
`tests/effects/live_touch_timeline_takeover_api.test.js` had its second half
rewritten: the lease-expiry-then-reacquire and the "clean handback preserves the
takeover" assertions encoded exactly the behaviour the operator overruled.

### Tests added

- **`tests/timeline/timeline_plan_disabled.test.js`** (9): disable ends an active
  program immediately; disable clears the pending lease and none can arm while
  disabled; a disabled plan fires no cues and raises no deck-pin; the transition
  is idempotent under redundant fires; **a disable landing mid-cue-fire cannot
  leave a half-active cue**; an engine restart with the plan disabled boots
  disabled and cue-free; `planActive` is exactly `_isPlanDrivingDeck()` across
  enabled/taken-over/disabled/re-enabled; resume and lease expiry never resurrect
  a disabled plan; the `yieldLiveTouch` dep fires on both paths and a throwing
  dep never blocks the plan.
- **`tests/effects/live_touch_timeline_priority_api.test.js`** (3, real engine on
  a random high port with black-holed sACN): RESUME force-disarms an active ARM →
  `liveTouchForceDisarm` WS frame with `autoRearm:false` → ARM gone → plan
  driving → the disarmed owner 409s and cannot re-arm itself; PANIC/blackout
  still reachable with no owner header while armed; performance-mode takeover
  refused without a passcode, refused with a wrong one, **refused with a valid
  session token**, authorised by each of the three principals with **a fresh
  passcode required for each consecutive attempt**, reverse direction never
  gated, and no passphrase anywhere in the engine's output.
- **`tests/effects/live_touch_timeline_takeover_api.test.js`**: lease-expiry
  force-disarm (WS notice, ARM gone, plan driving, stale writes 409, no
  auto-re-arm) and clean disarm auto-resuming the plan.
- **`tests/security/captainpad_auth.test.js`** (+4): `verifyPassphrase`
  authorises all three principals and issues no session; an active privileged
  session is not a substitute; shared lockout policy and no secret echoed; with
  auth disabled it refuses rather than guessing.

Ports: every spawned engine uses the existing harnesses' high-port ranges
(7100-7400 / 7500-7900) with `--dest 127.0.0.9`. Nothing touched 6966-6972,
5568, 8081 or 10000.

---

## 4. What the operator should test live (after the next engine restart)

Code changes reach the live stack only when the operator restarts the engine.

1. **Resume beats ARM.** Plan running → ARM the Live Touch panel and take the rig
   → press RESUME in CaptainPad. The panel must drop to DISARMED by itself and
   say "TIMELINE RESUMED — the show plan took the rig back". The deck comes back
   and the plan's colours/speed change again (the old bug left them frozen).
2. **Lease expiry beats ARM.** ARM, go on air, then stop touching the panel for
   the operator-lease window. Same outcome, unprompted.
3. **Disarm resumes the plan.** ARM, then plain-DISARM. The plan should be
   running again with no RESUME press.
4. **No auto-re-arm.** After any of the above, the panel stays disarmed until
   ARM is pressed; its controls report the desk is not armed.
5. **Plan disabled is really disabled.** With a cue/program running, press AUTO
   OFF on the timeline tab. The cue must stop immediately, the yellow plan banner
   and the Deck "PLAN LIVE · CONTROLS LOCKED" chip must vanish, and deck/mixer
   controls must be live. Wait past a scheduled show's time — nothing should
   auto-start. Restart the engine — it must come up still disabled and cue-free.
6. **Performance-mode takeover passcode.** Enter performance mode, then try to
   take over from the timeline (timeline TAKE OVER, or ARM Live Touch while the
   plan holds the pin). It must refuse without a passcode. Note: **CaptainPad
   does not yet prompt for it** — see the gap below.
7. **Panic unchanged.** Blackout / panic-stop still work instantly while armed.

---

## 5. Gaps and follow-ups (not done here)

1. **CaptainPad has no takeover-passcode prompt.** The engine gate is in and
   tested, and `PrivilegedAuthSheet` (`CaptainPad/components/privileged_auth_sheet.tsx`)
   already collects a passphrase — but it is only mounted from
   `PerformanceModeControl` and posts to `/captainpad/auth/login` (session).
   The takeover flows (`PlanLockBanner` TAKE OVER, `mixer.tsx:1436`
   `handleMixerTakeover`, and the Live Touch ARM path) need to open that sheet
   per attempt and send the entered passphrase as `X-CaptainPad-Passcode`
   **without** creating a session. Until then, performance-mode takeover from
   CaptainPad will be refused with `TAKEOVER_AUTH_REQUIRED`. This is the single
   highest-priority follow-up.
2. **Remaining CaptainPad plan-predicate duplication.** Fixed the Deck chip.
   Still independently derived (each verified by reading the file):
   `ViewOverrideBanner.tsx:50` keeps a *second private subscription* to
   `viewOverride.controlLock` (`useState`) instead of using `useEngineLock`;
   `utils/layer_settings.ts:138` `mixerFocusMayActivate(planActive, leaseHeld)`;
   `timeline.tsx:219` `ControllerPill`. None of them misbehave once the engine
   reports `planActive:false` on disable — which is now guaranteed — but they
   should be collapsed onto one hook. Deliberately not refactored mid-show-prep.
3. **`leaseHeld` can be true with `operatorLease === null`**
   (`useTimeline.ts:492` — `const leaseHeld = !!lease || state?.mode === 'overridden'`),
   so `PlanLockBanner` can render "resumes 0:00". Cosmetic; pre-existing.
4. **Pre-existing `dev_test_bench` model lint failures** (5) in
   `tests/mixer/all_models_load_lint.test.js` — belongs to another session's
   model work in this tree.

---

## 6. Shared-tree note

Every file was re-read immediately before editing. Files touched:
`marsin_engine/lib/api_server.js`, `lib/timeline/timeline_service.js`,
`lib/captainpad_auth.js`, `lib/ws_topic_routing.js`,
`tests/timeline/timeline_service.test.js`, `tests/timeline/timeline_event_log.test.js`,
`tests/timeline/timeline_plan_disabled.test.js` (new),
`tests/effects/live_touch_timeline_takeover_api.test.js`,
`tests/effects/live_touch_timeline_priority_api.test.js` (new),
`tests/security/captainpad_auth.test.js`, `docs/ui/touch_control_wire.js`,
`CaptainPad/app/(tabs)/index.tsx`. No foreign content reverted. No git
operations. `scenes/**`, `states/**` and `patterns/**` untouched.
