# 20260725_19 — Companion PARTY tab + engine-owned party authority

**Author:** Implementation agent (Opus) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-27
**Workstream:** `bm26_show_readiness.md` R1 (tuning-UI follow-up) · **Basis:** `20260725_12` §2 / §6
**Deploy:** `DEPLOY OK: titanic-ext is running test_bench` (twice) · **Screenshot:** `~/tmp/companion_party_tab/party_tab.png`

## TL;DR

1. **The companion has a PARTY tab** — report `_12` §6's PowerShell curl loop is
   now a UI. Live meters for every term of the gate (with the threshold drawn on
   the bar), editors for all 11 `party:` tunables with **APPLY** (runtime) and
   **PERSIST** (config.yaml), the §6.2 capture helpers with the suggestion math
   pre-computed, a validation mode, and a FAKE TRIGGER.
2. **PERSIST is a surgical line edit.** A `yaml.load → yaml.dump` round-trip
   strips every comment from `config.yaml` — it already destroyed the palettes
   comments once. We replace individual `key: value` lines inside the `party:`
   block and nothing else; a key line we cannot locate **exactly** writes
   NOTHING and throws. Byte-compared in tests.
3. **The engine now owns the party POLICY** — `GET/PUT /party-config`: hard
   enable/disable, trigger playlist, and the session numbers
   (`minDwellSec` / `durationMin` / `cooldownSec` + `durationEnabled` /
   `cooldownEnabled`). Persisted in `timeline_state.yaml`, seeded once from the
   plan, read at **fire/evaluation time** (no plan reload), broadcast on
   `/ws/control` and replayed on connect. Both clients read/write this; neither
   stores it.
4. **Party is a citizen of the timeline, not a bypass.** Human takeover beats
   it, an inactive/dormant plan means no dwell at all, a stale mood ends an
   open-ended session — every one of those falls out of rules the timeline
   already had, and each is now pinned by a test.
5. **FAKE TRIGGER verified live end-to-end**: forcing on the companion moved the
   engine's `audioPartyStrong` to `1` while the detector's own truth stayed
   `false` in the meters; back to AUTO returned it to `0`.
6. **45 new tests.** Engine suite `2265 / 7 fail` — exactly the 7 known
   environmental failures (`_12` §7, `_17`). `git diff marsin_engine/states/`
   carries only the residue that was already dirty at session start.

---

## 1. What was built

| # | Item | File | Notes |
|---|---|---|---|
| 1 | PARTY tab markup | `audio/companion/ui/index.html` | new `<section id="page-party">` + nav button |
| 2 | PARTY tab logic | `audio/companion/ui/companion_app.js` | meters, editors, calibration, session, fake trigger |
| 3 | PARTY tab styling | `audio/companion/ui/companion_app.css` | mirrors the MIC TUNE visual language |
| 4 | Tunable spec + surgical persist + calibration math | `audio/companion/party_tuning.js` | **new**, pure, fully unit-tested |
| 5 | Server: 10 Hz `partyState`, capture, override, validation, persist, proxies | `audio/companion/companion_server.js` | |
| 6 | Detector read model | `audio/signals/party_mode_strong.js` → `getState(nowMs)` | metrics + verdicts + debounce progress |
| 7 | Read model passthrough | `audio/signals/derived_signals.js` → `getPartyStrongState()` | |
| 8 | Party authority state + bounds | `lib/timeline/timeline_state.js` | `partyConfigOf`, defaults, bounds |
| 9 | Authority + session semantics | `lib/timeline/timeline_service.js` | seed, get/set, fire-time resolution, follow-the-music, `effectiveState` |
| 10 | Trigger gate + timing injection | `lib/timeline/triggers.js` | `partyEnabled`, `partyTiming` |
| 11 | REST + WS | `lib/api_server.js`, `lib/ws_topic_routing.js` | `GET/PUT /party-config`, `partyConfig` on `/ws/control` |
| 12 | Plan cooldown aligned to the new default | `simulation/scenes/{titanic,test_bench}/timeline/playa_default.yaml` | `cooldownSec: 900 → 120` |
| 13 | Tests (15) | `tests/companion/companion_party_tab.test.js` | **new** |
| 14 | Tests (30) | `tests/timeline/party_config.test.js` + `tests/timeline/party_session_timeline.test.js` | **new** |
| 15 | Capture tool | `simulation/agent_tools/companion_party_capture.cjs` | **new** — screenshots the tab + prints its readouts |

