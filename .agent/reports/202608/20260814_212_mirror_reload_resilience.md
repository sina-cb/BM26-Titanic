# _212 — mirror reload resilience: silent bridge exits + engine sender realignment

Date: 2026-08-14
Branch: `feat/bm_readiness`
Scope: `simulation/server/sacn_bridge.js`, `simulation/server/sacn_output_bridge.js`,
`marsin_engine/lib/sacn_output.js`, tests.

Two linked incidents from one evening: a recurring **engine model reload
de-aligns the sACN senders** so the armed bench mirror refuses every frame until
the engine is restarted (class A, hit twice), and **two bridge processes each
exited `code=1` silently** (incident B). They turn out to be unrelated in cause
and identical in remedy shape: make the failure impossible to misread.

---

## 1. INCIDENT B — the silent `code=1` exits

### 1.1 What the log actually said

Two processes died, once each, at unrelated moments:

| Process | Line | Context |
|---|---|---|
| `sacn-in` (:6971 / :5568) | ~3082 | ~20 min into a stuck mirror, watchdog firing |
| `sacn-out` (:6972) | ~1077 | ordinary operation, no mirror activity, engine precompiling deck entries |

Both: `exited unexpectedly (code=1)`, restarted `1/5`, and **no other output** —
no stack, no `❌`, nothing. The `http` and `save` children were untouched both
times.

### 1.2 Ruling out every internal cause

**Output was not lost.** `start.js` spawns children with `stdio: 'inherit'`, so
they write straight to the launcher's own fds — the launcher's JS never touches
the stream and cannot drop it. Node's stdout/stderr to a **pipe is synchronous
on Windows**, and I verified it empirically rather than trusting the doc: a
child writing 6.3 MB to stderr against a deliberately slow reader and then
calling `process.exit(1)` lost nothing, marker line included. So the processes
genuinely printed nothing.

**Every in-process fatal path prints first.** All five `process.exit(1)` sites
in `sacn_bridge.js` (the two dependency guards, `rawDmxPayload`'s no-buffer
invariant, the fatal receiver error, the boot subscription invariant) emit a
`❌` line immediately before exiting. None appeared.

**An escaped throw prints too.** Verified on this box's Node v24.18.0: an
unhandled rejection from an unawaited async `setInterval` callback exits `code=1`
**with a full stack on stderr**. Not silent.

**The launcher did not kill them.** `watchdogTick` logs `health probe missed
(n/FREEZE_FAILURES)` and then `🧊 … is FROZEN … killing it` before `killTree`.
Neither line is anywhere in the log.

**The stuck mirror cannot do it.** Every structure on the stuck path is keyed by
destination or by universe — `_mirrorDirty`, `_mirrorRegionSeq` (inner map keyed
by source universe), `_mirrorEmitSeq`, `_mirrorIncompleteSince`,
`_mirrorStallWarned`, `_mirrorMisaligned`. Nothing accumulates per frame, so a
stall of 20 minutes costs exactly what a stall of one frame costs. Total log
volume for the whole session was ~1,900 lines (~1.4/s) — nowhere near an OOM
driver, and a V8 OOM prints `FATAL ERROR: … heap out of memory` and aborts
rather than exiting 1. This is now pinned by test (§3).

**And `sacn-out` has no internal cause at all.** It is 115 lines: a
`WebSocketServer` that refuses 519-byte frames. No sACN sender, no timers, no
state, no shared module with `sacn_bridge.js` beyond `load_ports.cjs` and `ws`.
Its only `process.exit` is `shutdown()` → `exit(0)`. There is no path in that
file that reaches `code=1` on its own.

### 1.3 Root cause

**Both processes were force-terminated from outside the launcher.** On Windows a
process killed by `taskkill /F` exits with **exactly `code=1`, `signal=null`, and
no output** — I reproduced this directly (`>>> victim exited code=1 signal=null`,
victim silent). That is a bit-for-bit match for both incidents, and it is the
only remaining explanation once §1.2 is applied.

