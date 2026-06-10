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
import { params, selectedFixtureIndices } from "../core/state.js";
import {
  reconcileGroupBits,
  renameGroup,
  addCustomView,
  setCustomViewBit,
  removeCustomView,
  listPixelGroups,
} from "../dmx/view_registry.js";
import { generatePixelMap } from "../dmx/pixelblaze_model_exporter.js";

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
}

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
      row.innerHTML = `<span class="vm-name" title="${group}">${group}</span>` +
        `<span class="vm-bit">${hex(bit)}</span>`;
      body.appendChild(row);
    }

    // Custom views
    const customTitle = document.createElement('div');
    customTitle.className = 'vm-section-title';
    customTitle.textContent = `CUSTOM VIEWS — ${reg.custom.length}`;
    body.appendChild(customTitle);

    for (const view of reg.custom) {
      body.appendChild(renderCustomView(reg, view));
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'vm-btn vm-add';
    addBtn.textContent = '+ New View';
    addBtn.onclick = () => {
      const name = prompt('View name (becomes MASK_* constant in patterns):');
      if (!name) return;
      try {
        addCustomView(reg, name);
        markChanged();
        render();
      } catch (err) {
        alert(err.message);
      }
    };
    body.appendChild(addBtn);

    const hint = document.createElement('div');
    hint.className = 'vm-hint';
    hint.textContent = 'Click fixtures (Shift = multi) then Assign. Saved to views.yaml + fixture masks; exported to <scene>.viewmasks.js with the model.';
    body.appendChild(hint);
  }

  function renderCustomView(reg, view) {
    const card = document.createElement('div');
    card.className = 'vm-card';

    // Row 1: name + bit (both editable)
    const row1 = document.createElement('div');
    row1.className = 'vm-row';
    const nameInp = document.createElement('input');
    nameInp.className = 'vm-input vm-name';
    nameInp.value = view.name;
    nameInp.title = 'View name';
    nameInp.onchange = () => {
      const next = nameInp.value.trim();
      if (next.length === 0 || reg.custom.some(v => v !== view && v.name === next)) {
        alert(next.length === 0 ? 'View name must not be empty' : `A view named '${next}' already exists`);
        nameInp.value = view.name;
        return;
      }
      view.name = next;
      markChanged();
    };
    const bitInp = document.createElement('input');
    bitInp.className = 'vm-input vm-bit';
    bitInp.value = hex(view.bit);
    bitInp.title = 'Mask bit (power of two). Patterns hardcoding this value must be updated if changed.';
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
      } catch (err) {
        alert(err.message);
        bitInp.value = hex(view.bit);
      }
    };
    row1.appendChild(nameInp);
    row1.appendChild(bitInp);
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
      };
      row2.appendChild(chip);
    }
    const groupSel = document.createElement('select');
    groupSel.className = 'vm-select';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '+ group…';
    groupSel.appendChild(placeholder);
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
      if (!confirm(`Delete view '${view.name}'? Its bit ${hex(view.bit)} is cleared from all fixtures.`)) return;
      for (const f of fixtureList()) {
        if (f) f.viewMask = (f.viewMask || 0) & ~view.bit;
      }
      removeCustomView(reg, view);
      markChanged();
      render();
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
