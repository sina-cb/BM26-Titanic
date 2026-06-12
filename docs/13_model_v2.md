# Marsin Model V2 — Design Document

**Version:** 2.0  
**Date:** 2026-04-16  
**Author:** Sina Solaimanpour + Antigravity Agent  
**Status:** Design — Pending Review

---

## 1. Overview

Model V2 introduces **semantic metadata** to every rendered pixel in the BM26 Titanic lighting simulation. Each pixel carries four integer fields that the WASM pattern engine can read as built-in variables:

| Field | Type | Range | Purpose |
|---|---|---|---|
| `controllerId` | uint16 | 0–255 | Identifies the physical ArtNet/sACN controller |
| `sectionId` | uint16 | 0–255 | Identifies the fixture group / section |
| `fixtureId` | uint16 | 0–65535 | Unique identifier per fixture (from DMX patch) |
| `viewMask` | uint16 | 0–65535 | Bitfield for view-based show control |

These fields are packed into an `Int32Array` (4 ints per pixel) and passed to the WASM `renderAllWithMeta6ch()` call alongside the coordinate buffer.

---

## 2. Current State

The V2 metadata plumbing is deployed end-to-end:
- ✅ WASM binary exports `marsin_render_all_with_meta_6ch`
- ✅ `MarsinEngine.renderAllWithMeta6ch()` packs coords + metadata into WASM heap memory
- ✅ `animate.js` batch pipeline builds render list, coordinate buffer, and metadata buffer
- ✅ GUI exposes 🔖 Metadata (V2) folder on all fixture types
- ✅ `scene_config.yaml` persists all four fields

**Problem:** All metadata fields are currently **0** for most fixtures, making V2 patterns like `rpm_fixtures_tune_v2.js` unable to differentiate fixtures. The fields need to be **auto-populated** from existing data in the DMX patch and group structure.

---

## 3. Auto-Population Design

### 3.1 Controller ID — From DMX Patch Controller IP

**Principle:** Every physical ArtNet/sACN controller has a unique IP address. All fixtures connected to the same physical controller should share a `controllerId`.

**Algorithm:**

```
1. Collect all unique controllerIp values from scene_config.yaml
2. Filter out empty strings and '0.0.0.0'
3. Sort lexicographically for deterministic ordering
4. Assign sequential IDs: 1, 2, 3, ...
5. All fixtures with the same controllerIp → same controllerId
6. Fixtures with no controllerIp → controllerId = 0
```

**Implementation Detail:**

```javascript
// Build IP → ID map
function buildControllerIdMap() {
  const ipSet = new Set();
  
  // Collect from par lights
  (params.parLights || []).forEach(cfg => {
    if (cfg.controllerIp && cfg.controllerIp !== '0.0.0.0') {
      ipSet.add(cfg.controllerIp);
    }
  });
  
  // Collect from LED strands (if they have controllerIp)
  (params.ledStrands || []).forEach(cfg => {
    if (cfg.controllerIp && cfg.controllerIp !== '0.0.0.0') {
      ipSet.add(cfg.controllerIp);
    }
  });
  
  // Sort for determinism and assign IDs
  const sorted = [...ipSet].sort();
  const map = new Map();  // ip → controllerId
  sorted.forEach((ip, index) => {
    map.set(ip, index + 1);  // 1-based
  });
  
  return map;
}
```

**When to run:**
- On config load (initial parse of `scene_config.yaml`)
- When a `controllerIp` field changes in the GUI
- When Auto-Patch is executed
- When a generator produces fixtures with a `controllerIp`

**GUI impact:**
- The `controllerId` field in the 🔖 Metadata (V2) folder becomes **read-only** (auto-computed)
- Show the source IP next to it: `Ctrl: 3  (10.1.1.10)`
- If `controllerIp` is empty, show: `Ctrl: 0  (no IP)`

**Real-world example:**

| Controller IP | Auto ID | Fixtures |
|---|---|---|
| `10.1.1.101` | 1 | Right Front Wall Generator 1-5 |
| `10.1.1.10` | 2 | Right Top Chimney 1-9 |
| `10.1.1.103` | 3 | Left Center Auditorium 1-6 |
| *(empty)* | 0 | Any unpatched fixture |

