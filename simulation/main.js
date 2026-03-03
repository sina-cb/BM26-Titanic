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
import chroma from "chroma-js";
import { ParLight } from "./ParLight.js";
import { LedStrand } from "./LedStrand.js";
import { Iceberg } from "./Iceberg.js";

// ─── Globals ────────────────────────────────────────────────────────────
let scene, camera, renderer, composer, controls;
let model = null;
let modelCenter = new THREE.Vector3();
let modelSize = new THREE.Vector3();
let modelRadius = 1;
let structureMaterial, editMaterial;
let gridHelper, ground, starField;
const modelMeshes = []; // Collected after model load for surface raycasting

// Interaction / Transform
let transformControl, raycaster, mouse;
const interactiveObjects = [];
window.parFixtures = [];
const selectedFixtureIndices = new Set();

function deselectAllFixtures() {
  if (window.parFixtures) {
    window.parFixtures.forEach(f => { try { f.setSelected(false); } catch (_) {} });
  }
  selectedFixtureIndices.clear();
}
let dragStartState = null; // Stores starting pos/rot for differential multi-select transforms

// Generate next name by finding the highest number with the same prefix and incrementing
function nextFixtureName(baseName) {
  const match = baseName.match(/^(.+?)\s*(\d+)\s*$/);
  const prefix = match ? match[1].trim() : baseName.trim();
  // Find the largest existing number with the same prefix
  let maxNum = 0;
  for (const p of params.parLights) {
    const m = (p.name || '').match(/^(.+?)\s*(\d+)\s*$/);
    if (m && m[1].trim() === prefix) {
      maxNum = Math.max(maxNum, parseInt(m[2], 10));
    }
  }
  return `${prefix} ${maxNum + 1}`;
}

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
  traces: [],    // Trace configs for group generator
  ledStrands: [], // LED strand configs
  icebergs: [],   // Iceberg configs
};

// ─── Undo / Redo ─────────────────────────────────────────────────────────
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;

function captureSnapshot() {
  const snapshot = {};
  for (const key of Object.keys(params)) {
    if (key === 'parLights') {
      snapshot.parLights = JSON.parse(JSON.stringify(params.parLights));
    } else if (key === 'traces') {
      snapshot.traces = JSON.parse(JSON.stringify(params.traces));
    } else if (key === 'ledStrands') {
      snapshot.ledStrands = JSON.parse(JSON.stringify(params.ledStrands));
    } else if (key === 'icebergs') {
      snapshot.icebergs = JSON.parse(JSON.stringify(params.icebergs));
    } else {
      snapshot[key] = params[key];
    }
  }
  return snapshot;
}

function pushUndo() {
  undoStack.push(captureSnapshot());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}

function applySnapshot(snapshot) {
  if (window._setGuiRebuilding) window._setGuiRebuilding(true);
  try {
    for (const key of Object.keys(snapshot)) {
      if (key === 'parLights') {
        params.parLights = JSON.parse(JSON.stringify(snapshot.parLights));
      } else if (key === 'traces') {
        params.traces = JSON.parse(JSON.stringify(snapshot.traces || []));
      } else if (key === 'ledStrands') {
        params.ledStrands = JSON.parse(JSON.stringify(snapshot.ledStrands || []));
      } else if (key === 'icebergs') {
        params.icebergs = JSON.parse(JSON.stringify(snapshot.icebergs || []));
      } else {
        params[key] = snapshot[key];
      }
    }
    rebuildParLights();
    if (window.rebuildTraceObjects) window.rebuildTraceObjects();
    if (window.rebuildLedStrands) window.rebuildLedStrands();
    if (window.rebuildIcebergs) window.rebuildIcebergs();
    if (window.renderParGUI) window.renderParGUI();
    if (window.renderGeneratorGUI) window.renderGeneratorGUI();
    if (window.guiInstance) {
      window.guiInstance.controllersRecursive().forEach(c => {
        try { c.updateDisplay(); } catch (_) {}
      });
    }
    if (window.applyAllHandlers) window.applyAllHandlers();
    if (window.debounceAutoSave) window.debounceAutoSave();
  } finally {
    if (window._setGuiRebuilding) window._setGuiRebuilding(false);
  }
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(captureSnapshot());
  applySnapshot(undoStack.pop());
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(captureSnapshot());
  applySnapshot(redoStack.pop());
}

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
    if (key === "traces" && Array.isArray(node[key])) {
      params.traces = node[key];
      // Restore _traceGenerated flag on fixtures belonging to trace groups
      const traceGroupNames = new Set(params.traces.filter(t => t.generated).map(t => t.groupName || t.name));
      params.parLights.forEach(light => {
        if (traceGroupNames.has(light.group)) light._traceGenerated = true;
      });
      continue;
    }
    if (key === "strands" && Array.isArray(node[key])) {
      params.ledStrands = node[key];
      continue;
    }
    if (key === "icebergs" && Array.isArray(node[key])) {
      params.icebergs = node[key];
      continue;
    }
    if (key === "gradientStops" && Array.isArray(node[key])) {
      params.gradientStops = node[key];
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
      // Strip internal fields (prefixed with _) before saving
      node[key] = params.parLights.map(light => {
        const clean = {};
        for (const k of Object.keys(light)) {
          if (!k.startsWith('_')) clean[k] = light[k];
        }
        return clean;
      });
      continue;
    }
    if (key === "traces" && Array.isArray(node[key])) {
      node[key] = params.traces;
      continue;
    }
    if (key === "strands" && Array.isArray(node[key])) {
      node[key] = params.ledStrands;
      continue;
    }
    if (key === "icebergs" && Array.isArray(node[key])) {
      node[key] = params.icebergs;
      continue;
    }
    if (key === "gradientStops" && Array.isArray(node[key])) {
      node[key] = params.gradientStops;
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
  transformControl.size = 0.6;
  transformControl.space = "world";
  transformControl.setRotationSnap(THREE.MathUtils.degToRad(5)); // Default 5° snap
  transformControl.setTranslationSnap(0.5);
  transformControl.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value;
    if (event.value) {
      pushUndo();
      // Capture starting state of all selected fixtures for differential transforms
      if (selectedFixtureIndices.size > 1) {
        const obj = transformControl.object;
        const dragIdx = obj?.userData?.fixture?.index;
        dragStartState = { dragIdx, fixtures: {} };
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
      } else {
        dragStartState = null;
      }
    } else {
      dragStartState = null;
    }
  });
  transformControl.addEventListener("change", onTransformChange);
  scene.add(transformControl);

  // Load model
  loadModel();

  // Events
  window.addEventListener("resize", onResize);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("keydown", onKeyDown, true); // capture phase to beat lil-gui focus
  setupViewPresets();

  // Start loop
  animate();
}

// ─── Snap-to-Surface Mode ────────────────────────────────────────────────
let snapMode = false;
let snapStep = 1; // 1 = position, 2 = aim direction
let snapCursorGroup = null;
let snapRingMat = null;
let snapArrow = null;
let lastSnapNormal = null;
let lastSnapPoint = null;

function createSnapCursor() {
  snapCursorGroup = new THREE.Group();
  snapCursorGroup.visible = false;

  const ringGeo = new THREE.TorusGeometry(0.8, 0.06, 8, 32);
  snapRingMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.9 });
  const ring = new THREE.Mesh(ringGeo, snapRingMat);
  snapCursorGroup.add(ring);

  const dotGeo = new THREE.SphereGeometry(0.12, 8, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  snapCursorGroup.add(dot);

  const arrowDir = new THREE.Vector3(0, 0, 1);
  snapArrow = new THREE.ArrowHelper(arrowDir, new THREE.Vector3(), 2.5, 0x00ccff, 0.6, 0.3);
  snapCursorGroup.add(snapArrow);

  scene.add(snapCursorGroup);
}

function setSnapStep(step) {
  snapStep = step;
  const indicator = document.getElementById('snap-indicator');
  if (!indicator) return;
  if (step === 1) {
    indicator.textContent = 'Step 1/2 — Click on model surface to place fixture';
    indicator.style.borderColor = '#00ccff';
    indicator.style.color = '#00ccff';
    indicator.style.background = 'rgba(0,204,255,0.15)';
    if (snapRingMat) snapRingMat.color.setHex(0x00ccff);
    if (snapArrow) snapArrow.setColor(0x00ccff);
  } else {
    indicator.textContent = 'Step 2/2 — Click where the light should aim';
    indicator.style.borderColor = '#ffaa00';
    indicator.style.color = '#ffaa00';
    indicator.style.background = 'rgba(255,170,0,0.15)';
    if (snapRingMat) snapRingMat.color.setHex(0xffaa00);
    if (snapArrow) snapArrow.setColor(0xffaa00);
  }
}

function toggleSnapMode(forceOff) {
  if (forceOff === true) {
    snapMode = false;
  } else {
    snapMode = !snapMode;
  }
  snapStep = 1;

  if (!snapCursorGroup) createSnapCursor();
  snapCursorGroup.visible = false;
  lastSnapNormal = null;
  lastSnapPoint = null;

  renderer.domElement.style.cursor = snapMode ? 'crosshair' : 'default';

  let indicator = document.getElementById('snap-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'snap-indicator';
    indicator.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);border:1px solid #00ccff;color:#00ccff;padding:6px 16px;border-radius:6px;font-family:Inter,sans-serif;font-size:13px;pointer-events:none;z-index:999;backdrop-filter:blur(4px);';
    document.body.appendChild(indicator);
  }
  indicator.style.display = snapMode ? 'block' : 'none';
  if (snapMode) setSnapStep(1);
}

