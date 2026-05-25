/**
 * effects/vintageWhite.js — Vintage White boost (legacy rig-globals)
 *
 * Pixel-channel override: drives the white channel of `VintageLed` head
 * fixtures to 1.0. Migrated into the Global Effect Macros library as a
 * `toggle` effect in May 2026 so the unified GEM grid replaces the
 * separate RigGlobals strip.
 *
 * Why a thin wrapper instead of inlining the loop into the GEM pipeline:
 *   - The underlying behaviour (which pixels match, the `bypassDimmer`
 *     contract for IntensityController) was already implemented inside
 *     GlobalEffectsController.applyPixels. That code is the source of
 *     truth and stays here intact — the slot dispatcher just flips the
 *     `controller.effects.vintageWhite` boolean.
 *   - The effect is dimmer-aware (it sets `px.ignoreDimmerForW = true`
 *     when bypassed) so it CANNOT live in the post-mixer / pre-blackout
 *     macro pipeline — it must run from `applyPixels` like before.
 */

export const vintageWhiteEffect = {
  /**
   * Pure stateless apply isn't used at runtime — GlobalEffectsController
   * handles it inline in applyPixels (legacy path). Exported only so
   * standalone unit tests can exercise the same logic without spinning
   * up the controller.
   */
  apply({ pixels, bypassDimmer = false }) {
    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i];
      if (px.fixtureType === 'VintageLed' && px.name && px.name.includes('head_')
          && px.channels && px.channels.w !== undefined) {
        px.w = 1.0;
        if (bypassDimmer) px.ignoreDimmerForW = true;
      }
    }
  },
};
