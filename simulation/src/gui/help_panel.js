/**
 * help_panel.js — Keyboard-shortcuts help overlay + bottom-right hint.
 *
 * A single modal overlay (#help-panel-overlay) lists every shortcut from
 * shortcuts.js, grouped by category. It is opened with Ctrl+? (wired in
 * interaction.js), by clicking the always-present bottom-right hint
 * (#help-hint), and closed with Escape, the × button, the same Ctrl+?
 * toggle, or a click on the dim backdrop.
 *
 * DOM is built imperatively (same idiom as the other legacy panels) and
 * styled entirely through theme CSS variables in style.css.
 */

import { SHORTCUT_GROUPS } from './shortcuts.js';

let _overlay = null;
let _hint = null;

function buildKeyChips(keys) {
  const wrap = document.createElement('span');
  wrap.className = 'help-keys';
  keys.forEach((key, i) => {
    if (i > 0) {
      const plus = document.createElement('span');
      plus.className = 'help-key-plus';
      plus.textContent = '+';
      wrap.appendChild(plus);
    }
    const kbd = document.createElement('kbd');
    kbd.className = 'help-key';
    kbd.textContent = key;
    wrap.appendChild(kbd);
  });
  return wrap;
}

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'help-panel-overlay';
  overlay.className = 'hidden';
  // Backdrop click (outside the card) closes.
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) hideHelpPanel();
  });

  const card = document.createElement('div');
  card.id = 'help-panel-card';

  const header = document.createElement('div');
  header.className = 'help-panel-header';
  const title = document.createElement('span');
  title.className = 'help-panel-title';
  title.textContent = '⌨  KEYBOARD SHORTCUTS';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pe-btn';
  closeBtn.title = 'Close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', hideHelpPanel);
  header.appendChild(title);
  header.appendChild(closeBtn);
  card.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'help-panel-grid';
  for (const group of SHORTCUT_GROUPS) {
    const col = document.createElement('div');
    col.className = 'help-group';
    const heading = document.createElement('div');
    heading.className = 'help-group-title';
    heading.textContent = group.category;
    col.appendChild(heading);
    for (const item of group.items) {
      const row = document.createElement('div');
      row.className = 'help-row';
      row.appendChild(buildKeyChips(item.keys));
      const desc = document.createElement('span');
      desc.className = 'help-desc';
      desc.textContent = item.desc;
      row.appendChild(desc);
      col.appendChild(row);
    }
    grid.appendChild(col);
  }
  card.appendChild(grid);

  const footer = document.createElement('div');
  footer.className = 'help-panel-footer';
  footer.textContent = 'Press Ctrl+? or Esc to close';
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  return overlay;
}

function buildHint() {
  const hint = document.createElement('button');
  hint.id = 'help-hint';
  hint.title = 'Keyboard shortcuts (Ctrl+?)';
  const q = document.createElement('span');
  q.className = 'help-hint-mark';
  q.textContent = '?';
  const label = document.createElement('span');
  label.className = 'help-hint-label';
  label.textContent = 'Shortcuts';
  const combo = document.createElement('span');
  combo.className = 'help-hint-combo';
  combo.textContent = 'Ctrl+?';
  hint.appendChild(q);
  hint.appendChild(label);
  hint.appendChild(combo);
  hint.addEventListener('click', toggleHelpPanel);
  document.body.appendChild(hint);
  return hint;
}

export function isHelpPanelOpen() {
  return !!_overlay && !_overlay.classList.contains('hidden');
}

export function showHelpPanel() {
  if (!_overlay) return;
  _overlay.classList.remove('hidden');
}

export function hideHelpPanel() {
  if (!_overlay) return;
  _overlay.classList.add('hidden');
}

export function toggleHelpPanel() {
  if (isHelpPanelOpen()) hideHelpPanel();
  else showHelpPanel();
}

/** Build the overlay + hint once. Safe to call a single time on boot. */
export function setupHelpPanel() {
  if (_overlay) return;
  _overlay = buildOverlay();
  _hint = buildHint();
}