function onPointerMove(event) {
  if (!snapMode || !snapCursorGroup) return;
  if (event.target.closest && event.target.closest('.lil-gui')) {
    snapCursorGroup.visible = false;
    return;
  }

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(modelMeshes, true);

  if (intersects.length > 0) {
    const hit = intersects[0];
    const point = hit.point;
    const faceNormal = hit.face.normal.clone();

    // Transform normal from object local space to world space
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    faceNormal.applyMatrix3(normalMatrix).normalize();

    // Position cursor at intersection point, slightly offset along normal
    snapCursorGroup.position.copy(point).addScaledVector(faceNormal, 0.05);

    // Orient the cursor group so its local +Z aligns with the face normal
    const up = new THREE.Vector3(0, 0, 1);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, faceNormal);
    snapCursorGroup.quaternion.copy(quat);

    snapCursorGroup.visible = true;
    lastSnapNormal = faceNormal;
    lastSnapPoint = point.clone();
  } else {
    snapCursorGroup.visible = false;
    lastSnapNormal = null;
    lastSnapPoint = null;
  }
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

  // ─── Snap Mode ───
  if (snapMode && lastSnapPoint) {
    const obj = transformControl.object;
    if (!obj || !obj.userData.isParLight) return;
    const fixture = obj.userData.fixture;

    if (snapStep === 1 && lastSnapNormal) {
      // Step 1: Place fixture at surface point
      pushUndo();
      const normal = lastSnapNormal;
      const point = lastSnapPoint.clone().addScaledVector(normal, 0.5);

      fixture.config.x = point.x;
      fixture.config.y = point.y;
      fixture.config.z = point.z;

      // Orient along face normal (default, user can refine in step 2)
      const defaultDir = new THREE.Vector3(0, 0, -1);
      const quat = new THREE.Quaternion().setFromUnitVectors(defaultDir, normal);
      const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
      fixture.config.rotX = THREE.MathUtils.radToDeg(euler.x);
      fixture.config.rotY = THREE.MathUtils.radToDeg(euler.y);
      fixture.config.rotZ = THREE.MathUtils.radToDeg(euler.z);

      fixture.syncFromConfig();
      fixture.updateVisualsFromHitbox();
      transformControl.setSpace('local');
      if (window.debounceAutoSave) window.debounceAutoSave();
      syncGuiFolders();

      // Move to step 2: aim
      setSnapStep(2);
    } else if (snapStep === 2) {
      // Step 2: Aim the light at the clicked point
      const target = lastSnapPoint.clone();
      const pos = new THREE.Vector3(fixture.config.x, fixture.config.y, fixture.config.z);
      const dir = target.sub(pos).normalize();

      // Orient hitbox so -Z points toward the target
      const defaultDir = new THREE.Vector3(0, 0, -1);
      const quat = new THREE.Quaternion().setFromUnitVectors(defaultDir, dir);
      const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
      fixture.config.rotX = THREE.MathUtils.radToDeg(euler.x);
      fixture.config.rotY = THREE.MathUtils.radToDeg(euler.y);
      fixture.config.rotZ = THREE.MathUtils.radToDeg(euler.z);

      fixture.syncFromConfig();
      fixture.updateVisualsFromHitbox();
      if (window.debounceAutoSave) window.debounceAutoSave();
      syncGuiFolders();

      // Done — exit snap mode
      toggleSnapMode(true);
    }
    return;
  }
  // ─── Normal selection mode ───
  // If user is clicking on the TransformControls gizmo, don't change selection
  if (transformControl.axis) return;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(interactiveObjects, false);

  if (intersects.length > 0) {
    const hit = intersects[0].object;
    transformControl.attach(hit);

    if (hit.userData.isTrace) {
      // Trace handle clicked — open the generator GUI for this trace
      deselectAllFixtures();
      if (window.openTraceFolder) window.openTraceFolder(hit.userData.traceIndex);
    } else if (hit.userData.isLedStrand) {
      // LED strand handle clicked — open the strand GUI
      deselectAllFixtures();
      if (window.openStrandFolder && hit.userData.fixture) window.openStrandFolder(hit.userData.fixture.index);
    } else if (hit.userData.isIceberg) {
      // Iceberg hitbox clicked — open the iceberg GUI
      deselectAllFixtures();
      if (window.openIcebergFolder && hit.userData.fixture) window.openIcebergFolder(hit.userData.fixture.index);
    } else if (hit.userData.isParLight) {
      const fixtureIndex = hit.userData.fixture.index;
      if (event.shiftKey) {
        if (selectedFixtureIndices.has(fixtureIndex)) {
          selectedFixtureIndices.delete(fixtureIndex);
          hit.userData.fixture.setSelected(false);
        } else {
          selectedFixtureIndices.add(fixtureIndex);
          hit.userData.fixture.setSelected(true);
        }
      } else {
        deselectAllFixtures();
        selectedFixtureIndices.add(fixtureIndex);
        hit.userData.fixture.setSelected(true);
      }
    } else {
      deselectAllFixtures();
    }
    syncGuiFolders();
  } else if (!transformControl.axis) {
    transformControl.detach();
    deselectAllFixtures();
    syncGuiFolders();
  }
}

// ─── GUI Folder Sync ───
function syncGuiFolders() {
  if (!window.parGuiFolders) return;
  window.parGuiFolders.forEach((folder, idx) => {
    if (!folder) return;
    try {
      if (selectedFixtureIndices.has(idx)) {
        folder.open();
        folder.domElement.classList.add('gui-card-selected');
        // Open parent group folder
        if (folder.parent && typeof folder.parent.open === 'function') {
          folder.parent.open();
        }
      } else {
        folder.close();
        folder.domElement.classList.remove('gui-card-selected');
      }
    } catch (_) {}
  });
}

function onTransformChange() {
  const obj = transformControl.object;
  if (!obj) return;

  // Handle trace objects
  if (obj.userData.isTrace && window._onTraceTransformChange) {
    window._onTraceTransformChange(obj);
    return;
  }
  // Handle LED strand objects
  if (obj.userData.isLedStrand && window._onStrandTransformChange) {
    window._onStrandTransformChange(obj);
    return;
  }
  // Handle iceberg objects
  if (obj.userData.isIceberg && window._onIcebergTransformChange) {
    window._onIcebergTransformChange(obj);
    return;
  }

  if (!obj.userData.fixture) return;

  const fixture = obj.userData.fixture;
  const dragIdx = fixture.index;

  fixture.handleTransformScale();
  fixture.writeTransformToConfig();
  fixture.updateVisualsFromHitbox();

  // Apply differential transform to all other selected fixtures
  if (dragStartState && dragStartState.dragIdx === dragIdx && selectedFixtureIndices.size > 1) {
    const startDrag = dragStartState.fixtures[dragIdx];
    if (startDrag) {
      // Position delta (from hitbox world position, not config)
      const dx = fixture.hitbox.position.x - startDrag.x;
      const dy = fixture.hitbox.position.y - startDrag.y;
      const dz = fixture.hitbox.position.z - startDrag.z;

      // Rotation delta via quaternions: deltaQ = currentQ * startQ^-1
      const currentQuat = fixture.hitbox.quaternion.clone();
      const startQuatInv = startDrag.quat.clone().invert();
      const deltaQuat = new THREE.Quaternion().multiplyQuaternions(currentQuat, startQuatInv);

      for (const idx of selectedFixtureIndices) {
        if (idx === dragIdx) continue;
        const startOther = dragStartState.fixtures[idx];
        const otherFixture = window.parFixtures[idx];
        if (!startOther || !otherFixture) continue;

        // Set position directly on hitbox
        otherFixture.hitbox.position.set(
          startOther.x + dx,
          startOther.y + dy,
          startOther.z + dz
        );

        // Set rotation directly on hitbox
        const newQuat = new THREE.Quaternion().multiplyQuaternions(deltaQuat, startOther.quat);
        otherFixture.hitbox.quaternion.copy(newQuat);

        // Write back to config from hitbox
        otherFixture.writeTransformToConfig();
        otherFixture.updateVisualsFromHitbox();
      }
    }
  }

  if (window.debounceAutoSave) window.debounceAutoSave();
}

