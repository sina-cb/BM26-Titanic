/**
 * gui_builder.js — Full GUI construction (lil-gui).
 * Contains: setupGUI(), handler registry, generic builders,
 * and all section builders (par lights, DMX, LED strands, icebergs).
 */
import * as THREE from "three";
import yaml from "js-yaml";
import {
  scene, camera, renderer, composer, controls,
  transformControl, interactiveObjects,
  model, modelCenter, modelSize, modelRadius, modelMeshes,
  structureMaterial, editMaterial,
  gridHelper, ground, starField,
  lights, params, configTree,
  selectedFixtureIndices, selectedDmxIndices,
  undoStack, redoStack, MAX_UNDO,
  setEngineEnabled, setLightingEnabled, setLightingMode,
} from "../core/state.js";
import { captureSnapshot, pushUndo } from "../core/undo.js";
import { reconstructYAML } from "../core/config.js";
import { rebuildParLights, rebuildDmxFixtures } from "../core/fixtures.js";
import { deselectAllFixtures, nextFixtureName } from "../core/interaction.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";
import { listTypes, getDefinition } from "../dmx/fixture_definition_registry.js";
import { DmxFixtureRuntime } from "../fixtures/dmx_fixture_runtime.js";
import { ModelFixture } from "../fixtures/model_fixture.js";
import { LedStrand } from "../fixtures/led_strand.js";
import { Iceberg } from "../fixtures/iceberg.js";

// NOTE: engineEnabled / lightingEnabled / lightingMode live in state.js.
// Use the setters imported above to update them so animate.js sees changes.

