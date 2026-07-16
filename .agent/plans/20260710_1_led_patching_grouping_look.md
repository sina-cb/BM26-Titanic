# 2026-07-10 — LED patching parity, grouping, and pixel look (plan)

**Branch:** `feat/led_integration` (worktree `kind-banach-95157b`).
**Parent plan:** `.agent/plans/20260709_0_led_integration_execution.md` (P1–P6 +
Round 2 all landed; sim suite baseline **200 pass / 0 fail**, verified
2026-07-10 in this worktree).
**Device reference:** `docs/41_led_controller_onboarding.md` — the MarsinLED
sACN receiver is **single-base-universe LINEAR** across enabled outputs; there
is no per-output universe on the device. The operator has decided universe
setting is **MANUAL per output** and accepts responsibility for matching the
device. Never "fix" their universes silently.
**Laws:** codex P0 (no fallbacks, fail loud, imports at top, snake_case),
`.agent/os/nodejs_style.md`, `.agent/os/ui_design.md` (tokens not literals,
compact UI). **Preserve all existing DMX behavior untouched.** Every slice
keeps `simulation/ npm test` green and adds tests.
**Hard constraint:** NO live POST to `10.x.x.201` from any agent — the
operator runs every device push. Read-only GETs only if explicitly needed
(prefer mocks).

Current live scene state (test_bench, do not hand-edit — operator owns it):

- `controllers.yaml`: DMX `Test Bench 1` (U1/U2) + LED `MarsinLED_0`
  (`ip 10.x.x.201`, ports 1–4 pre-allocated **U6/U7/U8/U9**, port 1 chains
  `LED_0`, `led.baseUniverse: 0` ⇒ currently a `led_unallocated_base`
  violation, no `device:` block — the operator created it manually, unbound).
- `patches.yaml`: DMX sections **1..4** in use (Par=1, Vintage=2, Bar=3,
  effects=4), fixtureIds 1..10. No LED strand record.
- `scene_config.yaml` `ledStrands.strands`: one strand `LED_0` (20 px) with
  `sectionId: 0, fixtureId: 0, viewMask: 0` persisted structurally.

---

## REQUIREMENT A — LED fixture visual look (sim rendering, preview-only)

### Code analysis (verified file:line)

Per-LED build, `simulation/src/fixtures/led_strand.js::rebuildVisuals`
(lines 110–157), creates **3 meshes × ledCount**, each with a fresh geometry
AND material every rebuild:

1. **Housing — the dark core the operator sees.** Lines 114–129:
   `new THREE.CylinderGeometry(0.04, 0.05, 0.06, 6)` — **6 radial segments =
   the hexagonal silhouette** — with
   `MeshStandardMaterial({ color: 0x222222, roughness: 0.9, metalness: 0.3 })`.
   It is **never recolored**: `setLedColorRGB` (lines 224–238) writes only
   `children[baseIdx+1]` (bulb) and `children[baseIdx+2]` (halo), skipping
   `children[baseIdx]` (housing). A near-black standard-lit mesh under the
   night scene (`scene.background 0x030310`, ACES exposure **0.55** —
   `simulation/main.js:106-107`) renders as a dead black hex plug in the
   middle of every pixel.
2. **Bulb.** Lines 133–139: `SphereGeometry(0.05, 8, 8)` with
   `MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })`. Because
   it is **transparent**, it alpha-blends over whatever is behind it — i.e.
   the dark housing occupying the same position (housing radius 0.04–0.05 ≈
   bulb radius 0.05, so they z-fight/interpenetrate) — tinting the pixel core
   dark. Transparent-queue sorting against the halo adds shimmer.
3. **Halo.** Lines 145–156: `SphereGeometry(0.12, 8, 8)`, additive,
   `opacity: 0.15`, `depthWrite: false` — too faint to read as a glow, and
   `FrontSide` (default), unlike the DMX halo.

**DMX comparison — the look we should match**
(`simulation/src/fixtures/dmx_fixture_runtime.js`):

- Bulb: `MeshBasicMaterial({ color, depthTest: false })` (line 208) —
  **opaque**, no transparency, draws over its shell. No per-pixel dark part
  sits inside the emitter.
