# Timeline Operator UI Redesign

## Status

Approved implementation plan for the CaptainPad Timeline tab. This document
defines the intended interaction and visual structure; it does not authorize
Timeline engine, show-plan, deployment, or live-rig changes.

The redesign must preserve CaptainPad's existing shell and design system while
making the Timeline readable at a glance on a landscape iPad. Calendar View and
Time Travel are required first-class workflows, not optional follow-ups.

## Operator intent

The finished Timeline must answer these questions immediately:

1. What plan is active?
2. What is on the ship now?
3. What happens next, and when?
4. Is Party enabled or disabled?
5. Is the screen showing live time, a calendar review, a Time Travel snapshot,
   or an editable draft?

The current screen can answer all five, but it mixes live monitoring, Party
configuration, plan-making, calendar navigation, Time Travel, errors, and event
history in one long vertical workspace. The redesign separates those mental
modes without removing their capabilities.

## Decisions

These decisions are part of the design and should not be reopened during
implementation unless the operator explicitly changes them.

1. **Keep the CaptainPad application shell exactly recognizable.** The global
   112-point left rail, route order, route groups, active Timeline pill,
   performance-mode behavior, overlays, and landscape orientation remain.
2. **Use CaptainPad tokens exclusively.** The Timeline uses the active palette
   from `constants/theme.ts`, the existing surface hierarchy, Space Grotesk and
   Inter, `Space`, `Radius`, and shared design recipes. It does not introduce a
   separate navy UI or hard-coded identity colors.
3. **Use four local Timeline views:** `LIVE`, `CALENDAR VIEW`, `TIME TRAVEL`,
   and `EDIT PLAN`.
4. **Default to LIVE.** Opening Timeline must show live truth before settings or
   editing tools.
5. **Keep Calendar View.** Day selection, resolved day content, cue blocks,
   empty-time selection, and day navigation remain available.
6. **Keep Time Travel.** It becomes an explicit local view. Calendar taps open
   the existing review sheet first: cue taps open CUE review, and empty-time
   taps open the 15-minute-snapped MOMENT review. Only the explicit
   `TIME TRAVEL HERE` action may enter Time Travel or move the deck.
7. **Keep editing separate from live operation.** Draft rows never look like
   live rows, and a live `FIRE` action never appears beside an unsaved draft.
8. **Use larger operator type and targets.** Timeline receives an approved
   large-type scale while preserving the overall CaptainPad density and panel
   geometry.
9. **No engine redesign.** Reuse the existing Timeline endpoints, state model,
   resolver, takeover handoff, Time Travel, Party configuration, and zoom
   behavior.
10. **No fallback behavior.** A missing state, rejected operation, unresolved
    time, or failed handoff must remain explicit and actionable.

## Non-goals

- Do not change cue arbitration, phase resolution, catch-up, Party eligibility,
  Party enablement, program holds, or Time Travel semantics.
- Do not change the global CaptainPad route policy or add duplicate side rails
  inside `timeline.tsx`.
- Do not remove Calendar View, Time Travel, the Maker, Event Log, Party
  controls, plan selection, manual events, or live error reporting.
- Do not introduce a new component library, font, icon family, CDN, telemetry,
  or runtime dependency.
- Do not optimize the phone/portrait layout. CaptainPad remains landscape-only.
- Do not alter show-plan YAML as part of this UI work.

## Existing contracts that must survive

The implementation must preserve these current behaviors:

- The global rail is rendered by `app/(tabs)/_layout.tsx`; Timeline inherits it.
- Timeline operations outrank Live Touch only through the existing confirmed
  handoff flow. Draft preview remains read-only.
- A calendar tap opens review first. Merely viewing a cue or empty time never
  moves the rig.
- Time Travel moves the deck only after an explicit operator action and keeps
  the existing global purple zoom banner and `RESUME LIVE` path.
- `PERFORM` is available only for the cue the engine identifies as live and
  only where the current engine contract permits it.
- The active plan and an edited draft may be different. Both identities must
  remain visible and must never be conflated.
- Auto-save success, saving, invalid draft, rejected save, and retry states
  remain truthful. There is no `SAVE DRAFT` button: edits auto-save, and saving
  the active plan hot-reloads the running show. The UI must state that danger
  model plainly and must never imply that saving is a harmless staging step.
- Party eligibility is not Party enablement. The UI must say both facts.
- Disabling Party during a session, ending a program, firing a manual cue,
  activating a plan, or entering Time Travel must keep existing confirmation,
  priority, and error behavior.
- Engine-offline state remains explicit. No button pretends that an action was
  accepted when the engine could not confirm it.

## P0 authority and truthfulness contracts

These rules resolve ambiguities in earlier mocks and are binding before visual
implementation begins:

- `LIVE` and `CALENDAR VIEW` always render `liveOverview` plus current engine
  state. Only `EDIT PLAN` renders `draftOverview`. A shared
  `draft ? draftOverview : liveOverview` selector is prohibited because it can
  present edited material as the running show.
- The NOW owner is selected in this order: a confirmed manual/program/party
  `state.activeCue`; otherwise the segment owning the current plan-local minute
  in today's `liveOverview`; otherwise the explicit default/baseline owner.
  `activeCue` alone is insufficient because ordinary deep-night ambient blocks
  do not populate it.
- The persistent header has exactly one expanded alert slot. Engine offline,
  stale-data age, action rejection, Live Touch handoff, active Time Travel, audio
  staleness, and invalid/not-saved draft states are explicit. Old data remains
  visible only when marked `STALE`; it is never styled or described as live.
- Do not invent UI commands or routes. `PREVIEW CURRENT`, `PREVIEW SAFELY`, and
  equivalent buttons do not exist. Time Travel preview follows the selected
  target through the existing read-only resolve request; draft preview follows
  edits through the existing automatic draft-overview request.
- A Calendar cue tap opens CUE review. A Calendar empty-time tap opens MOMENT
  review after the existing 15-minute snap. Neither navigates immediately,
  performs a cue, or moves the deck.
- Standalone HTML mocks use system font stacks and contain no `@font-face`,
  machine-local `file:` URL, username, workspace path, or external request.
  CaptainPad itself continues using its existing locally bundled fonts.

## Information architecture

### Global CaptainPad shell

No structural change is required in the global tab layout. The finished screen
must continue to sit to the right of the existing rail:

```text
┌────────────┬───────────────────────────────────────────────────────────────┐
│ CAPTAINPAD │ Timeline workspace                                            │
│            │                                                               │
│ LAYERS     │ active plan + engine + controller + Party summary             │
│  Deck      │ ┌────────┬──────────────┬─────────────┬───────────┐           │
│  Mixer     │ │ LIVE   │ CALENDAR VIEW│ TIME TRAVEL │ EDIT PLAN │           │
│  Live Touch│ └────────┴──────────────┴─────────────┴───────────┘           │
│ TOOLS      │                                                               │
│  Audio     │ selected Timeline view                                        │
│  Simulator │                                                               │
│ SHOW       │                                                               │
│  Timeline ●│                                                               │
│  Events    │                                                               │
│  Scheduler │                                                               │
│  Dimmer    │                                                               │
│ SYSTEM     │                                                               │
│  Config    │                                                               │
└────────────┴───────────────────────────────────────────────────────────────┘
```

The rail remains globally owned. Do not copy this markup into the Timeline
screen; the wireframe shows the required complete-screen context.

### Persistent Timeline header

The header is common to all four local views and has one visual hierarchy:

- `ACTIVE PLAN` label and plan name.
- Engine state, with text and a semantic indicator.
- Controller state: program, autopilot, or manual.
- Party state: disabled, eligible/armed, in session, or cooldown.
- Audio mood when available.
- One highest-priority alert slot directly beneath the header.

The current header scatters active plan, controller, mood, engine, active cue,
program, next cue, phase, and multiple banners across several small rows. The
new header consolidates identity and system state; the selected local view owns
the detailed NOW/NEXT presentation.

Alert priority is deterministic:

1. Engine offline or action failure.
2. Live Touch handoff/retry state.
3. Active Time Travel or Perform zoom state.
4. Draft invalid/not saved.
5. Informational status.

Only the highest-priority alert is expanded. Additional diagnostics live in an
expandable `DETAILS` drawer so banners cannot push the main operator state
below the fold.

## Local view 1 — LIVE

LIVE is the default operating surface.

### Landscape structure

```text
┌───────────────────────────────────────┬──────────────────────────────┐
│ NOW                                   │ PARTY MODE                   │
│ Early Night                           │ OFF                          │
│ Ambient · cool animated welcome       │ Music cannot start a session │
│                                       │ [ENABLE PARTY MODE]          │
│ started 21:30 ━━━━━━━ next 23:30      │ 12 min · 15 min cooldown     │
│                                       ├──────────────────────────────┤
│ WHAT HAPPENS NEXT                     │ MANUAL EVENTS                │
│ 23:30  Midnight Drive                 │ [DUST] [PHILHARMONIC]        │
│ 01:00  Aurora Quiet Reset             │ [MAXA] [BABY REVEAL]         │
│ 01:10  UV Lasers                      │ confirmation remains         │
│ 02:30  Electric Ice Reset             │                              │
└───────────────────────────────────────┴──────────────────────────────┘
```

### NOW card

- `NOW` is a status label, not the cue's only green indicator.
- Cue/program name is the largest text on the screen.
- Show playlist/look and a plain-language description below it.
- Start time, next transition, and remaining time are readable without opening
  another panel.
- If a program is active, expose a large `END PROGRAM` action with the current
  confirmation and recovery semantics.
- If no authored cue owns the deck, name the actual default/baseline state; do
  not show an empty card.

### Next-cue list

- Show the next four relevant transitions by default.
- Lead each row with a tabular local time, then cue name, then short behavior.
- Mark `NEXT`, `PROGRAM`, `AMBIENT`, `RESET`, or `SUN-BASED` in text.
- A row may open Calendar/Event review but must not fire on row tap.
- `VIEW FULL CALENDAR` changes the local view to Calendar View.

### Party card

- Always show the operator-controlled enabled/disabled state in large text.
- Use a verb for the action: `ENABLE PARTY MODE` or `DISABLE PARTY MODE`.
- State separately whether the current moment is inside the eligibility window.
- Show session length and cooldown as a compact summary.
- Detailed playlist, dwell, duration mode, and cooldown editing are collapsed
  under `PARTY SETTINGS`.
- During a live session show remaining session time. During cooldown show the
  remaining cooldown. Never label eligibility as enabled.

### Plan-authored human-triggered cues

Human-triggered cues are first-class authored Timeline cues, not a separate
hard-coded button registry:

- Source them from the ACTIVE saved plan where `trigger.type === 'manual'` and
  deduplicate repeated day occurrences by cue id.
- Show them in LIVE under `ON DEMAND / HUMAN TRIGGERED`, with at least 52-point
  targets. Every button names the event; icon/color may supplement but never
  replace text.
- Show an `ON DEMAND` section in Calendar review for manual cues applicable to
  the selected festival day. They do not receive invented clock positions and
  never enter the chronological NEXT list.
- Show and edit them normally in EDIT PLAN with an explicit `HUMAN TRIGGERED`
  trigger label. Creating or changing one follows the same autosave and
  active-plan hot-reload contract as every other draft edit.
- Selecting a human-triggered cue opens review first. The actual `FIRE` action
  remains explicit, confirmed, engine-authoritative, and subject to the
  existing Timeline-over-Live-Touch handoff. Offline or stale state disables
  FIRE with a reason; nothing is queued.
- Manual cues use `catchUp: false`: they never self-fire on startup, restart,
  resume, Calendar navigation, or Time Travel.
- When a fired manual program ends, `RESUME LIVE` / `END SHOW` restores the
  live segment that owns the current moment.

`BABY REVEAL` is the protected example. The active plan may retain separate
Pink and Blue cue ids, but the operator surface groups them into one
`BABY REVEAL…` entry. It opens the existing protected answer-selection flow,
states the consequence and approximate ceremony length, requires final
confirmation of the selected answer, and never fires either underlying cue from
the first tap. Do not replace this with two adjacent raw FIRE buttons.

## Local view 2 — CALENDAR VIEW

Calendar View preserves the existing festival/day review workflow and makes it
readable.

### Structure

- Festival day selector remains visible.
- The selected day is named with weekday and date.
- Provide previous/next day actions and a return to the festival overview.
- Show the day calendar and a readable cue list together in landscape.
- The calendar remains the spatial view; the list is its text equivalent.

Recommended landscape split:

```text
┌──────────────┬──────────────────────────────────────────────────────────┐
│ FESTIVAL DAY │ SELECTED DAY                                             │
│ D1 Sun       │ ┌──────────────────┬──────────────────────────────────┐  │
│ D2 Mon       │ │ 18:00–09:00      │ NIGHT ARC / RESOLVED CUES        │  │
│ D3 Tue       │ │ calendar lanes   │ 19:04 Ignition White            │  │
│ ...          │ │ + phase bands    │ 20:04 First Color               │  │
│ D8 Sun       │ │ + cue blocks     │ 21:30 Early Night               │  │
│              │ │                  │ ...                              │  │
│              │ └──────────────────┴──────────────────────────────────┘  │
└──────────────┴──────────────────────────────────────────────────────────┘
```

### Calendar behavior

- Preserve the full-day model and existing sun/phase/cue data. The visual may
  focus the normal night span initially, but the operator must still be able to
  inspect the complete calendar day.
- A cue block tap opens its existing review sheet.
- An empty-time tap snaps through the existing 15-minute rule and opens the
  existing MOMENT review sheet for that instant. The sheet may offer
  `TIME TRAVEL HERE`; opening it never moves the deck.
- Manual cues applicable to the selected day appear in a separate `ON DEMAND`
  review section rather than at a fabricated time on the chart. Selecting one
  opens its review sheet and never fires it directly.
- Current day, current time, and live cue markings appear only on today's
  occurrence. Do not mark every repeated cue instance live.
- Cue blocks must have a minimum 44-point hit region even when their
  proportional duration is short, and their essential label/time text is at
  least 16 points. A readable adjacent list does not permit an interactive cue
  block to use glove-hostile essential text.
- Replace 8.5–11-point essential calendar labels with the Timeline large-type
  scale. Fine grid labels may remain smaller only when the adjacent text list
  provides an equivalent readable description.
- Retain add/edit/delete controls when the active local mode permits editing,
  but keep those controls visually subordinate to calendar review.

## Local view 3 — TIME TRAVEL

Time Travel remains the existing static plan-at-an-instant feature. The new
view makes its target and consequence unmistakable.

### Entry paths

Time Travel opens from:

- The local `TIME TRAVEL` tab.
- The explicit `TIME TRAVEL HERE` action in a Calendar MOMENT review.
- Existing cue-review/event-sheet actions that already resolve to Time Travel.

A Calendar tap itself never changes the local view and never preloads a
rig-moving action without first showing the appropriate review sheet.

### Structure

- Festival day selector.
- Large selected local time.
- Previous/next 15-minute controls.
- Previous/next event controls where the existing zoom model permits them.
- Read-only resolved state card naming cue/default owner, playlist/look,
  controller, palette, and following cue.
- Explicit `TIME TRAVEL HERE` action.
- Plain explanation that live clock/schedule continue in the background.

### State rules

- Merely changing the day/time performs only the existing read-only resolve.
- The deck changes only after `TIME TRAVEL HERE` and successful priority
  handoff.
- While active, preserve the global purple `TIME TRAVELING` banner on every
  CaptainPad tab.
- The banner and Time Travel view must expose `RESUME LIVE`.
- The selected target remains visible while the request is pending or rejected.
- A rejection names the reason and does not pretend the rig moved.
- Do not offer `PERFORM` for a bare moment. Preserve the current live-cue rule.

## Local view 4 — EDIT PLAN

EDIT PLAN contains the Maker and plan-management tools. It is the only local
view whose primary purpose is mutation.

### Draft identity

Always show:

- `EDITING DRAFT`.
- Draft plan name.
- Active plan name.
- Whether they are the same plan.
- Auto-save state: saving, saved, invalid, rejected, or retry required.

### Content

- Plan picker/activation remains available.
- Festival editor remains here.
- Default cue editor remains here.
- Festival overview and day editing remain here.
- Cue add/edit/delete remains here.
- Party advanced settings may be opened here, but Party enable/disable remains
  reachable from LIVE.
- Event Log and diagnostics are collapsed by default at the bottom.

### Safety

- Draft cue rows never expose a live `FIRE` button. Live-cue `PERFORM` remains
  in the CUE review opened from the live Calendar and only appears when the
  engine confirms that occurrence belongs to the active saved plan.
- Preserve the existing unsaved/autosave versus activate blocked-reason copy.
- Invalid drafts remain preview-invalid and unsaved; no silent repair or
  fallback plan is allowed.
- Activation remains explicit through the current plan-management flow.

## Typography and touch targets

Timeline needs a larger approved type family. Do not scatter new literal sizes
through components. Add named recipes to the central CaptainPad type system and
mirror them in `CaptainPad/DESIGN.md`.

Recommended recipes:

| Token | Font | Size / line height | Use |
| --- | --- | --- | --- |
| `timelineHero` | Space Grotesk 700 | 34 / 38 | NOW cue/program name |
| `timelineTitle` | Space Grotesk 700 | 24 / 28 | selected day, Time Travel target |
| `timelineCue` | Space Grotesk 700 | 18 / 22 | cue names and primary times |
| `timelineBody` | Inter 400 | 16 / 22 | explanations and status prose |
| `timelineMeta` | Inter 600 | 14 / 18 | secondary timing and behavior |

Existing `headline`, `labelCaps`, and `microCaps` remain for page chrome and
nonessential metadata. Essential state must never depend on 8.5–12-point text.

Target sizes:

- Standard Timeline control: at least 48 points high.
- `FIRE`, `END PROGRAM`, `TIME TRAVEL HERE`, Party enable/disable, and
  `RESUME LIVE`: at least 56 points high.
- Compact status pills may remain visually smaller only when their full
  interactive hit region is at least 44 points.
- Calendar blocks receive a minimum 44-point hit region through layout or
  `hitSlop`, even if the proportional visual block is shorter.

## Color, shape, and surface rules

- All five existing themes must render the redesigned Timeline.
- Use `C.background`, `surfaceContainerLow`, `surfaceContainerLowest`, and
  `surfaceContainerHigh` exactly as the rest of CaptainPad does.
- Use `C.primary` for selection, `C.tertiary` for live/automatic/connected,
  `C.warning` for caution/another driver, and `C.error` for failure or
  blackout.
- Use `PLAN_ACCENT` only where the existing identity system calls for it.
- Replace Timeline's inline green and amber literals with semantic tokens.
- Every state includes text; color is never its sole carrier.
- Use `Radius.control`, `Radius.card`, `Radius.panel`, and `Radius.shell`.
- Use `Space` tokens for gaps and padding.
- Do not add glow to resting cards. Glow remains reserved for true live or
  selected state under the existing design rules.

## Component architecture

`app/(tabs)/timeline.tsx` is currently responsible for transport state,
draft/save orchestration, priority handoff, zoom actions, layout, four large
feature areas, and most styling. The redesign should reduce its rendering
responsibility without rewriting behavior.

Recommended new snake_case modules:

| File | Responsibility |
| --- | --- |
| `components/timeline/timeline_view_mode.ts` | `live/calendar/travel/edit` state, legal transitions, default selection, pure helpers |
| `components/timeline/timeline_mode_tabs.tsx` | Four-view segmented control using CaptainPad tokens |
| `components/timeline/timeline_status_header.tsx` | Active plan, engine, controller, Party/audio summary, alert slot |
| `components/timeline/timeline_live_view.tsx` | NOW, next cues, compact Party card, manual events |
| `components/timeline/timeline_calendar_view.tsx` | Day selector plus existing overview/day-calendar composition |
| `components/timeline/timeline_time_travel_view.tsx` | Target selection, resolve preview, explicit travel action |
| `components/timeline/timeline_edit_view.tsx` | Existing Maker, festival/default cue editors, cue editing, diagnostics |

Keep transport, draft saver, live state, priority handoff, and the existing
handlers in `timeline.tsx` initially. Pass explicit data and callbacks into the
presentational views. This limits behavior risk and makes each view testable.

Existing components to reuse rather than replace:

- `DayOverviewStrip.tsx`
- `DayView.tsx`
- `EventSheet.tsx`
- `ZoomBanner.tsx`
- `PlanPickerSheet.tsx`
- `CueEditorSheet.tsx`
- `FestivalEditor.tsx`
- `PlanIndicatorPill.tsx`
- `PendingProgramOverlay.tsx`

Restyle or compose these components where needed. Do not duplicate their engine
or interaction logic in a new visual component.

## Data and behavior mapping

| UI element | Existing authority to reuse |
| --- | --- |
| Active plan / engine / controller / mood | `useTimeline()` state |
| NOW | confirmed manual/program/party `state.activeCue`; otherwise the segment owning now in today's `liveOverview`; otherwise explicit default/baseline state |
| NEXT | `state.nextCue` plus current overview/day resolution |
| Calendar days and cue occurrences | `liveOverview` / `draftOverview` |
| Calendar empty-time snap | `chartTapToLocal()` and existing 15-minute constant |
| Cue/moment review | Existing `EventSheet` state |
| Time Travel preview | `fetchTimelineResolve()` |
| Time Travel action | Existing `handleTimeTravel()` and priority handoff |
| Resume live | Existing `resume()` path and global `ZoomBanner` |
| Party status/config | Existing Party config/state APIs and `PartyModeSection` logic |
| Draft persistence | `TimelineDraftSaver` |
| Plan selection/activation | Existing picker and handlers |

If the UI needs a derived display model, build it as a pure helper over these
authorities. Do not add a second source of truth.

## Implementation sequence

### Slice 1 — freeze behavior and add view-mode logic

- Add focused tests that pin current Calendar, Time Travel, Live Touch handoff,
  draft/save, Party, and active-plan behavior before moving JSX.
- Add the pure local view-mode model and segmented control.
- Default to LIVE on a normal Timeline entry.
- Preserve the appropriate local view while sheets open/close.
- Decide explicit reset behavior on tab blur: active Time Travel remains engine
  state and global; local presentation may reopen TIME TRAVEL when the zoom is
  active.

### Slice 2 — extract the persistent header and LIVE view

- Consolidate active plan, engine, controller, mood, Party summary, NOW, and
  NEXT hierarchy.
- Move the detailed Party editor behind an expandable section.
- Preserve all existing Party operations and handoff/error states.
- Move manual event access into the LIVE right column.
- Implement deterministic alert priority.

### Slice 3 — compose Calendar View

- Reuse the existing overview and day components.
- Increase readable labels and touch regions.
- Present calendar and textual cue list together on landscape.
- Preserve day navigation, today/live occurrence correctness, cue review, empty
  time review, and edit controls.
- Make calendar-to-Time-Travel navigation explicit and testable.

### Slice 4 — add the explicit Time Travel view

- Reuse resolver, EventSheet, zoom logic, and handoff behavior.
- Add day/time selection and resolved-state preview.
- Keep 15-minute stepping and event stepping.
- Preserve global banner and resume behavior.
- Test dormant-plan travel, active-plan travel, rejection, Live Touch handoff,
  and resume.

### Slice 5 — compose EDIT PLAN

- Move Maker-only sections under the edit view without changing their logic.
- Make active-plan versus draft identity persistent.
- Keep auto-save and retry status visible.
- Collapse diagnostics and Event Log by default.
- Verify switching among local views never loses or silently saves invalid
  draft state.

### Slice 6 — token cleanup and visual hardening

- Add the named Timeline typography recipes to `theme.ts` and `DESIGN.md`.
- Replace Timeline inline semantic colors and ad hoc radii/spacing.
- Verify light, dark, midnight, sunset, and gruvbox themes.
- Verify all target sizes, truncation, focus order, accessibility labels, and
  color-independent state copy.

## Test plan

### Pure and component tests

Add or extend focused coverage for:

- Default local view is LIVE.
- Each local tab selects exactly one view.
- An active Time Travel zoom makes the local Time Travel state obvious.
- Calendar cue tap opens cue review without moving the rig.
- Calendar empty-time tap uses the existing 15-minute snap and opens MOMENT
  review without changing views or moving the rig.
- Calendar lists applicable manual cues under ON DEMAND without fabricated
  times or inclusion in NEXT.
- LIVE derives manual actions from the active saved plan rather than a
  hard-coded UI list.
- BABY REVEAL appears as one protected entry; answer selection and final
  confirmation dispatch exactly one underlying manual cue.
- Manual cues never catch up or self-fire after restart, resume, Calendar
  navigation, or Time Travel.
- `TIME TRAVEL HERE` remains the only action that requests travel.
- `RESUME LIVE` calls the existing resume path.
- Live cue occurrence is marked only for the selected instance on today.
- Draft and active-plan names remain distinct.
- Unsaved or inactive draft cues never gain a misleading live `FIRE` action.
- Party enabled and Party eligible render as separate facts.
- Party action labels are verbs and reflect the requested action.
- Alert priority shows one expanded alert and retains access to details.
- Live Touch handoff pending/succeeded/rejected copy remains correct.
- Every view renders engine-offline and missing-plan states explicitly.

Preserve and rerun the existing Timeline tests, including:

- `useTimeline_takeover.test.ts`
- `timeline_ownership_api.test.ts`
- `timeline_takeover_api.test.ts`
- `timeline_priority_feedback.test.ts`
- `timeline_draft_saver.test.ts`
- `zoom_logic.test.ts`
- `baby_reveal_confirmation.test.ts`
- `timeline_maker_ownership_contract.test.ts`

### Static checks

Run from `CaptainPad`:

```text
npx tsc --noEmit
npm run lint
npm run web:build
```

Run the focused test files and the CaptainPad test command required by the
current package scripts. Run `git diff --check -- CaptainPad` before handoff.

### Visual checks

Capture the Timeline at representative landscape sizes, including the physical
iPad's native landscape viewport and one smaller supported landscape viewport.
For each size capture:

- LIVE with normal autopilot state.
- LIVE with Party disabled.
- LIVE with Party in session/cooldown.
- Calendar festival overview.
- Calendar selected day with current cue.
- Time Travel selection before travel.
- Active Time Travel with the global banner.
- EDIT PLAN with active plan equal to draft.
- EDIT PLAN with a different draft.
- Engine offline.
- A long cue/plan name and the maximum relevant alert copy.

Repeat critical captures in all five CaptainPad themes. Visual checks must prove:

- No essential state is below the initial landscape fold.
- No essential text is clipped or rendered below the approved minimum scale.
- Side rail geometry and active Timeline identity match the rest of CaptainPad.
- Calendar and Time Travel remain clearly discoverable.
- LIVE, Time Travel, and draft states cannot be mistaken for each other.
- Buttons remain at least their specified target sizes.

Do not use the operator's live services or default ports for this validation.
Use an isolated worktree, its assigned high ports, test-bench data, and
TEST-NET destinations. Close every browser and process after capture.

### Physical iPad acceptance

Automated and web checks are necessary but not sufficient. The operator must
complete a landscape iPad smoke test:

1. Identify active plan, NOW, NEXT, engine, and Party state without scrolling.
2. Switch among all four local views.
3. Open a festival day and read cue blocks at arm's length.
4. Tap an empty calendar time and verify the Time Travel target.
5. Step time backward/forward and preview the resolved state.
6. Enter and exit Time Travel; verify the global banner on another tab.
7. Return to LIVE and confirm current state is immediately understandable.
8. Open EDIT PLAN and distinguish draft from active plan.
9. Exercise Party enable/disable and one confirmed manual event on the approved
   isolated stack.
10. Verify operation with dusty fingers: no critical action depends on a small
    target or fine drag.

## Acceptance criteria

The implementation is complete only when all of the following are true:

- The global CaptainPad rail and overall shell remain recognizable and
  structurally unchanged.
- Timeline opens to LIVE.
- LIVE shows active plan, engine, controller, Party, NOW, and NEXT without
  scrolling at the physical iPad landscape size.
- Calendar View and Time Travel are visible local tabs.
- Existing calendar day navigation, cue review, empty-time review, and editing
  remain functional.
- Time Travel remains read-only until explicit confirmation, preserves the
  global banner, and resumes through the current engine path.
- EDIT PLAN contains the existing Maker without confusing draft content with
  live content.
- Essential body text is at least 16 points, primary cue/time text at least 18
  points, and critical actions at least 56 points high.
- No new hard-coded semantic colors, unapproved fonts, arbitrary spacing,
  external assets, runtime dependency, or fallback behavior is introduced.
- Existing Timeline behavior tests remain green and new view tests are green.
- TypeScript, lint, web build, focused tests, and whitespace checks pass.
- Visual evidence covers required states, viewports, and themes.
- Physical landscape-iPad acceptance passes.
- No service, port, deployment, runtime state, or unrelated dirty-tree file is
  changed by the implementation or its tests.

## Implementation handoff requirements

The implementing agent must:

1. Read `AGENTS.md`, the Agent OS boot sequence, this document, CaptainPad's
   `DESIGN.md`, UI design rules, node style, autonomy rules, and CaptainPad
   auto-checks before editing.
2. Inspect current dirty-tree ownership and coordinate before touching shared
   Timeline files.
3. Work on a durable feature branch or an isolated `dev/` worktree as directed
   by the operator; never push a `dev/` branch.
4. Keep engine and show-content files out of this UI implementation.
5. Land the work in reviewable slices with behavior tests before and after JSX
   extraction.
6. Record only task-relevant facts in Agent OS. Do not record computer,
   operating-system, host, user, or platform information.
7. Stop for operator review after the redesign is visually complete and before
   any live-stack or deployment action.


## Interactive mock specification

This section is **additive**: it records the design that an interactive mock of
this plan was built against, together with everything needed to rebuild that
mock from scratch on a machine that has only this document. It does not replace
any decision above; where it differs from the plan text, the difference is
stated inline and is listed as a `SINA DECIDES` item at the end.

Two mock files are specified, and both are reproduced verbatim in the
appendices at the end of this document:

| File | What it shows |
| --- | --- |
| `CaptainPad/design_mocks/timeline_operator_redesign.html` | The four local views, the persistent header, the alert ladder, nine demo states, five themes |
| `CaptainPad/design_mocks/timeline_performance_mode.html` | The PERFORMANCE-mode composition and the passcode-gated takeover, six demo states, five themes |

Both are single standalone HTML files with **zero external requests of any
kind** — no CDNs, no `@font-face` URLs, no `file:` paths, no images, no
`fetch`/`XHR`, no telemetry. Fonts are declared as stacks
(`"Space Grotesk", ui-sans-serif, system-ui, sans-serif` for headings weight
700; `"Inter", ui-sans-serif, system-ui, sans-serif` for body) so the mock
renders anywhere; the app itself loads the real families from local packages.
Both target 1180x820 landscape and must degrade to 1024x768 with no horizontal
page scroll — wide internals scroll inside their own containers. In the mocks
1 point is drawn as 1 pixel.

### 1. View structure

Four Timeline-local views under the persistent Timeline header, exactly as the
Decisions list above requires: **LIVE** (default), **CALENDAR VIEW**,
**TIME TRAVEL**, **EDIT PLAN**. The segmented control sits directly under the
header: buttons at least 56 points tall, full workspace width, selection drawn
with the `sidebarActive*` recipe.

The selected view is local UI state. It survives sheet open/close. On tab entry
the default is LIVE, except when an active travel zoom exists
(`state.zoom?.scope === 'travel'`), where the tab opens on TIME TRAVEL showing
the active-travel state.

**One authority per view.** LIVE and CALENDAR VIEW always render from
`liveOverview` plus engine state; only EDIT PLAN renders the draft preview.
This matters because the tab auto-loads the ACTIVE plan into the draft as soon
as it has one, and a single `overview = draft ? draftOverview : liveOverview`
selector would make the live views show draft content. Auto-save hot-reloads
the active plan, so the two converge about a second after a save — but the
views must still read different authorities.

### 2. Persistent Timeline header and the one-alert ladder

One row, about 64 points, plus the alert slot beneath it.

- `ACTIVE PLAN` label over the plan name (24pt heading) with a running dot:
  `C.tertiary` when `state.planActive`, `C.secondary` otherwise.
- Status pills, non-interactive, each carrying its state **as a word** with
  colour only as reinforcement, radius `Radius.control`, hit region at least
  44 points:
  - **ENGINE** — `LIVE` / `OFFLINE`
  - **CONTROL** — `AUTOPILOT` / `SHOW RUNNING` / `MANUAL`
  - **PARTY** — `OFF` / `ARMED` / `IN SESSION` / `COOLDOWN m:ss` /
    `WINDOW CLOSED` / `SUPPRESSED`
  - **AUDIO** — `CALM` / `PARTY` / `STALE Xs`
