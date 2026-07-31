# 20260725_43 — Chain-order visualization in the 3D sim

**Author:** implementer (Opus) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-29
**Implements:** the operator's ask — *see* the DMX daisy chain in the 3D view —
which is `20260725_42` §6 deferred item **(b) chain-number sprite labels**,
scoped up to the full chain (runs + direction + jumps + numbers).
**Composes with:** `_41` (design of `chainSplits`), `_42` (implementation),
`_38`/`_39` (sim perf + GPU-adapter ops rules).

---

## 0. TL;DR

With **Show Generators** on, every visible trace now draws its **cable**, not
just its path: one coloured polyline per split walking the fixtures in
daisy-chain order, a comet ramp plus an arrowhead on every step for direction,
a dashed grey hop where the cable jumps between runs, and the **post-renumber
chain number** floating over each light. The operator's Left Front Wall
Generator (`4→5, 3→2, 1`) reads as three runs at a glance.

- **Pure plan module** `simulation/src/dmx/chain_order_visual.js` on top of
  `_42`'s `generator_chain_order.js` — geometry-free, so the whole ordering
  story is unit-testable in Node. **26 new tests.**
- **Sim suite 779 → 805 tests, 802 pass, 3 fail** — the same **3 pre-existing**
  failures as the baseline I measured before touching anything. **Zero new
  failures.** (Baseline is **3**, not the 2 named in my brief — see §6.)
- **Perf: built on show, disposed on hide.** Scene census on titanic:
  **1,487 objects with the overlay off → 1,577 with it on** (+90 for 12 traces
  / 66 fixtures). Hidden generators, or the overlay's own toggle off, cost
  **exactly zero objects** — not "invisible objects still paying traversal",
  which is the pattern `_38` found and the brief told me not to worsen.
- **Live-verified** on the operator's `:6969` as a browser client only,
  **10/10 checks green**, 0 save requests, pristine restore, every
  `scenes/**` file still at its pre-session mtime. Screenshots inspected.

---

## 1. What the operator sees, and when

| Control | Where | Effect |
|---|---|---|
| **Show Generators** | `📐 Group Generator` (and the DMX Fixtures copy — one param, both `listen()`) | Off → the whole trace editor disappears, chain overlay **disposed** with it |
| **⛓ Show Chain Order** | `📐 Group Generator`, directly under Show Generators | New. On by default. Off → the chain overlay alone is **disposed**; dots, path, handles and aim line stay exactly as they were |

While visible, per trace:

- **One colour per split** — cyan, magenta, violet, mint, rose, ice, cycling.
  Picked to avoid every colour the trace editor already speaks (orange path,
  yellow selection + aim, green start handle, red end handle, and the
  blue→green→red spacing gradient on the dots), so a run is never mistaken for
  a handle. A test pins that non-collision.
- **Direction, said twice.** A comet ramp dims each run at its first light and
  brightens it to full at its last, and an arrowhead sits on every cable step.
  Two cues because either one alone fails at some viewing angle: an arrowhead
  foreshortens to a dot head-on, and a ramp is ambiguous on a 2-light run.
- **Dashed grey jumps** between runs. Without them three colours read as three
  separate cables; the jumps are what make it one. Their endpoints are always
  consecutive fixture numbers (pinned by test).
- **The chain number** over each light — the number the fixture will actually
  carry after renumbering, tinted to its run.

**Live update.** Every splits path funnels through the card's
`refreshChainStatus()`, which is called by the From/To steppers (on each tick,
not just on release), `+ Add split`, `− Remove last`, `⇄ Swap start/end` and
`applySplitsChange` — so one hook there keeps the overlay in lockstep with the
card. Geometry edits are covered separately (§3).

**Invalid splits draw nothing.** Not a partial chain, not a path-order stand-in.
The generator refuses to build those splits and the card already carries the red
`⚠ CHAIN SPLITS INVALID` badge; drawing a plausible chain that will never be
generated would be a lie in exactly the shape the codex forbids.

---

## 2. The split: pure plan vs. geometry

