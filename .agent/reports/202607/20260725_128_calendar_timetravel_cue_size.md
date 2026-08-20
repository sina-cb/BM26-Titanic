# `_128` — Calendar time-travel entry · cue `size` removed · HOLD out of the cue UI

**Operator tasks (2026-08-03):** (1) make the day calendar itself a TIME
TRAVEL entry point; (2) remove `size` from cue globals (verify engine-side
first); (3) keep the two duration-ish sections distinguishable — superseded
mid-flight by the ruling **"remove hold from the cue UI to avoid confusion,
but keep it for the party"**.

DEVELOPER thread on `feat/bm_readiness`. No git operations. The operator's
`:6967` Expo untouched — all live proof on a fresh `:7167` dist.

## 0. Headline

| Gate | Result |
|---|---|
| `tsc --noEmit` | **clean** |
| CaptainPad vitest | **931 pass / 6 skipped, 0 fail** (baseline 914/6 → **+17 new**, zero new failures) |
| Engine timeline tests | **431/431 pass** (`tests/timeline/*.test.js`; engine changes are comment-only) |
| Calendar cue-block tap → EVENT sheet | PASS — shot `03` |
| Calendar EMPTY-time tap → MOMENT sheet | PASS — shot `04` (12:00 PM · "open time … no cue here" · resolver peek) |
| MOMENT travel → purple TIME TRAVELING banner | PASS — shot `05` (`2026-08-30 · 12:00 · Ambient program · viewing the plan, not tonight`) |
| D1 exit (return to TIMELINE tab) | PASS — engine `zoom: null` confirmed via REST after the tab return |
| Cue editor: no SIZE slider, no HOLD section | PASS — shot `10` (GLOBALS = SPEED + SYNC only; OVERLAYS → DURATION → DAYS with nothing between) + body-text assertion (`SIZE`/`HOLD` labels absent) |
| **Engine verdict on cue `globals.size`** | **No size-specific engine plumbing exists** — safe removal, not the STOP case (§2.1) |

## 1. Task 1 — the calendar is now a zoom entry point

### 1.1 What landed

The DAY view's 24 h chart (`DayView.tsx` → `DayChart`) now takes taps:

- **Cue BLOCKS and point MARKERS are touchables.** Tapping one opens the
  SAME `EventSheet` the agenda rows open — the engine's own state picks the
  branch (PERFORM if it is the live deck owner today, TIME TRAVEL otherwise).
  Zero new semantics: one sheet, one primary action, unchanged.
- **EMPTY calendar time is a MOMENT.** Tapping between cues opens the
  EventSheet in a new **MOMENT mode** (`cue:null, moment:{date,time}`): a
  purple header ("12:00 PM · open time on 2026-08-30 — no cue here"), the
  read-only resolver peek for that bare instant (who would own the deck —
  default cue, still-holding cue, or baseline), and ONE action: TIME TRAVEL
  HERE. No PERFORM (a bare instant is not a cue), no EDIT (nothing to edit).

**DECISION — empty-slot tap: IMPLEMENTED.** The brief asked to build it only
if arbitrary-timestamp snapshots were already supported cleanly. They are:
`POST /timeline/travel {date, time}` and `GET /timeline/resolve?date&time`
have existed since the `_94`/`_97` slices (the travel steppers ride the same
surface). Zero new engine code was needed — this thread's engine diff is two
comments.

### 1.2 Zoom semantics — all preserved

- **Browse safety:** a calendar tap only OPENS A SHEET (plus the zero-side-
  effect resolver peek). The rig moves only on the sheet's explicit button.
- **D3 (cue deferral), D4 (static snapshot):** untouched — MOMENT travel goes
  through the identical `travel()` action / engine path as cue travel.
- **D1 exit:** verified live — after traveling from a bare moment, returning
  to the TIMELINE tab resumed the plan (`zoom: null` on `/timeline/state`).
