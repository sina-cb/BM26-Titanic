# 38 — Timeline / Show Director (event & mood-driven playlists)

**Status:** Draft v1 — for operator review (Sina). Nothing built yet; this is
the doc to react to before code lands.
**Author:** remote agent (Claude), branch `feat/timeline_support`.
**Project tracker / context:** `.agent/02_reports/202606/20260619_0_timeline_show_scheduler.md`
**Related (all real, all reused):**
`19_playlists.md` (playlist library + autopilot) ·
`31_scheduled_tasks.md` (interval effect scheduler — sibling, not replaced) ·
`37_marsin_audio_framework.md` (the Audio Companion = the model we copy) ·
`26_audio_params_playlist.md` + `15_central_param_center_cpc.md` (CPC, mood signals) ·
`24_osc_integration.md` (OSC → CPC transport) ·
`16_captain_pad.md` (the operator UI).

> **One-line pitch.** A new **Timeline Companion** — a server-side, engine-
> supervised process exactly like the Audio Companion — that fires **playlists,
> scenes, looks, and effects** off **wall-clock time, sun events (sunset /
> sunrise / golden hour / "philharmonic sunset"), named show phases, and music
> mood changes (calm → party)**. It decides *when*; the engine stays the
> executor of *what*.

---

## 1. Why this, why now

The interval scheduler (`docs/31`) deliberately is **"not a cue list… intervals
only, not wall-clock times."** That is exactly the gap this fills. On the playa a
night runs on a *clock and a sky*, not a stopwatch:

- **Sundown** the exterior wash needs to come up — mission-critical visibility.
- A **philharmonic sunset** set (a calmer, golden look anchored to twilight).
- **Party night** ramps into high-energy playlists after dark.
- **Sunrise** eases the camp down into a soft morning look.
- When the DJ takes the room from **calm to party**, the lights should *follow
  the music* without the operator babysitting the deck.

Today every one of those is a manual ritual on CaptainPad. The codex goal — **be
kind to the operator** — says automate the rituals that a clock, the sun, and the
music can drive on their own, while always leaving the operator a clean takeover.

This is **not** a replacement for playlists, autopilot, or the interval
scheduler. It is the **conductor above them**: it loads playlists, flips
autopilot, swaps palettes, and (optionally) enables interval-task profiles at the
right moment.

---

## 2. The companion repurposing — "companions server and process"

Operator request (verbatim intent): *add this as a new companion like the audio
companion that runs with the audio companion — repurpose the audio companion to a
**companions** server and process.*

Today `launcher.js` already supervises the Audio Companion as a first-class child
(`launcher.js:1037-1043`, `startChild('companion', …)`, profiles list
`'companion'` in `PROFILES`). We generalize that single hard-coded child into a
small **companions framework**: the Audio Companion becomes *companion #1*, the
Timeline Companion is *companion #2*, and adding a third later is config, not new
launcher code.

```
        ┌──────────────────────────── launcher.js ───────────────────────────┐
        │  PROFILES[*].companions: ['audio', 'timeline']                      │
        │      spawn + health-probe + teardown each, same supervised pattern  │
        └───────────┬───────────────────────────────┬────────────────────────┘
                    │                                │
        ┌───────────▼───────────┐        ┌───────────▼─────────────┐
        │  Audio Companion       │        │  Timeline Companion      │
        │  (sole audio analyzer) │        │  (show director)         │
        │  :6966  HTTP/WS        │        │  :6965  HTTP/WS          │
        │  → OSC → engine CPC    │        │  → REST/WS → engine      │
        └───────────┬───────────┘        └───────────┬─────────────┘
                    │  audioParty / audioStructure    │  /deck/playlist, /scene,
                    │  (mood) over engine WS          │  /control, /scheduled-tasks
                    └────────────────┬────────────────┘
                                     ▼
                          ┌─────────────────────┐
                          │   MarsinEngine :6968 │  ← the executor
                          │   CPC · playlists ·  │
                          │   autopilot · scenes │
                          └─────────────────────┘
```

### 2.1 What "companion" buys us (and the resilience answer)

`docs/31` made the interval scheduler **engine-side** specifically so it keeps
firing when the iPad sleeps. A naive reading says "a companion is a UI, so it
can't be resilient." That is **not** what companion means here:

> A companion is a **server-side, engine-supervised subprocess** — part of the
> engine bring-up, restarted on crash, torn down with the stack
> (`docs/37 §8`). It has the **same uptime as the engine itself** and is fully
> independent of any iPad. The Timeline Companion fires cues whether or not a
> CaptainPad is connected.

So we get the audio-companion ergonomics (its own process, its own port, its own
config + state, independent dev/test) **and** the docs/31 resilience guarantee.

### 2.2 Companion base (shared lifecycle)

A thin `companions/lib/companion_base.js` factor-out (HTTP/WS server boot, engine
link with reconnect, config load/save, graceful shutdown) that both companions
use. The Audio Companion's existing engine-link logic
(`engine_config_link.js`, the manifest push/retry, `writeThroughShared`) is the
proven template — the base is extracted from it, not invented.

Directory shape (proposed):

```
marsin_engine/
  companions/
    lib/companion_base.js          # shared spawn-target lifecycle helpers
    audio/      → (the existing audio/companion/*, relocated or referenced)
    timeline/
      timeline_server.js           # HTTP/WS + tick loop (the new process)
      sun.js                       # offline solar-position math (vendored algo)
      triggers.js                  # trigger evaluation (pure, unit-tested)
      show_plan.js                 # load/validate/save show-plan YAML
      engine_link.js               # REST/WS client to the engine
      timeline_config.js           # config schema + loader
      ui/                          # standalone design/monitor UI (like audio)
```

> Relocating the audio companion is optional and can be deferred — the minimum
> viable change is teaching the launcher a `companions` list and adding the
> timeline child. The directory move is a tidy-up we sequence to avoid clashing
> with in-flight audio work (`docs/37 §11`).

---

## 3. Concepts & data model

Three nouns, mirroring the playlist library/assignment split (`docs/19`):

| Noun | What it is | Where it lives |
|---|---|---|
| **Show Plan** | Authored timeline of cues for a scene | `simulation/scenes/<scene>/timeline/<plan>.yaml` (show content, versioned) |
| **Cue** | One `{ trigger → action }` rule inside a plan | inside the plan file |
| **Timeline State** | Runtime: active plan, armed/holding, last-fired cue, manual overrides | `marsin_engine/states/<scene>/timeline_state.yaml` (runtime, not versioned) |

This is the exact pattern playlists use (library = `simulation/scenes/…`,
assignment = `marsin_engine/states/…`). Reusing it keeps storage discipline and
backup/versioning behavior consistent.

### 3.1 Trigger types (the "when")

| `trigger.type` | Fires when… | Key fields |
|---|---|---|
| `clock` | wall-clock time of day is reached | `at: "21:30"` (24h, local tz) |
| `sun` | a sun event ± offset | `event: sunset\|sunrise\|civilDusk\|civilDawn\|goldenHourStart\|…`, `offsetMin: -30` |
| `phase` | a named show phase becomes active | `phase: "party_night"` (phases are time/sun-anchored windows, §3.4) |
| `mood` | the music mood crosses a threshold | `from: calm`, `to: party` (rising/falling edge of `audioParty`), `minDwellSec`, `cooldownSec` |
| `manual` | operator taps "fire" | (no auto-fire; armed for tap / API) |

"**Philharmonic sunset**" is just a named sun cue: `{ type: sun, event: sunset,
offsetMin: -30 }` (or whatever offset the operator settles on) bound to a calm,
golden playlist. We ship a small **offset preset** vocabulary so the operator
picks `sunset −30m` from pills, never types math.

### 3.2 Action types (the "what" — all map to existing engine surfaces)

| `action.type` | Engine surface it calls | Body |
|---|---|---|
| `playlist` | `POST /deck/playlist {name}` (+ `POST /deck/playlist/autopilot {state}`) | `name`, optional `autopilot: {active, delay_s, shuffle}` |
| `scene` | scene-switch (engine exit `75` → launcher respawn, `engine.js`/`launcher.js:1004`) | `scene` |
| `look` | a **bundle**: playlist + palette + globals + autopilot in one cue | references a `looks:` block (§3.3) |
| `globals` | `POST /control {key, value}` per CPC key (palette, master, etc.) | `set: {key: value, …}` |
| `tasks` | enable/disable an interval-task **profile** (`docs/31`) via `PATCH /scheduled-tasks/:id {enabled}` | `enable: [...]`, `disable: [...]` |
| `effect` | `POST /scheduled-tasks/:id/fire-now` or a direct GEM dispatch | `effectId`, `presetId`, `params` |