export
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
      .replace(/^dmxLights:/m, '\n# ─── DMX Lights ───────────────────────────────────────────────────────────\ndmxLights:')
      .replace(/^options:/m, '\n# ─── Options ──────────────────────────────────────────────────────────────\noptions:')
      .replace(/^config:/m, '\n# ─── Configuration ────────────────────────────────────────────────────────\nconfig:');

    const sceneParam = window.__activeScene ? `?scene=${window.__activeScene}` : '';
    fetch(`http://localhost:6970/save${sceneParam}`, {
      method: "POST",
      body: yamlStr,
    })
      .then(() => {
        console.log(`Config saved${window.__activeScene ? ` (scene: ${window.__activeScene})` : ''}`);
        showSaveToast();
      })
      .catch((err) => console.error("Failed to write config:", err));

    // Also export the pixel model for Pixelblaze patterns
    saveModelJS();
  }

  function saveModelJS() {
    const pixels = [];

    // Par lights → one pixel each
    if (params.parLights) {
      params.parLights.forEach((light, i) => {
        pixels.push({
          type: 'par',
          name: light.name || `Par ${i + 1}`,
          group: light.group || '',
          x: +(light.x || 0),
          y: +(light.y || 0),
          z: +(light.z || 0),
        });
      });
    }

    // DMX Fixtures → iterate actual physical pixels for mapping
    if (params.dmxFixtures) {
      params.dmxFixtures.forEach((light, i) => {
        const fixture = window.dmxSceneFixtures ? window.dmxSceneFixtures[i] : null;
        if (fixture && fixture.pixels && fixture.pixels.length > 0) {
          fixture.pixels.forEach((px, j) => {
            const worldPos = new THREE.Vector3();
            if (px.dots) px.dots.getWorldPosition(worldPos);
            else worldPos.set(light.x || 0, light.y || 0, light.z || 0);

            pixels.push({
              type: 'dmx',
              name: light.name ? `${light.name} (Ch ${j + 1})` : `DMX ${i + 1} (Ch ${j + 1})`,
              group: light.group || '',
              x: +(worldPos.x).toFixed(3),
              y: +(worldPos.y).toFixed(3),
              z: +(worldPos.z).toFixed(3),
            });
          });
        } else {
          pixels.push({
            type: 'dmx',
            name: light.name || `DMX ${i + 1}`,
            group: light.group || '',
            x: +(light.x || 0),
            y: +(light.y || 0),
            z: +(light.z || 0),
          });
        }
      });
    }

    // LED strands → one pixel per LED
    if (params.ledStrands) {
      params.ledStrands.forEach((strand) => {
        const count = strand.ledCount || 10;
        const sx = +(strand.startX || 0), sy = +(strand.startY || 0), sz = +(strand.startZ || 0);
        const ex = +(strand.endX || 0), ey = +(strand.endY || 0), ez = +(strand.endZ || 0);
        for (let j = 0; j < count; j++) {
          const t = count > 1 ? j / (count - 1) : 0.5;
          pixels.push({
            type: 'led',
            name: strand.name || 'Strand',
            group: strand.name || '',
            x: +(sx + (ex - sx) * t).toFixed(3),
            y: +(sy + (ey - sy) * t).toFixed(3),
            z: +(sz + (ez - sz) * t).toFixed(3),
          });
        }
      });
    }

    // Iceberg LEDs
    if (params.icebergs) {
      params.icebergs.forEach((berg) => {
        pixels.push({
          type: 'iceberg',
          name: berg.name || 'Iceberg',
          group: berg.name || '',
          x: +(berg.x || 0),
          y: +(berg.y || 0),
          z: +(berg.z || 0),
        });
      });
    }

    // Compute bounding box for normalization
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    pixels.forEach(p => {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    });
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const rangeZ = maxZ - minZ || 1;

    // ── Auto-pack DMX patches (sequential addressing) ──
    // Footprint: par=10ch, led=3ch, iceberg=3ch
    let patchUniverse = 1;
    let patchAddr = 1;
    pixels.forEach(p => {
      const footprint = (p.type === 'par') ? 10 : 3;
      if (patchAddr + footprint - 1 > 512) {
        patchUniverse++;
        patchAddr = 1;
      }
      p.patch = { universe: patchUniverse, addr: patchAddr, footprint };
      p.channels = 3; // RGB output for v1
      patchAddr += footprint;
    });

    // Build JS source
    const lines = [
      '// Auto-generated Pixelblaze model — do not edit manually',
      '// Updated: ' + new Date().toISOString(),
      '//',
      '// Each pixel has: index, type, name, group, world coords (x,y,z),',
      '// normalized coords (nx,ny,nz) in [0..1], and DMX patch info',
      '',
      'export const pixelCount = ' + pixels.length + ';',
      '',
      'export const pixels = [',
    ];

    pixels.forEach((p, i) => {
      const nx = +((p.x - minX) / rangeX).toFixed(4);
      const ny = +((p.y - minY) / rangeY).toFixed(4);
      const nz = +((p.z - minZ) / rangeZ).toFixed(4);
      const patchStr = `{ universe: ${p.patch.universe}, addr: ${p.patch.addr}, footprint: ${p.patch.footprint} }`;
      lines.push(`  { i: ${i}, type: '${p.type}', name: '${p.name}', group: '${p.group}', x: ${p.x}, y: ${p.y}, z: ${p.z}, nx: ${nx}, ny: ${ny}, nz: ${nz}, patch: ${patchStr}, channels: ${p.channels} },`);
    });

    lines.push('];');
    lines.push('');

    const modelJS = lines.join('\n');
    const sceneParam = window.__activeScene ? `?scene=${window.__activeScene}` : '';
    fetch(`http://localhost:6970/save-model${sceneParam}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: modelJS,
    }).catch(err => console.warn('[PB] Failed to save model:', err));
  }
  window.saveModelJS = saveModelJS;

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
  // Bloom controls via WebGPU node-based PostProcessing uniforms
  const _bp = window._bloomParams || {};
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
      if (_bp.strength) _bp.strength.value = v;
    },
    bloomRadius: (v) => {
      if (_bp.radius) _bp.radius.value = v;
    },
    bloomThreshold: (v) => {
      if (_bp.threshold) _bp.threshold.value = v;
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
    generatorsVisible: (v) => {
      if (window.setTraceObjectsVisibility) window.setTraceObjectsVisibility(v);
    },
    liteMode: () => {
      // Rebuild all fixtures — SpotLights are created/skipped based on liteMode
      if (window.rebuildParLights) window.rebuildParLights(true);
      if (window.rebuildDmxFixtures) window.rebuildDmxFixtures(true);
    },
    editMode: (isEditMode) => {
      if (!model) return;
      model.traverse((child) => {
        if (child.isMesh)
          child.material = isEditMode ? editMaterial : structureMaterial;
      });
      // Only toggle shadows on moon + tower floods, NOT par lights
      if (lights.moon) lights.moon.castShadow = !isEditMode;
      lights.towers.forEach((t) => { t.castShadow = !isEditMode; });
      // Bloom toggle: set strength to 0 in edit mode
      if (_bp.strength) _bp.strength.value = isEditMode ? 0 : (params.bloomStrength || 0.35);
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

    // ── sACN Settings sub-folder ──
    const sacnFolder = engineFolder.addFolder('📡 sACN Settings');
    addControl(sacnFolder, 'sacn_enabled', sectionConfig.sacn_enabled || { value: true, label: '📡 Bridge Enabled' });
    addControl(sacnFolder, 'sacn_universes', sectionConfig.sacn_universes || { value: '1,2,3,4', label: '📡 Listen Universes' });
    addControl(sacnFolder, 'sacn_lockout_ms', sectionConfig.sacn_lockout_ms || { value: 10000, label: '📡 Source Lockout (ms)', min: 1000, max: 30000, step: 1000 });
    addControl(sacnFolder, 'sacn_high_priority', sectionConfig.sacn_high_priority || { value: 150, label: '📡 High Priority', min: 100, max: 200, step: 10 });
    addControl(sacnFolder, 'sacn_stale_ms', sectionConfig.sacn_stale_ms || { value: 2000, label: '📡 Source Stale (ms)', min: 500, max: 10000, step: 500 });

    // ── Mode visibility ──
    const sacnMonitorPanel = document.getElementById('sacn-monitor-panel');

    function updateModeVisibility() {
      const mode = params.lightingMode || 'gradient';
      const enabled = !!params.lightingEnabled;
      // Toggle sub-folders based on mode
      gradientFolder.domElement.style.display = mode === 'gradient' ? '' : 'none';
      sacnFolder.domElement.style.display = mode === 'sacn_in' ? '' : 'none';
      // Show pattern editor only in pixelblaze mode when enabled
      if (window.showPatternEditor) window.showPatternEditor(mode === 'pixelblaze' && enabled);
      // Show sACN monitor panel directly
      if (sacnMonitorPanel) {
        sacnMonitorPanel.classList.toggle('hidden', !(mode === 'sacn_in' && enabled));
      }
      if (window.showSacnMonitor) window.showSacnMonitor(mode === 'sacn_in' && enabled);
      // Sync engine state → state.js so animate.js sees the change
      setEngineEnabled(mode === 'pixelblaze' && enabled);
      setLightingEnabled(enabled);
      setLightingMode(mode);
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
        if (window.onLightingChange) window.onLightingChange();
      });
    addControl(engineFolder, 'lightingMode', sectionConfig.lightingMode || { value: 'gradient', label: 'Mode', options: ['gradient', 'pixelblaze', 'sacn_in'] })
      .onChange(() => { updateModeVisibility(); if (window.onLightingChange) window.onLightingChange(); });

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
        // Special: dmxArray → build DMX Lights UI
        if (sectionMeta.type === "dmxArray") {
          buildDmxLightsSection(parentFolder, entry);
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

      // ─── Auto-Patch All button ───
      // Remove any stale auto-patch buttons from previous renders
      const plChildrenCleanup = parListFolder.domElement.querySelector('.children');
      if (plChildrenCleanup) {
        plChildrenCleanup.querySelectorAll('.auto-patch-wrap').forEach(el => el.remove());
      }
      const autoPatchWrap = document.createElement('div');
      autoPatchWrap.className = 'auto-patch-wrap';
      autoPatchWrap.style.cssText = 'display:flex;gap:4px;padding:4px 6px;border-bottom:1px solid #333;';
      const autoPatchBtn = document.createElement('button');
      autoPatchBtn.textContent = '🎯 Auto-Patch All Unpatched';
      autoPatchBtn.style.cssText = 'flex:1;padding:4px 0;border:none;border-radius:3px;background:#1a2a3a;color:#6af;cursor:pointer;font-size:10px;font-family:inherit;font-weight:600;';
      
      const clearPatchBtn = document.createElement('button');
      clearPatchBtn.textContent = '❌ Clear All Patches';
      clearPatchBtn.style.cssText = 'flex:1;padding:4px 0;border:none;border-radius:3px;background:#3a1a1a;color:#f66;cursor:pointer;font-size:10px;font-family:inherit;font-weight:600;';
      clearPatchBtn.onclick = () => {
        if (!confirm('Clear all DMX patch mappings?')) return;
        pushUndo();
        params.parLights.forEach(c => {
          c.controllerIp = '';
          c.dmxUniverse = 0;
          c.dmxAddress = 0;
          c.controllerId = 0;
          c.sectionId = 0;
          c.fixtureId = 0;
          c.viewMask = 0;
        });
        updateToast(`Cleared DMX patches`);
        if (window._setGuiRebuilding) window._setGuiRebuilding(true);
        renderParGUI();
        if (window._setGuiRebuilding) window._setGuiRebuilding(false);
        debounceAutoSave();
      };
      // autoPatchBtn's onclick logic follows:
      autoPatchBtn.onclick = () => {
        let universe = 1;
        let address = 1;

        // Build occupancy map from already-patched fixtures
        const occupied = new Map(); // universe -> Set of occupied addresses
        params.parLights.forEach(c => {
          if (c.dmxUniverse > 0 && c.dmxAddress > 0) {
            if (!occupied.has(c.dmxUniverse)) occupied.set(c.dmxUniverse, new Set());
            const fDef = getDefinition(c.fixtureType || 'UkingPar');
            const fp = fDef?.footprint || 10;
            for (let ch = c.dmxAddress; ch < c.dmxAddress + fp; ch++) {
              occupied.get(c.dmxUniverse).add(ch);
            }
          }
        });

        // Find next free slot
        const findFreeSlot = (footprint) => {
          while (true) {
            if (address + footprint - 1 > 512) {
              universe++;
              address = 1;
            }
            // Check for overlap with existing patches
            let conflict = false;
            if (occupied.has(universe)) {
              for (let ch = address; ch < address + footprint; ch++) {
                if (occupied.get(universe).has(ch)) {
                  conflict = true;
                  address = ch + 1;
                  break;
                }
              }
            }
            if (!conflict) return { universe, address };
          }
        };

        let patchedCount = 0;
        pushUndo();
        params.parLights.forEach(c => {
          if (c.dmxUniverse > 0 && c.dmxAddress > 0) return; // already patched
          const fDef = getDefinition(c.fixtureType || 'UkingPar');
          const fp = fDef?.footprint || 10;
          const slot = findFreeSlot(fp);
          c.dmxUniverse = slot.universe;
          c.dmxAddress = slot.address;
          // Mark as occupied
          if (!occupied.has(slot.universe)) occupied.set(slot.universe, new Set());
          for (let ch = slot.address; ch < slot.address + fp; ch++) {
            occupied.get(slot.universe).add(ch);
          }
          address = slot.address + fp;
          universe = slot.universe;
          patchedCount++;
        });

        if (patchedCount === 0) {
          alert('All fixtures are already patched.');
          return;
        }

        if (window._setGuiRebuilding) window._setGuiRebuilding(true);
        renderParGUI();
        if (window._setGuiRebuilding) window._setGuiRebuilding(false);
        debounceAutoSave();
        console.log(`[Auto-Patch] Assigned ${patchedCount} fixtures across universes 1-${universe}`);
      };
      autoPatchWrap.appendChild(autoPatchBtn);
      autoPatchWrap.appendChild(clearPatchBtn);
      const plChildren = parListFolder.domElement.querySelector('.children');
      if (plChildren) plChildren.prepend(autoPatchWrap);

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

        // Trace-generated groups: show fixtures with limited editing (DMX patch only)
        if (isTraceGroup) {
          const gBtnStyle2 = 'flex:1;padding:2px 0;border:none;border-radius:3px;background:#2a2a2a;cursor:pointer;font-size:10px;font-family:inherit;';
          const traceRow = document.createElement('div');
          traceRow.style.cssText = 'display:flex;gap:2px;padding:2px 6px 4px;align-items:center;';

          const groupHidden = items.length > 0 && items.every(({ index }) =>
            window.parFixtures[index] && !window.parFixtures[index].group.visible
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

          const genLabel = document.createElement('span');
          genLabel.style.cssText = 'color:#888;font-size:10px;font-style:italic;margin-left:4px;';
          genLabel.textContent = '🔧 Generated';

          traceRow.appendChild(visBtn);
          traceRow.appendChild(genLabel);
          const gc = groupFolder.domElement.querySelector('.children');
          if (gc) gc.prepend(traceRow);

          // Show individual generated fixtures with limited editing
          items.forEach(({ config, index }, localIdx) => {
            try {
              if (!config.name) config.name = `Fixture ${localIdx + 1}`;
              const folderTitle = `${config.name}`;
              const genFixFolder = groupFolder.addFolder(folderTitle);
              genFixFolder.domElement.classList.add('gui-card');
              genFixFolder.close();
              window.parGuiFolders[index] = genFixFolder;

              // Name (editable)
              genFixFolder.add(config, 'name').name('Name').onFinishChange((v) => {
                genFixFolder.title(v);
                debounceAutoSave();
              });

              // Generator info — styled DOM label instead of lil-gui controller
              const infoDiv = document.createElement('div');
              infoDiv.style.cssText = 'padding:2px 8px 4px;color:#888;font-size:9px;font-style:italic;';
              infoDiv.textContent = '📍 Position controlled by generator';
              const genChildren = genFixFolder.domElement.querySelector('.children');
              if (genChildren) genChildren.appendChild(infoDiv);

              // 📡 DMX Patch — compact DOM-based controls
              if (config.dmxUniverse === undefined) config.dmxUniverse = 0;
              if (config.dmxAddress === undefined) config.dmxAddress = 0;
              const fixtureType = config.fixtureType || 'UkingPar';
              const fDef = getDefinition(fixtureType);
              const footprint = fDef?.footprint || 10;

              // V2 metadata defaults — fixtureId auto-derived from DMX patch
              if (config.controllerId === undefined) config.controllerId = 0;
              if (config.sectionId === undefined) config.sectionId = 0;
              if (config.fixtureId === undefined) config.fixtureId = Math.min(65535, config.dmxUniverse * 1000 + config.dmxAddress);
              if (config.viewMask === undefined) config.viewMask = 0;

              const autoFixtureId = () => {
                config.fixtureId = Math.min(65535, config.dmxUniverse * 1000 + config.dmxAddress);
                if (fixtureIdDisplay) fixtureIdDisplay.textContent = config.fixtureId;
                if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('metadata');
              };

              const patchDiv = document.createElement('div');
              patchDiv.style.cssText = 'padding:2px 8px 6px;';

              // Header row
              const patchHeader = document.createElement('div');
              patchHeader.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:3px;';
              patchHeader.innerHTML = `<span style="color:#aaa;font-size:10px;font-weight:600;">📡 DMX Patch</span><span style="color:#666;font-size:9px;">${fixtureType} · ${footprint}ch</span>`;
              patchDiv.appendChild(patchHeader);

              // Universe + Address row
              const patchRow = document.createElement('div');
              patchRow.style.cssText = 'display:flex;gap:4px;align-items:center;';

              const mkLabel = (text) => { const s = document.createElement('span'); s.style.cssText = 'color:#777;font-size:9px;'; s.textContent = text; return s; };
              const mkInput = (value, max, onchange) => {
                const inp = document.createElement('input');
                inp.type = 'number'; inp.min = 0; inp.max = max; inp.step = 1; inp.value = value;
                inp.style.cssText = 'width:48px;padding:2px 4px;border:1px solid #444;border-radius:3px;background:#1a1a1a;color:#ccc;font-size:10px;font-family:inherit;text-align:center;';
                inp.onchange = () => { onchange(Math.max(0, Math.min(max, Math.round(Number(inp.value))))); };
                return inp;
              };

              patchRow.appendChild(mkLabel('U:'));
              const uniInput = mkInput(config.dmxUniverse, 63999, (v) => { config.dmxUniverse = v; uniInput.value = v; updateStatus(); autoFixtureId(); debounceAutoSave(); });
              patchRow.appendChild(uniInput);

              patchRow.appendChild(mkLabel('Addr:'));
              const addrInput = mkInput(config.dmxAddress, 512, (v) => { config.dmxAddress = v; addrInput.value = v; updateStatus(); autoFixtureId(); debounceAutoSave(); });
              patchRow.appendChild(addrInput);

              // Status dot
              const statusDot = document.createElement('span');
              statusDot.style.cssText = 'font-size:10px;margin-left:auto;';
              const updateStatus = () => {
                const patched = config.dmxUniverse > 0 && config.dmxAddress > 0;
                statusDot.textContent = patched ? '🟢' : '⚫';
                statusDot.title = patched ? `Patched: U${config.dmxUniverse}:${config.dmxAddress}` : 'Unpatched';
              };
              updateStatus();
              patchRow.appendChild(statusDot);

              patchDiv.appendChild(patchRow);

              // Controller IP row (inherited from generator, read-only)
              const ipRow = document.createElement('div');
              ipRow.style.cssText = 'display:flex;gap:4px;align-items:center;margin-top:3px;';
              ipRow.appendChild(mkLabel('IP:'));
              const ipDisplay = document.createElement('span');
              ipDisplay.style.cssText = 'color:#999;font-size:9px;font-style:italic;';
              ipDisplay.textContent = config.controllerIp || '(not set)';
              ipRow.appendChild(ipDisplay);
              patchDiv.appendChild(ipRow);

              if (genChildren) genChildren.appendChild(patchDiv);

              // 🔖 V2 Metadata — compact DOM controls
              const metaDiv = document.createElement('div');
              metaDiv.style.cssText = 'padding:2px 8px 6px;';

              const metaHeader = document.createElement('div');
              metaHeader.style.cssText = 'margin-bottom:3px;';
              metaHeader.innerHTML = `<span style="color:#aaa;font-size:10px;font-weight:600;">🔖 Metadata (V2)</span>`;
              metaDiv.appendChild(metaHeader);

              const metaRow1 = document.createElement('div');
              metaRow1.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:2px;';
              const metaChanged = () => {
                if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('metadata');
                debounceAutoSave();
              };

              metaRow1.appendChild(mkLabel('Ctrl:'));
              metaRow1.appendChild(mkInput(config.controllerId, 255, (v) => { config.controllerId = v; metaChanged(); }));
              metaRow1.appendChild(mkLabel('Sect:'));
              metaRow1.appendChild(mkInput(config.sectionId, 255, (v) => { config.sectionId = v; metaChanged(); }));
              metaDiv.appendChild(metaRow1);

              const metaRow2 = document.createElement('div');
              metaRow2.style.cssText = 'display:flex;gap:4px;align-items:center;';
              metaRow2.appendChild(mkLabel('Fix ID:'));
              // fixtureId is auto-computed, show as read-only display
              const fixtureIdDisplay = document.createElement('span');
              fixtureIdDisplay.style.cssText = 'color:#6af;font-size:10px;font-weight:600;min-width:32px;';
              fixtureIdDisplay.textContent = config.fixtureId;
              fixtureIdDisplay.title = 'Auto: Universe × 1000 + Address';
              metaRow2.appendChild(fixtureIdDisplay);

              metaRow2.appendChild(mkLabel('View:'));
              metaRow2.appendChild(mkInput(config.viewMask, 65535, (v) => { config.viewMask = v; metaChanged(); }));
              metaDiv.appendChild(metaRow2);

              if (genChildren) genChildren.appendChild(metaDiv);
            } catch (err) {
              console.warn(`[GUI] Error creating generated fixture ${index} UI:`, err);
            }
          });

          // Don't render full controls for generated groups
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
          window.parFixtures[index] && !window.parFixtures[index].group.visible
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

        // Fixture type selector + add button
        const addWrap = document.createElement('div');
        addWrap.style.cssText = 'display:flex;gap:2px;flex:1;';
        const typeSelect = document.createElement('select');
        typeSelect.style.cssText = 'flex:1;padding:2px;border:none;border-radius:3px;background:#2a2a2a;color:#aaa;font-size:10px;font-family:inherit;cursor:pointer;';
        const availableTypes = listTypes();
        if (availableTypes.length === 0) availableTypes.push('UkingPar');
        availableTypes.forEach(t => {
          const def = getDefinition(t);
          const ch = def ? def.footprint : '?';
          const opt = document.createElement('option');
          opt.value = t;
          opt.textContent = `${t} (${ch}ch)`;
          typeSelect.appendChild(opt);
        });
        const addBtn = document.createElement('button');
        addBtn.textContent = '+';
        addBtn.title = 'Add fixture of selected type';
        addBtn.style.cssText = 'padding:2px 8px;border:none;border-radius:3px;background:#1a3a1a;color:#6f6;cursor:pointer;font-size:10px;font-family:inherit;font-weight:bold;';
        addBtn.onclick = () => {
          pushUndo();
          const selectedType = typeSelect.value;
          const def = getDefinition(selectedType);
          const idx = params.parLights.length + 1;
          params.parLights.push({
            group: groupName,
            name: `${selectedType} ${idx}`,
            fixtureType: selectedType,
            color: def?.defaultColor || '#ffaa44',
            intensity: def?.defaultIntensity || 5,
            angle: def?.defaultAngle || 20,
            penumbra: def?.defaultPenumbra || 0.5,
            x: 0, y: 1.5, z: 0, rotX: 0, rotY: 0, rotZ: 0,
            dmxUniverse: 0, dmxAddress: 0, controllerIp: '',
            controllerId: 0, sectionId: 0, fixtureId: 0, viewMask: 0,
          });
          if (window._setGuiRebuilding) window._setGuiRebuilding(true);
          renderParGUI();
          rebuildParLights();
          if (window._setGuiRebuilding) window._setGuiRebuilding(false);
          debounceAutoSave();
        };
        addWrap.appendChild(typeSelect);
        addWrap.appendChild(addBtn);

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
        row2.appendChild(addWrap);
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
          // V2 metadata defaults
          if (config.controllerId === undefined) config.controllerId = 0;
          if (config.sectionId === undefined) config.sectionId = 0;
          if (config.fixtureId === undefined) config.fixtureId = 0;
          if (config.viewMask === undefined) config.viewMask = 0;

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

          // V2 Metadata
          const metaFolder = idxFolder.addFolder("🔖 Metadata (V2)");
          metaFolder.close();
          const metaChanged = () => {
            if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('metadata');
            debounceAutoSave();
          };
          metaFolder.add(config, 'controllerId', 0, 255, 1).name('Controller ID').onChange(metaChanged);
          metaFolder.add(config, 'sectionId', 0, 255, 1).name('Section ID').onChange(metaChanged);
          metaFolder.add(config, 'fixtureId', 0, 255, 1).name('Fixture ID').onChange(metaChanged);
          metaFolder.add(config, 'viewMask', 0, 65535, 1).name('View Mask').onChange(metaChanged);

          // ── 📡 DMX Patch — compact DOM controls ──
          if (config.dmxUniverse === undefined) config.dmxUniverse = 0;
          if (config.dmxAddress === undefined) config.dmxAddress = 0;
          const fixtureType = config.fixtureType || 'UkingPar';
          const fDef = getDefinition(fixtureType);
          const footprint = fDef?.footprint || 10;

          const patchDiv = document.createElement('div');
          patchDiv.style.cssText = 'padding:3px 8px 6px;';

          // Header
          const patchHeader = document.createElement('div');
          patchHeader.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:3px;';
          patchHeader.innerHTML = `<span style="color:#aaa;font-size:10px;font-weight:600;">📡 DMX Patch</span><span style="color:#666;font-size:9px;">${fixtureType} · ${footprint}ch</span>`;
          patchDiv.appendChild(patchHeader);

          // Universe + Address row
          const patchRow = document.createElement('div');
          patchRow.style.cssText = 'display:flex;gap:4px;align-items:center;';

          const mkLabel = (text) => { const s = document.createElement('span'); s.style.cssText = 'color:#777;font-size:9px;'; s.textContent = text; return s; };
          const mkInput = (value, max, onchange) => {
            const inp = document.createElement('input');
            inp.type = 'number'; inp.min = 0; inp.max = max; inp.step = 1; inp.value = value;
            inp.style.cssText = 'width:52px;padding:2px 4px;border:1px solid #444;border-radius:3px;background:#1a1a1a;color:#ccc;font-size:10px;font-family:inherit;text-align:center;';
            inp.onchange = () => { onchange(Math.max(0, Math.min(max, Math.round(Number(inp.value))))); };
            return inp;
          };

          patchRow.appendChild(mkLabel('U:'));
          const uniInput = mkInput(config.dmxUniverse, 63999, (v) => { config.dmxUniverse = v; uniInput.value = v; updatePatchStatus(); debounceAutoSave(); });
          patchRow.appendChild(uniInput);

          patchRow.appendChild(mkLabel('Addr:'));
          const addrInput = mkInput(config.dmxAddress, 512, (v) => { config.dmxAddress = v; addrInput.value = v; updatePatchStatus(); debounceAutoSave(); });
          patchRow.appendChild(addrInput);

          // Status dot
          const patchStatusDot = document.createElement('span');
          patchStatusDot.style.cssText = 'font-size:10px;margin-left:auto;';
          const updatePatchStatus = () => {
            const patched = config.dmxUniverse > 0 && config.dmxAddress > 0;
            patchStatusDot.textContent = patched ? '🟢' : '⚫';
            patchStatusDot.title = patched ? `Patched: U${config.dmxUniverse}:${config.dmxAddress}` : 'Unpatched';
          };
          updatePatchStatus();
          patchRow.appendChild(patchStatusDot);

          patchDiv.appendChild(patchRow);

          // Controller IP row
          if (config.controllerIp === undefined) config.controllerIp = '';
          const ipRow = document.createElement('div');
          ipRow.style.cssText = 'display:flex;gap:4px;align-items:center;margin-top:3px;';
          ipRow.appendChild(mkLabel('IP:'));
          const ipInput = document.createElement('input');
          ipInput.type = 'text';
          ipInput.value = config.controllerIp || '';
          ipInput.placeholder = '10.1.1.102';
          ipInput.style.cssText = 'flex:1;padding:2px 4px;border:1px solid #444;border-radius:3px;background:#1a1a1a;color:#ccc;font-size:10px;font-family:inherit;';
          ipInput.onchange = () => { config.controllerIp = ipInput.value.trim(); debounceAutoSave(); };
          ipRow.appendChild(ipInput);
          patchDiv.appendChild(ipRow);

          const idxChildren = idxFolder.domElement.querySelector('.children');
          if (idxChildren) idxChildren.appendChild(patchDiv);

          // Compact action row
          const actDiv = document.createElement('div');
          actDiv.style.cssText = 'display:flex;gap:2px;padding:4px 6px;border-top:1px solid #333;margin-top:4px;';
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
          const actChildren = idxFolder.domElement.querySelector('.children');
          if (actChildren) actChildren.appendChild(actDiv);
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
              controllerId: 0, sectionId: 0, fixtureId: 0, viewMask: 0,
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
    function setTraceObjectsVisibility(visible) {
      (window.traceObjects || []).forEach(t => {
        if (t.group) t.group.visible = visible;
        if (t.hitbox) t.hitbox.visible = visible;
        (t.handles || []).forEach(h => { h.visible = visible; });
      });
    }
    window.setTraceObjectsVisibility = setTraceObjectsVisibility;

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
      // Get fixture width for spacing (use fixture dimensions if available)
      const fixtureType = trace.fixtureType || 'UkingPar';
      const fixtureDef = getDefinition(fixtureType);
      const fixtureWidth = DmxFixtureRuntime.getFixtureWidth(fixtureDef);
      // Effective spacing: at least the fixture width, or user-specified spacing
      const effectiveSpacing = Math.max(trace.spacing || 2, fixtureWidth);

      if (trace.shape === 'circle') {
        const r = trace.radius || 5;
        const arcRad = THREE.MathUtils.degToRad(trace.arc || 360);
        const circumference = r * arcRad;
        const count = Math.max(1, Math.round(circumference / effectiveSpacing));
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * arcRad;
          pts.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
        }
      } else {
        // line: world-space start to end
        const start = new THREE.Vector3(trace.startX ?? 0, trace.startY ?? 5, trace.startZ ?? 0);
        const end   = new THREE.Vector3(trace.endX ?? 10, trace.endY ?? 5, trace.endZ ?? 0);
        const totalLen = start.distanceTo(end);
        const count = Math.max(2, Math.round(totalLen / effectiveSpacing));
        for (let i = 0; i < count; i++) {
          const t = i / (count - 1);
          pts.push(new THREE.Vector3().lerpVectors(start, end, t));
        }
      }
      return pts;
    }

    // Orient a trace handle so local X aligns with the start→end path direction
    function orientTraceHandle(handle, startPos, endPos) {
      const dir = new THREE.Vector3().subVectors(endPos, startPos).normalize();
      if (dir.lengthSq() < 0.0001) return; // degenerate — skip
      const up = new THREE.Vector3(0, 1, 0);
      // If path is nearly vertical, use a different up vector
      if (Math.abs(dir.dot(up)) > 0.99) up.set(0, 0, 1);
      const mtx = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, up);
      handle.quaternion.setFromRotationMatrix(mtx);
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
        orientTraceHandle(startHandle, startPos, endPos);
        scene.add(startHandle);
        interactiveObjects.push(startHandle);

        const endHandle = new THREE.Mesh(handleGeo, endMat);
        endHandle.position.copy(endPos);
        endHandle.userData = { isTrace: true, traceIndex, handleType: 'end' };
        orientTraceHandle(endHandle, startPos, endPos);
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
      // Apply initial visibility from config
      setTraceObjectsVisibility(params.generatorsVisible !== false);
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

        // Re-orient both start/end handles along the updated path
        const startH = (tObj.handles || []).find(h => h.userData.handleType === 'start');
        const endH = (tObj.handles || []).find(h => h.userData.handleType === 'end');
        if (startH && endH) {
          const s = new THREE.Vector3(trace.startX ?? 0, trace.startY ?? 5, trace.startZ ?? 0);
          const e = new THREE.Vector3(trace.endX ?? 10, trace.endY ?? 5, trace.endZ ?? 0);
          orientTraceHandle(startH, s, e);
          orientTraceHandle(endH, s, e);
        }

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
          // Align local X strictly with the generator path line
          const startPt = worldMatrix ? pts[0].clone().applyMatrix4(worldMatrix) : pts[0].clone();
          const endPt = worldMatrix ? pts[pts.length - 1].clone().applyMatrix4(worldMatrix) : pts[pts.length - 1].clone();
          
          let vecX = new THREE.Vector3().subVectors(endPt, startPt).normalize();
          if (vecX.lengthSq() < 0.0001) vecX.set(1, 0, 0);

          const aimTarget = new THREE.Vector3(trace.aimX || 0, trace.aimY || 0, trace.aimZ || 0);
          const midPt = startPt.clone().lerp(endPt, 0.5);
          const toAim = new THREE.Vector3().subVectors(aimTarget, midPt);
          
          // Project aim vector onto the plane perpendicular to the path (vecX)
          let vecMinusZ = toAim.clone().sub(vecX.clone().multiplyScalar(toAim.dot(vecX)));
          if (vecMinusZ.lengthSq() < 0.0001) {
            // Fallback if aim is exactly on the line
            const up = new THREE.Vector3(0, 1, 0);
            vecMinusZ = up.clone().sub(vecX.clone().multiplyScalar(up.dot(vecX)));
            if (vecMinusZ.lengthSq() < 0.0001) vecMinusZ.set(0, 0, 1);
          }
          vecMinusZ.normalize();
          
          // Local Z is exactly opposite to forward
          const vecZ = vecMinusZ.clone().negate();
          
          // Local Y is Z cross X
          const vecY = new THREE.Vector3().crossVectors(vecZ, vecX).normalize();
          
          const mtx = new THREE.Matrix4().makeBasis(vecX, vecY, vecZ);
          const euler = new THREE.Euler().setFromRotationMatrix(mtx, 'YXZ');
          
          rotX = THREE.MathUtils.radToDeg(euler.x);
          rotY = THREE.MathUtils.radToDeg(euler.y);
          rotZ = THREE.MathUtils.radToDeg(euler.z);
        }

        params.parLights.push({
          group: groupName,
          name: `${groupName} ${i + 1}`,
          fixtureType: trace.fixtureType || 'UkingPar',
          color: trace.lightColor || '#ffaa44',
          intensity: trace.lightIntensity || 10,
          angle: trace.lightAngle || 30,
          penumbra: 0.5,
          x: worldPt.x, y: worldPt.y, z: worldPt.z,
          rotX: rotX + (trace.fixtureRotOffX || 0),
          rotY: rotY + (trace.fixtureRotOffY || 0),
          rotZ: rotZ + (trace.fixtureRotOffZ || 0),
          _traceGenerated: true,
          controllerIp: trace.controllerIp || '',
        });
      });

      trace.generated = true;

      if (window._setGuiRebuilding) window._setGuiRebuilding(true);
      rebuildParLights(true);
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
          fixtureType: 'UkingPar',
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
          fixtureType: 'UkingPar',
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

        // Fixture type selector
        if (!trace.fixtureType) trace.fixtureType = 'UkingPar';
        if (!trace.controllerIp) trace.controllerIp = '';
        const fixtureTypes = listTypes();
        if (fixtureTypes.length > 0) {
          tFolder.add(trace, 'fixtureType', fixtureTypes).name('Fixture Type').onChange(() => {
            debounceAutoSave();
          });
        }
        tFolder.add(trace, 'controllerIp').name('🌐 Controller IP').onFinishChange(() => {
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

        // Fixture rotation offset
        if (!('fixtureRotOffX' in trace)) trace.fixtureRotOffX = 0;
        if (!('fixtureRotOffY' in trace)) trace.fixtureRotOffY = 0;
        if (!('fixtureRotOffZ' in trace)) trace.fixtureRotOffZ = 0;
        const rotOffFolder = tFolder.addFolder('Fixture Rotation Offset');
        rotOffFolder.close();
        rotOffFolder.add(trace, 'fixtureRotOffX', -180, 180, 5).name('X');
        rotOffFolder.add(trace, 'fixtureRotOffY', -180, 180, 5).name('Y');
        rotOffFolder.add(trace, 'fixtureRotOffZ', -180, 180, 5).name('Z');

        // Action buttons
        const actDiv = document.createElement('div');
        actDiv.style.cssText = 'display:flex;gap:2px;padding:4px 6px;';
        const aBtnStyle = 'flex:1;padding:4px 0;border:none;border-radius:3px;cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;';

        // Lock toggle
        if (!('locked' in trace)) trace.locked = false;

        const lockBtn = document.createElement('button');
        lockBtn.textContent = trace.locked ? '🔒' : '🔓';
        lockBtn.title = trace.locked ? 'Unlock generator' : 'Lock generator';
        lockBtn.style.cssText = aBtnStyle + (trace.locked ? 'background:#3a3a1a;color:#cc0;' : 'background:#2a2a2a;color:#888;');
        lockBtn.onclick = () => {
          trace.locked = !trace.locked;
          if (window._setGuiRebuilding) window._setGuiRebuilding(true);
          renderGeneratorGUI();
          if (window._setGuiRebuilding) window._setGuiRebuilding(false);
          debounceAutoSave();
        };

        // Disable controllers when locked
        if (trace.locked) {
          const controllers = tFolder.controllersRecursive();
          controllers.forEach(c => { try { c.disable(); } catch(_) {} });
        }

        const genBtn = document.createElement('button');
        genBtn.textContent = trace.generated ? '↻ Regenerate' : '✓ Generate';
        genBtn.style.cssText = aBtnStyle + 'background:#1a3a1a;color:#3c3;';
        genBtn.onclick = () => {
          // Check for custom DMX patches before regenerating
          if (trace.generated) {
            const groupName = trace.groupName || trace.name;
            const patchedFixtures = params.parLights.filter(l =>
              l.group === groupName && l._traceGenerated && (l.dmxUniverse > 0 || l.dmxAddress > 0)
            );
            if (patchedFixtures.length > 0) {
              const names = patchedFixtures.slice(0, 5).map(l =>
                `  • ${l.name || 'Fixture'} (U${l.dmxUniverse}:${l.dmxAddress})`
              ).join('\n');
              const extra = patchedFixtures.length > 5 ? `\n  ... and ${patchedFixtures.length - 5} more` : '';
              const msg = `⚠ Regenerate "${groupName}"?\n\n${patchedFixtures.length} fixture(s) have custom DMX patches that will be reset:\n${names}${extra}\n\nContinue?`;
              if (!confirm(msg)) return;
            }
          }
          generateGroupFromTrace(i);
        };

        // Lock disables generate
        if (trace.locked) {
          genBtn.disabled = true;
          genBtn.style.cssText = aBtnStyle + 'background:#222;color:#555;cursor:not-allowed;';
        }

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
          rebuildParLights(true);
          rebuildTraceObjects();
          renderGeneratorGUI();
          renderParGUI();
          if (window._setGuiRebuilding) window._setGuiRebuilding(false);
          debounceAutoSave();
        };

        actDiv.appendChild(lockBtn);
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
  function buildDmxLightsSection(parentFolder, sectionConfig) {
    let dmxFolder = null;
    let dmxListFolder = null;
    try {
      if (!params.dmxFixtures) params.dmxFixtures = [];
      dmxFolder = parentFolder.addFolder(sectionConfig._section.label || '🔌 DMX Light Fixtures');
      if (!sectionConfig._section.collapsed) dmxFolder.open();
      
      dmxFolder.add(params, "dmxEnabled").name("Master Enabled").onChange(v => {
        if (window.dmxSceneFixtures) {
          window.dmxSceneFixtures.forEach(f => {
            if (f) f.setVisibility(v, params.conesEnabled !== false);
          });
        }
      });
      
      const dmxToolbarDiv = document.createElement('div');
      dmxToolbarDiv.style.cssText = 'display:flex;gap:4px;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:4px;';
      
      const typeSelect = document.createElement('select');
      typeSelect.style.cssText = 'flex:1;padding:4px;border:1px solid rgba(255,255,255,0.2);border-radius:4px;background:rgba(0,0,0,0.5);color:#fff;font-size:11px;';
      const availableTypes = window.fixtureModels ? Object.keys(window.fixtureModels) : [];
      if (availableTypes.length > 0) {
        for (const k of availableTypes) {
          const opt = document.createElement('option');
          opt.value = k;
          opt.textContent = window.fixtureModels[k].name || k;
          typeSelect.appendChild(opt);
        }
      } else {
        const opt = document.createElement('option');
        opt.value = 'VintageLed';
        opt.textContent = 'VintageLed';
        typeSelect.appendChild(opt);
      }
      dmxToolbarDiv.appendChild(typeSelect);

      const aBtn = document.createElement('button');
      aBtn.textContent = '➕ Add';
      aBtn.style.cssText = 'flex:1;padding:4px 0;border:1px solid rgba(255,255,255,0.2);border-radius:4px;background:rgba(255,255,255,0.1);color:#fff;cursor:pointer;font-size:11px;';
      aBtn.onclick = () => {
        pushUndo();
        // Pick the selected model
        const type = typeSelect.value || 'VintageLed';
        params.dmxFixtures.push({
          group: 'Stage',
          name: nextFixtureName(type + ' '),
          type: type,
          color: '#ffffff', intensity: 15, angle: 25, penumbra: 0.5,
          x: 0, y: 2.5, z: 0, rotX: 0, rotY: 0, rotZ: 0,
        });
        if (window._setGuiRebuilding) window._setGuiRebuilding(true);
        renderDmxGUI();
        rebuildDmxFixtures();
        if (window._setGuiRebuilding) window._setGuiRebuilding(false);
        debounceAutoSave();
      };
      dmxToolbarDiv.appendChild(aBtn);
      
      dmxListFolder = dmxFolder.addFolder("DMX Instances");
      dmxListFolder.open();
      dmxListFolder.domElement.querySelector('.children').prepend(dmxToolbarDiv);

      window.renderDmxGUI = function renderDmxGUI() {
        const children = [...dmxListFolder.folders];
        children.forEach((f) => f.destroy());
        window.dmxGuiFolders = [];

        params.dmxFixtures.forEach((config, index) => {
          const idxFolder = dmxListFolder.addFolder(config.name || `DMX ${index + 1}`);
          idxFolder.domElement.classList.add('gui-card');
          idxFolder.close();
          window.dmxGuiFolders[index] = idxFolder;

          function selectThisLight() {
            const fixture = window.dmxSceneFixtures[index];
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
            debounceAutoSave();
          });

          const typeOptions = {};
          if (window.fixtureModels) {
            for (const [k, v] of Object.entries(window.fixtureModels)) {
              const friendlyName = v.name || k;
              typeOptions[friendlyName] = k;
            }
          }
          if (Object.keys(typeOptions).length === 0) typeOptions['Default'] = 'VintageLed';

          idxFolder.add(config, "type", typeOptions).name("Fixture Model").onChange((v) => {
            pushUndo();
            if (window._setGuiRebuilding) window._setGuiRebuilding(true);
            rebuildDmxFixtures();
            if (window._setGuiRebuilding) window._setGuiRebuilding(false);
            debounceAutoSave();
          });

          idxFolder.addColor(config, "color").onChange((v) => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });
          idxFolder.add(config, "intensity", 0, 200, 0.5).onChange((v) => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });
          idxFolder.add(config, "angle", 5, 90, 1).listen().onChange((v) => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });
          idxFolder.add(config, "penumbra", 0, 1, 0.05).onChange((v) => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });

          const posFolder = idxFolder.addFolder("Position");
          posFolder.close();
          posFolder.add(config, "x", -200, 200, 0.01).listen().onChange(() => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });
          posFolder.add(config, "y", 0, 100, 0.01).listen().onChange(() => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });
          posFolder.add(config, "z", -200, 200, 0.01).listen().onChange(() => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });

          const rotFolder = idxFolder.addFolder("Rotation");
          rotFolder.close();
          const step = params.snapAngle || 5;
          rotFolder.add(config, "rotX", -180, 180, step).listen().onChange(() => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });
          rotFolder.add(config, "rotY", -180, 180, step).listen().onChange(() => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });
          rotFolder.add(config, "rotZ", -180, 180, step).listen().onChange(() => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });

          const actDiv = document.createElement('div');
          actDiv.style.cssText = 'display:flex;gap:2px;padding:2px 6px 4px;';
          const aBtnStyle = 'flex:1;padding:2px 0;border:none;border-radius:3px;background:#2a2a2a;color:#aaa;cursor:pointer;font-size:10px;font-family:inherit;';

          const rmBtn = document.createElement('button');
          rmBtn.textContent = '✕ Remove';
          rmBtn.style.cssText = aBtnStyle;
          rmBtn.onclick = () => {
            pushUndo();
            params.dmxFixtures.splice(index, 1);
            if (window._setGuiRebuilding) window._setGuiRebuilding(true);
            renderDmxGUI();
            rebuildDmxFixtures();
            if (window._setGuiRebuilding) window._setGuiRebuilding(false);
            debounceAutoSave();
          };
          actDiv.appendChild(rmBtn);

          const idxChildren = idxFolder.domElement.querySelector('.children');
          if (idxChildren) idxChildren.appendChild(actDiv);
        });
      };
      
      renderDmxGUI();

    } catch (e) {
      console.warn('DMX Fixtures GUI failed to build:', e);
    }
  }

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
          controllerId: 0, sectionId: 0, fixtureId: 0, viewMask: 0,
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

        // V2 Metadata
        if (strand.controllerId === undefined) strand.controllerId = 0;
        if (strand.sectionId === undefined) strand.sectionId = 0;
        if (strand.fixtureId === undefined) strand.fixtureId = 0;
        if (strand.viewMask === undefined) strand.viewMask = 0;
        const strandMetaFolder = sFolder.addFolder('🔖 Metadata (V2)');
        strandMetaFolder.close();
        const strandMetaChanged = () => {
          if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('metadata');
          debounceAutoSave();
        };
        strandMetaFolder.add(strand, 'controllerId', 0, 255, 1).name('Controller ID').onChange(strandMetaChanged);
        strandMetaFolder.add(strand, 'sectionId', 0, 255, 1).name('Section ID').onChange(strandMetaChanged);
        strandMetaFolder.add(strand, 'fixtureId', 0, 255, 1).name('Fixture ID').onChange(strandMetaChanged);
        strandMetaFolder.add(strand, 'viewMask', 0, 65535, 1).name('View Mask').onChange(strandMetaChanged);

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
