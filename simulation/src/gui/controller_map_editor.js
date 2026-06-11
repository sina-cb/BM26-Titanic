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
  registryIsActive,
  mappedFixtures,
  addController,
  addPort,
  removeController,
  removePort,
  appendFixtures,
  unmapFixture,
  isValidIp,
  isGapEntry,
  isPinnedEntry,
  entryFixtureName,
  computeProjection,
  renameFixtureInChains,
} from '../dmx/controller_registry.js';
import { gatherAllConfigs, isGlobalEffect } from '../dmx/auto_patcher.js';
import { showCustomConfirm } from './view_masks_editor.js';

// ── Panel state ─────────────────────────────────────────────────────────

let pickTarget = null;   // { controllerId, portNum } while pick mode is active
let trayFilter = '';
let undoState = null;    // { snapshot, timer } — single-step undo (docs/33)
let hoverRestore = null; // pending hover flash restore

function registry() {
  return window.__controllerRegistry || { nextControllerId: 1, controllers: [] };
}

function pins() {
  return (window.serverConfig && window.serverConfig.global_effects) || {};
}

/** Selection indexing basis — same rule as the Views panel. */
function fixtureList() {
  return (params.dmxFixtures && params.dmxFixtures.length > 0) ? params.dmxFixtures : params.parLights;
}

function allConfigs() {
  return gatherAllConfigs(params).filter(c => c && typeof c.name === 'string' && c.name.length > 0);
}

function configsByName() {
  const map = new Map();
  for (const config of allConfigs()) map.set(config.name, config);
  return map;
}

// ── Projection / change propagation ─────────────────────────────────────

function recomputeAndMark() {
  if (window.projectControllerMappings) {
    window.projectControllerMappings(allConfigs());
  }
  if (window.recomputePatchesActive) window.recomputePatchesActive();
  if (window.debounceAutoSave) window.debounceAutoSave();
  if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('metadata');
  if (window.refreshMetadataPanels) window.refreshMetadataPanels();
}

// ── Undo (single-step snapshot, 10 s window) ────────────────────────────

function snapshotRegistry() {
  const reg = registry();
  return JSON.stringify({ nextControllerId: reg.nextControllerId, controllers: reg.controllers });
}

function restoreSnapshot(snapshot) {
  // Restore IN PLACE — the registry object is referenced by the config
  // tree (save path) and window.__controllerRegistry; identity must hold.
  const reg = registry();
  const parsed = JSON.parse(snapshot);
  reg.nextControllerId = parsed.nextControllerId;
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
  return computeProjection(registry(), configsByName(), pins());
}

function unmappedNames() {
  const mapped = mappedFixtures(registry());
  return allConfigs().map(c => c.name).filter(name => !mapped.has(name));
}

function violationsFor(violations, controller, port) {
  return violations.filter(v =>
    v.controllerId === controller.id && (port === null ? v.port === 0 : v.port === port.port));
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
  const unmapped = unmappedNames();
  bodyEl.replaceChildren();

  // Header status: the operator's "fully patched" signal (docs/33).
  if (!registryIsActive(reg)) {
    headerStatusEl.textContent = '';
    headerStatusEl.className = 'cm-header-status';
  } else if (unmapped.length > 0) {
    headerStatusEl.textContent = `Unmapped: ${unmapped.length} ⚠`;
    headerStatusEl.className = 'cm-header-status cm-warn';
  } else if (proj.violations.length > 0) {
    headerStatusEl.textContent = `${proj.violations.length} violation(s) ⚠`;
    headerStatusEl.className = 'cm-header-status cm-warn';
  } else {
    headerStatusEl.textContent = '✓ fully patched';
    headerStatusEl.className = 'cm-header-status cm-ok';
  }

  // Violations banner (all of them, scene-wide — fail loudly).
  if (proj.violations.length > 0) {
    const banner = document.createElement('div');
    banner.className = 'cm-banner';
    banner.textContent = proj.violations.map(v => `✋ ${v.message}`).join('\n');
    bodyEl.appendChild(banner);
  }

  // Add controller
  const addBtn = document.createElement('button');
  addBtn.className = 'cm-btn cm-add';
  addBtn.textContent = '+ Add Controller';
  addBtn.onclick = showAddControllerModal;
  bodyEl.appendChild(addBtn);

  for (const controller of reg.controllers) {
    bodyEl.appendChild(renderController(controller, proj));
  }

  bodyEl.appendChild(renderTray(unmapped, proj));

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
  hint.textContent = 'Map fixtures by 3D selection (shift-click in order, then “+ sel”) or pick mode ' +
    '(“+ list”, one click per fixture). Addresses derive from chain order — saved to ' +
    'controllers.yaml, projected into patches.yaml.';
  bodyEl.appendChild(hint);
}

// ── Controller card ─────────────────────────────────────────────────────

