# `_103` — RED-TEAM: timeline / arbiter / party-session subsystem

**Adversarial audit** of the show timeline: `lib/timeline/*`
(triggers, arbiter, festival, sun, show_plan/lint, resolve_deck_state,
timeline_state, timeline_service), the party-session lifecycle
(sustain / session / cooldown / arm-latch / follow-music), and the sun /
festival / cue / phase resolution math. Weaponised the `_93` dry-run harness
(`marsin_engine/tools/timeline_dryrun.mjs`) — it drives the REAL tick,
arbiter, triggers, sun math, playlist resolution and party bookkeeping with an
injected clock + mood — against pathological plans and mood tracks. Cross-read
against reports `_91`/`_93`/`_95`/`_98`/`_100`.

**Report-only: zero source edits, zero tracked-suite edits, no engine spawned
(the harness needs none — it writes only to `~/tmp/timeline_dryrun/`), zero
device HTTP, zero sACN to hardware, no git ops.** `marsin_engine/config.yaml`
verified **CLEAN vs HEAD** (absent from `git status` before and after; the
harness never touches it, `scenes/**` or `states/**` — plans are copied to
`~/tmp` first). All repros live in `~/tmp/redteam_timeline/`.

Attack surface owned here (five other red-teamers own the rest): the timeline
subsystem only — NOT zoom/travel (`_104`), NOT the sACN bridge (`_105`), NOT
controllers (`_106`/`_109`), NOT fixtures (`_107`), NOT the API/WS contract
(`_108`).

---

## 0. Headline

The trigger/arbiter/festival/sun cores are **hardened** — every pathological
PLAN I threw (DST transitions, polar/degenerate sun, overlaps, missing
playlists, zero cues, out-of-window, identical-time cues, past holds) either
resolves sanely or **fails loud**, with no crash and no wrong-deck. **The break
is in the PARTY SESSION lifecycle:** the mood→party cue has **no "I already own
the deck" idempotency guard**, so under a detector that dips-and-returns (any
music with quiet gaps ≥ the detector's `offConfirmMs`) the cue **re-fires on
every return**, and each re-fire (a) re-loads the party playlist — which the
engine hard-resets to pattern-1 with a transition swap — and (b) pushes the
`durationMin` window forward, so the operator's session/cooldown cadence is
**silently never honoured**. This is on the mission-critical party night.

| # | Severity | Category | One-liner |
|---|---|---|---|
| **H1** | **HIGH** | quirk / deck-thrash | mood→party cue re-fires while its OWN session is live (detector dip→return re-arms it); each re-fire re-dispatches the look → the deck resets to pattern-1 with a transition swap, every music gap, all party night |
| **M1** | **MED** | quirk / silent-cadence-loss | the same re-fire re-stamps `_deckWindowUntilMs = now + durationMin`, so a "12-min session + 2-min cooldown" becomes ONE endless session — the operator's configured cadence + cooldown never occur under flapping music |
| **L1** | **LOW** | validation gap / silent no-op | a `mood` cue with `from === to` passes validation and can NEVER fire (silent dead cue, no warning) |
| **L2** | **LOW** | quirk / silent-intent-loss | a program `hold.until` an anchor already in the past (e.g. `until: sunrise` on an after-sunrise cue) makes the program expire ~1 tick later — the hold is silently ~zero; validator can't catch (dynamic) |
| **L3** | **LOW** | quirk / wasted-dispatch | two clock/sun cues at the IDENTICAL time both dispatch on the same tick (deck double-write); for two programs the earlier one's HOLD is silently discarded — the overlap validator only checks `durationMin`, never `hold` |
| **L4** | **LOW** | quirk (off-playa) | DST spring-forward: a clock cue at a wall time inside the skipped hour fires an hour late. N/A to BM (late-Aug/early-Sep, no transition); recorded for completeness |
| **L5** | **LOW** | harness-reporting | `timeline_dryrun.mjs` mis-counts the `party-config` lifecycle line as a "party session ended" in its SUMMARY (any reason starting `party-`) |

**Top 3: H1 (HIGH), M1 (MED), L1 (LOW).** `config.yaml` clean: **YES.**

---

