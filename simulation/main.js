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
import { MarsinEngine } from "./MarsinEngine.js";

// ─── Globals ────────────────────────────────────────────────────────────
let scene, camera, renderer, composer, controls;
let model = null;
let modelCenter = new THREE.Vector3();
let modelSize = new THREE.Vector3();
let modelRadius = 1;

window.THREE = THREE;
let cameraPresets = []; // Loaded from scene_preset_cameras.yaml
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
  if (window.setTraceSelected) window.setTraceSelected(-1, false);
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
window.params = params;

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
  setupHUD();

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

    // Fast-path: if clicking a purely visual part of the trace (like the wireframe line or dots),
    // don't attach the TransformControls gizmo (it would have physics implications),
    // just instantly open the UI.
    if (hit.userData.isTraceVisual) {
      transformControl.detach();
      deselectAllFixtures();
      if (window.openTraceFolder) window.openTraceFolder(hit.userData.traceIndex);
      syncGuiFolders();
      return;
    }

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

async function onModelLoaded(obj) {
  updateLoading(70, "Processing ship geometry…");
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

  updateLoading(85, "Setting up lights…");

  // Setup lighting
  setupLighting();

  // Setup camera position based on model
  const dist = modelRadius * 2.5;
  camera.position.set(dist * 0.7, modelSize.y * 1.2, dist * 0.7);
  controls.target.copy(modelCenter);
  controls.minDistance = modelRadius * 0.3;
  controls.maxDistance = modelRadius * 8;
  controls.update();

  updateLoading(90, "Loading icebergs…");

  // Instantiating initial icebergs here to hook into progress
  window.icebergFixtures = [];
  const totalBergs = params.icebergs.length;
  
  for (let index = 0; index < totalBergs; index++) {
    const config = params.icebergs[index];
    const fixture = new Iceberg(config, index, scene, interactiveObjects, params);
    fixture.setVisibility(params.icebergsEnabled !== false);
    window.icebergFixtures.push(fixture);
    updateLoading(90 + Math.floor((index / totalBergs) * 10), `Loading iceberg markers… (${index + 1}/${totalBergs})`);
  }
  
  // Sort fixtures back into configuration order, because promises resolve randomly
  window.icebergFixtures.sort((a, b) => a.index - b.index);

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

  // ─── Section → Folder Map (for collapse persistence) ───
  const _sectionFolderMap = new Map();
  window._sectionFolderMap = _sectionFolderMap;

  // Recursively sync _section.collapsed from actual GUI folder states
  function syncCollapseState(node) {
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      if (key === '_section') continue;
      const entry = node[key];
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && entry._section) {
        const folder = _sectionFolderMap.get(entry._section);
        if (folder) {
          entry._section.collapsed = folder._closed;
        }
        syncCollapseState(entry);
      }
    }
  }

  // ─── Save / Auto-Save ───
  function exportConfig() {
    reconstructYAML(configTree);
    syncCollapseState(configTree);

    // Persist camera state
    configTree._camera = {
      position: { x: +camera.position.x.toFixed(4), y: +camera.position.y.toFixed(4), z: +camera.position.z.toFixed(4) },
      target: { x: +controls.target.x.toFixed(4), y: +controls.target.y.toFixed(4), z: +controls.target.z.toFixed(4) }
    };

    // Persist pattern editor window state
    const pePanel = document.getElementById('pattern-editor-panel');
    if (pePanel) {
      const rect = pePanel.getBoundingClientRect();
      configTree._patternEditor = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        collapsed: pePanel.classList.contains('collapsed'),
        autoRun: !!(document.getElementById('pe-autorun') && document.getElementById('pe-autorun').checked)
      };
    }

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
      // Also toggle iceberg floodlight fixture models
      if (window.icebergFixtures) {
        window.icebergFixtures.forEach(f => f.setFixtureVisibility(v));
      }
    },
    lightingEnabled: (v) => {
      if (window.onLightingChange) window.onLightingChange();
      if (!v && window.parFixtures) {
        // Restore original par colors when lighting disabled
        window.parFixtures.forEach(f => {
          if (f && f.config) {
            f.light.color.set(f.config.color);
            if (f.beam && f.beam.material) f.beam.material.color.set(f.config.color);
          }
        });
      }
    },
    lightingMode: () => {
      if (window.onLightingChange) window.onLightingChange();
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

  // ─── Lighting Engine Section ─────────────────────────────────────────────
  function buildLightingEngineSection(parentFolder, sectionConfig) {
    const engineFolder = parentFolder.addFolder(sectionConfig._section.label);
    if (sectionConfig._section.collapsed) engineFolder.close();
    _sectionFolderMap.set(sectionConfig._section, engineFolder);

    // ── Gradient sub-controls ──
    if (!params.gradientStops || params.gradientStops.length === 0) {
      params.gradientStops = ['#8cc0ff', '#a699ff', '#cc8cff', '#a699ff', '#8cc0ff'];
    }
    if (sectionConfig && !sectionConfig.gradientStops) {
      sectionConfig.gradientStops = params.gradientStops;
    }

    const gradientFolder = engineFolder.addFolder('📊 Gradient Settings');

    addControl(gradientFolder, 'waveSpeed', sectionConfig.waveSpeed || { value: 0.1, label: 'Speed', min: 0.05, max: 2, step: 0.05 });

    // Gradient preview bar
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

    const gChildren = gradientFolder.domElement.querySelector('.children');
    if (gChildren) gChildren.appendChild(previewDiv);

    // Gradient stop controls
    let stopsFolder = null;
    function renderStopControls() {
      if (stopsFolder) stopsFolder.destroy();
      stopsFolder = gradientFolder.addFolder('Gradient Stops');

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

      const btnDiv = document.createElement('div');
      btnDiv.style.cssText = 'display:flex;gap:4px;padding:4px 8px 6px;';

      const addBtn = document.createElement('button');
      addBtn.textContent = '+ Add Stop';
      addBtn.style.cssText = 'flex:1;padding:5px 0;border:1px solid rgba(255,255,255,0.12);border-radius:4px;background:rgba(255,255,255,0.04);color:#aaa;cursor:pointer;font-size:11px;font-family:inherit;';
      addBtn.onclick = () => {
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
      if (gChildren) gChildren.appendChild(previewDiv);
    }
    renderStopControls();

    // ── NDI placeholder ──
    const ndiFolder = engineFolder.addFolder('📡 NDI (Chromatik)');
    const ndiPlaceholder = document.createElement('div');
    ndiPlaceholder.style.cssText = 'padding:12px;color:#888;font-size:12px;font-family:inherit;text-align:center;';
    ndiPlaceholder.innerHTML = '🚧 <b>Under Construction</b><br><span style="color:#666;font-size:10px;">NDI input from Chromatik for DMX control plane</span>';
    const ndiChildren = ndiFolder.domElement.querySelector('.children');
    if (ndiChildren) ndiChildren.appendChild(ndiPlaceholder);
    ndiFolder.close();

    // ── Mode visibility ──
    function updateModeVisibility() {
      const mode = params.lightingMode || 'gradient';
      const enabled = !!params.lightingEnabled;
      gradientFolder.domElement.style.display = mode === 'gradient' ? '' : 'none';
      ndiFolder.domElement.style.display = mode === 'ndi' ? '' : 'none';
      // Show pattern editor only in pixelblaze mode when enabled
      if (window.showPatternEditor) window.showPatternEditor(mode === 'pixelblaze' && enabled);
      // Sync engine state
      engineEnabled = mode === 'pixelblaze' && enabled;
      lightingEnabled = enabled;
      lightingMode = mode;
    }

    // Add Enable + Mode controls WITH direct onChange for visibility
    addControl(engineFolder, 'lightingEnabled', sectionConfig.lightingEnabled || { value: false, label: '⚡ Enable' })
      .onChange(v => {
        if (!v && window.parFixtures) {
          window.parFixtures.forEach(f => {
            if (f && f.config) {
              f.light.color.set(f.config.color);
              if (f.beam && f.beam.material) f.beam.material.color.set(f.config.color);
            }
          });
        }
        updateModeVisibility();
      });
    addControl(engineFolder, 'lightingMode', sectionConfig.lightingMode || { value: 'gradient', label: 'Mode', options: ['gradient', 'pixelblaze', 'ndi'] })
      .onChange(() => updateModeVisibility());

    // Reorder: move Enable + Mode controllers to top of folder
    const engineChildren = engineFolder.domElement.querySelector('.children');
    if (engineChildren) {
      const controllers = engineChildren.querySelectorAll(':scope > .controller');
      const items = Array.from(controllers);
      if (items.length >= 2) {
        const enableCtrl = items[items.length - 2];
        const modeCtrl = items[items.length - 1];
        engineChildren.insertBefore(enableCtrl, engineChildren.firstChild);
        engineChildren.insertBefore(modeCtrl, enableCtrl.nextSibling);
      }
    }

    // Set initial state
    updateModeVisibility();
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
        // Special: lightingEngine (has lightingMode + gradientStops)
        if (entry.lightingMode || entry.gradientStops) {
          buildLightingEngineSection(parentFolder, entry);
          continue;
        }

        const folder = parentFolder.addFolder(sectionMeta.label);
        if (sectionMeta.collapsed) folder.close();
        _sectionFolderMap.set(sectionMeta, folder);
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
    if (sectionNode._section.collapsed) parFolder.close();
    _sectionFolderMap.set(sectionNode._section, parFolder);

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
    const btnStyle = 'flex:1;padding:3px 0;border:1px solid rgba(255,255,255,0.12);border-radius:3px;background:#2a2a2a;color:#ddd;cursor:pointer;font-size:11px;font-family:inherit;';
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
        (t.visuals || []).forEach(v => {
          const ioIdx = interactiveObjects.indexOf(v);
          if (ioIdx > -1) interactiveObjects.splice(ioIdx, 1);
        });
      });
      window.traceObjects = [];
    }

    function setTraceSelected(traceIndex, isSelected) {
      if (!window.traceObjects) return;
      window.traceObjects.forEach((tObj, i) => {
        if (!tObj || !tObj.materials) return;
        const selected = (i === traceIndex && isSelected);
        const color = selected ? 0xffff00 : 0xff8800; // Yellow vs Orange
        const opacity = selected ? 1.0 : 0.7;
        tObj.materials.lineMat.color.setHex(color);
        tObj.materials.lineMat.opacity = opacity;
        tObj.materials.dotMat.color.setHex(color);
      });
    }
    window.setTraceSelected = setTraceSelected;

    function flyToTrace(idx, trace) {
      const tObj = window.traceObjects[idx];
      if (!tObj) return;

      let targetX, targetY, targetZ;
      if (trace.shape === 'circle') {
        targetX = trace.x || 0;
        targetY = trace.y || 5;
        targetZ = trace.z || 0;
      } else {
        targetX = ((trace.startX || 0) + (trace.endX || 0)) / 2;
        targetY = ((trace.startY || 5) + (trace.endY || 5)) / 2;
        targetZ = ((trace.startZ || 0) + (trace.endZ || 0)) / 2;
      }

      const p1 = new THREE.Vector3(trace.startX || 0, trace.startY || 5, trace.startZ || 0);
      const p2 = new THREE.Vector3(trace.endX || 0, trace.endY || 5, trace.endZ || 0);
      const radius = trace.shape === 'circle' ? (trace.radius || 5) : p1.distanceTo(p2) / 2;

      const viewDist = Math.max(10, radius * 3);

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
    window.flyToTrace = flyToTrace;

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

        const visuals = [];

        // Wireframe line between endpoints
        const lineGeo = new THREE.BufferGeometry().setFromPoints([startPos, endPos]);
        const lineMat = new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.7 });
        const lineMesh = new THREE.Line(lineGeo, lineMat);
        lineMesh.userData = { isTraceVisual: true, traceIndex };
        grp.add(lineMesh);
        visuals.push(lineMesh);
        interactiveObjects.push(lineMesh);

        // Preview dots at light positions
        const lightPts = computeTracePoints(trace);
        const dotGeo = new THREE.SphereGeometry(0.3, 8, 8); // slightly larger for easier clicking
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
        lightPts.forEach(p => {
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.copy(p);
          dot.userData = { isTraceVisual: true, traceIndex };
          grp.add(dot);
          visuals.push(dot);
          interactiveObjects.push(dot);
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

        // Dashed line from first light point to aim handle
        const aimOrigin = lightPts.length > 0 ? lightPts[0] : startPos.clone().lerp(endPos, 0.5);
        const aimLineGeo = new THREE.BufferGeometry().setFromPoints([aimOrigin, aimHandle.position]);
        const aimLineMat = new THREE.LineDashedMaterial({ color: 0xffcc00, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 0.5 });
        const aimLine = new THREE.Line(aimLineGeo, aimLineMat);
        aimLine.computeLineDistances();
        grp.add(aimLine);

        return { group: grp, hitbox: null, handles: [startHandle, endHandle, aimHandle], visuals, traceIndex, materials: { lineMat, dotMat }, aimLine };

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

        const visuals = [];

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
        const lineMesh = new THREE.Line(lineGeo, lineMat);
        lineMesh.userData = { isTraceVisual: true, traceIndex };
        grp.add(lineMesh);
        visuals.push(lineMesh);
        interactiveObjects.push(lineMesh);

        // Preview dots
        const lightPts = computeTracePoints(trace);
        const dotGeo = new THREE.SphereGeometry(0.3, 8, 8); // slightly larger
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
        lightPts.forEach(p => {
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.copy(p);
          dot.userData = { isTraceVisual: true, traceIndex };
          grp.add(dot);
          visuals.push(dot);
          interactiveObjects.push(dot);
        });

        scene.add(grp);

        // Hitbox at scene root
        const hitboxSize = (trace.radius || 5) * 2.5;
        const hitboxGeo = new THREE.BoxGeometry(hitboxSize, 1, hitboxSize);
        // colorWrite: false makes it invisible but raycastable, unlike visible: false
        const hitboxMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });
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

        // Dashed line from first light point to aim handle
        let aimOrigin = new THREE.Vector3();
        if (lightPts.length > 0) {
           // circle points are local; apply group's world matrix
           grp.updateMatrixWorld(true);
           aimOrigin.copy(lightPts[0]).applyMatrix4(grp.matrixWorld);
        } else {
           aimOrigin.copy(grp.position);
        }

        const aimLineGeo = new THREE.BufferGeometry().setFromPoints([aimOrigin, aimHandle.position]);
        const aimLineMat = new THREE.LineDashedMaterial({ color: 0xffcc00, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 0.5 });
        const aimLine = new THREE.Line(aimLineGeo, aimLineMat);
        aimLine.computeLineDistances();
        // Do not add to `grp`, add to `scene` so its dashed lines don't get double transformed by the group's rotation.
        scene.add(aimLine);

        return { group: grp, hitbox, handles: [aimHandle], visuals, traceIndex, materials: { lineMat, dotMat }, aimLine };
      }
    }

    function destroyTraceObjects() {
      if (!window.traceObjects) window.traceObjects = [];
      window.traceObjects.forEach(tObj => {
        if (tObj.group) scene.remove(tObj.group);
        if (tObj.hitbox) scene.remove(tObj.hitbox);
        if (tObj.aimLine && tObj.aimLine.parent === scene) scene.remove(tObj.aimLine);
        if (tObj.handles) tObj.handles.forEach(h => scene.remove(h));
        if (tObj.visuals) tObj.visuals.forEach(v => {
          const idx = interactiveObjects.indexOf(v);
          if (idx !== -1) interactiveObjects.splice(idx, 1);
        });
        if (tObj.handles) tObj.handles.forEach(h => {
          const idx = interactiveObjects.indexOf(h);
          if (idx !== -1) interactiveObjects.splice(idx, 1);
        });
        if (tObj.hitbox) {
          const idx = interactiveObjects.indexOf(tObj.hitbox);
          if (idx !== -1) interactiveObjects.splice(idx, 1);
        }
      });
      window.traceObjects = [];
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

        // Update sum dashed line target
        if (tObj.aimLine) {
          const pts = computeTracePoints(trace);
          const aimOrigin = pts.length > 0 ? pts[0] : new THREE.Vector3(trace.startX ?? 0, trace.startY ?? 5, trace.startZ ?? 0).lerp(new THREE.Vector3(trace.endX ?? 10, trace.endY ?? 5, trace.endZ ?? 0), 0.5);
          tObj.aimLine.geometry.setFromPoints([aimOrigin, aimHandle.position]);
          tObj.aimLine.computeLineDistances();
        }

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
          if (tObj.aimLine) grp.add(tObj.aimLine); // re-attach the preserved dash line to the new group
          scene.add(grp);
          tObj.group = grp;
          tObj.materials = { lineMat, dotMat }; // Preserve material refs for highlighting
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

        if (tObj.aimLine && aimHandle) {
           const pts = computeTracePoints(trace);
           let aimOrigin = new THREE.Vector3();
           if (pts.length > 0) {
              const euler = new THREE.Euler(THREE.MathUtils.degToRad(trace.rotX || 0), THREE.MathUtils.degToRad(trace.rotY || 0), THREE.MathUtils.degToRad(trace.rotZ || 0), 'YXZ');
              aimOrigin.copy(pts[0])
                       .applyEuler(euler)
                       .add(new THREE.Vector3(trace.x || 0, trace.y || 5, trace.z || 0));
           } else {
              aimOrigin.copy(obj.position);
           }
           tObj.aimLine.geometry.setFromPoints([aimOrigin, aimHandle.position]);
           tObj.aimLine.computeLineDistances();
        }

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

      // Ensure focusOnSelect exists for the generator folder too
      if (params.focusOnSelect === undefined) params.focusOnSelect = true;
      const existingFocusCtrl = genFolder.controllers.find(c => c.property === 'focusOnSelect');
      if (!existingFocusCtrl) {
        genFolder.add(params, 'focusOnSelect').name('Focus on Select').listen().onChange(() => { debounceAutoSave(); });
      }

      window.traceGuiFolders = [];
      window.openTraceFolder = function(idx) {
        genFolder.open();
        if (window.traceGuiFolders) {
          window.traceGuiFolders.forEach((f, i) => {
            if (f) f.domElement.classList.remove('gui-card-selected');
          });
        }
        if (window.traceGuiFolders[idx]) {
          window.traceGuiFolders[idx].open();
          window.traceGuiFolders[idx].domElement.classList.add('gui-card-selected');
        }
        if (window.setTraceSelected) window.setTraceSelected(idx, true);

        // Fly to trace if focus checkbox is on
        if (params.focusOnSelect && params.traces[idx]) {
          if (window.flyToTrace) window.flyToTrace(idx, params.traces[idx]);
        }
      };

      // Soft-selection for when users click the GUI directly (lets lil-gui manage open/close state natively)
      window.clickTraceFolder = function(idx) {
        if (window.traceGuiFolders) {
          window.traceGuiFolders.forEach((f, i) => {
            if (f) f.domElement.classList.remove('gui-card-selected');
          });
        }
        if (window.traceGuiFolders[idx]) {
          window.traceGuiFolders[idx].domElement.classList.add('gui-card-selected');
        }
        if (window.setTraceSelected) window.setTraceSelected(idx, true);

        // Fly to trace if focus checkbox is on
        if (params.focusOnSelect && params.traces[idx]) {
          if (window.flyToTrace) window.flyToTrace(idx, params.traces[idx]);
        }
      };

      // Trace sub-folders
      params.traces.forEach((trace, i) => {
        // lil-gui returns the SAME folder if titles match, breaking all click listeners.
        // Append invisible zero-width spaces (\u200B) to guarantee every label is unique.
        const baseLabel = `${trace.shape === 'circle' ? '○' : '—'} ${trace.name || `Trace ${i+1}`}`;
        const label = baseLabel + '\u200B'.repeat(i);
        const tFolder = genFolder.addFolder(label);
        tFolder.domElement.classList.add('gui-card');
        tFolder.close();
        window.traceGuiFolders[i] = tFolder;

        // Selection highlight on click
        const titleEl = tFolder.domElement.querySelector('.title');
        if (titleEl) {
          titleEl.addEventListener('click', () => {
            // Use the soft-select method so we don't fight lil-gui's native open/close toggle
            if (window.clickTraceFolder) window.clickTraceFolder(i);
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

    // Auto-generate par lights for traces marked as already generated
    params.traces.forEach((trace, i) => {
      if (trace.generated) {
        generateGroupFromTrace(i);
      }
    });

    window.renderParGUI = renderParGUI;
    renderParGUI();
  }

  // ─── LED Strands Section ─────────────────────────────────────────────────
  function buildLedStrandsSection(parentFolder, sectionConfig) {
    const strandFolder = parentFolder.addFolder(sectionConfig._section.label);
    if (sectionConfig._section.collapsed !== false) strandFolder.close();
    _sectionFolderMap.set(sectionConfig._section, strandFolder);

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
    if (sectionConfig._section.collapsed !== false) bergFolder.close();
    _sectionFolderMap.set(sectionConfig._section, bergFolder);

    // Master toggle
    bergFolder.add(params, 'icebergsEnabled').name('Master Enabled').onChange(v => {
      (window.icebergFixtures || []).forEach(f => f.setVisibility(v));
    });

    // ─── Master Flood ON/OFF (promoted to top-level for quick access) ───
    bergFolder.add(params, 'masterFloodEnabled').name('⚡ Floods ON/OFF').onChange(() => { updateMasterFloods(); debounceAutoSave(); });

    // ─── Master Flood Dimmer 0-100% ───
    if (params.masterFloodDimmer === undefined) params.masterFloodDimmer = 100;
    bergFolder.add(params, 'masterFloodDimmer', 0, 250, 1).name('🔆 Flood Dimmer %').onChange(() => { updateMasterFloods(); debounceAutoSave(); });

    // ─── Master Flood Angle (top-level for quick access) ───
    bergFolder.add(params, 'masterFloodAngle', 10, 90, 1).name('📐 Flood Angle °').onChange(() => { updateMasterFloods(); debounceAutoSave(); });
    
    // Focus on Select checkbox (from config)
    if (params.focusOnSelect === undefined) params.focusOnSelect = true;
    // Ensure entry exists in configTree so reconstructYAML persists it
    if (sectionConfig && !sectionConfig.focusOnSelect) {
      sectionConfig.focusOnSelect = { value: params.focusOnSelect, label: 'Focus on Select' };
    }
    bergFolder.add(params, 'focusOnSelect').name('Focus on Select').listen().onChange(() => { debounceAutoSave(); });

    // ─── Load Iceberg Geometry checkbox ───
    if (params.loadIcebergGeometry === undefined) params.loadIcebergGeometry = false;
    bergFolder.add(params, 'loadIcebergGeometry').name('🚀 Load Iceberg Geometry').onChange(async (v) => {
      if (!v) return; // Only trigger on check
      if (!window.icebergFixtures || window.icebergFixtures.length === 0) return;
      
      // Show loading overlay
      const loadingOverlay = document.getElementById("loading-overlay");
      if (loadingOverlay) loadingOverlay.classList.remove("hidden");
      
      const total = window.icebergFixtures.length;
      
      // Sequential loading with per-berg progress for smooth UI feedback
      for (let i = 0; i < total; i++) {
        updateLoading(Math.floor((i / total) * 100), `Loading iceberg ${i + 1}/${total}: ${params.icebergs[i]?.name || 'Iceberg'}…`);
        await window.icebergFixtures[i].buildGeometry();
        // Minimal yield to let the progress bar paint
        await new Promise(r => setTimeout(r, 1));
      }
      updateLoading(100, 'Icebergs loaded!');
      
      if (loadingOverlay) {
        setTimeout(() => loadingOverlay.classList.add("hidden"), 300);
      }
    });

    // Master Flood Controls
    const masterFloodF = bergFolder.addFolder('Master Flood Controls');
    masterFloodF.addColor(params, 'masterFloodColor').name('Master Color').onChange(() => { updateMasterFloods(); debounceAutoSave(); });
    masterFloodF.add(params, 'masterFloodIntensity', 0, 500, 1).name('Master Intensity').onChange(() => { updateMasterFloods(); debounceAutoSave(); });

    function updateMasterFloods() {
      if (window.icebergFixtures) {
        window.icebergFixtures.forEach(f => f.updateFloodlightProps());
      }
    }

    async function rebuildIcebergs() {
      if (window.icebergFixtures) {
        window.icebergFixtures.forEach(f => f.destroy());
      }
      window.icebergFixtures = [];
      const promises = params.icebergs.map(async (config, index) => {
        const fixture = new Iceberg(config, index, scene, interactiveObjects, params);
        fixture.setVisibility(params.icebergsEnabled !== false);
        window.icebergFixtures.push(fixture);
        // Geometry loading is manual now
      });
      await Promise.all(promises);
      window.icebergFixtures.sort((a, b) => a.index - b.index);
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
          floodEnabled: true, floodColor: '#ffffff', floodIntensity: 50, floodAngle: 40,
          towerOffsetX: 0, towerOffsetY: 0, towerOffsetZ: 0,
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
        const floodF = bFolder.addFolder('Local Flood Override');
        floodF.close();
        floodF.add(berg, 'floodEnabled').name('Enabled').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        floodF.addColor(berg, 'floodColor').name('Local Color').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        floodF.add(berg, 'floodIntensity', 0, 150, 0.5).name('Local Intensity').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        floodF.add(berg, 'floodAngle', 10, 90, 1).name('Local Angle').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });

        // Tower Offset
        const offsetF = bFolder.addFolder('Tower Offset');
        offsetF.close();
        offsetF.add(berg, 'towerOffsetX', -20, 20, 0.1).name('Offset X').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        offsetF.add(berg, 'towerOffsetY', -20, 20, 0.1).name('Offset Y').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });
        offsetF.add(berg, 'towerOffsetZ', -20, 20, 0.1).name('Offset Z').onChange(() => { rebuildIcebergs(); debounceAutoSave(); });

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

// ─── HUD Frame ──────────────────────────────────────────────────────────
function setupHUD() {
  const closeBtn = document.getElementById('hud-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        window.close();
      }
    });
  }
}

