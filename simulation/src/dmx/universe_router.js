/**
 * universe_router.js — Multi-source DMX merge and routing.
 *
 * Accepts DMX data from multiple sources (pixelblaze, sacn_in, etc.),
 * applies priority-based merge, and writes the result to UniverseFrameBuffers.
 *
 * Merge modes:
 *   - highest_priority_source_lock: highest-priority active source owns the entire universe
 *   - highest_priority_per_patch:   each patch slot is owned by its highest-priority source
 *   - htp:                          Highest Takes Precedence per channel
 *
 * Usage:
 *   const router = new UniverseRouter();
 *   router.addUniverse(1);
 *   router.submitFrame('pixelblaze', 100, 1, dmxData);
 *   router.submitFrame('sacn_in',    200, 1, dmxData);
 *   router.processFrame();  // merge + swap
 *   const slice = router.getSlice(1, 136, 10);
 */
import { UniverseFrameBuffer } from './universe_frame_buffer.js';

const SOURCE_STALE_MS = 2000; // source considered dead after 2s of no data

export class UniverseRouter {
  constructor(mergeMode = 'highest_priority_source_lock') {
    /** @type {Map<number, UniverseFrameBuffer>} */
    this._universes = new Map();

    /** @type {Map<string, SourceState>} sourceId → state */
    this._sources = new Map();

    /** @type {'highest_priority_source_lock'|'highest_priority_per_patch'|'htp'} */
    this.mergeMode = mergeMode;
  }

  // ── Universe Management ──────────────────────────────────────────────

  /**
   * Add a universe to the router.
   * @param {number} universeId
   */
  addUniverse(universeId) {
    if (!this._universes.has(universeId)) {
      this._universes.set(universeId, new UniverseFrameBuffer(universeId));
    }
  }

  /**
   * Get a universe buffer (for direct access).
   * @param {number} universeId
   * @returns {UniverseFrameBuffer|undefined}
   */
  getUniverse(universeId) {
    return this._universes.get(universeId);
  }

  /**
   * Get all universe IDs.
   * @returns {number[]}
   */
  listUniverses() {
    return [...this._universes.keys()];
  }

  // ── Source Management ────────────────────────────────────────────────

  /**
   * Submit a DMX frame from a source.
   * @param {string} sourceId    — e.g. 'pixelblaze', 'sacn_in'
   * @param {number} priority    — higher = wins (sACN convention: 0-200)
   * @param {number} universeId  — target universe
   * @param {Uint8Array} data    — 512-byte DMX frame (or partial)
   * @param {number} [startAddr=1] — 1-based start address (for partial writes)
   */
  submitFrame(sourceId, priority, universeId, data, startAddr = 1) {
    // Track source
    if (!this._sources.has(sourceId)) {
      this._sources.set(sourceId, {
        id: sourceId,
        priority,
        lastSeen: performance.now(),
        frames: new Map(), // universeId → { data, startAddr }
      });
    }
    const source = this._sources.get(sourceId);
    source.priority = priority;
    source.lastSeen = performance.now();
    source.frames.set(universeId, { data, startAddr });
  }

  /**
   * Remove a source (e.g. when disabling an engine).
   * @param {string} sourceId
   */
  removeSource(sourceId) {
    this._sources.delete(sourceId);
  }

  /**
   * Check if a source is active (has sent data recently).
   * @param {string} sourceId
   * @returns {boolean}
   */
  isSourceActive(sourceId) {
    const source = this._sources.get(sourceId);
    if (!source) return false;
    return (performance.now() - source.lastSeen) < SOURCE_STALE_MS;
  }

  // ── Frame Processing ─────────────────────────────────────────────────

  /**
   * Merge all active sources and write to universe buffers.
   * Call once per render frame.
   */
  processFrame() {
    const now = performance.now();

    // Collect active sources sorted by priority (highest first)
    const activeSources = [];
    for (const [id, source] of this._sources) {
      if ((now - source.lastSeen) < SOURCE_STALE_MS) {
        activeSources.push(source);
      }
    }
    activeSources.sort((a, b) => b.priority - a.priority);

    // Process each universe
    for (const [universeId, buffer] of this._universes) {
      if (this.mergeMode === 'htp') {
        // HTP: merge all active sources, highest value per channel wins
        for (const source of activeSources) {
          const frame = source.frames.get(universeId);
          if (frame) {
            buffer.mergeHTP(frame.startAddr, frame.data);
          }
        }
      } else if (this.mergeMode === 'highest_priority_source_lock') {
        // Source lock: highest-priority active source owns the entire universe
        for (const source of activeSources) {
          const frame = source.frames.get(universeId);
          if (frame) {
            buffer.write(frame.startAddr, frame.data);
            break; // first (highest priority) source wins
          }
        }
      } else {
        // highest_priority_per_patch: same as source_lock for now
        // (proper per-patch routing requires PatchRegistry integration)
        for (const source of activeSources) {
          const frame = source.frames.get(universeId);
          if (frame) {
            buffer.write(frame.startAddr, frame.data);
            break;
          }
        }
      }

      // Swap write → read
      buffer.swap();
    }
  }

  // ── Read Access ──────────────────────────────────────────────────────

  /**
   * Get a slice from a universe's read buffer.
   * @param {number} universeId
   * @param {number} startAddr — 1-based
   * @param {number} footprint — channel count
   * @returns {Uint8Array|null}
   */
  getSlice(universeId, startAddr, footprint) {
    const buffer = this._universes.get(universeId);
    if (!buffer) return null;
    return buffer.getSlice(startAddr, footprint);
  }

  /**
   * Get full 512-byte read buffer for a universe.
   * @param {number} universeId
   * @returns {Uint8Array|null}
   */
  getFullFrame(universeId) {
    const buffer = this._universes.get(universeId);
    if (!buffer) return null;
    return buffer.getReadBuffer();
  }

  /**
   * Get debug info about active sources.
   * @returns {Array<{id: string, priority: number, active: boolean, age: number}>}
   */
  getSourceInfo() {
    const now = performance.now();
    const info = [];
    for (const [id, source] of this._sources) {
      info.push({
        id: source.id,
        priority: source.priority,
        active: (now - source.lastSeen) < SOURCE_STALE_MS,
        age: Math.round(now - source.lastSeen),
      });
    }
    return info;
  }
}