## 1. What I could NOT break (recorded so the next pass doesn't re-plough it)

All driven through the harness against the REAL cores:

- **Edge-storm dwell defence holds.** A mood flipping CALM/LOUD every single
  tick (`~/tmp/redteam_timeline/flip.json`, 1-min on/1-min off) with the
  **default dwell (120 s)** produces **zero** party fires — `moodSince` resets
  on every mood change, so dwell is never satisfied. The re-fire in H1 needs a
  dwell short enough to be satisfied within a burst; the storm alone is inert.
- **`_98` arm-latch fix confirmed on burn night.** Real `playa_default`, day 6
  (`--date 2026-09-05 --mood all_night`): despite the 2-hour `c_burn_night`
  program hold suppressing early mood fires, **27 party sessions** ran after the
  hold ended. The `_93` §5.1 "one suppression kills party for the night" bug is
  dead — suppression no longer consumes the arm latch.
- **Continuous party = clean repeat sessions.** `--mood all_night` on the
  fixture: 35 sessions, 34 window-elapsed ends, correct session→cooldown→re-arm
  cadence. (H1 is specifically triggered by the mood RETURNING to calm and back,
  not by sustained party.)
- **Festival boundaries + day-gating are exact.** `--date 2026-08-30` = festival
  day 0 (startDate boundary, fires); day 6 fires `c_burn_night` and NOT
  `c_temple`; day 7 the reverse; `--date 2026-09-07` (out of the 8-day window)
  **refuses loud** without `--allow-dormant` and goes fully dormant with it.
- **Overlapping deck windows are rejected at load.** Two clock programs with
  overlapping `durationMin` windows → `validateNoOverlap` throws pre-run naming
  both cue ids + the day (`~/tmp/redteam_timeline/overlap.yaml`).
- **DST fall-back de-dupes correctly.** A clock cue at 01:30 on 2026-11-01 (a
  wall time that occurs twice) fires **once** — the `firedToday` latch holds
  across the repeated hour; no double-fire.
- **Polar / degenerate sun fails safe.** lat 78 in high summer (no
  sunset/sunrise): sun cues resolve to `null` and never fire, sun phases never
  activate, the `defaultCue` fills the deck — no crash, no wrong-deck
  (`~/tmp/redteam_timeline/polar.yaml`).
- **Missing playlists fail loud (non-fatal).** `autopilot.playlist` /
  look-playlist that don't exist → recorded as `bootError` + per-cue
  `cueErrors` + `console.warn`, deck ends empty; the tick keeps running (the
  documented "fail loud but never crash the loop" contract). `bootError`
  persists on `/timeline/state` so it stays visible.
- **Zero-cue and identical-time plans resolve deterministically.** Empty `cues`
  → `defaultCue` drives the deck; two same-time cues → plan-order wins,
  loser SUPPRESSED and surfaced as a `wouldFire` (see L3 for the program-hold
  wrinkle).
- **Malformed CLI / plan inputs all fail loud.** Unknown flag, out-of-range
  `--days`/`--step`, bad `--date`, `--from`/`--to` producing an empty span,
  `from==to` mood on a non-festival plan with day-indices — every one throws.

---

## 2. Findings

### H1 — HIGH — the party cue re-fires over its own live session; the deck resets to pattern-1 every music gap

**Category:** quirk / deck-thrash on the mission-critical party subsystem.

**Where.** `lib/timeline/triggers.js` (mood branch, ~L275-315) +
`lib/timeline/arbiter.js` (mood branch, L174-180) +
`lib/timeline/timeline_service.js` `_noteDeckWindow` (~L843-852) +
`lib/api_server.js` `timelineLoadPlaylistOnDeck` (L4372-4423).

**Mechanism.**
1. When a party session fires, `evaluateTick` burns the one-fire latch
   (`next.moodArmed[cue.id] = false`, triggers.js:312). Good — a *sustained*
   party never re-fires.
2. But the mood branch **re-arms on every return to `from`**:
   `if (party === fromVal) { next.moodArmed[cue.id] = true; continue; }`
   (triggers.js:284-286). So the moment the detector dips to calm (a song gap /
   breakdown / DJ change lasting ≥ the audio companion's `offConfirmMs`, default
   30 s), `moodArmed` flips back to `true`.
