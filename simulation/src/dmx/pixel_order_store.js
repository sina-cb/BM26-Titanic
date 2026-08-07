/**
 * pixel_order_store.js — the scene's per-fixture PIXEL ORDER store (Mechanism A,
 * design contract 20260806_174 §2).
 *
 * A generator-group member whose physical fixture is wired OPPOSITE to the model
 * carries one entry in a top-level, NAME-KEYED map in scene_config.yaml:
 *
 *   pixelOrder:
 *     Left Front Wall 1: reversed
 *
 * Why name-keyed and top-level: a generated fixture literal is destroyed and
 * recreated by every regeneration (`sweepGeneratedInstances`) and boot
 * regenerates every `generated: true` trace, so a field stored ON the fixture
 * would be wiped on every scene load. The store lives outside the fixture
 * literals — exactly the proven `groupOverrides` idiom (core/config.js load
 * intercept + prune-on-persist) — so it survives regeneration by construction.
 * The fixture NAME is the only identity a generated fixture has (renames of
 * generated fixtures are refused).
 *
 * ABSENCE = NORMAL is the DEFINED DEFAULT STATE, not a fallback: the UI writes
 * only `reversed` and deletes the key on normal. Anything that is neither
 * `normal` nor `reversed` (case-sensitive) is REFUSED loudly — never coerced,
 * never ignored (codex P0).
 *
 * Pure module: no DOM, no THREE, no window — unit-tested directly (mirrors
 * trace_group_rename.js).
 */

export const PIXEL_ORDER_NORMAL = 'normal';
export const PIXEL_ORDER_REVERSED = 'reversed';

// The one place the accepted vocabulary is written down.
const ACCEPTED_VALUES = new Set([PIXEL_ORDER_NORMAL, PIXEL_ORDER_REVERSED]);

/** Quote a value for an operator-facing message without hiding its type. */
function _quote(value) {
  if (typeof value === 'string') return `'${value}'`;
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return `${typeof value} ${String(value)}`;
}

/**
 * The single refusal message for a bad enum value — used by the exporter (throw)
 * and by the boot/save validation pass (console.error + toast), so the operator
 * reads the same words wherever the bad value surfaces.
 *
 * @param {string} name  fixture name the entry is keyed on
 * @param {*} value      the offending value, verbatim
 * @returns {string}
 */
export function pixelOrderValueRefusal(name, value) {
  return `[pixelOrder] Fixture '${name}' has an invalid pixel-order value ${_quote(value)} — ` +
    `edit scene_config.yaml pixelOrder: '${name}' must be '${PIXEL_ORDER_NORMAL}' or ` +
    `'${PIXEL_ORDER_REVERSED}' (lowercase), or delete the entry (absent = normal).`;
}

/**
 * The refusal for an entry aimed at a fixture that has only ONE pixel. Reversing
 * a 1-pixel fixture is meaningless; exporting an identity permutation instead
 * would hide the operator's mistake. The UI never offers the control on such a
 * fixture, so this is always a hand edit.
 *
 * @param {string} name
 * @param {number} pixelCount
 * @returns {string}
 */
export function pixelOrderSinglePixelRefusal(name, pixelCount) {
  return `[pixelOrder] Fixture '${name}' has ${pixelCount} pixel — a pixel-order flag is ` +
    'meaningless on a single-pixel fixture (pars). Refusing to export rather than ignoring ' +
    `it: delete the '${name}' entry from scene_config.yaml pixelOrder.`;
}

/**
 * Read ONE entry, strictly. Returns 'normal' | 'reversed'.
 * Throws on any other value — there is no coercion path (no `true`, no `1`, no
 * `REVERSED`).
 *
 * @param {object|null|undefined} store  params.pixelOrder
 * @param {string} name                  fixture name
 * @returns {string}
 */
export function pixelOrderFor(store, name) {
  if (!store || typeof store !== 'object') return PIXEL_ORDER_NORMAL;
  if (!Object.prototype.hasOwnProperty.call(store, name)) return PIXEL_ORDER_NORMAL;
  const value = store[name];
  if (value === undefined) return PIXEL_ORDER_NORMAL;
  if (!ACCEPTED_VALUES.has(value)) throw new Error(pixelOrderValueRefusal(name, value));
  return value;
}

/**
 * True when this fixture's wire order is reversed relative to the model.
 * Throws on an invalid stored value (see pixelOrderFor).
 *
 * @param {object|null|undefined} store
 * @param {string} name
 * @returns {boolean}
 */
export function isReversed(store, name) {
  return pixelOrderFor(store, name) === PIXEL_ORDER_REVERSED;
}

/**
 * The permutation P(j) = N-1-j. Used by the exporter seam to read a pixel's WIRE
 * ASSOCIATION (DMX channels / LED-bus patch entry) from the opposite slot while
 * geometry and localIndex stay at slot j.
 *
 * @param {number} j      slot index 0..count-1
 * @param {number} count  pixel count N
 * @returns {number}
 */
export function reverseIndex(j, count) {
  if (!Number.isInteger(j) || !Number.isInteger(count) || count < 1 || j < 0 || j >= count) {
    throw new Error(`[pixelOrder] reverseIndex(${j}, ${count}) is out of range — a pixel ` +
      'permutation must stay inside 0..N-1.');
  }
  return count - 1 - j;
}

/**
 * The exporter's per-pixel source slot: `j` when NORMAL, `N-1-j` when REVERSED.
 * One call site for the whole seam so DMX pixels and LED-bus pixels can never
 * disagree about which slot they read.
 *
 * @param {boolean} reversed
 * @param {number} j
 * @param {number} count
 * @returns {number}
 */
