# 77 — BM26 night arc timeline (v2)

**Status:** DESIGN v2 — revised after the operator's external review of v1.
Still design only: nothing here is implemented; no plan YAML, state file, or
code was changed by the sessions that wrote it. Every mechanism named below is
marked either **exists today** (with the file that proves it) or **needs
work** (listed in §11). Times of day and phase durations appear throughout;
calendar scheduling deliberately does not (public repo — tracked docs record
what/why, never when-by).

**Changelog**

- **v2** — operator review verdict applied. Rulings D1–D8 recorded as decided
  (§2). Party ELIGIBILITY vs ENABLEMENT split made explicit everywhere;
  eligibility gate moved 20:00 → 21:30 (§4). Morning gap closed: two-stage
  sunrise + `morning_watch` coverage through 09:00, master-zero with an
  explicit restore contract (§3, §8.5). Deep night restructured from three
  palette refreshes (rejected, D7) into curated 60–90 min structural blocks
  with deliberate quiet resets and a safety visibility floor (§3.2, §3.3).
  New sections: dust-storm posture (§8.1), audio-staleness behavior (§8.2),
  party budget + neighbor false-trigger protection (§4.3, §4.4),
  white-channel power/thermal envelope (§8.4), takeover master-restoration
  semantics (§8.5), dry-run validation approach (§9). Shuffle-vs-sequential
  pinning stated per cue (§3.4). Gap list re-prioritized (§11).
- **v1** — initial skeleton.

**Operator's vision (the brief, preserved verbatim in intent):** the nightly
arc starts around sunset — slow, NO party energy, possibly white-only patterns
at first. Slowly move into the night by adding sprinkles of color into
playlists and patterns. Enable the party-mode trigger only after dark-evening
hours. Through the night, fire ambient and ambient_sound_reactive material
with DIFFERENT color palettes, mixing up the look. Toward sunrise: all-white
patterns. Turn off around 9am. The plan is a skeleton the operator will extend
with planned events: Baby (reveal), weddings, Maxa party, philharmonic party —
this doc designs named placeholder slots for those, not their content.

---

## 1. What the engine already gives us (grounding)

Everything in this section **exists today** on `feat/bm_readiness`.

### 1.1 The Timeline system

The engine's Timeline service (`marsin_engine/lib/timeline/`) runs an authored
**show plan** — a YAML file per scene in
`simulation/scenes/titanic/timeline/` (the live one is
`playa_default.yaml`; runtime state persists in
`marsin_engine/states/titanic/timeline_state.yaml`). The schema
(`marsin_engine/lib/timeline/show_plan.js`, spec `docs/38`) provides:

- **Triggers** (`lib/timeline/triggers.js`): `clock` (24h "HH:MM"), `sun`
  (event ± offset minutes), `phase` (rising edge of a named window), `mood`
  (calm↔party from the audio companion, with dwell/cooldown and an optional
  `whenPhase` gate), and `manual` (operator-fired only).
- **Sun events** computed offline, no network (`lib/timeline/sun.js`, NOAA
  math): `sunrise`, `sunset`, `solarNoon`, `civilDawn/Dusk`,
  `nauticalDawn/Dusk`, `goldenHourStart/End`. Recomputed per calendar day, so
  sun-anchored cues track the drift across the burn week automatically.
- **Phases**: named windows with clock or sun anchors, midnight-wrapping
  supported.
- **Actions**: `playlist` (with optional pinned entry, curated `palette`,
  pattern-`autopilot` block, deck `transition`, `overlays` enable/disable,
  `colorAutopilot` palette-cycling daemon, `hue`, and `globals` such as
  `speed` / `master` / `colorPalette1/2`), `look` (a named bundle of
  playlist+palette+autopilot+globals), `sequence` (timed multi-step),
  `scene`, `globals`, `tasks` (enable/disable scheduled tasks), `effect`.
- **Cue kinds** and precedence (`lib/timeline/arbiter.js`):
  `MANUAL > PROGRAM > AUTOPILOT`. A `program` cue owns the deck for its
  `hold` window (`{min}` or `{until: anchor}`) and suppresses mood swaps; an
  `ambient` cue sets a look WITHOUT taking priority (autopilot and mood keep
  running); a `mood` cue fires on the audio detector's calm→party edge.
- **Pattern autopilot per cue/look** (`show_plan.js validateAutopilot`):
  `{ active, delay_s, shuffle }` — `shuffle: false` is SEQUENTIAL playback in
  the playlist's authored order; `shuffle: true` randomizes. This flag is the
  difference between a directed ramp and a grab-bag (§3.4).
- **`durationMin` windows + plan-level `defaultCue`**: a cue owns the deck for
  a bounded window; outside any window the authored default cue fills the
  deck. `playa_default.yaml` already uses this (`defaultCue` → `ambient`
  look).
- **Festival day indices**: the plan carries a festival span; cues can target
  `days: all` or specific day indices (burn night, temple night already do).
- **Boot catch-up** (`timeline_service.js _catchUp` +
  `lib/timeline/resolve_deck_state.js`): on engine restart the service
  re-resolves "the plan at instant now" — latest already-passed restorable
  cue for TODAY, its hold/duration window against its TRUE past fire time —
  and re-applies it. Runtime leases/programs are never resumed stale.