- **Snap honesty:** taps snap to a 15-min grid (`TRAVEL_TAP_SNAP_MIN`) —
  at ~30 px/hour a finger is worth ±5 min, so 15 is the honest resolution. A
  snap landing on 24:00 pulls back one notch ("24:00" is the ribbon's
  terminator, never a target). Unreadable tap geometry maps to **null and
  opens nothing** — never a guessed time.

### 1.3 One web-platform landmine (documented for the next thread)

RN-web only normalizes `locationX/locationY` for RESPONDER events. A
`Pressable`'s press event carries none on web — the first cut silently
mapped every tap to null on the dist build. The fix is the established
DayTimePicker idiom: a `PanResponder` on an absolute-fill underlay (created
once, handler read through a ref), with every decorative layer
(`daylight`/hour grid/phase bands/NOW) `pointerEvents:"none"` so the grant's
`locationY` is chart-relative. Blocks/markers render above the underlay and
win their own taps; a drag > 8 px is not a tap and opens nothing.

## 2. Task 2 — cue-level `size` removed

### 2.1 The engine-side verdict (checked FIRST, as briefed)

**There is no size-specific engine plumbing.** A cue's `globals` is a fully
GENERIC CPC map end-to-end:

- `show_plan.js` `validateGlobalsMap` accepts any key (Number or {h,s,v});
- `timeline_service.js` `_writeGlobals` splits out only `master` (→
  `setMaster`) and passes every other key verbatim to `deps.setParams`;
- nothing anywhere in `marsin_engine/lib/timeline/` reads, defaults, or
  branches on a `size` key (grep: zero hits beyond an unrelated comment).

So a cue-authored `size` was only ever applied because the editor seeded it —
exactly the "unused in cues" the operator ruled. **Not the STOP case**: the
removal is UI-side only, and there was no dead engine plumbing to delete
(the generic map serves speed/bpmSpeedSync/master and stays available to
hand-authored plans). The **deck-level** size global is a separate, real
control and is untouched. Engine diff: two comments updated to stop naming
SIZE as a maker-authored key.

### 2.2 What landed

- `CueEditorSheet.tsx`: SIZE slider deleted; the GLOBALS card ON-seed is now
  `{speed:0.5, bpmSpeedSync:0}`; card copy reads speed + sync only.
- **Accept-and-ignore, never re-emit** (`cue_edit_logic.stripCueSizeGlobal`,
  new pure module): a legacy `globals.size` is shed when a cue/default-cue
  loads into the editor AND on every emit path (defense in depth in
  `buildNormalizedAction`). A globals map whose only key was `size` is
  dropped whole. Pinned by tests, including "does not mutate its input".
- `utils/timelineApi.ts`: `size?` stays in the wire type (old plans must
  read in cleanly) with a LEGACY comment.
- **Plan YAML sweep:** `simulation/scenes/titanic/timeline/playa_default.yaml`
  carries no cue `size` — nothing to clean.

## 3. Task 3 → operator ruling — HOLD is out of the cue UI

The original ask (clarify DURATION vs HOLD hints) was superseded mid-flight:
**"remove hold from the cue UI to avoid confusion, but keep it for the
party."** Landed exactly that way:

- **UI:** the whole HOLD section (None/Minutes segmented + stepper) and its
  `holdMin` state are gone from `CueEditorSheet`. DURATION keeps its
  existing one-line hint ("This cue owns the deck for N min after it fires;
  the default cue fills the gaps") — with HOLD gone there is no second
  duration to confuse it with.
- **Engine:** fully intact — `cue.hold` schema validation, resolve/arbiter
  hold behavior, and every plan YAML hold value are untouched.
- **Round-trip pin (tested):** cue assembly moved into the pure
  `cue_edit_logic.assembleCue`, which spreads the ORIGINAL cue first and
  never touches `hold`. Tests pin: an existing `{min:90}` hold survives an
  edit byte-identical; the `{until:…}` anchor form survives; unmanaged keys
  (`enabled`, `catchUp`) survive; a NEW cue emits no hold (engine semantics:
  holds until the next program).

## 4. Files touched

**CaptainPad**
- `components/timeline/zoom_logic.ts` — `chartTapToLocal` + `TRAVEL_TAP_SNAP_MIN`
- `components/timeline/zoom_logic.test.ts` — +5 tests (snap, clamp, 24:00 pull-back, null-on-bad-geometry, round-trip)
- `components/timeline/cue_edit_logic.ts` — NEW pure module: `stripCueSizeGlobal`, `assembleCue`
- `components/timeline/cue_edit_logic.test.ts` — NEW, +12 tests (size shed, hold round-trip, unmanaged-key survival)
- `components/timeline/DayView.tsx` — tappable blocks/markers, PanResponder moment underlay, header copy
- `components/timeline/EventSheet.tsx` — MOMENT mode (nullable `cue`, `moment` prop, fail-loud on neither)
- `components/timeline/CueEditorSheet.tsx` — SIZE slider + HOLD section removed; seeds/emits via the pure module
- `app/(tabs)/timeline.tsx` — `eventMoment` state, `openMoment`, travel spec branch, sheet mount
- `utils/timelineApi.ts` — LEGACY comment on `globals.size`

**marsin_engine** (comments only — behavior byte-identical, 431/431 timeline tests green)
- `lib/timeline/show_plan.js`, `lib/timeline/timeline_service.js`

## 5. Live proof — method + evidence

Per `.agent/memory/captainpad-screenshot-technique.md`: console muted via
`evaluateOnNewDocument` before boot, ONE tab, fresh `npm run web:build` dist
served on **:7167**, against a real engine on :6968 (titanic scene,
`playa_default` armed-dormant — the rehearsal case, which is exactly when
empty-slot travel matters). Harness + PNGs gitignored under
`~/tmp/bm26_s128_calendar_tt/`:

- `01_festival` / `02_day_view` — the ladder renders on the fresh dist (new
  header: "PLANNED · TAP A BLOCK OR AN EMPTY TIME TO ZOOM").
- `03_block_tap_event_sheet` — calendar block tap → full EVENT sheet
  (resolver peek: "the cue owns the deck").
- `04_empty_tap_moment_sheet` — noon tap → MOMENT sheet, resolver answer
  "ambient · deep_sea · owner Ambient program (defaultCue) · gap — the plan
  default cue".
- `05_time_traveling_banner` — deck tab under the purple banner with
  steppers + EXIT; deck actually carrying the resolved ambient playlist.
- `06_back_on_timeline` — D1 tab-return; REST confirms `zoom: null`.
- `10_globals_card_no_size` / `11_duration_to_days_no_hold` — GLOBALS =
  SPEED + SPEED SYNC only; OVERLAYS → DURATION → DAYS with no HOLD between;
  page-text assertion: no `SIZE`, no `HOLD` label anywhere in the sheet.

## 6. Hygiene / residue

- Engine runtime-state writes into tracked `marsin_engine/states/**` are the
  documented full-stack-smoke residue — reported, not committed, not
  reverted (most were already modified before this thread).
- A mid-thread Claude Code restart killed the :7167 dist server and the
  engine; both were relaunched for verification and **shut down at thread
  end** (the operator's :6967 was never touched).
- No temp files in the source tree; harness in `~/tmp` (gitignored). No
  future dates. No git operations.

## 7. Follow-ups

- The week-strip (FESTIVAL) cards already navigate to the DAY level, so the
  calendar entry chain is tap-day → tap-anything. If the operator ever wants
  time travel directly off the WEEK strip's mini-columns, that is a new,
  separate affordance (the mini-columns are ~34 px wide — probably too small
  to tap honestly).
- `_97`'s note stands: re-shoot the ribbon captures against a post-`_98`
  engine when convenient.
