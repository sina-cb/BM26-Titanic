/**
 * main.js — Application entry point / orchestrator.
 * Imports all modules, fetches config, and bootstraps the simulation.
 */
import * as THREE from "three";
import { pass, uniform } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import yaml from "js-yaml";

// ─── Core modules ───────────────────────────────────────────────────────
import {
  params, modelMeshes, lights, configTree,
  setScene, setCamera, setRenderer, setComposer, setControls,
  setTransformControl, setRaycaster, setMouse,
  setConfigTree, setCameraPresets, setGridHelper,
  cameraPresets,
  selectedFixtureIndices,
  setDragStartState,
} from "./src/core/state.js";
import { pushUndo } from "./src/core/undo.js";
import { extractParams } from "./src/core/config.js";
import { createGround, createStarField, loadModel, onModelLoaded } from "./src/core/environment.js";
import { rebuildParLights, rebuildDmxFixtures } from "./src/core/fixtures.js";
import { onPointerMove, onPointerDown, onKeyDown, onTransformChange } from "./src/core/interaction.js";
import { animate } from "./src/core/animate.js";
import { initRegistry } from "./src/dmx/fixture_definition_registry.js";
import { createViewRegistry } from "./src/dmx/view_registry.js";
import { createControllerRegistry, projectOntoConfigs, registryIsActive } from "./src/dmx/controller_registry.js";
import { UniverseRouter } from "./src/dmx/universe_router.js";
import { isStaticHost, logStaticHostSkip } from "./src/core/static_host.js";

// ─── GUI modules ────────────────────────────────────────────────────────
import { setupGUI } from "./src/gui/gui_builder.js";
import { setupHUD, onResize } from "./src/gui/view_presets.js";
import { setupPatternEditor, loadPatternPresets, initPatternEngine } from "./src/gui/pattern_editor.js";
import { setupViewMasksEditor } from "./src/gui/view_masks_editor.js";
import { setupControllerMapEditor } from "./src/gui/controller_map_editor.js";
import { setupEngineBlackoutWarning } from "./src/gui/engine_blackout_warning.js";
import { initModernSacnMonitors, initModernViewPresets } from "./src/gui/modern/modern_root.js";
import { initModernPatternEditorShell } from "./src/gui/modern/pattern_editor_panel.js";
import { initModernViewMasksShell } from "./src/gui/modern/view_masks_panel.js";
import { initModernControllerMapShell } from "./src/gui/modern/controller_map_panel.js";
import {
  registerPanel, getStoredGeometry,
  sanitizeStore, clampAllPanels,
} from "./src/gui/panel_layout.js";
import { initPanelVisibility } from "./src/gui/panel_visibility.js";
import { setupHelpPanel } from "./src/gui/help_panel.js";
import { setupSceneManager } from "./src/gui/scene_manager.js";
import { setupLeftDrawers } from "./src/gui/left_drawer.js";
import "./src/gui/control_schema.js";

const VALID_RENDERER_MODES = new Set(["webgpu", "webgl"]);

function getRequestedRendererMode() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlRendererMode = urlParams.get("renderer");
  if (VALID_RENDERER_MODES.has(urlRendererMode)) return urlRendererMode;

  const savedRendererMode = params.rendererMode;
  if (VALID_RENDERER_MODES.has(savedRendererMode)) return savedRendererMode;

  // Prefer native WebGPU when the browser exposes the API. Apple Silicon Macs in
  // particular pay a steep cost going through ANGLE→Metal in WebGL — native
  // WebGPU avoids the fragment-uniform spill that crushes FPS in the `full`
  // profile with hundreds of SpotLights.
  if (typeof navigator !== "undefined" && navigator.gpu) return "webgpu";
  return "webgl";
}

