# 357 — Timeline tab review: findings and improvements (review only)

Reviewer: Fable (read-only; saved verbatim by the coordinator). No code was
changed from this review — it is for the operator to triage. Scope: CaptainPad
Timeline tab (LIVE, CALENDAR week+DAY, TIME TRAVEL, EDIT PLAN incl. cue editor,
party-window editor, plan picker, zoom banner, plan-lock banner) and the engine
timeline service behind it, plus the tracked `playa_default` plan. The PARTY
card / chips / NOW card / engine party logic reworked under report `_356` were
checked only for gaps against that spec.

## A. Executive summary

1. The `_356` party rework reads as implemented to spec: one window predicate
   (`party_window.js`), `deckOwner`/`partyWindow` on `/timeline/state`, strict
   pad parsing, button matrix in `partyButtonRules`, engine-first RETURN,
   mutation/tick serialization. No contradictions found between spec and code;
   one gap (T-22) on how a cue error is surfaced outside the party card.
2. Two P0s live in EDIT PLAN and would damage the real festival plan the first
   time it is edited on the playa: the cue editor forces a 30-second
   `durationMin` onto every saved cue (turning hold-governed program cues and
   open-ended ambient cues into 30-second blips), and opening the real plan's
   party cue converts its sunrise-anchored window into a clock window starting
   "five minutes from now" on save.
3. A P1 trust bug in the engine: `nextCue` / `cues[].nextInSec` ignore each
   cue's `days:`, so on every non-burn night the header, NOW-card range and
   plan-lock banner announce "next: Burn night / Temple burn" while the NEXT
   list (overview-driven) says something else.
4. Destructive actions lack confirmation: delete cue (two paths) and ACTIVATE
   PLAN. With autosave + hot reload, a mis-tap on the trash icon rewrites the
   live show within a second.
5. Pre-festival and post-festival views mislabel: the header day and the NEXT
   list fall back to festival day 0 as if it were today.
6. Time Travel copy promises "paused until RESUME LIVE"; the engine lease drops
   it after 120 s without a touch.
7. The event log (`recentFires`) and per-cue errors are no longer visible
   anywhere in the tab; roughly 1,150 lines of `timeline.tsx` (the old
   single-page UI, including a second party-config section) are unreachable
   dead code.
8. The real plan's party window does not render as a party window on the week
   strip or DAY view because the pad keys off the maker's `pw_` naming.
9. Several silent catches and one documented fallback
   (`snapshotDeckAsDefaultCue`) violate the no-fallback rule.
10. Test coverage is strong on the party contract and zoom logic, thin on the
    cue editor's round-trip of legacy cues, on `nextCue` applicability, and
    there is no dry-run assertion spec for `playa_default`.

## B. Findings

