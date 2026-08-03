# `_91` — Show infrastructure audit: timeline, party trigger, playlist coverage, testability

**Mission (operator focus shift 2026-07-31):** the titanic is fully mapped; the
focus is now the **SHOW** — timeline, planning, and **testing the show
infrastructure**. This report audits what exists, scores it against the
operator's stated requirements, and proposes the test plan.

**READ-ONLY audit.** Zero code changes, zero scene writes, zero device traffic,
no git operations. The only thing executed was the engine's own timeline test
suite (`node --test`, temp dirs only). Playlist contents and
`marsin_engine/patterns/**` were **measured, never touched** — those are
ChatGPT+operator territory.

**Headline:** the timeline *machinery* is strong, well-factored and genuinely
well-tested (317 unit tests, all green). The *show* running on it is not. The
plan on disk is a lightly-edited copy of the built-in template: it points **six
of its eight reachable looks at the `default` playlist**, and that playlist is
**62% dead entries and 92% untuned**. Two of the operator's four new
requirements are unenforced today, and there is **no way to exercise a playa
night without waiting real hours** — that harness is the first thing to build.

---

## 0. Method

Read the whole timeline subsystem (`marsin_engine/lib/timeline/`, 4,907 lines),
the engine wiring in `api_server.js`, the CaptainPad TIMELINE tab + maker
components, the companion party detector config, the scene plan + all 13
playlists, and the existing ops spec. Ran the timeline test suite. Computed the
pattern×playlist coverage matrix with a throwaway script in `~/tmp`.

---

## 1. Timeline engine mechanics

### 1.1 Who consumes `playa_default.yaml`

**Exactly one process: the marsin engine.** Nothing else on the stack reads the
file.

| Consumer | Reads the YAML? | How |
|---|---|---|
| **marsin_engine** | **YES — sole reader** | `lib/api_server.js:4571` builds `sceneDir = <repo>/simulation/scenes/<scene>/timeline/` and hands it to `new TimelineService({sceneDir, …})` at `:4574`. `timeline_service.js:346-387` loads the plan; `:365-370` writes the built-in default if the file is absent. |
| **simulation** | no | zero references to the timeline dir anywhere in `simulation/`. The plan lives *under* `scenes/` only because it is scene-owned data. |
| **CaptainPad** | no (indirect) | reads it over REST — `utils/timelineApi.ts:492-573` (`/timeline/state`, `/timeline/overview`, `/timeline/plans[/:name]`, `/plan/activate`, `/autopilot`, `/resume`, `/program/{end,enable,dismiss}`, `/cues/:id/fire`, `/takeover`, `/activity`). |
| **launcher / deploy** | no | `deploy/` has no timeline references. |

Gate: `marsin_engine/config.yaml:96-105` — `timeline.enabled: true`,
`activePlan: playa_default`, `tickMs: 1000`, `programLeaseSec: 30`,
`operatorLeaseSec: 120`, mood key `audioPartyStrong` @ threshold `0.5`,
`staleSec: 10`. Enforced at `api_server.js:4542`.

**Note:** the *state* file is authoritative over the config's `activePlan` —
`timeline_service.js:353-364` loads `states/<scene>/timeline_state.yaml` FIRST
and adopts its `activePlan` if that plan file exists. Today
`marsin_engine/states/titanic/timeline_state.yaml` says `activePlan:
playa_default`, so they agree.

### 1.2 Sun-anchored phases → wall clock

Pure, tz-correct, day-cached:

- `lib/timeline/sun.js` → `computeSunEvents({lat, lon, date, tz})`; the service
  caches per tz-local calendar day at `timeline_service.js:391-403`.
- `triggers.js:84-91` `anchorToMs()` — `{clock:'HH:MM'}` → `clockToEpochMs`,
  `{sun:<event>, offsetMin}` → `event.valueOf() + offsetMin*60000`. A missing /
  polar sun event returns **null → the cue never fires** (no fallback, correct
  per codex P0).
- `triggers.js:101-125` `resolveDayTimes()` resolves *all* phase start/end
  anchors and all clock/sun cue times for the day of `now`.
- Midnight-crossing windows are handled: `triggers.js:131-136`
  `phaseActiveAt()` treats `endMs < startMs` as a wrapping window — which is
  what makes `party_night` (sunset+120 → sunrise−60) work at all.
- Phase overlap resolution: **first phase in plan order wins**
  (`triggers.js:142-148`).

The three phases resolve to (schema `playa_default.yaml:20-41`):
`philharmonic` sunset−30 → sunset+60; `party_night` sunset+120 →
sunrise−60; `sunrise_set` sunrise−30 → sunrise+90.

**Finding P1 — two of the three phases are decorative.** A phase only does
something if a cue triggers on it. Only `party_night` has one
(`c_party_start`, `playa_default.yaml:146-157`). `philharmonic` and
`sunrise_set` drive **nothing** — they exist purely to populate
`currentPhase` in the UI and to feed the (currently unused) `whenPhase` mood
gate.

**Finding P2 — phases have no EXIT action.** `triggers.js:213-220` fires a
`phase` trigger on the **rising edge only**. Leaving a phase does nothing, so
whatever the entry cue set stays on the deck until some *other* cue fires.

### 1.3 What plays in the GAPS

This is the part most likely to surprise on playa. There are **two different
gap fillers** and which one you get depends on *how* the previous cue ended:

| Situation | What fills the deck | Code |
|---|---|---|
| Boot / plan activate with no live owner | **`defaultCue`** → look `ambient` (playlist `ambient`) | `timeline_service.js:1637-1654` |
| A cue with `durationMin` whose window **elapsed** | **`defaultCue`** → `ambient` | `:889-905` |
| A **program's `hold` expiring naturally** | **the autopilot BASELINE** → `plan.autopilot.playlist` = **`default`**, delay 45 s, shuffle | `arbiter.js:130-135` → `timeline_service.js:1585-1590` → `_applyAutopilotBaseline` `:637-653` |
| Operator taps END SHOW | `defaultCue` → `ambient` | `:2537-2564` (routes via `_establishBaselineIfActive`) |
| A no-`durationMin` deck cue (e.g. `c_party_start`) | **stays put** — it owns the deck with no expiry | `:756-780` (`_deckWindowUntilMs = null`), guard at `:856-859` |

**Finding G1 — the automatic hold-expiry path never reaches `defaultCue`.**
`_applyAutopilotBaseline()` (`:637-653`) reloads the baseline playlist and
re-pins the deck, but it does **not** clear `_deckWindowCueId` and does **not**
call `_applyDefaultCue`. `_reconcileDefaultCue` then early-returns at `:856-859`
because a no-duration owner is still latched. Net effect on the shipped plan:

> `c_visibility_on` fires at sunset−45 (kind `program`, `hold.min: 90`). At
> **sunset+45** the hold expires and the deck drops onto the **`default`
> playlist under baseline autopilot** — *not* the `ambient` playlist. It stays
> there until `c_party_start` fires at **sunset+120**.

So the concrete gap the operator asked about (sunset+60 → sunset+120) is
covered by playlist `default`, and the palette is still `sunset_coral` from the
philharmonic look (palettes are never reset — `_applyLook` `:611-630` only
writes what the incoming look declares).

**Finding G2 — the whole main night block is the `party` look.**
`c_party_start` (kind `ambient`, no `durationMin`, no hold) fires at
`party_night` entry (sunset+120) and **owns the deck with no expiry** until the
next deck cue — i.e. until `c_sunrise` at sunrise−15. That is ~8 hours of
"look: party" (playlist `default`, palette `bass_drop`, autopilot 30 s shuffle).
This is **the inverse of "ambient is dominant"**: the `ambient` playlist is
reachable today only as the `defaultCue` boot/window-elapsed filler.

### 1.4 What the `looks` block actually drives

`_applyLook()` (`timeline_service.js:611-630`) applies, in order:

1. **palette** → `_resolvePalette` (`:438-445`) maps a `colorPalettes` id to
   `colorPalette1/2` `{h,s,v}` CPC writes. **A missing palette id throws** and
   surfaces as a per-cue error.
