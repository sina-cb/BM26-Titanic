/**
 * universe_frame_buffer.js — Per-universe 512-byte DMX frame buffer.
 *
 * Double-buffered: sources write to the "write" buffer, and at the end
 * of each frame the router swaps write → read. DmxFixtureRuntime reads
 * from the "read" buffer via typed-array views.
 *
 * Usage:
 *   const buf = new UniverseFrameBuffer(1);
 *   buf.write(startAddr, channelData);  // source writes
 *   buf.swap();                          // end-of-frame
 *   const slice = buf.getSlice(136, 10); // fixture reads channels 136-145
 */

const DMX_UNIVERSE_SIZE = 512;

export class UniverseFrameBuffer {
  /**
   * @param {number} universeId — sACN universe number (1-based)
   */
  constructor(universeId) {
    this.universeId = universeId;
    this._write = new Uint8Array(DMX_UNIVERSE_SIZE);
    this._read  = new Uint8Array(DMX_UNIVERSE_SIZE);
    this._dirty = false;
  }

  /**
   * Write channel data into the write buffer.
   * @param {number} startAddr — 1-based DMX address (1–512)
   * @param {Uint8Array|number[]} data — channel values to write
   */
  write(startAddr, data) {
    const offset = startAddr - 1; // convert to 0-based
    for (let i = 0; i < data.length && (offset + i) < DMX_UNIVERSE_SIZE; i++) {
      this._write[offset + i] = data[i];
    }
    this._dirty = true;
  }

  /**
   * Write a full 512-byte frame (used by sACN receiver).
   * @param {Uint8Array} frame — full 512-byte frame
   */
  writeFullFrame(frame) {
    this._write.set(frame.subarray(0, DMX_UNIVERSE_SIZE));
    this._dirty = true;
  }

  /**
   * Merge channel data using HTP (Highest Takes Precedence).
   * For each channel, keep the higher of existing vs incoming.
   * @param {number} startAddr — 1-based DMX address
   * @param {Uint8Array|number[]} data — channel values
   */
  mergeHTP(startAddr, data) {
    const offset = startAddr - 1;
    for (let i = 0; i < data.length && (offset + i) < DMX_UNIVERSE_SIZE; i++) {
      this._write[offset + i] = Math.max(this._write[offset + i], data[i]);
    }
    this._dirty = true;
  }

  /**
   * Swap write → read. Called once per render frame by the router.
   * After swap, the write buffer is cleared (zeros) ready for new input.
   */
  swap() {
    if (this._dirty) {
      // Copy write to read
      this._read.set(this._write);
      // Clear write for next frame
      this._write.fill(0);
      this._dirty = false;
    }
    // If not dirty, read buffer retains last valid frame (hold-last-frame)
  }

  /**
   * Get a typed-array view into the read buffer for a fixture's channel range.
   * @param {number} startAddr — 1-based start address
   * @param {number} footprint — number of channels
   * @returns {Uint8Array} — view (not a copy) of the read buffer
   */
  getSlice(startAddr, footprint) {
    const offset = startAddr - 1;
    return this._read.subarray(offset, offset + footprint);
  }

  /**
   * Get the full read buffer (for debug display, DMX console, etc.)
   * @returns {Uint8Array}
   */
  getReadBuffer() {
    return this._read;
  }

  /**
   * Clear both buffers (e.g. when disabling a source).
   */
  clear() {
    this._write.fill(0);
    this._read.fill(0);
    this._dirty = false;
  }
}