// ─── Init ───────────────────────────────────────────────────────────────
async function init() {
  setupEngineBlackoutWarning({ readonly: window.__readonlyMode });

  const requestedRendererMode = getRequestedRendererMode();
  const forceWebGL = requestedRendererMode === "webgl";
  window.__rendererMode = requestedRendererMode;

  const renderer = new THREE.WebGPURenderer({
    powerPreference: "high-performance",
    forceWebGL: forceWebGL,
  });
  await renderer.init();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Shadow maps default OFF in three's renderer; without this the moon's and
  // master floods' castShadow flags are silent no-ops. Only those few lights
  // cast (the per-fixture sim SpotLights all set castShadow = false), so the
  // cost is a handful of shadow passes, not hundreds.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Keep this in sync with onResize() in view_presets.js. Retina displays at
  // dpr=2 cost ~2.56× the fragment work of dpr=1.25 for a 0–5% visual quality
  // gain on this scene, so default-cap at 1.25 unless the scene overrides it.
  const prCap = window.initialParams?.pixelRatioCap !== undefined
    ? window.initialParams.pixelRatioCap
    : 1.25;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, prCap));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.55;
  document.body.appendChild(renderer.domElement);
  setRenderer(renderer);

  console.log('[WebGPU] Renderer initialized:', renderer.backend?.constructor?.name || 'unknown backend');

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030310);
  scene.fog = new THREE.FogExp2(0x030310, 0.0004);
  setScene(scene);

  // Camera
  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.5,
    5000,
  );
  camera.position.set(200, 120, 200);
  setCamera(camera);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 10;
  controls.maxDistance = 2000;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.target.set(0, 20, 0);
  setControls(controls);

  // Post-processing — node-based (WebGPU compatible)
  const postProcessing = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  const scenePassColor = scenePass.getTextureNode('output');

  // Dynamic bloom uniforms (controllable from GUI)
  const bloomStrengthU = uniform(0.35);
  const bloomRadiusU = uniform(0.3);
  const bloomThresholdU = uniform(0.92);
  const bloomEffect = bloom(scenePassColor, bloomStrengthU, bloomRadiusU, bloomThresholdU);
  if (window.initialParams?.bloomEnabled !== false) {
    postProcessing.outputNode = scenePassColor.add(bloomEffect);
  } else {
    postProcessing.outputNode = scenePassColor;
  }

  // Store bloom controls for GUI access
  window._bloomParams = {
    strength: bloomStrengthU,
    radius: bloomRadiusU,
    threshold: bloomThresholdU,
    enabled: true,
  };

  setComposer(postProcessing);

  // Store refs for resize handler and dynamic pipeline manipulation
  window._threeRefs = { renderer, postProcessing, scenePassColor, bloomEffect };

  // Ground & Grid
  createGround();

  const gridHelper = new THREE.GridHelper(500, 50, 0x888888, 0xcccccc);
  gridHelper.visible = false;
  scene.add(gridHelper);
  setGridHelper(gridHelper);

  // Stars
  createStarField();

  // Raycaster & TransformControls
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  setRaycaster(raycaster);
  setMouse(mouse);

  const transformControl = new TransformControls(camera, renderer.domElement);
  transformControl.size = 0.6;
  transformControl.space = "world";
  transformControl.setRotationSnap(THREE.MathUtils.degToRad(5));
  transformControl.setTranslationSnap(0.5);
  transformControl.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value;
    if (event.value) {
      pushUndo();
      // Capture starting state for differential multi-select transforms
      if (selectedFixtureIndices.size > 1) {
        const obj = transformControl.object;
        const dragIdx = obj?.userData?.fixture?.index;
        const dragStartState = { dragIdx, fixtures: {} };
        for (const idx of selectedFixtureIndices) {
          const cfg = params.parLights[idx];
          const f = window.parFixtures[idx];
          if (cfg && f) {
            dragStartState.fixtures[idx] = {
              x: f.hitbox.position.x,
              y: f.hitbox.position.y,
              z: f.hitbox.position.z,
              quat: f.hitbox.quaternion.clone(),
            };
          }
        }
        setDragStartState(dragStartState);
      } else {
        setDragStartState(null);
      }
    } else {
      setDragStartState(null);
    }
  });
  transformControl.addEventListener("change", onTransformChange);
  scene.add(transformControl.getHelper());
  setTransformControl(transformControl);

  // Load model (triggers setupGUI when done)
  loadModel((obj) => onModelLoaded(obj, setupGUI, rebuildParLights, rebuildDmxFixtures));

  // Events
  window.addEventListener("resize", onResize);
  // Separate, debounced resize listener: re-clamp floating panels into the
  // (possibly shrunk) viewport so they can never drift unreachable. Kept
  // independent of view_presets.onResize on purpose.
  let _panelClampTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(_panelClampTimer);
    _panelClampTimer = setTimeout(clampAllPanels, 150);
  });
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("keydown", onKeyDown, true);
  initModernViewPresets();
  setupHUD();
  // Keyboard-shortcuts help overlay + bottom-right hint.
  setupHelpPanel();

  // Start render loop
  animate();
}

