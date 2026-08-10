/**
 * effects/group_fixed_color.js — per-group fixed-color override
 *
 * Stateless repaint of every pixel whose `group` has an entry in the
 * overrides table. The table itself (which groups, what color, what
 * brightness) is runtime state owned by GlobalEffectsController
 * (`groupFixedColors`), mirroring the colorWash/feedbackTrails split
 * between state (controller) and math (effects/).
 *
 * Pipeline position (docs/32 §2.2): applied ONCE per frame, AFTER
 * applyMacros() — so wash/trails/strobe cannot repaint a locked
 * group — and BEFORE IntensityController.apply(), so section dimmers
 * and blackout keep the final say. This replaces the summer-camp
 * djLights hack's duplicated apply sites.
 */

/**
 * @param {object} args
 * @param {Array}  args.pixels     Post-mixer model.pixels.
 * @param {object} args.overrides  { [groupName]: { color: number[6], brightness: number,
 *                                                  colors?: number[6][] } }
 * @param {number[]} [args.groupIndex]  Per-pixel ordinal WITHIN its group
 *   (pixel_group_index.derivePixelGroupIndices). Required only when some
 *   override carries `colors`; a single-colour override never reads it.
 */
export function applyGroupFixedColors({ pixels, overrides, groupIndex }) {
  if (!overrides || typeof overrides !== 'object') {
    throw new Error('applyGroupFixedColors: overrides table is required');
  }
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    const ov = px.group !== undefined ? overrides[px.group] : undefined;
    if (!ov) continue;
    const b = ov.brightness;
    /* A group may hold ONE colour (painted flat, the original behaviour) or a
       WHOLE PALETTE spread across its own pixels. The spread is keyed on the
       pixel's ordinal within its group, NOT on its index in the model and NOT
       on localIndex: localIndex is per FIXTURE, and 16 of the 24 titanic groups
       hold several fixtures, so on Right SmokeStacks (8 single-pixel pars)
       every pixel has localIndex 0 and the palette would collapse to one
       colour. pixel_group_index exists precisely for this. */
    let c = ov.color;
    if (ov.colors && ov.colors.length) {
      if (!groupIndex) {
        throw new Error(
          'applyGroupFixedColors: an override carries `colors` but no groupIndex was '
          + 'supplied - the per-group ordinal is what spreads a palette across a group');
      }
      c = ov.colors[groupIndex[i] % ov.colors.length];
    }
    px.r = c[0] * b;
    px.g = c[1] * b;
    px.b = c[2] * b;
    px.w = c[3] * b;
    px.a = c[4] * b;
    px.u = c[5] * b;
  }
}

export const groupFixedColorEffect = {
  apply: applyGroupFixedColors,
};
