# Wiring Tracer — Design Document

**Version:** 1.0
**Date:** 2026-06-15
**Author:** Sina Solaimanpour + Agent
**Status:** Design — Pending Review

---

## 1. Overview

The **Wiring Tracer** adds the *physical cabling layer* to the BM26 Titanic
simulation. Today the sim knows where every fixture lives and how it is
patched (DMX universe/address, `controllerIp`), but it has **no model of the
copper and ethernet that actually feeds them** — the extension cords, the
ethernet bundles, the switches, the server. That information lives only in
people's heads, which is a strike-night and build-night liability.

The Wiring Tracer makes that topology a first-class, drawable, measurable
artifact:

- A **network/power graph** of *nodes* (computer, main server, switches,
  injectors, outlets) connected by *wire runs* (power = extension cords, data
  = ethernet bundles).
- Each wire run is a **3D polyline whose waypoints are ray-traced onto the
  inside or outside surface of the ship model** — reusing the exact
  surface-snap mechanism the fixture trace system already uses
  (`interaction.js` → `onPointerMove`, raycast against `modelMeshes`, offset
  along the face normal).
- A new **`wiring` lighting-mode profile** (`profile_registry.js`) that, when
  selected, dims the fixtures and renders the cabling so the operator can read
  the harness, trace a fault, and **measure total cable length per type** for
  the bill of materials.

The reference topology the operator asked for:

```
  Computer ──data──▶ Main Server ──data──▶ Switch A ──data──▶ Switch B
   (laptop)          (engine host)            │  (port side)    │ (starboard)
                          │                    │                 │
                          └──power─────┐       │                 │
                                       ▼       ▼                 ▼
                                  wall outlet  group starts   group starts
                                  / generator  (left half)    (right half)

  Switch A and Switch B each fan out 1 ethernet bundle + extension cords to
  the START of every lighting group on their side of the ship; the runs leave
  from inside the ship and surface near each group's first fixture.
```

Mission tie-in: the exterior **must** be lit at night and the rig **must**
strike in under two hours (`00_codex.md`). A wiring model that prints "Switch
B → Right Front Wall Generator: 1× 50 ft extension cord + 1× 50 ft CAT6,
routed inside the starboard hull" is a direct contribution to both — fewer
mystery cables, faster teardown, a labeled harness.

---

## 2. Current State (what we build on)

The Wiring Tracer is **not** a green-field subsystem. Four existing pieces do
most of the hard work; the feature is mostly *composition*.

| Existing capability | Where | What the Wiring Tracer reuses |
|---|---|---|
| **Surface snap raycaster** | `interaction.js` `onPointerMove` (L117-156) | Casts from the mouse into `modelMeshes`, takes `hit.point`, transforms `hit.face.normal` to world space, offsets along it. This *is* "place a ray-traced point on the model". We extend it with an inside/outside toggle. |
| **Trace objects** (lines, dots, handles, gizmos) | `gui_builder.js` `buildTraceObject` (L2240+), `params.traces` | The render + edit pattern for a polyline that lives on the model. Wire runs render the same way (`userData.isTrace`-style hit objects, `TransformControls` on waypoints). |
| **Lighting-mode profiles** | `profile_registry.js` `LIGHTING_PROFILES` | We add a `wiring` profile and a render flag (`wiringMode`) that the fixture/cone/emitter code already keys off of via `getProfileDef()`. |
| **Groups + group order** | `scene_config.yaml` `parLights.fixtures[].group`, `views.yaml` `groupBits` | A run can terminate at a **group start anchor** — the first fixture of a named group (which is also the trace start). The endpoint auto-tracks that fixture's world position. |

