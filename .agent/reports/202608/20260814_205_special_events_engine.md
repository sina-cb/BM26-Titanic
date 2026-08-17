# _205 — SPECIAL EVENTS engine runner (Baby Reveal, playlist-driven)

Date: 2026-08-14 · Agent `_205` (Opus, implementation) · Branch
`feat/bm_readiness` (shared tree) · Design `docs/52_special_events_tab.md`
(`_197`), superseded in part by the operator's playlist-driven revision ·
Composes with `_200` (timeline authority + performance-mode passcode).

**Scope shipped: the ENGINE slice only.** The CaptainPad tab is `_206`'s slice
and is already being written against the contract in §1 below.

---

## 0. The operator's revised show, verbatim

> "assume we have only 3 playlists: baby tease, baby girl, baby boy. We start
> with the first, and have some effects like strobe, and maybe some other
> minimal effects, like flash all vintage white (shown in front of the UI
> button that starts the baby reveal). When baby reveal is going, allow 2
> buttons to enable baby pink or blue. In between there's another state, which
> is blackout. When baby is pressed, we flash all white, then enable the
> selected playlist."

This replaces `_197`'s pattern-based Baby Reveal (which drove
`132_baby_tease` / `133_baby_reveal_burst` directly on the deck). The runner is
now **playlist-driven**: a stage activates a PLAYLIST, and playlist content is
the operator's domain.

---

## 1. FINAL API CONTRACT (this is the `_206` contract)

All JSON. Every **mutation** answers `{ status: 'ok', state }` where `state` is
**byte-identical to the WS `specialEvents` frame** — one shape for the tab to
reconcile, never optimistic.

| Route | Body | Answer / refusals |
|---|---|---|
| `GET /special-events` | — | `{ shows, loadErrors }` (cheap cold seed; both fields also ride every state frame) |
| `GET /special-events/state` | — | the full runner document (§1.1) |
| `POST /special-events/arm` | `{ show }` | 200 · 404 `SHOW_NOT_FOUND` · 400 `SHOW_LOAD_ERROR` · 400 `SHOW_REQUIRED` · 400 `SPECIAL_EVENT_PLAYLIST_MISSING` (+`detail:{missing,reasons,available}`) · 409 `EVENT_ACTIVE` · 500 `ARM_FAILED` (unwound) · **401 `TAKEOVER_AUTH_REQUIRED` / `TAKEOVER_AUTH_INVALID` / 429 `TAKEOVER_AUTH_RATE_LIMITED`** in performance mode |
| `POST /special-events/fire` | `{ stageId, choiceId? }` | 200 · 409 `NO_EVENT_ARMED` · 400 `STAGE_REQUIRED` · 404 `STAGE_NOT_FOUND` · 409 `STAGE_NOT_ARMED` · 400 `CHOICE_REQUIRED` / `CHOICE_NOT_FOUND` / `CHOICE_NOT_ALLOWED` |
| `POST /special-events/quick-effect` | `{ id }` | 200 · 409 `NO_STAGE_RUNNING` · 404 `QUICK_EFFECT_NOT_FOUND` |
| `POST /special-events/extend` | — | 200 · 409 `NO_EVENT_ARMED` / `NO_STAGE_RUNNING` / `NO_COUNTDOWN` · 400 `NO_EXTEND` |
| `POST /special-events/finish` | — | 200 · 409 `NO_EVENT_ARMED` |
| `POST /special-events/abort` | — | 200 · 409 `NO_EVENT_ARMED`. **Never gated** |
| `POST /special-events/dismiss` | — | 200 · 409 `EVENT_ACTIVE` (clears the sticky `ended` card) |
| WS `{ type: 'specialEvents', … }` | — | `/ws/control`, replayed on connect, on every transition, and at 1 Hz while a show is live |

**Deviations from `_197`'s 7-route table, all additive:** `quick-effect` (the
operator's pulse buttons) and `dismiss` (the sticky ENDED card needs a clear).
Nothing was removed or renamed. `_206`'s `special_events_api.ts` was read and
already matches this table field-for-field, including `timelineLeaseHeld`.

