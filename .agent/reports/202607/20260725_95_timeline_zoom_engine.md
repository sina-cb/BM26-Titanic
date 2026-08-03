# `_95` — Timeline zoom ENGINE build: slices S1 + S2

**Builds the `_94` design** (`20260725_94_timeline_zoom_design.md`) under the
operator ruling of 2026-07-31 (**D1–D8 all accepted as recommended**). Scope:
the two ENGINE slices only.

- **S1** — the pure `resolveDeckStateAt` extracted from `_catchUp`, the overview
  `phases` + `segments` (resolved ribbon), and `GET /timeline/resolve`.
- **S2** — takeover lease `scope` (`perform` / `travel`), `POST /timeline/travel`,
  the `zoom` broadcast field, and the D3 pending-program **deferral**.

**S3 / S4 (CaptainPad) build FROM §3 of this report.** Nothing in
`CaptainPad/`, `simulation/scenes/**`, `marsin_engine/patterns/**` or any
playlist was touched. Zero device traffic, zero sACN to the live rig (the one
engine spawned for route verification had its sACN destination black-holed).

---

## 0. Headline

Both slices landed. The refactor is **provably byte-identical**: 1 116
boot + resume + savePlan scenarios run against `HEAD`'s `timeline_service.js`
and the refactored one produced **zero differences** across the ordered dep-call
log, the persisted runtime state, every deck-ownership latch, the event ring and
the whole `timelineState` wire shape.

| Gate | Result |
|---|---|
| Engine timeline family | **387 / 387 pass, 0 fail** (baseline 340 → +47 new) |
| Byte-identical `_catchUp` (HEAD vs refactor) | **1 116 / 1 116 scenarios identical, 0 diffs** |
| REST wiring smoke (real engine, real `playa_default`) | **19 / 19 checks pass** |
| Full `marsin_engine` suite | 2 442 tests, 2 434 pass, **8 fail — all pre-existing/environmental, zero new** |
| Security check | PASS |
| Simulation suite | not run — **zero shared files touched** (`marsin_engine/` only) |

Two pre-existing engine truths surfaced during verification and are documented,
pinned by tests, and **deliberately not fixed** (§5): the boot-baseline clobber
(F1) and the G1 hold-expiry playlist swap, which the ribbon now reports honestly.

---

## 1. Files

| File | Change |
|---|---|
| `marsin_engine/lib/timeline/resolve_deck_state.js` | **NEW** — the pure resolver + `buildDaySegments` (the ribbon) |
| `marsin_engine/lib/timeline/timeline_service.js` | `_catchUp` consumes the resolver; `buildOverview` gains `phases`+`segments`; zoom section (`_zoomLease`, `_zoomWire`, `_dayCueTimes`, `_resolveTarget`, `_resolveWire`, `resolveAt`, `_applyResolvedSnapshot`, `travel`); `takeover(opts)`; tick deferral; `zoom` on `getState()`; `_goDormant` rehearsal guard |
| `marsin_engine/lib/api_server.js` | `POST /timeline/takeover` reads an optional body; **new** `POST /timeline/travel`; **new** `GET /timeline/resolve` |
| `marsin_engine/tests/timeline/timeline_resolve_deck_state.test.js` | **NEW** — 18 tests (legacy-core equivalence matrix, live-service oracle, purity, ribbon) |
| `marsin_engine/tests/timeline/timeline_zoom.test.js` | **NEW** — 29 tests (scope leases, travel, deferral, every exit path, dormant rehearsal) |

Untouched by design (concurrent `_93` thread): `tools/timeline_dryrun.mjs`,
`tests/timeline/timeline_dryrun.test.js`,
`tests/timeline/timeline_deck_release_default_cue.test.js`, `tests/fixtures/`.

---

## 2. S1 — the pure resolver

### 2.1 `resolveDeckStateAt({ plan, atMs, sunEvents? })`

