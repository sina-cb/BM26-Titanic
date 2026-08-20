/**
 * trace_chains.js — pure circle-chain placement math for DMX circle traces.
 *
 * A circle trace can be split into 1..4 independent "chains", each becoming its
 * own group. This module owns the math that decides, for a given trace, how
 * many chains there are, what each chain is named, and where each chain's
 * fixtures land on the ring (local circle space, before the trace's group
 * transform is applied by the caller).
 *
 * Two public functions:
 *   • chainGroupNames(trace) -> string[]   (used by BOTH gui_builder and
 *     config.js — the re-stamp union of trace-generated group names).
 *   • chainPlan(trace)       -> ChainPlan[] (per-chain placement, consumed by
 *     generateGroupFromTrace to emit fixtures chain-major).
 *
 * ChainPlan = {
 *   suffix,     // 'L' | 'R' | 'Chain N' | null (single chain)
 *   groupName,  // the flat group name this chain's fixtures belong to
 *   count,      // fixtures in this chain
 *   angles,     // [deg…] absolute angle on the ring, for UI/preview/labels
 *   points,     // [{x, y:0, z}…] local circle-space positions — AUTHORITATIVE.
 * }
 *
 * ── Backward-compat contract (CRITICAL) ────────────────────────────────────
 * With `splits` absent or 1 the module returns a single chain whose `points`
 * are BYTE-IDENTICAL to today's circle-trace output. It replicates the exact
 * arithmetic of gui_builder's computeTraceBaseArclengths + buildTracePath:
 *   arcRad = arc·(π/180);  length = radius·arcRad;
 *   s = (i/denom)·length;  angle = length>1e-9 ? (s/length)·arcRad : 0;
 *   point = (cos·radius, 0, sin·radius)
 * (with `denom = isClosed ? count : max(1, count-1)`). The naive
 * `(i/denom)·arc` degree form is NOT bit-identical — the length round-trip
 * changes the last ULP — so the exact sequence above is preserved on purpose.
 * `points` (not `angles`) is authoritative: a radians→degrees→radians round
 * trip is not bit-stable, so callers must place fixtures from `points`.
 *
 * `points` is the base EVEN layout (no per-point offsets). splits=1 keeps the
 * caller's `pointOffsets` post-processing; splits>1 is an even-coverage
 * primitive with offsets disabled — see the design report 20260724_32 §3.2.
 *
 * Pure module: no DOM / window / three.js. Fail-loud on every invalid input —
 * no fallbacks, no silent clamping (the caller must fix the trace).
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const CLOSED_EPS = 1e-6; // full-360 wrap detection, matches gui_builder
const MIN_SPLITS = 1;
const MAX_SPLITS = 4;
const VALID_LAYOUTS = Object.freeze(['mirror', 'sequential']);

// ── Validation helpers (fail loud, no fallbacks) ────────────────────────────

const _isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function _requireObject(trace) {
  if (trace === null || typeof trace !== 'object') {
    throw new Error(
      `trace_chains: expected a trace object, got ${trace === null ? 'null' : typeof trace}`,
    );
  }
}

function _resolveGroupName(trace) {
  const g = trace.groupName;
  if (typeof g !== 'string' || g.trim() === '') {
    // A blank base would collide every chain onto ' L' / ' R' / ' Chain N'.
    throw new Error(
      `trace_chains: trace.groupName must be a non-empty string (got ${JSON.stringify(g)})`,
    );
  }
  return g;
}

function _resolveSplits(trace) {
  const splits = trace.splits === undefined || trace.splits === null ? 1 : trace.splits;
  if (!Number.isInteger(splits) || splits < MIN_SPLITS || splits > MAX_SPLITS) {
    throw new Error(
      `trace_chains: splits must be an integer ${MIN_SPLITS}..${MAX_SPLITS} ` +
        `(got ${JSON.stringify(trace.splits)})`,
    );
  }
  return splits;
}

function _resolveLayout(trace, splits) {
  const layout = trace.splitLayout === undefined || trace.splitLayout === null
    ? 'mirror'
    : trace.splitLayout;
  if (!VALID_LAYOUTS.includes(layout)) {
    throw new Error(
      `trace_chains: splitLayout must be one of ${VALID_LAYOUTS.join('|')} ` +
        `(got ${JSON.stringify(trace.splitLayout)})`,
    );
  }
  // Layout only matters when there is more than one chain. 'mirror' fans a
  // single pair CCW/CW, so it is only defined for exactly 2 chains.
  if (splits > 1 && layout === 'mirror' && splits !== 2) {
    throw new Error(
      `trace_chains: 'mirror' layout requires splits=2 (got splits=${splits}); ` +
        `use 'sequential' for ${splits} chains`,
    );
  }
  return layout;
}

function _resolveStartAngle(trace) {
  const sa = trace.startAngle === undefined || trace.startAngle === null ? 0 : trace.startAngle;
  if (!_isFiniteNumber(sa)) {
    throw new Error(
      `trace_chains: startAngle must be a finite number of degrees (got ${JSON.stringify(trace.startAngle)})`,
    );
  }
  return sa;
}

function _resolveGeometry(trace) {
  if (trace.shape !== 'circle') {
    throw new Error(
      `trace_chains: only circle traces have chains (got shape=${JSON.stringify(trace.shape)})`,
    );
  }
  const { radius, arc, count } = trace;
  if (!_isFiniteNumber(radius) || radius <= 0) {
    throw new Error(
      `trace_chains: radius must be a positive finite number (got ${JSON.stringify(radius)})`,
    );
  }
  if (!_isFiniteNumber(arc) || arc <= 0) {
    throw new Error(
      `trace_chains: arc must be a positive finite number of degrees (got ${JSON.stringify(arc)})`,
    );
  }
  // count is PER CHAIN once splits>1 (design §3.1). count<1 means 0 fixtures,
  // which is also the only way total fixtures (splits·count) can be < splits.
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(
      `trace_chains: count (fixtures per chain) must be an integer >= 1 (got ${JSON.stringify(count)})`,
    );
  }
  return { radius, arc, count };
}

const _pointAt = (angleRad, radius) => ({
  x: Math.cos(angleRad) * radius,
  y: 0,
  z: Math.sin(angleRad) * radius,
});

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Group names produced by a trace's chain split, in chain order.
 *   splits=1            -> [groupName]                    (legacy single group)
 *   mirror (splits=2)   -> [`${g} L`, `${g} R`]
 *   sequential (2..4)   -> [`${g} Chain 1` … `${g} Chain N`]
 * Used by gui_builder (regeneration sweep) and config.js (traceGenerated
 * re-stamp) so both agree on which flat groups a trace owns.
 * @param {object} trace
 * @returns {string[]}
 */
