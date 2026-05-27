/**
 * effects/uvBlast.js — UV Blast (drives UV channel to 1.0)
 *
 * Migrated into the Global Effect Macros library in May 2026.
 * See vintageWhite.js for rationale.
 */

export const uvBlastEffect = {
  apply({ pixels, bypassDimmer = false }) {
    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i];
      if (px.channels && px.channels.u !== undefined) {
        px.u = 1.0;
        if (bypassDimmer) px.ignoreDimmerForU = true;
      }
    }
  },
};
