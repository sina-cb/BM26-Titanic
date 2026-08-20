/**
 * natural_sort.js — the ONE numeric-aware name comparator for the sim UI.
 *
 * Every generated fixture in this project is named `"<group> <n>"` in chain
 * order (`generator_chain_order.js` `emitInChainOrder`), so a plain
 * lexicographic compare sorts `"Left Back Wall 10"` BEFORE
 * `"Left Back Wall 2"` — a list that reads in an order no other surface
 * agrees with. This was already a real defect once, in the pixel-map lanes
 * view (report 20260725_44 §2, D1). `numeric: true` compares digit runs as
 * NUMBERS, so names stack 1, 2, … 9, 10, 11 for any group of ten or more.
 *
 * ONE comparator, shared — a second bespoke copy is how two lists that both
 * claim to be "sorted by name" end up disagreeing.
 *
 * Speed matters (operator constraint on the mapping pane, 2026-07-29):
 * `String.prototype.localeCompare(a, undefined, opts)` builds a fresh
 * collator on EVERY call, which dominates the cost of sorting a few hundred
 * names. A single `Intl.Collator` instance, built once at module load and
 * reused, is the fast path — same ordering, a fraction of the work.
 */

// Built once. `numeric: true` is the whole point; sensitivity is left at the
// default ('variant') so the comparator is a TOTAL order — case- and
// accent-distinct names never compare equal, which keeps sorts stable and
// deterministic across engines.
const COLLATOR = new Intl.Collator(undefined, { numeric: true });

/**
 * Natural (numeric-aware) comparison of two names.
 * Null/undefined sort as the empty string rather than throwing — these feed
 * UI lists, and one malformed entry must not take the whole panel down.
 *
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {number} <0, 0, >0
 */
export function compareNatural(a, b) {
  return COLLATOR.compare(a || '', b || '');
}

/**
 * A NEW array of the given names in natural order. Never sorts in place —
 * the callers hand in arrays owned by the scene/registry.
 *
 * @param {Array<string>} names
 * @returns {Array<string>}
 */
export function sortNamesNatural(names) {
  return [...names].sort(compareNatural);
}

/**
 * A NEW array of the given items in natural order of a derived name. This is
 * the DISPLAY-ORDER helper: every menu list that renders "sorted by name" over
 * objects (fixtures, traces, strands) uses it, so no caller ever sorts a
 * scene-owned array in place — the underlying data order (chain order, patch
 * order, YAML serialization order) is untouched.
 *
 * `nameOf` is required and must be a function: a missing accessor would sort
 * everything as the empty string and silently produce a list in an arbitrary
 * order, which is exactly the kind of quiet wrong answer the codex forbids.
 *
 * @param {Array<*>} items
 * @param {function(*): (string|null|undefined)} nameOf
 * @returns {Array<*>} a new array; `items` is never mutated
 */
export function sortByNameNatural(items, nameOf) {
  if (typeof nameOf !== 'function') {
    throw new Error('[natural_sort] sortByNameNatural: nameOf must be a function');
  }
  return [...items].sort((a, b) => compareNatural(nameOf(a), nameOf(b)));
}
