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
      blastWhite: false,
      horn: false,
      fire: false,
      vintageWhiteBypassDimmer: false,
      uvBlastBypassDimmer: false,
      blastWhiteBypassDimmer: false
    };
    
    this.foggers = []; // Dynamically populated from the model
    this.horns = [];
    this.fires = [];
  }

  setEffect(effectName, state) {
    if (this.effects.hasOwnProperty(effectName) || effectName.includes('Bypass')) {
      this.effects[effectName] = !!state;
    }
  }

  // Scan the model pixels to find exported Global Effect fixtures.
  // These fixtures are exported from the simulation with `channels: null` to bypass the WASM pattern mapper,
  // but they carry full DMX patch info so this controller can inject raw DMX overrides below.
  initFromModel(effectsArray) {
    this.foggers = [];
    this.horns = [];
    this.fires = [];
    if (!effectsArray) return;
    for (let i = 0; i < effectsArray.length; i++) {
      const fx = effectsArray[i];
      if (!fx.patch || !fx.patch.universe || !fx.patch.addr) continue;

      const patchInfo = {
        type: fx.fixtureType,
        universe: fx.patch.universe,
        address: fx.patch.addr,
        kind: fx.kind || ''
      };

      if (patchInfo.kind === 'fog' || patchInfo.kind === 'haze' || (fx.fixtureType && (fx.fixtureType.includes('Fog') || fx.fixtureType === 'ChauvetHaze4D'))) {
        this.foggers.push(patchInfo);
      } else if (patchInfo.kind === 'horn' || (fx.fixtureType && fx.fixtureType.includes('Horn'))) {
        this.horns.push(patchInfo);
      } else if (patchInfo.kind === 'fire' || (fx.fixtureType && fx.fixtureType.includes('Fire'))) {
        this.fires.push(patchInfo);
      }
    }
  }

  // Applies physical pixel metadata mutations *after* WASM processing
  // Modifies .w (White) on Vintage, or .u (UV) across everything
  applyPixels(pixels) {
    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i];
      px.ignoreDimmerForRGB = false;
      px.ignoreDimmerForW = false;
      px.ignoreDimmerForA = false;
      px.ignoreDimmerForU = false;

      if (this.effects.vintageWhite) {
        if (px.fixtureType === 'VintageLed' && px.name.includes('head_') && px.channels && px.channels.w !== undefined) {
          px.w = 1.0;
          if (this.effects.vintageWhiteBypassDimmer) px.ignoreDimmerForW = true;
        }
      }

      if (this.effects.uvBlast && px.channels && px.channels.u !== undefined) {
        px.u = 1.0;
        if (this.effects.uvBlastBypassDimmer) px.ignoreDimmerForU = true;
      }

      if (this.effects.blastWhite) {
        if (px.channels) {
          px.r = 1.0;
          px.g = 1.0;
          px.b = 1.0;
          if (px.channels.w !== undefined) px.w = 1.0;
          if (px.channels.a !== undefined) px.a = 1.0;
          
          if (this.effects.blastWhiteBypassDimmer) {
            px.ignoreDimmerForRGB = true;
            px.ignoreDimmerForW = true;
            px.ignoreDimmerForA = true;
          }
        }
      }
    }
  }

  // Intended to bypass pixel structures entirely, directly injecting raw DMX channels
  // Operates *after* mapPixelsToSacn builds the outgoing frame!
  applyDmx(dmxBuffers) {
    for (const fogger of this.foggers) {
      const frame = dmxBuffers[fogger.universe];
      if (!frame) continue; // Universe not initialized

      const isChauvet = fogger.type === 'ChauvetHaze4D';

      if (this.effects.fogger) {
        if (isChauvet) {
          // Chauvet Haze 4D: Ch1 = Fan (255), Ch2 = Haze Volume (255)
          frame[fogger.address - 1] = 255;
          frame[fogger.address] = 255;
        } else {
          // TE Fog Machine: Ch1 = Fog Output (255)
          frame[fogger.address - 1] = 255;
        }
      } else {
        if (isChauvet) {
          frame[fogger.address - 1] = 0;
          frame[fogger.address] = 0;
        } else {
          frame[fogger.address - 1] = 0;
        }
      }
    }

    for (const horn of this.horns) {
      const frame = dmxBuffers[horn.universe];
      if (!frame) continue;
      frame[horn.address - 1] = this.effects.horn ? 255 : 0;
    }

    for (const fire of this.fires) {
      const frame = dmxBuffers[fire.universe];
      if (!frame) continue;
      frame[fire.address - 1] = this.effects.fire ? 255 : 0;
    }
  }
}