- **Plan lint** (`show_plan.js lintShowPlan`): a `program` cue whose action
  carries no `autopilot` block is flagged loudly (`planWarnings`) because a
  program dispatch disarms the baseline — without its own autopilot block
  the deck freezes silently. (An EXPLICIT `{active: false, …}` block is
  legal and is how a deliberately steady look is authored — see
  `morning_watch`, §3.1.)
- **Dry-run tool** (`marsin_engine/tools/timeline_dryrun.mjs`): simulates a
  plan against a virtual clock — full nights in seconds — and reports the
  fire sequence. The validation approach in §9 is built on it.

### 1.2 Party mode — two independent gates

Party is a **mood cue** in the plan (`c_mood_to_party` in
`playa_default.yaml`) plus an **operator policy** stored in timeline state and
edited via `/party-config` (`timeline_service.js setPartyConfig`). Two gates,
and the distinction is load-bearing for this whole design (§4):

- **ENABLEMENT** — `partyEnabled` (the CaptainPad party toggle / a manual
  `/party-config` call). ONLY a human flips this. While false, the detector
  keeps running and metering but no cue may transition the show INTO party —
  suppression suppresses the show, never consumes the trigger
  (`lib/timeline/triggers.js` PARTY OVERRIDE branch).
- **ELIGIBILITY** — the mood cue's `whenPhase` gate: the schedule's statement
  of WHEN a party session is permitted at all. It never turns party on.

A session fires only when BOTH are true AND the detector's dwell is satisfied
AND the cooldown has elapsed. Session numbers (`minDwellSec`, `durationMin`,
`cooldownSec`, `playlist`, `durationEnabled` follow-the-music) live in
`/party-config` as the single authority, live-editable from CaptainPad.

### 1.3 Authority model (not redesigned here)

This plan lives entirely INSIDE the existing model: Timeline preempts an armed
Live Touch surface through an explicit handoff gate
(`lib/timeline/timeline_preemption_gate.js`), and a human takeover
(`mode: overridden`, operator lease) beats everything, auto-resuming the plan
via lease expiry. HUMAN > PROGRAM > AUTOPILOT stands unchanged; every phase
and event below is just plan content under that arbiter.

### 1.4 Content inventory (titanic scene)

Playlists (`simulation/scenes/titanic/playlists/`): `default`, `ambient`
(~50 entries), `ambient_sound_reactive` (~190 entries — the big one),
`white_only` (~25), `uv_only` (~20), `party_high`, `party_low`,
`party_dancers`, `baby_tease`, `baby_reveal`, `calibration`, `uv_test`.
These are the operator's live tunings — READ ONLY to agents.

Pattern families (`marsin_engine/patterns/`): the main numbered set plus
`white_only/`, `uv_only/`, `ambient_extra/`, `party_dancers/`,
`baby_tease/`, `baby_reveal/`, `crisp/`, `transitions/`, `channel_blends/`.
Note: **whiteness is a pattern-family property, not a palette property** —
the ship's whites ride the W channel in `white_only` patterns; curated
palettes are hue-only pairs (s=1, v=1), so no palette choice can make a color
pattern white.

Curated two-color palettes (`marsin_engine/config.yaml colorPalettes`, ~23):
`deep_sea`, `sunset_coral`, `aurora`, `bass_drop`, `ultraviolet`,
`lavender_dream`, `electric_ice`, `phoenix`, `cyberpunk`, `afterhours`,
`midnight_laser`, `vapor_laser`, `laser_lime`, `tropical`, `royal`,
`plasma_core`, `toxic_wave`, `neon_jungle`, `acid_sunset`, `forest_fire`,
plus the baby set. A `playlist` cue's `colorAutopilot` block can rotate any
subset with its own dwell + crossfade (`lib/color_autopilot.js`, `docs/39`).

---

## 2. Ruled decisions (operator review — recorded, closed)

| # | Ruling | Status |
|---|--------|--------|
| D1 | Anchor policy: HYBRID — sun anchors for light-tied edges, fixed clocks for policy-tied edges. | **Approved** |
| D2 | Ignition is PURE white initially; warmth is judged on the hull later. | **Approved** |
| D3 | `dusk_sprinkles` playlist gets authored (operator content pass). | **Approved** |
| D4 | Wedding content is restored to the titanic scene only when a wedding is booked; timeline placeholder stays disabled until then. | **Approved** |
| D5 | 09:00 master-zero — approved ONLY WITH an explicit operator-approved restore value at ignition AND full sunrise→09:00 coverage (no uncontrolled gap). Both are designed in: §3.1 phases 6a/6b/7, §8.5. | **Approved with conditions (met by this design)** |
| D6 | `c_visibility_on` (nightly philharmonic look at sunset−45) is replaced by the ignition/first_color cues; philharmonic becomes an event slot. | **Approved** |
| D7 | Three deep-night palette refreshes — **rejected as too sparse**. Replaced by the structural block design in §3.2. | **Rejected → superseded** |
| D8 | Party eligibility ends at sunrise−90 as the default; sunrise DJ sets are handled by manual override, not by widening the window. | **Approved** (see OD-1 for the −90 vs −120 seam with the revised `pre_dawn`) |

