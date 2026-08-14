/**
 * spotlight_sampling.js — WHICH fixtures get one of the pooled THREE.SpotLights,
 * and HOW a slot changes hands without the operator seeing a pop.
 *
 * The pool (light_pool.js) is a fixed, GPU-bounded set of slots. Every frame far
 * more pixels want a slot than there are slots, so a *sampling strategy* decides
 * who gets one. This module owns every strategy and the assignment plan they
 * produce; light_pool.js owns the THREE objects and just executes the plan.
 *
 * ── The flicker problem this module exists to solve ─────────────────────────
 * "Flicker" here is TEMPORAL INSTABILITY of the ASSIGNMENT, not of a light's
 * own brightness. Three mechanisms produced it, all of them structural:
 *
 *   F1  RANK-BASED SELECTION OVER A LENGTH-VARYING LIST. `uniform` picks
 *       stride midpoints out of the distance-sorted visible list. Those indices
 *       are computed from `visible.length`, and `visible.length` changes every
 *       single frame — dark pixels are excluded by the analytic light gate, so
 *       a pattern moving brightness around the ship adds and removes entries
 *       continuously. One entry appearing anywhere in the list shifts EVERY
 *       stride index, so the whole selected set can turn over in one frame.
 *   F2  A MOVING ANCHOR. `closest_bucket` anchors its depth window on
 *       `visible[0]` — the nearest *emitting* pixel. When that pixel goes dark
 *       the anchor jumps to the next one, the whole window slides, and the set
 *       turns over. Then it uniform-samples inside the window, so it inherits
 *       F1 on top.
 *   F3  NO CONTINUITY AT ALL. Slot i is handed `sample[i]` positionally, with
 *       no memory of who held it last frame and no ramp. A fixture that loses
 *       its slot goes from full intensity to zero in one frame; one that gains
 *       one goes zero → full. Every set change is a hard cut.
 *
 * Note what is NOT a cause: sorting ties do not oscillate (Array#sort is stable
 * per spec and the collect order is deterministic), and the analytic gate's
 * 1/255 threshold is not a pop source on its own, because a request's colour
 * carries the pixel's brightness — a pixel crossing the gate contributes a
 * near-black light either way. The pops come from EVICTION of bright fixtures.
 *
 * ── The strategies ─────────────────────────────────────────────────────────
 *   closest            camera-proximity concentration: the K nearest emitting
 *                      pixels. Valued for looking at one side of the ship up
 *                      close. Unstable by nature when the near field animates.
 *   closest_bucket     a depth slice starting at the nearest emitter, uniformly
 *                      sampled inside it. F1 + F2.
 *   uniform            even stride across the whole distance-sorted list. F1.
 *   stable_importance  the recommendation. Coverage-balanced importance with
 *                      incumbency, hysteresis and crossfaded handoffs. See
 *                      SpotlightAssignmentPlanner below.
 *   rotating_coverage  THE SHIPPED DEFAULT (see DEFAULT_SPOTLIGHT_SAMPLING_MODE).
 *                      stable_importance plus a slow, staggered, crossfaded
 *                      rotation so the pool time-shares across many more
 *                      fixtures. See the CFF note on ROTATION_PERIOD_FRAMES for
 *                      why this is a SLOW rotation and never a fast one.
 *
 * The first three keep their exact selection semantics — an operator who saved
 * `closest_bucket` gets the same visual concept, just computed more cheaply.
 */
import * as THREE from 'three';

// ── The strategy roster ─────────────────────────────────────────────────
// THIS ARRAY IS THE AUTHORITY for what the dropdown offers and what a saved
// scene value may be. scenes/common.yaml carries an `options:` list too, but it
// is operator-owned data; the code decides what actually exists, the same way
// gui_builder sources the "Max Spotlights" slider range from light_pool rather
// than from YAML meta. gui_builder writes this list into the config-tree entry
// so a save records the truth.
export const SPOTLIGHT_SAMPLING_MODES = [
  'closest',
  'closest_bucket',
  'uniform',
  'stable_importance',
  'rotating_coverage',
];

// The SHIPPED default — what a scene gets when it records no opinion of its own.
//
// It lives HERE, in code, and not in `scenes/common.yaml`, for the same reason
// the roster above does: common.yaml is operator-owned data that the save path
// rewrites, so a default parked in it is whatever the last save happened to
// leave behind, not a decision anyone made. The code owns the shipped choice;
// the operator's saved value always wins over it (see
// resolveSpotlightSamplingMode — a value that is PRESENT is never overridden,
// and a present value that is not on the roster still throws).
//
// Operator ruling (2026-08-06): rotating_coverage. It carries every stability
// property of stable_importance — incumbency, coverage grid, crossfaded
// handoffs, bounded per-frame change — and adds the slow time-share, so a pool
// that cannot cover the ship at least *visits* the whole of it. `_191` shipped
// it as experimental and recommended stable_importance; the operator looked at
// both and chose this one as the out-of-the-box look.
export const DEFAULT_SPOTLIGHT_SAMPLING_MODE = 'rotating_coverage';

