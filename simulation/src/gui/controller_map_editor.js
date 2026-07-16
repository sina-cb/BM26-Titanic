/**
 * controller_map_editor.js — floating "🎛 Controller Mapping" panel.
 *
 * Manages the scene-owned controller registry (controllers.yaml,
 * docs/33): physical DMX controllers (IP + stable id) → ports
 * (universe + startAddress) → daisy chains of fixtures. All per-fixture
 * patch fields (controllerIp / dmxUniverse / dmxAddress / controllerId)
 * are PROJECTED from the mapping — this panel is the only place they
 * are edited. Universe 1 is reserved for global effects with pinned
 * addresses from config.yaml → global_effects.
 *
 * UX contract (docs/33 "UI Design"): one screen, no modes beyond the
 * transient pick mode; append-based flows; single-step undo toasts for
 * small destructive ops; danger modals only for controller/port
 * deletes; everything invalid renders loudly and projects unpatched.
 */
import { params, selectedFixtureIndices } from '../core/state.js';
import {
  DMX_UNIVERSE_SIZE,
  EFFECTS_UNIVERSE,
  MAX_UNIVERSE,
  registryIsActive,
  mappedFixtures,
  addController,
  addPort,
  removeController,
  removePort,
  unmapFixture,
  noteUniverseUsed,
  isValidIp,
  isGapEntry,
  isPinnedEntry,
  entryFixtureName,
  computeProjection,
  CONTROLLER_TYPE_DMX,
  CONTROLLER_TYPE_LED,
  isLedController,
  isBoundLedController,
  controllerFixtureKind,
  controllerAcceptsKind,
  unmappedNamesByKind,
  setControllerType,
  CONTROLLER_PROTOCOL_SACN,
  CONTROLLER_PROTOCOL_ARTNET,
  isArtnetController,
  setControllerProtocol,
  normalizeLedConfig,
  LED_CHANNEL_ORDERS,
  LED_WHITE_MODES,
  ledStrideForOrder,
  computeLedProjection,
  testAutoPatch,
  clearAllPatches,
} from '../dmx/controller_registry.js';
import { gatherAllConfigs, isGlobalEffect, getFootprint } from '../dmx/auto_patcher.js';
import { showCustomConfirm } from './view_masks_editor.js';
import { pinForCornerResize } from './panel_layout.js';
import {
  openLedDiscoveryPanel,
  renderDeviceBindingSection,
  refreshSyncChips,
  deriveLayoutPreview,
  startPushAll,
} from './led_discovery_panel.js';
import {
  computeLedStrandPatches,
  computeLedUniverseClaims,
  projectLedStrandSegments,
  validateLedManualUniverses,
} from '../dmx/led/led_patch_projection.js';

// ── Panel state ─────────────────────────────────────────────────────────

let pickTarget = null;   // { controllerId, portNum } while pick mode is active
let trayFilter = '';
let undoState = null;    // { snapshot, timer } — single-step undo (docs/33)
let hoverRestore = null; // pending hover flash restore
let lastProj = null;     // latest computeProjection result (universeEnds cache rides it)
let lastLedWarnings = []; // latest validateLedManualUniverses result (Slice D warn chips)
let lastLedClaims = new Map(); // latest computeLedUniverseClaims (LED occupancy in the bars)
const collapsedControllers = new Set(); // controller ids
const collapsedPorts = new Set();       // '<controllerId>:<portNum>' keys
const collapsedGroups = new Set();      // 'DMX' | 'LED' — collapsed type sections

// Operator-facing label for the LED controller type (Round 2 R3). The single
// LED vendor today is MarsinLED; CONTROLLER_TYPE_LED / vendor 'marsinled' stay
// the underlying identifiers (extensible for future vendors), but the UI reads
// "MarsinLED" everywhere the type is named.
const LED_TYPE_LABEL = 'MarsinLED';

function registry() {
  // No fallback (codex P0): main.js installs the registry for every
  // scene at boot. A missing one means boot never finished — handing
  // out a throwaway object here would let panel mutations silently
  // vanish (a fresh object per call, never saved).
  if (!window.__controllerRegistry) {
    throw new Error('[Controllers] window.__controllerRegistry is not initialized — ' +
      'scene boot never installed the registry; refusing to operate on a throwaway');
  }
  return window.__controllerRegistry;
}

function pins() {
  return (window.serverConfig && window.serverConfig.global_effects) || {};
}

/** Selection indexing basis — same rule as the Views panel. */
function fixtureList() {
  return (params.dmxFixtures && params.dmxFixtures.length > 0) ? params.dmxFixtures : params.parLights;
}

/** LED strands (the tray source for LED-type controllers). */
function strandList() {
  return Array.isArray(params.ledStrands) ? params.ledStrands : [];
}

/** Map<strandName, ledCount> for the LED projection (addresses preview). */
function strandLedCounts() {
  const m = new Map();
  for (const s of strandList()) {
    if (s && typeof s.name === 'string' && s.name.length > 0) m.set(s.name, s.ledCount || 10);
  }
  return m;
}

/**
 * The per-universe LED occupancy claim map (mirror of computeProjection's
 * universeMaps, for LED strands). Bound strands come from the device-linear
 * `computeLedStrandPatches` segments; unbound strands from the generic
 * `computeLedProjection`. `computeLedProjection` covers ALL LED controllers, so
 * strands already resolved by the bound path are dropped from the generic input
 * — each strand claims exactly once.
 * @returns {Map<number, Array<{start,end,name,controllerId,portNum?,led}>>}
 */
function ledUniverseClaims() {
  const reg = registry();
  if (!registryIsActive(reg)) return new Map();
  const counts = strandLedCounts();
  const bound = computeLedStrandPatches(reg, counts).fields;
  const generic = computeLedProjection(reg, counts).fields;
  const unbound = new Map();
  for (const [name, rec] of generic) if (!bound.has(name)) unbound.set(name, rec);
  return computeLedUniverseClaims(bound, unbound);
}

/**
 * The operator-facing universe:channel SPAN string for a strand's segments —
 * `U6:1–160` for a single universe, `U6:1 → U7:288` when it spills. PURE (no
 * DOM), so it is unit-tested directly (led_segments_persistence.test.js).
 * @param {Array<{universe,startChannel,endChannel}>} segments
 * @returns {string} '' when there are no segments (unresolved).
 */
export function ledStrandSpanText(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return '';
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (segments.length === 1) {
    return `U${first.universe}:${first.startChannel}–${first.endChannel}`;
  }
  return `U${first.universe}:${first.startChannel} → U${last.universe}:${last.endChannel}`;
}

/** Verbose per-segment tooltip: `U6 ch1–512 ×128px · U7 ch1–288 ×72px`. */
export function ledStrandSpanTooltip(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return '';
  return segments
    .map((s) => `U${s.universe} ch${s.startChannel}–${s.endChannel} ×${s.pixelCount}px`)
    .join(' · ');
}

/**
 * Resolve a strand projection record (bound = carries `segments`; unbound =
 * START-only `{universe,addr,stride,ledCount}`) into `{segments, px}` for the
 * chip. Unbound records are walked with the shared segment walker so bound and
 * unbound chips read identically.
 */
function strandSegmentsFor(rec) {
  if (!rec) return null;
  if (Array.isArray(rec.segments)) return { segments: rec.segments, px: rec.pixelCount };
  const walk = projectLedStrandSegments(rec.universe, rec.addr, rec.stride, rec.ledCount);
  return { segments: walk.segments, px: rec.ledCount };
}

function allConfigs() {
  return gatherAllConfigs(params).filter(c => c && typeof c.name === 'string' && c.name.length > 0);
}

/**
 * Context handed to the LED discovery panel (plan P3): the primitives it needs
 * to read the registry, run mutations through THIS panel's mutate()/undo/save
 * pipeline, read strand counts, re-render, and toast — without importing the
 * editor's private state.
 */
function ledCtx() {
  return {
    registry,
    mutate,
    strandLedCounts,
    refresh: renderIfOpen,
    showToast,
    activeScene: () => window.__activeScene || 'default',
  };
}

function configsByName() {
  const map = new Map();
  for (const config of allConfigs()) map.set(config.name, config);
  return map;
}

// ── Projection / change propagation ─────────────────────────────────────

// Tracks whether the mapper owned the patch fields on the previous
// recompute. projectControllerMappings() deliberately no-ops on an
// inactive registry (so unmapped scenes keep their stored patches.yaml
// at boot) — but when the OPERATOR deletes the last controller, the
// fields the mapping was projecting a moment ago must not linger as a
// silent lie. The active→inactive transition unpatches everything.
let mapperWasActive = false;

function recomputeAndMark() {
  if (registryIsActive(registry())) {
    if (window.projectControllerMappings) {
      window.projectControllerMappings(allConfigs());
    }
    mapperWasActive = true;
  } else if (mapperWasActive) {
    for (const config of allConfigs()) {
      config.controllerIp = '';
      config.dmxUniverse = 0;
      config.dmxAddress = 0;
      config.controllerId = 0;
      if (window.__globalPatchTree && window.__globalPatchTree[config.name]) {
        Object.assign(window.__globalPatchTree[config.name], {
          controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0,
        });
      }
    }
    window.__controllerViolations = [];
    console.warn('[Controllers] Last controller deleted — all fixtures returned to unpatched');
    mapperWasActive = false;
  }
  // LED strands carry their own device-linear patch records (plan P4) —
  // re-derive them on every mapping change so a bound controller's strands
  // auto-subscribe and persist alongside the DMX projection.
  if (window.projectLedStrandPatches) window.projectLedStrandPatches();
  // Spill-universe reservation (G4): reserve EVERY universe an LED strand
  // streams into (start + spills) so a later addPort's nextFreeUniverse never
  // hands out a universe an LED strand already occupies — the LED mirror of the
  // DMX high-water contract (controller_registry noteUniverseUsed). Mutation-
  // time only (projection functions stay pure); the registry save then persists
  // nextUniverse past every LED spill.
  if (registryIsActive(registry())) {
    for (const u of ledUniverseClaims().keys()) noteUniverseUsed(registry(), u);
  }
  if (window.recomputePatchesActive) window.recomputePatchesActive();
  if (window.debounceAutoSave) window.debounceAutoSave();
  if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('metadata');
  if (window.refreshMetadataPanels) window.refreshMetadataPanels();
}

// ── Undo (single-step snapshot, 10 s window) ────────────────────────────

