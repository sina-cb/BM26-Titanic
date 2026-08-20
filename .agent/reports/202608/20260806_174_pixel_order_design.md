# _174 — Persistent pixel-order design: scene flag (A) + bench-mirror reverse (B)

Date: 2026-08-06 · Agent: _174 (Fable, design, read-only) · Branch: feat/bm_readiness @ 86f6ee4d
Status: **DESIGN CONTRACT — no source touched.** Implementation goes to Opus agents per §5.

Problem source: calibration pattern `marsin_engine/patterns/71_calibration_fixture_pixel_order.js`
exposed fixtures whose physical pixel order opposes the model. Two distinct corrections:
**A** — a persistent scene-level NORMAL/REVERSED flag for generator-group members whose physical
fixture is wired opposite to the model; **B** — a persisted per-slot "Reverse Pixels" toggle in the
bench mirror for when source and destination scenes are each individually correct but their fixture
orientations differ (observed today: `test_bench` Bar Left/Right localIndex 0→17 runs toward
**decreasing** X while `titanic` Left Front Wall 1/2 runs toward **increasing** X).

Every anchor below was spot-verified against the working tree at 86f6ee4d (files + line ranges
cited inline). Recon inherited from the prior read-only agent held up everywhere it was leaned on,
with one addition it missed (§1, F-6: LED-bus fixtures inside the DMX exporter loop).

---

## 1. Audit of the external brief

