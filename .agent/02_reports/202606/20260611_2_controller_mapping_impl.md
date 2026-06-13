# Controller Mapping — phases 1+2 implemented (+ parts of 3/4)

- **Date:** 2026-06-11
- **Author:** agent (design review + implementation session with Sina)
- **Design:** `docs/33_controller_mapping.md` (decisions locked in this session)
- **Tasks:** 014 ✅, 015 ✅, 016 partial, 017 partial, 018 open, 019 open

## What landed

### Operator decisions applied first

- **Effects pins moved**: `config.yaml → global_effects` now pins
  ChauvetHaze4D at **U1:510** (2 ch → 510–511) and TEFogMachine at
  **U1:512** — the 511/512 overlap is gone. Doc updated to match.
- Full **512-channel budget** everywhere; universe 1 reserved for
  effects; split-universe ports via per-port `startAddress`; invalid
  states project to unpatched; auto-patcher being retired.

### Phase 1 — model + persistence (task 014, done)

- **`simulation/src/dmx/controller_registry.js`** (new): schema
  validation (`createControllerRegistry` throws on structural breakage —
  duplicate fixture across chains, bad gaps/ids/startAddress),
  packing + projection (`computeProjection`) implementing the full
  docs/33 contract: per-port packing from `startAddress`, overflow /
  orphan / overlap / IP / universe-ownership / effects-pin rules, each
  with the deterministic unpatched projection; `projectOntoConfigs`
  mutates live configs and assigns metadata (`sectionId` per group,
  `fixtureId` monotonic, `controllerId` = controller stable id) —
  absorbed from the auto-patcher's `assignMetadata`.
- **`simulation/main.js`**: fetches `controllers.yaml` (cache-busted),
  **hard-stops boot** on a present-but-broken file (same philosophy as
  views.yaml), attaches the registry to the config tree
  (`configTree.controllers`), and defines
  `window.projectControllerMappings()` which projects onto configs AND
  syncs `window.__globalPatchTree` so fixture rebuilds re-apply the
  projection. Boot projection runs before first render; drift from
  stored patches.yaml is corrected and logged loudly.
- **`simulation/server/save-server.js`**: extracts
  `configTree.controllers` to `controllers.yaml` via the existing
  atomic-write path (mirror of the views.yaml decouple).
- **`simulation/tests/controller_registry.test.js`** (new): 26 tests
  covering packing, every violation class, projection, metadata
  stability, mutations, id-never-reused, and a round-trip identity
  check. `package.json` test glob widened to `tests/*.test.js`.

### Phase 2 — panel UI (task 015, done)

- **`simulation/src/gui/controller_map_editor.js`** (new, ~750 lines)
  + `#controller-map-panel` markup in `index.html` + `cm-*` styles in
  `style.css`. Features, all driven through the real UI in smoke tests:
  - controller cards (name + IP inline edit, IP validated, red on
    malformed/duplicate), `+port` with next-free universe, danger
    modals only when mapped fixtures would be freed;
  - port rows: universe + startAddress click-to-edit, **positioned
    occupancy bars** (segments sit where they live in the universe —
    split ports read at a glance), per-port violation chips, used/512
    counter (red on any invalid entry);
  - chains: chips prefixed with computed start address, mixed-footprint
    packing verified (119 ch bars + 10 ch pars), strike-through on
    invalid, gap chips (grey, click-to-edit), pinned effects chips (📌);
  - chip drag-to-reorder AND drag-across-ports; ✕ to unmap;
  - **single-step undo toasts** (10 s) for unmap/reorder/move/deletes —
    modals only for controller/port deletion;
  - **Flow A**: `+ sel (n)` appends the 3D selection in click order
    (JS Set insertion order — verified); already-mapped fixtures
    rejected with a loud toast naming them and their port;
  - **Flow B**: `+ list` pick mode — port row glows, tray shows
    "adding to <controller> · Port N — **next: ch X**" live, one click
    per fixture, Esc exits; effects ports only accept effect fixtures
    (pinned automatically at their config.yaml address), normal ports
    hide effects;
  - `+ group…` bulk add (the auto-patcher's one good idea, made
    visible); `+ gap`; unmapped tray with name/group filter; header
    shows `Unmapped: N ⚠` flipping to `✓ fully patched`;
  - panel save button with the dirty-chip contract from the Views panel.
- `interaction.js` pointer-guard got `#controller-map-panel` +
  `#cm-toast` (the Views-panel lesson), and selection changes refresh
  the panel (`window.refreshControllerMapPanel`).

### Phase 3 — 3D linkage (task 016, partial)

- Chip click selects the fixture in 3D; chip/tray hover
  **flash-highlights** the fixture (reuses `setSelected` visuals);
  chips of selected fixtures get a highlight ring. Selection-order
  capture done.
- **Remaining** (tracked in 016): mapped/unmapped tint, port isolation
  eye, chain polyline + numbered sprites, unmapped-isolation from the
  header count.

### Phase 4 — single source of truth (task 017, partial)

