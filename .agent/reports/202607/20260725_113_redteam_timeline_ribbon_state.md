# `_113` — RED-TEAM: the timeline REVIEW/ZOOM machinery — day ribbon, plan + state validation, travel targeting

**Adversarial audit** under the operator order of 2026-07-31 ("break it in the
name of bulletproofing"). Surface: the machinery the S1–S5 zoom wave added and
the gates around it — `buildOverview` / `buildDaySegments` (the day ribbon,
`_95` §2.3 + `_100` B1), `resolveDeckStateAt`, `_resolveTarget` / `travel` /
`resolveAt`, `validateShowPlan` / `lintShowPlan`, and `loadTimelineState`.
Attacked with three pure probe scripts and a **real `engine.js` subprocess** on
port **7717** (inside this agent's 7700-7749 range).

**Report-only: zero source edits, zero edits to any existing test or suite, zero
writes to `scenes/**`, `patterns/**` or any plan/playlist.** All repros live in
`~/tmp/redteam_timeline/` (`a_pure_probes.mjs`, `b_state_and_plans.mjs`,
`c_engine_probes.mjs`, `d_followups.mjs`, `out_*.txt`).

**Overlap note.** A sibling adversary owns the trigger/arbiter/party-session
side (`_103`, dry-run harness) and another owns the pad-side zoom state machine
(`_104`). This pass deliberately attacks what neither did: the **ribbon /
overview cost**, the **state-file loader**, the **resolver-vs-tick divergence**,
and **target/plan input validation**. Two of `_103`'s "safe" verdicts are
narrowed below (§F5 and §F7); one of its LOW findings (`L3`, same-instant cues)
gains a sharper second half (§F3).

---

## 0. Headline — 12 findings

| # | Sev | Category | One-liner |
|---|---|---|---|
| **F1** | **P0** | stuck / dark show | `GET`+`POST /timeline/overview` build the day ribbon **synchronously on the HTTP thread** in O(days × cues²). At the schema's own 512-cue cap that is **296 seconds** of a completely frozen engine — render, sACN out and the timeline tick all dead. 128 cues already costs 11 s and drops concurrent requests. One unauthenticated POST; nothing persisted; the process stays "alive" so no supervisor restarts it. |
| **F2** | **P0** | silent dead timeline | `loadTimelineState` validates **only the 5 party fields**. A corrupted `firedToday` / `moodArmed` / a scalar document makes the service throw at boot or on **every tick** — the whole plan (clock, sun, defaultCue, party) is dead for the night while the engine looks healthy. This is exactly the failure mode the D11 party guard was written to stop, on the fields it does not cover. |
| **F3** | **P1** | two answers, one plan | Two cues at the **same fire time**: the pure resolver (ribbon, `/timeline/resolve`, `/timeline/travel`, boot `_catchUp`) picks the **FIRST** in plan order; the live tick applies actions in order so the deck ends on the **LAST**. The review surface and a running engine disagree about the same instant. `validateNoOverlap` cannot see it (no `durationMin`). |
| **F4** | **P1** | stuck show | `hold.min` has **no upper bound**. `hold: {min: 1e12}` (or a fat-fingered `90000`) passes validation and the program **owns the deck for the rest of the festival** — every later ambient/mood cue suppressed, `defaultCue` never reclaims. `hold: {min: .inf}` is also accepted and serialises to `untilMs: null` on the wire, i.e. indistinguishable from an open-ended hold. |
| **F5** | **P2** | fail-loud violation | `POST /timeline/travel` and `GET /timeline/resolve` shape-check the target date with a bare `/^\d{4}-\d{2}-\d{2}$/` and never round-trip it. `2026-07-00` → **200**, silently resolved as `2026-06-30`, with the impossible date echoed back as `target.date`. `show_plan.js assertDate` does this correctly 30 lines away. |
| **F6** | **P2** | safety-net hole | `validateNoOverlap` keys windows by **festival-day index**, so a `durationMin` window that **crosses midnight** is never compared against the next day's cues. A cue at 23:00 for 180 min and one at 00:30 for 30 min both load, and genuinely overlap on the same night. |
| **F7** | **P2** | silent authoring failure | Nothing validates that a look's `playlist` or `palette` **exists**. `POST /timeline/plans` → 200, `plan/activate` → 200, `planWarnings: []`. The typo only surfaces as a `cueErrors` entry at fire time, on the night. |
| **F8** | **P3** | ribbon lies (off-playa) | On a DST day the ribbon tiles a **23 h or 25 h** day into a column labelled `00:00 → 24:00`. Contiguity holds; the *scale* is ~4 % wrong in both directions. |
| **F9** | **P3** | unbounded input | `sun.offsetMin` is `assertInteger` with no bounds. `offsetMin: -3000` puts a cue's fire instant on a **different calendar day** than the ribbon draws it on, and makes it "already passed" at 00:00 every day. |
| **F10** | **P3** | unbounded input | `_assertPlanName` accepts a **500-character** plan name (and lowercase Windows device names like `con`, `nul` — `CON` is rejected only because the slug regex is lowercase-only). |
| **F11** | **P3** | ordering hazard | `POST /timeline/resume` is **not authoritative** against a concurrent `POST /timeline/takeover`. 40 racing pairs leave the engine holding a live PERFORM zoom. Self-heals in ≤ `operatorLeaseSec`, so it is a hazard, not a wedge. |
| **F12** | **P3** | unvalidated state | `timeline_state.yaml` `mode` is never checked against `{armed, overridden}`. `mode: banana` — and a **truncated** `mode: arm` — load and run, and go out on the wire to CaptainPad. |

**Top 3: F1 (P0), F2 (P0), F3 (P1).**

**Baseline proven unchanged: `tests/timeline/*.test.js` = 410 / 410 pass, 0 fail**
before and after this pass. `marsin_engine/config.yaml` **absent from
`git status`** (clean vs HEAD) before and after; `simulation/scenes/*/timeline`
and `*/playlists` clean.

---

## 1. F1 (P0) — the day ribbon freezes the engine

**Where.** `lib/timeline/resolve_deck_state.js` `buildDaySegments` (:331-398) ←
`lib/timeline/timeline_service.js` `buildOverview` (:183) ←
`lib/api_server.js` `/timeline/overview` **GET :5937** and **POST :5947**.

**Mechanism.** `buildDaySegments` collects one sample point per applicable cue
(plus each hand-back boundary added by `_100` B1) and calls `resolveDeckStateAt`
at every one. Each of those calls re-runs `applicableCues` + `resolveDayTimes`
over the **whole** cue list, and `resolveDayTimes` → `clockToEpochMs` constructs
**two `Intl.DateTimeFormat` objects per clock cue**. So one day costs
`O(cues²)` Intl constructions — 512 cues ⇒ ~5×10⁵ per day — and `buildOverview`
repeats it for every festival day. All of it is **synchronous**, on the engine's
single event loop, inside the HTTP handler.

**Observed** (real engine, `:7717`, `c_engine_probes.mjs` §C5 — the middle
column is a *concurrent* `GET /status`, baseline 2 ms):

```
  16 cues x  8 days ->  200 in    251 ms; concurrent GET /status    101 ms
  32 cues x  8 days ->  200 in    744 ms; concurrent GET /status    593 ms
  64 cues x  8 days ->  200 in  2 800 ms; concurrent GET /status  2 650 ms
 128 cues x  8 days ->  200 in 11 357 ms; concurrent GET /status  FAILED (ECONNRESET) after 11 206 ms
 256 cues x  8 days ->  200 in 58 475 ms
 512 cues x  8 days ->  200 in 296 313 ms; concurrent GET /status  FAILED (ECONNRESET) after 296 162 ms
```

512 cues × **31** days (both schema maxima) was not run; it extrapolates to
~19 minutes. The engine **process stays alive** the whole time, so a supervisor
sees a healthy service.

**Expected.** The `_95` §3.1 contract for this route says only *"heavier than
before — poll it on focus / on change, not on a timer"*, measured on the shipped
4-cue plan (~10 resolver calls/day). Nothing in the wave measured the scaling,
and the 512-cue cap it relies on predates the ribbon: `show_plan.js:799` caps
cues because *"a 10k-cue POST froze /status ~32s"* — the ribbon makes **512**
cues cost **9× that**.

**Why this is P0.** During the freeze the 40 fps render loop and the sACN
sender are on the same event loop. The exterior goes dark, the timeline tick
does not run, and no HTTP or WS client can reach the engine. `POST` needs no
saved plan and no auth — a maker preview of a big draft, or one CaptainPad
`GET /timeline/overview`, is enough.

**Repro** (from `marsin_engine/`, engine already up on your own port):

```bash
node ~/tmp/redteam_timeline/c_engine_probes.mjs      # spawns its own engine on :7717
# or, pure, no engine:
node ~/tmp/redteam_timeline/a_pure_probes.mjs        # §A7: 36 s for ONE day at 512 cues
```

**Hardening.** (a) memoise `dayTimes`/`applicableCues` per day instead of
recomputing inside every `resolveDeckStateAt` call — the ribbon already computes
them once at :345-346 and then throws them away; (b) hoist the two
`Intl.DateTimeFormat` constructions out of `clockToEpochMs` into a per-tz cache;
(c) bound the ribbon (cap sample points, or omit `segments` above N cues and say
so on the wire); (d) lower the cue cap to what the ribbon can actually afford.
Any one of (a)/(b) is likely a 100× win on its own.

---

## 2. F2 (P0) — a corrupted state file kills the whole timeline, silently

**Where.** `lib/timeline/timeline_state.js` `loadTimelineState` (:200-228).

The loader's own doc block explains D11: a hand-edited `partyEnabled: "no"`
used to parse fine and then throw inside **every tick**, killing clock cues, sun
cues and the default-cue reconcile *while the engine looked healthy*, at 86 k
unthrottled log lines/day. The fix validates **`partyEnabled`, `partyPlaylist`
and the three timing numbers** — and nothing else. Every other field of the
persisted state is loaded verbatim and handed to code that assumes its type.

**Observed** (`b_state_and_plans.mjs` §B1 — each case is a real
`timeline_state.yaml`, a real `TimelineService` boot, then three ticks):

| state file | loader | service |
|---|---|---|
| `partyEnabled: "no"` | **rejected, named** ✅ | — |
| `firedToday: yes` | accepted | **throws** — `Cannot create property 'c_morning' on string 'yes'` |
| `moodArmed: 5` | accepted | **throws** — `Cannot create property 'c_mood' on number '5'` |
| whole file is `42` | accepted | **throws** — `Cannot create property 'activePlan' on number '42'` |
| `mode: banana` | accepted | runs, `mode` = `banana` on the wire (**F12**) |
| truncated `mode: arm` | accepted | runs, `mode` = `arm` on the wire (**F12**) |
| whole file is a YAML **list** | accepted | runs with an **array** as runtime state, `mode: undefined` |
| `operatorLease: 42`, `activeProgram: "burn"`, `moodSince: "yesterday"`, `pendingProgram` missing `expiresAtMs` | accepted | survives (benign today, all unguarded) |
| NUL/binary bytes, empty file | rejected / default ✅ | — |

The three throwing cases are the show-killers. In the live engine the tick is
`this._tick().catch(...)` (`timeline_service.js:382`), so the throw becomes one
`console.warn` per tick **forever** and `lastError` on the wire — the process
never exits, the supervisor never restarts it, and **the plan drives nothing all
night**. `firedToday` and `moodArmed` are exactly the fields a
crash-during-write, a disk-full truncation, or an operator hand-edit would
mangle.

**Hardening.** Extend the D11 guard to the whole shape: `mode ∈ {armed,
overridden}`; `firedToday` / `moodArmed` / `moodLastFire` must be plain objects;
`operatorLease` / `activeProgram` / `pendingProgram` must be `null` or objects
with their documented keys; the document itself must be a plain object. Reject
loud at boot naming the file and the field — the same one-line-error trade D11
already chose.

**Repro:** `node ~/tmp/redteam_timeline/b_state_and_plans.mjs` → §B1.

---

## 3. F3 (P1) — the ribbon and a running engine disagree about the same instant

Two enabled clock cues at `21:00`, both restorable, neither with a
`durationMin` (i.e. both "own the deck until the next deck cue"):

```
resolver @21:30      -> owner = cue_first   playlist = pl_a
live tick fires      -> [cue_first, cue_last]
live LAST-APPLIED    -> cue_last            look = look_b   <-- what is on the deck
```

- `resolve_deck_state.js:152` — `if (restorable && (best === null || fireMs >
  best.fireMs))`. Strictly greater, so on a **tie the FIRST in plan order wins**.
- `arbiter.js:139-201` pushes actions in fire order and the service applies them
  in order, so on a tie the **LAST in plan order wins**.

Everything that consumes the resolver — the day ribbon, `GET /timeline/resolve`,
`POST /timeline/travel`, and **boot/resume `_catchUp`** — therefore names the
opposite cue from the one a continuously-running engine leaves on the deck.
Concretely: the boat shows `look_b` all evening; reboot it and it comes back on
`look_a`; the review ribbon insists `look_a` was right the whole time.

`_103` L3 records the live half (both dispatch, plan-order wins, the loser is a
`wouldFire`). The half that matters for the zoom wave is that the *review
surface built to be the honest one* takes the other branch.

`validateNoOverlap` cannot catch this: it only considers cues that have a
`durationMin` (`show_plan.js:735`). Same-instant cues **with** `durationMin` are
correctly rejected (verified, §A2b).

**Hardening.** Pick one tie-break and state it in both places — `>=` in the
resolver would match the live "last wins" — and/or extend the overlap validator
to same-instant clock/sun cues regardless of `durationMin` (also `_103`'s L3 fix).

**Repro:** `node ~/tmp/redteam_timeline/a_pure_probes.mjs` → §A1.

---

## 4. F4 (P1) — a hold the show never escapes

`validateHold` bounds `hold.min` below (`> 0`) but not above. Driving a real
`TimelineService` through **seven simulated days** (`d_followups.mjs` §D2):

```
hold.min = 1e12       -> activeProgram = {cueId: c_forever, untilMs: 60001788838140000}, controller = program
hold.min = 1e9        -> still owning after 7 days
hold.min = .inf       -> untilMs = Infinity  ->  JSON.stringify renders it as  null  on the wire
```

For the whole hold the arbiter suppresses every ambient and mood cue
(`arbiter.js:174-199`), the `defaultCue` never reclaims, and only an operator
takeover ends it. The `.inf` case is worse than the big-number case: `untilMs:
null` is the documented encoding of *"holds until the next program cue"*, so the
UI cannot tell a permanent hold from an open one.

A realistic route in: a typo of `90` → `9000` in the maker. `hold.min: 9000` is
6¼ days — the entire festival, from one cue, with no complaint anywhere.

**Hardening.** Bound `hold.min` to something a night can contain (e.g. ≤ 1440),
require `Number.isFinite`, and lint a resolved `holdUntilMs` that outlives the
plan's own day. (`_103` L2 is the mirror image — a `hold.until` anchor already in
the past gives a ~zero hold. Both ends want the same lint.)

---

## 5. F5 (P2) — the travel/resolve target date is not a date

`timeline_service.js:2713` and `:2735` shape-check the target with bare regexes
and hand the string straight to `dateClockToEpochMs`, which is `Date.UTC(...)` —
so out-of-range fields **roll over silently**. Real engine, `POST
/timeline/travel`:

| body `date` | status | engine resolved | echoed `target.date` |
|---|---|---|---|
| `2026-07-00` | **200** | `2026-06-30` | `2026-07-00` |
| `2026-07-32` | **200** | `2026-08-01` | `2026-07-32` |
| `2026-13-01` | **200** | `2027-01-01` | `2026-13-01` |
| `2026-00-15` | **200** | `2025-12-15` | `2026-00-15` |
| `0000-01-01` | **200** | `1900-01-01` | `0000-01-01` |

The response carries **both** the impossible date and a different resolved day,
and the impossible one is what `_resolveTarget` then reuses as `currentDate` for
every subsequent `{step:'prev'|'next'}`. `show_plan.js assertDate` (:106-117)
already does the round-trip check correctly for plan dates; the API path just
does not call it. `time` is validated properly (`24:00` → 400 ✅), and every
malformed `step` 400s ✅.

**Hardening.** Reuse `assertDate`'s round-trip in `_resolveTarget`, for both
`{date,time}` and the `{cueId, date}` form.

**Repro:** `c_engine_probes.mjs` §C1.

---

## 6. F6 (P2) — the overlap safety net has a nightly hole

`validateNoOverlap` (`show_plan.js:731-770`) resolves each cue's window per
**festival-day index** and only compares windows that share an index
(`b.byDay.get(dayIndex)`). A window that crosses midnight belongs to two
calendar days but only ever lands in one bucket. So:

```yaml
- id: c_late          # 23:00, durationMin 180  ->  owns 23:00 .. 02:00 NEXT day
- id: c_small_hours   # 00:30, durationMin  30  ->  owns 00:30 .. 01:00
```

loads clean, and the two genuinely own the deck at the same time every night.
Same-day overlaps are still caught correctly (verified). `_103` §1 records
"Overlapping deck windows are rejected at load — safe"; that holds *within* a
day only.

**Hardening.** Compare a window against day `i` **and** day `i+1`, or resolve
every window onto an absolute timeline before the pairwise sweep.

---

## 7. F7 (P2) — a look can point at a playlist that does not exist, and nothing says so until the night

Neither `validateShowPlan` nor `lintShowPlan` resolves a look's `playlist` or
`palette` against anything. On the real engine:

```
POST /timeline/plans      {looks.ambient.playlist: 'does_not_exist_xyz'}  -> 200 {"ok":true}
POST /timeline/plans      {looks.ambient.palette:  'not_a_palette_xyz'}   -> 200 {"ok":true}
POST /timeline/plan/activate                                              -> 200
GET  /timeline/state   ->  planWarnings: []      lastError: null
```

In-process (§D3) the failure eventually appears as a `cueErrors` entry and
`lastError` **at fire time**. `_103` records this as "fail loud (bootError +
cueErrors) — safe"; that is true of the *runtime*, and it is exactly the wrong
end of the night to learn it. The authoring path — the maker's save, activate
and overview, which is where a human would see it — is completely silent, and
`lintShowPlan` already exists as the place for precisely this class of finding
(it is what `_98` FIX 4 added it for).

**Hardening.** Give `lintShowPlan` an optional catalog argument (playlist names +
`config.colorPalettes` ids) and emit `look_unknown_playlist` /
`look_unknown_palette` findings; `POST /timeline/plans` can then return them
alongside `ok:true` the way `planWarnings` already travels.

---

## 8. P3 findings

**F8 — the ribbon draws a 23 h and a 25 h day as 24 h.** `buildDaySegments`
anchors `dayStartMs`/`dayEndMs` at local midnight, so on a DST day the ribbon
covers 23 or 25 real hours while `hhmm()` labels the close as the literal
`24:00`. Tiling and contiguity are **correct** (verified on 2026-03-08 and
2026-11-01: 5 segments, contiguous, `00:00` → `24:00`), but a UI laying segments
against a fixed 24 h column mis-places every event by ~4 %. Not applicable to the
BM window (late Aug / early Sep); it bites any other tz or a bench rehearsal on a
transition day. `_103` L4 covers the *cue-fires-late* half of DST; this is the
ribbon half.

**F9 — `sun.offsetMin` is unbounded.** `offsetMin: -3000` resolves a cue's fire
instant onto a **different calendar day** than the ribbon that draws it; the cue
reads as "already passed" from 00:00 every day and owns the entire ribbon.
Bound it to ±1440.

**F10 — plan names.** `_assertPlanName` accepts a 500-character name (path-length
hazard on Windows) and lowercase Windows device names (`con`, `nul`). Traversal
(`../escape`, `..\escape`, `a/../../escape`) is correctly rejected. Bound the
length and reject the reserved basenames.

**F11 — `resume()` is not authoritative.** 40 concurrent
`takeover{scope:'perform'}` ‖ `resume` pairs (all 200/200) left the engine in
`mode: overridden` with a **live PERFORM zoom** and the pad's EXIT lost. It
self-heals when the lease expires, so this is a hazard rather than a wedge — but
CaptainPad's deck/mixer touch-takeover hook re-calls `/takeover` on interaction,
so "tap the deck while hitting EXIT" is a real gesture. Pairs with `_104` A1
(the pad's leaky exit-claim latch); the engine-side mitigation is to make
`resume()` win a same-instant race (e.g. a monotonic lease generation).

**F12 — `mode` is never validated.** See the F2 table. `mode: banana` and the
truncated `mode: arm` both load, run, and go out on `/timeline/state`.

**Also observed, not findings** (recorded so the next pass skips them):

- **No prototype pollution.** `__proto__` / `constructor` keys under `looks`,
  `phases` or `globals` are rejected by `assertSlug`, and `Object.prototype` is
  untouched after a load (§D1).
- **The 512-cue cap is enforced** (513 → named throw) and the **1 MB request-body
  cap** rejects a 5 MB cue label with `413` before any parsing.
- **Kill-mid-zoom is clean at both scopes.** A real `SIGTERM` + reboot during a
  PERFORM and during a TRAVEL both wake as `mode: armed`, `zoom: null`,
  `controller: autopilot` — the boot scrub works, and (confirming `_100` F1 /
  `_104` A2) the lease bytes **are** on disk; only the scrub stops a ghost banner.
- **Stepping past the plan edges 400s** (`no next event on <date>`) and never
  clamps; `step: 'sideways'` 400s.
- **Polar / missing sun events** never crash the resolver or the ribbon.
- **The plan validator is otherwise strong**: 33 of 43 hostile mutants produced a
  **named** error (missing/blank fields, unknown look, unknown trigger type,
  duplicate ids, bad tz, `lat` out of range, `durationMin` ≤ 0 / non-numeric,
  `festival.days` out of range, `festival.startDate: 2026-02-30` **and**
  `2026-09-00`, `days` index out of range, `clock at "24:00"` / `"9:00"`,
  non-integer `offsetMin`, a non-deck `defaultCue` target, plan-name traversal).
- **`tz: "+07:00"`** is accepted (Node's ICU treats offset zones as valid); it
  behaves consistently, so it is noted rather than filed.

---

## 9. Attack coverage matrix

| Attack | Verdict |
|---|---|
| `/timeline/overview` at 16 → 512 cues (GET + POST, real engine) | **F1 (P0)** — 296 s frozen event loop at the cap |
| Corrupted `timeline_state.yaml`, 14 shapes | **F2 (P0)** ×3 dead-timeline, **F12** ×2 unvalidated `mode` |
| Two cues at an identical fire time | **F3 (P1)** — resolver vs tick disagree |
| `hold.min` extremes (1e9 / 1e12 / `.inf`), 7 simulated days | **F4 (P1)** — never hands back |
| `travel`/`resolve` target-date fuzzing (6 impossible dates) | **F5 (P2)** — silent rollover, 200 |
| Midnight-wrapping `durationMin` windows | **F6 (P2)** — escapes `validateNoOverlap` |
| Same-day overlapping windows | rejected, named — safe |
| Unknown playlist / palette in a look, save + activate | **F7 (P2)** — 200, `planWarnings: []` |
| DST spring-forward + fall-back ribbons | **F8 (P3)** — 23 h/25 h drawn as 24 h; tiling correct |
| Unbounded `sun.offsetMin` | **F9 (P3)** |
| Plan names: traversal / device names / 500 chars | traversal safe; **F10 (P3)** |
| 40× concurrent `takeover` ‖ `resume` | **F11 (P3)** — resume loses the race |
| 12× concurrent `travel` ‖ `perform` ‖ `savePlan` ‖ `activity` | clean — `mode: armed`, `zoom: null`, `lastError: null`, deck back under the plan |
| Real `SIGTERM` mid-zoom, both scopes | scrubbed on boot — safe |
| Step past first/last event; bad `step` value | 400, named — safe |
| 43 hostile plan mutants through `loadShowPlan` | 33 named throws; the rest are F4/F9/F12-class or benign |
| `__proto__` / `constructor` keys in plan maps | rejected; no pollution — safe |
| 513 cues; 5 MB cue label | capped (`max 512`) / `413` — safe |
| Polar sun (lat 78, solstices) | resolver + ribbon fine — safe |
| 1 e-9 / 1 e-7 `durationMin` (sub-millisecond windows) | accepted; hands back immediately — cosmetic |

---

## 10. Hardening priority

1. **F1** — memoise `dayTimes` per day inside `buildDaySegments` and cache the
   `Intl.DateTimeFormat` objects in `clockToEpochMs`. Add a perf regression test
   that asserts `buildOverview` on a cap-sized plan stays under a stated budget.
2. **F2** — extend the D11 state guard to the whole persisted shape and reject
   loud at boot.
3. **F3** — pin one tie-break in both the resolver and the arbiter, and extend
   `validateNoOverlap` to same-instant cues (shared fix with `_103` L3).
4. **F4** — bound `hold.min`; require finite.
5. **F5** — round-trip the target date in `_resolveTarget`.
6. **F6** — compare overlap windows across the day boundary.
7. **F7** — teach `lintShowPlan` the playlist + palette catalogs.
8. **F9 / F10 / F12** — bound `offsetMin`, bound the plan name, validate `mode`.

---

## 11. Hygiene

- **Report-only.** No source edits, no edits to any existing test or suite, no
  writes to `scenes/**`, `patterns/**`, playlists or plans, no git operations
  beyond reads.
- **Baseline proven both ways:** `tests/timeline/*.test.js` **410 / 410 pass, 0
  fail** at session start and again at the end.
- **`marsin_engine/config.yaml` CLEAN vs HEAD** — absent from `git status`
  before and after. `simulation/scenes/*/timeline` and `*/playlists` clean. The
  modified `marsin_engine/lib/timeline/*`, `simulation/**` and
  `marsin_engine/states/titanic/*` in the working tree are other agents'
  concurrent uncommitted work; my engine ran the `test_bench` model against
  `MARSIN_STATE_DIR` / `MARSIN_PLAYLISTS_DIR` / `MARSIN_TIMELINE_DIR` temp dirs
  and could not have written any of them.
- **Every spawned engine was black-holed and ASSERTED**, copying
  `tests/e2e/timeline_e2e_harness.mjs`'s three walls verbatim:
  `MARSIN_CONFIG_FILE` with `controllers: []` + `sacn.destinations:
  ['127.0.0.9']`, every `[sACN Out] Sender started` line checked, no Art-Net
  sender, `GET /status.outputRouting.controllers === []`. **Zero device HTTP.**
- **Ports:** every engine on **7717** only (inside the assigned 7700-7749). The
  operator's stack (`:6969-:6972`, UDP 5568) and his Expo (`:6967`) were never
  approached, connected to or restarted. UDP 5568 was never bound; no multicast.
- Repros + raw output: `~/tmp/redteam_timeline/{a_pure_probes.mjs,
  b_state_and_plans.mjs, c_engine_probes.mjs, d_followups.mjs, out_a.txt,
  out_b.txt, out_c2.txt, out_d.txt}` (gitignored).
- No IPs, hostnames, MACs, credentials or personal data; no future dates,
  deadlines or schedule planning. `127.0.0.9` is a loopback black hole. Festival
  dates in examples are synthetic fixtures or the plan's own scene data. Line
  numbers are anchors against the working tree at audit time.
