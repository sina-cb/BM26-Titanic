# 20260725_83 — Moving a generator now moves its fixtures (live == reload)

**Subsystem:** `simulation/` — group generators (traces) and the fixtures they
generate.
**Trigger (operator, 2026-07-30):** *"I moved the Left Small SmokeStack, but the
lights don't move to the new location of the generator. And when I refreshed,
they were way off. Please check the moving of already-patched and generated
instances."*

Two failures, two independent causes, both fixed at the root. There is now
exactly **one** computation of where a generator sits, and everything — the
orange ring, the drag hitbox, the fly-to camera, the preview-dot drag math and
the generated fixtures — reads it.

---

## 1. Root cause A — the LIVE half: "the lights don't move"

`generateGroupFromTrace` did not take a circle generator's anchor from the
trace. It fished the trace's visual `THREE.Group` out of `window.traceObjects`
and used **that object's world matrix** to place the fixtures:

```js
const grp = window.traceObjects[traceIndex]?.group;   // ← the scene graph
if (!isWorldSpace && grp) grp.updateMatrixWorld(true);
const worldMatrix = (!isWorldSpace && grp) ? grp.matrixWorld : null;
```

That is only correct while the group is guaranteed fresh. It was not:

1. **The transform gizmo was never detached across a rebuild.**
   `destroyTraceObjects()` removed every trace group, hitbox and handle from
   the scene and rebuilt them — but nothing told `transformControl` about it,
   so the gizmo went on holding a **hitbox that had been thrown away**. Any
   `rebuildTraceObjects()` did this: editing Radius, Arc, Lights (count), a
   line's Start/End, adding or deleting a generator, an undo.
2. **The drag handler then copied object-to-object.** The circle branch of
   `_onTraceTransformChange` ran
   `tObj.group.position.copy(tObj.hitbox.position)` — the **live** hitbox,
   which the operator was not dragging. Dragging the orphan wrote
   `trace.x/y/z` (from `obj`) while the live group stayed exactly where it
   was. The fixtures, generated from that live group, stayed with it.
   Result: the generator's numbers moved, the ring and the lights did not.
3. **`?.group` was a silent fallback.** With no group at all, `worldMatrix`
   became `null` and a circle's fixtures were emitted at the **raw local ring
   coordinates** — a 4 m ring around the world origin, no error, no warning.
   (Codex P0: no fallbacks. This one placed fixtures in the wrong hemisphere.)

Same class, second front: the generator card's **geometry number fields**
(circle Radius/Arc, line and corner Start/Corner/End X-Y-Z) called
`updateTracePreview()` and stopped there. The orange path moved under the
operator's cursor; the generated fixtures never regenerated. That edit only
"took effect" on the **next reload**, which is precisely the live-vs-reload
divergence the operator hit. (Count, Aim Mode and Fixture Type already
regenerated — the geometry fields were the gap.)

## 2. Root cause B — the RELOAD half: "way off"

`buildTraceObject` rebuilt the circle group with a **falsy** default:

```js
grp.position.set(trace.x || 0, trace.y || 5, trace.z || 0);
```

`0 || 5 === 5`. The Left Small SmokeStack stands **on the deck at y = 0** (its
saved `y` is literally `-0.0` — the gizmo's 0.5 translation snap lands on exact
zero). So on every reload:

- the group and the hitbox were rebuilt **5 m in the air**,
- boot regeneration (`params.traces.forEach(... generateGroupFromTrace)`) read
  that group's matrix and emitted all four fixtures at **y = 5**,
- and because the hitbox was also up there, the next drag wrote `trace.y = 5 +
  delta` — the error was **compounding**, one storey per edit-and-reload cycle.

That is the "way off". The two computations disagreed because they were two
computations: **live read the scene graph, reload read the trace fields with a
falsy default.**