// The three that predate this module. They are stateless, positional and
// exactly as they were.
const LEGACY_SAMPLING_MODES = new Set(['closest', 'closest_bucket', 'uniform']);

// ── Tuning constants ────────────────────────────────────────────────────
// All of these are CONSTANTS on purpose, not GUI knobs: they are the shape of
// the stability guarantee, and a knob that can be set to 0 is a knob that can
// re-introduce the flicker the mode exists to remove.

// Coverage grid. The model's bounding sphere (radius `modelRadius`) is diced
// into cells of (2·radius)/DIVISIONS on a side, and candidates are drawn
// round-robin across cells. 8 divisions ⇒ up to 512 cells over the ship, i.e.
// a cell roughly a quarter of the hull long — coarse enough that a cell holds
// many fixtures (so the round-robin actually spreads), fine enough that one
// bright cluster cannot own the whole selection.
export const COVERAGE_GRID_DIVISIONS = 8;
const COVERAGE_CELL_INDEX_LIMIT = 511;
const COVERAGE_CELL_INDEX_SPAN = COVERAGE_CELL_INDEX_LIMIT * 2 + 1;
// A spatial cell map converges to a fixed key set within a few frames, so it is
// reused rather than rebuilt. If a camera flight or a huge model ever grows it
// past this, drop it wholesale rather than leaking.
const COVERAGE_CELL_MAP_MAX = 4096;

// How deep the ranked candidate list runs past the slot budget. Challengers
// only ever come from this list, so it must be longer than the budget — but
// only enough to see the realistic contenders.
const CANDIDATE_DEPTH_FACTOR = 3;
const CANDIDATE_MIN_DEPTH = 16;

// Importance = brightness × proximity. The floor keeps a dim-but-near fixture
// from scoring ~0: dimness should lose ties, not be invisible. Proximity is a
// solid-angle-flavoured falloff, 1 at the camera and 0.5 at one model radius.
export const IMPORTANCE_BRIGHTNESS_FLOOR = 0.15;

// A challenger must beat the weakest incumbent by this ratio, and keep beating
// it for this many CONSECUTIVE frames, before it may take the slot. 1.35 is
// comfortably outside the frame-to-frame wobble of a pattern's brightness
// (a ±10-20% shimmer never trips it); 12 frames is 0.2 s at 60 fps, so at most
// five evictions per second can even be started.
export const STABLE_HYSTERESIS_MARGIN = 1.35;
export const STABLE_HYSTERESIS_FRAMES = 12;

// Crossfade length for a handoff and for fade-in / fade-out. 15 frames = 0.25 s
// at 60 fps: fast enough to feel responsive when a fixture lights up, slow
// enough that no transition reads as a cut.
export const STABLE_FADE_FRAMES = 15;

// Per-frame bounds on visible change. A fill is a light appearing where there
// was none (cheap, always a fade-in); an eviction is a slot changing hands.
export const STABLE_MAX_FILLS_PER_FRAME = 8;
export const STABLE_MAX_HANDOFFS_PER_FRAME = 2;