### 1.1 State document

```jsonc
{
  "type": "specialEvents", "scene": "titanic",
  "status": "idle | armed | running | ended",
  "showId": null, "showName": null, "showColor": null, "showIcon": null,
  "stages": [ /* summarizeShow(...).stages of the ARMED show; [] when idle */ ],
  "stageIndex": null, "stageId": null,      // the stage HOLDING the rig
  "armedStageIndex": null, "armedStageId": null,  // the ONLY fireable stage
  "choiceId": null,                          // the fired variant of a choice stage
  "stageElapsedSec": null, "countdownSec": null,
  "armedAtMs": null, "startedAtMs": null,
  "timelineLeaseHeld": false,
  "endedReason": null,   // finished | aborted | panic | restore_failed
  "endedDetail": null, "endedAtMs": null,
  "lastError": null,
  "shows": [ /* summaries: id,name,color,icon,description,stageCount,stages[] */ ],
  "loadErrors": [ { "file": "torn.yaml", "id": "torn", "error": "…" } ]
}
```

Stage summary: `{ id, label, color, ceremonial, hint, kind:'action'|'choice',
choices[{id,label,color}], quickEffects[{id,label,color}],
advance:{mode:'manual'|'timed',afterSec}, extend:{label,kind:'time'|'actions'}|null }`.
Summaries deliberately carry **no** action internals.

### 1.2 Single-writer gate

While the runner holds the rig, these return **409 `SPECIAL_EVENT`**
(`{error, code, showId, status}`): `POST /set-pattern` (and `/pattern`),
`POST /deck/playlist`, `POST /deck/playlist/entry`,
`POST /deck/playlist/secondary`.

**Deviation from `_197`** (documented, deliberate): the gate is live from **ARM**,
not only from the first stage fire. ARM has already captured the look the show
will restore to, so a deck edit made after it would be silently thrown away at
FINISH — a refusal is strictly better than that.

Everything safety-shaped stays open and is asserted so: `/mixer/panic`,
`/global-effect-macros/blackout`, `/global-effect-macros/panic-stop`,
`/mixer/master/fade`, dimmers, group fixed colours, and `/special-events/*`.

---

## 2. Stage machine

```
idle ──arm──▶ armed ──fire(stage 0)──▶ running(stageIndex, choiceId?, countdown?)
                │                          │  ▲ extend / quick-effect (no advance)
                │                          │  └── fire(armed next) | auto-advance
                └────────────┬─────────────┘
                             ▼
                  ended(finished | aborted | panic | restore_failed) ──dismiss──▶ idle
```

- **Arming is the dependency.** Firing stage *N* arms *N+1*; re-firing the
  CURRENT stage is allowed (the "run it again" gesture). Anything else is
  `409 STAGE_NOT_ARMED` — the engine is the guard, not just the UI.
- **A CHOICE stage never auto-advances.** If a timed stage's countdown expires
  onto one, the runner HOLDS and says so on `lastError` rather than guessing a
  variant.
- **ARM is a transaction** — `_197`'s, in order: validate the show's playlists →
  capture `ev_prev` → record autopilot flags + master → timeline takeover →
  pattern autopilot off → colour autopilot off (only when actually running; the
  wire validator rejects an empty palette list). Any failure unwinds every
  completed step in reverse and returns the error. A refused ARM leaves nothing
  behind.
- **ONE teardown** for finish / abort / panic / timeline revocation / boot
  recovery: cancel in-flight actions → release every pulsed effect → restore
  `ev_prev` (3 s morph, **skipped for PANIC**) → restore autopilot flags →
  release the timeline. Each step individually guarded so no failure aborts the
  rest.
- **Never leave the ship dark.** If the snapshot recall throws, the reason is
  `restore_failed` AND the grand master is forced back to the pre-show value
  (or 1.0) by hand — the blackout stage's ramp is exactly what the recall was
  going to undo.
- **Restart is an abort.** `states/<scene>/special_events_state.yaml` is written
  on every transition; a boot that finds `armed`/`running` runs the restore and
  lands in `ended:aborted` ("the engine restarted mid-show").