// ─── View Presets (YAML-driven) ─────────────────────────────────────────
function setupViewPresets() {
  renderViewPresetsUI();
}

function renderViewPresetsUI() {
  const container = document.getElementById('view-presets');
  if (!container) return;
  container.innerHTML = '';

  // + Add button (far left)
  const addBtn = document.createElement('button');
  addBtn.className = 'preset-add';
  addBtn.textContent = '+';
  addBtn.title = 'Add new camera preset from current view';
  addBtn.onclick = () => {
    const name = prompt('Preset name:');
    if (!name || !name.trim()) return;
    const key = name.trim().toLowerCase().replace(/\s+/g, '-');
    cameraPresets.push({
      name: name.trim(),
      key,
      position: {
        x: Math.round(camera.position.x * 1000) / 1000,
        y: Math.round(camera.position.y * 1000) / 1000,
        z: Math.round(camera.position.z * 1000) / 1000,
      },
      target: {
        x: Math.round(controls.target.x * 1000) / 1000,
        y: Math.round(controls.target.y * 1000) / 1000,
        z: Math.round(controls.target.z * 1000) / 1000,
      },
    });
    saveCameraPresets();
    renderViewPresetsUI();
  };
  container.appendChild(addBtn);

  // Preset buttons
  cameraPresets.forEach((preset, i) => {
    const group = document.createElement('div');
    group.className = 'preset-group';

    // Name button — navigates camera
    const nameBtn = document.createElement('button');
    nameBtn.className = 'preset-name';
    nameBtn.textContent = preset.name;
    nameBtn.dataset.view = preset.key;
    nameBtn.title = `Go to ${preset.name} view`;
    nameBtn.onclick = () => animateCameraToPreset(preset);
    group.appendChild(nameBtn);

    // Update button — saves current camera to this preset
    const updateBtn = document.createElement('button');
    updateBtn.className = 'preset-action update';
    updateBtn.innerHTML = '🔄';
    updateBtn.title = `Update "${preset.name}" from current camera`;
    updateBtn.onclick = (e) => {
      e.stopPropagation();
      preset.position = {
        x: Math.round(camera.position.x * 1000) / 1000,
        y: Math.round(camera.position.y * 1000) / 1000,
        z: Math.round(camera.position.z * 1000) / 1000,
      };
      preset.target = {
        x: Math.round(controls.target.x * 1000) / 1000,
        y: Math.round(controls.target.y * 1000) / 1000,
        z: Math.round(controls.target.z * 1000) / 1000,
      };
      saveCameraPresets();
      // Flash feedback
      updateBtn.style.color = '#4f4';
      setTimeout(() => { updateBtn.style.color = ''; }, 600);
    };
    group.appendChild(updateBtn);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'preset-action remove';
    removeBtn.innerHTML = '✕';
    removeBtn.title = `Remove "${preset.name}"`;
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      if (!confirm(`Remove preset "${preset.name}"?`)) return;
      cameraPresets.splice(i, 1);
      saveCameraPresets();
      renderViewPresetsUI();
    };
    group.appendChild(removeBtn);

    container.appendChild(group);
  });
}

