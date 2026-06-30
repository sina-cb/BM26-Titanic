# 38 — Timeline / Show Director (event & mood-driven playlists)

**Status:** v1 — **Phases 1, 2, 2.5, 3 BUILT + live-validated** on
`feat/timeline_support` (2026-06-19); Phase 4 (CaptainPad tab) in progress. See
the tracker for status + evidence. Original design below is unchanged.
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

## 14. Control precedence & arbitration (operator model, 2026-06-19)

> Refines §6. The timeline is not a flat cue list — it is a **layered arbiter**.
> Operator's words: *"Autopilot regular programming, changing moods as needed
> unless there's a preprogrammed program; sunrise everyday has a show. The
> scheduled programming is priority and overrides the autopilot. Autopilot can
> also be disabled and just manually controlled — and these must work nicely
> together."*

### 14.1 The three control layers (highest priority wins)

| Layer | What it is | Beats |
|---|---|---|
| **MANUAL / paused** | Operator takeover — `paused` (timeline drives nothing) or `overridden` (operator changed the deck out-of-band). Full manual. | everything |
| **PROGRAM** | A **preprogrammed show** — a scheduled cue (`kind: program`) like the daily sunrise show or a fixed-time set. Holds priority for its window; **overrides autopilot** and **suppresses mood swaps**. | autopilot |
| **AUTOPILOT** (regular programming) | The baseline: the **engine autopilot** cycles the configured playlist **and mood cues fire** "as needed." Toggleable off → manual. | — |

### 14.2 The arbiter (runs each tick, after `evaluateTick`)

```
expire activeProgram if now ≥ activeProgram.untilMs
  → program ends → if autopilotEnabled: RESUME autopilot (re-apply baseline
    playlist + engine autopilot ON); else → manual idle

controller :=
  paused / overridden / holding → 'manual'   (drive nothing; hold keeps the look)
  activeProgram active          → 'program'
  autopilotEnabled              → 'autopilot' (ensure engine autopilot ON; mood allowed)
  else                          → 'manual'    (autopilot off; operator drives; programs still preempt)

for each fired cue:
  kind 'program' (and not paused/overridden): START program — apply its look,
      turn engine autopilot OFF, set activeProgram {cueId, untilMs}; controller='program'
  kind 'mood': apply ONLY when controller would be 'autopilot' (suppressed under
      program/manual). This is "moods as needed unless there's a program."
  kind 'ambient'/other: apply when not manual.
```

So: **scheduled programs always preempt autopilot** (priority), **mood only moves
the lights during autopilot**, and **disabling autopilot** hands the deck to the
operator while **scheduled shows still fire on time** (and a program ending
returns to manual rather than resuming autopilot). `paused`/`overridden` is the
operator's hard takeover above all of it (§6 "operator's hands always win").

### 14.3 Schema additions

```yaml
# plan-level baseline (the AUTOPILOT layer)
autopilot:
  enabled: true
  playlist: night_rotation     # the regular-programming playlist
  delay_s: 45
  shuffle: true
  target: { channel: deck }
  mood: true                   # do mood swaps run during autopilot?

cues:
  - id: c_sunrise_show
    kind: program              # program | mood | ambient  (default: mood-trigger→mood, else program)
    trigger: { type: sun, event: sunrise, offsetMin: -15 }
    action:  { type: look, look: sunrise }
    hold:    { min: 90 }       # program owns priority 90 min (or hold.until: <anchor>,
                               #   or omit → until the next program cue)
```

### 14.4 Runtime state additions

```yaml
autopilotEnabled: true
controller: autopilot          # autopilot | program | manual  (derived, surfaced to UI)
activeProgram: { cueId, startedAtMs, untilMs } | null
```

### 14.5 Operator controls (companion REST + CaptainPad)

`POST /autopilot {enabled}` (toggle the baseline layer) · `POST /mode {paused}` ·
`POST /hold {minutes}` · `POST /resume` (clear pause/override) ·
`POST /cues/:id/fire` (manual program fire) · `POST /program/end` (end the active
program early → fall back to autopilot). The CaptainPad tab shows the live
**controller** (PROGRAM / AUTOPILOT / MANUAL), the autopilot toggle, and the
active program + its countdown.

### 14.6 The companion is a *designer + scheduler helper* (may migrate to CaptainPad)

