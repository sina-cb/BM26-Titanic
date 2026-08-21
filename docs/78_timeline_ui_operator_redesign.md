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
6. **Keep Time Travel.** It becomes an explicit local view as well as the
   destination reached by tapping a calendar cue or empty time.
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
  remain truthful.
- Party eligibility is not Party enablement. The UI must say both facts.
- Disabling Party during a session, ending a program, firing a manual cue,
  activating a plan, or entering Time Travel must keep existing confirmation,
  priority, and error behavior.
- Engine-offline state remains explicit. No button pretends that an action was
  accepted when the engine could not confirm it.

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

### Manual events

- Retain current manual event access and confirmations.
- Use at least 52-point targets.
- Every button names the event; icon/color may supplement but never replace
  text.
- Dangerous/high-output events keep explicit confirmation and current priority
  handoff behavior.

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
- An empty-time tap snaps through the existing 15-minute rule and opens Time
  Travel review for that instant.
- Current day, current time, and live cue markings appear only on today's
  occurrence. Do not mark every repeated cue instance live.
- Cue blocks must have a minimum usable hit region even when their proportional
  duration is short.
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
- A Calendar View empty-time tap.
- A non-live cue review action.
- Existing event-sheet actions that already resolve to Time Travel.

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

- Draft cue rows do not expose a live `FIRE` button unless the engine confirms
  that exact cue belongs to the active, saved plan.
- Preserve current `save` versus `activate` blocked-reason copy.
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
| NOW | `state.activeCue`, `state.activeProgram`, resolved/default state |
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
- Calendar empty-time tap uses the existing 15-minute snap and opens Time
  Travel review.
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

