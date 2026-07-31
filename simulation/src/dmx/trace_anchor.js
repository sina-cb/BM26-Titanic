/**
 * trace_anchor.js — the ONE definition of where a generator sits.
 *
 * WHY (report 20260725_83): a generator's anchor used to be computed TWICE, in
 * two different ways, and the two disagreed:
 *
 *   • LIVE  — `generateGroupFromTrace` read the anchor out of the THREE scene
 *             graph (`window.traceObjects[i].group.matrixWorld`). Any time that
 *             group was stale (rebuilt under an attached gizmo, or not built at
 *             all) the fixtures were placed against the OLD anchor, so moving a
 *             generator moved nothing.
 *   • RELOAD — `buildTraceObject` re-derived the anchor from the trace fields
 *             with `trace.y || 5`, a FALSY default. A generator legitimately
 *             standing at y = 0 (the deck) was rebuilt 5 m in the air, and the
 *             boot regeneration then placed its fixtures up there too.
 *
 * Both halves are gone: this module turns a trace's own fields into its anchor,
 * and every consumer — the visual group, the drag hitbox, the fly-to camera and
 * the fixture generation — goes through it. Live and reload cannot diverge
 * because there is only one computation left.
 *
 * Deliberately PURE — no THREE, no DOM, no window — so the contract is
 * unit-testable in Node. Callers compose the THREE objects from these numbers.
 *
 * CONTRACT (do not weaken):
 *   • `??`, NEVER `||`. 0 is a legal coordinate and a legal angle. The falsy
 *     default is the entire "way off on reload" bug (codex P0: no fallbacks —
 *     a missing field gets the documented default, a PRESENT 0 gets 0).
 *   • Line and corner traces carry their path in WORLD space (their start /
 *     corner / end fields are absolute), so they have no anchor transform.
 *     `traceUsesWorldSpacePath` is the single place that distinction lives.
 */

// The anchor a trace gets when the field is ABSENT (never when it is 0).
// y = 5 matches the "New Circle" default so a freshly created generator lands
// at eye level instead of inside the deck.
export const TRACE_ANCHOR_DEFAULTS = Object.freeze({
  x: 0, y: 5, z: 0, rotX: 0, rotY: 0, rotZ: 0,
});

/**
 * Does this trace's path geometry already live in world space?
 * Line and corner traces are defined by absolute start/corner/end points;
 * circle traces are authored in local space around an anchor.
 * @param {object} trace
 * @returns {boolean}
 */
export function traceUsesWorldSpacePath(trace) {
  const shape = trace && trace.shape;
  return shape === 'line' || shape === 'corner';
}

/**
 * The anchor transform of a trace, straight from its own fields.
 * Rotations are DEGREES in YXZ order — the order every consumer uses.
 * @param {object} trace
 * @returns {{x:number,y:number,z:number,rotX:number,rotY:number,rotZ:number}}
 */
export function traceAnchor(trace) {
  const t = trace || {};
  return {
    x: t.x ?? TRACE_ANCHOR_DEFAULTS.x,
    y: t.y ?? TRACE_ANCHOR_DEFAULTS.y,
    z: t.z ?? TRACE_ANCHOR_DEFAULTS.z,
    rotX: t.rotX ?? TRACE_ANCHOR_DEFAULTS.rotX,
    rotY: t.rotY ?? TRACE_ANCHOR_DEFAULTS.rotY,
    rotZ: t.rotZ ?? TRACE_ANCHOR_DEFAULTS.rotZ,
  };
}

/**
 * The centre a viewer should look at to frame a trace. Circle traces are
 * framed on their anchor; line/corner traces on the midpoint of their world
 * path. Same `??` discipline as the anchor itself.
 * @param {object} trace
 * @returns {{x:number,y:number,z:number}}
 */
export function traceFocusPoint(trace) {
  const t = trace || {};
  if (!traceUsesWorldSpacePath(t)) {
    const a = traceAnchor(t);
    return { x: a.x, y: a.y, z: a.z };
  }
  const sx = t.startX ?? 0, sy = t.startY ?? TRACE_ANCHOR_DEFAULTS.y, sz = t.startZ ?? 0;
  const ex = t.endX ?? 0, ey = t.endY ?? TRACE_ANCHOR_DEFAULTS.y, ez = t.endZ ?? 0;
  return { x: (sx + ex) / 2, y: (sy + ey) / 2, z: (sz + ez) / 2 };
}

/**
 * Translation between two anchors — what a generator move actually did.
 * Used to carry the aim target along with the generator so a moved ring keeps
 * aiming the way the operator placed it.
 * @param {{x:number,y:number,z:number}} from
 * @param {{x:number,y:number,z:number}} to
 * @returns {{dx:number,dy:number,dz:number}}
 */
export function anchorDelta(from, to) {
  return { dx: to.x - from.x, dy: to.y - from.y, dz: to.z - from.z };
}

/**
 * Are two anchors the same placement (within `eps`)? Rotations compare in
 * degrees, positions in metres — both are authored at the same magnitude here,
 * so one epsilon is honest.
 * @param {object} a
 * @param {object} b
 * @param {number} [eps]
 * @returns {boolean}
 */
export function anchorsEqual(a, b, eps = 1e-9) {
  const keys = ['x', 'y', 'z', 'rotX', 'rotY', 'rotZ'];
  return keys.every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) <= eps);
}
