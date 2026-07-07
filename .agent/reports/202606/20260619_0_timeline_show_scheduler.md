# 2026-06-19 — Timeline / Show Director companion — research + project tracker

**Author:** remote agent (Claude)
**Branch:** `feat/timeline_support` (all work pushed here)
**Design doc:** `docs/38_timeline_show_scheduler.md` (review target)
**Status:** Phase 0 — research + design complete, awaiting operator review.

> This report is the **project tracker** for the timeline/scheduler effort.
> Keep it updated as phases land (checkboxes below). The design doc holds the
> architecture; this holds context, findings, decisions, and status.

---

## 1. The ask (operator, verbatim intent)

Build a **timeline manager + special playlist features** that trigger playlists
based on **time**, **music mood changes** (calm → party), and **event times**
(sunset, philharmonic sunset, party night, sunrise, …). Ship it as a **new
companion** that runs alongside the audio companion — **repurpose the "audio
companion" into a "companions" server + process** framework. Autopilot and the
timeline must also work in the **multi-channel mixer** if needed (stretch). Write
a reviewable design doc + this tracker. Use `feat/timeline_support`, always push.

---

## 2. Why a new doc and not an extension of an existing one

The repo already has adjacent designs; this is genuinely a new concern that sits
*above* them:

- `docs/31_scheduled_tasks.md` — an **interval** effect scheduler. Explicitly
  *"not a cue list… intervals only, not wall-clock times."* The timeline IS the
  wall-clock/event cue list it excludes. **Sibling, not a replacement** — the
  timeline can enable/disable interval-task profiles per phase.
- `docs/19_playlists.md` — the **playlist library + autopilot**. The timeline is
  a *driver* of these (loads playlists, flips autopilot), not a reimplementation.
- `docs/37_marsin_audio_framework.md` — the **Audio Companion** (sole audio
  analyzer, engine-supervised subprocess). This is the **exact template** for the
  new companion, and the **source of the mood signal** (`audioParty`).
- `docs/26` + `docs/15` — CPC / param routing (where mood lives).

---

## 3. Key research findings (current implementation — all verified in code)

### 3.1 Companion supervision (the repurposing hook)
- `launcher.js:1037-1043` already spawns the Audio Companion as a supervised
  child: `startChild('companion', 'node', ['audio/companion/companion_server.js',
  '--port', '6966'], …)`, health-probed via `waitForHttp`.
- `PROFILES` (`launcher.js:102-118`) list `'companion'` in `prod`/`dev`/
  `dev-lite`. Generalizing this single hard-coded child into a `companions: [...]`
  list is the minimal "companions server" refactor.
- `docs/37 §8` already frames the companion as an **engine-supervised
  subprocess** with the engine's uptime — so "companion" gives us the docs/31
  resilience guarantee *and* the audio-companion ergonomics. **Important framing:
  a companion is server-side, not iPad-side.**

### 3.2 Mood signal (the "calm → party" trigger)
- `audio/signals/party_mode.js` produces CPC key **`audioParty`** = `0/1`
  (loudness gate: `0.4·low + 0.4·mid + 0.2·high`, EMA τ≈0.4 s, hysteresis ON 0.22
  / OFF 0.12, min-dwell 1200 ms ON / 800 ms quiet). `audioStructure` = `0..2`
  (intro/build/drop/breakdown) from the structure detector.
- The Audio Companion is the **sole analyzer**; mood is read off the **engine's
  param-broadcast WS** (the feed CaptainPad already consumes) — the timeline must
  NOT re-analyze audio.

### 3.3 Playlists + autopilot
- `marsin_engine/lib/playlist_manager.js` ✅ exists (list/load/validate/
  applyEntryDefaults; library at `simulation/scenes/<scene>/playlists/`).
- `marsin_engine/lib/autopilot.js` ✅ exists — but a **single global instance
  bound to the deck** (`api_server.js` instantiates it reading
  `mixer.getDeckChannel().playlist`). Self-rescheduling `setTimeout` +
  generation counter for clean pause.
- Routes present: `GET/POST /deck/playlist`, `POST /deck/playlist/entry`,
  `POST /deck/playlist/autopilot`, plus full `/playlists` CRUD.

