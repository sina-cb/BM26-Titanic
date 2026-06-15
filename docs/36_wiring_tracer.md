# Wiring Tracer — Design Document

**Version:** 2.0
**Date:** 2026-06-15
**Author:** Sina Solaimanpour + Agent
**Status:** Design — Pending Review

> **v2.0 changes:** cabling is now a **cable-type catalog** (not binary
> power/data); switches/server/outlets/generators/adapters are **fixed
> components with typed ports**; traces are **routes between endpoints** (which
> need not be components); v1 is **manual STL-surface tracing only**; surface
> snapping no longer relies on far-wall/closed-shell intersection; length comes
> from a **calibrated reference scale**; and v1 exports **printable view-specific
> wiring sheets**, not just a markdown BOM.

---

## 1. Overview

The **Wiring Tracer** adds the *physical cabling layer* to the BM26 Titanic
simulation. Today the sim knows where every fixture lives and how it is patched
(DMX universe/address, `controllerIp`), but it has **no model of the cabling
that feeds them** — the power, the ethernet, the DMX, the ethercon, the
waterproof runs, the switches, the server, the outlets and generators. That
information lives only in people's heads, which is a strike-night and
build-night liability.

The Wiring Tracer makes that topology a first-class, drawable, measurable
artifact:

- A **cable-type catalog** (`cableTypes`) describes every cable family we run —
  power, ethernet, DMX, ethercon (and start/extension variants), waterproof DMX
  and power — with connector, stock lengths, render style, weatherproofing, and
  BOM grouping. **Cabling is not power-vs-data**; a single physical route can
  carry several cable instances at once.
- **Components** (server, switches, outlets, generators, adapters, computer) are
  **fixed-placement** devices with **typed ports**. **Routes** are the physical
  cable paths traced on the ship model between two **endpoints** — and an
  endpoint can be a component port, a lighting group start, an inline anchor, an
  outlet/generator, etc.
- **Manual STL-surface tracing (v1):** the operator clicks waypoints directly on
  the model surface. Each waypoint is a snapped surface point carrying enough
  side/offset metadata to render it inside, outside, or raised. No auto-routing.
- **Calibrated length:** the sim is in arbitrary model units, so the operator
  sets a reference measurement and **all cable lengths are derived relative to
  that real-world scale**.
- A new **`wiring` lighting-mode profile** (`profile_registry.js`) renders the
  cabling, and v1 **exports printable, view-specific wiring sheets** (port side,
  starboard, inside trunk, power-only, ethernet/DMX-only, per-harness, BOM page).

The reference topology the operator asked for:

```
  Computer ──▶ Main Server ──▶ Switch A ───────────▶ Switch B
   (laptop)    (engine host)    │ (port side)         │ (starboard)
                                ▼                      ▼
                          group starts            group starts
                          (left half)             (right half)

  Outlets / generators feed power; switches feed data. A single route to a
  group start can carry BOTH an ethercon/power extension AND a data cable,
  bundled into a named harness. Routes leave from inside the ship and surface
  near each group's first fixture.
```

Mission tie-in: the exterior **must** be lit at night and the rig **must**
strike in under two hours (`00_codex.md`). A wiring model that prints "Switch B
→ Right Front Wall Generator: 1× 50 ft waterproof power + 1× 50 ft ethercon
extension, harness `stbd_leg_3`, routed inside the starboard hull" is a direct
contribution to both — fewer mystery cables, faster teardown, a labeled harness.

---

## 2. Current State (what we build on)

The Wiring Tracer is **not** a green-field subsystem. Four existing pieces do
most of the hard work; the feature is mostly *composition*.

| Existing capability | Where | What the Wiring Tracer reuses |
|---|---|---|
| **Surface snap raycaster** | `interaction.js` `onPointerMove` (L117-156) | Casts from the mouse into `modelMeshes`, takes `hit.point`, transforms `hit.face.normal` to world space, offsets along it. This *is* "place a ray-traced point on the model." Route waypoints reuse it directly. |
| **Trace objects** (lines, dots, handles, gizmos) | `gui_builder.js` `buildTraceObject` (L2240+), `params.traces` | The render + edit pattern for a polyline that lives on the model. Routes render the same way (`userData.isTrace`-style hit objects, `TransformControls` on waypoints). |
| **Lighting-mode profiles** | `profile_registry.js` `LIGHTING_PROFILES` | We add a `wiring` profile and a render flag (`wiringMode`) that the fixture/cone/emitter code already keys off via `getProfileDef()`. |
| **Groups + group order, camera presets** | `scene_config.yaml` `parLights.fixtures[].group`; `cameras.yaml`; `views.yaml` | A route can terminate at a **group start** (the first fixture of a named group). Printable wiring sheets reuse the per-scene `cameras.yaml` presets and the headless `agent_render.cjs` loop. |

