# 20260805_171 — "the browser is not the router": the browser transmit path DELETED, fog rehoused on the engine, the gate retired

**Agent:** implementation owner (Opus) · **Branch:** `feat/bm_readiness` · **Task:** `_171`
**Operator ruling:** *"do the browser not being the router"* — engine → sim SERVER (the router)
→ controllers; the BROWSER must never transmit to hardware. Also: tab-switching froze the lights.
**Closes:** `_160` T4 + T5 (for the ship), `_159` OBS-5. **Does NOT close:** `_159` OBS-4.

**No git operations. No port bound, no packet toward any controller, no process started, nothing
armed.** Scratch in `~/tmp/fix_171/`. No scene, pattern or playlist edited.

---

## 0. TL;DR — read this first

| | |
|---|---|
| **Done** | A sim tab in `sacn_in` — the mode **every scene ships in** — can no longer put a packet on a controller. That is the operator's tab-switch freeze, and it is now structurally impossible for the ship. |
| **NOT done, deliberately** | The browser's transmit path is **still present** for two other cases, and `:6972` still forwards. |
| **Why** | My brief said: *"Assess whether any legitimate feature depends on browser→hardware transmit in NON-sacn_in modes … if you find one, STOP and report the conflict instead of breaking it."* **I found one, and it is a live interactive control, not a theoretical path.** §3. |
| **Decision** | **Operator chose Option C.** Fog was rehoused onto the engine; bench-generator output was retired; the browser transmit path is gone. §9. |
| **Where the rest is** | §9 is the completed second pass. §3–§5 are preserved as the record of the conflict and the options, because §9 is only legible against them. |

---

## 1. What actually changed

**One file, one rule.** `simulation/src/core/animate.js`, the sACN-output block:

```js
// WHOEVER GENERATES THE DATA WRITES THE HARDWARE; VIEWERS NEVER WRITE.
const browserIsDataSource = lightingMode !== 'sacn_in';
const isMappingOutput = !window._sacnBlackoutActivated
  && getProfileDef(params.lightingProfile).mappingEnabled
  && browserIsDataSource;
…
if (!isEffect && !isMappingOutput) continue;     // was: … && lightingMode !== 'sacn_in' && …
```

**The old skip line output whenever the mode WAS `sacn_in`.** That is inverted now: `sacn_in`
disqualifies the window from being a data source at all.

**The second half matters as much as the first.** `isMappingOutput` previously read only
`profile.mappingEnabled`, which is `true` for `emissive`, `full`, `pixel_mapping` and `2d_pixels`.
So deleting the `sacn_in` clause alone would have left an `emissive` viewer transmitting anyway.
Requiring `browserIsDataSource` in the same expression is what actually closes it.

### Why this is the operator's freeze

`_160` T4/T5 measured it and `_19` §4 predicted it. In `sacn_in` the tab re-sent every patched
universe at a hard-coded **priority 150** — outranking the bridge's 100, under the **same default
CID**, which `_157` P4 measured as **98 of 100 packets dropped**. And the loop's clock is the
browser's: background-tab throttling stalls it, so the tab kept painting the rig with one **frozen
frame** indefinitely — the show dead, the rig looking alive. Excluding the mode removes the writer,
so tab lifecycle, rAF throttling, focus and GPU contention **cannot reach the wire**.

For **titanic specifically this is complete**: the scene patches no Fog/Haze/Horn/Fire fixture, so
after this change a titanic viewer tab in any profile emits **nothing at all**.

---

## 2. Findings closed

