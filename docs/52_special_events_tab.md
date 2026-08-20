# 52 — SPECIAL EVENTS tab (staged one-button shows; Baby Reveal is show #1)

**Status:** SHIPPED — the engine service, the show schema and the CaptainPad tab
all exist. Originally authored as a DESIGN doc by `_197` on `feat/bm_readiness`.

> **⚠️ The pattern-level detail below is HISTORICAL.** This document was written
> against an earlier Baby show built from three long story patterns
> (`131_baby_reveal`, `132_baby_tease`, `133_baby_reveal_burst`). **Those
> patterns no longer exist.** The show is now driven entirely by PLAYLISTS, and
> the schema's `type: pattern` verb has been removed in favour of
> `type: playlist`.
>
> **The current canon is:**
> - **Exactly three playlists**, in both the `titanic` and `test_bench` scenes:
>   `baby_tease` (15 outcome-blind pink+blue looks), `baby_girl` (15 hard-coded
>   pink looks), `baby_boy` (15 hard-coded blue looks).
> - **`baby_reveal` is the SPECIAL EVENT / show id only, never a playlist** —
>   `simulation/scenes/titanic/special_events/baby_reveal.yaml`. The retired
>   `baby_reveal`, `baby_pink`, `baby_blue` and `baby_reveal_celebration`
>   playlists are gone. (`baby_pink` / `baby_blue` / `baby_reveal_duet` survive
>   as COLOUR PALETTE ids in `marsin_engine/config.yaml` — different namespace.)
> - **The 45 patterns live in `marsin_engine/patterns/baby/`** and are registered
>   under qualified ids (`baby/01_tease_orbit_question` … `baby/45_girl_celebration_burst`).
> - **The shipped stage list is `tease → blackout → reveal → photos`** (four
>   stages; §3 below still describes three), and the reveal's buttons read
>   `BABY PINK` / `BABY BLUE`.
>
> The show YAML itself is the authority; `marsin_engine/tests/special_events/show_schema.test.js`
> and `marsin_engine/tests/patterns/baby_color_contract.test.js` enforce it.
> Read the sections below for the *reasoning*, not for the file names.
**Operator intent (verbatim essentials):** *"I want a tab that I can go on and
do different shows with very simple buttons. Baby reveal is the first one.
Multiple stages, each with a button, and quick dependency to go to the next
step, and extension, and some other things I will add in the UI. Simple and
easy."*
**Related:** `docs/38_timeline_show_scheduler.md` (timeline arbiter/lease),
`docs/39_channels_deck_mixer.md` (deck channel, snapshots), `docs/28` (effect
macros), `docs/16_captain_pad.md`, and the 45 Baby patterns in
`marsin_engine/patterns/baby/`.

---

## 0. Ground truth studied (what exists in the integrated tree)

**Event patterns (all present, all marked `// DRAFT — pending operator review`):**

| Pattern | What it actually is |
|---|---|
| `132_baby_tease.js` | 158 s outcome-blind whole-ship tease (pink/blue rounds → side swings → Pink/All/Blue/All barrage → five white flashes → **indefinite blackout at 158 s**). `sliderRestartTease` resets to t=0; `sliderReplayFinale` is a rising-edge pulse that jumps to t=120 s (replays the finale without the first two minutes). No audio modulation. |
| `133_baby_reveal_burst.js` | Manual answer, pushed after 132's blackout. Starts at black, spherical shock front + twelve petal-rays, settles into a photo-safe rose. `sliderFinalColor` 0 = pink, 1 = blue (never interpolated); `sliderRestartReveal` restarts the explosion. Deck palette writes are deliberately ignored — the answer keeps its authored family. |
| `131_baby_reveal.js` | The all-in-one variant: 90 s six-act tease + 2 s blackout + auto reveal at t=92 reading `finalColor`. Useful as a one-button show later; **not** used by show #1 because the operator wants the reveal moment on a human button. |

