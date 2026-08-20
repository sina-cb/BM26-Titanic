/**
 * group_lock.js — pure helpers for GROUP LOCK (rigid group moves) and the
 * LED-strand group master + display key.
 *
 * "Group lock" ties every fixture in a group together so the whole group moves
 * as one rigid body — moving ANY member (transform gizmo or numeric inputs)
 * translates/rotates every member by the same delta, preserving relative
 * offsets. The lock flag rides in the per-group override bag
 * (`params.groupOverrides[name].locked` for DMX/par groups,
 * `params.ledGroupOverrides[name].locked` for LED-strand groups).
 *
 * Pure module: no DOM, no THREE, no I/O — unit-testable under `node --test`.
 * Fail-loud (codex P0): callers pass real data; there are no silent fallbacks.
 */
import { resolveGroupOverride } from '../dmx/dmx_output_overrides.js';
import { TE_SIGN_TYPE_A, TE_SIGN_TYPE_B } from '../fixtures/te_sign_generator.js';

// The display bucket every ungrouped strand shares. Matches the label the LED
// Strands GUI shows and is the key its group master + lock write under.
export const UNGROUPED_LABEL = 'Ungrouped';

/**
 * Display-group bucket for an LED strand: its trimmed named group, else the
 * "Ungrouped" catch-all. The SINGLE key the GUI group master and the exporter's
 * direct-paint scale agree on — keeping them in one function guarantees they
 * never diverge.
 * @param {Object} strand
 * @returns {string}
 */
export function ledDisplayGroup(strand) {
  const g = strand && typeof strand.group === 'string' ? strand.group.trim() : '';
  return g || UNGROUPED_LABEL;
}

/**
 * A group is locked when its override bag carries `locked === true`.
 * @param {Object|null|undefined} overrides — { [group]: { ..., locked } }
 * @param {string|undefined} groupName
 * @returns {boolean}
 */
export function isGroupLocked(overrides, groupName) {
  const g = (overrides && groupName) ? overrides[groupName] : null;
  return !!(g && g.locked === true);
}

/**
 * Indices of every par-fixture config whose group === groupName (a missing
 * group counts as 'Default', matching renderParGUI's bucketing).
 * @param {Array<Object>} configs — params.parLights
 * @param {string} groupName
 * @returns {number[]}
 */
export function parGroupMemberIndices(configs, groupName) {
  const out = [];
  if (!Array.isArray(configs)) return out;
  for (let i = 0; i < configs.length; i++) {
    const c = configs[i];
    if (!c) continue;
    if ((c.group || 'Default') === groupName) out.push(i);
  }
  return out;
}

/**
 * Indices of every strand whose display group === groupName.
 * @param {Array<Object>} strands — params.ledStrands
 * @param {string} groupName
 * @returns {number[]}
 */
export function strandGroupMemberIndices(strands, groupName) {
  const out = [];
  if (!Array.isArray(strands)) return out;
  for (let i = 0; i < strands.length; i++) {
    if (ledDisplayGroup(strands[i]) === groupName) out.push(i);
  }
  return out;
}

/**
 * True when every config in the set is a TE Sign half. A locked TE Sign group
 * must route rigid moves through applyTeSignPlacement (copies ONE transform into
 * both halves) so the A ≡ B identical-transform invariant can never drift.
 * @param {Array<Object>} configs
 * @returns {boolean}
 */
export function isTeSignConfigs(configs) {
  return Array.isArray(configs) && configs.length > 0 &&
    configs.every((c) => c && (c.fixtureType === TE_SIGN_TYPE_A || c.fixtureType === TE_SIGN_TYPE_B));
}

/**
 * The scalar (0–1) an LED-strand pixel's OUTPUT must be multiplied by, combining
 * the GLOBAL LED master (`params.strandsEnabled`) with the strand's per-group
 * master (On/Off + Brightness). Either OFF ⇒ 0 (BLACK); otherwise the group's
 * brightness fraction (1 when ≥100 %). This is the ONE authority every LED
 * output path derives from — the per-strand bulb/halo meshes (exporter apply
 * closure + static preview), the global instanced-dot flush, the 2D Pixel Map
 * frame tap, and the sACN output map — so an OFF master or group is black on
 * EVERY path (the LED analogue of applyFixtureOutputOverrides for DMX).
 *
 * The global master is `false` only when explicitly disabled (mirrors the
 * `!== false` convention the GUI/scene use); any other value is enabled.
 * @param {boolean|undefined} strandsEnabled — params.strandsEnabled
 * @param {Object|null|undefined} overrides — params.ledGroupOverrides
 * @param {string} groupName — the strand's DISPLAY group (ledDisplayGroup key)
 * @returns {number} 0..1
 */
export function ledOutputScale(strandsEnabled, overrides, groupName) {
  if (strandsEnabled === false) return 0;
  const { enabled, brightness } = resolveGroupOverride(overrides, groupName);
  if (!enabled) return 0;
  if (brightness >= 100) return 1;
  return brightness / 100;
}

/**
 * Scale an RGB triple (each 0–1) by the combined LED master+group output scale
 * (ledOutputScale). Off (master or group) ⇒ black; ≥100 % ⇒ unchanged; else
 * linear. Used by the per-strand direct-paint (exporter apply closure) and the
 * static preview (led_strand.rebuildVisuals) so those meshes go black on the
 * SAME override the raw-color paths honor — one source of truth, no drift.
 * @param {boolean|undefined} strandsEnabled @param {Object|null|undefined} overrides
 * @param {string} groupName @param {number} r @param {number} g @param {number} b
 * @returns {[number, number, number]}
 */
export function scaleRgbForLedOutput(strandsEnabled, overrides, groupName, r, g, b) {
  const s = ledOutputScale(strandsEnabled, overrides, groupName);
  if (s >= 1) return [r, g, b];
  return [r * s, g * s, b * s];
}