Nothing in the Wiring Tracer requires touching the WASM engine, sACN, or
CaptainPad. It is a **sim-only authoring + visualization tool** that emits a
data file and a BOM. (A later phase can surface the BOM in CaptainPad, see
§10.)

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
- It matches the precedent set by `views.yaml` (also hand-authored topology).
- A scene with no `wiring.yaml` simply has no wiring — **and that is the only
  legitimate "empty" case.** Per the codex P0 rule there are **no fallback
  behaviors**: a *malformed* `wiring.yaml`, a run referencing a missing node,
  or a group anchor naming a group that does not exist **throws loudly at load
  time**. We never boot looking healthy with a half-broken harness.

### 3.2 Schema

```yaml
# simulation/scenes/titanic/wiring.yaml
wiring:
  version: 1

  # Scale calibration — the SINGLE source of truth for real-world length.
  # The FBX is in arbitrary model units; we do NOT assume "1 unit = 1 metre".
  # Place two ray-traced reference points on a feature of KNOWN real length
  # (a deck plank, a beam, a doorway), declare that length, and every run
  # length is derived relative to this scale. See §6.1.
  calibration:
    unit: ft                 # the real-world unit everything is reported in
    refA: { x: 0.0,  y: 0.30, z: 12.0, surface: outside }   # ray-traced point A
    refB: { x: 0.0,  y: 0.30, z: -12.0, surface: outside }  # ray-traced point B
    realDistance: 78.5       # A↔B measured IRL, in `unit` (e.g. hull length)
    # scale (real per model-unit) = realDistance / |refB - refA|  — computed, not stored

  # Default physical assumptions, used for length → BOM rounding.
  defaults:
    cableGap: 0.04          # model-units the cable floats off the surface (clearance)
    slack: 0.15             # +15% length headroom on every run
    powerStockFt: [15, 25, 50, 100]   # extension-cord lengths we own  (Q5 — confirm)
    dataStockFt:  [10, 25, 50, 75, 100]  # ethernet lengths we own     (Q5 — confirm)

  nodes:
    - id: pc_booth
      name: Control Laptop
      type: computer
      placement: { mode: free, x: 18.0, y: 1.0, z: 12.0 }

    - id: server_main
      name: Marsin Engine Server
      type: server
      placement: { mode: free, x: 18.4, y: 1.0, z: 12.0 }
      ports: { data: 4 }

    - id: switch_port
      name: Switch A (Port)
      type: switch
      placement:
        mode: surface          # snapped to the model
        surface: inside        # inside | outside
        x: 8.1, y: 6.2, z: 2.0
        nx: -0.98, ny: 0.10, nz: 0.15   # stored world face-normal at snap time
      ports: { data: 8 }

    - id: switch_stbd
      name: Switch B (Starboard)
      type: switch
      placement: { mode: surface, surface: inside, x: 28.0, y: 6.2, z: 2.0,
                   nx: 0.98, ny: 0.10, nz: 0.15 }
      ports: { data: 8 }

  runs:
    # 1) Computer → Main Server (short patch lead, free air)
    - id: r_pc_server
      type: data
      from: { node: pc_booth }
      to:   { node: server_main }
      waypoints: []                      # straight node-to-node

    # 2) Main Server → Switch A
    - id: r_server_swA
      type: data
      from: { node: server_main }
      to:   { node: switch_port }
      bundle: trunk_port                 # named bundle (the "ethernet bundle")
      waypoints:
        - { x: 16.0, y: 2.0, z: 8.0, surface: inside,  off: 0.04 }
        - { x: 10.0, y: 5.0, z: 3.5, surface: inside,  off: 0.04 }

    # 3) Switch A → Switch B (the long cross-ship run)
    - id: r_swA_swB
      type: data
      from: { node: switch_port }
      to:   { node: switch_stbd }
      bundle: trunk_spine
      waypoints:
        - { x: 14.0, y: 7.5, z: 0.5, surface: inside, off: 0.04 }
        - { x: 22.0, y: 7.5, z: 0.5, surface: inside, off: 0.04 }

    # 4) Switch A → start of a left-side group (ethernet bundle leg)
    - id: r_swA_rfw_data
      type: data
      from: { node: switch_port }
      to:   { groupStart: Left Front Wall Generator }   # auto-tracks fixture 0
      bundle: trunk_port
      waypoints:
        - { x: 9.0, y: 8.0, z: 1.0, surface: inside,  off: 0.04 }
        - { x: 9.5, y: 9.5, z: 1.2, surface: outside, off: 0.04 }  # surfaces here

    # 5) Switch A → start of the same group (extension-cord / power leg)
    - id: r_swA_rfw_power
      type: power
      from: { node: switch_port }        # or a power node; see §3.3
      to:   { groupStart: Left Front Wall Generator }
      gauge: 12AWG
      waypoints:
        - { x: 9.0, y: 8.0, z: 1.0, surface: inside,  off: 0.06 }
        - { x: 9.5, y: 9.5, z: 1.2, surface: outside, off: 0.06 }
```