The two victims are precisely the two `bridge: true` children, and precisely the
two holders of the sACN-family ports (`:5568`/`:6971` and `:6972`). A
port-freeing sweep or partial stack teardown from one of the concurrent sessions
on this box hits exactly those two and leaves `http`/`save` alone — which is the
observed pattern, twice, at unrelated moments and in unrelated activity
contexts. The stuck mirror is a **coincidence of timing** on the `sacn-in` case,
not a cause; the `sacn-out` case had no mirror activity at all and is the control
that proves it.

*Not claimed:* which command, or from which session. That is unknowable from the
log — which is the actual defect, and what §1.4 fixes.

### 1.4 What changed

**The real bug this hunt turned up** (a genuine process-killer, just not this
one). `readSceneTrees` parsed three scene YAMLs with a **bare `yaml.load`**
while its sibling `readSceneRoutePairs` had always guarded its own — a plain
oversight. It is called from `resolveMirrorFor` *above* that function's two
`try` blocks, and the whole chain runs on the **armed health check every
`ENGINE_POLL_MS` (3 s)**:

```
setInterval(pollEngineStatus, 3000)   ← unawaited async callback, no .catch()
  └─ recomputeRoutes('engine poll')   ← line 1122, OUTSIDE the function's try
       └─ resolveMirrorFor → readSceneTrees → yaml.load  ← THROWS
```

A scene file caught mid-write — an editor, or one of the concurrent agents
saving — becomes an unhandled rejection and kills the bridge, every 3 seconds,
while armed. Fixed at both ends: the parse is now a named refusal
(`ARM refused [R-16]: a scene declaration file could not be read — …`), and the
recompute reached from the async poll goes through `guardedRecompute`, which
routes a defect to the existing loud auto-disarm instead of out through the
timer.

**Last-resort handlers in BOTH bridges.** `unhandledRejection` and
`uncaughtException` now name the error with its stack and **exit nonzero** —
loud then dead, never loud-and-limping. Continuing on unknown state would be a
codex-forbidden fallback, and a wedged-but-responsive bridge is invisible to the
launcher's freeze watchdog (which only kills a server that stops *answering*).
Supervision is the recovery mechanism: it restarts within 1 s, escalates loudly
past budget, and a restarted bridge comes up **disarmed with the full ordinary
relay restored** — which is exactly the un-freeze the boxes need. On `sacn-in`,
if the mirror is armed the owned destinations take the bounded blackout first,
so they go dark deliberately rather than freezing on their last composed frame.

**The exit breadcrumb — the diagnostic that would have closed this in seconds.**
Both bridges now announce any exit they *chose*, via `fs.writeSync(2, …)`
(synchronous, because an `'exit'` listener cannot queue async work and these
paths end in `process.exit`). The line states what its own absence means:

> `process exiting on its own with code=N … If the launcher reports an exit
> WITHOUT this line, the bridge did not choose it — it was force-killed from
> outside.`

Self-exit and external kill are now distinguishable after the fact. They were
not, which is the whole reason incident B took an hour.

**Honest misalignment counts.** `_mirrorMisaligned` is deleted whenever a
destination composes one whole frame — correct for the stuck discriminator — but
`count` is also what the log prints, so a *flapping* destination re-entered at
`count === 1` every time: **1594 of 1627 lines each claimed to be the first**,
while nothing on screen revealed the same destination had failed hundreds of
times. A cumulative `_mirrorMisalignTotal` (per destination, cleared with it) now
rides along: `(1 frame(s) in this run, 437 for this destination since it was
composed)`.

*Considered and rejected:* making the log **throttle** survive realignment too.
It suppressed a genuinely new stall episode for up to 2 s and broke the
deliberate D-158-3 ruling that misalignment is reported *immediately*, caught by
`bench_mirror_arm.test.js`'s stalled-source test. Re-reading the incident, the
"flood" was only ~1.4 lines/s — the volume was never the problem, the *lying
count* was. Reverted to the immediate line, kept the honest total.

---

## 2. INCIDENT CLASS A — engine sender realignment

### 2.1 Why a model reload breaks the proof