`marsin_engine/lib/timeline/resolve_deck_state.js`. PURE by the same discipline
as `triggers.js` / `arbiter.js` / `festival.js`: no IO, no `Date.now()`, the plan
is never mutated, every instant injected. `sunEvents` is optional (it will
compute the day's own if omitted — `sun.js` is pure math); inject it to reuse the
service's per-day cache.

It returns **two deliberately distinct answers**:

| Field | Meaning |
|---|---|
| `restored` | The SELECTION CORE's pick — the cue `_catchUp` re-applies. Present **even when its `durationMin` window has already elapsed** (catchUp re-applies the complete action, then the default cue reclaims). `{cueId, label, cueKind, fireMs, action, windowUntilMs, holdUntilMs, programLive}` |
| `owner` + `playlist` / `palette` / `controller` / `source` | What actually **drives the deck** at `atMs`. A live program hold owns outright; a restored cue owns while its deck window is open; an **elapsed** window yields to the `defaultCue` / baseline. This is the answer the ribbon, the event sheet and time travel want |

Full shape:

```js
{
  atMs, dayKey, festivalDayIndex, inWindow, phase,
  owner: null | { kind:'cue'|'defaultCue'|'baseline', cueId, label, cueKind },
  action, playlist, palette,
  windowUntilMs, holdUntilMs, fireMs,
  controller: 'manual' | 'program' | 'autopilot',
  source: 'cue' | 'hold-expired-baseline' | 'default-cue' | 'autopilot-baseline' | 'dormant',
  passedCueIds: [...],          // every passed clock/sun cue — the firedToday latch set
  restored: null | { … },
  dayTimes, sunEvents,          // engine-internal, NOT on the wire
}
```

Documented boundaries (in the module header, both intentional):

- **No runtime state.** It answers from the PLAN alone — no takeover, no runtime
  `autopilotEnabled` toggle, no live ownership latch, no party session.
  `controller` is the plan-derived owner, exactly the term `_catchUp` derives.
- **No cross-midnight carry-over.** Like `_catchUp` it evaluates the CALENDAR DAY
  of `atMs` in the plan's tz — a cue that fired at 22:00 yesterday is not the
  owner at 02:00 today. That is `_catchUp`'s own day-latch semantics and is the
  honest answer to "what would the engine do if it resolved the plan here".

**Deviation from the design's §4.1 signature:** `partyConfig` is **not** a
parameter. The selection core only ever considers `clock`/`sun` cues, and the
party playlist override applies exclusively to the party **mood** cue — so the
parameter would be dead weight in every code path (codex P0: no dead params, no
silent fallbacks). The party override stays where it already lives, in the
service (`_partyPlaylistOverrideFor`). `_effectiveDurationMin(best.cue)` is
likewise provably identical to `best.cue.durationMin` for any resolver-selected
cue.

### 2.2 `_catchUp` refactor — byte-identical

`_catchUp` now calls the resolver and consumes `resolved.dayKey`,
`resolved.inWindow`, `resolved.passedCueIds` (the `firedToday` latch),
`resolved.restored` (the dispatch pick), `restored.programLive` (was
`programCaughtUp`), `restored.holdUntilMs` and `restored.windowUntilMs` (the
window re-anchor to the cue's TRUE past fire time). Everything downstream — the
dispatch, the baseline step, the resume/party rejoin block — is unchanged.

**Proof.** A one-off harness (`~/tmp/bm26_s1_byteid/check.mjs`, gitignored)
imports `git show HEAD:…/timeline_service.js` alongside the refactored module and
runs both through an identical matrix: **6 plan variants** (full, no-defaultCue,
no-festival/v1, no-program, empty-cues, autopilot-disabled) × **6 dates**
(festival day 0, 2, 4, 6, 7 and one out-of-window) × **18 local times** ×
**2 mood states**. Each scenario boots the service, then exercises the other two
`_catchUp` entry points (`takeover()` → `resume()`, and `savePlan()` over the
active plan), then diffs:

- the ordered dep-call log (every `loadPlaylist` / `setAutopilot` / `setParams` /
  `setMaster` / `forceDeckView` / `releaseDeckView` / transition / overlay / hue…),
- the full persisted runtime `state`,
- `_deckWindowCueId`, `_deckWindowUntilMs`, `_defaultCueActive`, `_baselineArmed`,
  `_partySessionFollowsMusic`,
- `cueErrors`, `bootError`, `lastError`, the whole `recentFires` event ring,
- the entire `getState()` wire payload minus the new additive `zoom` key.

```
compared 1116 boot+resume+savePlan scenarios (HEAD vs refactor)
RESULT: BYTE-IDENTICAL - 0 differences
```

A **permanent** guard ships in the suite too: `timeline_resolve_deck_state.test.js`
carries a verbatim copy of the pre-refactor selection core and runs it against
the resolver over 104 instants × 2 plans (208 comparisons of latch set, selected
cue, fire time, `programCaughtUp`, hold `untilMs` and the re-anchored window). If
the extracted core ever drifts, that fails.

Third, independent proof — the **live-service oracle** (`_94` §3.4's cross-check,
i.e. decision D5's option (b) used as the test oracle): a throwaway
`TimelineService` with recording deps and an injected clock is **booted at** each
probe instant, and what it actually did (`firedToday`, `controller`,
`activeProgram`, `_deckWindowUntilMs`, the deck playlist/palette) is compared to
what the resolver says. It uses the suite's own fake deps rather than `_93`'s
playlist-backed `makeDryRunDeps`, so it needs no real scene and stays fully
offline — the `_93` harness itself remains available as a heavier oracle for S5.

### 2.3 Overview: `phases` + `segments`

`buildOverview` gains two additive per-day fields (old clients ignore them). Both
resolve against **that day's own sun anchors**, so they shift day to day.

---

## 3. API SURFACE (S3 / S4 build from this section)

### 3.1 `GET /timeline/overview` (and `POST` for maker drafts) — additive

Each entry in `days[]` gains:

```jsonc
"phases": [
  { "name": "philharmonic", "startLocal": "19:04", "endLocal": "20:34" },
  { "name": "party_night",  "startLocal": "21:34", "endLocal": "05:23" },
  { "name": "sunrise_set",  "startLocal": "05:53", "endLocal": "07:53" }
],
"segments": [
  {
    "fromMs": 1756537200000, "toMs": 1756559280000,
    "fromLocal": "00:00", "toLocal": "06:08",
    "owner":   { "kind": "defaultCue", "cueId": null, "label": "Ambient program" },
    "playlist": "ambient", "palette": "deep_sea",
    "controller": "autopilot", "source": "default-cue"
  }
]
```

Contract notes for the UI:

- **`phases` preserves plan order.** Overlap resolves first-in-plan-order
  (`triggers.js activePhase`) — **do not sort**. `startLocal`/`endLocal` are
  `null` for a polar/missing sun anchor. A band whose `endLocal` < `startLocal`
  **wraps midnight** (that is how `party_night` works).
- **`segments` tile `[00:00, 24:00)` of that calendar day with no gaps and no
  overlaps** — `segments[i].toMs === segments[i+1].fromMs`, the first
  `fromLocal` is `"00:00"` and the last `toLocal` is the literal **`"24:00"`**
  (deliberate: a 24 h column needs 1440, not a next-day `00:00`).
- `owner.kind` ∈ `cue` | `defaultCue` | `baseline`; `source` ∈ `cue` |
  `hold-expired-baseline` | `default-cue` | `autopilot-baseline`;
  `controller` ∈ `program` | `autopilot`.
- `source: 'hold-expired-baseline'` is the **`_91` G1 truth made visible** — the
  cue still owns the ownership latch but `plan.autopilot.playlist` is what plays
  (the palette is *not* reset). Worth rendering distinctly; it is the single most
  surprising thing the shipped plan does.
- **Cost:** the ribbon costs a handful of pure resolver calls per day (~10). On
  the real 8-day `playa_default` a full `GET /timeline/overview` measured well
  inside normal REST latency, but it is heavier than before — **poll it on focus
  / on change, not on a timer.**

Real-plan output (day 0 of the shipped `playa_default`, from the live smoke) —
this is the review honesty the ribbon exists for:

```
00:00-06:08  defaultCue  Ambient program    playlist=ambient  palette=deep_sea     ctl=autopilot
06:08-07:53  cue         c_sunrise          playlist=default  palette=aurora       ctl=program
07:53-18:49  cue         c_sunrise          playlist=default  palette=aurora       ctl=autopilot
18:49-20:34  cue         c_visibility_on    playlist=default  palette=sunset_coral ctl=program
20:34-24:00  cue         c_visibility_on    playlist=default  palette=sunset_coral ctl=autopilot
```

(`c_sunrise` owning 07:53 → 18:49 and `c_visibility_on` owning 20:34 → midnight
are `_91`'s G2-family findings, now legible at a glance.)

### 3.2 `GET /timeline/resolve` — NEW, read-only

```
GET /timeline/resolve?date=YYYY-MM-DD&time=HH:MM
GET /timeline/resolve?cueId=<id>[&date=YYYY-MM-DD]      // the cue's fire instant
```

Zero side effects: nothing dispatched, no lease armed, no latch written. Use it
for the event sheet's preview.

**200:**

```jsonc
{
  "atMs": 1756605600000, "atLocal": "21:00", "date": "2026-08-30",
  "tz": "America/Los_Angeles",
  "inWindow": true, "festivalDayIndex": 0, "phase": "party_night",
  "owner": { "kind": "cue", "cueId": "c_visibility_on",
             "label": "Exterior up at golden hour", "cueKind": "program" },
  "action": { "type": "look", "look": "philharmonic" },
  "playlist": "default", "palette": "sunset_coral",
  "windowUntilMs": null, "windowUntilLocal": null,
  "holdUntilMs": null,   "holdUntilLocal": null,
  "fireMs": 1756602540000, "fireLocal": "18:49",
  "controller": "autopilot", "source": "hold-expired-baseline",
  "target": { "date": "2026-08-30", "time": "21:00", "atMs": 1756605600000, "cueId": null }
}
```

**400** `{error}` on: a malformed `date`/`time`, a `cueId` with no resolvable time
on that date (not applicable / disabled / not a clock-or-sun cue), or a target
**outside the festival window**. Never a silent fallback to "now".

Note the target is evaluated on its own merits — you can resolve an in-window
FUTURE date while the plan is dormant today. That is the bench/rehearsal case.

### 3.3 `POST /timeline/takeover` — additive optional body

```jsonc
{}                                     // BODYLESS = today's plain takeover, byte-identical
{ "scope": "perform", "cueId": "c_x" } // EVENT ZOOM (PERFORM)
```

**200** `{ ok:true, operatorLease:{expiresAtMs} | null, zoom: <zoom>|null }`.
**400** on `scope` other than `"perform"` (time travel uses `/timeline/travel`)
or a `cueId` not in the active plan.

Behavioral contract:

- A **bodyless** call with no live zoom is byte-identical to what shipped —
  same lease shape (`{expiresAtMs}` and nothing else persisted), same event-log
  line `Operator takeover (lease armed)`, same I2 30 s pending-program
  auto-start. This is unit-pinned in both directions.
- A **bodyless call while a scoped lease is alive is a REFRESH and PRESERVES the
  scope.** The deck/mixer touch-takeover hook re-calls `/takeover` on interaction;
  it must not silently downgrade a live performance. The documented zoom exit is
  `POST /timeline/resume`.
- `POST /timeline/activity` refreshes the expiry and keeps the scope (the
  presence-ping path S4 needs). Out of the festival window `takeover` still
  refuses to arm anything (`{operatorLease:null, zoom:null}`).

### 3.4 `POST /timeline/travel` — NEW

Body — exactly one of:

```jsonc
{ "date": "2026-09-03", "time": "21:00" }   // explicit instant
{ "cueId": "c_party_start", "date": "…" }   // a cue's fire instant (date optional:
                                            //  defaults to the CURRENT travel day,
                                            //  else today in the plan's tz)
{ "step": "prev" | "next" }                 // the neighbouring EVENT on the current
                                            //  travel day — requires an active travel
```

**200** `{ ok:true, zoom:<zoom>, resolved:<same shape as /timeline/resolve>, steps:[…] }`.
`steps` is the human-readable dispatch log (e.g.
`["look \"philharmonic\" palette \"sunset_coral\"", "deck ← playlist \"default\"", …]`).

**400** on any unresolvable target, an out-of-window target, `step` without an
active travel, or `step` past the first/last event of the day
(`no prev event on 2026-09-04` — fail loud, never clamp).

What it does: enters (or **retargets** — idempotent) a `scope:'travel'` operator
lease, then applies the resolved snapshot through the **normal dispatch path**
(`_applyAction`, the same one catchUp uses). Per **D4** it is a **static snapshot
in plan-time** — the live clock is never warped. It deliberately writes **none**
of the live plan's bookkeeping: no `firedToday` latch, no cooldown stamp, no
`activeProgram`, no deck-ownership window, no party session, no cue-fire ring
entry (it logs a `lifecycle` entry with reason `travel` / `travel-retarget`).
Unit-pinned.

For an owner of kind `baseline` (a plan with no `defaultCue` and no passed cue)
it loads `plan.autopilot.playlist` **without** setting the internal
`_baselineArmed` flag, so the tick's baseline reconcile does not immediately
disarm what travel just put up.

### 3.5 `zoom` on `GET /timeline/state` and the `timelineState` broadcast — additive

```jsonc
"zoom": null
"zoom": {
  "scope": "perform" | "travel",
  "cueId": "c_party_start" | null,
  "label": "Party night" | null,
  "targetMs": 1756605600000 | null,     // travel only
  "targetLocal": "21:00" | null,        // travel only
  "targetDate": "2026-09-03" | null,    // travel only
  "pendingDeferred": null | { "cueId": "c_show", "label": "Scheduled show",
                              "dueAtLocal": "20:30" }
}
```

`zoom` is non-null **only** while the operator holds a lease tagged with a scope.
It is **runtime-only and structurally un-strandable**: the zoom rides *on the
lease object itself*, so every path that already clears the lease clears the zoom
— there is no second bookkeeping to forget. Verified exits, each unit-tested:

| Exit | Result |
|---|---|
| `POST /timeline/resume` (the TIMELINE-tab gesture / EXIT button) | zoom cleared, plan resumes at now via `_catchUp` |
| Lease expiry (presence pings stopped, 120 s) | auto-release → `_catchUp` |
| `POST /timeline/autopilot {enabled:false}` | zoom cleared |
| `POST /timeline/plans` over the ACTIVE plan (maker auto-save) | zoom cleared (inherited catchUp behavior — **editing the plan while zoomed exits the zoom**, as the design documents) |
| `POST /timeline/plan/activate` | zoom cleared |
| Engine restart | zoom is never persisted-live; boot `_catchUp` drops the lease → the ship wakes in the present |
| Festival window closing | a PERFORM zoom ends (nothing is live) |
| `POST /timeline/program/enable` | zoom cleared (the operator handed the deck to the show) |

**For S4:** when `zoom` goes from non-null to `null` without this client asking,
show the design's toast and navigate back to TIMELINE.

### 3.6 D3 — pending-program deferral

While a lease with `scope ∈ {perform, travel}` is alive, the service pushes
`pendingProgram.expiresAtMs` forward to the **zoom lease's own expiry**, as a
service-level nudge **before** `arbitrate()` — the arbiter module stays pure and
completely unmodified. Consequences, all unit-pinned:

- The show is **DEFERRED, never DISMISSED**: no `firedToday` latch is burned by
  the deferral, `pendingProgram` stays armed, and `POST /timeline/program/enable`
  (the existing **ENABLE**) starts it immediately.
- The event-log line changes under a zoom only:
  `Show deferred: <label> (starts when you exit the zoom)` (reason
  `lease-deferred`) instead of the misleading `Show pending: … (auto-starts in
  Ns)` (reason `lease-armed`). **A plain takeover still logs the shipped
  `lease-armed` line and still auto-starts after `programLeaseSec`.**
- On zoom-out, `resume()` → `_catchUp` re-derives the owner for NOW: a program
  whose trigger passed mid-zoom is restored with its hold re-anchored to its true
  fire time. If the performer zoomed straight through the whole hold window it is
  honestly skipped.
- **Banner copy for S4:** render `zoom.pendingDeferred` as
  *"Show due: {label} — starts when you exit"* with an ENABLE button.

### 3.7 Rehearsal: travel while the plan is DORMANT

The design (§3.3) requires travel to work out of the festival window — "that is
exactly when the operator rehearses", and it is the state the rig is in today
(`_91` finding 16). The dormancy gate is the earliest gate in the tick and nulls
the operator lease, so a travel zoom would have been torn down within one second.

`_goDormant` now preserves an **unexpired `scope:'travel'` lease** and nothing
else — everything the PLAN owns (activeProgram, pendingProgram, baseline arm,
deck-pin) is still torn down, and the controller is still `manual`. An **expired**
travel lease is dropped right there, so a dormant plan can never strand a zoom
(the tick's normal lease-release path is not reached out of window). A PERFORM
zoom cannot exist out of window at all — `takeover()` already refuses to arm one.

Exiting a dormant travel returns the plan to dormancy, exactly as designed.
Three tests cover this (works, survives the tick, still expires).

---

## 4. Verification

### 4.1 Engine timeline family

```
cd marsin_engine && node --test "tests/timeline/*.test.js"
ℹ tests 387 · pass 387 · fail 0
```

Baseline at session start was **340 / 340** (the `_91` 317 plus `_93`'s 23). The
47 new tests are 18 resolver + 29 zoom. **Zero pre-existing failures, zero new.**

### 4.2 Byte-identity — see §2.2. `1116 / 1116`, zero diffs.

### 4.3 REST wiring smoke — real engine, real plan

A throwaway script spawned a real engine (`--model test_bench`, sACN
`--dest 127.0.0.9`, `MARSIN_STATE_DIR` redirected to a temp dir) and exercised
every new/changed route against the shipped `playa_default`: **19 / 19 checks
pass** — `state.zoom` present and null, overview `phases` + `segments` on every
day with the ribbon tiling 00:00 → 24:00, `/timeline/resolve` 200 plus 400 on
out-of-window and on a malformed query, bodyless `/timeline/takeover` 200 with
`zoom:null`, 400 on a bad scope, `/timeline/travel` 200 with `zoom.scope:travel`
reflected in `/timeline/state`, 400 on an out-of-window target, and
`/timeline/resume` clearing the zoom.

> **Caution for the S5 e2e builder:** spawning an engine **outside `npm test`**
> (i.e. without `tests/helpers/setup_config_guard.mjs`) persists deck autopilot
> state into `marsin_engine/config.yaml`. My smoke did exactly that; the file was
> inspected and **restored** (`playlist.active`, `playlist.shuffle`) and is clean.
> `MARSIN_STATE_DIR` does **not** isolate `config.yaml`. Import the config guard.

### 4.4 Full engine suite

```
cd marsin_engine && npm test
ℹ tests 2442 · pass 2434 · fail 8
```

The 8 are **all pre-existing / environmental — zero new, none in `tests/timeline/`**.
Re-run individually to separate genuine failures from parallel-load flakes:

| File | Isolated result | Verdict |
|---|---|---|
| `tests/audio/audio_capture.test.js` | 5 fail | environmental (no audio device) — documented in `now.md` |
| `tests/io/osc_listener.test.js` | 1 fail | environmental (EACCES instead of EADDRINUSE) — documented in `now.md` |
| `tests/patterns/specialty_white_uv.test.js` | 1 fail | pre-existing playlist-content drift (`white_only` `defaults` differ between the two scenes). Those playlist files are **unmodified vs HEAD**, and this build touches no playlist — cannot be caused by it |
| `tests/effects/effects_v2_mode_page_layout.test.js` | **47/47 pass** | parallel-load flake |
| `tests/mixer/deck_entry_autocapture.test.js` | **4/4 pass** | parallel-load flake |
| `tests/mixer/performance_mode.test.js` | **11/11 pass** | parallel-load flake |

(Full-suite fail counts drift 8 ↔ 19 between runs purely from those flakes — the
known `npm-test` state-pollution issue tracked in `now.md`.)

### 4.5 Simulation suite

**Not run — nothing shared was touched.** The entire diff is inside
`marsin_engine/lib/` and `marsin_engine/tests/`.

### 4.6 Hygiene

- Security check: **PASS**.
- Operator-WIP files: `marsin_engine/config.yaml` was dirtied by the route smoke
  and **restored** (§4.3). `marsin_engine/states/titanic/*.yaml` and
  `marsin_engine/models/titanic*.js` modifications **pre-date this thread**.
  No scene file, playlist, pattern or timeline plan was created or modified.
- All scratch work lived in `~/tmp/bm26_s1_byteid/` (gitignored). No temp files
  in the source tree.
- No git operations beyond reads (`git show HEAD:…`, `git status`, `git diff`)
  and the one operator-WIP restore.

---

## 5. Findings — pre-existing, NOT fixed, pinned by tests

Both were discovered by the new live-service oracle and the real-plan ribbon.
Fixing either would change `_catchUp`/dispatch behavior and break this slice's
byte-identical mandate, so both are reported and left for an operator ruling.

**F1 — the boot-baseline clobber.** `_catchUp` dispatches the restored cue and
**then** calls `_establishBaselineIfActive`, which reloads
`plan.autopilot.playlist` **on top of it**. So a boot/resume inside a
**non-program** cue's live window lands the deck on the BASELINE playlist, not
the restored cue's. A program is immune (`programCaughtUp` skips the baseline
step) and a `defaultCue` owner is applied *after* the baseline, so this is the
only case that clobbers. On the shipped `playa_default` it is invisible because
every look already points at `default` — it would bite the moment `_91`'s T1
look→playlist re-pointing lands. The oracle test **pins today's behavior** with a
named `clobberedByBootBaseline` term and a comment saying what to flip when it is
fixed.

**F2 — `_91` G1 is now visible, not fixed.** When a program's numeric hold
expires the arbiter emits `__resume_autopilot__` and the service reloads
`plan.autopilot.playlist`, but it never clears the deck-ownership latch — so the
cue keeps *owning* while the BASELINE playlist plays underneath it, and the
palette is never reset. The resolver reports this as
`source:'hold-expired-baseline'` with `playlist = plan.autopilot.playlist` and
the cue's palette retained. Reporting the cue's own playlist there would have
made the ribbon lie about the rig.

**Follow-ups for later slices**

- **S5 e2e** should reuse `_93`'s `makeDryRunDeps` recipe as a heavier
  cross-check oracle against the resolver over a full simulated night (the
  in-suite oracle deliberately uses fake deps so it needs no real scene).
- The resolver's calendar-day semantics mean the **day ribbon does not carry a
  night's owner across midnight** into the next day's ribbon. This is inherited
  from `_catchUp` and documented in the module header; if the operator finds it
  confusing in the DAY view, the fix belongs in a follow-up (a `lookBackDays`
  option), not in this slice.
- `GET /timeline/overview` is now heavier (≈10 pure resolver calls per day).
  S3 should fetch on focus/change, not on a timer.

---

## 6. Hygiene notes

- No IPs, hostnames, MACs, credentials or personal data in this report.
- No future dates, deadlines or schedule planning. Festival dates appearing in
  examples are the plan's own scene data / synthetic test fixtures.
- Zero writes outside this report, the two ledger docs, and the five engine
  source/test files listed in §1.
