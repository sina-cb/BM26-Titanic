# 20260725_21 — Party × Timeline defect FIX PLAN (for the Opus fix agent)

**Author:** Review/plan agent (Fable, read-only) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-28
**Input:** `20260725_20` (adversarial validation, defects D1–D11) · `20260725_19` (what was built)
**Semantics:** operator-decided, authoritative, supersedes any prior "once per episode" behavior:

- `durationEnabled:false` (follow-the-music): trigger → party while music plays → ends ≈`offConfirmMs`
  after music stops. **WORKS TODAY — do not disturb.**
- `durationEnabled:true`: session runs `durationMin` → **cooldown starts AT SESSION END** → trigger
  **re-arms** → fires a new session if the party condition is (still) sustained. Continuous music =
  `session → cooldown breather → session → …` all night.
- Engine restart must never kill party for the night: on boot the latch re-initializes so no
  calm→party edge is needed if the condition is live post-boot (cooldown stamps still honoured).
- Dwell across re-arm (operator, least-surprising): if the mood has remained party **continuously**,
  dwell is already satisfied → fire immediately at cooldown expiry. (Flagged in §9 for visibility.)

**Design keystone:** `triggers.js` is NOT touched. Its fire-time bookkeeping (`moodArmed=false`,
`moodLastFire=fire`) is load-bearing — it is what prevents a re-fire *during* a session. All new
semantics live in `timeline_service.js` as **session-END bookkeeping**: one new helper, called from
every path a party session can end on. That fixes D1+D3 together and makes D2 a two-line boot rule.

---

## 0. The one new helper (D1 + D3 core)

**File:** `marsin_engine/lib/timeline/timeline_service.js` — add near `_endPartySessionNow`
(≈ line 1276), in the PARTY OVERRIDE section:

```js
/**
 * PARTY SESSION END bookkeeping (operator semantics 2026-07-28):
 *   • the cooldown clock starts AT SESSION END, not at the fire (D3) — re-stamp
 *     moodLastFire with the end instant (overwrites the evaluator's fire-time stamp);
 *   • the trigger RE-ARMS at session end (D1) — with continuous music the next
 *     session fires the moment the cooldown expires (dwell is already satisfied:
 *     moodSince is untouched, so a continuously-party mood carries its sustain).
 * moodArmed/moodLastFire live in this.state → persisted on the next state save,
 * so a restart mid-cooldown keeps both the stamp and the armed latch.
 */
_notePartySessionEnd(endMs, reason) {
  const cue = this._partyCue();
  if (!cue) return;
  if (!this.state.moodLastFire) this.state.moodLastFire = {};
  if (!this.state.moodArmed) this.state.moodArmed = {};
  this.state.moodLastFire[cue.id] = endMs;   // D3: cooldown anchored at END
  this.state.moodArmed[cue.id] = true;        // D1: re-arm for the next session
  this._partySessionFollowsMusic = false;
}
```

Note: `evaluateTick` `structuredClone`s `this.state` each tick, so writes made between ticks (all
call sites below are between/after evaluate) flow into the next evaluation. Do not call this from
inside anything that runs before `evaluateTick` consumes the state in the same tick unless that is
the intent (all sites below are post-evaluate reconcile paths, `setPartyConfig`, or `_catchUp`).

## 1. D1 — re-arm on session end (BLOCKER)

Call `_notePartySessionEnd` from every end path:

1. **Fixed window elapsed** — `timeline_service.js` `_reconcileDefaultCue`, the
   `if (hasElapsedWindow)` branch (≈ lines 864–868). `_applyDefaultCue` nulls the latches, so
   capture first:

   ```js
   if (hasElapsedWindow) {
     const elapsedOwner = this.plan.cues.find((c) => c.id === this._deckWindowCueId);
     if (this._isPartyCue(elapsedOwner)) {
       this._notePartySessionEnd(this._deckWindowUntilMs, 'window-elapsed');
       this._recordLifecycle(`Party session ended (window elapsed)`, 'party-window-elapsed',
         { cueId: elapsedOwner.id, source: 'auto' });
     }
     await this._applyDefaultCue('window-elapsed');
     return;
   }
   ```

   `endMs` = the scheduled window end (`_deckWindowUntilMs`), which is ≤ `now` by at most one tick —
   the honest end instant.