| id | sev | area | file:line | what is wrong | why it matters | suggested fix |
|---|---|---|---|---|---|---|
| T-01 | P0 | EDIT PLAN / cue editor | `CaptainPad/components/timeline/CueEditorSheet.tsx:447-451`, `cue_edit_logic.ts:36,286`; engine `marsin_engine/lib/timeline/timeline_service.js:1026-1032,1276-1300` | Editing ANY existing cue seeds `durationMin` = 0.5 when the cue has none and `assembleCue` always emits it. The engine treats `durationMin` as a hard boundary: ambient cues hand the deck to the default cue after 30 s; a program's hold is cut at the window end (`ownWindowElapsed`, 1289-1300). Every cue in `playa_default` has no `durationMin`. | Changing a palette on "Deep night 1" or "Ignition" from the pad silently turns a night-long cue into a 30-second flash followed by the default look. Autosave makes it live immediately. | Editor: offer "No window (hold / until next cue)" and never emit `durationMin` for a cue that loaded without one; pin with a test. Engine: lint `durationMin` + `hold` on the same cue as a warning. |
| T-02 | P0 | EDIT PLAN / party window editor | `CueEditorSheet.tsx:385,420-461,788`; `party_window_logic.ts:96-105,129-227` (phase deletion 219-221); `cue_edit_logic.ts:190-192` | `isPartyCueTrigger` matches the real plan's `c_mood_to_party`, so the editor opens it as a Party Window. `partyWindowSeed` returns null (end anchor is `sun: sunrise -120`, not a clock), so the editor seeds start = now+5 min, length 240 min. SAVE runs `planWithPartyWindow`, which deletes the authored `party_window` phase, adds `pw_…`/`pwb_…`/`pwe_…` cues, and pins a clock window. | The sunrise-anchored eligibility window of the real show is replaced by a fixed 4-hour window anchored at whatever time the operator happened to tap EDIT. Nothing warns. | Refuse to open a party cue whose seed is null (same pattern as sequence cues, `timeline.tsx:1113-1119`) with an explicit message, or support sun anchors in the seed/editor. |
| T-03 | P1 | Engine `/timeline/state` → LIVE header, NOW range, plan-lock banner | `timeline_service.js:3372,3399-3407`; consumers `utils/timeline_operator_model.ts:136-145`, `components/plan_lock_banner_logic.ts:67-72` | `getState()` resolves `dayTimes` over `this.plan` (all cues) and picks `nextCue` without `cueAppliesOn`. `c_burn_night` (`days:[6]`) and `c_temple` (`days:[7]`) therefore become "next" every evening between first-color and early-night. | Three surfaces say "until Temple burn — reverent 20:25" on an ordinary night; the NEXT list (overview-driven, per-day) disagrees. Operator trust in the countdown collapses. | Build `cues[]`/`nextCue` from `_runtimeCuesAt(now)`; add an engine test with a `days:[6]` cue on day 2. |
| T-04 | P1 | EDIT PLAN / DAY view + cue editor | `DayView.tsx:552-560`, `CueEditorSheet.tsx:1408-1412`, `timeline.tsx:1094-1102,921-954` | Trash icon and DELETE button call `handleDeleteCue` with no confirmation; autosave writes ~700 ms later and the engine hot-reloads the active plan (`timeline_service.js:4106-4122`). | One mis-tap at 3 a.m. removes a night cue from the live show; no undo. | `opConfirm` (destructive) naming the cue and "this edits the LIVE plan" when `draft.name === activePlan`. |
| T-05 | P1 | EDIT PLAN / plan picker | `PlanPickerSheet.tsx:205-213`, `timeline.tsx:867-877`; engine `timeline_service.js:4171-4176` | ACTIVATE is one tap, no confirm. Engine clears `firedToday`, the event ring and cue errors, then re-runs catchUp on the rig. | Easy to activate a test plan over the show plan from the same list that holds DUPLICATE/DELETE. | Confirm with outgoing → incoming names; keep DELETE's two-tap pattern. |
| T-06 | P1 | EDIT PLAN / festival editor | `timeline.tsx:1037-1055` (1051) | Removing the last festival day rewrites any cue whose only day was removed to `days:'all'`. | A one-night special (burn/temple) becomes an every-night cue without the operator being told. | Block the removal naming the affected cues, or drop them with a loud message; never widen scope silently. |
| T-07 | P1 | LIVE header + NEXT list | `timeline.tsx:663-668,1822`, `timeline_operator_model.ts:291-304` | When today is outside the festival span `liveToday` falls back to day 0; the header shows day 0's weekday and `upcomingTimelineCues` lists day 0's cues with `relativeDay 0` (bare times, filtered by "later than now"). | Pre-festival setup days and the morning after strike show a fake "today". | Return null/empty outside the span; NEXT shows "festival starts in N days" from `state.festivalStartsInDays`. |
| T-08 | P1 | Alert ladder | `utils/timeline_alert_model.ts:132-148`; `timeline.tsx:702-704` | `activePlanHotReload` ("EDITING ACTIVE PLAN! :)", empty detail) ranks above `saveError`, so DRAFT NOT SAVED never shows while editing the active plan (only the small chip). Copy is placeholder. | The most important save failure is hidden exactly when edits go live. | Put save errors above hot-reload; real copy ("Edits apply to the LIVE show on save"). |
| T-09 | P1 | TIME TRAVEL | `timeline_travel_view.tsx:266`, `timeline_alert_model.ts:128`, `timeline.tsx:1769`; engine `config.yaml:335`, `timeline_service.js:3046-3056,2374-2383`; `ZoomBanner.tsx:113-118` | Copy says the rig stays in Time Travel "until RESUME LIVE"; the travel lease is the 120 s operator lease and expires without app touches, then the plan resumes and the banner says "Zoom ended". | Operator walks to the bow to look at the rehearsal; two minutes later the ship changes under them. | Copy: "until RESUME LIVE or 2 min without a touch"; show the lease countdown in the travel view; consider a longer lease for `scope:'travel'`. |
| T-10 | P1 | CALENDAR week strip + DAY view | `DayOverviewStrip.tsx:52-53`, `DayView.tsx:241-252`, `party_window_logic.ts:72-77` | Party window bands and purple cue colour are gated on the `pw_` prefix. The real plan's phase is `party_window` and its cue's `whenPhase` is not `pw_…`. | The real show's party window is invisible on the strip and unlabelled in DAY; the cue reads as a generic cyan mood marker. | Detect the window via "phase referenced by a `mood→party` cue's `whenPhase`" (the predicate `isPartyWindowImplementationCue` already does this). |
| T-11 | P1 | LIVE / EDIT data loading | `timeline.tsx:533-542,770-779,153-175` | `refreshPlans`, `refreshLiveOverview`, `autoLoadActiveIntoDraft` drop errors; `nowPartsInTz` swallows. | Overview failure leaves NEXT/ON DEMAND/calendar silently stale or empty with no banner. | Route failures to `setActionError`; treat a null `nowInTz` as an alert. |
| T-12 | P1 | Engine + LIVE / diagnostics | `timeline_service.js:3241` (`lastError = null` after any successful dispatch); `recentFires`/`cues[].lastError`/`wouldFire` consumed only in dead code `timeline.tsx:2556-2571,3178` | A cue that failed (missing playlist, palette) is reported via `lastError`, which is wiped by the next successful dispatch; the EVENT LOG and per-cue errors are not rendered anywhere in the new tab; suppressed fires (`wouldFire`) never shown. | A failed 23:30 cue is forgotten by 01:00; no way to review what fired overnight. docs/78 asks for the log collapsed in EDIT PLAN. | Add an EVENT LOG / DIAGNOSTICS section (collapsed) to LIVE or EDIT PLAN; list cues with `lastError`; keep `lastError` until acknowledged. |
| T-13 | P1 | EDIT PLAN | `timeline.tsx:761-791,2073-2075`; engine `timeline_service.js:4091-4122` | The tab auto-loads the ACTIVE plan into the draft and autosaves every valid change, which hot-reloads the live show; header says "Draft preview only. Autosave writes every valid change". | "Preview only" and "writes every change" contradict; the operator can believe edits are rehearsal. | Header: "EDITING THE LIVE SHOW — saves apply immediately" when draft === active; offer "edit a copy" as the default at show time. |
| T-14 | P2 | `timeline.tsx` | `timeline.tsx:2158-3310` (+ imports 47-141); all four views return earlier (`TimelineOperatorView`, `timeline_operator_model.ts:10`) | ~1,150 lines unreachable: legacy header, AUTO/PLANS buttons, `PartyModeSection` (own 5 s poller), `CueRow` with FIRE, `EventLogRow`, `ControllerPill`, `MoodPill`. | Maintenance hazard; reviewers (and agents) edit code that never runs. | Delete, after lifting the event-log row into T-12. |
| T-15 | P2 | LIVE NOW card actions | `timeline_live_view.tsx:194-208`, `timeline.tsx:1651-1652` | TAKE OVER / PAUSE PLAN render enabled with no active plan; PAUSE silently returns. Engine takeover out-of-window returns `{ok:true, operatorLease:null}` (`timeline_service.js:4289-4291`) and the pad then says takeover "now controls Deck output" (`timeline.tsx:1582-1584`). | Button lies about its effect. | Disable both when no active plan / plan not active; treat `operatorLease:null` as "nothing armed". |
| T-16 | P2 | EVENT sheet | `EventSheet.tsx:163-167` | "owns the deck · until the next cue" is shown for program cues that carry a `hold`. | Misstates the real plan's hold windows. | Show hold (`min`/`until`) when present. |
| T-17 | P2 | TIME TRAVEL | `timeline.tsx:482`, `utils/timeline_travel_model.ts:14-22` | Default target time is the pad's device clock, not the plan tz. | Wrong only off-playa, but the rest of the tab is tz-correct. | Seed from `nowPartsInTz`. |
| T-18 | P2 | PARTY card | `timeline_party_card.tsx:183-187` | `planContext` prints "SAVED PLAN · c_mood_to_party" (cue id, engine jargon) when the plan is not driving. | Unclear copy at the one place the operator looks when party is quiet. | Use the cue label and plain words ("plan not driving"). |
| T-19 | P2 | DAY view | `DayView.tsx:438-445` | Inert "SHIFT TONIGHT · —" placeholder in the header row. | Clutter; reads as broken. | Remove until built. |
| T-20 | P2 | EDIT PLAN offline | `timeline.tsx:2052-2053` | Whole edit view is `pointerEvents:'none'` whenever timeline data is stale, although previews/saves already handle transport failures separately (`:596-605`). | Engine hiccup blocks browsing a draft entirely. | Disable only the save path; keep browsing/zoom. |
| T-21 | P2 | Plan picker template | `timelineTemplate.ts:204-277`; lint `show_plan.js:897-938` | BRC template: 8 days, program cues without `autopilot` (lint error on activate), `default` playlists, mood cue with no window. | "NEW FROM TEMPLATE" produces a plan that activates with ACTIVE PLAN HAS WARNINGS. | Regenerate the template from the current `playa_default` shape (or load it from the engine). |
| T-22 | P2 | `_356` gap | `timeline_party_card.tsx:203,360-364`; engine `timeline_service.js:2047,2198,2506` | `cueError` is cleared only when the party cue dispatches successfully; after a RESET COOLDOWN or re-arm it stays red until the next fire. Matches spec intent, but no operator path clears it. | SESSION chip can stay red all night after a one-off playlist error that was since fixed. | Clear `cueErrors[cue.id]` on RESET COOLDOWN / party config save, or add "clear error". |
| T-23 | P2 | Pad parsing | `utils/timelineApi.ts:815-817` | `/timeline/overview` is consumed unparsed (days, segments, phases trusted). | Contrast with strict `/timeline/state` parsing; a malformed overview renders silently wrong. | Minimal shape check (days array, date strings). |
| T-24 | P2 | Stale threshold vs mutations | `timeline_alert_model.ts:28`; engine `timeline_service.js:2949,4047-4057` | Ticks (and broadcasts) pause for the whole duration of activate/save/party mutations; a catchUp with many device steps can exceed the 10 s stale threshold. | Mid-activation the pad flips to "TIMELINE DATA STALE · actions disabled". | Broadcast a heartbeat during mutations, or raise the threshold while a mutation is in flight. |
| T-25 | P2 | Default-cue snapshot | `timeline.tsx:196-214` | Documented "best-effort" fallback to a seeded `default` playlist when the deck cannot be read. | Violates the no-fallback rule; a new plan silently carries an invented default cue. | Fail loudly (no plan created) when the deck snapshot is unavailable. |
| T-26 | P2 | `playa_default` plan | `simulation/scenes/titanic/timeline/playa_default.yaml:87-107 (ignition days), 355-375 (day-off master 0, days all), 712-717 (default cue sets no master)` | On the ninth calendar date the 09:00 day-off program (master 0) expires at sunset−30 with no ignition cue (days 0–7); the phase-aware default resolves to the ambient look, master stays 0. | The ship is dark on the final evening unless that is the intended strike posture. | Operator decision (E-1). |
| T-27 | P2 | `playa_default` plan | `playa_default.yaml:463-479 (dust storm), 501-545 (burn/temple)` | Dust storm is a no-hold program: it holds until the next program (sunrise bloom / day-off) or END PROGRAM. Burn/temple holds (120 min) suppress `c_early_night` 21:30 and party until ~22:55/22:25; resolver then restores early-night (verified, `resolve_deck_state.js:149-159` + walk-back). | Behaviour is coherent but undocumented in the tab; the operator will see "Burn night" end into "Early night" an hour late. | Document; consider `hold.until` for dust storm (E-2). |