function snapshotRegistry() {
  const reg = registry();
  return JSON.stringify({
    nextControllerId: reg.nextControllerId,
    nextUniverse: reg.nextUniverse,
    controllers: reg.controllers,
  });
}

function restoreSnapshot(snapshot) {
  // Restore IN PLACE — the registry object is referenced by the config
  // tree (save path) and window.__controllerRegistry; identity must hold.
  const reg = registry();
  const parsed = JSON.parse(snapshot);
  reg.nextControllerId = parsed.nextControllerId;
  reg.nextUniverse = parsed.nextUniverse;
  reg.controllers.length = 0;
  for (const controller of parsed.controllers) reg.controllers.push(controller);
}

// ── Toast ───────────────────────────────────────────────────────────────

function dismissToast() {
  const el = document.getElementById('cm-toast');
  if (el) el.remove();
  if (undoState && undoState.timer) clearTimeout(undoState.timer);
  undoState = null;
}

function showToast(message, { undoSnapshot = null, error = false, ttl = 10000 } = {}) {
  dismissToast();
  const toast = document.createElement('div');
  toast.id = 'cm-toast';
  if (error) toast.classList.add('cm-toast-error');
  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);

  if (undoSnapshot !== null) {
    const undoBtn = document.createElement('button');
    undoBtn.textContent = 'Undo';
    undoBtn.onclick = () => {
      restoreSnapshot(undoSnapshot);
      dismissToast();
      recomputeAndMark();
      renderIfOpen();
    };
    toast.appendChild(undoBtn);
  }
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.onclick = dismissToast;
  toast.appendChild(closeBtn);
  document.body.appendChild(toast);

  const timer = setTimeout(dismissToast, ttl);
  undoState = { snapshot: undoSnapshot, timer };
}

/**
 * Run a mutation with undo support: snapshot → mutate → reproject →
 * re-render. `toastMessage: null` skips the toast (non-destructive ops).
 */
function mutate(toastMessage, fn) {
  const snapshot = snapshotRegistry();
  fn();
  recomputeAndMark();
  renderIfOpen();
  if (toastMessage) showToast(toastMessage, { undoSnapshot: snapshot });
}

// ── 3D selection sync ───────────────────────────────────────────────────

function fixtureIndexByName(name) {
  const list = fixtureList();
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].name === name) return i;
  }
  return -1;
}

function setFixtureSelectedVisual(index, selected) {
  if (window.parFixtures && window.parFixtures[index]) {
    window.parFixtures[index].setSelected(selected);
  }
}

function selectFixtureIn3D(name) {
  const index = fixtureIndexByName(name);
  if (index < 0) return;
  for (const i of selectedFixtureIndices) setFixtureSelectedVisual(i, false);
  selectedFixtureIndices.clear();
  selectedFixtureIndices.add(index);
  setFixtureSelectedVisual(index, true);
  if (window.refreshViewMasksPanel) window.refreshViewMasksPanel();
}

/** Hover flash: light the fixture's selection visuals without selecting. */
function flashFixture(name, on) {
  const index = fixtureIndexByName(name);
  if (index < 0) return;
  if (on) {
    hoverRestore = { index, wasSelected: selectedFixtureIndices.has(index) };
    setFixtureSelectedVisual(index, true);
  } else if (hoverRestore && hoverRestore.index === index) {
    setFixtureSelectedVisual(index, hoverRestore.wasSelected);
    hoverRestore = null;
  }
}

/** Selection order = chain order: Set iterates in insertion order. */
function selectedFixtureNames() {
  const list = fixtureList();
  const names = [];
  for (const i of selectedFixtureIndices) {
    if (list[i] && list[i].name) names.push(list[i].name);
  }
  return names;
}

// ── Derived render data ─────────────────────────────────────────────────

function projection() {
  lastProj = computeProjection(registry(), configsByName(), pins());
  return lastProj;
}

// ── The allocator (docs/33 decision 19) ─────────────────────────────────
// Addresses are assigned ONCE at add time: one past the end of the
// universe's full occupancy map (all ports, all controllers — gaps and
// pins included) and sticky thereafter. Returns an allocate(footprint)
// function that tracks in-batch allocations, or null when nothing of
// that size fits at the end (holes are never reused automatically —
// the operator compacts deliberately; see the Notion backlog card).
function makeAllocator(universe) {
  const proj = lastProj || projection();
  let end = proj.universeEnds.get(universe) || 0;
  return (footprint) => {
    const width = Math.max(1, footprint | 0);
    if (end + width > DMX_UNIVERSE_SIZE) return null;
    const at = end + 1;
    end += width;
    return at;
  };
}

function unmappedNames() {
  return unmappedNamesByKind(registry(), allConfigs().map(c => c.name), []).fixtures;
}

/** Unmapped LED-strand names (the tray source when picking onto LED). */
function unmappedStrandNames() {
  return unmappedNamesByKind(registry(), [], strandList().map(s => s && s.name)).strands;
}

/** The set of LED-strand names in the scene (for strict type gating). */
function strandNameSet() {
  const set = new Set();
  for (const s of strandList()) {
    if (s && typeof s.name === 'string' && s.name.length > 0) set.add(s.name);
  }
  return set;
}

/** Kind ('strand'|'fixture'|'unknown') of a mappable name, for cross-type guards. */
function nameKind(name) {
  return strandNameSet().has(name) ? 'strand' : 'fixture';
}

function violationsFor(violations, controller, port) {
  return violations.filter(v =>
    v.controllerId === controller.id && (port === null ? v.port === 0 : v.port === port.port));
}

/**
 * LED manual-universe warnings (Slice D) for a controller (portNum === null ⇒
 * controller-level, e.g. collisions at port 0) or a specific port. These are
 * NON-BLOCKING advisories — the operator owns universe matching; the projection
 * and every push proceed regardless (rendered as cm-warn-chip, not error).
 */
function ledWarningsFor(controllerId, portNum) {
  return lastLedWarnings.filter(w =>
    w.controllerId === controllerId && (portNum === null ? w.port === 0 : w.port === portNum));
}

// ── Rendering ───────────────────────────────────────────────────────────

let panelEl = null;
let bodyEl = null;
let headerStatusEl = null;

function renderIfOpen() {
  if (panelEl && !panelEl.classList.contains('hidden')) render();
}

