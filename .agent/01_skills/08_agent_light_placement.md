---
description: Place / mirror fixtures in a sim scene (generator traces, aim→rotation, verification)
---

# 🛠️ Agent Light Placement — Adding & Mirroring Fixtures

How to add fixtures to a simulation scene (e.g. the titanic rig) **the way the
sim itself would**, so the result is byte-faithful to a UI-placed generator and
passes every integrity check. Written from the back-deck-vintage placement
(mirroring the front-deck vintage groups across each hull half).

Pair this with `00_see_the_world.md` (rendering) and the codex P0 rules
(no silent fallbacks, restore any temp edits).

---

## 1. How a scene "model" is actually built

`simulation/scenes/<scene>/` is the **source of truth**. The pipeline:

```
scene_config.yaml  ──(generator traces materialize)──►  parLights.fixtures[]
   • traces: &ref_0   (line/circle shape, start/end, spacing, aim, rotOff)
   • fixtures:        (each pixel-fixture, traceGenerated: true)
        │
        ├─ patches.yaml      one entry per fixture (DMX addr; 0 = unpatched)
        ├─ views.yaml        groupBits (one bit per group; 31-bit ceiling)
        └─ (sim Save / export) ──► marsin_engine/models/<scene>.js
                                   + .viewmasks.js + .effects.js  (engine reads these)
```

Key facts:
- **A `trace` is the generator; `fixtures[]` is its materialized output.** Edit
  both together (add a trace AND its fixtures) so the GUI can still regenerate.
- The engine loads the **committed `models/<scene>.js`** — it does NOT read
  scene_config. So after any scene edit you MUST re-export the model (see §6) or
  the engine goes stale. The browser sim regenerates the model live, so the sim
  preview can look correct while the committed model is stale — don't be fooled.
- Each fixture record: `group, name ("<group> N"), fixtureType, color, intensity,
  angle, penumbra, x, 'y', z, rotX, rotY, rotZ, traceGenerated`. **Quote `'y'`**
  (bare `y` is YAML boolean).

Find the generator math in `simulation/src/gui/gui_builder.js`:
`computeTracePoints` (~2344) and the materialize loop (~3150–3342).

---

## 2. Placing fixtures by MIRRORING existing ones

To add a symmetric counterpart (e.g. back deck = mirror of front deck):

1. **Pick the mirror plane** from real scene features. For the titanic halves we
   reflected across the plane between each half's **front-wall and back-wall
   trace midlines**: `C = midpoint(midFrontWall, midBackWall)`,
   `n = normalize(midFrontWall − midBackWall)`.
2. **Reflect** the source trace's `start`, `end`, and `aim` points:
   `P' = P − 2·((P − C)·n)·n`. Reflection is an isometry → spacing is preserved
   automatically.
3. The reflected line gets the **same point layout** (even arclength spacing;
   for N fixtures, sample `t = i/(N−1)`).

Verified result on the titanic back-deck add: position-vs-reflection error
**0.0000 m**, spacing identical to the front rows.

---

## 3. Reproduce the aim→rotation EXACTLY (do not hand-roll it)