`chain_order_visual.js` emits **1-based path positions and colours** and never
touches a Vector3, a scene, or a fixture. `gui_builder.js` looks up the points
it already computes for the preview dots and draws them. That is what let me
unit-test the polyline point sequence — the brief's explicit ask — without a
browser.

| Export | Answers |
|---|---|
| `buildChainRuns(splits, count)` | one run per split: `pathPositions` in cable order, the `numbers` that land on them, `reversed`, `colorHex` |
| `chainJumpSegments(runs)` | the hops between runs, by path position AND by fixture number |
| `chainLabelPlan(splits, count)` | one label per fixture: number, path position, colour, run-boundary flags |
| `cometMix(stepIndex, stepCount)` | the direction ramp, `COMET_MIN_MIX`→1 |
| `chainRunColor` / `CHAIN_RUN_COLORS` / `CHAIN_JUMP_COLOR` | the palette |

Every entry point re-checks `chainSplitsError` and **throws** on invalid input;
absent splits are the identity chain (one run, `1..count`), matching
`expandChainOrder`'s contract. A test asserts the concatenated run positions are
**exactly `expandChainOrder`** — one source of truth for the ordering, two views
of it.

---

## 3. The perf contract, and how it is enforced

`.agent/memory/sim_perf_per_object_explosion.md`: object COUNT is what kills
this sim. `_38`: trace visuals sit in the scene invisible and still cost
traversal. So:

- **Build on show / dispose on hide.** `setTraceObjectsVisibility()` — the same
  affordance every other trace visual gates on — ends by calling
  `refreshAllChainOrderViz()`, which disposes and (only if the group is
  actually visible and the toggle is on) rebuilds. There is no `visible = false`
  state for the overlay; it either exists or it does not.
- **Nothing per-pixel.** Per visible trace: **1** `LineSegments` for ALL runs
  (vertex-coloured, so the runs and the comet cost one object between them),
  **1** dashed `LineSegments` only when there is more than one run, **1**
  `InstancedMesh` holding *every* arrowhead (count−1 instances, per-instance
  colour), and one label `Sprite` per fixture.
- **No per-frame allocations.** Dragging a light, a handle or a corner moves the
  overlay through `syncChainOrderVizPositions()`, which rewrites the existing
  buffers and instance matrices in place through hoisted scratch vectors, and
  `reparentChainOrderViz()`, which re-parents the existing objects when a drag
  handler throws away and rebuilds the trace's group. A full rebuild happens
  only when the topology key or the fixture count actually changes.
- **Label textures and materials are cached forever and shared** across every
  trace and every rebuild (keyed by number, and by number+colour), so a splits
  drag mints no canvases at all. Bounded by numbers-seen × palette size.