export function chainGroupNames(trace) {
  _requireObject(trace);
  const groupName = _resolveGroupName(trace);
  const splits = _resolveSplits(trace);
  const layout = _resolveLayout(trace, splits);

  if (splits === 1) return [groupName];
  if (layout === 'mirror') return [`${groupName} L`, `${groupName} R`];

  const names = [];
  for (let k = 0; k < splits; k++) names.push(`${groupName} Chain ${k + 1}`);
  return names;
}

/**
 * Per-chain placement plan for a circle trace.
 * @param {object} trace  circle trace: {shape:'circle', radius, arc, count,
 *   groupName, splits?=1, startAngle?=0, splitLayout?='mirror'}
 * @returns {Array<{suffix, groupName, count, angles:number[], points:Array<{x,y,z}>}>}
 */
export function chainPlan(trace) {
  _requireObject(trace);
  const groupName = _resolveGroupName(trace);
  const splits = _resolveSplits(trace);
  const layout = _resolveLayout(trace, splits);
  const startAngle = _resolveStartAngle(trace);
  const { radius, arc, count } = _resolveGeometry(trace);
  const names = chainGroupNames(trace);
  const startRad = startAngle * DEG2RAD;

  // ── Single chain: byte-identical to the legacy circle trace ───────────────
  if (splits === 1) {
    const arcRad = arc * DEG2RAD;
    const length = radius * arcRad;
    const isClosed = Math.abs(arc - 360) < CLOSED_EPS;
    const denom = isClosed ? count : Math.max(1, count - 1);
    const angles = [];
    const points = [];
    for (let i = 0; i < count; i++) {
      const s = (i / denom) * length;
      const evenAngle = length > 1e-9 ? (s / length) * arcRad : 0;
      const theta = startRad + evenAngle; // startAngle=0 -> theta === evenAngle
      angles.push(theta * RAD2DEG);
      points.push(_pointAt(theta, radius));
    }
    return [{ suffix: null, groupName, count, angles, points }];
  }

  // ── Mirror pair: fan CCW ('L') and CW ('R') from the start point ──────────
  // step = arc/(2·count); offsets are half-steps (i+0.5)·step so no fixture
  // sits exactly at the start point or the far seam. Union of the two chains
  // is one fixture every arc/(2·count) — even 360° coverage (360°,4 chains of
  // 4 -> ±22.5, 67.5, 112.5, 157.5). Index 0 (fixture #1) is nearest start.
  if (layout === 'mirror') {
    const step = arc / (2 * count);
    const dirs = [
      { suffix: 'L', name: names[0], sign: 1 },
      { suffix: 'R', name: names[1], sign: -1 },
    ];
    return dirs.map((d) => {
      const angles = [];
      const points = [];
      for (let i = 0; i < count; i++) {
        const angleDeg = startAngle + d.sign * (i + 0.5) * step;
        angles.push(angleDeg);
        points.push(_pointAt(angleDeg * DEG2RAD, radius));
      }
      return { suffix: d.suffix, groupName: d.name, count, angles, points };
    });
  }

  // ── Sequential: chains tile the arc head-to-tail, same direction ──────────
  // Chain k spans the half-open sub-arc [start + k·arc/splits, …); count
  // fixtures placed left-aligned inside it. Combined, the chains form a
  // uniform ring of splits·count fixtures spaced arc/(splits·count) apart.
  // Fixture #1 of each chain sits at that chain's own start.
  const blockWidth = arc / splits;
  const cellWidth = blockWidth / count; // == arc/(splits·count)
  const chains = [];
  for (let k = 0; k < splits; k++) {
    const angles = [];
    const points = [];
    for (let j = 0; j < count; j++) {
      const angleDeg = startAngle + k * blockWidth + j * cellWidth;
      angles.push(angleDeg);
      points.push(_pointAt(angleDeg * DEG2RAD, radius));
    }
    chains.push({ suffix: `Chain ${k + 1}`, groupName: names[k], count, angles, points });
  }
  return chains;
}
