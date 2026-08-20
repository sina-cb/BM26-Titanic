# 20260725_22 — Party × Timeline defect FIXES (D1–D11)

**Author:** Fix agent (Opus) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-28
**Executes:** `20260725_21` (fix plan) against `20260725_20` (adversarial validation)
**Semantics (operator, authoritative):** with a time limit sessions **REPEAT** — session
(`durationMin`) → cooldown stamped **at the session END** → trigger **re-arms** → next session while
the music sustains (dwell carried by `moodSince` ⇒ fires immediately at cooldown expiry under
continuous music). No time limit = follow-the-music, already correct, **not disturbed**. An engine
restart must never kill party for the night. A takeover release / `savePlan` must never resurrect or
restart a session.

## VERDICT — **all 11 defects fixed, validated, deployed. `DEPLOY OK` on titanic-ext.**

| Suite | Result |
|---|---|
| `_20` in-process probe suite | **49 / 49 pass** (was 38/48) — 6 documented expectation updates, see §3 |
| p8 hostile HTTP | **32 / 32** · p8b proto-injection **8 / 8, no pollution** · p10 WS **5 / 5** |
| p9 full chain (live) | both modes clean; `armed → in_session → cooldown 25 s → in_session` twice |
| p11b CaptainPad (live, `:7167`) | card tracks every transition with **no reload**; pill/toggle agree |
| Engine `npm test` | **2278 / 2271 / 7 fail** — exactly the known environmental 7, **zero new** |
| CaptainPad | `npx tsc --noEmit` clean · `npx vitest run` **869 pass / 6 skipped / 0 fail** (867 + 2) |
| `marsin_engine/states/` | tracked files **byte-identical** to session start (see §6) |

---

## 1. Per-defect changes

`triggers.js` is **NOT touched** (byte-identical): its fire-time bookkeeping is what prevents a
re-fire *during* a session. All new semantics are session-END bookkeeping in `timeline_service.js`.

### D1 + D3 — the one new helper, called from every end path

`marsin_engine/lib/timeline/timeline_service.js`

- **`_notePartySessionEnd(endMs, reason)` — new, :1324-1360.** Re-stamps
  `state.moodLastFire[cueId] = endMs` (D3: the cooldown clock starts at the END, not the fire) and
  sets `state.moodArmed[cueId] = true` (D1: re-arm), and clears `_partySessionFollowsMusic`. Both
  live in `this.state`, so they persist.
- Called from **every** path a party session can end on:
  - `_reconcileDefaultCue` window-elapsed branch, :891-903 — `endMs` is the **scheduled**
    `_deckWindowUntilMs` (the honest end instant), captured before `_applyDefaultCue` nulls it;
    logs a `party-window-elapsed` lifecycle entry.
  - `_reconcilePartyFollowMusic` release, :1124-1128.
  - `_endPartySessionNow` (operator disable mid-session), :1379-1383 — replaced the bare
    `_partySessionFollowsMusic = false`. Disabling while merely ARMED still early-returns, so
    "disable never consumes the trigger" holds.
  - `_noteDeckWindow` ownership handover, :760-769 — guarded on a real handover
    (`cueId !== _deckWindowCueId`), so a party cue re-firing over its own session is untouched.
  - `_goDormant` (festival window closing), :1521-1528.
  - the `_catchUp` end case, :1826 (below).
- **`getPartyStatus` display coherence**, :1271-1281: `cooldownRemainingSec` is computed only when
  `!inSession`, so the card no longer counts a cooldown down *inside* the session it belongs after.

### D2 — boot re-arm

`timeline_service.js` `start()`, :301-315. A persisted `moodArmed[partyCue] === false` is always a
session that died with the process (deck windows are runtime-only), so it is re-armed on boot.
Deliberately in `start()` and **not** `_catchUp` — `_catchUp` also runs from `savePlan`, `resume()`
and `_releaseOperatorLease`, where a `false` latch means a genuinely LIVE session. The cooldown
stamp is separate and still honoured: no free session.

### D4 / D5 / D7 / D8 — the resume boundary

