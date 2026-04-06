/**
 * main.js — Application entry point / orchestrator.
 * Imports all modules, fetches config, and bootstraps the simulation.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
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

// ─── GUI modules ────────────────────────────────────────────────────────
import { setupGUI } from "./src/gui/gui_builder.js";
import { setupHUD, setupViewPresets, onResize } from "./src/gui/view_presets.js";
import { setupPatternEditor, loadPatternPresets, initPatternEngine } from "./src/gui/pattern_editor.js";

// ─── Init ───────────────────────────────────────────────────────────────
function init() {
  // Renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.55;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  setRenderer(renderer);

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

  // Post-processing
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.35, // strength
    0.3,  // radius
    0.92, // threshold
  );
  bloomPass.name = "bloom";
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  setComposer(composer);

  // Store refs for resize handler
  window._threeRefs = { renderer, composer };

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
  scene.add(transformControl);
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

// ─── Bootstrap ──────────────────────────────────────────────────────────
Promise.all([
  fetch("config/scene_config.yaml?t=" + Date.now()).then(r => r.text()).catch(() => ''),
  fetch("config/scene_preset_cameras.yaml?t=" + Date.now()).then(r => r.text()).catch(() => ''),
  fetch("../dmx/fixtures/uking_rgbwau_par_light/model_10.yaml?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch("../dmx/fixtures/shehds_18_18w_led_bar/model_119.yaml?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
  fetch("../dmx/fixtures/vintage_led_stage_light/model_33.yaml?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
]).then(async ([sceneYaml, camerasYaml, ukingModelYaml, shehdsModelYaml, vintageModelYaml]) => {
  // Load scene config
  try {
    const loaded = yaml.load(sceneYaml);
    if (loaded) {
      setConfigTree(loaded);
      extractParams(loaded);
    }
  } catch (err) {
    console.warn("Failed to parse scene_config.yaml:", err);
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

  init();

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

  // Initialize pattern editor + engine
  setupPatternEditor();
  loadPatternPresets().then(() => {
    initPatternEngine().then(() => {
      if (window.onLightingChange) window.onLightingChange();
    });
  });

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
}).catch(() => {
  init();
});

// --- TEMP RAYCAST HELPER ---
window.modelMeshes = modelMeshes;
window.getHullPort = function(x, y) {
  const origin = new THREE.Vector3(x, y, 50);
  const dir = new THREE.Vector3(0, 0, -1);
  const ray = new THREE.Raycaster(origin, dir);
  const intersects = ray.intersectObjects(modelMeshes, true);
  return intersects.map(i => Number(i.point.z.toFixed(3)));
};