---

## 2. The tab

Open the companion (`http://<host>:6966`) → **PARTY**.

### 2.1 LIVE — what the gate sees

Fed by a dedicated `partyState` broadcast at **10 Hz** (the publish rate of
`audioLoudness` itself — the natural update rate of these numbers), on its own
interval off the analysis hot path, skipped when no client is connected.

| Row | Shows | Threshold drawn as |
|---|---|---|
| LOUDNESS | `audioLoudness` | a **marker line at `ambientFloor × marginX`** — you SEE the gate. Auto-ranged (full scale = 2× threshold) so a 0.004 calibrated floor is still legible |
| KICK RATE | kicks/s | the **shaded accept window** between `kickRateMin` and `kickRateMax` |
| KICK REG | 1 − CV | line at `kickRegMin` |
| LOW / HIGH SHARE | band shares | lines at `shapeLowMin` / `shapeHighMin` |
| pills | `BPM LOCKED` (dimmed when `requireBpmLock` is off), `SILENT` / `NOT SILENT` (tooltip carries `audioSilence` vs `silenceMax`), BPM confidence | |
| terms | `LEVEL · BEAT · SHAPE · QUIET → QUALIFY` | each lights green when its term holds |
| debounce | `qualifying → ON  4.2s / 20.0s` or `disqualifying → OFF 11.0s / 30.0s` with a progress bar | |
| GATE pill | the **published** `audioPartyStrong` | |

When an override is engaged a red truth line appears: *"detector says no party ·
publishing 1 (FORCED — party)"*.

### 2.2 THRESHOLDS — APPLY and PERSIST

All 11 `_12` §2 tunables, each with its label, `config.yaml` key, unit and the
report's own "when to change it" hint.

- **APPLY** → `derived.setPartyStrongParams()` on the live detector. An unknown
  key or wrong type throws and is flashed verbatim; nothing is half-applied.
- **PERSIST** → surgical write into `marsin_engine/config.yaml` → `party:`.
- A dirty indicator names the keys that differ from what the detector is
  actually running, and **↺ reload live values** discards edits.

**The landmine, handled.** `patchPartyBlock()` (in `party_tuning.js`):

1. finds the single top-level `party:` block (0 or 2+ ⇒ throw);
2. for each edited key, matches exactly one `^\s+key:\s*<scalar><trailing comment>$`
   line *inside that block* (0 or 2+ ⇒ throw);
3. rebuilds the line as `indent + key + newScalar + trailingComment`;
4. splices the block back — **everything outside the replaced scalars is
   byte-identical**, including line endings.

A value that would serialize in exponent form (`1e-7`, which YAML 1.1 reads back
as a *string*) is refused rather than written. The test asserts a line-by-line
equality of everything except the edited keys, and separately that named
comments survive — including `# THE far-camp rejector` on a line that *is*
edited.

### 2.3 CALIBRATE (report `_12` §6.2)

Capture length (default 60 s; the report's playa procedure uses 300 s), then two
buttons:

- **① capture ambient** — our system OFF. Reports **P95**, median, max, n.
- **② capture party** — real party volume. Reports **P5**, median, the typical
  `kickReg` and the fraction of the capture with `bpmLocked`.

With both present, the suggestion row appears with the report's arithmetic
pre-computed:

```
ambientFloor = P95(ambient)
marginX      = 0.5 × ( P5(party) / P95(ambient) )
kickRegMin   = min(0.45, 0.8 × typical party kickReg)     [only when a party kickReg was captured]
```

One click **loads them into the editors** — it does not apply them. A capture
that recorded zero samples reports that as an error rather than a very quiet
measurement.

### 2.4 SESSION (read-only) + the arm/disable authority

Proxied from the engine via the companion's own `/party/session` (→
`/timeline/state`) and `/party/config` (→ `/party-config`), polled at 3 s only
while the tab is open. Shows `effectiveState` in words, the trigger playlist,
the sustain / session-length / cooldown numbers, the live timeline mood + key,
the active cue, a **`⚠ moodStale`** warning pill and a "plan not driving /
dormant — festival starts in N days" pill. A note states that session timing is
edited in the **Timeline tab**, not here. An unreachable engine prints the error;
it never shows stale numbers as if they were live.