function animateCameraToPreset(preset) {
  if (!preset || !preset.position || !preset.target) return;

  const targetPos = new THREE.Vector3(preset.position.x, preset.position.y, preset.position.z);
  const targetLook = new THREE.Vector3(preset.target.x, preset.target.y, preset.target.z);

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

// Legacy compatibility: animateCamera by name (used by agent_render.js)
function animateCamera(viewName) {
  const preset = cameraPresets.find(p => p.key === viewName);
  if (preset) {
    animateCameraToPreset(preset);
  }
}

function saveCameraPresets() {
  const yamlStr = yaml.dump({ presets: cameraPresets });
  fetch('http://localhost:8181/save-cameras', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: yamlStr,
  }).catch(err => console.warn('Failed to save camera presets:', err));
}

// ─── Resize ─────────────────────────────────────────────────────────────
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

// ─── MarsinEngine (Pixelblaze Pattern Engine) ──────────────────────────
const patternEngine = new MarsinEngine();
let engineReady = false;
let engineEnabled = false;

// Pattern preset names → loaded from pb/ directory
const PATTERN_PRESETS = {}; // populated by loadPatternPresets()
let selectedPattern = null; // currently active pattern name

function titleCase(name) {
  return name.replace(/[_-]/g, ' ').replace(/(^|\s)\S/g, c => c.toUpperCase());
}