// ── rotating_coverage: the flicker-fusion arithmetic ────────────────────
// The tempting idea is to time-share the pool fast enough that persistence of
// vision fuses it — "show all of them, a fraction of the time each". At a
// browser's 60 Hz vsync that is arithmetically impossible: sharing one slot
// between K fixtures gives each a 60/K Hz square wave, and the critical flicker
// fusion frequency for a bright source against a dark field is ~50-60 Hz. K=2
// is 30 Hz — a hard strobe. K=1.2 would fuse and buys nothing. There is no
// value of K that both fuses and increases coverage, so the fast regime is not
// implemented and must not be added.
//
// What DOES work is the opposite end: rotate so slowly that the modulation is
// far below any flicker percept and reads as breathing. This is a look, not a
// free lunch: at any instant only `pool` lights are on. Over one cycle the pool
// has shown ~2-4× as many fixtures as it has slots (the hard ceiling is the
// candidate list, CANDIDATE_DEPTH_FACTOR × the budget — a slot can only rotate
// to something that is ON that list).
//
// ── Why these numbers and not slower or faster (_192 retune) ──────────────
// The operator asked for faster convergence. The period and the crossfade were
// both shortened, and the FIRST turn after a (re)start is additionally halved,
// while staying deep in the slow regime the paragraph above establishes. The
// numbers that matter, at 60 Hz:
//
//   • Per-SLOT modulation: a slot's gain envelope dips to 0 and back exactly
//     once per period ⇒ 60/210 = 0.286 Hz (was 0.167 Hz at 360 frames).
//     Critical flicker fusion is ~50-60 Hz; visible flicker starts around
//     15-20 Hz. 0.286 Hz is ~180× below CFF and ~60× below the visible-flicker
//     floor. It reads as breathing, which is the whole point of the mode.
//   • Per-FIXTURE modulation is slower still: a fixture that has had its turn
//     is excluded for ROTATION_MEMORY_FRAMES (15 s), so its on/off cycle is
//     ≤ 0.06 Hz.
//   • Fastest luminance SLEW: a full 0 → 1 crossfade in ROTATION_FADE_FRAMES =
//     0.333 s. That is a one-shot ramp, not a periodic modulation, and it is
//     still 33% GENTLER than the 0.25 s crossfade stable_importance has shipped
//     with since _191 — which the operator has been looking at, and which reads
//     as a dip rather than a cut. A rotation handoff is fade-out + fade-in =
//     0.667 s of transition inside a 3.5 s cycle (19% duty, was 17% at 360/30),
//     so the ship is no busier than it was; it just arrives sooner.
//
// The fast regime is still refused. Nothing here approaches it: shortening the
// period from 6 s to 3.5 s moves the modulation from 0.167 Hz to 0.286 Hz, i.e.
// two orders of magnitude of headroom remain before anything is even
// perceptible as flicker, let alone before persistence of vision could fuse it.
// Do NOT keep pulling this number down expecting more coverage — the arithmetic
// at the top of this block is why that road ends in a strobe, not in coverage.
export const ROTATION_PERIOD_FRAMES = 210;   // 3.5 s at 60 fps ⇒ 0.286 Hz
export const ROTATION_FADE_FRAMES = 20;      // 0.333 s
// The FIRST turn of each slot after a fresh start (boot, strategy switch,
// analytic lighting coming back on) uses this shorter period, so coverage
// "paints in" instead of standing still for a full cycle. Half the steady-state
// period, and it applies to at most one turn per slot: `_rotate` always re-arms
// at the full ROTATION_PERIOD_FRAMES. Nothing about a handoff changes — same
// crossfade, same per-frame handoff ceiling, same candidate rules — only WHEN
// the first one is scheduled, which is why the crossfade and churn invariants
// are untouched by it.
export const ROTATION_WARMUP_PERIOD_FRAMES = 105;  // 1.75 s
// Neighbouring slots rotate this many frames apart so the ship never changes
// all at once. 7 is coprime with nothing in particular — it just has to be
// small relative to the period and not divide it evenly.
const ROTATION_STAGGER_FRAMES = 7;
// A fixture that has just had a turn is skipped while choosing the next one,
// so the rotation actually explores instead of ping-ponging. 900 frames = 15 s.
// Deliberately NOT scaled down with the period: the memory is a WALL-CLOCK
// "don't show me that one again yet" window, and keeping it at 15 s while the
// period shrinks means each turn is more likely to land on something genuinely
// new — which is exactly the convergence the operator asked for.
export const ROTATION_MEMORY_FRAMES = 900;
const ROTATION_MEMORY_PRUNE_INTERVAL = 600;

// ── Mode validation ─────────────────────────────────────────────────────

/**
 * Refuse an unknown sampling strategy loudly.
 *
 * Codex P0: no fallback behaviours. The previous resolver silently mapped every
 * unrecognised value — including `closest`, which the dropdown has always
 * offered — onto `uniform`, so the operator got a strategy he did not pick and
 * nothing said so. An unknown name is now a hard error naming the value and the
 * roster.
 *
 * @param {string} mode
 * @param {string} context where the value came from, for the message
 * @returns {string} the validated mode
 * @throws {RangeError}
 */
export function assertSpotlightSamplingMode(mode, context) {
  if (typeof mode !== 'string' || !SPOTLIGHT_SAMPLING_MODES.includes(mode)) {
    throw new RangeError(
      `[SpotlightSampling] ${context}: unknown sampling strategy ${JSON.stringify(mode)}. ` +
      `Valid strategies are ${SPOTLIGHT_SAMPLING_MODES.join(', ')}.`
    );
  }
  return mode;
}

/**
 * The strategy to run, given whatever the scene recorded.
 *
 * The ONLY value that yields the code default is `undefined` — the key is not
 * in the config tree at all, i.e. the scene has recorded no opinion. That is
 * not a fallback: there is nothing to fall back FROM. Everything else, `null`
 * and `''` and a typo included, is a recorded opinion, and a recorded opinion
 * that names no real strategy still throws (codex P0). So the precedence is
 * exactly what it was before the default existed:
 *
 *     saved scene value  >  code default  >  (nothing — unknown values throw)
 *
 * @param {string|undefined} saved params.spotlightSamplingMode as loaded
 * @param {string} context where the value came from, for the message
 * @returns {string} a validated SPOTLIGHT_SAMPLING_MODES entry
 * @throws {RangeError} on a present-but-unknown value
 */
