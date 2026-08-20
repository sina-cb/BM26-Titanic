/**
 * chain_order_visual.js — the PURE plan behind the 3D chain-order overlay.
 *
 * `generator_chain_order.js` answers "which fixture NUMBER lands on which path
 * position". This module answers the next question — "what does that look
 * like" — as plain data: which path positions each daisy-chain RUN walks, in
 * which direction, in which colour, where the cable JUMPS from one run to the
 * next, and which number belongs on which light.
 *
 * It is deliberately geometry-free. It never sees a Vector3, a scene or a
 * fixture: it emits 1-based PATH POSITIONS and lets `gui_builder.js` look up
 * the world/local points it already computes for the preview dots. That keeps
 * the whole ordering story unit-testable in Node while the THREE side stays a
 * thin "draw these indices" layer.
 *
 * ── WHAT AN OPERATOR READS OFF THE OVERLAY ────────────────────────────────
 *   • one COLOUR per split — the operator's 4→5 / 3→2 / 1 reads as three runs;
 *   • a comet ramp along each run, dim at the run's first light and bright at
 *     its last, so direction is legible even head-on where an arrowhead
 *     foreshortens to a dot;
 *   • arrowheads on every step for the same reason from the side;
 *   • a dashed grey JUMP where the cable leaves one run and enters the next —
 *     the chain is ONE cable, and the jumps are what make that obvious;
 *   • the post-renumber chain NUMBER floating over each light.
 *
 * The label is the INDEX ONLY — operator ruling, 2026-07-29: "I don't like the
 * names on the generator guides too messy, just the index is enough". A build
 * that put the full `"<group> <n>"` fixture name on every light was measured
 * at ~7.6× wider than tall per label and crowded a par ring into overlap. The
 * numbering is still pinned against `emitInChainOrder` in the tests, so what
 * the guide shows and what the fixture is called can never drift apart.
 *
 * ── FAIL LOUD ─────────────────────────────────────────────────────────────
 * Every entry point re-checks `chainSplitsError` and THROWS on invalid splits.
 * A half-drawn overlay of a broken chain would be worse than no overlay: it
 * would show the operator a wiring order that the generator refuses to build.
 * Callers gate on `chainSplitsError` first (the generator card already does —
 * it paints a red badge instead).
 *
 * Absent / null `chainSplits` is NOT an error: it is the identity chain, drawn
 * as one single run 1..count. That mirrors `expandChainOrder`'s contract.
 *
 * Pure module: no DOM / window / three.js, no allocation caches, no state.
 */
import { chainSplitsError, expandChainOrder } from './generator_chain_order.js';

/**
 * One colour per split, cycled. Chosen to stay legible on the dark sim theme
 * AND to stay clear of the colours the trace editor already speaks:
 * orange `#ff8800` (path wireframe), yellow `#ffff00` (selected path),
 * `#ffcc00` (aim handle + dashed aim line), green `#00ff88` (start handle),
 * red `#ff4400` (end handle), and the blue→green→red spacing gradient on the
 * preview dots. Cyan / magenta / violet / mint carry no existing meaning here,
 * so a chain run is never mistaken for a handle.
 */
export const CHAIN_RUN_COLORS = Object.freeze([
  '#00e5ff', // cyan
  '#ff2fd0', // magenta
  '#b47cff', // violet
  '#3cf0a0', // mint
  '#ff8fa3', // rose
  '#8ad4ff', // ice
]);

/** The dashed hop from the end of one run to the start of the next. */
export const CHAIN_JUMP_COLOR = '#9aa0aa';

/**
 * Comet floor: how much of a run's colour survives at its FIRST light. The
 * run then ramps to full brightness at its last light, so the bright end is
 * the downstream end. Not 0 — a run's start must still be visible.
 */
export const COMET_MIN_MIX = 0.25;

// ── Internal ────────────────────────────────────────────────────────────────

/** Splits absent means "identity chain", exactly as in generator_chain_order. */
function _isAbsent(splits) {
  return splits === undefined || splits === null;
}

/** Shared gate: every export refuses to describe a chain that cannot be built. */
function _requireValid(splits, count) {
  const err = chainSplitsError(splits, count);
  if (err) {
    throw new Error(
      `chain_order_visual: refusing to visualize invalid chainSplits — ${err}`,
    );
  }
}

/**
 * The inclusive path-position walk of one split, honouring `from > to`.
 * Endpoints are already range-checked by `chainSplitsError`.
 */