Nothing here requires touching the WASM engine, sACN, or CaptainPad. It is a
**sim-only authoring + visualization tool** that emits a data file, a BOM, and
print packets. (A read-only CaptainPad harness tab is a later follow-up, §12.)

---

## 3. Data Model

### 3.1 Storage — per-scene sidecar `wiring.yaml`

Wiring lives in a **per-scene sidecar**, mirroring `views.yaml`:

```
simulation/scenes/<scene>/wiring.yaml
```

Rationale (and the explicit choice over stuffing it into `scene_config.yaml`):

- `scene_config.yaml` is already 35 KB and dominated by auto-generated fixture
  blocks; wiring is hand-authored and benefits from a clean, reviewable diff.
- It matches the precedent set by `views.yaml` and `cameras.yaml` (also
  hand-authored, per-scene topology).
- A scene with no `wiring.yaml` simply has no wiring — that is the only
  legitimate "empty" case. Per the codex P0 rule there are **no fallback
  behaviors**: anything *malformed* throws loudly at load time (§10). We never
  boot looking healthy with a half-broken harness.

### 3.2 Cable-type catalog (`cableTypes`)

The catalog is the heart of the v2 model. Every cable a route carries references
a `cableTypes` entry **by id**; there is no hardcoded power/data split. The
catalog is **author-defined and extensible** — the entries below are the
operator's current inventory.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique catalog key referenced by route cables (e.g. `waterproof_power`). |
| `family` | enum | Grouping family: `power · ethernet · dmx`. Drives default render + which printable "layer" view it falls into. |
| `connector` | string | Physical connector (`edison`, `rj45`, `ethercon`, `xlr5`, `xlr5_wp`, `socapex`…). Used for port compatibility + BOM grouping. |
| `stockLengths` | number[] | Owned lengths **in `scale.unit`** (e.g. ft). BOM rounds each cable of this type up to one of these (§6.3). |
| `color` | string | Render colour for tubes/labels of this type. |
| `radius` | number | Render tube radius (model units). |
| `weatherproof` | bool | Weatherproofing flag — a BOM grouping axis and a sanity check for outdoor runs. |
| `bomGroup` | string | Optional explicit BOM bucket label; defaults to `family`. |

```yaml
  cableTypes:
    power:
      family: power
      connector: edison
      stockLengths: [15, 25, 50, 100]
      color: '#ffae42'
      radius: 0.035
      weatherproof: false
    waterproof_power:
      family: power
      connector: edison_wp
      stockLengths: [25, 50, 100]
      color: '#ff7700'
      radius: 0.04
      weatherproof: true
    ethernet:
      family: ethernet
      connector: rj45
      stockLengths: [10, 25, 50, 75, 100]
      color: '#33c1ff'
      radius: 0.03
      weatherproof: false
    ethercon:
      family: ethernet
      connector: ethercon
      stockLengths: [25, 50, 100]
      color: '#1f8fff'
      radius: 0.032
      weatherproof: true
    ethercon_start:           # the controller-side leg of an ethercon chain
      family: ethernet
      connector: ethercon
      stockLengths: [3, 6, 10]
      color: '#5fb0ff'
      radius: 0.032
      weatherproof: true
    ethercon_extension:       # span lengths joined inline along a chain
      family: ethernet
      connector: ethercon
      stockLengths: [25, 50, 100]
      color: '#1f8fff'
      radius: 0.032
      weatherproof: true
    dmx:
      family: dmx
      connector: xlr5
      stockLengths: [25, 50, 100]
      color: '#b48cff'
      radius: 0.028
      weatherproof: false
    waterproof_dmx:
      family: dmx
      connector: xlr5_wp
      stockLengths: [25, 50, 100]
      color: '#8a5cff'
      radius: 0.03
      weatherproof: true
```

### 3.3 Components & ports

**Components** are fixed-placement devices: `server`, `switch`, `outlet`,
`generator`, `adapter`, `computer`, `injector`. Each has placement and an
optional list of **ports**, and **ports declare the cable types/connectors they
accept** — not bare counts.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique. Referenced by route endpoints. |
| `name` | string | Display label. |
| `type` | enum | `server · switch · outlet · generator · adapter · computer · injector`. Drives icon/colour. |
| `placement.x/y/z` | number | World position (model units). |
| `placement.surface` | enum? | Optional `inside · outside · raised` — how its marker sits on the model (cosmetic; components are not traced). |
| `ports` | array | Each port: `id`, `accepts` (list of cableType ids **or** connectors), optional `count` (default 1). |

