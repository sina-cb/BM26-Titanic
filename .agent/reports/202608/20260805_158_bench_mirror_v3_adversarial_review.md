# 20260805_158 — BENCH MIRROR v3: adversarial review of the post-physical-failure rebuild

**Agent:** adversarial reviewer (Opus) · **Branch:** `feat/bm_readiness` · **Task:** `_158`
**Under review:** `.agent/reports/202608/20260805_156_bench_mirror_v3_implementation.md`
**Inputs:** `_153` (root cause + §10 flicker addendum), `_154` (fixture profiles),
`_155` (design + §15 amendments), `_157` (sACN stack review) · **Predecessor review:** `_152`

**READ-ONLY on production code.** Zero source/test/scene edits. Zero git write
operations (`show` / `diff` / `status` / `log` only). **No port bound, no packet
toward any controller, no device HTTP, no engine process started against the real
config, nothing armed on real hardware.** Every dynamic check ran in-process
against faked sockets; scratch lives in the session scratchpad.

Ground truth was re-established from disk in full — **none** of my `_152`
verification was carried over as still-valid, because most of what it covered was
deliberately replaced.

IPs are redacted to `10.x.x.NN` in this prose per `.agent/os/security_privacy.md`.

---

## 0. VERDICT — **FIX-FIRST**

**One blocking defect: the gate — the actual root-cause fix — has a window in
which it silently fails open, and the bridge reports ARMED / "bench only" while
the ship's controllers are reachable again at priority 150.** Reproduced
deterministically. That is the exact `_153` F1 failure the entire rebuild exists
to close, returning without a single warning line from the input bridge.

The rest of the rebuild is strong, and materially stronger than v2. The gate
design, the bench-only suppression, the ship-dark ordering, the ARM-side
one-writer discipline, the resolve layer's identity-based compatibility, the
default-equivalence pin, the UI relocation and the engine-mechanism removal all
hold up under attack. My `_152` D1/D2/RESIDUAL-1 regressions still have teeth in
the v3 shape — I falsified each one.

| # | attack surface | verdict |
|---|---|---|
| 1 | The :6972 gate | **BROKEN** — D-158-1 (blocking). Ack, refusals, ordering, link-drop and split-brain otherwise CONFIRMED |
| 2 | Bench-only suppression / ship dark | **CONFIRMED** — single call site, ARM-side clean, DISARM restores the full relay |
| 3 | Cadence fix | **CONFIRMED as claimed** · **BROKEN as a general guarantee** — D-158-3 |
| 4 | Resolve layer | **CONFIRMED** on compatibility, TOCTOU and the pin · D-158-4 (R-11), D-158-5 (R-20 text), D-158-7 (test) |
| 5 | UI relocation | **CONFIRMED** — all 10 items, by full read rather than by their grep |
| 6 | Engine mechanism removal | **CONFIRMED** · "unrepresentable" **QUALIFIED** — D-158-6 |
| 7 | Carried `_152` invariants | **CONFIRMED** — all three falsified and restored |
| 8 | Counts / deviations / operator files | **CONFIRMED** — with arithmetic and count corrections (D-158-9) |

---

## 1. Defect list

### D-158-1 — BLOCKING. The gate fails open during the ARM blackout, silently

**`simulation/server/sacn_bridge.js:1478`** (inside `onGateLinkLost`), with
**`:319`** (`blackoutInFlight`) and **`:1846-1890`** (`armBenchMirror`).

```js
function onGateLinkLost(why) {
  if (_gateLink === null) return;
  _gateLink = null;
  …
  if (_mirrorArm === null || blackoutInFlight()) return;   // ← :1478
```

`armBenchMirror` raises `_armBlackoutInFlight = true` synchronously (`:1848`) and
holds it across an **awaited** 3-frame ship-dark blackout, clearing it only in the
`finally` at `:1886-1890`. `blackoutInFlight()` is
`_mirrorDisarming || _armBlackoutInFlight` (`:320`). So for the whole ARM
blackout window, a gate-link loss takes the early return: `_gateLink` is nulled,
**no auto-disarm fires**, and nothing afterwards re-checks the gate — the
post-recompute ownership proof (`:1901-1946`) verifies mirror senders, relay
senders and engine-owned pairs, but **never the gate**.

The arm then completes and reports `armed: true`. The output bridge has already
released its gate (its own close handler, `sacn_output_bridge.js:250-252`,
fail-safe by design), so every sim window in `sacn_in` mode is a hard-coded
priority-150 writer to the ship's controllers again — while the HUD banner reads
`ALL SHIP OUTPUT SUSPENDED — BENCH ONLY`.

**Reproduced** (`bm158_gate_window.mjs`, both real bridges in-process, fake
sockets, zero ports): drop the gate control link on the first ship-blackout zero
frame, then feed the output bridge one 519-byte frame at priority 150.

```
gate link killed mid-ARM-blackout : true
ARM reply armed                   : true
ARM reply refusal                 : NONE
LAST broadcast status armed       : true
auto-disarm logged                : false

prio-150 sim frames that reached a controller AFTER the arm: 1
```

**Why it matters more than its window size.** The window is a few milliseconds of
awaited blackout, and it needs the output bridge's control link to die inside it
(output-bridge crash, launcher restart of that process, loopback socket reset).
But the consequence is the *specific* failure of the first physical test,
restored **silently**: no auto-disarm, no refusal, and a banner asserting the
opposite. There is no recovery path while armed — the loss is swallowed
permanently, because `onGateLinkLost` early-returns on `_gateLink === null`
thereafter.

**It also defeats the smoke procedure's own diagnostics.** `_156` §9.3 routes
"bench shows garbage" to *"suspect the physical fixture's personality/menu"* —
which is precisely the wrong conclusion for this state, and the table has no row
for "an `UNGATED` line appeared after arming". The operator would be sent to the
fixture menus while the root cause sat in the log.

**Fix (either, both cheap):**
- add the gate to the ownership proof — `if (_gateLink === null) unproven.push(…)`
  at `:1901-1946`, so "bench only" is proven rather than assumed after the
  blackout, exactly as the relay set already is; and/or
