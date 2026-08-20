# 20260725_20 — Party mode × Timeline: ADVERSARIAL VALIDATION

**Author:** Validation agent (Opus, adversarial) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-27
**Under test:** `20260725_12` (detector + plan) · `20260725_18` (+ addendum, CaptainPad card) ·
`20260725_19` (companion PARTY tab + engine `/party-config` authority)
**Mandate (operator, verbatim):** *"make sure the party mode works very very very compatible with the
timeline feature and have opus agents test it fully as much as possible"* + *"stable, bullet proof and
playa proof."*
**Brief:** break it, don't bless it. No source edits, no git operations, temp files in `~/tmp`.

---

## VERDICT — **CONDITIONAL FAIL: 4 blocking defects, 2 of them show-stoppers**

The machinery is genuinely good. Precedence, flapping, hostile input, persistence, staleness and the
follow-the-music release are all **solid** — 38/48 in-process probes, 40/40 hostile-input probes and
5/5 WS probes pass, and the whole chain runs end-to-end live.

But the **fixed-duration** session model — the shipped default — does not survive contact with a real
party, and the operator surface lies about it:

| # | Defect | Sev | Where |
|---|---|---|---|
| **D1** | **Party fires ONCE per continuous music episode.** With the music running all night a fixed-duration session ends, the rig drops to ambient, and party can **never** fire again — while `effectiveState` reports `armed` | **BLOCKER** | `triggers.js` mood latch |
| **D2** | **An engine restart during a live party kills party for the rest of the night** (same latch, persisted) | **BLOCKER** | `triggers.js` + persisted `moodArmed`/`prevMood` |
| **D3** | **The cooldown clock starts at the FIRE, not at the session end.** With the shipped 12 min / 120 s the whole cooldown burns in the first 2 minutes of the session — there is effectively **no cooldown**, and `effectiveState: 'cooldown'` is unreachable | **HIGH** | `triggers.js` `moodLastFire` |
| **D4** | **An operator takeover mid-session RESURRECTS the party session on lease release** — fresh full `durationMin`, and it re-applies the party look even when the mood has gone CALM and even when the music has stopped | **HIGH** | `timeline_service._catchUp()` resume re-apply |
| **D5** | `savePlan` mid fixed session restarts the session window (fresh full `durationMin`) | MED | same `_catchUp` path |
| **D6** | **CaptainPad's PARTY MODE card never learns of a transition it isn't already tracking** — proven live showing "ARMED" for 24 s while the engine was `in_session`; and it renders an ENABLED toggle over a DISABLED pill | **HIGH (operator-facing)** | `timeline.tsx` — no `partyConfig` WS listener |
| D7 | `savePlan` mid follow-the-music session flashes the deck through the ambient default cue | LOW | `_catchUp` |
| D8 | Removing the party cue mid-session orphans the deck-ownership latch; the deck sits on the autopilot baseline, not the `defaultCue` | LOW | `_catchUp` |
| D9 | An out-of-band snapshot recall (raw engine route, no takeover) is clobbered by the default cue at session end. **CaptainPad's own path is safe** (SnapshotBar is gated behind the plan lock) | LOW / info | `api_server` recall route |
| D10 | `PUT /party-config` with an **empty body** → `200` instead of the documented `400` | NIT | `api_server` |
| D11 | A corrupt persisted party field throws **once per tick, unthrottled** (86 k log lines/day) and silently kills the whole timeline while the engine looks healthy | LOW | `partyConfigOf` call site in `_tick` |

**None of these are in the code `_19` wrote.** D1/D2/D3 live in the pre-existing pure trigger
evaluator; D4/D5/D7/D8 live in the pre-existing `_catchUp` resume path. `_19` built a correct policy
layer *on top of* a trigger model whose re-arm semantics do not match the session model the operator
specified. That is exactly the kind of seam this pass was meant to find.

**titanic-ext: UNTOUCHED.** Verified byte-identical to the session-start baseline (see §7).

---

## 1. Blocking defects — exact reproductions

### D1 — party fires ONCE per continuous music episode (BLOCKER)

**Repro (in-process, `~/tmp/party_timeline_validation/probes/p1_rearm.test.mjs` P1.3):**

