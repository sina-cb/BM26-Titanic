# 356 — Party in the LIVE tab: bulletproofing plan (engine + CaptainPad)

Author: Fable planner (read-only session; saved verbatim by the coordinator).
Implementers: Opus (engine, CaptainPad); verifier: Sonnet. Operator review follows.

Scope: Timeline LIVE tab, PARTY card, chips, NOW card, cues/ownership. Branch
`feat/bm_readiness` at 800806da. Operator plan under test: local
`simulation/scenes/titanic/timeline/test_week.yaml` (untracked; party window
phase `21:00→09:00`, cue `days:[0]`, pwe `days:[1]`, dwell 15 s, session 15 min,
cooldown 60 s). `test.yaml` is foreign-owned: do not touch.

## 1. Findings (root causes, with evidence)

**F1 — Party never fires when the plan goes live with music already playing (P0).**
`marsin_engine/lib/timeline/triggers.js:316-321`: a mood cue arms only when the
mood is observed at `from` (calm); `if (next.moodArmed[cue.id] !== true) continue;`.
On activation with `audioPartyStrong` already 1, `moodArmed` is `undefined` →
never fires until a calm gap. Live log proves it: nothing fired at activation;
after FORCE→RETURN (`_notePartySessionEnd` re-armed) + cooldown reset, `Party 1`
fired by `mood` 2 s later. `getPartyStatus()` (timeline_service.js:1913) reports
`triggerArmed = !(moodArmed === false)` → `undefined` shows as ✓ARMED while the
evaluator will not fire — the chip lied.

**F2 — Two definitions of "Party Window open" (P0).**
(a) Status: `_partyWindowOpenAt` (timeline_service.js:1808-1822) = phase
clock-active AND `cueAppliesOn(cue, plan, nightStartMs)` where a wrapping phase's
start is shifted back one day. Correct by authoring intent (pwe is authored on
day N+1; pinned by `tests/timeline/party_config.test.js:362`). At 02:xx on
festival day 0 the open phase belongs to night −1 → `partyWindowOpen:false` →
"WINDOW CLOSED".
(b) Evaluator: `_runtimeCuesAt` (1824-1833) builds `dayPlan.cues` from
`applicableCues(plan, now)` (calendar day: today = day 0, so `days:[0]` matches)
and `evaluateTick` gates the mood cue with clock-only `phaseOk`
(triggers.js:337-339); the phase cue `pwb` fires on the clock-only rising edge
(triggers.js:299-306). Result: `pwb` fired 2 s after activation and `Party 1`
fired by mood while `/party-config` said `waiting_window`. `currentPhase` on
`/timeline/state` is clock-only too (`activePhase`, triggers.js:157) and must
not be read as "window open".