3. On the next LOUD return, the fire gate is `party===toVal && moodArmed &&
   dwellOk && cooldownOk`. There is **no term for "this cue already owns the
   deck / a session is live."** With the SHIPPED dwell (`playa_default`
   `c_mood_to_party.minDwellSec: 20`) the burst satisfies dwell in 20 s, and the
   in-session cooldown is 0 (D3 anchors cooldown at session END, and while the
   window is live `moodLastFire` reflects the last fire), so it **fires again**.
4. The arbiter passes it through (`controller === 'autopilot'` during a party
   session; arbiter.js:174-180 — again no ownership check).
5. `_dispatchArbitratedAction` → `_applyAction(look party_high)` re-runs the
   WHOLE look: `timelineLoadPlaylistOnDeck` (which **always** loads
   `pl.entries.find(e=>!e._missing)` — the FIRST entry — with a transition
   animation; api_server.js:4381/4414-4421, **no "already on this playlist"
   short-circuit**), re-applies the palette (`setParams`), and re-applies the
   deck autopilot (`setAutopilot`, resetting the cycle-delay timer).

**Impact.** Every music dip-and-return during a party **snaps the deck back to
the party playlist's first pattern with a transition swap**, resets the palette,
and resets the pattern-autopilot dwell timer. On a real DJ night this recurs
every quiet gap between tracks/sets — a visible, repeated "jump back to pattern
1" on the exterior during the show's peak.

**Repro** (`~/tmp/redteam_timeline/FINDING_refire_storm.txt`), run from
`marsin_engine/`:

```
# realistic music flap: 3 min on / 2 min off, 21:00-02:00
MF="<home>/tmp/redteam_timeline/flap.json"
node tools/timeline_dryrun.mjs --fixture --date 2026-09-01 --mood-file "$MF" \
   --from 20:30 --days 2 --to 02:30 --step 1 \
   --party-config '{"minDwellSec":20,"durationMin":12,"cooldownSec":120}'
```

- **Observed:** `FIRE c_mood_to_party` **60×**, `window elapsed` only **1×** in
  ~5 h; `5h03m` reported `in_session` (one apparent unbroken session). Each fire
  re-dispatches `party_high`.
- **Expected:** while a party session already owns the deck, a re-fire of the
  SAME party cue should be an idempotent no-op (do not reload the deck, do not
  re-apply the look).
- With `--party-config '{"minDwellSec":0,...}'` and the 1-min flip storm the
  effect is starker: **180 re-fires, 1 window-elapsed** in 6 h.

**Why the tests miss it.** The e2e/dry-run suites exercise *sustained* moods
(clean repeat cadence) and *suppressed* moods (`_98`); none drive a mood that
oscillates faster than `durationMin` while a session is live.

**Fix options:** in the mood branch (or in `_noteDeckWindow`/the dispatch),
suppress a party-cue fire while that same cue already owns the deck
(`_deckWindowCueId === cue.id` and the window is live) — treat the re-fire as an
idempotent no-op, OR at minimum make `timelineLoadPlaylistOnDeck` skip the
reload when the requested playlist+entry are already live on the deck. See M1
for the window-extension half.

---

### M1 — MED — a re-firing party cue perpetually extends its window; session length + cooldown are silently never honoured

**Category:** quirk / silent loss of the operator's configured cadence. Same
root as H1, distinct operator-facing consequence (holds even if the deck reload
were made idempotent).

`_noteDeckWindow` (timeline_service.js:845) sets, on EVERY (re)fire of the owning
party cue, `this._deckWindowUntilMs = now + durationMin * 60000`. The
"re-firing over its own session" guard at :824 only protects the session-END
*bookkeeping* (`prevOwner` requires `cueId !== this._deckWindowCueId`), not the
window stamp. So each re-fire pushes the session end forward by a full
`durationMin` from *now*.

Consequence: with the flapping mood above, a "12-minute session, then 2-minute
cooldown" (the operator's `/party-config`) collapses into **one continuous
session for as long as the music keeps returning** — `window-elapsed` fires once
in 5 h instead of ~20 times, the cooldown never begins, and
`getPartyStatus().sessionEndsAtMs` keeps sliding (a CaptainPad session-end
countdown that never counts down). The operator sets a cadence; the show ignores
it whenever the detector dips-and-returns.