**Live Touch trio (verified, unrelated to events):** `128_five_colour_prism`,
`129_five_colour_stations`, `130_spatial_paint` are Live Touch instruments
(five-colour zones/stations, positional paint pool). They share the
"local-slider" trick this design leans on, nothing more.

**Engine machinery available today (no new invention needed for most of it):**

- Deck pattern activation: `POST /set-pattern`, `POST /deck/playlist/entry`
  (with soft transitions), `POST /deck/channel/control` `{id, v0}` → per-slider
  writes on the deck channel via `paramRouter.setChannelControl`.
- Snapshots ("looks"): `POST/GET /mixer/snapshots`, recall + **timed morph
  recall** (`recallSnapshotFade`, docs/39 §10.8). A snapshot is the FULL mixer
  state — master + deck + every overlay. This is the abort/restore primitive.
- Master fade: `POST /mixer/master/fade { target, durationMs }`.
- Autopilots: deck pattern autopilot (`/autopilot`), deck color autopilot
  (`/deck/color-autopilot`).
- Timeline service (engine-internal, docs/38 §15): plan lock
  (`controlLock === 'plan'`), **operator takeover lease**
  (`POST /timeline/takeover`, auto-resume, renewals), manual cue fire
  (`POST /timeline/cues/:id/fire`), arbiter precedence, `sequence` actions
  (timed steps). One plan is active at a time.
- PANIC surfaces: `POST /mixer/panic` (leave the rig LIT),
  `POST /global-effect-macros/panic-stop`, global blackout.
- Performance mode: engine-side 409 gate (`PERFORMANCE_MODE`) on structural
  routes; CaptainPad nav collapses to Deck / Mixer / Live Touch
  (`captainpad_tab_policy.ts` → `showInPerformance`).

---

## 1. Architecture decision — where the show runner lives

Three candidates were studied:

**(a) CaptainPad-side runner (tab does direct REST deck switches).** Simplest
to build, zero engine change — and rejected. Show state and timers would live
in a browser tab: iPad sleep, tab-away, or a WS drop mid-reveal kills the show
clock; and nothing engine-side knows a show is running, so the deck autopilot
can legally swap patterns in the middle of the blackout. Two writers, fragile
state. Fails the mission's own constraint that show state must survive the
iPad.

**(b) Ride the TIMELINE machinery (stages as manual cues).** Attractive on
paper — `fireCue` exists, `sequence` actions exist, holds suppress the
baseline. Rejected for three concrete reasons: (1) `/timeline/plan/activate`
swaps THE active plan — putting event stages in their own plan would deactivate
the operator's nightly `playa_default` plan to run a five-minute baby reveal;
putting them INSIDE the nightly plan pollutes it and trips overlap/lint
machinery built for scheduled cues. (2) The timeline has no notion of ordered
stages, an "armed next" gate, choice buttons (pink/blue), or a stage extension —
all of that would be bolted onto an arbiter that is already the most subtle
state machine in the engine. (3) The tease/reveal patterns carry their own
authored clocks; they need a *holder of authority*, not a scheduler.

**(c) Small engine-side SPECIAL EVENTS runner — CHOSEN.** A sibling of
`timeline_service.js` in shape (deps-injected internal calls, 1 s tick, WS
broadcast, state file), but ~10× smaller: a linear stage machine, not an
arbiter. It *reuses* the timeline's existing takeover lease for authority
instead of inventing a new lock, reuses snapshots for restore, and reuses the
deck's internal pattern/control paths for actions. Engine-internal deps also
mean stage actions fire even while performance mode 409s the equivalent HTTP
routes — exactly like timeline cues.

Single-writer story while a show runs: **the runner is the only writer to deck
content**. The timeline plan yields via the lease; deck autopilots are
disarmed; accidental human pattern taps are 409'd (see §5). PANIC and the
Dimmer Rack sit above it, untouched.

---

## 2. Show model — declarative, data-first

### 2.1 Ownership and location

Shows are show-content, like playlists and timeline plans — they deploy with
the rig, not with the app. They live scene-side, next to the timeline plans:

```
simulation/scenes/<scene>/special_events/<show_id>.yaml
```

`titanic` gets the real shows; `test_bench` gets a copy of `baby_reveal.yaml`
so the whole flow is bench-verifiable. The operator's "other things I will
add" = a new YAML file + (rarely) one new verb in the small action vocabulary —
never new UI code. The tab renders whatever validated shows the engine lists.

### 2.2 Schema (v1)

Validation mirrors `show_plan.js`: throw-style, normalized output, a
present-but-broken file **refuses to load and says why** (codex P0 — the tab
shows the load error; there is no partial show).

```yaml
schemaVersion: 1
id: baby_reveal              # slug ^[a-z0-9][a-z0-9_-]{0,63}$
name: Baby Reveal            # display name
color: '#FF9EC4'             # show card accent (data-driven; UI chrome stays tokens)
icon: gift                   # IconSymbol name for the show card

stages:                      # ordered; 1..12
  - id: tease                # slug, unique within the show
    label: START TEASE       # big-button text
    color: '#FF9EC4'         # stage button accent
    ceremonial: false        # true → extra-large treatment (the reveal moment)
    actions:                 # applied in order when the stage FIRES
      - type: pattern        # activate a pattern on the DECK channel
        pattern: 132_baby_tease
        params: { level: 0.90, spatialDepth: 0.72, sparkle: 0.58 }
        pulse: [restartTease]     # write 1.0 then 0.0 (rising-edge setters)
    advance: manual          # 'manual' | { afterSec: N }  (timed auto-advance)
    extend:                  # OPTIONAL — the stage's EXTEND button
      label: REPLAY FINALE
      actions:
        - { type: control, control: replayFinale, pulse: true }

  - id: reveal
    label: THE REVEAL
    ceremonial: true
    choices:                 # a CHOICE stage: 2..4 variant buttons, no `actions`
      - id: girl
        label: IT'S A GIRL
        color: '#FF9EC4'
        actions:
          - type: pattern
            pattern: 133_baby_reveal_burst
            params: { finalColor: 0.0, level: 0.90 }
            pulse: [restartReveal]
      - id: boy
        label: IT'S A BOY
        color: '#4FA8FF'
        actions:
          - type: pattern
            pattern: 133_baby_reveal_burst
            params: { finalColor: 1.0, level: 0.90 }
            pulse: [restartReveal]
    advance: manual
```

Schema rules (all throw on violation): a stage has exactly one of
`actions` | `choices`; every `choices` entry has `actions`; `advance.afterSec`
is a finite number > 0; `extend` on a timed stage may instead be
`{ addSec: 30 }` (see §2.4); pattern names must exist on disk at load;
`params`/`pulse`/`control` names are validated against the pattern's exported
controls **at arm time** (the engine resolves name → control id from the
compiled pattern; unknown name = the ARM fails loudly, not the 2 a.m. stage).

### 2.3 Action vocabulary (v1 — deliberately tiny)

Every verb maps to an EXISTING engine internal; no verb writes dimmers or
mixer structure.