1. Plan active, in festival window, `durationEnabled: true`, `durationMin: 2`, `cooldownSec: 60`.
2. Mood goes `calm → party` and **stays 1** (a real party: the music never stops).
3. The session fires and runs its 2 minutes; the default cue reclaims the deck. ✔
4. Wait out the cooldown, then tick for another 10 s with the mood still 1.
5. **Nothing fires. Ever.** `effectiveState` reports `armed`; `moodArmed.c_mood_to_party === false`.

**Root cause** — `lib/timeline/triggers.js`, the mood branch:

```js
if (party === fromVal) { next.moodArmed[cue.id] = true; continue; }   // only CALM re-arms
...
next.moodArmed[cue.id] = false;   // latch: one fire per arrival at `to`
```

The cue re-arms **only** on a mood transition back to `calm`. `audioPartyStrong` only drops after
`offConfirmMs` (30 s) of continuous disqualification, so at a real party it stays `1` for hours.

**Impact on playa:** the Titanic gives one 12-minute party session per *musical evening*, then runs
ambient for the rest of the night. The `cooldownSec` control the operator explicitly asked for
("I don't like the cooldown generally, but it needs to be there anyways") governs nothing, because
the thing it gates can never happen twice.

**Control case (P1.4, PASS):** stop the music, let it drop to calm, restart it → it fires again. So
the feature works exactly in the case where the operator would least want a re-trigger, and not at
all in the case where they would.

**Note:** `effectiveState` reporting `armed` here is actively misleading — the whole point of that
field per `_19` §3 was "nobody paints a misleading ARMED". Pinned by P1.5.

### D2 — an engine restart during a live party kills party for the night (BLOCKER)

**Repro (`p4_restart.test.mjs` P4.5):**

1. A live follow-the-music (or fixed) party session, mood 1.
2. `svc.stop()`, construct a new service on the same `stateDir`, `start()` — a cold engine restart
   with the music still playing.
3. Tick for 200 s of continuous mood 1 with `minDwellSec: 120`.
4. **Nothing fires.** `effectiveState: armed`, `moodArmed: false`, zero deck writes.

`moodArmed:false` and `prevMood:1` are **persisted** in `timeline_state.yaml`, so the boot inherits
the latch. This is the direct counterexample to the requirement *"restart-safe in every mode"* — and
the supervisor restart is precisely the event this system exists to survive.

The rest of the restart matrix is **clean** (P4.1–P4.4, P4.6): no session resurrection, persisted
`enabled`/playlist/numbers honoured, cooldown stamp survives (no free session), `defaultCue`
reclaims the deck, a persisted DISABLED policy holds.

### D3 — the cooldown clock starts at the FIRE, not at the session end (HIGH)

**Repro (`p12_cooldown.test.mjs`), shipped defaults:**

```
durationMin 12 (720 s), cooldownSec 120, cooldownEnabled true
cooldownRemainingSec at FIRE          = 120 s
cooldownRemainingSec at t = +60 s     =  60 s   (still IN SESSION)
cooldownRemainingSec at SESSION END   =   0 s   → effectiveState 'armed', never 'cooldown'
```

`triggers.js` stamps `next.moodLastFire[cue.id] = now` **at the fire** and tests
`now - last >= cooldownSec*1000`. The cooldown therefore runs **concurrently with the session**, not
after it. It has any effect at all only when `cooldownSec > durationMin × 60`.

Confirmed live on the full chain (F3→F7): during a 60 s session with `cooldownSec: 30` the reported
cooldown counted `30s → 10s → 0s` *inside* the session, and `effectiveState` went straight from
`in_session` to `armed`.

**Operator-facing consequence:** CaptainPad renders *"Session just ended — waiting out the cooldown
before another can trigger"* for a state that, with the shipped numbers, can never occur.
(It is also the only reason D1 is not even more visible: the cooldown was never the thing blocking
the re-fire.)

### D4 — takeover → lease release RESURRECTS the party session (HIGH)

**Repro A — session extension (`p2_recall_takeover.test.mjs` P2.4):**