```yaml
  components:
    - id: pc_booth
      name: Control Laptop
      type: computer
      placement: { x: 18.0, y: 1.0, z: 12.0 }
      ports:
        - { id: eth_out, accepts: [ethernet], count: 1 }

    - id: server_main
      name: Marsin Engine Server
      type: server
      placement: { x: 18.4, y: 1.0, z: 12.0 }
      ports:
        - { id: eth_1, accepts: [ethernet], count: 4 }

    - id: switch_port
      name: Switch A (Port)
      type: switch
      placement: { x: 8.1, y: 6.2, z: 2.0, surface: inside }
      ports:
        - { id: uplink, accepts: [ethernet, ethercon] }
        - { id: eth, accepts: [ethernet, ethercon, ethercon_start], count: 8 }

    - id: outlet_port
      name: Port Quad Box
      type: outlet
      placement: { x: 7.5, y: 1.0, z: 2.0, surface: inside }
      ports:
        - { id: power, accepts: [power, waterproof_power], count: 4 }

    - id: gen_main
      name: Main Generator
      type: generator
      placement: { x: 6.0, y: 0.2, z: 14.0 }
      ports:
        - { id: out, accepts: [power, waterproof_power], count: 2 }
```

### 3.4 Anchors & endpoints

A **route endpoint** is whatever a cable physically lands on. It does **not**
have to be a component. Supported endpoint forms (exactly one key each):

| Endpoint | Resolves to | Example |
|---|---|---|
| `{ component: <id>, port: <portId> }` | A component's port world position. | `{ component: switch_port, port: eth_1 }` |
| `{ groupStart: <groupName> }` | The first fixture of a lighting group (auto-tracks; §3.7). | `{ groupStart: Left Front Wall Generator }` |
| `{ anchor: <id> }` | A named inline **anchor** — a free or surface-snapped point used as a junction/pass-through. | `{ anchor: midship_pass_through }` |

**Anchors** are lightweight named points (not devices) for pass-throughs,
splice points, or harness gather points:

```yaml
  anchors:
    - id: midship_pass_through
      placement: { x: 18.0, y: 7.6, z: 0.4, surface: inside }
    - id: stbd_hull_exit
      placement: { x: 27.5, y: 9.2, z: 1.1, surface: outside }
```

Component ports and `groupStart` endpoints provide the port-compatibility check
(§6.4); anchors are connector-agnostic junctions.

### 3.5 Routes & route cables

A **route** is one physical path on the model between **two endpoints**, threaded
through ordered surface waypoints (§4). A route **carries one or more cable
instances** (`cables`), so a single trace can be "ethercon extension + waterproof
power" without that combination being a hardcoded type.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique. |
| `name` | string | Optional display label. |
| `endpoints` | array | Exactly two endpoints (§3.4): `[from, to]`. Fewer/more throws. |
| `waypoints` | array | Ordered snapped surface points (§4). Empty = straight endpoint-to-endpoint. |
| `harness` | string? | Optional harness/bundle id this route belongs to (§3.6) — grouping metadata only. |
| `cables` | array | One or more `{ type: <cableTypeId>, lengthOverrideFt?, label? }`. Each is measured + BOM'd independently along the same path. |

```yaml
  routes:
    # Server → Switch A (single data cable, straight)
    - id: r_server_swA
      name: Server → Switch A
      endpoints:
        - { component: server_main, port: eth_1 }
        - { component: switch_port, port: uplink }
      cables:
        - { type: ethernet }
      waypoints: []

    # Switch A → start of a left group, carrying BOTH data and power on
    # ONE physical route, bundled into a harness.
    - id: r_swA_lfw
      name: Switch A → Left Front Wall (combined leg)
      harness: port_leg_1
      endpoints:
        - { component: switch_port, port: eth }
        - { groupStart: Left Front Wall Generator }
      cables:
        - { type: ethercon_extension }     # data leg
        - { type: waterproof_power }       # power leg, same drape
      waypoints:
        - { x: 9.0, y: 8.0, z: 1.0, side: inside,  off: 0.05 }
        - { x: 9.6, y: 9.5, z: 1.2, side: outside, off: 0.05 }   # surfaces here

    # Power origin honesty: the power for that group actually starts at the
    # outlet, joining the harness at the pass-through anchor.
    - id: r_outlet_lfw_power
      name: Port Outlet → Left Front Wall (power origin)
      harness: port_leg_1
      endpoints:
        - { component: outlet_port, port: power }
        - { anchor: midship_pass_through }
      cables:
        - { type: waterproof_power }
      waypoints:
        - { x: 7.8, y: 3.0, z: 1.6, side: inside, off: 0.06 }
```