function renderPresetButtons() {
  const container = document.getElementById('pe-preset-buttons');
  if (!container) return;
  container.innerHTML = '';
  for (const name of Object.keys(PATTERN_PRESETS).sort()) {
    const btn = document.createElement('button');
    btn.dataset.pattern = name;
    btn.textContent = titleCase(name);
    if (name === selectedPattern) btn.classList.add('active');
    container.appendChild(btn);
  }
}

async function loadPatternPresets() {
  // Discover patterns from server
  try {
    const resp = await fetch(`http://localhost:8181/list-patterns`);
    if (resp.ok) {
      const names = await resp.json();
      await Promise.all(names.map(async name => {
        try {
          const r = await fetch(`pb/${name}.js?t=${Date.now()}`);
          if (r.ok) PATTERN_PRESETS[name] = await r.text();
        } catch (e) { console.warn(`[PB] Failed to load pb/${name}.js`); }
      }));
    }
  } catch (e) {
    console.warn('[PB] list-patterns endpoint not available, trying static list');
    const fallbackNames = ['rainbow', 'breathing', 'sparkle', 'fire', 'plasma', 'wipe'];
    await Promise.all(fallbackNames.map(async name => {
      try {
        const r = await fetch(`pb/${name}.js?t=${Date.now()}`);
        if (r.ok) PATTERN_PRESETS[name] = await r.text();
      } catch (e) { /* skip */ }
    }));
  }
  // Set default in editor
  const textarea = document.getElementById('pe-code');
  if (textarea && !textarea.value && PATTERN_PRESETS.rainbow) {
    textarea.value = PATTERN_PRESETS.rainbow;
    selectedPattern = 'rainbow';
  }
  renderPresetButtons();
  console.log(`[PB] Loaded ${Object.keys(PATTERN_PRESETS).length} preset patterns`);
}

