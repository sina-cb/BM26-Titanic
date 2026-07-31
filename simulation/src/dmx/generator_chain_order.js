/**
 * generator_chain_order.js — pure chain-order (split) math for DMX trace
 * generators.
 *
 * A trace lays its fixtures out along a path: path position 1 is the green
 * start handle, position N the red end handle. Physical wiring rarely walks
 * that path in that direction — a daisy chain can enter mid-run, sweep to the
 * end, then double back. `trace.chainSplits` lets the operator declare the
 * WIRING walk as a list of inclusive path-position ranges:
 *
 *   chainSplits: [ {from:4,to:5}, {from:3,to:2}, {from:1,to:1} ]
 *   → order = [4, 5, 3, 2, 1]
 *
 * `order[j]` is the PATH POSITION that receives fixture NUMBER j+1. So
 * `<group> 1` is the first light on the cable, `<group> 2` the second, and so
 * on — fixture number = position in the physical daisy chain (the DMX-tech
 * convention), NOT position along the drawn path.
 *
 * ── SEMANTIC CAVEAT (design report 20260725_41 §8) ─────────────────────────
 * Applying splits CHANGES WHAT A FIXTURE NUMBER MEANS in the 3D scene: it
 * becomes chain order instead of path order. That is deliberate — it is what
 * makes an already-mapped generator re-land its sticky-by-name DMX addresses
 * on the wiring-true lights after one Regenerate — but it is a semantic the
 * operator must consciously ratify. Callers MUST say so out loud before
 * renumbering a mapped group.
 *
 * ── NAMING HAZARD ─────────────────────────────────────────────────────────
 * `trace.splits` is a DIFFERENT, unrelated field: an integer 1..4 owned by
 * `trace_chains.js` (design 20260724_32) that splits a CIRCLE into separate
 * chain GROUPS. This module owns `trace.chainSplits` (an array). The two must
 * never be conflated.
 *
 * ── CONTRACT ──────────────────────────────────────────────────────────────
 * • Absent / null `chainSplits` → identity order [1..count]: byte-identical
 *   generation to a scene that never heard of this feature.
 * • An empty array is INVALID, never "same as absent" — an operator who
 *   deleted every split declared nothing, and silently inventing identity
 *   order for him is a fallback (codex P0).
 * • Splits must cover 1..count EXACTLY ONCE. Overlap, gap, out-of-range and
 *   non-integer endpoints are all refused by name. No auto-repair, no
 *   clamping, no stretching to a changed count.
 *
 * Pure module: no DOM / window / three.js. Fail-loud on every invalid input.
 */

const COVER_LIST_LIMIT = 8; // uncovered positions listed before eliding

// ── Internal helpers ────────────────────────────────────────────────────────

/** count is generator geometry, not operator free-text: a bad one is a bug. */
function _requireCount(count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(
      `generator_chain_order: count must be an integer >= 1 (got ${JSON.stringify(count)})`,
    );
  }
  return count;
}

/** Absent means "identity order" — the only value that is not a declaration. */
function _isAbsent(splits) {
  return splits === undefined || splits === null;
}