Verified-OK (no finding): midnight wrap of the party window
(`party_window.js:59-83,134-170`), festival day math in plan tz (`festival.js`),
6 PM operator-day mapping both ways (`cue_edit_logic.ts:67-142`,
`night_calendar_logic.ts`), catchUp/resume/lease-release rejoin semantics incl.
forced sessions (`timeline_service.js:2591-2878`), tick/mutation serialization,
`/party-config` and `/timeline/state` contracts vs `party_api.ts` /
`timelineApi.ts` parsers, button matrix vs `_356` §4, DayView/strip NOW playhead
across midnight, aligned 21:30 seam coalescing.

## C. Improvements worth doing before the playa (ordered)

1. **Fix T-01** (S/M). Editor preserves "no duration" for existing cues; add a
   "No window" option; test in `cue_edit_logic.test.ts` (today line 314 pins the
   opposite behaviour and must change).
2. **Fix T-02** (S). Refuse to open a party cue without a clock-anchored seed,
   with a message pointing at the YAML; later (M) support sun anchors in
   `partyWindowSeed`/`planWithPartyWindow`.
3. **Fix T-03** (S). `getState()` uses `_runtimeCuesAt`; engine test with a
   day-pinned cue on another day; pad test for `rangeUntilNextCue` consistency
   with the NEXT list.
