// BM26 Titanic — Lighting Simulation
// Three.js-based 3D viewer with realistic night-time Burning Man lighting

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";
import yaml from "js-yaml";
import { ParLight } from "./ParLight.js";

// ─── Globals ────────────────────────────────────────────────────────────
let scene, camera, renderer, composer, controls;
let model = null;
let modelCenter = new THREE.Vector3();
let modelSize = new THREE.Vector3();
let modelRadius = 1;
let structureMaterial, editMaterial;
let gridHelper, ground, starField;

// Interaction / Transform
let transformControl, raycaster, mouse;
const interactiveObjects = [];
window.parFixtures = [];

const lights = { moon: null, towers: [], ambient: null, helpers: [] };
const clock = new THREE.Clock();
let frameCount = 0,
  lastFpsTime = 0;

// Global params — populated dynamically from scene_config.yaml
let configTree = null; // Holds the full parsed YAML structure for GUI generation & saving
const params = {
  // Transient / UI-only (not saved to YAML)
  fixtureToolMode: "translate",
  parLights: [], // Safe fallback before config loads
};

// Walk the YAML config tree and extract all { value: ... } entries into flat params
function extractParams(node) {
  if (!node || typeof node !== "object") return;
  for (const key of Object.keys(node)) {
    if (key === "_section") continue;

    // Explicit array handling for fixtures
    if (key === "fixtures" && Array.isArray(node[key])) {
      params.parLights = node[key];
      continue;
    }

    const entry = node[key];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      if (entry.value !== undefined) {
        // Leaf control — extract value into flat params
        params[key] = entry.value;
      } else {
        // Recurse into sub-section
        extractParams(entry);
      }
    }
  }
}

// Walk the config tree and update all value fields from current params (for saving)
function reconstructYAML(node) {
  if (!node || typeof node !== "object") return;
  for (const key of Object.keys(node)) {
    if (key === "_section") continue;

    if (key === "fixtures" && Array.isArray(node[key])) {
      // Direct array sync
      node[key] = params.parLights;
      continue;
    }

    const entry = node[key];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      if (entry.value !== undefined && !entry.transient) {
        entry.value = params[key];
      } else {
        reconstructYAML(entry);
      }
    }
  }
}

// ─── Loading UI ─────────────────────────────────────────────────────────
const progressBar = document.getElementById("progress-bar");
const loadingStatus = document.getElementById("loading-status");
const loadingOverlay = document.getElementById("loading-overlay");

function updateLoading(pct, msg) {
  progressBar.style.width = pct + "%";
  loadingStatus.textContent = msg;
}

// ─── Init ───────────────────────────────────────────────────────────────
function init() {
  // Renderer
  renderer = new THREE.WebGLRenderer({
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

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030310);
  scene.fog = new THREE.FogExp2(0x030310, 0.0004);

  // Camera
  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.5,
    5000,
  );
  camera.position.set(200, 120, 200);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 10;
  controls.maxDistance = 2000;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.target.set(0, 20, 0);

  // Post-processing
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.35, // strength (reduced)
    0.3, // radius (reduced)
    0.92, // threshold (increased)
  );
  bloomPass.name = "bloom";
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  // Ground & Grid
  createGround();

  gridHelper = new THREE.GridHelper(500, 50, 0x888888, 0xcccccc);
  gridHelper.visible = false;
  scene.add(gridHelper);

  // Stars
  createStarField();

  // Raycaster & TransformControls
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  transformControl = new TransformControls(camera, renderer.domElement);
  transformControl.size = 0.6; // Smaller, less intrusive gizmo
  transformControl.space = "world"; // Keep world space so translation axes don't rotate
  transformControl.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value; // Disable orbit controls while dragging
  });
  transformControl.addEventListener("change", onTransformChange);
  scene.add(transformControl);

  // Load model
  loadModel();

  // Events
  window.addEventListener("resize", onResize);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("keydown", onKeyDown);
  setupViewPresets();

  // Start loop
  animate();
}

