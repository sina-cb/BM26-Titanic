# 2026-07-29 — Generator editor UX: select freeze, cold move, name parity, rename hygiene — profiled + planned (bm_readiness `_44`)

Planner/investigator session (Fable). Four operator issues on the generator
editor, investigated read-only (scenes/** and models/** are operator-owned and
were **not modified**; profiling ran as a browser client of the live :6969
only, triple-save-guarded, fresh browser, closed after). Plan is for Opus
implementers; **no plan step edits scene or model files** — the only steps that
can ever touch scene-owned data (step 17) are operator-gated, operator-triggered
runtime features that persist only through his own save, exactly like every
existing editor control.

---

## 0. TL;DR — root cause per issue

1. **Select freeze** = `main.js:240` wires `onTransformChange` to
   TransformControls' **`change`** event, which fires on *attach* (and gizmo
   hover), not just real transforms — so clicking a generator runs a **full
   `generateGroupFromTrace`** → `rebuildParLights` (all 82 fixtures destroyed
   + recreated) → shader recompiles. Measured on the RTX 4090: **one 2,719 ms
   rAF stall per select-click**, CPU profile dominated by `getProgramParameter`
   (synchronous shader-compile checks). GUI-card select (no attach): 83–100 ms.
2. **Laggy drag** = `_onTraceTransformChange` ends in
   `if (trace.generated) generateGroupFromTrace(tIdx, true)`
   (gui_builder.js:3596-3598) **on every pointermove tick** — sweep + aim math
   + reprojection + `rebuildParLights(true)` + `renderParGUI()` DOM rebuild +
   batch-cache invalidation, then the next frame re-creates the InstancedMesh
   and recompiles programs. Measured: tick JS ~24 ms, but **~2.4 s frame stall
   per tick**; paced drag = **0.4 FPS**. The preview-dot drag has the same
   per-tick regenerate (:3694). Fix = cold move (defer regenerate to release);
   the release-time regenerate keeps the LED move-trail fix intact.
3. **Names vs chain indexing** = mostly already right: after `_42`, emission
   order == array order == chain number everywhere that lists fixtures. Real
   gaps: a **lexicographic sort in the 2D pixel-map lanes seeding** ("Group 10"
   before "Group 2", pixel_map_layout.js:418-430), **no fixture name anywhere
   in the 3D viewport** (chain-viz labels are bare numbers), chain chips never
   reorder (by design — needs an operator-gated affordance), and the renumber
   confirm undersells what is sticky-by-name (fixtureId/sectionId + 2D anchors
   move too).
4. **Rename hygiene** = the mapped case is broken today: a group rename makes
   `generateGroupFromTrace`'s casualty set equal to **all N fixtures** (old and
   new name sets are disjoint, gui_builder.js:4014-4019) → every chain entry is
   **spliced out of the registry** via `unmapFixture` with a misleading
   "channels freed" toast. The correct primitive
   `renameFixtureInChains` (controller_registry.js:1093) **exists and is dead
   code** whose own comment demands this wiring. The operator's clean
   "Right SmokeStacks" rename was the lucky case — titanic's registry is
   `controllers: []`, so there was nothing to lose. Hand-set addresses on
   unmapped scenes are lost the same way via the name-keyed
   `__globalPatchTree` (main.js:575-584), whose old-name keys then linger as
   phantoms. Plus: half-applied rename when chainSplits are invalid, no
   duplicate-name guard on individual renames, and his rename just silently
   dropped the right chimney ring from the default Top-Down 2D view
   (`pixel_map_view_defaults.js:24-27` still names
   'Right Top Chimney Generator').
   **OPERATOR RULING (2026-07-29, during this session): rename → CHECK the
   mapping and INVALIDATE it too, loudly.** Default is check + invalidate with
   a fixture-by-fixture report, entries left honestly unmapped for deliberate
   re-mapping — never a silent carry-over to new names, never lingering
   old-name phantoms. Today's behavior is *accidentally* close (everything
   gets unmapped) but silent and incomplete — the plan makes it deliberate:
   accurate loud report instead of the "channels freed" toast, patch-tree
   phantoms pruned, validator shows the fixtures as *unmapped*, not drifted.
   The dead `renameFixtureInChains` becomes the machinery for an **opt-in**
   "migrate addresses to new name" affordance only (operator-gated).

**Current parity/suite state (post his saves):** sim suite **805 / 803 pass /
2 fail** — the third pre-existing fail (stale `models/titanic.js`) **CLEARED**
with his titanic save (model 979 px == scene-implied 979; parity CLI: titanic
coverage/patch-truth/views/drift spotless, 90 errors all known Phase-B
unmapped fixtures/strands — was 92, the chimney 10→8 edit removed 2). The 2
test_bench `drift/metadata_drift` fails (TE Sign V3 A/B, model sId 7/fId 13,14
vs patches.yaml 5/11,12) **remain** — the queued ONE test_bench sim-save is
still owed.

---

## 1. Profiling evidence (issue 1 + 2)

Probe: `~/tmp/gen_ux_profile/profile_probe.cjs` (throwaway; results in
`results.json`, screenshot `01_select3d.png`). Browser client of the
operator's live :6969, titanic scene, `profile=full&renderer=webgl`. Triple
save-guard (autoSave=false → debounceAutoSave no-ops at gui_builder.js:539;
window stub counted 0 calls; ALL :6970 requests aborted at the network layer —
0 were even attempted). Pristine params clone restored; browser closed.
**Adapter: `ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Laptop GPU … D3D11)`,
`integrated: false`** — valid measurement per `_39` ops rule. Scene census:
82 parLights, 12 traces, 212 interactiveObjects, chain viz on.

| Test | Result |
|---|---|
| **Select, real 3D click** on 'Right SmokeStacks' hitbox | selection landed (card highlighted, transformControl attached); rAF gaps **167 ms + 2,719 ms**; exactly **1 regenerate** ran (`controllerMappingFixturesRemoved` ×1, invalidation `fixtures rebuilt` ×1); CPU top: `getProgramParameter` 1,153 + 874 ms, `(program)` 188 ms |
| **Select, GUI card click** (no attach) | gaps 83 + 100 ms, **0 invalidations, 0 regenerates** — confirms the freeze is the attach path |
| **Drag tick** (real handler, circle hitbox ×10) | tick JS median **24.5 ms** (max 31.5), but **11 frame stalls of ~2.4–2.9 s each**; 11× `fixtures rebuilt`; CPU top `getProgramParameter` 10.6 s + 9.8 s, GC 0.9 s |
| **Drag tick** (line start-handle ×10) | same shape: median 23.7 ms JS, ~2.4–3.2 s frame stalls |
| **Paced drag** (1 tick/rAF, 2 s) | **0.4 FPS** achieved |
| **Isolated batch-cache invalidate** (979 px) | two-frame time 30–43 ms baseline → 54–63 ms with rebuild ⇒ **~+20-25 ms** per `_rebuildBatchCache` (generatePixelMap + new InstancedMesh + PatchManager.recompute — recompute itself measured 0.1–0.2 ms) |

Where the ~seconds go: `rebuildParLights(true)` destroys and re-creates every
fixture's meshes/materials; the three.js TN backend then recompiles programs
for the new materials and **checks compile status synchronously**
(`getProgramParameter`) on the next render frame. The regenerate JS itself is
cheap (~24 ms). So the freeze/lag is not the math — it is the *rebuild storm*
the math triggers.

**Why select regenerates at all:** vendored
`TransformControls.js:115-124` dispatches `change` from the property-setter of
EVERY tracked property — `attach()` sets `object`, hover sets `axis` — while
`objectChange` (:721, :794) fires only on real transforms. `main.js:240`
listens to `change`. `interaction.js:239-242` then routes `isTrace` objects to
`_onTraceTransformChange` → tail regenerate at :3596-3598. Empirically proven:
1 click = 1 regenerate. (Gizmo-hover regenerates are the same mechanism — the
editor feels sluggish the whole time a generator is attached.)

Note: my 2.7 s vs the operator's "~1 s" — same mechanism, different shader-
cache warmth/scene state; both are the identical code path with the identical
signature (single regenerate + recompile storm on click).

## 2. Issue 3 findings — what renumbering renames vs where names appear

`emitInChainOrder` (generator_chain_order.js:228-253) stamps
`name = "<group> <j+1>"` in chain order and gui_builder.js:4005-4007 pushes in
that order ⇒ **array order == chain order** immediately after every
regenerate. Fixture drawer lists in array order (gui_builder.js:1484-1592);
Unmapped tray preserves config order (controller_registry.js:644-651); model
export + patches.yaml records follow array order; THREE objects rebuild by
array index (and carry no `.name` — identity is `userData.fixture`). Chain
`{fixture, at}` entries are deliberately untouched — sticky-by-name (docs/33
decision 19) is exactly what makes `_42`'s retroactive reland work
(projectOntoConfigs by `configsByName`, controller_registry.js:1738-1785;
patches.yaml is a derived, name-keyed artifact rebuilt on every save,
save-server.js:205-245; sectionId/fixtureId also sticky —
controller_registry.js:1862-1874).

Genuine gaps (full detail in the investigation digest, §6 plan steps 14-18):
- **D1 (real bug):** pixel-map `lanes` seeding sorts `localeCompare` without
  numeric ⇒ "Group 10" < "Group 2" (pixel_map_layout.js:418-430).
- **No name in 3D**: no hover tooltip / label exists anywhere in the viewport;
  chain-viz sprites show a bare number (gui_builder.js:3142-3151) — ambiguous
  with overlapping generators.
- **Chain chips** (Controllers panel) render `port.chain` insertion order,
  never re-derived (controller_map_editor.js:1454-1560,
  controller_registry.js:1458) — "cable documentation" by design; no sort
  affordance exists, and the deferred `_42` §6(a) numeric bulk-add is the
  prospective half.
- **Confirm dialog** (gui_builder.js:4461-4473) names only DMX addresses as
  sticky; fixtureId/sectionId and saved 2D pixel-map anchors
  (pixel_map_views.js:455-467) are sticky-by-name too and move with a
  renumber.
- Transient: overlay updates on stepper `onChange` while fixtures rename only
  on `onFinishChange` — acceptable, documented.

## 3. Issue 4 findings — rename paths and where stale/lost state comes from

Confirmed by code (and cross-checked against the live "Right SmokeStacks"
rename):

1. **Mapped group rename silently unmaps everything.** Rename handler
   (gui_builder.js:4229-4265) regenerates with `previousGroupName`; the sweep
   correctly removes old-named fixtures (no orphan fixtures — report
   20260724_37 fix), but the casualty set `previousGenerated \ survivingNames`
   is ALL N on a rename (disjoint name sets, :4014-4016) →
   `controllerMappingFixturesRemoved` → `unmapFixture` splices every
   `{fixture:'Old N', at}` chain entry (controller_registry.js:1076-1079) →
   reprojection returns `''/0/0`. Toast says "channels freed".
   **`renameFixtureInChains` (controller_registry.js:1093-1118) is the shipped
   fix, dead — zero production callers** (its own comment: wire it before
   adding a rename control).
2. **Unmapped scenes lose hand-set addresses the same way** — regenerated
   records carry no patch fields; restore is via the name-keyed
   `__globalPatchTree` (main.js:575-584, fixtures.js:140-144); renamed keys
   miss; old keys linger unpruned in memory. The operator's clean result was
   this path with all-zero values — indistinguishable from a correct
   migration. **patches.yaml can never hold orphans** (rebuilt from live
   arrays every save) — its cleanliness is *not* evidence of a correct rename.
3. **Half-applied rename on invalid chainSplits:** name/override/view-bit
   mutations at :4250-4258 happen BEFORE `generateGroupFromTrace`'s splits
   gate (:3771-3787) can refuse ⇒ old-named fixtures stranded with no group
   master/lock/view bit; `reconcileGroupBits` later deletes the new-name bit
   and re-mints one for the old ⇒ `MASK_*` drift.
4. **Individual fixture rename is unplumbed** (gui_builder.js:1613, 2067,
   4952, strand 5655): no chain/patch migration, no duplicate-name guard
   (duplicate names collapse to one patches.yaml record, save-server.js:210,
   and a doubly-mapped pair hard-fails scene load), and
   `propagateToSelected(index,'name',v)` (:2069) stamps the SAME name onto
   every selected fixture. Renaming a generated fixture is futile anyway (next
   regenerate overwrites it).
5. **Par-group ✏ Rename** (:1862-1887) migrates overrides + view bits but
   misses `invalidateMarsinBatchCache` (LED path has it, :5581 — batch entries
   cache `entry.group`, view isolation reads it, animate.js:580) and never
   touches pixel-map selectors.
6. **Live orphan from his own rename:** `pixel_map_view_defaults.js:24-27`
   still lists 'Right Top Chimney Generator' — the right ring silently dropped
   out of the default Top-Down 2D view. No warning renders for a selector that
   matches nothing.
7. `interactiveObjects` are clean on rename/regenerate (fixtures.js:32-41 +
   per-class destroy splices) — no stale raycast targets; not a bug here.

**Rename policy (operator ruling, 2026-07-29):** rename → **check + invalidate
the mapping, loudly**. Every patch/address/metadata entry tied to the old
names is enumerated and invalidated with one line per fixture (what was freed:
controller, universe, address); the renamed fixtures come out honestly
UNMAPPED (parity validator: `unmapped_fixture`, never `drift`); nothing
carries over silently and no old-name phantom survives anywhere (registry
chains, `__globalPatchTree`, patches.yaml derivation). Group-visual state that
is NOT mapping (group master override, lock, view bit — gui_builder.js:
4255-4257) continues to follow the rename as today. Where migration would
clearly serve (his 'Right SmokeStacks' case with a mapped 90-light group), the
plan offers an **explicit opt-in** "migrate addresses to new name" affordance
built on `renameFixtureInChains` — operator-gated, never the default.

## 4. The plan — numbered steps in three Opus slices

Ordering: **Slice 1 ∥ Slice 3** (disjoint files), **Slice 2 after Slice 1**
(both edit main.js + gui_builder.js in different regions — serialize the
shared files rather than merge-risk a 5,900-line file). No step writes
scenes/** or models/**; harnesses are triple-save-guarded browser clients of
:6969 (ports 6966-6972/5568 untouched, no restarts).

### Slice 1 — select freeze + cold move (owns: `simulation/main.js`, `simulation/src/core/interaction.js`, `simulation/src/gui/gui_builder.js` trace-transform/drag/dot-drag + strand-handler regions, one new pure module, `simulation/agent_tools/generator_ux_verify.cjs`, its tests)

1. **Rewire main.js:240 `"change"` → `"objectChange"`** for
   `onTransformChange`. Audit every behavior that rode `change`
   (attach/hover/axis): none may mutate state — the continuous rAF loop
   already renders; add a render-only `change` listener ONLY if a static-frame
   need is found (justify it in the report if so). Acceptance: a select-click
   produces **0** `invalidateMarsinBatchCache` calls, **0**
   `controllerMappingFixturesRemoved` calls (probe-verified numbers today:
   1 + 1, with a 2.7 s stall).
2. **Cold move for generator transforms.** `_onTraceTransformChange`
   (gui_builder.js:3336-3598): keep every lightweight per-tick update (trace
   fields, handles, polyline/dots rebuild, aim line, chain-viz reparent — all
   already in-place per `_43`), but while `transformControl.dragging` is true
   replace the tail regenerate (:3596-3598) with dirty-marking (extract a
   small pure scheduler module — e.g. `src/dmx/trace_regen_scheduler.js` —
   markDirty(traceIndex)/takePending() so it is unit-testable). When invoked
   outside a drag (undo, programmatic), regenerate immediately as today.
3. **Release seam.** In the existing `dragging-changed` listener
   (main.js:205-239), on `event.value === false`: if a pending trace regen
   exists → `generateGroupFromTrace(tIdx, true)` **once** + `debounceAutoSave`.
   Undo already snapshots at drag start (:208) — release regenerate is inside
   the same undo step.
4. **Preview-dot drags get the same deferral**: drop the per-tick regenerate
   in `_updateTraceDotDrag` (:3694; keep `refreshTraceDots` — that IS the
   lightweight feedback), add the single regenerate to `_endTraceDotDrag`
   (:3698-3702) before its `debounceAutoSave`.
5. **Strand cold-move — same seam, trail fix preserved.**
   `_onStrandTransformChange` (:5123-5139) keeps `writeTransformToConfig` +
   `rebuildVisuals` per tick (the strand's own meshes track the cursor);
   defer `invalidateMarsinBatchCache('strand_transform')` + `debounceAutoSave`
   to release. THE CONTRACT: **release always invalidates** — the `_2` LED
   move-trail bug was *persistent* stale batch coords after the drag; transient
   in-drag lag of the global dot overlay is the requested cold-move semantic.
   Document the visible in-drag divergence and screenshot it for the operator.
6. **Trail-regression test (mandatory):** harness drags a strand handle and a
   generator (direct handler invocation), releases, then asserts the batch
   render list coordinates equal the post-release config coordinates — the
   `_2` bug can never come back silently.
7. **Timing verification harness** `agent_tools/generator_ux_verify.cjs`
   (adapt `~/tmp/gen_ux_profile/profile_probe.cjs`; triple save-guard, fresh
   browser, record `window.__gpuAdapter`, close after; screenshots to
   `~/tmp/generator_ux/`). **Before/after TIMINGS required, not pictures:**
   select max rAF gap 2,719 ms → **< 150 ms** and 0 regenerates; paced drag
   0.4 FPS → **within ~20 % of idle FPS** on the same adapter; release fires
   exactly 1 regenerate + 1 `fixtures rebuilt` invalidation; per-tick handler
   median documented. Unit tests for the scheduler module (one flush per
   release; no flush for non-generated traces; boot-safe).

### Slice 2 — rename hygiene (owns: gui_builder.js rename regions :1613/:2067/:4952/:5655/:4229-4265/:1862-1887, main.js `__globalPatchTree` region ~:575, a group-rename helper in `simulation/src/dmx/controller_registry.js`, pixel-map selector migration, `agent_tools/trace_rename_verify.cjs` extension, tests) — **starts after Slice 1 lands**

8. **Gate before mutation:** in the trace rename handler (:4229), check
   `chainSplitsError` FIRST; invalid → alert + revert the name edit with
   **zero** mutations (kills the half-applied rename: stranded old group,
   phantom view bit, `MASK_*` drift).
9. **Deliberate check + invalidate on group rename (operator ruling — the
   DEFAULT):** before the regenerate at :4262, ENUMERATE the mapping under the
   old names (`"<old> n"` chain entries via the registry + `__globalPatchTree`
   keys + derived patch fields), then invalidate it **loudly**: one console
   line per fixture naming what was freed (fixture, controller IP, universe,
   address), and replace the misleading "channels freed" toast with an
   accurate summary ("Rename invalidated the mapping of N fixtures — they are
   now UNMAPPED; re-map deliberately in the Controllers panel"). The
   `unmapFixture` splice becomes the *intended* mechanism instead of an
   accident — the acceptance test is that the parity validator afterwards
   reports exactly those fixtures as `address_hygiene/unmapped_fixture` and
   ZERO `drift` findings. Nothing may carry over to the new names silently.
10. **Prune `__globalPatchTree` phantoms on the same rename** (helper near
    main.js:575): DELETE the old-name keys with one loud line each — old-name
    patch entries must not linger as phantoms (they survive forever today).
    Do NOT copy values to the new names (that would be the silent carry-over
    the ruling bans). Name-keyed custom-view `viewMask` assignments: view
    membership is display state, not mapping — carry it with the rename like
    the group override/view bit (:4255-4257) and say so in one log line.
11. **Individual fixture renames get the same policy:** generated-fixture
    rename (:1613) → **refuse with alert** (it breaks the `<group> N` contract
    every sticky store keys on, and the next regenerate overwrites it —
    reverting later would be a silent fallback). Hand-placed / DMX-scene /
    strand renames (:2067/:4952/:5655) → check mapping under the old name and
    invalidate it loudly (chain entry + patch-tree key + derived fields; one
    named line), leaving the fixture honestly unmapped — plus a
    **duplicate-name guard** (alert + revert; today duplicates collapse to one
    patches.yaml record and a doubly-mapped pair hard-fails load). Remove
    `'name'` from `propagateToSelected` (:2069) — multi-select rename
    mass-duplicates names today. Verify the strand path live (finding 4b was
    traced, not executed).
11b. **OPT-IN migrate affordance (operator-gated, §5 Q4):** an explicit
    "⇄ Migrate addresses to new name" choice on the rename confirm (or a
    button shown with the invalidation summary) that wires the dead
    `renameFixtureInChains` (controller_registry.js:1093-1118) for n=1..count
    + re-keys the patch tree — for the pure-cosmetic-rename-of-a-mapped-group
    case where re-mapping 90 lights by hand serves nobody. Loud per-entry
    migrate lines; DEFAULT remains check + invalidate.
12. **Par-group ✏ Rename parity** (:1862-1887): add
    `invalidateMarsinBatchCache('par_group_rename')` (mirrors LED :5581; view
    isolation reads the cached `entry.group`, animate.js:580); migrate
    pixel-map view selectors (name/group globs, pixel_map_views store) on
    group renames; render a **loud per-panel warning when a selector matches
    zero clusters** (today: silent empty pane). Fix the
    `pixel_map_view_defaults.js:24-27` orphan with the operator's input
    (§5 Q2) — no silent auto-repair.
13. **Tests:** invalidation units (mapped group rename → every old-name chain
    entry removed, NO new-name entry minted, patch-tree old keys pruned, one
    loud line per fixture — assert the log contract, not just the state);
    duplicate-guard units; opt-in migrate units (entry follows, address
    byte-identical) kept separate so the default path can never silently take
    the migrate branch. Extend `trace_rename_verify.cjs` with the MAPPED case
    — synthetic in-memory registry in-page (never saved), rename, assert all
    old entries invalidated + accurate summary toast + validator-style
    reprojection yields unmapped (not drifted) + zero save requests.
    Screenshots: generator card + Controllers panel chips + the invalidation
    summary before/after a mapped rename.

### Slice 3 — name/index parity surfaces (owns: `simulation/src/gui/pixel_map/pixel_map_layout.js`, `src/dmx/chain_order_visual.js` + its one-line gui_builder.js call site :3142-3151 [apply last], `controller_map_editor.js` texts, tests) — **parallel with Slice 1**

14. **Natural numeric sort** in lanes seeding (pixel_map_layout.js:418-430):
    `localeCompare(..., undefined, { numeric: true })` — kills
    "Group 10 before Group 2" (the only genuine order bug found). Unit test
    with a ≥10-light group.
15. **Chain-viz label disambiguation:** label carries group context
    ("<Group> N" text, or number + a per-generator legend) with the `_43` perf
    contract intact (shared cached textures keyed by full label string; still
    exactly 0 objects when off). Add one test asserting label numbers ==
    the `<group> N` suffixes a regenerate emits (both already derive from
    `expandChainOrder` — pin the equality across the module seam).
16. **Renumber-confirm completeness** (gui_builder.js:4461-4473): the dialog
    must also state that engine-model ids (sectionId/fixtureId) and saved 2D
    pixel-map anchors are sticky-by-name and move with the number.
17. **OPERATOR-GATED options (build only on his yes, §5 Q3):**
    (a) "Sort chain into fixture-number order" button per controller port —
    rewrites `port.chain` ORDER only (cable documentation; addresses/`at`
    untouched), persists only via his save; (b) the deferred `_42` §6(a)
    "+ gen (numeric order)" bulk-add — touches the 2026-06-11 "no group-level
    add" ruling. These are the ONLY steps in this plan that would write
    scene-owned data, both operator-triggered runtime features.
18. **Name-in-3D (smallest honest version):** selected fixture's name in an
    existing HUD element (info line), NOT per-fixture hover raycasts. The
    operator's "hitbox tooltips" surface does not exist today — nothing in the
    viewport shows a fixture name; propose + screenshot, let him size up.

### Suite bar + verification (all slices)

- Sim suite baseline **805 / 803 / 2** — the 2 fails are the pre-existing
  test_bench `metadata_drift` pair, cleared only by the operator's queued ONE
  test_bench sim-save. Each slice: **zero new failures**, new tests added on
  top of 805. Engine suite untouched (2373 / known-8).
- `node simulation/tools/scene_model_parity.cjs test_bench|titanic` verdicts
  **byte-unchanged** after every slice (nothing writes scenes/models).
- Visual verification per see_the_world: fresh browser, `--viewport 1280x720`
  under SwiftShader, **record `window.__gpuAdapter` next to every timing**,
  close probes, inspect PNGs. Slice 1 = before/after timings (the numbers in
  §1 are the "before"); Slice 2 = mapped-rename screenshots; Slice 3 =
  lanes-order + label screenshots.
- Every scenes/** mtime unchanged after each slice's harness run (the `_42`
  harness pattern) — this is the "don't mess up his scenes" gate in
  executable form.

## 5. Operator items (blocking or ratification)

1. **Cold-move UX semantics** (steps 2-5): during a drag, generated fixtures
   and the global dot overlay intentionally freeze; only the trace
   line/handles/dots/chain-viz track the cursor (strand bulbs still track, the
   dot overlay lags until release). This is his ask, restated — flag any
   surprise at the first screenshot.
2. **Default Top-Down 2D view lost his right chimney ring** when he renamed
   to 'Right SmokeStacks' (`pixel_map_view_defaults.js` hardcodes the old
   name). Wants it re-pointed at the new name, or defaults derived from live
   groups? (Step 12 implements whichever.)
3. **Gates for step 17**: chain-sort-by-number button (writes chain ORDER on
   his save) and the numeric-order bulk-add (2026-06-11 ruling).
4. **Gate for step 11b**: the explicit opt-in "⇄ Migrate addresses to new
   name" affordance (his ruling sets check + invalidate as the default; this
   is the escape hatch for a cosmetic rename of a fully-mapped group — say yes
   /no to building it at all). Also ratify step 11's refusal: individually
   renaming a *generated* fixture becomes a loud refusal instead of a
   silently-doomed edit.
5. Still owed (unchanged): **ONE sim-save on test_bench** clears the last 2
   suite fails (`_34` repair completion).

## 6. Honesty notes

- Drag timings were measured by invoking the real tick handler directly (10×,
  rAF-paced) rather than synthetic gizmo-pointer drags — same code path as a
  real drag minus TransformControls' own pointer math (which the 24 ms tick
  and 2.4 s frame stalls dwarf). Select was a REAL synthetic mouse click.
- My freeze is 2.7 s vs his "~1 s" — same signature (single spurious
  regenerate + recompile storm), different shader-cache warmth; the fix
  removes the mechanism, so the delta doesn't matter.
- The `renderParGUI`/`rebuildParLights` wrappers under-reported (closure-local
  calls bypass window globals) — attribution rests on the CPU profile +
  invalidation reasons, which are conclusive.
- Rename findings 1-3 verified against the code directly; strand-rename (4b)
  is traced-not-executed — slice 2 confirms live.
- Notion cards for follow-ups not filed — no Notion MCP tools in this session
  (same gap as `_43`); the `_42` §6 cards are still unfiled too.

## 7. Artifacts

`~/tmp/gen_ux_profile/` — `profile_probe.cjs`, `results.json`,
`01_select3d.png` (throwaway probe, per ~/tmp rule). Investigation digests
(naming coverage + rename paths) are folded into §2-§3 above.