4. **Confirmations** T-04, T-05 (S). Reuse `opConfirm` with destructive styling;
   mention "LIVE show" when the draft is the active plan.
5. **T-13 + T-08** (S). Honest EDIT PLAN header and alert order; replace the
   placeholder copy.
6. **T-07** (S). Outside the span: no fake today; NEXT shows the start-in-N-days
   line.
7. **T-10** (S). Party-window detection by `whenPhase` reference, so the real
   plan draws its window.
8. **T-09** (S copy / M countdown). Tell the truth about the 2-minute lease in
   Time Travel.
9. **T-12** (M). Collapsed EVENT LOG + cue errors in LIVE (or EDIT PLAN per
   docs/78); keep `lastError` until acknowledged.
10. **T-11, T-25** (S). Loud errors instead of silent catches/fallbacks.
11. **Dry-run assertion spec for `playa_default`** (M). A tracked assert spec
    (festival-day indices, no dates) for day 0 ignition, an ordinary night, burn
    night, temple night and the final morning, run with
    `node tools/timeline_dryrun.mjs --scene titanic --plan playa_default --date <day>`
    from `marsin_engine/`; add it to `.agent/ops/timeline_e2e_tests.md`.
12. **T-06** (S). Refuse/announce cue-scope changes on day removal.
13. **Delete dead code T-14** (S) once T-12 lifts what it needs.