**Blast radius, measured across every scene in the repo:** exactly **one**
generator is affected — `Left Small SmokeStack` in the titanic scene. It is
the only circle trace anywhere with `y == 0`. (`Right Small SmokeStack` sits at
`y = 0.2497`, truthy, and was never hit; line and corner traces have no anchor
at all — their points are absolute.) The operator found the only instance of
the bug in the building.

---

## 3. The fix — one anchor, one direction

### New pure module: `simulation/src/dmx/trace_anchor.js`

The single definition of where a generator sits. No THREE, no DOM, Node-testable.

- `traceAnchor(trace)` → `{x, y, z, rotX, rotY, rotZ}` using **`??`, never
  `||`** — a missing field gets the documented default (`y: 5`, matching the
  New Circle default), a **present 0 gets 0**.
- `traceUsesWorldSpacePath(trace)` — the one place the "line/corner are
  absolute, circle is local" distinction lives.
- `traceFocusPoint`, `anchorDelta`, `anchorsEqual`, `TRACE_ANCHOR_DEFAULTS`.

### `gui_builder.js`

- **`traceAnchorMatrix(trace)` / `applyTraceAnchor(obj3d, trace)`** — the two
  THREE-side consumers of the pure anchor. `applyTraceAnchor` places an object;
  `traceAnchorMatrix` composes the same transform as a matrix. Pinned by test
  to be **bit-identical** to what a `THREE.Group` on the same anchor produces.
- **`generateGroupFromTrace` no longer touches the scene graph.**
  `const worldMatrix = isWorldSpace ? null : traceAnchorMatrix(trace);`
  Live and reload are now the *same function of the same data* — they cannot
  diverge, and there is no `?.` silent-null path left to place a ring at the
  origin.
- **`buildTraceObject`** places the circle group **and** its hitbox with
  `applyTraceAnchor` (no more `|| 5`, no more `hitbox.position.copy(grp.position)`).
- **`_onTraceTransformChange` (circle) is one-directional:** the dragged object
  writes the **trace fields**, then every visual is re-derived from those
  fields. A stale gizmo can no longer desync the group from the hitbox.
- **`captureTraceGizmoTarget` / `restoreTraceGizmoTarget`** — `destroyTraceObjects`
  detaches the gizmo before removing meshes; `rebuildTraceObjects` re-attaches it
  to the **rebuilt** equivalent (same trace index, same handle role). The
  operator's selection survives a rebuild, on a live object. A deleted trace
  leaves the gizmo detached — that is the truth, not a fallback.
- **`onTraceGeometryEdit(controller, i)`** — every geometry field (Radius, Arc,
  Start/Corner/End X-Y-Z) now rides the **same cold-move contract as a gizmo
  drag**: cheap preview on every tick (`markTraceRegenDirty`), exactly **one**
  regeneration on release (`onFinishChange` → `_flushPendingEditorRegens`). No
  regeneration storm during a slider drag (report `_44`'s 2.4 s-per-tick stall
  stays fixed), and no silently deferred edit either.
- **The aim target travels with a circle move**, by the same delta, exactly as
  the line and corner handles already did. A moved ring keeps aiming the way
  the operator placed it instead of pointing back at where it used to be.
  Rotation-only changes produce a zero delta and move nothing.
- **`traceWorldAt`** (preview-dot drag math) and the aim-line origins now use
  `traceAnchorMatrix` too — no consumer of "where is this generator" is left
  reading a THREE object.
- **Deleted:** `writeTraceTransformToConfig` — a second, *uncalled* writer of
  `trace.x/y/z/rot*` that read the hitbox instead of the dragged object. A dead
  duplicate of the exact computation that broke.
- `showToast` is now exported from `controller_map_editor.js` and reused (no
  second toast widget was minted).

### Layout semantics

The generator's own geometry rules **re-run against the new anchor** — this is
not a delta-add. `computeTracePoints` derives the ring from radius/arc/count/
point-offsets in local space and the anchor matrix places it, so spacing,
per-point offsets, corners and chain splits are preserved by construction and a
move is expressible as a pure translation of every fixture (pinned by test).