function render() {
  const reg = registry();
  const proj = projection();
  // Slice D: manual per-output universe warnings (unhonorable / collision /
  // duplicate). Loud but non-blocking — rendered as warn chips on the cards.
  lastLedWarnings = validateLedManualUniverses(reg, strandLedCounts(), proj.universeMaps);
  // LED occupancy for the universe bars (G5): a DMX port whose universe also
  // carries an LED stream renders the LED claim alongside its DMX claims.
  lastLedClaims = ledUniverseClaims();
  const unmapped = unmappedNames();
  const unmappedStrands = unmappedStrandNames();
  const unmappedTotal = unmapped.length + unmappedStrands.length;
  // Preserve the controllers scroll region across the full re-render. Collapsing
  // a port/controller/group rebuilds the whole panel via renderIfOpen(); without
  // this the pane jumps back to the top on every toggle.
  const prevMainScroll = bodyEl.querySelector('.cm-main')?.scrollTop ?? 0;
  bodyEl.replaceChildren();

  // Header status: the operator's "fully patched" signal (docs/33). LED
  // strands are fixtures too — an unbound LED line must count as unmapped, so
  // the panel never reads "fully patched" while a strand is still unpatched.
  if (!registryIsActive(reg)) {
    headerStatusEl.textContent = '';
    headerStatusEl.className = 'cm-header-status';
  } else if (unmappedTotal > 0) {
    headerStatusEl.textContent = `Unmapped: ${unmappedTotal} ⚠`;
    headerStatusEl.className = 'cm-header-status cm-warn';
  } else if (proj.violations.length > 0) {
    headerStatusEl.textContent = `${proj.violations.length} violation(s) ⚠`;
    headerStatusEl.className = 'cm-header-status cm-warn';
  } else {
    headerStatusEl.textContent = '✓ fully patched';
    headerStatusEl.className = 'cm-header-status cm-ok';
  }

  // Violations banner (all of them, scene-wide — fail loudly). Pinned
  // above the scroll region, capped + scrollable itself so a pile of
  // violations can't push the controls off screen.
  if (proj.violations.length > 0) {
    const banner = document.createElement('div');
    banner.className = 'cm-banner';
    banner.textContent = proj.violations.map(v => `✋ ${v.message}`).join('\n');
    bodyEl.appendChild(banner);
  }

  // Controllers live in their own scroll region; the tray, save button
  // and hint stay fixed below it so they're always reachable — sized
  // for rigs with 15+ controllers and hundreds of fixtures.
  const main = document.createElement('div');
  main.className = 'cm-main';

  // Unpatched-red overlay toggle (sim-only diagnostic; no DMX is sent).
  // Synced with the "Show Unpatched (Red)" checkbox in the DMX Fixtures
  // panel — both write the same params.showUnpatchedRed flag.
  const overlayOn = !!params.showUnpatchedRed;
  const overlayBtn = document.createElement('button');
  overlayBtn.className = overlayOn ? 'cm-btn cm-unpatched-toggle cm-on' : 'cm-btn cm-unpatched-toggle';
  overlayBtn.textContent = overlayOn
    ? '🔴 Unpatched Highlight: ON'
    : '⚪ Unpatched Highlight: OFF';
  overlayBtn.title = 'Tint fixtures with no DMX patch red in the 3D view ' +
    '(preview only — no DMX data is sent). Synced with "Show Unpatched (Red)" ' +
    'in the DMX Fixtures panel.';
  overlayBtn.onclick = () => {
    params.showUnpatchedRed = !params.showUnpatchedRed;
    renderIfOpen(); // refresh this button's label/state (the lil-gui checkbox self-syncs via .listen())
  };
  main.appendChild(overlayBtn);

  const addBtn = document.createElement('button');
  addBtn.className = 'cm-btn cm-add';
  addBtn.textContent = '+ Add Controller';
  addBtn.onclick = showAddControllerModal;
  main.appendChild(addBtn);

  // ── TEST patch tools (operator quick-patch, report 20260619_2) ───────
  // One click to patch (or wipe) the WHOLE rig with a simple deterministic
  // TEST mapping — so the rig streams/visualizes without hand patching.
  // This is a smoke utility, NOT production hardware addressing; real
  // addressing stays the per-fixture flow above.
  const testRow = document.createElement('div');
  testRow.className = 'cm-test-tools';

  const autoBtn = document.createElement('button');
  autoBtn.className = 'cm-btn cm-test-autopatch';
  autoBtn.textContent = '⚡ Test Auto-Patch';
  autoBtn.title = 'TEST utility: assign controllers to ALL fixtures and patch the whole rig ' +
    'with a simple sequential mapping (creates a default DMX + LED controller if none exist). ' +
    'For sim/engine smoke — not production hardware addressing.';
  autoBtn.onclick = runTestAutoPatch;
  testRow.appendChild(autoBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'cm-btn cm-danger cm-test-clear';
  clearBtn.textContent = '🧹 Clear All Patches';
  clearBtn.title = 'Remove EVERY patch assignment across all controllers — fixtures return to ' +
    'the unpatched state. Controllers and ports are kept; only the bindings are wiped.';
  clearBtn.onclick = runClearAllPatches;
  testRow.appendChild(clearBtn);

  main.appendChild(testRow);

  // Two independently-collapsible type sections (Round 2 R6): DMX controllers
  // and MarsinLED controllers, split by controller.type. The Discover + Push-all
  // buttons live in the MarsinLED group header.
  const dmxControllers = reg.controllers.filter(c => !isLedController(c));
  const ledControllers = reg.controllers.filter(c => isLedController(c));
  main.appendChild(renderControllerGroup('DMX', 'DMX Controllers', dmxControllers, proj));
  main.appendChild(renderControllerGroup('LED', `${LED_TYPE_LABEL} Controllers`, ledControllers, proj));
  bodyEl.appendChild(main);
  main.scrollTop = prevMainScroll; // restore scroll after the rebuild (see above)

  bodyEl.appendChild(renderTray(unmapped, unmappedStrands, proj));

  // Save button — same contract as the Views panel save.
  const saveBtn = document.createElement('button');
  const isDirty = window.__sceneDirty || false;
  saveBtn.className = isDirty ? 'vm-btn vm-save vm-dirty' : 'vm-btn vm-save';
  saveBtn.textContent = isDirty ? '💾 Save Configuration *' : '💾 Save Configuration';
  saveBtn.onclick = () => {
    if (window.exportConfig) {
      window.exportConfig();
      setTimeout(() => renderIfOpen(), 400);
    }
  };
  bodyEl.appendChild(saveBtn);

  const hint = document.createElement('div');
  hint.className = 'cm-hint';
  hint.textContent = 'Map fixtures by 3D selection (shift-click, then “+ sel”) or pick mode ' +
    '(“+ list”). Addresses are assigned at add time from the end of the universe and stick — ' +
    'type any address to move a fixture (conflicts go red but stand), clear it to send it to ' +
    'the end. Saved to controllers.yaml, projected into patches.yaml.';
  bodyEl.appendChild(hint);
}

// ── Collapsible type group (DMX / MarsinLED) ────────────────────────────
// Two sections, split by controller.type, each independently collapsible
// (state persisted in collapsedGroups for the session, like
// collapsedControllers). The MarsinLED header carries the Discover + Push-all
// buttons. An empty group shows a muted hint (so Discover stays reachable with
// zero LED controllers) rather than vanishing (Round 2 R6).

function renderControllerGroup(kind, title, controllers, proj) {
  const group = document.createElement('div');
  group.className = `cm-group cm-group-${kind.toLowerCase()}`;

  const head = document.createElement('div');
  head.className = 'cm-group-head';

  const isCollapsed = collapsedGroups.has(kind);
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'cm-toggle';
  toggleBtn.textContent = isCollapsed ? '▸' : '▾';
  toggleBtn.title = isCollapsed ? `Expand ${title}` : `Collapse ${title}`;
  toggleBtn.onclick = () => {
    if (isCollapsed) collapsedGroups.delete(kind);
    else collapsedGroups.add(kind);
    renderIfOpen();
  };
  head.appendChild(toggleBtn);

  const titleEl = document.createElement('span');
  titleEl.className = 'cm-group-title';
  titleEl.textContent = `${title} (${controllers.length})`;
  head.appendChild(titleEl);

  // MarsinLED group header: Discover (create-only) + Push-all bound controllers.
  if (kind === 'LED') {
    const spacer = document.createElement('span');
    spacer.className = 'cm-group-spacer';
    head.appendChild(spacer);

    const discoverBtn = document.createElement('button');
    discoverBtn.className = 'cm-btn cm-discover-led';
    discoverBtn.textContent = '🔍 Discover';
    discoverBtn.title = 'Scan a subnet for MarsinLED LED-string controllers and create one from a device';
    discoverBtn.onclick = () => openLedDiscoveryPanel(ledCtx(), { controller: null });
    head.appendChild(discoverBtn);

    const boundCount = controllers.filter(isBoundLedController).length;
    const pushAllBtn = document.createElement('button');
    pushAllBtn.className = 'cm-btn cm-push-all-led';
    pushAllBtn.textContent = '⬆ Push all';
    pushAllBtn.title = 'Push every BOUND MarsinLED controller sequentially (each device reboots)';
    pushAllBtn.disabled = boundCount === 0;
    pushAllBtn.onclick = () => startPushAll(ledCtx());
    head.appendChild(pushAllBtn);
  }
  group.appendChild(head);

  if (isCollapsed) return group;

  if (controllers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cm-group-empty';
    empty.textContent = kind === 'LED'
      ? 'No MarsinLED controllers yet — Discover one, or add an LED controller.'
      : 'No DMX controllers yet — “+ Add Controller” creates one.';
    group.appendChild(empty);
    return group;
  }

  const cards = document.createElement('div');
  cards.className = 'cm-group-cards';
  for (const controller of controllers) {
    cards.appendChild(renderController(controller, proj));
  }
  group.appendChild(cards);
  return group;
}

// ── Controller card ─────────────────────────────────────────────────────

function renderController(controller, proj) {
  const card = document.createElement('div');
  card.className = 'cm-controller';

  const head = document.createElement('div');
  head.className = 'cm-controller-head';

  const isCollapsed = collapsedControllers.has(controller.id);
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'cm-toggle';
  toggleBtn.textContent = isCollapsed ? '▸' : '▾';
  toggleBtn.title = isCollapsed ? 'Expand controller' : 'Collapse controller';
  toggleBtn.onclick = () => {
    if (isCollapsed) collapsedControllers.delete(controller.id);
    else collapsedControllers.add(controller.id);
    renderIfOpen();
  };
  head.appendChild(toggleBtn);

  const nameInp = document.createElement('input');
  nameInp.className = 'cm-input cm-name';
  nameInp.value = controller.name;
  nameInp.title = 'Controller name';
  nameInp.onchange = () => {
    const next = nameInp.value.trim();
    if (next.length === 0) {
      nameInp.value = controller.name;
      return;
    }
    mutate(null, () => { controller.name = next; });
  };

  const ipInp = document.createElement('input');
  ipInp.className = 'cm-input cm-ip' + (isValidIp(controller.ip) ? '' : ' cm-invalid');
  ipInp.value = controller.ip;
  ipInp.placeholder = 'a.b.c.d';
  ipInp.title = 'Controller IP (sACN unicast target)';
  ipInp.onchange = () => {
    mutate(null, () => { controller.ip = ipInp.value.trim(); });
  };

  // ── DMX / LED type toggle ──────────────────────────────────────────
  // ONE controller menu, two types (operator requirement; report
  // 20260618_6 §D.1). A DMX controller patches DMX fixtures; an LED
  // controller patches LED strands (sequential pixel addressing, RGBW
  // stride, native white). Toggling installs/drops the LED config and
  // re-renders the tray. Chain entries are kept (the projection flags any
  // that no longer resolve to the new tray) — never silently discarded.
  const typeBtn = document.createElement('button');
  const isLed = isLedController(controller);
  typeBtn.className = 'cm-btn cm-type-toggle' + (isLed ? ' cm-type-led' : ' cm-type-dmx');
  typeBtn.textContent = isLed ? LED_TYPE_LABEL : 'DMX';
  typeBtn.title = isLed
    ? `${LED_TYPE_LABEL} controller (patches LED strands). Click to switch to DMX.`
    : `DMX controller (patches DMX fixtures). Click to switch to ${LED_TYPE_LABEL}.`;
  typeBtn.onclick = () => {
    const next = isLed ? CONTROLLER_TYPE_DMX : CONTROLLER_TYPE_LED;
    const nextLabel = next === CONTROLLER_TYPE_LED ? LED_TYPE_LABEL : 'DMX';
    mutate(`Set '${controller.name}' to ${nextLabel}`, () => {
      setControllerType(controller, next);
    });
  };

  // ── sACN / Art-Net transport toggle ─────────────────────────────────
  // Independent of the DMX/LED type: selects the network transport this
  // controller's universes stream over. The DMX channel data is identical
  // on either wire — only packet framing + UDP port differ (sACN :5568 /
  // Art-Net :6454). Transport tops out here (operator decision 2026-06-19:
  // no DDP / WLED-native).
  const protoBtn = document.createElement('button');
  const isArtnet = isArtnetController(controller);
  protoBtn.className = 'cm-btn cm-proto-toggle' + (isArtnet ? ' cm-proto-artnet' : ' cm-proto-sacn');
  protoBtn.textContent = isArtnet ? 'Art-Net' : 'sACN';
  protoBtn.title = isArtnet
    ? 'Art-Net transport (ArtDMX → UDP :6454). Click to switch to sACN.'
    : 'sACN/E1.31 transport (UDP :5568). Click to switch to Art-Net.';
  protoBtn.onclick = () => {
    const next = isArtnet ? CONTROLLER_PROTOCOL_SACN : CONTROLLER_PROTOCOL_ARTNET;
    mutate(`Set '${controller.name}' transport to ${next}`, () => {
      setControllerProtocol(controller, next);
    });
  };

  const addPortBtn = document.createElement('button');
  addPortBtn.className = 'cm-btn';
  addPortBtn.textContent = '+port';
  addPortBtn.title = 'Add a port (next free universe pre-filled)';
  addPortBtn.onclick = () => {
    mutate(null, () => { addPort(registry(), controller); });
  };

  const delBtn = document.createElement('button');
  delBtn.className = 'cm-btn cm-danger';
  delBtn.textContent = '🗑';
  delBtn.title = 'Delete controller';
  delBtn.onclick = () => {
    const mappedCount = controller.ports.reduce(
      (n, p) => n + p.chain.filter(e => entryFixtureName(e) !== null).length, 0);
    const doDelete = () => {
      mutate(`Deleted controller '${controller.name}'`, () => {
        const freed = removeController(registry(), controller);
        if (freed.length > 0) {
          console.warn(`[Controllers] ${freed.length} fixture(s) returned to Unmapped:`, freed);
        }
      });
    };
    if (mappedCount > 0) {
      showCustomConfirm({
        title: 'Delete Controller',
        text: `Delete '${controller.name}' (${controller.ip || 'no IP'})? ` +
          `${mappedCount} mapped fixture(s) return to Unmapped and project unpatched.`,
        onConfirm: doDelete,
      });
    } else {
      doDelete();
    }
  };

  head.appendChild(nameInp);
  head.appendChild(ipInp);
  head.appendChild(typeBtn);
  head.appendChild(protoBtn);
  head.appendChild(addPortBtn);
  head.appendChild(delBtn);
  card.appendChild(head);

  for (const v of violationsFor(proj.violations, controller, null)) {
    const chip = document.createElement('span');
    chip.className = 'cm-error-chip';
    chip.textContent = v.message;
    card.appendChild(chip);
  }
  // Controller-level LED universe warnings (collisions) — non-blocking (Slice D).
  for (const w of ledWarningsFor(controller.id, null)) {
    const chip = document.createElement('span');
    chip.className = 'cm-warn-chip';
    chip.textContent = w.message;
    card.appendChild(chip);
  }

  // ── LED config sub-panel (LED controllers only) ────────────────────
  // Channel order (→ stride), start universe/address, and white mode.
  // These feed computeLedProjection at export so every bound strand gets
  // its sequential per-pixel patch.
  if (isLed) {
    const led = controller.led || normalizeLedConfig(null, controller.name);
    controller.led = led;
    const cfg = document.createElement('div');
    cfg.className = 'cm-led-config';

    const orderSel = document.createElement('select');
    orderSel.className = 'cm-input cm-led-order';
    orderSel.title = 'LED channel order (sets stride: 3 for RGB-class, 4 for RGBW-class)';
    for (const name of Object.keys(LED_CHANNEL_ORDERS)) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      if (name === led.order) opt.selected = true;
      orderSel.appendChild(opt);
    }
    orderSel.onchange = () => {
      mutate(null, () => {
        led.order = orderSel.value;
        led.stride = ledStrideForOrder(led.order);
      });
    };

    // Per-output firmware (operator ruling 2026-07-10/11): there is no single
    // base universe any more — each output streams its OWN port.universe @1.
    // This readout shows the FIRST mapped output's universe purely as a visual
    // anchor (the legacy firstEnabledPortUniverse helper was removed with the
    // linear path); the real per-output universes live on the port rows below.
    const firstMapped = (controller.ports || []).find(
      (p) => Array.isArray(p.chain) && p.chain.length > 0 &&
        Number.isInteger(p.universe) && p.universe >= 1);
    const baseOut = document.createElement('span');
    baseOut.className = 'cm-led-base';
    baseOut.textContent = firstMapped ? `U${firstMapped.universe}` : '—';
    baseOut.title = firstMapped
      ? `First mapped output (P${firstMapped.port}) streams U${firstMapped.universe}. ` +
        'Per-output firmware: edit each output\'s universe on its port row below.'
      : 'No mapped output yet — assign a strand to a port; each output streams its own universe.';

    const addrInp = document.createElement('input');
    addrInp.className = 'cm-input cm-num';
    addrInp.type = 'number'; addrInp.min = '1'; addrInp.max = '512';
    addrInp.value = led.startAddr || 1;
    addrInp.title = 'Start channel within the base universe (1–512)';
    addrInp.onchange = () => {
      const v = parseInt(addrInp.value, 10);
      mutate(null, () => { led.startAddr = Number.isInteger(v) && v >= 1 && v <= 512 ? v : 1; });
    };

    const whiteSel = document.createElement('select');
    whiteSel.className = 'cm-input cm-led-white';
    whiteSel.title = 'White mode: native = pass the rendered W lane raw ' +
      '(hardware derives white); synth = host-synthesize W = min(R,G,B)';
    for (const mode of LED_WHITE_MODES) {
      const opt = document.createElement('option');
      opt.value = mode; opt.textContent = `W:${mode}`;
      if (mode === led.whiteMode) opt.selected = true;
      whiteSel.appendChild(opt);
    }
    whiteSel.onchange = () => {
      mutate(null, () => { led.whiteMode = whiteSel.value; });
    };

    const lbl = (text) => {
      const s = document.createElement('span');
      s.className = 'cm-led-lbl';
      s.textContent = text;
      return s;
    };
    cfg.appendChild(lbl('order')); cfg.appendChild(orderSel);
    cfg.appendChild(lbl('stride'));
    const strideOut = document.createElement('span');
    strideOut.className = 'cm-led-stride';
    strideOut.textContent = String(led.stride);
    cfg.appendChild(strideOut);
    cfg.appendChild(lbl('base')); cfg.appendChild(baseOut);
    cfg.appendChild(lbl('@')); cfg.appendChild(addrInp);
    cfg.appendChild(whiteSel);
    card.appendChild(cfg);

    // Device binding: identity + sync chip + Push (bound), or a Discover/bind
    // button (unbound). All device I/O lives in led_discovery_panel.
    const deviceSection = renderDeviceBindingSection(ledCtx(), controller);
    if (deviceSection) card.appendChild(deviceSection);
  }

  if (isCollapsed) {
    const fixtureCount = controller.ports.reduce(
      (n, p) => n + p.chain.filter(e => entryFixtureName(e) !== null).length, 0);
    const universes = [...new Set(controller.ports.map(p => `U${p.universe}`))].join(' ');
    const summary = document.createElement('div');
    summary.className = 'cm-summary';
    summary.textContent = `${controller.ports.length} port(s) · ${fixtureCount} fixture(s) · ${universes}`;
    card.appendChild(summary);
    return card;
  }

  for (const port of controller.ports) {
    card.appendChild(isLedController(controller)
      ? renderLedPort(controller, port, proj)
      : renderPort(controller, port, proj));
  }
  return card;
}