- have `onGateLinkLost` set a sticky `_gateLostDuringBlackout` flag when it takes
  the `blackoutInFlight()` early return, and act on it in the `finally`.

The first is preferable: it closes the class (any gate loss up to the proof), not
just this path.

### D-158-2 — MEDIUM. "none (held dark)" leaves the box FROZEN, not dark

**`simulation/lib/bench_mirror.cjs:658-678`** (`requiredSources`/`bySource`) with
**`sacn_bridge.js:1982-2022`** (`flushMirrors`).

A destination whose slots are **all** `none` has zero slices, so it never appears
in `bySource`, is never marked dirty, and is **never emitted**. The mirror sender
is created and the destination is reported as owned — but nothing is ever written
to it, so the box holds its last look.

`_155` §6.1 rules the opposite, explicitly:

> "the mirror still owns its destination universes and **composes all-zero
> frames** … Armed = the bench is the mirror's, **dark** where unselected."

and `_156` §11 deviation 4 cites that ruling as its justification for allowing
empty `slices`. The ruling is cited correctly and **not implemented**.

**Reproduced** (`bm158_none_slot.mjs`) — arm with `led_0: none`, then pump all
five engine sources for 12 frames:

```
U2 ->10.x.x.10    total= 12  all-zero=0
U10->10.x.x.60    total=  0  all-zero=0     ← never written
U12->10.x.x.60    total= 12  all-zero=0
```

**One click reachable:** the bench's U10 and U12 each carry exactly one slot
(`led_0`, `led_1`), so a single `none` choice in the picker produces it. And it
lands on the same `.60` box whose applied binding is already the open question —
so a frozen strand would be misread as the `needs-reboot` problem.

This also collides with the design's own stated principle (§4.2, *"Why dark and
not frozen"*): a gateway has no timeout and the MarsinLED `dmx.timeoutMs` is
unwritten by this repo, so "never written" can mean "holds forever".

**Fix:** send `BLACKOUT_FRAMES` zeros to every slice-less mirror destination at
arm (same mechanism as the ship blackout), or treat an empty `required` set as
always-complete and emit composed zeros on the normal cadence.

### D-158-3 — MEDIUM. The cadence gate tests source *presence*, not frame identity

**`simulation/server/sacn_bridge.js:1995-2001`.**

Everything `_156` §6 explicitly claims is **CONFIRMED by independent byte-level
measurement** (below). What is not true is the implied equivalence *"one send per
destination per engine frame ⇒ that frame is whole"*. The gate asks
`seen ⊇ required`; it never asks *which engine frame* a region came from.

Measured with per-frame generation markers stamped across all 512 channels, five
adversarial poll-phase split patterns, 20 engine frames each — all **1.00
sends/frame, 0/20 torn**. Then, pattern C (one datagram per phase, the exact
split this fix exists for) with **one U5 datagram dropped at frame 3**:

```
frame  3: 0 send   (gate correctly holds)
frame  4: 1 send   TORN  [U6:g3 U6:g3 U6:g3 U6:g3 U5:g4 U5:g4 U2:g4 U2:g4]
frame  5..10: 1 send each, TORN — U6 region permanently one frame behind
→ 7/7 post-drop frames torn, 40 of 344 mapped channels one engine frame stale, forever
```

Nothing re-synchronises it, and **zero `🪞` log lines are emitted** — the
destination *is* completing every frame, so the watchdog cannot see it. The same
single drop under a single-poll-phase arrival self-heals, so the residual is
conditional on exactly the split-across-poll-phases premise the fix addresses.

Their own cadence tests (`tests/bench_mirror_arm.test.js:965-1004`) assert send
*counts* and "nothing before completeness", never byte-level freshness — which is
why this is invisible to them. Both of the independent breaks pass their
assertions.

**Severity judgement:** needs a lost datagram, which on loopback UDP is uncommon
but not impossible under load. It matters because the symptom is *not* flicker —
it is a permanently wrong region — so `_156` §9.3's "flicker ⇒ second writer"
rule would not catch it and the smoke could pass with 4 pars a frame stale.
Closing it needs a frame-identity notion (clear `seen` on the first source of a
new gather, or per-source arrival ordinals), not another presence gate.

### D-158-4 — MEDIUM (latent). R-11 has no intersection test and its refusal text is false

**`simulation/lib/bench_mirror.cjs:554-563`.** The overlap check maps the *other*
sidecar's pairs and refuses if that list is non-empty — there is **no
intersection with the arming scene's own destinations**. Reproduced: arming
`test_bench` with `otherClaims = [{scene:'other_rig', pairs:[{universe:99, ip:10.x.x.99}]}]`
— a disjoint universe on a different host — refuses with *"resolves onto the same
destination(s) U99 → 10.x.x.99"*. That sentence is untrue.

Structurally it is why: `evaluateArmRequest` runs (`sacn_bridge.js:1795`) before
the arming scene is resolved (`:1819`), so its own pairs are not yet known. It
**fails safe** and is latent today (one sidecar exists; R-5 already forbids two
simultaneous arms), but it will misfire with a false explanation the day a second
rig gets a sidecar. No test covers the disjoint case.

### D-158-5 — LOW/MEDIUM. The v1/v2 migration text (R-20) is unreachable for any real v1/v2 file

**`simulation/lib/bench_mirror.cjs:142` runs before `:144-148`.**
`requireKnownKeys(tree, SPEC_KEYS, …)` fires first, and every real v1/v2 sidecar
carries `source_scene` / `mirrors` — both now unknown keys. Feeding the actual
committed HEAD sidecar to the parser:

```
[BenchMirror] HEAD v1 file: unknown key 'source_scene' — allowed: enabled, label,
note, slots, version. …          → migration text present? false
```

The refusal is still **loud, named and non-partial**, so the safety property
holds; what fails is the R-20 UX claim in `_156` §2 and §10. Their `_155 R-20`
test passes because `baseSpecTree({version})` builds a **v3-shaped** tree with
only the version number changed — a file that cannot exist in the wild. One-line
fix: move the version check above `requireKnownKeys`.

(Cosmetic, related: the committed HEAD sidecar declares `version: 1`, while the
reports call the frozen mapping "v2" throughout.)