- `A+` large-type toggle (48 points) at the right end.

**Exactly one alert renders expanded.** Everything lower-priority collapses
into a `DETAILS (n)` disclosure row (48 points) that also holds diagnostics and
the timeline-automation toggle. The ladder, top wins:

1. **ENGINE OFFLINE** — "Engine unreachable — last data HH:MM:SS (Xs ago). The
   rig keeps running its plan on its own." The age counts up live.
2. **ACTION FAILED / REJECTED** — the engine error verbatim, with `RETRY` where
   one exists.
3. **LIVE TOUCH HANDOFF** — pending/succeeded/rejected copy plus the standing
   armed-lease warning, with `PREEMPT LIVE TOUCH + RETRY`.
4. **ZOOM ACTIVE** — perform (green) or travel (purple) one-liner with
   `RESUME LIVE`. The global `ZoomBanner` stays authoritative and unchanged.
5. **AUDIO COMPANION STALE** — "Party detection is down; mood forced CALM."
6. **DRAFT INVALID / NOT SAVED** — mirrors the EDIT PLAN chip globally.
7. Informational — "Active plan is not the show plan", pre-festival
   "starts in N days", plan-warning count.

This extends the plan's five levels by splitting level 1 (offline vs action
failure) and inserting audio staleness; the split is a stated deviation.

### 3. LIVE view

Landscape grid: left column about 62%, right about 38%, `Space.lg` gutters.

**NOW card** (left-top, `surfaceContainerLow`, `Radius.panel`) — the only
glowing card on the screen, and it loses the glow whenever the engine is
offline, because stale data must never be presented as live.

- Kicker `● ON THE SHIP NOW` plus an ownership chip in words: `LIVE CUE` /
  `SHOW` / `PARTY SESSION` / `DEFAULT LOOK` / `BASELINE` / `OPERATOR (MANUAL)`.
- Name at `timelineHero` 34/38 — the block, cue, or program label. Never empty:
  with no cue-specific owner it shows the default-cue label or
  "Autopilot baseline — ambient".
- Sub-line: `playlist · palette` from the owning segment.
- Times row (tabular numerals): `since HH:MM` · progress bar (decoration) ·
  `until HH:MM (N min left) — NEXT: <label>`. When the owner is an unheld
  program: `holds until you end it`.
- Actions: `END SHOW` (danger, at least 56 points) only when
  `state.activeProgram` is set, confirming with "End <label>? The plan resumes
  with whatever owns this moment." `RESUME LIVE` (purple, at least 56 points)
  only while a travel zoom is active. Nothing else. `PERFORM` is not here — it
  stays on the cue review sheet.

**WHAT HAPPENS NEXT** (left-bottom): the next four transitions, rows at least
60 points: tabular time, label, and a behaviour tag in text (`SHOW` /
`AMBIENT` / `RESET` / `SUN` / `MASTER 0%` / `PARTY WINDOW`). A row tap opens the
existing `EventSheet` review and never fires. Footer button
`OPEN CALENDAR VIEW` (48 points).

**PARTY MODE card** (right-top) — two facts, never conflated:

- Line 1: `PARTY MODE ON` / `PARTY MODE OFF` — the human gate only.
- Line 2: eligibility — "Window 21:30 → sunrise−2h (04:20) · open now" /
  "closed now".
- Line 3: the live sub-state with countdown — `IN SESSION · ends m:ss` /
  `COOLDOWN · m:ss` / `ARMED — waiting for sustained music` /
  `SUPPRESSED — a show holds the deck` / `WINDOW CLOSED — …`.
- Action (at least 56 points, a verb): `ENABLE PARTY MODE` /
  `DISABLE PARTY MODE`. Disabling during a session confirms with the existing
  truth: "kills the running session immediately; detection keeps running".
- `PARTY SETTINGS` disclosure (48-point row) holding the trigger-playlist chips
  and the SUSTAIN / SESSION LENGTH / COOLDOWN steppers. Playlist names come
  from `availablePlaylists` — never hardcode a playlist name.

**MANUAL EVENTS card** (right-bottom): one button at least 52 points per
manual-trigger cue of the ACTIVE plan, derived and never hardcoded. Every
button names its event in text; every fire goes through `opConfirm` naming the
consequence. `BABY REVEAL…` opens the protected pink/blue flow and never fires
directly. Corner tag: `CONFIRM TO FIRE`.

The timeline AUTO toggle moves into the header `DETAILS` drawer with verb
labels `DISABLE TIMELINE AUTO` / `ENABLE TIMELINE AUTO`.

### 4. CALENDAR VIEW

Left rail about 180 points: festival day buttons `D1 · SUN` … at least 58
points each, with sunset/sunrise under each label, a `TODAY` badge on
`todayIndex`, and previous/next at the bottom.

Main area: the day chart beside a text cue list for the selected day.

- The chart is a full 24-hour column (an hour lane of 64 pixels, scrolling
  inside its own container, opened on the night span) with phase bands for the
  party-eligibility window, dashed sunset/sunrise markers, a resolved-segment
  ribbon down the left edge, cue blocks positioned proportionally, and the NOW
  playhead **on today's column only**.
- Every cue block keeps a hit region of at least 44 points regardless of its
  proportional height. In the mock that is a `::before` pseudo-element, which is
  the CSS equivalent of the app's `hitSlop`. Short blocks render their label on
  a single overflowing line.
- Fine grid labels may stay small **only** because the adjacent list repeats
  the same content at `timelineCue` size.
- A cue-block tap opens `EventSheet` review; `PERFORM` is offered only for
  today's live occurrence. An empty-lane tap snaps to the nearest 15 minutes and
  opens `EventSheet` in MOMENT mode, which offers `TIME TRAVEL HERE` and never
  `PERFORM`.
- This view renders `liveOverview` only.
- Editing is not done here: an `EDIT THIS DAY` button (48 points, quiet) jumps
  to EDIT PLAN with the day preselected. This is a deviation from the plan's
  "retain inline edit controls"; the rationale is that the draft/live separation
  of Decision 7 is worth more than one saved tap.

### 5. TIME TRAVEL view

**Left — TARGET.** Festival-day chips, the large target time (`timelineHero`,
tabular), `−15` / `+15` steppers at least 56 points, and the primary
`TIME TRAVEL HERE` (purple, at least 56 points). Under it, in plain words: "The
live clock and schedule keep running. RESUME LIVE returns the ship to now."
Previous/next EVENT steppers render **only while a travel zoom is active**,
because the engine's `{step}` form requires one; their errors are shown
verbatim and the target is retained.

**Right — RESOLVED PREVIEW (read-only).** On every target change, debounced
about 250 ms, `GET /timeline/resolve?date&time` renders owner label and kind,
playlist and palette, phase, controller, `window until`, master, hold, source
note, and the following cue. A 400 replaces the card with the engine's verbatim
message; no preview is ever invented and `TIME TRAVEL HERE` disables with the
reason while the resolve is failed or pending. Engine offline likewise refuses
to resolve and says so.

**Active travel** is a purple-framed panel inside the view: `TIME TRAVELING ·
D5 02:30` plus `RESUME LIVE` (at least 56 points), plus the deferred-show row
when `zoom.pendingDeferred` is set. The global purple `ZoomBanner` stays mounted
on every tab. Travel is one tap — it is non-destructive and reversible.

### 6. EDIT PLAN view

A draft-identity strip across the top: `EDITING DRAFT` + draft name,
`ACTIVE PLAN` + active name, and an identity verdict —
"SAME PLAN — saving hot-reloads the running show" or "DIFFERENT PLAN — this
draft is not what is running". Beside it the auto-save chip cycles
`UNSAVED` → `SAVING…` → `✓ SAVED`, or shows `⚠ FIX TO SAVE` /
`⚠ NOT SAVED · LIVE TOUCH` with `PREEMPT LIVE TOUCH + RETRY`.

**There is no save button.** Auto-save is the only save path, and saving the
ACTIVE plan hot-reloads the running show within about a second. Any mock or
implementation that says "no live action occurs until explicitly saved" is
stating a falsehood on a rig UI.

Left column: plan picker and explicit activation, festival editor, default-cue
editor, party advanced settings, and a collapsed `EVENT LOG & DIAGNOSTICS`
drawer showing `recentFires` including the lifecycle entries a restart leaves
behind. Right column: per-day cue list with `ADD CUE` / `EDIT` / `DELETE` and
the cue-editor sheet. Draft rows carry **no** FIRE button; the hint states the
gate, and when the draft is not the active plan the blocked reason is
`activate`.

### 7. Stale and offline presentation, in every view

- The client stamps `receivedAt` on every `timelineState`; the header pill flips
  to OFFLINE the moment the socket status or a REST failure says so.
- Alert slot 1 shows the age with a live counter.
- Every action button **disables with its reason in place**. Nothing is hidden
  and nothing is queued.
- Data regions stay rendered with a `STALE` chip per card; the party card uses
  its existing `ENGINE OFFLINE` state; the travel preview refuses to resolve.
- On reconnect the alert clears itself and the event log shows what happened
  while the pad was blind.

### 8. Typography, touch targets, colour

| Token | Font | Size / line height | Use |
| --- | --- | --- | --- |
| `timelineHero` | Space Grotesk 700 | 34 / 38 | NOW cue or program name |
| `timelineTitle` | Space Grotesk 700 | 24 / 28 | selected day, Time Travel target |
| `timelineCue` | Space Grotesk 700 | 18 / 22 | cue names and primary times (tabular numerals) |
| `timelineBody` | Inter 400 | 16 / 22 | explanations and status prose |
| `timelineMeta` | Inter 600 | 14 / 18 | secondary timing and behaviour |

Essential state never renders below 16 points. Targets: standard control at
least 48; `END SHOW`, `TIME TRAVEL HERE`, `RESUME LIVE`, the party toggle and
`UNLOCK OPERATOR CONTROLS` at least 56; manual events at least 52; any
interactive pill at least 44 of hit region; calendar blocks at least 44 via
hit-slop. Confirm dialogs place the destructive button on the screen half
**opposite** the button that opened them.

Colour is tokens only: `C.tertiary` live/auto/connected, `C.warning`
caution/another-driver, `C.error` failure/off/blackout, `C.primary` selection,
`PLAN_ACCENT` only where the identity system already uses it. The perform-green
and travel-purple pair stays the `ZoomBanner` constants for cross-tab
consistency. No glow on resting cards.

### 9. Every displayed datum, and where it really comes from

`[derived]` marks a pure client computation over the listed sources.

| # | Datum | Source |
| --- | --- | --- |
| H1 | Active plan name / running | `GET /timeline/state → activePlan, planActive` |
| H2 | Engine pill | socket `connected` + `state.engineConnected` |
| H3 | Controller pill | `state.controller`, `state.mode` |
| H4 | Audio pill | `state.currentMood`, `state.moodValue`, `state.moodStale`, `state.moodStaleForSec` — on the wire today, **not declared** in CaptainPad's `TimelineState` (typing gap) |
| H5 | Pre-festival note | `state.inFestivalWindow`, `state.festivalStartsInDays` |
| H6 | Plan warnings count | `state.planWarnings` (same typing gap as H4) |
| N1 | NOW owner | `state.activeCue` (program, `durationMin` window, or party session) when non-null; **else [derived]** from today's `liveOverview.days[todayIndex].segments` at now-minutes → `owner.label/kind`, `playlist`, `palette`, `source`. `controller === 'manual'` overrides to OPERATOR |
| N2 | NOW "since HH:MM" | **[derived]** newest `state.recentFires` entry (`kind:'fire'`) whose `cueId` is the owner; else the owning segment's `fromLocal`, labelled "scheduled" |
| N3 | NOW "until / next" | `state.activeCue.untilMs` (program hold or window); else the owning segment's `toLocal` plus the next segment's owner. `untilMs === null` on a program means "until you end it" |
| N4 | NEXT rows | **[derived]** `liveOverview` days `todayIndex` (plus the next day for cross-midnight) cues with `atLocal > now`, sorted. Tag from `cue.kind`, `trigger.type === 'sun'` → SUN, `action.globals.master === 0` → MASTER 0%, `durationMin` → length. `state.cues[].nextInSec` is today-only and in-window-only, hence the overview join |
| N5 | Program countdown | `state.activeProgram.untilMs` − now |
| N6 | Sequence step line | `state.activeSequence` |
| N7 | Event log drawer | `state.recentFires` (fires plus lifecycle) |
| P1 | Party ON/OFF | `GET /party-config → enabled` (mirrored by `state.partyEnabled`) |
| P2 | Eligibility window, open/closed | `state.phases.party_window {start,end}`; open when `state.currentPhase === 'party_window'` |
| P3 | IN SESSION + ends | `/party-config → effectiveState:'in_session'`, `sessionEndsAtMs`, `sessionFollowsMusic` |
| P4 | COOLDOWN m:ss | `effectiveState:'cooldown'`, `cooldownRemainingSec` |
| P5 | ARMED / NO PLAN / MANUAL | `effectiveState` |
| P6 | SUPPRESSED (a show holds the deck) | **[derived]** `state.controller === 'program'` while enabled |
| P7 | Session numbers and playlist chips | `/party-config → minDwellSec, durationMin, durationEnabled, cooldownSec, cooldownEnabled, playlist, availablePlaylists, effective*` |
| C1 | Festival days, weekday, dates, sun | `GET /timeline/overview → days[] {index, date, weekday, sun}` |
| C2 | Phase bands, resolved ribbon | `days[].phases`, `days[].segments` — absent means say so loudly, never draw empty |
| C3 | Day cue list and blocks | `days[].cues {atLocal, label, kind, trigger, action, durationMin}` |
| C4 | Today / NOW playhead | **[derived]** plan-timezone clock; today only |
| T1 | Travel preview | `GET /timeline/resolve?date&time`; a 400 is shown verbatim |
| T2 | Travel action and stepping | `POST /timeline/travel {date,time}` or `{cueId,date?}` or `{step}` |
| T3 | Active travel state | `state.zoom {scope,targetLocal,targetDate,pendingDeferred}` |
| T4 | Resume | `POST /timeline/resume` |
| E1 | Draft/active identity, autosave | local draft plus `TimelineDraftSaver` states; active from `state.activePlan` |
| E2 | Draft preview | `POST /timeline/overview` — a 400 is invalid and blocks the save; a transport error is not the same thing |
| E3 | Plans list / load / save / activate / delete | `/timeline/plans*`, `/timeline/plan/activate` |
| E4 | FIRE gating and blocked reason | **[derived]** cue id present in `liveOverview` ids; reason `save` versus `activate` |
| M1 | Manual event buttons | **[derived]** active-plan overview cues with `trigger.type === 'manual'`, deduped across days |
| X1 | Data age / STALE | **[derived]** client `receivedAt` stamp |
| F1 | Performance mode active | `GET /performance-mode` seed plus the control-bus broadcast |
| F2 | VIEW-ONLY versus UNLOCKED chip | client unlock state — waiver principal and expiry from the mint response |

**ENGINE GAPs.** None of these block the design; the derivations above ship
without them.

- **EG-1** (nice-to-have) — an additive `resolvedOwner` on `/timeline/state`
  would remove the N1 join. It is needed because `state.activeCue` is NULL for
  `kind: ambient` block cues with no `durationMin`, which is most of every
  night; the per-day resolved segments are the honest source that can name the
  block.
- **EG-2** (nice-to-have) — `ownerSinceMs`. The 50-entry `recentFires` ring can
  age out over a long night, making N2 fall back to the scheduled time.
- **EG-3** (nice-to-have) — `nextCues[]` on state, removing the N4 overview
  join.
- **EG-4** (nice-to-have) — an explicit party `effectiveState` for
  "suppressed by a program".
- **EG-5 / EG-6** (CaptainPad side) — the `receivedAt` stamp in `useTimeline`,
  and declaring `moodStale`, `moodStaleForSec`, `planWarnings`, `partyEnabled`
  in `TimelineState`.
- **EG-7** — there is no per-cue plain-language description field. The design
  uses the cue LABELS, which already carry "name — description" text, and never
  invents copy.
- **EG-8** (required, see section 11) — passcode-gate the remaining mutating
  timeline and party routes while performance mode is active.
- **EG-9** (nice-to-have) — a `meta.tier: dev|prod` tag on the show-plan schema;
  the `dev_` name convention suffices meanwhile.

### 10. PERFORMANCE mode composition

**Performance is a MODE of the Timeline tab, not a fifth view.** It is driven by
the engine-global performance flag, so every pad renders it identically and no
finger can wander out of it. Two changes make it reachable: the Timeline tab's
`showInPerformance` flips to `true`, and inside the tab the read-only
PERFORMANCE composition renders whenever performance mode is active and the pad
does not hold a live unlock. The four-view chrome renders only when performance
mode is off or the pad is unlocked.

The composition is its own layout, not "LIVE with holes" — a single full-width
column readable from a step back:

1. The persistent header, unchanged, including the one-alert ladder and the
   offline alert with its live age counter. A standing
   `PERFORMANCE — VIEW ONLY` chip in warning tokens sits at the right end of the
   pill cluster.
2. **NOW hero** — the LIVE NOW card scaled up: name at 40/44 in this
   composition only, ownership chip, playlist and palette, and the
   since/until/next line at 21 points. **No action buttons render, including
   END SHOW and RESUME LIVE**, because those are rig mutations.
3. **NEXT strip** — the next four transitions as one horizontal row of cards
   (tabular time at 21 points, label, tag). The cards are **non-interactive**
   here: the review sheet's own actions are mutations, and a dead-end sheet full
   of disabled buttons is worse than no sheet.
4. **Status band** — three equal read-only tiles: PARTY (state word, countdown,
   eligibility line), PHASE/ELIGIBILITY (`currentPhase`, window open or closed),
   AUDIO (mood and staleness).
5. **Event-log ticker** — the last three `recentFires` rows at body size, so a
   transition that just happened is explainable without unlocking.
6. **One interactive element**, bottom-right: `UNLOCK OPERATOR CONTROLS`, 56
   points, `C.warning` outline.

Offline honesty is identical to section 7: the offline alert with a live age
counter, `STALE` chips per tile, nothing blanked — and the unlock button stays
enabled, because unlock verification happens engine-side and will fail loudly
rather than pretend. Every datum renders at 16 points or larger; all five
themes and the `A+` toggle apply; the composition has exactly one touch target.

### 11. Password-gated takeover, and where enforcement honestly lives

The auth primitive already exists engine-side; the design reuses it and adds
nothing secret to the repo. Operator passphrases live in an external secrets
file named by an environment variable and never in this repository; a missing
or short value throws at boot. Verification is engine-side, per attempt, in
constant time, with a lockout of 60 seconds after 5 failures in 60 seconds. The
30-minute opaque **passcode waiver** is the remember option. The client half
already exists too: raw passcodes are never stored or logged, waivers are opaque
tokens bound to the engine origin, and the operator keypad already uses
56-point keys.

**The flow:**

1. `UNLOCK OPERATOR CONTROLS` opens the passcode sheet: a masked value, the
   56-point keypad, `CANCEL` / `UNLOCK` at 56 points or larger, and an optional
   `Remember for 30 minutes` row.
2. The pad verifies by minting a waiver — engine-verified, with no rig side
   effect. Success returns the principal and expiry; the pad enters UNLOCKED:
   the header chip becomes `UNLOCKED — <PRINCIPAL> · mm:ss`, counting down to
   waiver expiry, with a `RE-LOCK` action at 48 points, and the Timeline renders
   its normal chrome. The waiver token rides subsequent gated requests.
3. A wrong passcode returns the engine's 401, shown verbatim. The fifth failure
   returns a 429 whose `retryAfterMs` renders as a visible lockout countdown on
   the sheet — never a silent dead button.
4. Expiry, an engine restart, or an origin change invalidates the waiver: the
   pad drops back to VIEW-ONLY automatically and says why —
   "unlock expired — enter the passcode again". Re-lock is also manual.
5. On an auth-disabled bench engine the waiver route answers 503
   `PRIVILEGED_AUTH_DISABLED`, and the unlock degrades to an explicit
   `opConfirm` — "This bench engine has no operator passcodes — unlock
   controls?" — never a fake keypad.

Sessions and waivers live in engine memory, while the performance LOCK itself
resumes from the pre-show snapshot marker. That is the right failure posture:
after a mid-show crash every pad comes back VIEW-ONLY.

**Where enforcement honestly lives — stated plainly.**

- **Client-side, today, complete:** the VIEW-ONLY composition simply does not
  render mutating controls until the engine has verified a passcode. The pad
  never compares secrets locally.
- **Engine-side, today, PARTIAL:** in performance mode the engine already
  refuses `POST /timeline/takeover`, `POST /special-events/arm`, and Live Touch
  re-takeover without a fresh passcode or waiver. But these mutating routes
  carry **no** passcode gate in performance mode: `POST
  /timeline/plan/activate`, `/timeline/autopilot`, `/timeline/travel` (which
  enters a scoped takeover without the gate the plain takeover has),
  `/timeline/cues/:id/fire`, `/timeline/program/end|enable|dismiss`,
  `POST/PUT/DELETE /timeline/plans*`, and `PUT /party-config`. A stale pad or a
  script can mutate the running show without any passcode.

  **ENGINE GAP EG-8 (required to make the guarantee true rather than merely
  presented): while performance mode is active, apply the existing
  passcode-or-waiver gate to the routes listed above.** Read-only routes
  (`/timeline/state`, `/timeline/overview`, `GET /timeline/plans`,
  `/timeline/resolve`) stay open.

  Until EG-8 lands, the unlock chip copy must read **"controls unlocked on this
  pad"** and never "timeline unlocked". Both mocks state this in their footer.

### 12. Dev plans versus the show plan

Plans are per-scene YAML files, listed and loaded from the scene's `timeline/`
directory, so a dev plan is just another plan selected through the existing
PLANS picker. The show plan is `playa_default` in the titanic scene.

**The artifact.** `dev_runup` lives at
`simulation/scenes/test_bench/timeline/dev_runup.yaml`, because the bench stack
is where run-up testing happens. Its assert-spec sibling is
`marsin_engine/tests/fixtures/timeline/dev_runup_spec.yaml`, alongside the
other dry-run fixtures. **The spec file must not sit in a scene's `timeline/`
directory**: the plan lister treats every `.yaml` there as a plan, so a spec
file placed beside the plan would appear in the operator's PLANS picker as a
broken entry.

Structure: `schemaVersion: 2`, a five-day festival, one `party_window` phase
shaped exactly like the show plan's, and a phase-aware default cue. Fifteen
fictional cues, one per feature the operator surfaces need — a three-chapter
"demo hour" at 17:00 / 17:12 / 17:24 so transitions can be watched live rather
than waited out overnight, a sun-anchored directed opener that authors master,
night chapters with a quiet reset between them, a cross-midnight carry, a
day-specific cue, a mood/party cue with short dwell and cooldown, three manual
events (a sequence show, an unheld beacon, and a bounded window), a morning hold,
and a hard lights-out. Every playlist name must exist in the target scene's
playlist library — the validator fails loudly on a dangling name.

**Contiguity is the design constraint that shapes the holds.** When a
`kind: program` cue's hold expires with no cue behind it, the deck falls to the
default cue, and dry-run class 1 correctly reports those minutes as ownerless.
Every program hold in `dev_runup` therefore ends exactly where the next owner
begins: the opener holds `until` the first night chapter's clock time rather
than for a bare duration, the morning hold ends at the lights-out clock, and the
day-specific cue is `kind: ambient` so it cannot strand the minutes before the
next chapter.

**Dating, and the public repo.** A plan file requires `festival.startDate`.
Tracked show-plan YAML already carries festival dates as show content, but a
run-up plan with real rehearsal dates would announce a rehearsal calendar in a
public repository. The tracked `dev_runup.yaml` therefore carries a **neutral
past** start date, and the first step of every test session is retargeting the
start to today with the existing FestivalEditor DateWheel. That edit auto-saves
into the tracked file: treat it exactly like the engine's other runtime residue
in tracked files — report it, never commit it.

**Making dev versus prod unmistakable.** No engine change is needed.

1. **The name is the switch.** A plan whose name starts with `dev_` is a DEV
   plan. Whenever the ACTIVE plan is a dev plan, in all four views and in the
   performance composition, a full-width banner renders directly under the view
   tabs: `⚠ DEV PLAN — NOT THE SHOW PLAN`, in `timelineMeta` caps, `C.warning`
   on `warningContainer` with `warningContainerBorder`, minimum height 40
   points, **never collapsible and never part of the one-alert slot** — it is
   standing identity, not an alert. The header plan name gets a `DEV` tag; the
   plan-picker rows show the same tag; the EDIT PLAN draft-identity strip
   repeats it.
2. **Belt on the show rig.** Whenever `state.activePlan` is non-null and differs
   from the pinned show-plan name, the informational tier of the alert ladder
   (level 7) carries "Active plan is not the show plan". The show-plan name is a
   CaptainPad constant beside `PLAN_ACCENT`.

### 13. Run-up test plan (operator procedure, bench stack)

Agents never run this; it is the operator's acceptance pass on the bench.

0. **Preconditions.** Bench engine on the `test_bench` scene, CaptainPad pointed
   at the bench. The show stack stays untouched throughout.
1. **Offline gate first.** From `marsin_engine/`, run the dry-run harness
   against `dev_runup` with `--assert` and the `dev_runup_spec.yaml`
   assert-spec. Expect `ASSERT RESULT: PASS (0 violations)`, exit code 0, and
   all eight classes asserted with no SKIP lines.
2. **PLANS:** load and ACTIVATE `dev_runup`. Good: the DEV banner on every view,
   the header tag, the picker tag; the show plan stays inactive.
3. **EDIT PLAN:** retarget the festival start to today with the DateWheel. Good:
   the autosave chip walks UNSAVED, SAVING…, ✓ SAVED and the strip re-previews.
   Then make one INVALID edit (a junk timezone) and expect `⚠ FIX TO SAVE` plus
   the engine's 400 verbatim; fix it and watch it return to SAVED. Do not commit
   the dated residue.
4. **LIVE during the demo hour:** watch two chapter transitions land at 17:12
   and 17:24. Good: NOW flips within a tick, NEXT re-ranks, the event log grows,
   and there is no flicker at the boundary.
5. **CALENDAR VIEW:** step all five days; a cue tap opens the review sheet with
   no rig movement; an empty-lane tap opens the 15-minute-snapped moment review.
6. **TIME TRAVEL:** preview several instants including one outside the festival
   window (expect the verbatim 400, no preview, and the button disabled with the
   reason); travel to a night chapter; step previous/next events; verify the
   purple banner on the Deck tab; `RESUME LIVE`. Good: catch-up returns the
   time-owning cue.
7. **Events and resume:** fire the beacon, then END SHOW. Good: the deck resumes
   into the chapter that owns "now", never the beacon again. Fire the sequence
   show — the step line counts 1/2 then 2/2. Fire the bounded window — when it
   elapses the displaced owner is restored.
8. **Party:** ENABLE PARTY MODE and drive party audio at the bench companion.
   Good: a session only inside the window, an honest session countdown, DISABLE
   mid-session kills it immediately, the cooldown counts down honestly, and
   nothing fires before the window opens.
9. **Restart probe:** mid-chapter, bounce the BENCH engine. Good: the pad shows
   OFFLINE with a data age and never stale-as-live; on reconnect the same
   chapter owns the deck and the event log shows the lifecycle entries.
10. **Performance composition** (once sections 10 and 11 land): enter
    performance mode on the bench and verify VIEW-ONLY; unlock via the keypad,
    or via the bench confirm when auth is disabled; verify the lockout after
    five bad attempts; let the waiver expire and watch the automatic re-lock.
11. File a dated report and confirm with `git status` that the show-plan YAML is
    untouched.

### 14. Demo states in the mocks

**Four-view mock** — a persistent bottom-right demo dock plus keys `1`–`9`
(and `T` to cycle themes). Every scenario changes what is rendered:

| # | State | What it pins |
| --- | --- | --- |
| S1 | NIGHT BLOCK | 02:17. NOW = `Deep night 2 — UV Lasers` (`night_uv_lasers · ultraviolet`, since 01:10, until 02:30 → Quiet reset 2); party ON, window open, ARMED; alert slot empty |
| S2 | PARTY COOLDOWN | 02:37. NOW = `Quiet reset 2 — Electric Ice hush` (since 02:30, until 02:40 → Ember Hold); party ON, window open, `COOLDOWN 11:23` |
| S3 | PARTY SESSION | 23:52. Ownership chip `PARTY SESSION`, name `Party session` (`party_high · bass_drop`), ends 7:41; party pill `IN SESSION`; the NEXT list crosses midnight into the next day |
| S4 | DUST STORM | NOW = `DUST STORM — high-visibility beacon`, chip `SHOW`, "holds until you end it", `END SHOW` present; CONTROL pill `SHOW RUNNING`; party line `SUPPRESSED — a show holds the deck` |
| S5 | MORNING WATCH | 07:30. NOW = `Morning Watch — steady reduced visibility` until 09:00 with a live countdown; first NEXT row `09:00 · Day Off · MASTER 0%`; party `WINDOW CLOSED` |
| S6 | ENGINE OFFLINE | Alert slot 1 with a counting age; every action disabled with its reason; STALE chips on all data cards; the NOW card loses its live treatment; party card `ENGINE OFFLINE` |
| S7 | TIME TRAVEL ACTIVE | A travel zoom; purple in-view panel and `RESUME LIVE`; a badge on the TIME TRAVEL tab; header alert 4; the tab opens on TIME TRAVEL |
| S8 | AUDIO STALE | S1 plus an `AUDIO STALE 214s` pill and alert 5 |
| S9 | DEV PLAN | S1 running `dev_runup`: the standing DEV banner under the tabs, the `DEV` tag on the plan name, the level-7 "not the show plan" alert, DEV tags in the picker and the draft strip |

Independent toggles stack alerts so the ladder can be watched collapsing into
`DETAILS (n)`: action rejected (2), Live Touch handoff (3), draft invalid (6),
plan warnings (7), and a travel-resolve 400.

**Performance mock** — six states, keys `1`–`6`, plus a selector for which
night state (S1 / S2 / S4 / S5) is rendered underneath:

| # | State | What it pins |
| --- | --- | --- |
| P1 | LOCKED | The default: view-only, `PERFORMANCE — VIEW ONLY` chip, one unlock target |
| P2 | KEYPAD | The unlock sheet: masked value, 56-point keypad, Remember-30-min row, CANCEL/UNLOCK, a wrong-code path showing the verbatim 401, and a fifth-failure path showing the 429 lockout with a live countdown |
| P3 | UNLOCKED | Chip `UNLOCKED — OWNER · 29:41` counting down, plus `RE-LOCK`; the four-view chrome appears with LIVE controls enabled and EDIT PLAN disabled with its reason |
| P4 | ENGINE RESTART | LOCKED plus the offline alert with a counting age; a reconnect shows "unlock expired — enter the passcode again" |
| P5 | BENCH (auth disabled) | Unlock opens the 503 `PRIVILEGED_AUTH_DISABLED` confirm instead of a keypad |
| P6 | DUST STORM LOCKED | The S4 data under LOCKED — proving an emergency is fully VISIBLE view-only, with the unlock path one tap away |

Demo data in both mocks is the real night arc: cue ids, labels, playlists and
palettes as authored in the show plan, with representative sun times and day
labels `D1 · SUN` … `D9 · MON`.

### 15. Theme rules

All five palettes (`light`, `dark`, `midnight`, `sunset`, `gruvbox`) must render
every view; the mocks carry all five as CSS custom-property sets copied from
`CaptainPad/constants/theme.ts`, with a switcher, and default to `dark`. LIGHT
is the sun theme; MIDNIGHT and SUNSET are the four-in-the-morning themes, and
the mocks expose that as a DAY / NIGHT legibility preset. The `A+` toggle raises
`timelineBody` 16→19 and `timelineCue` 18→21 and nothing else; layout must
absorb it without clipping. The semantic mapping is fixed across themes
(tertiary = live, warning = caution, error = failure/off) and every state word
accompanies its colour. Perform-green and travel-purple are cross-theme
constants matching `ZoomBanner`, always paired with their words. The mocks also
carry a clearly labelled sun-glare simulation, which is a preview aid for
judging daylight legibility and not an app feature.

### 16. SINA DECIDES — the open choices