Everything an action does is a call the engine **already exposes** (the Explore
pass confirmed the routes exist: `/deck/playlist`, `/deck/playlist/entry`,
`/deck/playlist/autopilot`, `/scene`, `/control`, `/scheduled-tasks*`). The
Timeline Companion is a *driver*, not a new execution path — no rendering, no
sACN, no CPC ownership. That keeps the engine the single executor (and keeps the
companion testable in isolation).

### 3.3 "Look" = the special-playlist feature

The operator's "special playlist features" land as a **Look**: a named bundle so
one cue sets the whole vibe.

```yaml
looks:
  philharmonic:
    playlist: chill_night
    autopilot: { active: true, delay_s: 90, shuffle: false }
    palette: sunset_coral          # from config.yaml colorPalettes[].id
    globals: { master: 0.8 }
  party:
    playlist: late_night_tech
    autopilot: { active: true, delay_s: 30, shuffle: true }
    palette: bass_drop
    globals: { master: 1.0 }
    tasks: { enable: [hazer-main, uv-strobe] }   # docs/31 interval tasks
  sunrise:
    playlist: morning_glow
    autopilot: { active: true, delay_s: 120, shuffle: false }
    palette: aurora
    globals: { master: 0.6 }
```

A `look` action just names one of these. This is the heart of the "trigger a
playlist based on time / mood / event" request: **cue → look → playlist (+ the
supporting palette/globals/tasks)**.

### 3.4 Phases (named windows) and the mood gate

A **phase** is a named span anchored to clock/sun events — e.g. `party_night =
[sunset+2h, sunrise-1h]`. Phases do two jobs:

1. They can themselves be a trigger (`phase: party_night` cue fires at window
   start).
2. They **gate mood triggers.** Calm→party should swap playlists *during the
   party window*, but a loud daytime soundcheck shouldn't yank the daytime look.
   So a `mood` cue carries `whenPhase: party_night` and only arms inside it.

```yaml
phases:
  philharmonic: { start: { sun: sunset, offsetMin: -30 }, end: { sun: sunset, offsetMin: 60 } }
  party_night:  { start: { sun: sunset, offsetMin: 120 }, end: { sun: sunrise, offsetMin: -60 } }
  sunrise_set:  { start: { sun: sunrise, offsetMin: -30 }, end: { sun: sunrise, offsetMin: 90 } }
```

### 3.5 Full show-plan example

```yaml
# simulation/scenes/titanic/timeline/playa_default.yaml
schemaVersion: 1
name: playa_default
location: { lat: 40.7864, lon: -119.2065, tz: America/Los_Angeles, elevationM: 1190 }

phases:
  philharmonic: { start: { sun: sunset, offsetMin: -30 }, end: { sun: sunset, offsetMin: 60 } }
  party_night:  { start: { sun: sunset, offsetMin: 120 }, end: { sun: sunrise, offsetMin: -60 } }
  sunrise_set:  { start: { sun: sunrise, offsetMin: -30 }, end: { sun: sunrise, offsetMin: 90 } }

looks:
  daytime:      { playlist: ambient_day,     palette: deep_sea,     globals: { master: 0.5 } }
  philharmonic: { playlist: chill_night,     palette: sunset_coral, autopilot: { active: true, delay_s: 90 } }
  party:        { playlist: late_night_tech, palette: bass_drop,    autopilot: { active: true, delay_s: 30, shuffle: true } }
  sunrise:      { playlist: morning_glow,    palette: aurora,       globals: { master: 0.6 } }

cues:
  - id: c_visibility_on
    label: "Exterior up at golden hour"
    trigger: { type: sun, event: sunset, offsetMin: -45 }
    action:  { type: look, look: philharmonic }

  - id: c_party_start
    label: "Party night ramp"
    trigger: { type: phase, phase: party_night }
    action:  { type: look, look: party }

  - id: c_mood_to_party
    label: "Follow the DJ: calm → party"
    trigger: { type: mood, from: calm, to: party, minDwellSec: 20, cooldownSec: 300, whenPhase: party_night }
    action:  { type: playlist, name: late_night_tech, autopilot: { active: true, delay_s: 30, shuffle: true } }

  - id: c_sunrise
    label: "Sunrise wind-down"
    trigger: { type: sun, event: sunrise, offsetMin: -15 }
    action:  { type: look, look: sunrise }
```

