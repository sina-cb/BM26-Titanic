# 2026-07-25_17 — Hardening mini-wave: sACN log throttle + transitionId match

**Role:** developer. Source: `_16` §Notes 1 (88 MB log) and 2 (client clears
the deck-swap lock on ANY complete). Both closed, validated and deployed.

**Verdict: both items DONE. titanic-ext `DEPLOY OK`.**

---

## Item 1 — per-destination throttling of DMX transmit-error logging

### The bug

`marsin_engine/lib/sacn_output.js:81` logged **every** failed send:

```js
}).catch(err => {
  if (_started) console.error(`[sACN Out] Send error (U${uid}):`, err.message);
})
```

At 40 fps × 2 universes an unreachable controller produced ~80 lines/second —
the titanic-ext 09:18–13:29 session log hit **88 MB**. On playa that fills the
disk with nobody around to rotate it. `lib/artnet_output.js:187` had the
identical shape.

### The fix

**New: `marsin_engine/lib/send_error_throttle.js`** (129 lines) —
`createSendErrorThrottle({ prefix, intervalMs = 30000, logger, now })`
returning `{ noteError, noteSuccess, hasFailures, reset }`, keyed per
destination (`U10 → 10.x.x.202`). `logger` and `now` are injected so the
behaviour is unit-testable without sockets or real time.

**This is throttling, NOT hiding** (codex P0 — fail loudly). Four guarantees:

1. the **first** error for a destination logs immediately, in full;
2. a **change of error class** for that destination logs immediately too,
   naming the previous one (`EHOSTUNREACH → ENETUNREACH` is new information);
3. while the same failure persists, one **summary** line per destination per
   30 s: how long it has been down, the current error, how many errors were
   suppressed, and the running total — so a `tail` of the log at any moment
   still shows the box is broken;
4. the first success after a streak logs a **RECOVERY** line with outage
   duration and error count, and resets the state (the next failure logs
   immediately again).

No error is ever silently dropped: every suppressed one is counted and that
count appears in the next summary or recovery line.

### Call sites

| File | Change |
|---|---|
| `marsin_engine/lib/sacn_output.js:10,34-38,44,55,87-96,111` | import; `senders[uid]` entries became `{ dest, sender }` so the throttle key can name the **destination** (the old line only had the universe); `.then(ok, err)` → `noteSuccess` / `noteError`; `reset()` in `stop()` |
| `marsin_engine/lib/artnet_output.js:35,155-157,190-199,215` | same throttle, prefix `[Art-Net Out]`, in the `socket.send` callback |

Hot-path cost: the success branch is guarded by `sendErrors.hasFailures()`, so
the all-healthy 40 fps path does **zero** map lookups. Public surface of both
senders (`start/stop/sendFrame/addUniverse/frameCount`) is unchanged;
`senders` was closure-local, so no other module is affected.

### Live proof

Real `createSacnOutput`, 2 universes → `0.0.0.1` (the one address on this box
that reliably yields a send error: `ENETUNREACH`), 40 fps for 65 s.
**5 240 failed sends → 6 log lines.** Full output:

```
[sACN Out] Sender started — 2 universe(s), priority 100, destinations [0.0.0.1]
[sACN Out] Send error U10 → 0.0.0.1: send ENETUNREACH 0.0.0.1:5568 — further identical errors throttled to one line per 30s
[sACN Out] Send error U12 → 0.0.0.1: send ENETUNREACH 0.0.0.1:5568 — further identical errors throttled to one line per 30s
[sACN Out] Send to U10 → 0.0.0.1 failing for 30s: send ENETUNREACH 0.0.0.1:5568 (1176 errors suppressed since the last line, 1178 total)
[sACN Out] Send to U12 → 0.0.0.1 failing for 30s: send ENETUNREACH 0.0.0.1:5568 (1176 errors suppressed since the last line, 1178 total)
[sACN Out] Send to U10 → 0.0.0.1 failing for 60s: send ENETUNREACH 0.0.0.1:5568 (1177 errors suppressed since the last line, 2356 total)
[sACN Out] Send to U12 → 0.0.0.1 failing for 60s: send ENETUNREACH 0.0.0.1:5568 (1177 errors suppressed since the last line, 2356 total)
[sACN Out] Sender stopped after 2620 frames
```

Pre-fix that window is 5 240 lines. Extrapolated: the 88 MB / 4 h case becomes
~2 lines/minute/destination, i.e. a few KB/day. Scratch harness lives in
`~/tmp/sacn_throttle/`; both demo processes exited (nothing left running, no
ports bound).

### Tests

**New: `marsin_engine/tests/io/send_error_throttle.test.js`** — 9 tests, all
green:

- prefix is mandatory (no silently-untagged logger);
- first error logs immediately, in full;
- **the burst case**: 9 601 errors at 40 fps over 240 s → exactly **9 lines**
  (1 immediate + 8 summaries), each summary asserting `failing for Ns` and the
  suppressed count;
- suppressed + logged counts sum to every error passed in (nothing lost);
- a new error class logs immediately, naming the previous one;
- recovery logs exactly one line, resets state, and the next failure logs
  immediately again;