Each is tagged in the mocks with a chip on the element it governs, so the open
questions are visible on screen rather than buried in prose. The mocks implement
the recommendation in every case.

| # | Choice | Option A | Option B | Recommended |
| --- | --- | --- | --- | --- |
| SD-1 | Zoom exit gesture | Drop the "returning to the Timeline tab exits the zoom" auto-resume; exits become `RESUME LIVE` and the banner `EXIT` only | Keep the auto-exit; the Time Travel view then only shows pre-travel selection | **A** — the gesture predates a Time Travel surface and would cancel a travel the operator came to inspect |
| SD-2 | Calendar editing | `EDIT THIS DAY` jumps to EDIT PLAN with the day preselected | Inline add/edit on the calendar, as today | **A** — the draft/live separation is worth more than one saved tap |
| SD-3 | Manual events on LIVE | All manual cues of the active plan, with BABY REVEAL opening its protected flow | Urgent-only (dust storm); the rest stay on the Events tab | **A** — one place at 3 am |
| SD-4 | Timeline AUTO toggle | Header DETAILS drawer with verb labels | Stays a LIVE-view button | **A** — rare and consequential, not per-night |
| SD-5 | Audio-stale alert rank | Ladder slot 5 | Elevate above the zoom slot whenever party is enabled | **A** |
| SD-6 | NEXT list depth | Four transitions | Six, or the full remaining night | Four as specified |
| SD-7 | View structure | Four views (LIVE / CALENDAR VIEW / TIME TRAVEL / EDIT PLAN) | Three views, with Time Travel folded into the schedule view | **A** — Time Travel is a rig-moving mode with its own engine state and failure surface, and the calendar must stay a surface that can never move the rig |
| SD-8 | `TIME TRAVEL HERE` confirmation | One tap — non-destructive and reversible | Add an `opConfirm` step | **A** |
| SD-9 | Unlock scope in performance mode | Unlock reveals the full four-view Timeline | Unlock reveals LIVE controls only; EDIT PLAN stays frozen | **B** — matching the engine's own perf-mode freeze on structural writes |
| SD-10 | Remember-30-min default | Pre-checked — fewer 3 am keypads | Off by default — a passcode every time | **B** |
| SD-11 | Emergency actions under VIEW-ONLY | Everything locked; the keypad is one tap away | END SHOW and/or dust storm reachable with a confirm but no passcode | **A** — the keypad is fast and the ruling was "passcode every time" |
| SD-12 | Dev-plan placement and the pinned show-plan name | `test_bench` only | A copy also in the titanic scene for on-rig rehearsal | Confirm the pinned show-plan constant either way |
| SD-13 | Dev-plan dating | Tracked with a neutral past start date, retargeted at session start, residue never committed | Keep the dev plan untracked and gitignored | **A** — a public repo must never announce a rehearsal calendar |

### 17. Rebuilding the mocks from this document

Everything above is sufficient to rebuild both files; the appendices carry the
exact sources. The load-bearing constraints, restated as a checklist:

- One standalone HTML file each, no external requests of any kind, all CSS and
  JS inline, system font stacks only.
- The 112-point rail rendered as **labelled context only**, with a top demo
  ribbon reading "Interactive design mock — no engine connection; nothing saves
  or fires." Rail taps show a toast and never navigate. The real Timeline screen
  must never draw the rail.
- No invented endpoints or buttons: everything on screen maps to a route the
  engine actually serves.
- Confirm modals name their consequence, and the destructive button sits
  opposite the invoking button's screen half.
- The travel preview visibly changes with the dial; the calendar NOW playhead
  renders only on today's column.
- Touch floors enforced in CSS: 48 standard, 56 for END SHOW / TIME TRAVEL HERE
  / RESUME LIVE / party toggle / UNLOCK OPERATOR CONTROLS, 52 for manual events,
  44 absolute including calendar blocks via pseudo-element hit areas.
- No machine paths, usernames, addresses, or future dates anywhere in either
  file — both are embedded in this public document.

## Appendix — Mock source (`CaptainPad/design_mocks/timeline_operator_redesign.html`)

The complete four-view mock is tracked at
`CaptainPad/design_mocks/timeline_operator_redesign.html`. It opens directly in
any browser and makes no network requests.

``````html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CaptainPad Timeline — operator redesign mock</title>
<style>
/* ==================================================================
   CaptainPad Timeline operator redesign — INTERACTIVE DESIGN MOCK.
   Standalone, fully offline: no CDNs, no @font-face URLs, no images,
   no fetch/XHR, no telemetry. System font stacks only.
   Palettes copied from CaptainPad/constants/theme.ts (5 themes).
   1 pt is rendered as 1 px here.
   ================================================================== */

/* ---- theme token sets (light / dark / midnight / sunset / gruvbox) ---- */
:root[data-theme="light"]{
  --text:#191c1d; --bg:#f8f9fa;
  --surface:#f8f9fa; --surf-low:#f3f4f5; --surf-lowest:#ffffff; --surf-high:#e7e8e9; --surf-dim:#d9dadb;
  --primary:#006875; --primary-container:#00e5ff; --on-primary:#ffffff;
  --secondary:#466270; --secondary-container:#c6e4f4;
  --error:#ba1a1a; --error-container:rgba(186,26,26,0.08); --error-border:rgba(186,26,26,0.3);
  --tertiary:#1b9e77;
  --warning:#6f4d00; --warning-container:rgba(111,77,0,0.08); --warning-border:rgba(111,77,0,0.3);
  --ghost:rgba(186,201,204,0.4); --border-strong:rgba(70,98,112,0.85);
  --shadow:rgba(25,28,29,0.05);
  --sidebar-bg:rgba(255,255,255,0.6); --sidebar-active-bg:rgba(0,229,255,0.1); --sidebar-active-border:rgba(0,229,255,0.3);
}
:root[data-theme="dark"]{
  --text:#e3e6e8; --bg:#0f1416;
  --surface:#0f1416; --surf-low:#171d20; --surf-lowest:#0a0e10; --surf-high:#1f262a; --surf-dim:#0a0e10;
  --primary:#5ae0ee; --primary-container:#003640; --on-primary:#003640;
  --secondary:#a8c5d4; --secondary-container:#2a3e48;
  --error:#ff8a82; --error-container:rgba(255,138,130,0.16); --error-border:rgba(255,138,130,0.45);
  --tertiary:#34d39a;
  --warning:#f5a623; --warning-container:rgba(245,166,35,0.16); --warning-border:rgba(245,166,35,0.45);
  --ghost:rgba(180,195,200,0.18); --border-strong:rgba(180,195,200,0.55);
  --shadow:rgba(0,0,0,0.5);
  --sidebar-bg:rgba(15,20,22,0.85); --sidebar-active-bg:rgba(90,224,238,0.12); --sidebar-active-border:rgba(90,224,238,0.4);
}
:root[data-theme="midnight"]{
  --text:#d4dde8; --bg:#06080c;
  --surface:#06080c; --surf-low:#0d1320; --surf-lowest:#04060a; --surf-high:#152030; --surf-dim:#04060a;
  --primary:#5cc0ff; --primary-container:#003a5c; --on-primary:#001827;
  --secondary:#7a8a9e; --secondary-container:#2a3a4c;
  --error:#ff7a82; --error-container:rgba(255,122,130,0.16); --error-border:rgba(255,122,130,0.45);
  --tertiary:#3ad4a6;
  --warning:#f5a623; --warning-container:rgba(245,166,35,0.16); --warning-border:rgba(245,166,35,0.45);
  --ghost:rgba(150,170,200,0.18); --border-strong:rgba(150,170,200,0.65);
  --shadow:rgba(0,0,0,0.6);
  --sidebar-bg:rgba(6,8,12,0.88); --sidebar-active-bg:rgba(92,192,255,0.12); --sidebar-active-border:rgba(92,192,255,0.4);
}
:root[data-theme="sunset"]{
  --text:#f4e8d8; --bg:#1a0f0a;
  --surface:#1a0f0a; --surf-low:#251812; --surf-lowest:#100905; --surf-high:#2e2017; --surf-dim:#100905;
  --primary:#ffb84a; --primary-container:#5a3a00; --on-primary:#3a2400;
  --secondary:#b89478; --secondary-container:#3e2e1a;
  --error:#ff8a6a; --error-container:rgba(255,138,106,0.16); --error-border:rgba(255,138,106,0.45);
  --tertiary:#9acb87;
  --warning:#ffd166; --warning-container:rgba(255,209,102,0.16); --warning-border:rgba(255,209,102,0.45);
  --ghost:rgba(180,150,120,0.18); --border-strong:rgba(180,150,120,0.7);
  --shadow:rgba(0,0,0,0.55);
  --sidebar-bg:rgba(26,15,10,0.88); --sidebar-active-bg:rgba(255,184,74,0.12); --sidebar-active-border:rgba(255,184,74,0.4);
}
:root[data-theme="gruvbox"]{
  --text:#ebdbb2; --bg:#282828;
  --surface:#282828; --surf-low:#32302f; --surf-lowest:#1d2021; --surf-high:#3c3836; --surf-dim:#1d2021;
  --primary:#fabd2f; --primary-container:#665c54; --on-primary:#282828;
  --secondary:#a89984; --secondary-container:#3c3836;
  --error:#fb4934; --error-container:rgba(251,73,52,0.16); --error-border:rgba(251,73,52,0.45);
  --tertiary:#b8bb26;
  --warning:#ffb04d; --warning-container:rgba(255,176,77,0.16); --warning-border:rgba(255,176,77,0.45);
  --ghost:rgba(168,153,132,0.25); --border-strong:rgba(168,153,132,0.85);
  --shadow:rgba(0,0,0,0.55);
  --sidebar-bg:rgba(40,40,40,0.88); --sidebar-active-bg:rgba(250,189,47,0.12); --sidebar-active-border:rgba(250,189,47,0.4);
}

/* ---- cross-theme constants (ZoomBanner.tsx) ---- */
:root{
  --perform-green:#00a86b;
  --travel-purple:#8b5cf6;

  /* shape + rhythm (Radius / Space in theme.ts) */
  --r-chip:4px; --r-control:8px; --r-card:12px; --r-panel:16px; --r-shell:24px;
  --sp-xs:4px; --sp-sm:8px; --sp-md:12px; --sp-lg:16px; --sp-xl:24px;

  /* Timeline type recipes (docs/78) — headings Space Grotesk, body Inter.
     The app loads the real families from local packages; this mock declares
     stacks with system fallbacks so it issues zero network requests. */
  --f-head:"Space Grotesk", ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
  --f-body:"Inter", ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
  --t-hero:34px;  --lh-hero:38px;
  --t-title:24px; --lh-title:28px;
  --t-cue:18px;   --lh-cue:22px;
  --t-body:16px;  --lh-body:22px;
  --t-meta:14px;  --lh-meta:18px;
}
/* A+ large-type toggle: body 16->19, cue 18->21. Nothing else scales. */
:root[data-aplus="on"]{ --t-body:19px; --lh-body:25px; --t-cue:21px; --lh-cue:25px; }

*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{
  background:var(--bg); color:var(--text);
  font-family:var(--f-body); font-size:var(--t-body); line-height:var(--lh-body);
  -webkit-font-smoothing:antialiased;
}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;text-align:left;}
button:disabled{cursor:not-allowed;opacity:0.45;}
h1,h2,h3,h4{margin:0;font-family:var(--f-head);font-weight:700;}

/* sun-glare simulation — MOCK PREVIEW AID ONLY, not an app feature */
#glare{position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:900;transition:opacity .2s;}
body[data-glare="on"] #glare{opacity:0.30;}

/* ---------------- demo ribbon ---------------- */
#ribbon{
  display:flex;align-items:center;gap:var(--sp-md);
  padding:8px 16px;background:var(--warning-container);
  border-bottom:1px solid var(--warning-border);
  font-size:var(--t-meta);line-height:var(--lh-meta);color:var(--text);
}
#ribbon .dot{width:10px;height:10px;border-radius:50%;background:var(--warning);flex:0 0 auto;}
#ribbon b{font-family:var(--f-head);letter-spacing:.6px;}

/* ---------------- app shell ---------------- */
#shell{display:flex;min-height:calc(100vh - 36px);}

/* the global 112pt rail — rendered here as labelled CONTEXT ONLY.
   The real Timeline screen never draws this; app/(tabs)/_layout.tsx owns it. */
#rail{
  width:112px;flex:0 0 112px;background:var(--sidebar-bg);
  border-right:1px solid var(--ghost);padding:10px 6px 16px;
  display:flex;flex-direction:column;gap:2px;
}
#rail .brand{font-family:var(--f-head);font-size:11px;letter-spacing:1.2px;
  text-transform:uppercase;color:var(--secondary);text-align:center;padding:6px 0 10px;}
#rail .group{font-family:var(--f-head);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;
  color:var(--secondary);padding:10px 6px 4px;}
#rail .item{
  min-height:44px;display:flex;flex-direction:column;justify-content:center;
  padding:6px 8px;border-radius:var(--r-control);border:1px solid transparent;
  font-family:var(--f-head);font-size:12px;letter-spacing:.4px;color:var(--secondary);
}
#rail .item .glyph{font-size:11px;color:var(--secondary);opacity:.7;}
#rail .item.on{background:var(--sidebar-active-bg);border-color:var(--sidebar-active-border);color:var(--text);}
#rail .item.on .glyph{color:var(--primary);opacity:1;}
#rail .ctx{margin-top:auto;font-size:9px;line-height:13px;color:var(--secondary);
  text-align:center;padding-top:12px;border-top:1px solid var(--ghost);}

/* ---------------- workspace ---------------- */
#work{flex:1 1 auto;min-width:0;padding:var(--sp-lg) var(--sp-lg) 64px;display:flex;flex-direction:column;gap:var(--sp-md);}

.hdr{
  display:flex;align-items:center;gap:var(--sp-lg);
  background:var(--surf-low);border:1px solid var(--ghost);border-radius:var(--r-panel);
  padding:var(--sp-md) var(--sp-lg);min-height:64px;
}
.hdr .ident{min-width:0;flex:0 0 auto;max-width:300px;}
.kicker{font-family:var(--f-body);font-weight:600;font-size:var(--t-meta);line-height:var(--lh-meta);
  letter-spacing:1px;text-transform:uppercase;color:var(--secondary);}
.hdr .plan{font-family:var(--f-head);font-size:var(--t-title);line-height:var(--lh-title);
  display:flex;align-items:center;gap:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rundot{width:12px;height:12px;border-radius:50%;flex:0 0 auto;}
.hdr .pills{display:flex;flex-wrap:wrap;gap:var(--sp-sm);flex:1 1 auto;min-width:0;}
.pill{
  display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:4px 10px;
  border-radius:var(--r-control);border:1px solid var(--ghost);background:var(--surf-lowest);
  font-family:var(--f-head);font-size:13px;letter-spacing:.5px;white-space:nowrap;
}
.pill .lb{color:var(--secondary);font-size:11px;letter-spacing:1.2px;}
.pill .dt{width:9px;height:9px;border-radius:50%;}
.ok{color:var(--tertiary);}   .warn{color:var(--warning);}   .bad{color:var(--error);}
.bg-ok{background:var(--tertiary);} .bg-warn{background:var(--warning);} .bg-bad{background:var(--error);}
.bg-sec{background:var(--secondary);}

.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  min-height:48px;padding:0 16px;border-radius:var(--r-control);
  border:1px solid var(--border-strong);background:var(--surf-lowest);color:var(--text);
  font-family:var(--f-head);font-size:15px;letter-spacing:.6px;text-transform:uppercase;
}
.btn.big{min-height:56px;font-size:16px;padding:0 20px;}
.btn.evt{min-height:52px;}
.btn.pri{background:var(--primary);color:var(--on-primary);border-color:var(--primary);}
.btn.danger{background:var(--error-container);border-color:var(--error-border);color:var(--error);}
.btn.travel{background:rgba(139,92,246,0.16);border-color:var(--travel-purple);color:var(--travel-purple);}
.btn.quiet{border-color:var(--ghost);color:var(--secondary);}
.btn.wide{width:100%;}

/* segmented four-view control */
.seg{display:flex;gap:var(--sp-sm);}
.seg button{
  flex:1 1 0;min-height:56px;border-radius:var(--r-control);
  border:1px solid var(--ghost);background:var(--surf-lowest);
  display:flex;align-items:center;justify-content:center;gap:8px;
  font-family:var(--f-head);font-size:16px;letter-spacing:1px;text-transform:uppercase;color:var(--secondary);
}
.seg button.on{background:var(--sidebar-active-bg);border-color:var(--sidebar-active-border);color:var(--text);}
.seg .badge{
  min-width:22px;height:22px;padding:0 6px;border-radius:11px;
  background:var(--travel-purple);color:#fff;font-size:11px;letter-spacing:.4px;
  display:inline-flex;align-items:center;justify-content:center;
}

/* alert slot */
.alert{border-radius:var(--r-card);border:1px solid var(--ghost);background:var(--surf-lowest);padding:var(--sp-md) var(--sp-lg);}
.alert.e{background:var(--error-container);border-color:var(--error-border);}
.alert.w{background:var(--warning-container);border-color:var(--warning-border);}
.alert.t{background:rgba(139,92,246,0.14);border-color:var(--travel-purple);}
.alert.i{background:var(--surf-low);}
.alert .row{display:flex;align-items:center;gap:var(--sp-md);flex-wrap:wrap;}
.alert .ttl{font-family:var(--f-head);font-size:var(--t-cue);line-height:var(--lh-cue);letter-spacing:.6px;}
.alert .bod{font-size:var(--t-body);line-height:var(--lh-body);margin-top:2px;}
.alert .spacer{flex:1 1 auto;}
.detrow{
  min-height:48px;display:flex;align-items:center;gap:var(--sp-md);padding:0 var(--sp-lg);
  border-radius:var(--r-card);border:1px solid var(--ghost);background:var(--surf-low);
  font-family:var(--f-head);font-size:14px;letter-spacing:.8px;text-transform:uppercase;color:var(--secondary);
}
.drawer{border-radius:var(--r-card);border:1px solid var(--ghost);background:var(--surf-low);padding:var(--sp-md) var(--sp-lg);}
.drawer .mini{border-left:3px solid var(--ghost);padding:6px 0 6px 10px;margin:6px 0;}

/* generic panels */
.grid2{display:flex;gap:var(--sp-lg);flex:1 1 auto;min-height:0;}
.col-l{flex:62 1 0;min-width:0;display:flex;flex-direction:column;gap:var(--sp-lg);}
.col-r{flex:38 1 0;min-width:0;display:flex;flex-direction:column;gap:var(--sp-lg);}
.card{background:var(--surf-low);border:1px solid var(--ghost);border-radius:var(--r-panel);padding:var(--sp-lg);}
.card.live{background:var(--surf-lowest);border-color:var(--tertiary);box-shadow:0 0 0 1px var(--tertiary), 0 8px 28px var(--shadow);}
.card h3{font-size:var(--t-cue);line-height:var(--lh-cue);letter-spacing:.8px;text-transform:uppercase;}
.cardhead{display:flex;align-items:center;gap:var(--sp-sm);flex-wrap:wrap;margin-bottom:var(--sp-md);}
.cardhead .spacer{flex:1 1 auto;}

.hero{font-family:var(--f-head);font-size:var(--t-hero);line-height:var(--lh-hero);margin:6px 0 2px;}
.sub{font-size:var(--t-body);line-height:var(--lh-body);color:var(--secondary);}
.times{display:flex;align-items:center;gap:var(--sp-md);margin-top:var(--sp-md);flex-wrap:wrap;
  font-family:var(--f-head);font-size:var(--t-cue);line-height:var(--lh-cue);font-variant-numeric:tabular-nums;}
.bar{flex:1 1 120px;min-width:80px;height:10px;border-radius:5px;background:var(--surf-high);overflow:hidden;}
.bar i{display:block;height:100%;background:var(--tertiary);}
.actions{display:flex;gap:var(--sp-md);margin-top:var(--sp-lg);flex-wrap:wrap;}

.tag{
  display:inline-flex;align-items:center;min-height:26px;padding:2px 8px;border-radius:var(--r-chip);
  border:1px solid var(--ghost);background:var(--surf-high);
  font-family:var(--f-head);font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--secondary);
}
.tag.now{border-color:var(--tertiary);color:var(--tertiary);background:transparent;}
.tag.stale{border-color:var(--warning-border);color:var(--warning);background:var(--warning-container);}
.tag.off{border-color:var(--error-border);color:var(--error);background:var(--error-container);}
.tag.dev{border-color:var(--warning-border);color:var(--warning);background:var(--warning-container);}

/* standing DEV-PLAN identity banner — never collapsible, never an alert */
.devbanner{
  display:flex;align-items:center;gap:var(--sp-md);min-height:40px;padding:6px var(--sp-lg);
  border-radius:var(--r-card);background:var(--warning-container);border:1px solid var(--warning-border);
  color:var(--warning);font-family:var(--f-body);font-weight:600;
  font-size:var(--t-meta);line-height:var(--lh-meta);letter-spacing:1.2px;text-transform:uppercase;
}

/* NEXT list */
.nextlist{display:flex;flex-direction:column;gap:var(--sp-sm);}
.nextrow{
  min-height:60px;display:flex;align-items:center;gap:var(--sp-md);padding:6px var(--sp-md);
  border-radius:var(--r-card);border:1px solid var(--ghost);background:var(--surf-lowest);
}
.nextrow .t{font-family:var(--f-head);font-size:var(--t-cue);line-height:var(--lh-cue);
  font-variant-numeric:tabular-nums;flex:0 0 74px;}
.nextrow .l{font-family:var(--f-head);font-size:var(--t-cue);line-height:var(--lh-cue);
  flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.nextrow .g{flex:0 0 auto;display:flex;gap:6px;}

/* party + manual */
.pline{margin-top:var(--sp-sm);}
.pline.a{font-family:var(--f-head);font-size:var(--t-title);line-height:var(--lh-title);}
.pline.b{font-size:var(--t-body);line-height:var(--lh-body);color:var(--secondary);}
.pline.c{font-family:var(--f-head);font-size:var(--t-cue);line-height:var(--lh-cue);font-variant-numeric:tabular-nums;}
.evtgrid{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-sm);}
.stepper{display:flex;align-items:center;gap:var(--sp-sm);margin:var(--sp-sm) 0;}
.stepper .lab{flex:1 1 auto;font-size:var(--t-body);}
.stepper .val{font-family:var(--f-head);font-size:var(--t-cue);font-variant-numeric:tabular-nums;min-width:74px;text-align:right;}
.stepper .btn{min-width:48px;padding:0 12px;}
.chiprow{display:flex;gap:var(--sp-sm);flex-wrap:wrap;margin:var(--sp-sm) 0;}
.chip{min-height:44px;padding:0 14px;display:inline-flex;align-items:center;border-radius:var(--r-control);
  border:1px solid var(--ghost);background:var(--surf-lowest);font-family:var(--f-head);font-size:14px;letter-spacing:.5px;}
.chip.on{border-color:var(--primary);background:var(--sidebar-active-bg);color:var(--text);}

/* calendar */
.calwrap{display:flex;gap:var(--sp-lg);flex:1 1 auto;min-height:0;}
.dayrail{flex:0 0 180px;display:flex;flex-direction:column;gap:var(--sp-sm);min-height:0;}
.dayrail .scroll{overflow-y:auto;display:flex;flex-direction:column;gap:6px;flex:1 1 auto;}
.daybtn{min-height:58px;border-radius:var(--r-control);border:1px solid var(--ghost);background:var(--surf-lowest);
  padding:6px 12px;display:flex;flex-direction:column;justify-content:center;}
.daybtn.on{border-color:var(--primary);background:var(--sidebar-active-bg);}
.daybtn .d{font-family:var(--f-head);font-size:var(--t-cue);line-height:var(--lh-cue);letter-spacing:.8px;}
.daybtn .s{font-size:12px;color:var(--secondary);}
.calmain{flex:1 1 auto;min-width:0;display:flex;gap:var(--sp-lg);}
.chartbox{flex:1 1 0;min-width:0;display:flex;flex-direction:column;}
.chartscroll{position:relative;overflow-y:auto;overflow-x:hidden;flex:1 1 auto;min-height:200px;
  border:1px solid var(--ghost);border-radius:var(--r-card);background:var(--surf-lowest);}
.chartinner{position:relative;}
.hourline{position:absolute;left:0;right:0;border-top:1px solid var(--ghost);}
.hourlab{position:absolute;left:6px;font-family:var(--f-head);font-size:11px;letter-spacing:.5px;
  color:var(--secondary);font-variant-numeric:tabular-nums;}
.band{position:absolute;left:46px;right:6px;background:var(--primary-container);opacity:.20;border-radius:var(--r-chip);}
.bandlab{position:absolute;right:10px;font-family:var(--f-head);font-size:10px;letter-spacing:1px;color:var(--secondary);}
.seg-ribbon{position:absolute;left:46px;width:8px;border-radius:4px;}
.cue-block{
  position:absolute;left:60px;right:10px;border-radius:var(--r-chip);
  border:1px solid var(--border-strong);background:var(--surf-high);
  padding:2px 8px;overflow:visible;
}
/* hitSlop equivalent — every block keeps a >=44px touch region even when the
   proportional bar is short (docs/78 calendar rule). */
.cue-block::before{content:'';position:absolute;left:-6px;right:-6px;top:50%;transform:translateY(-50%);height:44px;}
.cue-block .cl{position:relative;font-family:var(--f-head);font-size:16px;line-height:20px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cue-block.thin{height:12px;padding:0 8px;}
.cue-block.thin .cl{position:absolute;top:-3px;left:8px;right:0;overflow:visible;}
.cue-block.prog{border-color:var(--warning);background:var(--warning-container);}
.cue-block.livenow{border-color:var(--tertiary);box-shadow:0 0 0 1px var(--tertiary);}
.playhead{position:absolute;left:40px;right:0;height:0;border-top:2px solid var(--tertiary);}
.playhead span{position:absolute;right:8px;top:-9px;background:var(--tertiary);color:var(--bg);
  font-family:var(--f-head);font-size:10px;letter-spacing:.8px;padding:1px 5px;border-radius:var(--r-chip);}
.sunmark{position:absolute;left:46px;right:6px;height:0;border-top:1px dashed var(--warning);}
.sunmark span{position:absolute;right:2px;top:-8px;font-family:var(--f-head);font-size:10px;
  letter-spacing:1px;color:var(--warning);background:var(--surf-lowest);padding:0 4px;}
.listbox{flex:0 0 300px;display:flex;flex-direction:column;min-width:0;}
.listscroll{overflow-y:auto;flex:1 1 auto;display:flex;flex-direction:column;gap:6px;padding-right:2px;}
.lrow{min-height:52px;display:flex;align-items:center;gap:var(--sp-sm);padding:4px 10px;
  border-radius:var(--r-card);border:1px solid var(--ghost);background:var(--surf-lowest);}
.lrow .t{font-family:var(--f-head);font-size:var(--t-cue);font-variant-numeric:tabular-nums;flex:0 0 62px;}
.lrow .l{flex:1 1 auto;min-width:0;font-size:var(--t-body);line-height:var(--lh-body);}
.lrow.on{border-color:var(--tertiary);}

/* time travel */
.ttwrap{display:flex;gap:var(--sp-lg);flex:1 1 auto;min-height:0;}
.bigtime{font-family:var(--f-head);font-size:56px;line-height:60px;font-variant-numeric:tabular-nums;letter-spacing:1px;}
.kv{display:flex;gap:var(--sp-md);padding:6px 0;border-bottom:1px solid var(--ghost);}
.kv .k{flex:0 0 132px;font-size:var(--t-meta);line-height:var(--lh-body);letter-spacing:1px;
  text-transform:uppercase;color:var(--secondary);font-weight:600;}
.kv .v{flex:1 1 auto;min-width:0;font-size:var(--t-body);line-height:var(--lh-body);}
.kv .v.strong{font-family:var(--f-head);font-size:var(--t-cue);line-height:var(--lh-cue);}
.travelframe{border:2px solid var(--travel-purple);border-radius:var(--r-panel);
  background:rgba(139,92,246,0.12);padding:var(--sp-lg);}

/* edit plan */
.identstrip{display:flex;gap:var(--sp-lg);flex-wrap:wrap;align-items:center;
  border-radius:var(--r-card);border:1px dashed var(--border-strong);background:var(--surf-low);padding:var(--sp-md) var(--sp-lg);}
.identstrip .b{min-width:0;}
.savechip{min-height:44px;display:inline-flex;align-items:center;padding:0 14px;border-radius:var(--r-control);
  border:1px solid var(--ghost);background:var(--surf-lowest);
  font-family:var(--f-head);font-size:14px;letter-spacing:.8px;}
.savechip.ok{border-color:var(--tertiary);color:var(--tertiary);}
.savechip.busy{border-color:var(--primary);color:var(--primary);}
.savechip.bad{border-color:var(--error-border);color:var(--error);background:var(--error-container);}
.editcols{display:flex;gap:var(--sp-lg);flex:1 1 auto;min-height:0;}
.fieldrow{display:flex;gap:var(--sp-md);align-items:center;margin:var(--sp-sm) 0;}
.fieldrow label{flex:0 0 132px;font-size:var(--t-meta);letter-spacing:1px;text-transform:uppercase;color:var(--secondary);font-weight:600;}
.fieldrow input,.fieldrow select{
  flex:1 1 auto;min-width:0;min-height:48px;padding:0 12px;border-radius:var(--r-control);
  border:1px solid var(--ghost);background:var(--surf-lowest);color:var(--text);
  font-family:var(--f-body);font-size:var(--t-body);
}
.hint{font-size:var(--t-meta);line-height:var(--lh-meta);color:var(--secondary);margin-top:var(--sp-sm);}
.logline{font-family:var(--f-head);font-size:13px;line-height:20px;font-variant-numeric:tabular-nums;color:var(--secondary);}

/* scroll regions */
.scrolly{overflow-y:auto;min-height:0;}
.viewbody{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:var(--sp-lg);}

/* SINA DECIDES chips */
.sd{
  position:relative;display:inline-flex;align-items:center;justify-content:center;
  height:24px;padding:0 8px;border-radius:var(--r-chip);
  border:1px solid var(--travel-purple);color:var(--travel-purple);background:rgba(139,92,246,0.12);
  font-family:var(--f-head);font-size:11px;letter-spacing:1px;
}
.sd::before{content:'';position:absolute;left:-10px;right:-10px;top:50%;transform:translateY(-50%);height:44px;}

/* modals + sheets */
.scrim{position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:1000;padding:24px;}
.modal{background:var(--surf-low);border:1px solid var(--border-strong);border-radius:var(--r-panel);
  box-shadow:0 24px 60px var(--shadow);padding:var(--sp-xl);max-width:660px;width:100%;max-height:88vh;overflow:auto;}
.modal h3{font-size:var(--t-title);line-height:var(--lh-title);margin-bottom:var(--sp-sm);}
.modal .body{font-size:var(--t-body);line-height:var(--lh-body);}
.modal .btns{display:flex;gap:var(--sp-md);margin-top:var(--sp-xl);}
.modal .btns .gap{flex:1 1 auto;}
.sheet{background:var(--surf-low);border:1px solid var(--border-strong);border-radius:var(--r-panel);
  box-shadow:0 24px 60px var(--shadow);padding:var(--sp-xl);max-width:720px;width:100%;max-height:88vh;overflow:auto;}

/* demo dock */
#dock{
  position:fixed;right:16px;bottom:16px;z-index:800;width:300px;max-height:86vh;overflow:auto;
  background:var(--surf-low);border:1px solid var(--border-strong);border-radius:var(--r-panel);
  box-shadow:0 18px 44px var(--shadow);padding:var(--sp-md);
}
#dock.min{width:auto;padding:6px;background:var(--surf-high);}
#dock.min .tbtn{border-color:var(--primary);background:var(--sidebar-active-bg);color:var(--text);min-height:48px;font-size:14px;}
#dock h4{font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:var(--secondary);margin:10px 0 6px;}
#dock .sgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
#dock .sbtn{min-height:44px;border-radius:var(--r-control);border:1px solid var(--ghost);background:var(--surf-lowest);
  padding:4px 8px;font-family:var(--f-head);font-size:12px;letter-spacing:.4px;display:flex;flex-direction:column;justify-content:center;}