## D. Improvements for later

- T-15, T-16, T-17, T-18, T-19, T-20, T-21, T-22, T-23, T-24.
- Per-hour party budget and rolling-hour counter from docs/77 §4.3 remain
  unimplemented (no `budget` logic in `timeline_service.js` / `triggers.js`);
  cooldown is the only limiter.
- Travel view: show the rehearsal plan name next to the day grid when
  `draft.name !== activePlan` (engine already badges `rehearsingPlan`).
- EDIT PLAN in performance mode is correctly frozen (docs/78 SD-9); consider a
  read-only CALENDAR/DAY of the live plan during performance for quick checks.
- Template refresh (T-21) and a "duplicate the live plan" shortcut in the picker.

## E. Questions for the operator

- E-1 Final evening (ninth calendar date): is a dark ship after the day-off hold
  intended (strike), or should ignition/first-colour also run on day 8?
- E-2 Dust storm beacon: should it carry an explicit `hold` (e.g. 90 min) so it
  ends on its own, or stay "until the next program / END PROGRAM"?
- E-3 Party window end is `sunrise −120` while `c_pre_dawn` fires at the same
  anchor; keep the sun anchor (T-02 needs editor support) or move the window to
  a fixed clock end so it is editable from the pad?
- E-4 Should editing the ACTIVE plan from the pad be allowed at show time at
  all, or should the tab always edit a copy and require explicit ACTIVATE
  (docs/78 "Activation remains explicit")?
- E-5 Time Travel lease: keep the 120 s idle expiry, or give `scope:'travel'` a
  longer lease (engine change)?
- E-6 Where should the EVENT LOG live now: LIVE (bottom, collapsed) or EDIT PLAN
  as docs/78 specified?
- E-7 Party numbers: `/party-config` is the authority after first seed; the
  plan's `minDwellSec 120 / cooldown 900 / 12 min` re-sync only on an explicit
  save or activate of the plan. Confirm that is the intended precedence for the
  week.
