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
 * @param {object} args.overrides  { [groupName]: { color: number[6], brightness: number } }
 */
export function applyGroupFixedColors({ pixels, overrides }) {
  if (!overrides || typeof overrides !== 'object') {
    throw new Error('applyGroupFixedColors: overrides table is required');
  }
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    const ov = px.group !== undefined ? overrides[px.group] : undefined;
    if (!ov) continue;
    const c = ov.color;
    const b = ov.brightness;
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