#dock .sbtn.on{border-color:var(--primary);background:var(--sidebar-active-bg);}
#dock .sbtn .n{font-size:10px;color:var(--secondary);letter-spacing:1px;}
#dock .tgrid{display:flex;flex-wrap:wrap;gap:6px;}
#dock .tbtn{min-height:44px;padding:0 10px;border-radius:var(--r-control);border:1px solid var(--ghost);
  background:var(--surf-lowest);font-family:var(--f-head);font-size:12px;letter-spacing:.8px;display:inline-flex;align-items:center;}
#dock .tbtn.on{border-color:var(--primary);background:var(--sidebar-active-bg);}
#dock .row{display:flex;align-items:center;gap:8px;min-height:44px;font-size:13px;}
#dock .row input{width:20px;height:20px;}
#dock .close{position:absolute;top:6px;right:8px;font-family:var(--f-head);font-size:12px;color:var(--secondary);}

#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1200;
  background:var(--surf-high);border:1px solid var(--border-strong);border-radius:var(--r-control);
  padding:12px 18px;font-size:var(--t-body);box-shadow:0 12px 30px var(--shadow);display:none;max-width:70vw;}

#footnote{padding:10px 16px 22px;font-size:12px;line-height:18px;color:var(--secondary);}

/* 1024x768 degradation: nothing scrolls horizontally; panels shrink. */
@media (max-width:1100px){
  .listbox{flex:0 0 236px;}
  .dayrail{flex:0 0 148px;}
  .bigtime{font-size:46px;line-height:50px;}
}
</style>
</head>
<body data-glare="off">
<div id="glare"></div>
<div id="ribbon">
  <span class="dot"></span>
  <span><b>INTERACTIVE DESIGN MOCK</b> — no engine connection; nothing saves or fires.</span>
  <span style="margin-left:auto;opacity:.8">Keys 1–9 = demo scenarios · T = next theme</span>
</div>
<div id="shell">
  <nav id="rail" aria-label="CaptainPad rail (context only)"></nav>
  <main id="work"></main>
</div>
<div id="footnote"></div>
<div id="dock"></div>
<div id="toast"></div>
<div id="overlay"></div>

<script>
/* ===================================================================
   DEMO DATA — the real BM26 night arc (playa_default), read-only.
   Cue ids, labels, playlists, palettes and trigger anchors mirror the
   tracked show plan; sun times are representative demo values.
   =================================================================== */

var DAYS = [
  { i:0, d:'D1', wd:'SUN', sunset:'19:36', sunrise:'06:16' },
  { i:1, d:'D2', wd:'MON', sunset:'19:35', sunrise:'06:17' },
  { i:2, d:'D3', wd:'TUE', sunset:'19:33', sunrise:'06:18' },
  { i:3, d:'D4', wd:'WED', sunset:'19:32', sunrise:'06:19' },
  { i:4, d:'D5', wd:'THU', sunset:'19:30', sunrise:'06:20' },
  { i:5, d:'D6', wd:'FRI', sunset:'19:29', sunrise:'06:20' },
  { i:6, d:'D7', wd:'SAT', sunset:'19:27', sunrise:'06:21' },
  { i:7, d:'D8', wd:'SUN', sunset:'19:26', sunrise:'06:22' },
  { i:8, d:'D9', wd:'MON', sunset:'19:24', sunrise:'06:23' }
];
var ALL = [0,1,2,3,4,5,6,7,8];

/* trigger: {clock:'HH:MM'} or {sun:'sunset'|'sunrise', off:minutes} */
var CUES = [
  { id:'c_initial_off', label:'Initial festival morning — remain off until first ignition',
    clock:'00:00', kind:'program', days:[0], playlist:'white_only', palette:'deep_sea',
    master:0, hold:'until sunset−30' },
  { id:'c_ignition_white', label:'Ignition — pure white visibility',
    sun:'sunset', off:-30, kind:'program', days:[0,1,2,3,4,5,6,7], playlist:'white_only',
    palette:'electric_ice', master:0.8, hold:'min 60' },
  { id:'c_first_color', label:'First color — white with gentle sprinkles',
    sun:'sunset', off:30, kind:'program', days:[0,1,2,3,4,5,6,7], playlist:'dusk_sprinkles',
    palette:'lavender_dream', hold:'until 21:30' },
  { id:'c_early_night', label:'Early night — cool animated welcome',
    clock:'21:30', kind:'ambient', days:[0,1,2,3,4,5,6,7], playlist:'ambient', palette:'deep_sea' },
  { id:'b1_midnight_drive', label:'Deep night 1 — Midnight Drive',
    clock:'23:30', kind:'ambient', days:[0,1,2,3,4,5,6,7], playlist:'night_midnight_drive', palette:'deep_sea' },
  { id:'b1_midnight_carry', label:'Deep night 1 — cross-midnight carry',
    clock:'00:00', kind:'ambient', days:[1,2,3,4,5,6,7,8], playlist:'night_midnight_drive', palette:'deep_sea' },
  { id:'r1_quiet_reset', label:'Quiet reset 1 — Aurora hush',
    clock:'01:00', kind:'ambient', days:[1,2,3,4,5,6,7,8], playlist:'night_quiet_reset_aurora', palette:'aurora' },
  { id:'b2_uv_lasers', label:'Deep night 2 — UV Lasers',
    clock:'01:10', kind:'ambient', days:[1,2,3,4,5,6,7,8], playlist:'night_uv_lasers', palette:'ultraviolet' },
  { id:'r2_quiet_reset', label:'Quiet reset 2 — Electric Ice hush',
    clock:'02:30', kind:'ambient', days:[1,2,3,4,5,6,7,8], playlist:'night_quiet_reset_ice', palette:'electric_ice' },
  { id:'b3_ember_hold', label:'Deep night 3 — Ember Hold',
    clock:'02:40', kind:'ambient', days:[1,2,3,4,5,6,7,8], playlist:'night_ember_hold', palette:'phoenix' },
  { id:'b4_open_sea', label:'Deep night 4 — Open Sea',
    clock:'04:00', kind:'ambient', days:[1,2,3,4,5,6,7,8], playlist:'night_open_sea', palette:'deep_sea' },
  { id:'c_pre_dawn', label:'Pre-dawn — pale maritime taper',
    sun:'sunrise', off:-120, kind:'ambient', days:[1,2,3,4,5,6,7,8], playlist:'night_open_sea', palette:'electric_ice' },
  { id:'c_sunrise_bloom', label:'Sunrise Bloom — expressive white',
    sun:'sunrise', off:-20, kind:'program', days:[1,2,3,4,5,6,7,8], playlist:'white_only',
    palette:'sunset_coral', master:0.8, hold:'min 80' },
  { id:'c_morning_watch', label:'Morning Watch — steady reduced visibility',
    sun:'sunrise', off:60, kind:'program', days:[1,2,3,4,5,6,7,8], playlist:'white_only',
    palette:'electric_ice', master:0.4, hold:'until 09:00' },
  { id:'c_day_off', label:'Day Off — output dark, engine available',
    clock:'09:00', kind:'program', days:ALL, playlist:'white_only', palette:'deep_sea',
    master:0, hold:'until sunset−30' },
  { id:'c_burn_night', label:'Burn night spectacle',
    sun:'sunset', off:90, kind:'program', days:[6], playlist:'default', palette:'bass_drop',
    master:1, hold:'min 120' },
  { id:'c_temple', label:'Temple burn — reverent',
    sun:'sunset', off:60, kind:'program', days:[7], playlist:'default', palette:'aurora',
    master:0.4, hold:'min 120' }
];

/* manual-trigger cues of the ACTIVE plan — derived, never hardcoded in the app
   (report datum M1). Listed here because the mock has no engine to derive from. */
var MANUAL_CUES = [
  { id:'c_dust_storm', label:'DUST STORM — high-visibility beacon', btn:'DUST STORM BEACON',
    kind:'program', playlist:'dust_beacon', palette:'sunset_coral', master:0.8, hold:null,
    consequence:'Owns the deck until you press END SHOW. No hold is authored.' },
  { id:'c_event_maxa', label:'EVENT — Maxa party', btn:'MAXA PARTY',
    kind:'program', playlist:'party_high', palette:'bass_drop', hold:'min 120', durationMin:120,
    consequence:'Runs as a show for 120 minutes, then the plan resumes.' },
  { id:'c_event_philharmonic', label:'EVENT — Philharmonic', btn:'PHILHARMONIC',
    kind:'program', playlist:'default', palette:'sunset_coral', hold:'min 90',
    consequence:'Runs as a show, holding at least 90 minutes.' },
  { id:'c_baby_reveal', label:'BABY REVEAL', btn:'BABY REVEAL…',
    kind:'program', playlist:'baby_tease → baby_reveal', palette:'baby_reveal_duet', hold:'min 120',
    consequence:'Opens the protected pink/blue confirmation. Never fires from this button.' }
];

var MOOD_CUE = { id:'c_mood_to_party', label:'Party session: eligible + enabled + sustained music',
  playlist:'party_high', palette:'bass_drop', durationMin:12 };

/* ---------------- scenarios (report §6.11.5) ---------------- */
var SCENARIOS = {
  S1: { key:'S1', name:'NIGHT BLOCK', today:4, clock:'02:17', ownerId:'b2_uv_lasers',
        controller:'autopilot', mood:'calm', engine:true,
        party:{ enabled:true, state:'armed' } },
  S2: { key:'S2', name:'PARTY COOLDOWN', today:4, clock:'02:37', ownerId:'r2_quiet_reset',
        controller:'autopilot', mood:'calm', engine:true,
        party:{ enabled:true, state:'cooldown', cooldownSec:683 } },
  S3: { key:'S3', name:'PARTY SESSION', today:4, clock:'23:52', ownerId:'b1_midnight_drive',
        controller:'autopilot', mood:'party', engine:true, partySession:true,
        party:{ enabled:true, state:'in_session', sessionLeftSec:461 } },
  S4: { key:'S4', name:'DUST STORM', today:4, clock:'01:48', ownerId:'b2_uv_lasers',
        controller:'program', mood:'calm', engine:true, program:'c_dust_storm',
        party:{ enabled:true, state:'suppressed' } },
  S5: { key:'S5', name:'MORNING WATCH', today:4, clock:'07:30', ownerId:'c_morning_watch',
        controller:'program', mood:'calm', engine:true, program:'c_morning_watch',
        party:{ enabled:true, state:'window_closed' } },
  S6: { key:'S6', name:'ENGINE OFFLINE', today:4, clock:'02:17', ownerId:'b2_uv_lasers',
        controller:'autopilot', mood:'calm', engine:false, lastData:'02:15:44',
        party:{ enabled:true, state:'armed' } },
  S7: { key:'S7', name:'TIME TRAVEL ACTIVE', today:4, clock:'02:17', ownerId:'b2_uv_lasers',
        controller:'autopilot', mood:'calm', engine:true, travel:{ day:4, min:150 },
        party:{ enabled:true, state:'armed' } },
  S8: { key:'S8', name:'AUDIO STALE', today:4, clock:'02:17', ownerId:'b2_uv_lasers',
        controller:'autopilot', mood:'calm', engine:true, moodStale:214,
        party:{ enabled:true, state:'armed' } },
  /* S9 = the S1 night state, running a DEV plan: standing banner + DEV tags. */
  S9: { key:'S9', name:'DEV PLAN', today:4, clock:'02:17', ownerId:'b2_uv_lasers',
        controller:'autopilot', mood:'calm', engine:true, plan:'dev_runup',
        party:{ enabled:true, state:'armed' } }
};
var SCENARIO_ORDER = ['S1','S2','S3','S4','S5','S6','S7','S8','S9'];

/* The pinned PROD plan name — a CaptainPad constant beside PLAN_ACCENT.
   Any active plan whose name starts with `dev_` is a DEV plan. */
var PROD_PLAN = 'playa_default';

/* ---------------- SINA DECIDES register (report §6.10) ---------------- */
var SD = {
  'SD-1': { t:'Zoom exit gesture',
    a:'Drop the "returning to the Timeline tab exits the zoom" auto-resume once TIME TRAVEL is a view here; exits become RESUME LIVE and the global banner EXIT only.',
    b:'Keep the auto-exit; the TIME TRAVEL view then only ever shows pre-travel selection, and active travel lives on the deck tab.',
    r:'(a) — the gesture predates a Time Travel surface and would cancel a travel the operator came to inspect.' },
  'SD-2': { t:'Calendar editing',
    a:'EDIT THIS DAY jumps to EDIT PLAN with the day preselected (implemented here).',
    b:'Inline add/edit on the calendar, as the current screen does.',
    r:'(a) — the draft/live separation is worth more than one saved tap.' },
  'SD-3': { t:'Manual events on LIVE',
    a:'All manual cues of the active plan, including BABY REVEAL opening its protected flow (implemented here).',
    b:'Urgent-only (DUST STORM); the rest stay on the Events tab.',
    r:'(a) — one place at 3 am.' },
  'SD-4': { t:'Timeline AUTO toggle',
    a:'Header DETAILS drawer with verb labels (implemented here).',
    b:'Stays as a LIVE-view button.',
    r:'(a) — it is a rare, consequential control, not a per-night one.' },
  'SD-5': { t:'Audio-stale alert rank',
    a:'Ladder slot 5, below the zoom slot (implemented here).',
    b:'Elevate above the zoom slot whenever party mode is enabled.',
    r:'(a).' },
  'SD-6': { t:'NEXT list depth',
    a:'Four transitions (implemented here).',
    b:'Six transitions, or the full remaining night.',
    r:'4 as specified; the operator picks.' },
  'SD-7': { t:'View structure — final confirmation',
    a:'Four views: LIVE / CALENDAR VIEW / TIME TRAVEL / EDIT PLAN (implemented here).',
    b:'Three views: RUN SHOW / NIGHT SCHEDULE (Time Travel folded in) / EDIT PLAN.',
    r:'(a) — Time Travel is a rig-moving mode with its own engine state and failure surface; the calendar must stay a surface that can never move the rig.' },
  'SD-8': { t:'TIME TRAVEL HERE confirmation',
    a:'One tap, no confirm — travel is non-destructive and reversible via RESUME LIVE (implemented here).',
    b:'Add an opConfirm step before travelling.',
    r:'(a).' },
  'SD-9': { t:'Unlock scope in performance mode',
    a:'Unlock reveals the full four-view Timeline.',
    b:'Unlock reveals LIVE controls only; EDIT PLAN stays locked during performance mode (the engine already 409s structural writes in perf mode).',
    r:'(b) — matching the engine’s own perf-mode freeze. Shown in the performance mock.' },
  'SD-10': { t:'Remember-30-min default',
    a:'Pre-checked in the perf unlock sheet — fewer 3 am keypads.',
    b:'Off by default — passcode every time, matching the takeover ruling’s spirit.',
    r:'(b) off by default. Shown in the performance mock.' },
  'SD-11': { t:'Emergency actions under VIEW-ONLY',
    a:'Everything locked; the keypad is one tap away.',
    b:'END SHOW and/or DUST STORM reachable from the locked composition with a confirm but no passcode.',
    r:'(a). Shown in the performance mock.' },
  'SD-12': { t:'Dev-plan placement + pinned prod name',
    a:'test_bench scene only (implemented: the dev plan lives in the bench scene).',
    b:'A copy also in the titanic scene for on-rig UI rehearsal.',
    r:'Confirm "' + PROD_PLAN + '" as the pinned prod-plan constant either way.' },
  'SD-13': { t:'Dev-plan dating',
    a:'Tracked with a neutral past startDate, retargeted to today at the start of each session, never committing the dated residue (implemented).',
    b:'Keep the dev plan untracked / gitignored.',
    r:'(a) — a public repo must never announce a rehearsal calendar.' }
};

/* =================================================================== */
/* state                                                               */
/* =================================================================== */

var S = {
  view:'live',
  theme:'dark',
  aplus:false,
  glare:false,
  scenario:'S1',
  calDay:4,
  travelDay:4,
  travelMin:150,     /* 02:30 */
  travelActive:false,
  detailsOpen:false,
  partySettingsOpen:false,
  eventLogOpen:false,
  editDayOpen:4,
  draftDifferent:false,
  saveState:'saved',            /* saved | unsaved | saving | invalid | livetouch */
  autopilotOn:true,
  partyEnabledOverride:null,    /* null = scenario value */
  resolveState:'ok',            /* ok | pending */
  extra:{ actionFailed:false, handoff:false, draftInvalid:false, planWarnings:false, resolve400:false },
  offlineAgeSec:33,
  partyCfg:{ playlist:'party_high', sustainSec:120, sessionMin:12, cooldownSec:900 },
  availablePlaylists:['party_high','party_low','ambient','default'],
  dockMin:true,
  overlay:null,                 /* {type:...} */
  lastClickX:600
};
var _saveTimers = [];
var _ageTimer = null;
var _resolveTimer = null;

function sc(){ return SCENARIOS[S.scenario]; }

/* =================================================================== */
/* helpers                                                             */
/* =================================================================== */

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function toMin(s){ var p = String(s).split(':'); return (+p[0])*60 + (+p[1]); }
function hm(m){ m = ((Math.round(m)%1440)+1440)%1440; var h=Math.floor(m/60), x=m%60;
  return (h<10?'0':'')+h+':'+(x<10?'0':'')+x; }
function ms(sec){ sec=Math.max(0,Math.round(sec)); var m=Math.floor(sec/60), s=sec%60;
  return m+':'+(s<10?'0':'')+s; }
function hasDay(cue, di){ return cue.days === ALL ? true : cue.days.indexOf(di) >= 0; }
function cueMin(cue, di){
  if (cue.clock !== undefined) return toMin(cue.clock);
  return toMin(DAYS[di][cue.sun]) + cue.off;
}
function dayLabel(di){ return DAYS[di].d + ' · ' + DAYS[di].wd; }

/* every timed occurrence of a festival day, sorted */
function occurrences(di){
  var out = [];
  for (var i=0;i<CUES.length;i++){
    var c = CUES[i];
    if (!hasDay(c, di)) continue;
    if (c.clock === undefined && c.sun === undefined) continue;
    out.push({ cue:c, min:cueMin(c, di) });
  }
  out.sort(function(a,b){ return a.min - b.min; });
  return out;
}

/* resolved-ribbon segments: tile 00:00 -> 24:00 with the owner at each instant */
function segments(di){
  var occ = occurrences(di), out = [];
  for (var i=0;i<occ.length;i++){
    out.push({ from:occ[i].min, to:(i+1<occ.length ? occ[i+1].min : 1440), cue:occ[i].cue });
  }
  return out;
}
function ownerAt(di, min){
  var segs = segments(di);
  for (var i=0;i<segs.length;i++) if (min >= segs[i].from && min < segs[i].to) return segs[i];
  return segs.length ? segs[segs.length-1] : null;
}
function nextRows(di, min, n){
  var out = [], occ = occurrences(di), i;
  for (i=0;i<occ.length;i++) if (occ[i].min > min) out.push({ di:di, min:occ[i].min, cue:occ[i].cue });
  var nd = di+1;
  if (nd < DAYS.length){
    var occ2 = occurrences(nd);
    for (i=0;i<occ2.length && out.length<n;i++) out.push({ di:nd, min:occ2[i].min, cue:occ2[i].cue });
  }
  return out.slice(0, n);
}
/* behavior tags — report datum N4 */
function cueTags(cue){
  var t = [];
  if (cue.master === 0) t.push('MASTER 0%');
  else if (cue.kind === 'program') t.push('SHOW');
  else if (/^Quiet reset/.test(cue.label)) t.push('RESET');
  else t.push('AMBIENT');
  if (cue.sun) t.push('SUN');
  if (cue.durationMin) t.push(cue.durationMin + ' MIN');
  return t;
}
function partyWindow(di){
  return { start: toMin('21:30'), end: toMin(DAYS[di].sunrise) - 120 };
}
/* eligibility: 21:30 -> 24:00 on this evening, 00:00 -> sunrise-2h after midnight */
function windowOpenAt(di, min){
  var w = partyWindow(di);
  return (min >= w.start) || (min < w.end);
}
function partyEnabled(){
  if (S.partyEnabledOverride !== null) return S.partyEnabledOverride;
  return sc().party.enabled;
}
function nowMin(){ return toMin(sc().clock); }
function activePlanName(){ return sc().plan || PROD_PLAN; }
function isDevPlan(){ return /^dev_/.test(activePlanName()); }
function isNotShowPlan(){ return activePlanName() !== PROD_PLAN; }
function devTag(){ return isDevPlan() ? '<span class="tag dev">DEV</span>' : ''; }
function offline(){ return sc().engine === false; }
function travelIsActive(){ return S.travelActive || !!sc().travel; }
function travelTarget(){
  if (sc().travel && !S.travelActive) return sc().travel;
  return { day:S.travelDay, min:S.travelMin };
}

/* =================================================================== */
/* NOW resolution (report datum N1/N2/N3)                              */
/* =================================================================== */
function nowModel(){
  var s = sc(), di = s.today, min = nowMin(), seg = ownerAt(di, min);
  var m = {
    chip:'LIVE CUE', name:'', playlist:'', palette:'',
    since:null, sinceNote:'', until:null, untilLabel:'', holds:false,
    endShow:null, progress:0, cueId:null
  };
  if (s.program){
    var mc = null, i;
    for (i=0;i<MANUAL_CUES.length;i++) if (MANUAL_CUES[i].id === s.program) mc = MANUAL_CUES[i];
    for (i=0;i<CUES.length;i++) if (CUES[i].id === s.program) mc = { id:CUES[i].id, label:CUES[i].label,
      playlist:CUES[i].playlist, palette:CUES[i].palette, hold:CUES[i].hold };
    m.chip = 'SHOW'; m.name = mc.label; m.playlist = mc.playlist; m.palette = mc.palette;
    m.cueId = mc.id;
    m.endShow = mc.label;
    if (s.program === 'c_dust_storm'){
      m.holds = true; m.since = min - 6; m.sinceNote = 'fired';
    } else if (s.program === 'c_morning_watch'){
      m.since = cueMin(CUES[13], di); m.sinceNote = 'fired'; m.until = toMin('09:00');
      m.untilLabel = 'Day Off — output dark';
    }
    if (m.since !== null && m.until !== null && m.until > m.since){
      m.progress = Math.max(0, Math.min(1, (min - m.since) / (m.until - m.since)));
    }
    return m;
  }
  if (s.partySession){
    m.chip = 'PARTY SESSION'; m.name = 'Party session';
    m.playlist = MOOD_CUE.playlist; m.palette = MOOD_CUE.palette; m.cueId = MOOD_CUE.id;
    m.since = min - Math.round((s.party.sessionLeftSec ? (MOOD_CUE.durationMin*60 - s.party.sessionLeftSec) : 0)/60);
    m.sinceNote = 'fired';
    m.until = min + Math.round((s.party.sessionLeftSec||0)/60);
    m.untilLabel = 'the plan resumes at ' + (seg ? seg.cue.label : 'the owning cue');
    return m;
  }
  if (s.controller === 'manual'){ m.chip = 'OPERATOR (MANUAL)'; }
  else if (seg && seg.cue.kind === 'program') m.chip = 'SHOW';
  else m.chip = 'LIVE CUE';
  if (!seg){
    m.chip = 'BASELINE'; m.name = 'Autopilot baseline — ambient';
    m.playlist = 'ambient'; m.palette = 'deep_sea';
    return m;
  }
  m.name = seg.cue.label; m.playlist = seg.cue.playlist; m.palette = seg.cue.palette;
  m.cueId = seg.cue.id;
  m.since = seg.from; m.sinceNote = 'scheduled';
  var nr = nextRows(di, min, 1);
  m.until = seg.to >= 1440 ? (nr.length ? 1440 : null) : seg.to;
  m.untilLabel = nr.length ? nr[0].cue.label : '';
  if (seg.to > seg.from) m.progress = Math.max(0, Math.min(1, (min - seg.from) / (seg.to - seg.from)));
  return m;
}

/* =================================================================== */
/* party status (report datums P1-P7)                                  */
/* =================================================================== */
function partyModel(){
  var s = sc(), di = s.today, min = nowMin();
  var w = partyWindow(di), open = windowOpenAt(di, min);
  var p = {
    enabled: partyEnabled(),
    windowText: 'Window 21:30 → sunrise−2h (' + hm(w.end) + ') · ' + (open ? 'open now' : 'closed now'),
    open: open,
    pill: 'OFF', pillTone:'bad',
    line: '', tone:'ok'
  };
  if (offline()){
    p.pill = 'ENGINE OFFLINE'; p.pillTone = 'bad';
    p.line = 'Cannot reach the engine — party state unknown.';
    return p;
  }
  if (!p.enabled){
    p.pill = 'OFF'; p.pillTone = 'bad';
    p.line = 'Party sessions are blocked. Any running session was killed; detection keeps running.';
    return p;
  }
  switch (s.party.state){
    case 'in_session':
      p.pill = 'IN SESSION'; p.pillTone = 'ok';
      p.line = 'IN SESSION · ends ' + ms(s.party.sessionLeftSec); break;
    case 'cooldown':
      p.pill = 'COOLDOWN ' + ms(s.party.cooldownSec); p.pillTone = 'warn';
      p.line = 'COOLDOWN · ' + ms(s.party.cooldownSec) + ' — nothing can trigger until it clears.'; break;
    case 'suppressed':
      p.pill = 'SUPPRESSED'; p.pillTone = 'warn';
      p.line = 'SUPPRESSED — a show holds the deck'; break;
    case 'window_closed':
      p.pill = 'WINDOW CLOSED'; p.pillTone = 'warn';
      p.line = 'WINDOW CLOSED — outside the eligibility window, nothing can trigger.'; break;
    default:
      p.pill = 'ARMED'; p.pillTone = 'ok';
      p.line = 'ARMED — waiting for sustained music'; break;
  }
  return p;
}

/* =================================================================== */
/* alert ladder (report §6.2)                                          */
/* =================================================================== */
function alertList(){
  var s = sc(), a = [];
  if (offline()){
    a.push({ rank:1, cls:'e', ttl:'ENGINE OFFLINE',
      bod:'Engine unreachable — last data ' + s.lastData + ' (' + S.offlineAgeSec + ' s ago). The rig keeps running its plan on its own.',
      act:null });
  }
  if (S.extra.actionFailed){
    a.push({ rank:2, cls:'e', ttl:'ACTION REJECTED',
      bod:'POST /timeline/travel → 409 "another client holds control priority"',
      act:'RETRY', actId:'retryAction' });
  }
  if (S.extra.handoff){
    a.push({ rank:3, cls:'w', ttl:'LIVE TOUCH HOLDS AN ARMED LEASE',
      bod:'Live Touch is armed on another pad. Timeline actions need a confirmed handoff before they can drive the deck.',
      act:'PREEMPT LIVE TOUCH + RETRY', actId:'preempt' });
  }
  if (travelIsActive()){
    var t = travelTarget();
    a.push({ rank:4, cls:'t', ttl:'TIME TRAVELING',
      bod:'Showing ' + dayLabel(t.day) + ' ' + hm(t.min) + ' — the live clock and schedule keep running.',
      act:'RESUME LIVE', actId:'resume' });
  }
  if (s.moodStale){
    a.push({ rank:5, cls:'w', ttl:'AUDIO COMPANION STALE', sd:'SD-5',
      bod:'Party detection is down; mood forced CALM. Last audio update ' + s.moodStale + ' s ago.',
      act:null });
  }
  if (S.extra.draftInvalid){
    a.push({ rank:6, cls:'w', ttl:'DRAFT INVALID — NOT SAVED',
      bod:'Draft preview rejected: cue "b3_ember_hold" references playlist "night_ember_holdd" which does not exist. The draft stays unsaved until it is fixed.',
      act:null });
  }
  if (isNotShowPlan()){
    a.push({ rank:7, cls:'i', ttl:'ACTIVE PLAN IS NOT THE SHOW PLAN', sd:'SD-12',
      bod:'"' + activePlanName() + '" is running. The pinned show plan is "' + PROD_PLAN + '".',
      act:null });
  }
  if (S.extra.planWarnings){
    a.push({ rank:7, cls:'i', ttl:'PLAN WARNINGS (2)',
      bod:'Festival day 5 of 9 · 2 non-blocking plan warnings reported by the engine. Open DETAILS to read them.',
      act:null });
  }
  a.sort(function(x,y){ return x.rank - y.rank; });
  return a;
}

/* =================================================================== */
/* small render helpers                                                */
/* =================================================================== */
function sdChip(id){ return '<button class="sd" data-act="sd" data-sd="'+id+'" title="Open decision '+id+'">'+id+'</button>'; }
function tagHtml(list, cls){
  var out = '';
  for (var i=0;i<list.length;i++) out += '<span class="tag'+(cls?' '+cls:'')+'">'+esc(list[i])+'</span>';
  return out;
}
function staleChip(){ return offline() ? '<span class="tag stale">STALE</span>' : ''; }
function dis(){ return offline() ? ' disabled title="engine offline"' : ''; }
function offReason(){ return offline() ? '<div class="hint">Actions are disabled: engine offline. Nothing is hidden and nothing is queued.</div>' : ''; }

/* =================================================================== */
/* RAIL (context only)                                                 */
/* =================================================================== */
function renderRail(){
  var groups = [
    ['LAYERS', [['Deck',0],['Mixer',0],['Live Touch',0]]],
    ['TOOLS',  [['Audio',0],['2D Simulator',0]]],
    ['SHOW',   [['Timeline',1],['Events',0],['Scheduler',0],['Dimmer Rack',0]]],
    ['SYSTEM', [['Config',0]]]
  ];
  var h = '<div class="brand">CaptainPad</div>';
  for (var g=0; g<groups.length; g++){
    h += '<div class="group">'+groups[g][0]+'</div>';
    var items = groups[g][1];
    for (var i=0;i<items.length;i++){
      h += '<button class="item'+(items[i][1]?' on':'')+'" data-act="rail" data-name="'+esc(items[i][0])+'">'
        + '<span class="glyph">'+(items[i][1]?'●':'○')+'</span>'
        + '<span>'+esc(items[i][0])+'</span></button>';
    }
  }
  h += '<div class="ctx">RAIL SHOWN AS CONTEXT ONLY — the real Timeline screen never draws it.</div>';
  document.getElementById('rail').innerHTML = h;
}

/* =================================================================== */
/* HEADER + ALERT SLOT                                                 */
/* =================================================================== */
function renderHeader(){
  var s = sc(), p = partyModel();
  var engineOk = !offline();
  var ctrl = s.controller === 'program' ? ['SHOW RUNNING','warn']
           : s.controller === 'manual'  ? ['MANUAL','warn']
           : ['AUTOPILOT','ok'];
  var audio = s.moodStale ? ['STALE ' + s.moodStale + 's','warn']
            : (s.mood === 'party' ? ['PARTY','ok'] : ['CALM','ok']);

  var h = '<div class="hdr">'
    + '<div class="ident">'
      + '<div class="kicker">Active plan</div>'
      + '<div class="plan"><span class="rundot '+(engineOk?'bg-ok':'bg-sec')+'"></span>'
        + esc(activePlanName()) + devTag() + '</div>'
    + '</div>'
    + '<div class="pills">'
      + pillHtml('ENGINE', engineOk?'LIVE':'OFFLINE', engineOk?'ok':'bad')
      + pillHtml('CONTROL', ctrl[0], ctrl[1])
      + pillHtml('PARTY', p.enabled ? p.pill : 'OFF', p.enabled ? p.pillTone : 'bad')
      + pillHtml('AUDIO', audio[0], audio[1])
    + '</div>'
    + '<button class="btn'+(S.aplus?' pri':'')+'" data-act="aplus" style="min-width:64px">A+</button>'
    + '</div>';

  /* alert slot: exactly one expanded, everything else behind DETAILS (n) */
  var list = alertList();
  if (list.length){
    var a = list[0];
    h += '<div class="alert '+a.cls+'"><div class="row">'
      + '<div style="min-width:0;flex:1 1 auto">'
        + '<div class="ttl">'+esc(a.ttl)+(a.sd?' '+sdChip(a.sd):'')+'</div>'
        + '<div class="bod">'+esc(a.bod)+'</div>'
      + '</div>'
      + (a.act ? '<button class="btn" data-act="'+a.actId+'">'+esc(a.act)+'</button>' : '')
      + '</div></div>';
  }
  var collapsed = Math.max(0, list.length - 1);
  h += '<button class="detrow" data-act="details">'
     + '<span>'+(S.detailsOpen?'▾':'▸')+' Details ('+collapsed+')</span>'
     + '<span style="flex:1 1 auto"></span>'
     + '<span style="text-transform:none;font-family:var(--f-body);font-size:var(--t-meta)">'
     + (offline() ? 'last data '+s.lastData : 'live data · '+s.clock) + '</span>'
     + '</button>';

  if (S.detailsOpen){
    var d = '<div class="drawer">';
    for (var i=1;i<list.length;i++){
      d += '<div class="mini"><b>'+esc(list[i].ttl)+'</b><br><span class="sub">'+esc(list[i].bod)+'</span></div>';
    }
    if (list.length <= 1) d += '<div class="sub">No lower-priority alerts.</div>';
    d += '<div style="height:12px"></div>'
      + '<div class="kicker">Diagnostics</div>'
      + '<div class="kv"><div class="k">Data age</div><div class="v">'
        + (offline() ? S.offlineAgeSec + ' s (engine unreachable)' : 'live · websocket connected') + '</div></div>'
      + '<div class="kv"><div class="k">Festival</div><div class="v">day '+(s.today+1)+' of 9 · in window</div></div>'
      + '<div class="kv"><div class="k">Plan warnings</div><div class="v">'
        + (S.extra.planWarnings ? '2 — sun anchor for c_pre_dawn lands before b4_open_sea on D9; c_temple day list is a single day'
                                : '0') + '</div></div>'
      + '<div style="height:12px"></div>'
      + '<div class="kicker">Timeline automation '+sdChip('SD-4')+'</div>'
      + '<div style="display:flex;gap:12px;align-items:center;margin-top:8px;flex-wrap:wrap">'
      + '<button class="btn'+(S.autopilotOn?'':' danger')+'" data-act="autotoggle"'+dis()+'>'
      + (S.autopilotOn ? 'DISABLE TIMELINE AUTO' : 'ENABLE TIMELINE AUTO') + '</button>'
      + '<span class="sub">'+(S.autopilotOn
          ? 'The plan is driving. Disabling it stops every scheduled cue until you turn it back on.'
          : 'Timeline automation is OFF — no scheduled cue will fire.')+'</span>'
      + '</div></div>';
    h += d;
  }
  return h;
}
function pillHtml(label, value, tone){
  var toneCls = tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : tone === 'bad' ? 'bad' : '';
  var dotCls  = tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : tone === 'bad' ? 'bg-bad' : 'bg-sec';
  return '<span class="pill"><span class="dt '+dotCls+'"></span><span class="lb">'+esc(label)+'</span>'
    + '<span class="'+toneCls+'">'+esc(value)+'</span></span>';
}

