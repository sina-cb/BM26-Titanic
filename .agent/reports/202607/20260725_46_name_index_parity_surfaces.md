# 2026-07-29 — Name/index parity surfaces: 2D lane order, guide labels, renumber-confirm, chimney-ring restore (bm_readiness `_46`)

Slice 3 of the `_44` plan (`20260725_44_generator_ux_fixes_plan.md` §4), plus
the coordinator's decision on that plan's step 12. Opus implementer, run in
parallel with slice 1. **Zero writes to `scenes/**` or `models/**`** — every
live check was a triple-save-guarded browser client of the operator's already
running :6969; his stack was never restarted and ports 6966-6972 / 5568 were
never bound by me.

---

## 0. TL;DR

Four surfaces where a fixture's NAME and its chain INDEX disagreed after the
`_42` renumbering work:

1. **2D Pixel Map `lanes` rows sorted lexicographically** → "Group 10" landed
   between "Group 1" and "Group 2". FIXED with a natural (numeric-aware)
   comparison. This was the only genuine ordering bug the plan found.
2. **The renumber confirm dialog undersold what moves** → it named DMX
   addresses only, while `sectionId`/`fixtureId` and saved 2D pixel-map anchors
   are sticky-by-name too. FIXED — the dialog now lists all three.
3. **The default Top-Down 2D view had silently lost the operator's right
   chimney ring** when he renamed the group to 'Right SmokeStacks'. FIXED by
   re-pointing at the current name, plus a test that turns the next such
   rename into a named failure instead of an empty panel.
4. **Chain-viz guides carried a bare number** with no group context.
   **CANCELLED BY THE OPERATOR mid-session** — see §4. Built, measured,
   reverted; the guides ship index-only, as he asked.

Plus a text fix on the Controllers chain chips (§3.4) saying out loud that
chain order is cable documentation and is never re-derived.

**Suite: 829 tests / 821 pass / 8 fail — the SAME 8 failures as the baseline,
zero new** (baseline before my first edit: 805/797/8). Parity CLI verdicts
byte-unchanged: titanic `192 error / 0 warning / 9 info`, test_bench
`4 / 0 / 1`, identical before and after. All 77 `scenes/**` file mtimes
identical across every browser run.

---

## 1. Baseline correction — the plan's suite numbers are stale

