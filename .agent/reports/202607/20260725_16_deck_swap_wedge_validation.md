# 2026-07-25_16 — Deck-swap WEDGE fix: adversarial validation

**Role:** validator. Pipeline: `_14` (Fable, debug) → `_15` (fix) → **this**.
**Mandate:** try to BREAK the fix. No source edits, no git operations; all
scratch in `~/tmp/swap_wedge_validation/`.

**Verdict: PASS — the fix holds under every probe.** No product defect found.
Two non-blocking notes (one cosmetic code nit, one pre-existing engine-test
env fail the `_15` count missed) and one pre-existing **operational hazard on
titanic-ext unrelated to this fix** (an 88 MB log from unthrottled sACN
send-error spam) are recorded below.

## Rig

| Piece | What |
|---|---|
| Client | **Fresh** dist already built at 17:09 from sources last touched 17:07 — verified no CaptainPad `.ts/.tsx` newer than the build, served bundle hash `entry-19446e64…` matches `dist/`, contains `deckSwapWatchdogDelayMs` + `swapWatchdogRef`. Served on **`:7167`**. Operator's Metro on `:6967` **never touched**. |
| Local engine | `node engine.js --model test_bench --pattern 01_cylon_sweep` on `:6968`, started and stopped this session; port confirmed quiet after. |
| Viewport | iPad-10 landscape **1180×820**, `hasTouch`, headless Chrome. |
| Remote | titanic-ext **10.x.x.151** (operator-granted). |
| Harness | `~/tmp/swap_wedge_validation/probes.cjs` (`p1a p1b p2 p3 p5`), `p3tail.cjs`; screenshots + `engine_tests.log` in the same dir. |

Ground truth for every probe is a **raw WS monitor connected directly to the
engine's `/ws/control`**, independent of the page.

---

## Probe 1 — non-PANIC cancel paths, driven LIVE

`_15` covered these by unit test only. Both driven end-to-end, 6 000 ms fade,
cancel fired at +900 ms mid-fade.

### 1a — look/snapshot morph kickoff (`api_server.js:2967`) — **PASS**

`POST /mixer/snapshots/<n>/recall-fade {durationMs:1500}` while a deck swap is
mid-fade.

```
[WS] deckSwapStarted  {transitionId:"deck_1_1785198475637", durationMs:6000}
     mid-fade wedged=true (aria-disabled=true, dim ancestor 0.55)   ← by design
[WS] deckSwapComplete {cancelled:true, transitionId:"deck_1_1785198475637"}
     HEAL: 4 ms      (watchdog window was 8 000 ms — the ENGINE fix healed it)
     post-heal tap: 1 POST
```

transitionId on the cancelled-complete **matches** the started. Evidence:
`p1a_midfade.png`, `p1a_healed.png`, `p1a_posttap.png`.

### 1b — deck channel remove/replace (`pattern_mixer.js:1597`) — **PASS**

`POST /mixer/snapshots/<n>/recall` (instant recall → `recallLook` →
`removeDeckChannel()` → `cancelDeckPatternSwap()`), same shape:

```
[WS] deckSwapStarted  {transitionId:"deck_2_1785198490848", durationMs:6000}
[WS] deckSwapComplete {cancelled:true, transitionId:"deck_2_1785198490848"}
     HEAL: 2 ms      post-heal tap: 1 POST
```

Evidence: `p1b_midfade.png`, `p1b_healed.png`, `p1b_posttap.png`.

## Probe 2 — REAL WS drop mid-fade (socket severed, not filtered) — **PASS**

Not an in-page message filter: a **raw TCP proxy** (`:7268 → :6968`) carried
the page's HTTP *and* WS. Mid-fade I destroyed **all 19 live sockets** and
**refused reconnects for 10 s**, so the page genuinely lost the bus across the
started→complete window.

