/**
 * view_presets_row.js — Modern (Preact) camera-preset row.
 *
 * Builds the camera-preset row. The camera math and persistence stay in
 * src/gui/view_presets.js and are imported here — `animateCameraToPreset`
 * / `saveCameraPresets` are pure logic, and importing the module keeps
 * `window.animateCamera` (agent_render dependency) registered.
 *
 * Renders into the existing `#view-presets` container with the same
 * classes and `data-view` attributes, so style.css, edit-mode hiding,
 * and the render tool all keep working.
 */

import { html } from 'htm/preact';
import { signal } from '@preact/signals';

import { camera, controls, cameraPresets } from '../../core/state.js';
import { animateCameraToPreset, saveCameraPresets } from '../view_presets.js';

// Bumped after every mutation so the row re-renders from the (mutable,
// legacy-owned) cameraPresets array.
const presetsRevision = signal(0);

function roundedVec(v) {
  return {
    x: Math.round(v.x * 1000) / 1000,
    y: Math.round(v.y * 1000) / 1000,
    z: Math.round(v.z * 1000) / 1000,
  };
}

function addPreset() {
  const name = prompt('Preset name:');
  if (!name || !name.trim()) return;
  const key = name.trim().toLowerCase().replace(/\s+/g, '-');
  cameraPresets.push({
    name: name.trim(),
    key,
    position: roundedVec(camera.position),
    target: roundedVec(controls.target),
  });
  saveCameraPresets();
  presetsRevision.value++;
}

function updatePreset(preset, btn) {
  preset.position = roundedVec(camera.position);
  preset.target = roundedVec(controls.target);
  saveCameraPresets();
  btn.style.color = 'var(--ok)';
  setTimeout(() => { btn.style.color = ''; }, 600);
}

function removePreset(index, preset) {
  if (!confirm(`Remove preset "${preset.name}"?`)) return;
  cameraPresets.splice(index, 1);
  saveCameraPresets();
  presetsRevision.value++;
}

export function ViewPresetsRow() {
  presetsRevision.value; // subscribe

  return html`
    <button class="preset-add" title="Add new camera preset from current view"
            onClick=${addPreset}>+</button>
    ${cameraPresets.map((preset, i) => html`
      <div class="preset-group" key=${`${preset.key}:${i}`}>
        <button class="preset-name" data-view=${preset.key}
                title=${`Go to ${preset.name} view`}
                onClick=${() => animateCameraToPreset(preset)}>
          ${preset.name}
        </button>
        <button class="preset-action update" title=${`Update "${preset.name}" from current camera`}
                onClick=${(e) => { e.stopPropagation(); updatePreset(preset, e.currentTarget); }}>
          🔄
        </button>
        <button class="preset-action remove" title=${`Remove "${preset.name}"`}
                onClick=${(e) => { e.stopPropagation(); removePreset(i, preset); }}>
          ✕
        </button>
      </div>
    `)}
  `;
}
