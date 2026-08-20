# 20260805_155 — BENCH MIRROR v3: selectable source mapping at ARM + Controllers-header control (DESIGN)

**Agent:** design (Fable, operator-requested) · **Branch:** `feat/bm_readiness` · **Task:** `_155`
**Predecessors:** `_150` (audit + design), `_151` (runtime mode, v2), `_152` (adversarial review → SHIP).
**Mode:** DESIGN-ONLY. Zero production edits, zero git writes, zero ports, zero packets.
Every claim below is a file read against the working tree. IPs redacted to `10.x.x.NN` in prose.

**Context.** The `_151` mode mirrors a FIXED seven-slice map (titanic left front → bench).
Its first physical test failed — fixtures showed random colors; two investigators are on
root cause in parallel. **This design does not depend on their outcome**: whatever they
find, the v3 architecture below makes the *semantic-mismatch* class of that bug
(bytes with one channel-map meaning landing on a fixture expecting another) refusable
at arm time from data, and it names the one residual it cannot see (§5.6).

---

## 0. TL;DR

> **AMENDED after landing — read §15.** Operator rulings on §13 plus root-cause
> reports `_154`/`_153` arrived the same day. Headline deltas: suppression is now
> **global** (armed = bench is the ONLY physical output, all ship relay suspended
> and zeroed); the sim tab's own priority-150 writer (the actual root cause) is
> **gated server-side at :6972** with an arm-time proof; the v3 sidecar loses
> `source_scene` and the whole `controllers:`/`suppress_host` section; resolution
> is scene-parametric (source = whatever scene the engine is on); no presets.
> §§3, 5–9, 13 below are kept as landed and marked where §15 supersedes them.

| | |
|---|---|
| **What is designed** | (1) ARM lets the operator CHOOSE, per bench slot, which titanic fixture feeds it (or `none` = held dark). (2) The ARM/DISARM control moves to the top header of the 🎛 Controllers view; the sACN monitor keeps read-only status only. |
| **The inversion** | The sidecar stops carrying slices/addresses/IPs entirely. **v3 declares SLOTS by fixture name + suppression policy by controller name + defaults.** Every address, universe, footprint, host and slice is RESOLVED FRESH from scene data at ARM time. If the scene changes, the mapping follows; if a link is missing, ARM refuses by name. |
| **Compatibility** | Same-`fixtureType` REQUIRED for DMX and typed-LED slots (no channel-map translation — §5.3 justifies); LED strands additionally require identical pixel format (order/stride/whiteMode) and source px ≥ dest px (prefix copy, warned). Both ends resolve through the ONE fixture-definition registry, so "compatible" means byte-for-byte identical channel semantics by construction. |
| **What survives from _151/_152** | Everything: armed OFF at every start, process-memory arm, socket-scoped auto-disarm, warn-but-allow multi-window, pair/host suppression with declared `suppress_host`, the blackout-hold invariant at the single `partitionMirrorSuppression` call site, 3× zero-frame disarm on every exit path, the 11 refusals (now 20), ownership proof at ARM, status-on-connect. The computed mapping is materialized into the SAME internal spec shape and passes the SAME validator + the same runtime path (`createMirrorState` → `spliceMirrorFrame` → `mirrorPayload`), untouched. |
| **Defaults** | The sidecar's per-slot `default_source` = today's left-front set, so ARM stays one gesture (open picker → one click, defaults pre-selected). Last-used selection is remembered in **bridge process memory only** — never on disk (§10). |
| **Sizing** | One implementation owner, five slices (§12): ~250 pure lines resolver, ~120 bridge, ~220 UI, sidecar rewrite, ~90 new tests + the default-equivalence pin. |

---

## 1. Ground truth read for this design

- `simulation/scenes/test_bench/bench_mirror.yaml` — v2, 7 slices, `label`, 3× `suppress_host`.
- `simulation/scenes/test_bench/{controllers,patches,scene_config}.yaml` — bench inventory:
  4× `UkingPar` (Par 1–4, U2@1/11/21/31), 2× `VintageLed` (U2@41/74), 2× `ShehdsBar`
  (U2@107/226) on DMX gateway `10.x.x.10`; 2 strands 20 px RGBW stride 4 native
  (LED_0 U10@1, LED_1 U12@1) on MarsinLED `10.x.x.60`. `scene_config.yaml` also carries
  **unpatched** `TE Sign V3 A/B` fixtures (`TeSignV3A40`/`TeSignV3B34`) — the future sign slot
  has a scene-side anchor already; it lacks only a patch + controller port.
- `simulation/scenes/titanic/{controllers,patches,scene_config}.yaml` — candidate pool:
  40× `UkingPar` (Auditoriums, SmokeStacks, Small SmokeStacks), 16× `VintageLed` (Rails),
  20× `ShehdsBar` (Walls), 8 strands 40 px RGBW stride 4 native, 4 TE-sign fixtures
  (2× A40, 2× B34). Names are unique by construction in `patches.yaml` (a YAML map).
- `simulation/dmx/fixtures/*/model_*.yaml` — the ONE fixture-definition registry:
  `UkingPar` fp 10, `VintageLed` fp 33, `ShehdsBar` fp 119 (hardware-verified 119-ch
  personality; `channels_12/108` exist as documents but only `model_119` is loaded),
  `TeSignV3A40` 160 ch, `TeSignV3B34` 136 ch.
- `simulation/lib/bench_mirror.cjs` (757 ln) — v2 parser, `isMirrorActive`,
  `partitionMirrorSuppression` (+ blackout hold), `evaluateArmRequest` (11 refusals),
  `evaluateArmedHealth`, `createMirrorState`/`spliceMirrorFrame`/`mirrorPayload`.
- `simulation/server/sacn_bridge.js` — `readBenchMirrorSpecs()` (fresh read per recompute),
  `benchMirrorStatus()` (rebuilt fresh, pushed on connect at `:894`), arm/disarm handlers,
  `_blackoutHold` invariant at the single partition call site.
- UI: `src/gui/modern/controller_map_panel.js` (static Preact shell; header
  `.vm-header` with `#cm-header-status`), `src/gui/controller_map_editor.js` (legacy body),
  `src/gui/modern/sacn_monitor_panel.js` (current ARM button `sacn-in-bench-mirror-btn`),
  `src/gui/bench_mirror_control.js` (pure control state), `src/gui/bench_mirror_banner.js`.

---

## 2. Data model

```
BenchSlot (declared, sidecar v3)          ResolvedSlot (computed at ARM, never stored)
  slot            snake_case id             benchFixture   name (verified in scene)
  bench_fixture   fixture name in            controller     { name, ip }   ← controllers.yaml
                  the test_bench scene       destUniverse   number         ← patches.yaml
  default_source  titanic fixture name       destAddr       number         ← patches.yaml
                  or `none`                  kind           'dmx' | 'led_strand' | 'led_fixture'
                                             fixtureType    string|null    ← scene_config.yaml
Selection (runtime, per ARM)                 footprintCh    number         ← registry / px×stride
  Map<slotId, titanicFixtureName | null>     pixelCount     number|null    ← patches.yaml
                                             pixelFormat    {order,stride,whiteMode}|null ← controllers.yaml led:
Candidate (computed per slot)
  { name, universe, addr, footprintCh, pixelCount, note }   ← titanic scene, filtered by §5
```