The companion **owns the schedule brain** today (authoring plans, computing
sun/phase, arbitrating, driving the engine). It is explicitly a **design +
scheduler aid**, and the control surface **may eventually move wholly into
CaptainPad**. Architecture keeps that open: the companion only ever calls the
engine's public REST/WS (no private engine coupling), the plan/state are plain
YAML, and the arbiter is a **pure function** — so the same logic could later run
inside CaptainPad or be folded into the engine with no semantic change.

---

## 15. v2 architecture — timeline IN the engine + 8-day festival maker (operator 2026-06-19)

> Operator decision: *"Move the timeline companion into the engine, have
> CaptainPad be the only UI for it (keep in theme), and make a super-fluid
> timeline maker. Optimized for Burning Man — an 8-day plan must be easily
> viewable on the UI."* This **supersedes** the standalone-companion transport of
> §2/§7 (the **behavioral** model — cues, looks, sun math, mood, precedence
> §14 — is unchanged). The companion's `companions/timeline/*` pure cores
> (`sun.js`, `triggers.js`, `arbiter.js`, `show_plan.js`) move verbatim into the
> engine; they were written IO-free precisely so this is a relocation, not a
> rewrite (foreshadowed §14.6).

### 16.1 Timeline as an engine service
- `marsin_engine/lib/timeline/` holds the relocated pure cores + a new
  **`timeline_service.js`** modeled on `scheduled_tasks.js`: owns the plan
  library (`simulation/scenes/<scene>/timeline/*.yaml`), runtime state
  (`states/<scene>/timeline_state.yaml`), and a **single in-engine tick** (1 s).
- It reads mood **directly from CPC** (`paramCenter.get('audioParty')`) — no WS
  subscription, no `engine_link`. The audio companion already populates that key.
- It applies actions by calling the engine's **internal** functions
  (`loadPlaylistEntry`, the `AutopilotPool`, `paramCenter` writes, scene switch)
  — no HTTP self-calls. `actions.js`/`engine_link.js` from the companion are
  **deleted**; their intent becomes direct calls.
- **Removed:** `companions/timeline/timeline_server.js`, `engine_link.js`,
  `actions.js`, `ui/`, `timeline_config.js`, the `:6965` port, and the launcher
  timeline child (`companions` registry keeps only `audio`). Timeline config
  moves to a `timeline:` block in `marsin_engine/config.yaml`.
- **Engine API** (on the existing :6968 + control WS): `GET /timeline/state`,
  `GET/POST /timeline/plans`, `GET/PUT/DELETE /timeline/plans/:name`,
  `POST /timeline/plan/activate`, `POST /timeline/mode`, `POST /timeline/autopilot`,
  `POST /timeline/hold|resume|program/end`, `POST /timeline/cues/:id/fire`, and a
  `timelineState` broadcast on the control topic. Plan-CRUD endpoints back the
  **maker**.

### 16.2 8-day festival model (`schemaVersion: 2`)
A plan spans the festival, not one night:
```yaml
schemaVersion: 2
name: brc_2026
location: { lat, lon, tz, elevationM }
festival: { startDate: '2026-08-30', days: 8 }   # the span the UI lays out
autopilot: { enabled, playlist, delay_s, shuffle, mood }   # baseline, all days
looks: { ... }
phases: { ... }                                   # sun-anchored, recomputed per date
cues:
  - id, label, kind, trigger, action, hold
    days: 'all' | [0,2,5] | ['2026-09-05']        # recurring daily, day-indices, or dates
```
- **Runtime stays simple:** each tick the service selects the cues whose `days`
  match **today's** festival day, resolves that date's sun/clock times, and runs
  `evaluateTick` + the §14 arbiter. Multi-day lives in the *plan + UI*; the tick
  is always "today."
- **Recurring** (`days:'all'`) = the bulk (sunrise show, sunset visibility,
  autopilot/mood). **Day-specific** = the special nights (Burn, Temple).
- Sun events are computed **per date** (already supported by `sun.js`), so each
  of the 8 days shows its own (drifting) sunrise/sunset.

### 16.3 CaptainPad = the only UI, and a fluid *maker*
- The existing timeline tab's `timelineApi` repoints from `:6965` to the **engine
  base** (`api_base`) — simpler, one origin.