### D-158-6 — LOW. "Unrepresentable" is qualified: `sacn.destinations` is still an unguarded direct path

**`marsin_engine/lib/output_config_guard.js:39, 65-72`** with
**`marsin_engine/lib/sacn_output.js:25-27`.**

The guard is genuinely strong where it looks — 31 cases run directly against
`assertNoDirectHardwareRoutes`: `controllers:` refused for entries, `[]`, `{}`,
`null`, `false`, `0`, `""` and `undefined` (the check is `key in config`, so
presence alone is caught — stronger than advertised), plus top-level `alsoFlat:`
and `protocol:`; the message names both the key and the file; the call site
(`engine.js:156`) is the first statement after `loadConfig()` in `parseArgs()`,
itself the first statement of `main()`, so nothing can act on config before it.

But `sacn: { destinations: ['10.x.x.202'], multicast: false }` streams sACN
**straight to a physical box, bypassing the bridge**, and the guard is silent —
while `/status.outputRouting` still reports `{ controllers: [] }`, i.e. it
*positively asserts* "there is no writer the bridge cannot see" when there is one.
`/status` exposes no destination list, so R-8 and R-21 cannot detect it. This is
the removed mechanism's failure mode surviving under a different key.

Mitigating: it is a **known** trap, correctly kept documented in
`.agent/memory/spawning_a_test_engine.md` by this very slice. Not introduced here
and not a regression — but "made unrepresentable" is true of the *name*, not of
the *capability*, and the report should say so.

Also uncovered, all inert but breadcrumb-shaped: case variants (`Controllers:`),
nesting (`sacn.controllers` — note the constant is named `FORBIDDEN_NESTED` yet is
checked only at top level, `:39`), and post-guard mutation of the config object.

### D-158-7 — TEST DEFECT. The "sidecar declares no plumbing" assertion is defeatable

**`simulation/tests/bench_mirror.test.js:418-434`.** A sidecar was constructed
that carries the entire v2 plumbing table and **passes the assertion verbatim**.
Evasions: the key check covers only `mirrors`/`source_scene`/`controllers`; the
plumbing regex misses `destU`/`destCh`/`srcAddr`/`len`/`dmxAddress`/`footprint`;
the IP regex is defeated by `0x0A01010A`, the 32-bit decimal, or `10-1-1-10`; and
a YAML double-quoted **line continuation** puts a real, intact dotted quad in the
file that the raw-text scan cannot see while `yaml.load()` reassembles it:

```yaml
note: "LED box 10.1.\
  1.60 is out 1"
```

YAML anchors/aliases hide plumbing on the alias lines too.

**Not a safety defect.** The real guarantee is `SPEC_KEYS`/`SLOT_KEYS` +
`requireKnownKeys` (`bench_mirror.cjs:86-87`, `:100-107`) plus the fact that
`resolveBenchMirror` reads only `slot` / `bench_fixture` / `default_source` and
never consults `note` or `label`. Hidden plumbing would be inert documentation
rot, not a live address. But the test is advertised in `_156` §2 as the thing
that enforces the property, and it does not.

### D-158-8 — HARDENING. A P0-shaped fallback on the emission path

**`simulation/server/sacn_bridge.js:1995`** —
`const required = owner.state.requiredSources.get(key) || new Set();`

A missing `requiredSources` entry degrades to *empty required ⇒ complete ⇒ emit
unconditionally* — a silent permissive default in exactly the shape the codex
forbids, on the one path that decides whether a half-fresh frame goes out.
Currently **unreachable** (`buffers` and `requiredSources` are filled in the same
loop, `bench_mirror.cjs:664-667`, and `owner` is found via `buffers.has(key)`), so
this is hardening, not a live defect. It should `fail()` loudly instead.

Related asymmetry: the mirror-sender retire path (`:856-862`) deletes
`_mirrorEntries` and `_mirrorDirty` but not `_mirrorSeen`,
`_mirrorIncompleteSince` or `_mirrorStallWarned`; `disarmBenchMirror`
(`:1664-1668`) clears all four. No reachable stale state today; close it
symmetrically.

### D-158-9 — REPORT ACCURACY (no code impact)

- **`_156` §8.2 contains a duplicated paragraph** describing
  `output_config_guard.test.js`, once as "9 cases" and once as "8 cases". True
  count is **9** (`:36, 42, 58, 65, 74, 79, 87, 94, 103`, no subtests); both
  paragraphs then enumerate the same nine items. Delete the duplicate.
- **The engine arithmetic explanation is wrong.** "−35 +10, residual ±1 subtest
  accounting" — the two deleted files have **zero** subtests (`t.test(` appears
  nowhere in the engine suite); they are flat 24 and 11. The real static net is
  **−25**, and the residual is **±3 run-to-run nondeterminism** originating in a
  different, crashing file. The conclusion (no test was silently lost) still
  holds and was verified independently by per-file counts.
- **The engine suite total is not a stable number**: two identical runs gave
  **2634/2627/7** and **2631/2624/7**. `tests/effects/effects_v2_mode_page_layout.test.js`
  fails at *file* level (it declares 47 cases and crashes partway), so the count
  drifts. Quoting 2631 as *the* total is over-precise.
- **Line-number drift throughout**: §6 cites `:1955`/`:1960`/`:1981`/`:1997-2016`
  (actual `:1956`/`:1961`/`:1982`/`:2002-2017`) and `bench_mirror.cjs:658-700`
  (actual `:658-678`); §7.2 cites `engine.js:143-149` (actual `:150-156`) and
  `api_server.js:4990` (actual `:4995`); §7.1 cites `engine.js:1420-1428` (actual
  `:1419-1423`). Harmless individually; collectively they make citations
  unverifiable at a glance.
- §7.3's table is **12 rows over 10 unique files** (`docs/41` appears three
  times), described as "11 files".

### D-158-10 — LOW. Two missed breadcrumbs in `.agent/plans/`

- `.agent/plans/20260709_0_led_integration_execution.md:200-207` — imperative
  voice: *"Add an explicit opt-in per controller entry — `alsoFlat: true`"*,
  *"Unit-test in `marsin_engine/tests/output_dispatch.test.js`"*. It also names
  `docs/41` as "read first", so a follower lands on the scrubbed doc.
