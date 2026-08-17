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
import {
  traceRenameError, sweepGeneratedInstances, carryTraceGroupOverride,
} from "./trace_group_rename.js";
import { traceVisualsShouldShow } from "./trace_visual_gate.js";
import {
  PIXEL_ORDER_REVERSED, isReversed, carryPixelOrderEntries, clearCasualtyPixelOrder,
  casualtyClearMessage, reversedMembers, validatePixelOrderStore,
} from "../dmx/pixel_order_store.js";
import { rebuildParLights, rebuildDmxFixtures } from "../core/fixtures.js";
import { deselectAllFixtures, nextFixtureName, syncGuiFolders } from "../core/interaction.js";
import { listTypes, getDefinition } from "../dmx/fixture_definition_registry.js";
import {
  chainSplitsError, emitInChainOrder, describeChainOrder,
  fullReverseSplits, isFullReverse,
} from "../dmx/generator_chain_order.js";
import {
  CHAIN_JUMP_COLOR, buildChainRuns, chainJumpSegments, chainLabelPlan, cometMix,
} from "../dmx/chain_order_visual.js";
import { clearMetadata, gatherAllConfigs } from "../dmx/auto_patcher.js";
import {
  markTraceRegenDirty, markStrandTransformDirty, takePendingRegens,
} from "../dmx/trace_regen_scheduler.js";
import {
  traceAnchor, traceFocusPoint, traceUsesWorldSpacePath, anchorDelta,
} from "../dmx/trace_anchor.js";
import {
  detectResnappedFixtures, resnapMessage,
} from "../dmx/generator_hand_tweaks.js";
import { showToast } from "./controller_map_editor.js";
import { checkSubscribedUniversesBeforeSave } from "./subscribed_universes_prompt.js";
import {
  invalidateFixtureMappings, describeFixtureMappings,
} from "../dmx/controller_registry.js";
import {
  generatedFixtureNames, renamePairs, carryViewMasks, duplicateNameError,
  buildInvalidationReport, snapshotViewMasks,
} from "../dmx/rename_invalidation.js";
import { fixtureInView, fixtureMaskField } from "../dmx/view_registry.js";
import {
  collectSceneGroupNames, groupRenameError, buildGroupRenameReport,
} from "../dmx/group_rename_guard.js";
import {
  findOrphanFixtures, orphanGroupSummary, isOrphanFixture, generatorGroupNames,
  allSceneRecords, enumerateOrphanDependents, buildOrphanDeleteConfirm,
  buildEnumerationRefusal, buildStaleOrphanRefusal, buildRemovalReport,
} from "../dmx/orphan_fixtures.js";
import {
  renameGroupInPixelMapViews, removeFixtureFromPixelMapViews, pixelMapViewsSource,
} from "./pixel_map/pixel_map_store.js";
import { getProfileDef, getProfileRebuildKey } from "../core/profile_registry.js";
import {
  MAX_SPOTLIGHT_POOL_SIZE,
  clampPersistedSpotlightBudget,
  getSpotlightSessionCeiling,
  getSpotlightSliderMax,
  isSpotlightSessionCeilingRaised,
  showSpotlightCountWarning,
} from "../core/light_pool.js";
import {
  DEFAULT_SPOTLIGHT_SAMPLING_MODE,
  SPOTLIGHT_SAMPLING_MODES,
  resolveSpotlightSamplingMode,
} from "../core/spotlight_sampling.js";
import { applySimulationSurfaceReflectanceToMaterial } from "../core/sim_preview.js";
import { DmxFixtureRuntime } from "../fixtures/dmx_fixture_runtime.js";
import { isStaticHost, logStaticHostSkip } from "../core/static_host.js";
import { ModelFixture } from "../fixtures/model_fixture.js";
import { LedStrand } from "../fixtures/led_strand.js";
import { LOCAL_HALO_SCALE_MIN, LOCAL_HALO_SCALE_MAX } from "../fixtures/led_halo.js";
import { applyTeSignPlacement } from "../fixtures/te_sign_generator.js";
import {
  isGroupLocked, parGroupMemberIndices, strandGroupMemberIndices, isTeSignConfigs,
} from "../core/group_lock.js";
import {
  LED_GENERATORS, uniqueGroupName, runLedGenerator,
} from "../fixtures/led_generator_catalog.js";
import { showModal } from "./scene_manager.js";
// DISPLAY ORDER ONLY (operator, 2026-07-30: "in the menu for the instances and
// generator lists for dmx and LED too — sort by name"). Every menu list below
// renders through these helpers; the scene arrays they read (params.parLights,
// params.traces, params.ledStrands, params.dmxFixtures) keep their own order, so
// chain order, patch derivation and YAML serialization are byte-identical. The
// ONE shared comparator — a second copy is how two "sorted by name" lists start
// disagreeing, and a per-item localeCompare is the perf bug report _50 fixed.
import { sortNamesNatural, sortByNameNatural } from "../core/natural_sort.js";
import { updateFloodLights } from "../core/flood_lights.js";
import { engineHttpUrl } from "../core/engine_endpoint.js";
import { saveHttpUrl } from "../core/save_endpoint.js";

// NOTE: engineEnabled / lightingEnabled / lightingMode live in state.js.
// Use the setters imported above to update them so animate.js sees changes.
const OPTIONS_SPOTLIGHT_PREVIEW_KEYS = ["masterExposure", "maxSpotlights", "simBrightness", "simSurfaceReflectance"];

// A fixture config is "LED-class" when its fixture-type definition rides the LED
// bus (bus:'led' — Ango 4 pixel controller), e.g. the TE Sign V3 halves. These
// stay in params.parLights (so their DMX patching / group / A≡B-transform
// machinery is byte-for-byte unchanged) but are HOMED under the "LED Fixtures"
// drawer section, per the operator ruling "TE Sign = LED type". DMX-bus fixtures
// stay under "DMX Fixtures". A missing definition ⇒ treated as DMX (the registry
// defaults bus to 'dmx'), so legacy scenes are unaffected.
function isLedClassConfig(config) {
  if (!config || !config.fixtureType) return false;
  const def = getDefinition(config.fixtureType);
  return !!def && def.bus === 'led';
}

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
  // Both view words — `viewMaskHi` (word 1) is where the allocator puts new
  // custom views, so it is as much a first-class fixture field as `viewMask`.
  if (config.viewMask === undefined) config.viewMask = 0;
  if (config.viewMaskHi === undefined) config.viewMaskHi = 0;

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
  // own bit IN THE VIEW'S WORD (`viewMask` / `viewMaskHi`) OR its group
  // being attached to the view.
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
      const byBit = fixtureInView(config, view);
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

/**
 * The ONE clear-and-warn path for pixel-order flags whose fixture just went away
 * (generator count shrink, group delete, any other sweep casualty). Design
 * 20260806_174 §2.3: never silently keep the entry — it would resurrect onto a
 * brand-new physical light if the group regrows — and never silently drop it:
 * the console line + toast ARE the operator notice.
 *
 * @param {string} groupLabel   the group the casualties belonged to
 * @param {string[]} casualtyNames names of the removed fixtures
 * @returns {string[]} the flags that were cleared (empty = nothing to say)
 */
function clearPixelOrderCasualties(groupLabel, casualtyNames) {
  const cleared = clearCasualtyPixelOrder(params.pixelOrder, casualtyNames);
  if (cleared.length === 0) return [];
  const names = cleared.map((c) => c.name);
  const message = casualtyClearMessage(groupLabel, names);
  console.warn(`[pixelOrder] ${message}`);
  if (!window._isAppBooting) showToast(message, { ttl: 14000 });
  return names;
}

/**
 * Every DMX/par fixture the pixel-order store can legally key on, with the pixel
 * count of its DEFINITION — the input to validatePixelOrderStore. A fixture type
 * with no registered definition contributes a `null` count: unknown is not
 * "single pixel", so it can neither be flagged stale nor refused as a par here
 * (the exporter is the authority on real pixel counts).
 *
 * @returns {Array<{name: string, pixelCount: number|null}>}
 */
function pixelOrderFixtureCensus() {
  const list = (params.dmxFixtures && params.dmxFixtures.length > 0)
    ? params.dmxFixtures : params.parLights;
  const out = [];
  for (const light of list || []) {
    if (!light || !light.name) continue;
    const def = getDefinition(light.type || light.fixtureType || '');
    out.push({
      name: light.name,
      pixelCount: def && Array.isArray(def.pixels) ? def.pixels.length : null,
    });
  }
  return out;
}

/**
 * The pixel-order entries that name no fixture in this scene — QUIET (the panel
 * re-renders constantly and must not spam the console). Must only be called once
 * the trace auto-regeneration has run, or every generated fixture looks missing.
 * An invalid value / single-pixel entry throws out of the validator; here that
 * is reported once as an error and treated as "nothing to GC", never as a
 * reason to hide the panel.
 *
 * @returns {string[]}
 */
function pixelOrderStaleNames() {
  try {
    const result = validatePixelOrderStore(params.pixelOrder, pixelOrderFixtureCensus());
    return result.stale;
  } catch (err) {
    console.error(`[pixelOrder] ${err.message}`);
    return [];
  }
}

/**
 * The LOUD validation pass (design §2.7): at boot — strictly after the trace
 * auto-regenerate — and at every save. Stale entries are reported and LEFT
 * ALONE (removal is the explicit 🧹 gesture); an invalid value or an entry on a
 * single-pixel fixture is reported as an error + toast without crashing the boot
 * render, and the save's model export refuses it again, there, fatally.
 *
 * @param {string} context  where this pass ran, for the log line
 * @returns {string[]} stale entry names
 */