/* =================================================================== */
/* SEGMENTED CONTROL                                                   */
/* =================================================================== */
function renderTabs(){
  var defs = [['live','LIVE'],['calendar','CALENDAR VIEW'],['travel','TIME TRAVEL'],['edit','EDIT PLAN']];
  var h = '<div class="seg">';
  for (var i=0;i<defs.length;i++){
    var badge = (defs[i][0] === 'travel' && travelIsActive()) ? '<span class="badge">LIVE</span>' : '';
    var badge2 = (defs[i][0] === 'edit' && S.saveState !== 'saved') ? '<span class="badge" style="background:var(--warning);color:var(--bg)">!</span>' : '';
    h += '<button class="'+(S.view===defs[i][0]?'on':'')+'" data-act="view" data-view="'+defs[i][0]+'">'
       + esc(defs[i][1]) + badge + badge2 + '</button>';
  }
  h += sdChipTabs();
  h += '</div>';
  /* Standing DEV identity — directly under the view tabs, on every view.
     Not collapsible, never part of the one-alert slot. */
  if (isDevPlan()){
    h += '<div class="devbanner"><span>⚠ DEV PLAN — NOT THE SHOW PLAN</span>'
      + '<span style="flex:1 1 auto"></span>'
      + '<span style="letter-spacing:.6px;text-transform:none">Running "' + esc(activePlanName())
      + '" on the bench. The show plan is "' + PROD_PLAN + '".</span>'
      + sdChip('SD-12') + '</div>';
  }
  return h;
}
function sdChipTabs(){ return '<div style="display:flex;align-items:center;padding-left:8px">'+sdChip('SD-7')+'</div>'; }

/* =================================================================== */
/* VIEW 1 — LIVE                                                       */
/* =================================================================== */
function renderLive(){
  var s = sc(), n = nowModel(), p = partyModel(), min = nowMin();
  var h = '<div class="grid2">';

  /* ---- left column ---- */
  h += '<div class="col-l">';

  /* NOW card — the only live-tinted card, and only while the data IS live */
  h += '<div class="card' + (offline() ? '' : ' live') + '">'
    + '<div class="cardhead">'
      + '<span class="kicker ok">● ON THE SHIP NOW</span>'
      + '<span class="tag now">'+esc(n.chip)+'</span>'
      + '<span class="spacer"></span>' + staleChip()
    + '</div>'
    + '<div class="hero">'+esc(n.name)+'</div>'
    + '<div class="sub">'+esc(n.playlist)+' · '+esc(n.palette)+'</div>'
    + '<div class="times">';
  if (n.since !== null && n.since !== undefined){
    h += '<span>since '+hm(n.since)+'</span>'
      + '<span class="tag">'+esc(n.sinceNote)+'</span>';
  }
  h += '<span class="bar"><i style="width:'+Math.round((n.holds?0.35:n.progress)*100)+'%"></i></span>';
  if (n.holds){
    h += '<span class="warn">holds until you end it</span>';
  } else if (n.until !== null && n.until !== undefined){
    var left = ((n.until - min) % 1440 + 1440) % 1440;
    h += '<span>until '+hm(n.until)+' <span class="ok">('+(left>=60?Math.floor(left/60)+' h ':'')+(left%60)+' min left)</span> — NEXT: '+esc(n.untilLabel)+'</span>';
  } else {
    h += '<span class="sub">no scheduled end in today’s plan</span>';
  }
  h += '</div>';

  h += '<div class="actions">';
  if (n.endShow) h += '<button class="btn big danger" data-act="endshow" data-label="'+esc(n.endShow)+'"'+dis()+'>END SHOW</button>';
  if (travelIsActive()) h += '<button class="btn big travel" data-act="resume"'+dis()+'>RESUME LIVE</button>';
  if (!n.endShow && !travelIsActive()) h += '<span class="sub">Nothing to end — the plan is driving itself.</span>';
  h += '</div>' + offReason() + '</div>';

  /* NEXT card */
  var rows = nextRows(s.today, min, 4);
  h += '<div class="card" style="flex:1 1 auto;display:flex;flex-direction:column;min-height:0">'
    + '<div class="cardhead"><h3>What happens next</h3>'+sdChip('SD-6')
    + '<span class="spacer"></span>'+staleChip()+'</div>'
    + '<div class="nextlist scrolly">';
  for (var i=0;i<rows.length;i++){
    var r = rows[i], cross = r.di !== s.today ? ' <span class="tag">'+esc(DAYS[r.di].d)+'</span>' : '';
    h += '<button class="nextrow" data-act="review" data-cue="'+esc(r.cue.id)+'" data-day="'+r.di+'" data-min="'+r.min+'">'
      + '<span class="t">'+hm(r.min)+'</span>'
      + '<span class="l">'+esc(r.cue.label)+'</span>'
      + '<span class="g">'+tagHtml(cueTags(r.cue))+cross+'</span></button>';
  }
  if (p.enabled && p.open) h += '<div class="nextrow" style="border-style:dashed">'
      + '<span class="t">'+hm(partyWindow(s.today).end)+'</span>'
      + '<span class="l">Party eligibility window closes</span>'
      + '<span class="g"><span class="tag">PARTY WINDOW</span></span></div>';
  h += '</div>'
    + '<div style="margin-top:12px"><button class="btn wide" data-act="view" data-view="calendar">OPEN CALENDAR VIEW</button></div>'
    + '<div class="hint">A row opens the review sheet. Tapping a row never fires anything.</div>'
    + '</div>';

  h += '</div>'; /* /col-l */

  /* ---- right column ---- */
  h += '<div class="col-r">';

  /* PARTY */
  h += '<div class="card">'
    + '<div class="cardhead"><h3>Party mode</h3><span class="spacer"></span>'+staleChip()+'</div>'
    + '<div class="pline a">'+(p.enabled ? 'PARTY MODE ON' : 'PARTY MODE OFF')+'</div>'
    + '<div class="pline b">'+esc(p.windowText)+'</div>'
    + '<div class="pline c '+(p.pillTone==='warn'?'warn':p.pillTone==='bad'?'bad':'ok')+'">'+esc(p.line)+'</div>'
    + '<div class="actions">'
      + '<button class="btn big wide '+(p.enabled?'danger':'pri')+'" data-act="partytoggle"'+dis()+'>'
      + (p.enabled ? 'DISABLE PARTY MODE' : 'ENABLE PARTY MODE') + '</button>'
    + '</div>'
    + '<button class="detrow" style="margin-top:12px;width:100%" data-act="partysettings">'
      + '<span>'+(S.partySettingsOpen?'▾':'▸')+' Party settings</span></button>';
  if (S.partySettingsOpen){
    h += '<div style="margin-top:10px">'
      + '<div class="kicker">Trigger playlist</div><div class="chiprow">';
    for (var q=0;q<S.availablePlaylists.length;q++){
      var pl = S.availablePlaylists[q];
      h += '<button class="chip'+(S.partyCfg.playlist===pl?' on':'')+'" data-act="pplaylist" data-pl="'+esc(pl)+'"'+dis()+'>'+esc(pl)+'</button>';
    }
    h += '</div>'
      + stepperHtml('Sustain before trigger', S.partyCfg.sustainSec + ' s', 'sustain')
      + stepperHtml('Session length', S.partyCfg.sessionMin + ' min', 'session')
      + stepperHtml('Cooldown', ms(S.partyCfg.cooldownSec), 'cooldown')
      + '<div class="hint">Playlist names come from the engine’s availablePlaylists — never hardcoded.</div>'
      + '</div>';
  }
  h += offReason() + '</div>';

  /* MANUAL EVENTS */
  h += '<div class="card" style="flex:1 1 auto;min-height:0;display:flex;flex-direction:column">'
    + '<div class="cardhead"><h3>Manual events</h3>'+sdChip('SD-3')
    + '<span class="spacer"></span><span class="tag">CONFIRM TO FIRE</span></div>'
    + '<div class="evtgrid">';
  for (var k=0;k<MANUAL_CUES.length;k++){
    var mc = MANUAL_CUES[k];
    h += '<button class="btn evt" data-act="fire" data-cue="'+esc(mc.id)+'"'+dis()+'>'+esc(mc.btn)+'</button>';
  }
  h += '</div>'
    + '<div class="hint">Derived from the active plan’s manual-trigger cues. Every fire names its consequence before it happens.</div>'
    + '</div>';

  h += '</div></div>'; /* /col-r /grid2 */
  return h;
}
function stepperHtml(label, value, id){
  return '<div class="stepper"><span class="lab">'+esc(label)+'</span>'
    + '<button class="btn" data-act="step" data-id="'+id+'" data-dir="-1"'+dis()+'>−</button>'
    + '<span class="val">'+esc(value)+'</span>'
    + '<button class="btn" data-act="step" data-id="'+id+'" data-dir="1"'+dis()+'>+</button></div>';
}

/* =================================================================== */
/* VIEW 2 — CALENDAR VIEW                                              */
/* =================================================================== */
var HOUR_PX = 64;
function renderCalendar(){
  var s = sc(), di = S.calDay, isToday = (di === s.today);
  var occ = occurrences(di), segs = segments(di), w = partyWindow(di);

  var h = '<div class="calwrap">';

  /* day rail */
  h += '<div class="dayrail"><div class="kicker">Festival day</div><div class="scroll">';
  for (var i=0;i<DAYS.length;i++){
    var sub = 'sunset '+DAYS[i].sunset+' · sunrise '+DAYS[i].sunrise;
    h += '<button class="daybtn'+(i===di?' on':'')+'" data-act="calday" data-day="'+i+'">'
      + '<span class="d">'+esc(dayLabel(i))+(i===s.today?' <span class="tag now">TODAY</span>':'')+'</span>'
      + '<span class="s">'+esc(sub)+'</span></button>';
  }
  h += '</div>'
    + '<div style="display:flex;gap:6px">'
    + '<button class="btn" style="flex:1 1 0" data-act="calstep" data-dir="-1">◀ PREV</button>'
    + '<button class="btn" style="flex:1 1 0" data-act="calstep" data-dir="1">NEXT ▶</button>'
    + '</div></div>';

  /* main */
  h += '<div class="calmain">';

  /* chart */
  h += '<div class="chartbox">'
    + '<div class="cardhead"><h3>'+esc(dayLabel(di))+'</h3>'
    + (isToday ? '<span class="tag now">NOW '+s.clock+'</span>' : '<span class="tag">not today — no live marks</span>')
    + '<span class="spacer"></span>'+staleChip()+'</div>'
    + '<div class="chartscroll" id="chartscroll"><div class="chartinner" style="height:'+(24*HOUR_PX)+'px">';

  for (var hh=0; hh<24; hh++){
    h += '<div class="hourline" style="top:'+(hh*HOUR_PX)+'px"></div>'
       + '<div class="hourlab" style="top:'+(hh*HOUR_PX+2)+'px">'+(hh<10?'0':'')+hh+':00</div>';
  }
  /* party eligibility bands */
  h += bandHtml(w.start, 1440, 'PARTY WINDOW') + bandHtml(0, w.end, 'PARTY WINDOW');
  /* sun markers */
  h += '<div class="sunmark" style="top:'+px(toMin(DAYS[di].sunset))+'px"><span>SUNSET '+DAYS[di].sunset+'</span></div>'
     + '<div class="sunmark" style="top:'+px(toMin(DAYS[di].sunrise))+'px"><span>SUNRISE '+DAYS[di].sunrise+'</span></div>';
  /* resolved ribbon */
  for (var r=0;r<segs.length;r++){
    var col = segs[r].cue.kind === 'program' ? 'var(--warning)' : 'var(--primary)';
    h += '<div class="seg-ribbon" style="top:'+px(segs[r].from)+'px;height:'+Math.max(2, px(segs[r].to)-px(segs[r].from)-1)+'px;background:'+col+';opacity:.5"></div>';
  }
  /* cue blocks */
  var liveSeg = isToday ? ownerAt(di, nowMin()) : null;
  for (var b=0;b<occ.length;b++){
    var from = occ[b].min, to = (b+1<occ.length ? occ[b+1].min : 1440);
    var top = px(from), hgt = Math.max(12, px(to) - px(from) - 2);
    var thin = hgt <= 22;
    var isLive = liveSeg && liveSeg.cue.id === occ[b].cue.id && from === liveSeg.from;
    h += '<button class="cue-block'+(occ[b].cue.kind==='program'?' prog':'')+(thin?' thin':'')+(isLive?' livenow':'')+'"'
      + ' style="top:'+top+'px;height:'+hgt+'px" data-act="review" data-cue="'+esc(occ[b].cue.id)+'"'
      + ' data-day="'+di+'" data-min="'+from+'">'
      + '<span class="cl">'+hm(from)+' · '+esc(occ[b].cue.label)+(isLive?' — LIVE':'')+'</span></button>';
  }
  /* empty-lane tap targets: one per hour, behind the blocks */
  for (var e=0;e<24;e++){
    h += '<button class="lane" style="position:absolute;left:46px;right:6px;top:'+(e*HOUR_PX)+'px;height:'+HOUR_PX+'px;'
      + 'background:transparent;border:0;z-index:0" data-act="lane" data-day="'+di+'" data-hour="'+e+'"'
      + ' title="empty time — opens a MOMENT review"></button>';
  }
  /* NOW playhead — TODAY column only */
  if (isToday){
    h += '<div class="playhead" style="top:'+px(nowMin())+'px"><span>NOW '+s.clock+'</span></div>';
  }
  h += '</div></div>'
    + '<div class="hint">Tap a cue block to review it. Tap empty time to open a MOMENT review — it snaps to the nearest 15 minutes. Neither moves the rig.</div>'
    + '</div>';

  /* text list */
  h += '<div class="listbox">'
    + '<div class="cardhead"><h3>Night arc — resolved cues</h3></div>'
    + '<div class="listscroll">';
  for (var L=0;L<occ.length;L++){
    var lv = liveSeg && liveSeg.cue.id === occ[L].cue.id && occ[L].min === liveSeg.from;
    h += '<button class="lrow'+(lv?' on':'')+'" data-act="review" data-cue="'+esc(occ[L].cue.id)+'" data-day="'+di+'" data-min="'+occ[L].min+'">'
      + '<span class="t">'+hm(occ[L].min)+'</span>'
      + '<span class="l">'+esc(occ[L].cue.label)+'<br><span class="sub" style="font-size:var(--t-meta)">'
      + esc(occ[L].cue.playlist)+' · '+esc(occ[L].cue.palette)+'</span></span>'
      + '<span>'+tagHtml(cueTags(occ[L].cue))+(lv?'<span class="tag now">LIVE</span>':'')+'</span></button>';
  }
  h += '<div class="cardhead" style="margin-top:14px"><h3>On demand · human triggered</h3><span class="tag">ACTIVE PLAN</span></div>';
  for (var M=0;M<MANUAL_CUES.length;M++){
    h += '<button class="lrow" data-act="manualreview" data-cue="'+esc(MANUAL_CUES[M].id)+'">'
      + '<span class="t">ON DEMAND</span><span class="l">'+esc(MANUAL_CUES[M].btn)
      + '<br><span class="sub" style="font-size:var(--t-meta)">Plan-authored manual cue · review before fire</span></span>'
      + '<span><span class="tag">HUMAN TRIGGERED</span></span></button>';
  }
  h += '</div>'
    + '<div style="margin-top:10px;display:flex;gap:8px;align-items:center">'
    + '<button class="btn quiet" style="flex:1 1 auto" data-act="editday" data-day="'+di+'">EDIT THIS DAY</button>'
    + sdChip('SD-2') + '</div>'
    + '</div>';

  h += '</div></div>';
  return h;
}
function px(min){ return Math.round(min / 60 * HOUR_PX); }
function bandHtml(from, to, label){
  if (to <= from) return '';
  return '<div class="band" style="top:'+px(from)+'px;height:'+(px(to)-px(from))+'px"></div>'
    + '<div class="bandlab" style="top:'+(px(from)+2)+'px">'+esc(label)+'</div>';
}

/* =================================================================== */
/* VIEW 3 — TIME TRAVEL                                                */
/* =================================================================== */
function renderTravel(){
  var t = { day:S.travelDay, min:S.travelMin };
  var active = travelIsActive();
  var at = travelTarget();
  var h = '<div class="ttwrap">';

  /* left: target */
  h += '<div class="col-l"><div class="card">'
    + '<div class="cardhead"><h3>Target</h3>'+sdChip('SD-1')+'<span class="spacer"></span>'
    + '<span class="tag">read-only until you travel</span></div>'
    + '<div class="chiprow">';
  for (var i=0;i<DAYS.length;i++){
    h += '<button class="chip'+(i===t.day?' on':'')+'" data-act="tday" data-day="'+i+'">'+esc(DAYS[i].d)+' '+esc(DAYS[i].wd)+'</button>';
  }
  h += '</div>'
    + '<div style="display:flex;align-items:center;gap:16px;margin:16px 0;flex-wrap:wrap">'
      + '<button class="btn big" data-act="tstep" data-dir="-1">− 15</button>'
      + '<div><div class="kicker">'+esc(dayLabel(t.day))+'</div><div class="bigtime">'+hm(t.min)+'</div></div>'
      + '<button class="btn big" data-act="tstep" data-dir="1">+ 15</button>'
    + '</div>';

  if (active){
    h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">'
      + '<button class="btn big" data-act="estep" data-dir="-1"'+dis()+'>◀ PREV EVENT</button>'
      + '<button class="btn big" data-act="estep" data-dir="1"'+dis()+'>NEXT EVENT ▶</button></div>'
      + '<div class="hint">Event stepping is offered only while a travel zoom is active — the engine’s {step} form requires one.</div>';
  } else {
    h += '<div class="hint">Previous/next EVENT stepping appears only once a travel zoom is active. Before that only the 15-minute steppers apply.</div>';
  }

  var blocked = S.extra.resolve400 || offline() || S.resolveState === 'pending';
  h += '<div class="actions">'
    + '<button class="btn big travel" style="flex:1 1 auto" data-act="travel"'
    + (blocked ? ' disabled title="'+(offline()?'engine offline':S.extra.resolve400?'the target did not resolve':'resolving…')+'"' : '')
    + '>TIME TRAVEL HERE</button>' + sdChip('SD-8') + '</div>'
    + '<div class="sub" style="margin-top:12px">The live clock and schedule keep running. RESUME LIVE returns the ship to now.</div>';
  if (blocked) h += '<div class="hint">Disabled: '+(offline()?'engine offline':S.extra.resolve400?'the target did not resolve — no preview to travel into':'waiting for the resolve')+'.</div>';
  h += '</div>';

  if (active){
    h += '<div class="travelframe">'
      + '<div class="kicker" style="color:var(--travel-purple)">TIME TRAVELING</div>'
      + '<div style="font-family:var(--f-head);font-size:var(--t-title);line-height:var(--lh-title);margin:4px 0 12px">'
      + esc(dayLabel(at.day))+' '+hm(at.min)+'</div>'
      + '<div style="display:flex;gap:12px;flex-wrap:wrap">'
      + '<button class="btn big travel" data-act="resume"'+dis()+'>RESUME LIVE</button>'
      + '</div>'
      + '<div class="hint">The global purple TIME TRAVELING banner stays mounted on every CaptainPad tab while this is on.</div>'
      + '</div>';
  }
  h += '</div>';

  /* right: resolved preview */
  h += '<div class="col-r"><div class="card" style="flex:1 1 auto;min-height:0;display:flex;flex-direction:column">'
    + '<div class="cardhead"><h3>Resolved preview</h3><span class="spacer"></span>'
    + '<span class="tag">GET /timeline/resolve</span></div>';

  if (offline()){
    h += '<div class="alert e"><div class="ttl">CANNOT RESOLVE</div>'
      + '<div class="bod">Engine offline — this mock refuses to invent a preview. The target above is kept.</div></div>';
  } else if (S.extra.resolve400){
    h += '<div class="alert e"><div class="ttl">RESOLVE REJECTED (400)</div>'
      + '<div class="bod">"requested instant is outside the festival window"</div></div>'
      + '<div class="hint">The engine message is shown verbatim. The target stays selected; TIME TRAVEL HERE is disabled with the reason.</div>';
  } else if (S.resolveState === 'pending'){
    h += '<div class="alert i"><div class="ttl">RESOLVING…</div>'
      + '<div class="bod">Debounced 250 ms after the last target change.</div></div>';
  } else {
    var seg = ownerAt(t.day, t.min);
    var nx  = nextRows(t.day, t.min, 1);
    var phaseOpen = windowOpenAt(t.day, t.min);
    h += '<div class="scrolly">'
      + kv('Owner', esc(seg.cue.label), true)
      + kv('Kind', esc(seg.cue.kind))
      + kv('Playlist · palette', esc(seg.cue.playlist)+' · '+esc(seg.cue.palette))
      + kv('Controller', seg.cue.kind === 'program' ? 'program' : 'autopilot')
      + kv('Phase', phaseOpen ? 'party_window' : 'none')
      + kv('Window until', seg.to >= 1440 ? '24:00 (carries into ' + dayLabel(Math.min(t.day+1, DAYS.length-1)) + ')' : hm(seg.to))
      + kv('Master', (seg.cue.master === undefined ? 'unchanged by this cue' : Math.round(seg.cue.master*100)+'%'))
      + kv('Hold', seg.cue.hold ? esc(seg.cue.hold) : 'none authored')
      + kv('Source', seg.cue.kind === 'program' ? 'authored program cue' : 'authored ambient cue')
      + kv('Following cue', nx.length ? hm(nx[0].min)+' · '+esc(nx[0].cue.label) : 'none left on this day')
      + '</div>'
      + '<div class="hint">Read-only. Changing the day or time only re-resolves — nothing on the ship moves until TIME TRAVEL HERE.</div>';
  }
  h += '</div></div></div>';
  return h;
}
function kv(k, v, strong){
  return '<div class="kv"><div class="k">'+esc(k)+'</div><div class="v'+(strong?' strong':'')+'">'+v+'</div></div>';
}

/* =================================================================== */
/* VIEW 4 — EDIT PLAN                                                  */
/* =================================================================== */
function renderEdit(){
  var active = activePlanName();
  var draftName = S.draftDifferent ? active + ' — night rework' : active;
  var same = !S.draftDifferent;
  var chip = { saved:['✓ SAVED','ok'], unsaved:['UNSAVED',''], saving:['SAVING…','busy'],
               invalid:['⚠ FIX TO SAVE','bad'], livetouch:['⚠ NOT SAVED · LIVE TOUCH','bad'] }[S.saveState];
  var di = S.editDayOpen, occ = occurrences(di);

  var h = '<div class="viewbody">';
  h += '<div class="identstrip">'
    + '<div class="b"><div class="kicker">Editing draft</div>'
      + '<div style="font-family:var(--f-head);font-size:var(--t-title);line-height:var(--lh-title)">'
      + esc(draftName)+devTag()+'</div></div>'
    + '<div class="b"><div class="kicker">Active plan</div>'
      + '<div style="font-family:var(--f-head);font-size:var(--t-title);line-height:var(--lh-title)">'
      + esc(active)+devTag()+'</div></div>'
    + '<div class="b"><div class="kicker">Identity</div>'
      + '<div class="'+(same?'ok':'warn')+'" style="font-family:var(--f-head);font-size:var(--t-cue)">'
      + (same ? 'SAME PLAN — saving hot-reloads the running show' : 'DIFFERENT PLAN — this draft is not what is running') + '</div></div>'
    + '<span style="flex:1 1 auto"></span>'
    + '<span class="savechip '+chip[1]+'">'+esc(chip[0])+'</span>'
    + (S.saveState === 'livetouch' ? '<button class="btn" data-act="preempt">PREEMPT LIVE TOUCH + RETRY</button>' : '')
    + '</div>';

  h += '<div class="editcols">';

  /* left: plan management + editors */
  h += '<div class="col-l scrolly">'
    + '<div class="card">'
      + '<div class="cardhead"><h3>Plan</h3><span class="spacer"></span>'
      + '<span class="tag">autosave — no save button</span></div>'
      + '<div style="display:flex;gap:12px;flex-wrap:wrap">'
        + '<button class="btn" data-act="planpicker">OPEN PLAN PICKER</button>'
        + '<button class="btn'+(same?' quiet':' pri')+'" data-act="activate"'+(same?' disabled title="already the active plan"':'')+'>ACTIVATE THIS PLAN</button>'
        + '<button class="btn quiet" data-act="draftswap">'+(same?'LOAD A DIFFERENT DRAFT':'RETURN TO THE ACTIVE PLAN')+'</button>'
      + '</div>'
      + '<div class="hint">Auto-save is the only save path (operator rulings 2026-07-02/03). Saving the ACTIVE plan hot-reloads the running show within about a second — there is no staging step.</div>'
    + '</div>'

    + '<div class="card" style="margin-top:16px">'
      + '<div class="cardhead"><h3>Festival</h3>'+(isDevPlan()?sdChip('SD-13'):'')+'</div>'
      + fieldRow('Start date','text', isDevPlan() ? 'neutral past date — retarget to today' : '2025-08-24','fest_start')
      + (isDevPlan()
          ? '<div class="hint">A dev plan ships with a neutral past start date so a public repo never announces a rehearsal calendar. Step 1 of a run-up session is retargeting it to today with the DateWheel; that edit auto-saves and is runtime residue — never commit it.</div>'
          : '')
      + fieldRow('Days','number','9','fest_days')
      + fieldRow('Time zone','text','America/Los_Angeles','fest_tz')
      + (isDevPlan() ? '' : '<div class="hint">Mock dates are deliberately neutral — this file is embedded in a public repo, which never carries a schedule.</div>')
      + '<div class="cardhead" style="margin-top:16px"><h3>Default cue</h3></div>'
      + fieldRow('Label','text','Phase-aware ambient program','def_label')
      + fieldRow('Look','text','ambient','def_look')
      + '<div class="hint">Phase-aware default: when no authored cue owns an instant, the engine resolves the phase’s look instead of a fixed one.</div>'
    + '</div>'

    + '<div class="card" style="margin-top:16px">'
      + '<div class="cardhead"><h3>Party advanced</h3><span class="spacer"></span>'
      + '<span class="tag">enable/disable stays on LIVE</span></div>'
      + fieldRow('Trigger playlist','text', S.partyCfg.playlist,'p_playlist')
      + fieldRow('Sustain (s)','number', String(S.partyCfg.sustainSec),'p_sustain')
      + fieldRow('Session (min)','number', String(S.partyCfg.sessionMin),'p_session')
      + fieldRow('Cooldown (s)','number', String(S.partyCfg.cooldownSec),'p_cooldown')
    + '</div>'

    + '<button class="detrow" style="width:100%;margin-top:16px" data-act="eventlog">'
      + '<span>'+(S.eventLogOpen?'▾':'▸')+' Event log &amp; diagnostics</span></button>';
  if (S.eventLogOpen){
    h += '<div class="drawer" style="margin-top:8px">'
      + logLine('02:30:00','fire','r2_quiet_reset','schedule')
      + logLine('02:17:41','lifecycle','engine connected','ws')
      + logLine('02:15:44','lifecycle','engine unreachable','transport')
      + logLine('02:00:12','fire','b2_uv_lasers','catchUp')
      + logLine('01:59:58','lifecycle','plan resumed after restart','catchUp')
      + logLine('01:10:00','fire','b2_uv_lasers','schedule')
      + '<div class="hint">Engine recentFires ring (50 entries). After a restart this is where the phase-correct catch-up shows itself.</div>'
      + '</div>';
  }
  h += '</div>';

  /* right: day cue editing */
  h += '<div class="col-r">'
    + '<div class="card" style="flex:1 1 auto;min-height:0;display:flex;flex-direction:column">'
    + '<div class="cardhead"><h3>Day cues</h3><span class="spacer"></span>'
    + '<button class="btn" data-act="addcue">ADD CUE</button></div>'
    + '<div class="chiprow">';
  for (var i=0;i<DAYS.length;i++){
    h += '<button class="chip'+(i===di?' on':'')+'" data-act="editday" data-day="'+i+'">'+esc(DAYS[i].d)+'</button>';
  }
  h += '</div><div class="listscroll">';
  for (var j=0;j<occ.length;j++){
    h += '<div class="lrow">'
      + '<span class="t">'+hm(occ[j].min)+'</span>'
      + '<span class="l">'+esc(occ[j].cue.label)+'<br><span class="sub" style="font-size:var(--t-meta)">'
      + esc(occ[j].cue.playlist)+' · '+esc(occ[j].cue.palette)+'</span></span>'
      + '<button class="btn" data-act="editcue" data-cue="'+esc(occ[j].cue.id)+'" data-min="'+occ[j].min+'">EDIT</button>'
      + '<button class="btn danger" data-act="delcue" data-cue="'+esc(occ[j].cue.id)+'">DELETE</button>'
      + '</div>';
  }
  h += '</div>'
    + '<div class="hint">'
    + (same
        ? 'Draft rows carry no FIRE button. FIRE lives on the review sheet and only for a cue the engine confirms belongs to the active, saved plan.'
        : 'FIRE is blocked for every row here — reason: <b>activate</b>. This draft is not the active plan.')
    + '</div>'
    + '</div></div>';

  h += '</div></div>';
  return h;
}
function fieldRow(label, type, value, id){
  return '<div class="fieldrow"><label for="f_'+id+'">'+esc(label)+'</label>'
    + '<input id="f_'+id+'" type="'+type+'" value="'+esc(value)+'" data-act="edited"></div>';
}
function logLine(t, kind, what, src){
  return '<div class="logline">'+t+'  '+kind.toUpperCase()+'  '+esc(what)+'  <span style="opacity:.7">('+esc(src)+')</span></div>';
}