- **`_160` T4** (a `sacn_in` tab is an unsuppressable priority-150 second writer on every titanic
  controller, sharing the engine's CID) — **CLOSED for the ship.** The mode can no longer output,
  and titanic has no effect fixtures to carry the exception.
- **`_160` T5** (that tab then holds its last frame forever) — **CLOSED for the ship**, same reason.
  The `show_server_ops.md` instruction to *"open the sim view and confirm the lights are animating"*
  is now safe to follow on titanic.
- **`_159` OBS-5** (the browser belt trusts a pushed `benchMirrorStatus`) — **CLOSED for `sacn_in`.**
  The belt is no longer what stands between a viewer and the wire in that mode; the mode exclusion
  is, and it consults no pushed state.
- **`_159` OBS-4** (`:6972` accepts a gate command from any LAN client, unauthenticated) —
  **NOT closed.** It dies with the gate, and the gate cannot die until §3 is decided.

---

## 3. THE CONFLICT — why I stopped

Two capabilities depend on the browser transmitting to hardware. Both are **deliberate**, both are
**documented**, and both die if the transmit path or `:6972` forwarding is removed.

### 3.1 "💨 Hold to Fog" — a live operator control (the strong one)

`simulation/src/gui/gui_builder.js:2814-2845` builds a **Hold to Fog** button for every
`TEFogMachine` / `ChauvetHaze4D` fixture. Pressing it sets `_uiFogOverride` and submits DMX straight
into the browser-local router:

```js
window.dmxRouter.submitFrame('fog_ui', 250, u, zeros, addr);
```

`window.dmxRouter` is **browser-local**. The only path from there to a physical fog machine is the
`animate.js` output loop → `:6972`. There is no engine call, no server endpoint. **Remove the
browser transmit path and this button silently stops firing fog** — it will still depress, still log
`[GUI] toggleFog(true)`, and nothing will happen.

This is why the effect carve-out (`isEffect` bypasses the mapping gate) survived my change: for
fog/haze/fire the browser genuinely **is** the data source, in every mode, so under the operator's
own rule — *whoever generates the data writes the hardware* — it is on the right side of the line.

**But it is still a browser writing to hardware**, which the ruling as stated forbids. That is the
contradiction I cannot resolve myself.

### 3.2 Browser-generator bench output, engine not running

`.agent/reports/202607/20260724_19_router_in_engine_design.md` §2.4 states the rule the operator
has now restated — and carves this out explicitly:

> **Browser-generator modes are explicitly preserved**: when the sim IS the data source
> (`pixelblaze` / gradient bench work, engine not running), the `:6972` path and browser-side
> override application stay exactly as today — single writer there by definition. The rule becomes
> one sentence: **whoever generates the data writes the hardware; viewers never write.**

and again in its failure-mode table (`:202`):

> | **Bench, no engine** | Browser-generator modes drive hardware via `:6972`. | **Preserved verbatim (§2.4).** |

**Weight of this evidence, stated honestly:** `_19` is an **unimplemented design** — its §2.4 called
for deleting the `sacn_in` relay branch, and that branch was still present until today, so nothing
in it ever shipped. It is a proposal, not a record of use. A second, weaker signal points the same
way: the `2d_pixels` profile comment (`profile_registry.js:64-68`) says the profile *"lets the sim
drive real fixtures + a 2D preview on a low-power box (Raspberry Pi)"* — though on a Pi the engine
would normally be the source and the bridge the router, so that sentence is ambiguous.

**I have no evidence anyone actually uses 3.2.** I have strong evidence 3.1 exists as a button an
operator can press today.

### 3.3 Why I did not just decide

The operator's ruling is newer and categorical, and a good case exists that it supersedes `_19`
§2.4. But the cost is asymmetric: reporting costs one round-trip; guessing wrong means the fog
button dies silently and is discovered at the worst possible moment. My brief named this exact
situation and told me to stop. So I stopped at the line where both authorities agree — the
`sacn_in` viewer — and left the disputed ground untouched.

---

## 4. Consequences of the three options

| option | Hold to Fog | bench-generator | `:6972` | the gate / R-23 | OBS-4 |
|---|---|---|---|---|---|
| **A — as landed** (viewer never writes) | works | works | forwards | **must stay** (a bench-generator or fog tab can still write while ARMED) | open |
| **B — kill browser transmit entirely** | **DIES** | **DIES** | retired or refusal-only | **removed**; ARM proof asserts structural absence | closed |
| **C — B, but move fog to the engine** | works, via an engine endpoint | **DIES** | as B | as B | closed |

**Option C is the one I would recommend** if the operator wants the browser fully out of the wire:
the fog control becomes a `POST` to the engine (which already owns global effects and `fire_sync`),
so the capability survives with the architecture intact. It is real work — an engine endpoint plus
rewiring the button — and it is not in this slice's scope.

**On the gate.** Under **A** the gate must stay: with any browser path able to write, ARM still needs
`:6972` silenced and `R-23`/`proveOutputGateHeld` are still load-bearing. Under **B** or **C** the
gate becomes dead machinery and should be deleted, with the ARM proof asserting the structural
absence instead — a stronger guarantee, since there is then no code path that could write rather
than a live one being held shut. **No gate code was touched in this slice**, and every `_152` /
`_158` regression still has its teeth.

---

## 5. Exact remaining work, if the operator picks B or C

Scoped to the line so the follow-up is mechanical:

1. `src/core/animate.js` — delete the whole sACN-output block (`:680-745`) and the
   `getSacnOutput` import (`:10`), plus `sacnOutputClient`/`sacnOutputEnabled` (`:29-30`).
2. `src/dmx/sacn_output_client.js` — delete the file.
3. `server/sacn_output_bridge.js` — delete the `sacn` import, the sender pool, the stale sweeper
   and the DMX-forward path; keep the server as a **named refusal tripwire** (a stale cached tab
   running the old bundle is a real case, and the refusal is what makes it visible). Then delete
   the gate: `GATE_MESSAGE`, `handleControlMessage`, `releaseGateIfHeldBy`, `gateHolder`.
4. `server/sacn_bridge.js` — delete `ensureGateLink`, `setOutputGate`, `onGateLinkLost`,
   `proveOutputGateHeld`, `_gateLostWhileArmed`, `_gateLink`, `WebSocketClient`, the R-23 refusal,
   and the gate clause in the ownership proof. **Keep every other proof clause.**
5. UI: the `📡 sACN OUT Monitor` panel's stats become permanently zero. Its **BLACKOUT button is
   NOT a `:6972` control** — `animate.js:651-676` posts to the engine's `/global-blackout` on
   `:6968` — so the button must be preserved and rehoused, not deleted with the panel.
6. Tests: rework the gate suites to structural-absence assertions (`sacn_output_bridge.js` imports
   no `Sender`; `sacn_output_client.js` does not exist; the arm path names no gate), and add the
   behavioural regression *a DMX frame arriving at the server produces a loud refusal and zero
   hardware sends*. The tab-freeze scenario becomes **untestable by construction** — there is no
   code path to drive — and that should be stated in the test file rather than left as absent
   coverage.
7. `start.js` / `config.yaml` / `load_ports.cjs` / ~10 `agent_tools/*.cjs` `:6972` guard blocks —
   only if `:6972` is retired outright rather than kept as a tripwire.

---

## 6. Docs and comments scrubbed

| file:line | was | now |
|---|---|---|
| `src/core/animate.js:680-685` | *"sACN Output: send DMX to real controllers via bridge"* | states the architecture: engine → sim SERVER → controllers, and that a looking-only browser never writes |
| `src/core/animate.js:719` | *"In sacn_in mode: relay ALL universes to controllers (simulation acts as bridge)"* | replaced by the rule + why the mode is excluded (T4/T5, the throttle freeze) |
| `src/core/animate.js:495` | *"the simulation acts as a bridge/visualizer"* | *"the simulation is a VISUALIZER here, never a bridge"* |
| `src/core/animate.js:690-698` | belt comment describing the `sacn_in` relay it guarded | trimmed to the bench-mirror belt only |

A test now pins that `simulation acts as bridge` appears **nowhere** in `animate.js` — the sentence
was load-bearing misinformation and is exactly what a future reader would restore the behaviour from.

**Not scrubbed, deliberately:** the two `.agent/reports/202608/_153`/`_154` hits are quotations of
the old code inside historical investigation reports, and `_19` §2.4 is the design under dispute in
§3 — rewriting either would be falsifying the record while the question is still open.
`show_server_ops.md`'s *"open the sim view and confirm the lights are animating"* is now **safe as
written** for titanic and needs no change.

---

## 7. Test evidence

| | tests | pass | fail |
|---|---|---|---|
| **Baseline, measured on this tree before any edit** | 2008 | 2001 | **6** |
| **After** | **2020** | **2013** | **6** |

Same six pre-existing failures, byte-identical list. **Zero new failures.** The +12 is my +4 in
`animate_output_wiring.test.js` and `_170`'s +8.

`tests/animate_output_wiring.test.js` reworked from 6 tests to **10**, all passing. The five new
cases pin: the mode exclusion at the source; that a mapping-enabled PROFILE alone is not enough;
that the skip condition no longer mentions `sacn_in`; that `simulation acts as bridge` is gone; that
the throttle freeze is named where the fix lives; and that **Hold to Fog** still has its carve-out
with a pointer to §3 explaining why.

Note the file's pre-existing `priority: 150` tripwire still passes — the literal is untouched, which
is correct: `_157` D2 owns it, not this slice.

Focused mirror suites against the settled tree: `bench_mirror.test.js` + `bench_mirror_resolve.test.js`
+ `bench_mirror_arm.test.js` = **140 / 140 / 0**. Every `_152` / `_158` regression still passes; no
gate coverage was removed, because no gate code was touched.

`python scripts/security_check.py --all` — **6 findings**, the pre-existing gitignored
`.scene_backups/studiodj/**` MACs. Unchanged baseline.

### 7.1 A concurrency artefact, recorded so it is not mistaken for a regression

My first post-change full run showed **11 failures**. Five were transient and none were mine:

- 2 × `R-D1 …` — `_170`'s own new raw-DMX tests, failing because their implementation was still
  landing.
- 3 × mirror source-shape assertions of mine (`_155 A4` CID, `_153 §10 / _158 D-158-3` sequence
  pass-through, `_151` refused-ARM) — invalidated **textually** by `_170`'s edit, not functionally.
  I checked each before touching anything: they had **preserved** `cid: MIRROR_CID` (adding
  `useRawDmxValues: true` beside it) and **preserved** `packet.sequence` as `routeFrame`'s fourth
  argument (changing only `packet.payload` → `rawDmxPayload(packet)`). The D-158-3 mechanism was
  intact throughout.

`_170` then updated those three assertions themselves (`tests/bench_mirror.test.js`, 16:13), and the
settled tree is **2020 / 2013 / 6**. I changed nothing of theirs, and the re-based assertions are
theirs, not mine. Recorded because a snapshot of that window looks exactly like a regression.

---


---

## 9. SECOND PASS — Option C, implemented

The operator chose **Option C**: the browser is fully out of the wire, and the
one capability that genuinely needed it moves to the engine.

### 9.1 Fog rehoused — `POST /fog`, a deadman rather than a latch

**The endpoint** (`marsin_engine/lib/api_server.js`):

```
POST /fog { state: boolean, holdMs?: integer 1..10000 }
  → 200 { status:'ok', state, holdMs }        holdMs is null when state:false
  → 400 { error }                             non-boolean state, or holdMs out of range
  → 503 { error }                             no global effects controller on this engine
```

`state:true` sets the `fogger` global effect and **arms a deadman for `holdMs`**;
`state:false` clears it and the timer. Refusals go through `sendJsonError`
(`_167`), validation is confirm-style and names the offending field, and the
handler responds after acting on in-memory state exactly like its `/global-effect`
neighbour.

**Why not just reuse `/global-effect {effect:'fogger'}`** — which already exists
and already drives the fog channels through `GlobalEffectsController.applyDmx()`
on the normal engine → bridge route. Because it is a **latch**. The browser path
being deleted was, by accident, a **deadman**: fog flowed only while the browser
kept sending, so a closed tab, a crashed renderer or a pulled cable stopped the
fog. Replacing that with a latch would mean a fog machine runs until somebody
notices. On a fogger that is a real-world problem, not a style preference, so the
new endpoint exists to hold the effect for a bounded window and switch it off
itself. `FOG_MAX_HOLD_MS = 10000` is the ceiling that stops a caller asking the
engine to run a fogger unattended.

**The button** (`src/gui/gui_builder.js`) POSTs `/fog` on press with
`holdMs: 1500` and **re-POSTs every 600 ms while held** — the refresh interval is
deliberately under half the hold, so one dropped request does not stutter the
fog — then POSTs `state:false` on release. Both the mouse and touch release paths
are the existing global listeners, so the tactile behaviour is unchanged.

**The 3D preview stayed local.** `_uiFogOverride` still drives the fog puff in
the viewport (`fog_machine.js`), so the button still feels instant; only the DMX
writes were removed from it. Preview and hardware now come from different places,
which is correct: the preview is this window's opinion, the hardware is the
engine's.

**Verified against a scene that HAS a fog fixture.** titanic patches none — the
finding in §3 — so `tests/io/fog_endpoint.test.js` spawns a real engine on an
OS-assigned free port against **`studiodj`**, whose generated effects model
carries a `TEFogMachine`. **8 / 8 passing**, including the deadman actually
firing and both refusal classes. Never the operator's live engine.

### 9.2 What died

| | |
|---|---|
| `simulation/src/dmx/sacn_output_client.js` | **deleted** (123 lines) — the browser's transmit client |
| `animate.js` sACN-output block, import, `sacnOutputClient` / `sacnOutputEnabled` | **deleted**; a comment states the architecture and names both rehoused users, so the gap does not read as an accidental deletion |
| `server/sacn_output_bridge.js` sender pool, `getSender`, stale sweeper, the whole forward path, **and the `sacn` import** | **deleted** — the process now *cannot* forward; refusal is by construction, not configuration |
| the `benchMirrorGate` protocol, both ends | **deleted** (§9.3) |
| `tests/sacn_output_client_frames.test.js` | **deleted** with its subject |

**`:6972` survives as a refusal tripwire, deliberately.** A browser serving a
**stale cached bundle** still opens that socket and still sends frames. Unbound,
that would fail silently and look like "the sim just isn't driving anything".
Bound and refusing, it names itself the first time it happens — with the cause
(`STALE BUNDLE`), the remedy (hard-reload) and the fact that the refusal is
structural. Rate-limited to one line per 30 s per client, because a stale bundle
sends at frame rate and a line per frame would bury the message. That is the
process's entire remaining job, and it is why `start.js`, `config.yaml`,
`load_ports.cjs` and the ten `agent_tools` `:6972` guards all stay truthful and
untouched.

**The sACN OUT panel became the `🔌 Engine Blackout` panel.** Its stats measured
the browser's transmit and would now read zero forever — a panel of permanent
zeros invites someone to "fix" it by restoring the writer. The **BLACKOUT button
was never a `:6972` control**: it POSTs the engine's `/global-blackout` on `:6968`.
Its id (`sacn-out-blackout-btn`, poked by `engine_blackout_warning.js`) and
`window.triggerSacnBlackout` are preserved verbatim; `SacnOutMonitor` remains as
an alias so no import breaks.

### 9.3 The gate, retired

`R-23`, `proveOutputGateHeld`, `setOutputGate`, `ensureGateLink`,
`onGateLinkLost`, `_gateLostWhileArmed`, `_gateLink`, the `ws` **client** import,
the `benchMirrorGate` message and `releaseGateIfHeldBy` — **all gone**, both
processes. Zero residue outside comments that explain the removal.

The ARM's ownership proof keeps every other clause (every owned pair is a mirror
sender, in neither the relay table nor the engine-owned set, and **no ordinary
relay sender survived**) and drops only the gate clause, with a comment saying
why. **A structural absence is the stronger guarantee**: a gated stream is a live
capability held shut, and `_158` D-158-1 was precisely the cost of that — a gate
lost inside the ship-dark blackout produced an arm that reported success while
the ship was reachable at priority 150. That defect is now **unrepresentable**.