`_44` records the bar as **805 / 803 / 2**. The real baseline when this slice
started was **805 / 797 / 8**. The extra 6 failures are the operator's own:
he saved the titanic scene at 13:46 local, renaming the group
'Left Front Wall Generator' → **'Left Front Wall'**, while
`marsin_engine/models/titanic.js` was last exported at 13:26. The model,
`views.yaml` groupBits and the viewmasks sidecar therefore all disagree with
the scene (`981 → 987` px in the sim's own banner).

All 8 are scene/model-reality tests, and **none of them imports any module
this slice touches**:

```
fixtures are docked beside the ship, not left inside the hull
the real titanic scene can accept the block today (no collisions)
view-bit headroom is REPORTED — titanic is close to the 31-bit ceiling
CLI: default emit against the real scenes exits 0 and reports parity=absent
CLI: --require-applied fails (exit 3) while Phase B has not applied the block
real scene test_bench: the model is a faithful export of the scene
real scene test_bench: every remaining error is a known open mapping defect
real scene titanic: the model is fresh and complete, and 0% electrically mapped
```

**They clear when Sina re-exports `models/titanic.js` and restarts the engine**
(plus the ONE test_bench sim-save still owed from `_34`). Slice 1 reached the
same conclusion independently.

---

## 2. Step 14 — natural sort in the 2D lanes seeding (the real bug)

`simulation/src/gui/pixel_map/pixel_map_layout.js` — `seedLanes`, the layout
whose entire purpose is to read fixtures in order, compared names with a plain
`localeCompare`:

```js
const g = (a.group || '').localeCompare(b.group || '');
return g !== 0 ? g : (a.fixKey || '').localeCompare(b.fixKey || '');
```

Every generated fixture is named `` `${groupName} ${n}` `` by
`emitInChainOrder`, so from ten lights up the rows stacked
**1, 10, 11, 12, 2, 3, …** — the lanes view presented an order no other
surface agreed with. Now:

```js
const NATURAL = (a, b) => (a || '').localeCompare(b || '', undefined, { numeric: true });
```

applied to the group key and the fixture key alike, so groups sort naturally
too ('Ring 2' before 'Ring 10') and a group is never interleaved with another.

**Tests** (`tests/pixel_map_layout_expansion.test.js`, 2 new): a 12-light
group stacks 1..12, and two groups differing only by number stay grouped and
in numeric order. The pre-existing lanes test is untouched and still passes.

**Live**: the titanic scene's largest group is 8 lights, so the bug is not
reproducible on it today — the probe adds a synthetic 12-light group. Through
the REAL panel, on the real data plane, the rows render
`1,2,3,4,5,6,7,8,9,10,11,12`.

## 3. The other surfaces

### 3.1 Step 16 — renumber-confirm completeness

`gui_builder.js`, `confirmRenumber`. The dialog said addresses are sticky by
name; it did not say that the engine-model ids and the operator's hand-placed
2D anchors are keyed the same way and therefore move to a different physical
light too. It now enumerates all three:

```
EVERYTHING KEYED ON THE NAME STAYS PUT AND THEREFORE MOVES TO A DIFFERENT PHYSICAL LIGHT:
  • DMX addresses (controller chains + patches.yaml)
  • engine model ids — sectionId / fixtureId
  • saved 2D Pixel Map anchors (a fixture's hand-placed position in a view)
```

### 3.2 Coordinator's step 12 — the operator's right chimney ring, restored

`simulation/src/gui/pixel_map/pixel_map_view_defaults.js` hardcoded
`'Right Top Chimney Generator'`. When he renamed that group to
**'Right SmokeStacks'** the selector matched nothing and the ring dropped out
of the default Top-Down view **with no warning at all** — a selector that
matches zero clusters just renders nothing.

Per the coordinator's decision, `CHIMNEY_GROUPS` is re-pointed at the current
names (`'Left Top Chimney Generator'`, `'Right SmokeStacks'`), verified
read-only against `scenes/titanic/scene_config.yaml`. Proven live: the default
Top-Down view now resolves **8 clusters for each ring**, and the old name
resolves to **0 clusters in the scene** — i.e. the re-point was necessary, not
cosmetic.

**The alternative — deriving the defaults from the live group list instead of
naming groups — was NOT done, and is deferred for Sina to opt into.** It would
remove this whole failure mode (no hardcoded name can go stale), at the cost of
the defaults no longer being a fixed, reviewable data literal. Until he
chooses, a new test file `tests/pixel_map_view_defaults.test.js` (4 tests)
fails by NAME if either group disappears from the scene, so the next rename is
a red test rather than a silently empty panel. `tests/pixel_map_views.test.js`
was updated to build its synthetic chimney rings from `CHIMNEY_GROUPS` and to
glob off the current names for the same reason.

### 3.3 Step 15 — chain-viz labels: see §4, cancelled by the operator

### 3.4 Controller chain chips — say what the order MEANS

`simulation/src/gui/controller_map_editor.js`. The plan found the chips render
`port.chain` insertion order and are never re-derived — deliberately, because
they are **cable documentation**. Nothing on screen said so, so chips reading
"… 10, 2, 3" look like the same bug §2 just fixed. The chain container now
carries a tooltip stating that the order is the order the fixtures are CABLED,
that it is never re-sorted automatically, and that chips are dragged to match
the real cable. No behaviour change — the sort affordance itself is
operator-gated (`_44` step 17) and was not built.

---

## 4. Step 18 / step 15 — names in the 3D viewport: BUILT, MEASURED, REVERTED

The plan's step 15 asked the chain-viz labels to carry group context, and step
18 asked for the smallest honest "name in 3D". I implemented the full
`"<group> <n>"` label: the plan module gained a `chainLabelText`, the label
texture was sized to its text (a fixed 64×64 canvas clips a long name), and
the sprite was stretched by the resulting aspect. It worked, and the harness
went green on it.

**It also measured 7.58× wider than tall per label** — on a par ring that is
overlapping noise, which is exactly what the operator said when the ruling
arrived mid-session:

> "I don't like the names on the generator guides too messy, just the index is
> enough"

So it is **fully reverted**: `chain_order_visual.js`, the label texture
helper, the sprite construction and the overlay's topology key are all back to
their prior form, and the guides ship **index-only**. `git diff` on the label
path is now comment-only.

Two things were kept, because they survive the ruling on their own merits:

- **A cross-module parity test.** `chainLabelPlan`'s number and the `n` in
  `emitInChainOrder`'s `"<group> n"` name both derive from `expandChainOrder`
  but through different functions in different modules. One test now pins that
  equality across five splits shapes, so the number on a guide can never drift
  from the number in the fixture's name.
- **An index-only regression check** in `agent_tools/chain_order_viz_verify.cjs`
  asserting the label sprites stay SQUARE and carry no name — if anyone
  re-adds name plates, that harness goes red.

**Future option, for Sina only if he ever wants it:** a hover tooltip or a
selected-fixture line in an existing HUD element would put a name in the
viewport **on demand**, with zero always-on clutter — the finer-grained
variant of step 18. Not built, not needed for the ruling as stated.

---

## 5. Verification

**Suite** (`cd simulation && npm test`):

| | tests | pass | fail |
|---|---|---|---|
| baseline (before any edit) | 805 | 797 | 8 |
| after slice 3 | 829 | 821 | 8 |

**Same 8 failures, zero new; 24 tests added** (2 lanes ordering, 1 cross-module
label-number parity, 4 view defaults, plus the pre-existing files' updates).

**Parity CLI**, byte-unchanged before and after:
`titanic → FAIL 192 error / 0 warning / 9 info`, `test_bench → FAIL 4 / 0 / 1`.

**Scene-write gate**: all 77 `scenes/**` mtimes captured before and after every
browser run are **identical**; both harnesses report `save-server requests
aborted this run: 0` (none was even attempted) and `restore` all-true.

**Live harnesses** (fresh Chromium each, closed after, `window.__gpuAdapter`
recorded — `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)),
SwiftShader driver)`, `integrated: false`, `detectionFailed: false`; software
GL, so `--viewport`-class 1280×720/1440×900 per the skill):

- `simulation/agent_tools/name_index_parity_verify.cjs` — **NEW**, 5/5 PASS.
  Both chimney rings resolve (8 + 8), old name resolves to 0, lanes rows
  1..12 both in `seedPanel` and in the open panel, zero residue.
- `simulation/agent_tools/chain_order_viz_verify.cjs` — extended, **11/11
  PASS** after the revert (it was the harness that measured the 7.58× labels
  before the ruling).

**Screenshots, inspected by me:**

| Path | What it shows |
|---|---|
| `~/tmp/name_index_parity/01_top_down_both_chimney_rings.png` | Default Top-Down: bars, strands, and **both** par-ring dot clusters — his right ring is back |
| `~/tmp/name_index_parity/02_lanes_numeric_row_order.png` | The lanes panel rendering 12 stacked rows, one per fixture, in order |
| `~/tmp/chain_viz/06_index_only_guides.png` | The guides after the revert: clean square numbers 1-5 in run colours, no name plates |

Note: those captures also show the operator's own live banners
(`UNSAVED CHANGES`, `2 sim windows connected`, `ENGINE MODEL STALE — 981 → 987`).
The stale-model banner is the §1 condition, the two-windows warning is my probe
next to his session, and both are transient — my browser closes at exit.

---

## 6. Honesty notes

- The lanes ordering bug **cannot be reproduced on the live titanic scene**:
  its largest group is 8 lights and the bug starts at ten. Both the unit test
  and the live probe therefore use a synthetic 12-light group. The fix is
  still correct and still needed — any generator he grows past nine hits it.
- The plan's step 12 sits in slice 2, not slice 3; I implemented only the
  re-point, on the coordinator's explicit decision. **Slice 2 still owns the
  rest of step 12** (the `invalidateMarsinBatchCache('par_group_rename')`
  parity fix, pixel-map selector migration on rename, and the loud
  zero-match warning). If Slice 2 also edits `pixel_map_view_defaults.js`,
  mine is the newer content.
- I edited `gui_builder.js` in three places while slice 1 was live in the same
  file. Two survive (the confirm dialog and a comment at the label block); the
  third was reverted. During that work an edit introduced a stray NUL byte into
  the file — caught by a binary-file grep, located, and removed; the file now
  parses clean with 0 NUL bytes, verified with `acorn`.
- `chain_order_viz_verify.cjs` is a pre-existing harness I extended rather than
  duplicating. Its label assertions changed shape twice (names, then
  index-only); what ships asserts index-only.
- Notion cards not filed — no Notion MCP tools in this session, same gap as
  `_43`/`_44`.

## 7. Files

Source:
- `simulation/src/gui/pixel_map/pixel_map_layout.js` — natural lane sort
- `simulation/src/gui/pixel_map/pixel_map_view_defaults.js` — `CHIMNEY_GROUPS` re-point
- `simulation/src/gui/gui_builder.js` — renumber-confirm text (+ ruling comment)
- `simulation/src/gui/controller_map_editor.js` — chain-order tooltip
- `simulation/src/dmx/chain_order_visual.js` — header records the index-only ruling

Tests:
- `simulation/tests/pixel_map_layout_expansion.test.js` (+2)
- `simulation/tests/pixel_map_view_defaults.test.js` (NEW, 4)
- `simulation/tests/chain_order_visual.test.js` (+1 cross-module parity)
- `simulation/tests/pixel_map_views.test.js` (chimney groups derived, globs re-pointed)

Harnesses:
- `simulation/agent_tools/name_index_parity_verify.cjs` (NEW)
- `simulation/agent_tools/chain_order_viz_verify.cjs` (index-only check)
