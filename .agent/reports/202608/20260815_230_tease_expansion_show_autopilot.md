# _230 — Show autopilot: deck pattern rotation, scoped to a special-event stage

**Branch:** `feat/bm_readiness` (recorded at start). **No git operations were
run.** Nothing was bound, started or killed on the operator's 6966-6972 / UDP
5568 band; the only contact with the live stack was a single read-only
`GET /special-events` on :6968. Offline engines ran on **17233** (17230 was
occupied by another session's `serve`), always `--dest 192.0.2.x` (TEST-NET-1),
with state / playlists / shows redirected into temp dirs.

---

## 0. Scope change, mid-flight

The brief opened with two halves: (A) author 6+ new tease patterns to take
`baby_tease` past 20, and (B) the show autopilot controls.

Partway in, the operator changed A, verbatim: *"don't add baby_tease patterns,
just give me the infra for it, I will ask chatgpt for the patterns themselves
and tuning them"*.

I had written two of the six (`46_tease_checkerboard_morph`,
`47_tease_ripple_interleave`). **Both were deleted** — untracked, never
committed, no residue. `patterns/baby/` was back to 45 files immediately.

A became **infrastructure only**; B became the priority and is complete.

> While I worked, a pattern author landed **35 new files** (tease `46-50`, boy
> `51-65`, girl `66-80`), so the directory is now 80. That is not my work. My
> parameterized suites cover it and report on it in §5 — the numbers there are a
> snapshot of a set that was still being edited as I measured it.

---

## B. THE SHOW AUTOPILOT (the operator's ask)

> *"an auto transition between those patterns that I can set the timer for in
> the UI use crossfade for the transitions or actually in the UI allow full auto
> pilot controls that I can set to change how fast the patterns change (give me
> the deck auto pilot settings exactly no color)"*

### B1. The mechanism — one daemon, not two

A special-event **stage** may now author an `autopilot:` block, and while that
stage holds the rig the runner drives **the deck's own pattern-autopilot
daemon** with it (`lib/autopilot.js` + `deckTransitionConfig`), through the same
internal a timeline cue uses (`timelineSetAutopilotOnDeck` /
`timelineSetDeckTransition`).

That choice is the whole design. The alternative — a private timer inside the
show runner — would have raced the deck daemon for the same deck channel. The
existing daemon already: waits out each swap before rescheduling (so a 20 s
cadence with a 2 s crossfade is `show 20 s → fade 2 s → next`, never
overlapping), refuses an overlapping transition with EBUSY, generation-guards
every state change so a paused tick cannot fire late, and pre-warms the next
pattern. Re-implementing that inside the runner would have been a second, worse
copy of it.

Consequences that fall out for free: the cadence countdown on this card is the
**same clock** the deck's own card shows (`autopilot.nextSwapAtMs`), and a
rotating tease stage is indistinguishable from the operator working the deck by
hand — same broadcasts, same persistence.

**Engine-side, per the deadman rule.** No tab-side timer drives the rig. An iPad
that sleeps mid-tease changes nothing.

### B2. What the operator gets — "the deck settings exactly, no colour"

The tab renders the deck's own `<PatternAutopilotPanel>` **verbatim** — not a
lookalike. Same component, same cadence pills, same nested DECK TX row:

| Control | Wire field | Bounds |
|---|---|---|
| PLAY / PAUSE | `active` | — |
| SWITCH EVERY (cadence pills 1 s…3 m) | `everySec` | 1 … 3600 s |
| SHUFFLE | `shuffle` | — |
| GROUP + SIZE / DWELL | `groupMode` / `groupSize` / `groupDwell` | 2-8 / 1-50 |
| DECK TX ON-OFF | `transition.enabled` | — |
| STYLE (CROSSFADE, DISSOLVE, IRIS, …) | `transition.mode` | `trans_*` |
| CROSSFADE TIME | `transition.durationMs` | 50 … 30000 ms |
| SHUFFLE STYLE | `transition.shuffle` | — |
| next-swap countdown | `nextSwapAtMs` (read-only) | — |

**COLOUR is absent by construction**, not hidden: no colour field exists on the
wire, and the runner keeps the colour autopilot disarmed for the whole show (the
Baby families are hard-coded RGB — a palette write would hand the reveal's
colour away). The **PROFILE** dropdown is also omitted: profiles carry an
attach/detach lifecycle the show runner does not own. Flagged in §7.

### B3. Authored defaults + live override, and the way back

```yaml
- id: tease
  autopilot:
    active: true
    everySec: 20
    shuffle: false
    transition: { enabled: true, mode: trans_crossfade, durationMs: 2000 }
```

Added to the tease stage of
`simulation/scenes/titanic/special_events/baby_reveal.yaml` — and **only** that
stage, deliberately (§B4).

`POST /special-events/autopilot { active?, everySec?, shuffle?, groupMode?,
groupSize?, groupDwell?, transition? }` retunes it live. The patch is **sparse**
(only the knob that moved is sent, so setting `durationMs` cannot silently clear
`mode`), it applies immediately, and it is **remembered per `showId/stageId`
across runs** — the operator tunes the tease at the rail and next night's show
starts there. `{ reset: true }` drops the override and returns to the show file;
the tab shows a "Tuned live" strip with a **SHOW DEFAULT** button whenever an
override is in force, so the YAML can never quietly become a lie.

Answers `{status:'ok', state}` and rides the existing WS `specialEvents` frame —
**no new WS type**, one shape to reconcile, per the existing route grammar.

### B4. The three things that make it safe on the night

1. **`supported` is not `active`.** A stage that authors no `autopilot:` key at
   all gets **no card** and the runner forces rotation **off** while it holds. A
   blackout must not keep swapping patterns behind a dark ship. A stage that
   authors `active:false` DOES get the controls, parked, so the operator can
   start rotation from the tab.
2. **Handover is stop-first.** `fire()` stops the previous stage's rotation
   *synchronously, before a single action of the new stage lands* — otherwise a
   tease swap timer armed against the tease playlist could fire on top of the
   blackout. The new cadence arms only after the stage's **last** authored
   action: the reveal activates its playlist at +700 ms under a white flash, and
   arming at t=0 would start the timer against the playlist about to be replaced.
3. **The restore is exact.** ARM now snapshots the operator's **whole** deck
   autopilot block (`active`, `delay_s`, `shuffle`) and the **whole** deck
   transition config; FINISH/ABORT/PANIC put all of it back. Previously only the
   on/off flag was restored — which was correct when the runner only ever turned
   the autopilot *off*, and would have left the operator's deck cycling on the
   tease's 20 s timing now that it writes cadence too. Rotation also stops
   *before* the 3 s restore morph, so a swap cannot fight it.

### B5. Files

| File | Change |
|---|---|
| `marsin_engine/lib/special_events/show_schema.js` | `autopilot:` stage block + `validateStageAutopilot` / `validateAutopilotPatch` (one contract for authored and live), bounds mirroring the deck's, carried on `summarizeShow` |
| `marsin_engine/lib/special_events/special_events_service.js` | rotation lifecycle (`_resolveStageAutopilot`, `_armRotation`, `_stopRotation`, `_scheduleRotationArm`), `setAutopilot()`, persisted overrides, full ARM snapshot + exact restore, `autopilot` on the wire |
| `marsin_engine/lib/api_server.js` | 3 new deps (`getPatternAutopilot`, `getDeckTransition`, `setDeckTransition`), `setPatternAutopilot` boolean → full state object, `POST /special-events/autopilot` |
| `simulation/scenes/titanic/special_events/baby_reveal.yaml` | tease stage `autopilot:` defaults |
| `CaptainPad/utils/special_events_api.ts` | autopilot types, parsers, `setSpecialEventAutopilot` / `resetSpecialEventAutopilot`, 2 refusal codes |
| `CaptainPad/hooks/useSpecialEvents.ts` | `setAutopilot` / `resetAutopilot` actions |
| `CaptainPad/app/(tabs)/special_events.tsx` | `StageAutopilotCard` reusing `<PatternAutopilotPanel>` + the SHOW DEFAULT reset strip |

---

## A. THE INFRA (what makes the >20 expansion trivial)

### A1. The filename is the contract — the range table is gone

`baby_color_contract.test.js` filed patterns by a hardcoded number-range table
(`01-15 tease, 16-30 boy, 31-45 girl`, anything else a throw). That table has to
be edited for every expansion block — and it *did* throw the moment the author's
`51_boy_keel_breath` landed.

It is now **derived from the name**: `<NN>_<family>_<concept>.js`, parsed by one
regex. Any block layout works with zero test edits.

Everything else followed from the same principle:

| Was | Now |
|---|---|
| `assert.equal(IDS.length, 45)`, 15/15/15 | shape assertions: boy and girl stay **equal**, no family below its floor, no duplicate numbers, every file parses |
| twins paired by `girl === boy + 15` | paired by **shared concept** (`57_boy_hull_constellations` ↔ `72_girl_hull_constellations`) — survives any numbering |
| playlist `entries.length === 15` | `=== ids.length` for that family, **derived from disk** |
| manifest "exactly the 45 ids" | exactly the ids on disk, whatever the count |
| gallery `items.length === 15` | `=== playlistEntryCount(name)`, read from the source playlist YAML |
| `^baby/\d\d_` | `^baby/\d\d+_` (three-digit-safe) |

Floors (`MIN_TEASE` / `MIN_PAIRED` = 15) stop a silent *shrink*; there is no
ceiling and no target.

### A2. Manifest + gallery — confirmed zero code changes needed

- **Manifest:** `baby` is already a registered directory in
  `simulation/server/pattern_manifest.cjs`; the manifest is generated from disk,
  so a new `baby/NN_…` needs no code edit — only a regeneration. (Confirmed by
  `_234`, which landed the 29 unregistered ids while I worked; the sim's
  `pattern_manifest` suite is **6/6 green** on the current tree.)
- **Gallery:** `generate.mjs` already walks subdirectories, resolves qualified
  ids, and sanitises the `/` for media filenames only. Verified — the gallery
  suite is green with counts now derived.

### A3. `marsin_engine/patterns/baby/README.md` (new)

The author-facing recipe: the naming rule, the five steps (name → write →
register → add to **both** playlist copies → regenerate gallery), a table of
every enforced contract *with the reason it exists*, the measured animation and
distinctness floors, the exact manifest-regeneration one-liner, the gates to
run, and an explicit list of what is deliberately **not** enforced (count,
numbering layout, rotation timing — that last one is show data now, §B3).

---

## 5. Verification

### New — the offline rotation proof
`marsin_engine/tests/special_events/special_events_autopilot_api.test.js`,
**13/13 pass**. A real engine subprocess, port 17233, `--dest 192.0.2.x`. It
pins arming, live retune, handover, restore and memory — and, underneath, the
thing a unit test cannot fake:

- **the deck pattern advances on its own** with rotation armed, on the engine's
  clock, with no request made between the first read and the assertion;
- a live `everySec: 17` shows up on the **deck's own** `GET /autopilot`, and
  `transition.durationMs: 4500` on `GET /deck/transition-config` — the tab is
  not being told a story;
- FINISH restores a deliberately specific pre-show deck (`delay_s 55`, shuffle
  on, `trans_iris` @ 7000 ms) **exactly**;
- 8 refusals land by name, never clamped, and none of them moves the rig.

> One test-design note worth keeping: my first draft leaked persisted overrides
> between cases (a PAUSE in one test became the next test's starting state). The
> *feature* was right; the tests were reading leftovers. `armAndFire` now resets
> on entry, and the one test that is *about* the memory passes `reset:false`.

### Suites
| Suite | Result |
|---|---|
| `special_events_autopilot_api.test.js` (new) | **13/13** |
| `special_events_api.test.js` | **28/28** |
| `show_schema.test.js` | **27/27** |
| `special_events_timeline_api.test.js` + `baby_reveal_sequence.test.js` | **8/8** |
| `simulation/tests/pattern_manifest.test.js` | **6/6** |
| `playlist_gallery_tool.test.mjs` | **all green** (counts now derived) |
| CaptainPad `vitest run` (full) | **75 files, 1491 pass, 0 fail** (+7 new autopilot tests) |
| CaptainPad `tsc --noEmit` / `eslint` | **clean** |

### `baby_color_contract.test.js` — 6 pass / 4 fail, and the 4 are real
The shape, compile-on-both-rigs, crossing, byte-identical-playlists, retired-name
and manifest tests all pass. The 4 reds are **findings about the newly authored
patterns 46-80**, produced by the parameterized suite doing its job:

1. `57_boy_hull_constellations` vs `72_girl_hull_constellations` **differ by more
   than their colour constants** — the twins have drifted.
2. `59_boy_cathedral_ribs` **barely animates** — peak delta 18 against a floor of
   40 (and its girl twin will follow).
3. `66_girl_keel_breath` vs `72_girl_hull_constellations` are **near-duplicates**
   (0.94 against a floor of 1.5).
4. **`baby_tease.yaml` carries 15 entries but the tease family on disk has 20** —
   patterns 46-50 were never added to the playlist, so the ship cannot show them.

These are the pattern author's to close (steps 2 and 4 of the README). They moved
between my runs — the files were being edited as I measured — so treat the exact
names as a snapshot and re-run the suite. **Not mine, and not regressions:** the
same suite is green on 01-45.

### Screenshots — `~/tmp/fix_230/`
Fresh `dist` (rebuilt this session) on **:7167**, never :6967, console muted
before boot, one tab, `API_BASE` pointed at my offline engine on 17233.

- **`special_events_autopilot.png`** — AUTOPILOT PATTERNS under the live START
  TEASE stage: countdown `0:18` ticking, PAUSE lit, `20s` selected, DECK TX ON /
  CROSSFADE / `2s`, SHUFFLE + GROUP + SHUFFLE STYLE. GO DARK, THE REVEAL and
  PHOTO GLOW draw **no card**. No colour control anywhere.
- **`special_events_autopilot_tuned.png`** — after a live
  `{everySec:5, transition:{durationMs:3000}}`: `5s` and `3s` selected,
  countdown `0:03`, and the "Tuned live — the show file says something
  different" strip with **SHOW DEFAULT**.

**The gallery screenshot in the brief (`tease gallery page with 21+ items`) was
not taken and could not be:** the tease playlist is still 15 entries (finding 4),
and authoring the patterns that would fill it was removed from my scope.

---

## 6. LIVE RELOAD IS REQUIRED — read this before the next show

**Yes, and it is not optional.** The running engine on :6968 is executing the
**old** `show_schema.js`, whose `STAGE_KEYS` has no `autopilot` — and that
validator refuses unknown keys by design. The new
`baby_reveal.yaml` on disk therefore **will not load on the currently-running
engine**.

Right now it is fine: I confirmed by read-only `GET /special-events` on :6968
that the live engine still lists `baby_reveal` with **no load error**, because it
parsed the file at boot and holds that in memory.

**The hazard is a reload without a restart.** Anything that calls
`reloadLibrary()` on the *old* process — a scene switch, a library re-scan —
turns Baby Reveal into a red "WILL NOT LOAD" card mid-evening. Restart the engine
(code + YAML move together) and it is correct.

---

## 7. Follow-ups (deliberately not done)

1. **The four `baby_color_contract` reds** (§5) — the pattern author's, README
   steps 2 and 4. Finding 4 (playlist at 15 vs 20 on disk) is the one that costs
   the show looks it already has.
2. **`test_bench` has no `baby_reveal.yaml`** — only `wedding_program.yaml`. The
   Baby show is titanic-only on disk, so the autopilot defaults live in one file.
   Worth deciding whether the bench should carry a copy for rehearsal.
3. **The autopilot PROFILE dropdown is omitted** from the show card. An
   audio-reactive tease advance would be lovely; it needs a profile
   attach/detach dep the runner does not own.
4. **Only the tease stage authors rotation.** If the photo hold should also
   drift between looks, that is a three-line YAML edit — no code.
5. **A pre-autopilot `special_events_state.yaml`** stores
   `priorPatternAutopilot` as a bare boolean. Handled explicitly and loudly
   (cadence cannot be recovered from it), but it self-heals after one clean run.

## 8. Residue

Engine runtime state under the temp dirs only; nothing written to
`simulation/scenes/**` beyond the intended `baby_reveal.yaml` edit, and nothing
to `marsin_engine/states/**`. One orphan test engine from an earlier run of my
own suite (port 17231, `--dest 192.0.2.x`) was identified by command line and
killed; port 17233 released at teardown. `CaptainPad/dist/` was rebuilt — it is a
build output and another session is serving it on :7167.