function reportPixelOrderStore(context) {
  // A malformed top-level `pixelOrder:` (scalar/array/null hand edit) never
  // reaches params.pixelOrder — config.js records it instead. Surface it HERE
  // as a visible sim warning; during boot the toast is deferred past the
  // boot window (boot suppresses toasts) instead of being dropped.
  if (params.pixelOrderMalformed !== undefined) {
    const malformedMsg = `scene_config.yaml "pixelOrder:" is malformed (got ` +
      `${params.pixelOrderMalformed}) — expected a map of {"<fixture name>": reversed}. ` +
      `It is IGNORED and will be dropped on the next save.`;
    console.error(`[pixelOrder] (${context}) ${malformedMsg}`);
    const toastMalformed = () => showToast(`⚠ ${malformedMsg}`, { ttl: 14000 });
    if (window._isAppBooting) setTimeout(toastMalformed, 2500);
    else toastMalformed();
  }
  let result;
  try {
    result = validatePixelOrderStore(params.pixelOrder, pixelOrderFixtureCensus());
  } catch (err) {
    console.error(`[pixelOrder] (${context}) ${err.message}`);
    if (!window._isAppBooting) showToast(`⚠ ${err.message}`, { ttl: 14000 });
    return [];
  }
  if (result.stale.length > 0) {
    console.warn(`[pixelOrder] (${context}) ${result.stale.length} stale entry/entries name ` +
      `no fixture in this scene: ${result.stale.join(', ')} — they do nothing. Use ` +
      '"🧹 Clear stale pixel-order entries" in the fixtures panel to remove them.');
    if (!window._isAppBooting) {
      showToast(`⚠ ${result.stale.length} stale pixel-order entry/entries (see console) — ` +
        'clear them with 🧹 in the fixtures panel.', { ttl: 9000 });
    }
  }
  return result.stale;
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
  /**
   * The full scene save: model + view-mask sidecar export, then POST the
   * serialized YAML to the save server, then the post-save resyncs.
   *
   * AWAITABLE (slice S1, report 20260725_58 §6). Returns a promise that
   * RESOLVES to `{ ok: boolean, reason?: string }` and NEVER rejects: every
   * existing caller is fire-and-forget (debounceAutoSave, GUI buttons,
   * controller_map_editor's 💾) and a rejecting promise would turn each of
   * them into an unhandled rejection, while the callers that DO need to
   * sequence on the save — the LED per-output push, which is only "done" once
   * the mapping is on disk — need the failure as data they can render, not as
   * an exception to swallow. `ok:false` is returned for EVERY path that leaves
   * nothing new on disk (booting, mid-rebuild, model-export abort, static
   * host, a non-200 from the save server), each with a verbatim reason.
   *
   * There is no `force` argument: exportConfig never consulted
   * `params.autoSave` — that gate lives in debounceAutoSave. Calling this
   * directly IS the forced save, and it does not arm the debounce.
   *
   * `options.interactive` (default TRUE) is the ONE knob: it says whether this
   * save may put a dialog in front of the operator. Every operator-initiated
   * save — the controller pane's 💾, the Lighting Controls 💾, the LED push's
   * scene write — leaves it at the default, so ALL of them behave identically
   * (one save path = one behavior). Only debounceAutoSave's 2 s timer passes
   * `false`, because a modal that appears while the operator is orbiting the
   * camera is worse than a warning he reads on his next explicit save.
   *
   * @param {{interactive?: boolean}} [options]
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async function exportConfig(options = {}) {
    const interactive = options.interactive !== false;
    if (window._isAppBooting) {
      return { ok: false, reason: 'the app is still booting — nothing was saved' };
    }
    if (window._isRebuildingFixtures) {
      // Never silently drop a save: the rebuild path re-arms the
      // debounce when it finishes, but belt-and-braces retry here too —
      // a swallowed save is exactly how stale scenes shipped on-site.
      setTimeout(() => { if (window.debounceAutoSave) window.debounceAutoSave(true); }, 500);
      return { ok: false,
        reason: 'fixtures are rebuilding — the save was deferred to the auto-save retry, ' +
          'nothing is on disk yet' };
    }

    // ── 📡 Subscribed Universes gate (report 20260725_86) ───────────────
    // BEFORE the first byte is written: the sACN-IN bridge builds its receiver
    // accept-list at boot from `colorWave.sacn_universes`, and the `sacn`
    // package DROPS packets on unsubscribed universes with no event at all —
    // a field that has fallen behind the mapping is dark fixtures and a clean
    // bill of health everywhere else (reports _58 §7.1 layer 6, _60). This
    // recomputes the universes the configuration actually uses and, when the
    // field is short, asks Yes / No / Cancel. 'cancel' must still mean
    // "nothing on disk", so it runs ahead of saveModelJS().
    let universeGate;
    try {
      universeGate = await checkSubscribedUniversesBeforeSave({ interactive });
    } catch (err) {
      // The required set could not be derived (no registry, malformed
      // mapping). Saving anyway would write a scene whose subscription field
      // we could not verify — the exact silent-dark shape this gate exists to
      // close — so refuse loudly instead (codex P0: no fallbacks).
      console.error('Subscribed-universes check failed — config save aborted:', err);
      showSaveToast(`⚠ SAVE ABORTED — universe check failed: ${err.message}`, true);
      return { ok: false,
        reason: `subscribed-universes check failed — nothing saved: ${err.message}` };
    }
    if (!universeGate.proceed) {
      showSaveToast('Save cancelled — nothing was written', true);
      return { ok: false, reason: 'the operator cancelled at the 📡 Subscribed Universes prompt' };
    }

    // Pixel-order store: report stale entries on every save (design §2.7).
    // Purely informational — stale entries are inert and never block a save. An
    // INVALID value is a different matter: saveModelJS below throws on it and
    // aborts the whole save, which is the loud refusal the design asks for.
    reportPixelOrderStore('save');

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
      return { ok: false, reason: `model/sidecar export failed — nothing saved: ${err.message}` };
    }

    reconstructYAML(configTree);
    // reconstructYAML just copied params.maxSpotlights into the tree. If this
    // session runs an operator-accepted over-cap budget, that number must not
    // reach disk — an over-cap budget is granted per session, by an explicit
    // prompt, and a saved copy would resurrect it on the next boot with no
    // consent asked. Clamp before anything serializes the tree.
    clampPersistedSpotlightBudget(configTree);
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
      return { ok: false,
        reason: 'static host — the save server (port 6970) is not reachable, nothing was written' };
    }
    try {
      const res = await fetch(saveHttpUrl(`/save${sceneParam}`), {
        method: "POST",
        body: yamlStr,
      });
      if (!res.ok) throw new Error(`save server responded ${res.status}`);
      console.log(`Config saved${window.__activeScene ? ` (scene: ${window.__activeScene})` : ''}`);
      _setSceneDirty(false);
      showSaveToast();
      // Tell the bridge to re-read the patches.yaml we just wrote — this is
      // what makes "a save alone is sufficient" true (report _58 §6). AWAITED
      // and LOUD (slice S4): the save landing while the notify silently failed
      // is the exact shape of the operator's dark-LED day — disk fresh, feed
      // stale, every surface green. notifySacnBridgeLoud never rejects, so the
      // catch below can still only mean "the save itself failed".
      if (window.PatchManager) await window.PatchManager.notifySacnBridgeLoud();
      // Resync every fixture card's "Views:" chips with the
      // just-persisted registry + membership state.
      if (window.refreshMetadataPanels) window.refreshMetadataPanels();
      if (window.refreshViewMasksPanel) window.refreshViewMasksPanel();
      return { ok: true };
    } catch (err) {
      // Stay dirty: the indicator keeps shouting until a save lands.
      console.error("Failed to write config:", err);
      showSaveToast('⚠ SAVE FAILED — changes NOT on disk', true);
      return { ok: false, reason: err.message };
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
  // Published for the non-GUI modules that must shout at the operator through
  // the same surface the save uses (slice S4: PatchManager's save/notify
  // failures). Keep the signature `(message, isError)`.
  window.showSaveToast = showSaveToast;

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

  // Flush the newest serialized config to the save server via sendBeacon —
  // the only transport guaranteed to survive a page unload. Shared by the
  // accidental-close guard (beforeunload) and by intentional in-app
  // navigations (e.g. a scene switch) that flush deliberately. Returns true
  // if there was pending work that we attempted to flush.
  function flushPendingSaveBeacon() {
    const pendingSave = window.__sceneDirty || !!saveTimeout;
    if (!pendingSave || window._isAppBooting || isStaticHost()) return false;
    try {
      if (!window._isRebuildingFixtures) {
        reconstructYAML(configTree);
        // Same session-only clamp as exportConfig(): the unload beacon is a
        // save, so it may not carry an accepted over-cap budget to disk either.
        clampPersistedSpotlightBudget(configTree);
        window.__lastConfigYaml = yaml.dump(configTree, { lineWidth: -1, noCompatMode: true });
      }
      if (window.__lastConfigYaml && navigator.sendBeacon) {
        const sceneParam = window.__activeScene ? `?scene=${window.__activeScene}` : '';
        navigator.sendBeacon(saveHttpUrl(`/save${sceneParam}`),
          new Blob([window.__lastConfigYaml], { type: 'text/plain' }));
      }
    } catch (err) {
      console.error('Unload flush failed:', err);
    }
    return true;
  }

  // Intentional in-app navigation (scene switch) helper: flush any pending
  // save, then DISARM the accidental-close guard so the beforeunload handler
  // below no-ops and the browser never raises its blocking "Leave site?"
  // dialog. Without this, switching scene while the config is dirty popped
  // the native confirm prompt, which silently stalled the reload — the sim
  // appeared frozen on the old scene with stale/empty controls
  // (operator report 2026-06-14). Clearing the debounce + dirty flag is safe
  // because we just flushed the latest state to disk above.
  function flushAndDisarmUnloadGuard() {
    flushPendingSaveBeacon();
    clearTimeout(saveTimeout);
    saveTimeout = null;
    window.__sceneDirty = false;
  }
  window.flushAndDisarmUnloadGuard = flushAndDisarmUnloadGuard;

  // Scene recovery variant: DISARM the pending autosave WITHOUT flushing it.
  // Recovery must call this before POSTing /restore-backup — otherwise the
  // pending debounced save (or the beforeunload sendBeacon fired by the
  // window.location.reload after a restore) would re-save the bad in-browser
  // state right back over the freshly restored files. We drop the pending
  // write on purpose: the operator asked to discard unsaved changes.
  function disarmUnloadGuard() {
    clearTimeout(saveTimeout);
    saveTimeout = null;
    window.__sceneDirty = false;
  }
  window.disarmUnloadGuard = disarmUnloadGuard;

  // Flush the latest config on unload as a fire-and-forget sendBeacon, but
  // NEVER raise the browser's blocking "Leave site?" confirmation — per
  // operator order (2026-07-24) the sim must never gate leave/reload. The
  // unsaved-changes safety net (the native confirm prompt) is intentionally
  // gone; the sendBeacon flush + UNSAVED CHANGES chip are what remain.
  window.addEventListener('beforeunload', () => {
    flushPendingSaveBeacon();
  });

  function _showAutoToast(msg, ttl = 3000) {
    let toast = document.getElementById('auto-patch-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'auto-patch-toast';
      // top:80px clears the multi-client contention banner
      // (multi_client_warning.js: top:44px, z-index:1000). At the old 48px
      // this toast sat 4px below a taller, higher-stacked element and was
      // completely hidden whenever a second sim window was open — i.e. every
      // time an agent probe or a second tab is around. A summary the operator
      // cannot see is not a loud output (rename invalidation, report _47).
      toast.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:color-mix(in srgb, var(--tint) 15%, var(--surface));border:1px solid var(--tint);color:var(--tint);padding:8px 24px;border-radius:8px;font-family:var(--font-body);font-size:13px;pointer-events:none;z-index:1001;opacity:0;transition:opacity 0.3s;max-width:min(760px,70vw);text-align:center;line-height:1.35;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    // Appear WITHOUT waiting on a compositor animation. The fade-in was set up
    // in the same synchronous task as the insertion, so the transition could be
    // left in flight and never ticked — measured live: inline opacity '1',
    // COMPUTED opacity '0', still 0 after 2 s of rAF polling, and invisible in
    // the screenshot (report _47). An operator summary that silently fails to
    // render is the opposite of a loud output, so the show step is now
    // transition-free; the fade-OUT is re-armed on the next frame.
    toast.style.transition = 'none';
    toast.style.opacity = '1';
    requestAnimationFrame(() => { toast.style.transition = 'opacity 0.3s'; });
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, ttl);
  }
  window.exportConfig = exportConfig;

  // ── Rename hygiene: CHECK + INVALIDATE (operator ruling 2026-07-29) ──────
  // The single implementation every rename path in this file calls. A rename
  // enumerates everything the OLD names mapped, invalidates it, and reports
  // it fixture by fixture:
  //   • registry chain entries  → spliced out (fixtures become UNMAPPED)
  //   • __globalPatchTree keys  → pruned (no old-name phantoms survive)
  //   • derived patch fields on the live configs → cleared
  //   • per-fixture viewMask    → CARRIED (display state, not mapping)
  // Addresses are NEVER migrated to the new names: that opt-in affordance
  // (plan 20260725_44 step 11b) is operator-gated and deliberately unbuilt.
  //
  // `pairs` are the positional old→new name pairs (`"<group> N"` → `"<group2>
  // N"` for a group rename, a single pair for one fixture). `configsByName`
  // resolves the NEW names to their live config objects; pass it only when
  // the new configs already exist (a group rename calls this BEFORE the
  // regenerate, so it passes null and the caller carries masks afterwards).
  //
  // Returns the report so the caller can assert on it.
  //
  // `reproject: false` is for callers that regenerate immediately afterwards
  // (the group rename). It matters: `projectControllerMappings` re-mints a
  // `__globalPatchTree` entry for EVERY live config (main.js), so reprojecting
  // while the OLD-named fixtures are still in `params.parLights` resurrects
  // the very phantoms we just pruned — caught live by
  // `trace_rename_verify.cjs` (`noPatchTreePhantoms`). The regenerate's own
  // projection, which runs after the sweep, is the correct one.
  function invalidateMappingForRename(pairs, {
    scope = 'fixture', configsByName = null, oldLabel = null, newLabel = null,
    reproject = true,
  } = {}) {
    const oldNames = pairs.map((p) => p.from);
    // name → { viewMask, viewMaskHi }: BOTH view words travel a rename, and
    // the LIVE CONFIG is authoritative over the patch tree — including with
    // ZEROS. The patch tree only refreshes on a projection, so after a
    // Views-panel unassign its copy is stale; the old inline snapshot let
    // that stale non-zero win and the rename resurrected the membership.
    // (snapshotViewMasks in rename_invalidation.js — pure + unit-tested.)
    const oldMasks = snapshotViewMasks(
      window.__globalPatchTree || {}, gatherAllConfigs(params), oldNames);

    const registry = window.__controllerRegistry;
    const chainRows = registry ? invalidateFixtureMappings(registry, oldNames) : [];
    const patchRows = window.pruneGlobalPatchTreeKeys
      ? window.pruneGlobalPatchTreeKeys(oldNames)
      : [];
    // Clear the derived patch fields off the renamed record itself — the
    // single-fixture paths rename in place, so the config object survives
    // with its old address still stamped on it. Leaving it would be a
    // phantom the projection has no reason to touch (it only writes MAPPED
    // fixtures), i.e. a stale address on an unmapped fixture (codex P0).
    const invalidated = new Set(chainRows.map((r) => r.fixture));
    const newNames = new Set(pairs.map((p) => p.to));
    const records = [...gatherAllConfigs(params), ...(params.ledStrands || [])];
    for (const record of records) {
      if (!record || !newNames.has(record.name)) continue;
      const pair = pairs.find((p) => p.to === record.name);
      if (!pair || !invalidated.has(pair.from)) continue;
      record.controllerIp = '';
      record.dmxUniverse = 0;
      record.dmxAddress = 0;
      record.controllerId = 0;
    }

    const carriedViewMasks = configsByName
      ? carryViewMasks(oldMasks, configsByName, pairs)
      : [];
    const report = buildInvalidationReport({
      oldLabel: oldLabel || pairs[0].from,
      newLabel: newLabel || pairs[0].to,
      scope, chainRows, patchRows, carriedViewMasks,
    });
    for (const line of report.lines) console.warn(`[Rename] ${line}`);
    _showAutoToast(report.summary, 9000);

    if (reproject && window.__controllerRegistry && window.projectControllerMappings) {
      window.projectControllerMappings(gatherAllConfigs(params));
      // LED strand ids continue in the SHARED id space strictly above the DMX
      // max, so the LED pass must run after the DMX pass at EVERY call site
      // (main.js §"LED metadata") — including this one, or a renamed strand
      // keeps a stale record.
      if (window.projectLedStrandPatches) window.projectLedStrandPatches();
    }
    if (window.refreshControllerMapPanel) window.refreshControllerMapPanel();
    // The caller carries these onto the NEW configs when they do not exist
    // yet at invalidation time (group rename: the regenerate mints them).
    report.oldViewMasks = oldMasks;
    return report;
  }

  // 2D Pixel Map views reference groups BY NAME (plan 20260725_44 step 12).
  // Every group rename re-points them, one loud line per rewritten selector,
  // so a rename can never again silently empty a panel the way it dropped the
  // right chimney ring out of the default Top-Down view (`_44` §3.6). Globs
  // are operator intent and are NOT rewritten — the panel's own zero-match
  // error surfaces any that stop matching.
  function migratePixelMapGroupSelectors(oldName, newName) {
    const changed = renameGroupInPixelMapViews(oldName, newName);
    for (const row of changed) {
      console.warn(`[Rename]   🗺 2D Pixel Map selector re-pointed: view '${row.view}' · ` +
        `panel '${row.panel}' · ${row.where}[${row.index}] group "${oldName}" → "${newName}"`);
    }
    return changed;
  }

  // ══ ORPHANED GENERATED FIXTURES — flag + remove (report 20260725_76) ══════
  // A fixture that CLAIMS a generator made it (`traceGenerated: true`) while no
  // live trace owns its group is a GHOST: invisible to every generator
  // workflow and, until this, undeletable through the UI. The rule itself is
  // pure and tested (orphan_fixtures.js); everything here is the wiring —
  // reading the live state, enumerating dependents, and doing the removal.

  /**
   * The scene slice the detector reads. BOTH buses: LED fixtures and DMX
   * fixtures are both fixtures (operator, 2026-07-30), so an orphaned LED
   * strand gets the same badge and the same delete flow as an orphaned PAR.
   * (The LED-CLASS par fixtures — the TE Sign halves — already live in
   * `parLights`; `ledStrands` is the separate strand record list.)
   */
  function orphanScene() {
    return {
      parLights: params.parLights || [],
      ledStrands: params.ledStrands || [],
      traces: params.traces || [],
    };
  }

  /**
   * name → exported pixel count, from the BOUND runtime fixtures. This is the
   * engine-model dependency: the exporter emits every fixture that has pixels,
   * mapped or not, so a live pixel count is exactly the footprint the last
   * model export carries. Returns null when the runtime fixtures are not bound
   * to the configs yet (a rebuild is in flight) — the caller then REFUSES
   * rather than deleting with an unknown model footprint.
   *
   * Bound by CONFIG IDENTITY on both buses, never by index: an index lookup
   * silently resolves to a different fixture whenever a slot is empty.
   */
  function orphanPixelCounts(rows) {
    if (window._isRebuildingFixtures) return null;
    const parRuntime = window.parFixtures;
    const strandRuntime = window.ledStrandFixtures;
    const counts = new Map();
    for (const row of rows) {
      const config = row.config;
      if (!config || typeof config.name !== 'string') continue;
      if (row.bus === 'led') {
        if (!Array.isArray(strandRuntime)) return null;
        const runtime = strandRuntime.find((f) => f && f.config === config);
        if (!runtime) return null;
        // A strand's exported pixel count is its declared `ledCount`
        // (pixelblaze_model_exporter.js), not a runtime pixel array.
        counts.set(config.name, Number(config.ledCount) || 0);
        continue;
      }
      if (!Array.isArray(parRuntime)) return null;
      const runtime = parRuntime.find((f) => f && f.config === config);
      if (!runtime) return null;
      counts.set(config.name, Array.isArray(runtime.pixels) ? runtime.pixels.length : 0);
    }
    return counts;
  }

  /**
   * Remove a set of orphaned fixtures, in memory, after enumerating everything
   * that depends on them (report 20260725_47's ethos: a destructive scene
   * operation lists its dependents LOUDLY before it acts).
   *
   * Order matters and every step can refuse:
   *   1. RE-DETECT. The rows were computed when the panel rendered; a
   *      generator created or renamed since then may own them now. A fixture
   *      that is no longer an orphan aborts the WHOLE operation, loudly — this
   *      never falls back to "delete the ones that still qualify".
   *   2. ENUMERATE. Controller-chain entries, patch-tree records, live/zeroed
   *      patch fields, 2D Pixel Map selectors + move offsets + placements,
   *      group membership, exported model pixels. Anything unreadable is a
   *      blocker and the delete is refused.
   *   3. CONFIRM, showing that enumeration.
   *   4. MUTATE: splice the configs, unmap their chain entries, prune their
   *      patch-tree keys, drop their 2D Pixel Map references, rebuild.
   *
   * Nothing is written to disk: `debounceAutoSave()` marks the scene dirty and
   * the OPERATOR saves (the scene is his data).
   */
  function removeOrphanFixtures(candidates, scopeLabel) {
    if (!Array.isArray(candidates) || candidates.length === 0) return false;

    // ── 1. Re-detect against the live scene ──
    const owners = generatorGroupNames(params.traces || []);
    const reclaimed = candidates
      .filter((row) => !isOrphanFixture(row.config, owners))
      .map((row) => row.name || `(unnamed, index ${row.index})`);
    if (reclaimed.length > 0) {
      const msg = buildStaleOrphanRefusal(reclaimed);
      console.error(`[Orphans] ${msg}`);
      alert(msg);
      return false;
    }
    // Indices move as soon as anything splices, so re-resolve every row against
    // its OWN record array by config identity — never by remembered index. The
    // row carries the array it came from (`records`), so DMX fixtures and LED
    // strands take the identical path.
    const rows = candidates.map((row) => {
      const records = Array.isArray(row.records) ? row.records : (params.parLights || []);
      return { ...row, records, index: records.indexOf(row.config) };
    });
    const lost = rows.filter((r) => r.index < 0).map((r) => r.name || '(unnamed)');
    if (lost.length > 0) {
      const msg = buildStaleOrphanRefusal(lost);
      console.error(`[Orphans] ${msg}`);
      alert(msg);
      return false;
    }

    // ── 2. Enumerate dependents ──
    const names = rows.map((r) => r.name).filter((n) => typeof n === 'string');
    const registry = window.__controllerRegistry;
    const pixelCounts = orphanPixelCounts(rows);
    let enumeration;
    try {
      enumeration = enumerateOrphanDependents(rows, {
        allRecords: allSceneRecords(orphanScene()),
        patchTree: window.__globalPatchTree || {},
        chainRows: registry ? describeFixtureMappings(registry, names) : [],
        pixelMapViews: pixelMapViewsSource(),
        pixelCounts,
      });
    } catch (err) {
      const msg = buildEnumerationRefusal(scopeLabel, [err.message]);
      console.error(`[Orphans] ${msg}`);
      alert(msg);
      return false;
    }
    if (enumeration.blockers.length > 0) {
      const msg = buildEnumerationRefusal(scopeLabel, enumeration.blockers);
      console.error(`[Orphans] ${msg}`);
      alert(msg);
      return false;
    }

    // ── 3. Confirm, showing the enumeration ──
    if (!confirm(buildOrphanDeleteConfirm({ scopeLabel, enumeration }))) return false;

    // ── 4. Mutate ──
    pushUndo();
    const doomed = new Set(rows.map((r) => r.config));
    const removedConfigs = rows.map((r) => r.config);
    // Splice each record out of its OWN array — `parLights` for DMX and
    // LED-class par fixtures, `ledStrands` for strands. Rebuilt in place so
    // every live reference to the array keeps pointing at the same object.
    const touchedLed = rows.some((r) => r.bus === 'led');
    // 2D Pixel Map FIRST: it is the only step that can still throw (a panel it
    // would leave with an empty `select` — enumeration already ruled that out,
    // but the views tree is the one dependent another surface could move under
    // the confirm dialog). Doing it before the splice means a throw here leaves
    // the scene completely untouched instead of half-deleted.
    for (const name of names) removeFixtureFromPixelMapViews(name);
    for (const records of new Set(rows.map((r) => r.records))) {
      const kept = records.filter((c) => !doomed.has(c));
      records.length = 0;
      records.push(...kept);
    }
    if (window.controllerMappingFixturesRemoved) {
      window.controllerMappingFixturesRemoved(removedConfigs);
    }
    if (window.pruneGlobalPatchTreeKeys) window.pruneGlobalPatchTreeKeys(names);
    if (window.invalidateMarsinBatchCache) {
      window.invalidateMarsinBatchCache('orphan_fixture_removal');
    }
    for (const line of buildRemovalReport({ scopeLabel, enumeration })) {
      console.warn(`[Orphans] ${line}`);
    }
    _showAutoToast(`🗑 Removed ${enumeration.totals.fixtures} orphaned fixture(s) — ` +
      `${enumeration.totals.modelPixels} model pixel(s) freed; RE-EXPORT the model and SAVE`,
    9000);
    if (window._setGuiRebuilding) window._setGuiRebuilding(true);
    if (window.renderParGUI) window.renderParGUI();
    if (window.renderGeneratorGUI) window.renderGeneratorGUI();
    rebuildParLights();
    // Strand removals need the LED side rebuilt too — same flow, other bus.
    if (touchedLed) {
      if (window.rebuildLedStrands) window.rebuildLedStrands();
      if (window.renderStrandGUI) window.renderStrandGUI();
    }
    if (window._setGuiRebuilding) window._setGuiRebuilding(false);
    transformControl.detach();
    debounceAutoSave();
    return true;
  }
  window.removeOrphanFixtures = removeOrphanFixtures;

  // ── Rename hygiene helpers, part 2: the individual-fixture paths ─────────

  /**
   * LOUD REFUSAL for renaming a GENERATED fixture (plan 20260725_44 step 11).
   *
   * ⚠ IMPLEMENTED PENDING OPERATOR RATIFICATION (plan §5.4). To revert:
   * delete this function and the `if (config.traceGenerated)` branch in the
   * generated-fixture Name handler — nothing else depends on it.
   *
   * Why refuse instead of allowing it: `"<group> N"` is the contract every
   * sticky-by-name store keys on (chain entries, patch tree, patches.yaml,
   * engine sectionId/fixtureId, 2D placements), and the very next regenerate
   * overwrites the hand-typed name anyway. Accepting the edit and quietly
   * undoing it later would be a silent fallback — the codex forbids exactly
   * that — so it is refused up front, and the message points at the two
   * controls that DO change generated names.
   */
  function refuseGeneratedFixtureRename(name, groupName) {
    return `⚠ "${name}" is generated by the "${groupName}" generator — its name cannot ` +
      'be edited here.\n\n' +
      'Generated fixtures are named "<group> N" in physical chain order, and every ' +
      'sticky store (DMX chain entries, patch records, engine ids, 2D placements) keys ' +
      'on that. The next Regenerate would overwrite anything typed here.\n\n' +
      'To change these names: rename the GROUP on the generator card (Generators → ' +
      `"${groupName}" → Name). To change which fixture is number N: use ⛓ Chain Order ` +
      'on the same card.';
  }

  /**
   * Rename ONE hand-placed / DMX-scene / strand fixture under the check +
   * invalidate policy. Returns true when the rename was applied, false when it
   * was refused (the control is reverted for the caller).
   *
   * Refuses duplicates outright: duplicate names collapse to a single record
   * in the derived patches.yaml (save-server.js:210) and a doubly-mapped pair
   * hard-fails the next scene load, so "repair it later" is not available.
   */
  function renameSingleFixture(config, oldName, newName, ctrl) {
    const taken = [];
    for (const other of gatherAllConfigs(params)) {
      if (other && other !== config && typeof other.name === 'string') taken.push(other.name);
    }
    for (const strand of (params.ledStrands || [])) {
      if (strand && strand !== config && typeof strand.name === 'string') taken.push(strand.name);
    }
    const dupErr = duplicateNameError(newName, taken);
    if (dupErr) {
      alert(dupErr);
      config.name = oldName;
      if (ctrl) ctrl.updateDisplay();
      return false;
    }
    config.name = newName;
    invalidateMappingForRename([{ from: oldName, to: newName }], {
      scope: 'fixture', configsByName: new Map([[newName, config]]),
    });
    return true;
  }

  let saveTimeout = null;
  function debounceAutoSave(force = false) {
    // Mark dirty on EVERY mutation, even with auto-save off — the chip
    // and the beforeunload prompt are what make "I forgot to save"
    // impossible to miss.
    _setSceneDirty(true);
    if (!params.autoSave && !force) return;
    clearTimeout(saveTimeout);
    // `interactive: false` — an auto-save may not raise a modal. A short
    // 📡 Subscribed Universes field is reported as one console warning here and
    // prompted for on the next explicit 💾 (report 20260725_86).
    saveTimeout = setTimeout(() => {
      saveTimeout = null;
      exportConfig({ interactive: false });
    }, 2000);
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
        // Cones are now one InstancedMesh per fixture — style its single shared
        // material once (was per-pixel p.beam.material before instancing).
        const coneMat = f && f.coneInst && f.coneInst.material;
        if (coneMat) {
          coneMat.transparent = isTransparent;
          coneMat.opacity = isTransparent ? opacity : 1.0;
          coneMat.depthWrite = !isTransparent;
          coneMat.blending = isTransparent ? THREE.AdditiveBlending : THREE.NormalBlending;
          coneMat.needsUpdate = true;
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
      // ONE global halo control, and it must reach EVERY bus live (operator,
      // 2026-07-30: "please make sure that's a global for-all-fixtures
      // parameter"). DMX pars/bars/vintage and LED-bus fixtures (TE Sign, TE
      // LED Grid) live in parFixtures/dmxSceneFixtures and take updateScales.
      const allFixtures = [...(window.parFixtures || []), ...(window.dmxSceneFixtures || [])];
      allFixtures.forEach(f => {
        if (f && f.updateScales) f.updateScales(params.globalPixelScale || 1.0, v);
      });
      // LED strands are a SEPARATE list with a separate re-render entry point,
      // and they were missing here — their halo radius is
      // `ledHaloSize × globalHaloScale` (led_halo.ledHaloRadius), so it was
      // frozen at whatever this slider read when the strand was built. Moving
      // the knob changed every other fixture and left the strands behind; only
      // the LED "Halo Size" slider (applyLedSizeToAll) ever re-rendered them.
      // applyVisualSize() re-reads BOTH LED sizes, and the strand bulb does not
      // consult globalPixelScale, so this cannot disturb strand pixel size.
      (window.ledStrandFixtures || []).forEach(f => {
        if (f && f.applyVisualSize) f.applyVisualSize();
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
      // Force generators off when par lights are disabled — the gate reads
      // params.parsEnabled (already written by the controller before this
      // handler runs), so one call answers the whole question.
      if (window.applyTraceVisualsVisibility) window.applyTraceVisualsVisibility();
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
    generatorsVisible: () => {
      // Visibility only. The "the operator chose this himself" mark is set on
      // the CONTROL (see addControl + the Group Generator folder), never here —
      // window.applyAllHandlers replays every handler on undo/redo and must not
      // forge a choice he did not make.
      if (window.applyTraceVisualsVisibility) window.applyTraceVisualsVisibility();
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

      // Generator/trace preview visuals are authoring furniture: on in the
      // working profiles, off by default in the beauty ones (report
      // 20260725_79 — their opaque dots read as coloured rings on the
      // fixtures). Re-asked on every profile change; the operator's own
      // "Show Generators" flip still overrides in either direction.
      if (window.applyTraceVisualsVisibility) window.applyTraceVisualsVisibility();

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
  // Hover text stating a control's REACH, for the ones whose label alone
  // doesn't. Keyed by params key. See addControl below.
  const CONTROL_SCOPE_TOOLTIPS = {
    globalHaloScale:
      'ALL fixtures — LED strands, TE Sign, DMX pars, bars and vintage. ' +
      'Effective halo = (class base) × THIS × the fixture\'s own "Halo ×". ' +
      'Not to be confused with "LED Halo Base" in the LED Strands panel, which is ' +
      'the LED-bus base radius only.',
    globalPixelScale:
      'DMX fixtures (pars, bars, vintage) and the scene-wide pixel dots. ' +
      'LED strands size their bulbs from "LED Pixel Size" in the LED Strands panel.',
  };

  function addControl(folder, key, meta) {
    const isSpotlightLimitControl = key === "maxSpotlights";
    const controlMin = isSpotlightLimitControl ? 1 : meta.min;
    // The pool is allocated once, in setupLighting(), from the resolved boot
    // value — and setupGUI() runs after it. So the honest top of this slider is
    // the pool that actually exists this session, not the hard cap: above the
    // pool length the per-frame limit is clamped and the extra range would do
    // nothing. Raising the budget is a boot-time act (?spotlights=N, or save
    // + reload), which is what the pre-allocation model means.
    const controlMax = isSpotlightLimitControl ? getSpotlightSliderMax() : meta.max;
    if (isSpotlightLimitControl) {
      // The YAML meta keeps the hard cap (that is the declared capability of
      // the knob, and it must not ratchet down into every scene file on save);
      // only the live control is bound to this session's pool.
      meta.max = MAX_SPOTLIGHT_POOL_SIZE;
      if (Number.isFinite(params[key])) {
        params[key] = Math.min(params[key], controlMax);
      }
    }
    if (key === "spotlightSamplingMode") {
      // The strategy roster lives in code (spotlight_sampling.js), not in
      // scenes/common.yaml — the same split as the Max Spotlights range above,
      // and for the same reason: YAML is operator-owned data, and a strategy
      // list that disagrees with the strategies that exist is a lie the
      // operator can only discover by picking a dead option. Writing it back
      // into `meta` means a save records the truthful list.
      meta.options = SPOTLIGHT_SAMPLING_MODES.slice();
    }
    // A session running an operator-accepted over-cap budget (?spotlights=N
    // above the hard cap, confirmed at boot) gets a persistent marker on the
    // slider itself: the red GPU banner auto-hides after 30 s, and the operator
    // needs to be able to tell — an hour later, and after a save — that this
    // number is session-only and will not come back on the next boot.
    const overCapSession = isSpotlightLimitControl && isSpotlightSessionCeilingRaised();
    const controlLabel = overCapSession
      ? `⚠ ${meta.label || key} (session ${getSpotlightSessionCeiling()})`
      : (meta.label || key);
    const isColor =
      meta.type === "color" ||
      (typeof meta.value === "string" && String(meta.value).startsWith("#"));
    const isBool = typeof params[key] === "boolean";
    let ctrl;

    if (isColor) {
      ctrl = folder.addColor(params, key).name(controlLabel);
    } else if (isBool) {
      ctrl = folder.add(params, key).name(controlLabel);
    } else if (meta.options) {
      ctrl = folder.add(params, key, meta.options).name(controlLabel);
    } else if (typeof params[key] === "number" && controlMin !== undefined) {
      ctrl = folder
        .add(params, key, controlMin, controlMax, meta.step)
        .name(controlLabel);
    } else {
      ctrl = folder.add(params, key).name(controlLabel);
    }

    if (overCapSession && ctrl.domElement) {
      ctrl.domElement.title =
        `Over-cap session: ${getSpotlightSessionCeiling()} SpotLights, accepted at boot from ` +
        `?spotlights=. The hard cap is ${MAX_SPOTLIGHT_POOL_SIZE} — saving writes ` +
        `${MAX_SPOTLIGHT_POOL_SIZE}, and reloading returns to it unless you pass the URL ` +
        'parameter and accept the prompt again.';
    }

    // Scope tooltips for controls whose NAME does not make their reach obvious.
    // The halo pair cost the operator two debugging rounds on 2026-07-30 (he
    // was dragging the LED-bus base radius expecting a global). Defined here,
    // in code, because scenes/common.yaml is operator-owned.
    if (CONTROL_SCOPE_TOOLTIPS[key] && ctrl.domElement) {
      ctrl.domElement.title = CONTROL_SCOPE_TOOLTIPS[key];
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

    // "Show Generators" moved BY THE OPERATOR is an explicit choice, and from
    // then on it outranks the beauty-profile default in both directions
    // (trace_visual_gate.js). Marked on the control rather than in the handler
    // because window.applyAllHandlers replays handlers on undo/redo.
    if (key === 'generatorsVisible') {
      const priorOnChange = handlers[key];
      ctrl.onChange((v) => {
        params.traceVisualsOperatorChoice = true;
        if (typeof priorOnChange === "function") priorOnChange(v);
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
          // The reset above paints fixture meshes (bulb + halo + cone + p.color)
          // BEHIND the batch entries' backs. The sACN-in demap's undriven fast
          // path (sacn_mapper.js paintUndrivenEntry) skips entry.apply() while
          // an entry stays marked `_sacnUndriven` with the treatment fields
          // intact — it assumes entry fields mirror the fixture's paint. This
          // out-of-band repaint breaks that assumption: without invalidation,
          // an unpatched/frame-less par kept a full-brightness config-color
          // HALO forever after lighting was re-enabled, while its SpotLight
          // stayed dark (operator report 2026-08-06, par halo leak). Rebuilding
          // the batch cache clones fresh entries (no `_sacnUndriven` marker),
          // so the next demap pass repaints every undriven fixture black/red.
          if (window.invalidateMarsinBatchCache) {
            window.invalidateMarsinBatchCache('lighting_disabled_reset');
          }
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

  /**
   * "Show Unpatched (Red)" — the one switch every unmapped-fixture indicator
   * answers to (report 20260725_81): the fixture shell tint, the instanced
   * pixel dot, and the undriven bulb/halo/cone repaint in the sACN-in demap.
   *
   * Built by this ONE function in TWO places (operator, 2026-07-30: *"don't
   * move — clone it in the options too, but sync them to 1 value please, both
   * places would be nice"*):
   *   • Lighting Control → ⚙️ Options — because it is a scene-wide rendering
   *     behaviour that covers the LED bus exactly as much as DMX ("it affects
   *     the LEDs too"), and that is where he looked for it;
   *   • the top of the fixtures panel — where it has always been, next to the
   *     fixtures it marks.
   *
   * TWO VIEWS, ONE VALUE, and divergence is impossible by construction: both
   * controllers are bound to the same `params.showUnpatchedRed` (one param, one
   * persistence key, no mirror state), and both `.listen()` — the controller's
   * own rAF poll calls `updateDisplay()` the moment the value changes, whoever
   * changed it. That is the same mechanism that already keeps the Controller
   * Mapping panel's "Unpatched Highlight" button in step, so this is the
   * existing pattern, not a new one. Name, tooltip and onChange are defined
   * once here so the two views cannot drift in behaviour either.
   *
   * Defined in code rather than `scenes/common.yaml` because that file is
   * operator-owned (same reason as CONTROL_SCOPE_TOOLTIPS).
   */
  function addUnpatchedRedControl(folder) {
    if (params.showUnpatchedRed === undefined) params.showUnpatchedRed = false;
    if (folder.controllers.find((c) => c.property === 'showUnpatchedRed')) return;
    const ctrl = folder
      .add(params, "showUnpatchedRed")
      .name("Show Unpatched (Red)")
      .listen()
      .onChange(() => {
        if (window.refreshControllerMapPanel) window.refreshControllerMapPanel();
      });
    if (ctrl.domElement) {
      ctrl.domElement.title =
        'ALL fixtures, LED strands and DMX alike: paint anything with no patch ' +
        'BRIGHT RED in the 3D view — shell, pixel dot, bulb and halo — so unmapped ' +
        'holes are obvious. Off = they render black. Preview only; no DMX is ever ' +
        'sent for an unpatched fixture. Live on the flip, no reload. Same switch as ' +
        '"Unpatched Highlight" in the Controller Mapping panel.';
    }
    return ctrl;
  }

  /**
   * Make sure ⚙️ Options carries a `spotlightSamplingMode` leaf.
   *
   * The shipped DEFAULT strategy lives in code (spotlight_sampling.js), the same
   * split as the roster in addControl() and the "Max Spotlights" range in _187: YAML is
   * operator-owned data that the save path rewrites, so a default parked there
   * is whatever the last save left behind. A scene that records no value runs
   * the code default — and without this seed it would also have NO DROPDOWN,
   * because this section is built by walking the leaves that exist. That would
   * leave an operator who deleted the key with no way to pick anything, and the
   * next save would not record what he is looking at.
   *
   * `reconstructYAML()` only writes into leaves that ALREADY exist, so the leaf
   * has to be created here for the value to persist — the same reason (and the
   * same shape) as applySubscribedUniverses() in subscribed_universes_prompt.js.
   * A leaf that is already there is left completely alone: the saved value wins.
   */
  function ensureSpotlightSamplingEntry(sectionNode) {
    const entry = sectionNode.spotlightSamplingMode;
    if (entry !== undefined) {
      const isControlLeaf = entry
        && typeof entry === "object"
        && !Array.isArray(entry)
        && Object.prototype.hasOwnProperty.call(entry, "value")
        && entry.value !== undefined;
      if (!isControlLeaf) {
        throw new TypeError(
          '[SpotlightSampling] options.spotlightSamplingMode is present but malformed; ' +
          'expected a control leaf with a defined "value".'
        );
      }
      return;
    }
    const mode = resolveSpotlightSamplingMode(
      params.spotlightSamplingMode, 'params.spotlightSamplingMode'
    );
    sectionNode.spotlightSamplingMode = { value: mode, label: 'Sim Spotlight Sampling' };
    params.spotlightSamplingMode = mode;
    console.warn(
      `[SpotlightSampling] ⚙️ Options carried no spotlightSamplingMode entry — one was created at the ` +
      `shipped default "${DEFAULT_SPOTLIGHT_SAMPLING_MODE}" (running: "${mode}"). ` +
      'It persists with the next save of scenes/common.yaml.'
    );
  }

  function buildOptionsSection(parentFolder, sectionNode) {
    const optionsFolder = parentFolder.addFolder(sectionNode._section.label);
    if (sectionNode._section.collapsed) optionsFolder.close();
    _sectionFolderMap.set(sectionNode._section, optionsFolder);

    ensureSpotlightSamplingEntry(sectionNode);

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

    addUnpatchedRedControl(optionsFolder);
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

    // "Show Unpatched (Red)" — view TWO of the same switch. View one is in
    // Lighting Control → ⚙️ Options (it affects the LED bus as much as DMX);
    // this one stays here, next to the fixtures it marks. Same param, same
    // builder, both `.listen()` — see addUnpatchedRedControl for why they
    // cannot diverge.
    addUnpatchedRedControl(parFolder);

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

    // NOTE: the ✨ + TE Sign (A+B) generator button used to live here on the DMX
    // "Light Instances" toolbar. It moved to the LED Fixtures section's
    // ✨ Generators area (catalog-driven — buildLedStrandsSection), mirroring the
    // DMX 📐 Group Generator split: generators live in their own area, and what
    // they produce lands in the instances list. See report
    // 20260724_30_led_generator_s2_s3.md and design 20260724_26.

    function renderParGUI() {
      // Remember which groups were open before rebuild — from BOTH homes, since
      // LED-class groups (TE Sign) live under the "LED Fixtures" section folder.
      // `_plainTitle` is the un-badged `"<group> (N)"` key. Group folders that
      // carry an orphan badge render extra HTML in their title, and matching on
      // the rendered title would lose their open state on every re-render
      // (report 20260725_76). Folders without a badge set it to the same string
      // they always used, so this is a no-op for them.
      const openGroups = new Set();
      parListFolder.folders.forEach((f) => {
        if (!f._closed) openGroups.add(f._plainTitle || f._title);
      });
      if (window._ledFixtureInstancesFolder) {
        window._ledFixtureInstancesFolder.folders.forEach((f) => {
          if (!f._closed) openGroups.add(f._plainTitle || f._title);
        });
      }

      const children = [...parListFolder.folders];
      children.forEach((f) => f.destroy());
      window.parGuiFolders = [];

      // LED-class group folders live under window._ledFixtureInstancesFolder
      // (the "LED Fixtures" section), NOT parListFolder — so the destroy() above
      // does not reach them. Tear down the ones we made last pass before we
      // rebuild, or the TE Sign group would duplicate on every render.
      if (!window._parLedGroupFolders) window._parLedGroupFolders = [];
      window._parLedGroupFolders.forEach((f) => f.destroy());
      window._parLedGroupFolders = [];

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
              window.__globalPatchTree[c.name].viewMaskHi = 0;
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

      // ── 🧹 Stale pixel-order entries (design §2.7) ──────────────────────
      // A `pixelOrder` entry that names no fixture in this scene is INERT, so it
      // is never auto-deleted (a legitimate manual deletion must not brick the
      // save) and never silently ignored either: it is reported at boot/save and
      // removed only by this explicit gesture, which lists the names first.
      const staleOrder = pixelOrderStaleNames();
      if (staleOrder.length > 0) {
        const staleBtn = document.createElement('button');
        staleBtn.textContent = `🧹 Clear stale pixel-order entries (${staleOrder.length})`;
        staleBtn.title = 'These pixel-order flags name no fixture in this scene and do ' +
          'nothing. Removing them only tidies scene_config.yaml.';
        staleBtn.style.cssText = apBtnBase +
          'background:color-mix(in srgb, var(--caution) 15%, var(--surface));color:var(--caution);';
        staleBtn.onclick = () => {
          if (!confirm(`Remove ${staleOrder.length} stale pixel-order entry/entries?\n\n` +
            `${staleOrder.map((n) => `  • ${n}`).join('\n')}\n\n` +
            'They name no fixture in this scene, so nothing changes on the wire.')) return;
          pushUndo();
          for (const name of staleOrder) delete params.pixelOrder[name];
          console.warn(`[pixelOrder] Cleared ${staleOrder.length} stale entry/entries: ` +
            `${staleOrder.join(', ')}`);
          debounceAutoSave();
          if (window._setGuiRebuilding) window._setGuiRebuilding(true);
          renderParGUI();
          if (window._setGuiRebuilding) window._setGuiRebuilding(false);
        };
        autoPatchWrap.appendChild(staleBtn);
      }

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
        // 'name' is NOT propagatable (plan 20260725_44 step 11): stamping one
        // name onto every selected fixture mass-produces duplicates, which
        // collapse to a single patches.yaml record and hard-fail the next
        // scene load. Throw rather than silently skip — a caller asking for
        // this is a bug, and a quiet no-op would hide it (codex P0).
        if (property === 'name') {
          throw new Error('propagateToSelected: refusing to propagate \'name\' — ' +
            'duplicate fixture names break patch derivation and scene load. ' +
            'Rename fixtures one at a time.');
        }
        if (!selectedFixtureIndices.has(sourceIndex)) return;
        for (const idx of selectedFixtureIndices) {
          if (idx === sourceIndex) continue;
          if (params.parLights[idx]) {
            params.parLights[idx][property] = value;
            window.syncLightFromConfig(idx);
          }
        }
      }

      // Rigid numeric move for a LOCKED par group: a Position/Rotation edit on
      // one member moves the WHOLE group by the same delta, preserving relative
      // offsets. Returns true when the group is locked (caller then SKIPS the
      // normal per-selection propagate, so the two never double-apply). The TE
      // Sign group routes through applyTeSignPlacement so A ≡ B never drifts.
      function applyLockedParNumericMove(sourceIndex, field, newVal, prevVal) {
        const cfg = params.parLights[sourceIndex];
        if (!cfg) return false;
        const group = cfg.group || 'Default';
        if (!isGroupLocked(params.groupOverrides, group)) return false;
        const members = parGroupMemberIndices(params.parLights, group);
        if (members.length <= 1) return true; // locked but alone — nothing to move
        const memberConfigs = members.map((i) => params.parLights[i]);
        if (isTeSignConfigs(memberConfigs)) {
          applyTeSignPlacement(memberConfigs, {
            x: cfg.x, y: cfg.y, z: cfg.z,
            rotX: cfg.rotX, rotY: cfg.rotY, rotZ: cfg.rotZ,
            scaleX: cfg.scaleX ?? 1, scaleY: cfg.scaleY ?? 1, scaleZ: cfg.scaleZ ?? 1,
          });
          members.forEach((i) => { if (window.syncLightFromConfig) window.syncLightFromConfig(i); });
          return true;
        }
        const delta = newVal - prevVal;
        if (delta !== 0) {
          members.forEach((i) => {
            if (i === sourceIndex) return;
            const c = params.parLights[i];
            c[field] = (c[field] || 0) + delta;
            if (window.syncLightFromConfig) window.syncLightFromConfig(i);
          });
        }
        return true;
      }

      // ── ORPHAN CENSUS (report 20260725_76) ──
      // Generated fixtures whose generator no longer exists. Computed ONCE per
      // render from the pure detector, then used to badge group folders and
      // fixture cards and to arm the removal buttons. A scene whose generator
      // list cannot be read THROWS in the detector — we do not scan, because a
      // half-read owner set would paint live fixtures as orphans.
      const orphanRows = findOrphanFixtures(orphanScene());
      const orphanConfigs = new Set(orphanRows.map((r) => r.config));
      const orphanRowsByGroup = new Map();
      for (const row of orphanRows) {
        if (!orphanRowsByGroup.has(row.group)) orphanRowsByGroup.set(row.group, []);
        orphanRowsByGroup.get(row.group).push(row);
      }
      // Membership is counted ACROSS BUSES (a group can hold DMX fixtures,
      // LED-class par fixtures and LED strands at once), so "all orphaned" is
      // decided by the summary, never by this section's own item count.
      const orphanSummaryByGroup = new Map(
        orphanGroupSummary(orphanScene()).map((g) => [g.group, g]),
      );
      window.__orphanFixtureCount = orphanRows.length;

      // Collect unique groups in order of appearance. `ordinal` is the member's
      // position WITHIN its group in params.parLights order — the display list
      // below is sorted by name, so the only two places that care about source
      // position (the generated-fixture default name) read this instead of the
      // loop counter.
      const groupOrder = [];
      const groupMap = new Map();
      params.parLights.forEach((config, index) => {
        const g = config.group || 'Default';
        if (!groupMap.has(g)) {
          groupMap.set(g, []);
          groupOrder.push(g);
        }
        const bucket = groupMap.get(g);
        bucket.push({ config, index, ordinal: bucket.length });
      });

      // Ensure at least one group exists
      if (groupOrder.length === 0) groupOrder.push('Default');

      // DISPLAY ORDER ONLY — group folders render sorted by name. `groupOrder`
      // itself stays in appearance order because two non-display callers read
      // it: the "delete group" reassignment target and nothing else may drift.
      const displayGroupOrder = sortNamesNatural(groupOrder);

      displayGroupOrder.forEach((groupName) => {
        // Sorted VIEW of the group's members — `groupMap`'s own arrays (and
        // params.parLights behind them) are never reordered.
        const items = sortByNameNatural(groupMap.get(groupName) || [], (it) => it.config.name);
        // Route LED-class groups (every member rides the LED bus, e.g. the two
        // TE Sign halves) into the "LED Fixtures" section; DMX-bus groups stay
        // here. Everything below — per-fixture cards, group select, the group
        // override, patch — is identical either way; only the parent folder
        // differs, so patching / 'TE Sign' group / 'TE Sign (2)' select / the
        // A≡B transform are untouched by the relocation. If the LED section is
        // not built yet (the very first render runs during the DMX-section build,
        // before the LED section exists) we fall back to this folder so the sign
        // is never hidden; the LED section calls renderParGUI() again once ready.
        const isLedClassGroup = items.length > 0 && items.every(({ config }) => isLedClassConfig(config));
        const ledHome = window._ledFixtureInstancesFolder || null;
        const targetFolder = (isLedClassGroup && ledHome) ? ledHome : parListFolder;
        // ORPHAN BADGE on the group header (report 20260725_76) — the operator
        // must be able to SEE which groups are ghosts without expanding
        // anything. `_plainTitle` keeps the open-state key un-badged.
        const groupOrphans = orphanRowsByGroup.get(groupName) || [];
        const groupSummary = orphanSummaryByGroup.get(groupName) || null;
        const groupMemberCount = groupSummary ? groupSummary.memberCount : items.length;
        const groupAllOrphans = !!(groupSummary && groupSummary.allOrphans);
        const plainGroupTitle = `${groupName} (${items.length})`;
        const orphanBadgeHtml = groupOrphans.length === 0 ? '' :
          ` <span style="color:var(--error);font-weight:700;font-size:10px;">⚠ ${
            groupAllOrphans ? 'ORPHANED' : `${groupOrphans.length} ORPHANED`}</span>`;
        const groupFolder = targetFolder.addFolder(plainGroupTitle + orphanBadgeHtml);
        groupFolder._plainTitle = plainGroupTitle;
        if (targetFolder === ledHome) window._parLedGroupFolders.push(groupFolder);

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
        if (groupOv.locked === undefined) groupOv.locked = false;
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
          genLabel.textContent = groupOrphans.length === 0 ? '🔧 Generated'
            : (groupAllOrphans ? '⚠ Orphaned — no generator' : '⚠ Partly orphaned');
          if (groupOrphans.length > 0) {
            genLabel.style.cssText = 'color:var(--error);font-size:10px;font-weight:600;margin-left:4px;';
          }

          traceRow.appendChild(visBtn);
          traceRow.appendChild(genLabel);
          const gc = groupFolder.domElement.querySelector('.children');
          if (gc) gc.prepend(traceRow);

          // ── ORPHAN GROUP BANNER (report 20260725_76) ──
          // Group-by-group removal. On a MIXED group this offers ONLY the
          // orphan members and says so — the live members belong to somebody.
          if (groupOrphans.length > 0 && gc) {
            const orphanBar = document.createElement('div');
            orphanBar.className = 'orphan-group-bar';
            orphanBar.style.cssText = 'margin:2px 6px 4px;padding:4px 6px;border:1px solid ' +
              'var(--error);border-radius:3px;background:color-mix(in srgb, var(--error) 12%, ' +
              'var(--surface));display:flex;flex-direction:column;gap:3px;';
            const why = document.createElement('div');
            why.style.cssText = 'color:var(--error);font-size:9px;line-height:1.35;';
            why.textContent = groupAllOrphans
              ? `⚠ All ${groupOrphans.length} fixture(s) in this group claim a generator ` +
                'made them, but no generator owns this group. They are invisible to every ' +
                'generator workflow and still cost model pixels.'
              : `⚠ ${groupOrphans.length} of ${groupMemberCount} fixture(s) in this group are ` +
                'orphaned (they claim a generator that no longer exists). Only those are ' +
                'offered for removal — the rest belong to a live generator.';
            const orphanBtnRow = document.createElement('div');
            orphanBtnRow.style.cssText = 'display:flex;gap:3px;';
            const selOrphansBtn = document.createElement('button');
            selOrphansBtn.textContent = `☑ Select ${groupOrphans.length}`;
            selOrphansBtn.title = 'Select the orphaned fixtures in the 3D view';
            selOrphansBtn.style.cssText = gBtnStyle2 + 'color:var(--secondary);';
            selOrphansBtn.onclick = () => {
              deselectAllFixtures();
              for (const row of groupOrphans) {
                const at = params.parLights.indexOf(row.config);
                if (at < 0) continue;
                selectedFixtureIndices.add(at);
                if (window.parFixtures[at]) window.parFixtures[at].setSelected(true);
              }
              document.activeElement?.blur?.();
            };
            const delOrphansBtn = document.createElement('button');
            delOrphansBtn.textContent = `🗑 Remove ${groupOrphans.length} orphan(s)`;
            delOrphansBtn.title = 'Enumerate every dependent, then remove these orphaned ' +
              'fixtures from the scene (in memory — you save)';
            delOrphansBtn.style.cssText = gBtnStyle2 +
              'background:color-mix(in srgb, var(--error) 20%, var(--surface));color:var(--error);' +
              'font-weight:700;';
            delOrphansBtn.onclick = () => {
              removeOrphanFixtures(groupOrphans, groupAllOrphans
                ? `the whole "${groupName}" group`
                : `${groupOrphans.length} of ${groupMemberCount} fixtures in "${groupName}"`);
            };
            orphanBtnRow.appendChild(selOrphansBtn);
            orphanBtnRow.appendChild(delOrphansBtn);
            orphanBar.appendChild(why);
            orphanBar.appendChild(orphanBtnRow);
            gc.prepend(orphanBar);
          }

          // Show individual generated fixtures with limited editing
          items.forEach(({ config, index, ordinal }) => {
            try {
              // `ordinal` (source position in the group), NOT the display index
              // — the seeded name must not depend on how the list is sorted.
              if (!config.name) config.name = `Fixture ${ordinal + 1}`;
              // ORPHAN BADGE on the fixture row (report 20260725_76).
              const isOrphanRow = orphanConfigs.has(config);
              const genCardTitle = (name) => (isOrphanRow
                ? `<span style="color:var(--error);font-weight:700;">⚠</span> ${name}`
                : `${name}`);
              const folderTitle = genCardTitle(config.name);
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
              // Name. A GENERATED fixture's name is REFUSED (plan 20260725_44
              // step 11) — see refuseGeneratedFixtureRename(). A hand-placed
              // fixture that merely shares the card with generated siblings
              // renames normally, through the check + invalidate policy.
              let committedGenName = config.name;
              const genNameCtrl = genFixFolder.add(config, 'name').name('Name');
              genNameCtrl.onFinishChange((v) => {
                const proposed = (v || '').trim();
                if (proposed === committedGenName) {
                  config.name = committedGenName;
                  genNameCtrl.updateDisplay();
                  return;
                }
                if (config.traceGenerated) {
                  alert(refuseGeneratedFixtureRename(committedGenName, config.group));
                  config.name = committedGenName;
                  genNameCtrl.updateDisplay();
                  genFixFolder.title(genCardTitle(committedGenName));
                  return;
                }
                if (!renameSingleFixture(config, committedGenName, proposed, genNameCtrl)) return;
                committedGenName = proposed;
                genFixFolder.title(genCardTitle(proposed));
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
              if (config.viewMaskHi === undefined) config.viewMaskHi = 0;

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

              // ── ⇄ PIXEL ORDER (design 20260806_174 §2.8) ──────────────────
              // Rendered ONLY for a fixture whose DEFINITION has more than one
              // pixel: a par has nothing to reverse, and the store refuses an
              // entry on one at export. The flag is scene state keyed by the
              // fixture NAME (params.pixelOrder), so it survives every
              // regeneration; it lands on hardware at the engine's NEXT model
              // reload, which the toast says in as many words — the 3D preview
              // deliberately keeps showing model intent (§2.6).
              const defPixelCount = (fDef && Array.isArray(fDef.pixels)) ? fDef.pixels.length : 0;
              if (genChildren && defPixelCount > 1) {
                if (!params.pixelOrder) params.pixelOrder = {};
                const pxOrderRow = document.createElement('div');
                pxOrderRow.className = 'pixel-order-row';
                pxOrderRow.style.cssText = 'padding:0 8px 6px;';
                const pxOrderBtn = document.createElement('button');
                pxOrderBtn.title = 'Pixel order on the wire. REVERSED = this fixture is wired ' +
                  'opposite to the model. Verify with calibration pattern 71.';
                const paintPxOrderBtn = () => {
                  // A hand-authored invalid value must not be swallowed by the
                  // button paint — say so on the control itself.
                  let reversed = false;
                  let invalid = null;
                  try {
                    reversed = isReversed(params.pixelOrder, config.name);
                  } catch (err) {
                    invalid = err.message;
                  }
                  pxOrderBtn.textContent = invalid ? '⚠ Px INVALID'
                    : (reversed ? 'Px ⇄ REVERSED' : 'Px →');
                  if (invalid) pxOrderBtn.title = invalid;
                  pxOrderBtn.style.cssText = 'width:100%;padding:4px 0;border:none;' +
                    'border-radius:3px;cursor:pointer;font-size:10px;font-family:inherit;' +
                    'font-weight:600;' + (invalid
                      ? 'background:color-mix(in srgb, var(--error) 18%, var(--surface));' +
                        'color:var(--error);'
                      : (reversed
                        ? 'background:color-mix(in srgb, var(--caution) 15%, var(--surface));' +
                          'color:var(--caution);'
                        : 'background:var(--control-bg);color:var(--secondary);'));
                };
                paintPxOrderBtn();
                pxOrderBtn.onclick = () => {
                  let reversed;
                  try {
                    reversed = isReversed(params.pixelOrder, config.name);
                  } catch (err) {
                    // The stored value is neither 'normal' nor 'reversed'. Fix
                    // it by hand in scene_config.yaml — the toggle refuses to
                    // guess which of the two the operator meant.
                    alert(err.message);
                    return;
                  }
                  if (reversed) delete params.pixelOrder[config.name];
                  else params.pixelOrder[config.name] = PIXEL_ORDER_REVERSED;
                  paintPxOrderBtn();
                  debounceAutoSave();
                  showToast(`Pixel order saved (${config.name}: ${reversed ? 'NORMAL' : 'REVERSED'}) ` +
                    '— engine model re-exported. Reload the model/pattern on the engine to see ' +
                    'it on hardware.', { ttl: 9000 });
                  pxOrderBtn.blur();
                };
                pxOrderRow.appendChild(pxOrderBtn);
                genChildren.appendChild(pxOrderRow);
              }

              meta = appendMetadataPanelV2(genChildren, config, { onChange: debounceAutoSave });
              // Trace-generated fixtures auto-default fixtureId from DMX patch
              // on creation; the input is editable so users can override.
              if (meta && meta.inputs && meta.inputs.fixtureId) {
                meta.inputs.fixtureId.title = 'Defaulted to Universe × 1000 + Address; editable.';
              }

              // ── ONE-BY-ONE ORPHAN REMOVAL (report 20260725_76) ──
              // This card deliberately has NO ✕ Remove for a live generated
              // fixture — the generator owns it, and deleting one behind the
              // generator's back would be undone by the next Regenerate. An
              // ORPHAN has no generator to own it, which is exactly why it was
              // undeletable before: this is the only control that can retire it.
              if (isOrphanRow && genChildren) {
                const orphanRow = document.createElement('div');
                orphanRow.className = 'orphan-fixture-row';
                orphanRow.style.cssText = 'display:flex;flex-direction:column;gap:3px;' +
                  'padding:4px 8px 6px;';
                const note = document.createElement('div');
                note.style.cssText = 'color:var(--error);font-size:9px;line-height:1.35;';
                note.textContent = `⚠ ORPHANED — this fixture says the "${config.group}" ` +
                  'generator made it, but no such generator exists. Nothing regenerates, ' +
                  'renames or chains it.';
                const rmOrphanBtn = document.createElement('button');
                rmOrphanBtn.textContent = '🗑 Remove this orphan';
                rmOrphanBtn.title = 'Enumerate every dependent, then remove this fixture ' +
                  'from the scene (in memory — you save)';
                rmOrphanBtn.style.cssText = 'width:100%;padding:4px 8px;border:1px solid ' +
                  'var(--error);border-radius:3px;background:color-mix(in srgb, var(--error) ' +
                  '18%, var(--surface));color:var(--error);cursor:pointer;font-size:10px;' +
                  'font-family:inherit;font-weight:700;';
                rmOrphanBtn.onclick = () => {
                  const row = orphanRows.find((r) => r.config === config);
                  if (!row) {
                    // The census said orphan when this card was built; it is not
                    // in the census any more. Refuse — never re-derive here.
                    alert(buildStaleOrphanRefusal([config.name || '(unnamed)']));
                    return;
                  }
                  removeOrphanFixtures([row], `the single fixture "${config.name}"`);
                };
                orphanRow.appendChild(note);
                orphanRow.appendChild(rmOrphanBtn);
                genChildren.appendChild(orphanRow);
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

        // 🔒 Group lock — tie every fixture in this group together so the whole
        // group moves as ONE rigid body (transform gizmo or numeric Position/
        // Rotation inputs). Preserves relative offsets; unlocked members move
        // individually as before. The flag lives in groupOv (persisted with the
        // scene). For the TE Sign group, rigid moves route through
        // applyTeSignPlacement so the A ≡ B identical transform can never drift.
        const lockBtn = document.createElement('button');
        const paintLock = () => {
          lockBtn.textContent = groupOv.locked ? '🔒 Locked' : '🔓 Lock';
          lockBtn.style.cssText = gBtnStyle + (groupOv.locked ? 'color:var(--ok);' : 'color:var(--secondary);');
        };
        paintLock();
        lockBtn.title = 'Lock this group so all its fixtures move together as one rigid body';
        lockBtn.onclick = () => {
          groupOv.locked = !groupOv.locked;
          paintLock();
          debounceAutoSave();
          document.activeElement?.blur?.();
        };

        row1.appendChild(selBtn);
        row1.appendChild(visBtn);
        row1.appendChild(lockBtn);

        // Row 2: Rename | + Light | ✕ Delete
        // WRAPS (report _52). Measured live in the docked LED Fixtures panel:
        // "✏ Rename" needs 67px of text and the three-way flex row gave it 51px,
        // so the operator's only rename control rendered as "✏ Ren…" — present,
        // but unreadable, which is why it read as missing. `LABEL_BTN` pins the
        // two text buttons to their content width (`min-width:max-content` wins
        // over gBtnStyle's `min-width:0`, later declaration) and the row wraps
        // instead of clipping when the pane is narrow.
        const row2 = document.createElement('div');
        row2.style.cssText = 'display:flex;gap:2px;flex-wrap:wrap;';
        const LABEL_BTN = gBtnStyle + 'flex:0 1 auto;min-width:max-content;';

        const renameBtn = document.createElement('button');
        renameBtn.textContent = '✏ Rename';
        renameBtn.title = `Rename the group "${groupName}" (fixture names and their ` +
          'DMX/sACN addresses are NOT touched)';
        renameBtn.style.cssText = LABEL_BTN;
        renameBtn.onclick = () => {
          const newName = prompt('Rename group:', groupName);
          if (newName === null) return;
          const nn = newName.trim();
          if (!nn || nn === groupName) return;
          // Fail loud (codex P0) on an empty / reserved / colliding name — a merge
          // would fuse two groups' overrides, view bits and pixel-map selectors.
          // The guard is SCENE-WIDE (group_rename_guard.js, report _52): par
          // groups, LED strand groups and generator groups share ONE namespace,
          // and this control used to police `groupOrder` (par groups) only — so a
          // par group could be renamed straight onto a live LED strand group's
          // name and silently fuse their view bit.
          const clash = groupRenameError(nn, {
            currentName: groupName,
            takenNames: collectSceneGroupNames(params),
          });
          if (clash) { alert(clash); return; }
          // Undoable, like every other group mutation on this toolbar (+ Light,
          // ✕ Delete, the LED-strand rename). This path had no pushUndo at all,
          // so a mistyped rename was unrecoverable.
          pushUndo();
          let movedCount = 0;
          params.parLights.forEach((c) => {
            if (c.group === groupName) { c.group = nn; movedCount += 1; }
          });
          // Carry the group master override across the rename (keyed by name).
          if (params.groupOverrides && params.groupOverrides[groupName]) {
            params.groupOverrides[nn] = params.groupOverrides[groupName];
            delete params.groupOverrides[groupName];
          }
          // Carry the group's view-mask bit across the rename so
          // patterns compiled against MASK_* names stay stable.
          if (window.viewRegistryRenameGroup) window.viewRegistryRenameGroup(groupName, nn);
          // 2D Pixel Map views name groups in their selectors — re-point them
          // or this rename silently empties every panel that named the group
          // (plan 20260725_44 step 12).
          migratePixelMapGroupSelectors(groupName, nn);
          // Batch entries cache `entry.group` and view isolation reads it
          // (animate.js:580), so a group rename MUST invalidate the batch
          // cache — the LED group rename already does (`led_group_rename`);
          // this path did not, leaving isolation keyed on the dead name.
          if (window.invalidateMarsinBatchCache) {
            window.invalidateMarsinBatchCache('par_group_rename');
          }
          // Loud, itemised: what was carried, what was untouched, and the one
          // consequence nothing else surfaces — the exported engine model still
          // names the OLD group (the stale-model banner only watches pixel count).
          buildGroupRenameReport({
            oldName: groupName, newName: nn, memberCount: movedCount, kind: 'Par',
          }).forEach((line) => console.warn(line));
          _showAutoToast(`✏ Group "${groupName}" → "${nn}" (${movedCount} fixture(s)) — ` +
            'addresses untouched; RE-EXPORT the engine model');
          if (window._setGuiRebuilding) window._setGuiRebuilding(true);
          renderParGUI();
          if (window._setGuiRebuilding) window._setGuiRebuilding(false);
          debounceAutoSave();
        };

        // Fixture type selector + add button. Basis 110px: it is the only item on
        // this row that can honestly shrink (a <select> shows its value, not a
        // label), so when the pane is narrow this is what wraps to its own line
        // and the two text buttons stay whole.
        const addWrap = document.createElement('div');
        addWrap.style.cssText = 'display:flex;gap:2px;flex:1 1 110px;min-width:0;';
        const typeSelect = document.createElement('select');
        // NOT `min-width:0`: a <select> with a zero automatic minimum collapses
        // to nothing on the wrapped row (measured — the type name disappeared and
        // only the green "+" survived). Its intrinsic minimum is what keeps the
        // fixture type readable; the row wraps around it instead.
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
            controllerId: 0, sectionId: 0, fixtureId: 0, viewMask: 0, viewMaskHi: 0,
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
        delBtn.title = `Dissolve the group "${groupName}" (its fixtures move to another group)`;
        delBtn.style.cssText = LABEL_BTN;
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
          if (config.viewMaskHi === undefined) config.viewMaskHi = 0;

          const idxFolder = groupFolder.addFolder(config.name);
          idxFolder.domElement.classList.add('gui-card');
          idxFolder.close();
          window.parGuiFolders[index] = idxFolder;

          if (config.fixtureType === 'TEFogMachine' || config.fixtureType === 'ChauvetHaze4D') {
            const holdBtn = document.createElement('button');
            holdBtn.textContent = '💨 Hold to Fog';
            holdBtn.style.cssText = 'width:calc(100% - 16px);margin:4px 8px;padding:4px;border:none;border-radius:3px;background:color-mix(in srgb, var(--error) 15%, var(--surface));color:var(--error);cursor:pointer;font-size:10px;font-weight:bold;';
            // ── Hold to Fog — the ENGINE fires it (report 20260805_171) ──
            //
            // This used to write DMX into the browser-local router and rely on
            // the browser transmitting to the controller. The browser is not the
            // router: it POSTs `/fog`, and the engine writes the fog channels on
            // the normal engine → bridge → controller route.
            //
            // `/fog` is a DEADMAN, not a latch: the engine holds the fogger only
            // for `holdMs` and switches it off itself if we stop refreshing. That
            // preserves the one virtue the old browser path had by accident — a
            // closed tab or a dead renderer stopped the fog — which on a fog
            // machine is a real-world safety property, not a style choice. So a
            // held button re-POSTs on an interval, and release POSTs `false`.
            const FOG_REFRESH_MS = 600;
            const FOG_HOLD_MS = 1500;      // > 2× the refresh, so one dropped POST does not stutter
            let fogRefreshTimer = null;
            const postFog = (state) => {
              if (isStaticHost()) {
                logStaticHostSkip('engine /fog (port 6968)');
                return;
              }
              fetch(engineHttpUrl('/fog'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: !!state, holdMs: FOG_HOLD_MS }),
              }).catch(() => {}); // engine may not be running; the deadman covers us
            };
            const toggleFog = (state) => {
              // Local PREVIEW only — the 3D fog puff. No DMX leaves this window.
              [...(window.parFixtures || []), ...(window.dmxSceneFixtures || [])].forEach(f => {
                if (f && f.config && (f.config.fixtureType === 'TEFogMachine' || f.config.fixtureType === 'ChauvetHaze4D' || f.config.type === 'TEFogMachine' || f.config.type === 'ChauvetHaze4D')) {
                  f._uiFogOverride = state;
                }
              });

              if (fogRefreshTimer) { clearInterval(fogRefreshTimer); fogRefreshTimer = null; }
              postFog(state);
              if (state) fogRefreshTimer = setInterval(() => postFog(true), FOG_REFRESH_MS);
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

          // Name — check + invalidate (plan 20260725_44 step 11). NOTE: 'name'
          // is deliberately NOT propagated to the rest of the selection: it
          // used to stamp the SAME name onto every selected fixture, which
          // mass-produced duplicates that collapse to one patches.yaml record
          // and hard-fail the next scene load.
          let committedParName = config.name;
          const parNameCtrl = idxFolder.add(config, "name").name("Name");
          parNameCtrl.onFinishChange((v) => {
            const proposed = (v || '').trim();
            if (proposed === committedParName) {
              config.name = committedParName;
              parNameCtrl.updateDisplay();
              return;
            }
            if (!renameSingleFixture(config, committedParName, proposed, parNameCtrl)) return;
            committedParName = proposed;
            idxFolder.title(proposed);
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

          // Local halo override — the third factor in
          //   effective halo = class base × Global Halo Size × local
          // (led_halo.js; operator 2026-07-30 "local is maybe a scale for the
          // global"). Seeded to 1 when the folder is built — lil-gui needs the
          // property to exist — exactly like diffusionAmount/screenPixelSize
          // above; 1.0 is the no-op default, so seeding changes no pixel and
          // only reaches disk on the operator's next save. syncLightFromConfig
          // re-reads it, and propagateToSelected gives the bulk-set across a
          // selection for free — the same mechanism every other numeric
          // property in this panel uses.
          if (config.haloScale === undefined) config.haloScale = 1;
          idxFolder.add(config, "haloScale",
            LOCAL_HALO_SCALE_MIN, LOCAL_HALO_SCALE_MAX, 0.05).name("Halo ×").onChange((v) => {
            selectThisLight();
            window.syncLightFromConfig(index);
            propagateToSelected(index, 'haloScale', v);
          });

          // ── LED-only controls: diffusion (soft glow) + resize ──
          // Shown only for LED-bus fixtures (Ango 4 panels/ropes); a DMX
          // par/bar has no size to resize and uses its beam, not a glow.
          const _ledDef = getDefinition(config.fixtureType);
          if (_ledDef && _ledDef.bus === 'led') {
            if (config.diffusion === undefined) config.diffusion = false;
            if (config.diffusionAmount === undefined) config.diffusionAmount = 2.5;
            if (config.screen === undefined) config.screen = false;
            if (config.screenPixelSize === undefined) config.screenPixelSize = 60;
            if (config.scaleX === undefined) config.scaleX = 1;
            if (config.scaleY === undefined) config.scaleY = 1;
            if (config.scaleZ === undefined) config.scaleZ = 1;

            idxFolder.add(config, "diffusion").name("Diffusion (glow)").onChange(() => {
              selectThisLight();
              window.syncLightFromConfig(index);
            });
            idxFolder.add(config, "diffusionAmount", 1, 6, 0.1).name("Diffusion Amt").onChange(() => {
              selectThisLight();
              window.syncLightFromConfig(index);
            });

            // Diffusor screen: a milky-white polycarb panel across the fixture
            // face that blends the LED colors into a 2D surface. Pixel Size is
            // the per-LED bleed radius (mm) — bigger = softer, more merged.
            // Live per frame, so no syncLightFromConfig() needed to repaint.
            idxFolder.add(config, "screen").name("Screen (diffusor)").onChange(() => {
              selectThisLight();
            });
            idxFolder.add(config, "screenPixelSize", 10, 300, 5).name("Pixel Size (mm)").onChange(() => {
              selectThisLight();
            });

            // Resize (matches the S / scale gizmo — same config.scaleX/Y/Z).
            // Deliberately NOT propagated to other selected fixtures: the scale
            // gizmo only resizes the dragged fixture, and propagating would
            // write dead scaleX/Y/Z keys into non-LED (DMX) configs.
            const scaleFolder = idxFolder.addFolder("Scale (Resize)");
            scaleFolder.close();
            ['scaleX', 'scaleY', 'scaleZ'].forEach((ax) => {
              scaleFolder.add(config, ax, 0.1, 20, 0.1).onChange(() => {
                selectThisLight();
                window.syncLightFromConfig(index);
              });
            });
          }

          // Lock-aware Position/Rotation binding. In a LOCKED group a numeric
          // edit moves the WHOLE group rigidly (applyLockedParNumericMove); in an
          // unlocked group it behaves exactly as before (propagateToSelected). We
          // snapshot the pre-edit value in the CAPTURE phase of every input event
          // (pointer/keyboard/wheel/focus) so the rigid delta is always correct,
          // even after an intervening gizmo move.
          const addLockAwareAxis = (folder, field, min, max, stepArg) => {
            const ctrl = folder.add(config, field, min, max, stepArg);
            let prev = config[field];
            const snap = () => { prev = config[field]; };
            if (ctrl.domElement) {
              ['pointerdown', 'focusin', 'wheel', 'keydown'].forEach((ev) =>
                ctrl.domElement.addEventListener(ev, snap, { capture: true }));
            }
            ctrl.onChange((v) => {
              selectThisLight();
              window.syncLightFromConfig(index);
              if (!applyLockedParNumericMove(index, field, v, prev)) {
                propagateToSelected(index, field, v);
              }
              prev = v;
            });
            return ctrl;
          };

          // Position
          const posFolder = idxFolder.addFolder("Position");
          posFolder.close();
          addLockAwareAxis(posFolder, "x", -200, 200, 0.01);
          addLockAwareAxis(posFolder, "y", 0, 100, 0.01);
          addLockAwareAxis(posFolder, "z", -200, 200, 0.01);

          // Rotation
          const rotFolder = idxFolder.addFolder("Rotation");
          rotFolder.close();
          const step = params.snapAngle || 5;
          addLockAwareAxis(rotFolder, "rotX", -180, 180, step);
          addLockAwareAxis(rotFolder, "rotY", -180, 180, step);
          addLockAwareAxis(rotFolder, "rotZ", -180, 180, step);

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
          displayGroupOrder.forEach((g) => {
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

      // LED-class (sign) group folders were just (re-)appended to the LED Fixture
      // Instances list AFTER any strand group folders. Pin them to the TOP of that
      // list for deterministic ordering (design D4: sign groups top, Ungrouped
      // last). No-op when the LED section is not built yet (DMX-first render).
      if (window._orderLedFixtureInstances) window._orderLedFixtureInstances();
    }

    // ─── Add Group button ───
    parFolder
      .add(
        {
          addGroup: () => {
            const existingGroups = new Set(params.parLights.map(c => c.group || 'Default'));
            const name = prompt('New group name:', `Group ${existingGroups.size + 1}`);
            if (name === null) return;
            const nn = (name || '').trim();
            // Same scene-wide guard the renames use (report _52). This seed had
            // NO guard at all: an empty name produced a group literally called
            // "", and a name colliding with a generator group silently converted
            // the new fixture into a trace-generated one on the next scene load
            // (config.js re-stamps `traceGenerated` on a groupName match).
            const clash = groupRenameError(nn, {
              currentName: null, takenNames: collectSceneGroupNames(params),
            });
            if (clash) { alert(clash); return; }
            pushUndo();
            params.parLights.push({
              group: nn,
              name: `Par Light ${params.parLights.length + 1}`,
              color: '#ffaa44', intensity: 5, angle: 20, penumbra: 0.5,
              x: 0, y: 1.5, z: 0, rotX: 0, rotY: 0, rotZ: 0,
              controllerId: 0, sectionId: 0, fixtureId: 0, viewMask: 0, viewMaskHi: 0,
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
      // The chain-order overlay is BUILT here and DISPOSED here — it is never
      // left in the scene switched off. Hiding generators must cost nothing,
      // not "cost traversal on invisible objects" (report 20260725_38).
      refreshAllChainOrderViz();
    }
    window.setTraceObjectsVisibility = setTraceObjectsVisibility;

    // Ask the gate and apply the answer. Every caller that used to compute
    // visibility itself (`params.generatorsVisible !== false`, `v &&
    // params.generatorsVisible`) goes through here instead, so the toggle, the
    // par-lights master and the beauty-profile default can never disagree.
    function applyTraceVisualsVisibility() {
      setTraceObjectsVisibility(traceVisualsShouldShow(params));
    }
    window.applyTraceVisualsVisibility = applyTraceVisualsVisibility;

    // --- Trace 3D objects live here ---
    window.traceObjects = window.traceObjects || [];

    // destroyTraceObjects is declared once, next to rebuildTraceObjects below
    // (hoisted, so it is in scope here). A second copy that once lived here
    // shadowed nothing but confused editors — see report 20260725_43.

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

      // `traceFocusPoint` uses `??`, not `||` — a generator standing at y = 0
      // is a real placement, and the camera must fly to it, not to y = 5.
      const focus = traceFocusPoint(trace);
      const targetX = focus.x, targetY = focus.y, targetZ = focus.z;

      const p1 = new THREE.Vector3(trace.startX ?? 0, trace.startY ?? 5, trace.startZ ?? 0);
      const p2 = new THREE.Vector3(trace.endX ?? 0, trace.endY ?? 5, trace.endZ ?? 0);
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

    // ═══════════════════════════════════════════════════════════════════════
    // ─── The generator anchor: ONE computation, live and reload ────────────
    // ═══════════════════════════════════════════════════════════════════════
    // Report 20260725_83. Everything that needs to know where a generator sits
    // — its visual group, its drag hitbox, the fly-to camera and the fixture
    // generation — asks these two helpers, and they ask `trace_anchor.js`,
    // which reads the trace's own fields. Nothing reads the anchor back out of
    // the scene graph any more, so a stale/absent THREE group can no longer
    // place fixtures against yesterday's position, and a reload cannot land
    // them anywhere the live edit did not.

    /** World matrix of a circle trace's local path space, from the trace alone. */
    function traceAnchorMatrix(trace) {
      const a = traceAnchor(trace);
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(a.rotX),
        THREE.MathUtils.degToRad(a.rotY),
        THREE.MathUtils.degToRad(a.rotZ), 'YXZ'));
      return new THREE.Matrix4().compose(
        new THREE.Vector3(a.x, a.y, a.z), quat, new THREE.Vector3(1, 1, 1));
    }

    /** Place a THREE object on a trace's anchor (visual group, hitbox). */
    function applyTraceAnchor(object3d, trace) {
      if (!object3d) return;
      const a = traceAnchor(trace);
      object3d.position.set(a.x, a.y, a.z);
      object3d.setRotationFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(a.rotX),
        THREE.MathUtils.degToRad(a.rotY),
        THREE.MathUtils.degToRad(a.rotZ), 'YXZ'));
      object3d.updateMatrixWorld(true);
    }

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
        // ONE anchor computation (report 20260725_83). The y coordinate used to
        // be OR-defaulted to 5, so a generator standing on the deck (y = 0) was
        // rebuilt 5 m in the air on every reload — and the boot regeneration
        // then placed its fixtures up there with it.
        applyTraceAnchor(grp, trace);

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
        // Same anchor as the group — derived from the trace, not copied from a
        // sibling object, so the two can never drift apart.
        applyTraceAnchor(hitbox, trace);
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

    // ═══════════════════════════════════════════════════════════════════════
    // ─── Chain-order overlay (⛓ what the cable actually does) ─────────────
    // ═══════════════════════════════════════════════════════════════════════
    // Draws `trace.chainSplits` in the 3D view: one coloured polyline per
    // split walking the fixtures in DAISY-CHAIN order, a comet ramp + an
    // arrowhead on every step for direction, a dashed grey hop where the cable
    // jumps from one run to the next, and the post-renumber chain NUMBER over
    // each light. The operator's 4→5 / 3→2 / 1 reads as three runs at a
    // glance instead of as a table of indices. Plan: `chain_order_visual.js`
    // (pure, unit-tested); this half is geometry only.
    //
    // ── PERF CONTRACT (memory: sim-perf-per-object-explosion) ──────────────
    // Scene-graph OBJECT COUNT is what kills this sim, and report 20260725_38
    // found trace visuals sitting in the scene invisible and still paying
    // traversal. So these are BUILT ON SHOW and DISPOSED ON HIDE, never merely
    // `visible = false`: with generators hidden (or the overlay toggled off)
    // the chain costs exactly zero objects, zero geometries, zero draw calls.
    // Per visible trace the cost is bounded and small:
    //   1 LineSegments (all runs, vertex-coloured) + 1 dashed LineSegments
    //   (only when there is more than one run) + 1 InstancedMesh (every
    //   arrowhead, count−1 instances) + one label Sprite per fixture.
    // = fixtures + 3 objects per visible trace. Nothing is per-PIXEL, and
    // label textures/materials are cached across every trace and rebuild, so
    // a splits edit allocates no textures at all.
    const CHAIN_VIZ_LIFT = 0.38;          // world units the chain rides above the path
    const CHAIN_VIZ_LABEL_LIFT = 0.95;    // labels sit above the chain line
    const CHAIN_VIZ_LABEL_SCALE = 0.85;
    const CHAIN_VIZ_ARROW_LENGTH = 0.44;
    const CHAIN_VIZ_ARROW_RADIUS = 0.15;
    const CHAIN_VIZ_LABEL_TEX_PX = 64;
    const CHAIN_VIZ_UP = new THREE.Vector3(0, 1, 0);

    // Label glyph textures + sprite materials, cached FOREVER and shared by
    // every trace. Bounded by (chain numbers seen) × (palette size), i.e. tens
    // of entries on the titanic scene — so a splits drag re-parents sprites
    // instead of minting canvases. Never disposed: that is the point.
    const _chainLabelTextures = new Map();  // "12"          → CanvasTexture
    const _chainLabelMaterials = new Map(); // "12|#00e5ff"  → SpriteMaterial

    function chainLabelTexture(text) {
      const cached = _chainLabelTextures.get(text);
      if (cached) return cached;
      const size = CHAIN_VIZ_LABEL_TEX_PX;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      // White glyph on transparent, black outline. The sprite material tints
      // it to the run colour — white multiplies to the colour, black stays
      // black, so the outline keeps the number readable over any background.
      const fontPx = Math.round(size * (text.length >= 3 ? 0.42 : text.length === 2 ? 0.56 : 0.72));
      ctx.font = `bold ${fontPx}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, Math.round(fontPx * 0.22));
      ctx.strokeStyle = '#000000';
      ctx.strokeText(text, size / 2, size / 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, size / 2, size / 2);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      _chainLabelTextures.set(text, texture);
      return texture;
    }

    function chainLabelMaterial(text, colorHex) {
      const key = `${text}|${colorHex}`;
      const cached = _chainLabelMaterials.get(key);
      if (cached) return cached;
      const material = new THREE.SpriteMaterial({
        map: chainLabelTexture(text),
        color: new THREE.Color(colorHex),
        transparent: true,
        depthWrite: false,
      });
      _chainLabelMaterials.set(key, material);
      return material;
    }

    // Should trace `tObj` be carrying a chain overlay right now? The gate is
    // the SAME affordance the rest of the trace visuals use — the group's own
    // visibility, which `setTraceObjectsVisibility` drives from the one gate in
    // `trace_visual_gate.js` (`generatorsVisible`, `parsEnabled`, and the
    // beauty-profile default) — plus the overlay's own toggle. One question,
    // one answer, no second notion of "shown". So in a beauty profile the chain
    // overlay follows Show Generators back on, exactly as it always has.
    function chainVizShouldShow(tObj) {
      if (!tObj || !tObj.group) return false;
      if (params.chainOrderVisible === false) return false;
      return tObj.group.visible === true;
    }

    function disposeChainOrderVisual(tObj) {
      const viz = tObj && tObj.chainViz;
      if (!viz) return;
      viz.objects.forEach((o) => { if (o.parent) o.parent.remove(o); });
      viz.geometries.forEach((g) => g.dispose());
      // Only the per-trace materials — label materials are the shared cache.
      viz.materials.forEach((m) => m.dispose());
      tObj.chainViz = null;
    }

    // Identity of the CHAIN TOPOLOGY an overlay was built for. When this and
    // the fixture count still match, a geometry change (a drag) only needs the
    // existing objects moved; when either changes, the overlay is rebuilt.
    function chainVizTopologyKey(splits) {
      return Array.isArray(splits) ? JSON.stringify(splits) : 'path-order';
    }

    // Scratch vectors for the in-place position sync. Hoisted so a drag —
    // which calls the sync on every pointer move — allocates nothing.
    const _chainSyncA = new THREE.Vector3();
    const _chainSyncB = new THREE.Vector3();
    const _chainSyncMid = new THREE.Vector3();
    const _chainSyncDir = new THREE.Vector3();
    const _chainSyncQuat = new THREE.Quaternion();
    const _chainSyncMtx = new THREE.Matrix4();
    const _chainSyncScale = new THREE.Vector3(1, 1, 1);
    const _chainSyncZero = new THREE.Vector3(0, 0, 0);

    // Build the overlay for one trace into its visual group. Points come from
    // `computeTracePoints`, exactly like the preview dots, so circle traces
    // (whose points are group-local) and line/corner traces (world) both work
    // with no special-casing: everything is parented to `tObj.group`.
    function buildChainOrderVisual(trace, tObj) {
      const pts = computeTracePoints(trace);
      const count = pts.length;
      if (count < 1) return;
      // Invalid splits draw NOTHING. The generator refuses to build them and
      // the card already shows the red `⚠ CHAIN SPLITS INVALID` badge; drawing
      // a plausible-looking chain that will never be generated would be a lie.
      if (chainSplitsError(trace.chainSplits, count) !== null) return;

      const runs = buildChainRuns(trace.chainSplits, count);
      const jumps = chainJumpSegments(runs);
      const group = tObj.group;
      const objects = [];
      const geometries = [];
      const materials = [];
      let runLine = null;
      let jumpLine = null;
      let arrows = null;
      const labels = [];

      const pointAt = (pathPosition) =>
        pts[pathPosition - 1].clone().addScaledVector(CHAIN_VIZ_UP, CHAIN_VIZ_LIFT);

      // ── One flat list of cable steps: run-internal steps carry the run's
      // colour and its comet ramp, jumps are dashed grey. Together they are
      // the whole walk, so there are always exactly count−1 of them.
      const runSteps = [];
      const jumpSteps = [];
      runs.forEach((run) => {
        const positions = run.pathPositions;
        for (let k = 0; k < positions.length - 1; k++) {
          runSteps.push({
            fromPathPosition: positions[k],
            toPathPosition: positions[k + 1],
            a: pointAt(positions[k]),
            b: pointAt(positions[k + 1]),
            colorHex: run.colorHex,
            mixA: cometMix(k, positions.length),
            mixB: cometMix(k + 1, positions.length),
          });
        }
      });
      jumps.forEach((jump) => {
        jumpSteps.push({
          fromPathPosition: jump.fromPathPosition,
          toPathPosition: jump.toPathPosition,
          a: pointAt(jump.fromPathPosition),
          b: pointAt(jump.toPathPosition),
          colorHex: CHAIN_JUMP_COLOR,
          mixA: 1,
          mixB: 1,
        });
      });

      // ── The runs: ONE LineSegments for all of them, vertex-coloured. Each
      // run fades from `COMET_MIN_MIX` at its first light to full at its last,
      // so direction is legible even from an angle where an arrowhead
      // foreshortens into a dot.
      if (runSteps.length > 0) {
        const positions = new Float32Array(runSteps.length * 6);
        const colors = new Float32Array(runSteps.length * 6);
        const rgb = new THREE.Color();
        runSteps.forEach((step, s) => {
          positions.set([step.a.x, step.a.y, step.a.z, step.b.x, step.b.y, step.b.z], s * 6);
          rgb.set(step.colorHex);
          colors.set([
            rgb.r * step.mixA, rgb.g * step.mixA, rgb.b * step.mixA,
            rgb.r * step.mixB, rgb.g * step.mixB, rgb.b * step.mixB,
          ], s * 6);
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
        const line = new THREE.LineSegments(geo, mat);
        group.add(line);
        objects.push(line);
        geometries.push(geo);
        materials.push(mat);
        runLine = line;
      }

      // ── The jumps: dashed grey, because the cable really does leave the
      // drawn path here. Without them three colours look like three cables.
      if (jumpSteps.length > 0) {
        const jumpPoints = [];
        jumpSteps.forEach((step) => { jumpPoints.push(step.a, step.b); });
        const geo = new THREE.BufferGeometry().setFromPoints(jumpPoints);
        const mat = new THREE.LineDashedMaterial({
          color: new THREE.Color(CHAIN_JUMP_COLOR),
          dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.7,
        });
        const line = new THREE.LineSegments(geo, mat);
        line.computeLineDistances();
        group.add(line);
        objects.push(line);
        geometries.push(geo);
        materials.push(mat);
        jumpLine = line;
      }

      // ── Arrowheads: every cable step, run steps and jumps alike, in ONE
      // InstancedMesh. Per-instance colour carries the run colour (grey for a
      // jump) — never one Mesh per arrow.
      const arrowSteps = runSteps.concat(jumpSteps);
      if (arrowSteps.length > 0) {
        const geo = new THREE.ConeGeometry(CHAIN_VIZ_ARROW_RADIUS, CHAIN_VIZ_ARROW_LENGTH, 6);
        const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 });
        arrows = new THREE.InstancedMesh(geo, mat, arrowSteps.length);
        const rgb = new THREE.Color();
        arrowSteps.forEach((step, s) => {
          arrows.setMatrixAt(s, chainArrowMatrix(step.a, step.b));
          rgb.set(step.colorHex).multiplyScalar(step.mixB);
          arrows.setColorAt(s, rgb);
        });
        arrows.instanceMatrix.needsUpdate = true;
        if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;
        group.add(arrows);
        objects.push(arrows);
        geometries.push(geo);
        materials.push(mat);
      }

      // ── Chain numbers: the post-renumber fixture number over each light,
      // tinted to its run so a number and its run are never ambiguous.
      //
      // INDEX ONLY — operator ruling, 2026-07-29: "I don't like the names on
      // the generator guides too messy, just the index is enough". A build
      // that floated the full `"<group> <n>"` fixture name here was measured
      // at ~7.6× wider than tall per label, which crowds a par ring into
      // unreadable overlap. The generator's own card is where the group name
      // belongs; the guide stays a number.
      chainLabelPlan(trace.chainSplits, count).forEach((label) => {
        const sprite = new THREE.Sprite(chainLabelMaterial(String(label.number), label.colorHex));
        sprite.position.copy(pts[label.pathPosition - 1])
          .addScaledVector(CHAIN_VIZ_UP, CHAIN_VIZ_LABEL_LIFT);
        sprite.scale.setScalar(CHAIN_VIZ_LABEL_SCALE);
        sprite.userData.chainNumber = label.number;
        group.add(sprite);
        objects.push(sprite);
        labels.push({ sprite, pathPosition: label.pathPosition });
      });

      // Marked so a scene census can prove the "nothing lingers when hidden"
      // contract independently of this module's own bookkeeping.
      objects.forEach((o) => { o.userData.isChainViz = true; });

      tObj.chainViz = {
        objects, geometries, materials,
        // Everything `syncChainOrderVizPositions` needs to move the overlay
        // without rebuilding it: the topology it was built for, and the step
        // list in the SAME order as the line vertices and arrow instances.
        count,
        topologyKey: chainVizTopologyKey(trace.chainSplits),
        runSteps, jumpSteps, runLine, jumpLine, arrows, labels,
      };
    }

    // Pose one arrowhead at the midpoint of a→b, aimed along it. Returns the
    // shared scratch matrix — copy it out if you need to keep it.
    function chainArrowMatrix(a, b) {
      _chainSyncDir.subVectors(b, a);
      const length = _chainSyncDir.length();
      _chainSyncMid.addVectors(a, b).multiplyScalar(0.5);
      if (length < 1e-6) {
        // Coincident points cannot define a direction. Collapse the arrow to
        // zero scale rather than inventing one — an unaimed cone would read as
        // a wiring direction that nobody declared.
        _chainSyncMtx.compose(_chainSyncMid, _chainSyncQuat.identity(), _chainSyncZero);
      } else {
        _chainSyncDir.divideScalar(length);
        _chainSyncQuat.setFromUnitVectors(CHAIN_VIZ_UP, _chainSyncDir);
        _chainSyncMtx.compose(_chainSyncMid, _chainSyncQuat, _chainSyncScale);
      }
      return _chainSyncMtx;
    }

    // Move an existing overlay onto new fixture positions WITHOUT rebuilding
    // it — the drag path. Nothing is allocated here: buffers are rewritten in
    // place and the maths runs through the hoisted scratch vectors. Colours
    // and numbers cannot change without the topology changing, so when the
    // topology (or the count) has moved we hand off to a full rebuild.
    function syncChainOrderVizPositions(traceIndex) {
      const tObj = (window.traceObjects || [])[traceIndex];
      const viz = tObj && tObj.chainViz;
      if (!viz) { refreshChainOrderViz(traceIndex); return; }
      const trace = params.traces[traceIndex];
      if (!trace) { refreshChainOrderViz(traceIndex); return; }

      const pts = computeTracePoints(trace);
      if (pts.length !== viz.count ||
          chainVizTopologyKey(trace.chainSplits) !== viz.topologyKey) {
        refreshChainOrderViz(traceIndex);
        return;
      }

      const readPoint = (target, pathPosition) =>
        target.copy(pts[pathPosition - 1]).addScaledVector(CHAIN_VIZ_UP, CHAIN_VIZ_LIFT);

      if (viz.runLine) {
        const attr = viz.runLine.geometry.getAttribute('position');
        viz.runSteps.forEach((step, s) => {
          readPoint(_chainSyncA, step.fromPathPosition);
          readPoint(_chainSyncB, step.toPathPosition);
          attr.setXYZ(s * 2, _chainSyncA.x, _chainSyncA.y, _chainSyncA.z);
          attr.setXYZ(s * 2 + 1, _chainSyncB.x, _chainSyncB.y, _chainSyncB.z);
        });
        attr.needsUpdate = true;
        viz.runLine.geometry.computeBoundingSphere();
      }

      if (viz.jumpLine) {
        const attr = viz.jumpLine.geometry.getAttribute('position');
        viz.jumpSteps.forEach((step, s) => {
          readPoint(_chainSyncA, step.fromPathPosition);
          readPoint(_chainSyncB, step.toPathPosition);
          attr.setXYZ(s * 2, _chainSyncA.x, _chainSyncA.y, _chainSyncA.z);
          attr.setXYZ(s * 2 + 1, _chainSyncB.x, _chainSyncB.y, _chainSyncB.z);
        });
        attr.needsUpdate = true;
        viz.jumpLine.geometry.computeBoundingSphere();
        viz.jumpLine.computeLineDistances();
      }

      if (viz.arrows) {
        const steps = viz.runSteps.concat(viz.jumpSteps);
        steps.forEach((step, s) => {
          readPoint(_chainSyncA, step.fromPathPosition);
          readPoint(_chainSyncB, step.toPathPosition);
          viz.arrows.setMatrixAt(s, chainArrowMatrix(_chainSyncA, _chainSyncB));
        });
        viz.arrows.instanceMatrix.needsUpdate = true;
        viz.arrows.computeBoundingSphere();
      }

      viz.labels.forEach((label) => {
        label.sprite.position.copy(pts[label.pathPosition - 1])
          .addScaledVector(CHAIN_VIZ_UP, CHAIN_VIZ_LABEL_LIFT);
      });
    }

    // A trace's visual group was thrown away and replaced (the line/corner
    // handle drags do that on every pointer move). Re-parent the overlay onto
    // the new group and move it, instead of paying a rebuild per frame.
    function reparentChainOrderViz(traceIndex) {
      const tObj = (window.traceObjects || [])[traceIndex];
      const viz = tObj && tObj.chainViz;
      if (!viz || !tObj.group) { refreshChainOrderViz(traceIndex); return; }
      viz.objects.forEach((o) => tObj.group.add(o));
      syncChainOrderVizPositions(traceIndex);
    }

    // The ONE entry point: drop whatever overlay a trace has and rebuild it if
    // (and only if) it should be on screen. Every caller — visibility toggles,
    // splits edits, ⇄ Swap, Regenerate, handle drags — goes through here, so
    // the overlay can never lag the chain it describes.
    function refreshChainOrderViz(traceIndex) {
      const tObj = (window.traceObjects || [])[traceIndex];
      if (!tObj) return;
      disposeChainOrderVisual(tObj);
      if (!chainVizShouldShow(tObj)) return;
      const trace = params.traces[traceIndex];
      if (!trace) return;
      buildChainOrderVisual(trace, tObj);
    }
    window.refreshChainOrderViz = refreshChainOrderViz;

    function refreshAllChainOrderViz() {
      (window.traceObjects || []).forEach((_, i) => refreshChainOrderViz(i));
    }
    window.refreshAllChainOrderViz = refreshAllChainOrderViz;

    // Which trace object is the transform gizmo currently holding? Returned as
    // an INDEX + a role, never as the mesh itself, so it can survive a rebuild.
    // Report 20260725_83: nothing detached the gizmo before, so after any
    // `rebuildTraceObjects()` (a radius / arc / count / start / end edit, a
    // generator add or delete, an undo) it stayed attached to a mesh that had
    // been removed from the scene. Dragging that orphan wrote the trace fields
    // while the live objects — and therefore the generated fixtures — stayed
    // exactly where they were.
    function captureTraceGizmoTarget() {
      const held = transformControl && transformControl.object;
      if (!held) return null;
      const objects = window.traceObjects || [];
      for (let i = 0; i < objects.length; i++) {
        const tObj = objects[i];
        if (!tObj) continue;
        if (tObj.hitbox === held) return { traceIndex: i, handleType: null };
        const handle = (tObj.handles || []).find((h) => h === held);
        if (handle) {
          return { traceIndex: i, handleType: handle.userData.handleType ?? null };
        }
      }
      return null;
    }

    // Re-attach the gizmo to the rebuilt equivalent of what it held. A trace
    // that no longer exists (deleted) leaves the gizmo detached — that is the
    // truth, not a fallback.
    function restoreTraceGizmoTarget(target) {
      if (!target || !transformControl) return;
      const tObj = (window.traceObjects || [])[target.traceIndex];
      if (!tObj) return;
      const next = target.handleType === null
        ? tObj.hitbox
        : (tObj.handles || []).find((h) => h.userData.handleType === target.handleType);
      if (next) transformControl.attach(next);
    }

    function destroyTraceObjects() {
      if (!window.traceObjects) window.traceObjects = [];
      // Never leave the gizmo holding a mesh we are about to remove.
      if (transformControl && captureTraceGizmoTarget()) transformControl.detach();
      window.traceObjects.forEach(tObj => {
        disposeChainOrderVisual(tObj);
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
      const gizmoTarget = captureTraceGizmoTarget();
      destroyTraceObjects();
      params.traces.forEach((trace, i) => {
        window.traceObjects.push(buildTraceObject(trace, i));
      });
      // Apply initial visibility: toggle + par master + beauty-profile default
      applyTraceVisualsVisibility();
      // The operator's selection survives the rebuild — on the LIVE mesh.
      restoreTraceGizmoTarget(gizmoTarget);
    }
    window.rebuildTraceObjects = rebuildTraceObjects;

    function updateTracePreview(traceIndex) {
      rebuildTraceObjects();
    }

    // ── Generator GEOMETRY fields (report 20260725_83) ────────────────────
    // Radius, arc, and the line/corner start / corner / end coordinates all
    // used to redraw the preview and stop there: the orange path moved, the
    // generated fixtures did not, and the divergence only surfaced on the next
    // reload (when boot regeneration finally applied the edit). They now go
    // through the SAME cold-move contract as a gizmo drag — cheap preview on
    // every tick, exactly ONE regeneration when the control is released.
    function onTraceGeometryEdit(controller, traceIndex) {
      return controller
        .onChange(() => {
          updateTracePreview(traceIndex);
          const trace = params.traces[traceIndex];
          if (trace && trace.generated) markTraceRegenDirty(traceIndex);
          debounceAutoSave();
        })
        .onFinishChange(() => { window._flushPendingEditorRegens(); });
    }

    // `writeTraceTransformToConfig` used to live here: a SECOND, uncalled
    // writer of trace.x/y/z/rot* that read the hitbox instead of the dragged
    // object. Deleted with report 20260725_83 — the anchor has exactly one
    // writer (`_onTraceTransformChange`) and one reader (`trace_anchor.js`).

    // Trace transform handler — the dragged object writes the TRACE FIELDS,
    // and every visual is re-derived from them (never object-to-object).
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
              // Same anchor the fixtures are generated against.
              const anchorMtx = traceAnchorMatrix(trace);
              if (pts.length > 0) aimOrigin.copy(pts[0]).applyMatrix4(anchorMtx);
              else aimOrigin.setFromMatrixPosition(anchorMtx);
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

          const traceVis = traceVisualsShouldShow(params);
          grp.visible = traceVis;
          if (tObj.aimLine) {
            grp.add(tObj.aimLine);
            tObj.aimLine.visible = traceVis;
          }
          scene.add(grp);
          tObj.group = grp;
          tObj.visuals = visuals;
          tObj.materials = { lineMat, dotMats };
          // The overlay lived in the group that was just replaced — move it to
          // the new one so the chain never lags the geometry it describes.
          reparentChainOrderViz(tIdx);
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

          const traceVis = traceVisualsShouldShow(params);
          grp.visible = traceVis;
          if (tObj.aimLine) {
            grp.add(tObj.aimLine); // re-attach the preserved dash line to the new group
            tObj.aimLine.visible = traceVis;
          }
          scene.add(grp);
          tObj.group = grp;
          tObj.visuals = visuals;
          tObj.materials = { lineMat, dotMats }; // Preserve material refs for highlighting
          // Same as the corner path: the old group is gone, so move the
          // overlay onto the new one.
          reparentChainOrderViz(tIdx);
        }
      } else {
        // ─── CIRCLE anchor moved (the hitbox IS the generator) ─────────────
        // ONE DIRECTION ONLY (report 20260725_83): the dragged object writes
        // the TRACE FIELDS, and every visual is then re-derived FROM those
        // fields. It used to copy the visual group's transform straight off the
        // hitbox — object to object — which silently did nothing whenever the
        // gizmo was still attached to a hitbox a `rebuildTraceObjects()` had
        // already thrown away (any radius/arc/count edit does that, and nothing
        // detached the gizmo). The trace fields moved, the group did not, and
        // the fixtures were generated against the old anchor: "I moved the
        // generator and the lights stayed put."
        const aimHandle = (tObj.handles || []).find(h => h.userData.handleType === 'aim');

        // Carry the aim target by the same translation, exactly as the line and
        // corner handles already do — a moved ring keeps aiming the way the
        // operator placed it instead of pointing back at where it used to be.
        // Rotation-only changes produce a zero delta and move nothing.
        const before = traceAnchor(trace);
        const { dx, dy, dz } = anchorDelta(before, obj.position);

        trace.x = obj.position.x;
        trace.y = obj.position.y;
        trace.z = obj.position.z;
        const euler = new THREE.Euler().setFromQuaternion(obj.quaternion, 'YXZ');
        trace.rotX = THREE.MathUtils.radToDeg(euler.x);
        trace.rotY = THREE.MathUtils.radToDeg(euler.y);
        trace.rotZ = THREE.MathUtils.radToDeg(euler.z);

        if (dx !== 0 || dy !== 0 || dz !== 0) {
          trace.aimX = (trace.aimX || 0) + dx;
          trace.aimY = (trace.aimY || 0) + dy;
          trace.aimZ = (trace.aimZ || 0) + dz;
          if (aimHandle) aimHandle.position.set(trace.aimX, trace.aimY, trace.aimZ);
        }

        // Visuals follow the FIELDS. `obj` may be a stale orphan; these are the
        // live ones and they are now always on the anchor the fixtures use.
        // The live hitbox is skipped when it IS the dragged object — it is
        // already there, and the gizmo owns its quaternion for the rest of the
        // drag.
        applyTraceAnchor(tObj.group, trace);
        if (tObj.hitbox !== obj) applyTraceAnchor(tObj.hitbox, trace);

        if (tObj.aimLine && aimHandle) {
           const pts = computeTracePoints(trace);
           const aimOrigin = new THREE.Vector3();
           const anchorMtx = traceAnchorMatrix(trace);
           if (pts.length > 0) aimOrigin.copy(pts[0]).applyMatrix4(anchorMtx);
           else aimOrigin.setFromMatrixPosition(anchorMtx);
           tObj.aimLine.geometry.setFromPoints([aimOrigin, aimHandle.position]);
           tObj.aimLine.computeLineDistances();
        }
      }
      
      // ── COLD MOVE (report 20260725_44 step 2) ──────────────────────────
      // Everything above this line is the LIGHTWEIGHT editor feedback (trace
      // fields, handles, polyline + preview dots, aim line, chain-order
      // overlay) and keeps tracking the cursor every tick. The fixture
      // regeneration below is the expensive half — generateGroupFromTrace →
      // rebuildParLights destroys and re-creates every fixture mesh/material,
      // and the next frame recompiles their shaders (measured ~2.4 s frame
      // stall PER TICK, 0.4 FPS paced drag, report 20260725_44 §1). While the
      // gizmo is dragging we only MARK the trace dirty; main.js's
      // dragging-changed release seam regenerates exactly once.
      // Operator-ratified semantics (plan §5.1): generated fixtures and the
      // global dot overlay intentionally freeze mid-drag; the generator's own
      // line/handles/dots track live.
      // Outside a drag (undo, programmatic edits, GUI number fields) there is
      // no release event to flush on, so regenerate immediately as before.
      if (trace.generated) {
        if (transformControl && transformControl.dragging) {
          markTraceRegenDirty(tIdx);
        } else {
          generateGroupFromTrace(tIdx, true);
        }
      }

      // Autosave is deferred with the regenerate: a mid-drag save would write a
      // scene whose generator has moved but whose fixtures have not (autoSave
      // on + a 2 s pause mid-drag is enough to trip it). The release seam saves.
      if (!(transformControl && transformControl.dragging)) debounceAutoSave();
      return true;
    };

    // ── Release seam doer (report 20260725_44 step 3) ─────────────────────
    // Called by main.js when the transform gizmo is released. Does ALL the work
    // the drag deferred, exactly once. `takePendingRegens()` clears the ledger,
    // so the strand invalidation here is unconditional — the LED move-trail bug
    // (report 20260725_2) was persistent stale batch coordinates after a drag,
    // and this call is what can never be skipped again.
    window._flushPendingEditorRegens = function() {
      const pending = takePendingRegens();
      for (const tIdx of pending.traces) generateGroupFromTrace(tIdx, true);
      if (pending.strandTransform) {
        if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('strand_transform');
      }
      if (pending.traces.length || pending.strandTransform) debounceAutoSave();
      return { traces: pending.traces.length, strandTransform: pending.strandTransform };
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
      // Same anchor the fixtures are generated against (report 20260725_83) —
      // reading `tObj.group.matrixWorld` here would make a point drag land
      // against a stale group while the generation used the trace fields.
      if (!traceUsesWorldSpacePath(trace)) return local.applyMatrix4(traceAnchorMatrix(trace));
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
      // COLD MOVE (report 20260725_44 step 4): refreshTraceDots IS the
      // lightweight feedback — the dot slides under the cursor. The fixture
      // regeneration is deferred to _endTraceDotDrag. This drag is NOT a
      // TransformControls drag (it has its own _dotDrag state and its own
      // pointerup in interaction.js), so the dirty mark is unconditional here
      // and the flush lives in the end handler below.
      if (trace.generated) markTraceRegenDirty(traceIndex);
      return true;
    };

    window._endTraceDotDrag = function() {
      if (!_dotDrag) return;
      _dotDrag = null;
      // The single deferred regenerate for this drag, BEFORE the autosave, so
      // a save can never persist a trace whose fixtures have not caught up.
      // Same doer as the gizmo release seam — one implementation, one contract.
      window._flushPendingEditorRegens();
      // The point-offset edit itself is a change even when the trace generates
      // nothing, so the save mark is unconditional (the flush's own save call
      // is debounced — a second one costs a clearTimeout).
      debounceAutoSave();
    };

    // Recompute the base (even, pre-offset) arclengths for a trace. Shared by
    // computeTracePoints and the drag math so the two never disagree.
    // The number of lights a trace generates. COUNT is authoritative; this is
    // the ONE place it is rounded/floored, so the base layout, the chain-order
    // gate, the Lights guard and the card all agree on what "1..count" means.
    function traceLightCount(trace) {
      return Math.max(1, Math.round(trace.count ?? 8));
    }

    function computeTraceBaseArclengths(trace, path) {
      // COUNT is authoritative: the user sets the number of lights directly
      // (fixture width is informational only — see the Lights control). This
      // is the single source of truth for the even base layout, shared by
      // computeTracePoints' offset post-processing so the two never diverge.
      const count = traceLightCount(trace);
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
      // Dragging a light along the path moves the chain with it — in place,
      // so a per-pointer-move drag allocates nothing.
      syncChainOrderVizPositions(traceIndex);
    }

    function generateGroupFromTrace(traceIndex, skipUndo = false, previousGroupName = null) {
      const trace = params.traces[traceIndex];
      if (!trace) return;

      // ── Chain-order gate (design 20260725_41 §3.3 / §3.5) ─────────────────
      // `trace.chainSplits` declares the PHYSICAL daisy-chain walk over the
      // trace's path positions and must cover 1..count exactly once. Invalid
      // splits REFUSE the (re)generate outright — before the undo push, before
      // the sweep, before any mutation. Quietly falling back to path order
      // would renumber a mapped group behind the operator's back, which is
      // exactly the fallback the codex forbids.
      const splitsError = chainSplitsError(trace.chainSplits, traceLightCount(trace));
      if (splitsError) {
        const label = trace.groupName || trace.name || `Trace ${traceIndex + 1}`;
        if (window._isAppBooting) {
          // Boot: skip THIS trace's regeneration and keep the fixture rows the
          // scene file already carries. Nothing is invented, the rest of the
          // scene still loads, and the generator card shows a red badge.
          console.error(
            `[chainSplits] Generator "${label}": ${splitsError} — regeneration SKIPPED. ` +
            'The fixtures saved in the scene file are left exactly as they are. Fix the ' +
            'splits under ⛓ Chain Order on the generator card, then Regenerate.');
        } else {
          alert(`⚠ Generator "${label}"\n\nChain Order splits are invalid:\n  ${splitsError}\n\n` +
            'Nothing was generated. Fix or clear the splits (⛓ Chain Order) and try again.');
        }
        return;
      }

      if (!skipUndo) pushUndo();

      // Remove existing lights from this trace's group name AND from any prior
      // name (a rename passes previousGroupName) — otherwise the old-named set
      // is orphaned into duplicate fixtures (report 20260724_37).
      // Regeneration contract with the controller mapping (operator
      // request 2026-06-12): names are stable per index ("<group> N"),
      // so survivors keep their chain entries and re-project to the
      // SAME addresses; fixtures lost to a count shrink just drop
      // (addresses are absolute — nothing shifts). New extras land
      // in the Unmapped tray.
      const groupName = trace.groupName || trace.name || `Trace ${traceIndex + 1}`;
      const { kept, removed: previousGenerated } =
        sweepGeneratedInstances(params.parLights, groupName, previousGroupName);
      params.parLights = kept;

      // Compute points
      const pts = computeTracePoints(trace);
      // Line AND corner produce world-space points (absolute coords).
      // Only circle points are local to the trace's anchor.
      //
      // ── ANCHOR: from the TRACE, never from the scene graph ──────────────
      // Report 20260725_83. This used to fish the trace's visual THREE group
      // out of `window.traceObjects` and use its world transform, with a silent
      // `null` when the group was missing — which placed a circle's fixtures at
      // the raw local ring coordinates, i.e. around the world origin. Worse,
      // that group could be STALE (gizmo attached to a hitbox a rebuild had
      // replaced), so the fixtures were generated against the generator's OLD
      // position while the trace fields already held the new one — the live
      // "lights don't follow" half of the bug, and the reason live and reload
      // disagreed at all.
      // `traceAnchorMatrix` is the same computation `buildTraceObject` places
      // the visual group with, so the ring, the hitbox and the fixtures are one
      // placement by construction, in this session and in every later one.
      const isWorldSpace = traceUsesWorldSpacePath(trace);
      const worldMatrix = isWorldSpace ? null : traceAnchorMatrix(trace);

      let lockedDeltaX = null;
      let lockedDeltaY = null;
      let lockedDeltaZ = null;

      // Per-path-position fixture data, built in PATH order exactly as before.
      // The aim math below is keyed by path position (`pts[0]`, `pts[last]`,
      // the `i === 0` locked-delta latches, `pointOffsets`), so a light at
      // position p aims identically no matter which chain number it ends up
      // with. Only the ASSIGNMENT of numbers to positions is permuted, and
      // that happens after this loop.
      const pointData = new Array(pts.length);

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

        pointData[i] = {
          group: groupName,
          // Filled in at emission below — the number is CHAIN order, not path
          // order. Declared here so the key order (and therefore the scene
          // YAML) is byte-identical to the pre-splits emission.
          name: '',
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
        };
      });

      // ── Emit in CHAIN order ───────────────────────────────────────────────
      // `order[j]` is the path position that receives fixture NUMBER j+1, so
      // "<group> 1" is the first light on the cable. With no chainSplits the
      // order is the identity [1..count] and this is byte-identical to the
      // forward push it replaces. The NAME SET is unchanged either way, which
      // is what keeps the survivor / sticky-address contract below intact.
      const emitted = [...emitInChainOrder(pointData, trace.chainSplits, groupName)];
      for (const record of emitted) {
        params.parLights.push(record);
      }

      trace.generated = true;

      // ── HAND-TWEAK POLICY: RE-SNAP, LOUDLY (report 20260725_83 §4) ────────
      // A trace-generated fixture has nowhere to keep a manual offset — the
      // sweep above threw every one of them away and these records are brand
      // new — so a hand nudge does not survive a regenerate, and never survived
      // a reload either (boot regenerates every `generated: true` trace). The
      // honest thing is to re-snap and SAY SO by name. `detectResnappedFixtures`
      // stays silent unless the group moved as one rigid piece, which is the
      // only case where a deviating fixture provably was hand-placed.
      const resnapped = detectResnappedFixtures(previousGenerated, emitted);
      if (resnapped.names.length > 0) {
        const message = resnapMessage(groupName, resnapped.names);
        console.warn(`[generator] ${message}`);
        if (!window._isAppBooting) showToast(message, { ttl: 14000 });
      }

      // Count shrink: fixtures whose names no longer exist were
      // deleted — drop their mapping entries (the hook reprojects
      // and re-renders the panel itself).
      const survivingNames = new Set();
      for (let n = 1; n <= pts.length; n++) survivingNames.add(`${groupName} ${n}`);
      const regenCasualties = previousGenerated.filter(c => !survivingNames.has(c.name));
      if (window.controllerMappingFixturesRemoved) {
        window.controllerMappingFixturesRemoved(regenCasualties);
      }
      // Pixel-order flags of the fixtures that just went away: cleared HERE and
      // said out loud (design §2.3). A GROW is untouched by this — the surviving
      // names keep their entries and the new members simply have none, so a flip
      // on "<group> 3" survives 4→5 for free.
      clearPixelOrderCasualties(groupName, regenCasualties.map((c) => c.name));
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

      // ── ORPHAN COUNT ON THE SECTION HEADER (report 20260725_76) ──
      // The whole point of an orphan is that it has NO generator card here, so
      // the generators section is where its absence is felt and where the count
      // has to appear — otherwise the operator has to go hunting group by group
      // (which is exactly how 12 ghosts survived unnoticed for a week).
      const genOrphanGroups = orphanGroupSummary(orphanScene());
      const genOrphanTotal = genOrphanGroups.reduce((n, g) => n + g.orphanCount, 0);
      genFolder.title(genOrphanTotal === 0 ? '📐 Group Generator'
        : '📐 Group Generator <span style="color:var(--error);font-weight:700;">' +
          `⚠ ${genOrphanTotal} orphaned fixtures</span>`);
      const genChildrenEl = genFolder.domElement.querySelector('.children');
      if (genChildrenEl) {
        genChildrenEl.querySelectorAll('.orphan-summary-bar').forEach((el) => el.remove());
        if (genOrphanTotal > 0) {
          const bar = document.createElement('div');
          bar.className = 'orphan-summary-bar';
          bar.style.cssText = 'margin:4px 6px;padding:5px 7px;border:1px solid var(--error);' +
            'border-radius:3px;background:color-mix(in srgb, var(--error) 12%, var(--surface));' +
            'display:flex;flex-direction:column;gap:4px;';
          const head = document.createElement('div');
          head.style.cssText = 'color:var(--error);font-size:10px;font-weight:700;';
          head.textContent = `⚠ ${genOrphanTotal} orphaned fixture(s) — generated, ` +
            'but no generator owns them';
          bar.appendChild(head);
          const why = document.createElement('div');
          why.style.cssText = 'color:var(--secondary);font-size:9px;line-height:1.35;';
          why.textContent = 'They have no card in this list, they never regenerate, and they ' +
            'still cost engine-model pixels and hold their group name hostage. Remove them ' +
            'here or from their group in Light Instances. Nothing is written until you save.';
          bar.appendChild(why);
          for (const g of genOrphanGroups) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:4px;align-items:center;';
            const label = document.createElement('span');
            label.style.cssText = 'flex:1;min-width:0;color:var(--text);font-size:10px;' +
              'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            label.textContent = g.allOrphans
              ? `${g.group} — all ${g.orphanCount}`
              : `${g.group} — ${g.orphanCount} of ${g.memberCount}`;
            const btn = document.createElement('button');
            btn.textContent = `🗑 Remove ${g.orphanCount}`;
            btn.title = `Enumerate every dependent, then remove the ${g.orphanCount} ` +
              `orphaned fixture(s) in "${g.group}"`;
            btn.style.cssText = 'padding:3px 7px;border:1px solid var(--error);' +
              'border-radius:3px;background:color-mix(in srgb, var(--error) 18%, ' +
              'var(--surface));color:var(--error);cursor:pointer;font-size:10px;' +
              'font-family:inherit;font-weight:700;white-space:nowrap;';
            btn.onclick = () => {
              removeOrphanFixtures(g.orphans, g.allOrphans
                ? `the whole "${g.group}" group`
                : `${g.orphanCount} of ${g.memberCount} fixtures in "${g.group}"`);
            };
            row.appendChild(label);
            row.appendChild(btn);
            bar.appendChild(row);
          }
          // Prepend: the "New Circle / Line / Corner" bar is prepended further
          // down, so this lands directly beneath it — top of the section, above
          // every generator card.
          genChildrenEl.prepend(bar);
        }
      }

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

      // Default TRUE, as it always was — but in the beauty profiles
      // (`emissive`/`full`) the gate keeps the visuals off until the operator
      // moves this switch himself, because their preview dots read as coloured
      // rings on the fixtures (report 20260725_79). Flipping it here is that
      // explicit choice and shows them in any profile.
      if (params.generatorsVisible === undefined) params.generatorsVisible = true;
      const existingGenCtrl = genFolder.controllers.find(c => c.property === 'generatorsVisible');
      if (!existingGenCtrl) {
        const genCtrl = genFolder.add(params, 'generatorsVisible').name('Show Generators').listen().onChange(() => {
          params.traceVisualsOperatorChoice = true;
          if (window.applyTraceVisualsVisibility) window.applyTraceVisualsVisibility();
          debounceAutoSave();
        });
        if (genCtrl.domElement) {
          genCtrl.domElement.title =
            'Generator trace visuals: wireframe paths, spacing preview dots, drag handles. ' +
            'Authoring furniture — hidden by default in the Emissive / Full beauty profiles ' +
            '(their dots sit on the fixtures and read as coloured rings). Turn it on here to ' +
            'see them in any profile.';
        }
      }

      // The ⛓ chain-order overlay rides on "Show Generators" but has its own
      // switch, because it is the densest thing in the trace view: it adds one
      // label sprite per fixture. Off → the overlay is disposed outright, not
      // hidden (see the perf contract by `buildChainOrderVisual`). Runtime-only
      // like `focusOnSelect`: `reconstructYAML` walks the scene's existing
      // config tree, so this never appears in a scene file.
      if (params.chainOrderVisible === undefined) params.chainOrderVisible = true;
      const existingChainCtrl = genFolder.controllers.find(c => c.property === 'chainOrderVisible');
      if (!existingChainCtrl) {
        genFolder.add(params, 'chainOrderVisible').name('⛓ Show Chain Order').listen().onChange(() => {
          if (window.refreshAllChainOrderViz) window.refreshAllChainOrderViz();
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

      // Trace sub-folders.
      // DISPLAY ORDER ONLY — the 📐 Group Generator cards render sorted by
      // generator name, but `i` stays each trace's REAL index in params.traces.
      // Everything below is index-keyed (window.traceGuiFolders[i],
      // clickTraceFolder(i), setTraceSelected(i), flyToTrace(i), the chain-order
      // lookups) and params.traces is what reconstructYAML serializes, so the
      // array itself is never reordered.
      const displayTraces = sortByNameNatural(
        params.traces.map((trace, i) => ({ trace, i })),
        (entry) => entry.trace.name || `Trace ${entry.i + 1}`,
      );
      displayTraces.forEach(({ trace, i }) => {
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

        // Track the last committed name so a rejected rename can revert cleanly
        // (lil-gui has already mutated trace.name by the time onFinishChange runs).
        let committedTraceName = trace.name || `Trace ${i + 1}`;
        const traceNameCtrl = tFolder.add(trace, 'name').name('Name');
        traceNameCtrl.onFinishChange(() => {
          const newName = (trace.name || '').trim();
          const oldGroupName = trace.groupName || committedTraceName;
          if (newName === committedTraceName) {
            // No-op (or whitespace-only edit) — normalize back and bail.
            trace.name = committedTraceName;
            traceNameCtrl.updateDisplay();
            return;
          }
          // Fail loud (codex P0) on a reserved / colliding name — a silent merge
          // would fuse two groups' overrides + view bits. Revert the input.
          const err = traceRenameError(newName, {
            traces: params.traces, parLights: params.parLights,
            traceIndex: i, oldGroupName,
          });
          if (err) {
            alert(err);
            trace.name = committedTraceName;
            traceNameCtrl.updateDisplay();
            return;
          }
          // GATE BEFORE MUTATION (plan 20260725_44 step 8). The regenerate
          // below refuses invalid chainSplits — but the name / override /
          // view-bit mutations used to happen FIRST, so a refused regenerate
          // left the old-named fixtures stranded with no group master, no
          // lock and no view bit, and `reconcileGroupBits` then re-minted a
          // bit for the old name (MASK_* drift). Check the splits here, with
          // ZERO mutations behind us, and revert the edit outright.
          const splitsErr = chainSplitsError(trace.chainSplits, traceLightCount(trace));
          if (splitsErr && trace.generated) {
            alert(`⚠ Cannot rename "${oldGroupName}" → "${newName}"\n\n` +
              `Chain Order splits are invalid:\n  ${splitsErr}\n\n` +
              'Nothing was renamed. Fix or clear the splits (⛓ Chain Order) and try again.');
            trace.name = committedTraceName;
            traceNameCtrl.updateDisplay();
            return;
          }

          // CHECK + INVALIDATE the mapping (operator ruling 2026-07-29, step
          // 9). Today's behaviour unmaps everything anyway — as an ACCIDENT
          // of the regenerate's casualty set — and reports it as "N deleted
          // fixture(s) unmapped — channels freed", which is a lie: nothing
          // was deleted. Here it becomes deliberate and accurate: every
          // old-name chain entry and patch-tree key is enumerated and
          // invalidated with one line per fixture, BEFORE the regenerate, so
          // the regenerate's own casualty hook then finds nothing left to
          // unmap and stays quiet.
          const renamedPairs = params.parLights
            .filter((l) => l.group === oldGroupName && l.traceGenerated)
            .map((l) => ({
              from: l.name,
              to: typeof l.name === 'string' && l.name.startsWith(`${oldGroupName} `)
                ? `${newName} ${l.name.slice(oldGroupName.length + 1)}`
                : l.name,
            }));
          const renameReport = renamedPairs.length > 0
            ? invalidateMappingForRename(renamedPairs, {
              scope: 'group', oldLabel: oldGroupName, newLabel: newName,
              // The regenerate below reprojects once the old-named fixtures
              // are gone; reprojecting here would re-mint their patch-tree
              // keys from the configs that still exist at this instant.
              reproject: false,
            })
            : null;

          trace.name = newName;
          trace.groupName = newName;
          // Carry the group master override (enabled / brightness / lock) and the
          // view-mask bit across the rename so nothing is orphaned under the old
          // name (mirrors the LED / par ✏ Rename plumbing, report _28). These are
          // DISPLAY state, not mapping — the ruling keeps them following the name.
          carryTraceGroupOverride(params.groupOverrides, oldGroupName, newName);
          // Pixel-order flags follow the rename the same way: `<old> N` →
          // `<new> N`. Done BEFORE the regenerate below so the regenerate's own
          // casualty sweep (every old-named fixture) finds nothing left to clear
          // — a rename must never look like a shrink to the flag store.
          const carriedPixelOrder = carryPixelOrderEntries(
            params.pixelOrder, oldGroupName, newName, traceLightCount(trace));
          for (const row of carriedPixelOrder) {
            console.warn(`[Rename]   ⇄ pixel-order flag carried: "${row.from}" → "${row.to}" ` +
              `(${row.value}) — display state keyed on the name, not mapping`);
          }
          if (window.viewRegistryRenameGroup) {
            window.viewRegistryRenameGroup(oldGroupName, newName);
          }
          migratePixelMapGroupSelectors(oldGroupName, newName);
          tFolder.title(`${traceGlyph(trace.shape)} ${newName}`);
          // Regenerate under the new name, sweeping the OLD name too so its
          // previously generated instances are removed instead of orphaned.
          if (trace.generated) generateGroupFromTrace(i, true, oldGroupName);
          // The new configs only exist after the regenerate — carry each
          // fixture's per-fixture view membership onto them now (display
          // state, one loud line each; addresses stay invalidated).
          if (renameReport) {
            const byName = new Map();
            for (const config of gatherAllConfigs(params)) {
              if (config && config.name) byName.set(config.name, config);
            }
            const carried = carryViewMasks(renameReport.oldViewMasks, byName, renamedPairs);
            for (const row of carried) {
              console.warn(`[Rename]   👁 view membership carried: "${row.from}" → ` +
                `"${row.to}" (viewMask 0x${(row.viewMask || 0).toString(16)}, viewMaskHi ` +
                `0x${(row.viewMaskHi || 0).toString(16)}) — display state, not mapping`);
            }
            if (carried.length > 0 && window.invalidateMarsinBatchCache) {
              window.invalidateMarsinBatchCache('trace_group_rename');
            }
          }
          committedTraceName = newName;
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
          
          onTraceGeometryEdit(tFolder.add(trace, 'radius', 1, 50, 0.5).name('Radius'), i);
          onTraceGeometryEdit(tFolder.add(trace, 'arc', 10, 360, 5).name('Arc (°)'), i);
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
          onTraceGeometryEdit(startF.add(trace, 'startX', -100, 100, 0.5).name('X'), i);
          onTraceGeometryEdit(startF.add(trace, 'startY', -100, 100, 0.5).name('Y'), i);
          onTraceGeometryEdit(startF.add(trace, 'startZ', -100, 100, 0.5).name('Z'), i);
          const cornerF = tFolder.addFolder('Corner Point (blue)');
          cornerF.close();
          onTraceGeometryEdit(cornerF.add(trace, 'cornerX', -100, 100, 0.5).name('X'), i);
          onTraceGeometryEdit(cornerF.add(trace, 'cornerY', -100, 100, 0.5).name('Y'), i);
          onTraceGeometryEdit(cornerF.add(trace, 'cornerZ', -100, 100, 0.5).name('Z'), i);
          const endF = tFolder.addFolder('End Point (red)');
          endF.close();
          onTraceGeometryEdit(endF.add(trace, 'endX', -100, 100, 0.5).name('X'), i);
          onTraceGeometryEdit(endF.add(trace, 'endY', -100, 100, 0.5).name('Y'), i);
          onTraceGeometryEdit(endF.add(trace, 'endZ', -100, 100, 0.5).name('Z'), i);
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
          onTraceGeometryEdit(startF.add(trace, 'startX', -100, 100, 0.5).name('X'), i);
          onTraceGeometryEdit(startF.add(trace, 'startY', -100, 100, 0.5).name('Y'), i);
          onTraceGeometryEdit(startF.add(trace, 'startZ', -100, 100, 0.5).name('Z'), i);
          const endF = tFolder.addFolder('End Point (red)');
          endF.close();
          onTraceGeometryEdit(endF.add(trace, 'endX', -100, 100, 0.5).name('X'), i);
          onTraceGeometryEdit(endF.add(trace, 'endY', -100, 100, 0.5).name('Y'), i);
          onTraceGeometryEdit(endF.add(trace, 'endZ', -100, 100, 0.5).name('Z'), i);
        }

        // Lights (count) — the user sets the number of lights directly.
        // This replaces the legacy spacing slider; COUNT is authoritative.
        if (trace.count === undefined) trace.count = 8;
        const lightPts = computeTracePoints(trace);
        const countInfo = { count: `${lightPts.length} lights` };
        const countCtrl = tFolder.add(countInfo, 'count').name('Preview').disable();

        // A trace carrying chainSplits has its light count PINNED by them: the
        // splits describe a walk over 1..count, and stretching or truncating
        // them to fit a new count would invent wiring the operator never
        // described. So a count change that invalidates the splits is refused
        // and the slider reverts — the splits are never silently dropped
        // (design 20260725_41 §3.5).
        let committedCount = traceLightCount(trace);
        let countRefusalNotified = false;
        const lightsCtrl = tFolder.add(trace, 'count', 1, 200, 1).name('Lights').onChange(() => {
          const countErr = chainSplitsError(trace.chainSplits, traceLightCount(trace));
          if (countErr) {
            const wanted = traceLightCount(trace);
            trace.count = committedCount;
            lightsCtrl.updateDisplay();
            if (!countRefusalNotified) {
              countRefusalNotified = true;
              // Re-arm on the next pointer release so a later edit still warns,
              // without one alert per mouse-move during a slider drag.
              window.addEventListener('pointerup',
                () => { countRefusalNotified = false; }, { once: true });
              alert(`⚠ Lights count locked by Chain Order\n\n` +
                `This generator's chain splits cover 1..${committedCount}, but the count ` +
                `would become ${wanted}:\n  ${countErr}\n\n` +
                'Fix or clear the splits (⛓ Chain Order) first — they are kept, not dropped.');
            }
            return;
          }
          committedCount = traceLightCount(trace);
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

        // ── ⛓ Chain Order (wiring) ────────────────────────────────────────
        // Declares the PHYSICAL daisy-chain walk over the trace's path
        // positions, as a list of inclusive {from,to} ranges that must cover
        // 1..count exactly once. Fixture NUMBER then means chain position, so
        // adding "<group> 1..N" to a port in plain numeric order IS wire
        // order, and an already-mapped group re-lands its sticky-by-name
        // addresses on the wiring-true lights after one Regenerate.
        // Design report 20260725_41 §3 / §6.
        const chainFolder = tFolder.addFolder('⛓ Chain Order (wiring)');
        chainFolder.close();

        const chainInfo = { order: '' };
        const orderCtrl = chainFolder.add(chainInfo, 'order').name('Order').disable();

        // DOM rows live in one wrapper so a structural rebuild can drop them
        // all at once without disturbing the rest of the card.
        let chainDomWrap = null;
        // The card-level red badge (outside the collapsed folder) so a scene
        // that booted with stale/hand-edited splits is visible without
        // opening the sub-folder — the boot skip is a UI state, not just a
        // console line (design §3.5, plan step 6).
        const chainBadgeDiv = document.createElement('div');
        chainBadgeDiv.style.cssText =
          'padding:3px 8px;font-size:10px;line-height:1.35;font-weight:600;' +
          'color:var(--error);display:none;';

        const chainCount = () => traceLightCount(trace);
        const mappedFixtureCount = () => {
          const g = trace.groupName || trace.name;
          return params.parLights.filter((l) =>
            l.group === g && l.traceGenerated && (l.dmxUniverse > 0 || l.dmxAddress > 0)
          ).length;
        };

        // Undo for split edits: the engine has already mutated the split by
        // the time our handler runs, so push the PREVIOUS list as the undo
        // target, then restore the new one (the trace-rename control uses the
        // same committed-value trick).
        let committedSplits = trace.chainSplits
          ? JSON.parse(JSON.stringify(trace.chainSplits)) : null;
        const pushUndoForSplits = () => {
          const current = trace.chainSplits;
          if (committedSplits) trace.chainSplits = JSON.parse(JSON.stringify(committedSplits));
          else delete trace.chainSplits;
          pushUndo();
          if (current === undefined) delete trace.chainSplits;
          else trace.chainSplits = current;
        };
        const commitSplits = () => {
          committedSplits = trace.chainSplits
            ? JSON.parse(JSON.stringify(trace.chainSplits)) : null;
        };

        // The §3.7 confirm. Renumbering changes WHAT A FIXTURE NUMBER MEANS,
        // so it says that in as many words — the operator must not discover
        // it by finding the wrong light lit. Returns false to abort.
        const confirmRenumber = () => {
          if (!trace.generated) return true;
          const mapped = mappedFixtureCount();
          if (mapped === 0) return true;
          const g = trace.groupName || trace.name;
          // Pixel-order flags are name-keyed too, so they stay put exactly like
          // the addresses and ids — one rule, not two (design §2.5). Name the
          // currently-REVERSED members so the operator knows a physical
          // re-verify (calibration pattern 71) is due on those lights.
          const memberNames = params.parLights
            .filter((l) => l.group === g && l.traceGenerated)
            .map((l) => l.name);
          let reversedNames = [];
          try {
            reversedNames = reversedMembers(params.pixelOrder, memberNames);
          } catch (err) {
            // An invalid stored value: say so here rather than quietly omitting
            // the line the operator is about to make a decision on.
            reversedNames = [`(unreadable — ${err.message})`];
          }
          const reversedLine = reversedNames.length > 0
            ? `\nCurrently REVERSED: ${reversedNames.join(', ')}.\n` : '';
          return confirm(
            `⚠ Renumber "${g}" to the new chain order?\n\n` +
            `${mapped} mapped fixture(s) KEEP their DMX addresses (addresses are sticky by ` +
            'fixture name), but each name moves to a different light.\n\n' +
            'EVERYTHING KEYED ON THE NAME STAYS PUT AND THEREFORE MOVES TO A DIFFERENT ' +
            'PHYSICAL LIGHT:\n' +
            `  • DMX addresses (controller chains + patches.yaml)\n` +
            '  • engine model ids — sectionId / fixtureId\n' +
            '  • saved 2D Pixel Map anchors (a fixture\'s hand-placed position in a view)\n' +
            '  • pixel-order flags (NORMAL/REVERSED)\n' + reversedLine + '\n' +
            'After this, a fixture NUMBER means its position in the physical daisy chain, ' +
            'NOT its position along the drawn path. The addresses, ids and 2D anchors stay ' +
            'put; which physical light each of them belongs to changes.\n\nContinue?');
        };

        // Apply a splits change: valid + generated → regenerate (renumber);
        // invalid → leave the card red and let Regenerate refuse loudly.
        const applySplitsChange = () => {
          refreshChainStatus();
          if (chainSplitsError(trace.chainSplits, chainCount()) === null && trace.generated) {
            generateGroupFromTrace(i, true);
          }
          debounceAutoSave();
        };

        function refreshChainStatus() {
          const err = chainSplitsError(trace.chainSplits, chainCount());
          // Every splits path lands here — a From/To stepper tick, + Add split,
          // − Remove last, ⇄ Swap, and Regenerate through applySplitsChange —
          // so this is the one place the 3D overlay has to be refreshed for it
          // to track the card live. Invalid splits draw no chain at all; the
          // red badge below is what the operator sees instead.
          refreshChainOrderViz(i);
          chainInfo.order = err ? '⚠ INVALID — see below' : describeChainOrder(trace.chainSplits, chainCount());
          orderCtrl.updateDisplay();
          chainBadgeDiv.textContent = err ? `⚠ CHAIN SPLITS INVALID — ${err}` : '';
          chainBadgeDiv.style.display = err ? 'block' : 'none';
          if (chainDomWrap && chainDomWrap.__noteDiv) {
            const note = chainDomWrap.__noteDiv;
            if (err) {
              note.textContent = `⚠ ${err}`;
              note.style.color = 'var(--error)';
              note.style.display = 'block';
            } else {
              const mapped = trace.generated ? mappedFixtureCount() : 0;
              if (mapped > 0) {
                note.textContent =
                  `⚠ ${mapped} mapped fixture(s) keep their addresses and RENUMBER on Regenerate`;
                note.style.color = 'var(--caution)';
                note.style.display = 'block';
              } else {
                note.textContent = '';
                note.style.display = 'none';
              }
            }
          }
        }

        function renderChainRows() {
          // Drop the previous split controllers + DOM rows, keep the folder
          // (and its open/closed state) so an edit never collapses the card.
          [...chainFolder.folders].forEach((f) => f.destroy());
          if (chainDomWrap && chainDomWrap.parentElement) {
            chainDomWrap.parentElement.removeChild(chainDomWrap);
          }
          chainDomWrap = null;

          const count = chainCount();
          const splits = Array.isArray(trace.chainSplits) ? trace.chainSplits : null;

          if (splits) {
            splits.forEach((split, s) => {
              const sf = chainFolder.addFolder(`Split ${s + 1}`);
              sf.open();
              const bind = (key) => {
                sf.add(split, key, 1, count, 1).name(key === 'from' ? 'From' : 'To')
                  .onChange(() => { refreshChainStatus(); })
                  .onFinishChange(() => {
                    if (chainSplitsError(trace.chainSplits, chainCount()) === null &&
                        trace.generated && !confirmRenumber()) {
                      // Aborted: put the previous list back, rows and all.
                      trace.chainSplits = committedSplits
                        ? JSON.parse(JSON.stringify(committedSplits)) : undefined;
                      if (trace.chainSplits === undefined) delete trace.chainSplits;
                      renderChainRows();
                      refreshChainStatus();
                      return;
                    }
                    pushUndoForSplits();
                    commitSplits();
                    applySplitsChange();
                  });
              };
              bind('from');
              bind('to');
            });
          }

          // Buttons + note row.
          const wrap = document.createElement('div');
          const rowStyle = 'display:flex;gap:2px;padding:3px 6px;';
          const cBtnStyle = 'flex:1;padding:4px 0;border:none;border-radius:3px;' +
            'cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;' +
            'background:var(--control-bg);color:var(--secondary);';
          const disabledStyle = 'flex:1;padding:4px 0;border:none;border-radius:3px;' +
            'cursor:not-allowed;font-size:11px;font-family:inherit;font-weight:600;' +
            'background:var(--surface-container-low);color:var(--icon);';

          const addRemoveRow = document.createElement('div');
          addRemoveRow.style.cssText = rowStyle;

          const addBtn = document.createElement('button');
          addBtn.textContent = '+ Add split';
          addBtn.title = 'Divide the last split in two (the chain keeps full coverage)';
          addBtn.style.cssText = cBtnStyle;
          addBtn.onclick = (e) => {
            if (e) e.stopPropagation();
            const n = chainCount();
            const list = Array.isArray(trace.chainSplits)
              ? trace.chainSplits
              : [{ from: 1, to: n }];
            const last = list[list.length - 1];
            const span = Math.abs(last.to - last.from) + 1;
            if (span < 2) {
              // Splitting a single light would have to invent an overlap or a
              // gap — refuse instead of writing an invalid list.
              alert('⚠ Cannot add a split\n\nThe last split covers a single light, so there ' +
                'is nothing left to divide. Edit the From / To values of the existing ' +
                'splits instead.');
              addBtn.blur();
              return;
            }
            pushUndoForSplits();
            const step = last.from <= last.to ? 1 : -1;
            const firstSpan = Math.ceil(span / 2);
            const boundary = last.from + (firstSpan - 1) * step;
            const tail = { from: boundary + step, to: last.to };
            trace.chainSplits = [...list.slice(0, -1), { from: last.from, to: boundary }, tail];
            commitSplits();
            renderChainRows();
            applySplitsChange();
            addBtn.blur();
          };

          const removeBtn = document.createElement('button');
          removeBtn.textContent = '− Remove last';
          removeBtn.title = splits && splits.length === 1
            ? 'Clear the splits and go back to plain path order'
            : 'Merge the last split back into the one before it';
          removeBtn.style.cssText = splits ? cBtnStyle : disabledStyle;
          removeBtn.disabled = !splits;
          removeBtn.onclick = (e) => {
            if (e) e.stopPropagation();
            if (!Array.isArray(trace.chainSplits)) return;
            pushUndoForSplits();
            if (trace.chainSplits.length <= 1) {
              // Back to the zero-clutter default. NEVER an empty array — that
              // is an invalid declaration, not "no declaration" (§3.3).
              delete trace.chainSplits;
            } else {
              const list = trace.chainSplits.map((s) => ({ from: s.from, to: s.to }));
              const dropped = list.pop();
              list[list.length - 1].to = dropped.to;
              trace.chainSplits = list;
            }
            commitSplits();
            renderChainRows();
            applySplitsChange();
            removeBtn.blur();
          };

          addRemoveRow.appendChild(addBtn);
          addRemoveRow.appendChild(removeBtn);

          const swapRow = document.createElement('div');
          swapRow.style.cssText = 'padding:2px 6px;';
          const swapBtn = document.createElement('button');
          const reversed = isFullReverse(trace.chainSplits, count);
          swapBtn.textContent = reversed ? '⇄ Restore path order' : '⇄ Swap start/end';
          swapBtn.title = reversed
            ? 'Clear the reverse and number the lights along the drawn path again'
            : 'Wire enters at the RED end: number the lights backwards along the path';
          swapBtn.style.cssText = 'width:100%;padding:4px 0;border:none;border-radius:3px;' +
            'cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;' +
            (reversed
              ? 'background:color-mix(in srgb, var(--caution) 15%, var(--surface));color:var(--caution);'
              : 'background:var(--control-bg);color:var(--secondary);');
          swapBtn.onclick = (e) => {
            if (e) e.stopPropagation();
            const n = chainCount();
            const wasReversed = isFullReverse(trace.chainSplits, n);
            // Swap is the single full-reverse split — the SAME mechanism as
            // the splits below it, not a second code path (§3.6). Overwriting
            // a hand-built split list is destructive, so ask first.
            if (!wasReversed && Array.isArray(trace.chainSplits)) {
              if (!confirm(`⚠ Replace this generator's ${trace.chainSplits.length} chain ` +
                'split(s) with one full reverse?\n\nThe existing split ranges will be lost.')) {
                swapBtn.blur();
                return;
              }
            }
            if (!confirmRenumber()) { swapBtn.blur(); return; }
            pushUndoForSplits();
            if (wasReversed) delete trace.chainSplits;
            else trace.chainSplits = fullReverseSplits(n);
            commitSplits();
            renderChainRows();
            applySplitsChange();
            swapBtn.blur();
          };
          swapRow.appendChild(swapBtn);

          const noteDiv = document.createElement('div');
          noteDiv.style.cssText =
            'padding:3px 8px;font-size:10px;line-height:1.35;font-weight:600;display:none;';

          if (trace.locked) {
            [addBtn, removeBtn, swapBtn].forEach((b) => {
              b.disabled = true;
              b.style.cssText = disabledStyle + 'width:100%;';
            });
          }

          wrap.appendChild(addRemoveRow);
          wrap.appendChild(swapRow);
          wrap.appendChild(noteDiv);
          wrap.__noteDiv = noteDiv;
          const chainChildren = chainFolder.domElement.querySelector('.children');
          if (chainChildren) chainChildren.appendChild(wrap);
          chainDomWrap = wrap;
        }

        renderChainRows();
        refreshChainStatus();
        if (spacingChildren) spacingChildren.appendChild(chainBadgeDiv);

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
            // Same clear-and-warn helper the regeneration casualty path uses —
            // one code path, one message shape (design §2.3).
            clearPixelOrderCasualties(groupName, removedConfigs.map((c) => c.name));
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

    // Pixel-order validation runs HERE — strictly after the auto-regenerate
    // above, or every generated fixture would look missing and the whole store
    // would be reported stale (design §2.7).
    reportPixelOrderStore('boot');

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

        // DISPLAY ORDER ONLY — cards render sorted by name; `index` stays the
        // fixture's real slot in params.dmxFixtures (window.dmxGuiFolders and
        // window.dmxSceneFixtures are index-keyed, and the array is serialized).
        const displayDmx = sortByNameNatural(
          params.dmxFixtures.map((config, index) => ({ config, index })),
          (entry) => entry.config.name || `DMX ${entry.index + 1}`,
        );
        displayDmx.forEach(({ config, index }) => {
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

          // Name — check + invalidate + duplicate guard (step 11), same policy
          // as the par path above.
          let committedDmxName = config.name;
          const dmxNameCtrl = idxFolder.add(config, "name").name("Name");
          dmxNameCtrl.onFinishChange((v) => {
            const proposed = (v || '').trim();
            if (proposed === committedDmxName) {
              config.name = committedDmxName;
              dmxNameCtrl.updateDisplay();
              return;
            }
            if (!renameSingleFixture(config, committedDmxName, proposed, dmxNameCtrl)) return;
            committedDmxName = proposed;
            idxFolder.title(proposed);
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

    // Guides toggle — hide the connector wires + endpoint handles so only the
    // LED pixels render (clean "pixels only" view). OFF by default so the beauty
    // render is clean; a strand's handles appear when its folder is opened
    // (openStrandFolder selects it) or the strand is picked in 3D.
    if (params.ledGuidesVisible === undefined) params.ledGuidesVisible = false;
    strandFolder.add(params, 'ledGuidesVisible').name('Show Guides').onChange(v => {
      (window.ledStrandFixtures || []).forEach(f => f.setGuidesVisible(v));
    });

    // ── Global LED visual size ── ONE bulb + halo radius (world units) applied
    // to EVERY LED fixture. Lives here (above the instance list) so it reads as
    // a global control, not per-strand. onChange re-renders all LED fixtures
    // live. Ranges are tuned tight around the current look (operator: pixel
    // 0.08–0.25, halo 0.05–0.25).
    if (params.ledPixelSize === undefined) params.ledPixelSize = 0.08;
    if (params.ledHaloSize === undefined) params.ledHaloSize = 0.14;
    const applyLedSizeToAll = () => {
      (window.ledStrandFixtures || []).forEach(f => { if (f) f.applyVisualSize(); });
      // LED-bus fixtures (TE Sign, TE LED Grid) ride the par/DMX transport, so
      // they live in parFixtures/dmxSceneFixtures — NOT ledStrandFixtures. They
      // are still LED fixtures and must track the same Halo Size setting, so
      // push the rebuild to them too (updateScales re-reads params.ledHaloSize).
      // Without this the sliders moved the strands and left the sign behind.
      [...(window.parFixtures || []), ...(window.dmxSceneFixtures || [])].forEach(f => {
        if (f && f._isLed && f.updateScales) {
          f.updateScales(params.globalPixelScale || 1.0, params.globalHaloScale || 1.0);
        }
      });
      debounceAutoSave();
    };
    // Scope is spelled out in the labels + tooltips: this pair is LED-BUS ONLY
    // (strands, TE Sign, TE LED Grid). "Halo Size" next to a global "Global
    // Halo Size" read as the same control and cost the operator two debugging
    // rounds on 2026-07-30 ("The halo size parameter only affects the TE sign
    // lights…" → "sorry, I was using the LED halo size, not the global one in
    // options"). Label/tooltip only — the three-factor model (20260725_77) and
    // both knobs' behaviour are unchanged.
    const ledPixelCtrl = strandFolder
      .add(params, 'ledPixelSize', 0.08, 0.25, 0.005)
      .name('LED Pixel Size (LED only)')
      .onChange(applyLedSizeToAll);
    const ledHaloCtrl = strandFolder
      .add(params, 'ledHaloSize', 0.05, 0.25, 0.005)
      .name('LED Halo Base (LED only)')
      .onChange(applyLedSizeToAll);
    if (ledPixelCtrl.domElement) {
      ledPixelCtrl.domElement.title =
        'Bulb radius for LED-BUS fixtures only (LED strands, TE Sign, TE LED Grid). ' +
        'DMX pars/bars/vintage size their bulbs from their own model — use "Global Pixel Size".';
    }
    if (ledHaloCtrl.domElement) {
      ledHaloCtrl.domElement.title =
        'BASE halo radius for LED-BUS fixtures only (LED strands, TE Sign, TE LED Grid). ' +
        'A DMX fixture\'s halo is a rim around its own bulb and ignores this by design. ' +
        'Effective halo = this base × "Global Halo Size" (ALL fixtures) × the fixture\'s own "Halo ×".';
    }

    window.ledStrandFixtures = [];

    function rebuildLedStrands() {
      if (window.ledStrandFixtures) {
        window.ledStrandFixtures.forEach(f => f.destroy());
      }
      window.ledStrandFixtures = [];
      params.ledStrands.forEach((config, index) => {
        const fixture = new LedStrand(config, index, scene, interactiveObjects);
        fixture.setVisibility(params.strandsEnabled !== false);
        fixture.setGuidesVisible(params.ledGuidesVisible !== false);
        window.ledStrandFixtures.push(fixture);
      });
      // Every strand instance was just DESTROYED and re-created, but the batch
      // render list (animate.js) still holds apply() closures that captured the
      // OLD LedStrand instances — writing to disposed InstancedMeshes, so the
      // strand renders dark until the next unrelated invalidation. rebuildDmx-
      // Fixtures already invalidates on rebuild (fixtures.js); this path was
      // missing that call, leaving stale closures after any strand edit
      // (count/color/position/add/delete). Invalidate so generatePixelMap re-runs
      // and rebinds apply() to the new instances (operator report 2026-07-10).
      if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('led_strands_rebuilt');
    }
    window.rebuildLedStrands = rebuildLedStrands;

    // Transform handler for strand handles
    window._onStrandTransformChange = function(obj) {
      if (!obj.userData.isLedStrand) return false;
      const fixture = obj.userData.fixture;
      if (!fixture) return false;
      fixture.writeTransformToConfig(obj.userData.handleType);
      fixture.rebuildVisuals();
      // rebuildVisuals() only moves THIS strand's own bulb/halo meshes. Every
      // batch-list consumer (global instanced dot mesh, 2D pixel map, engine
      // pattern coords) holds x/y/z snapshotted by generatePixelMap() at cache
      // build time, so without this bump the old pixel positions keep rendering
      // — the ghost "trail" the operator sees after a 3D-handle move. The
      // Start/End sliders never showed it because they call rebuildLedStrands(),
      // which invalidates at L4324 (operator report 2026-07-25).
      //
      // COLD MOVE (report 20260725_44 step 5): the strand's OWN meshes keep
      // tracking the cursor every tick (writeTransformToConfig + rebuildVisuals
      // above). Only the global batch invalidation is deferred, because each
      // one costs a full generatePixelMap + a new InstancedMesh (~20-25 ms).
      // THE CONTRACT: release ALWAYS invalidates — the move-trail bug was
      // *persistent* stale coordinates; a transient in-drag lag of the global
      // dot overlay is the requested cold-move semantic, not the bug.
      if (transformControl && transformControl.dragging) {
        markStrandTransformDirty();
        return true;
      }
      if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('strand_transform');
      debounceAutoSave();
      return true;
    };

    // ── "LED Fixtures" section layout ──
    // Operator ruling (2026-07-24): "they are all LED fixtures" — no sub-category
    // split. Below the section's global controls sit exactly two children,
    // mirroring the DMX split (📐 Group Generator + Light Instances): the
    // ✨ Generators area and the ONE flat landing list, LED Fixture Instances.
    // Generators live in their own area; what they produce lands in the instances
    // list and behaves like any other group thereafter (design 20260724_26 §2.1).
    // Inside LED Fixture Instances every group folder — sign OR strand — renders
    // as one flat list with the full DMX-style grammar (toolbars, lock, Select
    // All, On, group master, rename, per-fixture cards).
    //   • TE Sign — LED-class DMX fixtures (the TE Sign V3 pair) that physically
    //     STAY in params.parLights; renderParGUI OWNS those group folders (routed
    //     into LED Fixture Instances via window._ledFixtureInstancesFolder), so
    //     patching / the 'TE Sign' group / 'TE Sign (2)' select / the A≡B
    //     transform are all unchanged.
    //   • LED strands — the pixel strands (params.ledStrands), grouped DMX-style.
    // Both renderers write into this ONE list, so each tears down ONLY its own
    // folders: renderParGUI via window._parLedGroupFolders, renderStrandGUI via
    // window._ledStrandGroupFolders.

    // ── ✨ Generators — mirror of the DMX 📐 Group Generator ──
    // Stateless catalog area (design §2.4 Option A): one "add" button per
    // LED_GENERATORS entry, no persisted generator card. Clicking runs the generic
    // flow below — a future generator is ONE catalog entry, zero code here.
    const ledGenFolder = strandFolder.addFolder('✨ Generators');
    ledGenFolder.close();

    // Generic generator click. Async because the second-sign guard uses the themed
    // inline modal (showModal) — never the native confirm()/prompt() (G3 convention).
    async function runLedGeneratorClick(entry) {
      const target = entry.target;
      const arr = params[target];
      // Fail loud (codex P0): the target params array must exist — no silent bail.
      if (!Array.isArray(arr)) {
        throw new Error(`[gui_builder] LED generator '${entry.id}' target params.${target} is not an array`);
      }
      // Union of group names already in the target array + every trace groupName,
      // so a generated group can never collide with a trace group (config.js
      // re-stamps traceGenerated on group-name match) — uniqueGroupName dodges it.
      const existing = new Set();
      arr.forEach((f) => {
        if (f && typeof f.group === 'string' && f.group.trim()) existing.add(f.group.trim());
      });
      (params.traces || []).forEach((t) => {
        if (t && typeof t.groupName === 'string' && t.groupName.trim()) existing.add(t.groupName.trim());
      });

      // Second-sign guard: the default group already exists ⇒ CONFIRM before
      // spawning a unique-suffixed sibling. We NEVER fuse a second sign into the
      // existing (locked) group — that would rigidly co-locate two signs at one
      // transform. Inline themed modal, not native confirm().
      if (existing.has(entry.defaultGroup)) {
        const ok = await showModal({
          title: `Add another ${entry.defaultGroup}?`,
          message: `A "${entry.defaultGroup}" group already exists. Add another as its own separate locked group?`,
          okLabel: 'Add',
        });
        if (!ok) return;
      }

      const group = uniqueGroupName(existing, entry.defaultGroup);
      const fixtures = runLedGenerator(entry, { group });

      pushUndo();
      arr.push(...fixtures);
      if (entry.bornLocked) {
        // Born LOCKED so the freshly generated group moves as one rigid unit out
        // of the gate. parLights → groupOverrides (DMX master); ledStrands →
        // ledGroupOverrides (the future strand-generator seam, design §2.3).
        const ovKey = target === 'ledStrands' ? 'ledGroupOverrides' : 'groupOverrides';
        if (!params[ovKey]) params[ovKey] = {};
        params[ovKey][group] = { enabled: true, brightness: 100, locked: true };
      }

      if (window._setGuiRebuilding) window._setGuiRebuilding(true);
      if (target === 'ledStrands') {
        rebuildLedStrands();
        renderStrandGUI();
      } else {
        if (window.renderParGUI) window.renderParGUI();
        rebuildParLights();
      }
      if (window._setGuiRebuilding) window._setGuiRebuilding(false);
      debounceAutoSave();
      const shortLabel = entry.label.replace(/^✨\s*\+?\s*/, '').trim();
      _showAutoToast(`✨ Added ${shortLabel} — group "${group}"${entry.bornLocked ? ' (🔒 locked)' : ''}`);
    }

    const ledGenBtnStyle = 'flex:1 1 0;min-width:0;padding:4px 8px;border:1px solid var(--ghost-border);border-radius:3px;background:var(--control-bg);color:var(--text);cursor:pointer;font-size:11px;font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;';
    const ledGenChildren = ledGenFolder.domElement.querySelector('.children');
    // DISPLAY ORDER ONLY — the catalog is a frozen module constant; sort a copy
    // by button label so this list obeys the same by-name rule as every other.
    sortByNameNatural(LED_GENERATORS, (entry) => entry.label).forEach((entry) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:2px;padding:2px 8px 4px;';
      const btn = document.createElement('button');
      btn.textContent = entry.label;
      btn.style.cssText = ledGenBtnStyle;
      btn.onmouseenter = () => btn.style.background = 'var(--control-bg-hover)';
      btn.onmouseleave = () => btn.style.background = 'var(--control-bg)';
      btn.onclick = () => {
        // Fail loud on any generator error rather than swallow it (codex P0).
        runLedGeneratorClick(entry).catch((err) => {
          console.error(`[gui_builder] LED generator '${entry.id}' failed:`, err);
          _showAutoToast(`⚠ Generator failed: ${err.message}`);
        });
      };
      row.appendChild(btn);
      if (ledGenChildren) ledGenChildren.appendChild(row);
    });

    // ── LED Fixture Instances — THE one flat landing list ──
    // Titled wrapper (design §2.1, mirror of the DMX "Light Instances" folder):
    // both renderers project their group folders into this ONE folder. Pointing
    // window._ledFixtureInstancesFolder at it re-homes the LED-class (sign) groups
    // out of the DMX list — everything below renderParGUI's routing line is
    // unchanged, so patching / 'TE Sign' group / A≡B are untouched.
    const ledInstancesFolder = strandFolder.addFolder('LED Fixture Instances');
    window._ledFixtureInstancesFolder = ledInstancesFolder;
    if (!window._parLedGroupFolders) window._parLedGroupFolders = [];
    if (!window._ledStrandGroupFolders) window._ledStrandGroupFolders = [];

    // Deterministic ordering (design D4): inside LED Fixture Instances, sign
    // (parLights) group folders are pinned to the TOP, above the strand group
    // folders; renderStrandGUI emits strand groups named-first with Ungrouped
    // last. Both renderers append at the tail in an order that depends on which
    // ran last, so this single helper — called at the end of BOTH renderParGUI
    // and renderStrandGUI — re-seats the sign folders right after the toolbar
    // every time. Idempotent; a no-op before the section exists.
    window._orderLedFixtureInstances = function _orderLedFixtureInstances() {
      const home = window._ledFixtureInstancesFolder;
      if (!home || !home.domElement) return;
      const children = home.domElement.querySelector('.children');
      if (!children) return;
      const toolbar = children.querySelector('.strand-new-btn');
      let ref = toolbar ? toolbar.nextSibling : children.firstChild;
      (window._parLedGroupFolders || []).forEach((f) => {
        const el = f && f.domElement;
        if (!el || el.parentNode !== children) return;
        if (el === ref) { ref = el.nextSibling; return; }
        children.insertBefore(el, ref);
        ref = el.nextSibling;
      });
    };

    // Instances toolbar (+ New Strand | ➕ Add Group) — created ONCE here, at the
    // top of the LED Fixture Instances list (mirrors the DMX Light Instances
    // toolbar). Not rebuilt per render, so it holds a stable position as the group
    // folders re-render beneath it.
    const strandToolbarStyle = 'flex:1;padding:4px 0;border:none;border-radius:3px;' +
      'background:var(--control-bg);color:var(--ok);cursor:pointer;font-size:11px;' +
      'font-family:inherit;font-weight:600;';
    const strandToolbarDiv = document.createElement('div');
    strandToolbarDiv.style.cssText = 'display:flex;gap:2px;padding:4px 6px;';
    strandToolbarDiv.classList.add('strand-new-btn');
    const newStrandBtn = document.createElement('button');
    newStrandBtn.textContent = '+ New Strand';
    newStrandBtn.style.cssText = strandToolbarStyle;
    newStrandBtn.onclick = () => {
      pushUndo();
      params.ledStrands.push(_newStrandConfig(''));
      rebuildLedStrands();
      renderStrandGUI();
      debounceAutoSave();
    };
    const addStrandGroupBtn = document.createElement('button');
    addStrandGroupBtn.textContent = '➕ Add Group';
    addStrandGroupBtn.style.cssText = strandToolbarStyle + 'color:var(--secondary);';
    addStrandGroupBtn.onclick = () => {
      const name = prompt('New LED group name:');
      if (name === null) return;
      const nn = (name || '').trim();
      // Fail loud (codex P0) on an empty / reserved / colliding name — mirror the
      // rename guard so a seeded group never collides with an existing one.
      const clash = _ledGroupNameClash(nn, null);
      if (clash) { alert(clash); return; }
      pushUndo();
      // A group persists only through a member strand's `group` field, so —
      // exactly like the DMX "➕ Add Group" seeds a fixture — seed one strand.
      params.ledStrands.push(_newStrandConfig(nn));
      window._openStrandGroups.add(nn);
      rebuildLedStrands();
      renderStrandGUI();
      debounceAutoSave();
    };
    strandToolbarDiv.appendChild(newStrandBtn);
    strandToolbarDiv.appendChild(addStrandGroupBtn);
    const strandSectionChildren = ledInstancesFolder.domElement.querySelector('.children');
    if (strandSectionChildren) strandSectionChildren.appendChild(strandToolbarDiv);

    // Display bucket for a strand: its named group, else "Ungrouped". Bucketing
    // is VISUAL only — a strand's DATA `group` stays '' when ungrouped, so
    // groupKeyForStrand (strand.group || strand.name), the section numbering
    // (led_metadata) and the view bits (reconcileGroupBits) are all unchanged.
    const UNGROUPED = 'Ungrouped';
    const displayGroupOf = (s) =>
      (s && typeof s.group === 'string' && s.group.trim()) ? s.group.trim() : UNGROUPED;
    const selectStrandGroup = (indices) => {
      const set = new Set(indices);
      (window.ledStrandFixtures || []).forEach((f, i) => {
        if (f && typeof f.setSelected === 'function') f.setSelected(set.has(i));
      });
    };
    if (!window._openStrandGroups) window._openStrandGroups = new Set();

    // Guard for a new/renamed LED group name — the ONE choke point for every
    // strand-side name entry (➕ Add Group, ✏ Rename, "＋ New group…" on a
    // strand's Move dropdown). Returns an operator-facing error string, or ''
    // when the name is OK. `currentName` (the group being renamed) is exempt
    // from the collision check.
    //
    // The namespace is SCENE-WIDE (group_rename_guard.js, report _52): this used
    // to compare against strand groups only, so an LED group could be named onto
    // a live par group (e.g. "TE Sign") — the two then render as two folders with
    // the same title in this one list AND share a single view-mask bit and one
    // set of 2D Pixel Map selectors, while their group masters stay in two
    // different maps (ledGroupOverrides vs groupOverrides). Fail loud (codex P0).
    function _ledGroupNameClash(name, currentName) {
      return groupRenameError(name, {
        currentName: currentName === null || currentName === undefined ? null : currentName,
        takenNames: collectSceneGroupNames(params),
      }) || '';
    }

    // --- LED Strand GUI ---
    window.strandGuiFolders = [];
    window._strandGroupFolderByIndex = [];
    window.openStrandFolder = function(strandIndex) {
      strandFolder.open();
      ledInstancesFolder.open();
      // Strand cards now nest inside their group folder — open that too.
      const gf = window._strandGroupFolderByIndex[strandIndex];
      if (gf) gf.open();
      if (window.strandGuiFolders) {
        window.strandGuiFolders.forEach(f => { if (f) f.domElement.classList.remove('gui-card-selected'); });
      }
      if (window.strandGuiFolders[strandIndex]) {
        window.strandGuiFolders[strandIndex].open();
        window.strandGuiFolders[strandIndex].domElement.classList.add('gui-card-selected');
      }
      // Beauty view hides handles by default; opening a strand's folder selects
      // it so its edit handles appear (and deselects every other strand).
      (window.ledStrandFixtures || []).forEach((f, i) => {
        if (f && typeof f.setSelected === 'function') f.setSelected(i === strandIndex);
      });
    };

    // Seed config for a fresh LED strand (optionally into a named group).
    function _newStrandConfig(group) {
      return {
        name: (group ? `${group} ` : 'Strand ') + (params.ledStrands.length + 1),
        startX: -3, startY: 5, startZ: 0,
        endX: 3, endY: 5, endZ: 0,
        color: '#ff8800',
        intensity: 1.0,
        ledCount: 10,
        group: group || '',
        controllerId: 0, sectionId: 0, fixtureId: 0, viewMask: 0, viewMaskHi: 0,
      };
    }

    function renderStrandGUI() {
      // Tear down ONLY our strand group folders. TE Sign group folders share this
      // same parent (renderParGUI routes LED-class groups here) and are torn down
      // by renderParGUI via window._parLedGroupFolders — never destroy them here,
      // or the sign would vanish on any strand edit. The section toolbar (+ New
      // Strand / ➕ Add Group) is created ONCE in buildLedStrandsSection and is not
      // rebuilt here, so it keeps a stable position above the flat group list.
      if (!window._ledStrandGroupFolders) window._ledStrandGroupFolders = [];
      window._ledStrandGroupFolders.forEach(f => f.destroy());
      window._ledStrandGroupFolders = [];
      window.strandGuiFolders = [];
      window._strandGroupFolderByIndex = [];

      // ── Bucket strands by DISPLAY group (visual only) ──
      const groupOrder = [];
      const groupMap = new Map();
      params.ledStrands.forEach((strand, index) => {
        if (strand.group === undefined) strand.group = '';
        const key = displayGroupOf(strand);
        if (!groupMap.has(key)) { groupMap.set(key, []); groupOrder.push(key); }
        groupMap.get(key).push({ strand, index });
      });
      const namedGroups = groupOrder.filter(g => g !== UNGROUPED);

      const gBtnStyle = 'flex:1 1 0;min-width:0;padding:3px 6px;border:none;border-radius:3px;background:var(--control-bg);color:var(--secondary);cursor:pointer;font-size:10px;font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;';

      // Rebuild the visuals of every strand in a display group so a live change
      // to its group master (On/Off + Brightness) shows immediately even when no
      // pattern is painting — led_strand.rebuildVisuals scales the static preview
      // by the same master the direct-paint path uses (single source of truth).
      const resyncLedGroup = (gName) => {
        strandGroupMemberIndices(params.ledStrands, gName).forEach((i) => {
          const f = window.ledStrandFixtures && window.ledStrandFixtures[i];
          if (f && typeof f.rebuildVisuals === 'function') f.rebuildVisuals();
        });
      };

      // Rigid numeric move for a LOCKED strand group: a Start/End coordinate edit
      // on one strand translates the WHOLE group along that axis (both endpoints
      // of every member), preserving relative offsets. Returns true when the
      // group is locked (caller then just rebuilds; unlocked edits move only the
      // one endpoint as before). Strands are two points with no orientation, so a
      // rigid move is a pure per-axis translation of every endpoint.
      const applyLockedStrandNumericMove = (strandIndex, field, newVal, prevVal) => {
        const s = params.ledStrands[strandIndex];
        if (!s) return false;
        const gName = displayGroupOf(s);
        if (!isGroupLocked(params.ledGroupOverrides, gName)) return false;
        const members = strandGroupMemberIndices(params.ledStrands, gName);
        if (members.length <= 1) return true;
        const delta = newVal - prevVal;
        if (delta !== 0) {
          const axis = field.slice(-1); // 'X' | 'Y' | 'Z'
          const startKey = `start${axis}`;
          const endKey = `end${axis}`;
          members.forEach((i) => {
            const m = params.ledStrands[i];
            [startKey, endKey].forEach((k) => {
              // lil-gui already wrote the exact field the operator edited.
              if (i === strandIndex && k === field) return;
              m[k] = (m[k] || 0) + delta;
            });
          });
        }
        return true;
      };

      // Deterministic strand ordering (design D4): named groups SORTED BY NAME
      // (operator, 2026-07-30), then the Ungrouped bucket LAST — it is a display
      // bucket, not a group, so it stays pinned to the bottom rather than
      // sorting into the U's. Sign groups are pinned above all of these by
      // _orderLedFixtureInstances after this render. DISPLAY ONLY:
      // params.ledStrands keeps its own order.
      const displayNamedGroups = sortNamesNatural(namedGroups);
      const orderedGroups = [...displayNamedGroups];
      if (groupMap.has(UNGROUPED)) orderedGroups.push(UNGROUPED);

      orderedGroups.forEach((groupName) => {
        // Sorted VIEW — groupMap's arrays (and params.ledStrands) stay put. Key
        // on the SAME string the folder label shows, fallback included.
        const items = sortByNameNatural(
          groupMap.get(groupName) || [],
          (it) => it.strand.name || `Strand ${it.index + 1}`,
        );
        const isUngrouped = groupName === UNGROUPED;
        const gFolder = ledInstancesFolder.addFolder(`${groupName} (${items.length})`);
        window._ledStrandGroupFolders.push(gFolder);
        if (window._openStrandGroups.has(groupName)) gFolder.open(); else gFolder.close();
        if (typeof gFolder.onOpenClose === 'function') {
          gFolder.onOpenClose((open) => {
            if (open) window._openStrandGroups.add(groupName);
            else window._openStrandGroups.delete(groupName);
          });
        }

        // ── Per-group override bag (On/Off + Brightness master + lock) ──
        // Keyed by the DISPLAY group (same key the exporter's direct-paint scale
        // reads), persisted in params.ledGroupOverrides like the DMX map.
        if (!params.ledGroupOverrides) params.ledGroupOverrides = {};
        if (!params.ledGroupOverrides[groupName]) {
          params.ledGroupOverrides[groupName] = { enabled: true, brightness: 100 };
        }
        const ledOv = params.ledGroupOverrides[groupName];
        if (ledOv.enabled === undefined) ledOv.enabled = true;
        if (ledOv.brightness === undefined) ledOv.brightness = 100;
        if (ledOv.locked === undefined) ledOv.locked = false;

        // ── Group toolbar ──
        const gtbWrap = document.createElement('div');
        gtbWrap.style.cssText = 'padding:2px 6px 4px;';

        // Row 1: Select All | Visible toggle (sim visibility) | 🔒 Lock.
        const row1 = document.createElement('div');
        row1.style.cssText = 'display:flex;gap:2px;margin-bottom:2px;';
        const selBtn = document.createElement('button');
        selBtn.textContent = '☑ Select All';
        selBtn.style.cssText = gBtnStyle;
        selBtn.onclick = () => {
          selectStrandGroup(items.map(x => x.index));
          strandFolder.open();
          ledInstancesFolder.open();
          document.activeElement?.blur?.();
        };
        const visBtn = document.createElement('button');
        const groupHidden = items.length > 0 && items.every(({ index }) =>
          window.ledStrandFixtures[index] && window.ledStrandFixtures[index]._visible === false);
        visBtn.textContent = groupHidden ? '○ Off' : '● On';
        visBtn.style.cssText = gBtnStyle + (groupHidden ? 'color:var(--icon);' : 'color:var(--ok);');
        visBtn.onclick = () => {
          const turnOn = visBtn.textContent.includes('Off');
          items.forEach(({ index }) => {
            const f = window.ledStrandFixtures[index];
            if (f) f.setVisibility(turnOn);
          });
          visBtn.textContent = turnOn ? '● On' : '○ Off';
          visBtn.style.cssText = gBtnStyle + (turnOn ? 'color:var(--ok);' : 'color:var(--icon);');
          document.activeElement?.blur?.();
        };
        // 🔒 Group lock — tie every strand in this group together so a Start/End
        // numeric edit moves the WHOLE group rigidly (see applyLockedStrandNumericMove).
        const lockBtn = document.createElement('button');
        const paintStrandLock = () => {
          lockBtn.textContent = ledOv.locked ? '🔒 Locked' : '🔓 Lock';
          lockBtn.style.cssText = gBtnStyle + (ledOv.locked ? 'color:var(--ok);' : 'color:var(--secondary);');
        };
        paintStrandLock();
        lockBtn.title = 'Lock this group so all its strands move together as one rigid body';
        lockBtn.onclick = () => {
          ledOv.locked = !ledOv.locked;
          paintStrandLock();
          debounceAutoSave();
          document.activeElement?.blur?.();
        };
        row1.appendChild(selBtn);
        row1.appendChild(visBtn);
        row1.appendChild(lockBtn);
        gtbWrap.appendChild(row1);

        // Row 2 (named groups only): Rename | + Strand | Ungroup
        // Wraps rather than clips — same fix as the par-group toolbar (report
        // _52): in the docked pane a three-way flex row squeezed "✏ Rename"
        // below its 67px of text, so it rendered as "✏ Ren…".
        if (!isUngrouped) {
          const row2 = document.createElement('div');
          row2.style.cssText = 'display:flex;gap:2px;flex-wrap:wrap;';
          const strandLabelBtn = gBtnStyle + 'flex:0 1 auto;min-width:max-content;';
          const renameBtn = document.createElement('button');
          renameBtn.textContent = '✏ Rename';
          renameBtn.title = `Rename the group "${groupName}" (strand names and their ` +
            'sACN mapping are NOT touched)';
          renameBtn.style.cssText = strandLabelBtn;
          renameBtn.onclick = () => {
            const newName = prompt('Rename LED group:', groupName);
            if (newName === null) return;
            const nn = (newName || '').trim();
            if (nn === groupName) return;
            // Fail loud (codex P0): empty / reserved / colliding names would
            // orphan or merge this group's lock+brightness state — reject them.
            // The guard is scene-wide (see _ledGroupNameClash).
            const clash = _ledGroupNameClash(nn, groupName);
            if (clash) { alert(clash); return; }
            pushUndo();
            let movedCount = 0;
            params.ledStrands.forEach((s) => {
              if (displayGroupOf(s) === groupName) { s.group = nn; movedCount += 1; }
            });
            // Carry the per-group override bag (⏻ On / Brightness / 🔒 locked)
            // across the rename. It is keyed by group name in
            // params.ledGroupOverrides, so WITHOUT this move the rename would
            // ORPHAN the group's lock + brightness (mirror of the DMX rename which
            // carries params.groupOverrides at ~L1900).
            if (params.ledGroupOverrides && params.ledGroupOverrides[groupName]) {
              params.ledGroupOverrides[nn] = params.ledGroupOverrides[groupName];
              delete params.ledGroupOverrides[groupName];
            }
            // Carry the group's view-mask bit across the rename so patterns
            // compiled against MASK_* names stay stable (mirror of DMX rename).
            if (window.viewRegistryRenameGroup) window.viewRegistryRenameGroup(groupName, nn);
            // 2D Pixel Map selectors name groups — re-point them (step 12).
            migratePixelMapGroupSelectors(groupName, nn);
            if (window._openStrandGroups.has(groupName)) {
              window._openStrandGroups.delete(groupName);
              window._openStrandGroups.add(nn);
            }
            if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('led_group_rename');
            // Loud, itemised — same report the par-group rename prints: what was
            // carried (display state), what was untouched (names + sACN mapping),
            // and the one consequence nothing else surfaces — the exported engine
            // model still names the OLD group.
            buildGroupRenameReport({
              oldName: groupName, newName: nn, memberCount: movedCount, kind: 'LED strand',
            }).forEach((line) => console.warn(line));
            _showAutoToast(`✏ Group "${groupName}" → "${nn}" (${movedCount} strand(s)) — ` +
              'addresses untouched; RE-EXPORT the engine model');
            renderStrandGUI();
            debounceAutoSave();
          };
          const addStrandBtn = document.createElement('button');
          addStrandBtn.textContent = '+ Strand';
          addStrandBtn.style.cssText = strandLabelBtn + 'color:var(--ok);';
          addStrandBtn.onclick = () => {
            pushUndo();
            params.ledStrands.push(_newStrandConfig(groupName));
            window._openStrandGroups.add(groupName);
            rebuildLedStrands();
            renderStrandGUI();
            debounceAutoSave();
          };
          const delBtn = document.createElement('button');
          delBtn.textContent = '✕ Ungroup';
          delBtn.style.cssText = strandLabelBtn;
          delBtn.title = 'Dissolve this group — its strands become Ungrouped (no strands deleted)';
          delBtn.onclick = () => {
            pushUndo();
            params.ledStrands.forEach((s) => { if (displayGroupOf(s) === groupName) s.group = ''; });
            window._openStrandGroups.delete(groupName);
            if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('led_group_dissolve');
            renderStrandGUI();
            debounceAutoSave();
          };
          row2.appendChild(renameBtn);
          row2.appendChild(addStrandBtn);
          row2.appendChild(delBtn);
          gtbWrap.appendChild(row2);
        }
        const gChildren = gFolder.domElement.querySelector('.children');
        if (gChildren) gChildren.prepend(gtbWrap);

        // ── Group master: On/Off + Brightness (REAL output override) ──
        // Scales the LED direct-paint path (pixelblaze_model_exporter apply →
        // scaleRgbForGroup) AND the static preview (led_strand.rebuildVisuals),
        // so a slider move dims the whole group live — the LED analogue of the
        // DMX groupOverrides master. NOT a no-op: report 20260724_23 deliberately
        // withheld this until the direct-paint scale existed; it now does.
        gFolder.add(ledOv, 'enabled').name('⏻ Group On').onChange(() => {
          resyncLedGroup(groupName);
          debounceAutoSave();
        });
        gFolder.add(ledOv, 'brightness', 0, 100, 1).name('Group Brightness %').onChange(() => {
          resyncLedGroup(groupName);
          debounceAutoSave();
        });

        // ── Strands in this group ──
        items.forEach(({ strand, index: i }) => {
          const label = `💡 ${strand.name || `Strand ${i + 1}`}`;
          const sFolder = gFolder.addFolder(label);
          sFolder.domElement.classList.add('gui-card');
          sFolder.close();
          window.strandGuiFolders[i] = sFolder;
          window._strandGroupFolderByIndex[i] = gFolder;

          // Selection highlight + pick the strand in 3D when opened.
          if (typeof sFolder.onOpenClose === 'function') {
            sFolder.onOpenClose((open) => {
              if (open) {
                (window.strandGuiFolders || []).forEach(f => { if (f) f.domElement.classList.remove('gui-card-selected'); });
                sFolder.domElement.classList.add('gui-card-selected');
                (window.ledStrandFixtures || []).forEach((f, k) => {
                  if (f && typeof f.setSelected === 'function') f.setSelected(k === i);
                });
              } else {
                sFolder.domElement.classList.remove('gui-card-selected');
              }
            });
          }

          // Name — check + invalidate + duplicate guard (step 11). A strand
          // rides the SAME name-keyed stores as a DMX fixture (chain entries,
          // __globalPatchTree, the shared section/fixture id space), so it
          // gets the identical policy: the renamed strand comes out unmapped.
          let committedStrandName = strand.name;
          const strandNameCtrl = sFolder.add(strand, 'name').name('Name');
          strandNameCtrl.onFinishChange((v) => {
            const proposed = (v || '').trim();
            if (proposed === committedStrandName) {
              strand.name = committedStrandName;
              strandNameCtrl.updateDisplay();
              return;
            }
            if (!renameSingleFixture(strand, committedStrandName, proposed, strandNameCtrl)) {
              return;
            }
            committedStrandName = proposed;
            if (window.invalidateMarsinBatchCache) {
              window.invalidateMarsinBatchCache('strand_rename');
            }
            renderStrandGUI();
            debounceAutoSave();
          });

          // ── Read-only patch line (G5) ── the strand's DMX-parity universe
          // span from persisted `strand.segments`. Purely informational —
          // patching is owned by the Controller Mapping panel.
          const patchRow = document.createElement('div');
          patchRow.style.cssText = 'padding:2px 8px 4px;color:var(--icon);font-size:10px;font-family:var(--font-mono,monospace);';
          const segs = Array.isArray(strand.segments) ? strand.segments : [];
          if ((strand.dmxUniverse || 0) > 0 && segs.length > 0) {
            const first = segs[0];
            const last = segs[segs.length - 1];
            const span = segs.length === 1
              ? `U${first.universe}:${first.startChannel}–${first.endChannel}`
              : `U${first.universe}:${first.startChannel} → U${last.universe}:${last.endChannel}`;
            const uniWord = segs.length === 1 ? 'universe' : 'universes';
            patchRow.textContent = `📡 ${span} · ${strand.pixelCount || 0}px · ${segs.length} ${uniWord}`;
          } else {
            patchRow.textContent = '📡 unpatched';
          }
          const patchChildren = sFolder.domElement.querySelector('.children');
          if (patchChildren) patchChildren.appendChild(patchRow);

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

          // Bulb radius is a GLOBAL control (params.ledPixelSize) above the
          // strand list — not per-strand. The halo BASE radius is global too
          // (params.ledHaloSize × params.globalHaloScale); what IS per-strand
          // is the local multiplier on top of it:
          //   effective halo = ledHaloSize × Global Halo Size × local
          // (led_halo.js). Seeded to 1 so lil-gui can bind it; 1.0 is the
          // no-op default, so a strand nobody touches renders unchanged.
          if (strand.haloScale === undefined) strand.haloScale = 1;
          sFolder.add(strand, 'haloScale',
            LOCAL_HALO_SCALE_MIN, LOCAL_HALO_SCALE_MAX, 0.05).name('Halo ×').onChange(() => {
            // applyVisualSize() re-reads both LED sizes AND this local scale —
            // the same entry point the global halo knob uses (20260725_75), so
            // one strand updates live without rebuilding the whole list.
            const f = (window.ledStrandFixtures || [])[i];
            if (f && f.applyVisualSize) f.applyVisualSize();
            debounceAutoSave();
          });

          // Start/End position folders. Lock-aware: in a LOCKED strand group a
          // Start/End edit translates the WHOLE group rigidly along that axis
          // (applyLockedStrandNumericMove); unlocked, only this endpoint moves.
          const addLockAwareStrandAxis = (folder, field) => {
            const ctrl = folder.add(strand, field, -100, 100, 0.5).name(field.slice(-1));
            let prev = strand[field];
            const snap = () => { prev = strand[field]; };
            if (ctrl.domElement) {
              ['pointerdown', 'focusin', 'wheel', 'keydown'].forEach((ev) =>
                ctrl.domElement.addEventListener(ev, snap, { capture: true }));
            }
            ctrl.onChange(() => {
              const v = strand[field];
              applyLockedStrandNumericMove(i, field, v, prev);
              prev = v;
              rebuildLedStrands();
              debounceAutoSave();
            });
            return ctrl;
          };
          const startF = sFolder.addFolder('Start Point (green)');
          startF.close();
          addLockAwareStrandAxis(startF, 'startX');
          addLockAwareStrandAxis(startF, 'startY');
          addLockAwareStrandAxis(startF, 'startZ');
          const endF = sFolder.addFolder('End Point (red)');
          endF.close();
          addLockAwareStrandAxis(endF, 'endX');
          addLockAwareStrandAxis(endF, 'endY');
          addLockAwareStrandAxis(endF, 'endZ');

          // 🔖 Metadata (V2) — compact DOM panel (shared helper)
          const sChildrenForMeta = sFolder.domElement.querySelector('.children');
          appendMetadataPanelV2(sChildrenForMeta, strand, { onChange: debounceAutoSave });

          // ── Action row: Move to group | Delete ──
          const actDiv = document.createElement('div');
          actDiv.style.cssText = 'display:flex;gap:2px;padding:4px 6px;';
          const moveSelect = document.createElement('select');
          moveSelect.style.cssText = 'flex:1;padding:2px;border:none;border-radius:3px;background:var(--control-bg);color:var(--secondary);font-size:10px;font-family:inherit;cursor:pointer;';
          const defOpt = document.createElement('option');
          defOpt.textContent = '→ Move…'; defOpt.disabled = true; defOpt.selected = true;
          moveSelect.appendChild(defOpt);
          if (!isUngrouped) {
            const uOpt = document.createElement('option');
            uOpt.value = '::ungroup::'; uOpt.textContent = 'Ungrouped';
            moveSelect.appendChild(uOpt);
          }
          displayNamedGroups.forEach((g) => {
            if (g === groupName) return;
            const opt = document.createElement('option');
            opt.value = g; opt.textContent = g;
            moveSelect.appendChild(opt);
          });
          const newOpt = document.createElement('option');
          newOpt.value = '::new::'; newOpt.textContent = '＋ New group…';
          moveSelect.appendChild(newOpt);
          moveSelect.onchange = () => {
            let target = moveSelect.value;
            if (target === '::new::') {
              const nm = prompt('New group name:');
              if (!nm || !nm.trim()) { moveSelect.selectedIndex = 0; return; }
              target = nm.trim();
              // Fail loud on a reserved / existing name — to move into an existing
              // group pick it from the list; "Ungrouped" removes the group.
              const clash = _ledGroupNameClash(target, null);
              if (clash) { alert(clash); moveSelect.selectedIndex = 0; return; }
            } else if (target === '::ungroup::') {
              target = '';
            }
            pushUndo();
            strand.group = target;
            if (target) window._openStrandGroups.add(target);
            if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('led_group_move');
            renderStrandGUI();
            debounceAutoSave();
          };
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
          actDiv.appendChild(moveSelect);
          actDiv.appendChild(delBtn);
          const sChildren = sFolder.domElement.querySelector('.children');
          if (sChildren) sChildren.appendChild(actDiv);
        });
      });

      // Pin the sign (parLights) group folders to the top of the list (design D4).
      if (window._orderLedFixtureInstances) window._orderLedFixtureInstances();
    }
    window.renderStrandGUI = renderStrandGUI;

    renderStrandGUI();
    rebuildLedStrands();
    // The LED Fixtures section (and its LED Fixture Instances list) now exists, so
    // re-run renderParGUI to route the LED-class TE Sign group out of the DMX
    // section and into LED Fixture Instances. (On the DMX-section's own first
    // render this folder did not exist yet, so the sign was parked in the DMX
    // list.) renderParGUI ends by pinning the sign folders to the top of the list.
    if (window.renderParGUI) window.renderParGUI();
  }

  // ─── Build the entire GUI from the config tree ───
  // URL overrides (?profile=, ?lighting_mode=, ?renderer=) are applied
  // authoritatively at boot, right after extractParams() — see
  // src/core/url_overrides.js. By the time we get here both params and the
  // config tree already hold the final values, so the controllers built
  // below render them correctly with no late, order-dependent patching.
  if (configTree) {
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
  // NOT a lil-gui root close. That used to be `if (window.innerWidth <= 768)
  // gui.close()`, and it is what the operator saw as "the Lighting controls menu
  // renders EMPTY" on the iPad's 2D Simulator tab: this panel hides lil-gui's
  // root `.title` (our own header replaces it, line ~455), so a closed root has
  // NO affordance left to reopen it. Measured at 760×1000: the drawer opens to
  // 330×848 with 1103 `.controller` rows in the DOM and 0 px of them rendered —
  // a permanently blank panel with no way back.
  //
  // The small-screen protection it was reaching for already exists one layer up:
  // control_drawer.js defaults to COLLAPSED below 800 px (readCollapsed), which
  // slides the whole drawer off the edge and leaves a reopen tab. That is the
  // affordance; the redundant root close only broke it.
  //
}
