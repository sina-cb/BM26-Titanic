# `_98` — Timeline bugfix wave: the seven `_93`/`_95` findings, fixed

**Build thread.** Fixes the timeline logic bugs the `_93` dry-run harness found
on the shipped plan and the two truths `_95` pinned rather than fixed. Every fix
carries a BEFORE and AFTER `timeline_dryrun.mjs` transcript on the **real**
`playa_default` plan.

**Scope discipline:** engine-side only. **Zero** changes to
`simulation/scenes/**` (the operator's plan is opened read-only and copied to
`~/tmp` by the harness), `marsin_engine/patterns/**`, any playlist, or the `_95`
REST surface S3/S4 are building against — the only wire change is two ADDITIVE
fields (`planWarnings` on `/timeline/state`, `triggerArmed` on the party status).
Zero sACN, zero network, zero device traffic, no running engine. No git
operations.

| Gate | Result |
|---|---|
| Engine timeline family | **407 / 407 pass, 0 fail** (baseline 387 → +20 new) |
| Full `marsin_engine` suite | 2 459 tests, 2 449 pass, **10 fail — 8 pre-existing/environmental + 1 parallel-load flake + 1 caused by a CONCURRENT thread's `config.yaml` edit (§8)**; zero caused by this thread |
| Security check (`--all`) | 6 findings, **all pre-existing MACs in gitignored `simulation/.scene_backups/`** — none in any file this thread touched |
| Simulation suite | not run — **nothing under `simulation/` was touched** |

**Headline numbers, real plan, 1-minute resolution:**

| Scenario | BEFORE | AFTER |
|---|---|---|
| Burn night + continuous music — **party sessions** | **0 all night** | **27** |
| Burn night + continuous music — **`ambient` deck time** | 0 h 00 m | **13 h 36 m (57 %)** |
| Quiet night — **`ambient` deck time** | **0 h 00 m** | **12 h 20 m (51 %)** |
| Restart inside a program hold | `ap OFF`, one pattern for the whole hold | `ap 90s seq`, patterns rotating |
| Music night — the phase ramp's deck time | 0 h 40 m (evicted by session 1) | 7 h 04 m (returns after every session) |

---

## 1. Files

| File | Change |
|---|---|
| `marsin_engine/lib/timeline/triggers.js` | **+** `snapshotMoodBookkeeping` / `rollbackMoodFire` (fix 1). The evaluator itself is unchanged |
| `marsin_engine/lib/timeline/arbiter.js` | ambient/other cues gated on `controller === 'autopilot'` (fix 3) |
| `marsin_engine/lib/timeline/show_plan.js` | **+** `lintShowPlan` (fix 4) |
| `marsin_engine/lib/timeline/resolve_deck_state.js` | an EXPIRED program hold owns nothing; **+** `restored.holdExpired` (fix 7) |
| `marsin_engine/lib/timeline/timeline_service.js` | fixes 1, 2, 4, 5, 6, 7 (details below) |
| `marsin_engine/tools/timeline_dryrun.mjs` | suppression-reason wording now names the cue KIND (fix 3 made ambient cues suppressible) |
| `marsin_engine/tests/timeline/timeline_plan_lint.test.js` | **NEW** — 8 tests (fix 4) |
| `marsin_engine/tests/timeline/timeline_precedence_ambient.test.js` | **NEW** — 12 tests (fixes 1, 2, 3, 5, 6, 7) |
| `marsin_engine/tests/timeline/timeline_resolve_deck_state.test.js` | 3 pinning terms flipped from pin-the-bug to assert-the-fix (§7) |

---

## 2. FIX 1 — a suppressed party fire consumed the arm latch and the cooldown

**Severity: high — this one cost a real party on playa.** (`_93` §5.1)

