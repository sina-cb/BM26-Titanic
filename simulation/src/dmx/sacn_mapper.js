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
    let ch = entry.channels;
    
    // Polyfill if the model serialized channels as a flat number (e.g., 10 for UkingPar fallback)
    if (typeof ch === 'number') {
      const isPar = entry.type === 'par' || entry.fixtureType === 'UkingPar' || entry.fixtureType === 'VintageLed';
      const fp = entry.patch.footprint;
      if (isPar && fp >= 10) {
        ch = { r: 3, g: 4, b: 5, w: 6, a: 7, u: 8 };
      } else if (fp === 6) {
        ch = { r: 1, g: 2, b: 3, w: 4, a: 5, u: 6 };
      } else {
        ch = { r: 1, g: 2, b: 3 }; 
        if (typeof entry.channels === 'number' && entry.channels >= 4) ch.w = 4;
      }
    }

    let r = 0, g = 0, b = 0;
    let w = 0, a = 0, uv = 0;
    
    if (ch.r !== undefined && ch.g !== undefined && ch.b !== undefined) {
      r = frame[addr + ch.r - 1] / 255;
      g = frame[addr + ch.g - 1] / 255;
      b = frame[addr + ch.b - 1] / 255;
      
      // Extract WAU raw values for downstream consumers (SpotLight pool, sACN out, etc.)
      if (ch.w !== undefined) w = frame[addr + ch.w - 1] / 255;
      if (ch.a !== undefined) a = frame[addr + ch.a - 1] / 255;
      if (ch.u !== undefined) uv = frame[addr + ch.u - 1] / 255;
    } else if (ch.w !== undefined) {
      // Monochromatic fixture preview
      w = frame[addr + ch.w - 1] / 255;
      r = w; g = w; b = w;
    }

    // ── Write raw channel values back to the batch entry ──
    // This is CRITICAL: the V2 InstancedMesh flush (animate.js) and
    // SpotLight pool read entry.r/g/b/w/a/u to produce the final visual.
    // Without this, those consumers see 0 → black pixels.
    entry.r = r; entry.g = g; entry.b = b;
    entry.w = w; entry.a = a; entry.u = uv;

    // RGBWAU → RGB blend for 3D visual preview (same formula as Pixelblaze path)
    const rn = Math.min(1, r + w * 0.8 + a * 0.9 + uv * 0.4);
    const gn = Math.min(1, g + w * 0.8 + a * 0.6);
    const bn = Math.min(1, b + w * 0.8 + uv * 0.7);
    
    if (entry.apply) entry.apply(rn, gn, bn);
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
      if (dmxRouter.addUniverse) dmxRouter.addUniverse(entry.patch.universe);
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
