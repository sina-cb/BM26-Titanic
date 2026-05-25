# Design Document: Dynamic Scenery Models

**Status:** Approved for V1 implementation.

**Approval Notes:** The design is approved with the V1 scope described below. Scenery placement is GUI-driven, not TransformControls/raycasting-driven, and scenery loading must be handled as a dedicated awaited boot step rather than hidden inside `setupLighting()`.

## 1. Objective
Enable the BM26-Titanic simulation engine to dynamically load, position, and manage arbitrary 3D models (FBX, GLTF, OBJ) via `scene_config.yaml`. This will allow environment scenes (e.g., `summer_camp_logsville`) to populate assets like `RedWoodTreeTall4.fbx` without hardcoding them into the core engine.

## 2. Current Architecture & Limitations
*   **Hardcoded Loading:** `simulation/src/core/environment.js` is currently hardcoded to load exactly one FBX model (`2601_001_BURNING MAN HONORARIA_TE.fbx`) when `__activeScene` is `titanic`. For other scenes, it yields a dummy object.
*   **Config Arrays:** The `scene_config.yaml` and `gui_builder.js` successfully utilize declarative arrays for `fixtureArray`, `icebergArray`, and `ledStrandArray`.
*   **Model Fixtures:** The existing `model_fixture.js` does *not* load 3D geometry from files; it constructs primitive geometric shells (cylinders/boxes) based on lighting fixture parameters.

There is currently no array-based infrastructure to define paths to arbitrary 3D models and instantiate them with TransformControls.

## 3. Proposed Architecture

We will implement a "Scenery Models" subsystem that mirrors the architectural pattern used for `icebergArray`.

### 3.1 YAML Configuration Schema
Introduce a new section type: `sceneryArray`. Each item will define the model path, transform coordinates, and material properties.

```yaml
sceneryModels:
  _section:
    label: 🌲 Scenery
    type: sceneryArray
    collapsed: false
  models:
    - name: "Redwood Tree 1"
      path: "../3d_models/redwood_tree/source/RedWoodTreeTall4.fbx"
      x: 15
      y: 0
      z: -10
      rotX: 0
      rotY: 45
      rotZ: 0
      scale: 1.0
      castShadow: true
      receiveShadow: true
```

**Important:** To maintain a consistent runtime shape, `extractParams()` in `config.js` will extract the `sceneryModels.models` YAML array into the flat runtime array `params.sceneryModels`. `reconstructYAML()` will wrap it back into `sceneryModels.models` on save. All runtime code (GUI builders, boot loops) will iterate over `params.sceneryModels`.

### 3.2 SceneryModel Fixture Class & Asset Caching
Create a new file: `simulation/src/fixtures/scenery_model.js`.
*   **Asset Cache & Normalization:** To prevent duplicate memory/parsing overhead, implement a path-keyed asset cache (`const assetCache = new Map();`). Because loaders return disparate types (GLTF returns an object, STL returns BufferGeometry, FBX returns a Group), the dispatcher must **normalize** every load into a standard `THREE.Group` before caching. The system will load/parse an asset exactly once, normalize it, and use `SkeletonUtils.clone()` (or `Object3D.clone()`) to spawn identical instances.
*   **Loader Dispatcher:** Depending on the file extension (`.fbx`, `.gltf`, `.obj`, `.stl`), it will utilize the appropriate Three.js loader (e.g., `FBXLoader`, `STLLoader`). Note for V1: `.stl` and `.obj` are treated as untextured geometry-only formats; the dispatcher must automatically wrap their geometry in a `MeshStandardMaterial` during normalization so they are visible and react to light.
*   **Bounding Hitbox:** Upon loading, it will compute the `THREE.Box3` of the loaded geometry and create an invisible `BoxGeometry` hitbox for internal bounds/placement calculations. In V1, scenery hitboxes must not be pushed into `interactiveObjects`; scenery is placed through GUI sliders, not TransformControls/raycasting. If interactive scenery editing is added later, it should use a dedicated `isScenery` path in `interaction.js`.
*   **Material Pass:** For textured formats (`.fbx`, `.gltf`), we will **not** aggressively override materials to `structureMaterial` or `editMaterial`, as doing so destroys native leaf/bark textures and opacity maps on the trees. The native materials from the FBX will be preserved. For untextured formats like `.stl` and `.obj`, the generated default material can optionally use `structureMaterial` to blend with the scene.
*   **Pivot Offsets (Centering):** External assets often have unpredictable origins. To fix pivot points without mutating shared cached geometry buffers, the `SceneryModel` should use a per-instance "wrapper group" hierarchy to apply visual offsets relative to the hitbox.
*   **Disposal (`destroy()`):** Because cloned instances share underlying geometry and materials, the instance's `destroy()` method must **not** call `.dispose()` on the meshes. It must only remove the clone and hitbox from the scene.
*   **Methods:** `syncFromConfig()`, `writeTransformToConfig()`, `destroy()`, `setVisibility()`.

### 3.3 GUI Builder Integration
Update `simulation/src/gui/gui_builder.js` to parse `sceneryArray`:
*   Create a `buildScenerySection(parentFolder, sectionConfig)` function.
*   Add GUI sliders for X, Y, Z, RotX, RotY, RotZ, and Scale.
*   Listen to `onChange` events to trigger `fixture.syncFromConfig()`.

### 3.4 Boot Sequence (`environment.js`)
Update `onModelLoaded()` in `environment.js` to instantiate the scenery array through a dedicated awaited helper such as `loadSceneryModels()`.
*   Similar to `window.icebergFixtures = []`, initialize `window.sceneryFixtures = []`.
*   Iterate over the flat array `params.sceneryModels`.
*   **Scene Bounds:** Scenery is considered *decorative*. It will not contribute to the scene's bounding box computation (`modelRadius`) or camera/lighting setup limits, which will continue to be driven by the main central model.
*   Because loading FBX/GLTF files is asynchronous and can take time, the loading loop should yield to the UI to keep the `updateLoading()` progress bar responsive.
*   Do not move scenery loading into `setupLighting()`. That function is synchronous today and is called before camera positioning and GUI setup; scenery should be loaded at an explicit awaited point before `setupGUI()` if GUI controls need live fixture instances.

## 4. Implementation Steps

1.  **Update Config Parsing:** Modify `config.js` and `state.js` to properly extract and reconstruct the `sceneryModels` array.
2.  **Create `scenery_model.js`:** Implement the class shell, asset caching, and integration with `FBXLoader`.
3.  **Update `gui_builder.js`:** Implement the `sceneryArray` builder loop and tie it to `window.sceneryFixtures`.
4.  **Integrate Loader:** In `environment.js`, add the loop to instantiate `SceneryModel` objects using the asset cache.
5.  **Scene Configuration:** Add the 10-15 redwood trees to `simulation/scenes/summer_camp_logsville/scene_config.yaml`.

## 5. Potential Gotchas
*   **Asynchronous Loading:** Large FBX files (like trees) will pause the main thread during parsing. We must ensure `loadAsync` is awaited properly during the boot sequence without breaking the loading screen.
*   **Origins:** External FBX files often have unpredictable origins (e.g., the pivot point might be way off-center). The `SceneryModel` class may need a config toggle (e.g., `centerOrigin: true`). To avoid mutating shared cached geometry, it must center the model using a per-instance wrapper group's position offset.
*   **Performance:** Using an Asset Cache guarantees we only parse the tree once, greatly saving boot time and memory. V1 will use standard object cloning (`clone()`), which is stable and performant enough for 15 trees, avoiding the complexity of merging textures into an `InstancedMesh`.