Fixture `rotX/rotY/rotZ` come from the trace `aimMode`. For
`aimMode: 'direction'`, port this verbatim (matches `gui_builder.js:3189-3222`;
confirmed to reproduce existing fixtures' rotations to 3 decimals):

```
vecX      = normalize(end − start)              // physical bar along the path
toAim     = aim − midpoint(start, end)
vecMinusZ = normalize(toAim − vecX·(toAim·vecX)) // aim projected ⟂ to the path
vecZ      = −vecMinusZ
vecY      = normalize(cross(vecZ, vecX))
// THREE makeBasis(vecX,vecY,vecZ) then Euler 'YXZ':
m11=vecX.x; m21=vecX.y; m31=vecX.z; m13=vecZ.x; m23=vecZ.y; m33=vecZ.z; m22=vecY.y
rotX = asin(−clamp(m23,−1,1)) · 180/π
if |m23| < 0.9999999:  rotY = atan2(m13,m33);  rotZ = atan2(m21,m22)
else:                  rotY = atan2(−m31,m11); rotZ = 0
// finally add the trace's fixtureRotOffX/Y/Z (degrees)
```

THREE.js is vendored as browser ESM (not Node-resolvable), so for a Node helper
implement the small vector ops + the 'YXZ' extraction directly (above). Always
**validate your port against an existing fixture** before trusting new output.

---

## 4. Materialize cleanly

- **Append** new fixtures at the END of `fixtures:` (and the new trace at the end
  of `traces:`). Appending keeps every existing fixture's pixel index / order
  unchanged on re-export (the diff stays additive).
- Match the existing block's field set + formatting EXACTLY (copy a sibling block;
  same constants: `fixtureType`, `color`, `intensity`, `angle`, `penumbra`,
  `traceGenerated`, and the trace's `fixtureRotOffZ`).
- Add one `patches.yaml` entry per new fixture (all-zero / `controllerIp: ''` if
  the rig is unpatched — keep it 1:1 with fixtures).
- The titanic scene_config uses a YAML anchor (`traces: &ref_0` … `traces: *ref_0`);
  insert into the `&ref_0` definition (the alias inherits it). Prefer **textual
  insertion** for the real edit (preserves the anchor); a js-yaml load→dump is OK
  only for throwaway render-temp files you restore afterward.

---

## 5. Verify (every time)

- `js-yaml` parse of every edited YAML.
- `fixtures` count == `patches` count (1:1); names unique; fixture `group` ==
  its trace `groupName`.
- **Numeric mirror check**: reflect the source fixtures and assert max position
  error ≈ 0 and spacing matches.
- **Render & eyeball** (`00_see_the_world.md`). To prove placement, see §7.

---

## 6. Re-export the engine model (don't skip)

After a scene edit, regenerate `models/<scene>.js{,.viewmasks.js,.effects.js}`
so the engine matches. The exporter runs in the browser
(`pixelblaze_model_exporter.js → saveModelJS()`, POSTs to save-server :6970).
Headless trigger: load the scene in puppeteer, then
`page.evaluate(async () => (await import('/simulation/src/dmx/pixelblaze_model_exporter.js')).saveModelJS())`,
wait a few seconds for the POSTs.

- **Expected large diff**: adding fixtures grows the bounding box, so every
  pixel's normalized `nx/ny/nz` recomputes — the whole model file rewrites. That
  is correct, not corruption (world `x/y/z` and `i:` indices for existing pixels
  stay put if you appended).
- Confirm with `node engine.js --pattern test_const --model <scene> --dry-run`:
  it must load with **no model/viewmask-sidecar mismatch** (the engine throws on
  drift). `0/N pixels patched → render-only` is expected for an unpatched scene.

---

## 7. Seeing ONE group (isolation) — render-only, ALWAYS restore

The sim drives all pixel color from the lighting engine (a static fixture
`color` only shows with lighting OFF, but then nothing emits). The default
titanic `masterExposure` is very low (0.05). So to make new lights legible:

- **To make a group pop in motion/video**: temporarily raise `masterExposure`
  (~0.8) and crank only the target fixtures' `intensity` (e.g. 200) in
  `profile=full` + `lighting_mode=gradient`; the boosted pools blaze.
- **To isolate (everything off but X)**: set every OTHER fixture's `intensity`
  to 0 and the target group's high; disable LED strands and the environment
  (`atmosphere.ambientIntensity`→0, `moonlight.moonEnabled`→false,
  `floods.masterFloodEnabled`→false). Warm the gradient stops for an authentic
  look. `profile=full` (analytic spotlights show the wash; `emissive` is too dim).

These are **render-only**. Back up `common.yaml` + `scene_config.yaml`, edit,
render, then restore — `git status` MUST be clean afterward (codex P0: no silent
residue). The capture browser reads the scene once at page-load, so you can
restore the YAML the moment capture starts and still get the boosted frames.

---

## 8. Gotchas

- Don't hand-compute rotations — port §3 and validate against an existing fixture.
- Re-export the model after scene edits, or the engine silently lags the scene.
- **Rename / regroup BEFORE patching** — renaming after a real controller mapping
  exists orphans the mappings (route renames through the registry rename path).
- The view-mask budget is 31 bits; per-strand bits exhaust it — consolidate
  (operator: "LEDs Left" / "LEDs Right") before adding views.
- Keep scratch (frames, helper scripts, ffmpeg-static) in gitignored `~/tmp/`.

## File reference

| File | Purpose |
|---|---|
| `simulation/scenes/<scene>/scene_config.yaml` | fixtures[] + traces (source of truth) |
| `simulation/scenes/<scene>/patches.yaml` · `views.yaml` | DMX roster · group bits |
| `simulation/src/gui/gui_builder.js` (~2344, ~3150) | trace points + aim→rotation |
| `simulation/src/dmx/pixelblaze_model_exporter.js` | `saveModelJS()` model export |
| `marsin_engine/models/<scene>.js{,.viewmasks.js}` | engine-consumed derived model |