async function initPatternEngine() {
  try {
    await patternEngine.init('./lib/marsin-engine');
    if (patternEngine.ready) {
      engineReady = true;
      console.log('[PB] Pattern engine ready');
      compileEditorCode();
    }
  } catch (err) {
    console.warn('[PB] Pattern engine not available:', err.message);
  }
}
window.patternEngine = patternEngine;
window.initPatternEngine = initPatternEngine;

// ─── Pattern Editor Panel Wiring ──────────────────────────────────────
function compileEditorCode() {
  const textarea = document.getElementById('pe-code');
  const statusEl = document.getElementById('pe-status');
  if (!textarea || !statusEl) return;
  const code = textarea.value;
  if (!engineReady) {
    statusEl.className = 'pe-status error';
    statusEl.innerHTML = '<span class="pe-status-icon">✗</span> Engine not loaded';
    return;
  }
  const ok = patternEngine.compile(code);
  if (ok) {
    statusEl.className = 'pe-status ok';
    statusEl.innerHTML = '<span class="pe-status-icon">✓</span> Compiled OK';
  } else {
    const errMsg = patternEngine.getError();
    statusEl.className = 'pe-status error';
    statusEl.innerHTML = '<span class="pe-status-icon">✗</span> ' + errMsg;
  }
}

