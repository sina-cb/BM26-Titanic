# 20260805_156 — BENCH MIRROR v3: selectable mapping, bench-only output, the :6972 gate, the cadence fix, and the removal of the engine's direct-unicast exception

**Agent:** implementation owner (Opus) · **Branch:** `feat/bm_readiness` · **Task:** `_156`
**Blueprint:** `.agent/reports/202608/20260805_155_bench_mirror_selectable_mapping_design.md`
(as amended by its §15) · **Root cause:** `_153` (packet/routing, + its §10 flicker
addendum), `_154` (fixture profiles) · **Predecessors:** `_150`, `_151`, `_152` ·
**Concurrent:** `_157` (sACN stack review — its D2/D6/§11 folded in, its D1/D3/D4/D5 explicitly NOT).

**No git operations.** No server started on an operator port, no port bound, no
packet toward any controller, no device HTTP, no engine restart, nothing armed.
Every verification is in-process against faked sockets. Scratch under `~/tmp/`.

IPs are redacted to `10.x.x.NN` in this prose per `.agent/os/security_privacy.md`.
The scene/config files and the runtime UI carry the real values on purpose.

---

## 0. TL;DR

| | |
|---|---|
| **What shipped** | Bench-mirror **v3**: the sidecar declares SLOTS, not plumbing; every universe/address/slice is resolved fresh from scene data at ARM. ARM opens a per-slot picker. ARMED = **the bench is the only physical output** — all ship relay suspended and zeroed, and the sim's own :6972 output path **gated with an awaited ack**. The ARM/DISARM control moved to the **Controllers view header**; the sACN monitor is read-only. |
| **Root cause closed** | `_153` F1 / `_154` M1 — the sim window's hard-coded priority-150 stream through the SEPARATE :6972 process. Closed by a server-side gate the ARM refuses to proceed without (**R-23**), plus a client-side belt. |
| **Flicker closed** | `_153` §10 — composed destinations were emitted per libuv POLL PHASE, so a 3-source destination went out 1–3× per engine frame with 50–67 % of frames carrying a stale region (tearing), and the varying rate made the same-CID sequence offset beat against the sim's stream. Now: **one composed frame per destination per ENGINE frame**, emitted only when every required source has arrived. No timeout-emit fallback; a stalled source is named. |
| **Engine exception removed** | `controllers:` (direct-to-hardware unicast, sACN + Art-Net, `alsoFlat` dual-send) is **deleted** — config block, `lib/output_dispatch.js`, `lib/artnet_output.js`, their tests. The key is now **unrepresentable**: its presence is a loud boot refusal. Breadcrumbs scrubbed across docs, ops, memory, dossier and one test fixture (§7). |
| **Tests** | sim `npm test` **1875 / 1869 / 6** vs a measured pre-change baseline of **1834 / 1828 / 6** — **+41 tests, zero new failures, byte-identical failing list**. Engine `npm test` — see §8.2. `security_check.py --all` — the same 6 pre-existing gitignored findings. |
| **Status** | **NOT SHIP** — physical confirmation by the operator is a hard gate. `_158` returned **FIX-FIRST** (all closed and falsified — §13), then **READY FOR PHYSICAL SMOKE** on re-verification, with three residuals now also closed and falsified (**§14**). **A RE-SMOKE IS REQUIRED**: the operator's earlier pass ran against the pre-fix build — see the notice at the top of §9. |

---

## 1. What the operator sees

**The control moved.** `🪞 BENCH MIRROR: OFF — ARM` now lives in the **top header
of the 🎛 Controllers view**, next to the title. That is not cosmetic: the old
button lived in the 📡 sACN IN monitor, which is rendered **only** while the
lighting-engine mode is `sacn_in` — and `sacn_in` is exactly the mode that turns
every sim window into a hard-coded priority-150 writer to the ship's controllers.
The operator could not reach the button without being in the mode that defeated
the mirror at the box. **That placement was part of the defect** (`_153` §8.1,
`_154` §5 M1). The Controllers header is available regardless of lighting mode.

**ARM opens a picker** — one row per bench slot, one dropdown each, pre-filled
(last-used > sidecar default), `— none (held dark) —` always offered, `[↺ defaults]`
/ `[last used]` / `Cancel` / `🪞 ARM — N/M slots`. No presets, no scene picker: the
source scene is whatever the ENGINE is running.

**While armed** the header reads
`🪞 BENCH MIRROR: ACTIVE — TEST BENCH STAND-IN · SHIP OUTPUT SUSPENDED — 10 slot(s) mapped, 0 dark — DISARM`,
and the panel-independent HUD banner reads:

```
🪞 BENCH MIRROR ACTIVE — TEST BENCH STAND-IN ← titanic · ALL SHIP OUTPUT SUSPENDED
   — BENCH ONLY · 10 slot(s) mapped, 0 dark · owns U2→10.x.x.10, U10→10.x.x.60, U12→10.x.x.60
```

The banner leads with what changed about the **whole rig**, not with "armed": an
operator who reads only the first clause must still learn the ship stopped
receiving data.

---

## 2. The v3 sidecar — plumbing removed, not relocated