export function resolveSpotlightSamplingMode(saved, context) {
  if (saved === undefined) return DEFAULT_SPOTLIGHT_SAMPLING_MODE;
  return assertSpotlightSamplingMode(saved, context);
}

// A default that is not on the roster would turn every scene recording no
// opinion into a boot crash. Caught here, at module load, rather than in the
// field.
assertSpotlightSamplingMode(
  DEFAULT_SPOTLIGHT_SAMPLING_MODE, 'DEFAULT_SPOTLIGHT_SAMPLING_MODE'
);

/** True for the three positional, stateless strategies. */
export function isLegacySpotlightSamplingMode(mode) {
  return LEGACY_SAMPLING_MODES.has(mode);
}

// ── The legacy strategies (semantics preserved, cost reduced) ───────────

/**
 * Even stride sample of an already-ordered list. Byte-for-byte the original
 * midpoint arithmetic — including the `sampleCount === 1` case picking the LAST
 * element, which looks odd but is the shipped behaviour.
 *
 * @param {Array} ordered
 * @param {number} sampleCount
 * @param {Array} out reused output array
 */
function pushUniformSample(ordered, length, sampleCount, out) {
  if (sampleCount <= 0 || length === 0) return out;
  if (length <= sampleCount) {
    for (let i = 0; i < length; i++) out.push(ordered[i]);
    return out;
  }
  if (sampleCount === 1) {
    out.push(ordered[length - 1]);
    return out;
  }
  for (let i = 0; i < sampleCount; i++) {
    const start = Math.floor((i * length) / sampleCount);
    const end = Math.max(start, Math.floor(((i + 1) * length) / sampleCount) - 1);
    out.push(ordered[Math.floor((start + end) / 2)]);
  }
  return out;
}

/**
 * The original `sampleUniformRequests`, kept exported for tests that pin the
 * stride arithmetic against the pre-optimization implementation.
 */
export function sampleUniformRequests(ordered, sampleCount) {
  const out = [];
  return pushUniformSample(ordered, ordered.length, sampleCount, out);
}

/**
 * closest / closest_bucket / uniform.
 *
 * @param {string} mode
 * @param {Array} visible requests, ASCENDING by distSq (caller sorts)
 * @param {number} slotBudget per-frame active limit
 * @param {number} bucketDistance metres, closest_bucket only
 * @param {Array} out reused output array
 * @returns {Array} out
 */
export function selectLegacySample(mode, visible, slotBudget, bucketDistance, out) {
  out.length = 0;
  const activeLimit = Math.min(visible.length, slotBudget);
  if (activeLimit <= 0 || visible.length === 0) return out;

  if (mode === 'closest') {
    for (let i = 0; i < activeLimit; i++) out.push(visible[i]);
    return out;
  }
  if (mode === 'uniform') {
    return pushUniformSample(visible, visible.length, activeLimit, out);
  }

  // closest_bucket: every request whose distance lies in
  // [d(visible[0]), d(visible[0]) + bucketDistance], uniformly sampled.
  //
  // Two cost reductions, both provably output-identical:
  //   • The window test is done on SQUARED distance. x ↦ x² is monotone on
  //     x ≥ 0, so the membership set is the same, and V calls to Math.sqrt
  //     disappear (only two remain).
  //   • `visible` is already ascending by distSq and the window's lower bound
  //     IS visible[0], so members are a contiguous PREFIX: the scan stops at
  //     the first non-member instead of walking the whole list, and the
  //     original `bucketRequests.sort(by bucketDepth, then distSq)` was sorting
  //     an already-sorted array by a monotone function of the same key — a
  //     provable no-op, now deleted along with the per-request `bucketDepth`
  //     property write.
  const closestDistSq = visible[0].distSq;
  if (closestDistSq <= 0) {
    for (let i = 0; i < activeLimit; i++) out.push(visible[i]);
    return out;
  }
  const maxDistance = Math.sqrt(closestDistSq) + bucketDistance;
  const maxDistSq = maxDistance * maxDistance;

  let bucketEnd = 0;
  while (bucketEnd < visible.length && visible[bucketEnd].distSq <= maxDistSq) bucketEnd++;

  if (bucketEnd === 0) {
    for (let i = 0; i < activeLimit; i++) out.push(visible[i]);
    return out;
  }

  return pushUniformSample(visible, bucketEnd, Math.min(activeLimit, bucketEnd), out);
}

// ── Importance + coverage scoring ───────────────────────────────────────

/**
 * Importance of one request: how much this pixel would contribute to the
 * picture if it held a slot.
 *
 *   brightness — the same quantity the analytic light gate thresholds
 *                (max channel), so "worth a slot" and "scored high" agree.
 *   proximity  — 1/(1 + d²/r²): a solid-angle-flavoured falloff that is 1 at
 *                the camera and 0.5 one model radius away. Camera-aware, so
 *                what the operator is looking at wins, without the hard
 *                cliff `closest` has.
 *
 * Deliberately NOT normalized per frame: a per-frame normalization would make
 * every score move when any pixel moves, which is exactly the rank-instability
 * (F1) this mode exists to avoid. Scores are absolute and comparable across
 * frames, which is what makes the hysteresis margin meaningful.
 */