function setupPatternEditor() {
  const panel = document.getElementById('pattern-editor-panel');
  const header = document.getElementById('pe-drag-handle');
  const textarea = document.getElementById('pe-code');
  const compileBtn = document.getElementById('pe-compile-btn');
  const collapseBtn = document.getElementById('pe-collapse-btn');
  const saveBtn = document.getElementById('pe-save-btn');
  const addBtn = document.getElementById('pe-add-pattern');
  const delBtn = document.getElementById('pe-del-pattern');
  const presetsEl = document.getElementById('pe-presets');
  if (!panel || !textarea) return;

  // Compile button
  compileBtn.addEventListener('click', compileEditorCode);

  // Auto-run: debounced compile on input
  const autoRunCheckbox = document.getElementById('pe-autorun');
  let autoRunTimer = null;
  textarea.addEventListener('input', () => {
    if (autoRunCheckbox && autoRunCheckbox.checked) {
      clearTimeout(autoRunTimer);
      autoRunTimer = setTimeout(compileEditorCode, 300);
    }
  });

  // Ctrl+Enter to compile, Tab inserts spaces
  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      compileEditorCode();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = textarea.selectionStart;
      const en = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, s) + '  ' + textarea.value.substring(en);
      textarea.selectionStart = textarea.selectionEnd = s + 2;
    }
  });

  // Preset buttons (click to load)
  presetsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pattern]');
    if (!btn) return;
    const key = btn.dataset.pattern;
    if (PATTERN_PRESETS[key]) {
      textarea.value = PATTERN_PRESETS[key];
      selectedPattern = key;
      renderPresetButtons();
      compileEditorCode();
    }
  });

  // Save: write editor code back to the selected pattern file
  saveBtn.addEventListener('click', async () => {
    const code = textarea.value;
    if (!selectedPattern) {
      // No pattern selected — prompt for name (same as add)
      const name = prompt('Pattern name (lowercase, e.g. "my_pattern"):');
      if (!name) return;
      selectedPattern = name.toLowerCase().replace(/\s+/g, '_');
    }
    try {
      const resp = await fetch('http://localhost:8181/save-pattern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selectedPattern, code }),
      });
      if (resp.ok) {
        PATTERN_PRESETS[selectedPattern] = code;
        renderPresetButtons();
        const statusEl = document.getElementById('pe-status');
        if (statusEl) {
          statusEl.className = 'pe-status ok';
          statusEl.innerHTML = '<span class="pe-status-icon">💾</span> Saved: ' + selectedPattern + '.js';
        }
      }
    } catch (e) {
      console.error('[PB] Save failed:', e);
    }
  });

  // Add: create a new pattern
  addBtn.addEventListener('click', async () => {
    const name = prompt('New pattern name (lowercase, e.g. "strobe"):');
    if (!name) return;
    const key = name.toLowerCase().replace(/\s+/g, '_');
    const template = '// ' + titleCase(key) + '\nexport function beforeRender(delta) {\n  t1 = time(0.1)\n}\nexport function render(index) {\n  hsv(t1 + index / pixelCount, 1, 1)\n}\n';
    try {
      const resp = await fetch('http://localhost:8181/save-pattern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: key, code: template }),
      });
      if (resp.ok) {
        PATTERN_PRESETS[key] = template;
        selectedPattern = key;
        textarea.value = template;
        renderPresetButtons();
        compileEditorCode();
      }
    } catch (e) {
      console.error('[PB] Add pattern failed:', e);
    }
  });

  // Delete: remove the selected pattern
  delBtn.addEventListener('click', async () => {
    if (!selectedPattern) return;
    if (!confirm(`Delete pattern "${selectedPattern}"?`)) return;
    try {
      const resp = await fetch('http://localhost:8181/delete-pattern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selectedPattern }),
      });
      if (resp.ok) {
        delete PATTERN_PRESETS[selectedPattern];
        selectedPattern = null;
        textarea.value = '';
        renderPresetButtons();
        const statusEl = document.getElementById('pe-status');
        if (statusEl) {
          statusEl.className = 'pe-status ok';
          statusEl.innerHTML = '<span class="pe-status-icon">🗑️</span> Deleted';
        }
      }
    } catch (e) {
      console.error('[PB] Delete failed:', e);
    }
  });

  // Collapse / expand
  let isCollapsed = false;
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isCollapsed = !isCollapsed;
    panel.classList.toggle('collapsed', isCollapsed);
    collapseBtn.textContent = isCollapsed ? '□' : '─';
  });
  header.addEventListener('dblclick', () => {
    isCollapsed = !isCollapsed;
    panel.classList.toggle('collapsed', isCollapsed);
    collapseBtn.textContent = isCollapsed ? '□' : '─';
  });

  // Dragging
  let isDragging = false, dragOX = 0, dragOY = 0;
  header.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    const r = panel.getBoundingClientRect();
    dragOX = e.clientX - r.left;
    dragOY = e.clientY - r.top;
    document.body.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOX)) + 'px';
    panel.style.top = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOY)) + 'px';
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => {
    if (isDragging) { isDragging = false; document.body.style.cursor = ''; }
  });

  // Show/hide
  window.showPatternEditor = (show) => {
    panel.classList.toggle('hidden', !show);
  };
}
window.setupPatternEditor = setupPatternEditor;

