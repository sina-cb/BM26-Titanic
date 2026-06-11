/**
 * view_masks_editor.js — floating "Views" panel.
 *
 * Manages the scene-owned view registry (views.yaml): shows the
 * auto-managed group→bit table and lets the operator create named
 * custom views, attach whole groups to them, and assign/unassign the
 * currently selected fixtures. Custom-view fixture membership is stored
 * in each fixture's `viewMask` bitfield (persisted in patches.yaml);
 * group membership is stored on the view itself. The model exporter
 * turns all of it into `<scene>.viewmasks.js` for the engine.
 */
import { params, selectedFixtureIndices } from '../core/state.js';
import {
  reconcileGroupBits,
  renameGroup,
  addCustomView,
  validateViewName,
  setCustomViewBit,
  removeCustomView,
  listPixelGroups,
  usedBitsMask,
  isEffectsOnlyFixture,
} from '../dmx/view_registry.js';
import { generatePixelMap } from '../dmx/pixelblaze_model_exporter.js';

window.__activePreviewView = null;

function fixtureList() {
  return (params.dmxFixtures && params.dmxFixtures.length > 0) ? params.dmxFixtures : params.parLights;
}

// Group names from the CURRENT exported-pixel universe — the same set
// the engine validates against. Empty while fixtures are mid-rebuild.
function pixelGroups() {
  return listPixelGroups(generatePixelMap().pixels);
}

function registry() {
  return window.__viewRegistry || { groupBits: {}, custom: [] };
}

function hex(bit) {
  return '0x' + bit.toString(16).toUpperCase();
}

function memberCount(view) {
  let n = 0;
  for (const f of fixtureList()) {
    if (f && ((f.viewMask || 0) & view.bit) !== 0) n++;
  }
  return n;
}

function markChanged() {
  if (window.debounceAutoSave) window.debounceAutoSave();
  if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('metadata');
  // Every views/membership mutation also syncs the per-fixture
  // "Views:" chip rows in the lil-gui metadata cards.
  refreshMetadataPanels();
}

// ── Custom DOM Modals ────────────────────────────────────────────────
function showCustomModal({ title, placeholder, value = '', onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'vm-modal-overlay';

  const card = document.createElement('div');
  card.className = 'vm-modal-card';

  const titleEl = document.createElement('div');
  titleEl.className = 'vm-modal-title';
  titleEl.textContent = title;
  card.appendChild(titleEl);

  const input = document.createElement('input');
  input.className = 'vm-modal-input';
  input.type = 'text';
  input.placeholder = placeholder;
  input.value = value;
  input.setAttribute('value', value);
  card.appendChild(input);

  const actions = document.createElement('div');
  actions.className = 'vm-modal-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'vm-modal-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => {
    overlay.remove();
  };

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'vm-modal-btn vm-modal-btn-primary';
  confirmBtn.textContent = 'OK';
  confirmBtn.onclick = () => {
    onConfirm(input.value);
    overlay.remove();
  };

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  input.focus();
  input.select();

  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      confirmBtn.click();
    } else if (e.key === 'Escape') {
      cancelBtn.click();
    }
  };
}