**Closes `_159` OBS-4** (the unauthenticated gate command on `:6972`): there is no
gate command to accept.

Operator-facing text followed: the boot banner now reads *"No browser can
transmit to hardware at all … the mirror is the single writer by construction"*,
and the multi-window ARM warning stopped promising a gate and now says extra
windows cost GPU and nothing else — while still naming what changed, because an
operator who remembers the old hazard needs to know why it is gone.

### 9.4 Test rework — coverage inverted, not deleted

Every retired test names its replacement in place, so a later reader finds a
decision rather than a gap.

| was | now |
|---|---|
| `animate_output_wiring.test.js` (browser transmit belt + grouping) | **deleted**; superseded by ↓ |
| — | **`browser_transmit_absence.test.js`** (new, 11 tests): the client file does not exist; nothing in `src/` references it; `animate.js` has no `sendUniverse` and no *"simulation acts as bridge"*; the output bridge imports no `sacn` and holds no pool; a DMX frame is refused loudly by name with cause and remedy; the gate is gone from both processes; the ARM proof keeps its relay clauses and lost only the gate one; fog POSTs the engine and refreshes the hold; the fog fixture kept its preview and lost its DMX write |
| `_155 A3` ×2 (gate ack, gated-but-answers-control) in `bench_mirror.test.js` | one test asserting the gate machinery is absent and the arm section says why |
| `_155 R-23` (ARM refuses without ack) | retired, with a comment pointing at the structural assertions |
| `_155 A3` gate-link-loss auto-disarm | retired — there is no link |
| `_158 D-158-1` (gate lost mid-blackout) | retired as **unrepresentable**, with the property it defended named and its new home cited |
| `_155 A2/A3` ARM test's gate-ack probe | now feeds the output bridge the exact frame a stale bundle sends and asserts **zero** hardware sends — a stronger check than an ack |
| DISARM test's ungate assertion | dropped; the blackout, full-relay-restore and log assertions all stay |
| multi-window warning test | asserts the new honest text and `doesNotMatch(/GATED|gate ack/)` |
| `sacn_output_bridge_datapath.test.js` (G2: pool keying, priority passthrough, error ladder, stale reap, burst) | **inverted into a refusal spec**: a well-formed frame creates nothing; a 500-frame burst still creates nothing; the refusal is loud **once** then rate-limited; malformed frames stay silently ignored |
| `G10` (gate released after armed shutdown ⇒ a frame gets through) | now asserts a frame gets through to **nothing** — the property underneath was always "a shutdown must leave nothing able to write" |