// ─── Animation Loop ─────────────────────────────────────────────────────
// Lighting engine state (driven by GUI)
let lightingEnabled = false;
let lightingMode = 'gradient'; // 'gradient' | 'pixelblaze' | 'ndi'

// Hook for generic GUI builder: when lightingEnabled or lightingMode params change
window.onLightingChange = () => {
  lightingEnabled = !!params.lightingEnabled;
  const newMode = params.lightingMode || 'gradient';
  if (newMode !== lightingMode) {
    lightingMode = newMode;
    // Show pattern editor only in pixelblaze mode
    if (window.showPatternEditor) window.showPatternEditor(lightingMode === 'pixelblaze' && lightingEnabled);
    // Enable engine for pixelblaze
    engineEnabled = lightingMode === 'pixelblaze' && lightingEnabled;
  }
  // Show/hide editor based on enable state too
  if (window.showPatternEditor) window.showPatternEditor(lightingMode === 'pixelblaze' && lightingEnabled);
  engineEnabled = lightingMode === 'pixelblaze' && lightingEnabled;
};
// Legacy compat
window.toggleColorWave = (v) => { lightingEnabled = v; };

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

  // ─── Gradient Mode (chroma.js LAB interpolation) ───
  if (lightingEnabled && lightingMode === 'gradient' && window.parFixtures && window.parFixtures.length > 0) {
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

  // ─── Pixelblaze Pattern Engine ───
  if (engineReady && engineEnabled) {
    const elapsed = now * 0.001; // ms → seconds
    patternEngine.beginFrame(elapsed);

    // → Par Lights
    if (window.parFixtures && window.parFixtures.length > 0) {
      const count = window.parFixtures.length;
      for (let i = 0; i < count; i++) {
        const fixture = window.parFixtures[i];
        if (!fixture || !fixture.light) continue;
        const t = count > 1 ? i / (count - 1) : 0.5;
        const { r, g, b } = patternEngine.renderPixel(i, t, 0, 0);
        const rn = r / 255, gn = g / 255, bn = b / 255;
        fixture.light.color.setRGB(rn, gn, bn);
        if (fixture.beam && fixture.beam.material) {
          fixture.beam.material.color.setRGB(rn, gn, bn);
        }
      }
    }

    // → LED Strands
    if (window.ledStrandFixtures && window.ledStrandFixtures.length > 0) {
      window.ledStrandFixtures.forEach(fixture => {
        const count = fixture.config.ledCount || 10;
        const children = fixture.group.children;
        // Children layout: [wire, tube, housing0, bulb0, halo0, housing1, bulb1, halo1, ...]
        const ledStartIdx = 2; // skip wire + tube
        for (let led = 0; led < count; led++) {
          const baseIdx = ledStartIdx + led * 3;
          const bulb = children[baseIdx + 1]; // bulb mesh
          const halo = children[baseIdx + 2]; // halo mesh
          if (!bulb || !bulb.material) continue;

          const t = count > 1 ? led / (count - 1) : 0.5;
          const { r, g, b } = patternEngine.renderPixel(led, t, 0, 0);
          const rn = r / 255, gn = g / 255, bn = b / 255;
          bulb.material.color.setRGB(rn, gn, bn);
          if (halo && halo.material) {
            halo.material.color.setRGB(rn, gn, bn);
          }
        }
      });
    }
  }

  composer.render();
}

