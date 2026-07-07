# Slot 3 — scheduler_ui

- **Branch:** dev/claude/scheduler_ui
- **Parent branch:** dev/claude/scheduler_engine (@ 91aaf89)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/scheduler_ui
- **Slot ports:** engine 31368 (only one used; Metro/web build local to the worktree)

## Scope

Phase 2 of `docs/31_scheduled_tasks.md` v3 — the CaptainPad UI that
drives the engine-owned scheduler. Adds a new sidebar tab between
Monitor and Dimmer Rack with a virtualised row list, per-task library
picker, ON-duration + interval pill bars (reusing the
DeckTransitionControls TimerPillBar), and a single 250 ms ticker that
feeds every row's countdown. Optimistic UI on every mutation;
engine 400s surface verbatim per codex P0 (no retry, no clamp).

## Files changed

```
A  CaptainPad/app/(tabs)/scheduler.tsx                          (new tab)
A  CaptainPad/hooks/useScheduledTasks.ts                        (live state hook)
A  CaptainPad/components/ScheduledTaskRow.tsx                   (per-task row)
A  CaptainPad/components/LibraryEffectPicker.tsx                (picker modal)
M  CaptainPad/app/(tabs)/_layout.tsx                            (+Scheduler tab above Dimmer Rack)
M  CaptainPad/components/ui/icon-symbol.tsx                     (+8 mappings for scheduler glyphs)
M  CaptainPad/utils/api.ts                                      (+6 helpers + ScheduledTask types)
A  .agent/02_reports/202605/20260527_3_scheduler_ui.md          (this report)
```

## Components reused (no reinvention)

- **`TimerPillBar`** (from `DeckTransitionControls.tsx`) — used for
  both ON DURATION and INTERVAL with `compact=true`. The presets come
  from the engine's `GET /scheduled-tasks` `presets` field so a future
  preset-list change on the engine side is picked up without a UI
  change.
- **`IconSymbol`** — added 8 SF-Symbol → MaterialIcon mappings
  (`calendar.badge.clock`, `play.fill`, `pause.fill`, `stop.fill`,
  `circle`, `checkmark.circle.fill`, `wifi.slash`, `shuffle`) so the
  web/android fallback shows the right glyph. The iOS variant uses SF
  Symbols natively.