| Verb | Fields | Engine internal it maps to |
|---|---|---|
| `pattern` | `pattern`, `params?`, `pulse?` | the `/set-pattern` deck path + `paramRouter.setChannelControl` per param (name → id resolved from the pattern's control list) |
| `control` | `control`, `value?` or `pulse: true` | `paramRouter.setChannelControl` on the deck channel (rising-edge pulse = write 1.0, then 0.0 on the next tick) |
| `masterFade` | `target`, `durationMs` | the `/mixer/master/fade` timed-fade path |
| `globals` | `set: {SPEED: …, hue…}` | the same CPC `setParams` path a timeline look uses (this is how a stage pins SPEED neutral, per 131/132's header contract) |
| `effect` | `effectId`, `presetId?` | the scheduled-task fire-now path (docs/28/31) — same contract as the timeline `effect` action |

NOT in v1 (each would be a schema bump + its own review): mixer-channel edits,
scene switches, dimmer/group writes, playlist loads, nested sequences. The
runner's stage machine IS the sequencer.

### 2.4 Dependencies, advance, extension — semantics

- **Ordering is the dependency.** Stage N+1 is **armed** the moment stage N
  fires (highlighted, tappable). Stages after N+1 are **locked** (visible,
  dimmed, not tappable). Firing anything but the armed stage is refused by the
  engine (`409 STAGE_NOT_ARMED`) — the UI never has to be the only guard.
  Re-firing the CURRENT stage is allowed (it re-runs the stage's actions —
  restart pulses make this the natural "run it again" gesture) behind a
  confirm.
- **`advance: manual`** — the operator taps the next stage. This is the
  default and all of Baby Reveal.
- **`advance: { afterSec: N }`** — the runner's engine-side tick counts down
  and auto-fires the armed next stage. The countdown is broadcast every second;
  the UI renders it on the armed button. Tapping the armed button early fires
  it immediately (manual always wins).
- **EXTEND** — one button, only visible when the current stage defines
  `extend`. Two flavors, one button:
  - Timed stage → `extend: { addSec: 30 }` adds 30 s to the live countdown
    (repeatable; each press adds again).
  - Manual stage → `extend.actions` fires a stage-authored action set (Baby
    Reveal's tease uses this to pulse `replayFinale` — the pattern's own
    built-in "give me more time" affordance, which replays the 120–158 s
    finale and re-enters the blackout).
- **FINISH / ABORT** are the same engine path (§4) — FINISH is the last
  stage's polite exit, ABORT is the same restore available at any moment.

---

## 3. Baby Reveal — show #1, concretely

File: `simulation/scenes/titanic/special_events/baby_reveal.yaml` (copy in
`test_bench`). Uses `132` + `133` (the operator-controlled pair). `131` stays
available for a future `baby_reveal_auto` one-button variant.

| # | Stage | Button | What fires | Advance |
|---|---|---|---|---|
| — | **ARM** (not a stage) | `ARM SHOW` on the show card | Pre-show snapshot captured; takeover lease engaged; deck pattern + color autopilots disarmed (prior flags recorded); deck keeps playing whatever it was playing | — |
| 1 | `tease` | `START TEASE` (pink/blue split accent) | `132_baby_tease` + `restartTease` pulse; `globals` pins SPEED neutral (the pattern's 158 s clock must not be scaled) | manual — the pattern parks itself in an **indefinite blackout** at 158 s, which is exactly the drum-roll hold |
| 2 | `reveal` | **THE ceremonial moment** — two huge side-by-side buttons: `IT'S A GIRL` (pink) / `IT'S A BOY` (blue) | `133_baby_reveal_burst` with `finalColor` 0.0 / 1.0 + `restartReveal` pulse. The answer is chosen at the button, not in config — the envelope can stay sealed until this second | manual |
| 3 | `photos` | `PHOTO GLOW` | nothing new to fire — 133's photo-safe rose is already running; this stage exists so the UI clearly says "hold for photos" and carries the FINISH affordance. Its single action is a no-op `masterFade` to 1.0 over 2 s (belt-and-suspenders lit) | manual |
| — | **FINISH / ABORT** | `END SHOW — BACK TO NORMAL` / `ABORT` | Recall the pre-show snapshot as a 3 s morph; re-arm recorded autopilot flags; release the lease | — |

EXTEND on stage 1 = `REPLAY FINALE` (pulse `replayFinale` → jump to t=120,
barrage + white flashes + blackout again). Stages 2–3 define no extend — the
rose is photo-safe indefinitely; there is nothing to extend.

**Pre-show state capture — explicit, no guessing.** ARM performs, atomically,
in order: (1) engine captures a full mixer snapshot under the reserved name
`ev_prev` (overwritten per ARM; hidden from the SnapshotBar list by its
reserved prefix), (2) records `{ patternAutopilotActive, colorAutopilotActive,
planWasDriving }` into the runner state file, (3) engages the timeline
takeover lease, (4) disarms both autopilots. If ANY step fails, ARM unwinds
what it did and returns the error — a show never starts half-armed. FINISH and
ABORT recall `ev_prev` (3 s morph via the existing `recallSnapshotFade` path),
restore the recorded autopilot flags, then release the lease (the plan's
auto-resume machinery takes it from there). Restore failure is loud: the state
becomes `ended:restore_failed` with the error surfaced on the tab AND the
engine log — never a silent shrug.

---

## 4. Engine runner — state machine and API

### 4.1 States

```
idle → armed → running(stageIndex, choiceId?, countdown?) → ended(reason) → idle
                                    ↑ EXTEND mutates countdown / fires extend actions
reasons: finished | aborted | panic | restore_failed
```

State + timers live in `marsin_engine/lib/special_events/` and persist to
`states/<scene>/special_events_state.yaml` on every transition — an engine
restart mid-show comes back knowing a show was live and lands in
`ended:aborted` with restore executed on boot (a restart is an abort; the rig
must come back normal, not mid-blackout). The iPad is a pure view at all
times: reconnect/sleep/tab-away changes nothing engine-side.

### 4.2 REST + WS (all NEW — this is its own implementation slice)

| Route | Behavior |
|---|---|
| `GET /special-events` | list of validated shows (id, name, color, icon, stage summaries) + per-file load errors for broken YAML (loud, listed, not loadable) |
| `GET /special-events/state` | full runner state (mirrors the WS shape) |
| `POST /special-events/arm { show }` | the ARM transaction (§3). 409 `EVENT_ACTIVE` if a show is already armed/running |
| `POST /special-events/fire { stageId, choiceId? }` | fire the armed stage. 409 `STAGE_NOT_ARMED` out of order; 400 unknown choice |
| `POST /special-events/extend` | apply the current stage's extend (400 if the stage defines none) |
| `POST /special-events/finish` / `POST /special-events/abort` | the shared restore path (§3); abort valid from `armed` too |
| WS broadcast `specialEvents` | full state on every transition + 1 Hz while a countdown runs |

**Deck write gate:** while state is `running`, the deck content routes
(`/set-pattern`, `/deck/playlist`, `/deck/playlist/entry`, secondary-slot
drive) return `409 SPECIAL_EVENT` — same shape as the `PERFORMANCE_MODE`
gate, so CaptainPad's existing `code`-aware callers quiet it correctly.
Everything safety-shaped stays open: PANIC, blackout, master, dimmers,
group fixed colors, `/special-events/*` itself.

**PANIC precedence:** the two panic routes and the blackout-enable path get a
one-line `specialEvents.notePanic()` call (fire-and-forget, never awaited — 
panic latency is untouchable). The runner transitions to `ended:panic`,
releases the lease, restores autopilot flags, and **does NOT recall the
snapshot** — panic just established a known-good LIT state; morphing an old
look over it would fight the operator's emergency. The tab shows "ENDED — 
PANIC" until dismissed.

**Dimmer Rack:** untouched authority. No verb writes dimmers; event output is
scaled by the racks like any other content. Final brightness authority stays
where it is.

**Timeline interaction:** the lease is the entire interface. While held, the
plan yields (existing `overridden` semantics); a scheduled program that comes
due mid-show arms the existing pending-program lease UI instead of firing —
already-built behavior, no new arbitration. On release, the plan's auto-resume
brings the night back. Plan-lock UX: if `controlLock === 'plan'` when the
operator taps ARM, the ARM confirm sheet says it will take over the plan — one
tap, no separate ritual.

**Performance mode:** the tab is a performance surface, so
`showInPerformance: true` — it appears in the collapsed performance nav
alongside Deck/Mixer/Live Touch. Justification: performance mode exists to
freeze *structure* during a live set; a special event IS the live set. There
is nothing structural to protect on this tab — shows are read-only data,
authored off-playa; every button is a performance action. The
`/special-events/*` routes are therefore NOT performance-gated. (The
alternative — hidden unless armed — was rejected: you must be able to reach
the tab to arm it, and a mode-dependent appearing/vanishing tab is the
opposite of "simple and easy" at midnight.)

---

## 5. UI spec — dead simple, thumb-first, at night

New tab `special_events` ("Events", icon `sparkles`, group `Show`,
`showInPerformance: true`).

**Show picker (state `idle`):** one large card per show (min 120 pt tall,
full-width, show color as accent bar, name in SpaceGrotesk). Tap → ARM confirm
sheet (uses the existing `ConfirmSheet`) stating exactly what ARM does:
"Captures the current look · pauses autopilot · takes over the plan". Broken
YAML files render as red error cards with the loader's message — visible,
never tappable.

**Show screen (armed/running):** a single vertical column, in stage order — no
scrolling for shows ≤ 5 stages (Baby Reveal fits):

- **Done** stages: dimmed, checkmark, not tappable.
- **Current** stage: glowing animated border in the stage color, elapsed time
  ticking.
- **Armed next** stage: solid accent outline, `NEXT` chip, full brightness — 
  this is the tap target. Countdown ring + `M:SS` when auto-advance is live.
- **Locked** stages: 40 % opacity.
- **Choice** stage armed → its variants render as side-by-side buttons at
  double height (Baby Reveal: pink/blue each ≥ 160 pt tall — the ceremonial
  buttons are the biggest thing the app has ever drawn; `ceremonial: true`
  additionally clears the rest of the column to near-black so the two buttons
  are the only bright thing on the glass).
- **EXTEND**: one fixed-position button, bottom-left, visible only when
  defined for the current stage, labeled from the show data
  (`REPLAY FINALE` / `+30s`).
- **ABORT**: bottom-right, error-red outline, always present from `armed`
  onward, double-confirm via `ConfirmSheet` ("Back to the look running before
  the show"). The final stage's `END SHOW` button is the same action styled as
  a primary affirmative.

**Ergonomics + tokens:** every target ≥ 44 pt (stage buttons ≥ 88 pt; reveal
buttons ≥ 160 pt); hitSlop on the small chrome; all chrome colors from
`usePalette()` tokens per `.agent/os/ui_design.md` (WCAG AA pairs; show/stage
accent hexes are DATA and are contrast-checked against the dark surface at
render with the existing luminance helper — a failing accent gets a token
outline). No new dependencies, offline-only, no CDN anything.

**Mid-show death of the iPad:** reopening the tab (or any CaptainPad anywhere)
GETs `/special-events/state` and lands exactly on the live stage — the tab has
no local state worth losing. Countdown display self-heals from the 1 Hz WS
frames.

---

## 6. Implementation contract

Shared tree — two AIs work here concurrently. Implementers MUST: re-read every
file immediately before editing (no stale buffers), keep every edit surgical
(one concern per commit-sized change), and **stop on conflict** — if a file
you are about to touch shows foreign in-flight edits (unexpected diff, failing
tests you did not cause), stop and report; never rebase away or "fix" the
other agent's work. The stack is RUNNING (ports 6966–6972, coordinator-owned):
implementers/validators never start/stop/restart it; validators use a fresh
`:7167` dist export (see memory: metro-stale-watcher, operator-manages-expo).

### Slice A — engine runner (NEW endpoints → its own slice, lands first)

| File | Content |
|---|---|
| `marsin_engine/lib/special_events/show_schema.js` | load/validate/normalize show YAML (throw-style, `show_plan.js` posture) |
| `marsin_engine/lib/special_events/special_events_service.js` | state machine, 1 s tick, deps injection (`loadPattern`, `setChannelControl`, `saveSnapshot`, `recallSnapshotFade`, `setAutopilot`, `takeover/resume`, `fireEffect`, `setParams`, `fadeMaster`), state persistence, panic hook |
| `marsin_engine/lib/api_server.js` | the 7 routes + WS `specialEvents` + the `SPECIAL_EVENT` 409 gate + `notePanic()` calls in the two panic routes and blackout-enable |
| `marsin_engine/engine.js` | instantiate + wire deps (mirror the `timelineService` block) |
| `simulation/scenes/titanic/special_events/baby_reveal.yaml` + `test_bench` copy | show #1 data |
| `marsin_engine/tests/special_events/*.test.js` | see test list |

### Slice B — CaptainPad tab (after A merges)

| File | Content |
|---|---|
| `CaptainPad/app/(tabs)/special_events.tsx` | the tab (picker + show screen) |
| `CaptainPad/utils/special_events_api.ts` | typed fetch helpers (ApiResult posture, `code` threading) |
| `CaptainPad/hooks/useSpecialEvents.ts` | WS + GET reconcile (never optimistic) |
| `CaptainPad/components/special_events/stage_button.tsx` | stage/choice/extend/abort buttons |
| `CaptainPad/utils/captainpad_tab_policy.ts` | add `special_events` (`showInPerformance: true`) |
| `CaptainPad/app/(tabs)/_layout.tsx` | register the screen |

### Test list (engine, all fail-loud paths asserted)

1. Schema: broken YAML refuses with the exact field error; unknown pattern
   name refuses at load; unknown control name fails the ARM.
2. Sequencing: fire out of order → `409 STAGE_NOT_ARMED`; choice stage
   requires a valid `choiceId`; re-fire current allowed.
3. Auto-advance: countdown fires the next stage; manual tap pre-empts it.
4. Extension: `addSec` extends a live countdown (repeatable); action-extend
   dispatches the authored pulse writes (1.0 then 0.0).
5. ARM transaction: snapshot + flags + lease + autopilot-off, and a mid-ARM
   dep failure unwinds fully back to `idle`.
6. Abort/finish: snapshot morph recall + autopilot flags restored + lease
   released; restore failure → `ended:restore_failed`, loud.
7. PANIC wins: `notePanic()` mid-stage → `ended:panic`, NO snapshot recall,
   lease released; the panic route itself never awaits the runner.
8. Second writer: `/set-pattern` and `/deck/playlist/entry` 409
   `SPECIAL_EVENT` while running; open again after `ended`.
9. Restart mid-show: boot with a `running` state file → restore executed,
   state `ended:aborted`.
10. Performance mode ON: `/special-events/*` still 200s.

### Validator screenshot matrix (CaptainPad on the `:7167` dist, engine live)

1. Show picker with `baby_reveal` card (+ one deliberately broken YAML error
   card on the bench scene).
2. ARM confirm sheet.
3. Armed: stage column, `START TEASE` armed, ABORT present.
4. Mid-tease: current-stage glow, `NEXT` on reveal, `REPLAY FINALE` visible.
5. The reveal moment: pink/blue ceremonial buttons, dimmed chrome.
6. Post-choice: burst running, `PHOTO GLOW` armed.
7. Abort flow: ConfirmSheet, then deck visibly back on the pre-show look
   (before/after pair).
8. PANIC mid-show: tab shows `ENDED — PANIC`.
9. Performance mode nav showing the Events tab.

---

## 7. Open decisions for the operator

1. **Tab title/icon:** "Events" with `sparkles` proposed — happy to take a name.
2. **Reveal button labels:** `IT'S A GIRL` / `IT'S A BOY` as authored — 
   confirm wording (it is show data, one-line YAML change).
3. **Photo stage:** keep the explicit `PHOTO GLOW` third stage, or make
   FINISH available directly from the reveal stage (schema supports either)?
4. **Patterns 131–133 are still `DRAFT — pending operator review`** — the
   show ships when the patterns do.
5. **Post-show snapshot retention:** `ev_prev` is overwritten per ARM; should
   the last one also be kept as `ev_prev_last` for a one-tap "undo the
   restore"? (Cheap, but one more reserved name.)