2. **Follow-the-music release** — `_reconcilePartyFollowMusic` (≈ line 1082, next to the latch
   clears): `this._notePartySessionEnd(now, 'follow-music-release');`. Functionally near-no-op
   (effective cooldown is 0 in this mode and calm re-arms anyway) but keeps ONE definition of
   "session ended". Side effect flagged in §9.3.

3. **Operator disable mid-session** — `_endPartySessionNow` (≈ line 1290, where the latches drop):
   `this._notePartySessionEnd(this.nowFn(), 'party-disabled');`. Disabling while ARMED (no live
   session) still early-returns before this — the existing "disable never consumes the trigger"
   test stays true.

4. **Ownership handover** (a scheduled look cue takes the deck mid-session, `_20` P7.1) —
   `_noteDeckWindow` (≈ line 745), before reassigning the latch:

   ```js
   const prevOwner = this.plan.cues.find((c) => c.id === this._deckWindowCueId);
   if (this._isPartyCue(prevOwner) && cueId !== this._deckWindowCueId) {
     this._notePartySessionEnd(now, 'superseded');
   }
   this._defaultCueActive = false;
   this._deckWindowCueId = cueId;
   ```

   Guarded on `cueId !== prev` so a party cue re-firing over its own session is untouched.
   Consequence flagged in §9.5.

5. **Dormancy** (`_goDormant`, ≈ line 1432, cheap insurance for the festival-window edge): if the
   cleared `_deckWindowCueId` was the party cue, `_notePartySessionEnd(now, 'dormant')` before
   nulling.

6. **`_catchUp` end paths** — see §4.

**No change to `triggers.js`.** After a session ends: `moodArmed=true` (persisted), mood still 1 →
the arm branch is skipped, the fire branch sees `armed`, `dwellOk` (moodSince is the hours-old
calm→party edge), and `cooldownOk` measured from the END stamp → fires at cooldown expiry. Exactly
the decided semantics.

## 2. D3 — cooldown anchored at session end (HIGH)

The end-stamp in §0 IS the fix. Two display coherence edits in `getPartyStatus`
(`timeline_service.js` ≈ lines 1224–1231):

- While `inSession`, report `cooldownRemainingSec: 0` (the cooldown has not started yet — today it
  counts down from the fire stamp *inside* the session, the misleading readout `_20` D3 pinned).
  Simplest: compute the block only `if (!inSession)`.
- After the end, the stamp is the end instant, so `effectiveState: 'cooldown'` becomes reachable
  with the shipped 12 min / 120 s for the first time and counts `cooldownSec → 0` from session end.

Interaction with D1: the cooldown is now the ONLY thing gating the re-fire, which is what the
operator's `cooldownSec` control was always supposed to govern.

## 3. D2 — restart re-arm (BLOCKER)

**File:** `timeline_service.js` `start()` (≈ line 300), between `_loadSceneFiles()` and the
`_catchUp()` try:

```js
// BOOT RE-ARM (operator semantics 2026-07-28): moodArmed:false is only ever
// meaningful DURING a live session, and sessions do not survive a restart
// (deck windows are runtime-only). A persisted false is therefore always a
// session that died with the process — re-arm so a restart never kills party
// for the night. The cooldown stamp (moodLastFire) is separate, persisted, and
// still honoured: no free session.
const bootPartyCue = this._partyCue();
if (bootPartyCue && this.state.moodArmed
    && this.state.moodArmed[bootPartyCue.id] === false) {
  this.state.moodArmed[bootPartyCue.id] = true;
}
```

**Why in `start()` and NOT in `_catchUp()`:** `_catchUp` is also called from `savePlan`, `resume()`
and `_releaseOperatorLease` — a blanket re-arm there would allow a re-fire *during* a live session
(the mid-session latch is `false` on purpose). `start()` runs exactly once per process.

Dwell after boot: `moodSince`/`prevMood` are persisted; if the mood is still 1 at boot, no edge is
detected, `moodSince` keeps its old value → dwell already satisfied (matches the boot semantics: no
fresh edge required). If the companion has not yet republished at boot, the staleness guard forces
calm → the cue re-arms via the normal calm branch and a fresh edge/dwell applies. Both fine.
Cooldown after a mid-session crash is measured from the FIRE stamp (the end-stamp never ran) — with
the shipped numbers it has usually already elapsed, so party resumes promptly post-boot. Flag §9.4.

## 4. D4 / D5 / D7 / D8 — `_catchUp` resume re-apply, party-aware