---

### 3.2 Fixture ID — From DMX Patch (Universe × 1000 + Address)

**Principle:** Each fixture occupies a unique position in the DMX address space. The formula `Universe × 1000 + Address` produces a compact, unique identifier.

**Formula:**
```
fixtureId = min(65535, dmxUniverse × 1000 + dmxAddress)
```

**Examples:**

| Universe | Address | fixtureId |
|---|---|---|
| 1 | 1 | 1001 |
| 1 | 120 | 1120 |
| 1 | 239 | 1239 |
| 2 | 1 | 2001 |
| 2 | 342 | 2342 |

**Edge cases:**
- Unpatched fixture (U=0, A=0) → `fixtureId = 0`
- Very high universe (U > 65) → clamped to 65535

**Current state:** This formula is already implemented for **generated fixtures only** (gui_builder.js line 1043). It needs to be extended to **all fixtures** (normal pars and LED strands).

**Implementation — extend to normal fixtures:**

In the normal Par fixture GUI build section (gui_builder.js ~line 1302-1306), replace the default initialization:

```javascript
// BEFORE:
if (config.fixtureId === undefined) config.fixtureId = 0;

// AFTER:
if (config.fixtureId === undefined || config.fixtureId === 0) {
  config.fixtureId = Math.min(65535, 
    (config.dmxUniverse || 0) * 1000 + (config.dmxAddress || 0));
}
```

And add auto-recompute when universe/address changes:

```javascript
uniInput.onchange = () => {
  config.dmxUniverse = v;
  // Auto-recompute fixtureId
  config.fixtureId = Math.min(65535, config.dmxUniverse * 1000 + config.dmxAddress);
  // ...
};
```

**GUI impact:**
- `fixtureId` field becomes **read-only** (auto-computed display, not an editable slider)
- Show as: `Fix ID: 1120  (U1:120)`

---

### 3.3 Section ID — From Generator Group Name

**Principle:** Each generator group or manually-created group represents a logical "section" of the installation. Patterns should be able to differentiate between sections.

**Algorithm:**

```
1. Collect all unique group names from all fixtures
2. Sort lexicographically for determinism
3. Assign sequential IDs: 1, 2, 3, ...
4. All fixtures in the same group → same sectionId
5. "Default" group → sectionId = 0
```

**Implementation:**

```javascript
function buildSectionIdMap() {
  const groupSet = new Set();
  
  (params.parLights || []).forEach(cfg => {
    const g = cfg.group || 'Default';
    if (g !== 'Default') groupSet.add(g);
  });
  
  const sorted = [...groupSet].sort();
  const map = new Map();  // groupName → sectionId
  map.set('Default', 0);
  sorted.forEach((name, index) => {
    map.set(name, index + 1);  // 1-based
  });
  
  return map;
}
```

**When to run:**
- On config load
- When groups are renamed, added, or removed
- When generators execute (they create named groups)
- When fixtures are moved between groups

**Real-world example:**

| Group Name | Auto sectionId |
|---|---|
| Default | 0 |
| Left Center Auditorium | 1 |
| Left Rear Wall | 2 |
| Right Center Auditorium Generator | 3 |
| Right Front Deck Generator | 4 |
| Right Front Wall Generator | 5 |
| Right Top Chimney Generator | 6 |

**GUI impact:**
- The `sectionId` field becomes **read-only** (auto-computed)
- Show the source group name: `Sect: 5  (Right Front Wall Generator)`

---

### 3.4 Centralized Auto-Computation Function

All three auto-computed fields should be handled by a **single centralized function** that runs at key moments:

```javascript
/**
 * Recompute all V2 metadata fields from DMX patch and group structure.
 * Call this whenever fixture topology, DMX patch, or group assignments change.
 */
function recomputeAllV2Metadata() {
  const controllerIdMap = buildControllerIdMap();
  const sectionIdMap = buildSectionIdMap();
  
  // Apply to all parLights
  (params.parLights || []).forEach(cfg => {
    // Controller ID from IP
    cfg.controllerId = controllerIdMap.get(cfg.controllerIp) || 0;
    
    // Fixture ID from DMX patch
    cfg.fixtureId = Math.min(65535,
      (cfg.dmxUniverse || 0) * 1000 + (cfg.dmxAddress || 0));
    
    // Section ID from group
    cfg.sectionId = sectionIdMap.get(cfg.group || 'Default') || 0;
  });
  
  // Apply to all LED strands (if applicable)
  (params.ledStrands || []).forEach(cfg => {
    cfg.controllerId = controllerIdMap.get(cfg.controllerIp) || 0;
    cfg.fixtureId = Math.min(65535,
      (cfg.dmxUniverse || 0) * 1000 + (cfg.dmxAddress || 0));
    cfg.sectionId = sectionIdMap.get(cfg.group || 'Default') || 0;
  });
  
  // Invalidate batch cache since metadata changed
  if (window.invalidateMarsinBatchCache) {
    window.invalidateMarsinBatchCache('v2-metadata-recompute');
  }
}
```

**Call sites:**

| Event | Trigger |
|---|---|
| Config loaded | After `scene_config.yaml` parse |
| Auto-Patch All | After sequential addressing |
| DMX patch change | When U/A/IP changes on any fixture |
| Group rename | When group name changes |
| Group move | When fixture moves between groups |
| Generator execute | After `generateGroupFromTrace()` |
| Fixture add/remove/duplicate | After `rebuildParLights()` |

---

## 4. View Mask System

### 4.1 Concept

The `viewMask` is a 16-bit bitfield that enables "views" — named configurations that control which fixtures are active/visible in a given show mode.

Each bit in the mask represents membership in a view:

| Bit | Value | View Name | Purpose |
|---|---|---|---|
| 0 | 0x0001 | `VIEW_ALL` | Universal — always active |
| 1 | 0x0002 | `VIEW_MAIN_SHOW` | Main nighttime show |
| 2 | 0x0004 | `VIEW_HOUSE` | House/work lights |
| 3 | 0x0008 | `VIEW_EMERGENCY` | Emergency lighting only |
| 4 | 0x0010 | `VIEW_STAGE` | Stage/performance area |
| 5 | 0x0020 | `VIEW_AMBIENT` | Ambient/background |
| 6-15 | | *(user-defined)* | Custom views |

### 4.2 How Views Work in Patterns

A pattern can check `viewMask` to alter behavior:

```javascript
// Only render for main show fixtures
if (!(viewMask & 0x0002)) {
  hsv(0, 0, 0)  // black out non-main-show fixtures
  return
}

// Emergency mode: bright white
if (viewMask & 0x0008) {
  hsv(0, 0, 1)  // full white
  return
}
```

### 4.3 View Management UI (Future)

> [!NOTE]
> View assignment is **not automated** — it requires deliberate artistic decisions about which fixtures belong to which views. This is different from `controllerId`/`sectionId`/`fixtureId` which are derived from objective data.

**Proposed UI:** A "Views" panel in the GUI that lets users:

1. **Create named views** — e.g., "Main Show", "Emergency", "Build Night"
2. **Batch-assign view bits** — Select fixtures → toggle view membership
3. **Preview a view** — Click a view to see only its fixtures lit
4. **View as dropdown** — Pattern picker includes a "Active View" dropdown that sets a global `activeView` variable accessible to patterns

**Implementation approach:**

```javascript
// View definitions stored in scene_config.yaml
views:
  - name: Main Show
    bit: 1
    color: '#00ff88'   # UI indicator color
  - name: House Lights  
    bit: 2
    color: '#ffaa00'
  - name: Emergency
    bit: 3
    color: '#ff0000'

// Active view selector
// Patterns can read which view is currently active
// via a global variable: activeViewBit
```

**Workflow for turning off a group via views:**