function onPointerDown(event) {
  // Only handle left clicks, ignore UI clicks
  if (
    event.button !== 0 ||
    event.target.tagName === "INPUT" ||
    event.target.closest(".lil-gui")
  )
    return;

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(interactiveObjects, false);

  if (intersects.length > 0) {
    transformControl.attach(intersects[0].object);
  } else if (!transformControl.axis) {
    // If not hovering over the transform gizmo's axes, click outside deselects
    transformControl.detach();
  }
}

function onTransformChange() {
  const obj = transformControl.object;
  if (!obj || !obj.userData.fixture) return;

  const fixture = obj.userData.fixture;

  // Apply Scale transformations to the internal config without warping the model
  fixture.handleTransformScale();

  // Write bounding box world space to the local config (rotX, Y, Z, pos X, Y, Z)
  fixture.writeTransformToConfig();

  // Save changes via fetch and sync visuals
  if (window.debounceAutoSave) window.debounceAutoSave();
  fixture.updateVisualsFromHitbox();
}

function onKeyDown(event) {
  if (event.key === "Escape") {
    transformControl.detach();
    return;
  }

  if (!transformControl.object) return;

  // Support Maya (W,E,R) and Blender (G,R,S) style hotkeys
  switch (event.key.toLowerCase()) {
    case "w":
    case "g":
    case "t":
      transformControl.setMode("translate");
      break;
    case "e":
    case "r":
      transformControl.setMode("rotate");
      break;
    case "s":
      transformControl.setMode("scale");
      break;
    case "q":
      transformControl.setSpace(
        transformControl.space === "local" ? "world" : "local",
      );
      break;
  }
}

// ─── Ground Plane ───────────────────────────────────────────────────────
function createGround() {
  const groundGeo = new THREE.PlaneGeometry(2000, 2000);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0xc2b280, // Desert playa dust
    roughness: 0.95,
    metalness: 0.05,
  });
  ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.1;
  ground.receiveShadow = true;
  scene.add(ground);
}

// ─── Star Field ─────────────────────────────────────────────────────────
function createStarField() {
  const starCount = 3000;
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.7 + 0.3); // upper hemisphere only
    const r = 1500 + Math.random() * 500;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    sizes[i] = 0.5 + Math.random() * 2.0;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.7,
  });
  starField = new THREE.Points(starGeo, starMat);
  scene.add(starField);
}

// ─── Model Loading ──────────────────────────────────────────────────────
function loadModel() {
  updateLoading(10, "Loading FBX model…");

  const loader = new FBXLoader();
  loader.load(
    "../3d_models/2601_001_BURNING MAN HONORARIA_TE.fbx",
    onModelLoaded,
    (xhr) => {
      if (xhr.total > 0) {
        const pct = 10 + (xhr.loaded / xhr.total) * 70;
        updateLoading(
          Math.round(pct),
          `Loading model… ${Math.round(xhr.loaded / 1024 / 1024)}MB`,
        );
      }
    },
    (err) => {
      console.error("FBX load error:", err);
      updateLoading(0, "Error loading model — check console");
    },
  );
}

