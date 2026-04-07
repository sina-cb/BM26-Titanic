/**
 * dmx_mapper.js — Maps rendered pixel RGB values to DMX universe/address buffers.
 *
 * Takes the pixel model (with patch info) and an RGB render output,
 * and produces per-universe DMX buffers ready for sACN transmission.
 */

/**
 * Create a DMX mapper from a pixel model.
 * @param {Object[]} pixels - Array of pixel objects with .patch field
 * @returns {DmxMapper}
 */
export function createDmxMapper(pixels) {
  // Discover all universes from the model
  const universeSet = new Set();
  const patchedPixels = [];

  for (const px of pixels) {
    if (px.patch && px.patch.universe && px.patch.addr) {
      universeSet.add(px.patch.universe);
      patchedPixels.push(px);
    }
  }

  const universeIds = Array.from(universeSet).sort((a, b) => a - b);

  // Pre-allocate DMX buffers (512 bytes each, zero-filled)
  const buffers = {};
  for (const uid of universeIds) {
    buffers[uid] = new Uint8Array(512);
  }

  /**
   * Map an array of RGB pixel colors to DMX universe buffers.
   * @param {Array<{r:number, g:number, b:number}>} colors - One RGB per pixel (matches model order)
   * @returns {Object} { [universeId]: Uint8Array(512) }
   */
  function mapFrame(colors) {
    // Zero all buffers
    for (const uid of universeIds) {
      buffers[uid].fill(0);
    }

    for (let i = 0; i < patchedPixels.length; i++) {
      const px = patchedPixels[i];
      const color = colors[px.i] || { r: 0, g: 0, b: 0 };
      const buf = buffers[px.patch.universe];
      if (!buf) continue;

      const addr = px.patch.addr - 1; // DMX is 1-indexed, buffer is 0-indexed
      const footprint = px.patch.footprint || 3;

      if (px.type === 'par' && footprint >= 10) {
        // UkingPar 10ch: Dimmer(255), Strobe(0), R, G, B, W(0), A(0), U(0), Function(0), Speed(0)
        buf[addr + 0] = 255;       // Dimmer
        buf[addr + 1] = 0;         // Strobe
        buf[addr + 2] = color.r;   // Red
        buf[addr + 3] = color.g;   // Green
        buf[addr + 4] = color.b;   // Blue
        buf[addr + 5] = 0;         // White
        buf[addr + 6] = 0;         // Amber
        buf[addr + 7] = 0;         // UV
        buf[addr + 8] = 0;         // Function
        buf[addr + 9] = 0;         // Speed
      } else {
        // Default: 3ch RGB (LEDs, icebergs, etc.)
        buf[addr + 0] = color.r;
        buf[addr + 1] = color.g;
        buf[addr + 2] = color.b;
      }
    }

    return buffers;
  }

  return {
    universeIds,
    patchedPixelCount: patchedPixels.length,
    totalPixelCount: pixels.length,
    mapFrame,
  };
}