- Halo: lines 227–234 — additive, `opacity: 0.2`, `depthWrite: false`,
  **`side: THREE.BackSide`** (only the far hemisphere renders → a soft rim
  with no hard front edge), scaled by **`params.globalHaloScale`**.
- Geometry is shared/cached: `bulbGeo = SphereGeometry(0.5, 6, 4)` (line 31),
  `getCachedSphere(size)` (lines 34+) — deliberate low-poly (comment at
  lines 23–26: segments are invisible at model scale, every one saved is FPS).

**Post pipeline** (`simulation/main.js`): WebGPURenderer (line 85), ACES
tone-mapping exposure 0.55 (106–107), TSL bloom `strength 0.35 / radius 0.3 /
threshold 0.92` added to the scene pass (144–153). A full-brightness
`MeshBasicMaterial` (color ≤ 1.0) sits right at the bloom threshold; DMX
pixels read as glowing because bulb+halo+beam stack, while the LED strand's
lit area is tiny and half-eaten by the dark housing.

**Handles/guides:** endpoint handles are `SphereGeometry(0.3)` spheres
(lines 5–7, 25–34), pushed into `interactiveObjects` for dragging
(`src/core/interaction.js:190,398` route by `userData.isLedStrand`).
`_guidesVisible` defaults **true** (line 19); `setGuidesVisible`
(266–269) already hides wire + handles ("pixels only" view) and is wired to a
GUI toggle (`gui_builder.js:4046`). At 0.3 world units the handles are ~6×
the bulb radius — they visually swallow short strands.