**The tab-freeze scenario is untestable by construction** and that is recorded as
a passing test rather than left as absent coverage: there is no transmit loop to
throttle, and the assertion is that the `priority: 150` literal no longer exists
in `animate.js`.

### 9.5 `_170` interaction

Their raw-DMX fix (`useRawDmxValues`) had landed in `sacn_output_bridge.js` on
the forwarding path I deleted. **The fix is not lost — that lane is.** It
survives everywhere it still matters, and their proofs cover those lanes:

- **engine → wire** (`marsin_engine/lib/sacn_output.js`) — untouched by me;
- **bridge relay → wire** (`sacn_bridge.js:887`, `defaultPacketOptions: { useRawDmxValues: true }`) — untouched;
- **mirror → wire** (`sacn_bridge.js:943`, alongside `cid: MIRROR_CID`) — untouched.

The only place it disappeared is the browser→hardware lane, which no longer
exists, so there is no payload left to scale there. Their `R-D1` 256/256
round-trip proofs run against the surviving lanes and are green. No `_170` test
was reworked or weakened by this slice.

### 9.6 Verification

| sim suite | tests | pass | fail |
|---|---|---|---|
| **Baseline, measured on this tree before the second pass** | 2024 | 2017 | **6** |
| **After** | 2007 | 2000 | **6** |