---

## 4. Hand-tweak policy: **RE-SNAP, loudly** — and why

**Decision: a generator move re-snaps a hand-moved fixture, and names it.**

A trace-generated fixture has **nowhere to keep a manual offset**.
`generateGroupFromTrace` sweeps every `traceGenerated` record of the group away
(`sweepGeneratedInstances`) and pushes brand-new records built from the trace's
geometry. So a hand nudge was already lost on the next Regenerate — and, because
boot regenerates every `generated: true` trace, it **never survived a reload**
either. Carrying it as a delta would mean a new per-fixture field, a new key in
the scene YAML, and a new sweep rule; inventing that silently is exactly the
hidden state the codex forbids, and it would churn `scene_config.yaml` for every
generated fixture in the ship.

So: re-snap, unchanged from today's real behaviour — but **say so**, which is
new. `simulation/src/dmx/generator_hand_tweaks.js` compares the group's
positions before and after a regeneration and names the fixtures that did **not**
move with the rest:

- After a pure move, every fixture displaces by the **same vector**. If one
  displacement is shared by a clear majority (>50%, min 3 fixtures), that vector
  **is** the move, and anything off it was standing somewhere the generator did
  not put it → named, `console.warn` + on-screen toast.
- When **no** such majority exists the layout itself changed (count, radius,
  arc, aim, chain order) and per-fixture displacement carries no information —
  the detector reports **nothing** rather than crying wolf.
- Fixtures dropped by a count shrink are casualties, not re-snaps.

If we ever want to keep the tweak, the honest shape is an explicit,
serialized per-fixture `generatorOffset` — a separate decision, not a silent one.

## 5. What a move must NOT change (all pinned by test)

| Thing | Why it survives |
|---|---|
| Fixture names (`<group> N`) | Emission is unchanged; only x/y/z differ across a move |
| Group name | The move never touches `trace.groupName` |
| DMX patches | Projected sticky-**by-name** from `controllers.yaml`; the name set is invariant |
| Chain splits / numbering | `emitInChainOrder` is fed the same `chainSplits` |
| 2D pixel-map selectors | The views select `group: Left Small SmokeStack` — unchanged |
| 2D per-fixture offsets | Keyed by fixture name, and they are **VIEW-space** layout the operator placed by hand. A world move says nothing about them → **kept verbatim** (default, as briefed) |
| `renderPos` / `localPos` (report `_74`) | Per-**pixel** and **local to the fixture group**. A generator move relocates the group; `renderPos = localPos × modelScale` is computed in one place in `dmx_fixture_runtime.js` and the generator writes neither. Pinned so it stays that way |

**Scene dirty-marking:** every path (drag release, geometry field, regenerate)
goes through `debounceAutoSave()`, which marks the scene dirty even with
auto-save off. Normal save flow. **No scene file was written by this work.**

---

## 6. Repairing the current Left Small SmokeStack — exact steps

**Good news first:** `simulation/scenes/titanic/scene_config.yaml` on disk is
**self-consistent right now**. The trace sits at
`(-46.318, -0.0, 8.6236)`, r = 4, arc 360, count 4, and its four fixtures are at
exactly the ring positions that anchor produces at **y = 0**:

```
Left Small SmokeStack 1  (-42.318, 0,  8.6236)
Left Small SmokeStack 2  (-46.318, 0, 12.6236)
Left Small SmokeStack 3  (-50.318, 0,  8.6236)
Left Small SmokeStack 4  (-46.318, 0,  4.6236)
```

The test suite pins that the fixed code regenerates **exactly these four
positions** from that trace. So the repair is mostly "reload and confirm":

1. **Do NOT save from the tab that is open now.** Its in-memory fixtures are the
   buggy y = 5 set; saving would write the "way off" state to disk.
