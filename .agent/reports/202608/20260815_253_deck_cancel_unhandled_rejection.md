# `_253` — a cancelled Deck transition was KILLING the engine mid-show

`_248`'s full engine run left 35 reds. It diagnosed 11 (mixer/bump) as
`_243`'s `pattern_mixer.js` being rewritten mid-run and 6 as pre-existing
model-lint/ambient, but flagged **18 special-events tests dying on an
unhandled rejection `Deck transition … was cancelled`, reproducing in
isolation**. This report is the root cause, the verdict, and the fix.

**Verdict: REAL RUNTIME DEFECT, show-critical.** Not a harness artefact. The
engine's own `unhandledRejection` handler (`engine.js:1376`) prints
`⛔ ENGINE FATAL` and `process.exit(1)`. The 18 reds were not 18 assertion
failures — they were **one engine process dying and 18 subsequent requests
hitting `ECONNREFUSED`**. On the playa this is: *ABORT the Baby Reveal (or
the wedding) while a deck crossfade is in flight → the whole rig goes down.*

## Reproduction

```bash
cd marsin_engine
node --import ./tests/helpers/setup_config_guard.mjs --test \
     --test-concurrency=1 "tests/special_events/*.test.js"
# before: tests 109 · pass 91 · fail 18
```

The suites already black-hole their sACN (`--dest 192.0.2.x`, TEST-NET-1)
and sit at `:17230`/`:17231`, so nothing near the operator's 6966-6972 +
5568 band was touched. Confirmed in the log:

```
🎈 [special-events] "rotating_show" ENDED — aborted
[Deck] transition deck_1_… failed: Deck transition 'deck_1_…' was cancelled
⛔ ENGINE FATAL — unhandledRejection: Error: Deck transition '…' was cancelled
    at Object.onCancel                      (lib/api_server.js:2983)
    at PatternMixer.cancelDeckPatternSwap   (lib/pattern_mixer.js:2966)
    at morphToLook                          (lib/api_server.js:3681)
    at Object.recallSnapshotFade            (lib/api_server.js:6828)
    at SpecialEventsService._endRun         (lib/special_events/special_events_service.js:1003)
    at SpecialEventsService.abort           (…:943)
⛔ Exiting(1) with diagnosis rather than running half-alive
```

## Root cause

Three facts collide.

1. **A cancelled deck swap REJECTS.** `loadPlaylistEntryWithTransition`
   hands the mixer an `onCancel` that does `rejectDone(err)` with
   `err.code = 'ECANCELED'`. Cancellation is *routine and deliberate* —
   PANIC, a look/snapshot morph (`morphToLook` → `mixer.cancelDeckPatternSwap()`),
   a newer swap, and **every special-event FINISH/ABORT restore** cancel an
   in-flight fade on purpose.

2. **`timelineLoadPlaylistOnDeck` became `async` and now AWAITS that
   promise.** At `HEAD` this function is **synchronous** and its comment is
   explicit: *"The returned `done` promise is intentionally NOT awaited: the
   fade runs in the background."* The working tree (uncommitted; `git log -S`
   finds nothing, and `lib/special_events/` is untracked entirely) rewrote it
   as `async` with `await activeDeckSwapDone` + `await result.done`, so the
   Timeline could serialize behind an active swap. Correct for the Timeline —
   but it changed the function's failure surface for **every** caller.

3. **Two callers invoke it FIRE-AND-FORGET**, and the async rewrite silently
   deleted their error handling:
   - `SpecialEventsService._applyAction` case `'playlist'` →
     `this.deps.activatePlaylist(...)`. A show may never wait out a fade
     (FIRE has to answer the tab immediately), so it cannot await — the
     promise has **no caller to reject onto**.
   - the panel-deadman `revertToAutomaticShow` → `step('playlist', …)`, whose
     `step` helper is a **synchronous** try/catch. Once the callee went
     async, its documented `'playlist not found'` / `'has no loadable
     entries'` throws stopped being catchable there.

`done` itself always had a baseline `.catch` (hence the `[Deck] transition …
failed` line), so `done` was never the unhandled promise — the **async
function's own promise** was. Net effect: a routine cancellation became a
fatal unhandled rejection, and any genuine deck-load failure in those two
paths became one too.