### 3.6 Bundles / harnesses (grouping metadata)

A **harness** (a.k.a. bundle) is **grouping metadata, not topology**. It does not
change how routes connect; it labels a set of routes/cables that get pulled,
rendered, BOM-totalled, and printed together. Routes reference a harness by id
(`harness:` field); the optional `harnesses` block just gives it a display name
and colour.

```yaml
  harnesses:
    - { id: port_leg_1, name: Port Leg 1, color: '#ffd166' }
    - { id: stbd_spine, name: Starboard Spine, color: '#06d6a0' }
```

### 3.7 The `groupStart` endpoint

A `{ groupStart: "<group>" }` endpoint resolves at render/measure time to the
**world position of that group's first fixture** — index 0 of
`params.parLights.fixtures` filtered by `group`, the same point the fixture
trace starts from. It **auto-tracks**: re-running a generator or nudging the
start fixture moves the cable end with it. Empty/missing group → load throws (no
silent dangling cable).

### 3.8 Scale calibration (`scale`)

The FBX is in arbitrary model units; we do **not** assume "1 unit = 1 metre."
The operator sets one or more **reference measurements** and all lengths are
derived relative to them (§6.1). Multiple references are allowed and
cross-checked.

```yaml
  scale:
    unit: ft
    references:
      - id: known_deck_width
        points:
          - { x: 1, y: 2, z: 3 }
          - { x: 4, y: 5, z: 6 }
        actualDistance: 50
        role: primary
      - id: hull_length
        points:
          - { x: 0.0, y: 0.3,  z: 12.0 }
          - { x: 0.0, y: 0.3,  z: -12.0 }
        actualDistance: 78.5
        role: check          # cross-checks the primary; disagreement warns (§6.1)
```

### 3.9 Print views (`printViews`)

v1 exports **printable, view-specific wiring sheets** from saved camera/view
definitions (§7). Each entry pairs a camera (a `cameras.yaml` preset key or an
inline camera) with a content **filter**.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique. |
| `name` | string | Sheet title. |
| `camera` | string\|object | A `cameras.yaml` preset `key`, or an inline `{ position, target }`. |
| `filter` | object | What to draw: `side` (`port`/`starboard`), `family` (`power`/`ethernet`/`dmx`), `harness` (id), or `bomPage: true`. Omit for "everything." |

```yaml
  printViews:
    - { id: pv_port,    name: Port Side Wiring,        camera: side,    filter: { side: port } }
    - { id: pv_stbd,    name: Starboard Side Wiring,   camera: side,    filter: { side: starboard } }
    - { id: pv_trunk,   name: Top / Inside Trunk,      camera: aerial,  filter: {} }
    - { id: pv_power,   name: Power Only,              camera: aerial,  filter: { family: power } }
    - { id: pv_data,    name: Ethernet / DMX Only,     camera: aerial,  filter: { family: ethernet } }
    - { id: pv_h_port1, name: Harness — Port Leg 1,    camera: dramatic, filter: { harness: port_leg_1 } }
    - { id: pv_bom,     name: Bill of Materials,       camera: front,   filter: { bomPage: true } }
    # Optional later: a per-cable label sheet (printable cable tags).
```

### 3.10 Top-level shape

```yaml
# simulation/scenes/titanic/wiring.yaml
wiring:
  version: 2
  scale:        { ... }   # §3.8
  defaults:     { cableGap: 0.04, slack: 0.15 }   # render clearance + length headroom
  cableTypes:   { ... }   # §3.2
  components:   [ ... ]   # §3.3
  anchors:      [ ... ]   # §3.4
  harnesses:    [ ... ]   # §3.6
  routes:       [ ... ]   # §3.5
  printViews:   [ ... ]   # §3.9
```

---

## 4. Manual STL-Surface Tracing (v1)

This is the core authoring mechanic and the literal ask: *"trace it in 3d by
placing ray-traced points on the inside or outside of the stl model."* **v1 is
fully manual** — the operator clicks each waypoint on the model surface. There
is **no auto-routing** (see §12 for the future idea).

### 4.1 The snap (reuses the existing raycaster)

Each click casts a ray into `modelMeshes` and takes the **first hit** — the
surface point under the cursor. We store that hit plus enough metadata to render
the cable on the inside, outside, or raised off that point. We do **not** search
for a far-wall / "second intersection," and we do **not** depend on the model
being a closed shell.