function showCustomConfirm({ title, text, onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'vm-modal-overlay';

  const card = document.createElement('div');
  card.className = 'vm-modal-card';

  const titleEl = document.createElement('div');
  titleEl.className = 'vm-modal-title';
  titleEl.textContent = title;
  card.appendChild(titleEl);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'vm-modal-body';
  bodyEl.textContent = text;
  card.appendChild(bodyEl);

  const actions = document.createElement('div');
  actions.className = 'vm-modal-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'vm-modal-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => {
    overlay.remove();
  };

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'vm-modal-btn vm-modal-btn-danger';
  confirmBtn.textContent = 'Delete';
  confirmBtn.onclick = () => {
    onConfirm();
    overlay.remove();
  };

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  confirmBtn.focus();

  overlay.onkeydown = (e) => {
    if (e.key === 'Escape') {
      cancelBtn.click();
    } else if (e.key === 'Enter') {
      confirmBtn.click();
    }
  };
}

// ── 3D View Isolation Preview ────────────────────────────────────────
export function applyViewMaskIsolation() {
  const activeView = window.__activePreviewView;
  let indicator = document.getElementById('vm-isolation-hud');

  if (activeView) {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'vm-isolation-hud';
      document.body.appendChild(indicator);
    }
    // Built with DOM nodes, not an HTML string: the view name is
    // operator free-text and must never be parsed as markup.
    indicator.replaceChildren();
    const label = document.createElement('span');
    label.textContent = '👁 VIEW ISOLATION ACTIVE: ';
    const strong = document.createElement('strong');
    strong.textContent = activeView.name;
    label.appendChild(strong);
    const clearBtn = document.createElement('button');
    clearBtn.className = 'vm-hud-clear';
    clearBtn.textContent = 'Exit Preview ✕';
    clearBtn.onclick = () => {
      window.__activePreviewView = null;
      applyViewMaskIsolation();
      window.refreshViewMasksPanel();
    };
    indicator.appendChild(label);
    indicator.appendChild(clearBtn);
    indicator.className = 'vm-isolation-hud-active';
  } else {
    if (indicator) {
      indicator.remove();
    }
  }

  // Compile list of all fixtures
  const list = [
    ...(window.parFixtures || []),
    ...(window.dmxSceneFixtures || []),
    ...(window.ledStrandFixtures || []),
    ...(window.icebergFixtures || [])
  ];

  list.forEach(f => {
    if (!f) return;

    // Effects fixtures (fog/haze/horn/fire) are infrastructure —
    // always visible, never isolated. Checked via the shared predicate:
    // configs carry the type under `type` OR `fixtureType`, and the
    // previous `config.type ===` check missed the latter, sweeping
    // foggers into isolation.
    if (isEffectsOnlyFixture(f.config)) {
      f.setVisibility(true);
      f._viewIsolated = false;
      return;
    }

    if (!activeView) {
      // Restore default visibility based on master/profile/params settings
      const isStrand = f.config.hasOwnProperty('startX');
      const isIceberg = f.config.hasOwnProperty('peakCount');

      if (isStrand) {
        f.setVisibility(params.strandsEnabled !== false);
      } else if (isIceberg) {
        f.setVisibility(params.icebergsEnabled !== false);
      } else {
        const masterEnabled = params.dmxEnabled !== false && params.parsEnabled !== false;
        f.setVisibility(masterEnabled, params.conesEnabled !== false);
      }
      // Clear isolation flag so light pool resumes normal operation
      f._viewIsolated = false;
      return;
    }

    // Isolate membership
    const isBitMember = ((f.config.viewMask || 0) & activeView.bit) !== 0;
    const isGroupMember = activeView.groups && activeView.groups.includes(f.config.group);
    const isMember = isBitMember || isGroupMember;

    if (isMember) {
      f.setVisibility(true, params.conesEnabled !== false);
      f._viewIsolated = false;
    } else {
      f.setVisibility(false, false);
      // Flag for the light pool to skip this fixture even though
      // group.visible may flicker during frame updates
      f._viewIsolated = true;
    }
  });
}