### 3.3 Field reference

**Node**

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique. Referenced by runs. Non-unique IDs throw. |
| `name` | string | Display label. |
| `type` | enum | `computer · server · switch · injector · outlet · anchor`. Drives the icon/colour. |
| `placement.mode` | enum | `free` (x/y/z in world, no surface) or `surface` (snapped). |
| `placement.surface` | enum | `inside · outside` — which face of the hull it sits on (surface mode only). |
| `placement.x/y/z` | number | World position (metres, sim units). |
| `placement.nx/ny/nz` | number | World face-normal captured at snap time (surface mode); used to re-offset and orient the icon. |
| `ports` | object | Optional `{ data, power }` counts — feeds the port-budget check (§6.4). |

**Run**

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique. |
| `type` | enum | `power` (extension cord) or `data` (ethernet). Drives colour + which stock list rounds it. |
| `from` / `to` | endpoint | `{ node: <id> }` **or** `{ groupStart: <groupName> }`. Exactly one key. Unknown node/group throws. |
| `bundle` | string | Optional bundle id. Runs sharing a bundle render as parallel strands / one fat tube and are summed in the BOM as a labeled bundle (the "2 ethernet bundle" ask → two named bundles, e.g. `trunk_port`, `trunk_stbd`). |
| `gauge` | string | Power only — `12AWG`, `14AWG`. Informational + BOM grouping. |
| `waypoints` | array | Ordered surface/free points the cable threads through (§4). Empty = straight node-to-node. |

**Waypoint**

| Field | Type | Notes |
|---|---|---|
| `x/y/z` | number | World position of the **snap hit** (on the mesh surface), before clearance offset. |
| `surface` | enum | `inside · outside · free`. Determines how the clearance offset is applied (§4.2). |
| `off` | number | Clearance gap in metres (defaults to `defaults.cableGap`). |

### 3.4 The "group start" anchor

A run endpoint of `{ groupStart: "<group>" }` resolves at render/measure time
to the **world position of that group's first fixture** — index 0 of
`params.parLights.fixtures` filtered by `group`, which is the same point the
fixture trace starts from. This is the literal "to the start of the groups"
requirement, and it **auto-tracks**: re-running a generator or nudging the
start fixture moves the cable end with it. If the group is empty or missing,
load throws (no silent dangling cable).

---

## 4. Ray-Traced Waypoints — Inside / Outside Surface Snap

This is the core technical ask: *"trace it in 3d… by placing ray-traced points
on the inside or outside of the stl model."* The fixture trace system already
does the **outside** half; we generalize it.

### 4.1 The existing outside snap (baseline)

From `interaction.js` `onPointerMove` (L128-141):

```js
raycaster.setFromCamera(mouse, camera);
const intersects = raycaster.intersectObjects(modelMeshes, true);
const hit = intersects[0];
const point = hit.point;
let n = hit.face.normal.clone()
  .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
  .normalize();
cursor.position.copy(point).addScaledVector(n, 0.05);  // float OUTWARD
```

That is "place a point on the outside of the model" — first hit, offset along
the outward world normal.