- `.agent/plans/20260710_1_led_patching_grouping_look.md:502-504` — a runbook step
  telling the reader to run the engine *"with `controllers:` routing"*, which now
  produces a boot refusal.

`_156` §7.3's "left alone deliberately" list names `.agent/reports/**` and the
tracker but is silent on `.agent/plans/`. Severity is low (both dated and
superseded, and the guard fails loudly), and the fix is the same non-destructive
standing-correction header already applied to `bm_readiness_mapping.md`.

---

## 2. Surface-by-surface

### 2.1 The gate — BROKEN (D-158-1); everything else CONFIRMED

- **Ack before composition.** `setOutputGate(true)` is awaited at
  `sacn_bridge.js:1830`, **before** `_relaySuspended`, `_mirrorArm` and any
  composition (`:1846+`). ✓
- **R-23 refuses without an ack** — verified end-to-end two ways
  (`bm158_r23.mjs`): with no output bridge reachable, and with a **foreign
  control link already holding the gate**. Both refuse, both name `R-23`, and a
  refused ARM puts **0 frames on the wire and sends 0 ship-blackout zeros** (the
  ship must not go dark for an arm that never happened). ✓
- **Split-brain closed.** The output bridge answers a second gate claimant with
  `gated: true` **plus** a `refusal` (`sacn_output_bridge.js:279-289`) — an ack
  that a naive `gated === true` check would misread. `setOutputGate` checks
  `ack.refusal` first and throws (`:1509`), then also verifies
  `ack.gated === gate`. ✓
- **Control channel not deafened while gated.** `handleControlMessage` is reached
  at `:168`, before the drop check at `:175`, because the drop lives inside the
  519-byte branch. ✓
- **Link drop ⇒ loud auto-ungate and auto-disarm** — `releaseGateIfHeldBy`
  (`:318`, wired at `:250`) and `onGateLinkLost` (`sacn_bridge.js:1464`). ✓
  **except** inside the blackout window (D-158-1).
- **Crash directions both fail safe.** Input bridge dies ⇒ output bridge releases
  the gate on link close, ship is not stranded dark. Output bridge dies ⇒ input
  bridge auto-disarms and restores the relay. ✓
- **Second sim window mid-arm** — connected one during the ship-dark blackout
  (`bm158_arm_side.mjs`): it creates no relay sender, and after the arm
  **0 sends went to any non-bench destination**. ✓

### 2.2 Bench-only suppression — CONFIRMED

- **Exactly one production call site** feeding sender decisions:
  `sacn_bridge.js:706`. The only other call is inside `evaluateArmRequest`
  (`bench_mirror.cjs:575`) and computes warnings, not senders. Pinned by an
  exact-count assertion (`tests/bench_mirror.test.js:532`, `=== 1`). ✓
- `partitionMirrorSuppression` (`bench_mirror.cjs:372-400`) degenerates to
  armed-or-hold ⇒ `relay: []`. ✓
- **The ARM-side D1 class is closed by a stronger mechanism than the hold.**
  `_relaySuspended` (`:302`) is raised synchronously before any await and gates
  the send itself in `routeFrame` (`:2038`), so no raw frame can leave regardless
  of which senders exist; `_relayCloseHeld` (`:809`) keeps retiring senders open
  under their zeros. Measured under live traffic on every ship universe:
  **0 raw frames between the first and last ARM zero frame**, 0 post-arm sends to
  non-bench destinations. ✓
- **Ownership proof requires zero surviving relay senders** (`:1929-1934`). ✓
- **DISARM restores the FULL relay set** — verified functionally (sender-key
  tracking is ambiguous because a mirror and a relay sender share one key): after
  disarm, inbound frames reach `U2 → 10.x.x.10`, `U30/U31 → 10.x.x.60` and
  `U5/U6 → 10.x.x.11` again. ✓
- **Ungate ordering is correct** — relay restored (first `Route created` log) far
  ahead of the `UNGATED` line, so there is no window in which a priority-150 sim
  frame and a mirror frame can coexist. ✓

### 2.3 Cadence — CONFIRMED as claimed, with D-158-3

1.00 composed sends per destination per engine frame with **0 torn frames** across
five adversarial poll-phase split patterns (all-in-one, 2/3 split, one-per-phase
forward, one-per-phase reversed, random grouping and order), single-source
destinations unaffected. **No timeout-emit fallback exists anywhere** — the only
two `sendVia` calls that can reach a mirror destination are the completeness-gated
emit (`:2022`) and the deliberate disarm blackout (`:1691`); every timer in the
file is off the mirror path; `bench_mirror.cjs` contains no timer; the `sacn`
package's own re-send timer is gated on `minRefreshRate`, default `0`, never
passed. The watchdog only logs — measured 700 ms stalled ⇒ 0 sends, 1 warning
naming `U6`; 1200 ms idle with an incomplete destination ⇒ 0 sends; no
false-positive under 600 ms frames. **H5 is dead**: after ARM with 2 of 3 sources
fed across 5 phases ⇒ 0 sends; on the third source ⇒ 1 send, 344/344 mapped
channels non-zero. **Fixed priority 100** under rogue inbound 150 *and* 200; CID
exactly 16 bytes. The residual is D-158-3.

### 2.4 Resolve layer — CONFIRMED, with D-158-4/5/7

Compatibility is genuinely by `fixtureType` **identity**
(`bench_mirror_resolve.cjs:275-282`): a 33-channel `VintageLed` vs a synthetic
33-channel `ImposterLed33` is refused with `rule: "fixtureType"` — footprint
equality is not enough, as `_154` §7 asked. The documented asymmetry holds
(`led_strand` 40→20 px accepted with a warning; 10→20 refused; `led_fixture`
refuses both directions). `pixelFormat` must match exactly; `led.wire` differences
warn only.

