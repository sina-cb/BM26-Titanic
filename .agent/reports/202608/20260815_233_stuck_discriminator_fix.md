# _233 — the BENCH MIRROR STUCK discriminator, rebuilt so it can say "not stuck"

Date: 2026-08-15
Branch: `feat/bm_readiness`
Scope: `simulation/server/sacn_bridge.js`, `tools/port_cleanup.cjs`, their tests.
No git operations. Nothing bound, started, stopped or POSTed to on 6966-6972 or
UDP 5568 — the operator's live stack and the armed bench were never touched.

`_229` proved every one of the session's 48 `BENCH MIRROR STUCK` lines false and
designed the fix. This implements it. The old detector could not answer "not
stuck" — it normalised offsets against the most advanced source, so every
trailing source read `d < 0` by construction, sampled its evidence only on
flushes that were already torn, and called six consecutive tears a FIXED sender
offset. The new one is gated on the one property the two causes do not share:
**a genuine offset composes ZERO whole frames.**

---

## 1. Per-fix status

| Fix | State | What landed |
|---|---|---|
| **F1** — ±1 is never "fixed" | **Done** | `MIRROR_MIN_FIXED_OFFSET = 2`; an offset of magnitude 1 cannot be named at all. 850 of the 975 misalignments in the `_229` session had a spread of exactly 1. |
| **F2** — gate on the last whole frame | **Done** | `_mirrorLastWholeAt`, stamped on the aligned path *before* the "nothing new to say" short-circuit; STUCK requires `MIRROR_STUCK_NO_WHOLE_MS` (1000 ms) with no composition. This alone deletes the false-positive class. |
| **F3** — "fixed" means literally fixed | **Done** | `offsetSignature` now measures against a **fixed anchor** (the lowest-numbered source) instead of the running max, and the per-source **set** of observed offsets must be a singleton. |
| **F4** — symmetry + rollup | **Done** | `MIRROR_TEAR_GRACE_MS = MIRROR_STALL_WARN_MS`: a torn read gets the same 250 ms settling grace a missing source always had. Sub-grace tears go into a per-destination rollup printed at most once per 10 s (`reportTearRollup`), fired from **both** the torn and the aligned path. |
| **F5** — remedy text | **Done** | `**RESTART THE ENGINE**` is gone. The line now states what was measured and points at the causes that remain after `_212`. |
| **F6** — one-deep staging slot | **Skipped, documented in source** | It would erase the residual ~0.6 % drop but puts two buffers per region into the one path that must stay trivially provable ("every region carries the same sequence, or nothing goes out"). One dropped frame per ~4 s is invisible on lights and now costs one summary line per 10 s. |
| **F7** — port-cleanup interlock | **Done** | `tools/port_cleanup.cjs` refuses to kill an sACN bridge holding an armed mirror, via a PID-stamped marker the bridge publishes on ARM and removes on DISARM. |

---

## 2. The discriminator, as it now reads

Three conditions, all required:

```js
const persistent   = state.flushes >= MIRROR_FIXED_OFFSET_FLUSHES && fixedUniverses.length > 0;
const noWholeFrame = wholeAge >= MIRROR_STUCK_NO_WHOLE_MS;
const fixed        = persistent && noWholeFrame;
```

`fixedUniverses` is the set of sources whose observed offset — against a **fixed
anchor**, so it survives the sequence wrap — has been the *same single value* all
run, with `|d| >= 2`.

**Why the anchor moved.** Normalising against `Math.max(...raw)` was wrong twice
over: it hands the leader `0` and everyone else `< 0` on every torn flush (so
"is anyone behind?" is always yes), and it is not even stable for a genuinely
fixed offset — once the laggard's wrapped sequence reads *higher* than its
siblings' the laggard becomes the max and the whole reading flips sign, which
would have defeated F3's singleton test 70 frames out of every 256.

**The offset-value set is capped** (`MIRROR_OFFSET_SET_CAP = 2`): the only
question asked of it is "singleton?", and a second value settles that forever.
The stall path stays O(1) in the stall's length — the property `_212` pinned and
`bench_mirror_stuck_longevity.test.js` still measures.