### 2.1 Action vocabulary (v1)

| Verb | Fields | Engine internal |
|---|---|---|
| `playlist` | `playlist`, `entryId?` | `timelineLoadPlaylistOnDeck` — the same transition-aware path a timeline cue's `playlist` action uses |
| `control` | `control`, `value` \| `pulse:true` (+`pulseMs`, default 120) | `paramRouter.setChannelControl` on the deck, export name → id resolved **at fire time** against whatever pattern is live |
| `masterFade` | `target` 0..1, `durationMs` | `mixer.startMasterFade` — the `/mixer/master/fade` path. **This is the BLACKOUT verb** |
| `globals` | `set: {key: number}` | `paramCenter.set(k, v, 'special_event')`, same fail-loud contract as the timeline's `setParams` |
| `effect` | `effectId` + (`holdMs` \| `state`), or `effectId:'strobe'` + `hz?`,`durationMs` | `globalEffectsController.setEffect` / `setInvert` / `triggerStrobeBurst` |

Every action may carry `delayMs` — an **absolute** offset from the moment the
set is dispatched, validated non-decreasing so authored order is always
execution order. Zero-offset actions run synchronously (a bad one fails the
HTTP request the operator is looking at); delayed ones are scheduled and a
failure lands loudly on `lastError`.

**`pattern` is NOT a verb** and refuses with the replacement spelled out
(`use { type: 'playlist', … }`). Two reasons: the operator's model is
playlist-driven and a single-entry playlist IS a pattern plus its authored
defaults; and `/set-pattern` is a 200-line inline route block with no reusable
internal — extracting one in a tree three agents are editing was not worth the
blast radius. `_197` listed 5 verbs; this ships 5, with `playlist` in and
`pattern` out.

**Effect palette — what the machinery offers cheaply.** Whitelist:
`strobe` (frame-locked burst, self-terminating, ≤2000 ms),
`vintageWhite` (the operator's "flash all vintage white" — VintageLed heads' W
to 1.0), `blastWhite` ("flash ALL white" — RGB+W+A slammed on every fixture;
this is the reveal flash), `uvBlast`, `invert`. Everything with an envelope, a
buffer, a fogger deadman or a safety tier above WARNING stayed out of show
data. A unit test pins that all five still exist in `GLOBAL_EFFECT_LIBRARY`, so
a library rename cannot leave show data pointing at a ghost.

**Effect pulses can never latch.** Every effect the runner switches on is
tracked and force-released on every terminal transition (finish, abort, panic,
timeline revocation), independently of its own release timer.

---

## 3. Composition with `_200` (timeline authority) and the passcode

**A special event is an operator TAKEOVER.** It rides the timeline's existing
operator lease (`timelineService.takeover()`) rather than inventing a lock, and
refreshes it every tick exactly as CaptainPad does — a Baby Reveal outlives the
120 s lease window many times over.

**The plan outranks the event, and the reverse direction is never blocked.**
Nothing about `/timeline/resume`, `/timeline/autopilot` or lease release was
gated or changed. Instead the runner **watches**: each tick it asks whether the
lease it took at ARM is still held. If not, the plan resumed (or its lease was
released) and the show **ABORTS with the restore**, loudly, with
`endedDetail: "the timeline resumed and took the rig back — the show plan is
high priority"`. It never re-seizes — that is exactly the automatic
re-seizure `_200` removed from Live Touch. Detection latency ≤ ~1 s.

Chosen deliberately over adding a second `yieldLiveTouch`-style dep to
`timeline_service.js`: polling needs **zero** edits to the file `_200` owns and
other agents are in, and the runner's own tick is the natural place for it.

**A plan switched OFF does NOT end a show.** `_goDormant()` clears the takeover
lease, but per `_200` §2.2 a disabled plan drives nothing, so there is no
authority to lose. `authorityHeld()` returns true when
`timelineService.planEnabled()` is false. Asserted.

