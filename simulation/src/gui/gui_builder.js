/**
 * gui_builder.js — Full GUI construction against the control engine
 * (the lil-gui-API-compatible MarsinGui, imported as `GUI` from
 * gui_engine.js). Contains: setupGUI(), handler registry, generic
 * builders, and all section builders (par lights, DMX, LED strands).
 */
import * as THREE from "three";
import yaml from "js-yaml";
import chroma from "chroma-js";
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
import { saveModelJS as exportModelJS } from "../dmx/pixelblaze_model_exporter.js";
import { GUI } from "./gui_engine.js";
import { setupControlDrawer } from "./control_drawer.js";
import { rebuildParLights, rebuildDmxFixtures } from "../core/fixtures.js";
import { deselectAllFixtures, nextFixtureName } from "../core/interaction.js";
import { listTypes, getDefinition } from "../dmx/fixture_definition_registry.js";
import { clearMetadata, gatherAllConfigs } from "../dmx/auto_patcher.js";
import { getProfileDef, getProfileRebuildKey } from "../core/profile_registry.js";
import { MAX_SPOTLIGHT_POOL_SIZE, showSpotlightCountWarning } from "../core/light_pool.js";
import { applySimulationSurfaceReflectanceToMaterial } from "../core/sim_preview.js";
import { DmxFixtureRuntime } from "../fixtures/dmx_fixture_runtime.js";
import { isStaticHost, logStaticHostSkip } from "../core/static_host.js";
import { ModelFixture } from "../fixtures/model_fixture.js";
import { LedStrand } from "../fixtures/led_strand.js";
import { updateFloodLights } from "../core/flood_lights.js";

// NOTE: engineEnabled / lightingEnabled / lightingMode live in state.js.
// Use the setters imported above to update them so animate.js sees changes.
const OPTIONS_SPOTLIGHT_PREVIEW_KEYS = ["masterExposure", "maxSpotlights", "simBrightness", "simSurfaceReflectance"];

// Shared compact "🔖 Metadata (V2)" panel for fixture editor cards.
// Single source of truth — used by every fixture-rendering path (regular PARs,
// trace-generated PARs, DMX instances, LED strands) so the metadata
// UI is consistent and ALWAYS rendered. Returns refs to the inputs in case a
// caller needs to push external updates (e.g. trace-generated fixtures whose
// fixtureId is auto-derived from the DMX patch).
//
// `parentChildrenEl` must be the `.children` element of the host lil-gui card
// (so the panel sits inside the open/close folder body).
function appendMetadataPanelV2(parentChildrenEl, config, opts) {
  if (!parentChildrenEl) return null;
  if (config.controllerId === undefined) config.controllerId = 0;
  if (config.sectionId === undefined) config.sectionId = 0;
  if (config.fixtureId === undefined) config.fixtureId = 0;
  if (config.viewMask === undefined) config.viewMask = 0;

  const onChange = (opts && opts.onChange) || (() => {
    if (typeof window !== 'undefined' && window.debounceAutoSave) window.debounceAutoSave();
  });

  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:2px 8px 6px;';

  const header = document.createElement('div');
  header.style.cssText = 'margin-bottom:3px;';
  header.innerHTML = `<span style="color:var(--secondary);font-size:10px;font-weight:600;">🔖 Metadata (V2)</span>`;
  wrap.appendChild(header);

  const mkLabel = (text) => {
    const s = document.createElement('span');
    s.style.cssText = 'color:var(--icon);font-size:9px;';
    s.textContent = text;
    return s;
  };
  const mkInput = (value, max, onInput) => {
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = 0; inp.max = max; inp.step = 1; inp.value = value;
    inp.style.cssText = 'width:48px;padding:2px 4px;border:1px solid var(--ghost-border);border-radius:3px;background:var(--input-bg);color:var(--text);font-size:10px;font-family:inherit;text-align:center;';
    inp.onchange = () => { onInput(Math.max(0, Math.min(max, Math.round(Number(inp.value))))); };
    return inp;
  };

  const fireChange = () => {
    if (typeof window !== 'undefined' && window.invalidateMarsinBatchCache) {
      window.invalidateMarsinBatchCache('metadata');
    }
    onChange();
  };

  const row1 = document.createElement('div');
  row1.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:2px;';
  row1.appendChild(mkLabel('Ctrl:'));
  const ctrlInp = mkInput(config.controllerId, 255, (v) => { config.controllerId = v; fireChange(); });
  row1.appendChild(ctrlInp);
  row1.appendChild(mkLabel('Sect:'));
  const sectInp = mkInput(config.sectionId, 255, (v) => { config.sectionId = v; fireChange(); });
  row1.appendChild(sectInp);
  wrap.appendChild(row1);

  const row2 = document.createElement('div');
  row2.style.cssText = 'display:flex;gap:4px;align-items:center;';
  row2.appendChild(mkLabel('Fix ID:'));
  const fixInp = mkInput(config.fixtureId, 65535, (v) => { config.fixtureId = v; fireChange(); });
  row2.appendChild(fixInp);
  wrap.appendChild(row2);

  // ── View Membership Chips ──
  const viewRow = document.createElement('div');
  viewRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;align-items:center;margin-top:4px;';
  viewRow.appendChild(mkLabel('Views:'));
  const chipsContainer = document.createElement('span');
  chipsContainer.style.cssText = 'display:inline-flex;flex-wrap:wrap;gap:2px;';
  viewRow.appendChild(chipsContainer);
  wrap.appendChild(viewRow);

  function _hex(bit) { return '0x' + bit.toString(16).toUpperCase(); }

  // READ-ONLY membership indicators: editing happens deliberately in
  // the Views panel (Assign/Unassign sel., group chips) — a stray
  // click in a fixture card must never silently rewrite a view.
  // Membership is the EFFECTIVE one the engine resolves: the fixture's
  // own viewMask bit OR its group being attached to the view.
  function renderViewChips() {
    chipsContainer.innerHTML = '';
    const reg = window.__viewRegistry || { custom: [] };
    const views = reg.custom || [];
    if (views.length === 0) {
      const none = document.createElement('span');
      none.style.cssText = 'color:var(--icon);font-size:9px;font-style:italic;';
      none.textContent = 'no views defined';
      chipsContainer.appendChild(none);
      return;
    }
    views.forEach(view => {
      const byBit = ((config.viewMask || 0) & view.bit) !== 0;
      const byGroup = Array.isArray(view.groups) && view.groups.includes(config.group);
      const active = byBit || byGroup;
      const chip = document.createElement('span');
      chip.textContent = byGroup && !byBit ? `${view.name} (grp)` : view.name;
      chip.title = active
        ? `Member of "${view.name}" (${_hex(view.bit)})${byGroup ? ` via group '${config.group}'` : ''} — edit in the Views panel`
        : `Not in "${view.name}" (${_hex(view.bit)}) — assign in the Views panel`;
      chip.style.cssText =
        'padding:1px 5px;border-radius:3px;font-size:9px;font-family:inherit;cursor:default;user-select:none;border:1px solid;' +
        (active
          ? 'background:color-mix(in srgb, var(--primary) 25%, transparent);color:var(--primary);border-color:color-mix(in srgb, var(--primary) 50%, transparent);'
          : 'background:color-mix(in srgb, var(--surface-container-high) 50%, transparent);color:var(--icon);border-color:var(--ghost-border);');
      chipsContainer.appendChild(chip);
    });
  }
  renderViewChips();

  parentChildrenEl.appendChild(wrap);

  const panel = {
    root: wrap,
    inputs: { controllerId: ctrlInp, sectionId: sectInp, fixtureId: fixInp },
    refresh() {
      ctrlInp.value = config.controllerId;
      sectInp.value = config.sectionId;
      fixInp.value = config.fixtureId;
      renderViewChips();
    },
  };

  // Register for global refresh from Views panel assign/unassign
  if (!window.__metadataPanelRegistry) window.__metadataPanelRegistry = [];
  window.__metadataPanelRegistry = window.__metadataPanelRegistry.filter(p => p.root && p.root.isConnected);
  window.__metadataPanelRegistry.push(panel);

  return panel;
}

/**
 * Register a fixture card's DMX Patch row (U / Addr / IP + status dot)
 * for global refresh via window.refreshMetadataPanels(). The Controller
 * Mapping panel projects new patch values into the live configs on
 * every mutation and save — without this registration the patch inputs
 * would show stale values until a full GUI rebuild. Also keeps the
 * locked ("derived") state in sync with whether a mapping exists, so
 * creating the first controller locks every card live and deleting the
 * last one unlocks them.
 */
function registerPatchRowRefresh(config, { root, uniInput, addrInput, ipInput, updateStatus }) {
  const applyLockState = () => {
    const mapperActive = !!(window.__controllerRegistry &&
      window.__controllerRegistry.controllers.length > 0);
    for (const inp of [uniInput, addrInput, ipInput]) {
      inp.disabled = mapperActive;
      inp.style.opacity = mapperActive ? '0.6' : '';
      inp.title = mapperActive
        ? 'Derived from Controller Mapping — edit in the 🎛 Controllers panel.'
        : '';
    }
  };
  applyLockState();

  const panel = {
    root,
    refresh() {
      uniInput.value = config.dmxUniverse || 0;
      addrInput.value = config.dmxAddress || 0;
      ipInput.value = config.controllerIp || '';
      updateStatus();
      applyLockState();
    },
  };
  if (!window.__metadataPanelRegistry) window.__metadataPanelRegistry = [];
  window.__metadataPanelRegistry = window.__metadataPanelRegistry.filter(p => p.root && p.root.isConnected);
  window.__metadataPanelRegistry.push(panel);
  return panel;
}