// ── LED port row (strand chains, sequential pixel addressing) ───────────

function renderLedPort(controller, port, proj) {
  const row = document.createElement('div');
  row.className = 'cm-port cm-port-led';
  const isPicking = pickTarget &&
    pickTarget.controllerId === controller.id && pickTarget.portNum === port.port;
  if (isPicking) row.classList.add('cm-port-picking');

  const head = document.createElement('div');
  head.className = 'cm-port-head';

  const portKey = `${controller.id}:${port.port}`;
  const portCollapsed = collapsedPorts.has(portKey);
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'cm-toggle';
  toggleBtn.textContent = portCollapsed ? '▸' : '▾';
  toggleBtn.onclick = () => {
    if (portCollapsed) collapsedPorts.delete(portKey);
    else collapsedPorts.add(portKey);
    renderIfOpen();
  };
  head.appendChild(toggleBtn);

  const strandCount = port.chain.filter(e => entryFixtureName(e) !== null).length;
  const label = document.createElement('span');
  label.className = 'cm-port-label';
  label.textContent = `P${port.port} · U`;
  head.appendChild(label);

  // Per-output universe is MANUAL and EDITABLE (Slice D): the operator declares
  // each output's universe; the device is single-base linear, so the FIRST
  // ENABLED output's universe is the base and the projection/push warn loudly
  // (never block) on any output the device can't honor.
  const uniInp = document.createElement('input');
  uniInp.className = 'cm-input cm-num';
  uniInp.type = 'number';
  uniInp.min = '1';
  uniInp.max = String(MAX_UNIVERSE);
  uniInp.value = port.universe;
  uniInp.title = `Manual per-output universe (1–${MAX_UNIVERSE}). The device streams one ` +
    'contiguous layout from the first enabled output; a universe it cannot honor is flagged, ' +
    'not overridden.';
  uniInp.onchange = () => {
    const next = parseInt(uniInp.value, 10);
    if (!Number.isInteger(next) || next < 1 || next > MAX_UNIVERSE) {
      showToast(`Universe must be 1–${MAX_UNIVERSE}`, { error: true, ttl: 5000 });
      uniInp.value = port.universe;
      return;
    }
    if (next === port.universe) return;
    mutate(null, () => {
      port.universe = next;
      // Manual universes move the allocation high-water mark so a later addPort
      // never hands this universe out again.
      noteUniverseUsed(registry(), next);
    });
  };
  head.appendChild(uniInp);

  const strandsLbl = document.createElement('span');
  strandsLbl.className = 'cm-port-label cm-port-strandcount';
  strandsLbl.textContent = ` · ${strandCount} strand(s)`;
  head.appendChild(strandsLbl);

  const delBtn = document.createElement('button');
  delBtn.className = 'cm-btn cm-danger';
  delBtn.textContent = '🗑';
  delBtn.title = 'Delete port';
  delBtn.onclick = () => {
    const doDelete = () => mutate(`Deleted ${controller.name} · Port ${port.port}`, () => {
      removePort(registry(), controller, port);
    });
    if (strandCount > 0) {
      showCustomConfirm({
        title: 'Delete Port',
        text: `Delete ${controller.name} · Port ${port.port}? ` +
          `${strandCount} strand(s) return to Unmapped.`,
        onConfirm: doDelete,
      });
    } else {
      doDelete();
    }
  };
  head.appendChild(delBtn);
  row.appendChild(head);

  for (const v of violationsFor(proj.violations, controller, port)) {
    const chip = document.createElement('span');
    chip.className = 'cm-error-chip';
    chip.textContent = v.message;
    row.appendChild(chip);
  }
  // Manual per-output universe warnings for THIS output (unhonorable / duplicate)
  // — loud but non-blocking (Slice D).
  for (const w of ledWarningsFor(controller.id, port.port)) {
    const chip = document.createElement('span');
    chip.className = 'cm-warn-chip';
    chip.textContent = w.message;
    row.appendChild(chip);
  }

  if (!portCollapsed) {
    // Per-strand address preview. A DEVICE-BOUND controller renders with the
    // firmware's contiguous linear layout (led_patch_projection) so the chips
    // agree with the hardware; an unbound controller uses the sim's generic
    // per-port projection (computeLedProjection).
    const bound = isBoundLedController(controller);
    const ledProj = bound
      ? computeLedStrandPatches(registry(), strandLedCounts()).fields
      : computeLedProjection(registry(), strandLedCounts()).fields;
    const chain = document.createElement('div');
    chain.className = 'cm-chain';
    for (const entry of port.chain) {
      const name = entryFixtureName(entry);
      if (name === null) continue;
      const chip = document.createElement('span');
      chip.className = 'cm-chip cm-chip-strand';
      const p = ledProj.get(name);
      const info = strandSegmentsFor(p);
      // Multi-universe strands render the full span (U6:1 → U7:288); a strand
      // inside one universe keeps the U6:1–160 form (G5).
      const addr = info ? ` ${ledStrandSpanText(info.segments)} ×${info.px}px` : ' (unresolved)';
      chip.textContent = `💡 ${name}${addr}`;
      if (info) chip.title = ledStrandSpanTooltip(info.segments);
      const unbind = document.createElement('button');
      unbind.className = 'cm-chip-x';
      unbind.textContent = '×';
      unbind.title = `Unbind '${name}'`;
      unbind.onclick = () => mutate(null, () => { unmapFixture(registry(), name); });
      chip.appendChild(unbind);
      chain.appendChild(chip);
    }
    if (strandCount === 0) {
      const empty = document.createElement('span');
      empty.className = 'cm-chain-empty';
      empty.textContent = '(no strands)';
      chain.appendChild(empty);
    }
    row.appendChild(chain);

    // Read-only derived-layout line (plan P3): the per-output span for THIS
    // output from deriveLayoutPreview's per-output walker, live-updating with
    // chain edits.
    const preview = deriveLayoutPreview(controller, strandLedCounts());
    const derivedLine = document.createElement('div');
    derivedLine.className = 'cm-led-derived';
    const out = preview.perOutput.get(port.port - 1);
    if (preview.error) {
      derivedLine.classList.add('cm-led-derived-warn');
      derivedLine.textContent = `⌁ output ${port.port}: ${preview.error}`;
    } else if (out && out.enabled) {
      const span = out.endUniverse === out.universe
        ? `U${out.universe} ch ${out.startChannel}–${out.endChannel}`
        : `U${out.universe} ch ${out.startChannel} → U${out.endUniverse} ch ${out.endChannel}`;
      derivedLine.textContent = `⌁ output ${port.port}: ${span} · ${out.pixelCount}px`;
    } else {
      derivedLine.textContent = `⌁ output ${port.port}: disabled (no strands)`;
    }
    row.appendChild(derivedLine);

    const addBtn = document.createElement('button');
    addBtn.className = 'cm-btn cm-add-strand';
    addBtn.textContent = isPicking ? '✓ picking strands…' : '+ add strands';
    addBtn.onclick = () => {
      pickTarget = isPicking ? null : { controllerId: controller.id, portNum: port.port };
      renderIfOpen();
    };
    row.appendChild(addBtn);
  }
  return row;
}

