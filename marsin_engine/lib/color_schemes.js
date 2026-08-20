/**
 * color_schemes — the NINE scheme generators, engine-side (docs/59 §3).
 *
 * WHY THIS EXISTS. The generators used to live client-side only
 * (`CaptainPad/components/deck/colors_window_logic.ts`), which was fine while
 * the only thing that ever generated a ring was an operator's finger on the
 * COLORS window: the client generated five colours and POSTed them as a
 * literal ring. FOLLOW NOTE (docs/59 §1) breaks that assumption — the base hue
 * now moves with the music, so the ring has to be RE-DERIVED inside the engine
 * on every committed note change. A precomputed client ring cannot express a
 * hue nobody has played yet.
 *
 * ONE CONTRACT, TWO IMPLEMENTATIONS. This module is a byte-equivalent port,
 * not a re-derivation. It has ZERO CaptainPad imports (the client is an Expo
 * app; the engine must boot without it), so the two are kept honest the
 * `lerpHue` way (_217 D1): a single REFERENCE TABLE of exact outputs — all 9
 * scheme ids × 3 base hues → the full five `{h,s,v}` triples — is asserted in
 * BOTH suites, `marsin_engine/tests/effects/color_schemes.test.js` and
 * `CaptainPad/components/deck/colors_window_logic.test.ts`. Change either
 * implementation and a test breaks on both sides, so the ring the operator
 * STAGED on the glass and the ring the daemon DERIVES on the rig can never
 * disagree.
 *
 * Every constant below is the client's, unchanged; the block comments there
 * carry the design rationale (the Live Touch provenance of the first four, the
 * adjacent-pair / no-dead-beat shaping rules of the `_224` five, and the
 * night-visibility floor). It is deliberately NOT restated here — one
 * rationale, one place, so the two copies cannot drift in their reasoning
 * either.
 */

/** The nine generator ids, in the client's row order (muscle memory is part of
 *  the contract: the UI lays its chips out in exactly this order). */
export const SCHEME_IDS = [
  'master', 'hue', 'complement', 'contrast',
  'analogous', 'triadic', 'split', 'tetrad', 'golden',
];

/** Live Touch `BASE.s`. The base input is a HUE ONLY, so S comes from here. */
export const SCHEME_BASE_S = 0.95;
/** Live Touch `MONO_STEPS` — the HUE scheme's five brightnesses. */
export const MONO_STEPS = [1.0, 0.78, 0.58, 0.40, 0.25];
/** Live Touch `COMP_OFFSETS`, in DEGREES. */
export const COMP_OFFSETS = [0, 60, 30, -30, -60];
/** Live Touch's `v` floor on the HUE ramp — a slot never goes fully dark. */
export const SCHEME_MIN_V = 0.1;
/** The `_224` generators' night-visibility floor (mission line 1). */
export const SCHEME_ROTATION_MIN_V = 0.25;

/** `[degreesFromBase, brightness]` — the shape every `_224` generator is built from. */
export const ANALOGOUS_STEPS = [[0, 1], [15, 1], [-15, 1], [30, 1], [-30, 1]];
export const TRIADIC_STEPS = [[0, 1], [120, 1], [240, 1], [0, 0.55], [120, 0.55]];
export const SPLIT_STEPS = [[0, 1], [150, 1], [210, 1], [150, 0.55], [210, 0.55]];
export const TETRAD_STEPS = [[0, 1], [90, 1], [180, 1], [270, 1], [0, 0.55]];
export const GOLDEN_ANGLE_DEG = 137.5;

/** Live Touch `rot(h, deg)`: rotate a hue by whole degrees, wrapping. */
export function rotateHue(h, deg) {
  const d = ((deg % 360) + 360) % 360;
  return (h + d / 360) % 1;
}

/** Five `[deg, v]` steps → five colours from a base hue, at the shared base
 *  saturation and under the night-visibility floor. */
export function schemeFromSteps(steps, baseH) {
  return steps.map(([deg, v]) => ({
    h: rotateHue(baseH, deg),
    s: SCHEME_BASE_S,
    v: Math.max(SCHEME_ROTATION_MIN_V, v),
  }));
}

/**
 * Generate a scheme's five colours from a base hue.
 *
 * TOTAL over `SCHEME_IDS`; an unknown id THROWS (codex P0). In the daemon that
 * matters more than it does on the glass: a generator that quietly produced
 * nothing would leave the rig frozen on the previous ring with the card still
 * claiming to be cycling, which is indistinguishable from a dead companion.
 *
 * The base hue must be a finite number ON THE WHEEL, `[0,1]` — it THROWS
 * otherwise. This is a boundary check, NOT a wrap: the client's generator takes
 * its base verbatim, and `((h % 1) + 1) % 1` is famously not the identity on
 * an in-range hue (it turns 0.1 into 0.10000000000000009), so silently
 * "normalizing" here would put the engine's ring a float off the client's and
 * break the parity table for exactly the hues that look safest. The daemon
 * feeds this `audioNoteHue`, whose CPC range is already `[0,1]`; a NaN or an
 * off-wheel value there is a broken feed and must fail loudly at this boundary
 * rather than propagate five NaN colours into a tween that writes them to the
 * rig.
 */
export function generateScheme(scheme, baseH) {
  if (typeof baseH !== 'number' || !Number.isFinite(baseH) || baseH < 0 || baseH > 1) {
    throw new Error(`[color_schemes] base hue must be a number in [0,1], got ${JSON.stringify(baseH)}`);
  }
  const S = SCHEME_BASE_S;
  const base = baseH;
  switch (scheme) {
    case 'master':
      return MONO_STEPS.map(() => ({ h: base, s: S, v: 1 }));
    case 'hue':
      return MONO_STEPS.map((k) => ({ h: base, s: S, v: Math.max(SCHEME_MIN_V, k) }));
    case 'complement':
      return COMP_OFFSETS.map((d) => ({ h: rotateHue(base, d), s: S, v: 1 }));
    case 'contrast':
      return [0, 1, 2, 3, 4].map((i) => ({ h: rotateHue(base, 72 * i), s: S, v: 1 }));
    case 'analogous':
      return schemeFromSteps(ANALOGOUS_STEPS, base);
    case 'triadic':
      return schemeFromSteps(TRIADIC_STEPS, base);
    case 'split':
      return schemeFromSteps(SPLIT_STEPS, base);
    case 'tetrad':
      return schemeFromSteps(TETRAD_STEPS, base);
    case 'golden':
      return schemeFromSteps([0, 1, 2, 3, 4].map((i) => [GOLDEN_ANGLE_DEG * i, 1]), base);
    default:
      throw new Error(`[color_schemes] unknown scheme '${scheme}'`);
  }
}

/** Operator-facing scheme names, in row order. Shared so an engine-side
 *  refusal names the generator the way the chip on the glass does. */
export const SCHEME_TITLES = {
  master: 'MASTER',
  hue: 'HUE',
  complement: 'COMPLEMENT',
  contrast: 'CONTRAST',
  analogous: 'ANALOGOUS',
  triadic: 'TRIADIC',
  split: 'SPLIT',
  tetrad: 'TETRAD',
  golden: 'GOLDEN',
};