// ─── Scene Selection ────────────────────────────────────────────────────
// URL param ?scene=<name> loads from scenes/<name>/scene_config.yaml
// Default (no param) loads titanic scene
const _urlParams = new URLSearchParams(window.location.search);
const _activeScene = _urlParams.get('scene') || 'titanic';
window.__activeScene = _activeScene; // Expose for save/bridge operations
window.__readonlyMode = _urlParams.get('readonly') === '1'; // iPad observer mode
if (window.__readonlyMode) {
  const style = document.createElement('style');
  style.innerHTML = `
    #pattern-editor-panel,
    #sacn-in-monitor-panel,
    #sacn-out-monitor-panel,
    #info-panel,
    #scene-add-btn,
    #scene-del-btn {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}
const _sceneConfigPath = `scenes/${_activeScene}/scene_config.yaml`;
const _commonConfigPath = `scenes/common.yaml`;
const _camerasPath = `scenes/${_activeScene}/cameras.yaml`;
const _patchesPath = `scenes/${_activeScene}/patches.yaml`;
const _viewsPath = `scenes/${_activeScene}/views.yaml`;
const _controllersPath = `scenes/${_activeScene}/controllers.yaml`;
console.log(`[Scene] Loading: ${_activeScene} → ${_sceneConfigPath}${window.__readonlyMode ? ' (READONLY)' : ''}`);

// Deliberate boot halt: paints a fullscreen explanation and flags the
// bootstrap catch below NOT to fall back to a blank init. Used when
// continuing would let an auto-save overwrite good on-disk state with
// state derived from a file we failed to read.
function fatalBootError(message, err) {
  window.__fatalBootError = true;
  console.error('[FATAL BOOT]', message, err || '');
  const banner = document.createElement('div');
  banner.id = 'fatal-boot-error';
  banner.style.cssText =
    'position:fixed;inset:0;z-index:99999;background:rgba(24,0,0,0.97);color:#f66;' +
    'font-family:monospace;font-size:14px;line-height:1.5;padding:48px;' +
    'white-space:pre-wrap;overflow:auto;';
  banner.textContent = `⛔ SIM BOOT HALTED\n\n${message}`;
  document.body.appendChild(banner);
}

// ─── Bootstrap ──────────────────────────────────────────────────────────
Promise.all([
  fetch(_sceneConfigPath + "?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch(_commonConfigPath + "?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch(_patchesPath + "?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch(_camerasPath + "?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch(_viewsPath + "?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch(_controllersPath + "?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch("dmx/fixtures/uking_rgbwau_par_light/model_10.yaml?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch("dmx/fixtures/shehds_18_18w_led_bar/model_119.yaml?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch("dmx/fixtures/vintage_led_stage_light/model_33.yaml?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch("dmx/fixtures/fog_te_machines/model_1.yaml?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch("dmx/fixtures/fog_chauvet_4d/model_2.yaml?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch("config.yaml?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
]).then(async ([sceneYaml, commonYaml, patchesYaml, camerasYaml, viewsYaml, controllersYaml, ukingModelYaml, shehdsModelYaml, vintageModelYaml, teFogModelYaml, chauvetHazeModelYaml, rootConfigYaml]) => {

  // Load root config
  if (rootConfigYaml) {
    try {
      window.serverConfig = yaml.load(rootConfigYaml);
    } catch (e) {
      console.warn("Failed to parse config.yaml:", e);
    }
  }

  // Scene-owned view registry (views.yaml) — parsed OUTSIDE the
  // forgiving scene-config try/catch below, because a corrupt
  // views.yaml must hard-stop the boot. Continuing with an empty
  // registry would let the very next auto-save rewrite views.yaml and
  // the engine sidecar with renumbered bits, silently destroying the
  // group→bit contract patterns compile against (codex P0: fail
  // loudly, no fallbacks). A MISSING views.yaml is the legitimate
  // new-scene case and yields an empty registry.
  let _viewRegistry;
  try {
    const viewsTree = viewsYaml ? (yaml.load(viewsYaml)?.views || null) : null;
    _viewRegistry = createViewRegistry(viewsTree);
  } catch (err) {
    fatalBootError(
      `${_viewsPath} is corrupt or invalid — refusing to boot.\n\n${err.message}\n\n` +
      `Fix the file (or delete it to start the scene with no views) and reload. ` +
      `Nothing has been overwritten.`, err);
    return;
  }

  // Scene-owned controller mapping (controllers.yaml, docs/33) — same
  // hard-stop philosophy as views.yaml: a present-but-broken file must
  // halt the boot (the next auto-save would rewrite controllers.yaml
  // from a half-loaded registry, destroying the operator's mapping).
  // A MISSING controllers.yaml is the legitimate "no mapping yet" case.
  let _controllerRegistry;
  try {
    const controllersTree = controllersYaml ? yaml.load(controllersYaml) : null;
    _controllerRegistry = createControllerRegistry(controllersTree);
  } catch (err) {
    fatalBootError(
      `${_controllersPath} is corrupt or invalid — refusing to boot.\n\n${err.message}\n\n` +
      `Fix the file (or delete it to start the scene with no controller mapping) and reload. ` +
      `Nothing has been overwritten.`, err);
    return;
  }

  // Install the registry UNCONDITIONALLY — scenes with no scene/common
  // yaml (and scene-config parse failures, which are forgiven below)
  // must still get the real registry, or the Controllers panel would
  // operate on per-call throwaway objects and silently lose mutations
  // (cold review m1, 2026-06-12).
  window.__controllerRegistry = _controllerRegistry;
  window.projectControllerMappings = function (configs) {
    const registry = window.__controllerRegistry;
    if (!registry || !registryIsActive(registry)) return { violations: [], drift: [] };
    const pins = (window.serverConfig && window.serverConfig.global_effects) || {};
    const result = projectOntoConfigs(registry, configs, pins);
    if (window.__globalPatchTree) {
      for (const config of configs) {
        if (!config || !config.name) continue;
        window.__globalPatchTree[config.name] = {
          controllerIp: config.controllerIp || '',
          dmxUniverse: config.dmxUniverse || 0,
          dmxAddress: config.dmxAddress || 0,
          controllerId: config.controllerId || 0,
          sectionId: config.sectionId || 0,
          fixtureId: config.fixtureId || 0,
          viewMask: config.viewMask || 0,
        };
      }
    }
    window.__controllerViolations = result.violations;
    if (result.migrated && result.migrated.length > 0) {
      console.warn(`[Controllers] migrated ${result.migrated.length} legacy packed entr(ies) ` +
        'to absolute addresses (docs/33 decision 19) — addresses unchanged, saved with the ' +
        'next normal save:', result.migrated);
    }
    for (const v of result.violations) {
      console.error(`[Controllers] ✋ ${v.message}`);
    }
    for (const d of result.drift) {
      console.warn(`[Controllers] patches.yaml drift corrected for '${d.name}': ` +
        `U${d.before.dmxUniverse}:${d.before.dmxAddress}@${d.before.controllerIp || '—'} → ` +
        `U${d.after.dmxUniverse}:${d.after.dmxAddress}@${d.after.controllerIp || '—'}`);
    }
    return result;
  };

  // Load scene config
  try {
    if (sceneYaml || commonYaml) {
      const sceneObj = sceneYaml ? yaml.load(sceneYaml) : {};
      const commonObj = commonYaml ? yaml.load(commonYaml) : {};
      
      const rawParams = { ...commonObj, ...sceneObj };

      // Retired config sections — the iceberg-era `titanicEnd:` block and
      // the short-lived standalone `floods:` block. Stale autosaved yamls
      // from old builds resurrect their menus through the generic section
      // builder, so drop them at load (loudly); the next save writes the
      // cleaned tree, scrubbing them from disk for good. Flood controls
      // live under Atmosphere → Master Floods now.
      for (const retired of ["titanicEnd", "floods"]) {
        if (rawParams[retired] !== undefined) {
          console.warn(`[Config] dropped retired section '${retired}' from loaded yaml — ` +
            `flood controls live under 🌌 Atmosphere → 💡 Master Floods.`);
          delete rawParams[retired];
        }
      }

      const explicitOrder = [
        "atmosphere", "modelTransform",
        "dmxLights", "parLights", "ledStrands",
        "options", "colorWave", "config", "_camera", "_patternEditor"
      ];
      window.initialParams = {};
      
      // Preserve intended GUI execution ordering natively
      for (const k of explicitOrder) {
        if (rawParams[k] !== undefined) window.initialParams[k] = rawParams[k];
      }
      for (const k in rawParams) {
        if (!explicitOrder.includes(k)) window.initialParams[k] = rawParams[k];
      }
      
      // Stitch decoupled patch data back into the fixture tree
      if (patchesYaml) {
        const patchTree = yaml.load(patchesYaml);
        window.__globalPatchTree = patchTree?.patches || {};
        
        window.applyPatches = function(fixturesArray) {
          if (!fixturesArray) return;
          fixturesArray.forEach(fixture => {
            if (fixture.name && window.__globalPatchTree[fixture.name]) {
              Object.assign(fixture, window.__globalPatchTree[fixture.name]);
            }
          });
        };

        if (window.initialParams.parLights?.fixtures) {
          window.applyPatches(window.initialParams.parLights.fixtures);
        }
      }

      // Controller mapping boot projection (docs/33): when a mapping
      // exists, the mapper owns ALL patch fields — derived for mapped
      // fixtures, unpatched ('' / 0 / 0) for everything else. The
      // projection itself (window.projectControllerMappings, installed
      // above) runs AFTER initRegistry below — see the stash comment.
      const _bootConfigs = [];
      if (window.initialParams.parLights?.fixtures) _bootConfigs.push(...window.initialParams.parLights.fixtures);
      if (Array.isArray(window.initialParams.dmxLights)) _bootConfigs.push(...window.initialParams.dmxLights);
      if (window.initialParams.dmxLights?.fixtures) _bootConfigs.push(...window.initialParams.dmxLights.fixtures);
      // Stash for the boot projection below — which must NOT run here:
      // the fixture definition registry isn't initialized yet, and
      // packing without definitions silently used 10-channel footprints
      // for everything, compacting 119ch bars and scrambling every
      // address on reload (operator report 2026-06-12).
      window.__bootProjectionConfigs = _bootConfigs;

      // Notify PatchManager after patches are applied so boot state is correct
      if (window.recomputePatchesActive) window.recomputePatchesActive();

      // Attach the view registry (parsed + validated above) to the
      // config tree so it rides the normal save POST (the save server
      // splits it back out into views.yaml, like patches.yaml).
      window.initialParams.views = _viewRegistry;
      window.__viewRegistry = _viewRegistry;

      // Attach the controller registry the same way — save-server.js
      // splits it back out into controllers.yaml.
      window.initialParams.controllers = _controllerRegistry;

      setConfigTree(window.initialParams);
      extractParams(window.initialParams);
      // No reconcile here: bits are reconciled against the EXPORTED
      // PIXELS (the engine's validation universe) inside saveModelJS,
      // which boot calls right after init.
    }
  } catch (err) {
    console.warn(`Failed to parse ${_sceneConfigPath}:`, err);
  }

  // Load camera presets
  try {
    const camData = yaml.load(camerasYaml);
    if (camData && Array.isArray(camData.presets)) {
      setCameraPresets(camData.presets);
    }
  } catch (err) {
    console.warn("Failed to parse scene_preset_cameras.yaml:", err);
  }

  // Load fixture models
  window.fixtureModels = {};
  [
    { raw: ukingModelYaml, file: 'model_10.yaml' },
    { raw: shehdsModelYaml, file: 'model_119.yaml' },
    { raw: vintageModelYaml, file: 'model_33.yaml' },
    { raw: teFogModelYaml, file: 'fog_te_machines/model_1.yaml' },
    { raw: chauvetHazeModelYaml, file: 'fog_chauvet_4d/model_2.yaml' }
  ].forEach(({ raw, file }) => {
    try {
      if (raw) {
        let parsed = yaml.load(raw);
        if (parsed && parsed.model && parsed.model.fixture_type) {
          window.fixtureModels[parsed.model.fixture_type] = parsed.model;
        }
      }
    } catch (err) {
      console.warn("Failed to parse fixture model " + file + ":", err);
    }
  });

  // Initialize fixture definition registry
  initRegistry(window.fixtureModels);

  // Controller mapping boot projection — strictly AFTER initRegistry:
  // packing depends on real fixture footprints from the definition
  // registry. Running earlier "corrected" patches.yaml with 10-channel
  // fallback footprints on every reload (operator report 2026-06-12).
  if (window.__bootProjectionConfigs) {
    window.projectControllerMappings(window.__bootProjectionConfigs);
    delete window.__bootProjectionConfigs;
    // Patch state may have changed — re-derive the active flag.
    if (window.recomputePatchesActive) window.recomputePatchesActive();
  }

  // Initialize DMX universe router (universe 1 as default)
  const dmxRouter = new UniverseRouter('highest_priority_source_lock');
  dmxRouter.addUniverse(1);
  window.dmxRouter = dmxRouter;
  console.log('[DMX] Universe router initialized, universe 1 ready');

  // Default camera presets if none loaded
  if (cameraPresets.length === 0) {
    setCameraPresets([
      { name: 'Front', key: 'front', position: { x: 0, y: 5.5, z: 27.5 }, target: { x: 0, y: 4, z: 0 } },
      { name: 'Side', key: 'side', position: { x: 27.5, y: 5.5, z: 0 }, target: { x: 0, y: 4, z: 0 } },
      { name: 'Aerial', key: 'aerial', position: { x: 8.25, y: 22, z: 8.25 }, target: { x: 0, y: 4, z: 0 } },
      { name: 'Dramatic', key: 'dramatic', position: { x: -13.75, y: 3.3, z: 22 }, target: { x: 0, y: 4.4, z: 0 } },
      { name: 'Night Walk', key: 'night-walk', position: { x: 4.125, y: 1.1, z: 5.5 }, target: { x: 0, y: 3.3, z: 0 } },
    ]);
  }

  await init();

  // Check engine health and pin lighting mode if the engine is unreachable.
  // On a static host (HTTPS, no dev stack) the engine API is unreachable by
  // construction — switch to native Pixelblaze immediately and skip the
  // mixed-content fetch that would otherwise spam the console.
  if (isStaticHost()) {
    logStaticHostSkip('engine status check (port 6968)');
    const { params, setLightingMode } = await import("./src/core/state.js");
    if (params.lightingMode === 'sacn_in') {
      params.lightingMode = 'pixelblaze';
      setLightingMode('pixelblaze');
      if (window.guiInstance) window.guiInstance.controllersRecursive().forEach(c => c.updateDisplay());
      if (window.onLightingChange) window.onLightingChange();
    }
  } else {
    fetch(`http://${window.location.hostname}:6968/status`)
      .then(r => r.json())
      .catch(async () => {
        const { params, setLightingMode } = await import("./src/core/state.js");
        if (params.lightingMode === 'sacn_in') {
          console.warn("[Sim] Engine offline. Switching to native Pixelblaze mode.");
          params.lightingMode = 'pixelblaze';
          setLightingMode('pixelblaze');
          if (window.guiInstance) window.guiInstance.controllersRecursive().forEach(c => c.updateDisplay());
          if (window.onLightingChange) window.onLightingChange();
        }
      });
  }

  // Generate initial model file for Pixelblaze patterns. On static hosts there
  // is no save-server to receive the POST, so the call is skipped at the
  // exporter level — see pixelblaze_model_exporter.js.
  if (window.saveModelJS) window.saveModelJS();

  // Restore camera view from saved state
  // ES module exports are live bindings — these reflect init()'s setters
  const { camera: cam, controls: ctrls, configTree: ct } = await import("./src/core/state.js");
  if (ct && ct._camera) {
    const c = ct._camera;
    if (c.position) cam.position.set(c.position.x, c.position.y, c.position.z);
    if (c.target) ctrls.target.set(c.target.x, c.target.y, c.target.z);
    ctrls.update();
  }

  // Initialize pattern editor + sACN monitor + Scene indicator
  // In readonly mode (e.g. iPad Monitor), skip all write-capable subsystems
  const _isReadonly = _urlParams.get('readonly') === '1';
  if (!_isReadonly) {
    // Modern shells must mount BEFORE the setup functions attach their
    // handlers to the same element ids (see modern/SHELL_NOTES.md).
    initModernPatternEditorShell();
    initModernViewMasksShell();
    initModernControllerMapShell();
    setupPatternEditor();
    setupViewMasksEditor();
    setupControllerMapEditor();
    initModernSacnMonitors();
    setupSceneIndicator();
    setupSceneManager();
    loadPatternPresets().then(() => {
      initPatternEngine().then(() => {
        if (window.onLightingChange) window.onLightingChange();
      });
    });
  } else {
    console.log('[Readonly] Observer mode — editor, sACN bridge, and pattern engine disabled.');
    setupSceneIndicator();
  }

  // Panel layout: register floating panels with the layout system
  // (z band + click-to-front, viewport-clamped geometry restore from
  // localStorage — replaces the old _patternEditor block in common.yaml).
  //
  // Repair any persisted geometry that now falls outside this viewport
  // BEFORE panels restore, so a layout saved on a large monitor (or after
  // a viewport shrink) can't bring a panel back off-screen.
  sanitizeStore();
  if (!_isReadonly) {
    // Collapse state must flow through each panel's own collapse button:
    // the legacy handlers keep private state + a button glyph, so setting
    // the class directly would desync them (dead first click).
    const collapseViaButton = (panelEl, btnSelector) => (collapsed) => {
      if (panelEl.classList.contains('collapsed') === collapsed) return;
      const btn = panelEl.querySelector(btnSelector);
      if (btn) btn.click();
      else panelEl.classList.toggle('collapsed', collapsed);
    };

    const pePanel = document.getElementById('pattern-editor-panel');
    if (pePanel) {
      const applyPeCollapsed = collapseViaButton(pePanel, '#pe-collapse-btn');
      registerPanel(pePanel, { applyCollapsed: applyPeCollapsed });
      // 2026-06-12 layout decision: below ~1366px the editor + engine
      // params eat half the screen, so the editor boots collapsed there
      // (an operator-saved layout always wins over this default).
      if (!getStoredGeometry('pattern-editor-panel') && window.innerWidth < 1366) {
        applyPeCollapsed(true);
      }
      const autoRunCb = document.getElementById('pe-autorun');
      if (autoRunCb) {
        // One-time migration: honor an autoRun=true left in scene YAML by
        // pre-layout-migration saves, then localStorage owns it.
        if (localStorage.getItem('bm26.sim.peAutoRun') === null
            && ct && ct._patternEditor && ct._patternEditor.autoRun) {
          localStorage.setItem('bm26.sim.peAutoRun', '1');
        }
        autoRunCb.checked = localStorage.getItem('bm26.sim.peAutoRun') === '1';
        autoRunCb.addEventListener('change', () => {
          localStorage.setItem('bm26.sim.peAutoRun', autoRunCb.checked ? '1' : '0');
        });
      }
    }
    const masksPanel = document.getElementById('view-masks-panel');
    if (masksPanel) registerPanel(masksPanel);
    const cmPanel = document.getElementById('controller-map-panel');
    if (cmPanel) registerPanel(cmPanel);
    // The sACN monitors register themselves with collapse-store adapters
    // in modern_root.js (initModernSacnMonitors).
    // Engine params registers itself on every (re)creation —
    // see ensureGlobalParamsGui() in pattern_editor.js.
  }
  // Lighting Controls (#gui-panel) is a right-docked drawer, not a floating
  // panel — gui_builder wires it via setupControlDrawer, and the H toggle
  // reaches it through panel_visibility's setDrawerVisible. So it is NOT
  // registered with the floating-geometry system here.

  // Dock the left-side source panels (Pattern Editor / sACN IN + their
  // nested Engine Params / sACN OUT) as mode-driven drawers. Must come
  // before initPanelVisibility so a persisted H-hidden state reaches it.
  if (!_isReadonly) setupLeftDrawers();

  // Wire the show/hide hotkey + visibility module. The drawers + any
  // late-arriving floating panels are caught via a bounded re-apply.
  initPanelVisibility();
}).catch(async (err) => {
  // A deliberate boot halt (fatalBootError) must NOT fall back to a
  // blank init — the banner explains what to fix; booting anyway would
  // resurrect exactly the silent-overwrite failure it prevents.
  if (window.__fatalBootError) {
    console.error('[FATAL BOOT] init skipped:', err);
    return;
  }
  await init();
});