`simulation/scenes/test_bench/bench_mirror.yaml` is rewritten. It carries **no
universe, no DMX address, no slice length, no controller IP, no source scene and
no suppression policy** — a test asserts that no dotted quad and no plumbing key
appears outside comments (`tests/bench_mirror.test.js`, "live sidecar: parses as
v3, is enabled, and declares no plumbing").

```yaml
version: 3
enabled: true
label: Test bench stand-in
slots:
  - { slot: par_1, bench_fixture: Par 1, default_source: Left Auditorium 5 }
  … 10 slots …
```

**Why.** v2 duplicated every number out of the scene files by hand. Each could rot
independently, and the failure mode of a rotten one is pixel data landing in a
fixture's control channels — "random colours with a green log". v3 has no address
to typo because there is no address to author.

**Migration is a refusal, not a guess.** A `version: 1` or `2` file is refused at
parse with the migration spelled out (**R-20**), quoted verbatim into the ARM
refusal. `simulation/lib/bench_mirror.cjs:84` (`BENCH_MIRROR_VERSION = 3`),
`:104` (`V3_MIGRATION`), `:137` (`parseBenchMirrorSpec`).

---

## 3. Arm-time resolution — new pure module

**`simulation/lib/bench_mirror_resolve.cjs`** (new, ~700 ln incl. comments).
Pure: the bridge does the `fs` reads and hands parsed trees in.

| step | code | refuses with |
|---|---|---|
| resolve each bench slot from `patches` + `controllers` + `scene_config` + the fixture registry | `:167 resolveFixture`, `:379 resolveBenchMirror` step 1 | **R-16** (missing patch / no controller port / no fixture definition / kind underivable / inconsistent LED patch), **R-18** (one name, two `fixtureType`s) |
| derive `kind` (`dmx` / `led_strand` / `led_fixture`) — never declared | `:216-232` | R-16 |
| build the candidate pool per slot from the SOURCE scene | `:432-452` | **R-22b** (the engine's scene has nothing compatible with ANY slot) |
| apply the selection | `:455-508` | **R-12** unknown slot · **R-13** incomplete · **R-14** unknown source · **R-15** incompatible (names the failed rule: `kind` / `fixtureType` / `pixelFormat` / `pixelCount`) · **R-22c** a default that does not resolve in THIS scene |
| compute slices (pixel-space walk for LED, so a multi-universe strand works by construction) | `:322 computeSlices` | — |
| materialize + **re-validate** through the same structural validator a hand-authored map had to satisfy | `bench_mirror.cjs:237 validateMirrorTree` | **R-19** |

**Compatibility is by IDENTITY, not by shape** (`:269 checkCompatible`). A DMX slot
accepts only a source whose `fixtureType` string is identical, because both then
resolve through the ONE definition under `simulation/dmx/fixtures/<family>/model_*.yaml`
— identical footprint AND identical per-channel meaning, by construction. Footprint
equality alone is not enough; two 10-channel profiles can order their channels
differently. **This is the upgrade `_154` §7 asked for**, applied at runtime rather
than only in CI. There is no channel-map translation layer, deliberately.

The one asymmetry: `led_strand` allows `srcPx ≥ destPx` (prefix copy, warned —
ship ropes are 40 px, bench strands 20). `led_fixture` does not: a sign is a shape.

**The registry loader** (`:628 loadFixtureRegistry`) is the ONE impure function in
the file, kept there so there is exactly one reader of that directory — the
resolver's central claim ("both ends resolve through the same definition") is only
true if the bridge and the tests read it the same way.

---

## 4. ARMED = the bench is the only physical output

### 4.1 Global suppression

`partitionMirrorSuppression` (`bench_mirror.cjs:372`) degenerates to
**armed-or-blackout-hold ⇒ suppress everything**, with `why: 'armed' | 'blackout'`.
`suppress_host`, `mirrorOwnedHosts` and the v2 `controllers:` policy section are
gone — there is no scope left to declare when the scope is "everything". The
`_152` D1 single-call-site invariant is preserved with strictly simpler semantics
and is still pinned by an exact-count assertion (`hold: _blackoutHold` appears
exactly once, `sacn_bridge.js:704`).

### 4.2 The ship goes DARK, not frozen

`armBenchMirror` (`sacn_bridge.js:1779`), after every check passes and the gate is
acknowledged:

```
_relaySuspended = true;        // sync — routeFrame stops relaying THIS turn (:302, :2043)
_relayCloseHeld = true;        // sync — retiring senders stay open (:809)
_armBlackoutInFlight = true;   // sync — ARM/DISARM refused in this window (:319)
_mirrorArm = { … }             // sync
3× all-zero frames to every retiring relay sender, AWAITED   (:1874-1890)
recomputeRoutes(…)             // relay set empty ⇒ senders closed, mirror senders created
ownership proof                // R-127 snapshot: NO relay sender may survive at all
```

`_relaySuspended` is raised in the **same synchronous turn** as the arm, before any
`await` — otherwise a raw frame interleaves with the zeros on a pair being retired,
which is the `_152` D1 defect pointing the other way. `_relayCloseHeld` is the
mirror image of `_mirrorDisarming`: the `sacn` package cannot set E1.31's
`stream_terminated` bit and `Sender.close()` is socket teardown only, so the three
zeros ARE the termination mechanism and the socket must not close under them.

**Why dark and not frozen:** a DMX gateway has no timeout and the MarsinLED
`dmx.timeoutMs` is unwritten by this repo (`0` = hold forever, `_150` §9). A ship
frozen mid-pattern reads as alive to a passerby and as a bug to the operator.

### 4.3 The proof, not the intent

The post-recompute ownership check (`:1901-1946`) now additionally requires that
**no ordinary relay sender survived at all**; anything else auto-disarms and
returns the failure as the ARM's refusal.

---

## 5. The :6972 gate — the actual root cause

`_153` F1 / `_154` M1: in `sacn_in` mode the sim window unicasts every patched
universe of the loaded scene to its real controller at a **hard-coded priority
150**, through `server/sacn_output_bridge.js` — a **separate process** with no
route table, no scene and no notion of the mirror. Nothing inside `sacn_bridge.js`
can suppress it. 150 > the mirror's 100, so the bench played raw ship bytes.

**Output bridge** (`server/sacn_output_bridge.js`):

- one additive JSON control message (`:75 GATE_MESSAGE`, `:266 handleControlMessage`)
  — `{type:'benchMirrorGate', gate, reqId}` → `{type:'benchMirrorGateAck', reqId, gated, dropped}`;
- while gated, every 519-byte DMX frame is **dropped and counted** (`:175-178`);
- **the control channel is NOT deafened by the gate** (`_157` D2a): non-DMX frames
  reach `handleControlMessage` **before** the drop check (`:168` precedes `:175`),
  pinned by a source-ordering test — otherwise the gate could never be released
  over the link that raised it;
- the gate is released **loudly** when its control link drops (`:318
  releaseGateIfHeldBy`, wired at `:250`). Fail-safe direction: a crashed input
  bridge must never strand the rig dark;
- a second control link is refused rather than allowed to take the gate over —
  an ambiguous release is a ship that stays dark.

**Input bridge** (`sacn_bridge.js`): a loopback WS control link (`:1410
ensureGateLink`, `:1490 setOutputGate`, `:1464 onGateLinkLost`). ARM sends
`gate:true` and **awaits the ack before any suppression or composition**; no ack ⇒
**R-23 refusal** (`:1846-1853`). DISARM ungates **after** the relay is restored,
then closes the link. A link drop while armed **auto-disarms loudly** — the gate
went with it, so "bench only" is no longer provable.

**Client-side belt, never the lock** (`src/core/animate.js:681-694`): the sim tab
stops its own transmit loop on `benchMirrorStatus.armed`. Honest UI and less
loopback traffic; the SERVER gate is what covers stale tabs, windows opened after
the arm, and windows that never processed the status.

---

## 6. The cadence fix (`_153` §10) — one composed frame per ENGINE frame

**The defect.** `flushMirrors` coalesced over one libuv **poll phase**, not one
engine frame. The engine's five source datagrams do not reliably land in one
phase, so the DMX gateway (5 slices, 3 source universes) emitted **1.00–3.00**
composed sends per engine frame, 50–67 % of them carrying a region from the
previous frame — **sub-frame tearing**. The varying emission rate then made the
same-CID sequence offset against the sim's stream drift through all 256 values
every 1.6–6.4 s, so an E1.31 receiver's out-of-order discard produced multi-second
beats of sane-then-garbage. Single-source destinations were structurally immune,
which is exactly why **the DMX flickered and the LEDs did not**.

**The fix.** `createMirrorState` additionally returns
`requiredSources: Map<destKey, Set<universe>>` (`bench_mirror.cjs:658-700` (now `:672-736`)). The
bridge keeps `_mirrorSeen` beside `_mirrorDirty` (`sacn_bridge.js:2090`);
`mirrorInbound` (`:2108`) records the arriving universe; `flushMirrors` (`:2132`)
emits a destination **only when seen ⊇ required**, then clears. An incomplete
destination stays dirty and is **not** rescheduled from the flush (it can only
complete when another source arrives, and that arrival schedules the next flush —
rescheduling here would spin the event loop).

**No timeout-emit fallback** (codex P0). A stalled source stops that destination's
emission and is **REPORTED**: after ~250 ms a watchdog logs once per destination,
naming the missing universes, and re-arms when the missing set changes or the
destination completes (`:2160-2215`).

**H5 dies for free.** Buffer reuse is keyed on the parsed mapping, so a re-arm or a
state reset drops the buffers — and the first composed frame used to go out
304/344 channels black. Under the seen-covers-required gate nothing is emitted
until every source has arrived fresh, so a partly-black first frame is now
unrepresentable. Pinned by the "no composed frame is emitted until EVERY source
has arrived" test.

**Also fixed here:** the composed frame no longer inherits the inbound priority. It
emits at a **fixed declared `MIRROR_PRIORITY = 100`** (`:260`), which closes the
`_153` F3 corollary where a rogue priority-150 inbound would have exited the mirror
at 150. Priority escalation above 150 was **rejected** by the operator and is not
present.

**Distinct CID.** Mirror senders carry `defaultPacketOptions: { cid: MIRROR_CID }`
(`:271`, `:869`) — md5 of the fixed namespace string `bm26:bridge-mirror`, so it is
the same **exactly 16 bytes** on every machine and every boot. `_157` D3: a CID
must be exactly 16 bytes because the `sacn` package splices `[...cid]` unchecked; a
short one shifts the whole frame. Asserted by test. The project-wide CID split and
the `sacn_high_priority` raise are **separate later slices, not in this one**.

---

## 7. Removing the engine's direct-unicast exception (operator ruling 4 + addendum)

> Operator, verbatim: *"remove that shit! and remove all other exceptions like
> that too"* … *"please clean up the code and config so it's not a breadcrumb for
> other agents to do similar shitty things!"*

### 7.1 Deleted

| file | what it was |
|---|---|
| `marsin_engine/lib/output_dispatch.js` (292 ln) | per-controller routing: sACN unicast + Art-Net by host, `alsoFlat` dual-send |
| `marsin_engine/lib/artnet_output.js` (221 ln) | the Art-Net transport, reachable ONLY through `controllers:` |
| `marsin_engine/tests/io/output_dispatch.test.js` (378 ln) | exercised the removed mechanism |
| `marsin_engine/tests/io/artnet_output.test.js` (169 ln) | ditto |
| `marsin_engine/config.yaml` `controllers:` block | the `Titanic-202` → `10.x.x.202` U10/U12 `alsoFlat: true` entry |

`engine.js` now builds `createSacnOutput` directly (`:1419-1423`). `sacn_output.js`
is unchanged — it never handled `controllers:`; it streams to the flat
`sacn.destinations` and nothing else.

### 7.2 Made unrepresentable

**New `marsin_engine/lib/output_config_guard.js`** — `assertNoDirectHardwareRoutes(config, where)`,
called from `parseArgs()` on the parsed config (`engine.js:150-156`). A config that
still declares `controllers:` — **even empty** — makes the engine **refuse to boot**,
naming the key and stating where output actually goes. A stray top-level `alsoFlat:`
or `protocol:` is refused the same way. A silently-ignored routing key is a config
that looks like it reaches hardware and does not, which is a worse failure than the
one being removed.

`/status.outputRouting` **stays**, permanently `{ controllers: [] }`
(`lib/api_server.js:4995`). Its ABSENCE means something different to the sim bridge
— "this engine is too old to say what it delivers itself" — which makes one-writer
unprovable and is a hard refusal there (**R-8**).

**What that field does and does not assert — stated precisely (`_158` D-158-6).**
It asserts "this engine declares no PER-CONTROLLER route", which is now true by
construction. It does **not** assert "nothing this engine sends can reach hardware
directly": `sacn.destinations` still exists, by design — it is how the engine
reaches the bridge — and pointing it at a controller IP instead of `127.0.0.1`
would stream sACN straight to a box with the guard silent and `outputRouting`
still reporting `{ controllers: [] }`. `/status` exposes no destination list, so
neither R-8 nor R-21 can see it.

So **"made unrepresentable" is true of the removed MECHANISM and its key, not of
the capability.** That is the honest scope of the claim, and the residual is a
known, documented trap rather than a new one: it is exactly what
`.agent/memory/spawning_a_test_engine.md` warns about, and this slice rewrote that
memory to keep the warning current. Also uncovered by the guard, all inert but
breadcrumb-shaped: key case variants (`Controllers:`), nesting (`sacn.controllers`
— note `FORBIDDEN_NESTED` is checked only at top level), and post-guard mutation
of the config object.

### 7.3 Breadcrumb scrub — every file, and what the reference was

| file | the reference | what it says now |
|---|---|---|
| `docs/41_led_controller_onboarding.md` §5 step 3 | *"add a `controllers:` entry routing the LED universes … set `alsoFlat: true`"* — a live instruction | "nothing to do — the engine has ONE output path and the bridge is the single router"; engine-direct routes are forbidden and refused at boot |
| `docs/41` §6 Slice C | *"and the `marsin_engine/config.yaml` `controllers:` routing"* | "(No engine config change: the bridge routes every universe.)" |
| `docs/41` §7 Resolved | *"~~Dual-destination~~ — answered: `alsoFlat: true`"* | "moot — hardware AND sim is the only shape there is; the mechanism is removed and refused at boot" |
| `simulation/lib/bridge_routing.cjs:12-24` | flicker rationale citing *"config.yaml `controllers:` + `alsoFlat: true`"* | rewritten: mechanism removed; the engine-owned subtraction **stays** because "the engine declares no direct routes" must be PROVEN from `/status` on every poll, not assumed |
| `.agent/ops/engine_model_refresh.md:29-31` | runbook note crediting `output_dispatch.js` create-sender-on-demand | credits `lib/sacn_output.js` `addUniverse` |
| `.agent/memory/spawning_a_test_engine.md` | a memory FACT whose whole premise was "`--dest` cannot cover `controllers:`" | rewritten: the mechanism is removed and refused at boot; the remaining (real, smaller) trap — `sacn.destinations` defaults to loopback, and the bridge relays onward — is kept |
| `.agent/projects/bm_readiness_mapping.md` | dated log entries naming `output_dispatch.js` / `alsoFlat` | **history left intact**; a standing correction added at the top saying the mechanism is GONE and no entry below describes an available option |
| `simulation/tests/bridge_routing.test.js:156-175` | `engineOwnedPairs` fixture using `Titanic-202` + `alsoFlat: true` + `protocol: 'artnet'` | synthetic `10.9.9.x` hosts, no `alsoFlat`, no protocol; comment states the parser stays because **R-21** is only meaningful if a non-empty payload still parses |
| `marsin_engine/tests/e2e/timeline_e2e_harness.mjs:11-22, 99-124, 375-384` | wrote `cfg.controllers = []` as "wall 1" and asserted an Art-Net sender was absent | **deletes** the key (an empty one is itself refused → unbootable); the black hole in `sacn.destinations` is now the whole wall; the Art-Net assertion is dropped |
| `marsin_engine/tests/e2e/timeline_zoom_e2e.test.js:86-93` | asserted `controllers: []` was present in the spawned config | asserts the key is **absent**, citing the boot refusal |
| `marsin_engine/tests/helpers/setup_config_guard.mjs:7-8, 18-21` | comments about preserving "`controllers:` routing examples" | rewritten |
| `marsin_engine/tests/state/scene_reload_api.test.js:9-11` | *"the config.yaml `controllers:` block routes to hardware"* | rewritten: `--dest` can no longer be bypassed |

**Nothing load-bearing was deleted by mistake** — the two deleted `lib/` modules had
exactly one consumer between them (`engine.js`), the two deleted test files
exercised only those modules, and `engineOwnedPairs` (the bridge-side parser) is
deliberately RETAINED and still tested.

**Left alone deliberately:** `docs/08`, `docs/09`, `docs/10`, `docs/11` reference an
Art-Net *DMX controller subsystem* that predates and is unrelated to the engine's
`controllers:` block; `docs/33` and `simulation/tests/per_output_push.test.js` use
`controllers:` / `Titanic-202` as **scene** `controllers.yaml` names, a different
thing entirely; `docs/MARSIN_PB_LANG_SPEC.md` `controllers:` is a pattern-language
key. The `.agent/reports/**` and the tracker are historical records and are not
rewritten.

### 7.4 Correction to the risk note in my brief

`_157` **D6** corrected `_153` F4: the removed block carried **`alsoFlat: true`**
(present since c6eaa733, July 15), so U10/U12 **already reach loopback** and the
bridge already relays them to the ship's boxes. The caveat in my brief — *"Left Back
Wall 3/4 + SmokeStacks may go dark"* — is **WRONG and is struck**. Removing the
block kills only the redundant direct `.202` stream. **Removal is strictly safe.**
(Whether `.202` is a live board at all remains a needs-live-capture question, and
is irrelevant to this change.)

---

## 8. Verification

### 8.1 Simulation suite

| | tests | pass | fail |
|---|---|---|---|
| **Baseline, measured on this tree before any edit of mine** | 1834 | 1828 | **6** |
| **After** | **1875** | **1869** | **6** |

**+41 tests, zero new failures, byte-identical failing list** — all six pre-existing
and unrelated: `fixtures are docked beside the ship…`, `REFUSES: a patched fixture
no chain reaches…`, `the real titanic scene can accept the block today…`, the two
scene-block CLI cases, `the compression threshold has real headroom…`.

Focused: `bench_mirror.test.js` **49/49**, `bench_mirror_resolve.test.js` **32/32**,
`bench_mirror_arm.test.js` **51/51**.

What the new tests prove, by requirement:

| requirement | evidence |
|---|---|
| v3 schema, every refusal named; v1/v2 refused BY NAME with migration | `bench_mirror.test.js` — 14 schema cases incl. `_155 R-20` |
| computed-spec validator keeps every v2 structural invariant; empty slices now LEGAL | `bench_mirror.test.js` — `R-19` + `§6.1` |
| resolver: every R-16 link broken individually, R-18, R-12/13/14/15 (rule named), R-19, R-22b/c | `bench_mirror_resolve.test.js` tier 1 |
| **byte-level per slot**, deterministic red/green/blue/white/black; untouched channels 0; `none` all-zero; fan-out byte-identical; strand prefix + NATIVE-WHITE stride; the CHOSEN source lands | `bench_mirror_resolve.test.js` tier 2 (6 cases) |
| **default-equivalence pin**: computed default ≡ frozen v2 seven-slice table, as a (destU, destHost, destCh) → (srcU, srcCh) function | `bench_mirror_resolve.test.js` `_155 T-5` — 504 channels, hard-coded v2 table in the test |
| `_154` §7 footprint → **fixtureType** equality | `bench_mirror_resolve.test.js` `_154:` … *"not merely the same width"*, 8/8 DMX slots |
| gate: gate/ungate/ack, drop counting, ARM refuses without ack (R-23), link-drop auto-ungate **and** auto-disarm, control channel not deafened while gated | `bench_mirror_arm.test.js` `R-23`, `A2/A3`, `A3: losing the gate control link` + `bench_mirror.test.js` output-bridge ordering assertion |
| ship-dark-on-ARM: 3× zeros to EVERY relay route, zeros before close, relay set empty, only bench destinations survive | `bench_mirror_arm.test.js` `_155 A2/A3` |
| DISARM restores the FULL relay set and ungates | `bench_mirror_arm.test.js` `_155: DISARM …` |
| **cadence**: exactly 1.00 composed send per destination per engine frame under adversarial per-poll-phase arrival; **tearing 0**; single-source unaffected; watchdog fires and NAMES the missing universe; nothing emitted before the first complete frame | `bench_mirror_arm.test.js` — 4 `_153 §10` cases |
| CID distinct + **exactly 16 bytes**; fixed priority 100; no escalation | `bench_mirror_arm.test.js` `_155 A4` + `bench_mirror.test.js` |
| **8 header-control states**, exact text; refusal renders beside the control | `bench_mirror_arm.test.js` `_155 §8.2` |
| **no actionable ARM remains in the sACN monitor** | `bench_mirror_arm.test.js` `_155 §8.5` (greps the panel for `armBenchMirror`/`runBenchMirrorAction`/the old button id, and pins the control's new home) |
| picker: pre-selection precedence, `none` everywhere, zero-candidate row, duplicate badge, refusal verbatim with no confirm | `bench_mirror_arm.test.js` `_155 §8.3` ×2 |
| **_152 D1** no raw frame between blackout frames, no relay `open`, no mirror `close` — under live traffic on every owned universe | carried forward, adapted to v3 |
| **_152 D2** ARM refused mid-blackout, log never says ARMED between DISARMING and DISARMED | carried forward |
| **_152 RESIDUAL-1** a throw in the disarm prologue does not leak the hold | carried forward |
| **_152 D5** runtime `ownedUnavailable` degrade; engine scene change; **new:** engine acquiring a direct route (R-21) | 3 auto-disarm cases |
| armed OFF at every start; process-memory arm **and** process-memory `_lastSelection` (persistence grep extended) | `bench_mirror.test.js` ×2 |
| socket-scoped disarm; status on connect; late tab told the truth | carried forward |

**The rig is stronger than `_151`'s:** it now loads **both** real bridge modules and
wires a faked loopback WebSocket between them, so the gate is exercised across the
real two-process boundary. Zero ports bound, zero packets, every "send" in an array;
the teardown test asserts the class identities.

### 8.2 Engine suite

| | tests | pass | fail |
|---|---|---|---|
| **Baseline, measured on this tree before any edit of mine** | 2657 | 2650 | **7** |
| **After** | **2631** | **2624** | **7** |

**Byte-identical failing list**, all seven pre-existing and environmental:
`reframes mixed-size byte chunks…`, `emits status lifecycle: starting → running →
stopped`, `exponential backoff doubles on unexpected exit…`, `stop() during
pending restart…`, `a throwing onFrame does not break framing…` (the five
audio-capture/supervisor cases), `startAsync rejects with EADDRINUSE when port is
already bound`, and the file-level
`tests/effects/effects_v2_mode_page_layout.test.js`.

**The −26 is the removal, not a regression:** 24 tests in `output_dispatch.test.js`
+ 11 in `artnet_output.test.js` = **35 removed with the mechanism**; **+10 added**
(9 in the new `output_config_guard.test.js`, +1 in the rewritten
`status_output_routing.test.js`) — a static net of **−25**. Verified by per-file
counts, not inferred from the total.

**The engine total is not a stable number** (`_158` D-158-9, independently
reproduced): `tests/effects/effects_v2_mode_page_layout.test.js` declares 47 cases
and fails at FILE level partway through, so the run-to-run total drifts by ±3 with
a byte-identical failing list. Observed across runs: **2631–2634 tests /
2624–2627 pass / 7 fail**. Quote the range, not a point.

**One intermediate run is worth recording** because it is the guard proving itself:
before the e2e-harness rewrite, the engine suite went to **26 failures** — every
engine-spawning e2e case. Cause: `timeline_e2e_harness.mjs` wrote
`cfg.controllers = []` as its "wall 1", and the new boot guard **correctly refuses
an empty `controllers:` key too** (the key IS the breadcrumb). The harness now
DELETES it, which is both safer and the only bootable shape. That failure mode is
exactly what the guard exists to produce, on the first config that still carried
the removed key.

New engine test: `marsin_engine/tests/io/output_config_guard.test.js` — 9 cases
(clean config passes; `controllers:` refused by name; an EMPTY `controllers:`
refused too; stray `alsoFlat:`/`protocol:` refused; the refusal names the file it
read; the repo config is clean; the two modules are GONE from the tree; `engine.js`
imports the flat sender and runs the guard; `/status` still declares
`outputRouting: { controllers: [] }`).

### 8.3 Gates

- `node --check` on all 12 touched/added JS files — clean.
- `python scripts/security_check.py --all` — **6 findings, all the pre-existing
  MAC in gitignored `simulation/.scene_backups/studiodj/**`**. Identical to the
  recorded baseline; nothing in any file this slice touched.
- **No new test file carries a real controller address.** Synthetic addresses are
  `10.9.9.x` placeholders in the suite's established style; the arm suite and the
  live tier derive every real address from scene data. Even the frozen v2
  equivalence table takes its two HOSTS from `test_bench/controllers.yaml`
  (identified structurally — the controller whose port carries U2 is the gateway,
  the one carrying U10 is the LED box); every NUMBER in that table is frozen,
  which is the part the pin is about. `grep -cE '\b10\.1\.1\.[0-9]+'` over the
  three new/rewritten sim test files and the new engine test: **0**.

### 8.4 Working-tree honesty (read-only proof)

Mtimes + sizes of all 39 pre-existing working-tree files were recorded **before the
first edit** (`~/tmp/bm156_mtimes_before.txt`) and re-measured after. **Every one of
the operator's unrelated files is byte-for-byte untouched** — identical mtime AND
size: `marsin_engine/models/test_bench{,.effects,.viewmasks}.js`,
`patterns/00_golden_hour_wash.js`, `states/test_bench/**`,
`states/titanic/{deck,mixer}_state.yaml`, `scenes/common.yaml`, every playlist,
`scenes/test_bench/{controllers,patches,scene_config}.yaml`,
`scenes/titanic/pixel_map_views.yaml`, `scenes/titanic/playlists/default.yaml`.

**Exceptions, all reported rather than reverted:**

1. `marsin_engine/states/titanic/*_state.yaml` and
   `simulation/scenes/titanic/playlists/default.yaml` were rewritten during the
   session by **running `cd marsin_engine && npm test`** and/or by the operator's
   own live stack, which runs from this tree. That suite spawns real engines, and
   AGENTS.md records engine state residue as expected ("report it, don't commit or
   silently revert it"). **None of these is an edit of mine** — I opened no
   `states/`, `playlists/` or scene file. `_158` disclosed the same class for
   `states/titanic/{deck,globals,mixer}` and noted that part of that residue is
   its own, from running the engine suite twice during the review. The exact file
   list therefore differs run to run; the category is what matters, and no
   canonical mapping file (`controllers.yaml`, `patches.yaml`, `scene_config.yaml`
   in either scene) is touched by any of it.
2. `.agent/memory/bm_readiness_thread_tracker.md` and
   `.agent/reports/202608/20260805_153_*.md` grew during my session — the `_153`
   §10 addendum and the `_157` landing, written by other agents, not by me (my
   tracker block is appended at the end of this slice).

---

## 9. OPERATOR SMOKE PROCEDURE

> ## ⚠ THE EARLIER SMOKE DOES NOT COUNT — RE-SMOKE IS REQUIRED
>
> Your first physical pass ran against the **pre-fix build**. Three things have
> changed since, each of which alters what the bench does:
>
> 1. **The arm path gained a gate proof.** The sim's own priority-150 output path
>    is now gated at `:6972` and the ARM **refuses** without an acknowledgement
>    (R-23) — and, since `_158`, re-proves the gate after the ship-dark blackout.
>    The second writer that defeated the first test cannot be present during a
>    successful arm.
> 2. **The emit condition is stricter.** A composed frame goes out only when every
>    region of it carries the *same* engine frame. Destinations that used to emit
>    something torn now emit **nothing** and say so.
> 3. **Held-dark destinations now TRANSMIT.** A slot set to `none` is actively
>    driven with all-zero frames instead of being left unwritten, so a box that
>    used to freeze now goes dark.
>
> A pass on the old build tells you nothing about this one.

> **Read the LOGS, not the fixtures.** `_154` M2: "mirror inactive" and "mirror
> armed but outranked" are **visually identical**. A smoke PASSES only on the
> bridge's own transition lines. Also, `_153` §10: "looks sane for a few seconds,
> then degrades" was the OLD build's sequence-beat signature — after this slice,
> **any recurrence of that signature means a second writer survived and the smoke
> has FAILED.**

### 9.0 Before anything

The engine will **not boot** until `marsin_engine/config.yaml` has no
`controllers:` key. This slice already removed it. If you restore an older config,
the engine refuses by name — that is the guard working.

### 9.1 Restart

```
1. Stop the launcher and the engine.
2. cd simulation && npm start          (or the launcher as usual, scene: titanic)
3. cd marsin_engine && node engine.js --model titanic --pattern <your pattern>
```

**Expect in the launcher terminal:**

```
[sACN Output Bridge banner]
  Bench Gate  : UNGATED (the input bridge gates this process while the BENCH MIRROR is armed; …)

[sACN Bridge banner]
  Bench Mirror        : DISARMED (runtime mode, process memory only — arm it from the sim's
                        🎛 Controllers view header; every start comes up disarmed)
  Bench Mirror Scope  : while ARMED the bench is the ONLY physical output — all ordinary relay is
                        suspended and zeroed, and the sim's output bridge on :6972 is GATED
                        (the ARM refuses without that gate's ack)
```

**Engine side:** `[Output] Dispatch started` is GONE (that module no longer exists).
Expect `[sACN Out] Sender started — N universe(s), priority 100, destinations [127.0.0.1]`
and **no Art-Net line at all**.

### 9.2 Arm

1. Open the sim (one window, scene `titanic`). Open the **🎛 Controller Mapping**
   panel. Its header shows `🪞 BENCH MIRROR: OFF · Test bench stand-in ready · ARM`.
   The lighting-engine mode does **not** matter for this control any more.
2. Press **ARM**. A picker opens: 10 rows, each pre-filled with the sidecar default
   (`par_1 ← Left Auditorium 5`, …, `led_1 ← Left_Back_Left`). Change anything you
   want, or press **🪞 ARM — 10/10 slots**.

**Expect in the launcher terminal AND the sACN IN monitor's activity log** (IPs
redacted here only):

```
[sACN Bridge] ⛔ sim physical output GATED at :6972 — acknowledged (gated=true). No sim window
              can reach a controller while armed.
[sACN Bridge] 🪞 BENCH MIRROR ARMED — TEST BENCH STAND-IN ('titanic' → 'test_bench').
              Owned destinations: U2 → 10.x.x.10, U10 → 10.x.x.60, U12 → 10.x.x.60.
[sACN Bridge] 🪞   par_1          ← Left Auditorium 5      (U6/1 → U2/1 (UkingPar, 10 ch))
[sACN Bridge] 🪞   …one line per slot…
[sACN Bridge] 🪞   led_0          ← Left_Front_Left        (U30/1 → U10/1 (RGBW × 4, first 20 of 40 px))
[sACN Bridge] ⚠ 🪞   ALL ordinary relay will be SUSPENDED — N route(s) across M controller(s) …
[sACN Bridge] ⛔ SHIP GOING DARK — 3× all-zero frames to N suspended relay route(s) before their
              senders close. Dark, not frozen: …
[sACN Bridge] ⛔ ALL ordinary relay SUSPENDED (N route(s) across M controller(s), zeroed 3×) —
              the bench is the only physical output while armed. Suspended: …
[sACN Bridge] 🪞 BENCH MIRROR ACTIVE — TEST BENCH STAND-IN: scene 'test_bench' is showing
              'titanic' fixtures.
[sACN Bridge] 🪞   composes U2 → 10.x.x.10 (8 slice(s), 344 ch, from U6+U5+U2)
[sACN Bridge] 🪞   composes U10 → 10.x.x.60 (1 slice(s), 80 ch, from U30)
[sACN Bridge] 🪞   composes U12 → 10.x.x.60 (1 slice(s), 80 ch, from U31)
```

**Every one of those four line-classes must be present.** In particular:

- **no `GATED … acknowledged` line ⇒ the ARM refused** with `ARM refused [R-23]`.
  That is the guard doing its job; the output bridge is not running or not current.
- **no `SHIP GOING DARK` / `relay SUSPENDED` ⇒ the ship is still being fed** and the
  smoke is invalid.

**Physically, expect:**

- **The whole ship goes DARK** — not frozen. That is deliberate and is the ruling.
- **The bench plays the ship's left front**: 4 pars, both vintage heads, both bars.
- **The bench LED strands** show the first 20 px of the two ropes — **if and only if**
  the `.60` board is actually running the bench binding. Its `Titanic_202` card's
  last push receipt still reads `needs-reboot`; if it has not been rebooted since,
  it is on U30/U31 and the mirror's frames are discarded at the box. With the ship
  relay suspended, **dark strands now mean exactly that** and nothing else.
- **Nothing else anywhere is lit.**

### 9.3 Reading a failure without eyeballs

> **Check for these THREE lines before anything else.** Each names a state whose
> physical symptom would otherwise be misread — two of them as "the fixture menu
> is wrong", which is the wrong place to look.

| symptom | read this |
|---|---|
| **an `UNGATED` line appears AFTER arming** | The gate was lost. Every sim window is a priority-150 writer to the ship again, so **STOP THE SMOKE** — nothing the bench shows from that moment means anything. The arm should have failed with a gate refusal (`_158` D-158-1); if it reported success instead, that is a defect, not a hardware problem: report it rather than re-arming over it. |
| **a fixture shows a STEADY wrong colour** (not flicker) | Look for `🪞 BENCH MIRROR frame NOT WHOLE — … regions carry DIFFERENT engine frames (U6#41 U5#41 U2#40)`. That is a lost or lagging source datagram: the mirror is **deliberately not sending** that destination rather than emitting a frame with one stale region. A one-off realigns on the next frame; a rising count means the mirror is dropping engine frames. **Do not go to the fixture menus for this one.** |
| **the bench is DARK where it should be lit** — pars/vintage/bars silent while the LED strands still run | Look for `❌ 🪞 BENCH MIRROR STUCK — … FIXED sequence offset (U5 at -7)`. The engine's sACN senders have drifted permanently out of lockstep, which is what a **model reload** does — a sender created later starts its sequence at 0 and never catches up. This is **not** network loss and it will **not** recover on its own. **RESTART THE ENGINE**, then re-arm. Single-source destinations (the LED strands) are structurally immune, which is exactly why only the multi-source DMX gateway goes quiet — that asymmetry IS the signature. |
| **a bench fixture is FROZEN on an old look** | A frozen fixture is not a dark one, and while armed **nothing on the bench should ever freeze**: a slot set to `none` is driven with continuous all-zero frames (including when EVERY slot is `none`), so it goes dark rather than holding. A frozen box means its destination stopped being emitted — look for the `NOT WHOLE`, `STUCK` or `source stalled` line naming it. |
| bench shows garbage | Is `composes U2 → …` present? Is `GATED … acknowledged` present, with **no** later `UNGATED`? If so, the mapping is verified from scene data — suspect the **physical fixture's personality/menu** (pars 10-ch, vintage 33-ch, bars 119-ch) or its DMX start address. The ARM prints this warning for exactly this reason. |
| bench flickers, or "fine then garbage after a few seconds" | **FAILED smoke.** That is the sequence-beat signature of a second writer. Check for a `BENCH MIRROR source stalled` line, and capture the wire (`_153` §7A) — the mirror's frames now carry a distinct CID, which finally makes a capture attributable. |
| a destination is silent | Look for `⚠ 🪞 BENCH MIRROR source stalled — <dest> has been waiting Nms for U…`. That names the engine universe that stopped. The bridge deliberately sends nothing rather than a half-fresh frame. |
| ship not dark | Look for `SHIP GOING DARK` and `relay SUSPENDED`. If they are absent, the arm did not complete. |
| ARM button disabled | The text beside it says why: `LINK DOWN`, `UNKNOWN`, `nothing armable`, `N candidates`, or the last refusal verbatim. |

### 9.4 Disarm

Press **DISARM** — or just close the sim window that armed it (the arm is scoped to
that socket).

```
[sACN Bridge] 🪞 BENCH MIRROR DISARMING (operator) — the operator pressed DISARM. Sending
              3× all-zero frames to U2 → 10.x.x.10, U10 → 10.x.x.60, U12 → 10.x.x.60 before
              releasing the senders.
[sACN Bridge] Route created: … (one per restored ship route)
[sACN Bridge] ▶ sim physical output UNGATED at :6972 (N frame(s) were dropped while armed).
[sACN Bridge] 🪞 BENCH MIRROR DISARMED — test_bench → titanic released. The FULL ordinary relay
              is back …
```

Verify: the **ship lights up again**, the bench goes back to raw titanic bytes on
its gateway (lit, wrong fixtures — that is the ordinary single-scene shape, not a
mirror bug), and the header returns to `OFF`.

**A brief settle at the boxes right after DISARM is EXPECTED and normal** (`_157`
D2b): recreated senders restart their E1.31 sequence at 0, and a receiver may
discard for a short window. A **sustained** unsettled look is not normal.

### 9.5 What to do if the strands stay dark

Open the **test_bench** scene's controller pane, review the `Titanic_202` card,
press **Push** once, let it reboot. That is a device write and an operator gesture,
not an agent action, and it is a revert to the bench binding rather than a new
mapping.

---

## 10. Refusal catalog, as built

| # | when | where |
|---|---|---|
| R-5b | a blackout is in flight (EITHER direction) — checked first | `bench_mirror.cjs:470` |
| R-1 | the arm message names no scene | `:477` |
| R-2 | that scene's sidecar does not parse (parse error quoted; covers **R-20**) | `:484` |
| R-3 | that scene declares no sidecar (lists the ones that do) | `:492` |
| R-4 | `enabled: false` | `:500` |
| R-5 | already armed (same scene or another) | `:507`, `:512` |
| R-6 | engine unreachable — the source scene is unprovable | `:521` |
| R-7 | engine reports no active scene | `:527` |
| R-22a | the engine is running the stand-in scene itself | `:534` |
| R-8 | `ownedUnavailable` — engine ownership unprovable | `:542` |
| **R-21** | **ANY** engine-direct destination (subsumes old R-9/R-10, strictly stronger) | `:555` |
| R-11 | another enabled sidecar resolves onto an overlapping destination | `:568` |
| R-12 | selection names an unknown slot (lists the declared ones) | `bench_mirror_resolve.cjs:463` |
| R-13 | selection is incomplete (`none` is a choice, absence is not) | `:471` |
| R-14 | selection names a fixture the source scene does not patch | `:481`, `:486` |
| R-15 | incompatible choice — the failed rule is named | `:491` |
| R-16 | a bench slot cannot be resolved — the missing link is named | `:400` |
| R-18 | one fixture name, two `fixtureType`s | `:400` (id branch) |
| R-19 | the COMPUTED mapping fails structural validation | `:558` |
| R-20 | v1/v2 sidecar, with the migration text | `bench_mirror.cjs:104`, `:145` |
| R-22b | the engine's scene has nothing compatible with ANY slot | `bench_mirror_resolve.cjs:453` |
| R-22c | a `default_source` that does not resolve in THIS source scene | `:477` |
| **R-23** | **the :6972 gate was not acknowledged** | `sacn_bridge.js:1846` |
| — | DISARM refused while the ARM's ship-dark blackout is in flight (symmetric with D2) | `sacn_bridge.js:1734` |
| — | ownership could not be proven after the recompute (incl. any surviving relay sender) ⇒ auto-disarm + refusal | `sacn_bridge.js:1935` |

Auto-disarm reasons: sidecar stopped parsing / disappeared / `enabled: false`;
engine unreachable; engine left the computed source scene; `ownedUnavailable`;
engine took ANY direct route; **the armed mapping no longer resolves, or resolves
differently** (a scene edit does not hot-reshape live hardware — re-arm to pick it
up); **the :6972 gate control link dropped**.

---

## 11. Not done / open / for the reviewer

- **NOT SHIP.** Physical confirmation is the operator's gate. §9 is the procedure.
- **Engine full-suite comparison** — re-run `cd marsin_engine && npm test` against
  the recorded **2657 / 2650 / 7** baseline. The e2e harness rewrite (§7.3) is the
  change most likely to need another pass; the sim suite is clean at 1875/1869/6.
- **Explicitly NOT absorbed** (separate slices, after this merges, to avoid
  same-file conflicts — `_157` §11): **D1** raw-DMX ×2.55 fix (its own operator
  gate and before/after capture — landing it inside the mirror-retest window would
  make the retest unreadable, `_153` §8 sequencing), **D3** per-role CIDs
  project-wide, **D4** per-universe arbitration + `sacn_high_priority` raise,
  **D5** `PacketOutOfOrder`/`PacketCorruption` listeners.
- **Deviations from `_155`, with justification:**
  1. **No per-controller-card badges in the Controllers body** (§8.4). The legacy
     editor is 3004 lines with its own handler ownership; the badge is decoration,
     the header control and the HUD banner already carry the truth, and the brief's
     test list does not ask for it. Recorded rather than silently skipped.
  2. **R-11 compares COMPUTED destination pairs**, not declared text — the bridge
     resolves other enabled sidecars best-effort and passes `otherClaims`. v3
     sidecars have no destinations until resolved, so there is nothing else to
     compare. (Structurally unreachable while only one arm can exist at a time;
     kept as the guard that makes it stay that way.)
  3. **DISARM is refused only for the OPERATOR path while the ARM blackout settles**;
     internal auto-disarm paths **await** it instead. Refusing an auto-disarm would
     leave the bridge armed with nobody to press the button. The UI disables both
     buttons on `blackoutInFlight`, which is what §8.2 state 8 specifies.
  4. **`validateMirrorTree` allows empty `slices`** where the v2 parser refused
     them — an all-`none` destination composing zeros is the ruling (§6.1), not an
     authoring accident. **CORRECTED after `_158`:** allowing the empty spec was
     right, but the runtime then never emitted such a destination at all, so the
     box HELD ITS LAST LOOK. The ruling says *composes all-zero frames*, and it
     now does — see §13 D-158-2. As originally filed, deviation 4 was a
     weakening, not a deviation.
- **Accepted gaps, carried from `_152`:** the SIGINT/SIGTERM mid-blackout path is
  read-verified but untested (stubbing `process.exit` inside the shared bridge
  instance risks hanging the runner for less than it proves); Tier-2 order
  dependence remains (Node's module cache means one bridge instance per file), now
  with each case arming/disarming within itself and waiting on the bridge's own
  completion broadcasts.
- **Operator-only, unchanged:** the `.60` board's applied binding (`needs-reboot`
  receipt still open) and the `controllerId` divergence for `boardId: angio4-old`
  (`testbench` in titanic vs `titanic_202` in test_bench). Both now surface
  honestly: with the ship relay suspended, dark strands mean the board is not on
  U10/U12.

---

---

## 13. POST-REVIEW FIXES (`_158` verdict: FIX-FIRST)

Adversarial review `.agent/reports/202608/20260805_158_bench_mirror_v3_adversarial_review.md`
confirmed most of the rebuild under attack — the default-equivalence pin
independently re-derived at 504/504, the ARM-side one-writer discipline, the
`_152` regressions still falsifiable, the monitor genuinely inert, the engine
deletions complete with no dangling references — and returned **one blocking
defect plus two that had to be fixed before touching hardware**. All are fixed
here, in this same slice. Each of the three is **falsifiable**: a scratchpad
preload rewrites the module source at compile time to neutralise exactly one fix,
and its regression then fails (§13.6).

### D-158-1 (BLOCKING) — the gate failed OPEN during the ARM blackout, silently · FIXED

**The defect.** `onGateLinkLost` early-returned on `blackoutInFlight()`, and
`armBenchMirror` holds `_armBlackoutInFlight` across its **awaited** ship-dark
blackout. A control-link loss inside that window therefore recorded nothing,
fired no auto-disarm, and was never re-checked — the post-recompute ownership
proof verified mirror senders, relay senders and engine-owned pairs, but **never
the gate**. There was no recovery either: `onGateLinkLost` early-returns on
`_gateLink === null` forever after. The arm completed and reported `armed: true`
while the output bridge had already released its gate (its own fail-safe close
handler), so every sim window in `sacn_in` was a priority-150 writer to the ship
again — with the HUD banner reading `ALL SHIP OUTPUT SUSPENDED — BENCH ONLY`.
That is the exact `_153` F1 failure the whole rebuild exists to close, restored
silently. The reviewer measured one priority-150 frame reaching the ship gateway
with the arm reporting `armed:true, refusal NONE`.

**The fix — the gate is part of the PROOF, not an assumption.** Both halves the
reviewer offered, because the sticky record is what makes the proof able to see a
loss that has since "healed":

- `sacn_bridge.js:1405` — `_gateLostWhileArmed`, a **sticky** record of a gate
  loss at any point during the live arm. Cleared only when an arm begins
  (`:1912`) and when a disarm completes (`:1777`) — **never** by a successful
  reconnect, because a link that died and came back still means frames may have
  escaped.
- `sacn_bridge.js:1473-1503` — `onGateLinkLost` now records **before** the
  blackout branch, and shouts on the deferral rather than returning in silence.
- `sacn_bridge.js:1534` — new `proveOutputGateHeld()`: three independent
  conditions, all required — no sticky loss, a live link, and the output bridge
  **re-acknowledging the gate now** (idempotent: it acks `gated:true` to the
  socket already holding it).
- `sacn_bridge.js:2002` — the ownership proof consumes it:
  `if (gateFailure !== null) unproven.push(gateFailure);`. Any gate failure now
  takes the same path a surviving relay sender does — auto-disarm through the
  normal blackout, which restores the full relay set, so a failed arm can never
  strand the ship suspended.

**Regression** (`tests/bench_mirror_arm.test.js`, "a gate lost INSIDE the arm
blackout fails the arm — it is never swallowed"): the reviewer's scenario
verbatim. It first proves the bridge CAN arm (warm-up arm + disarm), then kills
the output bridge's control link **on the first ship-blackout zero frame** via a
one-shot send hook — the only way to land inside the awaited window — and makes
**one** arm attempt, deliberately, because a retry helper would simply re-arm
over a healed link. It asserts: the arm reports `armed:false` with a refusal
naming the gate; both the deferred loss and the arm failure are logged; the
bridge does not settle into any steady `armed:true` state afterwards; and the
ordinary relay is feeding the ship again.

### D-158-2 (MEDIUM) — "none (held dark)" left the box FROZEN, not dark · FIXED

**The defect.** A destination whose slots are all `none` has zero slices, so it
never entered `bySource`, was never marked dirty and was **never emitted**. The
mirror sender existed and the destination reported as owned, but nothing was ever
written to it — the box held its last look. `_155` §6.1 rules the opposite
("composes all-zero frames … dark where unselected"), and `_156` §11 deviation 4
cited that ruling as its justification: the ruling was quoted correctly and not
implemented. One picker click reaches it, on the `.60` box whose applied binding
is already the open question — so a frozen strand would have been misread as
that.

**The fix** — `bench_mirror.cjs:672-712`: a slice-less destination is registered
with `requiredSources` = **every source universe the whole mapping reads**, plus
zero-length `bySource` entries that write nothing and exist only to make it
reachable from `spliceMirrorFrame`'s `touched` set. Its tick is therefore the
mapping's own engine frame: a dark box is refreshed at exactly the same rate as a
lit one, never faster, and never on a bare poll phase.

**Regression**: arm with `led_0: none`, pump six engine frames, and assert that
destination receives ≥5 frames, every one a full 512 channels of zeros, and that
its frame count **equals** the lit gateway's — dark, at the same cadence, not
silent and not spinning.

### D-158-3 (MEDIUM) — the cadence gate tested PRESENCE, not frame identity · FIXED

**The defect.** `seen ⊇ required` asked "have all my sources arrived?" and never
"did they arrive for the SAME engine frame?". With the sources split across poll
phases — the exact arrival pattern the fix exists for — one lost datagram shifted
the gather boundary permanently: the destination completed every frame, emitted
1.00 times per frame, passed every count-based assertion, and carried one region
one engine frame stale **forever**, with zero log output. The reviewer measured
7/7 post-drop frames torn, 40 of 344 mapped channels permanently behind. The
symptom is a **steady wrong region**, not flicker, so §9.3's "flicker ⇒ second
writer" rule would not have caught it and the smoke could have passed with four
pars a frame stale.

**The fix — use the frame identity E1.31 already carries.** The engine's senders
are created together and each advances once per universe per frame, so every
universe of one engine frame carries the **same sequence number**, and a lost
datagram simply leaves one region holding an older one.

- `sacn_bridge.js:2229` / the receive handler — `routeFrame` and `mirrorInbound`
  now carry `packet.sequence` through to the composition gate.
- `sacn_bridge.js:2090`, `:2108-2120` — `_mirrorRegionSeq` records, per
  destination, which engine frame each REGION of the composed buffer is holding.
  Never cleared while the destination lives, because the buffer is not cleared
  either.
- `sacn_bridge.js:2181` — the emit condition is now: every required source
  present **and** all their sequences equal. Exact, no baseline, no calibration,
  and it self-heals — the region that missed a frame keeps its older sequence,
  that frame is not sent, and the next frame realigns everything.

**Reported immediately, not after a settling window** (`:2190-2215`). A *missing*
source is normal for the few milliseconds between an engine frame's datagrams, so
it keeps the 250 ms watchdog. Regions *disagreeing about which frame they are* is
never normal, so it logs on the first occurrence (throttled thereafter) with a
running count, naming every region and the frame it carries —
`regions carry DIFFERENT engine frames (U6#41 U5#41 U2#40)` — and naming the
symptom, `STEADY WRONG COLOUR, not flicker`, because it is not the one the smoke
procedure teaches. **No fallback emission of guessed data anywhere on this path.**

**Regression**: the reviewer's scenario — per-frame generation markers stamped
across all 512 channels, one datagram per poll phase, one datagram dropped at
frame 3 (the SENDER's sequence still advances; the wire eats it). Asserts frame 3
emits nothing, frames 4–10 each emit exactly one frame with **every mapped
channel carrying the same generation**, and that the loss is named in the log.

**One rig correction came with it, and it matters.** The test helper
`engineFrame()` fed some universes more than once per "frame" and each `inbound`
advanced its own counter — modelling a stream no real receiver ever sees. The rig
now models the engine: one shared sequence per frame, stamped on every universe,
with an explicit `dropDatagram()` for "the engine sent it and the wire ate it".
Several cadence assertions had to be corrected to match the stronger rule (a
source arriving with a *newer* sequence than its siblings is not a whole frame
either); recovery is now asserted as "emission resumes", which is what the rule
guarantees.

### D-158-4 … D-158-8 (minors) · ALL FIXED

- **D-158-4** — R-11 had no intersection test: it refused whenever any other
  sidecar had any pair, then printed *"resolves onto the SAME destination(s)
  U99 → …"*, which was false. Structurally it could not do better —
  `evaluateArmRequest` runs before the arming scene is resolved. R-11 moved to a
  new pure `evaluateClaimOverlap` (`bench_mirror.cjs:607`), called after
  resolution (`sacn_bridge.js:1904`), which refuses on a real intersection and
  names **only** the colliding pairs. Tested for disjoint universe, same-universe
  different host, same-host different universe, self, and a real collision mixed
  with two disjoint pairs (asserting the disjoint ones are *not* named).
- **D-158-5** — the v1/v2 migration text was unreachable for any real v1/v2 file,
  because `requireKnownKeys` fired first on `source_scene`/`mirrors`. The version
  check now runs before the key sweep (`bench_mirror.cjs:142-152`). The refusal
  was always loud and non-partial; it was the wrong loud refusal.
- **D-158-7** — the "declares no plumbing" test scanned raw text and was
  defeatable (a YAML line continuation reassembles a real dotted quad the scan
  cannot see; anchors hide values). It now walks the **parsed tree**: every key
  checked against a plumbing-key pattern at any depth, every string value against
  dotted-quad / hex-packed / dash-separated address forms, plus a direct
  assertion against the exported `SPEC_KEYS`/`SLOT_KEYS` — which are the *real*
  guarantee. A second test feeds each evasion to the parser and requires it to be
  refused by name.
- **D-158-8** — `requiredSources.get(key) || new Set()` was a permissive default
  on the one path that decides whether a half-fresh frame goes out. It now
  shouts `BENCH MIRROR INVARIANT VIOLATED` and auto-disarms. All per-destination
  bookkeeping moved behind one `forgetMirrorGather(key)` helper used by the
  retire path, the flush path and the disarm path, so they cannot drift.
- **D-158-6** — scope of "unrepresentable" corrected in §7.2 above.
- **D-158-9** — duplicate paragraph removed, arithmetic corrected (static net
  −25, not "±1 subtest"), engine total quoted as a **range** because a file-level
  crash makes it nondeterministic, line numbers refreshed, "11 files" → 10.
- **D-158-10** — the two `.agent/plans/` breadcrumbs
  (`20260709_0_led_integration_execution.md`,
  `20260710_1_led_patching_grouping_look.md`) now carry the same non-destructive
  standing-correction header already used on the dossier. History intact; nobody
  can follow those steps by accident.

### 13.6 Falsification — every fix reproduced, then killed

Neutralised one fix at a time by rewriting the module source **in memory at
compile time** from a scratchpad preload (`~/tmp/bm156/falsify.cjs`), the same
technique `_158` used. No source was edited and reverted, so no falsification
residue can exist in the tree.

| neutralised | its regression | others |
|---|---|---|
| **D1** — the ownership proof stops consulting the gate | ✖ *"an arm that cannot prove the sim output path is gated must NOT report success — true !== false"* | D-158-2 also fails: the swallowed arm leaves the bridge armed |
| **D2** — a slice-less destination gets no sources again | ✖ *"a held-dark destination must keep being SENT, not go silent — got 0 frames"* | none |
| **D3** — the emit condition goes back to presence-only (`aligned = true`) | ✖ *"a partial engine frame must NOT be emitted — 4 !== 0"* | the stalled-source and no-tearing cases fail too, as they must |

Unmodified, all three pass. **54 / 54** in `bench_mirror_arm.test.js`.

### 13.7 Post-fix verification

| | tests | pass | fail |
|---|---|---|---|
| `tests/bench_mirror.test.js` | 52 | 52 | 0 |
| `tests/bench_mirror_resolve.test.js` | 32 | 32 | 0 |
| `tests/bench_mirror_arm.test.js` | 54 | 54 | 0 |
| full sim suite `npm test` | **1881** | **1875** | **6** |
| engine suite `npm test` | **2633** (range 2631–2634) | **2626** | **7** |
| `security_check.py --all` | — | — | **6** (unchanged baseline) |

Same six pre-existing sim failures, byte-identical list; same seven environmental
engine failures. **+6 sim tests over the pre-review 1875** (the three new `_158`
regressions plus three tightened/split source-shape cases), and zero new failures
in either suite. Against the ORIGINAL pre-implementation baseline of
**1834 / 1828 / 6**: **+47 tests, zero new failures.**

**No new test file carries a real controller address** — re-checked after these
fixes: `grep -cE '10\.1\.1\.[0-9]+'` over the three sim test files and the
engine guard test is **0**. The D-158-7 evasion cases use `10.9.9.x` placeholders.

---

## 14. SECOND POST-REVIEW PASS (`_158` §5: READY FOR PHYSICAL SMOKE)

`_158`'s re-verification **confirmed D-158-1, D-158-2, D-158-3 and every minor
closed**, and falsified the D-158-1 fix independently. It also probed three attack
variants on the gate (reconnect clearing the sticky, loss after the proof, re-ack
race) and found all safe by construction. Three residuals were raised, none
blocking; two of them would actively mislead a bench session, so all three are
fixed here.

### R-158-A (MEDIUM) — a permanent sequence offset was reported as a lost datagram · FIXED

**The residual.** The all-sequences-equal rule assumes every universe of one
engine frame carries one shared sequence. That lockstep is **emergent, not
guaranteed**: each `sacn` `Sender` owns its counter from 0, and the engine's
model-reload path both creates a Sender mid-run (`engine.js:1726`) and advances a
single universe three times (`:1758`). The reviewer reproduced a permanent −7
offset: the multi-source gateway emitted **0 of 10** frames while the
single-source LED destinations kept running — correct fail-loud behaviour per P0,
but **unrecoverable without an engine restart**, and the log said *"a source
datagram was lost or a source is lagging"*, sending the operator to hunt network
loss.

**Scope note.** The engine-side sequence semantics belong to the `_157` fix
slices; nothing in `marsin_engine/` was touched here. This is a bridge-side
diagnosis change only.

**The fix** — `sacn_bridge.js` teaches the watchdog to distinguish the two states
it can already see:

- `offsetSignature()` computes each source's **wrap-aware signed** lag against the
  most advanced one, so a source seven frames behind reads `-7`, not `249`.
- The discriminator is the **minimum lag each source reaches while the window is
  open**, not a repeated signature. Offsets swing within a single frame as its
  datagrams land one by one, so consecutive readings are never identical — that
  was the first thing I tried and it never fired. A source that is merely one
  frame late touches 0 at some point in the cycle; a permanently offset one never
  does. After `MIRROR_FIXED_OFFSET_FLUSHES` (6) flushes without an emission, any
  source whose minimum lag is still non-zero is **fixed**.
- A newly-detected fixed offset **jumps the throttle window**, because it is a
  different diagnosis from the line printed before it.

The message names all three things the reviewer asked for:

```
❌ 🪞 BENCH MIRROR STUCK — 2→10.x.x.10: its sources are at a FIXED sequence offset
   (U5 at -7) — that source has not caught up once in 6 flushes. This is NOT network
   loss and it will NOT recover on its own: a universe whose sACN sender was created
   later starts its sequence at 0 and stays permanently offset from its siblings,
   which is what an engine MODEL RELOAD does. **RESTART THE ENGINE** to realign the
   senders, then re-arm. This destination is sending NOTHING until then (regions: …).
```

**Regression**: the reviewer's repro exactly — one universe pinned at a fixed −7
across ten engine frames, one datagram per poll phase. Asserts the gateway emits
**nothing** (fail-loud unchanged), the single-source strand keeps emitting (the
asymmetry that IS the signature), and the log names the offset, rules out network
loss, names the cause class and states the remedy. A second half asserts that a
**one-off** loss still reads as a lost datagram — otherwise the new message would
merely replace the old misdirection.

### R-158-B (LOW/MED) — a total-`none` arm froze every box · FIXED

**The residual.** D-158-2 gave a slice-less destination `requiredSources` = every
source universe the mapping reads. When **every** slot is `none` the mapping reads
nothing, so that set was empty for every destination and nothing ever ticked:
0 frames anywhere, every bench box holding its last look, arm accepted. The exact
outcome D-158-2 exists to prevent, at the degenerate end, one gesture away.

**Emit-zeros, not refuse.** The ruling text is explicit that an unselected
destination is *actively held dark* — and "owned but never written" is precisely
the frozen-not-dark failure §4.2 argues against. Refusing the arm would also be
worse operationally: "own the whole bench and hold it dark" is a legitimate thing
to want mid-session.

**The fix** — `sacn_bridge.js`: a destination whose `required` set is empty is
emitted **unconditionally** on each flush (it can be neither whole nor torn: the
frame is all-zero by construction), and a mapping with **no source universes
anywhere** starts a `DARK_TICK_MS = 25` (40 fps, the engine's frame rate) ticker
that marks its destinations dirty. The ticker is `unref`'d, started only for that
one degenerate shape, and stopped at disarm. **This is not a timeout-emit
fallback**: nothing is guessed and no source is waited on — the content of the
frame is the whole content of the operator's instruction.

**Regression**: arm with every slot `none`, feed **no inbound traffic at all**,
and assert every owned destination still receives ≥4 full-512 all-zero frames;
then assert the ticker does not outlive the disarm and the ship relay is restored.

### R-158-C (LOW, test-only) — a numerically encoded address evaded the scan · CLOSED STRUCTURALLY

The value scan skipped non-strings, so `note: 168364348` (which byte-unpacks to a
10/8 host) passed. Both halves done, the structural one being the point:

- the scan now flags any integer that byte-unpacks into `10.0.0.0/8`;
- **and, structurally**, a new assertion proves the encoding does not matter:
  the committed sidecar is parsed twice, once clean and once with `note`/`label`
  poisoned with a packed address, a dotted quad and a hex literal, and the two
  parses produce an **identical** `slot` / `bench_fixture` / `default_source`
  set — the only fields the resolver reads. An address smuggled into free text
  cannot become a route in any encoding, which is a property rather than a
  pattern list.

### 14.4 Falsification

Same in-memory compile-time interception, no file touched:

| neutralised | its regression fails with |
|---|---|
| **RA** — the fixed-offset diagnosis never fires | *"a persistent constant offset must be reported as its own state, not as a lost datagram"* |
| **RB** — a total-none destination stops emitting | *"U2 → 10.x.x.10 must keep receiving frames with no engine input at all — got 0. Silence here means the box holds its last look."* |

Unmodified, both pass.

### 14.5 Smoke procedure

`§9` now opens with a prominent **RE-SMOKE IS REQUIRED** notice naming the three
behavioural changes since the operator's first pass (gate proof on the arm path,
stricter emit condition, held-dark destinations now transmit). `§9.3` gained the
two rows the reviewer specified — an `UNGATED` line after arming (**stop the
smoke**; a successful arm reporting that is a defect, not a hardware problem) and
**bench dark with the LEDs still running** ⇒ read the `BENCH MIRROR STUCK` line
and restart the engine — and the frozen-fixture row now states flatly that while
armed **nothing on the bench should ever freeze**.

### 14.6 Verification

| | tests | pass | fail |
|---|---|---|---|
| `tests/bench_mirror.test.js` | 52 | 52 | 0 |
| `tests/bench_mirror_resolve.test.js` | 32 | 32 | 0 |
| `tests/bench_mirror_arm.test.js` | 56 | 56 | 0 |
| full sim suite `npm test` | **1883** | **1877** | **6** |
| engine suite `npm test` | **2640** | **2633** | **7** |
| `security_check.py --all` | — | — | **6** (unchanged baseline) |

Same six pre-existing sim failures and same seven environmental engine failures,
byte-identical lists. **+49 sim tests against the original 1834 / 1828 / 6
baseline, zero new failures.**

**Engine-suite contention, recorded correctly** (`_158` measured this): four extra
failures appear in `tests/mixer/performance_mode.test.js` **only when concurrent
agents are running**, because that file spawns real engines and competes for
resources. Run in isolation on this tree it is **11 / 11 / 0**:

```
node --import ./tests/helpers/setup_config_guard.mjs --test tests/mixer/performance_mode.test.js
ℹ tests 11 · pass 11 · fail 0
```

It is green; a run that shows it red is measuring machine contention, not this
branch. The engine total also drifts run to run (2631–2640 observed) because
`tests/effects/effects_v2_mode_page_layout.test.js` crashes at file level — the
**failing list** is the stable quantity, not the count.

## 12. Hygiene

- **No git operation of any kind.** No process started on an operator port
  (6966–6972, 5568, 8081, 10000), no port bound, no sACN datagram, no multicast
  join, no device HTTP, no engine restart. **Nothing was armed** — the harness runs
  both bridge modules in-process against faked sockets, so no real hardware could
  have been reached.
- Scratch lives under `~/tmp/` (`bm156_*.txt`, `bm156/`). Nothing was created in
  the source tree that is not part of the deliverable.
- Canonical titanic and test_bench controller mappings, patches and scene configs
  are **untouched** (byte-identical, §8.4). No pattern, no playlist touched. No
  controller pushed or reconfigured.
- No future dates in this file or the tracker block. IPs redacted to `10.x.x.NN`
  in prose throughout; the new tests use non-routable `10.9.9.x` placeholders and
  otherwise read addresses from live scene data.
