# DMX Integration Gap Analysis
**Date:** 2026-04-07  
**Scope:** `docs/11_sim_sacn_integration.md` + `docs/12_marsin_engine.md` vs actual codebase  
**Status:** Active development — engine functional, sim integration partial

---

## Executive Summary

The MarsinEngine CLI is **operational** (39fps, 323 pixels, 4 universes, sACN output confirmed). The simulation's sACN bridge receives data and the DMX router processes frames correctly. However, the **fixture rendering pipeline has a critical gap**: the sim bypasses the designed `PatchRegistry → DmxFixtureRuntime.applyDmxFrame()` path entirely. Instead, a temporary "direct apply" shim in `animate.js` reads DMX channels using hardcoded sequential addressing. This works but is fragile and blocks the architecture from scaling.

---

## Gap Summary

| Area | Design Doc | Actual Code | Severity |
|------|-----------|-------------|----------|
| PatchRegistry populated at runtime | Required (doc 11 §5, §7) | **Never called** — `initPatchRegistry()` has zero callers | 🔴 Critical |
| `universes:` block in scene_config.yaml | Required (doc 11 §7) | **Missing** — no top-level `universes:` block exists | 🔴 Critical |
| Fixtures created with patchDef | Required (doc 11 §4) | All patchDef = `null` (legacy mode, line 61 of fixtures.js) | 🔴 Critical |
| `highest_priority_per_patch` mode | Designed (doc 11 §3B) | **Stub** — falls through to source_lock (line 148 of universe_router.js) | 🟡 Medium |
| FixtureDefinitionRegistry initialized | Required (doc 11 §6) | ✅ Called in `main.js:219` | ✅ Done |
| SacnOutputDriver (re-broadcast) | Planned (doc 11 §4) | **Not implemented** — no file exists | 🟡 Medium |
| Fixture model metadata (mount, aim, beam) | Required (doc 11 §6) | **Not implemented** — no mount_pivot, beam_origin, etc. | 🟡 Medium |
| Unified config format (network/scene/universes) | Required (doc 11 §7) | **Not implemented** — config uses legacy `parLights:` block | 🟡 Medium |
| `pack_unpatched_only` helper | Required (doc 11 §8) | **Not implemented** — no code found | 🔵 Low |
| Validation invariants (§9) | Required checks | **Not implemented** — no config validation at load time | 🟡 Medium |
| MarsinEngine WASM backend | Primary renderer (doc 12 §3.1) | **Not implemented** (v2) — pure-JS only | 🔵 Low (by design) |
| Pattern files location | `marsin_engine/patterns/` (doc 12 §8) | ✅ Patterns copied, save-server updated | ✅ Done |
| Model includes DMX patch info | Required (doc 12 §4) | ✅ 323/323 pixels have `patch: { universe, addr, footprint }` | ✅ Done |
| DMX mapper (pixel → universe/addr) | Required (doc 12 §5) | ✅ `lib/dmx_mapper.js` — handles UkingPar 10ch + 3ch RGB | ✅ Done |
| sACN output sender | Required (doc 12 §6) | ✅ `lib/sacn_output.js` — one Sender per universe, unicast | ✅ Done |
| CLI interface | Required (doc 12 §7) | ✅ `engine.js` — --pattern, --fps, --list, --dry-run all work | ✅ Done |
| `rgbwau()` in runtime | Needed by patterns | ✅ Added to `marsin_runtime.js` | ✅ Done |

---

## Detailed Findings

### 🔴 GAP 1: PatchRegistry Never Populated

**Doc reference:** 11 §5, §7, §8  
**Code:** `src/dmx/patch_registry.js`

The `PatchRegistry` module is fully implemented (167 lines) with validation, overlap detection, and free-slot finding. But **`initPatchRegistry()` is never called** by any code path. It has zero callers outside its own file.

**Root cause:** There is no `universes:` block in `scene_config.yaml`. The config uses a flat `sacn_universes: '1,2,3,4'` string in the lighting engine section, which is only consumed by the sACN bridge for listener setup — not by the PatchRegistry.

**Impact:**
- All fixtures have `patchDef = null`
- The `animate.js` DMX router block (lines 164-173) is dead code for fixture-level DMX
- The "sACN Direct Apply" shim (lines 177-241) compensates but is fragile

**To close:** Add `universes:` top-level block to `scene_config.yaml` per doc 11 §7 format, call `initPatchRegistry(config.universes, fixtureRegistry)` in `main.js` after `initRegistry()`.

---

### 🔴 GAP 2: Fixtures Always Unpatched

**Doc reference:** 11 §4 (DmxFixtureRuntime = Placement + Patch + Definition + Live DMX)  
**Code:** `src/core/fixtures.js:61`

```js
fixture = new DmxFixtureRuntime(
  config, index, scene, interactiveObjects, modelRadius,
  fixtureDef,
  null, // patchDef — unpatched in legacy mode  ← ALWAYS NULL
  !!params.liteMode,
);
```

