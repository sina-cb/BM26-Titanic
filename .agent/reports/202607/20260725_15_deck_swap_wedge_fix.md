# 2026-07-25_15 — Deck-swap WEDGE fix (dim/dead pattern list): implementation

**Role:** developer (fix agent). Pipeline: report `_14` (Fable, debug) → **this
fix** → separate validator.
**Fixes:** report `.agent/reports/202607/20260725_14_pattern_switch_lag_debug.md`
→ MINIMAL FIX PLAN, executed verbatim. Root cause 1 only.
**Explicitly NOT done** (filed as follow-ups by `_14`, out of scope here): the
5 Hz whole-tab viz re-render, and the "taps ignored during crossfade" toast.

## The bug, in one line

While `deckSwapInFlight` is true, CaptainPad's deck playlist renders at opacity
0.55 with **every row disabled and every tap swallowed client-side (0 POSTs)**.
The flag was cleared **only** by a `deckSwapComplete` WS event — and the engine's
`cancelDeckPatternSwap()` dropped in-flight swaps **silently**, never emitting
one. Any cancel (PANIC, snapshot/look morph kickoff, deck channel
remove/replace, or a plain WS blip between started and complete) therefore
wedged the list permanently: dim, dead, taps swallowed, until a tab switch
remounted it. The **engine was never wedged** — MIDI/APC/autopilot kept
switching the lights normally, which is exactly the operator's "the lights
switch fine but the list is weird and dim, sometimes".

## What changed

### Fix 1 — engine: notify on cancellation (kills the wedge at the source)

| File | Lines | Change |
|---|---|---|
| `marsin_engine/lib/pattern_mixer.js` | 603 | New `this.onDeckSwapCancelled = null;` beside `onDeckSwapComplete`. |
| `marsin_engine/lib/pattern_mixer.js` | 2431–2452 | `cancelDeckPatternSwap()` captures `const cancelled = this._swapTransition;` before nulling, and after the fader reset fires `onDeckSwapCancelled({ transitionId: cancelled.id })` in a try/catch, mirroring the `onDeckSwapComplete` invocation at ~2565. |
| `marsin_engine/lib/api_server.js` | 3519–3532 | Wiring: `mixer.onDeckSwapCancelled = ({ transitionId }) => broadcastWs({ type: 'deckSwapComplete', cancelled: true, transitionId })`, placed with the other mixer callback wiring (right after `onTransitionComplete`, where both `mixer` and `broadcastWs` are in scope). |

Deliberately **reuses** the existing `deckSwapComplete` type (already routed to
CONTROL at `ws_topic_routing.js:90`) so every existing client — CaptainPad deck
tab, HIL specs — heals with **zero client-side change**; `cancelled: true` is
purely additive. The swap's own `onComplete` closure is **not** called (that
would commit the cancelled target).

One subtlety worth knowing: `triggerDeckPatternSwap()` drops a prior in-flight
transition **inline** (`pattern_mixer.js:2352-2354`), not via
`cancelDeckPatternSwap()`. That path therefore emits **no** cancelled event —
correct, because a fresh `deckSwapStarted` is broadcast microseconds later and a
racing cancelled-complete could clear the client's lock for a swap that IS
running. Pinned by a test.

### Fix 2 — CaptainPad: watchdog (belt and braces vs WS blips)

| File | Lines | Change |
|---|---|---|
| `CaptainPad/app/(tabs)/index.tsx` | 336 | `swapWatchdogRef` timer ref beside `deckSwapInFlight`. |
| `CaptainPad/app/(tabs)/index.tsx` | 507–513 | `deckSwapStarted` branch: clear any prior timer, arm a new one for the broadcast's own `durationMs + 2 s`. |
| `CaptainPad/app/(tabs)/index.tsx` | 515–522 | `deckSwapComplete` branch: clear the timer, then the existing `setDeckSwapInFlight(false)`. |
| `CaptainPad/app/(tabs)/index.tsx` | 390–398 | `useFocusEffect` cleanup also clears the timer. |
| `CaptainPad/app/(tabs)/index.tsx` | 11 | Import of the delay helper. |
| `CaptainPad/components/deck_swap_watchdog.ts` | new | Pure `deckSwapWatchdogDelayMs(durationMs)` + the two constants. Extracted only so vitest can pin it in plain Node — repo convention, same posture as `deck_tx_logic.ts`. Non-finite / negative / non-number payloads fall back to 5 000 ms rather than arming a NaN timer (a NaN delay makes `setTimeout` fire in ~1 ms, which would clear the lock mid-fade — strictly worse than the dim). |