// ── Port row ────────────────────────────────────────────────────────────

function renderPort(controller, port, proj) {
  const row = document.createElement('div');
  row.className = 'cm-port';
  const isEffectsPort = port.universe === EFFECTS_UNIVERSE;
  const isPicking = pickTarget &&
    pickTarget.controllerId === controller.id && pickTarget.portNum === port.port;
  if (isPicking) row.classList.add('cm-port-picking');

  const layout = proj.portLayouts.get(`${controller.id}:${port.port}`) || [];

  const head = document.createElement('div');
  head.className = 'cm-port-head';

  const portKey = `${controller.id}:${port.port}`;
  const portCollapsed = collapsedPorts.has(portKey);
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'cm-toggle';
  toggleBtn.textContent = portCollapsed ? '▸' : '▾';
  toggleBtn.title = portCollapsed ? 'Expand port' : 'Collapse port';
  toggleBtn.onclick = () => {
    if (portCollapsed) collapsedPorts.delete(portKey);
    else collapsedPorts.add(portKey);
    renderIfOpen();
  };
  head.appendChild(toggleBtn);

  const label = document.createElement('span');
  label.className = 'cm-port-label' + (isEffectsPort ? ' cm-effects' : '');
  label.textContent = `P${port.port} · U`;
  head.appendChild(label);

  const uniInp = document.createElement('input');
  uniInp.className = 'cm-input cm-num';
  uniInp.type = 'number';
  uniInp.min = '1';
  uniInp.max = String(MAX_UNIVERSE);
  uniInp.value = port.universe;
  uniInp.title = `Universe (${EFFECTS_UNIVERSE} = effects only, max ${MAX_UNIVERSE})`;
  uniInp.onchange = () => {
    const next = parseInt(uniInp.value, 10);
    if (!Number.isInteger(next) || next < 1 || next > MAX_UNIVERSE) {
      showToast(`Universe must be 1–${MAX_UNIVERSE}`, { error: true, ttl: 5000 });
      uniInp.value = port.universe;
      return;
    }
    if (next === port.universe) return;
    const moved = port.chain.filter(e => entryFixtureName(e) !== null).length;
    mutate(null, () => {
      port.universe = next;
      // Manually typed universes move the allocation high-water mark —
      // a later addPort must never hand this universe out again.
      noteUniverseUsed(registry(), next);
    });
    if (moved > 0) {
      showToast(`${moved} fixture(s) moved to U${next} keeping their addresses — ` +
        'red = conflict there; retype or clear an address box to fix.', { ttl: 8000 });
    }
  };
  head.appendChild(uniInp);

  if (isEffectsPort) {
    const fx = document.createElement('span');
    fx.textContent = '✨';
    fx.title = `Universe ${EFFECTS_UNIVERSE} is reserved for effects — pinned addresses only`;
    head.appendChild(fx);
  }

  // FULL universe map bar (operator request 2026-06-12): every claim
  // on this port's universe across ALL ports and controllers, placed
  // where it lives in 1–512. This port's own claims render bright,
  // siblings' dimmed, conflicts red — fragmentation (holes from
  // removals) is visible at a glance, and that visibility is the
  // compaction signal (compaction itself is a deliberate operator
  // action; Notion backlog card).
  const bar = document.createElement('div');
  bar.className = 'cm-occupancy';
  const claims = proj.universeMaps.get(port.universe) || [];
  let portUsed = 0;
  let universeUsed = 0;
  let anyInvalid = layout.some(i => !i.valid);
  for (const c of claims) {
    const width = c.end - c.start + 1;
    universeUsed += width;
    const own = c.controllerId === controller.id && c.portNum === port.port;
    if (own) portUsed += width;
    const seg = document.createElement('div');
    seg.className = 'cm-occ-seg' +
      (c.name === null ? ' cm-occ-gap' : '') +
      (own ? '' : ' cm-occ-other') +
      (c.item.conflict ? ' cm-occ-conflict' : '');
    const left = Math.min(100, ((c.start - 1) / DMX_UNIVERSE_SIZE) * 100);
    const segWidth = Math.min(100 - left, (width / DMX_UNIVERSE_SIZE) * 100);
    seg.style.left = `${left}%`;
    seg.style.width = `${Math.max(segWidth, 0.6)}%`;
    seg.title = `${c.name || `${width}-ch gap`} @ ${c.start}–${c.end} ` +
      `(${c.controllerName} P${c.portNum})` + (c.item.conflict ? ' ⚠ CONFLICT' : '');
    bar.appendChild(seg);
  }
  // LED occupancy (G5): any LED strand streaming into THIS universe renders as
  // a distinct-tint claim so the operator SEES a DMX port sharing a universe
  // with an LED stream (the led_universe_collision warnings stay the loud path;
  // DMX allocation math is unchanged — S4 warn-never-block).
  for (const c of lastLedClaims.get(port.universe) || []) {
    const width = c.end - c.start + 1;
    const seg = document.createElement('div');
    seg.className = 'cm-occ-seg cm-occ-led';
    const left = Math.min(100, ((c.start - 1) / DMX_UNIVERSE_SIZE) * 100);
    const segWidth = Math.min(100 - left, (width / DMX_UNIVERSE_SIZE) * 100);
    seg.style.left = `${left}%`;
    seg.style.width = `${Math.max(segWidth, 0.6)}%`;
    seg.title = `💡 ${c.name} @ ${c.start}–${c.end} (LED controller ${c.controllerId}` +
      `${c.portNum ? ` P${c.portNum}` : ''})`;
    bar.appendChild(seg);
  }
  head.appendChild(bar);

  const count = document.createElement('span');
  count.className = 'cm-occ-count' + (anyInvalid ? ' cm-occ-over' : '');
  count.textContent = `${portUsed}·U${port.universe}:${universeUsed}/${DMX_UNIVERSE_SIZE}`;
  count.title = `${portUsed} ch on this port · ${universeUsed}/${DMX_UNIVERSE_SIZE} used ` +
    `on U${port.universe} across all ports`;
  head.appendChild(count);

  const delBtn = document.createElement('button');
  delBtn.className = 'cm-btn cm-danger';
  delBtn.textContent = '🗑';
  delBtn.title = 'Delete port';
  delBtn.onclick = () => {
    const mappedCount = port.chain.filter(e => entryFixtureName(e) !== null).length;
    const doDelete = () => {
      mutate(`Deleted ${controller.name} · Port ${port.port}`, () => {
        removePort(registry(), controller, port);
      });
    };
    if (mappedCount > 0) {
      showCustomConfirm({
        title: 'Delete Port',
        text: `Delete ${controller.name} · Port ${port.port} (U${port.universe})? ` +
          `${mappedCount} mapped fixture(s) return to Unmapped and project unpatched.`,
        onConfirm: doDelete,
      });
    } else {
      doDelete();
    }
  };
  head.appendChild(delBtn);
  row.appendChild(head);

  for (const v of violationsFor(proj.violations, controller, port)) {
    const chip = document.createElement('span');
    chip.className = 'cm-error-chip';
    chip.textContent = v.message;
    row.appendChild(chip);
  }

  if (!collapsedPorts.has(`${controller.id}:${port.port}`)) {
    row.appendChild(renderChain(controller, port, layout));
    row.appendChild(renderPortActions(controller, port, layout, isEffectsPort, isPicking));
  }
  return row;
}

// ── Chain chips ─────────────────────────────────────────────────────────