### 3.6 Runtime state (assignment)

```yaml
# marsin_engine/states/titanic/timeline_state.yaml
activePlan: playa_default
mode: armed            # armed | holding | paused | overridden
lastFiredCueId: c_party_start
lastFiredAtMs: 1718900000000
currentPhase: party_night
currentMood: party
manualHoldUntilMs: null
```

---

## 4. The tick loop & trigger evaluation

The companion runs **one tick** (1 s cadence — sub-second precision is
meaningless for sun/clock cues, and mood already has its own hysteresis). The
loop is a pure function of `(now, plan, state, moodSnapshot)` → `firedCues[]`,
which makes it **trivially unit-testable with a simulated clock**.

```
on each tick (now):
  recompute today's sun events for plan.location  (cached per calendar day)
  resolve absolute fire-times for clock/sun cues   (today, with offsets)
  resolve phase windows; update state.currentPhase

  for each enabled cue:
    clock/sun: fire when now crosses the resolved time (once per day; edge-latched)
    phase:     fire on phase-start edge
    mood:      fire on the from→to edge of audioParty, IF whenPhase active,
               AND dwelled ≥ minDwellSec, AND ≥ cooldownSec since last mood fire
    manual:    never auto-fires

  on fire:
    if mode == paused or overridden → record "would fire", DO NOT dispatch
    else dispatch action via engine_link (REST), set lastFiredCueId/At, broadcast
```

- **Edge-latched, no replay.** Like `docs/31`, a missed cue (companion was down
  across its time) is **not** replayed on restart. On boot we mark any cue whose
  time already passed today as "already fired" so we don't fire a 20:00 cue at
  21:00 startup. (Configurable `catchUp: latest` could fire the *most recent*
  passed cue to restore the right look after a crash — recommend default off,
  decide in review — see open questions.)
- **Mood source.** The companion **subscribes to the engine's param-broadcast
  WS** (the same canonical feed CaptainPad gets) and reads `audioParty` (0/1, the
  PartyMode gate) and `audioStructure` (0..2). It does **not** re-analyze audio —
  the Audio Companion remains the sole analyzer (`docs/37`). Calm = `audioParty
  0`, party = `audioParty 1`; PartyMode already hysteresis-debounces, and we add
  `minDwellSec` + `cooldownSec` on top so playlists never flap.

---

## 5. Offline sun math (deployment-critical)

The playa has **no internet** (codex P0 offline rule). Sunset/sunrise must be
computed locally. We vendor a small, dependency-free **NOAA solar-position**
implementation (the same math behind SunCalc — public-domain algorithm, ~150
lines, no network, no data files):

- Inputs: date, latitude, longitude, (timezone for display).
- Outputs: `sunrise, sunset, civilDawn, civilDusk, nauticalDusk, goldenHourStart,
  goldenHourEnd, solarNoon`.
- Burning Man / Black Rock City default location pre-filled (≈ 40.7864 N,
  −119.2065 W), operator-overridable per plan.
- **Unit-tested** against published BRC sunrise/sunset tables for the event week
  (tolerance ±1–2 min). This is the single highest-value remote test — pure math,
  no rig needed.

We deliberately **vendor the algorithm, not the `suncalc` npm package at runtime**
— offline readiness means the code ships in the tree (`companions/timeline/sun.js`).

---

## 6. Conflict, takeover & failure semantics

Codex P0: **no fallback behaviors, fail loud.**

- **Manual takeover.** Operator can `pause` (timeline stops dispatching, keeps
  tracking), `hold` (freeze current look for N minutes), or fire any cue
  manually. While `paused`/`overridden`, auto-cues are recorded as "would fire"
  but not dispatched — visible in the UI, never silent.
- **Who wins the deck.** The timeline drives the deck playlist/autopilot, but a
  manual CaptainPad change flips `mode → overridden` until the next phase
  boundary or an explicit "resume" — so the operator's hands always win, and the
  UI says so plainly.