- **Viewer + Maker in one themed tab:**
  - **8-day overview:** a horizontally-scannable strip of 8 day-cards, each with
    its sun arc (sunrise→sunset shading) and its cue markers at their times; the
    current day/now highlighted.
  - **Day editor:** tap a day → its vertical timeline; **add/move/edit/delete
    cues** fluidly (pick trigger = clock time or sun-anchor±offset; action = look/
    playlist/scene/program; `kind`; `days` applicability recurring-vs-this-day);
    pill/stepper inputs, no keyboard walls — matches the deck/scheduler idiom.
  - Live **controller** banner (PROGRAM / AUTOPILOT / MANUAL §14), autopilot
    toggle, mood pill, active-program countdown.
  - Save → `POST /timeline/plans` (authored show content, versioned in the scene
    tree). Best-practice **starter template** prefilled for BRC (sunrise shows +
    nightly autopilot + party-night) so the operator edits rather than starts blank.

### 16.4 Migration note
This is a feature-branch refactor; the §1–§15 behavioral spec and all tests
carry forward. Net simplification: one process, one API surface, direct CPC/
mixer access, and the only UI is CaptainPad.

---

## 16. The Handoff Protocol (normative, operator 2026-06-19)

> Operator: *"I don't want the rig stuck on a pattern after a scheduled program
> runs. And in manual mode, if a scheduled program is due, show a sign for the
> operator to enable it; if no action in 30 s, expire the lease and start the
> program. Make it a proper protocol — don't miss any variation."*

This section is **normative**: it enumerates **every** control-handoff variation
and the exact action for each. The §14 arbiter implements it; the §16.7
validation matrix proves it. The governing promise: **the lights are never
silently wrong and never accidentally stuck.**

### 16.1 Control owners (who is driving the deck)

| Owner | Meaning | Driving? |
|---|---|---|
| **AUTOPILOT** (`AP`) | regular programming — engine autopilot cycles the baseline playlist; mood swaps fire | yes, actively cycling |
| **PROGRAM** (`PG`) | a scheduled show owns the deck for its window (`activeProgram`) | yes, holding the show look |
| **MANUAL** | operator owns the deck. Sub-states: `PAUSED` (explicit pause), `IDLE` (autopilot disabled, no program), `HOLDING` (look frozen for N min, auto-expires), `OVERRIDDEN` (operator changed the deck out-of-band — detection is a follow-up) | operator drives |
| **PENDING** | not an owner — a **lease** armed *on top of* a MANUAL sub-state while a program is due (`pendingProgram`) | the current manual owner still drives until the lease resolves |

`controller ∈ {autopilot, program, manual}` is the derived field surfaced to the
UI; `pendingProgram` and the manual sub-state are surfaced alongside it.

### 16.2 Invariants (the promises every transition must keep)

- **I1 — never stuck.** Control always converges to an owner that is *actively
  cycling* (AP) or is *deliberate manual*. A program ending NEVER leaves the rig
  frozen on the program's last pattern.
- **I2 — the show goes on.** A due **program** is never silently skipped: in AP it
  preempts immediately; in MANUAL it arms a lease that auto-starts after the
  window unless the operator dismisses it.
- **I3 — operator visibility & say.** Every pending takeover is shown (a "sign")
  with ENABLE / KEEP-MANUAL; a dismiss sticks for the day.
- **I4 — fail loud.** A handoff that cannot complete (missing playlist entries,
  invalid tz) records a loud `cueError`/`lastError` — never a silent wrong look.
- **I5 — single driver *per channel*.** Exactly one owner drives a given channel.
  A preempting program disarms the previous owner's autopilot **on the channels
  the program actually drives** (its target: deck | mixer | all). An *independent*
  operator-armed autopilot loop on a **different** channel (e.g. a room-light
  mixer overlay running while a program owns the deck) is intentionally left
  alone — separate channels, separate drivers, no conflict. "Single driver"
  is per-channel, not rig-wide.
- **I6 — restart-safe.** Across engine restart / scene switch, runtime owner state
  (`activeProgram`, `pendingProgram`) is **re-derived** from plan + wall-clock,
  never resumed stale; already-passed cues are latched (no replay).

### 16.3 Trigger vocabulary