- **Prior-session capture**, `_catchUp` :1673-1678: `priorDeckWindowUntilMs` +
  `priorPartyFollowsMusic` alongside the existing `priorDeckWindowCueId`.
- **D7**, `_establishBaselineIfActive` :1642-1655: the default-cue fill is now skipped under a
  **live owner including an open-ended one** (`_deckWindowCueId` set with `untilMs` null). An
  ELAPSED timed window still yields the deck, so boot/gap behavior is unchanged (this is the exact
  F1 rule `_reconcileDefaultCue` already honours — I widened the plan's `=== null` test to
  "live owner" so a caught-up clock cue whose window already elapsed still gets its immediate fill).
- **D4/D5/D8**, the resume re-apply block :1790-1875, now three branches:
  - *owner gone* (deleted by the save) → clear the latches, `defaultCue` reclaims **now**;
  - *party owner* → END the session when `!enabled` / window expired / mood calm (cooldown anchored
    at the scheduled window end when it expired during the takeover, else `now`), else **REJOIN**:
    re-dispatch, then restore the ORIGINAL `_deckWindowUntilMs` and the original follows-music shape;
  - *non-party owner* → the pre-existing re-dispatch, unchanged.
  Both end branches apply the default cue only when `!_defaultCueActive`, so there is never a
  double write.

### D6 — CaptainPad PARTY card (display only)

`CaptainPad/app/(tabs)/timeline.tsx` `PartyModeSection`, :1339-1370 (+ imports :71-77).

- Subscribes to the engine's `partyConfig` WS broadcast via `engineEvents.subscribe` and validates
  it with `parsePartyConfig` — a malformed broadcast becomes a loud banner, never a half-populated
  card. Fixes the permanent DISABLED-pill-over-ENABLED-toggle contradiction.
- The 5 s `/party-config` re-read now runs **while the card is mounted** instead of being gated on
  `livePhase` — i.e. on the very value it would discover. The 1 s countdown clock stays gated.
- The existing `busEnabled` mirror is kept (pre-broadcast engines). No engine change.

### D10 — empty PUT body → 400

`timeline_service.js` `setPartyConfig` :1160-1166. `readBody` maps an empty body to `{}`, so both
reach the validator identically and both are now refused by name. The route already turns a throw
into a 400.

### D11 — corrupt persisted party field: one loud boot refusal

- `marsin_engine/lib/timeline/timeline_state.js` `loadTimelineState` :215-227 — runs
  `partyConfigOf(parsed)` once and throws `timeline state invalid (<path>): <field> …`, exactly what
  a broken YAML already does two lines above. `start()` → `_loadSceneFiles()` therefore rejects and
  **no tick is ever armed** (no 86 k lines/day, no half-running timeline).
- `marsin_engine/lib/api_server.js` :10131-10139 — the start-failure log was a `console.warn`
  reading "Timeline service start failed"; it is now a `console.error` reading
  `⛔ TIMELINE DID NOT START — the show plan/state is not running: …`. It was not swallowed, but for
  a fatal config error it was too quiet.

## 2. New tests

**Engine (12 new):**

- `marsin_engine/tests/timeline/party_session_repeat.test.js` — **new file, 10 tests**: D1 repeat
  cycle; D3 anchoring (0 in session, full at end, `moodLastFire === windowEnd`, `cooldown`
  reachable, re-fire at expiry); D2 restart re-armed; D2 restart honours the persisted cooldown; D4
  rejoin-original-window; D4 window-expired-during-takeover; D4 music-stopped; D5 savePlan preserves
  `sessionEndsAtMs`; D7 no ambient flash on a follow-music save; D8 cue deleted → `defaultCue` fills.
  *Split into a third file for the same documented reason `party_config`/`party_session_timeline`
  were split (`_12` §7): a large chatty service-level file trips the Windows node:test worker-IPC
  flake.*
- `tests/timeline/party_config.test.js` — **+2**: empty patch → 400 (D10); corrupt `partyEnabled` →
  `loadTimelineState` throws naming file + field, and `start()` rejects with `_tickHandle === null`
  (D11).

