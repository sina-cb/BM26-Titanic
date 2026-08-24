# 359 — Timeline calendar: working day vs calendar day, NOW/SUN bars (design)

Fable, design only. Nothing edited. Opus implements from §E; Sonnet verifies.
Inputs: `_357` (review), `_358` (handoff), `docs/78` §4, the live engine's
`GET /timeline/overview` (read-only) and the operator's two screenshots.

Vocabulary used below. **Wire day** `w` = the engine's festival day index
(calendar day in plan tz, `festival.js`). **Frame** = how the pad slices time:
`regular` (Day k = wire day k, 00:00→24:00) or `working` (Night k = wire day
k 18:00 → wire day k+1 18:00). `w` and `k` are both 0-based internally, shown
1-based ("NIGHT 1", "DAY 1"). The engine never learns about frames.

## A. Review of the calendar views as they are

Verified first: the live plan on the engine has its party phase at
`09:00 → 17:00` with the party cue on wire day 1 and its `pwe_` end cue on
wire day 2 (the operator re-authored a daytime test window since `_358`).
That single plan state explains both screenshots.

| id | sev | file:line | what is wrong | correct behaviour |
|---|---|---|---|---|
| C-01 | P0 | `night_calendar_logic.ts:96-106`, `DayView.tsx:193-196`, `DayOverviewStrip.tsx:435-438` | NOW is drawn only when now ≥ 18:00 on the card's date or < 18:00 on the next card's date. On festival day 0 before 18:00 (the screenshots) NOW is inside no working day, so it silently vanishes everywhere — while the `TODAY` badge (calendar `todayIndex`) still sits on card 1. | Working frame: an explicit line "NOW 2:14 PM · before NIGHT 1 opens at 6:00 PM" on the strip and the DAY header, badge `TONIGHT` (not `TODAY`) on the first night. Regular frame: NOW bar on Day 1 at 14:14. Never silent. |
| C-02 | P1 | `DayView.tsx:230-235,647`; strip `:52-76`; `calendar_legend.tsx:14-18` | Sunset (indigo, 3 px) and sunrise (amber, 3 px) lines carry no label; the strip adds golden-hour/civil-dusk 8×2 px ticks that are in no legend; legend says "☾ NIGHT" for the sunset colour and "☀ SUNRISE" in the same amber as PROGRAM cue blocks. | Named bars with gutter labels and one legend shared by strip and DAY (§D.2, §D.7). |
| C-03 | P1 | engine `timeline_service.js:202-206`; `DayView.tsx:240-256`; `DayOverviewStrip.tsx:52-53`, `night_calendar_logic.ts:216-262` | `phases[]` is emitted for every calendar day from plan-level phases; the pad draws a PARTY WINDOW band wherever a `pw_` phase exists. Cards D2–D4 show the purple band with "0 LIGHTING CUES" — the band is a lie on nights the party cue does not apply. | Party band only where the window's cue applies to the night it opens on (engine `partyWindowAt` semantics). Engine emits per-day `partyWindow` (§C.3); pad draws bands from it only. Also closes T-10 (no `pw_` name test). |
| C-04 | P1 | `DayOverviewStrip.tsx:279-290`, `DayView.tsx:524-528` | Card agenda prints "9:00 AM · Party 1" under "D1 · SUN" with no day tag; the cue is Monday 09:00 (morning half of Night 1). Reads as Sunday morning. DAY view says "NEXT DAY" but the header still says "DAY 1 · SUN". | Every row carries the weekday of its calendar date in the working frame ("MON 9:00 AM"); header names both days (§D.6). |
| C-05 | P1 | `party_window_logic.ts:88-98` (`partyWindowEndDays` always `+1`) | The "Default after Party Window" end cue is shifted one wire day unconditionally. For a non-wrapping window (09:00→17:00 on wire day 1) it lands on wire day 2 at 17:00 — visible in the live overview (`segments` day 2: `17:00-24:00 Default after Party Window`) and the deck is never handed back on day 1. | Shift only when `endMin <= startMin` (wraps midnight). Test in `party_window_logic.test.ts`. |
| C-06 | P1 | `cue_edit_logic.ts:67-77,104-142`; test `cue_edit_logic.test.ts:341` pins it | Only clock/manual triggers get the 18:00 roll-over; a **sun** cue authored "This day" on the Night k card keeps wire day k. "Sunrise −20 on Night 1" is stored on wire day 0 → fires on the morning BEFORE the first night. | Sun events split by half: `sunset, civilDusk, nauticalDusk, goldenHourStart` stay on k; `sunrise, civilDawn, nauticalDawn, goldenHourEnd, solarNoon` map to k+1 (working frame only). |
| C-07 | P1 | `CueEditorSheet.tsx:350-358,478`, `timeline.tsx:1905` (`dayIndex={selectedDay ?? 0}`) | The editor is opened with a bare `dayIndex`; it cannot tell the operator what "This day" means, and a day-0 morning cue (`wireDayToOperatorDay` → null) falls into `pick` with no explanation. The `?? 0` seeds day 0 silently. | Editor receives `{frame, index}`; title "ADD CUE · NIGHT 1 · SUN → MON"; DAYS control is frame-worded; fire-time preview line (§D.4). Opening with no selected day is a programming error → throw. |
| C-08 | P1 | `timeline_operator_model.ts:291-304,360-395,397-409` | `upcomingTimelineCues` labels rows by calendar weekday only; the TIME TRAVEL cue list and `timelineTravelResolveDateForOperatorTime` hard-code `18*60` (always working frame) while the day grid shows calendar dates with a calendar `TODAY` badge. The two halves of the view disagree, and the regular frame has no path. | Both take `frame`; grid labels and badge follow the frame (§D.5, §D.8). Keep T-07 (no fake today). |
| C-09 | P2 | `DayTimePicker.tsx:21-25,255-270`; `CueEditorSheet.tsx:839-846` | Picker is hard-wired to the 6 PM axis; the morning half shows "12 AM … 6 PM +1" with no weekday, no sun shading, no NOW. In the regular frame it would simply be wrong. | Axis per frame; weekday stamp on the midnight line; sunset/sunrise/NOW bars from the overview sun table passed in (§D.4). |
| C-10 | P2 | `EventSheet.tsx:170-171` (`day · <date>`), `timeline.tsx:1299-1332` | Sheet shows the calendar date only; a Night-1 morning cue reads "day · <Mon date>" under a sheet opened from "DAY 1 · SUN". | Line reads "NIGHT 1 · MON 2:00 AM" / "DAY 2 · MON 2:00 AM" per frame. |
| C-11 | P2 | `DayView.tsx:438-445,500-504` | Inert `SHIFT TONIGHT · —`; footer sentence about "midnight day-latch semantics" is engine jargon. | Remove both (T-19). Footer replaced by the frame sentence in §D.6. |
| C-12 | P2 | `timeline.tsx:2035-2040,2140-2145` | Strip mounted twice (CALENDAR, EDIT) with hand-copied props. | One `stripPropsFor(frame, …)` helper feeding one component — the two mounts cannot drift. |