**Root cause.** `triggers.js` is PURE, so it cannot know whether the arbiter will
let a mood fire drive the lights: it stamps `moodLastFire` and clears
`moodArmed` at EVALUATION time. `arbiter.js` then drops the fire unless
`controller === 'autopilot'`. `moodArmed` re-arms only on a return to CALM — so
one suppressed attempt inside a program hold burnt the one-fire-per-arrival latch
and, while the music sustained, the cue could never fire again that night. The
code already stated the correct invariant next door: the operator's
`partyEnabled === false` gate deliberately `continue`s **before** the
bookkeeping, *"disabling suppresses the SHOW, it does not consume the trigger."*

**Change.** The SERVICE — the only layer that knows what actually played —
snapshots both maps before `evaluateTick` and rolls them back for every mood fire
the arbiter dropped (`snapshotMoodBookkeeping` / `rollbackMoodFire`, exported
from `triggers.js` so the invariant lives beside the code that commits it). A
fire that IS dispatched is bookkept exactly as before.

Because the trigger now stays armed it legitimately re-asks on every tick (that
is what makes party start the instant a hold ends), so the `wouldFire` ring
became **edge-only**: one entry per continuous suppression episode, not one per
second. Before the fix the ring was self-limiting only by virtue of the bug.

**Second-order — `getPartyStatus` told the truth?** It read `armed` all night
while party was structurally impossible, because it only looked at the cooldown
stamp. With suppression no longer consuming the latch, `armed` is now truthful.
The raw latch is additionally exposed as `triggerArmed` so a client can be exact
rather than infer. **No new `effectiveState` value was introduced** —
CaptainPad's `parsePartyConfig` THROWS on an unknown one, so the six-value enum
is deliberately untouched.

**BEFORE** — real plan, burn night (festival day 6), `--mood all_night`
(continuous 21:00 → 05:00):

```
21:02 │ — │ program  │ cue c_burn_night │ default ▸ … │ ap OFF │ bass_drop │ cooldown
          ✖ SUPPRESSED  c_mood_to_party  (wanted: mood)
                 — a program owns the deck (c_burn_night) — mood swaps are suppressed for its hold
          ♪ PARTY  armed → cooldown (cooldown 120s)
21:04 │ …  ♪ PARTY  cooldown → armed          ← the card says ARMED for the rest of the night
22:55 │ …  ◆ Program ended (hold expired): Burn night spectacle
                                              ← and nothing happens. Ever.
PARTY SESSIONS  started: 0        23h58m party state armed
```

**AFTER** — same date, same mood, same seed:

```
21:02 │ — │ program  │ cue c_burn_night │ default ▸ … │ ap OFF │ bass_drop │ armed
          ✖ SUPPRESSED  c_mood_to_party  (wanted: mood)
                 — a program owns the deck (c_burn_night) — mood swaps are suppressed for its hold
22:55 │ party_night │ autopilot│ cue c_mood_to_party │ party_high ▸ 01_cylon_sweep │ ap 30s shuf │ bass_drop │ in_session
          ◆ Program ended (hold expired): Burn night spectacle  (hold-expired, auto)
          ▶ FIRE  __default_cue__  "Ambient program"  why=hold-expired
          ▶ FIRE  c_mood_to_party  …  why=mood  [kind=mood window=12m]
          ♪ PARTY  armed → in_session (session ends 23:07)
PARTY SESSIONS  started: 27       ended: 27 × party-window-elapsed
SUPPRESSED  1 × c_mood_to_party   ← ONE entry for the whole 113-minute episode
```

**0 sessions → 27**, and the first one starts on the exact tick the hold ends.
(The `_93` control — same plan and mood on a non-burn day, where nothing
suppresses — was 35; 27 is that arc minus the two hours the burn show legitimately
owns.)

**Tests:** `timeline_precedence_ambient.test.js` — *"a mood fire the arbiter
drops burns neither the arm latch nor the cooldown"* (asserts the latch, the
stamp, `triggerArmed`, the single wouldFire entry, and that party resumes at the
hold's end) and *"a mood fire the arbiter ACCEPTS still consumes the latch +
cooldown"* (the rollback must be surgical).

---

## 3. FIX 2 — catchUp disarm order froze the deck for a whole hold

**Severity: medium — ordering bug; the boot path and the live path disagreed.**
(`_93` §5.2)