```
[WS monitor, direct to engine] deckSwapStarted {deck_3_…, durationMs:6000}
     mid-fade wedged=true (0.55 + aria-disabled)
     SEVERED 19 sockets at +925 ms (reconnects REFUSED)
[WS monitor] deckSwapComplete {deck_3_…}        ← engine completed normally;
                                                  the CLIENT never saw it
     HEAL: 8 060 ms after tap  (watchdog window = 6 000 + 2 000 = 8 000 ms)
     page CONNECTED indicator: false at heal time (genuinely offline)
     after reconnect: wedged=false, tap → 1 POST
     engine renderHealth after: ok, frame 9517, blendErrors []
```

The watchdog fired at the arithmetic boundary, released the list **while still
disconnected**, and the list was immediately usable once the bus came back.
Evidence: `p2_healed_offline.png`, `p2_after_reconnect.png`.

## Probe 3 — swap-over-swap spam + interleaved cancels — **PASS**

Three sub-probes, 5 000 ms fades, run 3× total.

- **3a — UI rapid-fire (6 taps, 120 ms apart):** 1 POST (taps 2-6 swallowed
  client-side during the fade, by design). List healed to `wedged=false` after
  the fade. No stuck press, no stuck dim.
- **3b — API rapid-fire (5 direct `POST /deck/playlist/entry`, 150 ms apart):**
  status codes `[200,409,409,409,409]` — **the engine refuses swap-over-swap**
  (`deckSwapInFlightReason` → 409), so exactly one started/complete pair on the
  wire. This makes `triggerDeckPatternSwap`'s silent inline drop
  (`pattern_mixer.js:2352`, the one path that deliberately emits *no* cancelled
  event) essentially unreachable over HTTP — which is why the `_15` decision not
  to notify there is safe.
- **3c — the race (4 rounds):** PANIC and a new entry-select fired with
  `Promise.all` (order alternated per round) while swap A was mid-fade, then the
  UI lock state compared against wire ground truth. Every round the wire was
  correctly ordered:

  ```
  round 2 [panic|B] seq=[started:deck_8, CANCELLED:deck_8, started:deck_9]
                    liveSwap=deck_9   uiWedged=true    ← lock correctly HELD
  round 3 [B|panic] seq=[started:deck_10, CANCELLED:deck_10]
                    liveSwap=null     uiWedged=false   ← lock correctly RELEASED
  ```

  **No stale-unlock was ever observed** across 12 rounds (3 runs), including
  every round that produced the dangerous `CANCELLED(A) → started(B)` interleave.
  Structural reason: `cancelDeckPatternSwap()` broadcasts **synchronously**
  inside the cancelling handler, so a cancelled-complete for A can never
  overtake a later `deckSwapStarted` for B on the same ordered socket.

  Note the client does **not** discriminate on `transitionId` — any
  `deckSwapComplete` clears the lock. That is safe *today* only because of the
  ordering guarantee above plus the 409 guard. Recorded as a latent fragility,
  not a defect (see Notes).

Evidence: `p3_final.png`. **One harness false-alarm was chased and dismissed:**
the first two p3 runs reported "final tap POSTs: 0". Instrumenting
`document.elementFromPoint` showed the harness had picked a row scrolled *out of
its ScrollView's clip* (rect at y=186, i.e. up in the header) — the tap landed
on the header, not the row. `p3_final.png` shows the list fully bright and
enabled at that moment, and `p3tail.cjs` proved post-PANIC taps POST normally
(baseline=1, postPanic=1, postPanic2=1). Adding a hit-test to the tap helper
made p3 pass. **Product behaviour was never at fault** — flagging it because
`repro.cjs` / `verify_fix.cjs` share the same un-hit-tested row picker and could
produce the same false negative on a scrolled list.

## Probe 4 — regression sanity — **PASS**