function _fmtSet(values) {
  const shown = values.slice(0, COVER_LIST_LIMIT).join(', ');
  const rest = values.length > COVER_LIST_LIMIT
    ? `, … and ${values.length - COVER_LIST_LIMIT} more`
    : '';
  return `{${shown}${rest}}`;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Well-formedness of a `chainSplits` list against a fixture count.
 *
 * The ONE validity function — the card, the generator, the count guard and
 * (re-stated independently) the parity validator all answer to this rule.
 *
 * @param {Array<{from:number,to:number}>|null|undefined} splits
 * @param {number} count  fixtures on the trace (integer >= 1)
 * @returns {string|null} null when valid; otherwise a message naming the
 *   exact defect (operator-facing — it is shown verbatim in the card/alert).
 */
export function chainSplitsError(splits, count) {
  _requireCount(count);
  if (_isAbsent(splits)) return null;

  if (!Array.isArray(splits)) {
    return `chainSplits must be a list of {from, to} ranges (got ${typeof splits})`;
  }
  if (splits.length === 0) {
    return 'chainSplits: [] — declare full coverage or remove the field';
  }

  // Pass 1: endpoint shape + range. Reported before coverage so the operator
  // fixes the obvious typo rather than reading a confusing coverage report.
  for (let s = 0; s < splits.length; s++) {
    const split = splits[s];
    if (split === null || typeof split !== 'object' || Array.isArray(split)) {
      return `split ${s + 1}: expected a {from, to} object (got ${
        split === null ? 'null' : Array.isArray(split) ? 'array' : typeof split})`;
    }
    for (const key of ['from', 'to']) {
      const v = split[key];
      if (!Number.isInteger(v)) {
        return `split ${s + 1}: ${key}=${JSON.stringify(v)} is not an integer`;
      }
      if (v < 1 || v > count) {
        return `split ${s + 1}: ${key}=${v} outside 1..${count}`;
      }
    }
  }

  // Pass 2: exact cover of 1..count.
  const coveredBy = new Map(); // position → 1-based split number
  for (let s = 0; s < splits.length; s++) {
    const { from, to } = splits[s];
    const step = from <= to ? 1 : -1;
    for (let p = from; ; p += step) {
      if (coveredBy.has(p)) {
        const first = coveredBy.get(p);
        return first === s + 1
          ? `position ${p} covered twice (split ${first} covers it more than once)`
          : `position ${p} covered twice (splits ${first} and ${s + 1})`;
      }
      coveredBy.set(p, s + 1);
      if (p === to) break;
    }
  }

  const missing = [];
  for (let p = 1; p <= count; p++) if (!coveredBy.has(p)) missing.push(p);
  if (missing.length > 0) {
    return `positions ${_fmtSet(missing)} not covered by any split ` +
      `(splits must cover 1..${count} exactly once)`;
  }

  return null;
}

/**
 * Expand splits into the emission order.
 *
 * THROWS on invalid splits — it is never called blind: every caller checks
 * `chainSplitsError` first and refuses loudly. A throw here means a caller
 * skipped the gate, which is a bug, not an operator mistake.
 *
 * @param {Array<{from:number,to:number}>|null|undefined} splits
 * @param {number} count
 * @returns {number[]} `order[j]` = the 1-based PATH POSITION that receives
 *   fixture NUMBER j+1. Length always === count.
 */
export function expandChainOrder(splits, count) {
  _requireCount(count);
  if (_isAbsent(splits)) {
    const identity = [];
    for (let p = 1; p <= count; p++) identity.push(p);
    return identity;
  }

  const err = chainSplitsError(splits, count);
  if (err) {
    throw new Error(`generator_chain_order: refusing to expand invalid chainSplits — ${err}`);
  }

  const order = [];
  for (const { from, to } of splits) {
    const step = from <= to ? 1 : -1;
    for (let p = from; ; p += step) {
      order.push(p);
      if (p === to) break;
    }
  }
  return order;
}

/**
 * One-line status string for the generator card's read-only Order row.
 * THROWS on invalid splits (the card shows `chainSplitsError` instead).
 *
 *   absent        → "1..5 (path order)"
 *   full reverse  → "5→1 (reversed)"
 *   general       → "4→5, 3→2, 1 · covers 1–5 ✓"
 *
 * @param {Array<{from:number,to:number}>|null|undefined} splits
 * @param {number} count
 * @returns {string}
 */
export function describeChainOrder(splits, count) {
  _requireCount(count);
  if (_isAbsent(splits)) return `1..${count} (path order)`;

  const err = chainSplitsError(splits, count);
  if (err) {
    throw new Error(`generator_chain_order: refusing to describe invalid chainSplits — ${err}`);
  }
  if (isFullReverse(splits, count)) return `${count}→1 (reversed)`;

  const parts = splits.map(({ from, to }) => (from === to ? `${from}` : `${from}→${to}`));
  return `${parts.join(', ')} · covers 1–${count} ✓`;
}

/**
 * Assign fixture NUMBERS to per-path-position records and return them in
 * emission (chain) order — the seam the generator pushes into `parLights`.
 *
 * `pointData[p-1]` is the record built for path position p (world position +
 * aim rotations + light defaults), computed in PATH order so the aim math is
 * untouched by any renumbering. This stamps `record.name` with
 * `` `${groupName} ${j+1}` `` for the j-th record in chain order and hands the
 * list back in that order.
 *
 * The NAME SET is always `{groupName 1 … groupName N}` whatever the splits
 * are — that invariant is what keeps the generator's survivor contract
 * (sticky-by-name DMX addresses) and its count-shrink casualty logic working
 * unchanged.
 *
 * Records are the caller's own freshly built objects and ARE mutated (writing
 * the name is the job). Nothing else on them is touched.
 *
 * @param {Array<{name:string}>} pointData  one record per path position, in path order
 * @param {Array<{from:number,to:number}>|null|undefined} splits
 * @param {string} groupName  non-empty generator group name
 * @returns {Array<{name:string}>} the same records, in chain order, named
 */
export function emitInChainOrder(pointData, splits, groupName) {
  if (!Array.isArray(pointData)) {
    throw new Error(
      `generator_chain_order: pointData must be an array (got ${typeof pointData})`,
    );
  }
  if (typeof groupName !== 'string' || groupName.trim() === '') {
    // A blank base would name every fixture ' 1', ' 2', … and collide the
    // whole group with any other blank-named generator.
    throw new Error(
      `generator_chain_order: groupName must be a non-empty string (got ${JSON.stringify(groupName)})`,
    );
  }
  const order = expandChainOrder(splits, pointData.length);
  return order.map((pathPosition, j) => {
    const record = pointData[pathPosition - 1];
    if (record === null || typeof record !== 'object') {
      throw new Error(
        `generator_chain_order: pointData[${pathPosition - 1}] is not a record ` +
        `(got ${record === null ? 'null' : typeof record})`,
      );
    }
    record.name = `${groupName} ${j + 1}`;
    return record;
  });
}

/**
 * The splits list that reverses the whole chain — what the ⇄ Swap start/end
 * button writes. Swap is NOT a second mechanism: it is this one split.
 * @param {number} count
 * @returns {Array<{from:number,to:number}>}
 */
export function fullReverseSplits(count) {
  _requireCount(count);
  return [{ from: count, to: 1 }];
}

/**
 * True when `splits` is EXACTLY the full-reverse shape for `count` — so the
 * Swap button can recognize its own work and toggle back to path order.
 * Any hand-authored equivalent that is not literally one full-span reversed
 * split reads as false: the button only ever clears what it wrote.
 * @param {Array<{from:number,to:number}>|null|undefined} splits
 * @param {number} count
 * @returns {boolean}
 */
export function isFullReverse(splits, count) {
  _requireCount(count);
  if (!Array.isArray(splits) || splits.length !== 1) return false;
  const s = splits[0];
  if (s === null || typeof s !== 'object' || Array.isArray(s)) return false;
  return s.from === count && s.to === 1;
}