**Repro:** the SUMMARY of the M-config run above (`started`/`window-elapsed`
counts). **Fix:** on a re-fire of the cue that already owns the live window,
do NOT re-stamp `_deckWindowUntilMs` (keep the original end), so `durationMin`
governs from the FIRST fire and the cooldown eventually runs.

---

### L1 — LOW — a `mood` cue with `from === to` validates but can never fire

`validateTrigger` (show_plan.js:336-354) accepts any `from`/`to` in
`{calm, party}` independently, so `{from: party, to: party}` (or `calm→calm`)
passes. In `evaluateTick`, `if (party === fromVal) { arm; continue; }`
(triggers.js:284) catches the tick before the fire branch whenever
`fromVal === toVal`, so the cue is a **silent dead cue** — it never fires and
nothing warns. Codex "fail loud" argues for rejecting `from === to` at
validation. Repro: `~/tmp/redteam_timeline/degen_mood.yaml` with `--mood
all_night` → zero fires, no error. **Fix:** throw in `validateTrigger` when
`trigger.from === trigger.to`.

### L2 — LOW — a program `hold.until` an already-past anchor gives a ~zero hold

`resolveHold` (arbiter.js:42-45) resolves `{until: anchor}` to that anchor's
absolute epoch on the fire day. If the anchor is already in the past relative to
the fire (e.g. a cue firing at 22:00 with `hold: {until: {clock: "20:00"}}`, or
any `until: {sun: sunrise}` on a post-sunrise cue), `untilMs < fireMs`, so the
arbiter expires the program on the very next tick. The revert is logged
(`hold-expired`), so it is not fully silent — but the authored intent ("hold
until X") is silently violated and the program flashes for ~1 tick. The
validator can't catch it (fire time is dynamic). Repro:
`~/tmp/redteam_timeline/hold_past.yaml`. **Fix:** the resolver could emit a
lint/warning when a program's resolved `holdUntilMs <= fireMs`.

### L3 — LOW — two same-time cues both dispatch; a program's hold is silently discarded

Two clock/sun cues resolving to the same instant both appear in `fires` and both
are dispatched on the same tick (deck written twice — a flash). For two
**programs**, the arbiter overwrites `activeProgram` in plan order (arbiter.js:166),
so the earlier program's action is applied then immediately clobbered and its
`hold` is **silently discarded** — the later program's (shorter/longer) hold
governs. `validateNoOverlap` (show_plan.js:731-770) only compares cues that have
a `durationMin` AND a clock/sun trigger, so same-time **holds** are invisible to
it. Repro: `~/tmp/redteam_timeline/two_prog.yaml` (two programs at 20:00, holds
60/30 → the run ends at 20:30 on the *second* cue's hold; the first's 60-min
hold is lost). **Fix:** extend the overlap validator (or a lint) to same-instant
clock/sun cues regardless of `durationMin`.

### L4 — LOW — DST spring-forward: a cue in the skipped hour fires late (off-playa)

A clock cue authored at a wall time inside the spring-forward gap (LA jumps
02:00→03:00 on 2026-03-08; cue at `02:30`) fires an hour late (at 03:30),
because `clockToEpochMs` maps the nonexistent local time through the
offset-at-the-naive-instant correction. **Not applicable to Burning Man**
(late-Aug/early-Sep — no DST transition in the festival window); recorded for
completeness. Repro: `~/tmp/redteam_timeline/dst_spring.yaml`.

### L5 — LOW — harness mis-counts `party-config` as a session end

`timeline_dryrun.mjs` (`accumulate`/event loop, ~L809) does
`countIn(summary.partySessionEnds, ev.reason)` for any lifecycle whose `reason`
starts with `party-`. `setPartyConfig` logs a lifecycle with reason
`party-config` (the "Party mode ARMED/DISABLED …" line), so applying
`--party-config` before a run shows a spurious `ended: 1 × party-config` in the
SUMMARY. Harness-reporting only (no engine impact), but it can mislead a reader
of a dry-run transcript. **Fix:** match the specific end reasons
(`party-window-elapsed`, `party-follow-music`, `party-disabled`,
`party-not-resumed`, `superseded`, `dormant`) rather than the `party-` prefix.

---

## 3. Attack coverage matrix

| Attack | Verdict |
|---|---|
| Mood flips every tick (edge storm), default dwell | inert — dwell never satisfied (§1) |
| Mood flips, `minDwellSec:0` | **H1/M1** — 180 re-fires, 1 window-elapse in 6 h |
| Realistic music flap (3-on/2-off), SHIPPED dwell 20 | **H1/M1** — 60 re-fires, 1 window-elapse in 5 h |
| Sustained party (all_night), default | clean repeat cadence — safe |
| Suppression during a program hold (burn night) | `_98` arm-latch holds; 27 sessions post-hold — safe |
| Festival day 0 / 6 / 7 boundaries + out-of-window | exact day-gating; out-of-window refuses loud — safe |
| Overlapping `durationMin` windows | rejected at load — safe |
| Two same-time cues (program+ambient) | plan-order wins, loser SUPPRESSED — safe |
| Two same-time PROGRAMS (holds) | **L3** — earlier hold silently discarded |
| DST fall-back (repeated 01:30) | de-duped, one fire — safe |
| DST spring-forward (skipped 02:30) | **L4** — fires an hour late (off-playa) |
| Polar / no sunset (lat 78 summer) | sun cues null, defaultCue fills — safe |
| Missing autopilot / look playlist | fail loud (bootError+cueErrors), non-fatal — safe |
| Zero-cue plan | defaultCue drives — safe |
| `hold.until` past anchor | **L2** — ~zero hold, logged revert |
| `mood` cue `from === to` | **L1** — silent dead cue |
| Bad CLI / empty span / bad date | all fail loud — safe |

---

## 4. Hardening recommendations (priority order)

1. **H1 (do first):** give the party mood cue an idempotency guard — while
   `_deckWindowCueId === cue.id` and the window is live, treat a re-fire as a
   no-op (don't re-dispatch the look). Add a regression test driving an
   oscillating mood (dip below `offConfirmMs`, return) inside a live
   `durationMin` window and asserting a SINGLE deck load. Belt-and-braces: make
   `timelineLoadPlaylistOnDeck` skip the reload when the same playlist+entry is
   already live.
2. **M1:** on a re-fire of the cue that owns the live window, do NOT re-stamp
   `_deckWindowUntilMs` — anchor `durationMin` (and therefore the cooldown) at
   the FIRST fire so the operator's configured cadence is honoured.
3. **L1:** reject `mood.from === mood.to` in `validateTrigger` (a dead cue is an
   authoring error, not a valid plan).
4. **L3:** extend `validateNoOverlap` (or a lint finding) to reject two
   clock/sun cues resolving to the same instant, `durationMin` or not.
5. **L2:** lint/warn when a program's resolved `holdUntilMs <= fireMs`.
6. **L5:** tighten the dry-run harness session-end counter to the specific
   reason set.

---

## 5. Hygiene

- Report-only: no source edits, no tracked-suite edits, no git operations. No
  engine was spawned (the dry-run harness runs offline, writing only to
  `~/tmp/timeline_dryrun/`), so **`marsin_engine/config.yaml` is CLEAN vs HEAD**
  (verified absent from `git status` before and after), and no
  `:6967`/`:6969-:6972` stack, no device, no sACN toward hardware was touched.
  The modified `lib/timeline/*.js` in the working tree are OTHER agents'
  concurrent uncommitted work, not this pass.
- All repros in `~/tmp/redteam_timeline/` (`flip.json`, `flap.json`,
  `dst_spring.yaml`, `dst_fall.yaml`, `polar.yaml`, `identical.yaml`,
  `two_prog.yaml`, `zero_cues.yaml`, `overlap.yaml`, `missing_pl.yaml`,
  `hold_past.yaml`, `degen_mood.yaml`, `FINDING_refire_storm.txt`).
- No IPs, hostnames, MACs, credentials, or schedule/deadline planning. The
  festival dates in examples are the plan's own scene data. Line numbers are
  anchors against the working tree at audit time.