**CaptainPad (+2)** in `utils/party_api.test.ts`: the `partyConfig` **broadcast** payload
(`type` + status extras) parses cleanly and the extras are ignored; a malformed broadcast throws.
(The card itself is a React screen with no render harness in this vitest setup, so the bus path is
covered at the parser it feeds.)

## 3. Probe re-run + expectation updates

`~/tmp/party_timeline_validation/probes` — **49/49** (48 originals + one new P7.2b). All 10
documented `_20` failures are green. Six probes encoded the OLD semantics and were updated (each
carries an inline dated comment):

| Probe | Was | Now |
|---|---|---|
| **P1.5** | asserted `effectiveState === 'armed'` — it *documented* D1 | asserts the cue really re-fired (`in_session`) once the cooldown expired with the music on |
| **P3.6** | "no re-fire after a mid-cooldown save" (one-session-per-arrival model) | nothing fires DURING the cooldown; **exactly one** session after it |
| **P4.8** | asserted the tick loop keeps running on a corrupt field | asserts the loud one-time boot refusal: names file + field, `_tickHandle === null`, no per-tick throw, no deck writes |
| **P5.2** | "the cooldown stamp is never re-stamped" | exactly **one** END stamp: it moves on the first disable and is stable across the other 19 flaps |
| **P7.2** | zero deck writes in 30 ticks — but it runs `cooldownSec: 0` | ≤1 legal re-take then settled (plan §9.5); **new P7.2b** proves the shipped 120 s cooldown yields zero re-takes |
| **P8 `{}`** | expected 200 (D10 as-shipped) | expects 400, nothing applied |

Two further probe corrections (not semantics, mis-written probes):

- **P12.1/P12.3** tightened to the plan's wording: 0 for the whole session, the FULL `cooldownSec`
  at the end, `effectiveState === 'cooldown'` reachable.
- **P8 "prototype pollution attempt"** was a JS object *literal* with `__proto__:`, which sets the
  prototype rather than creating an own key — it serialised to a plain valid `{"minDwellSec":60}`
  and tested nothing (its pass in `_20` was incidental). Now a computed key, so a real own
  `__proto__` field goes on the wire and is refused as an unknown field. Raw-string injection was
  and remains covered by `p8b_proto.mjs` (8/8, `polluted=no`).
- **P9 F8** had a hardcoded "must still be cooling" 15 s wait calibrated for the pre-fix world
  (where the cooldown was already burned). It now asserts the real rule from data: if it re-fired,
  the session must have STARTED at or after the cooldown expiry. Live result: re-fired 11 s after
  F7 with 12 s reported remaining — i.e. exactly at expiry.

**Live full chain (p9):** `F3 in_session (cd 0) → F5 window elapsed → cooldown 25 s → F8/F9
in_session again`, then follow-the-music opens/releases/re-triggers, staleness ends an open-ended
session, forced-while-disabled does nothing. **`effectiveState: 'cooldown'` is reachable live for
the first time.**