`repro.cjs` (`_14`'s own harness, unchanged) against the local engine:

| Scenario | Result |
|---|---|
| **S1** TX-OFF tap→highlight, 5 taps | **22.8 / 31.0 / 31.8 / 32.8 / 47.2 ms** (first tap is cold-start); 5/5 POSTs; no dim rows after. In/under the 30-50 ms band, criterion ≤ 60 ms. |
| **S2** TX-ON crossfade | mid-fade dim ancestor **0.55** + `aria-disabled=true` still present (**by design, unchanged**), clears on completion. Tap→highlight 42.8 ms. |
| **S3** PANIC mid-fade | `["deckSwapStarted","deckSwapComplete"]`; rows `aria-disabled=null`, no dim ancestor; post-PANIC TX-OFF tap → **1 POST**. |
| **S4** row disabled while finger down | opacity 0.6 held → **1** after release. |
| **S5** chevron tap | **0** entry POSTs (no bubbling). |

| Suite | Result |
|---|---|
| `CaptainPad npx tsc --noEmit` | **clean** (exit 0) |
| `CaptainPad npx vitest run` | **803 passed** / 6 skipped, 38 files — matches `_15` |
| `marsin_engine npm test` | **2 202 pass / 8 fail** — see note below |

**The engine fail count is 8, not the 7 `_15` reported.** The extra one is
`tests/timeline/timeline_deck_release_default_cue.test.js`, failing with the
**same** node-test-runner env error as the already-known
`effects_v2_mode_page_layout.test.js` (`Unable to deserialize cloned data due to
invalid or unsupported version` — a worker-IPC failure, not an assertion).
Verified it is **not** caused by this fix: the file is tracked and unchanged
(last touched by commit `c6eaa733`, July 11), it imports only
`timeline/timeline_service.js` + `timeline/show_plan.js` (never `pattern_mixer`
or `api_server`), and it **fails identically when run in isolation**. So: 8 fails
= 8 known-env fails, 0 assertion failures, **no new failures from the fix**.
`_15`'s "exactly 7" was an undercount of a flaky-by-environment worker error.

HIL `tests/hil/hil_deck_swap_test.mjs` **not run** — no rig up, same as `_15`.

## Probe 5 — show machine (titanic-ext, 10.x.x.151) — **HEALTHY**

### Health

| Check | Result |
|---|---|
| `/status` | `renderHealth {ok:true, blendErrors:[]}`, `activeScene/Model=test_bench`, `modelStale=false`, `deckRestoreDegraded=null`, `unrealState=streaming` |
| Supervisor `boot_status.yaml` | `restart_count: 0`, `last_exit_code: null`, `last_start 2026-07-27T17:19:22` — **no restart loop** |
| Sim `:6969` | HTTP 200 |
| Pattern list | **68 patterns**, load fine — including the parked R2 residue `60_white_wash, 61_white_breathe, 62_white_shimmer, 63_white_chase, 64_temple_warm_white, 65_uv_only` |
| Playlists | 14, including the parked themed ones (`temple_white`, `white_only`, `white_wednesday`, `uv_test`, `first_class_1912`, `tutu_tuesday`, `iceberg_ahead`, `party_high/low`, `burn_night`, `deep_sea`) |
| Current-session log (121 KB / 17 min — no spam) | Only errors are **VSN1 grid layout deploy** failures (`Action string is 5960 chars; device limit is 909`) — a Monogram/VSN1 issue, **unrelated** to this fix or to R2. Zero sACN send errors, zero compile errors (the 21 "compile" hits are all successful `[Mixer] Compiled blend script: trans_*` lines). |
| Patterns 60-65 in the log | 6 hits, **all successful sim `GET /marsin_engine/patterns/6x_*.js`** — no error, no retry loop. |

**Verdict on the parked R2 residue: it causes no live problem.** The new
patterns and playlists load and sit inert; nothing references them at runtime
(the deck is on `00_golden_hour_wash` from the `slow` playlist) and nothing in
the logs errors on them.

### Wedge fix reproduced against the REMOTE engine

`:7167` web client with `API_BASE=http://10.x.x.151:6968`, 5 000 ms fade:

```
remote prior transition-config: {enabled:false, mode:"trans_wave_sweep", durationMs:2000}
[WS] deckSwapStarted  {transitionId:"deck_1_1785199192395", durationMs:5000}
     mid-fade wedged=true (aria-disabled=true, dim 0.55)
     PANIC on REMOTE: 200
[WS] deckSwapComplete {cancelled:true, transitionId:"deck_1_1785199192395"}
     HEAL: 8 ms       post-heal tap: 1 POST
```

**The fix is demonstrably live on the show machine.** Evidence:
`p5_remote_midfade.png`, `p5_remote_healed.png`, `p5_remote_posttap.png`.

### Remote left as found

`transition-config` restored to `{enabled:false, trans_wave_sweep, 2000}`;
master restored from PANIC's 1.0 back to **0.9212598425196851** (`PATCH /mixer
{master}`); deck restored to `00_golden_hour_wash` (playlist `slow`, entry
`e_1783728658515_6963`). Final `/status`: `renderHealth ok, blendErrors []`.
PANIC's other transient effects (solo clear, bump clear) were already at
defaults. No deploy, no restart, no git op on the remote.

---

## Notes (non-blocking; for the coordinator, not a re-open)

1. **Pre-existing operational hazard on titanic-ext, NOT from this fix:** the
   09:18–13:29 session log is **88 MB**
   (`\\<show-machine>\titanic\logs\boot_server_20260727_091825.log`). Its tail is
   ~100 % `[sACN Out] Send error (U10/U12): send EHOSTUNREACH 10.x.x.202:5568`
   — the Titanic-202 controller was unreachable and the engine logs **every**
   failed send at 40 fps × 2 universes, unthrottled. On playa that fills a disk.
   Zero such errors in the current session (controller reachable). Worth a
   Notion backlog card: rate-limit / dedupe sACN send-error logging.
2. **Latent fragility (design, not a bug today):** the client clears
   `deckSwapInFlight` on *any* `deckSwapComplete`, ignoring `transitionId`.
   Correctness rests on (a) synchronous in-order broadcast and (b) the 409
   swap-over-swap guard. If either ever changes — e.g. a cancel deferred to a
   render tick, or the 409 relaxed to a queue — a stale cancelled-complete
   would unlock a live swap. A two-line `transitionId` match in the
   `deckSwapComplete` branch of `index.tsx` would make it structurally safe.
3. **Cosmetic:** the watchdog callback (`index.tsx:511`) calls
   `setDeckSwapInFlight(false)` but does not null `swapWatchdogRef.current`, so
   the ref holds a fired timer id until the next started/complete. Harmless
   (`clearTimeout` on a fired id is a no-op) — noting only for tidiness.
4. **Harness note:** `repro.cjs` and `verify_fix.cjs` pick tap targets without a
   `document.elementFromPoint` hit-test, so on a scrolled playlist they can
   "tap" a clipped row and report a false 0-POST. Fixed in my
   `probes.cjs`; the two older scripts still have it.
5. `pattern_mixer.js`'s cancel docstring mentions "when the engine shuts down
   mid-fade", but `engine.js`'s `shutdown()` never calls
   `cancelDeckPatternSwap()`. Harmless (clients are disconnecting anyway) —
   just a comment that overstates coverage.

## Housekeeping

- Local engine started + **stopped**; `:6968` quiet.
- `marsin_engine/states/` snapshotted byte-for-byte before the engine started
  and **restored** after: `diff -rq` against the snapshot is clean, and
  `git diff --stat marsin_engine/states/` is back to the pre-session baseline
  (7 files, 397 insertions, 427 deletions) — restored from my own snapshot,
  **not** via git.
- **No git operations. No source files edited.** Everything scratch lives in
  `~/tmp/swap_wedge_validation/`.
- All verification is headless-Chrome touch emulation, not real iPad Safari;
  the fix is at the WS-protocol / React-state level so it is
  browser-independent, but the operator's separate "snappy" complaint (root
  cause 2, the 5 Hz whole-tab re-render) remains untouched and will still be
  felt on the real iPad.