### 4.2 Generalizing to inside vs outside

The ship FBX is a **closed structure** (`environment.js` explicitly relies on
this: *"The model is a closed structure so backfaces are not visible…"*).
A closed shell means a camera ray through the hull produces **at least two
intersections**: the near (outer) wall and the far (inner / opposite) wall.
We pick the hit and the offset direction from the waypoint's `surface` mode:

```
mode = OUTSIDE
  hit  = first intersection (nearest to camera)
  Ngeo = world face normal of that hit
  Nout = Ngeo flipped to face the camera   (dot(Ngeo, rayDir) > 0 ? -Ngeo : Ngeo)
  point = hit.point + Nout * gap            # float off the OUTER skin, outward

mode = INSIDE
  # we want to ride the INNER face of the wall the operator is pointing at.
  hit  = first intersection (the wall under the cursor)
  Ngeo = world face normal of that hit
  Nin  = -Nout                              # opposite of the outward normal
  point = hit.point + Nin * gap             # float just INSIDE the same wall

mode = FREE
  point = hit.point                          # or a manually dragged air point
  # used for spans crossing open cavities (switch hanging in a room, etc.)
```

Key correctness points (each a real failure mode worth calling out):

1. **Normal orientation is not trusted.** Recomputed vertex normals
   (`computeVertexNormals` in `environment.js`) and FBX winding can point
   either way. We **never** assume the stored normal faces out; we orient it
   against the ray direction (`Nout` flips to face the camera). Inside is then
   simply `-Nout`. This makes inside/outside deterministic regardless of mesh
   winding.

2. **`intersectObjects` needs both faces.** The runtime structure material is
   `THREE.FrontSide` for draw performance, but `THREE.Raycaster` ignores
   material `side` and tests geometry directly, so back faces *are* hit. We do
   **not** change the draw material. (Verified against `onPointerMove`, which
   already raycasts the same meshes.)

3. **Inside ≠ "second intersection".** Offsetting the *first* hit inward by the
   clearance gap keeps the cable hugging the inner skin of the wall the
   operator clicked — which is what "route it inside the hull along this wall"
   means. Snapping to the literal far wall (second hit) would teleport the
   cable across the ship. We therefore offset the clicked wall inward, not
   chase a far surface.

4. **Stored data is the raw hit + mode + gap**, not the offset result. That way
   changing `defaults.cableGap` or a per-point `off` re-derives geometry
   without re-tracing, and the YAML stays human-readable as "this point is on
   *this* spot of the hull, inside, 4 cm off."

### 4.3 Inside/outside while authoring

During placement the operator holds/toggles the surface mode and the live
cursor previews the resolved point:

- **`I`** — inside mode (cursor rides the inner skin, tinted cyan)
- **`O`** — outside mode (cursor rides the outer skin, tinted orange)
- **`F`** — free/air point (no snap; drop on the camera-facing plane through the
  last point, draggable afterward via `TransformControls`)

The same hotkey set is shown in the Wiring panel header so it's discoverable.

### 4.4 Path interpolation & render

Between consecutive waypoints the cable is rendered as a `TubeGeometry`
following a `CatmullRomCurve3` through `[fromPoint, ...waypoints, toPoint]`
(centripetal, to avoid overshoot near tight bends). Power vs data get distinct
radii/colours (§5). The curve is sampled for length (§6) — we measure the
*rendered* curve, not the straight chord sum, so the BOM reflects the actual
draped path.

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

Behaviour when `params.lightingProfile === 'wiring'`:

- Fixtures render as **dim grey reference dots** (no beams, no bloom) so the
  cabling reads clearly against the model.
- The **wiring layer is visible** (nodes + runs + labels). In every other
  profile the wiring layer is hidden (built lazily, toggled, not rebuilt — same
  discipline as the trace objects under "Show Generators").
- The model renders in its flat `editMaterial` so interior walls are legible.

