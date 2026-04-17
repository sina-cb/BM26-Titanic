/**
 * view_presets.js — Camera presets, HUD, and view animation.
 */
import * as THREE from "three";
import yaml from "js-yaml";
import { camera, controls, cameraPresets, setCameraPresets } from "../core/state.js";

// ─── HUD Frame ──────────────────────────────────────────────────────────
export function setupHUD() {
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
export function setupViewPresets() {
  renderViewPresetsUI();
}

export function renderViewPresetsUI() {
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

    // Update button
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

export function animateCameraToPreset(preset) {
  if (!preset || !preset.position || !preset.target) return;

  const targetPos = new THREE.Vector3(preset.position.x, preset.position.y, preset.position.z);
  const targetLook = new THREE.Vector3(preset.target.x, preset.target.y, preset.target.z);

  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const duration = 1500;
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

// Legacy compatibility: animateCamera by name (used by agent_render.js)
export function animateCamera(viewName) {
  const preset = cameraPresets.find(p => p.key === viewName);
  if (preset) {
    animateCameraToPreset(preset);
  }
}

export function saveCameraPresets() {
  const yamlStr = yaml.dump({ presets: cameraPresets });
  const sceneParam = window.__activeScene ? `?scene=${window.__activeScene}` : '';
  fetch(`http://localhost:6970/save-cameras${sceneParam}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: yamlStr,
  }).catch(err => console.warn('Failed to save camera presets:', err));
}

// ─── Resize Handler ─────────────────────────────────────────────────────
export function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const { renderer } = window._threeRefs || {};
  if (renderer) renderer.setSize(window.innerWidth, window.innerHeight);
}

// Expose for external use
window.animateCamera = animateCamera;