// ── Views Editor Setup ───────────────────────────────────────────────
export function setupViewMasksEditor() {
  const panel = document.getElementById('view-masks-panel');
  if (!panel) return;
  const body = document.getElementById('vm-body');
  const header = document.getElementById('vm-drag-handle');
  const collapseBtn = document.getElementById('vm-collapse-btn');

  // ── Drag handling (same pattern as the Pattern Editor) ─────────────
  let dragOff = null;
  header.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    const rect = panel.getBoundingClientRect();
    dragOff = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    header.setPointerCapture(e.pointerId);
  });
  header.addEventListener('pointermove', (e) => {
    if (!dragOff) return;
    panel.style.left = `${Math.max(0, e.clientX - dragOff.x)}px`;
    panel.style.top = `${Math.max(0, e.clientY - dragOff.y)}px`;
    panel.style.right = 'auto';
  });
  header.addEventListener('pointerup', () => { dragOff = null; });

  collapseBtn.onclick = () => panel.classList.toggle('collapsed');

  // ── Rendering ──────────────────────────────────────────────────────
  function render() {
    const reg = registry();
    body.innerHTML = '';

    // Group views (auto-managed, read-only here)
    const groupsTitle = document.createElement('div');
    groupsTitle.className = 'vm-section-title';
    groupsTitle.textContent = `GROUP VIEWS (auto) — ${Object.keys(reg.groupBits).length}`;
    body.appendChild(groupsTitle);

    for (const [group, bit] of Object.entries(reg.groupBits)) {
      const row = document.createElement('div');
      row.className = 'vm-row';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'vm-name';
      nameSpan.title = group;
      nameSpan.textContent = group;
      const bitSpan = document.createElement('span');
      bitSpan.className = 'vm-bit';
      bitSpan.textContent = hex(bit);
      row.appendChild(nameSpan);
      row.appendChild(bitSpan);
      body.appendChild(row);
    }

    // Custom views. Surface the remaining bit budget: vMask has 31
    // usable bits and titanic alone pins 30 groups — the operator must
    // see the ceiling coming, not discover it as a failed save.
    const usedMask = usedBitsMask(reg);
    let freeBits = 0;
    for (let b = 1; b <= 0x40000000; b *= 2) {
      if ((usedMask & b) === 0) freeBits++;
    }
    const customTitle = document.createElement('div');
    customTitle.className = 'vm-section-title';
    customTitle.textContent = `CUSTOM VIEWS — ${reg.custom.length} · ${freeBits} bit(s) free`;
    body.appendChild(customTitle);

    for (const view of reg.custom) {
      body.appendChild(renderCustomView(reg, view));
    }

    // Add buttons/toolbar at the bottom
    const addBtn = document.createElement('button');
    addBtn.className = 'vm-btn vm-add';
    addBtn.textContent = '+ New View';
    addBtn.onclick = () => {
      showCustomModal({
        title: 'Enter view name (becomes MASK_* constant):',
        placeholder: 'e.g. Chimneys',
        onConfirm: (name) => {
          const trimmed = String(name || '').trim();
          if (trimmed.length === 0) return;
          try {
            addCustomView(reg, trimmed);
            markChanged();
            render();
            refreshMetadataPanels();
          } catch (err) {
            showCustomModal({ title: 'Error', value: err.message, onConfirm: () => {} });
          }
        }
      });
    };
    body.appendChild(addBtn);

    // Save configuration button inside the Views panel
    const saveBtn = document.createElement('button');
    const isDirty = window.__sceneDirty || false;
    saveBtn.className = isDirty ? 'vm-btn vm-save vm-dirty' : 'vm-btn vm-save';
    saveBtn.textContent = isDirty ? '💾 Save Configuration *' : '💾 Save Configuration';
    saveBtn.title = isDirty ? 'Unsaved changes! Click to save configuration files.' : 'Configuration saved to disk.';
    saveBtn.onclick = () => {
      if (window.exportConfig) {
        window.exportConfig();
        setTimeout(() => render(), 400);
      }
    };
    body.appendChild(saveBtn);

    const hint = document.createElement('div');
    hint.className = 'vm-hint';
    hint.textContent = 'Click fixtures (Shift = multi) then Assign. Saved to views.yaml + fixture masks; exported to <scene>.viewmasks.js with the model.';
    body.appendChild(hint);
  }

  function renderCustomView(reg, view) {
    const card = document.createElement('div');
    card.className = 'vm-card';

    // Highlight card if isolated/previewing
    const isIsolated = window.__activePreviewView && window.__activePreviewView.bit === view.bit;
    if (isIsolated) {
      card.classList.add('vm-card-previewing');
    }

    // Row 1: name + bit (both editable) + preview eye toggle
    const row1 = document.createElement('div');
    row1.className = 'vm-row';

    const nameInp = document.createElement('input');
    nameInp.className = 'vm-input vm-name';
    nameInp.value = view.name;
    nameInp.setAttribute('value', view.name);
    nameInp.title = 'View name';
    nameInp.onchange = () => {
      const next = nameInp.value.trim();
      try {
        if (next.length === 0) throw new Error('View name must not be empty');
        // Full validation (charset, duplicates, MASK_* constant
        // collisions vs groups and other views) — a name rejected here
        // costs one retype; rejected at engine load it costs a dead
        // model on playa.
        validateViewName(reg, next, view);
      } catch (err) {
        showCustomModal({
          title: 'Invalid Name',
          value: err.message,
          onConfirm: () => {
            nameInp.value = view.name;
            nameInp.setAttribute('value', view.name);
          }
        });
        return;
      }
      view.name = next;
      nameInp.setAttribute('value', next);
      markChanged();
      render();
      refreshMetadataPanels();
    };

    const bitInp = document.createElement('input');
    bitInp.className = 'vm-input vm-bit';
    bitInp.value = hex(view.bit);
    bitInp.setAttribute('value', hex(view.bit));
    bitInp.title = 'Mask bit (power of two).';
    bitInp.onchange = () => {
      const parsed = parseInt(bitInp.value, bitInp.value.trim().toLowerCase().startsWith('0x') ? 16 : 10);
      try {
        const oldBit = setCustomViewBit(reg, view, parsed);
        if (oldBit !== view.bit) {
          // Migrate per-fixture membership to the new bit.
          for (const f of fixtureList()) {
            if (f && ((f.viewMask || 0) & oldBit) !== 0) {
              f.viewMask = ((f.viewMask || 0) & ~oldBit) | view.bit;
            }
          }
        }
        markChanged();
        render();
        refreshMetadataPanels();
      } catch (err) {
        showCustomModal({
          title: 'Invalid Bit',
          value: err.message,
          onConfirm: () => {
            bitInp.value = hex(view.bit);
            bitInp.setAttribute('value', hex(view.bit));
          }
        });
      }
    };

    // 3D Preview isolation button
    const prevBtn = document.createElement('button');
    prevBtn.className = isIsolated ? 'vm-btn-prev active' : 'vm-btn-prev';
    prevBtn.textContent = isIsolated ? '👁' : '👁‍🗨';
    prevBtn.title = isIsolated ? 'Clear preview isolation' : 'Preview/Isolate this view in 3D';
    prevBtn.onclick = () => {
      if (isIsolated) {
        window.__activePreviewView = null;
      } else {
        window.__activePreviewView = view;
      }
      applyViewMaskIsolation();
      render();
    };

    row1.appendChild(nameInp);
    row1.appendChild(bitInp);
    row1.appendChild(prevBtn);
    card.appendChild(row1);

    // Row 2: group membership chips + add-group dropdown
    const row2 = document.createElement('div');
    row2.className = 'vm-groups';
    for (const g of view.groups) {
      const chip = document.createElement('span');
      chip.className = 'vm-chip';
      chip.textContent = g + ' ✕';
      chip.title = 'Remove group from view';
      chip.onclick = () => {
        view.groups.splice(view.groups.indexOf(g), 1);
        markChanged();
        render();
        refreshMetadataPanels();
      };
      row2.appendChild(chip);
    }

    const groupSel = document.createElement('select');
    groupSel.className = 'vm-select';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '+ group…';
    groupSel.appendChild(placeholder);
    
    // Only groups that exist in the CURRENT pixel universe are
    // attachable — the engine validates sidecar views against exactly
    // that set and refuses the whole model on an unknown group, so a
    // free-text "custom group" here would be a delayed engine outage.
    for (const g of pixelGroups()) {
      if (view.groups.includes(g)) continue;
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      groupSel.appendChild(opt);
    }

    groupSel.onchange = () => {
      if (!groupSel.value) return;
      view.groups.push(groupSel.value);
      markChanged();
      render();
      refreshMetadataPanels();
    };
    row2.appendChild(groupSel);
    card.appendChild(row2);

    // Row 3: selection actions + member count + delete
    const row3 = document.createElement('div');
    row3.className = 'vm-actions';
    const count = document.createElement('span');
    count.className = 'vm-count';
    const refreshCount = () => {
      const n = memberCount(view);
      const sel = selectedFixtureIndices.size;
      count.textContent = `${n} fixture(s)${view.groups.length > 0 ? ` + ${view.groups.length} group(s)` : ''}` +
        (sel > 0 ? ` · ${sel} selected` : '');
    };
    refreshCount();

    const assignBtn = document.createElement('button');
    assignBtn.className = 'vm-btn';
    assignBtn.textContent = '✓ Assign sel.';
    assignBtn.title = 'Add the selected fixtures to this view';
    assignBtn.onclick = () => {
      const list = fixtureList();
      for (const i of selectedFixtureIndices) {
        if (list[i]) list[i].viewMask = (list[i].viewMask || 0) | view.bit;
      }
      // markChanged() already resyncs the lil-gui metadata chip rows.
      markChanged();
      refreshCount();
    };

    const unassignBtn = document.createElement('button');
    unassignBtn.className = 'vm-btn';
    unassignBtn.textContent = '✗ Unassign sel.';
    unassignBtn.title = 'Remove the selected fixtures from this view';
    unassignBtn.onclick = () => {
      const list = fixtureList();
      for (const i of selectedFixtureIndices) {
        if (list[i]) list[i].viewMask = (list[i].viewMask || 0) & ~view.bit;
      }
      markChanged();
      refreshCount();
    };

    const delBtn = document.createElement('button');
    delBtn.className = 'vm-btn vm-danger';
    delBtn.textContent = '🗑';
    delBtn.title = 'Delete view (clears its bit from all fixtures)';
    delBtn.onclick = () => {
      showCustomConfirm({
        title: 'Delete View',
        text: `Delete view '${view.name}'? Its bit ${hex(view.bit)} is cleared from all fixtures.`,
        onConfirm: () => {
          for (const f of fixtureList()) {
            if (f) f.viewMask = (f.viewMask || 0) & ~view.bit;
          }
          // Turn off isolation preview if we deleted the isolated view
          if (window.__activePreviewView && window.__activePreviewView.bit === view.bit) {
            window.__activePreviewView = null;
            applyViewMaskIsolation();
          }
          removeCustomView(reg, view);
          markChanged();
          render();
          refreshMetadataPanels();
        }
      });
    };

    row3.appendChild(count);
    row3.appendChild(assignBtn);
    row3.appendChild(unassignBtn);
    row3.appendChild(delBtn);
    card.appendChild(row3);
    return card;
  }

  // Re-render when the registry changes elsewhere (group rename, scene
  // mutations) or when the selection changes — interaction.js calls
  // window.refreshViewMasksPanel after selection updates.
  window.refreshViewMasksPanel = () => {
    if (!panel.classList.contains('hidden')) render();
  };
  window.viewRegistryRenameGroup = (oldName, newName) => {
    renameGroup(registry(), oldName, newName);
    window.refreshViewMasksPanel();
  };
  window.toggleViewMasksPanel = () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      // Reconcile only when the pixel map is available — an empty list
      // mid-rebuild must not wipe the registry's group bits.
      const groups = pixelGroups();
      if (groups.length > 0) reconcileGroupBits(registry(), groups);
      render();
    }
  };
}

function refreshMetadataPanels() {
  if (window.__metadataPanelRegistry) {
    window.__metadataPanelRegistry = window.__metadataPanelRegistry.filter(p => p.root && p.root.isConnected);
    window.__metadataPanelRegistry.forEach(p => {
      try {
        p.refresh();
      } catch (err) {
        // A broken card must not block the others, but never vanish
        // silently either (nodejs style §6).
        console.error('[Views] Metadata panel refresh failed:', err);
      }
    });
  }
}
// Global so the save path (gui_builder.exportConfig) can resync the
// per-fixture chip rows after a confirmed save.
window.refreshMetadataPanels = refreshMetadataPanels;