1. Assign all "background ambiance" fixtures to bit 5 (`VIEW_AMBIENT`)
2. In the main show pattern, check: `if (viewMask & VIEW_AMBIENT) { /* render dimmer */ }`
3. Or create a "kill switch" pattern variable: `if (!(viewMask & activeViewBit)) { hsv(0,0,0); return }`

### 4.4 View Mask — Why NOT Automatic

Views represent **artistic intent**, not physical topology. A fixture might be:
- Part of the main show AND emergency lighting
- On the stage but NOT in the ambient view
- On two different controllers but in the same view

This is fundamentally different from `controllerId` (physical), `sectionId` (group), and `fixtureId` (address). Auto-assigning views would remove creative control.

---

### 4.5 View Mask Declarations (Sidecar `*.viewmasks.js` Files & Auto-Mapping)

#### 4.5.1 Design & Auto-Mapping System

Model files (`*.js`) in `marsin_engine/models/` are **auto-generated** by the simulator's model export. Every regeneration clobbers any hand-edited pixel properties, resetting all `vMask` / `viewMask` fields to `0`. 

To maintain creative control and custom view definitions without having to hand-edit individual pixel coordinate definitions in the generator, the system uses companion **sidecar files** named `<modelName>.viewmasks.js`.

**The simulation scene is the source of truth for view masks.** Each scene has a `views.yaml` (managed by the sim's **Views panel**) holding the pinned `groupBits` table and named custom views; custom-view fixture membership lives in each fixture's `viewMask` bitfield (patches.yaml). The model exporter regenerates `<scene>.viewmasks.js` together with the model in the same pass, so the sidecar can never go stale relative to the pixels. Do not hand-edit the sidecars — they are clobbered on every export, exactly like the model files.

At load time, the engine resolves the base `group → bit` table for the model, preferring an explicit contract over derivation:

1. **Pinned (preferred):** the sidecar exports a `groupBits` object mapping every group name to its bit. This is the contract pattern code compiles against, so it is strictly validated against the loaded model — a model group missing from the table, a stale table key the model no longer has, a non-power-of-two or duplicate bit, or a collision with a preset's explicit bit all **throw at load time**.
2. **Derived (sidecar-less models only):** each distinct pixel `group` value gets the lowest free power-of-two bit, in order of first appearance in the pixels array (stable, because the simulator export writes pixels in a fixed order). Bits explicitly reserved by sidecar presets are skipped. Fine while nothing depends on the bits yet — pin the logged table into a sidecar before writing patterns against it.

The engine logs the full table (and its origin) at startup, and exposes it as `groupBits` — plus the derived `MASK_*` pattern constants as `maskConstants` — in the `loadModel` result and the `GET /model/view-selection-options` response.

> [!WARNING]
> The engine previously used a static, hardcoded `GROUP_TO_BIT` table. Any model whose group names weren't in that table silently loaded with `vMask = 0` on every pixel, killing all view-mask selection for the rig (this happened at a deployment). Hardcoding a group→bit table in the engine is forbidden — bits must always be derived from the loaded model.

Next, the engine loads the sidecar file `<modelName>.viewmasks.js` (if it exists, otherwise an inline `export const viewMasks` from the model file) and resolves each preset entry against the dynamic group bits, OR-merging explicit-bit presets into the pixels' `vMask` and `viewMask` fields. A malformed sidecar (bad entry shape, unknown group name, duplicate/colliding bit, out-of-range pixel index) **throws at load time** — the engine must not boot looking healthy with broken view presets.

#### 4.5.2 Why Base Groups are Excluded from Sidecars

Because individual base groups (e.g. `TriangleEdges`, `TowerBars`) are already parsed from the model and available in the UI's group selection dropdown, they are **excluded** from the sidecar files. This avoids redundant representation in the "View Masks" selection dropdown in CaptainPad. The sidecar files are strictly reserved for **composite presets** (unions of multiple base groups, like `Apex`, `RedwoodPARs`, or `AllFixtures`).

#### 4.5.3 Sidecar File Format & Examples

Sidecar files are located in `marsin_engine/models/` and export `groupBits` (the pinned base-group contract, §4.5.1) plus a `viewMasks` array of presets. They are **auto-generated** from the scene's `views.yaml` by the simulator's model export — author views in the sim's Views panel, not here. Three preset shapes are accepted by the engine:

```javascript
// View-mask sidecar for the Summer Camp Dome model.
export const groupBits = {
  'TriangleEdges': 0x01,
  'TrianglePars':  0x02,
  'BarLights':     0x04,
  'VintageLights': 0x08,
};

export const viewMasks = [
  // 1. Composite of base groups — bit COMPUTED as the OR of the
  //    groups' dynamic bits. Preferred shape: survives model
  //    regeneration and pixel reordering.
  {
    name:   'Apex',
    groups: ['TriangleEdges', 'TrianglePars'],
  },

  // 2. Membership by group, with an EXPLICIT single bit. Use when
  //    pattern code hardcodes the bit value (e.g. Logsville's
  //    `var MASK_REDWOOD_PARS = 64`). The bit is reserved before
  //    base-group assignment, so it can never collide.
  {
    name:   'RedwoodPARs',
    bit:    0x40,
    groups: ['Redwoods1', 'Redwoods2', 'Redwoods3'],
  },

  // 3. Explicit bit + arbitrary pixel list. Fragile across model
  //    regeneration (indices shift) — prefer `groups`. Out-of-range
  //    indices throw at load time.
  {
    name: 'CustomSet',
    bit:  0x100,
    pixelIndices: [10, 11, 12, 42],
  },
];
```

> [!NOTE]
> Composite presets like `AllFixtures` are not needed in the sidecar files because the UI/engine already provides a default "ALL" option (which maps to the fast-path selection of all pixels).

Field reference:

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Human-readable preset name (shown in the CaptainPad picker). Required, unique. |
| `groups` | `string[]` | Base group names defining membership. Mutually exclusive with `pixelIndices`. |
| `pixelIndices` | `number[]` | Pixel indices (0-based) defining membership. Requires an explicit `bit`. |
| `bit` | `integer` | Optional explicit bit (positive power of two, unique). Omit to have the engine compute it from `groups`. Only declare when pattern code hardcodes the value. |

#### 4.5.4 Load Order & OR-Merge Mechanics

At load time, the engine processes the model and sidecar in this order:

1. **Load & validate** the sidecar entries; reserve every explicit `bit`. Invalid entries throw.
2. **Resolve base group bits** — the pinned `groupBits` table when declared (strictly validated, §4.5.1), otherwise derived in first-appearance order skipping reserved bits. More than 31 distinct bits throws — `vMask` crosses into the WASM runtime as a signed 32-bit integer, so bit 30 (`0x40000000`) is the highest safe bit.
3. **OR the base bit** into every pixel's `vMask` / `viewMask` according to its `group`.
4. **Resolve presets**: computed-bit composites get the OR of their groups' bits (no merge); explicit-bit presets are OR-merged into their member pixels (by `groups` or `pixelIndices`).

This means:
- A pixel can accumulate **multiple bits** from different entries.
- Computed-bit composites (e.g. `Apex`) are **not** OR-merged into the pixel's boot-time `vMask` to prevent bit pollution. Instead, they are resolved dynamically at query time by checking `(vMask & resolvedViewMaskBit) !== 0`.
- The merge is **additive only** — it never clears existing bits.

#### 4.5.5 Pattern Usage

Patterns read `viewMask` as a built-in variable and use bitwise AND to test membership. Prefer the **named `MASK_*` constants**: `WasmHost.compile` resolves every referenced-but-undeclared `MASK_<NAME>` identifier against the model's table and prepends its integer value before the MarsinScript compiler runs. Names are the sanitized group/preset name — camelCase split, non-alphanumerics → `_`, uppercased (`'Berg Alpha'` → `MASK_BERG_ALPHA`, `'RedwoodPARs'` → `MASK_REDWOOD_PARS`). Check the engine's startup log or `GET /model/view-selection-options` (`maskConstants`) for the exact spelling.

```javascript
// Preferred: names, resolved at compile time. A typo'd name is a
// loud compile error listing the model's known constants.
var isApex    = (viewMask & MASK_APEX) != 0;
var isBar     = (viewMask & MASK_BAR_LIGHTS) != 0;
var isVintage = (viewMask & MASK_VINTAGE_LIGHTS) != 0;

// Conditional rendering
if (isApex) {
  // Apex-specific animation
} else if (isVintage) {
  // Warm amber glow for vintage fixtures
}
```

A pattern that declares its own `var MASK_X = ...` keeps its value (the injector skips declared names), so older patterns with literal constants keep working. Raw literals (`viewMask & 4`) still work too, but break silently if the model's table is ever renumbered — names don't.

#### 4.5.6 Model Declarations

All four models pin their `groupBits` in sidecars (see the files for the full tables; `titanic.viewmasks.js` pins 30 groups and has no composite presets yet — tracked on the Notion board as "Author a titanic.viewmasks.js sidecar with composite presets"). Presets:

##### `test_bench.viewmasks.js`

| Name | Bit | Membership |
|---|---|---|
| `ParsAndBars` | computed | `ParLights` \| `BarLights` |

##### `summer_camp_dome.viewmasks.js`

| Name | Bit | Membership |
|---|---|---|
| `Apex` | computed | `TriangleEdges` \| `TrianglePars` |
| `AllButApex` | computed | `BarLights` \| `VintageLights` |

##### `summer_camp_logsville.viewmasks.js`

| Name | Bit | Membership |
|---|---|---|
| `RedwoodPARs` | `0x0040` (explicit — hardcoded in patterns 70–117) | `Redwoods1` \| `Redwoods2` \| `Redwoods3` |
| `VintageOnly` | `0x0080` (explicit — hardcoded in patterns 70–117) | `TowerVintageLights` \| `WallVintageLights` \| `WallVintageLightsTop` |

#### 4.5.7 Bit Assignment Conventions

> [!TIP]
> Every deployed model should have a sidecar with a **pinned `groupBits` table** — start from the engine's logged derived table and commit it. When choosing the numbering (it only matters for patterns using raw literals or for cross-model pattern portability), keep the convention:
>
> - **Bit 0x01** — Primary stage lights (apex / PARs / tower bars)
> - **Bit 0x02** — Secondary stage lights (par punctuation / tower vintage)
> - **Bit 0x04** — Perimeter / bar lights
> - **Bit 0x08** — Vintage / ambient fixtures
> - **Bits 0x10+** — Scene-specific groups (redwoods, walls, bergs, etc.)
> - **Explicit preset bits** — Only when pattern code needs a stable literal (e.g., `RedwoodPARs` = `0x40`); declared on the preset and reserved by the engine.
>
> Patterns should reference masks via `MASK_*` names (§4.5.5), which makes the numbering an implementation detail. Prefer reading the engine's startup `[Model] View-mask bits` log (or `groupBits` / `maskConstants` from `GET /model/view-selection-options`) over assuming values.

---

## 5. Performance Speedup: Batch Cache Optimization


### 5.1 Current Bottleneck

The `_rebuildBatchCache()` function iterates all fixtures, computes world positions, normalizes coordinates, and packs buffers. For 88+ fixtures with multi-pixel pars, this can be 200+ pixels.

**Current cost per rebuild:** ~2-5ms (estimated)  
**Current cost per frame:** ~0ms (cache hit) / ~5ms (cache miss)

### 5.2 Optimization Opportunities

#### 5.2.1 Reuse Typed Arrays

Currently, `_rebuildBatchCache()` allocates new `Float32Array` and `Int32Array` every rebuild. These could be pre-allocated and resized only when pixel count changes:

```javascript
// Pre-allocate at module level
let _coordCapacity = 0;
let _metaCapacity = 0;

function _rebuildBatchCache() {
  // ... build list ...
  
  const n = list.length;
  if (n * 3 > _coordCapacity) {
    _batchCoords = new Float32Array(n * 3);
    _coordCapacity = n * 3;
  }
  if (n * 4 > _metaCapacity) {
    _batchMeta = new Int32Array(n * 4);
    _metaCapacity = n * 4;
  }
  // ... fill in place ...
}
```

#### 5.2.2 Skip World Matrix Update for Static Fixtures

Most fixtures don't move between frames. The `fixture.group.updateMatrixWorld(true)` call in the batch builder forces Three.js to recompute the full matrix chain even for static objects. Use a dirty flag:

```javascript
// Only update if fixture was transformed since last cache build
if (fixture._matrixDirty) {
  fixture.group.updateMatrixWorld(true);
  fixture._matrixDirty = false;
}
```

#### 5.2.3 Separate Metadata-Only Updates

When only metadata changes (not position), skip the coordinate normalization step. Split the cache into two sub-versions:

```javascript
let _batchTopoVersion = 0;   // incremented on add/remove/move
let _batchMetaVersion = 0;   // incremented on metadata-only changes

// In rebuild:
if (topoVersion !== lastTopoVersion) {
  // Full rebuild: coords + meta + render list
} else if (metaVersion !== lastMetaVersion) {
  // Partial rebuild: just re-pack the _batchMeta array
}
```

### 5.3 WASM Memory Optimization

Currently, each `renderAllWithMeta6ch()` call does 3 `malloc` + 3 `free` operations:

```
malloc(outSize)     → 6 bytes/pixel
malloc(coordSize)   → 12 bytes/pixel  
malloc(metaSize)    → 16 bytes/pixel
// ... WASM call ...
free(outPtr)
free(coordPtr)
free(metaPtr)
```

**Optimization:** Pre-allocate persistent WASM-side buffers and reuse them:

```javascript
// In MarsinEngine, allocate once and resize as needed
ensureBuffers(pixelCount) {
  if (pixelCount <= this._allocatedCount) return;
  if (this._outPtr) this._module._free(this._outPtr);
  if (this._coordPtr) this._module._free(this._coordPtr);
  if (this._metaPtr) this._module._free(this._metaPtr);
  
  this._outPtr = this._module._malloc(pixelCount * 6);
  this._coordPtr = this._module._malloc(pixelCount * 3 * 4);
  this._metaPtr = this._module._malloc(pixelCount * 4 * 4);
  this._allocatedCount = pixelCount;
}
```

This avoids per-frame malloc/free overhead entirely.

---

## 6. Grouping & Model Acceleration

### 6.1 Group-Level Batch Rendering

Currently, all pixels are rendered in one flat list. Future optimization could group pixels by `(controllerId, sectionId)` to enable:

- **Per-section pattern switching** — different sections run different patterns
- **Per-controller output batching** — pixels for the same controller are contiguous in memory, enabling zero-copy DMX frame construction

### 6.2 Hierarchical Render Cache

```
Scene
 └── Controller Groups (by controllerId)
      └── Sections (by sectionId)
           └── Fixtures (by fixtureId)
                └── Pixels (individual LEDs)
```

Each level can be independently invalidated. A fixture move only invalidates its parent section. A metadata change only invalidates the metadata buffer.

### 6.3 Model Export Integration

The `saveModelJS()` function in `gui_builder.js` currently exports a flat pixel model. It should be extended to include V2 metadata:

```javascript
pixels.push({
  i: index,
  type: 'par',
  name: light.name,
  group: light.group,
  x, y, z,
  nx, ny, nz,
  patch: { universe, addr, footprint },
  channels: 3,
  // V2 metadata
  controllerId: light.controllerId,
  sectionId: light.sectionId,
  fixtureId: light.fixtureId,
  viewMask: light.viewMask,
});
```

---

## 7. Missing Batch Cache Invalidation — Fix Plan

The following `invalidateMarsinBatchCache()` calls need to be added:

### 7.1 `fixtures.js` — `rebuildParLights()`

Add at the **end** of `rebuildParLights()`:

```javascript
export function rebuildParLights(force = false) {
  // ... existing code ...
  
  // Topology changed — invalidate batch cache
  if (window.invalidateMarsinBatchCache) {
    window.invalidateMarsinBatchCache('rebuildPar');
  }
}
```

### 7.2 `gui_builder.js` — `rebuildLedStrands()`

Add at the end of the inner `rebuildLedStrands()` function:

```javascript
function rebuildLedStrands() {
  // ... existing code ...
  
  if (window.invalidateMarsinBatchCache) {
    window.invalidateMarsinBatchCache('rebuildStrands');
  }
}
```

### 7.3 `gui_builder.js` — `generateGroupFromTrace()`

Already calls `rebuildParLights(true)` which would be covered by 7.1, but an explicit call after generation would be clearer.

### 7.4 `interaction.js` — Delete and Duplicate keys

After `rebuildParLights()` calls in the `Delete` and `D` key handlers, the cache should be invalidated. This would be covered by 7.1 automatically.

---

## 8. Implementation Priority

| Phase | What | Estimated Effort |
|---|---|---|
| **Phase 1** | Add missing `invalidateMarsinBatchCache()` calls | 30 min |
| **Phase 2** | Auto-compute `fixtureId` for all fixtures | 1 hour |
| **Phase 3** | Auto-compute `controllerId` from `controllerIp` | 1 hour |
| **Phase 4** | Auto-compute `sectionId` from group name | 1 hour |
| **Phase 5** | Centralize into `recomputeAllV2Metadata()` | 1 hour |
| **Phase 6** | WASM buffer pre-allocation optimization | 2 hours |
| **Phase 7** | View mask UI system | 4+ hours (future) |

---

## 9. Pattern Examples Using V2 Metadata

### 9.1 Controller-Aware Rainbow

```javascript
// Each controller displays a different part of the rainbow
export function beforeRender(delta) {
  t1 = time(0.1)
}

export function render(index) {
  var baseHue = controllerId / 10
  var offset = index / pixelCount
  hsv(baseHue + offset * 0.3 + t1, 1, 1)
}
```

### 9.2 Section Blackout (View-Controlled)

```javascript
// Only render fixtures in the active view
export var activeView = 2  // Main Show bit

export function beforeRender(delta) {
  t1 = time(0.08)
}

export function render(index) {
  if (!(viewMask & (1 << activeView))) {
    hsv(0, 0, 0)
    return
  }
  
  var h = sectionId / 20 + t1
  var v = 0.5 + 0.5 * wave(t1 + index / 50)
  hsv(h, 0.8, v)
}
```

### 9.3 Fixture Identification Diagnostic

```javascript
// Each fixture ID maps to a unique color
// Use for on-site fixture identification
export function beforeRender(delta) {
  t1 = time(0.03)
}

export function render(index) {
  var h = (fixtureId % 100) / 100
  var s = fixtureId > 0 ? 1 : 0.2
  var v = 0.5 + 0.5 * wave(t1 + fixtureId / 50)
  hsv(h, s, v)
}
```

---

## 10. Open Questions

> [!IMPORTANT]
> **Q1:** Should `controllerId` auto-computation be **overridable**? If a fixture has no `controllerIp` set, should the user be able to manually set a `controllerId`? 
> **Current recommendation:** Yes — if `controllerIp` is empty, `controllerId` remains editable. If `controllerIp` is set, `controllerId` becomes read-only and auto-derived.

> [!IMPORTANT]  
> **Q2:** For LED strands, they don't currently have a `group` field or `controllerIp`. Should these be added? 
> **Current recommendation:** Add `group` and `controllerIp` to LED strand config schema to enable full V2 metadata parity.

> [!NOTE]
> **Q3:** The `Universe × 1000 + Address` formula caps at 65535 (max uint16). With universe 65+ this wraps. Is this acceptable for BM26?
> **Current recommendation:** Yes — BM26 uses at most ~10 universes, so the max fixtureId would be ~10512. Well within range.

> [!NOTE]
> **Q4:** Should views persist per-scene or per-pattern? If per-scene, they're in `scene_config.yaml`. If per-pattern, they'd need a separate storage mechanism.
> **Current recommendation:** Per-scene (in `scene_config.yaml`). A pattern reads `viewMask` from the metadata buffer — it doesn't define views.