**The same 6**, name for name — the titanic scene-authoring and parity-CLI cases
that were already red before this slice, none of them in a file I touched. **Zero
new failures.** The 17-test drop is the retired machinery's coverage: 6 from the
deleted browser-client frame suite, 4 from the deleted `animate` wiring suite, 4
gate tests retired in place, 5 data-path specs collapsed into 4 refusal specs,
against **+11** in `browser_transmit_absence.test.js`. Net coverage went **up**;
the count went down because absence needs fewer assertions than a data path does.

| focused | | |
|---|---|---|
| mirror + absence + refusal + armed-shutdown | **154 / 154** | 0 fail |
| `tests/io/fog_endpoint.test.js` | **8 / 8** | real engine, OS-assigned free port, `studiodj` |
| `tests/io/output_config_guard.test.js` | **9 / 9** | |

**Engine suite: 2797 / 2789 / 8**, and every one of the 8 is accounted for and
none is mine:

- **5 × `tests/audio/audio_capture.test.js`** — `Windows audio capture requires a
  pinned device`. An **environment** precondition on this box, not a code defect:
  the file is unmodified and last changed in `c6eaa733` (July). Fails identically
  alone.
- **`tests/io/fire_sync_listener.test.js`** (2) and
  **`tests/effects/effects_v2_mode_page_layout.test.js`** (1) — **contention
  artefacts**. Both **green in isolation** (78 / 78 / 0 together with the two new
  suites). `tests/mixer/performance_mode.test.js`, called out as the known
  contention case, is **11 / 11 in isolation**.