From `interaction.js` `onPointerMove` (L128-141), the baseline already in the
codebase:

```js
raycaster.setFromCamera(mouse, camera);
const hit = raycaster.intersectObjects(modelMeshes, true)[0];
const point = hit.point;                          // the surface point we store
let n = hit.face.normal.clone()
  .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
  .normalize();                                    // world normal at the hit
```

### 4.2 Stored waypoint = surface point + side + offset

A waypoint stores the **raw surface hit**, the **world normal**, a **`side`**
attribute, and an **offset** — not a pre-baked position. Geometry is derived at
render/measure time, so changing `defaults.cableGap` or a point's `side`/`off`
re-drapes without re-tracing.

| Field | Type | Notes |
|---|---|---|
| `x/y/z` | number | The surface hit point (model units). |
| `nx/ny/nz` | number | World face normal at the hit, oriented to face the camera at click time (so `+n` is reliably "off the surface, toward the viewer"). |
| `side` | enum | `inside · outside · raised · free`. A **routing/rendering attribute of the clicked point**, not a far-wall calculation. |
| `off` | number | Clearance distance (model units; defaults to `defaults.cableGap`). |

Render offset by `side` (no hidden intersection required):

```
outside : pos = hit + (+n) * off            # rides the visible (clicked) face, outward
inside  : pos = hit + (-n) * off            # tucked just behind the clicked face
raised  : pos = hit + (+n) * off * RAISED   # stood off the surface (e.g. on standoffs)
free    : pos = hit                          # or a manually dragged air point (no snap)
```

`inside` simply offsets the clicked point **opposite** the camera-facing normal —
a rendering/labeling choice meaning "this cable runs behind this surface." It is
deterministic from the single hit; it never tries to find the actual interior
wall. `free` waypoints (no snap) handle spans crossing open cavities.

### 4.3 Authoring hotkeys

While placing, the live cursor previews the resolved point; the operator sets
the side per click:

- **`O`** outside · **`I`** inside · **`R`** raised · **`F`** free/air
- **`Backspace`** removes the last waypoint · **`Esc`** cancels the route

The hotkey legend is shown in the Wiring panel header.

### 4.4 Path interpolation & render

Between consecutive points the cable is a `TubeGeometry` following a
`CatmullRomCurve3` through `[fromPoint, ...waypoints, toPoint]` (centripetal, to
avoid overshoot at tight bends). Each cable on a route gets its own tube at the
type's `color`/`radius` (§3.2); multiple cables on one route render as parallel
offset strands. Length is measured on the **rendered curve**, not the chord sum,
so the BOM reflects the actual drape (§6.2).

---

## 5. The `wiring` Lighting-Mode Profile

Add to `LIGHTING_PROFILES` in `profile_registry.js`:

```js
wiring: {
  label: "Wiring",
  category: "wiring",
  isEditMode: false,
  mappingEnabled: false,
  allowConesUi: false,
  render: {
    emitterMode: 'fixture_representative', // one dim dot per fixture for reference
    analyticLightMode: 'none',
    coneMode: 'none',
    effectsMode: 'off',
    wiringMode: 'on'                        // NEW flag the wiring layer keys off
  }
}
```

When `params.lightingProfile === 'wiring'`:

- Fixtures render as **dim grey reference dots** (no beams, no bloom) so the
  cabling reads clearly.
- The **wiring layer is visible** (components + routes + anchors + labels). In
  every other profile it is hidden (built lazily, toggled, not rebuilt — same
  discipline as trace objects under "Show Generators").
- The model renders in its flat `editMaterial` so interior surfaces are legible.

`wiringMode` slots into the same `render` object the fixture code already reads
through `getProfileDef()` — no new plumbing, one more flag consulted by the
wiring render module and `model_fixture.js`'s visibility logic.

---

## 6. Measurement & Bill of Materials

### 6.1 Calibrated scale (source of truth for length)

All real length derives from the `scale` block (§3.8):

```
for the `primary` reference:
  dModel      = |points[1] - points[0]|              # model units
  realPerUnit = actualDistance / dModel              # e.g. ft per model-unit

every measured length:
  realLength(segment) = modelLength(segment) * realPerUnit
```

Guard-rails (each a real failure mode):

- **One primary scale, applied everywhere.** `realPerUnit` from the `primary`
  reference multiplies into every cable length and total. Move a reference point
  or edit `actualDistance` and **all** routes re-measure together.
- **Cross-check references disagree → warn loudly.** Every non-primary reference
  back-computes its own `realPerUnit`; if any differs from the primary by more
  than a tolerance (e.g. 3%), the panel raises a **"reference scales disagree"**
  warning naming the offenders. The operator picks which to trust.