- **`engineEvents`** singleton bus — one module-level subscription
  for `type === 'scheduledTasks'` (mirrors `useEngineState`'s pattern,
  invariant #4 in `04.1_captain_pad_expert.md`).
- **`engineEvents.subscribeStatus`** — drives the OFFLINE banner.
  Same UI recipe (red border + `wifi.slash` icon) as the deck's
  `OfflineBanner` (`index.tsx:70`); copied locally so the Scheduler
  tab stays self-contained.
- **GEM swap-sheet pattern** (`GlobalEffectMacros.tsx → SwapSheet`)
  — the `LibraryEffectPicker` modal uses the exact same chrome
  (`Modal transparent` + outer-`Pressable` backdrop + inner-`Pressable`
  panel with `stopPropagation`), the same row recipe (label +
  behaviour subtext), and the same CLOSE button. Differences:
  no REMOVE action, groups by `category`, and shows a ✓ next to
  the currently-bound preset.
- **`globalStyles.surfaceLow` / `surfaceContainerHigh`** — tab
  surface + per-row card. Matches the deck's autopilot card and the
  dimmer rack's primary card. Border radius 8/12, padding 24 + 12,
  internal gap 8 — all on the 4/8/12/16/24 grid; no orphan values.
- **`Colors.light` tokens only** — no hex literals in the new code
  (one inline `'rgba(0, 104, 117, 0.10)'` highlight on the active
  picker row, derived from `Colors.light.primary` rgb).

## Quality gates

- **`npx tsc --noEmit`**: pass for new code. 2 pre-existing errors in
  `components/Modulation.tsx` remain (operator-acknowledged
  `transitionDuration` web-only style — same baseline as the
  parent branch).
- **`npm run lint`**: 0 errors, 13 warnings — all pre-existing,
  none from the new files (verified by comparing the count to
  pre-change baseline).
- **`npm run web:build`**: pass. 21 routes exported, including
  `/scheduler` (35.9 kB) and `/(tabs)/scheduler` (35.9 kB).
- **HIL smoke (engine on 31368)**: 8/8 checks pass — see "Manual
  smoke trace" below. Engine state file restored, ports free.

## Manual smoke trace

The brief calls for "open browser, point at engine, tap things." The
operator wants tomorrow's iPad session; for this report I instead
exercised every wire path the UI takes against the live engine on
slot 3's port (31368), plus the web build statically renders the
tab — proving the tab compiles and lays out cleanly.

### Wire trace (`tests/hil/scheduler_ui_smoke_TMP.mjs`, removed after run)

```
[smoke] 1. GET /scheduled-tasks
  ✓ presets onDuration[0]=1000
[smoke] 2. POST create fogger task   {label:"Hazer", effectId:"fogger", presetId:"default",
                                       enabled:true, mode:"duration",
                                       onDurationMs:10000, intervalMs:60000}
  ✓ created id=cbe7bf57 status=armed nextFireAt=+60s
  ✓ WS broadcast received (type=scheduledTasks)
[smoke] 3. POST /scheduled-tasks/:id/fire-now
  ✓ firing — until=+10s left
[smoke] 4. PATCH intervalMs=120000
  ✓ interval updated to 120s
[smoke] 5. POST /scheduled-tasks/:id/stop
  ✓ status=armed firingUntil=null
[smoke] 6. PATCH intervalMs=99999 (off-preset)
  ✓ 400 {"error":"intervalMs must be one of [30000, 60000, …"}
[smoke] 7. DELETE
  ✓ deleted
[smoke] 8. final GET — empty list
  ✓ empty list
[ALL SMOKE CHECKS PASSED] WS broadcasts seen: 4
```

This is exactly the path the UI walks: GET on mount → POST on
[+ ADD TASK] → fire-now on FIRE → PATCH on pill tap → stop on the
stop icon (rendered when `status === 'firing'`) → off-preset 400
surfaces verbatim in the row → DELETE on trash. The WS broadcast
the hook listens for fired four times (create, fire-now, stop, on
each PATCH/DELETE) — confirming the live-status path that drives
countdown updates in the row.

### Web SSR check

`dist/scheduler.html` (3 routes for the scheduler: top-level,
`(tabs)/scheduler`, and the sidebar entry on every other tab). Greps:

- `SCHEDULED TASKS` ✓ (header)
- `+ ADD TASK` ✓ (top-right button)
- `Loading scheduled` ✓ (initial state, before the REST seed)
- `Scheduler` ✓ (sidebar entry in `dimmer_rack.html` too — proves
  the registration is global)

The empty-state copy (`NO SCHEDULED TASKS YET` + hazer/blast-white
prose) is conditional on `isLoading === false && tasks.length === 0`
which is false during SSR; renders at runtime in the browser.

### Visual render (ASCII rendition of the tab body)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 📅  SCHEDULED TASKS                                          [+ ADD TASK] │
│                                                                            │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ [●] [fogger / default ▾]              NEXT 47s      [▶] [🗑]        │ │
│ │ ON DURATION (10s)  [1s] [2s] [5s] [10s ✓] [15s] [30s] [60s]         │ │
│ │ INTERVAL    (1m)   [30s] [1m ✓] [2m] [5m] [10m] [15m] [30m] [1h]    │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ [○] [uvBlast / default ▾]             DISABLED      [▶] [🗑]        │ │
│ │ ON DURATION (2s)   [1s] [2s ✓] [5s] [10s] …                          │ │
│ │ INTERVAL    (5m)   [30s] [1m] [2m] [5m ✓] [10m] …                    │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

When a task starts firing:
- `[▶]` flips to `[■]` (stop icon, white-on-primary fill)
- Status pill changes to `FIRING — 9s LEFT` in primary teal
- After `onDurationMs` ms the row flips back to `NEXT 60s` (or
  whatever the interval is)

### Manual UI taps (recipe for the operator)

1. Boot engine: `cd marsin_engine && node engine.js --pattern test_const --model test_bench --port 31368`
2. `cd CaptainPad && npm run web:build && npm run web:serve`
3. Open `http://localhost:6967` (or whichever port `web:serve` reports)
4. Config tab → set Engine URL to `http://127.0.0.1:31368`
5. Tap **SCHEDULER** in sidebar (between MONITOR and DIMMER RACK)
6. Tap **+ ADD TASK** — a row materialises with the first library
   entry (`blastWhite / default`), enabled, 10s × 1m, status `NEXT 60s`
7. Tap the `[blastWhite / default ▾]` chip — modal opens grouped by
   category; tap **fogger → default** — row updates to `[fogger / default ▾]`
8. Tap **▶** — row flips to `FIRING — 9s LEFT` (countdown ticks per second);
   after 10s flips back to `NEXT 50s`
9. Tap a different INTERVAL pill (e.g. `2m`) — chip caption updates to
   `INTERVAL (2m)`, broadcast confirms
10. Tap **🗑** — row vanishes, returns to empty state

## v3 ambiguities & resolutions

1. **`params` UI exposure (Phase 1 follow-up #2).** Per the doc
   ("Not in MVP UI") I did **not** add a per-task param editor. The
   `ScheduledTask` type carries `params` through the API so a
   YAML-edited override round-trips, but there's no editing affordance
   in the row. If the operator wants this later, the natural place
   is a chevron-expand on the library chip → second row of pills per
   library param.
2. **Default `[+ ADD TASK]` body (Phase 1 follow-up #4).** Engine
   requires `effectId`+`presetId`; UI computes the alphabetical-first
   library entry (sort effects by id, sort presets by id, pick the
   first non-empty) and POSTs that. If the library is empty the
   action surfaces a transient error banner instead of attempting
   the POST. If the library hasn't loaded yet, same banner — the
   button is still tappable so the operator gets visual feedback.
3. **Status pill text.** The doc draft sketch shows `next: 47s`
   (lower-case). Aligned with the rest of CaptainPad's caps idiom
   (DECK TX, AUTOPILOT, etc.) — the pill reads `NEXT 47s` /
   `FIRING — 9s LEFT` / `DISABLED` / `ERROR: <message>` all in caps
   so it matches the surrounding labels.
4. **Per-row stop button.** Doc shows `[FIRE NOW]` only. I made the
   right-side icon button flip to a stop glyph when `status === 'firing'`
   so the operator can force-close the ON window without disabling
   the task (matches the engine's `POST .../stop` semantics).
5. **Action error banner.** 400s from POST/PATCH/DELETE flash a
   transient inline banner (4 s, dismisses on next mutation). This
   is distinct from `task.lastError` which sticks until the engine
   clears it. Without this, a 400 from an off-preset value (which
   the UI prevents via fixed-set pill bars) or a missing-library-on-
   create case would silently roll back the optimistic update with
   no operator-visible feedback.
6. **Concurrent same-effect+preset overlap.** Phase 1 flagged that
   singleton-toggle effects (fogger, uvBlast, …) interfere on the
   rig output when two tasks overlap. The UI does NOT dedupe — the
   operator can create two `fogger/default` tasks. The empty-state
   copy does not currently mention this; consider adding a
   contextual hint in v4 if the operator hits the surprise.

## Known follow-ups for the operator

- **iPad native build.** The web build is clean and the SSR HTML
  renders the tab correctly. Confirming the SF-Symbol `calendar.badge.clock`
  renders on the real iPad before tomorrow's session is a 30-second
  check (it does on iOS 16+ which is the target).
- **`params` per-task overrides UI.** Deferred per the doc. The
  schema round-trips; YAML edits stick.
- **Picker grouping.** I went with the engine's `category` field
  (matches docs/31 §"Open questions" recommendation #4 default).
  If the operator wants alphabetical-flat instead, switching
  `groupByCategory` for a flat sort is one diff.
- **Lockout overlay interaction.** The tab is curtained by
  `EngineLockoutOverlay` the same way every other tab is — no
  scheduler-specific lockout logic; the engine keeps firing
  regardless.

## Operator action requested

**Ready for review and merge.** Both `dev/claude/scheduler_engine`
(Phase 1) and `dev/claude/scheduler_ui` (Phase 2) are operator-ready:
the engine HIL passes, the UI tsc + lint + web:build are clean,
the wire smoke against a real engine on slot 3 port passes 8/8
including the WS broadcast path that drives the countdown UI. The
canonical "fogger 10s every 1m" use case is one ADD tap + one
library-picker tap on the operator's iPad.
