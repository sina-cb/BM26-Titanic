/**
 * view_presets.js — Camera presets, HUD, and view animation.
 */
import * as THREE from "three";
import yaml from "js-yaml";
import { camera, controls, cameraPresets } from "../core/state.js";
import { isStaticHost, logStaticHostSkip } from "../core/static_host.js";

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
// The preset row UI is the Preact <ViewPresetsRow> in
// src/gui/modern/view_presets_row.js; the camera math + persistence below
// are shared by it.
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
  if (isStaticHost()) {
    logStaticHostSkip('save-cameras (port 6970)');
    return;
  }
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
  if (renderer) {
    const prCap = window.initialParams?.pixelRatioCap !== undefined ? window.initialParams.pixelRatioCap : 1.25;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, prCap));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// Expose for external use
window.animateCamera = animateCamera;