**Measured** (scene census walking the whole graph for `userData.isChainViz`,
so it cannot be fooled by this feature's own bookkeeping):

| titanic scene state | scene objects | chain objects |
|---|---|---|
| overlay ON (12 traces, 66 fixtures) | 1,577 | 90 = 12 `LineSegments` + 12 `InstancedMesh` + 66 `Sprite` |
| overlay OFF (toggle) | 1,487 | **0** |
| generators hidden | — | **0**, and `tObj.chainViz === null` |

No titanic trace carries `chainSplits` yet, so each is a single run and none has
a jump line; with the probe trace's three runs added the count went to 98,
consistent with the formula.

**Honest cost note:** 90 objects is a real ~6 % bump in scene-graph size while
the trace editor is open, and it is dominated by the 66 label sprites. That is
why the overlay has its own switch. It is zero in every state where the operator
is not looking at generators.

---

## 4. Live verification

`simulation/agent_tools/chain_order_viz_verify.cjs` (new; follows the
`generator_splits_verify.cjs` pattern verbatim). Browser client of `:6969` only
— the operator's stack was never restarted, and the probe browser was closed.

**Zero-scene-write guarantee, triple-guarded:** `params.autoSave = false`,
`window.debounceAutoSave` stubbed, every `:6970` request aborted at the network
layer. Confirmed after the run: **0 save requests were even attempted**,
`parLightsMatch: true, tracesMatch: true`, no probe group or trace left behind,
and `scenes/titanic/*.yaml` still at its pre-session mtime (2026-07-29 10:32,
earlier than every run).

**GPU adapter** (ops rule `_39`): `ANGLE (Google, Vulkan 1.3.0 (SwiftShader
Device (Subzero)), SwiftShader driver)`, `integrated: false,
detectionFailed: false` — software rendering, fine for a geometry/UI check.
**No FPS number is claimed anywhere in this report** (the capture shows `1 FPS`
in the HUD; that is SwiftShader, and it is not a measurement of anything).

Probe: a synthetic 5-light **line** from x=−10 to x=+10, so path positions 1..5
sit at known x coordinates and a mis-permutation is unmissable.

| Check | Result |
|---|---|
| `cost_zero_objects_when_overlay_off` | ✅ 1,577 → 1,487, delta exactly the 90 chain objects |
| `base_no_splits_is_one_run_numbered_along_the_path` | ✅ 1 run, 4 steps, 4 arrows, 0 jumps, 1 colour, labels 1..5 on positions 1..5 |
| `operator_case_three_runs_three_colours_two_jumps` | ✅ 2 run-steps + 2 jumps + 4 arrows; **3 distinct label colours**; numbers 1..5 land on path positions **4, 5, 3, 2, 1** = `_41` §4's table |
| `swap_flips_the_overlay_live` | ✅ one reversed run, labels walk p5→p1, topology key is the full-reverse split |
| `generators_hidden_disposes_the_overlay_entirely` | ✅ census 0, `chainViz` null |
| `generators_reshown_rebuilds_it` | ✅ back to 98 |
| `chain_toggle_is_independent_of_the_trace_visuals` | ✅ 0 chain objects, group still visible with its 6 visuals + 3 handles |
| `invalid_splits_draw_no_chain` | ✅ that trace's `chainViz` null; the other traces keep theirs |
| `restore_zero_residue` | ✅ |
| `no_unexpected_console_errors` | ✅ |

**Screenshots** (`~/tmp/chain_viz/`), all inspected by eye:

- `01_base_single_run.png` — no splits: one cyan run, numbers 1→5 along the
  path, arrows pointing down-chain, the comet ramp visibly dim at 1 and bright
  at 5.
- `02_operator_case_with_card.png` — the probe close-up beside the GUI.
- `03_operator_three_runs.png` — three-quarter view; also shows the other 11
  titanic generators wearing their own numbers, which is what the whole scene
  looks like with the overlay on (busy at full-ship zoom, legible at trace
  zoom — the argument for the toggle).
- `04_operator_front_on.png` — **the readable one.** Left to right along the
  path: `5` (violet), `4` (magenta), `3` (magenta), `1` (cyan), `2` (cyan),
  with the magenta arrow pointing backwards along 3→2 and the grey dashed jumps
  between runs. This is `_41` §4's table, drawn.
- `05_operator_top_down.png` — the same, straight down.
- `06_operator_controls.png` — the `⛓ Show Chain Order` switch in place.
- `07_swap_reversed_run.png` — after ⇄ Swap: one run numbered 5,4,3,2,1.
- `08_generators_hidden_no_chain.png` — generators off: no chain, no dots, no
  handles, nothing left behind.
- `09_chain_toggle_off_trace_intact.png` — overlay off, trace editor intact.
- `10_invalid_splits_no_chain_drawn.png` — invalid splits: no chain drawn.

---

## 5. Files

**New**

- `simulation/src/dmx/chain_order_visual.js` — the pure plan.
- `simulation/tests/chain_order_visual.test.js` — 26 tests.
- `simulation/agent_tools/chain_order_viz_verify.cjs` — live GUI proof.

**Changed**

- `simulation/src/gui/gui_builder.js` — the overlay block next to
  `buildTraceObject` (build / dispose / sync / re-parent + the label caches);
  `setTraceObjectsVisibility` and `destroyTraceObjects` now drive it; the three
  drag paths (`corner`, `line` endpoints, per-point) sync or re-parent it;
  `refreshChainStatus` on the trace card refreshes it; the
  `⛓ Show Chain Order` toggle in `📐 Group Generator`.

**Deliberately untouched:** `generator_chain_order.js` (reused, not modified),
`scene_model_parity.cjs`, the controller registry / panel / exporter, every
`scenes/**` YAML, every `marsin_engine/models/*`, CaptainPad.

`params.chainOrderVisible` is **runtime-only**, exactly like `focusOnSelect`:
`reconstructYAML` walks the scene's existing config tree, so a new param never
reaches a scene file. No scene gains a key from this feature.

---

## 6. Auto-checks (`ops/sim_auto_checks.md`) — and a baseline correction

- `git diff --check -- simulation` — **pass** (CRLF warnings only, pre-existing).
- `node --check` on every file I touched — **pass**.
- `cd simulation; npm run check` — **805 tests, 802 pass, 3 fail.**
- `node tools/scene_model_parity.cjs <scene>` — `test_bench` exit 1,
  `titanic` exit 1, `studiodj` exit 0: **identical to before my change**, as it
  must be, since I touched no scene and no model.
- Browser smoke — §4. GPU adapter recorded; **no FPS claimed.**

**The baseline is 3 failures, not 2.** My brief said "the 2 known test_bench
parity-drift fails". I measured the suite **before my first edit** and got
**779 tests / 776 pass / 3 fail**. The third is new since `_42` and is not mine:

> `real scene titanic: the model is fresh and complete, and 0% electrically mapped`

`models/titanic.js` carries **981** pixels while the scene now describes **977**,
with four orphans — `Left/Right Top Chimney Generator 9` and `… 10` — plus a
`patch_truth/strand_missing_unpatched_marker` on strand `Left_Front_Left`. That
is the signature of the operator's uncommitted titanic edits (both chimney
generators went from 10 lights to 8) with the model not yet re-exported. Like
the two `test_bench` `metadata_drift` failures, **it clears on an operator
sim-save**, and like them I left it alone. My delta is **+26 tests, +26 passes,
+0 failures**.

