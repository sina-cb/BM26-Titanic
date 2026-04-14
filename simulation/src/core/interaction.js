/**
 * interaction.js — Snap-to-surface mode, pointer handling, keyboard shortcuts,
 * transform control updates, and fixture selection.
 */
import * as THREE from "three";
import {
  scene, camera, renderer, controls, raycaster, mouse,
  transformControl, interactiveObjects, modelMeshes,
  params, selectedFixtureIndices, dragStartState, setDragStartState,
} from "./state.js";
import { pushUndo, undo, redo } from "./undo.js";
import { rebuildParLights } from "./fixtures.js";

// ─── Snap-to-Surface Mode State ──────────────────────────────────────────
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

export function toggleSnapMode(forceOff) {
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

// ─── Helper: deselect all ────────────────────────────────────────────────
export function deselectAllFixtures() {
  for (const idx of selectedFixtureIndices) {
    if (window.parFixtures && window.parFixtures[idx]) {
      window.parFixtures[idx].setSelected(false);
    }
  }
  selectedFixtureIndices.clear();
}

// ─── Helper: next fixture name ──────────────────────────────────────────
export function nextFixtureName(baseName) {
  const existing = params.parLights.map(l => l.name || '');
  let counter = 1;
  let candidate = baseName;
  while (existing.includes(candidate)) {
    counter++;
    candidate = baseName.replace(/ \d+$/, '') + ' ' + counter;
  }
  return candidate;
}

// ─── Pointer Move (snap cursor tracking) ─────────────────────────────────
export function onPointerMove(event) {
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

// ─── GUI Folder Sync ─────────────────────────────────────────────────────
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

// ─── Transform Change Handler ────────────────────────────────────────────
export function onTransformChange() {
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
      const dx = fixture.hitbox.position.x - startDrag.x;
      const dy = fixture.hitbox.position.y - startDrag.y;
      const dz = fixture.hitbox.position.z - startDrag.z;

      const currentQuat = fixture.hitbox.quaternion.clone();
      const startQuatInv = startDrag.quat.clone().invert();
      const deltaQuat = new THREE.Quaternion().multiplyQuaternions(currentQuat, startQuatInv);

      for (const idx of selectedFixtureIndices) {
        if (idx === dragIdx) continue;
        const startOther = dragStartState.fixtures[idx];
        const otherFixture = window.parFixtures[idx];
        if (!startOther || !otherFixture) continue;

        otherFixture.hitbox.position.set(
          startOther.x + dx,
          startOther.y + dy,
          startOther.z + dz
        );

        const newQuat = new THREE.Quaternion().multiplyQuaternions(deltaQuat, startOther.quat);
        otherFixture.hitbox.quaternion.copy(newQuat);

        otherFixture.writeTransformToConfig();
        otherFixture.updateVisualsFromHitbox();
      }
    }
  }

  if (window.debounceAutoSave) window.debounceAutoSave();
}

// ─── Pointer Down ────────────────────────────────────────────────────────
export function onPointerDown(event) {
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

      setSnapStep(2);
    } else if (snapStep === 2) {
      // Step 2: Aim the light at the clicked point
      const target = lastSnapPoint.clone();
      const pos = new THREE.Vector3(fixture.config.x, fixture.config.y, fixture.config.z);
      const dir = target.sub(pos).normalize();

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

      toggleSnapMode(true);
    }
    return;
  }
  // ─── Normal selection mode ───
  if (transformControl.axis) return;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(interactiveObjects, false);

  if (intersects.length > 0) {
    const hit = intersects[0].object;

    if (hit.userData.isTraceVisual) {
      transformControl.detach();
      deselectAllFixtures();
      if (window.openTraceFolder) window.openTraceFolder(hit.userData.traceIndex);
      syncGuiFolders();
      return;
    }

    transformControl.attach(hit);

    if (hit.userData.isTrace) {
      deselectAllFixtures();
      if (window.openTraceFolder) window.openTraceFolder(hit.userData.traceIndex);
    } else if (hit.userData.isLedStrand) {
      deselectAllFixtures();
      if (window.openStrandFolder && hit.userData.fixture) window.openStrandFolder(hit.userData.fixture.index);
    } else if (hit.userData.isIceberg) {
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

// ─── Keyboard Handler ────────────────────────────────────────────────────
export function onKeyDown(event) {
  // Undo / Redo (always active)
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
  // Transform mode shortcuts (T/R/S/Q)
  const k = event.key.toLowerCase();
  if (!event.ctrlKey && !event.metaKey) {
    if (k === 't') {
      if (transformControl.mode === 'translate') {
        transformControl.setSpace(transformControl.space === 'world' ? 'local' : 'world');
      } else {
        transformControl.setMode('translate');
        transformControl.setSpace('world');
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

  // P key: toggle snap mode
  if (k === 'p' && !event.ctrlKey && !event.metaKey) {
    toggleSnapMode();
    return;
  }

  // Delete selected par light(s)
  if (event.key === 'Delete') {
    if (selectedFixtureIndices.size > 0) {
      pushUndo();
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

  // Duplicate selected par light(s)
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

  // Maya (W,E) style hotkeys for translate/rotate
  switch (event.key.toLowerCase()) {
    case "w":
    case "g":
      transformControl.setMode("translate");
      break;
    case "e":
      transformControl.setMode("rotate");
      break;
  }
}

// Expose for external use
window.deselectAllFixtures = deselectAllFixtures;
window.toggleSnapMode = toggleSnapMode;