The mirror composes one destination from several universes and proves they
belong to the same engine frame by requiring their **sequences to be equal**.
That proof caught real one-writer bugs and is untouched here — the defect is in
the sender lifecycle that was supposed to keep the premise true.

`sacn` v4.6.2 gives every `Sender` its own counter (`this.sequence`, init 0,
`(this.sequence + 1) % 256` per `send()`). Universes stayed aligned only by the
**accident** of having been constructed together and fed on every frame since.
An in-process hot reload breaks all three legs of that accident:

1. **New sender mid-run.** `engine.js` `registerUniverse` (2041-2051) is purely
   additive and `addUniverse` no-ops for known universes, so a newly mapped
   universe gets a fresh `Sender` starting at 0 while its siblings are mid-count.
   Both wrap mod 256 at the same rate, so the delta **never closes**.
2. **Dark-then-revived.** The prune block (2053-2083) splices a universe out of
   `universeIds` but never closes its sender; the render loop only iterates
   `universeIds`, so its counter freezes and it returns offset by exactly the
   frames it missed.
3. **The blackout burst.** Lines 2077-2079 fire 3 extra packets on the de-mapped
   universe alone — an instant +3 skew.

`Sender` exposes no constructor or per-packet sequence option, and `close()` does
not persist the counter.

### 2.2 Mechanism chosen: one engine-frame sequence, stamped at send time

Not (a) carry-forward and not (b) recreate-all — both patch individual legs and
leave the property dependent on sender lifetime. Instead the sequence becomes an
**engine-frame identity rather than a per-sender one**: `sendFrame` takes one
counter, stamps it onto every sender it is about to use, and advances it once per
frame.

```js
const seq = _frameSequence;
_frameSequence = (seq + 1) % 256;
…
sender.sequence = seq;      // read synchronously by this datagram
sender.send({ payload, sourceName, priority });
```

Why this one:

- **Alignment stops being an accident.** All three failure legs above are
  immune, because stamping happens at *send* time, not creation time — it does
  not care when a `Sender` was built, how long it was dark, or how many
  out-of-band frames it took. It also makes the mirror's premise true *by
  construction* rather than by coincidence, which is a stronger guarantee than
  the bug it fixes.
- **The proof is untouched.** Nothing in the verifier changed; the fix is
  entirely in the sender lifecycle, where the mission put it.
- **Still legal E1.31.** Per-universe values advance strictly forward and wrap
  mod 256. A universe skipped for some frames jumps forward, which receivers
  accept — only a repeat or a small backward step is discarded. The de-map
  blackout burst still gets three *distinct* increasing sequences, because each
  `sendFrame` call advances the counter.
- `Sender.send()` builds its `Packet` synchronously inside the promise executor,
  reading `this.sequence` before incrementing, so the stamp cannot be raced by a
  sibling universe's send in the same loop.

**The reach is guarded.** `sequence` is `private` in the TypeScript source but a
plain writable property in the shipped JS. `addUniverse` now asserts it exists
and is numeric, and **throws at startup** if a package upgrade removes or renames
it — because silently losing frame identity would make the mirror's
all-sequences-equal proof stop being a proof while still passing.

---

## 3. Tests

**Engine — `marsin_engine/tests/io/sacn_output_wire.test.js`** (11 → 15):

- all universes of one engine frame carry the SAME sequence;
- **MODEL RELOAD**: a universe whose sender is created mid-run stays aligned;
- **MODEL RELOAD**: a universe that goes dark and is revived returns aligned,
  not frozen behind (includes the 3× blackout burst);
- per-universe sequence still advances +1 mod 256 across a full wrap.

**Verified non-vacuous:** with the stamp neutralised, both MODEL RELOAD tests
fail and the other 13 pass — they reproduce incident class A precisely. This path
had **no test at all** before, which is why the bug survived.