function scoreRequest(req, refDistSq) {
  const c = req.color;
  const brightness = Math.min(1, Math.max(c.r, c.g, c.b));
  const proximity = 1 / (1 + req.distSq / refDistSq);
  return (IMPORTANCE_BRIGHTNESS_FLOOR
    + (1 - IMPORTANCE_BRIGHTNESS_FLOOR) * brightness) * proximity;
}

function cellIdFor(pos, cellSize) {
  const ix = clampCellIndex(Math.floor(pos.x / cellSize));
  const iy = clampCellIndex(Math.floor(pos.y / cellSize));
  const iz = clampCellIndex(Math.floor(pos.z / cellSize));
  return ((ix + COVERAGE_CELL_INDEX_LIMIT) * COVERAGE_CELL_INDEX_SPAN
    + (iy + COVERAGE_CELL_INDEX_LIMIT)) * COVERAGE_CELL_INDEX_SPAN
    + (iz + COVERAGE_CELL_INDEX_LIMIT);
}

// Outliers far outside the model merge into the edge cell. They are already
// scored near zero by proximity, so the merge costs nothing but keeps the cell
// id inside a 32-bit integer.
function clampCellIndex(index) {
  if (!Number.isFinite(index)) return 0;
  if (index > COVERAGE_CELL_INDEX_LIMIT) return COVERAGE_CELL_INDEX_LIMIT;
  if (index < -COVERAGE_CELL_INDEX_LIMIT) return -COVERAGE_CELL_INDEX_LIMIT;
  return index;
}

// Descending importance; ties broken by the stable per-pixel key so two runs of
// the same input produce the same list. No Math.random anywhere in this module.
function compareByImportance(a, b) {
  if (a.score !== b.score) return b.score - a.score;
  return a.key - b.key;
}

// ── The assignment planner ──────────────────────────────────────────────

/**
 * Per-slot state. `snap` is a slot-OWNED copy of whatever it is currently
 * showing, so a slot can keep rendering (and fading out) a fixture that has
 * gone dark or left the frustum — the request objects are frame-local and the
 * live pixel colour would keep changing underneath us.
 */
function createSlotState() {
  return {
    key: null,          // the pixel currently owning this slot
    pendingKey: null,   // the pixel taking it over once the fade-out completes
    gain: 0,            // 0..1 crossfade envelope, multiplies light intensity
    target: 0,
    score: 0,
    rotateAtFrame: 0,
    snap: {
      worldPos: new THREE.Vector3(),
      worldDir: new THREE.Vector3(),
      color: new THREE.Color(),
      intensity: 5,
      angle: 20,
      penumbra: 0.5,
    },
  };
}

function snapshotRequest(snap, req) {
  snap.worldPos.copy(req.worldPos);
  snap.worldDir.copy(req.worldDir);
  snap.color.copy(req.color);
  snap.intensity = req.intensity;
  snap.angle = req.angle;
  snap.penumbra = req.penumbra;
}

/**
 * Turns the frame's visible requests into a per-slot assignment plan.
 *
 * ── stable_importance, the algorithm ───────────────────────────────────────
 * Every frame:
 *   1. SCORE each visible request (importance = brightness × proximity, above).
 *   2. CANDIDATES: dice the requests into a coverage grid, sort inside each
 *      cell, then walk the cells ROUND-ROBIN taking each cell's best, then
 *      each cell's second-best, and so on. Cells themselves are ordered by
 *      their best score, so the camera-facing bright region still leads — but
 *      it cannot take slot after slot while the far end of the ship goes dark.
 *      This is the "representative overall view" blend: importance decides the
 *      ORDER, coverage decides the SPACING.
 *   3. INCUMBENCY: a slot keeps its pixel for as long as that pixel is still
 *      emitting and in frustum. Nothing is re-derived from rank, so F1 and F2
 *      cannot reach the assignment at all.
 *   4. HYSTERESIS: the best unheld candidate may take the weakest incumbent's
 *      slot only after beating it by STABLE_HYSTERESIS_MARGIN for
 *      STABLE_HYSTERESIS_FRAMES CONSECUTIVE frames. One counter, on the
 *      challenger key: a challenger that flickers above and below the margin
 *      resets and never wins.
 *   5. BOUNDED CHANGE: at most STABLE_MAX_HANDOFFS_PER_FRAME evictions and
 *      STABLE_MAX_FILLS_PER_FRAME new lights per frame.
 *   6. CROSSFADE: every appearance, disappearance and handoff runs through the
 *      slot's `gain` envelope at 1/STABLE_FADE_FRAMES per frame. A handoff is
 *      fade the incumbent to 0, adopt the challenger, fade to 1 — so a swap is
 *      a dip, never a cut, and the envelope is monotone on each leg.
 *
 * Determinism: scores are pure functions of the frame's data, ties break on the
 * stable pixel key, iteration order is slot index order. Two runs over the same
 * input produce the same plan, frame for frame.
 *
 * ── rotating_coverage ──────────────────────────────────────────────────────
 * Identical machinery, with step 4 replaced by a forced, staggered rotation:
 * each slot hands off every ROTATION_PERIOD_FRAMES to the best candidate that
 * has not had a turn in the last ROTATION_MEMORY_FRAMES, through the same
 * crossfade. A slot's FIRST turn after a fresh start is scheduled at the
 * compressed ROTATION_WARMUP_PERIOD_FRAMES instead, so coverage paints in
 * rather than standing still for a whole cycle. See the CFF note above for why
 * the rotation is slow, and how much headroom these numbers keep.
 */