// ─── Scene Indicator ────────────────────────────────────────────────────
function setupSceneIndicator() {
  const select = document.getElementById('scene-select');
  if (!select) return;

  const active = window.__activeScene || 'titanic';

  // Add the active scene implicitly first to avoid empty dropdown while loading
  select.innerHTML = `<option value="${active}" selected>${active}</option>`;

  // Single source of truth: the static manifest committed alongside the scenes.
  // Same path in dev and prod (no localhost fallback) — see .agent/00_gol/00_codex.md P0.
  // The dev save-server regenerates this file after any mutation, so it stays live.
  const manifestUrl = './scenes/manifest.json';
  fetch(manifestUrl)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(scenes => {
      let html = '';
      scenes.forEach(s => {
        const isSelected = s === active;
        html += `<option value="${s}" ${isSelected ? 'selected' : ''}>${s}</option>`;
      });
      select.innerHTML = html;
    })
    .catch(err => console.error(`[Scene] Failed to load scenes manifest at ${manifestUrl}:`, err));

  select.addEventListener('change', (e) => {
    const val = e.target.value;
    const url = new URL(window.location.href);
    if (val) {
      url.searchParams.set('scene', val);
    } else {
      url.searchParams.delete('scene');
    }
    window.location.href = url.toString();
  });
}