## The fix (3 hunks in `lib/api_server.js`, 1 in the special-events service)

**A — cancellation is an expected outcome, not a rejection.** New helper next
to `deckSwapInFlightReason`:

```js
async function settleDeckTransition(promise) {
  try { await promise; }
  catch (error) { if (!error || error.code !== 'ECANCELED') throw error; }
}
```

`timelineLoadPlaylistOnDeck` now routes **both** awaits through it. This is
**not a fallback** and nothing is masked: it absorbs exactly one
self-issued sentinel that this file itself creates, and every other rejection
(compile error, `onComplete` bookkeeping failure) propagates untouched. The
semantic is honest — the caller that asked for the load has been superseded
by a *later authoritative action*, so its await must settle, not fail.

**B — the baseline handler stops calling a supersession a failure.** The
unawaited `done.catch` logged `[Deck] transition … failed` on every cancel;
a show would print a red line at every handover. Cancellations now log
`transition … cancelled (superseded)` via `console.log`; `console.error` is
reserved for something that actually broke.

**C — the two fire-and-forget callers get their error handling back.**
`revertToAutomaticShow` attaches the *same warning `step` used to print*, so
one bad playlist can't abort the remaining revert steps (least of all step 1,
"light the ship"). `_applyAction`'s `'playlist'` case routes a rejection into
the runner's existing loud contract — `lastError` on the wire, a
`console.error`, a `_broadcast()` — identical to what
`_scheduleActionTimer`'s catch already does for a *delayed* action. Loud and
operator-visible, never silent, and never fatal to the rig.

**D — the contract test is updated and extended.**
`tests/mixer/deck_transition_path_contract.test.js` pinned the old source
text (`await activeDeckSwapDone;`) and correctly went red on the fix; it now
pins the `settleDeckTransition` shape plus two new tests: that ECANCELED —
**and only** ECANCELED — is absorbed, and that the baseline handler
distinguishes a cancellation from a failure. 6/6.

## Verification (all `--test-concurrency=1`)

| Suite | Before | After |
|---|---|---|
| `tests/special_events/` | 109 · **91 pass / 18 fail** | 109 · **109 pass / 0 fail** |
| `tests/timeline/` | — | 445 · **445 pass / 0 fail** |
| `tests/effects/` | — | 732 · 730 pass / **2 fail (foreign)** |
| `tests/mixer/` | 613 · 597 pass / 16 fail | 615 · 600 pass / **15 fail (foreign)** |
| `tests/mixer/deck_transition_path_contract` | 5 · 1 fail (mine) | **6 · 6 pass** |

`node --check` on both edited files; `node engine.js --pattern test_const
--model test_bench --dry-run` clean.

**The 11 mixer/bump reds `_248` attributed to `_243` are STILL RED** — re-run
as asked, not touched. They are 10 in `tests/mixer` (8 `follow_link`, the
render-health test, `triggerMixerTransition clears the solo set`) + 1
`tests/effects/bump_flash`, and they fail inside `PatternMixer` itself
(`No compiled blend handle for mode 'blend_screen' on channel 'L'`;
`solo cleared when a transition begins` 1 !== 0). Nothing in this fix reaches
`pattern_mixer.js`.

Remaining foreign reds, unchanged by this work:
- **5** `dev_test_bench` model-lint (the pre-existing ambient set).
- **1** `tests/effects/touch_control_wire_layers_contract` — asserts on
  `CaptainPad/app/(tabs)/touch.tsx`, which `_252` is rewriting right now
  (its own comment names report `_252`). Expected churn.

## Gate

**ENGINE RESTART REQUIRED.** The live `:6968` process still carries the
crash: an ABORT/FINISH of a special event over an animating deck crossfade
takes it down. Nothing else moves — no schema, no YAML, no wire change, and
no client needs rebuilding.

## Follow-up worth someone's attention

`timelineLoadPlaylistOnDeck` going async changed the failure surface of
**every** call site, and only the Timeline's own `await` was updated to match.
The two that were missed are fixed here; a sweep for other sync→async
conversions in this file with fire-and-forget callers would be cheap
insurance, because the failure mode is a *fatal engine exit* rather than a
visible error.