`P-due` scheduled program comes due · `P-end` program window ends (hold expiry /
`/program/end` / superseded) · `P-new` a newer program comes due while one is
active · `M-edge` mood calm→party edge · `pause` · `resume` · `ap-off` ·
`ap-on` · `hold(N)` · `hold-exp` · `fire` (operator manual cue fire) ·
`lease-enable` · `lease-dismiss` · `lease-exp` · `boot` (restart/scene-switch
catchUp) · `midnight` (day rollover).

### 16.4 The full transition matrix (no variation omitted)

| From \ Trigger | P-due | P-end | M-edge | pause | resume | ap-off | ap-on | hold(N) | hold-exp | fire | boot | midnight |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AP** | →PG: disarm baseline target, apply show, set `activeProgram` | — | →AP: apply mood look (no owner change) | →PAUSED: disarm autopilot, keep look | — | →IDLE: disarm autopilot | — | →HOLDING: freeze look | — | →PG (program)/apply | re-derive (I6) | reset `firedToday`; AP continues |
| **PG** | (latched; same prog ignored) | **→AP** if ap-on: resume baseline (re-load playlist + re-arm) ; **→IDLE** if ap-off: hold look (deliberate, I1) | suppressed (→`wouldFire`) | →PAUSED: suspend program | — | sets ap flag; on P-end→IDLE | sets ap flag; on P-end→AP | →HOLDING | — | →PG′ (replace) | re-derive | a midnight-spanning program continues |
| **P-new while PG** | **→PG′**: replace `activeProgram`, re-disarm/apply new show | | | | | | | | | | | |
| **PAUSED** | **arm lease** (PENDING) | n/a | suppressed | — | →AP/PG/IDLE via arbiter re-eval | (already manual) | →AP (or →PG if pending) | →HOLDING | n/a | →PG/apply (fire overrides) | re-derive | reset `firedToday` |
| **IDLE** (ap-off) | **arm lease** (PENDING) | n/a | suppressed | →PAUSED | — | — | →AP (pending? →PG) | →HOLDING | n/a | →PG/apply | re-derive | reset `firedToday` |
| **HOLDING** | **arm lease** (PENDING) | n/a | suppressed | →PAUSED | →AP/PG/IDLE | →IDLE | →AP | — | →AP/PG/IDLE via re-eval | →PG/apply | re-derive | reset `firedToday` |
| **PENDING** (lease armed, on any manual) | `P-new` replaces the pending | n/a | suppressed | stays pending | re-eval (pending survives) | stays pending | **→PG** (program fires) | stays pending | re-eval | →PG (fire) | re-derive (drop stale pending) | reset |
| | **lease-enable → PG now** · **lease-dismiss → manual, latch `firedToday`** · **lease-exp → PG auto-start (show goes on, I2)** | | | | | | | | | | | |

Reading the key rows: **P-end** is the "never stuck" row (I1) — autopilot resumes
or manual is deliberate. **P-due in any manual sub-state** is the lease row (I2/I3).
**M-edge** only changes the *look* under AP (never a controller change) and is
suppressed everywhere else (recorded in `wouldFire`, not lost silently).

### 16.5 Pending-program lease — state machine

```
            P-due (in any MANUAL sub-state)
                     │
                     ▼
   ┌─────────────────────────────────────────┐
   │ PENDING  pendingProgram = {              │   newer P-due
   │   cueId, label, action, armedAtMs,       │◀───────────────  replace
   │   expiresAtMs = armedAtMs + leaseSec*1000│
   │ }  (leaseSec = config.timeline.programLeaseSec, default 30)
   └───────┬──────────────┬───────────────┬───┘
   lease-enable      lease-dismiss     lease-exp (now ≥ expiresAtMs)
   /program/enable   /program/dismiss   (no operator action)
        │                  │                 │
        ▼                  ▼                 ▼
   start NOW          cancel; stay      auto-start the
   exit manual,       manual; latch     program (show goes on);
   →PG                firedToday[cue]   exit manual, →PG
                      (sticks today)
   ap-on while pending → program fires (→PG), lease cleared
```

Rules: **one** pending lease at a time (a newer due program replaces an
un-actioned one); the lease applies to **program** cues only (mood/ambient never
arm a lease); on `boot` a stale `pendingProgram` is dropped and re-derived.

### 16.6 Cross-cutting handoff variations (the easy-to-miss ones)