All in `timeline_service.js` `_catchUp()` (lines 1557–1691) + one guard in
`_establishBaselineIfActive` (lines 1545–1548). Callers that funnel here: `savePlan` (2162),
`resume()` (2226), `_releaseOperatorLease` (2305), `start()`/`activatePlan` (prior latches null →
new code is inert on boot/activate).

**4.a Capture the full prior session (top of `_catchUp`, line 1566):**

```js
const priorDeckWindowCueId = this._deckWindowCueId;
const priorDeckWindowUntilMs = this._deckWindowUntilMs;
const priorPartyFollowsMusic = this._partySessionFollowsMusic === true;
```

**4.b D7 — kill the ambient flash.** `_establishBaselineIfActive` (line 1545) applies the
`defaultCue` whenever there is no live *timed* window — a follow-the-music session (`untilMs`
null, cueId set) fails that guard, gets ambient written over it, then the re-apply block writes
party back: the `_20` P3.4 flash. Extend the guard to respect a live open-ended owner, the same F1
rule `_reconcileDefaultCue` already honours (line 832):

```js
if (this.plan && this.plan.defaultCue
    && this._deckWindowCueId === null                 // ← live owner (incl. open-ended) blocks the fill
    && !(typeof this._deckWindowUntilMs === 'number' && this._deckWindowUntilMs > now)) {
  await this._applyDefaultCue(reason);
}
```

On boot the latches are null (fresh runtime) → behavior unchanged. On lease-release/savePlan with a
live session the fill is skipped and the block in 4.c decides. NOTE: with this guard, if 4.c decides
the session must END, 4.c itself must apply the default cue (it does, below).

**4.c Rewrite the resume re-apply block (lines 1671–1687):**

```js
if (priorDeckWindowCueId
    && priorDeckWindowCueId !== '__default_cue__'
    && !programCaughtUp
    && !(best && best.cue && best.cue.id === priorDeckWindowCueId)
    && this.state.mode !== 'overridden') {
  const owner = this.plan.cues.find((c) => c.id === priorDeckWindowCueId);

  if (!owner || owner.enabled === false || !(await this._actionDrivesDeck(owner.action))) {
    // D8: the owner is GONE from the (reloaded) plan — never leave an orphaned
    // window latched on a deleted cue (it blocks the default-cue fill until the
    // phantom window elapses). Clear and let the default cue reclaim NOW.
    if (this._deckWindowCueId === priorDeckWindowCueId) {
      this._deckWindowCueId = null;
      this._deckWindowUntilMs = null;
      this._partySessionFollowsMusic = false;
      this._defaultCueActive = false;
      if (this._isPlanDrivingDeck()) {
        try { await this._applyDefaultCue('resume-owner-gone'); }
        catch (e) { console.warn(`  ⚠ [timeline] resume: default cue failed: ${e && e.message}`); }
      }
    }
  } else if (this._isPartyCue(owner)) {
    // D4: a party session's precondition is a live SIGNAL + live POLICY, not the
    // clock. Re-apply only when both still hold AND the original window has time
    // left — and then rejoin the REMAINING window, never a fresh one.
    const windowExpired = typeof priorDeckWindowUntilMs === 'number'
      && priorDeckWindowUntilMs <= now;
    const moodPartyNow = !!(this.getMood() && this.getMood().party);
    const policyOn = this.getPartyConfig().enabled === true;
    if (!policyOn || windowExpired || !moodPartyNow) {
      // END the session (never resurrect): D4 repro A (expired window) and
      // repro B (mood calm / music stopped). Cooldown anchored at the TRUE end:
      // the scheduled window end when it expired during the takeover, else now.
      this._deckWindowCueId = null;
      this._deckWindowUntilMs = null;
      this._defaultCueActive = false;
      this._notePartySessionEnd(windowExpired ? priorDeckWindowUntilMs : now, 'not-resumed');
      this._recordLifecycle('Party session ended (not resumed: '
        + (!policyOn ? 'party disabled' : windowExpired ? 'window expired' : 'music stopped') + ')',
        'party-not-resumed', { cueId: owner.id, source: 'auto' });
      if (this._isPlanDrivingDeck()) {
        try { await this._applyDefaultCue('party-not-resumed'); }
        catch (e) { console.warn(`  ⚠ [timeline] party resume-end: default cue failed: ${e && e.message}`); }
      }
    } else {
      // REJOIN: re-apply the party look (overwrites operator edits made during a
      // takeover), then restore the ORIGINAL window + shape — _dispatchCue's
      // _noteDeckWindow/_notePartySessionStart re-anchored them to now/current
      // config (D5), so put the truth back.
      try {
        const result = await this._dispatchCue(owner.id, 'resume');
        this._deckWindowUntilMs = priorDeckWindowUntilMs;          // D5: remaining window
        this._partySessionFollowsMusic = priorPartyFollowsMusic;   // shape survives a mid-takeover toggle flip
        console.log(`  ⟳ [timeline] resume re-applied party cue "${owner.id}": ${result.steps.join('; ')}`);
      } catch (e) { /* existing error handling, unchanged */ }
    }
  } else {
    /* existing non-party re-dispatch, byte-for-byte unchanged */
  }
}
```