/* =================================================================== */
/* OVERLAYS: review sheet, confirms, SD cards                          */
/* =================================================================== */
function renderOverlay(){
  var o = S.overlay;
  if (!o) return '';
  if (o.type === 'sd') return sdOverlay(o.id);
  if (o.type === 'review') return reviewOverlay(o);
  if (o.type === 'confirm') return confirmOverlay(o);
  if (o.type === 'baby') return babyOverlay(o);
  if (o.type === 'cueeditor') return cueEditorOverlay(o);
  if (o.type === 'planpicker') return planPickerOverlay();
  if (o.type === 'sdlist') return sdListOverlay();
  return '';
}
function shell(inner, cls){
  return '<div class="scrim" data-act="scrim"><div class="'+(cls||'modal')+'">'+inner+'</div></div>';
}
function sdOverlay(id){
  var d = SD[id];
  return shell('<h3>'+id+' — '+esc(d.t)+'</h3>'
    + '<div class="body">'
    + '<p><b>Option A.</b> '+esc(d.a)+'</p>'
    + '<p><b>Option B.</b> '+esc(d.b)+'</p>'
    + '<p><b>Recommendation:</b> '+esc(d.r)+'</p>'
    + '<p class="sub">This mock implements the recommendation. Every element governed by an open decision carries its chip so the choice is visible on screen.</p>'
    + '</div><div class="btns"><span class="gap"></span><button class="btn pri" data-act="close">CLOSE</button></div>');
}
function sdListOverlay(){
  var h = '<h3>SINA DECIDES — 8 open choices</h3><div class="body">';
  for (var k in SD){
    h += '<div class="mini" style="border-left:3px solid var(--travel-purple);padding-left:10px;margin:10px 0">'
      + '<b>'+k+' — '+esc(SD[k].t)+'</b><br>'
      + '<span class="sub">A: '+esc(SD[k].a)+'</span><br>'
      + '<span class="sub">B: '+esc(SD[k].b)+'</span><br>'
      + '<span class="sub">Recommended: '+esc(SD[k].r)+'</span></div>';
  }
  h += '</div><div class="btns"><span class="gap"></span><button class="btn pri" data-act="close">CLOSE</button></div>';
  return shell(h);
}
function reviewOverlay(o){
  if (o.mode === 'manual'){
    var manual = null;
    for (var m=0;m<MANUAL_CUES.length;m++) if (MANUAL_CUES[m].id === o.cue) manual = MANUAL_CUES[m];
    return shell('<h3>Human-triggered cue review — '+esc(manual.btn)+'</h3>'
      + '<div class="body">'+kv('Trigger','manual / on demand',true)
      + kv('Source','active saved plan')+kv('Consequence',esc(manual.consequence))
      + '<p class="hint">This cue has no invented clock position and never self-fires. FIRE remains explicit and confirmed.</p></div>'
      + '<div class="btns"><button class="btn big quiet" data-act="close">CLOSE</button><span class="gap"></span>'
      + '<button class="btn big danger" data-act="fire" data-cue="'+esc(manual.id)+'">REVIEW &amp; FIRE</button></div>', 'sheet');
  }
  var cue = null, i;
  for (i=0;i<CUES.length;i++) if (CUES[i].id === o.cue) cue = CUES[i];
  var s = sc();
  if (o.mode === 'moment'){
    var seg = ownerAt(o.day, o.min);
    return shell('<h3>Moment review — '+esc(dayLabel(o.day))+' '+hm(o.min)+'</h3>'
      + '<div class="body">'
      + '<p class="sub">Snapped to the nearest 15 minutes. This is a read-only resolve; nothing has moved.</p>'
      + kv('Owner at this instant', esc(seg.cue.label), true)
      + kv('Playlist · palette', esc(seg.cue.playlist)+' · '+esc(seg.cue.palette))
      + kv('Kind', esc(seg.cue.kind))
      + kv('Window until', seg.to >= 1440 ? '24:00' : hm(seg.to))
      + '<p class="hint">PERFORM is never offered for a bare moment — only Time Travel.</p>'
      + '</div>'
      + '<div class="btns"><button class="btn big quiet" data-act="close">CLOSE</button><span class="gap"></span>'
      + '<button class="btn big travel" data-act="tofromreview" data-day="'+o.day+'" data-min="'+o.min+'">TIME TRAVEL HERE</button></div>', 'sheet');
  }
  var isLiveOccurrence = (o.day === s.today) && !offline() && (function(){
    var seg = ownerAt(s.today, nowMin());
    return seg && seg.cue.id === o.cue && seg.from === o.min;
  })();
  var body = '<h3>Cue review — '+esc(cue.label)+'</h3><div class="body">'
    + kv('Occurrence', esc(dayLabel(o.day))+' · '+hm(o.min), true)
    + kv('Cue id', esc(cue.id))
    + kv('Kind', esc(cue.kind))
    + kv('Trigger', cue.sun ? ('sun · '+cue.sun+' '+(cue.off>0?'+':'')+cue.off+' min') : ('clock · '+cue.clock))
    + kv('Playlist · palette', esc(cue.playlist)+' · '+esc(cue.palette))
    + kv('Master', cue.master === undefined ? 'unchanged by this cue' : Math.round(cue.master*100)+'%')
    + kv('Hold', cue.hold ? esc(cue.hold) : 'none authored')
    + kv('Days', cue.days === ALL ? 'all festival days' : cue.days.map(function(x){return DAYS[x].d;}).join(' '))
    + (isLiveOccurrence
        ? '<p class="hint">This is the live occurrence — PERFORM is available.</p>'
        : '<p class="hint">PERFORM is offered only for the occurrence the engine identifies as live. This one is a review.</p>')
    + '</div>'
    + '<div class="btns"><button class="btn big quiet" data-act="close">CLOSE</button><span class="gap"></span>'
    + (isLiveOccurrence ? '<button class="btn big" style="border-color:var(--perform-green);color:var(--perform-green)" data-act="perform" data-cue="'+esc(cue.id)+'">PERFORM</button>' : '')
    + '<button class="btn big travel" data-act="tofromreview" data-day="'+o.day+'" data-min="'+o.min+'">TIME TRAVEL HERE</button></div>';
  return shell(body, 'sheet');
}
/* destructive button is placed on the side OPPOSITE the invoking button */
function confirmOverlay(o){
  var right = S.lastClickX < (window.innerWidth / 2);
  var cancel = '<button class="btn big quiet" data-act="close">CANCEL</button>';
  var go = '<button class="btn big '+(o.tone||'danger')+'" data-act="'+o.go+'" data-arg="'+esc(o.arg||'')+'">'+esc(o.goLabel)+'</button>';
  var btns = right ? (cancel + '<span class="gap"></span>' + go) : (go + '<span class="gap"></span>' + cancel);
  return shell('<h3>'+esc(o.title)+'</h3><div class="body"><p>'+esc(o.body)+'</p>'
    + (o.note ? '<p class="sub">'+esc(o.note)+'</p>' : '')
    + '</div><div class="btns">'+btns+'</div>');
}
function babyOverlay(o){
  if (o.step === 1){
    return shell('<h3>BABY REVEAL — protected flow</h3>'
      + '<div class="body"><p>This is the ceremony. It runs a tease for about 16 minutes and then reveals the answer’s colour.</p>'
      + '<p><b>Pick the answer.</b> The colour cannot be changed once the reveal step fires.</p></div>'
      + '<div class="btns">'
      + '<button class="btn big quiet" data-act="close">CANCEL</button><span class="gap"></span>'
      + '<button class="btn big" style="border-color:#ff77aa;color:#ff77aa" data-act="babypick" data-arg="PINK">PINK</button>'
      + '<button class="btn big" style="border-color:#66aaff;color:#66aaff" data-act="babypick" data-arg="BLUE">BLUE</button>'
      + '</div>');
  }
  return shell('<h3>Confirm BABY REVEAL — '+esc(o.color)+'</h3>'
    + '<div class="body"><p>Firing <b>c_baby_reveal_'+esc(o.color.toLowerCase())+'</b> takes the deck as a show, holds at least 120 minutes, and reveals <b>'+esc(o.color)+'</b>.</p>'
    + '<p class="sub">Type the colour to confirm — this mock accepts the button below instead; the real flow keeps its two-step protection.</p></div>'
    + '<div class="btns"><button class="btn big quiet" data-act="close">CANCEL</button><span class="gap"></span>'
    + '<button class="btn big danger" data-act="firedone" data-arg="BABY REVEAL — '+esc(o.color)+'">FIRE '+esc(o.color)+'</button></div>');
}
function cueEditorOverlay(o){
  var cue = null;
  for (var i=0;i<CUES.length;i++) if (CUES[i].id === o.cue) cue = CUES[i];
  var isNew = !cue;
  var c = cue || { id:'', label:'', kind:'ambient', clock:'22:00', playlist:'ambient', palette:'deep_sea' };
  return shell('<h3>'+(isNew?'New cue':'Edit cue')+'</h3><div class="body">'
    + fieldRow('Cue id','text', c.id || 'c_new_cue','ce_id')
    + fieldRow('Label','text', c.label,'ce_label')
    + '<div class="fieldrow"><label for="f_ce_kind">Kind</label><select id="f_ce_kind" data-act="edited">'
      + '<option'+(c.kind==='ambient'?' selected':'')+'>ambient</option>'
      + '<option'+(c.kind==='program'?' selected':'')+'>program</option>'
      + '<option>mood</option></select></div>'
    + '<div class="fieldrow"><label for="f_ce_trig">Trigger</label><select id="f_ce_trig" data-act="edited">'
      + '<option'+(c.sun?'':' selected')+'>clock</option>'
      + '<option'+(c.sun?' selected':'')+'>sun</option>'
      + '<option>manual</option></select></div>'
    + fieldRow('At', 'text', c.sun ? (c.sun+' '+(c.off>0?'+':'')+c.off) : c.clock, 'ce_at')
    + fieldRow('Playlist','text', c.playlist,'ce_playlist')
    + fieldRow('Palette','text', c.palette,'ce_palette')
    + fieldRow('Hold','text', c.hold || '','ce_hold')
    + fieldRow('Master','text', c.master === undefined ? '' : String(c.master),'ce_master')
    + '<p class="hint">No FIRE button here. Changes flow into auto-save; an invalid draft stays unsaved and says so.</p>'
    + '</div><div class="btns"><span class="gap"></span><button class="btn big pri" data-act="closeedited">DONE</button></div>', 'sheet');
}
function planPickerOverlay(){
  var plans = [
    ['playa_default','SHOW PLAN · 9 days · 22 cues', false],
    ['playa_default — night rework','draft copy · 9 days · 23 cues', false],
    ['dev_runup','bench run-up plan · 5 days · 15 cues', true]
  ];
  var h = '<h3>Plans</h3><div class="body">';
  for (var i=0;i<plans.length;i++){
    h += '<div class="lrow" style="margin:8px 0"><span class="l"><b>'+esc(plans[i][0])+'</b>'
      + (plans[i][2] ? ' <span class="tag dev">DEV</span>' : '') + '<br>'
      + '<span class="sub" style="font-size:var(--t-meta)">'+esc(plans[i][1])+'</span></span>'
      + '<button class="btn" data-act="close">LOAD</button>'
      + '<button class="btn'+(i===0?' quiet':'')+'" data-act="close"'+(i===0?' disabled':'')+'>ACTIVATE</button></div>';
  }
  h += '<p class="hint">Activation stays explicit. Loading a plan into the draft never activates it.</p></div>'
    + '<div class="btns"><span class="gap"></span><button class="btn pri" data-act="close">CLOSE</button></div>';
  return shell(h, 'sheet');
}

/* =================================================================== */
/* DEMO DOCK                                                           */
/* =================================================================== */
function renderDock(){
  if (S.dockMin){
    return '<button class="tbtn" data-act="dockmax">DEMO CONTROLS ▲</button>';
  }
  var h = '<button class="close" data-act="dockmin">HIDE ▼</button>'
    + '<h4>Demo scenario</h4><div class="sgrid">';
  for (var i=0;i<SCENARIO_ORDER.length;i++){
    var k = SCENARIO_ORDER[i];
    h += '<button class="sbtn'+(S.scenario===k?' on':'')+'" data-act="scenario" data-s="'+k+'">'
      + '<span class="n">'+k+'</span><span>'+esc(SCENARIOS[k].name)+'</span></button>';
  }
  h += '</div>';

  h += '<h4>Theme</h4><div class="tgrid">';
  var themes = ['light','dark','midnight','sunset','gruvbox'];
  for (var t=0;t<themes.length;t++){
    h += '<button class="tbtn'+(S.theme===themes[t]?' on':'')+'" data-act="theme" data-t="'+themes[t]+'">'+themes[t].toUpperCase()+'</button>';
  }
  h += '</div>';

  h += '<h4>Legibility</h4><div class="tgrid">'
    + '<button class="tbtn'+(S.theme==='light'&&!S.aplus?' on':'')+'" data-act="preset" data-p="day">DAY</button>'
    + '<button class="tbtn'+((S.theme==='midnight')?' on':'')+'" data-act="preset" data-p="night">NIGHT</button>'
    + '<button class="tbtn'+(S.aplus?' on':'')+'" data-act="aplus">A+ LARGE TYPE</button>'
    + '<button class="tbtn'+(S.glare?' on':'')+'" data-act="glare">SUN GLARE (mock aid)</button>'
    + '</div>';

  h += '<h4>Alert ladder</h4>'
    + dockCheck('actionFailed','2 · Action rejected')
    + dockCheck('handoff','3 · Live Touch handoff')
    + dockCheck('draftInvalid','6 · Draft invalid')
    + dockCheck('planWarnings','7 · Plan warnings')
    + dockCheck('resolve400','Travel resolve 400');

  h += '<h4>Open decisions</h4>'
    + '<button class="tbtn" data-act="sdlist" style="width:100%;justify-content:center">SINA DECIDES (13)</button>';
  return h;
}
function dockCheck(id, label){
  return '<label class="row"><input type="checkbox" data-act="extra" data-id="'+id+'"'
    + (S.extra[id]?' checked':'')+'> <span>'+esc(label)+'</span></label>';
}

/* =================================================================== */
/* RENDER                                                              */
/* =================================================================== */
function render(){
  document.documentElement.setAttribute('data-theme', S.theme);
  document.documentElement.setAttribute('data-aplus', S.aplus ? 'on' : 'off');
  document.body.setAttribute('data-glare', S.glare ? 'on' : 'off');

  var keepScroll = null, cs = document.getElementById('chartscroll');
  if (cs) keepScroll = cs.scrollTop;

  renderRail();
  var body = S.view === 'live' ? renderLive()
           : S.view === 'calendar' ? renderCalendar()
           : S.view === 'travel' ? renderTravel()
           : renderEdit();
  document.getElementById('work').innerHTML =
    renderHeader() + renderTabs() + '<div class="viewbody">' + body + '</div>';

  document.getElementById('dock').className = S.dockMin ? 'min' : '';
  document.getElementById('dock').innerHTML = renderDock();
  document.getElementById('overlay').innerHTML = renderOverlay();
  document.getElementById('footnote').innerHTML =
    'Design mock for the CaptainPad Timeline redesign. Fully offline: no CDNs, no web fonts, no images, no network calls of any kind. '
  + 'Headings use a Space Grotesk stack and body text an Inter stack with system fallbacks — the app itself loads the real families from local packages. '
  + 'Colour tokens are copied from the five CaptainPad palettes. 1 pt is drawn as 1 px. Nothing here talks to an engine and nothing fires.';

  var cs2 = document.getElementById('chartscroll');
  if (cs2){
    /* open on the night span; keep the operator's scroll across re-renders */
    cs2.scrollTop = (keepScroll === null) ? (18 * HOUR_PX - 40) : keepScroll;
  }
}

/* =================================================================== */
/* INTERACTION                                                         */
/* =================================================================== */
function toast(msg){
  var t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(function(){ t.style.display = 'none'; }, 2600);
}
function markEdited(){
  for (var i=0;i<_saveTimers.length;i++) clearTimeout(_saveTimers[i]);
  _saveTimers = [];
  if (S.extra.draftInvalid){ S.saveState = 'invalid'; render(); return; }
  if (S.extra.handoff){ S.saveState = 'livetouch'; render(); return; }
  S.saveState = 'unsaved'; render();
  _saveTimers.push(setTimeout(function(){ S.saveState = 'saving'; render(); }, 600));
  _saveTimers.push(setTimeout(function(){ S.saveState = 'saved'; render(); }, 1500));
}
function scheduleResolve(){
  S.resolveState = 'pending'; render();
  clearTimeout(_resolveTimer);
  _resolveTimer = setTimeout(function(){ S.resolveState = 'ok'; render(); }, 250);
}
function applyScenario(k){
  S.scenario = k;
  var s = SCENARIOS[k];
  S.calDay = s.today;
  S.partyEnabledOverride = null;
  S.travelActive = false;
  if (s.travel){ S.travelDay = s.travel.day; S.travelMin = s.travel.min; S.view = 'travel'; }
  clearInterval(_ageTimer); _ageTimer = null;
  if (s.engine === false){
    S.offlineAgeSec = 33;
    _ageTimer = setInterval(function(){
      if (sc().engine === false){ S.offlineAgeSec += 1; render(); } else { clearInterval(_ageTimer); }
    }, 1000);
  }
  render();
}
function snap15(min){ return Math.round(min / 15) * 15; }

document.addEventListener('click', function(ev){
  var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
  if (!el) return;
  S.lastClickX = ev.clientX || 600;
  var a = el.getAttribute('data-act');

  switch (a){
    case 'rail':
      toast(el.getAttribute('data-name') + ' — rail shown as context only in this mock. Nothing navigates.'); return;
    case 'view': S.view = el.getAttribute('data-view'); render(); return;
    case 'aplus': S.aplus = !S.aplus; render(); return;
    case 'glare': S.glare = !S.glare; render(); return;
    case 'theme': S.theme = el.getAttribute('data-t'); render(); return;
    case 'preset':
      if (el.getAttribute('data-p') === 'day'){ S.theme = 'light'; S.aplus = false; }
      else { S.theme = 'midnight'; }
      render(); return;
    case 'scenario': applyScenario(el.getAttribute('data-s')); return;
    case 'extra':
      S.extra[el.getAttribute('data-id')] = el.checked;
      if (el.getAttribute('data-id') === 'draftInvalid') S.saveState = el.checked ? 'invalid' : 'saved';
      if (el.getAttribute('data-id') === 'handoff' && el.checked && S.saveState !== 'saved') S.saveState = 'livetouch';
      render(); return;
    case 'details': S.detailsOpen = !S.detailsOpen; render(); return;
    case 'partysettings': S.partySettingsOpen = !S.partySettingsOpen; render(); return;
    case 'eventlog': S.eventLogOpen = !S.eventLogOpen; render(); return;
    case 'dockmin': S.dockMin = true; render(); return;
    case 'dockmax': S.dockMin = false; render(); return;
    case 'sd': S.overlay = { type:'sd', id:el.getAttribute('data-sd') }; render(); return;
    case 'sdlist': S.overlay = { type:'sdlist' }; render(); return;
    case 'close': S.overlay = null; render(); return;
    case 'closeedited': S.overlay = null; markEdited(); return;
    case 'scrim': if (ev.target.classList.contains('scrim')){ S.overlay = null; render(); } return;
    case 'autotoggle':
      S.autopilotOn = !S.autopilotOn;
      toast(S.autopilotOn ? 'Timeline automation ENABLED (mock).' : 'Timeline automation DISABLED (mock) — no scheduled cue would fire.');
      render(); return;

    /* ---- LIVE ---- */
    case 'endshow':
      S.overlay = { type:'confirm', title:'End ' + el.getAttribute('data-label') + '?',
        body:'End ' + el.getAttribute('data-label') + '? The plan resumes with whatever owns this moment.',
        note:'The ended show is never resurrected — the resume lands on the cue that owns the clock right now.',
        goLabel:'END SHOW', go:'endshowdone' };
      render(); return;
    case 'endshowdone': S.overlay = null; toast('END SHOW confirmed (mock) — nothing fired.'); render(); return;
    case 'partytoggle':
      var on = partyModel().enabled;
      S.overlay = { type:'confirm',
        title: on ? 'Disable party mode?' : 'Enable party mode?',
        body: on
          ? 'Disabling party mode kills the running session immediately; detection keeps running.'
          : 'Enabling party mode lets sustained music start a session while the eligibility window is open.',
        note: on ? null : 'Enabling is not the same as eligible — the window still decides when a session may start.',
        goLabel: on ? 'DISABLE PARTY MODE' : 'ENABLE PARTY MODE',
        tone: on ? 'danger' : 'pri', go:'partydone', arg: on ? 'off' : 'on' };
      render(); return;
    case 'partydone':
      S.partyEnabledOverride = (el.getAttribute('data-arg') === 'on');
      S.overlay = null; toast('Party mode ' + (S.partyEnabledOverride ? 'ENABLED' : 'DISABLED') + ' (mock).'); render(); return;
    case 'pplaylist': S.partyCfg.playlist = el.getAttribute('data-pl'); render(); return;
    case 'step':
      var dir = +el.getAttribute('data-dir'), id = el.getAttribute('data-id');
      if (id === 'sustain') S.partyCfg.sustainSec = Math.max(30, S.partyCfg.sustainSec + dir*30);
      if (id === 'session') S.partyCfg.sessionMin = Math.max(1, S.partyCfg.sessionMin + dir);
      if (id === 'cooldown') S.partyCfg.cooldownSec = Math.max(0, S.partyCfg.cooldownSec + dir*60);
      render(); return;
    case 'fire':
      var cid = el.getAttribute('data-cue'), mc = null;
      for (var i=0;i<MANUAL_CUES.length;i++) if (MANUAL_CUES[i].id === cid) mc = MANUAL_CUES[i];
      if (cid === 'c_baby_reveal'){ S.overlay = { type:'baby', step:1 }; render(); return; }
      S.overlay = { type:'confirm', title:'Fire ' + mc.btn + '?',
        body: mc.label + ' — ' + mc.consequence,
        note:'The deck changes the moment you confirm.',
        goLabel:'FIRE ' + mc.btn, go:'firedone', arg: mc.btn };
      render(); return;
    case 'firedone': S.overlay = null; toast(el.getAttribute('data-arg') + ' confirmed (mock) — nothing fired.'); render(); return;
    case 'babypick': S.overlay = { type:'baby', step:2, color: el.getAttribute('data-arg') }; render(); return;

    /* ---- CALENDAR ---- */
    case 'calday': S.calDay = +el.getAttribute('data-day'); render(); return;
    case 'calstep':
      S.calDay = Math.max(0, Math.min(DAYS.length-1, S.calDay + (+el.getAttribute('data-dir'))));
      render(); return;
    case 'review':
      S.overlay = { type:'review', mode:'cue', cue:el.getAttribute('data-cue'),
        day:+el.getAttribute('data-day'), min:+el.getAttribute('data-min') };
      render(); return;
    case 'manualreview':
      S.overlay = { type:'review', mode:'manual', cue:el.getAttribute('data-cue') };
      render(); return;
    case 'lane':
      var hour = +el.getAttribute('data-hour');
      var mn = snap15(hour*60 + Math.round((ev.offsetY/HOUR_PX)*60));
      S.overlay = { type:'review', mode:'moment', day:+el.getAttribute('data-day'), min:mn };
      render(); return;
    case 'perform': S.overlay = null; toast('PERFORM confirmed (mock) — nothing fired.'); render(); return;
    case 'editday':
      S.editDayOpen = +el.getAttribute('data-day');
      if (S.view === 'calendar') S.view = 'edit';
      render(); return;

    /* ---- TIME TRAVEL ---- */
    case 'tday': S.travelDay = +el.getAttribute('data-day'); scheduleResolve(); return;
    case 'tstep':
      S.travelMin = ((S.travelMin + (+el.getAttribute('data-dir'))*15) % 1440 + 1440) % 1440;
      scheduleResolve(); return;
    case 'estep':
      var occ = occurrences(S.travelDay), d2 = +el.getAttribute('data-dir'), best = null, j;
      if (d2 > 0){ for (j=0;j<occ.length;j++) if (occ[j].min > S.travelMin){ best = occ[j].min; break; } }
      else { for (j=occ.length-1;j>=0;j--) if (occ[j].min < S.travelMin){ best = occ[j].min; break; } }
      if (best === null){ toast('400 — "no further event on this festival day". The target is kept.'); return; }
      S.travelMin = best; scheduleResolve(); return;
    case 'travel':
      S.travelActive = true; SCENARIOS[S.scenario].travel = null;
      toast('TIME TRAVEL requested (mock) — the rig does not move.'); render(); return;
    case 'tofromreview':
      S.travelDay = +el.getAttribute('data-day'); S.travelMin = +el.getAttribute('data-min');
      S.overlay = null; S.view = 'travel'; scheduleResolve(); return;
    case 'resume':
      S.travelActive = false; SCENARIOS[S.scenario].travel = null;
      toast('RESUME LIVE (mock) — back to now.'); render(); return;

    /* ---- alerts ---- */
    case 'retryAction': S.extra.actionFailed = false; toast('Retried (mock).'); render(); return;
    case 'preempt':
      S.extra.handoff = false;
      if (S.saveState === 'livetouch') S.saveState = 'saved';
      toast('Live Touch preempted (mock) — the handoff would be confirmed here.'); render(); return;

    /* ---- EDIT ---- */
    case 'planpicker': S.overlay = { type:'planpicker' }; render(); return;
    case 'draftswap': S.draftDifferent = !S.draftDifferent; markEdited(); return;
    case 'activate':
      S.overlay = { type:'confirm', title:'Activate this plan?',
        body:'Activating replaces the running plan. The engine re-resolves the current instant and the ship follows the new plan immediately.',
        goLabel:'ACTIVATE', tone:'pri', go:'activatedone' };
      render(); return;
    case 'activatedone': S.overlay = null; S.draftDifferent = false; toast('Activation confirmed (mock).'); render(); return;
    case 'addcue': S.overlay = { type:'cueeditor', cue:null }; render(); return;
    case 'editcue': S.overlay = { type:'cueeditor', cue:el.getAttribute('data-cue') }; render(); return;
    case 'delcue':
      S.overlay = { type:'confirm', title:'Delete cue?',
        body:'Deleting ' + el.getAttribute('data-cue') + ' removes it from the draft. Auto-save writes the change; if this draft is the active plan, the running show reloads without that cue.',
        goLabel:'DELETE CUE', go:'delcuedone' };
      render(); return;
    case 'delcuedone': S.overlay = null; markEdited(); toast('Delete confirmed (mock) — the demo plan is unchanged.'); return;
  }
});

document.addEventListener('change', function(ev){
  var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
  if (!el) return;
  var a = el.getAttribute('data-act');
  if (a === 'extra'){
    S.extra[el.getAttribute('data-id')] = el.checked;
    if (el.getAttribute('data-id') === 'draftInvalid') S.saveState = el.checked ? 'invalid' : 'saved';
    render(); return;
  }
  if (a === 'edited'){ markEdited(); return; }
});
document.addEventListener('input', function(ev){
  var el = ev.target.closest ? ev.target.closest('[data-act="edited"]') : null;
  if (el) markEdited();
});

document.addEventListener('keydown', function(ev){
  if (ev.target && /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return;
  var n = ev.key;
  if (n >= '1' && n <= '9'){ applyScenario(SCENARIO_ORDER[(+n) - 1]); return; }
  if (n === 't' || n === 'T'){
    var ts = ['light','dark','midnight','sunset','gruvbox'];
    S.theme = ts[(ts.indexOf(S.theme) + 1) % ts.length]; render(); return;
  }
  if (n === 'Escape' && S.overlay){ S.overlay = null; render(); }
});

applyScenario('S1');
</script>
</body>
</html>
``````

## Appendix — Performance mock source (`CaptainPad/design_mocks/timeline_performance_mode.html`)

The complete PERFORMANCE-composition mock is tracked at
`CaptainPad/design_mocks/timeline_performance_mode.html`. It opens directly in
any browser and makes no network requests.

``````html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CaptainPad Timeline — PERFORMANCE composition mock</title>
<style>
/* ==================================================================
   CaptainPad Timeline — PERFORMANCE mode composition + passcode-gated
   takeover. INTERACTIVE DESIGN MOCK, companion to the four-view mock.
   Standalone, fully offline: no CDNs, no @font-face URLs, no images,
   no fetch/XHR, no telemetry. System font stacks only.
   Palettes copied from CaptainPad/constants/theme.ts (5 themes).
   1 pt is rendered as 1 px here.
   ================================================================== */

:root[data-theme="light"]{
  --text:#191c1d; --bg:#f8f9fa;
  --surface:#f8f9fa; --surf-low:#f3f4f5; --surf-lowest:#ffffff; --surf-high:#e7e8e9; --surf-dim:#d9dadb;
  --primary:#006875; --primary-container:#00e5ff; --on-primary:#ffffff;
  --secondary:#466270; --secondary-container:#c6e4f4;
  --error:#ba1a1a; --error-container:rgba(186,26,26,0.08); --error-border:rgba(186,26,26,0.3);
  --tertiary:#1b9e77;
  --warning:#6f4d00; --warning-container:rgba(111,77,0,0.08); --warning-border:rgba(111,77,0,0.3);
  --ghost:rgba(186,201,204,0.4); --border-strong:rgba(70,98,112,0.85);
  --shadow:rgba(25,28,29,0.05);
  --sidebar-bg:rgba(255,255,255,0.6); --sidebar-active-bg:rgba(0,229,255,0.1); --sidebar-active-border:rgba(0,229,255,0.3);
}
:root[data-theme="dark"]{
  --text:#e3e6e8; --bg:#0f1416;
  --surface:#0f1416; --surf-low:#171d20; --surf-lowest:#0a0e10; --surf-high:#1f262a; --surf-dim:#0a0e10;
  --primary:#5ae0ee; --primary-container:#003640; --on-primary:#003640;
  --secondary:#a8c5d4; --secondary-container:#2a3e48;
  --error:#ff8a82; --error-container:rgba(255,138,130,0.16); --error-border:rgba(255,138,130,0.45);
  --tertiary:#34d39a;
  --warning:#f5a623; --warning-container:rgba(245,166,35,0.16); --warning-border:rgba(245,166,35,0.45);
  --ghost:rgba(180,195,200,0.18); --border-strong:rgba(180,195,200,0.55);
  --shadow:rgba(0,0,0,0.5);
  --sidebar-bg:rgba(15,20,22,0.85); --sidebar-active-bg:rgba(90,224,238,0.12); --sidebar-active-border:rgba(90,224,238,0.4);
}
:root[data-theme="midnight"]{
  --text:#d4dde8; --bg:#06080c;
  --surface:#06080c; --surf-low:#0d1320; --surf-lowest:#04060a; --surf-high:#152030; --surf-dim:#04060a;
  --primary:#5cc0ff; --primary-container:#003a5c; --on-primary:#001827;
  --secondary:#7a8a9e; --secondary-container:#2a3a4c;
  --error:#ff7a82; --error-container:rgba(255,122,130,0.16); --error-border:rgba(255,122,130,0.45);
  --tertiary:#3ad4a6;
  --warning:#f5a623; --warning-container:rgba(245,166,35,0.16); --warning-border:rgba(245,166,35,0.45);
  --ghost:rgba(150,170,200,0.18); --border-strong:rgba(150,170,200,0.65);
  --shadow:rgba(0,0,0,0.6);
  --sidebar-bg:rgba(6,8,12,0.88); --sidebar-active-bg:rgba(92,192,255,0.12); --sidebar-active-border:rgba(92,192,255,0.4);
}
:root[data-theme="sunset"]{
  --text:#f4e8d8; --bg:#1a0f0a;
  --surface:#1a0f0a; --surf-low:#251812; --surf-lowest:#100905; --surf-high:#2e2017; --surf-dim:#100905;
  --primary:#ffb84a; --primary-container:#5a3a00; --on-primary:#3a2400;
  --secondary:#b89478; --secondary-container:#3e2e1a;
  --error:#ff8a6a; --error-container:rgba(255,138,106,0.16); --error-border:rgba(255,138,106,0.45);
  --tertiary:#9acb87;
  --warning:#ffd166; --warning-container:rgba(255,209,102,0.16); --warning-border:rgba(255,209,102,0.45);
  --ghost:rgba(180,150,120,0.18); --border-strong:rgba(180,150,120,0.7);
  --shadow:rgba(0,0,0,0.55);
  --sidebar-bg:rgba(26,15,10,0.88); --sidebar-active-bg:rgba(255,184,74,0.12); --sidebar-active-border:rgba(255,184,74,0.4);
}
:root[data-theme="gruvbox"]{
  --text:#ebdbb2; --bg:#282828;
  --surface:#282828; --surf-low:#32302f; --surf-lowest:#1d2021; --surf-high:#3c3836; --surf-dim:#1d2021;
  --primary:#fabd2f; --primary-container:#665c54; --on-primary:#282828;
  --secondary:#a89984; --secondary-container:#3c3836;
  --error:#fb4934; --error-container:rgba(251,73,52,0.16); --error-border:rgba(251,73,52,0.45);
  --tertiary:#b8bb26;
  --warning:#ffb04d; --warning-container:rgba(255,176,77,0.16); --warning-border:rgba(255,176,77,0.45);
  --ghost:rgba(168,153,132,0.25); --border-strong:rgba(168,153,132,0.85);
  --shadow:rgba(0,0,0,0.55);
  --sidebar-bg:rgba(40,40,40,0.88); --sidebar-active-bg:rgba(250,189,47,0.12); --sidebar-active-border:rgba(250,189,47,0.4);
}
:root{
  --perform-green:#00a86b;
  --travel-purple:#8b5cf6;
  --r-chip:4px; --r-control:8px; --r-card:12px; --r-panel:16px; --r-shell:24px;
  --sp-xs:4px; --sp-sm:8px; --sp-md:12px; --sp-lg:16px; --sp-xl:24px;
  --f-head:"Space Grotesk", ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
  --f-body:"Inter", ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
  --t-perfhero:40px; --lh-perfhero:44px;
  --t-hero:34px;  --lh-hero:38px;
  --t-title:24px; --lh-title:28px;
  --t-cue:21px;   --lh-cue:25px;   /* the performance composition reads at 21 */
  --t-body:16px;  --lh-body:22px;
  --t-meta:14px;  --lh-meta:18px;
}
:root[data-aplus="on"]{ --t-body:19px; --lh-body:25px; --t-cue:24px; --lh-cue:28px; }

*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:var(--f-body);
  font-size:var(--t-body);line-height:var(--lh-body);-webkit-font-smoothing:antialiased;}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;text-align:left;}