- **Engine restart / scene switch (`boot`)** — catchUp clears `activeProgram` +
  `pendingProgram`, then re-derives: a program whose window still covers *now* →
  PG (restore look); else autopilot-enabled → AP (establish baseline); else IDLE.
  Passed cues are latched (no replay). [verified: stale-ghost discard]
- **Missing baseline playlist on resume/boot** — fail loud (`cueError`), do NOT
  load a `_missing` pattern; surface so the operator fixes it (I4). [fixed]
- **Program whose look targets `mixer`/`all`** — preempt disarms the baseline on
  *its* target(s), not just the deck (I5). [fixed]
- **Mood edge on the exact program-expiry tick** — resume is applied *before* the
  mood action so the mood look wins, not the baseline (no clobber). [fixed]
- **Day rollover mid-program** — a program with `untilMs` on the next day keeps
  running; `firedToday` resets so the next day's cues arm.
- **pause / hold actually FREEZE the deck** — the service reconciles the engine
  baseline autopilot to the controller every tick (armed iff `controller ===
  'autopilot'`), transition-gated so it never resets the autopilot timer. So
  `pause`/`hold` disarm the baseline (deck stops cycling), and `resume` /
  hold-expiry re-arm it and **continue from the current entry** (no jump to the
  first). Independent operator-armed overlays on other channels are untouched
  (I5 per-channel).
- **scene-switch race** — a `scene` action triggers an engine restart (exit-75)
  that stops the service mid-tick; the tick checks for that after its awaits and
  skips the trailing persist/broadcast against a stopping engine.
- **Operator `fire` always wins** — a manual cue fire applies immediately
  regardless of mode/lease (it is an explicit operator act).
- **Lease + `ap-on`** — enabling autopilot while a lease is pending starts the
  program (it was due) rather than just resuming autopilot.

### 16.7 What the operator sees + validation matrix

`timelineState` carries: `controller`, `activeProgram{cueId,untilMs}`,
`pendingProgram{cueId,label,expiresAtMs}`, `autopilotEnabled`, `mode`. CaptainPad
renders the controller pill, the active-program countdown + END, and — when a
lease is armed — a prominent **"⚠ SCHEDULED SHOW PENDING — <label> · starts in
M:SS"** banner with **[ENABLE NOW]** / **[KEEP MANUAL]**.

Routes: `POST /timeline/program/enable`, `POST /timeline/program/dismiss` (plus
the existing `/program/end`, `/mode`, `/autopilot`, `/hold`, `/resume`).

**Validation matrix (every row must be proven by the handoff eval agents):**

| # | Scenario | Pass criterion |
|---|---|---|
| V1 | AP → P-due → PG → P-end (ap on) | deck **resumes cycling** within one autopilot delay; NOT frozen on the show pattern |
| V2 | PG → P-end (ap off) | deck holds the look; controller=manual; no error; not "stuck" (deliberate) |
| V3 | PG → P-new | new show applied; old `activeProgram` replaced |
| V4 | mood edge on P-end tick | final look = mood look (not baseline) |
| V5 | program targets `all` → preempt | every baseline autopilot loop disarmed (no fight) |
| V6 | MANUAL(idle) + P-due | `pendingProgram` armed + sign shown; no immediate override |
| V7 | V6 then no action 30 s | program **auto-starts**; controller=program |
| V8 | V6 then ENABLE | program starts immediately |
| V9 | V6 then DISMISS | stays manual; cue latched (no re-arm today) |
| V10 | PAUSED + P-due → lease-exp | program auto-starts (show goes on even when paused) |
| V11 | lease pending + ap-on | program fires |
| V12 | restart mid-show | re-derived (no stale ghost); correct owner; deck not stuck |
| V13 | missing baseline playlist on resume | loud error; deck not silently broken |

### 16.8 Operator-takeover lease (the auto-resuming MANUAL takeover)

> Operator: *"When a plan is active and an operator takes over (interacts with
> the rig), put a LEASE on the plan; when there's no UI interaction for 2 minutes
> (configurable), RELEASE the lease and CONTINUE THE PLAN at the exact wall-clock
> time of release."*

This is the **second** lease in the protocol and it is distinct from the
pending-program lease of §16.5 — they coexist:

| | `pendingProgram` (§16.5) | `operatorLease` (§16.8) |
|---|---|---|
| What armed it | a due **PROGRAM** waiting while the operator is in a MANUAL sub-state | the operator's **manual TAKEOVER** of an active plan |
| Window | `programLeaseSec` (default **30 s**) | `operatorLeaseSec` (default **120 s**) |
| On expiry | the due **program auto-starts** (show goes on) | the **whole plan resumes at now** (catchUp re-derives owner/look) |
| Driven by | the arbiter (a program coming due in manual) | **CaptainPad** (UI signals takeover + sends activity pings) |

The operator-takeover lease is **UI-DRIVEN**: the engine does **not** auto-detect
operator writes. CaptainPad explicitly signals the takeover (`POST
/timeline/takeover`) when the operator grabs the rig, and sends activity pings
(`POST /timeline/activity`, throttled to ~once/10 s) while the operator keeps
interacting. Inactivity for `operatorLeaseSec` releases the lease.

**State machine.**

```
        takeover  (operator grabs the rig — UI signal)
              │
              ▼
   ┌────────────────────────────────────────────┐
   │ OVERRIDDEN  mode='overridden'               │   activity (UI ping)
   │   operatorLease = {                         │◀──────────────  refresh
   │     expiresAtMs = now + operatorLeaseSec*1k │   expiresAtMs = now + window
   │   }                                         │   (idempotent: takeover also
   │   controller='manual' → deck FROZEN (§16.6) │    refreshes)
   └──────┬─────────────────────────┬───────────┘
     lease-exp (now ≥ expiresAtMs)   resume (operator hand-back)
     (no UI activity)                /timeline/resume
          │                                │
          ▼                                ▼
   RELEASE: mode='armed',           clear operatorLease,
   clear operatorLease,             mode='armed', then
   then _catchUp()  ────────────►   _catchUp()  (same resume-at-now)
   "continue the plan at the        — explicit, operator-initiated
    exact time of release"
```

- **`mode='overridden'`** routes to `controller='manual'` via the arbiter, and
  the §16.6 baseline reconcile **freezes the deck** under manual (verified:
  `_reconcileBaselineArm` disarms the baseline when `controller !== 'autopilot'`).
- **RELEASE = resume-at-now.** On lease expiry (or explicit `/resume`) the
  service runs the existing **`_catchUp()`** — which re-derives the correct
  program/look for the **current** wall-clock and re-establishes the baseline.
  So a 2-minute takeover that straddled a sunset cue resumes into the *right*
  look for the time it actually is, not the look it left.
- **`/activity` is a no-op without a lease** — it never arms one on its own; only
  `/takeover` arms a lease.
- **Runtime, never stale.** `operatorLease` is RUNTIME state; `_catchUp` drops a
  persisted lease on boot/scene-switch (§16.6/I6) so a stale lease never
  auto-resumes after a restart.

**State fields** (on `timelineState` getState + WS broadcast, alongside the
existing `controller`/`mode`/`pendingProgram`/`activeProgram`):

| Field | Type | Meaning |
|---|---|---|
| `planActive` | boolean | the timeline is actively DRIVING the rig: `controller ∈ {autopilot, program}` AND `mode` is not paused/overridden |
| `operatorLease` | `{ expiresAtMs } \| null` | non-null WHILE the operator holds the takeover lease; `expiresAtMs` = when the plan auto-resumes |
| `operatorLeaseSec` | number | the configured window (UI seeds/show countdowns from this) |

**Routes.**

| Route | Effect |
|---|---|
| `POST /timeline/takeover` | operator grabbed manual control: `mode='overridden'`, `operatorLease={expiresAtMs: now + operatorLeaseSec*1000}`. Idempotent (re-call refreshes expiry). Returns `{ok:true, operatorLease}` |
| `POST /timeline/activity` | if `mode==='overridden'` and a lease is held, refresh `expiresAtMs`; else no-op. Returns `{ok:true}` |
| `POST /timeline/resume` | (existing) explicit hand-back: clears `operatorLease`, `mode='armed'`, **runs catchUp** (resume-at-now) |

**Config key.** `config.yaml → timeline.operatorLeaseSec: 120` (seconds, the
inactivity window). `/mode {paused}` remains a **separate hard pause** with **no
auto-resume** — the operator-takeover lease is the auto-resuming concept; a hard
pause is not.

### 16.9 Deck transition + overlays on a playlist cue, and the mixer→deck output pin