// ─── Start ──────────────────────────────────────────────────────────────
Promise.all([
  fetch("scene_config.yaml?t=" + Date.now()).then(r => r.text()).catch(() => ''),
  fetch("scene_preset_cameras.yaml?t=" + Date.now()).then(r => r.text()).catch(() => ''),
]).then(([sceneYaml, camerasYaml]) => {
  // Load scene config
  try {
    const loaded = yaml.load(sceneYaml);
    if (loaded) {
      configTree = loaded;
      extractParams(configTree);
    }
  } catch (err) {
    console.warn("Failed to parse scene_config.yaml:", err);
  }

  // Load camera presets
  try {
    const camData = yaml.load(camerasYaml);
    if (camData && Array.isArray(camData.presets)) {
      cameraPresets = camData.presets;
    }
  } catch (err) {
    console.warn("Failed to parse scene_preset_cameras.yaml:", err);
  }

  // If no presets loaded, create defaults from model dimensions
  if (cameraPresets.length === 0) {
    cameraPresets = [
      { name: 'Front', key: 'front', position: { x: 0, y: 5.5, z: 27.5 }, target: { x: 0, y: 4, z: 0 } },
      { name: 'Side', key: 'side', position: { x: 27.5, y: 5.5, z: 0 }, target: { x: 0, y: 4, z: 0 } },
      { name: 'Aerial', key: 'aerial', position: { x: 8.25, y: 22, z: 8.25 }, target: { x: 0, y: 4, z: 0 } },
      { name: 'Dramatic', key: 'dramatic', position: { x: -13.75, y: 3.3, z: 22 }, target: { x: 0, y: 4.4, z: 0 } },
      { name: 'Night Walk', key: 'night-walk', position: { x: 4.125, y: 1.1, z: 5.5 }, target: { x: 0, y: 3.3, z: 0 } },
    ];
  }

  init();

  // Restore camera view from saved state
  if (configTree._camera) {
    const cam = configTree._camera;
    if (cam.position) camera.position.set(cam.position.x, cam.position.y, cam.position.z);
    if (cam.target) controls.target.set(cam.target.x, cam.target.y, cam.target.z);
    controls.update();
  }

  // Initialize pattern editor + engine (chained to avoid race condition:
  // presets must load before engine compiles, otherwise textarea is empty)
  setupPatternEditor();
  loadPatternPresets().then(() => {
    initPatternEngine().then(() => {
      // Sync lighting engine state from loaded config (pixelblaze activates on boot)
      // Must run AFTER setupPatternEditor() so window.showPatternEditor exists,
      // and AFTER initPatternEngine() so engineReady is true
      if (window.onLightingChange) window.onLightingChange();
    });
  });

  // Restore pattern editor window state
  if (configTree._patternEditor) {
    const pe = configTree._patternEditor;
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
