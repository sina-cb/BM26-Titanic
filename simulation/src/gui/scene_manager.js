/**
 * scene_manager.js — Add / delete scenes from the HUD scene picker.
 *
 * Wires the ＋ and 🗑 buttons sitting next to #scene-select:
 *   - Add    → in-app prompt for a name, POST /create-scene, then navigate
 *              to ?scene=<new>. The save-server seeds a minimal
 *              scenes/<name>/scene_config.yaml and regenerates the manifest.
 *   - Delete → in-app confirm (NOT the native confirm(), so it matches the
 *              rest of the HUD), POST /delete-scene, then navigate to a
 *              still-existing scene.
 *
 * Both actions need the dev save-server, so they are gated on isStaticHost()
 * exactly like the pattern editor's add/delete — a static host (HTTPS, e.g.
 * GitHub Pages) has no backend to reach, so we hide the buttons rather than
 * fire impossible requests (codex P0: no fallbacks, no impossible calls).
 */

import { isStaticHost, logStaticHostSkip } from "../core/static_host.js";

const SAVE_URL = 'http://localhost:6970';
const MANIFEST_URL = './scenes/manifest.json';

let _overlay = null;

function ensureOverlay() {
  if (_overlay) return _overlay;
  const overlay = document.createElement('div');
  overlay.id = 'scene-modal-overlay';
  overlay.className = 'scene-modal-overlay hidden';

  const card = document.createElement('div');
  card.className = 'scene-modal-card';

  const title = document.createElement('div');
  title.className = 'scene-modal-title';

  const message = document.createElement('div');
  message.className = 'scene-modal-message';

  const input = document.createElement('input');
  input.className = 'scene-modal-input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;

  const actions = document.createElement('div');
  actions.className = 'scene-modal-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'scene-modal-btn scene-modal-cancel';
  cancelBtn.textContent = 'Cancel';
  const okBtn = document.createElement('button');
  okBtn.className = 'scene-modal-btn scene-modal-ok';
  okBtn.textContent = 'OK';
  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);

  card.appendChild(title);
  card.appendChild(message);
  card.appendChild(input);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  _overlay = overlay;
  return overlay;
}

/** True while a scene add/delete modal is open (drives the keyboard guard
 *  in interaction.js so sim shortcuts don't fire underneath it). */
export function isSceneModalOpen() {
  return !!_overlay && !_overlay.classList.contains('hidden');
}

/**
 * Show the themed modal. Resolves to the trimmed input string (when
 * withInput) or `true` on confirm, and `null` on cancel / Esc / backdrop.
 */
function showModal({ title, message = '', withInput = false, placeholder = '', okLabel = 'OK', danger = false }) {
  // Re-entrancy guard: the overlay and its listeners are a singleton, so a
  // second open while one is live would stack duplicate listeners and let a
  // single click/Enter resolve two flows. Ignore overlapping opens.
  if (isSceneModalOpen()) return Promise.resolve(null);
  const overlay = ensureOverlay();
  const titleEl = overlay.querySelector('.scene-modal-title');
  const msgEl = overlay.querySelector('.scene-modal-message');
  const input = overlay.querySelector('.scene-modal-input');
  const cancelBtn = overlay.querySelector('.scene-modal-cancel');
  const okBtn = overlay.querySelector('.scene-modal-ok');

  titleEl.textContent = title;
  msgEl.textContent = message;
  msgEl.classList.toggle('hidden', !message);
  input.classList.toggle('hidden', !withInput);
  input.value = '';
  input.placeholder = placeholder;
  okBtn.textContent = okLabel;
  okBtn.classList.toggle('scene-modal-danger', !!danger);
  cancelBtn.classList.toggle('hidden', false);

  overlay.classList.remove('hidden');
  if (withInput) setTimeout(() => input.focus(), 0);
  else setTimeout(() => okBtn.focus(), 0);

  return new Promise((resolve) => {
    function cleanup(result) {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('pointerdown', onBackdrop);
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    }
    function onOk() { cleanup(withInput ? input.value.trim() : true); }
    function onCancel() { cleanup(null); }
    function onBackdrop(e) { if (e.target === overlay) onCancel(); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); onOk(); }
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('pointerdown', onBackdrop);
    document.addEventListener('keydown', onKey, true);
  });
}

/** A bare informational modal (single OK button, no Cancel). */
function showAlert(title, message) {
  const overlay = ensureOverlay();
  const p = showModal({ title, message, okLabel: 'OK' });
  // Hide the Cancel button for a pure alert.
  overlay.querySelector('.scene-modal-cancel').classList.add('hidden');
  return p;
}

async function handleAdd() {
  const name = await showModal({
    title: 'Add scene',
    message: 'Name for the new scene (letters, numbers, _ or -):',
    withInput: true,
    placeholder: 'e.g. bow_deck',
    okLabel: 'Create',
  });
  if (!name) return;
  const safe = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '').replace(/^_+|_+$/g, '');
  if (!safe) {
    await showAlert('Invalid name', 'Use letters, numbers, _ or -.');
    return;
  }
  try {
    const resp = await fetch(`${SAVE_URL}/create-scene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: safe }),
    });
    if (resp.status === 409) {
      await showAlert('Already exists', `A scene named "${safe}" already exists.`);
      return;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json().catch(() => null);
    const scene = data && typeof data.scene === 'string' ? data.scene : '';
    if (!scene) throw new Error('Server did not return a scene name');
    const url = new URL(window.location.href);
    url.searchParams.set('scene', scene);
    window.location.href = url.toString();
  } catch (e) {
    console.error('[Scene] Create failed:', e);
    await showAlert('Create failed', String(e && e.message ? e.message : e));
  }
}

async function handleDelete() {
  const select = document.getElementById('scene-select');
  const scene = (select && select.value) || window.__activeScene;
  if (!scene) return;
  const ok = await showModal({
    title: 'Delete scene',
    message: `Delete scene "${scene}"? This removes its config, cameras, ` +
      `patches, views and controllers from disk. This cannot be undone.`,
    okLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    const resp = await fetch(`${SAVE_URL}/delete-scene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: scene }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    // Navigate away from the now-deleted scene. Pick a still-existing
    // target from the freshly regenerated manifest so we never reload into
    // a scene that no longer has a scene_config.yaml.
    const remaining = await fetch(`${MANIFEST_URL}?t=${Date.now()}`)
      .then(r => (r.ok ? r.json() : []))
      .catch(() => []);
    const url = new URL(window.location.href);
    if (remaining.includes('titanic')) {
      url.searchParams.delete('scene');
    } else if (remaining.length) {
      url.searchParams.set('scene', remaining[0]);
    } else {
      url.searchParams.delete('scene');
    }
    window.location.href = url.toString();
  } catch (e) {
    console.error('[Scene] Delete failed:', e);
    await showAlert('Delete failed', String(e && e.message ? e.message : e));
  }
}

/** Wire the HUD add/delete scene buttons. Safe to call once on boot. */
export function setupSceneManager() {
  const addBtn = document.getElementById('scene-add-btn');
  const delBtn = document.getElementById('scene-del-btn');
  if (!addBtn || !delBtn) return;

  // Scene mutation needs the dev save-server (port 6970); a static host
  // can't reach it, so hide the controls instead of offering dead buttons.
  if (isStaticHost()) {
    logStaticHostSkip('scene add/delete (port 6970)');
    addBtn.style.display = 'none';
    delBtn.style.display = 'none';
    return;
  }

  addBtn.addEventListener('click', handleAdd);
  delBtn.addEventListener('click', handleDelete);
}