Fix 2 covers what Fix 1 structurally cannot: a WS drop **between** started and
complete. `deckSwap*` events are not in the reconnect replay set
(`ws_topic_routing.js`), so nothing else would ever release the lock.

### Tests added

- `marsin_engine/tests/mixer/deck_swap_cancel_notify.test.js` (new, **9 tests**,
  all pass): cancel fires once with the right `transitionId`; cancel does NOT
  run the per-swap `onComplete` nor `onDeckSwapComplete` and leaves the deck on
  the pre-swap pattern; no-op when nothing is in flight; idempotent under
  repeated calls; **PANIC mid-fade** and **removeDeckChannel mid-fade** both
  notify; a throwing listener cannot break the cancel path; swap-over-swap does
  NOT notify; a landed swap fires complete and never cancelled.
- `CaptainPad/components/deck_swap_watchdog.test.ts` (new, **5 tests**): delay =
  duration + slack; strictly greater than the fade for every duration (never
  fires early); fallback for absent / NaN / Infinity / negative / string /
  object payloads; always a finite positive number.

## Repro — before vs after

Harness is the report's own, unchanged: `~/tmp/pattern_switch_debug/repro.cjs`,
iPad-10 landscape (1180x820, `hasTouch`), **fresh** `npx expo export
--platform web -c` dist on `:7167` (bundle hash verified served, and verified to
contain the watchdog symbols), LOCAL engine `node engine.js --model test_bench
--pattern 01_cylon_sweep` on `:6968`. The operator's Metro on `:6967` was never
touched. Scenario S3 = TX ON 4 s → tap a row → `POST /mixer/panic {home:false}`
at +800 ms → wait 5 s.

| S3 assertion | Before (report `_14`) | After (this run) |
|---|---|---|
| WS events since tap | `["deckSwapStarted"]` | `["deckSwapStarted","deckSwapComplete"]` |
| Rows `aria-disabled` at +5 s | `true` | `null` |
| Dim 0.55 ancestor at +5 s | present | `[]` (none) |
| Post-panic TX-OFF tap | **0 POSTs — swallowed** | **1 POST** |

Non-regression from the same script: **S1** touch→highlight **29.6–33.9 ms**
across 5 taps (was 46–52 ms; criterion ≤ ~60 ms), 5/5 POSTs; **S2** mid-fade dim
still present at 0.55 with `aria-disabled=true` (the by-design transient is
**intentionally unchanged**) and clears on completion; **S4** row opacity back
to 1 after release; **S5** chevron tap fires 0 entry POSTs (no bubbling).

### Each fix isolated

`~/tmp/pattern_switch_debug/verify_fix.cjs` (written this session) runs the wedge
scenario twice with a 4 000 ms fade — watchdog window 6 000 ms. Scenario B
suppresses `deckSwapComplete{cancelled:true}` **inside the page** (a patched
`WebSocket` that drops exactly that message), simulating the WS blip / the
engine fix being absent, so only the watchdog can save it:

| Scenario | Mid-fade wedged? | On-the-wire | Heal | Post-heal tap |
|---|---|---|---|---|
| **A — both fixes** | yes (0.55 + disabled, by design) | `deckSwapComplete{cancelled:true, transitionId:"deck_5_…"}` | **17 ms** | 1 POST |
| **B — watchdog alone** | yes | cancelled-complete dropped in-page | **5 304 ms** (armed at started, panic at +700 ms → fires at 6 000 ms from started) | 1 POST |

`==> PASS`. Both alone are sufficient; together the heal is instant.
Screenshots: `~/tmp/pattern_switch_debug/s3_after_fix_healed.png` (list fully
bright, active row highlighted post-PANIC) and `s3_after_fix_tap_works.png`.
Note `repro.cjs` overwrites `s3_stuck_dim.png` / `s3_tap_swallowed.png` each
run, so those two filenames now hold the **healed** state — the pre-fix images
they refer to in report `_14` no longer exist on disk.