**No timeline at all** (`BM26_DISABLE_TIMELINE=1`, or out of the festival
window where `_takeover` legitimately returns no lease) → `timelineLeaseHeld:
false` and the runner monitors nothing. It records the ARM-time outcome and
enforces exactly that, never a guess.

**Performance-mode passcode.** ARM is a takeover, so it wears the SAME gate as
`POST /timeline/takeover`: `rejectTakeoverWithoutPasscode` on that one route.
Fresh `X-CaptainPad-Passcode` **every time** — a live privileged session buys
nothing (asserted). Outside performance mode the gate is inert. Every other
verb, **including ABORT**, is ungated: handing the rig back is always free.
`GET` routes stay open in performance mode — you must be able to reach the tab
to arm it.

**PANIC always wins.** `notePanic()` is fire-and-forget (never awaited) from
`POST /mixer/panic`, `POST /global-effect-macros/panic-stop`, and
`POST /global-effect-macros/blackout` **on enable only** (releasing a blackout
is not an emergency). The show ends `ended:panic` with **no** snapshot recall
and **no** master write — panic has just established a known-good LIT state and
the runner must not fight it.

---

## 4. The shipped show

`simulation/scenes/titanic/special_events/baby_reveal.yaml` — titanic only. No
`test_bench` copy: the bench has no baby playlists, so a copy there would only
ever produce an ARM refusal. The bench flow is covered by fixture shows the
test suite writes into a temp dir.

| # | Stage | Button | Fires | Advance |
|---|---|---|---|---|
| — | ARM | (show card) | `ev_prev` captured · autopilots off · timeline lease taken | — |
| 1 | `tease` | START TEASE | `playlist: baby_tease`. **Quick effects:** STROBE (6 Hz, 1200 ms) · VINTAGE WHITE (600 ms) · FLASH ALL WHITE (350 ms) · UV BLAST (800 ms). **Extend:** RESTART TEASE | manual |
| 2 | `blackout` | GO DARK | `masterFade → 0.0 over 1500 ms` | manual |
| 3 | `reveal` (ceremonial) | BABY PINK / BABY BLUE | t=0 `masterFade → 1.0 / 200 ms`; t=0 `blastWhite holdMs 900`; **t=700 ms** `playlist: baby_girl` / `baby_boy` | manual |
| 4 | `photos` | PHOTO GLOW | `masterFade → 1.0 / 2000 ms` (belt-and-braces) | manual |
| — | FINISH / ABORT | END SHOW / ABORT | `ev_prev` 3 s morph · autopilots restored · plan handed back | — |

**The flash-then-playlist ordering is authored data**, and the suite asserts it
as data: the flash starts before the playlist action, and is still up when the
swap lands, so the answer emerges out of the white rather than cutting in
beside it. Retuning is three numbers in the YAML.

The reveal's master target is a literal `1.0` (the peak moment). The pre-show
master is restored by the snapshot at FINISH/ABORT, not by the reveal.

**The blackout stage is NOT the e-stop.** It rides the grand master, which is
transient, unpersisted, and simply ramped back. `globalsState.blackout` staying
`false` through the stage is asserted.

---

## 5. ⚠ OPERATOR ACTION REQUIRED — the baby playlists point at renamed patterns

Mid-session, another thread renamed the baby patterns and the playlists were
not re-saved:

| playlist entry references | patterns/ now has |
|---|---|
| `132_baby_tease` | `132_baby_crossing_question.js` |
| `133_baby_reveal_burst` | `133_baby_rose_question.js` |
| `131_baby_reveal` | `131_baby_orbit_question.js` |

`simulation/scenes/titanic/playlists/baby_tease.yaml` has **exactly one entry**,
and it is now `_missing`, so **ARM of Baby Reveal will be refused** with:

> `show "baby_reveal" cannot be armed in scene "titanic" — "baby_tease": exists
> but has no loadable entry — its entries reference missing patterns
> [132_baby_tease]. Create, rename or re-save the playlist(s); the show runner
> never authors playlist content. Available playlists: …`