**Latent bug:** `setLedColorRGB` hardcodes `ledStartIdx = 2` ("skip wire +
tube", line 227) — but both wire and tube are only created when
`length > 0.01` (lines 71, 84), so a degenerate strand mis-indexes children.
The Slice-A rewrite removes child-index arithmetic entirely.

**Perf:** 3 draw calls + 3 geometry + 3 material allocations per LED per
rebuild. A Titanic-scale rig (hundreds–thousands of px) needs instancing.

### Plan (Slice A)

All changes are **preview-only** — zero contact with config data, patching,
export, or the `setLedColorRGB/RGBWAU` call contract (animate.js and the
exporter's `apply` closures keep working unchanged).

1. **Delete the housing entirely.** No dark core, no replacement mesh.
2. **Instanced pixels.** Replace the per-LED bulb/halo meshes with **two
   `THREE.InstancedMesh`es per strand** (rebuilt on `rebuildVisuals`):
   - `bulbInst`: shared unit low-poly sphere (`SphereGeometry(1, 6, 4)`,
     module-level constant like the DMX `bulbGeo`), per-instance matrix =
     position + uniform scale (~0.05), material
     `MeshBasicMaterial({ color: 0xffffff })` — **opaque**, and set
     `material.toneMapped = false` so a full-bright pixel punches through
     ACES 0.55 and reliably crosses the 0.92 bloom threshold (this is the
     "LED point source" look; keep it a named constant so the artist can
     tune).
   - `haloInst`: same shared geometry, per-instance scale ~0.14 ×
     `params.globalHaloScale`, material
     `MeshBasicMaterial({ transparent: true, opacity: 0.2,
     blending: AdditiveBlending, depthWrite: false, side: BackSide })` —
     byte-for-byte the DMX halo recipe (dmx_fixture_runtime.js:227-234).
   - Colors: `setLedColorRGB(index, …)` → `setColorAt(index, color)` on both
     + `instanceColor.needsUpdate = true` (batch the flag per frame: set a
     dirty bit, flush in a tiny `flushColors()` the existing callers hit
     naturally since they loop all pixels each frame — or simply mark
     needsUpdate every call; measure, keep simplest that's smooth).
     `setLedColorRGBWAU` unchanged (mix then delegate).
   - Keep the strand's base `config.color` as the initial instance color.
3. **Guides out of the beauty render.** Default `_guidesVisible = false`;
   `setSelected(true)` (from drag/pick or opening the strand's GUI folder —
   `window.openStrandFolder`, gui_builder.js:4078) force-shows wire +
   handles + tube while selected; the existing GUI "guides" toggle still
   force-shows them globally for edit sessions. Shrink handles to ~0.12 and
   drop idle opacity (0.7 → 0.45). Handles stay in `interactiveObjects`
   permanently; verify the sim's raycast path ignores invisible handles (if
   `interaction.js` hits hidden handles, gate on `handle.visible` at the hit
   site — that is the only permissible `interaction.js` touch in this slice).
4. **Dispose correctly.** Instanced meshes disposed in `destroy()`/rebuild;
   shared geometry never disposed (module constant, same pattern as the DMX
   runtime and the current `handleGeo`).

**Tests** (`simulation/tests/led_strand_visuals.test.js`, new — `three`
imports work under node:test, no renderer needed):
- constructing a strand yields no `MeshStandardMaterial`/housing children;
- exactly 2 InstancedMeshes with `count === ledCount`;
- `setLedColorRGB(3, 1, 0, 0)` lands in `instanceColor` at instance 3 on
  bulb + halo; RGBWAU white mix matches `mixRgbwauToRgb`;
- guides default hidden; `setSelected(true)` shows handles; degenerate
  (zero-length) strand builds and recolors without throwing (regression for
  the `ledStartIdx` bug);
- `destroy()` leaves scene + interactiveObjects clean.

**Operator checkpoint (no device):** visual pass in the sim — pattern running
on LED_0, close-up screenshot; approve the look (bulb scale / halo scale /
toneMapped punch are the three tunables).

---

## REQUIREMENT B — auto-assignment of sectionId / controllerId / fixtureId

### Code analysis — how DMX gets its ids today

- **The live path is NOT `autoPatchAll`.** `auto_patcher.js::autoPatchAll`
  (lines 188–297, with `assignMetadata` at 247–264) has **zero callers** —
  the header comment of `controller_registry.js` (line 10-11) says the
  registry projection "replac[ed] … the auto-patcher". Only
  `gatherAllConfigs` (auto_patcher.js:55–71) and `clearMetadata` (306–319)
  are still imported (`gui_builder.js:29,1340-1341,3361`;
  `controller_map_editor.js:55,120`).
- **Metadata assignment lives in
  `controller_registry.js::projectOntoConfigs` (1622–1688)**, called via
  `window.projectControllerMappings` (main.js:382–416) with
  `gatherAllConfigs(params)` — which collects `params.parLights`,
  `window.dmxSceneFixtures[*].config`, `params.dmxFixtures`, and **never
  `params.ledStrands`**. The algorithm (1662–1685):
  - seed `groupToSectionId` from configs that already carry a positive
    `sectionId` (sticky — existing ids are never renumbered);
  - `maxSectionId` / `maxFixtureId` = max over all configs;
  - every config with a `group` and no positive `sectionId` gets
    `groupToSectionId[group] ??= ++maxSectionId`;
  - every config without a positive `fixtureId` gets `++maxFixtureId`;
  - `controllerId` = owning controller's **1-based panel ordinal** from
    `computeProjection` (1276+, docs/33 decision 20).
  - Gate: `registryIsActive(registry)` (1623) — no controllers ⇒ no-op.
- **Counters are not persisted** — they are re-derived from the configs on
  every projection pass; stickiness of already-assigned ids is what makes the
  result stable across reloads. Persistence: save-server extracts
  `sectionId/fixtureId/viewMask` per DMX fixture into `patches.yaml`
  (save-server.js:200–223); boot re-applies via `window.applyPatches`
  (main.js:507–518), then re-projects after `initRegistry`
  (main.js:599–612).
- **LED strands today:** created with
  `controllerId: 0, sectionId: 0, fixtureId: 0, viewMask: 0`
  (gui_builder.js:4110) and editable in the 🔖 Metadata (V2) panel
  (gui_builder.js:53–115, attached at 4178). **Nothing auto-assigns them.**
  Their metadata persists **structurally in `scene_config.yaml`** (the
  save-server strand extraction, save-server.js:226–254, strips only the six
  patch fields — `controllerIp/controllerId/dmxUniverse/dmxAddress/
  pixelCount/outputIndex` — leaving sectionId/fixtureId/viewMask in the scene
  tree; visible in test_bench's `LED_0`). That persistence channel already
  works; keep it (assignment parity is the requirement, not file parity).
- `window.projectLedStrandPatches` (main.js:425–463) projects **patch fields
  only** (from `computeLedStrandPatches`, bound controllers only) — no
  metadata. It is ALWAYS called **after** `projectControllerMappings`:
  boot main.js:603–609; editor `controller_map_editor.js:158–181` — this
  ordering is the natural enforcement point for "DMX first".
- **Consumers of the ids:** exporter emits `cId/sId/fId` per pixel — DMX at
  pixelblaze_model_exporter.js:92–94 and 154–156, LED at 349–351
  (`sId: strand.sectionId || 0` — already wired, just never non-zero);
  animate.js packs them into the engine batch (`_batchMeta`, lines 173–176);
  the engine model files carry them per pixel.
- **BUG found:** `pixelblaze_model_exporter.js:155` calls
  `resolveSectionId(light)` — **defined nowhere in the repo** (only
  occurrence). The simple single-`fixture.light` branch would throw
  `ReferenceError` if ever taken. Fix to `light.sectionId || 0` (Slice C owns
  the exporter).

### Plan (Slice C2 — "led_metadata")

New pure module **`simulation/src/dmx/led/led_metadata.js`** (no DOM, no
I/O — the testable seam):

```js
groupKeyForStrand(strand)            // strand.group || strand.name  (see Req C)
assignLedStrandMetadata(strands, dmxConfigs)
  // 1. floor = max(sectionId over dmxConfigs ∪ strands),
  //    fixtureFloor = max(fixtureId over dmxConfigs ∪ strands)
  //    — DMX ids are FINAL by the time this runs (call-order contract below),
  //    so every new LED id is strictly greater than every DMX id:
  //    mutually exclusive AND monotonically increasing (DMX 1..N ⇒ LED N+1..).
  // 2. seed ledGroupToSectionId from strands already carrying a positive
  //    sectionId (sticky, mirror of projectOntoConfigs:1667-1669).
  // 3. walk strands in params.ledStrands array order (deterministic — scene
  //    YAML order): a strand with no positive sectionId gets
  //    ledGroupToSectionId[groupKey] ??= ++floor; no positive fixtureId ⇒
  //    ++fixtureFloor.
  // Returns { assigned: [...], maxSectionId, maxFixtureId } for logging.
```

Wire-up (**`simulation/main.js`** only): at the end of
`window.projectLedStrandPatches` (after the patch-field loop, before
`return`), when `registry && registryIsActive(registry)` (the same gate DMX
uses), call
`assignLedStrandMetadata(strands, gatherAllConfigs(params))` and mirror the
ids into `window.__globalPatchTree` is **not** needed (strand metadata rides
scene_config.yaml — document this in the call-site comment). Imports at top
of main.js (`gatherAllConfigs` from `./src/dmx/auto_patcher.js`,
`assignLedStrandMetadata` from `./src/dmx/led/led_metadata.js`).

**Where the shared counter lives / ordering enforcement:** nowhere
persistent — exactly like DMX, the "counter" is the max over already-assigned
ids, re-derived per pass. DMX-before-LED is enforced **by construction**:
(a) `projectOntoConfigs` never sees strands (`gatherAllConfigs` excludes
them — do not change it), so DMX numbering is untouched by this work; and
(b) `projectLedStrandPatches` — the only caller of the LED pass — runs
strictly after `projectControllerMappings` at every call site (boot
main.js:603→609, editor recompute 158→181). Both group namespaces are
disjoint maps, so a DMX group named like an LED group can never share an id.
On the live test_bench this yields: DMX sections 1–4 (unchanged, sticky from
patches.yaml), `LED_0`'s group → **section 5**, `LED_0` → fixtureId 11.

`controllerId` for strands is already correct and out of scope: bound
controllers project the panel ordinal via `computeLedStrandPatches`
(led_patch_projection.js:103,172), unbound via `computeLedProjection`
(controller_registry.js:1155,1196) at export time.

**Tests** (`simulation/tests/led_metadata.test.js`, new):
- DMX 1..4 + two LED groups ⇒ sections 5 and 6, in strand order;
- sticky: pre-assigned strand ids survive re-runs; re-run is idempotent;
- same group name in DMX and LED ⇒ different ids (namespace isolation);
- fixtureId continues after the DMX max; gaps in DMX ids respected
  (floor = max, not count);
- strands with no group key (empty name) → loud throw (fail loud, no
  fallback id).

---

## REQUIREMENT C — LED groups (fixed, named — no generators)

### Code analysis — how DMX groups work

- A DMX group is nothing but the **string field `config.group`** on each
  fixture, persisted structurally in `scene_config.yaml` (save-server strips
  only patch/metadata fields). Default `'Default'`
  (gui_builder.js:1366-1368). There is **no groups registry** — the group
  set is the set of distinct values.
- GUI: the Lights panel renders per-group folders (gui_builder.js:1387+),
  rename carries the view bit via `renameGroupBit`
  (gui_builder.js:1728–1740 → view_registry.js:193–211), "move to group"
  dropdown (2112–2128), "new group" (2149–2158). Trace-generated groups are
  read-only (1402+).
- **group → sectionId:** one section per group, assigned in
  `projectOntoConfigs` (see Req B).
- **group → views/masks:** the exporter stamps `pixel.group`; the save flow
  runs `reconcileGroupBits(registry, listPixelGroups(pixels))`
  (view_registry.js:147–191) — every distinct non-empty pixel group gets a
  stable power-of-two bit in `views.yaml`/the `groupBits` sidecar; the engine
  (`marsin_engine/lib/model_loader.js`, `strand_views.js`, `auto_views.js`,
  `mask_registry.js`) validates and consumes exactly that set.
- **LED strands today:** `pixel.group = strand.name` — hardcoded at
  pixelblaze_model_exporter.js:344 — every strand is its own group of one.

### Plan (Slice C1 — schema + UI + export tag)

Deliberately minimal — mirror the DMX shape, no registry, no generators:

1. **Schema:** a `group` string field on the strand config, persisted
   structurally in `scene_config.yaml` exactly like DMX `config.group` (no
   save-server change needed — non-patch strand fields already stay in the
   tree). New strands (gui_builder.js:4103-4111) add `group: ''`.
2. **Semantics (single documented rule):** the strand's effective group is
   **`strand.group || strand.name`** — an ungrouped strand remains its own
   group, which preserves the current exported model bit-for-bit for every
   existing scene (no migration, no fallback-on-error — a defined default
   semantic). Implemented once in `groupKeyForStrand`
   (led_metadata.js, Req B) and used by both the exporter and the metadata
   pass so section numbering and view bits can never disagree.
3. **Exporter:** pixelblaze_model_exporter.js:344 →
   `group: groupKeyForStrand(strand)` (import at top). Everything downstream
   (reconcileGroupBits, views.yaml, engine groupBits, auto_views) picks the
   named group up with **zero further changes** — grouped strands share one
   bit and one section, i.e. "always work together".
   Also fix the **`resolveSectionId` ReferenceError** here (line 155 →
   `light.sectionId || 0`) — exporter file ownership, one-line latent-crash
   fix, DMX behavior for the multi-pixel path unchanged.
4. **UI (edit in the strand folder, `buildLedStrandsSection`):** a "Group"
   text input with a `<datalist>` of existing strand groups (distinct
   `groupKeyForStrand` values) right under "Name"
   (gui_builder.js:4145+), `onFinishChange → debounceAutoSave()` +
   `invalidateMarsinBatchCache`. Renaming a group (editing the field on its
   member strands) lets `reconcileGroupBits` retire/assign bits naturally;
   carrying a bit across a rename via `renameGroupBit` is a follow-up if the
   operator asks (DMX parity exists for it) — file it on the Notion board,
   don't build it now.
5. **test_bench:** the operator creates ONE group (e.g. `bench`) containing
   `LED_0` **through the UI** — the scene files are not hand-edited by
   agents (P6 rule). Titanic scene later: `left smokestacks` /
   `right smokestacks` the same way.

**Tests** (extend `simulation/tests/pixelblaze_model_exporter_local_index.test.js`):
- strand with `group: 'bench'` exports every pixel with `group 'bench'`;
- two strands sharing a group export one distinct group (and, with Slice C2
  landed, one shared sId);
- strand without `group` still exports `group === strand.name` (regression);
- the fixture.light branch no longer references an undefined symbol (direct
  unit call or source assertion).

---

## REQUIREMENT D — manual per-output universes for MarsinLED controllers

### Code analysis

- **Ports already carry a universe.** Registry schema `{ port, universe,
  startAddress, chain }` (controller_registry.js:388–394); `addPort`
  auto-allocates `nextFreeUniverse` (921–927). The operator's live LED
  controller already has ports U6/U7/U8/U9 — the storage exists; it is just
  ignored and uneditable for LED.
- **UI:** DMX ports render an editable universe input with validation and
  `noteUniverseUsed` on manual set (controller_map_editor.js:975–995). LED
  ports render a **read-only** `P<n> · U<base>` label
  (renderLedPort, 836–842) where
  `baseU = led.baseUniverse > 0 ? led.baseUniverse : port.universe` (837).
- **Device-linear flows ignore `port.universe` entirely** — everything runs
  from `controller.led.baseUniverse` + `led.startAddr`:
  - patch records: `computeLedStrandPatches`
    (led_patch_projection.js:110–130, cursor init 129–130);
  - push payload: `deriveDeviceConfig` → `dmx.universe = led.baseUniverse`,
    `startAddress = led.startAddr` (device_config_mapper.js:181–190);
  - port preview: `deriveLayoutPreview` (led_discovery_panel.js:124–147);
  - allocation: `ensureBaseUniverse` (163–173) and create-from-device
    (344–346) allocate `led.baseUniverse` via `nextFreeUniverse`.
- **Collision surfaces available today:** DMX occupancy via
  `computeProjection(...).universeMaps` (controller_registry.js:1241,
  1600); LED spans via `computeLinearLayout` segments
  (device_config_mapper.js:221–328). `nextUniverse` high-water mark via
  `noteUniverseUsed` (507–512).
- Firmware truth (docs/41 §3): pixels stream linearly from ONE
  `(dmx.universe, dmx.startAddress)` across enabled outputs, spilling at 512
  by whole pixels. Output k's real universe is therefore **derived** from
  cumulative counts — a manual per-output universe is honorable **iff** the
  linear layout happens to land output k exactly there (e.g. 128-px RGBW
  outputs aligned to universe boundaries: U6/U7/U8/U9 IS honorable; 40-px
  outputs are not — output 2 really sits at U6 ch161).

### Plan (Slice D)

**Model: the manual per-output universe is the operator's declared intent;
the device-linear layout stays the single truth for patches/export/engine.**
Sim, patches.yaml, engine model and hardware must stay byte-for-byte in
agreement (the whole point of P2/P5); the manual fields re-anchor the BASE
and are loudly validated per output — never silently rewritten, never
blocking.

1. **Editable per-output universe on LED ports**
   (`controller_map_editor.js::renderLedPort`): the same input recipe as DMX
   ports (975–995) — bounds 1–MAX_UNIVERSE, `noteUniverseUsed` on manual
   set, mutate/undo/save pipeline. The port label becomes
   `P<n> · U<input> · <strands>`.
2. **Base derivation change** (the one semantic change, applied identically
   in all three device-linear flows):
   **base universe = the FIRST ENABLED output's `port.universe`** (ports
   sorted by port number, "enabled" = chain has ≥1 strand); start address
   stays `led.startAddr`.
   - `computeLedStrandPatches` (led_patch_projection.js): cursor starts at
     `(firstEnabledPort.universe, led.startAddr)`; the
     `led_unallocated_base` violation becomes "first enabled output has no
     valid universe" (loud, strands project unpatched — same recovery
     contract).
   - `deriveDeviceConfig` (device_config_mapper.js): `dmx.universe` = same
     derivation. The controller argument already carries `ports`; no
     signature change.
   - `deriveLayoutPreview` + `ensureBaseUniverse` (led_discovery_panel.js):
     preview from the same base; `ensureBaseUniverse` becomes
     `ensurePortUniverses` (allocate any port with universe ≤ 0 via
     `nextFreeUniverse` — create-from-device already gives every port a
     fresh universe through `addPort`, so this is only a repair path).
   - `led.baseUniverse` **stays in the schema** (normalizeLedConfig
     untouched; unbound generic projection `computeLedProjection` and legacy
     files keep working unchanged), but bound/device flows stop reading it.
     The LED config sub-panel (controller_map_editor.js:736–744) drops the
     editable "U" input for LED controllers and shows the derived base
     read-only (`base = U<first enabled port>`); `@ startAddr` input stays.
   - Immediate effect on the live scene: `MarsinLED_0` stops violating
     (base U6 from port 1) — `LED_0` patches to **U6:1–80**, exactly what
     the operator set.
3. **Validation — warn loudly, never block, never rewrite** (new pure
   function in led_patch_projection.js, e.g.
   `validateLedManualUniverses(registry, strandCounts, dmxUniverseMaps)`
   returning `Array<{code, controllerId, port, message}>`):
   - `led_universe_unhonorable`: enabled output k's derived linear span
     (from `computeLinearLayout` segments) is not entirely inside the
     manually set `port.universe` — message states BOTH sides precisely:
     `"P2 is set to U7, but the device is single-base linear and will drive
     these pixels at U6 ch161–320 — set P1's strand count to a universe
     boundary (128 px RGBW) or accept the device layout"`.
   - `led_universe_collision`: a manual LED universe (or a derived spill
     universe) overlaps a DMX port universe (`computeProjection
     universeMaps`) or another LED controller's derived span.
   - `led_universe_duplicate`: two outputs of the same controller declare
     the same universe while their derived spans differ.
   Rendered as **warning chips** (existing `cm-error-chip` styling family;
   add a `cm-warn-chip` token-based variant) on the port rows and summarized
   in the push dialog. `console.error` per finding (loud), but projection
   and push proceed — the operator owns the choice.
4. **Device push derivation + non-contiguous behavior — recommendation:
   WARN AND PUSH base = first enabled output's universe** (not refuse).
   Justification: (a) the operator explicitly owns universe matching — a
   refusal would block the legitimate boundary-aligned fleet layout
   (U6/U7/U8/U9 with 128-px outputs) and every intermediate experiment;
   (b) the confirm dialog already shows the exact `{strands, dmx}` JSON
   (led_discovery_panel.js:572–574) — extend it with a red warning block
   listing, for every output whose manual universe the device cannot honor,
   the universe+channels the device WILL actually use (from
   `computeLinearLayout`), so the divergence is unmissable at the moment of
   commitment; (c) refusing is reserved for what the device itself rejects
   (`validatePushPayload` bounds stay as-is). "Push all" surfaces the same
   warnings per controller in its summary. No change to
   `pushDeriveVerifyRecord`'s read→derive→validate→diff→push→awaitReboot→
   verify contract; the engine-yaml snippet (505–511) now lists the derived
   universes including spills.
5. **patches.yaml / exporter / engine:** no format change — strand records
   keep `controllerIp/controllerId/dmxUniverse/dmxAddress/pixelCount/
   outputIndex` (save-server.js:234–242), now computed from the new base.
   The exporter's device-linear override (pixelblaze_model_exporter.js:
   270–301) consumes `computeLedStrandPatches` output unchanged.