The one *writable* control here is the big **ARM / DISABLE party mode** button
(behind a themed confirm) — it PUTs the engine's `/party-config`. The companion
never stores that boolean. Per the operator's call there is **no playlist picker
here** (the companion doesn't know playlists; `availablePlaylists` is for
CaptainPad).

### 2.5 VALIDATION MODE

A checkbox that sets `onSustainMs → 3000` **runtime only**, labelled
"never persisted". While it is on:

- an operator edit to `onSustainMs` updates the *shadow* value (what gets
  restored and what PERSIST writes), not the live 3 s;
- PERSIST writes the shadow value and says so in the flash.

So a validation session can never leak 3 s into `config.yaml`.

### 2.6 FAKE TRIGGER

Three states — **AUTO / FORCE PARTY / FORCE OFF** — implemented at the
**publish stage**: after `derived.tick()` and before `emitAllDerived()`, the
override writes `audioPartyStrong` into the CPC. The detector keeps running
untouched, so the meters show truth and the wire shows the forced value, side by
side. While an override is engaged an unmissable red banner sits at the top of
the tab with a one-tap **↩ back to AUTO**. **Runtime only** — a companion restart
returns to AUTO, and the UI says so.

Because the publish keeps flowing at the normal 5 Hz, the engine's staleness
guard stays happy and the timeline cannot distinguish a fake session from a real
one. That is the point.

---

## 3. `/party-config` — the contract (for the CaptainPad agent)

```
GET  /party-config
PUT  /party-config      body: any subset of the writable fields
```

**Writable:** `enabled` (bool) · `playlist` (string, must be in
`availablePlaylists`) · `minDwellSec` (0–3600) · `durationMin` (1–120) ·
`cooldownSec` (0–7200) · `durationEnabled` (bool) · `cooldownEnabled` (bool).

**Read-only in the response** (additive — a client built against
`{enabled, playlist}` stays valid):

| Field | Meaning |
|---|---|
| `availablePlaylists` | the engine playlist library |
| `effectiveState` | `armed` · `disabled` · `no_plan` · `manual` · `in_session` · `cooldown` |
| `effectiveDurationMin` | `null` in follow-the-music mode |
| `effectiveCooldownEnabled` / `effectiveCooldownSec` | forced `false` / `0` whenever duration is off |
| `planActive`, `inFestivalWindow`, `controller`, `mode` | the raw inputs, so a client can be more precise than the summary |
| `partyCueId`, `sessionFollowsMusic`, `sessionEndsAtMs`, `cooldownRemainingSec` | live session detail |

`/timeline/state` additionally carries `partyEnabled` and `partyPlaylist`.
A `partyConfig` WS message is broadcast on `/ws/control` after every successful
PUT and replayed on connect.

**Validation is strict and all-or-nothing.** An unknown field, an unknown
playlist, a non-boolean, or an out-of-bounds number ⇒ **400** with a message
naming the field and the bound, and **nothing is applied** (verified by a test
that PUTs one valid field beside one invalid one and asserts the config is
unchanged). No clamping.

### `effectiveState`, and what it is for

The operator asked that nobody paint a misleading ARMED. Precedence of the
reported state mirrors the real precedence — `disabled` (the operator's standing
decision) is reported ahead of `manual`, and both ahead of anything the
automation would do. **A human takeover reads as `manual`**, which is a sixth
value beyond the five in the brief; I added it because reporting a takeover as
`no_plan` would be actively misleading. `planActive`/`controller`/`mode` are in
the payload for anyone who wants to disagree with the summary.

### Session model

- **`minDwellSec` is always enforced** — no toggle (operator: "sustain should
  always be there for a strong detection").
- **`durationEnabled: true`** — fixed `durationMin` session, then `cooldownSec`
  (when `cooldownEnabled`) before a re-trigger.
- **`durationEnabled: false` — FOLLOW THE MUSIC.** No fixed length. The session
  ends **when the party signal drops**, and there is **no cooldown at all**;
  re-triggering needs only the usual `minDwellSec` sustain.

**One release sustain, not two.** The drop of `audioPartyStrong` already
embodies the detector's own `offConfirmMs` (30 s of continuous disqualification
by default), so the timeline adds **no** second wait. Music stop → lights calm is
therefore ≈ `offConfirmMs`, and it is tuned in this tab's `offConfirmMs` editor,
whose label now reads *"OFF confirm (release sustain)"*. The session card spells
the same thing out: *"follow the music — ends ~30s after the music stops (that is
offConfirmMs above)"*.