---

## 3. The nightly arc — v2

All clock times are plan-local (the plan's tz). Sunset at BRC in late August
runs roughly 19:25→19:45 across the week and sunrise roughly 06:15→06:30;
sun anchors absorb the drift per D1. "Party" below means **eligibility** only
— enablement is always the human toggle (§4.1).

### 3.1 Phase table

| # | Phase | Window | Look / energy | Playlist + palette approach | Party eligible | Mechanism |
|---|-------|--------|---------------|-----------------------------|----------------|-----------|
| 1 | `ignition_white` | sunset−30m → sunset+30m | Pure white (D2), slow, stately — the ship becomes visible. Authors the **master restore value** `M_IGNITION` (D5, §8.5). | `white_only`, autopilot `{active, delay_s ~120, shuffle: false}` — curated sequential order (§3.4). | no | `sun` cue (sunset −30), `kind: program`, `hold {min: 60}`, `globals {master: M_IGNITION}`. Exists today. |
| 2 | `first_color` | sunset+30m → 21:30 | Still calm; white base with occasional low-saturation color sprinkles. | `dusk_sprinkles` (D3 — mostly `white_only` entries + a few gentle `ambient` entries, authored in ramp order), autopilot `shuffle: false`; optional `colorAutopilot` with ONE muted palette (`electric_ice` or `lavender_dream`), dwell ~600s, soft crossfade. | no | `sun` cue (sunset +30), `kind: ambient`. Sun-start / clock-end seam analyzed in §3.5. |
| 3 | `early_night` | 21:30 → 23:30 | Calm but **visibly more animated** than first_color — motion, gentle color, no party energy. | `ambient`, autopilot `shuffle: true` delay ~90s; `colorAutopilot` rotating 2–3 cool palettes (`deep_sea`, `lavender_dream`, `aurora`), dwell ~300s. | **YES** (eligibility window opens 21:30) | `clock` cue 21:30, `kind: ambient`. `party_window` phase starts here (§4.1). |
| 4 | `deep_night` | 23:30 → sunrise−120m | Curated 60–90 min **structural blocks** — directed, distinct looks — separated by brief quiet resets as deliberate contrast. Safety visibility floor holds throughout (§3.3). | Per-block playlists/palette sets — see §3.2. | yes | One `clock` cue per block, `kind: ambient`. |
| 5 | `pre_dawn` | sunrise−120m → sunrise−20m | Wind-down: **motion and saturation taper** — autopilot delay lengthens, palettes go pale, speed eases. | `ambient` with pale palettes (`electric_ice`, `aurora`), autopilot delay ~180s, `globals {speed}` reduced. | **no** (eligibility ends when pre_dawn begins — see OD-1) | `sun` cue (sunrise −120), `kind: ambient` — fires over whatever block is running (§3.2 tail rule). |
| 6a | `sunrise_bloom` | sunrise−20m → sunrise+60m | Expressive white / warm-white — the sunrise moment, mirrors ignition. | `white_only` in curated sequential order, autopilot `shuffle: false`, delay ~90s. | no | `sun` cue (sunrise −20), `kind: program`, `hold {min: 80}`, WITH autopilot block. |
| 6b | `morning_watch` | sunrise+60m → 09:00 | **Reduced steady visibility** — one calm white look at lowered master (`M_MORNING`), covering the morning with no uncontrolled gap (D5). | `white_only` pinned steady entry (`entryId`), autopilot `{active: false, …}` — an explicit, linted-legal freeze (§1.1). `globals {master: M_MORNING}`. | no | `sun` cue (sunrise +60), `kind: program`, `hold {until: {clock: '09:00'}}` — `hold.until` anchors exist today (`show_plan.js validateHold`). |
| 7 | `day_off` | 09:00 → next sunset−30m | Off: master to 0. Engine, timeline, and sACN keep running dark; restore contract is phase 1's explicit `M_IGNITION` (§8.5). | — | no | `clock` cue 09:00, `globals` action `{master: 0}` (D5). |

Coverage claim (D5 condition 2): phases 6a → 6b → 7 are contiguous by
construction — `sunrise_bloom` holds 80 min, `morning_watch` starts at
sunrise+60 (inside the bloom hold, taking over as the next program) and holds
`until 09:00`, and the 09:00 cue takes master to zero. There is no ownerless
minute between sunrise and 09:00; the dry-run suite (§9) asserts this per
festival day.

Baseline underneath all of it: the plan's `defaultCue` (`ambient` look) plus
the autopilot baseline guarantee the deck is NEVER stuck — any gap between
cue windows falls back to cycling ambient, per the mission ("ambient by
default, alive at party moments, never stuck").

### 3.2 Deep night: the block structure (replaces the rejected refreshes, D7)

`deep_night` is a sequence of **named blocks**, each a `clock` cue
(`kind: ambient`) carrying its own playlist, palette set, autopilot
character, and speed. Blocks are 60–90 minutes; between the major blocks sit
**quiet resets** — ~10-minute deliberately low-energy interludes that make
the next block land as an arrival, not a drift. Block times below are the
skeleton's placeholders (final curation is OD-4); the STRUCTURE is the
design:

| Cue | Time | Character | Content sketch |
|-----|------|-----------|----------------|
| `b1_midnight_drive` | 23:30 | Directed opener: sound-reactive, cool and confident. | `ambient_sound_reactive`; palettes `deep_sea` + `midnight_laser`; autopilot shuffle ON, delay ~75s. |
| `r1_quiet_reset` | 01:00 | ~10 min hush — slow, sparse, dimmer FEEL without going dark (§3.3). | `ambient` slow entries in authored order (`shuffle: false`), single palette (`aurora`), `globals {speed}` low. Master UNTOUCHED. |
| `b2_uv_lasers` | 01:10 | Sharper, darker-feeling chapter — UV and laser hues. | `ambient_sound_reactive` (+ optional `uv_only` entries via a curated block playlist); palettes `ultraviolet` + `laser_lime` + `vapor_laser`; shuffle ON. |
| `r2_quiet_reset` | 02:30 | Second hush. | As `r1`, different single palette (`electric_ice`). |
| `b3_ember_hold` | 02:40 | Warm, slow-burn chapter — the deep-night comedown. | `ambient_sound_reactive`; palettes `phoenix` + `acid_sunset` + `afterhours`; shuffle ON, delay lengthens (~120s). |
| `b4_open_sea` (tail) | 04:00 | Spacious, calm tail that hands into pre_dawn. | `ambient`; palettes `deep_sea` + `aurora`; shuffle ON. |

**Tail rule (drift seam, per D1):** the last block is clock-anchored but its
END is the sun-anchored `pre_dawn` cue (sunrise−120 ≈ 04:15–04:30 across the
week) simply firing over it — `ambient` cues don't hold, so the later cue
wins. No block may be authored to start after the week's earliest
sunrise−120; the dry-run suite (§9) asserts this ordering for every festival
day.

Because every block is `kind: ambient`, autopilot keeps cycling inside each
block, the mood cue keeps listening (party sessions can interleave — the
displaced-owner logic in `timeline_service.js` returns the deck to the
displaced block after a session), and an operator takeover slots in above it
all unchanged.

### 3.3 Safety visibility floor

The ship must never be effectively dark to approaching traffic while people
are on playa. Contract:

- Between `ignition_white` and `day_off`, **no cue authors
  `globals.master` below `M_FLOOR`** (a named, operator-approved constant —
  OD-2; placeholder 0.3).
- Quiet resets and the pre_dawn taper get their contrast from pattern
  choice, `speed`, saturation, and palette — **never** from master.
- The only master:0 writer in the whole plan is the 09:00 `day_off` cue.
- This is an authoring rule enforced by review + the dry-run lint pass (§9),
  not new engine machinery. A hard engine-side floor (a clamp refusing
  timeline master writes below `M_FLOOR` at night) would be new work and a
  deliberate exception to "no silent clamping" — if wanted, it must be a
  loud rejection, not a clamp (G8).

### 3.4 Shuffle vs sequential (verified against `show_plan.js validateAutopilot`)

The autopilot `shuffle` flag exists per cue/look; `false` = the playlist's
authored order. Directed sessions that rely on ordering MUST pin it off.
Explicitly:

- **`shuffle: false` (sequential, curated order):** `ignition_white`,
  `first_color` (`dusk_sprinkles` is authored as a ramp), both quiet resets
  (`r1`, `r2`), `sunrise_bloom`, `morning_watch` (autopilot
  `active: false` + pinned `entryId` — fully static by design), the dust
  cue (§8.1), and every event sequence (the baby cues already pin exact
  `entryId`s).
- **`shuffle: true` (variety):** `early_night`, deep-night major blocks
  (`b1`–`b4`), `pre_dawn`.

Where a future directed block needs opening/build/peak stages beyond one
ordered playlist, the existing `sequence` action (timed multi-step, §1.1)
is the tool — no engine work.

### 3.5 Anchor seams (D1 hybrid rule, applied)

- `first_color` starts sun-relative (sunset+30 ≈ 19:55–20:15 across the
  week) and ends at the fixed 21:30 `early_night` cue. Sunset drift keeps
  the start ≥ ~75 minutes before the end all week, so the seam cannot
  invert. The dry-run suite asserts start < end per day so a reuse of this
  plan at another latitude/season fails loud instead of silently skipping a
  phase.
- `deep_night` → `pre_dawn` seam: §3.2 tail rule.
- All other edges are either both-clock or both-sun and cannot collide.

---

## 4. Party: eligibility, enablement, budget, false triggers

### 4.1 Eligibility vs enablement (the two-gate contract)

Stated once more because every party conversation must use these words:

- **ELIGIBILITY** (schedule, this plan): `whenPhase: party_window` on the
  mood cue, with `party_window: {start: {clock: '21:30'}, end: {sun:
  sunrise, offsetMin: -120}}`. Inside the window a session is PERMITTED;
  outside it the mood trigger cannot fire. The window never turns anything
  on.
- **ENABLEMENT** (policy, human-only): `partyEnabled` via the CaptainPad
  toggle / `/party-config`. The plan contains NO action that flips it, and
  this design deliberately keeps it that way (G4 stays rejected): a
  schedule must never fight the human switch.

A party session requires eligibility AND enablement AND sustained real music
(dwell) AND an unspent cooldown. Exceptional early parties (before 21:30)
and sunrise sets (after the window closes, D8) are handled the same way:
the operator manually fires the party look / takes over — manual outranks
the plan by the arbiter, no plan edit needed.

### 4.2 Session shape

Unchanged from `/party-config` today: playlist `party_high`, dwell 120s,
session 12 min (or follow-the-music), cooldown live-tunable. All numbers are
operator-editable live from CaptainPad with no plan reload
(`timeline_service.js setPartyConfig`).

### 4.3 Per-hour party budget (new, required)

The existing rate limiter is `cooldownSec` — a gap between sessions, which
bounds the duty cycle but reads as "gap", not "budget". Contract for the
arc:

- **Budget target: at most 2 sessions per rolling hour** during eligibility.
- With fixed 12-minute sessions, `cooldownSec: 900` (15 min) yields a
  worst-case cycle of 27 min ≈ 2.2 sessions/hour — close enough to the
  target and achievable TODAY with one `/party-config` number.
  *Recommendation: set cooldown 900 for the arc and tune on the playa.*
- A TRUE rolling-hour counter ("Nth session in 60 min is refused loudly")
  does not exist in the engine — **needs engine work** if the operator wants
  the hard guarantee (G6). Follow-the-music mode (`durationEnabled: false`)
  makes sessions open-ended, so the budget there is governed by cooldown
  only; if the hard cap lands, it must count open-ended sessions from their
  start.

### 4.4 Neighboring-sound-camp false-trigger protection (new, required)

The threat: a nearby camp's rig runs all night; the detector hears
"sustained real music" forever and the boat parties on someone else's set.
Defense in depth, all but the last existing today:

1. **Enablement doctrine** — `partyEnabled` stays OFF except when the camp
   actually intends party responsiveness (our own DJ, a hosted set). This is
   the primary defense and it is procedural: the toggle is the consent
   switch, per §4.1.
2. **Detector quality** — the party signal is the companion's
   `party_mode_strong` classifier (`marsin_engine/audio/signals/
   party_mode_strong.js`), not a loudness gate; it is tuned for music AT the
   ship (docs/41 tuning).
3. **Dwell** — 120s of sustained qualification before a session can start;
   a passing art car doesn't survive it.
4. **Eligibility window + budget** — even a false positive can only spend
   the §4.3 budget inside 21:30→sunrise−120.
5. **(If needed on playa) input gain / threshold retune** at the companion —
   an operator knob, not a plan change.

If field experience shows these are insufficient, the honest next step is a
detector-side directionality/level floor (audio work, G9) — NOT silently
raising dwell until party never fires.

---

## 5. Event placeholder slots

Events interrupt the arc as **`manual`-trigger, `kind: program` cues** with a
`hold` window and `catchUp: false` (a ceremony must never "catch up" fire
after a reboot). The arbiter gives them PROGRAM priority: autopilot pauses,
mood/party is suppressed for the hold, Live Touch is preempted through the
handoff gate. When the hold expires (or the operator ends it), the deck
releases to the `defaultCue` — see §5.1 for the resume nuance.

| Slot | Cue id (placeholder) | Status of content | Notes |
|------|----------------------|-------------------|-------|
| Baby reveal | `c_baby_reveal_pink` / `c_baby_reveal_blue` | **Fully built** — live in `playa_default.yaml` today (manual sequence: `baby_tease` arc ~16.5 min → `baby_reveal` with the answer's color pinned via `colorPalette1/2`, hold 120). | Keep as-is; this is the template other events copy. |
| Wedding(s) | `c_event_wedding` — placeholder, `enabled: false` until content lands | **Removed from titanic** — the wedding show + playlists were deleted from the titanic scene; the wedding show file survives only under `test_bench` (`marsin_engine/lib/special_events/special_events_service.js` names this case in its refusal path). CaptainPad's Special Events picker gates cards on the engine-published `playlistsUsable`, so a wedding card cannot even be offered on titanic until its playlists exist again. | Re-introduction per D4 (ruled): when booked, restore/re-author the wedding playlists in `simulation/scenes/titanic/playlists/` + a titanic `special_events/` show file; `playlistsUsable` flips true on the next tick and the card appears — no code change. The timeline placeholder stays disabled until then; the plan validator fails loud on a dangling playlist name, which is exactly the safety we want. |
| Maxa party | `c_event_maxa` — manual, program, hold ~120, `durationMin` bounded | Placeholder — content TBD by operator. Suggested skeleton: `party_high` playlist, dedicated palette set via `colorAutopilot` (`bass_drop` + `ultraviolet` + `laser_lime`), autopilot delay ~30s shuffle ON (a party is a variety set, not a directed ramp — §3.4). | While a program owns the deck the mood cue is suppressed — the Maxa slot IS the party, no double-firing. |
| Philharmonic party | `c_event_philharmonic` — manual, program, hold ~90 | Placeholder — the plan already carries a `philharmonic` look (`sunset_coral`, slow, `shuffle: false` — correctly sequential for a directed set). Per D6 (ruled) it is now an EVENT, fired on the night it happens; the nightly `c_visibility_on` cue that used it is replaced by phases 1–2. | Sequential ordering matters here — keep `shuffle: false` (§3.4). |

Day-specific spectacles already in the plan (`c_burn_night` day 6,
`c_temple` day 7) coexist with this skeleton — their windows must be checked
against the nightly cues by the dry-run suite (§9); the validator rejects
overlapping `durationMin` windows, `hold`-only cues arbitrate by precedence.

### 5.1 How the arc resumes after an event

On release (hold expiry or operator end), the deck returns to the
**`defaultCue`** — a single static look (`ambient` today), NOT the
phase-appropriate look: phase/clock cues are edge-triggered and won't re-fire
mid-window. Under v2's block structure this mismatch is BIGGER than in v1: an
event ending at 01:30 resumes into generic ambient, not `b2_uv_lasers`, and
an event ending at 07:00 resumes into colored ambient instead of
`morning_watch` white — the latter also violates the D5 coverage intent.
Consequently **G1 (phase-aware default cue) is now the top engine gap**
(§11). Until it lands:

- Events ending inside deep_night: acceptable — default ambient is close
  enough to the block texture, and the next block cue restores structure at
  its clock time.
- Events ending in the white phases (rare — events are evening things): the
  operator restores with one CaptainPad tap; ceremonies always have the
  operator present.
- Note: `morning_watch` is a `program` cue with `hold.until 09:00` — a
  manual event fired DURING it would displace it, and on the event's release
  the boot/resume logic re-derives the owning cue for "now"
  (`resolve_deck_state.js` picks the latest passed restorable cue — which IS
  `morning_watch`), so the morning contract self-heals. The dry-run suite
  must include this case (§9).

---

## 6. Drift across the week (D1 — decided)

Hybrid anchoring, ruled:

- **Sun anchors** (light-tied): ignition (sunset−30), first_color start
  (sunset+30), pre_dawn (sunrise−120), sunrise_bloom (sunrise−20),
  morning_watch start (sunrise+60), party eligibility END (sunrise−120).
- **Fixed clocks** (policy-tied): eligibility start (21:30), early_night
  (21:30), deep-night blocks (23:30 / 01:00 / 01:10 / 02:30 / 02:40 /
  04:00), morning_watch end + lights-out (09:00).
- Seam analysis: §3.2 tail rule and §3.5.

---

## 7. Autonomy stance

The fixture runs the arc unattended; the operator always wins:

- **Cue kinds are chosen for interruptibility**: only the white bookends
  (ignition, sunrise_bloom, morning_watch) and events are `program`; every
  mid-night phase and block is `ambient`, so autopilot keeps cycling
  patterns and the mood cue keeps listening all night. Nothing needs the
  operator to advance.
- **Never stuck**: autopilot baseline + `defaultCue` fill every gap; every
  `program` cue carries an explicit `autopilot` block (the lint in §1.1
  enforces the discipline loudly — `morning_watch`'s is deliberately
  `active: false`).
- **Operator override always wins**: takeover leases, Live Touch preemption
  handoff, and the party ENABLEMENT toggle sit ABOVE the plan exactly as the
  arbiter defines today. This design adds no new authority.
- **One writer**: the arc is one plan (`playa_default`), evolved in place —
  no second plan racing it.

---

## 8. Operational envelopes and failure postures

### 8.1 Dust storm / high-visibility cue (new, required)

Whiteout posture: when dust cuts visibility, the ship's job flips from art
to BEACON — maximal legibility to disoriented traffic.

- **Cue**: `c_dust_storm` — `manual` trigger, `kind: program`, NO `hold`
  block (per `arbiter.js resolveHold`, an omitted hold = holds until the
  operator ends it or the next program cue — correct for weather of unknown
  duration), `catchUp: false`.
- **Look**: slow, high-contrast, maximum-conspicuity white/amber — steady
  sweeps, no strobes, no fast motion (fast flashing in a whiteout reads as
  chaos, not location). `white_only` slow entries in authored order
  (`shuffle: false`), `globals {master: M_IGNITION, speed: low}`. Party is
  automatically suppressed while the program holds (arbiter).
- **Trigger reality**: there is NO dust sensor in this stack — detection is
  the operator (or any camp member radioing them). The cue exists so the
  response is one tap, not improvisation. Auto-detection is out of scope
  and NOT assumed.
- **Release**: operator ends the program (CaptainPad); the resume logic
  re-derives the phase-appropriate owner for "now" (§5.1 note).

### 8.2 Audio-staleness behavior (new, required — fail loud per P0)

What exists: the mood-source staleness guard
(`lib/timeline/mood_source.js`, `tests/timeline/mood_source_staleness.test.js`)
forces the mood to CALM when the audio companion goes stale/dead — a dead
detector ends any open-ended party session and can never start one. The
staleness is surfaced on timeline state (CaptainPad-visible), not hidden.

What this design adds — the defined VISIBLE behavior of sound-reactive
content when audio is dead:

- Sound-reactive patterns keep rendering their no-audio baseline (audio
  signals read as silence — patterns animate on their internal motion, they
  do not freeze or go dark). The deep-night blocks therefore degrade to
  "ambient with less life", never to darkness. Block curation (OD-4) must
  verify each `ambient_sound_reactive` block entry actually has an
  acceptable silent baseline — that is a content review, on the gallery
  GIFs, not an engine change.
- NO automatic playlist demotion is invented here: swapping
  `ambient_sound_reactive` → `ambient` on staleness would be a silent
  fallback (codex P0). If the operator wants automatic demotion it must be
  an explicit, loud engine feature — logged, state-visible, and reversed on
  recovery — listed as G5.
- Until G5 exists: staleness alerts loudly (existing), the show visibly
  dims in character but never in safety (visibility floor is master-based,
  §3.3), and the operator decides whether to swap blocks manually.

### 8.3 White-channel power + thermal envelope (new, required)

`ignition_white`, `sunrise_bloom`, and `morning_watch` drive the W channel
across the whole hull for sustained periods — very likely the night's
highest sustained electrical load, at the day's hottest lit hours in the
morning case.

- **Contract**: all-white phases run at a named ceiling `M_WHITE_MAX`
  applied via each cue's `globals {master}` — never an implicit 1.0.
  `M_IGNITION ≤ M_WHITE_MAX`, and `M_MORNING` (morning watch) is
  deliberately LOWER (reduced steady visibility + the morning heat).
- **The numbers do not exist in this repo** — no measured W-channel
  amp/thermal data was found. They must come from a bench/genny measurement
  (G7): sustained all-white at candidate masters, measured at the PSUs, with
  controller temps. Until measured, the placeholders are conservative:
  `M_WHITE_MAX 0.8`, `M_IGNITION 0.8`, `M_MORNING 0.4` — all pending
  operator approval (OD-2).
- Full-master all-white remains available to the OPERATOR (takeover) for
  short moments; the PLAN never authors it for a sustained phase.

### 8.4 Fail-safe behavior (carried from v1 — no silent fallbacks, codex P0)

What the engine already does, which this design leans on rather than
re-inventing:

- **Engine restart mid-night**: timeline state is persisted
  (`states/titanic/timeline_state.yaml` — `firedToday`, cooldown stamps,
  `partyEnabled`, active plan). On boot, `_catchUp` re-resolves the plan at
  the current wall clock (today's applicable cues only, true past fire
  times) and re-applies the correct owner — a reboot at 02:00 comes back in
  `b3_ember_hold`, not at the top of the arc; a reboot at 07:30 comes back
  in `morning_watch` (the D5 coverage survives restarts). A party session
  does NOT survive a restart (deck windows are runtime-only) but the mood
  latch is re-armed on boot so the NEXT sustained music can still fire; the
  persisted cooldown is honored (no free session). Manual event cues have
  `catchUp: false` and never re-fire themselves.
- **Trigger/action failure**: a cue action that throws is logged loudly
  (`lastError`, lifecycle log, `planWarnings`), and the tick loop keeps
  running — one failed cue never stops the night. A failed default-cue
  apply does not retry-spin. A corrupt plan file refuses to load (throw), it
  is never silently replaced; the previous in-memory plan keeps driving
  until the operator fixes the file.
- **Clock steps**: backward wall-clock steps (RTC drift on an offline playa)
  are clamped so dwell/cooldown can't wedge party for the night
  (`triggers.js` L2 clamp).
- **Safe resume statement**: after ANY failure the safe state is the
  autopilot baseline / `defaultCue` ambient look at the current master
  level — visible (≥ `M_FLOOR` at night, §3.3), calm, alive. Nothing in
  this design invents a new fallback; where the arc needs behavior the
  engine lacks, it is listed in §11 as work, not assumed.

### 8.5 Operator takeover + master restoration semantics (new, required)

Takeovers can leave `master` (and any global) anywhere. The existing resume
contract (`timeline_service.js _catchUp`): on lease release, the plan
re-applies the owning cue's COMPLETE authored action, overwriting operator
changes — but only the fields that cue AUTHORS. Master is therefore
deterministic only where cues write it explicitly. Contract:

- **Explicit master writers in the plan**: `ignition_white`
  (`M_IGNITION` — the D5 restore value; the single place the show comes
  back from daytime zero), `morning_watch` (`M_MORNING`), `day_off` (`0`),
  `c_dust_storm` (`M_IGNITION`). Optionally `sunrise_bloom` (`M_IGNITION`)
  so a pre-dawn takeover can't dim the sunrise.
- **Deliberate non-writers**: `first_color`, `early_night`, all deep-night
  blocks, `pre_dawn`, quiet resets — so an operator's mid-night master trim
  SURVIVES block changes (blocks are `ambient` and author no master). The
  operator's trim stands until the next explicit writer (sunrise_bloom /
  morning_watch) or their own change — that is the intended authority
  model, stated here so nobody mistakes it for a bug.
- Restore-from-zero (D5 condition 1) is thereby explicit: only
  `ignition_white` (or a manual takeover) raises master after 09:00, and
  its value `M_IGNITION` is an operator-approved constant (OD-2), not an
  accident of whatever ran last.

---

## 9. Dry-run validation (new, required)

The plan ships only after a simulated pass over EVERY planned night, using
the existing tool (`marsin_engine/tools/timeline_dryrun.mjs` +
`tests/e2e/timeline_e2e_harness.mjs` patterns — full nights in seconds,
virtual clock):

1. **Per festival day (all indices)**: simulate midday→midday; assert the
   fire sequence matches the phase table (§3.1), block order (§3.2), no
   validator overlaps, and — critical for D5 — **zero ownerless minutes
   between sunset−30 and 09:00** and master 0 only after the 09:00 cue.
2. **Seam assertions** (§3.5): first_color start < 21:30 and last block
   start < sunrise−120, per day.
3. **Special-night interaction**: burn-night and temple-day indices with
   their day-specific cues active — assert the nightly cues and the
   spectacle holds arbitrate as intended.
4. **Event-night variants**: for each placeholder event, fire the manual
   cue at representative times (early evening, mid deep-night, during
   morning_watch) and assert the resume behavior (§5.1) — including the
   morning_watch self-heal case.
5. **Party interleave**: simulated mood edges inside and outside the
   eligibility window; assert no session outside 21:30→sunrise−120, budget
   respected (§4.3), and displaced blocks resume after sessions.
6. **Restart cases**: kill/reboot the simulated engine at 02:00 and 07:30;
   assert catch-up lands in the correct block / morning_watch.
7. **Lint clean**: `planWarnings` empty except deliberate, commented
   exceptions (none expected — every program cue authors an autopilot
   block).

Any assertion the tool cannot express today is a G2 work item, not a reason
to skip the assertion.

---

## 10. Open decisions for the operator (v2 — renumbered; D1–D8 are closed in §2)

1. **OD-1 — party eligibility end: sunrise−90 (D8 as ruled) vs sunrise−120
   (the revised `pre_dawn` start, which is party-disarmed).** The two
   rulings meet at a 30-minute seam. *Recommendation: sunrise−120, matching
   the taper — record it as the amended D8 default; sunrise sets stay
   manual either way.*
2. **OD-2 — the named master constants**: `M_IGNITION` (restore value, D5),
   `M_MORNING`, `M_FLOOR` (visibility floor), `M_WHITE_MAX` (white
   ceiling). Placeholders 0.8 / 0.4 / 0.3 / 0.8 pending the §8.3 power
   measurement and hull judgment. *Recommendation: approve placeholders for
   bench dry-runs; finalize after G7 measurement.*
3. **OD-3 — quiet-reset shape**: ~10 min at two seams as designed, vs
   shorter/more frequent. *Recommendation: as designed; judge on the hull.*
4. **OD-4 — deep-night block themes, times, and playlist curation**
   (including the §8.2 silent-baseline review of every sound-reactive block
   entry). *Recommendation: keep the four-block + two-reset structure;
   curate content while watching the boat.*
5. **OD-5 — party budget numbers**: cooldown 900s (≈2 sessions/hour) now,
   vs waiting for the hard rolling-hour cap (G6). *Recommendation: cooldown
   900 now; decide on G6 after a real night.*

---

## 11. Engine / CaptainPad gaps (v2 — priority-ordered)

The v2 arc still runs on the engine AS IT IS — plan YAML plus content
authoring is the whole implementation. The gaps are follow-ups, none
blocking the first cut:

- **G1 (engine, HIGH — was G2, risen per §5.1):** phase-aware `defaultCue` —
  resume from an event/takeover into the CURRENT phase's look instead of
  the single global default. The block structure and the D5 morning
  coverage contract both widen the mismatch surface; the morning case
  self-heals only because `morning_watch` is a program cue.
- **G2 (tooling, HIGH):** dry-run assertion coverage for §9 — the tool
  exists; the specific assertions (ownerless-minute scan, seam checks,
  event-resume variants, restart-in-block cases) may need harness
  extensions.
- **G3 (content, needed for phase 2 + deep night):** author
  `dusk_sprinkles` (D3, ruled) plus the deep-night block playlists /
  quiet-reset lists and the pinned `morning_watch` steady entry
  (operator-owned tuning in `simulation/scenes/titanic/playlists/`).
- **G4 (engine, REJECTED — kept on the list so it stays rejected):** a
  timeline action that flips `/party-config.enabled` on schedule.
  Eligibility (`whenPhase`) covers the schedule; enablement stays human
  (§4.1).
- **G5 (engine, medium):** audio-health-aware block demotion — an explicit,
  loud, state-visible swap of sound-reactive blocks to `ambient` while the
  companion is stale, reversed on recovery (§8.2). Never a silent fallback.
- **G6 (engine, low):** hard rolling-hour party session cap beyond
  cooldown (§4.3).
- **G7 (ops/bench, medium — feeds OD-2):** measure sustained all-white
  W-channel load and thermals at candidate masters; set `M_WHITE_MAX` /
  `M_IGNITION` / `M_MORNING` from data (§8.3).
- **G8 (engine, low):** loud engine-side rejection (not clamp) of nighttime
  timeline master writes below `M_FLOOR` (§3.3) — belt-and-suspenders over
  the authoring rule.
- **G9 (audio, only if field-proven necessary):** detector-side
  directionality/level floor against neighboring sound camps (§4.4).
- **G10 (CaptainPad, low):** surface the night arc (current phase/block +
  next cue + party eligibility/enablement states as two distinct
  indicators) on the timeline view — display only, no authority change.
- **G11 (content, when booked):** wedding show file + playlists restored to
  the titanic scene per D4 (ruled).
