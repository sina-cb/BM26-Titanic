/**
 * effects/movement_trace.js - MOVEMENT family: patterns that travel along a
 * group, keyed on where a pixel sits inside that group.
 *
 * Every other global effect is either coordinate-blind (strobe, breath, pump)
 * or keyed on world coordinates (waterlineSweep reads nx/ny/nz). This one is
 * keyed on the pixel's ORDINAL within its group - 0 at one end of the run,
 * n-1 at the other - so the same effect walks a 90-pixel wall, a 40-pixel LED
 * strand and a row of eight single-pixel pars, each at its own length, without
 * knowing anything about where they are in space.
 *
 * THREE SHAPES - they differ in HOW MUCH of the palette is on the rig at once,
 * which is the thing an operator actually chooses between:
 *
 *   one_per_color  ALL the palette colours at once. Pixel k takes colour
 *                  k mod N, laid along the run, and the whole ladder crawls.
 *
 *   every_other    TWO colours at once. Alternate pixels take one palette
 *                  colour and the rest take the next (or go dark), and BOTH
 *                  step through the palette as it travels - so the pair walks
 *                  the palette instead of being stuck on the first two.
 *
 *   whole_group    ONE colour at a time. A whole group holds a single palette
 *                  colour and the next group holds the next, so the colours
 *                  march across the ship group by group rather than pixel by
 *                  pixel. This is the only mode that reads on a group of one
 *                  or two pixels.
 *
 * A NOTE ON THE PALETTE: these place the colours they are GIVEN. Hand them
 * five copies of one colour and every mode above is one flat colour - working
 * exactly as told. The spread has to come from the palette.
 *
 * TWO TRAVELS - chosen by how the CALLER advances `phase`, not here:
 *
 *   repeat         phase wraps 0 -> n -> 0: the pattern runs off one end and
 *                  reappears at the other, always the same direction.
 *   reverse        phase ping-pongs 0 -> n -> 0: the pattern runs to the end
 *                  of the strand and comes back.
 *
 * Keeping travel in the caller is what makes the two modes share one piece of
 * maths: this function only ever asks "given this phase, what colour is pixel
 * k of n". A tempo change or a direction flip moves `phase` and nothing here
 * has to know.
 *
 * COLOUR comes from the caller's palette - the operator's five colours - so
 * this is a movement effect, not a colour effect: it decides WHERE the chosen
 * colours sit and how they travel, never what they are.
 *
 * Stateless and allocation-free. Zero cost when off (the caller gates).
 */

/**
 * Blend one channel toward a target by `amount`.
 * amount 1 replaces outright, 0 leaves the pixel alone.
 */
function mix(current, target, amount) {
  return current + (target - current) * amount;
}

/**
 * Smoothstep - an eased 0..1 ramp. A LINEAR crossfade still reads as a tick at
 * both ends because the rate of change starts and stops abruptly; easing the
 * ends is what makes a travelling pattern look like it flows rather than
 * clicking from one position to the next.
 */