### Where the numbers come from (no dual authority)

On the first plan load, `partyPlaylist` / `minDwellSec` / `durationMin` /
`cooldownSec` are **seeded once** from the active plan's party cue — the cue's
`trigger.minDwellSec`, its `durationMin`, its `trigger.cooldownSec`, and the
playlist its look already loads. After that, **`/party-config` is the only
place those are read from**: the plan YAML's copies are ignored, so an operator
edit takes effect on the next evaluation with no plan reload and the two can
never silently disagree.

Seeding from the plan (rather than jumping straight to the shipped defaults) is
deliberate: adopting this feature must not repoint an existing plan at a
playlist it never names. That is also what caught a real regression —
`timeline_service.test.js` "mood swap drives the lights under autopilot" went
red when the override initially defaulted to `party_high` over a plan whose look
was `party_pl`. Seeding fixed it; the suite is green.

`cooldownSec`'s shipped default is now **120 s**, and both scenes'
`playa_default.yaml` party cues were changed `900 → 120` to match so a fresh
seed and the shipped default agree.

---

## 4. Timeline compatibility

The operator's rule: the timeline is the senior system; party mode is a
well-behaved citizen inside it, never a bypass. Where the timeline already had a
rule I followed it rather than adding a party special case.

| Interaction | Behaviour | Verified |
|---|---|---|
| **No plan active** | `_tick()` returns immediately when `plan`/`state` are null — no `evaluateTick`, so **no dwell accumulation and no session, ever**. Structural, pre-existing. | **test** |
| **Outside the festival window** | The tick's earliest gate goes dormant before evaluate/arbitrate. Nothing fires; the POLICY still reads armed, `effectiveState: no_plan`. | **test** |
| **Human takeover mid-session** | `takeover()` → `mode: overridden` → `_isPlanDrivingDeck()` false → the deck freezes where the human left it and the plan's pin releases. No party code involved. | **test** (disable during takeover re-applies nothing) |
| **Human active blocks a pending trigger** | The **arbiter** suppresses the fire into `wouldFire` under `manual` — the same rule that has always suppressed mood swaps under a program. No party special case. | **test** |
| **Disable mid-session** | Ownership latches drop, `_applyDefaultCue('party-disabled')` reclaims the deck — **unless the plan isn't driving**, in which case we touch nothing (human > everything). | **test** ×2 |
| **Disable while armed but not in session** | The trigger is skipped **after** arming and **before** the fire bookkeeping, so the arm latch survives and the cooldown is not stamped: re-enabling fires immediately, nothing was consumed. | **test** |
| **Party session vs scheduled cues / programs** | Unchanged: the arbiter's MANUAL > PROGRAM > AUTOPILOT precedence governs. A party cue is an ordinary autopilot-layer mood cue; a program still suppresses it. | pre-existing tests (`timeline_arbiter`, `timeline_mood_autofire`) — **reasoned, not re-tested here** |
| **defaultCue reassertion** | Every party end path — window elapsed, follow-the-music release, operator disable — routes through the **same** `_applyDefaultCue` / `_reconcileDefaultCue` machinery as any other cue. | **test** (both end paths) |
| **Staleness mid-session** | `MoodSource` forces CALM; in follow-the-music mode that ends the session and the default cue reclaims the deck (a dead companion cannot pin the rig in party). In fixed-duration mode the window governs, as designed. | **test** |
| **Toggling `durationEnabled` mid-session** | The running session **keeps the mode it started with** (least surprising: a flip must not retro-convert a live 12-minute session into an open-ended one, or cut an open-ended one short). The new mode applies to the next session. | **test** |
| **Fake-trigger sessions** | Indistinguishable from real to the timeline — it only ever sees `mood.party`. | **test** |
| **Forced party + `enabled: false`** | Nothing fires. Policy wins over a forced signal. | **test** |
| **Plan reload / edit mid-session or mid-cooldown** | The session numbers now come from party-config, so a plan edit no longer changes a live session's terms at all — strictly *less* surprising than before. `moodLastFire` (the cooldown stamp) is persisted state and unaffected by a plan reload. | **reasoned + partially tested** (cooldown stamp persistence is tested; a mid-session `savePlan` hot-reload is not) |
| **Engine restart mid-session** | The persisted `enabled` / playlist / numbers are honoured; the *deck window* is runtime-only and does not survive — the same as every other cue, and boot `catchUp` re-derives the owner. **Flagged below.** | **test** for the persisted half |
| **Look / snapshot recall mid-session** | Untouched: a recall writes the deck the way it always did, and the party cue's ownership latch behaves exactly like any other cue's. | **reasoned, not tested** |