export class SpotlightAssignmentPlanner {
  constructor() {
    this._slots = [];
    this._entries = [];     // reused plan entries, one per slot
    this._plan = [];
    this._frame = 0;
    this._mode = null;
    this._byKey = new Map();
    this._held = new Set();
    this._cells = new Map();
    this._usedCells = [];
    this._candidates = [];
    this._sample = [];
    this._lastShown = new Map();
    this._challengerKey = null;
    this._challengerFrames = 0;
    // The frame the current rotation "epoch" began — boot, a strategy switch,
    // or analytic lighting coming back on. Slots filled inside the first
    // ROTATION_PERIOD_FRAMES of an epoch get the compressed warmup schedule.
    this._rotationEpochFrame = 0;
  }

  /** Frames planned so far. Diagnostics and tests. */
  get frame() { return this._frame; }

  /** Slot → pixel key, for churn measurement in tests. */
  assignedKeys() {
    return this._slots.map((slot) => slot.key);
  }

  /**
   * Forget every assignment. The caller MUST do this whenever the pool stops
   * being driven — analytic lighting switched off, a profile rebuild replacing
   * every fixture — or the next frame that turns it back on would resume
   * fading out stale snapshots at stale positions.
   */
  reset() {
    this._resetStableState();
    this._mode = null;
  }

  _ensureSlots(poolSize) {
    while (this._slots.length < poolSize) {
      this._slots.push(createSlotState());
      this._entries.push({ source: null, gain: 0 });
    }
    this._plan.length = poolSize;
  }

  _resetStableState() {
    for (const slot of this._slots) {
      slot.key = null;
      slot.pendingKey = null;
      slot.gain = 0;
      slot.target = 0;
      slot.score = 0;
      slot.rotateAtFrame = 0;
    }
    this._challengerKey = null;
    this._challengerFrames = 0;
    this._lastShown.clear();
    // Every path into here is a fresh start for the rotation, so the next
    // slots to fill get the compressed first turn again.
    this._rotationEpochFrame = this._frame;
  }

  /**
   * @param {Object} opts
   * @param {string} opts.mode a validated SPOTLIGHT_SAMPLING_MODES entry
   * @param {Array}  opts.visible frustum-passing requests. Legacy modes require
   *   them ASCENDING by distSq; the stable modes do not need any order (and the
   *   caller skips the sort for them — that is the other half of the cost win).
   * @param {number} opts.slotBudget per-frame active limit (the slider)
   * @param {number} opts.poolSize allocated SpotLights
   * @param {number} opts.bucketDistance closest_bucket window, metres
   * @param {number} opts.modelRadius scene scale, for proximity + cell size
   * @returns {Array<{source:Object, gain:number}|null>} indexed by slot
   */
  plan({ mode, visible, slotBudget, poolSize, bucketDistance, modelRadius }) {
    this._frame++;
    this._ensureSlots(poolSize);
    if (mode !== this._mode) {
      // Switching strategy is a deliberate operator act; carrying half-faded
      // incumbents across the change would make the new mode's first second
      // look like the old one's.
      this._resetStableState();
      this._mode = mode;
    }

    if (isLegacySpotlightSamplingMode(mode)) {
      return this._planLegacy(mode, visible, slotBudget, poolSize, bucketDistance);
    }
    return this._planStable(mode, visible, slotBudget, poolSize, modelRadius);
  }

  _planLegacy(mode, visible, slotBudget, poolSize, bucketDistance) {
    selectLegacySample(mode, visible, slotBudget, bucketDistance, this._sample);
    for (let i = 0; i < poolSize; i++) {
      const slot = this._slots[i];
      if (i < this._sample.length) {
        const req = this._sample[i];
        const entry = this._entries[i];
        entry.source = req;
        entry.gain = 1;
        this._plan[i] = entry;
        // Bookkeeping only — the positional strategies do not consult it. It
        // exists so assignedKeys() means the same thing for every strategy,
        // which is what makes churn measurable across all of them.
        slot.key = req.key === undefined ? null : req.key;
      } else {
        this._plan[i] = null;
        slot.key = null;
      }
    }
    return this._plan;
  }