function ease(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * Colour of ordinal `o` in `mode`, written into `out` (6 channels).
 * Split out so a step and the NEXT step can be evaluated with identical
 * maths and crossfaded between - the whole point of `fadeSpan`.
 */
function colorAt(mode, colors, nColors, o, gid, blank, out) {
  if (mode === 'one_per_color') {
    const c = colors[o % nColors];
    for (let k = 0; k < 6; k++) out[k] = c[k];
    return true;
  }
  if (mode === 'whole_group' || mode === 'pulse') {
    const c = colors[(((gid % nColors) + nColors) % nColors)];
    for (let k = 0; k < 6; k++) out[k] = c[k];
    return true;
  }
  // every_other: both colours walk the palette as the pattern travels.
  const base = (((gid % nColors) + nColors) % nColors);
  if ((o % 2) === 0) {
    const c = colors[base];
    for (let k = 0; k < 6; k++) out[k] = c[k];
    return true;
  }
  if (blank) {
    for (let k = 0; k < 6; k++) out[k] = 0;
    return true;
  }
  const c = colors[(base + 1) % nColors];
  for (let k = 0; k < 6; k++) out[k] = c[k];
  return true;
}

/* Scratch buffers, module-level so the per-pixel loop allocates nothing. */
const A6 = [0, 0, 0, 0, 0, 0];
const B6 = [0, 0, 0, 0, 0, 0];

/**
 * Paint a travelling per-group pattern.
 *
 * @param {object}   args
 * @param {Array}    args.pixels      Post-mixer model.pixels.
 * @param {number[]} args.groupIndex  Per-pixel ordinal within its group.
 * @param {number[]} args.groupSize   Per-pixel size of its group.
 * @param {number}   args.phase       Travel position, in pixels. May exceed
 *                                    the group length or be negative; it is
 *                                    wrapped per group.
 * @param {string}   args.mode        'every_other' | 'one_per_color'
 * @param {Array<number[]>} args.colors  Palette, each entry a 6-channel array
 *                                    [r,g,b,w,a,u] in 0..1. At least one.
 * @param {number}   args.amount      0..1 blend against what is already there.
 * @param {boolean}  args.blank       every_other only: dark gaps instead of a
 *                                    second colour.
 * @param {number}   args.fadeSpan    0..1. How much of each step is spent
 *                                    crossfading into the next. 0 = hard cut
 *                                    (jumps), 1 = continuous flow.
 */
export function applyMovementTrace({
  pixels, groupIndex, groupSize, groupId, phase, mode, colors, amount, blank, fadeSpan, level,
}) {
  if (!Array.isArray(pixels)) {
    throw new Error('applyMovementTrace: pixels must be an array');
  }
  if (!Array.isArray(groupIndex) || !Array.isArray(groupSize)) {
    throw new Error('applyMovementTrace: groupIndex and groupSize are required');
  }
  if ((mode === 'whole_group' || mode === 'pulse') && !Array.isArray(groupId)) {
    throw new Error('applyMovementTrace: whole_group needs groupId');
  }
  if (!Array.isArray(colors) || colors.length === 0) {
    throw new Error('applyMovementTrace: colors must be a non-empty array');
  }
  if (mode !== 'every_other' && mode !== 'one_per_color' && mode !== 'whole_group' && mode !== 'pulse') {
    throw new Error(`applyMovementTrace: unknown mode "${mode}"`);
  }

  // The pattern advances in WHOLE PIXELS - a colour belongs to a pixel, not to
  // a position between two of them. What `fadeSpan` changes is how it gets
  // there: 0 snaps to the next step (the old hard cut), 1 crossfades across the
  // whole step so the colours flow into each other and never jump.
  const step = Math.floor(phase);
  const frac = phase - step;
  /* LEVEL dims the TARGET COLOUR, not the blend amount. Dimming the blend
     would fade the pattern out and reveal whatever is underneath it; dimming
     the colour takes the light itself down toward black, which is what a pulse
     fading away has to do. */
  const lvl = (level === undefined || level === null) ? 1 : (level < 0 ? 0 : (level > 1 ? 1 : level));
  const nColors = colors.length;
  const span = fadeSpan === undefined ? 0 : Math.min(Math.max(fadeSpan, 0), 1);
  // Crossfade toward the NEXT step, eased. Outside the fade window this is
  // exactly 0, so a zero span costs nothing and behaves as before.
  const blend = span <= 0 ? 0 : ease(Math.min(1, frac / span));

  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (!px) continue;
    const n = groupSize[i];
    if (n <= 0) continue;

    // Position along this group's own run, wrapped into 0..n-1. The double
    // modulo keeps a negative phase (a reversing trace) positive.
    const gi = groupIndex[i];
    const o = (((gi + step) % n) + n) % n;
    const gid = groupId ? groupId[i] + step : step;

    colorAt(mode, colors, nColors, o, gid, blank, A6);

    if (blend > 0) {
      // Where this pixel is heading one step from now, blended in.
      const o2 = (((gi + step + 1) % n) + n) % n;
      colorAt(mode, colors, nColors, o2, gid + 1, blank, B6);
      px.r = mix(px.r, (A6[0] + (B6[0] - A6[0]) * blend) * lvl, amount);
      px.g = mix(px.g, (A6[1] + (B6[1] - A6[1]) * blend) * lvl, amount);
      px.b = mix(px.b, (A6[2] + (B6[2] - A6[2]) * blend) * lvl, amount);
      px.w = mix(px.w, (A6[3] + (B6[3] - A6[3]) * blend) * lvl, amount);
      px.a = mix(px.a, (A6[4] + (B6[4] - A6[4]) * blend) * lvl, amount);
      px.u = mix(px.u, (A6[5] + (B6[5] - A6[5]) * blend) * lvl, amount);
      continue;
    }

    px.r = mix(px.r, A6[0] * lvl, amount);
    px.g = mix(px.g, A6[1] * lvl, amount);
    px.b = mix(px.b, A6[2] * lvl, amount);
    px.w = mix(px.w, A6[3] * lvl, amount);
    px.a = mix(px.a, A6[4] * lvl, amount);
    px.u = mix(px.u, A6[5] * lvl, amount);
  }
}

export const movementTraceEffect = {
  apply: applyMovementTrace,
  /* Primary intensity: how hard the trace is laid over what is already
     there. `amount` 1 replaces the pixel outright, 0 leaves it alone - the
     same knob the controller already scales, and the one an audio binding
     rides (GlobalEffectsController.audioDrivenPrimary).

     WHY THIS IS BEING ADDED HERE. Every GEM-bindable effect MUST declare a
     primaryIntensity (or an explicit null) and be listed in the registry;
     this module shipped without one, so `movementTrace` was in the effect
     library but absent from PRIMARY_INTENSITY_REGISTRY. That is a hard test
     failure (tests/effects/global_effect_intensity.test.js and its
     primary-mode twin), and it made getPrimaryIntensity('movementTrace')
     THROW - which any caller that asks "can audio drive this effect?" has to
     survive. */
  primaryIntensity: { label: 'Trace Amount', param: 'amount', default: 1, min: 0, max: 1 },
  /* Primary mode: NONE - explicit null rather than an invented wheel. The
     shape of the trace (every_other / one_per_color / whole_group / pulse)
     and its direction (repeat / reverse) are chosen by PRESET - that is what
     the nine movement presets in the library are - so there is no single
     discrete axis for an encoder to cycle. Declaring null says "considered,
     and there deliberately isn't one" instead of leaving it undeclared. */
  primaryMode: null,
};