**TOCTOU CONFIRMED**: ARM re-reads sidecars, scene trees and the fixture registry
from disk with no cache; picker input is explicitly untrusted and re-resolved; a
mid-arm scene edit is caught by a `mirrorFingerprint` comparison
(`JSON.stringify(spec.mirrors)` — the complete byte function) and auto-disarms
with a blackout rather than reshaping live hardware, which always composes from
the frozen `_mirrorArm.spec`. **Caveat:** that check runs only on a
`recomputeRoutes`, and the engine poll early-returns on an unchanged signature —
so with a stable engine and no client churn, detection can be arbitrarily delayed.
Hardware is never silently reshaped, but "auto-disarms on a mid-arm scene edit" is
event-driven, not polled.

**The default-equivalence pin is real and I verified it independently** rather
than trusting their fixture: ground truth parsed programmatically from
`git show HEAD:simulation/scenes/test_bench/bench_mirror.yaml` (7 slices,
40+33+33+119+119+80+80 = 504 channels, matching `_154`'s byte tables), then
compared as a (destUniverse, destHost, destChannel) → (srcUniverse, srcChannel)
function. **Their frozen table vs the real committed YAML: 504/504, 0 diffs.
Resolver default output vs the real committed YAML: 504/504, 0 diffs.** The
resolver emits 8 gateway slices where v2 hand-merged four pars into one 40-channel
slice — byte-identical as a function, same `requiredSources` set, so cadence is
unaffected.

### 2.5 UI relocation — CONFIRMED (by full read, not their grep)

`sacn_monitor_panel.js` read in full: the only bench-mirror import is the **pure**
`benchMirrorControlState`, used once for a read-only projection into a `StatRow`
that has no `onClick`, no id and no handler; `bm.action`, `bm.armScene` and
`bm.disabled` are discarded. `registerSacnGlobals` publishes no bench-mirror
global. No keyboard handler, no dynamically built method name, no store/signal
write path, no prop to a child that could arm. The control's sole home is
`controller_map_panel.js:172-204`, mounted into the Controllers header so it
renders regardless of lighting mode; exactly one bench-mirror button id exists in
all of `src/`. All **8 header states** verified against
`bench_mirror_control.js` with exact text; refusal renders beside the control
(`✋` + truncated text, full text in `title`) and correctly does **not** disable a
control that could still work. DISARM-in-progress disables both gestures — header
button via `blackoutInFlight`, picker by unmounting (its `scene` is null in that
state), backstopped by R-5b checked first in `evaluateArmRequest`. New connections
get a freshly built status (`:1074-1084`, `:1536-1563`); on socket close the
client nulls the status and hides the banner rather than showing a stale OFF.

Worth knowing, not a defect: `window.sacnInput` exposes `armBenchMirror` /
`disarmBenchMirror` as page globals (`sacn_input_source.js:170`, `:183`) —
inherent to the design (the header control calls exactly those), reachable from
the devtools console, and invisible to any source-grep of the panel.

### 2.6 Engine mechanism removal — CONFIRMED, "unrepresentable" QUALIFIED

All five deletions verified gone (not emptied) with line counts matching. **No
dangling references**: symbols extracted from `git show HEAD:` for both deleted
modules, then grepped across `marsin_engine/`, `simulation/`, `CaptainPad/`,
`control_podium/`, `tools/`, `scripts/`, `archived/` — zero survivors. The
"exactly one consumer between them" claim holds (`artnet_output` only from
`output_dispatch.js`; `output_dispatch` only from `engine.js`). The only live
mentions are self-referential assertions that the files are absent.
`/status.outputRouting` is a hardcoded literal at `api_server.js:4995`,
reconstructed per request, with no code path able to populate it; `engineOwnedPairs`
is retained, exported, consumed live at `sacn_bridge.js:997` and still tested.
The breadcrumb scrub is accurate and **destroyed no live bridge documentation** —
`docs/41` §5 step 3 replaced a live instruction with a stronger statement of the
bridge's legitimate routing role. One wall assertion was dropped (the harness no
longer asserts the Art-Net banner is absent), defensible since the module cannot
exist and the guard test asserts its absence from the tree. Qualification is
D-158-6.

### 2.7 Carried `_152` invariants — CONFIRMED, all three falsified

| regression | control | falsified |
|---|---|---|
| `_152` D1 (no raw frame between blackout frames) | ✔ passes | `hold: null` via preload ⇒ **fails** |
| `_152` D2 (ARM refused mid-blackout) | ✔ passes | `blackoutInFlight: false` via preload ⇒ **fails** |
| `_152` RESIDUAL-1 (throw in prologue must not leak the hold) | ✔ passes | non-vacuous by construction — it poisons a socket to force a real throw in the prologue, then proves the relay resumed and the failure was shouted |

RESIDUAL-1 is **fixed in code**: the `try` now opens immediately after the hold is
raised (`sacn_bridge.js:1678`), with a comment citing the finding. Socket-scoped
auto-disarm carried forward. Armed-OFF-at-start holds with **no persistence on
either** `_mirrorArm` or `_lastSelection` — the remembered selection is a
module-scope `Map` (`:330`) read only to pre-fill the picker (`:1603`) and written
only after a successful arm (`:1930`); it cannot arm anything by itself, since
arming still requires the gesture plus every check. SIGINT/SIGTERM carries my
`_152` D5 fix intact (`:1496`, `:1506-1511` await `_blackoutSettled`), still
read-verified and untested — an accepted gap I continue to accept.

### 2.8 Counts, deviations, operator files

| | claimed | **observed** |
|---|---|---|
| sim `npm test` | 1875 / 1869 / 6 | **1875 / 1869 / 6** ✓ same six pre-existing |
| `bench_mirror.test.js` | 49 | **49 / 49 / 0** ✓ |
| `bench_mirror_resolve.test.js` | 32 | **32 / 32 / 0** ✓ |
| `bench_mirror_arm.test.js` | 51 | **51 / 51 / 0** ✓ |
| engine `npm test` | 2631 / 2624 / 7 | **2631 / 2624 / 7** on one run, **2634 / 2627 / 7** on another — failing list byte-identical (7) |
| `security_check.py --all` | 6 baseline | **6**, all gitignored `.scene_backups/studiodj/**` ✓ |

**Deviations from `_155`, judged:**