**Root cause.** `_catchUp` ran `_disarmBaselineAutopilot()` **after**
`_dispatchCue` had already applied the caught-up program's look — cancelling the
`autopilot` block that look had just asked for, because the disarm targets the
same deck. The LIVE fire path does the opposite order
(`_dispatchArbitratedAction`: `autopilotOff` → apply). `_catchUp` runs on boot,
scene switch, `savePlan`, `resume()` and every operator-lease release, so a
restart or a takeover hand-back inside any program hold froze the deck.

**Change.** Disarm first, then dispatch — the live path's order. The
`controller = 'program'` assignment stays where it was.

**BEFORE** — restart at 19:30, inside `c_visibility_on`'s 90-minute hold:

```
19:30 │ philharmonic │ program │ cue c_visibility_on │ default ▸ 00_golden_hour_wash │ ap OFF │ …
19:35 │ … │ default ▸ 00_golden_hour_wash │ ap OFF │
20:15 │ … │ default ▸ 00_golden_hour_wash │ ap OFF │      ← one pattern, 50 minutes
```

**AFTER:**

```
19:30 │ philharmonic │ program │ cue c_visibility_on │ default ▸ 00_golden_hour_wash │ ap 90s seq │ …
19:35 │ … │ default ▸ 03_dual_axis_crush   │ ap 90s seq │
19:40 │ … │ default ▸ 06_neon_elevator     │ ap 90s seq │
19:45 │ … │ default ▸ 10_chasers           │ ap 90s seq │
```

**Test:** *"a restart INSIDE a program hold keeps the look own pattern
autopilot"* — asserts the deck autopilot is exactly the look's
`{active:true, delay_s:90, shuffle:false}`, that `_baselineArmed` stays false,
and that the per-tick reconcile does not flip it back off.

---

## 4. FIX 3 — an ambient cue overwrote a running program's look

**Severity: medium — latent on today's plan, sharp the moment playlist
re-pointing lands.** (`_93` §5.3)

**Root cause.** `arbiter.js` applied a non-program, non-mood cue whenever
`controller !== 'manual'` — **including while a program owned the controller**.
It swapped the deck but did not clear `activeProgram`, so the program kept
suppressing mood cues for the rest of its hold. Precedence and look disagreed:
the module's own header says a program *"owns priority for its hold window"*,
but the lights showed the ambient cue. Measured: `c_burn_night` (120-minute
hold) was replaced 30 minutes in by the `party_night` phase cue.

**Change.** An ambient cue is the AUTOPILOT layer's own background swap, so it
now obeys exactly the gate the mood layer does — it lands only while
`controller === 'autopilot'` and no program started on the same tick. Under a
program it is SUPPRESSED and surfaced as a `wouldFire`, never silently applied.

**BEFORE** (burn night):

```
20:55  ▶ FIRE  c_burn_night "Burn night spectacle"  → look burn_night  [kind=program hold=120m]
21:25 │ party_night │ program │ cue c_party_start │ … │ ap 30s shuf │
          ▶ FIRE  c_party_start "Party night ramp" → look party    ← ON TOP of a live program
22:55  ◆ Program ended (hold expired): Burn night spectacle
DECK TIME BY OWNER   0h30m  cue c_burn_night      ← the burn show got 30 of its 120 minutes
```

**AFTER:**

```
20:55  ▶ FIRE  c_burn_night …  [kind=program hold=120m]
21:25 │ — │ program │ cue c_burn_night │ … │
          ✖ SUPPRESSED  c_party_start  (wanted: phase)
                 — a program owns the deck (c_burn_night) — ambient swaps are suppressed for its hold
22:55  ◆ Program ended (hold expired): Burn night spectacle
DECK TIME BY OWNER   2h00m  cue c_burn_night      ← the whole hold
```

