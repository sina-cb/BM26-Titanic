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
import { compareNatural } from '../core/natural_sort.js';
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
  parkedUniverseFor,
  computeLedProjection,
  testAutoPatch,
  clearAllPatches,
} from '../dmx/controller_registry.js';
import { gatherAllConfigs, isGlobalEffect, getFootprint } from '../dmx/auto_patcher.js';
import {
  collectAddressClaims,
  planUnifiedOutput,
} from '../dmx/address_merge.js';
import { showCustomConfirm } from './view_masks_editor.js';
import { pinForCornerResize } from './panel_layout.js';
import {
  openLedDiscoveryPanel,
  renderDeviceBindingSection,
  refreshSyncChips,
  deriveLayoutPreview,
  outputSelectorOptions,
  getDeviceOutputs,
  startPushAll,
  attemptFirstContactPromote,
} from './led_discovery_panel.js';
import {
  controllerProbeTargets,
  controllerStatusModel,
  mergeProbeResults,
  shouldAttemptFirstContact,
} from '../dmx/controller_status.js';
import { saveHttpUrl } from '../core/save_endpoint.js';
import { isStaticHost, logStaticHostSkip } from '../core/static_host.js';
import {
  renderGammaSection,
  startFleetGammaPush,
} from './led_gamma_ui.js';
import {
  computeLedStrandPatches,
  computeLedUniverseClaims,
  projectLedStrandSegments,
  validateLedManualUniverses,
} from '../dmx/led/led_patch_projection.js';
import { collectClaimedUniverses } from '../dmx/led/device_config_mapper.js';
import { ledBusFixtures, ledMappableCounts } from '../dmx/led/led_fixture_kind.js';
import { getDefinition } from '../dmx/fixture_definition_registry.js';

// ── Panel state ─────────────────────────────────────────────────────────

let pickTarget = null;   // { controllerId, portNum } while pick mode is active
let trayFilter = '';
let undoState = null;    // { snapshot, timer } — single-step undo (docs/33)
let hoverRestore = null; // pending hover flash restore
let lastProj = null;     // latest computeProjection result (universeEnds cache rides it)
let lastLedWarnings = []; // latest validateLedManualUniverses result (Slice D warn chips)
let lastLedClaims = new Map(); // latest computeLedUniverseClaims (LED occupancy in the bars)
// LED per-strand projection fields, computed ONCE per structural render (G2) and
// threaded into every LED port row — the pre-Slice-3 code recomputed both maps
// per LED port (O(ports×strands)), so a full ship reprojected LEDs 3–4× + once
// per port on every render. Now: bound = device-linear layout, generic = the
// sim's per-port projection; renderLedPort reads the map its controller needs.
let lastLedBoundFields = new Map();
let lastLedGenericFields = new Map();
// LED PROJECTION violations from the same compute (report 20260725_123). These
// used to be dropped on the floor here — `computeRenderProjection` kept only
// `.fields`, so `led_no_destination_ip` / `led_unknown_strand` /
// `led_unallocated_base` / `led_universe_overflow` were console-only while the
// pane's own header could still read "✓ fully patched" over them. They now ride
// into the header count and the banner beside the DMX ones.
let lastLedViolations = [];
// Camera focus on chip click (G5 reverse link). Persisted per-machine; when on,
// clicking a chip flies the 3D camera to frame that fixture/strand. A power-user
// pinning the map while orbiting turns it off. Default on.
const CAMERA_FOCUS_KEY = 'bm26.map.cameraFocusOnChip';
let cameraFocusOnChip = readCameraFocusPref();

function readCameraFocusPref() {
  try {
    return localStorage.getItem(CAMERA_FOCUS_KEY) !== '0';
  } catch (err) {
    console.error('[Controllers] read camera-focus pref', err);
    return true;
  }
}
const collapsedControllers = new Set(); // controller ids
const collapsedPorts = new Set();       // '<controllerId>:<portNum>' keys
const collapsedGroups = new Set();      // 'DMX' | 'LED' — collapsed type sections

// Controllers-section hide/show (operator request while live-mapping): the
// controllers list owns 3/4 of the pane (.cm-user-sized .cm-main flex:3), so a
// rig with a dozen controllers buries the UNMAPPED TRAY + Save row underneath
// it. Hiding the section gives the tray the whole pane; the section header
// stays put so it is always one click back. Persisted per-machine, same idiom
// as the camera-focus pref above.
const CONTROLLERS_COLLAPSED_KEY = 'bm26.map.controllersCollapsed';
export const CONTROLLERS_COLLAPSED_CLASS = 'cm-controllers-collapsed';
let controllersCollapsed = readControllersCollapsedPref();
let controllersToggleBtn = null; // live button, patched in place (no re-render)

/**
 * Normalize a persisted controllers-collapsed value. Only the exact string the
 * writer emits counts as collapsed — anything else (absent, junk, legacy) reads
 * as expanded, which is the state that shows the operator everything.
 * PURE — unit-tested in tests/controllers_pane_toggle.test.js.
 * @param {string|null} raw
 * @returns {boolean}
 */
export function parseControllersCollapsed(raw) {
  return raw === '1';
}

/**
 * Glyph + title for the controllers-section hide/show button, given the state
 * it is currently IN. Mirrors the ▾/▸ chevron idiom of the DMX/MarsinLED group
 * heads. PURE — unit-tested.
 * @param {boolean} collapsed
 * @returns {{glyph: string, title: string}}
 */
export function controllersToggleState(collapsed) {
  return collapsed
    ? {
      glyph: '▸',
      title: 'Show the controllers list (currently hidden — the unmapped tray ' +
        'and Save row below have the whole pane)',
    }
    : {
      glyph: '▾',
      title: 'Hide the controllers list so the unmapped tray and Save row ' +
        'below get the whole pane. Nothing is unpatched — display only.',
    };
}

function readControllersCollapsedPref() {
  try {
    return parseControllersCollapsed(localStorage.getItem(CONTROLLERS_COLLAPSED_KEY));
  } catch (err) {
    console.error('[Controllers] read controllers-collapsed pref', err);
    return false;
  }
}

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

/** LED strands (half of the tray source for LED-type controllers). */
function strandList() {
  return Array.isArray(params.ledStrands) ? params.ledStrands : [];
}

/**
 * LED PIXEL FIXTURES — the other half. A `parLights` entry whose fixture
 * DEFINITION declares `bus: led` (the TE Sign V3 halves) hangs off a MarsinLED
 * output exactly like a strand; only its pixel COORDINATES differ (baked `dots`
 * instead of a start→end line). Operator correction 2026-07-31: *"the TE signs
 * must be associated with MarsinLED controllers in the controller mapping
 * pane."* They therefore live in the LED tray, not the DMX one.
 */
function ledBusFixtureList() {
  return ledBusFixtures(allConfigs(), getDefinition);
}

/** Map<name, pixelCount> for the LED projection — strands AND LED fixtures. */
function strandLedCounts() {
  return ledMappableCounts(strandList(), allConfigs(), getDefinition);
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
    claimedUniverses: claimedUniversesFor,
    addressMergePlan: addressMergePlanNow,
    refresh: renderIfOpen,
    showToast,
    activeScene: () => window.__activeScene || 'default',
  };
}