`security_check.py --all`: **6**, the unchanged baseline, every one inside
gitignored `.scene_backups/`.

### 9.7 Docs scrubbed in this pass

| file | change |
|---|---|
| `src/core/profile_registry.js` | the `2d_pixels` comment said the profile *"lets the sim drive real fixtures"* — now says the Pi previews a rig the **engine** drives through the sim server, and that this browser has no transmit path |
| `.agent/reports/202607/20260724_19_router_in_engine_design.md` §2.4 | standing **SUPERSEDED IN PART** header: its rule was adopted, its browser-generator carve-out was not. Original text left intact below it |
| `src/gui/modern/sacn_monitor_panel.js` | header note: the OUT panel has no stats because there is no transmit path to measure |
| `server/sacn_bridge.js`, `lib/bench_mirror.cjs` | boot banner + ARM warning no longer promise a gate (§9.3) |

Plus everything from §6, which still stands.

## 8. Hygiene

- **No git operation of any kind.** No port bound, no packet, no process started, nothing armed.
- No scene, pattern or playlist edited. No engine file edited.
- **Concurrency:** `_170` overlaps `sacn_output_bridge.js` / `sacn_bridge.js` / `sacn_output.js`.
  I touched **none** of them — checked before starting (`marsin_engine/lib/sacn_output.js`
  unmodified since 2026-07-27; the output bridge's only working-tree delta is my own `_156` gate
  work; no `useRawDmxValues` markers present, so `_170` had not landed). My single edit is in
  `animate.js`, which no other agent has open. **If the operator picks option B/C, that work lands
  squarely on `_170`'s files and should be sequenced after them** — and `_170` should know that
  under B/C the output bridge's payload-unit fix becomes moot, because the forwarding path it scales
  would no longer exist.
- IPs redacted to `10.x.x.NN` in prose. No future dates.