- **Calibration is mandatory before BOM/print export.** Per the codex "no
  fallback behaviors": missing `scale`, no `primary`, or a degenerate reference
  (`dModel ≈ 0`) **blocks BOM/packet export with a loud "Not calibrated"
  banner** — never a silent metres assumption. A wrong cable order is worse than
  a blank one.

### 6.2 Per-cable length

```
modelLen(route) = curveLength([fromPoint, ...waypointPoints, toPoint])   # model units
realLen(cable)  = modelLen(route) * realPerUnit * (1 + defaults.slack)    # per cable on the route
```

`fromPoint`/`toPoint` resolve endpoints (§3.4). Every cable on a route shares the
route's drape length unless it carries a `lengthOverrideFt`.

### 6.3 BOM grouping & stock rounding (by cable type)

There are **no hardcoded power/data arrays**. Each cable rounds **up** to the
smallest entry in **its own `cableTypes[type].stockLengths`** (already in
`scale.unit`):

```
pick = smallest S in cableTypes[type].stockLengths where S >= realLen(cable),
       else flag "OVER MAX — needs a join/coupler"
```

The BOM groups by **cable type → connector → weatherproof → harness → stock
length**, e.g.:

```
TITANIC WIRING — BILL OF MATERIALS   (scene: titanic · scale: primary "known_deck_width" = 50 ft)

POWER
  waterproof_power  (edison_wp, WP)
    harness port_leg_1   50 ft × 4     312 ft measured
    harness stbd_spine   100 ft × 1     ...
  power             (edison)
    25 ft × 2     ...

ETHERNET
  ethercon_extension (ethercon, WP)
    harness port_leg_1   50 ft × 5     ...
  ethernet           (rj45)
    10 ft × 2     PC→Server, Server→Switch A

DMX
  waterproof_dmx     (xlr5_wp, WP)     50 ft × 3   ...

WARNINGS
  (none)   # or: "r_swA_swB ethercon_extension measures 104 ft — exceeds 100 ft max
           #      stock for that type; add a coupler or a midspan switch"
```

Over-max is always a **loud BOM warning**, never a boot failure and never a
silent truncation.

### 6.4 Port & compatibility checks

Where an endpoint names a component port, the panel verifies the route's
cable types are **accepted by that port** (the port's `accepts` list, by
cableType id or connector) and that the port `count` isn't oversubscribed.
Incompatible cable on a port is a **load-time failure** (§10); oversubscription
is a loud panel warning. Catches "Switch A has 8 eth ports but you've hung 11
legs" and "you ran `dmx` into a power outlet" before the playa does.

---

## 7. Printable Wiring Views (export packets)

v1's deliverable is a **print packet of view-specific wiring sheets**, not just a
markdown BOM. Each `printViews` entry (§3.9) renders its camera with the wiring
profile active and its content filter applied, then assembles the sheets into a
packet.

Reuses existing machinery:

- **Camera presets** in `scenes/<scene>/cameras.yaml` (Titanic ships `Front`,
  `Side`, `Aerial`, `Dramatic`, `Night Walk`), driven by `view_presets.js`
  `animateCamera()`.
- **Headless rendering** via `agent_tools/agent_render.cjs` (already loops
  presets and writes PNGs). The exporter sets the active filter, navigates the
  camera, and captures one PNG per `printView`.

**Export Wiring Packet** button → produces:

```
~/tmp/<scene>_wiring_packet/
  pv_port.png   pv_stbd.png   pv_trunk.png   pv_power.png   pv_data.png   pv_h_port1.png
  bom.md                         # the §6.3 BOM (rendered for pv_bom)
  packet.md                      # title + scale note + every sheet embedded inline
  packet.pdf                     # optional: assembled print-ready PDF
```

Filters are just visibility flags on the wiring layer (`side`, `family`,
`harness`) — the exporter flips them between passes, so there is **no separate
rendering path**. PNG/markdown print fine from any browser (offline-ready); PDF
assembly is an optional convenience. A **per-cable label sheet** (printable cable
tags) is a clean later addition. Output lands in `~/tmp/` (codex scratch rule);
the operator drops the packet into the Notion build card or prints it. On
software-GL machines use `--viewport 1280x720`.

A read-only **CaptainPad "Harness" tab** is a later follow-up (§12) once the data
model is proven.

---

## 8. GUI & Interaction

A new **Wiring** panel (left drawer), visible only in the `wiring` profile, built
on the existing drawer/panel infra (`left_drawer.js`, `panel_layout.js`).

