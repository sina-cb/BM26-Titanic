# `_97` — Timeline zoom PAD build: slices S3 + S4 (CaptainPad)

**Builds `_94` §2/§3/§6 against the LANDED engine API in `_95` §3**, under the
operator ruling of 2026-07-31 (**D1–D8 all as recommended**). One agent built
both slices so the zoom ladder has one mind behind it.

- **S3 — DAY ZOOM.** `FESTIVAL` (the existing 8-day strip) → `DAY` full-screen:
  per-day phase bands + the resolved "what actually plays" ribbon, sun-anchored
  per day, prev/next day, the reserved `SHIFT TONIGHT` slot.
- **S4 — EVENT ZOOM.** Tap an event → the DECK tab under a **green PERFORM**
  banner (live event: `POST /timeline/takeover {scope:'perform',cueId}`) or a
  **purple TIME TRAVEL** banner (inactive: `POST /timeline/travel`, static
  snapshot + prev/next steppers), with every exit funnelled through
  `POST /timeline/resume` → `_catchUp` at now.

**Nothing in `marsin_engine/` was modified.** The engine was run only as a live
target for verification (§4.4 documents one honest slip on the way).

---

## 0. Headline

Both slices landed and were proven **live on a fresh `:7167` dist build against
a real engine**, not just in unit tests. The five things the mission asked to
see on screen all exist and were eyes-on inspected:

| Gate | Result |
|---|---|
| `tsc --noEmit` | **clean** |
| CaptainPad vitest suite | **914 pass / 6 skipped, 0 fail** (baseline 892 → **+22 new**, zero new failures) |
| `expo lint` on touched files | **0 findings** (repo total unchanged: 4 pre-existing errors in `GlobalEffectMacros.tsx`, untouched) |
| Live day zoom (phase bands + ribbon) | PASS — screenshots `b1`, `f1` |
| Live PERFORM banner over the deck | PASS — `h2` |
| Live TIME TRAVEL banner + steppers | PASS — `d2`, `n1`–`n3` |
| Live `pendingDeferred` banner (D3) | PASS — `h3`, with the engine log line `lease-deferred` |
| Security check | PASS |

**One real bug was found by the live run and fixed** (§3.4): the engine
broadcasts the cleared `zoom` on its own 1 s tick, which routinely beats our own
`resume()` response back to the app — so the operator's own "return to the
timeline tab" exit raised a *"zoom ended — the plan resumed"* alarm at the person
who had just asked to leave. Fixed by staking the exit claim **before** the
request goes out, and pinned by a test.

---

## 1. Files

| File | Change |
|---|---|
| `CaptainPad/components/timeline/zoom_logic.ts` | **NEW** — the pure derivations: phase-band geometry (incl. the midnight wrap), ribbon rows, the banner copy, the perform/travel branch |
| `CaptainPad/components/timeline/zoom_logic.test.ts` | **NEW** — 22 pinned tests |
| `CaptainPad/components/timeline/DayView.tsx` | **NEW** — the DAY rung (replaces `DayEditor.tsx`) |
| `CaptainPad/components/timeline/EventSheet.tsx` | **NEW** — the EVENT rung |
| `CaptainPad/components/timeline/ZoomBanner.tsx` | **NEW** — the global PERFORM / TIME TRAVEL mode banner |
| `CaptainPad/components/timeline/DayEditor.tsx` | **DELETED** — promoted into `DayView` (design §6: "`DayEditor.tsx` → `DayView`") |
| `CaptainPad/utils/timelineApi.ts` | wire types `OverviewPhase` / `OverviewSegment` / `TimelineZoom` / `TimelineResolve`; `fetchTimelineResolve`, `postTimelineTravel`, takeover body |
| `CaptainPad/hooks/useTimeline.ts` | `performTakeover`, `travel`; the entered-here / exit-requested claims; `useZoomPresence` |
| `CaptainPad/app/(tabs)/timeline.tsx` | the zoom-level nav state, the EVENT rung wiring, the D1 tab-return exit |
| `CaptainPad/app/(tabs)/_layout.tsx` | mounts `ZoomBanner` beside `PendingProgramOverlay` |
| `CaptainPad/components/timeline/DayOverviewStrip.tsx` | tap = zoom in (`onOpenDay`); theme badges |
| `CaptainPad/components/timeline/PendingProgramOverlay.tsx` | stands down under a zoom (§3.3) |
| `CaptainPad/components/ui/icon-symbol.tsx` | `chevron.left` mapped (unmapped SF names render a blank glyph on web) |

