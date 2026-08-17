# _229 — BENCH MIRROR STUCK recurrence: a false alarm, not a regression

Date: 2026-08-15
Branch: `feat/bm_audio_tuning`
Scope: **read-only forensics.** No product code edited, no git operations, no
process on 6966-6972 started, stopped, bound or POSTed to. The only contact with
the live stack was two `GET`s (`:6968/status`, `:6969/`).

Report `_212` claimed the BENCH MIRROR STUCK failure class was deleted. Today the
message came back, thousands of NOT WHOLE lines rode with it, and the `sacn-in`
bridge exited `code=1`. **The `_212` fix is intact and working. Every STUCK line
in this session is a false positive.** The engine never needed restarting; the
detector that told the operator to restart it is the defect.

---

## 1. Verdict

| Question | Answer |
|---|---|
| Did the `_212` engine-frame stamp regress? | **No.** Present in the tree and provably active. |
| Why did STUCK recur? | The **STUCK discriminator misclassifies a torn read as a fixed sender offset.** |
| Is the bench dead? | **No.** Healthy now, and it was never truly stuck. |
| What must be restarted? | **Nothing.** |
| Was the `sacn-in` exit a crash? | **No** — external force-kill, per `_212`'s own decision rule. |

---

## 2. The `_212` fix is active — three independent proofs

**Proof 1 — the code is there.** `marsin_engine/lib/sacn_output.js` still carries
the one-counter-per-engine-frame stamp (`_frameSequence` at :69, `sender.sequence
= seq` at :148, advance at :128) and the package-shape assertion at :106-111. The
tree is dirty but the stamping hunk is untouched.

**Proof 2 — the engine never rebuilt a sender.** One `Loading model...` (line
124) and one `[sACN Out] Sender started — 38 universe(s)` (line 190) in the whole
log. Live `:6968/status` reports `frame: 549231`, `activeModel: "titanic"`,
`modelStale: false` — one continuous process for ~3.8 h. There is no
sender-creation event for a sender-creation offset to arise from.

**Proof 3 — the mirror rode through four model hot-reloads.** `🔄 Model changed
on disk. Hot-reloading...` fired at log lines **1788, 2580, 3335 and 4318**, all
of them *while armed*. Pre-`_212`, the **first** of those would have wedged the
mirror permanently — that is the exact incident `_212` was written for. Instead
the mirror kept composing whole frames across all four for three and a half
hours. This is the fix working, observed live.

---

## 3. Root cause of the false STUCK

### 3.1 What the log actually shows

975 `NOT WHOLE` lines, 48 `STUCK` lines, armed 04:54:53Z → 08:38:24Z.

**The circular sequence spread across the three sources is exactly 1 in 850 of
the 975 misalignments.** Typical triples, verbatim:

```
U12#161 U5#161 U2#162      U12#213 U5#213 U2#214      U12#250 U5#250 U2#251
```

**33 of the 48 STUCK lines name an offset of exactly `-1`**, and **47 of 48 fire
at `flushes = 6`** — the bare minimum `MIRROR_FIXED_OFFSET_FLUSHES`.

**The decisive statistic: `count in this run` is `1` in all 975 NOT WHOLE lines.
Never 2.** `_mirrorMisaligned` is deleted only on the aligned-emit path, so a run
can restart at 1 only if the destination composed a **whole, aligned frame**
immediately before. It did so ~975 times. The cumulative `total` reached 3209 —
that is 3209 torn flushes against roughly 535,000 engine frames delivered while
armed, a **0.6 % tear rate**. A destination that is genuinely stuck composes
zero whole frames and its `count` climbs monotonically into the thousands in a
single run. That never happened once.

A one-frame skew is also arithmetically incompatible with the failure the message
describes: a sender created mid-run starts at 0 while its siblings are at
whatever ~40 fps has reached, so a real offset is a large arbitrary constant —
never 1, and it never resolves.

### 3.2 The mechanism — a torn read of one frame's datagram burst

`sendFrame` stamps and writes all 38 universes **synchronously in one burst**
(the payload build and every `sender.send()` run before the `await`). Those
datagrams cross loopback to the bridge, where `mirrorInbound` schedules
`setImmediate(flushMirrors)` after **any single region arrives**.

If the libuv poll phase hands Node only part of the burst before the check phase
runs, the flush sees region sequences `{N+1, N, N}` — the destination's first
region has already been overwritten by the next frame while the others still hold
the current one. Spread 1, leader = whichever universe's datagram landed first.
That is the entire phenomenon.