Carried from `_357` unchanged: T-01/T-02 (P0, editor), T-08/T-13 (banner copy
— folded into §D.9), T-10 (closed by C-03), T-17 (travel seed), T-19 (C-11),
T-23 (overview parse — extend to the new fields).

## B. The model

Definitions (pure, pad-side; engine contract unchanged):

- `WORKING_DAY_START_MIN = 1080` (18:00). Festival `days = N`, wire days
  `0..N-1`, calendar dates `D_w = startDate + w`.
- **Regular frame**: span k = `[D_k 00:00, D_k 24:00)`, k ∈ `0..N-1`.
- **Working frame**: span k = `[D_k 18:00, D_{k+1} 18:00)`, k ∈ `0..N-1`.
  There is no Night −1 and no Night N. The last night's morning half lies on
  `D_N`, which is outside the festival span: it is drawn hatched "AFTER THE
  FESTIVAL — nothing can be scheduled here"; the engine cannot hold a cue
  there (`cueAppliesOn` → false), so the pad never invents one.
- **Instant → frame index**. For `(date = D_w, minute m)`:
  regular → `k = w`; working → `k = w` if `m ≥ 1080` else `k = w − 1`
  (null when `k < 0` — "before NIGHT 1 opens"; null when `w` is outside
  `0..N`, or `w = N` and `m ≥ 1080`).
