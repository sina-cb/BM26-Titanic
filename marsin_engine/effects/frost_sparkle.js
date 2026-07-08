/**
 * effects/frost_sparkle.js — E10 Frost Sparkle (AMBIENT ↔ PEAK)
 *
 * Transient single-pixel glints sprinkled over whatever is playing:
 * champagne fizz at low density, blizzard at high (docs report-1 §E10).
 * Glints spawn into a lazy per-pixel energy array and decay each frame;
 * the `density` knob morphs it from ambient texture to peak-time chaos.
 * An OPTIONAL `audioDensity` mode ties the spawn rate to a high-band audio
 * signal (`signals.micHigh`) so hi-hats literally sparkle.
 *
 * CHANNEL CHOICE (deliberate, docs §E10): the glint lands in the WHITE
 * channel (px.w), NOT RGB. W is untouched by downstream hue rotation and
 * invert, so a frost glint stays crisp white no matter what chroma effect
 * runs after it. This is the intended use of the W/A/UV convention — the
 * sparkle is a warm/ice-white overlay, not a hue. R/G/B/A/U are NEVER
 * written by this effect.
 *
 * STATE: stateful (spark energy array + last-frame clock + RNG). Because
 * effect modules must not import the controller, state lives in an
 * explicit object from `createSparkleState()` that Builder A owns on the
 * controller and passes in each frame — mirroring feedbackTrails' buffer
 * and dropHit's envelope list. The array is lazily (re)allocated on first
 * use and whenever the pixel count changes. An injectable `rng` (default
 * Math.random) keeps the effect deterministic under test.
 *
 * SIGNALS SAFETY: `signals` is optional and read-only. When `audioDensity`
 * is off, or `signals` is absent/undefined, or `signals.micHigh` is
 * missing, the audio contribution is treated as 0 — the module NEVER
 * throws on a missing bag (Builder A owns whether the bag exists).
 *
 * GATING (Codex P0, zero-cost default): when off the caller MUST skip this
 * stage. `applyFrostSparkle` also early-returns when `enabled` is false —
 * but note that returning while glints are still decaying would freeze
 * them mid-air; the controller's disable path should call `resetSparkle()`
 * (panicStop policy) so no stale glints linger. When enabled with zero
 * effective density and an empty field, the per-pixel loop is skipped.
 *
 * Per-frame cost:
 *   - spawn: ~`spawnCount` RNG calls + writes (spawnCount = density × px × dt-normalized).
 *   - decay+draw: for pixels with live energy only — up to px iterations of
 *     [read, compare, 1 add, 1 mul] when the field is dense; near-zero when
 *     sparse (an activeCount guard skips the loop entirely when the field
 *     is empty). Allocation-free once the array exists.
 */

const DEFAULT_DECAY_MS = 200;
// Reference frame interval used to normalize the spawn rate so `density`
// means "expected fraction of pixels spawned per ~25 ms tick" regardless
// of the true frame delta. The engine runs at 40 fps (25 ms).
const REFERENCE_DT_MS = 25;
// Below this energy a glint is considered dead and cleared to exactly 0.
const DEAD_EPSILON = 0.01;

/**
 * Create the explicit per-effect state holder. The controller owns one of
 * these and passes it into every applyFrostSparkle call.
 *
 * @param {object} [opts]
 * @param {() => number} [opts.rng]  Uniform [0,1) source; default Math.random.
 */
export function createSparkleState({ rng } = {}) {
  return {
    spark: null,          // Float32Array(pixelCount), lazy
    pixelCount: 0,        // guards reallocation on model change
    activeCount: 0,       // how many pixels currently carry energy (loop guard)
    lastMs: null,         // previous nowMs, for dt
    rng: typeof rng === 'function' ? rng : Math.random,
  };
}

/** Clear all live glints (panicStop / disable path). */
export function resetSparkle(state) {
  if (!state || !state.spark) return;
  state.spark.fill(0);
  state.activeCount = 0;
}

function ensureArray(state, pixelCount) {
  if (!state.spark || state.pixelCount !== pixelCount) {
    state.spark = new Float32Array(pixelCount);
    state.pixelCount = pixelCount;
    state.activeCount = 0;
  }
}

/**
 * Read the high-band audio signal, safe against a missing bag.
 * @returns {number} micHigh in [0..1], or 0 when unavailable.
 */