### Flags for the validator / coordinator

1. **A running session does not survive an engine restart.** `_deckWindowCueId`
   / `_deckWindowUntilMs` are runtime-only for *all* cues — pre-existing
   behaviour I deliberately did not special-case for party. After a restart the
   deck falls back to the default cue and the party cue can re-trigger once the
   dwell is satisfied again (the *cooldown* stamp does persist, so no free
   session). If the operator wants sessions to survive restarts, that is a
   general timeline feature, not a party one.
2. **`_partySessionFollowsMusic` is runtime-only** for the same reason — a
   restart during a follow-the-music session ends it (via the default cue), it
   does not resume open-ended.
3. **Mid-session `savePlan` hot-reload is untested here.** The active-plan
   hot-reload path exists and is exercised elsewhere; I reasoned that party is
   now *less* exposed to it (its numbers no longer come from the plan) but did
   not write a test.
4. **The human-vs-plan precedence mechanism already existed** (`arbitrate()` +
   `_isPlanDrivingDeck()`), so nothing was invented. Party hooks into it and
   adds no override of its own — no gap to report.

---

## 5. Manual test recipe (no audio required)

On the show machine, with the companion PARTY tab open:

1. **Prerequisite** — `effectiveState` must not be `no_plan`. Today it *is*
   (`planActive: false`, festival starts in 34 days), so for a full-chain test
   temporarily set `festival.startDate` in
   `simulation/scenes/test_bench/timeline/playa_default.yaml` to today, deploy,
   and **put it back afterwards** (`_12` §8.1).
2. Optionally shorten the wait: PUT `minDwellSec: 20` (CaptainPad Timeline tab,
   or `curl -X PUT .../party-config`). Leave `onSustainMs` alone — the fake
   trigger bypasses the detector entirely.
3. **FORCE PARTY** on the tab. The banner appears; the GATE pill flips to 1 while
   the meters keep showing the detector's real (quiet) truth.
4. Watch the SESSION card: `effectiveState` goes `armed` → (dwell elapses) →
   **`in_session`**, `active cue` becomes the party cue, and the configured
   playlist loads on the deck. CaptainPad shows the same.
5. **Fixed-duration mode:** the session runs its `durationMin`, then the deck
   returns to the ambient default cue and `effectiveState` shows `cooldown`
   until `cooldownSec` expires.
   **Follow-the-music mode** (`durationEnabled: false`): press **AUTO** (or
   FORCE OFF) — the signal drops and the session ends within a tick, with no
   cooldown afterwards.
6. **Policy check:** with FORCE PARTY still held, **DISABLE party mode**. A live
   session ends at once and no new one can start — policy beats a forced signal.
   Re-ARM and it fires again after the dwell.
7. Put `minDwellSec` back to 120, `festival.startDate` back, and leave the fake
   trigger on **AUTO** (a companion restart would do it for you).

For the *detector* half (no timeline needed), the tab's **VALIDATION MODE**
drops `onSustainMs` to 3 s: play music and watch the debounce bar fill and the
GATE pill flip within seconds.

---

## 6. Evidence

### Tests

`tests/companion/companion_party_tab.test.js` — **15 pass**. Persist: comments +
every non-edited byte survive; a boolean and a trailing-comment line edit
cleanly; a missing key throws and the file on disk is untouched; unknown key /
missing block / duplicate block all throw; a filesystem round-trip re-parses to
the new values with the neighbouring blocks intact; exponent-form values
refused. Calibration: percentile interpolation, order independence, empty
capture and bad-`p` failures, the §6.2 suggestion arithmetic, `kickRegMin` only
lowering, null with one capture. Application: `setPartyStrongParams` reaches the
live detector, rejects a typo/bad type without changing anything, validation-mode
round-trip, and the meter read model (threshold line, verdicts, debounce
progress, `NaN` guard) driven by a synthetic 128 BPM beat that latches the gate.