1. **No per-controller-card badges** — **legitimate.** Decoration; the header
   control and the panel-independent HUD banner carry the truth. Recorded rather
   than silently skipped.
2. **R-11 compares computed pairs** — **rationale legitimate** (v3 has no declared
   destinations to compare), **implementation broken** — D-158-4.
3. **Operator DISARM refused during the ARM blackout while internal auto-disarms
   await it** — **legitimate and safer.** Verified in code (`:1652-1654`):
   refusing an auto-disarm would leave the bridge armed with nobody to press the
   button. Correct asymmetry.
4. **`validateMirrorTree` allows empty `slices`** — **a weakening.** The cited
   ruling (`_155` §6.1) says such a destination *composes all-zero frames* and is
   *dark*; the implementation composes nothing at all — D-158-2.

**Operator files untouched — CONFIRMED.** Every canonical scene/model/pattern/
playlist file still carries the mtimes I recorded hours earlier in `_152`
(`00:06:51`–`00:22:01`): `test_bench{,.effects,.viewmasks}.js`,
`00_golden_hour_wash.js`, `common.yaml`, `test_bench/{controllers,patches,scene_config}.yaml`,
`titanic/pixel_map_views.yaml`, `titanic/playlists/default.yaml`.
`titanic/controllers.yaml` and `titanic/patches.yaml` remain unmodified.

**Engine state residue, disclosed:** `marsin_engine/states/titanic/{deck,globals}_state.yaml`
carry later mtimes. This is the documented-expected residue of running
`cd marsin_engine && npm test` (that suite spawns real engines; AGENTS.md says
report it, do not revert it). `_156` §8.4 names `{audio,globals}_state.yaml`;
what I observe is `{deck,globals}` plus `mixer_state.yaml` — the category is
right, the file list is slightly off. **My own verification added to this
residue**: the engine suite was run twice during this review, so some of those
mtimes are mine, not the implementer's.

---

## 3. What must change before the physical smoke

**Blocking:**

1. **D-158-1** — add the gate to the post-blackout ownership proof
   (`sacn_bridge.js:1901-1946`), and/or make `onGateLinkLost` record a loss it had
   to defer. Without this the rebuild's central claim is unproven in a window that
   restores the original failure silently.

**Strongly recommended before arming real hardware:**

2. **D-158-2** — make an all-`none` destination actually go dark (zeros), as
   `_155` §6.1 rules. It is one click away and lands on the `.60` box.
3. **D-158-3** — decide whether the permanent-silent-tearing residual is
   acceptable for the smoke. At minimum, add the symptom to `_156` §9.3: a
   *steady wrong region* (as opposed to flicker) is now its own diagnosis, and the
   current table would send the operator to the fixture menus.
4. **`_156` §9.3** should gain a row for "an `UNGATED` line appears after arming"
   ⇒ the gate was lost, the smoke is invalid.

**Should fix, not blocking:** D-158-4 (R-11 intersection + honest text), D-158-5
(move the version check above `requireKnownKeys`), D-158-8 (`fail()` instead of
`|| new Set()`; clear the three companion maps on retire).

**Report hygiene:** D-158-9 (duplicate paragraph, arithmetic, line numbers,
"11 files"), D-158-10 (two `.agent/plans/` breadcrumbs), and a note that
"unrepresentable" means the name, not the capability (D-158-6).

---

## 4. Hygiene

- **Zero writes** outside this report and the tracker block. No source, test,
  scene or doc edit. No git write operation of any kind.
- **No port bound, no packet, no device HTTP, no engine started against the real
  config, nothing armed.** Both bridges were exercised in-process against faked
  sockets. The engine's own test suite was run (self-contained, no operator port);
  its state-file residue is disclosed in §2.8.
- Falsification was done by **module-load interception from the scratchpad**, never
  by editing and reverting source — so no falsification residue can exist in the
  tree, and `git status` shows only the implementer's own files plus this report.
- Every claim is a file read, a `git show`, a test run, or a reproduced in-process
  trace; citations are `file:line` against the working tree on `feat/bm_readiness`.
- IPs redacted to `10.x.x.NN` in prose throughout. No future dates.
- Three sub-reviewers ran surfaces 3, 4+5 and 6 in parallel under the same
  constraints; their findings were re-checked against the code before inclusion.

---

## 5. RE-VERIFICATION of the `_156` fixes — **READY FOR PHYSICAL SMOKE (re-smoke REQUIRED)**

Ground truth re-established from disk: `bench_mirror.cjs` (14:05), `sacn_bridge.js`
(13:58), the three sim test files (13:09–14:09), `_156` (14:14) and both
`.agent/plans/` files (14:05) changed after §1–§4 were written. Same constraints:
read-only, no port, no packet, no git write, scratch in the session scratchpad.

**The blocking defect is closed and I falsified the fix.** D-158-1, D-158-2
(principal case), D-158-3 and every minor are genuinely fixed. Three residuals
remain, none blocking, one of which the operator must know about before using the
mode in anger.

### 5.1 D-158-1 — FIXED · CONFIRMED, falsified

The design is right: the gate is now part of the **proof**, not an assumption.

- **Sticky recorded before the blackout branch** (`sacn_bridge.js:1497`), with the
  deferral shouted rather than silent (`:1499-1503`).
- **Cleared at exactly two sites** — arm start (`:1912`) and disarm completion
  (`:1777`). Grep confirms there is no third. **A reconnect cannot clear it**:
  `proveOutputGateHeld` tests `_gateLostWhileArmed !== null` *first* (`:1535`),
  before the link check and before any re-ack, so a link that died and healed
  still fails the proof. Their own regression demonstrates this empirically — the
  fake output-bridge server is still present and reconnectable when the proof
  runs, and the arm fails anyway.
- **Three independent conditions** in `proveOutputGateHeld` (`:1534-1551`): no
  sticky loss, a live link, and a fresh re-ack.
- **The proof consumes it** (`:2002`), so a gate failure takes the same
  auto-disarm-through-a-blackout path a surviving relay sender does — a failed arm
  cannot strand the relay suspended.