**Sim — new `simulation/tests/bench_mirror_stuck_longevity.test.js`** (3 tests).
A synthetic accelerated fixed-offset stall (4,000 refused frames, no timers,
~0.2 s) proves the bridge: emits nothing; is still naming the offset in its
**last** line, not just its first; throttles rather than logging per frame; grows
the heap sub-linearly (O(1) in stall length); still answers a picker request that
re-reads scene data; and **recovers on its own** when the offset clears — a stall
is a gate, not a latch. Plus source pins that both bridges carry the handlers,
the synchronous breadcrumb, nonzero exit, the armed blackout, `guardedRecompute`
at the poll call site, and the `readSceneTrees` guard.

**Suite verdicts.**

| Suite | Result |
|---|---|
| `marsin_engine` full | **3335 tests, 3330 pass, 5 fail** |
| `simulation` full | **2276 tests, 2262 pass, 13 fail** |
| bench-mirror + all bridge + launcher + contract suites | **256 tests, 255 pass, 1 fail** |

Every failure is **pre-existing and outside this slice**, from concurrent
sessions' scene/fixture/theme work: the engine's 5 are `dev_test_bench`
`groupBits out of sync with model` (model_loader, zero references to
`sacn_output`); the sim's 13 are fixture/patch/scene-CLI checks, CaptainPad theme
palette parity, display orientation, and `_176 §5.3` — a stray state file left in
the repo's real scenes dir by another session's run (`bench_mirror_state.cjs` is
not in this slice). The baseline was 7 per `_202`; the list grew in those same
domains, none of them touched here.

---

## 4. What changes operationally

**The "model reload while armed" playbook is deleted, not shortened.**

Before: any pattern work that triggered a model reload de-aligned the senders,
the mirror refused every frame, and the log correctly said **RESTART THE
ENGINE** — a full engine restart plus a re-arm, every time. Twice in one evening.

After: the armed mirror **rides through a model reload**. Universes stay mutually
aligned across sender creation, dark periods and blackout bursts, so the
composition proof keeps passing. Expect at most a brief pause while the reload
itself happens, then mirroring continues. No restart, no re-arm.

**The STUCK message is now a genuine alarm.** Its remedy text still says restart
the engine, and that is still right for the cases it can now legitimately
describe (a source that really has stopped, a second writer). But the routine
cause is gone, so seeing that line should now be treated as news rather than as
the cost of doing pattern work. *(Worth a follow-up pass on the message wording
once the fix has a few live sessions behind it — left alone here rather than
weakening a diagnostic on theory.)*

**The live engine gets the sender fix at its NEXT RESTART.** Nothing was applied
to the running stack — this slice used HIGH ports and black-holed sACN only. The
running engine still has per-sender counters and will still de-align on reload
until it is restarted once.

**Silent exits are now self-diagnosing.** If a bridge dies again, the launcher
log tells you which kind it was without an investigation:

- exit line **with** the `process exiting on its own with code=N` breadcrumb, or
  a `FATAL …` stack → the bridge chose it; it is a defect, report the stack;
- exit line **with neither** → it was force-killed from outside. On this box that
  means a port sweep or stack teardown from another session; the two `bridge:
  true` children (`:5568`/`:6971` and `:6972`) are the ones such a sweep hits.

**Standing hazard, unfixed by code.** Concurrent sessions on this box can and did
kill the live bridges. That is a coordination matter, not a code one — but note
that the input bridge dying **while armed** leaves the mirrored boxes frozen on
their last frame, because a force-kill skips the blackout entirely. Sweeping
ports while a bench session is armed is the thing to avoid.

---

## 5. Files touched

| File | Change |
|---|---|
| `marsin_engine/lib/sacn_output.js` | engine-frame sequence stamping + package-shape assertion |
| `marsin_engine/tests/io/sacn_output_wire.test.js` | +4 alignment / model-reload tests |
| `simulation/server/sacn_bridge.js` | `readSceneTrees` yaml guard, `resolveMirrorFor` named refusal, `guardedRecompute`, fatal handlers + exit breadcrumb, `_mirrorMisalignTotal` |
| `simulation/server/sacn_output_bridge.js` | fatal handlers + exit breadcrumb |
| `simulation/tests/bench_mirror.test.js` | D-158-3 pin updated for the cumulative total |
| `simulation/tests/bench_mirror_stuck_longevity.test.js` | new |

No git operations performed.