- **Scale tool** — "Set Scale": click the two reference points (ray-traced like
  any waypoint), type the real distance + unit, optionally add cross-check
  references. Shows `realPerUnit`, back-computed sanity lengths, and any
  reference-disagreement warning. Until a `primary` is set, the BOM/print show
  "Not calibrated."
- **Component palette** — add a component of each `type`; click to place; edit
  its ports (`accepts`/`count`) in an inspector. Add inline **anchors** the same
  way.
- **Route tool** — pick a **from** endpoint (a component port, a group-start ring,
  or an anchor), click surface waypoints (`O`/`I`/`R`/`F` per §4.3), pick a **to**
  endpoint to finish; then choose the route's **cables** (one or more cable
  types) and optional **harness** in the route inspector.
- **Editing** — selecting a waypoint shows a `TransformControls` gizmo
  (`userData.isTrace`-style); dragging re-snaps in that point's `side`. Components,
  anchors, and scale points drag the same way.
- **Export Wiring Packet** — renders every `printView` to `~/tmp/` (§7).
- **Panel readouts** — the scale, per-route/per-cable length + stock pick,
  per-harness totals, the global BOM summary, and warnings (not-calibrated,
  reference-disagreement, over-max, port incompatibility/oversubscription,
  dangling endpoints).
- **Visual inspection** — author renders via the standard skill
  (`.agent/01_skills/00_see_the_world.md`, `agent_render.cjs --show-ui`). Always
  eyeball the PNG before claiming a clean harness.

---

## 9. File Layout & Module Plan

All new source uses **snake_case** filenames; classes stay PascalCase; **all
imports at top of file**, never wrapped in try/except (codex P0).

| File | Responsibility |
|---|---|
| `simulation/src/wiring/wiring_model.js` | Load/validate/serialize `wiring.yaml`; cable-type catalog; resolve component/port/anchor/groupStart endpoints; compute calibrated scale; length + BOM compute. Pure data — no THREE. Throws loudly on invalid input (§10); refuses to measure/export uncalibrated. |
| `simulation/src/wiring/wiring_snap.js` | The first-hit surface snap (§4): `(raycaster, modelMeshes, side, off)` → `{ point, normal, side, off }`. Shared by route waypoints, anchors, and scale points. |
| `simulation/src/wiring/wiring_render.js` | Build/refresh the THREE layer: component icons+labels, route tubes (per-cable Catmull-Rom → TubeGeometry), harness colouring, anchor/group-start markers, scale bar. Visibility/filter flags for print views. Gated on `profileDef.render.wiringMode`. |
| `simulation/src/wiring/wiring_tracer.js` | Interaction state machine: scale tool, component/anchor palette, route tool, waypoint placement, side modes, TransformControls editing. |
| `simulation/src/wiring/wiring_packet.js` | Print packet export (§7): applies each `printView` filter, drives `cameras.yaml`/`agent_render.cjs`, assembles PNGs + `bom.md` + `packet.md`/`.pdf` into `~/tmp/`. |
| `simulation/src/gui/wiring_panel.js` | The left-drawer panel: scale, palette, route/cable inspectors, BOM table, Export Wiring Packet, warnings. |
| `simulation/src/core/profile_registry.js` | **edit:** add the `wiring` profile (§5). |
| `simulation/scenes/<scene>/wiring.yaml` | Per-scene persisted catalog/components/routes/scale/printViews (starts empty / absent). |

Persistence rides the existing scene save path (the `:6970` save server that
writes `scene_config.yaml` / `views.yaml` / `cameras.yaml`).

**Offline readiness** (codex): only the already-vendored `simulation/vendor/three`
(Raycaster, TubeGeometry, CatmullRomCurve3, TransformControls). No CDNs, no new
npm deps, no fonts — labels reuse the sim's existing sprite/canvas-text approach.

---

## 10. Validation Rules (loud failures)

Load **fails loudly** (throws at parse time, no fallback) for:

- **Unknown cableType** — a route cable references an id not in `cableTypes`.
- **Unknown endpoint target** — a `component`/`port`/`anchor`/`groupStart` that
  does not exist (or an empty/missing group).
- **Incompatible cable on a port** — a route's cable type isn't in the named
  port's `accepts` list.
- **Duplicate IDs** — within `cableTypes`, `components`, a component's `ports`,
  `anchors`, `harnesses`, `routes`, or `printViews`.
- **Malformed scale reference** — a reference missing `points`/`actualDistance`,
  with fewer than two points, or with coincident points (`dModel ≈ 0`).
- **Malformed print view** — unknown camera preset key / inline camera, or a
  filter naming a non-existent `harness`.