function readMicHigh(signals) {
  if (!signals) return 0;
  const v = signals.micHigh;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Frost-sparkle apply: spawn glints, decay them, draw into px.w.
 *
 * @param {object}  args
 * @param {Array}   args.pixels        Post-mixer model.pixels.
 * @param {object}  args.state         From createSparkleState() — MUST persist across frames.
 * @param {boolean} args.enabled       Master on/off.
 * @param {number}  args.nowMs         Monotonic clock (ms).
 * @param {number}  args.density       Base spawn density in [0..1] (expected fraction of px/tick).
 * @param {number}  [args.decayMs=200] Glint half-life-ish decay time (ms). Larger = longer trails.
 * @param {number}  [args.intensity=1] Peak glint brightness written to px.w in [0..1].
 * @param {boolean} [args.audioDensity=false]  When true, add signals.micHigh to the spawn density.
 * @param {object}  [args.signals]     Optional read-only signals bag (micHigh). Missing ⇒ 0.
 */
export function applyFrostSparkle({
  pixels,
  state,
  enabled,
  nowMs,
  density,
  decayMs = DEFAULT_DECAY_MS,
  intensity = 1,
  audioDensity = false,
  signals,
}) {
  if (!Array.isArray(pixels)) {
    throw new Error('applyFrostSparkle: pixels array is required');
  }
  if (!state || typeof state !== 'object') {
    throw new Error('applyFrostSparkle: state object is required (createSparkleState())');
  }

  // Zero-cost gate. NOTE: the controller should call resetSparkle() on its
  // disable path so glints don't linger frozen; this early-return only
  // guarantees the disabled effect touches no pixels.
  if (!enabled) return;

  const pixelCount = pixels.length;
  ensureArray(state, pixelCount);
  const spark = state.spark;

  // ── dt (ms since last frame) ──────────────────────────────────────
  // First frame after (re)enable has no reference — use the reference dt so
  // spawn/decay behave nominally rather than exploding or stalling.
  let dt = REFERENCE_DT_MS;
  if (state.lastMs !== null) {
    const d = nowMs - state.lastMs;
    // Clamp to a sane band: a paused/resumed clock must not dump a huge dt.
    dt = d > 0 ? (d > 200 ? 200 : d) : REFERENCE_DT_MS;
  }
  state.lastMs = nowMs;

  // ── effective spawn density ───────────────────────────────────────
  let dens = density < 0 ? 0 : density;
  if (audioDensity) dens += readMicHigh(signals);
  // Expected number of glints this frame, scaled by the real frame delta so
  // the look is frame-rate independent.
  const dtScale = dt / REFERENCE_DT_MS;
  let expected = dens * pixelCount * dtScale;

  // ── spawn ─────────────────────────────────────────────────────────
  // Integer part spawns deterministically-many; fractional part spawns one
  // more with matching probability (unbiased expected value).
  const rng = state.rng;
  const peak = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
  let toSpawn = Math.floor(expected);
  const frac = expected - toSpawn;
  if (frac > 0 && rng() < frac) toSpawn += 1;
  // A blizzard can't spawn more glints than there are pixels.
  if (toSpawn > pixelCount) toSpawn = pixelCount;
  for (let s = 0; s < toSpawn; s++) {
    const idx = (rng() * pixelCount) | 0;
    if (spark[idx] === 0) state.activeCount++;
    spark[idx] = peak;
  }

  // ── decay + draw ──────────────────────────────────────────────────
  // Per-frame decay factor derived from decayMs and this frame's dt.
  // decayMs<=0 ⇒ single-frame glints (factor 0).
  const decayFactor = decayMs > 0 ? Math.exp(-dt / decayMs) : 0;

  // Nothing lit and nothing spawned ⇒ skip the whole pixel loop.
  if (state.activeCount === 0) return;

  for (let i = 0; i < pixelCount; i++) {
    let e = spark[i];
    if (e === 0) continue;
    // Additive ice-white glint into W ONLY (survives downstream hue/invert).
    const w = pixels[i].w + e;
    pixels[i].w = w > 1 ? 1 : w;
    // Decay for next frame; snap sub-epsilon energy to dead.
    e *= decayFactor;
    if (e < DEAD_EPSILON) {
      spark[i] = 0;
      state.activeCount--;
    } else {
      spark[i] = e;
    }
  }
}

export const frostSparkleEffect = {
  apply: applyFrostSparkle,
  createState: createSparkleState,
  reset: resetSparkle,
};