function renderChain(controller, port, layout) {
  const chain = document.createElement('div');
  chain.className = 'cm-chain';

  layout.forEach((item, index) => {
    const chip = document.createElement('span');
    chip.className = 'cm-chip';

    if (isGapEntry(item.entry)) {
      chip.classList.add('cm-chip-gap');
      if (!item.valid) chip.classList.add('cm-chip-invalid');
      const gapAddr = document.createElement('input');
      gapAddr.className = 'cm-chip-addr cm-chip-addr-input';
      if (item.conflict) gapAddr.classList.add('cm-chip-addr-conflict');
      gapAddr.type = 'number';
      gapAddr.min = '1';
      gapAddr.max = String(DMX_UNIVERSE_SIZE);
      gapAddr.value = Number.isInteger(item.entry.at) ? String(item.entry.at) : '';
      gapAddr.placeholder = '✗';
      gapAddr.title = `Reservation start address — type to move the gap` +
        (item.conflict ? ' ⚠ CONFLICTS with other channels' : '');
      gapAddr.onclick = (e) => e.stopPropagation();
      gapAddr.ondragstart = (e) => { e.preventDefault(); e.stopPropagation(); };
      gapAddr.onchange = (e) => {
        e.stopPropagation();
        const next = parseInt(gapAddr.value, 10);
        if (!Number.isInteger(next) || next < 1 || next > DMX_UNIVERSE_SIZE) {
          showToast(`Address must be 1–${DMX_UNIVERSE_SIZE}`, { error: true, ttl: 5000 });
          renderIfOpen();
          return;
        }
        mutate(null, () => { item.entry.at = next; });
      };
      chip.appendChild(gapAddr);
      chip.appendChild(document.createTextNode(`⌷ gap ${item.entry.gap}`));
      chip.title = `Reserved ${item.entry.gap} channel(s) at ${item.address} — click to edit width`;
      chip.onclick = () => {
        const next = parseInt(window.prompt(`Gap width (channels):`, item.entry.gap), 10);
        if (Number.isInteger(next) && next >= 1) {
          mutate(null, () => { item.entry.gap = next; });
        }
      };
    } else if (isPinnedEntry(item.entry) && !item.manual) {
      chip.classList.add('cm-chip-pinned');
      if (!item.valid) chip.classList.add('cm-chip-invalid');
      const addr = document.createElement('span');
      addr.className = 'cm-chip-addr';
      addr.textContent = `📌U${item.pinUniverse || EFFECTS_UNIVERSE}:${item.entry.at}`;
      chip.appendChild(addr);
      chip.appendChild(document.createTextNode(item.name));
      chip.title = `${item.name} — cabled to this port, auto-patched at ` +
        `U${item.pinUniverse || EFFECTS_UNIVERSE}:${item.entry.at} (config.yaml global_effects)`;
    } else {
      // Fixture chip: the address box IS the address (allocation
      // model, docs/33 decision 19) — auto-assigned at add time, type
      // ANY address to move it (conflicts paint red but always stand),
      // clear the box to re-allocate at the universe end.
      if (!item.valid) chip.classList.add('cm-chip-invalid');
      const addrInp = document.createElement('input');
      addrInp.className = 'cm-chip-addr cm-chip-addr-input';
      if (item.conflict) addrInp.classList.add('cm-chip-addr-conflict');
      addrInp.type = 'number';
      addrInp.min = '1';
      addrInp.max = String(DMX_UNIVERSE_SIZE);
      addrInp.value = Number.isInteger(item.entry.at) ? String(item.entry.at) : '';
      addrInp.placeholder = '✗';
      addrInp.title = `${item.name} — U${port.universe}:${item.entry.at} (${item.footprint} ch)` +
        (item.conflict ? ' ⚠ CONFLICTS with other channels (kept — explicit addresses stand)' : '') +
        '. Type ANY address to move it; clear the box to send it to the end of the universe.';
      addrInp.onclick = (e) => e.stopPropagation();
      addrInp.ondragstart = (e) => { e.preventDefault(); e.stopPropagation(); };
      addrInp.onchange = (e) => {
        e.stopPropagation();
        setManualAddress(port, index, parseInt(addrInp.value, 10), item);
      };
      chip.appendChild(addrInp);
      chip.appendChild(document.createTextNode(item.name));
      chip.title = item.valid
        ? `${item.name} — U${port.universe}:${item.entry.at} (${item.footprint} ch). ` +
          'Click to select in 3D, drag to move between ports (the address travels with it).'
        : `${item.name} — projects UNPATCHED (see violations)`;
    }

    const name = item.name;
    if (name !== null) {
      const index3d = fixtureIndexByName(name);
      if (index3d >= 0 && selectedFixtureIndices.has(index3d)) {
        chip.classList.add('cm-chip-selected');
      }
      chip.onclick = () => selectFixtureIn3D(name);
      chip.onmouseenter = () => flashFixture(name, true);
      chip.onmouseleave = () => flashFixture(name, false);
    }

    // Unmap / remove ✕
    const x = document.createElement('span');
    x.className = 'cm-chip-x';
    x.textContent = '✕';
    x.title = name !== null ? `Unmap ${name}` : 'Remove gap';
    x.onclick = (e) => {
      e.stopPropagation();
      mutate(name !== null ? `Unmapped '${name}'` : 'Removed gap', () => {
        port.chain.splice(index, 1);
      });
    };
    chip.appendChild(x);

    // Drag to reorder (within a chain) and move (across ports).
    chip.draggable = true;
    chip.ondragstart = (e) => {
      e.dataTransfer.setData('text/plain',
        JSON.stringify({ controllerId: controller.id, portNum: port.port, index }));
      e.dataTransfer.effectAllowed = 'move';
    };
    chip.ondragover = (e) => {
      e.preventDefault();
      chip.classList.add('cm-drag-over');
    };
    chip.ondragleave = () => chip.classList.remove('cm-drag-over');
    chip.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      chip.classList.remove('cm-drag-over');
      handleChipDrop(e, controller, port, index);
    };

    chain.appendChild(chip);
  });

  // Dropping on the chain background appends at the end.
  chain.ondragover = (e) => e.preventDefault();
  chain.ondrop = (e) => {
    e.preventDefault();
    handleChipDrop(e, controller, port, port.chain.length);
  };

  return chain;
}

/**
 * Manual address entry — the operator's ultimate savior (docs/33
 * decisions 18/19). Every fixture entry already carries its absolute
 * address; typing ANY value moves it there (conflicts paint red but
 * always stand). Clearing the box re-allocates it at the end of the
 * universe — the "just put it somewhere clean" gesture.
 */
function setManualAddress(port, index, target, item) {
  const entry = port.chain[index];

  if (Number.isNaN(target)) {
    const allocate = makeAllocator(port.universe);
    const at = allocate(item.footprint);
    if (at === null) {
      showToast(`U${port.universe} has no room at the end for '${item.name}' ` +
        `(${item.footprint} ch) — type an address into a hole instead`, { error: true, ttl: 8000 });
      renderIfOpen();
      return;
    }
    mutate(`'${item.name}' sent to the end of U${port.universe} — ch ${at}`, () => {
      entry.at = at;
    });
    return;
  }
  if (!Number.isInteger(target) || target < 1 || target > DMX_UNIVERSE_SIZE) {
    showToast(`Address must be 1–${DMX_UNIVERSE_SIZE}`, { error: true, ttl: 5000 });
    renderIfOpen();
    return;
  }
  if (target === entry.at) return;
  mutate(`'${item.name}' moved to ch ${target}`, () => { entry.at = target; });
}

function handleChipDrop(event, targetController, targetPort, targetIndex) {
  let src;
  try {
    src = JSON.parse(event.dataTransfer.getData('text/plain'));
  } catch (_) {
    return;
  }
  const reg = registry();
  const srcController = reg.controllers.find(c => c.id === src.controllerId);
  const srcPort = srcController && srcController.ports.find(p => p.port === src.portNum);
  if (!srcPort || !Number.isInteger(src.index) ||
      src.index < 0 || src.index >= srcPort.chain.length) return;

  mutate(srcPort === targetPort ? 'Reordered chain' :
    `Moved to ${targetController.name} · Port ${targetPort.port}`, () => {
    const [entry] = srcPort.chain.splice(src.index, 1);
    let insertAt = targetIndex;
    if (srcPort === targetPort && src.index < targetIndex) insertAt -= 1;
    targetPort.chain.splice(Math.min(insertAt, targetPort.chain.length), 0, entry);
  });
}

// ── Port action buttons ─────────────────────────────────────────────────

function renderPortActions(controller, port, layout, isEffectsPort, isPicking) {
  const actions = document.createElement('div');
  actions.className = 'cm-port-actions';

  if (!isEffectsPort) {
    const names = selectedFixtureNames();
    const fromSelBtn = document.createElement('button');
    fromSelBtn.className = 'cm-btn';
    fromSelBtn.textContent = `+ sel (${names.length})`;
    fromSelBtn.title = 'Append the 3D selection to this chain, in selection order';
    fromSelBtn.disabled = names.length === 0;
    fromSelBtn.onclick = () => addNamesToPort(controller, port, names);
    actions.appendChild(fromSelBtn);
  }

  const fromListBtn = document.createElement('button');
  fromListBtn.className = 'cm-btn';
  fromListBtn.textContent = isPicking ? '✓ done' : '+ list';
  fromListBtn.title = isPicking ? 'Exit pick mode (Esc)' :
    'Pick mode: click unmapped fixtures below, one per click, in chain order';
  fromListBtn.onclick = () => {
    pickTarget = isPicking ? null : { controllerId: controller.id, portNum: port.port };
    renderIfOpen();
  };
  actions.appendChild(fromListBtn);

  if (!isEffectsPort) {
    const gapBtn = document.createElement('button');
    gapBtn.className = 'cm-btn';
    gapBtn.textContent = '+ gap';
    gapBtn.title = 'Reserve channels for hardware not modeled in the sim (allocated at the ' +
      'universe end; type its address box to move it)';
    gapBtn.onclick = () => {
      const width = parseInt(window.prompt('Gap width (channels):', '10'), 10);
      if (!Number.isInteger(width) || width < 1) return;
      const allocate = makeAllocator(port.universe);
      const at = allocate(width);
      if (at === null) {
        showToast(`U${port.universe} has no room at the end for a ${width}-ch gap`, { error: true, ttl: 6000 });
        return;
      }
      mutate(null, () => { port.chain.push({ gap: width, at }); });
    };
    actions.appendChild(gapBtn);
  } else {
    const fxBtn = document.createElement('button');
    fxBtn.className = 'cm-btn';
    fxBtn.textContent = '+ effects';
    fxBtn.title = 'Pin all unmapped effect fixtures at their config.yaml addresses';
    fxBtn.onclick = () => {
      const mapped = mappedFixtures(registry());
      const pinTable = pins();
      const toPin = allConfigs().filter(c => !mapped.has(c.name) &&
        isGlobalEffect(c.fixtureType || c.type || ''));
      if (toPin.length === 0) {
        showToast('No unmapped effect fixtures', { error: true, ttl: 4000 });
        return;
      }
      mutate(null, () => {
        for (const config of toPin) {
          const pin = pinTable[config.fixtureType || config.type];
          // No pin in config.yaml → still add; projection flags it
          // loudly (no_pin) instead of silently skipping.
          port.chain.push({ fixture: config.name, at: pin ? pin.address : 0 });
        }
      });
    };
    actions.appendChild(fxBtn);
  }

  return actions;
}