button:disabled{cursor:not-allowed;opacity:0.45;}
h1,h2,h3,h4{margin:0;font-family:var(--f-head);font-weight:700;}

#glare{position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:900;transition:opacity .2s;}
body[data-glare="on"] #glare{opacity:0.30;}

#ribbon{display:flex;align-items:center;gap:var(--sp-md);padding:8px 16px;
  background:var(--warning-container);border-bottom:1px solid var(--warning-border);
  font-size:var(--t-meta);line-height:var(--lh-meta);}
#ribbon .dot{width:10px;height:10px;border-radius:50%;background:var(--warning);flex:0 0 auto;}
#ribbon b{font-family:var(--f-head);letter-spacing:.6px;}

#shell{display:flex;min-height:calc(100vh - 36px);}
#rail{width:112px;flex:0 0 112px;background:var(--sidebar-bg);border-right:1px solid var(--ghost);
  padding:10px 6px 16px;display:flex;flex-direction:column;gap:2px;}
#rail .brand{font-family:var(--f-head);font-size:11px;letter-spacing:1.2px;text-transform:uppercase;
  color:var(--secondary);text-align:center;padding:6px 0 10px;}
#rail .group{font-family:var(--f-head);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;
  color:var(--secondary);padding:10px 6px 4px;}
#rail .item{min-height:44px;display:flex;flex-direction:column;justify-content:center;padding:6px 8px;
  border-radius:var(--r-control);border:1px solid transparent;font-family:var(--f-head);
  font-size:12px;letter-spacing:.4px;color:var(--secondary);}
#rail .item .glyph{font-size:11px;opacity:.7;}
#rail .item.on{background:var(--sidebar-active-bg);border-color:var(--sidebar-active-border);color:var(--text);}
#rail .item.on .glyph{color:var(--primary);opacity:1;}
#rail .item.hidden{opacity:.35;}
#rail .ctx{margin-top:auto;font-size:9px;line-height:13px;color:var(--secondary);text-align:center;
  padding-top:12px;border-top:1px solid var(--ghost);}

#work{flex:1 1 auto;min-width:0;padding:var(--sp-lg) var(--sp-lg) 64px;
  display:flex;flex-direction:column;gap:var(--sp-md);}

.hdr{display:flex;align-items:center;gap:var(--sp-lg);background:var(--surf-low);
  border:1px solid var(--ghost);border-radius:var(--r-panel);padding:var(--sp-md) var(--sp-lg);min-height:64px;}
.hdr .ident{flex:0 0 auto;max-width:280px;min-width:0;}
.kicker{font-family:var(--f-body);font-weight:600;font-size:var(--t-meta);line-height:var(--lh-meta);
  letter-spacing:1px;text-transform:uppercase;color:var(--secondary);}
.hdr .plan{font-family:var(--f-head);font-size:var(--t-title);line-height:var(--lh-title);
  display:flex;align-items:center;gap:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rundot{width:12px;height:12px;border-radius:50%;flex:0 0 auto;}
.hdr .pills{display:flex;flex-wrap:wrap;gap:var(--sp-sm);flex:1 1 auto;min-width:0;}
.pill{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:4px 10px;
  border-radius:var(--r-control);border:1px solid var(--ghost);background:var(--surf-lowest);
  font-family:var(--f-head);font-size:13px;letter-spacing:.5px;white-space:nowrap;}
.pill .lb{color:var(--secondary);font-size:11px;letter-spacing:1.2px;}
.pill .dt{width:9px;height:9px;border-radius:50%;}
.pill.perf{border-color:var(--warning-border);background:var(--warning-container);color:var(--warning);}
.pill.unlocked{border-color:var(--perform-green);background:rgba(0,168,107,0.14);color:var(--perform-green);}
.ok{color:var(--tertiary);} .warn{color:var(--warning);} .bad{color:var(--error);}
.bg-ok{background:var(--tertiary);} .bg-warn{background:var(--warning);}
.bg-bad{background:var(--error);} .bg-sec{background:var(--secondary);}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 16px;
  border-radius:var(--r-control);border:1px solid var(--border-strong);background:var(--surf-lowest);
  color:var(--text);font-family:var(--f-head);font-size:15px;letter-spacing:.6px;text-transform:uppercase;}
.btn.big{min-height:56px;font-size:16px;padding:0 20px;}
.btn.evt{min-height:52px;}
.btn.pri{background:var(--primary);color:var(--on-primary);border-color:var(--primary);}
.btn.danger{background:var(--error-container);border-color:var(--error-border);color:var(--error);}
.btn.unlock{min-height:56px;border-color:var(--warning);color:var(--warning);background:var(--warning-container);}
.btn.quiet{border-color:var(--ghost);color:var(--secondary);}
.btn.wide{width:100%;}

.alert{border-radius:var(--r-card);border:1px solid var(--ghost);background:var(--surf-lowest);
  padding:var(--sp-md) var(--sp-lg);}
.alert.e{background:var(--error-container);border-color:var(--error-border);}
.alert.w{background:var(--warning-container);border-color:var(--warning-border);}
.alert.i{background:var(--surf-low);}
.alert .row{display:flex;align-items:center;gap:var(--sp-md);flex-wrap:wrap;}
.alert .ttl{font-family:var(--f-head);font-size:var(--t-cue);line-height:var(--lh-cue);letter-spacing:.6px;}
.alert .bod{font-size:var(--t-body);line-height:var(--lh-body);margin-top:2px;}
.detrow{min-height:48px;display:flex;align-items:center;gap:var(--sp-md);padding:0 var(--sp-lg);
  border-radius:var(--r-card);border:1px solid var(--ghost);background:var(--surf-low);
  font-family:var(--f-head);font-size:14px;letter-spacing:.8px;text-transform:uppercase;color:var(--secondary);}
.drawer{border-radius:var(--r-card);border:1px solid var(--ghost);background:var(--surf-low);
  padding:var(--sp-md) var(--sp-lg);}
.drawer .mini{border-left:3px solid var(--ghost);padding:6px 0 6px 10px;margin:6px 0;}

.card{background:var(--surf-low);border:1px solid var(--ghost);border-radius:var(--r-panel);padding:var(--sp-lg);}
.card.live{background:var(--surf-lowest);border-color:var(--tertiary);
  box-shadow:0 0 0 1px var(--tertiary), 0 8px 28px var(--shadow);}
.card h3{font-size:var(--t-cue);line-height:var(--lh-cue);letter-spacing:.8px;text-transform:uppercase;}
.cardhead{display:flex;align-items:center;gap:var(--sp-sm);flex-wrap:wrap;margin-bottom:var(--sp-md);}
.cardhead .spacer{flex:1 1 auto;}

.tag{display:inline-flex;align-items:center;min-height:26px;padding:2px 8px;border-radius:var(--r-chip);
  border:1px solid var(--ghost);background:var(--surf-high);font-family:var(--f-head);font-size:12px;
  letter-spacing:1px;text-transform:uppercase;color:var(--secondary);}
.tag.now{border-color:var(--tertiary);color:var(--tertiary);background:transparent;}
.tag.stale{border-color:var(--warning-border);color:var(--warning);background:var(--warning-container);}
.tag.dev{border-color:var(--warning-border);color:var(--warning);background:var(--warning-container);}

/* ── the PERFORMANCE composition ───────────────────────────────────── */
.perfhero{font-family:var(--f-head);font-size:var(--t-perfhero);line-height:var(--lh-perfhero);margin:8px 0 4px;}
.perfsub{font-size:var(--t-body);line-height:var(--lh-body);color:var(--secondary);}
.perftimes{display:flex;align-items:center;gap:var(--sp-md);margin-top:var(--sp-md);flex-wrap:wrap;
  font-family:var(--f-head);font-size:var(--t-cue);line-height:var(--lh-cue);font-variant-numeric:tabular-nums;}
.bar{flex:1 1 140px;min-width:90px;height:10px;border-radius:5px;background:var(--surf-high);overflow:hidden;}
.bar i{display:block;height:100%;background:var(--tertiary);}

.nextstrip{display:flex;gap:var(--sp-md);}
.nextcard{flex:1 1 0;min-width:0;border-radius:var(--r-card);border:1px solid var(--ghost);
  background:var(--surf-lowest);padding:var(--sp-md);min-height:96px;display:flex;flex-direction:column;gap:4px;}
.nextcard .t{font-family:var(--f-head);font-size:var(--t-cue);line-height:var(--lh-cue);font-variant-numeric:tabular-nums;}
.nextcard .l{font-size:var(--t-body);line-height:var(--lh-body);}

.tiles{display:flex;gap:var(--sp-md);}
.tile{flex:1 1 0;min-width:0;border-radius:var(--r-card);border:1px solid var(--ghost);
  background:var(--surf-low);padding:var(--sp-md) var(--sp-lg);}
.tile .h{font-family:var(--f-head);font-size:var(--t-meta);letter-spacing:1.4px;text-transform:uppercase;
  color:var(--secondary);display:flex;align-items:center;gap:8px;}
.tile .v{font-family:var(--f-head);font-size:var(--t-cue);line-height:var(--lh-cue);margin-top:6px;
  font-variant-numeric:tabular-nums;}
.tile .s{font-size:var(--t-body);line-height:var(--lh-body);color:var(--secondary);margin-top:4px;}

.ticker{border-radius:var(--r-card);border:1px solid var(--ghost);background:var(--surf-lowest);
  padding:var(--sp-md) var(--sp-lg);}
.ticker .line{font-size:var(--t-body);line-height:var(--lh-body);font-variant-numeric:tabular-nums;}
.ticker .line .t{color:var(--secondary);}

.unlockbar{display:flex;align-items:center;gap:var(--sp-md);margin-top:auto;}
.unlockbar .note{flex:1 1 auto;min-width:0;font-size:var(--t-meta);line-height:var(--lh-meta);color:var(--secondary);}

/* unlocked chrome: the four-view tabs, EDIT PLAN frozen by perf mode (SD-9b) */
.seg{display:flex;gap:var(--sp-sm);}
.seg button{flex:1 1 0;min-height:56px;border-radius:var(--r-control);border:1px solid var(--ghost);
  background:var(--surf-lowest);display:flex;align-items:center;justify-content:center;gap:8px;
  font-family:var(--f-head);font-size:16px;letter-spacing:1px;text-transform:uppercase;color:var(--secondary);}
.seg button.on{background:var(--sidebar-active-bg);border-color:var(--sidebar-active-border);color:var(--text);}
.grid2{display:flex;gap:var(--sp-lg);}
.col-l{flex:62 1 0;min-width:0;display:flex;flex-direction:column;gap:var(--sp-lg);}
.col-r{flex:38 1 0;min-width:0;display:flex;flex-direction:column;gap:var(--sp-lg);}
.evtgrid{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-sm);}
.pline{margin-top:var(--sp-sm);}
.pline.a{font-family:var(--f-head);font-size:var(--t-title);line-height:var(--lh-title);}
.pline.b{font-size:var(--t-body);line-height:var(--lh-body);color:var(--secondary);}
.pline.c{font-family:var(--f-head);font-size:var(--t-cue);line-height:var(--lh-cue);}
.hint{font-size:var(--t-meta);line-height:var(--lh-meta);color:var(--secondary);margin-top:var(--sp-sm);}
.nextlist{display:flex;flex-direction:column;gap:var(--sp-sm);}
.nextrow{min-height:60px;display:flex;align-items:center;gap:var(--sp-md);padding:6px var(--sp-md);
  border-radius:var(--r-card);border:1px solid var(--ghost);background:var(--surf-lowest);}
.nextrow .t{font-family:var(--f-head);font-size:var(--t-cue);line-height:var(--lh-cue);
  font-variant-numeric:tabular-nums;flex:0 0 74px;}
.nextrow .l{font-family:var(--f-head);font-size:var(--t-cue);line-height:var(--lh-cue);flex:1 1 auto;min-width:0;}

/* SINA DECIDES chips */
.sd{position:relative;display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 8px;
  border-radius:var(--r-chip);border:1px solid var(--travel-purple);color:var(--travel-purple);
  background:rgba(139,92,246,0.12);font-family:var(--f-head);font-size:11px;letter-spacing:1px;}
.sd::before{content:'';position:absolute;left:-10px;right:-10px;top:50%;transform:translateY(-50%);height:44px;}

/* modals + the passcode sheet */
.scrim{position:fixed;inset:0;background:rgba(0,0,0,0.62);display:flex;align-items:center;justify-content:center;
  z-index:1000;padding:24px;}
.modal{background:var(--surf-low);border:1px solid var(--border-strong);border-radius:var(--r-panel);
  box-shadow:0 24px 60px var(--shadow);padding:var(--sp-xl);max-width:660px;width:100%;max-height:90vh;overflow:auto;}
.modal h3{font-size:var(--t-title);line-height:var(--lh-title);margin-bottom:var(--sp-sm);}
.modal .btns{display:flex;gap:var(--sp-md);margin-top:var(--sp-xl);}
.modal .btns .gap{flex:1 1 auto;}
.masked{font-family:var(--f-head);font-size:34px;line-height:44px;letter-spacing:14px;min-height:56px;
  display:flex;align-items:center;justify-content:center;border-radius:var(--r-control);
  border:1px solid var(--border-strong);background:var(--surf-lowest);margin:var(--sp-md) 0;}
.keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-sm);}
.keypad button{min-height:56px;border-radius:var(--r-control);border:1px solid var(--border-strong);
  background:var(--surf-lowest);font-family:var(--f-head);font-size:24px;display:flex;
  align-items:center;justify-content:center;}
.rememberrow{display:flex;align-items:center;gap:var(--sp-md);min-height:48px;margin-top:var(--sp-md);}
.rememberrow input{width:22px;height:22px;}

#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1200;background:var(--surf-high);
  border:1px solid var(--border-strong);border-radius:var(--r-control);padding:12px 18px;
  font-size:var(--t-body);box-shadow:0 12px 30px var(--shadow);display:none;max-width:70vw;}

#dock{position:fixed;right:16px;bottom:16px;z-index:800;width:300px;max-height:86vh;overflow:auto;
  background:var(--surf-low);border:1px solid var(--border-strong);border-radius:var(--r-panel);
  box-shadow:0 18px 44px var(--shadow);padding:var(--sp-md);}
#dock.min{width:auto;padding:6px;background:var(--surf-high);}
#dock.min .tbtn{border-color:var(--primary);background:var(--sidebar-active-bg);color:var(--text);
  min-height:48px;font-size:14px;}
#dock h4{font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:var(--secondary);margin:10px 0 6px;}
#dock .sgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
#dock .sbtn{min-height:44px;border-radius:var(--r-control);border:1px solid var(--ghost);
  background:var(--surf-lowest);padding:4px 8px;font-family:var(--f-head);font-size:12px;
  letter-spacing:.4px;display:flex;flex-direction:column;justify-content:center;}
#dock .sbtn.on{border-color:var(--primary);background:var(--sidebar-active-bg);}
#dock .sbtn .n{font-size:10px;color:var(--secondary);letter-spacing:1px;}
#dock .tgrid{display:flex;flex-wrap:wrap;gap:6px;}
#dock .tbtn{min-height:44px;padding:0 10px;border-radius:var(--r-control);border:1px solid var(--ghost);
  background:var(--surf-lowest);font-family:var(--f-head);font-size:12px;letter-spacing:.8px;
  display:inline-flex;align-items:center;}
#dock .tbtn.on{border-color:var(--primary);background:var(--sidebar-active-bg);}
#dock .close{position:absolute;top:6px;right:8px;font-family:var(--f-head);font-size:12px;color:var(--secondary);}

#footnote{padding:10px 16px 22px;font-size:12px;line-height:18px;color:var(--secondary);}

@media (max-width:1100px){
  .perfhero{font-size:34px;line-height:38px;}
  .nextcard{min-height:88px;}
}
</style>
</head>
<body data-glare="off">
<div id="glare"></div>
<div id="ribbon">
  <span class="dot"></span>
  <span><b>INTERACTIVE DESIGN MOCK</b> — no engine connection; nothing saves, fires, or authenticates.</span>
  <span style="margin-left:auto;opacity:.8">Keys 1–6 = demo states · T = next theme</span>
</div>
<div id="shell">
  <nav id="rail" aria-label="CaptainPad rail (context only)"></nav>
  <main id="work"></main>
</div>
<div id="footnote"></div>
<div id="dock"></div>
<div id="toast"></div>
<div id="overlay"></div>

<script>
/* ===================================================================
   Demo dataset — the same night arc as the four-view mock, rendered
   READ-ONLY here. Cue ids, labels, playlists and palettes mirror the
   tracked show plan; sun times are representative demo values.
   =================================================================== */

var DAYS = [
  { i:0, d:'D1', wd:'SUN', sunset:'19:36', sunrise:'06:16' },
  { i:1, d:'D2', wd:'MON', sunset:'19:35', sunrise:'06:17' },
  { i:2, d:'D3', wd:'TUE', sunset:'19:33', sunrise:'06:18' },
  { i:3, d:'D4', wd:'WED', sunset:'19:32', sunrise:'06:19' },
  { i:4, d:'D5', wd:'THU', sunset:'19:30', sunrise:'06:20' },
  { i:5, d:'D6', wd:'FRI', sunset:'19:29', sunrise:'06:20' },
  { i:6, d:'D7', wd:'SAT', sunset:'19:27', sunrise:'06:21' },
  { i:7, d:'D8', wd:'SUN', sunset:'19:26', sunrise:'06:22' },
  { i:8, d:'D9', wd:'MON', sunset:'19:24', sunrise:'06:23' }
];
var ALL = [0,1,2,3,4,5,6,7,8];

var CUES = [
  { id:'c_initial_off', label:'Initial festival morning — remain off until first ignition',
    clock:'00:00', kind:'program', days:[0], playlist:'white_only', palette:'deep_sea', master:0 },
  { id:'c_ignition_white', label:'Ignition — pure white visibility', sun:'sunset', off:-30,
    kind:'program', days:[0,1,2,3,4,5,6,7], playlist:'white_only', palette:'electric_ice', master:0.8 },
  { id:'c_first_color', label:'First color — white with gentle sprinkles', sun:'sunset', off:30,
    kind:'program', days:[0,1,2,3,4,5,6,7], playlist:'dusk_sprinkles', palette:'lavender_dream' },
  { id:'c_early_night', label:'Early night — cool animated welcome', clock:'21:30',
    kind:'ambient', days:[0,1,2,3,4,5,6,7], playlist:'ambient', palette:'deep_sea' },
  { id:'b1_midnight_drive', label:'Deep night 1 — Midnight Drive', clock:'23:30',
    kind:'ambient', days:[0,1,2,3,4,5,6,7], playlist:'night_midnight_drive', palette:'deep_sea' },
  { id:'b1_midnight_carry', label:'Deep night 1 — cross-midnight carry', clock:'00:00',
    kind:'ambient', days:[1,2,3,4,5,6,7,8], playlist:'night_midnight_drive', palette:'deep_sea' },
  { id:'r1_quiet_reset', label:'Quiet reset 1 — Aurora hush', clock:'01:00',
    kind:'ambient', days:[1,2,3,4,5,6,7,8], playlist:'night_quiet_reset_aurora', palette:'aurora' },
  { id:'b2_uv_lasers', label:'Deep night 2 — UV Lasers', clock:'01:10',
    kind:'ambient', days:[1,2,3,4,5,6,7,8], playlist:'night_uv_lasers', palette:'ultraviolet' },
  { id:'r2_quiet_reset', label:'Quiet reset 2 — Electric Ice hush', clock:'02:30',
    kind:'ambient', days:[1,2,3,4,5,6,7,8], playlist:'night_quiet_reset_ice', palette:'electric_ice' },
  { id:'b3_ember_hold', label:'Deep night 3 — Ember Hold', clock:'02:40',
    kind:'ambient', days:[1,2,3,4,5,6,7,8], playlist:'night_ember_hold', palette:'phoenix' },
  { id:'b4_open_sea', label:'Deep night 4 — Open Sea', clock:'04:00',
    kind:'ambient', days:[1,2,3,4,5,6,7,8], playlist:'night_open_sea', palette:'deep_sea' },
  { id:'c_pre_dawn', label:'Pre-dawn — pale maritime taper', sun:'sunrise', off:-120,
    kind:'ambient', days:[1,2,3,4,5,6,7,8], playlist:'night_open_sea', palette:'electric_ice' },
  { id:'c_sunrise_bloom', label:'Sunrise Bloom — expressive white', sun:'sunrise', off:-20,
    kind:'program', days:[1,2,3,4,5,6,7,8], playlist:'white_only', palette:'sunset_coral', master:0.8 },
  { id:'c_morning_watch', label:'Morning Watch — steady reduced visibility', sun:'sunrise', off:60,
    kind:'program', days:[1,2,3,4,5,6,7,8], playlist:'white_only', palette:'electric_ice', master:0.4 },
  { id:'c_day_off', label:'Day Off — output dark, engine available', clock:'09:00',
    kind:'program', days:ALL, playlist:'white_only', palette:'deep_sea', master:0 },
  { id:'c_burn_night', label:'Burn night spectacle', sun:'sunset', off:90,
    kind:'program', days:[6], playlist:'default', palette:'bass_drop', master:1 },
  { id:'c_temple', label:'Temple burn — reverent', sun:'sunset', off:60,
    kind:'program', days:[7], playlist:'default', palette:'aurora', master:0.4 }
];

var MANUAL_CUES = [
  { id:'c_dust_storm', label:'DUST STORM — high-visibility beacon', btn:'DUST STORM BEACON',
    playlist:'dust_beacon', palette:'sunset_coral',
    consequence:'Owns the deck until you press END SHOW. No hold is authored.' },
  { id:'c_event_maxa', label:'EVENT — Maxa party', btn:'MAXA PARTY',
    playlist:'party_high', palette:'bass_drop',
    consequence:'Runs as a show for 120 minutes, then the plan resumes.' },
  { id:'c_event_philharmonic', label:'EVENT — Philharmonic', btn:'PHILHARMONIC',
    playlist:'default', palette:'sunset_coral',
    consequence:'Runs as a show, holding at least 90 minutes.' },
  { id:'c_baby_reveal', label:'BABY REVEAL', btn:'BABY REVEAL…',
    playlist:'baby_tease → baby_reveal', palette:'baby_reveal_duet',
    consequence:'Opens the protected pink/blue confirmation. Never fires from this button.' }
];

/* The four night states this composition is rendered against (the four-view
   mock's S1 / S2 / S4 / S5), read-only in every locked state. */
var SHOW_STATES = {
  S1: { key:'S1', name:'NIGHT BLOCK', today:4, clock:'02:17', controller:'autopilot', mood:'calm',
        party:{ enabled:true, state:'armed' } },
  S2: { key:'S2', name:'PARTY COOLDOWN', today:4, clock:'02:37', controller:'autopilot', mood:'calm',
        party:{ enabled:true, state:'cooldown', cooldownSec:683 } },
  S4: { key:'S4', name:'DUST STORM', today:4, clock:'01:48', controller:'program', mood:'calm',
        program:'c_dust_storm', party:{ enabled:true, state:'suppressed' } },
  S5: { key:'S5', name:'MORNING WATCH', today:4, clock:'07:30', controller:'program', mood:'calm',
        program:'c_morning_watch', party:{ enabled:true, state:'window_closed' } }
};

/* The six demo states of the PERFORMANCE composition itself. */
var PSTATES = {
  P1: { key:'P1', name:'LOCKED', data:'S1', lock:'locked', engine:true },
  P2: { key:'P2', name:'KEYPAD', data:'S1', lock:'locked', engine:true, openKeypad:true },
  P3: { key:'P3', name:'UNLOCKED', data:'S1', lock:'unlocked', engine:true, waiverSec:1781 },
  P4: { key:'P4', name:'ENGINE RESTART', data:'S1', lock:'locked', engine:false,
        lastData:'02:15:44', expiredNote:true },
  P5: { key:'P5', name:'BENCH (AUTH OFF)', data:'S1', lock:'locked', engine:true, authDisabled:true },
  P6: { key:'P6', name:'DUST STORM LOCKED', data:'S4', lock:'locked', engine:true }
};
var PSTATE_ORDER = ['P1','P2','P3','P4','P5','P6'];

var SD = {
  'SD-9': { t:'Unlock scope in performance mode',
    a:'Unlock reveals the full four-view Timeline.',
    b:'Unlock reveals LIVE controls only; EDIT PLAN stays locked during performance mode — the engine already 409s structural writes while perf mode is active.',
    r:'(b) — implemented here: the EDIT PLAN tab renders disabled with the reason "frozen by performance mode".' },
  'SD-10': { t:'Remember-30-min default',
    a:'Pre-checked in the unlock sheet — fewer 3 am keypads.',
    b:'Off by default — a passcode every time, matching the takeover ruling’s spirit.',
    r:'(b) — implemented here: the row renders unchecked.' },
  'SD-11': { t:'Emergency actions under VIEW-ONLY',
    a:'Everything locked; the keypad is one tap away (implemented here — see the DUST STORM demo state).',
    b:'END SHOW and/or DUST STORM reachable from the locked composition with a confirm but no passcode.',
    r:'(a) — the keypad is fast and the ruling was "passcode every time".' }
};

/* =================================================================== */
var S = {
  pstate:'P1',
  theme:'dark',
  aplus:false,
  glare:false,
  dataOverride:null,
  lock:'locked',            /* locked | unlocked */
  waiverSec:0,
  principal:'OWNER',
  keypad:null,              /* {value, fails, error, lockoutSec, remember} */
  offlineAgeSec:33,
  reconnected:false,
  expiredNotice:false,
  detailsOpen:false,
  partySettingsOpen:false,
  dockMin:true,
  overlay:null,
  lastClickX:600
};
var _tick = null;

function ps(){ return PSTATES[S.pstate]; }
function sc(){ return SHOW_STATES[S.dataOverride || ps().data]; }
function offline(){ return ps().engine === false && !S.reconnected; }
function unlocked(){ return S.lock === 'unlocked'; }

/* ── helpers ─────────────────────────────────────────────────────── */
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function toMin(s){ var p = String(s).split(':'); return (+p[0])*60 + (+p[1]); }
function hm(m){ m = ((Math.round(m)%1440)+1440)%1440; var h=Math.floor(m/60), x=m%60;
  return (h<10?'0':'')+h+':'+(x<10?'0':'')+x; }
function ms(sec){ sec=Math.max(0,Math.round(sec)); var m=Math.floor(sec/60), s=sec%60;
  return m+':'+(s<10?'0':'')+s; }
function hasDay(c, di){ return c.days === ALL ? true : c.days.indexOf(di) >= 0; }
function cueMin(c, di){ return c.clock !== undefined ? toMin(c.clock) : toMin(DAYS[di][c.sun]) + c.off; }
function dayLabel(di){ return DAYS[di].d + ' · ' + DAYS[di].wd; }
function nowMin(){ return toMin(sc().clock); }

function occurrences(di){
  var out = [];
  for (var i=0;i<CUES.length;i++){
    var c = CUES[i];
    if (!hasDay(c, di)) continue;
    if (c.clock === undefined && c.sun === undefined) continue;
    out.push({ cue:c, min:cueMin(c, di) });
  }
  out.sort(function(a,b){ return a.min - b.min; });
  return out;
}
function segments(di){
  var occ = occurrences(di), out = [];
  for (var i=0;i<occ.length;i++){
    out.push({ from:occ[i].min, to:(i+1<occ.length ? occ[i+1].min : 1440), cue:occ[i].cue });
  }
  return out;
}
function ownerAt(di, min){
  var segs = segments(di);
  for (var i=0;i<segs.length;i++) if (min >= segs[i].from && min < segs[i].to) return segs[i];
  return segs.length ? segs[segs.length-1] : null;
}
function nextRows(di, min, n){
  var out = [], occ = occurrences(di), i;
  for (i=0;i<occ.length;i++) if (occ[i].min > min) out.push({ di:di, min:occ[i].min, cue:occ[i].cue });
  var nd = di+1;
  if (nd < DAYS.length){
    var occ2 = occurrences(nd);
    for (i=0;i<occ2.length && out.length<n;i++) out.push({ di:nd, min:occ2[i].min, cue:occ2[i].cue });
  }
  return out.slice(0, n);
}
function cueTags(cue){
  var t = [];
  if (cue.master === 0) t.push('MASTER 0%');
  else if (cue.kind === 'program') t.push('SHOW');
  else if (/^Quiet reset/.test(cue.label)) t.push('RESET');
  else t.push('AMBIENT');
  if (cue.sun) t.push('SUN');
  return t;
}
function partyWindow(di){ return { start: toMin('21:30'), end: toMin(DAYS[di].sunrise) - 120 }; }
function windowOpenAt(di, min){ var w = partyWindow(di); return (min >= w.start) || (min < w.end); }

function nowModel(){
  var s = sc(), di = s.today, min = nowMin(), seg = ownerAt(di, min);
  var m = { chip:'LIVE CUE', name:'', playlist:'', palette:'', since:null, sinceNote:'',
            until:null, untilLabel:'', holds:false, progress:0 };
  if (s.program){
    var mc = null, i;
    for (i=0;i<MANUAL_CUES.length;i++) if (MANUAL_CUES[i].id === s.program) mc = MANUAL_CUES[i];
    for (i=0;i<CUES.length;i++) if (CUES[i].id === s.program) {
      mc = { label:CUES[i].label, playlist:CUES[i].playlist, palette:CUES[i].palette };
    }
    m.chip = 'SHOW'; m.name = mc.label; m.playlist = mc.playlist; m.palette = mc.palette;
    if (s.program === 'c_dust_storm'){ m.holds = true; m.since = min - 6; m.sinceNote = 'fired'; }
    else { m.since = cueMin(CUES[13], di); m.sinceNote = 'fired'; m.until = toMin('09:00');
           m.untilLabel = 'Day Off — output dark'; }
    if (m.since !== null && m.until !== null && m.until > m.since){
      m.progress = Math.max(0, Math.min(1, (min - m.since) / (m.until - m.since)));
    }
    return m;
  }
  if (!seg){ m.chip = 'BASELINE'; m.name = 'Autopilot baseline — ambient';
             m.playlist = 'ambient'; m.palette = 'deep_sea'; return m; }
  m.chip = seg.cue.kind === 'program' ? 'SHOW' : 'LIVE CUE';
  m.name = seg.cue.label; m.playlist = seg.cue.playlist; m.palette = seg.cue.palette;
  m.since = seg.from; m.sinceNote = 'scheduled';
  var nr = nextRows(di, min, 1);
  m.until = seg.to >= 1440 ? null : seg.to;
  m.untilLabel = nr.length ? nr[0].cue.label : '';
  if (seg.to > seg.from) m.progress = Math.max(0, Math.min(1, (min - seg.from) / (seg.to - seg.from)));
  return m;
}
function partyModel(){
  var s = sc(), di = s.today, min = nowMin();
  var w = partyWindow(di), open = windowOpenAt(di, min);
  var p = { enabled:s.party.enabled, open:open,
            windowText:'Window 21:30 → sunrise−2h (' + hm(w.end) + ') · ' + (open ? 'open now' : 'closed now'),
            pill:'OFF', tone:'bad', line:'' };
  if (offline()){ p.pill = 'ENGINE OFFLINE'; p.tone = 'bad';
    p.line = 'Cannot reach the engine — party state unknown.'; return p; }
  if (!p.enabled){ p.pill = 'OFF'; p.tone = 'bad';
    p.line = 'Party sessions are blocked. Any running session was killed; detection keeps running.'; return p; }
  switch (s.party.state){
    case 'in_session': p.pill = 'IN SESSION'; p.tone = 'ok';
      p.line = 'IN SESSION · ends ' + ms(s.party.sessionLeftSec); break;
    case 'cooldown': p.pill = 'COOLDOWN ' + ms(s.party.cooldownSec); p.tone = 'warn';
      p.line = 'COOLDOWN · ' + ms(s.party.cooldownSec) + ' — nothing can trigger until it clears.'; break;
    case 'suppressed': p.pill = 'SUPPRESSED'; p.tone = 'warn';
      p.line = 'SUPPRESSED — a show holds the deck'; break;
    case 'window_closed': p.pill = 'WINDOW CLOSED'; p.tone = 'warn';
      p.line = 'WINDOW CLOSED — outside the eligibility window, nothing can trigger.'; break;
    default: p.pill = 'ARMED'; p.tone = 'ok'; p.line = 'ARMED — waiting for sustained music'; break;
  }
  return p;
}