### 3.4 Multi-channel mixer (the stretch)
- `pattern_mixer.js`: **deck channel + up to 3 overlay mixer channels**
  (`maxChannels` default 3). Each overlay is a `PatternChannel` with **its own
  `playlist` assignment**, persisted in `mixer_state.yaml`
  (`channels[].playlist = {name, activeEntryId, cursor, autopilot}`).
- `loadPlaylistEntry(channel, …)` is **channel-agnostic** (deck or mixer).
- Routes ✅: `GET/POST /mixer/channels/:id/playlist`,
  `POST /mixer/channels/:id/playlist/entry` (+ `/capture`, `/discard`).
- **Gap:** per-channel autopilot **loop** does NOT exist (Autopilot is deck-only;
  no `POST /mixer/channels/:id/autopilot`). This is exactly `docs/19` **Phase
  2.3** (2.1 state + 2.2 routes already shipped). See §6 recommendation.

### 3.5 Scenes / models
- Model is fixed at engine boot (`--model`). Runtime scene switch = engine writes
  `SCENE_SWITCH_FILE` and **exits `75`**; `launcher.js:1004` (`handleEngineExit`)
  respawns on the new model (tracked, not a crash). So a `scene` action is
  available but heavy (restart) — favor lighter "look" swaps within a scene.

### 3.6 Transport surfaces the timeline reuses (no new engine routes for v1)
- REST `:6968` — `/deck/playlist*`, `/mixer/channels/:id/playlist*`, `/scene`,
  `/control`, `/scheduled-tasks*`, `/playlists`.
- WS `/ws/params` — mood (`audioParty`, `audioStructure`).
- OSC `:10000` — available if direct CPC pokes are wanted (not needed for v1).
- State files: `marsin_engine/states/<scene>/*.yaml`, atomic write via
  `state_manager.js`.

### 3.7 Offline sun math
- Playa has no internet (codex P0). Vendor a dependency-free NOAA/SunCalc-style
  solar-position routine in `companions/timeline/sun.js`. BRC default ≈ 40.7864 N,
  −119.2065 W, `America/Los_Angeles`. Unit-test against published BRC sun tables.

---

## 4. Architecture decisions (made in the design doc)

1. **Companion = server-side, engine-supervised** (not iPad) → resilient like
   the engine; fires cues with no CaptainPad connected.
2. **Companion decides *when/which*, engine executes *what*.** The timeline only
   calls existing engine routes; it owns no render/sACN/CPC path.
3. **Library/assignment split** mirrors playlists: plans in
   `simulation/scenes/<scene>/timeline/*.yaml`; runtime in
   `states/<scene>/timeline_state.yaml`.
4. **Cue = `trigger → action`.** Triggers: `clock | sun | phase | mood |
   manual`. Actions: `playlist | scene | look | globals | tasks | effect`.
5. **"Look"** = named bundle (playlist + palette + globals + autopilot + tasks) —
   the "special playlist" feature; one cue sets the whole vibe.
6. **Mood is phase-gated + debounced** (`whenPhase`, `minDwellSec`,
   `cooldownSec`) so playlists never flap on a loud daytime soundcheck.
7. **Fail loud** (codex P0): missing playlist/scene/look/effect → red cue error,
   never a silent skip; plan-load validates cue targets.
8. **Edge-latched, no replay** of missed cues on restart (configurable
   `catchUp: latest` for the current *look* — open question).
9. **Multi-channel:** channel-aware actions (`target: deck|mixer:<id>|all`) work
   today via existing routes; true multi-channel auto-cycling waits on the engine
   per-channel autopilot pool (`docs/19` Phase 2.3).

---

## 5. Build phases & tracker