export
function setupGUI() {
  const gui = new GUI({ title: "🔦 Lighting Controls", width: 300 });
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('readonly') === '1') gui.hide();
  
  window.guiInstance = gui;

  // ── Wrap lil-gui in a floating, draggable panel ──────────────────────
  const panel = document.createElement('div');
  panel.id = 'gui-panel';

  // Header — title + drawer collapse toggle (wired by setupControlDrawer)
  const header = document.createElement('div');
  header.className = 'gui-panel-header';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'gui-panel-title';
  titleSpan.textContent = '🔦 LIGHTING CONTROLS';
  header.appendChild(titleSpan);
  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'pe-btn';
  collapseBtn.title = 'Collapse to edge';
  collapseBtn.textContent = '»';
  header.appendChild(collapseBtn);
  panel.appendChild(header);

  // Body — holds the lil-gui, scrollable
  const body = document.createElement('div');
  body.className = 'gui-panel-body';

  // Strip lil-gui auto-place positioning — panel handles layout
  gui.domElement.style.position = '';
  gui.domElement.style.top = '';
  gui.domElement.style.right = '';
  gui.domElement.classList.remove('autoPlace');
  // Hide root title — our panel header replaces it
  const rootTitle = gui.domElement.querySelector(':scope > .title');
  if (rootTitle) rootTitle.style.display = 'none';

  body.appendChild(gui.domElement);
  panel.appendChild(body);
  document.body.appendChild(panel);

  // Dock the panel as a right-edge slide-away drawer (replaces the old
  // free-floating drag behaviour). Owns the collapse toggle + reopen tab.
  setupControlDrawer(panel);

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
    if (window._isAppBooting) return;
    if (window._isRebuildingFixtures) {
      // Never silently drop a save: the rebuild path re-arms the
      // debounce when it finishes, but belt-and-braces retry here too —
      // a swallowed save is exactly how stale scenes shipped on-site.
      setTimeout(() => { if (window.debounceAutoSave) window.debounceAutoSave(true); }, 500);
      return;
    }

    // Export the pixel model + view-mask sidecar FIRST: saveModelJS
    // reconciles the view registry against the freshly exported pixels,
    // so the views.yaml serialized below can never pin a group the
    // sidecar doesn't know about (a crash between the two writes would
    // otherwise leave them split). Any export failure — bit exhaustion,
    // a view referencing a pixel-less group — aborts the entire save,
    // loudly: a half-saved contract is worse than no save.
    try {
      saveModelJS();
    } catch (err) {
      console.error('Model/sidecar export failed — config save aborted:', err);
      showSaveToast(`⚠ EXPORT FAILED — NOTHING SAVED: ${err.message}`, true);
      return;
    }

    reconstructYAML(configTree);
    syncCollapseState(configTree);

    // Persist camera state
    configTree._camera = {
      position: { x: +camera.position.x.toFixed(4), y: +camera.position.y.toFixed(4), z: +camera.position.z.toFixed(4) },
      target: { x: +controls.target.x.toFixed(4), y: +controls.target.y.toFixed(4), z: +controls.target.z.toFixed(4) }
    };

    // Panel geometry is per-machine state, not scene state — it lives in
    // localStorage now (src/gui/panel_layout.js). Scrub any block left in
    // configs saved before the 2026-06-12 layout migration.
    delete configTree._patternEditor;

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

    // Cache the serialized config so a page unload can flush it with
    // sendBeacon even if the async fetch below never completes.
    window.__lastConfigYaml = yamlStr;

    const sceneParam = window.__activeScene ? `?scene=${window.__activeScene}` : '';
    if (isStaticHost()) {
      logStaticHostSkip('save scene config (port 6970)');
    } else {
      fetch(`http://localhost:6970/save${sceneParam}`, {
        method: "POST",
        body: yamlStr,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`save server responded ${res.status}`);
          console.log(`Config saved${window.__activeScene ? ` (scene: ${window.__activeScene})` : ''}`);
          _setSceneDirty(false);
          showSaveToast();
          if (window.PatchManager) window.PatchManager.notifySacnBridge();
          // Resync every fixture card's "Views:" chips with the
          // just-persisted registry + membership state.
          if (window.refreshMetadataPanels) window.refreshMetadataPanels();
          if (window.refreshViewMasksPanel) window.refreshViewMasksPanel();
        })
        .catch((err) => {
          // Stay dirty: the indicator keeps shouting until a save lands.
          console.error("Failed to write config:", err);
          showSaveToast('⚠ SAVE FAILED — changes NOT on disk', true);
        });
    }

  }

  function saveModelJS() {
    exportModelJS();
  }
  window.saveModelJS = saveModelJS;

  function showSaveToast(message, isError) {
    let toast = document.getElementById('save-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'save-toast';
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:6px 20px;border-radius:6px;font-family:var(--font-body);font-size:13px;pointer-events:none;z-index:999;opacity:0;transition:opacity 0.3s;';
      document.body.appendChild(toast);
    }
    const ok = !isError;
    toast.style.background = ok
      ? 'color-mix(in srgb, var(--ok) 15%, var(--surface))'
      : 'color-mix(in srgb, var(--error) 15%, var(--surface))';
    toast.style.border = ok ? '1px solid var(--ok)' : '1px solid var(--error-container-border)';
    toast.style.color = ok ? 'var(--ok)' : 'var(--error)';
    toast.textContent = message || '✓ Config saved';
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, ok ? 2000 : 6000);
  }

  // ─── Unsaved-changes tracking ───
  // Every mutation marks the scene dirty; only a confirmed 200 from the
  // save server clears it. The chip + beforeunload prompt + sendBeacon
  // flush close the on-site failure mode where edits made in the last
  // few seconds (or with auto-save off) evaporated on refresh and the
  // next load looked "stale".
  function _setSceneDirty(dirty) {
    window.__sceneDirty = dirty;
    let chip = document.getElementById('dirty-indicator');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'dirty-indicator';
      chip.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:color-mix(in srgb, var(--primary) 15%, var(--surface));border:1px solid var(--primary);color:var(--primary);padding:4px 14px;border-radius:6px;font-family:var(--font-headline);font-size:11px;font-weight:600;letter-spacing:0.08em;pointer-events:none;z-index:999;transition:opacity 0.3s;';
      document.body.appendChild(chip);
    }
    chip.textContent = '● UNSAVED CHANGES';
    chip.style.opacity = dirty ? '1' : '0';
    if (window.refreshViewMasksPanel) {
      window.refreshViewMasksPanel();
    }
  }
  window._setSceneDirty = _setSceneDirty;

  window.addEventListener('beforeunload', (e) => {
    const pendingSave = window.__sceneDirty || !!saveTimeout;
    if (!pendingSave || window._isAppBooting || isStaticHost()) return;
    // Best-effort flush of the latest serialized config: sendBeacon is
    // the only transport guaranteed to survive unload. Re-serialize
    // first so the beacon carries the newest state, not the last save.
    try {
      if (!window._isRebuildingFixtures) {
        reconstructYAML(configTree);
        window.__lastConfigYaml = yaml.dump(configTree, { lineWidth: -1, noCompatMode: true });
      }
      if (window.__lastConfigYaml && navigator.sendBeacon) {
        const sceneParam = window.__activeScene ? `?scene=${window.__activeScene}` : '';
        navigator.sendBeacon(`http://localhost:6970/save${sceneParam}`,
          new Blob([window.__lastConfigYaml], { type: 'text/plain' }));
      }
    } catch (err) {
      console.error('Unload flush failed:', err);
    }
    // Still prompt: the beacon is fire-and-forget, the operator should
    // get the chance to stay and save deliberately.
    e.preventDefault();
    e.returnValue = '';
  });

  function _showAutoToast(msg) {
    let toast = document.getElementById('auto-patch-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'auto-patch-toast';
      toast.style.cssText = 'position:fixed;top:48px;left:50%;transform:translateX(-50%);background:color-mix(in srgb, var(--tint) 15%, var(--surface));border:1px solid var(--tint);color:var(--tint);padding:8px 24px;border-radius:8px;font-family:var(--font-body);font-size:13px;pointer-events:none;z-index:999;opacity:0;transition:opacity 0.3s;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
  }
  window.exportConfig = exportConfig;

  let saveTimeout = null;
  function debounceAutoSave(force = false) {
    // Mark dirty on EVERY mutation, even with auto-save off — the chip
    // and the beforeunload prompt are what make "I forgot to save"
    // impossible to miss.
    _setSceneDirty(true);
    if (!params.autoSave && !force) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => { saveTimeout = null; exportConfig(); }, 2000);
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
  function _applyConeMaterialSettings() {
    const isTransparent = params.conesTransparent === 'enabled';
    const opacity = params.coneOpacity !== undefined ? params.coneOpacity : 0.5;
    
    if (window.parFixtures) {
      window.parFixtures.forEach(f => {
        if (f && f.pixels) {
          f.pixels.forEach(p => {
            if (p.beam && p.beam.material) {
              p.beam.material.transparent = isTransparent;
              p.beam.material.opacity = isTransparent ? opacity : 1.0;
              p.beam.material.depthWrite = !isTransparent;
              p.beam.material.blending = isTransparent ? THREE.AdditiveBlending : THREE.NormalBlending;
              p.beam.material.needsUpdate = true;
            }
          });
        }
      });
    }
  }

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
    globalPixelScale: (v) => {
      console.log('[GUI] globalPixelScale changed:', v);
      // Rescale the V2 InstancedMesh (the actual visible pixel rendering layer)
      if (window.updatePixelInstancedScale) window.updatePixelInstancedScale(v);
      // Also update per-fixture meshes (bulb/halo/dots) for non-instanced profiles
      const allFixtures = [...(window.parFixtures || []), ...(window.dmxSceneFixtures || [])];
      allFixtures.forEach(f => {
        if (f && f.updateScales) f.updateScales(v, params.globalHaloScale || 1.0);
      });
    },
    globalHaloScale: (v) => {
      console.log('[GUI] globalHaloScale changed:', v);
      const allFixtures = [...(window.parFixtures || []), ...(window.dmxSceneFixtures || [])];
      allFixtures.forEach(f => {
        if (f && f.updateScales) f.updateScales(params.globalPixelScale || 1.0, v);
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
      // Apply current transparency settings when cones are turned on
      if (v) _applyConeMaterialSettings();
      
      // Update DOM visibility of transparency controls
      if (window._guiControllers) {
        if (window._guiControllers.conesTransparent) {
          window._guiControllers.conesTransparent.domElement.closest('.controller').style.display = v ? '' : 'none';
        }
        if (window._guiControllers.coneOpacity) {
          window._guiControllers.coneOpacity.domElement.closest('.controller').style.display = (v && params.conesTransparent === 'enabled') ? '' : 'none';
        }
      }
    },
    conesTransparent: (v) => { 
      _applyConeMaterialSettings();
      if (window._guiControllers && window._guiControllers.coneOpacity) {
        window._guiControllers.coneOpacity.domElement.closest('.controller').style.display = (params.conesEnabled !== false && v === 'enabled') ? '' : 'none';
      }
    },
    coneOpacity: () => { _applyConeMaterialSettings(); },
    simSurfaceReflectance: () => {
      applySimulationSurfaceReflectanceToMaterial(ground?.material);
    },
    spotlightSamplingMode: (v) => {
      if (window._guiControllers && window._guiControllers.spotlightSamplingBucketDistance) {
        window._guiControllers.spotlightSamplingBucketDistance.domElement.closest('.controller').style.display = v === 'closest_bucket' ? '' : 'none';
      }
    },
    generatorsVisible: (v) => {
      if (window.setTraceObjectsVisibility) window.setTraceObjectsVisibility(v);
    },
    rendererMode: (v) => {
      if (!window._isAppBooting) {
        const urlParams = new URLSearchParams(window.location.search);
        const activeRendererMode = window.__rendererMode || 'webgpu';
        const isWebGLActive = activeRendererMode === 'webgl';
        
        let needsReload = false;
        if (v === 'webgl' && !isWebGLActive) {
          needsReload = true;
          urlParams.set('renderer', 'webgl');
        } else if (v === 'webgpu' && isWebGLActive) {
          needsReload = true;
          urlParams.set('renderer', 'webgpu');
        }

        if (needsReload) {
          const ok = confirm(
            `⚠️ Graphics Engine Switch Required\n\n` +
            `You are switching the graphics backend to ${v === 'webgl' ? 'WebGL' : 'WebGPU'}.\n` +
            `The application will fully reset and every unsaved change will be lost.\n\n` +
            `Do you want to proceed and restart the engine?`
          );
          if (ok) {
            window.location.search = "?" + urlParams.toString();
            return;
          } else {
            // Revert dropdown
            params.rendererMode = activeRendererMode;
            if (window._guiControllers && window._guiControllers.rendererMode) {
              window._guiControllers.rendererMode.updateDisplay();
            }
            return;
          }
        }
      }
    },
    lightingProfile: (profile) => {
      const profileDef = getProfileDef(profile);
      const isEditMode = profileDef.isEditMode;

      if (!window._isAppBooting) {
        // Warn if switching to full (per-pixel SpotLights — GPU heavy)
        if (profile === 'full') {
          const totalPixels = window.parFixtures ? window.parFixtures.reduce((sum, f) => sum + (f && f.pixels ? f.pixels.length : 0), 0) : 0;
          if (totalPixels > 100) {
            const ok = confirm(
              `⚠️ GPU Warning\n\nThis scene has ${totalPixels} pixels. ` +
              `"Full Analytic" creates a SpotLight per pixel which may crash the WebGPU renderer.\n\n` +
              `Recommended: Use "Emissive" for scene lighting without GPU risk.\n\nSwitch anyway?`
            );
            if (!ok) {
              // Revert the dropdown to the previous value
              params.lightingProfile = window._lastLightingProfile || 'pixel_mapping';
              // Force lil-gui to update its display
              if (window._guiControllers && window._guiControllers.lightingProfile) {
                window._guiControllers.lightingProfile.updateDisplay();
              }
              return;
            }
          }
        }
      }
      window._lastLightingProfile = profile;

      // Smart rebuild: only destroy/recreate when the light render topology changes.
      const prevKey = window._lastProfileKey || 'unknown';
      const newKey = getProfileRebuildKey(profile);
      window._lastProfileKey = newKey;

      const hasHoles = window.parFixtures && window.parFixtures.some(f => !f);

      if (!window._isAppBooting && (prevKey !== newKey || hasHoles)) {
        // Light topology differ or missing fixtures — must rebuild (async to avoid UI freeze)
        // Build synchronously so WebGPU compiles the pipeline exactly ONCE for all lights.
        window._asyncProfileRebuild = false;
        if (window.rebuildParLights) window.rebuildParLights(true);
        if (window.rebuildDmxFixtures) window.rebuildDmxFixtures(true);
        
        // Ensure InstancedMesh arrays know we broke the topology constraints
        if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('profile_rebuild');
      } else if (!window._isAppBooting && window.parFixtures) {
        // Same topology — just toggle simple visibility flags (instant)
        window.parFixtures.forEach(f => {
          if (f && f.setVisibility) f.setVisibility(params.parsEnabled !== false, params.conesEnabled !== false);
        });
      }
      if (model) {
        model.traverse((child) => {
          if (child.isMesh)
            child.material = isEditMode ? editMaterial : structureMaterial;
        });
      }

      // Toggle edit-mode CSS class on body — CSS handles hiding all floating panels
      document.body.classList.toggle('edit-mode-active', isEditMode);
      const effectsEnabled = profileDef.render.effectsMode !== 'off';

      if (lights.moon) lights.moon.castShadow = effectsEnabled && !isEditMode;
      lights.towers.forEach((t) => { t.castShadow = effectsEnabled && !isEditMode; });
      if (_bp.strength) _bp.strength.value = (effectsEnabled && !isEditMode) ? (params.bloomStrength || 0.35) : 0;
      
      // Option B: Completely sever the heavy bloom node graph in edit mode or when effects disabled
      if (window._threeRefs && window._threeRefs.postProcessing) {
        const { postProcessing, scenePassColor, bloomEffect } = window._threeRefs;
        if (!effectsEnabled || isEditMode) {
          postProcessing.outputNode = scenePassColor;
        } else if (params.bloomEnabled !== false) {
          postProcessing.outputNode = scenePassColor.add(bloomEffect);
        }
        // Force the WebGPU node compositor to recompile the pipeline
        postProcessing.needsUpdate = true;
      }

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
    // Master floods (Atmosphere → Master Floods in common.yaml) — all
    // six params drive the same rig update; see src/core/flood_lights.js.
    masterFloodEnabled: () => updateFloodLights(),
    masterFloodColor: () => updateFloodLights(),
    masterFloodIntensity: () => updateFloodLights(),
    masterFloodAngle: () => updateFloodLights(),
    masterFloodDistance: () => updateFloodLights(),
    masterFloodDimmer: () => updateFloodLights(),
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
    const isSpotlightLimitControl = key === "maxSpotlights";
    const controlMin = isSpotlightLimitControl ? 1 : meta.min;
    const controlMax = isSpotlightLimitControl ? MAX_SPOTLIGHT_POOL_SIZE : meta.max;
    if (isSpotlightLimitControl) {
      meta.max = MAX_SPOTLIGHT_POOL_SIZE;
      if (Number.isFinite(params[key])) {
        params[key] = Math.min(params[key], MAX_SPOTLIGHT_POOL_SIZE);
      }
    }
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
    } else if (typeof params[key] === "number" && controlMin !== undefined) {
      ctrl = folder
        .add(params, key, controlMin, controlMax, meta.step)
        .name(meta.label || key);
    } else {
      ctrl = folder.add(params, key).name(meta.label || key);
    }

    if (handlers[key]) ctrl.onChange(handlers[key]);

    // The Max Spotlights slider crosses two user-facing GPU thresholds (100
    // for FPS drop, 160 for white/black scene risk on Mac WebGPU). Show or
    // hide the persistent HUD banner whenever the user moves the slider.
    if (key === "maxSpotlights") {
      const priorOnChange = handlers[key];
      ctrl.onChange((v) => {
        if (typeof priorOnChange === "function") {
          try { priorOnChange(v); } catch (err) { console.error(err); }
        }
        try { showSpotlightCountWarning(v); } catch (err) { console.error(err); }
      });
    }

    // Store controller reference for programmatic updates (e.g. profile warning revert)
    if (!window._guiControllers) window._guiControllers = {};
    window._guiControllers[key] = ctrl;
    if (meta.listen || key === 'generatorsVisible') ctrl.listen();
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
    previewBar.style.cssText = 'height:16px;border-radius:6px;border:1px solid var(--ghost-border);';
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
      addBtn.style.cssText = 'flex:1;padding:5px 0;border:1px solid var(--ghost-border);border-radius:4px;background:color-mix(in srgb, var(--text) 4%, transparent);color:var(--secondary);cursor:pointer;font-size:11px;font-family:inherit;';
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
        rmBtn.style.cssText = 'flex:1;padding:5px 0;border:1px solid var(--error-container-border);border-radius:4px;background:var(--error-container);color:var(--error);cursor:pointer;font-size:11px;font-family:inherit;';
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
    addControl(sacnFolder, 'sacn_universes', sectionConfig.sacn_universes || { value: '1,2,3,4, 5', label: '📡 Listen Universes' });
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
      // Show sACN monitors directly
      const sacnInMonitorPanel = document.getElementById('sacn-in-monitor-panel');
      if (sacnInMonitorPanel) {
        sacnInMonitorPanel.classList.toggle('hidden', !(mode === 'sacn_in' && enabled));
      }
      if (window.showSacnInMonitor) window.showSacnInMonitor(mode === 'sacn_in' && enabled);

      const sacnOutMonitorPanel = document.getElementById('sacn-out-monitor-panel');
      if (sacnOutMonitorPanel) {
        sacnOutMonitorPanel.classList.toggle('hidden', !enabled);
      }
      if (window.showSacnOutMonitor) window.showSacnOutMonitor(enabled);

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
              if (f.setPixelColorRGB) {
                // New DmxFixtureRuntime format: Reset all pixels to base config color
                const c = new THREE.Color(f.config.color || '#ffaa44');
                for(let p = 0; p < (f.pixels?.length || 1); p++) {
                  f.setPixelColorRGB(p, c.r, c.g, c.b);
                }
              } else if (f.light) {
                f.light.color.set(f.config.color);
                if (f.beam && f.beam.material) f.beam.material.color.set(f.config.color);
              }
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

  function addSpotlightPreviewOptionControls(folder) {
    const parLightsNode = configTree?.parLights;
    if (!parLightsNode) return;

    for (const key of OPTIONS_SPOTLIGHT_PREVIEW_KEYS) {
      const entry = parLightsNode[key];
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || entry.value === undefined) continue;
      if (params[key] === undefined) params[key] = entry.value;
      addControl(folder, key, entry);
    }
  }

  function buildOptionsSection(parentFolder, sectionNode) {
    const optionsFolder = parentFolder.addFolder(sectionNode._section.label);
    if (sectionNode._section.collapsed) optionsFolder.close();
    _sectionFolderMap.set(sectionNode._section, optionsFolder);

    let insertedPreviewControls = false;

    for (const key of Object.keys(sectionNode)) {
      if (key === "_section") continue;
      const entry = sectionNode[key];
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || entry.value === undefined) continue;

      if (params[key] === undefined) params[key] = entry.value;
      addControl(optionsFolder, key, entry);

      if (key === "lightingProfile") {
        addSpotlightPreviewOptionControls(optionsFolder);
        insertedPreviewControls = true;
      }
    }

    if (!insertedPreviewControls) {
      addSpotlightPreviewOptionControls(optionsFolder);
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

        if (key === "options") {
          buildOptionsSection(parentFolder, entry);
          continue;
        }
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
      if (key === "_section" || key === "fixtures" || OPTIONS_SPOTLIGHT_PREVIEW_KEYS.includes(key)) continue;
      const entry = sectionNode[key];
      if (entry && typeof entry === "object" && entry.value !== undefined) {
        if (params[key] === undefined) params[key] = entry.value;
        addControl(parFolder, key, entry);
      }
    }

    // Set initial visibility for cone transparency controls
    if (handlers.conesEnabled) handlers.conesEnabled(params.conesEnabled);
    if (handlers.conesTransparent) handlers.conesTransparent(params.conesTransparent);

    // Diagnostic overlay: tint fixtures with no DMX patch red in the 3D view
    // so the operator can spot what still needs mapping. Sim-only — no DMX is
    // sent. Synced with the matching toggle in the Controller Mapping panel
    // (.listen() reflects changes made over there).
    if (params.showUnpatchedRed === undefined) params.showUnpatchedRed = false;
    parFolder
      .add(params, "showUnpatchedRed")
      .name("Show Unpatched (Red)")
      .listen()
      .onChange(() => {
        if (window.refreshControllerMapPanel) window.refreshControllerMapPanel();
      });

    const parListFolder = parFolder.addFolder("Light Instances");

    // ─── Compact toolbar row: Collapse All | Select All | Clear All ───
    const toolbarDiv = document.createElement('div');
    toolbarDiv.style.cssText = 'display:flex;gap:2px;padding:2px 8px 4px;';
    const btnStyle = 'flex:1 1 0;min-width:0;padding:3px 6px;border:1px solid var(--ghost-border);border-radius:3px;background:var(--control-bg);color:var(--text);cursor:pointer;font-size:11px;font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;';
    const btnHover = 'background:var(--control-bg-hover)';

    const collapseBtn = document.createElement('button');
    collapseBtn.textContent = '▼ Collapse';
    collapseBtn.style.cssText = btnStyle;
    collapseBtn.onmouseenter = () => collapseBtn.style.background = 'var(--control-bg-hover)';
    collapseBtn.onmouseleave = () => collapseBtn.style.background = 'var(--control-bg)';
    collapseBtn.onclick = () => parListFolder.folders.forEach((f) => f.close());

    const selectBtn = document.createElement('button');
    selectBtn.textContent = '☑ Select All';
    selectBtn.style.cssText = btnStyle;
    selectBtn.onmouseenter = () => selectBtn.style.background = 'var(--control-bg-hover)';
    selectBtn.onmouseleave = () => selectBtn.style.background = 'var(--control-bg)';
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
    clearBtn.onmouseenter = () => clearBtn.style.background = 'var(--control-bg-hover)';
    clearBtn.onmouseleave = () => clearBtn.style.background = 'var(--control-bg)';
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

      // ─── Patch tools ───
      // Patching is owned by the Controller Mapping panel (docs/33) —
      // the legacy Auto-Patch / Clear All Patches buttons are gone
      // (auto_patcher.js module deletion is task 017). Only the
      // metadata reset survives here.
      // Remove any stale button wraps from previous renders.
      const plChildrenCleanup = parListFolder.domElement.querySelector('.children');
      if (plChildrenCleanup) {
        plChildrenCleanup.querySelectorAll('.auto-patch-wrap').forEach(el => el.remove());
      }
      const autoPatchWrap = document.createElement('div');
      autoPatchWrap.className = 'auto-patch-wrap';
      autoPatchWrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;padding:4px 6px;border-bottom:1px solid var(--ghost-border);';
      const apBtnBase = 'width:100%;padding:5px 8px;border:none;border-radius:3px;cursor:pointer;font-size:10px;font-family:inherit;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;';
      const clearMetaBtn = document.createElement('button');
      clearMetaBtn.textContent = '🔄 Clear Metadata';
      clearMetaBtn.title = 'Clear Metadata';
      clearMetaBtn.style.cssText = apBtnBase + 'background:color-mix(in srgb, var(--caution) 15%, var(--surface));color:var(--caution);';
      clearMetaBtn.onclick = () => {
        pushUndo();
        const configs = gatherAllConfigs(params);
        const cleared = clearMetadata(configs);
        // Sync patch tree
        if (window.__globalPatchTree) {
          for (const c of configs) {
            if (c.name && window.__globalPatchTree[c.name]) {
              window.__globalPatchTree[c.name].sectionId = 0;
              window.__globalPatchTree[c.name].controllerId = 0;
              window.__globalPatchTree[c.name].fixtureId = 0;
              window.__globalPatchTree[c.name].viewMask = 0;
            }
          }
        }
        exportConfig();
        if (window._setGuiRebuilding) window._setGuiRebuilding(true);
        renderParGUI();
        if (window._setGuiRebuilding) window._setGuiRebuilding(false);
        _showAutoToast(`✓ Cleared metadata on ${cleared} fixture(s)`);
      };
      autoPatchWrap.appendChild(clearMetaBtn);
      const plChildren = parListFolder.domElement.querySelector('.children');
      if (plChildren) plChildren.prepend(autoPatchWrap);

      // Ensure patches from patches.yaml are merged before building DOM
      if (window.applyPatches) window.applyPatches(params.parLights);

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
        const isTraceGroup = items.some(({ config }) => config.traceGenerated);
        // Restore open state or default closed
        if (openGroups.has(`${groupName} (${items.length - 1})`) ||
            openGroups.has(`${groupName} (${items.length})`) ||
            openGroups.has(`${groupName} (${items.length + 1})`)) {
          groupFolder.open();
        } else {
          groupFolder.close();
        }

        // ── Group master: On/Off + Brightness ──
        // A real last-layer override on the whole group's DMX output (see
        // dmx_output_overrides.js). The group takes priority over each
        // fixture's own override. Stored in params.groupOverrides[groupName]
        // and persisted with the scene; applied live every frame, so toggling
        // here hits the lights (and sACN out) immediately.
        if (!params.groupOverrides) params.groupOverrides = {};
        if (!params.groupOverrides[groupName]) params.groupOverrides[groupName] = { enabled: true, brightness: 100 };
        const groupOv = params.groupOverrides[groupName];
        if (groupOv.enabled === undefined) groupOv.enabled = true;
        if (groupOv.brightness === undefined) groupOv.brightness = 100;
        const resyncGroupMembers = () => {
          (groupMap.get(groupName) || []).forEach(({ index }) => {
            if (window.syncLightFromConfig) window.syncLightFromConfig(index);
          });
        };
        groupFolder.add(groupOv, 'enabled').name('⏻ Group On').onChange(() => {
          resyncGroupMembers();
          debounceAutoSave();
        });
        groupFolder.add(groupOv, 'brightness', 0, 100, 1).name('Group Brightness %').onChange(() => {
          resyncGroupMembers();
          debounceAutoSave();
        });

        // Trace-generated groups: show fixtures with limited editing (DMX patch only)
        if (isTraceGroup) {
          const gBtnStyle2 = 'flex:1;padding:2px 0;border:none;border-radius:3px;background:var(--control-bg);cursor:pointer;font-size:10px;font-family:inherit;';
          const traceRow = document.createElement('div');
          traceRow.style.cssText = 'display:flex;gap:2px;padding:2px 6px 4px;align-items:center;';

          const groupHidden = items.length > 0 && items.every(({ index }) =>
            window.parFixtures[index] && !window.parFixtures[index].group.visible
          );
          const visBtn = document.createElement('button');
          visBtn.textContent = groupHidden ? '○ Off' : '● On';
          visBtn.style.cssText = gBtnStyle2 + (groupHidden ? 'color:var(--icon);' : 'color:var(--ok);');
          visBtn.onclick = () => {
            const turnOn = visBtn.textContent.includes('Off');
            items.forEach(({ index }) => {
              const f = window.parFixtures[index];
              if (f) f.setVisibility(turnOn, params.conesEnabled !== false);
            });
            visBtn.textContent = turnOn ? '● On' : '○ Off';
            visBtn.style.cssText = gBtnStyle2 + (turnOn ? 'color:var(--ok);' : 'color:var(--icon);');
            document.activeElement?.blur?.();
          };

          const genLabel = document.createElement('span');
          genLabel.style.cssText = 'color:var(--secondary);font-size:10px;font-style:italic;margin-left:4px;';
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

              // Auto-select fixture in viewport when card is opened
              const selectThisGenLight = () => {
                const fixture = window.parFixtures[index];
                if (fixture && fixture.hitbox) {
                  transformControl.attach(fixture.hitbox);
                  deselectAllFixtures();
                  selectedFixtureIndices.add(index);
                  fixture.setSelected(true);
                }
              };
              if (typeof genFixFolder.onOpenClose === 'function') {
                genFixFolder.onOpenClose((open) => { if (open) selectThisGenLight(); });
              } else if (genFixFolder.domElement) {
                genFixFolder.domElement.querySelector('.title')?.addEventListener('click', () => {
                  if (!genFixFolder._closed) selectThisGenLight();
                });
              }

              // Name (editable)
              genFixFolder.add(config, 'name').name('Name').onFinishChange((v) => {
                genFixFolder.title(v);
                debounceAutoSave();
              });

              // Color / intensity / angle / penumbra — same controls the
              // hand-placed-fixture editor at line ~1720 exposes. Operator
              // report 2026-05-29: UkingPar and other generator-laid-out
              // fixtures didn't expose intensity in the per-fixture panel
              // (only Name + DMX patch + Metadata), so the operator
              // couldn't tune their brightness in the sim. These four
              // controls mirror the regular editor exactly so the two
              // surfaces feel identical.
              if (config.color === undefined) config.color = '#ffaa44';
              if (config.intensity === undefined) config.intensity = 5;
              if (config.angle === undefined) config.angle = 20;
              if (config.penumbra === undefined) config.penumbra = 0.5;
              // Per-fixture output override (On/Off + Brightness %)
              if (config.enabled === undefined) config.enabled = true;
              if (config.brightness === undefined) config.brightness = 100;
              genFixFolder.add(config, 'enabled').name('On').onChange(() => {
                selectThisGenLight();
                if (window.syncLightFromConfig) window.syncLightFromConfig(index);
                debounceAutoSave();
              });
              genFixFolder.add(config, 'brightness', 0, 100, 1).name('Brightness %').onChange(() => {
                selectThisGenLight();
                if (window.syncLightFromConfig) window.syncLightFromConfig(index);
                debounceAutoSave();
              });
              genFixFolder.addColor(config, 'color').onChange(() => {
                selectThisGenLight();
                if (window.syncLightFromConfig) window.syncLightFromConfig(index);
                debounceAutoSave();
              });
              genFixFolder.add(config, 'intensity', 0, 200, 0.5).onChange(() => {
                selectThisGenLight();
                if (window.syncLightFromConfig) window.syncLightFromConfig(index);
                debounceAutoSave();
              });
              genFixFolder.add(config, 'angle', 5, 90, 1).onChange(() => {
                selectThisGenLight();
                if (window.syncLightFromConfig) window.syncLightFromConfig(index);
                debounceAutoSave();
              });
              genFixFolder.add(config, 'penumbra', 0, 1, 0.05).onChange(() => {
                selectThisGenLight();
                if (window.syncLightFromConfig) window.syncLightFromConfig(index);
                debounceAutoSave();
              });

              // Generator info — styled DOM label instead of lil-gui controller
              const infoDiv = document.createElement('div');
              infoDiv.style.cssText = 'padding:2px 8px 4px;color:var(--secondary);font-size:9px;font-style:italic;';
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

              // `meta` is set after the metadata panel is appended below; the
              // forward reference is resolved at autoFixtureId() call-time.
              let meta = null;
              const autoFixtureId = () => {
                config.fixtureId = Math.min(65535, config.dmxUniverse * 1000 + config.dmxAddress);
                if (meta && meta.inputs && meta.inputs.fixtureId) {
                  meta.inputs.fixtureId.value = config.fixtureId;
                }
                if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('metadata');
              };

              const patchDiv = document.createElement('div');
              patchDiv.style.cssText = 'padding:2px 8px 6px;';

              // Header row
              const patchHeader = document.createElement('div');
              patchHeader.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:3px;';
              patchHeader.innerHTML = `<span style="color:var(--secondary);font-size:10px;font-weight:600;">📡 DMX Patch</span><span style="color:var(--icon);font-size:9px;">${fixtureType} · ${footprint}ch</span>`;
              patchDiv.appendChild(patchHeader);

              // Universe + Address row
              const patchRow = document.createElement('div');
              patchRow.style.cssText = 'display:flex;gap:4px;align-items:center;';

              const mkLabel = (text) => { const s = document.createElement('span'); s.style.cssText = 'color:var(--icon);font-size:9px;'; s.textContent = text; return s; };
              const mkInput = (value, max, onchange) => {
                const inp = document.createElement('input');
                inp.type = 'number'; inp.min = 0; inp.max = max; inp.step = 1; inp.value = value;
                inp.style.cssText = 'width:48px;padding:2px 4px;border:1px solid var(--ghost-border);border-radius:3px;background:var(--input-bg);color:var(--text);font-size:10px;font-family:inherit;text-align:center;';
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

              // Controller IP row
              if (config.controllerIp === undefined) config.controllerIp = '';
              const ipRow = document.createElement('div');
              ipRow.style.cssText = 'display:flex;gap:4px;align-items:center;margin-top:3px;';
              ipRow.appendChild(mkLabel('IP:'));
              const ipInput = document.createElement('input');
              ipInput.type = 'text';
              ipInput.value = config.controllerIp || '';
              ipInput.placeholder = '10.1.1.10';
              ipInput.style.cssText = 'flex:1;padding:2px 4px;border:1px solid var(--ghost-border);border-radius:3px;background:var(--input-bg);color:var(--text);font-size:10px;font-family:inherit;';
              ipInput.onchange = () => { config.controllerIp = ipInput.value.trim(); debounceAutoSave(); };
              ipRow.appendChild(ipInput);
              patchDiv.appendChild(ipRow);

              // With a controller mapping present, patch fields are
              // PROJECTED (docs/33) — display-only here, edited in the
              // 🎛 Controllers panel. Registration keeps the values and
              // the locked state live across mapping changes.
              registerPatchRowRefresh(config, {
                root: patchDiv, uniInput, addrInput, ipInput, updateStatus,
              });

              if (genChildren) genChildren.appendChild(patchDiv);

              meta = appendMetadataPanelV2(genChildren, config, { onChange: debounceAutoSave });
              // Trace-generated fixtures auto-default fixtureId from DMX patch
              // on creation; the input is editable so users can override.
              if (meta && meta.inputs && meta.inputs.fixtureId) {
                meta.inputs.fixtureId.title = 'Defaulted to Universe × 1000 + Address; editable.';
              }
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
        // `min-width:0` is required so a flex child can shrink below its
        // intrinsic content width — without it, "✏ Rename" / "✕ Delete"
        // would push past the button's flex column. The ellipsis chain
        // (white-space + overflow + text-overflow) makes any future label
        // overflow render as `Re…` inside the button frame instead of
        // visually leaking past the right border.
        const gBtnStyle = 'flex:1 1 0;min-width:0;padding:3px 6px;border:none;border-radius:3px;background:var(--control-bg);color:var(--secondary);cursor:pointer;font-size:10px;font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;';

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
        visBtn.style.cssText = gBtnStyle + (groupHidden ? 'color:var(--icon);' : 'color:var(--ok);');
        visBtn.onclick = () => {
          const turnOn = visBtn.textContent.includes('Off');
          items.forEach(({ index }) => {
            const f = window.parFixtures[index];
            if (f) f.setVisibility(turnOn, params.conesEnabled !== false);
          });
          visBtn.textContent = turnOn ? '● On' : '○ Off';
          visBtn.style.cssText = gBtnStyle + (turnOn ? 'color:var(--ok);' : 'color:var(--icon);');
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
            // Carry the group master override across the rename (keyed by name).
            if (params.groupOverrides && params.groupOverrides[groupName]) {
              params.groupOverrides[newName] = params.groupOverrides[groupName];
              delete params.groupOverrides[groupName];
            }
            // Carry the group's view-mask bit across the rename so
            // patterns compiled against MASK_* names stay stable.
            if (window.viewRegistryRenameGroup) window.viewRegistryRenameGroup(groupName, newName);
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
        typeSelect.style.cssText = 'flex:1;padding:2px;border:none;border-radius:3px;background:var(--control-bg);color:var(--secondary);font-size:10px;font-family:inherit;cursor:pointer;';
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
        addBtn.style.cssText = 'padding:2px 8px;border:none;border-radius:3px;background:color-mix(in srgb, var(--ok) 15%, var(--surface));color:var(--ok);cursor:pointer;font-size:10px;font-family:inherit;font-weight:bold;';
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
            enabled: true, brightness: 100,
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
          
          // Ensure non-light fixtures like FogMachine don't crash lil-gui
          if (config.color === undefined) config.color = '#ffffff';
          if (config.intensity === undefined) config.intensity = 5;
          if (config.angle === undefined) config.angle = 20;
          if (config.penumbra === undefined) config.penumbra = 0.5;
          // Per-fixture output override (On/Off + Brightness %)
          if (config.enabled === undefined) config.enabled = true;
          if (config.brightness === undefined) config.brightness = 100;

          // V2 metadata defaults
          if (config.controllerId === undefined) config.controllerId = 0;
          if (config.sectionId === undefined) config.sectionId = 0;
          if (config.fixtureId === undefined) config.fixtureId = 0;
          if (config.viewMask === undefined) config.viewMask = 0;

          const idxFolder = groupFolder.addFolder(config.name);
          idxFolder.domElement.classList.add('gui-card');
          idxFolder.close();
          window.parGuiFolders[index] = idxFolder;

          if (config.fixtureType === 'TEFogMachine' || config.fixtureType === 'ChauvetHaze4D') {
            const holdBtn = document.createElement('button');
            holdBtn.textContent = '💨 Hold to Fog';
            holdBtn.style.cssText = 'width:calc(100% - 16px);margin:4px 8px;padding:4px;border:none;border-radius:3px;background:color-mix(in srgb, var(--error) 15%, var(--surface));color:var(--error);cursor:pointer;font-size:10px;font-weight:bold;';
            const toggleFog = (state) => {
              console.log(`[GUI] toggleFog(${state}) called`);
              [...(window.parFixtures || []), ...(window.dmxSceneFixtures || [])].forEach(f => {
                if (f && f.config && (f.config.fixtureType === 'TEFogMachine' || f.config.fixtureType === 'ChauvetHaze4D' || f.config.type === 'TEFogMachine' || f.config.type === 'ChauvetHaze4D')) {
                  f._uiFogOverride = state;
                  // When stopping, immediately flush zeros into the router buffer
                  if (!state && window.dmxRouter) {
                    const u = f.config.dmxUniverse;
                    const addr = f.config.dmxAddress;
                    if (u && u > 0 && addr && addr > 0) {
                      const fType = f.config.type || f.config.fixtureType;
                      const zeros = fType === 'ChauvetHaze4D' ? new Uint8Array([0, 0]) : new Uint8Array([0]);
                      window.dmxRouter.submitFrame('fog_ui', 250, u, zeros, addr);
                    }
                  }
                }
              });
              // Delay source removal so processFrame merges the zeros first
              if (!state && window.dmxRouter) {
                setTimeout(() => {
                  if (window.dmxRouter) {
                    // Remove all per-fixture fog sources
                    [...(window.parFixtures || []), ...(window.dmxSceneFixtures || [])].forEach(f => {
                      if (f && f._fogSourceId) window.dmxRouter.removeSource(f._fogSourceId);
                    });
                  }
                }, 200);
              }

              // Call the central Engine API (best-effort, engine may not be running).
              // On a static host the API is unreachable and the fetch is mixed-content
              // blocked, so skip it instead of letting the browser log the failure.
              if (isStaticHost()) {
                logStaticHostSkip('engine /global-effect (port 6968)');
              } else {
                const host = window.location.hostname;
                fetch(`http://${host}:6968/global-effect`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ effect: 'fogger', state: !!state })
                }).catch(() => {}); // silently ignore if engine not running
              }
            };
            const startFog = (e) => { e.preventDefault(); toggleFog(true); };
            const stopFog = () => toggleFog(false);
            holdBtn.addEventListener('mousedown', startFog);
            holdBtn.addEventListener('touchstart', startFog);
            // Stop on global mouseup/touchend so fog releases even if cursor leaves the button
            holdBtn.addEventListener('mousedown', () => {
              const onUp = () => { stopFog(); window.removeEventListener('mouseup', onUp); };
              window.addEventListener('mouseup', onUp);
            });
            holdBtn.addEventListener('touchstart', () => {
              const onEnd = () => { stopFog(); window.removeEventListener('touchend', onEnd); window.removeEventListener('touchcancel', onEnd); };
              window.addEventListener('touchend', onEnd);
              window.addEventListener('touchcancel', onEnd);
            });
            const childContainer = idxFolder.domElement.querySelector('.children');
            if (childContainer) childContainer.appendChild(holdBtn);
          }

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

          // On/Off + Brightness — operator override on top of any pattern.
          idxFolder.add(config, "enabled").name("On").onChange((v) => {
            selectThisLight();
            window.syncLightFromConfig(index);
            propagateToSelected(index, 'enabled', v);
          });
          idxFolder.add(config, "brightness", 0, 100, 1).name("Brightness %").onChange((v) => {
            selectThisLight();
            window.syncLightFromConfig(index);
            propagateToSelected(index, 'brightness', v);
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
          idxFolder.add(config, "angle", 5, 90, 1).onChange((v) => {
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
          posFolder.add(config, "x", -200, 200, 0.01).onChange((v) => {
            selectThisLight(); window.syncLightFromConfig(index); propagateToSelected(index, 'x', v);
          });
          posFolder.add(config, "y", 0, 100, 0.01).onChange((v) => {
            selectThisLight(); window.syncLightFromConfig(index); propagateToSelected(index, 'y', v);
          });
          posFolder.add(config, "z", -200, 200, 0.01).onChange((v) => {
            selectThisLight(); window.syncLightFromConfig(index); propagateToSelected(index, 'z', v);
          });

          // Rotation
          const rotFolder = idxFolder.addFolder("Rotation");
          rotFolder.close();
          const step = params.snapAngle || 5;
          rotFolder.add(config, "rotX", -180, 180, step).onChange((v) => {
            selectThisLight(); window.syncLightFromConfig(index); propagateToSelected(index, 'rotX', v);
          });
          rotFolder.add(config, "rotY", -180, 180, step).onChange((v) => {
            selectThisLight(); window.syncLightFromConfig(index); propagateToSelected(index, 'rotY', v);
          });
          rotFolder.add(config, "rotZ", -180, 180, step).onChange((v) => {
            selectThisLight(); window.syncLightFromConfig(index); propagateToSelected(index, 'rotZ', v);
          });

          // 🔖 Metadata (V2) — compact DOM panel (shared helper, see top of file)
          const idxChildrenForMeta = idxFolder.domElement.querySelector('.children');
          appendMetadataPanelV2(idxChildrenForMeta, config, { onChange: debounceAutoSave });

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
          patchHeader.innerHTML = `<span style="color:var(--secondary);font-size:10px;font-weight:600;">📡 DMX Patch</span><span style="color:var(--icon);font-size:9px;">${fixtureType} · ${footprint}ch</span>`;
          patchDiv.appendChild(patchHeader);

          // Universe + Address row
          const patchRow = document.createElement('div');
          patchRow.style.cssText = 'display:flex;gap:4px;align-items:center;';

          const mkLabel = (text) => { const s = document.createElement('span'); s.style.cssText = 'color:var(--icon);font-size:9px;'; s.textContent = text; return s; };
          const mkInput = (value, max, onchange) => {
            const inp = document.createElement('input');
            inp.type = 'number'; inp.min = 0; inp.max = max; inp.step = 1; inp.value = value;
            inp.style.cssText = 'width:52px;padding:2px 4px;border:1px solid var(--ghost-border);border-radius:3px;background:var(--input-bg);color:var(--text);font-size:10px;font-family:inherit;text-align:center;';
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
          ipInput.placeholder = '10.1.1.10';
          ipInput.style.cssText = 'flex:1;padding:2px 4px;border:1px solid var(--ghost-border);border-radius:3px;background:var(--input-bg);color:var(--text);font-size:10px;font-family:inherit;';
          ipInput.onchange = () => { config.controllerIp = ipInput.value.trim(); debounceAutoSave(); };
          ipRow.appendChild(ipInput);
          patchDiv.appendChild(ipRow);

          // With a controller mapping present, patch fields are
          // PROJECTED (docs/33) — display-only here, edited in the
          // 🎛 Controllers panel. Registration keeps the values and
          // the locked state live across mapping changes.
          registerPatchRowRefresh(config, {
            root: patchDiv, uniInput, addrInput, ipInput, updateStatus: updatePatchStatus,
          });

          const idxChildren = idxFolder.domElement.querySelector('.children');
          if (idxChildren) idxChildren.appendChild(patchDiv);

          // Compact action row
          const actDiv = document.createElement('div');
          actDiv.style.cssText = 'display:flex;gap:2px;padding:4px 6px;border-top:1px solid var(--ghost-border);margin-top:4px;';
          const aBtnStyle = 'flex:1;padding:2px 0;border:none;border-radius:3px;background:var(--control-bg);color:var(--secondary);cursor:pointer;font-size:10px;font-family:inherit;';

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
            const removed = params.parLights[index];
            params.parLights.splice(index, 1);
            // Mapped fixture deleted → its mapping entry drops;
            // addresses are absolute, so nothing else shifts
            // (controller_map_editor owns the details).
            if (window.controllerMappingFixturesRemoved) {
              window.controllerMappingFixturesRemoved([removed]);
            }
            if (window._setGuiRebuilding) window._setGuiRebuilding(true);
            renderParGUI();
            rebuildParLights();
            if (window._setGuiRebuilding) window._setGuiRebuilding(false);
            debounceAutoSave();
          };

          // Move to group dropdown
          const moveSelect = document.createElement('select');
          moveSelect.style.cssText = 'flex:1;padding:2px;border:none;border-radius:3px;background:var(--control-bg);color:var(--secondary);font-size:10px;font-family:inherit;cursor:pointer;';
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
        if (t.aimLine) t.aimLine.visible = visible;
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
        // Selection highlights the wireframe path only. The preview dots are
        // intentionally left alone so their per-point spacing gradient stays
        // readable (overriding them would defeat the gradient feature).
        if (tObj.materials.lineMat) {
          tObj.materials.lineMat.color.setHex(color);
          tObj.materials.lineMat.opacity = opacity;
        }
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

    // Build the path geometry for a trace as a parametric arclength curve.
    // Returns { length, at(s), tangentAt(s) } where `s` is arclength in
    // meters from the path start (0..length). This is the single source of
    // truth used by both the even base layout and the per-point offset
    // post-processing, so a point at arclength `s` always lands on the path
    // regardless of shape (line, circle/arc, or corner).
    function buildTracePath(trace) {
      if (trace.shape === 'circle') {
        const r = trace.radius || 5;
        const arcRad = THREE.MathUtils.degToRad(trace.arc || 360);
        const length = r * arcRad;
        return {
          length,
          // Position at arclength s (local circle space, before group transform)
          at(s) {
            const angle = length > 1e-9 ? (s / length) * arcRad : 0;
            return new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
          },
          // Unit tangent (direction of increasing s) at arclength s
          tangentAt(s) {
            const angle = length > 1e-9 ? (s / length) * arcRad : 0;
            // d/dangle of (cos,0,sin) = (-sin,0,cos)
            return new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).normalize();
          },
        };
      }
      if (trace.shape === 'corner') {
        // Corner: two straight segments meeting at a corner vertex
        // (start→corner→end). Arclength runs start→corner (0..lenA) then
        // corner→end (lenA..lenA+lenB), so one point list slides smoothly
        // across the bend and offsets/gradient compose like any other shape.
        const start  = new THREE.Vector3(trace.startX ?? -5, trace.startY ?? 5, trace.startZ ?? 0);
        const corner = new THREE.Vector3(trace.cornerX ?? 0, trace.cornerY ?? 5, trace.cornerZ ?? 0);
        const end    = new THREE.Vector3(trace.endX ?? 5, trace.endY ?? 5, trace.endZ ?? 5);
        const lenA = start.distanceTo(corner);
        const lenB = corner.distanceTo(end);
        const length = lenA + lenB;
        const dirA = lenA > 1e-9
          ? new THREE.Vector3().subVectors(corner, start).divideScalar(lenA)
          : new THREE.Vector3(1, 0, 0);
        const dirB = lenB > 1e-9
          ? new THREE.Vector3().subVectors(end, corner).divideScalar(lenB)
          : dirA.clone();
        return {
          length,
          at(s) {
            if (s <= lenA) return start.clone().addScaledVector(dirA, s);
            return corner.clone().addScaledVector(dirB, s - lenA);
          },
          tangentAt(s) { return (s <= lenA ? dirA : dirB).clone(); },
        };
      }
      // line: world-space start to end
      const start = new THREE.Vector3(trace.startX ?? 0, trace.startY ?? 5, trace.startZ ?? 0);
      const end = new THREE.Vector3(trace.endX ?? 10, trace.endY ?? 5, trace.endZ ?? 0);
      const length = start.distanceTo(end);
      const dir = length > 1e-9
        ? new THREE.Vector3().subVectors(end, start).divideScalar(length)
        : new THREE.Vector3(1, 0, 0);
      return {
        length,
        at(s) { return start.clone().addScaledVector(dir, s); },
        tangentAt() { return dir.clone(); },
      };
    }

    function computeTracePoints(trace) {
      const path = buildTracePath(trace);

      // ─── 1. Base even layout: arclength position per point ────────────────
      // A "closed" circle (full 360° arc) wraps, so points are evenly spaced
      // around the loop without an endpoint at the seam. A line / partial arc
      // / corner is "open" — the last point sits exactly at the end. Shared
      // with the point-drag math via computeTraceBaseArclengths so they never
      // diverge.
      const baseS = computeTraceBaseArclengths(trace, path);

      // ─── 2. Post-process: apply per-point arclength offsets ───────────────
      // `trace.pointOffsets[k]` is a small signed shift in meters along the
      // path tangent. Default (undefined / 0) → byte-identical even layout.
      // Each offset is clamped so a point cannot cross its neighbours or
      // leave the path, keeping ordering stable. This block is intentionally
      // generic (operates on the arclength list + path) so it composes with
      // any base count and any path shape (line, circle/arc, corner).
      const offsets = Array.isArray(trace.pointOffsets) ? trace.pointOffsets : null;
      const finalS = baseS.slice();
      if (offsets) {
        const margin = 0.05; // keep a sliver of gap so points never coincide
        for (let i = 0; i < finalS.length; i++) {
          const off = offsets[i];
          if (!off) continue; // 0 / undefined → leave at even position
          let s = baseS[i] + off;
          // Clamp between neighbours (or path ends) to preserve ordering.
          const lower = i > 0 ? finalS[i - 1] + margin : 0;
          const upper = i < finalS.length - 1 ? baseS[i + 1] - margin : path.length;
          s = Math.min(Math.max(s, lower), Math.min(upper, path.length));
          finalS[i] = Math.max(s, 0);
        }
      }

      return finalS.map((s) => path.at(s));
    }

    // Per-point colors for the preview dots based on spacing to the next
    // point. Gradient scheme (documented for the operator):
    //   • GREEN  → spacing at/near the even target (lights evenly placed)
    //   • BLUE   → smaller gap than target (lights bunched together)
    //   • RED    → larger gap than target (lights stretched apart)
    // The target is the mean inter-point distance, so the gradient is
    // relative to "what even spacing would be" for this trace. The last
    // point inherits the colour of the segment ending at it.
    function computeTraceDotColors(pts) {
      const n = pts.length;
      if (n === 0) return [];
      if (n === 1) return [chroma('#22cc66').hex()];

      const gaps = [];
      for (let i = 0; i < n - 1; i++) gaps.push(pts[i].distanceTo(pts[i + 1]));
      const target = gaps.reduce((a, b) => a + b, 0) / gaps.length;

      // Diverging blue→green→red scale, readable on the dark sim theme.
      const scale = chroma.scale(['#2a7fff', '#22cc66', '#ff4422']).mode('lab');
      const colorForGap = (gap) => {
        if (target < 1e-6) return scale(0.5).hex();
        // ratio 1 → even (green). Map [0.5x .. 1.5x] target onto [0..1].
        const ratio = gap / target;
        const t = THREE.MathUtils.clamp((ratio - 0.5) / 1.0, 0, 1);
        return scale(t).hex();
      };

      const colors = [];
      for (let i = 0; i < n; i++) {
        // A point's colour reflects the gap leading INTO it (segment i-1→i),
        // except the first point which uses the gap leading OUT of it.
        const gap = i === 0 ? gaps[0] : gaps[i - 1];
        colors.push(colorForGap(gap));
      }
      return colors;
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

        // Preview dots at light positions — each dot gets its OWN material
        // instance so it can be tinted by the spacing gradient. The point
        // index `k` lets the drag handler know which point moved.
        const lightPts = computeTracePoints(trace);
        const dotColors = computeTraceDotColors(lightPts);
        const dotGeo = new THREE.SphereGeometry(0.3, 8, 8); // slightly larger for easier clicking
        const dotMats = [];
        lightPts.forEach((p, k) => {
          const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(dotColors[k]) });
          dotMats.push(dotMat);
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.copy(p);
          dot.userData = { isTraceVisual: true, traceIndex, pointIndex: k };
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

        return { group: grp, hitbox: null, handles: [startHandle, endHandle, aimHandle], visuals, traceIndex, materials: { lineMat, dotMats }, aimLine };

      } else if (trace.shape === 'corner') {
        // ─── CORNER: two segments (start→corner→end), three draggable handles ───
        // Mirrors the line build, with an extra middle (corner) handle.
        const startPos  = new THREE.Vector3(trace.startX ?? -5, trace.startY ?? 5, trace.startZ ?? 0);
        const cornerPos = new THREE.Vector3(trace.cornerX ?? 0, trace.cornerY ?? 5, trace.cornerZ ?? 0);
        const endPos    = new THREE.Vector3(trace.endX ?? 5, trace.endY ?? 5, trace.endZ ?? 5);

        const grp = new THREE.Group();
        const visuals = [];

        // Wireframe polyline through the three defining points
        const lineGeo = new THREE.BufferGeometry().setFromPoints([startPos, cornerPos, endPos]);
        const lineMat = new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.7 });
        const lineMesh = new THREE.Line(lineGeo, lineMat);
        lineMesh.userData = { isTraceVisual: true, traceIndex };
        grp.add(lineMesh);
        visuals.push(lineMesh);
        interactiveObjects.push(lineMesh);

        // Preview dots at light positions — each gets its own material for the
        // spacing gradient and a pointIndex so it can be dragged along the path.
        const lightPts = computeTracePoints(trace);
        const dotColors = computeTraceDotColors(lightPts);
        const dotGeo = new THREE.SphereGeometry(0.3, 8, 8);
        const dotMats = [];
        lightPts.forEach((p, k) => {
          const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(dotColors[k]) });
          dotMats.push(dotMat);
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.copy(p);
          dot.userData = { isTraceVisual: true, traceIndex, pointIndex: k };
          grp.add(dot);
          visuals.push(dot);
          interactiveObjects.push(dot);
        });

        scene.add(grp);

        // Three draggable handle spheres at scene root (start / corner / end)
        const handleGeo = new THREE.SphereGeometry(0.4, 12, 12);
        const startMat  = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.7 });
        const cornerMat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.7 });
        const endMat    = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.7 });

        const startHandle = new THREE.Mesh(handleGeo, startMat);
        startHandle.position.copy(startPos);
        startHandle.userData = { isTrace: true, traceIndex, handleType: 'start' };
        orientTraceHandle(startHandle, startPos, cornerPos);
        scene.add(startHandle);
        interactiveObjects.push(startHandle);

        const cornerHandle = new THREE.Mesh(handleGeo, cornerMat);
        cornerHandle.position.copy(cornerPos);
        cornerHandle.userData = { isTrace: true, traceIndex, handleType: 'corner' };
        orientTraceHandle(cornerHandle, startPos, cornerPos);
        scene.add(cornerHandle);
        interactiveObjects.push(cornerHandle);

        const endHandle = new THREE.Mesh(handleGeo, endMat);
        endHandle.position.copy(endPos);
        endHandle.userData = { isTrace: true, traceIndex, handleType: 'end' };
        orientTraceHandle(endHandle, cornerPos, endPos);
        scene.add(endHandle);
        interactiveObjects.push(endHandle);

        // Aim handle (yellow sphere) — same behavior as the line
        const aimHandleGeo = new THREE.SphereGeometry(0.35, 12, 12);
        const aimHandleMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.8 });
        const aimHandle = new THREE.Mesh(aimHandleGeo, aimHandleMat);
        aimHandle.position.set(trace.aimX || 0, trace.aimY || 0, trace.aimZ || 0);
        aimHandle.userData = { isTrace: true, traceIndex, handleType: 'aim' };
        scene.add(aimHandle);
        interactiveObjects.push(aimHandle);

        // Dashed line from first light point to aim handle
        const aimOrigin = lightPts.length > 0 ? lightPts[0] : startPos.clone();
        const aimLineGeo = new THREE.BufferGeometry().setFromPoints([aimOrigin, aimHandle.position]);
        const aimLineMat = new THREE.LineDashedMaterial({ color: 0xffcc00, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 0.5 });
        const aimLine = new THREE.Line(aimLineGeo, aimLineMat);
        aimLine.computeLineDistances();
        grp.add(aimLine);

        return { group: grp, hitbox: null, handles: [startHandle, cornerHandle, endHandle, aimHandle], visuals, traceIndex, materials: { lineMat, dotMats }, aimLine };

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

        // Preview dots — own material per dot for the spacing gradient,
        // and a point index `k` so the drag handler can identify them.
        const lightPts = computeTracePoints(trace);
        const dotColors = computeTraceDotColors(lightPts);
        const dotGeo = new THREE.SphereGeometry(0.3, 8, 8); // slightly larger
        const dotMats = [];
        lightPts.forEach((p, k) => {
          const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(dotColors[k]) });
          dotMats.push(dotMat);
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.copy(p);
          dot.userData = { isTraceVisual: true, traceIndex, pointIndex: k };
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

        return { group: grp, hitbox, handles: [aimHandle], visuals, traceIndex, materials: { lineMat, dotMats }, aimLine };
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

        if (tObj.aimLine) {
           const pts = computeTracePoints(trace);
           let aimOrigin = new THREE.Vector3();
           if (trace.shape === 'line') {
              aimOrigin = pts.length > 0 ? pts[0] : new THREE.Vector3(trace.startX ?? 0, trace.startY ?? 5, trace.startZ ?? 0).lerp(new THREE.Vector3(trace.endX ?? 10, trace.endY ?? 5, trace.endZ ?? 0), 0.5);
           } else {
              if (pts.length > 0) {
                 const euler = new THREE.Euler(THREE.MathUtils.degToRad(trace.rotX || 0), THREE.MathUtils.degToRad(trace.rotY || 0), THREE.MathUtils.degToRad(trace.rotZ || 0), 'YXZ');
                 aimOrigin.copy(pts[0]).applyEuler(euler).add(new THREE.Vector3(trace.x || 0, trace.y || 5, trace.z || 0));
              } else {
                 aimOrigin.copy(tObj.group ? tObj.group.position : new THREE.Vector3(trace.x || 0, trace.y || 5, trace.z || 0));
              }
           }
           tObj.aimLine.geometry.setFromPoints([aimOrigin, obj.position]);
           tObj.aimLine.computeLineDistances();
        }
      } else if (trace.shape === 'corner' &&
                 (obj.userData.handleType === 'start' ||
                  obj.userData.handleType === 'corner' ||
                  obj.userData.handleType === 'end')) {
        // ─── CORNER handle moved (start / corner / end) ───
        // Mirrors the line handle path: write the moved point back to the
        // right trace.{start,corner,end}{X,Y,Z}, drag the aim handle by the
        // same delta, re-orient the handles along the two segments, and live-
        // rebuild the 3-point polyline + dots.
        const ht = obj.userData.handleType;
        const keyX = ht === 'start' ? 'startX' : (ht === 'corner' ? 'cornerX' : 'endX');
        const keyY = ht === 'start' ? 'startY' : (ht === 'corner' ? 'cornerY' : 'endY');
        const keyZ = ht === 'start' ? 'startZ' : (ht === 'corner' ? 'cornerZ' : 'endZ');

        const dx = obj.position.x - (trace[keyX] ?? 0);
        const dy = obj.position.y - (trace[keyY] ?? 5);
        const dz = obj.position.z - (trace[keyZ] ?? 0);

        // Move aim handle by same delta (keeps the aim offset stable)
        trace.aimX = (trace.aimX || 0) + dx;
        trace.aimY = (trace.aimY || 0) + dy;
        trace.aimZ = (trace.aimZ || 0) + dz;

        trace[keyX] = obj.position.x;
        trace[keyY] = obj.position.y;
        trace[keyZ] = obj.position.z;

        const aimHandle = (tObj.handles || []).find(h => h.userData.handleType === 'aim');
        if (aimHandle) aimHandle.position.set(trace.aimX, trace.aimY, trace.aimZ);

        // Re-orient handles along their adjacent segments
        const s = new THREE.Vector3(trace.startX ?? -5, trace.startY ?? 5, trace.startZ ?? 0);
        const c = new THREE.Vector3(trace.cornerX ?? 0, trace.cornerY ?? 5, trace.cornerZ ?? 0);
        const e = new THREE.Vector3(trace.endX ?? 5, trace.endY ?? 5, trace.endZ ?? 5);
        const startH = (tObj.handles || []).find(h => h.userData.handleType === 'start');
        const cornerH = (tObj.handles || []).find(h => h.userData.handleType === 'corner');
        const endH = (tObj.handles || []).find(h => h.userData.handleType === 'end');
        if (startH) orientTraceHandle(startH, s, c);
        if (cornerH) orientTraceHandle(cornerH, s, c);
        if (endH) orientTraceHandle(endH, c, e);

        // Update dashed aim line origin
        if (tObj.aimLine && aimHandle) {
          const pts = computeTracePoints(trace);
          const aimOrigin = pts.length > 0 ? pts[0] : s.clone();
          tObj.aimLine.geometry.setFromPoints([aimOrigin, aimHandle.position]);
          tObj.aimLine.computeLineDistances();
        }

        // Live-rebuild the 3-point polyline + dots, using the SAME contract as
        // buildTraceObject (own material per dot for the spacing gradient + a
        // pointIndex so they stay draggable along the path) and re-registering
        // them in interactiveObjects so dragging a corner handle never strips
        // the trace of its gradient or per-point drag handles.
        if (tObj.group) {
          // Drop the previous dots/line from interactiveObjects so stale meshes
          // can't keep catching raycasts after this rebuild.
          (tObj.visuals || []).forEach((v) => {
            const idx = interactiveObjects.indexOf(v);
            if (idx !== -1) interactiveObjects.splice(idx, 1);
          });
          scene.remove(tObj.group);

          const grp = new THREE.Group();
          const lineGeo = new THREE.BufferGeometry().setFromPoints([s, c, e]);
          const lineMat = new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.7 });
          const lineMesh = new THREE.Line(lineGeo, lineMat);
          lineMesh.userData = { isTraceVisual: true, traceIndex: tIdx };
          grp.add(lineMesh);

          const visuals = [lineMesh];
          interactiveObjects.push(lineMesh);

          const pts = computeTracePoints(trace);
          const dotColors = computeTraceDotColors(pts);
          const dotGeo = new THREE.SphereGeometry(0.3, 8, 8);
          const dotMats = [];
          pts.forEach((p, k) => {
            const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(dotColors[k]) });
            dotMats.push(dotMat);
            const d = new THREE.Mesh(dotGeo, dotMat);
            d.position.copy(p);
            d.userData = { isTraceVisual: true, traceIndex: tIdx, pointIndex: k };
            grp.add(d);
            visuals.push(d);
            interactiveObjects.push(d);
          });

          grp.visible = params.generatorsVisible !== false;
          if (tObj.aimLine) {
            grp.add(tObj.aimLine);
            tObj.aimLine.visible = params.generatorsVisible !== false;
          }
          scene.add(grp);
          tObj.group = grp;
          tObj.visuals = visuals;
          tObj.materials = { lineMat, dotMats };
        }
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

        // Live-update the wireframe line + dots without full rebuild. The
        // dots are rebuilt with the SAME contract as buildTraceObject (own
        // material per dot for the spacing gradient + a pointIndex so they
        // stay draggable along the path) and re-registered in
        // interactiveObjects, so dragging a line endpoint never strips a
        // trace of its gradient or per-point drag handles.
        if (tObj.group) {
          // Drop the previous dots from interactiveObjects so stale meshes
          // can't keep catching raycasts after this rebuild.
          (tObj.visuals || []).forEach((v) => {
            const idx = interactiveObjects.indexOf(v);
            if (idx !== -1) interactiveObjects.splice(idx, 1);
          });
          scene.remove(tObj.group);

          const grp = new THREE.Group();
          const s = new THREE.Vector3(trace.startX ?? 0, trace.startY ?? 5, trace.startZ ?? 0);
          const e = new THREE.Vector3(trace.endX ?? 10, trace.endY ?? 5, trace.endZ ?? 0);
          const lineGeo = new THREE.BufferGeometry().setFromPoints([s, e]);
          const lineMat = new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.7 });
          const lineMesh = new THREE.Line(lineGeo, lineMat);
          lineMesh.userData = { isTraceVisual: true, traceIndex: tIdx };
          grp.add(lineMesh);

          const visuals = [lineMesh];
          interactiveObjects.push(lineMesh);

          const pts = computeTracePoints(trace);
          const dotColors = computeTraceDotColors(pts);
          const dotGeo = new THREE.SphereGeometry(0.3, 8, 8);
          const dotMats = [];
          pts.forEach((p, k) => {
            const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(dotColors[k]) });
            dotMats.push(dotMat);
            const d = new THREE.Mesh(dotGeo, dotMat);
            d.position.copy(p);
            d.userData = { isTraceVisual: true, traceIndex: tIdx, pointIndex: k };
            grp.add(d);
            visuals.push(d);
            interactiveObjects.push(d);
          });

          grp.visible = params.generatorsVisible !== false;
          if (tObj.aimLine) {
            grp.add(tObj.aimLine); // re-attach the preserved dash line to the new group
            tObj.aimLine.visible = params.generatorsVisible !== false;
          }
          scene.add(grp);
          tObj.group = grp;
          tObj.visuals = visuals;
          tObj.materials = { lineMat, dotMats }; // Preserve material refs for highlighting
        }
      } else {
        // Circle hitbox
        const aimHandle = (tObj.handles || []).find(h => h.userData.handleType === 'aim');

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
      
      if (trace.generated) {
        generateGroupFromTrace(tIdx, true);
      }

      debounceAutoSave();
      return true;
    };

    // ─── Per-point drag (slide a light along its path) ────────────────────
    // The preview dots are draggable: dragging one projects the pointer ray
    // onto the trace path, finds the nearest arclength `s`, and stores the
    // signed difference from that point's even base position as
    // `trace.pointOffsets[k]`. This mirrors the reference PixelMapper model
    // (drag is constrained to the path, never free 3D motion). All path math
    // lives here next to `buildTracePath`. Interaction plumbing (raycast,
    // disabling orbit) stays in interaction.js and calls these via `window`.
    let _dotDrag = null; // { traceIndex, pointIndex }

    // World-space position of arclength `s` on a trace's path. Circle paths
    // are authored in the group's local space, so they are pushed through the
    // group world matrix; line paths are already world-space.
    function traceWorldAt(trace, tObj, path, s) {
      const local = path.at(s);
      if (trace.shape === 'circle' && tObj && tObj.group) {
        tObj.group.updateMatrixWorld(true);
        return local.applyMatrix4(tObj.group.matrixWorld);
      }
      return local;
    }

    // Find the arclength on `path` whose world point is closest to the given
    // ray (origin + direction). Samples coarsely then refines — robust for
    // both straight lines and arcs without needing a closed-form solution.
    function closestArclengthToRay(trace, tObj, path, rayOrigin, rayDir) {
      const evalDist = (s) => {
        const wp = traceWorldAt(trace, tObj, path, s);
        // Distance from world point to the (infinite) ray.
        const toPt = new THREE.Vector3().subVectors(wp, rayOrigin);
        const proj = toPt.dot(rayDir);
        const closestOnRay = rayOrigin.clone().addScaledVector(rayDir, proj);
        return wp.distanceToSquared(closestOnRay);
      };

      const len = path.length;
      if (len < 1e-9) return 0;
      const COARSE = 200;
      let bestS = 0;
      let bestD = Infinity;
      for (let i = 0; i <= COARSE; i++) {
        const s = (i / COARSE) * len;
        const d = evalDist(s);
        if (d < bestD) { bestD = d; bestS = s; }
      }
      // Golden-section-ish local refinement around the coarse winner.
      let lo = Math.max(0, bestS - len / COARSE);
      let hi = Math.min(len, bestS + len / COARSE);
      for (let iter = 0; iter < 30; iter++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        if (evalDist(m1) < evalDist(m2)) hi = m2; else lo = m1;
      }
      return (lo + hi) / 2;
    }

    window._beginTraceDotDrag = function(traceIndex, pointIndex) {
      const trace = params.traces[traceIndex];
      if (!trace) return false;
      pushUndo();
      _dotDrag = { traceIndex, pointIndex };
      return true;
    };

    // Called continuously while dragging. `rayOrigin`/`rayDir` describe the
    // pointer ray in world space (built by interaction.js from the camera).
    window._updateTraceDotDrag = function(rayOrigin, rayDir) {
      if (!_dotDrag) return false;
      const { traceIndex, pointIndex } = _dotDrag;
      const trace = params.traces[traceIndex];
      const tObj = window.traceObjects[traceIndex];
      if (!trace || !tObj) return false;

      const path = buildTracePath(trace);

      // Re-derive this point's even base arclength so the stored value is a
      // pure offset (composes with whatever base count exists today).
      const baseAll = computeTraceBaseArclengths(trace, path);
      if (pointIndex < 0 || pointIndex >= baseAll.length) return false;
      const baseS = baseAll[pointIndex];

      const targetS = closestArclengthToRay(trace, tObj, path, rayOrigin, rayDir);
      if (!Array.isArray(trace.pointOffsets)) trace.pointOffsets = [];
      // Keep the offsets array sized to the point count (pad with 0).
      while (trace.pointOffsets.length < baseAll.length) trace.pointOffsets.push(0);
      trace.pointOffsets[pointIndex] = targetS - baseS;

      // Live update: recompute dot positions + spacing gradient in place so
      // dragging feels fluid (no destroy/rebuild churn of the whole trace).
      refreshTraceDots(traceIndex);
      if (trace.generated) generateGroupFromTrace(traceIndex, true);
      return true;
    };

    window._endTraceDotDrag = function() {
      if (!_dotDrag) return;
      _dotDrag = null;
      debounceAutoSave();
    };

    // Recompute the base (even, pre-offset) arclengths for a trace. Shared by
    // computeTracePoints and the drag math so the two never disagree.
    function computeTraceBaseArclengths(trace, path) {
      // COUNT is authoritative: the user sets the number of lights directly
      // (fixture width is informational only — see the Lights control). This
      // is the single source of truth for the even base layout, shared by
      // computeTracePoints' offset post-processing so the two never diverge.
      const count = Math.max(1, Math.round(trace.count ?? 8));
      const baseS = [];
      if (trace.shape === 'circle') {
        // A full 360° arc wraps (no seam endpoint); a partial arc is open.
        const isClosed = Math.abs((trace.arc || 360) - 360) < 1e-6;
        const denom = isClosed ? count : Math.max(1, count - 1);
        for (let i = 0; i < count; i++) {
          baseS.push((i / denom) * path.length);
        }
      } else if (count === 1) {
        // line / corner with a single light → place it at the path start.
        baseS.push(0);
      } else {
        // line / corner: open path, both endpoints included.
        for (let i = 0; i < count; i++) {
          baseS.push((i / (count - 1)) * path.length);
        }
      }
      return baseS;
    }

    // Update existing preview dots' positions + colours for a trace without a
    // full rebuild (used during live point drags).
    function refreshTraceDots(traceIndex) {
      const trace = params.traces[traceIndex];
      const tObj = window.traceObjects[traceIndex];
      if (!trace || !tObj) return;
      const pts = computeTracePoints(trace);
      const colors = computeTraceDotColors(pts);
      const dots = (tObj.visuals || []).filter(v => v.userData && v.userData.isTraceVisual && v.userData.pointIndex !== undefined);
      dots.forEach((dot) => {
        const k = dot.userData.pointIndex;
        if (k < pts.length) {
          dot.position.copy(pts[k]); // circle dots live in the group's local space
          if (dot.material) dot.material.color.set(colors[k]);
        }
      });
    }

    function generateGroupFromTrace(traceIndex, skipUndo = false) {
      const trace = params.traces[traceIndex];
      if (!trace) return;

      if (!skipUndo) pushUndo();

      // Remove existing lights from this trace's group name.
      // Regeneration contract with the controller mapping (operator
      // request 2026-06-12): names are stable per index ("<group> N"),
      // so survivors keep their chain entries and re-project to the
      // SAME addresses; fixtures lost to a count shrink just drop
      // (addresses are absolute — nothing shifts). New extras land
      // in the Unmapped tray.
      const groupName = trace.groupName || trace.name || `Trace ${traceIndex + 1}`;
      const previousGenerated = params.parLights.filter(l => l.group === groupName && l.traceGenerated);
      params.parLights = params.parLights.filter(l => l.group !== groupName || !l.traceGenerated);

      // Compute points
      const pts = computeTracePoints(trace);
      // Line AND corner produce world-space points (absolute coords).
      // Only circle points are local to a transformed group.
      const isWorldSpace = trace.shape === 'line' || trace.shape === 'corner';
      const grp = window.traceObjects[traceIndex]?.group;
      if (!isWorldSpace && grp) grp.updateMatrixWorld(true);
      const worldMatrix = (!isWorldSpace && grp) ? grp.matrixWorld : null;

      let lockedDeltaX = null;
      let lockedDeltaY = null;
      let lockedDeltaZ = null;

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
        } else if (trace.aimMode && trace.aimMode.includes('_locked')) {
          // Stage 1: Base orientation
          let forwardDir = new THREE.Vector3(0, 0, -1);
          let upVec = new THREE.Vector3(0, 1, 0);

          if (trace.shape === 'circle') {
             const center = new THREE.Vector3(0, 0, 0);
             const localOutward = pt.clone().sub(center);
             if (localOutward.lengthSq() < 0.001) localOutward.set(0, 0, -1);
             else localOutward.normalize();

             let outwardDir;
             if (worldMatrix) {
                const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);
                outwardDir = localOutward.applyMatrix3(normalMatrix).normalize();
                upVec = new THREE.Vector3(0, 1, 0).applyMatrix3(normalMatrix).normalize();
             } else {
                outwardDir = localOutward;
             }

             // Both lookAt_ and direction_ use outwardDir base to keep the physical bar (X axis) tangent to the curve
             forwardDir = outwardDir;
          } else if (trace.shape === 'line') {
             const start = worldMatrix ? pts[0].clone().applyMatrix4(worldMatrix) : pts[0].clone();
             const end = worldMatrix ? pts[pts.length - 1].clone().applyMatrix4(worldMatrix) : pts[pts.length - 1].clone();
             const lineDir = end.clone().sub(start).normalize();
             if (lineDir.lengthSq() < 0.001) lineDir.set(1, 0, 0);

             if (worldMatrix) {
                const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);
                upVec = new THREE.Vector3(0, 1, 0).applyMatrix3(normalMatrix).normalize();
             }

             // Both lookAt_ and direction_ use perpendicular outward layout to keep the bar (X axis) aligned with the line
             forwardDir = new THREE.Vector3().crossVectors(lineDir, upVec).normalize();
             if (forwardDir.lengthSq() < 0.001) forwardDir.set(0, 0, -1);
          }

          if (Math.abs(forwardDir.dot(upVec)) > 0.99) {
             upVec = new THREE.Vector3(0, 0, 1);
          }

          const baseQuat = new THREE.Quaternion().setFromRotationMatrix(
             new THREE.Matrix4().lookAt(worldPt, worldPt.clone().add(forwardDir), upVec)
          );
          const baseEuler = new THREE.Euler().setFromQuaternion(baseQuat, 'YXZ');

          const aimTarget = new THREE.Vector3(trace.aimX || 0, trace.aimY || 0, trace.aimZ || 0);
          const dir = aimTarget.clone().sub(worldPt).normalize();

          if (trace.aimMode.includes('xz_locked')) {
            rotX = THREE.MathUtils.radToDeg(baseEuler.x);
            rotZ = THREE.MathUtils.radToDeg(baseEuler.z);
            if (i === 0 || lockedDeltaY === null) {
                const flatDir = new THREE.Vector3(dir.x, 0, dir.z).normalize();
                if (flatDir.lengthSq() > 0.001) {
                   const aimedY = THREE.MathUtils.radToDeg(Math.atan2(-flatDir.x, -flatDir.z));
                   let diff = aimedY - THREE.MathUtils.radToDeg(baseEuler.y);
                   while (diff > 180) diff -= 360;
                   while (diff < -180) diff += 360;
                   lockedDeltaY = diff;
                } else {
                   lockedDeltaY = 0;
                }
            }
            rotY = THREE.MathUtils.radToDeg(baseEuler.y) + lockedDeltaY;
          } else if (trace.aimMode.includes('yz_locked')) {
            rotY = THREE.MathUtils.radToDeg(baseEuler.y);
            rotZ = THREE.MathUtils.radToDeg(baseEuler.z);
            if (i === 0 || lockedDeltaX === null) {
                const localDir = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -baseEuler.y);
                const flatDir = new THREE.Vector3(0, localDir.y, localDir.z).normalize();
                if (flatDir.lengthSq() > 0.001) {
                   const aimedX = THREE.MathUtils.radToDeg(Math.atan2(flatDir.y, -flatDir.z));
                   let diff = aimedX - THREE.MathUtils.radToDeg(baseEuler.x);
                   while (diff > 180) diff -= 360;
                   while (diff < -180) diff += 360;
                   lockedDeltaX = diff;
                } else {
                   lockedDeltaX = 0;
                }
            }
            rotX = THREE.MathUtils.radToDeg(baseEuler.x) + lockedDeltaX;
          } else if (trace.aimMode.includes('xy_locked')) {
            rotX = THREE.MathUtils.radToDeg(baseEuler.x);
            rotY = THREE.MathUtils.radToDeg(baseEuler.y);
            if (i === 0 || lockedDeltaZ === null) {
                let localDir = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -baseEuler.y);
                localDir.applyAxisAngle(new THREE.Vector3(1, 0, 0), -baseEuler.x);
                const flatDir = new THREE.Vector3(localDir.x, localDir.y, 0).normalize();
                if (flatDir.lengthSq() > 0.001) {
                   const aimedZ = THREE.MathUtils.radToDeg(Math.atan2(-flatDir.x, flatDir.y));
                   let diff = aimedZ - THREE.MathUtils.radToDeg(baseEuler.z);
                   while (diff > 180) diff -= 360;
                   while (diff < -180) diff += 360;
                   lockedDeltaZ = diff;
                } else {
                   lockedDeltaZ = 0;
                }
            }
            rotZ = THREE.MathUtils.radToDeg(baseEuler.z) + lockedDeltaZ;
          }
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
          traceGenerated: true,
          controllerIp: trace.controllerIp || '',
        });
      });

      trace.generated = true;

      // Count shrink: fixtures whose names no longer exist were
      // deleted — drop their mapping entries (the hook reprojects
      // and re-renders the panel itself).
      const survivingNames = new Set();
      for (let n = 1; n <= pts.length; n++) survivingNames.add(`${groupName} ${n}`);
      const regenCasualties = previousGenerated.filter(c => !survivingNames.has(c.name));
      if (window.controllerMappingFixturesRemoved) {
        window.controllerMappingFixturesRemoved(regenCasualties);
      }
      // Survivors are NEW config objects with the old names — re-run
      // the projection so they regain their derived patch fields
      // before the first render. (Redundant when the hook above found
      // mapped casualties and already reprojected — harmless.)
      if (window.__controllerRegistry && window.__controllerRegistry.controllers.length > 0 &&
          window.projectControllerMappings) {
        window.projectControllerMappings(gatherAllConfigs(params));
      }

      if (window._setGuiRebuilding) window._setGuiRebuilding(true);
      if (!window._isAppBooting) rebuildParLights(true);
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
      const btnStyle = 'flex:1;padding:4px 0;border:none;border-radius:3px;background:var(--control-bg);color:var(--caution);cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;';

      const newCircleBtn = document.createElement('button');
      newCircleBtn.textContent = '○ New Circle';
      newCircleBtn.style.cssText = btnStyle;
      newCircleBtn.onclick = () => {
        params.traces.push({
          name: `Circle ${params.traces.length + 1}`,
          shape: 'circle', radius: 5, arc: 360,
          count: 8, x: 0, y: 5, z: 0, rotX: 0, rotY: 0, rotZ: 0,
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
          count: 8,
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

      const newCornerBtn = document.createElement('button');
      newCornerBtn.textContent = '⌐ New Corner';
      newCornerBtn.style.cssText = btnStyle;
      newCornerBtn.onclick = () => {
        params.traces.push({
          name: `Corner ${params.traces.length + 1}`,
          shape: 'corner',
          startX: -5, startY: 5, startZ: 0,
          cornerX: 0, cornerY: 5, cornerZ: 0,
          endX: 0, endY: 5, endZ: 5,
          count: 8,
          aimMode: 'direction', aimX: 0, aimY: -1, aimZ: 0,
          lightColor: '#ffaa44', lightIntensity: 10, lightAngle: 30,
          groupName: `Corner ${params.traces.length + 1}`,
          fixtureType: 'UkingPar',
          generated: false,
        });
        rebuildTraceObjects();
        renderGeneratorGUI();
        debounceAutoSave();
      };

      newBtnDiv.appendChild(newCircleBtn);
      newBtnDiv.appendChild(newLineBtn);
      newBtnDiv.appendChild(newCornerBtn);

      // Remove old button bar if present
      const genChildren = genFolder.domElement.querySelector('.children');
      if (genChildren) {
        const oldBtns = genChildren.querySelector('.trace-new-btns');
        if (oldBtns) oldBtns.remove();
        newBtnDiv.classList.add('trace-new-btns');
        genChildren.prepend(newBtnDiv);
      }

      if (params.focusOnSelect === undefined) params.focusOnSelect = true;
      const existingFocusCtrl = genFolder.controllers.find(c => c.property === 'focusOnSelect');
      if (!existingFocusCtrl) {
        genFolder.add(params, 'focusOnSelect').name('Focus on Select').onChange(() => { debounceAutoSave(); });
      }

      if (params.generatorsVisible === undefined) params.generatorsVisible = true;
      const existingGenCtrl = genFolder.controllers.find(c => c.property === 'generatorsVisible');
      if (!existingGenCtrl) {
        genFolder.add(params, 'generatorsVisible').name('Show Generators').listen().onChange((v) => {
          if (window.setTraceObjectsVisibility) window.setTraceObjectsVisibility(v);
          debounceAutoSave();
        });
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

      // Per-shape glyph for folder labels (circle ○ / corner ⌐ / line —)
      const traceGlyph = (shape) =>
        shape === 'circle' ? '○' : (shape === 'corner' ? '⌐' : '—');

      // Trace sub-folders
      params.traces.forEach((trace, i) => {
        // lil-gui returns the SAME folder if titles match, breaking all click listeners.
        // Append invisible zero-width spaces (\u200B) to guarantee every label is unique.
        const baseLabel = `${traceGlyph(trace.shape)} ${trace.name || `Trace ${i+1}`}`;
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
          tFolder.title(`${traceGlyph(trace.shape)} ${trace.name}`);
          if (trace.generated) generateGroupFromTrace(i, true);
          debounceAutoSave();
        });

        // Fixture type selector
        if (!trace.fixtureType) trace.fixtureType = 'UkingPar';
        if (!trace.controllerIp) trace.controllerIp = '';
        const fixtureTypes = listTypes();
        if (fixtureTypes.length > 0) {
          tFolder.add(trace, 'fixtureType', fixtureTypes).name('Fixture Type').onChange(() => {
            if (trace.generated) generateGroupFromTrace(i, true);
            debounceAutoSave();
          });
        }
        tFolder.add(trace, 'controllerIp').name('🌐 Controller IP').onFinishChange(() => {
          if (trace.generated) generateGroupFromTrace(i, true);
          debounceAutoSave();
        });

        if (trace.shape === 'circle') {
          if (trace.radius === undefined) trace.radius = 5.0;
          if (trace.arc === undefined) trace.arc = 360;
          
          tFolder.add(trace, 'radius', 1, 50, 0.5).name('Radius').onChange(() => {
            updateTracePreview(i);
            debounceAutoSave();
          });
          tFolder.add(trace, 'arc', 10, 360, 5).name('Arc (°)').onChange(() => {
            updateTracePreview(i);
            debounceAutoSave();
          });
        } else if (trace.shape === 'corner') {
          // Corner: Start / Corner / End XYZ (mirrors the line's point folders)
          if (trace.startX === undefined) trace.startX = -5;
          if (trace.startY === undefined) trace.startY = 5;
          if (trace.startZ === undefined) trace.startZ = 0;
          if (trace.cornerX === undefined) trace.cornerX = 0;
          if (trace.cornerY === undefined) trace.cornerY = 5;
          if (trace.cornerZ === undefined) trace.cornerZ = 0;
          if (trace.endX === undefined) trace.endX = 0;
          if (trace.endY === undefined) trace.endY = 5;
          if (trace.endZ === undefined) trace.endZ = 5;

          const startF = tFolder.addFolder('Start Point (green)');
          startF.close();
          startF.add(trace, 'startX', -100, 100, 0.5).name('X').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          startF.add(trace, 'startY', -100, 100, 0.5).name('Y').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          startF.add(trace, 'startZ', -100, 100, 0.5).name('Z').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          const cornerF = tFolder.addFolder('Corner Point (blue)');
          cornerF.close();
          cornerF.add(trace, 'cornerX', -100, 100, 0.5).name('X').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          cornerF.add(trace, 'cornerY', -100, 100, 0.5).name('Y').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          cornerF.add(trace, 'cornerZ', -100, 100, 0.5).name('Z').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          const endF = tFolder.addFolder('End Point (red)');
          endF.close();
          endF.add(trace, 'endX', -100, 100, 0.5).name('X').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          endF.add(trace, 'endY', -100, 100, 0.5).name('Y').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          endF.add(trace, 'endZ', -100, 100, 0.5).name('Z').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
        } else {
          // Line: Start/End XYZ
          if (trace.startX === undefined) trace.startX = -10;
          if (trace.startY === undefined) trace.startY = 0;
          if (trace.startZ === undefined) trace.startZ = 0;
          if (trace.endX === undefined) trace.endX = 10;
          if (trace.endY === undefined) trace.endY = 0;
          if (trace.endZ === undefined) trace.endZ = 0;

          const startF = tFolder.addFolder('Start Point (green)');
          startF.close();
          startF.add(trace, 'startX', -100, 100, 0.5).name('X').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          startF.add(trace, 'startY', -100, 100, 0.5).name('Y').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          startF.add(trace, 'startZ', -100, 100, 0.5).name('Z').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          const endF = tFolder.addFolder('End Point (red)');
          endF.close();
          endF.add(trace, 'endX', -100, 100, 0.5).name('X').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          endF.add(trace, 'endY', -100, 100, 0.5).name('Y').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
          endF.add(trace, 'endZ', -100, 100, 0.5).name('Z').onChange(() => { updateTracePreview(i); debounceAutoSave(); });
        }

        // Lights (count) — the user sets the number of lights directly.
        // This replaces the legacy spacing slider; COUNT is authoritative.
        if (trace.count === undefined) trace.count = 8;
        const lightPts = computeTracePoints(trace);
        const countInfo = { count: `${lightPts.length} lights` };
        const countCtrl = tFolder.add(countInfo, 'count').name('Preview').disable();

        tFolder.add(trace, 'count', 1, 200, 1).name('Lights').onChange(() => {
          const pts = computeTracePoints(trace);
          countInfo.count = `${pts.length} lights`;
          countCtrl.updateDisplay();
          updateTracePreview(i);
          if (trace.generated) generateGroupFromTrace(i, true);
          debounceAutoSave();
        });

        // Reset point offsets — clears any per-point drags so the lights
        // snap back to the even distribution (and the gradient back to green).
        const resetOffDiv = document.createElement('div');
        resetOffDiv.style.cssText = 'padding:2px 6px;';
        const resetOffBtn = document.createElement('button');
        resetOffBtn.textContent = '⤺ Reset point offsets';
        resetOffBtn.title = 'Snap all lights back to even spacing along the path';
        resetOffBtn.style.cssText = 'width:100%;padding:4px 0;border:none;border-radius:3px;background:var(--control-bg);color:var(--secondary);cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;';
        resetOffBtn.onclick = (e) => {
          if (e) e.stopPropagation();
          trace.pointOffsets = [];
          updateTracePreview(i);
          if (trace.generated) generateGroupFromTrace(i, true);
          debounceAutoSave();
          resetOffBtn.blur();
        };
        resetOffDiv.appendChild(resetOffBtn);
        const spacingChildren = tFolder.domElement.querySelector('.children');
        if (spacingChildren) spacingChildren.appendChild(resetOffDiv);

        // Aim mode
        if (trace.aimMode === undefined) trace.aimMode = 'lookAt';
        if (trace.aimMode === 'xz_locked') trace.aimMode = 'lookAt_xz_locked';
        if (trace.aimMode === 'yz_locked') trace.aimMode = 'lookAt_yz_locked';
        if (trace.aimMode === 'xy_locked') trace.aimMode = 'lookAt_xy_locked';
        const aimModes = [
          'lookAt', 'lookAt_xy_locked', 'lookAt_xz_locked', 'lookAt_yz_locked',
          'direction', 'direction_xy_locked', 'direction_xz_locked', 'direction_yz_locked'
        ];
        tFolder.add(trace, 'aimMode', aimModes).name('Aim Mode').onChange(() => {
          if (trace.generated) generateGroupFromTrace(i, true);
          debounceAutoSave();
        });

        // Select Aim Target button
        const aimBtnDiv = document.createElement('div');
        aimBtnDiv.style.cssText = 'padding:2px 6px;';
        const aimBtn = document.createElement('button');
        aimBtn.textContent = '🎯 Select Aim Target';
        aimBtn.style.cssText = 'width:100%;padding:4px 0;border:none;border-radius:3px;background:color-mix(in srgb, var(--caution) 15%, var(--surface));color:var(--caution);cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;';
        aimBtn.onclick = (e) => {
          if (e) e.stopPropagation();
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
        if (trace.lightColor === undefined) trace.lightColor = '#ffffff';
        if (trace.lightIntensity === undefined) trace.lightIntensity = 100;
        if (trace.lightAngle === undefined) trace.lightAngle = 45;

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
        lockBtn.style.cssText = aBtnStyle + (trace.locked ? 'background:color-mix(in srgb, var(--caution) 15%, var(--surface));color:var(--caution);' : 'background:var(--control-bg);color:var(--secondary);');
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
        genBtn.style.cssText = aBtnStyle + 'background:color-mix(in srgb, var(--ok) 15%, var(--surface));color:var(--ok);';
        genBtn.onclick = () => {
          // Check for custom DMX patches before regenerating. Under an
          // active controller mapping this warning is moot: patches are
          // PROJECTED, names are stable per index, so survivors re-derive
          // the same addresses and a count shrink leaves reserved gaps.
          const cmActive = window.__controllerRegistry &&
            window.__controllerRegistry.controllers.length > 0;
          if (trace.generated && !cmActive) {
            const groupName = trace.groupName || trace.name;
            const patchedFixtures = params.parLights.filter(l =>
              l.group === groupName && l.traceGenerated && (l.dmxUniverse > 0 || l.dmxAddress > 0)
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
          genBtn.style.cssText = aBtnStyle + 'background:var(--surface-container-low);color:var(--icon);cursor:not-allowed;';
        }

        const delBtn = document.createElement('button');
        delBtn.textContent = '✕ Delete';
        delBtn.style.cssText = aBtnStyle + 'background:color-mix(in srgb, var(--error) 15%, var(--surface));color:var(--error);';
        delBtn.onclick = () => {
          pushUndo();
          const trace = params.traces[i];
          // Remove generated lights from this trace's group
          if (trace) {
            const groupName = trace.groupName || trace.name;
            const removedConfigs = params.parLights.filter(l => l.group === groupName && l.traceGenerated);
            params.parLights = params.parLights.filter(l => !(l.group === groupName && l.traceGenerated));
            // Mapped fixtures deleted with the trace → their mapping
            // entries drop; addresses are absolute, nothing shifts.
            if (window.controllerMappingFixturesRemoved) {
              window.controllerMappingFixturesRemoved(removedConfigs);
            }
          }
          params.traces.splice(i, 1);
          if (window._setGuiRebuilding) window._setGuiRebuilding(true);
          if (!window._isAppBooting) rebuildParLights(true);
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
      if (params.dmxEnabled === undefined) params.dmxEnabled = true;
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
      dmxToolbarDiv.style.cssText = 'display:flex;gap:4px;padding:4px 8px;border-bottom:1px solid var(--ghost-border);margin-bottom:4px;';
      
      const typeSelect = document.createElement('select');
      typeSelect.style.cssText = 'flex:1;padding:4px;border:1px solid var(--ghost-border);border-radius:4px;background:var(--input-bg);color:var(--text);font-size:11px;';
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
      aBtn.style.cssText = 'flex:1;padding:4px 0;border:1px solid var(--ghost-border);border-radius:4px;background:color-mix(in srgb, var(--text) 10%, transparent);color:var(--text);cursor:pointer;font-size:11px;';
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
          // Include fixture definition registry types
          const regTypes = listTypes ? listTypes() : [];
          regTypes.forEach(t => { typeOptions[t] = t; });
          if (window.fixtureModels) {
            for (const [k, v] of Object.entries(window.fixtureModels)) {
              const friendlyName = v.name || k;
              typeOptions[friendlyName] = k;
            }
          }
          const currentVal = config.type || config.fixtureType;
          if (currentVal && !Object.values(typeOptions).includes(currentVal)) {
            typeOptions[currentVal] = currentVal;
          }
          if (Object.keys(typeOptions).length === 0) typeOptions['Default'] = 'VintageLed';

          // map legacy fixtureType to type
          if (!config.type && config.fixtureType) config.type = config.fixtureType;
          idxFolder.add(config, "type", typeOptions).name("Fixture Model").onChange((v) => {
            config.fixtureType = v; // keep it synced
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
          idxFolder.add(config, "angle", 5, 90, 1).onChange((v) => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });
          idxFolder.add(config, "penumbra", 0, 1, 0.05).onChange((v) => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });

          const posFolder = idxFolder.addFolder("Position");
          posFolder.close();
          posFolder.add(config, "x", -200, 200, 0.01).onChange(() => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });
          posFolder.add(config, "y", 0, 100, 0.01).onChange(() => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });
          posFolder.add(config, "z", -200, 200, 0.01).onChange(() => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });

          const rotFolder = idxFolder.addFolder("Rotation");
          rotFolder.close();
          const step = params.snapAngle || 5;
          rotFolder.add(config, "rotX", -180, 180, step).onChange(() => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });
          rotFolder.add(config, "rotY", -180, 180, step).onChange(() => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });
          rotFolder.add(config, "rotZ", -180, 180, step).onChange(() => {
            selectThisLight(); window.syncDmxFromConfig(index);
          });

          // 🔖 Metadata (V2) — compact DOM panel (shared helper). Required so
          // sectionId/fixtureId/viewMask written to the model export are
          // operator-visible and editable for DMX instances too.
          const idxChildrenForMeta = idxFolder.domElement.querySelector('.children');
          appendMetadataPanelV2(idxChildrenForMeta, config, { onChange: debounceAutoSave });

          const actDiv = document.createElement('div');
          actDiv.style.cssText = 'display:flex;gap:2px;padding:2px 6px 4px;';
          const aBtnStyle = 'flex:1;padding:2px 0;border:none;border-radius:3px;background:var(--control-bg);color:var(--secondary);cursor:pointer;font-size:10px;font-family:inherit;';

          const rmBtn = document.createElement('button');
          rmBtn.textContent = '✕ Remove';
          rmBtn.style.cssText = aBtnStyle;
          rmBtn.onclick = () => {
            pushUndo();
            const removed = params.dmxFixtures[index];
            params.dmxFixtures.splice(index, 1);
            // Mapped fixture deleted → its mapping entry drops;
            // addresses are absolute, so nothing else shifts.
            if (window.controllerMappingFixturesRemoved) {
              window.controllerMappingFixturesRemoved([removed]);
            }
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
      const btnStyle = 'flex:1;padding:4px 0;border:none;border-radius:3px;background:var(--control-bg);color:var(--ok);cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;';
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
        startF.add(strand, 'startX', -100, 100, 0.5).name('X').onChange(() => { rebuildLedStrands(); debounceAutoSave(); });
        startF.add(strand, 'startY', -100, 100, 0.5).name('Y').onChange(() => { rebuildLedStrands(); debounceAutoSave(); });
        startF.add(strand, 'startZ', -100, 100, 0.5).name('Z').onChange(() => { rebuildLedStrands(); debounceAutoSave(); });
        const endF = sFolder.addFolder('End Point (red)');
        endF.close();
        endF.add(strand, 'endX', -100, 100, 0.5).name('X').onChange(() => { rebuildLedStrands(); debounceAutoSave(); });
        endF.add(strand, 'endY', -100, 100, 0.5).name('Y').onChange(() => { rebuildLedStrands(); debounceAutoSave(); });
        endF.add(strand, 'endZ', -100, 100, 0.5).name('Z').onChange(() => { rebuildLedStrands(); debounceAutoSave(); });

        // 🔖 Metadata (V2) — compact DOM panel (shared helper)
        const sChildrenForMeta = sFolder.domElement.querySelector('.children');
        appendMetadataPanelV2(sChildrenForMeta, strand, { onChange: debounceAutoSave });

        // Delete button
        const actDiv = document.createElement('div');
        actDiv.style.cssText = 'display:flex;gap:2px;padding:4px 6px;';
        const delBtn = document.createElement('button');
        delBtn.textContent = '✕ Delete';
        delBtn.style.cssText = 'flex:1;padding:4px 0;border:none;border-radius:3px;background:color-mix(in srgb, var(--error) 15%, var(--surface));color:var(--error);cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;';
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

  // ─── Build the entire GUI from the config tree ───
  if (configTree) {
    const urlParams = new URLSearchParams(window.location.search);
    const profileOverride = urlParams.get('profile');
    if (profileOverride && configTree.options && configTree.options.lightingProfile) {
      configTree.options.lightingProfile.value = profileOverride;
      params.lightingProfile = profileOverride;
    }

    const rendererOverride = urlParams.get('renderer');
    if ((rendererOverride === 'webgpu' || rendererOverride === 'webgl') && configTree.options && configTree.options.rendererMode) {
      configTree.options.rendererMode.value = rendererOverride;
      params.rendererMode = rendererOverride;
    }
    
    buildGUI(configTree, gui);
  }

  // Apply initial handlers so visual states immediately map on load
  if (window.applyAllHandlers) {
    window.applyAllHandlers();
  }

  // ─── Premium Save Button ───
  const saveDiv = document.createElement('div');
  saveDiv.style.cssText = 'padding:10px 6px 6px;';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾  Save Configuration';
  saveBtn.style.cssText = 'width:100%;min-height:38px;padding:12px 16px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;line-height:1;border:1px solid color-mix(in srgb, var(--ok) 25%, transparent);border-radius:8px;background:color-mix(in srgb, var(--ok) 12%, transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:var(--ok);cursor:pointer;font-size:12px;font-family:var(--font-headline);font-weight:600;letter-spacing:0.05em;transition:all 0.3s ease;box-shadow:inset 0 1px 0 color-mix(in srgb, var(--text) 6%, transparent),0 2px 8px var(--ambient-shadow);';
  saveBtn.onmouseenter = () => { saveBtn.style.borderColor = 'color-mix(in srgb, var(--ok) 50%, transparent)'; saveBtn.style.background = 'color-mix(in srgb, var(--ok) 20%, transparent)'; saveBtn.style.color = 'var(--ok)'; saveBtn.style.boxShadow = 'inset 0 1px 0 color-mix(in srgb, var(--text) 10%, transparent),0 4px 16px color-mix(in srgb, var(--ok) 12%, transparent)'; };
  saveBtn.onmouseleave = () => { saveBtn.style.borderColor = 'color-mix(in srgb, var(--ok) 25%, transparent)'; saveBtn.style.background = 'color-mix(in srgb, var(--ok) 12%, transparent)'; saveBtn.style.color = 'var(--ok)'; saveBtn.style.boxShadow = 'inset 0 1px 0 color-mix(in srgb, var(--text) 6%, transparent),0 2px 8px var(--ambient-shadow)'; };
  saveBtn.onclick = () => { exportConfig(); };
  saveDiv.appendChild(saveBtn);

  // Views panel toggle — named views / group bits editor (views.yaml)
  const viewsBtn = document.createElement('button');
  viewsBtn.textContent = '👁  Views';
  viewsBtn.style.cssText = 'width:100%;min-height:30px;margin-top:6px;padding:8px 16px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;line-height:1;border:1px solid color-mix(in srgb, var(--primary) 25%, transparent);border-radius:8px;background:color-mix(in srgb, var(--primary) 10%, transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:var(--primary);cursor:pointer;font-size:11px;font-family:var(--font-headline);font-weight:600;letter-spacing:0.05em;transition:all 0.3s ease;';
  viewsBtn.onclick = () => { if (window.toggleViewMasksPanel) window.toggleViewMasksPanel(); };
  saveDiv.appendChild(viewsBtn);

  // Controller mapping panel toggle — hardware topology editor
  // (controllers.yaml, docs/33). The only place patch fields are edited.
  const controllersBtn = document.createElement('button');
  controllersBtn.textContent = '🎛  Controllers';
  controllersBtn.style.cssText = 'width:100%;min-height:30px;margin-top:6px;padding:8px 16px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;line-height:1;border:1px solid color-mix(in srgb, var(--tint) 25%, transparent);border-radius:8px;background:color-mix(in srgb, var(--tint) 10%, transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:var(--tint);cursor:pointer;font-size:11px;font-family:var(--font-headline);font-weight:600;letter-spacing:0.05em;transition:all 0.3s ease;';
  controllersBtn.onclick = () => { if (window.toggleControllerMapPanel) window.toggleControllerMapPanel(); };
  saveDiv.appendChild(controllersBtn);

  const guiChildren = gui.domElement.querySelector('.children');
  if (guiChildren) guiChildren.appendChild(saveDiv);

  // ─── Small Screen Auto-Collapse ───
  // On phones/tablets, close the GUI panel so it doesn't obscure the 3D viewport.
  // The user can still tap the title bar to expand it.
  if (window.innerWidth <= 768) {
    gui.close();
  }
}