`tests/timeline/party_config.test.js` (11) + `tests/timeline/party_session_timeline.test.js` (19)
— **30 pass**, covering everything in §4's table plus: persistence round-trips,
strict validation and bounds, the seed-once rule (and that re-seeding never
overwrites an operator value), shipped defaults with no party cue, effective
values in both session modes, follow-the-music start/hold/release, no cooldown
after a follow-music session, and toggle persistence.

> **Split note:** the two timeline files are one logical suite, split because a
> single large chatty file trips the known Windows `node:test` worker-IPC flake
> (`Unable to deserialize cloned data` — `_12` §7) and silently truncates the
> run. The service-level file also silences `console.log` for the same reason.
> Both are green at default concurrency.

### Engine suite

```
ℹ tests 2265   ℹ pass 2258   ℹ fail 7
```

The 7 are exactly the known environmental failures (5 × `audio_capture` "no
pinned device", `osc_listener` `EACCES`-not-`EADDRINUSE`, and the
`effects_v2_mode_page_layout` worker flake). No new failures.

### Runtime-state residue

`git status marsin_engine/states/` lists the same files that were dirty at
session start — no new residue from this work or the suite.

### Deploy + live verification

```
DEPLOY OK: titanic-ext is running test_bench from e805ef01.     (ran twice)
```

`GET http://10.x.x.151:6968/party-config` and the companion's
`http://10.x.x.151:6966/party/config` proxy return identical payloads
(`enabled: true`, `playlist: party_high`, `120/12/120`, `effectiveState: no_plan`,
14 available playlists). Screenshot of the live tab, with its readouts:

```
GATE 0 · ARMED
loudness 0.0105   ≥ 0.2250 (floor 0.09 × 2.5)
kick 0.00  reg 0.00  low 0.00  high 0.00   debounce: idle — not qualifying
effective state: no plan driving — the mood trigger lives in the plan, so nothing can fire
playlist party_high · sustain 2min (always enforced) · session 12 min · cooldown 2min
timeline mood: calm (value 0, key audioPartyStrong)     11 editors rendered, 0 page errors
```

→ `~/tmp/companion_party_tab/party_tab.png`

**FAKE TRIGGER, live on the show machine:**

```
before  engine audioPartyStrong = 0
FORCED  engine audioPartyStrong = 1
        companion detector truth party = false | publishing = true | overrideMode = party
AUTO    engine audioPartyStrong = 0 | overrideMode = auto
```

---

## 7. Offline

No CDNs, no fonts, no runtime installs. The tab is vanilla JS in the existing
`companion_app.js`, styled with the existing theme variables, and every network
call it makes is to the companion's own origin (which proxies to the engine on
the LAN).

## 8. Follow-ups

1. **Playa calibration run** (`_12` §6.2) is now a UI flow, but still needs an
   evening with the real system — the only remaining blocker on R1 being
   *trustworthy* rather than merely *correct*.
2. **Session survival across an engine restart** (§4 flag 1) — a general
   timeline question, not a party one.
3. **`audioSilence` reads 1 while `micMidRaw ≈ 0.36`** on the show machine
   (`_12` §10.6) — still open; the tab's SILENT pill now makes it visible at a
   glance, which is how I'd expect it to get noticed.
4. **A mid-session plan hot-reload test** (§4 flag 3).

## 9. Files

- `marsin_engine/audio/companion/party_tuning.js` *(new)*
- `marsin_engine/audio/companion/companion_server.js`
- `marsin_engine/audio/companion/ui/{index.html,companion_app.js,companion_app.css}`
- `marsin_engine/audio/signals/{party_mode_strong,derived_signals}.js`
- `marsin_engine/lib/timeline/{timeline_state,timeline_service,triggers}.js`
- `marsin_engine/lib/{api_server,ws_topic_routing}.js`
- `marsin_engine/config.yaml` (unchanged by this work — it is the PERSIST target)
- `simulation/scenes/{titanic,test_bench}/timeline/playa_default.yaml`
- `simulation/agent_tools/companion_party_capture.cjs` *(new)*
- `marsin_engine/tests/companion/companion_party_tab.test.js` *(new)*
- `marsin_engine/tests/timeline/{party_config,party_session_timeline}.test.js` *(new)*