export function wireSlot(reversed, j, count) {
  return reversed ? reverseIndex(j, count) : j;
}

/**
 * Validate the whole store against the scene's live fixtures.
 *
 * - invalid enum value → THROW (loud refusal; the exporter aborts the save,
 *   the boot pass reports it without crashing the render).
 * - entry on a fixture with ≤ 1 pixel → THROW (same reason).
 * - entry naming NO live fixture → returned as `stale`, never thrown: stale
 *   entries are inert and throwing would brick saves after a legitimate manual
 *   deletion (design §2.2 / §2.7).
 *
 * @param {object|null|undefined} store
 * @param {Array<{name: string, pixelCount: number}>} fixtures live fixtures
 * @returns {{stale: string[], reversed: string[]}}
 */
export function validatePixelOrderStore(store, fixtures) {
  const result = { stale: [], reversed: [] };
  if (!store || typeof store !== 'object') return result;
  const counts = new Map();
  for (const f of fixtures || []) {
    if (f && typeof f.name === 'string') counts.set(f.name, f.pixelCount);
  }
  for (const name of Object.keys(store)) {
    // Throws on an invalid value — the whole store is refused, by name.
    const value = pixelOrderFor(store, name);
    if (!counts.has(name)) {
      result.stale.push(name);
      continue;
    }
    const pixelCount = counts.get(name);
    if (typeof pixelCount === 'number' && pixelCount <= 1) {
      throw new Error(pixelOrderSinglePixelRefusal(name, pixelCount));
    }
    if (value === PIXEL_ORDER_REVERSED) result.reversed.push(name);
  }
  return result;
}

/**
 * Carry a generator group's pixel-order entries across a group RENAME, moving
 * `<old> N` → `<new> N` for N = 1..count. Mutates the map in place. The twin of
 * carryTraceGroupOverride (trace_group_rename.js) — the rename validator already
 * refuses merging into an existing group, so collisions are impossible.
 *
 * @param {object|null|undefined} store
 * @param {string} oldName group name before the rename
 * @param {string} newName group name after the rename
 * @param {number} count   member count
 * @returns {Array<{from: string, to: string, value: string}>} what moved (for logging)
 */
export function carryPixelOrderEntries(store, oldName, newName, count) {
  const moved = [];
  if (!store || typeof store !== 'object' || oldName === newName) return moved;
  for (let n = 1; n <= count; n++) {
    const from = `${oldName} ${n}`;
    if (!Object.prototype.hasOwnProperty.call(store, from)) continue;
    const to = `${newName} ${n}`;
    const value = store[from];
    store[to] = value;
    delete store[from];
    moved.push({ from, to, value });
  }
  return moved;
}

/**
 * Clear the pixel-order entries of fixtures that a regeneration / group delete
 * just removed, and report what was cleared so the caller can WARN by name.
 *
 * Never silently keep (the entry would resurrect onto a brand-new physical light
 * on regrow) and never silently drop (the caller's warning IS the operator
 * notice the design demands, §2.3).
 *
 * @param {object|null|undefined} store
 * @param {string[]} casualtyNames names of the fixtures that went away
 * @returns {Array<{name: string, value: string}>} cleared entries
 */
export function clearCasualtyPixelOrder(store, casualtyNames) {
  const cleared = [];
  if (!store || typeof store !== 'object') return cleared;
  for (const name of casualtyNames || []) {
    if (typeof name !== 'string') continue;
    if (!Object.prototype.hasOwnProperty.call(store, name)) continue;
    cleared.push({ name, value: store[name] });
    delete store[name];
  }
  return cleared;
}

/** The operator-facing warning for a shrink/delete that cleared flags. */
export function casualtyClearMessage(groupLabel, clearedNames) {
  return `⚠ ${groupLabel}: count change removed fixture(s) carrying a REVERSED pixel-order ` +
    `flag — cleared: ${clearedNames.join(', ')}. If you grow this group again, re-verify ` +
    'pixel order with calibration pattern 71.';
}

/**
 * The REVERSED members of a named set, in the order given. Used by the Swap
 * start/end dialog to name the flags that are about to point at a different
 * physical light (design §2.5 — flags stay NAME-STUCK).
 *
 * @param {object|null|undefined} store
 * @param {string[]} names
 * @returns {string[]}
 */
export function reversedMembers(store, names) {
  const out = [];
  if (!store || typeof store !== 'object') return out;
  for (const name of names || []) {
    // A bad value must not be swallowed by a dialog helper either.
    if (pixelOrderFor(store, name) === PIXEL_ORDER_REVERSED) out.push(name);
  }
  return out;
}

/**
 * Return the copy that gets PERSISTED: only non-default entries survive, so a
 * scene with nothing reversed keeps a clean file (the pruneGroupOverrides rule).
 *
 * `normal` is the default state written down explicitly — dropped. A value that
 * is NEITHER of the two enum members is kept VERBATIM: the export refuses it and
 * aborts the save long before this runs, and silently deleting an operator's
 * hand edit would be a destructive guess.
 *
 * @param {object|null|undefined} store
 * @returns {object}
 */
export function prunePixelOrder(store) {
  const clean = {};
  if (!store || typeof store !== 'object') return clean;
  for (const name of Object.keys(store)) {
    const value = store[name];
    if (value === PIXEL_ORDER_NORMAL || value === undefined) continue;
    clean[name] = value;
  }
  return clean;
}