`baby_girl` / `baby_boy` still have 10 loadable entries each, so they arm — but
their FIRST entry (the reveal explosion) is missing, which means the answer
would open on `118_grand_orbit_rings` instead. That drift is reported loudly on
`lastError` at ARM rather than refused, because the show would still run.

**This is operator/playlist domain and I did not touch it** (also: the rename
thread is still in flight). The fix is to re-point the three playlists at the
new pattern names, or rename the patterns back. The ARM message names exactly
what to change.

Also new and unused by the show yet: `154_baby_girl_orbit_glow` …
`159_baby_boy_rose_glow`.

---

## 6. Files

**New:** `marsin_engine/lib/special_events/show_schema.js` ·
`marsin_engine/lib/special_events/special_events_service.js` ·
`marsin_engine/tests/special_events/{show_schema,special_events_api,special_events_timeline_api}.test.js` ·
`simulation/scenes/titanic/special_events/baby_reveal.yaml`.

**Edited (surgical, re-read immediately before each edit):**
`lib/api_server.js` (import · service construction + deps · 9 routes ·
`rejectIfSpecialEventHoldsRig` on 4 deck-content routes · `notePanic()` in the
two panic routes + blackout-enable · `ev_prev` added to the reserved snapshot
names · start/stop wiring · WS replay) · `lib/state_paths.js`
(`resolveSpecialEventsDir` + `MARSIN_SPECIAL_EVENTS_DIR`) ·
`lib/ws_topic_routing.js` (`specialEvents` → CONTROL) ·
`tests/e2e/ws_connect_replay.test.js` (`specialEvents` added to the tracked
replay-type set — see §7).

Nothing outside `marsin_engine/**` and the one scene YAML. No git operations.
No foreign in-flight edits reverted (`_200`'s uncommitted
`liveTouchForceDisarm` line in `ws_topic_routing.js` was left untouched).

---

## 7. Tests

Baseline established **before** any change, same suite set as `_200`:
`tests/effects + tests/timeline + tests/io + tests/security` → **1236 / 1236
pass, 0 fail**.

**After**, with `tests/special_events` added: **1294 / 1294 pass, 0 fail**
(= 1236 + 58 new). Zero regressions; the failing list is empty in both runs.

`tests/e2e + tests/state + tests/mixer + tests/playlist`: **867 tests, 862
pass, 5 fail** — all five are the pre-existing `dev_test_bench` `groupBits out
of sync` lint failures in `tests/mixer/all_models_load_lint.test.js` that
`_200` already recorded as another session's model-sidecar drift. Nothing here
touches `models/` or the model loader.

That run caught one real thing on the first pass, which is why it was run:
`tests/e2e/ws_connect_replay.test.js` asserts that every type replayed on
`/ws/control` is in a tracked set, so a genuinely new one forces a conscious
decision. `specialEvents` was added to `ENGINE_ONLY_TYPES` beside
`timelineState`, with a comment naming its real consumer
(`CaptainPad/hooks/useSpecialEvents.ts`, not `useEngineState.ts`).

**`show_schema.test.js` (27)** — every loud refusal by MESSAGE, not just "it
threw": bad schemaVersion; unknown top-level / action keys; non-slug id;
id ≠ filename; malformed hex accent; empty and over-long stage lists; duplicate
stage / choice / quick-effect ids; `actions` XOR `choices`; 2..4 choices;
`advance` bounds; `extend` XOR + `addSec` on a manual stage; the `pattern`
refusal naming its replacement; `control` value XOR pulse; `masterFade` bounds;
`globals` shape; unknown `effectId`; toggle `holdMs` XOR `state` + bounds;
strobe burst caps + hz default + wrong-family keys; **backwards `delayMs`**;
every `EVENT_EFFECT_ID` still in `GLOBAL_EFFECT_LIBRARY`; library scan
(good + two distinct broken files, missing dir is not an error); and the
shipped titanic show asserted as data (stage order, the three playlist names,
blackout = masterFade 0, flash-before-playlist on BOTH variants, quick-effect
palette, no action internals in the summary).