**Known consequence, deliberate:** a phase trigger is rising-edge (once per
night), so a phase cue suppressed under a program does not come back when the
hold ends. On burn night `c_party_start` therefore never runs, and the night
after the show is the **ambient** default cue with party sessions rising out of
it — which is the operator's requirement 1+2 ("ambient dominant; party fires from
ambient"). A *deferred* re-fire of a suppressed phase edge would be new
machinery nobody asked for; it is listed as found-not-fixed in §8.

**Tests:** *"FIX 3 (arbiter): an ambient fire is suppressed while a program owns
control"* (pure arbiter, both directions) and *"FIX 3 (service): the show
survives its full hold with a phase cue due mid-hold"*.

---

## 5. FIX 4 — program looks with no `autopilot` block: the VERDICT

(`_93` §5.4)

**Root cause.** A program dispatch carries `autopilotOff: true`. If the look (or
playlist action) then declares no `autopilot` of its own, **nothing re-arms**
pattern cycling and the deck sits on one pattern for the entire hold.

**Design decision, per the brief's "decide with the design intent".** The codex's
no-fallback rule says the engine must not invent an autopilot block the author
never wrote — so the engine does not. It reports it as an **AUTHORING error at
validation time** instead of letting it be discovered at 2am:

- new pure `lintShowPlan(plan)` → `[{code, severity, cueId, look, message}]`;
- `TimelineService` runs it on every plan load / activate / live save,
  `console.error`s each finding, and exposes them as **`planWarnings`** on
  `/timeline/state` (additive — old clients ignore it).

**It is a loud diagnostic, NOT a load-time `throw`, and that is the whole
decision.** A throw would refuse to LOAD the operator's running show (and the
engine's own built-in `defaultShowPlan()`), trading a frozen pattern for a dark
boat. The silence is what got fixed; the plan edit is the operator's.

### 5.1 Verdict on the shipped plan — **it trips, three times (finding, not fix)**

`simulation/scenes/titanic/timeline/playa_default.yaml` **still loads**, and
prints on every boot:

```
!! engine: ⚠ [timeline] plan "playa_default" authoring error [program_action_no_autopilot]:
   cue "c_sunrise" (Sunrise wind-down) is kind:program and its look "sunrise" declares no
   "autopilot" block — a program dispatch disarms the plan's baseline autopilot first, so the
   deck will FREEZE on one pattern for the whole hold. …
!! … cue "c_burn_night" (Burn night spectacle) … look "burn_night" …
!! … cue "c_temple" (Temple burn — reverent) … look "temple" …
```

**For the operator:** three looks need a three-line `autopilot: { active, delay_s,
shuffle }` block — `sunrise` (90-minute hold, every morning), `burn_night` and
`temple` (120 minutes each). `daytime` is authored but currently unreferenced by
any cue, so it does not trip. **Not edited here — `scenes/**` is his.** Whether a
held show *should* cycle is his call.

The engine's own `defaultShowPlan()` template trips the identical three cues;
that is asserted on the record by a test rather than silently "fixed", for the
same reason.

**Tests:** `timeline_plan_lint.test.js`, 8 tests — the rule, its inverse, the
playlist-action form, the kind/enabled/target/baseline-off exemptions, purity,
and the built-in-template verdict.

---

## 6. FIX 5 — the first party session permanently evicted the background look

(`_93` §5.5, extends `_91` G2)

**Root cause.** `c_party_start` is `kind: ambient` with no `durationMin`, so it
owns the deck *"until the next deck cue"*. The first mood session **is** a next
deck cue — but only a temporary one. When its 12-minute window elapsed,
`_reconcileDefaultCue` handed the deck to the `defaultCue`, and the phase cue
never re-fired (rising edge, once per night). The plan therefore had two
completely different nights, and which one you got depended entirely on whether
music ever happened. Nothing in the plan reads that way.

**Change.** `kind: ambient` is the plan's BACKGROUND LAYER. When a TIMED cue
takes the deck from an OPEN-ENDED ambient owner, that owner is remembered
(`_displacedDeckOwnerCueId`); when the timed window elapses it is re-applied
*before* the defaultCue fills. Eligibility fails CLOSED — anything unmet falls
through to the defaultCue exactly as today:

- the cue is still in the plan, enabled, and still drives the deck;
- it is still `kind: ambient` — a program's ownership is its hold, and
  re-applying a displaced MOOD cue would resurrect a session (forbidden by D4);
- a PHASE-triggered owner is restored only while its phase is **still active**
  (the party-night ramp must never come back at 07:00).

**Why this is the ambient-dominance fix, not its opposite.** `_91` requirement 1
("ambient is dominant") is about which LOOK the phase cue points at — an
authoring decision that is still the operator's. What the engine owed was
symmetry: whatever the background layer is, a single 12-minute session must not
destroy it for the night. The day the operator re-points `c_party_start` at the
`ambient` look (the `_91` §1.2 arc review), this same mechanism gives exactly
"ambient → session → ambient → session".

**BEFORE** — real plan, `--mood night_sets`:

```
22:12  ▶ FIRE c_mood_to_party …            ♪ armed → in_session (ends 22:24)
22:24 │ … │ defaultCue (Ambient program) │ ambient ▸ … │   ← c_party_start is gone for the night
22:26  ▶ FIRE c_mood_to_party …
22:38 │ … │ defaultCue (Ambient program) │ ambient ▸ … │
DECK TIME BY OWNER   0h40m  cue c_party_start        CUE FIRES  1 × c_party_start
```

**AFTER:**

```
22:12  ▶ FIRE c_mood_to_party …            ♪ armed → in_session (ends 22:24)
22:24 │ party_night │ autopilot│ cue c_party_start │ default ▸ … │ ap 30s shuf │ bass_drop │
          ◆ Party session ended (window elapsed)  (party-window-elapsed, auto)
          ▶ FIRE  c_party_start  "Party night ramp"  why=owner-restored  → look party
22:26  ▶ FIRE c_mood_to_party …
22:38  ▶ FIRE c_party_start … why=owner-restored
DECK TIME BY OWNER   7h04m  cue c_party_start        CUE FIRES  9 × c_party_start
```

**Tests:** *"the ambient background look returns after every session"* (proves it
survives a SECOND session — the whole point), *"a PHASE-triggered owner is not
restored once its phase has ended"*, *"only an AMBIENT predecessor is remembered
(a session is never resurrected)"*.

---

## 7. FIX 6 + FIX 7 — the boot-baseline clobber and G1

### 7.1 FIX 6 — `_95` F1, the boot-baseline clobber

**Root cause.** `_catchUp` dispatched the restored cue and **then** called
`_establishBaselineIfActive`, which reloads `plan.autopilot.playlist` **on top of
it**. A boot/resume inside a NON-program cue's live window therefore landed the
deck on the BASELINE playlist, not the restored cue's. (A program is immune —
`programCaughtUp` skips the baseline step — and a `defaultCue` owner is applied
after it, so this was the only clobbering case.) Invisible on the shipped plan
only because every look already points at `default`.

**Change.** When catchUp restored a non-program cue that still LIVE-owns the
deck, `_establishBaselineIfActive(reason, { keepRestoredDeck: true })` takes the
baseline's **bookkeeping only** — `controller = 'autopilot'` and
`_baselineArmed = true` so the per-tick reconcile leaves the deck alone — exactly
the way `_applyDefaultCue` already marks itself as the deck's baseline driver.
The restored cue's own playlist, palette and autopilot stand, and its dispatch
already raised the deck pin.

**Pinning term flipped.** `_95` shipped a `clobberedByBootBaseline` term in the
live-service oracle with a comment saying what to flip when it was fixed. It is
gone: the oracle now asserts `deck.playlist === r.playlist` and
`deck.palette === r.palette` with no clobber term at all, over its full probe walk.

**Test:** *"FIX 6 (F1): the boot baseline does not clobber a restored
non-program cue"* — a fixture whose look points at a DIFFERENT playlist from the
baseline (which is what makes the bug observable), asserting the restored
playlist, palette AND autopilot, and that the window still elapses normally.

### 7.2 FIX 7 — G1: a hold expiring naturally must land on ambient