---

## 3. What a REAL stuck condition looks like in the log now

```
❌ 🪞 BENCH MIRROR STUCK — 2→10.x.x.NNN: NO whole frame has composed for 1.4 s
(58 consecutive torn flushes, 58 for this destination) AND its sources hold a
PERSISTENT multi-step offset (U12 at -70, measured against U2). Both were
measured, not inferred: a burst-skew tear composes a whole frame between tears —
this has composed none. This destination is sending NOTHING until it clears
(regions: U2#161 U5#161 U12#91). DO NOT restart the engine on this line alone:
since report 20260814_212 the engine stamps every universe of one frame with ONE
sequence counter, so a live engine cannot put its own senders at different
origins. Check instead, in order: (1) is the engine still sending every source
universe — the sACN IN monitor and :6968/status; (2) is a SECOND WRITER (another
engine, a console, a stale bridge) interleaving its own sequence counter on those
universes — that is the only remaining way sources stay permanently apart; (3) if
a source has genuinely died, DISARM and re-arm to recompose from what is live.
```

And what the `_229` session would print instead of its 975 warnings — one line
per destination per 10 s, only while tearing:

```
🪞 bench mirror burst skew — 2→10.x.x.NNN: 24 frame(s) in the last 10.0 s arrived
TORN and were not sent (widest spread 1, longest unbroken run 2 flush(es); 3209
torn flush(es) since this destination was composed). The destination composed 397
whole frame(s) between them, so this is the engine's per-frame datagram burst
landing across two libuv poll phases — NOT sender misalignment and NOT a reason
to restart anything (report 20260815_229 §3.2).
```

The rollup's verdict half is **derived, not assumed**: a window in which the
destination composed nothing says so and points at the STUCK line instead. A
reassuring summary printed over a dark rig would be the same defect pointing the
other way.

A tear that outlives the 250 ms grace but recovers before the whole-frame window
still gets its own `⚠ … frame NOT WHOLE` line, now carrying the duration, the
offsets and the anchor. That is real frame loss and stays loud.

---

## 4. F7 — the port-cleanup interlock

`port_cleanup` resolves the UDP :5568 holder and `taskkill /T /F`s it. That
holder is `sacn_bridge.js` alone (its sibling holds TCP :6972 and survived — the
asymmetry that identified the mechanism in `_229` §4). A `/F` kill delivers no
SIGTERM, so the DISARM blackout never runs and every mirrored box freezes on its
last composed frame.

Arming is process memory whose only live surface is the sim WebSocket, which a
synchronous zero-dependency offline-safe killer cannot dial. So:

- the bridge **publishes** `~/tmp/bm26_bench_mirror_armed.json` (pid, armedAt,
  scene, sourceScene, destinations) in the same synchronous turn the arm is
  recorded — before the ship-dark blackout, which takes real time;
- it **releases** it in the same synchronous turn the arm is cleared, before the
  disarm blackout, so a disarming bridge never looks armed;
- it **reaps** a stale claim at boot (every start is disarmed, and only one
  process can hold :5568, so a claim naming a dead pid is the residue of exactly
  the force-kill this guards against);
- `killPid` **refuses** a pid the marker names — and only while that pid is
  ALIVE and its command line still contains `sacn_bridge.js`, so a stale claim
  or a reused PID can never wedge a launcher start;
- an **unreadable** marker widens the refusal to any sACN bridge and says why:
  we cannot prove nothing is armed, and the cost of guessing wrong is a frozen
  rig. Never a silent skip.

The schema and path live in `port_cleanup.cjs` with the consumer; the bridge
requires them, so there is one definition of both.

**Override.** `BM26_FORCE_SACN_KILL=1` (works everywhere) or `--force-sacn` (for
callers that forward argv — `npm run kill-ports -- --force-sacn`, direct `node`
invocations). Overriding still prints what it costs. `launcher.js` exits 2 on an
unknown option, so `--force-sacn` does **not** reach it today — that one-line
flag pass-through is a follow-up for whoever owns `launcher.js`; the env var
covers the launcher path meanwhile.