- **Route with the wrong endpoint count** — not exactly two endpoints (v1).
- **Bad waypoint coordinates** — non-finite `x/y/z` (or `nx/ny/nz`).

Deferred to **BOM/export time** (still loud, but not a boot failure):

- **Missing required calibration** — no `primary` scale reference → BOM and
  packet export are **blocked** with a "Not calibrated" banner.
- **Reference scales disagree** — cross-check references beyond tolerance → warn.
- **Over-max stock length** — a cable longer than its type's max
  `stockLengths` → **loud BOM warning** (needs a join/coupler), never a failure.
- **Port oversubscription** — more routes on a port than its `count` → warning.

---

## 11. Implementation Phases

| Phase | What | Est. |
|---|---|---|
| **1 — Data core** | `wiring.yaml` schema + validator (all §10 load failures); cable-type catalog; calibrated scale calculation; endpoint resolution (component/port/anchor/groupStart); BOM computation from calibrated lengths. Pure data, no THREE; unit-cover validator + scale + BOM. | 4–5 h |
| **2 — Manual surface trace** | `wiring_snap.js` first-hit snap with side/offset; `wiring_render.js` route tubes + components + anchors; verify on inside/outside/raised waypoints with screenshots. | 3–4 h |
| **3 — Profile** | `wiring` profile in `profile_registry.js`; fixtures dim, model goes flat. | 1 h |
| **4 — Component/port UI** | Component + anchor palette, port editing (`accepts`/`count`), compatibility check surfacing. | 3 h |
| **5 — Route authoring** | `wiring_tracer.js` route tool, multi-cable selection, harness assignment, TransformControls editing; live BOM in `wiring_panel.js`. | 4–5 h |
| **6 — Print packet export** | `wiring_packet.js` — `printViews` filters + camera presets → PNG/PDF packet in `~/tmp/`. | 2–3 h |
| **7 — Author Titanic harness** | Build the real `scenes/titanic/wiring.yaml` (catalog, components, outlets/generators, routes, harnesses, scale, printViews); calibrate; render the packet. | 2–3 h |

Phase 1 is independently testable (no rendering) and unblocks everything; it is
the recommended first slice.

---

## 12. Resolved Design Decisions

The review questions from v1 are now **decisions**, baked into the design above:

- **Explicit fixed components, including outlets & generators — yes.** Power
  origins are real `outlet`/`generator` components with typed ports (§3.3); the
  power BOM is physically honest, not "fanned from a switch."
- **Bundles are harness/grouping metadata, not topology.** A `harness` labels and
  groups routes/cables for pulling, rendering, BOM totals, and print sheets — it
  never changes connectivity (§3.6).
- **Manual tracing only for v1.** The operator clicks every waypoint on the STL
  surface (§4). No auto-routing in scope.
- **Print views / export packet for v1.** Wiring is exported as printable,
  view-specific sheets (port/starboard/trunk/power-only/data-only/per-harness/BOM),
  PNG/PDF, from saved cameras (§7). CaptainPad harness tab is a later follow-up.
- **Calibrated reference scale, not sim units.** Length is derived from
  operator-set reference measurements; uncalibrated scenes refuse to report
  length (§3.8, §6.1).

**Future ideas (explicitly out of v1 scope):**

- **Assisted routing / geodesic surface pathfinding** — auto-suggest a route that
  hugs the hull between two endpoints. A real surface-pathfinding problem; revisit
  only if manual tracing proves tedious.
- **CaptainPad read-only "Harness" tab** — surface the BOM/packet on the iPad
  during build, once the data model is proven.
- **Per-cable printable label sheet** — printable cable tags from route/cable ids.

---

## 13. Why this respects the codex

- **No fallback behaviors** — every malformed input throws at load (§10); missing
  calibration blocks export; over-max stock is a loud warning. Nothing degrades
  silently.
- **Imports at top, snake_case files, classes PascalCase** — §9.
- **Offline-ready** — only the vendored THREE; no CDNs/fonts/npm at runtime.
- **Reuses, doesn't reinvent** — surface snap, trace render pattern, profile
  registry, group model, camera presets, and the headless renderer are all
  existing machinery (§2).
- **Serves the mission** — a typed, calibrated, printable harness shortens strike,
  de-risks "is the exterior actually getting power + data," and leaves a
  build-night artifact instead of tribal knowledge.
- **Scratch files to `~/tmp/`** — the exported wiring packet (BOM + per-view
  PNGs/PDF) lands in `~/tmp/`, not the tree.
- **Honest measurement** — length is calibrated from operator-set references
  (§6.1), never assumed.