- **Frame offset** (ribbon y): regular `m`; working `m − 1080` (evening
  half) or `1440 − 1080 + m` (morning half). 1440 minutes in both.
- **Authoring → wire**. Operator picks frame index k + local time t:
  regular → `w = k`; working → `w = k` if `t ≥ 18:00` else `k + 1`, error when
  `w > N − 1` ("rolls past the last festival night — pick an evening time or
  add a day"). Sun triggers use the event's half (C-06) instead of `t`.
- **Wire → frame** (display): use the engine's resolved `atLocal` on the
  cue's calendar day (sun cues included — never the event name) and the
  instant rule above. `days:'all'` cues appear in every span they resolve in.
- **Party window**: belongs to the night it OPENS on (engine rule,
  `party_window.js`). Engine tells the pad which calendar date a window opens
  on (`partyWindow`, §C.3); the pad then applies the instant rule to
  `opensLocal` to pick the frame index and draws the full `opens→closes`
  block, crossing midnight inside a working span or split across two regular
  days with a "continues from DAY k" tag on the second piece.
- **Now**: same instant rule; when the result is null the surfaces say so
  (C-01) — never a bar at a fabricated position.

Worked examples (festival Sun start, N = 4; weekday names only):

| case | working frame | regular frame | wire |
|---|---|---|---|
| add 02:00 on first card | NIGHT 1 → fires MON 2:00 AM (morning half) — preview line says so | DAY 1 → fires SUN 2:00 AM | `days:[1], at:'02:00'` vs `days:[0], at:'02:00'` |
| existing `days:[0], at:'02:00'` (Sun morning) | no Night 0: listed under NIGHT 1 as "BEFORE 6 PM · SUN 2:00 AM" (unplotted, existing lead-in list) | DAY 1, plotted at 02:00 | unchanged |
| add 20:00 on last card | NIGHT 4 → WED 8:00 PM | DAY 4 → WED 8:00 PM | `days:[3]` both |
| add 02:00 on last card | refused: "rolls past the last festival night" | DAY 4 → WED 2:00 AM (shows in working frame under NIGHT 3's morning half) | — / `days:[3]` |
| `days:'all', at:'23:30'` | every NIGHT 1–4 at 11:30 PM; summary "Every night · 11:30 PM" | every DAY 1–4 | unchanged |
| `days:'all', at:'02:00'` | NIGHT 1–3 morning halves (from wire days 1–3) + NIGHT 1 lead-in "SUN 2:00 AM"; NIGHT 4's morning half is outside the span, nothing drawn | DAY 1–4 at 2:00 AM | unchanged |
| sunset −30 on NIGHT 2 | wire 1, resolved MON 7:14 PM → NIGHT 2 | DAY 2 | `days:[1], sun:sunset,-30` |
| sunrise −20 on NIGHT 2 | wire 2 (morning event), resolved TUE 5:58 AM → NIGHT 2 morning half | DAY 3 | `days:[2], sun:sunrise,-20` |
| party 21:00→09:00 on NIGHT 1 | one band SUN 9 PM → MON 9 AM, cue row "SUN 9:00 PM" | DAY 1 band 21:00→24:00 + cue row; DAY 2 band 00:00→09:00 tagged "from DAY 1", no cue row | phase `{21:00,09:00}`, cue `days:[0]`, `pwb_ days:[0]`, `pwe_ at 09:00 days:[1]` |
| party 09:00→17:00 on NIGHT 1 (the live plan) | band + row "MON 9:00 AM → 5:00 PM" in NIGHT 1's morning half; NIGHT 2–4 show nothing (C-03) | DAY 2 band + row | cue `days:[1]`, `pwe_ at 17:00 days:[1]` (C-05 fix; today it is `[2]`) |

## C. Where the frame lives + module API

### C.1 Decision: pad-level preference, persisted on device

`hooks/use_day_frame.tsx` (new; mirrors `hooks/use-theme.tsx`): context
`{ frame: DayFrame; setFrame }`, AsyncStorage key `@CaptainPad:timelineDayFrame`,
hydrate on mount; a missing/unknown key is the documented default `working`
(the operator's stated mental model), not a fallback. Provider mounted in
`app/_layout.tsx` next to `ThemeProvider`. Justification: the frame is a view
transform over unchanged engine semantics; a plan-level field would require a
schema bump, validator changes and could make two pads disagree about the
same plan; a device preference is one tap, survives reload, and the editor
always stamps the frame in its title so nothing is authored blind.

### C.2 Pure module `components/timeline/day_frame_logic.ts` (type-only imports, like `zoom_logic.ts`)

```ts
export type DayFrame = 'working' | 'regular';
export const WORKING_DAY_START_MIN = 1080;
export interface FrameSpan { frame: DayFrame; index: number; startDate: string; endDate: string | null;
  startMin: number; durationMin: 1440; day: OverviewDay; nextDay: OverviewDay | null; /* null ⇒ morning half outside span */ }
export function frameSpan(frame, days: OverviewDay[], index): FrameSpan;            // throws on bad index
export function frameIndexForInstant(frame, days, date, minute): number | null;      // §B instant rule
export function frameOffset(span, date, minute): number | null;                      // y position, null outside
export function frameInstantAt(span, offset, snapMin=15): { date: string; time: string } | null; // tap → instant; null in the hatched tail
export function frameHourLabels(span): { offset: number; label: string; dateStamp?: string }[]; // every 3 h; dateStamp "MON" on the midnight line (working)
export function frameNowMarker(span, nowDate, nowMin): { offset: number; label: string } | null; // label "NOW 2:14 PM"
export function frameNowStatus(frame, days, nowDate, nowMin): { kind: 'inside'; index } | { kind: 'before-first'; opensLabel } | { kind: 'after-last' } | { kind: 'off-festival' };
export function frameSunMarkers(span): SunMarker[];   // {id:'sunset'|'civilDusk'|'sunrise'|'civilDawn', offset, label:'SUNSET 7:45 PM', date}
export function frameCueEntries(span): FrameCueEntry[];   // {cue, date, weekday, offset|null, endOffset|null, timing:'plotted'|'lead-in'|'manual'}; hides party implementation cues; uses atLocal only
export function framePartyBand(span): FramePartyBand | null; // from day.partyWindow / prev day's wrap piece: {fromOffset,toOffset,label,continuesFrom?:number}
export function framePhaseBands(span): FramePhaseEntry[];   // non-party phases only
export function frameRibbonEntries(span): FrameRibbonEntry[];
export function frameHeader(span): { title: string; subtitle: string; cardTitle: string };
export function frameDaysSummary(frame, days: CueDays, atHHMM: string|null, festivalDays): string; // "Every night" / "Night 1, Night 3" / "Day 2" / "Dates: …"
export function authoringToWire(frame, index, trigger: CueTrigger, festivalDays): { wireDays: number[] } | { error: string }; // C-06 sun halves
export function wireToFrameIndex(frame, wireDay, atLocalOrHalf): number | null;
export function frameTravelResolveDate(frame, days, index, time): string | null;
```

Working-frame bodies delegate to the existing `night_calendar_logic.ts`
functions (rename nothing yet; `nightAxisFor` stays); regular-frame bodies are
the 00:00 identity. `cue_edit_logic.ts` gains a `frame` parameter on
`operatorDayToWireDay / wireDayToOperatorDay / wireDaysForOperatorDay`
(regular = identity; working = today's rule + sun halves). `timeline_operator_model.ts`
functions that hard-code `18*60` call `day_frame_logic` instead.

### C.3 Engine additions to `/timeline/overview` (additive, `buildOverview`, `timeline_service.js:121-220`)

Per `days[i]`:
- `partyWindow: { phaseId, cueId, opensLocal, closesLocal, wraps: boolean } | null` —
  the party cue's window that OPENS on this calendar date, present only when
  `cueAppliesOn(cue, plan, opensMs)` (reuse `phaseWindowAt` from
  `party_window.js` at this day's noon; `wraps = endMs < startMs`). Non-clock
  anchors resolve against this day's sun events. This is the one honest
  source for party bands (C-03, T-10); the pad stops inferring from `phases`.
- `sun.civilDawn` — add `'civilDawn'` to `OVERVIEW_SUN_EVENTS` (already
  computed by `sun.js`).
- `nextSun: { sunrise, civilDawn } | null` — the same two events for
  `date + 1`, on EVERY day (the last working night has no next overview day
  yet has a real sunrise). Never a synthetic extra day entry.

Pad parser (`timelineApi.ts` ~815, T-23): accept absent fields (old engine),
fail loud on wrong types — the `_358` strict-parse discipline.

## D. UI spec per surface (dark look, `.agent/os/ui_design.md`: tokens, AA contrast, compact)

### D.1 Frame toggle
`timeline_operator_shell.tsx`, right-aligned under the mode tabs, `Segmented`
(the `makerControls.tsx` one), 44 pt: `WORKING DAY · 6 PM → 6 PM` |
`CALENDAR DAY · 12 AM → 12 AM`. Visible on all four views (LIVE NEXT uses it).
Persisted (C.1). Nothing else changes on toggle except rendering.

### D.2 Bars, gutter, legend (DAY chart and strip column share the rules)
- Chart gets an explicit **left gutter** of 84 px (DAY) / 64 px (strip); hour
  labels right-aligned inside it; bands/blocks start after it.
- **NOW**: 2 px solid `C.error` across gutter + chart, z-top; gutter pill
  (red bg, white `SpaceGrotesk_700Bold` 11/9 pt) `NOW 2:14 PM`. Only when
  `frameNowMarker` is non-null. Otherwise the header line from C-01.
- **SUNSET** `#5b6cf5`, **SUNRISE** `#ffd166`, **DUSK/DAWN** (civil) same
  hues at 55 % alpha: 2 px dashed (`borderTopWidth:2, borderStyle:'dashed'`)
  across the chart, under cue blocks, over phase bands; gutter text in the
  bar colour: `SUNSET 7:45 PM`, `DUSK 8:14 PM`, `SUNRISE 6:17 AM`,
  `DAWN 5:49 AM`. Strip: same, 9 pt, `SUNSET 7:45P` if it clips at 64 px.
  Golden-hour ticks removed (not asked, not in legend).
- **Collision rule**: a marker label owns ±14 px of gutter; an hour label
  inside that band is hidden; two marker labels within 14 px stack (second one
  +16 px, 1 px leader line). NOW always wins the slot.
- **Legend** (`calendar_legend.tsx`, single source, used by strip and DAY):
  `— NOW` red · `- - SUNSET` · `- - SUNRISE` · `- - DUSK / DAWN` ·
  `▮ PARTY WINDOW` purple · `● PROGRAM` amber · `● MOOD` cyan · `● AMBIENT`.

### D.3 Week strip (one component, both mounts — C-12)
Card title `N1 · SUN → MON` (working) / `D1 · SUN` (regular). Badge:
`● TODAY` only on the card whose span contains now; `TONIGHT · opens 6:00 PM`
on the first night while `frameNowStatus.kind === 'before-first'`; nothing
otherwise. Column: bars per D.2, party band from `framePartyBand` only, cue
blocks as today. Agenda rows: `MON 9:00 AM · Party 1` (weekday always shown in
the working frame, omitted in regular). Count line counts plotted + lead-in
cues; a card with a band and no cue cannot exist after C-03. Strip header line
(above the legend) shows the C-01 sentence when NOW is outside every span.

### D.4 Cue editor (add + edit)
- Props: `frame`, `frameIndex` (required; throw if absent), `sunByDate`
  (from the overview, for the picker bars). Title `ADD CUE · NIGHT 1 · SUN → MON`.
- DAYS control wording per frame: `This night | Every night | Pick nights…`
  (`N1…N4` pills) / `This day | All days | Pick days…` (`D1…D4`). Pills map
  through `authoringToWire`; a pick that would roll past the span is disabled
  with the reason in the hint.
- **Fire preview line** under the trigger block, always: clock → `Fires MON
  2:00 AM (morning half of NIGHT 1)`; sun → `Fires ~TUE 5:58 AM (sunrise −20)`
  using `sunByDate`; party → `Window MON 9:00 AM → 5:00 PM · detection armed inside it`.
  If `sunByDate` lacks the date for a sun cue in the working frame: save is
  blocked with "Sun times for this night are not loaded — reconnect" (no guess).
- `DayTimePicker`: axis from `frameHourLabels` (weekday stamp on the midnight
  line), sunset/sunrise dashed bars, NOW bar when inside the span, hatched tail
  on the last night. Tap in the tail → no-op with the hint line.
- Party mode: start/length unchanged; `planWithPartyWindow` end-day fix (C-05).
  T-01/T-02 remain prerequisites before editing the real plan.

### D.5 TIME TRAVEL
Day grid labels = `frameHeader(span).cardTitle`; badge per D.3; cue list from
`frameCueEntries` (rows `MON 2:00 AM`); `ADVANCED` time resolves through
`frameTravelResolveDate`; seed the time from `nowInTz` (T-17). Copy line:
"Times are plan-local. In the working-day frame, times before 6 PM fall on
the next morning."

### D.6 DAY view
Header: working `NIGHT 1 · SUN → MON` + `Sun 6:00 PM → Mon 6:00 PM · festival
day 1 of 4`; regular `DAY 1 · SUN` + `Sun 12:00 AM → 12:00 AM`. Last night adds
`after MON 12:00 AM is past the festival — nothing can be scheduled there` and
the chart tail is hatched. Remove SHIFT TONIGHT and the day-latch footer
(C-11); replace with one sentence: "Working day: each night runs 6 PM to 6 PM
the next day. Switch to CALENDAR DAY to see midnight-to-midnight." (and the
mirror sentence in the other frame). Hour ruler `6 PM … 12 AM (MON) … 6 PM`;
regular `12 AM … 12 PM … 12 AM`. EVENTS list rows: `MON 2:00 AM` + tag
`MORNING HALF` / `TONIGHT` / `BEFORE 6 PM` (lead-in) / `ON DEMAND`; a
`days:'all'` cue shows `every night` in its meta. ＋ CUE passes `{frame, index}`.

### D.7 LIVE NEXT list
`upcomingTimelineCues(overview, frame, nowDate, nowLocal)`: rows labelled
`TONIGHT 11:30 PM`, `MON 2:00 AM` (same night), `TOMORROW NIGHT 7:14 PM`
(working) / `TODAY`, `MON` (regular). Outside the festival: T-07 behaviour.

### D.8 Event sheet
Context line `NIGHT 1 · MON 2:00 AM` / `DAY 2 · MON 2:00 AM` (C-10) plus
`frameDaysSummary` ("Every night").

### D.9 Banner copy (T-08, T-13)
`timeline_alert_model.ts`: `saveError` ranks above `activePlanHotReload`.
Hot-reload alert: title `EDITING THE LIVE PLAN`, detail `Every valid change is
saved and applied to the ship immediately.` EDIT PLAN header helper when
`draft.name === activePlan`: `EDITING THE LIVE SHOW — saves apply immediately.`;
otherwise `Editing a saved copy. Activate it from PLANS to run it.`

## E. Implementation slices (in order)

| # | pri | scope | files | tests | live check (read-only; operator stack on :6967/:6968 — verify on a fresh `serve dist` :7167, never touch the operator's Expo) |
|---|---|---|---|---|---|
| S0 | P0 | Engine overview additions (C.3) | `marsin_engine/lib/timeline/timeline_service.js` (`buildOverview`, `OVERVIEW_SUN_EVENTS`), reuse `party_window.js` | `node --test "tests/timeline/*.test.js"`: `timeline_festival.test.js` + new cases: `partyWindow` only on applying days; `wraps` true for 21:00→09:00; `nextSun` present on the last day; `civilDawn` present | `curl :6968/timeline/overview` → day with the party cue has `partyWindow`, others `null`; `nextSun` on every day |
| S1 | P0 | Pure frame model + preference | new `components/timeline/day_frame_logic.ts`, `day_frame_logic.test.ts`, `hooks/use_day_frame.tsx`; `cue_edit_logic.ts` frame param + sun halves (C-06); `party_window_logic.ts` end-day fix (C-05); `timelineApi.ts` parser (T-23) | vitest: every §B row as a case; `frameNowStatus` four kinds; `authoringToWire` last-night refusal; `wireToFrameIndex` null for day-0 morning; `cue_edit_logic.test.ts:341` flips to the half rule; `party_window_logic.test.ts` non-wrap end cue stays on the same day | `npx tsc --noEmit`, `npm run lint` |
| S2 | P0 | Strip + DAY view on the frame model, bars, legend, toggle | `DayOverviewStrip.tsx`, `DayView.tsx`, `calendar_legend.tsx`, `timeline_operator_shell.tsx`, `timeline.tsx` (`stripPropsFor`, both mounts, ＋ CUE seed), remove SHIFT TONIGHT | vitest on the model only; `timeline_operator_ui_contract.test.ts` pins legend items = marker ids | Puppeteer (mute console per memory technique) screenshots at 1280×900, both frames, CALENDAR week + DAY and EDIT week + DAY: NOW pill and bar on the right card/position (or the C-01 sentence before 18:00), SUNSET/SUNRISE labelled, no band on nights without the cue, agenda rows with weekday |
| S3 | P1 | Cue editor + picker + event sheet (D.4, D.8) | `CueEditorSheet.tsx`, `DayTimePicker.tsx`, `EventSheet.tsx`, `timeline.tsx` (`sunByDate`, `{frame,index}` props) | vitest: preview-line text for the §B rows (pure helper `cueFirePreview` in `day_frame_logic.ts`); refusal without sun table | In EDIT on a COPY of the plan (T-01/T-02 still open): add 02:00 on NIGHT 1 → YAML shows `days:[1]`; switch frame, the same cue sits under DAY 2; add a party window, confirm `pwe_` day |
| S4 | P1 | LIVE NEXT + TIME TRAVEL (D.5, D.7) | `timeline_operator_model.ts`, `timeline_travel_view.tsx`, `timeline_live_view.tsx`, `timeline.tsx` | `timeline_operator_model.test.ts`: NEXT labels per frame, travel resolve date per frame, T-07 outside span | Screenshot LIVE NEXT in both frames; travel ADVANCED 02:00 on NIGHT 1 resolves to the Monday date (`GET /timeline/resolve` echo) |
| S5 | P1 | Banner copy + alert order (D.9) | `timeline_alert_model.ts`, `timeline.tsx` header | `timeline_alert_model.test.ts`: save error outranks hot-reload; new titles | Screenshot EDIT header on the active plan |
| S6 | P2 | Docs | `docs/78` §4 addendum (frames, bars, legend); `.agent/ops/timeline_e2e_tests.md` AUTO scenario "frame toggle" | — | — |

Gates before "merge-ready": CaptainPad `npx tsc --noEmit`, `npm run lint`,
`npx vitest run`, `npm run web:build`; engine `node --test "tests/timeline/*.test.js"`
and the full suite; report runtime residue in `marsin_engine/states/**`, never
commit it. No git operations unless asked.

## F. Risks / what NOT to change

- Engine `days` semantics (`festival.js`), `cueAppliesOn`, the resolver's
  calendar-day ribbon and `party_window.js` night-start rule stay exactly as
  they are; the pad only adds a view transform and consumes new additive fields.
- Do not add a plan-level frame field or any engine notion of "night index".
- Do not fabricate Night 0 / Night N, a sunrise for a missing day, or a NOW
  position outside a span; every null path has a sentence.
- Do not touch T-01/T-02 behaviour in this wave except where S3 depends on the
  end-day fix; editing the real plan from the pad remains blocked until they land.
- The 18:00 boundary is a constant in one module; no second copy (C-07 removes
  `timeline.tsx`'s `?? 0` and the `18*60` literals in `timeline_operator_model.ts`).
- Colour choices are fixed hexes for structural markers (as today's bands);
  keep NOW on `C.error` so it re-themes with the palette.