  _planStable(mode, visible, slotBudget, poolSize, modelRadius) {
    const rotating = mode === 'rotating_coverage';
    const fadeStep = 1 / (rotating ? ROTATION_FADE_FRAMES : STABLE_FADE_FRAMES);
    const refDistSq = Math.max(1e-6, modelRadius * modelRadius);

    const byKey = this._byKey;
    byKey.clear();
    for (const req of visible) {
      req.score = scoreRequest(req, refDistSq);
      byKey.set(req.key, req);
    }

    this._refreshIncumbents(byKey, slotBudget, poolSize);
    const candidates = this._buildCandidates(visible, slotBudget, modelRadius);
    this._fillFreeSlots(candidates, slotBudget, poolSize, rotating);
    if (rotating) {
      this._rotate(candidates, slotBudget, poolSize);
      if (this._frame % ROTATION_MEMORY_PRUNE_INTERVAL === 0) this._pruneRotationMemory();
    } else {
      this._considerEviction(candidates, slotBudget, poolSize);
    }
    return this._advanceGains(byKey, poolSize, fadeStep);
  }

  // Incumbents that are still emitting and in frustum hold their slot and
  // refresh their snapshot; the rest are told to fade out. A slot above the
  // current budget (the operator pulled the slider down) fades out too, rather
  // than being cut.
  _refreshIncumbents(byKey, slotBudget, poolSize) {
    const held = this._held;
    held.clear();
    for (let i = 0; i < poolSize; i++) {
      const slot = this._slots[i];
      if (slot.pendingKey !== null) {
        held.add(slot.pendingKey);
        slot.target = 0;
        continue;
      }
      if (slot.key === null) continue;
      const req = byKey.get(slot.key);
      if (req === undefined || i >= slotBudget) {
        slot.target = 0;
        continue;
      }
      slot.target = 1;
      slot.score = req.score;
      snapshotRequest(slot.snap, req);
      held.add(slot.key);
    }
  }

  _buildCandidates(visible, slotBudget, modelRadius) {
    const cells = this._cells;
    if (cells.size > COVERAGE_CELL_MAP_MAX) cells.clear();
    const used = this._usedCells;
    used.length = 0;
    const cellSize = Math.max(1e-3, (2 * modelRadius) / COVERAGE_GRID_DIVISIONS);

    for (const req of visible) {
      const id = cellIdFor(req.worldPos, cellSize);
      let bucket = cells.get(id);
      if (bucket === undefined) {
        bucket = [];
        cells.set(id, bucket);
      }
      // Buckets are emptied at the end of every build, so an empty bucket here
      // means "first request into this cell this frame".
      if (bucket.length === 0) used.push(id);
      bucket.push(req);
    }

    for (let i = 0; i < used.length; i++) cells.get(used[i]).sort(compareByImportance);
    used.sort((a, b) => {
      const sa = cells.get(a)[0].score;
      const sb = cells.get(b)[0].score;
      if (sa !== sb) return sb - sa;
      return a - b;
    });

    const depth = Math.max(CANDIDATE_MIN_DEPTH, slotBudget * CANDIDATE_DEPTH_FACTOR);
    const out = this._candidates;
    out.length = 0;
    let round = 0;
    let added = true;
    while (out.length < depth && added) {
      added = false;
      for (let i = 0; i < used.length; i++) {
        const bucket = cells.get(used[i]);
        if (round >= bucket.length) continue;
        out.push(bucket[round]);
        added = true;
        if (out.length >= depth) break;
      }
      round++;
    }

    for (let i = 0; i < used.length; i++) cells.get(used[i]).length = 0;
    return out;
  }

  _fillFreeSlots(candidates, slotBudget, poolSize, rotating) {
    const held = this._held;
    const limit = Math.min(slotBudget, poolSize);
    let cursor = 0;
    let fills = 0;
    for (let i = 0; i < limit; i++) {
      if (fills >= STABLE_MAX_FILLS_PER_FRAME) break;
      const slot = this._slots[i];
      if (slot.key !== null || slot.pendingKey !== null || slot.gain > 0) continue;
      while (cursor < candidates.length && held.has(candidates[cursor].key)) cursor++;
      if (cursor >= candidates.length) break;
      const req = candidates[cursor++];
      slot.key = req.key;
      slot.score = req.score;
      slot.target = 1;
      snapshotRequest(slot.snap, req);
      held.add(req.key);
      this._lastShown.set(req.key, this._frame);
      if (rotating) {
        // First turn of an epoch is compressed (see ROTATION_WARMUP_PERIOD_
        // FRAMES): without it the pool stands completely still for one full
        // period plus the stagger — up to two periods — before the operator
        // sees the mode do anything at all. The stagger is taken modulo the
        // period actually in use so it stays a spread inside that period.
        const period = this._frame < this._rotationEpochFrame + ROTATION_PERIOD_FRAMES
          ? ROTATION_WARMUP_PERIOD_FRAMES
          : ROTATION_PERIOD_FRAMES;
        slot.rotateAtFrame = this._frame + period
          + ((i * ROTATION_STAGGER_FRAMES) % period);
      }
      fills++;
    }
  }

