/**
 * GlobalEffectsController
 *
 * Implements isolated active scene modifiers for "full-rig" hardware actions.
 * Operates alongside the IntensityController but specifically targets non-dimming
 * overrides (like UV logic, Fogger DMX bypassing, or Vintage LED Glow forcing)
 */
export class GlobalEffectsController {
  constructor(config = {}) {
    this.effects = {
      vintageWhite: false,
      fogger: false,
      uvBlast: false,
      placeholder1: false,
      placeholder2: false,
      placeholder3: false
    };

    this.config = config.global_effects || { fogger: { universe: 1, address: 512 } };
  }

  setEffect(effectName, state) {
    if (this.effects.hasOwnProperty(effectName)) {
      this.effects[effectName] = !!state;
    }
  }

  // Applies physical pixel metadata mutations *after* WASM processing
  // Modifies .w (White) on Vintage, or .u (UV) across everything
  applyPixels(pixels) {
    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i];

      if (this.effects.vintageWhite) {
        if (px.fixtureType === 'VintageLed' && px.name.includes('_warm') && px.w !== undefined) {
          px.w = 1.0;
        }
      }

      if (this.effects.uvBlast && px.channels && px.channels.u !== undefined) {
        px.u = 1.0;
      }
    }
  }

  // Intended to bypass pixel structures entirely, directly injecting raw DMX channels
  // Operates *after* mapPixelsToSacn builds the outgoing frame!
  applyDmx(dmxBuffers) {
    if (!this.config.fogger) return;
    
    // dmxBuffers is an object mapping universe -> Uint8Array
    const frame = dmxBuffers[this.config.fogger.universe];
    if (!frame) return; // Universe not initialized

    if (this.effects.fogger) {
      frame[this.config.fogger.address - 1] = 255;
    } else {
      frame[this.config.fogger.address - 1] = 0;
    }
  }
}