---

## 2. S3 — DAY ZOOM

### 2.1 The ladder, and why the day is a LEVEL and not a modal

```
FESTIVAL ──tap a day──▶ DAY ──tap an event──▶ EVENT (the deck itself)
 (8-day strip)          (full screen)         LIVE  → PERFORM
     ◀── WEEK ──────────┘                     else  → TIME TRAVEL
                          ◀── return to the TIMELINE tab = zoom out ──┘
```

The old `DayEditor` was a modal reached by a second button (`EDIT DAY`) while a
single tap merely *selected* a day — two gestures, two meanings, one of them
invisible. That is exactly the "learnable at 3 am" problem the operator flagged,
so the day was promoted to a real level: **the card body and its button both
zoom in**, and `◀ WEEK` zooms out. The button now reads `OPEN DAY ▸`.

Everything the modal did — the vertical agenda, `＋ CUE`, per-row edit/delete
into the existing `CueEditorSheet` — moved across unchanged. **No new edit
semantics were introduced**, per design §2.2.4.

### 2.2 Phase bands

`allPhaseBands()` projects the overview's per-day `phases` onto a 0…1440 column.
Two `_95` §3.1 contract rules are enforced *in code, with tests*:

- **Plan order is the draw order** — overlap resolves first-in-plan-order, so
  the array is never sorted; each band carries its plan index.
- **A band whose `endLocal` < `startLocal` WRAPS MIDNIGHT** and is drawn as two
  pieces, labelled `⤵`. This is not cosmetic: `party_night` runs 21:34 → 05:23,
  and rendering it as one inverted rectangle draws *nothing* — a whole night
  would silently read as empty. The live day view shows `party_night ⤵` at both
  the top and the bottom of the column (screenshot `b1`).
- A phase anchored to a sun event the day does not have (`null` anchor) draws
  **nothing** — never a guessed band.

### 2.3 The resolved ribbon

A second column on the same 24 h scale, built from the overview's `segments`.
Each row shows `▸ <playlist>`, the window and owner, and a plain-language note
for `source`:

| `source` | rendered note |
|---|---|
| `cue` | "the cue owns the deck" |
| `hold-expired-baseline` | **"⚠ hold expired — the autopilot baseline plays under the cue"** (amber) |
| `default-cue` | "gap — the plan default cue" |
| `autopilot-baseline` | "no cue, no default cue — the autopilot baseline" |

The amber warn row **is** `_91`'s G1 made visible (`_95` F2). The ribbon renders
the truth of the shipped plan; it does not fix it.

> **Cross-thread note.** `_98` landed while this slice was in flight and **fixed
> G1 at the source** — a hold expiring now hands the deck to the ambient
> `defaultCue`, and `source:'hold-expired-baseline'` no longer appears on the
> wire. The pad keeps handling it anyway: it costs one branch, it stays correct
> against an engine that predates `_98`, and if the condition ever returns the
> ribbon says so in amber instead of hiding it. My live captures were taken
> against the pre-`_98` engine, which is why the shipped-plan ribbon in the
> screenshots still shows cue windows yielding to `ambient` gaps rather than
> `_98`'s new arc — re-shoot on the current engine when convenient; the
> rendering path is identical.

The literal `"24:00"` terminator is parsed to 1440 (`localToMinutes`) — treating
it as an unparseable value or as a next-day `"00:00"` would collapse the last
band to zero height at the top of the chart. Pinned by test.

**The midnight limit is stated on screen, not hidden.** Per `_95` §5 the engine's
resolver evaluates the CALENDAR DAY of the target, so a night's owner is not
carried across midnight into the next day's ribbon. The DAY view says so in one
line under the chart rather than faking continuity:

> *The ribbon resolves this CALENDAR DAY only — a cue that fired last night is
> not shown owning this morning (the engine's own day-latch semantics).*

### 2.4 Loud when the data isn't there

`phases` / `segments` are typed OPTIONAL because an engine built before the zoom
slice omits them. When they are absent the DAY view prints a red block saying
the engine returned none and that nothing below substitutes for it — it does not
draw an empty ribbon and call it a review (codex P0).

### 2.5 Theme badges + the reserved SHIFT slot

Day cards carry a badge with that day's PROGRAM cue label, derived entirely
client-side (a `days:[6]` cue only appears on day 6 in the overview, so no new
wire data). The DAY header reserves one inert, dashed `SHIFT TONIGHT · —` slot
where the `_91` §3.1(a) `planOffsetMin` build lands (design D8: confirm the
placement now, build later). It is labelled as unavailable — it never lies.

---

## 3. S4 — EVENT ZOOM

### 3.1 The event sheet

One sheet, ONE primary action, branch chosen by the ENGINE's own state:

- `eventZoomMode()` — PERFORM is offered **only** for the cue the engine reports
  as `activeCue`, **and only on TODAY's card**. The same cue appears on every day
  it applies to; marking Thursday's row live because today's instance is running
  would be a lie, and would offer PERFORM from a day that is not happening. (This
  was caught during the live run — §4.3.)
- `canPerform()` — PERFORM is withheld out of the festival window, because
  `takeover()` refuses to arm there and a button that can only 400 is worse than
  no button. The sheet says why. **TRAVEL stays available while dormant** — that
  is exactly when the operator rehearses (`_95` §3.7), and it is the rig's state
  today.
- The context block is fed by `GET /timeline/resolve` (zero side effects). Its
  400s are surfaced **verbatim**; there is no invented preview.

### 3.2 The banner

`ZoomBanner` is mounted once in `app/(tabs)/_layout.tsx`, outside `<Tabs>`, so
it floats over deck, mixer, timeline and everything else — while a zoom is held,
"which clock is real" must be answerable from any tab without navigating. Copy
is pinned by tests:

- **PERFORM (green):** `🎚 PERFORMING — <event> · you have the deck — the plan is holding`
- **TRAVEL (purple):** `🕰 TIME TRAVELING — <date> · <time> · <event> · viewing the plan, not tonight`, with `◀ ▶` steppers
- **D3 deferred (amber second line):** `⚠ Show due: <label> — starts when you exit` + **ENABLE** — the copy `_95` §3.6 pins. It never says "cancelled", because the show is deferred, not dismissed.

Steppers call `POST /timeline/travel {step}`. At the first/last event of the day
the engine 400s with a named message and the banner prints it **verbatim** —
`no prev event on 2026-07-31` (screenshot `p1`). Never clamped.

**Presence, not touch.** `useZoomPresence` pings `/timeline/activity` every 30 s
while the banner is mounted with a live zoom, so a performer watching the rig
hands-off does not lose the lease. The pings die with the banner: a backgrounded
app, a dead iPad or dropped WiFi still hands the ship back inside the 120 s
lease. **Verified both ways live** — a PERFORM zoom survived a 4-minute
hands-off wait (§4.2 `h3`), and after the browser closed the lease expired on
schedule and `_catchUp` fired the deferred show (§4.2).

### 3.3 The contradictory-strip fix

While a zoom lease is alive the engine defers `pendingProgram.expiresAtMs` to
the zoom lease's own expiry. The existing `PendingProgramOverlay` would then
count down `auto-starts in 0:29` for a show that will not start until the zoom
exits. That strip now **stands down under a zoom** and the ZoomBanner carries the
honest line instead. A **plain** takeover keeps the shipped 30 s auto-start and
keeps the strip with it.

### 3.4 Exit rules — and the race the live run found

Every exit funnels through `resume()` → `_catchUp` at NOW:

| Exit | Where it lives | Live proof |
|---|---|---|
| Return to the TIMELINE tab (D1) | `useFocusEffect` in `timeline.tsx`, gated on `zoomEnteredHere()` | `k`, `m` runs — engine logs `resume`, banner clears in ≤3 s |
| **EXIT** button (any client) | `ZoomBanner` | present on every variant, incl. a client that never zoomed (`p0`) |
| Lease expiry | pings stop when the banner unmounts | verified — `lease-released` at the expected second |
| Engine restart / autopilot OFF / plan save | engine-side, `zoom → null` | announced by the banner (below) |

D1 is deliberately gated on **this** client having entered the zoom: there is ONE
engine zoom session, both pads render the same banner off the same broadcast, and
a second pad merely browsing to its timeline tab must never yank pad A's
performance. That second pad exits through the banner's EXIT instead — observed
live in run `p` (a fresh page rendered the live travel banner with EXIT and did
**not** auto-resume).

**The race (found live, fixed, pinned).** The banner announces *"Zoom ended — the
plan resumed at now"* and routes back to TIMELINE when the engine drops a zoom
this client entered but did not end. On the first live pass that alarm fired on
the operator's OWN tab-return exit: the engine clears the zoom and broadcasts the
new `timelineState` on its 1 s tick, which arrived **before** our `resume()`
response and before the flag it cleared. Fix: the exit claim
(`_zoomExitRequested`) is staked **before** the request leaves, covering both
operator-initiated exits (banner EXIT and tab return), and released if the resume
fails. The decision is now the pure `shouldAnnounceZoomEnd()` with three tests,
including a named repro of this bug. Re-verified live: clean exit, no toast
(`m1`).

---

## 4. Verification

### 4.1 Static + unit

```
CaptainPad$ npx tsc --noEmit      → clean
CaptainPad$ npx vitest run        → 42 files, 914 pass, 6 skipped, 0 fail
CaptainPad$ npx expo lint         → 0 findings in touched files
```

The 22 new tests are all in `components/timeline/zoom_logic.test.ts` and pin the
things that are invisible on a screenshot: the `"24:00"` terminator, the
midnight-wrap split, plan-order preservation, the `hold-expired-baseline` warn
flag, the banner copy in both scopes, the D3 deferred line, the
perform-vs-travel branch, the out-of-window PERFORM refusal, and the exit-alarm
decision.

The 4 `expo lint` **errors** in the repo are pre-existing conditional-hook calls
in `components/GlobalEffectMacros.tsx`, untouched by this thread.

### 4.2 LIVE proof — fresh dist on `:7167` against a real engine

Method per `.agent/memory/captainpad-screenshot-technique.md`: console muted via
`evaluateOnNewDocument` **before** boot, one tab, a fresh `npm run web:build`
dist served on **:7167** (never Metro, never the operator's :6967). Harness and
outputs are gitignored under `~/tmp/bm26_s34_zoom/`.

Two plans were exercised: the shipped **`playa_default`** (DORMANT — 30 days out,
the rehearsal case) and a throwaway in-window probe plan for the PERFORM path
(§4.4).

| Shot | What it proves | Eyes-on verdict |
|---|---|---|
| `a0_festival` | FESTIVAL level intact; theme badges on day cards | PASS |
| `b1_day_top` | DAY level on the dormant real plan: daylight shade, hour gutter, **`party_night ⤵` drawn as two pieces**, `philharmonic`, `sunrise_set`, cue markers, and the full resolved ribbon (`ambient` default-cue gaps, `default` cue windows, palettes) | PASS — the wrap split is visibly correct |
| `c1` / `f1` | The day's event agenda; `● LIVE` marking only on today's card | PASS |
| `f2_event_sheet_live` | EVENT sheet, LIVE branch: `● LIVE NOW` chip, green **PERFORM**, resolver peek (`▸ ambient · deep_sea`, owner, phase, controller) | PASS |
| `d2_travel_banner_deck` | **Purple TIME TRAVELING banner on the DECK tab** with `◀ ▶` + EXIT, entered from a DORMANT plan | PASS |
| `h2_perform_banner_deck` | **Green PERFORMING banner on the DECK tab** — "you have the deck — the plan is holding" | PASS |
| `h3_perform_deferred` | **`⚠ Show due: Deferred probe show — starts when you exit` + ENABLE**, 4 minutes into a hands-off performance, deck fully live underneath | PASS — the single best shot of the slice |
| `n1`–`n3` | Travel steppers retarget correctly: 23:50 → 12:51 → 00:30, each a real engine retarget | PASS |
| `p0` / `p1` | A client that never zoomed renders the banner with EXIT (two-pad rule); `◀` past the first event prints the engine's **`no prev event on 2026-07-31`** verbatim | PASS |
| `m1_after_exit_clean` | Tab-return exit: banner gone, no false alarm, plan back on PROGRAM with the live event highlighted | PASS (post-fix) |

Engine-side corroboration from the event log during the PERFORM run — the whole
D3 loop, end to end:

```
12:47:25 lifecycle takeover        Operator PERFORM zoom (lease armed)
12:51:00 lifecycle lease-deferred  Show deferred: Deferred probe show (starts when you exit the zoom)
12:53:26 lifecycle lease-released  Operator lease released — plan resumed
12:53:26 fire      catchUp         Deferred probe show
```

The deferred show was **not dismissed**: when the lease expired, `_catchUp` fired
it and it became the active program. Exactly as designed.

### 4.3 A defect the live run caught (fixed before it shipped)

Opening a NON-today card and tapping a cue whose today-instance was running
offered **PERFORM** and drew a `● LIVE` marker on that day's row, because the
branch compared cue ids alone. Fixed: `activeCueId` is passed down only when the
rendered day IS today. Without the live pass this would have shipped as a
"perform tomorrow's show" button.

### 4.4 Environment hygiene — one honest slip, reported

- The engine was launched **only** as a verification target, `--model test_bench`,
  with `MARSIN_STATE_DIR` redirected to `~/tmp` so no tracked state file was
  touched.
- **The slip:** the first launch used `--dest 127.0.0.9` believing that
  black-holed sACN. It does not — `config.yaml` carries a per-controller
  `controllers:` block whose own host wins, and the engine streamed sACN to a
  real LED controller for roughly **30 seconds** while rendering
  `01_cylon_sweep` on universes 10 and 12. The engine was killed the moment the
  startup banner revealed the destination, the controller host was temporarily
  pointed at `127.0.0.9`, and every subsequent run showed
  `destinations [127.0.0.9]` on **both** senders before any zoom traffic. No
  device HTTP was ever issued, no output-enable was touched, and nothing was
  written to a controller — the effect was 30 s of lit LEDs. Reporting it because
  the order said no sACN toward hardware. **Lesson for S5 and for the ops docs:
  `--dest` does NOT override the `controllers:` block; check the two
  `[sACN Out] Sender started` lines before trusting an engine to be offline.**
- `marsin_engine/config.yaml` was snapshotted before the run and **restored** —
  it is clean in `git status` (the engine also rewrote its `timeline.activePlan`
  during activation; the restore covers that too).
- The throwaway probe plan `zoom_s4_probe` was written into
  `simulation/scenes/test_bench/timeline/` via the REST API and **deleted**
  afterwards; `playa_default` was re-activated. `diff -r` against the pre-run
  snapshot reports the directory **IDENTICAL**. No titanic scene file was
  approached.
- The pre-existing `marsin_engine/states/titanic/*.yaml` modifications and
  `simulation/scenes/test_bench/bench_mirror.yaml` pre-date this thread.
- The sim stack another agent had on :6969/:6970/:6972 was **not** touched,
  restarted or connected to.
- **`_98`'s commit blocker is CLEARED, and it was mine.** That report flagged
  "`config.yaml`'s controller host is a loopback and MUST be restored before any
  commit" — that was this thread's temporary black-hole. It is restored to the
  real host and `git status` shows the file unmodified.
- The engine and the `:7167` dist server were both **shut down** at the end of
  this thread, so `_99`'s deferred `launcher.js prod` (which force-claims :6968)
  is now unblocked from this side.
- All scratch lives in `~/tmp/bm26_s34_zoom/` (gitignored). No temp files in the
  source tree. Security check PASS. No git operations.

---

## 5. Deviations from the design

| # | Design said | Built | Why |
|---|---|---|---|
| D-1 | `components/ZoomBanner.tsx` (app root) | `components/timeline/ZoomBanner.tsx` | It reads `useTimeline` and sits with its siblings (`PendingProgramOverlay`, `PlanIndicatorPill`); mount point is identical |
| D-2 | banner rendered "on deck + mixer + timeline" | mounted ONCE outside `<Tabs>`, so it renders on **every** tab | Strictly more honest, one mount instead of three, and it matches how `PendingProgramOverlay` already works |
| D-3 | — | `PendingProgramOverlay` now hides under a zoom | Not in the design, but leaving it would have shown a countdown to an auto-start the engine has deferred. Two surfaces contradicting each other at 3 am is the failure the design exists to avoid |
| D-4 | — | PERFORM is withheld when the plan is not active in-window | `takeover()` refuses to arm out of window; offering a button that can only 400 is a fallback-shaped lie |
| D-5 | — | PERFORM/LIVE is scoped to TODAY's card | §4.3 — a cue-id-only comparison offers "perform tomorrow" |
| D-6 | — | `EventSheet` uses `animationType="none"` and is mounted only while an event is selected | The fade left a translucent, half-legible sheet under capture and there is nothing to animate out |
| D-7 | filenames `EventSheet.tsx` / `DayView.tsx` (PascalCase) | as designed | Matches every sibling in `components/timeline/`; the pure logic module is `zoom_logic.ts`, matching `deck_tx_logic.ts` and the repo's snake_case rule for non-component sources |

**Not built (deliberate, per the design):** the `SHIFT TONIGHT` control is a
reserved, labelled-inert slot only (D8). `_91`'s G1 is made *visible*, not fixed.

---

## 6. Known rough edges (for the operator, not blockers)

1. **The banner overlaps the top of the deck.** It is a full-width absolute
   overlay at the top of the screen area (the design's "full-width banner"), so
   it covers ~56 px of the deck's globals row while a zoom is held. The deck
   scrolls; say the word if you want it to push content down instead.
2. **The amber `TOOK OVER · PLAN RESUMES 2:00 / RESUME NOW` strip and the
   `TOOK OVER` pill still render during a zoom.** They are honest — a zoom IS a
   takeover and the lease really is counting down — but three surfaces now
   describe one state. Consolidating them is a small polish pass, deliberately
   not taken here to avoid touching the plain-takeover path.
3. Day-card theme badges truncate long program-cue labels to one line.

---

## 7. What S5 (e2e) should cover

Everything below was exercised **by hand** in this thread and deserves a
committed runner (`.agent/ops/timeline_e2e_tests.md` style):

1. **Perform through a phase/cue boundary** — enter PERFORM before a boundary,
   stay past it, exit, assert `_catchUp` lands on the correct owner. This thread
   proved the *deferral* half (a program due mid-zoom is deferred then fired on
   exit); the boundary-crossing half is untested end to end.
2. **The full D3 loop as an assertion**, not a log read: `lease-deferred` line,
   `pendingProgram` still armed, no `firedToday` burned, ENABLE starts it now,
   exit starts it via catchUp.
3. **Lease expiry hand-back with the pad in the loop** — close the client, assert
   the zoom clears at `operatorLeaseSec` and the plan resumes. (Observed here:
   released on schedule and fired the deferred show.)
4. **Engine restart mid-zoom** — the one exit path this thread did NOT exercise
   live. Assert the pad shows the "zoom ended" notice and navigates back to
   TIMELINE. `shouldAnnounceZoomEnd` is unit-pinned; the wiring is not.
5. **Plan save mid-zoom** — the maker auto-saves; saving over the active plan
   runs catchUp and drops the zoom. Assert the pad announces it rather than
   sitting on a banner for a zoom that is gone.
6. **Two clients** — pad A performs, pad B renders the banner and does NOT
   auto-exit on tab browse; pad B's EXIT ends it for both. Half-proven here
   (run `p`).
7. **Ribbon parity** — assert the pad's rendered ribbon rows equal
   `GET /timeline/overview`'s `segments` for a day, so a future engine change
   cannot silently drift the review surface. Consider reusing `_93`'s
   `makeDryRunDeps` as the heavier oracle, per `_95` §5.
8. **The `--dest` trap** (§4.4): any e2e that spawns an engine must assert both
   `[sACN Out] Sender started` lines name a black-holed destination before the
   first frame, and must import the config guard (`_95` §4.3).