  // One global challenger counter, not one per slot: the question the operator
  // cares about is "is there a fixture clearly more important than the least
  // important one I am showing, and has that been true long enough to be real?"
  _considerEviction(candidates, slotBudget, poolSize) {
    const held = this._held;
    const limit = Math.min(slotBudget, poolSize);

    let worstIndex = -1;
    let worstScore = Infinity;
    for (let i = 0; i < limit; i++) {
      const slot = this._slots[i];
      // Only a settled slot may be challenged — one mid-fade is already busy.
      if (slot.key === null || slot.pendingKey !== null || slot.gain < 1) continue;
      if (slot.score < worstScore) {
        worstScore = slot.score;
        worstIndex = i;
      }
    }

    let challenger = null;
    for (let i = 0; i < candidates.length; i++) {
      if (!held.has(candidates[i].key)) {
        challenger = candidates[i];
        break;
      }
    }

    if (worstIndex < 0 || challenger === null
      || challenger.score <= worstScore * STABLE_HYSTERESIS_MARGIN) {
      this._challengerKey = null;
      this._challengerFrames = 0;
      return;
    }

    if (this._challengerKey === challenger.key) this._challengerFrames++;
    else {
      this._challengerKey = challenger.key;
      this._challengerFrames = 1;
    }
    if (this._challengerFrames < STABLE_HYSTERESIS_FRAMES) return;

    const slot = this._slots[worstIndex];
    slot.pendingKey = challenger.key;
    slot.target = 0;
    held.add(challenger.key);
    this._challengerKey = null;
    this._challengerFrames = 0;
  }

  _rotate(candidates, slotBudget, poolSize) {
    const held = this._held;
    const limit = Math.min(slotBudget, poolSize);
    let handoffs = 0;
    for (let i = 0; i < limit; i++) {
      if (handoffs >= STABLE_MAX_HANDOFFS_PER_FRAME) break;
      const slot = this._slots[i];
      if (slot.key === null || slot.pendingKey !== null || slot.gain < 1) continue;
      if (this._frame < slot.rotateAtFrame) continue;
      slot.rotateAtFrame = this._frame + ROTATION_PERIOD_FRAMES;

      let next = null;
      let fresh = null;
      for (let c = 0; c < candidates.length; c++) {
        const cand = candidates[c];
        if (held.has(cand.key)) continue;
        if (next === null) next = cand;
        const shown = this._lastShown.get(cand.key);
        if (shown === undefined || this._frame - shown > ROTATION_MEMORY_FRAMES) {
          fresh = cand;
          break;
        }
      }
      const chosen = fresh !== null ? fresh : next;
      if (chosen === null) continue;

      slot.pendingKey = chosen.key;
      slot.target = 0;
      held.add(chosen.key);
      handoffs++;
    }
  }

  _pruneRotationMemory() {
    for (const [key, frame] of this._lastShown) {
      if (this._frame - frame > ROTATION_MEMORY_FRAMES) this._lastShown.delete(key);
    }
  }

  _advanceGains(byKey, poolSize, fadeStep) {
    for (let i = 0; i < poolSize; i++) {
      const slot = this._slots[i];
      if (slot.key === null && slot.pendingKey === null) {
        slot.gain = 0;
        this._plan[i] = null;
        continue;
      }

      if (slot.gain < slot.target) slot.gain = Math.min(slot.target, slot.gain + fadeStep);
      else if (slot.gain > slot.target) slot.gain = Math.max(slot.target, slot.gain - fadeStep);

      if (slot.gain === 0 && slot.target === 0) {
        const pending = slot.pendingKey;
        slot.pendingKey = null;
        const req = pending === null ? undefined : byKey.get(pending);
        if (req === undefined) {
          // Either nobody was waiting, or the challenger went dark during the
          // fade-out. Release the slot; the next frame's fill pass reuses it.
          slot.key = null;
          this._plan[i] = null;
          continue;
        }
        slot.key = pending;
        slot.score = req.score;
        slot.target = 1;
        snapshotRequest(slot.snap, req);
        this._lastShown.set(pending, this._frame);
      }

      const entry = this._entries[i];
      entry.source = slot.snap;
      entry.gain = slot.gain;
      this._plan[i] = entry;
    }
    return this._plan;
  }
}

export function createSpotlightPlanner() {
  return new SpotlightAssignmentPlanner();
}