**Correct behavior per case (operator-decided):**

| Case | Result |
|---|---|
| Lease release, music ON, window remaining | rejoin the REMAINING window (`sessionEndsAtMs` unchanged from before the takeover) |
| Lease release, window expired during takeover | session over; cooldown counted from the scheduled window end (operator gets the elapsed cooldown credit); default cue reclaims |
| Lease release, music OFF (mood calm) | session over; cooldown from now; default cue reclaims — no more `in_session` at CALM |
| Lease release, policy disabled during takeover | already immune (`_endPartySessionNow` cleared the latch → prior null); the `!policyOn` gate is belt+braces |
| `savePlan` mid fixed session | same code path: owner exists, mood party, window live → re-dispatch + ORIGINAL window restored (D5 gone) |
| `savePlan` mid follow-music session | 4.b stops the ambient write; rejoin keeps `untilMs:null` + `followsMusic:true` (D7 gone, P3.3 stays green) |
| `savePlan` that REMOVED the party cue mid-session | owner-gone branch: latches cleared, `defaultCue` fills immediately (D8 gone — no more autopilot-baseline limbo) |

## 5. D6 — CaptainPad PARTY card sync (display-only)

**File:** `CaptainPad/app/(tabs)/timeline.tsx`, `PartyModeSection` (≈ lines 1306–1370).

1. **Subscribe to the `partyConfig` WS broadcast** (engine broadcasts on every PUT —
   `api_server.js:5686` — and replays on connect; `_20` §2.5 proved 5/5). `engineEvents.subscribe`
   returns an unsubscribe fn (`utils/engineBus.ts:208-212`). Add imports
   (`engineEvents` from `@/utils/engineEvents`, `parsePartyConfig` from `@/utils/party_api`) and:

   ```tsx
   // Cross-surface truth: the engine broadcasts `partyConfig` on every PUT and
   // replays it on connect. The payload is getPartyStatus()+availablePlaylists —
   // exactly what parsePartyConfig validates (extra keys like `type` are ignored).
   useEffect(() => engineEvents.subscribe((msg: any) => {
     if (!msg || msg.type !== 'partyConfig') return;
     try { setCfg(parsePartyConfig(msg)); setLoadError(null); }
     catch (e: any) { setLoadError(e?.message || 'partyConfig broadcast malformed'); }
   }), []);
   ```

   `parsePartyConfig` (`utils/party_api.ts:149`) already tolerates unknown extra keys and
   type-checks everything it keeps — no changes needed there. This fixes `_20` shot 7 (the
   permanent DISABLED-pill-over-ENABLED-toggle contradiction) instantly.

2. **Ungate the 5 s poll** (lines 1342–1348). The engine does NOT broadcast `partyConfig` on
   session transitions (only on PUT), so the poll is the load-bearing fix for `armed → in_session`
   (shots 2–3). Split the effect: the 1 s `nowMs` ticker stays gated on `livePhase`; the 5 s
   `load()` refresh runs unconditionally while the section is mounted (the card only exists while
   the Timeline tab is visible — that is the "visible" gate):

   ```tsx
   useEffect(() => {
     const refresh = setInterval(() => { void load(); }, 5000);
     return () => clearInterval(refresh);
   }, [load]);
   useEffect(() => {
     if (!livePhase) return;
     const tick = setInterval(() => setNowMs(Date.now()), 1000);
     return () => clearInterval(tick);
   }, [livePhase]);
   ```

Keep the existing `busEnabled` mirror (1363–1369) — it still covers pre-broadcast engines. No
engine-side change; strictly display.

## 6. D10 — empty PUT body → 400

`readBody` (`api_server.js:4560-4583`) maps an empty body to `{}` (`JSON.parse(body || '{}')`), so
the route cannot tell them apart — and a literal `{}` is equally meaningless under the documented
all-or-nothing contract. Fix at the validator so both get the same 400:
**`timeline_service.js` `setPartyConfig`** (after the object check, ≈ line 1117):

