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
import { UniverseRouter } from "./src/dmx/universe_router.js";

// ─── GUI modules ────────────────────────────────────────────────────────
import { setupGUI } from "./src/gui/gui_builder.js";
import { setupHUD, setupViewPresets, onResize } from "./src/gui/view_presets.js";
import { setupPatternEditor, loadPatternPresets, initPatternEngine } from "./src/gui/pattern_editor.js";
import { setupSacnInMonitor, setupSacnOutMonitor } from "./src/gui/sacn_monitor.js";

// ─── Init ───────────────────────────────────────────────────────────────
async function init() {
  
  const renderer = new THREE.WebGPURenderer({
    
    powerPreference: "high-performance",
  });
  await renderer.init();
  renderer.setSize(window.innerWidth, window.innerHeight);
  
  const prCap = Math.min(window.devicePixelRatio, 2);
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

  // Store refs for resize handler
  window._threeRefs = { renderer };

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
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("keydown", onKeyDown, true);
  setupViewPresets();
  setupHUD();

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
const _sceneConfigPath = `scenes/${_activeScene}/scene_config.yaml`;
const _commonConfigPath = `scenes/common.yaml`;
const _camerasPath = `scenes/${_activeScene}/cameras.yaml`;
const _patchesPath = `scenes/${_activeScene}/patches.yaml`;
console.log(`[Scene] Loading: ${_activeScene} → ${_sceneConfigPath}${window.__readonlyMode ? ' (READONLY)' : ''}`);

// ─── Bootstrap ──────────────────────────────────────────────────────────
Promise.all([
  fetch(_sceneConfigPath + "?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch(_commonConfigPath + "?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch(_patchesPath + "?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch(_camerasPath + "?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch("dmx/fixtures/uking_rgbwau_par_light/model_10.yaml?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch("dmx/fixtures/shehds_18_18w_led_bar/model_119.yaml?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch("dmx/fixtures/vintage_led_stage_light/model_33.yaml?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
]).then(async ([sceneYaml, commonYaml, patchesYaml, camerasYaml, ukingModelYaml, shehdsModelYaml, vintageModelYaml]) => {

  // Load scene config
  try {
    if (sceneYaml || commonYaml) {
      const sceneObj = sceneYaml ? yaml.load(sceneYaml) : {};
      const commonObj = commonYaml ? yaml.load(commonYaml) : {};
      
      const rawParams = { ...commonObj, ...sceneObj };
      const explicitOrder = [
        "titanicEnd", "icebergs", "atmosphere", "modelTransform", 
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
      if (patchesYaml && window.initialParams.parLights?.fixtures) {
        const patchTree = yaml.load(patchesYaml);
        const patches = patchTree?.patches || {};
        window.initialParams.parLights.fixtures.forEach(fixture => {
          if (fixture.name && patches[fixture.name]) {
            Object.assign(fixture, patches[fixture.name]);
          }
        });
      }
      setConfigTree(window.initialParams);
      extractParams(window.initialParams);
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
    { raw: vintageModelYaml, file: 'model_33.yaml' }
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

  // Generate initial model file for Pixelblaze patterns
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
    setupPatternEditor();
    setupSacnInMonitor();
    setupSacnOutMonitor();
    setupSceneIndicator();
    loadPatternPresets().then(() => {
      initPatternEngine().then(() => {
        if (window.onLightingChange) window.onLightingChange();
      });
    });
  } else {
    console.log('[Readonly] Observer mode — editor, sACN bridge, and pattern engine disabled.');
    setupSceneIndicator();
  }

  // Restore pattern editor window state
  if (ct && ct._patternEditor) {
    const pe = ct._patternEditor;
    const pePanel = document.getElementById('pattern-editor-panel');
    if (pePanel) {
      if (pe.x !== undefined) pePanel.style.left = pe.x + 'px';
      if (pe.y !== undefined) pePanel.style.top = pe.y + 'px';
      if (pe.width) pePanel.style.width = pe.width + 'px';
      if (pe.height) pePanel.style.height = pe.height + 'px';
      if (pe.collapsed) pePanel.classList.add('collapsed');
      const autoRunCb = document.getElementById('pe-autorun');
      if (autoRunCb && pe.autoRun) autoRunCb.checked = true;
    }
  }
}).catch(async () => {
  await init();
});

// ─── Scene Indicator ────────────────────────────────────────────────────
function setupSceneIndicator() {
  const select = document.getElementById('scene-select');
  if (!select) return;

  const active = window.__activeScene || 'titanic';

  // Add the active scene implicitly first to avoid empty dropdown while loading
  select.innerHTML = `<option value="${active}" selected>${active}</option>`;

  // Fetch true list
  fetch('http://localhost:6970/list-scenes')
    .then(r => r.json())
    .then(scenes => {
      let html = '';
      scenes.forEach(s => {
        const isSelected = s === active;
        html += `<option value="${s}" ${isSelected ? 'selected' : ''}>${s}</option>`;
      });
      select.innerHTML = html;
    })
    .catch(err => console.warn('[Scene] Failed to load scenes list:', err));

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