function _walk(from, to) {
  const step = from <= to ? 1 : -1;
  const positions = [];
  for (let p = from; ; p += step) {
    positions.push(p);
    if (p === to) break;
  }
  return positions;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * The colour of the n-th split, cycling the palette.
 * @param {number} splitIndex 0-based
 * @returns {string} `#rrggbb`
 */
export function chainRunColor(splitIndex) {
  if (!Number.isInteger(splitIndex) || splitIndex < 0) {
    throw new Error(
      `chain_order_visual: splitIndex must be an integer >= 0 (got ${JSON.stringify(splitIndex)})`,
    );
  }
  return CHAIN_RUN_COLORS[splitIndex % CHAIN_RUN_COLORS.length];
}

/**
 * The daisy-chain broken into its runs — one per split, in cable order.
 *
 * `pathPositions[k]` is the 1-based path position of the run's k-th light and
 * `numbers[k]` the fixture number that lands there. Numbers run 1..count
 * CONTINUOUSLY across runs (the chain does not restart at each split), so
 * `numbers` concatenated over all runs is always exactly `1..count`.
 *
 * @param {Array<{from:number,to:number}>|null|undefined} splits
 * @param {number} count fixtures on the trace
 * @returns {Array<{splitIndex:number, colorHex:string, reversed:boolean,
 *                  pathPositions:number[], numbers:number[]}>}
 */
export function buildChainRuns(splits, count) {
  _requireValid(splits, count);

  if (_isAbsent(splits)) {
    const identity = expandChainOrder(splits, count);
    return [{
      splitIndex: 0,
      colorHex: chainRunColor(0),
      reversed: false,
      pathPositions: identity,
      numbers: identity.slice(),
    }];
  }

  const runs = [];
  let nextNumber = 1;
  splits.forEach((split, splitIndex) => {
    const pathPositions = _walk(split.from, split.to);
    const numbers = pathPositions.map(() => nextNumber++);
    runs.push({
      splitIndex,
      colorHex: chainRunColor(splitIndex),
      reversed: split.from > split.to,
      pathPositions,
      numbers,
    });
  });
  return runs;
}

/**
 * The cable hops BETWEEN runs: fixture `fromNumber` is the last light of one
 * run and `toNumber` the first of the next, and they are physically adjacent
 * on the cable even though the drawn path jumps.
 *
 * @param {ReturnType<typeof buildChainRuns>} runs
 * @returns {Array<{fromPathPosition:number, toPathPosition:number,
 *                  fromNumber:number, toNumber:number}>} empty for one run
 */
export function chainJumpSegments(runs) {
  if (!Array.isArray(runs)) {
    throw new Error(`chain_order_visual: runs must be an array (got ${typeof runs})`);
  }
  const jumps = [];
  for (let r = 1; r < runs.length; r++) {
    const prev = runs[r - 1];
    const next = runs[r];
    jumps.push({
      fromPathPosition: prev.pathPositions[prev.pathPositions.length - 1],
      toPathPosition: next.pathPositions[0],
      fromNumber: prev.numbers[prev.numbers.length - 1],
      toNumber: next.numbers[0],
    });
  }
  return jumps;
}

/**
 * One label per fixture, IN CHAIN ORDER — what to write, where to hang it and
 * in which colour. `isRunStart` / `isRunEnd` let the renderer mark the lights
 * where the cable enters and leaves a run.
 *
 * `number` IS the label text (operator ruling — see the header): it is also
 * the `n` in the fixture's `"<group> n"` name, and the tests pin that against
 * `emitInChainOrder` so the guide and the fixture list can never disagree.
 *
 * @param {Array<{from:number,to:number}>|null|undefined} splits
 * @param {number} count
 * @returns {Array<{number:number, pathPosition:number, colorHex:string,
 *                  splitIndex:number, isRunStart:boolean, isRunEnd:boolean}>}
 */
export function chainLabelPlan(splits, count) {
  const runs = buildChainRuns(splits, count);
  const labels = [];
  for (const run of runs) {
    run.pathPositions.forEach((pathPosition, k) => {
      labels.push({
        number: run.numbers[k],
        pathPosition,
        colorHex: run.colorHex,
        splitIndex: run.splitIndex,
        isRunStart: k === 0,
        isRunEnd: k === run.pathPositions.length - 1,
      });
    });
  }
  return labels;
}

/**
 * Comet brightness at the `stepIndex`-th light of a run holding `stepCount`
 * lights: `COMET_MIN_MIX` at the first, 1 at the last, linear between. A
 * single-light run is drawn at full brightness — there is no direction to show.
 *
 * @param {number} stepIndex 0-based, < stepCount
 * @param {number} stepCount lights in the run (>= 1)
 * @returns {number} in [COMET_MIN_MIX, 1]
 */
export function cometMix(stepIndex, stepCount) {
  if (!Number.isInteger(stepCount) || stepCount < 1) {
    throw new Error(
      `chain_order_visual: stepCount must be an integer >= 1 (got ${JSON.stringify(stepCount)})`,
    );
  }
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= stepCount) {
    throw new Error(
      `chain_order_visual: stepIndex ${JSON.stringify(stepIndex)} outside 0..${stepCount - 1}`,
    );
  }
  if (stepCount === 1) return 1;
  return COMET_MIN_MIX + (1 - COMET_MIN_MIX) * (stepIndex / (stepCount - 1));
}