- Fixture-card patch fields (`U / Addr / IP`) become **disabled with a
  "Derived from Controller Mapping" tooltip** when a mapping exists
  (both par and DMX card variants).
- Legacy **🎯 Auto-Patch All** is disabled (tooltip points at the
  panel) and **❌ Clear All Patches** refuses when a mapping exists —
  the two-writers problem is closed even before `auto_patcher.js` is
  deleted.
- `window.controllerRegistryRenameFixture(old, new)` rename hook is
  live; nothing calls it yet (fixture names aren't currently editable
  in the GUI — clone naming creates new, unmapped names).
- **Remaining** (tracked in 017): delete `auto_patcher.js` (the
  registry still imports `getFootprint` / `isGlobalEffect` /
  `gatherAllConfigs` from it), retire spec `.agent/00_gol/10`.

## Verification (auto-checks spec 04)

- `git diff --check -- simulation`: pass.
- `node --check` on every changed/new JS file: pass.
- `cd simulation && npm test`: **28/28 pass** (26 new + 2 existing;
  baseline required `npm install` in this container).
- Browser smoke (titanic, software GL via xvfb + SwiftShader):
  - boot render clean with NO controllers.yaml (registry inactive —
    zero behavior change; missing file is the legitimate case);
  - real-UI puppeteer run (buttons only, no APIs): open panel → add
    controller via modal (4 ports, universes 2–5 prefilled) → pick
    mode → 4 fixtures mapped in click order → addresses packed
    footprint-aware → unmap chip → **undo toast restores it** → panel
    save → `controllers.yaml` written and `patches.yaml` carried the
    projected fields. Screenshots inspected (`.agent_renders/cm_*.png`,
    gitignored).
  - One first-run undo flake was investigated and reproduced as a test
    timing artifact (toast replaced mid-script); the isolated repro and
    the clean re-run both confirm undo works.
- All scene/model runtime residue from the smoke runs was reset; the
  committed tree contains **no test mapping data**. The known
  `engine :6968 connection refused` console noise is expected with the
  engine down.

## Notes / deviations from the doc

- **Export blocking**: `exportConfig` couples model export and YAML save
  (an export failure aborts the whole save). Hard-blocking on mapping
  violations would therefore risk losing work-in-progress — and the
  unpatched-projection rule already guarantees no invalid address can
  reach `patches.yaml` or the model. So violations render loudly
  (banner, chips, red bars, console errors) but do not abort saves.
  The projection IS the guard. Doc's validation table still says
  "export blocked" — revisit the wording with Sina or wire a separate
  soft gate in `saveModelJS` if hard blocking is still wanted.
- Per-port `+ sel` is hidden on effects ports (selection-based mapping
  of effects makes no sense; `+ effects` pins them all at once).
- Shared-universe **color bands** (pure cosmetics) not done — folded
  into task 016's polish pass.

## Next steps

1. **016**: tint/isolation/polyline (the remaining 3D feedback).
2. **017**: delete `auto_patcher.js`, move footprint helpers into the
   registry, retire spec 10 (needs Sina's sign-off).
3. **018**: derive `sacn_universes` from the mapping, scene-owned;
   closes task 012.
4. **019**: full titanic 61-fixture mapping dry run + round-trip
   identity check via the real UI.

## Addendum (same day)

Operator correction after delivery: on the real rig a single group spans
6–15 controllers, so the `+ group…` bulk add on a port was removed —
mapping is strictly per-fixture (groups remain a tray filter only).
Decision 11 in docs/33.

Follow-up (same day): fixture-card DMX Patch rows (U / Addr / IP +
status dot) are now registered with `__metadataPanelRegistry`, so every
mapping mutation and save refreshes the lil-gui cards in place — values
AND the locked/derived state (creating the first controller locks all
cards live; deleting the last one unlocks them). Also fixed the
active→inactive transition: deleting the last controller now returns
every fixture to unpatched instead of leaving the final projection
behind. Verified with a real-UI run across all 61 titanic cards.

Follow-up (same day, operator asks): (1) changing a port's universe onto
one already carried by other ports (any controller) auto-suggests the
next free start address into the editable @ box, with a full-universe
warning when the chain doesn't fit at the end; overlap violations get a
one-click "⚡ fix → @N" button. Suggestions read a running per-universe
end map (`universeEnds`) built inside computeProjection's single pass —
O(1) lookups, no rescans. (2) Effects (foggers/haze) are now attachable
to ANY port from the tray and auto-pin at their config.yaml address
(U1:510/512), consuming no channels on the port's own universe — the
old pin_off_u1 rule is replaced by pinned-anywhere semantics
(pin_not_effect guards misuse). (3) Scale pass: collapsible controllers
(one-line summary) and ports, controller list in its own scroll region,
capped scrollable violations banner, tray/save always reachable.
Verified per real-UI runs on titanic (suggestion @239, U-full warning,
6-controller scroll/collapse layout) and test_bench (overlap fix →
@21, ChauvetHaze4D auto-pinned 📌U1:510 on a normal port). 31/31 tests.