/**
 * The registry-wide universe claim index for the per-output plan gate (slice S2,
 * report 20260725_58 §4): every universe owned by a controller OTHER than
 * `controller`, from the DMX projection (`universeMaps`) plus the LED occupancy
 * claims. Computed FRESH (never off the render cache) so a push always gates
 * against the current mapping, and threaded into the LED panel via ledCtx.
 */
function claimedUniversesFor(controller) {
  const reg = registry();
  const proj = computeProjection(reg, configsByName(), pins());
  return collectClaimedUniverses(controller, {
    dmxUniverseMaps: proj.universeMaps,
    ledClaims: ledUniverseClaims(),
    controllers: reg.controllers,
  });
}

/**
 * The registry-wide SHARED-ADDRESS plan (operator order 2026-07-31, report
 * 20260725_102): which claims land on the same (universe, channel-range), who
 * wins by the higher-IP rule, and which overlaps that rule cannot rank.
 *
 * Computed FRESH from the SAME two projections `claimedUniversesFor` uses, so
 * the pane's warning banner, the push dialog and the wire-side merge can never
 * tell three different stories. Threaded into the LED panel via ledCtx and
 * published on `window.__addressMergePlan` for the render/output path
 * (src/dmx/sacn_mapper.js reads the suppression index off it).
 */
function addressMergePlanNow() {
  const reg = registry();
  if (!registryIsActive(reg)) return planUnifiedOutput([]);
  const proj = computeProjection(reg, configsByName(), pins());
  return planUnifiedOutput(collectAddressClaims({
    dmxUniverseMaps: proj.universeMaps,
    ledClaims: ledUniverseClaims(),
    controllers: reg.controllers,
  }));
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

/**
 * The scene's one transient operator notice. Exported (report 20260725_83) so
 * the generator can announce a re-snap through the same affordance the mapping
 * editor uses instead of minting a second toast widget. Calling it without an
 * `undoSnapshot` is the plain-notice form.
 */
export function showToast(message, { undoSnapshot = null, error = false, ttl = 10000 } = {}) {
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

/** Strand index (into params.ledStrands / window.ledStrandFixtures) by name. */
function strandIndexByName(name) {
  const list = strandList();
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].name === name) return i;
  }
  return -1;
}

/**
 * Fly the 3D camera to frame a world-space point (G5 reverse link). Delegates
 * to view_presets' focusCameraOnPoint (installed on window at boot). No-op when
 * the operator has turned camera-focus off. THREE is not imported here, so the
 * point is passed as a plain {x,y,z} and the focus helper builds the vector.
 */
function focusCameraOn(point) {
  if (!cameraFocusOnChip || !point) return;
  if (typeof window.focusCameraOnPoint === 'function') window.focusCameraOnPoint(point);
}

function selectFixtureIn3D(name) {
  const index = fixtureIndexByName(name);
  if (index < 0) return;
  for (const i of selectedFixtureIndices) setFixtureSelectedVisual(i, false);
  selectedFixtureIndices.clear();
  selectedFixtureIndices.add(index);
  setFixtureSelectedVisual(index, true);
  // Clear any lingering strand selection so the panel highlight is unambiguous.
  for (const f of window.ledStrandFixtures || []) if (f && f._selected) f.setSelected(false);
  const fixture = (window.parFixtures || [])[index];
  if (fixture && fixture.hitbox) {
    const p = fixture.hitbox.position;
    focusCameraOn({ x: p.x, y: p.y, z: p.z });
  }
  if (window.refreshViewMasksPanel) window.refreshViewMasksPanel();
  syncSelectionUi();
}

/**
 * Reverse link for LED strands (G5): select a strand in 3D from its panel chip.
 * Strands are real 3D objects (window.ledStrandFixtures) but are absent from the
 * DMX fixture list, so they get their own select path: light the strand's
 * visuals, clear the par selection, open its GUI folder, and fly the camera to
 * the strand midpoint.
 */