**Test safety.** The production marker is the LIVE bench's claim, so
`writeArmMarker`/`clearArmMarker` REFUSE it outright under `NODE_TEST_CONTEXT`
(same doctrine as `bench_mirror_state.cjs`'s `assertWritableTarget`), and
`bridge_harness.mjs` injects a per-pid scratch path. Verified after the full
suite: `~/tmp/bm26_bench_mirror_armed.json` does not exist.

---

## 5. Verification

**New — `simulation/tests/bench_mirror_stuck_discriminator.test.js` (7 tests).**
Behavioural, through the fake-module harness (zero packets, zero ports):

- a source that is **always** first in the burst, tearing for
  `MIRROR_FIXED_OFFSET_FLUSHES + 2` consecutive flushes per cycle × 20 cycles —
  the exact shape that fired the 48 false alarms — declares **no** STUCK and
  keeps emitting;
- a **500 ms continuous** tear that recovers: NOT WHOLE (named, with the run
  length), still no STUCK, emission resumes with no re-arm;
- 30 single-frame burst tears print **zero** warnings (F4);
- a **genuine** 70-frame constant offset held 1.4 s with zero whole frames
  **does** declare STUCK, names the offset, and does not say "restart the
  engine";
- the alarm clears on its own when the sources agree again.

**New — `simulation/tests/port_cleanup_arm_interlock.test.js` (13 tests).**
Armed/stale/PID-reuse/other-pid/corrupt-marker guard behaviour, the refusal and
override paths of `killPid`, both override spellings, the test-context braces,
and source pins on `freeStackPorts` + the bridge's claim/release/reap sites.
Nothing is ever killed: the marker names PID 2147483647, which no OS can issue.

**Adjusted** — `bench_mirror.test.js` (the `_158` D-158-3 immediacy pin is
superseded on the torn-read point only and now pins the grace + the rollup; two
new `_233` tests pin F1/F2/F3 and the F5 wording, including
`doesNotMatch(/minLag/)` and `doesNotMatch(/\*\*RESTART THE ENGINE\*\*/)`),
`bench_mirror_stuck_longevity.test.js` (one real 1.3 s wait, because the stall it
models must be a stall by the new definition; new remedy assertions),
`bench_mirror_arm.test.js` (one regex widened for the singular/plural change),
`helpers/bridge_harness.mjs` (injects the scratch marker path).

**Suite.** `cd simulation && node --test tests/*.test.js`

| | tests | pass | fail |
|---|---|---|---|
| Baseline (before any edit) | 2283 | 2274 | **8** |
| After | 2305 | 2293 | **11** |

The 8 baseline reds are the `_227` group (`_176` §5.3 test-context write,
fixtures-docked, orphan patch record, titanic-scene block, 2× emit CLI,
orientation projection) plus one playlist red. The 3 extra reds are all in
`pattern_manifest.test.js` — `baby/ is not fully registered in the manifest`,
`patterns/ambient_extra/ is neither registered nor excluded`, and the generated
`default.yaml` set — from the pattern-curation wave writing
`marsin_engine/patterns/manifest.json` at 01:57 while these runs were in flight.
Nothing this slice touches can reach them.

**Bridge-adjacent re-run** (`bench_mirror*`, `port_cleanup_arm_interlock`,
`bridge_routing`, `bridge_route_readback`, `engine_bridge_contract`,
`launcher_supervision`): **298/299**, the single red being the pre-existing
`_176` §5.3 one.

---

## 6. Operator notes

- **These changes take effect on the NEXT sim restart.** The running bridge is
  the old code: it will keep printing the old NOT WHOLE / STUCK lines, and it
  publishes no arm marker, so the port-cleanup interlock does not protect the
  currently armed session. Until then, `_229`'s rule still applies — if
  `count in this run` keeps resetting to 1, the mirror is working and the STUCK
  message is lying.
- After the restart, an armed bench will leave `~/tmp/bm26_bench_mirror_armed.json`
  on disk. That file is the interlock; deleting it by hand while armed removes
  the protection, and a launcher start that refuses to free :5568 is this guard
  doing its job, not a hang.