function onModelLoaded(obj) {
  updateLoading(85, "Processing geometry…");
  model = obj;

  // Apply PBR material
  structureMaterial = new THREE.MeshStandardMaterial({
    color: 0xd4c4a8, // warm sandy/wood tone
    roughness: 0.72,
    metalness: 0.08,
    side: THREE.DoubleSide,
    flatShading: false,
  });

  // Flat bright material for editing
  editMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    wireframe: false,
  });

  let meshCount = 0;
  model.traverse((child) => {
    if (child.isMesh) {
      child.material = structureMaterial;
      child.castShadow = true;
      child.receiveShadow = true;

      // Delete original normals from Rhino (per-face flat) and recompute smooth
      child.geometry.deleteAttribute("normal");
      child.geometry.computeVertexNormals();

      meshCount++;
    }
  });
  console.log(`Loaded ${meshCount} mesh(es) from FBX`);

  // Compute overall bounds to find the true center
  const box = new THREE.Box3().setFromObject(model);
  box.getCenter(modelCenter);
  box.getSize(modelSize);
  modelRadius = modelSize.length() / 2;

  // Translate geometry vertices directly so the local origin (0,0,0)
  // becomes the center of mass. This prevents the model from orbiting
  // around a distant pivot when rotated.
  model.traverse((child) => {
    if (child.isMesh) {
      child.geometry.translate(-modelCenter.x, -box.min.y, -modelCenter.z);
    }
  });

  // Apply requested default model pos/rot
  model.position.set(-2, 8, 16);
  model.rotation.set(THREE.MathUtils.degToRad(-90), 0, 0);

  scene.add(model);

  // Recompute bounds after centering and initial transform
  const finalBox = new THREE.Box3().setFromObject(model);
  finalBox.getCenter(modelCenter);
  finalBox.getSize(modelSize);
  modelRadius = finalBox.max.distanceTo(finalBox.min) / 2; // Recalculate radius based on new box

  updateLoading(90, "Setting up lights…");

  // Setup lighting
  setupLighting();

  // Setup camera position based on model
  const dist = modelRadius * 2.5;
  camera.position.set(dist * 0.7, modelSize.y * 1.2, dist * 0.7);
  controls.target.copy(modelCenter);
  controls.minDistance = modelRadius * 0.3;
  controls.maxDistance = modelRadius * 8;
  controls.update();

  // Setup GUI
  setupGUI();

  updateLoading(100, "Ready");
  setTimeout(() => loadingOverlay.classList.add("hidden"), 400);
}

// ─── Lighting Setup ─────────────────────────────────────────────────────
function setupLighting() {
  const h = modelSize.y;
  const r = modelRadius;

  // ── 1. Moonlight (DirectionalLight) ──
  const moon = new THREE.DirectionalLight(0x8899cc, 0.5);
  moon.position.set(r * 1.5, h * 4, r * 0.8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(4096, 4096);
  moon.shadow.camera.left = -r * 1.5;
  moon.shadow.camera.right = r * 1.5;
  moon.shadow.camera.top = r * 1.5;
  moon.shadow.camera.bottom = -r * 1.5;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = h * 8;
  moon.shadow.bias = -0.0005;
  moon.shadow.normalBias = 0.02;
  scene.add(moon);
  scene.add(moon.target);
  moon.target.position.copy(modelCenter);
  lights.moon = moon;

  // ── 2. Hemisphere ambient ──
  // Simulates sky ambient light from above and warm playa bounce from below
  const hemi = new THREE.HemisphereLight(0x223344, 0x887755, 0.3);
  scene.add(hemi);
  lights.ambient = hemi;

  // ── 3. Par Lights (ground-level uplights) ──
  rebuildParLights();

  // ── 4. Tower Flood Lights (elevated, wider beam) ──
  const towerPositions = [
    { x: -1, z: -1 },
    { x: 1, z: -1 },
    { x: 1, z: 1 },
    { x: -1, z: 1 },
  ];
  const towerColors = [0xeeeeff, 0xffeedd, 0xeeeeff, 0xffeedd];

  for (let i = 0; i < 4; i++) {
    const tp = towerPositions[i];
    const towerDist = r * 1.2;
    const towerHeight = h * 1.8;
    const x = modelCenter.x + tp.x * towerDist;
    const z = modelCenter.z + tp.z * towerDist;

    const flood = new THREE.SpotLight(
      towerColors[i],
      12, // Increased intensity
      r * 10, // Increased range to hit everything
      Math.PI / 3, // Wider angle to light up all objects and ground
      0.6,
      1.2,
    );
    flood.position.set(x, towerHeight, z);
    flood.target.position.copy(modelCenter);
    flood.castShadow = true;
    flood.shadow.mapSize.set(2048, 2048);
    flood.shadow.bias = -0.0005;
    flood.shadow.normalBias = 0.02;
    scene.add(flood);
    scene.add(flood.target);
    lights.towers.push(flood);

    // Tower pole visualization
    const poleGeo = new THREE.CylinderGeometry(0.3, 0.4, towerHeight, 6);
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.8,
      metalness: 0.3,
    });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, towerHeight / 2, z);
    pole.castShadow = true;
    scene.add(pole);
    lights.helpers.push(pole);

    // Flood light housing
    const housingGeo = new THREE.ConeGeometry(1.5, 2.5, 8);
    const housingMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.5,
      metalness: 0.5,
    });
    const housing = new THREE.Mesh(housingGeo, housingMat);
    housing.position.set(x, towerHeight, z);
    housing.rotation.x = Math.PI; // point down
    // Tilt toward center
    const dir = new THREE.Vector3()
      .subVectors(modelCenter, housing.position)
      .normalize();
    housing.lookAt(modelCenter);
    housing.rotateX(Math.PI / 2);
    scene.add(housing);
    lights.helpers.push(housing);

    // Glow at the flood source
    const glowGeo = new THREE.SphereGeometry(1.0, 8, 8);
    const glowMat = new THREE.MeshBasicMaterial({
      color: towerColors[i],
      transparent: true,
      opacity: 0.9,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.set(x, towerHeight - 0.5, z);
    scene.add(glow);
    lights.helpers.push(glow);
  }
}

