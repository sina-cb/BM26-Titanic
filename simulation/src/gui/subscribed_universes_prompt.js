/**
 * subscribed_universes_prompt.js — the Yes / No / Cancel dialog that guards the
 * `📡 Subscribed Universes` field on every explicit save.
 *
 * Look and mechanics are the push flow's (led_discovery_panel.js slices S1/S2):
 * `vm-modal-overlay` + `vm-modal-card led-push-card`, a `led-push-warn` banner,
 * `led-push-subhead` section heads, one `led-push-diff-line` per change, and the
 * standard `vm-modal-actions` button row. No new modal framework, no new CSS.
 *
 * The dialog is deliberately BLOCKING and three-way, because the three answers
 * are genuinely different:
 *   Yes    — update the field, save (the field rides out on this same save).
 *   No     — save without touching the field (the operator knows something the
 *            registry does not; the decline is logged).
 *   Cancel — abort the save entirely; nothing is written anywhere.
 */

import { params, configTree } from '../core/state.js';
import {
  registryIsActive, computeProjection, computeLedProjection,
} from '../dmx/controller_registry.js';
import {
  SUBSCRIBED_UNIVERSES_KEY,
  SUBSCRIBED_UNIVERSES_LABEL,
  computeRequiredUniverses,
  syncSubscribedUniverses,
} from '../dmx/subscribed_universes.js';
import {
  computeLedStrandPatches,
  computeLedUniverseClaims,
} from '../dmx/led/led_patch_projection.js';
import { gatherAllConfigs } from '../dmx/auto_patcher.js';

// ── Small DOM helper (same shape as led_discovery_panel.js's) ───────────────

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ── Live inputs ────────────────────────────────────────────────────────────

/** Map<strandName, ledCount> — the LED projection's sizing input. */
function strandLedCounts() {
  const counts = new Map();
  for (const strand of params.ledStrands || []) {
    if (strand && typeof strand.name === 'string' && strand.name.length > 0) {
      counts.set(strand.name, strand.ledCount || 10);
    }
  }
  return counts;
}

function configsByName() {
  const map = new Map();
  for (const config of gatherAllConfigs(params)) {
    if (config && typeof config.name === 'string' && config.name.length > 0) {
      map.set(config.name, config);
    }
  }
  return map;
}

function pins() {
  return (window.serverConfig && window.serverConfig.global_effects) || {};
}

/**
 * The universe set the CURRENT configuration requires, from the same projections
 * the Controller Mapping panel renders. Fails loud: a registry that is missing
 * or malformed throws here rather than yielding a quietly-short set (a short set
 * is exactly the defect this module exists to close).
 *
 * @returns {Map<number, string[]>}
 */
export function requiredSubscribedUniverses() {
  const registry = window.__controllerRegistry;
  if (!registry) {
    throw new Error('[Universes] window.__controllerRegistry is not initialized — the required ' +
      'universe set cannot be derived, so the save cannot verify ' +
      `${SUBSCRIBED_UNIVERSES_LABEL}`);
  }
  const proj = computeProjection(registry, configsByName(), pins());
  let ledClaims = new Map();
  if (registryIsActive(registry)) {
    const counts = strandLedCounts();
    const bound = computeLedStrandPatches(registry, counts).fields;
    const generic = computeLedProjection(registry, counts).fields;
    const unbound = new Map();
    for (const [name, rec] of generic) if (!bound.has(name)) unbound.set(name, rec);
    ledClaims = computeLedUniverseClaims(bound, unbound);
  }
  return computeRequiredUniverses({
    controllers: registry.controllers || [],
    dmxUniverseMaps: proj.universeMaps,
    ledClaims,
    fixtures: [...(params.parLights || []), ...(params.dmxFixtures || [])],
    ledStrands: params.ledStrands || [],
  });
}

/**
 * Write the new field value into params, the config tree and the GUI control.
 *
 * `reconstructYAML()` (later in the same save) copies params → configTree, but
 * ONLY into leaves that already exist in the tree — so the leaf is written (and,
 * on a scene whose common.yaml predates the field, CREATED) here. A silent
 * "params updated, nothing persisted" is exactly the class of failure this whole
 * gate exists to remove.
 */
function applySubscribedUniverses(value) {
  params[SUBSCRIBED_UNIVERSES_KEY] = value;
  if (!configTree || !configTree.colorWave || typeof configTree.colorWave !== 'object') {
    throw new Error('[Universes] the loaded config tree has no `colorWave` section — ' +
      `${SUBSCRIBED_UNIVERSES_LABEL} has nowhere to persist, so the update was NOT applied`);
  }
  const node = configTree.colorWave[SUBSCRIBED_UNIVERSES_KEY];
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    node.value = value;
  } else {
    configTree.colorWave[SUBSCRIBED_UNIVERSES_KEY] = {
      value, label: SUBSCRIBED_UNIVERSES_LABEL,
    };
    console.warn(`[Universes] this scene's common.yaml carried no ${SUBSCRIBED_UNIVERSES_LABEL} ` +
      'entry — one was created so the value persists with this save.');
  }
  const ctrl = window._guiControllers && window._guiControllers[SUBSCRIBED_UNIVERSES_KEY];
  if (ctrl && typeof ctrl.updateDisplay === 'function') ctrl.updateDisplay();
}