- **Loud failures.** A cue pointing at a missing playlist / scene / palette /
  effect sets the cue `status: error` with a red `lastError` and does **not**
  silently skip (matches `docs/31`'s failure stance). Validation at plan-load
  time rejects unknown looks/playlists referenced by cues.
- **Engine offline.** Dispatch is REST; if the engine is unreachable the cue is
  marked failed/retry-surfaced (not hidden). The companion keeps ticking and
  reconnects (the Audio Companion's reconnect logic is the template).
- **Clock integrity.** Cues fire off the host clock; we log the resolved
  fire-times at boot so the operator can sanity-check the day's schedule. No NTP
  on playa — the host clock is authority; document the runbook step to set it.

---

## 7. Engine & API surface

### 7.1 Timeline Companion HTTP/WS (`:6965`, proposed)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/plans` | list show plans for the active scene |
| `GET` | `/plans/:name` | full plan (phases, looks, cues) |
| `POST` | `/plans` | create/overwrite a plan (validates) |
| `GET` | `/state` | runtime: active plan, mode, currentPhase/mood, next cue + countdown, today's sun times |
| `POST` | `/plan/activate` | `{name}` — load a plan as active |
| `POST` | `/mode` | `{mode: armed\|paused}` |
| `POST` | `/hold` | `{minutes}` — freeze current look |
| `POST` | `/cues/:id/fire` | manually fire a cue now |
| WS | `/ws` | live `timelineState` (mode, currentPhase, mood, next cue, countdowns, errors) |

CaptainPad reads/writes this exactly as it reads the Audio Companion / engine —
thin UI, server owns truth, two iPads see the same countdowns.

### 7.2 What the companion calls on the engine (existing routes)

`POST /deck/playlist`, `POST /deck/playlist/autopilot`, `POST /deck/playlist/entry`,
`POST /scene`, `POST /control`, `GET/PATCH /scheduled-tasks*`,
`GET /playlists` (validate cue targets), `GET /param-center/schema` + WS
`/ws/params` (mood). No new engine endpoints required for v1 — confirmed present.

---

## 8. CaptainPad — Timeline tab (design, later slice)

A new **TIMELINE** tab (sidebar, near SCHEDULER). A vertical **day ribbon**:

```
┌──────────────────────────────────────────────────────────────┐
│ TIMELINE — playa_default            [ARMED ▾]  [+ CUE] [HOLD] │
│  ──────────────────────────────────────────────────────────  │
│  18:42 ☀ golden hour     ● philharmonic look                  │
│  19:27 🌅 sunset                                              │
│  20:12 ──────────────────  NOW ►  mood: ● PARTY               │
│  21:27 🌃 party_night     ● party look      next in 1h 15m    │
│  06:14 🌄 sunrise -15m    ● sunrise look                      │
│  ──────────────────────────────────────────────────────────  │
│  [○] mood: calm→party (party_night)  → late_night_tech        │
└──────────────────────────────────────────────────────────────┘
```

- Sun events drawn from `/state` (computed offline by the companion).
- "NOW" marker + countdown to next cue; mood pill from `audioParty`.
- Cue rows reuse the SCHEDULER's pill/stepper idiom (zero keyboard, `docs/31`).
- A standalone companion UI (`companions/timeline/ui/`) mirrors the Audio
  Companion's design surface for headless/remote bring-up & screenshots.

CaptainPad work is a **later slice** — sequence it after the engine/companion
core to avoid churn (same discipline as `docs/37 §11`).

---

## 9. Build phases

| Phase | Scope | Deliverable | Remote-testable? |
|---|---|---|---|
| **0** | Design + tracker (this doc + report) | reviewable design | ✅ (docs only) |
| **1** | Companions framework | launcher `companions` list; `companion_base.js`; timeline child spawns + health-probes; config `companions.timeline` block | ✅ (launch/health smoke) |
| **2** | Timeline core (headless) | `sun.js`, `triggers.js`, `show_plan.js`, `timeline_server.js`, `engine_link.js`; clock/sun/phase cues fire playlists/scenes/looks; state persistence | ✅ (unit: sun + simulated-clock triggers; e2e: sim+engine+timeline, fire-now → screenshot) |
| **3** | Mood triggers | WS subscribe to `audioParty`/`audioStructure`; dwell+cooldown; phase-gated calm→party playlist swaps | ✅ (drive Audio Companion `test` source loud/quiet → observe swap + screenshot) |
| **4** | CaptainPad TIMELINE tab | day ribbon, countdowns, mood pill, manual fire/hold/pause | ⚠ mostly (web build + screenshot remotely; final feel on local iPad) |

Each phase: build → bring up the stack → capture sim/CaptainPad screenshots as
evidence → push to `feat/timeline_support`. The local agent then validates on
real hardware where needed (Phase 4 iPad feel; any real-mic mood timing).

---

## 10. Remote testability (the dev-cycle fit)

This subsystem is **unusually friendly to full remote testing**, which suits the
"remote agent develops, evidences, pushes; local agent validates" loop:

- **Pure-function cores.** Sun math and trigger evaluation take an injected clock
  and a mood snapshot → deterministic unit tests, no rig.
- **Accelerated/simulated clock.** A test/dev mode advances the companion clock
  fast (or `fire-now` per cue) so a "full night" runs in seconds — capture the
  sim recoloring as each look fires.
- **Mood without a real mic.** The Audio Companion's **`test` source** already
  synthesizes loud/quiet audio; toggling it drives `audioParty`, exercising the
  mood path end-to-end in the container.
- **Evidence.** `agent_render.cjs` screenshots of the sim before/after each cue;
  `--show-ui` capture of the CaptainPad timeline tab. (`.agent/01_skills/00_see_the_world.md`.)

Auto-check specs (`.agent/00_gol/03/04/05`) for the touched subsystems run before
any merge-ready claim, plus new tests: `sun.test.js`, `triggers.test.js`,
`show_plan.test.js`, `timeline_engine_link.test.js`.

---

## 11. Ports (add to `.agent/00_gol/13_multi_agent.md`)

| Service | Default | Source of truth |
|---|---|---|
| Timeline Companion (HTTP/WS) | `6965` | `config.yaml::companions.timeline.port` / `--port` |

(6966 = Audio Companion; 6967 = CaptainPad web; 6968 = engine; 6969–6972 = sim.
6965 is free and adjacent.)

---

## 12. Open questions for the operator (please mark up)

1. **Crash catch-up.** After a restart mid-show, should the timeline fire the
   *most recent* passed cue to restore the right look (`catchUp: latest`), or
   stay quiet until the next cue? (Recommend: catch up the latest **look** cue so
   the rig isn't stuck on the wrong vibe; never replay one-shot effects.)
2. **Mood authority window.** Should calm→party swaps be allowed only inside
   `party_night` (recommended), or any time after sunset?
3. **"Philharmonic sunset" offset.** What offset defines it — `sunset −30m`
   start? And is it its own playlist or a "look" bundle (recommend look)?
4. **Scene switch vs look.** Big phase changes — do you want full **scene/model**
   swaps (heavier, engine restart via exit-75) or just playlist+palette **looks**
   within one scene (lighter, instant)? Recommend looks for the nightly arc,
   scenes only for genuinely different rigs.
5. **Location.** Confirm BRC lat/lon/elevation + that the host runs `America/
   Los_Angeles` (PDT, UTC−7) during the event.
6. **Companion relocation.** OK to move `audio/companion/` under
   `companions/audio/` as part of Phase 1, or keep it in place and only add the
   timeline child (less churn now)? Recommend: keep audio in place for v1, just
   teach the launcher a `companions` list.

---

## 13. Multi-channel mixer support (stretch)

The deck is one channel; the live mix is a **deck + up to 3 overlay mixer
channels** (`pattern_mixer.js`, `maxChannels` default 3), each its own
`PatternChannel` with **its own `playlist` assignment** already persisted in
`mixer_state.yaml`. The timeline should be able to drive cues onto *any* of them
(e.g. sunset brings up an exterior wash on the deck while a mixer channel runs a
slow room-light playlist), so this is a first-class design consideration, gated
behind a small engine refactor.

### 14.1 What already works today (no engine change)

The Explore pass confirmed the per-channel **data + control surface is complete**:

- `mixer_state.yaml` persists `channels[].playlist = { name, activeEntryId,
  cursor, autopilot }` per overlay channel (state_manager.js `saveMixerState`).
- `loadPlaylistEntry(channel, …)` is **channel-agnostic** — the same function
  serves deck and mixer.
- Live routes exist: `GET/POST /mixer/channels/:id/playlist`,
  `POST /mixer/channels/:id/playlist/entry` (+ `/capture`, `/discard`).

So a Timeline cue can **already** load a playlist and step entries on a specific
mixer channel today, with **zero** engine work — by adding a `target` to the
action:

```yaml
cues:
  - id: c_rooms_evening
    trigger: { type: sun, event: sunset, offsetMin: -60 }
    action:
      type: playlist
      target: { channel: mixer, id: ch_rooms }   # deck (default) | mixer:<id> | all
      name: room_glow
      autopilot: { active: true, delay_s: 120 }
```

`target` resolution: `deck` → `/deck/playlist*`; `mixer:<id>` →
`/mixer/channels/:id/playlist*`; `all` → fan out to every channel.

### 14.2 The one real gap: per-channel autopilot *cycling*

What does **not** exist is the per-channel autopilot **loop**. `Autopilot` is a
**single global instance hard-wired to the deck** (`autopilot.js`; instantiated
in `api_server.js` reading `mixer.getDeckChannel().playlist`). There is no
per-channel timer and no `POST /mixer/channels/:id/autopilot` route. This is
exactly the open item in `docs/19` **Phase 2.3** ("extend autopilot to
independently schedule multiple mixer channels") — 2.1/2.2 (state + routes)
already shipped; only the loop remains.

So `action.autopilot:{active:true}` on a mixer channel has **nowhere to run**
today. Two ways to close it:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A — Engine owns per-channel autopilot** (recommended) | Refactor `Autopilot` from one deck-bound instance into an **autopilot pool** (one per channel, keyed by channel id), driven by the per-channel `playlist.autopilot` already in state. Add `POST /mixer/channels/:id/autopilot`. | Cycling is frame-accurate, survives the companion being down, finishes `docs/19` properly, benefits CaptainPad directly (manual per-channel autopilot too) | A real (if modest) engine change — the data model is ready, only the loop + route are new |
| **B — Companion drives cycling** | The Timeline Companion runs its own per-channel timers and POSTs `/mixer/channels/:id/playlist/entry` on each tick. | No engine change; ships immediately | Re-implements autopilot outside the engine (shuffle, dwell, transition-await) → drift from deck autopilot; a *second* cycler to reason about; only cycles while the companion is up |

### 14.3 Best way forward (recommendation)

**Do Option A, but stage it so nothing blocks on it.**

1. **Phase 2 (timeline core) targets channels via the existing routes** —
   `target: deck | mixer:<id> | all` for the `playlist` / `look` actions. This
   gives multi-channel **loading** immediately, no engine change, fully
   remote-testable (load a room playlist on a mixer channel, screenshot the sim).
2. **Promote the engine autopilot to a per-channel pool** as a small, focused
   slice (its own commit, ideally its own review) — it's the natural completion
   of `docs/19` Phase 2.3 and the data/state are already in place. Keep one
   shared scheduler with a `Map<channelId, autopilotState>` rather than N loose
   timers, so pause/generation semantics stay identical to today's deck loop.
3. **Timeline drives autopilot at the assignment level only** — a cue sets
   `{playlist, autopilot:{active,delay_s,shuffle}}` per target channel; the
   **engine** owns the cycling timers. The companion never runs its own pattern-
   cycling loop (avoids Option B's drift and keeps "engine = executor"). This is
   the clean division: **companion decides *which playlist on which channel and
   whether autopilot is on*; engine decides *when to advance entries*.**

Net: multi-channel **loading** lands in the timeline's first functional phase
with no engine work; multi-channel **auto-cycling** lands when the
already-scoped `docs/19` Phase 2.3 autopilot-pool refactor is done — and the
timeline consumes it for free because it only ever sets the per-channel
`autopilot` assignment the engine already persists.

> **Recommendation in one line:** make the timeline channel-aware from day one
> (it costs nothing — the routes exist), and finish `docs/19` Phase 2.3 (engine
> per-channel autopilot pool) as the enabling slice for true multi-channel
> auto-cycling, rather than re-implementing cycling inside the companion.

---

## 14. What this deliberately is **not** (v1)

- **Not** a second analyzer — mood comes from the Audio Companion via CPC.
- **Not** a replacement for `docs/31` interval tasks — it can *enable* them.
- **Not** a render/effect path — it only calls existing engine routes.
- **Not** multi-day calendaring — it computes *today's* sun events each day; a
  plan repeats nightly (weather/special-night overrides are a later idea).
- **Not** a programmer/conditional engine — cues are `trigger → action`, no
  branching logic (sequences = multiple cues).
```