`wiringMode` slots into the same `render` object the existing fixture code
already reads through `getProfileDef()` — no new plumbing, just one more flag
consulted by the wiring render module and by `model_fixture.js`'s visibility
logic (which already branches on `profileDef.render.*`).

---

## 6. Length & Bill of Materials

### 6.1 Scale calibration — the reference segment (source of truth)

The FBX is in **arbitrary model units**; nothing in the sim guarantees "1 unit
= 1 metre," and the import scale is not trusted. So **all real-world length is
derived from one operator-set reference segment**, exactly as asked: place two
points a known real distance apart, and every other measurement is relative to
that scale.

```
refA, refB  = two ray-traced points on the model (placed like any waypoint, §4)
dModel      = |refB - refA|              # distance in model units
realPerUnit = calibration.realDistance / dModel    # e.g. ft per model-unit

# every length in the BOM is then:
realLength(segment) = modelLength(segment) * realPerUnit
```

Properties / guard-rails (each a real failure mode):

- **One scale, applied everywhere.** `realPerUnit` is computed once from the
  calibration block and multiplied into every run length, the cable-gap
  clearance, and the BOM totals. Change the reference (move a point, or edit
  `realDistance`) and **all** traces re-measure together — they are relative to
  the segment, never independently unit-ful.
- **Calibration is mandatory before any length is reported.** Per the codex
  "no fallback behaviors": if `calibration` is missing, or `dModel` is ~0
  (the two points coincide), the BOM **refuses to compute and shows a loud
  "Not calibrated" banner** rather than silently assuming metres. A wrong
  cable length is worse than a blank one.
- **Pick a long, well-defined reference** (hull length, deck span) — the longer
  the reference relative to your runs, the smaller the relative error. The
  panel shows the resulting `realPerUnit` and the back-computed length of a
  couple of known features so the operator can sanity-check the scale.
- **The reference points are ordinary ray-traced points** (§4) — placed with
  the same inside/outside/free snap, stored the same way. The scale bar lives
  *on the model*, so it travels with the scene.

### 6.2 Per-run length

```
modelLen(run) = curveLength([fromPoint, ...waypointPoints, toPoint])   # model units
realLen(run)  = modelLen(run) * realPerUnit * (1 + slack)              # §6.1 scale
```