**Live CaptainPad (p11b, fresh `expo export` on `:7167`, operator's `:6967` Metro never touched):**
shot 2 — engine `in_session`, card **"IN SESSION · Party session running — ends in 4:56"** with no
reload (was ARMED for 24 s); shots 6/7 — DISABLED/DISABLED then **ARMED/ENABLED**, agreeing (was a
permanent contradiction). Screenshots re-written to
`~/tmp/party_timeline_validation/captainpadB_party_*.png`. The two React #418 page errors are
byte-identical to `_20`'s run (pre-existing hydration warning, not new).

## 4. Suites

- Engine `npm test`: **2278 tests / 2271 pass / 7 fail** — 5 × `audio_capture`
  (`device_not_configured`), `effects_v2_mode_page_layout` (worker-IPC deserialize),
  `osc_listener` (`EACCES` not `EADDRINUSE`). **Zero new.** Log:
  `~/tmp/party_fix_22/engine_full_test.log`.
- `node --test tests/timeline/*.test.js`: 297/296 with only the known `timeline_deck_release_default_cue`
  worker-IPC flake — which passes **9/9** when the file is run directly (`node <file>`).
- CaptainPad: `npx tsc --noEmit` clean; `npx vitest run` **40 files, 869 pass / 6 skipped / 0 fail**.

## 5. Deploy

```
python deploy/deploy.py deploy --machine titanic-ext --scene test_bench
→ DEPLOY OK: titanic-ext is running test_bench from e805ef01
```

Verified after: supervisor `restart_count` stable at 0, engine `activeModel=test_bench`, sim 200,
`GET /party-config` → shipped values intact (`enabled true`, `party_high`, `120/12/120`, both
toggles true), `GET /timeline/state` → `activePlan playa_default`, **`bootError: null`,
`lastError: null`** (i.e. the new D11 validation passed on the real persisted state file).

## 6. End state / disclosure

- **`marsin_engine/states/` tracked files are byte-identical to session start.** The local engine
  run rewrote `test_bench/{deck,globals,mixer}_state.yaml` (the plan's `defaultCue` loaded ambient
  over the branch's in-progress `slow` deck state); I **restored all three from a session-start
  backup** (`~/tmp/party_fix_22/states_backup/`) so the branch's own WIP residue is preserved —
  stating it rather than doing it silently. The only remaining difference is
  `test_bench/timeline_state.yaml`, which is **gitignored** and carries the probe values; not repo
  residue.
- The temp plan `validation_party_tmp` was created and deleted through the API (both p9 and p11b
  restore `playa_default` and the original party config). No `festival.startDate` edited on disk.
- Local engine (`:6968`) and the `:7167` static server were **stopped**. Nothing is left listening.
- No git operation that writes was run. No commit.
- Files changed: `marsin_engine/lib/timeline/timeline_service.js`,
  `marsin_engine/lib/timeline/timeline_state.js`, `marsin_engine/lib/api_server.js` (one log line),
  `marsin_engine/tests/timeline/party_session_repeat.test.js` (new),
  `marsin_engine/tests/timeline/party_config.test.js`, `CaptainPad/app/(tabs)/timeline.tsx`,
  `CaptainPad/utils/party_api.test.ts`, `.agent/projects/bm26_show_readiness.md`, this report.
  `CaptainPad/dist/` is gitignored (built for the :7167 probe).

## 7. For the revalidator — probe these hard

1. **The re-fire gate is now the cooldown, and only the cooldown.** Hammer `cooldownSec` 0 / 1 /
   7200 with continuous music: sessions must be back-to-back at 0 (a ~1 s ambient blip between them
   is expected and legal — §9.3 of the plan), and exactly one per `cooldownSec` otherwise.
2. **`cooldownSec: 0` + a scheduled look cue.** The handover ends the session, so party can take the
   deck back one tick later. P7.2 now allows exactly one re-take and requires the deck to settle;
   try longer horizons and a plan with several deck cues to be sure it cannot oscillate.
3. **Restart mid-session with a mid-cooldown crash.** The cooldown is measured from the FIRE stamp
   when the process died before the end stamp ran (plan §9.4, deliberate) — confirm that is the
   behavior you get and that it never hands out two sessions.
4. **`savePlan` while the mood is momentarily CALM mid-FIXED session** now ends the session, whereas
   an undisturbed fixed session rides the drop out (plan §9.8 — a deliberate behavior delta). Worth
   an operator eye.
5. **The `_establishBaselineIfActive` guard** — I widened the plan's `_deckWindowCueId === null` to
   "no LIVE owner (an elapsed timed window still yields)" so a caught-up clock cue with an
   already-elapsed `durationMin` still gets its immediate default-cue fill on boot. Re-check boot
   into a gap, and boot with a caught-up cue whose window has and hasn't elapsed.
6. **D11 on a real box**: hand-edit `partyEnabled: "no"` into a deployed `timeline_state.yaml`,
   restart, and confirm ONE `⛔ TIMELINE DID NOT START` line, no tick spam, and that fixing the file
   boots normally.
7. **The party card under a flaky WS**: kill/restore the socket while a session runs and confirm the
   5 s poll alone keeps the card honest (the poll is now unconditional while mounted).
