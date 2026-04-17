/**
 * sacn_mapper.js
 * Modular helper functions for Mapping and Demapping sACN packets
 */

/**
 * Demaps a DMX frame back into simulation pixel colors (for sacn_in)
 * @param {Object} list - The batch render list containing pixels
 * @param {Object} dmxRouter - The router containing DMX universes
 */
export function demapSacnToPixels(list, dmxRouter) {
  if (!list || !dmxRouter) return;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry.patch || !entry.channels) continue;
    
    const frame = dmxRouter.getFullFrame(entry.patch.universe);
    if (!frame) continue;
    
    const addr = entry.patch.addr - 1; // 0-indexed
    const ch = entry.channels;
    let r = 0, g = 0, b = 0;
    
    if (ch.r !== undefined && ch.g !== undefined && ch.b !== undefined) {
      r = frame[addr + ch.r - 1] / 255;
      g = frame[addr + ch.g - 1] / 255;
      b = frame[addr + ch.b - 1] / 255;
      
      // If the fixture also has WAU channels driven by sACN, we could theoretically mix them in for simulation preview!
      // Here we simulate the hardware fallback directly in the simulation
      if (ch.w !== undefined) {
        const w = frame[addr + ch.w - 1] / 255;
        r = Math.min(1, r + w);
        g = Math.min(1, g + w);
        b = Math.min(1, b + w);
      }
      if (ch.a !== undefined) {
        const a = frame[addr + ch.a - 1] / 255;
        r = Math.min(1, r + a * 0.8);
        g = Math.min(1, g + a * 0.4);
      }
      if (ch.u !== undefined) {
        const u = frame[addr + ch.u - 1] / 255;
        r = Math.min(1, r + u * 0.1);
        b = Math.min(1, b + u * 0.5);
      }
    } else if (ch.w !== undefined) {
      // Monochromatic fixture preview
      const w = frame[addr + ch.w - 1] / 255;
      r = w; g = w; b = w;
    }
    
    if (entry.apply) entry.apply(r, g, b);
  }
}

/**
 * Maps simulation pixel colors into outgoing DMX frame buffers (for Pixelblaze and Gradient modes)
 * @param {Object} list - The batch render list containing pixels
 * @param {Object} dmxRouter - The router containing DMX universes
 */
export function mapPixelsToSacn(list, dmxRouter) {
  if (!list || !dmxRouter) return;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry.patch || !entry.channels) continue;
    
    // Auto-create missing universe buffers dynamically in the router if they exist in the model
    let buf = dmxRouter.getFullFrame(entry.patch.universe);
    if (!buf) {
      if (dmxRouter.createUniverse) dmxRouter.createUniverse(entry.patch.universe);
      buf = dmxRouter.getFullFrame(entry.patch.universe);
      if (!buf) continue;
    }
    
    const addr = entry.patch.addr - 1; // 0-indexed buffer
    let ch = entry.channels;
    
    // Polyfill if the model serialized channels as a flat number (e.g., 3 for RGB)
    // Legacy model.js exports `channels: 3` and `type: 'par'` for Par lights.
    if (typeof ch === 'number') {
      const isPar = entry.type === 'par' || entry.fixtureType === 'UkingPar' || entry.fixtureType === 'VintageLed';
      const fp = entry.patch.footprint;
      if (isPar && fp >= 10) {
        ch = { r: 3, g: 4, b: 5, w: 6, a: 7, u: 8 };
      } else if (fp === 6) {
         // Typical Shehds individual pixel
        ch = { r: 1, g: 2, b: 3, w: 4, a: 5, u: 6 };
      } else {
        // Standard RGB
        ch = { r: 1, g: 2, b: 3 }; 
        if (typeof entry.channels === 'number' && entry.channels >= 4) ch.w = 4;
      }
    }
    
    // Auto-set the master dimmers to 100%
    if (entry.type === 'par' || entry.fixtureType === 'UkingPar' || entry.fixtureType === 'VintageLed' || entry.fixtureType === 'ShehdsBar') {
      buf[addr + 0] = 255;
    }
    // Wait! Do not force global RGBWAUV dimmers to 255, as it blasts the fixture to full white.
    // Individual pixels are addressed starting at channel 12, so globals (6-11) should stay 0.

    if (ch.r !== undefined && ch.g !== undefined && ch.b !== undefined) {
      buf[addr + ch.r - 1] = Math.max(0, Math.min(255, entry.r * 255)) || 0;
      buf[addr + ch.g - 1] = Math.max(0, Math.min(255, entry.g * 255)) || 0;
      buf[addr + ch.b - 1] = Math.max(0, Math.min(255, entry.b * 255)) || 0;
      
      // Extended channels natively emitted by Marsin Engine (6-channel WAU values mapped back into entry by renderer)
      if (ch.w !== undefined) buf[addr + ch.w - 1] = (entry.w !== undefined) ? Math.max(0, Math.min(255, entry.w * 255)) : Math.min(buf[addr + ch.r - 1], buf[addr + ch.g - 1], buf[addr + ch.b - 1]);
      if (ch.a !== undefined && entry.a !== undefined) buf[addr + ch.a - 1] = Math.max(0, Math.min(255, entry.a * 255));
      if (ch.u !== undefined && entry.u !== undefined) buf[addr + ch.u - 1] = Math.max(0, Math.min(255, entry.u * 255));
    } else if (ch.w !== undefined) {
      const luma = entry.w !== undefined ? entry.w * 255 : ((entry.r * 255 * 0.299) + (entry.g * 255 * 0.587) + (entry.b * 255 * 0.114));
      buf[addr + ch.w - 1] = Math.max(0, Math.min(255, Math.round(luma))) || 0;
    }
  }
}