`fromPoint` / `toPoint` resolve nodes (their world position) or group-start
anchors (the group's first-fixture world position). The curve is the *rendered*
Catmull-Rom drape (§4.4), not the straight chord sum.

### 6.3 Stock rounding

Each run is rounded **up** to the smallest stock length that fits, from
`defaults.powerStockFt` (power) or `defaults.dataStockFt` (data). Lengths are
already in real units (`calibration.unit`, ft) from §6.2:

```
pick = smallest S in stock where S >= realLen(run), else flag "OVER MAX — needs a join"
```

An over-max run is surfaced as a **loud warning**, never silently truncated.

### 6.4 BOM output

The Wiring panel renders a live table, and an **Export BOM** button writes
`~/tmp/<scene>_wiring_bom.md` (scratch dir per the codex; the operator copies
it into the Notion task or a build doc):

```
TITANIC WIRING — BILL OF MATERIALS  (scene: titanic)

POWER (extension cords)
  12AWG  50 ft × 6     Switch A → {LFW, LTC, LFD, LCA, ...} starts
  12AWG  25 ft × 2     Server → Switch A, ...
  ── total power copper: ~412 ft (rounded), ~358 ft (measured)

DATA (ethernet)
  bundle trunk_port    CAT6 50 ft × 5   Switch A fan-out (port side)
  bundle trunk_stbd    CAT6 50 ft × 5   Switch B fan-out (starboard)
  CAT6 75 ft × 1       Switch A → Switch B (spine)
  CAT6 10 ft × 2       PC→Server, Server→Switch A
  ── total ethernet: ~735 ft (rounded), ~641 ft (measured)

WARNINGS
  (none)   # or: "r_swA_swB measures 104 ft — exceeds 100 ft max stock; add a coupler or a midspan switch"
```

### 6.5 Port-budget check (optional, §3.3 `ports`)

If a node declares `ports`, the panel checks that the number of runs leaving it
does not exceed its data/power port count and flags overflow. Catches "Switch A
has 8 ports but you've hung 11 groups off it" before the playa does.

### 6.6 Printable harness sheets — multi-view export

The deliverable is not just a text BOM; it is a **print-ready harness packet
that shows the cabling from several camera angles**, so a builder can hold one
sheet and see where each run goes. This reuses machinery that already exists:

- **Camera presets** are already defined per scene in
  `scenes/<scene>/cameras.yaml` (Titanic ships `Front`, `Side`, `Aerial`,
  `Dramatic`, `Night Walk`) and driven by `view_presets.js` `animateCamera()`.
- **Headless multi-view rendering already works**: `agent_tools/agent_render.cjs`
  loops every preset key from `cameras.yaml` and writes
  `{ts}_{view}.png`. We render with the **`wiring` profile active** so each
  shot shows nodes + runs + labels over the flat model.

**Export Harness Packet** button → produces a single packet:

```
~/tmp/<scene>_wiring_packet/
  front.png        side.png        aerial.png      ...   # one per camera preset
  harness.md       # BOM table (§6.4) + scale note + each view embedded inline
```

`harness.md` interleaves the BOM with the rendered views, e.g.:

```
# Titanic Wiring Harness  (scale: 78.5 ft over reference segment)

## Front view
![front](front.png)

## Aerial view
![aerial](aerial.png)
...
## Bill of Materials
<the §6.4 table>
```

Two axes of "different views," both supported:

1. **Camera views** — the `cameras.yaml` presets above (the primary ask).
2. **Harness isolation** *(optional toggle in the panel)* — render the packet
   with only one switch's bundle visible (port side, then starboard), so each
   page reads cleanly. Run/bundle visibility is just a flag on the wiring layer
   (§5), so the exporter flips it between passes — no new rendering path.

The PNGs are captured headlessly via the existing render skill
(`.agent/01_skills/00_see_the_world.md`, `agent_render.cjs`); on software-GL
machines use `--viewport 1280x720`. Output lands in `~/tmp/` (codex scratch
rule); the operator drops the packet into the Notion build card or prints it.
A later phase can add a one-click PDF assembly, but markdown-with-images prints
fine from any browser and keeps us CDN-free / offline-ready.

---

## 7. GUI & Interaction

A new **Wiring** panel (left drawer), visible only in the `wiring` profile,
built on the existing drawer/panel infrastructure (`left_drawer.js`,
`panel_layout.js`).

**Calibration tool** — a "Set Scale" mode: click point **A**, click point **B**
(both ray-traced like any waypoint), then type the real distance + unit. The
panel immediately shows `realPerUnit` and a couple of back-computed sanity
lengths (§6.1). A scale-bar gizmo stays drawn between A and B so the reference
is always visible and re-editable. Until this is set, the BOM shows
"Not calibrated."

**Node palette** — buttons to add a node of each `type`. Click a button, then
click in the scene: free nodes drop at the cursor; surface nodes snap (I/O/F
modes from §4.3).

**Run tool** — the core authoring loop:

1. Click a **from** endpoint (a node icon, or a group-start anchor — group
   anchors render as small labeled rings at each group's first fixture).
2. Click successive **waypoints** on the model; toggle inside/outside/free with
   `I`/`O`/`F`; each click drops a ray-traced point and extends the live tube.
3. Click a **to** endpoint (node or group anchor) to finish. `Esc` cancels;
   `Backspace` removes the last waypoint.
4. Choose `power`/`data` and (optional) `bundle` in the run's inspector.

**Editing** — selecting a waypoint shows a `TransformControls` gizmo (same as
trace handles, `userData.isTrace`-style). Dragging re-snaps to the surface in
that point's current mode; the tube and BOM update live. Nodes drag the same
way.

**Export Harness Packet** — one button renders every `cameras.yaml` view with
the wiring profile active and writes the multi-view packet + BOM to `~/tmp/`
(§6.6).

**Panel readouts** — the scale (`realPerUnit` + reference length), per-run
length + stock pick, per-bundle totals, the global BOM summary, and any
warnings (not-calibrated, over-max runs, port overflow, dangling anchors).

**Visual inspection** — author renders are captured with the standard skill
(`.agent/01_skills/00_see_the_world.md`, `agent_render.cjs --show-ui` to keep
the Wiring panel and labels in frame). Always eyeball the PNG before claiming a
clean harness.

---

## 8. File Layout & Module Plan

All new source uses **snake_case** filenames; classes inside stay PascalCase;
**all imports at top of file**, never wrapped in try/except (codex P0).

| File | Responsibility |
|---|---|
| `simulation/src/wiring/wiring_model.js` | Load/validate/serialize `wiring.yaml`; resolve node & group-start endpoints; compute `realPerUnit` from the calibration segment (§6.1); length + BOM compute. Pure data — no THREE. Throws loudly on invalid topology / refuses to measure when uncalibrated. |
| `simulation/src/wiring/wiring_snap.js` | The inside/outside/free raycast snap (§4.2). Takes `(raycaster, modelMeshes, mode, gap)` → `{ point, normal }`. Shared by cursor preview, waypoint commit, and the calibration A/B picks. |
| `simulation/src/wiring/wiring_render.js` | Build/refresh the THREE layer: node icons+labels, run tubes (Catmull-Rom → TubeGeometry), bundle strands, group-start anchor rings, calibration scale-bar. Visibility gated on `profileDef.render.wiringMode`. |
| `simulation/src/wiring/wiring_tracer.js` | Interaction state machine: calibration tool, palette, run tool, waypoint placement, I/O/F mode, TransformControls editing. |
| `simulation/src/wiring/wiring_packet.js` | Drives the multi-view packet (§6.6): loops `cameras.yaml` presets via `animateCamera`/`agent_render.cjs`, flips bundle isolation, assembles `harness.md` + PNGs into `~/tmp/`. |
| `simulation/src/gui/wiring_panel.js` | The left-drawer panel: calibration, palette, inspectors, BOM table, Export Harness Packet, warnings. |
| `simulation/src/core/profile_registry.js` | **edit:** add the `wiring` profile (§5). |
| `simulation/scenes/<scene>/wiring.yaml` | Per-scene persisted topology + calibration (starts empty / absent). |

Persistence rides the existing scene save path (the same `:6970` save server
that writes `scene_config.yaml` / `views.yaml`); `wiring.yaml` is written
alongside them.

**Offline readiness** (codex): everything uses the already-vendored
`simulation/vendor/three` (Raycaster, TubeGeometry, CatmullRomCurve3,
TransformControls). No CDNs, no new npm deps, no fonts — labels use the same
sprite/canvas-text approach the sim already uses for fixture labels.

---

## 9. Implementation Phases

| Phase | What | Est. |
|---|---|---|
| **1** | `wiring.yaml` schema + `wiring_model.js` load/validate/serialize (loud failures); unit-cover the validator. | 2–3 h |
| **2** | `wiring_snap.js` inside/outside/free snap; verify against a thin and a thick hull wall with screenshots. | 2 h |
| **3** | Calibration: reference segment + `realPerUnit`; BOM refuses to measure uncalibrated. Unit-cover the scale math. | 2 h |
| **4** | `wiring` profile in `profile_registry.js`; fixtures dim, model goes flat. | 1 h |
| **5** | `wiring_render.js` — nodes, run tubes, group-start anchors, bundles, scale-bar. | 3–4 h |
| **6** | `wiring_tracer.js` — calibration + palette + run tool + waypoint placement + edit gizmos. | 4–5 h |
| **7** | `wiring_panel.js` — inspectors, live BOM, warnings, port check. | 3 h |
| **8** | `wiring_packet.js` — multi-view harness packet (camera presets + bundle isolation → `~/tmp/`). | 2–3 h |
| **9** | Author the reference Titanic harness (PC→server→A→B→group starts) into `scenes/titanic/wiring.yaml`, calibrate, and render the packet. | 2 h |

Phases 1–2 are independently testable and unblock everything else; they are the
recommended first slice.

---

## 10. Open Questions

> [!IMPORTANT]
> **Q1 — Power source nodes.** The reference topology fans *power* out of the
> switches for convenience, but extension cords physically originate at
> generators/outlets, not at a network switch. Do we model explicit `outlet`
> nodes (a small set of generator/quad-box positions) and route power runs from
> those, keeping data runs from the switches?
> **Recommendation:** Yes — add `outlet` nodes for the real power origins. It
> makes the power BOM physically honest and the diagram match reality. Cheap to
> add; it's just another node `type`.

> [!IMPORTANT]
> **Q2 — One bundle per switch, or two-into-one?** The ask says "2 ethernet
> bundle." Most natural reading: **one bundle per switch** (`trunk_port`,
> `trunk_stbd`), each a bundle of the per-group ethernet legs on that side =
> two bundles total. Confirm that's the intent vs. two redundant bundles per
> switch (failover).
> **Recommendation:** One bundle per switch (two total), as in the §3.2 example.

> [!NOTE]
> **Q3 — Auto-route vs. hand-trace.** This design is fully **manual** tracing
> (operator clicks every waypoint). Should we later add an assisted route
> (shortest surface path from a switch to each group start that stays inside the
> hull)? That's a surface-pathfinding problem (geodesic over the mesh) — real
> work.
> **Recommendation:** Ship manual first; it's predictable and matches how cable
> actually gets pulled. Revisit auto-route only if hand-tracing proves tedious.

> [!NOTE]
> **Q4 — RESOLVED: print at multiple views.** Decided: the export is a
> **printable harness packet rendered from the camera presets**
> (`cameras.yaml`: Front / Side / Aerial / …), each with the wiring profile
> active, assembled with the BOM into `harness.md` + PNGs (§6.6). Markdown +
> images for v1 (prints from any browser, offline-ready); a CaptainPad
> read-only "Harness" tab and one-click PDF remain clean follow-ups.

> [!NOTE]
> **Q5 — PARTIALLY RESOLVED: length comes from a calibrated reference segment.**
> Decided: the sim is **not** assumed to be in real units. The operator sets a
> reference pair of points and the real distance between them, and **all run
> lengths are derived relative to that scale** (§6.1) — uncalibrated scenes
> refuse to report length. *Still to confirm:* the actual stock inventory
> (`powerStockFt` / `dataStockFt`) and the slack factor (15% placeholder) so the
> stock rounding (§6.3) matches what's really in the truck.

---

## 11. Why this respects the codex

- **No fallback behaviors** — invalid `wiring.yaml`, missing node/group, or
  over-max run all **throw / flag loudly**; nothing degrades silently.
- **Imports at top, snake_case files, classes PascalCase** — §8.
- **Offline-ready** — only the vendored THREE; no CDNs/fonts/npm at runtime.
- **Reuses, doesn't reinvent** — surface snap, trace render pattern, profile
  registry, group model are all existing machinery (§2).
- **Serves the mission** — a labeled, measurable harness shortens strike,
  de-risks "is the exterior actually getting power+data," and leaves a
  build-night artifact instead of tribal knowledge.
- **Scratch files to `~/tmp/`** — the exported harness packet (BOM + per-view
  PNGs) lands in `~/tmp/`, not the tree.
- **Honest measurement** — length is calibrated from an operator-set reference
  segment (§6.1), never assumed; uncalibrated scenes refuse to report length
  rather than print a wrong cable order.