### 3.3 The discriminator flaw

`offsetSignature` normalises every offset against the **most advanced** source:

```js
const max = Math.max(...raw);
let d = ((raw[i] - max) % 256 + 256) % 256;
```

So on any torn flush the leader gets `d = 0` and **every other source gets
`d < 0` by construction**. `minLag` then records the minimum `|d|` per universe —
but it is only ever updated on flushes that are *already torn*:

```js
const stuckUniverses = state.flushes >= MIRROR_FIXED_OFFSET_FLUSHES
  ? [...minLag.entries()].filter(([, lag]) => lag > 0) : [];
```

A universe that is merely **systematically last in the engine's send burst** is
behind on every torn flush, so its `minLag` never reaches 0, and six consecutive
tears are enough to declare it "at a FIXED sequence offset". The comment in the
source states the intent correctly — *"whether the offset between the sources is
the SAME on consecutive flushes"* — but the implementation asks a different,
much weaker question: *"does this universe ever reach lag 0 while torn?"* It
cannot, by the normalisation above.

### 3.4 The asymmetry that lets it fire at all

`flushMirrors` already knows this situation is normal. For a **missing** source
it waits `MIRROR_STALL_WARN_MS` (250 ms) before saying anything, with the comment:

> *"A source that has not arrived yet is NORMAL for the few milliseconds between
> an engine frame's datagrams."*

A source that **has** arrived carrying the *next* frame's sequence is the
identical situation — the burst is mid-flight — yet it gets an immediate loud
complaint with zero grace, and six of them get an `❌` telling the operator to
restart a perfectly healthy engine. Removing that asymmetry is the fix.

### 3.5 The large-offset minority is real frame loss, also not misalignment

125 of the 975 lines show spreads of 9-124 (e.g. `U12#105 U5#1 U2#1`, offset
`-104`). All of them cluster in **08:32-08:38**, which is exactly when the box
was loaded: live-touch armed on `130_spatial_paint`, CaptainPad Expo SSR
bundling, `⚠ 2 sim clients connected`, headless-Chrome agent sessions polling,
and the audio companion's mood source going stale for 10-39 s. These are genuine
multi-frame delivery gaps under CPU contention. They also self-heal — `count`
still resets to 1 — so they are not sender misalignment either. Engine → bridge
is **unicast to 127.0.0.1**, so Wi-Fi multicast is not in this path; the earlier
"wifi multicast" hypothesis is ruled out.

---

## 4. The `sacn-in` exit — external kill, not a casualty and not a cause

At **08:38:24Z** (`line 4328`): `⚠ sACN input bridge (sacn-in) exited
unexpectedly (code=1); restart 1/5`.

Applying `_212`'s decision rule to the log:

| Signal | Count in log |
|---|---|
| `process exiting on its own with code=N` breadcrumb | **0** |
| `FATAL` / escaped-throw stack | **0** |
| `health probe missed` / `FROZEN` / `killing it` | **0** |
| `❌` auto-disarm from `guardedRecompute` | **0** |

Breadcrumb absent, no fatal stack, launcher watchdog silent → **force-killed from
outside**, exactly the class `_212` named as a standing hazard.

The specific mechanism is identifiable this time. `tools/port_cleanup.cjs`
resolves a UDP port's holder with `netstat -ano -p udp` and kills it with
`taskkill /PID <pid> /T /F` — which on Windows produces precisely `code=1`,
`signal=null`, no output. It targets the **UDP :5568 holder**, which is `sacn-in`
alone; `sacn-out` holds TCP :6972 and survived. That asymmetry — one bridge dead,
its sibling untouched — is what a UDP-port-targeted cleanup produces and what a
whole-stack sweep would not.

It also coincides to the second with the fourth model hot-reload (`line 4318`),
i.e. another session was writing repo files at that moment. **The exit is not
related to the STUCK lines**: the mirror had been tearing for 3h43m without
killing anything, and `_212` already pinned by test that the stall path is O(1)
in stall length.

The exit is a **casualty, not the cause** — hypothesis (c) is ruled out: the
tearing predates the bounce by three and a half hours.

---

## 5. Current bench state — healthy