**`kind` is DERIVED, never declared** (one less thing to rot):
- patch entry has `pixelCount` and the scene declares **no** `fixtureType` for that name → `led_strand`;
- name has a `fixtureType` and its controller entry is `type: LED` → `led_fixture` (TE sign class);
- name has a `fixtureType` and its controller entry is `type: DMX` → `dmx`;
- anything else (no patch, no type, contradictory) → **refusal R-16** naming the slot and the missing link.

The bench side is FIXED: slots enumerate the physical inventory (today: `par_1..par_4`,
`vintage_left`, `vintage_right`, `bar_left`, `bar_right`, `led_0`, `led_1`). The titanic side
is CHOSEN per slot from the computed candidate list. One titanic source feeding two slots is
**allowed** (§6.3); two slots naming one bench fixture is **refused** at parse.

---

## 3. Sidecar v3 — what stays declared, what becomes dynamic

> ⟂ AMENDED (§15.A2/A6): `source_scene` and the entire `controllers:`/`suppress_host`
> section are REMOVED from v3 — the source scene is dynamic (engine's active scene)
> and suppression is global while armed. The final schema is in §15.A6.

v2 conflated two things: *policy* (which region, what suppression) and *plumbing*
(universes, addresses, lengths, IPs). The plumbing is exactly what the operator's
requirement bans from the sidecar. v3 keeps only what cannot be derived:

```yaml
# bench_mirror.yaml — v3. NO addresses, NO universes, NO IPs, NO slice lengths.
# Everything physical is resolved from the scene's controllers.yaml /
# patches.yaml / scene_config.yaml / fixture registry AT ARM TIME, fresh.
version: 3
enabled: true
source_scene: titanic
label: Titanic left front

slots:
  - { slot: par_1,        bench_fixture: Par 1,         default_source: Left Auditorium 5 }
  - { slot: par_2,        bench_fixture: Par 2,         default_source: Left Auditorium 6 }
  - { slot: par_3,        bench_fixture: Par 3,         default_source: Left Auditorium 7 }
  - { slot: par_4,        bench_fixture: Par 4,         default_source: Left Auditorium 8 }
  - { slot: vintage_left, bench_fixture: Vintage Left,  default_source: Left Front Rails 1 }
  - { slot: vintage_right,bench_fixture: Vintage Right, default_source: Left Front Rails 2 }
  - { slot: bar_left,     bench_fixture: Bar Left,      default_source: Left Front Wall 1 }
  - { slot: bar_right,    bench_fixture: Bar Right,     default_source: Left Front Wall 2 }
  - { slot: led_0,        bench_fixture: LED_0,         default_source: Left_Front_Left }
  - { slot: led_1,        bench_fixture: LED_1,         default_source: Left_Back_Left }
  # FUTURE TE SIGN SLOT — activate by patching the bench sign and uncommenting:
  # - { slot: te_sign_a,  bench_fixture: TE Sign V3 A,  default_source: TE Sign V3 A }

controllers:
  # Suppression policy by CONTROLLER NAME (resolved to an IP at arm time from
  # controllers.yaml — the sidecar never carries an address). REQUIRED for every
  # controller any slot resolves onto; an entry no slot lands on is REFUSED as stale.
  - { name: Test Bench 1, suppress_host: false }   # ship's LeftFrontWall gateway shares the IP; U3/U4 must keep flowing
  - { name: Titanic_202,  suppress_host: true }    # whole-box ownership: dark strands mean "board not on the bench binding", never a raw-relay false positive
```

**Schema rules (all parse-time, all loud):** unknown keys refused at every level;
`slots` non-empty; `slot` ids unique snake_case; `bench_fixture` names unique;
`default_source` is a string or the literal `none`; every `controllers[].name` unique;
`suppress_host` boolean, required, no default (v2 semantics preserved verbatim).

**Migration story.** v3-only build. A `version: 1` or `version: 2` file is refused at
parse with the migration named: *"v3 no longer carries slices/addresses/IPs — declare
`slots` (bench fixture names + default sources) and `controllers` (suppression by name);
the bridge computes the slices from the scene at arm time. See report _155."* The
committed sidecar is rewritten to v3 in the implementation slice with defaults equal to
today's mapping; a pinned test proves the computed default selection produces a
byte-identical channel→channel function to the frozen v2 table (§11 T-5). Nothing else
reads the sidecar (grep-verified: only `bench_mirror.cjs` parses it), so no other
consumer migrates.

---

## 4. Arm-time resolution algorithm

All reads are FRESH (same doctrine as `readBenchMirrorSpecs` / `readSceneRoutePairs` —
the operator edits, the next recompute sees it). Pure core in a new
`simulation/lib/bench_mirror_resolve.cjs`: the bridge does the `fs` reads and hands
parsed trees in, so every branch is unit-testable without I/O.

```
resolveBenchMirror({ spec,                    // parsed v3 sidecar
                     benchScene,              // { controllers, patches, sceneConfig } trees (test_bench)
                     sourceScene,             // same trees for spec.source_scene (titanic)
                     registry,                // fixtureType → { footprint } from dmx/fixtures/*/model_*.yaml
                     selection })             // Map slot→name|null, or null = defaults
  → { ok, refusal, warnings, slots:[ResolvedSlot+chosen], mirrors:[InternalSpecMirror] }

1  RESOLVE BENCH SLOTS (fail loudly per slot — R-16):
   for each declared slot:
     patch   = benchScene.patches[slot.bench_fixture]        or refuse "no patch entry"
     ctrl    = controller in benchScene.controllers whose ports cover
               (patch.dmxUniverse, patch.controllerIp)        or refuse "no controller/port"
     kind    = derive per §2                                  or refuse "kind underivable"
     dmx / led_fixture:
       ftype = fixtureType from benchScene.sceneConfig by name (unique or refuse "ambiguous")
       fp    = registry[ftype].footprint                      or refuse "no fixture definition"
     led_strand / led_fixture:
       px    = patch.pixelCount; fmt = ctrl.led {order, stride, whiteMode}
       fp    = px * fmt.stride  (must equal patch.endChannel span or refuse "patch inconsistent")
   refuse if two slots resolved to the same bench fixture or overlapping dest channels (§6.2)

2  RESOLVE SUPPRESSION POLICY (R-17):
   for each controller name any slot landed on: find its sidecar `controllers` entry
     or refuse "controller '<name>' has no suppress_host declaration"
   for each sidecar `controllers` entry no slot landed on: refuse "stale policy entry"
   host consistency check (one suppress_host per resolved IP) — carried over from v2

3  BUILD CANDIDATES per slot from sourceScene (§5) — pure filter, no selection yet.

4  APPLY SELECTION:
   selection == null → every slot takes default_source (or none)
   otherwise the map must cover EVERY slot exactly (R-13: missing slots named;
     R-12: unknown slot ids named) — no partial merge, no guess
   each named source must be in that slot's candidate list
     (R-14 unknown name / R-15 incompatible, with the failed rule named)

5  COMPUTE SLICES per chosen slot:
   dmx:          one slice { srcU: src.universe, srcAddr: src.addr, len: fp, destAddr }
   led_strand:   walk source segments in pixel space; copy pixels 0..destPx-1:
                 for each (srcSegment × destSegment) overlap emit a slice
                 (handles a future multi-universe strand on either side; today 1:1)
   led_fixture:  same walk, destPx must equal srcPx (§5.4), so full-fixture copy
   none:         no slices; the slot is HELD DARK (§6.1)

6  MATERIALIZE the internal spec: group slices by (destUniverse → destIp), attach
   suppressHost from step 2, label from the sidecar, and run it through the SAME
   structural validator as a hand-authored spec (range walk-off, duplicate dest
   channels, host consistency — parseBenchMirrorSpec's invariants refactored to a
   shared validateMirrorTree()). A computed map obeys every rule an authored one did;
   if it cannot, ARM refuses with R-19 (an internal-shaped failure is still a refusal,
   never a warning).

7  HAND OFF to the UNCHANGED _151 pipeline: evaluateArmRequest (checks 1–11 verbatim,
   destinations now from the computed spec) → arm → recompute → _127 ownership proof
   → auto-disarm if unprovable. createMirrorState/spliceMirrorFrame/mirrorPayload
   consume the computed spec with zero changes.
```

**No caching, no TOCTOU trust:** the `benchMirrorOptions` reply (§7) is advisory UI
data; the ARM re-resolves everything from disk in the same pass that arms. A scene
edit between "picker opened" and "ARM clicked" is caught by the re-resolution, and a
selection that no longer validates refuses by name.

---

## 5. Compatibility — precise rules, and why the random-colors class dies here

### 5.1 The rule set

| slot kind | required, else REFUSE (R-15) | additionally WARN |
|---|---|---|
| `dmx` | candidate has a `fixtureType` **string-identical** to the slot's; both resolve through the same registry entry (⇒ same footprint, same channel map, by construction — asserted anyway); candidate footprint fits its declared source universe span | — |
| `led_strand` | candidate is a strand (pixelCount, no fixtureType); **pixel format identical**: `order`, `stride`, `whiteMode` from both controllers' `led:` blocks; `srcPx ≥ destPx` | prefix truncation: "showing first N of M px"; `led.wire` differences (gamma/foldAmber) — device-side color fidelity, not byte semantics |
| `led_fixture` | `fixtureType` string-identical; pixel format identical; `srcPx == destPx` **exactly** (a sign is a shape — a prefix of it is scrambled content, not a smaller sign) | — |

### 5.2 Why "same fixtureType" is sufficient AND necessary

Sufficient: `fixture_definition_registry` loads exactly one model per
`fixture_type` (`model_119.yaml` → `ShehdsBar`, fp 119, pixel channel map included).
Both scenes' fixtures resolve through that single file, so identical type strings ⇒
identical personality, identical footprint, identical per-channel meaning. Slices are
whole fixtures starting at both fixtures' start addresses (§4 step 5), so **byte k of
the source fixture lands on byte k of a fixture that assigns it the same meaning** —
there is no representable arm state in which pixel data lands in control channels.

Necessary: footprint equality alone is NOT enough (two 10-ch profiles can order
channels differently), and name-pattern matching is exactly the guess the codex bans.

### 5.3 Channel-map translation: REFUSED, deliberately

A translation layer (e.g. driving a 15-ch vintage personality from a 33-ch map, or
RGB→RGBW expansion) is a **second channel map maintained by hand** — precisely the
artifact class that produces "random colors with a green log", and the class the
physical failure most plausibly belongs to. It also buys nothing: every bench family
exists on the ship in the same personality (40 UkingPar, 16 VintageLed, 20 ShehdsBar,
8 RGBW strands). Recommendation: **same-profile required, no translation, refuse
outside it.** If a future bench fixture genuinely has no same-profile ship twin, that
is a new registry model + a design amendment, not a silent remap.

### 5.4 The one asymmetry: strand prefix copy

Titanic strands are 40 px; bench strands 20 px. Requiring equality would make every
strand slot permanently un-armable, so `led_strand` allows `srcPx ≥ destPx` with a
prefix copy — this is exactly today's shipped behavior (`_89`), now stated as a rule
and surfaced as a warning at ARM and a `(first 20 of 40 px)` note in the picker row
and the arm log. Typed LED fixtures (`led_fixture`) do NOT get this allowance (§5.1).

### 5.5 Structural guarantee against the failed-test bug class

At ARM time the resolver re-proves, from live scene data, the invariants the `_89`
live-map tests only proved for the committed v2 file:

1. every DMX slice is exactly one whole fixture, starting at ITS start address on
   BOTH ends (no boundary crossing — the boundary walk is re-run at arm, not only in CI);
2. both ends' channel semantics come from one registry file (§5.2);
3. LED bytes are only copied between identical pixel formats (stride/order/white);
4. untouched dest channels are deterministically zero (`mirrorPayload` sends all 512);
5. a slice can never span two fixtures because slices are GENERATED per fixture,
   not authored — the v2 failure mode "author typo'd an address" has no v3 equivalent,
   because there is no address to author.

### 5.6 The residual it cannot see — named, not hidden

Data cannot prove what personality the PHYSICAL fixture is set to. If a bench bar's
menu is on its 12-ch mode while the scene declares `ShehdsBar` (119), every check
above passes and the hardware still shows garbage. That is plausibly the current
physical failure (the investigators will say). v3's contribution: after ARM the
mapping is provably byte-correct end-to-end **in data**, so a wrong-looking fixture
narrows to exactly two suspects — physical personality mismatch, or `_105` F8
quantisation — and the arm warnings say so:
`⚠ If a fixture shows garbage while armed, check ITS personality/menu against the
scene's declared profile (fp 10/33/119) — the mapping itself is verified.`

---

## 6. Ownership, suppression, and the two overlap questions

> ⟂ AMENDED (§15.A2): the operator ruled bigger than §6.1's question — while armed,
> ALL relay to ALL controllers is suspended (bench-only physical output). The
> pair/host suppression model below is superseded; §6.2/§6.3 (dest/source overlap)
> stand unchanged.

### 6.1 A destination with all slots `none` stays OWNED and dark

If every slot on a controller is `none`, the mirror still owns its destination
universes and composes all-zero frames. Rationale: releasing it to the ordinary relay
would resurrect the `_150` §9 false positive (raw ship bytes lighting bench hardware
while "mirroring"), and a mode where ownership depends on selection content gives the
operator two behaviors to remember instead of one. Armed = the bench is the mirror's,
dark where unselected. (Operator question 2 in §13 offers the alternative.)

### 6.2 Overlapping DEST is impossible by construction — and re-proven anyway

Slots name distinct bench fixtures (parse refusal on duplicates); each fixture's patch
occupies one contiguous channel range; the generator writes only that range. Two slots
could still collide if the BENCH SCENE itself patched two fixtures onto overlapping
channels — that is a scene-authoring bug, and the materialized spec's duplicate-dest-
channel check (step 6, same code path as v2's `claimed` map) refuses it by slot and
channel. So: impossible given a sane scene, refused loudly given an insane one. That
is the required proof — construction plus runtime re-verification, not construction alone.

### 6.3 Overlapping SOURCE is allowed

One titanic fixture feeding two bench slots (Left Front Wall 1 → both bars) is a
read-only fan-out: sACN reception is free, dest pairs stay disjoint, single-writer law
untouched. Refusing it would forbid a genuinely useful gesture ("show me the same bar
on both bench bars to compare them side by side"). The picker badges duplicates
(`×2`, info-styled) and the arm log names them; no warning noise beyond that.

### 6.4 Suppression semantics carry over verbatim

`partitionMirrorSuppression` (pair / host / blackout reasons, the `_152` D1 hold at
its single call site) is untouched — it consumes the computed spec's
`mirrorDestPairs` / `mirrorOwnedHosts` exactly as it consumed v2's. The whole-host
`.60` ruling and the pair-only `.10` ruling now live as `controllers:` policy in v3,
resolved to IPs at arm time.

---

## 7. WS protocol (`:6971`)

> ⟂ AMENDED (§15.A3): a control link between the two bridge processes and a gate
> ack in the ARM sequence are added; `benchMirrorArm` no longer carries a scene-fixed
> assumption (source scene is the engine's, §15.A1).

One new message, one extended message, one extended broadcast. `getRoutes` (`_127`)
untouched. Handlers reply, never throw (unchanged discipline).

### 7.1 NEW `benchMirrorOptions` — feeds the picker

```
in :  { type:'benchMirrorOptions', scene, reqId }
out:  { type:'benchMirrorOptions', reqId, scene, ok, refusal,   // refusal = resolution failure, named
        label, sourceScene,
        slots: [ { slot, benchFixture, kind, fixtureType, footprintCh, pixelCount,
                   dest: { controller, universe, addr },        // real values — operator UI
                   defaultSource, lastUsed,                     // lastUsed: process memory, may be null
                   candidates: [ { name, universe, addr, pixelCount, note } ] } ] }
```

Computed fresh on every request (picker open). A slot with zero candidates is not a
refusal here — it renders with only `none` selectable; it becomes refusal R-14/R-15
only if a selection then names a source for it.

### 7.2 EXTENDED `benchMirrorArm`

```
{ type:'benchMirrorArm', scene, reqId,
  selection: { par_1:'Left Auditorium 5', …, led_1:null } }   // OPTIONAL
```

`selection` absent → sidecar defaults (one-gesture arm preserved). Present → must
cover every slot exactly (R-12/R-13). Every refusal names the offending slot AND the
offending choice. The reply is the standard status object.

### 7.3 EXTENDED `benchMirrorStatus` (reply + broadcast + on-connect push)

New fields, all additive (nothing renamed/dropped — `normalizeRouteSnapshot` and the
existing banner keep working):

```
blackoutInFlight: boolean          // drives the DISARMING… UI state everywhere; broadcast
                                   // fires at disarm START (new) as well as at completion
selection: [ { slot, benchFixture, source,          // null = held dark
               summary } ]                          // e.g. "U6/1 → U2/1 (UkingPar, 10 ch)"
label, scene, sourceScene, destinations, hosts, suppressed, warnings, refusal, available,
specErrors, clientCount            // unchanged
```

New connections receive this on open (existing `:894` push), so a fresh browser
renders the true mapping, not just "armed".

### 7.4 Arm log lines (monitor + terminal)

Between the `ARMED` header line and the `composes` lines, one line per slot:

```
🪞   par_1         ← Left Auditorium 5    (UkingPar 10ch, U6/1 → U2/1)
🪞   bar_left      ← Left Front Wall 1    (ShehdsBar 119ch, U2/1 → U2/107)
🪞   led_0         ← Left_Front_Left      (RGBW×4, first 20 of 40 px, U30/1-80 → U10/1-80)
🪞   led_1         ← none                 (HELD DARK — composed as zeros)
```

---

## 8. UI — Controllers-header control, picker, demotions

> ⟂ AMENDED (§15.A5): no region presets (operator ruling); banner and Controllers
> text now state the bench-only takeover; the sim's own transmit loop is gated
> client-side as a belt on top of the §15.A3 server-side gate.

### 8.1 Where

The 🎛 Controllers view = `controller_map_panel.js` shell (`.vm-header`) +
`controller_map_editor.js` body. The shell is render-once static; the control mounts
as a separate signal-driven Preact root into a new `<span id="cm-bench-mirror-slot">`
placed in the header between the title and `#cm-header-status` — the legacy body and
its handler ownership are untouched (SHELL_NOTES discipline). Decision state stays in
the DOM-free `bench_mirror_control.js` (extended), so every state below is
unit-testable without a browser.

### 8.2 Header control states — exact text

| state (input) | rendered | button | enabled |
|---|---|---|---|
| no status yet (`benchMirror == null`) | `🪞 BENCH MIRROR: UNKNOWN` | `ARM` | no — tooltip: bridge has not reported state on this connection |
| bridge socket down | `🪞 BENCH MIRROR: LINK DOWN` | `ARM` | no — tooltip: no connection to the sACN bridge (:6971) |
| off, exactly 1 armable sidecar | `🪞 BENCH MIRROR: OFF` | `ARM` | **yes** — opens the picker |
| off, 0 armable | `🪞 BENCH MIRROR: OFF` + `✋ nothing armable` beside | `ARM` | no — tooltip lists broken/absent sidecars |
| off, >1 armable | `🪞 BENCH MIRROR: OFF` + `✋ 2 candidates` beside | `ARM` | no — tooltip: "the bridge will not pick one for you — disable all but one" (carried rule: never silently choose a sidecar) |
| off, last ARM refused | `🪞 BENCH MIRROR: OFF` + `✋ <refusal, truncated>` beside (full text in tooltip + monitor log) | `ARM` | per rows above |
| armed | `🪞 BENCH MIRROR: ACTIVE — <LABEL>` | `DISARM` | **yes** — immediate, no picker |
| disarm in flight (`blackoutInFlight`) | `🪞 BENCH MIRROR: DISARMING…` | `DISARM` | no — re-arm impossible until the DISARMED broadcast (bridge enforces via the existing blackout refusal; the UI mirrors it) |

The refusal/unavailable text is REQUIRED to render beside the control (not tooltip-only)
whenever it is the reason the button is disabled or the last action failed.

### 8.3 Picker flow

`ARM` click → `benchMirrorOptions` request → compact modal (new
`src/gui/bench_mirror_picker.js`: pure state fn `benchMirrorPickerState(options, draft)`
+ Preact view):

```
┌ 🪞 BENCH MIRROR — choose sources ────────────────────────────────┐
│ Titanic left front → test bench          [↺ defaults] [last used]│
│ par_1     Par 1      UkingPar·10ch   [Left Auditorium 5      ▾] │
│ …                                                                │
│ bar_left  Bar Left   ShehdsBar·119ch [Left Front Wall 1      ▾] │
│ led_0     LED_0      RGBW·20px       [Left_Front_Left (20/40)▾] │
│ led_1     LED_1      RGBW·20px       [— none (held dark) —   ▾] │
│                                    [Cancel]  [🪞 ARM — 9 slots] │
└──────────────────────────────────────────────────────────────────┘
```

- Pre-selected: `lastUsed` if present, else `defaultSource` — so the don't-care path is
  ARM → click confirm (the operator's own "one-click confirm" flow). Enter confirms.
- Every dropdown carries `— none (held dark) —`; candidates show name + `U<u>/<addr>`;
  a source already chosen elsewhere gets an info `×2` badge (allowed, §6.3).
- Zero-candidate slot: dropdown contains only `none`, row notes why (`no compatible
  titanic fixture — <fixtureType>`).
- Confirm sends the COMPLETE selection map. Cancel/Esc sends nothing.
- If the options reply carried `ok:false`, the modal renders the refusal verbatim with
  no confirm button — resolution failures are readable at the point of gesture.
- Refused ARM: modal stays open, refusal rendered at the footer, offending row highlighted
  (refusals name the slot, §9).

### 8.4 While armed — Controllers view body

Each owned controller card shows a badge row (data from `benchMirrorStatus`, rendered
by a small addition to the legacy editor's card render):
`🪞 MIRROR OWNS U2 (pair)` / `🪞 MIRROR OWNS WHOLE HOST (U10, U12)`, and each mapped
fixture row gains `← Left Front Wall 1` (or `← none · dark`). The card's Push controls
stay enabled — a push while armed already FAILS its `_127` read-back loudly, which is
correct and stays; the badge's tooltip repeats the standing warning.

### 8.5 Demotions and non-duplication

- `sacn_monitor_panel.js`: the `🪞 ARM/DISARM` button and `runBenchMirrorAction` are
  REMOVED. The `Bench Mirror` stat row stays (read-only truth), the activity log keeps
  receiving every transition/refusal line. No duplicate control exists anywhere.
- `bench_mirror_banner.js`: stays panel-independent; text gains the selection census:
  `🪞 BENCH MIRROR ACTIVE — TITANIC LEFT FRONT · 9 slots mapped, 1 dark · owns U2→…10,
  U10/U12→…60 · owns all of …60 · ordinary relay suppressed`.
- The header control is available whenever the Controllers panel is open, independent
  of the sACN monitor's visibility/collapse (the monitor's `sacn_in`-mode gating no
  longer gates the control). If the :6971 socket is not connected, the control says so
  (LINK DOWN) instead of pretending — it never guesses state it has not been told.

---

## 9. Refusal catalog — 11 carried + 9 new

> ⟂ AMENDED (§15.A7): R-7 replaced, R-9/R-10 subsumed by the stronger R-21,
> R-17 retired (no suppression policy to declare), R-21…R-23 added. Numbering is
> stable; nothing renumbered.

R-1…R-11: verbatim from `_151` §4 (no scene named; sidecar unparsable; no sidecar;
`enabled: false`; already armed / re-arm through blackout (+ blackout-in-flight first
check from `_152` D2); engine unreachable; wrong engine scene; `ownedUnavailable`;
engine-owned pair; engine-owned universe on wholly-owned host; cross-sidecar overlap).

| # | new refusal | template (always names the offender) |
|---|---|---|
| R-12 | unknown slot id in selection | `ARM refused: selection names slot 'X' but test_bench/bench_mirror.yaml declares no such slot. Declared: …` |
| R-13 | incomplete selection | `ARM refused: selection is missing slot(s) par_3, led_1. A selection covers every slot explicitly — 'none' is a choice, absence is not.` |
| R-14 | unknown source fixture | `ARM refused: slot 'bar_left' names 'Left Front Wall 9', which the titanic scene does not patch.` |
| R-15 | incompatible choice | `ARM refused: slot 'bar_left' (ShehdsBar, 119 ch) cannot take 'Left Front Rails 1' (VintageLed, 33 ch) — profiles must be identical; the bridge does not translate channel maps.` (rule that failed is always named: type / pixel format / px count) |
| R-16 | bench slot unresolvable | `ARM refused: slot 'led_0' ('LED_0') cannot be resolved from the test_bench scene — <missing link: no patch entry / no controller port / no fixture definition for '<type>' / ambiguous fixtureType>. The mirror maps only what the scene proves.` |
| R-17 | suppression policy gap / stale | `ARM refused: slots resolve onto controller 'Titanic_202' but bench_mirror.yaml declares no suppress_host for it` / `…declares suppress_host for 'Old Box' which no slot resolves onto — remove the stale entry.` |
| R-18 | ambiguous fixture identity | `ARM refused: the titanic scene_config declares 'Left Front Wall 1' twice with different fixtureTypes — fix the scene; the bridge will not pick.` |
| R-19 | computed spec failed validation | `ARM refused: the computed mapping violates '<invariant>' (slot 'X', dest channel N) — this indicates overlapping bench patches or a resolver defect; nothing was armed.` |
| R-20 | sidecar version | v1/v2 refused at parse with the §3 migration text (supersedes the v2 build's v1 refusal). |

Auto-disarm reasons (`evaluateArmedHealth`) carry over unchanged; no new runtime
degrade is introduced — the selection is frozen into the computed spec at arm, and a
scene edit while armed lands on the next recompute exactly as today (sidecar re-read →
health check → the computed spec is re-derived; if re-derivation fails or changes the
owned set, auto-disarm loudly rather than silently re-shape a live mapping).
**Decision:** a mid-arm scene/sidecar edit that changes the RESOLVED mapping (not just
fails) also auto-disarms with `the armed mapping no longer matches the scene — re-arm
to pick up the change`; hot-reshaping owned hardware without a gesture is a fallback
behavior in disguise.

---

## 10. Defaults and selection memory

- **Defaults**: `default_source` per slot in the sidecar = the current left-front set,
  so the committed file keeps encoding the operator's canonical bench story, and ARM
  with no opinions is picker-open → Enter.
- **Remember-last-selection: YES, process memory only.** `_lastSelection` (Map, keyed
  by scene) beside `_mirrorArm` in the bridge; surfaced as `lastUsed` in
  `benchMirrorOptions`; cleared by process restart; NEVER written to disk, env, or
  localStorage (extend the existing persistence-grep pin to cover it).
  Justification: a remembered SELECTION cannot light anything — arming still requires
  the gesture plus every check — so it does not weaken the deployment guard the way a
  remembered ARM would. Persisting it to disk, though, would create a second mutable
  source of truth beside the sidecar that `robocopy /MIR` would ship and that could rot
  against the scene; process memory captures the real workflow (repeated arm/disarm
  within one bench session) at zero rot risk. Fresh boot = sidecar defaults, which is
  the correct "state of the world after a restart" answer everywhere else in this system.

---

## 11. Test plan (implementation owner writes; homes follow the `_150` §10 map)

**T-1 v3 parser** (`bench_mirror.test.js`, replaces v2 structural tier): every schema
rule in §3 refused by name — unknown keys, dup slots, dup bench fixtures, missing
`suppress_host`, stale controller entry, v1/v2 version refusal text, `none` literal.

**T-2 resolver, pure** (new `bench_mirror_resolve.test.js`, synthetic scene trees):
every R-16 link broken individually; kind derivation for all three kinds + refusal on
underivable; suppression policy resolution incl. stale + host-consistency; candidate
filtering per §5 rule (each rule violated individually, both directions); R-12/13/14/15/18
selection application; slice computation for dmx / strand-prefix / led_fixture /
multi-segment synthetic strand; `none` slots produce no slices but keep the destination.

**T-3 byte-level per-slot mapping** (same file): deterministic frames — constant red
(255,0,0,…), green, blue, white, black per source fixture footprint — fed through
`createMirrorState(computedSpec)` + `spliceMirrorFrame`; assert exact dest bytes per
slot, untouched channels 0, `none` slot all-zero, fan-out source duplicated to both
slots byte-identically, prefix strand copies exactly px 1–20 and drops 21–40.

**T-4 live-scene resolution** (live-map tier): resolve the committed v3 sidecar against
the real scenes + registry; assert every slot resolves; every default is in its
candidate set; boundary walk holds against the generated `marsin_engine/models/*.js`
(the existing cross-check stays as the CI-only second witness).

**T-5 default-equivalence pin**: the computed default selection's channel→channel
function (as a map of (destU,destCh)→(srcU,srcCh)) is byte-identical to the frozen v2
seven-slice table, hard-coded IN THE TEST. This is the "nothing moved" regression for
the migration.

**T-6 protocol e2e** (`bench_mirror_arm.test.js` rig, fake sockets, zero ports):
`benchMirrorOptions` round-trip; ARM with defaults == ARM with explicit default map;
ARM with a custom selection → composed bytes prove the chosen source (feed distinct
constants on two candidate universes, assert the chosen one lands); each new refusal
end-to-end names slot+choice; status broadcast and on-connect push carry `selection`
and `blackoutInFlight`; `lastUsed` appears after a disarm and dies with a process-fresh
bridge (new module instance); the persistence grep pin extended to `_lastSelection`.

**T-7 UI pure state** (`bench_mirror_control` + new picker state fn): all eight §8.2
states incl. exact label text; picker pre-selection precedence (lastUsed > default);
zero-candidate row; duplicate badge; refusal rendering; DISARMING lockout.

**T-8 regression**: the full `_151`/`_152` suite must pass unmodified in intent —
armed-off-at-start, socket-scoped disarm, 3× zero frames on every exit path, blackout
hold pinned at the single partition call site, suppression pair/host/blackout reasons,
ownership proof, monitor-log lines. Tests that pinned v2 file contents are rewritten to
pin the same INVARIANTS against v3 + computed spec (the invariant list is the contract,
not the file bytes). Baseline to hold: full suite currently 1834 / 1828 / 6, same six
pre-existing failures byte-identical.

---

## 12. Implementation plan — one owner, five ordered slices

| slice | content | est. |
|---|---|---|
| S1 | v3 schema + parser in `bench_mirror.cjs` (shared `validateMirrorTree()` split out so §4 step 6 reuses it); v1/v2 refusal text; T-1 | ~120 ln + tests |
| S2 | `lib/bench_mirror_resolve.cjs` (pure: resolve slots, policy, candidates, selection, slices, materialize) + registry/scene reader helpers in the bridge; T-2/T-3 | ~250 ln + tests |
| S3 | bridge wiring: `benchMirrorOptions` handler; `benchMirrorArm` selection path; status extensions (`selection`, `blackoutInFlight` broadcast at disarm start); `_lastSelection`; arm-log slot lines; T-6 | ~120 ln + tests |
| S4 | UI: header control mount in `controller_map_panel.js` + extended `bench_mirror_control.js`; `bench_mirror_picker.js`; Controllers-card badges/labels; monitor button removal; banner census; T-7 | ~220 ln + tests |
| S5 | sidecar v2→v3 rewrite (defaults = current set); T-4/T-5; report + operator instructions; full-suite run against the 1834/1828/6 baseline | — |

Order matters: S1/S2 land value-free (pure code + tests, no behavior change until S3
switches the arm path). Each slice runs the touched auto-checks before claiming done.
No scene `controllers.yaml`/`patches.yaml` edits anywhere; no device HTTP; no packets.

---

## 13. Open questions for the operator (each genuinely decision-requiring)

> ⟂ ANSWERED (§15.A1): Q1 no presets — simplest per-slot picker, and the source
> scene is whatever the engine is on; Q2 superseded by the global-suppression
> ruling; Q3 confirmed as designed. New open questions live in §15.A9.

1. **Region presets in the picker?** Per-fixture slots give you "LEFT WALL BAR 1 →
   bench bar 1" exactly as asked, but ten dropdowns is a lot of clicking for "show me
   the right side instead". A preset row (`fill all from: LEFT FRONT / LEFT BACK /
   RIGHT FRONT / …`, then tweak) is cheap on top of this design — ship it in v1, or
   keep v1 to defaults + manual and add presets after the first bench session?
2. **All slots `none` on one controller**: designed as "mirror still owns the box and
   holds it dark" (§6.1 — preserves the false-positive kill). The alternative is
   "wholly-unselected controller is released to the ordinary relay". Confirm the
   designed behavior, or rule for release?
3. **Last-used selection in bridge process memory** (survives disarm/re-arm, dies with
   the process, never on disk — §10). Confirm, or rule "defaults every time"?

---

## 14. Hygiene

- Writes: this report + the `_155` tracker landing block. Nothing else — no source,
  test, scene, sidecar or doc edit; no git write (status/read-only only); no port
  bound; no packet; no process started; no device HTTP.
- Scratch: none needed; nothing created outside the two writes above.
- No future dates in this file or the tracker block. IPs redacted to `10.x.x.NN` in
  prose; the quoted v3 schema carries controller NAMES, not addresses, by design.

---

## 15. AMENDMENTS — operator rulings + `_154` (fixture) + `_153` (packet/routing) root cause

Landed the same day as the design, folded in place. §§1–14 are the original record;
where an amendment supersedes a section it is marked there and finalized here.
Inputs: operator rulings on §13; `_154` (M1: the sim tab is a priority-150 second
writer; mapping itself byte-perfect 344/344); `_153` (F1 confirms M1 with the exact
process path, F1b percent-scaling clip, F2 shared CID, F3 dead arbitration, F4
engine-direct unicast, plus the correction that the browser does NOT transmit strand
universes — the LED half of `_154` M1 is retracted and this design does not build
against it).

### A1 — Rulings applied

- **No presets.** The picker is the simplest possible per-slot mapping UI: one row
  per bench slot, one dropdown each, pre-filled (last-used > default), `none`
  everywhere, Cancel/ARM. §8.3's "region preset row" idea is dropped; the
  `[↺ defaults]`/`[last used]` reset buttons stay (they are two buttons, not a
  feature).
- **Scene-parametric source.** The source scene is **whatever scene the engine is
  on at ARM time** — no scene picker UI, no `source_scene` key in the sidecar
  (removed, A6). Candidates are resolved from THAT scene's
  `patches/scene_config/controllers` under the unchanged §5 compatibility rules.
  Consequences, all loud:
  - engine scene == the bench scene itself → refuse (R-22a: a scene cannot stand in
    for itself; source and dest would be the same boxes);
  - the engine scene yields **zero** compatible candidates across all slots →
    refuse (R-22b, naming the scene and the slots' profiles);
  - a `default_source` name that does not resolve/compat in the CURRENT engine
    scene → the **defaults path refuses** (R-22c names slot + scene); the picker
    path is unaffected (that slot pre-selects nothing and the operator chooses).
    Auto-substituting `none` would be a silent fallback; refused instead.
  - `evaluateArmedHealth` unchanged in spirit: the armed mapping is frozen against
    the scene it was computed for; the engine leaving that scene auto-disarms.
  - Last-used selection memory is keyed by **(bench scene, source scene)** so a
    titanic selection never pre-fills a studio arm. Still process memory only
    (ruling: confirmed as designed).

### A2 — New suppression model: ARMED = BENCH IS THE ONLY PHYSICAL OUTPUT

Operator ruling (verbatim intent): while armed, ignore the ship controllers and
route sACN to the test bench only; everything else stays correct **in the sim
only**, and stops getting physical data.

**The model in three sentences.** While armed, the bridge's relay set is **empty**
— every relay route of every active scene is suspended, and the mirror's composed
destinations are the only sACN the bridge (or anything else, per A3) emits.
`suppress_host` therefore ceases to exist: there is no per-pair/per-host scope to
declare because the scope is "everything", and `partitionMirrorSuppression`
degenerates to `armed-or-blackout-hold ⇒ suppress all (reason 'armed'|'blackout')`,
preserving the `_152` D1 single-call-site invariant with strictly simpler
semantics. Disarm restores the **entire** relay set in the existing
post-blackout recompute — no per-pair bookkeeping to get wrong.

**Ship goes DARK on arm, not frozen — decided, with reasons.** The suspended ship
controllers would otherwise hold their last frame indefinitely (DMX gateways have
no timeout; the MarsinLED `dmx.timeoutMs` is unwritten by this repo and may be 0 =
hold forever, `_150` §9). A ship frozen mid-pattern is a surprise in both
directions: it looks alive to a passerby and looks like a bug to the operator.
"Not getting data anymore" is made physically unambiguous by an explicit
**3× all-zero frames to every suspended relay destination at ARM**, through the
retiring relay senders, awaited before they close — the exact mirror image of the
disarm blackout, reusing `sendVia`/`_blackoutSettled` mechanics. `blackoutInFlight`
covers both directions: DISARM is refused while the arm blackout settles
(symmetric with `_152` D2). Sequence:

```
ARM:    checks (R-1…R-23) → gate :6972 + await ack (A3) → arm + recompute
        (relay suspended; zeros through retiring relay senders, awaited, then closed;
        mirror senders created) → ownership proof → status broadcast
DISARM: clear arm (hold raised) → 3× zeros to BENCH destinations (unchanged _151)
        → recompute restores ALL relay (ship refeeds with live frames — no ship
        zeros needed on this side) → ungate :6972 → status broadcast
```

**Engine-direct routes make "bench only" unprovable → refuse (R-21).** The bridge
cannot suspend what the ENGINE unicasts itself (`engineState.owned`, from
`/status outputRouting`), and `_153` F4 proves address-keyed overlap checks cannot
establish board identity (`10.x.x.202` may be the same physical board the bench
binds at `10.x.x.60`). Unprovable ⇒ refuse (codex P0): **ARM refuses while the
engine reports ANY direct controller destination**, naming the routes —
*"the engine itself unicasts U10, U12 → 10.x.x.202; the bridge cannot suspend an
engine-direct route, so 'bench only' cannot be proven. Remove the engine's
`controllers:` block (those universes then flow to loopback and relay through the
bridge) and arm again."* This subsumes old R-9/R-10 (strictly stronger). Practical
consequence the operator must know: **today's `marsin_engine/config.yaml` carries
the `Titanic-202` block, so ARM will refuse until it is removed** — which per
`_153` F4 also un-darkens ship U10/U12 (`Left Back Wall 3/4`, `Left SmokeStack
1-4`), currently receiving nothing at all. Open question A9-1.

**UI truth (supersedes §8 text):**
- Banner: `🪞 BENCH MIRROR ACTIVE — <LABEL> · BENCH IS THE ONLY PHYSICAL OUTPUT —
  ALL SHIP OUTPUT SUSPENDED (zeroed) · <N> slots (<M> dark)`.
- Controllers header while armed: `🪞 BENCH MIRROR: ACTIVE — <LABEL> · SHIP OUTPUT
  SUSPENDED — DISARM`.
- Controllers cards: bench destinations badge `🪞 MIRROR OWNS U<n>`; every other
  controller card badges `⛔ OUTPUT SUSPENDED — bench mirror armed (sim-only)`.
- Arm log gains: `⛔ ALL ordinary relay SUSPENDED (<k> routes, zeroed 3×) — the
  bench is the only physical output while armed.`
- §6.1's all-`none` question is moot: an all-`none` controller is owned-dark
  trivially under global suppression. (Former §13 Q2 closed by this ruling.)

### A3 — The sim-side writer (`_154` M1 / `_153` F1): server-side gate at :6972

**Confirmed topology (`_153` F1):** the priority-150 stream is
`animate.js:682-727` → `sacn_output_client.js` → `ws://localhost:6972` →
`server/sacn_output_bridge.js:63-73` — a **separate process** from the input
bridge (`start.js:105-116`). No suppression inside `sacn_bridge.js` can touch it,
and the old ARM placement *required* the mode (`sacn_in`) that turns every sim tab
into this writer. (The Controllers-header relocation in this design already removes
that structural trap; `_153` retracted the LED half — strands are not in
`params.parLights`, so `:6972` never carries U30/U31/U10/U12.)

**Chosen mechanism — gate at the choke point, prove it at ARM:**

1. `sacn_output_bridge.js` gains one JSON control message (additive — it currently
   ignores non-binary frames, `:126-128`): `{type:'benchMirrorGate', gate:true|false,
   reqId}` → ack `{type:'benchMirrorGateAck', reqId, gated, dropped}`. While gated it
   sends **nothing** to any controller: every 519-byte frame is dropped and counted,
   with one log line per transition (`⛔ physical output GATED — bench mirror armed
   (<n> frames dropped so far)` / `▶ physical output UNGATED`).
2. `sacn_bridge.js` (the arm-state owner) holds a loopback WS **control link** to
   :6972. The gate is **held only while that link is up and asserting armed**: if
   the link drops (input-bridge crash — the arm dies with the process), the output
   bridge auto-ungates loudly. Fail-safe direction matches the arm's own lifecycle:
   no process, no arm, no gate, no stuck-dark ship.
3. **ARM-time proof:** the arm sequence sends `gate:true` and awaits the ack
   (timeout ~1 s) **before** any suppression or composition. No ack ⇒ **refuse**
   (R-23): *"cannot prove the sim's physical output path (:6972) is gated — the
   output bridge did not acknowledge; the sim itself would remain a priority-150
   writer."* DISARM sends `gate:false` after the relay is restored.
4. **Client-side belt, not enforcement:** on `benchMirrorStatus.armed` the sim tab
   also stops its own transmit loop (one check in `animate.js`'s output block) —
   honest UI and less loopback traffic — but the SERVER gate is the guarantee:
   stale tabs, second windows, and arm/status races all funnel through :6972.

**Why this over the alternatives.** A client-side gate alone trusts every tab
(multi-window is warn-but-allow; a tab opened after arm, or one that never
processed the status, keeps writing). An arm-time refusal-on-detection is racy in
the same way (the writer can appear after the check) and would force the operator
out of their operating mode. The :6972 gate is deterministic, covers all present
and future browser windows at once, needs no browser cooperation, and its ack turns
the one-writer promise into something the ARM can **prove** rather than assume.
Named residual: a non-browser rogue UDP writer on the LAN bypasses every mechanism
this repo can build; that stays a wire-capture matter (`_153` §7A/F9).

**Who physically writes to ship controllers, per mode — confirmed from code:**

| mode | disarmed | armed (this design) |
|---|---|---|
| `sacn_in` | engine → bridge relay at prio 100 **and** every sim tab via :6972 at hard-coded 150 (`animate.js:713`) — the tab outranks; with the shared CID both streams corrupt each other (`_153` F2). Pre-existing writer-#2, now on record | bridge relay ∅ (A2) + :6972 gated (this section) ⇒ **mirror is the only writer anywhere**; ship dark (zeroed) |
| other modes | :6972 carries only mapping-profile/effects output (`animate.js:709`); bridge relay still relays engine frames (the bridge is browser-mode-agnostic) | same as above — the gate and the global suppression are mode-independent |

### A4 — Priority and CID (`_153` F2/F3)

- **Mirror priority above 150: REJECTED.** It masks a second writer instead of
  refusing it — the exact bug class just lived through, made invisible; with the
  shared CID (F2) the two streams still corrupt each other through sequence-number
  discard *regardless* of priority, so escalation does not even reliably buy the
  symptom back; and F3 shows the bridge would compose-and-re-emit a priority-150
  inbound at 150, so priority games ride a dead arbitration path. Enforcement is
  the A3 gate + refusals. Two adjacent recommendations for the implementation
  owner (small, in-scope): the mirror emits at a **fixed, declared priority equal
  to the engine's configured 100** instead of inheriting the source frame's
  (closes the F3 corollary where a rogue 150 inbound exits the mirror at 150);
  and `common.yaml sacn_high_priority` should be raised above the engine's 100 so
  the bridge's arbitration branch is reachable at all — flagged as its own F3 work
  item, not this slice.
- **Distinct CID: YES.** Every project sender currently ships the `sacn` package's
  DEFAULT_CID, so any two writers on one universe look like ONE E1.31 source with
  interleaved sequence counters — receivers discard semi-randomly even ignoring
  priority (F2, measured). The mirror's senders get their **own stable CID**
  (derived from a fixed namespace + role string, e.g. `bm26:bridge-mirror`), and
  the recommendation extends project-wide as a separate small slice: engine,
  bridge-relay, output-bridge, each a distinct stable CID — turning any residual
  two-writer situation into deterministic multi-source arbitration and making wire
  captures attributable. This design REQUIRES only mirror-CID ≠ output-bridge-CID.
  The arm-time ownership proof stays route-table-based (the bridge cannot sniff
  its own UDP); on-the-wire CID verification remains the operator's tshark step
  (`_153` §7A), which distinct CIDs finally make readable.

### A5 — `_154`/`_153` secondary findings folded into the plan

- **Fixture-equality test upgrade:** `tests/bench_mirror.test.js:490` asserts
  footprint equality only; `_154` confirms it must be **fixtureType** equality
  (§5's rule). T-4 now includes upgrading the live test to assert type identity,
  not just footprint width.
- **Wire-transform truth tables (F1b + F7/F8):** the engine currently feeds 0-255
  DMX into a percent field — everything ≥ DMX 101 leaves as 255 (measured
  50→127, 100→255), and the mirror path re-quantises (54/256 values exact, worst
  −3). T-3's byte-exact assertions are **pre-Sender buffer** assertions and stay
  exact; but any test or smoke step that asserts WIRE bytes or physical output
  must model the current ×2.55-clip transform, and the deterministic truth-test
  constants are restricted to the survivable set — **0 and 255 only** round-trip
  both lanes exactly (T-3's red/green/blue/white/black frames already comply;
  stated as a rule now). The F1b fix (`useRawDmxValues` on every sender + removing
  the receive-side compensation in the same change) is a **separate work item with
  its own before/after retest** — per `_153`'s sequencing note it must NOT land in
  the same window as the mirror retest, or the retest is unreadable.
- **Smoke procedure reads logs, not eyeballs:** "armed but outranked" and "mirror
  inactive" are visually identical (`_154`). The §11 plan gains T-9 and the
  operator instructions gain: a bench smoke PASSES only on the bridge's own
  transition lines — `ARMED`, `⛔ … relay SUSPENDED`, the :6972 `GATED` ack line,
  and the composes lines — plus the bench visual; the visual alone proves nothing.

### A6 — Final v3 schema (supersedes §3's snippet) and catalog/test deltas

```yaml
# bench_mirror.yaml — v3 (amended). NO addresses, NO universes, NO IPs, NO slices,
# NO source scene (dynamic: the engine's active scene), NO suppression policy
# (armed = global physical-output suppression; there is nothing to scope).
version: 3
enabled: true
label: Test bench stand-in

slots:
  - { slot: par_1,         bench_fixture: Par 1,         default_source: Left Auditorium 5 }
  - { slot: par_2,         bench_fixture: Par 2,         default_source: Left Auditorium 6 }
  - { slot: par_3,         bench_fixture: Par 3,         default_source: Left Auditorium 7 }
  - { slot: par_4,         bench_fixture: Par 4,         default_source: Left Auditorium 8 }
  - { slot: vintage_left,  bench_fixture: Vintage Left,  default_source: Left Front Rails 1 }
  - { slot: vintage_right, bench_fixture: Vintage Right, default_source: Left Front Rails 2 }
  - { slot: bar_left,      bench_fixture: Bar Left,      default_source: Left Front Wall 1 }
  - { slot: bar_right,     bench_fixture: Bar Right,     default_source: Left Front Wall 2 }
  - { slot: led_0,         bench_fixture: LED_0,         default_source: Left_Front_Left }
  - { slot: led_1,         bench_fixture: LED_1,         default_source: Left_Back_Left }
  # FUTURE TE SIGN SLOT — activate by patching the bench sign and uncommenting:
  # - { slot: te_sign_a,   bench_fixture: TE Sign V3 A,  default_source: TE Sign V3 A }
```

(`default_source` names resolve against the engine's scene at arm time; against a
non-titanic scene the defaults path refuses per A1 and the picker is the way in.
`label` no longer names a region — the banner appends the live source scene:
`ACTIVE — TEST BENCH STAND-IN ← titanic`.)

- Resolution algorithm (§4): step 2 (suppression policy) is deleted; step 7's
  checks are the amended catalog; a new step gates :6972 (A3). Everything else
  stands, including materialize-and-revalidate.
- Test plan deltas: T-1 drops policy cases, adds v3-amended schema cases; T-2 adds
  scene-parametric cases (non-titanic synthetic source scene; R-22a/b/c); **T-9
  (new)**: output-bridge gate — gate/ungate round-trip, drop counting, control-link
  drop ⇒ auto-ungate, ARM refused without ack (R-23), gate ack strictly precedes
  the first composed send, DISARM ungates after relay restore (all in the existing
  fake-socket rig plus a stub :6972 module — zero real ports); **T-10 (new)**:
  global suppression — armed ⇒ relay set empty for EVERY active-scene route, 3×
  zeros to every suspended destination at ARM through the retiring senders,
  disarm restores the full set, blackout-hold generalization pins the single call
  site. Implementation slices: S3 grows the :6972 gate + control link (~60 ln in
  the output bridge, ~40 in the input bridge); everything else as sliced.

### A7 — Refusal catalog after amendment (stable numbering)

- **R-7 replaced**: "engine on the wrong scene" no longer exists (any scene is a
  legal source). Its slot is now: engine unreachable **or reports no scene** —
  the source scene is unprovable ⇒ refuse (was already half of R-6; R-7 keeps the
  scene-shaped text).
- **R-9/R-10 subsumed by R-21** (engine-direct routes make bench-only unprovable —
  refuse while `engineState.owned` ≠ ∅, routes named). Kept in the table as
  "subsumed" rows so old test names keep meaning.
- **R-17 retired** (no suppression policy exists to be missing or stale).
- **R-21** engine-direct routes present (A2). **R-22a/b/c** scene-parametric
  refusals (A1). **R-23** :6972 gate unproven (A3).

### A8 — What `_153`/`_154` confirmed about the landed design (no change needed)

The mapping/composition core this design reuses is proven byte-perfect (`_153`
F5/F6/F8: suppression exact, composition 344/344 + 80/80 ×2 with zero defects,
model layout matches). The failure was entirely outside the `:6971` boundary —
which is precisely the boundary this amendment extends the design across. The
Controllers-header relocation (Mission C, §8) independently removes the
structural aggravator that the ARM control only existed inside the mode that
defeated the mirror.

### A9 — Open questions for the operator (amended set; the §13 set is closed)

1. **R-21 blocks arming today**: `marsin_engine/config.yaml` still carries the
   `Titanic-202` (`10.x.x.202`, U10/U12) block, so ARM will refuse until it is
   removed. Per `_153` F4 those universes currently reach no ship fixture at all,
   and removing the block routes them to loopback → bridge relay → the ship's
   U10/U12 boxes. Remove it before the retest (operator/engine action — agents do
   not touch the live engine), or should the engine grow a runtime
   "park direct routes" control first?
2. **Ship dark on ARM** (A2): designed as 3× zeros — the ship goes deterministically
   dark, never frozen mid-look. If you prefer frozen-last-look ("stay as is"
   read literally, physically), say so — it is a one-decision change, but a frozen
   ship is indistinguishable from a live one at a glance, which is why dark is the
   designed answer.