Every fixture is created with `patchDef = null`. The `DmxFixtureRuntime.applyDmxFrame()` method (line 356) exists and works but is never reached because `animate.js` guards it with `if (fixture && fixture.patchDef && fixture.fixtureDef)`.

**To close:** After PatchRegistry is populated, look up each fixture's patch by a mapping ID (will require adding `patchId` to the fixture config entries or deriving it from the fixture index/name).

---

### 🔴 GAP 3: sACN Direct Apply Shim Is Fragile

**Doc reference:** This path is NOT in the design docs.  
**Code:** `src/core/animate.js:177-241`

The "sACN Direct Apply" block is a workaround that reconstructs the sequential DMX addressing at render time:

```js
let patchUniverse = 1;
let patchAddr = 1;
for (const fixture of window.parFixtures) {
  // hardcoded 10ch footprint for all pars
  const footprint = 10;
  ...
}
```

**Problems:**
1. **Assumes fixture order is stable** — if fixtures are reordered in config, the addressing breaks silently
2. **Hardcodes 10ch footprint** — different fixture types (ShehdsBar has 119ch!) would map wrong
3. **No universe rollover bounds check** — could read past buffer boundaries
4. **Duplicates logic** — the auto-pack algorithm exists in both `gui_builder.js:saveModelJS()` and `animate.js`, with no shared source of truth
5. **LED strand addressing assumes it continues from par addressing** — fragile coupling

---

### 🟡 GAP 4: `highest_priority_per_patch` Not Implemented

**Doc reference:** 11 §3B, §5  
**Code:** `src/dmx/universe_router.js:147-156`

```js
} else {
  // highest_priority_per_patch: same as source_lock for now
  // (proper per-patch routing requires PatchRegistry integration)
  for (const source of activeSources) { ... break; }
}
```

The per-patch merge mode is documented as a key differentiator but falls through to `source_lock` behavior. This means a low-priority source that provides data for all patches will be fully overridden by a high-priority source even if that source only provides data for one patch.

**To close:** Integrate with PatchRegistry to iterate patches and resolve per-patch ownership.

---

### 🟡 GAP 5: No `universes:` Config Block

**Doc reference:** 11 §7  
**Expected format:**
```yaml
universes:
  1:
    name: Pars A
    fixtures:
      - id: par_0
        type: UkingPar
        addr: 1
        footprint: 10
```

**Actual:** The only universe-related config is `sacn_universes: '1,2,3,4'` in the lighting engine section. There is no fixture-to-address mapping in the YAML.

**Divergence:** The MarsinEngine model (`marsin_engine/models/model.js`) contains auto-packed patch info per pixel, but this is generated by `saveModelJS()` and lives outside the sim's config system. The sim itself has no awareness of the patch layout at runtime.

---

### 🟡 GAP 6: Config Schema Divergence

**Doc reference:** 11 §7 (unified format with `meta:`, `network:`, `scene:`, `universes:`, `fixtures:`)  
**Actual:** Scene config uses the legacy flat structure:

| Doc 11 Design | Actual Config |
|----------------|--------------|
| `network.inputs[]` with priority | `sacn_universes: '1,2,3,4'` flat string |
| `network.output` with destinations | Not present |
| `network.merge.mode` | Not present (hardcoded in `main.js`) |
| `universes:` top-level block | Not present |
| `fixtures:` with `patch:` + `placement:` | `parLights.fixtures:` with flat x/y/z/rot |
| `scene.render.mode` (design/show) | Not present |

---

### 🟡 GAP 7: Fixture Definition Metadata Incomplete

**Doc reference:** 11 §6  
**Required fields not present in fixture YAMLs:**

| Field | Status |
|-------|--------|
| fixture_type, channel_mode | ✅ Present |
| channel layout/pixels | ✅ Present |
| physical dimensions | ✅ Present |
| mount pivot | ❌ Missing |
| local forward axis | ❌ Missing |
| local up axis | ❌ Missing |
| beam origin | ❌ Missing |
| beam direction | ❌ Missing |
| default render hints | ❌ Missing |

These are needed for Mount mode, Aim mode, and surface-snapping orientation.

---

### 🔵 GAP 8: UI/UX Design Not Implemented

**Doc reference:** 11 §11 (3-pane layout: scene browser, 3D view, inspector)  
**Actual:** The sim uses lil-gui panels (right side) + floating pattern editor + floating sACN monitor. No scene/patch browser, no inspector panel, no patch strip visualization.

This is a large UX effort and not blocking the pipeline, but represents a significant gap from the target design.

---

### 🔴 GAP 9: No Fixture Type Selection in UI

**Doc reference:** 11 §2 (unified DMX fixtures)  
**Code:** `gui_builder.js:1007`

The "+ Light" button hardcodes `fixtureType: 'UkingPar'` for every new fixture. There is no dropdown or selector for choosing from available fixture types (UkingPar, ShehdsBar, VintageLed). The FixtureDefinitionRegistry has `listTypes()` and `getDefinition()` already imported but never used in the add-light flow.

