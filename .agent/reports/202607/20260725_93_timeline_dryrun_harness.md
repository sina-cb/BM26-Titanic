# `_93` — Timeline dry-run harness: a whole playa night in seconds, offline

**Build thread.** Implements `_91` §8 Phase 0.1 — the audit's "single
highest-leverage build in the whole thread". Ships
`marsin_engine/tools/timeline_dryrun.mjs`, a committed bench fixture plan, 23
unit tests, and the two fix-on-sight doc/test items `_91` flagged.

**Scope discipline:** zero changes to `simulation/scenes/**`,
`marsin_engine/patterns/**`, any playlist, or any timeline logic
(`timeline_service.js` / `arbiter.js` / `triggers.js` / `show_plan.js` are
byte-identical). Five real bugs turned up in the demo runs — **reported here,
not fixed** (§5). Zero sACN, zero network, zero device traffic. No git
operations.

---

## 1. What it is

> **The problem, in the audit's words:** *"today you cannot fast-forward a playa
> night. You can unit-test the mechanism, or you can wait real hours with the
> engine running an in-window fixture plan. Nothing in between."*

`timeline_dryrun.mjs` is that in-between. It drives the **real** show code on an
injected fast clock and prints the night:

| Layer | What the harness uses | Not a reimplementation |
|---|---|---|
| plan load | `show_plan.js` `loadShowPlan` | the real validator/normalizer |
| the run | `TimelineService._tick()` with `nowFn` + `getMood()` injected | the real service, unmodified |
| cue evaluation | `triggers.js` `evaluateTick` | real dwell/cooldown/latch/phase-edge logic |
| precedence | `arbiter.js` `arbitrate` | real human > program > autopilot |
| sun / tz / festival | `sun.js`, `festival.js` | real DST-correct math |
| deck playlist | `PlaylistManager.load` on the real scene playlists | real `_missing` marking |
| deck pattern | `autopilot_pick.js` `pickNextAutoCycleEntry` | real shuffle/sequential + missing-skip |

Everything the service calls out to (`deps`) is a **recording fake** that
mirrors the engine's own contracts — including the fail-loud one from
`api_server.js timelineLoadPlaylistOnDeck`: a playlist whose entries are ALL
`_missing` throws, so a broken playlist breaks the dry run exactly as it would
break the show.

**Isolation.** The plan is COPIED to `~/tmp/timeline_dryrun/<run>/` before the
service ever sees a directory — so `TimelineService._loadSceneFiles`, which
writes its built-in default plan when a plan file is absent, physically cannot
touch `simulation/scenes/**`. Runtime state lands in the same scratch dir.
`--out` is refused unless it resolves under `~/tmp`.

**Files added**

| File | Why |
|---|---|
| `marsin_engine/tools/timeline_dryrun.mjs` | the harness |
| `marsin_engine/tests/fixtures/timeline/dryrun_bench.yaml` | the always-in-window bench plan (§2) |
| `marsin_engine/tests/timeline/timeline_dryrun.test.js` | 23 tests on the harness's own plumbing |

---

## 2. Usage

```bash
cd marsin_engine
node tools/timeline_dryrun.mjs --help
node tools/timeline_dryrun.mjs --list-moods
```

### The plan

| Flag | Meaning |
|---|---|
| `--scene <name>` | scene whose `timeline/` + `playlists/` to use (default `titanic`) |
| `--plan <name\|path>` | plan in that scene's timeline dir, or an explicit path (default `playa_default`) |
| `--fixture` | use the committed bench plan instead (mutually exclusive with `--plan`) |

**`--fixture` is the answer to "the plan is dormant today."** The operator's
`playa_default` carries a `festival` span and drives **nothing** outside it
(`timeline_service._goDormant`). `tests/fixtures/timeline/dryrun_bench.yaml`
carries **no `festival` block at all**, which `timeline_service.js:1487-1490`
treats as always-in-window — the engine's own documented test escape hatch, now
committed as a date-free file. It mirrors the shipped show's shape (same three
sun phases, same cue kinds, same holds, same `defaultCue`) so the structural
findings reproduce on it, and it points at REAL titanic playlists so the
playlist-health numbers are true.

### The clock — entirely independent of today's real date