// ── The dialog ─────────────────────────────────────────────────────────────

/**
 * Build and show the Yes / No / Cancel dialog. Resolves to the operator's
 * answer; Escape resolves 'cancel' (the safe answer — nothing written).
 *
 * @param {{update: Object, described: Object}} arg
 * @returns {Promise<'yes'|'no'|'cancel'>}
 */
export function showSubscribedUniversesDialog({ update, described }) {
  return new Promise((resolve) => {
    const overlay = el('div', 'vm-modal-overlay');
    const card = el('div', 'vm-modal-card led-push-card');
    overlay.appendChild(card);

    card.appendChild(el('div', 'vm-modal-title',
      `${SUBSCRIBED_UNIVERSES_LABEL} — ${update.missing.length} universe(s) missing`));

    card.appendChild(el('div', 'led-push-warn',
      'This configuration uses universes the sim is NOT subscribed to. The sACN receiver drops ' +
      'packets on an unsubscribed universe SILENTLY — no error, no warning — so those fixtures ' +
      'render dark while every other surface reports healthy. Updating the field now saves it ' +
      'with the rest of the scene.'));

    card.appendChild(el('div', 'led-push-warn',
      '✅ Takes effect IMMEDIATELY on save — no bridge restart. The save writes the field and then ' +
      'tells the running bridge to re-read it, so the new universes are subscribed on the spot. ' +
      'Watch the bridge console for "runtime-subscribed U…", then "First frame on U…". ' +
      'This list is also the accept-list the bridge starts from at its next boot.'));

    card.appendChild(el('div', 'led-push-subhead', 'Change'));
    const diff = el('div', 'led-push-diff');
    diff.appendChild(el('div', 'led-push-diff-line', described.headline));
    card.appendChild(diff);

    card.appendChild(el('div', 'led-push-subhead', 'Why each universe is needed'));
    const adds = el('div', 'led-push-diff');
    for (const line of described.additionLines) {
      adds.appendChild(el('div', 'led-push-diff-line', `+ ${line}`));
    }
    card.appendChild(adds);

    if (described.malformedLines.length) {
      const malformed = el('div', 'led-push-warn');
      malformed.appendChild(el('div', 'led-push-unhonorable-head',
        'The field contains token(s) the bridge does not read the way they look:'));
      for (const line of described.malformedLines) {
        malformed.appendChild(el('div', 'led-push-unhonorable-line', line));
      }
      card.appendChild(malformed);
    }

    if (described.extrasLine) {
      card.appendChild(el('div', 'led-push-diff-line', described.extrasLine));
    }

    const actions = el('div', 'vm-modal-actions');
    let settled = false;
    const answer = (choice) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(choice);
    };
    const cancelBtn = el('button', 'vm-modal-btn', 'Cancel save');
    cancelBtn.title = 'Abort the whole save — nothing is written.';
    cancelBtn.onclick = () => answer('cancel');
    const noBtn = el('button', 'vm-modal-btn', 'Save without updating');
    noBtn.title = `Save the scene and leave ${SUBSCRIBED_UNIVERSES_LABEL} exactly as it is.`;
    noBtn.onclick = () => answer('no');
    const yesBtn = el('button', 'vm-modal-btn vm-modal-btn-primary', 'Update + save');
    yesBtn.title = 'Add the missing universes to the field and save.';
    yesBtn.onclick = () => answer('yes');
    actions.appendChild(cancelBtn);
    actions.appendChild(noBtn);
    actions.appendChild(yesBtn);
    card.appendChild(actions);

    overlay.onkeydown = (e) => {
      if (e.key === 'Escape') answer('cancel');
      else if (e.key === 'Enter') answer('yes');
    };
    document.body.appendChild(overlay);
    yesBtn.focus();
  });
}

/**
 * The save-path entry point. Called at the TOP of exportConfig(), before
 * anything is written, so 'cancel' can still mean "nothing on disk".
 *
 * @param {{interactive?: boolean}} [options]
 * @returns {Promise<{proceed: boolean, choice: string, update: Object}>}
 */
export function checkSubscribedUniversesBeforeSave({ interactive = true } = {}) {
  return syncSubscribedUniverses({
    requiredUniverses: requiredSubscribedUniverses,
    currentValue: () => params[SUBSCRIBED_UNIVERSES_KEY],
    applyValue: applySubscribedUniverses,
    confirm: showSubscribedUniversesDialog,
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
    interactive,
  });
}