**Root cause.** On hold expiry the arbiter emits `__resume_autopilot__` and the
service called `_applyAutopilotBaseline`, which reloads `plan.autopilot.playlist`
and re-pins the deck but **never clears the deck-ownership latch** —
`_reconcileDefaultCue` then early-returned ("a live no-duration cue owns the
deck") and the `defaultCue` was unreachable. The expired program kept OWNING
while the baseline playlist played underneath it, and its palette was never
reset. On the shipped plan, `default` (not `ambient`) covered sunset+45 →
sunset+120 every single night. That is the inverse of "ambient is the dominant
program".

**Change, three places so boot, runtime and the ribbon agree:**

1. `_dispatchArbitratedAction`'s `__resume_autopilot__` branch releases the
   ownership latch (the program is over — it owns nothing) and, when a
   `defaultCue` is authored, hands the deck straight to it in the SAME tick —
   one write, no baseline flash. **A plan with NO `defaultCue` keeps today's
   behavior exactly**, including the `Autopilot resumed` event line.
2. `_catchUp` does the boot half: a program whose hold already elapsed earlier
   today still has its complete action re-applied (palette / globals / master),
   then releases the latch so the baseline step hands the deck to the defaultCue.
   The resolver reports this as the new `restored.holdExpired`.
3. `resolve_deck_state.js`: an expired hold no longer owns, so the resolver falls
   through to its defaultCue / baseline branches. **`source: 'hold-expired-baseline'`
   is consequently never emitted again** — the value is left in the documented
   union so S3/S4 need no type change, and a quiet-night ribbon simply no longer
   contains it.

**BEFORE** — quiet night, real plan:

```
20:17 │ philharmonic │ autopilot│ cue c_visibility_on │ default ▸ … │ ap 45s shuf │ sunset_coral │
          ◆ Program ended (hold expired): Exterior up at golden hour  (hold-expired, auto)
          ▶ FIRE  __autopilot_resume__  "Autopilot resumed"  why=resume
DECK TIME BY PLAYLIST   24h00m 100% default      ← `ambient` gets ZERO minutes
DECK TIME BY OWNER      12h35m cue c_sunrise  ·  8h40m cue c_party_start  ·  2h45m cue c_visibility_on
```

**AFTER:**

```
20:17 │ philharmonic │ autopilot│ defaultCue (Ambient program) │ ambient ▸ … │ ap 90s shuf │ deep_sea │
          ◆ Program ended (hold expired): Exterior up at golden hour  (hold-expired, auto)
          ▶ FIRE  __default_cue__  "Ambient program"  why=hold-expired
DECK TIME BY PLAYLIST   12h20m 51% ambient  ·  11h40m 49% default
DECK TIME BY OWNER      12h20m defaultCue (Ambient program) · 8h40m cue c_party_start
                         1h30m cue c_visibility_on · 1h30m cue c_sunrise
```

The palette resets too (`sunset_coral` → `deep_sea`), which it never did before.

**Tests:** *"FIX 7 (G1): the deck goes to the defaultCue when a program hold
expires"* (playlist, palette, latch, both event-log lines), *"a plan with NO
defaultCue keeps the autopilot baseline on hold expiry"* (no regression), *"FIX 7
(boot half): a restart AFTER a hold expired lands on the defaultCue"*, plus the
two flipped resolver tests: *"a program inside its hold reports controller=program;
expired does not"* and *"G1 is FIXED: an expired program hold yields the deck to
the defaultCue"* (renamed from *"G1 is VISIBLE …"*).

---

## 8. Verification, and what is NOT fixed

### 8.1 Suites

```
cd marsin_engine && node --test "tests/timeline/*.test.js"
ℹ tests 407 · pass 407 · fail 0            (baseline 387 + 20 new)

cd marsin_engine && npm test
ℹ tests 2459 · pass 2449 · fail 10
```

The 10, each accounted for:

| Failure | Verdict |
|---|---|
| 5 × `tests/audio/audio_capture.test.js` | environmental (no audio device) — documented in `now.md` |
| 1 × `tests/io/osc_listener.test.js` (EACCES) | environmental — documented in `now.md` |
| 1 × `tests/patterns/specialty_white_uv.test.js` | pre-existing playlist-content drift between the two scenes; no playlist was touched here |
| 1 × `tests/effects/effects_v2_mode_page_layout.test.js` | known full-run state pollution (`now.md` B12) |
| 1 × `tests/mixer/view_fader_ramp.test.js` "ramps DOWN" | **parallel-load flake — 4/4 pass run alone** |
| 1 × `tests/io/status_output_routing.test.js` | **NOT this thread — see §8.3** |

Every intentional behavior change has a test updated or added **with a comment
naming the fix**; there are no unexplained diffs. The three `_95` pinning terms
that changed are listed in §7.

### 8.2 Transcripts

All BEFORE/AFTER runs are on the **real** `simulation/scenes/titanic/timeline/
playa_default.yaml` at 1-minute resolution with `--seed 1`, saved under
`~/tmp/bm26_98/` (gitignored): burn night × `all_night`, quiet night, a mid-hold
restart, and a two-DJ-set night, before and after.

### 8.3 Found, NOT fixed

1. **`marsin_engine/config.yaml` is dirty with a loopback controller host.**
   The tracked, comment-bearing config's declared Titanic controller host has
   been replaced with a **loopback black-hole address**, which is why
   `tests/io/status_output_routing.test.js` fails (it asserts the declared host
   from the repo config). `git status` was CLEAN on this file at the start of
   this session, so the edit belongs to a **concurrent thread** that is
   presumably running a black-holed engine right now. **Deliberately not
   reverted:** restoring the real host while another agent boots an engine
   against it would put live sACN on the actual rig, which the service grant
   forbids. **It must be restored before any commit** — `git checkout --
   marsin_engine/config.yaml`, or hand-edit the `controllers[0].host` line back.
   (The autopilot residue the same file picked up — `playlist.active` /
   `playlist.delay_s` — WAS restored by this thread; it was caused by running an
   engine-spawning test without `tests/helpers/setup_config_guard.mjs`.)
2. **A phase cue suppressed under a program never re-fires.** Phase triggers are
   rising-edge once per night, and fix 3 now suppresses them under a program
   hold. On burn night that means `c_party_start` never runs at all. The
   resulting night (ambient dominant, sessions from ambient) matches the
   operator's stated requirements, so this is reported rather than "fixed" — a
   deferred re-fire of a suppressed phase edge is new machinery and an operator
   decision.
3. **`getPartyStatus().effectiveState` reports `armed` while a program owns the
   deck.** True (the trigger IS armed) but not maximally informative. A more
   precise value would need a seventh enum member, and CaptainPad's
   `parsePartyConfig` throws on unknown ones — so the additive `triggerArmed`
   boolean was added instead and the enum left alone. A UI that wants "blocked by
   the show" can read `controller === 'program'`.
4. **The shipped plan's three program looks with no `autopilot` block** (§5.1) —
   operator plan edit.

### 8.4 Explicitly operator-gated, untouched

Restoring **`whenPhase: 'party_night'`** on the party mood cue in
`simulation/scenes/titanic/timeline/playa_default.yaml` — the `_91` audit gap #2,
which is why a loud stereo at 3 pm can start a party session in broad daylight —
**remains an edit to the operator's scene file and awaits HIS word.** Nothing
under `scenes/**` was read for anything but analysis, and nothing was written.

---

## 9. Hygiene

- No IPs, hostnames, MACs or credentials in this report.
- No when-by / deadline / schedule planning. Festival days are referenced
  abstractly ("burn night", "festival day 6"); the literal dates live in the
  operator's scene data.
- Writes outside this report and the two ledger docs: the six engine
  source/tool files and three test files in §1. Every transcript and scratch
  file lives under `~/tmp/bm26_98/`.
- One operator-WIP restore (`config.yaml` `playlist.*`, §8.3); one operator-WIP
  finding left alone and flagged loudly (`config.yaml` controller host).
- No git operations.