function onKeyDown(event) {
  // ─── Undo / Redo (always active) ───
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
    event.preventDefault();
    undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && (event.key === 'Z' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
    event.preventDefault();
    redo();
    return;
  }

  if (event.key === "Escape") {
    if (snapMode) {
      toggleSnapMode(true);
      return;
    }
    transformControl.detach();
    deselectAllFixtures();
    syncGuiFolders();
    return;
  }
  // ─── Transform mode shortcuts (T/R/S/Q) ───
  const k = event.key.toLowerCase();
  if (!event.ctrlKey && !event.metaKey) {
    if (k === 't') {
      if (transformControl.mode === 'translate') {
        // Already in translate — toggle world ↔ local
        transformControl.setSpace(transformControl.space === 'world' ? 'local' : 'world');
      } else {
        transformControl.setMode('translate');
        transformControl.setSpace('world'); // 1st press always starts world
      }
      return;
    }
    if (k === 'r') {
      if (transformControl.mode === 'rotate') {
        transformControl.setSpace(transformControl.space === 'world' ? 'local' : 'world');
      } else {
        transformControl.setMode('rotate');
        transformControl.setSpace('world');
      }
      return;
    }
    if (k === 's') { transformControl.setMode('scale'); return; }
    if (k === 'q') {
      transformControl.setSpace(transformControl.space === 'local' ? 'world' : 'local');
      return;
    }
  }

  // ─── P key: toggle snap mode ───
  if (k === 'p' && !event.ctrlKey && !event.metaKey) {
    toggleSnapMode();
    return;
  }

  // ─── Delete selected par light(s) ───
  if (event.key === 'Delete') {
    if (selectedFixtureIndices.size > 0) {
      pushUndo();
      // Delete in reverse index order to maintain correct splice positions
      const indices = [...selectedFixtureIndices].sort((a, b) => b - a);
      for (const idx of indices) {
        params.parLights.splice(idx, 1);
      }
      selectedFixtureIndices.clear();
      transformControl.detach();
      rebuildParLights();
      if (window.renderParGUI) window.renderParGUI();
      if (window.debounceAutoSave) window.debounceAutoSave();
      return;
    }
  }

  // ─── Duplicate selected par light(s) ───
  if (event.key.toLowerCase() === 'd' && !event.ctrlKey && !event.metaKey) {
    if (selectedFixtureIndices.size > 0) {
      pushUndo();
      const newIndices = [];
      for (const idx of [...selectedFixtureIndices].sort((a, b) => a - b)) {
        const srcConfig = params.parLights[idx];
        if (srcConfig) {
          const clone = JSON.parse(JSON.stringify(srcConfig));
          clone.name = nextFixtureName(clone.name || 'Par Light');
          clone.x = (clone.x || 0) + 2;
          params.parLights.push(clone);
          newIndices.push(params.parLights.length - 1);
        }
      }
      rebuildParLights();
      if (window.renderParGUI) window.renderParGUI();
      if (window.debounceAutoSave) window.debounceAutoSave();
      // Select the new duplicates
      deselectAllFixtures();
      for (const idx of newIndices) {
        selectedFixtureIndices.add(idx);
        if (window.parFixtures[idx]) window.parFixtures[idx].setSelected(true);
      }
      const last = window.parFixtures[newIndices[newIndices.length - 1]];
      if (last) transformControl.attach(last.hitbox);
      return;
    }
    // Fallback: single fixture under transform control
    const obj = transformControl.object;
    if (obj && obj.userData.isParLight) {
      const srcConfig = obj.userData.fixture.config;
      pushUndo();
      const clone = JSON.parse(JSON.stringify(srcConfig));
      clone.name = nextFixtureName(clone.name || 'Par Light');
      clone.x = (clone.x || 0) + 2;
      params.parLights.push(clone);
      rebuildParLights();
      if (window.renderParGUI) window.renderParGUI();
      if (window.debounceAutoSave) window.debounceAutoSave();
      const newFixture = window.parFixtures[window.parFixtures.length - 1];
      if (newFixture) {
        deselectAllFixtures();
        selectedFixtureIndices.add(newFixture.index);
        newFixture.setSelected(true);
        transformControl.attach(newFixture.hitbox);
      }
      return;
    }
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

      modelMeshes.push(child); // Collect for snap raycasting
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
  // Clear selection since fixture objects are being rebuilt
  selectedFixtureIndices.clear();

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
    fixture.setVisibility(params.parsEnabled !== false, params.conesEnabled !== false);
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
  window.guiInstance = gui;
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
      .then(() => {
        console.log("Config successfully written to scene_config.yaml");
        showSaveToast();
      })
      .catch((err) => console.error("Failed to write config:", err));
  }

  function showSaveToast() {
    let toast = document.getElementById('save-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'save-toast';
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a3a1a;border:1px solid #3c3;color:#3c3;padding:6px 20px;border-radius:6px;font-family:Inter,sans-serif;font-size:13px;pointer-events:none;z-index:999;opacity:0;transition:opacity 0.3s;';
      document.body.appendChild(toast);
    }
    toast.textContent = '✓ Config saved';
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
  }
  window.exportConfig = exportConfig;

  let saveTimeout;
  function debounceAutoSave() {
    if (!params.autoSave) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(exportConfig, 2000);
  }
  window.debounceAutoSave = debounceAutoSave;

  // Push undo snapshot on any GUI change (debounced to avoid spamming on sliders)
  // Guard flag prevents callbacks firing during programmatic GUI rebuilds
  let pendingUndoSnapshot = null;
  let guiRebuilding = false;
  window._setGuiRebuilding = (v) => { guiRebuilding = v; };

  if (typeof gui.onFinishChange === 'function') {
    gui.onFinishChange(() => {
      if (guiRebuilding) return;
      if (pendingUndoSnapshot) {
        undoStack.push(pendingUndoSnapshot);
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        redoStack.length = 0;
      }
      pendingUndoSnapshot = null;
    });
  }
  gui.onChange(() => {
    if (guiRebuilding) return;
    if (!pendingUndoSnapshot) {
      pendingUndoSnapshot = captureSnapshot();
    }
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
        f.setVisibility(v, params.conesEnabled !== false);
      });
      // Force generators off when par lights are disabled
      if (window.setTraceObjectsVisibility) {
        window.setTraceObjectsVisibility(v && params.generatorsVisible);
      }
    },
    conesEnabled: (v) => {
      window.parFixtures.forEach((f) => {
        f.setVisibility(params.parsEnabled !== false, v);
      });
    },
    editMode: (isEditMode) => {
      if (!model) return;
      model.traverse((child) => {
        if (child.isMesh)
          child.material = isEditMode ? editMaterial : structureMaterial;
      });
      renderer.shadowMap.enabled = !isEditMode;
      // Only toggle shadows on moon + tower floods, NOT par lights
      if (lights.moon) lights.moon.castShadow = !isEditMode;
      lights.towers.forEach((t) => { t.castShadow = !isEditMode; });
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

  // Expose applyAllHandlers for undo/redo to sync Three.js scene from params
  window.applyAllHandlers = function () {
    for (const key of Object.keys(handlers)) {
      if (params[key] !== undefined) {
        try { handlers[key](params[key]); } catch (_) {}
      }
    }
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

  // ─── Color Wave Section ─────────────────────────────────────────────────
  function buildColorWaveSection(parentFolder, sectionConfig) {
    const waveFolder = parentFolder.addFolder(sectionConfig._section.label);
    if (sectionConfig._section.collapsed) waveFolder.close();

    if (!params.gradientStops || params.gradientStops.length === 0) {
      params.gradientStops = ['#8cc0ff', '#a699ff', '#cc8cff', '#a699ff', '#8cc0ff'];
    }

    // Ensure configTree entry exists
    if (sectionConfig && !sectionConfig.gradientStops) {
      sectionConfig.gradientStops = params.gradientStops;
    }

    // Enable + Speed
    waveFolder.add(params, 'waveEnabled').name('Enabled').onChange(v => {
      window.toggleColorWave(v);
      if (!v && window.parFixtures) {
        window.parFixtures.forEach(f => {
          if (f && f.config) {
            f.light.color.set(f.config.color);
            if (f.beam && f.beam.material) f.beam.material.color.set(f.config.color);
          }
        });
      }
      debounceAutoSave();
    });
    waveFolder.add(params, 'waveSpeed', 0.05, 2.0, 0.05).name('Speed').onChange(() => { debounceAutoSave(); });

    // ─── Gradient Preview Bar ───
    const previewDiv = document.createElement('div');
    previewDiv.style.cssText = 'padding:4px 8px 8px;';
    const previewBar = document.createElement('div');
    previewBar.style.cssText = 'height:16px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);';
    previewDiv.appendChild(previewBar);

    function updatePreview() {
      const stops = params.gradientStops;
      if (!stops || stops.length === 0) return;
      const cssStops = stops.map((c, i) => `${c} ${(i / (stops.length - 1)) * 100}%`).join(', ');
      previewBar.style.background = `linear-gradient(90deg, ${cssStops})`;
    }
    updatePreview();

    const wChildren = waveFolder.domElement.querySelector('.children');
    if (wChildren) wChildren.appendChild(previewDiv);

    // ─── Building gradient stop controls ───
    let stopsFolder = null;

    function renderStopControls() {
      if (stopsFolder) {
        stopsFolder.destroy();
      }
      stopsFolder = waveFolder.addFolder('Gradient Stops');

      const stopProxy = {};
      params.gradientStops.forEach((color, i) => {
        const key = `stop${i}`;
        stopProxy[key] = color;
        stopsFolder.addColor(stopProxy, key).name(`Stop ${i + 1}`).onChange(v => {
          params.gradientStops[i] = v;
          updatePreview();
          debounceAutoSave();
        });
      });

      // Add / Remove buttons
      const btnDiv = document.createElement('div');
      btnDiv.style.cssText = 'display:flex;gap:4px;padding:4px 8px 6px;';

      const addBtn = document.createElement('button');
      addBtn.textContent = '+ Add Stop';
      addBtn.style.cssText = 'flex:1;padding:5px 0;border:1px solid rgba(255,255,255,0.12);border-radius:4px;background:rgba(255,255,255,0.04);color:#aaa;cursor:pointer;font-size:11px;font-family:inherit;';
      addBtn.onclick = () => {
        // Duplicate the last color
        const last = params.gradientStops[params.gradientStops.length - 1] || '#ffffff';
        params.gradientStops.push(last);
        renderStopControls();
        updatePreview();
        debounceAutoSave();
      };
      btnDiv.appendChild(addBtn);

      if (params.gradientStops.length > 2) {
        const rmBtn = document.createElement('button');
        rmBtn.textContent = '− Remove Last';
        rmBtn.style.cssText = 'flex:1;padding:5px 0;border:1px solid rgba(200,80,80,0.2);border-radius:4px;background:rgba(60,20,20,0.3);color:#c66;cursor:pointer;font-size:11px;font-family:inherit;';
        rmBtn.onclick = () => {
          params.gradientStops.pop();
          renderStopControls();
          updatePreview();
          debounceAutoSave();
        };
        btnDiv.appendChild(rmBtn);
      }

      const sfChildren = stopsFolder.domElement.querySelector('.children');
      if (sfChildren) sfChildren.appendChild(btnDiv);

      // Re-add preview after stops
      if (wChildren) wChildren.appendChild(previewDiv);
    }

    renderStopControls();

    // Initial enable state
    if (params.waveEnabled) {
      window.toggleColorWave(true);
    }
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
        // Special: ledStrandArray → build LED Strands UI
        if (sectionMeta.type === "ledStrandArray") {
          buildLedStrandsSection(parentFolder, entry);
          continue;
        }
        // Special: icebergArray → build Icebergs UI
        if (sectionMeta.type === "icebergArray") {
          buildIcebergsSection(parentFolder, entry);
          continue;
        }
        // Special: colorWave (has gradientStops)
        if (entry.gradientStops) {
          buildColorWaveSection(parentFolder, entry);
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
    // ─── Layout Tools (top-level, above Par Lights) ───
    const layoutFolder = parentFolder.addFolder("Layout Tools");
    layoutFolder.close();

    layoutFolder
      .add(params, "fixtureToolMode", ["translate", "rotate", "scale"])
      .name("Mode")
      .onChange((v) => {
        transformControl.setMode(v);
      });

    if (params.snapEnabled === undefined) params.snapEnabled = true;
    if (params.snapAngle === undefined) params.snapAngle = 5;

    function applySnap() {
      if (params.snapEnabled) {
        transformControl.setRotationSnap(THREE.MathUtils.degToRad(params.snapAngle));
        transformControl.setTranslationSnap(params.snapAngle * 0.1);
      } else {
        transformControl.setRotationSnap(null);
        transformControl.setTranslationSnap(null);
      }
    }

    layoutFolder
      .add(params, "snapEnabled")
      .name("Snap")
      .onChange(applySnap);

    layoutFolder
      .add(params, "snapAngle", [1, 5, 10, 15, 30, 45, 90])
      .name("Snap Step (°)")
      .onChange((v) => {
        applySnap();
        if (window._setGuiRebuilding) window._setGuiRebuilding(true);
        renderParGUI();
        if (window._setGuiRebuilding) window._setGuiRebuilding(false);
      });

    applySnap();

    layoutFolder
      .add(
        { snapPlace: () => { toggleSnapMode(); } },
        "snapPlace",
      )
      .name("Place on Surface [P]");

    layoutFolder
      .add(
        {
          toggleSpace: () => {
            transformControl.setSpace(
              transformControl.space === "local" ? "world" : "local"
            );
          },
        },
        "toggleSpace",
      )
      .name("Toggle Local/World [Q]");

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

    const parListFolder = parFolder.addFolder("Light Instances");

    // ─── Compact toolbar row: Collapse All | Select All | Clear All ───
    const toolbarDiv = document.createElement('div');
    toolbarDiv.style.cssText = 'display:flex;gap:2px;padding:2px 8px 4px;';
    const btnStyle = 'flex:1;padding:3px 0;border:none;border-radius:3px;background:#2a2a2a;color:#ddd;cursor:pointer;font-size:11px;font-family:inherit;';
    const btnHover = 'background:#3a3a3a';

    const collapseBtn = document.createElement('button');
    collapseBtn.textContent = '▼ Collapse';
    collapseBtn.style.cssText = btnStyle;
    collapseBtn.onmouseenter = () => collapseBtn.style.background = '#3a3a3a';
    collapseBtn.onmouseleave = () => collapseBtn.style.background = '#2a2a2a';
    collapseBtn.onclick = () => parListFolder.folders.forEach((f) => f.close());

    const selectBtn = document.createElement('button');
    selectBtn.textContent = '☑ Select All';
    selectBtn.style.cssText = btnStyle;
    selectBtn.onmouseenter = () => selectBtn.style.background = '#3a3a3a';
    selectBtn.onmouseleave = () => selectBtn.style.background = '#2a2a2a';
    selectBtn.onclick = () => {
      deselectAllFixtures();
      window.parFixtures.forEach((f) => {
        selectedFixtureIndices.add(f.index);
        f.setSelected(true);
      });
    };

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '🗑 Clear All';
    clearBtn.style.cssText = btnStyle;
    clearBtn.onmouseenter = () => clearBtn.style.background = '#3a3a3a';
    clearBtn.onmouseleave = () => clearBtn.style.background = '#2a2a2a';
    clearBtn.onclick = () => {
      if (params.parLights.length === 0) return;
      pushUndo();
      params.parLights.length = 0;
      if (window._setGuiRebuilding) window._setGuiRebuilding(true);
      renderParGUI();
      rebuildParLights();
      if (window._setGuiRebuilding) window._setGuiRebuilding(false);
      transformControl.detach();
      debounceAutoSave();
    };

    toolbarDiv.appendChild(collapseBtn);
    toolbarDiv.appendChild(selectBtn);
    toolbarDiv.appendChild(clearBtn);
    parListFolder.domElement.querySelector('.children').prepend(toolbarDiv);

    function renderParGUI() {
      // Remember which groups were open before rebuild
      const openGroups = new Set();
      parListFolder.folders.forEach((f) => {
        if (!f._closed) openGroups.add(f._title);
      });

      const children = [...parListFolder.folders];
      children.forEach((f) => f.destroy());
      window.parGuiFolders = [];

      // Ensure all lights have a group
      params.parLights.forEach((c) => {
        if (!c.group) c.group = 'Default';
      });

      // Helper: propagate a property change to all other selected fixtures
      function propagateToSelected(sourceIndex, property, value) {
        if (!selectedFixtureIndices.has(sourceIndex)) return;
        for (const idx of selectedFixtureIndices) {
          if (idx === sourceIndex) continue;
          if (params.parLights[idx]) {
            params.parLights[idx][property] = value;
            window.syncLightFromConfig(idx);
          }
        }
      }

      // Collect unique groups in order of appearance
      const groupOrder = [];
      const groupMap = new Map();
      params.parLights.forEach((config, index) => {
        const g = config.group || 'Default';
        if (!groupMap.has(g)) {
          groupMap.set(g, []);
          groupOrder.push(g);
        }
        groupMap.get(g).push({ config, index });
      });

      // Ensure at least one group exists
      if (groupOrder.length === 0) groupOrder.push('Default');

      groupOrder.forEach((groupName) => {
        const items = groupMap.get(groupName) || [];
        const groupFolder = parListFolder.addFolder(`${groupName} (${items.length})`);

        // Check if this is a trace-generated group (read-only)
        const isTraceGroup = items.some(({ config }) => config._traceGenerated);
        // Restore open state or default closed
        if (openGroups.has(`${groupName} (${items.length - 1})`) ||
            openGroups.has(`${groupName} (${items.length})`) ||
            openGroups.has(`${groupName} (${items.length + 1})`)) {
          groupFolder.open();
        } else {
          groupFolder.close();
        }

        // Trace-generated groups: show simplified read-only view with On/Off toggle
        if (isTraceGroup) {
          const gBtnStyle2 = 'flex:1;padding:2px 0;border:none;border-radius:3px;background:#2a2a2a;cursor:pointer;font-size:10px;font-family:inherit;';
          const traceRow = document.createElement('div');
          traceRow.style.cssText = 'display:flex;gap:2px;padding:2px 6px 4px;align-items:center;';

          const groupHidden = items.length > 0 && items.every(({ index }) =>
            window.parFixtures[index] && !window.parFixtures[index].light.visible
          );
          const visBtn = document.createElement('button');
          visBtn.textContent = groupHidden ? '○ Off' : '● On';
          visBtn.style.cssText = gBtnStyle2 + (groupHidden ? 'color:#666;' : 'color:#6f6;');
          visBtn.onclick = () => {
            const turnOn = visBtn.textContent.includes('Off');
            items.forEach(({ index }) => {
              const f = window.parFixtures[index];
              if (f) f.setVisibility(turnOn, params.conesEnabled !== false);
            });
            visBtn.textContent = turnOn ? '● On' : '○ Off';
            visBtn.style.cssText = gBtnStyle2 + (turnOn ? 'color:#6f6;' : 'color:#666;');
            document.activeElement?.blur?.();
          };

          const lockLabel = document.createElement('span');
          lockLabel.style.cssText = 'color:#888;font-size:10px;font-style:italic;margin-left:4px;';
          lockLabel.textContent = '🔒 Generated — edit via Generator';

          traceRow.appendChild(visBtn);
          traceRow.appendChild(lockLabel);
          const gc = groupFolder.domElement.querySelector('.children');
          if (gc) gc.prepend(traceRow);
          return;
        }

        // ─── Group toolbar (2 rows) ───
        const gtbWrap = document.createElement('div');
        gtbWrap.style.cssText = 'padding:2px 6px 4px;';
        const gBtnStyle = 'flex:1;padding:2px 0;border:none;border-radius:3px;background:#2a2a2a;color:#aaa;cursor:pointer;font-size:10px;font-family:inherit;';

        // Row 1: Select All | Visible toggle
        const row1 = document.createElement('div');
        row1.style.cssText = 'display:flex;gap:2px;margin-bottom:2px;';

        const selBtn = document.createElement('button');
        selBtn.textContent = '☑ Select All';
        selBtn.style.cssText = gBtnStyle;
        selBtn.onclick = () => {
          deselectAllFixtures();
          items.forEach(({ index }) => {
            selectedFixtureIndices.add(index);
            if (window.parFixtures[index]) {
              window.parFixtures[index].setSelected(true);
            }
          });
          // Attach transform to first light in group for batch moving
          if (items.length > 0 && window.parFixtures[items[0].index]) {
            transformControl.attach(window.parFixtures[items[0].index].hitbox);
          }
          syncGuiFolders();
          renderer.domElement.focus({ preventScroll: true });
          document.activeElement?.blur?.();
        };

        const visBtn = document.createElement('button');
        // Track group visibility state
        const groupHidden = items.length > 0 && items.every(({ index }) =>
          window.parFixtures[index] && !window.parFixtures[index].light.visible
        );
        visBtn.textContent = groupHidden ? '○ Off' : '● On';
        visBtn.style.cssText = gBtnStyle + (groupHidden ? 'color:#666;' : 'color:#6f6;');
        visBtn.onclick = () => {
          const turnOn = visBtn.textContent.includes('Off');
          items.forEach(({ index }) => {
            const f = window.parFixtures[index];
            if (f) f.setVisibility(turnOn, params.conesEnabled !== false);
          });
          visBtn.textContent = turnOn ? '● On' : '○ Off';
          visBtn.style.cssText = gBtnStyle + (turnOn ? 'color:#6f6;' : 'color:#666;');
          renderer.domElement.focus({ preventScroll: true });
          document.activeElement?.blur?.();
        };

        row1.appendChild(selBtn);
        row1.appendChild(visBtn);

        // Row 2: Rename | + Light | ✕ Delete
        const row2 = document.createElement('div');
        row2.style.cssText = 'display:flex;gap:2px;';

        const renameBtn = document.createElement('button');
        renameBtn.textContent = '✏ Rename';
        renameBtn.style.cssText = gBtnStyle;
        renameBtn.onclick = () => {
          const newName = prompt('Rename group:', groupName);
          if (newName && newName !== groupName) {
            params.parLights.forEach((c) => {
              if (c.group === groupName) c.group = newName;
            });
            if (window._setGuiRebuilding) window._setGuiRebuilding(true);
            renderParGUI();
            if (window._setGuiRebuilding) window._setGuiRebuilding(false);
            debounceAutoSave();
          }
        };

        const addBtn = document.createElement('button');
        addBtn.textContent = '+ Light';
        addBtn.style.cssText = gBtnStyle;
        addBtn.onclick = () => {
          pushUndo();
          const idx = params.parLights.length + 1;
          params.parLights.push({
            group: groupName,
            name: `Par Light ${idx}`,
            color: '#ffaa44', intensity: 5, angle: 20, penumbra: 0.5,
            x: 0, y: 1.5, z: 0, rotX: 0, rotY: 0, rotZ: 0,
          });
          if (window._setGuiRebuilding) window._setGuiRebuilding(true);
          renderParGUI();
          rebuildParLights();
          if (window._setGuiRebuilding) window._setGuiRebuilding(false);
          debounceAutoSave();
        };

        const delBtn = document.createElement('button');
        delBtn.textContent = '✕ Delete';
        delBtn.style.cssText = gBtnStyle;
        delBtn.onclick = () => {
          if (groupOrder.length <= 1) return;
          pushUndo();
          params.parLights.forEach((c) => {
            if (c.group === groupName) c.group = groupOrder.find(g => g !== groupName) || 'Default';
          });
          if (window._setGuiRebuilding) window._setGuiRebuilding(true);
          renderParGUI();
          if (window._setGuiRebuilding) window._setGuiRebuilding(false);
          debounceAutoSave();
        };

        row2.appendChild(renameBtn);
        row2.appendChild(addBtn);
        row2.appendChild(delBtn);

        gtbWrap.appendChild(row1);
        gtbWrap.appendChild(row2);
        const groupChildren = groupFolder.domElement.querySelector('.children');
        if (groupChildren) groupChildren.prepend(gtbWrap);

        // ─── Lights in this group ───
        items.forEach(({ config, index }) => {
          if (config.name === undefined) config.name = `Par Light ${index + 1}`;
          if (config.x === undefined) config.x = 0;
          if (config.y === undefined) config.y = 1.5;
          if (config.z === undefined) config.z = 0;
          if (config.rotX === undefined) config.rotX = 0;
          if (config.rotY === undefined) config.rotY = 0;
          if (config.rotZ === undefined) config.rotZ = 0;

          const idxFolder = groupFolder.addFolder(config.name);
          idxFolder.domElement.classList.add('gui-card');
          idxFolder.close();
          window.parGuiFolders[index] = idxFolder;

          function selectThisLight() {
            const fixture = window.parFixtures[index];
            if (fixture && fixture.hitbox) {
              transformControl.attach(fixture.hitbox);
            }
          }
          if (typeof idxFolder.onOpenClose === 'function') {
            idxFolder.onOpenClose((open) => { if (open) selectThisLight(); });
          } else if (idxFolder.domElement) {
            idxFolder.domElement.querySelector('.title')?.addEventListener('click', () => {
              if (!idxFolder._closed) selectThisLight();
            });
          }

          idxFolder.add(config, "name").name("Name").onFinishChange((v) => {
            idxFolder.title(v);
            propagateToSelected(index, 'name', v);
            debounceAutoSave();
          });

          idxFolder.addColor(config, "color").onChange((v) => {
            selectThisLight();
            window.syncLightFromConfig(index);
            propagateToSelected(index, 'color', v);
          });
          idxFolder.add(config, "intensity", 0, 200, 0.5).onChange((v) => {
            selectThisLight();
            window.syncLightFromConfig(index);
            propagateToSelected(index, 'intensity', v);
          });
          idxFolder.add(config, "angle", 5, 90, 1).listen().onChange((v) => {
            selectThisLight();
            window.syncLightFromConfig(index);
            propagateToSelected(index, 'angle', v);
          });
          idxFolder.add(config, "penumbra", 0, 1, 0.05).onChange((v) => {
            selectThisLight();
            window.syncLightFromConfig(index);
            propagateToSelected(index, 'penumbra', v);
          });

          // Position
          const posFolder = idxFolder.addFolder("Position");
          posFolder.close();
          posFolder.add(config, "x", -200, 200, 0.01).listen().onChange((v) => {
            selectThisLight(); window.syncLightFromConfig(index); propagateToSelected(index, 'x', v);
          });
          posFolder.add(config, "y", 0, 100, 0.01).listen().onChange((v) => {
            selectThisLight(); window.syncLightFromConfig(index); propagateToSelected(index, 'y', v);
          });
          posFolder.add(config, "z", -200, 200, 0.01).listen().onChange((v) => {
            selectThisLight(); window.syncLightFromConfig(index); propagateToSelected(index, 'z', v);
          });

          // Rotation
          const rotFolder = idxFolder.addFolder("Rotation");
          rotFolder.close();
          const step = params.snapAngle || 5;
          rotFolder.add(config, "rotX", -180, 180, step).listen().onChange((v) => {
            selectThisLight(); window.syncLightFromConfig(index); propagateToSelected(index, 'rotX', v);
          });
          rotFolder.add(config, "rotY", -180, 180, step).listen().onChange((v) => {
            selectThisLight(); window.syncLightFromConfig(index); propagateToSelected(index, 'rotY', v);
          });
          rotFolder.add(config, "rotZ", -180, 180, step).listen().onChange((v) => {
            selectThisLight(); window.syncLightFromConfig(index); propagateToSelected(index, 'rotZ', v);
          });

          // Compact action row
          const actDiv = document.createElement('div');
          actDiv.style.cssText = 'display:flex;gap:2px;padding:2px 6px 4px;';
          const aBtnStyle = 'flex:1;padding:2px 0;border:none;border-radius:3px;background:#2a2a2a;color:#aaa;cursor:pointer;font-size:10px;font-family:inherit;';

          const dupBtn = document.createElement('button');
          dupBtn.textContent = '⧉ Duplicate';
          dupBtn.style.cssText = aBtnStyle;
          dupBtn.onclick = () => {
            pushUndo();
            const clone = JSON.parse(JSON.stringify(config));
            clone.name = nextFixtureName(clone.name || 'Par Light');
            clone.x = (clone.x || 0) + 2;
            params.parLights.push(clone);
            if (window._setGuiRebuilding) window._setGuiRebuilding(true);
            renderParGUI();
            rebuildParLights();
            if (window._setGuiRebuilding) window._setGuiRebuilding(false);
            debounceAutoSave();
          };

          const rmBtn = document.createElement('button');
          rmBtn.textContent = '✕ Remove';
          rmBtn.style.cssText = aBtnStyle;
          rmBtn.onclick = () => {
            pushUndo();
            params.parLights.splice(index, 1);
            if (window._setGuiRebuilding) window._setGuiRebuilding(true);
            renderParGUI();
            rebuildParLights();
            if (window._setGuiRebuilding) window._setGuiRebuilding(false);
            debounceAutoSave();
          };

          // Move to group dropdown
          const moveSelect = document.createElement('select');
          moveSelect.style.cssText = 'flex:1;padding:2px;border:none;border-radius:3px;background:#2a2a2a;color:#aaa;font-size:10px;font-family:inherit;cursor:pointer;';
          const defaultOpt = document.createElement('option');
          defaultOpt.textContent = '→ Move…';
          defaultOpt.disabled = true;
          defaultOpt.selected = true;
          moveSelect.appendChild(defaultOpt);
          groupOrder.forEach((g) => {
            if (g === groupName) return;
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            moveSelect.appendChild(opt);
          });
          moveSelect.onchange = () => {
            config.group = moveSelect.value;
            if (window._setGuiRebuilding) window._setGuiRebuilding(true);
            renderParGUI();
            if (window._setGuiRebuilding) window._setGuiRebuilding(false);
            debounceAutoSave();
          };

          actDiv.appendChild(dupBtn);
          actDiv.appendChild(rmBtn);
          if (groupOrder.length > 1) actDiv.appendChild(moveSelect);
          const idxChildren = idxFolder.domElement.querySelector('.children');
          if (idxChildren) idxChildren.appendChild(actDiv);
        });
      });
    }

    // ─── Add Group button ───
    parFolder
      .add(
        {
          addGroup: () => {
            const existingGroups = new Set(params.parLights.map(c => c.group || 'Default'));
            const name = prompt('New group name:', `Group ${existingGroups.size + 1}`);
            if (!name) return;
            pushUndo();
            params.parLights.push({
              group: name,
              name: `Par Light ${params.parLights.length + 1}`,
              color: '#ffaa44', intensity: 5, angle: 20, penumbra: 0.5,
              x: 0, y: 1.5, z: 0, rotX: 0, rotY: 0, rotZ: 0,
            });
            if (window._setGuiRebuilding) window._setGuiRebuilding(true);
            renderParGUI();
            rebuildParLights();
            if (window._setGuiRebuilding) window._setGuiRebuilding(false);
            debounceAutoSave();
          },
        },
        "addGroup",
      )
      .name("➕ Add Group");

    // ═══════════════════════════════════════════════════════════════════════
    // ─── Group Generator (Traces) ─────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════
    const genFolder = parFolder.addFolder("📐 Group Generator");
    genFolder.close();

    // Show/hide generator trace objects
    if (params.generatorsVisible === undefined) params.generatorsVisible = true;

    function setTraceObjectsVisibility(visible) {
      (window.traceObjects || []).forEach(t => {
        if (t.group) t.group.visible = visible;
        if (t.hitbox) t.hitbox.visible = visible;
        (t.handles || []).forEach(h => { h.visible = visible; });
      });
    }
    window.setTraceObjectsVisibility = setTraceObjectsVisibility;

    genFolder.add(params, 'generatorsVisible').name('Show Generators').onChange(v => {
      setTraceObjectsVisibility(v);
    });

    // --- Trace 3D objects live here ---
    window.traceObjects = window.traceObjects || [];

    function destroyTraceObjects() {
      (window.traceObjects || []).forEach(t => {
        if (t.group) scene.remove(t.group);
        if (t.hitbox) {
          scene.remove(t.hitbox);
          const ioIdx = interactiveObjects.indexOf(t.hitbox);
          if (ioIdx > -1) interactiveObjects.splice(ioIdx, 1);
        }
        (t.handles || []).forEach(h => {
          scene.remove(h);
          const ioIdx = interactiveObjects.indexOf(h);
          if (ioIdx > -1) interactiveObjects.splice(ioIdx, 1);
        });
      });
      window.traceObjects = [];
    }

    function computeTracePoints(trace) {
      const pts = [];
      if (trace.shape === 'circle') {
        const r = trace.radius || 5;
        const arcRad = THREE.MathUtils.degToRad(trace.arc || 360);
        const circumference = r * arcRad;
        const count = Math.max(1, Math.round(circumference / (trace.spacing || 2)));
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * arcRad;
          pts.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
        }
      } else {
        // line: world-space start→end
        const start = new THREE.Vector3(trace.startX ?? 0, trace.startY ?? 5, trace.startZ ?? 0);
        const end   = new THREE.Vector3(trace.endX ?? 10, trace.endY ?? 5, trace.endZ ?? 0);
        const totalLen = start.distanceTo(end);
        const count = Math.max(2, Math.round(totalLen / (trace.spacing || 2)));
        for (let i = 0; i < count; i++) {
          const t = i / (count - 1);
          pts.push(new THREE.Vector3().lerpVectors(start, end, t));
        }
      }
      return pts;
    }

    function buildTraceObject(trace, traceIndex) {
      const handles = []; // For line: [startHandle, endHandle]; For circle: []

      if (trace.shape === 'line') {
        // ─── LINE: two draggable endpoint handles ───
        const startPos = new THREE.Vector3(trace.startX ?? 0, trace.startY ?? 5, trace.startZ ?? 0);
        const endPos = new THREE.Vector3(trace.endX ?? 10, trace.endY ?? 5, trace.endZ ?? 0);

        // Visual group (wireframe + preview dots) — rebuilt live
        const grp = new THREE.Group();

        // Wireframe line between endpoints
        const lineGeo = new THREE.BufferGeometry().setFromPoints([startPos, endPos]);
        const lineMat = new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.7 });
        grp.add(new THREE.Line(lineGeo, lineMat));

        // Preview dots at light positions
        const lightPts = computeTracePoints(trace);
        const dotGeo = new THREE.SphereGeometry(0.15, 6, 6);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
        lightPts.forEach(p => {
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.copy(p);
          grp.add(dot);
        });

        scene.add(grp);

        // Draggable handle spheres at scene root
        const handleGeo = new THREE.SphereGeometry(0.4, 12, 12);
        const startMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.7 });
        const endMat   = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.7 });

        const startHandle = new THREE.Mesh(handleGeo, startMat);
        startHandle.position.copy(startPos);
        startHandle.userData = { isTrace: true, traceIndex, handleType: 'start' };
        scene.add(startHandle);
        interactiveObjects.push(startHandle);

        const endHandle = new THREE.Mesh(handleGeo, endMat);
        endHandle.position.copy(endPos);
        endHandle.userData = { isTrace: true, traceIndex, handleType: 'end' };
        scene.add(endHandle);
        interactiveObjects.push(endHandle);

        // Aim handle (yellow sphere)
        const aimHandleGeo = new THREE.SphereGeometry(0.35, 12, 12);
        const aimHandleMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.8 });
        const aimHandle = new THREE.Mesh(aimHandleGeo, aimHandleMat);
        aimHandle.position.set(trace.aimX || 0, trace.aimY || 0, trace.aimZ || 0);
        aimHandle.userData = { isTrace: true, traceIndex, handleType: 'aim' };
        scene.add(aimHandle);
        interactiveObjects.push(aimHandle);

        // Dashed line from midpoint to aim handle
        const mid = startPos.clone().lerp(endPos, 0.5);
        const aimLineGeo = new THREE.BufferGeometry().setFromPoints([mid, aimHandle.position]);
        const aimLineMat = new THREE.LineDashedMaterial({ color: 0xffcc00, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 0.5 });
        const aimLine = new THREE.Line(aimLineGeo, aimLineMat);
        aimLine.computeLineDistances();
        grp.add(aimLine);

        return { group: grp, hitbox: null, handles: [startHandle, endHandle, aimHandle], traceIndex };

      } else {
        // ─── CIRCLE: center hitbox (existing approach) ───
        const grp = new THREE.Group();
        grp.position.set(trace.x || 0, trace.y || 5, trace.z || 0);
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(trace.rotX || 0),
          THREE.MathUtils.degToRad(trace.rotY || 0),
          THREE.MathUtils.degToRad(trace.rotZ || 0), 'YXZ'
        );
        grp.setRotationFromEuler(euler);

        // Wireframe ring
        const pathPts = [];
        const r = trace.radius || 5;
        const arcRad = THREE.MathUtils.degToRad(trace.arc || 360);
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * arcRad;
          pathPts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
        }
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pathPts);
        const lineMat = new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.7 });
        grp.add(new THREE.Line(lineGeo, lineMat));

        // Preview dots
        const lightPts = computeTracePoints(trace);
        const dotGeo = new THREE.SphereGeometry(0.15, 6, 6);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
        lightPts.forEach(p => {
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.copy(p);
          grp.add(dot);
        });

        scene.add(grp);

        // Hitbox at scene root
        const hitboxSize = (trace.radius || 5) * 2.5;
        const hitboxGeo = new THREE.BoxGeometry(hitboxSize, 1, hitboxSize);
        const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
        hitbox.userData = { isTrace: true, traceIndex };
        hitbox.position.copy(grp.position);
        hitbox.quaternion.copy(grp.quaternion);
        scene.add(hitbox);
        interactiveObjects.push(hitbox);

        // Aim handle (yellow sphere)
        const aimHandleGeo = new THREE.SphereGeometry(0.35, 12, 12);
        const aimHandleMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.8 });
        const aimHandle = new THREE.Mesh(aimHandleGeo, aimHandleMat);
        aimHandle.position.set(trace.aimX || 0, trace.aimY || 0, trace.aimZ || 0);
        aimHandle.userData = { isTrace: true, traceIndex, handleType: 'aim' };
        scene.add(aimHandle);
        interactiveObjects.push(aimHandle);

        return { group: grp, hitbox, handles: [aimHandle], traceIndex };
      }
    }

    function rebuildTraceObjects() {
      destroyTraceObjects();
      params.traces.forEach((trace, i) => {
        window.traceObjects.push(buildTraceObject(trace, i));
      });
    }
    window.rebuildTraceObjects = rebuildTraceObjects;

    function updateTracePreview(traceIndex) {
      rebuildTraceObjects();
    }

    function writeTraceTransformToConfig(traceIndex) {
      const tObj = window.traceObjects[traceIndex];
      if (!tObj) return;
      const trace = params.traces[traceIndex];
      const hitbox = tObj.hitbox;
      trace.x = hitbox.position.x;
      trace.y = hitbox.position.y;
      trace.z = hitbox.position.z;
      const euler = new THREE.Euler().setFromQuaternion(hitbox.quaternion, 'YXZ');
      trace.rotX = THREE.MathUtils.radToDeg(euler.x);
      trace.rotY = THREE.MathUtils.radToDeg(euler.y);
      trace.rotZ = THREE.MathUtils.radToDeg(euler.z);
    }

    // Clean trace transform handler — hitbox is at scene root,
    // just copy its transform to the visual group
    window._onTraceTransformChange = function(obj) {
      if (!obj.userData.isTrace) return false;
      const tIdx = obj.userData.traceIndex;
      const tObj = window.traceObjects[tIdx];
      if (!tObj) return false;
      const trace = params.traces[tIdx];

      if (obj.userData.handleType === 'aim') {
        // Aim handle moved — update aim target
        trace.aimX = obj.position.x;
        trace.aimY = obj.position.y;
        trace.aimZ = obj.position.z;
      } else if (obj.userData.handleType === 'start' || obj.userData.handleType === 'end') {
        // Line handle moved — compute delta and move aim handle too
        const prevKey = obj.userData.handleType === 'start' ? 'startX' : 'endX';
        const dx = obj.position.x - (trace[prevKey === 'startX' ? 'startX' : 'endX'] ?? 0);
        const dy = obj.position.y - (trace[prevKey === 'startX' ? 'startY' : 'endY'] ?? 5);
        const dz = obj.position.z - (trace[prevKey === 'startX' ? 'startZ' : 'endZ'] ?? 0);

        // Move aim handle by same delta
        trace.aimX = (trace.aimX || 0) + dx;
        trace.aimY = (trace.aimY || 0) + dy;
        trace.aimZ = (trace.aimZ || 0) + dz;

        // Update the handle config
        if (obj.userData.handleType === 'start') {
          trace.startX = obj.position.x;
          trace.startY = obj.position.y;
          trace.startZ = obj.position.z;
        } else {
          trace.endX = obj.position.x;
          trace.endY = obj.position.y;
          trace.endZ = obj.position.z;
        }

        // Move the aim handle mesh to match
        const aimHandle = (tObj.handles || []).find(h => h.userData.handleType === 'aim');
        if (aimHandle) aimHandle.position.set(trace.aimX, trace.aimY, trace.aimZ);

        // Live-update the wireframe line + dots without full rebuild
        if (tObj.group) {
          scene.remove(tObj.group);
          const grp = new THREE.Group();
          const s = new THREE.Vector3(trace.startX ?? 0, trace.startY ?? 5, trace.startZ ?? 0);
          const e = new THREE.Vector3(trace.endX ?? 10, trace.endY ?? 5, trace.endZ ?? 0);
          const lineGeo = new THREE.BufferGeometry().setFromPoints([s, e]);
          const lineMat = new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.7 });
          grp.add(new THREE.Line(lineGeo, lineMat));
          const pts = computeTracePoints(trace);
          const dotGeo = new THREE.SphereGeometry(0.15, 6, 6);
          const dotMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
          pts.forEach(p => { const d = new THREE.Mesh(dotGeo, dotMat); d.position.copy(p); grp.add(d); });
          scene.add(grp);
          tObj.group = grp;
        }
      } else {
        // Circle hitbox — compute position delta and move aim handle too
        const dx = obj.position.x - (trace.x || 0);
        const dy = obj.position.y - (trace.y || 5);
        const dz = obj.position.z - (trace.z || 0);

        trace.aimX = (trace.aimX || 0) + dx;
        trace.aimY = (trace.aimY || 0) + dy;
        trace.aimZ = (trace.aimZ || 0) + dz;

        const aimHandle = (tObj.handles || []).find(h => h.userData.handleType === 'aim');
        if (aimHandle) aimHandle.position.set(trace.aimX, trace.aimY, trace.aimZ);

        tObj.group.position.copy(tObj.hitbox.position);
        tObj.group.quaternion.copy(tObj.hitbox.quaternion);
        trace.x = obj.position.x;
        trace.y = obj.position.y;
        trace.z = obj.position.z;
        const euler = new THREE.Euler().setFromQuaternion(obj.quaternion, 'YXZ');
        trace.rotX = THREE.MathUtils.radToDeg(euler.x);
        trace.rotY = THREE.MathUtils.radToDeg(euler.y);
        trace.rotZ = THREE.MathUtils.radToDeg(euler.z);
      }
      debounceAutoSave();
      return true;
    };

    function generateGroupFromTrace(traceIndex) {
      const trace = params.traces[traceIndex];
      if (!trace) return;

      pushUndo();

      // Remove existing lights from this trace's group name
      const groupName = trace.groupName || trace.name || `Trace ${traceIndex + 1}`;
      params.parLights = params.parLights.filter(l => l.group !== groupName || !l._traceGenerated);

      // Compute points
      const pts = computeTracePoints(trace);
      const isLine = trace.shape === 'line';
      const grp = window.traceObjects[traceIndex]?.group;
      if (!isLine && grp) grp.updateMatrixWorld(true);
      const worldMatrix = (!isLine && grp) ? grp.matrixWorld : null;

      pts.forEach((pt, i) => {
        // Line points are already world-space; circle points need worldMatrix
        const worldPt = worldMatrix ? pt.clone().applyMatrix4(worldMatrix) : pt.clone();

        // Compute aim rotation
        let rotX = 0, rotY = 0, rotZ = 0;
        if (trace.aimMode === 'lookAt') {
          const aimTarget = new THREE.Vector3(trace.aimX || 0, trace.aimY || 0, trace.aimZ || 0);
          const dir = aimTarget.clone().sub(worldPt).normalize();
          const defaultDir = new THREE.Vector3(0, 0, -1);
          const quat = new THREE.Quaternion().setFromUnitVectors(defaultDir, dir);
          const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
          rotX = THREE.MathUtils.radToDeg(euler.x);
          rotY = THREE.MathUtils.radToDeg(euler.y);
          rotZ = THREE.MathUtils.radToDeg(euler.z);
        } else if (trace.aimMode === 'direction') {
          // Common direction: from first light toward aim handle, applied to all
          const firstPt = worldMatrix ? pts[0].clone().applyMatrix4(worldMatrix) : pts[0].clone();
          const aimTarget = new THREE.Vector3(trace.aimX || 0, trace.aimY || 0, trace.aimZ || 0);
          const dir = aimTarget.clone().sub(firstPt).normalize();
          const defaultDir = new THREE.Vector3(0, 0, -1);
          const quat = new THREE.Quaternion().setFromUnitVectors(defaultDir, dir);
          const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
          rotX = THREE.MathUtils.radToDeg(euler.x);
          rotY = THREE.MathUtils.radToDeg(euler.y);
          rotZ = THREE.MathUtils.radToDeg(euler.z);
        }

        params.parLights.push({
          group: groupName,
          name: `${groupName} ${i + 1}`,
          color: trace.lightColor || '#ffaa44',
          intensity: trace.lightIntensity || 10,
          angle: trace.lightAngle || 30,
          penumbra: 0.5,
          x: worldPt.x, y: worldPt.y, z: worldPt.z,
          rotX, rotY, rotZ,
          _traceGenerated: true,
        });
      });

      trace.generated = true;

      if (window._setGuiRebuilding) window._setGuiRebuilding(true);
      rebuildParLights();
      renderParGUI();
      if (window._setGuiRebuilding) window._setGuiRebuilding(false);
      debounceAutoSave();
    }

    // --- Build Generator GUI ---
    window.traceGuiFolders = [];
    window.openTraceFolder = function(traceIndex) {
      genFolder.open();
      if (window.traceGuiFolders) {
        window.traceGuiFolders.forEach(f => { if (f) f.domElement.classList.remove('gui-card-selected'); });
      }
      if (window.traceGuiFolders[traceIndex]) {
        window.traceGuiFolders[traceIndex].open();
        window.traceGuiFolders[traceIndex].domElement.classList.add('gui-card-selected');
      }
    };
    function renderGeneratorGUI() {
      // Clear existing trace folders
      const existing = [...genFolder.folders];
      existing.forEach(f => f.destroy());
      window.traceGuiFolders = [];

      // New Trace buttons
      const newBtnDiv = document.createElement('div');
      newBtnDiv.style.cssText = 'display:flex;gap:2px;padding:4px 6px;';
      const btnStyle = 'flex:1;padding:4px 0;border:none;border-radius:3px;background:#2a2a2a;color:#ff8800;cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;';

      const newCircleBtn = document.createElement('button');
      newCircleBtn.textContent = '○ New Circle';
      newCircleBtn.style.cssText = btnStyle;
      newCircleBtn.onclick = () => {
        params.traces.push({
          name: `Circle ${params.traces.length + 1}`,
          shape: 'circle', radius: 5, arc: 360,
          spacing: 2, x: 0, y: 5, z: 0, rotX: 0, rotY: 0, rotZ: 0,
          aimMode: 'lookAt', aimX: 0, aimY: 0, aimZ: 0,
          lightColor: '#ffaa44', lightIntensity: 10, lightAngle: 30,
          groupName: `Ring ${params.traces.length + 1}`,
          generated: false,
        });
        rebuildTraceObjects();
        renderGeneratorGUI();
        debounceAutoSave();
      };

      const newLineBtn = document.createElement('button');
      newLineBtn.textContent = '— New Line';
      newLineBtn.style.cssText = btnStyle;
      newLineBtn.onclick = () => {
        params.traces.push({
          name: `Line ${params.traces.length + 1}`,
          shape: 'line',
          startX: -5, startY: 5, startZ: 0,
          endX: 5, endY: 5, endZ: 0,
          spacing: 2, 
          aimMode: 'direction', aimX: 0, aimY: -1, aimZ: 0,
          lightColor: '#ffaa44', lightIntensity: 10, lightAngle: 30,
          groupName: `Line ${params.traces.length + 1}`,
          generated: false,
        });
        rebuildTraceObjects();
        renderGeneratorGUI();
        debounceAutoSave();
      };

      newBtnDiv.appendChild(newCircleBtn);
      newBtnDiv.appendChild(newLineBtn);

      // Remove old button bar if present
      const genChildren = genFolder.domElement.querySelector('.children');
      if (genChildren) {
        const oldBtns = genChildren.querySelector('.trace-new-btns');
        if (oldBtns) oldBtns.remove();
        newBtnDiv.classList.add('trace-new-btns');
        genChildren.prepend(newBtnDiv);
      }

      // Trace sub-folders
      params.traces.forEach((trace, i) => {
        const label = `${trace.shape === 'circle' ? '○' : '—'} ${trace.name || `Trace ${i+1}`}`;
        const tFolder = genFolder.addFolder(label);
        tFolder.domElement.classList.add('gui-card');
        tFolder.close();
        window.traceGuiFolders[i] = tFolder;

        // Selection highlight
        if (typeof tFolder.onOpenClose === 'function') {
          tFolder.onOpenClose((open) => {
            if (open) {
              (window.traceGuiFolders || []).forEach(f => { if (f) f.domElement.classList.remove('gui-card-selected'); });
              tFolder.domElement.classList.add('gui-card-selected');
            } else {
              tFolder.domElement.classList.remove('gui-card-selected');
            }
          });
        }

        tFolder.add(trace, 'name').name('Name').onFinishChange(() => {
          trace.groupName = trace.name;
          renderGeneratorGUI();
          debounceAutoSave();
        });

        if (trace.shape === 'circle') {
          tFolder.add(trace, 'radius', 1, 50, 0.5).name('Radius').onChange(() => {
            updateTracePreview(i);
            debounceAutoSave();
          });
          tFolder.add(trace, 'arc', 10, 360, 5).name('Arc (°)').onChange(() => {
            updateTracePreview(i);
            debounceAutoSave();
          });
        } else {
          // Line: Start/End XYZ
          const startF = tFolder.addFolder('Start Point (green)');
          startF.close();
          startF.add(trace, 'startX', -100, 100, 0.5).name('X').listen().onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          startF.add(trace, 'startY', -100, 100, 0.5).name('Y').listen().onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          startF.add(trace, 'startZ', -100, 100, 0.5).name('Z').listen().onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          const endF = tFolder.addFolder('End Point (red)');
          endF.close();
          endF.add(trace, 'endX', -100, 100, 0.5).name('X').listen().onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          endF.add(trace, 'endY', -100, 100, 0.5).name('Y').listen().onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          endF.add(trace, 'endZ', -100, 100, 0.5).name('Z').listen().onChange(() => { updateTracePreview(i); debounceAutoSave(); });
        }

        // Show computed light count
        const lightPts = computeTracePoints(trace);
        const countInfo = { count: `${lightPts.length} lights` };
        const countCtrl = tFolder.add(countInfo, 'count').name('Preview').disable();

        tFolder.add(trace, 'spacing', 0.5, 10, 0.25).name('Spacing (m)').onChange(() => {
          const pts = computeTracePoints(trace);
          countInfo.count = `${pts.length} lights`;
          countCtrl.updateDisplay();
          updateTracePreview(i);
          debounceAutoSave();
        });

        // Aim mode
        tFolder.add(trace, 'aimMode', ['lookAt', 'direction']).name('Aim Mode').onChange(() => {
          renderGeneratorGUI();
          debounceAutoSave();
        });

        // Select Aim Target button
        const aimBtnDiv = document.createElement('div');
        aimBtnDiv.style.cssText = 'padding:2px 6px;';
        const aimBtn = document.createElement('button');
        aimBtn.textContent = '🎯 Select Aim Target';
        aimBtn.style.cssText = 'width:100%;padding:4px 0;border:none;border-radius:3px;background:#3a3a1a;color:#ffcc00;cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;';
        aimBtn.onclick = () => {
          const tObj = window.traceObjects[i];
          if (!tObj) return;
          // Find the aim handle (last in handles array for lines, first for circles)
          const aimHandle = (tObj.handles || []).find(h => h.userData.handleType === 'aim');
          if (aimHandle) {
            transformControl.attach(aimHandle);
          }
          aimBtn.blur();
        };
        aimBtnDiv.appendChild(aimBtn);
        const aimChildren = tFolder.domElement.querySelector('.children');
        if (aimChildren) aimChildren.appendChild(aimBtnDiv);

        // Light defaults
        const lightFolder = tFolder.addFolder('Light Defaults');
        lightFolder.close();
        lightFolder.addColor(trace, 'lightColor').name('Color');
        lightFolder.add(trace, 'lightIntensity', 1, 200, 1).name('Intensity');
        lightFolder.add(trace, 'lightAngle', 5, 90, 1).name('Angle');

        // Action buttons
        const actDiv = document.createElement('div');
        actDiv.style.cssText = 'display:flex;gap:2px;padding:4px 6px;';
        const aBtnStyle = 'flex:1;padding:4px 0;border:none;border-radius:3px;cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;';

        const genBtn = document.createElement('button');
        genBtn.textContent = trace.generated ? '↻ Regenerate' : '✓ Generate';
        genBtn.style.cssText = aBtnStyle + 'background:#1a3a1a;color:#3c3;';
        genBtn.onclick = () => generateGroupFromTrace(i);

        const delBtn = document.createElement('button');
        delBtn.textContent = '✕ Delete';
        delBtn.style.cssText = aBtnStyle + 'background:#3a1a1a;color:#c33;';
        delBtn.onclick = () => {
          pushUndo();
          const trace = params.traces[i];
          // Remove generated lights from this trace's group
          if (trace) {
            const groupName = trace.groupName || trace.name;
            params.parLights = params.parLights.filter(l => !(l.group === groupName && l._traceGenerated));
          }
          params.traces.splice(i, 1);
          if (window._setGuiRebuilding) window._setGuiRebuilding(true);
          rebuildParLights();
          rebuildTraceObjects();
          renderGeneratorGUI();
          renderParGUI();
          if (window._setGuiRebuilding) window._setGuiRebuilding(false);
          debounceAutoSave();
        };

        actDiv.appendChild(genBtn);
        actDiv.appendChild(delBtn);
        const tChildren = tFolder.domElement.querySelector('.children');
        if (tChildren) tChildren.appendChild(actDiv);
      });
    }

    renderGeneratorGUI();
    window.renderGeneratorGUI = renderGeneratorGUI;
    rebuildTraceObjects();

    window.renderParGUI = renderParGUI;
    renderParGUI();
  }

  // ─── LED Strands Section ─────────────────────────────────────────────────
  function buildLedStrandsSection(parentFolder, sectionConfig) {
    const strandFolder = parentFolder.addFolder(sectionConfig._section.label);
    strandFolder.close();

    // Master toggle
    strandFolder.add(params, 'strandsEnabled').name('Master Enabled').onChange(v => {
      (window.ledStrandFixtures || []).forEach(f => f.setVisibility(v));
    });

    window.ledStrandFixtures = [];

    function rebuildLedStrands() {
      if (window.ledStrandFixtures) {
        window.ledStrandFixtures.forEach(f => f.destroy());
      }
      window.ledStrandFixtures = [];
      params.ledStrands.forEach((config, index) => {
        const fixture = new LedStrand(config, index, scene, interactiveObjects);
        fixture.setVisibility(params.strandsEnabled !== false);
        window.ledStrandFixtures.push(fixture);
      });
    }
    window.rebuildLedStrands = rebuildLedStrands;

    // Transform handler for strand handles
    window._onStrandTransformChange = function(obj) {
      if (!obj.userData.isLedStrand) return false;
      const fixture = obj.userData.fixture;
      if (!fixture) return false;
      fixture.writeTransformToConfig(obj.userData.handleType);
      fixture.rebuildVisuals();
      debounceAutoSave();
      return true;
    };

    // --- LED Strand GUI ---
    window.strandGuiFolders = [];
    window.openStrandFolder = function(strandIndex) {
      strandFolder.open();
      if (window.strandGuiFolders) {
        window.strandGuiFolders.forEach(f => { if (f) f.domElement.classList.remove('gui-card-selected'); });
      }
      if (window.strandGuiFolders[strandIndex]) {
        window.strandGuiFolders[strandIndex].open();
        window.strandGuiFolders[strandIndex].domElement.classList.add('gui-card-selected');
      }
    };

    function renderStrandGUI() {
      const existing = [...strandFolder.folders];
      existing.forEach(f => f.destroy());
      window.strandGuiFolders = [];

      // New Strand button
      const newBtnDiv = document.createElement('div');
      newBtnDiv.style.cssText = 'display:flex;gap:2px;padding:4px 6px;';
      const btnStyle = 'flex:1;padding:4px 0;border:none;border-radius:3px;background:#2a2a2a;color:#88ff44;cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;';
      const newBtn = document.createElement('button');
      newBtn.textContent = '+ New Strand';
      newBtn.style.cssText = btnStyle;
      newBtn.onclick = () => {
        pushUndo();
        params.ledStrands.push({
          name: `Strand ${params.ledStrands.length + 1}`,
          startX: -3, startY: 5, startZ: 0,
          endX: 3, endY: 5, endZ: 0,
          color: '#ff8800',
          intensity: 1.0,
          ledCount: 10,
        });
        rebuildLedStrands();
        renderStrandGUI();
        debounceAutoSave();
      };
      newBtnDiv.appendChild(newBtn);
      const children = strandFolder.domElement.querySelector('.children');
      if (children) {
        const old = children.querySelector('.strand-new-btn');
        if (old) old.remove();
        newBtnDiv.classList.add('strand-new-btn');
        children.prepend(newBtnDiv);
      }

      // Strand sub-folders
      params.ledStrands.forEach((strand, i) => {
        const label = `💡 ${strand.name || `Strand ${i + 1}`}`;
        const sFolder = strandFolder.addFolder(label);
        sFolder.domElement.classList.add('gui-card');
        sFolder.close();
        window.strandGuiFolders[i] = sFolder;

        // Selection highlight
        if (typeof sFolder.onOpenClose === 'function') {
          sFolder.onOpenClose((open) => {
            if (open) {
              (window.strandGuiFolders || []).forEach(f => { if (f) f.domElement.classList.remove('gui-card-selected'); });
              sFolder.domElement.classList.add('gui-card-selected');
            } else {
              sFolder.domElement.classList.remove('gui-card-selected');
            }
          });
        }

        sFolder.add(strand, 'name').name('Name').onFinishChange(() => {
          renderStrandGUI();
          debounceAutoSave();
        });

        sFolder.addColor(strand, 'color').name('Color').onChange(() => {
          rebuildLedStrands();
          debounceAutoSave();
        });

        sFolder.add(strand, 'intensity', 0.1, 5, 0.1).name('Intensity').onChange(() => {
          debounceAutoSave();
        });

        sFolder.add(strand, 'ledCount', 2, 100, 1).name('LED Count').onChange(() => {
          rebuildLedStrands();
          debounceAutoSave();
        });

        // Start/End position folders
        const startF = sFolder.addFolder('Start Point (green)');
        startF.close();
        startF.add(strand, 'startX', -100, 100, 0.5).name('X').listen().onChange(() => { rebuildLedStrands(); debounceAutoSave(); });
        startF.add(strand, 'startY', -100, 100, 0.5).name('Y').listen().onChange(() => { rebuildLedStrands(); debounceAutoSave(); });
        startF.add(strand, 'startZ', -100, 100, 0.5).name('Z').listen().onChange(() => { rebuildLedStrands(); debounceAutoSave(); });
        const endF = sFolder.addFolder('End Point (red)');
        endF.close();
        endF.add(strand, 'endX', -100, 100, 0.5).name('X').listen().onChange(() => { rebuildLedStrands(); debounceAutoSave(); });
        endF.add(strand, 'endY', -100, 100, 0.5).name('Y').listen().onChange(() => { rebuildLedStrands(); debounceAutoSave(); });
        endF.add(strand, 'endZ', -100, 100, 0.5).name('Z').listen().onChange(() => { rebuildLedStrands(); debounceAutoSave(); });

        // Delete button
        const actDiv = document.createElement('div');
        actDiv.style.cssText = 'display:flex;gap:2px;padding:4px 6px;';
        const delBtn = document.createElement('button');
        delBtn.textContent = '✕ Delete';
        delBtn.style.cssText = 'flex:1;padding:4px 0;border:none;border-radius:3px;background:#3a1a1a;color:#c33;cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;';
        delBtn.onclick = () => {
          pushUndo();
          params.ledStrands.splice(i, 1);
          rebuildLedStrands();
          renderStrandGUI();
          debounceAutoSave();
        };
        actDiv.appendChild(delBtn);
        const sChildren = sFolder.domElement.querySelector('.children');
        if (sChildren) sChildren.appendChild(actDiv);
      });
    }
    window.renderStrandGUI = renderStrandGUI;

    renderStrandGUI();
    rebuildLedStrands();
  }

  // ─── Icebergs Section ────────────────────────────────────────────────────
  function buildIcebergsSection(parentFolder, sectionConfig) {
    const bergFolder = parentFolder.addFolder(sectionConfig._section.label);
    bergFolder.close();

    // Master toggle
    bergFolder.add(params, 'icebergsEnabled').name('Master Enabled').onChange(v => {
      (window.icebergFixtures || []).forEach(f => f.setVisibility(v));
    });

    // Focus on Select checkbox (from config)
    if (params.focusOnSelect === undefined) params.focusOnSelect = true;
    // Ensure entry exists in configTree so reconstructYAML persists it
    if (sectionConfig && !sectionConfig.focusOnSelect) {
      sectionConfig.focusOnSelect = { value: params.focusOnSelect, label: 'Focus on Select' };
    }
    bergFolder.add(params, 'focusOnSelect').name('Focus on Select').onChange(() => { debounceAutoSave(); });

    window.icebergFixtures = [];

    function rebuildIcebergs() {
      if (window.icebergFixtures) {
        window.icebergFixtures.forEach(f => f.destroy());
      }
      window.icebergFixtures = [];
      params.icebergs.forEach((config, index) => {
        const fixture = new Iceberg(config, index, scene, interactiveObjects);
        fixture.setVisibility(params.icebergsEnabled !== false);
        window.icebergFixtures.push(fixture);
      });
    }
    window.rebuildIcebergs = rebuildIcebergs;

    // Fly camera to iceberg position
    function flyToIceberg(berg) {
      const targetX = berg.x || 0;
      const targetY = (berg.y || 0) + (berg.height || 6) / 2;
      const targetZ = berg.z || 0;
      const radius = berg.radius || 4;
      const viewDist = radius * 4;

      const targetLook = new THREE.Vector3(targetX, targetY, targetZ);
      const targetPos = new THREE.Vector3(
        targetX + viewDist,
        targetY + viewDist * 0.8,
        targetZ + viewDist
      );

      const startPos = camera.position.clone();
      const startTarget = controls.target.clone();
      const duration = 800;
      const startTime = performance.now();

      function step(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        camera.position.lerpVectors(startPos, targetPos, ease);
        controls.target.lerpVectors(startTarget, targetLook, ease);
        controls.update();

        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    // Transform handler
    window._onIcebergTransformChange = function(obj) {
      if (!obj.userData.isIceberg) return false;
      const fixture = obj.userData.fixture;
      if (!fixture) return false;
      fixture.writeTransformToConfig();
      debounceAutoSave();
      return true;
    };

    // GUI
    window.icebergGuiFolders = [];
    window.openIcebergFolder = function(idx) {
      bergFolder.open();
      if (window.icebergGuiFolders) {
        window.icebergGuiFolders.forEach(f => { if (f) f.domElement.classList.remove('gui-card-selected'); });
      }
      if (window.icebergGuiFolders[idx]) {
        window.icebergGuiFolders[idx].open();
        window.icebergGuiFolders[idx].domElement.classList.add('gui-card-selected');
      }
      // Fly to iceberg if focus checkbox is on
      if (params.focusOnSelect && params.icebergs[idx]) {
        flyToIceberg(params.icebergs[idx]);
      }
    };

    function renderIcebergGUI() {
      const existing = [...bergFolder.folders];
      existing.forEach(f => f.destroy());
      window.icebergGuiFolders = [];

      // New Iceberg button
      const newBtnDiv = document.createElement('div');
      newBtnDiv.style.cssText = 'display:flex;gap:2px;padding:4px 6px;';
      const newBtn = document.createElement('button');
      newBtn.textContent = '+ New Iceberg';
      newBtn.style.cssText = 'flex:1;padding:4px 0;border:none;border-radius:3px;background:#2a2a2a;color:#88ccff;cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;';
      newBtn.onclick = () => {
        pushUndo();
        params.icebergs.push({
          name: `Iceberg ${params.icebergs.length + 1}`,
          seed: Math.floor(Math.random() * 99999),
          x: Math.round(Math.random() * 60 - 30),
          y: 0,
          z: Math.round(Math.random() * 60 - 30),
          radius: 4, height: 6, detail: 10, peakCount: 3,
          ledPattern: 'spiral', ledDensity: 5, ledColor: '#aaeeff',
          floodEnabled: true, floodColor: '#ffffff', floodIntensity: 5, floodAngle: 40,
        });
        rebuildIcebergs();
        renderIcebergGUI();
        debounceAutoSave();
      };
      newBtnDiv.appendChild(newBtn);
      const children = bergFolder.domElement.querySelector('.children');
      if (children) {
        const old = children.querySelector('.berg-new-btn');
        if (old) old.remove();
        newBtnDiv.classList.add('berg-new-btn');
        children.prepend(newBtnDiv);
      }

      // Per-iceberg folders
      params.icebergs.forEach((berg, i) => {
        const label = `🧊 ${berg.name || `Iceberg ${i + 1}`}`;
        const bFolder = bergFolder.addFolder(label);
        bFolder.domElement.classList.add('gui-card');
        bFolder.close();
        window.icebergGuiFolders[i] = bFolder;

        // Fly to iceberg when folder is opened
        const titleEl = bFolder.domElement.querySelector('.title');
        if (titleEl) {
          titleEl.addEventListener('click', () => {
            // Highlight this card, deselect others
            if (window.icebergGuiFolders) {
              window.icebergGuiFolders.forEach(f => {
                if (f) f.domElement.classList.remove('gui-card-selected');
              });
            }
            bFolder.domElement.classList.add('gui-card-selected');
            if (params.focusOnSelect && berg) {
              flyToIceberg(berg);
            }
          });
        }

        bFolder.add(berg, 'name').name('Name').onFinishChange(() => { renderIcebergGUI(); debounceAutoSave(); });
        bFolder.add(berg, 'seed', 0, 99999, 1).name('Seed').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });

        // Position
        const posF = bFolder.addFolder('Position');
        posF.close();
        posF.add(berg, 'x', -100, 100, 0.5).name('X').listen().onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        posF.add(berg, 'y', -20, 20, 0.5).name('Y').listen().onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        posF.add(berg, 'z', -100, 100, 0.5).name('Z').listen().onChange(() => { rebuildIcebergs(); debounceAutoSave(); });

        // Shape
        const shapeF = bFolder.addFolder('Shape');
        shapeF.close();
        shapeF.add(berg, 'radius', 1, 15, 0.5).name('Radius').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        shapeF.add(berg, 'height', 1, 20, 0.5).name('Height').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        shapeF.add(berg, 'detail', 5, 25, 1).name('Detail').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        shapeF.add(berg, 'peakCount', 1, 10, 1).name('Peaks').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });

        // Display
        if (berg.showFaces === undefined) berg.showFaces = true;
        if (berg.showWireframe === undefined) berg.showWireframe = true;
        if (!berg.wireColor) berg.wireColor = '#88ddff';
        const dispF = bFolder.addFolder('Display');
        dispF.close();
        dispF.add(berg, 'showFaces').name('Show Faces').onChange(() => {
          const f = window.icebergFixtures[i];
          if (f) f.updateVisibility();
          debounceAutoSave();
        });
        dispF.add(berg, 'showWireframe').name('Show Wireframe').onChange(() => {
          const f = window.icebergFixtures[i];
          if (f) f.updateVisibility();
          debounceAutoSave();
        });
        dispF.addColor(berg, 'wireColor').name('Wire Color').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });

        // LED
        const ledF = bFolder.addFolder('LED Wiring');
        ledF.close();
        ledF.add(berg, 'ledPattern', ['edges', 'spiral', 'parabolic']).name('Pattern').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        ledF.add(berg, 'ledDensity', 2, 12, 1).name('Density').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        ledF.addColor(berg, 'ledColor').name('LED Color').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });

        // Flood
        const floodF = bFolder.addFolder('Flood Light');
        floodF.close();
        floodF.add(berg, 'floodEnabled').name('Enabled').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        floodF.addColor(berg, 'floodColor').name('Color').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        floodF.add(berg, 'floodIntensity', 0, 20, 0.5).name('Intensity').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        floodF.add(berg, 'floodAngle', 10, 90, 5).name('Angle').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });

        // Delete
        const actDiv = document.createElement('div');
        actDiv.style.cssText = 'display:flex;gap:2px;padding:4px 6px;';
        const delBtn = document.createElement('button');
        delBtn.textContent = '✕ Delete';
        delBtn.style.cssText = 'flex:1;padding:4px 0;border:none;border-radius:3px;background:#3a1a1a;color:#c33;cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;';
        delBtn.onclick = () => {
          pushUndo();
          params.icebergs.splice(i, 1);
          rebuildIcebergs();
          renderIcebergGUI();
          debounceAutoSave();
        };
        actDiv.appendChild(delBtn);
        const bChildren = bFolder.domElement.querySelector('.children');
        if (bChildren) bChildren.appendChild(actDiv);
      });
    }
    window.renderIcebergGUI = renderIcebergGUI;

    renderIcebergGUI();
    rebuildIcebergs();
  }

  // ─── Build the entire GUI from the config tree ───
  if (configTree) {
    buildGUI(configTree, gui);
  }

  // ─── Premium Save Button ───
  const saveDiv = document.createElement('div');
  saveDiv.style.cssText = 'padding:10px 6px 6px;';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾  Save Configuration';
  saveBtn.style.cssText = 'width:100%;min-height:38px;padding:12px 16px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;line-height:1;border:1px solid rgba(51,204,51,0.25);border-radius:8px;background:rgba(30,60,30,0.35);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:rgba(120,220,120,0.9);cursor:pointer;font-size:12px;font-family:inherit;font-weight:600;letter-spacing:0.05em;transition:all 0.3s ease;box-shadow:inset 0 1px 0 rgba(255,255,255,0.06),0 2px 8px rgba(0,0,0,0.3);';
  saveBtn.onmouseenter = () => { saveBtn.style.borderColor = 'rgba(51,204,51,0.5)'; saveBtn.style.background = 'rgba(40,80,40,0.45)'; saveBtn.style.color = '#7f7'; saveBtn.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.1),0 4px 16px rgba(51,204,51,0.12)'; };
  saveBtn.onmouseleave = () => { saveBtn.style.borderColor = 'rgba(51,204,51,0.25)'; saveBtn.style.background = 'rgba(30,60,30,0.35)'; saveBtn.style.color = 'rgba(120,220,120,0.9)'; saveBtn.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.06),0 2px 8px rgba(0,0,0,0.3)'; };
  saveBtn.onclick = () => { exportConfig(); };
  saveDiv.appendChild(saveBtn);
  const guiChildren = gui.domElement.querySelector('.children');
  if (guiChildren) guiChildren.appendChild(saveDiv);
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
// Experimental: color wave state
let colorWaveEnabled = false;
window.toggleColorWave = (v) => { colorWaveEnabled = v; };

// Cached chroma scale — rebuilt when stops change
let chromaScale = null;
let lastStopsKey = '';

function getChromaScale() {
  const stops = params.gradientStops || ['#8cc0ff', '#cc8cff'];
  const key = stops.join(',');
  if (key !== lastStopsKey) {
    chromaScale = chroma.scale(stops).mode('lab');
    lastStopsKey = key;
  }
  return chromaScale;
}

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

  // ─── Color Wave Effect (chroma.js LAB interpolation) ───
  if (colorWaveEnabled && window.parFixtures && window.parFixtures.length > 0) {
    const scale = getChromaScale();
    const speed = (params.waveSpeed || 0.3) * 0.001;
    const t = now * speed;
    const count = window.parFixtures.length;
    for (let i = 0; i < count; i++) {
      const fixture = window.parFixtures[i];
      if (!fixture || !fixture.light) continue;
      const phase = ((i / count) + t) % 1.0;
      const [r, g, b] = scale(phase).gl(); // returns [0-1, 0-1, 0-1, alpha]
      fixture.light.color.setRGB(r, g, b);
      if (fixture.beam && fixture.beam.material) {
        fixture.beam.material.color.setRGB(r, g, b);
      }
    }
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