The brief (another AI's output) got the *requirements* mostly right and the *architecture* wrong
where it touched persistence. Verdicts:

- **(a) Storage in "scene_config fixture/strand state" — WRONG.** Any field stored on a generated
  fixture literal is destroyed by regeneration: `generateGroupFromTrace()` is destroy-and-recreate
  with no merge (`sweepGeneratedInstances`, `simulation/src/gui/trace_group_rename.js:68-78`; fresh
  literals at `simulation/src/gui/gui_builder.js:5009-5026`), and **boot regenerates every
  `generated: true` trace** (`gui_builder.js:6046-6050`) — the flag would be wiped on every scene
  load. Correct location is a top-level **name-keyed store** in `scene_config.yaml` following the
  `groupOverrides` idiom (`simulation/src/core/config.js:163-165` load intercept, `:208-213/267-270`
  prune-on-persist), which survives regeneration because the sweep replaces fixture literals only.
- **(b) "Every multi-pixel DMX fixture, typed LED fixture, and raw LED strand" — OVERTAKEN.**
  Operator ruling: manually-placed fixtures are flipped in 3D directly; only rigid
  **generator-group members** get Mechanism A (§2). Extension path noted in §2.9; not required.
- **(c) Correct and adopted:** no reverse control on single-pixel fixtures (pars); first-N-window-
  then-reverse for longer LED sources; per-source-scene keyed persistence; loud validation at
  picker-open and ARM.
- **(c) "Sidecar versioning + atomic migration" — MISDIRECTED.** Extending `bench_mirror.yaml` to
  v4 and having the bridge rewrite it would (1) destroy the sidecar's ~70 lines of operator-facing
  comments the first time `yaml.dump` re-serializes it, (2) violate the v3 contract "the sidecar
  declares only what cannot be derived" (`simulation/lib/bench_mirror.cjs:24-44`) — a last-used
  selection is runtime memory, not declaration — and (3) make every picker gesture dirty a
  hand-authored checked-in file. §3 uses a **separate machine-owned state file**; the one existing
  sidecar stays v3 **verbatim, zero migration**.
- **F-5 (missed by the brief): persistence reverses a standing ruling with a guard test.**
  `_lastSelection` being process-memory-only is a *deliberate* _155 §10 decision with a written
  rationale (`simulation/server/sacn_bridge.js:318-324`) and an enforcing test
  (`simulation/tests/bench_mirror.test.js:588-595` — greps that `_lastSelection` never touches
  disk). Slice 2 must **rewrite that test to the new invariant** (§3.4), not "fix" it, and the
  rationale comment must be replaced with the new one. The brief never noticed the collision.
- **F-6 (missed by the brief): "permute channels" is a silent no-op for LED-bus fixtures.** In the
  DMX exporter loop, an LED-bus fixture's per-pixel channels are the controller's order map —
  identical for every pixel — and its wire association is the per-pixel `ledWalk[j]` patch
  (`simulation/src/dmx/pixelblaze_model_exporter.js:213-220,272-274`). Permuting `channels` there
  reverses nothing. The seam must permute **the wire association**, which is `channels` for DMX
  pixels and the **`ledWalk` patch entry** for LED-bus pixels (§2.6).
- **F-7 (underspecified): control channels.** A definition-driven DMX reversal must identity-copy
  the channels no pixel claims (Vintage ch 1,2,9-15 — dimmer/strobe/aux/macros,
  `simulation/dmx/fixtures/vintage_led_stage_light/model_33.yaml:96-123`). The brief said
  "footprint-aware" without saying this.
- **F-8 (silent on):** the Swap-start/end interaction (§2.5 settles it), who writes the state file
  (one writer = the bridge, §3.4), and how the flag reaches hardware (via engine-model re-export,
  so it lands on the next model reload — the UI must say so, §2.8).

---

## 2. Mechanism A — scene-level per-fixture pixel order (generator-group members)

### 2.1 Storage schema — top-level name-keyed store (confirmed over alternatives)

```yaml
# scene_config.yaml (top level, sibling of groupOverrides)
pixelOrder:
  Left Front Wall 1: reversed
```

- Keyed by fixture **name** — the only identity a generated fixture has
  (`simulation/src/dmx/generator_chain_order.js:250`; renames of generated fixtures are refused,
  `gui_builder.js:972-981`). Flat map, not nested per group: the group is embedded in the name.
- Wired **exactly like `groupOverrides`**: load intercept before the generic `{value}` recursion in
  `config.js` (~L163), prune-on-persist (~L208/267). Round-trip through POST `/save` is free: the
  server strips only the enumerated DMX/LED keys **from fixture arrays**
  (`simulation/server/save-server.js:285-356,362-405`); an unknown top-level key passes untouched.
- Survives regeneration by construction (store lives outside the fixture literals the sweep
  replaces), same as `groupOverrides` — the proven idiom
  (example: `simulation/scenes/test_bench/scene_config.yaml:343-347`).
- Only non-default entries persist: prune keeps `reversed` entries, drops everything normalized.
  Absence = normal is the *defined default state* (precedent: absent `trace.chainSplits` = path
  order), not a fallback.

### 2.2 Enum validation

- Accepted values: exactly the lowercase strings **`normal`** and **`reversed`**. Case-sensitive.
- The UI writes only `reversed` and deletes the key on normal; a hand-authored `normal` is legal
  and pruned away on the next save.
- Anything else (`REVERSED`, `true`, `1`, objects): **throw at model export** with the fixture name
  and offending value quoted plus the fix ("edit scene_config.yaml pixelOrder: … must be 'normal'
  or 'reversed'"). Because `exportConfig()` runs `saveModelJS()` FIRST and aborts the whole save on
  throw (`gui_builder.js:391-446`), an invalid enum can never half-save. Boot validation (§2.7)
  reports the same finding as a toast + console.error without crashing the boot render.
- Entry targeting a **single-pixel** fixture definition: also **throw at export** (the UI never
  offers it, so this is always a hand edit; silently exporting identity would hide the mistake).
- Entry naming a **nonexistent fixture** (stale): loud **warn**, never throw — see GC §2.7. Stale
  entries are inert (no fixture matches), and throwing would brick saves after a legitimate manual
  deletion.

### 2.3 Regeneration merge semantics (operator's verbatim intent, mechanized)

- **Grow (4→5):** zero action. Names 1-4 survive the sweep, the name-keyed store is untouched, the
  new "`<group> 5`" has no entry → NORMAL. Flip on 3 is preserved automatically.
- **Shrink (4→2):** at the existing casualty site (`gui_builder.js:5060-5065`, where
  `regenCasualties` is computed and `window.controllerMappingFixturesRemoved()` fires): filter
  casualties whose names carry a `pixelOrder` entry; if any, **delete those entries explicitly**
  and warn via `console.warn` + `showToast` (same channel as the resnap warning at L5050-5055):

  > ⚠ <Group>: count change removed fixture(s) carrying a REVERSED pixel-order flag — cleared:
  > <Group> 3, <Group> 4. If you grow this group again, re-verify pixel order with calibration
  > pattern 71.

  Never silently keep (the entry would resurrect onto a brand-new physical light on regrow); never
  silently drop (the toast + console line ARE the warning the operator demanded). Toast TTL 14000
  like the resnap message.
- **Group delete / rename sweep:** every consumer of `sweepGeneratedInstances` casualties routes
  through the same clear-and-warn helper — one code path, one message shape.

### 2.4 Rename carry

Alongside `carryTraceGroupOverride` (`trace_group_rename.js:89-95`, called at
`gui_builder.js:5432`): new pure `carryPixelOrderEntries(pixelOrder, oldName, newName, count)`
moves `` `${old} N` `` → `` `${new} N` `` for N = 1..count. Collisions are impossible — the rename
validator already refuses merging into an existing group (`traceRenameError`).

### 2.5 Swap start/end ruling: **name-stuck** (the precedent), with the dialog extended

`⇄ Swap start/end` writes `chainSplits = [{from:n,to:1}]` and renumbers
(`gui_builder.js:5829-5864`); "Group 1" lands on the far physical end while every name-keyed store
stays put. Ruling: **pixel-order flags stay name-stuck too.**

Operator justification: after a Swap, *every* name-keyed physical fact — DMX address, engine ids,
2D anchors — already points at a different physical light, and the `confirmRenumber` dialog
(`gui_builder.js:5651-5668`) says exactly that; the operator's next move is a re-verify pass by
name. A hybrid where the pixel-order flag secretly followed the physical unit while its DMX address
did not would split one fixture's identity across two lights — the flag would ride a fixture whose
address it was never verified with. One rule ("everything keyed on the name stays put") is
learnable; two rules are a trap. And there is no unit identity to follow anyway — the name IS the
identity.

Required dialog change — append to the moved-properties bullet list in `confirmRenumber`:

```
  • pixel-order flags (NORMAL/REVERSED)
```

and, when any member of the group carries a `reversed` entry, append a line naming them:
`Currently REVERSED: <Group> 3.` so the operator knows a physical re-verify (pattern 71) is due.

### 2.6 Exporter seam — permute the WIRE ASSOCIATION only

In the DMX-fixture pixel loop (`pixelblaze_model_exporter.js:187-311`), with
`N = fixture.pixels.length` and `rev = (pixelOrder[light.name] === 'reversed')`, define
`P(j) = rev ? N-1-j : j`. Then:

- **DMX pixels:** `channels: standardizeChannels(fixture.pixels[P(j)].model.channels)` — channels
  read from slot `P(j)`; everything else (worldPos/renderWorld from slot `j`, `localIndex: j`,
  `pixelSize`, name suffix from slot `j`'s model id, `apply` closing over `j`) unchanged.
- **LED-bus pixels (same loop):** `patchObj` reads `ledWalk[P(j)]` instead of `ledWalk[j]`
  (channels are the controller order map — identical per pixel — so the patch entry IS the wire
  association there). This is audit finding F-6; without it the toggle is a silent no-op on
  LED-bus generator fixtures.
- No coordinate moves, no address changes, no intra-pixel byte reversal. Vintage's non-contiguous
  per-head channels (`value` 3..8, `rgb` 16..33) permute correctly because channels come from the
  definition's own per-pixel map; Shehds RGBWAU blocks stay intact; w/a bytes never swap because
  the whole per-pixel channel map moves as a unit.
- Applying the permutation in `sacn_mapper.js` instead stays rejected (flat list, no fixture
  grouping serialized — recon assessment confirmed).

**pixelLocalIndex semantics after reversal:** `localIndex` remains the spatial slot `j` — patterns
stay spatial, geometry stays slot-true, meta lane 5 and
`marsin_engine/lib/pixel_local_index.js:71-95` are untouched (still a full 0..N-1 carry per
fixture). Only the wire association permutes. **Zero engine-side changes in Mechanism A.**

**Sim 3D preview: unchanged (shows model intent).** `apply` stays keyed to `j`
(`pixelblaze_model_exporter.js:307-310`), so the sim renders pattern color at model-slot geometry.
That is operator-correct because the flag exists precisely to make the hardware look like the sim;
mirroring the reversal in the preview would make the sim display backwards exactly when the
hardware displays correctly. Self-consistency for free: the inbound sACN demap
(`simulation/src/dmx/sacn_mapper.js` — wire association is only
`bufferIndex0 = (patch.addr-1)+(channels.X-1)`, L260-380) reads the SAME permuted `channels`, so a
sim monitoring engine output also places bytes at the slot whose color they carry — model-truth in
both directions.

### 2.7 GC policy — loud, never silent

- Stale entry = names no fixture after boot regeneration completes (validation must run AFTER the
  L6046-6050 auto-regenerate, or every generated fixture looks missing).
- At boot and at every save: `console.warn` listing stale names + toast with the count.
- Removal is an explicit gesture only: a `🧹 Clear stale pixel-order entries (N)` button in the
  DMX Fixtures panel header, `confirm()` listing the names, then delete + `debounceAutoSave()`.
- Never auto-delete, never silently ignore; shrink/delete/rename paths already clear their own
  casualties eagerly (§2.3), so stale entries only arise from hand edits or manual deletions.

### 2.8 UI placement + affordance

- Location: the generated group's per-fixture row in the DMX Fixtures panel (the `isTraceGroup`
  limited-editing branch, `gui_builder.js:2202` ff), alongside the DMX patch controls.
- Control: a small toggle button, `Px →` when NORMAL (secondary color) / `Px ⇄ REVERSED` when
  reversed (caution styling, same family as the Swap button at L5837-5841). Tooltip: "Pixel order
  on the wire. REVERSED = this fixture is wired opposite to the model. Verify with calibration
  pattern 71."
- Rendered **only when the fixture definition has more than one pixel** (registry lookup by
  `fixtureType`); pars never see it.
- onClick: mutate `params.pixelOrder` → `debounceAutoSave()` → toast: "Pixel order saved — engine
  model re-exported. Reload the model/pattern on the engine to see it on hardware." (The preview
  deliberately does not change — §2.6 — so the toast must say where the effect lands. No silent
  stale-model state.)

### 2.9 Save/regen/reload flow (end to end) + extension note

Toggle → store mutation → `debounceAutoSave` → `exportConfig` → `saveModelJS` (permuted wire
association, validation throws abort the save loudly) → `/save-model` ×3 → POST `/save`
(`pixelOrder` round-trips top-level) → engine applies on its next model reload. Boot: scene load →
store intercept → traces auto-regenerate (fixtures recreated, store untouched) → validation pass
(stale warn / invalid error) → next save re-exports from the store.

Extension (not required now): manual fixtures reuse the same store + validation with the toggle on
their own rows; raw strands permute `ledPixels[P(j)]` at `pixelblaze_model_exporter.js:513`. No
schema change needed — the design extends by adding read sites only.

New pure module for all of the above logic: `simulation/src/dmx/pixel_order_store.js`
(`validatePixelOrderStore`, `carryPixelOrderEntries`, `clearCasualtyPixelOrder`, `isReversed`,
`reverseIndex`) — unit-testable with no DOM/THREE, mirroring `trace_group_rename.js`.

---

## 3. Mechanism B — bench mirror per-slot Reverse Pixels, persisted

### 3.1 Persistence: a separate machine-owned state file (sidecar stays v3 verbatim)

New file, written only by the bridge: **`simulation/scenes/test_bench/bench_mirror_state.yaml`**
(generic rule: sibling of any scene's `bench_mirror.yaml`, owned by the bench scene).

```yaml
# MACHINE-WRITTEN by the sACN bridge on every successful ARM. Safe to delete
# (you lose remembered picker selections, nothing else). Cannot arm anything.
state_version: 1
selections:
  titanic:                     # key = SOURCE scene (the engine's scene at ARM)
    slots:                     # every sidecar slot, explicitly — absence is not a choice
      par_1:      { source: Left Auditorium 5, reverse: false }
      bar_left:   { source: Left Front Wall 1, reverse: true }
      led_0:      { source: none,              reverse: false }
```

Why not `bench_mirror.yaml` v4 + migration (the brief's proposal): a machine rewrite obliterates
the sidecar's operator documentation (yaml.dump keeps no comments); selection state is runtime
memory, not declaration (v3 contract); a separate file keeps the checked-in declarative file
byte-stable while state churns — the same tracked-runtime-residue pattern already accepted for
`marsin_engine/states/**`. **No version bump, no migration, zero risk to the existing sidecar.**

Parser: new pure `simulation/lib/bench_mirror_state.cjs` in the exact `bench_mirror.cjs` style —
`STATE_VERSION = 1` refused by name otherwise; exported key sets (`STATE_KEYS`, `SELECTION_KEYS`,
`SLOT_STATE_KEYS = {source, reverse}`) with unknown-key refusal; `source` a non-empty string or the
literal `none`; `reverse` a strict boolean. Writer: `writeBenchMirrorState(root, scene, state)` —
atomic tmp+rename, and it **refuses any path not under the injected scenes root** (test seam §5.3).

Answering the _155 §10 rationale head-on (why persisting is now safe): the file can rot against the
scene, but rot is **detected loudly** at picker-open and ARM (§3.3) and never silently applied; it
ships via `robocopy /MIR`, but it carries no arm bit and no plumbing — its key sets cannot express
an address or an activation — so a deployed copy can only pre-fill a picker. Arming remains a
process-memory operator gesture (`bench_mirror.cjs:299-324` unchanged).

### 3.2 `_lastSelection` is DELETED, not subordinated

`simulation/server/sacn_bridge.js:324` (map), `:1553` (picker read), `:1862-1864` (ARM write) —
replaced by the state file. Two stores would drift; the file is tiny and read fresh at every
picker-open (no cache). The rationale comment at `:318-324` is replaced with the new invariant.

- **Write point: on ARM success only** (where `:1863` sits today) — the one moment a selection is
  *proven* resolvable. Picker browsing never writes.
- Written under `selections[<sourceScene>]`, replacing that key wholesale; other scenes' entries
  are preserved.
- Unparseable existing state file: picker-open reports it loudly (payload-level error string with
  the parse message: "bench_mirror_state.yaml is unreadable — <err>; stored selections
  unavailable, fix or delete the file"); an ARM with a fresh explicit selection still proceeds and
  its success **rewrites the file, logged in as many words**. Loud, not silent — and never a
  refusal loop that requires hand-editing a machine file to arm.

### 3.3 Validation at picker-open and ARM (stale = loud, never silent)

Picker-open (`buildPickerPayload`, `sacn_bridge.js:~1549`): resolve slots as today, then overlay
`state.selections[engineState.scene]` — keying by the engine's **current** scene is what makes a
`titanic` mapping structurally unable to leak into another scene's session. Per stored entry:

- slot id not in the sidecar → entry reported in a payload-level warning, never applied;
- `source` not among the slot's current candidates → the row carries
  `stored: {source, reverse}` + `staleReason` quoting the stored name and the live `checkCompatible`
  /resolution failure ("stored source 'Left Front Wall 1' no longer resolves against 'titanic' —
  no patch entry named …; pick again"), and the row prefills **nothing**. The file entry is NOT
  deleted — it stands until the next successful ARM overwrites the scene key;
- `reverse: true` on a slot whose resolved destination is single-pixel → not prefched, loud note.

Payload additions per slot: `reverse` (prefill), `reverseApplicable`
(dest pixel count > 1, from the resolver), `stored`, `staleReason`.

ARM: the WS selection schema becomes `{ [slotId]: {source: string|null, reverse: boolean} }` —
**full replacement, old flat shape refused by name** with the new shape spelled out (no dual-shape
acceptance; a fallback parser is the codex ban). Resolver-side refusals (new ids continue the
catalog): non-boolean `reverse` → refuse; `reverse: true` on a single-pixel DMX destination →
refuse ("meaningless on a 1-pixel fixture — refusing rather than ignoring"); `reverse: true` on a
DMX type whose definition cannot be provably permuted (§3.5 registry validation failed) → refuse
naming the definition file. Existing R-12/13/14/15 continue to cover unknown slots/sources/
incompatibility — a stored-but-stale selection sent to ARM dies on R-14 exactly as a hand-typed one.

### 3.4 The guard test and comment flip (deliberate ruling reversal)

`simulation/tests/bench_mirror.test.js:588-595` currently asserts `_lastSelection` never touches
disk. Slice 2 rewrites it to the new invariant: the bridge's only state-file writes go through
`writeBenchMirrorState` (atomic, scenes-root-guarded); the ARMED flag itself still never persists
(assert the state parser's key sets cannot carry `armed`/`enabled`/addresses — same technique as
the exported `SLOT_KEYS` assertion); every bridge/launcher start still comes up DISARMED. Record in
the tracker that this reverses _155 §10 by operator order.

### 3.5 Registry extension + `computeSlices` permutation

`loadFixtureRegistry` (`simulation/lib/bench_mirror_resolve.cjs:628-657`) additionally parses
`model.pixels[].channels` per type → entry gains `pixels: [{id, channels: {role: ch}}]`.
Load-time validation (throw, named): every pixel carries the same role set; every channel within
1..footprint; no channel claimed by two pixels. Types that fail keep `pixels: null` → reverse
refused for them at ARM (§3.3), NORMAL path unaffected.

`computeSlices(dest, src, { reverse })` (`bench_mirror_resolve.cjs:322-363`):

- **dmx, reverse=false:** unchanged — single whole-footprint slice, byte-identical to today.
- **dmx, reverse=true (footprint-aware, definition-driven):** with N pixels, build per-channel
  source mapping: channel `c` claimed as pixel `p`'s role `r` → source channel
  `pixels[N-1-p].channels[r]`; channel claimed by no pixel (controls) → source `c` (identity).
  Emit slices merged into maximal runs contiguous on BOTH sides. Vintage 33ch: `value` 3..8 →
  six 1-ch slices from 8..3; `rgb` 16..33 → six 3-ch head slices in reversed head order (r→r, g→g,
  b→b inside each head); controls 1-2 and 9-15 → two identity runs. Total coverage = footprint,
  disjoint — `validateMirrorTree` invariants hold by construction.
- **led_strand:** `window = srcPx.slice(0, destPx.length)`; if reverse, `window.reverse()`; then
  the existing merge loop pairs `window[i] → dstPx[i]`. **Always the first-N window, then reverse
  those N — never a silent switch to last-N.** Whole stride blocks move intact (w/a bytes keep
  their in-pixel offsets; nothing intra-pixel ever permutes).
- **led_fixture:** counts already equal (R-15 pixelCount rule) — same full-list reversal.

Slot `note`/`summarizeSlot` (`:592-603`)/`describeMirror`/arm-log lines/`broadcastBenchMirrorStatus`
payload all gain the reverse marker; armed status reports per slot:
`bar_left ⇐ Left Front Wall 1 · REVERSED`.

### 3.6 Picker UI

Per-row `⇄ Reverse Pixels` toggle rendered only when `reverseApplicable`; a visible
`NORMAL`/`REVERSED` badge on every applicable row (persisted value shown on reopen); an explicit
`Reset to defaults` button restoring sidecar `default_source` + reverse=false for all slots (a
staging gesture — writes nothing until ARM); stale rows show the stored value + reason per §3.3.

Bench-mirror v3 invariants that MUST survive untouched: bench-only ownership while armed, ship
blackout on ARM, socket-loss auto-disarm, one-writer, strict same-fixtureType compatibility,
slice-less destinations composed as zeros (`bench_mirror.cjs`, `sacn_bridge.js` arm/disarm paths).

---

## 4. The composition equation

Index space 0..N-1 per fixture; `R(k) = N-1-k`; all permutations are involutions in {I, R}.

**Where each permutation physically applies:**
- `S_src` (Mechanism A on the source fixture) is baked into the **source scene's exported model**:
  wire block `k` carries pattern color `S_src(k)`. Applied exactly once, upstream of the wire.
- `M` (Mechanism B slot toggle) is applied **wire→wire** in the mirror's slice table:
  dest wire block `k` := source wire block `M(k)`.
- `S_dst` (Mechanism A on the destination fixture) is baked into the **bench scene's exported
  model** — a path the mirrored stream **never traverses**: while armed the engine runs the source
  scene, relay is suppressed, and the bridge writes raw composed frames. `S_dst` exists only for
  the bench running standalone.

So on the wire at the bench: **dest block k carries pattern color `(S_src ∘ M)(k)` — `S_dst` does
not appear in the mirrored path at all.**

**Physical correctness.** Let `G` be a fixture's internal wiring (physical pixel at spatial slot
`s` is driven by wire block `G(s)`). A scene is individually correct ⇔ its flag equals its wiring
(`S_src = G_s`, `S_dst = G_d`). While mirrored, the bench pixel at slot `s` shows color
`S_src(M(G_d(s)))`; the ship pixel at slot `s` shows `S_src(G_s(s))`. Bench replicates ship ⇔

**`M = G_s ∘ G_d` — the slot toggle equals the RELATIVE physical orientation of the two fixtures,
independent of both scene flags** (they cancel: each scene's correction is already inside its own
wire stream before the mirror sees it). Operator statement: set REVERSED exactly when the two
fixtures' as-built pixel-0→N directions disagree — today's case (walls +X, bars −X) ⇒ REVERSED,
and that stays true no matter what Mechanism A flags either scene carries.

**Why double-application is impossible, by construction:**
1. The resolver's inputs are patches/controllers/scene fixture types/fixture definitions/sidecar/
   state file — it **never reads either scene's `pixelOrder` store** (contract rule; enforced by a
   source-grep test on `bench_mirror_resolve.cjs` + the bridge's resolver call sites).
2. `S_dst` lives in the bench's exported engine model, which is not an input to the bridge's
   composed frames (raw wire copy).
3. `S_src` is applied once at source export; the mirror consumes bytes, not the model.

**Mandatory combination matrix** (identity color ramp `c(0..N-1)`; assert the color index carried
by dest wire block `k`):

| # | S_src | M | S_dst | dest block k carries |
|---|-------|---|-------|----------------------|
| 1 | N | N | N | `c(k)` |
| 2 | N | R | N | `c(R(k))` |
| 3 | R | N | N | `c(R(k))` |
| 4 | R | R | N | `c(k)` |
| 5-8 | (rows 1-4) | | **R** | **byte-identical to rows 1-4** |

Rows 5-8 ARE the no-double-apply proof (flip the bench scene's `pixelOrder`, re-run, diff = zero).
Physical acceptance for today's rig (walls +X, bars −X): correct bench display ⇔ M = R, for both
S_src values (rows 2 and 4 are the aligned ones once `G_d = R` is accounted).

---

## 5. Implementation contract (Opus agents)

### 5.1 Slice 1 — Mechanism A (sim only; engine untouched)

Files: **new** `simulation/src/dmx/pixel_order_store.js` (pure);
`simulation/src/core/config.js` (load intercept + prune, the `groupOverrides` twin);
`simulation/src/gui/gui_builder.js` (per-fixture toggle in the isTraceGroup branch ~L2202 ff;
casualty clear-and-warn at ~L5060; `confirmRenumber` copy ~L5656; GC button; rename call site
~L5432); `simulation/src/gui/trace_group_rename.js` (`carryPixelOrderEntries`);
`simulation/src/dmx/pixelblaze_model_exporter.js` (P(j) seam: DMX `channels` from slot P(j) at
~L274, LED-bus `patchObj` from `ledWalk[P(j)]` at ~L215-218); `simulation/main.js` (boot validation
after trace auto-regen). Tests: new `simulation/tests/pixel_order_store.test.js` + exporter tests.
**Not touched:** `save-server.js` (add a test proving `pixelOrder` round-trips the split),
`sacn_mapper.js`, everything under `marsin_engine/`.

### 5.2 Slice 2 — Mechanism B + composition

Files: **new** `simulation/lib/bench_mirror_state.cjs` (pure parse + guarded atomic writer);
`simulation/lib/bench_mirror_resolve.cjs` (registry `pixels`, `computeSlices` reverse, selection
shape `{source, reverse}`, new refusals); `simulation/server/sacn_bridge.js` (delete
`_lastSelection` L324/1553/1863; state read at picker-open ~L1549 with overlay+stale reporting;
state write on ARM success; status broadcast + arm log reverse markers; WS ARM schema swap,
old shape refused by name); the picker client (consumer of `broadcastBenchMirrorStatus` — locate
in `simulation/src/gui/`, add toggle/badge/reset/stale row); tests
`simulation/tests/bench_mirror*.test.js` (REWRITE the _155 §10 guard per §3.4; add §4 matrix,
reverse slice shapes, state round-trip/stale/keying). `simulation/scenes/test_bench/bench_mirror.yaml`
is **not modified**.

### 5.3 Test seam + byte-identity proof (both slices; proven in slice 3)

- Injectable roots everywhere state is read/written: `bench_mirror_state.cjs` takes explicit
  absolute paths; the bridge passes the real scenes root at exactly one call site. The writer
  refuses paths outside its injected root. Tests inject scratch roots under `~/tmp` only.
- Guard: a test-context write aimed at the repo's real `simulation/scenes/` must be refused by the
  writer (assert the refusal directly).
- **Byte-identity proof:** SHA256 every file under `simulation/scenes/**` before and after the full
  sim test suite run; the digests must be identical (script step in slice 3; hashes computed to
  scratch, compared, reported in the slice-3 report). This is the "tests never touch real scenes"
  proof, and separately the all-NORMAL no-op proof: a `titanic`/`test_bench` save-load-save cycle
  with an empty `pixelOrder` store must be byte-identical.

### 5.4 Slice 3 — regression + isolation proofs (no product code)

Full matrix, from the operator's requirements — all mandatory:

1. Standalone `test_bench`, all-NORMAL, disarmed: scene files + exported models byte-identical
   (SHA256) to pre-change.
2. `computeSlices` dmx/led with `reverse: false`: output deep-equal to current for UkingPar,
   VintageLed, ShehdsBar, strands (no behavior change on the NORMAL path).
3. Wall 1→Bar Left: NORMAL reproduces the reversed-X order (identity block copy asserted);
   REVERSED aligns it (dest block k ← source block R(k) per the ShehdsBar definition, per-channel
   assertion). Same for Wall 2→Bar Right.
4. Vintage six-head non-contiguous permute: value 3..8 ↔ 8..3 head-wise; rgb triplets swap head
   order with r→r/g→g/b→b inside; controls 1,2,9-15 identity.
5. LED equal-count: whole stride blocks swapped end-for-end, in-block byte order preserved.
6. 40px→20px: first-20 window THEN reverse; explicit counterexample assertion that the slice set
   differs from a last-20 mapping.
7. Pars untouchable: `reverseApplicable=false` in the payload; `reverse:true` refused at ARM;
   Mechanism A toggle absent on single-pixel rows and its hand-authored entry throws at export.
8. w/a bytes never swapped: role-for-role mapping asserted on RGBWAU blocks in both mechanisms;
   no intra-pixel permutation anywhere.
9. No-double-apply (§4 rows 5-8): mirrored bytes invariant under the bench scene's `pixelOrder`;
   resolver source contains no reference to the pixel-order store.
10. Persistence: ARM writes atomically; fresh-process re-read prefills the picker; stale source →
    loud stale row, nothing silently applied; `selections` keyed per source scene — a `titanic`
    entry never surfaces under any other engine scene.
11. Mechanism A lifecycle: grow preserves, shrink clears + warns (casualty-hook test), rename
    carries, Swap leaves flags name-stuck and the dialog names flagged members;
    `pixelOrder` round-trips POST `/save`.
12. Existing suites stay green by FAILING-LIST comparison, not totals: channel fidelity,
    arm/disarm/blackout/one-writer, scene/model parity; sim baseline 2007/2000/6+1todo; engine
    ~2796 with the 7 known environmental fails — any new name in a failing list is a regression
    even if the totals match.

### 5.5 Non-negotiables carried from the codebase rules

No fallback behaviors; every refusal named with the offending path/value; all imports top-of-file;
snake_case new filenames; temp files under `~/tmp`; security check before any commit; no dotted
IPs or future dates in any `.agent/**` prose the slices produce; the operator's uncommitted residue
(patterns 66-73, manifest, calibration playlists, generated models, studiodj scene files,
`marsin_engine/states/**`) stays untouched.