// ─── Dynamic Par Lights ─────────────────────────────────────────────────
function rebuildParLights() {
  if (window.parFixtures) {
    window.parFixtures.forEach((f) => f.destroy());
  }
  window.parFixtures = [];

  // Rebuild from params using the new abstraction
  params.parLights.forEach((config, index) => {
    const fixture = new ParLight(
      config,
      index,
      scene,
      interactiveObjects,
      modelRadius,
    );
    window.parFixtures.push(fixture);
  });
}

window.syncLightFromConfig = function (index) {
  if (window.parFixtures && window.parFixtures[index]) {
    window.parFixtures[index].syncFromConfig();
    if (window.debounceAutoSave) window.debounceAutoSave();
  }
};

function setupGUI() {
  const gui = new GUI({ title: "🔦 Lighting Controls", width: 300 });
  gui.domElement.style.position = "fixed";
  gui.domElement.style.top = "10px";
  gui.domElement.style.right = "10px";

  // ─── Save / Auto-Save ───
  function exportConfig() {
    reconstructYAML(configTree);
    let yamlStr = yaml.dump(configTree, {
      lineWidth: -1,
      noCompatMode: true,
    });

    const header = `# BM26 Titanic — Scene Configuration
# This file is the single source of truth for both scene state AND the GUI layout.
# The UI is dynamically generated from this structure.
# _section keys define GUI folders. Each control key carries UI metadata.
# Order in this file = order in the GUI.

# ─── Atmosphere ───────────────────────────────────────────────────────────\n`;

    yamlStr = header + yamlStr
      .replace(/^modelTransform:/m, '\n# ─── Model Transform ─────────────────────────────────────────────────────\nmodelTransform:')
      .replace(/^parLights:/m, '\n# ─── Par Lights ───────────────────────────────────────────────────────────\nparLights:')
      .replace(/^options:/m, '\n# ─── Options ──────────────────────────────────────────────────────────────\noptions:')
      .replace(/^config:/m, '\n# ─── Configuration ────────────────────────────────────────────────────────\nconfig:');

    fetch("http://localhost:8181/save", {
      method: "POST",
      body: yamlStr,
    })
      .then(() =>
        console.log("Config successfully written to scene_config.yaml"),
      )
      .catch((err) => console.error("Failed to write config:", err));
  }
  window.exportConfig = exportConfig;

  let saveTimeout;
  function debounceAutoSave() {
    if (!params.autoSave) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(exportConfig, 2000);
  }
  window.debounceAutoSave = debounceAutoSave;

  gui.onChange(() => {
    debounceAutoSave();
  });

  // ─── Handler Registry ───
  // Maps flat param key → onChange callback. Only keys with side-effects need entries.
  const bloomPass = composer.passes.find((p) => p.name === "bloom");
  const handlers = {
    ambientIntensity: (v) => {
      lights.ambient.intensity = v;
    },
    exposure: (v) => {
      renderer.toneMappingExposure = v;
    },
    moonEnabled: (v) => {
      lights.moon.visible = v;
    },
    moonIntensity: (v) => {
      lights.moon.intensity = v;
    },
    moonColor: (v) => {
      lights.moon.color.set(v);
    },
    moonAngle: (v) => {
      const rad = (v * Math.PI) / 180;
      const r = modelRadius * 1.5;
      lights.moon.position.set(
        Math.cos(rad) * r * 1.5,
        Math.sin(rad) * modelSize.y * 4,
        r * 0.8,
      );
    },
    bloomStrength: (v) => {
      if (bloomPass) bloomPass.strength = v;
    },
    bloomRadius: (v) => {
      if (bloomPass) bloomPass.radius = v;
    },
    bloomThreshold: (v) => {
      if (bloomPass) bloomPass.threshold = v;
    },
    towersEnabled: (v) => {
      lights.towers.forEach((t) => {
        t.visible = v;
      });
    },
    towerIntensity: (v) => {
      lights.towers.forEach((t) => {
        t.intensity = v;
      });
    },
    towerAngle: (v) => {
      lights.towers.forEach((t) => {
        t.angle = (v * Math.PI) / 180;
      });
    },
    modelX: (v) => {
      if (model) model.position.x = v;
    },
    modelY: (v) => {
      if (model) model.position.y = v;
    },
    modelZ: (v) => {
      if (model) model.position.z = v;
    },
    rotX: (v) => {
      if (model) model.rotation.x = THREE.MathUtils.degToRad(v);
    },
    rotY: (v) => {
      if (model) model.rotation.y = THREE.MathUtils.degToRad(v);
    },
    rotZ: (v) => {
      if (model) model.rotation.z = THREE.MathUtils.degToRad(v);
    },
    parsEnabled: (v) => {
      window.parFixtures.forEach((f) => {
        f.setVisibility(v);
      });
    },
    editMode: (isEditMode) => {
      if (!model) return;
      model.traverse((child) => {
        if (child.isMesh)
          child.material = isEditMode ? editMaterial : structureMaterial;
      });
      renderer.shadowMap.enabled = !isEditMode;
      scene.traverse((child) => {
        if (child.isLight && child.shadow) child.castShadow = !isEditMode;
      });
      const bloom = composer.passes.find((p) => p.name === "bloom");
      if (bloom) bloom.enabled = !isEditMode;
      scene.background = new THREE.Color(isEditMode ? 0xaaaaaa : 0x030310);
      scene.fog.density = isEditMode ? 0 : 0.0004;
      gridHelper.visible = isEditMode;
      ground.visible = !isEditMode;
      starField.visible = !isEditMode;
      lights.ambient.intensity = isEditMode ? 2.5 : params.ambientIntensity;
    },
    showHelpers: (v) => {
      lights.helpers.forEach((h) => {
        h.visible = v;
      });
    },
  };

  // ─── Sync model transform params from live model ───
  if (model) {
    params.modelX = model.position.x;
    params.modelY = model.position.y;
    params.modelZ = model.position.z;
    params.rotX = THREE.MathUtils.radToDeg(model.rotation.x);
    params.rotY = THREE.MathUtils.radToDeg(model.rotation.y);
    params.rotZ = THREE.MathUtils.radToDeg(model.rotation.z);
  }

  // ─── Generic Control Builder ───
  function addControl(folder, key, meta) {
    const isColor =
      meta.type === "color" ||
      (typeof meta.value === "string" && String(meta.value).startsWith("#"));
    const isBool = typeof params[key] === "boolean";
    let ctrl;

    if (isColor) {
      ctrl = folder.addColor(params, key).name(meta.label || key);
    } else if (isBool) {
      ctrl = folder.add(params, key).name(meta.label || key);
    } else if (meta.options) {
      ctrl = folder.add(params, key, meta.options).name(meta.label || key);
    } else if (typeof params[key] === "number" && meta.min !== undefined) {
      ctrl = folder
        .add(params, key, meta.min, meta.max, meta.step)
        .name(meta.label || key);
    } else {
      ctrl = folder.add(params, key).name(meta.label || key);
    }

    if (handlers[key]) ctrl.onChange(handlers[key]);
    if (meta.listen) ctrl.listen();
    return ctrl;
  }

  // ─── Recursive GUI Builder ───
  function buildGUI(node, parentFolder) {
    for (const key of Object.keys(node)) {
      if (key === "_section") continue;
      const entry = node[key];

      // Sub-section (folder)
      if (
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        entry._section
      ) {
        const sectionMeta = entry._section;

        // Special: fixtureArray → build Par Lights UI
        if (sectionMeta.type === "fixtureArray") {
          buildParLightsSection(parentFolder, entry);
          continue;
        }

        const folder = parentFolder.addFolder(sectionMeta.label);
        if (sectionMeta.collapsed) folder.close();
        buildGUI(entry, folder);
        continue;
      }

      // Leaf control (has value key)
      if (
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        entry.value !== undefined
      ) {
        if (params[key] === undefined) params[key] = entry.value; // safety
        addControl(parentFolder, key, entry);
        continue;
      }
    }
  }

  // ─── Par Lights Special Section ───
  function buildParLightsSection(parentFolder, sectionNode) {
    const parFolder = parentFolder.addFolder(sectionNode._section.label);

    // Add non-fixture controls (parsEnabled, etc.)
    for (const key of Object.keys(sectionNode)) {
      if (key === "_section" || key === "fixtures") continue;
      const entry = sectionNode[key];
      if (entry && typeof entry === "object" && entry.value !== undefined) {
        if (params[key] === undefined) params[key] = entry.value;
        addControl(parFolder, key, entry);
      }
    }

    // Fixture Tool Mode (transient, not in YAML)
    parFolder
      .add(params, "fixtureToolMode", ["translate", "rotate", "scale"])
      .name("🖱️ Fixture Tool")
      .onChange((v) => {
        transformControl.setMode(v);
      });

    const parListFolder = parFolder.addFolder("Light Instances");

    function renderParGUI() {
      const children = [...parListFolder.folders];
      children.forEach((f) => f.destroy());

      params.parLights.forEach((config, index) => {
        if (config.x === undefined) config.x = 0;
        if (config.y === undefined) config.y = 1.5;
        if (config.z === undefined) config.z = 0;
        if (config.rotX === undefined) config.rotX = 0;
        if (config.rotY === undefined) config.rotY = 0;
        if (config.rotZ === undefined) config.rotZ = 0;

        const idxFolder = parListFolder.addFolder(`Par Light ${index + 1}`);
        idxFolder
          .add(
            {
              select: () => {
                const fixture = window.parFixtures[index];
                if (fixture && fixture.hitbox) {
                  transformControl.attach(fixture.hitbox);
                  console.log("Attached to light", index);
                }
              },
            },
            "select",
          )
          .name("🎯 Select & Move");

        idxFolder.addColor(config, "color").onChange(() => {
          window.syncLightFromConfig(index);
        });
        idxFolder.add(config, "intensity", 0, 50, 0.5).onChange(() => {
          window.syncLightFromConfig(index);
        });
        idxFolder
          .add(config, "angle", 5, 90, 1)
          .listen()
          .onChange(() => {
            window.syncLightFromConfig(index);
          });
        idxFolder.add(config, "penumbra", 0, 1, 0.05).onChange(() => {
          window.syncLightFromConfig(index);
        });
        idxFolder
          .add(config, "x", -200, 200, 0.01)
          .listen()
          .onChange(() => {
            window.syncLightFromConfig(index);
          });
        idxFolder
          .add(config, "y", 0, 100, 0.01)
          .listen()
          .onChange(() => {
            window.syncLightFromConfig(index);
          });
        idxFolder
          .add(config, "z", -200, 200, 0.01)
          .listen()
          .onChange(() => {
            window.syncLightFromConfig(index);
          });
        idxFolder
          .add(config, "rotX", -180, 180, 0.1)
          .listen()
          .onChange(() => {
            window.syncLightFromConfig(index);
          });
        idxFolder
          .add(config, "rotY", -180, 180, 0.1)
          .listen()
          .onChange(() => {
            window.syncLightFromConfig(index);
          });
        idxFolder
          .add(config, "rotZ", -180, 180, 0.1)
          .listen()
          .onChange(() => {
            window.syncLightFromConfig(index);
          });

        idxFolder
          .add(
            {
              remove: () => {
                params.parLights.splice(index, 1);
                renderParGUI();
                rebuildParLights();
                debounceAutoSave();
              },
            },
            "remove",
          )
          .name("❌ Remove Light");
      });
    }

    parFolder
      .add(
        {
          add: () => {
            params.parLights.push({
              color: "#ffaa44",
              intensity: 5,
              angle: 20,
              penumbra: 0.5,
              x: 0,
              y: 1.5,
              z: 0,
              rotX: 0,
              rotY: 0,
              rotZ: 0,
            });
            renderParGUI();
            rebuildParLights();
            debounceAutoSave();
          },
        },
        "add",
      )
      .name("➕ Add New Par Light");

    renderParGUI();
  }

  // ─── Build the entire GUI from the config tree ───
  if (configTree) {
    buildGUI(configTree, gui);
  }

  // ─── Config Section (always at bottom) ───
  // Ensure the Save Button is explicitly available at the root
  gui
    .add({ save: exportConfig }, "save")
    .name("💾 Overwrite scene_config.yaml");
}

