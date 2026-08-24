# 342 — Timeline UI: review of docs/78 + external mock, and the full design spec

**Role:** design lead (review + specification only — no mock is built by this
wave; a separate implementer builds the mock strictly from §6 of this report).
**Inputs reviewed:** `docs/78_timeline_ui_operator_redesign.md` (the approved
plan), the externally-authored standalone HTML mock (local scratch copy,
untracked — content reviewed in full), the real Timeline code (CaptainPad +
engine), `docs/77_bm26_night_arc_timeline.md` v2, the two in-tree
`playa_default.yaml` night-arc plans (foreign-owned, read-only), and reports
`_338` / `_341` §5/§5b.

**One factual correction up front:** the Timeline screen is
`CaptainPad/app/(tabs)/timeline.tsx` (2 460 lines; header comment names it the
Timeline tab, `timeline.tsx:1-45`). `CaptainPad/app/(tabs)/scheduler.tsx` is a
different tab — the scheduled-task list (hazer etc., `scheduler.tsx:1-27`).
Everything below is grounded on `timeline.tsx`.

---

## A. Plan (docs/78) vs the real code

**Verdict: implementable as written, with three real frictions the plan
under-states.** Every behavior docs/78 says must survive actually exists, in
the places it assumes:

| docs/78 claim | Real code |
|---|---|
| Global rail is owned by the layout; Timeline inherits it | `app/(tabs)/_layout.tsx:74` (width 112), `:236` (content `marginLeft: 112`), route entries `:243-296` |
| Party controls live on Timeline (gate, playlist, numbers) | `PartyModeSection`, `timeline.tsx:1797-2152`; server truth `GET/PUT /party-config` (`api_server.js:9314,9331`), WS `partyConfig` broadcast (`timeline.tsx:1838-1843`), 5 s poll (`:1851-1854`) |
| Live Touch handoff / priority feedback | lease mirror `timeline.tsx:327-364`; `beginPriorityHandoff`/`finishPriorityHandoff` `:374-415`; armed-lease banner `:1298-1304`; copy helpers `utils/timeline_priority_feedback.ts` |
| Auto-save with truthful states | `TimelineDraftSaver` wiring `timeline.tsx:688-701`, debounce `:800-833`; labels `UNSAVED / SAVING… / ✓ SAVED / ⚠ FIX TO SAVE / ⚠ NOT SAVED · LIVE TOUCH` `:544-558`; retry incl. `PREEMPT LIVE TOUCH + RETRY` `:1317-1333` |
| Draft vs active identities distinct | fire-gating on `liveOverview` ids with blocked reasons `save`/`activate` `:1543-1562`; `MAKER — <name>` vs `ACTIVE PLAN` header `:1187-1204,1427` |
| Calendar tap opens review first, never moves the rig | `openEvent`/`openMoment` do a read-only `GET /timeline/resolve` peek `:1062-1095`; `DayView` is a zero-engine-call browse level (`DayView.tsx:1-33`) |
| 15-minute empty-time snap | `TRAVEL_TAP_SNAP_MIN = 15`, `chartTapToLocal` (`components/timeline/zoom_logic.ts:45,56`) |
| Time Travel semantics + purple banner + RESUME | `handleTravel` `:1132-1151`; `POST /timeline/travel` forms (`utils/timelineApi.ts:788-811`); global `ZoomBanner` with EXIT + prev/next steppers (`ZoomBanner.tsx:113-175`) |
| PERFORM only for the live cue | `eventZoomMode`/`canPerform` (`zoom_logic.ts`, used `EventSheet.tsx:88-93`) |
| Engine-offline explicit | `isOffline` banner `timeline.tsx:1274-1287`; hook contract "never stale data" (`hooks/useTimeline.ts:18-20,101-156`) |
| Confirmation patterns | `opConfirm`/`opWarn` (`utils/op_dialog`), `babyRevealConfirmation` (`components/timeline/baby_reveal_confirmation.ts`) |

The reuse list is accurate: `DayOverviewStrip / DayView / EventSheet /
ZoomBanner / PlanPickerSheet / CueEditorSheet / FestivalEditor /
PlanIndicatorPill / PendingProgramOverlay` all exist under
`CaptainPad/components/timeline/`.

**Friction 1 — the ALWAYS-EDITING model vs "LIVE never looks like a draft".**
Since the 2026-07-03 operator ruling, the tab auto-loads the ACTIVE plan into
the draft the moment it has one (`timeline.tsx:640-670`), and the strip then
renders the DRAFT preview, not the live overview (`overview = draft ?
draftOverview : liveOverview`, `:539`). Under the 4-view split this single
`overview` selector would become a second source of truth. The design (§6)
resolves it explicitly: **LIVE and CALENDAR VIEW always render from
`liveOverview` + engine state; only EDIT PLAN renders the draft preview.**
Because auto-save hot-reloads the active plan (`persistPlan`,
`timeline.tsx:676-686`), the two converge within ~1 s of a save — but the
views must still read different authorities, and the plan should say so.