**Falsified independently** by rewriting `sacn_bridge.js` **in memory at compile
time** from a scratchpad `--require` preload (`Module.prototype._compile` hook —
no file touched, so no residue is possible), removing only
`if (gateFailure !== null) unproven.push(gateFailure);`:

```
✖ _158 D-158-1: a gate lost INSIDE the arm blackout fails the arm — it is never swallowed
  AssertionError: an arm that cannot prove the sim output path is gated must NOT report success
```

Unpatched it passes. That is the reviewer-side reproduction of their §13.6 D1 row.

**The three attack variants I was asked for, all CONFIRMED safe:**

| attack | result |
|---|---|
| reconnect clears the sticky | **No** — sticky is checked before the link, and there are only two clear sites (structural + empirical) |
| gate lost **after** the proof, before the first mirror frame | Normal path: `_mirrorArm` set, no blackout ⇒ **auto-disarm fires**, ship relayed again (5 destinations fed), and a re-arm after the link heals **succeeds** (sticky correctly cleared at arm start) |
| re-ack race — bridge acks while actually ungated | The re-ack is idempotent and honest *at that instant*; frames that escaped **before** it are exactly what the sticky flag covers. Sound by construction |
| auto-disarm path losing the gate mid-blackout (recursion) | `onGateLinkLost` returns at `:1479` on `_mirrorArm === null`, which a disarm sets synchronously — **no recursion, no sticky set** |

### 5.2 D-158-2 — FIXED for the principal case · **NOT** for total-none (R-158-B)

Arming with `led_0: none` and pumping six engine frames:

```
U2 ->10.x.x.10   frames=6  all-zero=0  full512=6
U10->10.x.x.60   frames=6  all-zero=6  full512=6   ← held dark
U12->10.x.x.60   frames=6  all-zero=0  full512=6
```

Exactly as claimed: the dark box is refreshed at **the same rate as a lit one**,
every frame a full 512 channels of zeros, never on a bare poll phase. ✓

**But the degenerate case is not covered** — see R-158-B below.

### 5.3 D-158-3 — FIXED · CONFIRMED, with an assumption that the engine does not always hold (R-158-A)

**Wraparound is safe.** Sequences 253, 254, 255, 0, 1, 2 in lockstep across the
255→0 wrap: **6 of 6 engine frames emitted**. The comparison is plain equality on
values that wrap together, so the wrap is a non-event. ✓

The emit condition, the immediate (not settling-window) desync log naming every
region and its frame, the retained 250 ms watchdog for a *missing* source, and the
absence of any fallback emission are all as described (`:2170-2215`). The log even
names the symptom — `STEADY WRONG COLOUR, not flicker` — which is the right thing
to teach.

**The assumption, checked against the real engine at HEAD**, is where the residual
is: R-158-A.

### 5.4 Minors — all CONFIRMED

- **D-158-4** — `evaluateClaimOverlap` (`bench_mirror.cjs:607`) does a **real
  intersection** (`mine.has(routeKey(...))`) and names **only** the colliding
  pairs. The false "resolves onto the SAME destination(s)" for disjoint pairs is
  gone. ✓
- **D-158-5** — fed the **actual committed HEAD v1 sidecar** to the parser:
  `version must be 3 (got 1) — … v3 no longer carries mirrors, slices, universes,
  addresses, IPs …`. The migration text is now reachable for a real v1/v2 file,
  which was the whole point. ✓
- **D-158-7** — the test now walks the **parsed tree** (keys at any depth against a
  plumbing-key pattern; string values against dotted-quad / hex-packed /
  dash-separated forms) **and asserts the real guarantee directly** —
  `SPEC_KEYS`/`SLOT_KEYS` admit nothing else. A companion test feeds each evasion
  to the parser and requires refusal. Much stronger. One novel evasion still
  passes (R-158-C), but the *stated* guarantee is now the schema rather than the
  scan, which is the correct fix. ✓
- **D-158-8** — `BENCH MIRROR INVARIANT VIOLATED` + auto-disarm replaces the
  permissive default (`:2155`), and all per-destination bookkeeping is behind one
  `forgetMirrorGather(key)` used by the retire, flush and disarm paths (`:863`,
  `:2099`, `:2140`, `:2157`) — the drift I flagged is closed. ✓
- **D-158-6 / D-158-9** — scope of "unrepresentable" corrected in §7.2; duplicate
  paragraph gone, arithmetic restated as a static net −25, engine total quoted as a
  **range**, line numbers refreshed, "11 files" → 10. ✓