2. **globals** → `_writeGlobals` (`:588-603`); the key `master` is special-cased
   to the **deck grand master** (`deps.setMaster`, the same path as the
   operator's master fader), everything else goes to the CPC.
3. **playlist** → loaded on every resolved target.
4. **autopilot** → `{active, delay_s, shuffle}` per target.
5. **tasks** → scheduled-task enable/disable lists.

A look may contain **only** `{playlist, autopilot, palette, globals, tasks,
target}` — validated at `show_plan.js:291-307`. **`hue`, `transition`,
`overlays` and `colorAutopilot` are NOT available on a look** — they exist only
on a `playlist`-type *action* (`show_plan.js:423-525`,
`timeline_service.js:666-695`). Relevant to authoring: if the operator wants
crossfades between phase looks or palette-cycling within a phase, the cue must
be re-authored as a `playlist` action, not a `look`.

### 1.5 Autopilot / mood / target

- **Baseline autopilot** (`playa_default.yaml:11-19`): playlist `default`,
  `delay_s: 45`, `shuffle: true`, target deck, `mood: true`. Armed/disarmed only
  on controller *transitions* (`_reconcileBaselineArm` `:1469-1478`) — flipping
  every tick would reset the advance timer.
- **`autopilot.mood: false`** is the plan-level kill switch for every mood cue
  (`arbiter.js:79`, `:177`).
- **target** resolution (`:414-430`): `deck` | `mixer`+id | `all` (deck + every
  mixer channel). A `mixer` target without an id **throws**. Every look in the
  shipped plan targets the deck.
- **Precedence** (`arbiter.js:5-12, 67-199`): `MANUAL` (operator takeover, or
  autopilot-off with no program) > `PROGRAM` (a `kind: program` cue inside its
  `hold` window) > `AUTOPILOT` (baseline cycling + mood swaps).
- A due program that lands while the deck is manual **arms a 30 s pending
  lease** instead of firing (`arbiter.js:154-164`) — the operator gets
  ENABLE/DISMISS, and it auto-starts on expiry (`:91-104`).

### 1.6 Day boundaries and `festival.startDate`

- **Day rollover:** the once-per-day `firedToday` latch resets when the tz-local
  calendar day changes (`triggers.js:185-190`). Cue *days* are therefore
  **calendar days in `America/Los_Angeles`, not "nights"** — a cue that fires
  after midnight belongs to the following index. The shipped day-6/day-7 cues
  both fire before midnight (sunset+90 / sunset+60), so this is correct as
  authored, but it is a live hazard for any future after-midnight themed cue.
- **Festival window:** `festival.js:35-43` maps today → a 0-based index inside
  `[startDate, startDate+days-1]`. **Outside that span the plan goes fully
  dormant** — `_goDormant()` (`timeline_service.js:1515-1547`) is the *earliest*
  gate in the tick (`:1887-1898`) and in `_catchUp` (`:1712-1717`): no cue
  fires, no baseline arms, no deck-pin, no takeover, `controller: 'manual'`.
- **This is the state the rig is in right now.**
  `marsin_engine/states/titanic/timeline_state.yaml` reads `controller: manual`,
  `firedToday: {}`, `currentPhase: null`. Gate day has not arrived, so **the
  timeline is asleep and cannot be observed doing anything on the bench**
  without an in-window fixture plan. A plan with **no** `festival` block is
  always in-window (`:1487-1490`) — that is the intended test escape hatch, and
  the e2e spec already documents generating a today-dated fixture at run time
  (`.agent/ops/timeline_e2e_tests.md:35-38`).
- **Boot catch-up** (`:1663-1870`) restores the latest already-passed
  clock/sun cue of *today* (respecting `catchUp` and `days`), re-anchors its
  `durationMin` window to its true past fire time (`:1753-1757`), and clears
  every runtime lease/program (`:1691-1706`) — a restart mid-evening lands in
  the right look, not at the top of the night.

---

## 2. Theme-night support

**Per-day targeting EXISTS at cue granularity; there is no per-day plan
override; and no theme playlist is wired to anything.**

- **Mechanism:** `cue.days` accepts `'all'` | an array of festival day indices |
  an array of `'YYYY-MM-DD'` strings (`festival.js:58-73`). The runtime tick
  evaluates only `applicableCues(plan, now)` (`:83-86`,
  `timeline_service.js:1944`), and the multi-day OVERVIEW resolves each festival
  day independently (`:98-165`).
- **In use:** `c_burn_night` `days: [6]` (`playa_default.yaml:189-204`) and
  `c_temple` `days: [7]` (`:205-220`). Both are `kind: program` with 120 min
  holds.
- **Operator surface:** CaptainPad's cue editor exposes a DAYS control —
  "This day | All days | Pick…" with a day-index grid
  (`components/timeline/CueEditorSheet.tsx:21, 243-347`).
- **Per-day PLAN override: NO.** One plan is active at a time; switching is a
  manual REST call (`timeline_service.js:2355-2382`, `POST
  /timeline/plan/activate`). There is no "on day N run plan X" mechanism, and
  none is needed — `days:` inside one plan covers the same ground.

**Finding T1 — the theme playlists are orphans of the show.** The looks named
after theme nights point at the wrong playlist:

| Look | Loads playlist | The obvious intent |
|---|---|---|
| `burn_night` | **`default`** | `burn_night` |
| `temple` | **`default`** | `temple_white` |
| `daytime` / `philharmonic` / `party` / `sunrise` | **`default`** | — |

Nothing anywhere references `tutu_tuesday`, `white_wednesday`,
`first_class_1912`, `deep_sea`, `iceberg_ahead`, `white_only` or `uv_test`.
There is no Tuesday/Wednesday cue at all. This is a **content gap, not a code
gap** — the machinery to do it is one `days: [n]` cue + one look per theme.

**Finding T2 — two dead looks.** `daytime` and `party_low` are defined in the
plan but referenced by no cue and no `defaultCue`
(`playa_default.yaml:43-50`, `:107-116`). `party_low` is otherwise reachable
only if the operator points `/party-config`'s playlist at it.

---

## 3. Party trigger infrastructure

### 3.1 The chain, end to end

```
mic → companion detector (config.yaml party:)  →  CPC key audioPartyStrong (0|1)
   → MoodSource (staleness guard)              →  evaluateTick mood branch
   → arbiter (controller gate)                 →  _dispatchArbitratedAction
   → look party_high (playlist from /party-config)  →  deck window durationMin
   → session end → cooldown stamp → re-arm
```

| Stage | Where | Notes |
|---|---|---|
| **Detection config** | `marsin_engine/config.yaml:106-117` | `ambientFloor 0.09`, `marginX 2.5`, kick-rate 1.2–3.2, `requireBpmLock true`, **`onSustainMs 20000`**, **`offConfirmMs 30000`** |
| Detector publish | `audio/companion/companion_server.js:316-321, 1172-1175, 1280-1281` | publishes `audioPartyStrong`; a manual **FAKE TRIGGER** override exists (`:918`, `:1791-1803`) — the trigger cannot tell it from real music (test-proven, `party_config.test.js:319`) |
| Tuning surface | `audio/companion/party_tuning.js:35-58`, `ui/companion_app.js:1627-1834` | the companion PARTY tab is where `ambientFloor`/`marginX` get calibrated |
| **Staleness guard** | `lib/timeline/mood_source.js`, config `staleSec: 10` | a frozen key is forced to CALM and surfaced as `moodStale` on `/timeline/state` (`timeline_service.js:2267-2279`) — a dead companion means ambient, loudly |
| **Trigger** | `triggers.js:221-260` | arm on `from`, fire on `to` after `minDwellSec`; `moodArmed` latches one fire per arrival |
| **Policy gate** | `triggers.js:242` | `partyEnabled === false` → skip **without** burning the arm latch or the cooldown |
| **Timing authority** | `triggers.js:246-250`, `timeline_service.js:1051-1067, 1963-1970` | `/party-config` **replaces** the plan's dwell/cooldown at evaluation time; the plan YAML seeds them **once** then is never read again |
| **Precedence gate** | `arbiter.js:174-180` | a mood cue applies **only** when `controller === 'autopilot'` |
| **Session shape** | `timeline_service.js:1084-1099` | `durationMin` from `/party-config`; a live session keeps the mode it started in |
| **Session end** | `:1352-1361` (`_notePartySessionEnd`) | one definition, called from every end path: window-elapsed (`:894-903`), superseded by another deck cue (`:765-769`), follow-the-music release (`:1115-1140`), operator disable (`:1368-1406`), dormancy (`:1522-1528`), takeover-release not-resumed (`:1809-1839`). Cooldown is stamped at **session END** and the trigger **re-arms** |
| **Persistence** | `lib/timeline_state.js:31-67`, `states/titanic/timeline_state.yaml` | live values today: `partyPlaylist: party_high`, `partyMinDwellSec: 120`, `partyDurationMin: 12`, `partyCooldownSec: 120`; `partyEnabled` unset → shipped default **armed**; toggles unset → `durationEnabled/cooldownEnabled` both **true** |
| **REST** | `api_server.js:5888-5918` | `GET/PUT /party-config`; PUT is strict all-or-nothing (unknown field / out-of-bounds / unknown playlist → 400, nothing applied) and broadcasts `partyConfig` |
| **Handling UI** | `CaptainPad/app/(tabs)/timeline.tsx:936-939, 1192-1450` + `utils/party_api.ts` | the TIMELINE tab's PARTY MODE card: gate, playlist, the three numbers with steppers, the two toggles, 700 ms debounce, live `effectiveState` |

The division of concerns the operator asked for is real and holds: **companion
= DETECTION, CaptainPad TIMELINE tab = HANDLING, engine `/party-config` =
persisted authority.**

### 3.2 Against the 2026-07-31 refinements

**"Fires from AMBIENT only" — PARTIAL, and weaker than the shipped template.**

The only gate is `arbiter.js:177`: `controller === 'autopilot'`. That is a
*control-ownership* test, not a "what is currently on the deck" test. Concretely:

- ✅ **Blocked** during a human takeover (`mode: 'overridden'` → controller
  manual), with autopilot off, and inside **any `kind: program` hold** —
  philharmonic (90 min), sunrise (90 min), burn_night (120 min), temple
  (120 min). Suppressed fires are surfaced, not swallowed
  (`timeline_service.js:1986-1992` `wouldFire`).
- ❌ **NOT blocked** while `c_party_start`'s `party` look owns the deck. That
  cue is `kind: ambient`, which leaves `controller === 'autopilot'`
  (`arbiter.js:181-186`) — deliberately, per the template's own comment
  (`show_plan.js:929-932`). Since that look owns the deck from sunset+120 to
  sunrise−15 (Finding G2), **party can fire on top of party for most of the
  night**.
- ❌ **NOT restricted to night at all.** `triggers.js:251` supports
  `whenPhase` — and the built-in template ships the party cue with
  **`whenPhase: 'party_night'`** (`show_plan.js:945`). **The on-disk titanic
  plan dropped it** (`playa_default.yaml:158-173` has `minDwellSec: 120,
  cooldownSec: 120` and **no `whenPhase`**). So today a sustained loud stereo at
  3 pm inside the festival window fires a party session.

The fix is authoring, not code: restore `whenPhase` (one line), and/or express
"ambient only" as *whatever the ambient owner is* — see the build proposal in §7.

**"Party night is VJed / automation stands down" — MISSING as a first-class
mode.** What exists:

- A **manual global gate**: `partyEnabled` via `PUT /party-config`
  (`timeline_service.js:1155-1227`), toggled from the CaptainPad card. Turning
  it off mid-session ends the session immediately and hands the deck back to
  `defaultCue` — and **never re-applies anything under a human takeover**
  (`:1392-1398`, human > operator disable > automation, exactly as required and
  test-covered: `party_session_timeline.test.js:195`).
- **Authorable per-night stand-down**: give the mood cue `days: [0,1,2,…]`
  omitting the VJ night, or `enabled: false`. Both are editable from the cue
  editor.

What does **not** exist: any automatic, plan-driven "tonight is a VJ night,
automation is off" state. The operator must remember to flip the switch — and
nothing on the timeline tab reminds him.

**"Gated to SHORT sessions" — SUPPORTED.** `durationMin: 12` persisted
(inside the 10–15 min settled model), bounds 1–120 (`timeline_state.js:41-45`),
cooldown 120 s clocked from session END, sessions repeat while the music
sustains. All of it unit-proven (`party_session_repeat.test.js:142-350`).

---

## 4. Playa-local time and postpone

### 4.1 Timezone — SUPPORTED, end to end

- **Engine:** every day/clock computation goes through `plan.location.tz`.
  `triggers.js:17-23` (`dayKeyFor`, en-CA → `YYYY-MM-DD`), `:30-43`
  (`tzOffsetMinutes`, derived by diffing formatted wall-clock vs UTC — DST-safe
  with no tz database), `:50-74` (`clockToEpochMs` / `dateClockToEpochMs`).
  `festival.js:7-9` does all span math in that tz, anchored at UTC midnight so
  DST cannot distort a day delta.
- **CaptainPad:** `app/(tabs)/timeline.tsx:84-112` reads "now" **in the plan's
  tz** via `Intl`, explicitly so the tab is correct when the operator is
  off-playa; `:368-381` resolves `planTz` from the overview → draft → device tz;
  `:385-389` picks "today" by matching the plan-tz date key. A malformed tz
  **fails to null** (no playhead) rather than silently using device time.
- **Authoring:** `components/timeline/FestivalEditor.tsx:40-47` offers a tz
  picker with **Pacific (BRC) first**; the template hard-codes
  `America/Los_Angeles` + BRC lat/lon (`timelineTemplate.ts:40-44`).

### 4.2 Postpone / shift — MISSING

There is **no postpone, snooze, shift, or pause affordance anywhere.** PAUSE and
HOLD were deliberately **removed** in the 2026-07-03 simplification
(`timeline_state.js:126`, `arbiter.js:75-78`,
`timeline_service.js:2392-2394` — "takeover is the ONLY manual interruption of a
running plan (it always auto-resumes)").

What the operator has today:

| Affordance | What it actually does | Fit for "postpone" |
|---|---|---|
| **TEMPORARY TAKE OVER** (`:2424-2452`) | freezes the plan, arms a 120 s lease refreshed by UI activity (`:2461-2467`); on release the plan **resumes at NOW** via catchUp | ✗ — auto-resumes; can't hold a phase back 40 minutes |
| **AUTO OFF** (`:2487-2535`) | disarms the baseline, releases the deck-pin, controller manual | ✗ — all-or-nothing, kills the whole plan |
| **DISMISS** a pending program (`:2618-2631`) | latches that cue `firedToday` — it will not re-arm today | ~ — *cancels* one show, cannot *move* it |
| **END SHOW** (`:2537-2564`) | ends the active program early | ~ — early, not late |
| **Edit the cue and SAVE** (`:2326-2344`) | saving over the active plan **hot-reloads** it and re-runs catchUp; the cue editor can change a sun `offsetMin` (`CueEditorSheet.tsx:145`) | ✓ but clumsy — per-cue, permanent (edits the plan file), and easy to forget to undo |

So the honest answer: **the only real "postpone" today is hand-editing each
cue's offset in the maker and saving.** There is no "shift tonight by +30 min",
no "hold the next cue", no "skip tonight's sunrise wind-down".

---

## 5. Coverage matrix — 68 patterns × 13 playlists

*(Top-level `marsin_engine/patterns/*.js` only — that is exactly what the
engine resolves: `playlist_manager.js:100-111` joins `patternsDir/<name>.js`
**non-recursively**. The `summer_camp/`, `test/`, `transitions/`,
`channel_blends/`, `examples/` subdirs are not reachable by a playlist entry.)*

### 5.1 Playlists

| Playlist | Entries | Tuned (`defaults`) | Bare | Labels | Notes | Broken entries | Referenced by |
|---|---|---|---|---|---|---|---|
| **`default`** | 72 | **6** | 66 | 0 | 0 | **45** | plan autopilot baseline + looks `daytime`, `philharmonic`, `party`, `sunrise`, `burn_night`, `temple` |
| **`ambient`** | 24 | 0 | 24 | 0 | 0 | 0 | look `ambient` = **`defaultCue`** |
| **`party_high`** | 15 | 0 | 15 | 0 | 0 | 0 | look `party_high` (the party cue) + `/party-config` playlist |
| **`party_low`** | 18 | 0 | 18 | 0 | 0 | 0 | look `party_low` — **look is dead** (no cue references it) |
| `burn_night` | 15 | 0 | 15 | 0 | 0 | 0 | **unassigned** |
| `deep_sea` | 12 | 0 | 12 | 0 | 0 | 0 | **unassigned** |
| `iceberg_ahead` | 11 | 0 | 11 | 0 | 0 | 0 | **unassigned** |
| `tutu_tuesday` | 12 | 0 | 12 | 0 | 0 | 0 | **unassigned** |
| `first_class_1912` | 10 | 0 | 10 | 0 | 0 | 0 | **unassigned** |
| `white_only` | 5 | 0 | 5 | 0 | 0 | 0 | **unassigned** |
| **`white_wednesday`** | 5 | **5** | 0 | 0 | 0 | 0 | **unassigned** |
| **`temple_white`** | 3 | **3** | 0 | 0 | 0 | 0 | **unassigned** |
| `uv_test` | 1 | 0 | 1 | 0 | 0 | 0 | **unassigned** |

**Reachable from the timeline: 3 playlists** (`default`, `ambient`,
`party_high`). **Unassigned: 9.** `party_low` is reachable only by repointing
`/party-config`.

**Only 14 of 203 playlist entries across the whole scene carry tuned
`defaults`** — 6 in `default`, 5 in `white_wednesday`, 3 in `temple_white`.
**Zero entries anywhere carry a `label` or `notes`.** The two fully-tuned
playlists are both **unassigned**.

### 5.2 Orphan patterns — 4 of 68, all deliberate

`calib_swipe_left_right`, `calib_swipe_up_down`, `test_const`,
`test_dualband`. **Every show pattern is in at least one playlist.** (`rainbow`
appears only in `default`.)

### 5.3 Broken playlist entries — 45, all in `default`

`default.yaml` names 45 patterns that live in
`marsin_engine/patterns/summer_camp/` (the Logsville / tower / forest set) and
are therefore **unreachable**: `40_ghost_ship_reveal` … `56_stage_mirror_axis`,
`63_dome_phyllotaxis_bloom`, `65_dome_kick_shockwave`, `70_…`–`85_…`,
`96_logsville_ember_storm`, `100_…`, `110_…`–`117_…`.

Behaviour today (not a crash, but not harmless):

- Load-time: each is flagged `_missing` (`playlist_manager.js:187`) and shows
  the ⚠ badge in the UI.
- Autopilot **skips** them (`autopilot_pick.js:53, 102-106`), so the deck cycles
  the 27 real entries — but the **shuffle pool is 27/72**, which distorts every
  timing intuition the operator forms from the playlist length.
- The timeline's loader only throws if **every** entry is missing
  (`api_server.js:4381-4385`), so this stays quiet.

**Net:** the single playlist that six looks and the autopilot baseline depend on
is 62% dead and 92% untuned.

---

## 6. Testability

### 6.1 Unit tests — strong

**317 tests, 317 pass**, across 14 files in `marsin_engine/tests/timeline/`:
`timeline_service.test.js` (76 KB), `timeline_arbiter`, `timeline_triggers`,
`timeline_sun`, `timeline_festival`, `timeline_show_plan`, `timeline_event_log`,
`timeline_deck_release_default_cue`, `timeline_mood_autofire`,
`mood_source_staleness`, `party_config`, `party_session_repeat`,
`party_session_timeline`, `scheduled_tasks`.

Verified command (Windows needs the glob form — a bare directory arg fails):

```bash
cd marsin_engine && node --test "tests/timeline/*.test.js"
# ℹ tests 317 · pass 317 · fail 0
```

One caveat: `timeline_deck_release_default_cue.test.js` run **alone** trips the
known Windows `node:test` worker-IPC flake ("Unable to deserialize cloned
data") because — unlike the party files (`party_session_repeat.test.js:31-33`)
— it does not mute `console.log`. It passes in the batch run. Cosmetic, but it
will bite anyone iterating on that one file.

### 6.2 Clock simulation — exists as a per-file idiom, NOT as a harness

The cores are **pure and clock-injected by design** — `triggers.js:1-8`
literally says the point is to make "the whole 'full night in seconds'
simulated-clock test possible", and `TimelineService` takes `nowFn`
(`timeline_service.js:233`). The tests exploit it: e.g.
`party_session_repeat.test.js:96-127` builds a rig with `setNow()`, `setMood()`
and fake `deps`, then calls `svc._tick()` by hand.

But that rig is **copy-pasted per test file, uses fake deps and fake playlists,
and never touches the real `playa_default.yaml`**. There is:

- **No CLI / tool** to dry-run a plan — `marsin_engine/tools/` has 20+ tools
  (audio, detection, patterns, VSN1) and **none for the timeline**.
- **No way to print "here is tonight's schedule in playa time"** without running
  the engine and reading `/timeline/overview` (which does resolve every festival
  day — `timeline_service.js:98-165` — but only over HTTP, live).
- **No end-to-end runner.** `.agent/ops/timeline_e2e_tests.md` defines 10
  scenarios (S1–S10) but its own §"Wanted: a scripted runner" (`:131-139`)
  records that the AUTO scenarios "live as throwaway scripts" — they were run by
  hand once and never committed.

**Plainly: today you cannot fast-forward a playa night. You can unit-test the
mechanism, or you can wait real hours with the engine running an in-window
fixture plan. Nothing in between.**

### 6.3 Doc drift spotted (standing fix-on-sight order)

`.agent/ops/timeline_e2e_tests.md:84` (scenario S5) asserts
`mode='paused'` — that mode was **removed** (`timeline_state.js:126`,
`arbiter.js:75-78`). S5 as written cannot pass. Flagged, not fixed (this thread
is read-only); it is a two-line correction for whoever picks up the runner.

---

## 7. GAP LIST

One line per operator requirement.

| # | Requirement | Verdict | Evidence / what's missing |
|---|---|---|---|
| 1 | **Ambient is dominant, occasional party** | **MISSING (as shipped)** | `c_party_start` puts look `party` on the deck from sunset+120 → sunrise−15 with no expiry (`playa_default.yaml:146-157`; `timeline_service.js:756-780, 856-859`); `ambient` is reachable only as the `defaultCue` boot/window-elapsed filler (`:1637-1654, 889-905`) |
| 2 | **Party auto-trigger fires from AMBIENT only** | **PARTIAL** | Gate is `controller === 'autopilot'` (`arbiter.js:177`) — blocks takeover + program holds, does **not** block the `kind: ambient` party look; and the on-disk cue **dropped `whenPhase`** that the template ships (`show_plan.js:945` vs `playa_default.yaml:158-173`), so it can fire in daylight |
| 3 | **Sessions gated SHORT (~10–15 min)** | **SUPPORTED** | `partyDurationMin: 12` persisted (`states/titanic/timeline_state.yaml`), bounds 1–120 (`timeline_state.js:41-45`), window enforced at `timeline_service.js:1084-1087, 889-905` |
| 4 | **Sustain ~2 min before trigger** | **SUPPORTED** | `partyMinDwellSec: 120`; dwell always enforced, no toggle (`triggers.js:252`, `timeline_state.js:61-63`); detector adds its own `onSustainMs 20000` (`config.yaml:116`) |
| 5 | **Cooldown, clocked from session END** | **SUPPORTED** | `_notePartySessionEnd` `timeline_service.js:1352-1361`; every end path routes through it; test `party_session_repeat.test.js:173` |
| 6 | **Human > operator-disable > automation** | **SUPPORTED** | `arbiter.js:78, 85, 119`; disable never re-applies under a takeover (`timeline_service.js:1392-1398`); precedence mirrored in `getPartyStatus().effectiveState` (`:1283-1289`); tests `party_session_timeline.test.js:195, 208` |
| 7 | **Must not catch music from across the playa** | **PARTIAL — uncalibrated** | Detector params exist and are tunable (`config.yaml:106-117`, `party_tuning.js:35-58`), but `ambientFloor 0.09` / `marginX 2.5` are **defaults, never calibrated on playa** (still Open decision 5 in the master doc) |
| 8 | **Party night is VJed — automation stands down** | **MISSING (as a mode)** | Only a manual global `partyEnabled` switch (`timeline_service.js:1155-1227`) or hand-authored `days:` / `enabled:false` on the mood cue; no plan-driven per-night stand-down, no reminder on the timeline tab |
| 9 | **Playa-local time reasoning in the app** | **SUPPORTED** | `triggers.js:17-74`, `festival.js:7-9`, `timeline.tsx:84-112, 368-389`, `FestivalEditor.tsx:40-47` |
| 10 | **Ability to POSTPONE / shift planned phases** | **MISSING** | PAUSE/HOLD removed (`timeline_state.js:126`, `arbiter.js:75-78`); only takeover (auto-resumes), AUTO OFF, DISMISS, END SHOW, or hand-edit-and-save (`timeline_service.js:2326-2344`) |
| 11 | **Preplanned program of playlists is the default operation** | **PARTIAL** | Program cues + holds + `defaultCue` all work, but 6 of 8 reachable looks load the same `default` playlist and 9 of 13 playlists are unreachable (§5.1, §2/T1) |
| 12 | **Themed nights** | **PARTIAL** | Per-day cue targeting works and is used for burn/temple (`festival.js:58-73`; `playa_default.yaml:189-220`), but the theme *playlists* are wired to nothing (T1) and there is no Tue/Wed cue |
| 13 | **Playlists record the tuned results** | **MISSING** | 14 of 203 entries carry `defaults`; 0 carry labels or notes; the two fully-tuned playlists are both unassigned (§5.1) — *ChatGPT+operator territory, measured only* |
| 14 | **Testable without waiting real hours** | **MISSING** | No dry-run tool, no committed e2e runner (`.agent/ops/timeline_e2e_tests.md:131-139`); per-file fake-clock rigs only (§6.2) |
| 15 | **Fail-loud, never stuck** | **SUPPORTED** | Missing palette/playlist/look throw and surface as per-cue errors; the tick never dies on a dispatch failure (`timeline_service.js:2029-2039`); stale mood forces CALM and is visible (`:2267-2279`); orphan-lease and orphan-override self-heals (`:1907-1936`) |
| 16 | **Bench-observable today** | **BLOCKED** | Today is outside `festival` → the plan is dormant (`timeline_service.js:1487-1490, 1887-1898`; live state `controller: manual`). Needs an in-window fixture plan before **anything** can be watched |

---

## 8. PROPOSED TEST PLAN

Ordered. Recommendations only — builds are separate threads for the coordinator
to launch. Effort is rough agent-hours.

### Phase 0 — unblock observation (do this first, nothing else works without it)

| # | Item | Who | Effort |
|---|---|---|---|
| **0.1** | **BUILD: `marsin_engine/tools/timeline_dryrun.mjs`** — a pure, offline **clock-simulation harness**. Loads the REAL `simulation/scenes/<scene>/timeline/<plan>.yaml` through `loadShowPlan`, drives `TimelineService` with an injected `nowFn` and a scripted mood track, and prints a minute-by-minute night: playa-local time, active phase, controller, which cue fired and why, **which playlist is on the deck**, and every `wouldFire` suppression. Flags: `--plan`, `--day <index>`, `--from/--to`, `--speed`, `--mood <script>`, `--ignore-festival`. All deps are recording fakes — **zero sACN, zero device traffic, no engine needed**. This is the single highest-leverage build in the whole thread: it turns every question below into a 5-second answer. | agent | **4–6 h** |
| **0.2** | **Bench fixture plan.** Confirm the documented run-time fixture recipe still works: clone `playa_default` via `POST /timeline/plans` with `festival.startDate` = today, activate, verify `inFestivalWindow: true` on `/timeline/state`, delete after. **Never commit the fixture** (`.agent/ops/timeline_e2e_tests.md:35-38`). Test on `test_bench` first — it carries a mirror of the titanic plan. | agent + operator | 1 h |

### Phase 1 — read the show back to the operator (paper + dry-run, no hardware)

| # | Item | Who | Effort |
|---|---|---|---|
| **1.1** | **Dry-run the shipped `playa_default` for a normal night and for day-6 / day-7.** Confirm on the record: the sunset+45 → sunset+120 gap runs `default` not `ambient` (G1); `party` owns the deck ~8 h (G2); `philharmonic`/`sunrise_set` phases fire nothing (P1). Show the operator the printout — this is the conversation about what the night should actually be. | agent → operator | 1 h (after 0.1) |
| **1.2** | **Ambient-vs-party arc review with the operator.** Decide: does `c_party_start` become `kind: program` with a hold? does it point at `ambient` and let only the mood cue reach `party_high`? does the sunset+45 gap get its own ambient cue with a `durationMin`? Output: an authored plan revision. | operator-led | 1–2 h |
| **1.3** | **Look → playlist re-pointing pass.** `burn_night` → `burn_night`, `temple` → `temple_white`, plus new looks + `days:` cues for `tutu_tuesday` / `white_wednesday` / `first_class_1912`. Retire the dead `daytime` look or give it a cue. | operator curates, agent applies | 2 h |
| **1.4** | **Report the `default.yaml` breakage to the ChatGPT tuning loop.** 45 of 72 entries are unreachable `summer_camp` names; the fix (regenerate against the real top-level pattern list) belongs to the playlist-curation track, **not** to an agent. Decide with the operator whether `default` stays the autopilot baseline at all. | operator | 0.5 h |

### Phase 2 — party trigger, on the bench

| # | Item | Who | Effort |
|---|---|---|---|
| **2.1** | **"Ambient only" decision + enforcement test.** Cheapest fix is authoring: restore `whenPhase: 'party_night'` on the mood cue. Stronger fix is code: gate the mood cue on *the current deck owner being the ambient/default cue*, not merely on `controller === 'autopilot'`. Dry-run both; pick one with the operator. | agent + operator | 1 h test, 2–3 h if code |
| **2.2** | **FAKE TRIGGER session walk-through, live.** Use the companion's party override (`companion_server.js:1791-1803`) — no music needed. Watch: dwell → fire → `party_high` on the deck → 12-min window → `defaultCue` reclaim → cooldown → second session. Verify the CaptainPad card's `effectiveState` tracks `armed → in_session → cooldown → armed` throughout. | operator + agent | 1 h |
| **2.3** | **Human-wins drill.** Mid-session: TAKE OVER → confirm the plan never re-applies; RESUME → confirm rejoin-not-restart (`timeline_service.js:1840-1855`). Then flip `partyEnabled` off mid-session and confirm instant hand-back to ambient. | operator | 0.5 h |
| **2.4** | **Follow-the-music mode.** Toggle `durationEnabled: false`, confirm no window, no cooldown, and release exactly one `offConfirmMs` (30 s) after the signal drops. | operator | 0.5 h |
| **2.5** | **VJ-night stand-down decision.** Options: (a) status quo — manual `partyEnabled` toggle + a loud reminder banner on the timeline tab; (b) a `days:` exclusion on the mood cue authored into the plan; (c) a new first-class plan field. Recommend **(a) + (b)**: no new schema, and the reminder is the cheap safety net. | operator decides | 0.5 h + 2 h if (a) is built |
| **2.6** | **Playa threshold calibration** (long-standing Open decision 5) — the one item that genuinely needs a real night with real ambient noise. Capture ambient P95 + party P5 via the companion PARTY tab, apply `ambientFloor` / `marginX` (`party_tuning.js:239-256`). | operator, on playa | 1 night |

### Phase 3 — postpone / shift

| # | Item | Who | Effort |
|---|---|---|---|
| **3.1** | **Design review with the operator: what does "postpone" mean?** Three candidate shapes, cheapest first: **(a) `planOffsetMin`** — one persisted runtime number added to every resolved cue/phase time, with a big "SHOW SHIFTED +45 min" banner and a one-tap reset. Touches `resolveDayTimes` only, survives restart, reversible, no plan-file edits. **(b) per-cue SNOOZE** — push one cue's `firedToday` latch forward N minutes. **(c) SKIP TONIGHT** — latch a cue fired for today without applying it (the `dismissProgram` mechanic generalised, `:2618-2631`). | operator + agent | 1 h |
| **3.2** | **BUILD the chosen shape.** (a) is the recommendation: highest value, smallest blast radius, and it is exactly "allow postponing and shit". Includes: engine field + REST + persistence, CaptainPad control + banner, unit tests, and dry-run coverage from 0.1. | agent | 6–8 h for (a) |

### Phase 4 — regression + acceptance

| # | Item | Who | Effort |
|---|---|---|---|
| **4.1** | **BUILD the committed e2e runner** the ops spec has been asking for (`.agent/ops/timeline_e2e_tests.md:131-139`): S1–S10 as one file per scenario under `marsin_engine/tests/e2e/`, shared lib for aria-clicks + REST probes + fixture setup/teardown, one entrypoint printing a PASS/FAIL table, screenshots to `.agent_renders/e2e/`. Offline-safe (vendored puppeteer). **Fix S5's stale `mode='paused'` assertion while in there.** | agent | 8–10 h |
| **4.2** | **Full-stack night rehearsal.** In-window fixture plan + engine + sim + CaptainPad (`.agent/skills/full_stack_smoke.md`), fast sunset offsets so a whole arc runs in ~20 min of wall clock. Eyes on the rig for every transition. | operator + agent | 2 h |
| **4.3** | **Mute `console.log` in `timeline_deck_release_default_cue.test.js`** so single-file runs stop tripping the Windows IPC flake (mirror `party_session_repeat.test.js:31-33`). Three lines. | agent | 15 min |
| **4.4** | **Restart-resilience drill** (S8): kill the engine mid-session and mid-program; confirm the persisted plan is both reported and *running*, the party cue boots re-armed with its cooldown intact (`timeline_service.js:305-314`), and no stuck "TAKEN OVER 0:00". | operator | 0.5 h |

### Recommended first build

**0.1, the timeline dry-run harness.** Everything above is currently blocked on
"we cannot see what the plan does without waiting for a real sunset, on a plan
that is asleep until gate day". Four to six hours buys the operator a printed
playa night on demand — and it is the tool the Phase 1 conversation about the
show's shape actually needs.

---

## 9. Hygiene notes

- No IPs, hostnames, MACs or credentials appear in this report.
- No when-by / deadline / schedule planning in this file. Festival dates are
  referenced abstractly ("gate day", "day index 6 / 7") — the literal dates live
  in `simulation/scenes/titanic/timeline/playa_default.yaml`, which is scene
  data.
- Zero writes outside this report and the two ledger docs. `git status` for
  `simulation/scenes/**`, `marsin_engine/patterns/**`,
  `marsin_engine/states/**` and `marsin_engine/lib/**` is unchanged by this
  thread (the three pre-existing state-file modifications predate it).
- The throwaway coverage script ran from the session scratchpad, not the source
  tree.