| Flag | Meaning |
|---|---|
| `--date YYYY-MM-DD` | simulated playa-local start date (default: today in the plan's tz) |
| `--from HH:MM` | start wall clock (default `12:00` — noon-to-noon covers a whole night) |
| `--days N` | how many 24 h days (default 1, max 31) |
| `--to HH:MM` | stop at this clock on the LAST day (default: `--from`) |
| `--step N` | minutes of simulated time per tick, 1..60 (default 1) |
| `--allow-dormant` | run anyway where the plan is out of its festival window |

Out-of-window is a **loud refusal**, not a flat line:

```
timeline_dryrun FAILED: plan "playa_default" is DORMANT on <date> — its festival window is
<start> … <end> (8 days, tz America/Los_Angeles).
  The timeline fires NOTHING outside that window (timeline_service._goDormant), so a run
  there would print an honest but useless flat line. Pick an in-window --date, use
  --fixture (the committed bench plan has no festival block and is always in-window),
  or pass --allow-dormant to watch the dormant behaviour on purpose.
```

### The mood (party-detection) track

| Flag | Meaning |
|---|---|
| `--mood <name>` | built-in script (default `quiet`) |
| `--mood-file <path>` | YAML/JSON `{ windows: [ {from:'HH:MM', to:'HH:MM', days?:[0,1]} ] }` |

| Built-in | What it models |
|---|---|
| `quiet` | quiet night — the detector never calls party |
| `loud_stereo_1500` | a loud stereo parked next to the boat at 15:00 for 40 min |
| `night_sets` | two real DJ sets after dark (22:10–22:55, 01:30–02:20) |
| `all_night` | continuous music 21:00 → 05:00 (repeat-session stress) |

A window whose `to` is at or before its `from` wraps past midnight. An undated
window repeats every simulated day; `days: [n]` restricts it.

### Output

| Flag | Meaning |
|---|---|
| `--events-only` | print only steps that carry an event |
| `--engine-log` | include the engine's own `console.log` chatter (warnings/errors are ALWAYS shown) |
| `--out <file>` | also write the transcript to a file (must be under `~/tmp`) |
| `--seed N` | PRNG seed for the autopilot shuffle (default 1) — runs are reproducible |
| `--party-config <json>` | applied through the REAL `setPartyConfig` before the run |

Per-step line (one per `--step`), then indented event lines:

```
HH:MM │ phase │ controller │ deck owner │ playlist ▸ pattern │ autopilot │ palette │ party state
          ▶ FIRE        <cueId> "<label>"  why=<trigger>  → <action>  [kind/hold/window]
          ◆ <lifecycle label>  (<reason>, <source>)
          ✖ SUPPRESSED  <cueId> (wanted: <trigger>) — <the arbiter rule that dropped it>
          ♪ PARTY       <state> → <state> (session ends HH:MM / cooldown Ns)
```

The run ends with a summary: deck minutes by playlist, by owning cue, by
controller, by palette; cue fire counts; suppressions with reasons; party
sessions started and how each ended; and **playlist health as the engine
actually resolved it** (usable/total, load count, unreachable-entry warning).

### Worked examples

```bash
# one full playa night on the always-in-window bench plan, two DJ sets
node tools/timeline_dryrun.mjs --fixture --date <any-date> --mood night_sets

# the REAL titanic plan on an in-window festival day, quiet night, digest only
node tools/timeline_dryrun.mjs --date <in-window-date> --events-only

# does a loud stereo at 3 pm start a party? (spoiler: yes — §4.2)
node tools/timeline_dryrun.mjs --date <in-window-date> --mood loud_stereo_1500

# what if sessions were 5 minutes with a 10-minute cooldown?
node tools/timeline_dryrun.mjs --fixture --mood all_night \
  --party-config '{"durationMin":5,"cooldownSec":600}'
```

---

## 3. The two fix-on-sight items (`_91` §6.3, §8 4.3)

**(1) `.agent/ops/timeline_e2e_tests.md` — S5 asserted a deleted mode.** Fixed
under the doc standing order (`.agent/memory/doc_inconsistency_standing_fix.md`),
and the surrounding staleness cleaned up in the same pass:

- **S5 rewritten.** It asserted `mode='paused'`; `timeline_state.js:126`
  documents `mode ∈ armed | overridden` since the 2026-07-03 simplification, so
  S5 could never pass. It also drove a **DISABLE PLAN** button that no longer
  exists (`PlanLockBanner.tsx:200-204` — "DISABLE PLAN was removed"). Now an
  **AUTO OFF / re-arm cycle** with the assertions the code actually produces
  (`mode` stays `armed`, `autopilotEnabled=false`, `controller='manual'`,
  `controlLock=null`), plus a note that RESUME is the takeover hand-back, not
  the AUTO re-arm.
- **S1** no longer lists DISABLE PLAN in the banner.
- **S10** cited `setMode('paused')` and `hold()`, both deleted
  (`arbiter.js:75-78`); replaced with the stuck-state tests that exist today,
  named so they can be grepped.
- **Level table**: the `UNIT` row pointed at `tests/timeline_service.test.js`
  (the file moved to `tests/timeline/` in the 2026-07-15 reorg). A new `DRY`
  level documents this harness, and a new "Offline dry-run" section shows how
  to use it before an AUTO run.

**(2) `timeline_deck_release_default_cue.test.js` — Windows `node:test` IPC
flake.** Three-line `console.log` mute added, mirroring
`party_session_repeat.test.js:31-33`. Verified: **9/9 pass run alone**, no
truncation.

---

## 4. The two demo runs (and two more)

Four full 24 h nights at 1-minute resolution. Dates are given abstractly (the
literal festival dates live in the scene data).

| Run | Plan | Day | Mood |
|---|---|---|---|
| A | fixture `dryrun_bench` | any | `night_sets` |
| B | **real `playa_default`** | in-window (festival day 2) | `quiet` |
| C | **real `playa_default`** | in-window (festival day 2) | `loud_stereo_1500` |
| D | **real `playa_default`** | in-window (**festival day 6 — burn night**) | `all_night` |

### 4.1 Run B confirms every arc finding in `_91` — and sharpens two

```
20:15 │ philharmonic │ program  │ cue c_visibility_on │ default ▸ 04_beat_folded_helix   │ ap 90s seq  │ sunset_coral │ armed
20:16 │ philharmonic │ program  │ cue c_visibility_on │ default ▸ 05_orbital_attractor…  │ ap 90s seq  │ sunset_coral │ armed
20:17 │ philharmonic │ autopilot│ cue c_visibility_on │ default ▸ 00_golden_hour_wash    │ ap 45s shuf │ sunset_coral │ armed
          ◆ Program ended (hold expired): Exterior up at golden hour  (hold-expired, auto)
          ▶ FIRE  __autopilot_resume__  "Autopilot resumed"  why=resume
```

**Finding G1 proven.** The 90-minute hold expires and the deck lands on the
autopilot **baseline** (`default`, 45 s shuffle) — *not* the `ambient`
defaultCue. The palette stays `sunset_coral` (never reset), and the playlist
reload snaps the pattern back to entry 0.

```
21:31 │ —            │ autopilot│ cue c_visibility_on │ default ▸ 08_ocean_liner       │ ap 45s shuf │ sunset_coral │ armed
21:32 │ party_night  │ autopilot│ cue c_party_start   │ default ▸ 00_golden_hour_wash  │ ap 30s shuf │ bass_drop    │ armed
          ▶ FIRE  c_party_start "Party night ramp"  why=phase → look party playlist=default palette=bass_drop
                   [kind=ambient window=NONE (owns the deck until the next deck cue)]
…
06:11 │ sunrise_set  │ autopilot│ cue c_party_start   │ default ▸ 10_chasers           │ ap 30s shuf │ bass_drop    │ armed
06:12 │ sunrise_set  │ program  │ cue c_sunrise       │ default ▸ 00_golden_hour_wash  │ ap OFF      │ aurora       │ armed
          ▶ FIRE  c_sunrise "Sunrise wind-down"  why=sun → look sunrise …  [kind=program hold=90m]
```

**Finding G2 proven and measured:** `c_party_start` owns the deck **8 h 40 m**
(sunset+120 → sunrise−15), unbroken.

Run B summary (whole 24 h):

```
DECK TIME BY PLAYLIST
  24h00m  100%   default
DECK TIME BY OWNER
  12h35m   52%   cue c_sunrise
   8h40m   36%   cue c_party_start
   2h45m   11%   cue c_visibility_on
PARTY SESSIONS  started: 0
PLAYLIST HEALTH
  default   27/72 usable   loaded 7×   ⚠ 45 UNREACHABLE
```

Two things sharper than the audit's summary:

- **On a quiet night the `ambient` playlist gets ZERO minutes.** Not "the
  exception" — absent. Every deck-owning cue on the shipped plan is a
  no-`durationMin` cue, so `_reconcileDefaultCue` never yields the deck and the
  `defaultCue` never runs after boot. `ambient` is currently reachable in
  practice only *after a party session's window elapses*.
- **`c_sunrise` owns 12 h 35 m**, more than `c_party_start`. It fires at
  sunrise−15, holds for 90 min, and then keeps deck ownership (no
  `durationMin`) straight through the whole day until `c_visibility_on` fires
  at sunset−45. The "daytime" of the show is the `sunrise` look.

### 4.2 Run C — the 3 pm stereo fires a party session on the real plan

```
15:00 │ — │ autopilot│ cue c_sunrise        │ default ▸ 18_deep_space_lattice │ ap 45s shuf │ aurora    │ armed
15:01 │ — │ autopilot│ cue c_sunrise        │ default ▸ 09_cyclone            │ ap 45s shuf │ aurora    │ armed
15:02 │ — │ autopilot│ cue c_mood_to_party  │ party_high ▸ 01_cylon_sweep     │ ap 30s shuf │ bass_drop │ in_session
          ▶ FIRE  c_mood_to_party "Party session: sustained real music -> party_high"  why=mood
                   → look party_high playlist=party_high palette=bass_drop  [kind=mood window=12m]
          ♪ PARTY  armed → in_session (session ends 15:14)
…
15:14 │ — │ autopilot│ defaultCue (Ambient program) │ ambient ▸ …  │ ap 90s shuf │ deep_sea │ cooldown
          ◆ Party session ended (window elapsed)  (party-window-elapsed, auto)
          ♪ PARTY  in_session → cooldown (cooldown 120s)
15:16 │ — │ autopilot│ cue c_mood_to_party  │ party_high ▸ 01_cylon_sweep │ ap 30s shuf │ bass_drop │ in_session
          ♪ PARTY  cooldown → in_session (session ends 15:28)
```

**Audit gap #2 proven.** 40 minutes of daylight stereo → **three** full party
sessions in broad daylight (15:02, 15:16, 15:30), because the on-disk cue
dropped the `whenPhase: party_night` the built-in template ships
(`show_plan.js:945`). Dwell is exactly the authored 120 s. The one-line fix the
audit proposed is now testable in 5 seconds.

Run C also shows the arc a night with music actually produces:
`default` 20 h 15 m / `ambient` 3 h 09 m / `party_high` 0 h 36 m.

### 4.3 Run A — fixture, two DJ sets, repeat-session behaviour

```
21:32  ▶ FIRE  c_party_start …
22:12  ▶ FIRE  c_mood_to_party …   ♪ armed → in_session (ends 22:24)
22:24  ◆ Party session ended (window elapsed)   → deck = ambient   ♪ → cooldown (120s)
22:26  ▶ FIRE  c_mood_to_party …   ♪ cooldown → in_session (ends 22:38)
…
```

8 sessions over the two sets; every one ends `party-window-elapsed` after
exactly 12 min, cooldown clocked from session END, next session at cooldown
expiry — the settled session model, confirmed end to end. Totals:
`default` 16 h / `ambient` 6 h 24 m / `party_high` 1 h 36 m.

### 4.4 Run D — burn night, and the suppression narrative

```
20:55  ▶ FIRE  c_burn_night "Burn night spectacle"  why=sun → look burn_night …  [kind=program hold=120m]
21:02  ✖ SUPPRESSED  c_mood_to_party  (wanted: mood)
             — a program owns the deck (c_burn_night) — mood swaps are suppressed for its hold
       ♪ PARTY  armed → cooldown (cooldown 120s)
21:26  ▶ FIRE  c_party_start "Party night ramp"  why=phase → look party …   ← while c_burn_night still holds
22:56  ◆ Program ended (hold expired): Burn night spectacle
```

Per-day cue targeting works: `c_burn_night` fires only on festival day 6. But
this run is where the new bugs surfaced (§5.1, §5.3): **8 hours of continuous
music produced ZERO party sessions**, and the burn-night look was replaced 30
minutes into its own 2-hour hold.

---

## 5. NEW bugs found — REPORT ONLY, nothing fixed

All five were found by the harness on the real shipped plan. None is touched by
this thread.

### 5.1 A SUPPRESSED party fire consumes the arm latch and the cooldown — killing party for the rest of a sustained set

**Severity: high.** This is the one that costs a real party on playa.

- `triggers.js:256-259` — when the mood evaluation passes, it stamps
  `moodLastFire[cue]` and sets `moodArmed[cue] = false` **before** anything
  decides whether the fire actually plays.
- `arbiter.js:174-180` — the arbiter then DROPS that fire unless
  `controller === 'autopilot'`. Under a program hold (or a takeover) nothing
  plays.
- `triggers.js:230-233` — `moodArmed` is re-armed **only when the mood returns
  to CALM**.

So a single suppressed attempt burns the one-fire-per-arrival latch, and while
the music sustains the cue can never fire again — for the rest of the night.

**Measured (run D, real plan, burn night, `--mood all_night` = continuous
21:00–05:00):** one suppression at 21:02 inside `c_burn_night`'s 120-minute
hold → **0 party sessions** for the whole night, even after the hold expired at
22:56 and the controller returned to `autopilot`. The **same plan, same mood,
on a non-burn day** (no overlapping program) → **35 sessions**.

The code already states the correct invariant elsewhere: the operator's
`partyEnabled === false` gate at `triggers.js:242` deliberately `continue`s
**before** the latch/cooldown bookkeeping, with the comment *"disabling
suppresses the SHOW, it does not consume the trigger."* The arbiter-level
suppression violates that same rule.

**Second-order:** `getPartyStatus().effectiveState` reads `armed` for the rest
of the night, because it only looks at the cooldown stamp, not `moodArmed`. The
CaptainPad PARTY card would say ARMED all night while party is structurally
impossible.

### 5.2 catchUp into a live program hold turns the deck's pattern autopilot OFF

**Severity: medium.** Ordering bug; the live path and the boot path disagree.

`timeline_service.js:1758-1761`:

```js
if (programCaughtUp) {
  await this._disarmBaselineAutopilot();   // ← setAutopilot({active:false}) on the deck
  this.state.controller = 'program';
}
```

This runs **after** `_dispatchCue` (line 1747) already applied the program's
look — including the look's own `autopilot: {active:true, delay_s:90}`. The
disarm targets `plan.autopilot.target`, which is the same deck, so it silently
cancels what the look just asked for. The **live** fire path does the opposite
order (`_dispatchArbitratedAction:1582-1584` disarms **first**, then applies).

**Measured:** starting a run inside `c_visibility_on`'s hold →
`ap OFF`, one pattern for the full 90 min. Starting 10 minutes earlier so the
same cue fires live → `ap 90s seq`, patterns rotating. `_catchUp` runs on boot,
scene switch, `savePlan`, `resume()` and every operator-lease release — so a
restart or a takeover hand-back inside any program hold freezes the deck.

### 5.3 An `ambient` cue overwrites a running program's deck content while the program keeps precedence

**Severity: medium — latent today, sharp the moment the audit's T1 fix lands.**

`arbiter.js:181-186`: a cue that is neither `program` nor `mood` applies
whenever `controller !== 'manual'` — including while a program owns the
controller. It swaps the deck but does **not** clear `activeProgram`, so the
program keeps suppressing mood cues for the rest of its hold.

**Measured (run D):** `c_burn_night` fires at sunset+90 with a 120-min hold; at
sunset+120 the `party_night` phase cue `c_party_start` fires **on top** and
replaces the look, while the controller stays `program` until 22:56.

On the plan as shipped this is nearly invisible — both looks resolve to
`default` + `bass_drop`. But `_91` T1 recommends re-pointing `burn_night` at
its own `burn_night` playlist; the day that lands, **the burn-night show gets
wiped 30 minutes in** and the operator sees generic party content during the
burn.

### 5.4 Program looks with no `autopilot` block freeze the deck for the whole hold *(authoring, not code)*

A program dispatch carries `autopilotOff: true`, so the baseline is disarmed
first; if the look then authors no `autopilot`, **nothing re-arms it**. The
`sunrise`, `burn_night`, `temple` and `daytime` looks in `playa_default.yaml`
all lack one.

**Measured:** `c_sunrise` → `ap OFF` and `00_golden_hour_wash` alone on the boat
for the full 90 minutes from sunrise−15. Same for the 120-minute burn-night and
temple holds. Fix is one three-line block per look — operator's call whether a
held show *should* cycle.

### 5.5 The first party session permanently evicts the `party` look *(arc, extends G2)*

`c_party_start` owns the deck with no expiry, but the first mood session takes
ownership from it; when that session's 12-minute window elapses
`_reconcileDefaultCue` hands the deck to `defaultCue` (`ambient`), and
`c_party_start` never re-fires (phase triggers are rising-edge, once per
night — `triggers.js:213-220`).

So the shipped plan has **two completely different nights**:

| Night | `party` look holds | `ambient` gets |
|---|---|---|
| quiet (run B) | 8 h 40 m unbroken | **0 minutes** |
| any music (run C) | until the first session only | 3 h 09 m |

Both are defensible; neither is what the plan reads like. Worth putting in front
of the operator during the §Phase 1.2 arc review — the harness makes it a
5-second question.

---

## 6. Verification

| Gate | Result |
|---|---|
| `node --test "tests/timeline/*.test.js"` | **340 pass / 0 fail** (baseline 317 + 23 new) |
| `tests/timeline/timeline_deck_release_default_cue.test.js` run ALONE | **9 pass / 0 fail** — the Windows IPC flake is gone |
| `tests/timeline/timeline_dryrun.test.js` | **23 pass / 0 fail** |
| `npm test` (whole engine default suite) | 2395 tests, 2387 pass, **8 fail — all pre-existing**: 5 × `audio_capture` (no audio device) + 1 × `osc_listener` EACCES — both documented in `now.md` as environmental; 1 × `effects_v2_mode_page_layout` which **passes 47/47 run alone** (known full-run state pollution, `now.md` item B12); 1 × `specialty_white_uv` playlist-parity, which is operator playlist-content drift (titanic `white_only.yaml` now carries tuned defaults, studiodj's copy does not). **Zero new failures.** |
| `node --check` on all three new/changed JS files | clean |
| `git diff --check` | clean |
| `python scripts/security_check.py --all` | 6 findings, **all pre-existing MACs in `simulation/.scene_backups/` (gitignored)**; none in any file this thread touched |
| sim suite | **not run — this thread touched nothing under `simulation/`** (the plan file is opened read-only and copied to `~/tmp`) |
| `simulation/scenes/**`, `marsin_engine/patterns/**`, `marsin_engine/lib/**`, all playlists | **unchanged by this thread.** `git status` does show scene edits — they belong to the concurrent `_92` (operator-authorized TE-sign patch) and `_89` (bench mirror) threads, plus the pre-existing `marsin_engine/states/` runtime residue. This thread's entire footprint is 3 new files, 1 test file edit, 1 ops doc, this report, and the two ledgers |

**Harness unit coverage** (23 tests) targets exactly what could make a dry run
lie: day-key arithmetic across month/year boundaries; every bad flag failing
loud; span resolution anchored on the requested playa date (including a
**DST fall-back day**, where a naive `start + N×24 h` would drift the finish
clock by an hour); step-instant generation; every built-in mood script
validating; malformed mood files rejected; half-open window edges;
midnight-wrapping windows reaching past midnight; the `days:` filter; PRNG
reproducibility; event-ring draining surviving the ring shifting past its 50-cap
(identity-anchored, not length-anchored); suppression-reason mapping; step-
weighted summary arithmetic including dormant minutes and empty decks; and
three end-to-end runs — one proving the harness really drives the real service
offline with minutes conserved, one proving the out-of-window refusal, one
proving `--allow-dormant` books dormant time and fires nothing.

---

## 7. Hygiene

- No IPs, hostnames, MACs or credentials in this report.
- No when-by / deadline / schedule planning. Simulated festival days are
  referenced abstractly ("in-window date", "festival day 6"); the literal dates
  live in `simulation/scenes/titanic/timeline/playa_default.yaml`, which is
  scene data. The committed bench fixture carries **no `festival` block and no
  dates at all**.
- Writes outside this report + the two ledger docs: the three new files in §1,
  the two fix-on-sight edits in §3. Everything the harness produced at run time
  is under `~/tmp/`.
- No git operations.
