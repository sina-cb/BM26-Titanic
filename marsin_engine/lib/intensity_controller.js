/**
 * IntensityController
 *
 * Isolates global brightness scaling and emergency blackout logic from the
 * main engine loop. Maps incoming REST commands (per section ID or global)
 * directly to the pixel state.
 */
export class IntensityController {
  constructor() {
    this.sectionBrightness = {};
    this.blackoutActive = false;
  }

  setSectionBrightness(sectionId, val) {
    this.sectionBrightness[sectionId] = Math.max(0.0, Math.min(1.0, val));
  }

  setBlackout(state) {
    this.blackoutActive = !!state;
  }

  apply(pixels) {
    // 1. Hardware Blackout Override
    if (this.blackoutActive) {
      for (let i = 0; i < pixels.length; i++) {
        pixels[i].r = 0;
        pixels[i].g = 0;
        pixels[i].b = 0;
        pixels[i].w = 0;
        pixels[i].a = 0;
        pixels[i].u = 0;
      }
      return;
    }

    // 2. Local Section Intensity Scaling
    // If no custom brightness values have been requested, bypass math completely
    if (Object.keys(this.sectionBrightness).length === 0) return;

    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i];
      const sId = px.sId;
      
      if (sId !== undefined && this.sectionBrightness[sId] !== undefined) {
        const scale = this.sectionBrightness[sId];
        // Only trigger float multiplication if scale isn't native 100%
        if (scale < 1.0) {
          px.r *= scale;
          px.g *= scale;
          px.b *= scale;
          px.w *= scale;
          px.a *= scale;
          px.u *= scale;
        }
      }
    }
  }
}