**Impact:** Users cannot add LED bars or vintage lights without editing YAML manually.

**To close:** Replace the "+ Light" button with a type-selector dropdown populated from `listTypes()`.

---

### 🔴 GAP 10: No DMX Patch Controls in Fixture UI

**Doc reference:** 11 §5, §7, §8  
**Code:** `gui_builder.js:1042-1190`

The fixture card UI shows Name, Color, Intensity, Angle, Penumbra, Position, Rotation, and action buttons. There are **no fields** for Universe, DMX Address, or Channel Footprint. Users cannot set or view DMX patches for any fixture.

**Impact:** The only way to patch fixtures is via the auto-pack in `saveModelJS()`, which is invisible to the user and only writes to the engine model file.

**To close:** Add a "📡 DMX Patch" subfolder to each fixture card with Universe (1-63999), Address (1-512), and read-only Footprint fields. Persist as `dmxUniverse`/`dmxAddress` on the fixture config object.

---

### 🟡 GAP 11: Generator Fixtures Are Opaque

**Doc reference:** 11 §2 (procedural generators produce fixtures)  
**Code:** `gui_builder.js:893-924`

Generated fixture groups show only `🔒 Generated — edit via Generator` with a single On/Off toggle. Individual fixtures are completely hidden — no list, no DMX patch fields, no name access. The `return` at line 924 short-circuits the entire fixture rendering loop for trace-generated groups.

**Impact:** Users cannot view or edit DMX patches on generated fixtures, which represent the majority of fixtures (all deck/wall/chimney generators).

**To close:** Replace the locked view with an expandable fixture list. Show each fixture name with a collapsible DMX patch subfolder. Position/Color/etc remain read-only ("Controlled by generator"). Enable DMX patch editing.

---

### 🟡 GAP 12: No Generator Locking or Regeneration Safety

**Doc reference:** 11 §2 (patch allocation for procedural generators)  
**Code:** `gui_builder.js:1980-2000`

The "↻ Regenerate" button immediately deletes all generated fixtures and rebuilds without confirmation. If a user has manually set DMX patches on generated fixtures, those patches are silently lost.

Additionally, generators have no lock mechanism — slider changes (count, spacing) can accidentally alter fixture placement.

**To close:**
1. Add a `🔒 Lock` toggle per generator (persisted as `trace.locked`)
2. On regenerate, check for custom DMX patches and show a confirmation dialog listing affected fixtures

---

## What's Working Well

| Component | Status | Notes |
|-----------|--------|-------|
| **MarsinEngine CLI** | ✅ Solid | 39fps, all 9 patterns compile, rgbwau supported |
| **marsin_runtime.js** | ✅ Complete for v1 | Full PB API: time, wave, hsv, rgb, rgbwau, perlin, math |
| **dmx_mapper.js** | ✅ Working | UkingPar 10ch layout, 3ch RGB default, universe rollover |
| **sacn_output.js** | ✅ Working | One Sender per universe, unicast, graceful shutdown |
| **sacn_bridge.js** | ✅ Working | Receives sACN, forwards via WS, log broadcast |
| **SacnInputSource** | ✅ Working | Binary frame parsing, auto-add universes, stats |
| **UniverseRouter** | ✅ Working for source_lock | processFrame, getSlice, stale source detection |
| **UniverseFrameBuffer** | ✅ Working | Double-buffer, HTP merge, getSlice |
| **sACN Monitor Panel** | ✅ Working | Draggable, scrollable, collapsible, live logs |
| **Model export with patches** | ✅ Working | 323 pixels, 4 universes, auto-pack in saveModelJS |

---

## Recommended Priority Order

### P0 — Close the Pipeline (makes sACN → fixtures deterministic)
1. Add `universes:` block to `scene_config.yaml` (auto-generate from current fixtures)
2. Call `initPatchRegistry()` in `main.js` at startup
3. Pass `patchDef` to `DmxFixtureRuntime` constructor (look up from PatchRegistry)
4. Remove the "sACN Direct Apply" shim from `animate.js`

### P1 — Fixture UI (enables user-driven patching)
5. **Fixture type selector** on "+ Light" (GAP 9)
6. **DMX Patch controls** per fixture — universe, address, footprint (GAP 10)
7. **Generator fixtures expandable** with DMX patch editing (GAP 11)
8. **Generator lock toggle** and regeneration confirmation (GAP 12)

### P2 — Correctness
9. Implement `highest_priority_per_patch` in UniverseRouter (integrate PatchRegistry)
10. Add config validation at load time (doc 11 §9 invariants)
11. Single auto-pack source of truth (shared between engine model + sim config)

### P3 — Architecture
12. Migrate `scene_config.yaml` to unified format (doc 11 §7)
13. Add fixture metadata (mount pivot, beam origin) to fixture YAMLs
14. Implement SacnOutputDriver for re-broadcast

### P4 — UX & Polish
15. 3-pane UI layout (scene browser, inspector, patch strip)
16. `pack_unpatched_only` helper command
17. WASM rendering backend for MarsinEngine v2