```js
if (Object.keys(patch).length === 0) {
  throw new Error('party config: at least one writable field is required '
    + '(enabled, playlist, minDwellSec, durationMin, cooldownSec, durationEnabled, cooldownEnabled)');
}
```

Check `tests/timeline/party_config.test.js` for any test that PUTs `{}` expecting 200 and update it
to expect 400 (contract change is deliberate).

## 7. D11 — corrupt persisted party field: fail loud ONCE, at boot

**File:** `timeline_state.js` `loadTimelineState` (lines 200–217). After the parse succeeds, run
the party validation ONCE and throw with the file path — the exact precedent this function already
sets for a broken YAML ("a present-but-broken file THROWS", codex P0):

```js
if (parsed === null || parsed === undefined) return defaultTimelineState();
try {
  partyConfigOf(parsed);
} catch (err) {
  throw new Error(`timeline state invalid (${filePath}): ${err.message}`);
}
return parsed;
```

Effect: a hand-edited `partyEnabled: "no"` now fails at `start()` → `_loadSceneFiles()` exactly
like a corrupt YAML does today — one loud error at boot, no half-running timeline, no 86 k-line/day
tick spam. Runtime cannot re-corrupt it (`setPartyConfig` validates every write; the file is not
re-read while running). The per-tick `getPartyConfig()` calls (1784–1790) then can never throw on
persisted data — no throttling machinery needed. Fixer: verify what `engine.js` does when
`timelineService.start()` rejects and confirm the error names the file and field once (it should be
the same path a corrupt-YAML state file takes today — if that path is also swallowed, fix BOTH the
same way, loudly).

## 8. Explicitly NOT touched

- `triggers.js` — evaluator stays pure and byte-identical.
- Follow-the-music trigger/hold/release semantics (works; pinned by P3.3/P6.4/`_20` §2.6).
- The seed-once rule, validation bounds, WS topic routing, precedence/arbiter, staleness guard.
- D9 (raw recall route) — pre-existing engine-wide, out of scope per the operator brief; note that
  the D4 fix removes its worst interaction (`_20` §3 caveat: lease expiry no longer re-applies
  party over a recalled look when the mood/window says no).

## 9. Edge cases (decided / flagged)

1. **Mid-cooldown restart** — `moodLastFire` (end stamp) + `moodArmed:true` both persisted; the
   §3 boot re-arm is a no-op; cooldown remainder honoured; no free session (P4.x stays green).
2. **Disable during cooldown → re-enable** — `_endPartySessionNow` early-returns (no live
   session), stamps untouched → remaining cooldown continues monotonically (P5.3 stays green).
3. **`cooldownSec: 0` or `cooldownEnabled:false` with duration ON** — back-to-back sessions:
   window elapses → default cue applies that tick → re-fire on the next evaluate (~1–2 s ambient
   blip between sessions, and each re-fire reloads the playlist). Legal per the decided semantics.
   **FLAG to operator:** if they want gapless continuous party, follow-the-music
   (`durationEnabled:false`) is the intended tool.
4. **Restart mid-session** — session still dies with the process (unchanged, `_19` §4 flag 1);
   boot re-arms; cooldown is measured from the FIRE stamp (the end never ran), which with 12/120
   defaults has usually elapsed → party re-fires within a tick of the first in-window evaluation if
   music is on. **FLAG:** deliberate — "restart must never kill party" outranks a strict breather.
