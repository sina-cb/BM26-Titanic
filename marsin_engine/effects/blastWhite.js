/**
 * effects/blastWhite.js — Blast White (all-channels white wash)
 *
 * Slams every supported channel (RGB + W + A where present) to 1.0.
 * Migrated into the Global Effect Macros library in May 2026 — see
 * vintageWhite.js for the rationale.
 */

export const blastWhiteEffect = {
  apply({ pixels, bypassDimmer = false }) {
    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i];
      if (!px.channels) continue;
      px.r = 1.0; px.g = 1.0; px.b = 1.0;
      if (px.channels.w !== undefined) px.w = 1.0;
      if (px.channels.a !== undefined) px.a = 1.0;
      if (bypassDimmer) {
        px.ignoreDimmerForRGB = true;
        px.ignoreDimmerForW = true;
        px.ignoreDimmerForA = true;
      }
    }
  },
};