// ─── View Presets ───────────────────────────────────────────────────────
function setupViewPresets() {
  document.querySelectorAll("#view-presets button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      animateCamera(view);
    });
  });
}

function animateCamera(viewName) {
  if (!model) return;

  const dist = modelRadius * 2.5;
  const h = modelSize.y;
  let targetPos, targetLook;

  switch (viewName) {
    case "front":
      targetPos = new THREE.Vector3(0, h * 0.5, dist);
      targetLook = modelCenter.clone();
      break;
    case "side":
      targetPos = new THREE.Vector3(dist, h * 0.5, 0);
      targetLook = modelCenter.clone();
      break;
    case "aerial":
      targetPos = new THREE.Vector3(dist * 0.3, dist * 0.8, dist * 0.3);
      targetLook = modelCenter.clone();
      break;
    case "dramatic":
      targetPos = new THREE.Vector3(-dist * 0.5, h * 0.3, dist * 0.8);
      targetLook = new THREE.Vector3(modelCenter.x, h * 0.4, modelCenter.z);
      break;
    case "night-walk":
      targetPos = new THREE.Vector3(dist * 0.15, h * 0.1, dist * 0.2);
      targetLook = new THREE.Vector3(modelCenter.x, h * 0.3, modelCenter.z);
      break;
    default:
      return;
  }

  // Smooth camera transition
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const duration = 1500; // ms
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Ease in-out cubic
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    camera.position.lerpVectors(startPos, targetPos, ease);
    controls.target.lerpVectors(startTarget, targetLook, ease);
    controls.update();

    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ─── Resize ─────────────────────────────────────────────────────────────
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

// ─── Animation Loop ─────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // FPS counter
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    document.getElementById("fps-counter").textContent = `${frameCount} FPS`;
    frameCount = 0;
    lastFpsTime = now;
  }

  composer.render();
}

// ─── Start ──────────────────────────────────────────────────────────────
fetch("scene_config.yaml?t=" + Date.now())
  .then((res) => res.text())
  .then((yamlText) => {
    try {
      const loaded = yaml.load(yamlText);
      if (loaded) {
        configTree = loaded;
        extractParams(configTree);
      }
    } catch (err) {
      console.warn("Failed to parse scene_config.yaml:", err);
    }
    init();
  })
  .catch(() => {
    init();
  });