// --- TEMP RAYCAST HELPER ---
window.modelMeshes = modelMeshes;
window.getHullPort = function(x, y) {
  const origin = new THREE.Vector3(x, y, 50);
  const dir = new THREE.Vector3(0, 0, -1);
  const ray = new THREE.Raycaster(origin, dir);
  const intersects = ray.intersectObjects(modelMeshes, true);
  return intersects.map(i => Number(i.point.z.toFixed(3)));
};

// ─── Background Throttling Prevention ───────────────────────────────────
// Chrome aggressively throttles requestAnimationFrame to 1fps or 0fps when 
// the tab is in the background or computer is locked. Since our sACN output 
// relies on the render loop, we play a silent looping audio file on first 
// interaction to trick Chrome into treating this tab as an active media player.
// TODO: This reduces but does not fully eliminate short pauses when the tab
//       loses focus. A proper fix would decouple the sACN output relay from
//       the browser render loop entirely (e.g. run it server-side in
//       sacn_bridge.js or use a dedicated Web Worker with its own WebSocket).
function enableBackgroundRunHack() {
  const audio = document.createElement('audio');
  audio.loop = true;
  // A tiny silent wav file in base64
  audio.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
  
  const playAudio = () => {
    audio.play().then(() => {
      console.log("[KeepAlive] Silent audio loop started to prevent background throttling.");
      window.removeEventListener('pointerdown', playAudio);
      window.removeEventListener('keydown', playAudio);
    }).catch(e => {
      // Ignore autoplay errors if they occur
    });
  };
  
  window.addEventListener('pointerdown', playAudio);
  window.addEventListener('keydown', playAudio);
}
enableBackgroundRunHack();