## Test totals

| Suite | Result |
|---|---|
| `marsin_engine` `npm test` | **2 205 pass / 7 fail**, 0 skipped. The 7 are the known env fails only — 5 audio-capture (`device_not_configured`, no mic on this box), `osc_listener` EADDRINUSE-vs-EACCES, and the `effects_v2_mode_page_layout.test.js` worker deserialize error. **No new failures.** |
| `CaptainPad` `npx tsc --noEmit` | **clean** (no output) |
| `CaptainPad` `npx vitest run` | **803 pass** / 6 skipped, 38 files — 798 baseline + my 5 |

Counts run higher than the brief's stated baselines (2 148 / 798) because other
agents landed tests in this shared worktree during the session; the meaningful
invariant — **fail count still exactly 7, all known-env** — holds.

## Deploy

`python deploy/deploy.py deploy --machine titanic-ext --scene test_bench` →
**`DEPLOY OK: titanic-ext is running test_bench from e805ef01.`** Engine
`activeModel=test_bench`, sim up on `:6969`, supervisor `restart_count` stable at
0. Fix confirmed present in the deployed tree over the share
(`onDeckSwapCancelled` ×4 in `pattern_mixer.js`, ×1 in `api_server.js`,
`deck_swap_watchdog.ts` shipped).

## Honesty notes

- **The deploy shipped the whole dirty working tree** — the stamp reads
  `e805ef01 on feat/bm_readiness, 100 dirty file(s)`. `deploy.py` does a
  `robocopy /MIR` of the working tree, so **other agents' concurrent in-flight
  edits** (new patterns `60_*`–`65_*`, the party-detection work, new playlists,
  the CaptainPad live-UI wave) went to titanic-ext along with my two fixes. That
  is inherent to the deploy tool, not something I chose; flagging it because
  titanic-ext is now running more than this fix.
- **No git operations were run** (no add/commit/stash/checkout).
- Engine runtime residue: my repro switched patterns and ran the colour
  autopilot, dirtying `marsin_engine/states/test_bench/deck_state.yaml` and
  `globals_state.yaml`. I snapshotted `marsin_engine/states/` byte-for-byte
  **before** starting the engine and restored those two files from that snapshot
  after shutdown — `diff -rq` against the snapshot is now clean and
  `git diff --stat marsin_engine/states/` is unchanged from pre-session (7 files,
  397 insertions, 427 deletions). Restored from my own snapshot, **not** via git.
- The local engine on `:6968` was started and stopped this session; port
  confirmed quiet afterwards. `:7167`'s static `serve` (left over from report
  `_14`'s session) was reused to host the freshly rebuilt dist — I verified the
  served bundle hash matches the new `dist/` and contains the watchdog code.
  `CaptainPad/dist/` was rebuilt (gitignored).
- All verification ran in headless Chrome touch emulation, **not** real iPad
  Safari. The root cause and both fixes are at the WS-protocol / React-state
  level, so they are browser-independent, but the operator's original "snappy"
  complaint (root cause 2, the 5 Hz re-render) is untouched by this work and
  will still be felt on the real iPad.

## For the validator

- The by-design transient dim during a real fade is **unchanged and intended** —
  do not read S2's mid-fade 0.55 + `aria-disabled=true` as a regression.
- Worth probing: the **non-PANIC** cancel callers, which I covered by unit test
  but not end-to-end — snapshot/look-recall morph kickoff
  (`api_server.js:2967`) and deck channel remove/replace
  (`pattern_mixer.js:1597`).
- Worth probing: a **real** WS drop mid-fade (kill/restart the socket rather than
  filtering the message in-page) to confirm the watchdog path end-to-end.
- Worth probing: rapid swap-over-swap spam, to confirm no cancelled-complete
  races a live `deckSwapStarted` and clears the lock early.
- HIL `tests/hil/hil_deck_swap_test.mjs` was **not** run (no rig up this
  session). Its test 2 (TX off → no started event) should be unaffected: the
  cancelled-complete can only fire when a swap was actually in flight.