function selectStrandIn3D(name) {
  const index = strandIndexByName(name);
  if (index < 0) return;
  for (const i of selectedFixtureIndices) setFixtureSelectedVisual(i, false);
  selectedFixtureIndices.clear();
  const fixtures = window.ledStrandFixtures || [];
  fixtures.forEach((f, i) => { if (f && typeof f.setSelected === 'function') f.setSelected(i === index); });
  if (window.openStrandFolder) window.openStrandFolder(index);
  const strand = fixtures[index];
  if (strand && strand.startPos && strand.endPos) {
    const a = strand.startPos;
    const b = strand.endPos;
    focusCameraOn({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
  }
  if (window.refreshViewMasksPanel) window.refreshViewMasksPanel();
  syncSelectionUi();
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

// The tray + picker lists are what the operator HUNTS through while mapping,
// so both are sorted by name — naturally (operator request 2026-07-29). The
// scene order they used to arrive in is creation order, which reads as random
// once a rig has ~90 fixtures. `compareNatural` is the shared comparator
// (src/core/natural_sort.js): "Left Back Wall 2" lands before
// "Left Back Wall 10", not after it.
//
// Sorted HERE, at the source, so every consumer agrees; and the tray then
// caches the result for the lifetime of one render (see renderTray) so typing
// in the filter box never re-derives or re-sorts anything.
function unmappedNames() {
  // LED-bus fixtures are deliberately absent: they are LED-mappable, so they
  // belong to the LED tray below. Leaving them here is what let a TE sign be
  // chained onto a DMX gateway in the first place.
  const ledBus = ledMappableNameSet();
  return unmappedNamesByKind(
    registry(), allConfigs().map(c => c.name).filter((n) => !ledBus.has(n)), [])
    .fixtures.sort(compareNatural);
}

/** Unmapped LED-mappable names — strands AND LED pixel fixtures. */
function unmappedStrandNames() {
  const ledNames = [
    ...strandList().map(s => s && s.name),
    ...ledBusFixtureList().map(c => c && c.name),
  ];
  return unmappedNamesByKind(registry(), [], ledNames)
    .strands.sort(compareNatural);
}

/** Every LED-MAPPABLE name in the scene (for strict type gating). */
function ledMappableNameSet() {
  const set = new Set();
  for (const s of strandList()) {
    if (s && typeof s.name === 'string' && s.name.length > 0) set.add(s.name);
  }
  for (const c of ledBusFixtureList()) {
    if (c && typeof c.name === 'string' && c.name.length > 0) set.add(c.name);
  }
  return set;
}

/** Kind ('strand'|'fixture') of a mappable name, for cross-type guards.
 *  'strand' here means LED-MAPPABLE — an LED strand or an LED pixel fixture;
 *  `controllerAcceptsKind` reads it as "belongs on an LED controller". */
function nameKind(name) {
  return ledMappableNameSet().has(name) ? 'strand' : 'fixture';
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

/** Every fixture/strand name chained anywhere on this controller, in port order. */
export function chainedNamesOn(controller) {
  const names = [];
  for (const port of controller.ports || []) {
    for (const entry of port.chain || []) {
      const name = entryFixtureName(entry);
      if (name !== null) names.push(name);
    }
  }
  return names;
}

/**
 * TRUE when this LED card carries chains but no usable destination IP — the one
 * state that is genuinely broken under the 2026-08-03 ruling. Its fixtures ARE
 * patched (records, model lanes, lit in the sim); there is simply no address to
 * unicast sACN to, so no bridge relay route can exist and the real strip stays
 * dark. Mirrors `led_no_destination_ip` in the projection.
 */
export function isChainedLedWithoutDestination(controller) {
  return isLedController(controller) && chainedNamesOn(controller).length > 0 &&
    !isValidIp(controller.ip);
}

/**
 * The per-card "no destination" banner (report 20260725_123). The one remaining
 * way to chain fixtures and still ship them dark, so it is the one loud card
 * state — kept to two short lines (operator: keep the messages short).
 */
function renderNoDestinationBanner(controller) {
  const names = chainedNamesOn(controller);
  const box = document.createElement('div');
  box.className = 'cm-nodest-banner';

  const head = document.createElement('div');
  head.className = 'cm-nodest-banner-head';
  head.textContent = `✋ No IP — nothing can be routed to '${controller.name}'`;
  box.appendChild(head);

  const body = document.createElement('div');
  body.className = 'cm-nodest-banner-body';
  body.textContent = `${names.length} chained fixture(s) patch and render. Type the IP above.`;
  box.appendChild(body);
  return box;
}

/**
 * The "No Controller" placeholder card (operator addendum 2026-08-03): the
 * nothing-attached state must be a THING in the pane, not an absence. Quiet and
 * informational — it is an entry point, not an alarm; the tray below still lists
 * the actual names.
 */
function renderNoControllerCard(unmapped, unmappedStrands) {
  const card = document.createElement('div');
  // Deliberately NOT `.cm-controller`: four agent_tools enumerate that class to
  // read the REAL controller cards (name/IP/dot/badge per card), and a
  // placeholder in that list reads as a card with null everything. It carries
  // the card LOOK via the stylesheet instead.
  card.className = 'cm-none-card';

  const head = document.createElement('div');
  head.className = 'cm-none-head';
  head.textContent = `🚫 No Controller · ${unmapped.length} fixture(s) · ` +
    `${unmappedStrands.length} strand(s)`;
  card.appendChild(head);

  const body = document.createElement('div');
  body.className = 'cm-none-body';
  body.textContent = 'Not on any controller — they patch nothing.';
  card.appendChild(body);

  const addBtn = document.createElement('button');
  addBtn.className = 'cm-btn cm-none-add';
  addBtn.textContent = '+ Add Controller';
  addBtn.title = 'Create a controller, then attach these from the tray below.';
  addBtn.onclick = showAddControllerModal;
  card.appendChild(addBtn);
  return card;
}

// ── Rendering ───────────────────────────────────────────────────────────

let panelEl = null;
let bodyEl = null;
let headerStatusEl = null;

function renderIfOpen() {
  if (panelEl && !panelEl.classList.contains('hidden')) render();
}

/**
 * Compute EVERY projection this render needs, exactly once (G2). Pre-Slice-3
 * render() recomputed the DMX projection once but the LED projection 3–4×
 * (validateLedManualUniverses + ledUniverseClaims' two computes) and then AGAIN
 * per LED port inside renderLedPort. Here the DMX projection, both LED field
 * maps, the per-universe LED claims, and the manual-universe warnings are each
 * built once; renderLedPort reads the cached bound/generic maps. Selection
 * changes no longer reach this path at all (they call syncSelectionUi).
 */
function computeRenderProjection() {
  const reg = registry();
  const proj = computeProjection(reg, configsByName(), pins());
  lastProj = proj; // makeAllocator rides universeEnds off this
  if (registryIsActive(reg)) {
    const counts = strandLedCounts();
    const ledPatches = computeLedStrandPatches(reg, counts);
    lastLedBoundFields = ledPatches.fields;
    lastLedViolations = ledPatches.violations;
    lastLedGenericFields = computeLedProjection(reg, counts).fields;
    const unbound = new Map();
    for (const [name, rec] of lastLedGenericFields) {
      if (!lastLedBoundFields.has(name)) unbound.set(name, rec);
    }
    lastLedClaims = computeLedUniverseClaims(lastLedBoundFields, unbound);
    lastLedWarnings = validateLedManualUniverses(reg, counts, proj.universeMaps);
  } else {
    lastLedBoundFields = new Map();
    lastLedGenericFields = new Map();
    lastLedViolations = [];
    lastLedClaims = new Map();
    lastLedWarnings = [];
  }
  return proj;
}

/**
 * Every BLOCKING violation this render must shout about — DMX projection
 * violations AND LED projection violations, one list (report 20260725_123).
 * The header count and the scene-wide banner both read this, so "✓ fully
 * patched" is unreachable while any LED card is misprojecting — including the
 * `led_unbound_chained` case where a chained card has no device binding and
 * projects nothing at all.
 *
 * NOT merged into `proj.violations` itself: that object is `lastProj`, which
 * `makeAllocator` and the per-port `violationsFor` chips read as the DMX
 * projection. LED violations carry no `port`, so they belong to the card/scene
 * level, not a port row.
 */
function allViolations(proj) {
  return [...proj.violations, ...lastLedViolations];
}

/**
 * The pane's headline verdict — the operator's ONE "am I done?" signal (docs/33).
 * PURE so it can be pinned directly (report 20260725_123): the whole class of bug
 * `_121` found is this predicate reading green over a real dark state, and a
 * predicate nobody can unit-test is a predicate that drifts back.
 *
 * `violationCount` spans BOTH projections — the pane used to drop every LED one,
 * so an LED card that could not be routed at all left the header reading green.
 * An unbound-but-chained card raises NO violation (it patches and routes like any
 * other), so the header stays quiet for it: only real blockers turn it.
 *
 * @param {boolean} active - the scene has a live registry.
 * @param {number} unmappedTotal - unmapped DMX fixtures + LED names.
 * @param {number} violationCount - DMX + LED projection violations.
 * @returns {{ text: string, cls: string, fullyPatched: boolean }}
 */
export function headerStatusModel(active, unmappedTotal, violationCount) {
  if (!active) return { text: '', cls: 'cm-header-status', fullyPatched: false };
  if (unmappedTotal > 0) {
    return {
      text: `Unmapped: ${unmappedTotal} ⚠`,
      cls: 'cm-header-status cm-warn',
      fullyPatched: false,
    };
  }
  if (violationCount > 0) {
    return {
      text: `${violationCount} violation(s) ⚠`,
      cls: 'cm-header-status cm-warn',
      fullyPatched: false,
    };
  }
  return { text: '✓ fully patched', cls: 'cm-header-status cm-ok', fullyPatched: true };
}

/**
 * Lightweight selection sync (G2): patch ONLY the selection-dependent DOM — chip
 * highlights + the "+ sel (n)" counters — without tearing down and rebuilding
 * #cm-body or recomputing any projection. interaction.js fires this on every 3D
 * pick (window.syncControllerMapSelection). Also scrolls the freshly-selected
 * chip into view (G5 forward link): a 3D selection whose chip is off-screen now
 * scrolls into the panel instead of silently highlighting nothing.
 *
 * Par selection wins over strand: when any DMX fixture is selected only its
 * chips highlight; with none selected the strand chips mirror the 3D strands'
 * own `_selected` flag (window.ledStrandFixtures), so a strand picked in 3D
 * lights its chip too.
 */
function syncSelectionUi() {
  if (!panelEl || panelEl.classList.contains('hidden') || !bodyEl) return;
  const parSelected = selectedFixtureIndices.size > 0;
  const selNames = new Set(selectedFixtureNames());
  const strandFixtures = window.ledStrandFixtures || [];
  let scrollTarget = null;
  for (const chip of bodyEl.querySelectorAll('.cm-chip[data-cm-fixture]')) {
    const name = chip.getAttribute('data-cm-fixture');
    let on = false;
    if (chip.getAttribute('data-cm-kind') === 'strand') {
      if (!parSelected) {
        const idx = strandIndexByName(name);
        on = idx >= 0 && !!(strandFixtures[idx] && strandFixtures[idx]._selected);
      }
    } else {
      on = selNames.has(name);
    }
    chip.classList.toggle('cm-chip-selected', on);
    if (on && !scrollTarget) scrollTarget = chip;
  }
  const n = selNames.size;
  for (const btn of bodyEl.querySelectorAll('.cm-sel-btn')) {
    btn.textContent = `+ sel (${n})`;
    btn.disabled = n === 0;
  }
  if (scrollTarget) scrollTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function render() {
  const reg = registry();
  const proj = computeRenderProjection();
  const unmapped = unmappedNames();
  const unmappedStrands = unmappedStrandNames();
  const unmappedTotal = unmapped.length + unmappedStrands.length;
  // Preserve the controllers scroll region across the full re-render. Collapsing
  // a port/controller/group rebuilds the whole panel via renderIfOpen(); without
  // this the pane jumps back to the top on every toggle.
  const prevMainScroll = bodyEl.querySelector('.cm-main')?.scrollTop ?? 0;
  bodyEl.replaceChildren();

  // Header status: the operator's "fully patched" signal (docs/33). LED
  // strands are fixtures too — a strand on no controller counts as unmapped, so
  // the panel never reads "fully patched" while one is still unpatched. The
  // count spans BOTH projections (report 20260725_123): LED violations used to
  // be dropped entirely, so an unroutable LED card left the header green.
  const violations = allViolations(proj);
  const headerStatus = headerStatusModel(registryIsActive(reg), unmappedTotal, violations.length);
  headerStatusEl.textContent = headerStatus.text;
  headerStatusEl.className = headerStatus.cls;

  // Violations banner (all of them, scene-wide — fail loudly). Pinned
  // above the scroll region, capped + scrollable itself so a pile of
  // violations can't push the controls off screen.
  if (violations.length > 0) {
    const banner = document.createElement('div');
    banner.className = 'cm-banner';
    banner.textContent = violations.map(v => `✋ ${v.message}`).join('\n');
    bodyEl.appendChild(banner);
  }

  // Controllers section header — carries the hide/show toggle. Lives OUTSIDE
  // .cm-main (a direct child of #cm-body) so it survives the section being
  // hidden and the operator always has the way back.
  bodyEl.appendChild(renderControllersSectionHead(reg.controllers.length));

  // Controllers live in their own scroll region; the tray, save button
  // and hint stay fixed below it so they're always reachable — sized
  // for rigs with 15+ controllers and hundreds of fixtures.
  const main = document.createElement('div');
  main.className = 'cm-main';

  // Unpatched-red overlay toggle (sim-only diagnostic; no DMX is sent).
  // Synced with BOTH "Show Unpatched (Red)" checkboxes — Lighting Control →
  // ⚙️ Options and the top of the fixtures panel. All three are views of the
  // one params.showUnpatchedRed flag; the checkboxes `.listen()`, so they
  // update themselves the moment this button writes it.
  const overlayOn = !!params.showUnpatchedRed;
  const overlayBtn = document.createElement('button');
  overlayBtn.className = overlayOn ? 'cm-btn cm-unpatched-toggle cm-on' : 'cm-btn cm-unpatched-toggle';
  overlayBtn.textContent = overlayOn
    ? '🔴 Unpatched Highlight: ON'
    : '⚪ Unpatched Highlight: OFF';
  overlayBtn.title = 'Tint fixtures with no patch red in the 3D view — LED strands ' +
    'and DMX alike (preview only — no DMX data is sent). Same switch as ' +
    '"Show Unpatched (Red)" in Lighting Control → Options and in the fixtures panel.';
  overlayBtn.onclick = () => {
    params.showUnpatchedRed = !params.showUnpatchedRed;
    renderIfOpen(); // refresh this button's label/state (the lil-gui checkbox self-syncs via .listen())
  };
  main.appendChild(overlayBtn);

  // Camera-focus toggle (G5): when on, clicking a fixture/strand chip flies the
  // 3D camera to frame it. Off pins the map for a power-user orbiting the ship.
  const focusBtn = document.createElement('button');
  focusBtn.className = cameraFocusOnChip
    ? 'cm-btn cm-camera-focus-toggle cm-on'
    : 'cm-btn cm-camera-focus-toggle';
  focusBtn.textContent = cameraFocusOnChip
    ? '🎯 Camera Follows Chip: ON'
    : '🎯 Camera Follows Chip: OFF';
  focusBtn.title = 'When ON, clicking a fixture or strand chip flies the 3D camera to frame it. ' +
    'Turn OFF to select without moving the camera (e.g. while orbiting the ship).';
  focusBtn.onclick = () => {
    cameraFocusOnChip = !cameraFocusOnChip;
    try { localStorage.setItem(CAMERA_FOCUS_KEY, cameraFocusOnChip ? '1' : '0'); } catch (err) {
      console.error('[Controllers] persist camera-focus pref', err);
    }
    renderIfOpen();
  };
  main.appendChild(focusBtn);

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
  // …and the third state: attached to NOTHING. Rendered as its own quiet card so
  // it is visible and actionable in the same place as the real cards.
  if (unmappedTotal > 0) main.appendChild(renderNoControllerCard(unmapped, unmappedStrands));
  bodyEl.appendChild(main);
  main.scrollTop = prevMainScroll; // restore scroll after the rebuild (see above)

  bodyEl.appendChild(renderTray(unmapped, unmappedStrands, proj));

  // Save row — its OWN anchored toolbar at the foot of the pane (report
  // 20260725_85). The button used to be a bare flex item dropped between the
  // tray and the hint with nothing reserving its space, so a tray squeezed by
  // the taller MarsinLED cards overflowed its box and the button painted on top
  // of the tray chips. `.cm-footer` is `flex: 0 0 auto` — it never shrinks, so
  // the tray and the hint yield first and Save is always reachable.
  const footer = document.createElement('div');
  footer.className = 'cm-footer';

  const saveBtn = document.createElement('button');
  const isDirty = window.__sceneDirty || false;
  saveBtn.className = isDirty ? 'vm-btn vm-save vm-dirty' : 'vm-btn vm-save';
  saveBtn.textContent = isDirty ? '💾 Save Configuration *' : '💾 Save Configuration';
  // AWAITED (report 20260725_86): the save may now put the 📡 Subscribed
  // Universes Yes/No/Cancel dialog in front of the operator, so "when is the
  // save done" is no longer a 400 ms guess — re-render when it actually
  // resolves. exportConfig never rejects (slice S1), so there is nothing to
  // catch; a cancelled save resolves `{ok:false}` and the pane repaints
  // unchanged.
  saveBtn.onclick = async () => {
    if (!window.exportConfig) return;
    await window.exportConfig();
    renderIfOpen();
  };
  footer.appendChild(saveBtn);
  bodyEl.appendChild(footer);

  const hint = document.createElement('div');
  hint.className = 'cm-hint';
  hint.textContent = 'Map fixtures by 3D selection (shift-click, then “+ sel”) or pick mode ' +
    '(“+ list”). Addresses are assigned at add time from the end of the universe and stick — ' +
    'type any address to move a fixture (conflicts go red but stand), clear it to send it to ' +
    'the end. Saved to controllers.yaml, projected into patches.yaml.';
  bodyEl.appendChild(hint);

  // Re-apply the controllers-section hide state to the freshly-built DOM (the
  // rebuild above dropped the class along with the old children).
  applyControllersCollapsed();

  // Set chip highlights + "+ sel" counters on the freshly-built DOM (covers
  // strand chips, which read the 3D strands' _selected flag rather than the par
  // selection set). Cheap DOM patch over the just-rendered nodes.
  syncSelectionUi();
}

// ── Controller reachability (ONLINE / OFFLINE / UNKNOWN) ────────────────
// Operator request 2026-07-31: "nice to have an ONLINE/OFFLINE status for all
// DMX and LED controllers … make it fast and parallel to not cause delays in
// the UI."
//
// The probing itself is SERVER-SIDE (server/controller_probe_service.cjs, route
// POST /controllers/probe): the browser cannot open a TCP socket to a DMX
// gateway, and per-type probes are the whole point (MarsinLED boards do not
// answer ICMP; sACN/Art-Net receivers answer nothing at all on the data path).
//
// The pane NEVER awaits a probe to paint. It renders from `probeResults`
// immediately — a card with no verdict yet shows ⋯/◌, never a guessed dot —
// and repaints when the sweep resolves. A sweep in flight is not restarted.
const probeResults = new Map();  // controller id → probe result
let probeSweeping = false;
let probeTimer = null;

// Auto-sweep while the pane is open. Persisted per machine; ON by default so
// the dots are simply true without anyone asking, OFF for a machine that must
// not touch the network (agent sessions, a bench with someone else's gear on
// the same subnet).
const PROBE_AUTO_KEY = 'bm26.map.controllerStatusAuto';
const PROBE_INTERVAL_MS = 20000;

function readProbeAutoPref() {
  try {
    const raw = localStorage.getItem(PROBE_AUTO_KEY);
    return raw === null ? true : raw === '1';
  } catch (err) {
    // A blocked localStorage is not a reason to guess the operator's intent in
    // a direction that puts packets on the wire.
    console.error('[Controllers] read controller-status auto pref', err);
    return false;
  }
}
let probeAuto = readProbeAutoPref();

/**
 * Fold a `/controllers/probe` response into the pane and repaint.
 *
 * Exported because it is the single ingestion point for probe verdicts: the
 * sweep below calls it, and so can a caller that already has results in hand.
 * FIRST CONTACT lives here too — a PROVISIONAL LED card that just came back
 * ONLINE carrying a board fingerprint is exactly the "next boot / recognition"
 * moment the lifecycle promotes on, and it must behave identically no matter
 * which entry point observed it.
 */
export function applyControllerProbeResults(response) {
  const reg = registry();
  const knownIds = new Set((reg && reg.controllers ? reg.controllers : []).map((c) => c.id));
  mergeProbeResults(probeResults, response, knownIds);

  for (const controller of (reg && reg.controllers) || []) {
    const probe = probeResults.get(controller.id);
    if (!shouldAttemptFirstContact(controller, probe)) continue;
    // Promotes on a clean reconcile; otherwise leaves the card untouched and
    // raises the reconcile dialog. Never auto-picks a side (codex P0).
    attemptFirstContactPromote(ledCtx(), controller, probe.device, { interactive: true });
  }
  renderIfOpen();
}

/**
 * One reachability sweep over every controller in the registry. Fire-and-repaint:
 * nothing in the pane awaits it.
 */
export function refreshControllerStatuses({ force = false } = {}) {
  if (probeSweeping) return Promise.resolve(null);
  const targets = controllerProbeTargets(registry());
  if (targets.length === 0) return Promise.resolve(null);
  if (isStaticHost()) {
    logStaticHostSkip('controller status probes (port 6970)');
    return Promise.resolve(null);
  }
  probeSweeping = true;
  renderIfOpen();
  return fetch(saveHttpUrl('/controllers/probe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targets, force }),
  })
    .then((res) => res.json())
    .then((body) => {
      if (!body || body.ok !== true) {
        throw new Error((body && body.error) || 'probe sweep returned no result');
      }
      probeSweeping = false;
      applyControllerProbeResults(body);
      return body;
    })
    .catch((err) => {
      probeSweeping = false;
      // A failed SWEEP is not an offline controller. Say what actually broke and
      // leave every dot where it was — inventing OFFLINE from our own fetch
      // failure is exactly the lie the third state exists to prevent.
      console.error(`[Controllers] ✋ status sweep failed: ${err.message} — every dot keeps its ` +
        'previous verdict (a failed sweep says nothing about the boards)');
      // …and STOP the auto-sweep. The overwhelmingly common cause is a save
      // server older than this page (the /controllers/probe route arrived with
      // report 20260725_96), and re-failing every 20 s would bury the one line
      // that explains it under a wall of identical toasts. One loud stop, with
      // the fix in it; "Check status" re-arms it by hand. The stop is SESSION
      // scoped on purpose — it is not written to the auto pref, so a reload
      // after the restart tries again without the operator hunting for a toggle.
      if (probeAuto) {
        probeAuto = false;
        syncProbeTimer();
        showToast(`✋ controller status sweep failed: ${err.message}. Auto-status is now OFF — if ` +
          'the sim stack was started before this feature landed, restart it so the save server ' +
          'serves /controllers/probe, then press "Check status".', { error: true, ttl: 15000 });
      } else {
        showToast(`✋ controller status sweep failed: ${err.message}`, { error: true, ttl: 8000 });
      }
      renderIfOpen();
      return null;
    });
}

/** Start/stop the auto-sweep to match `probeAuto` and whether the pane is open. */
function syncProbeTimer() {
  const shouldRun = probeAuto && !!panelEl && !panelEl.classList.contains('hidden');
  if (shouldRun && probeTimer === null) {
    probeTimer = setInterval(() => refreshControllerStatuses(), PROBE_INTERVAL_MS);
    refreshControllerStatuses();
  } else if (!shouldRun && probeTimer !== null) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
}

function toggleProbeAuto() {
  probeAuto = !probeAuto;
  try {
    localStorage.setItem(PROBE_AUTO_KEY, probeAuto ? '1' : '0');
  } catch (err) {
    console.error('[Controllers] persist controller-status auto pref', err);
  }
  syncProbeTimer();
  renderIfOpen();
}

// ── Controllers section head + hide/show ────────────────────────────────
// The toggle is DISPLAY ONLY: it flips one class on #cm-body and repaints one
// button. It never rebuilds the pane, never recomputes a projection and never
// touches the registry — safe to hit mid-mapping (an in-flight pick mode, a
// half-typed address, the tray filter all survive it untouched).

function renderControllersSectionHead(controllerCount) {
  const head = document.createElement('div');
  head.className = 'cm-section-head';

  controllersToggleBtn = document.createElement('button');
  controllersToggleBtn.className = 'cm-toggle cm-controllers-toggle';
  controllersToggleBtn.onclick = toggleControllersSection;
  head.appendChild(controllersToggleBtn);
  paintControllersToggle();

  const title = document.createElement('span');
  title.className = 'cm-section-title';
  title.textContent = `Controllers (${controllerCount})`;
  head.appendChild(title);

  // ── Reachability controls ────────────────────────────────────────────
  const statusBtn = document.createElement('button');
  statusBtn.className = 'cm-btn cm-status-sweep';
  statusBtn.textContent = probeSweeping ? '🛰 checking…' : '🛰 Check status';
  statusBtn.disabled = probeSweeping;
  statusBtn.title = 'Probe every controller now (parallel, ~1 s ceiling each) and refresh the ' +
    'ONLINE / OFFLINE / UNKNOWN dots.\n\n' +
    'LED cards are probed over HTTP GET /api/status (MarsinLED boards do not answer ICMP); ' +
    'DMX gateways by TCP connect, where even a refused connection proves the box is on the ' +
    'network.\n\nReachability only — it does NOT prove sACN frames are arriving.';
  statusBtn.onclick = () => refreshControllerStatuses({ force: true });
  head.appendChild(statusBtn);

  const autoBtn = document.createElement('button');
  autoBtn.className = 'cm-btn cm-status-auto' + (probeAuto ? ' cm-status-auto-on' : '');
  autoBtn.textContent = probeAuto ? 'auto ✓' : 'auto ✕';
  autoBtn.title = probeAuto
    ? `Auto-sweep is ON — every ${Math.round(PROBE_INTERVAL_MS / 1000)} s while this pane is ` +
      'open. Click to stop probing the network.'
    : 'Auto-sweep is OFF — dots only update when you press "Check status". Click to re-enable.';
  autoBtn.onclick = toggleProbeAuto;
  head.appendChild(autoBtn);

  return head;
}

function paintControllersToggle() {
  if (!controllersToggleBtn) return;
  const { glyph, title } = controllersToggleState(controllersCollapsed);
  controllersToggleBtn.textContent = glyph;
  controllersToggleBtn.title = title;
}

/** Apply the current hide state to the live DOM. Idempotent, no rebuild. */
function applyControllersCollapsed() {
  if (bodyEl) bodyEl.classList.toggle(CONTROLLERS_COLLAPSED_CLASS, controllersCollapsed);
  paintControllersToggle();
}

function toggleControllersSection() {
  controllersCollapsed = !controllersCollapsed;
  try {
    localStorage.setItem(CONTROLLERS_COLLAPSED_KEY, controllersCollapsed ? '1' : '0');
  } catch (err) {
    console.error('[Controllers] persist controllers-collapsed pref', err);
  }
  applyControllersCollapsed();
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

    // Fleet gamma: write EVERY LED controller's gamma curve to its hardware,
    // sequentially, with a per-controller result. Independent of the mapping
    // push above — gamma normally applies live, no reboot.
    const gammaAllBtn = document.createElement('button');
    gammaAllBtn.className = 'cm-btn cm-push-all-gamma';
    gammaAllBtn.textContent = '⬆ Push gamma to all';
    gammaAllBtn.title = 'Push every LED controller\'s gamma curve sequentially ' +
      '(backup → gamma-only write → read-back verify), with a per-controller result';
    gammaAllBtn.disabled = controllers.filter((c) => isValidIp(c.ip)).length === 0;
    gammaAllBtn.onclick = () => startFleetGammaPush(ledCtx());
    head.appendChild(gammaAllBtn);
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

  // TWO rows (operator request): identity on top, actions underneath.
  // One row could not hold both — the name input is the only flexible item
  // (`.cm-name { flex: 1 }` → flex-basis 0), so the fixed-width IP box plus
  // four text buttons ate the row and the name collapsed to ~5 characters on
  // a docked pane. Row 1 gives the name everything except the chevron and the
  // IP box; row 2 owns the type / transport / +port / delete buttons.
  // Reachability dot — one per card, right next to the IP it describes.
  // Renders from the last verdict only; with no verdict it says UNKNOWN (or
  // CHECKING mid-sweep) and never a guess.
  const status = controllerStatusModel(controller, probeResults.get(controller.id) || null,
    { sweeping: probeSweeping });
  const statusDot = document.createElement('span');
  statusDot.className = `cm-status-dot ${status.cls}`;
  statusDot.textContent = status.dot;
  statusDot.title = `${status.label}\n\n${status.title}`;
  statusDot.dataset.cmStatus = status.state;

  const idRow = document.createElement('div');
  idRow.className = 'cm-controller-head-row cm-controller-id-row';
  idRow.appendChild(toggleBtn);
  idRow.appendChild(nameInp);
  idRow.appendChild(ipInp);
  idRow.appendChild(statusDot);

  const actionRow = document.createElement('div');
  actionRow.className = 'cm-controller-head-row cm-controller-action-row';
  actionRow.appendChild(typeBtn);
  actionRow.appendChild(protoBtn);
  actionRow.appendChild(addPortBtn);
  const actionSpacer = document.createElement('span');
  actionSpacer.className = 'cm-head-spacer';
  actionRow.appendChild(actionSpacer);
  actionRow.appendChild(delBtn); // pushed right, away from the everyday buttons

  head.appendChild(idRow);
  head.appendChild(actionRow);
  card.appendChild(head);

  // The card-level "NO DESTINATION IP" banner comes FIRST, above every other chip
  // and above the collapsed summary — a collapsed card must still shout it
  // (report 20260725_123).
  if (isChainedLedWithoutDestination(controller)) {
    card.classList.add('cm-controller-nodest');
    card.appendChild(renderNoDestinationBanner(controller));
  }

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

    // Per-channel gamma: the scene MIRROR of the curve the controller runs
    // (the one and only gamma in the chain), editable here, with a per-card
    // push that verifies against the hardware. LED controllers only.
    const gammaSection = renderGammaSection(ledCtx(), controller);
    if (gammaSection) card.appendChild(gammaSection);

    // Device binding: identity + sync chip + Push (bound), or a Discover/bind
    // button (unbound). All device I/O lives in led_discovery_panel.
    const deviceSection = renderDeviceBindingSection(ledCtx(), controller);
    if (deviceSection) card.appendChild(deviceSection);

    // Board outputs: what every PHYSICAL output on this board is doing — driven
    // by a port, parked (enabled but nothing routed here), or disabled. Rendered
    // only when the device has actually been read, so the line is never a guess.
    // This is where a portless enabled output becomes visible BEFORE anyone
    // opens the push dialog (report 20260725_70 §5.2).
    const boardOutputs = getDeviceOutputs(ledCtx(), controller.id);
    if (boardOutputs && boardOutputs.length) {
      const boardRow = document.createElement('div');
      boardRow.className = 'cm-led-board-outputs';
      const portByOutput = new Map();
      for (const p of controller.ports || []) portByOutput.set(p.output, p);
      const parts = [];
      for (let n = 1; n <= boardOutputs.length; n++) {
        const p = portByOutput.get(n);
        if (p) { parts.push(`${n}←P${p.port}(U${p.universe})`); continue; }
        const parkedU = parkedUniverseFor(controller, n - 1);
        if (boardOutputs[n - 1].enabled) {
          parts.push(parkedU ? `${n} parked U${parkedU}` : `${n} parked (universe on next push)`);
        } else {
          parts.push(`${n} disabled`);
        }
      }
      const boardLbl = document.createElement('span');
      boardLbl.className = 'cm-led-lbl';
      boardLbl.textContent = 'Board outputs:';
      boardLbl.title = 'PARKED = enabled on the board with no card port driving it. It keeps a ' +
        'universe nobody routes to, so it receives no packets and stays dark. The push NEVER ' +
        'disables an output.';
      boardRow.appendChild(boardLbl);
      const boardTxt = document.createElement('span');
      boardTxt.className = 'cm-led-board-outputs-text';
      boardTxt.textContent = parts.join('  ');
      boardRow.appendChild(boardTxt);

      // Re-park: drop the stored parked universes so the next derive allocates
      // fresh ones (the escape hatch for the span/claim cases in §2.2).
      if (Array.isArray(controller.parkedOutputs) && controller.parkedOutputs.length) {
        const reparkBtn = document.createElement('button');
        reparkBtn.className = 'cm-btn cm-led-repark';
        reparkBtn.textContent = '↻ re-park';
        reparkBtn.title = 'Forget the stored parked universes on this card. The next push ' +
          'allocates fresh ones (lowest free inside the 16-universe window).';
        reparkBtn.onclick = () => {
          mutate(`Re-parked unmapped outputs on ${controller.name}`, () => {
            delete controller.parkedOutputs;
          });
        };
        boardRow.appendChild(reparkBtn);
      }
      card.appendChild(boardRow);
    }
  }

  if (isCollapsed) {
    const fixtureCount = controller.ports.reduce(
      (n, p) => n + p.chain.filter(e => entryFixtureName(e) !== null).length, 0);
    const universes = [...new Set(controller.ports.map(p => `U${p.universe}`))].join(' ');
    const summary = document.createElement('div');
    summary.className = 'cm-summary';
    // A CROSSED port→output mapping must be readable without expanding the card.
    const crossings = isLed
      ? controller.ports.filter((p) => p.output !== p.port).map((p) => `P${p.port}→O${p.output}`)
      : [];
    summary.textContent = `${controller.ports.length} port(s) · ${fixtureCount} fixture(s) · ` +
      universes + (crossings.length ? ` · ${crossings.join(' ')}` : '');
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
  const crossed = port.output !== port.port;
  const label = document.createElement('span');
  // A CROSSED mapping (P1 driving output 4) must be visible without expanding
  // anything — the accent class is the same one the warn chips use.
  label.className = 'cm-port-label' + (crossed ? ' cm-port-label-crossed' : '');
  label.textContent = `P${port.port} →`;
  label.title = crossed
    ? `Port row ${port.port} drives PHYSICAL output ${port.output} on the board — a crossed mapping.`
    : 'Port row and physical board output match (the default identity mapping).';
  head.appendChild(label);

  // ── The physical board output this port drives (report 20260725_70 §5.1) ──
  // The operator's "use output 4 only" case is ONE row with this set to 4: no
  // filler rows, no unused universes. Outputs 1–3, if enabled on the board,
  // become PARKED — they keep a universe nobody routes to, so they stay dark
  // without ever being disabled.
  const devOutputs = getDeviceOutputs(ledCtx(), controller.id);
  const selModel = outputSelectorOptions(controller, port, devOutputs);
  const outSel = document.createElement('select');
  outSel.className = 'cm-input cm-num cm-led-output';
  outSel.title = 'Physical output on the board this port drives. Two ports may not drive the ' +
    "same output. The device's strands[] index is this number − 1." +
    (selModel.verified
      ? ` This board reports ${selModel.max} output(s).`
      : ' The board has not been read yet, so the range 1–16 is UNVERIFIED — discover or push ' +
        'the card to confirm how many outputs it actually has.');
  for (const opt of selModel.options) {
    const o = document.createElement('option');
    o.value = String(opt.value);
    o.textContent = opt.label;
    o.disabled = opt.disabled;
    if (opt.selected) o.selected = true;
    outSel.appendChild(o);
  }
  outSel.onchange = () => {
    const next = parseInt(outSel.value, 10);
    if (next === port.output) return;
    // Layer 1 of the uniqueness rule: the duplicate option is already disabled,
    // so this only fires if something bypassed the widget. Refuse + revert; the
    // push gate is layer 2 and blocks it no matter who authored the file.
    const clash = (controller.ports || []).find((p) => p !== port && p.output === next);
    if (clash) {
      showToast(`Output ${next} is already driven by P${clash.port} — one physical output ` +
        'cannot take two universes', { error: true, ttl: 6000 });
      outSel.value = String(port.output);
      return;
    }
    mutate(`Port ${port.port} → output ${next} on ${controller.name}`, () => {
      // The output this port now drives can no longer be parked.
      port.output = next;
      if (Array.isArray(controller.parkedOutputs)) {
        controller.parkedOutputs = controller.parkedOutputs.filter((p) => p.output !== next);
        if (controller.parkedOutputs.length === 0) delete controller.parkedOutputs;
      }
    });
  };
  head.appendChild(outSel);

  const uniLbl = document.createElement('span');
  uniLbl.className = 'cm-port-label';
  uniLbl.textContent = 'U';
  head.appendChild(uniLbl);

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
    // Per-strand addresses, from the ONE per-output patch projection
    // (led_patch_projection) every LED card now uses — bound or not (operator
    // ruling 2026-08-03, report 20260725_123). There is no second "preview"
    // layout any more: what the chip shows IS what patches.yaml, the engine model
    // and the wire carry, so the chips cannot drift from the patch again.
    const chain = document.createElement('div');
    chain.className = 'cm-chain';
    for (const entry of port.chain) {
      const name = entryFixtureName(entry);
      if (name === null) continue;
      const chip = document.createElement('span');
      chip.className = 'cm-chip cm-chip-strand';
      // Reverse link (G5): a mapped strand chip locates + frames its strand in
      // 3D, exactly as a DMX fixture chip does. data-cm-* lets syncSelectionUi
      // patch this chip's highlight without a full re-render.
      chip.dataset.cmFixture = name;
      chip.dataset.cmKind = 'strand';
      const p = lastLedBoundFields.get(name);
      const info = strandSegmentsFor(p);
      // Multi-universe strands render the full span (U6:1 → U7:288); a strand
      // inside one universe keeps the U6:1–160 form (G5).
      const addr = info ? ` ${ledStrandSpanText(info.segments)} ×${info.px}px` : ' (unresolved)';
      chip.textContent = `💡 ${name}${addr}`;
      chip.title = info
        ? `${ledStrandSpanTooltip(info.segments)} — click to locate in 3D`
        : 'click to locate in 3D';
      chip.onclick = () => selectStrandIn3D(name);
      const unbind = document.createElement('button');
      unbind.className = 'cm-chip-x';
      unbind.textContent = '×';
      unbind.title = `Unbind '${name}'`;
      unbind.onclick = (e) => { e.stopPropagation(); mutate(null, () => { unmapFixture(registry(), name); }); };
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
    // Keyed by the PORT ROW, labelled with the PHYSICAL OUTPUT it drives — the
    // old `output ${port.port}` text was a lie under a crossed mapping.
    const out = preview.perOutput.get(port.port);
    const where = `P${port.port} → output ${port.output}`;
    if (preview.error) {
      derivedLine.classList.add('cm-led-derived-warn');
      derivedLine.textContent = `⌁ ${where}: ${preview.error}`;
    } else if (out && out.enabled) {
      const span = out.endUniverse === out.universe
        ? `U${out.universe} ch ${out.startChannel}–${out.endChannel}`
        : `U${out.universe} ch ${out.startChannel} → U${out.endUniverse} ch ${out.endChannel}`;
      derivedLine.textContent = `⌁ ${where}: ${span} · ${out.pixelCount}px`;
    } else {
      derivedLine.textContent = `⌁ ${where}: no data routed (no strands)`;
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
  // The chain is CABLE DOCUMENTATION, not a derived list: chips sit in the
  // order they were added and are NEVER re-sorted behind the operator's back,
  // so a generator renumber (which rewrites which physical light each
  // `<group> N` name means) leaves these chips exactly where they were. Say so
  // — otherwise chips reading "… 10, 2, 3" look like a bug rather than the
  // wiring order somebody actually cabled (report 20260725_44 §2).
  chain.title = 'Daisy-chain order = the order the fixtures are CABLED on this port. ' +
    'It is never re-derived from fixture numbers or re-sorted automatically — ' +
    'drag chips to match the real cable.';

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
        promptForGapWidth(item.entry.gap, (next) => {
          mutate(null, () => { item.entry.gap = next; });
        });
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
      // data-cm-* lets syncSelectionUi patch this chip's highlight on a 3D pick
      // without rebuilding the panel (G2); the initial highlight is set by that
      // same pass at the end of render().
      chip.dataset.cmFixture = name;
      chip.dataset.cmKind = 'fixture';
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
    // cm-sel-btn: syncSelectionUi live-updates the label + disabled state on
    // every 3D pick without rebuilding the panel, so the click must read the
    // CURRENT selection (the render-time `names` closure would be stale).
    fromSelBtn.className = 'cm-btn cm-sel-btn';
    fromSelBtn.textContent = `+ sel (${names.length})`;
    fromSelBtn.title = 'Append the 3D selection to this chain, in selection order';
    fromSelBtn.disabled = names.length === 0;
    fromSelBtn.onclick = () => addNamesToPort(controller, port, selectedFixtureNames());
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
      promptForGapWidth(10, (width) => {
        const allocate = makeAllocator(port.universe);
        const at = allocate(width);
        if (at === null) {
          showToast(`U${port.universe} has no room at the end for a ${width}-ch gap`, { error: true, ttl: 6000 });
          return;
        }
        mutate(null, () => { port.chain.push({ gap: width, at }); });
      });
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
  // Width lives in the stylesheet (.cm-input.cm-tray-filter) so the docked
  // pane can widen it; an inline width could not be overridden per state.
  filter.className = 'cm-input cm-tray-filter';
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

  // Source lists resolved ONCE per render, already name-sorted. renderChips()
  // runs on every keystroke in the filter box, and it used to call
  // unmappedNames()/unmappedStrandNames() from inside that loop — re-walking
  // every scene config and every chain entry (and now re-sorting) per
  // character typed. Every mapping change routes through mutate(), which
  // always re-renders, so these can never go stale within one render; the
  // filter is a pure subset and preserves the order it is handed.
  const trayFixtureNames = unmappedNames();
  const trayStrandNames = unmappedStrandNames();

  function renderChips() {
    chips.replaceChildren();
    const needle = trayFilter.trim().toLowerCase();
    let shown = 0;

    // When picking onto an LED controller the tray lists STRANDS; the
    // default (and DMX picking) lists fixtures. The chain-entry namespace
    // is shared, so a strand and fixture can each be mapped at most once.
    const ledTray = pickPort && pickingLed;
    const names = ledTray ? trayStrandNames : trayFixtureNames;

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
        // Reverse link (G5): strands ARE 3D objects, so even an unmapped strand
        // chip locates + frames its strand — no longer purely informational.
        chip.title = `Unmapped LED strand '${name}' — click to locate in 3D. Add/select a ` +
          `${LED_TYPE_LABEL} controller, then pick this strand onto one of its outputs.`;
        chip.onclick = () => selectStrandIn3D(name);
        chips.appendChild(chip);
        shown++;
      }
    }

    if (shown === 0) {
      const done = document.createElement('div');
      done.className = 'cm-fully-patched';
      const bothEmpty = unmapped.length === 0 && unmappedStrands.length === 0;
      done.textContent = (pickPort && pickingLed)
        ? (trayStrandNames.length === 0 ? '✓ every strand is mapped' : '(no matches)')
        : (bothEmpty ? '✓ every fixture & strand is mapped' : '(no matches)');
      chips.appendChild(done);
    }
  }
  renderChips();

  return tray;
}

// ── Gap-width prompt (non-blocking; replaces window.prompt — G3) ─────────

/**
 * Non-blocking replacement for the old window.prompt() gap-width entry (G3).
 * The native prompt() was a synchronous OS modal that froze the entire render
 * thread — the 3D view stopped, the compositor wedged, and there was no styling
 * or validation. This is a small styled modal on the existing vm-modal-* chrome
 * that validates a positive integer and calls onConfirm(width); the render loop
 * keeps running behind it.
 */
function promptForGapWidth(current, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'vm-modal-overlay';
  const card = document.createElement('div');
  card.className = 'vm-modal-card';

  const titleEl = document.createElement('div');
  titleEl.className = 'vm-modal-title';
  titleEl.textContent = 'Gap width (channels)';
  card.appendChild(titleEl);

  const input = document.createElement('input');
  input.className = 'vm-modal-input';
  input.type = 'number';
  input.min = '1';
  input.max = String(DMX_UNIVERSE_SIZE);
  input.value = String(Number.isInteger(current) && current >= 1 ? current : 10);
  card.appendChild(input);

  const actions = document.createElement('div');
  actions.className = 'vm-modal-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'vm-modal-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => overlay.remove();
  const okBtn = document.createElement('button');
  okBtn.className = 'vm-modal-btn vm-modal-btn-primary';
  okBtn.textContent = 'OK';
  okBtn.onclick = () => {
    const width = parseInt(input.value, 10);
    if (!Number.isInteger(width) || width < 1) {
      input.focus();
      return;
    }
    overlay.remove();
    onConfirm(width);
  };
  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  input.focus();
  input.select();

  overlay.onkeydown = (e) => {
    if (e.key === 'Enter') okBtn.click();
    else if (e.key === 'Escape') cancelBtn.click();
  };
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

  // Data/structural refresh (full re-render): undo, the unpatched-overlay
  // toggle, and any caller that CHANGED the mapping data use this.
  window.refreshControllerMapPanel = renderIfOpen;

  // Selection-only sync (G2): interaction.js fires this on every 3D pick. It
  // patches chip highlights + "+ sel" counters and scrolls the selected chip
  // into view WITHOUT rebuilding #cm-body or recomputing any projection — the
  // hot path that used to cost 16–38 ms per selection.
  window.syncControllerMapSelection = syncSelectionUi;

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
    // Reachability sweeps run only while the pane is on screen — closing it
    // stops every probe (and reopening takes a fresh one).
    syncProbeTimer();
  };
  // The pane can boot already open (its hidden class is persisted layout state).
  syncProbeTimer();
}