**Tests** (extend `led_patch_projection.test.js`,
`device_config_mapper.test.js`, `led_device_binding.test.js`,
`led_controller_ui_round2.test.js` — all mock, no device):
- base = first enabled port's universe (port 1 empty ⇒ port 2's universe);
- golden .201 shape: ports U6..U9, 2×40 px ⇒ strand A U6:1, strand B U6:161,
  plus ONE `led_universe_unhonorable` warning naming P2/U7 and the real span;
- honorable case: 2×128 px RGBW on U6/U7 ⇒ zero warnings, strand B U7:1;
- collision: LED U2 vs the DMX bench universe ⇒ `led_universe_collision`;
- duplicate universes across outputs ⇒ warning;
- `deriveDeviceConfig` pushes `dmx.universe = 6` for the .201 shape;
  first-enabled-port-without-universe ⇒ throws (fail loud);
- `derivePushPayload` unchanged contract (R4 tests keep passing with the new
  base derivation);
- warnings never empty the `fields` map (projection proceeds).

---

## Slice breakdown (Opus-implementable, file-disjoint, dependency-ordered)

| # | Slice | Owns (exclusive file zone) | Depends on | Operator checkpoint |
|---|---|---|---|---|
| **S1** | **LED pixel look** (Req A) | `simulation/src/fixtures/led_strand.js`; NEW `simulation/tests/led_strand_visuals.test.js`; (only if raycast hits hidden handles: a one-line `visible` gate in `src/core/interaction.js`) | none | **Yes (sim-only):** visual approval of bulb/halo/punch on LED_0; no device |
| **S2** | **LED groups + exporter tag** (Req C1 + `resolveSectionId` fix) | `simulation/src/gui/gui_builder.js` (strand group input + default field); `simulation/src/dmx/pixelblaze_model_exporter.js`; `simulation/tests/pixelblaze_model_exporter_local_index.test.js`; NEW `simulation/src/dmx/led/led_metadata.js` (ONLY `groupKeyForStrand` stub + its test seed, so S3 imports a stable symbol) | none | No |
| **S3** | **LED section/fixture metadata** (Req B) | `simulation/src/dmx/led/led_metadata.js` (full `assignLedStrandMetadata`); `simulation/main.js` (call at end of `projectLedStrandPatches` + top-level imports); NEW `simulation/tests/led_metadata.test.js` | **S2** (groupKeyForStrand + group semantics) | No (verify via exported model: DMX sId 1–4 unchanged, LED group → 5) |
| **S4** | **Manual per-output universes** (Req D) | `simulation/src/dmx/led/led_patch_projection.js`; `simulation/src/dmx/led/device_config_mapper.js`; `simulation/src/gui/controller_map_editor.js`; `simulation/src/gui/led_discovery_panel.js`; `simulation/style.css` (warn-chip token variant); tests: `led_patch_projection.test.js`, `device_config_mapper.test.js`, `led_device_binding.test.js`, `led_controller_ui_round2.test.js` | none hard (parallel-safe with S1–S3 — zero file overlap); merge **after S3** so the full-suite count moves once | **Yes (device):** see below |
| **S5** | **Integration + bench pass** | no exclusive files: full `npm test`, model re-export sanity, `.agent/skills/see_the_world.md` screenshots, dated report | S1–S4 | **Yes:** full operator flow |