- destinations throttle independently;
- `reset()` is silent (a sender stop is not a recovery);
- the default interval is 30 s.

---

## Item 2 — `transitionId` match in CaptainPad

### The fragility (`_16` note 2)

`index.tsx`'s `deckSwapComplete` branch cleared `deckSwapInFlight` on **any**
complete. Correct today only because `cancelDeckPatternSwap()` broadcasts
synchronously (so a cancelled-complete for A cannot overtake a later
`deckSwapStarted` for B) **and** the engine 409s swap-over-swap. Defer a cancel
to a render tick, or queue swaps instead of refusing them, and a stale complete
would unlock a live swap — re-enabling rows mid-fade.

### The fix

**`CaptainPad/components/deck_swap_watchdog.ts:47-79`** — new pure predicate
`deckSwapCompleteReleasesLock(storedId, completeId)`. Releases when the ids
match, **or** when no id is stored, **or** when the complete carries no usable
id. Ignores only the case where both are present and differ.

Both permissive cases are deliberate — without them the hardening would trade
one wedge for another:

- **no id stored** — the client mounted mid-fade or a WS blip ate
  `deckSwapStarted` (deckSwap events are not replayed on reconnect); it must
  still heal on the next complete;
- **no id on the complete** — an older engine or a broadcast path that omits
  it must never wedge the list.

The watchdog remains the backstop for the ignored case.

**`CaptainPad/app/(tabs)/index.tsx`**:

| Lines | Change |
|---|---|
| 11-14 | import the predicate |
| 340-345 | new `swapTransitionIdRef` |
| 406 | focus-effect cleanup nulls the id ref too |
| 517-530 | `deckSwapStarted` stores the id; the watchdog callback now also nulls **both** refs (closes `_16` note 3, the cosmetic un-nulled timer id) |
| 531-545 | `deckSwapComplete` releases the lock only when the predicate says so |

`lastSwapMode` still updates on every complete — that is display-only and must
not be gated.

### Tests

`CaptainPad/components/deck_swap_watchdog.test.ts` — 6 new tests in a new
`deckSwapCompleteReleasesLock` describe: match releases; **stale complete for a
superseded swap is ignored** (the `CANCELLED(A) → started(B)` interleave);
**missed-started heal** (`null`/`''` stored → any complete releases);
no-usable-id-on-the-complete heal across 9 junk shapes; exact matching (no
prefix/substring); always returns a boolean.

---

## Validation

| Suite | Result | Baseline |
|---|---|---|
| `marsin_engine` `npm test` | **2 217 pass / 7 fail**, 2 224 tests | `_16` baseline 8 known-env fails. This run: 5 × `audio_capture` (`device_not_configured`), 1 × `effects_v2_mode_page_layout` (worker-IPC `Unable to deserialize cloned data`), 1 × `osc_listener` (`bind EACCES`). The 8th (`timeline_deck_release_default_cue`) is the flaky worker-IPC one and **did not reproduce** this run. **0 assertion failures, 0 NEW failures.** |
| new throttle tests inside that run | 9/9 ✔ | — |
| `CaptainPad npx tsc --noEmit` | **clean** (exit 0) | clean |
| `CaptainPad npx vitest run` | **809 passed** / 6 skipped, 38 files | 803 + my 6 |
| `marsin_engine/states/` residue | **CLEAN** — `diff -rq` against a byte snapshot taken before the suite is empty; `git diff --stat` back at the 7 files / 397 ins / 427 del baseline | — |

No engine was booted for a live session (the throttle demo drives
`createSacnOutput` directly, which touches no state files); the snapshot was
taken anyway as a guard against the test suite.

## Deploy

```
python deploy/deploy.py deploy --machine titanic-ext --scene test_bench
...
  engine ok: activeModel=test_bench
  sim ok: http://10.x.x.151:6969/simulation/
  supervisor ok: restart_count stable at 0 (no restarts; scene 'test_bench', host 'TITANIC-EXT')

DEPLOY OK: titanic-ext is running test_bench from e805ef01.
```

Same caveat as `_15`: the deploy `robocopy /MIR`s the whole dirty tree, so the
**parked R2 pattern residue shipped again** (`_16` confirmed it is inert — the
patterns load and sit unused).

Metro `:6967` never touched. CaptainPad edits are compile-clean (tsc exit 0),
so any hot-reloading client picks them up without a broken bundle.

## Follow-ups (not done, not blocking)

- **Log rotation/retention** for `boot_server_*.log` on the show machines is
  still unaddressed — this wave removed the pathological writer, not the
  absence of a retention policy. Worth a Notion backlog card for R5.
- `_16` notes 4 (`repro.cjs` / `verify_fix.cjs` tap helpers lack a
  `document.elementFromPoint` hit-test) and 5 (`pattern_mixer.js` cancel
  docstring overstates shutdown coverage) remain open — both harness/comment
  only.

## Housekeeping

- No git operations. Scratch in `~/tmp/sacn_throttle/` only.
- No local process left running; no ports bound.
- Master doc `.agent/projects/bm26_show_readiness.md` updated: R5 row (throttle
  closed + deployed), R6 row (transitionId hardening closed), one Log line.
