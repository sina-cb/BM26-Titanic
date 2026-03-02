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
      } else {
        params[key] = snapshot[key];
      }
    }
    rebuildParLights();
    if (window.renderParGUI) window.renderParGUI();
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

    if (hit.userData.isParLight) {
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
      const titleEl = folder.domElement.querySelector(':scope > .title');
      if (selectedFixtureIndices.has(idx)) {
        folder.open();
        // Highlight: blue accent border + lighter background
        if (titleEl) {
          titleEl.style.borderLeft = '3px solid #4d9fff';
          titleEl.style.background = 'rgba(77,159,255,0.12)';
          titleEl.style.color = '#8cc4ff';
        }
        // Open parent group folder
        if (folder.parent && typeof folder.parent.open === 'function') {
          folder.parent.open();
        }
      } else {
        folder.close();
        // Remove highlight
        if (titleEl) {
          titleEl.style.borderLeft = '';
          titleEl.style.background = '';
          titleEl.style.color = '';
        }
      }
    } catch (_) {}
  });
}

function onTransformChange() {
  const obj = transformControl.object;
  if (!obj || !obj.userData.fixture) return;

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

    // ─── Layout Tools (clean sub-folder) ───
    const layoutFolder = parFolder.addFolder("Layout Tools");
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
        transformControl.setTranslationSnap(params.snapAngle * 0.1); // proportional
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
        // Restore open state or default closed
        if (openGroups.has(`${groupName} (${items.length - 1})`) ||
            openGroups.has(`${groupName} (${items.length})`) ||
            openGroups.has(`${groupName} (${items.length + 1})`)) {
          groupFolder.open();
        } else {
          groupFolder.close();
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
          idxFolder.add(config, "intensity", 0, 50, 0.5).onChange((v) => {
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

    window.renderParGUI = renderParGUI;
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