**`special_events_api.test.js` (28)** — a real engine, `--dest 127.0.0.9`, port
7420-7479, all three dirs redirected to temp: library + named load error;
broken show unarmable; unknown show 404; **missing-playlist ARM refusal naming
what exists**; ARM transaction (snapshot, reserved name refused, autopilot off,
deck content unchanged); `EVENT_ACTIVE`; out-of-order `STAGE_NOT_ARMED`;
unknown stage 404; tease fires its playlist; **the four deck routes 409
`SPECIAL_EVENT`**; safety routes stay open; quick-effect pulses and releases
itself without advancing; strobe burst carries an end frame and ends; unknown
quick effect 404; action-extend; **blackout reaches master 0 without latching
the e-stop**; choice required / unknown; **THE REVEAL ordering asserted at the
millisecond level** (flash up + deck NOT yet swapped → master back up → answer
playlist → flash releases); re-fire current; FINISH restore (playlist, master,
autopilot re-armed, deck routes open again); sticky ENDED + dismiss; every verb
refused with nothing armed; timed countdown + repeatable `+addSec` + manual
pre-empt; unattended auto-advance; ABORT restore from mid-blackout (master
comes back up); **PANIC: `ended:panic`, no snapshot recall, effects released**;
e-stop blackout ends a show; **restart mid-show → boots restored,
`ended:aborted`, breadcrumb cleared**.

**`special_events_timeline_api.test.js` (3)** — the timeline e2e harness (real
plan, black-holed sACN, ports 7700-7900): RESUME is accepted and the event
aborts with the restore and never re-seizes; a plan switched OFF does not end a
live show; **performance-mode ARM refuses with no passcode / a wrong passcode /
a valid SESSION token, authorises for each of the three named principals with a
fresh passcode per attempt, ABORT is never gated, and no passphrase appears in
the engine's output.**

Ports: 7420-7479 and 7700-7900 only. Nothing touched 6966-6972, 5568, 8081 or
10000. Every spawned engine's sACN went to the black hole.

---

## 8. Notes for `_206` (UI) and follow-ups

1. **`ev_prev` is visible in `GET /mixer/snapshots`.** It is reserved against
   manual saves (400 `SNAPSHOT_NAME_RESERVED`, same rule as
   `performance-preshow`) but it is NOT filtered out of the list, because
   `performance-preshow` is not either and inventing a one-off filter would be
   the inconsistency. The SnapshotBar should hide names starting `ev_`.
2. **`state.stages` duplicates the armed show's entry in `state.shows`.** Both
   come from the same `summarizeShow()` call so they cannot drift; use whichever
   is convenient.
3. **The `control` verb ships unused by Baby Reveal** (the rewritten
   `132_baby_crossing_question` runs indefinitely and exports no
   restart/replay trigger). It is exercised by the schema suite and is there for
   the next show.
4. **Code reaches the live stack only at the next engine restart** — the runner
   is constructed at `startApiServer` and started on `listen`.
5. **Two `_206` findings actioned in the show YAML** (their §4): `icon: gift`
   was **removed** — CaptainPad's `IconSymbol` map has no such glyph, so it was
   dead data pointing at a blank; and the reveal buttons now read
   **`BABY PINK` / `BABY BLUE`**, the operator's own words, instead of `_197`'s
   `IT'S A GIRL` / `IT'S A BOY`. Both are one-line show-data edits; the choice
   **ids** stay `girl` / `boy` (they are what bind to `baby_girl` / `baby_boy`),
   so no client code is affected.
6. **Overlapping older path, for the operator to settle:**
   `CaptainPad/components/timeline/baby_reveal_confirmation.ts` still fires
   `c_baby_reveal_pink` / `c_baby_reveal_blue` as TIMELINE cues. That is the
   pre-Events-tab route to the same moment. Neither `_205` nor `_206` touched
   it; it should be retired once the Events tab is the way this is run, or the
   two will disagree about who owns the reveal.
7. Open `_197` questions still for the operator: tab name/icon, whether PHOTO
   GLOW earns its own stage, and whether `ev_prev` should also be kept as
   `ev_prev_last` for a one-tap undo of the restore.