```
04:54:53Z  🪞 BENCH MIRROR ARMED (titanic → test_bench)
04:55:13Z  first NOT WHOLE            ← chronic tear begins, 0.6 % of frames
05:xx-08:38 four model hot-reloads    ← mirror rides through all four
08:31:54Z  live-touch ARMED (130_spatial_paint)
08:32:14Z  first STUCK                ← 6 consecutive tears under load
08:38:24Z  sacn-in force-killed → supervised restart, comes up DISARMED
08:44:04Z  operator re-armed
08:47Z     2 NOT WHOLE, 0 STUCK since re-arm
```

**The bench is mirroring normally right now.** Since the 08:44 re-arm there have
been two one-frame tears and zero STUCK lines. The engine is at frame 549231 with
`modelStale: false`.

Note for the operator: between the force-kill and the re-arm the bridge was
disarmed with ordinary relay restored, so `10.x.x.NNN` was briefly receiving
ordinary titanic U2 relay rather than the bench composition. A force-kill skips
the mirror's blackout, so the bench boxes held their last frame across that gap —
the standing hazard `_212` called out, recurring exactly as predicted.

---

## 6. Recovery recommendation

**Restart nothing.** Not the engine, not the launcher.

The STUCK message's "**RESTART THE ENGINE**" instruction was wrong every one of
the 48 times it printed today. The engine's senders were aligned throughout —
that is what the `-1` offsets and the constantly-resetting `count` prove. A
restart would have cost a re-arm and a dark ship for nothing.

If a bench destination ever does go quiet, the correct check is now: does the
destination compose **any** whole frame? If `count in this run` keeps resetting
to 1, the mirror is working and the message is lying.

---

## 7. Proposed permanent fix — design only, NOT implemented

The tree is mid-surgery by four other agents; nothing below was applied.

**F1 — an offset of 1 is never a fixed offset.** A one-frame skew is the
definition of a torn read. Refuse to call it fixed, unconditionally.

**F2 — gate STUCK on "has this destination composed a whole frame".** Add
`_mirrorLastWholeAt`, set on the aligned-emit path, and require *no* whole frame
for some window before STUCK may fire. A genuine sender offset composes **zero**
whole frames; this single gate deletes the entire false-positive class on its own
and is the strongest of the five.

**F3 — make "fixed" mean fixed.** Track the *set* of observed `d` values per
universe across the run and declare a fixed offset only when that set is a
singleton with `|d| > 1`. This is what the existing comment already promises.

**F4 — remove the missing/torn asymmetry.** Give a torn read the same settling
grace a missing source already gets (`MIRROR_STALL_WARN_MS`), and fold tears into
a periodic summary line ("N frames dropped to burst skew") instead of an
immediate `⚠` per run. 975 log lines for a 0.6 % tear rate is noise that hid the
real signal.

**F5 — rewrite the STUCK remedy text.** This is the follow-up `_212` explicitly
deferred ("worth a follow-up pass on the message wording once the fix has a few
live sessions behind it"). It has now had one, and the wording actively misleads.
Since `_212` made sender misalignment impossible by construction, the only true
remaining causes are a genuinely dead source or a second writer — the message
should name those and drop the engine-restart instruction.

**F6 — optional, eliminates the residual 0.6 % drop.** Give each destination
region a one-deep staging slot keyed by sequence, so a datagram arriving for frame
N+1 does not overwrite frame N before N has had the chance to compose. Only worth
doing if a dropped frame every ~4 s ever becomes visible; it is not visible on
lights today.

**F7 — operational, outside the mirror.** `tools/port_cleanup.cjs` will
force-kill an armed `sacn-in` and freeze the bench boxes, skipping the blackout.
It should refuse (or at minimum warn loudly) when the launcher lock is held, or
when the bridge it is about to kill has an armed mirror. `_212` filed this as a
coordination matter; it has now recurred, which argues for a code guard.

---

## 8. Hypotheses tested and rejected

| Hypothesis from the brief | Verdict |
|---|---|
| (a) `_212` stamping misses some sender-recreation path | **Rejected.** No sender was ever recreated — one `Sender started`, one `Loading model...`, `frame 549231` continuous. |
| (b) The fix is not active in this generation | **Rejected.** Stamp + assertion present in the tree; four hot-reloads survived, which is impossible without it. |
| (c) The `sacn-in` bounce is the cause, not a casualty | **Rejected.** Tearing began 3h43m before the bounce and continued identically after it. |
| (d) Chronic loss misdiagnosed as STUCK | **CONFIRMED — this is the root cause**, though the loss is a torn read of one frame's datagram burst rather than network loss, and the engine→bridge path is loopback unicast, not Wi-Fi multicast. |

No git operations performed. No product code modified.