2. **Hard-refresh the sim** (the fixed code has to load). Boot regeneration now
   places the ring on the deck.
3. **Confirm** on the generator card: fly-to lands on the smokestack base, and
   the four PARs sit at y = 0 on the ring above. (Everything else about the
   group — names, patches, group membership, the Top-Down view entry — is
   untouched.)
4. **Only if they are not there** (i.e. a y = 5 state was saved at some point
   after this file was read): press **↻ Regenerate** on the Left Small
   SmokeStack card **once**. With the fix, that re-places all four from the
   trace anchor. Then save.
5. **From now on**, a drag or a Radius/Arc/Start/End edit re-places the fixtures
   on release, and the next reload lands them in the same place.

Nothing else in any scene changes: Left Small SmokeStack is the **only** trace
in the repo that the falsy default touched.

---

## 7. Tests

New: **`simulation/tests/generator_move_fixture_sync.test.js`** — 25 tests.

- **Falsy default** — `y = -0.0` anchors at 0, an **absent** field still gets the
  documented default, `0°` rotations survive, fly-to frames the deck.
- **One computation** — the anchor matrix and a `THREE.Group` on the same anchor
  are **element-for-element identical**; a move displaces every fixture by
  exactly the move; **serialize → YAML → deserialize → regenerate reproduces the
  live positions** (live == reload pinned); a deliberately **stale** group
  matrix no longer changes the outcome; the deck-level ring reproduces the four
  positions in the real titanic scene.
- **Sticky by name** — names/group/type/chain order byte-identical across a
  move (only x/y/z differ); split numbering preserved; patch keys and 2D
  pixel-map selectors + per-fixture offsets survive.
- **Hand-tweak policy** — a clean move reports nothing; a hand-moved fixture is
  named with the move vector; a layout change (radius) reports nothing; a count
  shrink casualty is not a re-snap.
- **Source contracts** (browser-only wiring) — no falsy anchor default anywhere
  in the GUI; generation calls `traceAnchorMatrix` and reads **no**
  `matrixWorld`; group and hitbox both go through `applyTraceAnchor`; the drag
  branch writes fields then re-derives; the gizmo is detached on destroy and
  restored on rebuild; all 11 geometry fields go through `onTraceGeometryEdit`
  with the dirty-mark + release-flush contract; the re-snap is announced in
  console **and** toast; `renderPos` stays a pure product of `localPos`.

**Suite:** baseline **1366 / 1357 pass / 9 fail** → **1391 / 1382 / 9**.
**+25 tests, +25 passing, zero new failures.** The 9 are the pre-existing
stale-model / live-scene checks (the brief's 8 plus one that the operator's
scene state has since added — present before any edit here, unchanged after).

All touched files parse as ESM (acorn, `sourceType: 'module'`) — note that
`node --check` silently passes broken ESM in this repo and must not be trusted
as a syntax gate for these files.

## 8. Files

| File | Change |
|---|---|
| `simulation/src/dmx/trace_anchor.js` | **NEW** — the one anchor definition (pure) |
| `simulation/src/dmx/generator_hand_tweaks.js` | **NEW** — re-snap detection + message (pure) |
| `simulation/src/gui/gui_builder.js` | anchor helpers; generation off the scene graph; `|| 5` gone; one-directional drag; gizmo detach/restore; geometry fields regenerate; aim follows a circle move; dead `writeTraceTransformToConfig` deleted |
| `simulation/src/gui/controller_map_editor.js` | `showToast` exported (reused, not duplicated) |
| `simulation/src/dmx/trace_regen_scheduler.js` | doc: the GUI-control release seam is a legitimate flush point |
| `simulation/tests/generator_move_fixture_sync.test.js` | **NEW** — 25 tests |

No scene, `marsin_engine/` or git operations. No browser session was opened
against the operator's stack (live-mapping lockdown honoured).