// NOTE: there is deliberately NO group-level add on a port — on the
// real rig a single group spans 6–15 controllers (operator decision,
// 2026-06-11). Mapping is strictly per-fixture; groups exist in the
// tray only as a filter.

function addNamesToPort(controller, port, names) {
  const snapshot = snapshotRegistry();

  // ── Strict type gating (Round 2 R2) ─────────────────────────────────
  // An LED controller accepts ONLY LED strands; a DMX controller accepts
  // ONLY DMX fixtures — across EVERY add path (+ sel / + list / + add
  // strands). A name whose kind doesn't match the target is refused
  // loudly and never mapped (codex P0 — no silent cross-type mis-map).
  const accepted = [];
  const wrongType = [];
  for (const name of names) {
    if (controllerAcceptsKind(controller, nameKind(name))) accepted.push(name);
    else wrongType.push(name);
  }
  const wrongTypeMsg = wrongType.length > 0
    ? `Refused ${wrongType.length} (${controllerFixtureKind(controller) === 'strand'
      ? 'not an LED strand' : 'not a DMX fixture'}): ${wrongType.join(', ')}`
    : null;

  // ── LED controllers: bind strands (no DMX address allocation) ───────
  // LED strands are addressed sequentially by the LED projection at
  // export time (computeLedProjection), so the chain only records WHICH
  // strands hang off this port and in what order. A strand already mapped
  // anywhere is rejected loudly, never silently moved (codex P0).
  if (isLedController(controller)) {
    const mappedLed = mappedFixtures(registry());
    const addedLed = [];
    const rejectedLed = [];
    for (const name of accepted) {
      const hit = mappedLed.get(name);
      if (hit) {
        rejectedLed.push({ name, where: `${hit.controller.name} · Port ${hit.port.port}` });
        continue;
      }
      port.chain.push(name);
      mappedLed.set(name, { controller, port });
      addedLed.push(name);
    }
    recomputeAndMark();
    renderIfOpen();
    const parts = [];
    if (wrongTypeMsg) parts.push(wrongTypeMsg);
    if (rejectedLed.length > 0) {
      parts.push(`already mapped: ${rejectedLed.map(r => `${r.name} → ${r.where}`).join(', ')}`);
    }
    if (parts.length > 0) {
      showToast(parts.join(' · '), { error: true, undoSnapshot: addedLed.length > 0 ? snapshot : null });
    } else if (addedLed.length > 0) {
      showToast(`Bound ${addedLed.length} strand(s) to ${controller.name} · Port ${port.port}`,
        { undoSnapshot: snapshot });
    }
    return;
  }

  const byName = configsByName();
  const pinTable = pins();
  const mapped = mappedFixtures(registry());
  const allocate = makeAllocator(port.universe);
  const added = [];
  const rejected = [];
  for (const name of accepted) {
    const hit = mapped.get(name);
    if (hit) {
      rejected.push({ name, where: `${hit.controller.name} · Port ${hit.port.port}` });
      continue;
    }
    const config = byName.get(name);
    const fixtureType = (config && (config.fixtureType || config.type)) || '';
    if (isGlobalEffect(fixtureType)) {
      // Auto-patch: effects enter any port as PINNED entries at their
      // config.yaml address (a missing pin pins at 0 and is flagged
      // loudly by the projection — never silently skipped).
      const pin = pinTable[fixtureType];
      port.chain.push({ fixture: name, at: pin ? pin.address : 0 });
    } else {
      // Allocation model (decision 19): the address is assigned NOW,
      // one past the end of the universe's occupancy across ALL ports
      // and controllers, and sticky from here on.
      const footprint = config ? getFootprint(config) : 0;
      const at = allocate(footprint);
      if (at === null) {
        rejected.push({ name, where: `U${port.universe} full at the end (${footprint} ch needed)` });
        continue;
      }
      port.chain.push({ fixture: name, at });
    }
    mapped.set(name, { controller, port });
    added.push(name);
  }
  recomputeAndMark();
  renderIfOpen();
  const parts = [];
  if (wrongTypeMsg) parts.push(wrongTypeMsg);
  if (rejected.length > 0) {
    // Loud per docs/33: name them and where they live — never silently
    // skipped, never silently moved.
    parts.push(`already mapped: ${rejected.map(r => `${r.name} → ${r.where}`).join(', ')}`);
  }
  if (parts.length > 0) {
    showToast(parts.join(' · '), { error: true, undoSnapshot: added.length > 0 ? snapshot : null });
  } else if (added.length > 0) {
    showToast(`Added ${added.length} to ${controller.name} · Port ${port.port}`,
      { undoSnapshot: snapshot });
  }
}

// ── TEST patch tools (whole-rig quick patch / wipe) ─────────────────────

/**
 * Test Auto-Patch: snapshot → patch EVERYTHING via the registry helper →
 * reproject → save. Loud toast naming what it created and how much it
 * patched. Any failure (a fixture that can't be patched) THROWS out of
 * testAutoPatch and surfaces as a loud error toast — never a silent
 * partial patch (codex P0).
 */
function runTestAutoPatch() {
  const snapshot = snapshotRegistry();
  let result;
  try {
    result = testAutoPatch(registry(), configsByName(), strandLedCounts(), pins());
  } catch (err) {
    console.error('[Controllers] Test Auto-Patch failed:', err);
    showToast(`Test Auto-Patch failed: ${err.message}`, { error: true, ttl: 12000 });
    return;
  }
  recomputeAndMark();
  renderIfOpen();
  if (result.created.length > 0) {
    console.warn('[Controllers] Test Auto-Patch created:', result.created.join(' · '));
  }
  const parts = [];
  if (result.dmxPatched > 0) parts.push(`${result.dmxPatched} DMX`);
  if (result.effectsPatched > 0) parts.push(`${result.effectsPatched} effect(s)`);
  if (result.strandsPatched > 0) parts.push(`${result.strandsPatched} strand(s)`);
  const createdMsg = result.created.length > 0
    ? ` · created ${result.created.join(', ')}` : '';
  const total = result.dmxPatched + result.effectsPatched + result.strandsPatched;
  if (total === 0) {
    showToast('Test Auto-Patch: nothing to patch (every fixture already mapped)',
      { undoSnapshot: snapshot, ttl: 8000 });
    return;
  }
  showToast(`⚡ Test Auto-Patch: ${parts.join(' + ')} across U${result.universesUsed.join(',U')}` +
    `${createdMsg}`, { undoSnapshot: snapshot, ttl: 12000 });
}

/**
 * Clear All Patches: snapshot → wipe every chain entry via the registry
 * helper → reproject → save. Loud confirmation of how many bindings were
 * cleared. After this the rig is fully unpatched (the loud unpatched
 * markers apply); controllers and ports remain.
 */
function runClearAllPatches() {
  const totalMapped = mappedFixtures(registry()).size;
  if (totalMapped === 0) {
    showToast('Clear All Patches: nothing is patched', { error: true, ttl: 5000 });
    return;
  }
  const doClear = () => {
    const snapshot = snapshotRegistry();
    const { entriesCleared, freed } = clearAllPatches(registry());
    console.warn(`[Controllers] Clear All Patches: removed ${entriesCleared} chain entry(ies); ` +
      `${freed.length} fixture(s)/strand(s) returned to Unmapped:`, freed);
    recomputeAndMark();
    renderIfOpen();
    showToast(`🧹 Cleared ${entriesCleared} patch(es) — ${freed.length} fixture(s) now unpatched`,
      { undoSnapshot: snapshot, ttl: 12000 });
  };
  showCustomConfirm({
    title: 'Clear All Patches',
    text: `Remove ALL patch assignments? ${totalMapped} mapped fixture(s)/strand(s) return to ` +
      'Unmapped and project unpatched. Controllers and ports are kept.',
    onConfirm: doClear,
  });
}

// ── Unmapped tray ───────────────────────────────────────────────────────