- **D-158-10** — both `.agent/plans/` files carry the standing-correction header
  (`STANDING CORRECTION (2026-08-05, operator ruling)` … *"That whole mechanism is
  REMOVED"* … naming the boot refusal), and the original text is **left intact**
  below it — history preserved, nobody can follow the steps by accident. ✓

### 5.5 Residuals from this pass

#### R-158-A — MEDIUM. The one-sequence-per-engine-frame assumption is not guaranteed across a model reload

The new emit rule requires **all regions to carry the same sACN sequence**. That
is only sound if every universe of one engine frame really does carry one shared
sequence. Checked against the real engine, not the rig:

- Each `sacn` `Sender` owns its counter — `this.sequence = 0` at construction,
  `+1 % 256` per send (`node_modules/sacn/dist/sender.js:28, 60`). Lockstep is an
  *emergent* property of "all senders created together, all sending every frame",
  not a guarantee.
- **Steady state holds** — `engine.js:951-955` builds `dmxBuffers` from **every**
  `universeIds` entry each frame and `sendFrame` sends all of them
  (`sacn_output.js:69-88`). From a clean boot the assumption is true. ✓
- **The model-reload path breaks it permanently**:
  `engine.js:1726 sacnOut.addUniverse(patch.universe)` creates a **new Sender at
  sequence 0** while its siblings are at N; and
  `engine.js:1758 sacnOut.sendFrame({ [staleU]: staleFrame })` advances **one
  universe only**, three times, for a universe the same code comments say may be
  *"revived on a later reload"* — a permanent +3.

**Reproduced**: U5 held at a fixed −7 offset (the post-reload shape), ten engine
frames, one datagram per poll phase:

```
composed frames to the gateway over 10 engine frames: 0
desync log lines: 1 (throttled)
  ⚠ 🪞 BENCH MIRROR frame NOT WHOLE — 2→10.x.x.10: its regions carry DIFFERENT
    engine frames (U6#2 U5#2 U2#40) …
single-source LED destination still emitting: 10 / 10
```

So the multi-source DMX gateway goes **permanently silent** — not torn, silent —
and never recovers, because the offset is permanent. Single-source destinations are
structurally immune, so the bench would show LEDs but no pars/vintage/bars.

**This is fail-loud and, per the codex, the correct choice** over emitting a mixed
frame — I am not arguing the rule is wrong. Two things need attention:

1. **It is unrecoverable without an engine restart**, and nothing says so. The log
   reads *"A source datagram was lost or a source is lagging"*, which sends the
   operator hunting for network loss when the cause is a sender-sequence desync.
2. **It does not block the smoke**, because §9.1 has the operator restart the
   engine — a clean boot satisfies the assumption. It *does* matter the moment the
   operator reloads a model while armed, which is the normal bench-iteration loop.

Cheapest honest fix: name the possibility in the desync message and in §9.3
(*"if this persists, restart the engine — a model reload can permanently offset one
universe's sACN sequence"*). A robust fix would key alignment on a per-gather
ordinal rather than the wire sequence.

#### R-158-B — LOW/MEDIUM. Total-none still leaves every box frozen

D-158-2's fix gives a slice-less destination `requiredSources` = *every source
universe the whole mapping reads*. When **every** slot is `none` the mapping reads
**nothing**, so that set is empty for every destination and nothing ever ticks:

```
ALL SLOTS NONE — armed: true
  U2 ->10.x.x.10   frames=0
  U10->10.x.x.60   frames=0
  U12->10.x.x.60   frames=0
```

The arm is accepted, the ship goes dark by suspension, and **every bench box holds
its last look** — the exact outcome D-158-2 was raised to prevent, at the
degenerate end. Reachable in one gesture (set all rows to `none` and arm); silly,
but the picker allows it. Fix: fall back to *all universes the sidecar's slots
could read* (or simply refuse an all-`none` arm as pointless, which is also
defensible).

#### R-158-C — LOW, test-only. A numerically encoded address still evades the plumbing scan

The value scan skips non-strings (`if (typeof leaf.value !== 'string') continue;`).
A 32-bit packed address as a **number** in an allowed key passes all three
assertions:

```
note: 168364348      →  decodes to a dotted quad in the 10.9.9.x documentation range
caught by the string-value scan : false
key "note" allowed by SPEC_KEYS : true
=> passes all three assertions  : true
```

**Not a safety hole** — `note` and `label` are never read by the resolver, which
consults only `slot` / `bench_fixture` / `default_source`. And the strengthened
test now asserts the real guarantee (the schema) explicitly, which is what makes
the property true. Worth one more line in the value scan; not worth blocking on.

### 5.6 Counts observed

| | claimed | **observed** |
|---|---|---|
| `tests/bench_mirror.test.js` | 52 | **52 / 52 / 0** ✓ |
| `tests/bench_mirror_resolve.test.js` | 32 | **32 / 32 / 0** ✓ |
| `tests/bench_mirror_arm.test.js` | 54 | **54 / 54 / 0** ✓ |
| full sim suite | 1881 / 1875 / 6 | **1881 / 1875 / 6** ✓ same six pre-existing |
| engine suite | 2633 (range 2631–2634), 7 fail | **2632** tests / 2621 pass / **11 fail** under concurrent load — see below |
| `security_check.py --all` | 6 baseline | **6** ✓ |
| real controller IPs in new tests | 0 | **0** across all four files ✓ |

**The engine total (2632) is inside the claimed 2631–2634 range**, but I observed
**11 failures, not 7** — and the four extra ones are **not a regression**. All four
(`SIGKILL mid-performance …`, `enter captures pre-show snapshot …`,
`exit KEEP persists the live tweak …`, `dirty deck tuning surfaces …`) live in
`tests/mixer/performance_mode.test.js`, which spawns real engines, binds ports and
asserts on `marsin_engine/states/**`. Re-run **in isolation that file is 11 / 11
green**. They are contention artifacts of the four other agents working this tree
concurrently (and of my own earlier engine run), which is exactly the shared
mutable state AGENTS.md warns about. The documented seven — the five
audio-capture/supervisor cases, `startAsync rejects with EADDRINUSE` and the
file-level `effects_v2_mode_page_layout.test.js` crash — are all present and
unchanged.

This is also why `_156` quoting the engine total as a **range** is the right call,
and why an engine count taken while other agents are running should not be treated
as a gate.

**Zero falsification residue**: every neutralisation this pass was a compile-time
source rewrite from the scratchpad, never an edit to a tracked file. `git status`
shows only the implementer's files, the concurrent agents' reports, and this
report.

### 5.7 Verdict, and whether the physical smoke must be repeated

**READY FOR PHYSICAL SMOKE — and the smoke MUST be repeated.**

The operator's earlier physical pass was against the **pre-fix** build, and these
fixes change three things on exactly the paths a smoke exercises:

1. **The emit condition is strictly stricter.** Composition now refuses to send
   unless every region carries the same engine frame. A rig that previously
   emitted (torn) frames can now legitimately emit **nothing** — R-158-A is that
   case. The previous pass cannot vouch for this.
2. **The arm path gained a re-ack and a hard gate proof**, so an arm that
   previously succeeded can now refuse.
3. **Held-dark destinations now transmit** where they previously did not.

None of that is covered by a pass on the old build. The §9 procedure remains
correct; before running it I would add two rows to §9.3:

- *bench dark, log says `frame NOT WHOLE … regions carry DIFFERENT engine frames`*
  ⇒ sequence desync, **restart the engine** (R-158-A) — not packet loss, not a
  fixture menu;
- *an `UNGATED` line appears after arming* ⇒ the gate was lost; the arm should have
  refused or auto-disarmed — if it did neither, stop.

Nothing here is a reason to withhold the smoke. **SHIP remains the operator's call
and no agent's**, as it has been throughout.