function renderController(controller, proj) {
  const card = document.createElement('div');
  card.className = 'cm-controller';

  const head = document.createElement('div');
  head.className = 'cm-controller-head';

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
  head.appendChild(addPortBtn);
  head.appendChild(delBtn);
  card.appendChild(head);

  for (const v of violationsFor(proj.violations, controller, null)) {
    const chip = document.createElement('span');
    chip.className = 'cm-error-chip';
    chip.textContent = v.message;
    card.appendChild(chip);
  }

  for (const port of controller.ports) {
    card.appendChild(renderPort(controller, port, proj));
  }
  return card;
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

  const label = document.createElement('span');
  label.className = 'cm-port-label' + (isEffectsPort ? ' cm-effects' : '');
  label.textContent = `P${port.port} · U`;
  head.appendChild(label);

  const uniInp = document.createElement('input');
  uniInp.className = 'cm-input cm-num';
  uniInp.type = 'number';
  uniInp.min = '1';
  uniInp.value = port.universe;
  uniInp.title = `Universe (${EFFECTS_UNIVERSE} = effects only)`;
  uniInp.onchange = () => {
    const next = parseInt(uniInp.value, 10);
    if (!Number.isInteger(next) || next < 1) {
      uniInp.value = port.universe;
      return;
    }
    mutate(null, () => { port.universe = next; });
  };
  head.appendChild(uniInp);

  if (!isEffectsPort) {
    const atLabel = document.createElement('span');
    atLabel.textContent = '@';
    atLabel.style.color = '#667';
    head.appendChild(atLabel);

    const startInp = document.createElement('input');
    startInp.className = 'cm-input cm-num';
    startInp.type = 'number';
    startInp.min = '1';
    startInp.max = String(DMX_UNIVERSE_SIZE);
    startInp.value = port.startAddress;
    startInp.title = 'Chain start address (split-universe ports pack independently)';
    startInp.onchange = () => {
      const next = parseInt(startInp.value, 10);
      if (!Number.isInteger(next) || next < 1 || next > DMX_UNIVERSE_SIZE) {
        startInp.value = port.startAddress;
        return;
      }
      mutate(null, () => { port.startAddress = next; });
    };
    head.appendChild(startInp);
  } else {
    const fx = document.createElement('span');
    fx.textContent = '✨';
    fx.title = `Universe ${EFFECTS_UNIVERSE} is reserved for effects — pinned addresses only`;
    head.appendChild(fx);
  }

  // Positioned occupancy bar: segments sit where they live in the
  // universe, so split-universe ports read at a glance (docs/33).
  const bar = document.createElement('div');
  bar.className = 'cm-occupancy';
  let used = 0;
  let anyInvalid = false;
  for (const item of layout) {
    if (item.footprint <= 0) continue;
    const seg = document.createElement('div');
    seg.className = 'cm-occ-seg' +
      (isGapEntry(item.entry) ? ' cm-occ-gap' : '') +
      (item.valid ? '' : ' cm-occ-invalid');
    const left = Math.min(100, ((item.address - 1) / DMX_UNIVERSE_SIZE) * 100);
    const width = Math.min(100 - left, (item.footprint / DMX_UNIVERSE_SIZE) * 100);
    seg.style.left = `${left}%`;
    seg.style.width = `${Math.max(width, 0.6)}%`;
    if (item.name) seg.title = `${item.name} @ ${item.address} (${item.footprint} ch)`;
    bar.appendChild(seg);
    used += item.footprint;
    if (!item.valid) anyInvalid = true;
  }
  head.appendChild(bar);

  const count = document.createElement('span');
  count.className = 'cm-occ-count' + (anyInvalid ? ' cm-occ-over' : '');
  count.textContent = `${used}/${DMX_UNIVERSE_SIZE}`;
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

  row.appendChild(renderChain(controller, port, layout));
  row.appendChild(renderPortActions(controller, port, layout, isEffectsPort, isPicking));
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
      chip.textContent = `⌷ gap ${item.entry.gap}`;
      chip.title = `Reserved ${item.entry.gap} channel(s) at ${item.address} — click to edit width`;
      chip.onclick = () => {
        const next = parseInt(window.prompt(`Gap width (channels):`, item.entry.gap), 10);
        if (Number.isInteger(next) && next >= 1) {
          mutate(null, () => { item.entry.gap = next; });
        }
      };
    } else if (isPinnedEntry(item.entry)) {
      chip.classList.add('cm-chip-pinned');
      if (!item.valid) chip.classList.add('cm-chip-invalid');
      const addr = document.createElement('span');
      addr.className = 'cm-chip-addr';
      addr.textContent = `📌${item.entry.at}`;
      chip.appendChild(addr);
      chip.appendChild(document.createTextNode(item.name));
      chip.title = `${item.name} pinned at U${EFFECTS_UNIVERSE}:${item.entry.at} ` +
        '(config.yaml global_effects)';
    } else {
      if (!item.valid) chip.classList.add('cm-chip-invalid');
      const addr = document.createElement('span');
      addr.className = 'cm-chip-addr';
      addr.textContent = item.valid ? String(item.address) : '✗';
      chip.appendChild(addr);
      chip.appendChild(document.createTextNode(item.name));
      chip.title = item.valid
        ? `${item.name} — U${port.universe}:${item.address} (${item.footprint} ch). ` +
          'Click to select in 3D, drag to reorder/move.'
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
  if (!srcPort || !Number.isInteger(src.index) || src.index >= srcPort.chain.length) return;

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
    gapBtn.title = 'Reserve channels mid-chain (a fixture not in the sim, or headroom)';
    gapBtn.onclick = () => {
      const width = parseInt(window.prompt('Gap width (channels):', '10'), 10);
      if (Number.isInteger(width) && width >= 1) {
        mutate(null, () => { port.chain.push({ gap: width }); });
      }
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
  let rejected = [];
  let added = [];
  ({ added, rejected } = appendFixtures(registry(), port, names));
  recomputeAndMark();
  renderIfOpen();
  if (rejected.length > 0) {
    // Loud per docs/33: name them and where they live — never silently
    // skipped, never silently moved.
    showToast(`Rejected (already mapped): ${rejected.map(r => `${r.name} → ${r.where}`).join(', ')}`,
      { error: true, undoSnapshot: added.length > 0 ? snapshot : null });
  } else if (added.length > 0) {
    showToast(`Added ${added.length} to ${controller.name} · Port ${port.port}`,
      { undoSnapshot: snapshot });
  }
}

// ── Unmapped tray ───────────────────────────────────────────────────────

function renderTray(unmapped, proj) {
  const tray = document.createElement('div');
  tray.className = 'cm-tray' + (pickTarget ? ' cm-tray-picking' : '');

  const reg = registry();
  let pickController = null;
  let pickPort = null;
  if (pickTarget) {
    pickController = reg.controllers.find(c => c.id === pickTarget.controllerId) || null;
    pickPort = pickController &&
      (pickController.ports.find(p => p.port === pickTarget.portNum) || null);
    if (!pickPort) pickTarget = null;
  }

  const head = document.createElement('div');
  head.className = 'cm-tray-head';
  const title = document.createElement('span');
  title.className = 'cm-tray-title';
  if (pickPort) {
    const layout = proj.portLayouts.get(`${pickController.id}:${pickPort.port}`) || [];
    let nextCh = pickPort.startAddress;
    for (const item of layout) {
      if (item.footprint > 0) nextCh = Math.max(nextCh, item.address + item.footprint);
    }
    title.textContent = `adding to ${pickController.name} · Port ${pickPort.port} — next: ch ${nextCh}`;
  } else {
    title.textContent = `Unmapped fixtures (${unmapped.length})`;
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
    for (const name of unmappedNames()) {
      const config = byName.get(name);
      const isEffect = isGlobalEffect((config && (config.fixtureType || config.type)) || '');
      // Pick mode filters by port kind: effects ports take only effects,
      // normal ports never take effects (they could only project unpatched).
      if (pickPort && (pickingEffects ? !isEffect : isEffect)) continue;
      if (needle &&
          !name.toLowerCase().includes(needle) &&
          !String((config && config.group) || '').toLowerCase().includes(needle)) continue;

      const chip = document.createElement('span');
      chip.className = 'cm-tray-chip';
      chip.textContent = (isEffect ? '✨ ' : '▪ ') + name;
      chip.title = pickPort
        ? `Click to append to ${pickController.name} · Port ${pickPort.port}`
        : `${name}${config && config.group ? ` (${config.group})` : ''} — click to locate in 3D`;
      chip.onmouseenter = () => flashFixture(name, true);
      chip.onmouseleave = () => flashFixture(name, false);
      chip.onclick = () => {
        if (pickPort) {
          flashFixture(name, false);
          selectFixtureIn3D(name);
          if (pickingEffects) {
            const pin = pins()[(config && (config.fixtureType || config.type)) || ''];
            mutate(null, () => {
              pickPort.chain.push({ fixture: name, at: pin ? pin.address : 0 });
            });
          } else {
            addNamesToPort(pickController, pickPort, [name]);
          }
        } else {
          selectFixtureIn3D(name);
        }
      };
      chips.appendChild(chip);
      shown++;
    }
    if (shown === 0) {
      const done = document.createElement('div');
      done.className = 'cm-fully-patched';
      done.textContent = unmapped.length === 0
        ? '✓ every fixture is mapped'
        : '(no matches)';
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
      addController(registry(), { name, ip: ipInput.value.trim() });
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

  // Live rename hook: gui_builder calls this when a fixture or its
  // clone changes name, so a rename can never orphan a chain entry.
  window.controllerRegistryRenameFixture = (oldName, newName) => {
    if (renameFixtureInChains(registry(), oldName, newName)) {
      recomputeAndMark();
      renderIfOpen();
    }
  };

  window.toggleControllerMapPanel = () => {
    panelEl.classList.toggle('hidden');
    if (!panelEl.classList.contains('hidden')) {
      pickTarget = null;
      render();
    } else {
      dismissToast();
    }
  };
}