S1, S2 and S4 can run **concurrently** (disjoint files; S2's led_metadata.js
stub is the only shared-name file and S4 never touches it). S3 starts when S2
lands. Every slice runs `cd simulation && npm test` (baseline 200) and leaves
it green with its additions.

**S4 operator device test (device reboots — operator only, ~10 s per push):**
1. In the panel, set P1=U6 (or leave), map LED_0 → P1; confirm the warning
   chips are absent; **bind** `MarsinLED_0` to the discovered `titanic_201`
   (it currently has no `device:` block) or Create-from-device fresh.
2. Push → dialog shows `dmx.universe: 6` + no unhonorable warnings → confirm
   → reboot → verify → chip **In sync**. Engine (`--model test_bench`) with
   `controllers:` routing U6 → physical pixels animate AND sim strand
   matches (dual-send `alsoFlat`).
3. Negative check: temporarily map a second 40-px strand to P2 (manual U7) —
   the port row and push dialog must show the `U7 → really U6 ch161–320`
   warning; push anyway; verify hardware lights the second strand from the
   U6 stream (device truth) while the sim shows the same; then revert to the
   operator's preferred layout.
4. Reload the sim: patches restore (LED_0 U6:1), sections stable
   (DMX 1–4, LED 5), chip re-checks In sync.

**S5 operator flow:** create the `bench` group on LED_0 via the new Group
field, save, confirm `views.yaml` gains the `bench` bit, re-export the model
(`marsin_engine/models/test_bench.js` pixels carry
`group:'bench', sId:5, fId:11, patch:{universe:6,addr:…}`), run a pattern —
sim look (S1) approved at distance and close-up.

## Out of scope (file on the Notion board)

- Group rename carrying its view bit for LED groups (`renameGroupBit`
  parity) — build when the operator first renames one.
- Multi-controller universe auto-allocation across a fleet
  (`Titanic-202/.203`).
- Retiring the dead `autoPatchAll` path in `auto_patcher.js` (unused; keep —
  `gatherAllConfigs`/`clearMetadata`/`getFootprint`/`isGlobalEffect` are
  live imports).
- InstancedMesh pooling across strands if pixel counts reach the tens of
  thousands (measure first).
