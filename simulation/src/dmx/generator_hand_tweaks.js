/**
 * generator_hand_tweaks.js — name the fixtures a regeneration RE-SNAPPED.
 *
 * WHY (report 20260725_83 §4): a trace-generated fixture has no field in which
 * a post-generation hand nudge could be stored. `generateGroupFromTrace` sweeps
 * every `traceGenerated` fixture of the group away and emits fresh records from
 * the trace's own geometry, so a hand tweak is already lost on the next
 * regenerate — and, because boot regenerates every `generated: true` trace, it
 * never survived a reload either. Carrying the tweak as a delta would mean a
 * new per-fixture field, a new serialization key and a new sweep rule; inventing
 * one silently is exactly the kind of hidden state the codex forbids.
 *
 * So the policy is RE-SNAP, and this module is what makes the re-snap LOUD:
 * given the positions before and after a regeneration, it names the fixtures
 * that did NOT move with the rest of the group.
 *
 * PRECISION GATE (why this is not a guess): after a pure generator MOVE every
 * fixture displaces by the SAME vector. So if one displacement is shared by a
 * clear majority of the group, that vector IS the move, and anything off it was
 * standing somewhere the generator did not put it. When no such majority exists
 * the layout itself changed (count, radius, arc, aim, chain order) and
 * per-fixture displacement carries no information about hand tweaks — the
 * function then reports NOTHING rather than crying wolf.
 *
 * Pure: no THREE, no DOM. Positions are plain {x, y, z}.
 */

// Two displacements are "the same move" within this many metres per axis.
// Generation math is float64 on identical inputs, so real ties are exact; the
// tolerance only absorbs the last bits of a rotate-compose.
const SAME_MOVE_EPS = 1e-6;

// The majority that has to agree before a displacement counts as "the move".
const MOVE_QUORUM = 0.5;

function sameMove(a, b) {
  return Math.abs(a.dx - b.dx) <= SAME_MOVE_EPS
    && Math.abs(a.dy - b.dy) <= SAME_MOVE_EPS
    && Math.abs(a.dz - b.dz) <= SAME_MOVE_EPS;
}

/**
 * Which fixtures a regeneration re-snapped out from under the operator.
 *
 * @param {Array<{name:string,x:number,y:number,z:number}>} before fixtures as they
 *   stood before the sweep (the group's `traceGenerated` records)
 * @param {Array<{name:string,x:number,y:number,z:number}>} after  fixtures the
 *   regeneration just emitted
 * @returns {{names: string[], move: {dx:number,dy:number,dz:number}|null}}
 *   `names` is empty whenever the answer is not knowable (see PRECISION GATE).
 */
export function detectResnappedFixtures(before, after) {
  const none = { names: [], move: null };
  if (!Array.isArray(before) || !Array.isArray(after)) return none;

  const afterByName = new Map();
  for (const f of after) {
    if (f && typeof f.name === 'string') afterByName.set(f.name, f);
  }

  const moves = [];
  for (const f of before) {
    if (!f || typeof f.name !== 'string') continue;
    const now = afterByName.get(f.name);
    if (!now) continue; // dropped by a count shrink — a casualty, not a re-snap
    moves.push({
      name: f.name,
      dx: (now.x ?? 0) - (f.x ?? 0),
      dy: (now.y ?? 0) - (f.y ?? 0),
      dz: (now.z ?? 0) - (f.z ?? 0),
    });
  }
  if (moves.length < 3) return none; // no majority is meaningful below 3

  // Largest cluster of identical displacements.
  let best = null;
  let bestCount = 0;
  for (const candidate of moves) {
    const count = moves.filter((m) => sameMove(m, candidate)).length;
    if (count > bestCount) { bestCount = count; best = candidate; }
  }
  if (!best || bestCount <= moves.length * MOVE_QUORUM) return none;

  const names = moves.filter((m) => !sameMove(m, best)).map((m) => m.name);
  if (names.length === 0) return none;
  return { names, move: { dx: best.dx, dy: best.dy, dz: best.dz } };
}

/**
 * The operator-facing sentence for a re-snap. One place, so the console line
 * and the toast can never describe it differently.
 * @param {string} groupName
 * @param {string[]} names
 * @returns {string}
 */
export function resnapMessage(groupName, names) {
  const shown = names.slice(0, 6).join(', ');
  const extra = names.length > 6 ? ` and ${names.length - 6} more` : '';
  return `⚠ "${groupName}": ${names.length} fixture(s) had been moved by hand after ` +
    `generation and were RE-SNAPPED onto the generator's layout — ${shown}${extra}. ` +
    'Generated fixtures cannot keep a manual offset; move the generator, the point ' +
    'offsets or the chain instead.';
}