- [x] **Phase 0** — research + design doc (`docs/38`) + this tracker.
- [x] **Phase 1** — companions framework: launcher `COMPANIONS` registry +
  timeline child spawns/`/health`-probes + `companions.timeline` config block.
  Audio companion kept in place. *(launcher commit; `--help` shows "companions
  (audio + timeline)".)*
- [x] **Phase 2** — timeline core + server: `sun.js`, `triggers.js`,
  `show_plan.js`, `timeline_config.js`, `timeline_state.js`, `engine_link.js`,
  `actions.js`, `timeline_server.js` (:6965) + monitor UI. Clock/sun/phase cues
  fire playlists/looks; channel-aware actions (deck + mixer). **31 core + 4
  server tests.**
- [x] **Phase 2.5** — engine **per-channel autopilot pool** (`AutopilotPool`) +
  `GET/POST /mixer/channels/:id/autopilot`; deck back-compat preserved. **9 + 40
  tests.** Verified LIVE: overlay cursor cycled 0→1→2→3 while deck held at 0.
- [x] **Phase 3** — mood triggers: audio companion emits `audioParty`/
  `audioStructure` (`mood_emit.js`, **23 tests**); timeline WS-subscribes,
  phase-gated calm→party. Verified LIVE end-to-end (synthetic audio → CPC →
  timeline fired `c_mood_party` → deck swap; no injection).
- [ ] **Phase 4** — CaptainPad TIMELINE tab: day ribbon, countdowns, mood pill,
  manual fire/hold/pause. *(in progress)*

### 5.1 Live E2E validation (2026-06-19, container, test_bench)
Full stack (sim :6969 + engine :6968 + timeline :6965 + audio companion :6966):
- Timeline ↔ engine connected; sun/phase resolved tz-correctly (party_night active).
- Manual cue fire → look applied (palette + playlist) → deck pattern swapped
  (bioluminescence/rainbow/golden, confirmed via engine API).
- **Mixer per-channel autopilot** cycled an overlay independently of the deck.
- **Live mood**: audio companion synthetic-audio loud → `audioParty=1` in engine
  CPC → timeline caught calm→party edge (gated `party_night`) → fired
  `c_mood_party` → deck = `rainbow`. Screenshots: `.agent_renders/
  timeline_ui_{offline,connected,live_mood}.png`.
- Known: test_bench is sparsely patched, so sim renders muted/red — look swaps
  are real (engine API confirms), just not dramatic on a partial model.
- Minor polish logged: monitor-UI "NOW" clock should render in plan tz (server
  logic already tz-correct); stale `lastError`; `lastFiredCueId` field name.

---

## 6. Best way forward for the multi-channel mixer ask (recommendation)

The data model + per-channel playlist control surface **already exist** for mixer
channels — only the autopilot **cycling loop** is missing. So:

1. Make the timeline **channel-aware from day one** (`target: deck|mixer:<id>|
   all`). This costs nothing — the `/mixer/channels/:id/playlist*` routes are
   live — and immediately gives multi-channel **loading** (e.g. exterior wash on
   deck + room playlist on a mixer channel at sunset).
2. Finish **`docs/19` Phase 2.3** as a focused engine slice: promote the single
   deck-bound `Autopilot` into a **per-channel autopilot pool** keyed by channel
   id, reusing the per-channel `playlist.autopilot` already in `mixer_state.yaml`,
   plus a `POST /mixer/channels/:id/autopilot` route. Keep one shared scheduler
   with a `Map` (not N loose timers) so pause/generation semantics match today.
3. The timeline **drives autopilot at the assignment level only** — a cue sets
   `{playlist, autopilot:{active,delay_s,shuffle}}` per channel; the **engine**
   owns the cycling timers. Do **not** re-implement cycling in the companion
   (avoids drift, keeps "engine = executor", and the autopilot keeps running even
   if the companion restarts).

**One line:** timeline is channel-aware immediately (free); true multi-channel
auto-cycling lands with the already-scoped engine per-channel autopilot pool,
which the timeline then consumes for free. Full detail: `docs/38 §13`.

---

## 7. Dev cycle for this effort (agreed loop)

Remote agents (me) do: **dev → evaluate → test + capture evidence/screenshots →
push to `feat/timeline_support`** → then Sina hands the branch to a **local
agent** for on-hardware validation where needed. This subsystem is unusually
remote-friendly (see §8), so most of it can be proven in the container.

---

## 8. Remote testability notes

- **Pure cores:** `sun.js` and `triggers.js` take an injected clock + mood
  snapshot → deterministic unit tests, no rig. Sun math validated vs published
  BRC sunrise/sunset tables (±1–2 min).
- **Accelerated clock / fire-now:** run a "full night" in seconds; screenshot the
  sim recoloring per look.
- **Mood without a mic:** the Audio Companion's **`test` source** synthesizes
  loud/quiet audio → drives `audioParty` → exercises the calm→party path E2E in
  the container.
- **Evidence:** `simulation/agent_tools/agent_render.cjs` for sim screenshots
  (`--viewport 1280x720`, `xvfb-run -a` on headless), `--show-ui` for the
  CaptainPad timeline tab. See `.agent/01_skills/00_see_the_world.md` +
  `05_full_stack_smoke.md`.
- **Auto-checks:** run `.agent/00_gol/03/04/05` for touched subsystems before any
  merge-ready claim; add `sun.test.js`, `triggers.test.js`, `show_plan.test.js`,
  `timeline_engine_link.test.js`.

---

## 9. Open questions for Sina (also in `docs/38 §12`)

1. **Crash catch-up** — restore the most-recent passed *look* on restart, or stay
   quiet? (Recommend: catch up the latest look; never replay one-shot effects.)
2. **Mood authority window** — allow calm→party only inside `party_night`
   (recommended) or any time after sunset?
3. **"Philharmonic sunset"** — what offset (e.g. `sunset −30m`)? Its own playlist
   or a "look" bundle (recommend look)?
4. **Scene vs look** — nightly arc via lightweight **looks** within one scene
   (recommend) vs full **scene/model** swaps (engine restart)?
5. **Location/tz** — confirm BRC lat/lon/elevation + host on `America/
   Los_Angeles` during the event.
6. **Companion relocation** — move `audio/companion/` under `companions/audio/`
   now, or just add the timeline child for v1 (recommend the latter — less churn).
7. **Multi-channel autopilot** — green-light the `docs/19` Phase 2.3 engine
   per-channel autopilot pool (§6), or keep auto-cycling deck-only for v1 and have
   the timeline only *load* (not auto-cycle) mixer channels?

---

## 10. Ports

| Service | Default | Source of truth |
|---|---|---|
| Timeline Companion (HTTP/WS) | `6965` (proposed) | `config.yaml::companions.timeline.port` |

(6966 audio companion · 6967 CaptainPad web · 6968 engine · 6969–6972 sim.)
Add to `.agent/00_gol/13_multi_agent.md` ports table when Phase 1 lands.

---

## 11. Changelog

- **2026-06-19** — Phase 0: research complete; `docs/38` design doc written;
  multi-channel mixer stretch analyzed (`docs/38 §13`); this tracker created.
- **2026-06-19** — Operator green-lit full build (0→100, remote-tested). Shipped
  Phases 1, 2, 2.5, 3 on `feat/timeline_support`: timeline core + companion
  server + monitor UI; engine per-channel autopilot pool + mixer route; audio
  companion mood emit; launcher companions registry. ~110 tests green across the
  slices. Full live E2E validated in-container (see §5.1) with screenshots.
- **2026-06-19** — Added control-precedence arbitration model (`docs/38 §14`):
  MANUAL > PROGRAM (scheduled shows override autopilot) > AUTOPILOT (regular
  programming + mood). CaptainPad TIMELINE base tab built (tsc + web:build clean).
- **2026-06-19 — v2 PIVOT (operator).** Move the timeline **into the engine** (no
  standalone companion / no :6965), **CaptainPad = the only UI**, themed, with a
  **super-fluid 8-day festival MAKER** (BRC-optimized). See `docs/38 §15`. Pure
  cores relocate into `marsin_engine/lib/timeline/`; companion server/engine_link/
  actions/ui/config + launcher child are removed; plan schema → v2
  (`festival{startDate,days}` + per-cue `days` applicability). Behavioral model
  (§1–§14) and tests carry forward. **In progress** — superseding the standalone
  Phase 4 tab with the in-engine + maker build.
- **2026-06-19 — M1 DONE (timeline in engine).** Relocated cores to
  `lib/timeline/` + new `timeline_service.js`; `/timeline/*` REST + `timelineState`
  WS on :6968; companion/launcher-child/:6965 removed; CaptainPad repointed to the
  engine. 95 engine tests green; CaptainPad tsc + web:build clean. Live in-engine
  precedence verified: program (catchUp) → `program/end` → **autopilot resumes** →
  autopilot-off → **manual** (controller transitions confirmed via /timeline/state).
- **2026-06-19 — M2 DONE (8-day festival).** schema v2 (`festival{startDate,days}`
  + per-cue `days`), `festival.js` helpers, tick filters to today's cues,
  `buildOverview()` + `GET/POST /timeline/overview`. v1 back-compat. test_bench
  seed regenerated to the v2 8-day default. 80 timeline tests. Live overview =
  8 days, sun drift 19:34→19:23, burn-night(d6)/temple(d7) day-specific.
- **2026-06-19 — M3 DONE (fluid maker UI).** CaptainPad timeline tab → viewer +
  8-day maker: DayOverviewStrip (per-day sun arc + cue markers by kind), DayEditor
  (sun events interleaved with cues), CueEditorSheet (kind/trigger/action/hold/days,
  all pills+steppers), PlanPicker, draft→`POST /timeline/overview` preview→
  `POST /timeline/plans` save. tsc + web:build + lint clean. **Screenshots
  captured** against the live engine: 8-day overview, day editor (Sat w/ burn
  night), ADD CUE sheet (`.agent_renders/cp_timeline_maker|cp_day_editor|
  cp_cue_editor.png`).

### 5.1.1 Handoff Protocol (normative) — `docs/38 §16`
The control-handoff behavior is now a **normative protocol** in `docs/38 §16`:
control owners (AUTOPILOT / PROGRAM / MANUAL{paused,idle,holding,overridden} +
the PENDING lease), six invariants (I1 never-stuck · I2 show-goes-on · I3
operator-visibility · I4 fail-loud · I5 single-driver · I6 restart-safe), a
**full transition matrix** (every trigger × every owner — no variation omitted),
the pending-program lease state machine (30 s, ENABLE/DISMISS/auto-start), the
easy-to-miss cross-cutting variations (restart, missing playlist, mixer/all
target, mood-on-expiry-tick, day rollover, fire-always-wins, lease+ap-on), and a
**13-row validation matrix (V1–V13)** the handoff eval agents must prove. Several
rows (V1, V4, V5, V12, V13) are already satisfied by the 2026-06-19 fix pass; the
lease rows (V6–V11) are implemented + validated in the handoff slice.

### 5.2 v2 final state (2026-06-19)
**DONE & pushed:** timeline runs IN the engine; CaptainPad is the only UI (themed);
precedence arbiter (program > autopilot > manual); 8-day festival model + fluid
maker. **220+ tests** across timeline + engine regression, all green; CaptainPad
tsc/web:build/lint clean; auto-checks (git diff --check, node --check, tsc, lint)
pass. Live-validated end-to-end (engine + sim + audio companion): in-engine
precedence transitions, mood-driven swaps from real synthetic audio, mixer
per-channel autopilot, and the 8-day maker rendering the live plan.
**Remaining / follow-ups:** (a) v1 plans aren't editable on the 8-day grid (loud
message → duplicate from BRC template) — by design; add a "wrap in festival"
affordance if wanted. (b) sim visuals are muted on test_bench (sparse patching) —
full fidelity on the patched titanic model. (c) optional: HIL/local validation on
real hardware (the hand-off step).

### 5.3 Operator-takeover lease (2026-06-30)
Added the auto-resuming MANUAL takeover lease (`docs/38 §16.8`): `POST
/timeline/takeover` arms `operatorLease` + `mode='overridden'` (deck frozen),
`POST /timeline/activity` (CaptainPad pings ~once/10s) refreshes its expiry, and
the tick RELEASES it after `timeline.operatorLeaseSec` (default 120s) of
inactivity — running `_catchUp()` to **resume the plan at the wall-clock time of
release**. `/resume` does the same hand-back explicitly. New `timelineState`
fields: `planActive`, `operatorLease{expiresAtMs}`, `operatorLeaseSec`. Coexists
with the §16.5 pending-program lease (30s, program auto-start) — distinct
concepts, both kept. `operatorLease` is runtime-only (dropped on boot). 27
timeline_service tests (9 new), 121 timeline tests green; live auto-resume
smoked on a real tick.