5. **Handover re-arm (P7.1/P7.2)** — a scheduled look cue that takes the deck mid-session now ends
   the session properly (stamp + re-arm); with continuous music, party may legitimately re-fire
   after the cooldown and take the deck back from the scheduled look. P7.2's 30-tick no-flap probe
   still passes with the 120 s default (re-fire can't land inside 30 s) — but re-run it, and
   **FLAG** the new steady-state (`scheduled look → cooldown → party again`) for operator
   visibility.
6. **Dwell across re-arm** — `moodSince` is never touched by session end, so continuous party mood
   ⇒ immediate fire at cooldown expiry (operator-decided). A mood that dipped to calm during the
   session/cooldown re-arms via the normal branch and needs a fresh 120 s dwell after the next
   edge — unchanged, correct.
7. **`durationEnabled` flipped during a takeover** — the rejoin restores
   `priorPartyFollowsMusic`, so the session keeps the shape it started with (extends the existing
   P5.4/P5.5 rule to the resume path).
8. **`savePlan` while the mood happens to be calm mid-FIXED-session** — the uniform mood check in
   §4.c ends the session, whereas an undisturbed fixed session rides out a drop (P5.5). Uniform
   "re-apply requires a live precondition" is the least-surprising rule at a resume boundary, but it
   is a behavior delta — **FLAG for operator visibility.**
9. **`_goDormant` mid-session** (festival window closing) — end bookkeeping runs (§1.5); next
   in-window day starts armed instead of latched-dead.
10. **Non-party cues on the resume path** — untouched (their precondition is the clock; the
    existing re-anchor-to-now behavior stands). The same original-window restore could later be
    generalized (`_catchUp` line 1638 does it for caught-up clock cues) — file as a Backlog card,
    do not do it in this pass.

## 10. Tests to re-run / add

**`_20` probe suites** (in `~/tmp/party_timeline_validation/probes/`, harness intact):

```bash
cd ~/tmp/party_timeline_validation/probes
node --test p1_rearm.test.mjs p2_recall_takeover.test.mjs p3_saveplan.test.mjs \
            p4_restart.test.mjs p5_flap.test.mjs p7_precedence.test.mjs p12_cooldown.test.mjs
node p8_http.mjs && node p8b_proto.mjs && node p10_ws.mjs        # engine up
node p9_fullchain.mjs                                             # full chain
node p11b_captainpad.cjs                                          # fresh expo export on :7167 ONLY
```

Target: the 10 documented failures go green. Expectation updates the fixer must make in the probes
(semantics changed on purpose): P5.2 asserts "cooldown stamp never re-stamped" — now re-stamped
once at session END (assert exactly one END stamp instead); p4's corrupt-state case now throws at
construction/boot instead of ticking (assert the loud one-time refusal); p12 asserts
`cooldownRemainingSec === cooldownSec` at session END and `0` while in session.

**Engine:** `node --test tests/timeline/` (party_config, party_session_timeline, timeline_service,
timeline_arbiter, timeline_mood_autofire, deck-release/default-cue files) then full `npm test` —
delta must be exactly the 7 known environmental failures. **New engine tests to add** (in the two
party test files): (a) continuous mood 1 → session → cooldown → second session fires at expiry;
(b) cooldown anchored at end (+ 0 while in session, `effectiveState:'cooldown'` reachable);
(c) boot re-arm with persisted `moodArmed:false` + cooldown stamp still honoured; (d) the four
`_catchUp` cases in §4.c's table; (e) savePlan mid-session preserves `sessionEndsAtMs`; (f) owner
deleted mid-session → defaultCue fills; (g) `PUT {}` → 400; (h) corrupt `partyEnabled` → loud
boot throw naming the file.

**CaptainPad:** `npx tsc --noEmit` clean; `npx vitest run` (867+ pass, no regressions); add a test
that a `partyConfig` bus message updates the card state (parse path) if the harness allows.

## 11. Validation criteria (per defect)

- **D1:** `_20` P1.3 exact repro → a second session fires after cooldown; `effectiveState` never
  reads `armed` while a fire is impossible.
- **D3:** shipped 12/120 → at session end `cooldownRemainingSec = 120`, state `cooldown`, `armed`
  at +120 s; during the session it reads 0.
- **D2:** P4.5 repro → restart mid-session with music on → new session within
  max(cooldown remainder from fire, one tick) — never latched dead.
- **D4:** P2.4 → rejoin ends at the ORIGINAL `sessionEndsAtMs`; P2.5 → no `in_session` at CALM,
  default cue on deck.
- **D5/D7/D8:** P3.2 window unchanged across save; P3.4 no ambient write in the save op; P3.7 deck
  on `defaultCue` (not baseline) immediately after the cue-removing save.
- **D6:** p11b live sequence — card shows IN SESSION within ≤5 s of the engine transition with no
  reload; shot-7 sequence shows pill+toggle agreeing within ~1 s (WS) of a PUT from another surface.
- **D10:** empty-body PUT → 400 naming the requirement; p8 suite otherwise 40/40.
- **D11:** corrupt field → engine/timeline refuses to start with ONE error naming file+field; zero
  per-tick spam; a valid file boots identically to today.

Full-stack proof per `.agent/skills/full_stack_smoke.md` + the `_19` §5 fake-trigger recipe
(FORCE PARTY, short numbers) to watch `session → cooldown → session` live before claiming done.
Engine `states/` residue: report, never commit/revert (standing rule).