**Friction 2 — D1 (tab-return exits the zoom) collides with a Time Travel
view.** Today, focusing the Timeline tab ends a zoom this client entered
(`timeline.tsx:1153-1172`, gated by `zoomEnteredHere()`,
`hooks/useTimeline.ts:321-344`). If TIME TRAVEL becomes a view INSIDE the
Timeline tab, an operator returning to Timeline to check their travel target
would instantly cancel their own travel. docs/78 slice 1 flags "decide reset
behavior on tab blur" but does not resolve this. This is an operator-gated
behavior change → **SINA DECIDES SD-1** (§6.10; my recommendation: drop the
tab-return auto-exit when the redesign lands; exits become the explicit
`RESUME LIVE` button and the banner's `EXIT` only).

**Friction 3 — the plan's header wants "audio mood when available", but the
staleness signal is untyped client-side.** The wire carries
`moodStale/moodStaleForSec/moodKey/moodRawValue` and `planWarnings`
(`timeline_service.js getState`, `:3027-3032,3051`), but
`utils/timelineApi.ts TimelineState` (`:174-242`) does not declare them. Not
an engine gap — a small CaptainPad typing addition the implementation slice
must include (docs/77 §8.2 makes audio staleness an operator-visible state).

Minor: docs/78's data table maps NOW to `state.activeCue` — that is only true
for programs and `durationMin` windows (see §C, first scenario, and EG-1).

## B. The external mock vs its own contract

**Verdict: right silhouette, fails its own contract in nine concrete places.
Do not carry its CSS or copy forward verbatim.** The 4-tab structure, the
NOW-hero + NEXT-list left column, the party/manual-events right column, and
the day-selector + day-calendar split are all keepable skeletons.

Violations (against docs/78's own rules and against reality):

1. **Machine-path `@font-face`** (mock lines 8-17): absolute `file:///C:/…`
   URLs into this machine's `node_modules`, embedding the local username. Dead
   on any other machine, and the exact class of leak the public-repo P0 bans.
   The rebuilt mock must use font-family stacks with system fallbacks and zero
   URLs (§6.11).
2. **Light theme only, hard-coded hexes** (`--cyan: #006875` etc., lines
   18-38). docs/78 requires all five themes and semantic tokens, and
   explicitly orders the removal of inline green/amber literals — the mock
   reintroduces them (`--green` used for live state, line 106).
3. **No alert slot at all.** The one-alert-slot ladder is a headline feature
   of the plan (docs/78 "Alert priority is deterministic"); the mock's header
   shows only a happy-path pill cluster (lines 334-339). No engine-offline, no
   handoff, no draft-invalid, no stale state exists anywhere in it.
4. **Invented endpoints.** `PREVIEW CURRENT` (line 362) and `PREVIEW SAFELY`
   (line 555) correspond to no engine route (`api_server.js:9314-9583` is the
   full timeline/party surface). Nothing may appear on the UI that the engine
   cannot serve.
5. **EDIT PLAN shows a `SAVE DRAFT` button and claims "no live action occurs
   from this screen until explicitly saved and activated"** (lines 543-554).
   Both wrong: the maker is auto-save (no save button since the 2026-07-02/03
   rulings, `timeline.tsx:293-297`), and saving the ACTIVE plan hot-reloads
   the running show (`timeline.tsx:676-686`). That sentence, on a rig UI,
   is a dangerous falsehood.
6. **Calendar taps skip review.** Every cue block and empty lane jumps
   straight into the TIME TRAVEL tab with the target pre-set (lines 654-658).
   docs/78: a cue tap opens the existing review sheet (which is also the only
   PERFORM path); an empty-time tap opens Time Travel *review*. The mock
   erases the cue-review rung and the PERFORM branch entirely.
7. **Touch/type floors broken in the calendar**: cue blocks `min-height: 30px`
   at `font-size: 11px` (line 174-177), hour lanes 38 px (line 169). Plan
   floor: 44 pt hit regions, essential text ≥ 16 pt (fine grid labels are
   excusable only because the adjacent arc-list duplicates them — the blocks
   are still interactive and under-sized).
8. **Time Travel has no read-only resolve, no active state, no RESUME LIVE.**
   The "resolved" card is static decoration that ignores the dial; there is no
   travel-active presentation, no rejection state, and the plan's own rule
   that the preview updates per target is unimplemented.
9. **Party card knows only OFF/ENABLED.** No in-session, no cooldown, no
   eligibility-window facts from the plan (`state.phases.party_window`), no
   ENGINE OFFLINE state — all of which the real card already renders
   (`party_api.ts:385-462`).

Also noted: the mock duplicates the rail (acceptable for a standalone mock as
labeled shell context; the real implementation must not — docs/78), and its
demo ribbon + "nothing fires" honesty line are good and kept in §6.11.

## C. Programs fit — the hard scenarios

Walked against the in-tree night-arc plan (foreign-owned, read-only:
`simulation/scenes/titanic/timeline/playa_default.yaml`) and the engine as it
is on this branch (incl. report `_338`'s phase-aware default + END-SHOW
fixes).

**02:37, deep night, party in cooldown.** Plan truth first: `b2_uv_lasers`
runs 01:10→02:30 (`playa_default.yaml:226-246`); at 02:37 the owner is
actually `r2_quiet_reset` (02:30→02:40, `:247-262`), with `b3_ember_hold` next
at 02:40. This is exactly why the NOW card must come from the resolver, not
from guesswork — **and here is the load-bearing engine finding: for `kind:
ambient` block cues with no `durationMin`, `state.activeCue` is NULL**
(`timeline_service.js:2969-2988` — activeCue is only a running program or a
`_deckWindowCueId` window owner). All six deep-night blocks are `ambient`
without durations, so for most of every night the live state's `activeCue`
cannot name the block. The honest source that CAN is the per-day resolved
segments the overview already ships (`utils/timelineApi.ts:598-620`,
`OverviewSegment.owner/playlist/palette/source`), which tile 00:00→24:00 —
and the plan's `b1_midnight_carry` cue (`playa_default.yaml:189-209`) means
today's segments genuinely own the after-midnight hours. So LIVE at 02:37
shows: NOW = "Quiet reset 2 — Electric Ice hush · night_quiet_reset_ice ·
since 02:30 · until 02:40", NEXT = 02:40 Ember Hold / 04:00 Open Sea /
~04:2x Pre-dawn (sun) / ~06:0x Sunrise Bloom (sun), PARTY = ON · WINDOW OPEN ·
COOLDOWN m:ss (from `/party-config` `effectiveState:'cooldown'` +
`cooldownRemainingSec`, `timeline_service.js:1678-1693`). Every datum is
queryable today (§6.8); the derivation is EG-1/EG-2, not a new engine feature.

**Dust cue.** `c_dust_storm` is a manual program with NO hold
(`playa_default.yaml:416-433`) — it owns the deck until END SHOW. State gives
`activeProgram`/`activeCue` with `untilMs: null`, controller `program`. LIVE
must show: NOW = "DUST STORM — high-visibility beacon", ownership line "holds
until you end it", one 56 pt `END SHOW` action, and the party pill reading
"SUPPRESSED — a show holds the deck" (derived: controller === 'program';
`getPartyStatus` has no such state — EG-4). Report `_338` A2/A3 guarantee END
SHOW resumes into the time-owning cue and never resurrects the ended show —
the confirm copy must say exactly that ("The plan resumes with whatever owns
this moment").

**Morning watch.** 07:30: `c_morning_watch` is a program with `hold.until
09:00` (`playa_default.yaml:347-367`) — here `activeCue.untilMs` IS set, NOW
shows a real countdown to 09:00, master 0.4 is visible in the cue's authored
action (overview `cue.action.globals.master`). Party: window closed
(`state.phases.party_window.end` passed; `currentPhase` null). The NEXT list's
first row is 09:00 "Day Off — output dark" — the design renders a `MASTER 0%`
tag on it so lights-out is never a surprise.

**Burn-night preemption.** `c_burn_night` (day 6, sun-anchored program, hold
120, master 1.0 — `playa_default.yaml:476-495`) preempts the block structure
by arbiter precedence. LIVE shows it as a SHOW (program) with countdown +
END SHOW; the calendar day-6 column already renders the displaced blocks
honestly via segments. No UI special-case needed.

**Engine restart at 02:00.** Boot `_catchUp` re-resolves the owner (docs/77
§8.4; `_338` restart probes prove 02:00 lands in the correct block). During
the outage the UI must show OFFLINE with data age; after reconnect the EVENT
LOG (`state.recentFires`, lifecycle entries) shows `activated/resumed` +
`catchUp`-source fires — LIVE's log drawer surfaces the last few so the
operator can see the resume happened, phase-correct.

**Codex's alternative 3-view structure (RUN SHOW / NIGHT SCHEDULE / EDIT
PLAN — Time Travel folded into the schedule view).** Position: **rejected;
keep the plan's four views.** Reasons: (1) Time Travel is a rig-moving MODE
with persistent engine state (`zoom`), a global banner, and its own
failure/rejection surface — folding it into a browse view blurs docs/78's
operator question 5 ("is this live, a review, a snapshot, or a draft?"), the
one confusion that actually moves the deck; (2) the calendar must stay a
surface that can never move the rig by itself (`DayView.tsx:6-11` — that
guarantee is architectural today and worth keeping legible); (3) docs/78
records the 4-view split as a closed decision (D3/D6 of its Decisions list).
One Codex instinct IS adopted: the schedule view gets the always-visible
paired text list beside the chart (their arc-list), which is better than the
current chart-only day.

## D. Playa chaos

- **Gloved/dusty fingers:** floors in §6.7 (48 pt standard, 56 pt critical,
  44 pt minimum anywhere); no drag-only interactions anywhere in the four
  views (the ±15 steppers replace scrubbing; DayTimePicker's drag remains an
  EDIT-only affordance with tap-stepper equivalents).
- **Blazing day vs 4 am dark:** the five themes already span it
  (`constants/theme.ts:78-298` — light for day, midnight/sunset for night);
  §6.9 adds the A+ large-type toggle and forbids any state carried by color
  alone (every pill/tag has words).
- **Exhausted operator:** one alert expanded ever (§6.3 ladder); verbs on all
  buttons; NOW answers "what/since/until/next" in a single card; END SHOW and
  DISABLE PARTY MODE both confirm with consequence-naming copy.
- **Stale-data honesty:** the hook already refuses to fake liveness
  (`useTimeline.ts:18-20`); §6.6 adds a client-side `receivedAt` stamp so the
  offline banner can say how old the last truth is, disables (never hides)
  every action with the reason, and watermarks data regions STALE — old state
  is never presented as live.
- **Accidental-touch resistance:** END SHOW / manual events / party disable
  keep `opConfirm` with named consequences; the confirm dialog's destructive
  button is never placed under the finger that opened it (§6.7).
- **Fully offline:** no CDNs/fonts/telemetry anywhere (app already vendors
  fonts via local packages; the mock contract §6.11 bans all URLs).

---

# The design specification

## 6.1 View structure (chosen)

Four Timeline-local views under the persistent Timeline header, exactly per
docs/78: **LIVE** (default) · **CALENDAR VIEW** · **TIME TRAVEL** · **EDIT
PLAN**. Segmented control directly under the header; buttons ≥ 56 pt tall,
full width of the workspace, `C.primary` selection treatment
(`sidebarActive*` recipe). Where this spec differs from docs/78 or the mock,
the difference is stated inline and, when it touches a shipped operator
ruling, it is a SINA DECIDES item.

View persistence: the selected view is local UI state; it survives sheet
open/close; on tab entry the default is LIVE, except when an active travel
zoom exists (`state.zoom?.scope === 'travel'`) in which case the tab opens on
TIME TRAVEL showing the active-travel state (docs/78 slice 1's option, now
pinned) — contingent on SD-1.

## 6.2 Persistent Timeline header

One row, ~64 pt, plus the alert slot beneath. Left→right:

- `ACTIVE PLAN` label (timelineMeta, `C.secondary`) over the plan name
  (timelineTitle 24, `C.text`) with the running dot (`C.tertiary` when
  `state.planActive`, `C.secondary` otherwise). Source: `state.activePlan`,
  `state.planActive`.
- Status pills (non-interactive, text + dot, `Radius.control`; each has its
  word, color is secondary):
  - **ENGINE** — `LIVE` (`C.tertiary`) / `OFFLINE` (`C.error`). Source: WS
    `connected` AND `state.engineConnected`.
  - **CONTROL** — `AUTOPILOT` (`C.tertiary`) / `SHOW RUNNING` (`C.warning`)
    / `MANUAL` (`C.warning`). Source: `state.controller` + `state.mode`.
  - **PARTY** — `OFF` (`C.error`) / `ARMED` / `IN SESSION` (`C.tertiary`) /
    `COOLDOWN m:ss` / `WINDOW CLOSED` / `SUPPRESSED` — §6.8 rows P1-P7.
  - **AUDIO** — `CALM` / `PARTY` / `STALE Xs` (`C.warning`). Source:
    `state.currentMood`, `state.moodStale`, `state.moodStaleForSec` (typing
    addition, §A friction 3).
- `A+` large-type toggle (48 pt) — §6.9.

**The one-alert slot.** Exactly one expanded alert renders under the header;
everything lower-priority collapses into a `DETAILS (n)` disclosure row
(48 pt). Ladder (top wins; extends docs/78's five levels by splitting level 1
and inserting audio staleness — stated deviation):

1. **ENGINE OFFLINE** — "Engine unreachable — last data HH:MM:SS (Xs ago).
   The rig keeps running its plan on its own." (client `receivedAt`, §6.6)
2. **ACTION FAILED / REJECTED** — verbatim engine error (`actionError`,
   failed `priorityFeedback`, `saveFailure`) + `RETRY` where one exists.
3. **LIVE TOUCH HANDOFF** — pending/succeeded/rejected copy from
   `timeline_priority_feedback`, plus the standing armed-lease warning.
4. **ZOOM ACTIVE** — perform (green) / travel (purple) one-liner; the global
   `ZoomBanner` stays authoritative and unchanged.
5. **AUDIO COMPANION STALE** — "Party detection is down; mood forced CALM."
   (`moodStale`; docs/77 §8.2 requires this be loud.)
6. **DRAFT INVALID / NOT SAVED** — mirrors the EDIT PLAN chip globally.
7. Informational (pre-festival "starts in N days" note, `planWarnings`
   count).

## 6.3 LIVE view

Landscape grid: left column ~62 %, right ~38 %, `Space.lg` gutters.

**NOW card** (left-top, `surfaceContainerLow`, `Radius.panel`; the ONLY
glowing/live-tinted card on the screen):

- Kicker: `● ON THE SHIP NOW` (timelineMeta, `C.tertiary`) + an ownership
  chip in words: `LIVE CUE` / `SHOW` / `PARTY SESSION` / `DEFAULT LOOK` /
  `BASELINE` / `OPERATOR (MANUAL)` — from the NOW resolution rule (§6.8 N1).
- Name: timelineHero 34/38, the block/cue/program label (e.g. "Quiet reset 2
  — Electric Ice hush"). Never empty: when nothing cue-specific owns the
  deck, show the defaultCue label or "Autopilot baseline — ambient" (N1).
- Sub-line (timelineBody): `playlist · palette` from the owning segment /
  resolve.
- Times row (timelineCue, tabular): `since HH:MM` · progress bar
  (decoration) · `until HH:MM — NEXT: <label>` (N2/N3). When the owner is an
  un-held program (dust): `holds until you end it`.
- Actions row: `END SHOW` (danger, ≥56 pt) only when `state.activeProgram`
  is set — confirm: "End <label>? The plan resumes with whatever owns this
  moment." `RESUME LIVE` (purple, ≥56 pt) only when a travel zoom is active.
  Nothing else. No PERFORM here (it stays on the cue review sheet).

**WHAT HAPPENS NEXT** (left-bottom): the next four transitions (SD-6 for
count), each row ≥ 60 pt: time (timelineCue tabular) · label (timelineCue) ·
one-word behavior tag in text (`SHOW` / `AMBIENT` / `RESET` / `SUN` /
`MASTER 0%` / `PARTY WINDOW`). Row tap opens the existing `EventSheet`
review (never fires). Footer button `OPEN CALENDAR VIEW` (48 pt) switches
the local view. Source + cross-midnight join rule: §6.8 N4.

**PARTY MODE card** (right-top) — two facts, never conflated (docs/77 §4.1):

- Line 1 (timelineTitle): `PARTY MODE ON` / `PARTY MODE OFF` — the human
  gate only (`partyEnabled`).
- Line 2 (timelineBody): eligibility — "Window 9:30 PM → sunrise−2h ·
  open now" / "closed now", from `state.phases.party_window` +
  `state.currentPhase === 'party_window'`.
- Line 3 (timelineCue): the live sub-state with countdown — `IN SESSION ·
  ends m:ss` / `COOLDOWN · m:ss` / `ARMED — waiting for sustained music` /
  `SUPPRESSED — a show holds the deck` (§6.8 P-rows; copy base:
  `party_api.ts describePartyStatus`).
- Action (≥56 pt, verb): `ENABLE PARTY MODE` / `DISABLE PARTY MODE`.
  Disable during a session confirms with the existing truth: "kills the
  running session immediately; detection keeps running"
  (`timeline.tsx:2146`).
- `PARTY SETTINGS` disclosure (48 pt row): the existing trigger-playlist
  chips + SUSTAIN / SESSION LENGTH / COOLDOWN steppers, logic unchanged
  (`PartyModeSection`). Note for the implementer: playlist names come from
  `availablePlaylists` — never hardcode `party_high` (the fast/slow split
  proposal `_337` may rename the pair).

**MANUAL EVENTS card** (right-bottom): one ≥52 pt button per manual-trigger
cue of the ACTIVE plan (derived, not hardcoded — §6.8 M1): with today's plan
that is `DUST STORM BEACON`, `MAXA PARTY`, `PHILHARMONIC`, `BABY REVEAL…`
(opens the protected pink/blue flow via `babyRevealConfirmation`, never fires
directly). Every button = event name in text; every fire goes through
`opConfirm` naming the consequence ("Owns the deck until END SHOW" for dust).
Corner tag: `CONFIRM TO FIRE`. SD-3 governs which subset appears.

Timeline AUTO toggle (`setAutopilot`) moves into the header's `DETAILS`
drawer with verb labels `DISABLE TIMELINE AUTO` / `ENABLE TIMELINE AUTO`
(SD-4) — it is a rare, consequential control, not a per-night one.

## 6.4 CALENDAR VIEW

Left rail (~180 pt): festival day buttons `D1 · SUN` … from
`liveOverview.days` (weekday + index; TODAY badge on `todayIndex`), ≥58 pt
each, prev/next at the bottom. Main area: the existing `DayView` composition
(phase bands, resolved-ribbon segments, sun markers, cue blocks, NOW playhead
on today only — `timeline.tsx:1375-1395` prop rules preserved) side-by-side
with a text cue list for the selected day (time · label · tag rows,
timelineCue — the calendar's readable equivalent, required by docs/78).

Rules: cue-block tap → `EventSheet` (review; PERFORM offered only for
today's live occurrence); empty-lane tap → 15-min snap → `EventSheet` MOMENT
mode; both unchanged engine-wise. Every block gets a ≥44 pt hit region via
layout/hitSlop regardless of proportional height. Chart hour labels may stay
small ONLY because the adjacent list duplicates the content at timelineCue
size. **This view renders `liveOverview` only** (§A friction 1). Editing is
not done here: an `EDIT THIS DAY` button (48 pt, quiet) jumps to EDIT PLAN
with the day preselected (SD-2; deviation from docs/78's "retain inline edit
controls" — rationale: decision 7's draft/live separation is worth more than
one saved tap).

## 6.5 TIME TRAVEL view

Two panels. Left — TARGET: festival-day selector (same rail vocabulary),
large target time (timelineHero, tabular), `−15` / `+15` steppers (≥56 pt;
`TRAVEL_TAP_SNAP_MIN` stepping), and the primary `TIME TRAVEL HERE` (purple,
≥56 pt, full width). Under it, plain words: "The live clock and schedule keep
running. RESUME LIVE returns the ship to now." Prev/next EVENT steppers
render ONLY while a travel zoom is active (the engine's `{step}` form
requires one and 400s past the day's first/last event —
`timelineApi.ts:788-798`; errors shown verbatim, target retained).

Right — RESOLVED PREVIEW (read-only): on every target change, debounced
~250 ms, `GET /timeline/resolve?date&time`; render owner label + kind,
playlist · palette, phase, controller, `window until`, source note (incl.
the `hold-expired-baseline` warning vocabulary from `EventSheet.tsx:97-105`),
and the following cue (derived: next overview cue after the target). A 400
(out-of-window, malformed) replaces the card with the engine's verbatim
message — no preview is ever invented, and `TIME TRAVEL HERE` disables with
the reason while the resolve is failed/pending.

Active-travel state: purple-framed banner inside the view — `TIME TRAVELING ·
D5 02:30` + `RESUME LIVE` (≥56 pt) + the deferred-show row when
`zoom.pendingDeferred` is set (ENABLE action, same as the global banner).
The global purple `ZoomBanner` remains mounted and unchanged on every tab.
Travel remains one-tap (no confirm — it is non-destructive and reversible via
RESUME LIVE; SD-8 records the alternative).

## 6.6 Stale / offline presentation (all views)

- The hook stamps `receivedAt` client-side on every `timelineState`
  (new, trivial; EG-5). Header pill flips to OFFLINE the moment the WS status
  or a REST failure says so.
- Alert slot #1 shows the age and grows a live counter ("42 s ago").
- Every action button DISABLES with its reason in place ("engine offline") —
  nothing is hidden, nothing pretends.
- Data regions (NOW, NEXT, calendar, party numbers) stay rendered with a
  `STALE` chip per card; the party card uses its existing `ENGINE OFFLINE`
  state (`party_api.ts:437`). Time Travel preview refuses to resolve and
  says so.
- On reconnect the alert clears itself; the EVENT LOG shows what happened
  while we were blind (engine `recentFires` ring).

## 6.7 Typography, targets, color

Adopt docs/78's recipes verbatim into `theme.ts` + `DESIGN.md`:
`timelineHero` SG-700 34/38 · `timelineTitle` SG-700 24/28 · `timelineCue`
SG-700 18/22 (tabular numerals for times) · `timelineBody` Inter-400 16/22 ·
`timelineMeta` Inter-600 14/18. Existing `Type.labelCaps/microCaps`
(`theme.ts:387-395`) only for chrome. Essential state never below 16 pt.

Targets: standard control ≥ 48 pt; `END SHOW`, `TIME TRAVEL HERE`,
`RESUME LIVE`, `ENABLE/DISABLE PARTY MODE`, manual events ≥ 56 pt (events
≥ 52 pt per docs/78); any interactive pill ≥ 44 pt hit region; calendar
blocks ≥ 44 pt via hitSlop. Confirm dialogs: destructive action on the side
OPPOSITE the invoking button's screen half.

Color: tokens only — `C.tertiary` live/auto/connected, `C.warning`
caution/another-driver, `C.error` failure/off/blackout, `C.primary`
selection, `PLAN_ACCENT` (`constants/identity.ts:67`) only where the identity
system already uses it (plan pill). The perform-green / travel-purple pair
stays the `ZoomBanner` constants (`ZoomBanner.tsx:38-39`) for cross-tab
consistency. Replace every inline `#00a86b` / `#f5a623` in Timeline files
with tokens (docs/78 slice 6). Radii `Radius.control/card/panel/shell`;
spacing from `Space`. No glow on resting cards.

## 6.8 Every displayed datum → its real source

Legend: **[derived]** = pure client computation over listed sources.
ENGINE GAPs are marked; none block the design.

| # | Datum | Source |
|---|---|---|
| H1 | Active plan name / running | `GET /timeline/state → activePlan, planActive` |
| H2 | Engine pill | WS status `connected` + `state.engineConnected` |
| H3 | Controller pill | `state.controller`, `state.mode` |
| H4 | Audio pill | `state.currentMood`, `state.moodValue`, `state.moodStale`, `state.moodStaleForSec` (wire: `timeline_service.js:3016-3032`; **CaptainPad type gap**, add to `TimelineState`) |
| H5 | Pre-festival note | `state.inFestivalWindow`, `state.festivalStartsInDays` |
| H6 | Plan warnings count | `state.planWarnings` (type gap, same as H4) |
| N1 | NOW owner | `state.activeCue` (program / durationMin window / party session) when non-null; **else [derived]**: today's `liveOverview.days[todayIndex].segments` at now-minutes → `owner.label/kind`, `playlist`, `palette`, `source`; `controller==='manual'` overrides to OPERATOR. **ENGINE GAP EG-1 (nice-to-have):** additive `resolvedOwner` on `/timeline/state` would remove the join; segments make it fully derivable today. |
| N2 | NOW "since HH:MM" | **[derived]** newest `state.recentFires` entry (`kind:'fire'`) whose `cueId` = owner; else the owning segment's `fromLocal` labeled "scheduled". **ENGINE GAP EG-2 (nice-to-have):** the 50-entry ring can age out over a long night; an `ownerSinceMs` field would be exact. |
| N3 | NOW "until / next" | `state.activeCue.untilMs` (program hold / window); else owning segment `toLocal` + next segment owner; `untilMs===null` on a program ⇒ "until you end it" |
| N4 | NEXT n rows | **[derived]** `liveOverview` days `todayIndex` (+ next day for cross-midnight) cues with `atLocal > now`, sorted; behavior tag from `cue.kind`, `trigger.type` (`sun` ⇒ SUN), `action.globals.master===0` ⇒ MASTER 0%, `durationMin` ⇒ length. (`state.cues[].nextInSec` is today-only and in-window-only — `timeline_service.js:2877-2897` — hence the overview join. **ENGINE GAP EG-3 (nice-to-have):** `nextCues[]` on state.) |
| N5 | Program countdown | `state.activeProgram.untilMs` − now |
| N6 | Sequence step line (baby) | `state.activeSequence` |
| N7 | Event log drawer | `state.recentFires` (fires + lifecycle) |
| P1 | Party ON/OFF | `GET /party-config → enabled` (mirror `state.partyEnabled`) |
| P2 | Eligibility window + open/closed | `state.phases.party_window {start,end}`; open = `state.currentPhase === 'party_window'` |
| P3 | IN SESSION + ends | `/party-config → effectiveState:'in_session'`, `sessionEndsAtMs`, `sessionFollowsMusic` |
| P4 | COOLDOWN m:ss | `effectiveState:'cooldown'`, `cooldownRemainingSec` |
| P5 | ARMED / NO PLAN / MANUAL | `effectiveState` (`timeline_service.js:1687-1693`) |
| P6 | SUPPRESSED (show holds deck) | **[derived]** `state.controller==='program'` while enabled. **ENGINE GAP EG-4 (nice-to-have):** explicit effectiveState. |
| P7 | Session numbers + playlist chips | `/party-config → minDwellSec, durationMin, durationEnabled, cooldownSec, cooldownEnabled, playlist, availablePlaylists, effective*` |
| C1 | Festival days, weekday, dates, sun | `GET /timeline/overview → days[] {index, date, weekday, sun}` |
| C2 | Phase bands / resolved ribbon | `days[].phases`, `days[].segments` (additive fields; absent ⇒ say so loudly, never draw empty — existing DayView rule) |
| C3 | Day cue list / blocks | `days[].cues {atLocal, label, kind, trigger, action, durationMin}` |
| C4 | Today/NOW playhead | **[derived]** plan-tz clock (`nowPartsInTz`, `timeline.tsx:126-148`) — today only |
| T1 | Travel preview | `GET /timeline/resolve?date&time` (full shape `timelineApi.ts:751-772`); 400 verbatim |
| T2 | Travel action / steps | `POST /timeline/travel {date,time} \| {cueId,date?} \| {step}` |
| T3 | Active travel state | `state.zoom {scope,targetLocal,targetDate,pendingDeferred}` |
| T4 | Resume | `POST /timeline/resume` |
| E1 | Draft/active identity, autosave | local draft + `TimelineDraftSaver` states; active from `state.activePlan` |
| E2 | Draft preview | `POST /timeline/overview` (400 = invalid, blocks save; transport error ≠ invalid — `timeline.tsx:493-536`) |
| E3 | Plans list / load / save / activate / delete | `/timeline/plans*`, `/timeline/plan/activate` |
| E4 | FIRE gating + blocked reason | **[derived]** cue id ∈ `liveOverview` ids; reason `save` vs `activate` (`timeline.tsx:1543-1556`) |
| M1 | Manual event buttons | **[derived]** active-plan overview cues with `trigger.type==='manual'`, deduped across days |
| X1 | Data age / STALE | **[derived]** client `receivedAt` stamp (EG-5 — client-side, add to `useTimeline`) |

**ENGINE GAP summary:** EG-1 resolvedOwner-on-state, EG-2 ownerSinceMs,
EG-3 nextCues[], EG-4 party 'suppressed_by_program' — all *nice-to-have*
additive fields; the design ships without any of them via the listed
derivations. EG-5/EG-6 are CaptainPad-side (receivedAt stamp; typing
`moodStale`/`planWarnings`/`partyEnabled`… into `TimelineState`). EG-7: there
is no per-cue plain-language description field — the design uses the cue
LABELS (which already carry "name — description" text in the night-arc plan)
and never invents copy.

## 6.9 Theme rules

- All five palettes (`light / dark / midnight / sunset / gruvbox`,
  `constants/theme.ts:78-298`) must render every view; the mock carries all
  five as CSS variable sets with a switcher.
- Day/night legibility: LIGHT is the sun theme; MIDNIGHT/SUNSET are the
  4 am themes. The A+ toggle raises timelineBody 16→19 and timelineCue 18→21
  (nothing else scales; layout must absorb it without clipping).
- Semantic mapping fixed across themes (tertiary=live, warning=caution,
  error=failure/off); state words always accompany color.
- Perform-green and travel-purple are cross-theme constants (match
  `ZoomBanner`), always paired with their words.

## 6.10 SINA DECIDES

- **SD-1 — zoom exit gesture.** (a) Drop the "returning to the Timeline tab
  exits the zoom" auto-resume (`timeline.tsx:1170-1172`) once TIME TRAVEL is
  a view here; exits = `RESUME LIVE` + banner `EXIT` only. (b) Keep the
  auto-exit; the TT view then only ever shows pre-travel selection and
  active travel lives on the deck tab. *Recommend (a) — the gesture predates
  a TT surface and would cancel a travel the operator came to inspect.*
- **SD-2 — calendar editing.** (a) `EDIT THIS DAY` jump to EDIT PLAN (as
  specced). (b) Inline add/edit on the calendar as today (docs/78's letter).
  *Recommend (a).*
- **SD-3 — manual events on LIVE.** (a) All manual cues of the active plan
  (incl. BABY REVEAL opening its protected flow). (b) Urgent-only (DUST
  STORM) with the rest staying on the Events tab. *Recommend (a) — one place
  at 3 am.*
- **SD-4 — timeline AUTO toggle.** (a) Header DETAILS drawer with verb
  labels. (b) Stays as a LIVE-view button. *Recommend (a).*
- **SD-5 — audio-stale alert rank.** (a) Ladder slot 5 as specced. (b)
  Elevate above the zoom slot whenever party is enabled. *Recommend (a).*
- **SD-6 — NEXT list depth.** 4 (specced) vs 6 vs full-night list.
- **SD-7 — view structure final confirmation.** 4-view (specced/recommended)
  vs Codex 3-view.
- **SD-8 — TIME TRAVEL HERE confirmation.** One-tap (specced; reversible) vs
  an opConfirm step.

## 6.11 Mock build contract (for the implementing agent)

Deliverable: **one standalone HTML file** (a design mock, not the app), plus
nothing else. Requirements — zero design decisions remain:

1. **Offline-absolute:** no network requests of any kind — no `@font-face`
   URLs, no CDNs, no images, no `file:///` paths, no telemetry. Fonts via
   stacks: headings `"Space Grotesk", ui-sans-serif, system-ui, sans-serif`
   (weight 700); body `"Inter", ui-sans-serif, system-ui, sans-serif`.
   State in a footer note that the app itself loads the real families
   locally.
2. **Shell context:** render the 112 px rail (groups LAYERS / TOOLS / SHOW /
   SYSTEM; Timeline active) as labeled *context only*, plus a top demo
   ribbon: "Interactive design mock — no engine connection; nothing saves or
   fires." Non-Timeline rail taps show a toast, never navigate.
3. **Views:** all four per §6.1-§6.5, interactive: view switching; header +
   one-alert slot with `DETAILS` disclosure; NOW/NEXT; party card with
   settings disclosure; manual events with confirm modals; calendar with day
   rail, chart + paired text list, block/lane taps opening a review sheet
   (cue mode with PERFORM shown only on the live occurrence, moment mode
   travel-only) whose `TIME TRAVEL HERE` lands in the TT view; TT view with
   day/time dial, live-updating resolved preview (from the demo dataset),
   active-travel state with `RESUME LIVE` and prev/next event steppers;
   EDIT PLAN with draft-identity strip, autosave chip cycling
   UNSAVED→SAVING…→✓ SAVED on edits (NO save button), cue editor form,
   FIRE-gating hint text, collapsed EVENT LOG.
4. **Demo dataset:** the night-arc cue set from the tracked
   `simulation/scenes/titanic/timeline/playa_default.yaml` (labels, times,
   playlists, palettes as authored; day labels `D1 · SUN` … `D9 · MON`
   style — no full calendar dates needed). Behavior tags per §6.8 N4.
5. **Demo-state switcher** (persistent bottom-right control, keyboard `1-9`
   too), scenarios with exact state:
   - **S1 NIGHT BLOCK** — clock 02:17; NOW = `Deep night 2 — UV Lasers`
     (`night_uv_lasers · ultraviolet`, since 01:10, until 02:30 → Quiet
     reset 2); party ON · window open · ARMED; alert slot empty.
   - **S2 PARTY COOLDOWN** — clock 02:37; NOW = `Quiet reset 2 — Electric
     Ice hush` (since 02:30, until 02:40 → Ember Hold); party ON · window
     open · `COOLDOWN 11:23`.
   - **S3 PARTY SESSION** — clock 23:52; NOW ownership chip `PARTY SESSION`,
     name `Party session` (`party_high · bass_drop`), ends 7:41; party pill
     `IN SESSION`.
   - **S4 DUST STORM** — NOW = `DUST STORM — high-visibility beacon`,
     chip `SHOW`, "holds until you end it", `END SHOW` present; CONTROL pill
     `SHOW RUNNING`; party line `SUPPRESSED — a show holds the deck`.
   - **S5 MORNING WATCH** — clock 07:30; NOW = `Morning Watch — steady
     reduced visibility` until 09:00 (countdown), NEXT first row `09:00 ·
     Day Off · MASTER 0%`; party `WINDOW CLOSED`.
   - **S6 ENGINE OFFLINE** — alert slot #1 with a live-counting age; every
     action disabled with reason; STALE chips on all data cards; party card
     `ENGINE OFFLINE`.
   - **S7 TIME TRAVEL ACTIVE** — travel zoom on D5 02:30; purple in-view
     banner + `RESUME LIVE`; TT tab badge; header alert slot #4.
   - **S8 AUDIO STALE** — S1 plus `AUDIO STALE 214s` pill and alert slot #5.
6. **Theme switcher:** all five palettes as CSS custom-property sets copied
   from `CaptainPad/constants/theme.ts:78-298` (background, text, surface*,
   primary/onPrimary, secondary, tertiary, warning*, error*, ghostBorder,
   borderStrong, sidebar*), plus the `A+` type toggle per §6.9. Default
   theme: dark.
7. **Floors enforced in CSS:** interactive elements `min-height: 48px`
   (56 px for END SHOW / TIME TRAVEL HERE / RESUME LIVE / party toggle;
   52 px manual events; 44 px absolute floor incl. calendar blocks via
   padding/pseudo-element hit areas). Type per §6.7 (1 pt ≈ 1 px here).
   Layout target 1180×820 landscape, must degrade to 1024×768 without
   horizontal scroll; wide internals scroll inside their own containers.
8. **Honesty rules in the mock:** no invented endpoints or buttons beyond
   this spec; confirm modals name consequences (copy in §6.3-§6.5); the
   travel preview visibly changes with the dial; the calendar NOW playhead
   renders only on the TODAY column.
9. **Do not** edit docs/78, any YAML/playlist, or any repo file — the mock
   is a new standalone HTML file only; the Opus stage folds it plus this
   spec into docs/78 afterwards.

---

*Cross-references: docs/78 (plan under review), docs/77 v2 (program),
reports `_338` (phase-aware default + END SHOW semantics this UI leans on),
`_341` §5/§5b (operator acceptance list the LIVE view must serve).*

---

# Addendum: Performance view + takeover gate + dev plan

Scope extension from the operator, same rules: design + spec only; the Opus
implementer builds from this with zero design decisions. Sections A1-A3,
then the mock-impact note and the separate perf-mock build contract.

## A1. PERFORMANCE — a mode, not a fifth tab

**Decision: PERFORMANCE is a MODE of the Timeline tab, driven by the
engine-global performance flag — not a fifth local view.** Rationale:

- Performance mode already exists ENGINE-side as the one authority
  (`api_server.js:1404-1468` — in-memory lock, boot-locked on auth-required
  engines, crash-resumed via the reserved `performance-preshow` snapshot
  `:1417-1418,1572-1577`; `GET/POST /performance-mode` `:14236,14248`).
  CaptainPad has no mode of its own — it renders the broadcast
  (`hooks/usePerformanceMode`). A fifth tab any finger could leave defeats
  the point; a mode that every pad renders identically cannot be wandered
  out of.
- **Today the Timeline tab is entirely UNREACHABLE during a show**:
  `timeline: showInPerformance: false` (`utils/captainpad_tab_policy.ts:34`)
  and `PerformanceRouteGuard` redirects it to Deck
  (`components/performance_route_guard.tsx:40`; the guard already wraps the
  screen, `timeline.tsx:257-263`). The operator's requirement is exactly the
  inverse: during a show you must be able to SEE the night. The change is:
  flip `timeline.showInPerformance` to `true`, and inside the tab render the
  read-only PERFORMANCE composition whenever `usePerformanceMode().active`
  is true and the pad is not passcode-unlocked (A2). The four-view chrome
  renders only when perf mode is off OR the pad holds a live unlock.

**Composition: its own layout, assembled from the same cards — not "LIVE
with holes".** LIVE gives ~38 % of the width to control cards (party
toggle, manual events); stripping controls would leave dead space where
glanceability should go. The PERFORMANCE composition is a single
full-width column, readable from a step back:

1. Persistent Timeline header, unchanged (section 6.2) — pills + the one-alert
   slot (ladder 6.2 verbatim, incl. OFFLINE with data age). A standing
   `PERFORMANCE — VIEW ONLY` chip (warning tokens, timelineMeta caps) sits
   at the right end of the pill cluster.
2. NOW hero — the 6.3 NOW card scaled up: name at timelineHero 40/44 (this
   composition only), ownership chip, playlist and palette, since/until/next
   line at timelineCue 21. **No action buttons render — including END
   SHOW and RESUME LIVE** (they are rig mutations; see A2 and SD-11).
3. NEXT strip — next four transitions as one horizontal row of cards
   (time timelineCue 21 tabular + label + tag). Rows are NON-interactive
   here (no review sheet: its PERFORM/TRAVEL actions are mutations, and a
   dead-end sheet with disabled buttons is worse than no sheet).
4. Status band — three equal read-only tiles: PARTY (state word +
   countdown + eligibility window line, 6.8 rows P1-P6), PHASE/ELIGIBILITY
   (`currentPhase`, window open/closed), AUDIO (mood + staleness).
5. Event-log ticker — last 3 `recentFires` rows (timelineBody), so a
   just-happened transition is explainable without unlocking.
6. Bottom-right: the ONE interactive element — `UNLOCK OPERATOR CONTROLS`
   (56 pt, `C.warning` outline; A2).

Stale/offline: identical honesty to 6.6 — OFFLINE alert with live age
counter, STALE chips per tile, nothing blanked, and the unlock button stays
enabled (unlock verification will itself fail loudly if the engine is truly
gone). Gloves/day-night: every datum at timelineBody 16 or larger; the
composition has exactly one touch target, 56 pt; all five themes + the A+
toggle apply.

Datum sources: rows H1-H6, N1-N7, P1-P6, X1 of section 6.8 apply unchanged,
plus:

| Datum | Source |
|---|---|
| Performance mode active | `GET /performance-mode` seed + control-bus broadcast (`hooks/usePerformanceMode`; engine `api_server.js:14236`) |
| VIEW-ONLY vs UNLOCKED chip | client unlock state (A2) — waiver principal + expiry from the mint response |

## A2. Password-gated takeover from the PERFORMANCE composition

**The auth primitive already exists engine-side; the design reuses it and
adds nothing secret to the repo.** Facts, cited:

- Credentials: three operator passphrases (owner / collaborator / bringup)
  loaded from the EXTERNAL secrets file named by `$BM26_SECRETS` — never in
  the repo; missing/short values throw at boot
  (`marsin_engine/lib/captainpad_auth.js:11-15,26-54`). Auth enablement is
  explicit via `$BM26_CAPTAINPAD_AUTH_REQUIRED` (`:70-76`).
- Verification is engine-side, per attempt, constant-time, with lockout:
  5 failures in 60 s locks that remote out for 60 s (`captainpad_auth.js:
  7-9,121-149`). `verifyPassphrase` deliberately issues nothing (`:161-165`);
  the 30-minute opaque **passcode waiver** is the remember option
  (`mintPasscodeWaiver` `:212-229`; routes
  `POST/GET /captainpad/auth/passcode-waiver`, `api_server.js:7483,7517`).
- The client half exists too: the per-attempt prompt + storage audit
  (`utils/takeover_passcode.ts:1-30` — raw passcodes never stored/logged;
  waivers as opaque tokens bound to the engine origin), header precedence
  (`utils/operator_auth.ts:21-36`), and the big-key keypad with 56 pt
  targets (`components/operator_passcode_keypad.tsx:16`).
- Engine restart: sessions AND waivers are in-memory (`captainpad_auth.js:
  57-63,81-83`) — a restart invalidates every unlock, while the performance
  LOCK itself resumes via the pre-show snapshot marker
  (`api_server.js:1417-1418,1572-1577`). Exactly the right failure posture:
  after a mid-show crash every pad comes back VIEW-ONLY.

**The flow (all achievable today):**

1. `UNLOCK OPERATOR CONTROLS` opens the existing passcode sheet: masked
   value, `OperatorPasscodeKeypad` (56 pt keys), `UNLOCK` / `CANCEL`
   (56 pt or larger), optional `Remember 30 min` row (existing
   `operator_passcode_remember_row.tsx`).
2. The pad verifies by minting a waiver — `POST
   /captainpad/auth/passcode-waiver` (engine-verified; no rig side effect).
   Success returns the principal + expiry; the pad enters UNLOCKED state:
   the header chip becomes `UNLOCKED — <PRINCIPAL> · mm:ss` (countdown to
   waiver expiry) with a `RE-LOCK` action (48 pt), and the Timeline renders
   the normal four-view chrome. The waiver token rides subsequent gated
   requests (`X-CaptainPad-Passcode-Waiver`).
3. Wrong passcode: engine 401, shown verbatim; 5th failure: 429 with
   `retryAfterMs` rendered as a visible lockout countdown on the sheet
   (never a silent dead button).
4. Expiry / engine restart / origin change invalidates the waiver — the pad
   drops back to VIEW-ONLY automatically and says why ("unlock expired —
   enter the passcode again"). Re-lock is also manual via the chip.
5. Auth-disabled engines (bench): the waiver route answers 503
   `PRIVILEGED_AUTH_DISABLED` (`captainpad_auth.js:122`) — the unlock
   degrades to an explicit `opConfirm` ("This bench engine has no operator
   passcodes — unlock controls?"), never a fake keypad. Boot-lock only arms
   on auth-required engines anyway (`api_server.js:1456-1458`).

**Where the enforcement honestly lives — stated plainly:**

- **Client-side (today, complete):** the VIEW-ONLY composition simply does
  not render mutating controls until the engine has verified a passcode
  (step 2 is engine-verified — the pad never compares secrets locally).
- **Engine-side (today, PARTIAL):** in performance mode the engine already
  refuses `POST /timeline/takeover` (`api_server.js:9507-9511`),
  `POST /special-events/arm` (`:9619-9625`), and Live Touch re-takeover
  (`:5740-5746`) without a fresh passcode/waiver. But these mutating
  timeline routes carry NO passcode gate in performance mode:
  `POST /timeline/plan/activate` (`:9469`), `/timeline/autopilot` (`:9479`),
  `/timeline/travel` (`:9521` — enters a scoped takeover WITHOUT the gate
  the plain takeover has), `/timeline/cues/:id/fire` (`:9594`),
  `/timeline/program/end|enable|dismiss` (`:9568-9593`),
  `POST/PUT/DELETE /timeline/plans*` (`:9406-9468`), and
  `PUT /party-config` (`:9331`). A stale pad or a curl can mutate the
  running show without any passcode. **ENGINE GAP EG-8 (required to make
  requirement 2 true rather than merely presented): while
  `performanceMode.active`, apply the existing passcode-or-waiver gate
  (`rejectTakeoverWithoutPasscode` / `verifyPrincipalPasscode`,
  `api_server.js:4397-4416,4438`) to the routes listed above.** Read-only
  routes (`/timeline/state|overview|plans GET|resolve`) stay open. Until
  EG-8 lands, the unlock chip copy must read "controls unlocked on this
  pad" — never "timeline unlocked".

## A3. Dev vs prod plans + run-up test plan

Plans are per-scene YAML files: the service lists/loads/saves them in the
scene's `timeline/` directory (`timeline_service.js:3343-3348,3362-3376`;
save validates first, throws on invalid, and hot-reloads if the saved name
IS the active plan). The prod plan is `playa_default` in the titanic scene
(foreign-owned, read-only to agents). A dev plan is therefore just another
plan file, selected/activated through the existing PLANS picker.

### (a) The dev-plan artifact

- **Name/home:** `dev_runup` — primary file
  `simulation/scenes/test_bench/timeline/dev_runup.yaml` (the bench stack is
  where run-up testing happens; `test_bench/timeline/` already holds bench
  plans). An identical copy MAY also live in the titanic scene for on-rig UI
  rehearsal (SD-12). A sibling assert-spec `dev_runup_spec.yaml` under
  `marsin_engine/tests/fixtures/timeline/` (pattern: the existing
  `assert_clean_spec.yaml`) makes this the first in-tree plan whose dry-run
  asserts all 8 classes — classes 2/4 currently loud-SKIP on every shipped
  plan (report `_338` addendum gates).
- **Structure** (`schemaVersion: 2`; multi-day `festival.days: 5`;
  `defaultCue: { phaseAware: true, action: {type: look, look: ambient} }`;
  one `party_window` phase, same shape as prod). Fictional cues, one per
  feature the UI spec uses — every playlist name MUST be picked from the
  target scene's EXISTING playlist library (the validator fails loud on a
  dangling name; never invent one):
  - `d_ignition` — sun sunset−30, program, `hold {min: 45}`, authors
    `globals.master` (ignition/master-writer analog), shuffle false.
  - `d_fastlane_1/2/3` — clock 17:00 / 17:12 / 17:24, ambient — a "demo
    hour" of 12-minute chapters so transitions can be WATCHED live without
    waiting all night.
  - `d_chapter_one` — clock 21:45, ambient, with `colorAutopilot` (block
    analog); `d_quiet_reset` — clock 23:00, ambient, sequential
    (`shuffle: false`); `d_chapter_two` — clock 23:10, ambient.
  - `d_carry` — clock 00:00, later day indices, cross-midnight carry analog.
  - `d_mood_party` — mood cue, `whenPhase: party_window`,
    `durationMin: 5`, short dwell/cooldown for bench testing.
  - `d_show_slot` — manual, program, `hold {min: 10}`, `sequence` action
    with 2 timed steps (event/sequence analog, `catchUp: false`).
  - `d_beacon` — manual, program, **no hold**, master writer (dust analog).
  - `d_bounded_party` — manual, program, `hold {min: 15}`,
    `durationMin: 15` (maxa analog).
  - `d_day3_special` — sun sunset+60, `days: [2]` (day-specific analog).
  - `d_morning_hold` — sun sunrise+30, program, hold until clock 09:30,
    `autopilot {active: false}` + pinned `entryId`, lower master
    (morning-watch analog).
  - `d_lights_out` — clock 09:30, master 0, hold until sunset−30
    (day-off analog; the spec's `masterZeroCue`).
- **The dates tension (public repo, P0):** a plan file requires
  `festival.startDate`. Ruling context: tracked show-plan YAML already
  carries festival dates (they are show content, not schedule planning) —
  but a run-up dev plan with real rehearsal dates would announce a
  rehearsal calendar. Spec: the TRACKED `dev_runup.yaml` carries a neutral
  startDate (reuse the already-public festival start scheme or any past
  date); the FIRST step of every test session is retargeting the start to
  "today" via the existing FestivalEditor DateWheel. That edit auto-saves
  into the tracked file — treat it exactly like the engine's other runtime
  residue in tracked files (AGENTS.md full-stack-smoke rule): report it,
  never commit it. Alternative: keep `dev_runup.yaml` untracked/gitignored
  (robocopy /MIR still ships it to the show server, which is fine for a dev
  plan). **SINA DECIDES SD-13.**

### (b) Making dev-vs-prod unmistakable in the UI

Client rules, no engine change needed:

1. **Name convention is the switch:** a plan whose name starts with `dev_`
   is a DEV plan. Presentation whenever the ACTIVE plan is dev, in all four
   views AND the performance composition: a full-width banner directly
   under the view tabs — `⚠ DEV PLAN — NOT THE SHOW PLAN` (timelineMeta
   caps, `C.warning` on `warningContainer` with `warningContainerBorder`,
   min-height 40 pt, never collapsible, not part of the one-alert slot —
   it is standing identity, not an alert). The header plan name gets a
   `DEV` tag; `PlanPickerSheet` rows show the same tag; EDIT PLAN's
   draft-identity strip repeats it.
2. **Belt on the show rig:** whenever `state.activePlan` is non-null and
   differs from the pinned prod plan name (`playa_default`), the info tier
   of the alert ladder (6.2 level 7) carries "Active plan is not the show
   plan". The prod name is a CaptainPad constant next to `PLAN_ACCENT`
   (`constants/identity.ts`) — SD-12 confirms the pinned name.
3. Optional first-class tagging — schema `meta.tier: dev|prod` on
   `ShowPlan` — is **ENGINE GAP EG-9 (nice-to-have)**; the convention
   suffices.

### (c) Run-up TEST PLAN (operator procedure, bench stack; agents never run it)

0. Preconditions: bench engine on the `test_bench` scene, CaptainPad
   pointed at the bench; prod titanic stack untouched throughout.
1. **Offline gate first:** from `marsin_engine/`, run `node
   tools/timeline_dryrun.mjs --plan
   ../simulation/scenes/test_bench/timeline/dev_runup.yaml --assert
   --assert-spec tests/fixtures/timeline/dev_runup_spec.yaml` — expect
   `ASSERT RESULT: PASS (0 violations)`, exit 0, all 8 classes asserted
   (no SKIP lines).
2. PLANS: load + ACTIVATE `dev_runup`. GOOD: DEV banner on every view,
   header tag, picker tag; the prod plan remains inactive.
3. EDIT PLAN: retarget festival start to today (DateWheel). GOOD: autosave
   chip walks UNSAVED, SAVING…, ✓ SAVED; the strip re-previews. Then
   make one INVALID edit (junk tz) — expect `⚠ FIX TO SAVE` + the engine's
   400 verbatim; fix it — SAVED again. (Do not commit the dated residue.)
4. LIVE during the 17:00 fast lane: watch two chapter transitions land at
   17:12/17:24. GOOD: NOW flips within a tick, NEXT re-ranks, event log
   grows, no flicker at the boundary (the `_338` A4 coalesce).
5. CALENDAR VIEW: step all 5 days; cue tap opens the review sheet (no rig
   movement); empty-lane tap opens the 15-minute-snapped moment review.
6. TIME TRAVEL: preview several instants incl. one OUTSIDE the festival
   window (expect the verbatim 400, no preview, button disabled with
   reason); `TIME TRAVEL HERE` to `d_chapter_two`; step prev/next events;
   verify the purple banner on Deck; `RESUME LIVE`. GOOD: catch-up returns
   the time-owning cue.
7. Events + resume: fire `d_beacon`, then END SHOW. GOOD: deck resumes into
   the chapter owning "now" (phaseAware), never the beacon again
   (`_338` A2). Fire `d_show_slot` — sequence step line counts 1/2 then
   2/2. Fire `d_bounded_party` — window elapses, displaced owner restored.
8. Party: ENABLE PARTY MODE, drive party audio at the bench companion.
   GOOD: session only inside the window; session countdown; DISABLE
   mid-session kills it immediately; cooldown countdown honest; nothing
   fires before the window opens.
9. Restart probe: mid-chapter, bounce the BENCH engine. GOOD: pad shows
   OFFLINE with age (never stale-as-live); on reconnect the same chapter
   owns the deck (catch-up), event log shows the lifecycle entries.
10. Performance composition (once A1/A2 land): enter perf mode on the
    bench (`POST /performance-mode`), verify VIEW-ONLY; unlock via keypad
    (or the bench confirm if auth is off); verify lockout after 5 bad
    tries; let the waiver expire and watch the auto re-lock.
11. File a dated report; `git status` confirms the foreign prod YAMLs are
    untouched.

## A4. Impact on the main (4-view) mock + perf-mock build contract

**Main mock:** two additive changes only — add demo state **S9 DEV PLAN**
(the A3(b) banner + tags over the S1 night state) and, in the header pill
cluster, a non-interactive `PERFORMANCE` chip visible only in the perf
mock's shared states (no other change; the four-view mock stays
edit-mode-only). Everything else in section 6.11 stands.

**Separate perf-view mock — build contract** (second standalone HTML file,
same rules as 6.11 items 1-2 and 6-8: fully offline, no URLs of any kind,
font stacks only, 5-theme switcher + A+ toggle, demo ribbon, rail as
labeled context):

1. Layout: the A1 composition exactly — header + alert slot, NOW hero
   (timelineHero 40), horizontal NEXT strip, three status tiles, event-log
   ticker, single `UNLOCK OPERATOR CONTROLS` button (56 pt).
2. Demo dataset: reuse the 6.11 night-arc dataset (S1/S2/S4/S5 states) —
   rendered read-only.
3. Interactive states (switcher + keyboard):
   - **P1 LOCKED** (default): view-only, `PERFORMANCE — VIEW ONLY` chip.
   - **P2 KEYPAD**: the unlock sheet — masked value, 56 pt keypad,
     Remember-30-min row, CANCEL/UNLOCK; a wrong-code path showing the
     verbatim 401 line; a 5th-failure path showing the 429 lockout with a
     live countdown.
   - **P3 UNLOCKED**: chip `UNLOCKED — OWNER · 29:41` counting down +
     `RE-LOCK`; the four-view tab chrome appears (LIVE view with 6.3
     controls enabled is sufficient — no need to duplicate all four views
     in this file).
   - **P4 ENGINE RESTART**: drops to LOCKED + the 6.6 offline alert with
     age counter; on "reconnect" shows "unlock expired — enter the passcode
     again".
   - **P5 BENCH (auth disabled)**: unlock opens an opConfirm-style dialog
     instead of the keypad, with the bench copy from A2 step 5.
   - **P6 DUST STORM read-only**: S4 data under LOCKED — proves an
     emergency is VISIBLE view-only, with the unlock path one tap away.
4. Honesty rules: no mutating control ever renders in LOCKED states; the
   keypad never shows a real passcode (mask only); all copy per A2.

## A5. New SINA DECIDES / ENGINE GAP items

- **SD-9 — unlock scope.** (a) Unlock reveals the full four-view Timeline.
  (b) Unlock reveals LIVE controls only; EDIT PLAN stays locked during
  performance mode (the engine already 409s structural writes in perf
  mode — `api_server.js:1410`). *Recommend (b), matching the engine's own
  perf-mode freeze; the A1/A2 text renders whichever is chosen.*
- **SD-10 — Remember default.** Remember-30-min pre-checked in the perf
  unlock sheet (fewer 3 am keypads) vs off (passcode every time, matching
  the takeover ruling's spirit). *Recommend off by default.*
- **SD-11 — emergency actions under VIEW-ONLY.** (a) Everything locked
  (specced — one unlock tap away). (b) END SHOW and/or DUST STORM
  reachable from the locked composition with confirm but no passcode.
  *Recommend (a); the keypad is fast and the ruling was "passcode every
  time".*
- **SD-12 — dev-plan placement + pinned prod name.** test_bench only vs
  both scenes; confirm `playa_default` as the pinned prod-plan constant.
- **SD-13 — dev-plan dating.** Tracked with a neutral startDate +
  retarget-to-today at session start, never committing the residue
  (recommended) vs an untracked/gitignored file.
- **ENGINE GAP EG-8 (required):** passcode/waiver-gate the remaining
  mutating timeline + party routes while performance mode is active
  (route list in A2).
- **ENGINE GAP EG-9 (nice-to-have):** `meta.tier` dev/prod tag on the
  show-plan schema; the `dev_` name convention suffices meanwhile.
- **CaptainPad follow-ups (not engine):** flip
  `timeline.showInPerformance` to true with the in-tab perf composition
  (A1); pin the prod-plan-name constant (A3b).