**F3 — Default cue clobbers the phase baseline on activate and resume (P0).**
`_activatePlan` (3805-3839) resets latches then `await _catchUp()`; the 1 s tick
is not blocked by a plan mutation (`_ticking` only guards tick-vs-tick, 2716).
Log: `pwb` fired by the tick mid-catchUp, then `_establishBaselineIfActive('boot')`
→ `_applyDefaultCue` (1045-1082) nulled `_deckWindowCueId` 1 s later. `pwb` is
rising-edge and `state.currentPhase` is persisted, so it never re-fires for the
night. Same race class: RETURN produced two default-cue applies in 2 s
(`party-force-cancelled` from the HTTP handler, `no-owning-cue` from the
concurrent tick's `_reconcileDefaultCue`). Resume passes the literal reason
`'boot'` (2609), so the log shows "boot" for a resume.

**F4 — Overview segments and NOW card ignore phase-baseline cues (P0 for UI truth).**
`resolveDeckStateAt` (resolve_deck_state.js:150-159) only restores clock/sun
cues, so `buildDaySegments` renders `Default (from deck) 00:00→24:00` even while
`pwb` owns the deck, and `resolveTimelineNowOwner`
(CaptainPad/utils/timeline_operator_model.ts:105-157) prefers the resolved
segment over runtime `state.activeCue`. The NOW card therefore shows the
ribbon's guess ("RESOLVED PLAN OWNER"), not the engine's owner. Same root cause
makes an engine restart mid-window land on the default cue (no phase cue
restored, no re-fire).

**F5 — RETURN TO LIVE AUDIO "does nothing" (P0).**
`returnPartyToLiveAudio` (1775-1789) only ends the session when
`_partySessionForced` is true. A second RETURN hit a *detected* session → "Live
audio already controlled Party detection", party kept playing.
`_partySessionForced` is also silently dropped by `_notePartySessionStart` (1601)
when `_catchUp` re-dispatches the party cue on a save/resume rejoin (2686), and
is not reset in `_activatePlan`/`_goDormant`. Pad: `returnToAudio`
(timeline_party_card.tsx:226-246) calls the companion
`setPartyTestOverride('auto')` BEFORE the engine; a companion failure aborts the
engine call. Both buttons render enabled regardless of state (322-356).

**F6 — ARMED flips without input change (P0 by operator ruling).**
`triggerArmed` is `false` for the whole life of any session (force sets it at
1766; a mood fire at triggers.js:346) and only re-arms at session end. So ✗ARMED
appeared the moment FORCE/detection started a session and stayed ✗ for the whole
detected session — while WINDOW stayed ✗ (status precedence puts `in_session`
first, but the chip row has no "session live" state). Not a timer or pad race:
it is an engine state the row cannot express. A dispatch that throws also leaves
`moodArmed:false` with no session and no visible error on the card.

**F7 — Banner vs NOW card wording.** `timelineLiveStatus`
(timeline_operator_model.ts:363-366) says "Timeline autopilot controls the deck
now"; the NOW card says "DEFAULT (FROM DECK) · RESOLVED PLAN OWNER". Both true,
neither names the same thing. "autopilot" is an engine term.

**F8 — Chip semantics:** `readiness.planActive` and `readiness.planDriving` are
the same boolean (1861, 1921, 1945-1947), and `readiness.enabled` is labelled
DETECTOR but is the party policy toggle.

## 2. Single source of truth decisions

- **Window open/closed:** ONE pure function
  `partyWindowAt({plan, cue, now, sunEvents, dayTimes})` in a new
  `marsin_engine/lib/timeline/party_window.js` →
  `{ phaseId, open, startMs, endMs, nightStartMs, opensAtMs, closesAtMs }`
  (night-start-day semantics, i.e. today's `_partyWindowOpenAt` rule). Used by
  `_partyWindowOpenAt`, `_runtimeCuesAt`, `getPartyStatus`,
  `getState().partyWindow`, and the resolver. The pad reads
  `readiness.partyWindowOpen` / `state.partyWindow.open` only — never
  `currentPhase`, `phases`, `atLocal`, or segments.
- **Current owner/baseline:** engine runtime
  `getState().deckOwner = { kind:'program'|'cue'|'defaultCue'|'baseline', cueId, label, untilMs }`
  derived from `activeProgram` / `_deckWindowCueId` / `_defaultCueActive`. NOW
  card and banner render this; the ribbon segment supplies only the time range
  when its owner matches.
- **Next cue:** `state.nextCue` (engine) for the countdown; the NEXT list stays
  overview-driven but must not list a cue the engine reports as the current owner.
- **Party session states:** `/party-config` (`effectiveState`, `sessionForced`,
  `readiness`, `cooldownRemainingSec`, `sessionEndsAtMs`, new
  `partyWindowOpensAtMs`/`partyWindowClosesAtMs`, `cueError`). Pad-local
  booleans are never used for enablement.

## 3. Implementation slices (ordered)

### P0-1 Engine: party fires when music is already playing; one window predicate
Files: `marsin_engine/lib/timeline/triggers.js`, `timeline_service.js`, new
`lib/timeline/party_window.js`.
- triggers.js:321 → `if (next.moodArmed[cue.id] === false) continue;`
  (undefined ⇒ armed). Doc the operator semantic: the trigger is "mood held at
  `to` for minDwell while armed"; armed is false only during a live session.
- Service: `_partyWindowOpenAt` delegates to `partyWindowAt`. `_runtimeCuesAt`:
  the party cue AND every `trigger.type==='phase'` cue whose
  `phase === partyCue.trigger.whenPhase` are included iff `open` and EXCLUDED
  otherwise (remove the calendar-day inclusion for these two only). Keep all
  other cues on `applicableCues`.
- Dwell re-anchor on entry: runtime `_partyWindowWasOpen`; each tick compute
  `open`; on false→true edge, and at the end of `_catchUp`, if mood is party and
  no party session owns the deck → `state.moodSince = now` + one lifecycle line
  `party-window-opened` ("music already playing — sustain restarts"). Bound
  dwell: fire at entry + minDwell, never instantly.
- Self-heal: after the dispatch loop, if `moodArmed[cue.id] === false` and the
  party cue owns nothing (`_deckWindowCueId !== cue.id`, no program) and
  `cueErrors[cue.id]` is unset → set true + lifecycle `party-rearm`. With an
  error present leave it false and surface it (P0-2).

Tests (node --test): `tests/timeline/timeline_triggers.test.js` (undefined ⇒
armed fires after dwell; false blocks; session end re-arms; update the pinned
"never observed from" case deliberately). New `tests/timeline/party_window.test.js`
(before start same day → closed + opensAt today; inside pre-midnight → open;
post-midnight with `days:[N]` → open; post-midnight with `days:[N+1]` only →
closed; `days:'all'`; non-wrapping phase; no `whenPhase` → `cueAppliesOn`).
`party_session_timeline.test.js`: "plan activated mid-window with mood already
party → fires at minDwell, not before"; "window closed by night-day → evaluator
fires nothing and `pwb` does not fire even though the phase clock is active";
"window-open edge re-anchors dwell"; "moodArmed false with no owner self-heals".
Dry-run: `node tools/timeline_dryrun.mjs --scene titanic --plan test_week --date <an in-window day> --mood <script that starts loud>`
(pick via `--list-moods`; run from `marsin_engine/`).

Live verify (read-only): `GET /party-config` `.partyWindowOpen` equals
`GET /timeline/state` `.partyWindow.open`; with music inside the window
`recentFires` shows `fire c_… reason mood` within minDwell+2 s.

Operator note: with `days:[0]` the window opens at 21:00 on festival day 0; for
an immediate early-morning test set the Party Window DAYS to "All days" in EDIT
PLAN (or test after 21:00).

### P0-2 Engine: FORCE / RETURN semantics and state
Files: `timeline_service.js`, `api_server.js` (no route changes),
`http_ownership.js`.
- `returnPartyToLiveAudio` ends ANY live party session (forced or detected) via
  `_endPartySessionNow('party-live-audio')`; `sessionForced` decides the
  lifecycle label. Cooldown applies (D3). Throw `409` only when no session is
  live (the pad disables the button then).
- `_partySessionForced` survives the rejoin: capture `priorPartyForced` in
  `_catchUp` (next to `priorPartyFollowsMusic`) and restore after the `resume`
  re-dispatch. Reset it (and `_partySignalLostAtMs`) in `_activatePlan` and
  `_goDormant`. Runtime-only by design: an engine restart ends the session (boot
  re-arm at 404-417 already covers the latch).
- Forced session end paths (document in the method comment): manual RETURN;
  `durationMin` elapse (`_reconcileDefaultCue`); superseded by another deck cue
  incl. `pwe` at window end (`_noteDeckWindow` 983); party DISABLED; plan
  activate/dormant; engine restart. A forced follow-the-music session
  (`durationEnabled:false`) ends only by those, never by signal.
- Add `POST /party/force`, `/party/live-audio`, `/party/cooldown/reset` to
  `TIMELINE_AUTHORITY_MUTATIONS` (they dispatch to the deck).
- `getPartyStatus()` adds `cueError: cueErrors[cue.id] || null`,
  `partyWindowOpensAtMs`, `partyWindowClosesAtMs`.

Tests: extend `party_session_timeline.test.js:479` — force → `savePlan`
(rejoin) → `sessionForced` still true → return cancels; return on a detected
session ends it and stamps cooldown; return with no session → throws;
`activatePlan` clears the forced flag; `http_ownership.test.js` lists the three
POSTs.

### P0-3 Engine: serialize the tick with plan mutations and party HTTP mutations
File: `timeline_service.js`.
- `_tick()` returns early while `_mutationInFlight` is true;
  `_serializePlanMutation`, `forcePartySession`, `returnPartyToLiveAudio`,
  `resetPartyCooldown`, `setPartyConfig`, `resume`, `_releaseOperatorLease`
  set/clear it (try/finally). Await a running tick before starting (`_ticking`
  promise).
- `_catchUp(reason)` passes its reason to `_establishBaselineIfActive`
  (`'activate'|'save'|'resume'|'lease-release'|'boot'`).

Tests: `timeline_service.test.js` — deferred `loadPlaylist` dep; call `_tick()`
during `activatePlan` → exactly one `pwb` fire, no default-cue fire while `pwb`
owns; `returnPartyToLiveAudio` during a tick → one default apply (`recentFires`
has no `no-owning-cue` right after `party-live-audio`). Live verify: after
FORCE→RETURN `recentFires` shows one `Default (from deck)`.

### P0-4 Engine wire + CaptainPad: truthful LIVE tab
Files: `timeline_service.js` (`getState`), `CaptainPad/utils/timelineApi.ts`,
`utils/timeline_operator_model.ts`, `components/timeline/timeline_live_view.tsx`,
`timeline_party_card.tsx`, `utils/party_api.ts`.
- `getState()` adds `deckOwner` (§2) and
  `partyWindow: { open, phaseId, opensAtMs, closesAtMs }`; `timelineApi.ts`
  parses both strictly (loud on wrong type, optional for older engines).
- `resolveTimelineNowOwner`: order = program → manual → `state.deckOwner`
  (source `'runtime-owner'`, label "ENGINE OWNER") → segment → baseline. Segment
  only supplies `fromLocal/toLocal` when `segment.owner.cueId === deckOwner.cueId`
  (or both defaultCue); otherwise range = "until {nextCue.label} {HH:MM}".
- `timelineLiveStatus` final sentence: `"… inside its schedule window; the
  Timeline is driving the deck — now: {deckOwner.label}."` Drop "autopilot" from
  operator copy.
- Party card buttons (pure helper `partyButtonRules(config)` in `party_api.ts`,
  unit-tested):
  - FORCE PARTY enabled iff
    `connected && !locked && !pending && partyCueId && readiness.planActive && effectiveState !== 'in_session'`;
    label `PARTY FORCED` while `sessionForced`.
  - RETURN TO LIVE AUDIO enabled iff `effectiveState === 'in_session'`; label
    `RETURN TO LIVE AUDIO` when `sessionForced`, `END PARTY SESSION` otherwise.
    Engine call first; then the companion override reset as a separate step with
    its own error line (never blocks the engine call).
  - RESET COOLDOWN enabled iff `cooldownRemainingSec > 0`. ENABLED toggle iff
    `connected && config && !pending && !locked`. SETTINGS always.
- Card shows `config.cueError` as the red alert line when present; shows
  `moodStale` ("SIGNAL STALE — companion not publishing").

Tests (vitest): `utils/party_api.test.ts` (button matrix:
idle/forced/detected/cooldown/disconnected);
`utils/timeline_operator_model.test.ts` (runtime owner beats segment; range
rules; banner names the owner); `timelineApi` parse tests for the two new fields.

### P1-5 Engine: resolver restores phase-baseline cues (ribbon + restart truth)
Files: `resolve_deck_state.js`, `timeline_service.js` (`_catchUp`), tests
`timeline_resolve_deck_state.test.js`, `timeline_phase_aware_default.test.js`,
`overview_perf.test.js`.
- In `resolveDeckStateAt`, add candidates: enabled `kind:'ambient'` cues with
  `trigger.type==='phase'` whose phase is active at `atMs` and
  `cueAppliesOn(cue, plan, nightStartMs)`; `fireMs = nightStartMs`; compete with
  clock/sun by latest `fireMs`. `buildDaySegments` then shows `pwb` from
  21:00→24:00 on day N and 00:00→09:00 on day N+1; `_catchUp` restores `pwb` on
  boot/save/resume with `keepRestoredDeck`, so a restart mid-window keeps the
  baseline's autopilot/transition/globals.
- Run the full engine suite; where a test pins `defaultCue` for a stretch a
  phase cue owns, update it with a comment citing this report.

## 4. Chip and control contract (PARTY card)

| Chip | Engine field | ✓ means | ✗ means | Notes |
|---|---|---|---|---|
| PLAN | `planEnabled() && inFestivalWindow` (split from today's `readiness.planActive`) | plan on and in its festival days | off / dormant | |
| DECK | `controller ∈ {autopilot,program} && mode !== 'overridden'` | Timeline owns the deck | takeover / lease | previously identical to PLAN |
| WINDOW | `readiness.partyWindowOpen` (`partyWindowAt().open`) | window open tonight | closed; detail "opens HH:MM" from `partyWindowOpensAtMs` | shows `BYPASSED` (neutral) while `sessionForced` |
| PARTY ON (rename of DETECTOR) | `readiness.enabled` | policy enabled | operator disabled | detector health lives in the companion panel |
| SIGNAL (new) | `strongSignal`, `moodStale` | stale-guarded mood is party | calm; `STALE` red when `moodStale` | the exact input the evaluator sees |
| SESSION (rename of ARMED) | `readiness.triggerArmed` + `effectiveState` | armed, no session | `LIVE` (tertiary, not red) while `in_session`; red only with `cueError` | ARMED can only flip on session start/end or a dispatch error — never on a timer |
| COOLDOWN | `readiness.cooldownClear` / `cooldownRemainingSec` | clear | m:ss left | |

Session tiles stay as in `partyTimerReadouts`; `canSustain` uses the same
readiness fields. No chip may be computed pad-side from `currentPhase`,
segments, `atLocal`, or local flags.

## 5. Edge cases to harden (expected behaviour → slice)

- Plan activated mid-window, music already playing → session at activation +
  minDwell (P0-1).
- Window wraps midnight: open from night-start day N; `pwe` on N+1 ends it; pad
  and engine agree at 00:00–09:00 (P0-1, P1-5). Operator-day (18:00) boundary is
  display only.
- Window closed by night-day but phase clock active (today's bug) → nothing
  fires, WINDOW ✗ with "opens HH:MM" (P0-1).
- Resume after takeover/pause during a session → rejoin keeps forced flag and
  remaining window (P0-2); after a cancelled session → default cue once, reason
  `resume` (P0-3).
- Cooldown expiry with continuous music → next session at expiry (existing D1;
  covered by `party_session_repeat.test.js`).
- Mood flapping/stale → stale forces calm and ends follow-music sessions
  (existing); SIGNAL chip shows STALE (P0-4).
- Festival day 0 early morning (window belongs to day −1) → closed; document in
  the operator note (P0-1).
- Clock jumps → existing L2 clamp (triggers.js:265-269) also clamps the new
  re-anchor; add a test that `moodSince` in the future is clamped.
- Engine restart mid-party → session ends, latch re-arms at boot, `pwb` restored
  by the resolver (P1-5), cooldown honoured.
- Dispatch throws (missing playlist) → `cueError` on the card, SESSION red, no
  silent re-arm (P0-1/P0-4).

## 6. Out of scope / nice-to-have

Broadcast `partyConfig` on session start/end edges (the 1 s poll covers it);
`defaultCue.phaseAware:true` for the operator plan; DayView operator-day ribbon
carrying the night owner across midnight; companion detector
thresholds/profiles; merging `planActive`/`planDriving` on the wire (keep both
for old clients); Party Window editor defaulting DAYS to "All days" for new
windows; `.agent/ops` runbook entry for the dry-run command.