No git operations were performed.

---

## 7. Flagged, not fixed

- **`gui_builder.js` declares `destroyTraceObjects` twice** in the same scope
  (once around the `setTraceObjectsVisibility` block, once next to
  `rebuildTraceObjects`). Hoisting means the second silently wins and the first
  is dead code that still *looks* live — I wired the overlay's disposal into the
  live one and left the dead one alone rather than widen this change. Worth
  deleting on its own.
- **Discoverability:** `⛓ Show Chain Order` sits in `📐 Group Generator`, next
  to that folder's `Show Generators` copy. The operator's eye is often on the
  *other* `Show Generators` in the DMX Fixtures block (a scene-config-driven
  control). Both drive the same param, but the new toggle exists in one place
  only. If Sina wants it beside the other one, that is a one-line add.
- **Clutter at full-ship zoom** (see `03_…`): 66 numbers across the titanic
  scene is a lot when the camera is wide. Options if it bothers him: labels only
  on the selected trace, or a distance fade. Not built, because guessing at that
  preference is how a switch nobody asked for gets added.
- Still outstanding from `_42` §6 and untouched here: **(a)** the group-level
  `+ gen (numeric order)` bulk-add (needs Sina's yes against the 2026-06-11
  ruling), **(c)** the order-vs-addresses warning, **(d)** the remap tool, and
  the `§1.6` `chainSplits`-vs-`trace.splits` vocabulary reconciliation. No
  Notion MCP tools in this session either, so those cards are still unfiled.
- **The `_42` renumbering semantic remains unratified.** This overlay makes it
  *visible* — which is arguably the best thing that could happen to a pending
  decision — but it does not decide it. If Sina rejects chain-order numbering,
  the overlay survives the fallback design unchanged: it draws whatever
  `expandChainOrder` says.