Two capabilities, both bound to the DECK (the plan's job is to drive the deck):

**(a) Two optional `playlist`-action fields (DECK target only).** A `playlist`
action may now configure how its deck swap looks and whether deck overlays are on:

```yaml
action:
  type: playlist
  name: party_pl
  target: { channel: deck }          # transition/overlays are DECK-ONLY
  transition:                         # optional — how the deck swap animates
    mode: trans_dissolve              # REQUIRED if `transition` present:
                                      #   trans_crossfade | trans_flash | trans_dissolve
    durationMs: 1500                  # optional, Int > 0 (clamped 50..30000 ms by the engine)
    enabled: true                     # optional, default true when a transition is requested
  overlays: enable                    # optional — 'enable' (honor configured overlays) | 'disable' (all off)
```

Validation is **throw-style / fail-loud** (`show_plan.js validateCueTransition` +
the `playlist` case): an empty `transition` (no `mode`) throws; an unknown mode
throws with the allowed list; a `transition` **or** `overlays` on a non-`deck`
target throws (`… is only valid for a deck target`). Absent fields → **no change**
(the deck's existing transition-config / overlay-enabled state is left untouched).

When a deck `playlist` cue fires, `TimelineService._applyAction` applies, in order:
`setDeckTransition(patch)` → load playlist → `setDeckOverlaysEnabled(bool)` →
autopilot → `forceDeckView()`. The deps are bound in `api_server.js` to the real
internal engine functions (`timelineSetDeckTransition`, which shares the
`/deck/transition-config` validate+clamp contract; `timelineSetDeckOverlaysEnabled`,
which flips every overlay's `enabled`; `timelineForceDeckView`) — **no HTTP
self-calls**. A missing dep **fails loud** (the cue records a loud `cueError`).

**(b) Output is FORCED mixer→deck whenever the plan drives the deck.** The plan
asserts `viewOverrideMode='deck'` through the **existing** viewOverride machinery
(§ "view override" in `api_server.js`) via the `forceDeckView()` dep — it does
**not** fork a parallel pin. The plan owns this pin while it drives the deck, so it
deliberately does **not** arm the §controlLock (PortWatch 30 s) lease. The pin is
(re-)asserted on every deck-baseline reconcile (`_applyAutopilotBaseline`,
`_rearmBaselineAutopilot`), on `resume()`/`_catchUp()`, and on every deck-targeted
playlist/look cue.

**The switch-to-mixer is CONFIRM-GATED — and that lives in the UI, not the engine.**
The engine does **NOT** infer an operator takeover from a passive view-change
broadcast. Concretely:

- The engine surfaces a boolean **`forcingDeckView`** on `timelineState` (= `planActive
  && viewOverrideMode === 'deck'`). CaptainPad reads it to know "the plan is forcing
  the deck and a switch to mixer needs confirmation".
- When the operator tries to switch to mixer while `forcingDeckView`, **CaptainPad**
  (a follow-up agent) shows a confirm prompt and, if unanswered within **1 minute**,
  **reverts the output to deck**. The engine's `/mixer/view-override` route does
  **not** call `timelineService.takeover()` on a view event — it only clears the raw
  deck-pin.
- On an **explicit operator confirm**, CaptainPad calls `POST /timeline/takeover` →
  the **operator-takeover lease (§16.8)** arms (`mode='overridden'`, deck FROZEN).
  After `operatorLeaseSec` (default 120 s) of UI inactivity the §16.8 tick
  auto-release fires → `_catchUp()` resumes the plan at now → the baseline
  re-asserts `forceDeckView()` (snaps output back to deck).

So the engine provides **primitives + force-deck-on-active + a clean state surface**;
the confirm + 1-minute-revert is a UI concern. The two leases never fight: the
viewOverride pin is owned by the plan while active; the operator-takeover lease
(armed only by an explicit, UI-confirmed `/timeline/takeover`) governs plan ownership.

**New deps** (constructed in `api_server.js`'s `new TimelineService({deps})`):
`setDeckTransition(patch)`, `setDeckOverlaysEnabled(bool)`, `forceDeckView()`,
`getViewOverrideMode()` (read-only, backs `forcingDeckView`).

**State the UI reads** (`timelineState` getState + WS broadcast): `planActive`,
**`forcingDeckView`** (new), `operatorLease{expiresAtMs}|null`, `operatorLeaseSec`,
`mode`, `controller`.

---

### 16.10 Color autopilot on a deck playlist cue + the soft `'plan'` control-lock (2026-06-30)

**(a) `colorAutopilot` — a third optional `playlist`-action field (DECK target only).**
A deck `playlist` action may configure the engine's palette-cycling daemon when it
fires (the colour analogue of pattern autopilot — see `docs/39 §color-autopilot`):

```yaml
action:
  type: playlist
  name: party_pl
  target: { channel: deck }            # colorAutopilot is DECK-ONLY
  colorAutopilot:                       # optional — cycle a SET of palettes on a timer
    active: true                        # REQUIRED bool — true starts cycling, false stops
    palettes: [aurora, bass_drop]       # REQUIRED non-empty string[] of palette ids
    delay_s: 2                          # REQUIRED number > 0 — seconds between palette swaps
    shuffle: false                      # optional bool, default false (sequential)
```

Validation is **throw-style / fail-loud** (`show_plan.js validateCueColorAutopilot`
+ the `playlist` case): a non-deck target with `colorAutopilot` throws
(`… is only valid for a deck target`); an empty `palettes`, `delay_s <= 0`, or a
non-boolean `active`/`shuffle` throws. Palette **shape** (non-empty strings) is
checked at validation; palette **membership** in the rig's `colorPalettes` config is
enforced at apply time (the plan validator has no palette catalog). Absent → **no
change** (the daemon's current state is left untouched).

When the deck cue fires, `_applyAction` applies in order: `setDeckTransition` → load
playlist → `setDeckOverlaysEnabled` → pattern autopilot → **`setColorAutopilot(wire)`**
→ `forceDeckView`. The new `setColorAutopilot` dep is bound in `api_server.js` to the
real internal `setColorAutopilot()` (configure + (re)start/stop the engine
`ColorAutopilot` daemon) — **no HTTP self-call**; a missing dep **fails loud** (loud
`cueError`). Pattern autopilot and colour autopilot run on **independent timers** in
parallel — colour cycling never changes the running pattern.

**(b) Soft `'plan'` control-lock (replaces the hard PortWatch lock for plan-driven deck-pins).**
`globalsState.controlLock` is now a **three-state** wire field — `null | 'portwatch' | 'plan'`:

| value | meaning | lease | CaptainPad UX |
|---|---|---|---|
| `null` | nobody owns the rig | — | normal |
| `'portwatch'` | a real **PortWatch device** holds the rig (HARD lockout) | 30 s lease, renew-or-release | full lockout: "PORTWATCH HAS THE RIG" |
| `'plan'` | the **timeline** forced the deck (SOFT lock) | **no lease** (the plan releases the pin itself) | low-key yellow warning; navigation allowed; **only** pattern-select + mixer-activate disabled |

The raw output pin (`viewOverrideMode = 'deck' | null`) is unchanged; what changed is
the **source** of that pin, tracked by `controlLockSource` in `api_server.js`. When the
timeline forces the deck (`timelineForceDeckView`/`forceDeckView` dep) the source is
`'plan'`; a real PortWatch deck-pin (`POST /mixer/view-override {override:'deck'}`) sets
the source `'portwatch'` (and an actual device take-over **upgrades** a plan soft-lock to
the hard lock). The deck-pin derivation pins output to deck for **either** source. The
PortWatch **lease timer is armed only for `'portwatch'`** — a `'plan'` lock carries
`controlLockLeaseDurationMs: null` / no expiry and is never auto-released by lease
expiry; the plan hands the pin back itself on resume/handback (clearing the pin restores
`controlLock: null` cleanly). CaptainPad reads `controlLock` off `/globals` and the
`viewOverride` WS broadcast; it must treat `'plan'` as the soft lock above.

---

## 17. What this deliberately is **not** (v1)

- **Not** a second analyzer — mood comes from the Audio Companion via CPC.
- **Not** a replacement for `docs/31` interval tasks — it can *enable* them.
- **Not** a render/effect path — it only calls existing engine routes.
- **Not** multi-day calendaring — it computes *today's* sun events each day; a
  plan repeats nightly (weather/special-night overrides are a later idea).
- **Not** a programmer/conditional engine — cues are `trigger → action`, no
  branching logic (sequences = multiple cues).
```