function renderTray(unmapped, unmappedStrands, proj) {
  // Resolve (and possibly invalidate) the pick target BEFORE the
  // picking style is derived — a dangling target must not leave the
  // tray rendered in pick mode for one frame.
  const reg = registry();
  let pickController = null;
  let pickPort = null;
  if (pickTarget) {
    pickController = reg.controllers.find(c => c.id === pickTarget.controllerId) || null;
    pickPort = pickController &&
      (pickController.ports.find(p => p.port === pickTarget.portNum) || null);
    if (!pickPort) pickTarget = null;
  }

  const tray = document.createElement('div');
  tray.className = 'cm-tray' + (pickTarget ? ' cm-tray-picking' : '');

  const head = document.createElement('div');
  head.className = 'cm-tray-head';
  const title = document.createElement('span');
  title.className = 'cm-tray-title';
  const pickingLed = pickController && isLedController(pickController);
  if (pickPort && pickingLed) {
    // LED controllers patch strands via sequential pixel addressing; the
    // tray shows unmapped STRANDS, not DMX fixtures.
    title.textContent = `adding strands to ${pickController.name} · Port ${pickPort.port}`;
  } else if (pickPort) {
    // Live allocator preview: the next add lands one past the end of
    // the universe's occupancy (all ports, all controllers).
    const nextCh = (proj.universeEnds.get(pickPort.universe) || 0) + 1;
    title.textContent = `adding to ${pickController.name} · Port ${pickPort.port} ` +
      `(U${pickPort.universe}) — next: ch ${nextCh}`;
  } else {
    // Default (non-picking) view lists BOTH unmapped DMX fixtures and unmapped
    // LED strands (Round 2 R1) — a strand must never be invisible just because
    // no LED controller exists yet.
    title.textContent = unmappedStrands.length > 0
      ? `Unmapped — ${unmapped.length} fixture(s), ${unmappedStrands.length} strand(s)`
      : `Unmapped fixtures (${unmapped.length})`;
  }
  head.appendChild(title);

  const filter = document.createElement('input');
  filter.className = 'cm-input';
  filter.style.width = '90px';
  filter.placeholder = 'filter…';
  filter.value = trayFilter;
  filter.oninput = () => {
    trayFilter = filter.value;
    renderChips();
  };
  head.appendChild(filter);

  if (pickPort) {
    const exit = document.createElement('button');
    exit.className = 'cm-btn';
    exit.textContent = 'Esc';
    exit.title = 'Exit pick mode';
    exit.onclick = () => {
      pickTarget = null;
      renderIfOpen();
    };
    head.appendChild(exit);
  }
  tray.appendChild(head);

  const chips = document.createElement('div');
  chips.className = 'cm-tray-chips';
  tray.appendChild(chips);

  const pickingEffects = pickPort && pickPort.universe === EFFECTS_UNIVERSE;
  const byName = configsByName();

  function renderChips() {
    chips.replaceChildren();
    const needle = trayFilter.trim().toLowerCase();
    let shown = 0;

    // When picking onto an LED controller the tray lists STRANDS; the
    // default (and DMX picking) lists fixtures. The chain-entry namespace
    // is shared, so a strand and fixture can each be mapped at most once.
    const ledTray = pickPort && pickingLed;
    const names = ledTray ? unmappedStrandNames() : unmappedNames();

    for (const name of names) {
      if (ledTray) {
        if (needle && !name.toLowerCase().includes(needle)) continue;
        const chip = document.createElement('span');
        chip.className = 'cm-tray-chip cm-tray-strand';
        chip.textContent = '💡 ' + name;
        chip.title = `Click to bind strand '${name}' to ${pickController.name} · Port ${pickPort.port}`;
        chip.onclick = () => addNamesToPort(pickController, pickPort, [name]);
        chips.appendChild(chip);
        shown++;
        continue;
      }

      const config = byName.get(name);
      const isEffect = isGlobalEffect((config && (config.fixtureType || config.type)) || '');
      // Effects are assignable to ANY port (they record the physical
      // cabling and auto-pin at their config.yaml address). The only
      // pick-mode filter left: an effects-universe port takes effects
      // only — non-effects can never live on U1.
      if (pickPort && pickingEffects && !isEffect) continue;
      if (needle &&
          !name.toLowerCase().includes(needle) &&
          !String((config && config.group) || '').toLowerCase().includes(needle)) continue;

      const chip = document.createElement('span');
      chip.className = 'cm-tray-chip';
      chip.textContent = (isEffect ? '✨ ' : '▪ ') + name;
      chip.title = pickPort
        ? `Click to append to ${pickController.name} · Port ${pickPort.port}` +
          (isEffect ? ' (pins automatically on the effects universe)' : '')
        : `${name}${config && config.group ? ` (${config.group})` : ''} — click to locate in 3D`;
      chip.onmouseenter = () => flashFixture(name, true);
      chip.onmouseleave = () => flashFixture(name, false);
      chip.onclick = () => {
        if (pickPort) {
          flashFixture(name, false);
          selectFixtureIn3D(name);
          addNamesToPort(pickController, pickPort, [name]);
        } else {
          selectFixtureIn3D(name);
        }
      };
      chips.appendChild(chip);
      shown++;
    }

    // Default view: also list unmapped LED strands (💡) so they are visible
    // even with no LED controller present (Round 2 R1). Strands are not in the
    // 3D fixture list, so these chips are informational (no locate); picking a
    // strand onto an output happens through an LED controller's port.
    if (!pickPort) {
      for (const name of unmappedStrands) {
        if (needle && !name.toLowerCase().includes(needle)) continue;
        const chip = document.createElement('span');
        chip.className = 'cm-tray-chip cm-tray-strand';
        chip.textContent = '💡 ' + name;
        chip.title = `Unmapped LED strand '${name}' — add/select a ${LED_TYPE_LABEL} controller, ` +
          'then pick this strand onto one of its outputs.';
        chips.appendChild(chip);
        shown++;
      }
    }

    if (shown === 0) {
      const done = document.createElement('div');
      done.className = 'cm-fully-patched';
      const bothEmpty = unmapped.length === 0 && unmappedStrands.length === 0;
      done.textContent = (pickPort && pickingLed)
        ? (unmappedStrandNames().length === 0 ? '✓ every strand is mapped' : '(no matches)')
        : (bothEmpty ? '✓ every fixture & strand is mapped' : '(no matches)');
      chips.appendChild(done);
    }
  }
  renderChips();

  return tray;
}

// ── Add-controller modal (name + IP in one dialog) ──────────────────────

function showAddControllerModal() {
  const overlay = document.createElement('div');
  overlay.className = 'vm-modal-overlay';
  const card = document.createElement('div');
  card.className = 'vm-modal-card';

  const titleEl = document.createElement('div');
  titleEl.className = 'vm-modal-title';
  titleEl.textContent = 'Add Controller (creates 4 ports, next free universes)';
  card.appendChild(titleEl);

  const nameInput = document.createElement('input');
  nameInput.className = 'vm-modal-input';
  nameInput.placeholder = 'Name — e.g. Bow PKnight';
  card.appendChild(nameInput);

  const ipInput = document.createElement('input');
  ipInput.className = 'vm-modal-input';
  ipInput.placeholder = 'IP — e.g. 10.1.1.10';
  card.appendChild(ipInput);

  // Controller type — same menu, two types (operator requirement). New
  // LED controllers default their config to RGBW/native.
  const typeSel = document.createElement('select');
  typeSel.className = 'vm-modal-input';
  for (const [val, lbl] of [[CONTROLLER_TYPE_DMX, 'DMX (fixtures)'],
    [CONTROLLER_TYPE_LED, `${LED_TYPE_LABEL} (LED strands)`]]) {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = lbl;
    typeSel.appendChild(opt);
  }
  card.appendChild(typeSel);

  const actions = document.createElement('div');
  actions.className = 'vm-modal-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'vm-modal-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => overlay.remove();
  const okBtn = document.createElement('button');
  okBtn.className = 'vm-modal-btn vm-modal-btn-primary';
  okBtn.textContent = 'Add';
  okBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (name.length === 0) {
      nameInput.focus();
      return;
    }
    overlay.remove();
    mutate(null, () => {
      addController(registry(), { name, ip: ipInput.value.trim(), type: typeSel.value });
    });
  };
  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  nameInput.focus();

  overlay.onkeydown = (e) => {
    if (e.key === 'Enter') okBtn.click();
    else if (e.key === 'Escape') cancelBtn.click();
  };
}

// ── Setup ───────────────────────────────────────────────────────────────

export function setupControllerMapEditor() {
  panelEl = document.getElementById('controller-map-panel');
  if (!panelEl) return;
  mapperWasActive = registryIsActive(registry());
  bodyEl = document.getElementById('cm-body');
  headerStatusEl = document.getElementById('cm-header-status');
  const header = document.getElementById('cm-drag-handle');
  const collapseBtn = document.getElementById('cm-collapse-btn');

  // Drag handling (same pattern as the Views panel)
  let dragOff = null;
  header.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    const rect = panelEl.getBoundingClientRect();
    dragOff = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    header.setPointerCapture(e.pointerId);
  });
  header.addEventListener('pointermove', (e) => {
    if (!dragOff) return;
    panelEl.style.left = `${Math.max(0, e.clientX - dragOff.x)}px`;
    panelEl.style.top = `${Math.max(0, e.clientY - dragOff.y)}px`;
    panelEl.style.right = 'auto';
  });
  header.addEventListener('pointerup', () => { dragOff = null; });
  collapseBtn.onclick = () => panelEl.classList.toggle('collapsed');

  // Native resize grip (style.css `resize: both`): pin the default
  // right-anchored panel to left/top before the first corner resize.
  pinForCornerResize(panelEl);

  // Tray growth switch: the tray keeps its compact 130px chip cap until
  // the panel carries an explicit inline height (operator resize via
  // the corner grip, or a restored layout) — from then on the flex
  // column distributes the space (style.css .cm-user-sized rules). The
  // native resizer writes inline styles silently, so watch the style
  // attribute instead of hooking any event.
  const syncUserSized = () =>
    panelEl.classList.toggle('cm-user-sized', panelEl.style.height !== '');
  syncUserSized();
  new MutationObserver(syncUserSized)
    .observe(panelEl, { attributes: true, attributeFilter: ['style'] });

  // Esc always backs out of the transient pick mode (docs/33).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pickTarget && !panelEl.classList.contains('hidden')) {
      pickTarget = null;
      renderIfOpen();
    }
  });

  // interaction.js calls this after every selection change so the
  // "+ sel (n)" counters and chip highlights track the 3D view live.
  window.refreshControllerMapPanel = renderIfOpen;

  // gui_builder calls this when fixture configs are DELETED (single
  // remove, trace delete, regeneration shrink). Addresses are absolute
  // (allocation model, decision 19), so the entry simply drops —
  // nothing else can shift; the freed channels become a visible hole
  // in the universe map until the operator compacts deliberately.
  window.controllerMappingFixturesRemoved = (configs) => {
    if (!registryIsActive(registry())) return;
    const removed = [];
    for (const config of configs || []) {
      if (!config || typeof config.name !== 'string' || config.name.length === 0) continue;
      if (unmapFixture(registry(), config.name)) removed.push(config.name);
    }
    if (removed.length === 0) return;
    console.warn(`[Controllers] ${removed.length} deleted fixture(s) unmapped — ` +
      'their channels are free again (visible as holes in the universe map):', removed);
    recomputeAndMark();
    renderIfOpen();
    showToast(`${removed.length} deleted fixture(s) unmapped — channels freed`, { ttl: 6000 });
  };

  window.toggleControllerMapPanel = () => {
    panelEl.classList.toggle('hidden');
    if (!panelEl.classList.contains('hidden')) {
      pickTarget = null;
      render();
      // Recompute the sync chip for every bound LED controller on open (one
      // getConfig+getStatus each; no background polling — plan P3).
      refreshSyncChips(ledCtx());
    } else {
      dismissToast();
    }
  };
}