1. Fixed session, `durationMin: 12`, running. `sessionEndsAtMs = T`.
2. `takeover()` (what CaptainPad fires on the operator's first deck/mixer touch).
3. Operator walks away; 11 minutes pass; the 120 s operator lease expires.
4. The tick auto-releases the lease → `_catchUp()` → the party cue is **re-dispatched**.
5. `sessionEndsAtMs` is now **`T + 11 min`** — a fresh full `durationMin` from the release instant.

**Repro B — resurrection with no music (P2.5):**

1. Fixed session running. `takeover()`.
2. **The music stops** (mood → calm) while the human holds the deck.
3. Lease expires → `_catchUp()` re-dispatches the party cue: `party_high` is loaded onto the deck and
   `effectiveState` reads `in_session`, **with the mood at CALM**, for a full fresh `durationMin`.

**Root cause** — `timeline_service._catchUp()`, the "RESUME / lease-release FULL RESET" block
(≈ line 1671). It re-dispatches `priorDeckWindowCueId` guarded only by *"the cue exists, is enabled,
and drives the deck"*. It does **not** check `_isPartyCue`, does **not** consult
`getPartyConfig().enabled`, and does **not** consult the current mood; and `_dispatchCue` →
`_noteDeckWindow(..., now)` re-anchors the window to the release instant.

The feature is correct for a **scheduled** cue (its precondition is the clock, which is still true).
It is wrong for a **mood** cue, whose precondition is a signal that may no longer hold.

**What is NOT broken here (all PASS):** a takeover mid-session correctly reports `manual` and freezes
the deck (P2.3); a pending fire is suppressed under `manual` (existing test); and **disabling** party
mode during a takeover both leaves the deck alone *and* immunises it against this resurrection
(P2.6), because `_endPartySessionNow` clears the ownership latch first.

### D5 / D7 / D8 — `savePlan` hot-reload mid-session (`_19` §4 flag 3, previously untested)

| Probe | Result |
|---|---|
| P3.1 | **PASS** — `savePlan` does **not** re-seed party-config over operator edits (`_seedPartyTiming` runs only in the constructor). Plan-side `minDwellSec 999 / durationMin 99 / cooldownSec 999` are correctly ignored |
| P3.5 / P3.6 | **PASS** — mid-**cooldown** save preserves the stamp exactly (539 s → 539 s) and produces no double-fire |
| P3.8 | **PASS** — all seven persisted party fields round-trip to disk unchanged across the save |
| P3.3 | **PASS** — a mid follow-the-music save keeps the session, its open-ended shape, and its release-on-drop |
| **P3.2 (D5)** | **FAIL** — a save 10 minutes into a 12-minute session pushes `sessionEndsAtMs` out by 10 minutes (fresh full window), same `_catchUp` cause as D4 |
| **P3.4 (D7)** | **FAIL** — a save mid open-ended session writes `ambient` then `party_high` in the same operation: a visible ambient flash on the rig |
| **P3.7 (D8)** | **FAIL** — removing the party cue mid-session leaves `_deckWindowCueId` pointing at the deleted cue with a live window, so `_reconcileDefaultCue` refuses to fill and the deck sits on the **autopilot baseline** (`baseline_pl`), not the plan's `defaultCue` (`ambient`), until the orphaned window elapses |

### D6 — CaptainPad's PARTY MODE card shows a stale state (HIGH, operator-facing)

**Proven live** against the local engine, fresh `expo export` dist served on **:7167** (the
operator's Metro on :6967 was never touched). Screenshots in
`~/tmp/party_timeline_validation/captainpadB_party_*.png`:

| Shot | Engine truth | What the card showed |
|---|---|---|
| `1_armed` | `armed` | **ARMED** ✔ |
| `2_engine_in_session_no_reload` | **`in_session`, ends in 295 s** | **"ARMED — Waiting for sustained party audio to trigger a session."** ✘ |
| `3_after_focus_event_no_reload` | **`in_session`, ends in 287 s** | still **ARMED** ✘ (24 s after the session started, and after a window `focus` event) |
| `4_after_reload` | `in_session` | **"IN SESSION — Party session running — ends in 4:39 · mood party"** ✔ (only a full reload fixes it) |
| `5_signal_dropped` | `in_session` | "ends in 4:33 · **mood calm**" ✔ — a fixed session honestly rides out the drop |
| `6_disabled_from_another_surface` | `disabled` | **DISABLED** ✔ (it *was* polling, because it was in a live phase) |
| `7_rearmed_from_another_surface` | `armed` | pill **DISABLED** over a toggle reading **ENABLED** — self-contradictory, and permanent ✘ |

**Root cause, two halves:**

1. **Nothing in CaptainPad subscribes to the `partyConfig` WS message.** The engine broadcasts it on
   every PUT and replays it on `/ws/control` connect (verified — see §4), but
   `grep -rn partyConfig CaptainPad --include=*.ts*` returns **zero** listeners outside
   `party_api.ts`/tests. The only live signal the card consumes is `timelineState.partyEnabled`,
   which mirrors the **toggle** but not `effectiveState`.
2. **The 5 s refresh is gated on the value it would refresh:**
   `const livePhase = cfg?.effectiveState === 'in_session' || cfg?.effectiveState === 'cooldown';`
   — the poll that would discover `in_session` only runs once the card already believes it is
   `in_session`. Every transition *into* a live phase is therefore missed, and shot 7 shows the
   mirror case: once the card lands on `disabled` the polling stops, so a re-arm from another
   surface leaves the pill stuck.

`/timeline/state` (broadcast every tick) already carries `party` and `activeCue`, and
`describePartyStatus` has a derivation path that uses them — but it is unreachable, because the
`switch (input.effectiveState)` above it always matches on the stale cached value.

**Playa consequence:** the iPad shows "ARMED — waiting for sustained party audio" while the rig is
visibly in a party session, and there is no in-app way to correct it (Expo web/native has no
reload gesture the operator would think to use).

### D10 / D11 — minor

- **D10:** `PUT /party-config` with an empty request body returns **200** and a full config, instead
  of the strict `400 "party config: an object body is required"` that `null`, `42`, `"hello"` and
  `[1,2,3]` all correctly get. Benign (nothing is applied) but inconsistent with the documented
  all-or-nothing contract.
- **D11:** a hand-edited/corrupt `partyEnabled: "no"` in `timeline_state.yaml` **is** refused (good —
  never read as armed) and `start()` does surface it. But the tick loop keeps running and throws on
  **every tick**, caught into one unthrottled `⚠ [timeline] tick error` per second — 86 400 lines/day,
  the same disk-fill class `_17` just closed — while the **entire** timeline (clock cues, sun cues,
  default-cue reconcile, not just party) is dead and the engine otherwise looks healthy.

---

## 2. What is SOLID (the pass list)

### 2.1 Party vs scheduled cues — 7/7 PASS (`_19` §4 called this "reasoned, not re-tested")

- A scheduled look cue landing mid-party-session **takes** the deck cleanly; ownership transfers;
  `effectiveState` stops claiming `in_session` (P7.1).
- **No A/B flapping**: 30 ticks after the handover, with the music still playing, the party cue does
  **not** steal the deck back — zero deck writes (P7.2).
- A stale follow-the-music release does **not** clobber the scheduled cue that took over (P7.3), and
  the API never reports a follow-music session that isn't running (P7.4) — the internal flag is
  orphaned `true` but is correctly gated behind the ownership check.
- A **held program** suppresses a pending party fire into `wouldFire` — never silent (P7.5).
- A live party session does **not** block a scheduled program from starting on time (P7.6).
- **Same-tick collision** (party fire + clock cue due on the same tick): deterministic winner (plan
  order), settles in one tick, zero flapping over the next 10 (P7.7). One cosmetic note: the party
  look is written and immediately overwritten in the same tick, and the party cooldown stamp is
  burned for a session nobody saw.

### 2.2 Flapping and edge storms — 11/11 PASS

- **20× enable/disable during dwell** → the pending fire is not consumed; it fires the moment the
  dwell completes (P5.1). Confirms `_19`'s "disabling suppresses the SHOW, it does not consume the
  trigger".
- **20× enable/disable during a session** → ends cleanly, one cooldown stamp (never re-stamped), no
  orphaned `_partySessionFollowsMusic`, no orphaned window (P5.2).
- **20× enable/disable during cooldown** → the remaining cooldown is monotonically decreasing at
  every one of 20 samples; never reset, never skipped (P5.3).
- **`durationEnabled` flipped 20× mid-session** → the session keeps the mode it *started* with, in
  both directions (P5.4 open-ended stays open-ended; P5.5 the fixed window does not move and a signal
  drop does not end it).
- **Playlist changed mid-session** → does not swap under the live session; applies to the next one
  (P5.6).
- **Dwell boundary**: 119 s does not fire, 121 s does; a 1-tick dip at 119 s resets the clock, so an
  art car parked for two minutes cannot reach a session (P6.1, P6.2).
- **100 one-second mood flaps** while armed → zero fires, zero errors (P6.3).
- **100 flaps after a session opens** (follow-the-music) → 50 clean opens / 50 clean closes, no wedge,
  no error, cooldown always 0, and the internal flag agrees with the reported state every time (P6.4).
- **PANIC-style mid-dwell disable → re-enable** → the sustain clock is *not* restarted; the fire lands
  at the true 121 s (P6.5).

### 2.3 Restart safety — 6/7 PASS (the miss is D2)

No session resurrection in either mode; persisted `enabled` / playlist / `minDwellSec` /
`durationMin` / `cooldownSec` / both toggles honoured on boot; the cooldown stamp survives so a
restart mid-cooldown hands out no free session and a forced re-fire attempt during it is refused;
`defaultCue` owns the deck after boot; a persisted DISABLED policy blocks everything.

### 2.4 Hostile input — 40/40 PASS (live HTTP, `p8_http.mjs` + `p8b_proto.mjs`)

Every one of these returns **400 with a message naming the field and the bound, and changes
nothing**: negative / above-max / zero-below-min numbers, `null`, string numbers, booleans in number
slots, `1e9`, `1e400`→`Infinity`, unknown playlist (with the full available list in the message),
empty and whitespace playlists, playlist-as-number, `enabled` as string/number,
`durationEnabled` as string, unknown fields, the retired `releaseSustainSec`, a valid field beside an
invalid one (nothing applied — verified by GET before/after), `__proto__` / `constructor` /
`prototype` injections (no pollution), duplicate JSON keys, deeply nested objects, a 10 000-char
playlist name, arrays, strings, numbers, `null` and malformed JSON as the whole body.
Only the empty body is off-contract (D10). `1e2` (= 100, in range) is correctly **accepted**.

**Concurrency:** 25 conflicting `PUT`s fired with `Promise.all` → all 200, and the final GET equals
**exactly one** of the 25 submitted intents (no interleaved half-state). 30 concurrent
enable/disable PUTs settle deterministically.

### 2.5 WS contract — 5/5 PASS (`p10_ws.mjs`)

Replay on `/ws/control` connect: exactly **1** `partyConfig` message carrying the full payload
(`effectiveState`, `availablePlaylists`, session detail). Broadcast on every PUT: 1 message per PUT,
20 rapid PUTs → 20 broadcasts with the last one authoritative and matching REST truth. A client that
reconnects mid-change gets the current value (33, not the pre-change one). A `/ws/signals` client
receives **zero** `partyConfig` noise — topic routing is correct.

### 2.6 Full chain, live (`p9_fullchain.log`)

Local engine, a temp plan with today's `festival.startDate` (created and deleted through the API —
`festival.startDate` on disk was never edited), `audioPartyStrong` driven through
`POST /param-center` at 2 Hz (the same publish-stage path the companion's FAKE TRIGGER writes):

- **Fixed mode:** `armed` → (10 s dwell) → `in_session` with `endsIn 59s`, `sessionFollowsMusic false`
  → window elapses → deck returns. Timing exact.
- **Follow-the-music:** `in_session` with `sessionEndsAtMs: null`, `sessionFollowsMusic: true`;
  survives 20 s of continued music; **releases within ~3 s of FORCE OFF** with
  `cooldownRemainingSec: 0` despite a configured `cooldownSec: 7200`; **immediate re-trigger** after
  the dwell alone. Exactly the specified semantics.
- **Staleness mid-session:** stop republishing → after 13 s (`staleSec: 10`) `moodStale: true`,
  `moodRawValue` still `1` (the frozen value visibly refused), mood forced CALM, the open-ended
  session **ended**. Recovery clears it. ✔
- **Forced + disabled = nothing:** `effectiveState: disabled`, no cue active, with the signal held
  forced at 1 for 12 s. ✔ Re-arming with the signal still forced correctly reported `cooldown`
  (`cooldownSec` was 7200 at that point) — the cooldown *is* honoured when it outlasts the session.

---

## 3. Look / snapshot recall mid-session (`_19` §4 "reasoned, not tested")

| Path | Result |
|---|---|
| **CaptainPad → SnapshotBar** (the operator's real path) | **SAFE.** `SnapshotBar` is rendered `disabled={structuralLocked}`; while the plan drives, RECALL and CAPTURE are dimmed until the operator takes over. Taking over sets `manual`, freezes the deck, and the timeline stops writing (P2.3). The recalled look stands. |
| **Raw engine route** `POST /mixer/snapshots/:name/recall` | **D9.** It calls `recallLook()` and never tells the timeline — no `takeover()`, no `activity()`. `_deckWindowCueId` stays latched on the party cue, so `effectiveState` keeps reporting `in_session` while the deck runs the operator's look, and at the window end (P2.1) or on the signal drop (P2.2) the `defaultCue` **overwrites it with ambient**. |

D9 is a pre-existing engine-wide property (any cue's window would do this), not party-specific, and
the iPad cannot reach it. Worth knowing before anyone scripts a recall from a laptop during a show.

**Caveat that D4 adds:** if the operator *does* take over to recall a look mid-party-session and then
stops touching the iPad, the 120 s lease expiry re-applies the party cue over their recall — with a
fresh full window. That is D4, and it makes the "safe" path unsafe after two minutes of inactivity.

---

## 4. Suites (probe 9)

| Suite | Result | Delta vs stated baseline |
|---|---|---|
| Engine `npm test` | **2267 tests / 2260 pass / 7 fail** | **ZERO delta.** The 7 are exactly the known environmental failures: 5 × `audio_capture` (`device_not_configured`), `effects_v2_mode_page_layout` (worker-IPC `Unable to deserialize cloned data`), `osc_listener` (`EACCES` not `EADDRINUSE`). The known 8th flake (`timeline_deck_release_default_cue`) did not reproduce |
| Party/timeline files in isolation | **69 / 69 pass** | `party_config`, `party_session_timeline`, `companion_party_tab`, `mood_source_staleness`, `party_mode_strong`, `companion_party_detection_emits` |
| Engine states residue from the suite | **0 changed / 0 added / 0 removed** (38 files MD5'd before + after) | clean |
| CaptainPad `npx tsc --noEmit` | **clean, exit 0, no output** | — |
| CaptainPad `npx vitest run` | **40 files, 867 pass / 6 skipped, 0 fail** | +15 vs `_18`'s 852 (new `deck_swap_watchdog` tests etc.), no regressions |
| Swap-wedge regression (`_16`/`_17`) | **GREEN** — engine `deck_swap_cancel_notify.test.js` 9/9; CaptainPad `deck_swap_watchdog.test.ts` 11/11 | `transitionId`-match gating the unlock and the cancelled-complete broadcast are both still covered |

---

## 5. Probe inventory

All temp, all under `~/tmp/party_timeline_validation/` (nothing in the source tree).

| File | Probes | Pass |
|---|---|---|
| `probes/harness.mjs` | shared: real `TimelineService`, real plan shape, `restart()`, deck-write log | — |
| `probes/p1_rearm.test.mjs` | fixed session end → cooldown → re-arm | 4/5 (**D1**) |
| `probes/p2_recall_takeover.test.mjs` | recall + takeover mid-session | 4/6 (**D4** ×2) |
| `probes/p3_saveplan.test.mjs` | `savePlan` hot-reload mid-session / mid-cooldown, seeding | 5/8 (D5, D7, D8) |
| `probes/p4_restart.test.mjs` | engine restart in every mode + corrupt state | 6/8 (**D2**, D11) |
| `probes/p5_flap.test.mjs` | flapping (P5) + signal edge storms (P6) | 11/11 |
| `probes/p7_precedence.test.mjs` | party vs scheduled cues / programs | 7/7 |
| `probes/p12_cooldown.test.mjs` | when does the cooldown clock start | 1/3 (**D3**) |
| `probes/p8_http.mjs`, `p8b_proto.mjs` | hostile HTTP input + concurrency | 40/40 (D10 nit) |
| `probes/p10_ws.mjs` | WS replay / broadcast / topic routing | 5/5 |
| `probes/p9_fullchain.mjs` | full chain live, both modes | see §2.6 |
| `probes/p11_captainpad.cjs`, `p11b_captainpad.cjs` | CaptainPad card live on :7167 | **D6** |

Logs and screenshots: `probes_final.log`, `p9_fullchain.log`, `p11.log`,
`captainpad_party_*.png`, `captainpadB_party_*.png`, `p11b_captainpad.txt`,
`suites/engine_full_test.log`, `suites/captainpad_vitest.log`.

Rerun the in-process set with:

```bash
cd ~/tmp/party_timeline_validation/probes
node --test p1_rearm.test.mjs p2_recall_takeover.test.mjs p3_saveplan.test.mjs \
            p4_restart.test.mjs p5_flap.test.mjs p7_precedence.test.mjs p12_cooldown.test.mjs
# 48 tests · 38 pass · 10 fail — every failure is a documented defect above
```

---

## 6. Recommended fixes (for the build agents — NOT applied here)

1. **D1/D2 — re-arm the mood cue when the session ENDS, not only on a calm edge.** The cleanest
   minimal change: when a party session's window elapses (or a follow-music session releases), clear
   `state.moodArmed[cueId]` back to `true` so the cooldown becomes the thing that actually governs
   re-triggering. That makes the operator's stated model (`session → cooldown → can fire again`) true,
   makes D2 disappear as a special case, and leaves the follow-the-music path unchanged (it already
   re-arms naturally). **Needs an operator decision:** with this fix, continuous music yields
   `session → cooldown → session → …` forever. That is what the cooldown control is for, but it is a
   behavioural change worth confirming — the current shipped behaviour is one session per evening.
2. **D3 — stamp the cooldown at session END**, not at the fire (or define `cooldownSec` as
   "from the end" and subtract the session length). Until then the shipped `120 s` cooldown is inert
   and CaptainPad's cooldown copy is unreachable. These two together are what make the re-fire story
   coherent.
3. **D4/D5/D7/D8 — make `_catchUp`'s resume re-apply mood-aware.** Skip the re-dispatch when
   `_isPartyCue(owner)` and either the party policy is disabled or the current mood is not `party`;
   and when it *is* re-applied, preserve the ORIGINAL `_deckWindowUntilMs` instead of opening a new
   window (`_catchUp` already does exactly this re-anchoring for caught-up clock cues at line ~1643 —
   the same trick applies). Clearing an ownership latch whose cue no longer exists in the reloaded
   plan fixes D8.
4. **D6 — subscribe to the `partyConfig` WS message in CaptainPad** (the engine already broadcasts and
   replays it), and drop the `livePhase` gate on the poll — or at minimum derive `livePhase` from
   `timelineState` (which is broadcast every tick and already carries `party` and `activeCue`) rather
   than from the cached `/party-config`.
5. **D10** — treat an empty body like every other non-object body (400).
6. **D11** — validate the persisted party fields **once at construction** and refuse to start, rather
   than throwing per tick; or route the tick error through `send_error_throttle.js`.

---

## 7. Environment / end state — full disclosure

- **titanic-ext (10.x.x.151): UNTOUCHED and healthy.** Read-only throughout — no PUT, no restart, no
  deploy. `GET /party-config` is now **200** (it 404'd at the end of `_18`, so `_18`'s "live PARTY
  MODE proof still owed" is discharged for the endpoint). The final read is **byte-identical** to the
  session-start baseline (`remote_baseline_party-config.json`): `enabled true`, `party_high`,
  `120/12/120`, both toggles true, `effectiveState no_plan`, `planActive false`,
  `inFestivalWindow false`, 14 playlists. `/timeline/state`: `mode armed`, `controller manual`,
  `activePlan playa_default`, `currentMood calm`, `moodStale false`, `moodStaleEpisodes 0`,
  `lastError null`. Plans list unchanged (`playa_default`, `test`).
- **The operator's Metro on :6967 was never touched.** The CaptainPad checks ran against a fresh
  `expo export` dist served on **:7167** only.
- **Local machine:** a local engine ran on the standard ports (nothing else was listening) and was
  **stopped**; the :7167 static server was **stopped**. No local service is left running.
- **Repo working tree:** `simulation/scenes/test_bench/timeline/validation_party_tmp.yaml` was created
  and **deleted** through the API (verified absent; `playa_default.yaml` was never rewritten). No
  `festival.startDate` was edited on disk anywhere.
- **`marsin_engine/states/` — reported, not hidden.** The local engine run rewrote
  `test_bench/deck_state.yaml` and `test_bench/globals_state.yaml` (the plan's `defaultCue` loaded the
  `ambient` playlist + `deep_sea` palette over the branch's in-progress `slow` deck state). I
  **restored both from a session-start backup** (`~/tmp/party_timeline_validation/states_backup/`) so
  the branch's own work-in-progress residue is preserved exactly as it was — stating it here rather
  than doing it silently. `test_bench/timeline_state.yaml` is **gitignored** and still carries my
  probe values (party fields seeded, a `moodLastFire` stamp); it is not repo residue. Verified: the
  only file differing from the session-start MD5 snapshot is that one gitignored file.
- **No source file was edited. No git command that writes was run.**
