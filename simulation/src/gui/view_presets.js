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
// Shared eased camera move (position + look target). Used by the view presets
// and by the mapping panel's chip-click focus (G5). Cubic ease in/out.
function animateCameraTo(targetPos, targetLook, duration = 1500) {
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const startTime = performance.now();

  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    camera.position.lerpVectors(startPos, targetPos, ease);
    controls.target.lerpVectors(startTarget, targetLook, ease);
    controls.update();

    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export function animateCameraToPreset(preset) {
  if (!preset || !preset.position || !preset.target) return;
  const targetPos = new THREE.Vector3(preset.position.x, preset.position.y, preset.position.z);
  const targetLook = new THREE.Vector3(preset.target.x, preset.target.y, preset.target.z);
  animateCameraTo(targetPos, targetLook, 1500);
}

/**
 * Frame a world-space point (G5 reverse link): fly the camera so `point` becomes
 * the orbit target, KEEPING the current view direction (so the operator isn't
 * spun around) and pulling back to a legible distance. The mapping panel calls
 * this via window.focusCameraOnPoint when a fixture/strand chip is clicked.
 * @param {{x:number,y:number,z:number}} point
 * @param {{distance?:number, duration?:number}} [opts]
 */
export function focusCameraOnPoint(point, opts = {}) {
  if (!point) return;
  const target = new THREE.Vector3(point.x, point.y, point.z);
  const dir = camera.position.clone().sub(controls.target);
  const curDist = dir.length();
  if (dir.lengthSq() < 1e-6) dir.set(0.6, 0.4, 0.6);
  dir.normalize();
  // Frame the fixture at a readable distance regardless of how far out the
  // current orbit sits (a far ship-wide view would otherwise keep it a speck).
  const dist = Math.min(90, Math.max(28, opts.distance ?? curDist * 0.6));
  const camPos = target.clone().add(dir.multiplyScalar(dist));
  animateCameraTo(camPos, target, opts.duration ?? 900);
}

// Legacy compatibility: animateCamera by name (used by agent_render.js)
export function animateCamera(viewName) {
  const preset = cameraPresets.find(p => p.key === viewName);
  if (preset) {
    animateCameraToPreset(preset);
  }
}

/**
 * Fly the camera to an ARBITRARY pose — a raw {position, target} pair with no
 * preset behind it. This is the seam agent tooling uses to frame a detail
 * (one fixture, one seam, one halo) without writing a throwaway preset into
 * the operator-owned `scenes/<scene>/cameras.yaml`. `agent_render.cjs
 * --camera x,y,z --target x,y,z` calls it through `window.animateCameraToPose`.
 *
 * Codex P0 — no fallbacks: a malformed pose throws instead of silently leaving
 * the camera where it was (a silent no-op would make a capture tool screenshot
 * the WRONG view and report success).
 *
 * @param {{x:number,y:number,z:number}} position - world-space camera position
 * @param {{x:number,y:number,z:number}} target   - world-space look-at / orbit target
 * @param {number} [duration=1200] - animation length in ms
 */
export function animateCameraToPose(position, target, duration = 1200) {
  const vec = (v, label) => {
    if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) {
      throw new Error(`[view_presets] animateCameraToPose: '${label}' must be {x,y,z} finite numbers, got ${JSON.stringify(v)}`);
    }
    return new THREE.Vector3(v.x, v.y, v.z);
  };
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(`[view_presets] animateCameraToPose: 'duration' must be a non-negative number, got ${JSON.stringify(duration)}`);
  }
  animateCameraTo(vec(position, 'position'), vec(target, 'target'), duration);
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
// The canvas sizes to the 3D SIM PANE, not the window. When the split-screen
// mapping layout is engaged, split_layout owns the sim-pane dimensions via
// window.__getSimViewport; with no split active it reports the full window.
export function onResize() {
  const vp = typeof window.__getSimViewport === 'function'
    ? window.__getSimViewport()
    : { width: window.innerWidth, height: window.innerHeight };
  camera.aspect = vp.width / vp.height;
  camera.updateProjectionMatrix();
  const { renderer } = window._threeRefs || {};
  if (renderer) {
    const prCap = window.initialParams?.pixelRatioCap !== undefined ? window.initialParams.pixelRatioCap : 1.25;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, prCap));
    renderer.setSize(vp.width, vp.height);
  }
}

// Expose for external use
window.animateCamera = animateCamera;
window.animateCameraToPose = animateCameraToPose;
window.focusCameraOnPoint = focusCameraOnPoint;