/* ── alert ladder (section 6.2, verbatim ranks) ───────────────────── */
function alertList(){
  var s = sc(), a = [];
  if (offline()){
    a.push({ rank:1, cls:'e', ttl:'ENGINE OFFLINE',
      bod:'Engine unreachable — last data ' + ps().lastData + ' (' + S.offlineAgeSec + ' s ago). The rig keeps running its plan on its own.',
      act:'RECONNECT (DEMO)', actId:'reconnect' });
  }
  if (S.expiredNotice){
    a.push({ rank:2, cls:'w', ttl:'UNLOCK EXPIRED',
      bod:'Unlock expired — enter the passcode again. The engine restarted, and unlock sessions and waivers live only in engine memory.' });
  }
  if (s.moodStale){
    a.push({ rank:5, cls:'w', ttl:'AUDIO COMPANION STALE',
      bod:'Party detection is down; mood forced CALM.' });
  }
  a.sort(function(x,y){ return x.rank - y.rank; });
  return a;
}

/* ── rail ────────────────────────────────────────────────────────── */
function renderRail(){
  var groups = [
    ['LAYERS', [['Deck',0,1],['Mixer',0,1],['Live Touch',0,1]]],
    ['TOOLS',  [['Audio',0,0],['2D Simulator',0,0]]],
    ['SHOW',   [['Timeline',1,1],['Events',0,1],['Scheduler',0,0],['Dimmer Rack',0,0]]],
    ['SYSTEM', [['Config',0,0]]]
  ];
  var h = '<div class="brand">CaptainPad</div>';
  for (var g=0; g<groups.length; g++){
    h += '<div class="group">'+groups[g][0]+'</div>';
    var items = groups[g][1];
    for (var i=0;i<items.length;i++){
      var shown = items[i][2] === 1;
      h += '<button class="item'+(items[i][1]?' on':'')+(shown?'':' hidden')+'" data-act="rail" data-name="'+esc(items[i][0])+'">'
        + '<span class="glyph">'+(items[i][1]?'●':'○')+'</span>'
        + '<span>'+esc(items[i][0])+'</span></button>';
    }
  }
  h += '<div class="ctx">RAIL SHOWN AS CONTEXT ONLY. Dimmed entries are hidden by performance mode; TIMELINE now stays visible so the night can be READ during a show.</div>';
  document.getElementById('rail').innerHTML = h;
}

/* ── header ──────────────────────────────────────────────────────── */
function pillHtml(label, value, tone){
  var toneCls = tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : tone === 'bad' ? 'bad' : '';
  var dotCls  = tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : tone === 'bad' ? 'bg-bad' : 'bg-sec';
  return '<span class="pill"><span class="dt '+dotCls+'"></span><span class="lb">'+esc(label)+'</span>'
    + '<span class="'+toneCls+'">'+esc(value)+'</span></span>';
}
function renderHeader(){
  var s = sc(), p = partyModel(), engineOk = !offline();
  var ctrl = s.controller === 'program' ? ['SHOW RUNNING','warn']
           : s.controller === 'manual'  ? ['MANUAL','warn'] : ['AUTOPILOT','ok'];
  var audio = s.moodStale ? ['STALE ' + s.moodStale + 's','warn']
            : (s.mood === 'party' ? ['PARTY','ok'] : ['CALM','ok']);

  var modeChip = unlocked()
    ? '<span class="pill unlocked"><span class="lb">CONTROLS</span>UNLOCKED — '
      + esc(S.principal) + ' · ' + ms(S.waiverSec)
      + '</span><button class="btn" data-act="relock" style="min-height:48px">RE-LOCK</button>'
    : '<span class="pill perf"><span class="lb">MODE</span>PERFORMANCE — VIEW ONLY</span>';

  var h = '<div class="hdr">'
    + '<div class="ident"><div class="kicker">Active plan</div>'
      + '<div class="plan"><span class="rundot '+(engineOk?'bg-ok':'bg-sec')+'"></span>playa_default</div></div>'
    + '<div class="pills">'
      + pillHtml('ENGINE', engineOk?'LIVE':'OFFLINE', engineOk?'ok':'bad')
      + pillHtml('CONTROL', ctrl[0], ctrl[1])
      + pillHtml('PARTY', p.enabled ? p.pill : 'OFF', p.enabled ? p.tone : 'bad')
      + pillHtml('AUDIO', audio[0], audio[1])
      + modeChip
    + '</div>'
    + '<button class="btn'+(S.aplus?' pri':'')+'" data-act="aplus" style="min-width:64px">A+</button>'
    + '</div>';

  var list = alertList();
  if (list.length){
    var a = list[0];
    h += '<div class="alert '+a.cls+'"><div class="row"><div style="min-width:0;flex:1 1 auto">'
      + '<div class="ttl">'+esc(a.ttl)+'</div><div class="bod">'+esc(a.bod)+'</div></div>'
      + (a.act ? '<button class="btn" data-act="'+a.actId+'">'+esc(a.act)+'</button>' : '')
      + '</div></div>';
  }
  var collapsed = Math.max(0, list.length - 1);
  h += '<button class="detrow" data-act="details"><span>'+(S.detailsOpen?'▾':'▸')+' Details ('+collapsed+')</span>'
    + '<span style="flex:1 1 auto"></span>'
    + '<span style="text-transform:none;font-family:var(--f-body);font-size:var(--t-meta)">'
    + (offline() ? 'last data '+ps().lastData : 'live data · '+s.clock) + '</span></button>';
  if (S.detailsOpen){
    h += '<div class="drawer">';
    for (var i=1;i<list.length;i++){
      h += '<div class="mini"><b>'+esc(list[i].ttl)+'</b><br><span class="perfsub">'+esc(list[i].bod)+'</span></div>';
    }
    if (list.length <= 1) h += '<div class="perfsub">No lower-priority alerts.</div>';
    h += '<div style="height:10px"></div><div class="kicker">Diagnostics</div>'
      + '<div class="hint">Performance mode is engine-global: every pad renders the same broadcast, so this cannot be wandered out of by switching tabs. '
      + 'Data age: ' + (offline() ? S.offlineAgeSec + ' s (engine unreachable)' : 'live · control bus connected') + '.</div>'
      + '</div>';
  }
  return h;
}

/* ── the PERFORMANCE composition (view-only) ──────────────────────── */
function renderPerf(){
  var s = sc(), n = nowModel(), p = partyModel(), min = nowMin();
  var stale = offline() ? '<span class="tag stale">STALE</span>' : '';
  var h = '';

  /* 2 — NOW hero */
  h += '<div class="card'+(offline()?'':' live')+'">'
    + '<div class="cardhead"><span class="kicker ok">● ON THE SHIP NOW</span>'
    + '<span class="tag now">'+esc(n.chip)+'</span><span class="spacer"></span>'+stale+'</div>'
    + '<div class="perfhero">'+esc(n.name)+'</div>'
    + '<div class="perfsub">'+esc(n.playlist)+' · '+esc(n.palette)+'</div>'
    + '<div class="perftimes">';
  if (n.since !== null) h += '<span>since '+hm(n.since)+'</span><span class="tag">'+esc(n.sinceNote)+'</span>';
  h += '<span class="bar"><i style="width:'+Math.round((n.holds?0.35:n.progress)*100)+'%"></i></span>';
  if (n.holds) h += '<span class="warn">holds until an operator ends it</span>';
  else if (n.until !== null) h += '<span>until '+hm(n.until)+' — NEXT: '+esc(n.untilLabel)+'</span>';
  else h += '<span class="perfsub">no scheduled end in today’s plan</span>';
  h += '</div>'
    + '<div class="hint">View only. END SHOW and RESUME LIVE are rig mutations and do not render until this pad is unlocked. '+sdChip('SD-11')+'</div>'
    + '</div>';

  /* 3 — NEXT strip (non-interactive) */
  var rows = nextRows(s.today, min, 4);
  h += '<div><div class="cardhead"><h3>What happens next</h3>'
    + '<span class="tag">not tappable in performance mode</span><span class="spacer"></span>'+stale+'</div>'
    + '<div class="nextstrip">';
  for (var i=0;i<rows.length;i++){
    var r = rows[i];
    h += '<div class="nextcard"><span class="t">'+hm(r.min)
      + (r.di !== s.today ? ' <span class="tag">'+esc(DAYS[r.di].d)+'</span>' : '') + '</span>'
      + '<span class="l">'+esc(r.cue.label)+'</span>'
      + '<span>'+tagHtml(cueTags(r.cue))+'</span></div>';
  }
  h += '</div></div>';

  /* 4 — status band */
  h += '<div class="tiles">'
    + '<div class="tile"><div class="h">Party '+stale+'</div>'
      + '<div class="v '+(p.tone==='warn'?'warn':p.tone==='bad'?'bad':'ok')+'">'
      + esc(p.enabled ? p.pill : 'OFF') + '</div>'
      + '<div class="s">'+esc(p.enabled ? p.line : 'Party mode is OFF — music cannot start a session.')+'</div>'
      + '<div class="s">'+esc(p.windowText)+'</div></div>'
    + '<div class="tile"><div class="h">Phase / eligibility</div>'
      + '<div class="v">'+(p.open ? 'PARTY WINDOW' : 'NO PHASE')+'</div>'
      + '<div class="s">'+(p.open ? 'Inside the eligibility window.' : 'Outside the eligibility window.')+'</div>'
      + '<div class="s">Window closes '+hm(partyWindow(s.today).end)+'.</div></div>'
    + '<div class="tile"><div class="h">Audio '+stale+'</div>'
      + '<div class="v '+(s.moodStale?'warn':'ok')+'">'+(s.moodStale ? 'STALE '+s.moodStale+'s' : (s.mood === 'party' ? 'PARTY' : 'CALM'))+'</div>'
      + '<div class="s">'+(s.moodStale
          ? 'Party detection is down; mood forced CALM.'
          : 'The audio companion is reporting; mood drives the party path.')+'</div></div>'
    + '</div>';

  /* 5 — event-log ticker */
  h += '<div class="ticker"><div class="kicker">Just happened</div>'
    + tickerLine('02:30:00','r2_quiet_reset fired', 'schedule')
    + tickerLine('01:10:00','b2_uv_lasers fired', 'schedule')
    + tickerLine('00:00:00','b1_midnight_carry fired', 'schedule')
    + '</div>';

  /* 6 — the single interactive element */
  h += '<div class="unlockbar">'
    + '<span class="note">'
    + (offline()
        ? 'The engine is unreachable. The unlock button stays enabled — verification happens engine-side and will fail loudly rather than pretend.'
        : 'Operator controls are locked on this pad. Unlocking verifies a passcode with the engine; it changes nothing on the ship by itself.')
    + '</span>'
    + '<button class="btn unlock" data-act="unlock">UNLOCK OPERATOR CONTROLS</button>'
    + '</div>';
  return h;
}
function tickerLine(t, what, src){
  return '<div class="line"><span class="t">'+t+'</span>  '+esc(what)+'  <span class="t">('+esc(src)+')</span></div>';
}
function tagHtml(list){
  var out = '';
  for (var i=0;i<list.length;i++) out += '<span class="tag">'+esc(list[i])+'</span>';
  return out;
}
function sdChip(id){ return '<button class="sd" data-act="sd" data-sd="'+id+'">'+id+'</button>'; }

/* ── the UNLOCKED composition: four-view chrome + LIVE controls ───── */
function renderUnlocked(){
  var s = sc(), n = nowModel(), p = partyModel(), min = nowMin();
  var h = '<div class="seg">'
    + '<button class="on">LIVE</button>'
    + '<button>CALENDAR VIEW</button>'
    + '<button>TIME TRAVEL</button>'
    + '<button disabled title="frozen by performance mode">EDIT PLAN</button>'
    + '<div style="display:flex;align-items:center;padding-left:8px">'+sdChip('SD-9')+'</div>'
    + '</div>'
    + '<div class="hint">EDIT PLAN stays frozen while performance mode is active — the engine already refuses structural plan writes in this mode, so the tab renders disabled with that reason rather than failing on save.</div>';

  h += '<div class="grid2"><div class="col-l">'
    + '<div class="card live">'
      + '<div class="cardhead"><span class="kicker ok">● ON THE SHIP NOW</span>'
      + '<span class="tag now">'+esc(n.chip)+'</span></div>'
      + '<div class="perfhero" style="font-size:var(--t-hero);line-height:var(--lh-hero)">'+esc(n.name)+'</div>'
      + '<div class="perfsub">'+esc(n.playlist)+' · '+esc(n.palette)+'</div>'
      + '<div class="perftimes">'
        + (n.since !== null ? '<span>since '+hm(n.since)+'</span>' : '')
        + '<span class="bar"><i style="width:'+Math.round(n.progress*100)+'%"></i></span>'
        + (n.until !== null ? '<span>until '+hm(n.until)+' — NEXT: '+esc(n.untilLabel)+'</span>' : '')
      + '</div>'
      + '<div style="display:flex;gap:12px;margin-top:16px;flex-wrap:wrap">'
        + (s.program ? '<button class="btn big danger" data-act="endshow">END SHOW</button>' : '')
        + '<span class="hint" style="margin:0">Controls unlocked on this pad.</span>'
      + '</div>'
    + '</div>'
    + '<div class="card"><div class="cardhead"><h3>What happens next</h3></div><div class="nextlist">';
  var rows = nextRows(s.today, min, 4);
  for (var i=0;i<rows.length;i++){
    h += '<button class="nextrow"><span class="t">'+hm(rows[i].min)+'</span>'
      + '<span class="l">'+esc(rows[i].cue.label)+'</span>'
      + '<span>'+tagHtml(cueTags(rows[i].cue))+'</span></button>';
  }
  h += '</div></div></div>';

  h += '<div class="col-r">'
    + '<div class="card"><div class="cardhead"><h3>Party mode</h3></div>'
      + '<div class="pline a">'+(p.enabled ? 'PARTY MODE ON' : 'PARTY MODE OFF')+'</div>'
      + '<div class="pline b">'+esc(p.windowText)+'</div>'
      + '<div class="pline c '+(p.tone==='warn'?'warn':p.tone==='bad'?'bad':'ok')+'">'+esc(p.line)+'</div>'
      + '<div style="margin-top:16px"><button class="btn big wide '+(p.enabled?'danger':'pri')+'" data-act="partytoggle">'
      + (p.enabled ? 'DISABLE PARTY MODE' : 'ENABLE PARTY MODE')+'</button></div>'
    + '</div>'
    + '<div class="card"><div class="cardhead"><h3>Manual events</h3><span class="spacer"></span>'
      + '<span class="tag">CONFIRM TO FIRE</span></div><div class="evtgrid">';
  for (var k=0;k<MANUAL_CUES.length;k++){
    h += '<button class="btn evt" data-act="fire" data-cue="'+esc(MANUAL_CUES[k].id)+'">'+esc(MANUAL_CUES[k].btn)+'</button>';
  }
  h += '</div>'
    + '<div class="hint">The waiver token rides every gated request. It expires on its own, on an engine restart, or when you press RE-LOCK.</div>'
    + '</div></div></div>';
  return h;
}

/* ── overlays: keypad, bench confirm, SD cards, confirms ──────────── */
function shellModal(inner){
  return '<div class="scrim" data-act="scrim"><div class="modal">'+inner+'</div></div>';
}
function renderOverlay(){
  var o = S.overlay;
  if (!o) return '';
  if (o.type === 'keypad') return keypadOverlay();
  if (o.type === 'bench') return benchOverlay();
  if (o.type === 'sd') return sdOverlay(o.id);
  if (o.type === 'sdlist') return sdListOverlay();
  if (o.type === 'confirm') return confirmOverlay(o);
  return '';
}
function keypadOverlay(){
  var k = S.keypad;
  var masked = k.value.replace(/./g, '•');
  var emptyField = masked === '';
  var lockedOut = k.lockoutSec > 0;
  var h = '<h3>Unlock operator controls</h3>'
    + '<div class="hint" style="margin-top:0">The passcode is verified by the engine, never on this pad. '
    + 'Unlocking changes nothing on the ship by itself.</div>'
    + '<div class="masked"'+(emptyField ? ' style="font-size:15px;letter-spacing:1.6px;color:var(--secondary)"' : '')+'>'
    + (emptyField ? 'ENTER OPERATOR PASSCODE' : esc(masked)) + '</div>';
  if (k.error){
    h += '<div class="alert e"><div class="ttl">'+esc(k.error.ttl)+'</div>'
      + '<div class="bod">'+esc(k.error.bod)+(lockedOut ? ' Retry in ' + ms(k.lockoutSec) + '.' : '')+'</div></div>';
  }
  h += '<div class="keypad" style="margin-top:16px">';
  var keys = ['1','2','3','4','5','6','7','8','9','⌫','0','CLR'];
  for (var i=0;i<keys.length;i++){
    var kk = keys[i];
    h += '<button data-act="key" data-k="'+esc(kk)+'"'+(lockedOut?' disabled':'')+'>'+esc(kk)+'</button>';
  }
  h += '</div>'
    + '<label class="rememberrow"><input type="checkbox" data-act="remember"'+(k.remember?' checked':'')+'>'
    + '<span>Remember for 30 minutes</span>'+sdChip('SD-10')+'</label>'
    + '<div class="btns"><button class="btn big quiet" data-act="close">CANCEL</button><span class="gap"></span>'
    + '<button class="btn big pri" data-act="submitcode"'+(lockedOut||k.value.length<4?' disabled':'')+'>UNLOCK</button></div>'
    + '<div class="hint">Demo: <b>4242</b> unlocks. Any other four digits returns the engine’s verbatim 401; the fifth failure returns the 429 lockout with a live countdown.</div>';
  return shellModal(h);
}
function benchOverlay(){
  return shellModal('<h3>Unlock operator controls</h3>'
    + '<div class="alert w"><div class="ttl">PRIVILEGED_AUTH_DISABLED (503)</div>'
    + '<div class="bod">This bench engine has no operator passcodes configured.</div></div>'
    + '<p>This bench engine has no operator passcodes — unlock controls?</p>'
    + '<div class="hint">A keypad is never faked when there is nothing to verify against. On an auth-required engine this dialog does not appear.</div>'
    + '<div class="btns"><button class="btn big quiet" data-act="close">CANCEL</button><span class="gap"></span>'
    + '<button class="btn big pri" data-act="benchunlock">UNLOCK CONTROLS</button></div>');
}
function sdOverlay(id){
  var d = SD[id];
  return shellModal('<h3>'+id+' — '+esc(d.t)+'</h3><div class="body">'
    + '<p><b>Option A.</b> '+esc(d.a)+'</p><p><b>Option B.</b> '+esc(d.b)+'</p>'
    + '<p><b>Recommendation:</b> '+esc(d.r)+'</p></div>'
    + '<div class="btns"><span class="gap"></span><button class="btn pri" data-act="close">CLOSE</button></div>');
}
function sdListOverlay(){
  var h = '<h3>SINA DECIDES — the performance-mode choices</h3><div class="body">';
  for (var k in SD){
    h += '<div style="border-left:3px solid var(--travel-purple);padding-left:10px;margin:10px 0">'
      + '<b>'+k+' — '+esc(SD[k].t)+'</b><br><span class="perfsub">A: '+esc(SD[k].a)+'</span><br>'
      + '<span class="perfsub">B: '+esc(SD[k].b)+'</span><br>'
      + '<span class="perfsub">Recommended: '+esc(SD[k].r)+'</span></div>';
  }
  h += '<p class="hint">SD-1 … SD-8 and SD-12 / SD-13 live in the four-view mock.</p></div>'
    + '<div class="btns"><span class="gap"></span><button class="btn pri" data-act="close">CLOSE</button></div>';
  return shellModal(h);
}
function confirmOverlay(o){
  var right = S.lastClickX < (window.innerWidth / 2);
  var cancel = '<button class="btn big quiet" data-act="close">CANCEL</button>';
  var go = '<button class="btn big '+(o.tone||'danger')+'" data-act="confirmdone" data-arg="'+esc(o.arg||'')+'">'+esc(o.goLabel)+'</button>';
  return shellModal('<h3>'+esc(o.title)+'</h3><p>'+esc(o.body)+'</p>'
    + (o.note ? '<p class="perfsub">'+esc(o.note)+'</p>' : '')
    + '<div class="btns">'+(right ? cancel+'<span class="gap"></span>'+go : go+'<span class="gap"></span>'+cancel)+'</div>');
}

/* ── demo dock ───────────────────────────────────────────────────── */
function renderDock(){
  if (S.dockMin) return '<button class="tbtn" data-act="dockmax">DEMO CONTROLS ▲</button>';
  var h = '<button class="close" data-act="dockmin">HIDE ▼</button><h4>Demo state</h4><div class="sgrid">';
  for (var i=0;i<PSTATE_ORDER.length;i++){
    var k = PSTATE_ORDER[i];
    h += '<button class="sbtn'+(S.pstate===k?' on':'')+'" data-act="pstate" data-p="'+k+'">'
      + '<span class="n">'+k+'</span><span>'+esc(PSTATES[k].name)+'</span></button>';
  }
  h += '</div>';

  h += '<h4>Night data underneath</h4><div class="tgrid">';
  var ds = ['S1','S2','S4','S5'];
  var cur = S.dataOverride || ps().data;
  for (var d=0;d<ds.length;d++){
    h += '<button class="tbtn'+(cur===ds[d]?' on':'')+'" data-act="data" data-d="'+ds[d]+'">'
      + ds[d]+' '+esc(SHOW_STATES[ds[d]].name)+'</button>';
  }
  h += '</div>';

  h += '<h4>Theme</h4><div class="tgrid">';
  var themes = ['light','dark','midnight','sunset','gruvbox'];
  for (var t=0;t<themes.length;t++){
    h += '<button class="tbtn'+(S.theme===themes[t]?' on':'')+'" data-act="theme" data-t="'+themes[t]+'">'+themes[t].toUpperCase()+'</button>';
  }
  h += '</div>';

  h += '<h4>Legibility</h4><div class="tgrid">'
    + '<button class="tbtn'+(S.theme==='light'&&!S.aplus?' on':'')+'" data-act="preset" data-p="day">DAY</button>'
    + '<button class="tbtn'+(S.theme==='midnight'?' on':'')+'" data-act="preset" data-p="night">NIGHT</button>'
    + '<button class="tbtn'+(S.aplus?' on':'')+'" data-act="aplus">A+ LARGE TYPE</button>'
    + '<button class="tbtn'+(S.glare?' on':'')+'" data-act="glare">SUN GLARE (mock aid)</button>'
    + '</div>';

  h += '<h4>Open decisions</h4>'
    + '<button class="tbtn" data-act="sdlist" style="width:100%;justify-content:center">SINA DECIDES (3)</button>';
  return h;
}

/* ── render ──────────────────────────────────────────────────────── */
function render(){
  document.documentElement.setAttribute('data-theme', S.theme);
  document.documentElement.setAttribute('data-aplus', S.aplus ? 'on' : 'off');
  document.body.setAttribute('data-glare', S.glare ? 'on' : 'off');

  renderRail();
  document.getElementById('work').innerHTML =
    renderHeader() + (unlocked() ? renderUnlocked() : renderPerf());
  document.getElementById('dock').className = S.dockMin ? 'min' : '';
  document.getElementById('dock').innerHTML = renderDock();
  document.getElementById('overlay').innerHTML = renderOverlay();
  document.getElementById('footnote').innerHTML =
    'Design mock for the CaptainPad Timeline PERFORMANCE composition. Fully offline: no CDNs, no web fonts, no images, no network calls of any kind. '
  + 'Headings use a Space Grotesk stack and body text an Inter stack with system fallbacks — the app itself loads the real families from local packages. '
  + 'Colour tokens are copied from the five CaptainPad palettes. 1 pt is drawn as 1 px. '
  + '<b>Honest scope:</b> unlocking hides or reveals controls ON THIS PAD. Until the engine gates the remaining mutating timeline and party routes while performance mode is active (ENGINE GAP EG-8), a stale pad or a script can still mutate the running show without a passcode — which is exactly why the chip reads "controls unlocked on this pad" and never "timeline unlocked".';
}

/* ── interaction ─────────────────────────────────────────────────── */
function toast(msg){
  var t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(function(){ t.style.display = 'none'; }, 2600);
}
function startTick(){
  clearInterval(_tick);
  _tick = setInterval(function(){
    var dirty = false;
    if (offline()){ S.offlineAgeSec += 1; dirty = true; }
    if (unlocked() && S.waiverSec > 0){
      S.waiverSec -= 1; dirty = true;
      if (S.waiverSec <= 0){ S.lock = 'locked'; S.expiredNotice = true; }
    }
    if (S.keypad && S.keypad.lockoutSec > 0){
      S.keypad.lockoutSec -= 1;
      if (S.keypad.lockoutSec <= 0){ S.keypad.fails = 0; S.keypad.error = null; }
      dirty = true;
    }
    if (dirty) render();
  }, 1000);
}
function applyPState(k){
  S.pstate = k;
  var p = PSTATES[k];
  S.dataOverride = null;
  S.lock = p.lock;
  S.waiverSec = p.waiverSec || 0;
  S.offlineAgeSec = 33;
  S.reconnected = false;
  S.expiredNotice = false;
  S.keypad = null;
  S.overlay = null;
  if (p.openKeypad) openKeypad();
  render();
  startTick();
}
function openKeypad(){
  if (ps().authDisabled){ S.overlay = { type:'bench' }; return; }
  S.keypad = { value:'', fails:0, error:null, lockoutSec:0, remember:false };
  S.overlay = { type:'keypad' };
}

document.addEventListener('click', function(ev){
  var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
  if (!el) return;
  S.lastClickX = ev.clientX || 600;
  var a = el.getAttribute('data-act');
  switch (a){
    case 'rail':
      toast(el.getAttribute('data-name') + ' — rail shown as context only in this mock. Nothing navigates.'); return;
    case 'aplus': S.aplus = !S.aplus; render(); return;
    case 'glare': S.glare = !S.glare; render(); return;
    case 'theme': S.theme = el.getAttribute('data-t'); render(); return;
    case 'preset':
      if (el.getAttribute('data-p') === 'day'){ S.theme = 'light'; S.aplus = false; }
      else S.theme = 'midnight';
      render(); return;
    case 'pstate': applyPState(el.getAttribute('data-p')); return;
    case 'data': S.dataOverride = el.getAttribute('data-d'); render(); return;
    case 'details': S.detailsOpen = !S.detailsOpen; render(); return;
    case 'dockmin': S.dockMin = true; render(); return;
    case 'dockmax': S.dockMin = false; render(); return;
    case 'sd': S.overlay = { type:'sd', id:el.getAttribute('data-sd') }; render(); return;
    case 'sdlist': S.overlay = { type:'sdlist' }; render(); return;
    case 'close': S.overlay = null; S.keypad = null; render(); return;
    case 'scrim': if (ev.target.classList.contains('scrim')){ S.overlay = null; S.keypad = null; render(); } return;

    case 'reconnect':
      S.reconnected = true;
      S.lock = 'locked'; S.waiverSec = 0;
      S.expiredNotice = true;
      toast('Engine back. Sessions and waivers live only in engine memory — every pad comes back view-only.');
      render(); return;
    case 'unlock': S.expiredNotice = false; openKeypad(); render(); return;
    case 'remember': S.keypad.remember = el.checked; render(); return;
    case 'key': {
      var k = el.getAttribute('data-k');
      if (k === '⌫') S.keypad.value = S.keypad.value.slice(0, -1);
      else if (k === 'CLR') S.keypad.value = '';
      else if (S.keypad.value.length < 8) S.keypad.value += k;
      S.keypad.error = null;
      render(); return;
    }
    case 'submitcode': {
      var kp = S.keypad;
      if (kp.value === '4242'){
        S.lock = 'unlocked';
        S.principal = 'OWNER';
        S.waiverSec = kp.remember ? 1800 : 1781;
        S.overlay = null; S.keypad = null;
        toast('Passcode verified by the engine — controls unlocked on this pad.');
        render(); startTick(); return;
      }
      kp.fails += 1;
      kp.value = '';
      if (kp.fails >= 5){
        kp.lockoutSec = 60;
        kp.error = { ttl:'429 TOO MANY ATTEMPTS',
          bod:'{"error":"passcode attempts locked out","retryAfterMs":60000} — 5 failures in 60 s locks this remote out.' };
      } else {
        kp.error = { ttl:'401 UNAUTHORIZED',
          bod:'{"error":"invalid operator passcode"} — attempt ' + kp.fails + ' of 5.' };
      }
      render(); return;
    }
    case 'benchunlock':
      S.lock = 'unlocked'; S.principal = 'BENCH'; S.waiverSec = 1800;
      S.overlay = null;
      toast('Bench engine has no passcodes — controls unlocked on this pad.');
      render(); startTick(); return;
    case 'relock':
      S.lock = 'locked'; S.waiverSec = 0; S.expiredNotice = false;
      toast('Re-locked. This pad is view-only again.'); render(); return;

    case 'endshow':
      S.overlay = { type:'confirm', title:'End this show?',
        body:'End the running show? The plan resumes with whatever owns this moment.',
        note:'The ended show is never resurrected.', goLabel:'END SHOW', arg:'END SHOW' };
      render(); return;
    case 'partytoggle': {
      var on = partyModel().enabled;
      S.overlay = { type:'confirm', title: on ? 'Disable party mode?' : 'Enable party mode?',
        body: on ? 'Disabling party mode kills the running session immediately; detection keeps running.'
                 : 'Enabling party mode lets sustained music start a session while the eligibility window is open.',
        goLabel: on ? 'DISABLE PARTY MODE' : 'ENABLE PARTY MODE',
        tone: on ? 'danger' : 'pri', arg:'PARTY MODE' };
      render(); return;
    }
    case 'fire': {
      var cid = el.getAttribute('data-cue'), mc = null;
      for (var i=0;i<MANUAL_CUES.length;i++) if (MANUAL_CUES[i].id === cid) mc = MANUAL_CUES[i];
      S.overlay = { type:'confirm', title:'Fire ' + mc.btn + '?',
        body: mc.label + ' — ' + mc.consequence,
        note:'The deck changes the moment you confirm.', goLabel:'FIRE ' + mc.btn, arg: mc.btn };
      render(); return;
    }
    case 'confirmdone':
      S.overlay = null;
      toast(el.getAttribute('data-arg') + ' confirmed (mock) — nothing fired.');
      render(); return;
  }
});

document.addEventListener('keydown', function(ev){
  if (ev.target && /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return;
  var n = ev.key;
  if (n >= '1' && n <= '6'){ applyPState(PSTATE_ORDER[(+n) - 1]); return; }
  if (n === 't' || n === 'T'){
    var ts = ['light','dark','midnight','sunset','gruvbox'];
    S.theme = ts[(ts.indexOf(S.theme) + 1) % ts.length]; render(); return;
  }
  if (n === 'Escape' && S.overlay){ S.overlay = null; S.keypad = null; render(); }
});

applyPState('P1');
</script>
</body>
</html>
``````
